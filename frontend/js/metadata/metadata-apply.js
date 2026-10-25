/* Applying metadata documents
   Reading each document back into WS.meta. */

function metaApplyTagsDocLog(log) {
  if (!log || typeof log !== "object") return;
  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  const oldTagsByPath = new Map();

  for (const p of Object.keys(folders)) {
    const it = folders[p];
    const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
    if (tg.length) oldTagsByPath.set(p, tg);
  }

  const oldTagByFp = new Map();
  seedTagFingerprintFallbackFromPaths(oldTagByFp, oldTagsByPath, folders);
  if (!oldTagByFp.size)
    seedLegacyTagFingerprintFallback(oldTagByFp, log.tagByFp);

  for (const p of Object.keys(folders)) {
    const it = folders[p];
    if (it && Number.isFinite(it.fp)) metaRememberFingerprintForPath(p, it.fp);
  }

  stashPendingTagsFromLog(oldTagsByPath);

  WS.meta.dirTags.clear();
  for (const [path] of WS.dirByPath.entries()) {
    if (oldTagsByPath.has(path)) {
      WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
      if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
      continue;
    }
    const fp = WS.meta.dirFingerprints.get(path) || 0;
    const tg = canRestoreTagsByFingerprintForPath(path, fp)
      ? oldTagByFp.get(fp >>> 0) || []
      : [];
    WS.meta.dirTags.set(path, tg.slice());
  }

  WS.meta.hiddenTagKeys.clear();
  const hiddenTagByKey =
    log.hiddenTagByKey && typeof log.hiddenTagByKey === "object"
      ? log.hiddenTagByKey
      : {};
  for (const rawKey of Object.keys(hiddenTagByKey)) {
    const key = String(rawKey || "");
    if (!key || !hiddenTagByKey[rawKey]) continue;
    WS.meta.hiddenTagKeys.add(key);
  }

  WS.meta.folderMediaFilterByPath.clear();
  const folderMediaFilterByPath =
    log.folderMediaFilterByPath && typeof log.folderMediaFilterByPath === "object"
      ? log.folderMediaFilterByPath
      : {};
  for (const rawPath of Object.keys(folderMediaFilterByPath)) {
    const path = normalizeDirPathValue(rawPath);
    const filterValue = normalizeTagMediaFilterValue(
      folderMediaFilterByPath[rawPath],
    );
    if ((!path && path !== "") || !filterValue.length) continue;
    WS.meta.folderMediaFilterByPath.set(path, filterValue);
  }

  WS.meta.tagMediaFilterByKey.clear();
  const tagMediaFilterByKey =
    log.tagMediaFilterByKey && typeof log.tagMediaFilterByKey === "object"
      ? log.tagMediaFilterByKey
      : {};
  for (const rawKey of Object.keys(tagMediaFilterByKey)) {
    const key = String(rawKey || "");
    const filterValue = Number(log.schema) >= 2
      ? normalizeTagMediaFilterValue(tagMediaFilterByKey[rawKey])
      : migrateLegacyTagMediaFilterValue(tagMediaFilterByKey[rawKey]);
    if (!key || !filterValue.length) continue;
    WS.meta.tagMediaFilterByKey.set(key, filterValue);
  }

  WS.meta.tagParents.clear();
  const tagParents = metadataIsPlainObject(log.tagParents) ? log.tagParents : {};
  for (const rawChild of Object.keys(tagParents)) {
    const child = normalizeTag(rawChild);
    const list = Array.isArray(tagParents[rawChild]) ? tagParents[rawChild] : [];
    const parents = new Set(
      list.map((value) => normalizeTag(value)).filter((p) => p && p !== child),
    );
    if (child && parents.size) WS.meta.tagParents.set(child, parents);
  }
  WS.meta.exclusiveTags.clear();
  for (const raw of Array.isArray(log.exclusiveTags) ? log.exclusiveTags : []) {
    const name = normalizeTag(raw);
    if (name) WS.meta.exclusiveTags.add(name);
  }
  // The old modelOnlyTags / rootOnlyTags lists are not read: those locks are
  // what every Tag does now unless it is set to Use anywhere.
  if (!(WS.meta.useAnywhereTags instanceof Set)) WS.meta.useAnywhereTags = new Set();
  WS.meta.useAnywhereTags.clear();
  for (const raw of Array.isArray(log.useAnywhereTags) ? log.useAnywhereTags : []) {
    const name = normalizeTag(raw);
    if (name) WS.meta.useAnywhereTags.add(name);
  }
  // Written while Tag storage was stored under an older name: the Tags in it
  // move to the current one, and the old name (Exclusive only because it was
  // Tag storage) becomes an ordinary Tag name.
  const storedTagStorageName =
    typeof log.tagStorage === "string" && normalizeTag(log.tagStorage)
      ? normalizeTag(log.tagStorage)
      : TAG_STORAGE_FIRST_NAME;
  if (storedTagStorageName !== TAG_STORAGE_NAME) {
    let moved = false;
    for (const parents of WS.meta.tagParents.values()) {
      if (!parents.delete(storedTagStorageName)) continue;
      parents.add(TAG_STORAGE_NAME);
      moved = true;
    }
    if (WS.meta.exclusiveTags.delete(storedTagStorageName)) moved = true;
    if (moved) metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  }
  if (!(WS.meta.contentTags instanceof Map)) WS.meta.contentTags = new Map();
  WS.meta.contentTags.clear();
  const contentTags = metadataIsPlainObject(log.contentTags) ? log.contentTags : {};
  for (const rawKey of Object.keys(contentTags)) {
    const key = String(rawKey || "");
    let normalizedKey = "";
    if (key.startsWith("dir:")) normalizedKey = `dir:${normalizeDirPathValue(key.slice(4))}`;
    else if (key.startsWith("tag:") && normalizeTag(key.slice(4)))
      normalizedKey = `tag:${normalizeTag(key.slice(4))}`;
    if (!normalizedKey) continue;
    const list = normalizeTagList(
      Array.isArray(contentTags[rawKey]) ? contentTags[rawKey] : [],
    ).filter((tag) => tag && !isReservedFolderTag(tag));
    if (list.length) WS.meta.contentTags.set(normalizedKey, new Set(list));
  }
  WS.meta.scoreFilterOverrides = new Map();
  const scoreFilterOverrides = metadataIsPlainObject(log.scoreFilterOverrides)
    ? log.scoreFilterOverrides
    : {};
  for (const rawKey of Object.keys(scoreFilterOverrides)) {
    const key = String(rawKey || "");
    let normalizedKey = "";
    if (key.startsWith("dir:")) normalizedKey = `dir:${normalizeDirPathValue(key.slice(4))}`;
    else if (key.startsWith("tag:") && normalizeTag(key.slice(4)))
      normalizedKey = `tag:${normalizeTag(key.slice(4))}`;
    const raw = scoreFilterOverrides[rawKey];
    if (!normalizedKey || !metadataIsPlainObject(raw)) continue;
    const entry = {};
    for (const kind of SCORE_FILTER_KINDS) {
      const value = normalizeScoreFilterOverrideValue(raw[kind]);
      if (value !== undefined) entry[kind] = value;
    }
    if (Object.keys(entry).length)
      WS.meta.scoreFilterOverrides.set(normalizedKey, entry);
  }
  bumpScoreFilterRevision();
  invalidateDirMetricsCaches();
}

function metaApplyTagAlbumsDocLog(log) {
  if (!log || typeof log !== "object") return;
  WS.meta.tagAlbumByTag.clear();
  WS.meta.folderAlbumByPath.clear();
  WS.meta.albumTagsByAlbum.clear();
  WS.meta.folderGalleriesByPath.clear();
  WS.meta.galleryMemberTagsByGallery.clear();
  WS.meta.galleryMemberAlbumsByGallery.clear();
  WS.meta.galleryUserTagsByGallery.clear();
  WS.meta.galleryAlbumByGallery.clear();
  const tagAlbumByTag =
    log.tagAlbumByTag && typeof log.tagAlbumByTag === "object"
      ? log.tagAlbumByTag
      : {};
  for (const rawKey of Object.keys(tagAlbumByTag)) {
    const parsed = parseTagAlbumMembershipKey(rawKey);
    const album = normalizeTagAlbumName(tagAlbumByTag[rawKey]);
    if (!parsed || !album) continue;
    WS.meta.tagAlbumByTag.set(parsed.key, album);
  }
  const folderAlbumByPath =
    log.folderAlbumByPath && typeof log.folderAlbumByPath === "object"
      ? log.folderAlbumByPath
      : {};
  for (const rawPath of Object.keys(folderAlbumByPath)) {
    const path = normalizeDirPathValue(rawPath);
    const album = normalizeTagAlbumName(folderAlbumByPath[rawPath]);
    if (!path || !album) continue;
    WS.meta.folderAlbumByPath.set(path, album);
  }
  const albumTagsByAlbum =
    log.albumTagsByAlbum && typeof log.albumTagsByAlbum === "object"
      ? log.albumTagsByAlbum
      : {};
  for (const rawKey of Object.keys(albumTagsByAlbum)) {
    const parsed = parseAlbumTagMembershipKey(rawKey);
    if (!parsed) continue;
    const tags = normalizeTagList(albumTagsByAlbum[rawKey])
      .filter((tag) => !isReservedFolderTag(tag))
      .filter((tag) => tag !== parsed.album);
    if (!tags.length) continue;
    WS.meta.albumTagsByAlbum.set(parsed.key, tags);
  }
  const folderGalleriesByPath =
    log.folderGalleriesByPath && typeof log.folderGalleriesByPath === "object"
      ? log.folderGalleriesByPath
      : {};
  for (const rawPath of Object.keys(folderGalleriesByPath)) {
    const path = normalizeDirPathValue(rawPath);
    const galleries = normalizeTagList(folderGalleriesByPath[rawPath])
      .map(normalizeGalleryName)
      .filter(Boolean);
    if (!path || !galleries.length) continue;
    WS.meta.folderGalleriesByPath.set(path, galleries);
  }
  const galleryMemberTagsByGallery =
    log.galleryMemberTagsByGallery && typeof log.galleryMemberTagsByGallery === "object"
      ? log.galleryMemberTagsByGallery
      : {};
  for (const rawGallery of Object.keys(galleryMemberTagsByGallery)) {
    const gallery = normalizeGalleryName(rawGallery);
    const tags = migrateLegacyGalleryMemberTargets(
      galleryMemberTagsByGallery[rawGallery],
      "tag",
    );
    if (!gallery || !tags.length) continue;
    WS.meta.galleryMemberTagsByGallery.set(gallery, tags);
  }
  const galleryMemberAlbumsByGallery =
    log.galleryMemberAlbumsByGallery && typeof log.galleryMemberAlbumsByGallery === "object"
      ? log.galleryMemberAlbumsByGallery
      : {};
  for (const rawGallery of Object.keys(galleryMemberAlbumsByGallery)) {
    const gallery = normalizeGalleryName(rawGallery);
    const albums = migrateLegacyGalleryMemberTargets(
      galleryMemberAlbumsByGallery[rawGallery],
      "album",
    );
    if (!gallery || !albums.length) continue;
    WS.meta.galleryMemberAlbumsByGallery.set(gallery, albums);
  }
  const galleryUserTagsByGallery =
    log.galleryUserTagsByGallery && typeof log.galleryUserTagsByGallery === "object"
      ? log.galleryUserTagsByGallery
      : {};
  for (const rawGallery of Object.keys(galleryUserTagsByGallery)) {
    const gallery = normalizeGalleryName(rawGallery);
    const tags = normalizeTagList(galleryUserTagsByGallery[rawGallery])
      .filter((tag) => !isReservedFolderTag(tag))
      .filter((tag) => tag !== gallery);
    if (!gallery || !tags.length) continue;
    WS.meta.galleryUserTagsByGallery.set(gallery, tags);
  }
  const galleryAlbumByGallery =
    log.galleryAlbumByGallery && typeof log.galleryAlbumByGallery === "object"
      ? log.galleryAlbumByGallery
      : {};
  for (const rawGallery of Object.keys(galleryAlbumByGallery)) {
    const gallery = normalizeGalleryName(rawGallery);
    const album = normalizeTagAlbumName(galleryAlbumByGallery[rawGallery]);
    if (!gallery || !album || album === gallery) continue;
    WS.meta.galleryAlbumByGallery.set(gallery, album);
  }
  invalidateDirMetricsCaches();
}

function metaApplyTrashDocLog(log) {
  WS.meta.trashItemsByPath.clear();
  if (!log || typeof log !== "object") return;
  const itemsByTrashPath =
    log.itemsByTrashPath && typeof log.itemsByTrashPath === "object"
      ? log.itemsByTrashPath
      : {};
  for (const rawTrashPath of Object.keys(itemsByTrashPath)) {
    const trashPath = normalizeWorkspaceRelPath(rawTrashPath);
    const item =
      itemsByTrashPath[rawTrashPath] &&
      typeof itemsByTrashPath[rawTrashPath] === "object"
        ? itemsByTrashPath[rawTrashPath]
        : null;
    const originalPath = normalizeWorkspaceRelPath(item && item.originalPath);
    const trashedAt =
      typeof item?.trashedAt === "string" && item.trashedAt.trim()
        ? item.trashedAt
        : new Date().toISOString();
    if (!trashPath || !isPathInsideInternalTrash(trashPath)) continue;
    if (!originalPath || isPathInsideInternalTrash(originalPath)) continue;
    WS.meta.trashItemsByPath.set(trashPath, {
      originalPath,
      trashedAt,
    });
  }
}


function metaApplyAspectRatiosDocLog(log) {
  if (!WS.meta.aspectRatios) WS.meta.aspectRatios = new Map();
  WS.meta.aspectRatios.clear();
  if (!log || typeof log !== "object") return;
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
    WS.meta.aspectRatios.set(relPath, entry);
  }
}

function metaApplyAppearancePresetsDocLog(log) {
  if (!log || typeof log !== "object") return;
  WS.meta.appearancePresets = normalizeAppearancePresetList(
    log.presets || log.appearancePresets,
    !Array.isArray(log.presets || log.appearancePresets),
  );
}

function metaMergeOptionsPartial(partialOptions) {
  const source =
    partialOptions && typeof partialOptions === "object" ? partialOptions : {};
  WS.meta.options = normalizeOptions(
    Object.assign({}, WS.meta.options || normalizeOptions(null), source),
  );
}

function metaApplyPreferenceSectionDocLog(docId, log) {
  if (!log || typeof log !== "object") return;
  if (docId === META_DOC_IDS.prefGeneral) {
    WS.meta.dirSortMode = normalizeDirSortMode(
      log.dirSortMode || WS.meta.dirSortMode,
    );
    WS.meta.containerSortByFolderPath.clear();
    const folderSorts =
      log.containerSortByFolderPath &&
      typeof log.containerSortByFolderPath === "object"
        ? log.containerSortByFolderPath
        : {};
    for (const rawPath of Object.keys(folderSorts)) {
      const path = normalizeDirPathValue(rawPath);
      const mode = normalizeContainerSortMode(folderSorts[rawPath]);
      if (!mode || (!path && rawPath !== "")) continue;
      WS.meta.containerSortByFolderPath.set(path, mode);
    }
    WS.meta.containerSortByTagKey.clear();
    const tagSorts =
      log.containerSortByTagKey && typeof log.containerSortByTagKey === "object"
        ? log.containerSortByTagKey
        : {};
    for (const rawKey of Object.keys(tagSorts)) {
      const key = String(rawKey || "");
      const mode = normalizeContainerSortMode(tagSorts[rawKey]);
      if (!key || !mode) continue;
      WS.meta.containerSortByTagKey.set(key, mode);
    }
    if (!WS.meta.folderAltByPath) WS.meta.folderAltByPath = new Map();
    WS.meta.folderAltByPath.clear();
    const folderAlts =
      log.folderAltByPath && typeof log.folderAltByPath === "object"
        ? log.folderAltByPath
        : {};
    for (const rawPath of Object.keys(folderAlts)) {
      const path = normalizeDirPathValue(rawPath);
      const label = String(folderAlts[rawPath] || "").trim();
      if (!path || !label) continue;
      WS.meta.folderAltByPath.set(path, label);
    }
  }
  metaMergeOptionsPartial(log.options || null);
}

function metaApplyAppearanceAssignmentsDocLog(log) {
  if (!log || typeof log !== "object") return;

  WS.meta.dirAppearancePresetIds.clear();
  WS.meta.pendingDirAppearancePresetIds = new Map();
  const mediaPresetByFolder =
    log.mediaPresetByFolder && typeof log.mediaPresetByFolder === "object"
      ? log.mediaPresetByFolder
      : {};
  for (const dirPath of Object.keys(mediaPresetByFolder)) {
    const normalizedDirPath = normalizeDirPathValue(dirPath);
    const presetId = normalizeAppearancePresetIdValue(
      mediaPresetByFolder[dirPath],
    );
    if (!presetId) continue;
    if (!normalizedDirPath && !WS.dirByPath.has("")) continue;
    if (WS.dirByPath.has(normalizedDirPath)) {
      WS.meta.dirAppearancePresetIds.set(normalizedDirPath, presetId);
    } else if (normalizedDirPath) {
      WS.meta.pendingDirAppearancePresetIds.set(normalizedDirPath, presetId);
    }
  }

  WS.meta.tagAppearancePresetIds.clear();
  const mediaPresetByTagContext =
    log.mediaPresetByTagContext &&
    typeof log.mediaPresetByTagContext === "object"
      ? log.mediaPresetByTagContext
      : {};
  for (const rawTagKey of Object.keys(mediaPresetByTagContext)) {
    const tagKey = String(rawTagKey || "");
    const presetId = normalizeAppearancePresetIdValue(
      mediaPresetByTagContext[rawTagKey],
    );
    if (!tagKey || !presetId) continue;
    WS.meta.tagAppearancePresetIds.set(tagKey, presetId);
  }
}

function metaApplyDocLogById(docId, log) {
  if (!metadataDocEnabled(docId)) return;
  switch (docId) {
    case META_DOC_IDS.scores:
      metaApplyScoresDocLog(log);
      return;
    case META_DOC_IDS.scoreHistory:
      metaApplyScoreHistoryDocLog(log);
      return;
    case META_DOC_IDS.dailyJournals:
      metaApplyDailyJournalsDocLog(log);
      return;
    case META_DOC_IDS.tags:
      metaApplyTagsDocLog(log);
      return;
    case META_DOC_IDS.tagAlbums:
      metaApplyTagAlbumsDocLog(log);
      return;
    case META_DOC_IDS.trash:
      metaApplyTrashDocLog(log);
      return;
    case META_DOC_IDS.thumbnails:
      metaApplyThumbnailsDocLog(log);
      return;
    case META_DOC_IDS.aspectRatios:
      metaApplyAspectRatiosDocLog(log);
      return;
    case META_DOC_IDS.appearancePresets:
      metaApplyAppearancePresetsDocLog(log);
      return;
    case META_DOC_IDS.appearanceAssignments:
      metaApplyAppearanceAssignmentsDocLog(log);
      return;
    case META_DOC_IDS.prefGeneral:
    case META_DOC_IDS.prefNotifications:
    case META_DOC_IDS.prefAppearance:
    case META_DOC_IDS.prefPlayback:
    case META_DOC_IDS.prefThumbnails:
    case META_DOC_IDS.prefFilenames:
    case META_DOC_IDS.prefControls:
      metaApplyPreferenceSectionDocLog(docId, log);
      return;
    case META_DOC_IDS.keybinds:
      metaApplyKeybindsLog(log);
      return;
  }
}
