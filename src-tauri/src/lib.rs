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
/// anything else QuickLook can render. Writes `<out_dir>/<filename>.png`.
/// This is the temporary cross-format path; production will use AVFoundation /
/// QLThumbnailGenerator directly (and ffmpeg on Windows).
fn thumbnail_quicklook(src: &Path, out_dir: &Path, edge: u32) -> Result<PathBuf, String> {
    let output = Command::new("qlmanage")
        .arg("-t")
        .arg("-s")
        .arg(edge.to_string())
        .arg("-o")
        .arg(out_dir)
        .arg(src)
        .output()
        .map_err(|e| format!("qlmanage failed to launch: {e}"))?;

    // qlmanage names the result after the input file: "video.mp4" -> "video.mp4.png".
    let file_name = src
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "bad source file name".to_string())?;
    let produced = out_dir.join(format!("{file_name}.png"));
    if produced.exists() {
        Ok(produced)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("quicklook produced no thumbnail: {stderr}"))
    }
}

/// Generate a thumbnail for any media file and return the absolute path to the
/// generated image. Images go through the `image` crate; everything else falls
/// back to QuickLook. Idempotent-ish: the output name is keyed on the source
/// path + edge so repeat calls reuse the same file.
#[tauri::command]
fn generate_thumbnail(
    path: String,
    max_edge: Option<u32>,
    out_dir: Option<String>,
) -> Result<String, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("file not found: {path}"));
    }
    let edge = max_edge.unwrap_or(512).clamp(16, 2048);
    let out_dir = out_dir.map(PathBuf::from).unwrap_or_else(default_thumb_dir);
    std::fs::create_dir_all(&out_dir).map_err(|e| format!("mkdir failed: {e}"))?;

    let ext = src
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let stem = src.file_stem().and_then(|s| s.to_str()).unwrap_or("thumb");
    let out_path = out_dir.join(format!("{stem}-{:x}-{edge}.jpg", hash_str(&path)));

    if IMAGE_EXTS.contains(&ext.as_str()) {
        match thumbnail_image(&src, &out_path, edge) {
            Ok(()) => return Ok(out_path.to_string_lossy().into_owned()),
            // Fall through to QuickLook (e.g. an exotic/corrupt image).
            Err(_) => {}
        }
    }

    let produced = thumbnail_quicklook(&src, &out_dir, edge)?;
    Ok(produced.to_string_lossy().into_owned())
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
            fs::get_last_root
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

        let out = generate_thumbnail(
            src.to_string_lossy().into_owned(),
            Some(128),
            Some(dir.to_string_lossy().into_owned()),
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
