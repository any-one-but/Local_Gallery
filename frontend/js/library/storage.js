/* Storage
   Stored folders, their stub nodes and the one picture loaded for each. */

function getStoredFolderPaths() {
  const out = [];
  const seen = new Set();
  const pushFrom = (mapLike) => {
    if (!mapLike || typeof mapLike.entries !== "function") return;
    for (const [rawPath, rawTags] of mapLike.entries()) {
      const path = normalizeDirPathValue(rawPath);
      const tags = normalizeTagList(rawTags);
      if (
        !path ||
        seen.has(path) ||
        isPathInsideInternalTrash(path) ||
        !tags.includes(STORAGE_TAG)
      )
        continue;
      seen.add(path);
      out.push(path);
    }
  };
  pushFrom(WS.meta && WS.meta.dirTags ? WS.meta.dirTags : null);
  pushFrom(WS.meta && WS.meta.pendingTagsByPath ? WS.meta.pendingTagsByPath : null);
  out.sort((a, b) => {
    const al = String(storageDisplayPathForPath(a) || a || "").toLowerCase();
    const bl = String(storageDisplayPathForPath(b) || b || "").toLowerCase();
    const cmp = al.localeCompare(bl);
    if (cmp) return cmp;
    return String(a || "").localeCompare(String(b || ""));
  });
  return out;
}

function makeStorageStubDirNode(path) {
  const normalizedPath = normalizeDirPathValue(path);
  if (!normalizedPath) return null;
  const parts = normalizedPath.split("/").filter(Boolean);
  const name = parts[parts.length - 1] || normalizedPath;
  const parentPath = parts.slice(0, -1).join("/");
  const parentNode = WS.dirByPath.get(parentPath) || WS.root || null;
  return {
    type: "dir",
    name,
    parent: parentNode,
    childrenDirs: [],
    childrenFiles: [],
    path: normalizedPath,
    preserveOrder: false,
    _storageStub: true,
    _storageGhost: true,
  };
}

function isStorageStubDirNode(node) {
  return !!node && !!node._storageStub;
}

function resolveDirNodeForPathOrStorageStub(path) {
  const normalizedPath = normalizeDirPathValue(path);
  if (!normalizedPath && normalizedPath !== "") return null;
  const loaded = WS.dirByPath.get(normalizedPath);
  if (loaded) return loaded;
  if (!metaHasStorage(normalizedPath)) return null;
  return makeStorageStubDirNode(normalizedPath);
}

function getAllStorageDirNodes() {
  return getStoredFolderPaths()
    .map((path) => makeStorageStubDirNode(path))
    .filter((node) => node && dirCanAppearUnderCurrentContentFilters(node));
}


/* A stored folder is left out of every scan, so nothing about it is loaded --
   except one picture, so its card shows what it is. That picture is the
   folder's pinned thumbnail when it has one; otherwise the first image found
   walking it in name order, which for a Model is its first Set's first image
   (a video when that Set holds no image). Blank shows the storage icon. The
   walk reads folder listings only and stops at the first folder holding media,
   and each folder is looked up once per workspace (STORAGE_STUB_THUMBS). */
const STORAGE_STUB_THUMBS = new Map(); // path -> Promise<{ src, kind } | null>
const STORAGE_STUB_THUMB_BLOB_URLS = new Set();

function resetStorageStubThumbs() {
  STORAGE_STUB_THUMB_BLOB_URLS.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  STORAGE_STUB_THUMB_BLOB_URLS.clear();
  STORAGE_STUB_THUMBS.clear();
}

function storageStubMediaType(name) {
  const n = String(name || "");
  if (!n || n[0] === ".") return "";
  if (isImageName(n)) return "image";
  if (isVideoName(n)) return "video";
  return "";
}

function compareStorageStubNames(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

async function firstStorageStubMediaEntry(dirHandle, depth, relDir) {
  const files = [];
  const dirs = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (!name || name[0] === ".") continue;
    if (handle.kind === "file") {
      const type = storageStubMediaType(name);
      if (type) files.push({ name, handle, type, dirPath: relDir });
    } else if (handle.kind === "directory" && depth > 0) {
      dirs.push({ name, handle });
    }
  }
  files.sort(compareStorageStubNames);
  const image = files.find((f) => f.type === "image");
  if (image) return image;
  if (files.length) return files[0];
  dirs.sort(compareStorageStubNames);
  for (let i = 0; i < dirs.length; i++) {
    const found = await firstStorageStubMediaEntry(
      dirs[i].handle,
      depth - 1,
      relDir ? `${relDir}/${dirs[i].name}` : dirs[i].name,
    );
    if (found) return found;
  }
  return null;
}

async function storageStubPinnedMediaEntry(rootHandle, relPath) {
  const parts = normalizeWorkspaceRelPath(relPath).split("/").filter(Boolean);
  const name = parts.pop();
  const type = storageStubMediaType(name);
  if (!type) return null;
  try {
    const dir = await getDirectoryHandleForPath(rootHandle, parts.join("/"));
    const handle = await dir.getFileHandle(name);
    return { name, handle, type, dirPath: parts.join("/") };
  } catch {
    return null;
  }
}

async function resolveStorageStubThumb(path) {
  const rootHandle = WS.meta && WS.meta.fsRootHandle;
  if (!rootHandle || !path) return null;
  const pinned = defaultThumbnailsOnlyEnabled()
    ? ""
    : String(
        (WS.meta.dirThumbPresets && WS.meta.dirThumbPresets.get(path)) ||
          (WS.meta.pendingDirThumbPresets &&
            WS.meta.pendingDirThumbPresets.get(path)) ||
          "",
      );
  if (pinned === FOLDER_THUMB_NONE_SENTINEL) return null;
  let entry = null;
  if (pinned && pinned !== FOLDER_THUMB_ROTATE_SENTINEL)
    entry = await storageStubPinnedMediaEntry(rootHandle, pinned);
  if (!entry) {
    let dir = null;
    try {
      dir = await getDirectoryHandleForPath(rootHandle, path);
    } catch {
      return null;
    }
    // A Model holds Sets, which hold the media: two levels is the whole tree.
    entry = await firstStorageStubMediaEntry(dir, 2, path);
  }
  if (!entry) return null;
  const file = await entry.handle.getFile();
  if (!file) return null;
  // Stands in for the file's record, which a stored folder never has: enough
  // for its thumbnail edits (crop and zoom, a video's frame), which are keyed
  // by the file's path.
  const rec = storageStubThumbRecord(entry);
  if (tauriThumbnailsActive()) {
    // The app makes a small copy of either kind, as it does for every tile.
    const nativePath = getNativePathForFile(file);
    if (!nativePath) return null;
    const frameTime =
      entry.type === "video" ? metaGetVideoThumbnailTimeForRecord(rec) : null;
    const edge = fullResThumbnailsEnabled() ? FULL_QUALITY_THUMB_EDGE : TAURI_THUMB_EDGE;
    const src = await window.__lg.requestThumb(nativePath, edge, frameTime);
    return src ? { src: String(src), kind: "img", rec } : null;
  }
  const src = ensureMediaUrl({ file, type: entry.type });
  if (!src) return null;
  if (src.startsWith("blob:")) STORAGE_STUB_THUMB_BLOB_URLS.add(src);
  return { src, kind: entry.type === "video" ? "video" : "img", rec };
}

function storageStubThumbRecord(entry) {
  const dirPath = normalizeWorkspaceRelPath(entry.dirPath || "");
  const relPath = dirPath ? `${dirPath}/${entry.name}` : entry.name;
  const dot = entry.name.lastIndexOf(".");
  return {
    id: `storage::${relPath}`,
    name: entry.name,
    relPath,
    dirPath,
    ext: dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "",
    type: entry.type,
  };
}

function storageStubThumb(path) {
  const key = normalizeDirPathValue(path);
  if (!STORAGE_STUB_THUMBS.has(key))
    STORAGE_STUB_THUMBS.set(key, resolveStorageStubThumb(key).catch(() => null));
  return STORAGE_STUB_THUMBS.get(key);
}

// Puts the stored folder's picture in place of the card's icon slot once it
// has been found. The card may have been redrawn by then, which is fine: the
// new card asked for the same cached answer.
function mountStorageStubThumb(card, slot, path, label) {
  if (!mediaThumbnailsEnabled()) return;
  storageStubThumb(path).then((thumb) => {
    // The slot may sit in the card's picture square (card-pictures.js) rather
    // than directly in the card.
    if (!thumb || !slot.isConnected || !card.contains(slot)) return;
    let el = null;
    if (thumb.kind === "video") {
      el = document.createElement("video");
      el.muted = true;
      el.playsInline = true;
      el.preload = "metadata";
      el.src = `${thumb.src}#t=0.1`;
    } else {
      el = document.createElement("img");
      el.decoding = "async";
      el.alt = label;
      el.src = thumb.src;
    }
    el.className = "folderThumb";
    el.draggable = false;
    el.style.objectFit = "cover";
    // The file's own crop and zoom, as on any other card.
    if (thumb.rec && applyFileThumbCropStyle(el, thumb.rec))
      attachFileThumbCropAspectReapply(el, thumb.rec);
    slot.replaceWith(el);
  });
}

// Storage portal rows must remain metadata-only. Use the stored workspace-relative
// path directly instead of reconstructing an absolute path from loaded media records.
function storageDisplayPathForPath(path) {
  const normalizedPath = normalizeDirPathValue(path);
  if (!normalizedPath && normalizedPath !== "") return "";
  return String(normalizedPath || "");
}

function dirUiLabel(node) {
  if (isStorageStubDirNode(node)) {
    return (
      storageDisplayPathForPath(String(node?.path || "")) ||
      dirDisplayName(node) ||
      "folder"
    );
  }
  const trashLabel = trashItemDisplayPathForPath(String(node?.path || ""));
  if (trashLabel) return trashLabel;
  return dirDisplayName(node) || "folder";
}
