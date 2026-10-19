/* Renames and moves
   Directory handles, renaming and moving on disk, and re-keying everything
   that names a path. */

async function getDirectoryHandleForPath(rootHandle, path) {
  const norm = String(path || "").replace(/^\/+|\/+$/g, "");
  if (!norm) {
    DIR_HANDLE_CACHE.set("", rootHandle);
    return rootHandle;
  }
  if (DIR_HANDLE_CACHE.has(norm)) return DIR_HANDLE_CACHE.get(norm);
  let cur = rootHandle;
  let acc = "";
  const parts = norm.split("/").filter(Boolean);
  for (const part of parts) {
    acc = acc ? acc + "/" + part : part;
    if (DIR_HANDLE_CACHE.has(acc)) {
      cur = DIR_HANDLE_CACHE.get(acc);
      continue;
    }
    cur = await cur.getDirectoryHandle(part);
    DIR_HANDLE_CACHE.set(acc, cur);
  }
  return cur;
}

async function ensureDirectoryHandleForPath(rootHandle, path) {
  const norm = String(path || "").replace(/^\/+|\/+$/g, "");
  if (!norm) {
    DIR_HANDLE_CACHE.set("", rootHandle);
    return rootHandle;
  }
  if (DIR_HANDLE_CACHE.has(norm)) return DIR_HANDLE_CACHE.get(norm);
  let cur = rootHandle;
  let acc = "";
  const parts = norm.split("/").filter(Boolean);
  for (const part of parts) {
    acc = acc ? acc + "/" + part : part;
    if (DIR_HANDLE_CACHE.has(acc)) {
      cur = DIR_HANDLE_CACHE.get(acc);
      continue;
    }
    cur = await cur.getDirectoryHandle(part, { create: true });
    DIR_HANDLE_CACHE.set(acc, cur);
  }
  return cur;
}

function invalidateDirHandleCache(prefix) {
  const p = String(prefix || "");
  if (!p) {
    DIR_HANDLE_CACHE = new Map();
    return;
  }
  for (const key of Array.from(DIR_HANDLE_CACHE.keys())) {
    if (key === p || key.startsWith(p + "/")) DIR_HANDLE_CACHE.delete(key);
  }
}

async function copyDirectoryHandle(srcHandle, dstHandle) {
  for await (const [name, handle] of srcHandle.entries()) {
    if (handle.kind === "file") {
      const file = await handle.getFile();
      const dstFile = await dstHandle.getFileHandle(name, { create: true });
      const writable = await dstFile.createWritable();
      await writable.write(file);
      await writable.close();
    } else if (handle.kind === "directory") {
      const childDst = await dstHandle.getDirectoryHandle(name, {
        create: true,
      });
      await copyDirectoryHandle(handle, childDst);
    }
  }
}

async function renameDirectoryOnDisk(oldPath, newName) {
  const rootHandle = WS.meta.fsRootHandle;
  if (!rootHandle) throw new Error("No writable folder loaded.");

  const parts = String(oldPath || "")
    .split("/")
    .filter(Boolean);
  const oldName = parts.pop() || "";
  const parentPath = parts.join("/");

  const parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);

  let existing = null;
  try {
    existing = await parentHandle.getDirectoryHandle(newName);
  } catch {}
  if (existing) throw new Error("Target folder exists.");

  const srcHandle = await parentHandle.getDirectoryHandle(oldName);

  if (typeof srcHandle.move === "function") {
    try {
      await srcHandle.move(parentHandle, newName);
      return;
    } catch {}
  }

  const dstHandle = await parentHandle.getDirectoryHandle(newName, {
    create: true,
  });
  await copyDirectoryHandle(srcHandle, dstHandle);
  await parentHandle.removeEntry(oldName, { recursive: true });
}

async function renameFileOnDisk(dirHandle, fileHandle, oldName, newName) {
  if (!dirHandle || !fileHandle) return false;
  if (typeof fileHandle.move === "function") {
    try {
      await fileHandle.move(dirHandle, newName);
      return true;
    } catch {}
  }
  try {
    const file = await fileHandle.getFile();
    const dstFile = await dirHandle.getFileHandle(newName, { create: true });
    const writable = await dstFile.createWritable();
    await writable.write(file);
    await writable.close();
    await dirHandle.removeEntry(oldName);
    return true;
  } catch {}
  return false;
}

async function renameDirectoryHandleInParent(
  parentHandle,
  dirHandle,
  oldName,
  newName,
) {
  if (!parentHandle || !dirHandle) return false;
  if (typeof dirHandle.move === "function") {
    try {
      await dirHandle.move(parentHandle, newName);
      return true;
    } catch {}
  }
  try {
    const dstHandle = await parentHandle.getDirectoryHandle(newName, {
      create: true,
    });
    await copyDirectoryHandle(dirHandle, dstHandle);
    await parentHandle.removeEntry(oldName, { recursive: true });
    return true;
  } catch {}
  return false;
}

// File ids embed the record's relPath as the last "::" segment
// (fileKeyForRecord), so a folder move/trash re-keys every descendant id.
function remapFileIdForPathPrefix(id, oldPrefix, newPrefix) {
  const s = String(id || "");
  const sep = s.lastIndexOf("::");
  if (sep < 0) return s;
  const rel = s.slice(sep + 2);
  const next = remapPathPrefix(oldPrefix, newPrefix, rel);
  return next === rel ? s : s.slice(0, sep + 2) + next;
}

function remapSelectionKeyForPathPrefix(key, oldPrefix, newPrefix) {
  const s = String(key || "");
  if (s.startsWith("dir:"))
    return "dir:" + remapPathPrefix(oldPrefix, newPrefix, s.slice(4));
  if (s.startsWith("expanded-dir:"))
    return (
      "expanded-dir:" + remapPathPrefix(oldPrefix, newPrefix, s.slice(13))
    );
  if (s.startsWith("file:"))
    return "file:" + remapFileIdForPathPrefix(s.slice(5), oldPrefix, newPrefix);
  return s;
}

// The pane-bridge snapshots (previewFolderBridgeReturnState /
// previewFileBridgeReturnState, shape from captureViewerCloseRestoreState)
// store raw path strings. If a folder captured in one is renamed or moved to
// trash before the snapshot is restored, restoreViewerCloseState falls back
// to root/first-item — the "file pane teleports" bug — so re-key them along
// with the rest of the view state.
function remapViewerCloseRestoreStatePaths(state, oldPrefix, newPrefix) {
  if (!state || typeof state !== "object") return;
  state.dirPath = remapPathPrefix(oldPrefix, newPrefix, state.dirPath);
  state.entryKey = remapSelectionKeyForPathPrefix(
    state.entryKey,
    oldPrefix,
    newPrefix,
  );
  if (state.view && typeof state.view === "object") {
    const viewPathKeys = [
      "tagFolderOriginPath",
      "favoritesAnchorPath",
      "hiddenAnchorPath",
      "searchRootPath",
      "searchAnchorPath",
      "searchEntryRootPath",
    ];
    for (const key of viewPathKeys) {
      if (typeof state.view[key] === "string") {
        state.view[key] = remapPathPrefix(oldPrefix, newPrefix, state.view[key]);
      }
    }
  }
  if (Array.isArray(state.tagNavStack)) {
    for (const frame of state.tagNavStack) {
      if (!frame || typeof frame !== "object") continue;
      for (const key of ["originPath", "selectedDirPath", "dirPath", "path"]) {
        if (typeof frame[key] === "string" && frame[key]) {
          frame[key] = remapPathPrefix(oldPrefix, newPrefix, frame[key]);
        }
      }
    }
  }
  if (Array.isArray(state.navEntries)) {
    for (const entry of state.navEntries) {
      // Dir entries reference live nodes whose paths are remapped in place;
      // only the id-keyed file entries need re-keying here.
      if (entry && entry.kind === "file" && entry.id) {
        entry.id = remapFileIdForPathPrefix(entry.id, oldPrefix, newPrefix);
      }
    }
  }
  const previewState = state.previewState;
  if (previewState && typeof previewState === "object") {
    if (previewState.kind === "dir") {
      previewState.path = remapPathPrefix(
        oldPrefix,
        newPrefix,
        previewState.path,
      );
    } else if (previewState.kind === "file") {
      previewState.fileId = remapFileIdForPathPrefix(
        previewState.fileId,
        oldPrefix,
        newPrefix,
      );
      previewState.dirPath = remapPathPrefix(
        oldPrefix,
        newPrefix,
        previewState.dirPath,
      );
    } else if (previewState.kind === "tag-dir") {
      previewState.originPath = remapPathPrefix(
        oldPrefix,
        newPrefix,
        previewState.originPath,
      );
    }
  }
  state.pendingPreviewSelectionKey = remapSelectionKeyForPathPrefix(
    state.pendingPreviewSelectionKey,
    oldPrefix,
    newPrefix,
  );
  state.previewContextKey = remapSelectionKeyForPathPrefix(
    state.previewContextKey,
    oldPrefix,
    newPrefix,
  );
  state.previewSelectedKey = remapSelectionKeyForPathPrefix(
    state.previewSelectedKey,
    oldPrefix,
    newPrefix,
  );
  remapViewerCloseRestoreStatePaths(
    state.previewFolderBridgeReturnState,
    oldPrefix,
    newPrefix,
  );
}

function updateViewStatePathsForRename(oldPrefix, newPrefix) {
  WS.view.dirActionMenuPath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.dirActionMenuPath,
  );
  WS.view.searchRootPath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.searchRootPath,
  );
  WS.view.searchAnchorPath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.searchAnchorPath,
  );
  WS.view.searchEntryRootPath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.searchEntryRootPath,
  );
  WS.view.favoritesAnchorPath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.favoritesAnchorPath,
  );
  WS.view.hiddenAnchorPath = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.hiddenAnchorPath,
  );

  if (WS.view.favoritesReturnState) {
    WS.view.favoritesReturnState.dirPath = remapPathPrefix(
      oldPrefix,
      newPrefix,
      WS.view.favoritesReturnState.dirPath,
    );
    if (
      WS.view.favoritesReturnState.sel &&
      WS.view.favoritesReturnState.sel.kind === "dir"
    ) {
      WS.view.favoritesReturnState.sel.path = remapPathPrefix(
        oldPrefix,
        newPrefix,
        WS.view.favoritesReturnState.sel.path,
      );
    }
  }

  if (WS.view.hiddenReturnState) {
    WS.view.hiddenReturnState.dirPath = remapPathPrefix(
      oldPrefix,
      newPrefix,
      WS.view.hiddenReturnState.dirPath,
    );
    if (
      WS.view.hiddenReturnState.sel &&
      WS.view.hiddenReturnState.sel.kind === "dir"
    ) {
      WS.view.hiddenReturnState.sel.path = remapPathPrefix(
        oldPrefix,
        newPrefix,
        WS.view.hiddenReturnState.sel.path,
      );
    }
  }

  WS.view.bulkTagSelectionsByDir = remapPathMapKeys(
    WS.view.bulkTagSelectionsByDir,
    oldPrefix,
    newPrefix,
  );
  WS.view.bulkTagFolderSelectionsByDir = remapPathMapKeys(
    WS.view.bulkTagFolderSelectionsByDir,
    oldPrefix,
    newPrefix,
  );
  WS.view.bulkFileSelectionsByDir = remapPathMapKeys(
    WS.view.bulkFileSelectionsByDir,
    oldPrefix,
    newPrefix,
  );
  // Remap the stored folder-path selections of every context, in place so the
  // live WS.view.bulkTagSelectedPaths alias into this map stays intact.
  for (const set of WS.view.bulkTagSelectionsByDir.values()) {
    remapPathSetInPlace(set, oldPrefix, newPrefix);
  }
  // Idempotent when the live set is one of the map sets above; still needed
  // when it isn't aliased (e.g. restored from a snapshot).
  remapPathSetInPlace(WS.view.bulkTagSelectedPaths, oldPrefix, newPrefix);

  remapViewerCloseRestoreStatePaths(
    WS.view.previewFolderBridgeReturnState,
    oldPrefix,
    newPrefix,
  );
  remapViewerCloseRestoreStatePaths(
    WS.view.previewFileBridgeReturnState,
    oldPrefix,
    newPrefix,
  );

  WS.view.pendingPreviewSelectionKey = remapSelectionKeyForPathPrefix(
    WS.view.pendingPreviewSelectionKey,
    oldPrefix,
    newPrefix,
  );
  WS.view.previewSelectedKey = remapSelectionKeyForPathPrefix(
    WS.view.previewSelectedKey,
    oldPrefix,
    newPrefix,
  );
  WS.view.previewSelectAnchorKey = remapSelectionKeyForPathPrefix(
    WS.view.previewSelectAnchorKey,
    oldPrefix,
    newPrefix,
  );
  WS.view.previewSelectionContextKey = remapSelectionKeyForPathPrefix(
    WS.view.previewSelectionContextKey,
    oldPrefix,
    newPrefix,
  );
  WS.view.currentNavSelectedEntryKey = remapSelectionKeyForPathPrefix(
    WS.view.currentNavSelectedEntryKey,
    oldPrefix,
    newPrefix,
  );
  WS.view.lastPreviewSyncedEntryKey = remapSelectionKeyForPathPrefix(
    WS.view.lastPreviewSyncedEntryKey,
    oldPrefix,
    newPrefix,
  );
  WS.view.lastPreviewStateKey = remapSelectionKeyForPathPrefix(
    WS.view.lastPreviewStateKey,
    oldPrefix,
    newPrefix,
  );
  if (WS.view.previewScrollByDir instanceof Map) {
    WS.view.previewScrollByDir = remapPathMapKeys(
      WS.view.previewScrollByDir,
      oldPrefix,
      newPrefix,
    );
  }
  WS.view.previewScrollActiveKey = remapPathPrefix(
    oldPrefix,
    newPrefix,
    WS.view.previewScrollActiveKey,
  );
}

function updateMetaPathsForRename(oldPrefix, newPrefix) {
  WS.meta.dirScores = remapPathMapKeys(WS.meta.dirScores, oldPrefix, newPrefix);
  WS.meta.pendingDirScores = remapPathMapKeys(
    WS.meta.pendingDirScores,
    oldPrefix,
    newPrefix,
  );
  WS.meta.dirTags = remapPathMapKeys(WS.meta.dirTags, oldPrefix, newPrefix);
  if (WS.meta.contentTags instanceof Map) {
    const nextContent = new Map();
    for (const [key, tags] of WS.meta.contentTags.entries()) {
      nextContent.set(
        key.startsWith("dir:")
          ? `dir:${remapPathPrefix(oldPrefix, newPrefix, key.slice(4))}`
          : key,
        tags,
      );
    }
    WS.meta.contentTags = nextContent;
  }
  if (WS.meta.scoreFilterOverrides instanceof Map) {
    const nextOverrides = new Map();
    for (const [key, entry] of WS.meta.scoreFilterOverrides.entries()) {
      nextOverrides.set(
        key.startsWith("dir:")
          ? `dir:${remapPathPrefix(oldPrefix, newPrefix, key.slice(4))}`
          : key,
        entry,
      );
    }
    WS.meta.scoreFilterOverrides = nextOverrides;
    bumpScoreFilterRevision();
  }
  WS.meta.pendingTagsByPath = remapPathMapKeys(
    WS.meta.pendingTagsByPath,
    oldPrefix,
    newPrefix,
  );
  WS.meta.folderGalleriesByPath = remapPathMapKeys(
    WS.meta.folderGalleriesByPath,
    oldPrefix,
    newPrefix,
  );
  WS.meta.folderAlbumByPath = remapPathMapKeys(
    WS.meta.folderAlbumByPath,
    oldPrefix,
    newPrefix,
  );
  WS.meta.folderMediaFilterByPath = remapPathMapKeys(
    WS.meta.folderMediaFilterByPath,
    oldPrefix,
    newPrefix,
  );
  WS.meta.dirFingerprints = remapPathMapKeys(
    WS.meta.dirFingerprints,
    oldPrefix,
    newPrefix,
  );
  WS.meta.dirThumbPresets = remapPathMapKeys(
    WS.meta.dirThumbPresets,
    oldPrefix,
    newPrefix,
  );
  WS.meta.pendingDirThumbPresets = remapPathMapKeys(
    WS.meta.pendingDirThumbPresets,
    oldPrefix,
    newPrefix,
  );
  WS.meta.dirAppearancePresetIds = remapPathMapKeys(
    WS.meta.dirAppearancePresetIds,
    oldPrefix,
    newPrefix,
  );
  WS.meta.pendingDirAppearancePresetIds = remapPathMapKeys(
    WS.meta.pendingDirAppearancePresetIds,
    oldPrefix,
    newPrefix,
  );
  WS.meta.containerSortByFolderPath = remapPathMapKeys(
    WS.meta.containerSortByFolderPath,
    oldPrefix,
    newPrefix,
  );
  if (WS.meta.folderAltByPath) {
    WS.meta.folderAltByPath = remapPathMapKeys(
      WS.meta.folderAltByPath,
      oldPrefix,
      newPrefix,
    );
  }
  WS.meta.dirThumbPresets = remapPathMapValues(
    WS.meta.dirThumbPresets,
    oldPrefix,
    newPrefix,
  );
  WS.meta.fileThumbCrop = remapPathMapKeys(
    WS.meta.fileThumbCrop,
    oldPrefix,
    newPrefix,
  );
  if (WS.meta.thumbFileIdentity instanceof Map) {
    WS.meta.thumbFileIdentity = remapPathMapKeys(
      WS.meta.thumbFileIdentity,
      oldPrefix,
      newPrefix,
    );
  }
  WS.meta.videoThumbTime = remapPathMapKeys(
    WS.meta.videoThumbTime,
    oldPrefix,
    newPrefix,
  );
  WS.meta.aspectRatios = remapPathMapKeys(
    WS.meta.aspectRatios,
    oldPrefix,
    newPrefix,
  );
  WS.meta.dirFingerprintMemory = remapPathMapKeys(
    WS.meta.dirFingerprintMemory,
    oldPrefix,
    newPrefix,
  );
  if (WS.meta.trashItemsByPath && WS.meta.trashItemsByPath.size) {
    const nextTrashItemsByPath = new Map();
    let trashChanged = false;
    for (const [trashPath, item] of WS.meta.trashItemsByPath.entries()) {
      const nextOriginalPath = remapPathPrefix(
        oldPrefix,
        newPrefix,
        item && item.originalPath,
      );
      if (nextOriginalPath !== String(item?.originalPath || ""))
        trashChanged = true;
      nextTrashItemsByPath.set(trashPath, Object.assign({}, item, {
        originalPath: nextOriginalPath,
      }));
    }
    WS.meta.trashItemsByPath = nextTrashItemsByPath;
    if (trashChanged) metaMarkDirty(META_DOC_IDS.trash);
  }
  if (Array.isArray(WS.meta.scoreHistory) && WS.meta.scoreHistory.length) {
    WS.meta.scoreHistory = normalizeScoreHistoryList(
      WS.meta.scoreHistory.map((entry) => {
        if (!entry || typeof entry !== "object") return entry;
        const selectedRaw = Array.isArray(entry.selectedPaths)
          ? entry.selectedPaths
          : [];
        const changedRaw = Array.isArray(entry.changed) ? entry.changed : [];
        const selectedPaths = selectedRaw.map((p) =>
          remapPathPrefix(oldPrefix, newPrefix, p),
        );
        const changed = changedRaw.map((it) => {
          if (!it || typeof it !== "object") return it;
          return Object.assign({}, it, {
            path: remapPathPrefix(oldPrefix, newPrefix, it.path),
          });
        });
        return Object.assign({}, entry, { selectedPaths, changed });
      }),
    );
  }
  // Every document re-keyed above is saved, here rather than at the callers.
  // The Trash and Put Back each listed their own and left out the thumbnails,
  // so a folder put back had its thumbnail picks re-keyed in memory but never
  // written: the next launch read them back filed under the Trash, and the
  // folder came up with none (metaReclaimStrandedTrashMetadata recovers those).
  metaTrackDirtyDocIds([
    META_DOC_IDS.scores,
    META_DOC_IDS.scoreHistory,
    META_DOC_IDS.tags,
    META_DOC_IDS.tagAlbums,
    META_DOC_IDS.thumbnails,
    META_DOC_IDS.aspectRatios,
    META_DOC_IDS.appearanceAssignments,
    META_DOC_IDS.prefGeneral,
  ]);
}

function applyRenameInMemory(dirNode, newName) {
  const oldPath = String(dirNode?.path || "");
  const oldName = String(dirNode?.name || "");
  const parentPath = String(dirNode?.parent?.path || "");
  const newPath = parentPath ? parentPath + "/" + newName : newName;

  dirNode.name = newName;

  (function walk(node) {
    node.path = remapPathPrefix(oldPath, newPath, node.path || "");
    for (const d of node.childrenDirs) walk(d);
  })(dirNode);

  WS.dirByPath = remapPathMapKeys(WS.dirByPath, oldPath, newPath);
  updateMetaPathsForRename(oldPath, newPath);
  updateViewStatePathsForRename(oldPath, newPath);
  remapAltGroupAfterCanonicalRename(
    dirNode,
    oldPath,
    newPath,
    oldName,
    newName,
  );
  invalidateDirHandleCache(oldPath);
  invalidateDirMetricsCaches();
  return { oldPath, newPath };
}

function applyDirectoryMoveInMemory(dirNode, newParentNode, newName) {
  if (!dirNode) return { oldPath: "", newPath: "" };
  const oldPath = String(dirNode.path || "");
  const oldParent = dirNode.parent || null;
  const parentNode = newParentNode || null;
  const parentPath = String(parentNode?.path || "");
  const nextName = String(newName || dirNode.name || "");
  const newPath = parentPath ? `${parentPath}/${nextName}` : nextName;

  if (oldParent && Array.isArray(oldParent.childrenDirs)) {
    oldParent.childrenDirs = oldParent.childrenDirs.filter((child) => child !== dirNode);
  }
  dirNode.parent = parentNode;
  dirNode.name = nextName;
  if (parentNode && Array.isArray(parentNode.childrenDirs)) {
    if (!parentNode.childrenDirs.includes(dirNode)) parentNode.childrenDirs.push(dirNode);
  }

  (function walk(node) {
    node.path = remapPathPrefix(oldPath, newPath, node.path || "");
    for (const d of node.childrenDirs) walk(d);
  })(dirNode);

  WS.dirByPath = remapPathMapKeys(WS.dirByPath, oldPath, newPath);
  updateMetaPathsForRename(oldPath, newPath);
  updateViewStatePathsForRename(oldPath, newPath);
  updateFileRecordsForRename(oldPath, newPath);
  invalidateDirHandleCache(oldPath);
  invalidateDirHandleCache(newPath);
  invalidateDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
  return { oldPath, newPath };
}

function remapFileSelectionIds(idMap) {
  // In place: the live set is an alias into bulkFileSelectionsByDir, and
  // replacing it would leave the map holding the stale pre-move ids.
  const set = WS.view.bulkFileSelectedIds;
  if (!set || !set.size) return;
  const remapped = Array.from(set, (id) => idMap.get(id) || id);
  set.clear();
  for (const id of remapped) set.add(id);
}

function remapIdValue(idMap, value) {
  const key = String(value || "");
  if (!key) return "";
  return idMap.get(key) || key;
}

function remapFileIdsInDirTree(idMap) {
  for (const node of WS.dirByPath.values()) {
    if (!node || !node.childrenFiles) continue;
    for (let i = 0; i < node.childrenFiles.length; i++) {
      const oldId = String(node.childrenFiles[i] || "");
      if (idMap.has(oldId)) node.childrenFiles[i] = idMap.get(oldId);
    }
  }
}

function remapRuntimeFileStateIds(idMap) {
  if (!idMap || !idMap.size) return;
  WS.view.fileActionMenuId = remapIdValue(idMap, WS.view.fileActionMenuId);
  DIR_FILE_DRAG.id = remapIdValue(idMap, DIR_FILE_DRAG.id);
  PREVIEW_DRAG_STATE.draggedId = remapIdValue(
    idMap,
    PREVIEW_DRAG_STATE.draggedId,
  );
  if (Array.isArray(PREVIEW_DRAG_STATE.visibleIds)) {
    PREVIEW_DRAG_STATE.visibleIds = PREVIEW_DRAG_STATE.visibleIds
      .map((id) => remapIdValue(idMap, id))
      .filter(Boolean);
  }
  PREVIEW_VIDEO_PAUSE.fileId = remapIdValue(idMap, PREVIEW_VIDEO_PAUSE.fileId);
  PREVIEW_VIDEO_USER_PAUSE_FILE_ID = remapIdValue(
    idMap,
    PREVIEW_VIDEO_USER_PAUSE_FILE_ID,
  );
  VIDEO_CARRY.fileId = remapIdValue(idMap, VIDEO_CARRY.fileId);
}

function remapFileIdsAcrossViewState(idMap) {
  if (!idMap || !idMap.size) return;
  remapFileIdsInDirTree(idMap);
  remapFileSelectionIds(idMap);
  remapRuntimeFileStateIds(idMap);
  remapSessionFileOrders(idMap);
  remapThumbnailUrlRecordIds(idMap);
  if (WS.preview.kind === "file" && WS.preview.fileId) {
    WS.preview.fileId = remapIdValue(idMap, WS.preview.fileId);
  }
  for (const entry of WS.nav.entries || []) {
    if (entry && entry.kind === "file" && idMap.has(String(entry.id || ""))) {
      entry.id = idMap.get(String(entry.id || ""));
    }
  }
  for (const it of viewerItems || []) {
    if (it && !it.isFolder && idMap.has(String(it.id || "")))
      it.id = idMap.get(String(it.id || ""));
  }
}

async function refreshRenamedRecordFileFromDisk(rec, dirHandleOverride = null) {
  if (!rec || !WS.meta.fsRootHandle) return false;
  const fileName = String(rec.name || "");
  if (!fileName) return false;

  let dirHandle = dirHandleOverride || null;
  if (!dirHandle) {
    try {
      dirHandle = await getDirectoryHandleForPath(
        WS.meta.fsRootHandle,
        String(rec.dirPath || ""),
      );
    } catch {}
  }
  if (!dirHandle) return false;

  let fileHandle = null;
  try {
    fileHandle = await dirHandle.getFileHandle(fileName);
  } catch {}
  if (!fileHandle) return false;

  let freshFile = null;
  try {
    freshFile = await fileHandle.getFile();
  } catch {}
  if (!freshFile) return false;

  try {
    if (rec.url) URL.revokeObjectURL(rec.url);
  } catch {}
  try {
    if (rec.thumbUrl) URL.revokeObjectURL(rec.thumbUrl);
  } catch {}
  try {
    if (rec.videoThumbUrl) URL.revokeObjectURL(rec.videoThumbUrl);
  } catch {}
  rec.url = null;
  rec.thumbUrl = null;
  rec.videoThumbUrl = null;
  rec.thumbMode = null;
  rec.videoThumbMode = null;
  trackThumbnailUrlForRecord(rec);

  rec.file = freshFile;
  rec.size = Number.isFinite(freshFile.size) ? freshFile.size : rec.size;
  rec.lastModified = Number.isFinite(freshFile.lastModified)
    ? freshFile.lastModified
    : rec.lastModified;
  return true;
}

function updateFileRecordsForRename(oldPrefix, newPrefix) {
  const idMap = new Map();
  const nextFileById = new Map();
  for (const [id, rec] of WS.fileById.entries()) {
    const oldDirPath = String(rec.dirPath || "");
    const oldRelPath = String(rec.relPath || "");
    const nextDirPath = remapPathPrefix(oldPrefix, newPrefix, oldDirPath);
    const nextRelPath = remapPathPrefix(oldPrefix, newPrefix, oldRelPath);
    const nextId =
      nextRelPath !== oldRelPath ? fileKeyForRecord(rec, nextRelPath) : id;
    rec.dirPath = nextDirPath;
    rec.relPath = nextRelPath;
    if (rec._altSourceDirPath != null) {
      rec._altSourceDirPath = remapPathPrefix(
        oldPrefix,
        newPrefix,
        rec._altSourceDirPath,
      );
    }
    rec.id = nextId;
    if (nextId !== id) idMap.set(id, nextId);
    nextFileById.set(nextId, rec);
  }
  WS.fileById = nextFileById;
  remapFileIdsAcrossViewState(idMap);
  WS.view.randomFolderCache = remapPathMapKeys(
    WS.view.randomFolderCache,
    oldPrefix,
    newPrefix,
  );
}

async function updateFileRecordsForFileRenames(
  dirNode,
  renameMap,
  dirHandleForRefresh = null,
) {
  if (!dirNode || !renameMap || !renameMap.size) return;
  const dirPath = String(dirNode.path || "");
  const idMap = new Map();
  const relPathMap = new Map();
  const nextFileById = new Map();

  for (const [id, rec] of WS.fileById.entries()) {
    if (String(rec.dirPath || "") !== dirPath) {
      nextFileById.set(id, rec);
      continue;
    }
    const oldName = String(rec.name || "");
    if (!renameMap.has(oldName)) {
      nextFileById.set(id, rec);
      continue;
    }
    const newName = renameMap.get(oldName);
    const extDot = newName.lastIndexOf(".");
    const ext = extDot >= 0 ? newName.slice(extDot).toLowerCase() : "";
    const relPath = dirPath ? dirPath + "/" + newName : newName;
    const oldRelPath = String(rec.relPath || "");
    rec.name = newName;
    rec.ext = ext;
    rec.relPath = relPath;
    rec.type = fileTypeForName(newName) || rec.type;
    await refreshRenamedRecordFileFromDisk(rec, dirHandleForRefresh);
    const nextId = fileKeyForRecord(rec, relPath);
    if (oldRelPath && relPath && oldRelPath !== relPath)
      relPathMap.set(oldRelPath, relPath);
    rec.id = nextId;
    if (nextId !== id) idMap.set(id, nextId);
    nextFileById.set(nextId, rec);
  }

  WS.fileById = nextFileById;
  remapFileIdsAcrossViewState(idMap);
  remapFolderThumbnailPresetValues(relPathMap);
  invalidateDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
}

function canonicalDirNodeForActiveState(dirNode) {
  if (!dirNode) return null;
  if (dirNode._skipTagFilters || String(dirNode._tagPreviewMode || "")) {
    return dirNode;
  }
  const path = String(dirNode.path || "");
  if (!path) return WS.root || dirNode;
  return (WS.dirByPath && WS.dirByPath.get(path)) || dirNode;
}

function canonicalizeActiveDirectoryReferences() {
  if (!WS || !WS.nav || !WS.preview) return false;
  let changed = false;
  const nextNavDir = canonicalDirNodeForActiveState(WS.nav.dirNode);
  if (nextNavDir && nextNavDir !== WS.nav.dirNode) {
    WS.nav.dirNode = nextNavDir;
    changed = true;
  }
  if (WS.preview.dirNode) {
    const nextPreviewDir = canonicalDirNodeForActiveState(WS.preview.dirNode);
    if (nextPreviewDir && nextPreviewDir !== WS.preview.dirNode) {
      WS.preview.dirNode = nextPreviewDir;
      changed = true;
    }
  }
  if (viewerDirNode) {
    const nextViewerDir = canonicalDirNodeForActiveState(viewerDirNode);
    if (nextViewerDir && nextViewerDir !== viewerDirNode) {
      viewerDirNode = nextViewerDir;
      changed = true;
    }
  }
  return changed;
}

function refreshCurrentViewAfterCatalogMutation(opts = null) {
  // Empty system portals disappear from the root, so leave either one before
  // rendering instead of letting selection recovery enter a neighboring folder.
  navigateOutOfTrashIfHidden();
  navigateOutOfStorageIfHidden();
  canonicalizeActiveDirectoryReferences();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  canonicalizeActiveDirectoryReferences();
  // Preserve the preview location across the mutation whenever what it shows
  // still exists (e.g. trashing/moving some *other* folder must not teleport
  // you). Only when the previewed target is gone do we re-derive from the
  // selection. This used to require callers to opt in via preservePreviewTarget
  // and otherwise force-snapped the preview to the selection.
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  canonicalizeActiveDirectoryReferences();
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function previewFolderGridRenderableStats(dirNode) {
  const canonical = canonicalDirNodeForActiveState(dirNode);
  if (!previewBodyEl || !canonical || WS.preview.kind !== "dir") {
    return { expected: 0, rendered: 0, hasLabel: false };
  }
  const entries = getPreviewFolderAndFileEntries(canonical, {
    includeFiles: true,
    useCurrentViewEntries: true,
  });
  const folderCount = Array.isArray(entries.folderEntries)
    ? entries.folderEntries.length
    : 0;
  const validFileIds = (Array.isArray(entries.fileIds) ? entries.fileIds : [])
    .map((id) => String(id || ""))
    .filter((id) => !!id && WS.fileById.has(id));
  return {
    expected: folderCount + validFileIds.length,
    rendered: previewBodyEl.querySelectorAll(
      ".gridFiles .fileCard, .gridFolders .folderCard, .previewTagFolderCard",
    ).length,
    hasLabel: !!previewBodyEl.querySelector(".label"),
  };
}

function previewFolderGridNeedsRepair(dirNode) {
  if (!previewBodyEl || WS.preview.kind !== "dir") return false;
  const stats = previewFolderGridRenderableStats(dirNode);
  if (stats.expected > 0) return stats.rendered <= 0;
  return stats.rendered <= 0 && !stats.hasLabel;
}

function schedulePreviewFolderGridRepairAfterMutation(dirNode, attempts = 1) {
  if (!dirNode || attempts <= 0) return;
  const targetPath = String(dirNode.path || "");
  // One rAF repair only — the old 80ms second pass re-built the grid on every
  // open/close even when the first paint was fine.
  requestAnimationFrame(() => {
    canonicalizeActiveDirectoryReferences();
    if (WS.preview.kind !== "dir") return;
    const currentPath = String(WS.preview.dirNode?.path || "");
    if (currentPath !== targetPath) return;
    if (!previewFolderGridNeedsRepair(WS.preview.dirNode)) return;
    renderPreviewPane(false, true);
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  });
}

function schedulePreviewFolderGridRepairForCurrentTarget(attempts = 2) {
  if (!WS || !WS.preview || WS.preview.kind !== "dir" || !WS.preview.dirNode)
    return;
  schedulePreviewFolderGridRepairAfterMutation(WS.preview.dirNode, attempts);
}

function forceRefreshPreviewFolderGridAfterFileRenames(dirNode) {
  const targetPath = String(dirNode?.path || "");
  if (!targetPath && dirNode !== WS.root) return;
  const refresh = (keepScroll) => {
    canonicalizeActiveDirectoryReferences();
    const target =
      (WS.dirByPath && WS.dirByPath.get(targetPath)) ||
      (targetPath ? null : WS.root) ||
      dirNode;
    if (!target) return false;
    applySessionFileOrderForDir(target);
    if (
      WS.preview.kind === "dir" &&
      String(WS.preview.dirNode?.path || "") === targetPath
    ) {
      WS.preview.dirNode = target;
    }
    if (WS.nav.dirNode && String(WS.nav.dirNode.path || "") === targetPath) {
      WS.nav.dirNode = target;
    }
    rebuildDirectoriesEntries();
    WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
    if (
      WS.preview.kind !== "dir" ||
      String(WS.preview.dirNode?.path || "") !== targetPath
    ) {
      applyPreviewState({ kind: "dir", dirNode: target, fileId: null });
    }
    resetPreviewGridRenderRecovery();
    if (previewBodyEl) { releaseContainerThumbMedia(previewBodyEl); previewBodyEl.innerHTML = ""; }
    renderDirectoriesPane(true);
    renderPreviewPane(false, !!keepScroll);
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
    scheduleThumbnailDemandRefresh();
    return true;
  };
  requestAnimationFrame(() => {
    if (!refresh(false)) return;
    setTimeout(() => {
      refresh(true);
      schedulePreviewFolderGridRepairAfterMutation(
        (WS.dirByPath && WS.dirByPath.get(targetPath)) || dirNode,
        2,
      );
    }, 80);
  });
}

async function renameFolderDirNode(dirNode, nextName) {
  if (!dirNode) return false;
  if (!dirNode.parent) {
    showStatusMessage("Root folder cannot be renamed.");
    return false;
  }
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Rename requires a writable folder.");
    return false;
  }

  const clean = normalizeFolderNameInput(nextName);
  if (!isValidFolderName(clean)) {
    showStatusMessage("Invalid folder name.");
    return false;
  }
  if (clean === String(dirNode.name || "")) return true;

  const lower = clean.toLowerCase();
  for (const d of dirNode.parent.childrenDirs || []) {
    if (d !== dirNode && String(d.name || "").toLowerCase() === lower) {
      showStatusMessage("A folder with that name already exists.");
      return false;
    }
  }

  const oldPath = String(dirNode.path || "");
  const altDiskRenames = altSourceDiskPathsForNode(dirNode);
  const state = snapshotRefreshState();
  showBusyOverlay("Renaming folder...");
  try {
    await renameDirectoryOnDisk(oldPath, clean);
    for (let i = 0; i < altDiskRenames.length; i++) {
      const alt = altDiskRenames[i];
      try {
        await renameDirectoryOnDisk(
          alt.path,
          formatAltFolderName(clean, alt.label),
        );
      } catch {}
    }
    const { oldPath: prevPath, newPath } = applyRenameInMemory(dirNode, clean);
    updateFileRecordsForRename(prevPath, newPath);
    metaComputeFingerprints();
    metaTrackDirtyDocIds([
      META_DOC_IDS.scores,
      META_DOC_IDS.tags,
          META_DOC_IDS.appearanceAssignments,
    ]);

    try {
      if (WS.meta.storageMode === "fs") await metaSaveFsNow();
      else metaSaveLocalNow();
    } catch {}
    const entryKey = state?.entryKey || null;
    if (entryKey && entryKey.kind === "dir") {
      entryKey.path = remapPathPrefix(prevPath, newPath, entryKey.path);
    } else if (entryKey && entryKey.kind === "file") {
      entryKey.relPath = remapPathPrefix(prevPath, newPath, entryKey.relPath);
    }
    rebuildDirectoriesEntries();
    const idx = restoreRefreshSelection(entryKey);
    WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
    // A rename is not a move: stay where you are (the path remap has already
    // re-pointed a renamed location), only re-deriving if it is gone.
    preserveActivePreviewTargetDuringDirectoriesRefresh();
    renderDirectoriesPane(true);
    renderPreviewPane(true, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();

    showStatusMessage("Rename complete.");
    return true;
  } catch {
    showStatusMessage("Rename failed.");
    return false;
  } finally {
    hideBusyOverlay();
  }
}

if (refreshBtn)
  refreshBtn.addEventListener("click", async () => {
    try {
      await refreshWorkspaceFromRootHandle();
    } catch {}
  });

async function chooseRootDirectoryFromMenu() {
  // In the managed single-folder model, "Choose Root" now reveals the app's
  // Local Gallery media folder in Finder/Explorer.
  try {
    const api = window.__lg || {};
    let mediaPath = "";
    if (typeof api.getMediaRoot === "function") {
      mediaPath = await api.getMediaRoot();
    } else if (window.__lg && window.__lg.rootPath) {
      mediaPath = window.__lg.rootPath;
    }
    if (mediaPath) {
      // Use native reveal
      const revealFn = (api && api.revealPath) || (window.__lg && window.__lg.revealPath);
      if (typeof revealFn === "function") {
        try { await revealFn(mediaPath); return; } catch (e) { console.warn(e); }
      }
      // Fallback: at least show the path
      showStatusMessage("Media folder: " + mediaPath);
      return;
    }
    // Last resort: still allow the old picker
    if (window.showDirectoryPicker) {
      const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      if (rootHandle) await buildWorkspaceFromDirectoryHandle(rootHandle);
      return;
    }
    if (openWritableInput) {
      openWritableInput.value = "";
      openWritableInput.click();
      return;
    }
    showStatusMessage("Media folder location unavailable.");
  } catch (err) {
    console.error("Reveal media folder failed.", err);
    showStatusMessage("Could not reveal media folder.");
  }
}

[openWritableBtn, keybindsOpenWritableBtn, calendarOpenWritableBtn]
  .filter(Boolean)
  .forEach((btn) => {
    btn.addEventListener("click", chooseRootDirectoryFromMenu);
  });

// The folder input is the last-resort picker.
if (openWritableInput) {
  openWritableInput.addEventListener("change", async () => {
    const files = openWritableInput.files;
    if (!files || !files.length) return;
    try {
      await buildWorkspaceFromFileList(files);
    } catch (err) {
      console.error("Load folder from file list failed.", err);
      showStatusMessage("Load folder failed.");
    } finally {
      openWritableInput.value = "";
    }
  });
}
