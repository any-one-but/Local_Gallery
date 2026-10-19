/* Directory selection
   Building the file pane's entries, its selection, setDir and syncing the
   preview to it. */

function rebuildDirectoriesEntries(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  if (options.invalidateTagEntryCaches) clearTagEntryDerivedCaches();
  const prevEntries = Array.isArray(WS.nav.entries) ? WS.nav.entries : [];
  const prevSelectedIndexRaw = Number(WS.nav.selectedIndex);
  const prevSelectedIndex = Number.isFinite(prevSelectedIndexRaw)
    ? Math.max(0, prevSelectedIndexRaw | 0)
    : 0;
  const prevSelectedEntry = prevEntries[prevSelectedIndex] || null;
  const prevSelectedKey = entryKeyForSelection(prevSelectedEntry);
  const nextEntries = [];
  const finish = () => {
    WS.nav.entries = nextEntries;
    if (!nextEntries.length) {
      WS.nav.selectedIndex = 0;
      return;
    }
    let idx = prevSelectedKey ? findEntryIndexByKey(prevSelectedKey) : -1;
    if (idx < 0) {
      idx = Math.max(0, Math.min(nextEntries.length - 1, prevSelectedIndex));
    }
    WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
    if (WS.view) {
      const selectedEntry = nextEntries[WS.nav.selectedIndex] || null;
      const selectedKey = entryKeyForSelection(selectedEntry);
      if (String(WS.view.currentNavSelectedEntryKey || "") !== String(selectedKey || "")) {
        WS.view.currentNavSelectedEntryKey = selectedKey || "";
      }
    }
  };

  if (!WS.root) {
    finish();
    return;
  }
  if (WS.view.aboveRootView && !showRootViewEnabled()) {
    WS.view.aboveRootView = false;
  }
  if (WS.view.aboveRootView && WS.nav.dirNode === WS.root) {
    nextEntries.push({ kind: "dir", node: WS.root });
    finish();
    return;
  }

  if (isViewingTagFolder()) {
    const placeholderEntry = buildBulkTagPlaceholderEntry();
    if (placeholderEntry) nextEntries.push(placeholderEntry);
    const virtualTagEntries = getTagEntriesForTagFolderView();
    for (let i = 0; i < virtualTagEntries.length; i++)
      nextEntries.push(virtualTagEntries[i]);
    const nodes = getDirsForTagFolderView();
    for (const d of nodes) nextEntries.push({ kind: "dir", node: d });
    finish();
    return;
  }

  if (searchResultsVisibleInDirectoriesPane()) {
    const placeholderEntry = buildBulkTagPlaceholderEntry();
    if (placeholderEntry) nextEntries.push(placeholderEntry);
    const dirs = (WS.view.searchResults || []).slice();
    for (let i = 0; i < dirs.length; i++)
      nextEntries.push({ kind: "dir", node: dirs[i] });
    finish();
    return;
  }

  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    const placeholderEntry = buildBulkTagPlaceholderEntry();
    if (placeholderEntry) nextEntries.push(placeholderEntry);
    const dirs = getAllFavoriteDirs();
    for (const d of dirs) nextEntries.push({ kind: "dir", node: d });
    finish();
    return;
  }

  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    const placeholderEntry = buildBulkTagPlaceholderEntry();
    if (placeholderEntry) nextEntries.push(placeholderEntry);
    const dirs = getAllHiddenDirs();
    for (const d of dirs) nextEntries.push({ kind: "dir", node: d });
    finish();
    return;
  }

  const dirNode = WS.nav.dirNode;
  if (!dirNode) {
    finish();
    return;
  }

  const rootTrashEntry = shouldShowRootTrashEntry(dirNode)
    ? buildRootTrashDirEntry()
    : null;
  if (rootTrashEntry) nextEntries.push(rootTrashEntry);

  const tagEntries = getTagFolderEntries();
  if (tagEntries.length) {
    for (const entry of tagEntries) nextEntries.push(entry);
  }

  const dirs = getChildDirsForNode(dirNode);
  for (const d of dirs) nextEntries.push({ kind: "dir", node: d });

  const baseFiles = getOrderedFileIdsForDir(dirNode);
  for (const id of baseFiles) nextEntries.push({ kind: "file", id });

  finish();
}
function isSelectableEntry(entry) {
  return (
    entry &&
    (entry.kind === "dir" ||
      entry.kind === "file" ||
      entry.kind === "tag")
  );
}

function findNearestSelectableIndex(idx, direction) {
  if (!WS.nav.entries.length) return 0;
  let i = Math.max(0, Math.min(WS.nav.entries.length - 1, idx));
  if (isSelectableEntry(WS.nav.entries[i])) return i;
  const step = direction >= 0 ? 1 : -1;
  let j = i;
  while (j >= 0 && j < WS.nav.entries.length) {
    if (isSelectableEntry(WS.nav.entries[j])) return j;
    j += step;
  }
  j = i - step;
  while (j >= 0 && j < WS.nav.entries.length) {
    if (isSelectableEntry(WS.nav.entries[j])) return j;
    j -= step;
  }
  return i;
}

function findDirEntryIndexByPath(path) {
  const p = String(path || "");
  if (!p) return -1;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (entry && entry.kind === "dir" && String(entry.node?.path || "") === p)
      return i;
  }
  return -1;
}

// USER NOTE (DO NOT CASUALLY CHANGE):
// This shared centering routine is the stable path for both folder and file selection scroll behavior.
// Regressions here have repeatedly caused major frustration ("super pissed off"). If modified, manually
// test keyboard selection in folder lists and file-only folders before shipping.
function updateGridModeListTopInset() {
  const appEl = $("app");
  const titlePaneEl = $("titlePane");
  if (!appEl) return;
  if (titlePaneEl && titlePaneEl.getBoundingClientRect) {
    const titleH = Math.max(
      0,
      Math.ceil(titlePaneEl.getBoundingClientRect().height || 0),
    );
    if (titleH > 0) appEl.style.setProperty("--title-pane-h", `${titleH}px`);
    else appEl.style.removeProperty("--title-pane-h");
  } else {
    appEl.style.removeProperty("--title-pane-h");
  }
}

function getDirectoryViewportRange(container) {
  const view = container || directoriesListEl;
  if (!view) {
    return {
      topInset: 0,
      viewTop: 0,
      viewBottom: 0,
      viewHeight: 0,
    };
  }

  const topInset = 0;

  const viewTop = (view.scrollTop || 0) + topInset;
  const viewHeight = Math.max(1, (view.clientHeight || 1) - topInset);
  return {
    topInset,
    viewTop,
    viewBottom: viewTop + viewHeight,
    viewHeight,
  };
}

function directoryItemTopRelativeToScrollContainer(item, container) {
  if (!item || !container) return 0;
  if (typeof item.getBoundingClientRect === "function" && typeof container.getBoundingClientRect === "function") {
    const itemRect = item.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    return itemRect.top - containerRect.top + (Number(container.scrollTop) || 0);
  }
  return Number(item.offsetTop) || 0;
}

function isGridTopRowSelection(container, selectedRow) {
  if (!container || !selectedRow || !container.classList) return false;
  const supportsTopSnap =
    container.classList.contains("gridModeList");
  if (!supportsTopSnap) return false;
  const rows = container.querySelectorAll(".dirRow");
  if (!rows || !rows.length) return false;
  let minTop = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rows.length; i++) {
    const t = directoryItemTopRelativeToScrollContainer(rows[i], container);
    if (t < minTop) minTop = t;
  }
  if (!Number.isFinite(minTop)) return false;
  const selectedTop = directoryItemTopRelativeToScrollContainer(selectedRow, container);
  return selectedTop <= minTop + 2;
}

function centerSelectedDirectoryRow(
  deferFrames = 0,
  lockRowCenterOffset = null,
) {
  const schedule = (frames) => {
    if (frames <= 0) {
      const container = directoriesListEl;
      const selectedRow = container
        ? container.querySelector(
            ".dirRow.selected, [data-file-pane-item].selected",
          )
        : null;
      if (!container || !selectedRow) return;
      const rowMid = selectedRow.offsetTop + selectedRow.offsetHeight * 0.5;
      const viewport = getDirectoryViewportRange(container);
      const desiredMid = Number.isFinite(lockRowCenterOffset)
        ? Number(lockRowCenterOffset)
        : viewport.topInset + viewport.viewHeight * 0.5;
      const target = rowMid - desiredMid;
      const maxScroll = Math.max(
        0,
        container.scrollHeight - container.clientHeight,
      );
      WS.view.scrollBusyDirs = true;
      container.scrollTop = Math.max(0, Math.min(maxScroll, target));
      requestAnimationFrame(() => {
        WS.view.scrollBusyDirs = false;
      });
      return;
    }
    requestAnimationFrame(() => schedule(frames - 1));
  };
  schedule(Math.max(0, deferFrames | 0));
}

function getSelectedDirectoryRowVisibility() {
  const container = directoriesListEl;
  const selectedRow = container
    ? container.querySelector(
        ".dirRow.selected, [data-file-pane-item].selected",
      )
    : null;
  if (!container || !selectedRow)
    return { state: "missing", container: null, row: null };
  const viewport = getDirectoryViewportRange(container);
  const viewTop = viewport.viewTop;
  const viewBottom = viewport.viewBottom;
  const rowTop = directoryItemTopRelativeToScrollContainer(selectedRow, container);
  const rowBottom = rowTop + selectedRow.offsetHeight;
  if (rowBottom <= viewTop || rowTop >= viewBottom) {
    return {
      state: "offscreen",
      container,
      row: selectedRow,
      rowTop,
      rowBottom,
      viewTop,
      viewBottom,
    };
  }
  if (rowTop < viewTop || rowBottom > viewBottom) {
    return {
      state: "partial",
      container,
      row: selectedRow,
      rowTop,
      rowBottom,
      viewTop,
      viewBottom,
    };
  }
  return {
    state: "visible",
    container,
    row: selectedRow,
    rowTop,
    rowBottom,
    viewTop,
    viewBottom,
  };
}

function snapSelectedDirectoryRowFullyIntoView() {
  const vis = getSelectedDirectoryRowVisibility();
  if (
    (vis.state !== "partial" && vis.state !== "offscreen") ||
    !vis.container
  )
    return;
  const { container, row, rowTop, rowBottom, viewTop, viewBottom } = vis;
  const viewport = getDirectoryViewportRange(container);
  const rowHeight = Math.max(0, rowBottom - rowTop);
  let target = container.scrollTop;
  if (isGridTopRowSelection(container, row)) {
    target = 0;
  } else if (rowHeight >= viewport.viewHeight) {
    target = rowTop - viewport.topInset;
  } else if (rowTop < viewTop) {
    target = rowTop - viewport.topInset;
  } else if (rowBottom > viewBottom) {
    target = rowBottom - container.clientHeight;
  }
  const maxScroll = Math.max(
    0,
    container.scrollHeight - container.clientHeight,
  );
  const nextScroll = Math.max(0, Math.min(maxScroll, target));
  WS.view.scrollBusyDirs = true;
  container.scrollTop = nextScroll;
  requestAnimationFrame(() => {
    WS.view.scrollBusyDirs = false;
  });
}

function revealSelectedDirectoryRowInGridMode(center = false) {
  if (!directoriesListEl) return;
  const selectedRow = directoriesListEl.querySelector(".dirRow.selected");
  if (!selectedRow) return;
  WS.view.scrollBusyDirs = true;
  const container = directoriesListEl;
  const viewport = getDirectoryViewportRange(container);
  const rowTop = directoryItemTopRelativeToScrollContainer(selectedRow, container);
  const rowBottom = rowTop + selectedRow.offsetHeight;
  const rowLeft = selectedRow.offsetLeft;
  const rowRight = rowLeft + selectedRow.offsetWidth;

  const viewTop = viewport.viewTop;
  const viewBottom = viewport.viewBottom;
  const viewLeft = container.scrollLeft;
  const viewRight = viewLeft + container.clientWidth;

  let nextTop = viewTop;
  let nextLeft = viewLeft;

  if (center) {
    const rowMid = rowTop + selectedRow.offsetHeight * 0.5;
    nextTop = rowMid - (viewport.topInset + viewport.viewHeight * 0.5);
  } else {
    if (isGridTopRowSelection(container, selectedRow)) {
      nextTop = 0;
    } else if (rowTop < viewTop) nextTop = rowTop - viewport.topInset;
    else if (rowBottom > viewBottom)
      nextTop = rowBottom - container.clientHeight;
  }

  if (rowLeft < viewLeft) nextLeft = rowLeft;
  else if (rowRight > viewRight) nextLeft = rowRight - container.clientWidth;

  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
  container.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
  container.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
  requestAnimationFrame(() => {
    WS.view.scrollBusyDirs = false;
  });
}

function canUseFastGridSelectionUpdate() {
  if (!isGridInteractionMode()) return false;
  if (
    !directoriesListEl ||
    !directoriesListEl.classList.contains("gridModeList")
  )
    return false;
  if (
    WS.view.bulkActionMenuOpen ||
    WS.view.dirActionMenuPath ||
    WS.view.fileActionMenuId
  )
    return false;
  if (
    TAG_EDIT_PATH ||
    RENAME_EDIT_PATH ||
    RENAME_EDIT_FILE_ID ||
    TAG_ENTRY_RENAME_STATE
  )
    return false;
  if (WS.view.bulkSelectMode) return false;
  if (
    directoriesActionMenuEl &&
    directoriesActionMenuEl.classList.contains("open")
  )
    return false;
  if (directoriesListEl.querySelector(".dropdownMenu.open")) return false;
  if (directoriesListEl.querySelector(".dirRow.bulkSelected")) return false;
  return true;
}

function fastUpdateGridSelectedRow(prevIdx, nextIdx) {
  if (!directoriesListEl) return false;
  const nextRow = directoriesListEl.querySelector(
    `.dirRow[data-entry-index="${String(nextIdx)}"]`,
  );
  if (!nextRow) return false;
  const showDirSel = !!(WS.view && WS.view.activePane === "directories");
  const selectedRows = directoriesListEl.querySelectorAll(".dirRow.selected");
  if (selectedRows && selectedRows.length) {
    selectedRows.forEach((row) => {
      if (row && row !== nextRow) row.classList.remove("selected");
    });
  }
  if (showDirSel) {
    nextRow.classList.add("selected");
  }
  return true;
}

function canUseFastPaneSelectionUpdate(hadTransientUi) {
  if (isGridInteractionMode()) return false;
  if (
    !directoriesListEl ||
    directoriesListEl.classList.contains("gridModeList")
  )
    return false;
  if (busyOverlay && busyOverlay.classList.contains("active")) return false;
  if (hadTransientUi) return false;
  if (WS.view.bulkSelectMode) return false;
  return true;
}

function fastUpdatePaneSelectedRow(prevIdx, nextIdx) {
  if (!directoriesListEl) return false;
  const nextRow = directoriesListEl.querySelector(
    `.dirRow[data-entry-index="${String(nextIdx)}"]`,
  );
  if (!nextRow) return false;
  const showDirSel = !!(WS.view && WS.view.activePane === "directories");
  const selectedRows = directoriesListEl.querySelectorAll(
    ".dirRow.selected",
  );
  if (selectedRows && selectedRows.length) {
    selectedRows.forEach((row) => {
      if (row && row !== nextRow) row.classList.remove("selected");
    });
  }
  if (showDirSel) {
    nextRow.classList.add("selected");
  }
  return true;
}

let PREVIEW_SELECTION_RENDER_RAF = 0;
function schedulePreviewRenderForSelection(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const delayMs = Math.max(0, Number(options.delayMs == null ? previewRenderDelayForCurrentSelection() : options.delayMs) || 0);
  if (PREVIEW_SELECTION_RENDER_TIMER) {
    try {
      clearTimeout(PREVIEW_SELECTION_RENDER_TIMER);
    } catch {}
    PREVIEW_SELECTION_RENDER_TIMER = 0;
  }
  if (PREVIEW_SELECTION_RENDER_RAF) {
    try {
      cancelAnimationFrame(PREVIEW_SELECTION_RENDER_RAF);
    } catch {}
    PREVIEW_SELECTION_RENDER_RAF = 0;
  }
  const run = () => {
    PREVIEW_SELECTION_RENDER_RAF = requestAnimationFrame(() => {
      PREVIEW_SELECTION_RENDER_RAF = 0;
      renderPreviewPane(false);
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    });
  };
  if (delayMs > 0) {
    PREVIEW_SELECTION_RENDER_TIMER = setTimeout(() => {
      PREVIEW_SELECTION_RENDER_TIMER = 0;
      run();
    }, delayMs);
  } else {
    run();
  }
}

function renderPreviewForSelectionChange() {
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (entry && entry.kind === "file") {
    schedulePreviewFileObjectsWarm(WS.nav.dirNode, 0);
    renderPreviewPane(false, true);
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
    return;
  }
  if (shouldDeferPreviewRenderForCurrentSelection()) {
    schedulePreviewRenderForSelection();
  } else {
    renderPreviewPane(false);
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  }
}

function reconcileSelectedDirectoryRowVisibility(
  preferCenter = false,
  forceCenter = false,
) {
  if (forceCenter) {
    centerSelectedDirectoryRow(0);
    return;
  }
  const vis = getSelectedDirectoryRowVisibility();
  if (
    vis.container &&
    vis.row &&
    isGridTopRowSelection(vis.container, vis.row) &&
    (Number(vis.container.scrollTop) || 0) > 0
  ) {
    snapSelectedDirectoryRowFullyIntoView();
    return;
  }
  if (vis.state === "offscreen" || vis.state === "partial") {
    if (preferCenter) centerSelectedDirectoryRow(0);
    else snapSelectedDirectoryRowFullyIntoView();
  }
}

let DIR_SELECTION_RECONCILE_RAF = 0;
let DIR_SELECTION_RECONCILE_TIMER = 0;
function scheduleSelectedDirectoryRowReconcile(
  delayedMs = 0,
  preferCenter = false,
  forceCenter = false,
) {
  if (DIR_SELECTION_RECONCILE_RAF) {
    try {
      cancelAnimationFrame(DIR_SELECTION_RECONCILE_RAF);
    } catch {}
    DIR_SELECTION_RECONCILE_RAF = 0;
  }
  if (DIR_SELECTION_RECONCILE_TIMER) {
    try {
      clearTimeout(DIR_SELECTION_RECONCILE_TIMER);
    } catch {}
    DIR_SELECTION_RECONCILE_TIMER = 0;
  }
  DIR_SELECTION_RECONCILE_RAF = requestAnimationFrame(() => {
    DIR_SELECTION_RECONCILE_RAF = 0;
    reconcileSelectedDirectoryRowVisibility(preferCenter, forceCenter);
  });
  if (delayedMs > 0) {
    DIR_SELECTION_RECONCILE_TIMER = setTimeout(() => {
      DIR_SELECTION_RECONCILE_TIMER = 0;
      reconcileSelectedDirectoryRowVisibility(preferCenter, forceCenter);
    }, delayedMs);
  }
}

function syncDirectoriesSelectionToFileRecord(rec, opts = null) {
  if (!rec || !WS.root) return null;
  const options = opts && typeof opts === "object" ? opts : {};
  const p = String(rec.dirPath || "");
  const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;
  if (!dn) return null;

  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();

  if (
    pushSimulatedTagViewContextForPath(
      dn.path || "",
      options.simulatedTagSourceDir || null,
    )
  ) {
    WS.view.tagFolderActiveMode = "";
    WS.view.tagFolderActiveTag = "";
    WS.view.tagFolderActiveAlbum = "";
    WS.view.tagFolderOriginPath = "";
  }

  if (searchResultsVisibleInDirectoriesPane()) {
    enterSearchResultContext(dn.path || "");
  }
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath = dn.path || "";
  }
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = dn.path || "";
  }

  WS.nav.dirNode = dn;
  WS.view.aboveRootView = false;
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();

  let idx = -1;
  const targetId = String(rec.id || "");
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const e = WS.nav.entries[i];
    if (e && e.kind === "file" && String(e.id || "") === targetId) {
      idx = i;
      break;
    }
  }
  WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
  saveGridSelectionForCurrentContext();
  if (options.syncPreview !== false) syncPreviewToSelection({ force: true });
  if (options.pendingDirScroll !== false) {
    WS.view.pendingDirScroll =
      String(options.pendingDirScrollMode || "center-selected") ||
      "center-selected";
  }
  renderDirectoriesPane(!!options.keepDirectoriesScroll);
  if (options.renderPreview !== false) {
    renderPreviewPane(
      options.animatePreview !== false,
      options.keepPreviewScroll !== false,
    );
  }
  syncButtons();
  if (options.renderPreview !== false) {
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  }
  if (options.recordHistory !== false) recordDirHistory();
  return {
    dirNode: dn,
    selectedIndex: WS.nav.selectedIndex,
  };
}

function setDirectoriesSelection(idx, opts = null) {
  const keepScroll = !!(opts && opts.keepScroll);
  WS.view.previewFolderBridgeReturnState = null;
  if (!WS.nav.entries.length) {
    WS.nav.selectedIndex = 0;
    setActivePane(directoriesPaneOpenEnabled() ? "directories" : "preview");
    applyPreviewState(null);
    renderDirectoriesPane();
    renderPreviewPane(true);
    syncButtons();
    return;
  }
  const hadTransientUi = !!(
    WS.view.bulkActionMenuOpen ||
    WS.view.dirActionMenuPath ||
    WS.view.fileActionMenuId ||
    TAG_EDIT_PATH ||
    RENAME_EDIT_PATH ||
    RENAME_EDIT_FILE_ID ||
    TAG_ENTRY_RENAME_STATE
  );
  closeActionMenus();
  const prevIdx = WS.nav.selectedIndex;
  const i = findNearestSelectableIndex(
    idx,
    idx >= WS.nav.selectedIndex ? 1 : -1,
  );
  WS.nav.selectedIndex = i;
  if (currentViewNeedsResponsiveNavigationPriority())
    noteResponsiveNavigationInteraction(isViewingTagFolder() ? "tag-album-selection" : "media-selection");
  if (directoriesPaneOpenEnabled()) setActivePane("directories");
  saveGridSelectionForCurrentContext();
  deferThumbnailDemandForSelection();
  syncPreviewToSelection({ force: true });
  const snapshot = currentNavigationSnapshot();
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  const entryCount = Array.isArray(WS.nav.entries) ? WS.nav.entries.length : 0;
  const heavySelectionContext =
    isViewingTagFolder() ||
    entry?.kind === "tag" ||
    entry?.kind === "album" ||
    entryCount >= 180;
  const warmDelayMs = heavySelectionContext ? 340 : 180;
  scheduleNearbyDirectoryRamWarm(snapshot, warmDelayMs);

  if (
    canUseFastGridSelectionUpdate() &&
    fastUpdateGridSelectedRow(prevIdx, i)
  ) {
    const shouldCenter = WS.view.pendingDirScroll === "center-selected";
    const shouldGridReveal = WS.view.pendingDirScroll === "grid-nearest";
    if (shouldCenter || shouldGridReveal) WS.view.pendingDirScroll = "";
    if (shouldCenter) revealSelectedDirectoryRowInGridMode(true);
    else if (shouldGridReveal) revealSelectedDirectoryRowInGridMode(false);
    else scheduleSelectedDirectoryRowReconcile(0, false, false);
    renderPreviewForSelectionChange();
    syncButtons();
    return;
  }

  if (
    canUseFastPaneSelectionUpdate(hadTransientUi) &&
    fastUpdatePaneSelectedRow(prevIdx, i)
  ) {
    const shouldCenter = WS.view.pendingDirScroll === "center-selected";
    if (shouldCenter) WS.view.pendingDirScroll = "";
    if (shouldCenter) centerSelectedDirectoryRow(0);
    else scheduleSelectedDirectoryRowReconcile(0, false, false);
    renderPreviewForSelectionChange();
    syncButtons();
    return;
  }

  renderDirectoriesPane(keepScroll);
  renderPreviewForSelectionChange();
  syncButtons();
}

async function returnToSearchResults() {
  const currentPath = String(WS.nav.dirNode?.path || "");
  const currentIsSearchResult =
    !!currentPath &&
    Array.isArray(WS.view.searchResults) &&
    WS.view.searchResults.some(
      (node) => String(node?.path || "") === currentPath,
    );
  const target = String(
    currentIsSearchResult ? currentPath : currentSearchResultPath(),
  );
  WS.view.searchRootActive = true;
  WS.view.searchAnchorPath = target;
  WS.view.searchEntryRootPath = target;
  if (searchResultsVisibleInPreviewPane()) {
    const searchRootNode =
      WS.dirByPath.get(String(WS.view.searchRootPath || "")) || null;
    const parentNode = searchRootNode
      ? searchRootNode.parent || searchRootNode || WS.root
      : WS.nav.dirNode || WS.root;
    if (parentNode) {
      WS.nav.dirNode = parentNode;
      WS.view.aboveRootView = false;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      const rootPath = String(searchRootNode?.path || "");
      const rootIdx = rootPath ? findDirEntryIndexByPath(rootPath) : -1;
      WS.nav.selectedIndex = findNearestSelectableIndex(
        rootIdx >= 0 ? rootIdx : 0,
        1,
      );
      syncPreviewToSelection({ force: true });
    }
    WS.view.pendingPreviewSelectionKey = target ? `dir:${target}` : "";
    setActivePane("preview");
    await finalizeDirectoryNavigationRender({
      animatePreview: false,
      keepDirectoriesScroll: true,
      recordHistory: true,
    });
    return;
  }
  rebuildDirectoriesEntries();
  const idx = target ? findDirEntryIndexByPath(target) : -1;
  WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
  syncPreviewToSelection({ force: true });
  await finalizeDirectoryNavigationRender({
    animatePreview: false,
    recordHistory: true,
  });
}

function previewFileIdVisibleInContext(fileId, dirNode = null) {
  const id = String(fileId || "");
  if (!id || !WS.fileById) return false;
  const rec = WS.fileById.get(id);
  if (!rec || !passesFilter(rec)) return false;

  const contextDir =
    dirNode ||
    (WS.preview && WS.preview.kind === "file" ? WS.preview.dirNode : null) ||
    WS.nav.dirNode ||
    null;
  if (!contextDir) return true;

  const contextPath = String(contextDir.path || "");
  const recDirPath = String(rec.dirPath || "");
  if (!contextDir._skipTagFilters && contextPath && contextPath === recDirPath) {
    return recordPassesContextualTagMediaFilterForDir(rec, contextDir);
  }

  let items = [];
  try {
    items = buildViewerItemsForDir(contextDir);
  } catch {
    items = [];
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item && !item.isFolder && String(item.id || "") === id) return true;
  }
  return false;
}

function firstVisibleFilePreviewStateForContext(dirNode = null) {
  const contextDir =
    dirNode ||
    (WS.preview && WS.preview.kind === "file" ? WS.preview.dirNode : null) ||
    WS.nav.dirNode ||
    null;
  if (!contextDir) return null;

  let items = [];
  try {
    items = buildViewerItemsForDir(contextDir);
  } catch {
    items = [];
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item || item.isFolder || !item.id) continue;
    if (previewFileIdVisibleInContext(item.id, contextDir)) {
      return { kind: "file", dirNode: contextDir, fileId: item.id };
    }
  }
  return null;
}

function normalizeViewerStateForCurrentFilters(preferredFileId = null) {
  if (!viewerDirNode) return false;
  const preferredId = String(
    preferredFileId ||
      ((viewerItems[viewerIndex] && !viewerItems[viewerIndex].isFolder)
        ? viewerItems[viewerIndex].id
        : "") ||
      (WS.preview && WS.preview.kind === "file" ? WS.preview.fileId : "") ||
      "",
  );

  let nextItems = [];
  try {
    nextItems = buildViewerItemsForDir(viewerDirNode);
  } catch {
    nextItems = [];
  }
  viewerItems = nextItems;
  if (!viewerItems.length) {
    viewerIndex = 0;
    return false;
  }

  let idx = -1;
  if (preferredId) {
    idx = viewerItems.findIndex(
      (item) => item && !item.isFolder && String(item.id || "") === preferredId,
    );
  }
  if (idx < 0) idx = findFirstFileIndex(viewerItems);
  if (idx < 0) idx = 0;
  viewerIndex = Math.max(0, Math.min(viewerItems.length - 1, idx));
  return true;
}

function previewTargetStillResolvable() {
  if (!WS.preview || !WS.preview.kind) return false;
  if (WS.preview.kind === "file" && WS.preview.fileId) {
    return previewFileIdVisibleInContext(WS.preview.fileId, WS.preview.dirNode || null);
  }
  if (WS.preview.kind === "dir" && WS.preview.dirNode) {
    if (WS.preview.dirNode === WS.root) return true;
    const previewPath = String(WS.preview.dirNode.path || "");
    if (!previewPath) return !!WS.preview.dirNode;
    return !!(
      WS.dirByPath.get(previewPath) || WS.preview.dirNode._skipTagFilters
    );
  }
  return false;
}

// The preview pane is "the location you are at". A background refresh — a
// setting toggled by keybind, a sort/filter change, a folder moved to
// trash/storage, any catalog mutation — must never teleport it. As long as
// what the preview is showing still exists, keep it exactly where it is,
// regardless of which pane is focused (the old activePane === "preview" gate
// meant any refresh while the file pane was focused snapped the preview back to
// the selection, often landing on the first folder in root). Only when the
// preview target is genuinely gone do we fall back to deriving it from the
// file-pane selection. Intentional navigation (arrow keys, entering a folder)
// updates the preview through its own syncPreviewToSelection calls, so this
// only governs incidental refreshes.
function preserveActivePreviewTargetDuringDirectoriesRefresh() {
  if (previewTargetStillResolvable()) {
    alignNavSelectionToPreviewLocation();
    return false;
  }
  syncPreviewToSelection();
  return true;
}

/* The screen (the preview) is where you are; the file-pane selection is a
   leftover of the old sidebar and must follow it, never lead it. An unforced
   sync is always incidental -- a refresh, a re-sort, a rename starter -- so
   while the place on screen still exists it does not move: the file-pane
   cursor is put back on that place instead (`alignNavSelectionToPreviewLocation`).
   Before this, a cursor left on the wrong row by a re-sort, a refresh that
   could not find a Tag row (and fell back to the first row, usually
   Favorites), or an edit that moved it onto a grid card, took the screen with
   it -- "I did something and ended up inside Favorites". Deliberate moves pass
   { force: true }. */
function previewLocationEntryKey() {
  const p = WS.preview;
  if (!p || !p.kind) return "";
  if (p.kind === "file") return p.fileId ? `file:${String(p.fileId)}` : "";
  const node = p.dirNode;
  if (!node || node === WS.root) return "";
  if (node._skipTagFilters)
    return entryKeyForSelection(tagEntryForPreviewPlaceholderNode(node));
  return `dir:${String(node.path || "")}`;
}

function alignNavSelectionToPreviewLocation() {
  const p = WS.preview;
  // A workspace rebuild replaces folder nodes; keep the screen on the live one.
  if (p && p.kind === "dir" && p.dirNode && !p.dirNode._skipTagFilters) {
    const path = String(p.dirNode.path || "");
    const live = path ? WS.dirByPath.get(path) : null;
    if (live && live !== p.dirNode) p.dirNode = live;
  }
  const key = previewLocationEntryKey();
  if (!key) return false;
  const idx = findEntryIndexByKey(key);
  if (idx < 0) return false;
  WS.nav.selectedIndex = idx;
  if (WS.view) WS.view.lastPreviewSyncedEntryKey = key;
  return true;
}

function syncPreviewToSelection(opts = null) {
  const force = !!(opts && opts.force);
  if (!force && previewTargetStillResolvable()) {
    alignNavSelectionToPreviewLocation();
    return false;
  }
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  const selectedKey = entryKeyForSelection(entry);
  const lastSyncedKey = String(WS.view && WS.view.lastPreviewSyncedEntryKey || "");
  if (
    !force &&
    WS.view &&
    WS.view.activePane === "preview" &&
    previewTargetStillResolvable() &&
    selectedKey &&
    selectedKey === lastSyncedKey
  ) {
    return false;
  }
  const nextPreviewState = previewStateForEntry(entry);
  applyPreviewState(nextPreviewState);
  if (nextPreviewState && nextPreviewState.kind === "dir" && nextPreviewState.dirNode) {
    scheduleSelectedDirectoryPreviewRefresh(nextPreviewState.dirNode, {
      reason: "selection-sync",
    });
  }
  if (WS.view) WS.view.lastPreviewSyncedEntryKey = selectedKey || "";
  return true;
}
