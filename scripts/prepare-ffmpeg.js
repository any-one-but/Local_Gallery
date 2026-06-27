#!/usr/bin/env node
// Copy the ffmpeg-static binary into src-tauri/resources so Tauri bundles it
// with the app — packaged video thumbnails then don't depend on a system
// ffmpeg. Gitignored output; regenerated from the npm package on each build.
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
let src = "";
try {
  src = require("ffmpeg-static") || "";
} catch (e) {}

if (!src || !fs.existsSync(src)) {
  console.warn(
    "[prepare-ffmpeg] ffmpeg-static not found; skipping (video thumbs fall back to system ffmpeg / QuickLook)",
  );
  process.exit(0);
}

const outDir = path.join(root, "src-tauri", "resources");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "ffmpeg");
fs.copyFileSync(src, out);
fs.chmodSync(out, 0o755);
console.log("[prepare-ffmpeg] bundled ffmpeg ->", out);
