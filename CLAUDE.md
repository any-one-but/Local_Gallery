# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start   # serve frontend/ at http://localhost:8123 (python3 http.server)
```

Open that address in **Chrome** (or Edge): the page needs the File System
Access API. GitHub Pages publishes the same `frontend/` folder
(`.github/workflows/deploy-pages.yml`). There is no build step and no test
suite. The `browser-host` preview config serves `frontend/` on port 8140.

**There is no desktop app any more.** Local Gallery used to also ship as a
Tauri v2 + Rust app; it was removed on 2026-09-17 (Checkpoint 0209) after its
WebKit engine could not play or scrub the library's AV1 video without freezing
the whole screen, where Chrome handles it smoothly. `src-tauri/`, the injected
`tauri-bridge.js` / `tauri-fs-shim.js` / `embedded-inject.js`, the build
scripts, the Windows CI workflow and the app's docs are gone. Do not bring any
of it back without asking.

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
root", not "sibling folder"). Tags, Favorites, Hidden, Storage
and Trash are views over this tree, not extra levels of it.

## Architecture

Local Gallery is a **static web page**: `frontend/index.html` is the entire
application (a ~80k-line monolith), run in Chrome and reading the library
through the File System Access API. `frontend/variations.html` is a separate
standalone page (the prompt composer; see "Variations").

`index.html` holds two auto-generated inlined blocks (do not hand-edit the
delimiters):
- `<!-- BEGIN: inlined from ./styles.css -->`
- `<!-- BEGIN: inlined from ./app.js (auto-generated) -->`

**Media** comes from blob object URLs of the `File`s the directory handles
give (`ensureMediaUrl`). **Persistence** is `<library>/.local-gallery/*.log.json`,
written through the same directory handles.

### The desktop-app code is gone from the page too

Checkpoint 0211 removed the page's app-only branches: host detection
(`LG_HOST_IS_APP` / `LG_HOST_IS_BROWSER`), the Settings-window and cross-window
metadata sync, session recovery, the managed-library opener and Hide gallery
folder, Export logs / Export journal, Add items (native import), folder
scrubbing, the Grok / Claude / Variations toggles, the native thumbnail cache
and the Full resolution thumbnail option (`fullResThumbnails` is still
normalized and saved, unused, so preferences round-trip), the full-resolution
preview upgrade and its LRU, native file paths (`nativePathForRecord` and
friends), the disabled video-thumbnail cache, and the preview file-object
warmer. Nothing in the page reads `window.__lg`, `window.__TAURI__` or
`window.electronAPI` any more. If a section below still mentions one of those,
it is history.

### How the library is opened

A web page cannot create or open a folder in Documents on its own -- only the
directory picker hands a page a folder, and only from a user gesture -- so the
page asks **once** and remembers.

**There is one library: a folder named `Local Gallery`** (or `.Local Gallery`,
the old hidden name). The page can never open any other folder:


- **First run.** `setupBrowserLocalGallery` opens the picker in Documents
  (`startIn: "documents"`, `id: "local-gallery"`). Whatever is chosen,
  `resolveLocalGalleryFolder` turns it into the library: the choice itself if
  it is named Local Gallery, otherwise the `.Local Gallery` inside it (hidden
  wins) or a `Local Gallery` it creates there. The handle is
  stored in IndexedDB (`lgBrowserRememberRootHandle`) with a label for
  messages (`Documents/Local Gallery`; a page never learns a full path).
- **Every later load.** `openRememberedBrowserLibrary` opens it at boot with
  no interaction when the permission survived (Chrome can keep it: "Allow on
  every visit"). When it did not, the prompt reads "Press Space to open Local
  Gallery", and Space only re-allows that same folder. A remembered handle not
  named Local Gallery (from when any folder could be picked) is forgotten; a
  vanished folder is forgotten and set up again.
- **No other way in.** There is no `O` key, no `webkitdirectory` fallback in
  the browser (browsers without the File System Access API are told to use
  Chrome or Edge), and "Choose root" only names the library.

The **root prompt** (`#rootPrompt`, `syncBrowserRootPrompt`) says one of:
"Press Space to set up Local Gallery", "Press Space to open Local Gallery",
the no-API message, or -- with the library open but empty
(`browserLibraryIsEmpty`: no folders but the Trash, no files) -- "Add content
to Documents/Local Gallery to see it here". While that last one shows,
`startBrowserLibraryEmptyWatch` looks at the folder every 3s and opens the
library the moment content arrives. The prompt is kept in step with the
`no-root-selected` class inside `applyInteractionModeFromOptions`, and
`hideBrowserRootPrompt()` takes it down the moment a build is committed to
(the loading overlay fades in over ~0.3s and the prompt would read through
it); its z-index sits *below* `#busyOverlay` for the same reason. The passcode
gate runs before any build (`openBrowserLibraryHandle`).

**Browser essentials work while the toolbar shows.** The first keydown
listener the page registers ("Browser essentials", right after host detection)
stops the page from seeing the browser's essential chords whenever
`browserToolbarHidden()` is false, without preventDefault, so Chrome acts on
them: Cmd+W / Shift+W, R / Shift+R, Q, T / Shift+T, N / Shift+N, 1-9, L, M, H,
comma, [ and ] (with or without Shift), Cmd+Option+Left/Right and Ctrl+Tab
(`BROWSER_ESSENTIAL_CODES`, `isBrowserEssentialChord`; Cmd on a Mac, Ctrl
elsewhere). The app's own bindings on those keys (the Cmd+W folder keys,
Cmd+R random jumps) only work with the toolbar hidden. "Hidden" is page
fullscreen, or a window filling the screen whose inner height (zoom taken out
via devicePixelRatio over a 1x/2x/3x display scale) equals its outer height.
Cmd+Q is never handed to a page by Chrome, so it quits in both states.

**Otherwise browser shortcuts are kept from the browser.** `isBrowserChordToKeep`
makes `shouldReserveAppKeybindBeforeBrowser` reserve every Cmd/Ctrl chord in
the browser version -- reload, find, save, bookmark, print, back/forward, tab
switching, zoom, the toolbar toggle (Cmd+Shift+F) -- so it is
`preventDefault`ed and still reaches the app's own handler
(`RESERVED_APP_KEYBIND_EVENTS`). Left to the browser: text editing in a text
field (`TEXT_FIELD_EDITING_KEYS`) and the developer tools (Cmd+Option+I/J/C).

Whether a `preventDefault` is honoured is Chrome's decision
(`BrowserCommandController::IsReservedCommandOrKey`, checked against Chromium
source): **on a Mac, in fullscreen with the toolbar hidden, every shortcut
except Quit and leave-fullscreen goes to the page first**, so Cmd+W and
Cmd+Shift+W (the folder keys) work and cannot close anything. With the toolbar
showing, or in a normal window, Chrome keeps close tab / close window / new tab
/ new window / reopen tab / tab switching for itself, and they act at once. There is **no
`beforeunload` "Leave site?" guard**: it was tried, but a page cannot tell a
reload from a close, so it also asked on every reload, and Jo chose to have no
warning at all.

Because Chrome's own fullscreen usually shows its toolbar (the default "Always
Show Toolbar in Full Screen", or the mouse at the top edge), the reliable way
into the no-toolbar state is **page fullscreen**: `togglePageFullscreen`
(Controls "Fullscreen", **Cmd+Shift+F** by default -- Chrome's toolbar-toggle
chord, which the page already keeps) calls `requestFullscreen` and then
`navigator.keyboard.lock()`, so Cmd+W / Cmd+Shift+W, a single Escape and
everything else reach the app; holding Escape or pressing the key again
leaves. It only ever runs when pressed -- automatic fullscreen was tried and
rejected. Verified in a real (non-headless) Chrome window. Nothing in the app reloads the page itself, which is what
makes that safe. Test-injected CDP key events do not go through Chrome's Mac
menu key equivalents, so this cannot be verified that way.


The `WS` global, navigation model, three-pane UI, etc. are unchanged in the web layer.

### Core data model (`WS` global)

The `WS` object (`const WS = {`, search for it) is the single global workspace state:

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
  directly in the global keydown listener rather than
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
  A real Tag (single or several selected) gathers its own settings in a
  **Tag options** submenu right under Rename: Exclusive, Create inverse and
  Overrides. `isSelectMenuTopLevelElement` must name it, or
  `organizeSelectMenuItems` sweeps it into Other. Special buckets keep Overrides
  at the top level. The select menu **rebuilds itself after any option**
  (the document capture click listener schedules `refreshAppMenuContents`
  unless the option already rebuilt it, tracked by
  `APP_MENU_REBUILD_GENERATION`), which is what keeps every ●/○ toggle live.

`Reveal...` sits right after `Basics` (`buildAppMenuRevealSubmenu`): icon toggles
for Storage, Trash, Untagged, Hidden and All tags, each running the same
`handleExtrasKeybindAction` toggle its Controls row does. `Random actions` is
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

Menu order is fixed: title, `Jump to...` **always first**, `Basics`, `Reveal...`, Filters,
Appearance, History, Controls, Passcode, Refresh App **always last**.
Each of those top-level rows carries a lucide icon left of its name, attached
in one place by `withAppMenuSectionIcon` from `APP_MENU_SECTION_ICON_KEYS`
(label → key into `APP_ICON_SVGS`) — renaming a section means updating that
map. The select menu's first page gets the same treatment through
`withSelectMenuItemIcon` / `SELECT_MENU_ITEM_ICON_KEYS` (Add To..., Remove
From..., Rename, Overrides, Thumbnail, Other, ALTs, Empty Trash, Remove from
Trash, Remove from Storage); the red removal row is matched by its
`data-action` (`move-to-trash` / `delete`) instead, since its label names the
selection. `Basics` holds the everyday view controls (sort, media filter, score is at
least, quick navigation, disable messages), each with an icon from `APP_MENU_BASICS_ICON_KEYS`;
float tags lives under Appearance. Full screen media is no longer an option, and
it is an overarching rule: **open media is totally full screen**. While
`#app.preview-media-mode` is set (`syncPreviewMediaModeClass`, fixed on) the
title bar is not drawn and its grid row is zero, so no
chrome of any kind shares the window with the media. Rows deeper
in the select menu (Overrides cyclers, Add To... places, Thumbnail's Default /
Random / Shuffle / Blank and a file's thumbnail places) get icons from
`SELECT_MENU_NESTED_ICON_KEYS`, keyed by the submenu they sit in; Remove From...
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
row that has an icon drops its ●/○ marker and shows its state on the icon
instead (`menuToggleOn` / `menuToggleOff`, set in `withMenuItemIcon`), so there
is one mark, not two. `Add To... -> Add contents to tag`
(`buildAddContentsToTagButton`, directly under Tag) is the Tag option aimed at
the selection's child folders. Neither has a submenu: both open the naming field
at once, which takes a comma list ("A, B") and adds to any name that already
exists -- `commitTagEntryRename` applies the folder diff and, for Tags put in
Tags, one parent per name. Favoriting shows
"<name> added to Favorites in <parent>" (or "N items ...") from
`announceFavoritesAdded`, called by both favorite writers.

There is **no reading mode** any more (it was removed with its toggle, option,
keybind and held-key scrolling). The tall/wide scroll layout for
extreme-aspect images (`detectScrollImageMode`, ratio ≥ 2.2) is separate and
stays.

**Hard-coded folder keys.** `KEYBIND_LOCKED_ACTIONS` also pins `prevFolder`
(Cmd+W), `nextFolder` (Cmd+S), `prevRootFolder` (Cmd+Shift+W) and
`nextRootFolder` (Cmd+Shift+S). In the browser version Cmd+W and
Cmd+Shift+W reach the page only while Chrome is fullscreen with its toolbar
hidden (see "Browser essentials work while the toolbar shows"); like every fixed key they are listed on the
hold-`[` page, not in Controls. The root pair (`stepRootFolder`) steps between the folders directly
inside the library root from any depth, landing through `jumpToLocationTarget`
over the same list Jump to... shows, clamping at the ends. The Storage toggle's old
Cmd+Shift+S default is gone (a locked key wins over any saved binding).

**Jump to root** (`jumpToRoot`, unbound by default, in Controls after the root
folder keys and on the hold-`[` page under Moving around) is
`jumpToLibraryRoot()`: the same landing as the enter key on `Jump to...`, from
anywhere, closing the viewer or an open file on the way.

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

Storage and Trash are dropped at every level whatever their visibility toggles
say (`appMenuJumpTargetIsExcluded`), so nothing quarantined is reachable here.

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
`bulkThumbnailTargetsFromSelection` (folders and tag entries mixed, root
included, storage stubs excluded). `bulkThumbnailActionAvailability` decides what
to offer: Default / Shuffle / Blank appear when **any** target would change,
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

### Variations (`frontend/variations.html`)

The prompt composer, a standalone page of its own (open it directly; it stores
its document in the browser's localStorage). It used to also run as an
embedded window of the desktop app, and its app-mode branches
(`__lgVariationsEmbedded`, `canControlWindow()`, the metadata-folder store) are
now inert. Import and Export work as a browser download / file pick. The file
is named `YYMMDD-HHMMSS - Variations.json` in local time, and the JSON carries
`exportedAt` / `exportedAtLocal` beside the document; import reads only
`projects`.

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
resolves duration and frame rate (mounted `<video>` first, else a probe
`<video>` in the page, else `VIDEO_THUMB_FRAME_RATE_FALLBACK`), cached in
`VIDEO_THUMB_TIMING_CACHE`. Held keys accelerate via `videoThumbnailFrameRampCount`
(1 frame, ramping to 72 after ~320ms of hold), and requests are coalesced through
`drainVideoThumbnailFrameSeekQueue` so a fast hold does not queue hundreds of
seeks.

### Randomizing (the Random controls)

Four bindable controls, kept together in Controls and in the hold-`[` list, all
named for the library's shape. Nothing random touches the order of *files* any
more, and the Models never shuffle: the file-order toggle, both random-file
jumps and "Randomize all folder order" were removed.

- **Jump to random set** (`randomFirstFileJump`, `r` -- the id predates the
  rename) -- `randomSetJump()`. Picks among the sets of the **container you are
  in** and opens the first file of the one it lands on. The container is the
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
  sets, landed through `jumpToLocationTarget({ kind: "file" })`.
- **Jump to random model** (`randomModelJump`, unbound) -- lands *at* a random
  model folder, its grid showing, over the same root list Jump to... and the
  root folder steps use (`appMenuJumpChildTargets`).
- **Randomize set order** (`toggleRandomFolderSort`, `Cmd+r`) --
  `WS.view.randomFolderMode`: every listing except the root's own shuffles
  (`getRandomOrderForDirs`, cached per parent in `randomFolderCache`), so the
  Models keep the chosen sort. Turning it on reseeds, so it is a new permutation
  each time.

A candidate set has a file passing the current filters
(`pickRandomSetWithFiles` tries a shuffled pool and stops at the first with
one), and the set jumps leave out the set you are in, the model jump the model
you are in, when there is another. The toggle and jumps are dispatched from
`handleExtrasKeybindAction`, which the global keydown listener tries before
anything else.

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

### Music player

A deliberately basic player ("Music player" block, `#musicPlayer`) for mp3
files dropped into `<library>/__LOCAL_GALLERY_MUSIC__`
(`INTERNAL_MUSIC_DIR_NAME`). That folder is **skipped by every library scan**
(the same five places that skip `.local-gallery`, top level only), so it never
appears in the app and nothing can reveal it -- unlike the Trash. It is
created the first time the player opens.

- **What it has:** the song name (file name without extension), a thin
  progress line, previous / play-pause / next, and two toggles, Shuffle
  (`musicShuffle`) and Repeat song (`musicRepeat`), both general options. No
  artwork, artists or playlists: the folder sorted by name (numeric) is the
  list, re-read when the panel opens and when a song ends.
- **It never plays by itself.** Play starts the first song, or a random one
  with Shuffle on. Next wraps at the end; with Shuffle it picks a different
  random song and Previous walks back through `MUSIC.history`. Previous past
  3s restarts the song. A song that ends replays with Repeat on, else Next.
  A file that won't play is skipped, never in a loop. With the panel
  closed, each song change shows "Now playing <song>" (an ordinary status
  message, so Disable messages silences it).
- **Audio is a detached `Audio` element** (`musicAudio()`), not in the DOM,
  so it plays alongside video sound and nothing that pauses or mutes
  `<video>` touches it. Panic pauses it and resumes it afterwards
  (`musicOnPanic` from `applyBanicState`); Lock now stops it (`musicStop`).
  The source is a blob URL of the File.
- **The panel** is its own surface, laid out like a player (two rows:
  transport, toggles), with the menus' glass. It is keyboard-only: while open a
  window capture listener takes the keyboard -- the user's movement keys move
  the focus (`MUSIC_CONTROLS`, down lands on Shuffle, up on Play), enter or the
  select-menu key presses, Space is play/pause, and the exit key, Escape or
  the player key closes it. Cmd/Ctrl chords with no app action still reach the
  browser. Music keeps playing when it closes.
- **Keys:** `toggleMusicPlayer` (M by default), and `musicPlayPause`,
  `musicPrevious`, `musicNext`, `musicToggleShuffle`, `musicToggleRepeat`,
  which work from anywhere and ship unbound.
  They are in the playback group of Controls and a "Music" group on the
  hold-[ page, and are dispatched first thing in `handleExtrasKeybindAction`.

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
  A retraction is also **generation-guarded**: every call that passes
  `onMissing` takes a new `INLINE_EDIT_RETRACT_GENERATION`, and the check stands
  down if a newer one has been taken since. An edit swapped for another before
  its check ran is not the pending edit any more — Add To → Tag → Create opens
  the card's inline input and at once replaces it with the new-tag placeholder,
  and without the guard the first check cleared the placeholder a moment after
  it appeared.
- **Long menu lists scroll.** A panel with `appMenuLongListPanel` (Add To → Tag,
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

**The document opts out and prose opts in.** `<html spellcheck="false">` in both
pages, with `spellcheck="true"` on the daily journal editor and Variations'
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

**`Appearance`** holds theme, bubble styling, app menu placement, float tags,
Thumbnails, and Select Menu. Select Menu holds the placement-adjacent controls:
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

### Score is at least (Basics)

A cycler: Off, then every whole number from one above the lowest score of a
folder that **holds media** up to the highest such score, then Off again
(`scoreFilterCycleValues`). Counting only media folders is what keeps the top
of the cycle from hiding everything: a high-scored parent whose children all
score lower would otherwise be a visible, empty folder. Stored as the
`minScoreFilter` option (general preferences); null is Off.

A file passes on its own folder's score (`recordPassesScoreFilter`, inside
`passesFilter`). A folder passes on its own score **or** because a folder inside
it passes (`scoreFilterVisibleDirPaths`, a post-order walk cached on the
threshold, `SCORE_FILTER_REVISION` and `NAV_ENTRY_RESTORE_REVISION`), so a
low-scored folder still shows the way to a high-scored one -- its own files stay
hidden. The root always shows; the Trash and Storage are never filtered.
Folder listings apply it in `getChildDirsForNodeBase`. Any score change bumps
the revision and, while the filter is on, drops the listing caches.

### Tags (the only simulated folder)

Tags, albums and galleries used to be three things; they are one now, **Tags**,
plus the special buckets (Favorites, Hidden, Untagged, Storage), which are
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
`exclusiveChildTags`). Opening the Tag is where they are.

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
- `TAG_SPECIAL_FOLDER_NAMES` (favorites, hidden, untagged, storage) can never be
  a Tag name, from any entry point — `metaSetTagsForPath` and
  `metaAddUserTagsBulk` filter them, and the rename and name inputs refuse them.
- Add To offers **Tag** only (for folders and Tags), listing every Tag except
  ones that would loop and ones with nothing left in them (no placement — their
  folders deleted, trashed or removed); Remove From lists a Tag's parents. An
  empty Tag's metadata is kept, and it is offered again once it holds something.
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

#### All tags (Reveal...)

`Reveal... -> All tags` (`showAllTagsFolder`, `toggleShowAllTagsFolder`) adds an
**All tags** card to the root. It is not a special bucket but a Tag-shaped view
under the reserved name `ALL_TAGS_NAME` ("all tags", in
`TAG_SPECIAL_FOLDER_NAMES` so no real Tag can take it): `tagChildNames` answers
it with every Tag that has a place (`allTagsFolderChildNames`) and it has no
folders of its own. So opening it, its grid preview, its counts and its random
thumbnail all run through the ordinary Tag paths, and every Tag inside is the
real Tag by reference -- opening one opens that Tag where it lives. It is never
in the tag model, holds nothing on disk, and has no select menu
(`selectedItemMenuSectionItems` returns null for it). The root entry is built in
`getTagFolderEntriesForDir`, whose cache key includes the toggle
(`tagFolderEntryOptionContextKey`); turning it off while inside leaves the view.

#### Contents rules (Add contents to tag)

`Add To... -> Add contents to tag` saves a **rule**, not a copy: "the contents of
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
  loser gets ` 2`, ` 3`. A name equal to a special folder gets ` (tag)`.
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

### The passcode lock

An optional four-digit passcode, asked for at launch **before the library is
built**. The ordering is the feature: `lockGateBeforeLibraryOpens()` is awaited
at each of the three "we now have a root handle" sites. Until it returns, nothing has been scanned, no thumbnail has been
asked for and no media URL exists — the overlay is not a curtain drawn over a
loaded app, there is genuinely nothing behind it.

`#lockScreen` is in the markup rather than created by JS, so it can cover the
window from the first painted frame, and it sits above `#bootSplash` (which the
gate takes down as it opens, since the lock screen is the thing to look at). It
lives outside `#app` for the same reason the splash does.

**One screen, four jobs.** Unlock, set, change and turn-off all run through
`lockPromptDigits({title, sub, hint, allowCancel})`, which resolves with the
four digits or `null` when Escape was allowed and pressed. The screen stays up
between calls, so a wrong entry re-asks without a flicker and the multi-step
flows (confirm the old one, choose a new one, type it again) read as one
continuous screen. The launch gate is the only caller that passes
`allowCancel: false`; it loops forever, which is what makes the right digits the
only way in.

While it is up the lock owns the keyboard outright: the handler is on `window`
in the **capture** phase and `stopImmediatePropagation`s every key, so nothing
reaches the document listeners behind it.

The lock screen is drawn in the library's theme even though the library's settings are not
readable yet: `applyColorSchemeFromOptions` remembers the theme in
`localStorage` (`lgAppTheme`) whenever a library is open, and a tiny script at
the top of `<head>` paints it before anything else.

**Storage.** `<library>/.local-gallery/lock.log.json`, read and written through
an ordinary directory handle. `lockMetaDirHandle` resolves that folder from a
handle the caller passed, else `WS.meta.fsSysDirHandle`.

Three rules worth keeping:

- **It is deliberately not in `META_DOC_FILE_NAMES`**, so no metadata code
  path ever loads or rewrites it, and there is no import that could install
  one.
- **What is stored is a salted, iterated hash** (PBKDF2/SHA-256 via
  `crypto.subtle`, with `lockFallbackHash` recorded as `algo: "fallback"` where
  that is missing, so verification always uses whatever made the hash). Four
  digits is ten thousand possibilities: this stops someone reading the passcode
  out of the file, and it is not encryption — the media on disk is untouched.
- **A new passcode is asked for twice and must agree**, or a mistyped one would
  lock the library behind digits nobody knows.

`Passcode` sits in the app menu between Controls and Refresh App, and offers
*Set a passcode* or — once one is set — *Change passcode*, *Lock now* and
*Turn passcode off*; the last three all confirm the current passcode first.
*Lock now* tears the workspace down before re-showing the gate, so the screen
behind the lock is as empty as it is at launch. It passes the in-memory record
into the gate (`{ record }`) because the folder handle it would otherwise read
through has just been discarded.

### Staying open (memory)

Left running long enough the page used to grow without bound. Two fixes still
matter: `forgetThumbEl` / `sweepDetachedThumbEls` stop the thumbnail
`IntersectionObserver` holding every tile it was ever given, and
`REVEALED_THUMB_SRCS` is capped at 20k entries.

There is no log or journal export and no import.

### Companion scripts

- **`safekeeping/clean.sh`** — standalone Bash utility run separately against a media folder. 15 optional processing steps, and the menu's `0` runs the **core cleanup**, steps 1–5. Step 1 bundles three quarantine passes (dedupe via `fdupes`, similar-media culling via `czkawka`, empty-item quarantine); name sanitization (step 2) used to be a fourth pass inside it and was pulled out so renaming happens *after* the quarantining rather than in the middle of it. Then video conversion (step 3, `ffmpeg`), metadata removal (step 4, `mat2`), and — as the last core step — **Optimage compression** (step 5). Steps 6–12 are the optional extras: video trimming, MP3 extraction, static-media quarantine, archive unpacking (step 10: expands every archive in the tree next to itself via `unar` with zip/tar fallbacks, deletes it once the contents land, and rescans until no new archives appear), recursive delete (step 11: 15 criteria, previews the matches and requires the word `DELETE` typed back before anything goes), and a VHS look (step 12: `ntsc-rs-cli` from the installed app, one frame for stills and a re-encode for MP4s, written back over the original at a chosen height; the height prompt also takes `T`, which renders the first three files of the set at every height into `_vhs_height_test/` — one subfolder per height plus `original/` — so the size is chosen by looking rather than by guessing; it is the one `choose_*` option that does real work, because what it produces is the answer to the question asked on the next line, and every step's `find` prunes that folder so its samples are never mistaken for library media. Its pace — `STEP13_VHS_PACE`, set from the run-wide pace below — is `slow` (`nice`d, one file, one thread), `fast` (one file, flat out) or `ultra`, which keeps several files in flight through `step13_vhs_run_pool`. **Ultra's widths are measured, not reasoned about**, and the measurements contradict the obvious guess: an image job is nearly serial (0.73s wall for 0.83s of CPU, split between an ffmpeg decode, a single-frame ntsc-rs render and an encode, none of which threads far), so it wants **one job per logical core, efficiency cores included** — a short single-threaded job on a slow core is still throughput; a video job self-parallelizes to about 2x (5.2s wall for 10.4s of CPU, since the ntsc-rs pass and the x264 re-encode both thread), so it wants **half the cores**. On a 14-core M4 Pro the sweeps peaked at 14 image jobs (2.6s for 24 files, against 4.5s at 5 jobs) and 6 video jobs (16.1s for 12 files, against 31.7s at 2), and **both curves turn back up past the peak** — 16 image jobs and 10 video jobs are both slower — which is why `step13_vhs_ultra_jobs` is a measured number rather than "as many as possible". The memory caps beside it come from measured peak RSS (192 MB an image job, 537 MB a video job) budgeted at 1 GB and 2 GB for headroom, and bind only on a machine whose memory does not match its cores. Each job is then capped to `cores / jobs` threads (`step13_vhs_ultra_threads`): at the peak width that costs nothing (14 jobs runs the same at 1 thread as at 4) but without it 14 jobs at 14 threads each is measurably slower, which is how a wider pool ends up losing to `fast`. Each slot gets its own scratch folder — the per-file temp names are fixed — and reports through a status file, since the pool is polled rather than woken (bash 3.2 has no `wait -n`)). **Color grading (step 13)** is the gallery app's own filter panel as a batch: five dials — brightness, contrast, saturation, hue shift, temperature — each a whole percentage from -100 to 100 with zero meaning "leave it alone", plus an `Enhance` quick set (contrast +5%, saturation +10%, hue shift +5%) that is a lift rather than a look. The numbers *are* the app's: a percentage maps straight onto the app's own amount, so +10% saturation is the app's `saturationOverlayIntensity: 0.10`, and hue shift takes a percentage of a half turn. It adds **no new tool** — every one of the five is a linear operation on the pixel, so ffmpeg carries all of them. `color_grade_filter_chain` is where that is worked out, in awk, and three things about it are load-bearing. Brightness and contrast are folded into a **single** `colorlevels`, because every ffmpeg filter clips to 0..1 where the app clips only at the end, and a brightness lift followed by a contrast drop would otherwise come back with the highlights already flattened to white. That filter's levels are read off the ramp rather than set to 0 and 1, because ffmpeg silently treats an input level below zero as zero. And saturation, temperature and hue are each a 3x3 matrix — temperature included, since the luma it hands back after tinting is itself linear in the pixel — so their product is one `colorchannelmixer`; they are only sent as three separate mixers when the product would need a coefficient outside the ±2 a mixer accepts, which no single one of them ever does. The chain runs in float (`format=gbrpf32le`) for the same clipping reason, which means the output format has to be pinned back to what the source actually had or PNG comes back 16-bit and RGBA; `color_grade_pixel_formats` probes that per file. Checked against a reference implementation of the app's shader over 50-odd dial combinations, the two agree within about one 8-bit level. **Step 13 has a pace too** (set from the run-wide pace) — `slow` (the default, one file at a time) or `ultra`, a pool over `color_grade_run_pool`; unlike step 15's pool its slots each need their own scratch folder, because `color_grade_process_image` names its temp files after the extension rather than the source. The thread budget is the trap worth remembering: `-threads` before `-i` limits the **decoder only**, so a job told to use one thread still ran about six times parallel (29.45s of CPU in 4.67s of wall) until the flag was moved into the *output* options beside the codec; seven of those would have oversubscribed the machine rather than filling it. Fixing it also halved peak RSS per video job, 902 MB to 449 MB. The widths are measured, and both curves have a real peak: images 40.5s → 5.9s at 14 jobs (one per logical core, with 18 jobs *2.5x worse* than the peak), videos 183.3s → 56.8s at 7 jobs (half the cores). The split is the same one step 15 found — a still is nearly serial (2.11s of CPU for 2.19s of wall) while x264 already gives about 4.9x on its own, so there is less left for a video pool to recover. Images win about 6.9x, videos about 3.2x. The one setting where they part company is a ramp that drives the whole frame below black: the app, floorless until the end, can lift a channel back over zero through saturation and so keeps a faint tint, where ffmpeg floors at the filter. Both give a black frame. Resize (14) and the AVIF/WebP/AV1 recompression (15) sit at the *end* of the list, deliberately outside the core cleanup, because all three are lossy re-encodes you opt into rather than defaults. **Step 15 has a pace of its own** (set from the run-wide pace) — `slow` (the default, and byte-for-byte how the step has always run: one file at a time with the encoder free to take the machine) or `ultra`, a pool over `step15_run_pool`. Its per-file work was pulled out into `recompress_image_one` / `recompress_video_one`, each printing one `<outcome> <bytes saved>` line, so the serial loop and the pool tally through the same `recompress_tally` rather than through two copies of the accounting that could drift; the slots need no scratch folder because every temp name is derived from the source file. Each job is held to its share of the cores (`avifenc -j`, `MAGICK_THREAD_LIMIT`, and `lp=` for SVT-AV1) — without that last one a wider pool is *slower* than slow, since every job opens the whole machine. **The widths are measured**, on the same M4 Pro as step 12's, and the two halves do not have the same shape. An image job is almost perfectly serial (4.10s of CPU for 4.27s of wall — neither the Lanczos resize nor avifenc threads far), so it wants one job per logical core: 24 images went 103.0s → 13.7s at 14 jobs, with 16 and 18 jobs both slower, a peak sitting exactly on the core count. A video job does not behave that way, because SVT-AV1 already threads well; past about half the cores the curve simply goes **flat**, every width from 7 to 22 landing between 29.6s and 34.5s — a spread smaller than the run-to-run variance — so there is no peak to find and the number taken is the narrowest width that reaches the plateau. Images win about 7.5x, videos about 2x, and that asymmetry is just how much each encoder was leaving on the table. Peak RSS per job (358 MB image, 744 MB video) sets the memory caps, which bind only on a machine whose memory does not match its cores. `machine_cpu_total` / `machine_mem_gb` are shared with step 12's pool. The AI upscale/denoise step (`waifu2x-ncnn-vulkan`) was removed outright, along with its installer, its model resolution and its options prompt.

  Its shape is: type a queue, resolve tools, answer the one pace question and
  every queued step's options, confirm once, then walk away. Options live in
  `choose_*` functions called from `main()` before the `Proceed?` gate — never
  inside a step body — and `ensure_step_requirements` runs for every step in
  the queue up front, so a step that cannot run says so before anything has
  been touched. Step 11's type-`DELETE` gate is the one deliberate run-time
  prompt: it confirms the actual match list, which earlier steps in the same
  run can still change.

  **The prompt takes a queue, not a set.** Steps run left to right exactly as
  typed, in any order and as often as written: `10,0,12` is step 10, the core
  cleanup, then step 12. `queue_parse` is a small recursive-descent parser:
  commas or spaces separate, `a-b` is a range in either direction, `0`/`core`
  is steps 1–5 and `all` every step, `NxK` (or `N*K`) repeats an item, and
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
  and 15 already read (turbo → `ultra` for all three; normal → step 12 `fast`,
  13 and 15 `slow`; gentle → `slow` for all three plus `renice`/`taskpolicy -b`
  on the script itself, which everything it starts inherits). Those steps no
  longer ask their own. The core cleanup's turbo, each measured on the M4 Pro:
  step 1 swaps `fdupes` for `czkawka dup -D AEO` (same groups, 3.7s → 0.9s;
  both keep the oldest copy; the hidden-file exclusion is anchored to `$PWD`
  because a bare `*/.*` matches a dot-named library's own path, and a `$PWD`
  holding wildcard characters falls back to fdupes), runs the two similarity
  scans at once, and measures every look-alike in parallel before ranking
  (`similar_media_prefetch_metrics`, a cache `collect_similar_media_moves_from_report`
  uses only while it lines up path for path). Step 2 checks names in
  parallel; the renames stay serial, deepest first. A subprocess-free test
  (`sanitize_name_is_clean`, fuzzed against the full sanitizer) now skips
  already-clean names in every pace. Step 3 pools videos (half the cores) and
  GIFs (one per core) through the generic `turbo_pool`, over per-file workers
  shared with the serial loop. Step 4 hands `mat2` batches of four files per
  core — mat2 already fans its arguments over a process pool, the serial loop
  just never gave it more than one (132 files 52.2s → 3.8s); a failed batch is
  rerun file by file to name the failure. Step 5 runs `cores / 7` (at least 2)
  copies of Optimage side by side over round-robin shares, because one copy
  already fills about half the machine: 16 PNGs took 191s in one copy, 134s in
  two, and no better in three or four.

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
- **`docs/`** — documentation *about* the app: `VARIATIONS_DESIGN_LANGUAGE.html`, a self-contained page specifying the
  visual language both the gallery and Variations are built in — tokens, control
  primitives, the text-marking rules and the state model. Open it in a browser; it is
  rendered in the language it documents, and `Cmd+P` gives a paged PDF of it.
- **`safekeeping/`** — everything in the repo that the page does not use: the userscripts, `clean.sh`, `compare.html`, `mod_merge.js` and the Automator workflows. (The desktop app's icon and its dev launcher went with the app.) The personal git tooling that used to live there (`checkpoint.sh`, `_commit_indexed.sh`, `authoritative.sh`, `stable.sh`, `unstable.sh`) was deliberately removed; commits that used to be made by it are made by hand, keeping the `Checkpoint NNNN` subject convention its history established. Nothing in `safekeeping/` is referenced by `package.json`, the page or the CI workflow.

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
