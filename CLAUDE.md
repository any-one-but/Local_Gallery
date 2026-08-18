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

No test suite in the JS; `cd src-tauri && cargo test` runs the Rust unit tests (there is no workspace Cargo.toml at the repo root): `fs` (scan/rename/import/metadata migration), `grok` (URL and clipboard handling), and `lib` (thumbnail generation, ffmpeg video-timing parsing).

## Architecture

Local Gallery is a **Tauri v2 + Rust** desktop app. The heavy UI (~66k line monolith) lives in the web layer; OS/filesystem/thumbnail work is in native Rust.

**Key layers:**
- `src-tauri/` — the Rust backend crate:
  - `tauri.conf.json` — product, build (before*Command runs sync-frontend + prepare-ffmpeg), frontendDist: "../frontend", asset protocol, bundle.
  - `src/main.rs` — thin binary entry.
  - `src/lib.rs` — builds the window, **injects initialization scripts** (tauri-bridge + tauri-fs-shim) so they run before page JS, registers all invoke commands, ffmpeg path setup.
  - `src/settings.rs` — legacy native Settings-window lifecycle (a second decorated webview loading the same document in settings-only mode, `IS_SETTINGS_WINDOW`). **No longer the primary path:** Settings is now an in-app floating window (see below). This module and its `open_settings_window` / `toggle_settings_window_command` invoke commands are retained but unused by the main flow.
  - `src/fs.rs` — native commands: pick_root, scan_dir, read/write_file_bytes, rename, remove, allow_media_scope, last-root persistence, etc. All heavy work uses spawn_blocking.
  - `probe_video_timing` (in `lib.rs`) — shells out to ffmpeg and parses duration + frame rate out of its stderr. Backs frame-accurate video thumbnail stepping; see "Thumbnail editing from the keyboard".
  - `resources/ffmpeg` — bundled ffmpeg (copied by prepare-ffmpeg.js from ffmpeg-static).
- `tauri-bridge.js` — injected as initialization_script: installs `window.electronAPI` (isElectron + isTauri + writeDownloadFile + getPathForFile) + `__lg` dev helpers (ping, requestThumb, assetUrl, generateThumbnail, probeVideoTiming) over Tauri invoke.
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

The app still uses **File System Access API surface** (showDirectoryPicker etc.).
Under Tauri it is fully shimmed — no real browser FS API or Node fs in renderer.
Opened as a plain web page the shim is simply absent and the **real** API is in
force, which is what makes the second host below possible.

### The two hosts (Tauri app and plain browser)

`index.html` runs in two places, and `LG_HOST_IS_APP` / `LG_HOST_IS_BROWSER`
(declared at the top of the app script) is the one switch that tells them apart.
Detection is reliable because Tauri's initialization scripts run *before* page
JS, so `window.electronAPI.isTauri` / `window.__TAURI__` are already there when
the flag is computed; their absence means a browser. `<html>` gets
`lg-host-app` or `lg-host-browser`.

**The two hosts are deliberately the same app, not two builds.** Both read and
write the same handle-based `.local-gallery/*.log.json` metadata, so a library
opened in one is byte-compatible with the other — `metaEnsureFsHandles` already
falls back to `<root>/.local-gallery` when the native metadata-root command is
missing, and `ensureMediaUrl` falls back from the asset protocol to blob object
URLs. Nothing else in the UI had to fork: every native call site
(`window.__lg.*`, `window.__TAURI__.core.invoke`) was already guarded with a
`typeof === "function"` test and degrades to a no-op or a "requires the desktop
app" message. What the browser therefore does not get: thumbnail/video-frame
generation and `probe_video_timing`, reveal-in-Finder, the native import
pickers, and the Grok/Claude/Variations webviews.

The one real difference is **how a root folder is obtained**. The app opens its
managed library silently (`openFixedAppMediaFolder`); a web page has no such
folder, and a directory picker may only be opened from a user gesture. So the
browser gets the **root prompt** (`#rootPrompt`, `syncBrowserRootPrompt`), a
full-window "Press Space to choose a root directory" shown whenever
`LG_HOST_IS_BROWSER && !WS.root`. It is kept in step with the `no-root-selected`
class inside `applyInteractionModeFromOptions`, so the two can never disagree,
and `hideBrowserRootPrompt()` takes it down the moment a build is committed to
rather than at the end of one (the loading overlay fades in over ~0.3s, and the
prompt would read through it). Its z-index sits *below* `#busyOverlay` for the
same reason.

The chosen `FileSystemDirectoryHandle` is stored in IndexedDB
(`lgBrowserRememberRootHandle`). The handle survives a reload; the *permission*
generally does not, and re-granting needs a gesture — which is what Space is
for, so the prompt reads "Press Space to reopen “Name”" and the user never has
to find the folder twice. When the permission did survive,
`openRememberedBrowserLibrary()` opens it at boot with no interaction at all.
`O` always forces a fresh pick. Both keys are handled in the `!WS.root` branch
of the global keydown listener; a refused or vanished folder forgets the handle
and falls back to the picker, so the prompt can never become a dead end.
Browsers without the File System Access API (Firefox, Safari) fall back to the
`webkitdirectory` input and `buildWorkspaceFromFileList`, which browses but
cannot write metadata — the prompt says so.

To run the browser host: serve the repo root (`python3 -m http.server 8123`) and
open `index.html`. The Tauri build is unaffected — `scripts/sync-frontend.js`
copies the same file.

The `WS` global, navigation model, three-pane UI, etc. are unchanged in the web layer.

### Core data model (`WS` global)

The `WS` object (`const WS = {`, search for it) is the single global workspace state:

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

Settings is an **in-app floating window**, not an OS window: `#menuOverlay`
gets the `menu-floating` class and becomes a `position: fixed` panel overlaying
the app (z-index above the fullscreen viewer). It has a `#menuTitleBar` drag
handle (with a ✕ close button) and eight `.menuResizeHandle` edge/corner
handles; geometry is clamped to the app viewport and persisted to
`localStorage` (`lg.settingsWindowGeometry`). Because it is the same document,
opening is instant — there is no second webview to load. `openMenu()` /
`closeMenu()` drive it; the drag/resize/geometry controller is
`initSettingsFloatingWindow()` and friends (near `openMenu`).

Toggle it with **Tab** (reserved, handled directly in the global keydown
listener alongside `Cmd+1`–`Cmd+9`, so it is not a bindable action). **`Cmd+,`
is intentionally disabled** — the default `toggleSettingsAndDirectoriesPanes`
binding is empty and the old dedicated Cmd+, listener was removed. The macOS
application-menu "Settings…" item has no accelerator and routes to the in-app
window via `window.__lgToggleSettings()` (evaluated from `on_menu_event`).

The legacy separate-`settings`-WebviewWindow mode (`IS_SETTINGS_WINDOW`) still
exists in the document but is no longer used; in that mode `#menuOverlay` fills
the window and metadata document events sync the main/Settings `WS` instances.

Settings deliberately does **not** duplicate what the app menu already offers.
`APP_ITEM_MENU_ACTIONS_ONLY = true` makes those actions menu-only: rows listed in
`APP_ITEM_MENU_SETTING_CONTROL_IDS` are hidden from the Settings pane, and
actions in `APP_ITEM_MENU_ACTION_KEYBIND_IDS` are dropped from the Controls tab
and ignored at runtime by `keybindActionFor()`. Stored option values and binding
assignments are left untouched, so flipping the flag to `false` restores both
surfaces. A few actions are intentionally *absent* from that set — favorite
selection and the random jumps are worth a direct key even though the menu also
offers them. The Settings window's own Tab shortcut is hard-baked and not
bindable.

`renderPreviewPane()` is the main re-render entry point for the preview side. The directories/file list side is rebuilt through `rebuildDirectoriesEntries()` and related helpers.

**Gotcha:** because the document is one giant script, several functions are declared more than once (`nudgeSelectedThumbnailViewport` has three declarations — two stubs and the real one). Hoisting means the **last** declaration wins, so when editing a function, `grep -c` for it first and make sure you are changing the one that survives.

### The app menu (the single command surface)

Almost every action and setting is reached through one keyboard-driven menu
(`#appActionMenu`, built by `buildAppMenuItems()`), opened by the bindable
`openAppMenu` action. It is positioned over the **first card in the preview
grid**, deliberately overlapping its corner so no sliver of the card shows
underneath (`positionActionMenuInPreviewDock`).

**The item menu no longer exists as its own surface.** It is folded in as the
first section, `Selected Item` / `N Selected Items`. `SEPARATE_ITEM_MENU_ENABLED
= false` gates every standalone entry point (`openDirMenuForPath`,
`openFileMenuForId`, `openTagEntryContextMenu`, `openPreviewFolderActionMenu`,
`openPreviewFileActionMenu`) — the keybind is gone, right-click is inert, and the
per-item `⋯` button renders only as the score/favorite badge
(`.thumbMenuBtnInert`; it carries no `disabled` attribute, since that would pull
in the sheet's disabled-button dimming). The gate checks `!opts.container`, so
the *same builders* still populate the app menu's section rather than a
reimplementation that could drift.

Menu order is fixed: title, `Selected Item(s)` **always first**, `Basics`
**always second**, Appearance filter, Reveal, `Add items`, Miscellaneous,
Refresh App **always last**. `Basics` holds the everyday view controls (quick
navigation, sort, media filter, mute messages, full screen media, float tags);
Grok, Claude and Variations have no menu entry at all and are reached only
through their keybinds.

### The embedded webviews (Grok, Claude, Variations)

Three full-window child webviews of the main window, each on its own bindable
toggle (`Cmd+g`, `Cmd+j`, `Cmd+u` by default), built lazily and then kept alive
and merely hidden so their state survives toggling. All three are sized by
`sync_*_bounds` from the main window's resize event.

**Grok and Claude** (`grok.rs`, `claude.rs`) are remote sites sharing
`embedded_web.rs`'s `EmbeddedSite`: saved location, host allowlist for what may
be resumed into, clipboard link capture, OAuth popup windows, Safari UA. They are
deliberately **not** on the IPC bridge — the capability is scoped by *webview*
label precisely so these children of the main window don't inherit it, since the
bridge would hand a remote, partly model-authored page `fs::remove_path`. They
talk to Rust through cancelled sentinel navigations instead (see
`embedded-inject.js`).

**Variations** (`variations.rs`) is the prompt composer, and it inverts that
choice for one reason: its page is *ours*. `variations.html` is loaded from the
bundle via `WebviewUrl::App`, making it first-party code at the same trust level
as index.html, so `variations` **is** listed in `capabilities/default.json` and
does have IPC. That is what lets it persist to
`<library>/.local-gallery/variations.json` (through the existing
`get_metadata_root` / `read_file_bytes` / `write_file_bytes`), and why it needs
no close sentinel — it invokes `close_variations_window` directly. It therefore
does not use `EmbeddedSite`, which exists to make *remote* content safe and
whose machinery is all inapplicable here. **The test for that capability list is
origin, not window: a bundled page may be listed, a remote one never.**

`variations.html` is the same file in both worlds. Rust injects
`__lgVariationsEmbedded` before page scripts run; the page requires that flag
*and* a live invoke handle before it switches to app mode, where it stores its
document in the metadata folder and adds a Close to the menu bar. Opened from a
plain browser it is a standalone app on localStorage. If it is embedded but no
library is open there is no metadata folder to write to, so it degrades to the
browser store and says so in the menu bar rather than silently saving elsewhere.
`scripts/sync-frontend.js` copies it into `frontend/` alongside index.html.

Import and Export exist in **both** modes and never change where the live
document is kept: an import merges into it and is flushed straight back to
whichever store is in force, an export is only a copy taken out. The mechanics
differ because the hosts do — a browser saves through an anchor with a blob URL,
while the app has no download UI to drive and goes through the native
`write_download_file` (the same one the gallery uses for its own exports, so the
file lands in Downloads with a sanitized, collision-free name).

#### The composer model: blocks, groups, arrangements, takes

A project is an ordered stack of **blocks**; each block holds **variants**, one
active. A variant is not a leaf: it holds **versions**, and the text lives on
the version (`variantText()` / `blockText()` are the only correct readers —
`variant.text` no longer exists outside the migration). Adjacent blocks can be
wired into a **group** (`block.groupId`), which adds a second switch and its own
variants, called **arrangements**: an arrangement records which members are on
and which variant *and version* each one shows. So the ladder is version inside
variant inside arrangement inside the stack. A block reaches the prompt only via
`blockIncluded()` — its own switch *and* its group's.

A **word bank** (`project.banks`) is the one project-wide knob: a
SCREAMING_SNAKE name, a list of words, one selected. `bankSegments()` splits
text into plain runs and bank hits in a single pass, longest name first so
`TONE` cannot eat the front of `TONE_STRICT`, with character-class guards
rather than `\b` because an underscore is a word character. It is called from
`blockPart()` only, so substitution happens in exactly one place and the output
pane cannot disagree with the clipboard. A bank with no usable word is left
unsubstituted on purpose — an unfilled bank shows its own name rather than
silently deleting itself. Renaming a bank rewrites every mention in every
version, or it would stop resolving everywhere it was already used.

Four invariants to preserve when touching this:

- **Members are contiguous.** A group is drawn as one container, so every
  grouping mutation ends in `normalizeGroupOrder(p)`, which pulls each group
  together at its first member's position. Reordering goes through
  `stackUnits(p)` (a loose block, or a whole group and its run) so a block hops
  over a group instead of tunnelling into it — `moveUnit` between units,
  `moveBlockWithinGroup` inside one. A group's extent is marked by the
  bookmark ribbon down its left side, built by `groupBookmarkNodes()` as two
  pieces: `.gribbon`, a bordered box that stretches with the group, and
  `.gtail`, a **fixed-size** SVG whose outline is a real stroke. The tail must
  not scale — and two offset `clip-path` polygons cannot draw it, because the
  ink mitres to a spike where the notch closes and reads as biting into the
  accent; a stroked path with a round join does not. The two overlap by 1px so
  no seam shows. The gutter the ribbon hangs in is the extra left padding on
  `#stack .body`, and `--group-ribbon` is declared on `.group` rather than
  `:root` so the dusk accent actually reaches it (a `var()` inside a custom
  property is substituted where it is *declared*).
- **A group is one paragraph.** `promptUnits()` is the single source for both
  the assembled text and the output pane, so what you read and what you copy
  cannot disagree. A loose block is its own paragraph; a group's included
  members are joined by `GROUP_JOIN` into one. The pane renders one `.seg` per
  paragraph and one `.segpart` per block inside it, which is what keeps
  per-block hover lighting working when several blocks share a paragraph
  (`litSegment` resolves any `[data-block]`, `litGroupSegment` the whole
  `.seg[data-group]`). With `includeLabels`, a group emits one heading of its
  own instead of one per member — per-member headings would split the
  paragraph back apart.
- **Arrangements are live, not copies.** Whatever the members are doing now
  *is* what the active arrangement means, the way typing edits a block's active
  variant. `syncActiveArrangements()` is called from `touch()`, so no mutation
  can forget it, and it writes only on a real change. The corollary:
  `pickArrangement` must set `activeVariantId` **before** `touch()`, or the
  outgoing arrangement is overwritten with the incoming one's state.
- **Absent means off, at both levels.** An arrangement that has never heard of
  a member treats it as off; a take that never saw a block or group treats it
  as off. A snapshot cannot vouch for text written after it. `shuffleMix` rolls
  the groups first and lets `applyArrangement` land before rolling the loose
  blocks, or the arrangement would immediately overwrite the randomised members.
- **One deliberate exception.** A take with no record for a *group* derives it
  from its members (on if the take had any of them on), so grouping two blocks
  an older take had on does not hide them both. `resolveTake()` is the single
  place that decides all of this, and `applyTake`, `takeSignature` and the take
  menu all read through it.

Takes store `{blocks: {id: {v, ver, on}}, groups: {id: {v, on}}, banks: {id: wordId}}`.
`normalize()` is the single migration point and handles three generations at
once: the `{picks, disabled}` pair, a missing `groups` array, and — for
documents written before versions and banks — lifting `variant.text` into a
one-entry `versions` array, upgrading arrangement picks from a bare variant id
to `{v, ver}`, and adding `ver: null` / `banks: {}` to takes. The old shape only
listed blocks that existed when it was saved, so its key set is exactly what it
is entitled to speak for.

**`ver: null` means "no opinion", not "the first version".** A take or
arrangement written before versions existed, or one whose version has since
been deleted, must leave the variant on whatever version it is already showing.
The "absent means off" rule is for blocks and groups and deliberately does not
extend to versions or banks, neither of which has an on/off to fall back to —
`resolveTake()` is where all of that is decided.

#### Notes, the filter, dragging, and dependencies

Four things sit *on top* of that model rather than inside it, and the reason
they can be read separately is that none of them writes to the document in a
way the others have to know about.

**Inline notes** are commentary that never reaches the prompt. `splitNotes()`
is the whole feature: a line beginning with `//` is a note, and a line that is
only `//` opens one that runs to the next line that is only `//` (unterminated,
it runs to the end — the editor bands every note line, so a stray opener is
visible rather than mysterious). It is a *parse, not a store*: the raw string
keeps its notes and is what is saved, edited, forked, exported and diffed, and
only the readers that feed the prompt call `stripNotes` — `blockPart`, the
counts, `mixSnippet`, Copy part, and the bank usage tally. The diff deliberately
keeps them, because a changed annotation is a change. **Notes come out before
the banks go in**, or a bank named inside a note would substitute.

The editor's note bands are a backdrop div mirroring the textarea one `.edline`
per line with *transparent* text (`paintNoteBands`). The visible glyphs are
always the textarea's own, so a metric mismatch can misplace a rectangle but can
never ghost the text; the horizontal padding lives on the lines rather than the
backdrop so a band spans the full width, and a zero-width space keeps an empty
line one row tall.

**The filter** (`stackFilter`, `ui.searchQuery`) is a view and nothing else.
It hides rows; it never touches the document, so switching a variant or saving
a take while it is up acts on the whole project, and the Assembled pane is
untouched. Two rules are worth keeping: chips narrow only when the search
actually matched something *inside* that block (a block matched by its label is
shown whole), and **the active variant's chip is always kept**, or the editor
below would be showing text whose chip is missing. `ui.searchQuery` is blanked
in `load()` — `ui` is persisted wholesale, and opening into a filtered stack
would read as data loss. `visibleBlocks()` is what `j`/`k` walk.

**Dragging** is a pointer gesture, not HTML5 drag-and-drop: this page is a child
webview of a window whose native drag handler is the thing everything else works
around. It commits through `moveUnitTo` / `moveBlockWithinGroupTo`, the same
primitives the ↑↓ buttons use, so it cannot invent an ordering the keyboard
could not produce. Drop slots are read once at drag start off `data-unit-index`
/ `data-member-index`, which carry the **real** indices, so a filtered view
still reorders the whole stack. There is deliberately no slot that would split
a group or move a block across one.

**Dependencies** (`conditions[]` on a block, variant, version or group) are the
one addition with a schema change, and they are declarative and local: the
dependent owns the condition, the source knows nothing. `depOff()` returns a
bare boolean, cached per render (`invalidateDeps()` from `touch()` and each
render entry point) and guarded by a busy set so a cycle is broken by treating
the re-entered item as passing.

**A failing condition holds its item off; it never removes it from the stack.**
That is the whole behaviour and there is nothing to configure — the condition
has no `effect` field, and the editor has no effect picker. An earlier draft
offered hide-or-mute; hiding was dropped rather than migrated, because a
dependent that disappears loses whole sections behind a controller you then
have to remember, and the way back is the thing no longer on screen. Held off
means struck through, switch locked, reason on the badge, out of the prompt.
`normalizeConditions()` simply drops any stored `effect`.

Three rules hold the rest together:

- **Fail-open.** A condition whose source is missing passes, so deleting a
  controller can never leave content stuck off. `pruneConditionSources()`
  drops such conditions at load and after a delete; ids *inside* a condition are
  left alone, because a condition naming a deleted variant is a condition that
  no longer passes, and saying so is more honest than widening it.
- **Nothing is rewritten.** An item a condition switched off keeps its own
  switch, variant and version. `effectiveVariant` / `effectiveVersion` pick the
  fallback for the render and the prompt only; `activeVariantId` is untouched,
  which is what lets an arrangement or a take name a currently held-off variant
  and have it come back exactly as recorded.
- **One reading of "on".** `blockIncluded` means enabled *and* available *and*
  its group likewise, and that is what a condition's `enabled` constraint tests
  — "on" means "actually in the prompt".

The lock is on the item's own switch only (`.block.depoff > .head .switch`): a
member of a held-off group keeps its own toggle, because that is the group's
arrangement being edited rather than the condition being overruled.

Within one condition the id lists are OR and `enabled` is a separate AND;
several conditions on one item are AND. Anything that walks variants by
keyboard (`cycleVariant`, `cycleVersion`, `pickVariantByIndex`, `shuffleMix`)
skips what is held off, so the keys move between the chips you could have
clicked. `normalize()` coerces a missing `conditions` to `[]`, and
`remapConditions()` re-points every id when a project or a block is duplicated.

The old standalone background context menu (Add folders/files, Reverse file
order) was folded into the app menu. `Add items` (import folders/files into the
current location) is omitted when the location can't be imported into (portals,
trash); `Reverse file order` lives under `Miscellaneous` and acts on the current
location, disabled when it can't be reordered. Both resolve the location via
`getPreviewTargetDir()`, not the selected item.

### Keyboard-only interaction

The app is being moved off the cursor. A `#keyboardOnlyModeStyles` block sets
`pointer-events: none` on the preview/file grid cards (`[data-preview-item-key]`)
and on `#appActionMenu`, so selecting cards, entering folders, hover states, and
mouse drag-reorder are all keyboard-only, and the app menu is navigated only by
its bindable key (its scroll container keeps pointer events so the wheel still
scrolls). **Right-click opens nothing** anywhere — the two background
`contextmenu` handlers just suppress the native menu; item/tag/bulk context
menus were already inert (`SEPARATE_ITEM_MENU_ENABLED = false`). The **Settings
floating window (`#menuOverlay`) is the one surface left fully cursor-interactive**
(and native right-click still works inside real text inputs and Settings for
copy/paste). Removed cursor features: the mouse thumbnail **crop-editor window**
(`openThumbnailCropEditor` early-returns; keyboard Cmd+arrow editing stays — see
below — and the "Edit thumbnail" menu entries are gone) and the four-video
**quad/gallery playback** (`openQuadPlaybackForRecords` is an inert stub; its
"Play" menu branches were removed).

### History in the app menu (Stats / Calendar)

Score history was pulled out of the settings pane entirely (its "Stats" tab —
id `calendar`, the `#calendarBody` panel — is gone; `MENU_TAB_IDS` is now just
`controls`, and the panel element is left in the DOM but unreachable so
`renderCalendarUi` stays a harmless no-op) and rebuilt as **real app-menu
submenus** under a top-level **`History`** entry (between Miscellaneous and
Refresh App) → **Stats / Calendar** (`buildAppMenuHistorySubmenu`). They are
navigated by the keyboard like any other app-menu submenu, not as overlays.
Their panels are widened past the normal menu width and height-capped with
scroll (`.appMenuStatsPanel`, `.appMenuCalendar`) so long lists don't run off
the screen and days have room.

- **Stats** (`buildAppMenuStatsSubmenu`): one view-only `<button class="appMenuStatsRow">`
  per root folder (name + score + reused `.statsLedgerScoreBar`), sorted by score.
  The buttons are walked by the normal option cursor but do nothing on activate.
- **Calendar** (`buildAppMenuCalendarSubmenu`): a compact `.appMenuCalendar` month
  grid (`buildHistoryCalendarMonthsHtml`) passed as the submenu's single non-button
  item, so the normal option walker finds no options in its panel. The app-menu
  keydown handler special-cases it via `handleAppMenuCalendarKey`: when
  `appMenuActiveCalendarPanel` finds an open calendar panel, the movement keys
  walk the day cells (±1 / ±7, `APP_MENU_CALENDAR_SELECTED_DAY` remembers the
  cursor across rebuilds, default today), the enter key closes the app menu and
  opens that day's `openDailyJournalEditor`, and the exit key steps back to the
  History submenu (a manual `setDropdownSubmenuOpen(false)` since the generic
  collapse skips a panel with no options). The day cursor
  (`.appMenuCalendarDaySelected`) uses the same blue as the regular preview
  selection (`var(--anchor-internal-color2-primary)`).

The **daily journal editor** has no close button — Escape (its capture handler)
is the only way out.

The **confirm/alert dialog** (`showConfirmDialog`) answers to the user's own
keybinds: the key bound to `enterDir` confirms ("yes"), the key bound to
`leaveDir`/`back` cancels ("no"), alongside the hardcoded Enter/Escape.

- The bold heading (`.dropdownMenuTitle`) names the selection; it is not a
  button, so the option walker skips it and it can never take the cursor.
- `appMenuSelectionTarget()` resolves what the section acts on — the bulk
  selection when there is one, else the single item the active pane has
  selected. `selectedItemQuarantineAction()` replaces the whole dropdown with a
  single `Remove from Trash` / `Remove from Storage` button for an item in
  either, tested via `trashTopLevelItemPathForPath()` so the Trash root portal
  (a container, not a removable item) is correctly excluded.

**Keyboard model.** An open menu takes the whole keyboard: the handler runs in
the capture phase, `preventDefault` + `stopImmediatePropagation`s every key, and
dispatches only its own actions, so nothing reaches the file tree behind it.

- Navigation uses the **user's own bindings**, not hardcoded keys:
  `selectUp`/`selectDown` walk options, `selectRight`/`selectLeft` open and close
  submenus (left at the top level leaves the menu, "back out toward the spine"),
  `enterDir` **or** `openAppMenu` activates, `leaveDir` closes outright. Escape
  is a fixed way out if the exit action is unbound.
- **Arrow keys are reserved for value editing**, never navigation.
- The first option is selected as soon as the menu opens (`ensureMenuHighlight`),
  and the cursor is pulled into an open submenu rather than stranded in the
  parent panel.
- The app menu is **navigation-only** (`isNavigationOnlyAppMenu`): no number
  labels, no digit activation, no ten-option `More...` pagination. Legacy
  context menus still get all three.

**Multi-choice options are cycle buttons, not submenus.** A row reads
`Label: CurrentValue` and advances on activation — `menuCycleChoiceState` +
`buildAppMenuCycleButton` (and `createCyclingItemMenuButton`,
`createAppearancePresetCycleButton`, `createContainerSortCycleButton`,
`createTagMediaFilterAxisCycleButton` for the legacy menus).

**Changing a setting never closes the menu.** Policing each option handler was
never going to be complete — several reach `closeActionMenus()` through nested
and async render paths — so activation opens a suppression window
(`suppressMenuAutoClose`) during which `closeActionMenus` / `closeAppMenu` /
`closeTagContextMenu` / `closePreviewContextMenu` all no-op. Only a deliberate
gesture calls `allowMenuClose()`: the exit key, Escape, stepping left off the top
level, re-toggling the menu button, clicking outside, or opening a menu. A
document-level **capture** click listener routes every option through this, so it
holds for mouse and keyboard alike. Item-menu options stick by default; only
`MENU_CLOSING_ITEM_ACTIONS` (inline text edits, and actions that remove the item)
still close.

**Rebuild-safe cursor.** Menus are rebuilt in place to refresh their ●/○ markers.
`captureNumberedMenuKeyState()` snapshots the open-submenu chain and cursor **by
label** (with an index fallback, since a toggled option can rename itself), and
`scheduleNumberedMenuKeyStateRestore()` re-applies it for a few frames because
the rebuilding render can land late. Any subsequent keypress cancels the pending
restore — otherwise it yanks the cursor back after the user has moved on.

### Thumbnail editing from the keyboard

Reserved `Cmd`-arrow shortcuts edit the selected item's thumbnail in place
(`handleThumbnailViewportArrowKey`, which bails while a menu is open, a text
input is focused, or the crop editor is up):

- `Cmd+↑/↓` — zoom the thumbnail viewport (`zoomSelectedThumbnailViewport`).
- `Cmd+←/→` — step the **video** thumbnail frame. Images do nothing, but the
  shortcut is still consumed so it cannot leak into navigation or browser
  history.
- Bare arrows nudge the viewport.

Frame stepping is frame-accurate rather than time-based: `getVideoThumbnailTiming`
resolves duration and frame rate (mounted `<video>` first, else the native
`probe_video_timing`, else `VIDEO_THUMB_FRAME_RATE_FALLBACK`), cached in
`VIDEO_THUMB_TIMING_CACHE`. Held keys accelerate via `videoThumbnailFrameRampCount`
(1 frame, ramping to 72 after ~320ms of hold), and requests are coalesced through
`drainVideoThumbnailFrameSeekQueue` so a fast hold does not queue hundreds of
seeks.

### Grab-to-reorder (keyboard file rearrange)

The mouse drag-reorder has a keyboard-only twin driven by the bindable
`grabReorderItem` action (default unbound). It "lifts" the selected preview-grid
file into `GRAB_REORDER_STATE`; while lifted, the ordinary selection keys
(`selectUp/Down/Left/Right`) call `moveGrabbedPreviewFile()` — which finds the
nearest *file* neighbour in that direction with the same 2D scoring the cursor
uses and commits through `reorderFilesInDir` (the exact primitive the mouse drop
uses), so ordering/persistence/guards stay identical. The moved file keeps the
selection so the cursor travels with it, and `.previewCardGrabbed` marks it.
Interception lives in the global keydown handler (after the text-input guard):
directions move, the grab key toggles the lift, Esc drops it (via
`handleBackAction`), and any other action drops it and then runs normally. It is
grid-only (refused while a file is open in the viewer) and is cleared by
`resetWorkspace()`.

### Bulk tagging with shared tags

When more than one item is tagged at once, the bulk tag input
(`setBulkTagPlaceholder`, type `"tag"`) is seeded with the tags every selected
item shares (`commonUserTagsForPaths`), stored on `TAG_ENTRY_RENAME_STATE.commonTags`.
Commit (`commitTagEntryRename`) then diffs the field against that baseline via
`metaApplyBulkUserTagDiff`: tags deleted from the field are removed from every
item, tags added are added to every item, and each item's own unique tags are
left untouched — so shared tags can be bulk-removed, not just added. An empty
field is valid (strips the shared tags). Launching any tag/album name input also
drops the menu-close suppression window and closes the app menu first, so the
menu never covers the input.

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

- **`safekeeping/clean.sh`** — standalone Bash utility run separately against a media folder. 10 optional processing steps; step 1 bundles four passes (dedupe via `fdupes`, similar-media culling via `czkawka`, name sanitization, empty-item quarantine), followed by video conversion (`ffmpeg`), resize, metadata removal (`mat2`), recompression, AI upscale/denoise (`waifu2x-ncnn-vulkan`), video trimming, MP3 extraction, static-media quarantine. Not invoked by the Tauri app.
- **`safekeeping/userscripts/*.user.js`** — Tampermonkey/Violentmonkey userscripts kept alongside the app for downloading media from external sites into the gallery folder. They are independent of the app.
- **`docs/`** — documentation *about* the app: `TAURI_PORT_DESIGN.md` (the Electron→Tauri
  cutover) and `VARIATIONS_DESIGN_LANGUAGE.html`, a self-contained page specifying the
  visual language both the gallery and Variations are built in — tokens, control
  primitives, the text-marking rules and the state model. Open it in a browser; it is
  rendered in the language it documents, and `Cmd+P` gives a paged PDF of it.
- **`safekeeping/`** — everything in the repo that the app does not build or run: the userscripts, `clean.sh`, `compare.html`, the Automator workflows, the unused `assets/icon.icns` (the icons the bundle actually uses are `src-tauri/icons/`), and `safekeeping/scripts/`, which now holds only the `Local Gallery Dev Launcher.applescript`. The personal git tooling that used to live there (`checkpoint.sh`, `_commit_indexed.sh`, `authoritative.sh`, `stable.sh`, `unstable.sh`) was deliberately removed; commits that used to be made by it are made by hand, keeping the `Checkpoint NNNN` subject convention its history established. Nothing in `safekeeping/` is referenced by `package.json`, `tauri.conf.json`, the CI workflows or the Rust. `scripts/` therefore holds only the four scripts the build names.
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
