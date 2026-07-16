# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start          # Run in development: tauri dev (system WebView + Rust backend)
npm run tauri:dev  # Same as above (explicit)
npm run tauri:build # Production build (.app + .dmg etc via Tauri)
npm run build      # Alias for tauri:build
npm run dist       # Alias for tauri:build (kept for compatibility)
npm run release:patch  # Bump patch version, commit, push, and tauri build
```

Tauri requires Rust + Cargo. The npm tauri:* scripts ensure cargo is on PATH.

No test suite in the JS; `cd src-tauri && cargo test` runs the Rust unit tests (fs + thumbnail generation).

## Architecture

Local Gallery is a **Tauri v2 + Rust** desktop app. The heavy UI (~58k line monolith) lives in the web layer; OS/filesystem/thumbnail work is in native Rust.

**Key layers:**
- `src-tauri/` — the Rust backend crate:
  - `tauri.conf.json` — product, build (before*Command runs sync-frontend + prepare-ffmpeg), frontendDist: "../frontend", asset protocol, bundle.
  - `src/main.rs` — thin binary entry.
  - `src/lib.rs` — builds the window, **injects initialization scripts** (tauri-bridge + tauri-fs-shim) so they run before page JS, registers all invoke commands, ffmpeg path setup.
  - `src/fs.rs` — native commands: pick_root, scan_dir, read/write_file_bytes, rename, remove, allow_media_scope, last-root persistence, etc. All heavy work uses spawn_blocking.
  - `resources/ffmpeg` — bundled ffmpeg (copied by prepare-ffmpeg.js from ffmpeg-static).
- `tauri-bridge.js` — injected as initialization_script: installs `window.electronAPI` (isElectron + isTauri + writeDownloadFile + getPathForFile) + `__lg` dev helpers (ping, requestThumb, assetUrl) over Tauri invoke.
- `tauri-fs-shim.js` — injected: overrides `window.showDirectoryPicker` and implements TauriDirHandle / TauriFileHandle / TauriWritable on top of Rust fs commands so the existing handle-based workspace builder runs unchanged. Also grants asset scopes and remembers rootPath for thumbs.
- `index.html` (root) — the entire application. Two auto-generated inlined blocks (do not hand-edit the delimiters):
  - `<!-- BEGIN: inlined from ./styles.css -->`
  - `<!-- BEGIN: inlined from ./app.js (auto-generated) -->`
  The root `index.html` is the source of truth. Before Tauri dev/build, `scripts/sync-frontend.js` copies it to `./frontend/index.html` (the clean `frontendDist` so the bundle contains only UI, not node_modules or .git).
- Rust commands are invoked via `window.__TAURI__.core.invoke(...)` (or the shims).

**Media & thumbnails:**
- All media served through Tauri's asset protocol (`convertFileSrc` / `window.__lg.assetUrl`).
- Thumbnails: `generate_thumbnail` command (image crate for images; ffmpeg for video frames at chosen time; QuickLook fallback). Results cached under `<root>/.local-gallery/thumbs/` (explicitly scoped).

**Persistence:**
- `.local-gallery/*.log.json` files written via the fs shim (same format as before).

The app still uses **File System Access API surface** (showDirectoryPicker etc.) but it is fully shimmed — no real browser FS API or Node fs in renderer.

The `WS` global, navigation model, three-pane UI, etc. are unchanged in the web layer.

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
1. **Title Pane** (`#titlePane`) — the tab strip (`#tabBar`), and nothing else. Its grid row collapses unless 2+ tabs are open (`#app.tabs-multi`), so a single-tab window has no top bar. The folder title / info / search row (`#titlePaneTop`) lives in `#stackedTitleHost` inside the file pane, so it hides together with that pane.
2. **List/Directories Pane** (`#directoriesPane`) — folder tree + file list for the active directory.
3. **Preview Pane** (`#previewPane`) — media viewer (image/video/gif) with a control bar (`#controlPane`).

`renderPreviewPane()` (line ~46577) is the main re-render entry point for the preview side. The directories/file list side is rebuilt through `rebuildDirectoriesEntries()` and related helpers.

### Tabs

`WS.tabs` (`{ items: [{id, state}], activeId, seq }`) holds the open tabs. A tab's `state` is a `captureViewerCloseRestoreState()` snapshot — the same shape the viewer-close and preview-folder bridges use — so a tab restores the whole browsing location (file pane dir + selection + scroll, preview contents, grid cursor, filters, search, tag portal stack).

Only one tab is live: **the active tab's `state` is `null`**, because its state *is* `WS.view`/`WS.nav`. Switching captures the outgoing tab (`captureActiveTabState()`) and restores the incoming one (`restoreViewerCloseState(state, { preferCachedEntries: true })`). Inactive tabs are inert plain objects — no DOM, no timers, no thumbnails — so N tabs cost O(1).

A tab is named for its **preview location** (see "Which pane is the location"), not its file pane directory — so a tab whose `state.dirPath` is `Gamma` is named `Nested` when its preview shows `Gamma/Nested`. `tabPreviewLocation()` resolves that: the active tab reads live `WS.preview` so its name tracks browsing without re-capturing, while inactive tabs read the `previewState` in their snapshot. `computeTabLabels()` then qualifies ambiguous names with as many ancestor folders as it takes to make them distinct (one parent is often not enough — `Alpha/Nested/n1.png` and `Gamma/Nested/n1.png` share theirs); tabs on the genuinely same location keep matching names. `syncActiveTabLabel()` patches only changed label text on navigation instead of rebuilding the strip.

Three invariants to preserve when touching this:
- **Paths.** Tab snapshots store raw path strings, so `updateViewStatePathsForRename()` loops `WS.tabs.items` and re-keys them; without it a renamed/moved/trashed folder teleports that tab to root.
- **Node refs.** Snapshot `navEntries` hold live `DirNode`s. `resetWorkspace()` bumps `NAV_ENTRY_RESTORE_REVISION` (via `invalidateDirMetricsCaches()`), which makes `restoreNavEntriesFromViewerCloseState()` reject stale caches and rebuild. Don't bypass that revision check.
- **Preview context must not leak between tabs.** `WS.preview` is global. `restoreViewerCloseState()` by default only restores the captured `previewState` when `activePane === "preview"`, and otherwise re-derives it from the selection — but that derivation reads the *live* `WS.preview` for a previewed file's context (`currentFilePreviewContextDir()`), which mid-switch is still the **outgoing tab's**. The incoming file then resolves against a folder it isn't in: `previewFileIdVisibleInContext()` fails and the pane shows the wrong file, or "No visible file" when the leaked folder has nothing passing the filter. Tabs therefore pass `restorePreviewForAnyPane: true`, which restores the snapshot's context directly (and clears `WS.preview` first when there is nothing to restore). `resolveFilePreviewContextDir()` additionally guards the restore: an empty `dirPath` means "no context captured" but is also root's key, so a plain-folder context is trusted only when it really is the file's own folder (portal contexts are trusted as-is).

`seedTabsForWorkspace()` runs once per workspace build (all three of `buildWorkspaceFromDirectoryHandle` / `buildWorkspaceFromFiles` / `buildWorkspaceFromFileList`). It takes the same-root refresh carry-over, else the persisted set from `tabs.log.json`, else a single default tab. Only a real tab set (2+) is persisted; with one tab an empty doc is written so startup keeps its root-landing behaviour.

Actions: `newTab` (root, default `Cmd+t`), `duplicateTab`, `closeTab`, `openInTab`, `openInNewTabs` — all bindable. `Cmd+1`–`Cmd+9` jump by index (`Cmd+9` = last) and are **reserved**, handled directly in the global keydown listener rather than via `KEYBIND_ACTIONS`.

`openInTab` / `openInNewTabs` build their tabs with `makeLocationTabState()`, which places a tab *at* an item — preview shows it, so the tab is named for it. They target the grid's card when the preview pane is active, else the file pane's selection (`openInTabSelectionTarget()`). `openInTab` switches to the new tab; `openInNewTabs` opens every sub-item as a background tab and stays put, capped by `OPEN_IN_NEW_TABS_LIMIT` (30) — over that it is refused outright with an alert rather than partially opened. Sub-items are whatever the grid shows for that item (`openableSubItemTargets()`), so filters and hidden/trash visibility are respected.

**Three target kinds** (`tabTargetForEntry()`): `dir`, `file`, and `tag` — where `tag` covers albums, tags, and the special buckets (Favorites/Hidden/Untagged/Storage), since those are all `kind: "tag"` entries. Only the bulk-tag placeholder is not openable. A portal tab is anchored to the real folder the entry belongs to (`entry.originPath`): the file pane sits there with the album/tag entry selected and the portal in the preview, so no `tagNavStack` is needed — that stack is for *entering* a portal, whereas a tab is merely located *at* one. Its `previewState` comes from `capturePreviewRestoreState()` so it matches the `tag-dir` shape `restoreViewerCloseState()` already knows how to rebuild (via `makeTagPreviewNodeForContext()`). `openInNewTabs` on an album therefore yields a tab per tag, and on a tag a tab per member folder.

Two gotchas when touching portal tabs: a portal's node `path` is a synthetic `<base>/@tag-<suffix>` that must never surface in a tooltip (`tagPortalDisplayPath()` presents `<origin>/<label>` instead), and `previewState.tag` is **empty** for albums and specials, so a tab's label must be taken from the rebuilt node's name rather than that field.

### Companion scripts

- **`clean.sh`** — standalone Bash utility run separately against a media folder. 11 optional processing steps: dedupe (`fdupes`), similar-media culling (`czkawka`), video conversion (`ffmpeg`), resize, metadata removal (`mat2`), name sanitization, empty-item quarantine, AI upscale/denoise (`waifu2x-ncnn-vulkan`), video trimming. Not invoked by the Tauri app.
- **`*.user.js`** — Tampermonkey/Violentmonkey userscripts bundled alongside the app for downloading media from external sites into the gallery folder. They are independent of the app.
- `scripts/sync-frontend.js` — copies root index.html -> frontend/ (run automatically by Tauri beforeDev/beforeBuild).
- `scripts/prepare-ffmpeg.js` — copies ffmpeg-static binary into src-tauri/resources (for bundled video thumbnailing).

### Release workflow

`npm run release:patch` (`scripts/release-patch.js`) bumps the last numeric segment of the zero-padded version (e.g. `01.06.38` → `01.06.39`), writes package.json + lock + src-tauri/tauri.conf.json + src-tauri/Cargo.toml (semver form), commits `release: v<version>`, pushes, then runs `npm run tauri:build`. Use `--dry-run` to preview without side effects.

Tauri produces platform bundles (macOS .app/.dmg, Windows, Linux) with the Rust binary + resources. CI for other platforms should use Tauri actions / rust + node setup (see .github/workflows).

## Navigation model (file pane vs. preview grid)

This is the conceptual model the keyboard/grid navigation is built on. Keep it in mind when touching `navigateToDirectory`, `enterSelectedDirectory`, `leaveDirectory`, the quick-navigation helpers, or the pane-restore functions.

### The two panes

- **The file pane (directories pane) is authoritative.** `WS.nav.dirNode` is the *official current directory*; the file pane lists that directory's children, and `WS.nav.selectedIndex` is the selected child.
- **The preview pane is always exactly one level below the file pane.** It renders the contents of the *currently selected child* (`WS.preview.dirNode` = the selected folder), shown as the "grid". The grid is a UX fudge that makes browsing feel like a second interaction mode, but structurally the preview is always one directory deeper than the file pane. `WS.view.previewSelectedKey` is the selected card *within* that grid — a second, independent selection cursor from the file pane's.

So at any moment: file pane = directory **D**, selected child = **C**, preview = **C's contents**, grid cursor = some item inside C.

### Which pane is "the location"

The two roles are split, and the distinction matters:

- **`WS.nav.dirNode` is authoritative for *navigation*** — what the file pane lists, what the keyboard moves through, what `leaveDirectory()` steps out of.
- **The preview pane is authoritative for *the location you are at*** — what the title pane path and the tab names report. That is the folder or file the preview currently shows (**C**, or a single file inside it), i.e. one level *below* `WS.nav.dirNode`.

So with the file pane at **D** and **C** selected, the title reads the path to **C**, not **D**; if a file is previewed, the title reads the path to that file and the tab is named for the file. `getPreviewLocationPathText()` builds that path and `previewLocationDirNode()` resolves the folder that qualifies it; `getCurrentTitleText()` / `getCurrentTitleInfoText()` / `computeTabLabels()` all read through them, so path, metrics, and tab name always describe the same place.

One trap: for a previewed **file**, `WS.preview.dirNode` is the *context it was opened from*, not necessarily its parent. In a portal grid (tag/favorites/hidden) that context genuinely is the location and wins. In a plain folder it merely holds the last previewed folder and lags the selection — arrowing off a subfolder onto a file sibling would otherwise report the file as living inside that subfolder. `previewLocationDirNode()` prefers the file's own folder there.

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
