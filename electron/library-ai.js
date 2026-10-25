// The instructions and the tool for AI assistants that edit a library from
// outside the app (see "Editing from outside the app" in CLAUDE.md). Their
// sources are library-ai/ in the app; the page asks for them to be written
// into each library it opens, inside its hidden data folder only -- nothing
// is ever added beside the user's own folders:
//
//   <library>/.local-gallery/AI-INSTRUCTIONS.md   the instructions (read first)
//   <library>/.local-gallery/ai/lg.py             the tool that makes the changes
//
// A copy is rewritten only when it differs, so every library carries the
// instructions and tool of the app that last opened it.

"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const SOURCE_DIR = path.join(__dirname, "..", "library-ai");

const FILES = [
  { from: "AI-INSTRUCTIONS.md", to: [".local-gallery", "AI-INSTRUCTIONS.md"] },
  { from: "lg.py", to: [".local-gallery", "ai", "lg.py"], mode: 0o755 },
];

// What v1.7.74 wrote instead, removed if they are still exactly the app's own
// (known by their first line); a file the user wrote there is left alone.
const RETIRED_FILES = [
  { at: ["CLAUDE.md"], firstLine: "# CLAUDE.md -- working on this Local Gallery library" },
  { at: [".local-gallery", "CLAUDE.md"], firstLine: "# CLAUDE.md -- .local-gallery (Local Gallery's data)" },
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
  for (const old of RETIRED_FILES) {
    const target = path.join(lib, ...old.at);
    try {
      const text = await fsp.readFile(target, "utf8");
      if (text.split("\n", 1)[0].trim() !== old.firstLine) continue;
      await fsp.unlink(target);
      written.push(`removed ${old.at.join("/")}`);
    } catch {}
  }
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
