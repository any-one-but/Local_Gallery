/* Indexing
   Renaming files to `<folder>_<NN>` in the current order (Index). */

/* =========================================================
       List Pane
       - lists folders + files for WS.nav.dirNode
       - selection drives Preview Pane
       ========================================================= */

function isDirHidden(dirNode) {
  if (!dirNode) return false;
  return metaHasHidden(dirNode.path || "");
}

function isDirOrAncestorHidden(dirNode) {
  const visitedPaths = new Set();
  let cur = dirNode;
  while (cur) {
    const path = normalizeDirPathValue(cur.path || "");
    if (path) visitedPaths.add(path);
    if (metaHasHidden(path)) return true;
    cur = cur.parent;
  }
  const path = normalizeDirPathValue(dirNode && dirNode.path);
  const parts = path.split("/").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    const ancestorPath = parts.slice(0, i).join("/");
    if (!visitedPaths.has(ancestorPath) && metaHasHidden(ancestorPath))
      return true;
  }
  return false;
}

async function renameSingleFile(rec, nextName) {
  if (!rec) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Renaming files requires a writable folder.");
    return false;
  }

  const clean = String(nextName || "").trim();
  if (!isValidFileName(clean)) {
    showStatusMessage("Invalid file name.");
    return false;
  }
  if (clean === String(rec.name || "")) return true;

  const dirPath = String(rec.dirPath || "");
  let dirHandle = null;
  try {
    dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);
  } catch {}
  if (!dirHandle) {
    showStatusMessage("Rename failed.");
    return false;
  }
  let existing = false;
  try {
    await dirHandle.getFileHandle(clean);
    existing = true;
  } catch {}
  if (existing) {
    showStatusMessage("A file with that name already exists.");
    return false;
  }

  showBusyOverlay("Renaming file...");
  try {
    const fileHandle = await dirHandle.getFileHandle(String(rec.name || ""));
    const ok = await renameFileOnDisk(
      dirHandle,
      fileHandle,
      String(rec.name || ""),
      clean,
    );
    if (!ok) {
      showStatusMessage("Rename failed.");
      return false;
    }

    const dirNode = WS.dirByPath.get(dirPath) || null;
    if (dirNode) {
      const renameMap = new Map([[String(rec.name || ""), clean]]);
      await updateFileRecordsForFileRenames(dirNode, renameMap, dirHandle);
    }

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
    refreshCurrentViewAfterCatalogMutation();

    showStatusMessage("Rename complete.");
    return true;
  } catch {
    showStatusMessage("Rename failed.");
    return false;
  } finally {
    hideBusyOverlay();
  }
}

function getIndexOrderedFileIdsForDir(dirNode) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return [];
  applySessionFileOrderForDir(dirNode);
  const ids = dirNode.childrenFiles
    .map((id) => String(id || ""))
    .filter((id) => !!id && WS.fileById.has(id));
  if (dirNode.preserveOrder) return ids;
  return ids.sort((a, b) =>
    compareIndexedNames(
      WS.fileById.get(a)?.name || "",
      WS.fileById.get(b)?.name || "",
    ),
  );
}

function getLivePreviewGridFileOrderForDir(dirNode) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !previewBodyEl) return [];
  const target = getPreviewTargetDir();
  if (!target || String(target.path || "") !== String(dirNode.path || ""))
    return [];
  const candidates = Array.from(
    previewBodyEl.querySelectorAll(".gridFiles .fileCard[data-file-id]"),
  ).filter(
    (card) =>
      card &&
      !card.classList.contains("drag-placeholder") &&
      !card.classList.contains("drag-hidden"),
  );
  const measured = candidates.map((card, index) => {
    const rect =
      card && typeof card.getBoundingClientRect === "function"
        ? card.getBoundingClientRect()
        : null;
    return {
      card,
      index,
      top: rect ? Number(rect.top) || 0 : 0,
      left: rect ? Number(rect.left) || 0 : 0,
      height: rect ? Math.max(1, Number(rect.height) || 1) : 1,
    };
  });
  measured.sort((a, b) => {
    const rowTolerance = Math.max(4, Math.min(a.height, b.height) * 0.5);
    const topDelta = a.top - b.top;
    if (Math.abs(topDelta) > rowTolerance) return topDelta;
    const leftDelta = a.left - b.left;
    if (Math.abs(leftDelta) > 1) return leftDelta;
    return a.index - b.index;
  });
  const out = [];
  const seen = new Set();
  for (let i = 0; i < measured.length; i++) {
    const id = previewFileIdForCard(measured[i].card);
    if (!id || seen.has(id) || !WS.fileById.has(id)) continue;
    const rec = WS.fileById.get(id);
    if (String(rec?.dirPath || "") !== String(dirNode.path || "")) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function captureLivePreviewFileOrderForIndex(dirNode) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
  const liveIds = getLivePreviewGridFileOrderForDir(dirNode);
  if (!liveIds.length) return false;
  const liveSet = new Set(liveIds);
  const current = dirNode.childrenFiles
    .map((id) => String(id || ""))
    .filter((id) => !!id && WS.fileById.has(id));
  const next = liveIds.slice();
  for (let i = 0; i < current.length; i++) {
    const id = current[i];
    if (!liveSet.has(id)) next.push(id);
  }
  dirNode.childrenFiles = next;
  dirNode.preserveOrder = true;
  saveSessionFileOrderForDir(dirNode, next);
  return true;
}

function collectIndexableDirs(rootNode) {
  const out = [];
  const walk = (node) => {
    if (!node || isStorageStubDirNode(node) || isInternalTrashDirNode(node))
      return;
    out.push(node);
    const children = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
    for (let i = 0; i < children.length; i++) walk(children[i]);
  };
  walk(rootNode);
  return out;
}

function indexedFileNameForRecord(dirNode, rec, index, width) {
  const parentName = String(dirNode?.name || "Folder").trim() || "Folder";
  const oldName = String(rec?.name || "");
  const ext = splitNameExtension(oldName).ext || "";
  return `${parentName}_${String(Math.max(1, index)).padStart(width, "0")}${ext}`;
}

async function uniqueIndexTempName(dirHandle, reservedNames, serial) {
  const reserved = reservedNames instanceof Set ? reservedNames : new Set();
  let attempt = 0;
  while (attempt < 10000) {
    const candidate = `__local_gallery_index_tmp_${Date.now()}_${serial}_${attempt}.tmp`;
    const key = candidate.toLowerCase();
    if (!reserved.has(key) && !(await entryExistsInDir(dirHandle, candidate))) {
      reserved.add(key);
      return candidate;
    }
    attempt++;
  }
  return "";
}

async function buildIndexRenamePlanForDir(dirNode, dirHandle, serialBase = 0) {
  const ids = getIndexOrderedFileIdsForDir(dirNode);
  if (!ids.length) return { ops: [], skipped: 0 };
  const width = String(Math.max(1, ids.length)).length + 1;
  const oldNameKeys = new Set();
  const desiredNameKeys = new Set();
  const records = [];
  for (let i = 0; i < ids.length; i++) {
    const rec = WS.fileById.get(ids[i]);
    if (!rec) continue;
    records.push(rec);
    oldNameKeys.add(String(rec.name || "").toLowerCase());
  }

  const planned = [];
  let needsRename = false;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const oldName = String(rec.name || "");
    const newName = indexedFileNameForRecord(dirNode, rec, i + 1, width);
    const newKey = newName.toLowerCase();
    if (!isValidFileName(newName) || desiredNameKeys.has(newKey)) {
      return { ops: [], skipped: records.length };
    }
    desiredNameKeys.add(newKey);
    if (!oldNameKeys.has(newKey) && (await entryExistsInDir(dirHandle, newName))) {
      return { ops: [], skipped: records.length };
    }
    if (newName !== oldName) needsRename = true;
    planned.push({ rec, oldName, newName, tempName: "" });
  }
  if (!needsRename) return { ops: [], skipped: 0 };

  const reserved = new Set([...oldNameKeys, ...desiredNameKeys]);
  let skipped = 0;
  for (let i = 0; i < planned.length; i++) {
    planned[i].tempName = await uniqueIndexTempName(
      dirHandle,
      reserved,
      serialBase + i,
    );
    if (!planned[i].tempName) skipped++;
  }
  if (skipped) return { ops: [], skipped: records.length };

  return {
    ops: planned.filter((op) => op.tempName),
    skipped,
  };
}

function catalogDescriptorFromFileRecord(rec) {
  if (!rec) return null;
  return normalizeCatalogFileDescriptor({
    id: rec.id,
    relPath: rec.relPath,
    name: rec.name,
    dirPath: rec.dirPath,
    ext: rec.ext,
    type: rec.type,
    size: rec.size,
    lastModified: rec.lastModified,
    aspectRatio: rec.aspectRatio,
    aspectRatioBucket: rec.aspectRatioBucket,
  });
}

async function syncCatalogFolderAfterIndex(dirNode) {
  if (!WS.catalog || !WS.catalog.enabled || !dirNode) return false;
  const childPaths = (Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [])
    .map((child) => normalizeDirPathValue(child?.path || ""))
    .filter(Boolean);
  const files = (Array.isArray(dirNode.childrenFiles) ? dirNode.childrenFiles : [])
    .map((id) => catalogDescriptorFromFileRecord(WS.fileById.get(String(id || ""))))
    .filter(Boolean);
  const ok = await commitCatalogFolderDirectEntries(
    String(dirNode.path || ""),
    childPaths,
    files,
  );
  if (ok) {
    dirNode.preserveOrder = true;
    saveSessionFileOrderForDir(dirNode);
  }
  return ok;
}

async function applyIndexRenamePlanForDir(dirNode, dirHandle, ops) {
  const list = Array.isArray(ops) ? ops : [];
  if (!dirNode || !dirHandle || !list.length)
    return { renamed: 0, failed: 0, renameMap: new Map() };

  const staged = [];
  let failed = 0;
  for (let i = 0; i < list.length; i++) {
    const op = list[i];
    let ok = false;
    try {
      const fileHandle = await dirHandle.getFileHandle(op.oldName);
      ok = await renameFileOnDisk(
        dirHandle,
        fileHandle,
        op.oldName,
        op.tempName,
      );
    } catch {}
    if (ok) staged.push(op);
    else failed++;
  }
  if (staged.length !== list.length) {
    for (let i = 0; i < staged.length; i++) {
      const op = staged[i];
      try {
        const fileHandle = await dirHandle.getFileHandle(op.tempName);
        await renameFileOnDisk(dirHandle, fileHandle, op.tempName, op.oldName);
      } catch {}
    }
    return {
      renamed: 0,
      failed: failed + Math.max(0, list.length - staged.length),
      renameMap: new Map(),
    };
  }

  const renameMap = new Map();
  let renamed = 0;
  const finalized = [];
  for (let i = 0; i < staged.length; i++) {
    const op = staged[i];
    let ok = false;
    try {
      const fileHandle = await dirHandle.getFileHandle(op.tempName);
      ok = await renameFileOnDisk(
        dirHandle,
        fileHandle,
        op.tempName,
        op.newName,
      );
    } catch {}
    if (!ok) {
      failed++;
      break;
    }
    finalized.push(op);
    if (op.newName !== op.oldName) renamed++;
    renameMap.set(op.oldName, op.newName);
  }

  if (failed) {
    const finalizedSet = new Set(finalized);
    for (let i = finalized.length - 1; i >= 0; i--) {
      const op = finalized[i];
      if (op.newName === op.oldName) continue;
      try {
        const fileHandle = await dirHandle.getFileHandle(op.newName);
        await renameFileOnDisk(dirHandle, fileHandle, op.newName, op.oldName);
      } catch {}
    }
    for (let i = 0; i < staged.length; i++) {
      const op = staged[i];
      if (finalizedSet.has(op)) continue;
      try {
        const fileHandle = await dirHandle.getFileHandle(op.tempName);
        await renameFileOnDisk(dirHandle, fileHandle, op.tempName, op.oldName);
      } catch {}
    }
    return { renamed: 0, failed, renameMap: new Map() };
  }

  if (renameMap.size) {
    await updateFileRecordsForFileRenames(dirNode, renameMap, dirHandle);
    if (!failed) {
      dirNode.childrenFiles = list
        .map((op) => String(op.rec?.id || ""))
        .filter((id) => !!id && WS.fileById.has(id));
      await syncCatalogFolderAfterIndex(dirNode);
      // The new names now carry the order, so there is no hand-made order
      // left to keep or to reset: name order is this order from here on.
      dirNode.preserveOrder = false;
      clearSessionFileOrderForDir(dirNode);
    }
  }
  return { renamed, failed, renameMap };
}

async function indexFolderFilesRecursively(dirNode) {
  if (RENAME_BUSY) return false;
  if (!dirNode) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Index requires a writable folder.");
    return false;
  }
  if (isStorageStubDirNode(dirNode)) {
    showStatusMessage("Storage folders cannot be indexed.");
    return false;
  }

  const dirs = collectIndexableDirs(dirNode);
  if (!dirs.length) {
    showStatusMessage("No folders to index.");
    return false;
  }

  RENAME_BUSY = true;
  let renamed = 0;
  let failed = 0;
  let skipped = 0;
  let planned = 0;
  try {
    showBusyOverlay("Indexing files...");
    for (let i = 0; i < dirs.length; i++) {
      const node = dirs[i];
      captureLivePreviewFileOrderForIndex(node);
      const label = displayPath(node.path || "") || node.name || "folder";
      showBusyOverlay(
        `Indexing files... ${i + 1}/${dirs.length} • Renamed ${renamed}`,
        label,
      );
      let dirHandle = null;
      try {
        dirHandle = await getDirectoryHandleForPath(
          WS.meta.fsRootHandle,
          String(node.path || ""),
        );
      } catch {}
      if (!dirHandle) {
        failed++;
        continue;
      }
      const plan = await buildIndexRenamePlanForDir(node, dirHandle, i * 10000);
      skipped += Number(plan.skipped) || 0;
      planned += plan.ops.length;
      if (!plan.ops.length) continue;
      const result = await applyIndexRenamePlanForDir(node, dirHandle, plan.ops);
      renamed += Number(result.renamed) || 0;
      failed += Number(result.failed) || 0;
      await waitForNextPaint();
    }

    if (!planned && !renamed) {
      showStatusMessage(
        skipped
          ? `Index skipped ${skipped} file${skipped === 1 ? "" : "s"}.`
          : "Files are already indexed.",
      );
      return false;
    }

    metaComputeFingerprints();
    metaTrackDirtyDocIds([
      META_DOC_IDS.thumbnails,
      META_DOC_IDS.appearanceAssignments,
    ]);
    try {
      if (WS.meta.storageMode === "fs") await metaSaveFsNow();
      else metaSaveLocalNow();
    } catch {}
    const previewWasFolderGrid = WS.preview.kind === "dir";
    const previewTargetAfterIndex = getPreviewTargetDir();
    refreshCurrentViewAfterCatalogMutation({ preservePreviewTarget: true });
    if (previewWasFolderGrid) {
      forceRefreshPreviewFolderGridAfterFileRenames(previewTargetAfterIndex);
    }
    showStatusMessage(
      `Index complete: ${renamed} renamed, ${skipped} skipped, ${failed} failed.`,
    );
    return renamed > 0;
  } catch (err) {
    console.error("Index failed.", err);
    showStatusMessage("Index failed.");
    return false;
  } finally {
    RENAME_BUSY = false;
    hideBusyOverlay();
  }
}
