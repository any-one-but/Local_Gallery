/* Editing Tags
   Bulk tagging, Tag rename, Add/Remove tag, favourite/hidden toggles and
   Storage state changes. */

function collectDescendantDirPaths(path) {
  const p = String(path || "");
  const start = WS.dirByPath && WS.dirByPath.get(p);
  if (!start) {
    const out = [];
    const prefix = p ? p + "/" : "";
    if (WS.dirByPath) {
      for (const key of WS.dirByPath.keys()) {
        const k = String(key || "");
        if (k === p) out.push(k);
        else if (prefix && k.startsWith(prefix)) out.push(k);
      }
    }
    if (!out.length) out.push(p);
    out.sort((a, b) => {
      const da = String(a || "")
        .split("/")
        .filter(Boolean).length;
      const db = String(b || "")
        .split("/")
        .filter(Boolean).length;
      return da - db;
    });
    return out;
  }
  const out = [];
  (function walk(node) {
    if (!node) return;
    out.push(String(node.path || ""));
    const children = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
    for (const child of children) walk(child);
  })(start);
  return out;
}

function refreshAfterProcessingMetadataChange() {
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  invalidateAllThumbs();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  applyMediaFilterFromOptions();
}

function metaSetUserTags(path, userTags) {
  const changed = metaWriteUserTags(path, userTags);
  if (!changed) return;
  metaScheduleSave();
  TAG_EDIT_PATH = null;
  PREVIEW_BULK_TAG_EDIT = null;
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function refreshAfterTagMetadataChange() {
  TAG_EDIT_PATH = null;
  PREVIEW_BULK_TAG_EDIT = null;
  clearBulkTagPlaceholder();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function clearBulkTagPlaceholder() {
  if (!BULK_TAG_PLACEHOLDER) return false;
  BULK_TAG_PLACEHOLDER = null;
  TAG_ENTRY_RENAME_STATE = null;
  return true;
}

function canUseBulkTagPlaceholderUi() {
  if (!WS.root) return false;
  return true;
}

function startBulkTagging(paths, preferPane = "") {
  if (
    canUseBulkTagPlaceholderUi() &&
    setBulkTagPlaceholder(paths, "New tag", "tag", "", preferPane)
  )
    return;
}

// Names a Tag (new or existing) to put the given Tags in.
function startBulkTagInTag(tags, preferPane = "") {
  if (!canUseBulkTagPlaceholderUi()) return false;
  return setBulkTagPlaceholder(tags, "New tag", "tagInTag", "", preferPane);
}

function startBulkTagAlbuming(tags, originPath = "", preferPane = "") {
  if (
    canUseBulkTagPlaceholderUi() &&
    setBulkTagPlaceholder(
      tags,
      "New tag",
      "album",
      originPath,
      preferPane,
    )
  )
    return;
}

function startBulkFolderAlbuming(paths, preferPane = "") {
  if (
    canUseBulkTagPlaceholderUi() &&
    setBulkTagPlaceholder(paths, "New tag", "folderAlbum", "", preferPane)
  )
    return;
}

function startBulkAlbumTagging(albumTargets, preferPane = "") {
  if (
    canUseBulkTagPlaceholderUi() &&
    setBulkTagPlaceholder(albumTargets, "New tag", "albumTag", "", preferPane)
  )
    return;
}

function startBulkGallerying(targets, preferPane = "") {
  if (!canUseBulkTagPlaceholderUi()) return false;
  return setBulkTagPlaceholder(
    targets,
    "New tag",
    "gallery",
    "",
    preferPane,
  );
}

function startBulkGalleryTagging(galleries, preferPane = "") {
  if (
    canUseBulkTagPlaceholderUi() &&
    setBulkTagPlaceholder(galleries, "New tag", "galleryTag", "", preferPane)
  )
    return;
}

function startBulkGalleryAlbuming(galleries, preferPane = "") {
  if (
    canUseBulkTagPlaceholderUi() &&
    setBulkTagPlaceholder(galleries, "New tag", "galleryAlbum", "", preferPane)
  )
    return;
}

function setBulkTagPlaceholder(
  items,
  label = "New tag",
  placeholderType = "tag",
  originPath = "",
  preferPane = "",
  extra = null,
) {
  clearBulkTagPlaceholder();
  // The name input this launches must not be left covered by the app menu it
  // was invoked from; drop the suppression window and close the menu first.
  allowMenuClose();
  closeActionMenus();
  const rawType = String(placeholderType || "tag");
  const type =
    rawType === "album" ||
    rawType === "folderAlbum" ||
    rawType === "albumTag" ||
    rawType === "gallery" ||
    rawType === "galleryTag" ||
    rawType === "galleryAlbum" ||
    rawType === "tagInTag"
      ? rawType
      : "tag";
  let unique = [];
  if (type === "album" || type === "tagInTag") {
    unique = normalizeTagList(items).filter((tag) => !isReservedFolderTag(tag));
  } else if (type === "albumTag") {
    const seen = new Set();
    const arr = Array.isArray(items) ? items : [];
    for (let i = 0; i < arr.length; i++) {
      const album = normalizeTagAlbumName(arr[i]?.album || "");
      const targetOriginPath = String(arr[i]?.originPath || "");
      const key = albumTagMembershipKey(album, targetOriginPath);
      if (!album || !key || seen.has(key)) continue;
      seen.add(key);
      unique.push({ album, originPath: targetOriginPath });
    }
  } else if (type === "gallery") {
    const seen = new Set();
    const arr = Array.isArray(items) ? items : [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (typeof item === "string") {
        const path = normalizeDirPathValue(item);
        const key = path ? `dir:${path}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({ kind: "dir", path });
        continue;
      }
      const kind = String(item?.kind || "");
      if (kind === "dir") {
        const path = normalizeDirPathValue(item.path || "");
        const key = path ? `dir:${path}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({ kind: "dir", path });
      } else if (kind === "tag") {
        const tag = normalizeTag(item.tag || "");
        const originPath = normalizeTagAlbumScopePath(item.originPath || "");
        const key = tag ? `tag:${originPath}:${tag}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({ kind: "tag", tag, originPath });
      } else if (kind === "album") {
        const album = normalizeTagAlbumName(item.album || "");
        const originPath = normalizeTagAlbumScopePath(item.originPath || "");
        const key = album ? `album:${originPath}:${album}` : "";
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({ kind: "album", album, originPath });
      }
    }
  } else if (type === "galleryTag" || type === "galleryAlbum") {
    unique = Array.from(
      new Set((items || []).map(normalizeGalleryName).filter(Boolean)),
    );
  } else {
    unique = Array.from(
      new Set((items || []).map((p) => String(p || ""))),
    ).filter((p) => p);
  }
  if (!unique.length) return false;
  const prefersPreview = String(preferPane || "").toLowerCase() === "preview";
  // Seed multi-membership editors with values every selected item already
  // shares. Commits diff against these baselines so removing a shared value
  // removes it from every target while memberships unique to one target stay.
  // A contents field edits the rules of its sources, so it starts from the
  // names every source's rule already has rather than from the child folders.
  const contentsSources =
    type === "tag" && extra && Array.isArray(extra.contentsSources)
      ? extra.contentsSources.filter(Boolean)
      : [];
  // Add tag -> Create new names one fresh Tag, so the field starts at
  // "New tag" rather than at the shared names, and carries the settings chosen
  // for it (applyPendingContainerOverrides).
  const createNew =
    (type === "tag" || type === "tagInTag") &&
    extra &&
    extra.createNew &&
    typeof extra.createNew === "object"
      ? extra.createNew
      : null;
  const commonTags = createNew
    ? []
    : contentsSources.length
    ? metaGetContentTags(contentsSources[0]).filter((tag) =>
        contentsSources.every((key) => metaGetContentTags(key).includes(tag)),
      )
    : type === "tag"
      ? commonUserTagsForPaths(unique)
      : [];
  const commonGalleries =
    type === "gallery" ? commonGalleryNamesForTargets(unique) : [];
  const effectiveLabel = commonTags.length
    ? commonTags.join(", ")
    : commonGalleries.length
      ? commonGalleries.join(", ")
      : label;
  BULK_TAG_PLACEHOLDER = {
    type,
    label: effectiveLabel,
    count: unique.length,
    preferPane: prefersPreview ? "preview" : "directories",
  };
  TAG_ENTRY_RENAME_STATE = {
    tag: "",
    label: effectiveLabel,
    paths: type === "tag" || type === "folderAlbum" ? unique.slice() : [],
    tags: type === "album" || type === "tagInTag" ? unique.slice() : [],
    albumTargets: type === "albumTag" ? unique.slice() : [],
    galleryTargets: type === "gallery" ? unique.slice() : [],
    galleries:
      type === "galleryTag" || type === "galleryAlbum" ? unique.slice() : [],
    originPath: type === "album" ? String(originPath || "") : "",
    placeholder: true,
    placeholderType: type,
    commonTags: type === "tag" ? commonTags : undefined,
    commonGalleries: type === "gallery" ? commonGalleries : undefined,
    contentsSources,
    createSingleContainer: !!createNew,
    pendingContainerOverrides: createNew ? { ...createNew } : undefined,
  };
  rebuildDirectoriesEntries();
  // When tagging from the preview pane, keep the file pane's current selection
  // (and therefore the folder shown in the preview) intact, so the placeholder
  // appears in the preview grid alongside the folders being tagged. Only the
  // file-pane flow jumps the selection onto its own placeholder card.
  if (!prefersPreview) WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  setTimeout(() => {
    focusTagEntryRenameInput(preferPane, { retractIfMissing: true });
  }, 0);
  return true;
}

/* Unlike the other three, this is a *re-focus* helper as well as a starter's
   focus call: the tail of every `renderDirectoriesPane` calls it again while a
   tag rename is open, to put the caret back after the row was rebuilt. So the
   retraction is opt-in and only the starter passes it. A blanket retraction
   here would let any later render that happens to run while the row is not
   drawn cancel a rename the user is in the middle of typing. */
function focusTagEntryRenameInput(preferPane = "", opts = null) {
  const prefer = String(preferPane || WS.view?.activePane || "").toLowerCase();
  const retract = !!(opts && opts.retractIfMissing);
  queueInlineInputFocus(
    () => {
      if (prefer === "preview") {
        return (
          (previewBodyEl &&
            previewBodyEl.querySelector(".tagEntryRenameInput")) ||
          (directoriesListEl &&
            directoriesListEl.querySelector(".tagEntryRenameInput"))
        );
      }
      return (
        (directoriesListEl &&
          directoriesListEl.querySelector(".tagEntryRenameInput")) ||
        (previewBodyEl && previewBodyEl.querySelector(".tagEntryRenameInput"))
      );
    },
    retract ? () => clearPendingInlineEdit() : null,
  );
}

function beginTagEntryRename(renameState, preferPane = "") {
  const state =
    renameState && typeof renameState === "object" ? renameState : null;
  if (!state) return false;
  TAG_ENTRY_RENAME_STATE = state;
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  focusTagEntryRenameInput(preferPane);
  return true;
}

function tagEntryRenameStateIsAlbum(state) {
  if (!state) return false;
  const album = normalizeTagAlbumName(state.album || "");
  const tag = normalizeTag(state.tag || "");
  // Album entries hosted inside a gallery also carry the containing gallery's
  // name. The album field identifies the item being renamed; gallery is only
  // contextual in that case.
  return !!album && !tag;
}

function tagEntryRenameStateIsGallery(state) {
  if (!state) return false;
  const gallery = normalizeGalleryName(state.gallery || "");
  const tag = normalizeTag(state.tag || "");
  const album = normalizeTagAlbumName(state.album || "");
  return !!gallery && !tag && !album;
}

function tagEntryRenameValueFromState(state) {
  if (!state) return "";
  if (state.placeholder) return String(state.label || "");
  if (tagEntryRenameStateIsAlbum(state))
    return String(state.album || state.label || "");
  if (tagEntryRenameStateIsGallery(state))
    return String(state.gallery || state.label || "");
  return String(state.tag || state.label || "");
}

function finishTagEntryRenameRender() {
  TAG_ENTRY_RENAME_STATE = null;
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
}

function cancelTagEntryRename() {
  const state = TAG_ENTRY_RENAME_STATE;
  if (!state) return;
  if (state.placeholder) {
    clearBulkTagPlaceholder();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    return;
  }
  finishTagEntryRenameRender();
}

function pendingContainerOverrideKey(state, containerName) {
  const pending = state?.pendingContainerOverrides;
  const kind = String(pending?.containerType || "");
  if (!kind) return "";
  if (kind === "gallery") return tagThumbnailKeyForGallery(containerName);

  let scopePath = String(state?.originPath || "");
  if (!scopePath && Array.isArray(state?.albumTargets))
    scopePath = String(state.albumTargets[0]?.originPath || "");
  if (!scopePath && Array.isArray(state?.paths) && state.paths.length)
    scopePath = hiddenTagScopePathForDirPath(state.paths[0]);
  scopePath = normalizeTagAlbumScopePath(scopePath);
  return kind === "album"
    ? tagThumbnailKeyForAlbum(containerName, scopePath)
    : tagThumbnailKeyForTag(containerName, scopePath);
}

function applyPendingContainerOverrides(state, containerName) {
  const pending = state?.pendingContainerOverrides;
  const key = pendingContainerOverrideKey(state, containerName);
  if (!pending || !key) return false;
  let changed = false;
  if (
    pending.sortModeTouched &&
    metaSetTagContainerSortMode(key, pending.sortMode || "")
  )
    changed = true;
  if (
    pending.appearancePresetTouched &&
    metaSetTagAppearancePresetIdByKey(
      key,
      pending.appearancePresetId || "",
    )
  )
    changed = true;
  if (pending.mediaTypeTouched) {
    const mediaFilter = setTagMediaFilterAxis(
      [],
      TAG_MEDIA_FILTER_MEDIA_TYPES,
      pending.mediaType || null,
    );
    if (metaSetTagMediaFilterByKey(key, mediaFilter)) changed = true;
  }
  if (
    pending.exclusiveTouched &&
    pending.containerType === "tag" &&
    metaSetTagExclusive(containerName, !!pending.exclusive)
  )
    changed = true;
  if (pending.containerType === "tag") {
    const tagName = normalizeTag(containerName);
    for (const kind of SCORE_FILTER_KINDS) {
      if (
        tagName &&
        pending[`${kind}ScoreTouched`] &&
        metaSetScoreFilterOverride(`tag:${tagName}`, kind, pending[`${kind}Score`])
      )
        changed = true;
    }
  }
  if (changed) {
    metaScheduleSave();
    // The membership was drawn before these settings existed.
    refreshAfterTagMetadataChange();
  }
  return changed;
}

function commitTagEntryRename(inputEl) {
  if (!TAG_ENTRY_RENAME_STATE || !inputEl) return;
  const state = TAG_ENTRY_RENAME_STATE;
  // Add tag to all contents: the same diff, applied to each source's contents rule
  // instead of to the folders inside it, so it keeps holding for anything added
  // to those folders later.
  if (
    state.placeholder &&
    Array.isArray(state.contentsSources) &&
    state.contentsSources.length
  ) {
    TAG_ENTRY_RENAME_STATE = null;
    clearBulkTagPlaceholder();
    const committed = normalizeTagsFromText(inputEl.value || "");
    const committedSet = new Set(committed);
    const baseline = normalizeTagList(state.commonTags);
    const baselineSet = new Set(baseline);
    const removed = baseline.filter((t) => !committedSet.has(t));
    const added = committed.filter((t) => !baselineSet.has(t));
    if (!metaApplyContentTagsDiff(state.contentsSources, removed, added)) {
      if (
        !added.some((t) =>
          state.contentsSources.some((key) => tagLockRefusesContentsSource(t, key)),
        )
      )
        showStatusMessage("No tags updated.");
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      return;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    if (state.createSingleContainer)
      committed.forEach((name) => applyPendingContainerOverrides(state, name));
    showStatusMessage(
      committed.length
        ? `Contents added to ${committed.map((name) => `'${name}'`).join(", ")}, including anything added later.`
        : "Contents no longer added to a tag.",
    );
    finalizeBulkSelectionAction();
    return;
  }
  // Bulk folder tagging seeded with the shared tags: commit is a diff against
  // that baseline. Tags deleted from the field are removed from every selected
  // item, tags added are added to every item, and each item's own unique tags
  // are untouched. An empty field is valid here -- it strips the shared tags.
  if (
    state.placeholder &&
    state.placeholderType === "tag" &&
    Array.isArray(state.commonTags) &&
    !state.createSingleContainer
  ) {
    TAG_ENTRY_RENAME_STATE = null;
    clearBulkTagPlaceholder();
    const committed = normalizeTagsFromText(inputEl.value || "");
    const committedSet = new Set(committed);
    const baseline = normalizeTagList(state.commonTags);
    const baselineSet = new Set(baseline);
    const removed = baseline.filter((t) => !committedSet.has(t));
    const added = committed.filter((t) => !baselineSet.has(t));
    const changed = metaApplyBulkUserTagDiff(state.paths, removed, added);
    if (!changed) {
      // A Model only / Root only refusal has already said why.
      if (!added.some((t) => tagLockRefusesPaths(t, state.paths)))
        showStatusMessage("No tags updated.");
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      return;
    }
    finalizeBulkSelectionAction();
    return;
  }
  // Gallery membership is also many-to-many. The editor starts with the
  // galleries shared by all selected folders/tags/albums, then applies only
  // the removed and added names to every target.
  if (
    state.placeholder &&
    state.placeholderType === "gallery" &&
    Array.isArray(state.commonGalleries) &&
    !state.createSingleContainer
  ) {
    TAG_ENTRY_RENAME_STATE = null;
    clearBulkTagPlaceholder();
    const committed = normalizeTagsFromText(inputEl.value || "").map(
      normalizeGalleryName,
    );
    const committedSet = new Set(committed);
    const baseline = normalizeTagList(state.commonGalleries).map(
      normalizeGalleryName,
    );
    const baselineSet = new Set(baseline);
    const removed = baseline.filter((gallery) => !committedSet.has(gallery));
    const added = committed.filter((gallery) => !baselineSet.has(gallery));
    const changed = metaApplyBulkGalleryDiff(
      state.galleryTargets,
      removed,
      added,
    );
    if (!changed) {
      showStatusMessage("No galleries updated.");
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      return;
    }
    finalizeBulkSelectionAction();
    return;
  }
  // Putting Tags in Tags takes a list too: "A, B" puts the selection in both,
  // and a name that does not exist yet becomes a new Tag.
  if (
    state.placeholder &&
    state.placeholderType === "tagInTag" &&
    !state.createSingleContainer
  ) {
    TAG_ENTRY_RENAME_STATE = null;
    clearBulkTagPlaceholder();
    const names = normalizeTagsFromText(inputEl.value || "").filter(
      (name) => !isInternalTagName(name),
    );
    const children = normalizeTagList(state.tags);
    const into = [];
    for (const name of names) {
      let placed = false;
      for (const child of children) {
        if (metaAddTagParent(child, name)) placed = true;
      }
      if (placed) into.push(name);
    }
    if (!into.length) {
      // A Model only / Root only refusal has already said why.
      if (!names.some((name) => children.some((c) => tagLockRefusesTag(name, c))))
        showStatusMessage(
          names.length
            ? "A tag can't go inside itself or a tag it holds."
            : "Tag name cannot be empty.",
        );
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      return;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `Put ${children.length} tag${children.length === 1 ? "" : "s"} in ${into
        .map((name) => `'${name}'`)
        .join(", ")}.`,
    );
    finalizeBulkSelectionAction();
    return;
  }
  const desired = normalizeTag(inputEl.value || "");
  if (!desired) {
    showStatusMessage("Tag name cannot be empty.");
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    return;
  }
  if (isInternalTagName(desired)) {
    showStatusMessage(`'${desired}' is a name Local Gallery uses itself.`);
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    return;
  }
  const isPlaceholder = !!state.placeholder;
  const isAlbumRename = tagEntryRenameStateIsAlbum(state);
  const isGalleryRename = tagEntryRenameStateIsGallery(state);
  const oldGalleryName = normalizeGalleryName(state.gallery || "");
  const desiredGalleryName = normalizeGalleryName(desired);
  const galleryMergeTargetExists =
    isGalleryRename &&
    desiredGalleryName !== oldGalleryName &&
    getAllGalleryNames().includes(desiredGalleryName);
  TAG_ENTRY_RENAME_STATE = null;
  if (
    !isPlaceholder &&
    desired === normalizeTag(tagEntryRenameValueFromState(state))
  ) {
    showStatusMessage("Tag name unchanged.");
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    return;
  }
  if (isPlaceholder) {
    clearBulkTagPlaceholder();
    if (state.placeholderType === "album") {
      const changed = assignTagAlbumForTagsBulk(
        state.tags,
        desired,
        state.originPath,
      );
      if (!changed) {
        showStatusMessage("No tags updated.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
    } else if (state.placeholderType === "folderAlbum") {
      const changed = assignAlbumForFoldersBulk(state.paths, desired);
      if (!changed) {
        showStatusMessage("No folders updated.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
    } else if (state.placeholderType === "albumTag") {
      const changed = addUserTagsToAlbumsBulk(state.albumTargets, [desired]);
      if (!changed) {
        showStatusMessage("No albums updated.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
    } else if (state.placeholderType === "gallery") {
      const changed = assignTargetsToGalleryBulk(state.galleryTargets, desired);
      if (!changed) {
        showStatusMessage("No items updated.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
    } else if (state.placeholderType === "galleryTag") {
      const changed = addUserTagsToGalleryBulk(state.galleries, [desired]);
      if (!changed) {
        showStatusMessage("No galleries updated.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
    } else if (state.placeholderType === "galleryAlbum") {
      const changed = assignAlbumForGalleriesBulk(state.galleries, desired);
      if (!changed) {
        showStatusMessage("No galleries updated.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
    } else if (state.placeholderType === "tagInTag") {
      let nested = 0;
      for (const child of normalizeTagList(state.tags)) {
        if (metaAddTagParent(child, desired)) nested++;
      }
      if (!nested) {
        const children = normalizeTagList(state.tags);
        if (!children.some((c) => tagLockRefusesTag(desired, c)))
          showStatusMessage("A tag can't go inside itself or a tag it holds.");
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
      metaScheduleSave();
      refreshAfterTagMetadataChange();
      showStatusMessage(`Put ${nested} tag${nested === 1 ? "" : "s"} in '${desired}'.`);
    } else {
      metaAddUserTagsBulk(state.paths, [desired]);
    }
    applyPendingContainerOverrides(state, desired);
    finalizeBulkSelectionAction();
    return;
  }
  let changed = false;
  if (isAlbumRename) {
    changed = renameTagAlbumByName(state.album, desired, state.originPath);
  } else if (isGalleryRename) {
    changed = renameGalleryByName(state.gallery, desired);
  } else {
    const result = renameTagEverywhere(state.tag, desired);
    if (!result.ok) {
      showStatusMessage(
        result.reason === "exists"
          ? `A tag named '${desired}' already exists.`
          : result.reason === "reserved"
            ? `'${desired}' is a name Local Gallery uses itself.`
            : "Tag name unchanged.",
      );
      finishTagEntryRenameRender();
      return;
    }
    changed = true;
  }
  if (!changed) {
    showStatusMessage(
      isGalleryRename
        ? "Gallery could not be renamed."
        : isAlbumRename
          ? "No tag albums updated."
          : "No folders updated.",
    );
    finishTagEntryRenameRender();
    return;
  }
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  if (isGalleryRename) {
    showStatusMessage(
      galleryMergeTargetExists
        ? `Merged gallery '${oldGalleryName}' into '${desiredGalleryName}'.`
        : `Renamed gallery '${oldGalleryName}' to '${desiredGalleryName}'.`,
    );
  }
}

function assignTagAlbumForTagsBulk(tags, albumName, scopePath = null) {
  const album = normalizeTagAlbumName(albumName);
  if (!album) return false;
  const normalizedTags = normalizeTagList(tags).filter(
    (tag) => !isReservedFolderTag(tag),
  );
  if (!normalizedTags.length) return false;
  let changed = false;
  let changedCount = 0;
  for (let i = 0; i < normalizedTags.length; i++) {
    if (metaSetTagAlbumForTag(normalizedTags[i], album, scopePath)) {
      changed = true;
      changedCount++;
    }
  }
  if (!changed) return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(
    `Assigned ${changedCount} tag${changedCount === 1 ? "" : "s"} to album '${album}'.`,
  );
  return true;
}

function assignAlbumForFoldersBulk(paths, albumName) {
  const album = normalizeTagAlbumName(albumName);
  if (!album) return false;
  const list = Array.isArray(paths) ? paths : Array.from(paths || []);
  let changed = false;
  let changedCount = 0;
  for (let i = 0; i < list.length; i++) {
    const p = normalizeDirPathValue(list[i]);
    if (!p) continue;
    if (metaSetAlbumForPath(p, album)) {
      changed = true;
      changedCount++;
    }
  }
  if (!changed) return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(
    `Moved ${changedCount} folder${changedCount === 1 ? "" : "s"} to album '${album}'.`,
  );
  return true;
}

function addUserTagsToAlbumsBulk(albumTargets, tagsToAdd) {
  const add = normalizeTagList(tagsToAdd).filter(
    (tag) => !isReservedFolderTag(tag),
  );
  if (!add.length) return false;
  const targets = Array.isArray(albumTargets) ? albumTargets : [];
  let changed = false;
  let changedCount = 0;
  for (let i = 0; i < targets.length; i++) {
    const album = normalizeTagAlbumName(targets[i]?.album || "");
    const originPath = String(targets[i]?.originPath || "");
    if (!album) continue;
    const existing = metaGetUserTagsForAlbum(album, originPath);
    const next = normalizeTagList(existing.concat(add)).filter(
      (tag) => tag !== album,
    );
    if (metaSetUserTagsForAlbum(album, originPath, next)) {
      changed = true;
      changedCount++;
    }
  }
  if (!changed) return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(
    `Tagged ${changedCount} album${changedCount === 1 ? "" : "s"}.`,
  );
  return true;
}

function assignTargetsToGalleryBulk(targets, galleryName) {
  const gallery = normalizeGalleryName(galleryName);
  if (!gallery) return false;
  const list = Array.isArray(targets) ? targets : [];
  let changed = false;
  let changedCount = 0;
  const addTags = [];
  const addAlbums = [];
  for (let i = 0; i < list.length; i++) {
    const target = list[i] || {};
    const kind = String(target.kind || "");
    if (kind === "dir") {
      if (metaAddGalleryForPath(target.path, gallery)) {
        changed = true;
        changedCount++;
      }
    } else if (kind === "tag") {
      const tag = normalizeTag(target.tag || "");
      if (tag)
        addTags.push({
          tag,
          originPath: normalizeTagAlbumScopePath(target.originPath || ""),
        });
    } else if (kind === "album") {
      const album = normalizeTagAlbumName(target.album || "");
      if (album)
        addAlbums.push({
          album,
          originPath: normalizeTagAlbumScopePath(target.originPath || ""),
        });
    }
  }
  if (addTags.length) {
    const next = metaGetMemberTagTargetsForGallery(gallery).concat(addTags);
    if (metaSetMemberTagTargetsForGallery(gallery, next)) {
      changed = true;
      changedCount += addTags.length;
    }
  }
  if (addAlbums.length) {
    const next = metaGetMemberAlbumTargetsForGallery(gallery).concat(addAlbums);
    if (metaSetMemberAlbumTargetsForGallery(gallery, next)) {
      changed = true;
      changedCount += addAlbums.length;
    }
  }
  if (!changed) return false;
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(
    `Added ${changedCount} item${changedCount === 1 ? "" : "s"} to gallery '${gallery}'.`,
  );
  return true;
}

function metaToggleFavorite(path) {
  const p = String(path || "");
  const tags = metaGetTags(p);
  const has = tags.includes(FAVORITE_TAG);
  const next = has
    ? tags.filter((t) => t !== FAVORITE_TAG)
    : [FAVORITE_TAG].concat(tags.filter((t) => t !== FAVORITE_TAG));
  const layout = capturePreviewGridLayout();
  WS.meta.dirTags.set(p, normalizeTagList(next));
  metaMarkDirty(META_DOC_IDS.tags);
  invalidateDirMetricsCaches();
  syncFavoritesUi();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  settlePreviewGridLayout(layout);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  if (!has) announceFavoritesAdded([p]);
}

function metaAddUserTagsBulk(paths, tagsToAdd) {
  const add = normalizeTagList(tagsToAdd).filter(
    (t) => !isReservedFolderTag(t) && !isInternalTagName(t),
  );
  if (!add.length) return;

  const list = Array.isArray(paths) ? paths : Array.from(paths || []);
  if (!list.length) return;

  const refused = new Set();
  for (let i = 0; i < list.length; i++) {
    const p = String(list[i] || "");
    if (!p) continue;
    const existing = metaGetTags(p);
    const reserved = existing.filter((t) => isReservedFolderTag(t));
    const curUser = existing.filter((t) => !isReservedFolderTag(t));
    const mergedUser = normalizeTagList(
      curUser.concat(filterLockedTagsForPath(p, add, refused)),
    );
    const merged = reserved.concat(mergedUser);
    WS.meta.dirTags.set(p, normalizeTagList(merged));
  }

  metaMarkDirty(META_DOC_IDS.tags);
  invalidateDirMetricsCaches();
  TAG_EDIT_PATH = null;
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  announceTagLockRefusals(refused);
}

// The user tags shared by every path in the set (their intersection), used to
// seed the bulk tag editor so common tags can be removed in one action.
function commonUserTagsForPaths(paths) {
  const list = Array.from(
    new Set((paths || []).map((p) => String(p || "")).filter(Boolean)),
  );
  if (!list.length) return [];
  let common = null;
  for (let i = 0; i < list.length; i++) {
    const tags = new Set(metaGetUserTags(list[i]));
    if (common === null) {
      common = tags;
    } else {
      for (const t of Array.from(common)) if (!tags.has(t)) common.delete(t);
    }
    if (!common.size) return [];
  }
  return common ? normalizeTagList(Array.from(common)) : [];
}

function galleryNamesForTarget(target, galleryNames = null) {
  const item = target && typeof target === "object" ? target : null;
  if (!item) return [];
  const names = Array.isArray(galleryNames)
    ? galleryNames
    : getAllGalleryNames();
  const kind = String(item.kind || "");
  if (kind === "dir") {
    const memberships = new Set(metaGetGalleriesForPath(item.path));
    return names.filter((gallery) => memberships.has(gallery));
  }
  if (kind === "tag") {
    const tag = normalizeTag(item.tag || "");
    const originPath = normalizeTagAlbumScopePath(item.originPath || "");
    if (!tag) return [];
    return names.filter((gallery) =>
      metaGetMemberTagTargetsForGallery(gallery).some(
        (target) =>
          target.tag === tag && target.originPath === originPath,
      ),
    );
  }
  if (kind === "album") {
    const album = normalizeTagAlbumName(item.album || "");
    const originPath = normalizeTagAlbumScopePath(item.originPath || "");
    if (!album) return [];
    return names.filter((gallery) =>
      metaGetMemberAlbumTargetsForGallery(gallery).some(
        (target) =>
          target.album === album && target.originPath === originPath,
      ),
    );
  }
  return [];
}

// The galleries shared by every selected target. Gallery membership supports
// real folders plus virtual tags and albums, so resolve each target through its
// own metadata relation before intersecting the names.
function commonGalleryNamesForTargets(targets) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!list.length) return [];
  const galleryNames = getAllGalleryNames();
  let common = null;
  for (let i = 0; i < list.length; i++) {
    const memberships = new Set(
      galleryNamesForTarget(list[i], galleryNames),
    );
    if (common === null) {
      common = memberships;
    } else {
      for (const gallery of Array.from(common)) {
        if (!memberships.has(gallery)) common.delete(gallery);
      }
    }
    if (!common.size) return [];
  }
  return common ? Array.from(common) : [];
}

function labelTargetForTagEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.special || entry.placeholder)
    return null;
  const tag = normalizeTag(entry.tag || "");
  return tag
    ? { kind: "tag", tag, originPath: normalizeTagAlbumScopePath(entry.originPath || "") }
    : null;
}

function labelTargetsForSelectionTarget(selectionTarget) {
  const target =
    selectionTarget && typeof selectionTarget === "object"
      ? selectionTarget
      : null;
  if (!target) return [];
  if (target.kind === "dir") {
    const path = normalizeDirPathValue(target.node?.path || "");
    return path ? [{ kind: "dir", path }] : [];
  }
  if (target.kind === "tag") {
    const item = labelTargetForTagEntry(target.entry);
    return item ? [item] : [];
  }
  if (target.kind !== "bulk") return [];

  const out = [];
  const paths = Array.isArray(target.paths) ? target.paths : [];
  for (let i = 0; i < paths.length; i++) {
    const path = normalizeDirPathValue(paths[i]);
    if (path) out.push({ kind: "dir", path });
  }
  const entries = Array.isArray(target.entries) ? target.entries : [];
  for (let i = 0; i < entries.length; i++) {
    const item = labelTargetForTagEntry(entries[i]);
    // A special container has no label membership of its own. If one appears
    // in a mixed selection, no membership can be common to every selected item.
    if (!item) return [];
    out.push(item);
  }
  return out;
}

function directHiddenKeyForLabelTarget(target) {
  const item = target && typeof target === "object" ? target : null;
  if (!item) return "";
  if (item.kind === "tag")
    return hiddenTagKeyForTag(item.tag, item.originPath || "");
  if (item.kind === "album")
    return hiddenTagKeyForAlbum(item.album, item.originPath || "");
  if (item.kind === "gallery") return hiddenTagKeyForGallery(item.gallery);
  return "";
}

function labelMembershipsForTarget(target) {
  const item = target && typeof target === "object" ? target : null;
  const empty = {
    tags: [],
    album: "",
    galleries: [],
    favorite: false,
    hidden: false,
  };
  if (!item) return empty;
  if (item.kind === "dir") {
    return {
      tags: metaGetUserTags(item.path),
      album: metaGetAlbumForPath(item.path),
      galleries: metaGetGalleriesForPath(item.path),
      favorite: metaHasFavorite(item.path),
      // Only offer a removable direct marker. Effective hidden state inherited
      // from a parent/container cannot be removed from this item itself.
      hidden: metaHasLegacyHidden(item.path),
    };
  }
  if (item.kind === "tag") {
    return {
      // The Tags that hold this Tag.
      tags: tagParentNames(item.tag),
      album: "",
      galleries: [],
      favorite: false,
      hidden: metaHasHiddenTagByKey(directHiddenKeyForLabelTarget(item)),
    };
  }
  if (item.kind === "album") {
    return {
      tags: metaGetUserTagsForAlbum(item.album, item.originPath || ""),
      album: "",
      galleries: galleryNamesForTarget(item),
      favorite: false,
      hidden: metaHasHiddenTagByKey(directHiddenKeyForLabelTarget(item)),
    };
  }
  if (item.kind === "gallery") {
    return {
      tags: metaGetUserTagsForGallery(item.gallery),
      album: metaGetAlbumForGallery(item.gallery),
      galleries: [],
      favorite: false,
      hidden: metaHasHiddenTagByKey(directHiddenKeyForLabelTarget(item)),
    };
  }
  return empty;
}

function commonLabelMembershipsForTargets(targets) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!list.length) return null;
  const first = labelMembershipsForTarget(list[0]);
  const commonTags = new Set(first.tags);
  const commonGalleries = new Set(first.galleries);
  let commonAlbum = first.album;
  let commonFavorite = first.favorite;
  let commonHidden = first.hidden;
  for (let i = 1; i < list.length; i++) {
    const memberships = labelMembershipsForTarget(list[i]);
    const tags = new Set(memberships.tags);
    const galleries = new Set(memberships.galleries);
    for (const tag of Array.from(commonTags)) {
      if (!tags.has(tag)) commonTags.delete(tag);
    }
    for (const gallery of Array.from(commonGalleries)) {
      if (!galleries.has(gallery)) commonGalleries.delete(gallery);
    }
    if (!memberships.album || memberships.album !== commonAlbum)
      commonAlbum = "";
    commonFavorite = commonFavorite && memberships.favorite;
    commonHidden = commonHidden && memberships.hidden;
  }
  return {
    tags: normalizeTagList(Array.from(commonTags)),
    album: normalizeTagAlbumName(commonAlbum),
    galleries: Array.from(commonGalleries).sort((a, b) =>
      String(a).localeCompare(String(b)),
    ),
    favorite: commonFavorite,
    hidden: commonHidden,
  };
}

function removeLabelMembershipFromTargets(targets, membership) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const item = membership && typeof membership === "object" ? membership : null;
  if (!list.length || !item) return false;
  if (item.kind === "gallery") {
    return metaApplyBulkGalleryDiff(list, [item.name], []);
  }

  let changed = false;
  for (let i = 0; i < list.length; i++) {
    const target = list[i];
    if (item.kind === "tag") {
      const tag = normalizeTag(item.name || "");
      if (!tag) continue;
      if (target.kind === "dir") {
        const current = metaGetUserTags(target.path);
        if (
          current.includes(tag) &&
          metaWriteUserTags(
            target.path,
            current.filter((value) => value !== tag),
          )
        )
          changed = true;
      } else if (target.kind === "tag") {
        if (metaRemoveTagParent(target.tag, tag)) changed = true;
      } else if (target.kind === "album") {
        const current = metaGetUserTagsForAlbum(
          target.album,
          target.originPath || "",
        );
        if (
          current.includes(tag) &&
          metaSetUserTagsForAlbum(
            target.album,
            target.originPath || "",
            current.filter((value) => value !== tag),
          )
        )
          changed = true;
      } else if (target.kind === "gallery") {
        const current = metaGetUserTagsForGallery(target.gallery);
        if (
          current.includes(tag) &&
          metaSetUserTagsForGallery(
            target.gallery,
            current.filter((value) => value !== tag),
          )
        )
          changed = true;
      }
    } else if (item.kind === "album") {
      if (target.kind === "dir") {
        if (metaSetAlbumForPath(target.path, "")) changed = true;
      } else if (target.kind === "tag") {
        if (metaSetTagAlbumForTag(target.tag, "", target.originPath || ""))
          changed = true;
      } else if (target.kind === "gallery") {
        if (metaSetAlbumForGallery(target.gallery, "")) changed = true;
      }
    } else if (item.kind === "favorite" && target.kind === "dir") {
      const tags = metaGetTags(target.path);
      if (
        tags.includes(FAVORITE_TAG) &&
        metaSetTagsForPath(
          target.path,
          tags.filter((tag) => tag !== FAVORITE_TAG),
        )
      )
        changed = true;
    } else if (item.kind === "hidden") {
      if (target.kind === "dir") {
        const tags = metaGetTags(target.path);
        if (
          tags.includes(HIDDEN_TAG) &&
          metaSetTagsForPath(
            target.path,
            tags.filter((tag) => tag !== HIDDEN_TAG),
          )
        )
          changed = true;
      } else {
        const key = directHiddenKeyForLabelTarget(target);
        if (key && metaSetHiddenTagByKey(key, false)) changed = true;
      }
    }
  }
  if (!changed) return false;
  if (item.kind === "hidden") invalidateHiddenVisibilityState();
  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(`${String(item.label || "Removed label")}.`);
  return true;
}

// Each Remove tag row is marked with the icon of the place it leaves.
const LABEL_REMOVAL_ICON_KEYS = Object.freeze({
  tag: "tag",
  album: "album",
  gallery: "gallery",
  favorite: "favorite",
  hidden: "hidden",
});

function createLabelRemovalSubmenu(selectionTarget) {
  const targets = labelTargetsForSelectionTarget(selectionTarget);
  const common = commonLabelMembershipsForTargets(targets);
  if (!common) return null;
  const memberships = [];
  for (let i = 0; i < common.tags.length; i++) {
    const name = common.tags[i];
    memberships.push({
      kind: "tag",
      name,
      label: `Removed from tag "${tagDisplayName(name)}"`,
      // Inside "Remove tag" the row only needs the Tag's name.
      buttonLabel: tagDisplayName(name),
    });
  }
  if (common.album) {
    memberships.push({
      kind: "album",
      name: common.album,
      label: `Removed from album "${common.album}"`,
      buttonLabel: `Remove from album "${common.album}"`,
    });
  }
  for (let i = 0; i < common.galleries.length; i++) {
    const name = common.galleries[i];
    memberships.push({
      kind: "gallery",
      name,
      label: `Removed from gallery "${name}"`,
      buttonLabel: `Remove from gallery "${name}"`,
    });
  }
  // Favorite and Hidden are not listed: they are toggles under Folder options
  // / Tag options, switched off where they were switched on.
  if (!memberships.length) return null;
  const buttons = memberships.map((membership) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = membership.buttonLabel;
    withMenuItemIcon(button, () => LABEL_REMOVAL_ICON_KEYS[membership.kind] || "");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      allowMenuClose();
      closeActionMenus();
      const changed = removeLabelMembershipFromTargets(targets, membership);
      if (changed && selectionTarget.kind === "bulk")
        finalizeBulkSelectionAction();
    });
    return button;
  });
  return createDropdownMenuSubmenu(REMOVE_TAG_LABEL, buttons);
}

function metaApplyBulkGalleryDiff(targets, removeGalleries, addGalleries) {
  const remove = new Set(
    normalizeTagList(removeGalleries).map(normalizeGalleryName),
  );
  const add = normalizeTagList(addGalleries).map(normalizeGalleryName);
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!list.length || (!remove.size && !add.length)) return false;

  let changed = false;
  let changedCount = 0;
  for (let i = 0; i < list.length; i++) {
    const target = list[i] || {};
    const kind = String(target.kind || "");
    let targetChanged = false;
    if (kind === "dir") {
      const current = metaGetGalleriesForPath(target.path);
      const next = normalizeTagList(
        current.filter((gallery) => !remove.has(gallery)).concat(add),
      ).map(normalizeGalleryName);
      targetChanged = metaSetGalleriesForPath(target.path, next);
    } else if (kind === "tag") {
      const tag = normalizeTag(target.tag || "");
      const originPath = normalizeTagAlbumScopePath(target.originPath || "");
      if (!tag) continue;
      for (const gallery of remove) {
        const current = metaGetMemberTagTargetsForGallery(gallery);
        if (
          !current.some(
            (item) => item.tag === tag && item.originPath === originPath,
          )
        )
          continue;
        if (
          metaSetMemberTagTargetsForGallery(
            gallery,
            current.filter(
              (item) =>
                item.tag !== tag || item.originPath !== originPath,
            ),
          )
        )
          targetChanged = true;
      }
      for (let j = 0; j < add.length; j++) {
        const gallery = add[j];
        const current = metaGetMemberTagTargetsForGallery(gallery);
        if (
          !current.some(
            (item) => item.tag === tag && item.originPath === originPath,
          ) &&
          metaSetMemberTagTargetsForGallery(
            gallery,
            current.concat([{ tag, originPath }]),
          )
        )
          targetChanged = true;
      }
    } else if (kind === "album") {
      const album = normalizeTagAlbumName(target.album || "");
      const originPath = normalizeTagAlbumScopePath(target.originPath || "");
      if (!album) continue;
      for (const gallery of remove) {
        const current = metaGetMemberAlbumTargetsForGallery(gallery);
        if (
          !current.some(
            (item) => item.album === album && item.originPath === originPath,
          )
        )
          continue;
        if (
          metaSetMemberAlbumTargetsForGallery(
            gallery,
            current.filter(
              (item) =>
                item.album !== album || item.originPath !== originPath,
            ),
          )
        )
          targetChanged = true;
      }
      for (let j = 0; j < add.length; j++) {
        const gallery = add[j];
        const current = metaGetMemberAlbumTargetsForGallery(gallery);
        if (
          !current.some(
            (item) => item.album === album && item.originPath === originPath,
          ) &&
          metaSetMemberAlbumTargetsForGallery(
            gallery,
            current.concat([{ album, originPath }]),
          )
        )
          targetChanged = true;
      }
    }
    if (!targetChanged) continue;
    changed = true;
    changedCount++;
  }
  if (!changed) return false;

  metaScheduleSave();
  refreshAfterTagMetadataChange();
  showStatusMessage(
    `Updated galleries for ${changedCount} item${changedCount === 1 ? "" : "s"}.`,
  );
  return true;
}

// Apply a tag delta to many folders at once: strip `removeTags`, add `addTags`,
// leaving each folder's reserved tags and its own unique user tags intact.
function metaApplyBulkUserTagDiff(paths, removeTags, addTags) {
  const remove = new Set(normalizeTagList(removeTags));
  const add = normalizeTagList(addTags).filter((t) => !isReservedFolderTag(t));
  const list = Array.from(
    new Set((paths || []).map((p) => String(p || "")).filter(Boolean)),
  );
  if (!list.length || (!remove.size && !add.length)) return false;

  let changed = false;
  const refused = new Set();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    const existing = metaGetTags(p);
    const reserved = existing.filter((t) => isReservedFolderTag(t));
    const curUser = existing.filter((t) => !isReservedFolderTag(t));
    const nextUser = normalizeTagList(
      curUser
        .filter((t) => !remove.has(t))
        .concat(filterLockedTagsForPath(p, add, refused)),
    );
    const merged = normalizeTagList(reserved.concat(nextUser));
    const before = normalizeTagList(WS.meta.dirTags.get(p) || existing);
    if (before.length === merged.length && before.every((t, idx) => t === merged[idx]))
      continue;
    WS.meta.dirTags.set(p, merged);
    changed = true;
  }
  announceTagLockRefusals(refused);
  if (!changed) return false;

  metaMarkDirty(META_DOC_IDS.tags);
  invalidateDirMetricsCaches();
  TAG_EDIT_PATH = null;
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  metaScheduleSave();
  return true;
}

// "Name added to Favorites in Parent", or "N items added to Favorites in
// Parent" for several. Favorites is per folder, so the folder named is the one
// whose Favorites the items now appear in.
function announceFavoritesAdded(paths) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((path) => String(path || ""))
    .filter(Boolean);
  if (!list.length) return;
  const first = WS.dirByPath.get(list[0]) || null;
  const parent = first?.parent || WS.root || null;
  const parentName = parent ? dirDisplayName(parent) : "";
  const subject =
    list.length === 1
      ? first
        ? dirDisplayName(first)
        : list[0].split("/").pop()
      : `${list.length} items`;
  showStatusMessage(`${subject} added to Favorites in ${parentName}`);
}

function metaSetFavoriteBulk(paths, enable) {
  const list = Array.isArray(paths) ? paths : Array.from(paths || []);
  if (!list.length) return false;
  const target = !!enable;
  let changed = false;
  const added = [];
  for (let i = 0; i < list.length; i++) {
    const p = String(list[i] || "");
    if (!p) continue;
    const tags = metaGetTags(p);
    const has = tags.includes(FAVORITE_TAG);
    if (target === has) continue;
    const next = target
      ? [FAVORITE_TAG].concat(tags.filter((t) => t !== FAVORITE_TAG))
      : tags.filter((t) => t !== FAVORITE_TAG);
    WS.meta.dirTags.set(p, normalizeTagList(next));
    changed = true;
    if (target) added.push(p);
  }
  if (!changed) return false;
  const layout = capturePreviewGridLayout();
  metaMarkDirty(META_DOC_IDS.tags);
  invalidateDirMetricsCaches();
  syncFavoritesUi();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  settlePreviewGridLayout(layout);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  announceFavoritesAdded(added);
  return true;
}

function metaToggleHidden(path) {
  const p = String(path || "");
  if (!p) return;
  const tags = metaGetTags(p);
  const has = tags.includes(HIDDEN_TAG);
  const next = has
    ? tags.filter((t) => t !== HIDDEN_TAG)
    : [HIDDEN_TAG].concat(tags.filter((t) => t !== HIDDEN_TAG));
  WS.meta.dirTags.set(p, normalizeTagList(next));
  metaMarkDirty(META_DOC_IDS.tags);
  invalidateHiddenVisibilityState();
  syncHiddenUi();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function metaSetHiddenBulk(paths, enable) {
  const list = Array.isArray(paths) ? paths : Array.from(paths || []);
  if (!list.length) return;
  const target = !!enable;
  for (let i = 0; i < list.length; i++) {
    const p = String(list[i] || "");
    if (!p) continue;
    const tags = metaGetTags(p);
    const has = tags.includes(HIDDEN_TAG);
    if (target === has) continue;
    const next = target
      ? [HIDDEN_TAG].concat(tags.filter((t) => t !== HIDDEN_TAG))
      : tags.filter((t) => t !== HIDDEN_TAG);
    WS.meta.dirTags.set(p, normalizeTagList(next));
  }
  metaMarkDirty(META_DOC_IDS.tags);
  invalidateHiddenVisibilityState();
  syncHiddenUi();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

async function rebuildWorkspaceAfterStorageStateChange() {
  if (WS.meta.storageMode === "fs" && WS.meta.fsRootHandle) {
    await buildWorkspaceFromDirectoryHandle(WS.meta.fsRootHandle);
    return true;
  }
  if (Array.isArray(LAST_LOADED_FILE_LIST) && LAST_LOADED_FILE_LIST.length) {
    return await buildWorkspaceFromFileList(LAST_LOADED_FILE_LIST, {
      preserveView: true,
    });
  }
  showStatusMessage("Reload the current folder to apply storage changes.");
  return false;
}

async function setStorageStateForFolderPaths(paths, enable) {
  const list = collapseNestedFolderPaths(paths).filter(Boolean);
  if (!list.length) {
    showStatusMessage("No folders selected.");
    return false;
  }
  if (enable && list.some((path) => isPathInsideInternalTrash(path))) {
    showStatusMessage(
      "Items in Trash must be put back before they can be sent to Storage.",
    );
    return false;
  }
  let changedCount = 0;
  for (let i = 0; i < list.length; i++) {
    const path = normalizeDirPathValue(list[i]);
    if (!path) continue;
    const tags = metaGetTags(path);
    const has = tags.includes(STORAGE_TAG);
    if (!!enable === has) continue;
    const next = enable
      ? [STORAGE_TAG].concat(tags.filter((t) => t !== STORAGE_TAG))
      : tags.filter((t) => t !== STORAGE_TAG);
    if (metaSetTagsForPath(path, next)) changedCount++;
  }
  if (!changedCount) {
    showStatusMessage(
      enable ? "Selected folders are already in storage." : "Selected folders are not in storage.",
    );
    return true;
  }
  await persistDirtyMetadataNow();
  const rebuilt = await rebuildWorkspaceAfterStorageStateChange();
  if (!rebuilt) return false;
  if (navigateOutOfStorageIfHidden()) {
    renderDirectoriesPane(true);
    renderPreviewPane(true, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  }
  showStatusMessage(
    `${enable ? "Sent" : "Removed"} ${changedCount} folder${changedCount === 1 ? "" : "s"} ${enable ? "to" : "from"} storage.`,
  );
  return true;
}
