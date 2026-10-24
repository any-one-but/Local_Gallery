/* Preview navigation
   Quick navigation, navigateToDirectory and the preview's own scroll. */

/* =========================================================
       Preview Pane
       - inline breadcrumb + counts
       - folder preview shows folder contents
       - file preview shows large in-pane preview (video autoplay)
       ========================================================= */

function dirNodeIsMediaOnlyForQuickNavigation(node) {
  if (!node || isStorageStubDirNode(node)) return false;
  const childDirs = getChildDirsForNode(node);
  if (Array.isArray(childDirs) && childDirs.length) return false;
  const tagEntries = getTagFolderEntriesForDir(node, {
    includePlaceholder: false,
  });
  if (Array.isArray(tagEntries) && tagEntries.length) return false;
  const fileIds = getOrderedFileIdsForDir(node);
  return Array.isArray(fileIds) && fileIds.length > 0;
}

function enterMediaFolderWithQuickNavigation(node) {
  // Opening a media folder from the grid makes that media folder the active
  // navigation context so its files can be previewed immediately.
  //
  // Capture the full pre-open browsing state (current directory, the selected
  // child, the previewed subfolder, and the grid selection = this media
  // folder) BEFORE descending, so that closing can jump back to it
  // in one step and keep this folder selected in the grid. This is the same
  // bridge mechanism navigateToDirectory() uses for regular folders.
  const restoreState = captureQuickNavigationDirectoryEnterRestoreState({
    kind: "dir",
    node,
  });
  // Quick nav establishes its own folder-level return via the preview-folder
  // bridge (below). Any leftover single-file selection bridge from a prior
  // grid file-open is a *different*, conflicting return mechanism: if it were
  // still active, closing this media would hit the file-selection branch in
  // handleClosedFilePaneNavigationAction and only close to the folder grid.
  // Clear it so the quick-nav bridge is the sole return path.
  WS.view.returnToPreviewPaneAfterFileClose = false;
  WS.view.previewFileSelectionBridgeActive = false;
  WS.view.previewFileBridgeReturnState = null;
  pushSimulatedTagViewContextForPath(node?.path || "");
  const gridReturnState = captureViewerCloseRestoreState({
    activePane: "preview",
    pendingPreviewSelectionKey: node.path ? `dir:${String(node.path || "")}` : "",
  });
  // Descending into a real folder exits any tag/album/favorites/hidden/search
  // view that the path ran through. Without this, rebuildDirectoriesEntries
  // would still build the (now-irrelevant) tag/virtual list and leave the
  // preview blank. Mirrors the context handling in enterSelectedDirectory.
  if (isViewingTagFolder()) {
    WS.view.tagFolderActiveMode = "";
    WS.view.tagFolderActiveTag = "";
    WS.view.tagFolderActiveAlbum = "";
    WS.view.tagFolderOriginPath = "";
  }
  if (searchSessionActive() && WS.view.searchRootActive) {
    enterSearchResultContext(node.path || "");
  }
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath = node.path || "";
  }
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = node.path || "";
  }
  WS.nav.dirNode = node;
  WS.view.aboveRootView = false;
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  // Point the preview context at the entered folder before resolving the first
  // file. Otherwise the file preview resolves against the previous (parent)
  // grid folder, can't find the file in that context, and renders blank.
  applyPreviewState({ kind: "dir", dirNode: node, fileId: null });
  WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
  syncPreviewToSelection({ force: true });
  renderSelectedFilePreviewBeforeDirectoryPreparation();
  // Stash the grid return state so leaving restores the exact pre-open view.
  WS.view.previewFolderBridgeReturnState = gridReturnState;
  maybeClosePanesForQuickNavigationDirectoryEnter(restoreState);
  finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(node, {
    animatePreview: false,
    recordHistory: true,
  }).catch(() => {});
}

async function navigateToDirectory(node) {
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  if (!node) return;
  FAST_NAV.mark();
  if (isStorageStubDirNode(node)) {
    showStatusMessage("Storage folders cannot be opened until you remove them from storage.");
    return;
  }
  if (WS.catalog && WS.catalog.enabled && node.loadState !== "loaded") {
    const loaded = await ensureDirectoryHydratedForOpen(node, { label: "Opening folder..." });
    if (!loaded) {
      showStatusMessage("Could not load that folder.");
      return;
    }
  }
  // Quick navigation: opening a media-only folder from the grid dives straight
  // in (first file selected, panes auto-closed = instant fullscreen), matching
  // how opening a media folder from the file pane behaves.
  if (
    quickNavigationEnabled() &&
    node !== WS.root &&
    !node._skipTagFilters &&
    dirNodeIsMediaOnlyForQuickNavigation(node)
  ) {
    enterMediaFolderWithQuickNavigation(node);
    return;
  }
  // A folder opened from a tag/album preview is a portal into the real tree.
  // Capture that virtual context before changing WS.nav.dirNode so its sort
  // override continues through this folder and all descendants.
  pushSimulatedTagViewContextForPath(node.path || "", getPreviewTargetDir());
  const previewBridgeOpen = !!(
    String(WS.view?.activePane || "") === "preview" &&
    getPreviewTargetDir()?._skipTagFilters
  );
  if (previewBridgeOpen && tortoiseNavigationEnabled()) {
    showBusyOverlay("Opening preview...");
    await waitForNextPaint();
  }
  // Stay in the preview pane if it was already active (grid-driven navigation)
  // or if the file pane is closed. This lets the grid selection persist and
  // activates selection on the first item in the new folder's grid.
  const previewWasActive =
    !directoriesPaneOpenEnabled() || WS.view.activePane === "preview";
  const keepPreviewPaneActive = previewWasActive;
  const previewFolderReturnState = captureViewerCloseRestoreState({
    activePane: keepPreviewPaneActive ? "preview" : "directories",
    pendingPreviewSelectionKey: node.path ? `dir:${String(node.path || "")}` : "",
  });
  if (previewFolderReturnState && node.path) {
    previewFolderReturnState.entryKey = `dir:${String(node.path || "")}`;
  }
  // Descending into a real folder exits any tag/album view the path ran
  // through (the return bridge captured above still restores it on close).
  // Without this, rebuildDirectoriesEntries keeps building the tag/virtual
  // list — and for a root-scoped album (originPath ""), getTagFolderBaseNode
  // falls back to the just-entered folder, leaving the file pane empty.
  // Mirrors enterMediaFolderWithQuickNavigation / enterSelectedDirectory.
  if (isViewingTagFolder()) {
    WS.view.tagFolderActiveMode = "";
    WS.view.tagFolderActiveTag = "";
    WS.view.tagFolderActiveAlbum = "";
    WS.view.tagFolderOriginPath = "";
  }
  if (searchSessionActive() && WS.view.searchRootActive) {
    enterSearchResultContext(node.path || "");
  }

  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath = node.path || "";
  }

  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = node.path || "";
  }

  WS.nav.dirNode = node;
  WS.view.aboveRootView = false;
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
  applyPreviewState({ kind: "dir", dirNode: node, fileId: null });
  resetPreviewPaneForEnteredTarget();
  renderSelectedFilePreviewBeforeDirectoryPreparation();
  WS.view.previewFolderBridgeReturnState = previewFolderReturnState;
  setActivePane(keepPreviewPaneActive ? "preview" : "directories");
  const useWindowedBridgePrepare =
    tortoiseNavigationEnabled() && shouldUseWindowedPreviewBridgeSnapshot();
  await finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(node, {
    animatePreview: false,
    activatePreviewSelection:
      keepPreviewPaneActive && previewThumbnailSelectionEnabled(),
    recordHistory: true,
    prepareFull: !useWindowedBridgePrepare,
    schedulePreparedWarm: !useWindowedBridgePrepare,
    deferDirectoriesRender: useWindowedBridgePrepare,
    showBusyBeforeRender: useWindowedBridgePrepare,
    busyLabel: "Opening preview...",
  });
}

function navigateFromPreviewFolderCard(node) {
  if (!node) return;
  if (node.isMissingPlaceholder) {
    showStatusMessage("This item is missing from the current ALT.");
    return;
  }
  navigateToDirectory(node).catch((error) => {
    console.error("Preview folder open failed.", error);
    showStatusMessage("Could not open that folder.");
  });
}

function adoptPreviewParentIntoDirectoriesPane(targetDir) {
  if (!WS.root) return false;
  const parentTarget =
    targetDir || getPreviewTargetDir() || WS.nav.dirNode || WS.root;
  if (!parentTarget) return false;
  const preserveTagEntryCaches = !!parentTarget._skipTagFilters;
  if (parentTarget._skipTagFilters) {
    const originPath = String(
      parentTarget._tagPreviewOriginPath || parentTarget.parent?.path || "",
    );
    const baseNode =
      WS.dirByPath.get(originPath) || parentTarget.parent || WS.root;
    if (!baseNode) return false;
    const modeRaw = String(parentTarget._tagPreviewMode || "");
    const mode =
      modeRaw === "album" ||
      modeRaw === "tag" ||
      modeRaw === "gallery" ||
      modeRaw === "favorites" ||
      modeRaw === "hidden" ||
      modeRaw === "untagged" ||
      modeRaw === "storage"
        ? modeRaw
        : "";
    const tag =
      mode === "tag"
        ? String(parentTarget._tagPreviewTag || "")
        : mode === "gallery"
          ? String(
              parentTarget._tagPreviewGallery ||
                parentTarget._tagPreviewTag ||
                "",
            )
          : "";
    const album =
      mode === "album" || mode === "tag"
        ? String(parentTarget._tagPreviewAlbum || "")
        : "";
    const prevMode = String(WS.view.tagFolderActiveMode || "");
    const prevTag = String(WS.view.tagFolderActiveTag || "");
    const prevAlbum = String(WS.view.tagFolderActiveAlbum || "");
    const prevOriginPath = String(WS.view.tagFolderOriginPath || "");
    const basePath = String(baseNode.path || "");
    const enteringDifferentTagPortal =
      mode &&
      (prevMode !== mode ||
        prevTag !== tag ||
        prevAlbum !== album ||
        prevOriginPath !== basePath);
    if (enteringDifferentTagPortal) {
      pushTagEntryContext(mode, tag, album, {
        baseDirPath: basePath,
        prevMode,
        prevTag,
        prevAlbum,
        prevOriginPath,
        selectedIndex: WS.nav.selectedIndex,
        scrollTop: getDirectoriesScrollTop(),
      });
    }
    WS.nav.dirNode = baseNode;
    WS.view.aboveRootView = false;
    WS.view.tagFolderActiveMode = mode;
    WS.view.tagFolderActiveTag = tag;
    WS.view.tagFolderActiveAlbum = album;
    WS.view.tagFolderOriginPath = originPath;
  } else {
    const selectedPath = String(parentTarget.path || "");
    if (selectedPath) pushSimulatedTagViewContextForPath(selectedPath);
    WS.nav.dirNode = parentTarget;
    WS.view.aboveRootView = false;
    WS.view.tagFolderActiveMode = "";
    WS.view.tagFolderActiveTag = "";
    WS.view.tagFolderActiveAlbum = "";
    WS.view.tagFolderOriginPath = "";
  }
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries({ preserveTagEntryCaches });
  return true;
}

async function openPreviewTagFolderEntry(entry) {
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  if (!entry || entry.placeholder) return;
  const previewBridgeOpen = !!(
    String(WS.view?.activePane || "") === "preview" &&
    getPreviewTargetDir()?._skipTagFilters
  );
  if (previewBridgeOpen && tortoiseNavigationEnabled()) {
    showBusyOverlay("Opening preview...");
    await waitForNextPaint();
  }
  // Stay in the preview pane if it was already active (grid-driven open) or if
  // the file pane is closed — so opening a tag from the grid keeps the
  // selection in the grid instead of jumping to the file pane.
  const keepPreviewPaneActive =
    !directoriesPaneOpenEnabled() || WS.view.activePane === "preview";
  const previewFolderReturnState = captureViewerCloseRestoreState({
    activePane: keepPreviewPaneActive ? "preview" : "directories",
    pendingPreviewSelectionKey: entryKeyForSelection(entry),
  });
  if (previewFolderReturnState) {
    previewFolderReturnState.entryKey = entryKeyForSelection(entry);
  }
  adoptPreviewParentIntoDirectoriesPane(getPreviewTargetDir());

  if (searchSessionActive() && WS.view.searchRootActive) {
    enterSearchResultContext(entry.originPath || "");
  }

  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath =
      WS.nav.dirNode?.path || entry.originPath || "";
  }

  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = WS.nav.dirNode?.path || entry.originPath || "";
  }

  const mode = entry.special
    ? String(entry.special || "")
    : entry.album && !entry.tag
      ? "album"
      : entry.gallery && !entry.tag && !entry.album
        ? "gallery"
      : "tag";
  const tag =
    mode === "tag"
      ? String(entry.tag || "")
      : mode === "gallery"
        ? String(entry.gallery || "")
        : "";
  const album = String(entry.album || "");
  const targetIdx = findTagEntryIndex(mode, tag, album);
  WS.nav.selectedIndex = findNearestSelectableIndex(
    targetIdx >= 0 ? targetIdx : 0,
    1,
  );
  const selectedEntry =
    targetIdx >= 0 ? WS.nav.entries[WS.nav.selectedIndex] || null : null;
  if (selectedEntry) applyPreviewState(previewStateForEntry(selectedEntry));
  else applyPreviewState(previewStateForEntry(entry));
  resetPreviewPaneForEnteredTarget();
  renderSelectedFilePreviewBeforeDirectoryPreparation();
  WS.view.previewFolderBridgeReturnState = previewFolderReturnState;
  setActivePane(keepPreviewPaneActive ? "preview" : "directories");
  const useWindowedBridgePrepare =
    tortoiseNavigationEnabled() && shouldUseWindowedPreviewBridgeSnapshot();
  const rendered = await finalizeDirectoryNavigationRender({
    animatePreview: false,
    activatePreviewSelection:
      keepPreviewPaneActive && previewThumbnailSelectionEnabled(),
    prepareFull: !useWindowedBridgePrepare,
    schedulePreparedWarm: !useWindowedBridgePrepare,
    deferDirectoriesRender: useWindowedBridgePrepare,
    showBusyBeforeRender: useWindowedBridgePrepare,
    busyLabel: "Opening preview...",
  });
  if (rendered) scheduleTagFolderInitialSelectionPreviewRender();
}

function getPreviewTargetDir() {
  if (WS.preview.kind === "file" && WS.preview.dirNode)
    return WS.preview.dirNode;
  if (WS.preview.kind === "dir" && WS.preview.dirNode)
    return WS.preview.dirNode;
  if (WS.preview.kind === "file" && WS.preview.fileId) {
    const rec = WS.fileById.get(WS.preview.fileId);
    const p = rec ? rec.dirPath || "" : "";
    return WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;
  }
  return WS.nav.dirNode || WS.root;
}

function previewScrollKeyForDir(dirNode) {
  if (!dirNode) return "";
  const p = String(dirNode.path || "");
  return p || "__root__";
}

function savePreviewScrollForActiveDir() {
  if (!previewBodyEl) return;
  const key = String(WS.view.previewScrollActiveKey || "");
  if (!key) return;
  if (!previewBodyEl.classList.contains("preview-grid")) return;
  if (!(WS.view.previewScrollByDir instanceof Map))
    WS.view.previewScrollByDir = new Map();
  WS.view.previewScrollByDir.set(
    key,
    Math.max(0, Number(previewBodyEl.scrollTop) || 0),
  );
}

function getSavedPreviewScrollForDir(dirNode) {
  const key = previewScrollKeyForDir(dirNode);
  if (!key || !(WS.view.previewScrollByDir instanceof Map)) return null;
  const val = WS.view.previewScrollByDir.get(key);
  if (!Number.isFinite(val)) return null;
  return Math.max(0, Number(val) || 0);
}

function getDirectoryItemCount(dirNode) {
  if (!dirNode) return 0;
  const matchesCurrentView =
    !!WS.nav.dirNode &&
    (dirNode === WS.nav.dirNode ||
      (String(dirNode.path || "") &&
        String(dirNode.path || "") === String(WS.nav.dirNode?.path || "")) ||
      (dirNode === WS.root && WS.nav.dirNode === WS.root));
  if (matchesCurrentView && Array.isArray(WS.nav.entries)) {
    let count = 0;
    for (let i = 0; i < WS.nav.entries.length; i++) {
      const entry = WS.nav.entries[i];
      if (!entry) continue;
      count++;
    }
    return count;
  }
  const previewEntries = getPreviewFolderAndFileEntries(dirNode, {
    includeFiles: true,
  });
  return previewEntries.folderEntries.length + previewEntries.fileIds.length;
}

function getBreadcrumbNodesForDir(dirNode) {
  const nodes = [];
  let cur = dirNode;
  while (cur) {
    nodes.push(cur);
    cur = cur.parent;
  }
  nodes.reverse();
  return nodes;
}

// Opened media always takes the full app frame (the retired Full screen media
// option, fixed on).
function syncPreviewMediaModeClass(mode = null) {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  const activeMode =
    mode ||
    (previewBodyEl && previewBodyEl.classList.contains("preview-file")
      ? "file"
      : "");
  appEl.classList.toggle("preview-media-mode", activeMode === "file");
  // Prism's turning colours stop while media fills the window.
  document.documentElement.classList.toggle(
    "lgMediaOpen",
    activeMode === "file",
  );
}

function setPreviewBodyMode(mode) {
  if (!previewBodyEl) return;
  previewBodyEl.classList.toggle("preview-file", mode === "file");
  previewBodyEl.classList.toggle("preview-grid", mode === "grid");
  previewBodyEl.classList.remove("preview-expanded");
  previewBodyEl.classList.toggle("preview-placeholder", mode === "placeholder");
  if (mode !== "file" && previewVideoTransitionCanvas)
    hidePreviewVideoTransitionFrame(true);
  syncPreviewMediaModeClass(mode);
}
