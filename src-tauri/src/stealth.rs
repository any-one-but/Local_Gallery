//! Stealth mode: the managed library lives inside an encrypted, hidden disk
//! image instead of a plain folder.
//!
//! The shape of the feature comes from one requirement -- locked, the content
//! must be unintelligible; unlocked, it must look like an ordinary folder in
//! Finder. A per-file encryption scheme gets the first and loses the second,
//! and would also have to rewrite the whole library on every lock. An encrypted
//! APFS sparse bundle gets both: macOS encrypts at the block level, so
//! attaching and ejecting are instant whatever the library weighs, and while it
//! is attached the files are simply files.
//!
//! **Nothing is stored to say whether stealth is on.** The image either exists
//! or it does not, exactly as the hidden-folder toggle uses the leading dot, so
//! the state cannot drift from the truth on disk.
//!
//! The image is `.Local Gallery.sparsebundle` (dot-prefixed, so Finder does not
//! show it) and it is attached at `<base>/Local Gallery` -- the same path the
//! plain library used, which is what makes it look unchanged when unlocked.
//! Ejecting removes that mount point, so a locked machine shows nothing at all.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::Manager;

/// Dot-prefixed so the image itself is invisible in Finder.
pub const IMAGE_NAME: &str = ".Local Gallery.sparsebundle";
/// The safety copy taken before the library is moved into the image. Also
/// dot-prefixed: it is a backup, not something to trip over.
pub const BACKUP_NAME: &str = ".Local Gallery (copy before Stealth)";
/// The plaintext copy left behind when stealth is turned off again.
pub const OLD_IMAGE_NAME: &str = ".Local Gallery (image before Stealth off).sparsebundle";
/// Sparse bundles only occupy what they hold, so the ceiling can be generous.
const IMAGE_MAX_SIZE: &str = "2t";
const KEY_FILE_NAME: &str = "stealth-key.txt";

#[derive(Serialize, Clone)]
pub struct StealthStatus {
    pub enabled: bool,
    pub mounted: bool,
    pub image_path: String,
    pub mount_point: String,
    pub backup_path: String,
    pub backup_exists: bool,
}

pub fn image_path(base: &Path) -> PathBuf {
    base.join(IMAGE_NAME)
}

pub fn mount_point(base: &Path) -> PathBuf {
    base.join(crate::fs::MEDIA_FOLDER_NAME)
}

pub fn backup_path(base: &Path) -> PathBuf {
    base.join(BACKUP_NAME)
}

/// Stealth is on when the image exists. A sparse bundle is a directory.
pub fn stealth_enabled(base: &Path) -> bool {
    image_path(base).is_dir()
}

/// Is `path` the root of a mounted filesystem? A mount point sits on a
/// different device from the directory that contains it, which needs no extra
/// dependency to check.
pub fn path_is_mount_point(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let here = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    // A path with no parent is the filesystem root, which is always a mount.
    let parent = match path.parent() {
        Some(p) => match std::fs::metadata(p) {
            Ok(m) => m,
            Err(_) => return false,
        },
        None => return true,
    };
    here.dev() != parent.dev()
}

/* --- The image password -------------------------------------------------- */

/// Where the image's password is kept. It lives in the app's own config
/// directory rather than beside the library, so copying the library folder off
/// the machine copies nothing that can open it.
fn key_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config: {e}"))?;
    Ok(dir.join(KEY_FILE_NAME))
}

fn random_key() -> String {
    // 32 bytes of OS randomness, hex encoded. getrandom via std is not exposed,
    // so read the system source directly -- available on every unix we build for.
    let mut bytes = [0u8; 32];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read_exact(&mut bytes);
    }
    // Mix in time and pid so a failed read can never yield an all-zero key.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id() as u128;
    for (i, b) in bytes.iter_mut().enumerate() {
        let mixed = (now >> (i % 16)) ^ (pid << (i % 8));
        *b ^= (mixed & 0xff) as u8;
    }
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn read_key(app: &tauri::AppHandle) -> Result<String, String> {
    let f = key_file(app)?;
    let s = std::fs::read_to_string(&f).map_err(|e| format!("read stealth key: {e}"))?;
    let s = s.trim().to_string();
    if s.is_empty() {
        return Err("the stealth key file is empty".into());
    }
    Ok(s)
}

/// The key is written once and never rotated: rotating it would mean rebuilding
/// the whole image.
fn ensure_key(app: &tauri::AppHandle) -> Result<String, String> {
    if let Ok(existing) = read_key(app) {
        return Ok(existing);
    }
    let key = random_key();
    let f = key_file(app)?;
    std::fs::write(&f, key.as_bytes()).map_err(|e| format!("write stealth key: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&f, std::fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

/* --- Driving diskutil ----------------------------------------------------- */

/// Run a `diskutil image` subcommand, handing the passphrase over on stdin so
/// it never appears in the process list.
fn diskutil(args: &[&str], passphrase: Option<&str>) -> Result<String, String> {
    let mut cmd = Command::new("diskutil");
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("run diskutil: {e}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        if let Some(p) = passphrase {
            let _ = stdin.write_all(p.as_bytes());
        }
    }
    drop(child.stdin.take());
    let out = child
        .wait_with_output()
        .map_err(|e| format!("diskutil failed: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let joined = if err.is_empty() { msg } else { err };
        return Err(if joined.is_empty() {
            "diskutil reported a failure".to_string()
        } else {
            joined
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Attach the image at the library's usual path. A no-op when it is already
/// there, so callers never have to check first.
pub fn mount_image(app: &tauri::AppHandle, base: &Path) -> Result<PathBuf, String> {
    mount_image_with_key(&read_key(app)?, base)
}

pub fn mount_image_with_key(key: &str, base: &Path) -> Result<PathBuf, String> {
    let mp = mount_point(base);
    if path_is_mount_point(&mp) {
        return Ok(mp);
    }
    if mp.exists() && std::fs::read_dir(&mp).map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err(format!(
            "{mp:?} already exists and is not empty; move it aside before unlocking"
        ));
    }
    let img = image_path(base);
    diskutil(
        &[
            "image",
            "attach",
            "--stdinpassphrase",
            "--mountPoint",
            &mp.to_string_lossy(),
            &img.to_string_lossy(),
        ],
        Some(key),
    )?;
    Ok(mp)
}

/// Eject the image. Ejecting also removes the mount point directory, which is
/// what leaves nothing at all behind for someone browsing Documents.
pub fn unmount_image(base: &Path) -> Result<(), String> {
    let mp = mount_point(base);
    if !path_is_mount_point(&mp) {
        return Ok(());
    }
    diskutil(&["eject", &mp.to_string_lossy()], None).map(|_| ())
}

/* --- Copying the library in and out --------------------------------------- */

/// `ditto` rather than a hand-rolled walk: it is Apple's own copier and keeps
/// modification times, permissions and extended attributes, which the gallery
/// reads (sort by date is a modification time).
fn ditto(from: &Path, to: &Path) -> Result<(), String> {
    let out = Command::new("ditto")
        .arg(from)
        .arg(to)
        .output()
        .map_err(|e| format!("run ditto: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "copy {from:?} -> {to:?}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}

/// Bookkeeping macOS puts at the root of a fresh volume. It is not library
/// content: it appears in the image that a copy created, and it must not be
/// carried back out into a plain folder when stealth is switched off.
pub const VOLUME_HOUSEKEEPING: [&str; 5] = [
    ".fseventsd",
    ".Trashes",
    ".TemporaryItems",
    ".Spotlight-V100",
    ".DocumentRevisions-V100",
];

fn is_volume_housekeeping(rel: &Path, name: &std::ffi::OsStr) -> bool {
    rel.as_os_str().is_empty() && VOLUME_HOUSEKEEPING.iter().any(|h| name == *h)
}

/// Every file under `src` must exist under `dst` at the same size. Deliberately
/// one-directional: a freshly created volume legitimately holds more than was
/// copied into it, and what matters is that nothing of the library is missing
/// or truncated. Returns how many files were checked.
pub fn verify_copy(src: &Path, dst: &Path) -> Result<u64, String> {
    let mut checked = 0u64;
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        let dir = src.join(&rel);
        let read = std::fs::read_dir(&dir).map_err(|e| format!("read {dir:?}: {e}"))?;
        for entry in read.flatten() {
            let name = entry.file_name();
            if is_volume_housekeeping(&rel, &name) {
                continue;
            }
            // symlink_metadata: a link is copied as a link, and following one
            // would either double-count or fail on a broken link.
            let meta = match entry.path().symlink_metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let child = rel.join(&name);
            if meta.is_dir() {
                stack.push(child);
            } else if meta.is_file() {
                let there = dst.join(&child);
                let landed = there
                    .symlink_metadata()
                    .map_err(|_| format!("{} did not arrive", child.display()))?;
                if landed.len() != meta.len() {
                    return Err(format!(
                        "{} arrived the wrong size ({} of {} bytes)",
                        child.display(),
                        landed.len(),
                        meta.len()
                    ));
                }
                checked += 1;
            }
        }
    }
    Ok(checked)
}

/// Remove the volume's own bookkeeping from a folder copied out of an image.
fn strip_volume_housekeeping(dir: &Path) {
    for name in VOLUME_HOUSEKEEPING {
        let p = dir.join(name);
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(&p);
        } else if p.exists() {
            let _ = std::fs::remove_file(&p);
        }
    }
}

/// (file count, total bytes) for a tree. Only the round-trip test needs it now
/// that verification is per file rather than by totals.
#[cfg(test)]
pub fn tree_stats(path: &Path) -> (u64, u64) {
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let read = match std::fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(entry.path());
            } else if meta.is_file() {
                files += 1;
                bytes += meta.len();
            }
        }
    }
    (files, bytes)
}

/// A path that does not exist yet, by adding " 2", " 3", ... if it does. Used
/// for the safety copies, which must never overwrite an earlier one.
fn free_path(candidate: PathBuf) -> PathBuf {
    if !candidate.exists() {
        return candidate;
    }
    let parent = candidate.parent().map(|p| p.to_path_buf()).unwrap_or_default();
    let name = candidate
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "item".to_string());
    for n in 2..1000 {
        let next = parent.join(format!("{name} {n}"));
        if !next.exists() {
            return next;
        }
    }
    candidate
}

/* --- Turning it on and off ------------------------------------------------ */

/// Where the plain library currently sits: visible, or hidden by the dot
/// toggle. `None` when there is no plain library at all.
fn existing_plain_library(base: &Path) -> Option<PathBuf> {
    let visible = base.join(crate::fs::MEDIA_FOLDER_NAME);
    if visible.is_dir() && !path_is_mount_point(&visible) {
        return Some(visible);
    }
    let hidden = base.join(crate::fs::MEDIA_FOLDER_HIDDEN_NAME);
    if hidden.is_dir() {
        return Some(hidden);
    }
    None
}

/// Move the library into a fresh encrypted image and attach it.
///
/// **Nothing is ever deleted.** The original folder is renamed aside as a
/// hidden safety copy and left there; removing it is the user's call, made once
/// they have seen the library open normally out of the image.
pub fn enable(app: &tauri::AppHandle, base: &Path) -> Result<StealthStatus, String> {
    let key = ensure_key(app)?;
    enable_with_key(&key, base)
}

pub fn enable_with_key(key: &str, base: &Path) -> Result<StealthStatus, String> {
    if stealth_enabled(base) {
        return status_of(base);
    }
    let img = image_path(base);
    let mp = mount_point(base);

    // The source has to move out of the way first: it may be sitting on the
    // exact path the image is about to be attached at. A rename is instant and
    // loses nothing if a later step fails.
    let source = existing_plain_library(base);
    let backup = match &source {
        Some(src) => {
            let dest = free_path(backup_path(base));
            std::fs::rename(src, &dest)
                .map_err(|e| format!("set the library aside ({src:?} -> {dest:?}): {e}"))?;
            Some(dest)
        }
        None => None,
    };


    let finish = |img: &Path, backup: &Option<PathBuf>, err: String| -> String {
        // Put the library back exactly where it was before giving up.
        let _ = unmount_image(base);
        let _ = std::fs::remove_dir_all(img);
        if let (Some(b), Some(src)) = (backup, source.as_ref()) {
            let _ = std::fs::rename(b, src);
        }
        err
    };

    if let Err(e) = diskutil(
        &[
            "image",
            "create",
            "blank",
            "--encrypt",
            "--stdinpassphrase",
            "--size",
            IMAGE_MAX_SIZE,
            "--volumeName",
            crate::fs::MEDIA_FOLDER_NAME,
            "--fs",
            "APFS",
            &img.to_string_lossy(),
        ],
        Some(key),
    ) {
        return Err(finish(&img, &backup, format!("create the encrypted image: {e}")));
    }

    if let Err(e) = mount_image_with_key(key, base) {
        return Err(finish(&img, &backup, format!("open the encrypted image: {e}")));
    }

    if let Some(b) = &backup {
        // ditto copies the *contents* of the source into the destination.
        if let Err(e) = ditto(b, &mp) {
            return Err(finish(&img, &backup, e));
        }
        if let Err(e) = verify_copy(b, &mp) {
            return Err(finish(
                &img,
                &backup,
                format!("the copy did not land whole — {e}. Nothing was removed."),
            ));
        }
    }
    status_of(base)
}

/// Copy the library back out to a plain folder and stand the image down.
/// The image is kept, renamed aside, for the same reason the safety copy is.
pub fn disable(app: &tauri::AppHandle, base: &Path) -> Result<StealthStatus, String> {
    let key = read_key(app)?;
    disable_with_key(&key, base)
}

pub fn disable_with_key(key: &str, base: &Path) -> Result<StealthStatus, String> {
    if !stealth_enabled(base) {
        return status_of(base);
    }
    let mp = mount_image_with_key(key, base)?;

    let staging = free_path(base.join(".Local Gallery (restoring)"));
    std::fs::create_dir_all(&staging).map_err(|e| format!("make a place to copy to: {e}"))?;
    if let Err(e) = ditto(&mp, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(e);
    }
    strip_volume_housekeeping(&staging);
    if let Err(e) = verify_copy(&mp, &staging) {
        let _ = std::fs::remove_dir_all(&staging);
        return Err(format!(
            "the copy out did not land whole — {e}. The encrypted library is untouched."
        ));
    }

    // Only now is it safe to give up the mount point: ejecting frees the path
    // the plain library is about to take.
    unmount_image(base)?;
    let plain = free_path(base.join(crate::fs::MEDIA_FOLDER_NAME));
    std::fs::rename(&staging, &plain)
        .map_err(|e| format!("put the library back ({staging:?} -> {plain:?}): {e}"))?;
    let retired = free_path(base.join(OLD_IMAGE_NAME));
    std::fs::rename(image_path(base), &retired)
        .map_err(|e| format!("set the old image aside: {e}"))?;
    status_of(base)
}

pub fn status(app: &tauri::AppHandle, base: &Path) -> Result<StealthStatus, String> {
    let _ = app;
    status_of(base)
}

pub fn status_of(base: &Path) -> Result<StealthStatus, String> {
    let mp = mount_point(base);
    let backup = backup_path(base);
    Ok(StealthStatus {
        enabled: stealth_enabled(base),
        mounted: path_is_mount_point(&mp),
        image_path: image_path(base).to_string_lossy().into_owned(),
        mount_point: mp.to_string_lossy().into_owned(),
        backup_exists: backup.is_dir(),
        backup_path: backup.to_string_lossy().into_owned(),
    })
}

/* --- Commands ------------------------------------------------------------- */

fn base_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    crate::fs::media_root_base(app)
}

#[tauri::command]
pub fn stealth_status(app: tauri::AppHandle) -> Result<StealthStatus, String> {
    let base = base_dir(&app)?;
    status(&app, &base)
}

#[tauri::command]
pub async fn stealth_mount(app: tauri::AppHandle) -> Result<StealthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_dir(&app)?;
        if !stealth_enabled(&base) {
            return status(&app, &base);
        }
        mount_image(&app, &base)?;
        status(&app, &base)
    })
    .await
    .map_err(|e| format!("mount task failed: {e}"))?
}

#[tauri::command]
pub async fn stealth_unmount(app: tauri::AppHandle) -> Result<StealthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_dir(&app)?;
        unmount_image(&base)?;
        status(&app, &base)
    })
    .await
    .map_err(|e| format!("unmount task failed: {e}"))?
}

#[tauri::command]
pub async fn stealth_enable(app: tauri::AppHandle) -> Result<StealthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_dir(&app)?;
        enable(&app, &base)
    })
    .await
    .map_err(|e| format!("enable task failed: {e}"))?
}

#[tauri::command]
pub async fn stealth_disable(app: tauri::AppHandle) -> Result<StealthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = base_dir(&app)?;
        disable(&app, &base)
    })
    .await
    .map_err(|e| format!("disable task failed: {e}"))?
}

/// The image's password, so it can be written down. Losing it with the key file
/// means losing the library, so the app shows it once on the way in.
#[tauri::command]
pub fn stealth_recovery_key(app: tauri::AppHandle) -> Result<String, String> {
    read_key(&app)
}

/// Eject on the way out of the app, so quitting locks the library. Best effort:
/// a failure here must never stop the app from closing.
pub fn unmount_on_exit(app: &tauri::AppHandle) {
    if let Ok(base) = base_dir(app) {
        if stealth_enabled(&base) {
            let _ = unmount_image(&base);
        }
    }
}

/* --- Small config-dir documents ------------------------------------------- */

/// With stealth on, the passcode record cannot live in the library: the library
/// is inside the image, and the passcode is what decides whether the image may
/// be opened at all. These two keep it in the app's own config directory
/// instead, which is reachable before anything is attached.
fn config_doc_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let safe: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || safe.contains("..") {
        return Err("bad config document name".into());
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir config: {e}"))?;
    Ok(dir.join(safe))
}

#[tauri::command]
pub fn read_app_config_text(app: tauri::AppHandle, name: String) -> Option<String> {
    let p = config_doc_path(&app, &name).ok()?;
    std::fs::read_to_string(p).ok()
}

#[tauri::command]
pub fn write_app_config_text(
    app: tauri::AppHandle,
    name: String,
    text: String,
) -> Result<(), String> {
    let p = config_doc_path(&app, &name)?;
    std::fs::write(&p, text.as_bytes()).map_err(|e| format!("write {p:?}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole migration, against real encrypted disk images. Ignored by
    /// default because it attaches volumes and takes a few seconds; run with
    /// `cargo test -- --ignored stealth`. This is the test that matters: it is
    /// the only one that can catch the library being lost on the way in or out.
    #[test]
    #[ignore]
    fn the_library_survives_a_full_trip_into_the_image_and_back() {
        let base = std::env::temp_dir().join("lg-stealth-roundtrip");
        let _ = unmount_image(&base);
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        let key = "test-key-not-a-real-one-0123456789";

        // A library with nested folders, a dotfile, a unicode name and metadata.
        let lib = base.join(crate::fs::MEDIA_FOLDER_NAME);
        std::fs::create_dir_all(lib.join("Holiday 2019/raw")).unwrap();
        std::fs::create_dir_all(lib.join(".local-gallery")).unwrap();
        std::fs::write(lib.join("Holiday 2019/one.jpg"), vec![7u8; 4096]).unwrap();
        std::fs::write(lib.join("Holiday 2019/raw/two.arw"), vec![9u8; 1024]).unwrap();
        std::fs::write(lib.join("Ünïcode — name.png"), b"pixels").unwrap();
        std::fs::write(lib.join(".local-gallery/scores.log.json"), b"{\"a\":1}").unwrap();
        let before = tree_stats(&lib);
        assert_eq!(before.0, 4);

        // In.
        let st = enable_with_key(key, &base).expect("enable");
        assert!(st.enabled && st.mounted);
        let mp = mount_point(&base);
        assert!(path_is_mount_point(&mp));
        assert_eq!(verify_copy(&backup_path(&base), &mp).unwrap(), 4);
        assert_eq!(
            std::fs::read(mp.join("Holiday 2019/raw/two.arw")).unwrap(),
            vec![9u8; 1024]
        );
        assert_eq!(
            std::fs::read_to_string(mp.join(".local-gallery/scores.log.json")).unwrap(),
            "{\"a\":1}"
        );
        // The safety copy is kept, and it is hidden.
        assert!(backup_path(&base).is_dir());
        assert_eq!(tree_stats(&backup_path(&base)), before);

        // Locked: eject, and the folder is gone entirely.
        unmount_image(&base).expect("eject");
        assert!(!mp.exists(), "the mount point must not survive ejecting");
        assert!(image_path(&base).is_dir());

        // The bytes are not readable in the bundle.
        let mut found = false;
        let mut stack = vec![image_path(&base)];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                if e.metadata().map(|m| m.is_dir()).unwrap_or(false) {
                    stack.push(e.path());
                } else if let Ok(bytes) = std::fs::read(e.path()) {
                    if bytes.windows(64).any(|w| w.iter().all(|b| *b == 9u8)) {
                        found = true;
                    }
                }
            }
        }
        assert!(!found, "file contents leaked into the encrypted bundle");

        // Back out.
        let st = disable_with_key(key, &base).expect("disable");
        assert!(!st.enabled && !st.mounted);
        let plain = base.join(crate::fs::MEDIA_FOLDER_NAME);
        assert!(plain.is_dir() && !path_is_mount_point(&plain));
        // Back to exactly what went in: the volume's own bookkeeping is dropped.
        assert_eq!(tree_stats(&plain), before);
        for name in VOLUME_HOUSEKEEPING {
            assert!(!plain.join(name).exists(), "{name} was carried back out");
        }
        assert_eq!(
            std::fs::read(plain.join("Holiday 2019/one.jpg")).unwrap(),
            vec![7u8; 4096]
        );
        assert!(plain.join("Ünïcode — name.png").is_file());
        // The image is retired, not deleted.
        assert!(!image_path(&base).exists());
        assert!(base.join(OLD_IMAGE_NAME).is_dir());

        let _ = unmount_image(&base);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn tree_stats_counts_files_and_bytes_recursively() {
        let dir = std::env::temp_dir().join("lg-stealth-stats");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("a/b")).unwrap();
        std::fs::write(dir.join("one.txt"), b"12345").unwrap();
        std::fs::write(dir.join("a/two.txt"), b"123").unwrap();
        std::fs::write(dir.join("a/b/three.txt"), b"1").unwrap();
        assert_eq!(tree_stats(&dir), (3, 9));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn free_path_never_overwrites_an_existing_safety_copy() {
        let dir = std::env::temp_dir().join("lg-stealth-free");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let first = dir.join("copy");
        assert_eq!(free_path(first.clone()), first);
        std::fs::create_dir_all(&first).unwrap();
        assert_eq!(free_path(first.clone()), dir.join("copy 2"));
        std::fs::create_dir_all(dir.join("copy 2")).unwrap();
        assert_eq!(free_path(first), dir.join("copy 3"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_plain_directory_is_not_a_mount_point() {
        let dir = std::env::temp_dir().join("lg-stealth-mount");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!path_is_mount_point(&dir));
        assert!(!path_is_mount_point(&dir.join("nope")));
        // The volume root genuinely is one.
        assert!(path_is_mount_point(Path::new("/")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stealth_is_on_exactly_when_the_image_exists() {
        let base = std::env::temp_dir().join("lg-stealth-enabled");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        assert!(!stealth_enabled(&base));
        std::fs::create_dir_all(image_path(&base)).unwrap();
        assert!(stealth_enabled(&base));
        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn the_plain_library_is_found_under_either_name() {
        let base = std::env::temp_dir().join("lg-stealth-plain");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).unwrap();
        assert!(existing_plain_library(&base).is_none());
        let hidden = base.join(crate::fs::MEDIA_FOLDER_HIDDEN_NAME);
        std::fs::create_dir_all(&hidden).unwrap();
        assert_eq!(existing_plain_library(&base), Some(hidden));
        let visible = base.join(crate::fs::MEDIA_FOLDER_NAME);
        std::fs::create_dir_all(&visible).unwrap();
        // Visible wins: it is the one the app would have opened.
        assert_eq!(existing_plain_library(&base), Some(visible));
        let _ = std::fs::remove_dir_all(&base);
    }
}
