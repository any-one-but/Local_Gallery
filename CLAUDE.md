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

## Navigation model (file pane vs. preview grid)

This is the conceptual model the keyboard/grid navigation is built on. Keep it in mind when touching `navigateToDirectory`, `enterSelectedDirectory`, `leaveDirectory`, the quick-navigation helpers, or the pane-restore functions.

### The two panes

- **The file pane (directories pane) is authoritative.** `WS.nav.dirNode` is the *official current directory*; the file pane lists that directory's children, and `WS.nav.selectedIndex` is the selected child.
- **The preview pane is always exactly one level below the file pane.** It renders the contents of the *currently selected child* (`WS.preview.dirNode` = the selected folder), shown as the "grid". The grid is a UX fudge that makes browsing feel like a second interaction mode, but structurally the preview is always one directory deeper than the file pane. `WS.view.previewSelectedKey` is the selected card *within* that grid — a second, independent selection cursor from the file pane's.

So at any moment: file pane = directory **D**, selected child = **C**, preview = **C's contents**, grid cursor = some item inside C.

### Quick navigation (auto-closing the sidebars for media folders)

"Quick navigation" (the `quickNavigation` option) makes opening a folder that contains *only files* (a "media folder") feel like the media instantly goes fullscreen: the app descends into the folder, selects the first file, and auto-closes the sidebars so the preview pane fills the window. Closing reopens the sidebars and returns you to where you started.

The subtlety is **how many directory levels the panes must jump**, which depends on where the folder was opened from:

- **Opened from the file pane** (`enterSelectedDirectory`): the media folder is a *direct child* of the current directory, so the file pane only descends **one level** into it. Closing is symmetric — reopen the sidebars and step up one level (`leaveDirectory`), which lands back on the pre-open view (the media folder selected in the file pane at `D`, its contents in the preview). No special return state is needed.
- **Opened from the grid** (`navigateToDirectory` → `enterMediaFolderWithQuickNavigation`): the file pane is **two (or more) levels above** the media. While browsing folder **G**'s grid, the file pane sits at `G`'s parent **D** (because the preview is one level down), and the media folder **M** the user clicks is a child of `G`. To put `M`'s media fullscreen, the authoritative directory must become `M` itself — so the file pane descends two levels (`D → G → M`).

### How the grid round-trip is implemented (the important part)

Opening `M` from the grid jumps the file pane straight to `M` (`WS.nav.dirNode = node`), selects its first file, and auto-closes the sidebars. The catch is closing: a naive single step up (`leaveDirectory`) or "close file to its folder" (`closeFilePreviewToFolder`) leaves the file pane and preview pane at **mismatched levels** — the de-sync bug.

The fix reuses the existing **preview-folder bridge** mechanism that `navigateToDirectory` already uses for regular (non-media) folders:

1. **On open**, `enterMediaFolderWithQuickNavigation` calls `captureViewerCloseRestoreState(...)` *before* descending to snapshot the full pre-open browsing view — current directory `D`, selected child `G`, the previewed subfolder (`G`'s contents), and a `pendingPreviewSelectionKey` of `dir:<M.path>` so `M` is re-selected in the grid on return. That snapshot is stored in `WS.view.previewFolderBridgeReturnState`. It *also* captures the quick-nav sidebar-close state (`captureQuickNavigationDirectoryEnterRestoreState` → `maybeClosePanesForQuickNavigationDirectoryEnter`) so the sidebars can be reopened.
2. **On close**, the exit paths check for that bridge state:
   - `restorePanesClosedByFilePaneEnter` (sidebars were auto-closed) reopens the sidebars, then — if `previewFolderBridgeReturnState` exists — calls `restorePreviewFolderBridgeState()` to jump *both* panes back to the captured grid view in one step (instead of `leaveDirectory`). If there's no bridge state (file-pane open), it falls back to the single-level `leaveDirectory`.
   - `handleClosedFilePaneNavigationAction` (sidebars were already closed) does the same: restore the bridge state if present, else `leaveDirectory` with the just-left item set as `pendingPreviewSelectionKey`.

`restoreViewerCloseState` (called via `restorePreviewFolderBridgeState`) restores `WS.nav.dirNode`, the selected entry, the previewed folder, and applies `pendingPreviewSelectionKey`, so the media folder you exited ends up selected and scrolled into view in the grid. `renderSelectedFolderMediaPreview` reveals a freshly-applied pending selection via `revealPreviewCard()` so the item you left is always visible.

**Net effect:** opening media from the grid descends two levels and goes fullscreen; closing reopens the sidebars and jumps both panes back up together to the exact grid view you came from, with the folder you were in still selected. Regular (non-media) grid folder opens use the same bridge state via `navigateToDirectory`; the only thing quick-nav adds is the sidebar auto-close/reopen on top of it.
