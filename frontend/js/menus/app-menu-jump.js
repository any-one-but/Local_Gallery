/* App menu: Jump to...
   The library as a tree in the menu. */

// -- Jump to...: the whole library as a browsable tree -----------------------
//
// The first entry in the app menu, and it behaves like every other entry: the
// enter key on `Jump to...` goes to the library root, right steps into it. From
// there each level is an ordinary list of menu options -- one option per folder
// or portal, with a chevron -- and opening one spawns the next list to the
// right, the way a submenu does. Deep chains scroll sideways rather than
// truncating.
//
// It walks the library the way the panes do, so albums, tags and the special
// buckets sit exactly where they actually live: an album's tags are inside that
// album rather than loose in its parent. Storage and Trash are absent entirely,
// at every level and whatever their visibility toggles say, so nothing
// quarantined is reachable from here.
//
// The rows are buttons but they are *not* direct children of the submenu panel,
// so numberedMenuOptionsForPanel walks straight past them and handleAppMenuJumpKey
// owns the keyboard instead -- the same division of labour the Calendar panel
// uses. They still pick up the menu's own button styling, because the panel is
// inside #appActionMenu, which is a .dropdownMenu.

// One column is exactly one menu wide (#appActionMenu's own min-width); the
// separation is the divider's margin + padding + rule, and the padding is the
// menu's own. Together they say how wide a chain of N columns comes out.
const APP_MENU_JUMP_COLUMN_WIDTH = 264;
const APP_MENU_JUMP_COLUMN_SEPARATION = 17;
const APP_MENU_JUMP_MENU_PADDING = 16;

// One entry per open level: { target, items, index }. Level 0's target is the
// root folder and its items are the root's contents -- the root itself is not
// listed, since the `Jump to...` option is already the way there.
let APP_MENU_JUMP_STACK = null;
// Widest the chain could ever get, in columns. Cached per menu-open: it is a
// pass over every known folder, and it cannot change while the menu is up.
let APP_MENU_JUMP_MAX_COLUMNS = 0;

function resetAppMenuJumpState() {
  APP_MENU_JUMP_STACK = null;
  APP_MENU_JUMP_MAX_COLUMNS = 0;
}

// Trash, Storage and anything inside either. The two portals are dropped as
// entries and the internal trash folder is dropped as a node, which between
// them covers every route in: a stored folder is not in the tree at all, and a
// trashed one only hangs off the trash root.
function appMenuJumpTargetIsExcluded(target) {
  if (!target) return true;
  if (target.kind === "tag")
    return String(target.entry?.special || "") === "storage";
  if (target.kind !== "dir") return true;
  const node = target.node;
  if (!node) return true;
  if (isTrashRootPortalNode(node) || isInternalTrashDirNode(node)) return true;
  if (dirNodeIsHiddenAlt(node) || node.isMissingPlaceholder) return true;
  return isPathInsideInternalTrash(String(node.path || ""));
}

// The sub-folders and portals of a target, as the preview grid would list them
// (so sort order, filters and the hidden/untagged toggles all agree with what
// the panes show). Files are left out: this menu jumps to places.
function appMenuJumpChildTargets(target) {
  const node = subItemSourceNodeForTarget(target);
  if (!node) return [];
  let entries = null;
  try {
    entries = getPreviewFolderAndFileEntries(node, { includeFiles: false });
  } catch {
    return [];
  }
  const folderEntries = Array.isArray(entries?.folderEntries)
    ? entries.folderEntries
    : [];
  const out = [];
  for (let i = 0; i < folderEntries.length; i++) {
    const entry = folderEntries[i];
    if (!entry || entry.placeholder) continue;
    const child = locationTargetForEntry(entry);
    if (!child || appMenuJumpTargetIsExcluded(child)) continue;
    out.push(child);
  }
  return out;
}

function appMenuJumpTargetLabel(target) {
  if (!target) return "Library";
  if (target.kind === "dir") return dirDisplayName(target.node);
  const entry = target.entry || {};
  return String(
    entry.label || entry.tag || entry.album || entry.gallery || entry.special || "Tag",
  );
}

function appMenuJumpTargetIconKey(target) {
  if (!target || target.kind === "dir") return "folder";
  const entry = target.entry || {};
  if (entry.special === "favorites") return "favorite";
  if (entry.special === "hidden") return "hidden";
  if (entry.special === "untagged") return "untagged";
  if (entry.special) return "tag";
  if (entry.gallery && !entry.tag && !entry.album) return "gallery";
  if (entry.album && !entry.tag) return "album";
  return "tag";
}

function ensureAppMenuJumpStack() {
  if (!WS.root) {
    APP_MENU_JUMP_STACK = null;
    return null;
  }
  const stack = Array.isArray(APP_MENU_JUMP_STACK) ? APP_MENU_JUMP_STACK : null;
  // A workspace rebuild replaces every DirNode, so a stack held over from one
  // is pointing at folders that no longer exist. Anchoring on the live root is
  // the cheapest way to notice.
  if (stack && stack.length && stack[0].target?.node === WS.root) return stack;
  const rootTarget = { kind: "dir", node: WS.root };
  APP_MENU_JUMP_STACK = [
    { target: rootTarget, items: appMenuJumpChildTargets(rootTarget), index: 0 },
  ];
  return APP_MENU_JUMP_STACK;
}

// Deepest folder nesting under the root, the root itself counting as 0.
function appMenuJumpMaxFolderDepth() {
  let depth = 0;
  try {
    WS.dirByPath.forEach((node, path) => {
      const p = String(path || "");
      if (!p || isPathInsideInternalTrash(p)) return;
      const d = p.split("/").length;
      if (d > depth) depth = d;
    });
  } catch {}
  return depth;
}

/* Columns the chain could ever need: one per folder level below the root (the
   root is not a column of its own -- level 0 already lists its contents), plus
   two for a portal hop, since an album opens onto its tags and a tag onto its
   member folders, which then carry on at their own depth. A folder with nothing
   in it costs no column at all: opening one jumps to it instead.

   It is an upper bound rather than a walk of every portal in the library: the
   answer only decides whether the chain is allowed to expand, and traversing
   every album and tag on every menu open is not worth the exactness. */
function appMenuJumpMaxColumns() {
  return Math.max(1, appMenuJumpMaxFolderDepth() + 2);
}

function appMenuJumpChainWidth(columns) {
  const cols = Math.max(1, Number(columns) || 1);
  return (
    cols * APP_MENU_JUMP_COLUMN_WIDTH +
    (cols - 1) * APP_MENU_JUMP_COLUMN_SEPARATION +
    APP_MENU_JUMP_MENU_PADDING
  );
}

/* Expanding is all-or-nothing, measured from where the menu is actually docked.
   A menu opened near the right edge could be *made* to fit by sliding the whole
   thing left as it grows, and that reads as the menu running away from you. So
   unless the widest the chain could ever get still fits to the right of the
   menu where it stands, it does not expand at all: each level replaces the last
   and the menu keeps its normal width and its place. */
function appMenuJumpCascadeFits() {
  const menu = appActionMenuEl;
  if (!menu) return false;
  // The sidebar grows to the right with the chain, pushing the gallery over,
  // and the columns scroll sideways if the chain outgrows the window.
  // (Asked of the setting, not the class: the first level is drawn before
  // the menu is put in the sidebar.)
  if (appMenuShowsAsSidebar()) return true;
  let left = Number(APP_MENU_DOCK_POS?.left);
  if (!Number.isFinite(left)) {
    const rect = menu.getBoundingClientRect();
    left = rect && rect.width ? rect.left : 0;
  }
  const edge = 4;
  return (
    left + appMenuJumpChainWidth(APP_MENU_JUMP_MAX_COLUMNS) <=
    (window.innerWidth || 0) - edge
  );
}

function buildAppMenuJumpRowEl(target, state) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `appMenuJumpRow${state ? ` ${state}` : ""}`;
  const label = appMenuJumpTargetLabel(target);
  row.innerHTML =
    `<span class="dropdownMenuSubmenuLabelWithIcon">` +
    appIconHtml(appMenuJumpTargetIconKey(target), "dropdownMenuItemTypeIcon") +
    `<span class="appMenuJumpRowName"></span></span>` +
    `<span class="dropdownMenuSubmenuCaret" aria-hidden="true">${SUBMENU_CHEVRON_SVG}</span>`;
  const nameEl = row.querySelector(".appMenuJumpRowName");
  if (nameEl) nameEl.textContent = label;
  row.title = label;
  return row;
}

function buildAppMenuJumpColumnEl(level, isActive) {
  const col = document.createElement("div");
  col.className = "appMenuJumpColumn";
  const items = Array.isArray(level.items) ? level.items : [];
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "appMenuJumpEmpty";
    empty.textContent = "Nothing inside";
    col.appendChild(empty);
    return col;
  }
  for (let i = 0; i < items.length; i++) {
    // The item an ancestor column was opened *through* stays marked, so the
    // chain reads as one path rather than a row of unrelated lists.
    const state =
      i === level.index
        ? isActive
          ? "appMenuJumpRowCursor"
          : "appMenuJumpRowOpen"
        : "";
    col.appendChild(buildAppMenuJumpRowEl(items[i], state));
  }
  return col;
}

function renderAppMenuJumpPanel(panel) {
  if (!panel) return;
  if (!APP_MENU_JUMP_MAX_COLUMNS)
    APP_MENU_JUMP_MAX_COLUMNS = appMenuJumpMaxColumns();
  panel.innerHTML = "";
  const stack = ensureAppMenuJumpStack();
  if (!stack) {
    const empty = document.createElement("div");
    empty.className = "appMenuJumpEmpty";
    empty.textContent = "No library open";
    panel.appendChild(empty);
    return;
  }
  const cascade = appMenuJumpCascadeFits();
  panel.dataset.jumpMode = cascade ? "cascade" : "drill";
  const columns = document.createElement("div");
  columns.className = "appMenuJumpColumns";
  const first = cascade ? 0 : stack.length - 1;
  for (let i = first; i < stack.length; i++)
    columns.appendChild(buildAppMenuJumpColumnEl(stack[i], i === stack.length - 1));
  panel.appendChild(columns);
  try {
    // Keep the level being driven on screen: sideways for the column, downwards
    // for the row inside it.
    columns.lastElementChild?.scrollIntoView({ block: "nearest", inline: "nearest" });
    panel
      .querySelector(".appMenuJumpRowCursor")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {}
}

function buildAppMenuJumpToSubmenu() {
  if (!WS.root) return null;
  const panel = document.createElement("div");
  panel.className = "appMenuJumpPanel";
  renderAppMenuJumpPanel(panel);
  // A hybrid trigger: right opens the tree, the enter key takes the option at
  // face value and goes to the library root.
  const submenu = createDropdownMenuSubmenu("Jump to...", [panel], "", {
    onActivate: () => {
      allowMenuClose();
      closeAppMenu();
      jumpToLocationTarget({ kind: "dir", node: WS.root });
      return false;
    },
  });
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuJumpHost");
  return submenu;
}

// The Jump to root control: the same landing as pressing enter on Jump to...,
// from anywhere, including an open file.
function jumpToLibraryRoot() {
  if (!WS.root) return false;
  if (VIEWER_MODE) hideOverlay();
  return jumpToLocationTarget({ kind: "dir", node: WS.root });
}

// Move the whole view to a folder or portal, "located at" it -- the preview
// shows the item, the file pane sits in its parent (makeLocationState).
// `freshGrid`: a jump that is not a return (the random jumps) lands on a grid
// at its top with the first card selected, never at whatever scroll that grid
// was last left at.
function jumpToLocationTarget(target, { freshGrid = false } = {}) {
  if (!target || !WS.root) return false;
  const isRoot = target.kind === "dir" && target.node === WS.root;
  const state = isRoot ? makeRootLocationState() : makeLocationState(target);
  if (freshGrid && target.kind === "dir" && target.node) {
    const key = previewScrollKeyForDir(target.node);
    if (key && WS.view.previewScrollByDir instanceof Map)
      WS.view.previewScrollByDir.delete(key);
  }
  const moved = restoreViewerCloseState(state, { restorePreviewForAnyPane: true });
  if (moved) maybeQuickNavigateIntoJumpedFolder(target);
  if (moved && freshGrid && WS.preview?.kind === "dir") showFreshPreviewGridTop();
  return moved;
}

function showFreshPreviewGridTop() {
  resetPreviewPaneForEnteredTarget();
  ensurePreviewSelectionForCurrentTarget(true);
  updatePreviewSelectionClasses();
  scheduleThumbnailDemandRefresh();
}

/* Previous / next folder in root (Cmd+Shift+W / Cmd+Shift+S, hard-coded).
   Steps between the folders sitting directly in the library root, whatever
   depth you are browsing at: the current one is the root-level folder that
   holds the location, and the jump lands at its neighbour exactly as Jump to...
   does (same list, same order, same quick-navigation dive). Ends clamp.

   Cmd+Shift+W is also the native "Close Grok / Claude / Variations" menu key.
   With none of those up, Rust hands the press back here (source "native"), so
   depending on which side sees the key first it can arrive twice; a press from
   the other source inside that window is the same press. */
const ROOT_FOLDER_STEP_DUPLICATE_MS = 250;
let ROOT_FOLDER_STEP_LAST = { source: "", at: 0 };

function rootLevelFolderForNode(node) {
  let cur = node || null;
  while (cur && cur.parent && cur.parent !== WS.root) cur = cur.parent;
  return cur && cur.parent === WS.root ? cur : null;
}

function stepRootFolder(direction, source = "key") {
  if (!WS.root) return false;
  const now = performance.now();
  if (
    ROOT_FOLDER_STEP_LAST.source &&
    ROOT_FOLDER_STEP_LAST.source !== source &&
    now - ROOT_FOLDER_STEP_LAST.at < ROOT_FOLDER_STEP_DUPLICATE_MS
  )
    return false;
  ROOT_FOLDER_STEP_LAST = { source, at: now };
  const folders = appMenuJumpChildTargets({ kind: "dir", node: WS.root }).filter(
    (t) => t && t.kind === "dir" && t.node && t.node.parent === WS.root,
  );
  if (!folders.length) return false;
  const location = previewLocationDirNode();
  const current =
    rootLevelFolderForNode(location && !location._skipTagFilters ? location : null) ||
    rootLevelFolderForNode(WS.nav.dirNode);
  const idx = current ? folders.findIndex((t) => t.node === current) : -1;
  const next =
    idx < 0
      ? direction < 0 ? folders.length - 1 : 0
      : Math.max(0, Math.min(folders.length - 1, idx + (direction < 0 ? -1 : 1)));
  if (idx === next) return false;
  if (VIEWER_MODE) hideOverlay();
  return jumpToLocationTarget(folders[next]);
}

window.__lgStepRootFolder = (direction) => stepRootFolder(direction, "native");

/* A jump lands *at* a folder -- the preview shows it, exactly as if you had
   arrowed onto it in the grid -- so with quick navigation on, a media-only
   folder has to do here what it does everywhere else: dive in, first file
   selected, sidebars closed.

   The return path needs no special case, because
   enterMediaFolderWithQuickNavigation captures its bridge from the view it is
   called in, and that view is the one the jump just built. Closing therefore
   comes back to the jumped-to location rather than to wherever the menu was
   opened from. */
function maybeQuickNavigateIntoJumpedFolder(target) {
  if (!target || target.kind !== "dir") return;
  const node = target.node;
  if (!node || node === WS.root || node._skipTagFilters) return;
  if (!quickNavigationEnabled()) return;
  const dive = () => {
    if (WS.nav.dirNode === node) return;
    if (!dirNodeIsMediaOnlyForQuickNavigation(node)) return;
    enterMediaFolderWithQuickNavigation(node);
  };
  // A folder the catalog has not hydrated yet reports no children at all, so it
  // would look media-less and quietly skip the dive.
  if (WS.catalog && WS.catalog.enabled && node.loadState !== "loaded") {
    ensureDirectoryHydratedForOpen(node, { label: "Opening folder..." })
      .then((loaded) => {
        if (loaded) dive();
      })
      .catch(() => {});
    return;
  }
  dive();
}

// The open Jump panel, if there is one. Found by its marker rather than the
// option walker, which sees no options inside it.
function appMenuActiveJumpPanelHost(menu) {
  const openSubs = Array.from(
    menu?.querySelectorAll?.(".dropdownMenuSubmenu.submenuOpen") || [],
  );
  for (const sub of openSubs) {
    const panel = sub.querySelector(":scope > .dropdownMenuSubmenuPanel");
    if (panel && panel.querySelector(":scope > .appMenuJumpPanel")) return panel;
  }
  return null;
}

// Handle a key for an open Jump panel. Returns true when it owned the key.
// Called from the app-menu keydown handler, which has already preventDefault'd
// and stopped the event.
function handleAppMenuJumpKey(menu, action, e) {
  const host = appMenuActiveJumpPanelHost(menu);
  if (!host) return false;
  const panel = host.querySelector(":scope > .appMenuJumpPanel");
  const stack = ensureAppMenuJumpStack();
  if (!panel || !stack) return true;
  const level = stack[stack.length - 1];
  const items = Array.isArray(level.items) ? level.items : [];
  const redraw = () => {
    renderAppMenuJumpPanel(panel);
    if (menu.id === "appActionMenu") positionActionMenuInPreviewDock(menu);
  };
  switch (action) {
    case "selectUp":
    case "selectDown": {
      // Deliberately clamped rather than wrapped: a tree is a list you read from
      // top to bottom, and looping past the end of one level in a chain of them
      // loses your place.
      if (!items.length) return true;
      const delta = action === "selectUp" ? -1 : 1;
      const next = Math.max(0, Math.min(items.length - 1, level.index + delta));
      if (next === level.index) return true;
      level.index = next;
      redraw();
      return true;
    }
    case "selectRight": {
      const target = items[level.index];
      if (!target) return true;
      // A folder with nothing in it gets no column of its own: opening it takes
      // you there, rather than showing you an empty list to back out of.
      const children = appMenuJumpChildTargets(target);
      if (!children.length) {
        if (e.repeat) return true;
        allowMenuClose();
        closeAppMenu();
        jumpToLocationTarget(target);
        return true;
      }
      stack.push({ target, items: children, index: 0 });
      redraw();
      return true;
    }
    case "selectLeft":
    case "leaveDir": {
      if (stack.length > 1) {
        stack.pop();
        redraw();
        return true;
      }
      // At the top of the tree, step back out to the app menu's own list. The
      // generic collapse skips a panel with no options, so close it by hand --
      // the same thing the Calendar panel has to do.
      const sub = host.closest(".dropdownMenuSubmenu");
      const trigger = sub?.querySelector(":scope > .dropdownMenuSubmenuTrigger");
      if (sub) setDropdownSubmenuOpen(sub, false);
      if (trigger) setMenuHighlight(menu, trigger);
      if (menu.id === "appActionMenu") positionActionMenuInPreviewDock(menu);
      return true;
    }
    case "enterDir":
    case "openAppMenu": {
      if (e.repeat) return true;
      // Only level 0 can be empty now (an empty library), and its container is
      // the root -- so there is still somewhere to go.
      const target = items[level.index] || level.target;
      if (!target) return true;
      allowMenuClose();
      closeAppMenu();
      jumpToLocationTarget(target);
      return true;
    }
    default:
      // Swallow anything else while the tree owns the menu.
      return true;
  }
}
