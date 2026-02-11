const { app, BrowserWindow, ipcMain } = require("electron");
const https = require("https");
const http = require("http");
const zlib = require("zlib");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

function parseMissingToolsFromOutput(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = String(lines[i] || "").trim();
    if (!line.startsWith("__LG_MISSING__:")) continue;
    const payload = line.slice("__LG_MISSING__:".length).trim();
    if (!payload) return [];
    const list = payload.split(",").map((s) => String(s || "").trim()).filter(Boolean);
    return Array.from(new Set(list));
  }
  return [];
}

function scrubScriptText() {
  return `
set -euo pipefail

missing_tools=()
have_cmd() { command -v "$1" >/dev/null 2>&1; }
mark_missing() {
  local tool="$1"
  local found=0
  for it in "\${missing_tools[@]:-}"; do
    if [ "$it" = "$tool" ]; then
      found=1
      break
    fi
  done
  if [ "$found" -eq 0 ]; then
    missing_tools+=("$tool")
  fi
}
print_missing() {
  local joined=""
  if [ "\${#missing_tools[@]}" -gt 0 ]; then
    local IFS=','
    joined="\${missing_tools[*]}"
  fi
  echo "__LG_MISSING__:$joined"
}
trap print_missing EXIT

echo "=== STEP 1: Deduplicating files recursively (fdupes -r -A -d -N) ==="
if have_cmd fdupes; then
  fdupes -r -A -d -N . || { echo "fdupes failed — stopping"; exit 1; }
  echo "Deduplication finished."
else
  mark_missing fdupes
  echo "Skipping deduplication (missing fdupes)."
fi
echo ""

echo "=== STEP 2: Converting .m4v → .mp4 (stream copy) ==="
if have_cmd ffmpeg; then
  find . -type f -iname "*.m4v" -print0 | while IFS= read -r -d '' file; do
      if [[ -f "$file" ]]; then
          output="\${file%.*}.mp4"
          echo "Converting: $file → $output"
          ffmpeg -hide_banner -loglevel error -i "$file" -c copy -map 0 "$output" && {
              echo "Success → removing original"
              rm -f "$file"
          } || {
              echo "FAILED conversion: $file"
          }
      fi
  done
  echo "m4v → mp4 conversion finished."
else
  mark_missing ffmpeg
  echo "Skipping m4v → mp4 conversion (missing ffmpeg)."
fi
echo ""

echo "=== STEP 3: Scrub + shrink images & videos (your original logic) ==="

echo "→ Resizing tall images to max 3200 height ..."
if have_cmd sips; then
  find . -type f \\( -iname "*.jpg" -o -iname "*.gif" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \\) -print0 |
  xargs -0 -n 1 -P 16 sh -c '
isint() { case "$1" in ""|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
f="$1"
w=$(sips -g pixelWidth  "$f" 2>/dev/null | awk "/pixelWidth/  {print \\$2}")
h=$(sips -g pixelHeight "$f" 2>/dev/null | awk "/pixelHeight/ {print \\$2}")
isint "$w" && isint "$h" || exit 0
[ "$h" -le 3200 ] && exit 0
nw=$(( w * 3200 / h ))
[ "$nw" -lt 1 ] && nw=1
sips -z 3200 "$nw" "$f" >/dev/null
' sh
else
  mark_missing sips
  echo "Skipping image resize (missing sips)."
fi

echo "→ Resizing tall videos to max 3200 height ..."
if have_cmd ffmpeg && have_cmd ffprobe; then
  find . -type f \\( -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" -o -iname "*.avi" \\) -print0 |
  xargs -0 -n 1 -P 8 sh -c '
isint() { case "$1" in ""|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }
tolower() { printf "%s" "$1" | tr "[:upper:]" "[:lower:]"; }
f="$1"
w=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 "$f" 2>/dev/null | head -n 1)
h=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 "$f" 2>/dev/null | head -n 1)
isint "$w" && isint "$h" || exit 0
[ "$h" -le 3200 ] && exit 0
nw=$(( w * 3200 / h ))
nw=$(( (nw/2)*2 ))
[ "$nw" -lt 2 ] && nw=2
ext=$(tolower "\${f##*.}")
base="\${f%.*}"
tmp="\${base}.tmp.$$.$ext"
case "$ext" in
  mp4|m4v)
    ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=\${nw}:3200" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy -movflags +faststart "$tmp"
    ;;
  mov)
    ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=\${nw}:3200" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy "$tmp"
    ;;
  mkv|avi)
    ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=\${nw}:3200" -map 0 -c:v libx264 -crf 18 -preset medium -c:a copy -c:s copy "$tmp"
    ;;
  webm)
    ffmpeg -hide_banner -loglevel error -y -i "$f" -vf "scale=\${nw}:3200" -map 0 -c:v libvpx-vp9 -crf 32 -b:v 0 -c:a copy -c:s copy "$tmp"
    ;;
  *)
    exit 0
    ;;
esac
if [ -s "$tmp" ]; then
  mv -f "$tmp" "$f"
else
  rm -f "$tmp"
fi
' sh
else
  if ! have_cmd ffmpeg; then mark_missing ffmpeg; fi
  if ! have_cmd ffprobe; then mark_missing ffprobe; fi
  echo "Skipping video resize (missing ffmpeg and/or ffprobe)."
fi

echo "→ Scrubbing metadata from images & videos ..."
if have_cmd mat2; then
  find . -type f \\( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" -o -iname "*.heic" \
                 -o -iname "*.mp4" -o -iname "*.mov" -o -iname "*.m4v" -o -iname "*.mkv" -o -iname "*.webm" -o -iname "*.avi" \\) -print0 |
  xargs -0 -P 18 -n 200 sh -c '
for f in "$@"; do
  mat2 --inplace "$f" || echo "FAILED: $f" >&2
done
' sh
else
  mark_missing mat2
  echo "Skipping metadata scrub (missing mat2)."
fi

echo ""
echo "=== All steps completed ==="
`;
}

function runScrubInDirectory(dirPath) {
  return new Promise((resolve) => {
    const script = scrubScriptText();
    const child = spawn("bash", ["-lc", script], {
      cwd: dirPath,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    const MAX_CAPTURE = 2 * 1024 * 1024;

    const append = (target, chunk) => {
      const next = target + String(chunk || "");
      if (next.length <= MAX_CAPTURE) return next;
      return next.slice(next.length - MAX_CAPTURE);
    };

    child.stdout.on("data", (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = append(stderr, chunk);
    });

    child.on("error", (err) => {
      resolve({
        ok: false,
        code: -1,
        error: err && err.message ? String(err.message) : "spawn_failed",
        stdout,
        stderr,
        missingTools: parseMissingToolsFromOutput(stdout)
      });
    });

    child.on("close", (code) => {
      const missingTools = parseMissingToolsFromOutput(stdout);
      resolve({
        ok: code === 0,
        code: Number.isFinite(code) ? code : -1,
        stdout,
        stderr,
        missingTools
      });
    });
  });
}

function decodeContentBuffer(buf, contentEncoding) {
  const enc = String(contentEncoding || "").toLowerCase();
  if (!buf || !buf.length || !enc || enc === "identity") return buf;
  try {
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch {
    return buf;
  }
  return buf;
}

function requestUrl(url, opts = {}) {
  return new Promise((resolve) => {
    let parsed = null;
    try { parsed = new URL(url); } catch {
      resolve({ ok: false, status: 0, error: "invalid_url" });
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const headers = Object.assign({}, opts.headers || {});
    if (opts.referrer) headers.Referer = opts.referrer;
    if (!headers["User-Agent"]) headers["User-Agent"] = "Mozilla/5.0";

    const req = lib.request(parsed, { method: "GET", headers }, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers && res.headers.location;
      if (status >= 300 && status < 400 && loc && (opts.redirects || 0) < 4) {
        res.resume();
        const next = new URL(loc, parsed).toString();
        resolve(requestUrl(next, Object.assign({}, opts, { redirects: (opts.redirects || 0) + 1 })));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const rawBuf = Buffer.concat(chunks);
        const contentEncoding = String((res.headers && res.headers["content-encoding"]) || "");
        const buf = decodeContentBuffer(rawBuf, contentEncoding);
        if (opts.binary) {
          resolve({
            ok: status >= 200 && status < 300,
            status,
            data: buf.toString("base64"),
            bytes: buf.length,
            contentType: String((res.headers && res.headers["content-type"]) || ""),
            contentLength: Number((res.headers && res.headers["content-length"]) || 0) || 0,
            contentEncoding,
            finalUrl: String(parsed.toString())
          });
          return;
        }
        const text = buf.toString("utf8");
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text,
          contentType: String((res.headers && res.headers["content-type"]) || ""),
          contentLength: Number((res.headers && res.headers["content-length"]) || 0) || 0,
          contentEncoding,
          finalUrl: String(parsed.toString())
        });
      });
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err ? err.message : "network_error" });
    });
    req.end();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("online-fetch", async (event, payload) => {
    const url = payload && payload.url ? String(payload.url) : "";
    if (!url) return { ok: false, status: 0, error: "invalid_url" };
    const headers = (payload && payload.headers && typeof payload.headers === "object") ? payload.headers : {};
    const referrer = payload && payload.referrer ? String(payload.referrer) : "";
    return requestUrl(url, { headers, referrer, redirects: 0 });
  });

  ipcMain.handle("online-download-file", async (event, payload) => {
    const url = payload && payload.url ? String(payload.url) : "";
    if (!url) return { ok: false, status: 0, error: "invalid_url" };
    const headers = (payload && payload.headers && typeof payload.headers === "object") ? payload.headers : {};
    const referrer = payload && payload.referrer ? String(payload.referrer) : "";
    return requestUrl(url, { headers, referrer, redirects: 0, binary: true });
  });

  ipcMain.handle("scrub-folder", async (event, payload) => {
    const dirPath = payload && payload.path ? String(payload.path) : "";
    if (!dirPath) return { ok: false, code: -1, error: "invalid_path", missingTools: [] };
    let st = null;
    try { st = fs.statSync(dirPath); } catch {}
    if (!st || !st.isDirectory()) {
      return { ok: false, code: -1, error: "not_directory", missingTools: [] };
    }
    return runScrubInDirectory(dirPath);
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
