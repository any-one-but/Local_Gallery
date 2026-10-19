/* Preview records
   Rotating previews, navigation manifests and which record a card shows. */

const ROTATING_PREVIEW_POOLS = new Map();
const ROTATING_PREVIEW_ORDER = new Map();
const ROTATING_PREVIEW_INDEX = new Map();
const ROTATING_PREVIEW_NEXT_AT = new Map();
let ROTATING_PREVIEW_TIMER = 0;
let ROTATING_PREVIEW_ENSURE_PENDING = false;
const ROTATING_PREVIEW_INTERVAL_MS = 24000;
const ROTATING_PREVIEW_JITTER_RATIO = 0.5;
const ROTATING_PREVIEW_JITTER_MS = Math.round(
  ROTATING_PREVIEW_INTERVAL_MS * ROTATING_PREVIEW_JITTER_RATIO,
);
const ROTATING_PREVIEW_POLL_MS = 1000;
const ROTATING_PREVIEW_FADE_MS = 900;

function shuffleArrayInPlace(arr) {
  if (!Array.isArray(arr) || arr.length < 2) return arr;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function topRootBucketKeyForDirPath(dirPath) {
  const parts = String(dirPath || "")
    .split("/")
    .filter(Boolean);
  return parts.length ? String(parts[0] || "") : "";
}

function buildRootBucketRecursiveMediaCounts() {
  const counts = new Map();
  for (const rec of WS.fileById.values()) {
    if (!rec) continue;
    const bucketKey = topRootBucketKeyForDirPath(rec.dirPath || "");
    counts.set(bucketKey, (counts.get(bucketKey) || 0) + 1);
  }
  return counts;
}

function pickWeightedRotationId(ids, weights, totalWeight) {
  const list = Array.isArray(ids) ? ids : [];
  const w = Array.isArray(weights) ? weights : [];
  if (!list.length) return "";
  if (list.length === 1) return String(list[0] || "");
  const total = Number(totalWeight);
  if (!Number.isFinite(total) || total <= 0) {
    return String(list[Math.floor(Math.random() * list.length)] || "");
  }
  let needle = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    needle -= Number(w[i] || 0);
    if (needle <= 0) return String(list[i] || "");
  }
  return String(list[list.length - 1] || "");
}

function buildWeightedRotationOrder(ids) {
  const uniq = [];
  const seen = new Set();
  for (let i = 0; i < (ids || []).length; i++) {
    const id = String(ids[i] || "");
    if (!id || seen.has(id)) continue;
    if (!WS.fileById.has(id)) continue;
    seen.add(id);
    uniq.push(id);
  }
  if (uniq.length < 2) return uniq.slice();

  const rootBucketCounts = buildRootBucketRecursiveMediaCounts();
  const weights = [];
  let totalWeight = 0;
  for (let i = 0; i < uniq.length; i++) {
    const rec = WS.fileById.get(uniq[i]);
    const bucketKey = topRootBucketKeyForDirPath(rec?.dirPath || "");
    const bucketCount = Math.max(
      1,
      Number(rootBucketCounts.get(bucketKey) || 0),
    );
    const weight = 1 / bucketCount;
    weights.push(weight);
    totalWeight += weight;
  }
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    return shuffleArrayInPlace(uniq.slice());
  }

  const out = [];
  let lastId = "";
  for (let i = 0; i < uniq.length; i++) {
    let picked = pickWeightedRotationId(uniq, weights, totalWeight);
    if (picked && picked === lastId && uniq.length > 1) {
      for (let tries = 0; tries < 3 && picked === lastId; tries++) {
        picked = pickWeightedRotationId(uniq, weights, totalWeight);
      }
    }
    if (!picked) picked = uniq[Math.floor(Math.random() * uniq.length)] || "";
    out.push(picked);
    lastId = picked;
  }
  return out;
}

function sampleRecursivePreviewRecords(
  dirNodes,
  limit = 72,
  includeRootFiles = true,
) {
  const roots = Array.isArray(dirNodes) ? dirNodes.filter(Boolean) : [];
  if (!roots.length) return [];
  const capRaw = Number(limit);
  const cap = Number.isFinite(capRaw) ? Math.max(0, Math.floor(capRaw)) : 0;
  const out = [];
  const seenIds = new Set();
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    if (!root) continue;
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      if (!cur) continue;
      const includeHere = includeRootFiles || cur !== root;
      if (includeHere) {
        const ids = getOrderedFileIdsForDir(cur, false);
        for (let i = 0; i < ids.length; i++) {
          const id = String(ids[i] || "");
          if (!id || seenIds.has(id)) continue;
          const rec = WS.fileById.get(id);
          if (!rec) continue;
          seenIds.add(id);
          out.push(rec);
        }
      }
      const kids = getChildDirsForNode(cur);
      for (let i = 0; i < kids.length; i++) queue.push(kids[i]);
    }
  }
  if (!cap || out.length <= cap) return out;
  const seedSource = roots.map((n) => String((n && n.path) || "")).join("|");
  const seed = hash32(
    `rotate-sample|${seedSource}|${includeRootFiles ? "1" : "0"}|${out.length}`,
  );
  const shuffled = shuffleWithSeed(out.slice(), seed);
  return shuffled.slice(0, cap);
}

function getFirstDirectPreviewRecordForDir(dirNode) {
  const ids = getOrderedFileIdsForDir(dirNode, false);
  if (!ids.length) return null;
  return WS.fileById.get(ids[0]) || null;
}

function directoryNavManifestKey(dirNode) {
  if (!dirNode) return "";
  return String(dirNode.path || "__root__");
}

function getDirectoryNavManifest(dirNode) {
  if (!dirNode) return null;
  const key = directoryNavManifestKey(dirNode);
  if (DIR_NAV_MANIFESTS.has(key)) return DIR_NAV_MANIFESTS.get(key) || null;

  const fileIds = getOrderedFileIdsForDir(dirNode, false)
    .map((id) => String(id || ""))
    .filter(Boolean);
  const childDirs = getChildDirsForNode(dirNode);
  const childDirPaths = [];
  const childLeadRecordIds = [];
  for (let i = 0; i < childDirs.length; i++) {
    const child = childDirs[i];
    if (!child) continue;
    childDirPaths.push(String(child.path || ""));
    const childManifest = getDirectoryNavManifest(child);
    const childLeadId = String(
      (childManifest && childManifest.leadRecordId) || "",
    );
    if (childLeadId) childLeadRecordIds.push(childLeadId);
  }

  const presetRec = getPresetPreviewRecordForDir(dirNode);
  const directRec = getFirstDirectPreviewRecordForDir(dirNode);
  const leadRecordId = String(
    (presetRec && presetRec.id) ||
      (directRec && directRec.id) ||
      childLeadRecordIds[0] ||
      "",
  );
  const navRecordIds = [];
  const seen = new Set();
  const pushId = (id) => {
    const normalized = String(id || "");
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    navRecordIds.push(normalized);
  };
  for (let i = 0; i < fileIds.length; i++) pushId(fileIds[i]);
  for (let i = 0; i < childLeadRecordIds.length; i++)
    pushId(childLeadRecordIds[i]);

  const manifest = {
    key,
    path: String(dirNode.path || ""),
    fileIds,
    childDirPaths,
    childLeadRecordIds,
    leadRecordId,
    navRecordIds,
  };
  DIR_NAV_MANIFESTS.set(key, manifest);
  return manifest;
}

function primeDirectoryNavManifests(rootNode = null) {
  const startNode = rootNode || WS.root;
  if (!startNode) return;
  try {
    getDirectoryNavManifest(startNode);
  } catch (error) {
    console.error("Directory thumbnail manifest build failed.", error);
    DIR_NAV_MANIFESTS.clear();
  }
}

function manifestPathKey(pathValue) {
  const path = String(pathValue || "");
  return path || "__root__";
}

function collectManifestNavigationRecordsForPaths(paths, includeFiles = true) {
  const out = [];
  const seen = new Set();
  const list = Array.isArray(paths) ? paths : [];
  for (let i = 0; i < list.length; i++) {
    const key = manifestPathKey(list[i]);
    const manifest = DIR_NAV_MANIFESTS.get(key);
    const ids = includeFiles
      ? Array.isArray(manifest && manifest.navRecordIds)
        ? manifest.navRecordIds
        : []
      : Array.isArray(manifest && manifest.childLeadRecordIds)
        ? manifest.childLeadRecordIds
        : [];
    for (let j = 0; j < ids.length; j++) {
      const id = String(ids[j] || "");
      if (!id || seen.has(id)) continue;
      const rec = WS.fileById.get(id);
      if (!rec) continue;
      seen.add(id);
      out.push(rec);
    }
  }
  return out;
}

function collectWorkspaceNavigationRecords(rootNode = null) {
  const startNode = rootNode || WS.root;
  if (!startNode) return [];
  primeDirectoryNavManifests(startNode);
  const rootPath = String(startNode.path || "");
  const paths = [];
  for (const manifest of DIR_NAV_MANIFESTS.values()) {
    const path = String((manifest && manifest.path) || "");
    if (!rootPath || path === rootPath || path.startsWith(rootPath + "/"))
      paths.push(path);
  }
  return collectManifestNavigationRecordsForPaths(
    paths,
    shouldAutoLoadFileThumbnails(),
  );
}

function findFileRecordByRelPath(relPath) {
  const needle = normalizeWorkspaceRelPath(relPath);
  if (!needle) return null;
  for (const rec of WS.fileById.values()) {
    if (!rec) continue;
    if (normalizeWorkspaceRelPath(rec.relPath || "") === needle) return rec;
  }
  const desc = getFileDescriptorByRelPath(needle);
  if (desc) return ensureFileRecordFromDescriptor(desc);
  return null;
}

function isRecordInDirSubtree(rec, dirNode) {
  if (!rec || !dirNode) return false;
  const dirPath = String(dirNode.path || "");
  const recDirPath = String(rec.dirPath || "");
  if (!dirPath) return true;
  return recDirPath === dirPath || recDirPath.startsWith(dirPath + "/");
}

function findEquivalentRecordInDir(dirNode, relPath) {
  if (!dirNode || !relPath) return null;
  const needle = normalizeWorkspaceRelPath(relPath);
  if (!needle) return null;
  const identity = altIdentityRelPath(needle);
  const pool = sampleRecursivePreviewRecords([dirNode], 0, true);
  let exact = null;
  for (let i = 0; i < pool.length; i++) {
    const rec = pool[i];
    if (!rec || rec.isMissingPlaceholder) continue;
    if (fileRecordIsInactiveAltSource(rec)) continue;
    const recIdentity = altCanonicalThumbKeyForRecord(rec);
    if (identity && recIdentity === identity) return rec;
    if (!exact && normalizeWorkspaceRelPath(rec.relPath || "") === needle)
      exact = rec;
  }
  return exact;
}

function getPresetPreviewRecordForDir(dirNode) {
  if (!dirNode) return null;
  const dirPath = String(dirNode.path || "");
  if (!dirPath && dirNode !== WS.root) return null;
  const relPath = metaGetFolderThumbnailPresetRelPath(dirPath);
  if (!relPath) return null;
  const rec = findEquivalentRecordInDir(dirNode, relPath);
  if (!rec) return null;
  if (!passesFilter(rec)) return null;
  // A pinned folder thumbnail must still obey an active tag content filter so
  // filtered-out media never surfaces as a folder thumbnail inside a tag view.
  const contextualFilter = contextualTagMediaFilterForDirPath(dirPath);
  if (contextualFilter.length && !recordPassesTagMediaFilter(rec, contextualFilter))
    return null;
  if (!isRecordInDirSubtree(rec, dirNode)) return null;
  return rec;
}

function getRecursivePreviewRecordsForDir(
  dirNode,
  limit = 72,
  includeSelfFiles = true,
) {
  if (!dirNode) return [];
  return sampleRecursivePreviewRecords([dirNode], limit, includeSelfFiles);
}

function hasKnownPreviewAspect(rec) {
  const ar = Number(rec && rec.previewAspect);
  return Number.isFinite(ar) && ar > 0;
}

async function detectRecordPreviewAspect(rec) {
  if (!rec) return null;
  if (hasKnownPreviewAspect(rec)) {
    return normalizePreviewAspect(rec.previewAspect, 4 / 3);
  }

  if (!rec.file && rec.catalogBacked) {
    try {
      await ensureFileObjectForRecord(rec);
    } catch {}
  }

  if (rec.type === "image") {
    let w = 0;
    let h = 0;
    if (rec.file) {
      try {
        const bmp = await createImageBitmap(rec.file);
        w = Number(bmp && bmp.width) || 0;
        h = Number(bmp && bmp.height) || 0;
        try {
          bmp.close();
        } catch {}
      } catch {}
    }
    if (!(w > 0 && h > 0)) {
      const src = ensureMediaUrl(rec);
      if (src) {
        try {
          const dims = await new Promise((resolve) => {
            const img = new Image();
            const done = (out) => resolve(out || { w: 0, h: 0 });
            img.onload = () =>
              done({
                w: Number(img.naturalWidth) || 0,
                h: Number(img.naturalHeight) || 0,
              });
            img.onerror = () => done({ w: 0, h: 0 });
            img.src = src;
          });
          w = Number(dims && dims.w) || 0;
          h = Number(dims && dims.h) || 0;
        } catch {}
      }
    }
    if (w > 0 && h > 0) return normalizePreviewAspect(w / h, 4 / 3);
    return null;
  }

  if (rec.type === "video") {
    const knownVideoAspect = Number(rec.videoAspect);
    if (Number.isFinite(knownVideoAspect) && knownVideoAspect > 0) {
      return normalizePreviewAspect(knownVideoAspect, 4 / 3);
    }
    const src = ensureMediaUrl(rec);
    if (!src) return null;
    try {
      const dims = await new Promise((resolve) => {
        const v = document.createElement("video");
        prepareMediaElementForCanvas(v);
        let settled = false;
        const done = (out) => {
          if (settled) return;
          settled = true;
          try {
            v.pause();
            v.removeAttribute("src");
            v.load();
          } catch {}
          resolve(out || { w: 0, h: 0 });
        };
        const timer = setTimeout(() => done({ w: 0, h: 0 }), 2000);
        v.preload = "metadata";
        v.muted = true;
        v.playsInline = true;
        v.onloadedmetadata = () => {
          clearTimeout(timer);
          done({ w: Number(v.videoWidth) || 0, h: Number(v.videoHeight) || 0 });
        };
        v.onerror = () => {
          clearTimeout(timer);
          done({ w: 0, h: 0 });
        };
        v.src = src;
      });
      const w = Number(dims && dims.w) || 0;
      const h = Number(dims && dims.h) || 0;
      if (w > 0 && h > 0) return normalizePreviewAspect(w / h, 4 / 3);
    } catch {}
  }

  return null;
}

async function hydrateAllRecordAspectRatios(opts = null) {
  if (!WS.root || !WS.fileById || !WS.fileById.size) return false;
  const options = opts && typeof opts === "object" ? opts : {};
  const records = Array.from(WS.fileById.values()).filter(Boolean);
  if (!records.length) return false;
  const onProgress =
    typeof options.onProgress === "function" ? options.onProgress : null;
  const progressState = { completed: 0, total: records.length, lastUpdate: 0 };
  const emitProgress = (rec = null, force = false) => {
    if (!onProgress) return;
    const now = Date.now();
    const interval = Math.max(0, Number(options.progressIntervalMs) || 120);
    if (!force && now - progressState.lastUpdate < interval) return;
    progressState.lastUpdate = now;
    try {
      onProgress({
        completed: progressState.completed,
        total: progressState.total,
        record: rec,
      });
    } catch {}
  };
  emitProgress(null, true);
  let changed = false;
  // The log keeps entries for files that are not here right now: put the file
  // back and its measured shape is already known. Each entry carries the size
  // and modification time it was measured from, so a different file arriving
  // at the same path is re-measured rather than trusted.
  let logChanged = false;
  let cursor = 0;
  const hwConcurrency =
    typeof navigator === "object" ? Number(navigator.hardwareConcurrency || 4) || 4 : 4;
  const maxConcurrency = Math.max(
    1,
    Math.min(8, Number(options.maxConcurrency) || 8),
  );
  const concurrency = Math.max(
    1,
    Math.min(maxConcurrency, records.length, hwConcurrency),
  );
  const worker = async () => {
    while (cursor < records.length) {
      const rec = records[cursor++];
      try {
        const cached = getCachedAspectRatioForRecord(rec);
        if (cached > 0) {
          if (setRecordAspectRatio(rec, cached)) changed = true;
          continue;
        }
        const known = getKnownRecordAspectRatio(rec);
        if (known > 0) {
          if (setRecordAspectRatio(rec, known)) changed = true;
          if (setCachedAspectRatioForRecord(rec, known)) logChanged = true;
          continue;
        }
        const detected = await detectRecordPreviewAspect(rec);
        if (detected && setRecordAspectRatio(rec, detected)) changed = true;
        if (detected && setCachedAspectRatioForRecord(rec, detected)) logChanged = true;
      } finally {
        progressState.completed++;
        emitProgress(rec);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  emitProgress(records[records.length - 1] || null, true);
  if (logChanged) metaMarkDirty(META_DOC_IDS.aspectRatios);
  return changed || logChanged;
}

function hydrateCachedRecordAspectRatiosForLoadedWorkspace() {
  if (!aspectRatioMetadataEnabled()) return false;
  if (!WS.root || !WS.fileById || !WS.fileById.size) return false;
  let changed = false;
  let logChanged = false;
  for (const rec of WS.fileById.values()) {
    if (!rec) continue;
    const cached = getCachedAspectRatioForRecord(rec);
    if (cached > 0) {
      if (setRecordAspectRatio(rec, cached)) changed = true;
      continue;
    }
    const known = getKnownRecordAspectRatio(rec);
    if (known > 0) {
      if (setRecordAspectRatio(rec, known)) changed = true;
      if (setCachedAspectRatioForRecord(rec, known)) logChanged = true;
    }
  }
  if (logChanged) metaMarkDirty(META_DOC_IDS.aspectRatios);
  return changed || logChanged;
}

function hydrateCatalogLightIndexFromAspectLog() {
  if (!WS.catalog || !WS.catalog.enabled || !WS.meta || !WS.meta.aspectRatios)
    return false;
  let changed = false;
  const maps = [
    WS.catalog.fileLightIndexByRelPath,
    WS.catalog.fileDescriptorsByRelPath,
  ];
  for (const relPathRaw of WS.meta.aspectRatios.keys()) {
    const relPath = normalizeWorkspaceRelPath(relPathRaw);
    if (!relPath) continue;
    const entry = normalizeAspectRatioLogEntry(relPath, WS.meta.aspectRatios.get(relPathRaw));
    if (!entry) continue;
    for (let m = 0; m < maps.length; m++) {
      const map = maps[m];
      if (!map || !map.has(relPath)) continue;
      const desc = map.get(relPath);
      const prevAspect = Number(desc && desc.aspectRatio);
      const prevBucket = String(desc && desc.aspectRatioBucket || "");
      catalogApplyAspectEntryToDescriptor(desc, entry);
      if (
        Number(desc && desc.aspectRatio) > 0 &&
        (!Number.isFinite(prevAspect) ||
          Math.abs(Number(desc.aspectRatio) - prevAspect) > 0.0001 ||
          String(desc.aspectRatioBucket || "") !== prevBucket)
      ) {
        changed = true;
      }
    }
    const rec = findFileRecordByRelPath(relPath);
    if (rec && catalogAspectEntryMatchesDescriptor(entry, rec)) {
      if (setRecordAspectRatio(rec, Number(entry.aspectRatio))) changed = true;
    }
  }
  return changed;
}

let ASPECT_RATIO_BACKGROUND_HYDRATE_TOKEN = 0;

function aspectRatioHydrationRequiresBlocking(options = null) {
  if (!aspectRatioMetadataEnabled()) return false;
  const opt = options || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return !!(
    anyAspectRatioStorageEnabled(opt) ||
    normalizeAspectRatioFilterMode(WS.view && WS.view.aspectRatioFilterMode) !==
      "all"
  );
}

function scheduleBackgroundAspectRatioHydration(delayMs = 900) {
  if (!aspectRatioMetadataEnabled()) return;
  const token = ++ASPECT_RATIO_BACKGROUND_HYDRATE_TOKEN;
  setTimeout(async () => {
    if (token !== ASPECT_RATIO_BACKGROUND_HYDRATE_TOKEN || !WS.root) return;
    let changed = false;
    try {
      changed = await hydrateAllRecordAspectRatios({ maxConcurrency: 2 });
    } catch {}
    if (token !== ASPECT_RATIO_BACKGROUND_HYDRATE_TOKEN || !WS.root) return;
    if (!changed) return;
    invalidateDirItemCountCache();
    if (
      normalizeAspectRatioFilterMode(WS.view && WS.view.aspectRatioFilterMode) !==
      "all"
    ) {
      rebuildDirectoriesEntries();
      renderDirectoriesPane(true, { suppressSelectionReveal: true });
      renderPreviewPane(false, true);
      scheduleThumbnailDemandRefresh();
    }
    metaScheduleSave(META_DOC_IDS.aspectRatios);
  }, Math.max(0, Number(delayMs) || 0));
}

function getRootPresetPreviewRecord(rootNode, rootPool = null) {
  if (!rootNode) return null;
  const key = rootThumbnailKey();
  if (getTagThumbnailDisplayModeByKey(key) !== "single") return null;
  const relPath = metaGetTagThumbnailPresetRelPathByKey(key);
  if (!relPath) return null;
  const rec = findFileRecordByRelPath(relPath);
  if (!rec || !passesFilter(rec) || !isRecordInDirSubtree(rec, rootNode))
    return null;
  if (Array.isArray(rootPool) && rootPool.length) {
    const idSet = new Set(
      rootPool.map((r) => String((r && r.id) || "")).filter(Boolean),
    );
    if (!idSet.has(String(rec.id || ""))) return null;
  }
  return rec;
}

function tagThumbnailLabelForKey(tagKey) {
  const key = String(tagKey || "");
  if (!key) return "tag";
  const parsed = parseTagThumbnailStructuredKey(key);
  if (parsed) {
    const value = String(parsed.value || "");
    const scopeLabel = parsed.scoped
      ? tagThumbnailScopeLabelForPath(parsed.scopePath)
      : "";
    if (parsed.kind === "tag") {
      if (!value) return "tag";
      return parsed.scoped ? `${value} in ${scopeLabel}` : value;
    }
    if (parsed.kind === "album") {
      if (!value) return "Album";
      return parsed.scoped
        ? `Album ${value} in ${scopeLabel}`
        : `Album ${value}`;
    }
    if (parsed.kind === "gallery") {
      return value ? `Gallery ${value}` : "Gallery";
    }
  }
  if (key === rootThumbnailKey()) return "Root";
  if (key.startsWith("special:favorites:")) {
    const scope = key.slice("special:favorites:".length);
    const scopePath = tagThumbnailScopePathFromKey(scope);
    const scopeLabel = tagThumbnailScopeLabelForPath(scopePath);
    return `Favorites in ${scopeLabel}`;
  }
  if (key === "special:favorites") return "Favorites";
  if (key === "special:hidden") return "Hidden";
  if (key === "special:untagged") return "Untagged";
  if (key.startsWith("special:")) return toTitleCaps(key.slice(8) || "tag");
  return key;
}

function thumbnailMenuScopeLabel(node) {
  const scopePath = String(node?.path || "");
  if (!scopePath) return "root";
  return dirDisplayName(node) || "folder";
}

function thumbnailMenuFolderLabel(node) {
  const folderPath = String(node?.path || "");
  if (!folderPath) return "Root";
  return dirDisplayName(node) || "folder";
}

function isRecordInAnyDirSubtree(rec, dirs) {
  if (!rec || !Array.isArray(dirs) || !dirs.length) return false;
  for (let i = 0; i < dirs.length; i++) {
    if (isRecordInDirSubtree(rec, dirs[i])) return true;
  }
  return false;
}

function formatThumbnailEditorTimeLabel(secondsRaw) {
  const seconds = Math.max(0, Number(secondsRaw) || 0);
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  const frac = Math.floor((seconds - whole) * 100);
  return `${mins}:${String(secs).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
}

function pickRandomPreviewRecord(records) {
  const pool = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!pool.length) return null;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] || null;
}

function pickRotatingPreviewSlotsForKey(baseKey, records, count = 4) {
  const out = [];
  const k = String(baseKey || "");
  const pool = Array.isArray(records) ? records.filter(Boolean) : [];
  const laneCount = Math.max(1, Number(count) || 1);
  if (!k || !pool.length) return out;
  const ids = registerRotatingPreviewPool(k, pool);
  if (!ids.length) return out;
  const order = ROTATING_PREVIEW_ORDER.get(k) || ids;
  for (let i = 0; i < laneCount; i++) {
    const laneKey = `${k}:slot:${i + 1}`;
    registerRotatingPreviewPool(laneKey, pool);
    const laneOrder = ROTATING_PREVIEW_ORDER.get(laneKey) || order;
    if (!ROTATING_PREVIEW_INDEX.has(laneKey)) {
      ROTATING_PREVIEW_INDEX.set(laneKey, laneOrder.length ? i % laneOrder.length : 0);
    }
    const idx = Number(ROTATING_PREVIEW_INDEX.get(laneKey) || 0);
    const recId = String(laneOrder[idx % Math.max(1, laneOrder.length)] || "");
    out.push({ key: laneKey, rec: WS.fileById.get(recId) || pool[i % pool.length] || null });
  }
  return out;
}

function registerRotatingPreviewPool(key, records) {
  const poolKey = String(key || "");
  if (!poolKey) return [];
  const pool = Array.isArray(records) ? records.filter(Boolean) : [];
  const ids = [];
  const seen = new Set();
  for (let i = 0; i < pool.length; i++) {
    const rec = pool[i];
    const id = String(rec?.id || "");
    if (!id || seen.has(id) || !WS.fileById.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) {
    ROTATING_PREVIEW_POOLS.delete(poolKey);
    ROTATING_PREVIEW_ORDER.delete(poolKey);
    ROTATING_PREVIEW_INDEX.delete(poolKey);
    ROTATING_PREVIEW_NEXT_AT.delete(poolKey);
    return [];
  }
  const prev = ROTATING_PREVIEW_POOLS.get(poolKey) || [];
  const samePool =
    Array.isArray(prev) &&
    prev.length === ids.length &&
    prev.every((id, idx) => id === ids[idx]);
  ROTATING_PREVIEW_POOLS.set(poolKey, ids);
  if (!samePool || !ROTATING_PREVIEW_ORDER.has(poolKey)) {
    const order = buildWeightedRotationOrder(ids);
    ROTATING_PREVIEW_ORDER.set(poolKey, order.length ? order : ids.slice());
    const currentId = String(
      samePool
        ? (ROTATING_PREVIEW_ORDER.get(poolKey) || [])[Number(ROTATING_PREVIEW_INDEX.get(poolKey) || 0)] || ""
        : "",
    );
    const nextOrder = ROTATING_PREVIEW_ORDER.get(poolKey) || ids;
    let nextIndex = 0;
    if (currentId) {
      const foundIndex = nextOrder.indexOf(currentId);
      if (foundIndex >= 0) nextIndex = foundIndex;
    }
    ROTATING_PREVIEW_INDEX.set(poolKey, nextIndex);
  } else if (!ROTATING_PREVIEW_INDEX.has(poolKey)) {
    ROTATING_PREVIEW_INDEX.set(poolKey, 0);
  }
  if (!ROTATING_PREVIEW_NEXT_AT.has(poolKey)) {
    ROTATING_PREVIEW_NEXT_AT.set(
      poolKey,
      Date.now() + ROTATING_PREVIEW_INTERVAL_MS + Math.round(Math.random() * ROTATING_PREVIEW_JITTER_MS),
    );
  }
  if (!ROTATING_PREVIEW_ENSURE_PENDING) {
    ROTATING_PREVIEW_ENSURE_PENDING = true;
    requestAnimationFrame(() => {
      ROTATING_PREVIEW_ENSURE_PENDING = false;
      ensureRotatingPreviewTicker();
    });
  }
  return ids;
}

function pickRotatingPreviewRecordForKey(key, records) {
  const pool = Array.isArray(records) ? records.filter(Boolean) : [];
  if (!pool.length) return null;
  const ids = registerRotatingPreviewPool(key, pool);
  if (!ids.length) return pool[0] || null;
  const order = ROTATING_PREVIEW_ORDER.get(String(key || "")) || ids;
  const idx = Number(ROTATING_PREVIEW_INDEX.get(String(key || "")) || 0);
  const recId = String(order[idx % Math.max(1, order.length)] || ids[0] || "");
  return WS.fileById.get(recId) || pool[0] || null;
}

const THUMB_VIEWPORT_NUDGE_STEP = 8;

function applyPreviewRecordToImageElement(imgEl, rec) {
  if (!imgEl || !rec) return false;
  const previewId = String(rec.id || "");
  const previewSrc = getPassivePreviewSrcForRecord(rec, {
    allowImageMediaFallback: true,
  });
  if (!previewSrc) return false;
  if (imgEl.src !== previewSrc) imgEl.src = previewSrc;
  imgEl.setAttribute("data-dir-preview-id", previewId);
  const previewAspect = getPreviewAspectForRecord(rec);
  applyDirectoryInlineAspect(imgEl, previewAspect);
  if (
    rec.type === "image" &&
    !syncDirectoryInlineAspectFromNaturalSize(imgEl, rec)
  ) {
    if (imgEl.dataset.dirAspectPending !== "1") {
      imgEl.dataset.dirAspectPending = "1";
      imgEl.addEventListener(
        "load",
        () => {
          delete imgEl.dataset.dirAspectPending;
          syncDirectoryInlineAspectFromNaturalSize(imgEl, rec);
        },
        { once: true },
      );
    }
  }
  const fitCard = imgEl.closest(".fitInsideCard");
  if (fitCard) {
    fitCard.dataset.aspect = String(previewAspect);
  }
  return true;
}

function crossfadePreviewRecordOnImageElement(imgEl, rec) {
  if (!imgEl || !rec) return;
  const busyUntil = Number(imgEl.dataset.rotateBusyUntil || "0");
  const now = Date.now();
  if (Number.isFinite(busyUntil) && busyUntil > now) return;
  const until = now + ROTATING_PREVIEW_FADE_MS + 80;
  imgEl.dataset.rotateBusyUntil = String(until);
  imgEl.classList.add("rotatingThumbFade");
  setTimeout(
    () => {
      applyPreviewRecordToImageElement(imgEl, rec);
      requestAnimationFrame(() => {
        imgEl.classList.remove("rotatingThumbFade");
      });
    },
    Math.round(ROTATING_PREVIEW_FADE_MS * 0.55),
  );
}

function ensureRotatingPreviewTicker() {
  const hasRotatingThumbs = !!document.querySelector("img[data-rotate-key]");
  if (!hasRotatingThumbs) {
    if (ROTATING_PREVIEW_TIMER) {
      clearInterval(ROTATING_PREVIEW_TIMER);
      ROTATING_PREVIEW_TIMER = 0;
    }
    return;
  }
  if (!ROTATING_PREVIEW_TIMER) {
    ROTATING_PREVIEW_TIMER = setInterval(
      rotatePreviewThumbnailsTick,
      ROTATING_PREVIEW_POLL_MS,
    );
  }
  rotatePreviewThumbnailsTick();
}

function makeTagPreviewNode(entry) {
  const originPath = String(entry?.originPath || "");
  const baseNode =
    (originPath && WS.dirByPath && WS.dirByPath.get(originPath)) ||
    WS.nav.dirNode;
  if (!entry || !baseNode) return null;
  const isAlbumEntry = !!entry.album && !entry.tag;
  const isGalleryEntry = !!entry.gallery && !entry.tag && !entry.album;
  const mode = entry.special
    ? String(entry.special || "")
    : isAlbumEntry
      ? "album"
      : isGalleryEntry
        ? "gallery"
        : "tag";
  const label = String(entry.label || entry.tag || entry.gallery || entry.special || "Tag");
  const pathSuffix = entry.special
    ? entry.special
    : isAlbumEntry
      ? `album-${String(entry.album || "")}`
      : isGalleryEntry
        ? `gallery-${String(entry.gallery || "")}`
      : entry.tag || "tag";
  const safeSuffix = String(pathSuffix || "tag").replace(/[\/\\]/g, "_");
  const virtualPath = `${String(baseNode.path || "")}/@tag-${safeSuffix}`;

  // v15: Do not resolve every folder inside the tag just to build a simulated
  // preview location. The preview pane currently renders tag locations as a
  // placeholder, and the real tag folder contents are resolved by the file-pane
  // navigation path. Keeping this lazy removes a full tag membership pass from
  // ordinary tag/album selection, entry, and exit.
  return {
    type: "dir",
    name: label,
    parent: baseNode,
    childrenDirs: [],
    childrenFiles: [],
    path: virtualPath,
    _skipTagFilters: true,
    _tagPreviewMode: mode,
    _tagPreviewTag: String(isGalleryEntry ? entry.gallery || "" : entry.tag || ""),
    _tagPreviewGallery: String(entry.gallery || ""),
    _tagPreviewSpecial: String(entry.special || ""),
    _tagPreviewAlbum: String(entry.album || ""),
    _tagPreviewOriginPath: String(baseNode.path || originPath),
  };
}

function findTagEntryIndexInEntries(entries, mode, tag, album = "") {
  const albumKey = normalizeTagAlbumName(album);
  const galleryKey = normalizeGalleryName(tag);
  const list = Array.isArray(entries) ? entries : [];
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry || entry.kind !== "tag") continue;
    if (mode && entry.special && entry.special === mode) return i;
    if (
      mode === "album" &&
      entry.album &&
      !entry.tag &&
      normalizeTagAlbumName(entry.album) === albumKey
    )
      return i;
    if (
      mode === "gallery" &&
      entry.gallery &&
      !entry.tag &&
      !entry.album &&
      normalizeGalleryName(entry.gallery) === galleryKey
    )
      return i;
    if (mode === "tag" && entry.tag && entry.tag === tag) {
      const entryAlbum = normalizeTagAlbumName(entry.album || "");
      if (albumKey && entryAlbum !== albumKey) continue;
      return i;
    }
  }
  return -1;
}

function findTagEntryIndex(mode, tag, album = "") {
  return findTagEntryIndexInEntries(WS.nav.entries, mode, tag, album);
}

function restoreTagFolderEntrySelection(ctx) {
  if (!ctx) return false;
  const baseNode = WS.dirByPath.get(String(ctx.originPath || "")) || WS.root;
  if (!baseNode) return false;
  WS.nav.dirNode = baseNode;
  WS.view.tagFolderActiveMode = "";
  WS.view.tagFolderActiveTag = "";
  WS.view.tagFolderActiveAlbum = "";
  WS.view.tagFolderOriginPath = "";
  closeActionMenus();
  rebuildDirectoriesEntries();
  const idx = findTagEntryIndex(ctx.mode, ctx.tag, ctx.album);
  WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
  syncPreviewToSelection({ force: true });
  finalizeDirectoryNavigationRender({
    animatePreview: false,
    keepDirectoriesScroll: true,
  }).catch(() => {});
  return true;
}

function applyTagFolderViewState(mode, tag, originPath, album = "") {
  noteResponsiveNavigationInteraction("tag-album-open-close", RESPONSIVE_NAV_TAG_ALBUM_MS);
  WS.view.tagFolderActiveMode = mode;
  WS.view.tagFolderActiveTag = tag;
  WS.view.tagFolderActiveAlbum = String(album || "");
  WS.view.tagFolderOriginPath = String(originPath || "");
  closeActionMenus();
  rebuildDirectoriesEntries();
}

function setTagFolderViewState(mode, tag, originPath, album = "") {
  applyTagFolderViewState(mode, tag, originPath, album);
  WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
  syncPreviewToSelection({ force: true });
  finalizeDirectoryNavigationRender({
    animatePreview: false,
    keepDirectoriesScroll: true,
  })
    .then((rendered) => {
      if (rendered) scheduleTagFolderInitialSelectionPreviewRender();
    })
    .catch(() => {});
}

function renderTagFolderInitialSelectionPreview() {
  if (!isViewingTagFolder()) return false;
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (!entry || entry.kind !== "dir" || !entry.node) return false;
  syncPreviewToSelection({ force: true });
  renderPreviewPane(false, false);
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  return true;
}

function scheduleTagFolderInitialSelectionPreviewRender() {
  requestAnimationFrame(() => {
    renderTagFolderInitialSelectionPreview();
  });
}

function makeTagPreviewNodeForContext(mode, tag, originPath, album = "") {
  const entry = {
    kind: "tag",
    originPath: String(originPath || ""),
  };
  if (mode === "favorites" || mode === "hidden" || mode === "untagged") {
    entry.special = mode;
    entry.label =
      mode === "favorites"
        ? "Favorites"
        : mode === "hidden"
          ? "Hidden"
          : "Untagged";
  } else if (mode === "album") {
    entry.album = String(album || "");
    entry.label = String(album || "") || "Album";
  } else if (mode === "gallery") {
    entry.gallery = String(tag || "");
    entry.label = String(tag || "") || "Gallery";
  } else if (mode === "tag") {
    entry.tag = String(tag || "");
    entry.album = String(album || "");
    entry.label = tagDisplayName(tag) || "Tag";
  }
  return makeTagPreviewNode(entry);
}
