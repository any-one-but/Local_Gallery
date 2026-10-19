/* Folder operations
   Scrub, set merges, moving to the Trash, putting back and deleting. */

function notifyScrubMissingTools(missingTools) {
  const list = Array.from(
    new Set(
      (missingTools || []).map((v) => String(v || "").trim()).filter(Boolean),
    ),
  );
  if (!list.length) return;
  if (!notificationsEnabledForSource("scrub")) return;
  const msg = `Scrub completed, but these tools are missing:\n\n${list.map((t) => `- ${t}`).join("\n")}`;
  showStatusMessage(`Scrub missing tools: ${list.join(", ")}`);
  try {
    showAlertDialog(msg);
  } catch {}
}

async function scrubFoldersByPaths(paths, opts = {}) {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Scrub requires a writable folder.");
    return { ok: false, missingTools: [], failed: [], skipped: [] };
  }
  const list = Array.from(
    new Set((paths || []).map((p) => String(p || "")).filter(Boolean)),
  );
  if (!list.length) {
    showStatusMessage("No folders selected.");
    return { ok: false, missingTools: [], failed: [], skipped: [] };
  }
  const electronApi =
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof window.electronAPI.scrubFolder === "function"
      ? window.electronAPI
      : null;
  if (!electronApi) {
    showStatusMessage("Scrub is unavailable.");
    return { ok: false, missingTools: [], failed: [], skipped: [] };
  }

  const missingSet = new Set();
  const failed = [];
  const skipped = [];

  showBusyOverlay(
    list.length > 1 ? "Scrubbing folders..." : "Scrubbing folder...",
  );
  try {
    for (let i = 0; i < list.length; i++) {
      const relPath = list[i];
      const labelPath = displayPath(relPath || "");
      showBusyOverlay(
        `Scrubbing ${i + 1}/${list.length}: ${labelPath || relPath || "folder"}`,
      );
      const absPath = resolveAbsoluteDirectoryPath(relPath);
      if (!absPath) {
        skipped.push(relPath);
        continue;
      }
      let result = null;
      try {
        result = await electronApi.scrubFolder({ path: absPath });
      } catch (err) {
        result = {
          ok: false,
          error: err && err.message ? String(err.message) : "scrub_failed",
          missingTools: [],
        };
      }
      const missing =
        result && Array.isArray(result.missingTools) ? result.missingTools : [];
      for (const tool of missing) {
        const t = String(tool || "").trim();
        if (!t) continue;
        missingSet.add(t);
      }
      if (!result || !result.ok) {
        failed.push({
          path: relPath,
          error: String(result?.error || `exit_${result?.code ?? "unknown"}`),
        });
      }
    }
  } finally {
    hideBusyOverlay();
  }

  if (opts.refresh !== false && WS.meta.fsRootHandle) {
    refreshCurrentViewAfterCatalogMutation();
  }

  const okCount = list.length - failed.length - skipped.length;
  if (failed.length) {
    showStatusMessage(
      `Scrub finished with ${failed.length} error${failed.length === 1 ? "" : "s"}.`,
    );
  } else if (okCount > 0) {
    showStatusMessage(
      `Scrub complete for ${okCount} folder${okCount === 1 ? "" : "s"}.`,
    );
  } else {
    showStatusMessage("Scrub skipped.");
  }

  notifyScrubMissingTools(Array.from(missingSet));
  return {
    ok: failed.length === 0,
    missingTools: Array.from(missingSet),
    failed,
    skipped,
  };
}

function chooseLooseSetFolderNameFromRecords(records) {
  const names = [];
  for (const rec of records || []) {
    const name = String(rec?.name || "").trim();
    if (name) names.push(name);
  }
  if (!names.length) return "New Folder";
  names.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
  let first = names[0] || "New Folder";
  let base = first;
  if (first.includes(".") && !first.startsWith(".")) {
    base = first.slice(0, first.lastIndexOf("."));
  }
  base = normalizeFolderNameInput(base);
  return base || "New Folder";
}

async function entryExistsInDir(dirHandle, name) {
  if (!dirHandle || !name) return false;
  try {
    await dirHandle.getFileHandle(name);
    return true;
  } catch {}
  try {
    await dirHandle.getDirectoryHandle(name);
    return true;
  } catch {}
  return false;
}

function splitNameExtension(name) {
  const raw = String(name || "");
  if (raw.includes(".") && !raw.startsWith(".")) {
    const idx = raw.lastIndexOf(".");
    if (idx > 0) return { base: raw.slice(0, idx), ext: raw.slice(idx) };
  }
  return { base: raw, ext: "" };
}

async function uniqueDestNameInDir(dirHandle, name) {
  const { base, ext } = splitNameExtension(name);
  let candidate = `${base}${ext}`;
  let n = 2;
  while (await entryExistsInDir(dirHandle, candidate)) {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

async function uniqueDirNameInParent(parentHandle, name) {
  let candidate = String(name || "") || "Merged Items";
  let n = 2;
  while (await entryExistsInDir(parentHandle, candidate)) {
    candidate = `${name} (${n})`;
    n += 1;
  }
  return candidate;
}

function normalizeSetMergeFolderBase(name) {
  let base = String(name || "");
  const extIdx = base.lastIndexOf(".");
  if (extIdx > 0 && !base.startsWith(".")) base = base.slice(0, extIdx);
  base = base.replace(/_[0-9]+$/g, "");
  base = normalizeFolderNameInput(base);
  return base || "Merged Items";
}

async function chooseSetMergeOutputName(dirHandles) {
  const names = [];
  for (const handle of dirHandles || []) {
    if (!handle) continue;
    for await (const [name] of handle.entries()) {
      if (!name || name === ".local-gallery") continue;
      names.push(name);
    }
  }
  if (!names.length) return "Merged Items";
  names.sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );
  const first = names[0] || "Merged Items";
  return normalizeSetMergeFolderBase(first);
}

async function moveEntryWithCollisionRename(
  srcDirHandle,
  entryHandle,
  entryName,
  destDirHandle,
  outInfo,
) {
  if (!srcDirHandle || !entryHandle || !destDirHandle) return false;
  const desiredName = await uniqueDestNameInDir(destDirHandle, entryName);
  if (typeof entryHandle.move === "function") {
    try {
      await entryHandle.move(destDirHandle, desiredName);
      if (outInfo && typeof outInfo === "object")
        outInfo.movedName = desiredName;
      return true;
    } catch {}
  }
  if (entryHandle.kind === "file") {
    try {
      const file = await entryHandle.getFile();
      const dstFile = await destDirHandle.getFileHandle(desiredName, {
        create: true,
      });
      const writable = await dstFile.createWritable();
      await writable.write(file);
      await writable.close();
      await srcDirHandle.removeEntry(entryName);
      if (outInfo && typeof outInfo === "object")
        outInfo.movedName = desiredName;
      return true;
    } catch {}
    return false;
  }
  if (entryHandle.kind === "directory") {
    try {
      const dstDir = await destDirHandle.getDirectoryHandle(desiredName, {
        create: true,
      });
      await copyDirectoryHandle(entryHandle, dstDir);
      await srcDirHandle.removeEntry(entryName, { recursive: true });
      if (outInfo && typeof outInfo === "object")
        outInfo.movedName = desiredName;
      return true;
    } catch {}
    return false;
  }
  return false;
}

function collapseNestedFolderPaths(paths) {
  const unique = Array.from(
    new Set((paths || []).map((p) => normalizeWorkspaceRelPath(p)).filter(Boolean)),
  );
  unique.sort((a, b) => {
    const depthA = a.split("/").filter(Boolean).length;
    const depthB = b.split("/").filter(Boolean).length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  const out = [];
  for (let i = 0; i < unique.length; i++) {
    const path = unique[i];
    if (out.some((parent) => path === parent || path.startsWith(parent + "/")))
      continue;
    out.push(path);
  }
  return out;
}

async function moveDirectoryOnDiskToParent(oldPath, destParentPath, newName) {
  const rootHandle = WS.meta.fsRootHandle;
  if (!rootHandle) throw new Error("No writable folder loaded.");
  const parts = String(oldPath || "")
    .split("/")
    .filter(Boolean);
  const oldName = parts.pop() || "";
  const srcParentPath = parts.join("/");
  if (!oldName) throw new Error("Folder path is unavailable.");
  const srcParentHandle = await getDirectoryHandleForPath(rootHandle, srcParentPath);
  const destParentHandle = await getDirectoryHandleForPath(
    rootHandle,
    destParentPath,
  );
  let existing = null;
  try {
    existing = await destParentHandle.getDirectoryHandle(newName);
  } catch {}
  if (existing) throw new Error("Target folder exists.");
  const srcHandle = await srcParentHandle.getDirectoryHandle(oldName);
  if (typeof srcHandle.move === "function") {
    try {
      await srcHandle.move(destParentHandle, newName);
      invalidateDirHandleCache(srcParentPath);
      invalidateDirHandleCache(destParentPath);
      return;
    } catch {}
  }
  const dstHandle = await destParentHandle.getDirectoryHandle(newName, {
    create: true,
  });
  await copyDirectoryHandle(srcHandle, dstHandle);
  await srcParentHandle.removeEntry(oldName, { recursive: true });
  invalidateDirHandleCache(srcParentPath);
  invalidateDirHandleCache(destParentPath);
}

async function persistDirtyMetadataNow() {
  if (WS.meta.storageMode === "fs") await metaSaveFsNow();
  else metaSaveLocalNow();
}

async function moveFolderPathsToTrash(paths) {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Move to trash requires a writable folder.");
    return false;
  }
  const requested = collapseNestedFolderPaths(paths);
  if (requested.some((path) => metaHasStorage(path))) {
    showStatusMessage(
      "Items in Storage must be removed from Storage before they can be moved to Trash.",
    );
    return false;
  }
  const list = requested.filter(
    (path) => isFolderPathMovableToTrash(path),
  );
  if (!list.length) {
    showStatusMessage("No folders available to move to Trash.");
    return false;
  }
  const rootHandle = WS.meta.fsRootHandle;
  let trashHandle = null;
  try {
    trashHandle = await rootHandle.getDirectoryHandle(INTERNAL_TRASH_DIR_NAME, {
      create: true,
    });
  } catch {}
  if (!trashHandle) {
    showStatusMessage("Trash folder is unavailable.");
    return false;
  }
  const failed = [];
  const moved = [];
  showBusyOverlay("Moving folders to Trash...");
  try {
    for (let i = 0; i < list.length; i++) {
      const path = list[i];
      const parts = path.split("/").filter(Boolean);
      const folderName = parts.pop() || "";
      const parentPath = parts.join("/");
      if (!folderName || isInternalTrashDirName(folderName)) {
        failed.push(path);
        continue;
      }
      let parentHandle = null;
      let entryHandle = null;
      try {
        parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
        entryHandle = await parentHandle.getDirectoryHandle(folderName);
      } catch {}
      if (!parentHandle || !entryHandle) {
        failed.push(path);
        continue;
      }
      try {
        const dirNode = WS.dirByPath.get(path) || null;
        const altDisk = altSourceDiskPathsForNode(dirNode);
        for (let a = 0; a < altDisk.length; a++) {
          try {
            const altMovedName = await uniqueDirNameInParent(
              trashHandle,
              altDisk[a].name,
            );
            await moveDirectoryOnDiskToParent(
              altDisk[a].path,
              INTERNAL_TRASH_DIR_NAME,
              altMovedName,
            );
            const altSource =
              dirNode && dirNode.altVariants
                ? dirNode.altVariants[altDisk[a].label]
                : null;
            if (altSource) {
              altSource.sourcePath = `${INTERNAL_TRASH_DIR_NAME}/${altMovedName}`;
              altSource.name = altMovedName;
            }
          } catch {}
        }
        const movedName = await uniqueDirNameInParent(trashHandle, folderName);
        const trashPath = `${INTERNAL_TRASH_DIR_NAME}/${movedName}`;
        await moveDirectoryOnDiskToParent(path, INTERNAL_TRASH_DIR_NAME, movedName);
        const trashRootNode =
          getInternalTrashRootNode() || ensureDirPath(INTERNAL_TRASH_DIR_NAME);
        if (dirNode && trashRootNode) {
          applyDirectoryMoveInMemory(dirNode, trashRootNode, movedName);
        } else {
          updateMetaPathsForRename(path, trashPath);
          updateViewStatePathsForRename(path, trashPath);
          updateFileRecordsForRename(path, trashPath);
        }
        metaTrackDirtyDocIds([
          META_DOC_IDS.scores,
          META_DOC_IDS.scoreHistory,
          META_DOC_IDS.tags,
                  META_DOC_IDS.appearanceAssignments,
          META_DOC_IDS.trash,
        ]);
        metaSetTrashRestoreInfo(trashPath, path);
        moved.push(path);
      } catch {
        failed.push(path);
      }
    }
  } finally {
    hideBusyOverlay();
  }
  if (!moved.length && failed.length) {
    showStatusMessage("Move to trash failed.");
    return false;
  }
  await persistDirtyMetadataNow();
  refreshCurrentViewAfterCatalogMutation();
  if (failed.length) {
    showStatusMessage(
      `Moved ${moved.length} folder${moved.length === 1 ? "" : "s"} to Trash. ${failed.length} failed.`,
    );
  } else {
    showStatusMessage(
      `Moved ${moved.length} folder${moved.length === 1 ? "" : "s"} to Trash.`,
    );
  }
  return moved.length > 0;
}

async function putBackTrashFolderPaths(paths) {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Put Back requires a writable folder.");
    return false;
  }
  const trashTargets = Array.from(
    new Set(
      (paths || [])
        .map((path) => trashTopLevelItemPathForPath(path))
        .filter(Boolean),
    ),
  );
  const list = collapseNestedFolderPaths(trashTargets).filter((path) =>
    isPutBackEligibleTrashPath(path),
  );
  if (!list.length) {
    showStatusMessage("No trashed folders selected.");
    return false;
  }
  const rootHandle = WS.meta.fsRootHandle;
  const failed = [];
  const skipped = [];
  const restored = [];
  showBusyOverlay("Putting folders back...");
  try {
    for (let i = 0; i < list.length; i++) {
      const trashPath = list[i];
      let originalPath = restoreTargetPathForTrashPath(trashPath);
      if (!originalPath) {
        skipped.push(trashPath);
        continue;
      }
      let parts = originalPath.split("/").filter(Boolean);
      let folderName = parts.pop() || "";
      let parentPath = parts.join("/");
      if (!folderName) {
        skipped.push(trashPath);
        continue;
      }
      let parentHandle = null;
      try {
        parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
      } catch {}
      const fallbackPath = fallbackRootRestorePathForTrashPath(trashPath);
      if (!parentHandle && fallbackPath && fallbackPath !== originalPath) {
        originalPath = fallbackPath;
        parts = originalPath.split("/").filter(Boolean);
        folderName = parts.pop() || "";
        parentPath = parts.join("/");
        try {
          parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
        } catch {}
      }
      if (!parentHandle) {
        skipped.push(trashPath);
        continue;
      }
      try {
        if (await entryExistsInDir(parentHandle, folderName)) {
          if (fallbackPath && fallbackPath !== originalPath) {
            const fallbackParts = fallbackPath.split("/").filter(Boolean);
            const fallbackFolderName = fallbackParts.pop() || "";
            const fallbackParentPath = fallbackParts.join("/");
            let fallbackParentHandle = null;
            try {
              fallbackParentHandle = await getDirectoryHandleForPath(
                rootHandle,
                fallbackParentPath,
              );
            } catch {}
            if (
              fallbackFolderName &&
              fallbackParentHandle &&
              !(await entryExistsInDir(fallbackParentHandle, fallbackFolderName))
            ) {
              originalPath = fallbackPath;
              parentPath = fallbackParentPath;
              folderName = fallbackFolderName;
              parentHandle = fallbackParentHandle;
            } else {
              skipped.push(trashPath);
              continue;
            }
          } else {
            skipped.push(trashPath);
            continue;
          }
        }
        await moveDirectoryOnDiskToParent(trashPath, parentPath, folderName);
        const dirNode = WS.dirByPath.get(trashPath) || null;
        const restoreParentNode =
          WS.dirByPath.get(parentPath) || ensureDirPath(parentPath);
        if (dirNode) {
          applyDirectoryMoveInMemory(dirNode, restoreParentNode, folderName);
        } else {
          updateMetaPathsForRename(trashPath, originalPath);
          updateViewStatePathsForRename(trashPath, originalPath);
          updateFileRecordsForRename(trashPath, originalPath);
        }
        if (dirNode && dirNode.altVariants) {
          for (const label of Object.keys(dirNode.altVariants)) {
            if (!label) continue;
            const altSource = dirNode.altVariants[label];
            const altTrashPath = String(altSource?.sourcePath || "");
            if (!altTrashPath || !isPathInsideInternalTrash(altTrashPath))
              continue;
            const altName = formatAltFolderName(folderName, label);
            try {
              if (await entryExistsInDir(parentHandle, altName)) continue;
              await moveDirectoryOnDiskToParent(
                altTrashPath,
                parentPath,
                altName,
              );
              const restoredAltPath = parentPath
                ? `${parentPath}/${altName}`
                : altName;
              remapAltSourceTreePaths(altSource, altTrashPath, restoredAltPath);
              altSource.name = altName;
              updateFileRecordsForRename(altTrashPath, restoredAltPath);
            } catch {}
          }
        }
        metaTrackDirtyDocIds([
          META_DOC_IDS.scores,
          META_DOC_IDS.scoreHistory,
          META_DOC_IDS.tags,
                  META_DOC_IDS.appearanceAssignments,
          META_DOC_IDS.trash,
        ]);
        metaDeleteTrashRestoreInfo(trashPath);
        restored.push(trashPath);
      } catch {
        failed.push(trashPath);
      }
    }
  } finally {
    hideBusyOverlay();
  }
  if (!restored.length && (failed.length || skipped.length)) {
    showStatusMessage(
      failed.length
        ? `Put Back failed for ${failed.length} folder${failed.length === 1 ? "" : "s"}.`
        : "Put Back skipped.",
    );
    return false;
  }
  await persistDirtyMetadataNow();
  refreshCurrentViewAfterCatalogMutation();
  const parts = [];
  parts.push(
    `Put back ${restored.length} folder${restored.length === 1 ? "" : "s"}.`,
  );
  if (skipped.length)
    parts.push(`${skipped.length} skipped.`);
  if (failed.length)
    parts.push(`${failed.length} failed.`);
  showStatusMessage(parts.join(" "));
  return restored.length > 0;
}

async function deleteFolderPathsPermanently(paths) {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Delete requires a writable folder.");
    return false;
  }

  const uniquePaths = Array.from(
    new Set((paths || []).map((p) => String(p || "").trim()).filter(Boolean)),
  );
  if (!uniquePaths.length) {
    showStatusMessage("No folders selected.");
    return false;
  }

  uniquePaths.sort((a, b) => {
    const depthA = a.split("/").filter(Boolean).length;
    const depthB = b.split("/").filter(Boolean).length;
    if (depthA !== depthB) return depthB - depthA;
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  const rootHandle = WS.meta.fsRootHandle;
  const targets = [];
  for (const path of uniquePaths) {
    const normalizedPath = normalizeWorkspaceRelPath(path);
    if (!normalizedPath) continue;
    const parts = normalizedPath.split("/").filter(Boolean);
    const folderName = parts.pop() || "";
    const parentPath = parts.join("/");
    if (!folderName) continue;
    if (folderName === ".local-gallery" || parts.includes(".local-gallery"))
      continue; // legacy skip; metadata is now external

    let parentHandle = null;
    try {
      parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
    } catch {}
    if (!parentHandle) continue;

    let entryHandle = null;
    try {
      entryHandle = await parentHandle.getDirectoryHandle(folderName);
    } catch {}
    if (!entryHandle) continue;

    targets.push({
      path: normalizedPath,
      parentPath,
      folderName,
      parentHandle,
      entryHandle,
    });
  }

  if (!targets.length) {
    showStatusMessage("No folders available.");
    return false;
  }

  const label =
    targets.length === 1
      ? "Deleting folder..."
      : `Deleting ${targets.length} folders...`;
  showBusyOverlay(label);
  let deleted = 0;
  let failed = 0;
  try {
    for (const t of targets) {
      try {
        await t.parentHandle.removeEntry(t.folderName, { recursive: true });
        deleted++;
        invalidateDirHandleCache(t.path);
        invalidateDirHandleCache(t.parentPath);
      } catch {
        failed++;
      }
    }
  } finally {
    hideBusyOverlay();
  }

  if (!deleted) {
    showStatusMessage("Delete failed.");
    return false;
  }

  refreshCurrentViewAfterCatalogMutation();

  if (failed > 0) {
    showStatusMessage(
      `Deleted ${deleted} folder${deleted === 1 ? "" : "s"}. ${failed} failed.`,
    );
  } else {
    showStatusMessage(`Deleted ${deleted} folder${deleted === 1 ? "" : "s"}.`);
  }
  return true;
}

async function emptyInternalTrashPermanently() {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Empty Trash requires a writable folder.");
    return false;
  }
  const rootHandle = WS.meta.fsRootHandle;
  let trashHandle = null;
  try {
    trashHandle = await getDirectoryHandleForPath(
      rootHandle,
      INTERNAL_TRASH_DIR_NAME,
    );
  } catch {}
  if (!trashHandle) {
    showStatusMessage("Trash folder is unavailable.");
    return false;
  }

  const targets = [];
  try {
    for await (const [name, handle] of trashHandle.entries()) {
      const itemName = String(name || "");
      if (!itemName || isInternalTrashDirName(itemName)) continue;
      const kind = String(handle?.kind || "");
      if (kind !== "directory" && kind !== "file") continue;
      targets.push({ name: itemName, kind });
    }
  } catch {
    showStatusMessage("Trash folder is unavailable.");
    return false;
  }

  if (!targets.length) {
    showStatusMessage("Trash is already empty.");
    return false;
  }

  const label =
    targets.length === 1
      ? "Permanently delete 1 item from Trash?"
      : `Permanently delete ${targets.length} items from Trash?`;
  if (
    !(await showAppMenuConfirm(`${label} This cannot be undone.`, {
      danger: true,
    }))
  ) {
    return false;
  }

  showBusyOverlay("Emptying Trash...");
  let deleted = 0;
  let failed = 0;
  try {
    for (const target of targets) {
      try {
        await trashHandle.removeEntry(target.name, {
          recursive: target.kind === "directory",
        });
        deleted++;
        const trashPath = `${INTERNAL_TRASH_DIR_NAME}/${target.name}`;
        invalidateDirHandleCache(trashPath);
        // The origin record stays: it is how a folder put back at the place it
        // was trashed from gets its metadata handed back to it later.
      } catch {
        failed++;
      }
    }
    invalidateDirHandleCache(INTERNAL_TRASH_DIR_NAME);
  } finally {
    hideBusyOverlay();
  }

  if (!deleted) {
    showStatusMessage("Empty Trash failed.");
    return false;
  }

  await persistDirtyMetadataNow();
  await refreshWorkspaceFromRootHandle();

  if (failed) {
    showStatusMessage(
      `Emptied ${deleted} item${deleted === 1 ? "" : "s"} from Trash. ${failed} failed.`,
    );
  } else {
    showStatusMessage(
      `Emptied ${deleted} item${deleted === 1 ? "" : "s"} from Trash.`,
    );
  }
  return true;
}

async function setMergeSelectedDirs() {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Set Merge requires a writable folder.");
    return false;
  }
  const selectedPaths = getSelectedPathsInCurrentDir()
    .map((p) => String(p || ""))
    .filter(Boolean);
  if (!selectedPaths.length) {
    showStatusMessage("No folders selected.");
    return false;
  }
  const uniquePaths = Array.from(new Set(selectedPaths));
  const firstParts = uniquePaths[0].split("/").filter(Boolean);
  const parentPath = firstParts.slice(0, -1).join("/");
  for (const p of uniquePaths) {
    const parts = String(p || "")
      .split("/")
      .filter(Boolean);
    const parent = parts.slice(0, -1).join("/");
    if (parent !== parentPath) {
      showStatusMessage("Selected folders must be in the same parent folder.");
      return false;
    }
  }

  const rootHandle = WS.meta.fsRootHandle;
  let parentHandle = null;
  try {
    parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
  } catch {}
  if (!parentHandle) {
    showStatusMessage("Folder handle unavailable.");
    return false;
  }

  const dirHandles = [];
  for (const p of uniquePaths) {
    try {
      dirHandles.push(await getDirectoryHandleForPath(rootHandle, p));
    } catch {}
  }
  if (!dirHandles.length) {
    showStatusMessage("No folders available.");
    return false;
  }

  const desiredBase = await chooseSetMergeOutputName(dirHandles);
  const tmpBase = `${desiredBase} (Merging)`;
  const tmpName = await uniqueDirNameInParent(parentHandle, tmpBase);
  let tmpHandle = null;
  try {
    tmpHandle = await parentHandle.getDirectoryHandle(tmpName, {
      create: true,
    });
  } catch {}
  if (!tmpHandle) {
    showStatusMessage("Failed to create merge folder.");
    return false;
  }

  for (let i = 0; i < dirHandles.length; i++) {
    const handle = dirHandles[i];
    const path = uniquePaths[i];
    if (!handle || !path) continue;
    for await (const [name, entryHandle] of handle.entries()) {
      if (!name || name === ".local-gallery") continue;
      const ok = await moveEntryWithCollisionRename(
        handle,
        entryHandle,
        name,
        tmpHandle,
      );
      if (!ok) {
        showStatusMessage(`Move failed for ${name}.`);
        return false;
      }
    }
    const folderName = path.split("/").filter(Boolean).pop();
    if (folderName) {
      try {
        await parentHandle.removeEntry(folderName, { recursive: true });
      } catch {}
    }
  }

  let finalName = desiredBase;
  if (await entryExistsInDir(parentHandle, finalName)) {
    finalName = await uniqueDirNameInParent(parentHandle, desiredBase);
  }

  const tmpPath = parentPath ? parentPath + "/" + tmpName : tmpName;
  try {
    await renameDirectoryOnDisk(tmpPath, finalName);
  } catch {
    showStatusMessage("Failed to finalize merged folder.");
    return false;
  }

  finalizeBulkSelectionAction();
  closeActionMenus();

  const finalPath = parentPath ? parentPath + "/" + finalName : finalName;
  const idx = findDirEntryIndexByPath(finalPath);
  if (idx >= 0) {
    // Stay where you are, with the merged set's card selected.
    WS.view.pendingPreviewSelectionKey = `dir:${finalPath}`;
    preserveActivePreviewTargetDuringDirectoriesRefresh();
    renderDirectoriesPane(true);
    renderPreviewPane(true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  }
  showStatusMessage("Set Merge complete.");
  return true;
}

/* Merge folders (Folder options, two or more Sets selected): every file moves
   into the Set whose name sorts first -- with date-named Sets, the earliest --
   and the merged Set is then indexed to its own name in plain name order, the
   order the files would show in anyway. The emptied Sets are removed; their
   metadata stays in the logs like any vanished folder's. */
function mergeableSetNodesForPaths(paths) {
  const list = Array.from(
    new Set((paths || []).map((p) => normalizeDirPathValue(p)).filter(Boolean)),
  );
  if (list.length < 2) return null;
  const nodes = [];
  for (const path of list) {
    const node = WS.dirByPath.get(path) || null;
    if (!node || !node.parent || node.parent.parent !== WS.root) return null;
    // Sets of one Model only: a Model is a person.
    if (nodes.length && node.parent !== nodes[0].parent) return null;
    if (isStorageStubDirNode(node) || metaHasStorage(path)) return null;
    if (isPathInsideInternalTrash(path) || isMissingPlaceholderNode(node))
      return null;
    // An ALT-bearing Set borrows its files from other folders on disk.
    if (node.altVariants && Object.keys(node.altVariants).length) return null;
    nodes.push(node);
  }
  return nodes.sort(
    (a, b) =>
      String(a.name || "").localeCompare(String(b.name || ""), undefined, {
        numeric: true,
        sensitivity: "base",
      }) || String(a.path || "").localeCompare(String(b.path || "")),
  );
}

async function mergeSelectedSets(paths) {
  if (RENAME_BUSY) return false;
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Merge folders requires a writable folder.");
    return false;
  }
  const nodes = mergeableSetNodesForPaths(paths);
  if (!nodes) {
    showStatusMessage("Merge folders needs two or more sets.");
    return false;
  }
  const target = nodes[0];
  const sources = nodes.slice(1);
  const targetPath = String(target.path || "");
  const rootHandle = WS.meta.fsRootHandle;
  let targetHandle = null;
  try {
    targetHandle = await getDirectoryHandleForPath(rootHandle, targetPath);
  } catch {}
  if (!targetHandle) {
    showStatusMessage("Folder handle unavailable.");
    return false;
  }

  // The order is settled from the names as they are now, before a move can
  // rename a clashing file; a tie goes to the earlier Set.
  const ordered = [];
  nodes.forEach((node, setIndex) => {
    for (const id of Array.isArray(node.childrenFiles) ? node.childrenFiles : []) {
      const rec = WS.fileById.get(String(id || ""));
      if (rec && !isMissingPlaceholderRecord(rec))
        ordered.push({ rec, name: String(rec.name || ""), setIndex });
    }
  });
  ordered.sort(
    (a, b) => compareIndexedNames(a.name, b.name) || a.setIndex - b.setIndex,
  );

  RENAME_BUSY = true;
  let movedFiles = 0;
  let failedFiles = 0;
  let removedSets = 0;
  let indexFailed = false;
  try {
    showBusyOverlay("Merging folders...");
    for (let s = 0; s < sources.length; s++) {
      const node = sources[s];
      const sourcePath = String(node.path || "");
      showBusyOverlay(
        `Merging folders... ${s + 1}/${sources.length}`,
        displayPath(sourcePath) || node.name || "",
      );
      let sourceHandle = null;
      try {
        sourceHandle = await getDirectoryHandleForPath(rootHandle, sourcePath);
      } catch {}
      if (!sourceHandle) {
        failedFiles++;
        continue;
      }
      const recByName = new Map();
      for (const id of Array.isArray(node.childrenFiles) ? node.childrenFiles : []) {
        const rec = WS.fileById.get(String(id || ""));
        if (rec && !isMissingPlaceholderRecord(rec))
          recByName.set(String(rec.name || ""), rec);
      }
      const entries = [];
      for await (const [name, handle] of sourceHandle.entries()) {
        if (!name || name === ".DS_Store" || handle?.kind !== "file") continue;
        entries.push([name, handle]);
      }
      const movedRecs = [];
      for (const [name, handle] of entries) {
        const info = {};
        const ok = await moveEntryWithCollisionRename(
          sourceHandle,
          handle,
          name,
          targetHandle,
          info,
        );
        if (!ok) {
          failedFiles++;
          continue;
        }
        movedFiles++;
        const rec = recByName.get(name);
        if (!rec) continue;
        const movedName = String(info.movedName || name);
        if (movedName !== name) {
          rec.name = movedName;
          rec.ext = splitNameExtension(movedName).ext.toLowerCase() || rec.ext;
        }
        movedRecs.push(rec);
      }
      if (movedRecs.length) {
        updateFileRecordsForFileMoves(
          sourcePath,
          targetPath,
          movedRecs.map((rec) => String(rec.id || "")),
        );
        // The File each record holds was read from the old place.
        for (const rec of movedRecs)
          await refreshRenamedRecordFileFromDisk(rec, targetHandle);
      }
      invalidateDirHandleCache(sourcePath);

      // Remove the Set once nothing but Finder's .DS_Store is left in it.
      let leftover = false;
      for await (const [name] of sourceHandle.entries()) {
        if (name && name !== ".DS_Store") {
          leftover = true;
          break;
        }
      }
      if (leftover) continue;
      const parentPath = String(node.parent?.path || "");
      try {
        const parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
        await parentHandle.removeEntry(String(node.name || ""), { recursive: true });
      } catch {
        continue;
      }
      if (node.parent && Array.isArray(node.parent.childrenDirs))
        node.parent.childrenDirs = node.parent.childrenDirs.filter(
          (child) => child !== node,
        );
      unindexDirTree(node);
      invalidateDirHandleCache(parentPath);
      removedSets++;
    }
    invalidateDirectoryDerivedIndex();
    invalidateDirMetricsCaches();

    // That order, then indexed to the merged Set's name. Anything that was not
    // a record (nothing should be) keeps its place at the end.
    clearSessionFileOrderForDir(target);
    const inTarget = new Set(
      (Array.isArray(target.childrenFiles) ? target.childrenFiles : [])
        .map((id) => String(id || ""))
        .filter((id) => !!id && WS.fileById.has(id)),
    );
    const orderedIds = ordered
      .map((item) => String(item.rec.id || ""))
      .filter((id) => inTarget.has(id));
    const orderedSet = new Set(orderedIds);
    target.childrenFiles = orderedIds.concat(
      Array.from(inTarget).filter((id) => !orderedSet.has(id)),
    );
    target.preserveOrder = true;
    showBusyOverlay("Indexing files...", displayPath(targetPath) || target.name || "");
    const plan = await buildIndexRenamePlanForDir(target, targetHandle);
    indexFailed = Number(plan.skipped) > 0;
    if (plan.ops.length) {
      const result = await applyIndexRenamePlanForDir(target, targetHandle, plan.ops);
      if (Number(result.failed) > 0) indexFailed = true;
    }
    // Not renamed: keep the merged order for the session, as a kept order.
    if (target.preserveOrder) saveSessionFileOrderForDir(target);

    metaComputeFingerprints();
    metaTrackDirtyDocIds([
      META_DOC_IDS.scores,
      META_DOC_IDS.tags,
      META_DOC_IDS.thumbnails,
      META_DOC_IDS.appearanceAssignments,
    ]);
    try {
      await persistDirtyMetadataNow();
    } catch {}
  } catch (err) {
    console.error("Merge folders failed.", err);
    showStatusMessage("Merge folders failed.");
    return false;
  } finally {
    RENAME_BUSY = false;
    hideBusyOverlay();
  }

  finalizeBulkSelectionAction();
  closeActionMenus();
  WS.view.pendingPreviewSelectionKey = `dir:${targetPath}`;
  refreshCurrentViewAfterCatalogMutation();
  const into = dirDisplayName(target) || target.name || "the first set";
  const parts = [
    `Merged ${removedSets + 1} sets into ${into} (${movedFiles} file${movedFiles === 1 ? "" : "s"} moved).`,
  ];
  if (failedFiles) parts.push(`${failedFiles} failed.`);
  if (removedSets < sources.length)
    parts.push(`${sources.length - removedSets} set${sources.length - removedSets === 1 ? "" : "s"} kept: not empty.`);
  if (indexFailed) parts.push("Index skipped.");
  showStatusMessage(parts.join(" "));
  return true;
}

async function moveFileToDirectoryHandle(srcDirHandle, dstDirHandle, name) {
  if (!srcDirHandle || !dstDirHandle) return false;
  const fname = String(name || "");
  if (!fname) return false;
  let fileHandle = null;
  try {
    fileHandle = await srcDirHandle.getFileHandle(fname);
  } catch {}
  if (!fileHandle) return false;
  if (typeof fileHandle.move === "function") {
    try {
      await fileHandle.move(dstDirHandle, fname);
      return true;
    } catch {}
  }
  try {
    const file = await fileHandle.getFile();
    const dstFile = await dstDirHandle.getFileHandle(fname, { create: true });
    const writable = await dstFile.createWritable();
    await writable.write(file);
    await writable.close();
    await srcDirHandle.removeEntry(fname);
    return true;
  } catch {}
  return false;
}

function updateFileRecordsForFileMoves(oldDirPath, newDirPath, fileIds) {
  const idSet = new Set((fileIds || []).map((id) => String(id || "")));
  if (!idSet.size) return;
  const idMap = new Map();
  const relPathMap = new Map();
  const nextFileById = new Map();
  const movedNewIds = [];

  for (const [id, rec] of WS.fileById.entries()) {
    const key = String(id || "");
    if (!idSet.has(key)) {
      nextFileById.set(id, rec);
      continue;
    }
    const oldRelPath = String(rec.relPath || "");
    const relPath = newDirPath ? newDirPath + "/" + rec.name : rec.name;
    rec.dirPath = newDirPath;
    rec.relPath = relPath;
    const nextId = fileKeyForRecord(rec, relPath);
    if (oldRelPath && relPath && oldRelPath !== relPath)
      relPathMap.set(oldRelPath, relPath);
    rec.id = nextId;
    if (nextId !== id) idMap.set(id, nextId);
    nextFileById.set(nextId, rec);
    movedNewIds.push(nextId);
  }

  WS.fileById = nextFileById;

  const oldNode = WS.dirByPath.get(String(oldDirPath || "")) || null;
  if (oldNode && Array.isArray(oldNode.childrenFiles)) {
    oldNode.childrenFiles = oldNode.childrenFiles.filter(
      (id) => !idSet.has(String(id || "")),
    );
  }

  const newNode = WS.dirByPath.get(String(newDirPath || "")) || null;
  if (newNode && Array.isArray(newNode.childrenFiles)) {
    for (const id of movedNewIds) {
      if (!newNode.childrenFiles.includes(id)) newNode.childrenFiles.push(id);
    }
  }

  invalidateDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
  remapFileIdsAcrossViewState(idMap);
  remapFolderThumbnailPresetValues(relPathMap);
}

async function looseSetMergeSelectedFiles() {
  if (!WS.meta.fsRootHandle) {
    showStatusMessage("Loose Set Merge requires a writable folder.");
    return false;
  }
  const records = getSelectedFileRecordsInCurrentView();
  if (!records.length) {
    showStatusMessage("No files selected.");
    return false;
  }
  const parentPath = String(records[0].dirPath || "");
  for (const rec of records) {
    if (String(rec.dirPath || "") !== parentPath) {
      showStatusMessage("Selected files must be in the same folder.");
      return false;
    }
  }

  const folderNameRaw = chooseLooseSetFolderNameFromRecords(records);
  const folderName = normalizeFolderNameInput(folderNameRaw);
  if (!isValidFolderName(folderName)) {
    showStatusMessage("Invalid folder name.");
    return false;
  }

  const rootHandle = WS.meta.fsRootHandle;
  let parentHandle = null;
  try {
    parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);
  } catch {}
  if (!parentHandle) {
    showStatusMessage("Folder handle unavailable.");
    return false;
  }

  let existing = null;
  try {
    existing = await parentHandle.getDirectoryHandle(folderName);
  } catch {}
  if (existing) {
    showStatusMessage("A folder with that name already exists.");
    return false;
  }
  existing = null;
  try {
    existing = await parentHandle.getFileHandle(folderName);
  } catch {}
  if (existing) {
    showStatusMessage("A file with that name already exists.");
    return false;
  }

  let tmpName = "";
  for (let i = 0; i < 24; i++) {
    const cand = `.grouping_tmp.${Math.random().toString(36).slice(2, 8)}`;
    let has = false;
    try {
      await parentHandle.getDirectoryHandle(cand);
      has = true;
    } catch {}
    if (!has) {
      try {
        await parentHandle.getFileHandle(cand);
        has = true;
      } catch {}
    }
    if (has) continue;
    tmpName = cand;
    break;
  }
  if (!tmpName) {
    showStatusMessage("Failed to create temporary folder.");
    return false;
  }

  let tmpHandle = null;
  try {
    tmpHandle = await parentHandle.getDirectoryHandle(tmpName, {
      create: true,
    });
  } catch {}
  if (!tmpHandle) {
    showStatusMessage("Failed to create temporary folder.");
    return false;
  }

  for (const rec of records) {
    const ok = await moveFileToDirectoryHandle(
      parentHandle,
      tmpHandle,
      rec.name,
    );
    if (!ok) {
      showStatusMessage(`Move failed for ${rec.name || "file"}.`);
      return false;
    }
  }

  const tmpPath = parentPath ? parentPath + "/" + tmpName : tmpName;
  try {
    await renameDirectoryOnDisk(tmpPath, folderName);
  } catch {
    showStatusMessage("Failed to rename folder.");
    return false;
  }

  const newDirPath = parentPath ? parentPath + "/" + folderName : folderName;
  ensureDirPath(newDirPath);
  updateFileRecordsForFileMoves(
    parentPath,
    newDirPath,
    records.map((r) => r.id),
  );
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

  finalizeBulkSelectionAction();
  closeActionMenus();
  rebuildDirectoriesEntries();
  WS.view.pendingPreviewSelectionKey = `dir:${newDirPath}`;
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  showStatusMessage("Loose Set Merge complete.");
  return true;
}
