// The native commands the page calls through `window.__TAURI__.core.invoke`.
//
// The page, tauri-bridge.js and tauri-fs-shim.js were written against the
// Tauri (Rust) app, and they are loaded here unchanged: this file answers the
// same command names with the same argument and result shapes, so nothing in
// the page has to know it now runs on Chromium instead of WebKit. The Rust
// originals live in src-tauri/src/*.rs; each function below names the one it
// mirrors where the behaviour is worth comparing.

"use strict";

const { app, dialog, shell } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const { devMode } = require("./dev");
const media = require("./media");
const session = require("./session");

// --- helpers ---------------------------------------------------------------

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// ffmpeg exits non-zero for `-i file` with no output; the probe wants its
// stderr either way.
function runAllowingFailure(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || "", stderr: stderr || "", failed: !!err });
    });
  });
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

function configFile(name) {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

// Mirrors sanitize_download_name / sanitize_archive_name.
function sanitizeName(name, fallback) {
  const base = String(name || "").trim() || fallback;
  let cleaned = base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  cleaned = cleaned.trim().replace(/\.+$/, "").trim();
  return cleaned || fallback;
}

function sanitizeArchiveName(name) {
  const cleaned = sanitizeName(name, "local-gallery-logs.zip");
  return cleaned.toLowerCase().endsWith(".zip") ? cleaned : `${cleaned}.zip`;
}

// "name (1).ext", like Finder. Mirrors unique_download_path / unique_archive_path.
function uniquePath(dir, name) {
  const first = path.join(dir, name);
  if (!exists(first)) return first;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; n < 10000; n++) {
    const candidate = path.join(dir, `${stem} (${n})${ext}`);
    if (!exists(candidate)) return candidate;
  }
  return path.join(dir, `${stem}-${Date.now()}${ext}`);
}

// Mirrors unique_dest_path: files split the extension, folders suffix the name.
function uniqueDestPath(dir, name, isDirectory) {
  const dot = name.lastIndexOf(".");
  const base = !isDirectory && dot > 0 ? name.slice(0, dot) : name;
  const ext = !isDirectory && dot > 0 ? name.slice(dot) : "";
  let candidate = path.join(dir, name);
  let n = 2;
  while (exists(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

// --- ffmpeg ----------------------------------------------------------------

let FFMPEG = undefined;

// The copy packaged with the app, else ffmpeg-static in development, else a
// system install. A GUI app's PATH is minimal, so the usual places are named.
function findFfmpeg() {
  if (FFMPEG !== undefined) return FFMPEG;
  const candidates = [];
  if (app.isPackaged) candidates.push(path.join(process.resourcesPath, "ffmpeg"));
  try {
    candidates.push(require("ffmpeg-static"));
  } catch {}
  candidates.push(
    "/opt/homebrew/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/usr/bin/ffmpeg",
    "/opt/local/bin/ffmpeg",
  );
  FFMPEG = candidates.find((p) => p && exists(p)) || null;
  if (devMode()) console.error(`[lg] ffmpeg: ${FFMPEG}`);
  return FFMPEG;
}

// Mirrors parse_ffmpeg_video_timing.
function parseVideoTiming(stderr) {
  let duration = 0;
  let frameRate = 0;
  for (const line of String(stderr || "").split("\n")) {
    if (duration <= 0) {
      const m = line.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
      if (m) duration = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    if (frameRate <= 0 && line.includes("Video:")) {
      const m = line.match(/([\d.]+)\s+fps/);
      if (m) frameRate = Number(m[1]) || 0;
    }
  }
  return {
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    frame_rate:
      Number.isFinite(frameRate) && frameRate > 0 ? Math.min(480, Math.max(1, frameRate)) : 0,
  };
}

// --- thumbnails ------------------------------------------------------------

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "ico", "avif", "heic"]);

// Bounds concurrent thumbnail work so a big folder does not start one ffmpeg
// per tile at once. Sized to the machine, clamped to [2, 6], as in lib.rs.
const THUMB_LIMIT = Math.min(6, Math.max(2, os.cpus().length));
let thumbActive = 0;
const thumbQueue = [];

function withThumbSlot(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      thumbActive += 1;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          thumbActive -= 1;
          const next = thumbQueue.shift();
          if (next) next();
        });
    };
    if (thumbActive < THUMB_LIMIT) start();
    else thumbQueue.push(start);
  });
}

async function nonEmpty(p) {
  try {
    return (await fsp.stat(p)).size > 0;
  } catch {
    return false;
  }
}

async function ffmpegThumb(ff, src, out, seek, edge) {
  const scale = `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease`;
  const attempt = async (s) => {
    await runAllowingFailure(ff, [
      "-v", "error", "-ss", String(s), "-i", src,
      "-frames:v", "1", "-vf", scale, "-q:v", "4", "-y", out,
    ]);
    return nonEmpty(out);
  };
  if (seek > 0 && (await attempt(seek))) return true;
  return attempt(0);
}

async function quicklookThumb(src, out, edge) {
  const tmp = path.join(path.dirname(out), `.ql-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`);
  await fsp.mkdir(tmp, { recursive: true });
  try {
    await runAllowingFailure("qlmanage", ["-t", "-s", String(edge), "-o", tmp, src]);
    const produced = path.join(tmp, `${path.basename(src)}.png`);
    if (!exists(produced)) throw new Error("quicklook produced no thumbnail");
    await fsp.rename(produced, out);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

// Mirrors thumbnail_to_cache: the cache key is path + size + mtime + edge +
// frame, so repeat calls short-circuit and edits or a new frame regenerate.
async function generateThumbnail({ path: src, maxEdge, outDir, frameTime }) {
  const st = await fsp.stat(src).catch(() => null);
  if (!st || !st.isFile()) throw `not a file: ${src}`;
  const edge = Math.min(2048, Math.max(16, Number(maxEdge) || 512));
  const ft = Number.isFinite(frameTime) && frameTime >= 0 ? frameTime : 0.1;
  const dir = outDir ? String(outDir) : path.join(os.tmpdir(), "local-gallery-thumbs");
  await fsp.mkdir(dir, { recursive: true });
  const hash = crypto.createHash("sha1").update(src).digest("hex").slice(0, 16);
  const base = `e${hash}-${st.size}-${Math.floor(st.mtimeMs)}-${edge}-${Math.floor(ft * 1000)}`;
  const jpg = path.join(dir, `${base}.jpg`);
  const png = path.join(dir, `${base}.png`);
  if (await nonEmpty(jpg)) return jpg;
  if (await nonEmpty(png)) return png;
  return withThumbSlot(async () => {
    const ext = path.extname(src).slice(1).toLowerCase();
    if (IMAGE_EXTS.has(ext)) {
      // sips is macOS's own image tool (ImageIO), so it reads everything the
      // system does, AVIF and HEIC included. It is only asked to shrink: an
      // image already inside the edge is re-encoded at its own size.
      const dims = await runAllowingFailure("sips", ["-g", "pixelWidth", "-g", "pixelHeight", src]);
      const w = Number((/pixelWidth:\s*(\d+)/.exec(dims.stdout) || [])[1]) || 0;
      const h = Number((/pixelHeight:\s*(\d+)/.exec(dims.stdout) || [])[1]) || 0;
      const resize = !(w > 0 && h > 0 && Math.max(w, h) <= edge) ? ["-Z", String(edge)] : [];
      await runAllowingFailure("sips", [
        ...resize, "-s", "format", "jpeg", "-s", "formatOptions", "90", src, "--out", jpg,
      ]);
      if (await nonEmpty(jpg)) return jpg;
    } else {
      const ff = findFfmpeg();
      if (ff && (await ffmpegThumb(ff, src, jpg, ft, edge))) return jpg;
    }
    await quicklookThumb(src, png, edge);
    return png;
  });
}

// --- the managed library ---------------------------------------------------

const MEDIA_FOLDER_NAME = "Local Gallery";
const MEDIA_FOLDER_HIDDEN_NAME = ".Local Gallery";

function mediaRootBase() {
  try {
    return app.getPath("documents");
  } catch {
    return app.getPath("pictures");
  }
}

// Mirrors get_media_root: a hidden library wins over a visible one.
function getMediaRoot() {
  if (devMode() && process.env.LG_DEV_MEDIA_ROOT) {
    fs.mkdirSync(process.env.LG_DEV_MEDIA_ROOT, { recursive: true });
    return process.env.LG_DEV_MEDIA_ROOT;
  }
  const base = mediaRootBase();
  const hidden = path.join(base, MEDIA_FOLDER_HIDDEN_NAME);
  if (isDir(hidden)) return hidden;
  const dir = path.join(base, MEDIA_FOLDER_NAME);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getMetadataRoot() {
  const dir = path.join(getMediaRoot(), ".local-gallery");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "catalog"), { recursive: true });
  fs.mkdirSync(path.join(dir, "thumbs"), { recursive: true });
  return dir;
}

// Mirrors set_media_folder_hidden_at: refuses when both names exist.
function setMediaFolderHidden(hidden) {
  const base = mediaRootBase();
  const visible = path.join(base, MEDIA_FOLDER_NAME);
  const dotted = path.join(base, MEDIA_FOLDER_HIDDEN_NAME);
  const [from, to] = hidden ? [visible, dotted] : [dotted, visible];
  if (isDir(from) && isDir(to)) {
    throw `both "${MEDIA_FOLDER_NAME}" and "${MEDIA_FOLDER_HIDDEN_NAME}" exist; combine them by hand first`;
  }
  if (isDir(from)) fs.renameSync(from, to);
  else if (!isDir(to)) fs.mkdirSync(to, { recursive: true });
  return to;
}

// --- archives --------------------------------------------------------------

// Written under a hidden partial name and renamed once complete, so a zip that
// shows up in Downloads is always a finished one.
async function zipFolderInto(folder, downloads, archiveName) {
  const target = uniquePath(downloads, sanitizeArchiveName(archiveName));
  const partial = path.join(downloads, `.${path.basename(target)}.partial`);
  try {
    await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", folder, partial]);
    await fsp.rename(partial, target);
  } catch (err) {
    await fsp.rm(partial, { force: true });
    throw `archive failed: ${err.stderr || err.message || err}`;
  }
  return target;
}

async function exportMetadataArchive({ metadataDir, archiveFileName }) {
  const dir = String(metadataDir || "");
  if (!isDir(dir)) throw `metadata folder is unavailable: ${dir}`;
  if (!(await fsp.readdir(dir)).length) throw "the metadata folder is empty";
  const downloads = app.getPath("downloads");
  await fsp.mkdir(downloads, { recursive: true });
  return zipFolderInto(dir, downloads, archiveFileName);
}

async function exportJournalArchive({ entries, archiveFileName, folderName }) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) throw "there are no journal entries to export";
  const downloads = app.getPath("downloads");
  await fsp.mkdir(downloads, { recursive: true });
  let folder = sanitizeArchiveName(folderName).replace(/\.zip$/i, "");
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "lg-journal-"));
  try {
    const dir = path.join(tmp, folder);
    await fsp.mkdir(dir);
    const used = new Set();
    for (const entry of list) {
      let stem = sanitizeArchiveName(entry.file_name).replace(/\.zip$/i, "").replace(/\.md$/i, "");
      let name = `${stem}.md`;
      for (let n = 2; used.has(name); n++) name = `${stem} ${n}.md`;
      used.add(name);
      await fsp.writeFile(path.join(dir, name), String(entry.text || ""));
    }
    return await zipFolderInto(dir, downloads, archiveFileName);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
}

// --- import ----------------------------------------------------------------

async function importFiles({ paths, destDir }) {
  const dest = String(destDir || "");
  if (!isDir(dest)) throw `destination is not a directory: ${dest}`;
  const destReal = await fsp.realpath(dest);
  const out = [];
  for (const src of paths || []) {
    const st = await fsp.stat(src).catch(() => null);
    if (!st) throw `stat ${src}: not found`;
    const directory = st.isDirectory();
    if (directory) {
      const srcReal = await fsp.realpath(src);
      if (destReal === srcReal || destReal.startsWith(srcReal + path.sep)) {
        throw `cannot move a folder into itself: ${src}`;
      }
    }
    const target = uniqueDestPath(dest, path.basename(src), directory);
    try {
      await fsp.rename(src, target);
    } catch {
      // Another volume: copy, then remove the original.
      await fsp.cp(src, target, { recursive: true });
      await fsp.rm(src, { recursive: true, force: true });
    }
    out.push(target);
  }
  return out;
}

// --- the command table ------------------------------------------------------

function focusedWindow(event) {
  const { BrowserWindow } = require("electron");
  return BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
}

const COMMANDS = {
  ping: () => `local-gallery electron backend v${app.getVersion()}`,

  dev_report: ({ msg }) => {
    console.error(`[lg-dev] ${msg}`);
  },

  // Development only: a real (trusted) key press, sent the way the OS would,
  // so a test script can measure input-to-screen latency.
  dev_send_key: async ({ keyCode, modifiers }, event) => {
    if (!devMode()) throw "dev only";
    const mods = Array.isArray(modifiers) ? modifiers : [];
    event.sender.sendInputEvent({ type: "rawKeyDown", keyCode, modifiers: mods });
    event.sender.sendInputEvent({ type: "keyUp", keyCode, modifiers: mods });
  },

  generate_thumbnail: (args) => generateThumbnail(args),

  probe_video_timing: async ({ path: p }) => {
    const ff = findFfmpeg();
    if (!ff) throw "ffmpeg unavailable";
    if (!exists(p)) throw `not a file: ${p}`;
    const { stderr } = await runAllowingFailure(ff, ["-hide_banner", "-i", p]);
    const timing = parseVideoTiming(stderr);
    if (timing.duration <= 0 && timing.frame_rate <= 0) throw "video timing unavailable";
    return timing;
  },

  write_download_file: async ({ fileName, bytes }) => {
    const dir = app.getPath("downloads");
    await fsp.mkdir(dir, { recursive: true });
    const target = uniquePath(dir, sanitizeName(fileName, "local-gallery-export.gif"));
    await fsp.writeFile(target, Buffer.from(bytes || []));
    return target;
  },

  // fs.rs
  pick_root: async (_args, event) => {
    const res = await dialog.showOpenDialog(focusedWindow(event), {
      properties: ["openDirectory", "createDirectory"],
    });
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
  },

  scan_dir: async ({ path: dir }) => {
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch (err) {
      throw `read_dir ${dir}: ${err.message}`;
    }
    const dirs = [];
    const files = [];
    // stat follows symlinks, so linked folders and files classify correctly.
    const stats = await Promise.all(names.map((n) => fsp.stat(path.join(dir, n)).catch(() => null)));
    names.forEach((name, i) => {
      const st = stats[i];
      if (!st) return;
      if (st.isDirectory()) dirs.push(name);
      else if (st.isFile()) files.push({ name, size: st.size, mtime_ms: Math.floor(st.mtimeMs) });
    });
    return { dirs, files };
  },

  path_kind: ({ path: p }) => {
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) return "dir";
      if (st.isFile()) return "file";
    } catch {}
    return "none";
  },

  read_file_bytes: async ({ path: p }) => {
    try {
      return await fsp.readFile(p);
    } catch (err) {
      throw `read ${p}: ${err.message}`;
    }
  },

  // Atomic: temp file, then rename over the target.
  write_file_bytes: async ({ path: p, bytes }) => {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = `${p}.lgtmp`;
    await fsp.writeFile(tmp, Buffer.from(bytes || []));
    await fsp.rename(tmp, p);
  },

  make_dir: async ({ path: p }) => {
    await fsp.mkdir(p, { recursive: true });
  },

  touch_file: async ({ path: p }) => {
    if (exists(p)) return;
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await (await fsp.open(p, "a")).close();
  },

  remove_path: async ({ path: p, recursive }) => {
    let st;
    try {
      st = await fsp.lstat(p);
    } catch {
      return; // already gone
    }
    try {
      if (st.isDirectory()) {
        if (recursive) await fsp.rm(p, { recursive: true, force: true });
        else await fsp.rmdir(p);
      } else {
        await fsp.unlink(p);
      }
    } catch (err) {
      throw `remove ${p}: ${err.message}`;
    }
  },

  // Refuses to overwrite, like rename_path.
  rename_path: async ({ from, to }) => {
    if (exists(to)) throw `target already exists: ${to}`;
    await fsp.mkdir(path.dirname(to), { recursive: true });
    try {
      await fsp.rename(from, to);
    } catch (err) {
      throw `rename ${from} -> ${to}: ${err.message}`;
    }
  },

  save_last_root: ({ path: p }) => {
    fs.writeFileSync(configFile("last-root.txt"), String(p || ""));
  },

  get_last_root: () => {
    try {
      const s = fs.readFileSync(configFile("last-root.txt"), "utf8").trim();
      return s && isDir(s) ? s : null;
    } catch {
      return null;
    }
  },

  allow_media_scope: ({ path: p }) => {
    media.allowDirectory(p);
  },

  get_media_root: () => getMediaRoot(),
  get_metadata_root: () => getMetadataRoot(),
  media_folder_is_hidden: () => isDir(path.join(mediaRootBase(), MEDIA_FOLDER_HIDDEN_NAME)),
  set_media_folder_hidden: ({ hidden }) => setMediaFolderHidden(!!hidden),

  reveal_path: async ({ path: p }) => {
    const err = await shell.openPath(String(p || ""));
    if (err) throw `open failed: ${err}`;
  },

  pick_import_files: async (_args, event) => {
    const res = await dialog.showOpenDialog(focusedWindow(event), {
      properties: ["openFile", "multiSelections"],
    });
    return res.canceled ? [] : res.filePaths;
  },

  pick_import_folders: async (_args, event) => {
    const res = await dialog.showOpenDialog(focusedWindow(event), {
      properties: ["openDirectory", "multiSelections"],
    });
    return res.canceled ? [] : res.filePaths;
  },

  import_files: (args) => importFiles(args),
  export_metadata_archive: (args) => exportMetadataArchive(args),
  export_journal_archive: (args) => exportJournalArchive(args),

  // session.rs
  session_status: () => session.status(),
  session_set_unlocked: ({ unlocked }) => session.setUnlocked(!!unlocked),
  session_save_view: ({ view }) => session.saveView(String(view || "")),
  session_heartbeat: () => session.heartbeat(),
};

// Grok / Claude / Variations register theirs from embedded.js.
function registerCommands(extra) {
  Object.assign(COMMANDS, extra);
}

// Errors travel back as plain strings, the way Tauri rejects, because the page
// shows them as `${err}`.
async function dispatch(cmd, args, event) {
  const fn = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!fn) return { ok: false, error: `unknown command: ${cmd}` };
  try {
    const value = await fn(args || {}, event);
    return { ok: true, value: value === undefined ? null : value };
  } catch (err) {
    const error = typeof err === "string" ? err : (err && err.message) || String(err);
    return { ok: false, error };
  }
}

module.exports = { dispatch, registerCommands, parseVideoTiming, findFfmpeg };
