#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_HTML = path.join(ROOT, "index.html");
const SOURCE_CSS = path.join(ROOT, "styles.css");
const SOURCE_JS = path.join(ROOT, "app.js");
const OUTPUT_HTML = path.join(ROOT, "index.alt.singlefile.html");

const STYLE_LINK_RE = /<link\b[^>]*\bhref=["']\.\/styles\.css["'][^>]*>/i;
const APP_SCRIPT_RE = /<script\b[^>]*\bsrc=["']\.\/app\.js["'][^>]*>\s*<\/script>/i;
const INLINED_STYLE_RE =
  /<!-- BEGIN: inlined from \.\/styles\.css \(auto-generated\) -->\s*<style>\n([\s\S]*?)\n\s*<\/style>\s*<!-- END: inlined from \.\/styles\.css -->/;
const INLINED_SCRIPT_RE =
  /<!-- BEGIN: inlined from \.\/app\.js \(auto-generated\) -->\s*<script>\n([\s\S]*?)\n\s*<\/script>\s*<!-- END: inlined from \.\/app\.js -->/;

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, contents) {
  fs.writeFileSync(filePath, contents, "utf8");
}

function inlineAppFiles() {
  const html = readUtf8(SOURCE_HTML);
  const css = readUtf8(SOURCE_CSS);
  const js = readUtf8(SOURCE_JS);

  if (!STYLE_LINK_RE.test(html)) {
    throw new Error("Could not find ./styles.css link in index.html");
  }
  if (!APP_SCRIPT_RE.test(html)) {
    throw new Error("Could not find ./app.js script include in index.html");
  }

  const inlinedStyle = [
    "  <!-- BEGIN: inlined from ./styles.css (auto-generated) -->",
    "  <style>",
    css,
    "  </style>",
    "  <!-- END: inlined from ./styles.css -->"
  ].join("\n");

  const inlinedScript = [
    "  <!-- BEGIN: inlined from ./app.js (auto-generated) -->",
    "  <script>",
    js,
    "  </script>",
    "  <!-- END: inlined from ./app.js -->"
  ].join("\n");

  let out = html.replace(STYLE_LINK_RE, () => inlinedStyle);
  out = out.replace(APP_SCRIPT_RE, () => inlinedScript);
  writeUtf8(OUTPUT_HTML, out);
}

function extractAppFiles() {
  const bundled = readUtf8(OUTPUT_HTML);
  const styleMatch = bundled.match(INLINED_STYLE_RE);
  const scriptMatch = bundled.match(INLINED_SCRIPT_RE);

  if (!styleMatch) {
    throw new Error("Could not find inlined ./styles.css block in index.alt.singlefile.html");
  }
  if (!scriptMatch) {
    throw new Error("Could not find inlined ./app.js block in index.alt.singlefile.html");
  }

  const html = bundled
    .replace(INLINED_STYLE_RE, '    <link rel="stylesheet" href="./styles.css" />')
    .replace(INLINED_SCRIPT_RE, '    <script src="./app.js"></script>');

  writeUtf8(SOURCE_HTML, html);
  writeUtf8(SOURCE_CSS, styleMatch[1]);
  writeUtf8(SOURCE_JS, scriptMatch[1]);
}

function syncToSinglefileWithLogging() {
  try {
    inlineAppFiles();
    console.log("[singlefile] Updated index.alt.singlefile.html");
  } catch (error) {
    console.error("[singlefile] Build failed:");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

function syncFromSinglefileWithLogging() {
  try {
    extractAppFiles();
    console.log("[singlefile] Updated index.html, styles.css, and app.js");
  } catch (error) {
    console.error("[singlefile] Sync failed:");
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

function watchSources() {
  const sources = [SOURCE_HTML, SOURCE_CSS, SOURCE_JS];
  let timer = null;

  const scheduleBuild = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      syncToSinglefileWithLogging();
    }, 60);
  };

  const watchers = sources.map((filePath) => fs.watch(filePath, scheduleBuild));
  console.log("[singlefile] Watching index.html, styles.css, and app.js");

  const stop = () => {
    for (const watcher of watchers) watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const argv = new Set(process.argv.slice(2));
const syncFromSinglefile = argv.has("--from-singlefile");
const watch = argv.has("--watch");

if (syncFromSinglefile) {
  syncFromSinglefileWithLogging();
} else {
  syncToSinglefileWithLogging();
}

if (watch) {
  if (syncFromSinglefile) {
    console.error("[singlefile] --watch is only supported when syncing split files into the bundle");
    process.exitCode = 1;
  } else {
  watchSources();
  }
}
