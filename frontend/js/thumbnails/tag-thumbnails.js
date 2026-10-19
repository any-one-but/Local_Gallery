/* Tag thumbnails
   Tag and root thumbnail state and the thumbnails document. */

function quadThumbnailsEnabled() {
  return false;
}

function defaultRotatingThumbnailMode() {
  return "single";
}

function normalizeTagThumbnailMode(mode) {
  const raw = String(mode || "")
    .trim()
    .toLowerCase();
  if (raw === "none" || raw === "single") return raw;
  if (raw === "rotate" || raw === "quad" || raw === "random") return "single";
  return "single";
}

function getTagThumbnailDisplayModeByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key) return defaultRotatingThumbnailMode();
  return metaGetTagThumbnailModeByKey(key);
}

function getAllTagThumbnailStateKeys() {
  const out = new Set();
  if (WS.meta && WS.meta.tagThumbModes) {
    for (const key of WS.meta.tagThumbModes.keys()) {
      const raw = String(key || "");
      if (raw) out.add(raw);
    }
  }
  if (WS.meta && WS.meta.tagThumbPresets) {
    for (const key of WS.meta.tagThumbPresets.keys()) {
      const raw = String(key || "");
      if (raw) out.add(raw);
    }
  }
  return Array.from(out);
}

function rekeyTagThumbnailState(oldKey, newKey) {
  const source = String(oldKey || "");
  const target = String(newKey || "");
  if (!source || !target || source === target) return false;
  let changed = false;
  if (WS.meta && WS.meta.tagThumbModes && WS.meta.tagThumbModes.has(source)) {
    const oldMode = metaStoredTagThumbnailModeByKey(source);
    if (!WS.meta.tagThumbModes.has(target)) {
      WS.meta.tagThumbModes.set(target, oldMode);
    }
    WS.meta.tagThumbModes.delete(source);
    changed = true;
  }
  if (
    WS.meta &&
    WS.meta.tagThumbPresets &&
    WS.meta.tagThumbPresets.has(source)
  ) {
    const oldPreset = metaStoredTagThumbnailPresetRelPathByKey(source);
    if (!WS.meta.tagThumbPresets.has(target) && oldPreset) {
      WS.meta.tagThumbPresets.set(target, oldPreset);
    }
    WS.meta.tagThumbPresets.delete(source);
    changed = true;
  }
  if (changed) metaTrackDirtyDocIds([META_DOC_IDS.thumbnails]);
  return changed;
}

function clearTagThumbnailStateByMatch(matchFn) {
  if (typeof matchFn !== "function") return false;
  const keys = getAllTagThumbnailStateKeys();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key || !matchFn(key)) continue;
    const modeChanged = !!(
      WS.meta &&
      WS.meta.tagThumbModes &&
      WS.meta.tagThumbModes.delete(key)
    );
    const presetChanged = !!(
      WS.meta &&
      WS.meta.tagThumbPresets &&
      WS.meta.tagThumbPresets.delete(key)
    );
    if (modeChanged || presetChanged) changed = true;
  }
  if (changed) metaTrackDirtyDocIds([META_DOC_IDS.thumbnails]);
  return changed;
}

function rootThumbnailKey() {
  return "special:root";
}

// The display reader: the Default mode while Experimental -> Default
// thumbnails only is on.
function metaGetTagThumbnailModeByKey(tagKey) {
  if (defaultThumbnailsOnlyEnabled()) return defaultRotatingThumbnailMode();
  return metaStoredTagThumbnailModeByKey(tagKey);
}

function metaStoredTagThumbnailModeByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagThumbModes)
    return defaultRotatingThumbnailMode();
  return normalizeTagThumbnailMode(WS.meta.tagThumbModes.get(key));
}

function metaSetTagThumbnailModeByKey(tagKey, mode) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagThumbModes) return false;
  if (thumbnailPicksLocked()) return false;
  const nextMode = normalizeTagThumbnailMode(mode);
  const prevMode = metaStoredTagThumbnailModeByKey(key);
  if (prevMode === nextMode) return false;
  WS.meta.tagThumbModes.set(key, nextMode);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function metaGetTagThumbnailPresetRelPathByKey(tagKey) {
  if (defaultThumbnailsOnlyEnabled()) return "";
  return metaStoredTagThumbnailPresetRelPathByKey(tagKey);
}

function metaStoredTagThumbnailPresetRelPathByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagThumbPresets) return "";
  return normalizeWorkspaceRelPath(WS.meta.tagThumbPresets.get(key));
}

function metaHasTagThumbnailPresetByKey(tagKey) {
  return !!metaGetTagThumbnailPresetRelPathByKey(tagKey);
}

function metaSetTagThumbnailPresetByKey(tagKey, relPath) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagThumbPresets || !WS.meta.tagThumbModes)
    return false;
  if (thumbnailPicksLocked()) return false;
  const normalizedRelPath = normalizeWorkspaceRelPath(relPath);
  if (!normalizedRelPath) return false;
  const prevRelPath = metaStoredTagThumbnailPresetRelPathByKey(key);
  const prevMode = metaStoredTagThumbnailModeByKey(key);
  if (prevRelPath === normalizedRelPath && prevMode === "single") return false;
  WS.meta.tagThumbPresets.set(key, normalizedRelPath);
  WS.meta.tagThumbModes.set(key, "single");
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function metaClearTagThumbnailPresetByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagThumbPresets) return false;
  if (thumbnailPicksLocked()) return false;
  if (!WS.meta.tagThumbPresets.has(key)) return false;
  WS.meta.tagThumbPresets.delete(key);
  metaMarkDirty(META_DOC_IDS.thumbnails);
  return true;
}

function tagThumbnailUsesRotationByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || metaGetTagThumbnailModeByKey(key) === "none") return false;
  return !metaHasTagThumbnailPresetByKey(key);
}

function metaSetTagThumbnailRotateByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagThumbModes) return false;
  if (thumbnailPicksLocked()) return false;
  let changed = false;
  if (WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.delete(key))
    changed = true;
  if (metaStoredTagThumbnailModeByKey(key) !== "single") {
    WS.meta.tagThumbModes.set(key, "single");
    changed = true;
  } else if (!WS.meta.tagThumbModes.has(key)) {
    WS.meta.tagThumbModes.set(key, "single");
    changed = true;
  }
  if (changed) metaMarkDirty(META_DOC_IDS.thumbnails);
  return changed;
}

function resetTagThumbnailToDefaultByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta) return false;
  if (thumbnailPicksLocked()) return false;
  let changed = false;
  if (WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.delete(key))
    changed = true;
  if (WS.meta.tagThumbModes && WS.meta.tagThumbModes.delete(key))
    changed = true;
  if (changed) metaMarkDirty(META_DOC_IDS.thumbnails);
  return changed;
}

function buildThumbnailMetadataDocObject() {
  const thumbnailByFolder = {};
  const tagThumbnailModeByTag = {};
  const tagThumbnailByTag = {};
  const fileThumbnailCropByRelPath = {};
  const videoThumbnailTimeByRelPath = {};
  if (WS.meta && WS.meta.dirThumbPresets) {
    for (const [path, rawThumbValue] of WS.meta.dirThumbPresets.entries()) {
      const rawThumb = String(rawThumbValue || "");
      if (
        rawThumb === FOLDER_THUMB_NONE_SENTINEL ||
        rawThumb === FOLDER_THUMB_ROTATE_SENTINEL
      ) {
        thumbnailByFolder[path] = rawThumb;
        continue;
      }
      const presetRelPath = normalizeWorkspaceRelPath(rawThumb);
      if (presetRelPath) thumbnailByFolder[path] = presetRelPath;
    }
  }
  if (WS.meta && WS.meta.pendingDirThumbPresets) {
    for (const [path, rawThumbValue] of WS.meta.pendingDirThumbPresets.entries()) {
      const normalizedPath = normalizeDirPathValue(path);
      if (!normalizedPath || thumbnailByFolder[normalizedPath]) continue;
      const rawThumb = String(rawThumbValue || "");
      if (
        rawThumb === FOLDER_THUMB_NONE_SENTINEL ||
        rawThumb === FOLDER_THUMB_ROTATE_SENTINEL
      ) {
        thumbnailByFolder[normalizedPath] = rawThumb;
        continue;
      }
      const presetRelPath = normalizeWorkspaceRelPath(rawThumb);
      if (presetRelPath) thumbnailByFolder[normalizedPath] = presetRelPath;
    }
  }
  if (WS.meta && WS.meta.tagThumbModes) {
    for (const [tagKey, modeRaw] of WS.meta.tagThumbModes.entries()) {
      const key = String(tagKey || "");
      if (!key) continue;
      const mode = normalizeTagThumbnailMode(modeRaw);
      if (mode === "quad") continue;
      tagThumbnailModeByTag[key] = mode;
    }
  }
  if (WS.meta && WS.meta.tagThumbPresets) {
    for (const [tagKey, relPathRaw] of WS.meta.tagThumbPresets.entries()) {
      const key = String(tagKey || "");
      if (!key) continue;
      const relPath = normalizeWorkspaceRelPath(relPathRaw);
      if (relPath) tagThumbnailByTag[key] = relPath;
    }
  }
  if (WS.meta && WS.meta.fileThumbCrop) {
    for (const [relPathRaw, cropRaw] of WS.meta.fileThumbCrop.entries()) {
      const relPath = normalizeWorkspaceRelPath(relPathRaw);
      if (!relPath) continue;
      const normalizedCrop = normalizeThumbCropValue(cropRaw);
      if (!isThumbCropDefault(normalizedCrop))
        fileThumbnailCropByRelPath[relPath] = normalizedCrop;
    }
  }
  if (WS.meta && WS.meta.videoThumbTime) {
    for (const [relPathRaw, timeRaw] of WS.meta.videoThumbTime.entries()) {
      const relPath = normalizeWorkspaceRelPath(relPathRaw);
      const timeValue = normalizeVideoThumbTimeValue(timeRaw);
      if (relPath && Number.isFinite(timeValue))
        videoThumbnailTimeByRelPath[relPath] = timeValue;
    }
  }
  const fileIdentityByRelPath = thumbnailFileIdentitiesForDoc([
    ...Object.values(thumbnailByFolder),
    ...Object.values(tagThumbnailByTag),
    ...Object.keys(fileThumbnailCropByRelPath),
    ...Object.keys(videoThumbnailTimeByRelPath),
  ]);
  return {
    schema: 1,
    updatedAt: Date.now(),
    thumbnailByFolder,
    tagThumbnailModeByTag,
    tagThumbnailByTag,
    fileThumbnailCropByRelPath,
    videoThumbnailTimeByRelPath,
    fileIdentityByRelPath,
  };
}

function metaMakeThumbnailsDocObject() {
  return buildThumbnailMetadataDocObject();
}

function applyThumbnailMetadataDocLog(log) {
  if (!log || typeof log !== "object") return;

  if (!(WS.meta.thumbFileIdentity instanceof Map))
    WS.meta.thumbFileIdentity = new Map();
  WS.meta.thumbFileIdentity.clear();
  const fileIdentityByRelPath =
    log.fileIdentityByRelPath && typeof log.fileIdentityByRelPath === "object"
      ? log.fileIdentityByRelPath
      : {};
  for (const rawRelPath of Object.keys(fileIdentityByRelPath)) {
    const relPath = normalizeWorkspaceRelPath(rawRelPath);
    const identity = String(fileIdentityByRelPath[rawRelPath] || "");
    if (relPath && identity) WS.meta.thumbFileIdentity.set(relPath, identity);
  }

  WS.meta.dirThumbPresets.clear();
  WS.meta.pendingDirThumbPresets = new Map();
  const thumbnailByFolder =
    log.thumbnailByFolder && typeof log.thumbnailByFolder === "object"
      ? log.thumbnailByFolder
      : {};
  for (const dirPath of Object.keys(thumbnailByFolder)) {
    const normalizedDirPath = normalizeDirPathValue(dirPath);
    const rawValue = String(thumbnailByFolder[dirPath] || "");
    const normalizedRelPath = normalizeWorkspaceRelPath(rawValue);
    if (
      !normalizedRelPath &&
      rawValue !== FOLDER_THUMB_NONE_SENTINEL &&
      rawValue !== FOLDER_THUMB_ROTATE_SENTINEL
    )
      continue;
    const finalValue =
      rawValue === FOLDER_THUMB_NONE_SENTINEL ||
      rawValue === FOLDER_THUMB_ROTATE_SENTINEL
        ? rawValue
        : normalizedRelPath;
    if (!normalizedDirPath && !WS.dirByPath.has("")) continue;
    if (WS.dirByPath.has(normalizedDirPath)) {
      WS.meta.dirThumbPresets.set(normalizedDirPath, finalValue);
    } else if (normalizedDirPath) {
      WS.meta.pendingDirThumbPresets.set(normalizedDirPath, finalValue);
    }
  }

  WS.meta.tagThumbModes.clear();
  const tagThumbnailModeByTag =
    log.tagThumbnailModeByTag && typeof log.tagThumbnailModeByTag === "object"
      ? log.tagThumbnailModeByTag
      : {};
  for (const rawKey of Object.keys(tagThumbnailModeByTag)) {
    const key = String(rawKey || "");
    if (!key) continue;
    const mode = normalizeTagThumbnailMode(tagThumbnailModeByTag[rawKey]);
    if (mode === "quad") continue;
    WS.meta.tagThumbModes.set(key, mode);
  }

  WS.meta.tagThumbPresets.clear();
  const tagThumbnailByTag =
    log.tagThumbnailByTag && typeof log.tagThumbnailByTag === "object"
      ? log.tagThumbnailByTag
      : {};
  for (const rawKey of Object.keys(tagThumbnailByTag)) {
    const key = String(rawKey || "");
    const relPath = normalizeWorkspaceRelPath(tagThumbnailByTag[rawKey]);
    if (key && relPath) WS.meta.tagThumbPresets.set(key, relPath);
  }
  for (const key of WS.meta.tagThumbPresets.keys()) {
    if (!WS.meta.tagThumbModes.has(key)) WS.meta.tagThumbModes.set(key, "single");
  }

  WS.meta.fileThumbCrop.clear();
  const fileThumbnailCropByRelPath =
    log.fileThumbnailCropByRelPath &&
    typeof log.fileThumbnailCropByRelPath === "object"
      ? log.fileThumbnailCropByRelPath
      : {};
  for (const rawRelPath of Object.keys(fileThumbnailCropByRelPath)) {
    const relPath = normalizeWorkspaceRelPath(rawRelPath);
    const crop = normalizeThumbCropValue(fileThumbnailCropByRelPath[rawRelPath]);
    if (relPath && !isThumbCropDefault(crop)) WS.meta.fileThumbCrop.set(relPath, crop);
  }

  WS.meta.videoThumbTime.clear();
  const videoThumbnailTimeByRelPath =
    log.videoThumbnailTimeByRelPath &&
    typeof log.videoThumbnailTimeByRelPath === "object"
      ? log.videoThumbnailTimeByRelPath
      : {};
  for (const rawRelPath of Object.keys(videoThumbnailTimeByRelPath)) {
    const relPath = normalizeWorkspaceRelPath(rawRelPath);
    const timeValue = normalizeVideoThumbTimeValue(
      videoThumbnailTimeByRelPath[rawRelPath],
    );
    if (relPath && Number.isFinite(timeValue))
      WS.meta.videoThumbTime.set(relPath, timeValue);
  }
}

function metaApplyThumbnailsDocLog(log) {
  return applyThumbnailMetadataDocLog(log);
}
