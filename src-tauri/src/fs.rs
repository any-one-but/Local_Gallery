//! Native filesystem commands backing the File System Access API shim
//! (`tauri-fs-shim.js`). These replace the browser handle API the Electron
//! build relied on (`showDirectoryPicker`, dir/file handles, `createWritable`),
//! which doesn't exist in WKWebView.

use serde::Serialize;
use std::io::{Seek, Write};
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

/// The two names the managed library can have. The leading dot is the whole of
/// the "hidden" state: there is no flag stored anywhere, the folder's own name
/// is the truth, so renaming it by hand in Finder works as well as the toggle
/// does and the two can never disagree.
pub const MEDIA_FOLDER_NAME: &str = "Local Gallery";
pub const MEDIA_FOLDER_HIDDEN_NAME: &str = ".Local Gallery";

/// The folder the library sits in: ~/Documents, falling back to ~/Pictures.
fn media_root_base(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .document_dir()
        .or_else(|_| app.path().picture_dir())
        .map_err(|e| format!("no user documents or pictures directory: {e}"))
}

/// Windows has no dot-file convention, so the rename alone would hide nothing
/// there; set the real attribute as well. Everywhere else the dot is the whole
/// mechanism and this is a no-op.
#[allow(unused_variables)]
fn apply_platform_hidden_attribute(path: &Path, hidden: bool) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("attrib")
            .arg(if hidden { "+h" } else { "-h" })
            .arg(path)
            .status();
    }
}

/// Returns (and creates if necessary) the single managed "Local Gallery" media
/// folder. A hidden (dot-prefixed) library wins over a visible one, so the app
/// follows the folder wherever the toggle -- or the user -- last put it, and
/// never quietly creates a second empty library beside the real one.
#[tauri::command]
pub fn get_media_root(app: tauri::AppHandle) -> Result<String, String> {
    let base = media_root_base(&app)?;
    let hidden = base.join(MEDIA_FOLDER_HIDDEN_NAME);
    if hidden.is_dir() {
        return Ok(hidden.to_string_lossy().into_owned());
    }
    let dir = base.join(MEDIA_FOLDER_NAME);
    std::fs::create_dir_all(&dir).map_err(|e| format!("create media dir: {e}"))?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Is the managed library currently hidden from the OS?
#[tauri::command]
pub fn media_folder_is_hidden(app: tauri::AppHandle) -> Result<bool, String> {
    let base = media_root_base(&app)?;
    Ok(base.join(MEDIA_FOLDER_HIDDEN_NAME).is_dir())
}

/// Hide or reveal the managed library by renaming it, and return the path it
/// ended up at. Refuses when both names exist rather than picking a winner:
/// that would silently strand one of two real libraries.
#[tauri::command]
pub fn set_media_folder_hidden(app: tauri::AppHandle, hidden: bool) -> Result<String, String> {
    set_media_folder_hidden_at(&media_root_base(&app)?, hidden)
}

/// The rename itself, split out from the command so it can be tested against a
/// temp directory without an AppHandle.
pub fn set_media_folder_hidden_at(base: &Path, hidden: bool) -> Result<String, String> {
    let visible = base.join(MEDIA_FOLDER_NAME);
    let dotted = base.join(MEDIA_FOLDER_HIDDEN_NAME);
    let (from, to) = if hidden {
        (&visible, &dotted)
    } else {
        (&dotted, &visible)
    };
    if from.is_dir() && to.is_dir() {
        return Err(format!(
            "both \"{}\" and \"{}\" exist; combine them by hand first",
            MEDIA_FOLDER_NAME, MEDIA_FOLDER_HIDDEN_NAME
        ));
    }
    if from.is_dir() {
        std::fs::rename(from, to)
            .map_err(|e| format!("rename library {from:?} -> {to:?}: {e}"))?;
    } else if !to.is_dir() {
        // No library either way yet: make one under the wanted name.
        std::fs::create_dir_all(to).map_err(|e| format!("create media dir: {e}"))?;
    }
    apply_platform_hidden_attribute(to, hidden);
    Ok(to.to_string_lossy().into_owned())
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
        "local-gallery-logs.zip".to_string()
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

/// Text compresses well; the rest of `.local-gallery` is mostly thumbnails that
/// are already compressed images, where Deflate costs minutes and saves nothing.
fn zip_entry_is_compressible(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    [".json", ".log", ".txt", ".md", ".csv"]
        .iter()
        .any(|ext| lower.ends_with(ext))
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
            // Streamed, not read whole: the thumbnail cache and catalog can be large.
            let mut file =
                std::fs::File::open(&path).map_err(|e| format!("open {path:?}: {e}"))?;
            let entry_options = if zip_entry_is_compressible(&name) {
                options
            } else {
                options.compression_method(zip::CompressionMethod::Stored)
            };
            zip.start_file(archive_name, entry_options)
                .map_err(|e| format!("zip {path:?}: {e}"))?;
            std::io::copy(&mut file, &mut *zip)
                .map_err(|e| format!("write {path:?}: {e}"))?;
            *count += 1;
        }
    }
    Ok(())
}

/// Export the library's whole `.local-gallery` folder -- every log, the catalog
/// shards, the thumbnail cache, the passcode record -- to Downloads as one zip,
/// entries rooted at `.local-gallery/`. The web layer passes the active root's
/// metadata folder, so an advanced/browser root is exported rather than the
/// managed fallback. There is no import: the archive is a copy taken out.
#[tauri::command]
pub async fn export_metadata_archive(
    app: tauri::AppHandle,
    metadata_dir: String,
    archive_file_name: String,
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
        // Decide there is something to export BEFORE creating the file, so a
        // half-written .zip can never be left sitting in Downloads.
        let has_entries = std::fs::read_dir(&meta_dir)
            .map(|mut read| read.next().is_some())
            .unwrap_or(false);
        if !has_entries {
            return Err("the metadata folder is empty".to_string());
        }
        let safe_name = sanitize_archive_name(&archive_file_name);
        let target = unique_archive_path(&downloads, &safe_name);
        // Written under a hidden partial name and renamed only once complete, so
        // a zip that shows up in Downloads is always a finished one -- an export
        // cut off halfway (the app quit, a dev rebuild) leaves no fake archive.
        let partial = downloads.join(format!(
            ".{}.partial",
            target
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| safe_name.clone())
        ));
        let write = |target: &Path| -> Result<usize, String> {
            let file =
                std::fs::File::create(target).map_err(|e| format!("create archive: {e}"))?;
            let mut zip = zip::ZipWriter::new(file);
            // Deflated is the default for text; add_directory_to_zip switches each
            // already-compressed file to Stored.
            let options = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .unix_permissions(0o644)
                .large_file(true);
            let mut count = 0usize;
            add_directory_to_zip(&mut zip, &meta_dir, ".local-gallery", options, &mut count)?;
            zip.finish().map_err(|e| format!("finish archive: {e}"))?;
            Ok(count)
        };
        match write(&partial) {
            Ok(0) => {
                let _ = std::fs::remove_file(&partial);
                Err("no files found to export".to_string())
            }
            Ok(_) => {
                std::fs::rename(&partial, &target).map_err(|e| {
                    let _ = std::fs::remove_file(&partial);
                    format!("finish archive: {e}")
                })?;
                Ok(target.to_string_lossy().into_owned())
            }
            Err(err) => {
                let _ = std::fs::remove_file(&partial);
                Err(err)
            }
        }
    })
    .await
    .map_err(|e| format!("export task failed: {e}"))?
}

/// One day of the journal, as the web layer hands it over: a file name
/// (`2026-09-15.md`) and the day's markdown.
#[derive(serde::Deserialize)]
pub struct JournalExportEntry {
    pub file_name: String,
    pub text: String,
}

/// Writes `entries` as loose `.md` files inside one folder named `folder_name`,
/// zipped into `dir` under `archive_file_name`. Same guarantees as the log
/// export: refuses before touching disk when there is nothing to write, writes
/// under a hidden partial name and renames only once complete, never replaces
/// an archive already there.
fn write_journal_archive_at(
    dir: &Path,
    archive_file_name: &str,
    folder_name: &str,
    entries: &[JournalExportEntry],
) -> Result<PathBuf, String> {
    if entries.is_empty() {
        return Err("there are no journal entries to export".to_string());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("mkdir downloads: {e}"))?;
    let safe_name = sanitize_archive_name(archive_file_name);
    let target = unique_archive_path(dir, &safe_name);
    let folder = sanitize_archive_name(folder_name);
    let folder = folder.strip_suffix(".zip").unwrap_or(&folder).to_string();
    let partial = dir.join(format!(
        ".{}.partial",
        target
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| safe_name.clone())
    ));
    let write = || -> Result<(), String> {
        let file = std::fs::File::create(&partial)
            .map_err(|e| format!("create archive: {e}"))?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        let mut used = std::collections::HashSet::new();
        for entry in entries {
            let cleaned = sanitize_archive_name(&entry.file_name);
            let stem = cleaned.strip_suffix(".zip").unwrap_or(&cleaned);
            let stem = stem.strip_suffix(".md").unwrap_or(stem).to_string();
            let mut name = format!("{stem}.md");
            let mut n = 2;
            while !used.insert(name.clone()) {
                name = format!("{stem} {n}.md");
                n += 1;
            }
            zip.start_file(format!("{folder}/{name}"), options)
                .map_err(|e| format!("zip {name}: {e}"))?;
            zip.write_all(entry.text.as_bytes())
                .map_err(|e| format!("write {name}: {e}"))?;
        }
        zip.finish().map_err(|e| format!("finish archive: {e}"))?;
        Ok(())
    };
    if let Err(err) = write() {
        let _ = std::fs::remove_file(&partial);
        return Err(err);
    }
    std::fs::rename(&partial, &target).map_err(|e| {
        let _ = std::fs::remove_file(&partial);
        format!("finish archive: {e}")
    })?;
    Ok(target)
}

/// Settings -> Export journal: every journal day as its own `.md` file, loose
/// in one folder, zipped into Downloads and named the way Export logs names its
/// archive.
#[tauri::command]
pub async fn export_journal_archive(
    app: tauri::AppHandle,
    entries: Vec<JournalExportEntry>,
    archive_file_name: String,
    folder_name: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let downloads = app
            .path()
            .download_dir()
            .map_err(|e| format!("no downloads dir: {e}"))?;
        write_journal_archive_at(&downloads, &archive_file_name, &folder_name, &entries)
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("export task failed: {e}"))?
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
    fn journal_archive_holds_one_loose_md_per_day() {
        let dir = std::env::temp_dir().join("lg-journal-export-test");
        let _ = std::fs::remove_dir_all(&dir);
        let entries = vec![
            JournalExportEntry { file_name: "2026-09-14.md".into(), text: "# Mon\nhello".into() },
            JournalExportEntry { file_name: "2026-09-15.md".into(), text: "tue".into() },
        ];
        let path = write_journal_archive_at(&dir, "260915-120000 - Lib journal.zip", "260915-120000 - Lib journal", &entries).unwrap();
        assert!(path.ends_with("260915-120000 - Lib journal.zip"));
        let mut zip = zip::ZipArchive::new(std::fs::File::open(&path).unwrap()).unwrap();
        let mut names: Vec<String> = (0..zip.len()).map(|i| zip.by_index(i).unwrap().name().to_string()).collect();
        names.sort();
        assert_eq!(names, vec![
            "260915-120000 - Lib journal/2026-09-14.md".to_string(),
            "260915-120000 - Lib journal/2026-09-15.md".to_string(),
        ]);
        let mut text = String::new();
        std::io::Read::read_to_string(&mut zip.by_name("260915-120000 - Lib journal/2026-09-14.md").unwrap(), &mut text).unwrap();
        assert_eq!(text, "# Mon\nhello");
        // No partial file left behind; a second export never replaces the first.
        let again = write_journal_archive_at(&dir, "260915-120000 - Lib journal.zip", "x", &entries).unwrap();
        assert!(again.ends_with("260915-120000 - Lib journal (1).zip"));
        assert!(std::fs::read_dir(&dir).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().ends_with(".partial")));
        // Nothing to export: refused, nothing written.
        assert!(write_journal_archive_at(&dir, "empty.zip", "empty", &[]).is_err());
        assert!(!dir.join("empty.zip").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn media_folder_hide_and_show_round_trip() {
        let base = std::env::temp_dir().join("lg-hide-test");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let visible = base.join(MEDIA_FOLDER_NAME);
        let dotted = base.join(MEDIA_FOLDER_HIDDEN_NAME);

        // A library with something in it, so the rename is seen to carry it.
        std::fs::create_dir_all(visible.join(".local-gallery")).unwrap();
        std::fs::write(visible.join(".local-gallery/scores.log.json"), b"{}").unwrap();

        let to = set_media_folder_hidden_at(&base, true).unwrap();
        assert_eq!(to, dotted.to_string_lossy());
        assert!(dotted.is_dir() && !visible.exists());
        assert!(dotted.join(".local-gallery/scores.log.json").is_file());

        // Asking again for a state it is already in is a no-op, not an error.
        set_media_folder_hidden_at(&base, true).unwrap();
        assert!(dotted.is_dir() && !visible.exists());

        let back = set_media_folder_hidden_at(&base, false).unwrap();
        assert_eq!(back, visible.to_string_lossy());
        assert!(visible.is_dir() && !dotted.exists());
        assert!(visible.join(".local-gallery/scores.log.json").is_file());

        // Two real libraries: refuse rather than pick a winner.
        std::fs::create_dir_all(&dotted).unwrap();
        assert!(set_media_folder_hidden_at(&base, true).is_err());
        assert!(set_media_folder_hidden_at(&base, false).is_err());
        assert!(visible.is_dir() && dotted.is_dir());

        let _ = std::fs::remove_dir_all(&base);
    }

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
