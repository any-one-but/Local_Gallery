/* Tag actions
   Tag menu actions: assignments, renames and deletes. */

function createTagMenuButton(label, onClick, disabled = false, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  btn.disabled = !!disabled;
  if (className) btn.className = String(className);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btn.disabled) return;
    onClick();
  });
  return btn;
}

function removeUserTagFromPathsBulk(paths, tagName) {
  const tag = normalizeTag(tagName || "");
  if (!tag) return { changed: false, changedCount: 0, tag: "" };
  const uniquePaths = Array.from(
    new Set((paths || []).map((p) => String(p || "")).filter(Boolean)),
  );
  let changed = false;
  let changedCount = 0;
  for (let i = 0; i < uniquePaths.length; i++) {
    const path = uniquePaths[i];
    const userTags = metaGetUserTags(path);
    if (!userTags.includes(tag)) continue;
    if (metaWriteUserTags(path, userTags.filter((item) => item !== tag))) {
      changed = true;
      changedCount++;
    }
  }
  return { changed, changedCount, tag };
}

function removeTagsFromAlbumBulk(tags, albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName || "");
  if (!album) return { changed: false, changedCount: 0, album: "" };
  const uniqueTags = normalizeTagList(tags);
  let changed = false;
  let changedCount = 0;
  for (let i = 0; i < uniqueTags.length; i++) {
    const tag = uniqueTags[i];
    if (!tag) continue;
    if (metaSetTagAlbumForTag(tag, "", scopePath)) {
      changed = true;
      changedCount++;
    }
  }
  return { changed, changedCount, album };
}

function beginTagAlbumAssignmentForEntries(entries, preferPane = "directories") {
  const selectedEntries = Array.isArray(entries) ? entries : [];
  const tags = normalizeTagList(
    selectedEntries.map((entry) => String(entry?.tag || "")),
  );
  const originPath = String(selectedEntries[0]?.originPath || "");
  if (!tags.length) {
    showStatusMessage("No tags selected.");
    return false;
  }
  startBulkTagAlbuming(tags, originPath, preferPane);
  return true;
}

function galleryTargetForTagEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.special || entry.placeholder)
    return null;
  const tag = normalizeTag(entry.tag || "");
  const originPath = normalizeTagAlbumScopePath(entry.originPath || "");
  if (tag) return { kind: "tag", tag, originPath };
  const album = normalizeTagAlbumName(entry.album || "");
  if (album) return { kind: "album", album, originPath };
  return null;
}

function beginGalleryAssignmentForEntries(entries, preferPane = "directories") {
  const targets = (Array.isArray(entries) ? entries : [])
    .map(galleryTargetForTagEntry)
    .filter(Boolean);
  if (!targets.length) {
    showStatusMessage("No tags or albums selected.");
    return false;
  }
  startBulkGallerying(targets, preferPane);
  return true;
}

function addUserTagsToGalleryBulk(galleries, tagsToAdd) {
  const add = normalizeTagList(tagsToAdd).filter(
    (tag) => !isReservedFolderTag(tag),
  );
  if (!add.length) return false;
  const names = Array.from(
    new Set((galleries || []).map(normalizeGalleryName).filter(Boolean)),
  );
  let changed = false;
  for (let i = 0; i < names.length; i++) {
    const gallery = names[i];
    const next = normalizeTagList(metaGetUserTagsForGallery(gallery).concat(add));
    if (metaSetUserTagsForGallery(gallery, next)) changed = true;
  }
  if (!changed) return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(`Tagged ${names.length} gallery${names.length === 1 ? "" : "s"}.`);
  return true;
}

function assignAlbumForGalleriesBulk(galleries, albumName) {
  const album = normalizeTagAlbumName(albumName);
  if (!album) return false;
  const names = Array.from(
    new Set((galleries || []).map(normalizeGalleryName).filter(Boolean)),
  );
  let changed = false;
  for (let i = 0; i < names.length; i++) {
    if (metaSetAlbumForGallery(names[i], album)) changed = true;
  }
  if (!changed) return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(`Assigned ${names.length} gallery${names.length === 1 ? "" : "s"} to album '${album}'.`);
  return true;
}

function beginTagRenameForEntry(entry, preferPane = "directories") {
  if (!entry || entry.kind !== "tag" || entry.special || entry.placeholder)
    return false;
  const tag = String(entry.tag || "").trim();
  const album = normalizeTagAlbumName(entry.album || "");
  const gallery = normalizeGalleryName(entry.gallery || "");
  const isAlbumEntry = !!album && !tag;
  const isGalleryEntry = !!gallery && !tag && !album;
  if (!tag && !isAlbumEntry && !isGalleryEntry) return false;
  const label = String(entry.label || entry.tag || album || gallery || tag);
  const paths = gatherTagPathsForDirs(getDirsForTagEntry(entry));
  const baseNode =
    WS.dirByPath.get(String(entry.originPath || "")) || WS.nav.dirNode || WS.root;
  const taggedAlbums =
    tag && !isAlbumEntry ? getAlbumEntriesForTagForBaseNode(baseNode, tag) : [];
  if (!paths.length && !taggedAlbums.length && !isAlbumEntry && !isGalleryEntry) {
    showStatusMessage("No items contain that tag.");
    return false;
  }
  return beginTagEntryRename(
    {
      tag,
      album,
      gallery,
      label,
      paths,
      originPath: String(entry.originPath || ""),
      isAlbumEntry,
      isGalleryEntry,
    },
    preferPane,
  );
}

function renameTagForPaths(tag, newName, paths, scopePath = null) {
  const normalizedOld = String(tag || "");
  const normalizedNew = normalizeTag(newName || "");
  if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew)
    return false;
  const uniquePaths = Array.from(new Set((paths || []).filter((p) => p)));
  let changed = false;
  for (const p of uniquePaths) {
    const tags = metaGetUserTags(p);
    if (!tags.includes(normalizedOld)) continue;
    const updated = tags.slice();
    for (let i = 0; i < updated.length; i++) {
      if (updated[i] === normalizedOld) updated[i] = normalizedNew;
    }
    const deduped = [];
    const seen = new Set();
    for (const t of updated) {
      if (!t) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      deduped.push(t);
    }
    if (metaWriteUserTags(p, deduped)) changed = true;
  }
  const thumbKeys = getAllTagThumbnailStateKeys();
  for (let i = 0; i < thumbKeys.length; i++) {
    const oldKey = thumbKeys[i];
    const parsed = parseTagThumbnailStructuredKey(oldKey);
    if (
      !parsed ||
      parsed.kind !== "tag" ||
      String(parsed.value || "") !== normalizedOld
    )
      continue;
    const newKey = parsed.scoped
      ? tagThumbnailKeyForTag(normalizedNew, parsed.scopePath)
      : tagThumbnailKeyForTag(normalizedNew);
    if (!newKey) continue;
    if (rekeyTagThumbnailState(oldKey, newKey)) changed = true;
  }
  const appearanceKeys = getAllTagAppearancePresetStateKeys();
  for (let i = 0; i < appearanceKeys.length; i++) {
    const oldKey = appearanceKeys[i];
    const parsed = parseTagThumbnailStructuredKey(oldKey);
    if (
      !parsed ||
      parsed.kind !== "tag" ||
      String(parsed.value || "") !== normalizedOld
    )
      continue;
    const newKey = parsed.scoped
      ? tagThumbnailKeyForTag(normalizedNew, parsed.scopePath)
      : tagThumbnailKeyForTag(normalizedNew);
    if (!newKey) continue;
    if (rekeyTagAppearancePresetState(oldKey, newKey)) changed = true;
  }
  const mediaFilterKeys = getAllTagMediaFilterStateKeys();
  for (let i = 0; i < mediaFilterKeys.length; i++) {
    const oldKey = mediaFilterKeys[i];
    const parsed = parseTagThumbnailStructuredKey(oldKey);
    if (
      !parsed ||
      parsed.kind !== "tag" ||
      String(parsed.value || "") !== normalizedOld
    )
      continue;
    const newKey = parsed.scoped
      ? tagThumbnailKeyForTag(normalizedNew, parsed.scopePath)
      : tagThumbnailKeyForTag(normalizedNew);
    if (!newKey) continue;
    if (rekeyTagMediaFilterState(oldKey, newKey)) changed = true;
  }
  const hiddenKeys = getAllHiddenTagStateKeys();
  for (let i = 0; i < hiddenKeys.length; i++) {
    const oldKey = hiddenKeys[i];
    const parsed = parseTagThumbnailStructuredKey(oldKey);
    if (
      !parsed ||
      parsed.kind !== "tag" ||
      String(parsed.value || "") !== normalizedOld
    )
      continue;
    const newKey = parsed.scoped
      ? hiddenTagKeyForTag(normalizedNew, parsed.scopePath)
      : hiddenTagKeyForTag(normalizedNew);
    if (!newKey) continue;
    if (rekeyHiddenTagState(oldKey, newKey)) changed = true;
  }
  const oldAlbum = metaGetTagAlbumForTag(normalizedOld, scopePath);
  if (oldAlbum) {
    let albumChanged = false;
    if (!metaGetTagAlbumForTag(normalizedNew, scopePath)) {
      if (metaSetTagAlbumForTag(normalizedNew, oldAlbum, scopePath))
        albumChanged = true;
    }
    if (metaSetTagAlbumForTag(normalizedOld, "", scopePath))
      albumChanged = true;
    if (albumChanged) changed = true;
  }
  if (WS.meta && WS.meta.albumTagsByAlbum instanceof Map) {
    const entries = Array.from(WS.meta.albumTagsByAlbum.entries());
    for (let i = 0; i < entries.length; i++) {
      const parsed = parseAlbumTagMembershipKey(entries[i][0]);
      if (!parsed) continue;
      if (
        scopePath != null &&
        String(parsed.scopePath || "") !== String(scopePath || "")
      )
        continue;
      const tags = normalizeTagList(entries[i][1]);
      if (!tags.includes(normalizedOld)) continue;
      const next = tags.map((tag) =>
        tag === normalizedOld ? normalizedNew : tag,
      );
      if (metaSetUserTagsForAlbum(parsed.album, parsed.scopePath, next))
        changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryMemberTagsByGallery instanceof Map) {
    for (const galleryRaw of Array.from(
      WS.meta.galleryMemberTagsByGallery.keys(),
    )) {
      const targets = metaGetMemberTagTargetsForGallery(galleryRaw);
      const next = targets.map((target) =>
        target.tag === normalizedOld &&
        (scopePath == null ||
          target.originPath === normalizeTagAlbumScopePath(scopePath))
          ? Object.assign({}, target, { tag: normalizedNew })
          : target,
      );
      if (JSON.stringify(next) === JSON.stringify(targets)) continue;
      if (metaSetMemberTagTargetsForGallery(galleryRaw, next)) changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryUserTagsByGallery instanceof Map) {
    for (const [galleryRaw, tagsRaw] of Array.from(
      WS.meta.galleryUserTagsByGallery.entries(),
    )) {
      const tags = normalizeTagList(tagsRaw);
      if (!tags.includes(normalizedOld)) continue;
      const next = tags.map((tag) =>
        tag === normalizedOld ? normalizedNew : tag,
      );
      if (metaSetUserTagsForGallery(galleryRaw, next)) changed = true;
    }
  }
  return changed;
}

function tagAlbumExistsInScope(albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName || "");
  if (!album || !WS.meta) return false;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  const scopeMatches = (candidateScope) =>
    scopePath == null || String(candidateScope || "") === normalizedScope;

  if (WS.meta.tagAlbumByTag instanceof Map) {
    for (const [tagKeyRaw, albumRaw] of WS.meta.tagAlbumByTag.entries()) {
      const parsed = parseTagAlbumMembershipKey(tagKeyRaw);
      if (
        parsed &&
        scopeMatches(parsed.scopePath) &&
        normalizeTagAlbumName(albumRaw) === album
      )
        return true;
    }
  }
  if (WS.meta.folderAlbumByPath instanceof Map) {
    for (const [pathRaw, albumRaw] of WS.meta.folderAlbumByPath.entries()) {
      if (normalizeTagAlbumName(albumRaw) !== album) continue;
      if (scopeMatches(hiddenTagScopePathForDirPath(pathRaw))) return true;
    }
  }
  if (WS.meta.albumTagsByAlbum instanceof Map) {
    for (const albumKeyRaw of WS.meta.albumTagsByAlbum.keys()) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (parsed && parsed.album === album && scopeMatches(parsed.scopePath))
        return true;
    }
  }
  if (WS.meta.galleryMemberAlbumsByGallery instanceof Map) {
    for (const galleryRaw of WS.meta.galleryMemberAlbumsByGallery.keys()) {
      const targets = metaGetMemberAlbumTargetsForGallery(galleryRaw);
      if (
        targets.some(
          (target) =>
            target.album === album && scopeMatches(target.originPath),
        )
      )
        return true;
    }
  }
  if (scopeMatches("")) {
    if (WS.meta.galleryAlbumByGallery instanceof Map) {
      for (const albumRaw of WS.meta.galleryAlbumByGallery.values()) {
        if (normalizeTagAlbumName(albumRaw) === album) return true;
      }
    }
  }
  return false;
}

function renameTagAlbumByName(albumName, newName, scopePath = null) {
  const normalizedOld = normalizeTagAlbumName(albumName || "");
  const normalizedNew = normalizeTagAlbumName(newName || "");
  if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew)
    return false;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  let changed = false;
  if (WS.meta && WS.meta.tagAlbumByTag instanceof Map) {
    for (const [tagKeyRaw, albumRaw] of WS.meta.tagAlbumByTag.entries()) {
      const parsed = parseTagAlbumMembershipKey(tagKeyRaw);
      const assignedAlbum = normalizeTagAlbumName(albumRaw);
      if (!parsed || assignedAlbum !== normalizedOld) continue;
      if (
        scopePath != null &&
        String(parsed.scopePath || "") !== String(scopePath || "")
      )
        continue;
      if (metaSetTagAlbumForTag(parsed.tag, normalizedNew, parsed.scopePath))
        changed = true;
    }
  }
  if (WS.meta && WS.meta.folderAlbumByPath instanceof Map) {
    for (const [pathRaw, albumRaw] of Array.from(
      WS.meta.folderAlbumByPath.entries(),
    )) {
      const assignedAlbum = normalizeTagAlbumName(albumRaw);
      if (assignedAlbum !== normalizedOld) continue;
      if (
        scopePath != null &&
        hiddenTagScopePathForDirPath(pathRaw) !== normalizedScope
      )
        continue;
      if (metaSetAlbumForPath(pathRaw, normalizedNew)) changed = true;
    }
  }
  if (WS.meta && WS.meta.albumTagsByAlbum instanceof Map) {
    for (const [albumKeyRaw, tagsRaw] of Array.from(
      WS.meta.albumTagsByAlbum.entries(),
    )) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (!parsed || parsed.album !== normalizedOld) continue;
      if (
        scopePath != null &&
        String(parsed.scopePath || "") !== String(scopePath || "")
      )
        continue;
      const existing = metaGetUserTagsForAlbum(normalizedNew, parsed.scopePath);
      const next = normalizeTagList(existing.concat(normalizeTagList(tagsRaw)));
      if (metaSetUserTagsForAlbum(normalizedNew, parsed.scopePath, next))
        changed = true;
      if (metaSetUserTagsForAlbum(parsed.album, parsed.scopePath, []))
        changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryMemberAlbumsByGallery instanceof Map) {
    for (const galleryRaw of Array.from(
      WS.meta.galleryMemberAlbumsByGallery.keys(),
    )) {
      const targets = metaGetMemberAlbumTargetsForGallery(galleryRaw);
      const next = targets.map((target) =>
        target.album === normalizedOld &&
        (scopePath == null || target.originPath === normalizedScope)
          ? Object.assign({}, target, { album: normalizedNew })
          : target,
      );
      if (JSON.stringify(next) === JSON.stringify(targets)) continue;
      if (metaSetMemberAlbumTargetsForGallery(galleryRaw, next)) changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryAlbumByGallery instanceof Map) {
    for (const [galleryRaw, albumRaw] of Array.from(
      WS.meta.galleryAlbumByGallery.entries(),
    )) {
      if (normalizeTagAlbumName(albumRaw) !== normalizedOld) continue;
      if (metaSetAlbumForGallery(galleryRaw, normalizedNew)) changed = true;
    }
  }
  const rekeyAlbumScopedState = (keys, buildKey, rekeyFn) => {
    for (let i = 0; i < keys.length; i++) {
      const oldKey = keys[i];
      const parsed = parseTagThumbnailStructuredKey(oldKey);
      if (
        !parsed ||
        parsed.kind !== "album" ||
        String(parsed.value || "") !== normalizedOld
      )
        continue;
      if (
        scopePath != null &&
        String(parsed.scopePath || "") !== String(scopePath || "")
      )
        continue;
      const newKey = buildKey(normalizedNew, parsed.scopePath);
      if (newKey && rekeyFn(oldKey, newKey)) changed = true;
    }
  };
  rekeyAlbumScopedState(
    getAllTagThumbnailStateKeys(),
    tagThumbnailKeyForAlbum,
    rekeyTagThumbnailState,
  );
  rekeyAlbumScopedState(
    getAllTagAppearancePresetStateKeys(),
    tagThumbnailKeyForAlbum,
    rekeyTagAppearancePresetState,
  );
  rekeyAlbumScopedState(
    getAllTagMediaFilterStateKeys(),
    tagThumbnailKeyForAlbum,
    rekeyTagMediaFilterState,
  );
  rekeyAlbumScopedState(
    getAllHiddenTagStateKeys(),
    hiddenTagKeyForAlbum,
    rekeyHiddenTagState,
  );
  return changed;
}

function renameGalleryByName(galleryName, newName) {
  const oldGallery = normalizeGalleryName(galleryName);
  const newGallery = normalizeGalleryName(newName);
  if (!oldGallery || !newGallery || oldGallery === newGallery) return false;
  let changed = false;
  if (WS.meta && WS.meta.folderGalleriesByPath instanceof Map) {
    for (const [pathRaw, galleriesRaw] of Array.from(
      WS.meta.folderGalleriesByPath.entries(),
    )) {
      const galleries = normalizeTagList(galleriesRaw).map((gallery) =>
        gallery === oldGallery ? newGallery : gallery,
      );
      if (metaSetGalleriesForPath(pathRaw, galleries)) changed = true;
    }
  }
  const mergeListMapEntry = (map, normalizeValues) => {
    if (!(map instanceof Map) || !map.has(oldGallery)) return false;
    const source = normalizeValues(map.get(oldGallery));
    const target = normalizeValues(map.get(newGallery));
    const merged = normalizeValues(target.concat(source));
    if (merged.length) map.set(newGallery, merged);
    else map.delete(newGallery);
    map.delete(oldGallery);
    return true;
  };
  if (
    mergeListMapEntry(
      WS.meta.galleryMemberTagsByGallery,
      (values) => normalizeGalleryMemberTargets(values, "tag"),
    )
  )
    changed = true;
  if (
    mergeListMapEntry(
      WS.meta.galleryMemberAlbumsByGallery,
      (values) => normalizeGalleryMemberTargets(values, "album"),
    )
  )
    changed = true;
  if (
    mergeListMapEntry(
      WS.meta.galleryUserTagsByGallery,
      (values) =>
        normalizeTagList(values)
          .filter((tag) => !isReservedFolderTag(tag))
          .filter((tag) => tag !== newGallery),
    )
  )
    changed = true;
  if (
    WS.meta.galleryAlbumByGallery instanceof Map &&
    WS.meta.galleryAlbumByGallery.has(oldGallery)
  ) {
    const sourceAlbum = normalizeTagAlbumName(
      WS.meta.galleryAlbumByGallery.get(oldGallery),
    );
    const targetAlbum = normalizeTagAlbumName(
      WS.meta.galleryAlbumByGallery.get(newGallery),
    );
    if (!targetAlbum && sourceAlbum && sourceAlbum !== newGallery) {
      WS.meta.galleryAlbumByGallery.set(newGallery, sourceAlbum);
    }
    WS.meta.galleryAlbumByGallery.delete(oldGallery);
    changed = true;
  }
  const oldKey = tagThumbnailKeyForGallery(oldGallery);
  const newKey = tagThumbnailKeyForGallery(newGallery);
  if (rekeyTagThumbnailState(oldKey, newKey)) changed = true;
  if (rekeyTagAppearancePresetState(oldKey, newKey)) changed = true;
  if (rekeyTagMediaFilterState(oldKey, newKey)) changed = true;
  if (rekeyHiddenTagState(oldKey, newKey)) changed = true;
  if (changed) {
    metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
    invalidateDirMetricsCaches();
  }
  return changed;
}

function deleteTagFromPaths(tag, paths, scopePath = null) {
  const normalized = String(tag || "");
  if (!normalized) return false;
  const rawMemberPaths = gatherTagPathsForDirs(
    getUnfilteredMembershipDirsForTagEntry({
      kind: "tag",
      tag: normalized,
      originPath: normalizeTagAlbumScopePath(scopePath),
    }),
  );
  const uniquePaths = Array.from(
    new Set((paths || []).concat(rawMemberPaths).filter((p) => p)),
  );
  let changed = false;
  for (const p of uniquePaths) {
    const tags = metaGetUserTags(p);
    if (!tags.includes(normalized)) continue;
    const filtered = tags.filter((t) => t !== normalized);
    if (metaWriteUserTags(p, filtered)) changed = true;
  }
  if (
    clearTagThumbnailStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      return (
        !!parsed &&
        parsed.kind === "tag" &&
        String(parsed.value || "") === normalized
      );
    })
  )
    changed = true;
  if (
    clearTagAppearancePresetStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      return (
        !!parsed &&
        parsed.kind === "tag" &&
        String(parsed.value || "") === normalized
      );
    })
  )
    changed = true;
  if (
    clearTagMediaFilterStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      return (
        !!parsed &&
        parsed.kind === "tag" &&
        String(parsed.value || "") === normalized
      );
    })
  )
    changed = true;
  if (
    clearHiddenTagStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      return (
        !!parsed &&
        parsed.kind === "tag" &&
        String(parsed.value || "") === normalized
      );
    })
  )
    changed = true;
  if (metaSetTagAlbumForTag(normalized, "", scopePath)) changed = true;
  if (WS.meta && WS.meta.albumTagsByAlbum instanceof Map) {
    const entries = Array.from(WS.meta.albumTagsByAlbum.entries());
    for (let i = 0; i < entries.length; i++) {
      const parsed = parseAlbumTagMembershipKey(entries[i][0]);
      if (!parsed) continue;
      if (
        scopePath != null &&
        String(parsed.scopePath || "") !== String(scopePath || "")
      )
        continue;
      const tags = normalizeTagList(entries[i][1]);
      if (!tags.includes(normalized)) continue;
      const next = tags.filter((tag) => tag !== normalized);
      if (metaSetUserTagsForAlbum(parsed.album, parsed.scopePath, next))
        changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryMemberTagsByGallery instanceof Map) {
    for (const galleryRaw of Array.from(
      WS.meta.galleryMemberTagsByGallery.keys(),
    )) {
      const targets = metaGetMemberTagTargetsForGallery(galleryRaw);
      const next = targets.filter(
        (target) =>
          target.tag !== normalized ||
          (scopePath != null &&
            target.originPath !== normalizeTagAlbumScopePath(scopePath)),
      );
      if (next.length === targets.length) continue;
      if (
        metaSetMemberTagTargetsForGallery(galleryRaw, next)
      )
        changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryUserTagsByGallery instanceof Map) {
    for (const [galleryRaw, tagsRaw] of Array.from(
      WS.meta.galleryUserTagsByGallery.entries(),
    )) {
      const tags = normalizeTagList(tagsRaw);
      if (!tags.includes(normalized)) continue;
      if (
        metaSetUserTagsForGallery(
          galleryRaw,
          tags.filter((tag) => tag !== normalized),
        )
      )
        changed = true;
    }
  }
  return changed;
}

function deleteTagAlbumByName(albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName || "");
  if (!album) return { changed: false, clearedTags: 0, album: "" };
  let changed = false;
  let clearedTags = 0;
  const normalizedScope = normalizeTagAlbumScopePath(scopePath);
  const hasScopedAssignments =
    scopePath != null && tagAlbumHasScopedAssignmentsForScope(scopePath);
  if (WS.meta && WS.meta.tagAlbumByTag) {
    const entries = Array.from(WS.meta.tagAlbumByTag.entries());
    for (let i = 0; i < entries.length; i++) {
      const parsed = parseTagAlbumMembershipKey(entries[i][0]);
      const assignedAlbum = normalizeTagAlbumName(entries[i][1] || "");
      if (!parsed || assignedAlbum !== album) continue;
      if (scopePath != null) {
        if (parsed.scoped) {
          if (parsed.scopePath !== normalizedScope) continue;
        } else if (hasScopedAssignments) {
          continue;
        }
      }
      if (
        metaSetTagAlbumForTag(
          parsed.tag,
          "",
          parsed.scoped ? parsed.scopePath : null,
        )
      ) {
        changed = true;
        clearedTags++;
      }
    }
  }
  if (WS.meta && WS.meta.folderAlbumByPath instanceof Map) {
    for (const [pathRaw, albumRaw] of Array.from(
      WS.meta.folderAlbumByPath.entries(),
    )) {
      if (normalizeTagAlbumName(albumRaw) !== album) continue;
      if (metaSetAlbumForPath(pathRaw, "")) changed = true;
    }
  }
  if (WS.meta && WS.meta.albumTagsByAlbum instanceof Map) {
    for (const [albumKeyRaw] of Array.from(WS.meta.albumTagsByAlbum.entries())) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (!parsed || parsed.album !== album) continue;
      if (scopePath != null) {
        if (parsed.scoped) {
          if (parsed.scopePath !== normalizedScope) continue;
        } else if (hasScopedAssignments) {
          continue;
        }
      }
      if (metaSetUserTagsForAlbum(parsed.album, parsed.scopePath, []))
        changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryMemberAlbumsByGallery instanceof Map) {
    for (const galleryRaw of Array.from(
      WS.meta.galleryMemberAlbumsByGallery.keys(),
    )) {
      const targets = metaGetMemberAlbumTargetsForGallery(galleryRaw);
      const next = targets.filter(
        (target) =>
          target.album !== album ||
          (scopePath != null && target.originPath !== normalizedScope),
      );
      if (next.length === targets.length) continue;
      if (
        metaSetMemberAlbumTargetsForGallery(galleryRaw, next)
      )
        changed = true;
    }
  }
  if (WS.meta && WS.meta.galleryAlbumByGallery instanceof Map) {
    for (const [galleryRaw, albumRaw] of Array.from(
      WS.meta.galleryAlbumByGallery.entries(),
    )) {
      if (normalizeTagAlbumName(albumRaw) !== album) continue;
      if (metaSetAlbumForGallery(galleryRaw, "")) changed = true;
    }
  }
  if (
    clearTagThumbnailStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      if (
        !parsed ||
        parsed.kind !== "album" ||
        String(parsed.value || "") !== album
      )
        return false;
      if (scopePath == null) return true;
      return parsed.scoped
        ? parsed.scopePath === normalizedScope
        : !hasScopedAssignments;
    })
  )
    changed = true;
  if (
    clearTagAppearancePresetStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      if (
        !parsed ||
        parsed.kind !== "album" ||
        String(parsed.value || "") !== album
      )
        return false;
      if (scopePath == null) return true;
      return parsed.scoped
        ? parsed.scopePath === normalizedScope
        : !hasScopedAssignments;
    })
  )
    changed = true;
  if (
    clearTagMediaFilterStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      if (
        !parsed ||
        parsed.kind !== "album" ||
        String(parsed.value || "") !== album
      )
        return false;
      if (scopePath == null) return true;
      return parsed.scoped
        ? parsed.scopePath === normalizedScope
        : !hasScopedAssignments;
    })
  )
    changed = true;
  if (
    clearHiddenTagStateByMatch((key) => {
      const parsed = parseTagThumbnailStructuredKey(key);
      if (
        !parsed ||
        parsed.kind !== "album" ||
        String(parsed.value || "") !== album
      )
        return false;
      if (scopePath == null) return true;
      return parsed.scoped
        ? parsed.scopePath === normalizedScope
        : !hasScopedAssignments;
    })
  )
    changed = true;
  return { changed, clearedTags, album };
}

function deleteGalleryByName(galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery) return false;
  let changed = false;
  if (WS.meta && WS.meta.folderGalleriesByPath instanceof Map) {
    for (const [pathRaw, galleriesRaw] of Array.from(
      WS.meta.folderGalleriesByPath.entries(),
    )) {
      const next = normalizeTagList(galleriesRaw).filter((item) => item !== gallery);
      if (metaSetGalleriesForPath(pathRaw, next)) changed = true;
    }
  }
  [
    WS.meta.galleryMemberTagsByGallery,
    WS.meta.galleryMemberAlbumsByGallery,
    WS.meta.galleryUserTagsByGallery,
    WS.meta.galleryAlbumByGallery,
  ].forEach((map) => {
    if (map && map.delete(gallery)) changed = true;
  });
  const galleryKey = tagThumbnailKeyForGallery(gallery);
  if (clearTagThumbnailStateByMatch((key) => key === galleryKey)) changed = true;
  if (clearTagAppearancePresetStateByMatch((key) => key === galleryKey)) changed = true;
  if (clearTagMediaFilterStateByMatch((key) => key === galleryKey)) changed = true;
  if (clearHiddenTagStateByMatch((key) => key === galleryKey)) changed = true;
  if (changed) {
    metaTrackDirtyDocIds([META_DOC_IDS.tagAlbums]);
    invalidateDirMetricsCaches();
  }
  return changed;
}

function tagMediaFilterAxisCycleOptions(axis, allLabel = "All") {
  return [
    { value: "", label: String(allLabel || "All") },
    ...(Array.isArray(axis) ? axis : []).map((type) => {
      const rawLabel = tagMediaFilterTypeLabel(type);
      return {
        value: type,
        label: rawLabel
          ? `${rawLabel.charAt(0).toUpperCase()}${rawLabel.slice(1)}`
          : String(type || ""),
      };
    }),
  ];
}

function createTagMediaFilterAxisCycleButton(opts) {
  const cfg = opts || {};
  const axis = Array.isArray(cfg.axis) ? cfg.axis : [];
  const currentValue = normalizeTagMediaFilterValue(cfg.currentValue);
  const onApply = typeof cfg.onApply === "function" ? cfg.onApply : null;
  if (!axis.length || !onApply) return null;
  const selected = tagMediaFilterAxisSelection(currentValue, axis);
  return createCyclingItemMenuButton(
    String(cfg.label || "Media type"),
    tagMediaFilterAxisCycleOptions(axis, cfg.allLabel),
    selected,
    (onlyType) =>
      onApply(
        setTagMediaFilterAxis(currentValue, axis, onlyType || null),
        onlyType || "",
      ),
    !!cfg.mixed,
  );
}

// Legacy single-select flyout variant retained for non-navigation surfaces.
// Picking an option restricts the tag/album to show only that one type; "All"
// clears the axis.
function buildTagMediaFilterAxisSubmenu(opts) {
  const cfg = opts || {};
  const label = String(cfg.label || "");
  const axis = Array.isArray(cfg.axis) ? cfg.axis : [];
  const allLabel = String(cfg.allLabel || "All");
  const optionLabel =
    typeof cfg.optionLabel === "function"
      ? cfg.optionLabel
      : (type) => tagMediaFilterTypeLabel(type);
  const currentValue = normalizeTagMediaFilterValue(cfg.currentValue);
  const onApply = typeof cfg.onApply === "function" ? cfg.onApply : null;
  if (!axis.length || !onApply) return null;
  const selected = tagMediaFilterAxisSelection(currentValue, axis);
  const marker = (active) => (active ? "● " : "○ ");
  const buttons = [];
  buttons.push(
    createTagMenuButton(`${marker(!selected)}${allLabel}`, () => {
      onApply(setTagMediaFilterAxis(currentValue, axis, null), "");
    }),
  );
  for (let i = 0; i < axis.length; i++) {
    const type = axis[i];
    buttons.push(
      createTagMenuButton(
        `${marker(selected === type)}${optionLabel(type)}`,
        () => {
          onApply(setTagMediaFilterAxis(currentValue, axis, type), type);
        },
      ),
    );
  }
  return createDropdownMenuSubmenu(label, buttons);
}

function buildTagMediaFilterChoiceMenu(menu, opts = {}) {
  if (!menu) return;
  const currentValue = normalizeTagMediaFilterValue(opts.currentValue);
  const onChoose = typeof opts.onChoose === "function" ? opts.onChoose : null;
  const onBack = typeof opts.onBack === "function" ? opts.onBack : null;
  const appendFilterSectionLabel = (text) => {
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = String(text || "");
    menu.appendChild(label);
  };
  const appendFilterToggle = (type) => {
    const enabled = currentValue.includes(type);
    const marker = enabled ? "[x]" : "[ ]";
    menu.appendChild(
      createTagMenuButton(
        `${marker} Hide ${tagMediaFilterTypeLabel(type)}`,
        () => {
          if (!onChoose) return;
          onChoose(toggleTagMediaFilterType(currentValue, type));
        },
      ),
    );
  };
  menu.innerHTML = "";
  appendFilterSectionLabel("Media types");
  TAG_MEDIA_FILTER_MEDIA_TYPES.forEach(appendFilterToggle);
  menu.appendChild(
    createTagMenuButton("Clear content filter", () => {
      if (!onChoose) return;
      onChoose([]);
    }),
  );
  if (onBack) {
    menu.appendChild(
      createTagMenuButton("Back", () => {
        onBack();
      }),
    );
  }
  if (typeof opts.onRendered === "function") opts.onRendered();
}

async function handleTagMenuAction(action) {
  const ctx = TAG_CONTEXT_MENU_STATE;
  if (!ctx) return;
  closeTagContextMenu();
  const tag = ctx.tag || "";
  const album = normalizeTagAlbumName(ctx.album || "");
  const gallery = normalizeGalleryName(ctx.gallery || "");
  const isAlbumEntry = !!ctx.isAlbumEntry && !!album;
  const isGalleryEntry = !!ctx.isGalleryEntry && !!gallery;
  const tagKey = String(ctx.tagKey || "");
  const label = ctx.label || tag || album || gallery;
  const paths = ctx.paths || [];
  if (action === "rename") {
    if (!ctx.canRename) return;
    // A tag may hold only albums (albumTagsByAlbum) and no folders; renaming still
    // has to work since renameTagForPaths re-keys the tag inside albums too.
    if (!isAlbumEntry && !isGalleryEntry && !tagNameExists(tag)) {
      showStatusMessage("No items contain that tag.");
      return;
    }
    beginTagEntryRename(
      {
        tag,
        album,
        gallery,
        label,
        paths,
        originPath: String(ctx.originPath || ""),
        isAlbumEntry,
        isGalleryEntry,
      },
      ctx.anchor && ctx.anchor.closest && ctx.anchor.closest("#previewBody")
        ? "preview"
        : "directories",
    );
    return;
  }
  if (action === "remove-from-album") {
    if (!ctx.canRemoveFromAlbum) return;
    const albumContext = currentTagMenuAlbumRemovalContext();
    if (!albumContext) return;
    const result = removeTagsFromAlbumBulk(
      [tag],
      albumContext.album,
      albumContext.originPath,
    );
    if (!result.changed) {
      showStatusMessage("No tags updated.");
      return;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `Removed tag '${displayTagFolderLabel(label)}' from album '${displayTagFolderLabel(albumContext.album)}'.`,
    );
    return;
  }
  if (action === "remove-from-gallery") {
    if (!ctx.canRemoveFromGallery) return;
    const galleryContext = currentTagMenuGalleryRemovalContext();
    const galleryName = normalizeGalleryName(galleryContext && galleryContext.gallery);
    if (!galleryName) return;
    let changed = false;
    const memberOriginPath = normalizeTagAlbumScopePath(ctx.originPath || "");
    if (tag) {
      const next = metaGetMemberTagTargetsForGallery(galleryName).filter(
        (item) =>
          item.tag !== tag || item.originPath !== memberOriginPath,
      );
      changed = metaSetMemberTagTargetsForGallery(galleryName, next);
    } else if (isAlbumEntry) {
      const next = metaGetMemberAlbumTargetsForGallery(galleryName).filter(
        (item) =>
          item.album !== album || item.originPath !== memberOriginPath,
      );
      changed = metaSetMemberAlbumTargetsForGallery(galleryName, next);
    }
    if (!changed) {
      showStatusMessage("No galleries updated.");
      return;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `Removed '${displayTagFolderLabel(label)}' from gallery '${displayTagFolderLabel(galleryName)}'.`,
    );
    return;
  }
  if (action === "delete") {
    if (!ctx.canDelete) return;
    if (ctx.special === "favorites") {
      const confirmed = await showAppMenuConfirm(
        "Remove all folders from Favorites?",
        { danger: true },
      );
      if (!confirmed) return;
      const changed = metaSetFavoriteBulk(paths, false);
      if (!changed) {
        refreshAfterTagMetadataChange();
        showStatusMessage("Favorites is already empty.");
        return;
      }
      metaScheduleSave();
      showStatusMessage("Cleared Favorites.");
      return;
    }
    if (isGalleryEntry) {
      const confirmed = await showAppMenuConfirm(
        `Delete gallery '${label}'? Nothing inside is deleted. Its folders, tags, and albums just return to their normal place.`,
        { danger: true },
      );
      if (!confirmed) return;
      const changed = deleteGalleryByName(gallery);
      if (!changed) {
        showStatusMessage("No galleries updated.");
        return;
      }
      metaScheduleSave();
      refreshAfterTagMetadataChange();
      showStatusMessage(`Deleted gallery '${label}'.`);
      return;
    }
    if (isAlbumEntry) {
      const confirmed = await showAppMenuConfirm(
        `Delete album '${label}'? Nothing inside is deleted. Its tags and folders just return to their normal place.`,
        { danger: true },
      );
      if (!confirmed) return;
      const result = deleteTagAlbumByName(album, ctx.originPath);
      if (!result.changed) {
        showStatusMessage("No albums updated.");
        return;
      }
      metaScheduleSave();
      refreshAfterTagMetadataChange();
      const ungroupedCount = Number(result.clearedTags) || 0;
      showStatusMessage(
        ungroupedCount
          ? `Deleted album '${label}' and ungrouped ${ungroupedCount} tag${ungroupedCount === 1 ? "" : "s"}.`
          : `Deleted album '${label}'.`,
      );
      return;
    }
    if (!tagNameExists(tag)) {
      showStatusMessage("No items contain that tag.");
      return;
    }
    const confirmed = await showAppMenuConfirm(
      `Delete tag '${label}'? Nothing inside is deleted. Its folders and tags just stop being in it.`,
      { danger: true },
    );
    if (!confirmed) return;
    if (!deleteTagEverywhere(tag)) {
      showStatusMessage("No folders updated.");
      return;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(`Deleted tag '${label}'.`);
    return;
  }
  if (action === "toggle-exclusive") {
    if (!tag || ctx.special) return;
    const next = !tagIsExclusive(tag);
    if (!metaSetTagExclusive(tag, next)) return;
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      next
        ? `Tag '${label}' is exclusive: its content now lives only in it.`
        : `Tag '${label}' is no longer exclusive.`,
    );
    return;
  }
  if (action === "toggle-use-anywhere") {
    if (!tag || ctx.special || !tagCanBeHeld(tag)) return;
    const next = !tagUsesAnywhere(tag);
    const changed = metaSetTagUseAnywhere(tag, next);
    if (!changed) return;
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    // The Tags it holds follow it.
    const held = changed - 1;
    const withHeld = held ? `, with ${held} tag${held === 1 ? "" : "s"} inside it,` : "";
    const lockers = tagLockers(tag);
    showStatusMessage(
      next
        ? `Tag '${label}'${withHeld} can now be used anywhere.`
        : lockers.length
          ? `Tag '${label}'${withHeld} now only takes ${tagLockTakesText(lockers[0])}.`
          : `Tag '${label}'${withHeld} is held to where its content is again.`,
    );
    return;
  }
  if (action === "create-inverse") {
    if (!ctx.canCreateInverse) return;
    createInverseTagForEntry(
      ctx.entry && ctx.entry.kind === "tag"
        ? ctx.entry
        : {
            kind: "tag",
            tag: String(ctx.tag || ""),
            album: normalizeTagAlbumName(ctx.album || ""),
            special: String(ctx.special || ""),
            label: String(ctx.label || ctx.tag || ctx.album || "Tag"),
            originPath: String(ctx.originPath || WS.nav?.dirNode?.path || ""),
            placeholder: false,
          },
    );
    return;
  }
  if (action === "hidden") {
    if (!ctx.canHide || !tagKey) return;
    if (!metaSetHiddenTagByKey(tagKey, !ctx.isHidden)) return;
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `${ctx.isHidden ? "Unhid" : "Hid"} ${isGalleryEntry ? "gallery" : isAlbumEntry ? "album" : "tag"} '${label}'.`,
    );
    return;
  }
  if (action === "appearance-preset-clear") {
    if (!ctx.canAppearancePreset || !tagKey) return;
    if (!metaClearTagAppearancePresetByKey(tagKey)) return;
    refreshAfterProcessingMetadataChange();
    showStatusMessage(
      `${isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag"} media preset reset.`,
    );
    return;
  }
  if (action === "media-filter-clear") {
    if (!ctx.canMediaFilter || !tagKey) return;
    if (!metaClearTagMediaFilterByKey(tagKey)) return;
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `${isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag"} content filter cleared.`,
    );
    return;
  }
  if (action === "thumbnail-default") {
    if (!tagKey) return;
    if (resetTagThumbnailToDefaultByKey(tagKey)) {
      refreshThumbnailUiAfterMetadataChange();
      showStatusMessage(
        `${isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag"} thumbnail reset to default.`,
      );
    }
    return;
  }
  if (action === "thumbnail-none") {
    if (!tagKey) return;
    if (metaSetTagThumbnailModeByKey(tagKey, "none")) {
      refreshThumbnailUiAfterMetadataChange();
      showStatusMessage(
        `${isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag"} thumbnail blanked.`,
      );
    }
    return;
  }
  if (action === "thumbnail-rotate") {
    if (!tagKey) return;
    if (metaSetTagThumbnailRotateByKey(tagKey)) {
      refreshThumbnailUiAfterMetadataChange();
      showStatusMessage(
        `${isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag"} thumbnail set to shuffle.`,
      );
    }
    return;
  }
  if (action === "thumbnail-random") {
    setRandomTagThumbnailForEntry(ctx.entry);
    return;
  }
  applyContainerThumbnailToTarget(
    action,
    currentThumbnailRecordForTagEntry(ctx.entry),
  );
}
