/* Thumbnail metadata
   Crops, video frames and folder thumbnail modes as stored. */

/* =========================================================
       Custom thumbnail restore
       ========================================================= */

function resetThumbnailRuntimeStateV3() {
  try { clearQueuedThumbnailWork(); } catch {}
  try { closeThumbnailCropEditor(); } catch {}
  try { resetVideoThumbnailFrameSeekRuntime(); } catch {}
  try {
    if (LOADED_THUMB_RELEASE_TIMER) clearTimeout(LOADED_THUMB_RELEASE_TIMER);
    LOADED_THUMB_RELEASE_TIMER = 0;
    clearPreloadMediaCache();
  } catch {}
  try {
    WS.thumbnailDesiredIds = new Set();
    WS.thumbnailPriorityIds = new Set();
    WS.thumbnailRootPinnedIds = new Set();
    WS.thumbnailActiveWorkspaceIds = new Set();
    WS.thumbnailActiveWorkspaceRootChild = "";
    WS.thumbnailWorkspacePreloadKey = "";
    WS.thumbnailDemandToken = 0;
    WS.videoThumbPriorityQueue = [];
    WS.videoThumbQueue = [];
    WS.imageThumbPriorityQueue = [];
    WS.imageThumbQueue = [];
    WS.videoThumbQueuedIds = new Set();
    WS.imageThumbQueuedIds = new Set();
    WS.videoThumbInFlightIds = new Set();
    WS.imageThumbInFlightIds = new Set();
    WS.videoThumbInFlightBackgroundIds = new Set();
    WS.videoThumbActive = 0;
    WS.imageThumbActive = 0;
  } catch {}
}

function ensureThumbUrl(rec, opts = null) {
  if (!rec || rec.isMissingPlaceholder || rec.type !== "image") return null;
  if (!mediaThumbnailsEnabled()) return null;
  return ensureMediaUrl(rec) || null;
}

function ensureNavigationThumbUrl(rec) {
  return ensureThumbUrl(rec);
}

function getPassivePreviewSrcForRecord(rec, opts = null) {
  if (!rec || rec.isMissingPlaceholder) return "";
  if (rec.type !== "image" && rec.type !== "video") return "";
  // Every card builder starts its markup at the item-icon fallback and only
  // replaces it when this returns a src, so returning "" is all it takes for a
  // tile to show its icon. The preview pane is unaffected: its one call site
  // falls through to ensureMediaUrl for the media actually being viewed.
  if (!mediaThumbnailsEnabled()) return "";
  return String(ensureMediaUrl(rec) || "");
}

function normalizeThumbCropValue(crop) {
  const src = crop && typeof crop === "object" ? crop : {};
  const xRaw = Number(src.x);
  const yRaw = Number(src.y);
  const zoomRaw = Number(src.zoom);
  const x = Number.isFinite(xRaw) ? Math.min(100, Math.max(0, xRaw)) : 50;
  const y = Number.isFinite(yRaw) ? Math.min(100, Math.max(0, yRaw)) : 50;
  const zoom = Number.isFinite(zoomRaw) ? Math.min(4, Math.max(1, zoomRaw)) : 1;
  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    zoom: Math.round(zoom * 1000) / 1000,
  };
}

function isThumbCropDefault(crop) {
  const normalized = normalizeThumbCropValue(crop);
  return normalized.x === 50 && normalized.y === 50 && normalized.zoom === 1;
}

function normalizeVideoThumbTimeValue(timeValue, durationHint = null) {
  const raw = Number(timeValue);
  if (!Number.isFinite(raw)) return null;
  let out = Math.max(0, raw);
  const duration = Number(durationHint);
  if (Number.isFinite(duration) && duration > 0) {
    out = Math.min(out, Math.max(0, duration - 0.05));
  }
  return Math.round(out * 1000) / 1000;
}

function metaGetVideoThumbnailTimeByRelPath(relPath) {
  const key = normalizeWorkspaceRelPath(relPath);
  if (
    !key ||
    !WS.meta ||
    !WS.meta.videoThumbTime ||
    !WS.meta.videoThumbTime.has(key)
  )
    return null;
  return normalizeVideoThumbTimeValue(WS.meta.videoThumbTime.get(key));
}

function metaThumbLookupKeysForRecord(rec) {
  const keys = [];
  const seen = new Set();
  const add = (key) => {
    const normalized = normalizeWorkspaceRelPath(key);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    keys.push(normalized);
  };
  add(altCanonicalThumbKeyForRecord(rec));
  add(rec && rec.relPath);
  add(altIdentityRelPath(rec && rec.relPath));
  return keys;
}

function metaStoredThumbKeyMatchingIdentity(map, identity) {
  if (!identity || !map || !map.size) return "";
  if (map.has(identity)) return identity;
  for (const key of map.keys()) {
    if (altIdentityRelPath(key) === identity) return key;
  }
  return "";
}

// The display reader: nothing while Experimental -> Thumbnail edits is off.
function metaGetVideoThumbnailTimeForRecord(rec) {
  if (!thumbnailEditsEnabled()) return null;
  return metaStoredVideoThumbnailTimeForRecord(rec);
}

// What is actually stored, whatever the display switches say.
function metaStoredVideoThumbnailTimeForRecord(rec) {
  if (!rec || rec.type !== "video") return null;
  const keys = metaThumbLookupKeysForRecord(rec);
  for (let i = 0; i < keys.length; i++) {
    const value = metaGetVideoThumbnailTimeByRelPath(keys[i]);
    if (value != null) return value;
  }
  const identity = altCanonicalThumbKeyForRecord(rec);
  const storedKey = metaStoredThumbKeyMatchingIdentity(
    WS.meta && WS.meta.videoThumbTime,
    identity,
  );
  return storedKey ? metaGetVideoThumbnailTimeByRelPath(storedKey) : null;
}

function metaSetVideoThumbnailTimeForRecord(
  rec,
  timeValue,
  durationHint = null,
) {
  if (!rec || rec.type !== "video") return false;
  if (!thumbnailEditsEnabled()) return false;
  const identity = altCanonicalThumbKeyForRecord(rec);
  const key = identity || normalizeWorkspaceRelPath(rec.relPath);
  if (!key || !WS.meta || !WS.meta.videoThumbTime) return false;
  const normalized = normalizeVideoThumbTimeValue(timeValue, durationHint);
  const matchingKey = metaStoredThumbKeyMatchingIdentity(
    WS.meta.videoThumbTime,
    identity || altIdentityRelPath(key),
  );
  if (!Number.isFinite(normalized)) {
    let had = WS.meta.videoThumbTime.delete(key);
    if (matchingKey && matchingKey !== key)
      had = WS.meta.videoThumbTime.delete(matchingKey) || had;
    if (had) metaMarkDirty(META_DOC_IDS.thumbnails);
    return had;
  }
  const prev = metaStoredVideoThumbnailTimeForRecord(rec);
  if (Number.isFinite(prev) && Math.abs(prev - normalized) < 0.001)
    return false;
  if (matchingKey && matchingKey !== key) WS.meta.videoThumbTime.delete(matchingKey);
  WS.meta.videoThumbTime.set(key, normalized);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function metaGetFileThumbnailCropByRelPath(relPath) {
  const key = normalizeWorkspaceRelPath(relPath);
  if (
    !key ||
    !WS.meta ||
    !WS.meta.fileThumbCrop ||
    !WS.meta.fileThumbCrop.has(key)
  )
    return null;
  return normalizeThumbCropValue(WS.meta.fileThumbCrop.get(key));
}

// The display reader: nothing while Experimental -> Thumbnail edits is off.
function metaGetFileThumbnailCropForRecord(rec) {
  if (!thumbnailEditsEnabled()) return null;
  return metaStoredFileThumbnailCropForRecord(rec);
}

function metaStoredFileThumbnailCropForRecord(rec) {
  const keys = metaThumbLookupKeysForRecord(rec);
  for (let i = 0; i < keys.length; i++) {
    const crop = metaGetFileThumbnailCropByRelPath(keys[i]);
    if (crop) return crop;
  }
  const identity = altCanonicalThumbKeyForRecord(rec);
  const storedKey = metaStoredThumbKeyMatchingIdentity(
    WS.meta && WS.meta.fileThumbCrop,
    identity,
  );
  return storedKey ? metaGetFileThumbnailCropByRelPath(storedKey) : null;
}

function metaSetFileThumbnailCropForRecord(rec, crop) {
  if (!thumbnailEditsEnabled()) return false;
  const identity = altCanonicalThumbKeyForRecord(rec);
  const key = identity || normalizeWorkspaceRelPath(rec && rec.relPath);
  if (!key || !WS.meta || !WS.meta.fileThumbCrop) return false;
  const normalized = normalizeThumbCropValue(crop);
  const matchingKey = metaStoredThumbKeyMatchingIdentity(
    WS.meta.fileThumbCrop,
    identity || altIdentityRelPath(key),
  );
  if (isThumbCropDefault(normalized)) {
    let had = WS.meta.fileThumbCrop.delete(key);
    if (matchingKey && matchingKey !== key)
      had = WS.meta.fileThumbCrop.delete(matchingKey) || had;
    if (had) metaMarkDirty(META_DOC_IDS.thumbnails);
    return had;
  }
  const prev = metaStoredFileThumbnailCropForRecord(rec);
  if (
    prev &&
    prev.x === normalized.x &&
    prev.y === normalized.y &&
    prev.zoom === normalized.zoom
  )
    return false;
  if (matchingKey && matchingKey !== key) WS.meta.fileThumbCrop.delete(matchingKey);
  WS.meta.fileThumbCrop.set(key, normalized);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function fileThumbCropLayoutStyle(rec, rotateKey = "") {
  if (!rec || rotateKey) return "";
  if (naturalAspectThumbnailCardsEnabled()) return "";
  const crop = metaGetFileThumbnailCropForRecord(rec);
  if (!crop) return "";
  const aspect = getPreviewAspectForRecord(rec);
  const layout = computeCoverCropLayout(aspect, crop);
  return `width:${layout.widthPct}% !important;height:${layout.heightPct}% !important;left:${layout.leftPct}% !important;top:${layout.topPct}% !important;`;
}

// Apply a custom thumbnail crop to a media element. The crop layout depends on
// the media's real aspect ratio, so we (re)apply it once the natural size is
// known. Aspect is measured on demand here (no persisted aspect tracking).
function applyFileThumbCropStyle(mediaEl, rec) {
  if (!mediaEl || !rec) return false;
  const cropStyle = fileThumbCropLayoutStyle(rec, "");
  if (!cropStyle) return false;
  mediaEl.classList.add("thumbCropApplied", "thumbCropAbsolute");
  // Later cssText declarations win, so re-applying with a corrected aspect
  // simply overrides the earlier (fallback-aspect) crop layout.
  mediaEl.style.cssText += cropStyle;
  return true;
}

function attachFileThumbCropAspectReapply(mediaEl, rec) {
  if (!mediaEl || !rec) return;
  if (!metaGetFileThumbnailCropForRecord(rec)) return;
  const isVideo = mediaEl.tagName === "VIDEO";
  const reapply = () => {
    const w = isVideo
      ? Number(mediaEl.videoWidth)
      : Number(mediaEl.naturalWidth);
    const h = isVideo
      ? Number(mediaEl.videoHeight)
      : Number(mediaEl.naturalHeight);
    if (w > 0 && h > 0) {
      rec.previewAspect = normalizePreviewAspect(
        w / h,
        getPreviewAspectForRecord(rec),
      );
      applyFileThumbCropStyle(mediaEl, rec);
    }
  };
  mediaEl.addEventListener(isVideo ? "loadedmetadata" : "load", reapply);
  const ready = isVideo
    ? mediaEl.readyState >= 1 && Number(mediaEl.videoWidth) > 0
    : mediaEl.complete && Number(mediaEl.naturalWidth) > 0;
  if (ready) reapply();
}

// Re-apply custom crops to rendered inline (folder/tag preset) thumbnail images
// once their natural size is known. The crop markup is generated as an HTML
// string with the focal layout baked in against a fallback aspect, so this
// corrects it after load. Safe to call repeatedly.
function reapplyInlineThumbCropsIn(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== "function") return;
  const imgs = rootEl.querySelectorAll(
    "img.dirInlinePreview.thumbCropApplied[data-dir-preview-id]",
  );
  for (const img of imgs) {
    if (img.dataset.thumbCropReapplyBound === "1") continue;
    const rec = WS.fileById.get(String(img?.dataset?.dirPreviewId || ""));
    if (!rec) continue;
    img.dataset.thumbCropReapplyBound = "1";
    attachFileThumbCropAspectReapply(img, rec);
  }
}

function inferFolderThumbnailDefaultMode(path) {
  const p = normalizeDirPathValue(path);
  if (!p) return "single";
  const node = WS.dirByPath ? WS.dirByPath.get(p) : null;
  if (!node) return "single";
  const hasImmediateFiles =
    Array.isArray(node.childrenFiles) && node.childrenFiles.length > 0;
  if (hasImmediateFiles) return "single";
  // A Model holds only Sets, and on Default it shows the first picture inside
  // them -- the picture its Storage card shows, so taking a Model out of
  // Storage does not leave it blank. Blank is still one pick away.
  return node.parent === WS.root && !isPathInsideInternalTrash(p)
    ? "single"
    : "none";
}

// The display reader: the Default mode while Experimental -> Default
// thumbnails only is on.
function metaGetFolderThumbnailMode(path) {
  if (defaultThumbnailsOnlyEnabled())
    return inferFolderThumbnailDefaultMode(normalizeDirPathValue(path));
  return metaStoredFolderThumbnailMode(path);
}

function metaStoredFolderThumbnailMode(path) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.dirThumbPresets || !WS.meta.dirThumbPresets.has(p)) {
    return inferFolderThumbnailDefaultMode(p);
  }
  const raw = String(WS.meta.dirThumbPresets.get(p) || "");
  if (raw === FOLDER_THUMB_NONE_SENTINEL) return "none";
  if (raw === FOLDER_THUMB_ROTATE_SENTINEL) return "rotate";
  const normalizedRelPath = normalizeWorkspaceRelPath(raw);
  return normalizedRelPath ? "manual" : inferFolderThumbnailDefaultMode(p);
}

function metaGetFolderThumbnailPresetRelPath(path) {
  if (defaultThumbnailsOnlyEnabled()) return "";
  return metaStoredFolderThumbnailPresetRelPath(path);
}

function metaStoredFolderThumbnailPresetRelPath(path) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.dirThumbPresets) return "";
  const raw = String(WS.meta.dirThumbPresets.get(p) || "");
  if (
    raw === FOLDER_THUMB_NONE_SENTINEL ||
    raw === FOLDER_THUMB_ROTATE_SENTINEL
  )
    return "";
  return normalizeWorkspaceRelPath(raw);
}

function metaHasFolderThumbnailPreset(path) {
  return metaGetFolderThumbnailMode(path) === "manual";
}

function metaSetFolderThumbnailPreset(path, relPath) {
  if (!WS.meta || !WS.meta.dirThumbPresets) return false;
  if (thumbnailPicksLocked()) return false;
  const p = normalizeDirPathValue(path);
  if (!WS.dirByPath.has(p)) return false;
  const normalizedRelPath = normalizeWorkspaceRelPath(relPath);
  if (!normalizedRelPath) return false;
  const prev = metaStoredFolderThumbnailPresetRelPath(p);
  if (prev === normalizedRelPath && metaStoredFolderThumbnailMode(p) === "manual")
    return false;
  WS.meta.dirThumbPresets.set(p, normalizedRelPath);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function metaSetFolderThumbnailNone(path) {
  if (!WS.meta || !WS.meta.dirThumbPresets) return false;
  const p = normalizeDirPathValue(path);
  if (thumbnailPicksLocked()) return false;
  if (!WS.dirByPath.has(p)) return false;
  if (metaStoredFolderThumbnailMode(p) === "none") return false;
  WS.meta.dirThumbPresets.set(p, FOLDER_THUMB_NONE_SENTINEL);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function metaSetFolderThumbnailRotate(path) {
  if (!WS.meta || !WS.meta.dirThumbPresets) return false;
  const p = normalizeDirPathValue(path);
  if (thumbnailPicksLocked()) return false;
  if (!WS.dirByPath.has(p)) return false;
  if (metaStoredFolderThumbnailMode(p) === "rotate") return false;
  WS.meta.dirThumbPresets.set(p, FOLDER_THUMB_ROTATE_SENTINEL);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function metaClearFolderThumbnailPreset(path) {
  if (!WS.meta || !WS.meta.dirThumbPresets) return false;
  if (thumbnailPicksLocked()) return false;
  const p = normalizeDirPathValue(path);
  if (!WS.meta.dirThumbPresets.has(p)) return false;
  WS.meta.dirThumbPresets.delete(p);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function remapFolderThumbnailPresetValues(relPathMap) {
  if (!WS.meta || !relPathMap || !relPathMap.size) return;
  const remapRelPath = (relPath) =>
    normalizeWorkspaceRelPath(
      relPathMap.get(normalizeWorkspaceRelPath(relPath)) || relPath,
    );
  if (WS.meta.dirThumbPresets) {
    const next = new Map();
    for (const [dirPath, relPath] of WS.meta.dirThumbPresets.entries()) {
      const raw = String(relPath || "");
      if (
        raw === FOLDER_THUMB_NONE_SENTINEL ||
        raw === FOLDER_THUMB_ROTATE_SENTINEL
      ) {
        next.set(dirPath, raw);
        continue;
      }
      const normalized = remapRelPath(raw);
      if (normalized) next.set(dirPath, normalized);
    }
    WS.meta.dirThumbPresets = next;
  }
  if (WS.meta.tagThumbPresets) {
    const nextTag = new Map();
    for (const [tagKey, relPath] of WS.meta.tagThumbPresets.entries()) {
      const normalized = remapRelPath(relPath);
      if (normalized) nextTag.set(String(tagKey || ""), normalized);
    }
    WS.meta.tagThumbPresets = nextTag;
  }
  if (WS.meta.fileThumbCrop) {
    const nextFile = new Map();
    for (const [relPath, crop] of WS.meta.fileThumbCrop.entries()) {
      const normalized = remapRelPath(relPath);
      if (normalized) nextFile.set(normalized, normalizeThumbCropValue(crop));
    }
    WS.meta.fileThumbCrop = nextFile;
  }
  if (WS.meta.videoThumbTime) {
    const nextVideo = new Map();
    for (const [relPath, timeValue] of WS.meta.videoThumbTime.entries()) {
      const normalized = remapRelPath(relPath);
      const time = normalizeVideoThumbTimeValue(timeValue);
      if (normalized && Number.isFinite(time)) nextVideo.set(normalized, time);
    }
    WS.meta.videoThumbTime = nextVideo;
  }
}

function metaSetFolderThumbnailModeBulk(paths, mode) {
  const nextMode = mode === "none" ? "none" : "rotate";
  const list = Array.isArray(paths) ? paths : Array.from(paths || []);
  if (!list.length) return false;
  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const p = normalizeDirPathValue(list[i]);
    if (!p || !WS.dirByPath.has(p)) continue;
    if (nextMode === "none") {
      if (metaSetFolderThumbnailNone(p)) changed = true;
    } else if (metaSetFolderThumbnailRotate(p)) {
      changed = true;
    }
  }
  return changed;
}
