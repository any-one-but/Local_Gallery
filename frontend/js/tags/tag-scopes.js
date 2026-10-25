/* Tag scopes
   What a Tag view lists, contents rules (Add tag to all contents) and the
   legacy album/gallery scopes. */

function getUntaggedDirsForNode(dirNode) {
  if (!dirNode) return [];
  return getFastTagScopeModel(dirNode).untagged.slice();
}

function isViewingTagFolder() {
  return !!WS.view.tagFolderActiveMode;
}

function tagAlbumPerformanceModeValue(mode) {
  const value = String(mode || "").trim().toLowerCase();
  return value === "tag" || value === "album";
}

function isViewingPerformanceSensitiveTagAlbumFolder() {
  return !!(
    isViewingTagFolder() &&
    tagAlbumPerformanceModeValue(WS.view && WS.view.tagFolderActiveMode)
  );
}

function isPerformanceSensitiveTagAlbumPreviewNode(dirNode) {
  if (!dirNode || !dirNode._skipTagFilters) return false;
  return tagAlbumPerformanceModeValue(dirNode._tagPreviewMode);
}

function getVisibleChildDirsForTagEvaluation(dirNode) {
  if (!dirNode) return [];
  ensureDirectoryChildNodesFromCatalog(dirNode);
  const base = sortDirsForDisplay(
    Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [],
  )
    .filter((child) => child && child.type === "dir")
    .filter((child) => !isInternalTrashDirNode(child));
  if (isPathInsideInternalTrash(dirNode.path || "")) return base;
  const showHidden =
    WS.view.hiddenMode ||
    showHiddenFolderEnabled() ||
    (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden");
  return showHidden
    ? base
    : base.filter((child) => !isDirOrAncestorHidden(child));
}

function dirHasVisibleRecordForTagEntry(dirNode, entry) {
  if (!dirNode || !entry || entry.kind !== "tag") return false;
  const dirPath = String(dirNode.path || "");
  const entryKey = tagEntryDerivedCacheKey(entry);
  const folderMediaFilterKey = nearestFolderMediaFilterForPath(dirPath).join(",");
  // Scores: the catalog summary cannot see them, and a Tag's score override
  // can make the answer depend on where it is looked at from.
  const scoreFiltered = scoreFilterMayApply();
  const scoreKey = scoreFiltered
    ? `@@score:${scoreFilterOverrideKindsInUse().set.tag ? scoreFilterContextSignature() : ""}`
    : "";
  const cacheKey = `${entryKey}@@${dirPath}@@${effectiveFilterCacheKey()}@@${String(
    effectiveTagMediaFilterForEntry(entry).join(","),
  )}@@folder:${folderMediaFilterKey}${scoreKey}`;
  if (cacheKey && TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE.has(cacheKey)) {
    return !!TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE.get(cacheKey);
  }
  let visible = false;
  // The catalog summary cannot tell which files an Exclusive Tag has taken.
  if (
    tagEntryVisibilityNeedsExactAspectScan(entry) ||
    dirPathHasExclusiveFileClaims(dirPath)
  ) {
    const exactVisible = loadedDirHasVisibleRecordForTagEntry(dirNode, entry);
    if (exactVisible != null) {
      visible = !!exactVisible;
      if (cacheKey) TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE.set(cacheKey, visible);
      return visible;
    }
  }
  const summary = scoreFiltered ? null : getCatalogSummaryForNode(dirNode);
  // v10: tag/album content filters were recursively walking fully loaded root
  // children, which made opening tags and moving through filtered albums scale
  // with the whole folder tree. The catalog summary is the lightweight truth for
  // media type/aspect availability, so use it even when the node is loaded.
  if (summary) {
    const summaryVisible = catalogSummaryHasVisibleRecordForTagEntry(
      summary,
      entry,
      dirNode,
    );
    if (summaryVisible != null) {
      visible = !!summaryVisible;
      if (cacheKey) TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE.set(cacheKey, visible);
      return visible;
    }
  }
  const fileIds = Array.isArray(dirNode.childrenFiles)
    ? dirNode.childrenFiles
    : [];
  for (let i = 0; i < fileIds.length; i++) {
    const rec = WS.fileById.get(String(fileIds[i] || ""));
    if (rec && recordPassesTagEntryFilter(rec, entry)) {
      visible = true;
      break;
    }
  }
  if (!visible) {
    const childDirs = getVisibleChildDirsForTagEvaluation(dirNode);
    for (let i = 0; i < childDirs.length; i++) {
      if (dirHasVisibleRecordForTagEntry(childDirs[i], entry)) {
        visible = true;
        break;
      }
    }
  }
  if (cacheKey) TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE.set(cacheKey, visible);
  return visible;
}

function filterTagEntryDirsByVisibleRecords(nodes, entry) {
  const list = Array.isArray(nodes) ? nodes : [];
  if (!list.length) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    const path = String(node?.path || "");
    if (!path || seen.has(path)) continue;
    if (!hiddenContentVisibleInCurrentView() && isDirOrAncestorHidden(node))
      continue;
    const realTag = !!(entry && entry.kind === "tag" && !entry.special);
    // Whether a folder with files held by an Exclusive Tag has anything to show
    // depends on the Tag asking, so only the Tag's own test can answer it (the
    // plain test reads the current location and is cached per Tag here).
    const claimed = realTag && dirPathHasExclusiveFileClaims(path);
    // Likewise a Tag's own Set score override: the plain test would judge the
    // folder's files by the score filter of wherever it is looked at from.
    const askingTag = realTag ? normalizeTag(entry.tag || "") : "";
    const scoreAsked =
      !!askingTag &&
      metaGetScoreFilterOverride(`tag:${askingTag}`, "set") !== undefined;
    if (!claimed && !scoreAsked && !dirCanAppearUnderCurrentContentFilters(node))
      continue;
    if (!dirPassesScoreFilter(node, askingTag)) continue;
    if (
      realTag &&
      (claimed || scoreAsked || !metaHasFolderMediaFilter(path)) &&
      !dirHasVisibleRecordForTagEntry(node, entry)
    )
      continue;
    seen.add(path);
    out.push(node);
  }
  const containerMode = tagContainerSortModeForEntry(entry);
  return containerMode ? sortDirsByMode(out, containerMode) : out;
}

function tagContainerSortModeForEntry(entry) {
  const direct = metaGetTagContainerSortMode(tagThumbnailKeyForEntry(entry));
  if (direct) return direct;
  if (entry?.tag && entry?.album) {
    return metaGetTagContainerSortMode(
      tagThumbnailKeyForAlbum(entry.album, entry.originPath || ""),
    );
  }
  return "";
}

function sortDirsForTagEntryContainer(dirs, entry) {
  const mode = tagContainerSortModeForEntry(entry);
  return mode ? sortDirsByMode(dirs, mode) : dirs;
}

function fastTagScopeSortKey() {
  const mode = normalizeDirSortMode(WS.meta && WS.meta.dirSortMode);
  return ["fast-tag-scope", mode, randomOrderSignature()].join(":");
}

function fastDirSummaryForTagScope(node) {
  const summary = getCatalogSummaryForNode(node);
  const path = String(node?.path || "");
  const recursiveFileCount = summary
    ? Math.max(0, Number(summary.recursiveFileCount) || 0)
    : Math.max(0, Number(node?.recursiveFileCount) || Number(node?.recursiveItemCount) || 0);
  const recursiveSizeBytes = summary
    ? Math.max(0, Number(summary.recursiveSizeBytes) || 0)
    : Math.max(0, Number(node?.recursiveSizeBytes) || 0);
  const score = Number(metaGetScore(path)) || 0;
  return {
    recursiveFileCount,
    recursiveSizeBytes,
    score,
    efficiency: score / Math.max(1, recursiveFileCount),
  };
}

function fastSortDirsForTagScope(dirs, key = "tag-scope") {
  const out = Array.isArray(dirs) ? dirs.slice() : [];
  if (out.length <= 1) return out;
  const randomKind = randomOrderActiveForDirs(out);
  if (randomKind)
    return stableRandomOrder(randomKind, `fast-tag-scope:${String(key || "collection")}`, out, randomOrderDirPath);
  const mode = normalizeDirSortMode(WS.meta && WS.meta.dirSortMode);
  if (mode === "score" || mode === "efficiency" || mode === "size-desc" || mode === "count-recursive") {
    const summaryMemo = new Map();
    const getSummary = (node) => {
      const path = String(node?.path || "");
      if (!summaryMemo.has(path)) summaryMemo.set(path, fastDirSummaryForTagScope(node));
      return summaryMemo.get(path) || { recursiveFileCount: 0, recursiveSizeBytes: 0, score: 0, efficiency: 0 };
    };
    out.sort((a, b) => {
      const sa = getSummary(a);
      const sb = getSummary(b);
      let va = 0;
      let vb = 0;
      if (mode === "score") {
        va = sa.score;
        vb = sb.score;
      } else if (mode === "efficiency") {
        va = sa.efficiency;
        vb = sb.efficiency;
      } else if (mode === "size-desc") {
        va = sa.recursiveSizeBytes;
        vb = sb.recursiveSizeBytes;
      } else {
        va = sa.recursiveFileCount;
        vb = sb.recursiveFileCount;
      }
      if (va !== vb) return vb - va;
      if (mode === "efficiency") {
        const sizeDiff = (sa.recursiveSizeBytes || 0) - (sb.recursiveSizeBytes || 0);
        if (sizeDiff) return sizeDiff;
      }
      return byName(a, b);
    });
    return out;
  }
  out.sort(byName);
  return out;
}

function getFastTagScopeChildren(dirNode) {
  if (!dirNode) return [];
  ensureDirectoryChildNodesFromCatalog(dirNode);
  const rawChildren = Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [];
  const showHidden =
    WS.view.hiddenMode ||
    showHiddenFolderEnabled() ||
    (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden");
  const children = [];
  for (let i = 0; i < rawChildren.length; i++) {
    const child = rawChildren[i];
    if (!child || child.type !== "dir") continue;
    if (isInternalTrashDirNode(child)) continue;
    if (dirNodeIsHiddenAlt(child)) continue;
    if (!showHidden && isDirOrAncestorHidden(child)) continue;
    children.push(child);
  }
  return fastSortDirsForTagScope(children, String(dirNode.path || "__root__"));
}

// Container mutation must use membership, not the currently rendered result.
// Media overrides can legitimately make a non-empty container look empty, and
// hidden members still need to be removable when the container itself is
// deleted. Keep this resolver free of media and hidden-visibility filtering.
function getRawTagScopeChildren(dirNode) {
  if (!dirNode) return [];
  ensureDirectoryChildNodesFromCatalog(dirNode);
  return (Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : []).filter(
    (child) =>
      child &&
      child.type === "dir" &&
      !isInternalTrashDirNode(child) &&
      !dirNodeIsHiddenAlt(child),
  );
}

function getUnfilteredMembershipDirsForTagEntry(entry) {
  if (!entry || entry.kind !== "tag") return [];
  if (!entry.special) {
    const tag = normalizeTag(entry.tag || "");
    return tag ? tagMemberDirNodes(tag) : [];
  }
  if (entry.special === "storage") return getAllStorageDirNodes();
  const originPath = normalizeTagAlbumScopePath(entry.originPath || "");
  const baseNode = WS.dirByPath.get(originPath) || WS.root;
  if (!baseNode) return [];
  const children = getRawTagScopeChildren(baseNode);
  if (entry.special === "favorites")
    return children.filter((child) => metaHasFavorite(child.path || ""));
  if (entry.special === "untagged")
    return children.filter((child) => !metaGetUserTags(child.path || "").length);
  if (entry.special === "hidden")
    return children.filter((child) => metaHasHidden(child.path || ""));
  return [];
}

// Everything a Tag reaches: its own folders and, through Tags it holds, theirs.
function getUnfilteredContentDirsForTagEntry(entry, ancestry = null) {
  if (!entry || entry.kind !== "tag") return [];
  const out = [];
  const seen = new Set();
  const addDirs = (dirs) => {
    const list = Array.isArray(dirs) ? dirs : [];
    for (let i = 0; i < list.length; i++) {
      const node = list[i];
      const path = normalizeDirPathValue(node?.path || "");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push(node);
    }
  };
  if (entry.special) {
    addDirs(getUnfilteredMembershipDirsForTagEntry(entry));
    return out;
  }
  const tag = normalizeTag(entry.tag || "");
  if (!tag) return out;
  const visited = ancestry instanceof Set ? ancestry : new Set();
  if (visited.has(tag)) return out;
  const nextVisited = new Set(visited);
  nextVisited.add(tag);
  addDirs(tagMemberDirNodes(tag));
  for (const child of tagChildNames(tag)) {
    addDirs(
      getUnfilteredContentDirsForTagEntry(
        { kind: "tag", tag: child, originPath: tagPlacementPath(child) || "" },
        nextVisited,
      ),
    );
  }
  return out;
}

function galleryContentDirsForSelectionTarget(selectionTarget) {
  const target =
    selectionTarget && typeof selectionTarget === "object"
      ? selectionTarget
      : null;
  if (!target) return [];
  const out = [];
  const seen = new Set();
  const addNode = (node) => {
    const path = normalizeDirPathValue(node?.path || "");
    if (!path || seen.has(path) || isInternalTrashDirNode(node)) return;
    if (!dirHasUnfilteredIndexedMedia(node)) return;
    seen.add(path);
    out.push(node);
  };
  const addFolderContents = (node) => {
    if (!node) return;
    ensureDirectoryChildNodesFromCatalog(node);
    const children = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
    for (let i = 0; i < children.length; i++) addNode(children[i]);
  };
  const addTagEntryContents = (entry) => {
    const dirs = getUnfilteredContentDirsForTagEntry(entry);
    for (let i = 0; i < dirs.length; i++) addNode(dirs[i]);
  };

  if (target.kind === "dir") {
    addFolderContents(target.node);
  } else if (target.kind === "tag") {
    addTagEntryContents(target.entry);
  } else if (target.kind === "bulk") {
    const paths = Array.isArray(target.paths) ? target.paths : [];
    for (let i = 0; i < paths.length; i++) {
      addFolderContents(resolveDirNodeForPathOrStorageStub(paths[i]));
    }
    const entries = Array.isArray(target.entries) ? target.entries : [];
    for (let i = 0; i < entries.length; i++) addTagEntryContents(entries[i]);
  }
  return out;
}

/* "Add tag to all contents", directly under Add tag: the same row aimed at what is
   inside the selection instead of the selection itself, and the same hybrid.
   Pressing it opens the same naming field, so "A, B" adds the contents to both
   and a name that already exists adds to that Tag; stepping in offers Create
   new and every Tag. What it saves is a contents rule on the selection (see
   contentsSourceKeysForSelection), so folders added later are in the Tag too. */
function buildAddContentsToTagSubmenu(selectionTarget) {
  const selectedEntries =
    selectionTarget?.kind === "tag"
      ? [selectionTarget.entry]
      : selectionTarget?.kind === "bulk"
        ? selectionTarget.entries || []
        : [];
  if (
    selectedEntries.some(
      (entry) =>
        entry &&
        !entry.special &&
        !entry.placeholder &&
        !normalizeTag(entry.tag || "") &&
        !normalizeTagAlbumName(entry.album || "") &&
        !!normalizeGalleryName(entry.gallery || ""),
    )
  )
    return null;
  const contentsSources = contentsSourceKeysForSelection(selectionTarget);
  if (!contentsSources.length) return null;
  const paths = galleryContentDirsForSelectionTarget(selectionTarget)
    .map((node) => normalizeDirPathValue(node?.path || ""))
    .filter(Boolean);
  if (!paths.length) return null;
  const selectedCard = selectionTarget?.card || null;
  const selectedInPreview = !!(
    selectedCard &&
    selectedCard.closest &&
    selectedCard.closest("#previewBody")
  );
  const preferPane =
    !directoriesPaneOpenEnabled() ||
    selectedInPreview ||
    String(WS.view?.activePane || "") === "preview"
      ? "preview"
      : "directories";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = ADD_CONTENTS_TO_TAG_LABEL;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!canUseBulkTagPlaceholderUi()) return;
    setBulkTagPlaceholder(paths, "New tag", "tag", "", preferPane, {
      contentsSources,
    });
  });
  // Stepping in: Create new and every Tag, as under Tag (createAddToTagSubmenu).
  const startCreation = (draft) => {
    if (!canUseBulkTagPlaceholderUi()) return false;
    resetAddToTagCreateDraft();
    if (WS.view && WS.view.bulkSelectMode) finalizeBulkSelectionAction();
    return setBulkTagPlaceholder(paths, "New tag", "tag", "", preferPane, {
      contentsSources,
      createNew: addToTagCreateOverrides(draft),
    });
  };
  const choices = addContentsToTagChoiceNames(contentsSources).map((name) =>
    createAddToTagToggleButton(
      name,
      contentsSources.every((key) => metaGetContentTags(key).includes(name)),
      () => toggleSelectionContentsInTag(name, contentsSources),
    ),
  );
  return createAddToTagHybridSubmenu(ADD_CONTENTS_TO_TAG_LABEL, "contents", button, [
    createAddToTagCreateSubmenu("contents", startCreation),
    ...choices,
  ]);
}

function dirHasUnfilteredIndexedMedia(dirNode, visited = null) {
  if (!dirNode) return false;
  const path = String(dirNode.path || "");
  const seen = visited instanceof Set ? visited : new Set();
  if (path && seen.has(path)) return false;
  if (path) seen.add(path);
  const summary = getCatalogSummaryForNode(dirNode);
  if (summary)
    return Math.max(0, Number(summary.recursiveFileCount) || 0) > 0;
  if (
    Array.isArray(dirNode.childrenFiles) &&
    dirNode.childrenFiles.length > 0
  )
    return true;
  if (Math.max(0, Number(dirNode.recursiveFileCount) || 0) > 0) return true;
  const children = Array.isArray(dirNode.childrenDirs)
    ? dirNode.childrenDirs
    : [];
  for (let i = 0; i < children.length; i++) {
    if (dirHasUnfilteredIndexedMedia(children[i], seen)) return true;
  }
  return false;
}

function visibleRawTagScopeChildren(scopePath) {
  const scope = normalizeTagAlbumScopePath(scopePath);
  const baseNode = WS.dirByPath.get(scope) || WS.root;
  if (!baseNode) return [];
  const children = getRawTagScopeChildren(baseNode);
  if (hiddenContentVisibleInCurrentView()) return children;
  return children.filter((child) => !isDirOrAncestorHidden(child));
}

function tagHasUnfilteredContent(tagName, scopePath = "", ancestry = null) {
  const tag = normalizeTag(tagName);
  if (!tag) return false;
  const visited = ancestry instanceof Set ? ancestry : new Set();
  if (visited.has(tag)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(tag);
  const showHidden = hiddenContentVisibleInCurrentView();
  if (
    tagMemberDirNodes(tag).some(
      (node) =>
        (showHidden || !isDirOrAncestorHidden(node)) &&
        dirHasUnfilteredIndexedMedia(node),
    )
  )
    return true;
  for (const child of tagChildNames(tag)) {
    if (!showHidden && tagIsEffectivelyHidden(child)) continue;
    if (tagHasUnfilteredContent(child, "", nextVisited)) return true;
  }
  return false;
}

function albumHasUnfilteredContent(
  albumName,
  scopePath = "",
  ancestry = null,
) {
  const album = normalizeTagAlbumName(albumName);
  const scope = normalizeTagAlbumScopePath(scopePath);
  if (!album) return false;
  const key = `album\n${scope}\n${album}`;
  const visited = ancestry instanceof Set ? ancestry : new Set();
  if (visited.has(key)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(key);

  const children = visibleRawTagScopeChildren(scope);
  if (
    children.some((child) => {
      const path = String(child.path || "");
      const isMember =
        metaGetAlbumForPath(path) === album ||
        metaGetUserTags(path).some(
          (tag) => metaGetTagAlbumForTag(tag, scope) === album,
        );
      return isMember && dirHasUnfilteredIndexedMedia(child);
    })
  )
    return true;
  return false;
}

function galleryHasUnfilteredContent(galleryName, ancestry = null) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || galleryIsHiddenFromCurrentView(gallery)) return false;
  const key = `gallery\n${gallery}`;
  const visited = ancestry instanceof Set ? ancestry : new Set();
  if (visited.has(key)) return false;
  const nextVisited = new Set(visited);
  nextVisited.add(key);
  if (getDirectDirsForGallery(gallery).some(dirHasUnfilteredIndexedMedia))
    return true;
  const tags = metaGetMemberTagTargetsForGallery(gallery);
  for (let i = 0; i < tags.length; i++) {
    if (tagHasUnfilteredContent(tags[i].tag, tags[i].originPath, nextVisited))
      return true;
  }
  const albums = metaGetMemberAlbumTargetsForGallery(gallery);
  for (let i = 0; i < albums.length; i++) {
    if (
      albumHasUnfilteredContent(
        albums[i].album,
        albums[i].originPath,
        nextVisited,
      )
    )
      return true;
  }
  return false;
}

function getFastTagScopeModel(dirNode) {
  const path = String(dirNode?.path || "__root__");
  const cacheKey = [
    path,
    tagVisibleChildContextKey(),
    tagFolderEntryOptionContextKey(),
    fastTagScopeSortKey(),
  ].join("@@");
  if (TAG_SCOPE_MODEL_CACHE.has(cacheKey)) {
    return TAG_SCOPE_MODEL_CACHE.get(cacheKey) || {
      children: [],
      groups: new Map(),
      favorites: [],
      untagged: [],
      hidden: [],
      albumStats: new Map(),
      groupScores: new Map(),
      favoritesScore: 0,
      untaggedScore: 0,
      hiddenScore: 0,
    };
  }

  const children = getFastTagScopeChildren(dirNode);
  const groups = new Map();
  const favorites = [];
  const untagged = [];
  const hidden = [];
  const albumStats = new Map();
  const scopePath = String(dirNode?.path || "");
  // Aggregate scores accumulated in this same pass so tag/album rows can show a
  // score equal to the sum of their content's scores without a second sweep.
  const groupScores = new Map();
  let favoritesScore = 0;
  let untaggedScore = 0;
  let hiddenScore = 0;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childPath = String(child?.path || "");
    if (!childPath) continue;
    const childScore = Number(metaGetScore(childPath)) || 0;
    const directAlbum = metaGetAlbumForPath(childPath);
    if (metaHasFavorite(childPath)) {
      favorites.push(child);
      favoritesScore += childScore;
    }
    if (metaHasHidden(childPath)) {
      hidden.push(child);
      hiddenScore += childScore;
    }
    const tags = metaGetUserTags(childPath);
    // A folder that lives inside an album is contained there, not loose in the
    // parent, so it must not surface in the parent's "Untagged" bucket. It stays
    // discoverable through its own tags/Favorites, which are cross-cutting refs.
    if (!tags.length && !contentTagsForDirPath(childPath).length && !directAlbum) {
      untagged.push(child);
      untaggedScore += childScore;
    }
    const seenTags = new Set();
    for (let t = 0; t < tags.length; t++) {
      const tag = String(tags[t] || "");
      if (!tag || seenTags.has(tag)) continue;
      seenTags.add(tag);
      let list = groups.get(tag);
      if (!list) {
        list = [];
        groups.set(tag, list);
      }
      list.push(child);
      groupScores.set(tag, (groupScores.get(tag) || 0) + childScore);
      const album = metaGetTagAlbumForTag(tag, scopePath);
      if (album) {
        let bucket = albumStats.get(album);
        if (!bucket) {
          bucket = {
            tags: new Set(),
            folderPaths: new Set(),
            directFolderPaths: new Set(),
            dirs: [],
            score: 0,
          };
          albumStats.set(album, bucket);
        }
        bucket.tags.add(tag);
        if (!bucket.folderPaths.has(childPath)) {
          bucket.folderPaths.add(childPath);
          bucket.dirs.push(child);
          bucket.score += childScore;
        }
      }
    }
    if (directAlbum) {
      let bucket = albumStats.get(directAlbum);
      if (!bucket) {
        bucket = {
          tags: new Set(),
          folderPaths: new Set(),
          directFolderPaths: new Set(),
          dirs: [],
          score: 0,
        };
        albumStats.set(directAlbum, bucket);
      }
      bucket.directFolderPaths.add(childPath);
      if (!bucket.folderPaths.has(childPath)) {
        bucket.folderPaths.add(childPath);
        bucket.dirs.push(child);
        bucket.score += childScore;
      }
    }
  }

  const model = {
    children,
    groups,
    favorites,
    untagged,
    hidden,
    albumStats,
    groupScores,
    favoritesScore,
    untaggedScore,
    hiddenScore,
  };
  TAG_SCOPE_MODEL_CACHE.set(cacheKey, model);
  return model;
}


function gatherTagGroupsForDir(dirNode) {
  return getFastTagScopeModel(dirNode).groups;
}

function collectTagAlbumStatsForGroups(tagGroups, scopePath = null) {
  const baseNode = scopePath == null ? null : WS.dirByPath.get(String(scopePath || ""));
  if (baseNode) return getFastTagScopeModel(baseNode).albumStats;
  const byAlbum = new Map();
  for (const [tag, nodes] of (tagGroups || []).entries()) {
    const album = metaGetTagAlbumForTag(tag, scopePath);
    if (!album) continue;
    let bucket = byAlbum.get(album);
    if (!bucket) {
      bucket = {
        tags: new Set(),
        folderPaths: new Set(),
        directFolderPaths: new Set(),
        dirs: [],
      };
      byAlbum.set(album, bucket);
    }
    bucket.tags.add(String(tag || ""));
    for (let i = 0; i < (nodes || []).length; i++) {
      const node = nodes[i];
      const path = String(node?.path || "");
      if (!path || bucket.folderPaths.has(path)) continue;
      bucket.folderPaths.add(path);
      bucket.dirs.push(node);
    }
  }
  return byAlbum;
}

function collectAlbumTagGroupsForScope(scopePath = "") {
  const out = new Map();
  if (!WS.meta || !WS.meta.albumTagsByAlbum) return out;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  for (const [albumKeyRaw, tagsRaw] of WS.meta.albumTagsByAlbum.entries()) {
    const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
    if (!parsed || parsed.scopePath !== normalizedScope) continue;
    const album = normalizeTagAlbumName(parsed.album || "");
    if (!album) continue;
    const tags = normalizeTagList(tagsRaw)
      .filter((tag) => !isReservedFolderTag(tag))
      .filter((tag) => tag !== album);
    for (let i = 0; i < tags.length; i++) {
      const tag = tags[i];
      if (!tag) continue;
      let list = out.get(tag);
      if (!list) {
        list = [];
        out.set(tag, list);
      }
      list.push({
        kind: "tag",
        album,
        label: album,
        originPath: normalizedScope,
        taggedAlbum: true,
      });
    }
  }
  return out;
}

function getAlbumEntriesForTagForBaseNode(baseNode, tagName, opts = null) {
  const tag = normalizeTag(tagName || "");
  if (!baseNode || !tag) return [];
  const basePath = String(baseNode.path || "");
  const albumGroups = collectAlbumTagGroupsForScope(basePath);
  const entries = albumGroups.get(tag) || [];
  const skipContentCheck = !!(opts && opts.skipContentCheck);
  return entries
    .filter(
      (entry) =>
        skipContentCheck ||
        albumHasUnfilteredContent(entry.album, entry.originPath),
    )
    .slice()
    .sort((a, b) =>
      compareIndexedNames(String(a.album || ""), String(b.album || "")),
    );
}

function getDirectDirsForAlbumForBaseNode(baseNode, albumName) {
  const album = normalizeTagAlbumName(albumName || "");
  if (!baseNode || !album) return [];
  const stats = getFastTagScopeModel(baseNode).albumStats.get(album);
  if (!stats || !stats.directFolderPaths || !stats.directFolderPaths.size)
    return [];
  const out = [];
  stats.directFolderPaths.forEach((path) => {
    const node = WS.dirByPath.get(String(path || ""));
    if (node) out.push(node);
  });
  return sortDirCollectionForDisplay(out, `album-direct:${String(baseNode.path || "")}:${album}`);
}

function getDirectDirsForGallery(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.folderGalleriesByPath) return [];
  if (galleryIsHiddenFromCurrentView(gallery)) return [];
  const out = [];
  for (const [pathRaw, galleriesRaw] of WS.meta.folderGalleriesByPath.entries()) {
    const path = normalizeDirPathValue(pathRaw);
    if (!path) continue;
    const galleries = normalizeTagList(galleriesRaw).map(normalizeGalleryName);
    if (!galleries.includes(gallery)) continue;
    const node = WS.dirByPath.get(path);
    if (
      node &&
      (hiddenContentVisibleInCurrentView() || !isDirOrAncestorHidden(node))
    )
      out.push(node);
  }
  return sortDirCollectionForDisplay(out, `gallery-direct:${gallery}`);
}

function getGalleryMemberTagEntries(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery) return [];
  if (galleryIsHiddenFromCurrentView(gallery)) return [];
  return metaGetMemberTagTargetsForGallery(gallery)
    .filter(
      (target) =>
        tagHasUnfilteredContent(target.tag, target.originPath) &&
        (hiddenContentVisibleInCurrentView() ||
          (!tagIsEffectivelyHidden(target.tag, target.originPath) &&
            !isDirOrAncestorHidden(
              WS.dirByPath.get(normalizeTagAlbumScopePath(target.originPath)),
            ))),
    )
    .map((target) => {
      const tag = normalizeTag(target.tag || "");
      const originPath = normalizeTagAlbumScopePath(target.originPath || "");
      const baseNode = WS.dirByPath.get(originPath) || WS.root;
      const entry = {
        kind: "tag",
        tag,
        label: tag,
        originPath,
        gallery,
        galleryMember: true,
      };
      const nodes = baseNode
        ? gatherTagGroupsForDir(baseNode).get(tag) || []
        : [];
      return Object.assign(entry, {
        count: filterTagEntryDirsByVisibleRecords(nodes, entry).length,
      });
    });
}

function getGalleryMemberAlbumEntries(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.root) return [];
  if (galleryIsHiddenFromCurrentView(gallery)) return [];
  return metaGetMemberAlbumTargetsForGallery(gallery)
    .filter(
      (target) =>
        albumHasUnfilteredContent(target.album, target.originPath) &&
        (hiddenContentVisibleInCurrentView() ||
          (!albumIsEffectivelyHidden(target.album, target.originPath) &&
            !isDirOrAncestorHidden(
              WS.dirByPath.get(normalizeTagAlbumScopePath(target.originPath)),
            ))),
    )
    .map((target) => {
      const album = normalizeTagAlbumName(target.album || "");
      const originPath = normalizeTagAlbumScopePath(target.originPath || "");
      const baseNode = WS.dirByPath.get(originPath) || WS.root;
      const stats = baseNode
        ? getFastTagScopeModel(baseNode).albumStats.get(album)
        : null;
      const dirs =
        stats && Array.isArray(stats.dirs)
          ? stats.dirs
          : baseNode
            ? getDirectDirsForAlbumForBaseNode(baseNode, album)
            : [];
      return {
        kind: "tag",
        album,
        label: album,
        originPath,
        gallery,
        galleryMember: true,
        count: filterTagEntryDirsByVisibleRecords(
          dirs,
          { kind: "tag", album, label: album, originPath },
        ).length,
      };
    });
}

function getGalleryEntriesForRoot() {
  if (!WS.root) return [];
  const names = getAllGalleryNames();
  const out = [];
  for (let i = 0; i < names.length; i++) {
    const gallery = normalizeGalleryName(names[i]);
    if (!gallery) continue;
    if (galleryIsHiddenFromCurrentView(gallery)) continue;
    if (!galleryHasUnfilteredContent(gallery)) continue;
    const entry = {
      kind: "tag",
      gallery,
      label: gallery,
      originPath: "",
    };
    const dirs = getDirsForTagEntry(entry);
    const memberCount =
      getGalleryMemberTagEntries(gallery).length +
      getGalleryMemberAlbumEntries(gallery).length;
    const directMemberCount = getDirectDirsForGallery(gallery).length;
    if (!directMemberCount && !memberCount) continue;
    out.push(Object.assign(entry, { count: dirs.length + memberCount }));
  }
  return out;
}

function getGalleryEntriesForTag(tagName) {
  return [];
}

function getGalleryEntriesForAlbum(albumName) {
  return [];
}

function buildBulkTagPlaceholderEntry() {
  if (!BULK_TAG_PLACEHOLDER) return null;
  const rawType = String(BULK_TAG_PLACEHOLDER.type || "tag");
  const type =
    rawType === "album" ||
    rawType === "folderAlbum" ||
    rawType === "albumTag" ||
    rawType === "gallery" ||
    rawType === "galleryTag" ||
    rawType === "galleryAlbum" ||
    rawType === "tagInTag"
      ? rawType
      : "tag";
  const fallbackLabel =
    type === "album"
      ? "New tag"
      : type === "folderAlbum"
        ? "New tag"
        : type === "gallery"
          ? "New tag"
          : type === "galleryAlbum"
            ? "New tag"
          : "New tag";
  return {
    kind: "tag",
    label: BULK_TAG_PLACEHOLDER.label || fallbackLabel,
    tag: "",
    count: BULK_TAG_PLACEHOLDER.count || 0,
    placeholder: true,
    placeholderType: type,
  };
}

/* ---------------------------------------------------------------------------
   The Tag model
   ---------------------------------------------------------------------------
   A folder carries Tag names (dirTags); a Tag can also hold other Tags
   (WS.meta.tagParents: child -> parents). A Tag's card sits in the deepest
   folder that is still at or above everything it holds: the parent folder of
   each member folder, and the folder where each member Tag sits. A Tag holding
   nothing that exists has no place and is not drawn anywhere -- its metadata is
   kept all the same.

   Exclusive (WS.meta.exclusiveTags) moves content rather than copying it: the
   Tag's folders leave their real parent's listing and its member Tags leave the
   folder they would otherwise sit in -- unless the Tag also has a media type
   override, in which case only the files passing it move (fileClaimsByFolder).
   Placement ignores Exclusive, so switching
   it never moves the Tag itself. Neither hidden state nor the content filters
   affect placement either; they decide what is drawn, not where. */

function tagModelParentPath(path) {
  const p = normalizeDirPathValue(path);
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(0, i) : "";
}

function tagModelCommonPath(a, b) {
  if (a === b) return a;
  const as = a ? a.split("/") : [];
  const bs = b ? b.split("/") : [];
  const out = [];
  for (let i = 0; i < as.length && i < bs.length; i++) {
    if (as[i] !== bs[i]) break;
    out.push(as[i]);
  }
  return out.join("/");
}

// A member folder counts toward placement only while it is really there.
function tagModelFolderExists(path) {
  const p = normalizeDirPathValue(path);
  if (!p || isPathInsideInternalTrash(p)) return false;
  const node = WS.dirByPath ? WS.dirByPath.get(p) : null;
  if (node) return !node.isMissingPlaceholder && !dirNodeIsHiddenAlt(node);
  return !!(
    WS.catalog &&
    WS.catalog.enabled &&
    WS.catalog.folderSummaries instanceof Map &&
    WS.catalog.folderSummaries.has(p)
  );
}

/* "Add tag to all contents" is a rule, not a copy. A folder's (or a Tag's) contents
   are in these Tags for as long as the rule stands, including content that
   arrives later. Rules live in WS.meta.contentTags keyed "dir:<path>" or
   "tag:<name>", are saved in tags.log.json, and are folded into membership only
   by getTagModel -- never written into dirTags -- so clearing a rule's names
   takes the membership away again. */
function contentsSourceKeysForSelection(target) {
  const keys = [];
  const addDir = (node) => {
    if (!node) return;
    const path = normalizeDirPathValue(node.path || "");
    if (!path && node !== WS.root) return;
    keys.push(`dir:${path}`);
  };
  const addTag = (entry) => {
    if (!entry || entry.special || entry.placeholder) return;
    const tag = normalizeTag(entry.tag || "");
    if (tag) keys.push(`tag:${tag}`);
  };
  if (target?.kind === "dir") addDir(target.node);
  else if (target?.kind === "tag") addTag(target.entry);
  else if (target?.kind === "bulk") {
    (Array.isArray(target.paths) ? target.paths : []).forEach((path) =>
      addDir(resolveDirNodeForPathOrStorageStub(path)),
    );
    (Array.isArray(target.entries) ? target.entries : []).forEach(addTag);
  }
  return Array.from(new Set(keys));
}

function metaGetContentTags(key) {
  const set =
    WS.meta && WS.meta.contentTags instanceof Map
      ? WS.meta.contentTags.get(String(key || ""))
      : null;
  return set
    ? Array.from(set).sort((a, b) => String(a).localeCompare(String(b)))
    : [];
}

function metaSetContentTags(key, tags) {
  const k = String(key || "");
  if (!k || !WS.meta || !(WS.meta.contentTags instanceof Map)) return false;
  const next = normalizeTagList(tags)
    .filter(
      (tag) =>
        tag &&
        !isReservedFolderTag(tag) &&
        !isInternalTagName(tag) &&
        k !== `tag:${tag}`,
    )
    .sort((a, b) => String(a).localeCompare(String(b)));
  if (arraysEqual(metaGetContentTags(k), next)) return false;
  if (next.length) WS.meta.contentTags.set(k, new Set(next));
  else WS.meta.contentTags.delete(k);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

// The same diff the folder tag field commits, applied to contents rules.
function metaApplyContentTagsDiff(keys, removeTags, addTags) {
  const remove = new Set(normalizeTagList(removeTags));
  const add = normalizeTagList(addTags);
  let changed = false;
  const refused = new Set();
  for (const key of Array.isArray(keys) ? keys : []) {
    const have = metaGetContentTags(key);
    const allowed = add.filter((tag) => {
      if (have.includes(tag) || !tagLockRefusesContentsSource(tag, key))
        return true;
      refused.add(tag);
      return false;
    });
    const next = have.filter((tag) => !remove.has(tag)).concat(allowed);
    if (metaSetContentTags(key, next)) changed = true;
  }
  announceTagLockRefusals(refused);
  return changed;
}

// Whether a held Tag (see tagLockKind) refuses a contents rule: what the
// source would put in it (a folder's child folders, a Tag's content) must fit
// the lock.
function tagLockRefusesContentsSource(tag, key) {
  const k = String(key || "");
  if (k.startsWith("tag:")) return tagLockRefusesTag(tag, k.slice(4));
  if (!k.startsWith("dir:")) return false;
  if (!tagIsLocked(tag)) return false;
  const sourcePath = k.slice(4);
  const source = sourcePath ? WS.dirByPath.get(sourcePath) : WS.root;
  const children = ((source && source.childrenDirs) || [])
    .filter((child) => child && !child.isMissingPlaceholder && !isInternalTrashDirNode(child))
    .map((child) => String(child.path || ""));
  return tagLockRefusesPaths(tag, children);
}

// Tags a folder is in only because the folder holding it has a contents rule.
function contentTagsForDirPath(path) {
  const p = normalizeDirPathValue(path);
  if (!p) return [];
  const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
  return metaGetContentTags(`dir:${parent}`);
}
