/* Global UI sync
   Fullscreen helpers, overlay buttons and syncButtons. */

/* =========================================================
       Fullscreen helpers
       ========================================================= */

async function enterFullscreenIfPossible() {
  if (!overlay) return;
  if (document.fullscreenElement) return;
  try {
    await overlay.requestFullscreen();
  } catch {}
}

function exitFullscreenIfNeeded() {
  if (!document.fullscreenElement) return;
  try {
    document.exitFullscreen();
  } catch {}
}

/* =========================================================
       Overlay buttons + basic wiring
       ========================================================= */

if (closeBtn)
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideOverlay();
  });

overlay.addEventListener("click", (e) => {
  if (!VIEWER_MODE) return;
});

/* =========================================================
       Global UI sync helpers
       ========================================================= */

function syncButtons() {
  const hasWS =
    !!WS.root &&
    (!!WS.nav.dirNode || WS.view.favoritesMode || WS.view.hiddenMode);
  if (favoritesBtn) favoritesBtn.disabled = !hasWS;
  if (hiddenBtn) hiddenBtn.disabled = !hasWS;
  if (refreshBtn) refreshBtn.disabled = !WS.meta.fsRootHandle;

  if (directoriesSearchInput) {
    directoriesSearchInput.disabled = !hasWS || !topBarEnabled();
    const v = String(WS.view.dirSearchQuery || "");
    if (directoriesSearchInput.value !== v) directoriesSearchInput.value = v;
    const placeholderName = (function () {
      if (!hasWS) return "folder";
      const node = isCompactTitleLayout()
        ? getPreviewTargetDir() || WS.nav.dirNode || WS.root
        : WS.nav.dirNode;
      if (!node) return "folder";
      if (WS.view.favoritesMode) return "Favorites";
      if (WS.view.hiddenMode) return "Hidden";
      if (node && node.name) {
        const nm = dirDisplayName(node);
        if (nm) return nm;
      }
      const p = String(node?.path || "");
      if (p) {
        const parts = p.split(/[/\\\\]+/).filter(Boolean);
        if (parts.length) return parts[parts.length - 1];
      }
      return "folder";
    })();
    directoriesSearchInput.placeholder = `Search ${placeholderName}`;
  }
  if (directoriesSearchClearBtn) {
    const enabled =
      hasWS &&
      (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim());
    directoriesSearchClearBtn.disabled = !enabled;
  }

  if (dirBackBtn) dirBackBtn.disabled = !(WS.view.dirHistoryIndex > 0);
  if (dirForwardBtn)
    dirForwardBtn.disabled = !(
      WS.view.dirHistoryIndex >= 0 &&
      WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1
    );
  if (dirUpBtn) {
    const canExitRoot =
      WS.nav.dirNode === WS.root &&
      !WS.view.aboveRootView &&
      showRootViewEnabled();
    const canGoUp =
      !!WS.nav.dirNode && (!!WS.nav.dirNode.parent || canExitRoot);
    dirUpBtn.disabled =
      !canGoUp ||
      searchResultsVisibleInDirectoriesPane() ||
      WS.view.favoritesMode ||
      WS.view.hiddenMode;
  }

  syncMetaButtons();
  updateModePill();
  updateTitleLabel();
  syncControlPaneState();
}

function refreshViewerItemsForLiveFolderSort() {
  if (!VIEWER_MODE || !viewerDirNode) return false;
  // The viewer is an overlay on top of a live file pane, so re-sort the pane's
  // entries too. Skipping this leaves WS.nav.entries in the pre-change order, and
  // closing the viewer restores exactly that stale list (see restoreViewerCloseState
  // with preferCachedEntries) — the folder comes back sorted the old way.
  rebuildDirectoriesEntries();
  const currentItem = viewerItems[viewerIndex] || null;
  const nextItems = buildViewerItemsForDir(viewerDirNode);
  if (!nextItems.length) return true;
  viewerItems = nextItems;
  let nextIndex = 0;
  if (currentItem) {
    if (currentItem.isFolder) {
      const path = String(currentItem.dirNode?.path || "");
      const found = viewerItems.findIndex(
        (item) => item.isFolder && String(item.dirNode?.path || "") === path,
      );
      if (found >= 0) nextIndex = found;
    } else {
      const found = viewerItems.findIndex(
        (item) =>
          !item.isFolder &&
          String(item.id || "") === String(currentItem.id || ""),
      );
      if (found >= 0) nextIndex = found;
    }
  }
  viewerIndex = Math.max(0, Math.min(viewerItems.length - 1, nextIndex));
  renderViewerItem(viewerIndex);
  syncDirectoriesToViewerState();
  return true;
}

function applyFolderSortModeEverywhere(animate = false) {
  if (refreshViewerItemsForLiveFolderSort()) return;
  applyViewModesEverywhere(animate);
}

function applyViewModesEverywhere(animate = false) {
  if (
    !WS.root ||
    (!WS.nav.dirNode && !WS.view.favoritesMode && !WS.view.hiddenMode)
  ) {
    renderDirectoriesPane();
    renderPreviewPane(true);
    syncButtons();
    return;
  }

  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();

  renderDirectoriesPane(true);
  renderPreviewPane(animate, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function applyRandomSortModeEverywhere(animate = false) {
  if (VIEWER_MODE) {
    if (!viewerDirNode) return;
    const currentItem = viewerItems[viewerIndex] || null;
    viewerItems = buildViewerItemsForDir(viewerDirNode);
    if (!viewerItems.length) return;
    let nextIndex = 0;
    if (currentItem) {
      if (currentItem.isFolder) {
        const path = String(currentItem.dirNode?.path || "");
        const found = viewerItems.findIndex(
          (item) => item.isFolder && String(item.dirNode?.path || "") === path,
        );
        if (found >= 0) nextIndex = found;
      } else {
        const found = viewerItems.findIndex(
          (item) =>
            !item.isFolder &&
            String(item.id || "") === String(currentItem.id || ""),
        );
        if (found >= 0) nextIndex = found;
      }
    }
    viewerIndex = Math.max(0, Math.min(viewerItems.length - 1, nextIndex));
    renderViewerItem(viewerIndex);
    syncDirectoriesToViewerState();
    return;
  }
  if (
    !WS.root ||
    (!WS.nav.dirNode && !WS.view.favoritesMode && !WS.view.hiddenMode)
  ) {
    applyViewModesEverywhere(animate);
    return;
  }
  const currentEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
  const currentKey = currentEntry
    ? currentEntry.kind === "dir"
      ? { kind: "dir", path: String(currentEntry.node?.path || "") }
      : currentEntry.kind === "file"
        ? { kind: "file", id: String(currentEntry.id || "") }
        : {
            kind: "tag",
            label: String(currentEntry.label || ""),
            tag: String(currentEntry.tag || ""),
            special: String(currentEntry.special || ""),
          }
    : null;
  rebuildDirectoriesEntries();
  let nextIndex = -1;
  if (currentKey) {
    for (let i = 0; i < WS.nav.entries.length; i++) {
      const entry = WS.nav.entries[i];
      if (!entry || entry.kind !== currentKey.kind) continue;
      if (
        entry.kind === "dir" &&
        String(entry.node?.path || "") === currentKey.path
      ) {
        nextIndex = i;
        break;
      }
      if (entry.kind === "file" && String(entry.id || "") === currentKey.id) {
        nextIndex = i;
        break;
      }
      if (
        entry.kind === "tag" &&
        String(entry.label || "") === currentKey.label &&
        String(entry.tag || "") === currentKey.tag &&
        String(entry.special || "") === currentKey.special
      ) {
        nextIndex = i;
        break;
      }
    }
  }
  const fallbackIndex = nextIndex >= 0 ? nextIndex : WS.nav.selectedIndex;
  WS.nav.selectedIndex = findNearestSelectableIndex(fallbackIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(animate, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}
