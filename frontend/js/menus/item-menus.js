/* Item menus
   File and folder action menus and running their actions. */

// Container-based twin of buildFolderActionMenuDom: appends a single file's
// item-menu entries to menuEl and routes every activation through onAction.
// Shared by the preview context menu and the app menu's "Selected Item" section.
function buildFileActionMenuDom(menuEl, rec, onAction) {
  if (!menuEl || !rec || typeof onAction !== "function") return;
  const makeBtn = (label, action, disabled = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(label || "");
    btn.disabled = !!disabled;
    btn.setAttribute("data-action", String(action || ""));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      onAction(String(action || ""));
    });
    return btn;
  };

  const infoDropdown = createItemInfoDropdown({ kind: "file", record: rec });
  if (infoDropdown) menuEl.appendChild(infoDropdown);

  const trashTargetPath = trashTopLevelItemPathForFileRecord(rec);
  if (trashTargetPath) {
    menuEl.appendChild(
      makeBtn("Remove from Trash", "put-back", !WS.meta.fsRootHandle),
    );
    return;
  }
  // The file's Set, then its Model, then a Tags tab (thumbnailMenuTargetItems).
  const thumbnailButtons = thumbnailMenuTargetItems(
    getThumbnailMenuTargetsForRecord(rec),
    (label, targetAction) => makeBtn(label, targetAction),
  );
  // "Edit thumbnail" (the removed mouse crop editor) is intentionally omitted;
  // keyboard Cmd+arrow editing replaces it.
  const thumbnailSubmenu = createDropdownMenuSubmenu(
    "Thumbnail",
    thumbnailButtons,
  );
  if (thumbnailSubmenu) menuEl.appendChild(thumbnailSubmenu);
  menuEl.appendChild(makeBtn("Rename", "rename-file", !WS.meta.fsRootHandle));
}

function openPreviewFileActionMenu(rec, opts = {}) {
  if (separateItemMenuDisabled() && !opts.container) return;
  if (!previewActionMenuEl || !rec) return;
  if (fileRecordHasNoItemMenu(rec)) return;
  const fileId = String(rec.id || "");
  if (shouldUsePreviewBulkFileMenu(fileId)) {
    openPreviewBulkFileActionMenu(
      getPreviewFileMenuSelectionIds(fileId),
      fileId,
      opts,
    );
    return;
  }
  const selectedIds = getPreviewFileMenuSelectionIds(fileId);
  if (selectedIds.length > 1) {
    openPreviewBulkFileActionMenu(selectedIds, fileId, opts);
    return;
  }
  const hostContainer = opts.container || null;
  if (!hostContainer) closeActionMenus();

  const menu = hostContainer || previewActionMenuEl;
  buildFileActionMenuDom(menu, rec, (action) => {
    if (!hostContainer) closePreviewContextMenu();
    return runFileActionFromMenu(action, fileId);
  });
  if (!hostContainer) PREVIEW_CONTEXT_MENU_STATE = { fileId };

  if (hostContainer) return;
  requestAnimationFrame(() => {
    menu.classList.add("open");
    if (opts.anchor) positionDropdownMenu(opts.anchor, menu);
    else
      positionDropdownMenuAtPoint(
        menu,
        Number(opts.x) || 0,
        Number(opts.y) || 0,
      );
  });
}

function folderNodeHasNoItemMenu(dirNode) {
  if (!dirNode) return false;
  return !!dirNode.isMissingPlaceholder;
}
function fileRecordHasNoItemMenu(rec) {
  return !!rec?.isMissingPlaceholder;
}

function buildFolderMenuState(dirNode) {
  const p = String(dirNode?.path || "");
  const isRootNode = !!dirNode && dirNode === WS.root;
  const isTrashRootPortal = isTrashRootPortalNode(dirNode);
  const isTrashItem = !isTrashRootPortal && isPathInsideInternalTrash(p);
  const isStorageGhost = isStorageStubDirNode(dirNode) || (!!p && metaHasStorage(p));
  const isTrashPutBackOnly = isTrashItem && !!trashTopLevelItemPathForPath(p);
  const isFavorite = !isStorageGhost && metaHasFavorite(p);
  const isHidden = !isStorageGhost && metaHasHidden(p);
  const assignedAppearancePresetId =
    isRootNode || isStorageGhost
      ? effectiveActiveAppearancePresetId()
      : metaGetFolderAppearancePresetId(p);
  const canRename = !!WS.meta.fsRootHandle && !isStorageGhost;
  const canIndex =
    !!WS.meta.fsRootHandle &&
    !isStorageGhost &&
    !isTrashRootPortal &&
    dirTreeHasIndexableOrderMismatch(dirNode);
  // Offered only when it would change something: an order reversed and
  // reversed back is a kept order that already matches the names.
  const canResetOrder =
    !!dirNode?.preserveOrder &&
    !isStorageGhost &&
    dirFileOrderDiffersFromIndexedNameOrder(dirNode);
  const currentTagRemovalContext =
    !isStorageGhost && !isRootNode ? currentFolderMenuTagRemovalContext() : null;
  const currentAlbumRemovalContext =
    !isStorageGhost && !isRootNode ? currentFolderMenuAlbumRemovalContext() : null;
  const currentGalleryRemovalContext =
    !isStorageGhost && !isRootNode ? currentFolderMenuGalleryRemovalContext() : null;
  const folderThumbMode = isRootNode
    ? getRootThumbnailMode()
    : metaGetFolderThumbnailMode(p);
  const canToggleFolderThumbMode =
    !isStorageGhost && !!dirNode && (isRootNode || !!p);
  const hasPreset = isRootNode
    ? rootThumbnailHasPreset()
    : metaHasFolderThumbnailPreset(p);
  const folderThumbIsRotating = isRootNode
    ? tagThumbnailUsesRotationByKey(rootThumbnailKey())
    : folderThumbMode === "rotate";
  const hasRandomCandidate =
    !isStorageGhost && !!firstRecursiveThumbnailCandidateForDirNode(dirNode);
  return {
    dirNode,
    path: p,
    isRootNode,
    isTrashRootPortal,
    isTrashItem,
    isTrashPutBackOnly,
    isStorageGhost,
    isStorageRestricted: isStorageGhost && !isRootNode,
    isFavorite,
    isHidden,
    assignedAppearancePresetId,
    canRename,
    canIndex,
    canResetOrder,
    currentTagRemovalContext,
    currentAlbumRemovalContext,
    currentGalleryRemovalContext,
    canRemoveFromAlbum:
      !!currentAlbumRemovalContext &&
      normalizeTagAlbumName(currentAlbumRemovalContext.album || "") ===
        metaGetAlbumForPath(p),
    canRemoveFromGallery:
      !!currentGalleryRemovalContext &&
      metaGetGalleriesForPath(p).includes(
        normalizeGalleryName(currentGalleryRemovalContext.gallery || ""),
      ),
    showUseDefaultThumbnail:
      !isStorageGhost &&
      (hasPreset ||
        (isRootNode && !isRootThumbnailModeDefault(folderThumbMode)) ||
        (!isRootNode &&
          canToggleFolderThumbMode &&
          folderThumbMode !== inferFolderThumbnailDefaultMode(p))),
    showSetRotateThumbnail:
      !isStorageGhost && canToggleFolderThumbMode && !folderThumbIsRotating,
    showSetNoThumbnail:
      !isStorageGhost && canToggleFolderThumbMode && folderThumbMode !== "none",
    showSetRandomThumbnail: !isStorageGhost && canToggleFolderThumbMode && hasRandomCandidate,
    canMoveToTrash:
      !isTrashRootPortal && isFolderPathMovableToTrash(p),
    canPutBack:
      isTrashItem &&
      !!WS.meta.fsRootHandle &&
      !!trashTopLevelItemPathForPath(p) &&
      canPutBackTrashPath(trashTopLevelItemPathForPath(p)),
    canSendToStorage:
      !!p &&
      !isRootNode &&
      !isTrashRootPortal &&
      !isTrashPutBackOnly &&
      !isPathInsideInternalTrash(p) &&
      !isStorageGhost,
    canRemoveFromStorage:
      !!p && isStorageGhost && !isPathInsideInternalTrash(p),
  };
}

function buildFolderActionMenuDom(
  menuEl,
  state,
  onAction,
  customHandlers = null,
) {
  if (!menuEl || !state || typeof onAction !== "function") return;
  const makeBtn = (label, action, disabled = false, className = "") => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(label || "");
    btn.disabled = !!disabled;
    if (className) btn.className = String(className);
    btn.setAttribute("data-action", String(action || ""));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const handler =
        customHandlers && typeof customHandlers[action] === "function"
          ? customHandlers[action]
          : null;
      if (handler) {
        handler(e);
        return;
      }
      onAction(String(action || ""));
    });
    return btn;
  };
  // "Filters" is a preset cycle. The caller supplies the contextual persistence
  // callbacks; older unhosted surfaces can still fall back to their action path.
  const makeFiltersEntry = () => {
    // The cycle button returns null while the appearance system is off; the
    // legacy action fallback must not step in and re-add the row.
    if (!APPEARANCE_FILTERS_ENABLED) return null;
    if (
      customHandlers &&
      typeof customHandlers.appearancePresetCycleButton === "function"
    ) {
      const button = customHandlers.appearancePresetCycleButton();
      if (button) return button;
    }
    return makeBtn("Filters", "appearance-preset-set");
  };
  if (state.isTrashRootPortal) {
    menuEl.appendChild(
      makeBtn(
        "Empty Trash",
        "empty-trash",
        !WS.meta.fsRootHandle || !internalTrashHasItems(),
        "destructiveAction",
      ),
    );
    return;
  }
  const infoDropdown = createItemInfoDropdown({
    kind: "dir",
    node: state.dirNode,
  });
  if (infoDropdown) menuEl.appendChild(infoDropdown);
  const sortEntry = createContainerSortCycleButton({
    kind: "dir",
    node: state.dirNode,
  });
  const mediaTypeEntry =
    state.isStorageRestricted || state.isTrashItem
      ? null
      : createFolderMediaFilterCycleButton(state.dirNode);
  const filtersEntry =
    state.isStorageRestricted || state.isTrashItem ? null : makeFiltersEntry();
  const scoreEntries =
    state.isStorageRestricted || state.isTrashItem
      ? []
      : scoreFilterOverrideButtonsForFolders([state.path]);
  const overridesSubmenu = createDropdownMenuSubmenu(
    "Overrides",
    [sortEntry, filtersEntry, mediaTypeEntry, ...scoreEntries].filter(Boolean),
  );
  const thumbnailButtons = [];
  if (state.showUseDefaultThumbnail)
    thumbnailButtons.push(makeBtn("Default", "thumbnail-default"));
  if (state.showSetRandomThumbnail)
    thumbnailButtons.push(makeBtn("Random", "thumbnail-random"));
  if (state.showSetRotateThumbnail)
    thumbnailButtons.push(makeBtn("Shuffle", "thumbnail-rotate"));
  if (state.showSetNoThumbnail)
    thumbnailButtons.push(makeBtn("Blank", "thumbnail-none"));
  // Every place above the folder first, each taking the picture this folder
  // is showing, and the folder's own settings at the bottom. The root is never
  // seen from outside, so it has no thumbnail and no Thumbnail submenu.
  const aboveTargets = currentThumbnailRecordForDirNode(state.dirNode)
    ? thumbnailMenuTargetsForDirNode(state.dirNode)
    : [];
  const thumbnailSubmenu = state.isRootNode
    ? null
    : createDropdownMenuSubmenu("Thumbnail", [
        ...thumbnailMenuTargetItems(aboveTargets, (label, action) =>
          makeBtn(label, action),
        ),
        createDropdownMenuSubmenu("This folder", thumbnailButtons),
      ]);
  if (state.isRootNode) {
    if (overridesSubmenu) menuEl.appendChild(overridesSubmenu);
    if (state.canIndex) menuEl.appendChild(makeBtn("Index", "index"));
    return;
  }

  const restricted = state.isStorageRestricted || state.isTrashItem;
  const addToTagRow = createSelectMenuAddToTagRow(
    makeBtn("Tag", "tag", restricted),
    { kind: "dir", node: state.dirNode },
  );
  if (addToTagRow) menuEl.appendChild(addToTagRow);
  const folderOptionsSubmenu = createFolderOptionsSubmenu(
    [state.path],
    restricted,
    {
      before: [
        makeBtn("Rename", "rename", !state.canRename),
        createCopyFolderPathButton(state.dirNode),
        createCopyFolderButton(state.dirNode),
      ],
      after: [overridesSubmenu, thumbnailSubmenu],
    },
  );
  if (folderOptionsSubmenu) menuEl.appendChild(folderOptionsSubmenu);
  if (!state.canRemoveFromStorage)
    menuEl.appendChild(
      makeBtn("Send to storage", "send-to-storage", !state.canSendToStorage),
    );
  if (state.canRemoveFromAlbum)
    menuEl.appendChild(makeBtn("Remove from album", "remove-from-album"));
  if (state.canRemoveFromGallery)
    menuEl.appendChild(makeBtn("Remove from gallery", "remove-from-gallery"));
  if (state.canIndex) menuEl.appendChild(makeBtn("Index", "index"));
  if (state.canResetOrder)
    menuEl.appendChild(makeBtn("Reset order", "reset-order"));
}

function waitForNextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function runFolderActionFromMenu(action, dirNode, options = {}) {
  const node = dirNode || null;
  const p = String(node?.path || "");
  const isRootNode = !!node && node === WS.root;
  const isStorageRestricted = isStorageStubDirNode(node) || (!!p && metaHasStorage(p));
  if (!node || (!p && !isRootNode) || !action) return false;
  if (String(action).startsWith("container-sort:")) {
    const rawMode = String(action).slice("container-sort:".length);
    applyContainerSortSelection(
      { kind: "dir", node },
      rawMode === "none" ? "" : rawMode,
    );
    return true;
  }
  if (String(action).startsWith("folder-media-type:")) {
    const rawType = String(action).slice("folder-media-type:".length);
    applyFolderMediaFilterSelection(node, rawType === "all" ? "" : rawType);
    return true;
  }
  if (action === "empty-trash") {
    if (!isTrashRootPortalNode(node)) return true;
    await emptyInternalTrashPermanently();
    return true;
  }
  if (
    isStorageRestricted &&
    action !== "remove-from-storage" &&
    !(action === "put-back" && isPathInsideInternalTrash(p))
  ) {
    return true;
  }
  if (action === "send-to-storage") {
    if (isRootNode || !p) return true;
    const name = node.name || "this folder";
    if (!(await showAppMenuConfirm(`Put '${name}' in storage? It stays where it is, but it can't be opened and nothing in it loads until you take it out.`, { danger: false })))
      return true;
    await setStorageStateForFolderPaths([p], true);
    return true;
  }
  if (action === "remove-from-storage") {
    if (isRootNode || !p) return true;
    await setStorageStateForFolderPaths([p], false);
    return true;
  }
  if (action === "move-to-trash") {
    if (isRootNode || !isFolderPathMovableToTrash(p)) return true;
    const name = node.name || "this folder";
    if (!(await showAppMenuConfirm(`Move '${name}' to Trash?`, { danger: true })))
      return true;
    await moveFolderPathsToTrash([p]);
    return true;
  }
  if (action === "put-back") {
    const trashTargetPath = trashTopLevelItemPathForPath(p);
    if (!trashTargetPath) return true;
    await putBackTrashFolderPaths([trashTargetPath]);
    return true;
  }
  if (action === "tag") {
    TAG_EDIT_PATH = p;
    TAG_EDIT_IN_PREVIEW = false;
    RENAME_EDIT_PATH = null;
    selectDirectoryEntryByPath(p);
    renderDirectoriesPane(true);
    focusSelectedDirectoryInlineInput(".tagEditInput");
    return true;
  }
  if (action === "album") {
    if (isRootNode || !p) return true;
    // Pick the pane the way startAlbumSelectionEdit and the bulk album action
    // already do. Defaulting to the file pane put the naming placeholder in a
    // list the user was not looking at (and, with the preview one level below
    // the file pane, could not be looking at) while yanking the file-pane
    // selection to index 0 -- so a single folder looked like it did nothing.
    const fromPreview =
      !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
    startBulkFolderAlbuming([p], fromPreview ? "preview" : "directories");
    return true;
  }
  if (action === "gallery") {
    if (isRootNode || !p) return true;
    const fromPreview =
      !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
    startBulkGallerying([p], fromPreview ? "preview" : "directories");
    return true;
  }
  if (action === "remove-from-tag") {
    const tagContext = currentFolderMenuTagRemovalContext();
    if (!tagContext || !p) return true;
    const result = removeUserTagFromPathsBulk([p], tagContext.tag);
    if (!result.changed) {
      showStatusMessage("No folders updated.");
      return true;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `Removed folder from tag '${displayTagFolderLabel(tagContext.tag)}'.`,
    );
    return true;
  }
  if (action === "remove-from-album") {
    const albumContext = currentFolderMenuAlbumRemovalContext();
    if (!albumContext || !p) return true;
    if (!metaSetAlbumForPath(p, "")) {
      showStatusMessage("No folders updated.");
      return true;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `Removed folder from album '${displayTagFolderLabel(albumContext.album)}'.`,
    );
    return true;
  }
  if (action === "remove-from-gallery") {
    const galleryContext = currentFolderMenuGalleryRemovalContext();
    if (!galleryContext || !p) return true;
    const gallery = normalizeGalleryName(galleryContext.gallery || "");
    const next = metaGetGalleriesForPath(p).filter((item) => item !== gallery);
    if (!metaSetGalleriesForPath(p, next)) {
      showStatusMessage("No folders updated.");
      return true;
    }
    metaScheduleSave();
    refreshAfterTagMetadataChange();
    showStatusMessage(
      `Removed folder from gallery '${displayTagFolderLabel(gallery)}'.`,
    );
    return true;
  }
  if (action === "rename") {
    if (!WS.meta.fsRootHandle) {
      showStatusMessage("Rename requires a writable folder.");
      return true;
    }
    RENAME_EDIT_PATH = p;
    TAG_EDIT_PATH = null;
    selectDirectoryEntryByPath(p);
    renderDirectoriesPane(true);
    focusSelectedDirectoryInlineInput(".renameEditInput");
    return true;
  }
  if (action === "reset-order") {
    resetDirFileOrder(node, {
      silent: node !== WS.nav.dirNode,
      selectId: null,
    });
    showStatusMessage(`Files in ${dirDisplayName(node)} back in name order.`);
    return true;
  }
  if (action === "index") {
    await indexFolderFilesRecursively(node);
    // The menu rebuilt itself the moment the option was pressed, before the
    // renaming finished; rebuild again so Index and Reset order go away.
    refreshOpenAppMenuInPlace();
    return true;
  }
  if (action === "favorite") {
    metaToggleFavorite(p);
    return true;
  }
  if (action === "hidden") {
    metaToggleHidden(p);
    return true;
  }
  if (action === "appearance-preset-clear") {
    if (isRootNode) return true;
    if (!metaClearFolderAppearancePreset(p)) return true;
    refreshAfterProcessingMetadataChange();
    showStatusMessage("Folder media preset reset to inherited.");
    return true;
  }
  if (action === "thumbnail-default") {
    const changed = isRootNode
      ? resetRootThumbnailToDefault()
      : metaClearFolderThumbnailPreset(p);
    if (changed) {
      refreshThumbnailUiAfterMetadataChange();
      showStatusMessage(
        isRootNode
          ? "Root thumbnail reset to default."
          : "Folder thumbnail reset to default.",
      );
    }
    return true;
  }
  if (action === "thumbnail-none") {
    const changed = isRootNode
      ? setRootThumbnailMode("none")
      : metaSetFolderThumbnailNone(p);
    if (changed) {
      refreshThumbnailUiAfterMetadataChange();
      showStatusMessage(
        isRootNode ? "Root thumbnail blanked." : "Folder thumbnail blanked.",
      );
    }
    return true;
  }
  if (action === "thumbnail-rotate") {
    const changed = isRootNode
      ? metaSetTagThumbnailRotateByKey(rootThumbnailKey())
      : metaSetFolderThumbnailRotate(p);
    if (changed) {
      refreshThumbnailUiAfterMetadataChange();
      showStatusMessage(
        isRootNode
          ? "Root thumbnail set to shuffle."
          : "Folder thumbnail set to shuffle.",
      );
    }
    return true;
  }
  if (action === "thumbnail-random") {
    setRandomFolderThumbnailForNode(node);
    return true;
  }
  if (
    applyContainerThumbnailToTarget(
      action,
      currentThumbnailRecordForDirNode(node),
    )
  ) {
    return true;
  }
  if (action === "score-up") {
    metaBumpScore(p, 1);
    return true;
  }
  if (action === "score-down") {
    metaBumpScore(p, -1);
    return true;
  }
  return false;
}

function getPreviewFolderMenuSelectionPaths(anchorPath) {
  const p = String(anchorPath || "");
  if (!p) return [];
  const selected = getSelectedPathsInCurrentDir();
  const canUseSelection =
    WS.view.bulkSelectMode && selected.length && selected.includes(p);
  if (!canUseSelection) return [p];
  const unique = Array.from(
    new Set(selected.map((v) => String(v || "")).filter(Boolean)),
  );
  return unique.length ? unique : [p];
}

function shouldUsePreviewBulkFolderMenu(anchorPath) {
  const selectedPaths = getPreviewFolderMenuSelectionPaths(anchorPath);
  return !!(
    WS.view.bulkSelectMode &&
    selectedPaths.length > 1 &&
    selectedPaths.includes(String(anchorPath || ""))
  );
}

function getPreviewFileMenuSelectionIds(anchorFileId) {
  const id = String(anchorFileId || "");
  if (!id) return [];
  const selected = getSelectedFileIdsInCurrentView();
  const canUseSelection =
    WS.view.bulkSelectMode && selected.length && selected.includes(id);
  if (!canUseSelection) return [id];
  const unique = Array.from(
    new Set(selected.map((v) => String(v || "")).filter(Boolean)),
  );
  return unique.length ? unique : [id];
}

function shouldUsePreviewBulkFileMenu(anchorFileId) {
  const selectedIds = getPreviewFileMenuSelectionIds(anchorFileId);
  return !!(
    WS.view.bulkSelectMode &&
    selectedIds.length > 1 &&
    selectedIds.includes(String(anchorFileId || ""))
  );
}

function getPreviewTagMenuSelectionKeys(anchorSelectionKey) {
  const key = String(anchorSelectionKey || "");
  if (!key) return [];
  const selected = getSelectedTagFolderKeysInCurrentView();
  const canUseSelection =
    WS.view.bulkSelectMode && selected.length && selected.includes(key);
  if (!canUseSelection) return [key];
  const unique = Array.from(
    new Set(selected.map((v) => String(v || "")).filter(Boolean)),
  );
  return unique.length ? unique : [key];
}

function shouldUsePreviewBulkTagMenu(anchorSelectionKey) {
  const selectedKeys = getPreviewTagMenuSelectionKeys(anchorSelectionKey);
  return !!(
    WS.view.bulkSelectMode &&
    selectedKeys.length > 1 &&
    selectedKeys.includes(String(anchorSelectionKey || ""))
  );
}
