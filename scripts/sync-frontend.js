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
fs.copyFileSync(path.join(root, "index.html"), path.join(outDir, "index.html"));
console.log("synced index.html -> frontend/index.html");
