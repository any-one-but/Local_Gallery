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
  - `tauri.conf.json` — product, build (before*Command runs prepare-ffmpeg), frontendDist: "../frontend", asset protocol, bundle.
  - `src/main.rs` — thin binary entry.
  - `src/lib.rs` — builds the window, **injects initialization scripts** (tauri-bridge + tauri-fs-shim) so they run before page JS, registers all invoke commands, ffmpeg path setup.
  - `src/fs.rs` — native commands: pick_root, scan_dir, read/write_file_bytes, rename, remove, allow_media_scope, last-root persistence, `export_metadata_archive` / `pick_metadata_archive` (see "Metadata archives"), etc. All heavy work uses spawn_blocking.
  - `probe_video_timing` (in `lib.rs`) — shells out to ffmpeg and parses duration + frame rate out of its stderr. Backs frame-accurate video thumbnail stepping; see "Thumbnail editing from the keyboard".
  - `resources/ffmpeg` — bundled ffmpeg (copied by prepare-ffmpeg.js from ffmpeg-static).
- `tauri-bridge.js` — injected as initialization_script: installs `window.electronAPI` (isElectron + isTauri + writeDownloadFile + getPathForFile + exportMetadataArchive + pickMetadataArchive) + `__lg` dev helpers (ping, requestThumb, assetUrl, generateThumbnail, probeVideoTiming) over Tauri invoke.
- `tauri-fs-shim.js` — injected: overrides `window.showDirectoryPicker` and implements TauriDirHandle / TauriFileHandle / TauriWritable on top of Rust fs commands so the existing handle-based workspace builder runs unchanged. Also grants asset scopes and remembers rootPath for thumbs.
- `frontend/index.html` — the entire application. Two auto-generated inlined blocks (do not hand-edit the delimiters):
  - `<!-- BEGIN: inlined from ./styles.css -->`
  - `<!-- BEGIN: inlined from ./app.js (auto-generated) -->`
  It lives in `frontend/`, which is `frontendDist` — the whole directory is packed into the app bundle, so it holds the UI and nothing else (no node_modules, no .git, no Rust source). It used to sit at the repo root and be copied in by a build step; the copy was deleted and the original moved, so there is one file, not two that can drift.
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
open `frontend/index.html` (or serve `frontend/` and open its root, which is
what GitHub Pages publishes). The Tauri build reads the same file.

The `WS` global, navigation model, three-pane UI, etc. are unchanged in the web layer.

### Core data model (`WS` global)

The `WS` object (`const WS = {`, search for it) is the single global workspace state:

- `WS.root` / `WS.dirByPath` — directory tree. Nodes are `DirNode` objects created by `makeDirNode()`. The tree is built from file handles obtained via the File System Access API.
- `WS.altSourcePaths` — the on-disk paths of folded-away ALT folders, so records still sitting under one can be filtered out of every listing. See "ALT folders".
- `WS.fileById` — `Map<id, FileRecord>`. Each `FileRecord` holds `{ id, file, name, relPath, dirPath, ext, type, url, thumbUrl, videoThumbUrl, ... }`. Object URLs are created on demand and revoked when the workspace resets.
- `WS.catalog` — on-disk catalog for deferred loading of large libraries (stored as sharded JSON in `.local-gallery/catalog/`).
- `WS.meta` — user preferences, scores, tags, keybinds, appearance presets. Persisted to `.local-gallery/` as one JSON log file per document; `META_DOC_FILE_NAMES` is the authoritative list (`scores.log.json`, `score-history.log.json`, `tags.log.json`, `tag-albums.log.json`, `custom-thumbnails.log.json`, the seven `preferences.*.log.json` sections, `keyboard-configuration.log.json`, `tabs.log.json`, …). `fs.rs` keeps a copy of that list for the metadata archive and the two must stay in step.
- `WS.view` — transient UI state (filter mode, slideshow, bulk select, search, navigation history, active pane, etc.).
- `WS.nav` — the currently listed directory and its `entries[]` (mixed `{kind:"dir"}` / `{kind:"file"}` list) used for the List Pane.
- `WS.preview` — what the Preview Pane currently shows (`kind`, `dirNode`, `fileId`).

### UI layout

Three panes rendered via CSS grid in `#app`:
1. **Title Pane** (`#titlePane`) — the tab strip (`#tabBar`), and nothing else. Its grid row collapses unless 2+ tabs are open (`#app.tabs-multi`), so a single-tab window has no top bar. The folder title / info / search row (`#titlePaneTop`) lives in `#stackedTitleHost` inside the file pane, so it hides together with that pane.
2. **List/Directories Pane** (`#directoriesPane`) — folder tree + file list for the active directory.
3. **Preview Pane** (`#previewPane`) — media viewer (image/video/gif) with a control bar (`#controlPane`).

**There is no Settings pane.** Its markup was removed from the document —
`#menuOverlay`, `#optionsBody`, `#keybindsBody`, `#menuTitleBar` and
`#calendarBody` are all gone — so everything that used to render into it is
unreachable code that still parses. `renderOptionsUi()` returns immediately on
its `if (!optionsBodyEl)` guard, `openMenu()` / `closeMenu()` are inert,
`initSettingsFloatingWindow()` no-ops on the missing node, and
`toggleSettingsWindow()` (and `window.__lgToggleSettings`, which the macOS
"Settings…" menu item calls) opens the **app menu** instead. The option rows
still written inside `renderOptionsUi` are kept only so the definitions stay
next to each other; adding one there changes nothing on its own.

**The app menu is the only settings surface** — see the section below.
`buildAppMenuThumbnailsSubmenu()` and friends are where a new control has to go
to be reachable at all. **`Cmd+,` is intentionally disabled** (the default
`toggleSettingsAndDirectoriesPanes` binding is empty and the dedicated listener
was removed).

`APP_ITEM_MENU_ACTIONS_ONLY = true` still governs which actions are menu-only:
actions in `APP_ITEM_MENU_ACTION_KEYBIND_IDS` are dropped from the Controls list
and ignored at runtime by `keybindActionFor()`, while
`APP_ITEM_MENU_SETTING_CONTROL_IDS` hides rows from the (now unreachable)
Settings pane. Stored option values and binding assignments are left untouched,
so flipping the flag to `false` restores both. A few actions are intentionally
*absent* from that set — favorite selection and the random jumps are worth a
direct key even though the menu also offers them.

The Rust side of the legacy separate Settings window is **gone** — `settings.rs`
and its `open_settings_window` / `toggle_settings_window_command` invoke commands
were deleted, so nothing can open that window any more. The document's
`IS_SETTINGS_WINDOW` flag survives and is now permanently `false`; the branches it
guards are dead but harmless, and unpicking them from a 66k-line script buys
nothing.

`renderPreviewPane()` is the main re-render entry point for the preview side. The directories/file list side is rebuilt through `rebuildDirectoriesEntries()` and related helpers.

**No name is declared twice any more.** The document used to carry a fossil layer
of stubbed thumbnail functions — 273 top-level declarations that a later
declaration of the same name shadowed, and which hoisting therefore made
unreachable from the first line of the script. They are gone, so a `grep` for a
function now finds the one that runs. Keep it that way: re-declaring a name at
top level silently replaces the earlier body everywhere, including in code that
textually precedes it.

### Two menus: the app menu and the select menu

They are one element (`#appActionMenu`) in two modes, because only one can be
open at a time. `APP_MENU_MODE` is what `buildAppMenuItems()` reads to decide
which list to build.

- **App menu** — the library and the app. **Hard-bound to Tab**, handled
  directly in the global keydown listener alongside `Cmd+1`–`Cmd+9` rather than
  through `KEYBIND_ACTIONS`, so it cannot be rebound or lost. It does **not**
  require a selection, and it has no Selected Item section. It lands wherever
  `Appearance → Menu placement` says (`appMenuPlacement`: at the item, middle,
  the four corners, the two side edges). Only `item` uses the distance/height
  offsets; every other value pins it to the window and ignores them.
- **Select menu** — the selected item's own actions, and nothing else. Keeps the
  old bindable `openAppMenu` action (relabelled *Open select menu*), and always
  appears beside the item, because it is about that item. The section is
  *unwrapped*: `selectedItemMenuSectionItems()` returns the flat list and the
  menu shows it directly rather than as a submenu to step into. A quarantined
  item still gets its single `Remove from Trash/Storage` button instead.

`Reveal...` and `Random actions` are gone from the menu. Every Reveal toggle has
a keybind and the Controls list is where a key is looked up; a submenu that only
duplicates four bindings is a second place for them to disagree. Random's jump
weighting moved to the foot of `Basics` (it is a setting, not an action) and the
two random sort toggles are keybind-only. Both builders are still in the file —
drop either back into `buildAppMenuItems` to restore it.

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

Menu order is fixed: title, `Jump to...` **always first**, `Basics`, Filters,
Appearance, History, Controls, Metadata, Refresh App **always last**. `Basics`
holds the everyday view controls (quick navigation, sort, media filter, mute
messages, full screen media, float tags); Grok, Claude and Variations have no
menu entry at all and are reached only through their keybinds.

### Jump to... (the library as a tree in the menu)

`buildAppMenuJumpToSubmenu` puts the whole library at the top of the app menu.
Its trigger is a **hybrid** (`createDropdownMenuSubmenu`'s `onActivate`): the
enter key on it goes to the library root, right steps into the tree — which is
why the root is not listed as a row. Below that, each level is a plain list of
menu options (one per folder or portal, icon and chevron), and opening one puts
the next **beside** it rather than replacing it, so the chain reads as a row of
submenus.

Three rules keep it from misbehaving at the edges:

- **Expanding is all-or-nothing, measured from where the menu is docked.** A
  menu opened near the right edge could be *made* to fit by sliding the whole
  thing left as it grows, and that reads as the menu running away from you. So
  unless the widest the chain could ever get (`appMenuJumpMaxColumns`, an upper
  bound from the folder-tree depth plus a portal hop) still fits to the right of
  the menu where it stands, it does not expand at all: each level replaces the
  last and the menu keeps its normal width and its place.
- **A folder with nothing in it gets no column.** Opening one jumps to it, so
  there is no empty list to back out of, and the bound above never has to
  account for one.
- **The cursor clamps, it does not wrap.** Looping past the end of one level in
  a chain of them loses your place.

A jump lands *at* a folder — the preview shows it, as if you had arrowed onto it
in the grid — so `maybeQuickNavigateIntoJumpedFolder` then does what quick
navigation does everywhere else with a media-only folder: dive in, first file
selected, sidebars closed. The way back needs no special case, because
`enterMediaFolderWithQuickNavigation` captures its return bridge from the view
it is called in, and that is the view the jump just built.

Two things make the rest work without a second implementation of the menu:

- **It borrows the styling and not the walker.** The rows are real `<button>`s
  inside `#appActionMenu` (a `.dropdownMenu`), so they inherit the menu's own
  option size, radius and cursor fill for free. They are nested inside a column
  rather than being *direct* children of the submenu panel, and
  `numberedMenuOptionsForPanel` only looks at direct children — so the option
  walker finds nothing in there and `handleAppMenuJumpKey` drives it instead,
  exactly as the Calendar panel does. `APP_MENU_JUMP_STACK` is the whole state:
  one `{ target, items, index }` per open level, reset by `openAppMenu`.
- **It reads the library through the panes' own helpers.**
  `getPreviewFolderAndFileEntries` → `tabTargetForEntry` →
  `subItemSourceNodeForTarget` are the same calls "open in tab" uses, so albums,
  tags and the special buckets nest where they actually live (an album's tags
  are inside that album) and sort/filter/visibility agree with the grid. The
  jump itself is `makeLocationTabState` + `restoreViewerCloseState` — a tab
  "located at" an item, applied to the tab already in front of you.

Storage and Trash are dropped at every level whatever their visibility toggles
say (`appMenuJumpTargetIsExcluded`), so nothing quarantined is reachable here.

### Turning thumbnail media off

`Thumbnails → Media thumbnails` (app menu, on by default, `mediaThumbnails`)
stops thumbnails painting media at all: no card asks for a URL, so nothing is
fetched, decoded or held, and every tile shows its item icon. Like
`Full resolution` it refreshes the workspace on change — a re-render would leave
the old tiles holding their object URLs, and it is `resetWorkspace()` that
revokes them, so the refresh is what makes "off" actually free.

**Two accessors, deliberately not one.**
`folderPreviewMediaThumbnailsEnabled()` decides the card *shape* and is
hardcoded `true`; `mediaThumbnailsEnabled()` decides only whether media is
painted into whatever card was built. They were briefly merged and must not be:
`folderPreviewThumbMode()` reads the first, and a `false` there routes folder
cards down a legacy list-row branch, which is not what this option means. (That
branch used to throw `ReferenceError: icon is not defined`, having rotted while
unreachable; it is fixed, but reaching it still changes the card shape.)
Gating is therefore at the media funnels only — `getPassivePreviewSrcForRecord`
and `ensureThumbUrl`, each now the only declaration of its name — plus the two
`*ExpectsThumb` flags, which
otherwise hold a blank pending slot forever instead of falling back to the icon.
Every card builder already starts its markup at the icon and only replaces it
when a src comes back, so returning `""` is the whole mechanism.

### Random and bulk thumbnails

A folder's or tag's `Thumbnail` submenu offers **Random**, which pins a randomly
chosen file from anywhere in that item's subtree. Two accessors sit behind it and
are not interchangeable: `firstRecursiveThumbnailCandidateForDirNode` /
`...ForTagEntry` short-circuit on the first eligible record and only answer *is
there one*, which is what decides whether the option is offered at all;
`randomThumbnailCandidateFor*` builds the whole pool and picks from it, which is
what runs on activation. Using the second for the availability test would walk
the subtree of every folder on screen each time a menu was built.

Eligibility is the same rule the grid uses — `passesFilter` plus the folder's own
media filter plus any contextual tag filter — so Random can never pin something
the folder would not show.

`createBulkThumbnailSubmenu` is the multi-selection form, over
`bulkThumbnailTargetsFromSelection` (folders and tag entries mixed, root
included, storage stubs excluded). `bulkThumbnailActionAvailability` decides what
to offer: Default / Rotate / Blank appear when **any** target would change,
Random only when **every** target has a candidate — a Random that silently
skipped half the selection would be worse than not offering it. It hangs off the
bulk folder, bulk tag and directories-header menus, which is what puts it in the
app menu's `N Selected Items` section.

### The media filter surface, and why `sourceDirty` exists

`MediaFilterEngine` keeps one GL surface per media element and used to re-upload
the source texture on every render. It no longer does: grain and the other
time-based overlays have to keep painting on **stills and paused video**
(`needsAnim` no longer requires `isVideo`), and re-staging a still image every
frame for that would be pure waste.

So the texture is uploaded only when `surface.sourceDirty` is set, and the
invariant is that **anything that changes the pixels behind the element must set
it**: `attach`, a decoded clean-image bitmap arriving, the
`requestVideoFrameCallback` tick, and every media event
(`MEDIA_SOURCE_EVENTS` — load/loadeddata/canplay/play/pause/seeked/…), which is
why those are bound through a per-surface handler rather than bare
`requestRender`. Miss one and the canvas keeps painting the previous frame while
the element underneath has moved on; the case that bites is seeking a paused
video where `requestVideoFrameCallback` is unavailable, since that callback is
otherwise the only thing that sets the flag for video.

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
It sits in `frontend/` alongside index.html, which is what makes
`WebviewUrl::App("variations.html")` resolve.

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

**A fork copies the ladder, not the rung.** `addVariant(id, true)` — the `⧉`
chip and the `f` key — goes through `forkVariant()`, which deep-clones the
source variant: every version with its name, text and conditions, fresh ids
throughout, and the same version left open. It used to build a one-version
variant out of `variantText(src)`, which is only whichever version happened to
be showing, so forking a variant that held three degrees of an idea silently
dropped two of them. The variant's own conditions come across unchanged, for
the reason `duplicateBlock` remaps only what it moved: a condition names sources
that live outside the thing being copied and they have not gone anywhere.

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

#### Folding

A block folds to its heading (`block.collapsed`, `z`; `Shift+Z` folds the whole
stack), the same gesture `group.collapsed` already had — but not the same
mechanism, and the difference is the point. A group hides exactly one child
(`.gbody`) and keeps its arrangement switcher, because for a group the switcher
is a control and the members are the content. A block has no such split: chips,
versions, editor and foot are all content. So folding a block hides all four and
puts a `.peek` line in their place — the active variant's name, and the opening
of what it says, taken through `mixSnippet(effectiveVariant(b))` so the line is
the text that would actually ship (notes out, banks in) and reflects a condition
holding the chosen variant off.

The peek is built on every render and hidden by CSS rather than skipped when
open, so unfolding never waits on a re-render to have something to draw. The
hidden children are listed positively in the stylesheet rather than matched with
a wildcard, so a fifth child added later has to be thought about.

Three things follow from folding being a *view*:

- It is stored on the block, next to `group.collapsed`, not in `ui` — a stack
  left folded opens folded, on any machine. `normalize()` coerces it, and absent
  means open, which is what every pre-existing document means.
- `toggleBlockCollapsed()` calls `renderStack()` and deliberately **not**
  `renderOutput()`/`renderRail()`: nothing the prompt is made of has changed.
- The filter never unfolds anything, matching the group precedent, so a folded
  block with hits inside shows a `matchnote`. `matchesInBlock()` counts matched
  *variants* where the group's `matchesIn()` counts members — a block matched by
  its own label has `variants: null` and reports 0, having nothing hidden.

Anything that needs the editor unfolds the block on its way rather than
appearing to do nothing: the `e` key, `addVariant` and `addVersion`. Cycling
variants while folded is left alone on purpose — the peek redraws, so `h`/`l`
walks the variants as readable one-liners without opening anything.

#### The keyboard, and the browser it shares

Variations is a browser page as often as it is an app window, so the browser's
own shortcuts come first and the page's commands are shaped around them. The
rule is one line rather than a per-command modifier test, because a per-command
test is a thing you can forget to add to the next command:

- Three chords are claimed, from anywhere, typing included — `Cmd+F` (filter,
  the universal "this app has its own search"), `Cmd+Shift+C` (copy prompt) and
  `Cmd+Shift+E` (export). `matchesAppChord()` is the whole list.
- **Everything else is a bare key.** After the chords, `if (e.metaKey ||
  e.ctrlKey || e.altKey) return;` hands every modified key back to the browser
  *unprevented*, so `Cmd+1`–`Cmd+9` switch tabs, `Cmd+←`/`Alt+←` go back, and
  `Cmd+N`/`Cmd+S`/`Cmd+D` do what they do everywhere else.

The bug that shape exists to prevent is worth naming, because it is the one a
new command reintroduces: the bare-key `switch` used to run whatever the
modifiers were, so `Cmd+1` picked a variant *and* swallowed the tab switch —
two wrong things at once, neither of them visible, and the prompt quietly
different. Export sits on `Cmd+Shift+E` rather than `Cmd+E` for the same
reason: `meta` here means `metaKey || ctrlKey`, and `Ctrl+E` is the address-bar
search on Windows.

`Escape` is matched unmodified only, and the app's close key (`matchesCloseKey`,
forwarded by Rust) is tested before all of it so the toggle always gets you back
out. Copy also has a bare `c`: the assembled prompt is what the page is for, and
a bare key is the one route no browser can ever contest.

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
menus were already inert (`SEPARATE_ITEM_MENU_ENABLED = false`). With the
Settings pane gone there is **no fully cursor-interactive surface left** — only
real text inputs still take the cursor, and native right-click still works
inside them for copy/paste. Removed cursor features: the mouse thumbnail **crop-editor window**
(`openThumbnailCropEditor` early-returns; keyboard Cmd+arrow editing stays — see
below — and the "Edit thumbnail" menu entries are gone) and the four-video
**quad/gallery playback** (`openQuadPlaybackForRecords` is an inert stub; its
"Play" menu branches were removed).

### Cursor zoom on open media (the one thing added back for the mouse)

Scrolling on an open image or video zooms it, and it can then be dragged
around. It is deliberately **additive**: no keybind, no menu entry, no stored
option, nothing else in the app knows it exists, and everything the app can do
is still reachable without touching the cursor. Zoom is a view of the item
currently open — changing media drops it, and it is never persisted.

The rule that shapes the rest: **the gesture that started the zoom decides what
a plain wheel means afterwards**, because a wheel event cannot be told apart
from a two-finger scroll and guessing the hardware wrong is worse than asking
the gesture.

- Started with a plain wheel — a mouse. The wheel keeps zooming; panning is a
  drag.
- Started with a pinch (a wheel event carrying `ctrlKey`, which is what a
  trackpad pinch reports) — a trackpad. A plain wheel now pans in any
  direction, because the next thing a trackpad user does is scroll, not drag.

`MEDIA_ZOOM.mode` holds that choice and is **sticky until the media changes**.
Pinching back out to fit does not hand a trackpad user back to the mouse
dialect — that would make an idle two-finger scroll zoom in on them. At fit
with nothing to pan the event is passed through unprevented rather than
swallowed.

Four other things hold it together:

- **Every layer takes the same transform.** The viewport carries three custom
  properties (`--media-zoom-scale/x/y`) and `#mediaZoomStyles` puts them on the
  raw `<img>`/`<video>`, the WebGL filter canvas, its held copy and the
  transition frame. Transform one without the others and the filtered picture
  drifts off the raw one underneath it.
- **The filter canvas is re-rendered sharper as it is zoomed.**
  `mediaZoomRenderBoost` multiplies `renderDpr` in `MediaFilterEngine`'s draw
  path, and returns exactly `1` unless the zoom is live on that same container,
  so the unzoomed cost is untouched. It is bounded three ways: by the zoom
  rounded **up to a power of two** (a continuous zoom then reallocates the
  canvas about four times across its range rather than every frame — each
  resize also restages the still's texture); by what the source actually holds,
  since `renderDpr` already resolves a large still up to the pipeline's own
  budget and only what that budget left on the table is recoverable; and by a
  budget of its own, smaller for playing video. Rendering the *whole* frame at
  source density is as sharp as cropping to the visible slice would be, which
  is why there is no viewport crop in the GL path. `applyMediaZoom` calls
  `requestRender()` on a scale change, because nothing else would ask a still
  to redraw.
- **Panning is clamped against the picture, not the element box.** The media is
  `object-fit: contain` in a full-size box, so `clampMediaZoomPan` derives the
  letterboxed rect from the intrinsic size and bounds the pan by that — a
  portrait image cannot be dragged sideways into the surrounding black.
- **Zoom walks toward the cursor**, by pinning the point under it across the
  scale change, rather than always toward the middle.
- **Reading-scroll images are left alone.** `tallScrollMode` / `wideScrollMode`
  already own the wheel in that viewport and lay the image out larger than the
  box on purpose, so `mediaZoomScrollModeActive` bows out there.

`syncMediaZoomForCurrentTarget()` is called from both single-file render paths
(`renderPreviewViewerItem`, `renderViewerItem`) once the index they are drawing
is settled, and it keys off that item — the same item re-rendered keeps its
zoom, only re-clamped in case the viewport resized.

### History in the app menu (Stats / Calendar)

Score history was pulled out of the settings pane entirely (its "Stats" tab —
id `calendar`, the `#calendarBody` panel — is gone along with the rest of the
pane, so `renderCalendarUi` is a harmless no-op) and rebuilt as **real app-menu
submenus** under a top-level **`History`** entry (between Miscellaneous and
Refresh App) → **Stats / Calendar** (`buildAppMenuHistorySubmenu`). They are
navigated by the keyboard like any other app-menu submenu, not as overlays.
Their panels are widened past the normal menu width and height-capped with
scroll (`.appMenuStatsPanel`, `.appMenuCalendar`) so long lists don't run off
the screen and days have room.

- **Stats** (`buildAppMenuStatsSubmenu`): a ranked, view-only list of the
  library's top-level folders — a `.appMenuStatsSummary` line (count + total),
  then one `<button class="appMenuStatsRow">` each: name, score right-aligned in
  tabular figures and tinted by sign, and a `.statsLedgerScoreBar` diverging from
  the centre under both. The buttons are walked by the normal option cursor but
  do nothing on activate. Trash is filtered out — it is a system location, not
  one of the library's folders. The bar is a plain pill drawn from tokens
  (`--ui-control-bg` track, no border and no zero tick — a hard 1px rule across
  a rounded track reads as a seam); it used to be a bordered black slab with a
  white hairline down it, which is why it did not survive into light.
- **Calendar** (`buildAppMenuCalendarSubmenu`): a compact `.appMenuCalendar` month
  grid (`buildHistoryCalendarMonthsHtml`) passed as the submenu's single non-button
  item, so the normal option walker finds no options in its panel. The app-menu
  keydown handler special-cases it via `handleAppMenuCalendarKey`: when
  `appMenuActiveCalendarPanel` finds an open calendar panel, the movement keys
  walk the day cells (±1 / ±7, `APP_MENU_CALENDAR_SELECTED_DAY` remembers the
  cursor across rebuilds, default today), the enter key opens that day's page,
  and the exit key steps back to the History submenu (a manual
  `setDropdownSubmenuOpen(false)` since the generic collapse skips a panel with
  no options). The day cursor (`.appMenuCalendarDaySelected`) uses the same blue
  as the regular preview selection (`var(--anchor-internal-color2-primary)`).
- **A day's page** (`buildAppMenuCalendarDaySubmenu`, gated on
  `APP_MENU_CALENDAR_DAY_VIEW`): the folders whose scores moved that day, then
  `Open in journal` and `Delete this day`. It *replaces* the grid inside the
  same Calendar submenu rather than floating over it, which is what lets it be
  walked by the ordinary option cursor — it is all buttons, where the grid is
  none. Three things about it:
  - **A folder row is a label with a Delete cell beside it**, laid out and
    driven exactly like a Controls row: the name does nothing, and Delete is a
    cell you step *right* onto (`APP_MENU_HISTORY_DELETE_FOCUS_ROOT`) before it
    can be pressed. Only the cell under the cursor is tinted, so what a press
    will do is always the thing that is coloured in — and no single press from
    the cursor's resting place can delete a folder's history.
  - `handleAppMenuCalendarKey` bows out on its own (it looks for
    `.appMenuCalendar`, which the page does not have), so
    `handleAppMenuHistoryDayKey` — which runs before it in the dispatcher — owns
    the Delete cells and the step *back* to the grid.
  - `Delete this day` confirms **in place**, by pressing the same option twice
    (`APP_MENU_HISTORY_DAY_DELETE_CONFIRM`, the pattern
    `APP_MENU_PRESET_DELETE_CONFIRM_ID` already uses), rather than through
    `showAppMenuConfirm` — that page closes the menu on *either* answer, so
    cancelling would cost you the menu with it.

  Every edit goes through `refreshAppMenuAfterHistoryEdit`, which rebuilds the
  menu in place so the page reflects the deletion without closing or losing the
  cursor. `setAppMenuHistoryDeleteFocus` deliberately does *not* rebuild: moving
  between the name and Delete changes nothing the menu is made of.

`MENU_PANELS_CLAMPING_AT_ENDS` lists the panels whose cursor clamps instead of
wrapping — the long scrollable lists, Controls and Stats. Every other menu still
wraps.

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

### Inline edits (rename / tag) and the two rules that keep them unstuck

Every inline edit — folder rename, file rename, tag/album rename, bulk tag — is
a piece of module state (`RENAME_EDIT_PATH`, `RENAME_EDIT_FILE_ID`,
`TAG_EDIT_PATH`, `TAG_ENTRY_RENAME_STATE`, `BULK_TAG_PLACEHOLDER`) that makes
the next render draw an `<input>` on the matching row or card, plus a
`queueInlineInputFocus` call to put the caret in it. The state and the input are
two separate things, and every way *out* of an edit — Escape, Enter, blur — is a
listener **on the input**, whose keydown `stopPropagation`s every key. So an
input that never got focused cannot be escaped, committed or blurred, and the
state that draws it is not cleared by navigation. That is a hard lock with only
a reload out of it, and it was reachable:

- **Starting an edit must not move the location.** `selectDirectoryEntryByPath`
  / `selectFileEntryById` used to call `syncPreviewToSelection({ force: true })`.
  Forcing it re-derives the preview from the file pane even when the selection
  did not move, which drops the grid cursor and — when the file pane and the
  grid list the same directory, i.e. any media folder reached by quick
  navigation — swaps the grid for the single-item view. The card the input was
  about to be drawn on then does not exist. Unforced, the sync still follows a
  selection that genuinely moved and does nothing when it did not. The two
  preview rename starters additionally do not move the selection at all, which
  is what `startPreviewFolderTagEdit` had always done and said why.
- **An inline edit that could not be focused does not exist.**
  `queueInlineInputFocus(resolve, onMissing)` re-checks a frame later and calls
  `onMissing` — `clearPendingInlineEdit()` — when the input is still not there.
  Passing it is not optional: a starter that omits it can strand the app.
  `focusTagEntryRenameInput` is the one exception and takes
  `{ retractIfMissing: true }` only from its starter, because the tail of every
  `renderDirectoriesPane` calls it again to re-seat the caret; a blanket
  retraction there would cancel a rename mid-typing.

`handleBackAction` also clears a pending edit that has no caret in it
(`pendingInlineEditIsUnfocused`). A focused edit never reaches it, so this fires
only for the stranded case. It is a backstop, not the fix — but "there is no way
to make it go away" should not depend on having enumerated every way an edit can
be stranded.

### Themes

Two, on one attribute, both exposed at `Basics → Theme` (`appTheme`, dark |
light). `applyColorSchemeFromOptions()` writes `data-theme="retro90s-dark"` for
dark — the value a pile of existing rules are already keyed to — and
`data-theme="graphite-light"` for light, a *new* value chosen so none of the
retired azure-light (`retro90s`) rules can apply to it. It also sets
`style.colorScheme` so the OS paints scrollbars and form controls to match.

The light block is a list of colours and nothing else, because everything below
the palette is written against tokens. **If a rule needs a `[data-theme]`
selector to look right in light, that rule has a hardcoded colour in it and the
colour is the thing to fix.** There is exactly one deliberate exception
(`#controlPane`'s inner edge, a highlight in dark and a shadow in light).

**The card's three bubbles.** The type icon is not part of the title any more:
it sits in its own bubble in the card's top-left, on the same 10px inset as the
title bottom-left and the score bottom-right, so the three sit on the corners of
one square. Two mechanics make that work and neither is optional:

- The strip is `top: 0` — it covers the whole card rather than the band at its
  foot, with its pills held down by `align-items: flex-end`. It paints nothing,
  so this changes no pixel on its own; what it buys is a positioning context the
  size of the card.
- The icon is moved in the **markup**, by `setThumbnailTitle` recording
  `data-type-icon` and a microtask pass mounting the bubble on the strip. CSS
  cannot do it: the title pill carries a `backdrop-filter`, and a
  backdrop-filter makes an element a containing block for absolutely positioned
  descendants *even at `position: static`*, so an icon left inside the pill
  anchors to the pill however the stylesheet is written. The pass is deferred
  because a card is assembled detached — at `setThumbnailTitle` time the title
  has no card to look up to.

**`Appearance`** holds theme, bubble styling, app menu placement, Thumbnails,
and Select Menu. Select Menu holds the placement-adjacent controls:
`Menu distance` / `Menu height` (`appMenuDistance`, `appMenuHeight`, five steps
each, step 3 the flush baseline the menu used to sit at, steps 1–2 walking back
into the overlap; height also takes `center`). `Bubble diffusion`
(`glassDiffusion`) and `Bubble tint` (`bubbleTint`) are the
two halves of what a bubble is made of, so they sit together.

Tint is one percentage on the root (`--bubble-tint`) that every tinted surface
takes a fixed share of — `--glass-tint` all of it, `--scrim-bg` 0.9, `--pill-bg`
0.7 — against a `--tint-base` the theme supplies: ink in dark, white in light.
That is what lets one control mean "dimmer" in one theme and "brighter" in the
other. Careful with the normaliser: `Number("")` is `0`, not `NaN`, so an unset
value has to be caught *before* the numeric branch or it lands on Clear and the
whole app opens untinted.
Changing either clears `APP_MENU_DOCK_POS` before re-docking, or the stored
corner every in-place rebuild reuses would keep the old position.

**Anchors are measured before they are accepted.** `positionActionMenuInPreviewDock`
walks stored anchor → live selection → first card, and takes the first candidate
that is connected *and* measures non-zero. A detached node still answers
`getBoundingClientRect()`, with an all-zero rect, so taking the first truthy
candidate is not the same as taking the first usable one — and the stored anchor
is detached far more often than it looks, because any option that re-renders the
preview pane replaces the card the menu was opened on. Before this, every such
rebuild measured zero, fell through to the pane fallback and dropped the menu in
the top-left corner. The winner is written back to `APP_MENU_STATE.anchor` so the
next rebuild starts from a live node.

**Light glass is untinted on purpose.** A bubble is tinted in both themes, in the
direction of its own theme: dark dims what is behind it, light lightens it —
same strength, opposite sign, which is what makes a surface read as one
material in both. Dark keeps its tint because
over a black ground a clear pane has nothing to catch and the dimming is what
makes text on it legible. `--pill-bg`, `--on-media-fg` and
`--preview-pane-thumb-title-bar-fg` therefore *do* invert in light, which is a
real trade: an untinted pill over a dark thumbnail gives dark text on a dark
picture. If that turns out to be the common case the fix is a small fill back
on `--pill-bg`, not re-tinting every surface.

The saturation inside `--glass-blur` does not invert. Pushing colour back up
after a blur is what stops a frosted panel going grey, and that is as true over
white as over black.

**There are no drop shadows anywhere.** `--overlay-shadow`, `--pill-shadow` and
`--video-control-shadow` are all `none`, and the literals were zeroed with
them. Insets and `0 0 0 Npx` rings survive — an inset is an edge and a ring is
an outline; neither is a cast shadow. Separation comes from blur and rim.

Two traps this closed, both of which looked like "a faint box":

- A `box-shadow` declared `!important` on `.dropdownMenu` reached every nested
  drill-down panel, so each level cast its own rectangle. Visible immediately
  in light, nearly invisible in dark.
- `backdrop-filter` is clipped by its ancestors. `.dirSquareRightMeta` is
  `overflow: hidden` with no radius, so a tag card's round score pill had its
  blurred backdrop cut to a square and the corners showed. Folder cards use the
  same wrapper as `overflow: visible`, which is why it only appeared on tags.
  The badge wrappers are forced visible; the card does the real clipping at its
  rounded corner.

### Diffusion, and the retired title strip

Cards used to carry a **title strip**: one tinted, blurred bar across the
bottom, with two settings (opacity and diffusion) governing it. Both the bar
and its settings are gone. The title now sits in a long frosted pill shaped
like the search field and the score in a small round one, floating on the
media with the strip left as an invisible box that only positions them. A bar
is a horizon — it cuts every picture at the same line whatever the picture is
doing; two pills take only their own footprint.

What replaced the two settings is **one control**: `Basics → Diffusion`
(`glassDiffusion`, 0–100% in 10s, `GLASS_DIFFUSION_MAX_PX` = 40).
`applyGlassDiffusionFromOptions()` writes a single `--glass-diffusion` onto the
root element, and **every** `backdrop-filter` in the sheet derives from it —
`--glass-blur` (chrome), `--glass-blur-strong` (menus, 1.6×), `--glass-blur-soft`
(the card pills, 0.8×), `--glass-blur-scrim` (full-window overlays, 1.2×). The
ratios live in the stylesheet so one knob moves every surface together and none
can drift; at 0 every frosted surface degrades to a plain translucent tint
rather than to a slab of solid colour.

Two things to keep:

- **`getGlassDiffusionFromOptions` falls back to the old `thumbTitleStripBlur`**
  when `glassDiffusion` is absent. It is the same quantity under an old name, so
  a library that had diffusion turned down does not have it jump back up on
  first launch. The old *opacity* value is dropped — it described a bar that no
  longer exists.
- `--preview-pane-thumb-title-bar-fg` survives alone out of the strip's tokens.
  It is what the `... *` rule forces every descendant to, and it is what keeps
  the pill text legible over any picture.

**Nested menu panels must never take a `backdrop-filter`.** A drill-down level
carries `.dropdownMenu`, so a glass rule matching that class gives every level
its own blur, and a nested backdrop-filter re-blurs what the parent already
blurred — once per level. The reset in the `appMenuDrillDown` block clears
`backdrop-filter` and `border-radius` alongside background/border/shadow, on a
descendant selector, so it holds at any depth.

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

### ALT folders (two versions of one collection)

A sibling folder named `Name -- Label` is an **ALT** of `Name`: the same
collection in another form (`Foo -- VHS` next to `Foo`). Both live on disk; only
one is ever shown. The library lists `Foo`, and the select menu grows an `ALTs`
submenu listing the other versions.

**The submenu is on every item inside the folder as well, and only ever in the
select menu.** The gesture is "the selected item's own actions", and once you
are browsing inside `Foo` you can no longer select `Foo` -- so its own menu is
out of reach exactly when you want it. `folderAltNodeForSelectMenuTarget` starts
from the selected item (a folder answers for itself; a file or tag entry answers
for the folder it sits in) and walks up `parent` to the nearest alt-bearing
folder, at any depth. There is deliberately **no app-menu entry**: this is an
item action, and a second home for it would be a second place for the two to
disagree.

**The panel reads the same from either place**: the folder named in a heading
(a non-button, so the option walker skips it), every version listed, and the one
you are on marked with the usual `●`/`○`. It used to omit the active version on
a folder's own menu and only name the folder from the inside; both were dropped,
because a switch that looks like two different controls depending on where you
opened it is the thing that has to be re-learned.

**One thing does differ, decided by `own`** (is the resolved folder the selected
item itself?): a swap made from the inside **stays in place** (`stayInPlace`).
The original refresh re-selects the swapped folder in the file pane, which from
inside would throw you out of the view you made the change from; `stayInPlace`
leaves both panes untouched and goes through
`preserveActivePreviewTargetDuringDirectoriesRefresh` instead.

A swap replaces every file record in the folder, so an *open* file would
otherwise be left dangling: `carryOpenFileAcrossFolderAltSwap` re-points
`WS.preview.fileId` and the three selection keys at the counterpart record,
matched on `altCanonicalThumbKeyForRecord` -- the same extension-insensitive
identity the thumbnail metadata is keyed by, so you keep looking at the same
picture in its other form.

`ALT_FOLDER_NAME_SEPARATOR` is `" -- "`, split at the **last** occurrence
(`parseAltFolderName`), and the Original's label is the empty string
(`ORIGINAL_ALT_LABEL`), shown as `Original`. A folder whose name parses as an ALT
but has no plain-named sibling is just a folder.

**Folding happens once, at the tree.** `finalizeFolderAltsForWorkspace()` runs at
the end of all three workspace builds; `ensureDirectoryChildNodesFromCatalog`
repeats it for each level a deferred catalog materialises.
`foldAltFoldersInNode` walks depth-first, and for every alt-named child with a
canonical sibling: `captureAltSourceTree` snapshots both subtrees into
`canonical.altVariants[label]` (the Original is captured on first use), then
`detachAltFolderNode` removes the alt node from the parent and unindexes its
whole subtree from `WS.dirByPath`. So after folding there is one node per
collection and the alt paths exist only inside `altVariants`.

**Switching a variant re-projects the canonical node.**
`installFolderAltVariant` → `projectAltSourceOntoNode` rewrites the canonical
node's `childrenDirs` / `childrenFiles` from the chosen source tree. Four things
make that safe to repeat:

- **File records are borrowed, not copied.** `bindFileRecordToCanonical`
  repoints `rec.dirPath` at the canonical folder and stashes the real one in
  `rec._altSourceDirPath`; `rec.relPath` keeps the true on-disk path, which is
  what every read still goes through. `restoreAllAltVariantFiles` undoes this
  before each projection, so a swap never has to unpick the previous one.
- **Child nodes are pooled.** `canonicalChildPool` keeps one `DirNode` per child
  name across swaps, so a node reference held elsewhere survives a variant
  change.
- **The union is the shape.** `unionAltChildDirNames` /
  `unionAltChildFileEntries` list every child any variant has. Anything the
  active variant lacks becomes a **missing placeholder** —
  `isMissingPlaceholder` on a pooled `DirNode` or a synthetic
  `missing::<relPath>` record — drawn at half opacity, refused by every open
  path with "This item is missing from the current ALT.", excluded from item
  counts (`rebuildDirectoryDerivedIndex` skips them), and given no item menu.
  The point is that the two versions read as one collection with gaps, not as
  two different folders.
- **Inactive records must not leak.** `passesFilter` drops any record still
  sitting under a registered alt source path (`WS.altSourcePaths`,
  `fileRecordIsInactiveAltSource`), which is what keeps a hidden variant's files
  out of the grids. Folder listings drop hidden alts a second time by name
  (`dirNodeIsHiddenAlt`) for the pre-fold catalog case, and `Jump to...` excludes
  both hidden alts and placeholders.

**Identity ignores the extension**, because converting a collection changes it:
`altFileStem` / `altIdentityRelPath` strip it, and
`altCanonicalThumbKeyForRecord` gives `<canonical dir>/<stem>`. That key is what
per-file thumbnail metadata is stored under — `metaGet/SetFileThumbnailCropForRecord`
and `metaGet/SetVideoThumbnailTimeForRecord` read through
`metaThumbLookupKeysForRecord` and fall back to
`metaStoredThumbKeyMatchingIdentity`, so a crop set on `Foo/a.png` is still found
for `Foo -- VHS/a.avif`. Folder thumbnail pins are stored the same way and
resolved by `findEquivalentRecordInDir`. Scores, tags, ratings and folder
appearance need no special case at all: they are keyed by folder path, and the
canonical folder's path never changes.

Note that `reconcileFileMetadataExtensions` still runs at load and will re-key an
extensionless canonical key onto a concrete file (`Foo/a` → `Foo/a.png`). That is
harmless — the identity fallbacks above resolve either shape — but it is why
those fallbacks cannot be removed.

**Disk operations move the whole group.** `altSourceDiskPathsForNode` derives
each variant's real path from the canonical name, and rename
(`renameFolderDirNode` + `remapAltGroupAfterCanonicalRename`), trash
(`moveFolderPathsToTrash`) and put-back (`putBackTrashFolderPaths`) each carry
the ALTs along, best-effort, so a `Foo -- VHS` can never be orphaned next to a
renamed `Foo`.

The active label per folder is persisted in `preferences.general.log.json`
(`WS.meta.folderAltByPath`, re-keyed by `updateMetaPathsForRename`) and
re-applied by `applySavedFolderAlts` after every fold.

### Metadata archives (export / import)

`Metadata` in the app menu (between Controls and Refresh App) exports the
library's metadata to a zip in Downloads, or merges one back in. Both entries use
`closeAfter: true` — they open a native dialog, which is the one case where the
menu should get out of the way.

The zip holds `.local-gallery/metadata-export.json` (a `{schema, kind,
rootName}` manifest), one entry per metadata document, and the whole
`.local-gallery/thumbs` cache. **The list of document file names exists twice** —
`META_DOC_FILE_NAMES` in the web layer and `METADATA_DOC_FILE_NAMES` in
`fs.rs` — and they must stay in step: a name missing from the Rust list is
silently not exported and silently ignored on import. Export refuses (before
creating any file) when the library has none of them, so a half-written archive
can never be left in Downloads.

Import is split deliberately. Rust picks the file and returns only the known JSON
documents as text, plus — because thumbnails are opaque bytes with no merge
question to answer — it writes the cached thumbs straight into the current
library's `thumbs` folder, skipping any that already exist, and reports how many
landed. Everything else is merged in JS, where the live in-memory model is:
`metadataMergeDocObject` unions arrays, merges objects key-by-key, merges arrays
of `{id}` by id, and concatenates same-day journal text rather than picking a
winner. The merged doc goes through `metaApplyDocLogById` and is flushed to
whichever store is in force, so import works the same in the app and the browser
host.

### Companion scripts

- **`safekeeping/clean.sh`** — standalone Bash utility run separately against a media folder. 15 optional processing steps, and the menu's `0` runs the **core cleanup**, steps 1–5. Step 1 bundles three quarantine passes (dedupe via `fdupes`, similar-media culling via `czkawka`, empty-item quarantine); name sanitization (step 2) used to be a fourth pass inside it and was pulled out so renaming happens *after* the quarantining rather than in the middle of it. Then video conversion (step 3, `ffmpeg`), metadata removal (step 4, `mat2`), and — as the last core step — **Optimage compression** (step 5). Steps 6–12 are the optional extras: video trimming, MP3 extraction, static-media quarantine, archive unpacking (step 10: expands every archive in the tree next to itself via `unar` with zip/tar fallbacks, deletes it once the contents land, and rescans until no new archives appear), recursive delete (step 11: 15 criteria, previews the matches and requires the word `DELETE` typed back before anything goes), and a VHS look (step 12: `ntsc-rs-cli` from the installed app, one frame for stills and a re-encode for MP4s, written back over the original at a chosen height; the height prompt also takes `T`, which renders the first three files of the set at every height into `_vhs_height_test/` — one subfolder per height plus `original/` — so the size is chosen by looking rather than by guessing; it is the one `choose_*` option that does real work, because what it produces is the answer to the question asked on the next line, and every step's `find` prunes that folder so its samples are never mistaken for library media. The pace switch — `STEP13_VHS_PACE` — is `slow` (`nice`d, one file, one thread), `fast` (one file, flat out) or `ultra`, which keeps several files in flight through `step13_vhs_run_pool`. **Ultra's widths are measured, not reasoned about**, and the measurements contradict the obvious guess: an image job is nearly serial (0.73s wall for 0.83s of CPU, split between an ffmpeg decode, a single-frame ntsc-rs render and an encode, none of which threads far), so it wants **one job per logical core, efficiency cores included** — a short single-threaded job on a slow core is still throughput; a video job self-parallelizes to about 2x (5.2s wall for 10.4s of CPU, since the ntsc-rs pass and the x264 re-encode both thread), so it wants **half the cores**. On a 14-core M4 Pro the sweeps peaked at 14 image jobs (2.6s for 24 files, against 4.5s at 5 jobs) and 6 video jobs (16.1s for 12 files, against 31.7s at 2), and **both curves turn back up past the peak** — 16 image jobs and 10 video jobs are both slower — which is why `step13_vhs_ultra_jobs` is a measured number rather than "as many as possible". The memory caps beside it come from measured peak RSS (192 MB an image job, 537 MB a video job) budgeted at 1 GB and 2 GB for headroom, and bind only on a machine whose memory does not match its cores. Each job is then capped to `cores / jobs` threads (`step13_vhs_ultra_threads`): at the peak width that costs nothing (14 jobs runs the same at 1 thread as at 4) but without it 14 jobs at 14 threads each is measurably slower, which is how a wider pool ends up losing to `fast`. Each slot gets its own scratch folder — the per-file temp names are fixed — and reports through a status file, since the pool is polled rather than woken (bash 3.2 has no `wait -n`)). **Color grading (step 13)** is the gallery app's own filter panel as a batch: five dials — brightness, contrast, saturation, hue shift, temperature — each a whole percentage from -100 to 100 with zero meaning "leave it alone", plus an `Enhance` quick set (contrast +5%, saturation +10%, hue shift +5%) that is a lift rather than a look. The numbers *are* the app's: a percentage maps straight onto the app's own amount, so +10% saturation is the app's `saturationOverlayIntensity: 0.10`, and hue shift takes a percentage of a half turn. It adds **no new tool** — every one of the five is a linear operation on the pixel, so ffmpeg carries all of them. `color_grade_filter_chain` is where that is worked out, in awk, and three things about it are load-bearing. Brightness and contrast are folded into a **single** `colorlevels`, because every ffmpeg filter clips to 0..1 where the app clips only at the end, and a brightness lift followed by a contrast drop would otherwise come back with the highlights already flattened to white. That filter's levels are read off the ramp rather than set to 0 and 1, because ffmpeg silently treats an input level below zero as zero. And saturation, temperature and hue are each a 3x3 matrix — temperature included, since the luma it hands back after tinting is itself linear in the pixel — so their product is one `colorchannelmixer`; they are only sent as three separate mixers when the product would need a coefficient outside the ±2 a mixer accepts, which no single one of them ever does. The chain runs in float (`format=gbrpf32le`) for the same clipping reason, which means the output format has to be pinned back to what the source actually had or PNG comes back 16-bit and RGBA; `color_grade_pixel_formats` probes that per file. Checked against a reference implementation of the app's shader over 50-odd dial combinations, the two agree within about one 8-bit level. The one setting where they part company is a ramp that drives the whole frame below black: the app, floorless until the end, can lift a channel back over zero through saturation and so keeps a faint tint, where ffmpeg floors at the filter. Both give a black frame. Resize (14) and the AVIF/WebP/AV1 recompression (15) sit at the *end* of the list, deliberately outside the core cleanup, because all three are lossy re-encodes you opt into rather than defaults. **Step 15 has a pace of its own** — `slow` (the default, and byte-for-byte how the step has always run: one file at a time with the encoder free to take the machine) or `ultra`, a pool over `step15_run_pool`. Its per-file work was pulled out into `recompress_image_one` / `recompress_video_one`, each printing one `<outcome> <bytes saved>` line, so the serial loop and the pool tally through the same `recompress_tally` rather than through two copies of the accounting that could drift; the slots need no scratch folder because every temp name is derived from the source file. Each job is held to its share of the cores (`avifenc -j`, `MAGICK_THREAD_LIMIT`, and `lp=` for SVT-AV1) — without that last one a wider pool is *slower* than slow, since every job opens the whole machine. **The widths are measured**, on the same M4 Pro as step 12's, and the two halves do not have the same shape. An image job is almost perfectly serial (4.10s of CPU for 4.27s of wall — neither the Lanczos resize nor avifenc threads far), so it wants one job per logical core: 24 images went 103.0s → 13.7s at 14 jobs, with 16 and 18 jobs both slower, a peak sitting exactly on the core count. A video job does not behave that way, because SVT-AV1 already threads well; past about half the cores the curve simply goes **flat**, every width from 7 to 22 landing between 29.6s and 34.5s — a spread smaller than the run-to-run variance — so there is no peak to find and the number taken is the narrowest width that reaches the plateau. Images win about 7.5x, videos about 2x, and that asymmetry is just how much each encoder was leaving on the table. Peak RSS per job (358 MB image, 744 MB video) sets the memory caps, which bind only on a machine whose memory does not match its cores. `machine_cpu_total` / `machine_mem_gb` are shared with step 12's pool. The AI upscale/denoise step (`waifu2x-ncnn-vulkan`) was removed outright, along with its installer, its model resolution and its options prompt. Not invoked by the Tauri app.

  Its shape is: pick steps, resolve tools, answer every step's options, confirm
  once, then walk away. Options live in `choose_*` functions called from
  `main()` before the `Proceed?` gate — never inside a step body — and
  `ensure_step_requirements` runs for the whole selection up front, so a step
  that cannot run says so before anything has been touched. Step 12's
  type-`DELETE` gate is the one deliberate run-time prompt: it confirms the
  actual match list, which earlier steps in the same run can still change.

  **Step 5 drives the Optimage app, not its bundled CLI.** `Contents/MacOS/cli/optimage`
  handles PNG and JPEG only and has its own defaults; the app binary
  (`Contents/MacOS/Optimage -exit YES <files>`, the documented blocking form)
  handles every format it advertises and uses whatever the app's own Preferences
  say — which is what "drag it in and let it work" means, and why the step passes
  **no compression flags at all**. Adding one would be a second home for those
  settings and would drift from the app's. Two consequences: the app works in
  place subject to its own Preferences (a Destination folder or "Move original to
  Trash" set there applies here too), and the paths handed over must be
  **absolute** — given a relative path Optimage silently leaves the file alone and
  still exits 0, so a run reports success having compressed nothing. Every other
  step works in `./x` form, which is exactly the shape that fails here. Files go
  over in batches (`STEP5_OPTIMAGE_BATCH`) so the progress bar moves; each batch
  is one app launch.

  The step numbers in the menu and the `stepN_` prefixes on the functions
  behind them stopped matching long ago (`step_function_name` is the mapping
  table); the numbers users see are `STEP_ORDER` and `step_description`, and
  the function names are historical. Two unrelated steps both carry a
  `step13_` prefix, and the `STEP12_*` globals belong to two different steps
  (recompress and delete), for the same reason.
- **`safekeeping/userscripts/*.user.js`** — Tampermonkey/Violentmonkey userscripts ("Strippers") kept alongside the app for downloading media from external sites into the gallery folder. They are independent of the app. `STRIPPER_UI_STYLE_GUIDE.md` next to them specifies the shared panel design — one dark panel, one accent taken from the host site, used at fixed strengths — with the Playboy Plus Stripper as the reference implementation. Their `@updateURL`/`@downloadURL` point at `main/safekeeping/userscripts/<file>`; that is where they actually live, and the headers were left behind by the move into `safekeeping/` until they were repointed.
- **`docs/`** — documentation *about* the app: `TAURI_PORT_DESIGN.md` (the Electron→Tauri
  cutover) and `VARIATIONS_DESIGN_LANGUAGE.html`, a self-contained page specifying the
  visual language both the gallery and Variations are built in — tokens, control
  primitives, the text-marking rules and the state model. Open it in a browser; it is
  rendered in the language it documents, and `Cmd+P` gives a paged PDF of it.
- **`safekeeping/`** — everything in the repo that the app does not build or run: the userscripts, `clean.sh`, `compare.html`, the Automator workflows, the unused `assets/icon.icns` (the icons the bundle actually uses are `src-tauri/icons/`), and `safekeeping/scripts/`, which now holds only the `Local Gallery Dev Launcher.applescript`. The personal git tooling that used to live there (`checkpoint.sh`, `_commit_indexed.sh`, `authoritative.sh`, `stable.sh`, `unstable.sh`) was deliberately removed; commits that used to be made by it are made by hand, keeping the `Checkpoint NNNN` subject convention its history established. Nothing in `safekeeping/` is referenced by `package.json`, `tauri.conf.json`, the CI workflows or the Rust. `scripts/` therefore holds only the three scripts the build names.
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
