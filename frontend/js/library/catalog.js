/* Catalog
   The on-disk catalog for deferred loading of large libraries. */

const CATALOG_SCHEMA_VERSION = 1;
const CATALOG_DIR_NAME = "catalog";
const CATALOG_FOLDERS_DIR_NAME = "folders";
const CATALOG_INDEX_FILE_NAME = "index.json";

function catalogShardNameForPath(path) {
  const normalized = normalizeDirPathValue(path);
  const key = normalized || "__root__";
  return `${hash32(key).toString(36)}.json`;
}

async function writeJsonFileHandle(fileHandle, obj) {
  if (!fileHandle) return false;
  try {
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(obj));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function readJsonFileHandle(fileHandle) {
  if (!fileHandle) return null;
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    return JSON.parse(text || "null");
  } catch {
    return null;
  }
}

async function ensureCatalogHandles(rootHandle) {
  if (!rootHandle) return null;
  let sys;
  if (window.__lg && typeof window.__lg.getAppMetaDirectoryHandle === "function") {
    try { sys = await window.__lg.getAppMetaDirectoryHandle(); } catch {}
  }
  if (!sys) {
    sys = await rootHandle.getDirectoryHandle(".local-gallery", { create: true });
  }
  const catalog = await sys.getDirectoryHandle(CATALOG_DIR_NAME, {
    create: true,
  });
  const folders = await catalog.getDirectoryHandle(CATALOG_FOLDERS_DIR_NAME, {
    create: true,
  });
  const indexFile = await catalog.getFileHandle(CATALOG_INDEX_FILE_NAME, {
    create: true,
  });
  return { catalog, folders, indexFile };
}

async function readExistingCatalogForRootHandle(rootHandle) {
  if (!rootHandle) return null;
  try {
    let sys;
    if (window.__lg && typeof window.__lg.getAppMetaDirectoryHandle === "function") {
      try { sys = await window.__lg.getAppMetaDirectoryHandle(); } catch {}
    }
    if (!sys) {
      sys = await rootHandle.getDirectoryHandle(".local-gallery");
    }
    const catalog = await sys.getDirectoryHandle(CATALOG_DIR_NAME);
    const folders = await catalog.getDirectoryHandle(CATALOG_FOLDERS_DIR_NAME);
    const indexFile = await catalog.getFileHandle(CATALOG_INDEX_FILE_NAME);
    const index = await readJsonFileHandle(indexFile);
    if (!index || index.schema !== CATALOG_SCHEMA_VERSION || !index.complete)
      return null;
    if (!index.folders || typeof index.folders !== "object") return null;
    return { index, handles: { catalog, folders, indexFile } };
  } catch {
    return null;
  }
}

function showBlockingLoaderOverlay(_label, _detail = "") {
  showBusyOverlay();
}

function updateBlockingLoaderOverlay(_label, _detail = "") {
  // Keep the overlay up, but never rewrite the label with paths/progress —
  // the busy screen is fixed "Loading" only.
  BUSY_OVERLAY_PENDING_HIDE = false;
  if (busyLabel) busyLabel.textContent = "Loading";
  if (busyDetail) busyDetail.textContent = "";
  if (busyOverlay && !busyOverlay.classList.contains("active")) {
    busyOverlay.classList.add("active");
    busyOverlay.setAttribute("aria-busy", "true");
  }
}

function hideBlockingLoaderOverlay() {
  hideBusyOverlay();
}

async function waitForBusyOverlayPaint() {
  if (!busyOverlay || !busyOverlay.classList.contains("active")) return;
  if (typeof waitForNextPaint === "function") await waitForNextPaint();
}

function formatBusyProgressDetail(_countText = "", _path = "") {
  return "";
}

function updateBusyProgress(_label, _countText = "", _path = "", force = false, state = null) {
  const tracker = state && typeof state === "object" ? state : null;
  if (tracker) {
    const now = Date.now();
    if (!force && now - Number(tracker.lastUpdate || 0) < 80) return;
    tracker.lastUpdate = now;
  }
  updateBlockingLoaderOverlay();
}

function catalogEmptyAspectCounts() {
  return { portrait: 0, square: 0, landscape: 0, unknown: 0 };
}

function catalogCloneAspectCounts(counts) {
  const src = counts && typeof counts === "object" ? counts : {};
  return {
    portrait: Math.max(0, Number(src.portrait) || 0),
    square: Math.max(0, Number(src.square) || 0),
    landscape: Math.max(0, Number(src.landscape) || 0),
    unknown: Math.max(0, Number(src.unknown) || 0),
  };
}

function catalogEmptyMediaAspectCounts() {
  return {
    images: catalogEmptyAspectCounts(),
    videos: catalogEmptyAspectCounts(),
    text: catalogEmptyAspectCounts(),
  };
}

function catalogCloneMediaAspectCounts(counts) {
  const src = counts && typeof counts === "object" ? counts : {};
  return {
    images: catalogCloneAspectCounts(src.images),
    videos: catalogCloneAspectCounts(src.videos),
    text: catalogCloneAspectCounts(src.text),
  };
}

function catalogAddAspectCounts(target, source) {
  if (!target || !source) return target;
  target.portrait += Math.max(0, Number(source.portrait) || 0);
  target.square += Math.max(0, Number(source.square) || 0);
  target.landscape += Math.max(0, Number(source.landscape) || 0);
  target.unknown += Math.max(0, Number(source.unknown) || 0);
  return target;
}

function catalogAddMediaAspectCounts(target, source) {
  if (!target || !source) return target;
  catalogAddAspectCounts(target.images, source.images);
  catalogAddAspectCounts(target.videos, source.videos);
  catalogAddAspectCounts(target.text, source.text);
  return target;
}

function catalogRecordMediaBucketFromDescriptor(desc) {
  if (!desc) return "";
  if (desc.type === "video") return "videos";
  if (desc.type === "image") return "images";
  if (desc.type === "markdown") return "text";
  return "";
}

function catalogIncrementAspectStats(aspectCounts, mediaAspectCounts, desc) {
  const bucket = String(desc && desc.aspectRatioBucket || "") || "unknown";
  const key = bucket === "portrait" || bucket === "square" || bucket === "landscape"
    ? bucket
    : "unknown";
  if (aspectCounts && Object.prototype.hasOwnProperty.call(aspectCounts, key)) {
    aspectCounts[key]++;
  }
  const mediaBucket = catalogRecordMediaBucketFromDescriptor(desc);
  const mediaCounts = mediaAspectCounts && mediaAspectCounts[mediaBucket];
  if (mediaCounts && Object.prototype.hasOwnProperty.call(mediaCounts, key)) {
    mediaCounts[key]++;
  }
}

function catalogAspectEntryMatchesDescriptor(entry, desc) {
  if (!entry || !desc) return false;
  const entryPath = normalizeWorkspaceRelPath(entry.relPath);
  const descPath = normalizeWorkspaceRelPath(desc.relPath);
  if (!entryPath || entryPath !== descPath) return false;
  const entrySize = Number(entry.size);
  const descSize = Number(desc.size);
  if (Number.isFinite(entrySize) && Number.isFinite(descSize) && entrySize !== descSize)
    return false;
  const entryModified = Number(entry.lastModified);
  const descModified = Number(desc.lastModified);
  if (
    Number.isFinite(entryModified) &&
    Number.isFinite(descModified) &&
    Math.abs(entryModified - descModified) > ASPECT_RATIO_LOG_MTIME_TOLERANCE_MS
  ) {
    return false;
  }
  const entryType = String(entry.type || "");
  if (entryType && desc.type && entryType !== desc.type) return false;
  return Number(entry.aspectRatio) > 0;
}

function catalogApplyAspectEntryToDescriptor(desc, entry) {
  if (!desc || !catalogAspectEntryMatchesDescriptor(entry, desc)) return desc;
  const aspect = normalizePreviewAspect(Number(entry.aspectRatio), 4 / 3);
  desc.aspectRatio = aspect;
  desc.aspectRatioBucket = String(entry.bucket || aspectRatioBucketForValue(aspect) || "");
  return desc;
}

function catalogAspectEntriesFromLog(log) {
  const out = new Map();
  if (!log || typeof log !== "object") return out;
  const filesByPath =
    log.filesByPath && typeof log.filesByPath === "object"
      ? log.filesByPath
      : log.aspectRatioByPath && typeof log.aspectRatioByPath === "object"
        ? log.aspectRatioByPath
        : log.aspectRatiosByPath && typeof log.aspectRatiosByPath === "object"
          ? log.aspectRatiosByPath
          : {};
  for (const rawPath of Object.keys(filesByPath)) {
    const relPath = normalizeWorkspaceRelPath(rawPath);
    const entry = normalizeAspectRatioLogEntry(relPath, filesByPath[rawPath]);
    if (!relPath || !entry) continue;
    out.set(relPath, entry);
  }
  return out;
}

async function readCatalogAspectEntriesByPath(rootHandle) {
  let log = await metaLoadFsDoc(metaFsHandleForDocId(META_DOC_IDS.aspectRatios));
  if (!log && rootHandle) {
    try {
      const sys = await rootHandle.getDirectoryHandle(".local-gallery");
      const fh = await sys.getFileHandle(META_DOC_FILE_NAMES[META_DOC_IDS.aspectRatios]);
      log = await metaLoadFsDoc(fh);
    } catch {}
  }
  return catalogAspectEntriesFromLog(log);
}

function catalogLightIndexEntryFromDescriptor(desc) {
  if (!desc) return null;
  return {
    id: String(desc.id || ""),
    relPath: normalizeWorkspaceRelPath(desc.relPath),
    name: String(desc.name || ""),
    dirPath: normalizeDirPathValue(desc.dirPath || ""),
    ext: String(desc.ext || ""),
    type: desc.type === "video" ? "video" : desc.type === "image" ? "image" : desc.type === "markdown" ? "markdown" : "",
    size: Math.max(0, Number(desc.size) || 0),
    lastModified: Math.max(0, Number(desc.lastModified) || 0),
    aspectRatio: Number(desc.aspectRatio) > 0 ? Number(desc.aspectRatio) : null,
    aspectRatioBucket: String(desc.aspectRatioBucket || ""),
  };
}

function registerCatalogLightIndexEntry(entry) {
  const d = normalizeCatalogFileDescriptor(entry);
  if (!d || !WS.catalog) return null;
  WS.catalog.fileLightIndexById.set(d.id, d);
  WS.catalog.fileLightIndexByRelPath.set(d.relPath, d);
  registerCatalogFileDescriptor(d, {
    id: d.id,
    relPath: d.relPath,
    dirPath: d.dirPath,
    shardName: entry && entry.shardName,
  });
  return d;
}

function fileDescriptorFromFile(file, relPath, aspectEntriesByPath = null) {
  const normalizedRelPath = normalizeWorkspaceRelPath(relPath);
  if (!file || !normalizedRelPath) return null;
  const filename = normalizedRelPath.split("/").filter(Boolean).pop() || file.name;
  const isImg = isImageName(filename);
  const isVid = isVideoName(filename);
  if (!isImg && !isVid && !isMarkdownName(filename)) return null;
  const extDot = filename.lastIndexOf(".");
  const ext = extDot >= 0 ? filename.slice(extDot).toLowerCase() : "";
  const desc = {
    id: fileKey(file, normalizedRelPath),
    relPath: normalizedRelPath,
    name: filename,
    dirPath: normalizedRelPath.split("/").slice(0, -1).join("/"),
    ext,
    type: fileTypeForName(filename),
    size: Number(file.size) || 0,
    lastModified: Number(file.lastModified) || 0,
    aspectRatio: null,
    aspectRatioBucket: "",
  };
  const aspectEntry = aspectEntriesByPath && aspectEntriesByPath.get(normalizedRelPath);
  return catalogApplyAspectEntryToDescriptor(desc, aspectEntry);
}

function normalizeCatalogFileDescriptor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const relPath = normalizeWorkspaceRelPath(raw.relPath);
  const name = String(raw.name || relPath.split("/").pop() || "");
  const type = String(raw.type || "");
  if (!relPath || !name || (type !== "image" && type !== "video" && type !== "markdown")) return null;
  const id = String(raw.id || `${name}::${Number(raw.lastModified) || 0}::${Number(raw.size) || 0}::${relPath}`);
  if (!id) return null;
  return {
    id,
    relPath,
    name,
    dirPath: normalizeDirPathValue(raw.dirPath || relPath.split("/").slice(0, -1).join("/")),
    ext: String(raw.ext || ""),
    type,
    size: Math.max(0, Number(raw.size) || 0),
    lastModified: Math.max(0, Number(raw.lastModified) || 0),
    aspectRatio: Number(raw.aspectRatio) > 0 ? Number(raw.aspectRatio) : null,
    aspectRatioBucket: String(raw.aspectRatioBucket || ""),
  };
}

function createFileRecordFromDescriptor(desc, file = null) {
  const d = normalizeCatalogFileDescriptor(desc);
  if (!d) return null;
  return {
    id: d.id,
    file: file || null,
    name: d.name,
    relPath: d.relPath,
    dirPath: d.dirPath,
    ext: d.ext,
    type: d.type,
    size: d.size,
    lastModified: d.lastModified,
    url: null,
    thumbUrl: null,
    videoThumbUrl: null,
    indices: null,
    thumbMode: null,
    videoThumbMode: null,
    nativePath: "",
    aspectRatio: d.aspectRatio,
    aspectRatioBucket: d.aspectRatioBucket || "",
    catalogBacked: true,
  };
}

function registerCatalogFileDescriptor(desc, location = null) {
  const d = normalizeCatalogFileDescriptor(desc);
  if (!d || !WS.catalog) return null;
  WS.catalog.fileDescriptorsById.set(d.id, d);
  WS.catalog.fileDescriptorsByRelPath.set(d.relPath, d);
  const loc =
    location && typeof location === "object"
      ? Object.assign({}, location, {
          id: d.id,
          relPath: d.relPath,
          dirPath: d.dirPath,
        })
      : { id: d.id, relPath: d.relPath, dirPath: d.dirPath };
  WS.catalog.fileLocationsById.set(d.id, loc);
  WS.catalog.fileLocationsByRelPath.set(d.relPath, loc);
  return d;
}

function getFileDescriptor(id) {
  const key = String(id || "");
  return key && WS.catalog ? WS.catalog.fileDescriptorsById.get(key) || null : null;
}

function getFileDescriptorByRelPath(relPath) {
  const key = normalizeWorkspaceRelPath(relPath);
  return key && WS.catalog
    ? WS.catalog.fileDescriptorsByRelPath.get(key) || null
    : null;
}

function ensureFileRecordFromDescriptor(desc, file = null) {
  const d = registerCatalogFileDescriptor(desc);
  if (!d) return null;
  let rec = WS.fileById.get(d.id) || null;
  if (!rec) {
    rec = createFileRecordFromDescriptor(d, file);
    if (!rec) return null;
    WS.fileById.set(rec.id, rec);
  } else if (file && !rec.file) {
    rec.file = file;
    rec.size = Number(file.size) || rec.size;
    rec.lastModified = Number(file.lastModified) || rec.lastModified;
  }
  return rec;
}

function getCatalogFolderSummary(path) {
  const p = normalizeDirPathValue(path);
  if (!WS.catalog || !WS.catalog.folderSummaries) return null;
  return WS.catalog.folderSummaries.get(p) || null;
}

function getCatalogSummaryForNode(node) {
  if (!node) return null;
  return node.summary || getCatalogFolderSummary(node.path || "");
}

function applyCatalogSummaryToDirNode(node, summary) {
  if (!node || !summary) return node;
  node.summary = summary;
  node.catalogPathKey = String(summary.path || "");
  node.directFileCount = Math.max(0, Number(summary.directFileCount) || 0);
  node.directFolderCount = Math.max(0, Number(summary.directFolderCount) || 0);
  node.recursiveFileCount = Math.max(0, Number(summary.recursiveFileCount) || 0);
  node.recursiveFolderCount = Math.max(0, Number(summary.recursiveFolderCount) || 0);
  node.recursiveItemCount = Math.max(0, Number(summary.recursiveItemCount) || 0);
  node.recursiveImageCount = catalogSummaryMediaBucketCountForTagFilter(
    summary,
    "images",
  );
  node.recursiveVideoCount = catalogSummaryMediaBucketCountForTagFilter(
    summary,
    "videos",
  );
  node.recursiveTextCount = catalogSummaryMediaBucketCountForTagFilter(
    summary,
    "text",
  );
  node.recursiveSizeBytes = Math.max(0, Number(summary.recursiveSizeBytes) || 0);
  if (!node.loadState) node.loadState = "summary";
  if (summary.leadFile) registerCatalogFileDescriptor(summary.leadFile, {
    shardName: summary.shardName,
    dirPath: normalizeDirPathValue(summary.leadFile.dirPath),
  });
  if (summary.directLeadFile) registerCatalogFileDescriptor(summary.directLeadFile, {
    shardName: summary.shardName,
    dirPath: normalizeDirPathValue(summary.directLeadFile.dirPath),
  });
  return node;
}

function ensureCatalogDirNode(path) {
  const normalized = normalizeDirPathValue(path);
  if (!normalized) return WS.root;
  const existing = WS.dirByPath.get(normalized);
  if (existing) return existing;
  const parts = normalized.split("/").filter(Boolean);
  let parent = WS.root;
  let accum = "";
  for (let i = 0; i < parts.length; i++) {
    accum = accum ? `${accum}/${parts[i]}` : parts[i];
    let node = WS.dirByPath.get(accum);
    if (!node) {
      node = makeDirNode(parts[i], parent || null);
      node.path = accum;
      node.loadState = "summary";
      applyCatalogSummaryToDirNode(node, getCatalogFolderSummary(accum));
      WS.dirByPath.set(accum, node);
      if (parent && Array.isArray(parent.childrenDirs) && !parent.childrenDirs.includes(node)) {
        parent.childrenDirs.push(node);
      }
    }
    parent = node;
  }
  return parent;
}

function ensureDirectoryChildNodesFromCatalog(dirNode) {
  if (!dirNode) return [];
  const summary = getCatalogSummaryForNode(dirNode);
  const childPaths = Array.isArray(summary?.childDirPaths)
    ? summary.childDirPaths
    : [];
  if (!childPaths.length) return Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [];
  const seen = new Set((dirNode.childrenDirs || []).map((child) => String(child?.path || "")));
  for (let i = 0; i < childPaths.length; i++) {
    const childPath = normalizeDirPathValue(childPaths[i]);
    if (!childPath || seen.has(childPath)) continue;
    const child = ensureCatalogDirNode(childPath);
    if (child && !dirNode.childrenDirs.includes(child)) dirNode.childrenDirs.push(child);
    seen.add(childPath);
  }
  foldAltFoldersInNode(dirNode);
  applySavedFolderAlts(dirNode);
  // Folders arriving late out of the catalog take back whatever the logs
  // remembered for their paths, the same way a restored folder does. Cheap
  // when there is nothing waiting, which is the usual case.
  metaPromotePendingFolderMetadata();
  return dirNode.childrenDirs;
}

function installCatalogIndex(index, rootHandle, folderShardDirHandle) {
  WS.catalog.enabled = false;
  WS.catalog.index = null;
  WS.catalog.rootHandle = null;
  WS.catalog.folderShardDirHandle = null;
  WS.catalog.folderSummaries.clear();
  WS.catalog.fileLocationsById.clear();
  WS.catalog.fileLocationsByRelPath.clear();
  WS.catalog.fileDescriptorsById.clear();
  WS.catalog.fileDescriptorsByRelPath.clear();
  WS.catalog.fileLightIndexById.clear();
  WS.catalog.fileLightIndexByRelPath.clear();
  WS.catalog.folderShardCache.clear();
  const summaries = index && index.folders && typeof index.folders === "object"
    ? index.folders
    : {};
  for (const rawPath of Object.keys(summaries)) {
    const path = normalizeDirPathValue(rawPath);
    const summary = Object.assign({}, summaries[rawPath] || {}, { path });
    summary.directAspectCounts = catalogCloneAspectCounts(summary.directAspectCounts);
    summary.recursiveAspectCounts = catalogCloneAspectCounts(summary.recursiveAspectCounts);
    summary.directMediaAspectCounts = catalogCloneMediaAspectCounts(summary.directMediaAspectCounts);
    summary.recursiveMediaAspectCounts = catalogCloneMediaAspectCounts(summary.recursiveMediaAspectCounts);
    WS.catalog.folderSummaries.set(path, summary);
    if (summary.leadFile) registerCatalogFileDescriptor(summary.leadFile, {
      shardName: summary.shardName,
      dirPath: normalizeDirPathValue(summary.leadFile.dirPath),
    });
    if (summary.directLeadFile) registerCatalogFileDescriptor(summary.directLeadFile, {
      shardName: summary.shardName,
      dirPath: normalizeDirPathValue(summary.directLeadFile.dirPath),
    });
  }
  const byId = index && index.fileLocationsById && typeof index.fileLocationsById === "object"
    ? index.fileLocationsById
    : {};
  for (const id of Object.keys(byId)) {
    const loc = Object.assign({}, byId[id] || {}, { id });
    if (loc.id) WS.catalog.fileLocationsById.set(String(loc.id), loc);
    if (loc.relPath) WS.catalog.fileLocationsByRelPath.set(normalizeWorkspaceRelPath(loc.relPath), loc);
  }
  const lightById = index && index.fileLightIndexById && typeof index.fileLightIndexById === "object"
    ? index.fileLightIndexById
    : {};
  for (const id of Object.keys(lightById)) {
    registerCatalogLightIndexEntry(Object.assign({}, lightById[id] || {}, { id }));
  }
}

function ensureCatalogIndexObjects() {
  if (!WS.catalog) return null;
  if (!WS.catalog.index || typeof WS.catalog.index !== "object") {
    WS.catalog.index = {
      schema: CATALOG_SCHEMA_VERSION,
      complete: true,
      updatedAt: Date.now(),
      rootName: String(WS.root?.name || "root"),
      rootSummary: null,
      folders: {},
      fileLocationsById: {},
      fileLightIndexById: {},
      stats: {},
    };
  }
  const index = WS.catalog.index;
  if (!index.folders || typeof index.folders !== "object") index.folders = {};
  if (!index.fileLocationsById || typeof index.fileLocationsById !== "object")
    index.fileLocationsById = {};
  if (!index.fileLightIndexById || typeof index.fileLightIndexById !== "object")
    index.fileLightIndexById = {};
  index.schema = CATALOG_SCHEMA_VERSION;
  index.complete = true;
  return index;
}

function emptyCatalogFolderSummary(path, rootName = "") {
  const p = normalizeDirPathValue(path);
  return {
    path: p,
    name: p ? p.split("/").filter(Boolean).pop() || p : String(rootName || WS.catalog?.index?.rootName || WS.root?.name || "root"),
    parentPath: p.split("/").slice(0, -1).join("/"),
    shardName: catalogShardNameForPath(p),
    childDirPaths: [],
    directFileCount: 0,
    directFolderCount: 0,
    recursiveFileCount: 0,
    recursiveFolderCount: 0,
    recursiveItemCount: 0,
    recursiveImageCount: 0,
    recursiveVideoCount: 0,
    recursiveTextCount: 0,
    recursiveSizeBytes: 0,
    directAspectCounts: catalogEmptyAspectCounts(),
    recursiveAspectCounts: catalogEmptyAspectCounts(),
    directMediaAspectCounts: catalogEmptyMediaAspectCounts(),
    recursiveMediaAspectCounts: catalogEmptyMediaAspectCounts(),
    directLeadFile: null,
    leadFile: null,
  };
}

async function createEmptyCatalogForRootHandle(rootHandle) {
  const handles = await ensureCatalogHandles(rootHandle);
  const rootName = String(rootHandle?.name || "root");
  const rootSummary = emptyCatalogFolderSummary("", rootName);
  const rootShard = {
    schema: CATALOG_SCHEMA_VERSION,
    path: "",
    childDirPaths: [],
    files: [],
  };
  const rootShardHandle = await handles.folders.getFileHandle(
    rootSummary.shardName,
    { create: true },
  );
  await writeJsonFileHandle(rootShardHandle, rootShard);
  const index = {
    schema: CATALOG_SCHEMA_VERSION,
    complete: true,
    updatedAt: Date.now(),
    rootName,
    rootSummary,
    folders: { "": rootSummary },
    fileLocationsById: {},
    fileLightIndexById: {},
    stats: { dirs: 1, files: 0, bytes: 0, entries: 0, allFiles: 0 },
  };
  await writeJsonFileHandle(handles.indexFile, index);
  return { index, handles };
}

async function writeCatalogIndexNow() {
  const index = ensureCatalogIndexObjects();
  if (!index) return false;
  index.updatedAt = Date.now();
  if (index.folders && index.folders[""]) index.rootSummary = index.folders[""];
  try {
    const handles = await ensureCatalogHandles(
      WS.catalog.rootHandle || WS.meta.fsRootHandle,
    );
    WS.catalog.folderShardDirHandle = handles.folders;
    return await writeJsonFileHandle(handles.indexFile, index);
  } catch {
    return false;
  }
}

function catalogDescriptorWithRelPath(desc, relPath) {
  const source = normalizeCatalogFileDescriptor(desc);
  const normalizedRelPath = normalizeWorkspaceRelPath(relPath);
  if (!source || !normalizedRelPath) return null;
  const name = normalizedRelPath.split("/").filter(Boolean).pop() || source.name;
  const extDot = name.lastIndexOf(".");
  const next = Object.assign({}, source, {
    name,
    relPath: normalizedRelPath,
    dirPath: normalizedRelPath.split("/").slice(0, -1).join("/"),
    ext: extDot >= 0 ? name.slice(extDot).toLowerCase() : "",
  });
  next.id = fileKeyForRecord(next, normalizedRelPath);
  return normalizeCatalogFileDescriptor(next);
}

function catalogRemapDescriptorPath(desc, oldPrefix, newPrefix) {
  const source = normalizeCatalogFileDescriptor(desc);
  if (!source) return null;
  const nextRelPath = remapPathPrefix(oldPrefix, newPrefix, source.relPath);
  return catalogDescriptorWithRelPath(source, nextRelPath);
}

function catalogRegisterFileLocation(desc, shardName) {
  const d = normalizeCatalogFileDescriptor(desc);
  if (!d || !WS.catalog) return null;
  const index = ensureCatalogIndexObjects();
  const loc = {
    id: d.id,
    relPath: d.relPath,
    dirPath: d.dirPath,
    shardName: shardName || catalogShardNameForPath(d.dirPath),
  };
  index.fileLocationsById[d.id] = loc;
  index.fileLightIndexById[d.id] = Object.assign(
    { shardName: loc.shardName },
    catalogLightIndexEntryFromDescriptor(d),
  );
  WS.catalog.fileLocationsById.set(d.id, loc);
  WS.catalog.fileLocationsByRelPath.set(d.relPath, loc);
  WS.catalog.fileLightIndexById.set(d.id, index.fileLightIndexById[d.id]);
  WS.catalog.fileLightIndexByRelPath.set(d.relPath, index.fileLightIndexById[d.id]);
  WS.catalog.fileDescriptorsById.set(d.id, d);
  WS.catalog.fileDescriptorsByRelPath.set(d.relPath, d);
  return d;
}

function catalogRemoveFileLocationsForDirPath(dirPath) {
  if (!WS.catalog) return;
  const p = normalizeDirPathValue(dirPath);
  const index = ensureCatalogIndexObjects();
  const ids = new Set();
  for (const [id, loc] of WS.catalog.fileLocationsById.entries()) {
    if (normalizeDirPathValue(loc?.dirPath || "") === p) ids.add(id);
  }
  for (const id of Object.keys(index.fileLocationsById || {})) {
    const loc = index.fileLocationsById[id];
    if (normalizeDirPathValue(loc?.dirPath || "") === p) ids.add(id);
  }
  for (const id of ids) {
    const loc =
      WS.catalog.fileLocationsById.get(id) ||
      (index.fileLocationsById && index.fileLocationsById[id]) ||
      null;
    const relPath = normalizeWorkspaceRelPath(loc?.relPath || "");
    delete index.fileLocationsById[id];
    delete index.fileLightIndexById[id];
    WS.catalog.fileLocationsById.delete(id);
    WS.catalog.fileLightIndexById.delete(id);
    WS.catalog.fileDescriptorsById.delete(id);
    if (relPath) {
      WS.catalog.fileLocationsByRelPath.delete(relPath);
      WS.catalog.fileLightIndexByRelPath.delete(relPath);
      WS.catalog.fileDescriptorsByRelPath.delete(relPath);
    }
  }
}

function catalogFilesFromShardOrIndex(path) {
  const p = normalizeDirPathValue(path);
  const shard = WS.catalog?.folderShardCache?.get(p) || null;
  if (Array.isArray(shard?.files)) {
    return shard.files.map(normalizeCatalogFileDescriptor).filter(Boolean);
  }
  const out = [];
  const seen = new Set();
  const maps = [
    WS.catalog?.fileLightIndexByRelPath,
    WS.catalog?.fileDescriptorsByRelPath,
  ];
  for (const map of maps) {
    if (!map || typeof map.entries !== "function") continue;
    for (const [relPath, raw] of map.entries()) {
      const desc = normalizeCatalogFileDescriptor(raw);
      if (!desc || normalizeDirPathValue(desc.dirPath) !== p) continue;
      if (seen.has(desc.relPath)) continue;
      seen.add(desc.relPath);
      out.push(desc);
    }
  }
  out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return out;
}

function buildCatalogSummaryFromDirectEntries(path, childDirPaths, files) {
  const p = normalizeDirPathValue(path);
  const rootName = String(WS.catalog?.index?.rootName || WS.root?.name || "root");
  const childPaths = Array.from(
    new Set((childDirPaths || []).map(normalizeDirPathValue).filter(Boolean)),
  ).sort((a, b) => String(a).localeCompare(String(b)));
  const directFiles = (files || [])
    .map(normalizeCatalogFileDescriptor)
    .filter(Boolean)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  for (let i = 0; i < childPaths.length; i++) {
    if (!WS.catalog.folderSummaries.has(childPaths[i])) {
      WS.catalog.folderSummaries.set(
        childPaths[i],
        emptyCatalogFolderSummary(childPaths[i], rootName),
      );
    }
  }
  const directAspectCounts = catalogEmptyAspectCounts();
  const directMediaAspectCounts = catalogEmptyMediaAspectCounts();
  const recursiveAspectCounts = catalogEmptyAspectCounts();
  const recursiveMediaAspectCounts = catalogEmptyMediaAspectCounts();
  let recursiveImageCount = 0;
  let recursiveVideoCount = 0;
  let recursiveTextCount = 0;
  let recursiveSizeBytes = 0;
  for (let i = 0; i < directFiles.length; i++) {
    const file = directFiles[i];
    if (file.type === "video") recursiveVideoCount++;
    else if (file.type === "image") recursiveImageCount++;
    else if (file.type === "markdown") recursiveTextCount++;
    recursiveSizeBytes += Math.max(0, Number(file.size) || 0);
    catalogIncrementAspectStats(directAspectCounts, directMediaAspectCounts, file);
    catalogIncrementAspectStats(recursiveAspectCounts, recursiveMediaAspectCounts, file);
  }
  let recursiveFileCount = directFiles.length;
  let recursiveFolderCount = childPaths.length;
  for (let i = 0; i < childPaths.length; i++) {
    const child = WS.catalog.folderSummaries.get(childPaths[i]);
    if (!child) continue;
    recursiveFileCount += Math.max(0, Number(child.recursiveFileCount) || 0);
    recursiveFolderCount += Math.max(0, Number(child.recursiveFolderCount) || 0);
    recursiveImageCount += catalogSummaryMediaBucketCountForTagFilter(
      child,
      "images",
    );
    recursiveVideoCount += catalogSummaryMediaBucketCountForTagFilter(
      child,
      "videos",
    );
    recursiveTextCount += catalogSummaryMediaBucketCountForTagFilter(
      child,
      "text",
    );
    recursiveSizeBytes += Math.max(0, Number(child.recursiveSizeBytes) || 0);
    catalogAddAspectCounts(recursiveAspectCounts, child.recursiveAspectCounts);
    catalogAddMediaAspectCounts(recursiveMediaAspectCounts, child.recursiveMediaAspectCounts);
  }
  const directLeadFile = directFiles[0] || null;
  const childLead = childPaths
    .map((childPath) => WS.catalog.folderSummaries.get(childPath))
    .find((child) => child && child.leadFile);
  return {
    path: p,
    name: p ? p.split("/").filter(Boolean).pop() || p : rootName,
    parentPath: p.split("/").slice(0, -1).join("/"),
    shardName: catalogShardNameForPath(p),
    childDirPaths: childPaths,
    directFileCount: directFiles.length,
    directFolderCount: childPaths.length,
    recursiveFileCount,
    recursiveFolderCount,
    recursiveItemCount: recursiveFileCount + recursiveFolderCount,
    recursiveImageCount,
    recursiveVideoCount,
    recursiveTextCount,
    recursiveSizeBytes,
    directAspectCounts,
    recursiveAspectCounts,
    directMediaAspectCounts,
    recursiveMediaAspectCounts,
    directLeadFile,
    leadFile: directLeadFile || childLead?.leadFile || null,
  };
}

async function writeCatalogFolderShard(path, childDirPaths, files) {
  if (!WS.catalog) return false;
  const p = normalizeDirPathValue(path);
  const shardName = catalogShardNameForPath(p);
  const shard = {
    schema: CATALOG_SCHEMA_VERSION,
    path: p,
    childDirPaths: (childDirPaths || []).map(normalizeDirPathValue).filter(Boolean),
    files: (files || []).map(normalizeCatalogFileDescriptor).filter(Boolean),
  };
  WS.catalog.folderShardCache.set(p, shard);
  try {
    const handles = await ensureCatalogHandles(
      WS.catalog.rootHandle || WS.meta.fsRootHandle,
    );
    WS.catalog.folderShardDirHandle = handles.folders;
    const shardHandle = await handles.folders.getFileHandle(shardName, {
      create: true,
    });
    return await writeJsonFileHandle(shardHandle, shard);
  } catch {
    return false;
  }
}

async function commitCatalogFolderDirectEntries(path, childDirPaths, files, opts = null) {
  if (!WS.catalog || !WS.catalog.enabled) return false;
  const options = opts && typeof opts === "object" ? opts : {};
  const p = normalizeDirPathValue(path);
  const index = ensureCatalogIndexObjects();
  const directFiles = (files || [])
    .map(normalizeCatalogFileDescriptor)
    .filter(Boolean);
  const childPaths = Array.from(
    new Set((childDirPaths || []).map(normalizeDirPathValue).filter(Boolean)),
  );
  const summary = buildCatalogSummaryFromDirectEntries(p, childPaths, directFiles);
  catalogRemoveFileLocationsForDirPath(p);
  WS.catalog.folderSummaries.set(p, summary);
  index.folders[p] = summary;
  if (!p) index.rootSummary = summary;
  await writeCatalogFolderShard(p, summary.childDirPaths, directFiles);
  for (let i = 0; i < directFiles.length; i++) {
    catalogRegisterFileLocation(directFiles[i], summary.shardName);
  }
  const node = WS.dirByPath && WS.dirByPath.get(p);
  if (node) {
    applyCatalogSummaryToDirNode(node, summary);
    node.childrenFiles = directFiles.map((file) => file.id);
    applySessionFileOrderForDir(node);
    ensureDirectoryChildNodesFromCatalog(node);
  }
  if (options.propagate !== false) {
    await recomputeCatalogAncestorSummaries(p);
  }
  await writeCatalogIndexNow();
  invalidateDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
  return true;
}

async function recomputeCatalogAncestorSummaries(path) {
  if (!WS.catalog || !WS.catalog.enabled) return false;
  let parentPath = normalizeDirPathValue(path).split("/").slice(0, -1).join("/");
  let changed = false;
  while (true) {
    const summary = getCatalogFolderSummary(parentPath);
    if (summary) {
      const files = catalogFilesFromShardOrIndex(parentPath);
      const next = buildCatalogSummaryFromDirectEntries(
        parentPath,
        summary.childDirPaths || [],
        files,
      );
      WS.catalog.folderSummaries.set(parentPath, next);
      ensureCatalogIndexObjects().folders[parentPath] = next;
      if (!parentPath) WS.catalog.index.rootSummary = next;
      const node = WS.dirByPath && WS.dirByPath.get(parentPath);
      if (node) applyCatalogSummaryToDirNode(node, next);
      changed = true;
    }
    if (!parentPath) break;
    parentPath = parentPath.split("/").slice(0, -1).join("/");
  }
  return changed;
}

async function reconcileCatalogFolderWithDisk(path, opts = null) {
  if (!WS.catalog || !WS.catalog.enabled || !WS.meta.fsRootHandle) return false;
  const options = opts && typeof opts === "object" ? opts : {};
  const p = normalizeDirPathValue(path);
  const showOverlay = !!options.showOverlay;
  if (showOverlay) showBusyOverlay("Updating media index...", displayPath(p));
  try {
    let dirHandle = null;
    try {
      dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, p);
    } catch {
      return false;
    }
    const storedPaths = await preloadStoragePathsForRootHandle(WS.meta.fsRootHandle);
    let aspectEntries = new Map();
    try {
      aspectEntries = await readCatalogAspectEntriesByPath(WS.meta.fsRootHandle);
    } catch {}
    const childPaths = [];
    const files = [];
    for await (const [name, handle] of dirHandle.entries()) {
      const relPath = p ? `${p}/${name}` : name;
      if (pathIsWithinStoredFolder(relPath, storedPaths)) continue;
      if (handle.kind === "directory") {
        if (name === ".local-gallery") continue; // in-library metadata/cache dir
        if (!p && name === INTERNAL_MUSIC_DIR_NAME) continue; // music player folder
        const childPath = normalizeDirPathValue(relPath);
        if (childPath) childPaths.push(childPath);
        continue;
      }
      if (handle.kind !== "file") continue;
      if (String(name || "")[0] === ".") continue;
      if (isLibraryGuideFile(p, name)) continue;
      if (!isImageName(name) && !isVideoName(name) && !isMarkdownName(name)) continue;
      try {
        const file = await handle.getFile();
        const desc = fileDescriptorFromFile(file, relPath, aspectEntries);
        if (desc) files.push(desc);
      } catch {}
    }
    childPaths.sort((a, b) => String(a).localeCompare(String(b)));
    files.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const ok = await commitCatalogFolderDirectEntries(p, childPaths, files);
    const node = WS.dirByPath && WS.dirByPath.get(p);
    if (node) {
      node.loadState = "summary";
      node.subtreeLoadState = "summary";
      node.catalogReconciledThisSession = true;
    }
    return ok;
  } finally {
    if (showOverlay) hideBusyOverlay();
  }
}

async function remapCatalogPathPrefix(oldPrefix, newPrefix) {
  if (!WS.catalog || !WS.catalog.enabled) return false;
  const oldPath = normalizeDirPathValue(oldPrefix);
  const newPath = normalizeDirPathValue(newPrefix);
  if (!oldPath || !newPath || oldPath === newPath) return false;
  const index = ensureCatalogIndexObjects();
  const oldPaths = Array.from(WS.catalog.folderSummaries.keys())
    .map(normalizeDirPathValue)
    .filter((path) => path === oldPath || path.startsWith(oldPath + "/"))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  const remappedShards = [];
  for (const path of oldPaths) {
    const shard = (await readCatalogFolderShard(path)) || {
      schema: CATALOG_SCHEMA_VERSION,
      path,
      childDirPaths: [],
      files: catalogFilesFromShardOrIndex(path),
    };
    const nextPath = remapPathPrefix(oldPath, newPath, path);
    const nextChildPaths = (shard.childDirPaths || [])
      .map((childPath) => remapPathPrefix(oldPath, newPath, childPath))
      .map(normalizeDirPathValue)
      .filter(Boolean);
    const nextFiles = (shard.files || [])
      .map((file) => catalogRemapDescriptorPath(file, oldPath, newPath))
      .filter(Boolean);
    remappedShards.push({ oldPath: path, path: nextPath, childDirPaths: nextChildPaths, files: nextFiles });
  }

  for (const path of oldPaths) {
    delete index.folders[path];
    WS.catalog.folderSummaries.delete(path);
    WS.catalog.folderShardCache.delete(path);
    catalogRemoveFileLocationsForDirPath(path);
  }
  for (const item of remappedShards) {
    await commitCatalogFolderDirectEntries(item.path, item.childDirPaths, item.files, {
      propagate: false,
    });
  }
  if (remappedShards.length) {
    await recomputeCatalogAncestorSummaries(newPath);
    await writeCatalogIndexNow();
  }
  return remappedShards.length > 0;
}

async function removeCatalogPathPrefix(pathPrefix) {
  if (!WS.catalog || !WS.catalog.enabled) return false;
  const prefix = normalizeDirPathValue(pathPrefix);
  if (!prefix) return false;
  const index = ensureCatalogIndexObjects();
  const paths = Array.from(WS.catalog.folderSummaries.keys())
    .map(normalizeDirPathValue)
    .filter((path) => path === prefix || path.startsWith(prefix + "/"));
  for (const path of paths) {
    delete index.folders[path];
    WS.catalog.folderSummaries.delete(path);
    WS.catalog.folderShardCache.delete(path);
    catalogRemoveFileLocationsForDirPath(path);
    if (WS.dirByPath) WS.dirByPath.delete(path);
  }
  await recomputeCatalogAncestorSummaries(prefix);
  await writeCatalogIndexNow();
  invalidateDirectoryDerivedIndex();
  invalidateDirMetricsCaches();
  return paths.length > 0;
}

async function readCatalogFolderShard(path) {
  const normalized = normalizeDirPathValue(path);
  if (!WS.catalog || !WS.catalog.folderShardDirHandle) return null;
  if (WS.catalog.folderShardCache.has(normalized))
    return WS.catalog.folderShardCache.get(normalized);
  const summary = getCatalogFolderSummary(normalized);
  const shardName = String(summary?.shardName || catalogShardNameForPath(normalized));
  let handle = null;
  try {
    handle = await WS.catalog.folderShardDirHandle.getFileHandle(shardName);
  } catch {
    return null;
  }
  const shard = await readJsonFileHandle(handle);
  if (!shard || shard.schema !== CATALOG_SCHEMA_VERSION) return null;
  const files = Array.isArray(shard.files) ? shard.files : [];
  for (let i = 0; i < files.length; i++) {
    registerCatalogFileDescriptor(files[i], {
      shardName,
      dirPath: normalized,
    });
  }
  WS.catalog.folderShardCache.set(normalized, shard);
  return shard;
}

async function getFileDescriptorByRelPathAsync(relPath) {
  const normalized = normalizeWorkspaceRelPath(relPath);
  if (!normalized) return null;
  const existing = getFileDescriptorByRelPath(normalized);
  if (existing) return existing;
  const loc = WS.catalog.fileLocationsByRelPath.get(normalized);
  if (!loc) return null;
  await readCatalogFolderShard(loc.dirPath || "");
  return getFileDescriptorByRelPath(normalized);
}

async function getFileDescriptorAsync(id) {
  const key = String(id || "");
  if (!key) return null;
  const existing = getFileDescriptor(key);
  if (existing) return existing;
  const loc = WS.catalog.fileLocationsById.get(key);
  if (!loc) return null;
  await readCatalogFolderShard(loc.dirPath || "");
  return getFileDescriptor(key);
}

async function ensureFileRecordLoaded(idOrDescriptor) {
  const desc =
    idOrDescriptor && typeof idOrDescriptor === "object"
      ? normalizeCatalogFileDescriptor(idOrDescriptor)
      : await getFileDescriptorAsync(idOrDescriptor);
  if (!desc) return null;
  return ensureFileRecordFromDescriptor(desc);
}

async function ensureFileObjectForRecord(rec) {
  if (!rec || rec.file) return rec && rec.file ? rec.file : null;
  if (!WS.meta || !WS.meta.fsRootHandle) return null;
  const relPath = normalizeWorkspaceRelPath(rec.relPath || "");
  if (!relPath) return null;
  const cacheKey = String(rec.id || relPath);
  if (cacheKey && PREVIEW_FILE_OBJECT_PROMISES.has(cacheKey)) {
    return PREVIEW_FILE_OBJECT_PROMISES.get(cacheKey);
  }
  const parts = relPath.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) return null;
  const dirPath = parts.join("/");
  const loadPromise = (async () => {
    try {
      const dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);
      const fileHandle = await dirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      rec.file = file;
      rec.size = Number(file.size) || rec.size;
      rec.lastModified = Number(file.lastModified) || rec.lastModified;
      rec.nativePath = getNativePathForFile(file) || rec.nativePath || "";
      return file;
    } catch {
      return null;
    } finally {
      if (cacheKey) PREVIEW_FILE_OBJECT_PROMISES.delete(cacheKey);
    }
  })();
  if (cacheKey) PREVIEW_FILE_OBJECT_PROMISES.set(cacheKey, loadPromise);
  return loadPromise;
}

function shouldWarmPreviewFileObjects() {
  return !!(getElectronApi() && WS.meta && WS.meta.fsRootHandle);
}

function schedulePreviewFileObjectsWarm(dirNode = null, delayMs = 40) {
  if (!shouldWarmPreviewFileObjects()) return;
  const node = dirNode || WS.nav.dirNode || null;
  if (!node || !Array.isArray(node.childrenFiles) || !node.childrenFiles.length)
    return;
  PREVIEW_FILE_OBJECT_WARM_TOKEN++;
  const token = PREVIEW_FILE_OBJECT_WARM_TOKEN;
  if (PREVIEW_FILE_OBJECT_WARM_TIMER) {
    try { clearTimeout(PREVIEW_FILE_OBJECT_WARM_TIMER); } catch {}
    PREVIEW_FILE_OBJECT_WARM_TIMER = 0;
  }
  PREVIEW_FILE_OBJECT_WARM_TIMER = setTimeout(() => {
    PREVIEW_FILE_OBJECT_WARM_TIMER = 0;
    warmPreviewFileObjectsForDir(node, token).catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

async function warmPreviewFileObjectsForDir(dirNode, token) {
  if (!shouldWarmPreviewFileObjects()) return;
  if (token !== PREVIEW_FILE_OBJECT_WARM_TOKEN) return;
  let ids = [];
  if (WS.nav.dirNode === dirNode && Array.isArray(WS.nav.entries)) {
    const selected = Math.max(0, Number(WS.nav.selectedIndex) || 0);
    const start = Math.max(0, selected - 24);
    const end = Math.min(WS.nav.entries.length, selected + 49);
    for (let i = start; i < end; i++) {
      const entry = WS.nav.entries[i];
      if (entry && entry.kind === "file" && entry.id) ids.push(String(entry.id));
    }
  }
  if (!ids.length && Array.isArray(dirNode?.childrenFiles)) {
    ids = dirNode.childrenFiles.slice(0, 96);
  }
  if (!ids.length) return;
  await runWithConcurrency(ids, 6, async (id) => {
    if (token !== PREVIEW_FILE_OBJECT_WARM_TOKEN) return;
    const rec = WS.fileById.get(String(id || ""));
    if (!rec || rec.file) return;
    await ensureFileObjectForRecord(rec);
  });
  if (token !== PREVIEW_FILE_OBJECT_WARM_TOKEN || !WS.preview) return;
  const previewDirPath = String(WS.preview.dirNode?.path || "");
  const warmedDirPath = String(dirNode?.path || "");
  const previewUsesWarmedDir =
    WS.preview.dirNode === dirNode ||
    (!!previewDirPath && previewDirPath === warmedDirPath) ||
    (WS.preview.dirNode === WS.root && dirNode === WS.root);
  if (
    WS.preview.kind === "file" &&
    WS.preview.fileId &&
    previewUsesWarmedDir
  ) {
    renderPreviewPane(false, true);
  } else if (WS.preview.kind === "dir" && previewUsesWarmedDir) {
    renderPreviewPane(false, true);
  }
}

const SELECTED_DIR_PREVIEW_REFRESH = {
  token: 0,
  raf: 0,
  timer: 0,
  materializeTimer: 0,
};

function selectedDirectoryPreviewStillCurrent(dirNode) {
  if (!dirNode || !WS || !WS.preview || WS.preview.kind !== "dir") return false;
  const current = WS.preview.dirNode || null;
  if (current === dirNode) return true;
  const currentPath = String(current?.path || "");
  const targetPath = String(dirNode.path || "");
  if (current === WS.root && dirNode === WS.root) return true;
  return !!currentPath && !!targetPath && currentPath === targetPath;
}

function collectSelectedDirectoryPreviewFileIds(dirNode, limit = 160) {
  const node = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!node || !WS || !WS.fileById) return [];
  let ids = [];
  try {
    const entries = getPreviewFolderAndFileEntries(node, {
      includeFiles: true,
      useCurrentViewEntries: false,
    });
    ids = Array.isArray(entries.fileIds) ? entries.fileIds.slice() : [];
  } catch {
    ids = [];
  }
  if (!ids.length && Array.isArray(node.childrenFiles)) {
    ids = node.childrenFiles.slice();
  }
  const out = [];
  const seen = new Set();
  const max = Math.max(1, Number(limit) || 160);
  for (let i = 0; i < ids.length && out.length < max; i++) {
    const id = String(ids[i] || "");
    if (!id || seen.has(id)) continue;
    const rec = WS.fileById.get(id);
    if (!rec || (rec.type !== "image" && rec.type !== "video")) continue;
    if (!passesFilter(rec)) continue;
    if (!recordPassesContextualTagMediaFilterForDir(rec, node)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function selectedDirectoryPreviewHasMissingMedia(dirNode) {
  const ids = collectSelectedDirectoryPreviewFileIds(dirNode, 96);
  for (let i = 0; i < ids.length; i++) {
    const rec = WS.fileById.get(String(ids[i] || ""));
    if (!rec) continue;
    if (!rec.url && !rec.file && WS.meta && WS.meta.fsRootHandle) return true;
    if (rec.type === "image" && !ensureMediaUrl(rec) && WS.meta && WS.meta.fsRootHandle) return true;
    if (rec.type === "video" && mediaThumbnailsEnabled() && !ensureMediaUrl(rec) && WS.meta && WS.meta.fsRootHandle) return true;
  }
  return false;
}

async function materializeSelectedDirectoryPreviewMedia(dirNode, token) {
  const node = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!node || !WS || !WS.meta || !WS.meta.fsRootHandle) return false;
  if (!selectedDirectoryPreviewStillCurrent(node)) return false;
  const ids = collectSelectedDirectoryPreviewFileIds(node, 160);
  if (!ids.length) return false;
  let touched = 0;
  await runWithConcurrency(ids, 6, async (id) => {
    if (token !== SELECTED_DIR_PREVIEW_REFRESH.token) return;
    const rec = WS.fileById.get(String(id || ""));
    if (!rec || (rec.type !== "image" && rec.type !== "video")) return;
    if (!rec.file && !rec.url) await ensureFileObjectForRecord(rec);
    if (rec.file || rec.url) {
      ensureMediaUrl(rec);
      touched++;
    }
  });
  return touched > 0;
}

function rerenderSelectedDirectoryPreviewIfCurrent(dirNode, keepScroll = true) {
  const node = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!selectedDirectoryPreviewStillCurrent(node)) return false;
  renderPreviewPane(false, !!keepScroll);
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  scheduleThumbnailDemandRefresh();
  return true;
}

function scheduleSelectedDirectoryPreviewRefresh(dirNode, opts = null) {
  const node = canonicalDirNodeForActiveState(dirNode) || dirNode;
  if (!node) return;
  const options = opts && typeof opts === "object" ? opts : {};
  SELECTED_DIR_PREVIEW_REFRESH.token++;
  const token = SELECTED_DIR_PREVIEW_REFRESH.token;
  const keepScroll = options.keepScroll !== false;

  if (SELECTED_DIR_PREVIEW_REFRESH.raf) {
    try { cancelAnimationFrame(SELECTED_DIR_PREVIEW_REFRESH.raf); } catch {}
    SELECTED_DIR_PREVIEW_REFRESH.raf = 0;
  }
  if (SELECTED_DIR_PREVIEW_REFRESH.timer) {
    try { clearTimeout(SELECTED_DIR_PREVIEW_REFRESH.timer); } catch {}
    SELECTED_DIR_PREVIEW_REFRESH.timer = 0;
  }
  if (SELECTED_DIR_PREVIEW_REFRESH.materializeTimer) {
    try { clearTimeout(SELECTED_DIR_PREVIEW_REFRESH.materializeTimer); } catch {}
    SELECTED_DIR_PREVIEW_REFRESH.materializeTimer = 0;
  }

  const guardedRender = () => {
    if (token !== SELECTED_DIR_PREVIEW_REFRESH.token) return false;
    const rendered = rerenderSelectedDirectoryPreviewIfCurrent(node, keepScroll);
    if (rendered) {
      // The rAF and the fallback timer both target this same render; once one
      // succeeds, cancel the other so a single selection move doesn't rebuild
      // the preview grid twice.
      if (SELECTED_DIR_PREVIEW_REFRESH.raf) {
        try { cancelAnimationFrame(SELECTED_DIR_PREVIEW_REFRESH.raf); } catch {}
        SELECTED_DIR_PREVIEW_REFRESH.raf = 0;
      }
      if (SELECTED_DIR_PREVIEW_REFRESH.timer) {
        try { clearTimeout(SELECTED_DIR_PREVIEW_REFRESH.timer); } catch {}
        SELECTED_DIR_PREVIEW_REFRESH.timer = 0;
      }
    }
    return rendered;
  };

  SELECTED_DIR_PREVIEW_REFRESH.raf = requestAnimationFrame(() => {
    SELECTED_DIR_PREVIEW_REFRESH.raf = 0;
    guardedRender();
  });

  // Fallback only if the rAF paint was skipped (e.g. tab hidden). Keep short.
  SELECTED_DIR_PREVIEW_REFRESH.timer = setTimeout(() => {
    SELECTED_DIR_PREVIEW_REFRESH.timer = 0;
    guardedRender();
  }, Math.max(16, Number(options.delayMs) || 32));

  // Materialize missing media without a forced re-render cascade. The old path
  // re-rendered at +15ms and again at +120ms after every selection change.
  SELECTED_DIR_PREVIEW_REFRESH.materializeTimer = setTimeout(() => {
    SELECTED_DIR_PREVIEW_REFRESH.materializeTimer = 0;
    Promise.resolve()
      .then(async () => {
        if (token !== SELECTED_DIR_PREVIEW_REFRESH.token) return false;
        if (!selectedDirectoryPreviewStillCurrent(node)) return false;
        if (node.loadState !== "loaded") {
          try {
            await ensureDirectoryHydratedForOpen(node, {
              label: "Loading preview...",
              showOverlay: false,
            });
          } catch {}
        }
        if (token !== SELECTED_DIR_PREVIEW_REFRESH.token) return false;
        if (!selectedDirectoryPreviewStillCurrent(node)) return false;
        if (selectedDirectoryPreviewHasMissingMedia(node)) {
          return await materializeSelectedDirectoryPreviewMedia(node, token);
        }
        return false;
      })
      .then((changed) => {
        if (!changed) return;
        if (token !== SELECTED_DIR_PREVIEW_REFRESH.token) return;
        if (!selectedDirectoryPreviewStillCurrent(node)) return;
        guardedRender();
      })
      .catch(() => {});
  }, 40);
}

async function ensureDirectoryLoaded(dirNode, opts = null) {
  if (dirNode) {
    dirNode.loadState = "loaded";
    dirNode.loadPromise = null;
  }
  return true;
}

function getRootCatalogBucketForNode(node) {
  if (!node || !WS.root || node === WS.root) return null;
  let cur = node;
  while (cur && cur.parent && cur.parent !== WS.root) cur = cur.parent;
  return cur && cur.parent === WS.root ? cur : null;
}

function formatSubtreeHydrationDetail(stats, path = "") {
  const folderCount = Math.max(0, Number(stats && stats.folders) || 0);
  const fileCount = Math.max(0, Number(stats && stats.files) || 0);
  return `Loaded ${folderCount} folders, ${fileCount} media files${path ? `\n${displayPath(path)}` : ""}`;
}

async function ensureDirectorySubtreeLoaded(dirNode, opts = null) {
  if (dirNode) {
    dirNode.subtreeLoadState = "loaded";
    dirNode.subtreeLoadPromise = null;
  }
  return true;
}

async function ensureDirectoryHydratedForOpen(node, opts = null) {
  if (!node) return true;
  // Already materialized — open path must stay instant (no busy flash).
  if (node.loadState === "loaded") return true;
  // Hydration is currently a lightweight mark-loaded path; never raise the
  // full-screen busy overlay for it (that made every first open feel slow).
  await ensureDirectoryLoaded(node, opts);
  await ensureRootChildWorkspaceThumbnailsLoaded(node, {
    label: "Loading folder media...",
    showOverlay: false,
    hideOverlay: false,
  });
  return true;
}

async function ensureInternalTrashDirectoryForRootHandle(rootHandle) {
  if (!rootHandle) return false;
  try {
    await rootHandle.getDirectoryHandle(INTERNAL_TRASH_DIR_NAME, {
      create: true,
    });
    return true;
  } catch {
    try {
      await rootHandle.getDirectoryHandle(INTERNAL_TRASH_DIR_NAME);
      return true;
    } catch {
      return false;
    }
  }
}
