//! Local Gallery — Tauri (Rust) backend.
//!
//! This is the start of the port away from Electron. The big UI (index.html)
//! loads unchanged in the system WebView; the heavy, OS-touching work moves
//! here into native Rust commands invoked from the frontend.
//!
//! First command landed: `generate_thumbnail`, the proof-of-concept that the
//! whole port hinges on — native thumbnailing for images (and video via
//! macOS QuickLook), replacing the Electron `<video>`/canvas/ffmpeg approach.

mod fs;

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

fn hash_str(s: &str) -> u64 {
    let mut h = DefaultHasher::new();
    s.hash(&mut h);
    h.finish()
}

const IMAGE_EXTS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "ico",
];

/// Where thumbnails are written when the caller doesn't specify. A per-run temp
/// dir for the spike; the real app will point this at `<root>/.local-gallery`.
fn default_thumb_dir() -> PathBuf {
    std::env::temp_dir().join("local-gallery-thumbs")
}

/// Decode + resize an image to a JPEG thumbnail with the pure-Rust `image`
/// crate. Fast and dependency-light; returns Err so the caller can fall back.
fn thumbnail_image(src: &Path, out_path: &Path, edge: u32) -> Result<(), String> {
    let img = image::open(src).map_err(|e| format!("decode failed: {e}"))?;
    // `thumbnail` preserves aspect ratio and fits within edge x edge.
    let thumb = img.thumbnail(edge, edge);
    // JPEG has no alpha channel; flatten to RGB before saving.
    thumb
        .to_rgb8()
        .save(out_path)
        .map_err(|e| format!("encode failed: {e}"))?;
    Ok(())
}

/// macOS QuickLook fallback (`qlmanage -t`). Handles video, PDF, HEIC, and
/// anything else QuickLook can render. Runs into a temp dir (qlmanage names its
/// output after the input file) and moves the result to our deterministic cache
/// path. Temporary cross-format path; production will use AVFoundation /
/// QLThumbnailGenerator directly (and ffmpeg on Windows).
fn thumbnail_quicklook(src: &Path, out_path: &Path, edge: u32) -> Result<(), String> {
    let parent = out_path.parent().ok_or("bad out_path")?;
    let tmp = parent.join(".ql-tmp");
    std::fs::create_dir_all(&tmp).map_err(|e| format!("mkdir tmp: {e}"))?;
    let output = Command::new("qlmanage")
        .arg("-t")
        .arg("-s")
        .arg(edge.to_string())
        .arg("-o")
        .arg(&tmp)
        .arg(src)
        .output()
        .map_err(|e| format!("qlmanage failed to launch: {e}"))?;

    let file_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "bad source file name".to_string())?;
    let produced = tmp.join(format!("{file_name}.png"));
    let result = if produced.exists() {
        std::fs::rename(&produced, out_path)
            .or_else(|_| std::fs::copy(&produced, out_path).map(|_| ()))
            .map_err(|e| format!("move ql thumb: {e}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("quicklook produced no thumbnail: {stderr}"))
    };
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

static FFMPEG_PATH: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

/// Resolve ffmpeg once at startup: prefer the binary bundled with the app
/// (ffmpeg-static copied into resources), else a system install. A GUI app's
/// PATH is minimal, so system locations are checked explicitly.
fn init_ffmpeg_path(app: &tauri::AppHandle) {
    let bundled = app
        .path()
        .resolve("resources/ffmpeg", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.exists());
    let chosen = bundled.or_else(|| {
        [
            "/opt/homebrew/bin/ffmpeg",
            "/usr/local/bin/ffmpeg",
            "/usr/bin/ffmpeg",
            "/opt/local/bin/ffmpeg",
        ]
        .iter()
        .map(PathBuf::from)
        .find(|p| p.exists())
    });
    #[cfg(debug_assertions)]
    eprintln!("[lg] ffmpeg: {:?}", chosen);
    let _ = FFMPEG_PATH.set(chosen);
}

fn find_ffmpeg() -> Option<PathBuf> {
    FFMPEG_PATH.get().cloned().flatten()
}

/// Extract a single video frame at `seek` seconds into a JPEG, scaled to fit
/// `edge` while preserving aspect (so the user's thumbnail crop lands the same
/// as it did on the live frame). Retries at the first frame if the seek lands
/// past a short clip's end. Returns true on success.
fn ffmpeg_thumb(ff: &Path, src: &Path, out_path: &Path, seek: f64, edge: u32) -> bool {
    let scale =
        format!("scale='min({edge},iw)':'min({edge},ih)':force_original_aspect_ratio=decrease");
    let run = |s: f64| -> bool {
        let ok = Command::new(ff)
            .args(["-ss", &format!("{s}"), "-i"])
            .arg(src)
            .args(["-frames:v", "1", "-vf", &scale, "-q:v", "4", "-y"])
            .arg(out_path)
            .output()
            .is_ok();
        ok && out_path.metadata().map(|m| m.len() > 0).unwrap_or(false)
    };
    if seek > 0.0 && run(seek) {
        return true;
    }
    run(0.0)
}

/// Generate (and disk-cache) a thumbnail for a media file; returns the absolute
/// path to the cached image. The cache key is path+size+mtime+edge+frame, so
/// repeat calls short-circuit and edits/frame-changes invalidate. Images use the
/// `image` crate (JPEG); videos use ffmpeg at the chosen `frame_time` (JPEG),
/// falling back to QuickLook (PNG) when ffmpeg isn't available.
///
/// Async + `spawn_blocking`: image decode and the ffmpeg/QuickLook subprocess
/// must run off the main thread, or generating thumbnails during navigation
/// freezes the UI (beachball).
/// Caps concurrent thumbnail generation so a big folder doesn't launch one
/// ffmpeg/decode task per tile at once. Sized to the machine, clamped to [2, 6].
fn thumb_semaphore() -> &'static tokio::sync::Semaphore {
    static SEM: std::sync::OnceLock<tokio::sync::Semaphore> = std::sync::OnceLock::new();
    SEM.get_or_init(|| {
        let n = std::thread::available_parallelism()
            .map(|c| c.get())
            .unwrap_or(4)
            .clamp(2, 6);
        tokio::sync::Semaphore::new(n)
    })
}

#[tauri::command]
async fn generate_thumbnail(
    path: String,
    max_edge: Option<u32>,
    out_dir: Option<String>,
    frame_time: Option<f64>,
) -> Result<String, String> {
    // Hold a permit for the duration of the (blocking) work to bound concurrency.
    let _permit = thumb_semaphore()
        .acquire()
        .await
        .map_err(|e| format!("semaphore: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        thumbnail_to_cache(path, max_edge, out_dir, frame_time)
    })
    .await
    .map_err(|e| format!("thumbnail task failed: {e}"))?
}

/// Synchronous thumbnail-cache worker (runs on a blocking thread; also unit-tested).
fn thumbnail_to_cache(
    path: String,
    max_edge: Option<u32>,
    out_dir: Option<String>,
    frame_time: Option<f64>,
) -> Result<String, String> {
    {
        let src = PathBuf::from(&path);
        let md = std::fs::metadata(&src).map_err(|e| format!("stat {path}: {e}"))?;
        if !md.is_file() {
            return Err(format!("not a file: {path}"));
        }
        let size = md.len();
        let mtime = md
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let edge = max_edge.unwrap_or(512).clamp(16, 2048);
        // Effective frame time: the chosen one, else an early frame (~matches the
        // old default). Folded into the cache key so changing it regenerates.
        let ft = frame_time.filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.1);
        let frame_ms = (ft * 1000.0) as u64;
        let out_dir = out_dir
            .filter(|s| !s.is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_thumb_dir);
        std::fs::create_dir_all(&out_dir).map_err(|e| format!("mkdir failed: {e}"))?;

        let base = format!("{:x}-{}-{}-{}-{}", hash_str(&path), size, mtime, edge, frame_ms);
        let jpg = out_dir.join(format!("{base}.jpg"));
        let png = out_dir.join(format!("{base}.png"));
        if jpg.exists() {
            return Ok(jpg.to_string_lossy().into_owned());
        }
        if png.exists() {
            return Ok(png.to_string_lossy().into_owned());
        }

        let ext = src
            .extension()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if IMAGE_EXTS.contains(&ext.as_str()) {
            if thumbnail_image(&src, &jpg, edge).is_ok() {
                return Ok(jpg.to_string_lossy().into_owned());
            }
        } else if let Some(ff) = find_ffmpeg() {
            if ffmpeg_thumb(&ff, &src, &jpg, ft, edge) {
                return Ok(jpg.to_string_lossy().into_owned());
            }
        }
        // Fallback for non-images without ffmpeg (or a corrupt image).
        thumbnail_quicklook(&src, &png, edge)?;
        Ok(png.to_string_lossy().into_owned())
    }
}

/// Trivial connectivity check the frontend can call to confirm the Rust backend
/// is wired up.
#[tauri::command]
fn ping() -> String {
    // Dev-only signal that the frontend reached the Rust backend over IPC.
    #[cfg(debug_assertions)]
    eprintln!("[lg] ping() — frontend reached the Rust backend");
    format!("local-gallery rust backend v{}", env!("CARGO_PKG_VERSION"))
}

/// Strip characters that are illegal/awkward in filenames (mirrors the old
/// Electron main-process logic).
fn sanitize_download_name(name: &str) -> String {
    let base = {
        let t = name.trim();
        if t.is_empty() {
            "local-gallery-export.gif"
        } else {
            t
        }
    };
    let cleaned: String = base
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "local-gallery-export.gif".to_string()
    } else {
        cleaned
    }
}

/// Pick a non-colliding path in `dir` for `name` (appends " (n)" like Finder).
fn unique_download_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let (stem, ext) = match name.rfind('.') {
        Some(i) if i > 0 => (&name[..i], &name[i..]),
        _ => (name, ""),
    };
    for n in 1..10000 {
        let candidate = dir.join(format!("{stem} ({n}){ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    dir.join(format!("{stem}-{ts}{ext}"))
}

/// Dev-only: the frontend reports a status string we can see in the dev console
/// (used to verify the open flow without driving the GUI).
#[tauri::command]
fn dev_report(msg: String) {
    eprintln!("[lg-dev] {msg}");
}

/// Save bytes to the user's Downloads folder under a unique name; returns the
/// written path. Replaces the Electron `downloads-write-file` IPC.
#[tauri::command]
fn write_download_file(
    app: tauri::AppHandle,
    file_name: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = app
        .path()
        .download_dir()
        .map_err(|e| format!("no downloads dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir failed: {e}"))?;
    let safe = sanitize_download_name(&file_name);
    let target = unique_download_path(&dir, &safe);
    std::fs::write(&target, &bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(target.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_ffmpeg_path(app.handle());
            // Build the main window in Rust so we can inject our init scripts
            // before index.html's own scripts run:
            //  - tauri-bridge.js  -> window.electronAPI shim
            //  - tauri-fs-shim.js -> File System Access API shim (showDirectoryPicker
            //    + dir/file handles) backed by the native fs::* commands.
            let bridge = include_str!("../../tauri-bridge.js");
            let fs_shim = include_str!("../../tauri-fs-shim.js");
            let mut builder = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Local Gallery")
            .inner_size(1100.0, 750.0)
            .resizable(true)
            .initialization_script(bridge)
            .initialization_script(fs_shim);

            // Dev-only: auto-open a library by path (set LG_DEV_OPEN) once the
            // app is ready, and report the resulting dir/file counts. Lets us
            // verify the open flow end-to-end without the GUI folder picker.
            if let Ok(path) = std::env::var("LG_DEV_OPEN") {
                if !path.is_empty() {
                    let p = serde_json::to_string(&path).unwrap_or_else(|_| "\"\"".into());
                    let script = format!(
                        "(function(){{window.__lgDevOpen=1;var p={p};var t=setInterval(function(){{\
if(typeof buildWorkspaceFromDirectoryHandle==='function'&&document.readyState!=='loading'){{\
clearInterval(t);window.__lg.openRoot(p).then(function(){{\
var d=(typeof WS!=='undefined'&&WS.dirByPath)?WS.dirByPath.size:-1;\
var f=(typeof WS!=='undefined'&&WS.fileById)?WS.fileById.size:-1;\
window.__TAURI__.core.invoke('dev_report',{{msg:'openRoot OK dirs='+d+' files='+f}});\
return window.__lg.assetSelfTest(p+'/FolderA/img1.png').then(function(s){{\
window.__TAURI__.core.invoke('dev_report',{{msg:'asset '+s}});\
return window.__lg.requestThumb(p+'/FolderA/img1.png',32).then(function(u){{\
return fetch(u).then(function(r){{return r.arrayBuffer().then(function(b){{\
window.__TAURI__.core.invoke('dev_report',{{msg:'imgthumb status='+r.status+' bytes='+b.byteLength}});\
return window.__lg.requestThumb(p+'/FolderA/vid1.mp4',64).then(function(vu){{\
return fetch(vu).then(function(vr){{return vr.arrayBuffer().then(function(vb){{\
window.__TAURI__.core.invoke('dev_report',{{msg:'vidthumb status='+vr.status+' bytes='+vb.byteLength}});}});}});}});}});}});}});}});\
}}).catch(function(e){{window.__TAURI__.core.invoke('dev_report',{{msg:'openRoot FAILED: '+(e&&e.message||e)}});}});\
}}}},200);}})();"
                    );
                    builder = builder.initialization_script(script);
                }
            }

            builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            dev_report,
            generate_thumbnail,
            write_download_file,
            fs::pick_root,
            fs::scan_dir,
            fs::path_kind,
            fs::read_file_bytes,
            fs::write_file_bytes,
            fs::make_dir,
            fs::touch_file,
            fs::remove_path,
            fs::rename_path,
            fs::save_last_root,
            fs::get_last_root,
            fs::allow_media_scope
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_an_image_thumbnail() {
        // Self-contained: synthesize a source PNG, thumbnail it, verify output.
        let dir = std::env::temp_dir().join("lg-thumb-test");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("sample.png");
        let img = image::RgbImage::from_fn(800, 600, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        });
        img.save(&src).unwrap();

        let out = thumbnail_to_cache(
            src.to_string_lossy().into_owned(),
            Some(128),
            Some(dir.to_string_lossy().into_owned()),
            None,
        )
        .expect("thumbnail generation should succeed");

        let meta = std::fs::metadata(&out).expect("output file should exist");
        assert!(meta.len() > 0, "thumbnail should be non-empty");

        let thumb = image::open(&out).expect("output should be a valid image");
        assert!(
            thumb.width() <= 128 && thumb.height() <= 128,
            "thumbnail should fit within the requested edge ({}x{})",
            thumb.width(),
            thumb.height()
        );
    }
}
