#!/usr/bin/env node
/*
  Local Gallery -- the browser version's local server (`npm start`, or
  `npm run web`).

  A web page on its own cannot open, create or read a folder in Documents: the
  only way a browser hands a page a folder is the directory picker, and the
  browser version no longer has one. So this small server is what the browser
  version runs on. It:

  - finds the library at ~/Documents/Local Gallery (or `.Local Gallery`, the
    hidden name the desktop app can give it), creating it if it is missing;
  - serves the UI from frontend/, with web/web-host.js injected ahead of the
    app's own script;
  - answers the same file commands the desktop app's Rust side does (scan_dir,
    read_file_bytes, write_file_bytes, ...), for paths inside the library only;
  - streams media over plain HTTP with byte ranges, which is what browsers play
    video from best.

  It listens on 127.0.0.1 only, checks the Host header (so another website
  cannot reach it through DNS tricks), and every API and media request must
  carry the token minted at start-up, which only the served page knows. No
  dependencies beyond Node itself.
*/
"use strict";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

// Command-line options, for testing: --library <path> uses another folder as
// the library, --port <n> starts from another port, --no-open does not open a
// browser. Environment variables LG_WEB_LIBRARY / LG_WEB_PORT / LG_WEB_NO_OPEN
// do the same.
const ARGS = process.argv.slice(2);
function argValue(name) {
  const i = ARGS.indexOf(name);
  return i >= 0 && i + 1 < ARGS.length ? ARGS[i + 1] : "";
}
if (argValue("--library")) process.env.LG_WEB_LIBRARY = argValue("--library");
if (argValue("--port")) process.env.LG_WEB_PORT = argValue("--port");
if (ARGS.includes("--no-open")) process.env.LG_WEB_NO_OPEN = "1";

const REPO = path.resolve(__dirname, "..");
const FRONTEND = path.join(REPO, "frontend");
const WEB_HOST_JS = path.join(__dirname, "web-host.js");
const LIBRARY_NAME = "Local Gallery";
const LIBRARY_HIDDEN_NAME = ".Local Gallery";
const DEFAULT_PORT = Number(process.env.LG_WEB_PORT) || 8123;
const TOKEN = crypto.randomBytes(16).toString("hex");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

function mimeFor(p) {
  return MIME[path.extname(p).toLowerCase()] || "application/octet-stream";
}

// --- The library -----------------------------------------------------------

function documentsDir() {
  const home = os.homedir();
  const docs = path.join(home, "Documents");
  if (fs.existsSync(docs)) return docs;
  const pics = path.join(home, "Pictures");
  if (fs.existsSync(pics)) return pics;
  return home;
}

// Same rule as the desktop app's get_media_root: a hidden library wins, so
// the two never end up with two libraries side by side.
function resolveLibraryRoot() {
  if (process.env.LG_WEB_LIBRARY) {
    const p = path.resolve(process.env.LG_WEB_LIBRARY);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }
  const base = documentsDir();
  const hidden = path.join(base, LIBRARY_HIDDEN_NAME);
  if (fs.existsSync(hidden) && fs.statSync(hidden).isDirectory()) return hidden;
  const visible = path.join(base, LIBRARY_NAME);
  fs.mkdirSync(visible, { recursive: true });
  return visible;
}

const ROOT = resolveLibraryRoot();
const META = path.join(ROOT, ".local-gallery");

// Every path the page names must resolve inside the library. Lexical, after
// normalisation, so `..` cannot climb out; symlinks the user put inside their
// own library are followed, as the desktop app does.
function insideLibrary(p) {
  if (typeof p !== "string" || !p) return null;
  const resolved = path.resolve(p);
  if (resolved === ROOT || resolved.startsWith(ROOT + path.sep)) return resolved;
  return null;
}

function mustBeInside(p) {
  const r = insideLibrary(p);
  if (!r) {
    const err = new Error("path is outside the library");
    err.status = 403;
    throw err;
  }
  return r;
}

// --- File commands (mirror src-tauri/src/fs.rs) ----------------------------

async function scanDir({ path: p }) {
  const dir = mustBeInside(p);
  const dirs = [];
  const files = [];
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      let st;
      try {
        st = await fsp.stat(full); // follows symlinks, like the Rust side
      } catch {
        return;
      }
      if (st.isDirectory()) dirs.push(entry.name);
      else if (st.isFile())
        files.push({ name: entry.name, size: st.size, mtime_ms: Math.floor(st.mtimeMs) });
    }),
  );
  return { dirs, files };
}

async function pathKind({ path: p }) {
  const r = mustBeInside(p);
  try {
    const st = await fsp.stat(r);
    return st.isDirectory() ? "dir" : st.isFile() ? "file" : "none";
  } catch {
    return "none";
  }
}

async function makeDir({ path: p }) {
  await fsp.mkdir(mustBeInside(p), { recursive: true });
  return null;
}

async function touchFile({ path: p }) {
  const r = mustBeInside(p);
  await fsp.mkdir(path.dirname(r), { recursive: true });
  const fh = await fsp.open(r, "a");
  await fh.close();
  return null;
}

async function renamePath({ from, to }) {
  const a = mustBeInside(from);
  const b = mustBeInside(to);
  if (a === ROOT) throw Object.assign(new Error("cannot move the library itself"), { status: 403 });
  if (fs.existsSync(b)) throw new Error(`target already exists: ${to}`);
  await fsp.mkdir(path.dirname(b), { recursive: true });
  await fsp.rename(a, b);
  return null;
}

async function removePath({ path: p, recursive }) {
  const r = mustBeInside(p);
  if (r === ROOT) throw Object.assign(new Error("cannot remove the library itself"), { status: 403 });
  let st;
  try {
    st = await fsp.lstat(r);
  } catch {
    return null; // already gone
  }
  if (st.isDirectory()) {
    if (recursive) await fsp.rm(r, { recursive: true, force: true });
    else await fsp.rmdir(r);
  } else {
    await fsp.unlink(r);
  }
  return null;
}

async function writeFileAtomic(p, body) {
  const r = mustBeInside(p);
  await fsp.mkdir(path.dirname(r), { recursive: true });
  const tmp = `${r}.${process.pid}.${Date.now()}.lgtmp`;
  await fsp.writeFile(tmp, body);
  await fsp.rename(tmp, r);
}

async function metadataRoot() {
  await fsp.mkdir(path.join(META, "catalog"), { recursive: true });
  await fsp.mkdir(path.join(META, "thumbs"), { recursive: true });
  return META;
}

const COMMANDS = {
  get_media_root: async () => ROOT,
  get_metadata_root: metadataRoot,
  scan_dir: scanDir,
  path_kind: pathKind,
  make_dir: makeDir,
  touch_file: touchFile,
  rename_path: renamePath,
  remove_path: removePath,
  // The desktop app grants its media protocol access per folder; here the
  // whole library is always the scope, so these are no-ops.
  allow_media_scope: async () => null,
  save_last_root: async () => null,
};

// --- HTTP ------------------------------------------------------------------

let PORT = DEFAULT_PORT;

function hostAllowed(req) {
  const host = String(req.headers.host || "");
  return host === `127.0.0.1:${PORT}` || host === `localhost:${PORT}`;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), { "Content-Type": "application/json" });
}

async function readBody(req, limit = 512 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseRange(value, len) {
  const m = /^bytes=(\d*)-(\d*)/.exec(String(value || "").trim());
  if (!m || len === 0) return null;
  let start;
  let end;
  if (m[1] === "") {
    const n = Number(m[2]);
    if (!n) return null;
    start = Math.max(0, len - n);
    end = len - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? len - 1 : Math.min(Number(m[2]), len - 1);
  }
  if (!(start >= 0) || start >= len || end < start) return null;
  return { start, end };
}

async function serveFile(req, res, filePath, extraHeaders = {}) {
  let st;
  try {
    st = await fsp.stat(filePath);
  } catch {
    return send(res, 404, "");
  }
  if (!st.isFile()) return send(res, 404, "");
  const len = st.size;
  const headers = {
    "Content-Type": mimeFor(filePath),
    "Accept-Ranges": "bytes",
    "Last-Modified": st.mtime.toUTCString(),
    ...extraHeaders,
  };
  const range = req.headers.range ? parseRange(req.headers.range, len) : null;
  if (req.headers.range && !range) {
    res.writeHead(416, { ...headers, "Content-Range": `bytes */${len}` });
    return res.end();
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : len - 1;
  res.writeHead(range ? 206 : 200, {
    ...headers,
    "Content-Length": len === 0 ? 0 : end - start + 1,
    ...(range ? { "Content-Range": `bytes ${start}-${end}/${len}` } : {}),
  });
  if (req.method === "HEAD" || len === 0) return res.end();
  const stream = fs.createReadStream(filePath, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}

// The page gets its token and the library's location before any of its own
// scripts run, then the host script that turns them into a folder handle.
async function serveIndex(res) {
  let html = await fsp.readFile(path.join(FRONTEND, "index.html"), "utf8");
  const config = {
    token: TOKEN,
    root: ROOT,
    rootName: path.basename(ROOT),
    displayRoot: ROOT.startsWith(os.homedir() + path.sep)
      ? "~" + ROOT.slice(os.homedir().length)
      : ROOT,
  };
  const inject =
    `<script>window.__LG_WEB = ${JSON.stringify(config).replace(/</g, "\\u003c")};</script>` +
    `<script src="/__lg/web-host.js?t=${TOKEN}"></script>`;
  html = html.replace(/<head([^>]*)>/i, (m) => `${m}\n${inject}`);
  send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
}

async function handle(req, res) {
  if (!hostAllowed(req)) return send(res, 403, "");
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (pathname === "/" || pathname === "/index.html") return serveIndex(res);

  if (pathname === "/__lg/web-host.js") {
    return serveFile(req, res, WEB_HOST_JS);
  }

  if (pathname.startsWith("/__lg/media/")) {
    const rest = pathname.slice("/__lg/media/".length);
    const slash = rest.indexOf("/");
    if (slash < 0 || rest.slice(0, slash) !== TOKEN) return send(res, 403, "");
    let target;
    try {
      target = decodeURIComponent(rest.slice(slash + 1));
    } catch {
      return send(res, 400, "");
    }
    const r = insideLibrary(target);
    if (!r) return send(res, 403, "");
    return serveFile(req, res, r);
  }

  if (pathname.startsWith("/__lg/api/")) {
    if (req.method !== "POST") return send(res, 405, "");
    if (req.headers["x-lg-token"] !== TOKEN) return send(res, 403, "");
    const cmd = pathname.slice("/__lg/api/".length);
    try {
      if (cmd === "read_file_bytes") {
        const args = JSON.parse((await readBody(req, 1 << 20)).toString("utf8") || "{}");
        const r = mustBeInside(args.path);
        const data = await fsp.readFile(r);
        return send(res, 200, data, { "Content-Type": "application/octet-stream" });
      }
      if (cmd === "write_file_bytes") {
        const target = decodeURIComponent(String(req.headers["x-lg-path"] || ""));
        const body = await readBody(req);
        await writeFileAtomic(target, body);
        return sendJson(res, 200, null);
      }
      const fn = COMMANDS[cmd];
      if (!fn) return sendJson(res, 404, { error: `unknown command ${cmd}` });
      const args = JSON.parse((await readBody(req, 1 << 20)).toString("utf8") || "{}");
      return sendJson(res, 200, await fn(args));
    } catch (err) {
      return sendJson(res, err.status || 500, { error: String(err.message || err) });
    }
  }

  // Static UI files, from frontend/ only.
  let rel;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return send(res, 400, "");
  }
  const file = path.resolve(FRONTEND, rel);
  if (!file.startsWith(FRONTEND + path.sep)) return send(res, 403, "");
  return serveFile(req, res, file);
}

function openBrowser(url) {
  if (process.env.LG_WEB_NO_OPEN) return;
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {}
}

function listen(port, attemptsLeft) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      try {
        sendJson(res, 500, { error: String(err.message || err) });
      } catch {}
    });
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) return listen(port + 1, attemptsLeft - 1);
    console.error(`Could not start the Local Gallery server: ${err.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    PORT = port;
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Local Gallery is running at ${url}`);
    console.log(`Library: ${ROOT}`);
    console.log("Leave this window open while you use it. Press Ctrl+C to stop.");
    openBrowser(url);
  });
}

listen(DEFAULT_PORT, 20);
