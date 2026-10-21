/* Menu core
   Menu auto-close, bulk selection, folder history and positioning menus. */

// ---------------------------------------------------------------------------
// Auto-close suppression
//
// Changing a setting from the app or an item menu must never close that menu.
// Too many option handlers reach closeActionMenus() / closeTagContextMenu() /
// closeAppMenu() through nested render paths (and several do it asynchronously)
// to police each one, so activation instead opens a short window during which
// every close is ignored. Only a deliberate user gesture — the exit key, Escape,
// stepping left off the top level, re-toggling the menu button, or clicking
// outside — calls allowMenuClose() to drop the window and close for real.
// ---------------------------------------------------------------------------

let MENU_AUTO_CLOSE_SUPPRESSED_UNTIL = 0;

function suppressMenuAutoClose(ms = 1200) {
  MENU_AUTO_CLOSE_SUPPRESSED_UNTIL = performance.now() + Math.max(0, ms);
}

function allowMenuClose() {
  MENU_AUTO_CLOSE_SUPPRESSED_UNTIL = 0;
}

function menuAutoCloseSuppressed() {
  return performance.now() < MENU_AUTO_CLOSE_SUPPRESSED_UNTIL;
}

function closeActionMenus() {
  if (menuAutoCloseSuppressed()) return;
  WS.view.bulkActionMenuOpen = false;
  WS.view.bulkActionMenuAnchorPath = "";
  WS.view.bulkActionMenuPoint = null;
  WS.view.dirActionMenuPath = "";
  WS.view.fileActionMenuId = "";
  closeTagContextMenu();
  closePreviewContextMenu();
  closeAppMenu();
  closeScoreHistoryDayMenu();
}

function openBulkActionMenuForSelection(anchorKey, opts = null) {
  const key = String(anchorKey || "");
  if (!key) return false;
  if (!WS.view.bulkSelectMode) return false;
  const selectedDirs = getSelectedPathsInCurrentDir();
  const selectedTags = getSelectedTagFolderKeysInCurrentView();
  const selCount =
    selectedDirs.length +
    selectedTags.length +
    getSelectedFileIdsInCurrentView().length;
  if (!selCount) return false;
  const point =
    opts &&
    Number.isFinite(Number(opts.x)) &&
    Number.isFinite(Number(opts.y))
      ? { x: Number(opts.x), y: Number(opts.y) }
      : null;
  const anchorCard = findPreviewSelectableCardByKey(key);
  const anchorKind = String(anchorCard?.dataset?.previewItemKind || "");
  if (
    anchorKind === "dir" ||
    key.startsWith("dir:") ||
    key.startsWith("expanded-dir:")
  ) {
    const p = previewDirPathForCard(anchorCard) || previewDirPathForSelectionKey(key);
    if (!selectedDirs.includes(p)) return false;
  } else if (anchorKind === "tag" || key.startsWith("tag:")) {
    const tagKey =
      previewTagFolderKeyForCard(anchorCard) ||
      (key.startsWith("tag:") ? key.slice(4) : "");
    if (!selectedTags.includes(tagKey)) return false;
  } else if (anchorKind === "file" || key.startsWith("file:")) {
    const fileId =
      previewFileIdForCard(anchorCard) ||
      (key.startsWith("file:") ? key.slice(5) : "");
    if (!getSelectedFileIdsInCurrentView().includes(fileId)) return false;
  } else {
    return false;
  }

  // Use the same fixed popup builders for file-pane and preview-pane bulk
  // selections. This keeps numbering, nested overrides, and inverse actions
  // identical no matter which pane owns the selection.
  const anchor =
    findDirMenuButtonForAnchorKey(key) || anchorCard;
  const popupOptions = point
    ? { x: point.x, y: point.y }
    : anchor
      ? { anchor }
      : {};
  if (
    anchorKind === "dir" ||
    key.startsWith("dir:") ||
    key.startsWith("expanded-dir:")
  ) {
    const anchorPath =
      previewDirPathForCard(anchorCard) || previewDirPathForSelectionKey(key);
    if (
      previewActionMenuEl?.classList.contains("open") &&
      PREVIEW_CONTEXT_MENU_STATE?.bulkPaths &&
      String(PREVIEW_CONTEXT_MENU_STATE.dirPath || "") === anchorPath
    ) {
      closePreviewContextMenu();
      return true;
    }
    openPreviewBulkFolderActionMenu(selectedDirs, anchorPath, popupOptions);
    return true;
  }
  if (anchorKind === "tag" || key.startsWith("tag:")) {
    const selectedEntries = getSelectedTagEntriesInCurrentView();
    if (!selectedEntries.length) return false;
    const tagKey =
      previewTagFolderKeyForCard(anchorCard) ||
      (key.startsWith("tag:") ? key.slice(4) : "");
    if (
      previewActionMenuEl?.classList.contains("open") &&
      PREVIEW_CONTEXT_MENU_STATE?.bulkTagKeys &&
      String(PREVIEW_CONTEXT_MENU_STATE.tagKey || "") === tagKey
    ) {
      closePreviewContextMenu();
      return true;
    }
    openPreviewBulkTagActionMenu(selectedEntries, tagKey, popupOptions);
    return true;
  }
  if (anchorKind === "file" || key.startsWith("file:")) {
    const anchorFileId =
      previewFileIdForCard(anchorCard) ||
      (key.startsWith("file:") ? key.slice(5) : "");
    if (
      previewActionMenuEl?.classList.contains("open") &&
      PREVIEW_CONTEXT_MENU_STATE?.bulkFileIds &&
      String(PREVIEW_CONTEXT_MENU_STATE.fileId || "") === anchorFileId
    ) {
      closePreviewContextMenu();
      return true;
    }
    openPreviewBulkFileActionMenu(
      getSelectedFileIdsInCurrentView(),
      anchorFileId,
      popupOptions,
    );
    return true;
  }

  return false;
}

function openDirMenuForPath(path) {
  if (separateItemMenuDisabled()) return;
  allowMenuClose();
  const p = String(path || "");
  const isRootPath = p === "" && !!WS.root;
  if (
    !isRootPath &&
    p === INTERNAL_TRASH_DIR_NAME &&
    WS.nav.dirNode === WS.root
  ) {
    return;
  }
  if (!p && !isRootPath) return;
  if (!isRootPath && openBulkActionMenuForSelection(`dir:${p}`)) return;
  WS.view.bulkActionMenuOpen = false;
  WS.view.dirActionMenuPath = isRootPath ? "__root__" : p;
  WS.view.fileActionMenuId = "";
  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  clearBulkTagPlaceholder();

  renderDirectoriesPane(true);
  syncButtons();
}

function openFileMenuForId(fileId) {
  if (separateItemMenuDisabled()) return;
  allowMenuClose();
  const id = String(fileId || "");
  if (!id) return;
  if (fileRecordHasNoItemMenu(WS.fileById.get(id))) return;
  if (openBulkActionMenuForSelection(`file:${id}`)) return;
  WS.view.bulkActionMenuOpen = false;
  WS.view.dirActionMenuPath = "";
  WS.view.fileActionMenuId = id;
  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  RENAME_EDIT_FILE_ID = null;
  clearBulkTagPlaceholder();

  renderDirectoriesPane(true);
  syncButtons();
}

async function runFileActionFromMenu(action, fileId, rowEl = null) {
  const id = String(fileId || "");
  if (!id || !action) return false;

  if (action === "loose-set-merge") {
    if (!WS.meta.fsRootHandle) {
      showStatusMessage("Loose Set Merge requires a writable folder.");
      return true;
    }
    await looseSetMergeSelectedFiles();
    return true;
  }

  const rec = WS.fileById.get(id);
  if (!rec) {
    showStatusMessage("Selected file is unavailable.");
    return true;
  }

  if (action === "put-back") {
    const trashTargetPath = trashTopLevelItemPathForFileRecord(rec);
    if (!trashTargetPath) return true;
    await putBackTrashFolderPaths([trashTargetPath]);
    return true;
  }

  if (action === "rename-file") {
    if (!WS.meta.fsRootHandle) {
      showStatusMessage("Renaming files requires a writable folder.");
      return true;
    }
    if (
      !rowEl &&
      WS.view?.activePane === "preview" &&
      startPreviewFileRenameEdit(id)
    ) {
      return true;
    }
    RENAME_EDIT_FILE_ID = id;
    RENAME_EDIT_PATH = null;
    TAG_EDIT_PATH = null;
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    focusSelectedDirectoryInlineInput(".renameEditInput");
    return true;
  }

  if (action === "edit-thumbnail") {
    openThumbnailCropEditor(rec);
    return true;
  }

  const folderThumbnailTarget = parseFolderThumbnailAction(action);
  if (folderThumbnailTarget !== null) {
    setFolderThumbnailTargetFromRecord(rec, folderThumbnailTarget);
    return true;
  }

  const tagThumbnailTarget = parseTagThumbnailAction(action);
  if (tagThumbnailTarget) {
    setTagThumbnailFromRecordByKey(rec, tagThumbnailTarget);
    return true;
  }

  return false;
}

function entryKeyForSelection(entry) {
  if (!entry) return "";
  if (entry.kind === "dir") return `dir:${String(entry.node?.path || "")}`;
  if (entry.kind === "file") return `file:${String(entry.id || "")}`;
  if (entry.kind === "tag") return `tag:${tagEntrySelectionKey(entry)}`;
  return "";
}

function findEntryIndexByKey(key) {
  if (!key) return -1;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (entryKeyForSelection(entry) === key) return i;
  }
  return -1;
}

function toggleEntrySelection(entry) {
  if (!entry) return;
  if (entry.kind === "dir") {
    const p = String(entry.node?.path || "");
    if (!p) return;
    if (WS.view.bulkTagSelectedPaths.has(p))
      WS.view.bulkTagSelectedPaths.delete(p);
    else WS.view.bulkTagSelectedPaths.add(p);
  } else if (entry.kind === "tag") {
    const key = tagEntrySelectionKey(entry);
    if (!key) return;
    if (WS.view.bulkTagFolderSelectedKeys.has(key))
      WS.view.bulkTagFolderSelectedKeys.delete(key);
    else WS.view.bulkTagFolderSelectedKeys.add(key);
  } else if (entry.kind === "file") {
    const id = String(entry.id || "");
    if (!id) return;
    if (WS.view.bulkFileSelectedIds.has(id))
      WS.view.bulkFileSelectedIds.delete(id);
    else WS.view.bulkFileSelectedIds.add(id);
  }
}

function addEntrySelection(entry) {
  if (!entry) return;
  if (entry.kind === "dir") {
    const p = String(entry.node?.path || "");
    if (p) WS.view.bulkTagSelectedPaths.add(p);
  } else if (entry.kind === "tag") {
    const key = tagEntrySelectionKey(entry);
    if (key) WS.view.bulkTagFolderSelectedKeys.add(key);
  } else if (entry.kind === "file") {
    const id = String(entry.id || "");
    if (id) WS.view.bulkFileSelectedIds.add(id);
  }
}

function togglePreviewCardBulkSelection(card) {
  if (!card) return;
  const kind = String(card.dataset.previewItemKind || "");
  const key = String(card.dataset.previewItemKey || "");
  if (kind === "dir") {
    const p = previewDirPathForCard(card);
    if (!p) return;
    if (WS.view.bulkTagSelectedPaths.has(p))
      WS.view.bulkTagSelectedPaths.delete(p);
    else WS.view.bulkTagSelectedPaths.add(p);
  } else if (kind === "file") {
    const id = previewFileIdForCard(card);
    if (!id) return;
    if (WS.view.bulkFileSelectedIds.has(id))
      WS.view.bulkFileSelectedIds.delete(id);
    else WS.view.bulkFileSelectedIds.add(id);
  } else if (kind === "tag") {
    const tagKey = previewTagFolderKeyForCard(card);
    if (!tagKey) return;
    if (WS.view.bulkTagFolderSelectedKeys.has(tagKey))
      WS.view.bulkTagFolderSelectedKeys.delete(tagKey);
    else WS.view.bulkTagFolderSelectedKeys.add(tagKey);
  }
}

function addPreviewCardBulkSelection(card) {
  if (!card) return;
  const kind = String(card.dataset.previewItemKind || "");
  const key = String(card.dataset.previewItemKey || "");
  if (kind === "dir") {
    const p = previewDirPathForCard(card);
    if (p) WS.view.bulkTagSelectedPaths.add(p);
  } else if (kind === "file") {
    const id = previewFileIdForCard(card);
    if (id) WS.view.bulkFileSelectedIds.add(id);
  } else if (kind === "tag") {
    const tagKey = previewTagFolderKeyForCard(card);
    if (tagKey) WS.view.bulkTagFolderSelectedKeys.add(tagKey);
  }
}

function addPreviewSelectionRange(anchorKey, targetKey, clearExisting = false) {
  const cards = getPreviewSelectableCards();
  if (!cards.length) return;
  let anchorIdx = -1;
  let targetIdx = -1;
  for (let i = 0; i < cards.length; i++) {
    const key = String(cards[i]?.dataset?.previewItemKey || "");
    if (key === anchorKey) anchorIdx = i;
    if (key === targetKey) targetIdx = i;
  }
  if (anchorIdx < 0 || targetIdx < 0) return;
  if (clearExisting) clearBulkTagSelection();
  WS.view.bulkSelectMode = true;
  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  for (let i = start; i <= end; i++) {
    addPreviewCardBulkSelection(cards[i]);
  }
}

function refreshBulkSelectionUiFromPreview() {
  renderDirectoriesPane(true);
  updatePreviewSelectionClasses();
  syncButtons();
}

function includeCurrentSelectionInBulkSet(excludeIndex = -1) {
  const curIdx = Number(WS.nav.selectedIndex);
  if (!Number.isFinite(curIdx) || curIdx < 0 || curIdx >= WS.nav.entries.length)
    return;
  if (curIdx === Number(excludeIndex)) return;
  const current = WS.nav.entries[curIdx];
  if (!current || !isSelectableEntry(current)) return;
  addEntrySelection(current);
}

function selectEntryRange(anchorIdx, targetIdx) {
  addEntrySelectionRange(anchorIdx, targetIdx, true);
}

function addEntrySelectionRange(anchorIdx, targetIdx, clearExisting = false) {
  if (anchorIdx < 0 || targetIdx < 0) return;
  const start = Math.min(anchorIdx, targetIdx);
  const end = Math.max(anchorIdx, targetIdx);
  if (clearExisting) clearBulkTagSelection();
  WS.view.bulkSelectMode = true;
  for (let i = start; i <= end; i++) {
    const entry = WS.nav.entries[i];
    if (!entry || !isSelectableEntry(entry)) continue;
    addEntrySelection(entry);
  }
}

function canTrackDirHistory() {
  if (!WS.root) return false;
  if (!WS.nav.dirNode) return false;
  if (searchResultsVisibleInDirectoriesPane()) return false;
  if (WS.view.favoritesMode || WS.view.hiddenMode) return false;
  return true;
}

function recordDirHistory() {
  if (!canTrackDirHistory()) return;
  const path = String(WS.nav.dirNode?.path || "");
  const aboveRoot = !!WS.view.aboveRootView;
  const selectedKey = entryKeyForSelection(
    WS.nav.entries[WS.nav.selectedIndex] || null,
  );
  const cur = WS.view.dirHistory[WS.view.dirHistoryIndex] || null;
  if (cur && cur.path === path && !!cur.aboveRoot === aboveRoot) {
    cur.selectedKey = selectedKey;
    return;
  }
  if (WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1) {
    WS.view.dirHistory = WS.view.dirHistory.slice(
      0,
      WS.view.dirHistoryIndex + 1,
    );
  }
  WS.view.dirHistory.push({ path, aboveRoot, selectedKey });
  WS.view.dirHistoryIndex = WS.view.dirHistory.length - 1;
}

function initDirHistory() {
  WS.view.dirHistory = [];
  WS.view.dirHistoryIndex = -1;
  if (!WS.root || !WS.nav.dirNode) return;
  const path = String(WS.nav.dirNode?.path || "");
  const selectedKey = entryKeyForSelection(
    WS.nav.entries[WS.nav.selectedIndex] || null,
  );
  WS.view.dirHistory.push({
    path,
    aboveRoot: !!WS.view.aboveRootView,
    selectedKey,
  });
  WS.view.dirHistoryIndex = 0;
}

async function restoreDirHistoryEntry(entry) {
  if (!entry || !WS.root) return;
  clearTagNavigationStack();
  WS.view.tagFolderActiveMode = "";
  WS.view.tagFolderActiveTag = "";
  WS.view.tagFolderActiveAlbum = "";
  WS.view.tagFolderOriginPath = "";
  const node = WS.dirByPath.get(String(entry.path || "")) || WS.root;
  WS.nav.dirNode = node;
  WS.view.aboveRootView =
    !!entry.aboveRoot && node === WS.root && showRootViewEnabled();
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  const idx = findEntryIndexByKey(String(entry.selectedKey || ""));
  WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
  syncPreviewToSelection({ force: true });
  await finalizeDirectoryNavigationRender({
    animatePreview: false,
    keepDirectoriesScroll: true,
    keepPreviewScroll: true,
  });
}

function itemMenuAnchorElement(anchor) {
  if (!anchor || !anchor.closest) return anchor || null;
  return (
    anchor.closest(
      "[data-preview-item-key], .dirRow, .folderCard, .fileCard",
    ) || anchor
  );
}

/* Experimental -> Sidebar settings menu. The app menu (Tab), not the select
   menu, becomes a full-height sidebar sliding in from the left edge, and
   #app makes room for it (`#app.appMenuSidebarOpen`, padding the width of the
   sidebar) rather than being covered. Only where it is drawn changes: the
   menu, its rows and its keys are the same element and code either way.

   Closing slides it back out. closeAppMenu would empty the menu at once, so
   in the sidebar it leaves the rows in place for the slide
   (`appMenuSidebarClosing` keeps a closed menu drawn) and empties it once the
   slide is over; opening again before then cancels that and slides back in
   from wherever it got to. */
const APP_MENU_SIDEBAR_SLIDE_MS = 300;
let APP_MENU_SIDEBAR_CLEAR_TIMER = 0;
let APP_MENU_SIDEBAR_RESIZE = null;

/* The sidebar is a fixed width except while Jump to... is open, when it grows
   with its columns; #app is padded by whatever width it actually has. */
function watchAppMenuSidebarWidth(menuEl, on) {
  const appEl = document.getElementById("app");
  if (!on) {
    APP_MENU_SIDEBAR_RESIZE?.disconnect();
    APP_MENU_SIDEBAR_RESIZE = null;
    appEl?.style?.removeProperty("--app-menu-sidebar-push");
    return;
  }
  if (APP_MENU_SIDEBAR_RESIZE || typeof ResizeObserver !== "function") return;
  APP_MENU_SIDEBAR_RESIZE = new ResizeObserver(() => {
    if (!menuEl.classList.contains("appMenuSidebar")) return;
    appEl?.style?.setProperty("--app-menu-sidebar-push", `${Math.round(menuEl.offsetWidth)}px`);
  });
  APP_MENU_SIDEBAR_RESIZE.observe(menuEl);
}

function appMenuSidebarEnabled(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return !!(src && src.appMenuSidebar === true);
}

function appMenuShowsAsSidebar() {
  return appMenuSidebarEnabled() && !appMenuModeIsSelect();
}

function cancelAppMenuSidebarClose() {
  if (APP_MENU_SIDEBAR_CLEAR_TIMER) clearTimeout(APP_MENU_SIDEBAR_CLEAR_TIMER);
  APP_MENU_SIDEBAR_CLEAR_TIMER = 0;
  appActionMenuEl?.classList?.remove("appMenuSidebarClosing");
}

function syncAppMenuSidebar(menuEl, on) {
  const appEl = document.getElementById("app");
  if (!on) {
    cancelAppMenuSidebarClose();
    watchAppMenuSidebarWidth(menuEl, false);
    menuEl.classList.remove("appMenuSidebar", "appMenuSidebarShown");
    appEl?.classList?.remove("appMenuSidebarOpen");
    return;
  }
  cancelAppMenuSidebarClose();
  watchAppMenuSidebarWidth(menuEl, true);
  const arriving = !menuEl.classList.contains("appMenuSidebar");
  menuEl.classList.add("appMenuSidebar");
  menuEl.style.left = "";
  menuEl.style.top = "";
  appEl?.classList?.add("appMenuSidebarOpen");
  if (!menuEl.classList.contains("appMenuSidebarShown")) {
    // Lay it out off-screen first, so adding the class slides it in. A menu
    // already on screen (the switch turned on from inside it) would otherwise
    // animate *to* off-screen in that same step and barely move.
    if (arriving) menuEl.style.transition = "none";
    menuEl.getBoundingClientRect();
    menuEl.style.transition = "";
    menuEl.getBoundingClientRect();
    menuEl.classList.add("appMenuSidebarShown");
  }
}

// Called by closeAppMenu before it empties the menu. True when the menu was
// in the sidebar and is now sliding out (and will be emptied after).
function slideAppMenuSidebarOut(menuEl) {
  if (!menuEl?.classList?.contains("appMenuSidebar")) return false;
  watchAppMenuSidebarWidth(menuEl, false);
  document.getElementById("app")?.classList?.remove("appMenuSidebarOpen");
  if (!menuEl.classList.contains("open")) return false;
  cancelAppMenuSidebarClose();
  menuEl.classList.add("appMenuSidebarClosing");
  menuEl.classList.remove("appMenuSidebarShown");
  APP_MENU_SIDEBAR_CLEAR_TIMER = setTimeout(() => {
    APP_MENU_SIDEBAR_CLEAR_TIMER = 0;
    if (menuEl.classList.contains("open")) return;
    menuEl.classList.remove("appMenuSidebarClosing", "appMenuSidebar", "fixed");
    menuEl.innerHTML = "";
  }, APP_MENU_SIDEBAR_SLIDE_MS);
  return true;
}

function positionActionMenuInPreviewDock(menuEl, opts = {}) {
  if (!menuEl) return;
  if (isNumberedItemMenu(menuEl)) decorateNumberedMenuOptions(menuEl);
  const isAppMenu = menuEl.id === "appActionMenu";
  if (isAppMenu) {
    menuEl.classList.add("appMenuDrillDown");
    syncAppMenuDrillHeader(menuEl);
    const sidebar = appMenuShowsAsSidebar();
    syncAppMenuSidebar(menuEl, sidebar);
    if (sidebar) {
      menuEl.classList.add("fixed");
      APP_MENU_DOCK_POS = { left: 0, top: 0 };
      ensureMenuHighlight(menuEl);
      return;
    }
  }
  menuEl.classList.add("fixed");
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  menuEl.style.right = "auto";

  const menuRect = menuEl.getBoundingClientRect();
  const edge = 4;
  const gap = 8;

  const clampToViewport = (l, t) => {
    l = Math.max(edge, Math.min(l, window.innerWidth - menuRect.width - edge));
    t = Math.max(edge, Math.min(t, window.innerHeight - menuRect.height - edge));
    return [l, t];
  };

  // The app menu is docked once, at open time, and then held there through every
  // in-place rebuild. Reusing the stored corner (re-clamped to the current menu
  // size) keeps it from jumping when an activated option detaches its anchor.
  if (isAppMenu && !opts.reanchor && APP_MENU_DOCK_POS) {
    const [l, t] = clampToViewport(APP_MENU_DOCK_POS.left, APP_MENU_DOCK_POS.top);
    menuEl.style.left = `${l}px`;
    menuEl.style.top = `${t}px`;
    ensureMenuHighlight(menuEl);
    return;
  }

  /* Prefer the anchor the menu was opened on, then the live selection, then
     the first card in the grid.

     Each candidate is *measured* before it is accepted. A detached node still
     answers `getBoundingClientRect()` -- with an all-zero rect -- so taking
     the first truthy candidate is not the same as taking the first usable one,
     and the stored anchor is detached far more often than it looks: any option
     that re-renders the preview pane replaces the card the menu was opened on,
     and every rebuild after that measured zero and dropped the menu into the
     pane's top-left corner. The re-render puts an equivalent card back for the
     same item, so the second candidate is the same place on screen -- the menu
     stays where it was opened instead of teleporting. */
  const anchorCandidates = [
    isAppMenu ? APP_MENU_STATE?.anchor : null,
    selectedItemMenuAnchor(),
    previewBodyEl?.querySelector?.(
      ".folderCard, .fileCard, [data-preview-item-key]",
    ),
  ];
  let anchorEl = null;
  let cardRect = null;
  for (const candidate of anchorCandidates) {
    if (!candidate || typeof candidate.getBoundingClientRect !== "function")
      continue;
    if (candidate.isConnected === false) continue;
    const rect = candidate.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) continue;
    anchorEl = candidate;
    cardRect = rect;
    break;
  }
  // Re-point the stored anchor at whatever is actually on screen, so the next
  // rebuild starts from a live node rather than walking the list again.
  if (isAppMenu && anchorEl && APP_MENU_STATE) APP_MENU_STATE.anchor = anchorEl;

  /* A fixed placement short-circuits the anchor entirely: the app menu goes to
     a corner, an edge or the middle of the window, and the item it was opened
     from is irrelevant. The select menu always uses the item, whatever this
     says -- it is about that item. */
  const placement = isAppMenu && !appMenuModeIsSelect()
    ? getAppMenuPlacementFromOptions()
    : "item";
  if (placement !== "item") {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const midL = (w - menuRect.width) / 2;
    const midT = (h - menuRect.height) / 2;
    const rightL = w - menuRect.width - edge - gap;
    const botT = h - menuRect.height - edge - gap;
    const spots = {
      center: [midL, midT],
      "top-left": [edge + gap, edge + gap],
      "top-right": [rightL, edge + gap],
      "bottom-left": [edge + gap, botT],
      "bottom-right": [rightL, botT],
      left: [edge + gap, midT],
      right: [rightL, midT],
    };
    const [pl, pt] = spots[placement] || spots.center;
    const [cl, ct] = clampToViewport(pl, pt);
    if (isAppMenu) APP_MENU_DOCK_POS = { left: cl, top: ct };
    menuEl.style.left = `${cl}px`;
    menuEl.style.top = `${ct}px`;
    ensureMenuHighlight(menuEl);
    return;
  }

  let left;
  let top;
  if (cardRect) {
    /* Both offsets come from the Select Menu cyclers. The side offset is added to
       the gap on whichever side the menu ends up on, so "further" means
       further from the item rather than further right -- it has to flip with
       the menu, or opening on the left edge of the window would push it
       *into* the card. */
    const sideOffset = appMenuDistanceOffsetPx();
    if (appMenuCentersOnItem()) {
      top = cardRect.top + cardRect.height / 2 - menuRect.height / 2;
    } else {
      // Top edge of the menu, relative to the top edge of the thumbnail.
      top = cardRect.top - appMenuHeightOffsetPx();
    }
    // Prefer the right side of the item; fall back to the left if it would
    // overflow the viewport.
    const rightLeft = cardRect.right + gap + sideOffset;
    const leftLeft = cardRect.left - menuRect.width - gap - sideOffset;
    if (rightLeft + menuRect.width <= window.innerWidth - edge) {
      left = rightLeft;
    } else if (leftLeft >= edge) {
      left = leftLeft;
    } else {
      // Neither side fits fully — pick whichever side has more room.
      const roomRight = window.innerWidth - edge - rightLeft;
      const roomLeft = cardRect.left - edge;
      left = roomRight >= roomLeft ? rightLeft : leftLeft;
    }
  } else {
    const paneRect = previewPane?.getBoundingClientRect?.() || {
      left: 0,
      top: 0,
    };
    left = (paneRect.left || 0) + 14;
    top = (paneRect.top || 0) + 14;
  }

  [left, top] = clampToViewport(left, top);

  // Remember where the app menu landed so later rebuilds reuse this corner
  // instead of re-anchoring (and possibly jumping) each time.
  if (isAppMenu) APP_MENU_DOCK_POS = { left, top };

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
  ensureMenuHighlight(menuEl);
}

// Non-interactive level label shown while drilled into an app-menu section.
function syncAppMenuDrillHeader(menu) {
  if (!menu || menu.id !== "appActionMenu") return;
  const openSubs = Array.from(
    menu.querySelectorAll(".dropdownMenuSubmenu.submenuOpen"),
  );
  // Deepest open submenu by nesting depth.
  let deepest = null;
  let deepestDepth = -1;
  for (const sub of openSubs) {
    let depth = 0;
    let cur = sub;
    while ((cur = cur.parentElement)) {
      if (cur.classList?.contains("dropdownMenuSubmenu")) depth++;
    }
    if (depth > deepestDepth) {
      deepestDepth = depth;
      deepest = sub;
    }
  }
  let header = menu.querySelector(":scope > .appMenuDrillHeader");
  if (!deepest) {
    if (header) header.remove();
    return;
  }
  const trigger = deepest.querySelector(
    ":scope > .dropdownMenuSubmenuTrigger",
  );
  // Prefer the text label, stripping any caret/icon chrome.
  let label = "";
  if (trigger) {
    const labelEl =
      trigger.querySelector(".dropdownMenuSubmenuLabelWithIcon span:last-child") ||
      trigger.querySelector("span:not(.dropdownMenuSubmenuCaret):not(.dropdownMenuNum)");
    label = String(
      (labelEl && labelEl.textContent) || trigger.textContent || "",
    )
      .replace(/\s+/g, " ")
      .trim();
  }
  if (!label) {
    if (header) header.remove();
    return;
  }
  if (!header) {
    header = document.createElement("div");
    header.className = "appMenuDrillHeader";
    header.setAttribute("aria-hidden", "true");
    menu.insertBefore(header, menu.firstChild);
  }
  header.textContent = label;
}

function positionDropdownMenu(menuBtn, menuEl) {
  if (!menuBtn || !menuEl) return;
  if (isNumberedItemMenu(menuEl)) {
    positionActionMenuInPreviewDock(menuEl);
    return;
  }
  menuEl.classList.add("fixed");
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  menuEl.style.right = "auto";

  const btnRect = menuBtn.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();

  let left = btnRect.right - menuRect.width;
  if (left < 8) left = 8;
  if (left + menuRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuRect.width - 8);
  }

  let top = btnRect.bottom + 4;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = btnRect.top - 4 - menuRect.height;
  }
  if (top < 8) top = 8;

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function positionDropdownMenuAtPoint(menuEl, x, y) {
  if (!menuEl) return;
  if (isNumberedItemMenu(menuEl)) {
    decorateNumberedMenuOptions(menuEl);
    ensureMenuHighlight(menuEl);
  }
  menuEl.classList.add("fixed");
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  menuEl.style.right = "auto";

  const menuRect = menuEl.getBoundingClientRect();
  let left = x;
  let top = y;

  if (left + menuRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuRect.width - 8);
  }
  if (top + menuRect.height > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - menuRect.height - 8);
  }

  left = Math.max(8, left);
  top = Math.max(8, top);

  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

function positionScoreHistoryDayMenu(anchor, menuEl) {
  if (!anchor || !menuEl) return;
  menuEl.classList.add("fixed");
  menuEl.style.left = "0px";
  menuEl.style.top = "0px";
  menuEl.style.right = "auto";
  menuEl.style.setProperty("--score-history-menu-pointer-left", "50%");

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menuEl.getBoundingClientRect();
  const anchorCenter = anchorRect.left + anchorRect.width / 2;
  let left = anchorCenter - menuRect.width / 2;
  if (left < 8) left = 8;
  if (left + menuRect.width > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuRect.width - 8);
  }

  let top = anchorRect.bottom + 10;
  if (top + menuRect.height > window.innerHeight - 8) {
    top = anchorRect.top - 10 - menuRect.height;
    menuEl.classList.add("aboveAnchor");
  } else {
    menuEl.classList.remove("aboveAnchor");
  }
  if (top < 8) top = 8;

  const pointerLeft = Math.max(
    14,
    Math.min(menuRect.width - 14, anchorCenter - left),
  );
  menuEl.style.setProperty(
    "--score-history-menu-pointer-left",
    `${pointerLeft}px`,
  );
  menuEl.style.left = `${left}px`;
  menuEl.style.top = `${top}px`;
}

async function commitRenameEdit(path, inputEl) {
  if (RENAME_BUSY) return false;
  const dirNode = WS.dirByPath.get(String(path || ""));
  if (!dirNode) {
    RENAME_EDIT_PATH = null;
    renderDirectoriesPane(true);
    return false;
  }
  RENAME_BUSY = true;
  let ok = false;
  try {
    ok = await renameFolderDirNode(dirNode, inputEl.value || "");
  } finally {
    RENAME_BUSY = false;
  }
  if (ok) {
    RENAME_EDIT_PATH = null;
    closeActionMenus();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    return true;
  }
  renderDirectoriesPane(true);
  return false;
}

async function commitFileRenameEdit(fileId, inputEl) {
  if (RENAME_BUSY) return false;
  const rec = WS.fileById.get(String(fileId || ""));
  if (!rec) {
    RENAME_EDIT_FILE_ID = null;
    renderDirectoriesPane(true);
    return false;
  }
  RENAME_BUSY = true;
  let ok = false;
  try {
    ok = await renameSingleFile(rec, inputEl.value || "");
  } finally {
    RENAME_BUSY = false;
  }
  if (ok) {
    RENAME_EDIT_FILE_ID = null;
    closeActionMenus();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
    return true;
  }
  renderDirectoriesPane(true);
  return false;
}

function getDirectoriesWithTag(tag) {
  if (!tag) return [];
  if (!WS.nav.dirNode) return [];
  const children = getChildDirsForNodeBase(WS.nav.dirNode);
  if (!children.length) return [];
  return children.filter((d) => {
    const tags = metaGetUserTags(d.path || "");
    return tags.includes(tag);
  });
}

function gatherTagPathsForDirs(dirs) {
  const seen = new Set();
  const out = [];
  for (const dir of dirs || []) {
    const p = String(dir?.path || "");
    if (!p || seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

function closeTagContextMenu() {
  if (menuAutoCloseSuppressed()) return;
  if (!tagActionMenuEl) return;
  tagActionMenuEl.classList.remove("open", "fixed");
  tagActionMenuEl.innerHTML = "";
  tagActionMenuEl.style.left = "";
  tagActionMenuEl.style.top = "";
  TAG_CONTEXT_MENU_STATE = null;
}

function closePreviewContextMenu() {
  if (menuAutoCloseSuppressed()) return;
  if (!previewActionMenuEl) return;
  previewActionMenuEl.classList.remove("open", "fixed");
  previewActionMenuEl.innerHTML = "";
  previewActionMenuEl.style.left = "";
  previewActionMenuEl.style.top = "";
  PREVIEW_CONTEXT_MENU_STATE = null;
}

function closeAppMenu() {
  if (menuAutoCloseSuppressed()) return;
  if (!appActionMenuEl) return;
  // Closing the menu with a confirm still pending (exit key / Escape / click
  // outside) counts as "No". settleAppMenuConfirm clears the state before it
  // calls closeAppMenu, so this only fires for an un-answered confirm.
  if (APP_MENU_CONFIRM) {
    const c = APP_MENU_CONFIRM;
    APP_MENU_CONFIRM = null;
    try {
      c.resolve(false);
    } catch {}
  }
  if (slideAppMenuSidebarOut(appActionMenuEl)) {
    appActionMenuEl.classList.remove("open");
  } else {
    appActionMenuEl.classList.remove("open", "fixed");
    appActionMenuEl.innerHTML = "";
  }
  appActionMenuEl.style.left = "";
  appActionMenuEl.style.top = "";
  APP_MENU_STATE = null;
  APP_MENU_DOCK_POS = null;
  APP_MENU_FILTER_EDIT_KEY = "";
  APP_MENU_CONTROLS_EDIT_ID = "";
  APP_MENU_CONTROLS_EDIT_BTN = 0;
  APP_MENU_CONTROLS_CAPTURE_ID = "";
  APP_MENU_PRESET_RENAME_STATE = null;
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
}
