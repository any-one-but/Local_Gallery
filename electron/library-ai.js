// The guide and the tool for AI assistants that edit a library from outside
// the app (see "Editing from outside the app" in CLAUDE.md). Their sources are
// library-ai/ in the app; the page asks for them to be written into each
// library it opens:
//
//   <library>/CLAUDE.md                  the guide (read first)
//   <library>/.local-gallery/CLAUDE.md   a pointer to it, beside the logs
//   <library>/.local-gallery/ai/lg.py    the tool that makes the changes
//
// A copy is rewritten only when it differs, so every library carries the
// guide and tool of the app that last opened it.

"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "library-ai");

const FILES = [
  { from: "CLAUDE.md", to: ["CLAUDE.md"] },
  { from: "metadata-CLAUDE.md", to: [".local-gallery", "CLAUDE.md"] },
  { from: "lg.py", to: [".local-gallery", "ai", "lg.py"], mode: 0o755 },
];

// The library the page last opened, so quitting can say the app has closed.
let openLibrary = "";

async function install({ root }) {
  const lib = String(root || "");
  if (!lib || !fs.existsSync(path.join(lib, ".local-gallery"))) {
    throw `not a library: ${lib}`;
  }
  openLibrary = lib;
  const written = [];
  for (const file of FILES) {
    const data = await fsp.readFile(path.join(SOURCE_DIR, file.from));
    const target = path.join(lib, ...file.to);
    let same = false;
    try {
      same = (await fsp.readFile(target)).equals(data);
    } catch {}
    if (same) continue;
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.lgtmp`;
    await fsp.writeFile(tmp, data, { mode: file.mode || 0o644 });
    await fsp.rename(tmp, target);
    written.push(file.to.join("/"));
  }
  return written;
}

// On quit: the page's status file (features/outside-edits.js) would otherwise
// say "open" until it went stale. Synchronous, since the app is going away.
function markClosed() {
  if (!openLibrary) return;
  const file = path.join(openLibrary, ".local-gallery", "ai", "app-status.json");
  try {
    const status = JSON.parse(fs.readFileSync(file, "utf8"));
    Object.assign(status, { open: false, libraryOpen: false, updatedAt: Date.now() });
    fs.writeFileSync(file, JSON.stringify(status, null, 1));
  } catch {}
}

module.exports = { install, markClosed };
