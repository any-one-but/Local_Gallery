# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # run the Mac app (Electron) from source
npm run build          # build the Mac app: dist-electron/ (.app + .dmg)
npm run release:patch  # bump patch version, build, then commit and push
npm run check:look     # every screen follows the UI tint/highlight (a release gate)
```

Local Gallery is **the Mac app, on Electron** (`electron/`), running
`frontend/index.html`. See "The Electron app".

**There is no browser version any more** (2026-10-19, Checkpoint 0294). The
page used to also ship as a Chrome page (File System Access API, a remembered
Documents/Local Gallery folder, a root prompt, browser-shortcut juggling, a
page fullscreen key) published to GitHub Pages. All of that, the Pages
workflow and `npm run web` were removed; it is in git history before then.
Opened in a browser the page does nothing useful. Do not add browser-only code
or constraints back without asking.

There is no Windows build.

**History.** The app used to be Electron, then moved to Tauri v2 + Rust (system
WebKit) for size and memory. On 2026-09-17 (Checkpoint 0209) that app was
removed because WebKit froze the whole screen scrubbing the library's AV1
video; it was restored on 2026-09-24 at Jo's request and, the same day, moved
back onto Electron: measured in the app, WebKit sometimes never finished a
backward seek in the library's own AV1 files (11 of 12 in one run, none in the
next -- not the encoding), while Chromium answers every seek in ~30ms and
holds the scrub keys with no frame over 13ms. The Tauri app (`src-tauri/`, the
Rust commands the Electron ones mirror, `embedded-inject.js`, its build
scripts and port docs) was deleted after that, in Checkpoint 0230; it is in
git history before then. Do not bring back a WebKit app without asking.

## The Electron app

`electron/` is a shell around the page. The page, `tauri-bridge.js` and
`tauri-fs-shim.js` were written for the Tauri app and run here as they are
(hence their names): the page takes its app paths (`LG_HOST_IS_APP`) and calls
`window.__TAURI__.core.invoke`, which here reaches the main process.

- `main.js` -- the window (fullscreen), the menu, the IPC route, crash reloads.
  The menu deliberately has **no Cmd+W, Cmd+R or Shift+Cmd+W**: the gallery
  uses all three and a menu accelerator would take them first.
- `media.js` -- two protocols. `lgapp://local/` serves `frontend/` and writes
  the bridge, both shims and (dev) a test script into the head of every HTML
  page -- Tauri's initialization scripts, done as page text. `lgmedia://localhost/<encoded path>`
  serves library media from folders granted by `allow_media_scope`, with range
  requests. **An open-ended range is answered to the end of the file**: capped
  at 4 MB (as the Tauri app's server did) Chromium failed every video larger than the cap.
  `__LG_VIDEO_HTTP` is empty, so videos use `lgmedia` too; there is no
  loopback server.
- `commands.js` -- every command the page invokes, same names, arguments and
  result shapes as the Tauri app's Rust ones (each notes which it mirrors;
  the Rust is in git history before Checkpoint 0230). Errors reject
  with a plain string, as Tauri's do. Thumbnails: `sips` for images (shrink
  only, JPEG quality 90), the bundled ffmpeg for video frames, QuickLook as the
  fallback. Archives use `ditto`.
- **Full resolution thumbnails are 2048px copies, not originals**
  (`FULL_QUALITY_THUMB_EDGE`, `tauriThumbForImgEl`). Painting the originals
  made Chromium re-decode ~49 26-megapixel photos on every frame of a big-photo
  model (Madison Kate): 170-600ms from key press to screen, against 32-56ms
  after. The copies are cached in `.local-gallery/thumbs` like the 512px ones.
  `dev_send_key` (dev only) sends a real key press, so a test script can read
  key-to-screen time from the Event Timing API; `LG_DEV_LAG=1` reports stalls
  of the main process.
- `embedded.js` -- Grok and Claude as `WebContentsView`s filling
  the window. The main process sees every key first (`before-input-event`),
  so closing (Escape, the toggle key, Shift+Cmd+W), switching and zooming are
  handled there, which is why no script is injected into the sites.
  Grok and Claude run in their own sessions (`persist:grok`), which is what
  keeps the library protocol out of their reach. Variations is **not** a view
  any more (it is part of the gallery page; see "Variations"), but it keeps
  its label here so the three keys still hand over to each other: its key
  pressed inside Grok or Claude takes that view down and calls
  `window.LGVariations.open()` in the page (`openVariationsInPage`), and the
  Window menu's Close item closes whichever of the three is up
  (`closeFrontmost`).
- `session.js` -- the unlock-survives-a-reload state and the watchdog.
- `system-auth.js` -- the macOS prompt behind the lock (Touch ID or the Mac
  password) and the focus handling around it; see "The app lock".
- `dev.js` -- the development switches (`LG_DEV_WINDOWED`, `LG_DEV_SCRIPT`,
  `LG_DEV_MEDIA_ROOT`) work unpackaged, or in a built app started with
  `LG_DEV=1`. `dev_report` prints `[lg-dev] ...` to stderr. That is how the app
  is tested from a terminal without taking over the screen:
  `LG_DEV=1 LG_DEV_WINDOWED=1 LG_DEV_SCRIPT=probe.js "dist-electron/mac-arm64/Local Gallery.app/Contents/MacOS/Local Gallery"`.
  `LG_DEV_USER_DATA=<dir>` runs it on a throwaway profile (so a test never
  touches the real app's remembered look or sessions) and `LG_DEV_HIDDEN=1`
  never shows the window; `scripts/check-look.js` uses both.

Packaging is electron-builder (`build` in `package.json`): ad-hoc signed, no
hardened runtime (ad-hoc signing with it fails library validation), ffmpeg
copied into `Contents/Resources`. `package.json`'s own version is zero-padded
(`01.07.37`), which is not semver, so the bundle takes
`build.extraMetadata.version`; `release:patch` keeps both in step.

## The library's shape (what things are called)

This is fixed, and every feature is built on it:

- **Root** -- the library folder itself (`WS.root`).
- **Model folders** (Models) -- the folders directly inside the root. Each one
  is a person.
- **Sets** (Set folders) -- the folders directly inside a Model.
- **Media files** -- images, videos and text, directly inside a Set.

Only folders go in the root, only folders go in Models, and only files go in
Sets. The tree is exactly that deep and no deeper. In code, a Model is a node
whose `parent === WS.root`, and a Set is a node whose `parent.parent ===
WS.root`. Use these names in labels, messages and docs ("Jump to random set in
root", not "sibling folder"). Tags, Favorites, Hidden
and Trash are views over this tree, not extra levels of it.

## Architecture

The gallery is one page, run inside the Mac app, which reads the library
through directory handles that `tauri-fs-shim.js` provides over the main
process. Variations, the prompt composer, is part of the same page (see
"Variations"); there is no second page.

The page used to be a single ~86k-line `index.html` (one inline `<style>`, one
inline `<script>`). Since Checkpoint 0295 it is split into files, moved
verbatim, and served by `lgapp://local/` like the page itself:

- `frontend/index.html` -- the markup only, plus the `<link>` and `<script>`
  tags in order.
- `frontend/styles/*.css` -- the stylesheet, cut at its own section comments
  and linked in the original cascade order (`tokens.css` first,
  `liquid-glass.css` last, then `keyboard-only.css` and `media-zoom.css`, which
  were the two separate `<style>` blocks).
- `frontend/js/theme-boot.js` -- the tiny `<head>` script that paints the
  remembered look before anything else.
- `frontend/js/<area>/*.js` -- the gallery script, by feature: `core/` (host
  detection, names and paths, ALT folders, options, `WS`, UI references,
  status, dialogs), `appearance/` (colour schemes, theme, filters, the filter
  engine, icons and card pills), `metadata/` (the log documents, scores,
  loading, saving, never forgetting), `tags/`, `library/` (storage, catalog,
  building the tree, renames, sorting, filters, file order, folder
  operations), `navigation/`, `menus/`, `panes/`, `media/`, `thumbnails/`,
  `keyboard/`, `settings/` (the retired Settings pane), `features/` (app
  lock, journal, app volume, music player, debug mode), and `boot.js` last.
  Each file starts with a two-line comment saying what it holds; the old
  `/* ===== Section ===== */` banners are still in the code. `grep -rn` over
  `frontend/js` finds a function the way searching the one file used to.
- `frontend/js/variations/*.js` and `frontend/styles/variations.css` --
  Variations, the one **ES module** graph in the page (see "Variations").
- `frontend/icons/` -- the favicons that used to be inline data URLs.

### Load order (read this before adding, moving or reordering a script)

(Variations is the one exception: `js/variations/` is an ES module graph,
loaded by one `<script type="module">` after `boot.js`, and nothing in this
section applies to it -- see "Variations".)

The scripts are **classic scripts, not ES modules**, loaded in the order
`index.html` lists them, which is the order the single script ran in. They share
one global scope: a top-level `const`/`let` in one file is visible to all the
others, and a top-level `function` is a property of `window` -- debug mode
replaces render functions by assigning `window[name]`, which only works for
classic-script function declarations. Do not turn them into modules.

What changed is hoisting. **A function declaration is hoisted only within its
own file now.** So code that *runs while the page loads* -- a top-level
statement, an IIFE, the initializer of a `const` -- may only use functions and
`var`s declared in its own file or an earlier one. A function used later, from
an event or a render, can live anywhere. A few declarations were moved out of
their feature's file for exactly this reason, and must stay early:

- `appearance/ui-color-schemes.js` (the colour scheme lists, their `var`
  caches, and the theme/tint/highlight normalisers) and
  `normalizeMinScoreFilterValue` / `normalizeAppVolumeValue` at the end of
  `core/options.js` -- `normalizeOptions` runs at load (for
  `META_GENERAL_PREFERENCE_OPTION_KEYS` and `WS`) and calls them.
- `currentThumbWorkerCpuBudget` in `core/runtime-state.js` (a constant is
  computed from it).
- `getQuadPlaybackSlots` in `core/ui-references.js` and the
  `syncThumbFilterKeyWithCurrentAppearanceContext` stub in
  `appearance/apply-options.js` (`setupDivider` applies the media filter at
  load).

**Between two files the browser gets a turn.** Promise callbacks run after
every file, and timers, IPC replies, observers and events can run between
files too (measured: a `setTimeout(0)` set in an early file fired before later
files had loaded). The single script never gave anything that chance. That is
what `js/boot.js` is for: everything that starts work which needs the whole
app -- the library auto-open (`tryAutoOpenManagedLibrary`), the first render
and its async settings sync ("Initial UI state"), the preview's
`ResizeObserver`, installing debug mode, and the reveal `requestAnimationFrame`
-- was moved there, in its original order, and it loads last. **Do not
schedule a timer, observer or promise at load in an earlier file** unless
everything its callback can reach is already loaded by then. Event listeners
registered early can in principle fire in the gap; in practice only the card
pill `MutationObserver` and `onInlineThumbSettled` (external scripts fire
`load` events, which a capture listener on `document` sees) run there, and
both ignore anything that is not a card or an `<img>`.

Adding a file: put its `<script src>` where its load-time code can see what it
needs, and check the app opens with no errors (the dev harness, and the debug
log). The split was verified by tracing every function called and every `var`
read while the original page loaded, plus a static pass over every top-level
statement; a throwaway script, not kept in the repo.

**Media** is served by the app's `lgmedia` protocol (`ensureMediaUrl`); the
blob-URL and non-native thumbnail paths left in the file are the old
browser-era fallbacks and do not run in the app. **Persistence** is `<library>/.local-gallery/*.log.json`,
written through the same directory handles.

### Host detection

`LG_HOST_IS_APP` (from `window.electronAPI` / `window.__TAURI__`, which the
Electron app sets) is still computed and read in a few places; it is always
true in the app. The page opens the managed library directly
(`openFixedAppMediaFolder`, at boot and after Lock now) and serves media
through `window.__lg.assetUrl` / `videoUrl`. Every Cmd/Ctrl chord the app has
a binding for is `preventDefault`ed before Chromium sees it
(`shouldReserveAppKeybindBeforeBrowser`, `RESERVED_APP_KEYBIND_EVENTS`).

### Core data model (`WS` global)

The `WS` object (`const WS = {`, in `js/core/workspace-state.js`) is the single global workspace state:

- `WS.root` / `WS.dirByPath` — directory tree. Nodes are `DirNode` objects created by `makeDirNode()`. The tree is built from file handles obtained via the File System Access API.
- `WS.altSourcePaths` — the on-disk paths of folded-away ALT folders, so records still sitting under one can be filtered out of every listing. See "ALT folders".
- `WS.fileById` — `Map<id, FileRecord>`. Each `FileRecord` holds `{ id, file, name, relPath, dirPath, ext, type, url, thumbUrl, videoThumbUrl, ... }`. Object URLs are created on demand and revoked when the workspace resets.
- `WS.catalog` — on-disk catalog for deferred loading of large libraries (stored as sharded JSON in `.local-gallery/catalog/`).
- `WS.meta` — user preferences, scores, tags, keybinds, appearance presets. Persisted to `.local-gallery/` as one JSON log file per document; `META_DOC_FILE_NAMES` is the authoritative list (`scores.log.json`, `score-history.log.json`, `tags.log.json`, `tag-albums.log.json`, `custom-thumbnails.log.json`, the seven `preferences.*.log.json` sections, `keyboard-configuration.log.json`, …). An old `tabs.log.json` may still sit in the folder from when the app had tabs; nothing reads or writes it.
- `WS.view` — transient UI state (filter mode, slideshow, bulk select, search, navigation history, active pane, etc.).
- `WS.nav` — the currently listed directory and its `entries[]` (mixed `{kind:"dir"}` / `{kind:"file"}` list) used for the List Pane.
- `WS.preview` — what the Preview Pane currently shows (`kind`, `dirNode`, `fileId`).

### UI layout

Three panes rendered via CSS grid in `#app`:
1. **Title Pane** (`#titlePane`) — the folder title / info / search row (`#titlePaneTop`). **There are no tabs**: the tab system (strip, actions, `Cmd+1`–`Cmd+9`, `tabs.log.json` reading and writing) was removed outright, and no key is reserved for it.
2. **List/Directories Pane** (`#directoriesPane`) — folder tree + file list for the active directory.
3. **Preview Pane** (`#previewPane`) — media viewer (image/video/gif) with a control bar (`#controlPane`).

**There is no Settings pane.** Its markup was removed from the document —
`#menuOverlay`, `#optionsBody`, `#keybindsBody`, `#menuTitleBar` and
`#calendarBody` are all gone — so everything that used to render into it is
unreachable code that still parses. `renderOptionsUi()` returns immediately on
its `if (!optionsBodyEl)` guard, `openMenu()` / `closeMenu()` are inert,
`initSettingsFloatingWindow()` no-ops on the missing node, and
`toggleSettingsWindow()` opens the **app menu** instead. The option rows
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

The separate Settings window (a second app webview) is gone, and so is the
page's `IS_SETTINGS_WINDOW` flag and its branches.

`renderPreviewPane()` is the main re-render entry point for the preview side. The directories/file list side is rebuilt through `rebuildDirectoriesEntries()` and related helpers.

**No name is declared twice any more.** The script used to carry a fossil layer
of stubbed thumbnail functions — 273 top-level declarations that a later
declaration of the same name shadowed, and which hoisting therefore made
unreachable from the first line of the script. They are gone, so a `grep` for a
function now finds the one that runs. Keep it that way, across all the files
in `frontend/js`: a top-level `function` declared again in a later file silently
replaces the earlier body for every caller, and a `const`/`let` declared again
stops the page loading.

### Two menus: the app menu and the select menu

They are one element (`#appActionMenu`) in two modes, because only one can be
open at a time. `APP_MENU_MODE` is what `buildAppMenuItems()` reads to decide
which list to build.

- **App menu** — the library and the app. **Hard-bound to Tab**, handled
  directly in the global keydown listener rather than
  through `KEYBIND_ACTIONS`, so it cannot be rebound or lost. It does **not**
  require a selection, and it has no Selected Item section. **Where it opens
  is `Experimental -> Menu placement`** (`appMenuPlacement`: At the item, the
  middle, a corner or an edge of the window), and how far from the item and
  how high both menus sit when they open at an item is `Experimental -> Select
  Menu -> Menu distance / Menu height` (both moved there from Appearance,
  2026-10-23) (`appMenuDistance`, `appMenuHeight`).
  The three were fixed for a while (at the item, flush, raised) and were put
  back (2026-10-21); the defaults are those fixed values (`item`, step 3,
  step 4), so a library that never picked one sees the menus where they were.
  `getAppMenuPlacementFromOptions` / `...Distance...` / `...Height...` answer
  the stored value (`getStored...FromOptions`). With **Sidebar settings
  menu** set to Left or Right (Experimental) the app menu is a sidebar instead and placement
  does not apply to it.
- **Select menu** — the selected item's own actions, and nothing else. Keeps the
  old bindable `openAppMenu` action (relabelled *Open select menu*), and always
  appears beside the item, because it is about that item. The section is
  *unwrapped*: `selectedItemMenuSectionItems()` returns the flat list and the
  menu shows it directly rather than as a submenu to step into. A quarantined
  item still gets its single `Remove from Trash/Storage` button instead.
  **There is no Add To... submenu.** The first option is **Edit tags**
  (`EDIT_TAGS_LABEL`), which `organizeSelectMenuItems` builds out of `Add
  tag`, `Add tag to all contents` and `Remove tag` (`ADD_TO_TAG_LABEL`,
  `ADD_CONTENTS_TO_TAG_LABEL`, `REMOVE_TAG_LABEL`) wherever the builders put
  them; Remove tag is the old Remove From... and lists only the Tags every
  selected item shares, each row just the Tag's name. `Send to storage`
  (`data-action="send-to-storage"`) always sits right above the removal
  row. It looks like every other row: no red, no
  outline, no special case (`.destructiveAction` has no style; code finds the
  row by the class). Red text, a red icon tile and an inverted block were each
  tried and rejected -- Jo's rule is Finder's: Move to Trash is plain text. Favorite and Hidden are not places you add to and remove from but ●/○
  toggles (`createSelectMenuToggleButton`). A folder (or several) keeps
  everything about itself in **Folder options** (`createFolderOptionsSubmenu`):
  Rename, Copy path and Copy folder (one folder only; the ALT's own folder
  when one is showing: the full Finder path as text through the main
  process's `copy_text`, or the folder itself as Finder's Copy puts it,
  pasted with Cmd+V or moved with Option+Cmd+V, through `copy_folder`, which
  asks AppKit via osascript since Electron's clipboard cannot hold a file),
  Favorite, Hidden, Overrides and Thumbnail, then the file-order
  actions (Reverse file order, Reset order, Index, and Merge folders for
  several Sets; see "Reordering files").
  **There is no Other submenu** when the selection has Folder options or Tag
  options: whatever `isSelectMenuTopLevelElement` does not name is put at the
  end of that submenu instead, and Other is built only for a selection with
  neither. Hidden
  reads the folder's own mark, not one inherited from a hidden Tag. A toggle
  that takes the item off the screen (Hidden, with hidden items not revealed)
  closes the menu.
  A real Tag (single or several selected) gathers its own settings in a
  **Tag options** submenu: Rename, Exclusive, Hidden, Create inverse and
  Overrides; its Thumbnail stays at the top level. A Tag's Rename closes the
  menu before opening the naming field, which would otherwise sit under it.
  `isSelectMenuTopLevelElement` must name every top-level row, or
  `organizeSelectMenuItems` moves it into Folder options / Tag options. Special buckets keep Overrides
  at the top level. The select menu **rebuilds itself after any option**
  (the document capture click listener schedules `refreshAppMenuContents`
  unless the option already rebuilt it, tracked by
  `APP_MENU_REBUILD_GENERATION`), which is what keeps every ●/○ toggle live.

**Utility containers** -- Trash, Untagged, All tags, All Models,
All Sets, Certified fresh, Tag storage and each Model's media views -- are shown and hidden together by one switch: `showUtilityContainers`
(on by default), the `Utility containers` toggle in Basics and the one bindable
`toggleUtilityContainers` action (`u` by default). The six per-container
accessors (`showTrashFolderEnabled` and friends) all read it, and the old
per-container options and actions are gone: `normalizeOptions` seeds the switch
from the old options once (on if any was on), and `normalizeKeybinds` hands the
first saved key of the old actions to the new one. There is no Reveal... /
Special containers submenu any more. Favorites is not a utility container --
it shows whenever something is favourited. Hidden (reveal hidden items) sits
in Basics beside it, after Quick navigation. `Random actions` is
gone from the menu -- its jump weighting was removed outright and its sort
toggles are ordinary Controls; the builder is still in the file.

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
Appearance, Thumbnails, Display names, Music, History, Controls, Lock, Experimental,
the two exports, Refresh App **always last**. Thumbnails and Display names
were inside Appearance until 2026-10-23.
Each of those top-level rows carries a lucide icon left of its name, attached
in one place by `withAppMenuSectionIcon` from `APP_MENU_SECTION_ICON_KEYS`
(label → key into `APP_ICON_SVGS`) — renaming a section means updating that
map. The select menu's first page gets the same treatment through
`withSelectMenuItemIcon` / `SELECT_MENU_ITEM_ICON_KEYS` (Edit tags, Rename,
Tag options, Folder options,
Overrides, Thumbnail, Other, ALTs, Send to storage, Empty Trash, Remove from
Trash, Remove from Storage); the removal row is matched by its
`data-action` (`move-to-trash` / `delete`) instead, since its label names the
selection. `Basics` holds the everyday view controls (sort, media filter, score is at
least, quick navigation, Hidden, Slideshow and Slideshow duration), each with an icon from `APP_MENU_BASICS_ICON_KEYS`;
float tags lives under Appearance. Full screen media is no longer an option, and
it is an overarching rule: **open media is totally full screen**. While
`#app.preview-media-mode` is set (`syncPreviewMediaModeClass`, fixed on) the
title bar is not drawn and its grid row is zero, so no
chrome of any kind shares the window with the media. Rows deeper
in the select menu (Overrides cyclers, the Tags under Add tag, Thumbnail's Default /
Random / Shuffle / Blank and a file's thumbnail places) get icons from
`SELECT_MENU_NESTED_ICON_KEYS`, keyed by the submenu they sit in; Remove tag
rows take the icon of the place they leave (`LABEL_REMOVAL_ICON_KEYS`).
The settings menu's nested rows get the same treatment from
`APP_MENU_NESTED_ICON_KEYS` (`withAppMenuNestedIcons`, same walker with a
different map); the filter sliders take theirs where they are built
(`APP_MENU_FILTER_CONTROL_ICON_KEYS`), since the walker would flatten their
two-part layout; the confirm page's Yes / No carry icons too. A map entry `"*"`
covers a panel of user-named rows (ALTs). New icons are lucide SVGs in
`APP_ICON_SVGS` under `lu<Name>`. **Every option in both menus has an icon** --
a new row needs a map entry, or it is the one row without. Controls, Jump to...,
Stats and the calendar's folder rows are the deliberate exceptions. A toggle
row that has an icon drops its ●/○ marker and shows a checkmark at its right
end when on, nothing when off, as a macOS menu does (`menuToggleOn` /
`menuToggleOff`, set in `withMenuItemIcon`; the mark is a CSS pseudo-element
so the row's text, which a rebuild finds it by, does not change). A cycler's
row ("Sort: Score") is drawn as the name on the left and the value in grey on
the right (`.menuRowWithValue` / `.menuRowValue`), the way Filters' rows are.

`Add tag` is a **hybrid** (`createAddToTagSubmenu`, via
`createSelectMenuAddToTagRow`, which takes each builder's plain "Tag" button): pressing it opens
the naming field at once, which takes a comma list ("A, B") and adds to any
name that already exists -- `commitTagEntryRename` applies the folder diff and,
for Tags put in Tags, one parent per name. Stepping into it lists **Create new**
and then every Tag. Create new is a hybrid too: pressing it names one fresh Tag
straight away; stepping into it offers Exclusive, Sort, Filters and Media type
with **Create** at the bottom, which opens the naming field with those settings
waiting (`pendingContainerOverrides`, applied by
`applyPendingContainerOverrides` to whatever name is committed). The settings
are a draft held outside the menu (`ADD_TO_TAG_CREATE_DRAFTS`, one per
submenu), because the
select menu rebuilds itself after every option; `openAppMenu` starts a fresh
one. Each Tag row is a ●/○ toggle that **keeps the menu open**
(`toggleSelectionInTag`), so one selection can go in several Tags in a row, and
the bulk selection is kept for the same reason. A row stays listed until the
menu closes (`ADD_TO_TAG_OFFERED_NAMES`) so emptying a Tag does not pull it out
from under the cursor. If a toggle moves the item off the screen (taking it out
of the Tag it is viewed through, or into an Exclusive one) the menu closes,
since it would otherwise be about whatever is selected next
(`selectMenuTargetIdentity`). `Add tag to all contents`
(`buildAddContentsToTagSubmenu`, directly under Add tag) is the Tag option aimed at
the selection's child folders, with the same shape over the same parts
(`createAddToTagHybridSubmenu`, `createAddToTagCreateSubmenu`): pressing it opens
the naming field, stepping in lists Create new and every Tag, and its rows toggle
the selection's contents rule (`toggleSelectionContentsInTag`) rather than the
selection's own Tags. A new Tag made there gets its settings through the
contents branch of `commitTagEntryRename`. Favoriting shows
"<name> added to Favorites in <parent>" (or "N items ...") from
`announceFavoritesAdded`, called by both favorite writers.

There is **no reading mode** any more (it was removed with its toggle, option,
keybind and held-key scrolling). The tall/wide scroll layout for
extreme-aspect images (`detectScrollImageMode`, ratio ≥ 2.2) is separate and
stays.

**Hard-coded folder keys.** `KEYBIND_LOCKED_ACTIONS` also pins `prevFolder`
(Cmd+W), `nextFolder` (Cmd+S), `prevRootFolder` (Cmd+Shift+W) and
`nextRootFolder` (Cmd+Shift+S). Like every fixed key they are listed on the
hold-`[` page, not in Controls. The root pair (`stepRootFolder`) steps between the folders directly
inside the library root from any depth, landing through `jumpToLocationTarget`
over the same list Jump to... shows, clamping at the ends. The Storage toggle's old
Cmd+Shift+S default is gone (a locked key wins over any saved binding). In a grid of
folders the folder pair jumps to the top / bottom of the selected card's column
instead (`currentLocationSupportsFolderColumnEdgeJump`); a Tag's or special
view's grid does the same, and there the key never falls through to a sibling
jump (`previewPaneFolderJump`).

**Jump to root** (`jumpToRoot`, unbound by default, in Controls after the root
folder keys and on the hold-`[` page under Moving around) is
`jumpToLibraryRoot()`: the same landing as the enter key on `Jump to...`, from
anywhere, closing the viewer or an open file on the way.

**Controls layout.** Three columns -- name, key, Clear -- each one width
all the way down: the panel is one grid (`minmax(0, max-content)
max-content max-content`) and each row a subgrid of it, so every column is
as wide as its own widest cell and every cell in it lines up (they used to
fit each row's own content, so no two rows lined up), and the panel is as
wide as that needs (the menu's 600px cap is lifted while it is open). The
columns need not match each other. Columns are set apart by space, with no
rule between them; the key column is centred. In a sidebar it keeps the
sidebar's cap and the name column gives way.

**No divider lines in either menu.** The heading, Item Info, the Stats
summary, Jump to...'s columns and a Calendar day's actions are set apart by
space only (2026-10-23, Jo: lines clash with the style). The menu's own rim
and a text field's rim are edges, not dividers, and stay.

**Controls order.** Controls lists only what can be rebound: anything in
`APP_MENU_CONTROLS_HARDCODED_IDS` or `KEYBIND_LOCKED_ACTIONS` is left out
(`buildAppMenuControlsSubmenu`), because the hold-`[` page already lists every
key, fixed ones included. The rest is `KEYBIND_ACTIONS` in array order --
there is no sort -- so the array *is* the menu. It is grouped: navigation,
selection and item actions, random, viewing (sort, filters, visibility,
thumbnails, names, theme, presets), playback, then app-level (messages, refresh,
the embedded windows, panic). A new control goes in its group, not at the end.

### Hold [ for the controls list

Holding `[` shows `#keyHelpOverlay`: a centred, read-only bubble listing every
command, shown the moment the key goes down and gone the moment it comes up. It
is built fresh on each show by `keyHelpOverlayHtml()`:

- **What is listed.** Every row of `appMenuControlBindings()` -- the fixed keys
  as well, which Controls itself leaves out (so
  menu-only actions whose keys do nothing are left out), grouped by
  `KEY_HELP_GROUPS` in the same order as Controls; anything bindable not named
  there lands in "Other" rather than vanishing. The score keys (`=` / `-`) are
  hidden from Controls but live, so `KEY_HELP_ALWAYS_LISTED_IDS` adds them. Keys
  handled outside `KEYBIND_ACTIONS` altogether (search, Esc, the
  thumbnail Cmd+arrows) are `KEY_HELP_BUILT_IN_ROWS`. A command with no key is
  still a row, dimmed, with a dashed "Not set" chip.
- **`]` while holding** hides the list and opens Settings -> Controls
  (`openControlsFromKeyHelp`).
- **Why `[` and not `/`.** `/` is search, and a hold on the same key would have
  needed a delay to tell a tap from a hold. Both bracket keys are matched on the
  physical key (`BracketLeft` / `BracketRight`) as well as the character, so
  Shift and other layouts behave the same.
- **It can never stick.** Keyup of `[` ends the hold, and so does the window
  losing focus, since that keyup would never arrive. Typing `[` into a text
  field is left alone.

It is shaped like the menus (`--menu-surface-radius`) but **borderless** --
no rim on the panel and none on the key chips, which are plain
`--ui-control-bg` fills like Controls' key cells; an unset key is quiet italic
text, as in Controls -- and **solid**: the background is `--tint-base`, the theme's full-strength tint, with
no backdrop blur -- any transparency let the grid behind compete with the dense
labels. It follows the theme, not the Bubble tint or Diffusion settings. It takes no pointer events, and when it would be taller than
the window it tightens (`keyHelpCompact`) instead of scrolling, since nothing
can scroll a list that disappears on release. `[` is reserved: a locked
`keyHelp` binding ("Show all controls (hold)") is listed here beside Settings
menu, and `KEYBIND_LOCKED_ACTIONS.keyHelp` stops it being assigned elsewhere.

### The Mac look (2026-10-23)

The design direction (a doc Jo has, "Local Gallery: Design Direction") is to
read as a Mac app: Apple's sizes and conventions, light weights, the picture as
the only loud thing. What that put in place, and what new work should follow:

- **Type scale and spacing are tokens** (`tokens.css`): `--text-title` 22,
  `--text-headline` 15, `--text-body` 13, `--text-small` 11; weights
  `--weight-regular/medium/semibold` (400/500/600 -- nothing bolder); spacing
  `--space-1..6` on a 4px step; menu rows `--menu-row-h` 28px with
  `--menu-pad` 6px, and corners that nest (`--menu-surface-radius` 14 =
  `--menu-item-radius` 8 + the pad). Use these, not new sizes. Section labels
  are sentence case, small, semibold and grey -- no uppercase or letter
  spacing.
- **Keys are written as macOS writes them**: `keyLabel` gives ⌃⌥⇧⌘ in Apple's
  order run into the key (⇧⌘W, ⌥↑, Esc), for every list of keys.
- **The top bar path is Finder's breadcrumb**: every title builder joins with
  `TITLE_PATH_SEPARATOR` (" › ") and `updateTitleLabel` splits on it to draw the
  crumbs (grey, then the current one in the title colour). The search field
  has a magnifier and a "/" key cap inside it.
- **Scrollbars are the system's** (the old rules hid every one), and nothing
  sets the pointing-hand cursor.
- **Card names go under the picture** for folder and Tag cards
  (`styles/card-captions.css`; Experimental -> Folder names, `cardCaptions`,
  "below" by default, "on" puts the pills back exactly; a root with no
  `data-card-captions` attribute reads as "below"). Files in a Set keep their
  overlay. Every part of a folder card but its name overlay lives
  in a `.cardPicture` square (`appearance/card-pictures.js`, one observer
  that moves anything landing loose in a folder card into it): under
  "Under picture" that square clips and places the picture -- a zoomed or
  moved thumbnail is absolutely positioned larger than its card -- and under
  "On picture" it is `display: contents`, so the card does it as before. (The
  first version let the card stop clipping, and every zoomed thumbnail spilled
  over its neighbours.) Justified natural-shape grids keep their pills. The
  captions undo pill rules that are `!important` under `#previewPane`, so the
  rules there are too. A score of 0 is never shown on a
  card, and position numbers are off by default.
- **Opening media zooms out of its card** (`media/open-zoom.js`; Experimental
  -> Opening media, `mediaOpenAnimation`, "zoom" by default). The keydown
  listener is the named `galleryKeydown`, and the document listener hands each
  key to `mediaOpenZoomTakesKey` first. The zoom is **a layer of its own** over
  the window (black backdrop, a clipping frame, a canvas copy of the picture);
  the gallery itself never animates. Opening: the frame starts over the card's
  square showing the same part of the picture (zoom and crop included, read off
  where the `<img>` sits), grows to the picture's place in the window, and only
  then is the key run; the layer stays until `openedMediaIsPresented()` -- the
  viewer's element holds the opened file (`dataset.previewFileId`), is
  decoded, and with a filter on `MediaFilterEngine.isShowingTarget("preview",
  rec)` -- then goes in one step. That wait is what hides the previous file
  left in the viewer and the filter's first draw, which can take over a
  second. Closing: the copy is cut from what is on screen
  (`MediaFilterEngine.renderSurfaceNow` with a filter), the key runs at once,
  and the frame shrinks to the landing card once its square stops moving. When a
  Set's card shows a picture other than the file that opens (a picked
  thumbnail), Experimental -> Thumbnail isn't the first file
  (`mediaOpenZoomMismatch`) decides: Morph (the card's picture dissolves into
  the first file as it grows; the default), First file (the first file grows
  from the square, fetched for up to 220ms first), Switch at end, or Don't
  zoom. The first file is the grid's own thumbnail of it (`requestThumb`),
  and the frame re-aims at its real shape when it arrives (`reaim`), since the
  library's guess at a shape can be wrong. A key while the layer is up
  finishes it (`finishMediaOpenZoomNow`). An earlier
  version used `document.startViewTransition`; it was dropped because its
  snapshot of the new screen caught the viewer before it had drawn the new
  file (the last file showed through, and the unfiltered picture). Escape does
  not close a file reached by quick navigation's dive (it never did --
  leaveDir does).
- **Find a setting**: / in the settings menu (`menus/app-menu-find.js`,
  `APP_MENU_FIND`). `buildAppMenuItems` returns the find page while it is set;
  the matches are read off the normal build, and choosing one rebuilds the
  menu with `applyNumberedMenuKeyState` at that row (the macOS Help menu's
  behaviour) rather than running it.
- **No dead CSS**: about 1,870 lines styling retired screens were removed
  (Checkpoint 0320). Before restyling, a screenshot harness compared 27
  screens pixel for pixel; build one again for any cleanup (the dev switches
  plus a library where every picture is the same image, since a few cards
  pick theirs at random).

### Debug mode (` key)

`` ` `` (or `~`) toggles a debug panel; `Option+` `` ` `` copies a debug report
(markdown: state, options, recent events) to the clipboard, meant to be pasted
to a coding agent. Both are fixed (`KEYBIND_LOCKED_ACTIONS.debugMode`,
`APP_MENU_DEBUG_CONTROL_BINDING`), listed on the hold-`[` page, handled by a
window capture listener in the "Debug mode" block so they work with a menu
open, ignored in text fields and behind the lock screen. The on/off state is
remembered in `localStorage` (`lgDebugMode`).

- **`#lgDebugHud`** (solid, top-right, no pointer events, refreshed every
  250ms): both panes' positions, the grid cursor and open file, the menu and
  any inline edit, the last key with the action it resolved to, library size,
  thumbnail work, frame rate, worst frame, and timings for
  `renderPreviewPane` / `renderDirectoriesPane` / `rebuildDirectoriesEntries`.
- **`DEBUG_MODE_LOG`** (200 entries) records errors, `console.error/warn`,
  status messages, failed thumbnails, renders over 120ms and main-thread stalls
  over 250ms. It records while the panel is off, so turning it on after a
  problem still shows it. `debugModeLog(kind, message)` is the one way in.
- **Outlines**: `html.lgDebugMode` marks replaced thumbnails
  (`[data-broken-thumb]`) red and still-waiting slots (`.thumbIconPending`)
  amber.
- **`window.__lgDebug`**: `state()`, `report()`, `log`, `toggle(on)`.

It only observes. The render timings work by reassigning the top-level
function names (`window[name] = wrapper`), which replaces them for every caller;
`showStatusMessage` is wrapped the same way.

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
  `getPreviewFolderAndFileEntries` → `locationTargetForEntry` →
  `subItemSourceNodeForTarget`, so Tags, the Tags they hold and the special
  buckets nest where they actually live and sort/filter/visibility agree with
  the grid. The jump itself is `makeLocationState` + `restoreViewerCloseState`
  — a view "located at" an item (the "Locations" block in the script).

Stored folders and the Trash are dropped at every level whatever their
visibility toggles say (`appMenuJumpTargetIsExcluded`), so nothing
quarantined is reachable here.

### Storage (an attribute, in place)

**Storage is an attribute a folder carries where it is**, like Hidden
(2026-10-24, Jo's call): the reserved `__storage__` mark (`STORAGE_TAG`) in
the folder's tags. **There is no Storage container any more** -- nothing is
moved anywhere, and the root no longer has a Storage card. `Send to storage`
(select menu, single or several) puts the mark on and `Remove from Storage`
(the one row a stored folder's select menu has) takes it off; either refreshes
the workspace in place (`rebuildWorkspaceAfterStorageStateChange` ->
`refreshWorkspaceFromRootHandle`), since a stored folder is left out of every
scan (`collectFilesFromDirHandle` skips it) and coming out has to load it.

**Basics -> Stored items** (`showStoredItems`, on by default; the bindable
`toggleStoredItems`, unbound) decides whether stored folders are listed. On,
`getChildDirsForNodeBase` adds each stored folder sitting directly in the
folder being listed as a stub (`storedChildStubsForNode`, one node per path
kept in `STORAGE_STUB_NODES` and remade when its parent node is rebuilt),
sorted in with the rest. Off, they are not listed anywhere. Either way a
stored folder **cannot be opened** (`STORAGE_OPEN_REFUSED_MESSAGE`, from the
card's open action, `enterSelectedDirectory` and `navigateToDirectory`), and
it is left out of next / previous folder and the random jumps
(`getVisibleSiblingDirsForSlide` drops stubs) and of Jump to...
(`appMenuJumpTargetIsExcluded`). A stored folder inside a stored Model is
never listed, since its parent is never in the tree.

**A stored card** (the stub branch of `makeFolderPreviewCard`,
`.storedFolderCard`) shows the folder's name, its score and its thumbnail, and
nothing else: no counts, no size. Its type icon is the plain folder's
(`iconKeyForDirNode` no longer answers `storage`), with **a storage mark
beside it**, passed through `setThumbnailTitle`'s `markIcon` (the third
argument of `thumbnailTypeIconBubbleHtml`, the same slot a Tag's lock uses).
The picture: `mountStorageStubThumb` asks `storageStubThumb(path)`, which
finds the folder's pinned thumbnail (`dirThumbPresets` or
`pendingDirThumbPresets`; Blank shows the folder icon) or else the first
image walking it in name order -- for a Model, its first Set's first image, a
video when that Set has no image -- reading folder listings only and stopping
at the first folder with media. In the app it is the native thumbnail at the
grid's size (`FULL_QUALITY_THUMB_EDGE` with Full resolution on), at the
video's chosen frame. **Its thumbnail edits apply**: a stand-in record for
the file (`storageStubThumbRecord`: path, name, type) is enough for
`metaGetVideoThumbnailTimeForRecord` and `applyFileThumbCropStyle`, which are
keyed by the file's path. The slot can sit inside the card's picture square,
so the swap checks `card.contains(slot)`, not the slot's parent. Answers are
cached per path for the workspace (`STORAGE_STUB_THUMBS`, cleared by
`resetWorkspace`).

**Out of Storage a Model looks the same.** A Model on Default (no pin) shows
the first picture in its Sets, not its icon: `inferFolderThumbnailDefaultMode`
answers `single` for a folder directly in the root (the Trash excepted) even
though it holds no files of its own. It used to answer `none`, so a Model
taken out of Storage went from a picture to a blank card, which read as its
thumbnail having been lost. Blank is stored as an explicit sentinel.

### Turning thumbnail media off

`Thumbnails → Media thumbnails` (app menu, on by default, `mediaThumbnails`)
stops thumbnails painting media at all: no card asks for a URL, so nothing is
fetched, decoded or held, and every tile shows its item icon. It
refreshes the workspace on change — a re-render would leave
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

### Settings -> Experimental

A top-level `Experimental` submenu (after Lock, `buildAppMenuExperimentalSubmenu`)
holds only settings that live nowhere else: the four below, then Menu
placement and the Select Menu submenu (see "Two menus"). It used to repeat
Media thumbnails, Full resolution, Thumbnail size, Animated filters and
Utility containers as well; those were removed from it (Jo's call) and are
reached where they always were (Thumbnails, the filters, Basics). Do not put a
second copy of an existing setting here. (System notifications -- every
status message sent to macOS as a notification instead -- was here and was
removed outright on 2026-10-23, main-process command and all; it is in git
history before Checkpoint 0313.)

- **Sidebar settings menu** (`appMenuSidebar`, a cycler: Off, Left, Right
  -- `MENU_SIDEBAR_CYCLE`, `normalizeMenuSidebarValue`; `"off"` by default,
  general preferences; `appMenuSidebarSide`, in `menus/menu-core.js`). It was
  an on/off switch for the left edge, so a stored `true` reads as Left. Set to
  a side, the app menu (Tab) is a full-height sidebar sliding in from that
  edge, and the rest of the app is pushed aside to make room rather than
  covered: `#app` gets `.appMenuSidebarOpen` (a left padding the sidebar's
  width) or `.appMenuSidebarOpenRight` (a right one, with
  `appMenuSidebarRight` on the menu), so the grid re-flows into what is left. The sidebar is its content's width but never
  narrower than `--app-menu-sidebar-w` (304px, in `keyboard-only.css`), so the
  usual pages share one width and the wide ones (Controls, Journal, Stats)
  widen it; the padding follows the width it actually has
  (`--app-menu-sidebar-push`, set by a `ResizeObserver`,
  `watchAppMenuSidebarWidth`), and the gallery always keeps 420px. The long
  lists lose their height cap there and use the sidebar's full height. **Jump
  to... in the sidebar is one column** like the rest of the settings menu, its
  levels replacing each other (`appMenuJumpCascadeFits` answers no for
  `appMenuShowsAsSidebar()` -- asked of the setting, since the first level is
  drawn before the menu is in the sidebar); the column is full height. (It
  briefly spread its levels out as columns across the window; Jo wanted it to
  stay one column.) Only where the menu is
  drawn changes -- it is the same `#appActionMenu`, the same rows and the same
  keys -- and `positionActionMenuInPreviewDock` is the one place that decides
  (`syncAppMenuSidebar`). Closing
  slides it back out: `closeAppMenu` leaves the rows in place for the slide
  (`.appMenuSidebarClosing` keeps a closed menu drawn; `slideAppMenuSidebarOut`)
  and empties it after `APP_MENU_SIDEBAR_SLIDE_MS`, and `openAppMenu` cancels
  that (`cancelAppMenuSidebarClose`) so opening again mid-slide slides back in.
  Changing it from inside the menu moves the open menu at once.
- **Sidebar select menu** (`selectMenuSidebar`, the same Off / Left / Right
  cycler; a stored `true` from when it was a switch reads as Right;
  `selectMenuSidebarSide`). The same sidebar for the select menu, all of it the
  same code: `currentMenuSidebarSide` answers for the open menu's mode,
  `appMenuShowsAsSidebar` asks it, and `syncAppMenuSidebar` picks the side.
  With the two on different sides one element moves between them, so a change
  of side slides in afresh. The floating
  menu pins `style.right = "auto"`, which `syncAppMenuSidebar` clears, or a
  right-hand sidebar would sit against the left edge.

The other two change how much thumbnail work the app does:

- **Thumbnail edits** (`thumbnailEdits`, on by default; `thumbnailEditsEnabled`).
  Off, no stored crop, zoom or video frame is drawn.
- **Default thumbnails only** (`defaultThumbnailsOnly`, off by default;
  `defaultThumbnailsOnlyEnabled`). On, every folder, Tag and the root shows its
  Default (a Set's first file, a Model's first Set's, a Tag's rotation) whatever
  was picked, Blank and Shuffle included.

**Neither ever rewrites what is stored.** Each display reader is split in two:
the old name (`metaGetFileThumbnailCropForRecord`,
`metaGetVideoThumbnailTimeForRecord`, `metaGetFolderThumbnailMode`,
`metaGetFolderThumbnailPresetRelPath`, `metaGetTagThumbnailModeByKey`,
`metaGetTagThumbnailPresetRelPathByKey`) answers as if nothing were set while
its switch says so, and a `metaStored...` twin always answers what is really
stored. The setters, `rekeyTagThumbnailState` and anything that compares
against the previous value read the `metaStored...` twin; the doc writers and
the reclaim passes read the maps directly. And because an edit made while the
real value is hidden would start from the default and overwrite it, **each
switch also locks what it hides**: the crop and frame setters refuse while
Thumbnail edits is off (Cmd+arrows say so and are still consumed), every
folder/Tag/root pick setter refuses while Default thumbnails only is on
(`thumbnailPicksLocked`), and the select menu drops every Thumbnail submenu
(`stripThumbnailSubmenusWhileLocked`). `resolveStorageStubThumb` ignores a
Storage card's pick too. Both switches refresh the workspace on change, like
Media thumbnails.

### Thumbnails that fail to load

A thumbnail whose picture fails must never show the browser's broken-image
glyph. `onInlineThumbSettled` (inline `img.dirInlinePreview` and markup-set
`img.folderThumb`) and `onThumbLoadSettled` (passively loaded folder thumbs)
hand a failed `<img>` to `recoverBrokenInlineThumb`, which:

1. forgets the failed source (`forgetFailedThumbSrc`: out of
   `REVEALED_THUMB_SRCS`) so the next render does not snap it in;
2. tries once more with something that can work: the original image, or a
   `<video>` (`makePassivePreviewVideoElement`) for a video;
3. otherwise swaps in the **Blank** look (`replaceBrokenThumbWithBlank`: a
   `dirSquareFallback` / `folderThumbFallback` with the card's own type icon,
   `data-broken-thumb`).

File tiles (`.thumb`) still just stay a quiet empty slot. Two build-time
causes of permanently empty slots are also closed: a Tag card whose pool
produced nothing (natural-aspect cards skip it, a quad needs rotation) now
takes its first record or the Blank look, and a folder card with no lead
record shows its icon instead of a pending slot nothing would ever fill.

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
`bulkThumbnailTargetsFromSelection` (folders and tag entries mixed; the root
and storage stubs excluded). `bulkThumbnailActionAvailability` decides what
to offer: Default / Shuffle / Blank appear when **any** target would change,
Random only when **every** target has a candidate — a Random that silently
skipped half the selection would be worse than not offering it. It hangs off the
bulk folder, bulk tag and directories-header menus, which is what puts it in the
app menu's `N Selected Items` section.

### Handing a thumbnail up (container Thumbnail menus)

A file's Thumbnail submenu lists every place above it; a folder's or Tag's now
does too. **Every one of these menus has one order** (2026-10-23,
`thumbnailMenuTargetItems`): the folders first, named plainly (a file's Set,
then its Model -- "Beach", "Vacation"), then a **Tags** tab holding Favorites
first ("Favorites in Vacation") and then every Tag as "Name in Place" (the
place is where the Tag's card sits, `thumbnailMenuTagTargetLabel`), and last, at the
bottom, the container's own settings (Default / Random / Shuffle / Blank) under
a **This folder** / **This tag** tab. Each target carries a `group`
("folder", "favorite", "tag") that decides where it goes. In a container's
menu each place takes the picture the container is **showing right now**
(`currentThumbnailRecordForDirNode` / `...ForTagEntry`: the card on screen
first, since under Shuffle that is the only record of the pick). **The root has
no thumbnail options at all** -- it is never seen from outside, so it has no
Thumbnail submenu, is never listed as a place ("Set root thumbnail" is gone),
and `bulkThumbnailTargetsFromSelection` leaves it out. A container showing
nothing (Blank) lists only its own tab. One walk builds every list, file or container
(`thumbnailMenuTargetsFromFolder`): the folders up to the root, their Tags
(tagged by hand or through a contents rule), the Tags holding those Tags, and
Favorites. A Tag's own list starts with the Tags that hold it, then its
placement folder upward (`thumbnailMenuTargetsForTagEntry`).
`applyContainerThumbnailToTarget` runs the chosen row through the same setters
the file menu uses.

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

### Variations (`frontend/js/variations/`, `#variations`)

The prompt composer. **It is part of the gallery page** (since the
`variations-in-app` branch, 2026-10-21): `#variations` in `index.html`, drawn
over the whole window while open, styled by `styles/variations.css` and run by
`js/variations/`. It used to be a separate page (`frontend/variations.html`)
shown in a `WebContentsView` of its own, with its own paper-and-ink palette and
a Dusk switch; that page is deleted (git history before the branch) and the
look is the gallery's. Opening and closing are unchanged for the user: the
bindable `toggleVariationsWindow` (Cmd+U by default) opens it, and the same
key, Escape (with nothing left to back out of), Shift+Cmd+W, the top bar's
Close or the Window menu's Close item close it. The Grok and Claude keys
pressed inside it close it and open that window.

**It is the one ES module graph in the page.** Its ~4,300 lines were one
script with ~230 top-level names (`$`, `el`, `state`, `save`, `render*`...)
that would collide with the gallery's shared global scope, so it is modules
rather than classic scripts: each file `import`s what it uses from the others
(the block between `// -- imports (generated) --` and `// -- end imports --`
was generated from the declarations and is kept by hand now), every top-level
name is exported, and nothing leaks out except `window.LGVariations` (`open`,
`close`, `toggle`, `isOpen`, plus `state`/`host`/`assemble` for the console and
test scripts). `main.js` is the entry and the only file `index.html` names.
Modules run after every classic script, so Variations may read gallery
globals by name at call time -- it uses `showStatusMessage` (its messages are
the gallery's status bubble, forced, raised over it by
`html.lgVariationsOpen`), `keybindValueFromEvent` / `keybindActionFor` (the
live bindings), `toggleGrokWindowKeybindAction` /
`toggleClaudeWindowKeybindAction` and `lockScreenIsOpen` -- and the gallery
reaches it only through `window.LGVariations`.

The files: `store.js` (state, where it is saved, `normalize`, conditions,
banks, notes, groups, dependencies), `prompt.js` (what reaches the prompt,
the diff), `dom.js` (lookups inside `#variations`, `el`, icons, messages,
dialogs), `rail.js`, `depends.js`, `stack.js` (filter, blocks, groups,
mixer), `drag.js`, `output.js`, `actions.js` (every mutation, takes,
clipboard, import, export), `keys.js`, `help.js`, `main.js`. Ids are prefixed
`vx` (`#vxStackBody`) and `$`/`$$` search inside `#variations` only; class
names are unprefixed, and every rule in `variations.css` is scoped under
`#variations` (the gallery's own class rules that share a name, like `.name`
or `.active`, are all scoped under gallery containers, so none reaches in).

**The keyboard.** While open, Variations has the whole keyboard. The gallery
stands aside by asking `variationsIsOpen()` (`keyboard/options-and-toggles.js`)
in its global keydown listener and in `shouldReserveAppKeybindBeforeBrowser`
-- the second matters: the reserve listener `preventDefault`s every bound
chord, and with it Cmd+C/V/Z could be taken from Variations' text fields.
`handleKey` (keys.js) is a **window capture** listener, so it runs before the
gallery's document listener and before any field's own; it ignores every key
while Variations is closed, which is why the key that opens it is not also
seen as the key that closes it. Whenever it closes Variations it stops the
event, or the gallery would take the same Escape as its own back key. The
slideshow pauses while it is open (`slideshowIsPaused`).

**Where the document lives** is unchanged: `<library>/.local-gallery/
variations.json` through `read_file_bytes` / `write_file_bytes`, the file the
embedded page wrote, so libraries keep their projects. It is read the first
time Variations is opened, not at app start. If the bridge or the metadata
folder cannot be had it falls back to localStorage (`variations.state.v1` /
`variations.ui.v1`) and the top bar says so (`#vxHostNote`). A stored `dusk`
flag is dropped on load. Export writes `YYMMDD-HHMMSS - Variations.json` to
Downloads (`write_download_file`), the JSON carrying `exportedAt` /
`exportedAtLocal` beside the document; Import is a file pick that merges
(reads only `projects`).

**The look** is written entirely against the gallery's tokens (ink, page and
surface colours, `--accent`, the radii, the UI face), so Theme, Theme
color and Accent color, Prism included, reach it with nothing to keep in
step. One accent: it means "this is the pick" (the active variant, version,
arrangement, view, take) and the focused block's ring. Families are told
apart by place and weight, not hue: variants and arrangements fill with the
accent, versions are smaller and take a ring and a wash. The only monospace is
a word bank's name, which is written exactly as it must be typed.

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
  `moveBlockWithinGroup` inside one. A group's extent is marked by a bar in
  the accent down its left side (`.gribbon`, from `groupBookmarkNodes()`),
  hung in the gutter that the extra left padding on `#vxStackBody` leaves.
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

#### The keyboard

The commands are shaped by one line rather than a per-command modifier test,
because a per-command test is a thing you can forget to add to the next
command:

- Three chords are claimed, from anywhere, typing included — `Cmd+F` (filter),
  `Cmd+Shift+C` (copy prompt) and `Cmd+Shift+E` (export).
  `matchesAppChord()` is the whole list. Before them come the app-level keys:
  the Variations key (and Shift+Cmd+W) closes, the Grok and Claude keys hand
  over, read through the gallery's own binding table (`galleryActionFor`), and
  ignored for a bare key typed into a field.
- **Everything else is a bare key.** After the chords, `if (e.metaKey ||
  e.ctrlKey || e.altKey) return;` leaves every modified key alone,
  *unprevented*, so Cmd+C, Cmd+V, Cmd+Z and Cmd+A do what they do in a text
  field.

The bug that shape exists to prevent is worth naming, because it is the one a
new command reintroduces: the bare-key `switch` used to run whatever the
modifiers were, so `Cmd+1` picked a variant as well as whatever else Cmd+1
meant — two things at once, one of them invisible, and the prompt quietly
different.

`Escape` is matched unmodified only: it closes a dialog, clears the filter,
leaves a text field, and only then closes Variations. Copy also has a bare
`c`: the assembled prompt is what the composer is for. A drag in progress
answers Escape itself (`handleKey` stands aside while `dragState` /
`chipDrag` is set).

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

**Dragging** is a pointer gesture, not HTML5 drag-and-drop: the gallery page's
own drop handling is the thing everything else works around. It commits through `moveUnitTo` / `moveBlockWithinGroupTo`, the same
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
order) was folded into the app menu. Add items (a native import) went with the
desktop app; `Reverse file order` acts on the selected folder from the select
menu.

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
inside them for copy/paste. **Pointer-only controls are not drawn** (one CSS block beside the title bar
rules): the floating video control bar `#controlPane` -- which appeared on
pointer movement over a playing video and was all buttons, a draggable scrubber
and a draggable frame -- the legacy viewer's `#closeBtn`, the retired shortcuts
overlay's `#keybindHelpCloseBtn` and the legacy `.voteBtn` score arrows. Their
markup and script stay, so nothing that looks them up breaks. The confirm
dialog's Yes / No stay, because they label the keys that answer it. Removed cursor features: the mouse thumbnail **crop-editor window**
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
- **Tall/wide scroll images are left alone.** `tallScrollMode` / `wideScrollMode`
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

- **Journal** (`buildAppMenuJournalSubmenu`, below Calendar): every day with a
  journal entry (`metaGetDailyJournalDateKeys`, any non-blank markdown), newest
  first. Each row is the date (`scoreHistoryDateLabel`, "· Today" for today)
  over a comma list of the entry's markdown headings
  (`journalHeadingsForMarkdown`: `#`-`######` lines, de-duplicated) -- the
  "## <folder>" headings a score change adds, or whatever the user rewrote them
  to -- or "No headings". Pressing a row opens that day in the journal editor
  over the (hidden, still open) menu, exactly as the day page's "Open in
  journal" does. It is a
  second way in; the calendar is unchanged. The panel is an
  `appMenuLongListPanel` (height-capped, cursor clamps), 380-520px wide. Each
  row is **one line** (date in bold, headings after it, cut with an ellipsis)
  and is `flex: 0 0 auto` -- the panel is a height-capped flex column, and a
  shrinkable row was crushed to fit a long list instead of scrolling, which
  hid the headings and ran the rows together. Its min-width needs the
  `.appMenuDrillDown .dropdownMenuSubmenuPanel` weight to beat the drill-down
  reset.

`MENU_PANELS_CLAMPING_AT_ENDS` lists the panels whose cursor clamps instead of
wrapping — the long scrollable lists, Controls and Stats. Every other menu still
wraps.

The **daily journal editor** has no close button — Escape (its capture handler)
is the only way out. It is drawn like the other surfaces: the frosted scrim, one
borderless panel on `--menu-surface-radius` lifted a step off `--tint-base`, the
UI font, an uppercase "Journal" label over the date, and the textarea with the
general text-field rim cleared (the page is the field).

**Opening a day from History keeps the menu.** The Journal rows and the day
page's `Open in journal` call `openDailyJournalEditor(key, { fromAppMenu: true
})`, which leaves the app menu open and only hides it
(`#appActionMenu.appMenuUnderJournal`, visibility hidden). The journal's
document capture keydown listener is registered before the menu's, and
`stopImmediatePropagation`s every key, so the hidden menu hears nothing while
it is up. Escape (`closeDailyJournalEditor`) unhides the menu and rebuilds it
in place with the captured cursor, so you land on the same row with the list
already showing the headings just written -- hunting through entries is open,
Escape, move, open. Any other caller still closes the menus first.

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

**Moving between levels slides** (`animateAppMenuLevel`, in
`menus/menu-keyboard.js`), so a step reads as going into a place or coming
back out of it: the level you step into slides in from the right, the level
you back out to slides in from the left (18px, 190ms, with a fade), and the
heading naming the level moves with it; the level you leave goes at once.
In the floating menu a new Jump to... column opening beside the last grows
out of it from the left instead (`{ beside: true }`). It is called only from
the user's own steps -- `enterMenuSubmenuFromTrigger`,
`collapseOrCloseNumberedMenu`, Jump to...'s and Calendar's own key handlers,
and the Calendar day page -- never from the rebuild that restores the open
levels after a setting changes (`applyNumberedMenuKeyState` opens levels
directly), so the menu never moves on its own. Reduced motion turns it off.

**Every multi-choice option is a cycler that is also a list.** A row reads
`Label: CurrentValue`; pressing it advances to the next value, and stepping
into it (it is a hybrid submenu) lists every value with the current one
marked, so any value is one pick away. `buildCycleSubmenu` is the one
builder: `buildAppMenuCycleButton`, `createCyclingItemMenuButton` (and so
`createAppearancePresetCycleButton`, `createContainerSortCycleButton`,
`createTagMediaFilterAxisCycleButton`, the score-filter Overrides),
`createAddToTagDraftCycleButton` and Basics' Sort / Media filter / score
filters all go through it. Its trigger's state key is `cycle:<Label>`, so a
rebuild keeps the cursor and the open list although the row's text changed.
The list rows wear the cycler's own icon (`withMenuItemIcon` hands it down to
a `.menuCycleSubmenu`'s panel) and show their ●/○ on it. The old press-only
builders are kept, unreferenced, as `...PressOnly`. A new cycler goes through
`buildCycleSubmenu` too, or it is the one that cannot be opened.

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
resolves duration and frame rate (mounted `<video>` first, else a probe
`<video>` in the page, else `VIDEO_THUMB_FRAME_RATE_FALLBACK`), cached in
`VIDEO_THUMB_TIMING_CACHE`. Held keys accelerate via `videoThumbnailFrameRampCount`
(1 frame, ramping to 72 after ~320ms of hold), and requests are coalesced through
`drainVideoThumbnailFrameSeekQueue` so a fast hold does not queue hundreds of
seeks.

### Randomizing (the Random controls)

Nine bindable controls, named for the library's shape. They are the **last
rows of Controls** (the end of `KEYBIND_ACTIONS`, and
`buildAppMenuControlsSubmenu` sorts `RANDOM_CONTROL_IDS` below the appearance
preset actions too) and the last group, "Random", on the hold-`[` page. All
are dispatched from `handleExtrasKeybindAction`, which the global keydown
listener tries before anything else.

**Jumps.** Every jump but the model one ends on an open file.

- **Jump to random file in current folder / current model / root**
  (`randomFileInFolderJump`, `randomFileInModelJump`, `randomFileInRootJump`,
  unbound) -- `randomFileJump(scope)`. Any file, not a set's first:
  `pickRandomFileFromSets` draws a set weighted by its `recursiveFileCount`,
  then a file in it, so files are about equally likely without listing the
  library; a set whose files the filters hide is passed over, and the open file
  is left out when there is another. *Current folder* is the set an open file
  is in; with nothing open, the folder on screen (a set, a model's sets, the
  sets a Tag's or special view's grid shows, or the root) --
  `randomFileJumpSets`. *Current model* is the model around you (none at the
  root, and it says so). Landing keeps the view: from a Tag's grid the set is
  opened through the Tag (`openPreviewGridSetCard`) and then the file in place;
  inside a set it moves sideways with `jumpToDirectoryFile(set, id)` (the
  general form of `jumpToDirectoryFirstFile`); otherwise
  `jumpToLocationTarget({ kind: "file" })`.
- **Jump to random set in current model** (`randomFirstFileJump`, `r` -- the
  id predates the rename) -- `randomSetJump()`. Picks among the sets of the
  **container you are in** and opens the first file of the one it lands on. The container is the
  one Next folder walks, `getVisibleSiblingDirsForSlide`, which is what makes it
  respect Tags: in a set reached through a Tag (or a search, Favorites, Hidden)
  the pool is that view's sets, and the jump moves sideways the way Next folder
  does (`jumpToDirectoryFirstFile`), so the Tag and the way back out of it are
  kept. In a plain set the pool is its model's sets. From a container's own grid
  it is the sets that grid shows: a model's grid lands through
  `jumpToLocationTarget`, and a Tag's or special view's grid opens the picked
  card as the open key would (`openPreviewGridSetCard`), so the set is entered
  *through* the Tag. At the root there is no container of sets, and it says so.
- **Jump to random set in root** (`randomRootSetJump`, unbound) -- any model's
  sets (`allLibrarySets`), landed through `jumpToLocationTarget({ kind: "file" })`.
- **Jump to random model** (`randomModelJump`, unbound) -- lands *at* a random
  model folder, its grid showing, over the same root list Jump to... and the
  root folder steps use (`appMenuJumpChildTargets`).

A candidate set has a file passing the current filters
(`pickRandomSetWithFiles` tries a shuffled pool and stops at the first with
one), and the set jumps leave out the set you are in, the model jump the model
you are in, when there is another.

**Order switches.** **Randomize model order** (`toggleRandomModelOrder`,
unbound), **Randomize set order** (`toggleRandomFolderSort`, `Cmd+r`, the old
id) and **Randomize file order** (`toggleRandomFileOrder`, unbound), all
`toggleRandomOrder(kind)`. Model order shuffles the root's listing, set order
every model's, file order every set's files (outranking a kept order; Index
still writes the kept order, never the shuffle).

**Only the control turns one off.** Each is a stored general option
(`randomOrderModels` / `randomOrderSets` / `randomOrderFiles`, read by
`randomOrderOn(kind)`), written by `toggleRandomOrder` and nothing else, so it
survives refreshes, rebuilds, settings reloads and relaunches. Set order used
to be `WS.view.randomFolderMode`, which `applyDefaultViewFromOptions`
(on every settings load and workspace build), `resetWorkspace` and the refresh
snapshot all wrote -- that was "it turns itself off". Do not put the state back
in `WS.view`.

Each kind has its own seed (`RANDOM_ORDER_SEEDS`, drawn fresh when it is
turned on, kept outside `WS.view` so a refresh keeps the order; a relaunch
draws a new one). `stableRandomOrder` memoizes each list's order
(`RANDOM_ORDER_MEMO`), so a list seen again comes back the same and items that
join later go on the end. `randomOrderKindForDirs` reads which kind a list is
off the shape (parent is the root: models; parent's parent: sets), and
`sortDirsForDisplay`, `sortDirCollectionForDisplay` and
`fastSortDirsForTagScope` shuffle only when that kind is on.
`randomOrderSignature()` is in the listing cache keys.

### Video scrubbing (hold the skip keys)

`seekBack` / `seekForward` (Z / C) scrub for as long as they are held ("Video
scrubbing" block, beside `seekViewerVideo`). There is **no on-screen readout**:
the picture is the feedback.

- **Speed** (`videoScrubRate`, x real time) is `2 + 1.5t + t²` for a hold of
  t seconds (2x, ~4.5x at 1s, ~9x at 2s, ~35x at 5s), capped at
  `videoScrubMaxRate` (length / 12, at least 2x, at most 400x). A tap moves
  `VIDEO_SCRUB_TAP_SECONDS` (0.25s). An earlier, much slower curve was a
  reaction to the app freezing, which turned out to be the media protocol
  (see "Media & thumbnails"), not the speed.
- **Forward up to `VIDEO_SCRUB_PLAY_MAX_RATE` (4x) the video just plays**,
  muted, at that `playbackRate` -- no seeks at all. Faster, and always
  backward, it is paused and stepped through `requestResponsiveVideoSeek`, at
  most one seek per `VIDEO_SCRUB_SEEK_INTERVAL_MS` and never while one is in
  flight. The first version seeked every tick; a decoder thrashing through
  seeks can stall the whole display, not just the window.
- Release restores each video's `playbackRate` and `muted`, lands a stepped
  scrub with one exact seek, and resumes playback only if it was playing.
- The tick is a **timer, not rAF** (a seek request is not a paint, and rAF
  stalls in a window that is not being drawn).
- The actions arrive without their event, so the held key is read from a
  window capture keydown record (`VIDEO_SCRUB_LAST_KEYDOWN` +
  `VIDEO_SCRUB_KEYS_DOWN`); keyup of that key, or window blur, ends it.
- `handlePreviewVideoReady` fires on every `canplay`, i.e. after every seek. It
  must not autoplay while a scrub holds the video (`videoScrubIsHolding`) or
  when the user paused it (`previewVideoUserPausedFor`).
- The seek watchdog in `applyPendingResponsiveVideoSeek` re-asks a seek WebKit
  never answers (twice with `currentTime`, then `fastSeek`) before giving up.

### Changing files is a hard cut

Stepping between open files shows a held copy of the old frame
(`capturePreviewVideoTransitionFrame`) until the new one can be on screen, and
then removes it **in one step** -- there is no dissolve anywhere
(`hidePreviewVideoTransitionFrame` / `hideViewerTransitionFrame` used to fade
over 84ms). An image shown directly takes the held frame down as soon as
`img.decode()` resolves, so the new picture and the removal land in the same
painted frame; an image drawn through the filter canvas waits two animation
frames for the canvas; a video's reveal waits one frame
(`TRANSITION_FRAME_CUT_DELAY_MS`) because WKWebView can report a video frame
just before it is composited. Do not reintroduce a fade to hide a gap: find the
gap.

### App volume

One volume for everything the app plays, with no control on screen
("App volume" block): `volumeUp` / `volumeDown` (Option+Up / Option+Down by
default; "Sound" group on the hold-[ page) step the `appVolume` option by 5
between 0 and 100 and say "Volume N%". It is the element volume: capture
listeners on `loadstart` / `loadedmetadata` / `play` give every `<video>` the
level as it loads or plays, and a change is pushed to every video on the page,
the preload pool and the music player's Audio (`applyAppVolumeEverywhere`).
Mute is separate and still wins. **The percentage is linear in loudness, the
gain is not:** `appVolumeFactor` returns `p^(log2(10)/2)` (about `p^1.66`), so
every halving of the number is -10 dB, which is what sounds like half as loud
(50% -> 0.32, 25% -> 0.10, 5% -> -43 dB). A plain linear gain put nearly all
the audible change in the top few steps. `normalizeAppVolumeValue` runs inside
`normalizeOptions`, which executes before the block is reached at load, so it
must not read the block's `const`s.

### Slideshow

`Basics -> Slideshow` and `Basics -> Slideshow duration` ("Slideshow" block in
`media/gallery-viewer.js`). While it is on, an open **image** stays on screen
for the duration and an open **video** plays to its end; then the app takes
the same step the next key would
(`handleClosedFilePaneNavigationAction("selectRight")`, so it runs on across
Sets). Slideshow duration is `1 / 3 / 5 / 10 / 20 sec` or **Cycle**
(`SLIDESHOW_DURATION_CYCLE`); under Cycle the Slideshow row is a cycler
instead of a toggle (`SLIDESHOW_MODE_CYCLE`: Off, then each duration, then
Off), and so is the bindable `slideshow` control (`v` by default,
`toggleSlideshow`, dispatched from `handleExtrasKeybindAction`).

- **Only the duration is stored** (`slideshowDuration`, playback preferences,
  `5` by default). On/off is `WS.view.slideshowActive` /
  `slideshowSeconds`, so every launch starts off, and `resetWorkspace` stops
  it, which covers a refresh, Lock now and every other reset. Do not store it.
- **One 100ms timer, not a timeout per file** (`slideshowTick`). It compares
  the open file with the one it was timing (`SLIDESHOW_CLOCK`), so anything
  that moves to another file -- a key, a jump, the slideshow -- restarts the
  full duration without having to tell it. A video's `ended`
  (`slideshowNoteVideoEnded`) only marks it done, and the next tick steps, so
  a video's end waits for a closed menu like an image's time does. The clock
  does not run with no
  open file, a menu open, Variations open, the lock screen up, panic on or a
  caret in a text field (`slideshowIsPaused`); each of those restarts the file's duration.
- **Videos ignore the duration.** While it runs a video does not loop and
  carries the ended handler (the slideshow branch of both video render paths;
  `syncSlideshowVideos` for a video already on screen when it starts or
  stops, which puts the video end behaviour's loop back).

### Music player

A deliberately basic player ("Music player" block, `features/music-player.js`)
for mp3 files dropped into `<library>/__LOCAL_GALLERY_MUSIC__`
(`INTERNAL_MUSIC_DIR_NAME`). That folder is **skipped by every library scan**
(the same five places that skip `.local-gallery`, top level only), so it never
appears in the app and nothing can reveal it -- unlike the Trash. It is
created the first time the Music section is shown.

- **It is a section of the settings menu** (Music, after Display names,
  `buildAppMenuMusicSubmenu`): a now-playing line (`.appMenuMusicNow`, not a
  button -- the song, a progress line and the time, updated in place by
  `renderMusicProgress`), then Play / Pause, Next song, Previous song, Shuffle
  and Repeat song (✓ toggles, the general options `musicShuffle` /
  `musicRepeat`) and a Songs list to pick one. Every row carries a
  `music:` state key so the cursor survives the rebuild `renderMusicPlayer`
  does whenever the player changes while the section is on screen. (It used to
  be a panel of its own, `#musicPlayer`, opened with M -- `toggleMusicPlayer`;
  both went in Checkpoint 0330.)
- **It never plays by itself.** Play starts the first song, or a random one
  with Shuffle on. Next wraps at the end; with Shuffle it picks a different
  random song and Previous walks back through `MUSIC.history`. Previous past
  3s restarts the song. A song that ends replays with Repeat on, else Next.
  A file that won't play is skipped, never in a loop. Unless the Music section
  is on screen, each song change shows "Now playing <song>".
- **Audio is a detached `Audio` element** (`musicAudio()`), not in the DOM,
  so it plays alongside video sound and nothing that pauses or mutes
  `<video>` touches it, and it keeps playing when the menu closes. Panic
  pauses it and resumes it afterwards (`musicOnPanic` from `applyBanicState`);
  Lock now stops it (`musicStop`).
- **Keys:** `musicPlayPause`, `musicPrevious`, `musicNext`,
  `musicToggleShuffle`, `musicToggleRepeat` work from anywhere and ship
  unbound, in the playback group of Controls and a "Music" group on the
  hold-[ page, dispatched first thing in `handleExtrasKeybindAction`.

### Reordering files (grab, reverse, reset, index)

A folder's file order is either **name order** (`compareIndexedNames`) or a
**kept order** (`dirNode.preserveOrder`, with the list in
`WS.view.fileOrderByDirPath` via `saveSessionFileOrderForDir`). A kept order
lasts for the session only; **Index** is what writes it to disk, by renaming
the files so that name order is that order.

- **Grab** (`grabReorderItem`, unbound by default) lifts a file into
  `GRAB_REORDER_STATE`; the selection keys move it and the grab key or Esc
  sets it down (`handleBackAction` drops it before anything else, so Esc on an
  open file sets it down without closing the file). Any other action sets it
  down and then runs. It works in two places:
  - **In a file grid** (`moveGrabbedPreviewFile`): the nearest file in that
    direction, by the cursor's 2D scoring, committed through
    `reorderFilesInDir` -- the primitive the mouse drop uses. The moved card
    keeps the selection and `.previewCardGrabbed`.
  - **On an open file** (`startOpenFileGrabReorder` /
    `moveGrabbedOpenFile`). With quick navigation on, the default, a Set's
    files are only ever seen one at a time, so a grid-only grab could never be
    used. Left/up moves it one place earlier, right/down one later, in the list
    the viewer steps through (`getPreviewFileIdsForDir`); the picture does not
    change, so a message gives the position ("Moved to 3 of 6", "Already
    first"). Only when the file is seen from its own folder
    (`openFileGrabContext`), so earlier means what the previous key shows.
- **Reverse file order**, **Reset order** and **Index** are the selected
  folder's, under Folder options in that order. Reverse keeps the menu open
  (like any option) so Reset order and Index appear for the next step. Reset
  order is offered only when it would change something
  (`dirFileOrderDiffersFromIndexedNameOrder`), and so is Index
  (`dirTreeHasIndexableOrderMismatch`, over the folder and everything below).
- **Index** renames every file in the folder and its subfolders to
  `<folder name>_<NN>` in the current order, through temporary names so no
  rename can collide, rolling back on any failure. Afterwards the names carry
  the order, so the folder goes back to name order (`preserveOrder = false`,
  session order cleared) and Reset order disappears. It is async, so
  `runFolderActionFromMenu` rebuilds the open menu again once it finishes
  (`refreshOpenAppMenuInPlace`); the rebuild every option gets runs too early.
- **Merge folders** (Folder options, two or more Sets of one Model selected,
  `mergeableSetNodesForPaths` / `mergeSelectedSets`) moves every file into the
  Set whose name sorts first -- with date-named Sets, the earliest -- after a
  confirm. The order is settled from the names *before* anything moves (name
  order, a tie going to the earlier Set), since a clashing name is renamed
  `name (2)` on the way in; then the merged Set is indexed to its own name in
  that order, through the same plan Index uses. A Set left empty (but for
  `.DS_Store`) is removed from disk and from the tree; its metadata stays in the
  logs like any vanished folder's. ALT-bearing Sets are not offered it.

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
  A retraction is also **generation-guarded**: every call that passes
  `onMissing` takes a new `INLINE_EDIT_RETRACT_GENERATION`, and the check stands
  down if a newer one has been taken since. An edit swapped for another before
  its check ran is not the pending edit any more — Add tag → Create opens
  the card's inline input and at once replaces it with the new-tag placeholder,
  and without the guard the first check cleared the placeholder a moment after
  it appeared.
- **Long menu lists scroll.** A panel with `appMenuLongListPanel` (Add tag,
  which lists every Tag) is height-capped like Controls and is in
  `MENU_PANELS_CLAMPING_AT_ENDS`; `setMenuHighlight` already scrolls the row into
  view.
- **A Tag's thumbnail looks through the Tags it holds.**
  `getThumbnailSourceDirsForTagEntry` is its own folders plus, at any depth, the
  folders of the Tags it holds. The pool, the chosen-picture check and Random all
  read it, so a Tag holding only Tags is not left blank.
  `focusTagEntryRenameInput` is the one exception and takes
  `{ retractIfMissing: true }` only from its starter, because the tail of every
  `renderDirectoriesPane` calls it again to re-seat the caret; a blanket
  retraction there would cancel a rename mid-typing.

`handleBackAction` also clears a pending edit that has no caret in it
(`pendingInlineEditIsUnfocused`). A focused edit never reaches it, so this fires
only for the stranded case. It is a backstop, not the fix — but "there is no way
to make it go away" should not depend on having enumerated every way an edit can
be stranded.

### Spellcheck

**The document opts out and prose opts in.** `<html spellcheck="false">` on
the page, with `spellcheck="true"` on the daily journal editor and Variations'
block editor. The attribute inherits, so the default decides for every field
added later -- and almost every input here holds a *name* (a file, a folder, a
tag, a search), where a red underline is noise and autocorrect rewriting one
would be damage, since a rename is committed to disk. Both right-click
suppressors exempt real text inputs so the correction menu still works there.

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

**The card's bubbles.** Two cyclers under `Appearance -> Thumbnails` decide
what shares the name's pill (bottom-left):

- **Icon placement** (`typeIconPlacement`, `In name` by default, or `Corner`;
  `TYPE_ICON_PLACEMENT_CYCLE`). In name: the type icon is a glyph at the front
  of the name's pill and the top of the card is left to the picture. Corner:
  its own bubble in the top-left, on the same 10px inset as the name and score.
- **Score placement** (`scorePlacement`, `Corner` by default, or `In name`;
  `SCORE_PLACEMENT_CYCLE`). Corner: its own pill bottom-right. In name: the
  score badge sheds its pill and sits in the name's, between the icon and the
  name, in the same colour as the name; a badge with nothing to say ("⋯" with scores off) is
  hidden there.

Each writes an attribute on the root for the stylesheet
(`data-type-icon-place`, `data-score-place`) and re-arranges the cards already
on screen in place. How:

- Every card is built the one way -- the icon as a `.thumbnailTypeIconBubble`
  in its overlay (mounted by `mountPendingThumbnailTypeIcons` after
  `setThumbnailTitle` records `data-type-icon`, or written into a builder's
  markup) and the score as the inert `.dirMenuBtn` badge in its bottom row --
  and one `MutationObserver` runs `arrangeCardPills` on each card overlay that
  appears, moving the icon's glyphs (as `.thumbnailTitleTypeIcon`, so the
  favorite colouring still reaches them) and the badge into the
  `.thumbnailTitleWithIcon` pill, or back out. A badge remembers its home
  (`_lgScoreHome`) for the way back. It runs as a microtask, before paint.
  One observer rather than each builder learning to, because there are several
  builders; the arrangement is idempotent, so its own moves re-trigger it
  harmlessly. Code that updates a score in place finds the badge wherever it is.
- A card with **no** name pill (titles off for that card, a rename field in its
  place) keeps its bubble and badge as built; the stylesheet puts a lone icon
  bubble bottom-left in the In name placement (and hides it while a rename
  field is up). With Show file names off the name text is hidden, not the
  pill, so a file card shows an icon-only pill (with Corner, the whole pill
  goes), and a score in the pill is hidden like the corner one.
- The strip is `top: 0` -- it covers the whole card, its pills held down by
  `align-items: flex-end` -- which is what gives a lone bubble a positioning
  context the size of the card.

**`Appearance`** holds Theme, Theme color, Accent color, Top bar, bubble
styling, float tags and float utility containers. **Thumbnails** (which holds
Icon placement and Score placement) and **Display names** are top-level menu
entries of their own, right after it; Menu placement and Select Menu are in
Experimental.

**Top bar** (`showTopBar`, on by default; `topBarEnabled`,
`applyTopBarFromOptions`) hides `#titlePane` everywhere with
`#app.topBarHidden`, the same zero-height row open media uses. The search lives
in that bar, so off means no search at all: a search in progress is cleared
when it is hidden, the field is disabled (`syncButtons` keeps it so), and the
`/` and `.` keys that focus it do nothing. (Menu placement and Select Menu:
see "Two menus".)

**Theme color / Accent color** (`uiTint`, `uiHighlight`, cyclers under
Theme; called UI color tint and UI highlight color until 2026-10-23, and
still tint and highlight in the code). Each scheme is labelled with the plain
name of its colour (Red, Orange, Brown, Olive, Green, Cyan, Light blue,
Indigo, Purple, Magenta, Pink, Gray); the stored ids are the old names
(`crimson`, `ember`, `sepia`, `moss`, `aurora`, `fathoms`, `glacier`, `dusk`,
`ultraviolet`, `synthwave`, `rose`, `noir`) and did not change. **They are one list of colour schemes seen from two sides**
(`uiColorSchemes`): each scheme has a tint (page, surfaces, line, bubble glass,
three ink weights) and a highlight (the accent) drawn together, authored colour
by colour for dark and for light separately (Red is a gothic black-red in
dark and blood on cold snow in light). Both menus list the same schemes in the
same order: Default (labelled "Blue (default)" in the list and plain "Blue"
on the row outside it, through the choice's `cycleLabel`, which
`menuCycleChoiceState` and `labelForCycleValue` prefer -- the default tint is
a blue graphite and the default accent system blue), Pure (labelled **High
contrast**), the schemes, and Match last. `default` writes nothing, so the
stylesheet's graphite and system blue apply untouched; any other choice is
written as inline custom properties on the root by `applyUiColorsFromOptions`,
which `applyColorSchemeFromOptions` calls, so a theme change recomputes them.
`uiTintVars` / `uiHighlightVars` read a scheme's side; `resolveUiColorChoice`
turns **Match** ("Match accent color" on the tint, "Match theme color" on the
accent) into the other side's scheme. **Both on Match is Prism**, the hidden
scheme (`uiPrismVars`, `data-ui-prism` on the root): every colour is a hue
offset from `--lg-prism`, a registered `@property` the stylesheet turns once
every 48s, the accent at three times the speed, plus a moving sheen on the app
menu and the hold-`[` list -- the one gradient that outranks the sheet-wide
`background-image: none !important`. It pauses while media is open
(`html.lgMediaOpen`, from `syncPreviewMediaModeClass`) and for reduced motion.
Retired ids (the old separate tint and highlight names) map to the nearest
scheme in `uiTintRetiredIds` / `uiHighlightRetiredIds`; `inverse` is now `pure`.
The lists and those maps are functions, not consts, because
`normalizeOptions` asks for the ids before that point of the script has run.
**Every surface follows the tint and highlight, always** -- the boot splash,
the lock screen and the loading overlay included, which
are drawn before the library's settings are read. While
`LIBRARY_SETTINGS_LOADED` is false the look comes from, best first:
`LIBRARY_LOOK` in memory (the look of the library last open in this page,
kept through `resetWorkspace`, so a refresh or Lock now never falls back; or
the look the lock gate read straight from the library's own preferences
file, `readLibraryLookFromDisk` / `applyLibraryLookFromDisk`, called first
thing in `lockGateBeforeLibraryOpens`), then the remembered copy
(`rememberedLook`: in the Mac app `look.json` in the app's userData, written
synchronously by the `remember_look` command and handed to the page by
`electron/media.js` as `window.__LG_REMEMBERED_LOOK`, because localStorage
can lose its last write on quit; elsewhere `localStorage` `lgAppTheme` /
`lgUiColors`), then the defaults. Never read the look from
`WS.meta.options` before the settings are loaded. Each apply clears every
property any scheme can write (`uiColorPropNames`), so nothing the `<head>`
boot script painted can be left behind. The neutral ink tokens are mixed from
the theme's own text colour (`--hairline`, `--ui-control-bg`,
`--ui-control-hover-bg`, `--fill-base` in dark; light glass from
`--tint-base`), so they carry a scheme's hue, and a destructive confirm uses
the highlight like any other. **`npm run check:look`
(`scripts/check-look.js`) is a release gate**: `release:patch` runs it before
building and stops on a failure. It runs the Mac app hidden in a throwaway
profile and library (`LG_DEV_HIDDEN`, `LG_DEV_USER_DATA`) and checks the
lock screen, the loading screens and Variations against a set scheme, with
and without the remembered copies, and with the library back on Default.
Both themes' values are remembered in `localStorage` (`lgUiColors`, with a
`prism` flag) for the `<head>` boot script, like `lgAppTheme`. **The remembered theme and colors
stay in force until the library's own settings have been read**
(`LIBRARY_SETTINGS_LOADED`, set by `metaFinalizeLoadedState`, cleared by
`resetWorkspace`), not merely until `WS.root` exists: a library being built has
a root while its options are still the defaults, and a repaint in that window
painted the default colors over the remembered ones and wrote them back as
remembered. **Pure** (High contrast) is not a hue and is written directly: the tint
(`uiPureTintVars`: page, surfaces and glass at pure black in dark -- OLED --
and pure white in light, raised surfaces one small step off the page) and the
highlight (white in dark, black in light, text on it the opposite).

**Disable messages is unexposed** (`MUTE_MESSAGES_EXPOSED = false`): its Basics
row is not built, the `toggleMuteMessages` action does nothing, and
`muteMessagesEnabled()` answers false so messages always show. The stored
`muteMessages` option is left alone; flipping the flag restores all of it.

**Float tags / Float utility containers.** A folder listing is three layers,
always in this order: utility containers, Favorites with the Tags, folders --
`folderEntryFloatTier` says which an entry is. Float utility containers
(`showSpecialContainerSpacerRow`, its option and `toggleFloatSpecialContainers`
action named for its first label "Float special containers", off by default) puts a blank row under the
first layer, Float tags (`showTagFolderSpacerRow`) one under the second; with
the first off, that first layer simply joins the Tags' layer, so Float
tags still separates both from the folders. `makeFloatLayerSpacerGate` is the
one rule, used by the directories pane and both preview grid renderers. The
blank is **half a row**: the usual gap plus half a row's stride (card + gap),
from `--preview-card-size`, the width cards actually get, which
`applyPreviewGridTracks` writes on each grid -- so it follows the thumbnail
size and the pane width.

**The first favorite does not move the screen.** Adding the first favorite
(or removing the last) puts the Favorites card in front of every folder: a new
row and spacer with Float tags on, every card one slot over with it off. Both
favorite writers bracket their re-render with `capturePreviewGridLayout` /
`settlePreviewGridLayout`: the card you are on is scrolled back to exactly
where it was on screen, and whatever still had to move glides there in 180ms
(a card that wrapped rows slides in from beside its new slot). `#previewBody`
has `overflow-anchor: none` -- Chromium's scroll anchoring otherwise
"corrected" the placed scroll a frame later and threw the grid back to the
top. The
Select Menu submenu holds `Menu distance` / `Menu height`
(`appMenuDistance`, `appMenuHeight`, five steps each, step 3 the flush baseline
the menu used to sit at, steps 1–2 walking back into the overlap; height also
takes `center`); the defaults are flush / raised. `Bubble diffusion`
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
(`glassDiffusion`, 0–100% in 10s like Bubble tint, `GLASS_DIFFUSION_MAX_PX` = 26).
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

### Set score / Model score is at least (Basics, and container Overrides)

Two cyclers, each acting on its own kind of folder only (`effectiveMinScoreFor`,
kind `"set"` or `"model"`, read off the path's depth by `scoreFilterShapePaths`):

- **Set score is at least** (`minSetScoreFilter`). A Set passes on its own
  score, and its files pass with it (`recordPassesScoreFilter`, inside
  `passesFilter`) wherever they are seen -- a Tag, All Sets, a random jump.
- **Model score is at least** (`minModelScoreFilter`). A Model passes on its own
  score. A Model whose Sets all fail the Set filter is hidden as well, since it
  would be an empty folder (`dirPassesScoreFilter`).

Each cycles Off, then every whole number from one above the lowest score of its
kind to the highest (`scoreFilterCycleValues(kind)`; the Set cycle counts only
Sets holding media, so its top can never empty every Set), then Off. Both are
general preferences, null is Off. The old single `minScoreFilter` is read once
as the Set filter, since it counted only media folders. The root always shows;
the Trash and Storage are never filtered.

**Overrides.** `WS.meta.scoreFilterOverrides` (saved as `scoreFilterOverrides`
in `tags.log.json`) maps `dir:<Model path>` or `tag:<name>` to `{ set, model }`,
each a number or `"off"`; a missing value means "follow Basics" (shown as
None). A Model's Overrides hold the Set filter for its own Sets; a Tag's hold
both (single and bulk, `scoreFilterOverrideButtonsForFolders` /
`...ForTags`), and so does Add tag -> Create new. What applies to a
folder is, first found wins: a Tag asking for its own card or grid (the first of
`passesFilter`'s `allowTags`, or `dirPassesScoreFilter`'s `askingTag`), the Tags
it is being looked at through (innermost first,
`scoreFilterContextTagsForDirPath`), then -- for a Set -- its Model, then Basics.
Path renames re-key `dir:` entries, Tag rename re-keys and Tag delete drops.

Three things hold it together:

- **The common case costs nothing.** `scoreFilterOverrideKindsInUse` says which
  kinds any override sets; with none, the threshold is simply the Basics value
  and nothing looks at the view. Otherwise answers are memoized per path on
  `SCORE_FILTER_REVISION`, `NAV_ENTRY_RESTORE_REVISION` and a signature of the
  Tag views on screen (`scoreFilterMemo`).
- **Catalog summaries cannot see scores.** While any score filter may apply
  (`scoreFilterMayApply`), `dirItemCount` and `dirHasVisibleRecordForTagEntry`
  count exactly instead of reading the summary, and while a Tag has a Set
  override the counts are not cached (they depend on where you look from).
- **A Tag with its own Set override is judged by its own test** in
  `filterTagEntryDirsByVisibleRecords` (like a folder with Exclusive file
  claims), because the plain test reads the filter of wherever it is looked at
  from.

Folder listings apply it in `getChildDirsForNodeBase`, Tag grids in
`filterTagEntryDirsByVisibleRecords`. Any score change bumps the revision and,
while a filter may apply, drops the listing caches.

### Tags (the only simulated folder)

Tags, albums and galleries used to be three things; they are one now, **Tags**,
plus the special buckets (Favorites, Hidden, Untagged), which are
unchanged and stay per folder. The storage is deliberately small:

- `WS.meta.dirTags` still maps folder -> Tag names (the reserved `__favorite__` /
  `__hidden__` / `__storage__` markers live in the same list). **Names are
  library-wide**: one Tag per name, wherever its folders are.
- `WS.meta.tagParents` maps a Tag to the Tags that hold it (Tags can hold Tags).
- `WS.meta.exclusiveTags` is the Exclusive switch.
- All three live in `tags.log.json`, schema 3 (`tagParents`, `exclusiveTags`).
  `tag-albums.log.json` is only a `{ convertedToTags: true }` marker now; its
  writer keeps the old shape while any legacy map is non-empty, so nothing is
  ever written away before it has been converted.
- Every tag-keyed setting (thumbnail, sort, filter preset, media type, hidden)
  is keyed `tag:<name>` — `tagThumbnailKeyForTag` ignores its scope argument.

**Placement is derived, never stored.** `getTagModel()` (cached in
`TAG_MODEL_CACHE`, dropped by `clearTagEntryDerivedCaches`) puts a Tag's card in
the deepest folder that is still at or above everything it holds: the parent of
each member folder and the folder each member Tag sits in. A Tag with nothing
that exists (members all trashed or gone) has no place and is not drawn — its
metadata stays. Placement ignores Exclusive, hidden state and content filters;
those decide what is drawn, not where. `tagMemberDirNodes` memoizes each Tag's
sorted folders inside that cache, since a large Tag is asked for them several
times per render.

**Exclusive moves, it does not copy.** An Exclusive Tag's folders leave their
real parent (`getChildDirsForNode` filters `exclusiveFolders`) and its member
Tags leave the folder they would sit in (`tagsByPlacement` skips
`exclusiveChildTags`). Opening the Tag is where they are. **Not in the Trash:** a
trashed folder keeps its Tags (re-keyed under the trash path, so put-back
restores them) but the Tag no longer shows it, so `getTagModel` skips trash
paths when building `exclusiveFolders` / `fileClaimsByFolder`. Before that,
anything trashed out of an Exclusive Tag vanished from both the Tag and the
Trash, while the Trash's count still included it.

**Exclusive with a media type override moves files, not folders.** When the
Tag also has a media type override (`tag:<name>` in `tagMediaFilterByKey`), its
folders are *not* put in `exclusiveFolders`; they go in
`fileClaimsByFolder` instead, and only the files that pass the override are
taken. So a Tag holding a Model's sets and showing only videos takes the videos
out of those sets, and the sets stay in the Model with their images (a set left
with nothing disappears there, as any empty set does). The claim covers files
at any depth under a member folder. The test is in `passesFilter`
(`recordIsHeldByExclusiveFileTag`): a claimed file passes only when the folder
is being looked at through a claiming Tag (`tagViewNamesForDirPath` -- the open
Tag, a `tag-view` frame, or a previewed Tag node), or when the caller asks on a
Tag card's behalf (`passesFilter(rec, allowTags)`, which
`recordPassesTagEntryFilter` does for the card's Tag and the Tags it holds). Other
Tags holding the same folder do not see claimed files. Because the answer
depends on where you look from, anything cached per path must not hold it:
`dirItemCount` skips the catalog summary and its cache for affected paths
(`dirPathHasExclusiveFileClaims`), the folder thumbnail cache key carries
`exclusiveFileClaimContextKey`, and `filterTagEntryDirsByVisibleRecords` /
`dirHasVisibleRecordForTagEntry` use the exact per-file scan there.

**Hidden flows down.** `tagIsEffectivelyHidden` is true for a hidden Tag or any
Tag held — at any depth — by a hidden one, and `metaHasHidden` asks it for each
of a folder's Tags.

**Rules worth keeping:**

- `metaAddTagParent` refuses a Tag inside itself or inside anything it holds
  (`tagHoldsTransitively`). Placement and hidden state both walk these links and
  a loop has no answer.
- `renameTagEverywhere` refuses a name that exists rather than merging, since a
  merge would hand one Tag's settings to another; `deleteTagEverywhere` removes
  the name, its links, its Exclusive flag and its settings, and touches no
  folder or held Tag.
- **Any unique name is a valid Tag name**, including the utility folders'
  ("All tags", "Storage", "Favorites"...): Tags and utility folders are
  different things. The Tag-shaped utility containers are keyed by internal
  `__name__` keys (`ALL_TAGS_NAME` = `"__all_tags__"`, ...), and
  `INTERNAL_TAG_NAMES` -- those keys and nothing else -- is the only set
  refused, from any entry point — `metaSetTagsForPath` and
  `metaAddUserTagsBulk` filter them, and the rename and name inputs refuse them.
- Add tag is offered for folders and Tags; its submenu lists every
  Tag except ones that would loop and ones with nothing left in them (no placement — their
  folders deleted, trashed or removed); Remove tag lists a Tag's parents. An
  empty Tag's metadata is kept, and it is offered again once it holds something.
  **For Sets of one Model, the Tags whose content is all Sets of that Model
  come first** (`addToTagChoiceNames`, `tagSingleContentModelPath`), Model
  only or not; the rest follow by name.
- **Model only** (Tag options, `WS.meta.modelOnlyTags`, saved as
  `modelOnlyTags` in `tags.log.json`): the Tag takes Sets from one Model and
  is offered only to them. The switch is shown while the Tag's content --
  through the Tags it holds too (`tagContentModelInfo`) -- is Sets of a
  single Model, and always while it is on; never for a Tag holding a Model.
  The Model is **read off the content, not stored**, so renaming the Model
  needs nothing re-keyed; with no content in one Model the lock lets
  anything through. Every way of adding refuses what it cannot take and says
  so ("'X' only takes Sets from Vacation."): the tag field and the toggles
  (`metaApplyBulkUserTagDiff`, `metaAddUserTagsBulk`, `metaWriteUserTags`,
  through `filterModelOnlyTagsForPath`), a Tag put in it (`metaAddTagParent`,
  `modelOnlyTagRefusesTag`) and a contents rule
  (`metaApplyContentTagsDiff`, `modelOnlyTagRefusesContentsSource`). Rename
  and delete carry the switch. All tags still lists it (Jo's call).
  **It passes down**: `metaSetTagModelOnly` sets or clears it on the Tag and
  every Tag it holds, at any depth, and a Tag put in a Model only Tag
  (`metaAddTagParent`) becomes Model only with what it holds. Taking a Tag out
  again leaves its switch as it is.
- **Root only** (Tag options, `WS.meta.rootOnlyTags`, `rootOnlyTags` in
  `tags.log.json`) is the same lock for a Tag that holds Models: it takes
  Models and nothing else, is offered only to Models, and refuses Sets. It is
  shown while the Tag's content is only Models (`tagContentIsOnlyModels`),
  and always while it is on. Unlike Model only it needs nothing read off the
  content, so it holds even for an empty Tag. Its card mark is a house.
  **The two are one mechanism with two kinds** (`TAG_LOCK_KINDS`,
  `tagHasLock` / `tagCanHaveLock` / `metaSetTagLock(kind, ...)`); every
  refusal goes through `tagLockRefusesPaths` / `tagLockRefusesTag` /
  `tagLockRefusesContentsSource`, which check both, and `tagLockIconKey`
  picks the card mark. A new lock is a new kind there, not a third copy. Several
  Tags selected get the same switch, acting on those that can take it -- any
  Tag whose card sits in a Model can, since placement puts it there only when
  its content is that Model's Sets. A Model only Tag's card shows a map-pin
  mark beside its type icon, the way Hidden adds its eye
  (`thumbnailTypeIconBubbleHtml`'s third argument, from `tagLockIconKey`).
- A Tag's filter preset and media type apply to all its folders wherever they
  are (`getPortalRootPathsForTagContext`, `contextualAppearancePresetIdForDirPath`
  no longer require the folder to sit directly under the card's folder).
- A Tag's **container sort** reaches only folders inside it.
  `activeTagContainerSortMode` inherits from a `tag-view` frame in
  `tagNavStack` only when `findMatchingVirtualPortalRootPath` places the current
  folder inside that view. It used to skip that test whenever the current path
  was `""` -- the root -- so a Tag view left in the back-history imposed its sort
  on the root, and "Sort: Score" came out alphabetical there.

The album and gallery code paths are still in the file but unreachable: nothing
produces an album or gallery entry after conversion.

#### All tags (a utility container)

The All tags utility container adds an
**All tags** card to the root. It is not a special bucket but a Tag-shaped view
under the internal name `ALL_TAGS_NAME` (`"__all_tags__"`, in
`INTERNAL_TAG_NAMES`): `tagChildNames` answers
it with every Tag that has a place (`allTagsFolderChildNames`) and it has no
folders of its own. So opening it, its grid preview, its counts and its random
thumbnail all run through the ordinary Tag paths, and every Tag inside is the
real Tag by reference -- opening one opens that Tag where it lives. It is never
in the tag model, holds nothing on disk, and has no select menu
(`selectedItemMenuSectionItems` returns null for it). The root entry is built in
`getTagFolderEntriesForDir`, whose cache key includes the toggle
(`tagFolderEntryOptionContextKey`); turning it off while inside leaves the view.

The All Models / All Sets utility containers are two more root cards built the same way, under the
reserved names `ALL_MODELS_NAME` / `ALL_SETS_NAME`, but holding **folders**:
`tagMemberPaths` answers them from `libraryShapeViewMemberPaths` -- every Model,
or every Set, read off the tree (Trash and Storage left out), memoized on the tag
model. Tags, Exclusive and contents rules play no part, so a folder an Exclusive
Tag took out of its Model is still listed, and `recordIsHeldByExclusiveFileTag`
lets their views see files an Exclusive Tag claimed. Like All tags they have no
select menu (`VIEW_ONLY_TAG_NAMES`).

**Certified fresh** (`CERTIFIED_FRESH_NAME`, a third library-shape view) holds
every Model with at least one Set whose own score is above 0
(`certifiedFreshModelPaths`); a Model's own score does not count. A hidden Set
does not qualify its Model while hidden items are hidden, and a hidden Model is
dropped by the usual visibility test. Scores do not rebuild the tag model, so
its memo is keyed on `SCORE_FILTER_REVISION`, and `bumpScoreFilterRevision`
drops the Tag-derived caches when a score change moves a Model in or out
(`refreshCertifiedFreshAfterScoreChange`).

**A Model's media views** -- "<Model>'s Images", "<Model>'s Videos",
"<Model>'s Text" -- are the one utility container inside each Model rather
than the root. Each holds that Model's Sets seen through one media type, like
a Tag with a media type override: `libraryShapeViewMemberPaths` lists the Sets
and `metaGetTagMediaFilterByKey` answers the fixed type for the view's key, so
a Set without that type drops out and a Set opened through the view shows only
that type. `modelMediaViewNamesForModel` offers one per type the Sets hold
(from the derived `recursive*Count`s), and none when they hold only one type.
The name is `__model_media__:<type>:<hex of the Model's path>`
(`modelMediaViewName` / `parseModelMediaViewName`), so it can never clash with
a Tag -- `isInternalTagName`, `isViewOnlyTagName` and `isLibraryShapeViewName`
cover the prefix where the plain Sets cannot -- and the label is read off the
Model's current name by `tagDisplayName` ("James' Images" for a name ending in
s), so a rename carries it. Nothing about them is stored, and they have no
select menu.

**Tag storage** (`TAG_STORAGE_NAME`, labelled `TAG_STORAGE_LABEL`) is the one
utility container that is a real Tag: a Tag goes in it through Add tag like
into any other (a `tagParents` link), so Tags that would crowd the root (Jo's
source Tags: OnlyFans, Patreon, ...) live there instead. Its stored name is
the internal `"__tag_storage__"`. It was stored as `"sources"` and then
`"tag storage"` before that: the tags document records the name it was written
with in `tagStorage` (absent means `"sources"`), and a document written under
an older one has its links moved across once at load (`metaApplyTagsDocLog`),
leaving the old name an ordinary Tag name. Two differences: **it holds only Tags** -- Add tag offers it only when
every selected item is a Tag (`addToTagChoiceNames`), and `getTagModel` ignores
any folder membership or contents rule naming it -- and **it is always
Exclusive** (forced in `getTagModel`, whatever `exclusiveTags` says), which
moves only the Tags in it, never the Models they hold. Its card is built with
the utility containers in `getTagFolderEntriesForDir` (shown when it holds
something) and it is skipped in `tagsByPlacement`; it is in
`VIEW_ONLY_TAG_NAMES` (no select menu) and `INTERNAL_TAG_NAMES` (All tags
leaves it out). Hiding the utility containers hides
the Tags in it too; they never fall back into the root. `tagDisplayName` shows
it by its label in the menus.

#### Contents rules (Add tag to all contents)

`Add tag to all contents` saves a **rule**, not a copy: "the contents of
this folder (or Tag) are in these Tags". `WS.meta.contentTags` maps
`dir:<path>` / `tag:<name>` to a Set of Tag names and is saved as `contentTags`
in `tags.log.json`. `getTagModel` folds the rules into membership -- a folder
rule adds every folder directly inside the source *as the tree is now*, a Tag
rule adds every folder of the source Tag -- so a folder added later is in the
Tag on the next refresh with nothing to re-run. The rule is never written into
`dirTags`, which is why clearing its names (open the field again and delete
them) takes the membership away. The field is seeded with the rule's names, not
the child folders' own tags, and commits through `metaApplyContentTagsDiff`.
Rename and move re-key `dir:` rules (`updateMetaPathsForRename`); Tag rename and
delete rewrite both keys and values. A folder that is in a Tag only through a
rule does not count as Untagged (`contentTagsForDirPath`).

#### The conversion

`convertLegacyTagMetadata` runs **once**, on the raw documents, before any is
applied (`convertLoadedTagDocs` in `metaInitForCurrentWorkspaceFs`, the
synchronous twin in the local-storage path, and on metadata-archive import). It
is pure and refuses data it already converted (`legacyTagMetadataNeedsConversion`
is false once the tags doc is schema 3 and the albums doc is marked).

- A tag or album that lived in a folder becomes `folder - name`; a root-level
  tag and every gallery keep their names. The same name in two folders is two
  Tags, which is the point.
- Old albums become Exclusive Tags (they already hid their folders and tags);
  galleries do not. Album-holds-tag, tag-on-album, gallery members and
  gallery-in-album all become `tagParents` links, with any loop dropped and
  reported.
- A clash is settled shallowest folder first, then gallery < tag < album; the
  loser gets ` 2`, ` 3`. A name equal to one of `INTERNAL_TAG_NAMES` gets ` (tag)`.
- A folder inside the Trash is named for where it came from (`trash.log.json`
  `originalPath`), so putting it back finds its Tag. The folder itself is mapped
  out of the Trash *before* its parent is taken — the other order named a
  top-level trashed folder's tags as if it had lived at the root.
- Settings move from the scoped keys to `tag:<name>`. A setting for a tag no
  folder carries any more goes to the name that tag would have had, unless a
  different Tag owns that name.
- Before replacing anything, the originals are written once to
  `tags.before-tag-conversion.log.json` and
  `tag-albums.before-tag-conversion.log.json` beside them (never overwritten);
  if the backup cannot be written the conversion does not run.

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

### Metadata is never forgotten (deleted folders and files)

**Nothing in the logs is dropped because the thing it describes is missing.**
A folder deleted from inside the app, emptied out of the Trash, removed in
Finder or eaten by a script keeps its score, tags, thumbnail pin, appearance
preset, media filter, Tags, container sort, ALT choice and
per-file thumbnail crops and video frames. Put the folder back at the same path
and all of it is simply there again, with no restore step to run. This is a
guarantee, not a best effort: any future code that deletes a metadata entry
because its path no longer resolves is a regression.

Three things used to break it, and each has a counterpart now:

- **The writers filtered by the live tree.** `metaMakeScoresDocObject` and
  `metaMakeTagsDocObject` built their `folders` map by walking `WS.dirByPath`,
  so the first save after a folder went away wrote a file that no longer
  mentioned it. They now emit the union of the live tree, the pending maps and
  whatever else `dirScores` / `dirTags` still hold. (Three dead writers -
  `metaMakeScoresLogObject`, `metaMakeTagsLogObject`, `metaMakeLogObject` -
  had the old shape and no callers; they were deleted rather than left as a
  second, wrong copy of the rule.)
- **Fingerprints were computed for live folders only.** `dirFingerprints` is
  cleared and rebuilt from the tree, so an orphaned path would have been
  written out with `fp: 0` - losing the one thing that can match a folder by
  *content* when it comes back under a different name.
  `WS.meta.dirFingerprintMemory` keeps the last fingerprint ever seen for a
  path (recorded by `metaComputeFingerprints` and re-seeded from the log at
  load), and `metaFingerprintForPath` is what the writers read. Note the
  fingerprint fallback only restores **tags** for folders below the top level
  (`canRestoreTagsByFingerprintForPath` requires a `/` in the path); scores
  have no such restriction.
- **Two stores were actively pruned.** The aspect-ratio log dropped entries for
  files that were not present, and the Trash origin record was deleted when the
  Trash was emptied. Neither prunes now. The aspect-ratio entry carries the
  size and modification time it was measured from, so a *different* file
  arriving at the same path is re-measured rather than trusted.

Two passes put remembered metadata back, both run at the end of
`metaInitForCurrentWorkspace` / `...Fs` - i.e. after every workspace build, so
a refresh is enough and a relaunch is never needed:

- `metaPromotePendingFolderMetadata()` moves an entry out of a pending map onto
  the live folder the moment that path exists again. It is needed even though
  the getters fall back to the pending maps, because `metaGetFolderThumbnailMode`
  / `...PresetRelPath` do **not** fall back, and because the doc writers prefer
  the live map. A remembered value only ever fills a blank - a folder that has
  since picked up its own score or tags keeps them. It is also called from
  `ensureDirectoryChildNodesFromCatalog`, so folders materialised late out of a
  deferred catalog take back their thumbnail pins too (they never did before).
- `metaReclaimRestoredTrashOrigins()` covers the one case a path key cannot:
  moving a folder to the Trash **re-keys its metadata under the trash path**
  (`updateMetaPathsForRename`), so after the Trash is emptied the metadata sits
  under `.trash/Foo` and a folder restored to `Sets/Foo` would not find it. The
  origin record in `trash.log.json` is what remembers the pair, which is why
  emptying the Trash no longer deletes it.
- `metaReclaimStrandedTrashMetadata()` covers the case with no record:
  thumbnail picks (folder pins, keys and values), crops and video frames
  still filed under `__LOCAL_GALLERY_TRASH__/<name>` when that Trash item is
  gone, has no record, and `<name>` is a folder in the root again. Each entry
  moves only where the folder has nothing of its own. It exists because ~120
  Models came back from the Trash with every other kind of metadata at their
  own path and their thumbnail picks left under the Trash: Put Back deleted
  the record, and nothing ever saved the thumbnails document after
  re-keying it. **`updateMetaPathsForRename` now marks every document it
  re-keys dirty itself**; callers listing their own documents was how
  `custom-thumbnails.log.json` got left out.
- `metaFollowMovedThumbnailFiles()` covers renames and moves made outside the
  app (Finder, clean.sh's renaming, a Set dragged out of the Trash into
  another Model). Every file a pick, crop or video frame names is remembered
  by size and modification time (`fileIdentityByRelPath` in the thumbnails
  document, `WS.meta.thumbFileIdentity`; the doc writer reads it off the
  loaded file, else keeps the remembered one). At load a missing file is
  looked up by that identity -- only a *unique* match counts -- and crops,
  frames and picks follow it; a pick whose folder is gone moves to the folder
  holding the file at the same depth (its Set for a Set's pick, that Set's
  Model for a Model's), never over a pick of its own. Files under a stored
  folder are never "missing". **Folder fingerprints cannot do this job**: a
  file's id contains its path, so a renamed folder's fingerprint changes too,
  which also means the fingerprint fallback for scores and tags does not in
  practice survive a rename.

Two rules hold that reclaim together:

- **It never clobbers.** `metaHasStoredFolderMetadata(path)` must say the
  destination holds nothing but placeholders first. Placeholders are real: the
  loaders seed *every* live folder with score 0 and an empty tag list, which is
  why the test is "blank or absent", not "absent".
- **The placeholders are removed before the move.**
  `metaForgetBlankFolderMetadata` clears them, because `remapPathMapKeys`
  rebuilds each Map and a blank row already sitting at the destination would
  otherwise be written *after* the remembered one and silently win. Both
  functions read one shared list, `metaFolderMetadataStores()`, so the "what
  counts as folder metadata" question is answered in exactly one place.

`updateMetaPathsForRename` also carries `aspectRatios` and
`dirFingerprintMemory` now; without the first, renaming a folder orphaned every
aspect ratio under it, which only went unnoticed while the log was being pruned.

### The app lock (Touch ID or the Mac's password)

An optional lock, asked at launch **before the library is built**. It has **no
passcode of its own**: Touch ID (or an Apple Watch) where the Mac has it, and
the Mac's own login password, both checked by macOS. (It used to be a
four-digit passcode of the app's own; that was replaced at Jo's request,
2026-10-19.) **The lock screen is the whole UI** -- macOS's own dialog is never
shown (2026-10-21, Jo's call; see "Why no macOS dialog").

The ordering is the feature: `lockGateBeforeLibraryOpens()` is awaited at each
of the "we now have a root handle" sites. Until it returns, nothing has been
scanned, no thumbnail has been asked for and no media URL exists — the overlay
is not a curtain drawn over a loaded app, there is genuinely nothing behind it.

**The screen.** `#lockScreen` is in the markup, so it covers the window from
the first painted frame, above `#bootSplash` (which the gate takes down):
the fingerprint glyph, the title, a line saying what to do, a password field
(`#lockPassword`, a pill like the search field), a message line and a hint.
`lockConfirmWithSystem({ title, reason, retry })` is the one way to ask. It
starts Touch ID (`.lockTouchWaiting`: Apple's Touch ID view takes the glyph's
place, see below) and focuses the field at the same time; whichever answers
first wins. Return submits the
password; a wrong one is cleared, says "Wrong password. Try again." and
shakes. If Touch ID gives up (misses, lockout) the glyph dims, the line says to
use the password, and Return with an empty field tries Touch ID again. The
launch gate passes `retry`: there is no way out but in (Escape only clears the
field), and the gate opens only on `ok` (or `unavailable`) -- any other end
of an ask asks again; a second gate ask while one is up shares it
(`ask.promise`). Turning the lock on or off and hiding the folder ask without it, so
Escape cancels there. While the screen is up it owns the keyboard (a `window`
capture listener that `stopImmediatePropagation`s every key), letting typing
through to the field and nowhere else. `unavailable` (the Mac has no password)
lets the gate through -- a Mac with no password has no lock either, and
refusing would lock the owner out -- and refuses *Turn lock on*. If the checks
cannot run at all (the helper is missing), the gate stays shut with "Press
Return to try again" (`LOCK_RETRY`).

**How macOS is asked.** Two native pieces, both built by
`scripts/build-auth-helper.js` into `dist-native/` (which `prestart` /
`prebuild` run; electron-builder copies both into `Contents/Resources`), used
by `electron/system-auth.js`:

- **Touch ID: `lg-touchid.node`** (source `electron/native/lg-touchid.m`), an
  add-on in the app's own process. It puts Apple's `LAAuthenticationView` into
  the gallery's window, above the page, on the 56px square the page asks for
  (`lockTouchRect`: centred on `#lockGlyph`, which hides while it waits), and
  runs the check through it -- a context paired with that view draws its UI
  in the view instead of macOS's dialog. **macOS only takes a finger for a
  view that is really on screen** (measured with Jo: an invisible or 2%-opaque
  view waited forever; a visible one answered in about a second), which is
  why it is shown, and why it is in the app in front rather than in a helper.
  The view is held in a holder of exactly that square (left alone it draws at
  ~126pt). The page tells it again where to be when the card or window
  resizes (`system_auth_touchid_move`, a `ResizeObserver`). The answer
  arrives on another thread, so the add-on keeps it and the main process
  polls (`poll()`, every 100ms) rather than being called back; a generation
  counter drops a late answer from an earlier check. `system_auth_cancel`
  (the password won, or the screen closed), a page reload and app quit all
  `stop()` it. It is plain clang: the few Node-API calls it makes are
  declared in the source and found in Electron at load (`-undefined
  dynamic_lookup`), so there are no headers to download and the binary does
  not depend on the Electron version. Apple's view cannot be recoloured: it
  is Apple's red fingerprint, in the place of the page's own.
- **The password: `LocalGalleryAuth.app`** (source
  `electron/native/lg-auth.swift`), a helper with no window. `lg-auth check`
  answers `{available, biometrics}` (`system_auth_status`); `lg-auth password`
  takes the password on **stdin** (never an argument, so it is not in a
  process listing), checks it with macOS's directory service (OpenDirectory,
  `ODRecord.verifyPassword`) against the logged-in account, and answers
  `ok` / `wrong` / `failed` (`system_auth_password`). Nothing keeps it.

**Why no macOS dialog.** Its place is macOS's choice and cannot be changed: it
is drawn by `coreautha`, centred across the main screen's *visible* area
(beside the Dock, so a left Dock pushes it right of centre) and high up like
any alert -- measured on a 1728x1117 screen, 260x257 at 776,240. A window of
the helper's own does not move it, nor the asking app's window, and
`LARight.authorize(in: window)` -- the one API that takes a window -- ignores
it on the Mac (all measured); moving another process's window would need
Accessibility permission, which an ad-hoc-signed helper would lose on every
build. A first fix moved the lock card under the dialog instead, and a second
drew the helper's own centred box; Jo rejected both for the lock screen
being the UI. A third ran Touch ID through an invisible view in the helper,
which macOS never let a finger through (above).

**Storage.** `<library>/.local-gallery/lock.log.json` says only whether the
lock is on: `{ schema: 2, enabled, method: "system" }`. A record written by
the old passcode (salt and hash) is read as **on**, so a locked library stayed
locked through the change; the hash is never read. It is deliberately not in
`META_DOC_FILE_NAMES`, so no metadata code path loads or rewrites it. It is a
door, not encryption — the media on disk is untouched.

`Lock` sits in the app menu between Controls and Experimental: *Turn lock on*,
or — once on — *Lock now* and *Turn lock off*, then *Hide gallery folder*.
Turning it on asks macOS first (so it is only ever put behind a check this Mac
can answer); turning it off and hiding the folder ask too. *Lock now* tears
the workspace down before re-showing the gate, so the screen behind the lock
is as empty as it is at launch, and passes the in-memory record (`{ record }`)
because the folder handle has just been discarded.

**Testing.** `LG_DEV_SYSTEM_AUTH` (dev only) answers without the helper:
`allow` (Touch ID and any password succeed), `cancel` (Touch ID is cancelled,
every password is wrong), `unavailable`, or `cancel-then-allow` (the first
Touch ID try fails, later ones succeed: what `check:look` uses, which also
walks Return-to-try-Touch-ID-again). `dev_send_key` sends key presses but no
characters, so a test fills `#lockPassword` itself. The Touch ID view is a
native view, so `dev_capture` (the page only) does not show it;
`screencapture -l <window id>` of a shown dev window does. `dev_capture` (dev only) saves what the page
shows as a PNG, hidden window included.

### Staying open (memory)

Left running long enough the page used to grow without bound. Two fixes still
matter: `forgetThumbEl` / `sweepDetachedThumbEls` stop the thumbnail
`IntersectionObserver` holding every tile it was ever given, and
`REVEALED_THUMB_SRCS` is capped at 20k entries.

There is no log or journal export and no import.

### Companion scripts

- **`safekeeping/clean.sh`** — standalone Bash utility run separately against a media folder. 14 optional processing steps, and the menu's `0` runs the **core cleanup**, steps 1–7, in the order Jo actually runs a new folder: archive unpacking (step 2: expands every archive in the tree next to itself via `unar` with zip/tar fallbacks, deletes it once the contents land, and rescans until no new archives appear), then the quarantine. Step 2 bundles three quarantine passes (dedupe via `fdupes`, similar-media culling via `czkawka`, empty-item quarantine); name sanitization (step 3) used to be a fourth pass inside it and was pulled out so renaming happens *after* the quarantining rather than in the middle of it. Then video conversion (step 4, `ffmpeg`), metadata removal (step 5, `mat2`), recursive delete (step 6: 16 criteria plus `0` / Enter for None, which skips the step so a core run can leave it out without retyping the queue; criterion 16, broken media (`step12_collect_broken_media`), decodes every picture, video and audio file once and matches the ones nothing can be shown or heard from at any size -- one decoded frame from ffmpeg keeps a file, a picture also gets a second opinion from `sips` so a format ffmpeg lacks is never called broken, a video file holding only sound is kept, and a file cut off after its first frame still plays to the cut and is kept; the checks run one per core through `turbo_pool` (one at a time on the gentle pace) since they write nothing, and its tools are checked when it is chosen, as step 7's methods are; previews the matches and requires the word `DELETE` typed back before anything goes, then removes the folders the delete left empty (`step12_remove_emptied_folders`: upward from each deleted file, a folder holding nothing but `.DS_Store` goes; folders that were already empty are left to step 2) — in the core because it is where the file types Jo never wants get cleared out, before anything spends time compressing them), and — as the last core step — **compression** (step 7), which asks with its options which of two methods to use: *larger, higher quality* (Optimage at its own settings, for material that starts high quality and should stay that way) or *smaller, lower quality* (the AVIF/WebP + AV1 re-encode, the usual choice). `COMPRESS_METHOD` holds the answer and `step_compress_media` dispatches to `step_optimage_compress` or `step_recompress_media`; each method's own tools are checked the moment it is chosen (`choose_compress_method`), since `ensure_step_requirements` runs before the choice exists. Steps 8–14 are the optional extras: video trimming, MP3 extraction, static-media quarantine, a VHS look (step 12: `ntsc-rs-cli` from the installed app, one frame for stills and a re-encode for MP4s, written back over the original at a chosen height; the height prompt also takes `T`, which renders the first three files of the set at every height into `_vhs_height_test/` — one subfolder per height plus `original/` — so the size is chosen by looking rather than by guessing; it is the one `choose_*` option that does real work, because what it produces is the answer to the question asked on the next line, and every step's `find` prunes that folder so its samples are never mistaken for library media. Its pace — `STEP13_VHS_PACE`, set from the run-wide pace below — is `slow` (`nice`d, one file, one thread), `fast` (one file, flat out) or `ultra`, which keeps several files in flight through `step13_vhs_run_pool`. **Ultra's widths are measured, not reasoned about**, and the measurements contradict the obvious guess: an image job is nearly serial (0.73s wall for 0.83s of CPU, split between an ffmpeg decode, a single-frame ntsc-rs render and an encode, none of which threads far), so it wants **one job per logical core, efficiency cores included** — a short single-threaded job on a slow core is still throughput; a video job self-parallelizes to about 2x (5.2s wall for 10.4s of CPU, since the ntsc-rs pass and the x264 re-encode both thread), so it wants **half the cores**. On a 14-core M4 Pro the sweeps peaked at 14 image jobs (2.6s for 24 files, against 4.5s at 5 jobs) and 6 video jobs (16.1s for 12 files, against 31.7s at 2), and **both curves turn back up past the peak** — 16 image jobs and 10 video jobs are both slower — which is why `step13_vhs_ultra_jobs` is a measured number rather than "as many as possible". The memory caps beside it come from measured peak RSS (192 MB an image job, 537 MB a video job) budgeted at 1 GB and 2 GB for headroom, and bind only on a machine whose memory does not match its cores. Each job is then capped to `cores / jobs` threads (`step13_vhs_ultra_threads`): at the peak width that costs nothing (14 jobs runs the same at 1 thread as at 4) but without it 14 jobs at 14 threads each is measurably slower, which is how a wider pool ends up losing to `fast`. Each slot gets its own scratch folder — the per-file temp names are fixed — and reports through a status file, since the pool is polled rather than woken (bash 3.2 has no `wait -n`)). **Color grading (step 13)** is the gallery app's own filter panel as a batch: five dials — brightness, contrast, saturation, hue shift, temperature — each a whole percentage from -100 to 100 with zero meaning "leave it alone", plus an `Enhance` quick set (contrast +5%, saturation +10%, hue shift +5%) that is a lift rather than a look. The numbers *are* the app's: a percentage maps straight onto the app's own amount, so +10% saturation is the app's `saturationOverlayIntensity: 0.10`, and hue shift takes a percentage of a half turn. It adds **no new tool** — every one of the five is a linear operation on the pixel, so ffmpeg carries all of them. `color_grade_filter_chain` is where that is worked out, in awk, and three things about it are load-bearing. Brightness and contrast are folded into a **single** `colorlevels`, because every ffmpeg filter clips to 0..1 where the app clips only at the end, and a brightness lift followed by a contrast drop would otherwise come back with the highlights already flattened to white. That filter's levels are read off the ramp rather than set to 0 and 1, because ffmpeg silently treats an input level below zero as zero. And saturation, temperature and hue are each a 3x3 matrix — temperature included, since the luma it hands back after tinting is itself linear in the pixel — so their product is one `colorchannelmixer`; they are only sent as three separate mixers when the product would need a coefficient outside the ±2 a mixer accepts, which no single one of them ever does. The chain runs in float (`format=gbrpf32le`) for the same clipping reason, which means the output format has to be pinned back to what the source actually had or PNG comes back 16-bit and RGBA; `color_grade_pixel_formats` probes that per file. Checked against a reference implementation of the app's shader over 50-odd dial combinations, the two agree within about one 8-bit level. **Step 13 has a pace too** (set from the run-wide pace) — `slow` (the default, one file at a time) or `ultra`, a pool over `color_grade_run_pool`; unlike step 7's pool its slots each need their own scratch folder, because `color_grade_process_image` names its temp files after the extension rather than the source. The thread budget is the trap worth remembering: `-threads` before `-i` limits the **decoder only**, so a job told to use one thread still ran about six times parallel (29.45s of CPU in 4.67s of wall) until the flag was moved into the *output* options beside the codec; seven of those would have oversubscribed the machine rather than filling it. Fixing it also halved peak RSS per video job, 902 MB to 449 MB. The widths are measured, and both curves have a real peak: images 40.5s → 5.9s at 14 jobs (one per logical core, with 18 jobs *2.5x worse* than the peak), videos 183.3s → 56.8s at 7 jobs (half the cores). The split is the same one step 7 found — a still is nearly serial (2.11s of CPU for 2.19s of wall) while x264 already gives about 4.9x on its own, so there is less left for a video pool to recover. Images win about 6.9x, videos about 3.2x. The one setting where they part company is a ramp that drives the whole frame below black: the app, floorless until the end, can lift a channel back over zero through saturation and so keeps a faint tint, where ffmpeg floors at the filter. Both give a black frame. Resize (step 14) sits at the *end* of the list, outside the core cleanup, as a lossy re-encode you opt into. **The re-encode half of step 7 has a pace of its own** (set from the run-wide pace) — `slow` (the default, and byte-for-byte how the step has always run: one file at a time with the encoder free to take the machine) or `ultra`, a pool over `step15_run_pool`. Its per-file work was pulled out into `recompress_image_one` / `recompress_video_one`, each printing one `<outcome> <bytes saved>` line, so the serial loop and the pool tally through the same `recompress_tally` rather than through two copies of the accounting that could drift; the slots need no scratch folder because every temp name is derived from the source file. Each job is held to its share of the cores (`avifenc -j`, `MAGICK_THREAD_LIMIT`, and `lp=` for SVT-AV1) — without that last one a wider pool is *slower* than slow, since every job opens the whole machine. **The widths are measured**, on the same M4 Pro as step 12's, and the two halves do not have the same shape. An image job is almost perfectly serial (4.10s of CPU for 4.27s of wall — neither the Lanczos resize nor avifenc threads far), so it wants one job per logical core: 24 images went 103.0s → 13.7s at 14 jobs, with 16 and 18 jobs both slower, a peak sitting exactly on the core count. A video job does not behave that way, because SVT-AV1 already threads well; past about half the cores the curve simply goes **flat**, every width from 7 to 22 landing between 29.6s and 34.5s — a spread smaller than the run-to-run variance — so there is no peak to find and the number taken is the narrowest width that reaches the plateau. Images win about 7.5x, videos about 2x, and that asymmetry is just how much each encoder was leaving on the table. Peak RSS per job (358 MB image, 744 MB video) sets the memory caps, which bind only on a machine whose memory does not match its cores. `machine_cpu_total` / `machine_mem_gb` are shared with step 12's pool. The AI upscale/denoise step (`waifu2x-ncnn-vulkan`) was removed outright, along with its installer, its model resolution and its options prompt.

  **Every question repairs the terminal first.** A terminal left in raw mode
  (typing invisible, Enter echoing `^M` and never ending the line) makes a
  `read` look frozen; it was seen at step 6's DELETE prompt and between runs,
  with no culprit found. `ui_prompt` calls `ui_restore_typing` (the `stty -g`
  saved at start, then `icrnl icanon echo echoe isig` forced on, since the
  terminal may already have been broken when the script started), and the
  EXIT trap does the same. Every `ffmpeg` call carries `-nostdin` so none can
  read or eat keystrokes. Tested by driving the script through a pty set to
  `-icrnl -echo -icanon`: the old script froze at the first prompt, this one
  runs a full step 6.

  Its shape is: type a queue, resolve tools, answer the one pace question and
  every queued step's options, confirm once, then walk away. Options live in
  `choose_*` functions called from `main()` before the `Proceed?` gate — never
  inside a step body — and `ensure_step_requirements` runs for every step in
  the queue up front, so a step that cannot run says so before anything has
  been touched. Step 6's type-`DELETE` gate is the one deliberate run-time
  prompt: it confirms the actual match list, which earlier steps in the same
  run can still change.

  **The prompt takes a queue, not a set.** Steps run left to right exactly as
  typed, in any order and as often as written: `0,12` is the core
  cleanup, then step 12. `queue_parse` is a small recursive-descent parser:
  commas or spaces separate, `a-b` is a range in either direction, `0`/`core`
  is steps 1–7 and `all` every step, `NxK` (or `N*K`) repeats an item, and
  `(…)xK` repeats a group, nesting allowed. Anything it cannot read is named
  and the prompt asked again, never silently dropped; a queue longer than
  `QUEUE_MAX_LENGTH` is refused. A step with options is asked for them at its
  place in the queue, and when it comes round again it offers the last answer
  (`Same settings as before?`), so the same step can run twice with different
  settings. The answers are held per queue position as a line of shell from
  `snapshot_vars` (not `declare -p`: evaluated inside a function, its
  `declare` makes the variable local) and replayed just before that position
  runs; `step_option_vars` is the list of what each step's options set.

  **One pace for the whole run.** `choose_run_pace` asks once — normal,
  turbo or gentle — whenever the queue holds a step in `PACE_STEPS`, and
  `apply_run_pace` writes the answer into the per-step variables steps 12, 13
  and 7's re-encode already read (turbo → `ultra` for all three; normal → step 12 `fast`,
  13 and 7 `slow`; gentle → `slow` for all three plus `renice`/`taskpolicy -b`
  on the script itself, which everything it starts inherits). Those steps no
  longer ask their own. The core cleanup's turbo, each measured on the M4 Pro:
  step 2 swaps `fdupes` for `czkawka dup -D AEO` (same groups, 3.7s → 0.9s;
  both keep the oldest copy; the hidden-file exclusion is anchored to `$PWD`
  because a bare `*/.*` matches a dot-named library's own path, and a `$PWD`
  holding wildcard characters falls back to fdupes), runs the two similarity
  scans at once, and measures every look-alike in parallel before ranking
  (`similar_media_prefetch_metrics`, a cache `collect_similar_media_moves_from_report`
  uses only while it lines up path for path). Step 3 checks names in
  parallel; the renames stay serial, deepest first. A subprocess-free test
  (`sanitize_name_is_clean`, fuzzed against the full sanitizer) now skips
  already-clean names in every pace. Step 4 pools videos (half the cores) and
  GIFs (one per core) through the generic `turbo_pool`, over per-file workers
  shared with the serial loop. Step 5 hands `mat2` batches of four files per
  core — mat2 already fans its arguments over a process pool, the serial loop
  just never gave it more than one (132 files 52.2s → 3.8s); a failed batch is
  rerun file by file to name the failure. Step 7's Optimage method runs `cores / 7` (at least 2)
  copies of Optimage side by side over round-robin shares, because one copy
  already fills about half the machine: 16 PNGs took 191s in one copy, 134s in
  two, and no better in three or four.

  **Step 7's Optimage method drives the Optimage app, not its bundled CLI.** `Contents/MacOS/cli/optimage`
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
- **`docs/`** — documentation *about* the app: `VARIATIONS_DESIGN_LANGUAGE.html`, a self-contained page specifying the
  visual language both the gallery and Variations are built in — tokens, control
  primitives, the text-marking rules and the state model. Open it in a browser; it is
  rendered in the language it documents, and `Cmd+P` gives a paged PDF of it.
- **`safekeeping/`** — everything in the repo that the page does not use: the userscripts, `clean.sh`, `compare.html`, `mod_merge.js` and the Automator workflows. The Mac app's icon (`assets/icon.icns`) and dev launcher (`scripts/Local Gallery Dev Launcher.applescript`) live here too. The personal git tooling that used to live there (`checkpoint.sh`, `_commit_indexed.sh`, `authoritative.sh`, `stable.sh`, `unstable.sh`) was deliberately removed; commits that used to be made by it are made by hand, keeping the `Checkpoint NNNN` subject convention its history established. Nothing in `safekeeping/` is referenced by `package.json`, the page or the CI workflow.

## Navigation model (file pane vs. preview grid)

This is the conceptual model the keyboard/grid navigation is built on. Keep it in mind when touching `navigateToDirectory`, `enterSelectedDirectory`, `leaveDirectory`, the quick-navigation helpers, or the pane-restore functions.

### The two panes

- **The file pane (directories pane) is authoritative.** `WS.nav.dirNode` is the *official current directory*; the file pane lists that directory's children, and `WS.nav.selectedIndex` is the selected child.
- **The preview pane is always exactly one level below the file pane.** It renders the contents of the *currently selected child* (`WS.preview.dirNode` = the selected folder), shown as the "grid". The grid is a UX fudge that makes browsing feel like a second interaction mode, but structurally the preview is always one directory deeper than the file pane. `WS.view.previewSelectedKey` is the selected card *within* that grid — a second, independent selection cursor from the file pane's.

So at any moment: file pane = directory **D**, selected child = **C**, preview = **C's contents**, grid cursor = some item inside C.

### Which pane is "the location"

The two roles are split, and the distinction matters:

- **`WS.nav.dirNode` is authoritative for *navigation*** — what the file pane lists, what the keyboard moves through, what `leaveDirectory()` steps out of.
- **The preview pane is authoritative for *the location you are at*** — what the title pane path reports. That is the folder or file the preview currently shows (**C**, or a single file inside it), i.e. one level *below* `WS.nav.dirNode`.

So with the file pane at **D** and **C** selected, the title reads the path to **C**, not **D**; if a file is previewed, the title reads the path to that file. `getPreviewLocationPathText()` builds that path and `previewLocationDirNode()` resolves the folder that qualifies it; `getCurrentTitleText()` / `getCurrentTitleInfoText()` read through them, so path and metrics always describe the same place.

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

### The screen leads, the file pane follows

The file pane (`WS.nav`) is a leftover of the old sidebar and is never shown,
but it still decides what the preview shows whenever something syncs the
preview to its selection. That was the source of "I did something
miscellaneous and ended up inside Favorites": its cursor drifted (a re-sort
left the row index on another entry; a refresh could not find a Tag row in
`restoreRefreshSelection` and fell back to row 0, usually Favorites; a score
change or edit starter moved it onto a card that sits in the same list) and
the next sync took the screen there. Changing a card's score under score sort
"opened" it the same way.

The rule now, in `syncPreviewToSelection`: **an unforced sync never moves a
preview that still exists.** It calls `alignNavSelectionToPreviewLocation()`
instead, which puts the file-pane cursor on the place on screen
(`previewLocationEntryKey`: the file, the folder, or a Tag node's own entry
key) and swaps a stale folder node for the live one after a rebuild.
`preserveActivePreviewTargetDuringDirectoriesRefresh` aligns the same way, and
`restoreViewerCloseState` aligns after restoring a place. Only deliberate moves
pass `{ force: true }` (the restore fallback with nothing captured is one).
Score changes (`applyScoreMutationRender`), folder rename, set merges and an
ALT swap from a folder's own menu keep the location and at most re-select a
card; `refreshWorkspaceFromRootHandle` carries the selected card across.

### The card you left is the card selected (big grids and Tags)

Two things broke "exit selects the item you came out of", both only in Tags:

- **Big grids draw in batches.** `renderTagPreviewFolderEntriesInHareChunks`
  draws the first 40 folder cards (8 when the grid holds Tags) and the rest on
  later frames. A return is often drawn *twice*: the first draw uses
  `pendingPreviewSelectionKey` and clears it, the second only has
  `previewSelectedKey`. The first batch used to include only the pending card,
  and only for `dir:` keys, so the second draw left the selected card for a
  later batch; `ensurePreviewSelectionForCurrentTarget` found it missing and
  fell back to the first card of the row in view. `previewKeysToDrawFirst()`
  (pending **and** selected, any key kind, matched with `entryKeyForSelection`)
  now sizes the first batch for both the folder and the file grid.
- **Leaving a Tag's own grid.** `syncGridReturnStateToExitedFolder` re-points the
  bridge at "the folder being left", and for a Tag grid it fell through to
  `WS.nav.dirNode` -- the folder the Tag hangs off, which is not in the grid
  being returned to. When the preview target is a Tag node and the exit folder
  is that node's parent (or none), the Tag's own entry key is used instead.

Random jumps that land on a grid (`randomModelJump`) pass
`jumpToLocationTarget(target, { freshGrid: true })`: the target's saved scroll
is forgotten and `showFreshPreviewGridTop()` puts the grid at the top with the
first card selected. Returns never pass it. Testing this in the hidden Browser
pane needs `requestAnimationFrame` swapped for a timer, or the later batches
never draw.

### Files reached without a dive (quick navigation's exit is always the same)

Many things now land straight on a file without entering its set: the random
set jumps, and restoring a session that was on a file. None of them captures a return bridge, so leaving used to fall through to
a plain `leaveDirectory()` and land in the set's own grid. **With quick
navigation on, every exit from an open file ends the way a dive's does: on the
model folder's grid with the set you were just in selected.**
`exitUnbridgedOpenFileToSetSelection()` builds that view (a location at the
model, `pendingPreviewSelectionKey` = the set) and is tried on every way out --
`handleClosedFilePaneNavigationAction` and `handlePreviewPaneAction`'s
`leaveDir`, `handleBackAction` (Escape), and `restorePanesClosedByFilePaneEnter`
when a dive's bridge has since been replaced (a dive, then a random jump into
another set, leaves onto that other set). It stands aside when the file already
has a way back (a bridge, or a file opened from a grid card), inside a Tag or
special view (those keep their own return), with quick navigation off, and for
a file that is not in a Set directly inside a Model.
