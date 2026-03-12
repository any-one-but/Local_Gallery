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

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
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

  let out = html.replace(STYLE_LINK_RE, inlinedStyle);
  out = out.replace(APP_SCRIPT_RE, inlinedScript);
  fs.writeFileSync(OUTPUT_HTML, out, "utf8");
}

function buildWithLogging() {
  try {
    inlineAppFiles();
    console.log("[singlefile] Updated index.alt.singlefile.html");
  } catch (error) {
    console.error("[singlefile] Build failed:");
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
      buildWithLogging();
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

buildWithLogging();
if (process.argv.includes("--watch")) {
  watchSources();
}
