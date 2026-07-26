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
///
/// Must be `async` + `spawn_blocking`: a sync command runs on the main thread,
/// and `blocking_pick_folder` would then block the very thread the native panel
/// needs to pump events (macOS beachball / deadlock). Running the blocking pick
/// on a blocking-pool thread lets the panel show on the free main thread.
#[tauri::command]
pub async fn pick_root(app: tauri::AppHandle) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .ok()
    .flatten()
}

/// List a directory's immediate children. JS does the media/hidden filtering;
/// this just reports dirs and files (+ size/mtime). Symlinks are resolved.
#[tauri::command]
pub async fn scan_dir(path: String) -> Result<DirListing, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<DirListing, String> {
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
    })
    .await
    .map_err(|e| format!("scan task failed: {e}"))?
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
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))
    })
    .await
    .map_err(|e| format!("read task failed: {e}"))?
}

/// Write a file atomically (temp + rename), creating parent dirs. Backs the
/// shim's `createWritable().write()/close()`.
#[tauri::command]
pub async fn write_file_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
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
    })
    .await
    .map_err(|e| format!("write task failed: {e}"))?
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

/// Allow the asset protocol (convertFileSrc) to serve files under `path`. The
/// config denies everything by default; the open flow calls this for the chosen
/// library root so the WebView can only read the opened folder, not the whole
/// disk.
#[tauri::command]
pub fn allow_media_scope(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(&path, true)
        .map_err(|e| format!("allow_directory {path}: {e}"))
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

/// Returns (and creates if necessary) the single managed "Local Gallery" media folder.
/// Defaults to ~/Documents/Local Gallery (user-visible and local to the user).
/// Falls back to Pictures/Local Gallery.
#[tauri::command]
pub fn get_media_root(app: tauri::AppHandle) -> Result<String, String> {
    let base = app
        .path()
        .document_dir()
        .or_else(|_| app.path().picture_dir())
        .map_err(|e| format!("no user documents or pictures directory: {e}"))?;
    let dir = base.join("Local Gallery");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create media dir: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Best-effort one-time migration of metadata from the old external
/// app-support folder into the in-library location. Entry-level renames;
/// anything already present at the destination is left untouched (never
/// clobber newer in-place data).
fn migrate_metadata_dir(old: &Path, new: &Path) {
    let read = match std::fs::read_dir(old) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in read.flatten() {
        let to = new.join(entry.file_name());
        if to.exists() {
            continue;
        }
        let _ = std::fs::rename(entry.path(), &to);
    }
}

/// Returns (and creates) the metadata folder used for logs, catalog shards,
/// thumbs cache, etc. This lives INSIDE the media folder
/// (`<media>/.local-gallery`) so it travels with the library and is easy to
/// find. Metadata from the old external app-support location is migrated in
/// on first call.
#[tauri::command]
pub fn get_metadata_root(app: tauri::AppHandle) -> Result<String, String> {
    let media = PathBuf::from(get_media_root(app.clone())?);
    let dir = media.join(".local-gallery");
    std::fs::create_dir_all(&dir).map_err(|e| format!("create metadata dir: {e}"))?;
    if let Ok(app_data) = app.path().app_data_dir() {
        migrate_metadata_dir(&app_data.join("Local Gallery"), &dir);
    }
    // Ensure common subdirectories
    let _ = std::fs::create_dir_all(dir.join("catalog"));
    let _ = std::fs::create_dir_all(dir.join("thumbs"));
    Ok(dir.to_string_lossy().into_owned())
}

/// Reveal the given path in the OS file manager (Finder on macOS).
#[tauri::command]
pub fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| format!("open failed: {e}"))?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        // Fallback: try the opener plugin if available at runtime, else just return ok.
        // For now on other platforms we can just succeed silently or use opener later.
        Ok(())
    }
}









/// Native multi-file picker used by "Add content" (right-click a pane
/// background). Returns absolute paths; empty when the user cancels.
/// Async + spawn_blocking for the same main-thread reason as `pick_root`.
#[tauri::command]
pub async fn pick_import_files(app: tauri::AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_files()
            .map(|paths| {
                paths
                    .into_iter()
                    .filter_map(|p| p.into_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// Native multi-folder picker for "Add folders". Returns absolute paths;
/// empty when the user cancels. The dialog API can't mix files and folders in
/// one panel, hence the separate command.
#[tauri::command]
pub async fn pick_import_folders(app: tauri::AppHandle) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .blocking_pick_folders()
            .map(|paths| {
                paths
                    .into_iter()
                    .filter_map(|p| p.into_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default()
}

/// Pick a collision-free name in `dir`, mirroring the JS naming schemes:
/// files split the extension ("name (2).ext", uniqueDestNameInDir), folders
/// suffix the whole name ("name (2)", uniqueDirNameInParent).
fn unique_dest_path(dir: &Path, name: &str, is_dir: bool) -> PathBuf {
    let (base, ext) = if is_dir {
        (name, "")
    } else {
        match name.rfind('.') {
            Some(i) if i > 0 => (&name[..i], &name[i..]),
            _ => (name, ""),
        }
    };
    let mut candidate = dir.join(name);
    let mut n = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base} ({n}){ext}"));
        n += 1;
    }
    candidate
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| format!("mkdir {dest:?}: {e}"))?;
    let read = std::fs::read_dir(src).map_err(|e| format!("read_dir {src:?}: {e}"))?;
    for entry in read.flatten() {
        let from = entry.path();
        let to = dest.join(entry.file_name());
        let md = std::fs::metadata(&from).map_err(|e| format!("stat {from:?}: {e}"))?;
        if md.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to).map_err(|e| format!("copy {from:?}: {e}"))?;
        }
    }
    Ok(())
}

/// Move files or folders into `dest_dir` (rename, with copy+delete fallback
/// for cross-volume sources). Returns the created destination paths.
#[tauri::command]
pub async fn import_files(paths: Vec<String>, dest_dir: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        let dest = PathBuf::from(&dest_dir);
        if !dest.is_dir() {
            return Err(format!("destination is not a directory: {dest_dir}"));
        }
        let dest_canon = dest
            .canonicalize()
            .map_err(|e| format!("resolve {dest_dir}: {e}"))?;
        let mut out = Vec::new();
        for src_str in paths {
            let src = PathBuf::from(&src_str);
            let md =
                std::fs::metadata(&src).map_err(|e| format!("stat {src_str}: {e}"))?;
            let is_dir = md.is_dir();
            if is_dir {
                let src_canon = src
                    .canonicalize()
                    .map_err(|e| format!("resolve {src_str}: {e}"))?;
                if dest_canon.starts_with(&src_canon) {
                    return Err(format!("cannot move a folder into itself: {src_str}"));
                }
            }
            let name = src
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .ok_or_else(|| format!("no file name: {src_str}"))?;
            let target = unique_dest_path(&dest, &name, is_dir);
            if std::fs::rename(&src, &target).is_err() {
                if is_dir {
                    copy_dir_recursive(&src, &target)?;
                    std::fs::remove_dir_all(&src)
                        .map_err(|e| format!("remove {src_str}: {e}"))?;
                } else {
                    std::fs::copy(&src, &target).map_err(|e| format!("copy {src_str}: {e}"))?;
                    std::fs::remove_file(&src)
                        .map_err(|e| format!("remove {src_str}: {e}"))?;
                }
            }
            out.push(target.to_string_lossy().into_owned());
        }
        Ok(out)
    })
    .await
    .map_err(|e| format!("import task failed: {e}"))?
}

/// Remove a file or directory. Backs removeEntry({recursive}).
#[tauri::command]
pub async fn remove_path(path: String, recursive: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
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
    })
    .await
    .map_err(|e| format!("remove task failed: {e}"))?
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

        fn block<T>(f: impl std::future::Future<Output = T>) -> T {
            tauri::async_runtime::block_on(f)
        }

        // make_dir + touch + write + read
        let nested = dir.join(".local-gallery");
        make_dir(nested.to_string_lossy().into()).unwrap();
        let log = nested.join("x.log.json");
        touch_file(log.to_string_lossy().into()).unwrap();
        block(write_file_bytes(log.to_string_lossy().into(), b"{\"ok\":1}".to_vec())).unwrap();
        let back = block(read_file_bytes(log.to_string_lossy().into())).unwrap();
        assert_eq!(back, b"{\"ok\":1}");

        // scan_dir sees sub (dir) and a.txt (file, size 5)
        let listing = block(scan_dir(dir.to_string_lossy().into())).unwrap();
        assert!(listing.dirs.iter().any(|d| d == "sub"));
        let a = listing.files.iter().find(|f| f.name == "a.txt").unwrap();
        assert_eq!(a.size, 5);

        // path_kind + remove
        assert_eq!(path_kind(sub.to_string_lossy().into()), "dir");
        assert_eq!(path_kind(dir.join("a.txt").to_string_lossy().into()), "file");
        block(remove_path(sub.to_string_lossy().into(), true)).unwrap();
        assert_eq!(path_kind(sub.to_string_lossy().into()), "none");
    }

    #[test]
    fn import_moves_files_with_collision_safe_names() {
        let src_dir = std::env::temp_dir().join("lg-fs-import-src");
        let dest_dir = std::env::temp_dir().join("lg-fs-import-dest");
        let _ = std::fs::remove_dir_all(&src_dir);
        let _ = std::fs::remove_dir_all(&dest_dir);
        std::fs::create_dir_all(&src_dir).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(src_dir.join("a.txt"), b"one").unwrap();
        std::fs::write(dest_dir.join("b.txt"), b"existing").unwrap();
        std::fs::write(src_dir.join("b.txt"), b"two").unwrap();

        let imported = tauri::async_runtime::block_on(import_files(
            vec![
                src_dir.join("a.txt").to_string_lossy().into_owned(),
                src_dir.join("b.txt").to_string_lossy().into_owned(),
            ],
            dest_dir.to_string_lossy().into_owned(),
        ))
        .unwrap();

        assert_eq!(imported.len(), 2);
        // Sources are moved, not copied.
        assert!(!src_dir.join("a.txt").exists());
        assert!(!src_dir.join("b.txt").exists());
        assert_eq!(std::fs::read(dest_dir.join("a.txt")).unwrap(), b"one");
        // Collision resolves to "b (2).txt" and keeps the existing file.
        assert_eq!(std::fs::read(dest_dir.join("b.txt")).unwrap(), b"existing");
        assert_eq!(std::fs::read(dest_dir.join("b (2).txt")).unwrap(), b"two");
    }

    #[test]
    fn metadata_migration_moves_entries_without_clobbering() {
        let old = std::env::temp_dir().join("lg-fs-meta-old");
        let new = std::env::temp_dir().join("lg-fs-meta-new");
        let _ = std::fs::remove_dir_all(&old);
        let _ = std::fs::remove_dir_all(&new);
        std::fs::create_dir_all(old.join("thumbs")).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("folder-scores.log.json"), b"{\"old\":1}").unwrap();
        std::fs::write(old.join("preferences.log.json"), b"{\"old\":2}").unwrap();
        std::fs::write(old.join("thumbs/x.jpg"), b"jpg").unwrap();
        // Destination already has a (newer) preferences log — must be kept.
        std::fs::write(new.join("preferences.log.json"), b"{\"new\":3}").unwrap();

        migrate_metadata_dir(&old, &new);

        assert_eq!(
            std::fs::read(new.join("folder-scores.log.json")).unwrap(),
            b"{\"old\":1}"
        );
        assert_eq!(
            std::fs::read(new.join("preferences.log.json")).unwrap(),
            b"{\"new\":3}"
        );
        assert_eq!(std::fs::read(new.join("thumbs/x.jpg")).unwrap(), b"jpg");
        assert!(!old.join("folder-scores.log.json").exists());
        // The clobber-protected entry stays behind in the old location.
        assert!(old.join("preferences.log.json").exists());
    }

    #[test]
    fn import_moves_folders_recursively_and_rejects_self_nesting() {
        let src_dir = std::env::temp_dir().join("lg-fs-import-dir-src");
        let dest_dir = std::env::temp_dir().join("lg-fs-import-dir-dest");
        let _ = std::fs::remove_dir_all(&src_dir);
        let _ = std::fs::remove_dir_all(&dest_dir);
        std::fs::create_dir_all(src_dir.join("album/sub")).unwrap();
        std::fs::create_dir_all(&dest_dir).unwrap();
        std::fs::write(src_dir.join("album/a.jpg"), b"img").unwrap();
        std::fs::write(src_dir.join("album/sub/b.mp4"), b"vid").unwrap();
        // Collision: dest already has an "album" folder ("album (2)" expected,
        // whole-name suffix — no extension splitting for dirs).
        std::fs::create_dir_all(dest_dir.join("album")).unwrap();

        let imported = tauri::async_runtime::block_on(import_files(
            vec![src_dir.join("album").to_string_lossy().into_owned()],
            dest_dir.to_string_lossy().into_owned(),
        ))
        .unwrap();

        assert_eq!(imported.len(), 1);
        assert!(!src_dir.join("album").exists());
        let moved = dest_dir.join("album (2)");
        assert_eq!(std::fs::read(moved.join("a.jpg")).unwrap(), b"img");
        assert_eq!(std::fs::read(moved.join("sub/b.mp4")).unwrap(), b"vid");

        // Moving a folder into itself (or a descendant) must fail.
        let err = tauri::async_runtime::block_on(import_files(
            vec![dest_dir.to_string_lossy().into_owned()],
            dest_dir.to_string_lossy().into_owned(),
        ));
        assert!(err.is_err());
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
