/* Tag context menu
   The (inert) Tag context menus and importing into a folder. */

function openTagContextMenu(context) {
  allowMenuClose();
  if (!context || !tagActionMenuEl) return;
  const tag = String(context.tag || "").trim();
  const album = normalizeTagAlbumName(context.album || "");
  const gallery = normalizeGalleryName(context.gallery || "");
  const tagKey = String(context.tagKey || "").trim();
  const paths = Array.isArray(context.paths) ? context.paths : [];
  const anchor = context.anchor;
  if (!tagKey || !anchor) return;
  const isAlbumEntry = !!album && !tag && !context.special;
  const isGalleryEntry = !!gallery && !tag && !album && !context.special;
  const canRename = !context.special && (!!tag || isAlbumEntry || isGalleryEntry);
  const canDelete =
    context.special === "favorites" ||
    (!context.special && (!!tag || isAlbumEntry || isGalleryEntry));
  const canTagAlbum = isAlbumEntry;
  const canHide = !context.special && (!!tag || isAlbumEntry || isGalleryEntry);
  const canCreateInverse = !!tag && !context.special && !isAlbumEntry;
  const currentAlbumContext = currentTagMenuAlbumRemovalContext();
  const canRemoveFromAlbum =
    !!tag &&
    !context.special &&
    !isAlbumEntry &&
    !!currentAlbumContext &&
    String(currentAlbumContext.originPath || "") ===
      String(context.originPath || "");
  const currentGalleryContext = currentTagMenuGalleryRemovalContext();
  const canRemoveFromGallery =
    !context.special &&
    !isGalleryEntry &&
    !!currentGalleryContext &&
    !!normalizeGalleryName(currentGalleryContext.gallery || "") &&
    !!(tag || isAlbumEntry);
  const preferPane =
    anchor && anchor.closest && anchor.closest("#previewBody")
      ? "preview"
      : "directories";
  const thumbMode = metaGetTagThumbnailModeByKey(tagKey);
  const tagEntryForThumb =
    context.entry && context.entry.kind === "tag"
      ? context.entry
      : {
          kind: "tag",
          tag: String(context.tag || ""),
          album: normalizeTagAlbumName(context.album || ""),
          gallery: normalizeGalleryName(context.gallery || ""),
          special: String(context.special || ""),
          label: String(context.label || context.tag || context.album || context.gallery || "Tag"),
          originPath: String(
            context.originPath || WS.nav?.dirNode?.path || "",
          ),
          placeholder: false,
        };
  const canAppearancePreset =
    !!tagKey && !context.special && (!!tag || isAlbumEntry || isGalleryEntry);
  const canMediaFilter =
    !!tagKey && !context.special && (!!tag || isAlbumEntry || isGalleryEntry);
  const isHidden = canHide && metaHasHiddenTagByKey(tagKey);
  const assignedAppearancePresetId = canAppearancePreset
    ? metaGetTagAppearancePresetIdByKey(tagKey)
    : "";
  const assignedMediaFilterValue = canMediaFilter
    ? metaGetTagMediaFilterByKey(tagKey)
    : [];
  const canSetRandomThumbnail = !!firstRecursiveThumbnailCandidateForTagEntry(
    tagEntryForThumb,
  );
  const tagThumbIsRotating = tagThumbnailUsesRotationByKey(tagKey);
  // When a container is supplied the entries are being hosted somewhere else
  // (the app menu's "Selected Item" section), so the standalone tag menu is
  // neither cleared nor opened -- only TAG_CONTEXT_MENU_STATE is set, which is
  // what handleTagMenuAction reads.
  const hostContainer = context.container || null;
  if (!hostContainer) {
    closeTagContextMenu();
    closeActionMenus();
  }
  const menu = hostContainer || tagActionMenuEl;
  const infoDropdown = createItemInfoDropdown({
    kind: "tag",
    entry: tagEntryForThumb,
  });
  if (infoDropdown) menu.appendChild(infoDropdown);
  const sortEntry = createContainerSortCycleButton({
    kind: "tag",
    entry: tagEntryForThumb,
  });
  if (tag && !context.special) {
    const addToTagRow = createSelectMenuAddToTagRow(
      createTagMenuButton("Tag", () => {
        closeTagContextMenu();
        startBulkTagInTag([tag], preferPane);
      }),
      { kind: "tag", entry: tagEntryForThumb },
    );
    if (addToTagRow) menu.appendChild(addToTagRow);
  }
  // A real Tag gathers its own settings under "Tag options": Rename first,
  // then its switches; its Overrides are added once they are built below.
  // Anything else keeps Rename at the top level.
  const useTagOptions = !!(tag && !context.special);
  const tagOptionsItems = [];
  if (canRename) {
    // The naming field takes the keyboard, so the menu closes first rather
    // than sit over it.
    const renameButton = createTagMenuButton("Rename", () => {
      allowMenuClose();
      closeAppMenu();
      handleTagMenuAction("rename");
    });
    if (useTagOptions) tagOptionsItems.push(renameButton);
    else menu.appendChild(renameButton);
  }
  if (tag && !context.special) {
    const exclusiveButton = createTagMenuButton(
      `${tagIsExclusive(tag) ? "●" : "○"} Exclusive`,
      () => handleTagMenuAction("toggle-exclusive"),
    );
    exclusiveButton.setAttribute("data-action", "toggle-exclusive");
    tagOptionsItems.push(exclusiveButton);
    // Only for a Tag whose content is Sets of one Model (or that has it on).
    if (tagCanBeModelOnly(tag)) {
      tagOptionsItems.push(
        createSelectMenuToggleButton("Model only", tagIsModelOnly(tag), () =>
          handleTagMenuAction("toggle-model-only"),
        ),
      );
    }
  }
  if (canHide) {
    tagOptionsItems.push(
      createSelectMenuToggleButton("Hidden", isHidden, () =>
        handleTagMenuAction("hidden"),
      ),
    );
  }
  if (canCreateInverse) {
    const inverseButton = createTagMenuButton("Create inverse", () =>
      handleTagMenuAction("create-inverse"),
    );
    inverseButton.setAttribute("data-action", "create-inverse");
    tagOptionsItems.push(inverseButton);
  }
  const tagOptionsSlot = document.createElement("div");
  if (useTagOptions) menu.appendChild(tagOptionsSlot);
  if (canRemoveFromGallery) {
    menu.appendChild(
      createTagMenuButton("Remove from gallery", () =>
        handleTagMenuAction("remove-from-gallery"),
      ),
    );
  }
  let filtersEntry = null;
  if (canAppearancePreset) {
    const scopeLabel = isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag";
    filtersEntry = createAppearancePresetCycleButton({
      currentPresetId: assignedAppearancePresetId,
      hasOverride: !!assignedAppearancePresetId,
      onChoosePreset: (presetId) => {
        if (!metaSetTagAppearancePresetIdByKey(tagKey, presetId)) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage(
          `${scopeLabel} media preset: ${appearancePresetDisplayName(presetId)}.`,
        );
      },
      onClear: () => {
        if (!metaClearTagAppearancePresetByKey(tagKey)) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage(`${scopeLabel} media preset reset.`);
      },
    });
  }
  let mediaTypeEntry = null;
  if (canMediaFilter) {
    const scopeLabel = isGalleryEntry ? "Gallery" : isAlbumEntry ? "Tag album" : "Tag";
    const applyTagMediaFilter = (axisLabel, nextValue, onlyType) => {
      const changed = metaSetTagMediaFilterByKey(tagKey, nextValue);
      if (changed) {
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        const onlyText = onlyType
          ? `${tagMediaFilterTypeLabel(onlyType)} only`
          : "all";
        showStatusMessage(`${scopeLabel} ${axisLabel} filter: ${onlyText}.`);
      }
    };
    mediaTypeEntry = createTagMediaFilterAxisCycleButton({
      label: "Media type",
      axis: TAG_MEDIA_FILTER_MEDIA_TYPES,
      allLabel: "All",
      currentValue: assignedMediaFilterValue,
      onApply: (nextValue, onlyType) =>
        applyTagMediaFilter("media type", nextValue, onlyType),
    });
  }
  const scoreEntries =
    tag && !context.special ? scoreFilterOverrideButtonsForTags([tag]) : [];
  const overridesSubmenu = createDropdownMenuSubmenu(
    "Overrides",
    [sortEntry, filtersEntry, mediaTypeEntry, ...scoreEntries].filter(Boolean),
  );
  if (useTagOptions) {
    const tagOptionsSubmenu = createDropdownMenuSubmenu(
      "Tag options",
      tagOptionsItems.concat(overridesSubmenu ? [overridesSubmenu] : []),
    );
    if (tagOptionsSubmenu) tagOptionsSlot.replaceWith(tagOptionsSubmenu);
    else tagOptionsSlot.remove();
  } else if (overridesSubmenu) {
    menu.appendChild(overridesSubmenu);
  }
  if (tagKey) {
    const tagThumbnailButtons = [];
    const hasTagThumbPreset = metaHasTagThumbnailPresetByKey(tagKey);
    const tagThumbDefault = defaultRotatingThumbnailMode();
    if (hasTagThumbPreset || thumbMode !== tagThumbDefault) {
      tagThumbnailButtons.push(
        createTagMenuButton("Default", () =>
          handleTagMenuAction("thumbnail-default"),
        ),
      );
    }
    if (canSetRandomThumbnail) {
      tagThumbnailButtons.push(
        createTagMenuButton("Random", () =>
          handleTagMenuAction("thumbnail-random"),
        ),
      );
    }
    if (!tagThumbIsRotating) {
      tagThumbnailButtons.push(
        createTagMenuButton("Shuffle", () =>
          handleTagMenuAction("thumbnail-rotate"),
        ),
      );
    }
    if (thumbMode !== "none") {
      tagThumbnailButtons.push(
        createTagMenuButton("Blank", () =>
          handleTagMenuAction("thumbnail-none"),
        ),
      );
    }
    // Same shape as a folder's: every place above it, each taking the picture
    // the Tag is showing, then the Tag's own settings under one tab at the
    // bottom.
    const aboveTargets = currentThumbnailRecordForTagEntry(tagEntryForThumb)
      ? thumbnailMenuTargetsForTagEntry(tagEntryForThumb, tagKey)
      : [];
    const aboveButtons = thumbnailMenuTargetItems(aboveTargets, (label, action) => {
      const btn = createTagMenuButton(label, () => handleTagMenuAction(action));
      btn.setAttribute("data-action", action);
      return btn;
    });
    const tagThumbnailSubmenu = createDropdownMenuSubmenu("Thumbnail", [
      ...aboveButtons,
      createDropdownMenuSubmenu(
        context.special ? "This folder" : "This tag",
        tagThumbnailButtons,
      ),
    ]);
    if (tagThumbnailSubmenu) menu.appendChild(tagThumbnailSubmenu);
  }
  // Bespoke red "Delete" as the last action. It confirms through the app-menu
  // "Are You Sure?" page (see handleTagMenuAction's "delete" case).
  if (canDelete) {
    menu.appendChild(
      createTagMenuButton(
        "Delete",
        () => handleTagMenuAction("delete"),
        false,
        "destructiveAction",
      ),
    );
  }
  TAG_CONTEXT_MENU_STATE = {
    tag,
    album,
    gallery,
    isAlbumEntry,
    isGalleryEntry,
    special: String(context.special || ""),
    entry: tagEntryForThumb,
    tagKey,
    anchor,
    label: context.label || tag || album || gallery,
    paths: paths.slice(),
    originPath: String(context.originPath || ""),
    canRename,
    canDelete,
    canTagAlbum,
    canHide,
    canCreateInverse,
    canRemoveFromAlbum,
    canRemoveFromGallery,
    isHidden,
    canAppearancePreset,
    canMediaFilter,
  };
  if (hostContainer) return;
  requestAnimationFrame(() => {
    menu.classList.add("open");
    positionDropdownMenu(anchor, menu);
  });
}

function openTagEntryContextMenu(entry, anchor) {
  if (separateItemMenuDisabled()) return false;
  if (!entry || entry.kind !== "tag" || !anchor) return false;
  if (entry.placeholder) return false;
  const selectionKey = tagEntrySelectionKey(entry);
  const previewTagBulkKeys = selectionKey
    ? getPreviewTagMenuSelectionKeys(selectionKey)
    : [];
  const anchorInPreview = !!(
    previewBodyEl &&
    previewBodyEl.contains &&
    previewBodyEl.contains(anchor)
  );
  if (anchorInPreview && shouldUsePreviewBulkTagMenu(selectionKey)) {
    const selectedEntries = getSelectedTagEntriesInCurrentView();
    if (selectedEntries.length) {
      openPreviewBulkTagActionMenu(selectedEntries, selectionKey, { anchor });
      return true;
    }
  }
  if (selectionKey && openBulkActionMenuForSelection(`tag:${selectionKey}`))
    return true;
  const dirs = getUnfilteredMembershipDirsForTagEntry(entry);
  const paths = gatherTagPathsForDirs(dirs);
  const tagKey = tagThumbnailKeyForEntry(entry);
  openTagContextMenu({
    entry,
    tag: String(entry.tag || ""),
    album: String(entry.album || ""),
    gallery: String(entry.gallery || ""),
    tagKey,
    special: entry.special || "",
    label: String(entry.label || entry.tag || entry.album || entry.gallery || ""),
    anchor,
    paths,
    originPath: String(entry.originPath || ""),
  });
  return true;
}

// The standalone background context menu was folded into the app menu (its Add
// folders/files and Reverse file order live in the "Add items" submenu and
// under Miscellaneous). Right-click opens nothing now -- the app menu is reached
// only through its bindable key.

// "Add content" imports external files into the folder the PREVIEW pane is
// showing (the location the user is looking at), so only real on-disk folders
// qualify — not tag/virtual portal views and not the internal trash.
function importableDirectoryForNode(dirNode) {
  if (!dirNode || !WS.meta || !WS.meta.fsRootHandle) return null;
  if (dirNode._skipTagFilters || String(dirNode._tagPreviewMode || "")) {
    return null;
  }
  if (dirNode === WS.root) return dirNode;
  const path = String(dirNode.path || "");
  if (!path) return null;
  if (isPathInsideInternalTrash(path) || isInternalTrashPath(path)) return null;
  return WS.dirByPath.get(path) || null;
}

function resolveAbsoluteImportDirectoryPath(dirNode) {
  const rel = String(dirNode?.path || "");
  const resolved = resolveAbsoluteDirectoryPath(rel);
  if (resolved) return resolved;
  const root = String(window.__lg?.rootPath || "").replace(/\/+$/, "");
  if (!root) return "";
  return rel ? `${root}/${rel}` : root;
}

async function addContentToDirectoryViaPicker(dirNode, pickKind = "files") {
  const invoke =
    window.__TAURI__ &&
    window.__TAURI__.core &&
    typeof window.__TAURI__.core.invoke === "function"
      ? window.__TAURI__.core.invoke
      : null;
  if (!invoke) {
    showStatusMessage("Adding content requires the desktop app.");
    return false;
  }
  const destAbs = resolveAbsoluteImportDirectoryPath(dirNode);
  if (!destAbs) {
    showStatusMessage("Could not resolve the destination folder.");
    return false;
  }
  // Native dialogs can't offer files and folders in a single panel, so the
  // background menu exposes one entry per picker kind.
  const pickCommand =
    pickKind === "folders" ? "pick_import_folders" : "pick_import_files";
  let picked = [];
  try {
    picked = (await invoke(pickCommand)) || [];
  } catch {
    picked = [];
  }
  if (!picked.length) return false;
  const folderLabel =
    dirNode === WS.root ? "the root folder" : `'${displayName(dirNode.name)}'`;
  showBusyOverlay(
    `Adding ${picked.length} item${picked.length === 1 ? "" : "s"}...`,
  );
  let imported = [];
  try {
    imported = await invoke("import_files", {
      paths: picked,
      destDir: destAbs,
    });
  } catch {
    hideBusyOverlay();
    showStatusMessage("Add content failed.");
    return false;
  }
  try {
    await refreshWorkspaceFromRootHandle();
  } catch {
  } finally {
    hideBusyOverlay();
  }
  const count = Array.isArray(imported) ? imported.length : 0;
  showStatusMessage(
    `Added ${count} item${count === 1 ? "" : "s"} to ${folderLabel}.`,
  );
  return count > 0;
}
