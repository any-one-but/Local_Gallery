// The two protocols the main window runs on.
//
// lgapp://local/ serves frontend/ -- the page itself -- and writes the bridge
// into the head of each HTML page before anything else in it, which is what
// Tauri's initialization scripts did: tauri-bridge.js and tauri-fs-shim.js run
// before the page's own script, over a `window.__TAURI__.core.invoke` that
// here goes to the main process (preload.js, commands.js).
//
// lgmedia://localhost/<encoded absolute path> serves library media, as
// src-tauri/src/media.rs did, and only from folders the page has been granted
// (allow_media_scope). It answers range requests, which is what video seeking
// is made of. It is registered on the default session only, which the main
// window and Variations use; Grok and Claude run in sessions of their own, so
// a remote page can never read the library through it.

"use strict";

const { app, protocol } = require("electron");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Readable } = require("stream");

const { devMode } = require("./dev");

const APP_SCHEME = "lgapp";
const APP_ORIGIN = `${APP_SCHEME}://local`;
const MEDIA_SCHEME = "lgmedia";

const MIME = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

function mimeFor(p) {
  return MIME[path.extname(p).slice(1).toLowerCase()] || "application/octet-stream";
}

// Must run before the app is ready.
function registerSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

// --- lgapp -----------------------------------------------------------------

function frontendDir() {
  return path.join(app.getAppPath(), "frontend");
}

function readRootFile(name) {
  return fs.readFileSync(path.join(app.getAppPath(), name), "utf8");
}

// `</script>` inside an inlined script would end it early.
function inlineScript(source) {
  return `<script>${String(source).replace(/<\/script/gi, "<\\/script")}</script>`;
}

// What Tauri injected before the page's own scripts, now written into the
// page: the invoke bridge, then the two shims, then (development only) a test
// script. `extra` is per page -- Variations gets its embedded flags.
function headInjection(extra) {
  const bridge = `
window.__lgHostEngine = "chromium";
window.__LG_VIDEO_HTTP = "";
window.__TAURI__ = Object.freeze({
  core: Object.freeze({
    invoke: function (cmd, args) { return window.__lgIpc.invoke(String(cmd), args || {}); },
    convertFileSrc: function (p, scheme) {
      return (scheme || "asset") + "://localhost/" + encodeURIComponent(String(p));
    },
  }),
});
${extra || ""}`;
  const parts = [inlineScript(bridge), inlineScript(readRootFile("tauri-bridge.js")), inlineScript(readRootFile("tauri-fs-shim.js"))];
  const devScript = devMode() && process.env.LG_DEV_SCRIPT;
  if (devScript) {
    try {
      parts.push(inlineScript(fs.readFileSync(devScript, "utf8")));
    } catch (err) {
      console.error(`[lg] LG_DEV_SCRIPT unreadable: ${err.message}`);
    }
  }
  return parts.join("\n");
}

let pageExtras = () => "";

function setPageExtras(fn) {
  pageExtras = fn;
}

async function serveApp(request) {
  const url = new URL(request.url);
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  const root = frontendDir();
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) {
    return new Response("forbidden", { status: 403 });
  }
  let body;
  try {
    body = await fsp.readFile(file);
  } catch {
    return new Response("not found", { status: 404 });
  }
  if (path.extname(file).toLowerCase() === ".html") {
    const html = body.toString("utf8");
    const inject = headInjection(pageExtras(path.basename(file)));
    const at = html.search(/<head[^>]*>/i);
    body =
      at >= 0
        ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${inject}\n`)
        : `${inject}\n${html}`;
  }
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": mimeFor(file), "Cache-Control": "no-store" },
  });
}

// --- lgmedia ---------------------------------------------------------------

const allowedDirs = new Set();

function allowDirectory(dir) {
  const p = path.resolve(String(dir || ""));
  if (p && p !== path.sep) allowedDirs.add(p);
}

function isAllowed(p) {
  for (const dir of allowedDirs) {
    if (p === dir || p.startsWith(dir + path.sep)) return true;
  }
  return false;
}

function mediaHeaders(extra) {
  return {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "content-range, content-length, accept-ranges",
    ...extra,
  };
}

async function serveMedia(request) {
  const url = new URL(request.url);
  const p = path.resolve(decodeURIComponent(url.pathname.replace(/^\/+/, "")));
  if (!isAllowed(p)) return new Response(null, { status: 403, headers: mediaHeaders() });
  let st;
  try {
    st = await fsp.stat(p);
  } catch {
    return new Response(null, { status: 404, headers: mediaHeaders() });
  }
  if (!st.isFile()) return new Response(null, { status: 404, headers: mediaHeaders() });
  const size = st.size;
  const type = mimeFor(p);
  const range = request.headers.get("range");
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m && (m[1] !== "" || m[2] !== "")) {
    let start;
    let end;
    if (m[1] === "") {
      // A suffix: the last N bytes.
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    } else {
      start = Number(m[1]);
      // An open-ended range is answered to the end of the file, as a stream
      // the player cancels once it has enough. Capping it (media.rs sent at
      // most 4 MB) made Chromium fail every video larger than the cap.
      end = m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2]));
    }
    if (start >= size || end < start) {
      return new Response(null, {
        status: 416,
        headers: mediaHeaders({ "Content-Range": `bytes */${size}` }),
      });
    }
    const stream = fs.createReadStream(p, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: mediaHeaders({
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      }),
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(p)), {
    status: 200,
    headers: mediaHeaders({ "Content-Type": type, "Content-Length": String(size) }),
  });
}

function handleProtocols(ses) {
  ses.protocol.handle(APP_SCHEME, serveApp);
  ses.protocol.handle(MEDIA_SCHEME, serveMedia);
}

module.exports = {
  APP_ORIGIN,
  registerSchemes,
  handleProtocols,
  allowDirectory,
  setPageExtras,
};
