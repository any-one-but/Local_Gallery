/* Tag navigation and search
   The Tag navigation stack, opening Tags and the search. */

function getDirectoriesScrollTop() {
  if (!directoriesListEl) return 0;
  return directoriesListEl.scrollTop || 0;
}

function setDirectoriesScrollTop(value) {
  if (!directoriesListEl || typeof value !== "number") return;
  directoriesListEl.scrollTop = value;
}

function restoreDirectoriesScrollWithSelectionReveal(value) {
  setDirectoriesScrollTop(Number(value) || 0);
  if (!directoriesListEl) return;
  if (isGridInteractionMode()) {
    revealSelectedDirectoryRowInGridMode(false);
    return;
  }
  const vis = getSelectedDirectoryRowVisibility();
  if (vis.state === "offscreen") {
    centerSelectedDirectoryRow(0);
  } else if (vis.state === "partial") {
    snapSelectedDirectoryRowFullyIntoView();
  }
}

function ensureTagNavStack() {
  if (!Array.isArray(WS.view.tagNavStack)) WS.view.tagNavStack = [];
  return WS.view.tagNavStack;
}

function isSameOrDescendantPath(path, ancestorPath) {
  const pathNorm = String(path || "");
  const ancestorNorm = String(ancestorPath || "");
  if (!pathNorm || !ancestorNorm) return pathNorm === ancestorNorm;
  return pathNorm === ancestorNorm || pathNorm.startsWith(`${ancestorNorm}/`);
}

function clearTagNavigationStack() {
  WS.view.tagNavStack = [];
}

// Portal navigation is intentionally centralized here.
// This area has had long-running regressions where "leave directory" from a folder entered via
// a virtual folder (especially Favorites/Tags) incorrectly dropped users into the real tree root.
// Keep all virtual-folder matching/restore decisions in this guard so future virtual folder types
// can reuse the exact same behavior without duplicating fragile path logic.
function findMatchingVirtualPortalRootPath(frame, path) {
  const currentPath = String(path || "");
  if (!frame || !currentPath) return "";
  const frameType = String(frame.type || "");
  if (frameType !== "tag-view") return "";
  const selectedRoot = String(frame.selectedDirPath || "");
  if (selectedRoot && isSameOrDescendantPath(currentPath, selectedRoot))
    return selectedRoot;
  const ordered = Array.isArray(frame.orderedPaths) ? frame.orderedPaths : [];
  for (let i = 0; i < ordered.length; i++) {
    const candidate = String(ordered[i] || "");
    if (!candidate) continue;
    if (isSameOrDescendantPath(currentPath, candidate)) return candidate;
  }
  return "";
}

function isVirtualPortalViewFrame(frame) {
  const frameType = String((frame && frame.type) || "");
  return frameType.endsWith("-view");
}

function pruneStaleTagEntryFramesForPath(path) {
  const stack = ensureTagNavStack();
  const currentPath = String(path || "");
  let changed = false;
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!top || top.type !== "tag-entry") break;
    const entryDir = String(top.dirPath || "");
    if (entryDir === currentPath) break;
    stack.pop();
    changed = true;
  }
  return changed;
}

function pruneStaleVirtualPortalFramesForPath(path) {
  const stack = ensureTagNavStack();
  const currentPath = String(path || "");
  let changed = false;
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!top || !isVirtualPortalViewFrame(top)) break;
    if (!currentPath) break;
    if (findMatchingVirtualPortalRootPath(top, currentPath)) break;
    stack.pop();
    changed = true;
  }
  return changed;
}

function pushTagNavFrame(frame) {
  if (!frame) return;
  ensureTagNavStack().push(frame);
}

function pushTagEntryContext(mode, tag, album = "", opts = null) {
  const options = opts && typeof opts === "object" ? opts : null;
  pushTagNavFrame({
    type: "tag-entry",
    dirPath: String(
      options && options.baseDirPath !== undefined
        ? options.baseDirPath
        : WS.nav.dirNode?.path || "",
    ),
    entryMode: mode || "",
    entryTag: tag || "",
    entryAlbum: String(album || ""),
    prevMode: String(
      options && options.prevMode !== undefined
        ? options.prevMode
        : WS.view.tagFolderActiveMode || "",
    ),
    prevTag: String(
      options && options.prevTag !== undefined
        ? options.prevTag
        : WS.view.tagFolderActiveTag || "",
    ),
    prevAlbum: String(
      options && options.prevAlbum !== undefined
        ? options.prevAlbum
        : WS.view.tagFolderActiveAlbum || "",
    ),
    prevOriginPath: String(
      options && options.prevOriginPath !== undefined
        ? options.prevOriginPath
        : WS.view.tagFolderOriginPath || "",
    ),
    selectedIndex: Number.isFinite(options && options.selectedIndex)
      ? Number(options.selectedIndex)
      : WS.nav.selectedIndex,
    scrollTop: Number.isFinite(options && options.scrollTop)
      ? Number(options.scrollTop)
      : getDirectoriesScrollTop(),
  });
}

function pushTagViewContext(selectedDirPath) {
  const currentEntryPaths = Array.isArray(WS.nav && WS.nav.entries)
    ? WS.nav.entries
        .filter((entry) => entry && entry.kind === "dir" && entry.node)
        .map((entry) => String(entry.node.path || ""))
        .filter(Boolean)
    : [];
  const orderedPaths = currentEntryPaths.length
    ? currentEntryPaths
    : getDirsForTagFolderView()
        .map((d) => String(d?.path || ""))
        .filter(Boolean);
  pushTagNavFrame({
    type: "tag-view",
    mode: WS.view.tagFolderActiveMode,
    tag: WS.view.tagFolderActiveTag,
    album: WS.view.tagFolderActiveAlbum,
    originPath: String(WS.view.tagFolderOriginPath || ""),
    selectedDirPath: String(selectedDirPath || ""),
    scrollTop: getDirectoriesScrollTop(),
    orderedPaths,
    sortKey: dirSortDisplayCacheKey(),
  });
}

function tagViewFrameForVirtualTagNode(tagNode, selectedDirPath) {
  if (!tagNode || !tagNode._skipTagFilters) return null;
  const selectedPath = String(selectedDirPath || "");
  if (!selectedPath) return null;
  const originPath = String(
    tagNode._tagPreviewOriginPath || tagNode.parent?.path || "",
  );
  const baseNode = WS.dirByPath.get(originPath) || tagNode.parent || WS.root;
  if (!baseNode) return null;
  const modeRaw = String(tagNode._tagPreviewMode || "");
  const validModes = [
    "tag",
    "album",
    "gallery",
    "favorites",
    "hidden",
    "untagged",
    "storage",
  ];
  const mode = validModes.includes(modeRaw) ? modeRaw : "";
  if (!mode) return null;
  const tag =
    mode === "tag" || mode === "gallery"
      ? String(tagNode._tagPreviewTag || tagNode._tagPreviewGallery || "")
      : "";
  const album =
    mode === "album" || mode === "tag"
      ? String(tagNode._tagPreviewAlbum || "")
      : "";
  const entry = {
    kind: "tag",
    originPath: String(baseNode.path || ""),
    label: String(tagNode.name || mode || "Tag"),
  };
  if (
    mode === "favorites" ||
    mode === "hidden" ||
    mode === "untagged" ||
    mode === "storage"
  ) {
    entry.special = mode;
  } else if (mode === "album") {
    entry.album = album;
  } else if (mode === "gallery") {
    entry.gallery = tag;
  } else {
    entry.tag = tag;
    entry.album = album;
  }
  const orderedPaths = getDirsForTagEntry(entry)
    .map((node) => String(node?.path || ""))
    .filter(Boolean);
  if (!orderedPaths.includes(selectedPath)) orderedPaths.push(selectedPath);
  return {
    type: "tag-view",
    mode,
    tag,
    album,
    originPath: String(baseNode.path || ""),
    selectedDirPath: selectedPath,
    scrollTop: getDirectoriesScrollTop(),
    orderedPaths,
    sortKey: dirSortDisplayCacheKey(),
  };
}

function pushSimulatedTagViewContextForPath(selectedDirPath, sourceDir = null) {
  const selectedPath = String(selectedDirPath || "");
  if (!selectedPath) return false;
  // Prefer the preview portal's own tag context when descending from a tag/album
  // preview grid. A tag reached *through an album* leaves the file pane at the
  // album level (tagFolderActiveMode === "album") while the preview grid shows
  // one specific tag's folders. Capturing the simulated frame from the file-pane
  // state would record mode "album", which resolves to zero sibling dirs, so
  // sliding/jumping inside the entered folder falls through to the real parent's
  // children (the long-standing "jumps into the parent folders, not the tag"
  // bug). The portal node carries the actual tag + album the grid represents, so
  // build the frame from it whenever one is the navigation source.
  const tagNode = sourceDir || getPreviewTargetDir();
  if (tagNode && tagNode._skipTagFilters) {
    const frame = tagViewFrameForVirtualTagNode(tagNode, selectedPath);
    if (frame) {
      pushTagNavFrame(frame);
      return true;
    }
  }
  if (isViewingTagFolder()) {
    pushTagViewContext(selectedPath);
    return true;
  }
  return false;
}

function restoreTagViewFromFrame(frame, opts = null) {
  if (!frame) return false;
  const options = opts && typeof opts === "object" ? opts : null;
  const animatePreview = !(options && options.previewPortalRestore);
  const baseNode = WS.dirByPath.get(String(frame.originPath || "")) || WS.root;
  if (!baseNode) return false;
  cancelPendingNavigationRender();
  WS.nav.dirNode = baseNode;
  applyTagFolderViewState(
    frame.mode || "",
    frame.tag || "",
    frame.originPath,
    frame.album || "",
  );
  const idx = frame.selectedDirPath
    ? findDirEntryIndexByPath(frame.selectedDirPath)
    : -1;
  WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
  if (options && options.previewPortalRestore) {
    const portalNode = makeTagPreviewNodeForContext(
      frame.mode || "",
      frame.tag || "",
      frame.originPath || "",
      frame.album || "",
    );
    const selectedDirPath = String(frame.selectedDirPath || "");
    WS.view.pendingPreviewSelectionKey = selectedDirPath
      ? `dir:${selectedDirPath}`
      : "";
    if (portalNode) {
      applyPreviewState({ kind: "dir", dirNode: portalNode, fileId: null });
    } else {
      syncPreviewToSelection({ force: true });
    }
  } else {
    syncPreviewToSelection({ force: true });
  }
  renderDirectoriesPane(true);
  renderPreviewPane(animatePreview);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  restoreDirectoriesScrollWithSelectionReveal(frame.scrollTop);
  scheduleTagFolderInitialSelectionPreviewRender();
  return true;
}

function restoreDirectoriesFromTagEntryFrame(frame) {
  if (!frame) return false;
  const baseNode = WS.dirByPath.get(String(frame.dirPath || "")) || WS.root;
  if (!baseNode) return false;
  cancelPendingNavigationRender();
  WS.nav.dirNode = baseNode;
  WS.view.tagFolderActiveMode = String(frame.prevMode || "");
  WS.view.tagFolderActiveTag = String(frame.prevTag || "");
  WS.view.tagFolderActiveAlbum = String(frame.prevAlbum || "");
  WS.view.tagFolderOriginPath = String(frame.prevOriginPath || "");
  closeActionMenus();
  rebuildDirectoriesEntries();
  const idx = findTagEntryIndex(
    frame.entryMode,
    frame.entryTag,
    frame.entryAlbum,
  );
  const targetIndex =
    idx >= 0
      ? idx
      : typeof frame.selectedIndex === "number"
        ? frame.selectedIndex
        : 0;
  WS.nav.selectedIndex = findNearestSelectableIndex(targetIndex, 1);
  syncPreviewToSelection({ force: true });
  renderDirectoriesPane(true);
  renderPreviewPane(true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  restoreDirectoriesScrollWithSelectionReveal(frame.scrollTop);
  return true;
}

function tryRestoreTagDirectoryContext(pathOverride = null, opts = null) {
  // Critical behavior:
  // If a user enters from a tag/favorites virtual folder, then traverses inside matching folders,
  // "leave directory" must return to the same virtual folder view (portal) instead of dropping to
  // the real parent/root. This was a long-standing edge-case bug in favorites-root navigation.
  const options = opts && typeof opts === "object" ? opts : null;
  const currentPath =
    pathOverride !== null && pathOverride !== undefined
      ? String(pathOverride || "")
      : String(WS.nav.dirNode?.path || "");
  pruneStaleVirtualPortalFramesForPath(currentPath);
  const stack = WS.view.tagNavStack;
  if (!Array.isArray(stack) || !stack.length) return false;
  const frame = stack[stack.length - 1];
  if (frame.type !== "tag-view") return false;
  const curPath = currentPath;
  const portalRootPath = findMatchingVirtualPortalRootPath(frame, curPath);
  if (!portalRootPath) return false;
  if (curPath !== portalRootPath) return false;
  stack.pop();
  return restoreTagViewFromFrame(
    Object.assign({}, frame, {
      selectedDirPath: portalRootPath,
    }),
    {
      previewPortalRestore: !!(options && options.previewPortalRestore),
    },
  );
}

function tryRestoreTagEntryContext() {
  const stack = WS.view.tagNavStack;
  if (!Array.isArray(stack) || !stack.length) return false;
  const frame = stack[stack.length - 1];
  if (frame.type !== "tag-entry") return false;
  stack.pop();
  return restoreDirectoriesFromTagEntryFrame(frame);
}

function exitTagFolderView() {
  if (!isViewingTagFolder()) return;
  noteResponsiveNavigationInteraction("tag-album-exit", RESPONSIVE_NAV_TAG_ALBUM_MS);
  if (tryRestoreTagEntryContext()) return;
  const ctx = {
    mode: WS.view.tagFolderActiveMode,
    tag: WS.view.tagFolderActiveTag,
    album: WS.view.tagFolderActiveAlbum,
    originPath: WS.view.tagFolderOriginPath,
  };
  if (!restoreTagFolderEntrySelection(ctx)) {
    setTagFolderViewState("", "", "", "");
  }
}

function resolveTagEntryBaseNode(entry) {
  if (!entry) return null;
  const originPath = String(entry.originPath || "");
  if (originPath) {
    const originNode = WS.dirByPath.get(originPath);
    if (originNode) return originNode;
  }
  const previewDir = getPreviewTargetDir();
  if (previewDir && !previewDir._skipTagFilters) return previewDir;
  return WS.nav.dirNode || WS.root || null;
}

function openTagFolderEntry(entry) {
  if (!entry) return;
  FAST_NAV.mark();
  noteResponsiveNavigationInteraction("tag-album-open", RESPONSIVE_NAV_TAG_ALBUM_MS);
  if (entry.placeholder) return;
  const baseNode = resolveTagEntryBaseNode(entry);
  if (!baseNode) return;
  const basePath = String(baseNode.path || "");
  const currentDirPath = String(WS.nav.dirNode?.path || "");
  const rebaseToDifferentDir = currentDirPath !== basePath;
  // Keep nested tag/favorites portal history. We only drop frames that are no longer relevant to
  // the current real directory path; this avoids the old bug where entering a child tag folder
  // replaced outer portal context and caused bad exits back to the real tree.
  pruneStaleVirtualPortalFramesForPath(basePath);
  pruneStaleTagEntryFramesForPath(basePath);
  const album = String(entry.album || "");
  const isAlbumEntry = !!album && !entry.tag && !entry.special;
  const gallery = normalizeGalleryName(entry.gallery || "");
  const isGalleryEntry = !!gallery && !entry.tag && !album && !entry.special;
  const mode = entry.special
    ? entry.special
    : isAlbumEntry
      ? "album"
      : isGalleryEntry
        ? "gallery"
        : "tag";
  const tag = mode === "tag" ? entry.tag || "" : mode === "gallery" ? gallery : "";
  const selectedIndexSourceEntries =
    !rebaseToDifferentDir && Array.isArray(WS.nav.entries) && WS.nav.entries.length
      ? WS.nav.entries
      : getTagFolderEntriesForDir(baseNode, { includePlaceholder: true });
  const selectedIndex = findTagEntryIndexInEntries(
    selectedIndexSourceEntries,
    mode,
    tag,
    album,
  );
  WS.nav.dirNode = baseNode;
  WS.view.aboveRootView = false;
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  pushTagEntryContext(mode, tag, album, {
    baseDirPath: basePath,
    selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
    scrollTop: rebaseToDifferentDir ? 0 : getDirectoriesScrollTop(),
  });
  setTagFolderViewState(mode, tag, basePath, album);
}

// A folder held by an Exclusive Tag lives in that Tag, not in its real parent.
function getChildDirsForNode(dirNode) {
  const held = getTagModel().exclusiveFolders;
  return getChildDirsForNodeBase(dirNode).filter(
    (child) => !held.has(normalizeDirPathValue(child?.path || "")),
  );
}

function getVisibleSiblingDirsForSlide(dirNode) {
  const dp = String(dirNode?.path || "");
  pruneStaleVirtualPortalFramesForPath(dp);

  // While actively browsing a tag (or other simulated) folder, its items behave
  // like real siblings: sliding past the end of one item or random-jumping must
  // move between the *tag's* items, not the real parent folder's children.
  // Previewing/quick-navigating an item before formally descending into it
  // leaves only a "tag-entry" frame on the nav stack (never a "tag-view" frame),
  // so the stack scan below misses the context and falls through to the real
  // parent. Resolve the simulated-folder siblings directly from the active tag
  // context so tag navigation stays inside the tag.
  if (isViewingTagFolder() && dp) {
    const activeTagDirs = getDirsForTagFolderView();
    if (
      activeTagDirs.length &&
      activeTagDirs.some((d) => String(d?.path || "") === dp)
    ) {
      return activeTagDirs;
    }
  }

  const stack = WS.view.tagNavStack;
  if (Array.isArray(stack) && stack.length) {
    const frame = stack[stack.length - 1];
    if (frame && frame.type === "tag-view") {
      const frameSortKey = String(frame.sortKey || "");
      const currentSortKey = dirSortDisplayCacheKey();
      const canUseSavedOrder =
        frameSortKey &&
        frameSortKey === currentSortKey &&
        Array.isArray(frame.orderedPaths) &&
        frame.orderedPaths.length;
      if (canUseSavedOrder) {
        const nodes = frame.orderedPaths
          .map((p) => WS.dirByPath.get(String(p || "")))
          .filter(Boolean);
        if (nodes.length) {
          const match = nodes.some((d) => String(d?.path || "") === dp);
          if (match) return nodes;
        }
      }
      const tagDirs = getDirsForTagViewFrame(frame);
      if (tagDirs.length) {
        const match = tagDirs.some((d) => String(d?.path || "") === dp);
        if (match) {
          frame.orderedPaths = tagDirs
            .map((d) => String(d?.path || ""))
            .filter(Boolean);
          frame.sortKey = currentSortKey;
          return tagDirs;
        }
      }
    }
  }

  if (searchBrowsingResultFolder() && dp) {
    const dirs = (WS.view.searchResults || []).slice();
    if (dirs.some((node) => String(node?.path || "") === dp)) return dirs;
  }

  if (
    WS.view.favoritesMode &&
    !WS.view.favoritesRootActive &&
    dp &&
    dp === String(WS.view.favoritesAnchorPath || "")
  ) {
    return getAllFavoriteDirs();
  }

  if (
    WS.view.hiddenMode &&
    !WS.view.hiddenRootActive &&
    dp &&
    dp === String(WS.view.hiddenAnchorPath || "")
  ) {
    return getAllHiddenDirs();
  }

  const p = dirNode?.parent;
  if (!p) return [];
  // Plain-folder browsing: album-member folders live in their album, not the
  // parent directory, so they must not appear as siblings here. Excluding them
  // keeps every special nav action (slides, next/prev folder, random set/file
  // jumps) from teleporting into a folder that is only reachable via its album.
  // When actually browsing an album, the tag-view branches above return the
  // album's members directly, so they still slide/jump within the album.
  return getChildDirsForNode(p);
}

function searchSessionActive() {
  return !!(
    WS.view &&
    WS.view.dirSearchPinned &&
    String(WS.view.dirSearchQuery || "").trim()
  );
}

function directorySearchInteractionActive() {
  return !!(
    WS.view &&
    (WS.view.dirSearchPinned ||
      WS.view.previewSearchActive ||
      String(WS.view.dirSearchQuery || "").trim() ||
      (directoriesSearchInput &&
        document.activeElement === directoriesSearchInput))
  );
}

function searchResultsVisibleInPreviewPane() {
  return !!(
    searchSessionActive() &&
    WS.view.searchRootActive &&
    WS.view.previewSearchActive &&
    isCompactTitleLayout()
  );
}

function searchResultsVisibleInDirectoriesPane() {
  return !!(
    searchSessionActive() &&
    WS.view.searchRootActive &&
    (!WS.view.previewSearchActive || !isCompactTitleLayout())
  );
}

function searchBrowsingResultFolder() {
  return !!(searchSessionActive() && !WS.view.searchRootActive);
}

function findSearchResultNodeByPath(path) {
  const targetPath = String(path || "");
  if (!targetPath || !Array.isArray(WS.view.searchResults)) return null;
  for (let i = 0; i < WS.view.searchResults.length; i++) {
    const node = WS.view.searchResults[i];
    if (String(node?.path || "") === targetPath) return node;
  }
  return null;
}

function currentSearchResultPath() {
  const currentPath = String(WS.nav.dirNode?.path || "");
  if (findSearchResultNodeByPath(currentPath)) return currentPath;
  const rememberedPath = String(
    WS.view.searchEntryRootPath || WS.view.searchAnchorPath || "",
  );
  if (findSearchResultNodeByPath(rememberedPath)) return rememberedPath;
  const firstResult = Array.isArray(WS.view.searchResults)
    ? WS.view.searchResults[0]
    : null;
  return String(firstResult?.path || "");
}

function enterSearchResultContext(pathLike) {
  const path = String(pathLike || "");
  WS.view.searchRootActive = false;
  WS.view.searchAnchorPath = path;
  WS.view.searchEntryRootPath = path;
}

function captureSearchResultsRestoreState(dirNode, opts = null) {
  const node = dirNode || findSearchResultNodeByPath(currentSearchResultPath());
  const restorePath = String(node?.path || "");
  const activePane =
    opts && opts.activePane === "preview" ? "preview" : "directories";
  const state = captureViewerCloseRestoreState({
    activePane,
    pendingPreviewSelectionKey:
      WS.view.previewSearchActive && restorePath ? `dir:${restorePath}` : "",
  });
  if (!state) return state;
  if (state.view && typeof state.view === "object") {
    state.view.previewSearchActive = !!WS.view.previewSearchActive;
    state.view.searchRootActive = true;
    state.view.searchAnchorPath = restorePath;
    state.view.searchEntryRootPath = restorePath;
  }
  state.entryKey = restorePath ? `dir:${restorePath}` : "";
  return state;
}

function getNextSiblingDirWithFiles(dirNode) {
  if (!dirNode) return null;
  const sibs = getVisibleSiblingDirsForSlide(dirNode);
  const idx = sibs.indexOf(dirNode);
  if (idx < 0) return null;
  for (let i = idx + 1; i < sibs.length; i++) {
    const d = sibs[i];
    if (getOrderedFileIdsForDir(d).length) return d;
  }
  return null;
}

function getPrevSiblingDirWithFiles(dirNode) {
  if (!dirNode) return null;
  const sibs = getVisibleSiblingDirsForSlide(dirNode);
  const idx = sibs.indexOf(dirNode);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const d = sibs[i];
    if (getOrderedFileIdsForDir(d).length) return d;
  }
  return null;
}

function getAllFavoriteDirs() {
  const out = [];
  if (!WS.root) return out;
  for (const [path, node] of WS.dirByPath.entries()) {
    const p = String(path || "");
    if (!p) continue;
    if (!node || node.type !== "dir") continue;
    if (isPathInsideInternalTrash(p)) continue;
    if (
      metaHasFavorite(p) &&
      !metaHasHidden(p) &&
      dirCanAppearUnderCurrentContentFilters(node)
    )
      out.push(node);
  }
  return sortDirCollectionForDisplay(out, "all-favorites");
}

function getAllHiddenDirs() {
  const out = [];
  if (!WS.root) return out;
  for (const [path, node] of WS.dirByPath.entries()) {
    const p = String(path || "");
    if (!p) continue;
    if (!node || node.type !== "dir") continue;
    if (isPathInsideInternalTrash(p)) continue;
    if (metaHasHidden(p) && dirCanAppearUnderCurrentContentFilters(node))
      out.push(node);
  }
  return sortDirCollectionForDisplay(out, "all-hidden");
}

function cancelDirectorySearch() {
  WS.view.dirSearchPinned = false;
  WS.view.previewSearchActive = false;
  WS.view.dirSearchQuery = "";
  WS.view.searchRootActive = false;
  WS.view.searchRootPath = "";
  WS.view.searchAnchorPath = "";
  WS.view.searchEntryRootPath = "";
  WS.view.searchRootIsFavorites = false;
  WS.view.searchRootFavorites = [];
  WS.view.searchRootIsHidden = false;
  WS.view.searchRootHidden = [];
  WS.view.searchResults = [];
  WS.view.searchResultsDirectCount = 0;
  WS.view.pendingPreviewSelectionKey = "";
}

function compactPreviewSearchActive() {
  return searchResultsVisibleInPreviewPane();
}

function clearDirectorySearchUi() {
  finalizeBulkSelectionAction();
  cancelDirectorySearch();
  if (directoriesSearchInput) {
    directoriesSearchInput.value = "";
    try {
      directoriesSearchInput.blur();
    } catch {}
  }

  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  syncBulkSelectionForCurrentDir();

  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  syncPreviewToSelection();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function computeDirectorySearchResults() {
  const q = String(WS.view.dirSearchQuery || "")
    .trim()
    .toLowerCase();
  WS.view.searchResults = [];
  WS.view.searchResultsDirectCount = 0;
  if (!WS.root || !q) return;

  const countMemo = new Map();
  const getCount = (node) => {
    if (!node) return 0;
    const p = String(node.path || "");
    if (countMemo.has(p)) return countMemo.get(p);
    const c = dirItemCount(node) | 0;
    countMemo.set(p, c);
    return c;
  };

  const addSet = new Set();
  const directResults = [];
  const recursiveResults = [];
  const skipHidden = !(WS.view.hiddenMode || showHiddenFolderEnabled());
  const canIncludeNode = (node) => {
    if (!node) return false;
    if (skipHidden && isDirOrAncestorHidden(node)) return false;
    if (getCount(node) <= 0) return false;
    return true;
  };
  const maybeAddMatch = (node, out) => {
    if (!canIncludeNode(node)) return;
    const p = String(node.path || "");
    if (!p || addSet.has(p)) return;
    const name = dirDisplayName(node || null).toLowerCase();
    if (!name.includes(q)) return;
    addSet.add(p);
    out.push(node);
  };
  const collectRecursiveMatches = (node) => {
    const children = getChildDirsForNodeBase(node);
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      maybeAddMatch(child, recursiveResults);
      collectRecursiveMatches(child);
    }
  };

  if (WS.view.searchRootIsFavorites) {
    const roots = Array.isArray(WS.view.searchRootFavorites)
      ? WS.view.searchRootFavorites
      : [];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      maybeAddMatch(root, directResults);
      collectRecursiveMatches(root);
    }
  } else if (WS.view.searchRootIsHidden) {
    const roots = Array.isArray(WS.view.searchRootHidden)
      ? WS.view.searchRootHidden
      : [];
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      maybeAddMatch(root, directResults);
      collectRecursiveMatches(root);
    }
  } else {
    const rp = String(WS.view.searchRootPath || "");
    const rootNode = WS.dirByPath.get(rp) || WS.root;
    const directChildren = getChildDirsForNodeBase(rootNode);
    for (let i = 0; i < directChildren.length; i++) {
      const child = directChildren[i];
      maybeAddMatch(child, directResults);
      collectRecursiveMatches(child);
    }
  }
  WS.view.searchResultsDirectCount = directResults.length;
  WS.view.searchResults = directResults.concat(recursiveResults);
  if (!WS.view.searchResults.length) {
    WS.view.pendingPreviewSelectionKey = "";
  }
}

function syncFavoritesUi() {
  if (favoritesBtn) {
    const n = WS.root ? getAllFavoriteDirs().length : 0;
    favoritesBtn.textContent = `Favorites${n ? ` (${n})` : ""}`;
    favoritesBtn.classList.toggle("active", !!WS.view.favoritesMode);
    favoritesBtn.disabled = !WS.root;
  }
}

function syncHiddenUi() {
  if (hiddenBtn) {
    const n = WS.root ? getAllHiddenDirs().length : 0;
    hiddenBtn.textContent = `Hidden${n ? ` (${n})` : ""}`;
    hiddenBtn.classList.toggle("active", !!WS.view.hiddenMode);
    hiddenBtn.disabled = !WS.root;
  }
}

function syncTagUiForCurrentDir() {
  if (!WS.root || !WS.nav.dirNode) return;
}

function tagVisibleChildContextKey() {
  return [
    WS.view.hiddenMode ? "hidden-mode:1" : "hidden-mode:0",
    showHiddenFolderEnabled() ? "show-hidden:1" : "show-hidden:0",
    isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden"
      ? "tag-hidden:1"
      : "tag-hidden:0",
  ].join("|");
}

function tagFolderEntryOptionContextKey() {
  return [
    showStorageFolderEnabled() ? "storage:1" : "storage:0",
    showUntaggedFolderEnabled() ? "untagged:1" : "untagged:0",
    showAllTagsFolderEnabled() ? "alltags:1" : "alltags:0",
    showAllModelsFolderEnabled() ? "allmodels:1" : "allmodels:0",
    showAllSetsFolderEnabled() ? "allsets:1" : "allsets:0",
    showCertifiedFreshFolderEnabled() ? "certifiedfresh:1" : "certifiedfresh:0",
    showTagStorageFolderEnabled() ? "tagstorage:1" : "tagstorage:0",
    showModelMediaFoldersEnabled() ? "modelmedia:1" : "modelmedia:0",
  ].join("|");
}

function tagEntryDerivedCacheKey(entry) {
  if (!entry || entry.kind !== "tag") return "";
  const entryKey = String(tagEntrySelectionKey(entry) || "");
  const originPath = String(entry.originPath || "");
  return [
    entryKey,
    originPath,
    effectiveFilterCacheKey(),
    tagVisibleChildContextKey(),
    dirSortDisplayCacheKey(),
  ].join("@@");
}

function selectionIndexForDirectoryEnter() {
  if (isGridInteractionMode()) return findNearestSelectableIndex(0, 1);
  return restoreGridSelectionForCurrentContext(0);
}
