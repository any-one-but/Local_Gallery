/* Tag entries
   The Tag cards a folder shows, Tag views and their counts. */

function getTagFolderEntriesForDir(dirNode, opts = null) {
  if (!WS.root || !dirNode) return [];
  if (dirNode._skipTagFilters) return [];
  if (isPathInsideInternalTrash(dirNode.path || "")) return [];

  const options = opts && typeof opts === "object" ? opts : null;
  const includePlaceholder = !(options && options.includePlaceholder === false);
  const placeholderEntry = includePlaceholder
    ? buildBulkTagPlaceholderEntry()
    : null;
  const originPath = String(dirNode.path || "");
  const cacheKey = [
    originPath || "__root__",
    effectiveFilterCacheKey(),
    tagVisibleChildContextKey(),
    tagFolderEntryOptionContextKey(),
  ].join("@@");
  if (cacheKey && TAG_FOLDER_ENTRIES_CACHE.has(cacheKey)) {
    const cached = TAG_FOLDER_ENTRIES_CACHE.get(cacheKey) || [];
    return placeholderEntry ? [placeholderEntry].concat(cached) : cached.slice();
  }

  const entries = [];
  const scopeModel = getFastTagScopeModel(dirNode);
  const visibleChildren = scopeModel.children;

  // Favorites stays per folder: it collects this folder's favorited children
  // and never combines across the library.
  const favoritesEntry = {
    kind: "tag",
    special: "favorites",
    label: "Favorites",
    originPath,
  };
  const favoriteMembers = visibleChildren.filter((d) =>
    metaHasFavorite(d.path || ""),
  );
  const favs = filterTagEntryDirsByVisibleRecords(
    favoriteMembers,
    favoritesEntry,
  );
  // Favorites leads the Tags' layer rather than sitting with the utility
  // containers (folderEntryFloatTier), so it is pushed after them, just
  // before the placed Tags.
  const favoritesCard = favoriteMembers.some(dirHasUnfilteredIndexedMedia)
    ? {
        kind: "tag",
        label: "Favorites",
        special: "favorites",
        count: favs.length,
        originPath,
      }
    : null;
  if (dirNode === WS.root && showStorageFolderEnabled()) {
    const stored = getAllStorageDirNodes();
    entries.push({
      kind: "tag",
      label: STORAGE_UI_LABEL,
      special: "storage",
      count: stored.length,
      originPath,
    });
  }
  if (showUntaggedFolderEnabled()) {
    const untaggedEntry = {
      kind: "tag",
      special: "untagged",
      label: "Untagged",
      originPath,
    };
    const untaggedMembers = getUntaggedDirsForNode(dirNode);
    const untagged = filterTagEntryDirsByVisibleRecords(
      untaggedMembers,
      untaggedEntry,
    );
    if (untaggedMembers.some(dirHasUnfilteredIndexedMedia)) {
      entries.push({
        kind: "tag",
        label: "Untagged",
        special: "untagged",
        count: untagged.length,
        originPath,
      });
    }
  }
  if (dirNode === WS.root && showAllTagsFolderEnabled()) {
    const count = getChildTagEntriesForTag(ALL_TAGS_NAME).length;
    if (count) {
      entries.push({
        kind: "tag",
        tag: ALL_TAGS_NAME,
        label: "All tags",
        count,
        originPath,
      });
    }
  }
  if (dirNode === WS.root && showTagStorageFolderEnabled()) {
    const count = getChildTagEntriesForTag(TAG_STORAGE_NAME).length;
    if (count) {
      entries.push({
        kind: "tag",
        tag: TAG_STORAGE_NAME,
        label: TAG_STORAGE_LABEL,
        count,
        originPath,
      });
    }
  }
  if (dirNode === WS.root) {
    const views = [
      [ALL_MODELS_NAME, "All Models", showAllModelsFolderEnabled()],
      [ALL_SETS_NAME, "All Sets", showAllSetsFolderEnabled()],
      [CERTIFIED_FRESH_NAME, "Certified fresh", showCertifiedFreshFolderEnabled()],
    ];
    for (const [tag, label, on] of views) {
      if (!on) continue;
      const entry = { kind: "tag", tag, label, originPath };
      if (tag === CERTIFIED_FRESH_NAME)
        CERTIFIED_FRESH_LAST_PATHS = certifiedFreshModelPaths().join("\n");
      const count = filterTagEntryDirsByVisibleRecords(
        tagMemberDirNodes(tag),
        entry,
      ).length;
      if (count) entries.push(Object.assign(entry, { count }));
    }
  }
  if (dirNode.parent === WS.root && showModelMediaFoldersEnabled()) {
    for (const tag of modelMediaViewNamesForModel(dirNode)) {
      const entry = { kind: "tag", tag, label: tagDisplayName(tag), originPath };
      const count = filterTagEntryDirsByVisibleRecords(
        tagMemberDirNodes(tag),
        entry,
      ).length;
      if (count) entries.push(Object.assign(entry, { count }));
    }
  }
  if (favoritesCard) entries.push(favoritesCard);
  const placed =
    getTagModel().tagsByPlacement.get(normalizeDirPathValue(originPath)) || [];
  for (let i = 0; i < placed.length; i++) {
    const entry = tagEntryForName(placed[i]);
    if (entry) entries.push(entry);
  }

  if (cacheKey) TAG_FOLDER_ENTRIES_CACHE.set(cacheKey, entries);
  return placeholderEntry
    ? [placeholderEntry].concat(entries)
    : entries;
}

function getTagFolderEntries() {
  if (!WS.root || !WS.nav.dirNode) return [];
  if (
    searchResultsVisibleInDirectoriesPane() ||
    WS.view.favoritesMode ||
    WS.view.hiddenMode
  )
    return [];
  return getTagFolderEntriesForDir(WS.nav.dirNode, {
    // A preview-initiated bulk tag renders its placeholder only in the preview.
    includePlaceholder: !(
      BULK_TAG_PLACEHOLDER && BULK_TAG_PLACEHOLDER.preferPane === "preview"
    ),
  });
}

function primeTagDerivedCachesForDir(dirNode) {
  if (!dirNode || dirNode._skipTagFilters) return;
  const entries = getTagFolderEntriesForDir(dirNode, {
    includePlaceholder: false,
  });
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.kind !== "tag") continue;
    if (entry.album && !entry.tag) {
      getTagEntriesForAlbumForBaseNode(dirNode, entry.album);
    }
    getDirsForTagEntry(entry);
  }
}
function getTagFolderBaseNode() {
  const basePath = String(WS.view.tagFolderOriginPath || "");
  if (basePath) {
    const node = WS.dirByPath.get(basePath);
    if (node) return node;
  }
  return WS.nav.dirNode || WS.root;
}

function getTagEntriesForTagFolderView() {
  if (!isViewingTagFolder()) return [];
  if (String(WS.view.tagFolderActiveMode || "") !== "tag") return [];
  return getChildTagEntriesForTag(WS.view.tagFolderActiveTag || "");
}

function getTagEntriesForAlbumForBaseNode(baseNode, albumName) {
  const album = normalizeTagAlbumName(albumName || "");
  if (!baseNode) return [];
  if (!album) return [];
  const basePath = String(baseNode.path || "");
  const cacheKey = [
    basePath || "__root__",
    album,
    effectiveFilterCacheKey(),
    tagVisibleChildContextKey(),
    dirSortDisplayCacheKey(),
  ].join("@@");
  if (cacheKey && TAG_ALBUM_TAG_ENTRIES_CACHE.has(cacheKey)) {
    return TAG_ALBUM_TAG_ENTRIES_CACHE.get(cacheKey) || [];
  }
  const tagGroups = gatherTagGroupsForDir(baseNode);
  if (!tagGroups.size) return [];
  const sorted = Array.from(tagGroups.keys()).sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
  const out = [];
  for (let i = 0; i < sorted.length; i++) {
    const tag = String(sorted[i] || "");
    if (!tag) continue;
    if (metaGetTagAlbumForTag(tag, basePath) !== album)
      continue;
    const nodes = tagGroups.get(tag) || [];
    const tagEntry = {
      kind: "tag",
      tag,
      album,
      label: tag,
      originPath: basePath,
    };
    const visibleNodes = filterTagEntryDirsByVisibleRecords(nodes, tagEntry);
    if (!tagHasUnfilteredContent(tag, basePath)) continue;
    out.push({
      kind: "tag",
      tag,
      album,
      label: tag,
      count: visibleNodes.length,
      originPath: basePath,
      albumTag: true,
    });
  }
  if (cacheKey) TAG_ALBUM_TAG_ENTRIES_CACHE.set(cacheKey, out);
  return out;
}

function getDirsForTagFolderView() {
  if (!isViewingTagFolder()) return [];
  const baseNode = getTagFolderBaseNode();
  if (!baseNode) return [];
  const mode = String(WS.view.tagFolderActiveMode || "");
  const basePath = String(baseNode.path || "");
  const cacheKey = [
    basePath || "__root__",
    mode,
    String(WS.view.tagFolderActiveTag || ""),
    String(WS.view.tagFolderActiveAlbum || ""),
    effectiveFilterCacheKey(),
    tagVisibleChildContextKey(),
    dirSortDisplayCacheKey(),
  ].join("@@");
  if (cacheKey && TAG_FOLDER_VIEW_DIRS_CACHE.has(cacheKey)) {
    return TAG_FOLDER_VIEW_DIRS_CACHE.get(cacheKey) || [];
  }
  const setCached = (dirs) => {
    const out = Array.isArray(dirs) ? dirs : [];
    if (cacheKey) TAG_FOLDER_VIEW_DIRS_CACHE.set(cacheKey, out);
    return out;
  };
  const scopeModel = getFastTagScopeModel(baseNode);
  if (mode === "favorites") {
    return setCached(filterTagEntryDirsByVisibleRecords(
      scopeModel.favorites,
      { kind: "tag", special: "favorites", label: "Favorites", originPath: basePath },
    ));
  }
  if (mode === "untagged") {
    return setCached(filterTagEntryDirsByVisibleRecords(
      scopeModel.untagged,
      { kind: "tag", special: "untagged", label: "Untagged", originPath: basePath },
    ));
  }
  if (mode === "hidden") {
    return setCached(filterTagEntryDirsByVisibleRecords(
      scopeModel.hidden,
      { kind: "tag", special: "hidden", label: "Hidden", originPath: basePath },
    ));
  }
  if (mode === "storage") {
    const entry = {
      kind: "tag",
      special: "storage",
      label: STORAGE_UI_LABEL,
      originPath: basePath,
    };
    return setCached(
      sortDirsForTagEntryContainer(
        sortDirCollectionForDisplay(
          getAllStorageDirNodes(),
          `tag-folder-storage:${basePath}`,
        ),
        entry,
      ),
    );
  }
  if (mode !== "tag") return setCached([]);
  const tag = normalizeTag(WS.view.tagFolderActiveTag || "");
  if (!tag) return setCached([]);
  return setCached(
    filterTagEntryDirsByVisibleRecords(tagMemberDirNodes(tag), {
      kind: "tag",
      tag,
      label: tag,
      originPath: basePath,
    }),
  );
}

function getDirsForTagViewFrame(frame) {
  if (!frame) return [];
  const baseNode = WS.dirByPath.get(String(frame.originPath || "")) || WS.root;
  if (!baseNode) return [];
  const basePath = String(baseNode.path || "");
  const scopeModel = getFastTagScopeModel(baseNode);
  if (frame.mode === "favorites")
    return filterTagEntryDirsByVisibleRecords(scopeModel.favorites, {
      kind: "tag", special: "favorites", label: "Favorites", originPath: basePath,
    });
  if (frame.mode === "untagged")
    return filterTagEntryDirsByVisibleRecords(scopeModel.untagged, {
      kind: "tag", special: "untagged", label: "Untagged", originPath: basePath,
    });
  if (frame.mode === "hidden")
    return filterTagEntryDirsByVisibleRecords(scopeModel.hidden, {
      kind: "tag", special: "hidden", label: "Hidden", originPath: basePath,
    });
  if (frame.mode === "storage") {
    const entry = {
      kind: "tag",
      special: "storage",
      label: STORAGE_UI_LABEL,
      originPath: basePath,
    };
    return sortDirsForTagEntryContainer(
      sortDirCollectionForDisplay(
        getAllStorageDirNodes(),
        `tag-frame-storage:${basePath}`,
      ),
      entry,
    );
  }
  if (frame.mode && frame.mode !== "tag") return [];
  const tag = normalizeTag(frame.tag || "");
  if (!tag) return [];
  return filterTagEntryDirsByVisibleRecords(tagMemberDirNodes(tag), {
    kind: "tag",
    tag,
    label: tag,
    originPath: basePath,
  });
}

function getDirsForTagEntry(entry) {
  if (!entry || entry.kind !== "tag") return [];
  const cacheKey = tagEntryDerivedCacheKey(entry);
  if (cacheKey && TAG_ENTRY_DIRS_CACHE.has(cacheKey)) {
    return TAG_ENTRY_DIRS_CACHE.get(cacheKey) || [];
  }
  const remember = (out) => {
    if (cacheKey) TAG_ENTRY_DIRS_CACHE.set(cacheKey, out);
    return out;
  };
  if (!entry.special) {
    const tag = normalizeTag(entry.tag || "");
    if (!tag) return [];
    return remember(
      filterTagEntryDirsByVisibleRecords(tagMemberDirNodes(tag), entry),
    );
  }
  const originPath = String(entry.originPath || "");
  const dirNode = WS.dirByPath.get(originPath) || WS.nav.dirNode;
  if (!dirNode) return [];
  const scopeModel = getFastTagScopeModel(dirNode);
  if (entry.special === "storage") {
    return remember(
      sortDirsForTagEntryContainer(
        sortDirCollectionForDisplay(
          getAllStorageDirNodes(),
          `tag-entry-storage:${originPath}`,
        ),
        entry,
      ),
    );
  }
  if (!scopeModel.children.length) return [];
  if (entry.special === "favorites")
    return remember(filterTagEntryDirsByVisibleRecords(scopeModel.favorites, entry));
  if (entry.special === "untagged")
    return remember(filterTagEntryDirsByVisibleRecords(scopeModel.untagged, entry));
  if (entry.special === "hidden")
    return remember(filterTagEntryDirsByVisibleRecords(scopeModel.hidden, entry));
  return [];
}

// "inverse of" goes after the last " - ", where Trim before last dash cuts,
// so the inverse's card name differs from its Tag's: "beach - sunset" ->
// "beach - inverse of sunset", not "inverse of beach - sunset".
function inverseTagNameFor(tag) {
  const s = String(tag || "");
  const idx = s.lastIndexOf(" - ");
  if (idx < 0) return `inverse of ${s}`;
  return `${s.slice(0, idx + 3)}inverse of ${s.slice(idx + 3)}`;
}

function createInverseTagForEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.special) return false;
  const tag = normalizeTag(entry.tag || "");
  if (!tag) return false;
  const originPath = String(entry.originPath || "");
  const baseNode = WS.dirByPath.get(originPath) || WS.nav.dirNode || WS.root;
  if (!baseNode) {
    showStatusMessage("No folders contain that tag.");
    return false;
  }
  const candidates = getChildDirsForNodeBase(baseNode);
  if (!candidates.length) {
    showStatusMessage("No folders are available in this tag folder.");
    return false;
  }
  const inversePaths = [];
  for (let i = 0; i < candidates.length; i++) {
    const path = String(candidates[i]?.path || "");
    if (!path) continue;
    const tags = metaGetUserTags(path);
    if (tags.includes(tag)) continue;
    inversePaths.push(path);
  }
  if (!inversePaths.length) {
    showStatusMessage(
      `Could not create inverse tag because '${tag}' already contains every folder in this scope.`,
    );
    return false;
  }
  let inverseName = inverseTagNameFor(tag);
  for (let n = 2; tagNameExists(inverseName); n++)
    inverseName = `${inverseTagNameFor(tag)} ${n}`;
  metaAddUserTagsBulk(inversePaths, [inverseName]);
  showStatusMessage(`Created tag '${inverseName}'.`);
  return true;
}

function getTagEntryIconKey(entry) {
  if (!entry || entry.kind !== "tag") return "tag";
  if (entry.album && !entry.tag) return "album";
  if (entry.gallery && !entry.tag && !entry.album) return "gallery";
  if (entry.special === "favorites") return "favorite";
  if (entry.special === "hidden") return "hidden";
  if (entry.special === "storage") return "storage";
  if (entry.special === "untagged") return "untagged";
  const tag = normalizeTag(entry.tag || "");
  if (tag === ALL_MODELS_NAME) return "allModels";
  if (tag === ALL_SETS_NAME) return "allSets";
  if (tag === CERTIFIED_FRESH_NAME) return "certifiedFresh";
  if (tag === TAG_STORAGE_NAME) return "tagStorage";
  const modelView = parseModelMediaViewName(tag);
  if (modelView) return modelView.kind.icon;
  return "tag";
}

function getTagEntryDisplayIcon(entry) {
  return appIconHtml(getTagEntryIconKey(entry));
}

function fastTagEntryFolderCount(entry) {
  if (!entry || entry.kind !== "tag") return 0;
  const direct = Number(entry.count);
  if (Number.isFinite(direct) && direct >= 0) return Math.max(0, Math.round(direct));
  return 0;
}

// Sum of member-folder scores for a tag/album (or Favorites/Hidden/Untagged)
// row, read from the cached fast scope model so it costs no extra sweep. Storage
// stays neutral, matching the full-metrics path. Albums use the normalized name,
// like getDirsForTagEntry.
// Sum of member-folder scores for a Tag (or Favorites/Hidden/Untagged) card.
// Storage stays neutral, matching the full-metrics path.
function fastTagEntryScoreSum(entry) {
  if (!entry || entry.kind !== "tag") return 0;
  if (entry.special === "storage") return 0;
  if (!entry.special) {
    let score = 0;
    for (const node of tagMemberDirNodes(entry.tag || "")) {
      score += Number(metaGetScore(node.path || "")) || 0;
    }
    return score;
  }
  const originPath = String(entry.originPath || "");
  const dirNode = WS.dirByPath.get(originPath) || WS.nav.dirNode;
  if (!dirNode) return 0;
  const model = getFastTagScopeModel(dirNode);
  if (entry.special === "favorites") return Number(model.favoritesScore) || 0;
  if (entry.special === "hidden") return Number(model.hiddenScore) || 0;
  if (entry.special === "untagged") return Number(model.untaggedScore) || 0;
  return 0;
}

function lightweightTagEntryMetrics(entry) {
  const folderCount = fastTagEntryFolderCount(entry);
  return {
    dirs: [],
    folderCount,
    fileCount: 0,
    score: fastTagEntryScoreSum(entry),
    sizeBytes: 0,
  };
}

function shouldUseLightweightTagEntryMetrics(entry, sizeMemo = null) {
  if (!entry || entry.kind !== "tag") return false;
  if (sizeMemo) return false;
  // Tag/album rows should be path/navigation objects, not recursive summary
  // reports. Computing full file/size/score metrics for every tag row can turn
  // opening/exiting a tag into thousands of synchronous lookups. Use the count
  // already attached to the tag entry unless a caller explicitly supplies a memo
  // for aggregate work.
  return true;
}

function getTagEntryCountText(entry) {
  if (shouldUseLightweightTagEntryMetrics(entry)) {
    const folderCount = fastTagEntryFolderCount(entry);
    return `${folderCount} ${folderCount === 1 ? "Folder" : "Folders"}`;
  }
  const metrics = getTagEntryAggregateMetrics(entry);
  return formatFolderFileCountSegment(metrics.folderCount, metrics.fileCount);
}

function getTagEntryAggregateMetrics(entry, sizeMemo = null) {
  if (shouldUseLightweightTagEntryMetrics(entry, sizeMemo)) {
    return lightweightTagEntryMetrics(entry);
  }
  const cacheKey =
    !sizeMemo && entry && entry.kind === "tag"
      ? tagEntryDerivedCacheKey(entry)
      : "";
  if (cacheKey && TAG_ENTRY_METRICS_CACHE.has(cacheKey)) {
    return TAG_ENTRY_METRICS_CACHE.get(cacheKey) || {
      dirs: [],
      folderCount: 0,
      fileCount: 0,
      score: 0,
      sizeBytes: 0,
    };
  }
  const dirs = getDirsForTagEntry(entry);
  let score = 0;
  let sizeBytes = 0;
  let fileCount = 0;
  const folderCount = dirs.length;
  if (entry && entry.kind === "tag" && entry.special === "storage") {
    const result = { dirs, folderCount, fileCount: 0, score: 0, sizeBytes: 0 };
    if (cacheKey) TAG_ENTRY_METRICS_CACHE.set(cacheKey, result);
    return result;
  }
  const seen = new Set();
  for (let i = 0; i < dirs.length; i++) {
    const dirNode = dirs[i];
    const path = String(dirNode?.path || "");
    if (!path || seen.has(path)) continue;
    seen.add(path);
    score += Number(metaGetScore(path)) || 0;
    const summary = getCatalogSummaryForNode(dirNode);
    if (summary) {
      fileCount += Math.max(0, Number(summary.recursiveFileCount) || 0);
      sizeBytes += Math.max(0, Number(summary.recursiveSizeBytes) || 0);
    } else {
      fileCount += Math.max(0, Number(dirNode.recursiveFileCount) || 0);
      sizeBytes += Math.max(0, Number(dirNode.recursiveSizeBytes) || 0);
    }
  }
  const result = { dirs, folderCount, fileCount, score, sizeBytes };
  if (cacheKey) TAG_ENTRY_METRICS_CACHE.set(cacheKey, result);
  return result;
}
function effectiveTagMediaFilterForEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.special) return [];
  const key = tagThumbnailKeyForEntry(entry);
  if (!key) return [];
  const values = [metaGetTagMediaFilterByKey(key)];
  if (entry.album && entry.tag) {
    const scopePath = String(
      entry.originPath != null ? entry.originPath : WS.nav?.dirNode?.path || "",
    );
    values.push(
      metaGetTagMediaFilterByKey(tagThumbnailKeyForAlbum(entry.album, scopePath)),
    );
  }
  return combineTagMediaFilterValues(...values);
}

function tagEntryClaimAllowance(entry) {
  const tag = normalizeTag(entry?.tag || "");
  if (!tag || entry?.special) return null;
  const out = new Set([tag]);
  const queue = [tag];
  while (queue.length) {
    for (const child of tagChildNames(queue.pop())) {
      if (out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

function recordPassesTagEntryFilter(rec, entry) {
  return (
    !!rec &&
    passesFilter(rec, tagEntryClaimAllowance(entry)) &&
    recordPassesFolderMediaFilterForDir(rec, rec.dirPath || "") &&
    recordPassesTagMediaFilter(rec, effectiveTagMediaFilterForEntry(entry))
  );
}

function recordPassesFolderMediaFilterForDir(rec, dirNodeOrPath) {
  if (!rec) return false;
  const dirPath =
    typeof dirNodeOrPath === "string"
      ? dirNodeOrPath
      : String(dirNodeOrPath?.path || rec.dirPath || "");
  const filter = nearestFolderMediaFilterForPath(dirPath);
  return !filter.length || recordPassesTagMediaFilter(rec, filter);
}

function recordPassesContextualTagMediaFilterForDir(rec, dirNodeOrPath) {
  if (!rec) return false;
  const dirPath =
    typeof dirNodeOrPath === "string"
      ? dirNodeOrPath
      : String(dirNodeOrPath?.path || rec.dirPath || "");
  const filter = contextualTagMediaFilterForDirPath(dirPath);
  return !filter.length || recordPassesTagMediaFilter(rec, filter);
}
