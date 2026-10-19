/* File order
   Kept (session) file orders, drag-reorder in the file pane, reverse and
   reset. */

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
}

function fileOrderSessionKeyForDir(dirNode) {
  if (!dirNode) return "";
  const p = String(dirNode.path || "");
  const workspaceKey = String(WS.meta?.storageKey || "__workspace__");
  return `${workspaceKey}::${p || "__root__"}`;
}

function fileOrderSessionPathKeyForDir(dirNode) {
  if (!dirNode) return "";
  const p = String(dirNode.path || "");
  return `session-path::${p || "__root__"}`;
}

function fileOrderSessionKeysForDir(dirNode) {
  const keys = [];
  const workspaceKey = fileOrderSessionKeyForDir(dirNode);
  const pathKey = fileOrderSessionPathKeyForDir(dirNode);
  if (workspaceKey) keys.push(workspaceKey);
  if (pathKey && pathKey !== workspaceKey) keys.push(pathKey);
  return keys;
}

function ensureSessionFileOrderMap() {
  if (!WS.view.fileOrderByDirPath || !(WS.view.fileOrderByDirPath instanceof Map)) {
    WS.view.fileOrderByDirPath = new Map();
  }
  return WS.view.fileOrderByDirPath;
}

function getSessionFileOrderForDir(dirNode) {
  const map = ensureSessionFileOrderMap();
  const keys = fileOrderSessionKeysForDir(dirNode);
  for (let i = 0; i < keys.length; i++) {
    const stored = map.get(keys[i]);
    if (Array.isArray(stored) && stored.length) return stored;
  }
  return null;
}

function sessionFileOrderExistsForDir(dirNode) {
  return !!getSessionFileOrderForDir(dirNode);
}

function saveSessionFileOrderForDir(dirNode, ids = null) {
  const canonical = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!canonical || !Array.isArray(canonical.childrenFiles)) return false;
  const source = Array.isArray(ids)
    ? ids
    : Array.isArray(dirNode?.childrenFiles)
      ? dirNode.childrenFiles
      : canonical.childrenFiles;
  const cleaned = source
    .map((id) => String(id || ""))
    .filter((id) => !!id && (!WS.fileById || WS.fileById.has(id)));
  if (!cleaned.length) return false;
  const current = canonical.childrenFiles
    .map((id) => String(id || ""))
    .filter((id) => !!id && (!WS.fileById || WS.fileById.has(id)));
  const seen = new Set();
  const next = [];
  for (let i = 0; i < cleaned.length; i++) {
    const id = cleaned[i];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (let i = 0; i < current.length; i++) {
    const id = current[i];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  canonical.childrenFiles = next;
  canonical.preserveOrder = true;
  if (dirNode && dirNode !== canonical && Array.isArray(dirNode.childrenFiles)) {
    dirNode.childrenFiles = next.slice();
    dirNode.preserveOrder = true;
  }
  const map = ensureSessionFileOrderMap();
  const keys = fileOrderSessionKeysForDir(canonical);
  for (let i = 0; i < keys.length; i++) map.set(keys[i], next.slice());
  return true;
}

function clearSessionFileOrderForDir(dirNode) {
  const canonical = canonicalDirNodeForActiveState(dirNode) || dirNode;
  const keys = fileOrderSessionKeysForDir(canonical);
  if (!keys.length) return false;
  const map = ensureSessionFileOrderMap();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    changed = map.delete(keys[i]) || changed;
  }
  return changed;
}

function applySessionFileOrderForDir(dirNode) {
  const canonical = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!canonical || !Array.isArray(canonical.childrenFiles)) return false;
  const stored = getSessionFileOrderForDir(canonical);
  if (!Array.isArray(stored) || !stored.length) return false;
  const current = canonical.childrenFiles
    .map((id) => String(id || ""))
    .filter((id) => !!id && (!WS.fileById || WS.fileById.has(id)));
  const currentSet = new Set(current);
  const next = [];
  const seen = new Set();
  for (let i = 0; i < stored.length; i++) {
    const id = String(stored[i] || "");
    if (!id || seen.has(id) || !currentSet.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  for (let i = 0; i < current.length; i++) {
    const id = current[i];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  if (!next.length) return false;
  canonical.childrenFiles = next;
  canonical.preserveOrder = true;
  if (dirNode && dirNode !== canonical && Array.isArray(dirNode.childrenFiles)) {
    dirNode.childrenFiles = next.slice();
    dirNode.preserveOrder = true;
  }
  saveSessionFileOrderForDir(canonical, next);
  return true;
}

function remapSessionFileOrders(idMap) {
  if (!idMap || !idMap.size) return;
  const map = ensureSessionFileOrderMap();
  for (const [key, ids] of Array.from(map.entries())) {
    if (!Array.isArray(ids)) continue;
    map.set(
      key,
      ids.map((id) => remapIdValue(idMap, id)).filter(Boolean),
    );
  }
}

function getOrderedFileIdsForDir(dirNode, includeChildren = false) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode) return [];
  let ids = [];
  const containerSortMode = effectiveContainerSortModeForDir(dirNode);

  // Random file sort is an explicit view-mode override and must outrank a pinned
  // manual order. Otherwise any folder that was ever reordered (drag, reverse, or
  // the index/rename tool) silently ignores the shuffle: applySessionFileOrderForDir
  // re-pins preserveOrder on every read, so the folder stays stuck for the rest of
  // the session and only an app restart clears it. Toggling random off falls through
  // to the pinned order below, so nothing is lost.
  if (containerSortMode) {
    ids = dirNode.childrenFiles.slice();
    ids.sort((a, b) => {
      const recordA = WS.fileById.get(a);
      const recordB = WS.fileById.get(b);
      if (containerSortMode === "size-desc") {
        const sizeA = Math.max(0, Number(recordA?.size) || 0);
        const sizeB = Math.max(0, Number(recordB?.size) || 0);
        if (sizeA !== sizeB) return sizeB - sizeA;
      }
      return compareIndexedNames(recordA?.name || "", recordB?.name || "");
    });
  } else if (applySessionFileOrderForDir(dirNode)) {
    ids = dirNode.childrenFiles.slice();
  } else if (dirNode.preserveOrder) {
    ids = dirNode.childrenFiles.slice();
  } else {
    ids = dirNode.childrenFiles.slice();
    ids.sort((a, b) =>
      compareIndexedNames(
        WS.fileById.get(a)?.name || "",
        WS.fileById.get(b)?.name || "",
      ),
    );
  }
  // Randomize file order outranks every other order, a kept one included.
  ids = randomOrderFileIds(dirNode, ids);

  const contextualTagFilter = contextualTagMediaFilterForDirPath(
    String(dirNode.path || ""),
  );
  ids = ids.filter((id) => {
    const rec = WS.fileById.get(id);
    if (!passesFilter(rec)) return false;
    return (
      !contextualTagFilter.length ||
      recordPassesTagMediaFilter(rec, contextualTagFilter)
    );
  });

  if (!includeChildren) return ids;

  for (const child of getChildDirsForNode(dirNode)) {
    const childIds = getOrderedFileIdsForDir(child, false);
    for (const id of childIds) ids.push(id);
  }

  return ids;
}

const DIR_FILE_DRAG = { id: null, dirPath: null };
const DIRECTORIES_GRID_DRAG_STATE = {
  placeholder: null,
  container: null,
  draggedId: null,
  draggedRow: null,
  dirNode: null,
  visibleIds: null,
  raf: 0,
  lastX: 0,
  lastY: 0,
  pendingHide: false,
};

function ensureDirectoriesGridDragPlaceholder(row) {
  if (!DIRECTORIES_GRID_DRAG_STATE.placeholder) {
    const ph = document.createElement("div");
    ph.className = "dirRow fileRow drag-placeholder";
    ph.setAttribute("aria-hidden", "true");
    DIRECTORIES_GRID_DRAG_STATE.placeholder = ph;
  }
  const rect = row.getBoundingClientRect();
  const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
  ph.style.width = `${Math.max(1, Math.round(rect.width))}px`;
  ph.style.height = `${Math.max(1, Math.round(rect.height))}px`;
  return ph;
}

function placeDirectoriesGridDragPlaceholder(row) {
  const container = row?.parentElement || directoriesListEl;
  if (!container || !row) return;
  const ph = ensureDirectoriesGridDragPlaceholder(row);
  if (ph.parentElement && ph.parentElement !== container) {
    ph.parentElement.removeChild(ph);
  }
  DIRECTORIES_GRID_DRAG_STATE.container = container;
  if (row !== ph) container.insertBefore(ph, row);
}

function clearDirectoriesGridDragPlaceholder() {
  const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
  if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
  DIRECTORIES_GRID_DRAG_STATE.container = null;
}

function getDirectoriesGridDragRows(container) {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll(".dirRow.fileRow[data-file-id]"),
  ).filter(
    (row) =>
      !row.classList.contains("drag-placeholder") &&
      !row.classList.contains("drag-hidden"),
  );
}

function updateDirectoriesGridPlaceholderFromPoint(container, x, y) {
  const rows = getDirectoriesGridDragRows(container);
  if (!rows.length) {
    const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
    if (ph) container.appendChild(ph);
    return;
  }
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    const rowMid = rect.top + rect.height / 2;
    if (y < rowMid) {
      placeDirectoriesGridDragPlaceholder(row);
      return;
    }
    if (y >= rect.top && y <= rect.bottom) {
      const colMid = rect.left + rect.width / 2;
      if (x < colMid) {
        placeDirectoriesGridDragPlaceholder(row);
        return;
      }
    }
  }
  const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
  if (ph) container.appendChild(ph);
}

function scheduleDirectoriesGridDragUpdate(container, x, y) {
  DIRECTORIES_GRID_DRAG_STATE.lastX = x;
  DIRECTORIES_GRID_DRAG_STATE.lastY = y;
  if (DIRECTORIES_GRID_DRAG_STATE.raf) return;
  DIRECTORIES_GRID_DRAG_STATE.raf = requestAnimationFrame(() => {
    DIRECTORIES_GRID_DRAG_STATE.raf = 0;
    updateDirectoriesGridPlaceholderFromPoint(
      container,
      DIRECTORIES_GRID_DRAG_STATE.lastX,
      DIRECTORIES_GRID_DRAG_STATE.lastY,
    );
  });
}

function beginDirectoriesGridFileDrag(row, dragDir, visibleIds) {
  DIRECTORIES_GRID_DRAG_STATE.draggedRow = row;
  DIRECTORIES_GRID_DRAG_STATE.draggedId = String(row?.dataset?.fileId || "");
  DIRECTORIES_GRID_DRAG_STATE.dirNode = dragDir;
  DIRECTORIES_GRID_DRAG_STATE.visibleIds = Array.isArray(visibleIds)
    ? visibleIds.map((id) => String(id || ""))
    : null;
  DIRECTORIES_GRID_DRAG_STATE.container = row?.parentElement || null;
  DIRECTORIES_GRID_DRAG_STATE.pendingHide = true;
}

function finishDirectoriesGridFileDrag() {
  if (DIRECTORIES_GRID_DRAG_STATE.raf) {
    cancelAnimationFrame(DIRECTORIES_GRID_DRAG_STATE.raf);
    DIRECTORIES_GRID_DRAG_STATE.raf = 0;
  }
  const row = DIRECTORIES_GRID_DRAG_STATE.draggedRow;
  if (row) {
    row.classList.remove("drag-hidden");
    row.classList.remove("dragging");
  }
  DIRECTORIES_GRID_DRAG_STATE.draggedRow = null;
  DIRECTORIES_GRID_DRAG_STATE.draggedId = null;
  DIRECTORIES_GRID_DRAG_STATE.dirNode = null;
  DIRECTORIES_GRID_DRAG_STATE.visibleIds = null;
  DIRECTORIES_GRID_DRAG_STATE.pendingHide = false;
  clearDirectoriesGridDragPlaceholder();
}

function ensureDirectoriesGridDragHidden() {
  if (!DIRECTORIES_GRID_DRAG_STATE.pendingHide) return;
  const row = DIRECTORIES_GRID_DRAG_STATE.draggedRow;
  const container =
    DIRECTORIES_GRID_DRAG_STATE.container || row?.parentElement || null;
  if (!row || !container) return;
  DIRECTORIES_GRID_DRAG_STATE.pendingHide = false;
  placeDirectoriesGridDragPlaceholder(row);
  row.classList.add("drag-hidden");
}

function setupDirectoriesGridFileDropZone(container) {
  if (!container || container.dataset.gridFileDropBound === "1") return;
  container.dataset.gridFileDropBound = "1";

  container.addEventListener("dragover", (e) => {
    if (!DIRECTORIES_GRID_DRAG_STATE.draggedId) return;
    if (
      DIRECTORIES_GRID_DRAG_STATE.container &&
      DIRECTORIES_GRID_DRAG_STATE.container !== container
    )
      return;
    if (!container.classList.contains("gridModeList")) return;
    e.preventDefault();
    ensureDirectoriesGridDragHidden();
    scheduleDirectoriesGridDragUpdate(container, e.clientX, e.clientY);
  });

  container.addEventListener("drop", (e) => {
    if (!DIRECTORIES_GRID_DRAG_STATE.draggedId) return;
    if (
      DIRECTORIES_GRID_DRAG_STATE.container &&
      DIRECTORIES_GRID_DRAG_STATE.container !== container
    )
      return;
    if (!container.classList.contains("gridModeList")) return;
    e.preventDefault();
    e.stopPropagation();
    updateDirectoriesGridPlaceholderFromPoint(container, e.clientX, e.clientY);
    const dirNode = DIRECTORIES_GRID_DRAG_STATE.dirNode;
    const dragId = DIRECTORIES_GRID_DRAG_STATE.draggedId;
    const ids =
      DIRECTORIES_GRID_DRAG_STATE.visibleIds &&
      DIRECTORIES_GRID_DRAG_STATE.visibleIds.length
        ? DIRECTORIES_GRID_DRAG_STATE.visibleIds
        : dirNode
          ? getOrderedFileIdsForDir(dirNode)
          : [];
    const list = ids.filter((id) => String(id || "") !== String(dragId));
    const children = Array.from(container.children);
    let insertIdx = 0;
    for (const child of children) {
      if (child === DIRECTORIES_GRID_DRAG_STATE.placeholder) break;
      if (
        child.classList &&
        child.classList.contains("dirRow") &&
        child.classList.contains("fileRow") &&
        !child.classList.contains("drag-hidden") &&
        !child.classList.contains("drag-placeholder")
      ) {
        insertIdx++;
      }
    }
    insertIdx = Math.max(0, Math.min(list.length, insertIdx));
    let targetId = null;
    let placeAfter = false;
    if (list.length) {
      if (insertIdx >= list.length) {
        targetId = list[list.length - 1];
        placeAfter = true;
      } else {
        targetId = list[insertIdx];
        placeAfter = false;
      }
    }
    if (dirNode && targetId) {
      const moved = reorderFilesInDir(dirNode, dragId, targetId, placeAfter, {
        visibleIds: ids,
      });
      if (moved) syncAfterDirOrderChange(null, { preserveSelection: true });
    }
    DIR_FILE_DRAG.id = null;
    DIR_FILE_DRAG.dirPath = null;
    finishDirectoriesGridFileDrag();
  });
}

function setupDirectoriesGridFileDragSource(row, dragDir, visibleIds) {
  if (!row || row.dataset.gridFileDragBound === "1") return;
  row.dataset.gridFileDragBound = "1";
  const fileId = String(row.dataset.fileId || "");
  if (!fileId || !dragDir) return;

  const handleDragStart = (e) => {
    if (
      !isGridInteractionMode() ||
      !directoriesListEl ||
      !directoriesListEl.classList.contains("gridModeList")
    ) {
      e.preventDefault();
      return;
    }
    if (!canReorderFilesInDir(dragDir) || WS.view.bulkSelectMode) {
      e.preventDefault();
      return;
    }
    DIR_FILE_DRAG.id = fileId;
    DIR_FILE_DRAG.dirPath = String(dragDir.path || "");
    row.classList.add("dragging");
    beginDirectoriesGridFileDrag(row, dragDir, visibleIds);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", fileId);
      } catch {}
      try {
        const rect = row.getBoundingClientRect();
        e.dataTransfer.setDragImage(row, rect.width / 2, rect.height / 2);
      } catch {}
    }
  };

  const handleDragEnd = () => {
    DIR_FILE_DRAG.id = null;
    DIR_FILE_DRAG.dirPath = null;
    row.classList.remove("dragging");
    finishDirectoriesGridFileDrag();
  };

  const setupDragSource = (el) => {
    if (!el) return;
    el.draggable = true;
    el.addEventListener("dragstart", handleDragStart);
    el.addEventListener("dragend", handleDragEnd);
  };

  setupDragSource(row);
  setupDragSource(row.querySelector(".dirFileThumbCard"));
  setupDragSource(row.querySelector(".dirInlinePreview"));
  setupDragSource(row.querySelector(".dirFileOverlay"));
}

function canReorderFilesInDir(dirNode) {
  if (!WS.root || !dirNode) return false;
  if (searchResultsVisibleInDirectoriesPane()) return false;
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
  return true;
}

function canReorderFilesInCurrentDir() {
  return canReorderFilesInDir(WS.nav.dirNode);
}

function findFileEntryIndexById(fileId) {
  const id = String(fileId || "");
  if (!id) return -1;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (entry && entry.kind === "file" && String(entry.id || "") === id)
      return i;
  }
  return -1;
}

function syncAfterDirOrderChange(selectId, opts = {}) {
  const preserveSelection = !!opts.preserveSelection;
  const preservePreviewTarget = !!opts.preservePreviewTarget;
  const renderPreview = opts.renderPreview !== false;
  canonicalizeActiveDirectoryReferences();
  const prevEntry = preserveSelection
    ? WS.nav.entries[WS.nav.selectedIndex] || null
    : null;
  rebuildDirectoriesEntries();
  canonicalizeActiveDirectoryReferences();
  if (selectId) {
    const idx = findFileEntryIndexById(selectId);
    if (idx >= 0) WS.nav.selectedIndex = idx;
    else
      WS.nav.selectedIndex = findNearestSelectableIndex(
        WS.nav.selectedIndex,
        1,
      );
  } else if (preserveSelection && prevEntry) {
    let idx = -1;
    if (prevEntry.kind === "file") {
      idx = findFileEntryIndexById(prevEntry.id);
    } else if (prevEntry.kind === "dir") {
      idx = findDirEntryIndexByPath(prevEntry.node?.path || "");
    } else if (prevEntry.kind === "tag") {
      const tag = String(prevEntry.tag || "");
      const label = String(prevEntry.label || prevEntry.tag || "");
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (
          entry &&
          entry.kind === "tag" &&
          String(entry.tag || "") === tag &&
          String(entry.label || entry.tag || "") === label
        ) {
          idx = i;
          break;
        }
      }
    }
    if (idx >= 0) WS.nav.selectedIndex = idx;
    else
      WS.nav.selectedIndex = findNearestSelectableIndex(
        WS.nav.selectedIndex,
        1,
      );
  } else {
    WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  }
  if (!(preservePreviewTarget && previewTargetStillResolvable())) {
    syncPreviewToSelection({ force: true });
  } else {
    canonicalizeActiveDirectoryReferences();
  }
  renderDirectoriesPane(true);
  if (renderPreview) renderPreviewPane(true, true);
  syncButtons();
  if (renderPreview) {
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  }
}

function isDirWithin(rootNode, childNode) {
  if (!rootNode || !childNode) return false;
  const rootPath = String(rootNode.path || "");
  let cur = childNode;
  while (cur) {
    if (cur === rootNode) return true;
    if (rootPath && String(cur.path || "") === rootPath) return true;
    cur = cur.parent;
  }
  return false;
}

function resetDirFileOrder(dirNode, opts = {}) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
  dirNode.preserveOrder = false;
  dirNode.childrenFiles.sort((a, b) =>
    compareIndexedNames(
      WS.fileById.get(a)?.name || "",
      WS.fileById.get(b)?.name || "",
    ),
  );
  clearSessionFileOrderForDir(dirNode);
  if (!opts.silent) {
    syncAfterDirOrderChange(opts.selectId || null, {
      preservePreviewTarget: true,
      preserveSelection: true,
    });
  } else {
    const previewTarget = getPreviewTargetDir();
    const refreshPreview = !!(
      previewTarget &&
      (isDirWithin(previewTarget, dirNode) ||
        isDirWithin(dirNode, previewTarget))
    );
    if (refreshPreview) {
      renderPreviewPane(true, true);
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }
  }
  return true;
}

function dirFileOrderDiffersFromIndexedNameOrder(dirNode) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
  applySessionFileOrderForDir(dirNode);
  const current = dirNode.childrenFiles
    .map((id) => String(id || ""))
    .filter((id) => !!id && WS.fileById.has(id));
  if (current.length < 2) return false;
  const indexed = current.slice().sort((a, b) =>
    compareIndexedNames(
      WS.fileById.get(a)?.name || "",
      WS.fileById.get(b)?.name || "",
    ),
  );
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== indexed[i]) return true;
  }
  return false;
}

function dirTreeHasIndexableOrderMismatch(dirNode) {
  const dirs = collectIndexableDirs(dirNode);
  for (let i = 0; i < dirs.length; i++) {
    if (dirFileOrderDiffersFromIndexedNameOrder(dirs[i])) return true;
  }
  return false;
}

function reorderFilesInDir(
  dirNode,
  draggedId,
  targetId,
  placeAfter,
  opts = {},
) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !draggedId || !targetId) return false;
  const list = dirNode.childrenFiles;
  if (!Array.isArray(list) || list.length < 2) return false;
  const dragId = String(draggedId);
  const target = String(targetId);
  if (dragId === target) return false;

  const visible = Array.isArray(opts.visibleIds)
    ? opts.visibleIds.map((id) => String(id || ""))
    : null;
  if (visible && visible.length) {
    const visibleSet = new Set(visible);
    if (!visibleSet.has(dragId) || !visibleSet.has(target)) return false;
    const reorderedVisible = visible.filter((id) => id !== dragId);
    const targetIdx = reorderedVisible.indexOf(target);
    if (targetIdx < 0) return false;
    const insertIdx = Math.max(
      0,
      Math.min(reorderedVisible.length, placeAfter ? targetIdx + 1 : targetIdx),
    );
    reorderedVisible.splice(insertIdx, 0, dragId);

    const result = new Array(list.length);
    const slots = [];
    for (let i = 0; i < list.length; i++) {
      const id = String(list[i] || "");
      if (visibleSet.has(id)) slots.push(i);
      else result[i] = id;
    }
    if (slots.length !== reorderedVisible.length) return false;
    for (let i = 0; i < slots.length; i++) {
      result[slots[i]] = reorderedVisible[i];
    }
    list.length = 0;
    list.push(...result);
    dirNode.preserveOrder = true;
    saveSessionFileOrderForDir(dirNode);
    return true;
  }

  const fromIdx = list.indexOf(dragId);
  if (fromIdx < 0) return false;
  list.splice(fromIdx, 1);
  let toIdx = list.indexOf(target);
  if (toIdx < 0) return false;
  if (placeAfter) toIdx += 1;
  toIdx = Math.max(0, Math.min(list.length, toIdx));
  list.splice(toIdx, 0, dragId);
  dirNode.preserveOrder = true;
  saveSessionFileOrderForDir(dirNode);
  return true;
}

function reverseFilesInDir(dirNode, opts = {}) {
  dirNode = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
  const list = dirNode.childrenFiles;
  if (list.length < 2) return false;

  const visible = Array.isArray(opts.visibleIds)
    ? opts.visibleIds.map((id) => String(id || ""))
    : null;
  if (visible && visible.length) {
    const visibleSet = new Set(visible);
    const reversedVisible = visible.slice().reverse();
    const result = new Array(list.length);
    const slots = [];
    for (let i = 0; i < list.length; i++) {
      const id = String(list[i] || "");
      if (visibleSet.has(id)) slots.push(i);
      else result[i] = id;
    }
    if (slots.length !== reversedVisible.length) return false;
    for (let i = 0; i < slots.length; i++) {
      result[slots[i]] = reversedVisible[i];
    }
    list.length = 0;
    list.push(...result);
  } else {
    list.reverse();
  }

  dirNode.preserveOrder = true;
  saveSessionFileOrderForDir(dirNode);
  return true;
}
