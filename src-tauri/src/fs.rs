//! Native filesystem commands backing the File System Access API shim
//! (`tauri-fs-shim.js`). These replace the browser handle API the Electron
//! build relied on (`showDirectoryPicker`, dir/file handles, `createWritable`),
//! which doesn't exist in WKWebView.

use serde::Serialize;
use std::io::{Read, Seek, Write};
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

#[derive(Serialize)]
pub struct MetadataArchiveDoc {
    pub file_name: String,
    pub text: String,
}

#[derive(Serialize)]
pub struct MetadataArchiveImport {
    pub archive_path: String,
    pub thumbnail_cache_files: usize,
    pub docs: Vec<MetadataArchiveDoc>,
}

const METADATA_DOC_FILE_NAMES: &[&str] = &[
    "scores.log.json",
    "score-history.log.json",
    "daily-journals.log.json",
    "tags.log.json",
    "tag-albums.log.json",
    "trash.log.json",
    "custom-thumbnails.log.json",
    "aspect-ratios.log.json",
    "appearance-presets.log.json",
    "appearance-assignments.log.json",
    "preferences.general.log.json",
    "preferences.notifications.log.json",
    "preferences.appearance.log.json",
    "preferences.playback.log.json",
    "preferences.thumbnails.log.json",
    "preferences.filenames.log.json",
    "preferences.controls.log.json",
    "keyboard-configuration.log.json",
    "tabs.log.json",
];

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

fn sanitize_archive_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if (c as u32) < 0x20 => '_',
            c => c,
        })
        .collect();
    let cleaned = cleaned.trim().trim_end_matches('.').trim().to_string();
    if cleaned.is_empty() {
        "local-gallery-metadata.zip".to_string()
    } else if cleaned.to_ascii_lowercase().ends_with(".zip") {
        cleaned
    } else {
        format!("{cleaned}.zip")
    }
}

fn unique_archive_path(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !first.exists() {
        return first;
    }
    let stem = name.strip_suffix(".zip").unwrap_or(name);
    for n in 1..10000 {
        let candidate = dir.join(format!("{stem} ({n}).zip"));
        if !candidate.exists() {
            return candidate;
        }
    }
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    dir.join(format!("{stem}-{ts}.zip"))
}

fn metadata_doc_file_name(path: &str) -> Option<&'static str> {
    let normalized = path.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or("");
    METADATA_DOC_FILE_NAMES
        .iter()
        .copied()
        .find(|name| *name == base)
}

fn add_directory_to_zip<W: Write + Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &Path,
    archive_prefix: &str,
    options: zip::write::SimpleFileOptions,
    count: &mut usize,
) -> Result<(), String> {
    let read = match std::fs::read_dir(dir) {
        Ok(read) => read,
        Err(_) => return Ok(()),
    };
    let mut entries = read.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let archive_name = format!(
            "{}/{}",
            archive_prefix.trim_end_matches('/'),
            name.replace('\\', "/"),
        );
        let md = match std::fs::metadata(&path) {
            Ok(md) => md,
            Err(_) => continue,
        };
        if md.is_dir() {
            add_directory_to_zip(zip, &path, &archive_name, options, count)?;
        } else if md.is_file() {
            let bytes = std::fs::read(&path).map_err(|e| format!("read {path:?}: {e}"))?;
            zip.start_file(archive_name, options)
                .map_err(|e| format!("zip {path:?}: {e}"))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("write {path:?}: {e}"))?;
            *count += 1;
        }
    }
    Ok(())
}

fn thumbnail_cache_relative_path(path: &str) -> Option<PathBuf> {
    let normalized = path.replace('\\', "/");
    let parts = normalized
        .split('/')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>();
    let rel_parts = if parts.len() >= 3 && parts[0] == ".local-gallery" && parts[1] == "thumbs" {
        &parts[2..]
    } else if parts.len() >= 2 && parts[0] == "thumbs" {
        &parts[1..]
    } else {
        return None;
    };
    if rel_parts.is_empty() || rel_parts.iter().any(|part| *part == "." || *part == "..") {
        return None;
    }
    let mut rel = PathBuf::new();
    for part in rel_parts {
        rel.push(part);
    }
    Some(rel)
}

fn import_thumbnail_cache_entry(
    metadata_dir: &Path,
    rel_path: &Path,
    entry: &mut zip::read::ZipFile<'_>,
) -> Result<bool, String> {
    let thumbs_dir = metadata_dir.join("thumbs");
    let target = thumbs_dir.join(rel_path);
    if target.exists() {
        return Ok(false);
    }
    if entry.size() > 256 * 1024 * 1024 {
        return Err(format!("thumbnail cache file is too large: {rel_path:?}"));
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }
    let mut out = std::fs::File::create(&target).map_err(|e| format!("create {target:?}: {e}"))?;
    std::io::copy(entry, &mut out).map_err(|e| format!("copy {target:?}: {e}"))?;
    Ok(true)
}

/// Export the current library's metadata documents to Downloads as a zip. The
/// web layer passes the current root's `.local-gallery` path so advanced/browser
/// roots are named and exported relative to the active library, not the managed
/// fallback folder.
#[tauri::command]
pub async fn export_metadata_archive(
    app: tauri::AppHandle,
    metadata_dir: String,
    archive_file_name: String,
    root_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let meta_dir = PathBuf::from(&metadata_dir);
        if !meta_dir.is_dir() {
            return Err(format!("metadata folder is unavailable: {metadata_dir}"));
        }
        let downloads = app
            .path()
            .download_dir()
            .map_err(|e| format!("no downloads dir: {e}"))?;
        std::fs::create_dir_all(&downloads)
            .map_err(|e| format!("mkdir downloads: {e}"))?;
        let safe_name = sanitize_archive_name(&archive_file_name);
        let target = unique_archive_path(&downloads, &safe_name);
        let file =
            std::fs::File::create(&target).map_err(|e| format!("create archive: {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);

        let manifest = serde_json::json!({
            "schema": 1,
            "kind": "local-gallery-metadata-export",
            "rootName": root_name,
        });
        zip.start_file(".local-gallery/metadata-export.json", options)
            .map_err(|e| format!("write manifest: {e}"))?;
        zip.write_all(manifest.to_string().as_bytes())
            .map_err(|e| format!("write manifest bytes: {e}"))?;

        let mut exported = 0usize;
        let mut thumbnail_cache_files = 0usize;
        for file_name in METADATA_DOC_FILE_NAMES {
            let path = meta_dir.join(file_name);
            if !path.is_file() {
                continue;
            }
            let bytes = std::fs::read(&path).map_err(|e| format!("read {file_name}: {e}"))?;
            zip.start_file(format!(".local-gallery/{file_name}"), options)
                .map_err(|e| format!("zip {file_name}: {e}"))?;
            zip.write_all(&bytes)
                .map_err(|e| format!("write {file_name}: {e}"))?;
            exported += 1;
        }
        add_directory_to_zip(
            &mut zip,
            &meta_dir.join("thumbs"),
            ".local-gallery/thumbs",
            options,
            &mut thumbnail_cache_files,
        )?;
        if exported == 0 {
            return Err("no metadata documents found to export".to_string());
        }
        zip.finish().map_err(|e| format!("finish archive: {e}"))?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("export task failed: {e}"))?
}

/// Pick a metadata archive and read only the known metadata JSON documents from
/// it. Import merging stays in JS, where the current in-memory metadata model
/// can be combined before being saved back to whichever store is active.
#[tauri::command]
pub async fn pick_metadata_archive(
    app: tauri::AppHandle,
    metadata_dir: Option<String>,
) -> Result<Option<MetadataArchiveImport>, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<MetadataArchiveImport>, String> {
        let picked = app
            .dialog()
            .file()
            .add_filter("Zip archive", &["zip"])
            .blocking_pick_file();
        let Some(file_path) = picked.and_then(|p| p.into_path().ok()) else {
            return Ok(None);
        };
        let file = std::fs::File::open(&file_path).map_err(|e| format!("open archive: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("read archive: {e}"))?;
        let mut docs = Vec::new();
        let target_meta_dir = metadata_dir
            .as_deref()
            .map(str::trim)
            .filter(|path| !path.is_empty())
            .map(PathBuf::from);
        let mut thumbnail_cache_files = 0usize;
        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("read archive entry: {e}"))?;
            if entry.is_dir() {
                continue;
            }
            let name = entry.name().to_string();
            if let (Some(meta_dir), Some(rel_path)) =
                (target_meta_dir.as_deref(), thumbnail_cache_relative_path(&name))
            {
                if import_thumbnail_cache_entry(meta_dir, &rel_path, &mut entry)? {
                    thumbnail_cache_files += 1;
                }
                continue;
            }
            let Some(file_name) = metadata_doc_file_name(&name) else {
                continue;
            };
            if entry.size() > 256 * 1024 * 1024 {
                return Err(format!("metadata document is too large: {file_name}"));
            }
            let mut text = String::new();
            entry
                .read_to_string(&mut text)
                .map_err(|e| format!("read {file_name}: {e}"))?;
            docs.push(MetadataArchiveDoc {
                file_name: file_name.to_string(),
                text,
            });
        }
        Ok(Some(MetadataArchiveImport {
            archive_path: file_path.to_string_lossy().into_owned(),
            thumbnail_cache_files,
            docs,
        }))
    })
    .await
    .map_err(|e| format!("import task failed: {e}"))?
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
