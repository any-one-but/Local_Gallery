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
        // Dev builds only (LG_DEV_MEDIA_DELAY_MS): answer slowly, to reproduce a
        // cold or busy disk.
        #[cfg(debug_assertions)]
        if let Some(ms) = std::env::var("LG_DEV_MEDIA_DELAY_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
        {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
        #[cfg(debug_assertions)]
        if std::env::var("LG_DEV_MEDIA_LOG").is_ok() {
            let range = request
                .headers()
                .get(tauri::http::header::RANGE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("-")
                .to_string();
            let name = request.uri().path().rsplit("%2F").next().unwrap_or("").to_string();
            eprintln!("[lg-media] {name} {range}");
        }
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
    fn loopback_origins() {
        assert!(super::is_loopback_http_origin("http://127.0.0.1:1430"));
        assert!(super::is_loopback_http_origin("http://localhost:1430"));
        assert!(super::is_loopback_http_origin("http://[::1]:80"));
        assert!(!super::is_loopback_http_origin("https://127.0.0.1:1430"));
        assert!(!super::is_loopback_http_origin("http://127.0.0.1.evil.com:1430"));
        assert!(!super::is_loopback_http_origin("http://example.com"));
        assert!(!super::is_loopback_http_origin("http://127.0.0.1:14x0"));
        assert!(!super::is_loopback_http_origin("null"));
    }

    #[test]
    fn mimes() {
        assert_eq!(mime_for_path("/a/B.MP4"), "video/mp4");
        assert_eq!(mime_for_path("/a/b.jpeg"), "image/jpeg");
        assert_eq!(mime_for_path("/a/noext"), "application/octet-stream");
    }
}

// ---------------------------------------------------------------------------
// Loopback HTTP for video.
//
// A custom scheme (asset:// or lgmedia://) is loaded by AVFoundation through
// WebKit's resource-loader delegate, which fulfils *each sample* as its own
// request: one round trip per video frame (3-6 KB each), every one of them
// starting and finishing on the app's main thread. Playback is ~30 of those a
// second; a scrub or a seek is hundreds. On a busy machine the main thread
// falls behind, the window stops committing frames, and the fullscreen video
// sits frozen. Over plain HTTP the player streams ranges like any network
// video, through WebKit's network process, and the app's main thread is not
// involved at all.
//
// Only reachable from this machine (127.0.0.1, ephemeral port), only with the
// per-launch random token as the first path segment, only for paths the asset
// scope allows, and CORS is granted only to the app's own origin.
// ---------------------------------------------------------------------------

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

const APP_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
];

/// Is `origin` the gallery's own page? In a release build that is only the
/// bundled page. `tauri dev` (no devUrl) serves frontend/ from its own loopback
/// server instead -- http://127.0.0.1:1430 or similar -- so a debug build also
/// accepts a loopback http origin on any port. Without that every video in a
/// dev run failed CORS (the element is crossorigin="anonymous" for the filter
/// canvas) and read as "The operation is not supported".
fn origin_is_app_page(origin: &str) -> bool {
    if APP_ORIGINS.contains(&origin) {
        return true;
    }
    cfg!(debug_assertions) && is_loopback_http_origin(origin)
}

fn is_loopback_http_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let (host, port) = match rest.rsplit_once(':') {
        Some((h, p)) => (h, Some(p)),
        None => (rest, None),
    };
    if let Some(p) = port {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    matches!(host, "127.0.0.1" | "localhost" | "[::1]")
}

fn random_token() -> String {
    let mut bytes = [0u8; 16];
    let mut filled = false;
    #[cfg(unix)]
    {
        if let Ok(mut f) = File::open("/dev/urandom") {
            filled = f.read_exact(&mut bytes).is_ok();
        }
    }
    if !filled {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        for chunk in bytes.chunks_mut(8) {
            let mut h = RandomState::new().build_hasher();
            h.write_u128(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0),
            );
            let v = h.finish().to_le_bytes();
            chunk.copy_from_slice(&v[..chunk.len()]);
        }
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Start the loopback video server. Returns the URL prefix videos are loaded
/// from (`http://127.0.0.1:<port>/<token>/`), to which the page appends the
/// percent-encoded absolute path.
pub fn start_video_server<R: Runtime>(app: AppHandle<R>) -> Option<String> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    let port = listener.local_addr().ok()?.port();
    let token = random_token();
    let prefix = format!("/{token}/");
    std::thread::Builder::new()
        .name("lg-video-server".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let app = app.clone();
                let prefix = prefix.clone();
                let _ = std::thread::Builder::new()
                    .name("lg-video-conn".into())
                    .spawn(move || serve_connection(stream, &app, &prefix));
            }
        })
        .ok()?;
    Some(format!("http://127.0.0.1:{port}/{token}/"))
}

struct HttpRequest {
    method: String,
    target: String,
    range: Option<String>,
    origin: Option<String>,
    close: bool,
}

fn read_request(reader: &mut BufReader<TcpStream>) -> Option<HttpRequest> {
    let mut line = String::new();
    if reader.read_line(&mut line).ok()? == 0 {
        return None;
    }
    let mut parts = line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();
    let version = parts.next().unwrap_or("HTTP/1.1").to_string();
    let mut req = HttpRequest {
        method,
        target,
        range: None,
        origin: None,
        close: version == "HTTP/1.0",
    };
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h).ok()? == 0 {
            return None;
        }
        let h = h.trim_end();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            let v = v.trim();
            match k.trim().to_ascii_lowercase().as_str() {
                "range" => req.range = Some(v.to_string()),
                "origin" => req.origin = Some(v.to_string()),
                "connection" => {
                    let v = v.to_ascii_lowercase();
                    if v.contains("close") {
                        req.close = true;
                    } else if v.contains("keep-alive") {
                        req.close = false;
                    }
                }
                _ => {}
            }
        }
    }
    Some(req)
}

fn write_head(
    stream: &mut TcpStream,
    status: &str,
    headers: &[(String, String)],
    close: bool,
) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status}\r\n");
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str(if close {
        "Connection: close\r\n\r\n"
    } else {
        "Connection: keep-alive\r\n\r\n"
    });
    stream.write_all(head.as_bytes())
}

fn serve_connection<R: Runtime>(stream: TcpStream, app: &AppHandle<R>, prefix: &str) {
    use tauri::Manager;
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(60)));
    let _ = stream.set_nodelay(true);
    let Ok(write_half) = stream.try_clone() else { return };
    let mut out = write_half;
    let mut reader = BufReader::new(stream);
    while let Some(req) = read_request(&mut reader) {
        let mut headers: Vec<(String, String)> = vec![
            ("Accept-Ranges".into(), "bytes".into()),
            ("Cache-Control".into(), "no-store".into()),
        ];
        if let Some(o) = req.origin.as_deref() {
            if origin_is_app_page(o) {
                headers.push(("Access-Control-Allow-Origin".into(), o.to_string()));
                headers.push(("Vary".into(), "Origin".into()));
                headers.push((
                    "Access-Control-Expose-Headers".into(),
                    "content-range, content-length, accept-ranges".into(),
                ));
            }
        }
        let reject = |out: &mut TcpStream, status: &str, headers: &mut Vec<(String, String)>| {
            headers.push(("Content-Length".into(), "0".into()));
            write_head(out, status, headers, true)
        };
        if req.method != "GET" && req.method != "HEAD" {
            let _ = reject(&mut out, "405 Method Not Allowed", &mut headers);
            return;
        }
        let path_part = req.target.split('?').next().unwrap_or("");
        let Some(encoded) = path_part.strip_prefix(prefix) else {
            let _ = reject(&mut out, "404 Not Found", &mut headers);
            return;
        };
        let path = percent_decode(encoded);
        #[cfg(debug_assertions)]
        if std::env::var("LG_DEV_MEDIA_LOG").is_ok() {
            let name = path.rsplit('/').next().unwrap_or("");
            eprintln!("[lg-video] {} {} {}", req.method, name, req.range.as_deref().unwrap_or("-"));
        }
        if path.is_empty() || !app.asset_protocol_scope().is_allowed(&path) {
            let _ = reject(&mut out, "403 Forbidden", &mut headers);
            return;
        }
        let Ok(mut file) = File::open(&path) else {
            let _ = reject(&mut out, "404 Not Found", &mut headers);
            return;
        };
        let len = match file.metadata() {
            Ok(m) if m.is_file() => m.len(),
            _ => {
                let _ = reject(&mut out, "404 Not Found", &mut headers);
                return;
            }
        };
        headers.push(("Content-Type".into(), mime_for_path(&path).into()));
        let (status, start, n) = match req.range.as_deref() {
            Some(r) => match parse_range(r, len) {
                Ok((s, e)) => {
                    headers.push(("Content-Range".into(), format!("bytes {s}-{e}/{len}")));
                    ("206 Partial Content", s, e - s + 1)
                }
                Err(()) => {
                    headers.push(("Content-Range".into(), format!("bytes */{len}")));
                    let _ = reject(&mut out, "416 Range Not Satisfiable", &mut headers);
                    return;
                }
            },
            None => ("200 OK", 0, len),
        };
        headers.push(("Content-Length".into(), n.to_string()));
        if write_head(&mut out, status, &headers, req.close).is_err() {
            return;
        }
        if req.method == "GET" {
            if file.seek(SeekFrom::Start(start)).is_err() {
                return;
            }
            // A player that has what it needs simply closes the socket; the
            // copy then fails and the connection ends.
            if std::io::copy(&mut (&mut file).take(n), &mut out).is_err() {
                return;
            }
        }
        if req.close {
            return;
        }
    }
}
