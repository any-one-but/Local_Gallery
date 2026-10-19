/* Restoring the view
   Refresh snapshots, the return bridges and location states. */

function snapshotRefreshState() {
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  let entryKey = null;
  if (entry && entry.kind === "dir") {
    entryKey = { kind: "dir", path: String(entry.node?.path || "") };
  } else if (entry && entry.kind === "file") {
    const rec = WS.fileById.get(entry.id);
    entryKey = { kind: "file", relPath: String(rec?.relPath || "") };
  }

  return {
    dirPath: String(WS.nav.dirNode?.path || ""),
    entryKey,
    view: {
      filterMode: WS.view.filterMode,
      aspectRatioFilterMode: WS.view.aspectRatioFilterMode,
      loopWithinDir: WS.view.loopWithinDir,
      aboveRootView: !!WS.view.aboveRootView,
      tagFolderActiveMode: WS.view.tagFolderActiveMode,
      tagFolderActiveTag: WS.view.tagFolderActiveTag,
      tagFolderActiveAlbum: WS.view.tagFolderActiveAlbum,
      tagFolderOriginPath: WS.view.tagFolderOriginPath,
      favoritesMode: WS.view.favoritesMode,
      favoritesRootActive: !!WS.view.favoritesRootActive,
      favoritesAnchorPath: WS.view.favoritesAnchorPath,
      hiddenMode: WS.view.hiddenMode,
      hiddenRootActive: !!WS.view.hiddenRootActive,
      hiddenAnchorPath: WS.view.hiddenAnchorPath,
      dirSearchPinned: WS.view.dirSearchPinned,
      previewSearchActive: !!WS.view.previewSearchActive,
      dirSearchQuery: WS.view.dirSearchQuery,
      searchRootActive: WS.view.searchRootActive,
      searchRootPath: WS.view.searchRootPath,
      searchAnchorPath: WS.view.searchAnchorPath,
      searchEntryRootPath: WS.view.searchEntryRootPath,
      searchRootIsFavorites: WS.view.searchRootIsFavorites,
      searchRootIsHidden: WS.view.searchRootIsHidden,
    },
  };
}

function normalizeMediaFilterMode(value) {
  const mode = String(value || "");
  if (mode === "gifs") return "images";
  return ["all", "images", "videos", "text"].includes(mode) ? mode : "all";
}

function restoreRefreshViewState(viewState) {
  if (!viewState) return;
  WS.view.filterMode = normalizeMediaFilterMode(viewState.filterMode);
  WS.view.aspectRatioFilterMode = normalizeAspectRatioFilterMode(viewState.aspectRatioFilterMode);
  WS.view.loopWithinDir = viewState.loopWithinDir;
  WS.view.folderBehavior = "slide";
  WS.view.aboveRootView = !!viewState.aboveRootView && showRootViewEnabled();
  WS.view.tagFolderActiveMode = String(viewState.tagFolderActiveMode || "");
  WS.view.tagFolderActiveTag = String(viewState.tagFolderActiveTag || "");
  WS.view.tagFolderActiveAlbum = String(viewState.tagFolderActiveAlbum || "");
  WS.view.tagFolderOriginPath = String(viewState.tagFolderOriginPath || "");
  WS.view.favoritesMode = !!viewState.favoritesMode;
  WS.view.favoritesRootActive = !!viewState.favoritesRootActive;
  WS.view.favoritesAnchorPath = String(viewState.favoritesAnchorPath || "");
  WS.view.hiddenMode = !!viewState.hiddenMode;
  WS.view.hiddenRootActive = !!viewState.hiddenRootActive;
  WS.view.hiddenAnchorPath = String(viewState.hiddenAnchorPath || "");
  WS.view.dirSearchPinned = !!viewState.dirSearchPinned;
  WS.view.previewSearchActive = !!viewState.previewSearchActive;
  WS.view.dirSearchQuery = String(viewState.dirSearchQuery || "");
  WS.view.searchRootActive = !!viewState.searchRootActive;
  WS.view.searchRootPath = String(viewState.searchRootPath || "");
  WS.view.searchAnchorPath = String(viewState.searchAnchorPath || "");
  WS.view.searchEntryRootPath = String(viewState.searchEntryRootPath || "");
  WS.view.searchRootIsFavorites = !!viewState.searchRootIsFavorites;
  WS.view.searchRootIsHidden = !!viewState.searchRootIsHidden;
  WS.view.searchRootFavorites = WS.view.searchRootIsFavorites
    ? getAllFavoriteDirs()
    : [];
  WS.view.searchRootHidden = WS.view.searchRootIsHidden
    ? getAllHiddenDirs()
    : [];
}

function restoreRefreshSelection(entryKey) {
  if (!entryKey) return 0;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry) continue;
    if (entryKey.kind === "dir" && entry.kind === "dir") {
      if (String(entry.node?.path || "") === String(entryKey.path || ""))
        return i;
    } else if (entryKey.kind === "file" && entry.kind === "file") {
      const rec = WS.fileById.get(entry.id);
      if (String(rec?.relPath || "") === String(entryKey.relPath || ""))
        return i;
    }
  }
  return 0;
}

function captureViewerCloseRestoreState(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const snap = snapshotRefreshState();
  const previewContextKey = currentPreviewSelectionContextKeyFromState();
  const tagNavStack = Array.isArray(WS.view && WS.view.tagNavStack)
    ? WS.view.tagNavStack.map((frame) =>
        frame && typeof frame === "object" ? Object.assign({}, frame) : frame,
      )
    : [];
  return {
    dirPath: String(snap.dirPath || ""),
    entryKey: entryKeyForSelection(
      WS.nav.entries[WS.nav.selectedIndex] || null,
    ),
    view: snap.view ? Object.assign({}, snap.view) : null,
    tagNavStack,
    activePane: options.activePane === "directories" ? "directories" : "preview",
    directoriesScrollTop: getDirectoriesScrollTop(),
    navEntries: Array.isArray(WS.nav.entries) ? WS.nav.entries.slice() : [],
    navEntriesRevision: NAV_ENTRY_RESTORE_REVISION,
    previewState: capturePreviewRestoreState(),
    pendingPreviewSelectionKey: String(
      options.pendingPreviewSelectionKey || "",
    ),
    previewContextKey,
    previewSelectedKey: String((WS.view && WS.view.previewSelectedKey) || ""),
    previewFolderBridgeReturnState: cloneViewerCloseRestoreState(
      WS.view?.previewFolderBridgeReturnState,
    ),
  };
}

function cloneNavEntryForRestore(entry) {
  return entry && typeof entry === "object" ? Object.assign({}, entry) : entry;
}

function capturePreviewRestoreState(previewState = null) {
  const src =
    previewState && typeof previewState === "object" ? previewState : WS.preview;
  if (!src || !src.kind) return null;
  if (src.kind === "dir" && src.dirNode) {
    if (src.dirNode._skipTagFilters) {
      return {
        kind: "tag-dir",
        mode: String(src.dirNode._tagPreviewMode || ""),
        tag: String(src.dirNode._tagPreviewTag || ""),
        album: String(src.dirNode._tagPreviewAlbum || ""),
        originPath: String(
          src.dirNode._tagPreviewOriginPath || src.dirNode.parent?.path || "",
        ),
      };
    }
    return {
      kind: "dir",
      path: String(src.dirNode.path || ""),
    };
  }
  if (src.kind === "file" && src.fileId) {
    return {
      kind: "file",
      fileId: String(src.fileId || ""),
      dirPath: String(src.dirNode?.path || ""),
    };
  }
  return null;
}

function clonePreviewRestoreState(state) {
  if (!state || typeof state !== "object") return null;
  const kind = String(state.kind || "");
  if (kind === "tag-dir") {
    return {
      kind,
      mode: String(state.mode || ""),
      tag: String(state.tag || ""),
      album: String(state.album || ""),
      originPath: String(state.originPath || ""),
    };
  }
  if (kind === "dir") {
    return {
      kind,
      path: String(state.path || ""),
    };
  }
  if (kind === "file") {
    return {
      kind,
      fileId: String(state.fileId || ""),
      dirPath: String(state.dirPath || ""),
    };
  }
  return null;
}

// Resolve a capturePreviewRestoreState() snapshot back into WS.preview after a
// full workspace rebuild (storage toggle, add content, refresh — anything that
// goes through buildWorkspaceFrom*). Returns true only when the captured
// location still exists and was applied, so the caller can fall back to
// deriving the preview from the selection. Mirrors the previewState branches of
// restoreViewerCloseState() so a rebuild restores the exact previewed location
// instead of teleporting to whatever the file-pane selection resolves to.
function applyCapturedPreviewStateAfterRebuild(previewState) {
  const st = clonePreviewRestoreState(previewState);
  if (!st) return false;
  if (st.kind === "tag-dir") {
    const node = makeTagPreviewNodeForContext(
      st.mode || "",
      st.tag || "",
      st.originPath || "",
      st.album || "",
    );
    if (!node) return false;
    applyPreviewState({ kind: "dir", dirNode: node, fileId: null });
    return true;
  }
  if (st.kind === "dir") {
    const node = WS.dirByPath.get(String(st.path || "")) || null;
    if (!node) return false;
    applyPreviewState({ kind: "dir", dirNode: node, fileId: null });
    return true;
  }
  if (st.kind === "file") {
    const fid = String(st.fileId || "");
    if (!fid || !WS.fileById.has(fid)) return false;
    applyPreviewState({
      kind: "file",
      dirNode: resolveFilePreviewContextDir(st, fid),
      fileId: fid,
    });
    return true;
  }
  return false;
}

// Snapshot everything a same-root workspace rebuild (storage toggle, add
// content, refresh via a file list) must restore so it does not dump the user
// back at the root's first item: the authoritative directory + selection + view
// flags and the exact previewed location. Captured before the tree is torn
// down; the previewed location is re-applied with
// applyCapturedPreviewStateAfterRebuild().
function captureSameRootRebuildState() {
  const state = snapshotRefreshState();
  state.previewState = capturePreviewRestoreState();
  return state;
}

// Re-apply the directory + selection + previewed location captured by
// captureSameRootRebuildState() after the tree has been rebuilt. The preview is
// restored verbatim when its target still exists; only when it is gone (e.g. the
// previewed folder is the one just sent to storage) do we derive it from the
// restored selection.
function applySameRootRebuildLocation(preservedState) {
  restoreRefreshViewState(preservedState.view);
  WS.nav.dirNode = WS.dirByPath.get(preservedState.dirPath || "") || WS.root;
  syncActivePaneWithLayout();
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncTagUiForCurrentDir();
  if (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim()) {
    computeDirectorySearchResults();
  }
  rebuildDirectoriesEntries();
  primeTagDerivedCachesForDir(WS.root);
  const restoredIdx = restoreRefreshSelection(preservedState.entryKey);
  WS.nav.selectedIndex = findNearestSelectableIndex(restoredIdx, 1);
  if (!applyCapturedPreviewStateAfterRebuild(preservedState.previewState)) {
    syncPreviewToSelection({ force: true });
  }
}

function cloneViewerCloseRestoreState(state) {
  if (!state || typeof state !== "object") return null;
  return {
    dirPath: String(state.dirPath || ""),
    entryKey: String(state.entryKey || ""),
    view:
      state.view && typeof state.view === "object"
        ? Object.assign({}, state.view)
        : null,
    tagNavStack: Array.isArray(state.tagNavStack)
      ? state.tagNavStack
          .map((frame) =>
            frame && typeof frame === "object" ? Object.assign({}, frame) : frame,
          )
          .filter(Boolean)
      : [],
    activePane: "preview",
    directoriesScrollTop: Number(state.directoriesScrollTop) || 0,
    navEntries: Array.isArray(state.navEntries)
      ? state.navEntries.map(cloneNavEntryForRestore).filter(Boolean)
      : [],
    navEntriesRevision: Number.isFinite(Number(state.navEntriesRevision))
      ? Number(state.navEntriesRevision)
      : -1,
    previewState: clonePreviewRestoreState(state.previewState),
    pendingPreviewSelectionKey: String(state.pendingPreviewSelectionKey || ""),
    previewContextKey: String(state.previewContextKey || ""),
    previewSelectedKey: String(state.previewSelectedKey || ""),
    previewFolderBridgeReturnState: state.previewFolderBridgeReturnState
      ? cloneViewerCloseRestoreState(state.previewFolderBridgeReturnState)
      : null,
  };
}

function retargetViewerCloseRestoreStateToDir(state, dirNode) {
  if (!state || !dirNode) return state;
  const targetPath = String(dirNode.path || "");
  if (!targetPath) return state;
  const targetEntryKey = `dir:${targetPath}`;
  const view = state.view && typeof state.view === "object" ? state.view : null;
  const hasPortalHistory = !!(
    Array.isArray(state.tagNavStack) && state.tagNavStack.length
  );
  const plainDirectoryContext = !!(
    dirNode.parent &&
    view &&
    !view.searchRootActive &&
    !view.tagFolderActiveMode &&
    !view.favoritesMode &&
    !view.hiddenMode &&
    !hasPortalHistory
  );

  state.entryKey = targetEntryKey;
  state.previewState = capturePreviewRestoreState({
    kind: "dir",
    dirNode,
    fileId: null,
  });
  state.previewContextKey = targetEntryKey;
  if (plainDirectoryContext) {
    state.dirPath = String(dirNode.parent?.path || "");
  }

  const nested = cloneViewerCloseRestoreState(state.previewFolderBridgeReturnState);
  if (nested) {
    nested.pendingPreviewSelectionKey = targetEntryKey;
    state.previewFolderBridgeReturnState = nested;
  }

  return state;
}

function resolvePreviewFileBridgeReturnState(pendingPreviewSelectionKey = "") {
  const base = cloneViewerCloseRestoreState(WS.view?.previewFileBridgeReturnState);
  if (!base) return null;
  base.activePane = "preview";
  base.pendingPreviewSelectionKey = String(pendingPreviewSelectionKey || "");

  const currentPreviewDir =
    WS.preview && WS.preview.kind === "file" ? WS.preview.dirNode || null : null;
  const pendingFileTarget = parsePreviewFileSelectionKey(pendingPreviewSelectionKey);
  if (
    currentPreviewDir &&
    !currentPreviewDir._skipTagFilters &&
    !expandedPreviewRestoreStateContainsFile(base, pendingFileTarget)
  ) {
    retargetViewerCloseRestoreStateToDir(base, currentPreviewDir);
  }

  return base;
}

function expandedPreviewRestoreStateContainsFile(state, fileTarget) {
  if (!expandedPreviewModeEnabled()) return false;
  if (!state || !fileTarget || !fileTarget.fileId) return false;
  const previewState = state.previewState || null;
  if (!previewState || String(previewState.kind || "") !== "dir") return false;
  const previewDir = WS.dirByPath.get(String(previewState.path || "")) || null;
  if (!previewDir) return false;
  const fileRec = WS.fileById.get(String(fileTarget.fileId || ""));
  const fileDirPath = String(fileTarget.dirPath || fileRec?.dirPath || "");
  if (!fileDirPath) return false;
  if (fileDirPath === String(previewDir.path || "")) return true;
  const fileDir = WS.dirByPath.get(fileDirPath) || null;
  if (!fileDir || fileDir.parent !== previewDir) return false;
  return shouldExpandPreviewFolderEntry({ kind: "dir", node: fileDir });
}

function restorePreviewFolderBridgeState() {
  const state = cloneViewerCloseRestoreState(WS.view?.previewFolderBridgeReturnState);
  WS.view.previewFolderBridgeReturnState = null;
  if (!state) return false;
  state.activePane = "preview";
  return restoreViewerCloseState(state, { preserveViewFilters: true });
}

// While a folder or its media is previewing, the user can move to a different
// folder (prev/next folder, random jump). The bridge return state still points
// its grid selection at the folder originally entered, so on exit re-point it
// to the folder actually being left and, if that folder lives under a different
// parent, re-anchor the restored grid to that parent so its card exists. Folder
// grid jumps only update WS.preview; direct leave actions pass the current
// navigation folder because it is the authoritative exit target.
function syncGridReturnStateToExitedFolder(exitDirNode = null) {
  const state = WS.view && WS.view.previewFolderBridgeReturnState;
  if (!state) return;
  const explicitExitDir =
    exitDirNode && !exitDirNode._skipTagFilters ? exitDirNode : null;
  const previewTarget = getPreviewTargetDir();
  // Leaving a Tag's own grid (a Tag opened from inside another Tag, or from a
  // folder): the thing being left is that Tag. The file pane still sits at the
  // folder the Tag hangs off, which is not in the grid being returned to, so
  // falling through to it selected the first card instead.
  if (
    previewTarget &&
    previewTarget._skipTagFilters &&
    (!explicitExitDir || explicitExitDir === previewTarget.parent)
  ) {
    const tagKey = entryKeyForSelection(
      tagEntryForPreviewPlaceholderNode(previewTarget),
    );
    if (tagKey) {
      state.pendingPreviewSelectionKey = tagKey;
      state.previewSelectedKey = tagKey;
    }
    return;
  }
  const previewExitDir =
    previewTarget && !previewTarget._skipTagFilters ? previewTarget : null;
  const cur =
    previewExitDir || explicitExitDir || WS.nav.dirNode;
  if (!cur || cur === WS.root || !cur.path) return;
  const curKey = `dir:${String(cur.path || "")}`;
  state.pendingPreviewSelectionKey = curKey;
  state.previewSelectedKey = curKey;
  const portalFrame = Array.isArray(state.tagNavStack)
    ? state.tagNavStack
        .slice()
        .reverse()
        .find(
          (frame) =>
            frame &&
            frame.type === "tag-view" &&
            findMatchingVirtualPortalRootPath(frame, cur.path || ""),
        )
    : null;
  if (portalFrame) {
    state.entryKey = curKey;
    portalFrame.selectedDirPath = String(cur.path || "");
    return;
  }
  const parent = cur.parent;
  if (!parent || parent._skipTagFilters) return;
  const parentPath = String(parent.path || "");
  const capturedPreviewPath =
    state.previewState && state.previewState.kind === "dir"
      ? String(state.previewState.path || "")
      : "";
  if (capturedPreviewPath === parentPath) return; // same grid (e.g. sibling move)
  const grandparent = parent.parent;
  if (!grandparent) return;
  state.dirPath = String(grandparent.path || "");
  state.entryKey = `dir:${parentPath}`;
  state.previewState = { kind: "dir", path: parentPath };
  state.previewContextKey = `dir:${parentPath}`;
}

function restoreNavEntriesFromViewerCloseState(state) {
  if (
    !state ||
    !Array.isArray(state.navEntries) ||
    !state.navEntries.length ||
    Number(state.navEntriesRevision) !== NAV_ENTRY_RESTORE_REVISION
  ) {
    return false;
  }
  WS.nav.entries = state.navEntries.map(cloneNavEntryForRestore).filter(Boolean);
  return !!WS.nav.entries.length;
}

// The context captured for a file preview is the folder it was *opened from*,
// which is not always the file's parent. Two things make it unsafe to restore
// verbatim: an empty dirPath means "no context was captured", but it is also
// root's key, so it silently resolves to root; and a plain folder context can
// have gone stale. Restoring a context the file isn't in makes
// previewFileIdVisibleInContext() fail and the pane render "No visible file".
//
// Portal contexts (tag/favorites/hidden) are the location and are trusted as-is.
// A plain folder is trusted only when it really is the file's own folder.
function resolveFilePreviewContextDir(previewState, fileId) {
  const captured = WS.dirByPath.get(String(previewState?.dirPath || "")) || null;
  if (captured && captured._skipTagFilters) return captured;
  const rec = WS.fileById.get(String(fileId || ""));
  const own = WS.dirByPath.get(String(rec?.dirPath || "")) || null;
  if (captured && own && captured === own) return captured;
  return own || captured;
}

function restoreViewerCloseState(state, opts = null) {
  if (!state || !WS.root) return false;
  const options = opts && typeof opts === "object" ? opts : {};
  const preferCachedEntries = !!options.preferCachedEntries;
  const deferDirectoriesRender = !!options.deferDirectoriesRender;
  const hideBusyAfterDeferredRender = !!options.hideBusyAfterDeferredRender;
  const preserveViewFilters = !!options.preserveViewFilters;
  // Restore the captured preview even when the file pane is the active pane.
  //
  // The viewer-close and bridge callers only care about the preview when they
  // land back in it, and re-deriving it from the selection is equivalent for
  // them — they resume the same view they left. A jump to a new location is
  // different: the derive path reads the *live* WS.preview for a previewed
  // file's context (see currentFilePreviewContextDir), which mid-jump is still
  // the place being left. The snapshot already records the right context, so a
  // jump restores it directly instead. Opt-in, to leave the bridge paths'
  // behaviour untouched.
  const restorePreviewForAnyPane = !!options.restorePreviewForAnyPane;
  const currentFilterMode = normalizeMediaFilterMode(WS.view?.filterMode);
  const currentAspectRatioFilterMode = normalizeAspectRatioFilterMode(
    WS.view?.aspectRatioFilterMode,
  );
  cancelPendingNavigationRender();
  const restoreRenderToken = NAVIGATION_RENDER_TOKEN;
  restoreRefreshViewState(state.view || null);
  if (preserveViewFilters) {
    WS.view.filterMode = currentFilterMode;
    WS.view.aspectRatioFilterMode = currentAspectRatioFilterMode;
  }
  WS.view.tagNavStack = Array.isArray(state.tagNavStack)
    ? state.tagNavStack
        .map((frame) =>
          frame && typeof frame === "object" ? Object.assign({}, frame) : frame,
        )
        .filter(Boolean)
    : [];
  WS.view.previewFolderBridgeReturnState = cloneViewerCloseRestoreState(
    state.previewFolderBridgeReturnState,
  );
  WS.nav.dirNode = WS.dirByPath.get(String(state.dirPath || "")) || WS.root;
  pruneStaleVirtualPortalFramesForPath(WS.nav.dirNode?.path || "");
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  const restoredCachedEntries =
    preferCachedEntries && restoreNavEntriesFromViewerCloseState(state);
  if (!restoredCachedEntries) {
    rebuildDirectoriesEntries({
      preserveTagEntryCaches: !!options.preserveTagEntryCaches,
    });
  }
  const idx = findEntryIndexByKey(String(state.entryKey || ""));
  WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
  setActivePane(
    state.activePane === "preview" || state.activePane === "directories"
      ? state.activePane
      : "directories",
  );
  const previewState = clonePreviewRestoreState(state.previewState);
  const previewContextKey = String(state.previewContextKey || "");
  let restoredPreview = false;
  if (restorePreviewForAnyPane || WS.view.activePane === "preview") {
    if (previewState && previewState.kind === "tag-dir") {
      const previewNode = makeTagPreviewNodeForContext(
        previewState.mode || "",
        previewState.tag || "",
        previewState.originPath || "",
        previewState.album || "",
      );
      if (previewNode) {
        applyPreviewState({ kind: "dir", dirNode: previewNode, fileId: null });
        restoredPreview = true;
      }
    } else if (previewState && previewState.kind === "dir") {
      const previewNode =
        WS.dirByPath.get(String(previewState.path || "")) || null;
      if (previewNode) {
        applyPreviewState({ kind: "dir", dirNode: previewNode, fileId: null });
        restoredPreview = true;
      }
    } else if (previewState && previewState.kind === "file") {
      const previewFileId = String(previewState.fileId || "");
      if (previewFileId && WS.fileById.has(previewFileId)) {
        applyPreviewState({
          kind: "file",
          dirNode: resolveFilePreviewContextDir(previewState, previewFileId),
          fileId: previewFileId,
        });
        restoredPreview = true;
      }
    } else if (previewContextKey.startsWith("dir:")) {
      const previewPath = previewContextKey.slice(4);
      const previewNode = WS.dirByPath.get(previewPath) || null;
      if (previewNode) {
        applyPreviewState({ kind: "dir", dirNode: previewNode, fileId: null });
        restoredPreview = true;
      }
    } else if (previewContextKey.startsWith("file:")) {
      const previewFileId = previewContextKey.slice(5);
      if (previewFileId && WS.fileById.has(previewFileId)) {
        applyPreviewState({
          kind: "file",
          dirNode: null,
          fileId: previewFileId,
        });
        restoredPreview = true;
      }
    }
  }
  // The file-pane cursor follows the restored place, not a remembered row
  // number that a re-sort may have moved onto something else.
  if (restoredPreview) alignNavSelectionToPreviewLocation();
  if (!restoredPreview) {
    // Nothing captured to restore (e.g. a jump to the root). WS.preview still
    // holds the place being left, and currentFilePreviewContextDir() reads it to
    // pick a previewed file's context — so clear it first, or that folder leaks
    // in and the file resolves against a folder it isn't in.
    if (restorePreviewForAnyPane) applyPreviewState(null);
    // A restore is a deliberate move: follow the restored cursor.
    syncPreviewToSelection({ force: true });
  }
  WS.view.pendingPreviewSelectionKey = String(
    state.pendingPreviewSelectionKey ||
      (WS.view.activePane === "preview" ? state.previewSelectedKey || "" : ""),
  );
  const restoreDirectoriesScroll = () => {
    if (
      directoriesListEl &&
      Number.isFinite(Number(state.directoriesScrollTop))
    ) {
      directoriesListEl.scrollTop = Math.max(
        0,
        Number(state.directoriesScrollTop) || 0,
      );
    }
  };
  if (!deferDirectoriesRender) {
    renderDirectoriesPane(true);
    restoreDirectoriesScroll();
  }
  renderPreviewPane(false, true);
  if (WS.view.activePane === "preview") activatePreviewPaneSelection();
  else updatePreviewSelectionClasses();
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  if (deferDirectoriesRender) {
    requestAnimationFrame(() => {
      try {
        if (restoreRenderToken !== NAVIGATION_RENDER_TOKEN) return;
        renderDirectoriesPane(true, { suppressSelectionReveal: true });
        restoreDirectoriesScroll();
        updatePreviewSelectionClasses();
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      } finally {
        if (
          hideBusyAfterDeferredRender &&
          restoreRenderToken === NAVIGATION_RENDER_TOKEN
        ) {
          hideBusyOverlay();
        }
      }
    });
  }
  return true;
}

// =========================================================
// Locations
// ---------------------------------------------------------
// A location is a captureViewerCloseRestoreState() snapshot -- the same shape
// the viewer-close and preview-folder bridges use -- built to sit *at* an item:
// the preview shows it and the file pane sits in its parent. Jump to..., the
// random jumps, the root folder steps and the quick-navigation exit all land
// through these, and session resume stores one.
// =========================================================
// A view state carrying the current filters but none of the portal/search modes
// (tag folder, favorites, hidden, search). A jump to a plain location must not
// inherit, say, an active search root from the place it was made from — those
// modes describe a different place than the location we are landing on.
function plainLocationViewState(view) {
  return Object.assign({}, view || {}, {
    aboveRootView: false,
    tagFolderActiveMode: "",
    tagFolderActiveTag: "",
    tagFolderActiveAlbum: "",
    tagFolderOriginPath: "",
    favoritesMode: false,
    favoritesRootActive: false,
    favoritesAnchorPath: "",
    hiddenMode: false,
    hiddenRootActive: false,
    hiddenAnchorPath: "",
    dirSearchPinned: false,
    previewSearchActive: false,
    dirSearchQuery: "",
    searchRootActive: false,
    searchRootPath: "",
    searchAnchorPath: "",
    searchEntryRootPath: "",
    searchRootIsFavorites: false,
    searchRootIsHidden: false,
  });
}

// The root landing state a fresh workspace open produces (see
// buildWorkspaceFromDirectoryHandle).
function makeRootLocationState() {
  const base = captureViewerCloseRestoreState();
  return Object.assign(base, {
    dirPath: String(WS.root?.path || ""),
    entryKey: "",
    view: Object.assign(plainLocationViewState(base.view), {
      aboveRootView: showRootViewEnabled(),
    }),
    tagNavStack: [],
    activePane: "preview",
    directoriesScrollTop: 0,
    navEntries: [],
    navEntriesRevision: -1,
    previewState: null,
    pendingPreviewSelectionKey: "",
    previewContextKey: "",
    previewSelectedKey: "",
    previewFolderBridgeReturnState: null,
  });
}

// A nav/grid entry as a location target. Tags and the special buckets
// (Favorites/Hidden/Untagged/Storage) are all "tag" entries and are locations
// in their own right; only the bulk-tag placeholder isn't.
function locationTargetForEntry(entry) {
  if (!entry || entry.placeholder) return null;
  if (entry.kind === "dir" && entry.node) return { kind: "dir", node: entry.node };
  if (entry.kind === "tag")
    return tagEntrySelectionKey(entry) ? { kind: "tag", entry } : null;
  if (entry.kind === "file" && WS.fileById.has(String(entry.id || "")))
    return { kind: "file", id: String(entry.id) };
  return null;
}

// Built from scratch rather than captureViewerCloseRestoreState(). navEntries
// is left empty so the restore rebuilds them for the target directory.
function makeLocationState(target, baseView = null) {
  const view = plainLocationViewState(baseView || snapshotRefreshState().view);
  let dirPath = "";
  let entryKey = "";
  let previewState = null;

  if (target.kind === "dir") {
    const node = target.node;
    const parent = node.parent || null;
    if (parent) {
      dirPath = String(parent.path || "");
      entryKey = `dir:${String(node.path || "")}`;
    } else {
      // The root has no parent to sit above, so land in it instead.
      dirPath = String(node.path || "");
      entryKey = "";
    }
    previewState = { kind: "dir", path: String(node.path || "") };
  } else if (target.kind === "tag") {
    // A portal is anchored to a real folder, so the view sits in that folder with
    // the album/tag entry selected and the portal in the preview. The
    // previewState is produced by capturePreviewRestoreState() rather than
    // hand-rolled, so it matches the "tag-dir" shape the restore expects.
    const node = makeTagPreviewNode(target.entry);
    const base =
      node?.parent ||
      WS.dirByPath.get(String(target.entry?.originPath || "")) ||
      WS.root;
    dirPath = String(base?.path || "");
    entryKey = entryKeyForSelection(target.entry);
    previewState = node
      ? capturePreviewRestoreState({ kind: "dir", dirNode: node, fileId: null })
      : null;
  } else {
    const rec = WS.fileById.get(target.id);
    dirPath = String(rec?.dirPath || "");
    entryKey = `file:${String(target.id)}`;
    previewState = { kind: "file", fileId: String(target.id), dirPath };
  }

  return {
    dirPath,
    entryKey,
    view,
    tagNavStack: [],
    activePane: "preview",
    directoriesScrollTop: 0,
    navEntries: [],
    navEntriesRevision: -1,
    previewState,
    pendingPreviewSelectionKey: "",
    previewContextKey: "",
    previewSelectedKey: "",
    previewFolderBridgeReturnState: null,
  };
}

// The node whose contents a target exposes: a folder directly, a portal via its
// synthetic node. Files have no sub-items.
function subItemSourceNodeForTarget(target) {
  if (!target) return null;
  if (target.kind === "dir") return target.node || null;
  if (target.kind === "tag") return makeTagPreviewNode(target.entry);
  return null;
}

// ---- Serializing a location -------------------------------------------
// Only durable identity is written: navEntries (live DirNode refs) and the
// revision counter are session-scoped and always rebuilt on load.
function serializeLocationState(state) {
  if (!state || typeof state !== "object") return null;
  const previewState = clonePreviewRestoreState(state.previewState);
  if (previewState && previewState.kind === "file") {
    // fileId is name::lastModified::size::relPath, so editing the file on disk
    // between sessions changes it. relPath is the stable half — keep it so the
    // id can be re-resolved on load.
    const rec = WS.fileById.get(String(previewState.fileId || ""));
    previewState.relPath = String(rec?.relPath || "");
  }
  return {
    dirPath: String(state.dirPath || ""),
    entryKey: String(state.entryKey || ""),
    view: state.view && typeof state.view === "object" ? Object.assign({}, state.view) : null,
    tagNavStack: Array.isArray(state.tagNavStack)
      ? state.tagNavStack.map((frame) =>
          frame && typeof frame === "object" ? Object.assign({}, frame) : frame,
        )
      : [],
    activePane: state.activePane === "preview" ? "preview" : "directories",
    directoriesScrollTop: Number(state.directoriesScrollTop) || 0,
    previewState,
    pendingPreviewSelectionKey: String(state.pendingPreviewSelectionKey || ""),
    previewContextKey: String(state.previewContextKey || ""),
    previewSelectedKey: String(state.previewSelectedKey || ""),
  };
}

function fileIdForRelPathInDir(dirPath, relPath) {
  const targetRel = String(relPath || "");
  if (!targetRel) return "";
  const node = WS.dirByPath.get(String(dirPath || ""));
  const ids = node && Array.isArray(node.childrenFiles) ? node.childrenFiles : null;
  if (ids) {
    for (const id of ids) {
      const rec = WS.fileById.get(id);
      if (rec && String(rec.relPath || "") === targetRel) return id;
    }
  }
  return "";
}

function deserializeLocationState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const dirPath = String(raw.dirPath || "");
  // A location in a folder that no longer exists is dropped.
  if (dirPath && !WS.dirByPath.has(dirPath)) return null;
  const state = cloneViewerCloseRestoreState({
    dirPath,
    entryKey: String(raw.entryKey || ""),
    view: raw.view,
    tagNavStack: raw.tagNavStack,
    activePane: raw.activePane,
    directoriesScrollTop: raw.directoriesScrollTop,
    navEntries: [],
    navEntriesRevision: -1,
    previewState: raw.previewState,
    pendingPreviewSelectionKey: raw.pendingPreviewSelectionKey,
    previewContextKey: raw.previewContextKey,
    previewSelectedKey: raw.previewSelectedKey,
    previewFolderBridgeReturnState: null,
  });
  const rawPreview = raw.previewState;
  if (state.previewState && state.previewState.kind === "file" && rawPreview) {
    const resolved = fileIdForRelPathInDir(
      state.previewState.dirPath,
      rawPreview.relPath,
    );
    if (resolved) state.previewState.fileId = resolved;
    else if (!WS.fileById.has(state.previewState.fileId)) state.previewState = null;
  }
  return state;
}

// Coming back from a page that died or was reloaded under the user: land on
// the location they were actually at, not the library root. Consumed once, so
// a later refresh in the same run keeps its own view. Called once per workspace
// build, after the tree and root landing state exist.
function applySessionResumeView() {
  if (!WS.root) return;
  const resumeState = consumeSessionResumeView();
  if (!resumeState) return;
  try {
    restoreViewerCloseState(resumeState, { restorePreviewForAnyPane: true });
  } catch {}
}

async function refreshWorkspaceFromRootHandle() {
  const rootHandle = WS.meta.fsRootHandle;
  if (!rootHandle) return;
  const state = snapshotRefreshState();
  // The card selected on screen survives a refresh like the place does.
  const selectedCardKey = String(WS.view?.previewSelectedKey || "");

  await buildWorkspaceFromDirectoryHandle(rootHandle);
  if (selectedCardKey && !WS.view.pendingPreviewSelectionKey)
    WS.view.pendingPreviewSelectionKey = selectedCardKey;

  restoreRefreshViewState(state?.view);
  const targetDir =
    WS.dirByPath.get(state?.dirPath || "") ||
    WS.root;
  if (targetDir) WS.nav.dirNode = targetDir;

  if (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim()) {
    computeDirectorySearchResults();
  }

  rebuildDirectoriesEntries();
  const idx = restoreRefreshSelection(state?.entryKey);
  WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
  syncPreviewToSelection();
  scheduleNearbyDirectoryRamWarm(currentNavigationSnapshot());
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}
