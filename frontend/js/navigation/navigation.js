/* Navigation
   Opening, entering and leaving folders, history, Favorites and Hidden modes. */

function openSelectedPreviewItem() {
  if (!ensurePreviewSelectionForCurrentTarget(false)) return false;
  const card = findSelectedPreviewCard();
  const openAction =
    card && typeof card.__previewOpenAction === "function"
      ? card.__previewOpenAction
      : null;
  if (openAction) {
    openAction();
    return true;
  }
  const kind = String(card?.dataset?.previewItemKind || "");
  if (kind === "dir") {
    const path = previewDirPathForCard(card);
    const node = path ? WS.dirByPath.get(path) || null : null;
    if (!node) return false;
    navigateFromPreviewFolderCard(node);
    return true;
  }
  if (kind === "file") {
    const id = previewFileIdForCard(card);
    const rec = id ? WS.fileById.get(id) || null : null;
    if (!rec) return false;
    openPreviewFileFromPreviewCard(rec);
    return true;
  }
  if (kind === "tag" && card && card.__previewTagEntry) {
    openPreviewTagFolderEntry(card.__previewTagEntry);
    return true;
  }
  return false;
}

function handlePreviewCardSelection(card, openAction, e = null) {
  if (!card) return;
  const key = String(card.dataset.previewItemKey || "");
  if (!key) return;
  if (!previewThumbnailSelectionEnabled()) {
    if (e) e.preventDefault();
    clearPreviewSelectionState(currentPreviewSelectionContextKeyFromState());
    updatePreviewSelectionClasses();
    if (typeof openAction === "function") openAction();
    return;
  }
  const priorSelectedKey = String(WS.view.previewSelectedKey || "");
  const isCmdOrCtrl = eventCmdOrCtrlHeld(e);
  const isShift = eventShiftHeld(e);

  if (isShift && isCmdOrCtrl) {
    const anchorKey = String(
      WS.view.previewSelectAnchorKey || priorSelectedKey || key,
    );
    if (!WS.view.bulkSelectMode) {
      const selectedCard = findSelectedPreviewCard();
      if (
        selectedCard &&
        String(selectedCard.dataset.previewItemKey || "") !== key
      ) {
        addPreviewCardBulkSelection(selectedCard);
      }
    }
    addPreviewSelectionRange(anchorKey, key, false);
    WS.view.previewSelectAnchorKey = key;
    setPreviewSelectionKey(key, { activate: true });
    refreshBulkSelectionUiFromPreview();
    return;
  }

  if (isShift) {
    const anchorKey = String(
      WS.view.previewSelectAnchorKey || priorSelectedKey || key,
    );
    addPreviewSelectionRange(anchorKey, key, true);
    WS.view.previewSelectAnchorKey = key;
    setPreviewSelectionKey(key, { activate: true });
    refreshBulkSelectionUiFromPreview();
    return;
  }

  if (isCmdOrCtrl) {
    if (!WS.view.bulkSelectMode) {
      const selectedCard = findSelectedPreviewCard();
      if (
        selectedCard &&
        String(selectedCard.dataset.previewItemKey || "") !== key
      ) {
        addPreviewCardBulkSelection(selectedCard);
      }
    }
    WS.view.bulkSelectMode = true;
    togglePreviewCardBulkSelection(card);
    if (
      !WS.view.bulkTagSelectedPaths.size &&
      !WS.view.bulkTagFolderSelectedKeys.size &&
      !WS.view.bulkFileSelectedIds.size
    ) {
      WS.view.bulkSelectMode = false;
    }
    WS.view.previewSelectAnchorKey = key;
    setPreviewSelectionKey(key, { activate: true });
    refreshBulkSelectionUiFromPreview();
    return;
  }

  const hadBulkSelection =
    WS.view.bulkSelectMode &&
    (WS.view.bulkTagSelectedPaths.size ||
      WS.view.bulkTagFolderSelectedKeys.size ||
      WS.view.bulkFileSelectedIds.size);
  const shouldOpen = !!key && priorSelectedKey === key && !hadBulkSelection;
  if (hadBulkSelection) {
    clearBulkTagSelection();
    WS.view.bulkSelectMode = false;
  }
  WS.view.previewSelectAnchorKey = key;
  setPreviewSelectionKey(key, { activate: true });
  if (hadBulkSelection) refreshBulkSelectionUiFromPreview();
  if (shouldOpen && typeof openAction === "function") openAction();
}

function focusDirectoriesOnFileRecord(rec) {
  return !!syncDirectoriesSelectionToFileRecord(rec, {
    syncPreview: true,
    pendingDirScrollMode: "center-selected",
    animatePreview: false,
    keepPreviewScroll: true,
    recordHistory: true,
  });
}

function openPreviewFileFromPreviewCard(rec) {
  if (!rec || !WS.root) return false;
  if (rec.isMissingPlaceholder) {
    showStatusMessage("This item is missing from the current ALT.");
    return false;
  }
  const fileId = String(rec.id || "");
  if (!fileId) return false;
  if (WS.preview.kind === "file" && String(WS.preview.fileId || "") === fileId) {
    if (WS.view.previewFileSelectionBridgeActive) setActivePane("directories");
    return true;
  }
  const bridgeReturnState = captureViewerCloseRestoreState({
    activePane: "preview",
  });
  const previewContextDir = currentFilePreviewContextDir();
  const synced = syncDirectoriesSelectionToFileRecord(rec, {
    syncPreview: false,
    renderPreview: false,
    pendingDirScrollMode: "center-selected",
    recordHistory: true,
    simulatedTagSourceDir: previewContextDir,
  });
  if (!synced) return false;
  WS.view.returnToPreviewPaneAfterFileClose = true;
  WS.view.previewFileSelectionBridgeActive = true;
  WS.view.previewFileBridgeReturnState = bridgeReturnState;
  applyPreviewState({
    kind: "file",
    dirNode: previewContextDir || synced.dirNode || null,
    fileId,
  });
  renderPreviewPane(false, true);
  setActivePane("directories");
  syncActivePaneWithLayout();
  updatePreviewSelectionClasses();
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  return true;
}

function renderSelectedFilePreviewBeforeDirectoryPreparation() {
  if (!WS.preview || !WS.preview.kind) return;
  // Folder-entry navigation should never display the previous preview media while
  // the newly selected target is being resolved. The normal selection anti-flicker
  // path intentionally holds the old frame, but that looks like a stale flash
  // when opening a media folder, especially with thumbnail loading disabled.
  if (WS.preview.kind === "file" && WS.preview.fileId) {
    PREVIEW_SUPPRESS_STALE_FRAME_ONCE = true;
    renderPreviewPane(false, false);
    return;
  }
  // For folder targets: only clear the stale grid. finalizeDirectoryNavigation
  // (called immediately after) does the real build — a full pre-render here
  // doubled the work and made every open/close feel a frame late.
  if (WS.preview.kind === "dir" && WS.preview.dirNode) {
    resetPreviewGridRenderRecovery();
    if (previewBodyEl) {
      releaseContainerThumbMedia(previewBodyEl);
      previewBodyEl.innerHTML = "";
    }
  }
}

function enterSelectedDirectory() {
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  FAST_NAV.mark();
  WS.view.previewFolderBridgeReturnState = null;
  // Descending into a folder from the file pane abandons any single-file grid
  // preview bridge. A stale bridge here makes closing a quick-nav media folder
  // (esp. when the file pane was already closed, so no auto-restore state is
  // captured) hit the file-selection close branch and only close to the folder
  // grid instead of stepping out — quick nav appearing to be "off". Other
  // open helpers already clear this on entry; keep it consistent here too.
  WS.view.returnToPreviewPaneAfterFileClose = false;
  WS.view.previewFileSelectionBridgeActive = false;
  WS.view.previewFileBridgeReturnState = null;

  // When called from the grid, keep selection active in the preview pane.
  const enteringFromGrid =
    !directoriesPaneOpenEnabled() || WS.view.activePane === "preview";

  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  const quickNavigationRestoreState =
    captureQuickNavigationDirectoryEnterRestoreState(entry);
  if (!entry) return;
  if (entry.kind === "dir" && entry.node && entry.node.isMissingPlaceholder) {
    showStatusMessage("This item is missing from the current ALT.");
    return;
  }
  if (entry.kind === "file") {
    const missingRec = WS.fileById.get(entry.id);
    if (missingRec && missingRec.isMissingPlaceholder) {
      showStatusMessage("This item is missing from the current ALT.");
      return;
    }
  }
  if (entry.kind === "dir" && isStorageStubDirNode(entry.node)) {
    showStatusMessage(STORAGE_OPEN_REFUSED_MESSAGE);
    return;
  }
  if (
    entry.kind === "dir" &&
    entry.node &&
    ((WS.catalog && WS.catalog.enabled) || entry.node.fsHandle) &&
    entry.node.loadState !== "loaded"
  ) {
    ensureDirectoryHydratedForOpen(entry.node, { label: "Opening folder..." })
      .then(() => enterSelectedDirectory())
      .catch((error) => {
        console.error("Lazy folder open failed.", error);
        hideBlockingLoaderOverlay();
        showStatusMessage("Could not load that folder.");
      });
    return;
  }
  if (WS.view.aboveRootView) {
    if (entry.kind === "dir" && entry.node === WS.root) {
      WS.view.aboveRootView = false;
      WS.nav.dirNode = WS.root;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
      syncPreviewToSelection({ force: true });
      maybeClosePanesForQuickNavigationDirectoryEnter(quickNavigationRestoreState);
      scheduleNearbyDirectoryRamWarm(currentNavigationSnapshot());
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      recordDirHistory();
    }
    return;
  }
  if (entry.kind === "tag") {
    openTagFolderEntry(entry);
    return;
  }

  if (entry.kind !== "dir" || !entry.node) {
    if (entry.kind === "file") {
      const rec = WS.fileById.get(entry.id);
      if (rec) {
        const restoreState = captureFilePaneEnterAutoRestoreState(entry);
        const opened = focusDirectoriesOnFileRecord(rec);
        if (opened) {
          WS.view.returnToPreviewPaneAfterFileClose = false;
          WS.view.previewFileSelectionBridgeActive = false;
          WS.view.previewFileBridgeReturnState = null;
          WS.view.previewFolderBridgeReturnState = null;
          closePanesForFilePaneEnterAutoRestore(restoreState);
        }
      }
    }
    return;
  }
  if (pushSimulatedTagViewContextForPath(entry.node?.path || "")) {
    WS.view.tagFolderActiveMode = "";
    WS.view.tagFolderActiveTag = "";
    WS.view.tagFolderActiveAlbum = "";
    WS.view.tagFolderOriginPath = "";
  }

  if (searchResultsVisibleInDirectoriesPane()) {
    enterSearchResultContext(entry.node.path || "");
    WS.nav.dirNode = entry.node;
    syncBulkSelectionForCurrentDir();
    syncFavoritesUi();
    syncTagUiForCurrentDir();
    rebuildDirectoriesEntries();
    WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
    syncPreviewToSelection({ force: true });
    renderSelectedFilePreviewBeforeDirectoryPreparation();
    maybeClosePanesForQuickNavigationDirectoryEnter(quickNavigationRestoreState);
    finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(entry.node, {
      animatePreview: false,
      recordHistory: true,
      activatePreviewSelection: enteringFromGrid && previewThumbnailSelectionEnabled(),
    }).catch(() => {});
    return;
  }

  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath = entry.node.path || "";
    WS.nav.dirNode = entry.node;
    syncBulkSelectionForCurrentDir();
    syncFavoritesUi();
    syncTagUiForCurrentDir();
    rebuildDirectoriesEntries();
    WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
    syncPreviewToSelection({ force: true });
    renderSelectedFilePreviewBeforeDirectoryPreparation();
    maybeClosePanesForQuickNavigationDirectoryEnter(quickNavigationRestoreState);
    finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(entry.node, {
      animatePreview: false,
      recordHistory: true,
      activatePreviewSelection: enteringFromGrid && previewThumbnailSelectionEnabled(),
    }).catch(() => {});
    return;
  }

  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = entry.node.path || "";
    WS.nav.dirNode = entry.node;
    syncBulkSelectionForCurrentDir();
    syncHiddenUi();
    syncTagUiForCurrentDir();
    rebuildDirectoriesEntries();
    WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
    syncPreviewToSelection({ force: true });
    renderSelectedFilePreviewBeforeDirectoryPreparation();
    maybeClosePanesForQuickNavigationDirectoryEnter(quickNavigationRestoreState);
    finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(entry.node, {
      animatePreview: false,
      recordHistory: true,
      activatePreviewSelection: enteringFromGrid && previewThumbnailSelectionEnabled(),
    }).catch(() => {});
    return;
  }

  WS.nav.dirNode = entry.node;
  WS.view.aboveRootView = false;
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
  syncPreviewToSelection({ force: true });
  renderSelectedFilePreviewBeforeDirectoryPreparation();
  maybeClosePanesForQuickNavigationDirectoryEnter(quickNavigationRestoreState);
  // Single synchronous render — no pre/post-finalize refresh triple-build.
  finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(entry.node, {
    animatePreview: false,
    recordHistory: true,
    activatePreviewSelection: enteringFromGrid && previewThumbnailSelectionEnabled(),
  }).catch(() => {});
}

function leaveDirectory() {
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  FAST_NAV.mark();
  if (
    String(WS.view?.activePane || "") === "preview" &&
    WS.view.previewFolderBridgeReturnState
  ) {
    syncGridReturnStateToExitedFolder(WS.nav.dirNode);
    if (restorePreviewFolderBridgeState()) return;
  }
  WS.view.previewFolderBridgeReturnState = null;

  if (WS.view.aboveRootView) return;

  if (tryRestoreTagDirectoryContext()) return;

  if (isViewingTagFolder()) {
    exitTagFolderView();
    return;
  }

  if (searchResultsVisibleInDirectoriesPane()) return;
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;

  if (searchBrowsingResultFolder()) {
    returnToSearchResults();
    return;
  }

  if (WS.view.favoritesMode && !WS.view.favoritesRootActive) {
    const cur = String(WS.nav.dirNode?.path || "");
    if (cur && cur === String(WS.view.favoritesAnchorPath || "")) {
      WS.view.favoritesRootActive = true;
      rebuildDirectoriesEntries();
      const idx = findDirEntryIndexByPath(cur);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection({ force: true });
      finalizeDirectoryNavigationRender({ animatePreview: false }).catch(
        () => {},
      );
      return;
    }
  }

  if (WS.view.hiddenMode && !WS.view.hiddenRootActive) {
    const cur = String(WS.nav.dirNode?.path || "");
    if (cur && cur === String(WS.view.hiddenAnchorPath || "")) {
      WS.view.hiddenRootActive = true;
      rebuildDirectoriesEntries();
      const idx = findDirEntryIndexByPath(cur);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection({ force: true });
      finalizeDirectoryNavigationRender({ animatePreview: false }).catch(
        () => {},
      );
      return;
    }
  }

  if (WS.nav.dirNode === WS.root) {
    if (!showRootViewEnabled()) return;
    WS.view.aboveRootView = true;
    rebuildDirectoriesEntries();
    WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
    syncPreviewToSelection({ force: true });
    finalizeDirectoryNavigationRender({
      animatePreview: false,
      recordHistory: true,
    }).catch(() => {});
    return;
  }

  if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
  const child = WS.nav.dirNode;
  WS.nav.dirNode = WS.nav.dirNode.parent;
  WS.view.aboveRootView = false;

  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();

  let idx = 0;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const e = WS.nav.entries[i];
    if (
      e.kind === "dir" &&
      (e.node === child || (child.path && e.node?.path === child.path))
    ) {
      idx = i;
      break;
    }
  }
  WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
  syncPreviewToSelection({ force: true });
  WS.view.pendingDirScroll = "center-selected";
  finalizeDirectoryNavigationRender({
    animatePreview: false,
    recordHistory: true,
  }).catch(() => {});
}

function goDirHistory(delta) {
  if (!WS.view.dirHistory.length) return;
  const next = WS.view.dirHistoryIndex + delta;
  if (next < 0 || next >= WS.view.dirHistory.length) return;
  WS.view.dirHistoryIndex = next;
  restoreDirHistoryEntry(WS.view.dirHistory[next]);
}

function goDirUp() {
  const previewTarget = getPreviewTargetDir();
  const previewExitTarget =
    previewTarget && !previewTarget._skipTagFilters
      ? previewTarget
      : WS.nav.dirNode;
  if (
    String(WS.view?.activePane || "") === "preview" &&
    WS.view.previewFolderBridgeReturnState
  ) {
    syncGridReturnStateToExitedFolder(previewExitTarget);
    if (restorePreviewFolderBridgeState()) return;
  }
  if (
    String(WS.view.activePane || "") === "preview" &&
    previewExitTarget &&
    !previewExitTarget._skipTagFilters &&
    tryRestoreTagDirectoryContext(String(previewExitTarget.path || ""), {
      previewPortalRestore: true,
    })
  )
    return;
  if (tryRestoreTagDirectoryContext()) return;
  if (isViewingTagFolder()) {
    exitTagFolderView();
    return;
  }
  if (!WS.nav.dirNode) return;
  if (
    !WS.nav.dirNode.parent &&
    !(
      WS.nav.dirNode === WS.root &&
      !WS.view.aboveRootView &&
      showRootViewEnabled()
    )
  )
    return;
  leaveDirectory();
}

function toggleFavoritesMode() {
  if (!WS.root) return;
  clearTagNavigationStack();
  WS.view.aboveRootView = false;
  WS.view.tagFolderActiveMode = "";
  WS.view.tagFolderActiveTag = "";
  WS.view.tagFolderActiveAlbum = "";
  WS.view.tagFolderOriginPath = "";

  if (!WS.view.favoritesMode) {
    const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
    WS.view.favoritesReturnState = {
      dirPath: String(WS.nav.dirNode?.path || ""),
      sel: entry
        ? entry.kind === "dir"
          ? { kind: "dir", path: String(entry.node?.path || "") }
          : { kind: "file", id: String(entry.id || "") }
        : null,
    };
    WS.view.favoritesMode = true;
    WS.view.favoritesRootActive = true;
    WS.view.favoritesAnchorPath = "";
  } else {
    WS.view.favoritesMode = false;
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath = "";

    const st = WS.view.favoritesReturnState;
    WS.view.favoritesReturnState = null;

    if (st && WS.root) {
      const dn = WS.dirByPath.get(String(st.dirPath || "")) || WS.root;
      WS.nav.dirNode = dn;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      let idx = 0;
      if (st.sel && st.sel.kind === "dir") {
        const p = String(st.sel.path || "");
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e2 = WS.nav.entries[i];
          if (e2 && e2.kind === "dir" && String(e2.node?.path || "") === p) {
            idx = i;
            break;
          }
        }
      } else if (st.sel && st.sel.kind === "file") {
        const id = String(st.sel.id || "");
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e2 = WS.nav.entries[i];
          if (e2 && e2.kind === "file" && String(e2.id || "") === id) {
            idx = i;
            break;
          }
        }
      }
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection({ force: true });
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return;
    }
  }

  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
  syncPreviewToSelection({ force: true });
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function toggleHiddenMode() {
  if (!WS.root) return;
  clearTagNavigationStack();
  WS.view.aboveRootView = false;
  WS.view.tagFolderActiveMode = "";
  WS.view.tagFolderActiveTag = "";
  WS.view.tagFolderActiveAlbum = "";
  WS.view.tagFolderOriginPath = "";

  if (!WS.view.hiddenMode) {
    const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
    WS.view.hiddenReturnState = {
      dirPath: String(WS.nav.dirNode?.path || ""),
      sel: entry
        ? entry.kind === "dir"
          ? { kind: "dir", path: String(entry.node?.path || "") }
          : { kind: "file", id: String(entry.id || "") }
        : null,
    };
    WS.view.hiddenMode = true;
    WS.view.hiddenRootActive = true;
    WS.view.hiddenAnchorPath = "";
  } else {
    WS.view.hiddenMode = false;
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = "";

    const st = WS.view.hiddenReturnState;
    WS.view.hiddenReturnState = null;

    if (st && WS.root) {
      const dn = WS.dirByPath.get(String(st.dirPath || "")) || WS.root;
      WS.nav.dirNode = dn;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      let idx = 0;
      if (st.sel && st.sel.kind === "dir") {
        const p = String(st.sel.path || "");
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e2 = WS.nav.entries[i];
          if (e2 && e2.kind === "dir" && String(e2.node?.path || "") === p) {
            idx = i;
            break;
          }
        }
      } else if (st.sel && st.sel.kind === "file") {
        const id = String(st.sel.id || "");
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e2 = WS.nav.entries[i];
          if (e2 && e2.kind === "file" && String(e2.id || "") === id) {
            idx = i;
            break;
          }
        }
      }
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection({ force: true });
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return;
    }
  }

  TAG_EDIT_PATH = null;
  RENAME_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
  syncPreviewToSelection({ force: true });
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}
