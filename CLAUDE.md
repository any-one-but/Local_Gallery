# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run the app in development (electron .)
npm run dist       # Build distributable (electron-builder, outputs to dist/)
npm run release:patch  # Bump patch version, commit, push, and build dist
```

No test suite exists in this project.

## Architecture

Local Gallery is an Electron desktop app for viewing and organizing a local media library. It has three layers:

**`main.js`** — Electron main process. Minimal: creates the window, exposes one IPC handler (`downloads-write-file`) for saving files to the system Downloads folder, and bridges the renderer to the native filesystem via `preload.js`.

**`preload.js`** — Context bridge. Exposes `window.electronAPI` with two methods to the renderer: `getPathForFile()` (wraps `webUtils.getPathForFile`) and `writeDownloadFile()` (invokes the IPC handler). All other logic is renderer-side.

**`index.html`** — The entire application UI and logic, ~54k lines. It contains two auto-generated inline sections (do not edit the delimiters):
- `<!-- BEGIN: inlined from ./styles.css -->` … `<!-- END: inlined from ./styles.css -->` — all CSS
- `<!-- BEGIN: inlined from ./app.js (auto-generated) -->` — all JavaScript

The app uses the **File System Access API** (`showDirectoryPicker`, `getDirectoryHandle`, `getFileHandle`, `createWritable`) rather than Node.js filesystem access. Persistent metadata is stored in a `.local-gallery/` hidden directory inside the user's chosen root folder.

### Core data model (`WS` global)

The `WS` object (defined at line ~14915) is the single global workspace state:

- `WS.root` / `WS.dirByPath` — directory tree. Nodes are `DirNode` objects created by `makeDirNode()`. The tree is built from file handles obtained via the File System Access API.
- `WS.fileById` — `Map<id, FileRecord>`. Each `FileRecord` holds `{ id, file, name, relPath, dirPath, ext, type, url, thumbUrl, videoThumbUrl, ... }`. Object URLs are created on demand and revoked when the workspace resets.
- `WS.catalog` — on-disk catalog for deferred loading of large libraries (stored as sharded JSON in `.local-gallery/catalog/`).
- `WS.meta` — user preferences, scores, tags, keybinds, appearance presets. Persisted to `.local-gallery/` as JSON log files: `folder-scores.log.json`, `folder-tags.log.json`, `preferences.log.json`, `keyboard-configuration.log.json`, `folder-votes.log.json`.
- `WS.view` — transient UI state (filter mode, slideshow, bulk select, search, navigation history, active pane, etc.).
- `WS.nav` — the currently listed directory and its `entries[]` (mixed `{kind:"dir"}` / `{kind:"file"}` list) used for the List Pane.
- `WS.preview` — what the Preview Pane currently shows (`kind`, `dirNode`, `fileId`).

### UI layout

Three panes rendered via CSS grid in `#app`:
1. **Title Pane** (`#titlePane`) — current folder title and search bar.
2. **List/Directories Pane** (`#directoriesPane`) — folder tree + file list for the active directory.
3. **Preview Pane** (`#previewPane`) — media viewer (image/video/gif) with a control bar (`#controlPane`).

`renderPreviewPane()` (line ~46577) is the main re-render entry point for the preview side. The directories/file list side is rebuilt through `rebuildDirectoriesEntries()` and related helpers.

### Companion scripts

- **`clean.sh`** — standalone Bash utility run separately against a media folder. 11 optional processing steps: dedupe (`fdupes`), similar-media culling (`czkawka`), video conversion (`ffmpeg`), resize, metadata removal (`mat2`), name sanitization, empty-item quarantine, AI upscale/denoise (`waifu2x-ncnn-vulkan`), video trimming. Not invoked by the Electron app.
- **`*.user.js`** — Tampermonkey/Violentmonkey userscripts bundled alongside the app for downloading media from external sites into the gallery folder. They are independent of the Electron app.

### Release workflow

`npm run release:patch` (`scripts/release-patch.js`) bumps the last numeric segment of the zero-padded version (e.g. `01.06.38` → `01.06.39`), writes both `package.json` and `package-lock.json`, commits with message `release: v<version>`, pushes, then runs `npm run dist`. Use `--dry-run` to preview without side effects.

A GitHub Actions workflow (`.github/workflows/build-windows.yml`) runs `electron-builder --win` on push to `main` and uploads `.exe`/`.msi`/`.zip` artifacts.
