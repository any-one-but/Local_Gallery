//! `lgmedia://` -- the app's own protocol for library media (images, videos,
//! generated thumbnails).
//!
//! It exists because Tauri's built-in `asset://` protocol answers every request
//! synchronously inside WebKit's `startURLSchemeTask`, which runs on the app's
//! main thread. A video seek is a burst of range requests, and each one was a
//! file read on the thread that draws the window, so scrubbing froze the whole
//! (fullscreen) window on its last frame; every image open was a whole-file
//! read there too. This handler is registered as an *asynchronous* protocol and
//! does all file I/O on the blocking pool, so the main thread only hands the
//! request over.
//!
//! Access rules match `asset://`: a path is served only if the asset protocol
//! scope allows it (the open library, granted by `allow_media_scope`), and only
//! to the main window -- the embedded remote sites (Grok, Claude) must never be
//! able to read the library through it.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Runtime, UriSchemeContext, UriSchemeResponder};

pub const SCHEME: &str = "lgmedia";

/// Largest body sent for one range request. Players ask for open-ended ranges
/// ("bytes=N-") and cancel what they do not need; a few MB keeps the number of
/// round trips low without reading whole files for a seek.
const MAX_RANGE_BYTES: u64 = 4 * 1024 * 1024;

const ALLOWED_WEBVIEWS: &[&str] = &["main"];

pub fn handle<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if !ALLOWED_WEBVIEWS.contains(&ctx.webview_label()) {
        responder.respond(status_only(StatusCode::FORBIDDEN, None));
        return;
    }
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        responder.respond(respond(&app, &request));
    });
}

fn status_only(status: StatusCode, origin: Option<&str>) -> Response<Vec<u8>> {
    let mut b = Response::builder().status(status);
    if let Some(o) = origin {
        b = b.header(header::ACCESS_CONTROL_ALLOW_ORIGIN, o);
    }
    b.body(Vec::new()).unwrap()
}

fn request_path(request: &Request<Vec<u8>>) -> String {
    let raw = request.uri().path();
    let raw = raw.strip_prefix('/').unwrap_or(raw);
    percent_decode(raw)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn mime_for_path(path: &str) -> &'static str {
    let ext = path
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "svg" => "image/svg+xml",
        "heic" => "image/heic",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "md" | "markdown" | "txt" => "text/plain; charset=utf-8",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Parse a single `bytes=` range against `len`. Multi-range requests are
/// answered with their first range, which players never send anyway.
/// Returns `Err(())` when the range cannot be satisfied.
pub fn parse_range(value: &str, len: u64) -> Result<(u64, u64), ()> {
    let spec = value.trim().strip_prefix("bytes=").ok_or(())?;
    let first = spec.split(',').next().ok_or(())?.trim();
    let (a, b) = first.split_once('-').ok_or(())?;
    let (a, b) = (a.trim(), b.trim());
    if len == 0 {
        return Err(());
    }
    let (start, end) = if a.is_empty() {
        // suffix: the last N bytes
        let n: u64 = b.parse().map_err(|_| ())?;
        if n == 0 {
            return Err(());
        }
        (len.saturating_sub(n), len - 1)
    } else {
        let start: u64 = a.parse().map_err(|_| ())?;
        let end: u64 = if b.is_empty() {
            len - 1
        } else {
            b.parse::<u64>().map_err(|_| ())?.min(len - 1)
        };
        (start, end)
    };
    if start >= len || end < start {
        return Err(());
    }
    Ok((start, end))
}

fn respond<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    use tauri::Manager;
    let origin = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*")
        .to_string();
    let origin = origin.as_str();
    let path = request_path(request);
    if path.is_empty() || !app.asset_protocol_scope().is_allowed(&path) {
        return status_only(StatusCode::FORBIDDEN, Some(origin));
    }
    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return status_only(StatusCode::NOT_FOUND, Some(origin))
        }
        Err(_) => return status_only(StatusCode::FORBIDDEN, Some(origin)),
    };
    let len = match file.metadata() {
        Ok(m) if m.is_file() => m.len(),
        _ => return status_only(StatusCode::NOT_FOUND, Some(origin)),
    };

    let base = Response::builder()
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin)
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "content-range, content-length, accept-ranges",
        )
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, mime_for_path(&path));

    let is_head = request.method() == tauri::http::Method::HEAD;
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if let Some(range) = range {
        let (start, end) = match parse_range(&range, len) {
            Ok(r) => r,
            Err(()) => {
                return base
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                    .body(Vec::new())
                    .unwrap()
            }
        };
        let end = end.min(start + MAX_RANGE_BYTES - 1);
        let n = end - start + 1;
        let body = if is_head {
            Vec::new()
        } else {
            let mut buf = Vec::with_capacity(n as usize);
            if file.seek(SeekFrom::Start(start)).is_err()
                || (&mut file).take(n).read_to_end(&mut buf).is_err()
            {
                return status_only(StatusCode::INTERNAL_SERVER_ERROR, Some(origin));
            }
            buf
        };
        return base
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
            .header(header::CONTENT_LENGTH, if is_head { n } else { body.len() as u64 })
            .body(body)
            .unwrap();
    }

    let body = if is_head {
        Vec::new()
    } else {
        let mut buf = Vec::with_capacity(len as usize);
        if file.read_to_end(&mut buf).is_err() {
            return status_only(StatusCode::INTERNAL_SERVER_ERROR, Some(origin));
        }
        buf
    };
    base.status(StatusCode::OK)
        .header(header::CONTENT_LENGTH, len)
        .body(body)
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-1", 10), Ok((0, 1)));
        assert_eq!(parse_range("bytes=5-", 10), Ok((5, 9)));
        assert_eq!(parse_range("bytes=-3", 10), Ok((7, 9)));
        assert_eq!(parse_range("bytes=0-100", 10), Ok((0, 9)));
        assert_eq!(parse_range("bytes=2-4, 6-7", 10), Ok((2, 4)));
        assert!(parse_range("bytes=10-", 10).is_err());
        assert!(parse_range("bytes=5-2", 10).is_err());
        assert!(parse_range("items=0-1", 10).is_err());
        assert!(parse_range("bytes=-0", 10).is_err());
    }

    #[test]
    fn decode() {
        assert_eq!(percent_decode("%2FUsers%2Fjo%2Fa%20b.png"), "/Users/jo/a b.png");
        assert_eq!(percent_decode("caf%C3%A9"), "café");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn mimes() {
        assert_eq!(mime_for_path("/a/B.MP4"), "video/mp4");
        assert_eq!(mime_for_path("/a/b.jpeg"), "image/jpeg");
        assert_eq!(mime_for_path("/a/noext"), "application/octet-stream");
    }
}
