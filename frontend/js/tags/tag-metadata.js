/* Tag metadata
   Tag names and lists, the legacy album/gallery accessors, Favorites and
   Hidden. */

function normalizeTag(t) {
  const s = String(t || "")
    .trim()
    .toLowerCase();
  return s;
}

function normalizeTagAlbumName(name) {
  return normalizeTag(name);
}

function normalizeGalleryName(name) {
  return normalizeTag(name);
}

function normalizeTagAlbumScopePath(scopePath) {
  return normalizeDirPathValue(scopePath);
}

function tagAlbumMembershipKey(tagName, scopePath = null) {
  const tag = normalizeTag(tagName);
  if (!tag) return "";
  if (scopePath == null) return tag;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  return `scope:${encodeURIComponent(normalizedScope)}:${encodeURIComponent(tag)}`;
}

function parseTagAlbumMembershipKey(rawKey) {
  const key = String(rawKey || "");
  if (!key) return null;
  if (key.startsWith("scope:")) {
    const body = key.slice("scope:".length);
    const sep = body.indexOf(":");
    if (sep < 0) return null;
    try {
      const scopePath = normalizeTagAlbumScopePath(
        decodeURIComponent(body.slice(0, sep)),
      );
      const tag = normalizeTag(decodeURIComponent(body.slice(sep + 1)));
      if (!tag) return null;
      return {
        tag,
        scopePath,
        scoped: true,
        key: tagAlbumMembershipKey(tag, scopePath),
      };
    } catch {
      return null;
    }
  }
  const tag = normalizeTag(key);
  if (!tag) return null;
  return {
    tag,
    scopePath: "",
    scoped: false,
    key: tagAlbumMembershipKey(tag, null),
  };
}

function albumTagMembershipKey(albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName);
  if (!album) return "";
  if (scopePath == null) return album;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  return `scope:${encodeURIComponent(normalizedScope)}:${encodeURIComponent(album)}`;
}

function parseAlbumTagMembershipKey(rawKey) {
  const key = String(rawKey || "");
  if (!key) return null;
  if (key.startsWith("scope:")) {
    const body = key.slice("scope:".length);
    const sep = body.indexOf(":");
    if (sep < 0) return null;
    try {
      const scopePath = normalizeTagAlbumScopePath(
        decodeURIComponent(body.slice(0, sep)),
      );
      const album = normalizeTagAlbumName(decodeURIComponent(body.slice(sep + 1)));
      if (!album) return null;
      return {
        album,
        scopePath,
        scoped: true,
        key: albumTagMembershipKey(album, scopePath),
      };
    } catch {
      return null;
    }
  }
  const album = normalizeTagAlbumName(key);
  if (!album) return null;
  return {
    album,
    scopePath: "",
    scoped: false,
    key: albumTagMembershipKey(album, null),
  };
}

function normalizeTagList(list) {
  const out = [];
  const seen = new Set();
  const arr = Array.isArray(list) ? list : [];
  for (let i = 0; i < arr.length; i++) {
    const t = normalizeTag(arr[i]);
    if (!t) continue;
    if (t === LEGACY_PROCESSING_DISABLED_TAG) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function isReservedFolderTag(tag) {
  const t = String(tag || "");
  return t === FAVORITE_TAG || t === HIDDEN_TAG || t === STORAGE_TAG;
}

function normalizeTagsFromText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const parts = raw.split(",").map((s) => normalizeTag(s));
  return normalizeTagList(parts);
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function metaSetTagsForPath(path, tags) {
  const p = normalizeDirPathValue(path);
  if (!WS.meta) return false;
  const next = normalizeTagList(tags).filter(
    (t) => !isInternalTagName(t),
  );
  const current = metaGetTags(p);
  if (arraysEqual(current, next)) return false;
  const loaded = !!(WS.dirByPath && WS.dirByPath.has(p));
  if (loaded || p === "") {
    if (next.length) WS.meta.dirTags.set(p, next);
    else WS.meta.dirTags.delete(p);
    if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(p);
  } else {
    if (next.length) WS.meta.pendingTagsByPath.set(p, next);
    else WS.meta.pendingTagsByPath.delete(p);
    if (WS.meta.dirTags) WS.meta.dirTags.delete(p);
  }
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

function metaWriteUserTags(path, userTags) {
  const p = String(path || "");
  const existing = metaGetTags(p);
  const preserved = existing.filter((t) => isReservedFolderTag(t));
  const refused = new Set();
  const normalized = filterModelOnlyTagsForPath(
    p,
    normalizeTagList(userTags).filter((t) => !isReservedFolderTag(t)),
    refused,
  );
  announceModelOnlyRefusals(refused);
  const merged = preserved.slice();
  for (const tag of normalized) {
    if (!tag) continue;
    if (merged.includes(tag)) continue;
    merged.push(tag);
  }
  return metaSetTagsForPath(p, merged);
}

function metaGetTags(path) {
  const p = String(path || "");
  const direct = WS.meta.dirTags.get(p);
  if (Array.isArray(direct)) return direct.slice();
  const pending =
    WS.meta && WS.meta.pendingTagsByPath
      ? WS.meta.pendingTagsByPath.get(p)
      : null;
  return Array.isArray(pending) ? pending.slice() : [];
}

function metaGetUserTags(path) {
  const tags = metaGetTags(path);
  return tags.filter((t) => !isReservedFolderTag(t));
}

function metaHasStorage(path) {
  const tags = metaGetTags(path);
  return tags.includes(STORAGE_TAG);
}

function pathIsStorageFolder(path) {
  const normalized = normalizeDirPathValue(path);
  return metaHasStorage(normalized);
}

function metaGetTagAlbumForTag(tagName, scopePath = null) {
  const tag = normalizeTag(tagName);
  if (!tag || !WS.meta || !WS.meta.tagAlbumByTag) return "";
  if (scopePath != null) {
    const scopedKey = tagAlbumMembershipKey(tag, scopePath);
    if (scopedKey && WS.meta.tagAlbumByTag.has(scopedKey)) {
      return normalizeTagAlbumName(WS.meta.tagAlbumByTag.get(scopedKey));
    }
  }
  return normalizeTagAlbumName(WS.meta.tagAlbumByTag.get(tag));
}

function metaSetTagAlbumForTag(tagName, albumName, scopePath = null) {
  const tag = normalizeTag(tagName);
  if (!tag || !WS.meta || !WS.meta.tagAlbumByTag) return false;
  const mapKey = tagAlbumMembershipKey(tag, scopePath);
  if (!mapKey) return false;
  const album = normalizeTagAlbumName(albumName);
  if (album && album === tag) return false;
  const hasExactKey = WS.meta.tagAlbumByTag.has(mapKey);
  const prevExact = normalizeTagAlbumName(WS.meta.tagAlbumByTag.get(mapKey));
  if (!album) {
    if (hasExactKey) {
      WS.meta.tagAlbumByTag.delete(mapKey);
      metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
      invalidateDirMetricsCaches();
      return true;
    }
    if (scopePath != null && WS.meta.tagAlbumByTag.has(tag)) {
      WS.meta.tagAlbumByTag.delete(tag);
      metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
      invalidateDirMetricsCaches();
      return true;
    }
    return false;
  }
  if (hasExactKey && prevExact === album) return false;
  WS.meta.tagAlbumByTag.set(mapKey, album);
  if (scopePath != null && hasExactKey === false) {
    const legacyAlbum = normalizeTagAlbumName(WS.meta.tagAlbumByTag.get(tag));
    if (legacyAlbum === album) {
      WS.meta.tagAlbumByTag.delete(tag);
    }
  }
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaGetAlbumForPath(path) {
  const p = normalizeDirPathValue(path);
  if (!p || !WS.meta || !WS.meta.folderAlbumByPath) return "";
  return normalizeTagAlbumName(WS.meta.folderAlbumByPath.get(p));
}

function metaSetAlbumForPath(path, albumName) {
  const p = normalizeDirPathValue(path);
  if (!p || !WS.meta || !WS.meta.folderAlbumByPath) return false;
  const album = normalizeTagAlbumName(albumName);
  const prev = normalizeTagAlbumName(WS.meta.folderAlbumByPath.get(p));
  if (!album) {
    if (!WS.meta.folderAlbumByPath.has(p)) return false;
    WS.meta.folderAlbumByPath.delete(p);
  } else {
    if (prev === album) return false;
    WS.meta.folderAlbumByPath.set(p, album);
  }
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaGetUserTagsForAlbum(albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName);
  if (!album || !WS.meta || !WS.meta.albumTagsByAlbum) return [];
  const key = albumTagMembershipKey(album, scopePath);
  const direct = key ? WS.meta.albumTagsByAlbum.get(key) : null;
  if (Array.isArray(direct)) return direct.slice();
  if (scopePath != null) {
    const legacy = WS.meta.albumTagsByAlbum.get(album);
    if (Array.isArray(legacy)) return legacy.slice();
  }
  return [];
}

function metaSetUserTagsForAlbum(albumName, scopePath, userTags) {
  const album = normalizeTagAlbumName(albumName);
  if (!album || !WS.meta || !WS.meta.albumTagsByAlbum) return false;
  const key = albumTagMembershipKey(album, scopePath);
  if (!key) return false;
  const next = normalizeTagList(userTags)
    .filter((tag) => !isReservedFolderTag(tag))
    .filter((tag) => tag !== album);
  const current = metaGetUserTagsForAlbum(album, scopePath);
  if (arraysEqual(current, next)) return false;
  if (next.length) WS.meta.albumTagsByAlbum.set(key, next);
  else WS.meta.albumTagsByAlbum.delete(key);
  if (scopePath != null && WS.meta.albumTagsByAlbum.has(album)) {
    const legacy = normalizeTagList(WS.meta.albumTagsByAlbum.get(album)).filter(
      (tag) => tag !== album,
    );
    if (arraysEqual(legacy, next)) WS.meta.albumTagsByAlbum.delete(album);
  }
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaGetGalleriesForPath(path) {
  const p = normalizeDirPathValue(path);
  if (!p || !WS.meta || !WS.meta.folderGalleriesByPath) return [];
  return normalizeTagList(WS.meta.folderGalleriesByPath.get(p)).map(
    normalizeGalleryName,
  );
}

function metaSetGalleriesForPath(path, galleries) {
  const p = normalizeDirPathValue(path);
  if (!p || !WS.meta || !WS.meta.folderGalleriesByPath) return false;
  const next = normalizeTagList(galleries).map(normalizeGalleryName).filter(Boolean);
  const current = metaGetGalleriesForPath(p);
  if (arraysEqual(current, next)) return false;
  if (next.length) WS.meta.folderGalleriesByPath.set(p, next);
  else WS.meta.folderGalleriesByPath.delete(p);
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaAddGalleryForPath(path, galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery) return false;
  const current = metaGetGalleriesForPath(path);
  if (current.includes(gallery)) return false;
  return metaSetGalleriesForPath(path, current.concat([gallery]));
}

function normalizeGalleryMemberTargets(values, valueKey) {
  const key = valueKey === "album" ? "album" : "tag";
  const list = Array.isArray(values) ? values : [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const raw = list[i];
    const name =
      key === "album"
        ? normalizeTagAlbumName(
            raw && typeof raw === "object" ? raw.album : raw,
          )
        : normalizeTag(raw && typeof raw === "object" ? raw.tag : raw);
    if (!name || (key === "tag" && isReservedFolderTag(name))) continue;
    const originPath = normalizeTagAlbumScopePath(
      raw && typeof raw === "object" ? raw.originPath : "",
    );
    const identity = `${originPath}\n${name}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    out.push({ [key]: name, originPath });
  }
  return out;
}

function legacyGalleryMemberTargetScopes(nameRaw, valueKey) {
  const key = valueKey === "album" ? "album" : "tag";
  const name =
    key === "album"
      ? normalizeTagAlbumName(nameRaw)
      : normalizeTag(nameRaw);
  const scopes = new Set();
  if (!name || !WS.meta) return scopes;

  if (key === "tag") {
    const addTaggedFolderScopes = (entries) => {
      if (!(entries instanceof Map)) return;
      for (const [pathRaw, tagsRaw] of entries.entries()) {
        if (!normalizeTagList(tagsRaw).includes(name)) continue;
        scopes.add(hiddenTagScopePathForDirPath(pathRaw));
      }
    };
    addTaggedFolderScopes(WS.meta.dirTags);
    addTaggedFolderScopes(WS.meta.pendingTagsByPath);
    if (WS.meta.albumTagsByAlbum instanceof Map) {
      for (const [albumKeyRaw, tagsRaw] of WS.meta.albumTagsByAlbum.entries()) {
        const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
        if (parsed && normalizeTagList(tagsRaw).includes(name))
          scopes.add(parsed.scopePath);
      }
    }
    if (WS.meta.galleryUserTagsByGallery instanceof Map) {
      for (const tagsRaw of WS.meta.galleryUserTagsByGallery.values()) {
        if (normalizeTagList(tagsRaw).includes(name)) scopes.add("");
      }
    }
    return scopes;
  }

  if (WS.meta.folderAlbumByPath instanceof Map) {
    for (const [pathRaw, albumRaw] of WS.meta.folderAlbumByPath.entries()) {
      if (normalizeTagAlbumName(albumRaw) === name)
        scopes.add(hiddenTagScopePathForDirPath(pathRaw));
    }
  }
  if (WS.meta.tagAlbumByTag instanceof Map) {
    for (const [tagKeyRaw, albumRaw] of WS.meta.tagAlbumByTag.entries()) {
      const parsed = parseTagAlbumMembershipKey(tagKeyRaw);
      if (parsed && normalizeTagAlbumName(albumRaw) === name)
        scopes.add(parsed.scopePath);
    }
  }
  if (WS.meta.albumTagsByAlbum instanceof Map) {
    for (const albumKeyRaw of WS.meta.albumTagsByAlbum.keys()) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (parsed && parsed.album === name) scopes.add(parsed.scopePath);
    }
  }
  if (WS.meta.galleryAlbumByGallery instanceof Map) {
    for (const albumRaw of WS.meta.galleryAlbumByGallery.values()) {
      if (normalizeTagAlbumName(albumRaw) === name) scopes.add("");
    }
  }
  return scopes;
}

function migrateLegacyGalleryMemberTargets(values, valueKey) {
  const key = valueKey === "album" ? "album" : "tag";
  const list = Array.isArray(values) ? values : [];
  const migrated = list.map((raw) => {
    if (raw && typeof raw === "object") return raw;
    const name =
      key === "album" ? normalizeTagAlbumName(raw) : normalizeTag(raw);
    if (!name) return raw;
    const scopes = Array.from(legacyGalleryMemberTargetScopes(name, key));
    return { [key]: name, originPath: scopes.length === 1 ? scopes[0] : "" };
  });
  return normalizeGalleryMemberTargets(migrated, key);
}

function metaGetMemberTagTargetsForGallery(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryMemberTagsByGallery) return [];
  return normalizeGalleryMemberTargets(
    WS.meta.galleryMemberTagsByGallery.get(gallery),
    "tag",
  );
}

function metaSetMemberTagTargetsForGallery(galleryName, targets) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryMemberTagsByGallery) return false;
  const next = normalizeGalleryMemberTargets(targets, "tag");
  const current = metaGetMemberTagTargetsForGallery(gallery);
  if (JSON.stringify(current) === JSON.stringify(next)) return false;
  if (next.length) WS.meta.galleryMemberTagsByGallery.set(gallery, next);
  else WS.meta.galleryMemberTagsByGallery.delete(gallery);
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaGetMemberTagsForGallery(galleryName) {
  return normalizeTagList(
    metaGetMemberTagTargetsForGallery(galleryName).map((target) => target.tag),
  );
}

function metaSetMemberTagsForGallery(galleryName, tags) {
  return metaSetMemberTagTargetsForGallery(
    galleryName,
    normalizeTagList(tags).map((tag) => ({ tag, originPath: "" })),
  );
}

function metaGetMemberAlbumTargetsForGallery(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryMemberAlbumsByGallery) return [];
  return normalizeGalleryMemberTargets(
    WS.meta.galleryMemberAlbumsByGallery.get(gallery),
    "album",
  );
}

function metaSetMemberAlbumTargetsForGallery(galleryName, targets) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryMemberAlbumsByGallery) return false;
  const next = normalizeGalleryMemberTargets(targets, "album");
  const current = metaGetMemberAlbumTargetsForGallery(gallery);
  if (JSON.stringify(current) === JSON.stringify(next)) return false;
  if (next.length) WS.meta.galleryMemberAlbumsByGallery.set(gallery, next);
  else WS.meta.galleryMemberAlbumsByGallery.delete(gallery);
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaGetMemberAlbumsForGallery(galleryName) {
  return normalizeTagList(
    metaGetMemberAlbumTargetsForGallery(galleryName).map(
      (target) => target.album,
    ),
  ).map(normalizeTagAlbumName);
}

function metaSetMemberAlbumsForGallery(galleryName, albums) {
  return metaSetMemberAlbumTargetsForGallery(
    galleryName,
    normalizeTagList(albums).map((album) => ({ album, originPath: "" })),
  );
}

function metaGetUserTagsForGallery(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryUserTagsByGallery) return [];
  return normalizeTagList(WS.meta.galleryUserTagsByGallery.get(gallery)).filter(
    (tag) => !isReservedFolderTag(tag),
  );
}

function metaSetUserTagsForGallery(galleryName, tags) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryUserTagsByGallery) return false;
  const next = normalizeTagList(tags)
    .filter((tag) => !isReservedFolderTag(tag))
    .filter((tag) => tag !== gallery);
  const current = metaGetUserTagsForGallery(gallery);
  if (arraysEqual(current, next)) return false;
  if (next.length) WS.meta.galleryUserTagsByGallery.set(gallery, next);
  else WS.meta.galleryUserTagsByGallery.delete(gallery);
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function metaGetAlbumForGallery(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryAlbumByGallery) return "";
  return normalizeTagAlbumName(WS.meta.galleryAlbumByGallery.get(gallery));
}

function metaSetAlbumForGallery(galleryName, albumName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery || !WS.meta || !WS.meta.galleryAlbumByGallery) return false;
  const album = normalizeTagAlbumName(albumName);
  if (album && album === gallery) return false;
  const prev = metaGetAlbumForGallery(gallery);
  if (!album) {
    if (!WS.meta.galleryAlbumByGallery.has(gallery)) return false;
    WS.meta.galleryAlbumByGallery.delete(gallery);
  } else {
    if (prev === album) return false;
    WS.meta.galleryAlbumByGallery.set(gallery, album);
  }
  metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
  invalidateDirMetricsCaches();
  return true;
}

function getAllGalleryNames() {
  const out = new Set();
  if (!WS.meta) return [];
  if (WS.meta.folderGalleriesByPath) {
    for (const galleries of WS.meta.folderGalleriesByPath.values()) {
      normalizeTagList(galleries).forEach((gallery) => out.add(gallery));
    }
  }
  [
    WS.meta.galleryMemberTagsByGallery,
    WS.meta.galleryMemberAlbumsByGallery,
    WS.meta.galleryUserTagsByGallery,
    WS.meta.galleryAlbumByGallery,
  ].forEach((map) => {
    if (!map) return;
    for (const key of map.keys()) {
      const gallery = normalizeGalleryName(key);
      if (gallery) out.add(gallery);
    }
  });
  return Array.from(out).sort((a, b) => String(a).localeCompare(String(b)));
}

function tagAlbumHasScopedAssignmentsForScope(scopePath) {
  if (!WS.meta || !WS.meta.tagAlbumByTag) return false;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  for (const rawKey of WS.meta.tagAlbumByTag.keys()) {
    const parsed = parseTagAlbumMembershipKey(rawKey);
    if (parsed && parsed.scoped && parsed.scopePath === normalizedScope)
      return true;
  }
  return false;
}

function metaHasFavorite(path) {
  const tags = metaGetTags(path);
  return tags.includes(FAVORITE_TAG);
}

function pathIsFavoriteFolder(path) {
  const normalized = normalizeDirPathValue(path);
  return metaHasFavorite(normalized);
}

function metaHasLegacyHidden(path) {
  const tags = metaGetTags(path);
  return tags.includes(HIDDEN_TAG);
}

function hiddenTagScopePathForDirPath(path) {
  const normalized = normalizeDirPathValue(path);
  if (!normalized) return "";
  const node = WS.dirByPath ? WS.dirByPath.get(normalized) : null;
  if (node && node.parent) return String(node.parent.path || "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : "";
}

function hiddenTagKeyForTag(tagName, scopePath = null) {
  return tagThumbnailKeyForTag(tagName, scopePath);
}

// Albums hide through the same hiddenTagKeys set as tags, keyed by the album
// key rather than the tag key, so persistence, rekeying, and the badge/menu
// plumbing all work on albums without a parallel store.
function hiddenTagKeyForAlbum(albumName, scopePath = null) {
  return tagThumbnailKeyForAlbum(albumName, scopePath);
}

function hiddenTagKeyForGallery(galleryName) {
  return tagThumbnailKeyForGallery(galleryName);
}

function hiddenContentVisibleInCurrentView() {
  return !!(
    WS.view.hiddenMode ||
    showHiddenFolderEnabled() ||
    (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden")
  );
}

// A Tag is hidden when it is, or when any Tag holding it is.
function tagIsEffectivelyHidden(tagName, scopePath = null, ancestry = null) {
  const tag = normalizeTag(tagName);
  if (!tag) return false;
  if (metaHasHiddenTagByKey(hiddenTagKeyForTag(tag))) return true;
  const visited = ancestry instanceof Set ? ancestry : new Set();
  if (visited.has(tag)) return false;
  visited.add(tag);
  const parents =
    WS.meta && WS.meta.tagParents instanceof Map ? WS.meta.tagParents.get(tag) : null;
  for (const parent of parents || []) {
    if (tagIsEffectivelyHidden(parent, null, visited)) return true;
  }
  return false;
}

function albumIsEffectivelyHidden(albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName);
  const scope = normalizeTagAlbumScopePath(scopePath);
  if (!album) return false;
  if (metaHasHiddenTagByKey(hiddenTagKeyForAlbum(album, scope))) return true;
  return metaGetUserTagsForAlbum(album, scope).some((tag) =>
    metaHasHiddenTagByKey(hiddenTagKeyForTag(tag, scope)),
  );
}

function galleryIsEffectivelyHidden(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery) return false;
  if (metaHasHiddenTagByKey(hiddenTagKeyForGallery(gallery))) return true;
  if (metaGetUserTagsForGallery(gallery).some((tag) =>
    tagIsEffectivelyHidden(tag, ""),
  ))
    return true;
  const album = metaGetAlbumForGallery(gallery);
  return !!album && albumIsEffectivelyHidden(album, "");
}

function galleryIsHiddenFromCurrentView(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  return !!(
    gallery &&
    !hiddenContentVisibleInCurrentView() &&
    galleryIsEffectivelyHidden(gallery)
  );
}

function getHiddenGalleryNames() {
  if (Array.isArray(EFFECTIVE_HIDDEN_GALLERY_NAMES_CACHE))
    return EFFECTIVE_HIDDEN_GALLERY_NAMES_CACHE.slice();
  EFFECTIVE_HIDDEN_GALLERY_NAMES_CACHE = getAllGalleryNames().filter(
    galleryIsEffectivelyHidden,
  );
  return EFFECTIVE_HIDDEN_GALLERY_NAMES_CACHE.slice();
}

function hiddenTagKeyForEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.special || entry.placeholder)
    return "";
  // A tag that lives inside an album carries both fields; it hides as a tag.
  const tag = normalizeTag(entry.tag || "");
  if (tag) return hiddenTagKeyForTag(tag, String(entry.originPath || ""));
  const album = normalizeTagAlbumName(entry.album || "");
  if (album) return hiddenTagKeyForAlbum(album, String(entry.originPath || ""));
  const gallery = normalizeGalleryName(entry.gallery || "");
  if (gallery) return hiddenTagKeyForGallery(gallery);
  return "";
}

// A folder is hidden when it carries the Hidden mark, or any of its Tags is
// hidden -- directly or through a Tag that holds it.
function metaHasHidden(path) {
  const normalizedPath = normalizeDirPathValue(path);
  if (!normalizedPath) return metaHasLegacyHidden(normalizedPath);
  if (metaHasLegacyHidden(normalizedPath)) return true;
  const userTags = metaGetUserTags(normalizedPath);
  for (let i = 0; i < userTags.length; i++) {
    if (tagIsEffectivelyHidden(userTags[i])) return true;
  }
  return false;
}
