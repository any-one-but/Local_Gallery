/* Folder and Tag settings
   Per-folder and per-Tag appearance presets, hidden state and media type
   filters, and their keys. */

function metaGetFolderAppearancePresetId(path) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.dirAppearancePresetIds) return "";
  const raw = WS.meta.dirAppearancePresetIds.has(p)
    ? WS.meta.dirAppearancePresetIds.get(p)
    : WS.meta.pendingDirAppearancePresetIds
      ? WS.meta.pendingDirAppearancePresetIds.get(p)
      : "";
  const id = normalizeAppearancePresetIdValue(raw);
  return getAppearancePresetById(id) ? id : "";
}

function metaHasFolderAppearancePreset(path) {
  return !!metaGetFolderAppearancePresetId(path);
}

function metaSetFolderAppearancePresetId(path, presetId) {
  if (!WS.meta || !WS.meta.dirAppearancePresetIds) return false;
  const p = normalizeDirPathValue(path);
  const id = normalizeAppearancePresetIdValue(presetId);
  if (!p && p !== "") return false;
  if (p !== "" && !WS.dirByPath.has(p)) return false;
  if (id && !getAppearancePresetById(id)) return false;
  const prev = metaGetFolderAppearancePresetId(p);
  if (prev === id) return false;
  if (id) WS.meta.dirAppearancePresetIds.set(p, id);
  else WS.meta.dirAppearancePresetIds.delete(p);
  metaMarkDirty(META_DOC_IDS.appearanceAssignments);
  return true;
}

function metaClearFolderAppearancePreset(path) {
  return metaSetFolderAppearancePresetId(path, "");
}

function collectLegacyProcessingDisabledPathsFromLog(log) {
  const out = new Set();
  if (!log || typeof log !== "object") return out;
  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  for (const rawPath of Object.keys(folders)) {
    const entry = folders[rawPath];
    const rawTags = entry && Array.isArray(entry.tags) ? entry.tags : [];
    for (let i = 0; i < rawTags.length; i++) {
      if (normalizeTag(rawTags[i]) !== LEGACY_PROCESSING_DISABLED_TAG) continue;
      out.add(normalizeDirPathValue(rawPath));
      break;
    }
  }
  return out;
}

function nearestFolderAppearancePresetIdForPath(path) {
  if (!WS.meta || !WS.meta.dirAppearancePresetIds) return "";
  const normalized = normalizeDirPathValue(path);
  const node = WS.dirByPath && WS.dirByPath.get(normalized);
  if (node) {
    let cur = node;
    while (cur) {
      const id = metaGetFolderAppearancePresetId(cur.path || "");
      if (id) return id;
      cur = cur.parent;
    }
    return "";
  }
  let cur = normalized;
  for (;;) {
    const id = metaGetFolderAppearancePresetId(cur);
    if (id) return id;
    if (!cur) break;
    const idx = cur.lastIndexOf("/");
    cur = idx >= 0 ? cur.slice(0, idx) : "";
  }
  return "";
}

function cleanupLegacyProcessingDisabledMetadata(legacyDisabledPaths = null) {
  if (!WS.meta) return false;
  let changed = false;
  const stripLegacyTagFromMap = (map, normalizeKey, deleteEmpty = false) => {
    if (!map || typeof map.entries !== "function") return;
    for (const [rawKey, rawTags] of Array.from(map.entries())) {
      const tags = Array.isArray(rawTags) ? rawTags : [];
      let hadLegacy = false;
      for (let i = 0; i < tags.length; i++) {
        if (normalizeTag(tags[i]) !== LEGACY_PROCESSING_DISABLED_TAG) continue;
        hadLegacy = true;
        break;
      }
      if (!hadLegacy) continue;
      const nextTags = normalizeTagList(tags);
      const key =
        typeof normalizeKey === "function" ? normalizeKey(rawKey) : rawKey;
      if (deleteEmpty && !nextTags.length) map.delete(rawKey);
      else map.set(key, nextTags);
      changed = true;
    }
  };
  stripLegacyTagFromMap(WS.meta.dirTags, normalizeDirPathValue, false);
  stripLegacyTagFromMap(
    WS.meta.pendingTagsByPath,
    (path) => String(path || ""),
    true,
  );
  if (legacyDisabledPaths instanceof Set && WS.meta.dirAppearancePresetIds) {
    for (const rawPath of legacyDisabledPaths) {
      const path = normalizeDirPathValue(rawPath);
      if (!WS.meta.dirAppearancePresetIds.has(path)) continue;
      const presetId = normalizeAppearancePresetIdValue(
        WS.meta.dirAppearancePresetIds.get(path),
      );
      if (presetId !== BUILTIN_NULL_APPEARANCE_PRESET_ID) continue;
      WS.meta.dirAppearancePresetIds.delete(path);
      changed = true;
    }
  }
  return changed;
}

function normalizeDirPathValue(path) {
  return String(path || "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

function computeCoverCropLayout(aspect, crop) {
  const ar =
    Number.isFinite(Number(aspect)) && Number(aspect) > 0 ? Number(aspect) : 1;
  const c = normalizeThumbCropValue(crop);
  const baseW = ar >= 1 ? ar : 1;
  const baseH = ar >= 1 ? 1 : 1 / ar;
  const w = baseW * c.zoom;
  const h = baseH * c.zoom;
  const u = c.x / 100;
  const v = c.y / 100;
  const minX = 1 - w;
  const minY = 1 - h;
  const left = Math.min(0, Math.max(minX, minX * u));
  const top = Math.min(0, Math.max(minY, minY * v));
  return {
    widthPct: Math.round(w * 100000) / 1000,
    heightPct: Math.round(h * 100000) / 1000,
    leftPct: Math.round(left * 100000) / 1000,
    topPct: Math.round(top * 100000) / 1000,
  };
}

function computeEditorCropWindow(aspect, crop) {
  const ar =
    Number.isFinite(Number(aspect)) && Number(aspect) > 0 ? Number(aspect) : 1;
  const c = normalizeThumbCropValue(crop);
  const safeZoom = Math.max(1, c.zoom);
  const widthFrac = ar >= 1 ? 1 / (ar * safeZoom) : 1 / safeZoom;
  const heightFrac = ar >= 1 ? 1 / safeZoom : ar / safeZoom;
  const clampedW = Math.max(0.0001, Math.min(1, widthFrac));
  const clampedH = Math.max(0.0001, Math.min(1, heightFrac));
  const rangeX = Math.max(0, 1 - clampedW);
  const rangeY = Math.max(0, 1 - clampedH);
  const left = rangeX * (c.x / 100);
  const top = rangeY * (c.y / 100);
  return {
    leftPct: Math.round(left * 100000) / 1000,
    topPct: Math.round(top * 100000) / 1000,
    widthPct: Math.round(clampedW * 100000) / 1000,
    heightPct: Math.round(clampedH * 100000) / 1000,
    rangeXPct: Math.round(rangeX * 100000) / 1000,
    rangeYPct: Math.round(rangeY * 100000) / 1000,
  };
}

// Tag names are library-wide, so every tag-keyed setting (thumbnail, sort,
// filters, media type, hidden) is keyed by the name alone. The scope argument is
// accepted and ignored so old call sites keep working.
function tagThumbnailKeyForTag(tagName, scopePath = null) {
  const tag = normalizeTag(String(tagName || ""));
  return tag ? `tag:${tag}` : "";
}

function tagThumbnailKeyForAlbum(albumName, scopePath = null) {
  const album = normalizeTagAlbumName(String(albumName || ""));
  if (!album) return "";
  if (scopePath == null) return `tag-album:${album}`;
  const scopeKey = tagThumbnailScopeKeyFromPath(scopePath);
  return `tag-album-scope:${encodeURIComponent(album)}:${encodeURIComponent(scopeKey)}`;
}

function tagThumbnailKeyForGallery(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  return gallery ? `tag-gallery:${gallery}` : "";
}

function parseTagThumbnailStructuredKey(tagKey) {
  const key = String(tagKey || "");
  if (!key) return null;
  if (key.startsWith("tag-scope:")) {
    const body = key.slice("tag-scope:".length);
    const sep = body.indexOf(":");
    if (sep <= 0) return null;
    try {
      const tag = normalizeTag(decodeURIComponent(body.slice(0, sep)));
      const scopeRaw = decodeURIComponent(body.slice(sep + 1));
      const scopePath = tagThumbnailScopePathFromKey(scopeRaw);
      if (!tag) return null;
      return { kind: "tag", value: tag, scopePath, scoped: true };
    } catch {
      return null;
    }
  }
  if (key.startsWith("tag-album-scope:")) {
    const body = key.slice("tag-album-scope:".length);
    const sep = body.indexOf(":");
    if (sep <= 0) return null;
    try {
      const album = normalizeTagAlbumName(
        decodeURIComponent(body.slice(0, sep)),
      );
      const scopeRaw = decodeURIComponent(body.slice(sep + 1));
      const scopePath = tagThumbnailScopePathFromKey(scopeRaw);
      if (!album) return null;
      return { kind: "album", value: album, scopePath, scoped: true };
    } catch {
      return null;
    }
  }
  if (key.startsWith("tag:")) {
    const tag = normalizeTag(key.slice(4));
    if (!tag) return null;
    return { kind: "tag", value: tag, scopePath: "", scoped: false };
  }
  if (key.startsWith("tag-gallery:")) {
    const gallery = normalizeGalleryName(key.slice("tag-gallery:".length));
    if (!gallery) return null;
    return { kind: "gallery", value: gallery, scopePath: "", scoped: false };
  }
  if (key.startsWith("tag-album:")) {
    const album = normalizeTagAlbumName(key.slice("tag-album:".length));
    if (!album) return null;
    return { kind: "album", value: album, scopePath: "", scoped: false };
  }
  return null;
}

function tagThumbnailScopeLabelForPath(scopePath) {
  const normalized = normalizeDirPathValue(scopePath);
  if (!normalized) return "root";
  const node = WS.dirByPath.get(normalized) || null;
  return (
    displayPath(normalized) || dirDisplayName(node) || normalized || "folder"
  );
}

function getAllTagAppearancePresetStateKeys() {
  const out = new Set();
  if (WS.meta && WS.meta.tagAppearancePresetIds) {
    for (const key of WS.meta.tagAppearancePresetIds.keys()) {
      const raw = String(key || "");
      if (raw) out.add(raw);
    }
  }
  if (WS.meta && WS.meta.containerSortByTagKey) {
    for (const key of WS.meta.containerSortByTagKey.keys()) {
      const raw = String(key || "");
      if (raw) out.add(raw);
    }
  }
  return Array.from(out);
}

function rekeyTagAppearancePresetState(oldKey, newKey) {
  const source = String(oldKey || "");
  const target = String(newKey || "");
  if (!source || !target || source === target) return false;
  if (!WS.meta) return false;
  let changed = false;
  if (WS.meta.tagAppearancePresetIds?.has(source)) {
    const presetId = normalizeAppearancePresetIdValue(
      WS.meta.tagAppearancePresetIds.get(source),
    );
    if (!WS.meta.tagAppearancePresetIds.has(target) && presetId) {
      WS.meta.tagAppearancePresetIds.set(target, presetId);
    }
    WS.meta.tagAppearancePresetIds.delete(source);
    metaTrackDirtyDocIds([META_DOC_IDS.appearanceAssignments]);
    changed = true;
  }
  if (WS.meta.containerSortByTagKey?.has(source)) {
    const mode = normalizeContainerSortMode(
      WS.meta.containerSortByTagKey.get(source),
    );
    if (!WS.meta.containerSortByTagKey.has(target) && mode) {
      WS.meta.containerSortByTagKey.set(target, mode);
    }
    WS.meta.containerSortByTagKey.delete(source);
    metaTrackDirtyDocIds([META_DOC_IDS.prefGeneral]);
    changed = true;
  }
  return changed;
}

function clearTagAppearancePresetStateByMatch(matchFn) {
  if (
    typeof matchFn !== "function" ||
    !WS.meta ||
    (!WS.meta.tagAppearancePresetIds && !WS.meta.containerSortByTagKey)
  )
    return false;
  const keys = getAllTagAppearancePresetStateKeys();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key || !matchFn(key)) continue;
    if (WS.meta.tagAppearancePresetIds?.delete(key)) {
      metaTrackDirtyDocIds([META_DOC_IDS.appearanceAssignments]);
      changed = true;
    }
    if (WS.meta.containerSortByTagKey?.delete(key)) {
      metaTrackDirtyDocIds([META_DOC_IDS.prefGeneral]);
      changed = true;
    }
  }
  return changed;
}

function getAllHiddenTagStateKeys() {
  const out = new Set();
  if (WS.meta && WS.meta.hiddenTagKeys) {
    for (const key of WS.meta.hiddenTagKeys.values()) {
      const raw = String(key || "");
      if (raw) out.add(raw);
    }
  }
  return Array.from(out);
}

// Tags and albums hide through the same action, so a mixed batch gets the
// neutral noun rather than mislabelling half of it.
function hiddenToggleNounForEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  let tags = 0;
  let albums = 0;
  let galleries = 0;
  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    if (!entry) continue;
    if (String(entry.tag || "").trim()) tags++;
    else if (normalizeTagAlbumName(entry.album || "")) albums++;
    else if (normalizeGalleryName(entry.gallery || "")) galleries++;
  }
  if (galleries && !albums && !tags) return "gallery";
  if (albums && !tags && !galleries) return "album";
  if (tags && !albums && !galleries) return "tag";
  return "item";
}

function metaHasHiddenTagByKey(tagKey) {
  const key = String(tagKey || "");
  return !!(
    key &&
    WS.meta &&
    WS.meta.hiddenTagKeys &&
    WS.meta.hiddenTagKeys.has(key)
  );
}

function metaSetHiddenTagByKey(tagKey, enable) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.hiddenTagKeys) return false;
  const next = !!enable;
  const has = WS.meta.hiddenTagKeys.has(key);
  if (has === next) return false;
  if (next) WS.meta.hiddenTagKeys.add(key);
  else WS.meta.hiddenTagKeys.delete(key);
  metaMarkDirty(META_DOC_IDS.tags);
  invalidateHiddenVisibilityState();
  return true;
}

function rekeyHiddenTagState(oldKey, newKey) {
  const source = String(oldKey || "");
  const target = String(newKey || "");
  if (!source || !target || source === target) return false;
  if (!WS.meta || !WS.meta.hiddenTagKeys || !WS.meta.hiddenTagKeys.has(source))
    return false;
  if (!WS.meta.hiddenTagKeys.has(target)) WS.meta.hiddenTagKeys.add(target);
  WS.meta.hiddenTagKeys.delete(source);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateHiddenVisibilityState();
  return true;
}

function clearHiddenTagStateByMatch(matchFn) {
  if (typeof matchFn !== "function" || !WS.meta || !WS.meta.hiddenTagKeys)
    return false;
  const keys = getAllHiddenTagStateKeys();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key || !matchFn(key)) continue;
    if (WS.meta.hiddenTagKeys.delete(key)) changed = true;
  }
  if (changed) {
    metaTrackDirtyDocIds([META_DOC_IDS.tags]);
    invalidateHiddenVisibilityState();
  }
  return changed;
}

const TAG_MEDIA_FILTER_MEDIA_TYPES = Object.freeze([
  "images",
  "videos",
  "text",
]);
// Aspect-ratio filtering was removed; tag content filters only cover media type.
const TAG_MEDIA_FILTER_TYPES = Object.freeze(
  TAG_MEDIA_FILTER_MEDIA_TYPES.slice(),
);

function normalizeTagMediaFilterValue(value) {
  const enabled = new Set();
  const addType = (type) => {
    const normalized = String(type || "")
      .trim()
      .toLowerCase();
    if (!TAG_MEDIA_FILTER_TYPES.includes(normalized)) return;
    enabled.add(normalized);
  };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) addType(value[i]);
  } else if (value && typeof value === "object") {
    for (let i = 0; i < TAG_MEDIA_FILTER_TYPES.length; i++) {
      const type = TAG_MEDIA_FILTER_TYPES[i];
      if (value[type]) enabled.add(type);
    }
  } else if (typeof value === "string") {
    addType(value);
  }
  return TAG_MEDIA_FILTER_TYPES.filter((type) => enabled.has(type));
}

function migrateLegacyTagMediaFilterValue(value) {
  const legacyTypes = ["images", "videos", "gifs"];
  const hidden = new Set(
    Array.isArray(value)
      ? value.map((type) => String(type || "").trim().toLowerCase())
      : [],
  );
  const hasLegacyFilter = legacyTypes.some((type) => hidden.has(type));
  if (!hasLegacyFilter) return normalizeTagMediaFilterValue(value);
  const shownImages = !hidden.has("images") || !hidden.has("gifs");
  const shownVideos = !hidden.has("videos");
  const migrated = [];
  if (!shownImages) migrated.push("images");
  if (!shownVideos) migrated.push("videos");
  // A non-empty legacy filter was a restricted media view. Text was not an
  // option then, so keep that restriction intact instead of unexpectedly
  // adding Markdown files to an existing Images-only/Videos-only selection.
  migrated.push("text");
  return normalizeTagMediaFilterValue(migrated);
}

function combineTagMediaFilterValues(...values) {
  const hidden = new Set();
  for (let i = 0; i < values.length; i++) {
    const normalized = normalizeTagMediaFilterValue(values[i]);
    for (let j = 0; j < normalized.length; j++) hidden.add(normalized[j]);
  }
  return TAG_MEDIA_FILTER_TYPES.filter((type) => hidden.has(type));
}

function tagMediaFilterValuesEqual(a, b) {
  const left = normalizeTagMediaFilterValue(a);
  const right = normalizeTagMediaFilterValue(b);
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false;
  }
  return true;
}

function isTagMediaFilterValueEmpty(value) {
  return normalizeTagMediaFilterValue(value).length === 0;
}

function toggleTagMediaFilterType(value, type) {
  const normalizedType = String(type || "")
    .trim()
    .toLowerCase();
  if (!TAG_MEDIA_FILTER_TYPES.includes(normalizedType))
    return normalizeTagMediaFilterValue(value);
  const current = new Set(normalizeTagMediaFilterValue(value));
  if (current.has(normalizedType)) current.delete(normalizedType);
  else current.add(normalizedType);
  return TAG_MEDIA_FILTER_TYPES.filter((candidate) =>
    current.has(candidate),
  );
}

// Single-axis (media type or aspect ratio) "show only one" selection on top of
// the underlying hide-list. Returns the value with the axis rewritten so that
// only `onlyType` is shown (others hidden); pass a falsy `onlyType` to clear the
// axis (show all). The other axis is left untouched.
function setTagMediaFilterAxis(value, axis, onlyType) {
  const hidden = new Set(normalizeTagMediaFilterValue(value));
  for (let i = 0; i < axis.length; i++) hidden.delete(axis[i]);
  const only = String(onlyType || "")
    .trim()
    .toLowerCase();
  if (only && axis.includes(only)) {
    for (let i = 0; i < axis.length; i++) {
      if (axis[i] !== only) hidden.add(axis[i]);
    }
  }
  return TAG_MEDIA_FILTER_TYPES.filter((type) => hidden.has(type));
}

// Which single type an axis is currently restricted to ("" means show all).
function tagMediaFilterAxisSelection(value, axis) {
  const hidden = new Set(normalizeTagMediaFilterValue(value));
  const shown = axis.filter((type) => !hidden.has(type));
  return shown.length === 1 ? shown[0] : "";
}

function tagMediaFilterTypeLabel(type) {
  if (type === "images") return "images";
  if (type === "videos") return "videos";
  if (type === "text") return "text";
  if (type === "portrait") return "portrait";
  if (type === "square") return "square";
  if (type === "landscape") return "landscape";
  return String(type || "");
}

function describeTagMediaFilterValue(value, emptyLabel = "All media visible") {
  const normalized = normalizeTagMediaFilterValue(value);
  if (!normalized.length) return emptyLabel;
  return `Hide ${normalized
    .map((type) => tagMediaFilterTypeLabel(type))
    .join(", ")}`;
}

function getAllTagMediaFilterStateKeys() {
  const out = new Set();
  if (WS.meta && WS.meta.tagMediaFilterByKey) {
    for (const key of WS.meta.tagMediaFilterByKey.keys()) {
      const raw = String(key || "");
      if (raw) out.add(raw);
    }
  }
  return Array.from(out);
}

function rekeyTagMediaFilterState(oldKey, newKey) {
  const source = String(oldKey || "");
  const target = String(newKey || "");
  if (!source || !target || source === target) return false;
  if (
    !WS.meta ||
    !WS.meta.tagMediaFilterByKey ||
    !WS.meta.tagMediaFilterByKey.has(source)
  )
    return false;
  const current = normalizeTagMediaFilterValue(
    WS.meta.tagMediaFilterByKey.get(source),
  );
  if (!WS.meta.tagMediaFilterByKey.has(target) && current.length) {
    WS.meta.tagMediaFilterByKey.set(target, current.slice());
  }
  WS.meta.tagMediaFilterByKey.delete(source);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

function clearTagMediaFilterStateByMatch(matchFn) {
  if (typeof matchFn !== "function" || !WS.meta || !WS.meta.tagMediaFilterByKey)
    return false;
  const keys = getAllTagMediaFilterStateKeys();
  let changed = false;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!key || !matchFn(key)) continue;
    if (WS.meta.tagMediaFilterByKey.delete(key)) changed = true;
  }
  if (changed) {
    metaTrackDirtyDocIds([META_DOC_IDS.tags]);
    invalidateDirMetricsCaches();
  }
  return changed;
}

function tagThumbnailScopeKeyFromPath(path) {
  const normalized = normalizeDirPathValue(path);
  return normalized ? normalized : "__root__";
}

function tagThumbnailScopePathFromKey(scopeKey) {
  const raw = String(scopeKey || "");
  return raw === "__root__" ? "" : raw;
}

function tagThumbnailKeyForEntry(entry) {
  if (!entry || entry.kind !== "tag") return "";
  const scopePath = String(
    entry.originPath != null ? entry.originPath : WS.nav?.dirNode?.path || "",
  );
  if (entry.special) {
    if (entry.special === "favorites") {
      return `special:favorites:${tagThumbnailScopeKeyFromPath(scopePath)}`;
    }
    return `special:${String(entry.special || "")}`;
  }
  if (entry.album && !entry.tag) {
    return tagThumbnailKeyForAlbum(entry.album, scopePath);
  }
  if (entry.gallery && !entry.tag && !entry.album) {
    return tagThumbnailKeyForGallery(entry.gallery);
  }
  return tagThumbnailKeyForTag(entry.tag || "", scopePath);
}

function metaGetTagAppearancePresetIdByKey(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagAppearancePresetIds) return "";
  const id = normalizeAppearancePresetIdValue(
    WS.meta.tagAppearancePresetIds.get(key),
  );
  return getAppearancePresetById(id) ? id : "";
}

function metaHasTagAppearancePresetByKey(tagKey) {
  return !!metaGetTagAppearancePresetIdByKey(tagKey);
}

function metaSetTagAppearancePresetIdByKey(tagKey, presetId) {
  const key = String(tagKey || "");
  const id = normalizeAppearancePresetIdValue(presetId);
  if (!key || !WS.meta || !WS.meta.tagAppearancePresetIds) return false;
  if (id && !getAppearancePresetById(id)) return false;
  const prev = metaGetTagAppearancePresetIdByKey(key);
  if (prev === id) return false;
  if (id) WS.meta.tagAppearancePresetIds.set(key, id);
  else WS.meta.tagAppearancePresetIds.delete(key);
  metaMarkDirty(META_DOC_IDS.appearanceAssignments);
  return true;
}

function metaClearTagAppearancePresetByKey(tagKey) {
  return metaSetTagAppearancePresetIdByKey(tagKey, "");
}

function metaGetTagMediaFilterByKey(tagKey) {
  const key = String(tagKey || "");
  // A Model's media view shows its one type and is never stored.
  const modelView = key.startsWith("tag:") ? parseModelMediaViewName(key.slice(4)) : null;
  if (modelView)
    return TAG_MEDIA_FILTER_MEDIA_TYPES.filter((type) => type !== modelView.type);
  if (!key || !WS.meta || !WS.meta.tagMediaFilterByKey) return [];
  return normalizeTagMediaFilterValue(WS.meta.tagMediaFilterByKey.get(key));
}

function metaHasTagMediaFilterByKey(tagKey) {
  return metaGetTagMediaFilterByKey(tagKey).length > 0;
}

function metaSetTagMediaFilterByKey(tagKey, value) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.tagMediaFilterByKey) return false;
  const next = normalizeTagMediaFilterValue(value);
  const prev = normalizeTagMediaFilterValue(WS.meta.tagMediaFilterByKey.get(key));
  if (tagMediaFilterValuesEqual(prev, next)) return false;
  if (next.length) WS.meta.tagMediaFilterByKey.set(key, next);
  else WS.meta.tagMediaFilterByKey.delete(key);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

function metaClearTagMediaFilterByKey(tagKey) {
  return metaSetTagMediaFilterByKey(tagKey, []);
}

function metaGetFolderMediaFilter(path) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.folderMediaFilterByPath) return [];
  return normalizeTagMediaFilterValue(WS.meta.folderMediaFilterByPath.get(p));
}

function metaSetFolderMediaFilter(path, value) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta || !WS.meta.folderMediaFilterByPath) return false;
  if (!p && p !== "") return false;
  if (p !== "" && !WS.dirByPath.has(p)) return false;
  const next = normalizeTagMediaFilterValue(value);
  const prev = metaGetFolderMediaFilter(p);
  if (tagMediaFilterValuesEqual(prev, next)) return false;
  if (next.length) WS.meta.folderMediaFilterByPath.set(p, next);
  else WS.meta.folderMediaFilterByPath.delete(p);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

function metaClearFolderMediaFilter(path) {
  return metaSetFolderMediaFilter(path, []);
}

function metaHasFolderMediaFilter(path) {
  return metaGetFolderMediaFilter(path).length > 0;
}

function nearestFolderMediaFilterForPath(path) {
  if (!WS.meta || !WS.meta.folderMediaFilterByPath) return [];
  let current = normalizeDirPathValue(path);
  for (;;) {
    const filter = metaGetFolderMediaFilter(current);
    if (filter.length) return filter;
    if (!current) break;
    const idx = current.lastIndexOf("/");
    current = idx >= 0 ? current.slice(0, idx) : "";
  }
  return [];
}
