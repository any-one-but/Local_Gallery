/* Thumbnail demand
   Which records need thumbnails, per root child, and the navigation snapshot. */

function bumpThumbnailDemandToken() {
  WS.thumbnailDemandToken = ((Number(WS.thumbnailDemandToken) || 0) + 1) >>> 0;
  return WS.thumbnailDemandToken;
}

function currentThumbnailDemandToken() {
  return (Number(WS.thumbnailDemandToken) || 0) >>> 0;
}


function normalizeThumbnailCachePathValue(pathValue) {
  return String(pathValue || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function thumbnailRootPathKey() {
  return normalizeThumbnailCachePathValue(WS.root && WS.root.path);
}

function thumbnailRootChildKeyForPath(pathValue) {
  const path = normalizeThumbnailCachePathValue(pathValue);
  const rootPath = thumbnailRootPathKey();
  if (!path || path === rootPath) return "";
  let rel = path;
  if (rootPath && rel.startsWith(rootPath + "/"))
    rel = rel.slice(rootPath.length + 1);
  const first = String(rel || "").split("/").filter(Boolean)[0] || "";
  if (!first) return "";
  return rootPath ? `${rootPath}/${first}` : first;
}

function thumbnailRootChildKeyForDirNode(dirNode) {
  if (!dirNode || dirNode === WS.root) return "";
  return thumbnailRootChildKeyForPath(dirNode.path || "");
}

function thumbnailRootChildKeyForRecord(rec) {
  if (!rec) return "";
  return thumbnailRootChildKeyForPath(rec.dirPath || "");
}

function thumbnailRecordIsDirectRootItem(rec) {
  if (!rec) return false;
  return normalizeThumbnailCachePathValue(rec.dirPath || "") === thumbnailRootPathKey();
}

function thumbnailCurrentSpaceInfo(snapshot = null) {
  const src = snapshot || currentNavigationSnapshot();
  const navDir = src && src.dirNode ? src.dirNode : null;
  const rootChild = thumbnailRootChildKeyForDirNode(navDir);
  if (isViewingTagFolder()) {
    const tagKey = [
      "tag",
      String(WS.view && WS.view.tagFolderActiveMode || ""),
      String(WS.view && WS.view.tagFolderActiveTag || ""),
      String(WS.view && WS.view.tagFolderActiveAlbum || ""),
      String(navDir && navDir.path || ""),
    ].join(":");
    return { type: "virtual", key: tagKey, rootChildKey: "" };
  }
  if (!navDir || navDir === WS.root)
    return { type: "root", key: "root", rootChildKey: "" };
  return { type: "workspace", key: rootChild || String(navDir.path || ""), rootChildKey: rootChild };
}

function syncThumbnailWorkspaceForSnapshot(snapshot = null) {
  ensureThumbnailCacheSets();
  const info = thumbnailCurrentSpaceInfo(snapshot);
  const nextRootChild = String(info.rootChildKey || "");
  const prevRootChild = String(WS.thumbnailActiveWorkspaceRootChild || "");
  if (!nextRootChild) return info;
  if (prevRootChild && prevRootChild !== nextRootChild) {
    unloadRootChildWorkspaceData(prevRootChild, {
      reason: "root-child-switch",
      nextRootChild,
      showOverlay: false,
    });
  }
  WS.thumbnailActiveWorkspaceRootChild = nextRootChild;
  return info;
}

function thumbnailPathBelongsToRootChild(pathValue, rootChildKey) {
  const key = normalizeThumbnailCachePathValue(rootChildKey);
  if (!key) return false;
  const path = normalizeThumbnailCachePathValue(pathValue);
  return !!(path && (path === key || path.startsWith(key + "/")));
}

function thumbnailRecordBelongsToRootChild(rec, rootChildKey) {
  if (!rec) return false;
  return !!(
    thumbnailPathBelongsToRootChild(rec.dirPath || "", rootChildKey) ||
    thumbnailPathBelongsToRootChild(rec.relPath || "", rootChildKey)
  );
}

function resetCatalogDirNodeToSummary(node) {
  if (!node) return;
  node.childrenDirs = [];
  node.childrenFiles = [];
  node.lastIndex = 0;
  node.loadPromise = null;
  node.loadState = "summary";
  node.subtreeLoadPromise = null;
  node.subtreeLoadState = "summary";
  applyCatalogSummaryToDirNode(node, getCatalogFolderSummary(node.path || ""));
}

function purgeCatalogRuntimeDataForRootChild(rootChildKey) {
  if (!WS.catalog || !WS.catalog.enabled) return;
  const belongs = (pathValue) => thumbnailPathBelongsToRootChild(pathValue, rootChildKey);

  if (WS.catalog.folderShardCache instanceof Map) {
    for (const key of Array.from(WS.catalog.folderShardCache.keys())) {
      if (belongs(key)) WS.catalog.folderShardCache.delete(key);
    }
  }

  if (WS.catalog.fileDescriptorsById instanceof Map) {
    for (const [id, desc] of Array.from(WS.catalog.fileDescriptorsById.entries())) {
      if (thumbnailRecordBelongsToRootChild(desc, rootChildKey))
        WS.catalog.fileDescriptorsById.delete(id);
    }
  }

  if (WS.catalog.fileDescriptorsByRelPath instanceof Map) {
    for (const [relPath, desc] of Array.from(WS.catalog.fileDescriptorsByRelPath.entries())) {
      if (belongs(relPath) || thumbnailRecordBelongsToRootChild(desc, rootChildKey))
        WS.catalog.fileDescriptorsByRelPath.delete(relPath);
    }
  }
}

function purgeDirRuntimeDataForRootChild(rootChildKey) {
  const key = normalizeThumbnailCachePathValue(rootChildKey);
  if (!key || !(WS.dirByPath instanceof Map)) return null;
  const rootChildNode = WS.dirByPath.get(key) || null;
  for (const path of Array.from(WS.dirByPath.keys())) {
    const normalized = normalizeThumbnailCachePathValue(path);
    if (normalized && normalized !== key && thumbnailPathBelongsToRootChild(normalized, key)) {
      WS.dirByPath.delete(path);
    }
  }
  if (rootChildNode) resetCatalogDirNodeToSummary(rootChildNode);
  return rootChildNode;
}

function purgeFileRuntimeDataForRootChild(rootChildKey) {
  ensureThumbnailCacheSets();
  const droppedIds = new Set();
  if (!(WS.fileById instanceof Map)) return droppedIds;
  for (const [idRaw, rec] of Array.from(WS.fileById.entries())) {
    const id = String(idRaw || rec?.id || "");
    if (!id || !thumbnailRecordBelongsToRootChild(rec, rootChildKey)) continue;
    // Keep the tiny root-card pin set alive. Those records are the direct visual
    // table of contents for the root. Everything else in the old root child is
    // discarded so the next root child starts with a fresh metadata/tree load.
    if (WS.thumbnailRootPinnedIds instanceof Set && WS.thumbnailRootPinnedIds.has(id)) continue;
    revokeRecordObjectURLs(rec);
    WS.fileById.delete(idRaw);
    droppedIds.add(id);
  }
  droppedIds.forEach((id) => {
    if (WS.thumbnailActiveWorkspaceIds instanceof Set) WS.thumbnailActiveWorkspaceIds.delete(id);
    if (WS.thumbnailDesiredIds instanceof Set) WS.thumbnailDesiredIds.delete(id);
    if (WS.thumbnailPriorityIds instanceof Set) WS.thumbnailPriorityIds.delete(id);
    if (WS.thumbnailBackgroundDemandIds instanceof Set) WS.thumbnailBackgroundDemandIds.delete(id);
    if (WS.thumbnailPreviewDemandIds instanceof Set) WS.thumbnailPreviewDemandIds.delete(id);
    if (WS.thumbnailDirectoriesDemandIds instanceof Set) WS.thumbnailDirectoriesDemandIds.delete(id);
    if (WS.videoThumbInFlightIds instanceof Set) WS.videoThumbInFlightIds.delete(id);
    if (WS.imageThumbInFlightIds instanceof Set) WS.imageThumbInFlightIds.delete(id);
    if (WS.videoThumbInFlightBackgroundIds instanceof Set) WS.videoThumbInFlightBackgroundIds.delete(id);
    clearVideoThumbRetryState(id);
  });
  clearThumbnailReadyPromisesForIds(droppedIds);
  removeThumbnailIdsFromQueues(droppedIds);
  return droppedIds;
}

function unloadRootChildWorkspaceData(rootChildKey, opts = null) {
  const key = normalizeThumbnailCachePathValue(rootChildKey);
  if (!key || !WS.root) return false;
  const options = opts && typeof opts === "object" ? opts : {};
  if (options.showOverlay) {
    updateBlockingLoaderOverlay(
      "Switching root folder...",
      formatBusyProgressDetail("Unloading previous folder data", key),
    );
  }

  clearQueuedThumbnailWork();
  bumpThumbnailDemandToken();
  const droppedIds = purgeFileRuntimeDataForRootChild(key);
  evictThumbnailIds(new Set(WS.thumbnailActiveWorkspaceIds));
  WS.thumbnailActiveWorkspaceIds = new Set();
  WS.thumbnailWorkspacePreloadKey = "";
  WS.thumbnailBackgroundContextKey = "";
  WS.thumbnailBackgroundCursor = 0;
  WS.thumbnailBackgroundDone = false;

  purgeCatalogRuntimeDataForRootChild(key);
  purgeDirRuntimeDataForRootChild(key);

  if (PRELOAD_CACHE instanceof Map) PRELOAD_CACHE.clear();
  if (PINNED_HOT_NAV_DECODE_CACHE instanceof Map) PINNED_HOT_NAV_DECODE_CACHE.clear();
  HOT_NAV_DIR_PATHS.clear();
  PINNED_HOT_NAV_DIR_PATHS.clear();
  HOT_NAV_CACHE_TOKEN++;
  WORKSPACE_NAV_WARM_TOKEN++;
  WS.view.randomFolderCache = new Map();

  invalidateDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
  reconcileVideoThumbRetryState(thumbnailProtectedIds(new Set()));
  scheduleThumbnailUiInvalidation({ directories: true, preview: true });
  return droppedIds.size > 0 || true;
}

function prepareExclusiveRootChildWorkspace(rootChildNode, opts = null) {
  ensureThumbnailCacheSets();
  const nextKey = thumbnailRootChildKeyForDirNode(rootChildNode);
  if (!nextKey) return;
  const prevKey = String(WS.thumbnailActiveWorkspaceRootChild || "");
  if (prevKey && prevKey !== nextKey) {
    unloadRootChildWorkspaceData(prevKey, {
      reason: "root-child-switch",
      nextRootChild: nextKey,
      showOverlay: !!(opts && opts.showOverlay),
    });
  }
  WS.thumbnailActiveWorkspaceRootChild = nextKey;
}

function markThumbnailRecordCacheTier(rec, spaceInfo = null) {
  if (!rec) return;
  ensureThumbnailCacheSets();
  const id = String(rec.id || "");
  if (!id) return;
  const info = spaceInfo || thumbnailCurrentSpaceInfo();
  if (thumbnailRecordIsDirectRootItem(rec) || (info && info.type === "root")) {
    WS.thumbnailRootPinnedIds.add(id);
    return;
  }
  const rootChild = thumbnailRootChildKeyForRecord(rec);
  if (
    rootChild &&
    info &&
    info.rootChildKey &&
    rootChild === String(info.rootChildKey || "")
  ) {
    WS.thumbnailActiveWorkspaceIds.add(id);
  }
}

function markThumbnailDemandIdsCacheTier(ids, spaceInfo = null) {
  const set = ids instanceof Set ? ids : new Set(ids || []);
  const info = spaceInfo || thumbnailCurrentSpaceInfo();
  set.forEach((id) => markThumbnailRecordCacheTier(WS.fileById.get(String(id || "")), info));
}

function thumbnailProtectedIds(extraDesired = null) {
  ensureThumbnailCacheSets();
  const out = new Set();
  if (extraDesired instanceof Set) extraDesired.forEach((id) => out.add(String(id || "")));
  WS.thumbnailRootPinnedIds.forEach((id) => out.add(String(id || "")));
  WS.thumbnailActiveWorkspaceIds.forEach((id) => out.add(String(id || "")));
  return out;
}

function elementNearVisibleInContainer(container, el, overscanPx = 0) {
  if (!container || !el || !el.getBoundingClientRect) return false;
  const containerRect = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const overscan = Math.max(0, Number(overscanPx) || 0);
  return (
    rect.bottom >= containerRect.top - overscan &&
    rect.top <= containerRect.bottom + overscan &&
    rect.right >= containerRect.left - overscan &&
    rect.left <= containerRect.right + overscan
  );
}

function addRecordToThumbnailDemand(set, rec) {
  const id = String(rec?.id || "");
  if (!id) return;
  set.add(id);
}

function addRecordsToThumbnailDemand(set, records) {
  const list = Array.isArray(records) ? records : [];
  for (let i = 0; i < list.length; i++)
    addRecordToThumbnailDemand(set, list[i]);
}

function recordVisibleInPreviewSurface(recordId) {
  const id = String(recordId || "");
  if (!id || !previewBodyEl) return false;
  if (WS.preview.kind === "file" && String(WS.preview.fileId || "") === id)
    return true;
  const nodes = previewBodyEl.querySelectorAll(
    "[data-dir-preview-id], .fileCard[data-file-id]",
  );
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (String(node.dataset?.dirPreviewId || node.dataset?.fileId || "") === id)
      return true;
  }
  return false;
}

function recordVisibleInDirectoriesSurface(recordId) {
  const id = String(recordId || "");
  if (!id || !directoriesEl) return false;
  const nodes = directoriesEl.querySelectorAll(
    "[data-dir-preview-id], .dirRow.fileRow[data-file-id]",
  );
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (String(node.dataset?.dirPreviewId || node.dataset?.fileId || "") === id)
      return true;
  }
  return false;
}

function applyPreviewState(state) {
  const next = state && typeof state === "object" ? state : {};
  const prevKind = WS.preview.kind || null;
  const prevDirPath = String(WS.preview.dirNode?.path || "");
  const prevFileId = String(WS.preview.fileId || "");
  WS.preview.kind = next.kind || null;
  WS.preview.dirNode = next.dirNode || null;
  WS.preview.fileId = next.fileId || null;
  const nextKind = WS.preview.kind || null;
  const nextDirPath = String(WS.preview.dirNode?.path || "");
  const nextFileId = String(WS.preview.fileId || "");
  if (WS.view) {
    if (nextKind === "file" && nextFileId) WS.view.lastPreviewStateKey = `file:${nextFileId}`;
    else if (nextKind === "dir" && nextDirPath) WS.view.lastPreviewStateKey = `dir:${nextDirPath}`;
    else WS.view.lastPreviewStateKey = "";
  }
  if (
    prevKind !== nextKind ||
    prevDirPath !== nextDirPath ||
    prevFileId !== nextFileId
  ) {
    notePreviewTargetChanged({
      kind: nextKind,
      dirNode: WS.preview.dirNode,
      fileId: nextFileId,
    });
    if (nextKind === "file" && nextFileId) {
      schedulePreviewFileObjectsWarm(WS.preview.dirNode || WS.nav.dirNode, 0);
    } else if (nextKind === "dir" && WS.preview.dirNode) {
      scheduleSelectedDirectoryPreviewRefresh(WS.preview.dirNode, {
        reason: "preview-state-change",
      });
    }
    schedulePreviewRenderForStateChange(nextKind, nextFileId);
  }
}

function schedulePreviewRenderForStateChange(kind, fileId = "") {
  if (kind !== "file" || !fileId) return;
  PREVIEW_STATE_RENDER_FILE_ID = String(fileId || "");
  if (PREVIEW_STATE_RENDER_RAF) return;
  PREVIEW_STATE_RENDER_RAF = requestAnimationFrame(() => {
    PREVIEW_STATE_RENDER_RAF = 0;
    const targetFileId = String(PREVIEW_STATE_RENDER_FILE_ID || "");
    PREVIEW_STATE_RENDER_FILE_ID = "";
    if (
      WS.preview &&
      WS.preview.kind === "file" &&
      String(WS.preview.fileId || "") === targetFileId
    ) {
      renderPreviewPane(false, true);
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }
  });
}

function currentNavigationSnapshot() {
  return {
    dirNode: WS.nav.dirNode,
    preview: {
      kind: WS.preview.kind,
      dirNode: WS.preview.dirNode,
      fileId: WS.preview.fileId,
    },
  };
}

async function runWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (!list.length) return;
  const concurrency = Math.max(1, Math.min(list.length, Number(limit) || 1));
  let index = 0;
  async function pump() {
    while (index < list.length) {
      const currentIndex = index++;
      await worker(list[currentIndex], currentIndex);
    }
  }
  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(pump());
  await Promise.all(workers);
}

function collectNavigationManifestRecords(
  dirNode,
  maxFiles = 0,
  maxChildLeadIds = 0,
) {
  if (!dirNode) return [];
  if (shouldUseLightweightTagAlbumThumbnailsForNode(dirNode)) return [];
  let manifest = null;
  try {
    manifest = getDirectoryNavManifest(dirNode);
  } catch (error) {
    console.error("Directory thumbnail manifest read failed.", error);
    return [];
  }
  if (!manifest) return [];
  const out = [];
  const seen = new Set();
  const pushId = (id) => {
    const normalized = String(id || "");
    if (!normalized || seen.has(normalized)) return;
    const rec = WS.fileById.get(normalized);
    if (!rec) return;
    seen.add(normalized);
    out.push(rec);
  };
  const fileIds = Array.isArray(manifest.fileIds) ? manifest.fileIds : [];
  const childLeadIds = Array.isArray(manifest.childLeadRecordIds)
    ? manifest.childLeadRecordIds
    : [];
  const fileLimit = Math.max(0, Number(maxFiles) || 0);
  const childLimit = Math.max(0, Number(maxChildLeadIds) || 0);
  for (let i = 0; i < fileIds.length && i < fileLimit; i++) pushId(fileIds[i]);
  for (let i = 0; i < childLeadIds.length && i < childLimit; i++)
    pushId(childLeadIds[i]);
  return out;
}

function collectVisibleThumbRecordsForTagEntry(entry) {
  return [];
}
function collectFullNavigationEntryRecords(
  dirNode,
  includeFiles = true,
  opts = null,
) {
  if (!dirNode) return [];
  const options = opts && typeof opts === "object" ? opts : {};
  const useCurrentViewEntries = !!options.useCurrentViewEntries;
  const dirRotateKeyPrefix =
    String(options.dirRotateKeyPrefix || "preview-dir") || "preview-dir";
  const previewEntries = getPreviewFolderAndFileEntries(dirNode, {
    includeFiles,
    useCurrentViewEntries,
  });
  const out = [];
  const seen = new Set();
  const addRecord = (rec) => {
    const id = String(rec?.id || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(rec);
  };
  const addEntryThumbRecords = (entry) => {
    if (!entry) return;
    if (entry.kind === "file") {
      addRecord(WS.fileById.get(String(entry.id || "")));
      return;
    }
    if (entry.kind === "dir" && entry.node) {
      if (shouldUseLightweightTagAlbumThumbnailsForNode(entry.node)) return;
      const leadInfo = getDisplayLeadPreviewForDir(
        entry.node,
        dirRotateKeyPrefix,
      );
      if (leadInfo && leadInfo.record) addRecord(leadInfo.record);
      return;
    }
    if (entry.kind === "tag") {
      const records = collectVisibleThumbRecordsForTagEntry(entry);
      for (let i = 0; i < records.length; i++) addRecord(records[i]);
    }
  };

  const folderEntries = Array.isArray(previewEntries.folderEntries)
    ? previewEntries.folderEntries
    : [];
  for (let i = 0; i < folderEntries.length; i++)
    addEntryThumbRecords(folderEntries[i]);
  if (includeFiles) {
    const fileIds = Array.isArray(previewEntries.fileIds)
      ? previewEntries.fileIds
      : [];
    for (let i = 0; i < fileIds.length; i++)
      addRecord(WS.fileById.get(String(fileIds[i] || "")));
  }
  return out;
}

function collectNavigationEntryWindowRecords(
  dirNode,
  maxEntries = NAVIGATION_PREP_ENTRY_WINDOW,
  opts = null,
) {
  if (!dirNode || dirNode !== WS.nav.dirNode) return [];
  const options = opts && typeof opts === "object" ? opts : {};
  const includeFiles = options.includeFiles !== false;
  const dirRotateKeyPrefix =
    String(options.dirRotateKeyPrefix || "dir") || "dir";
  const entries = Array.isArray(WS.nav.entries) ? WS.nav.entries : [];
  if (!entries.length) return [];

  const entryLimit = Math.max(
    1,
    Number(maxEntries) || NAVIGATION_PREP_ENTRY_WINDOW,
  );
  const selectedIndex = clampNumber(
    Number(WS.nav.selectedIndex) || 0,
    0,
    Math.max(0, entries.length - 1),
    0,
  );
  let start = Math.max(0, selectedIndex - Math.floor(entryLimit / 3));
  if (start + entryLimit > entries.length)
    start = Math.max(0, entries.length - entryLimit);
  const endExclusive = Math.min(entries.length, start + entryLimit);

  const out = [];
  const seen = new Set();
  const addRecord = (rec) => {
    const id = String((rec && rec.id) || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(rec);
  };

  for (let i = start; i < endExclusive; i++) {
    const entry = entries[i];
    if (!entry) continue;
    if (entry.kind === "file") {
      if (!includeFiles) continue;
      addRecord(WS.fileById.get(String(entry.id || "")));
      continue;
    }
    if (entry.kind !== "dir" || !entry.node) continue;
    if (shouldUseLightweightTagAlbumThumbnailsForNode(entry.node)) continue;
    const leadInfo = getDisplayLeadPreviewForDir(
      entry.node,
      dirRotateKeyPrefix,
    );
    if (!(leadInfo && leadInfo.record)) continue;
    addRecord(leadInfo.record);
  }
  return out;
}

function collectNavigationSnapshotRecords(snapshot, opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const full = !!options.full;
  const out = [];
  const seen = new Set();
  const addRecord = (rec) => {
    const id = String((rec && rec.id) || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(rec);
  };
  const addRecords = (records) => {
    const list = Array.isArray(records) ? records : [];
    for (let i = 0; i < list.length; i++) addRecord(list[i]);
  };

  if (snapshot && snapshot.dirNode) {
    if (full) {
      addRecords(
        collectFullNavigationEntryRecords(
          snapshot.dirNode,
          shouldAutoLoadFileThumbnails(),
          {
            useCurrentViewEntries: true,
            dirRotateKeyPrefix: "dir",
          },
        ),
      );
    } else {
      const windowRecords = collectNavigationEntryWindowRecords(
        snapshot.dirNode,
        NAVIGATION_PREP_ENTRY_WINDOW,
        {
          includeFiles: shouldAutoLoadFileThumbnails(),
          dirRotateKeyPrefix: "dir",
        },
      );
      if (windowRecords.length) addRecords(windowRecords);
      else
        addRecords(
          collectNavigationManifestRecords(
            snapshot.dirNode,
            shouldAutoLoadFileThumbnails() ? NAVIGATION_PREP_DIR_FILE_LIMIT : 0,
            NAVIGATION_PREP_CHILD_LEAD_LIMIT,
          ),
        );
    }
  }

  if (
    snapshot &&
    snapshot.preview &&
    snapshot.preview.kind === "dir" &&
    snapshot.preview.dirNode
  ) {
    if (full) {
      addRecords(
        collectFullNavigationEntryRecords(
          snapshot.preview.dirNode,
          shouldAutoLoadFileThumbnails(),
          {
            useCurrentViewEntries:
              snapshot.preview.dirNode === snapshot.dirNode,
            dirRotateKeyPrefix: "preview-dir",
          },
        ),
      );
    } else if (snapshot.preview.dirNode !== snapshot.dirNode) {
      addRecords(
        collectNavigationManifestRecords(
          snapshot.preview.dirNode,
          shouldAutoLoadFileThumbnails()
            ? NAVIGATION_PREP_PREVIEW_FILE_LIMIT
            : 0,
          NAVIGATION_PREP_PREVIEW_CHILD_LIMIT,
        ),
      );
    }
  } else if (
    snapshot &&
    snapshot.preview &&
    snapshot.preview.kind === "file" &&
    snapshot.preview.fileId
  ) {
    if (!shouldAutoLoadFileThumbnails()) return out;
    addRecord(WS.fileById.get(String(snapshot.preview.fileId || "")));
  }
  return out;
}

function collectNearbyDirectoryPaths(snapshot) {
  const out = [];
  const seen = new Set();
  const pushPath = (pathValue) => {
    const path = String(pathValue || "");
    if (seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  const pushDir = (dirNode) => {
    if (!dirNode) return;
    pushPath(dirNode.path || "");
  };
  const pushChildDirs = (dirNode, limit = HOT_NAV_CHILD_LIMIT) => {
    if (!dirNode) return;
    const children = getChildDirsForNode(dirNode);
    for (let i = 0; i < children.length && i < limit; i++) pushDir(children[i]);
  };

  const navDir = snapshot && snapshot.dirNode ? snapshot.dirNode : null;
  const previewDir =
    snapshot && snapshot.preview && snapshot.preview.kind === "dir"
      ? snapshot.preview.dirNode
      : null;
  pushDir(navDir);
  pushDir(previewDir);
  if (navDir && navDir.parent) pushDir(navDir.parent);
  if (previewDir && previewDir.parent) pushDir(previewDir.parent);

  const selectedIndex = Number(WS.nav.selectedIndex || 0);
  const start = Math.max(0, selectedIndex - HOT_NAV_NEARBY_SIBLING_RADIUS);
  const end = Math.min(
    WS.nav.entries.length - 1,
    selectedIndex + HOT_NAV_NEARBY_SIBLING_RADIUS,
  );
  for (let i = start; i <= end; i++) {
    const entry = WS.nav.entries[i];
    if (!entry || entry.kind !== "dir" || !entry.node) continue;
    pushDir(entry.node);
  }

  const selectedEntry = WS.nav.entries[selectedIndex] || null;
  if (selectedEntry && selectedEntry.kind === "dir" && selectedEntry.node) {
    pushDir(selectedEntry.node);
    pushChildDirs(selectedEntry.node, HOT_NAV_CHILD_LIMIT);
  }

  pushChildDirs(navDir, HOT_NAV_CHILD_LIMIT);
  pushChildDirs(previewDir, Math.max(2, Math.floor(HOT_NAV_CHILD_LIMIT / 2)));
  return out;
}

function collectPinnedHotDirectoryPaths(rootNode = null) {
  const startNode = rootNode || WS.root;
  if (!startNode) return [];
  const scoreMemo = new Map();
  const scoreDir = (dirNode) => {
    if (!dirNode) return 0;
    const key = String(dirNode.path || "");
    if (scoreMemo.has(key)) return scoreMemo.get(key) || 0;
    let score =
      getOrderedFileIdsForDir(dirNode, false).length +
      getChildDirsForNode(dirNode).length;
    const children = getChildDirsForNode(dirNode);
    for (let i = 0; i < children.length; i++) score += scoreDir(children[i]);
    scoreMemo.set(key, score);
    return score;
  };
  const allDirs = [];
  const stack = [startNode];
  while (stack.length) {
    const dirNode = stack.pop();
    if (!dirNode) continue;
    allDirs.push(dirNode);
    const children = getChildDirsForNode(dirNode);
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }
  allDirs.sort((a, b) => scoreDir(b) - scoreDir(a));
  const out = [];
  const seen = new Set();
  const pushPath = (dirNode) => {
    if (!dirNode) return;
    const path = String(dirNode.path || "");
    if (seen.has(path)) return;
    seen.add(path);
    out.push(path);
  };
  pushPath(startNode);
  for (
    let i = 0;
    i < allDirs.length && out.length < HOT_NAV_LARGE_DIR_LIMIT + 1;
    i++
  ) {
    pushPath(allDirs[i]);
  }
  return out;
}

function syncPinnedHotNavigationDirectories(rootNode = null) {
  PINNED_HOT_NAV_DIR_PATHS.clear();
  const paths = collectPinnedHotDirectoryPaths(rootNode || WS.root);
  for (let i = 0; i < paths.length; i++)
    PINNED_HOT_NAV_DIR_PATHS.add(String(paths[i] || ""));
  return paths;
}

function collectEffectiveHotDirectoryPaths(snapshot) {
  const paths = [];
  const seen = new Set();
  const pushPath = (pathValue) => {
    const path = String(pathValue || "");
    if (seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  };
  PINNED_HOT_NAV_DIR_PATHS.forEach((path) => pushPath(path));
  const nearby = collectNearbyDirectoryPaths(snapshot);
  for (let i = 0; i < nearby.length; i++) pushPath(nearby[i]);
  return paths;
}

function rememberPinnedHotDecode(img, key) {
  if (!img || !key) return;
  if (PINNED_HOT_NAV_DECODE_CACHE.has(key))
    PINNED_HOT_NAV_DECODE_CACHE.delete(key);
  PINNED_HOT_NAV_DECODE_CACHE.set(key, img);
  while (PINNED_HOT_NAV_DECODE_CACHE.size > PINNED_HOT_NAV_DECODE_LIMIT) {
    const oldest = PINNED_HOT_NAV_DECODE_CACHE.keys().next();
    if (oldest && !oldest.done)
      PINNED_HOT_NAV_DECODE_CACHE.delete(oldest.value);
    else break;
  }
}

function touchHotNavigationDirectoryPaths(paths) {
  const list = Array.isArray(paths) ? paths : [];
  for (let i = 0; i < list.length; i++) {
    const path = String(list[i] || "");
    if (HOT_NAV_DIR_PATHS.has(path)) HOT_NAV_DIR_PATHS.delete(path);
    HOT_NAV_DIR_PATHS.set(path, Date.now());
  }
  while (HOT_NAV_DIR_PATHS.size > HOT_NAV_MAX_DIRS) {
    const oldest = HOT_NAV_DIR_PATHS.keys().next();
    if (oldest && !oldest.done) HOT_NAV_DIR_PATHS.delete(oldest.value);
    else break;
  }
}

async function warmNearbyDirectoriesInRam(snapshot) {
  const records = navigationSnapshotPendingRecords(snapshot, { full: false });
  if (!records.length) return;
  await runWithConcurrency(
    records,
    navigationThumbWorkerLimit("background"),
    ensureNavigationThumbReady,
  );
  releaseColdNavigationThumbs();
}

function scheduleNearbyDirectoryRamWarm(snapshot, delayMs = 0) {
  if (!thumbnailPushQueueEnabled()) return;
  const token = ++HOT_NAV_CACHE_TOKEN;
  if (HOT_NAV_CACHE_TIMER) {
    try {
      clearTimeout(HOT_NAV_CACHE_TIMER);
    } catch {}
  }
  const waitMs = shouldDeferNonEssentialNavigationWork()
    ? Math.max(180, Number(delayMs) || 0)
    : Math.max(80, Number(delayMs) || 0);
  HOT_NAV_CACHE_TIMER = setTimeout(() => {
    HOT_NAV_CACHE_TIMER = 0;
    if (token !== HOT_NAV_CACHE_TOKEN) return;
    warmNearbyDirectoriesInRam(snapshot).catch(() => {});
  }, waitMs);
}

function navigationSnapshotPendingRecords(snapshot, opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const records = collectNavigationSnapshotRecords(snapshot, options);
  return records.filter((rec) => {
    if (!rec) return false;
    if (rec.type === "video") {
      const mode = currentVideoThumbMode();
      if (videoThumbModeSkipsLoading(mode)) return false;
      return !(rec.videoThumbUrl && rec.videoThumbMode === mode);
    }
    if (rec.type === "image") {
      const mode = currentImageThumbMode();
      if (imageThumbModeSkipsLoading(mode)) return false;
      return !(rec.thumbUrl && rec.thumbMode === mode);
    }
    return false;
  });
}

async function ensureNavigationSnapshotReady(snapshot, opts = null) {
  const records = navigationSnapshotPendingRecords(snapshot, opts);
  if (!records.length) return;
  await runWithConcurrency(
    records,
    navigationThumbWorkerLimit("blocking"),
    ensureNavigationThumbDisplayReady,
  );
}

function thumbnailRootChildNodeForDirNode(dirNode) {
  if (!dirNode || !WS.root || dirNode === WS.root) return null;
  let node = dirNode;
  while (node && node.parent && node.parent !== WS.root) node = node.parent;
  return node && node.parent === WS.root ? node : null;
}

function thumbnailWorkspacePreloadKeyForRootChild(rootChildNode) {
  if (!rootChildNode) return "";
  return [
    "workspace-thumbs-v1",
    String(WS.root?.path || ""),
    String(rootChildNode.path || ""),
    String(currentImageThumbMode()),
    String(currentVideoThumbMode()),
    String(THUMB_FILTER_KEY || buildThumbFilterKey()),
  ].join("||");
}

function collectRootPinnedThumbnailRecords() {
  const out = [];
  const seen = new Set();
  const addRecord = (rec) => {
    const id = String(rec?.id || "");
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(rec);
  };
  if (!WS.root) return out;
  const rootFiles = Array.isArray(WS.root.childrenFiles)
    ? WS.root.childrenFiles
    : [];
  for (let i = 0; i < rootFiles.length; i++)
    addRecord(WS.fileById.get(String(rootFiles[i] || "")));
  const rootDirs = getChildDirsForNode(WS.root);
  for (let i = 0; i < rootDirs.length; i++) {
    const child = rootDirs[i];
    if (!child) continue;
    const leadInfo = getDisplayLeadPreviewForDir(child, "root-pinned");
    if (leadInfo && leadInfo.record) addRecord(leadInfo.record);

    // v10: root cards are permanent table-of-contents items. Do not let score,
    // unloaded state, current filters, or one missing display-lead path prevent
    // a root card from getting at least one pinned thumbnail candidate.
    const manifest = getDirectoryNavManifest(child);
    const manifestLeadId = String((manifest && manifest.leadRecordId) || "");
    if (manifestLeadId) addRecord(WS.fileById.get(manifestLeadId));
    const summary = getCatalogSummaryForNode(child);
    const directDesc = summary ? summary.directLeadFile || summary.leadFile || null : null;
    if (directDesc) addRecord(ensureFileRecordFromDescriptor(directDesc));
    const directRec = getFirstDirectPreviewRecordForDir(child);
    if (directRec) addRecord(directRec);
  }
  return out;
}

function markRootPinnedThumbnailRecords(records = null) {
  ensureThumbnailCacheSets();
  const list = Array.isArray(records) ? records : collectRootPinnedThumbnailRecords();
  for (let i = 0; i < list.length; i++) {
    const id = String(list[i]?.id || "");
    if (id) WS.thumbnailRootPinnedIds.add(id);
  }
  return list;
}

function collectRecursiveWorkspaceThumbnailRecords(rootChildNode) {
  const out = [];
  const seen = new Set();
  const addRecord = (rec) => {
    const id = String(rec?.id || "");
    if (!id || seen.has(id)) return;
    if (rec.type !== "image" && rec.type !== "video") return;
    seen.add(id);
    out.push(rec);
  };
  const walk = (node) => {
    if (!node) return;
    const leadInfo = getDisplayLeadPreviewForDir(node, "workspace-full");
    if (leadInfo && leadInfo.record) addRecord(leadInfo.record);
    const fileIds = Array.isArray(node.childrenFiles) ? node.childrenFiles : [];
    for (let i = 0; i < fileIds.length; i++)
      addRecord(WS.fileById.get(String(fileIds[i] || "")));
    const childDirs = getChildDirsForNode(node);
    for (let i = 0; i < childDirs.length; i++) walk(childDirs[i]);
  };
  walk(rootChildNode);
  return out;
}

function markWorkspaceThumbnailRecords(records, rootChildNode) {
  ensureThumbnailCacheSets();
  if (!rootChildNode) return new Set();
  const rootChildKey = thumbnailRootChildKeyForDirNode(rootChildNode);
  const ids = new Set();
  const list = Array.isArray(records) ? records : [];
  for (let i = 0; i < list.length; i++) {
    const rec = list[i];
    const id = String(rec?.id || "");
    if (!id) continue;
    ids.add(id);
    if (thumbnailRecordIsDirectRootItem(rec)) {
      WS.thumbnailRootPinnedIds.add(id);
    } else if (rootChildKey && thumbnailRootChildKeyForRecord(rec) === rootChildKey) {
      WS.thumbnailActiveWorkspaceIds.add(id);
    } else {
      // Custom folder thumbnails can point outside the open folder. Keep them
      // alive with the active workspace so folder cards do not lose their art.
      WS.thumbnailActiveWorkspaceIds.add(id);
    }
  }
  const protectedDesiredIds = thumbnailProtectedIds(ids);
  WS.thumbnailDesiredIds = protectedDesiredIds;
  reconcileVideoThumbRetryState(protectedDesiredIds);
  evictThumbnailUrlsOutsideDemand(protectedDesiredIds);
  return ids;
}

function thumbnailRecordHasLoadedWorkspaceThumb(rec) {
  return !thumbnailRecordNeedsWork(rec);
}

async function prepareInteractiveNavigationSnapshot(snapshot) {
  return prepareNavigationSnapshot(
    snapshot,
    "Preparing directory view...",
  );
}

function shouldUseWindowedPreviewBridgeSnapshot(snapshot = null) {
  const src = snapshot || currentNavigationSnapshot();
  return !!(
    WS.view &&
    WS.view.previewFolderBridgeReturnState &&
    String(WS.view.activePane || "") === "preview" &&
    isViewingTagFolder() &&
    src &&
    src.preview &&
    src.preview.kind === "dir" &&
    src.preview.dirNode &&
    src.preview.dirNode !== src.dirNode
  );
}

async function prepareNavigationSnapshot(
  snapshot,
  label = "Preparing thumbnails...",
  opts = null,
) {
  const options = opts && typeof opts === "object" ? opts : {};
  const full = options.full !== false;
  const scheduleWarm = options.scheduleWarm !== false;
  const keepBusyOverlay = !!options.keepBusyOverlay;
  if (!tortoiseNavigationEnabled()) {
    if (scheduleWarm) scheduleNearbyDirectoryRamWarm(snapshot);
    return true;
  }
  let pending = [];
  try {
    pending = navigationSnapshotPendingRecords(snapshot, { full });
  } catch (error) {
    console.error("Preparing thumbnail snapshot failed.", error);
    if (scheduleWarm) scheduleNearbyDirectoryRamWarm(snapshot);
    return false;
  }
  if (!pending.length) {
    if (scheduleWarm) scheduleNearbyDirectoryRamWarm(snapshot);
    return true;
  }
  const token = ++NAVIGATION_PREP_TOKEN;
  showBusyOverlay(label);
  try {
    await runWithConcurrency(
      pending,
      navigationThumbWorkerLimit("blocking"),
      async (rec, index) => {
        try {
          await ensureNavigationThumbDisplayReady(rec, index);
        } catch (error) {
          console.error("Preparing thumbnail failed.", {
            recordId: String(rec?.id || ""),
            error,
          });
        }
      },
    );
  } finally {
    if (token === NAVIGATION_PREP_TOKEN && !keepBusyOverlay)
      hideBusyOverlay();
  }
  if (token === NAVIGATION_PREP_TOKEN && scheduleWarm)
    scheduleNearbyDirectoryRamWarm(snapshot);
  return token === NAVIGATION_PREP_TOKEN;
}

let NAVIGATION_RENDER_TOKEN = 0;
function cancelPendingNavigationRender() {
  NAVIGATION_RENDER_TOKEN++;
}

async function finalizeDirectoryNavigationRender(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const animatePreview = options.animatePreview !== false;
  const keepDirectoriesScroll = !!options.keepDirectoriesScroll;
  const keepPreviewScroll = !!options.keepPreviewScroll;
  const activatePreviewSelectionAfterRender =
    !!options.activatePreviewSelection;
  const shouldRecordHistory = !!options.recordHistory;
  const prepareFull = options.prepareFull !== false;
  const schedulePreparedWarm = options.schedulePreparedWarm !== false;
  const deferDirectoriesRender = !!options.deferDirectoriesRender;
  const showBusyBeforeRender =
    !!options.showBusyBeforeRender && tortoiseNavigationEnabled();
  const snapshot = currentNavigationSnapshot();
  const token = ++NAVIGATION_RENDER_TOKEN;
  if (showBusyBeforeRender) {
    showBusyOverlay(options.busyLabel || "Updating preview...");
    await waitForNextPaint();
    if (token !== NAVIGATION_RENDER_TOKEN) {
      hideBusyOverlay();
      return false;
    }
  }
  if (!tortoiseNavigationEnabled()) {
    renderDirectoriesPane(keepDirectoriesScroll);
    renderPreviewPane(false, keepPreviewScroll);
    if (activatePreviewSelectionAfterRender && WS.view.activePane === "preview")
      activatePreviewPaneSelection();
    else updatePreviewSelectionClasses();
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
    // Repair only when the first paint actually looks empty — not on every nav.
    if (
      WS.preview.kind === "dir" &&
      WS.preview.dirNode &&
      previewFolderGridNeedsRepair(WS.preview.dirNode)
    ) {
      schedulePreviewFolderGridRepairForCurrentTarget(1);
    }
    if (shouldRecordHistory) recordDirHistory();
    if (schedulePreparedWarm) scheduleNearbyDirectoryRamWarm(snapshot, 80);
    return true;
  }
  try {
    const effectivePrepareFull = prepareFull && !isViewingPerformanceSensitiveTagAlbumFolder();
    await prepareNavigationSnapshot(
      snapshot,
      "Preparing directory view...",
      {
        full: effectivePrepareFull,
        scheduleWarm: schedulePreparedWarm,
        keepBusyOverlay: showBusyBeforeRender,
      },
    );
    if (token !== NAVIGATION_RENDER_TOKEN) return false;
    if (deferDirectoriesRender) {
      renderPreviewPane(animatePreview, keepPreviewScroll);
    } else {
      renderDirectoriesPane(keepDirectoriesScroll);
      renderPreviewPane(animatePreview, keepPreviewScroll);
    }
    if (activatePreviewSelectionAfterRender && WS.view.activePane === "preview")
      activatePreviewPaneSelection();
    else updatePreviewSelectionClasses();
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
    schedulePreviewFolderGridRepairForCurrentTarget(2);
    if (shouldRecordHistory) recordDirHistory();
    if (deferDirectoriesRender) {
      requestAnimationFrame(() => {
        try {
          if (token !== NAVIGATION_RENDER_TOKEN) return;
          renderDirectoriesPane(keepDirectoriesScroll, {
            suppressSelectionReveal: true,
          });
          updatePreviewSelectionClasses();
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          schedulePreviewFolderGridRepairForCurrentTarget(2);
        } finally {
          if (showBusyBeforeRender && token === NAVIGATION_RENDER_TOKEN)
            hideBusyOverlay();
        }
      });
    }
    return true;
  } finally {
    if (
      showBusyBeforeRender &&
      (!deferDirectoriesRender || token !== NAVIGATION_RENDER_TOKEN)
    )
      hideBusyOverlay();
  }
}

function scheduleWorkspaceNavigationWarm(rootNode = null, delayMs = 1200) {
  return;
}
