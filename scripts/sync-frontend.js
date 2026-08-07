#!/usr/bin/env node
// Copy the canonical UI (root index.html) into a clean ./frontend dir that
// Tauri uses as `frontendDist`. Keeping a dedicated dir means the Tauri build
// embeds ONLY the UI — not node_modules/.git/dist. Root index.html stays the
// single source of truth (the Electron app still loads it directly).
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "frontend");
fs.mkdirSync(outDir, { recursive: true });

// variations.html is the embedded Variations webview's page (WebviewUrl::App
// resolves against frontendDist). It is also a standalone app that runs from a
// plain browser, which is why it lives at the repo root next to index.html
// rather than being generated.
for (const file of ["index.html", "variations.html"]) {
  fs.copyFileSync(path.join(root, file), path.join(outDir, file));
  console.log(`synced ${file} -> frontend/${file}`);
}
