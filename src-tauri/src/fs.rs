//! Native filesystem commands backing the File System Access API shim
//! (`tauri-fs-shim.js`). These replace the browser handle API the Electron
//! build relied on (`showDirectoryPicker`, dir/file handles, `createWritable`),
//! which doesn't exist in WKWebView.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

/// A file child of a directory, with the metadata the workspace builder needs
/// (it reads size/mtime, not bytes, at scan time).
#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub size: u64,
    /// Last-modified in epoch milliseconds (matches JS `File.lastModified`).
    pub mtime_ms: f64,
}

#[derive(Serialize)]
pub struct DirListing {
    pub dirs: Vec<String>,
    pub files: Vec<FileEntry>,
}

fn mtime_ms(md: &std::fs::Metadata) -> f64 {
    md.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Native folder picker. Returns the chosen absolute path, or `None` if the
/// user cancelled. Backs the `showDirectoryPicker` shim.
#[tauri::command]
pub fn pick_root(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .and_then(|p| p.into_path().ok())
        .map(|p| p.to_string_lossy().into_owned())
}

/// List a directory's immediate children. JS does the media/hidden filtering;
/// this just reports dirs and files (+ size/mtime). Symlinks are resolved.
#[tauri::command]
pub fn scan_dir(path: String) -> Result<DirListing, String> {
    let mut dirs = Vec::new();
    let mut files = Vec::new();
    let read = std::fs::read_dir(&path).map_err(|e| format!("read_dir {path}: {e}"))?;
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // metadata() follows symlinks so linked dirs/files classify correctly.
        let md = match std::fs::metadata(entry.path()) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if md.is_dir() {
            dirs.push(name);
        } else if md.is_file() {
            files.push(FileEntry {
                name,
                size: md.len(),
                mtime_ms: mtime_ms(&md),
            });
        }
    }
    Ok(DirListing { dirs, files })
}

/// "file" | "dir" | "none" — lets the shim emulate getFileHandle/
/// getDirectoryHandle existence semantics.
#[tauri::command]
pub fn path_kind(path: String) -> String {
    match std::fs::metadata(&path) {
        Ok(m) if m.is_dir() => "dir".into(),
        Ok(m) if m.is_file() => "file".into(),
        _ => "none".into(),
    }
}

/// Read a whole file (used by the shim's `File.arrayBuffer()/text()`, i.e. for
/// the small `.local-gallery/*.json` metadata logs — NOT media, which uses the
/// asset protocol).
#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))
}

/// Write a file atomically (temp + rename), creating parent dirs. Backs the
/// shim's `createWritable().write()/close()`.
#[tauri::command]
pub fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }
    let tmp = target.with_extension(format!(
        "{}lgtmp",
        target
            .extension()
            .map(|e| format!("{}.", e.to_string_lossy()))
            .unwrap_or_default()
    ));
    std::fs::write(&tmp, &bytes).map_err(|e| format!("write tmp: {e}"))?;
    std::fs::rename(&tmp, &target).map_err(|e| format!("rename: {e}"))?;
    Ok(())
}

/// Create a directory (and parents). Backs getDirectoryHandle({create:true}).
#[tauri::command]
pub fn make_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| format!("mkdir {path}: {e}"))
}

/// Create an empty file if it doesn't exist (no truncation if present). Backs
/// getFileHandle({create:true}).
#[tauri::command]
pub fn touch_file(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Ok(());
    }
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .open(p)
        .map_err(|e| format!("create {path}: {e}"))?;
    Ok(())
}

/// Move/rename a path. Backs the FS Access `handle.move(destDir, newName)` API,
/// so rename and move-to-trash are instant native operations instead of a
/// read-whole-file-through-IPC copy. Refuses to overwrite an existing target.
#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<(), String> {
    let to_path = Path::new(&to);
    if to_path.exists() {
        return Err(format!("target already exists: {to}"));
    }
    if let Some(parent) = to_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {e}"))?;
    }
    std::fs::rename(&from, &to).map_err(|e| format!("rename {from} -> {to}: {e}"))
}

fn last_root_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config: {e}"))?;
    Ok(dir.join("last-root.txt"))
}

/// Remember the most-recently-opened library so we can auto-reopen on launch.
#[tauri::command]
pub fn save_last_root(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let f = last_root_file(&app)?;
    std::fs::write(&f, path.as_bytes()).map_err(|e| format!("save last root: {e}"))
}

/// The most-recently-opened library path, if any (and still exists).
#[tauri::command]
pub fn get_last_root(app: tauri::AppHandle) -> Option<String> {
    let f = last_root_file(&app).ok()?;
    let s = std::fs::read_to_string(&f).ok()?;
    let s = s.trim().to_string();
    if s.is_empty() || !Path::new(&s).is_dir() {
        None
    } else {
        Some(s)
    }
}

/// Remove a file or directory. Backs removeEntry({recursive}).
#[tauri::command]
pub fn remove_path(path: String, recursive: bool) -> Result<(), String> {
    let p = Path::new(&path);
    let md = match std::fs::symlink_metadata(p) {
        Ok(m) => m,
        Err(_) => return Ok(()), // already gone
    };
    let res = if md.is_dir() {
        if recursive {
            std::fs::remove_dir_all(p)
        } else {
            std::fs::remove_dir(p)
        }
    } else {
        std::fs::remove_file(p)
    };
    res.map_err(|e| format!("remove {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_write_read_roundtrip() {
        let dir = std::env::temp_dir().join("lg-fs-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let sub = dir.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(dir.join("a.txt"), b"hello").unwrap();

        // make_dir + touch + write + read
        let nested = dir.join(".local-gallery");
        make_dir(nested.to_string_lossy().into()).unwrap();
        let log = nested.join("x.log.json");
        touch_file(log.to_string_lossy().into()).unwrap();
        write_file_bytes(log.to_string_lossy().into(), b"{\"ok\":1}".to_vec()).unwrap();
        let back = read_file_bytes(log.to_string_lossy().into()).unwrap();
        assert_eq!(back, b"{\"ok\":1}");

        // scan_dir sees sub (dir) and a.txt (file, size 5)
        let listing = scan_dir(dir.to_string_lossy().into()).unwrap();
        assert!(listing.dirs.iter().any(|d| d == "sub"));
        let a = listing.files.iter().find(|f| f.name == "a.txt").unwrap();
        assert_eq!(a.size, 5);

        // path_kind + remove
        assert_eq!(path_kind(sub.to_string_lossy().into()), "dir");
        assert_eq!(path_kind(dir.join("a.txt").to_string_lossy().into()), "file");
        remove_path(sub.to_string_lossy().into(), true).unwrap();
        assert_eq!(path_kind(sub.to_string_lossy().into()), "none");
    }

    #[test]
    fn rename_moves_and_refuses_overwrite() {
        let dir = std::env::temp_dir().join("lg-fs-rename-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        std::fs::write(&a, b"x").unwrap();

        rename_path(a.to_string_lossy().into(), b.to_string_lossy().into()).unwrap();
        assert_eq!(path_kind(a.to_string_lossy().into()), "none");
        assert_eq!(path_kind(b.to_string_lossy().into()), "file");

        // Refuses to overwrite an existing target.
        std::fs::write(&a, b"y").unwrap();
        assert!(rename_path(a.to_string_lossy().into(), b.to_string_lossy().into()).is_err());
    }
}
