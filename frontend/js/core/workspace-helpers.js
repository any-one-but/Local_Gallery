/* Workspace helpers
   Bulk selection basics, carrying video state, root inference and the seeded
   shuffles. */

/* =========================================================
       Workspace loading (read-only input)
       ========================================================= */
function getBulkSelectionKey() {
  if (isViewingTagFolder()) {
    return `tag:${String(WS.view.tagFolderActiveMode || "")}:${String(WS.view.tagFolderActiveTag || "")}:${String(WS.view.tagFolderActiveAlbum || "")}:${String(WS.view.tagFolderOriginPath || "")}`;
  }
  if (searchSessionActive() && WS.view.searchRootActive) {
    const rootType = WS.view.searchRootIsFavorites
      ? "favorites"
      : WS.view.searchRootIsHidden
        ? "hidden"
        : "folder";
    const rootPath = String(WS.view.searchRootPath || "");
    const query = String(WS.view.dirSearchQuery || "")
      .trim()
      .toLowerCase();
    return `search:${rootType}:${rootPath}:${query}`;
  }
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
  const dn = WS.nav.dirNode;
  return dn ? String(dn.path || "") : "";
}

function clearBulkTagSelection() {
  clearBulkTagPlaceholder();
  closeActionMenus();
  if (WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.clear)
    WS.view.bulkTagSelectedPaths.clear();
  if (
    WS.view.bulkTagFolderSelectedKeys &&
    WS.view.bulkTagFolderSelectedKeys.clear
  )
    WS.view.bulkTagFolderSelectedKeys.clear();
  if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear)
    WS.view.bulkFileSelectedIds.clear();
}

function finalizeBulkSelectionAction() {
  if (
    !WS.view.bulkSelectMode &&
    !(WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.size) &&
    !(
      WS.view.bulkTagFolderSelectedKeys &&
      WS.view.bulkTagFolderSelectedKeys.size
    ) &&
    !(WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.size)
  ) {
    return;
  }
  WS.view.bulkSelectMode = false;
  clearBulkTagSelection();
  // Rows and cards keep their baked-in highlight class until a full rebuild
  // (selection changes only patch DOM in place), so strip it directly —
  // otherwise a bulk action that re-rendered mid-flight (e.g. put back from
  // trash) leaves ghost borders no click can remove.
  document.querySelectorAll(".bulkSelected").forEach((el) => {
    el.classList.remove("bulkSelected");
  });
}

function hasBulkSelection() {
  return !!(
    WS.view &&
    WS.view.bulkSelectMode &&
    ((WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.size) ||
      (WS.view.bulkTagFolderSelectedKeys &&
        WS.view.bulkTagFolderSelectedKeys.size) ||
      (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.size))
  );
}

function syncBulkSelectionForCurrentDir() {
  const p = getBulkSelectionKey();
  if (!WS.view.bulkTagSelectionsByDir)
    WS.view.bulkTagSelectionsByDir = new Map();
  if (!WS.view.bulkTagSelectionsByDir.has(p))
    WS.view.bulkTagSelectionsByDir.set(p, new Set());
  WS.view.bulkTagSelectedPaths = WS.view.bulkTagSelectionsByDir.get(p);
  if (!WS.view.bulkTagFolderSelectionsByDir)
    WS.view.bulkTagFolderSelectionsByDir = new Map();
  if (!WS.view.bulkTagFolderSelectionsByDir.has(p))
    WS.view.bulkTagFolderSelectionsByDir.set(p, new Set());
  WS.view.bulkTagFolderSelectedKeys =
    WS.view.bulkTagFolderSelectionsByDir.get(p);
  if (!WS.view.bulkFileSelectionsByDir)
    WS.view.bulkFileSelectionsByDir = new Map();
  if (!WS.view.bulkFileSelectionsByDir.has(p))
    WS.view.bulkFileSelectionsByDir.set(p, new Set());
  WS.view.bulkFileSelectedIds = WS.view.bulkFileSelectionsByDir.get(p);
}

function applyVideoCarryToElement(vid, fileId, opts = {}) {
  if (!vid) return;
  if (!VIDEO_CARRY.active) return;
  if ((VIDEO_CARRY.fileId || "") !== (fileId || "")) return;

  const t = VIDEO_CARRY.time || 0;
  const wp = !!VIDEO_CARRY.wasPlaying;
  const allowPlay = opts.allowPlay !== false;

  const doApply = () => {
    try {
      if (isFinite(t)) vid.currentTime = t;
    } catch {}
    if (wp && allowPlay) {
      try {
        vid.play();
      } catch {}
    } else {
      try {
        vid.pause();
      } catch {}
    }
    VIDEO_CARRY.active = false;
    VIDEO_CARRY.fileId = null;
    VIDEO_CARRY.time = 0;
    VIDEO_CARRY.wasPlaying = false;
  };

  if (vid.readyState >= 1) {
    setTimeout(doApply, 0);
    return;
  }

  const once = () => {
    try {
      vid.removeEventListener("loadedmetadata", once);
    } catch {}
    doApply();
  };
  try {
    vid.addEventListener("loadedmetadata", once);
  } catch {}
}

function normalizeVideoPlaybackRate(vid) {
  if (!vid) return;
  try {
    vid.defaultPlaybackRate = 1;
    vid.playbackRate = 1;
  } catch {}
}

function ensureDirPath(path) {
  const norm = path || "";
  if (WS.dirByPath.has(norm)) return WS.dirByPath.get(norm);

  const segments = norm.split("/").filter(Boolean);
  let cur = WS.root;
  let accum = "";
  for (const seg of segments) {
    accum = accum ? accum + "/" + seg : seg;
    let node = WS.dirByPath.get(accum);
    if (!node) {
      node = makeDirNode(seg, cur);
      node.path = accum;
      WS.dirByPath.set(accum, node);
      cur.childrenDirs.push(node);
    }
    cur = node;
  }
  return cur;
}

function inferRootNameFromFileList(fileList) {
  let rootName = "";
  for (const f of Array.from(fileList || [])) {
    if (!f || !f.name) continue;
    const relPath = String(f.webkitRelativePath || f.name || "");
    if (!relPath) continue;
    const parts = relPath.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    const top = String(parts[0] || "").trim();
    if (!top) continue;
    if (!rootName) {
      rootName = top;
      continue;
    }
    if (rootName !== top) return "root";
  }
  return rootName || "root";
}

function normalizeRootIfSingleDir() {
  const rootDirs = WS.root.childrenDirs;
  const rootFiles = WS.root.childrenFiles;
  if (rootDirs.some((dirNode) => isInternalTrashDirNode(dirNode))) return;
  if (rootDirs.length === 1 && rootFiles.length === 0) {
    const actual = rootDirs[0];
    actual.parent = null;
    actual.path = "";
    WS.root = actual;

    WS.dirByPath.clear();
    WS.dirByPath.set("", WS.root);
    (function reindex(node, basePath) {
      node.path = basePath;
      for (const d of node.childrenDirs) {
        const p = basePath ? basePath + "/" + d.name : d.name;
        WS.dirByPath.set(p, d);
        reindex(d, p);
      }
    })(WS.root, "");
  }
}

function hash32(str) {
  let h = 2166136261 >>> 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seed) {
  let x = seed >>> 0 || 1;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function shuffleWithSeed(arr, seed) {
  const rnd = makeRng(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function computeWorkspaceSeed() {
  if (
    WS.catalog &&
    WS.catalog.enabled &&
    WS.catalog.fileLocationsById &&
    WS.catalog.fileLocationsById.size
  ) {
    const keys = Array.from(WS.catalog.fileLocationsById.keys()).slice().sort();
    let h = 2166136261 >>> 0;
    for (let i = 0; i < keys.length; i++) {
      h ^= hash32(keys[i]);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  const keys = Array.from(WS.fileById.keys()).slice().sort();
  let h = 2166136261 >>> 0;
  for (let i = 0; i < keys.length; i++) {
    h ^= hash32(keys[i]);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
