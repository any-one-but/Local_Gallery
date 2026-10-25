/* Bulk menus
   Menus for several selected folders, files or Tags. */

function openPreviewBulkFolderActionMenu(paths, anchorPath, opts = {}) {
  if (!previewActionMenuEl) return;
  const selectedPaths = Array.from(
    new Set((paths || []).map((p) => String(p || "")).filter(Boolean)),
  );
  if (!selectedPaths.length) return;
  const selectedDirNodes = selectedPaths
    .map((p) => resolveDirNodeForPathOrStorageStub(p))
    .filter(Boolean);
  if (!selectedDirNodes.length) return;
  // A supplied container means the entries are being hosted elsewhere (the app
  // menu's "Selected Item(s)" section) rather than shown as a standalone menu.
  const hostContainer = opts.container || null;
  if (!hostContainer) closeActionMenus();

  const menu = hostContainer || previewActionMenuEl;
  if (!hostContainer) menu.innerHTML = "";
  const makeBtn = (
    label,
    onClick,
    disabled = false,
    closeMenu = true,
    className = "",
  ) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(label || "");
    btn.disabled = !!disabled;
    if (className) btn.className = String(className);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      if (closeMenu) closePreviewContextMenu();
      onClick();
    });
    return btn;
  };

  const singleSelectedDirNode =
    selectedDirNodes.length === 1 ? selectedDirNodes[0] : null;
  const singleSelectedDirPath = String(singleSelectedDirNode?.path || "");
  const anyTrash = selectedPaths.some((path) => isPathInsideInternalTrash(path));
  const isStoredPath = (path) =>
    metaHasStorage(path) ||
    isStorageStubDirNode(resolveDirNodeForPathOrStorageStub(path));
  const allStorage = selectedPaths.every(isStoredPath);
  const anyStorage = selectedPaths.some(isStoredPath);
  const activeAlbumRemovalContext = currentFolderMenuAlbumRemovalContext();
  const canRemoveSelectedFromAlbum =
    !!activeAlbumRemovalContext &&
    selectedPaths.some(
      (p) =>
        metaGetAlbumForPath(p) ===
        normalizeTagAlbumName(activeAlbumRemovalContext.album || ""),
    );
  const activeGalleryRemovalContext = currentFolderMenuGalleryRemovalContext();
  const activeGalleryRemovalName = normalizeGalleryName(
    activeGalleryRemovalContext && activeGalleryRemovalContext.gallery,
  );
  const canRemoveSelectedFromGallery =
    !!activeGalleryRemovalName &&
    selectedPaths.some((p) =>
      metaGetGalleriesForPath(p).includes(activeGalleryRemovalName),
    );
  const quarantineTrashPaths = new Set();
  selectedPaths.forEach((path) => {
    const trashPath = trashTopLevelItemPathForPath(path);
    if (trashPath) quarantineTrashPaths.add(trashPath);
  });
  const quarantineStoragePaths = new Set(
    selectedPaths.filter((path) => pathIsStorageQuarantine(path)),
  );
  const quarantineOnlyContext =
    selectedPaths.every(
      (path) =>
        !!trashTopLevelItemPathForPath(path) ||
        pathIsStorageQuarantine(path),
    ) &&
    (quarantineTrashPaths.size || quarantineStoragePaths.size);
  if (quarantineOnlyContext) {
    if (quarantineTrashPaths.size) {
      menu.appendChild(
        makeBtn(
          "Remove from Trash",
          async () => {
            await putBackTrashFolderPaths(Array.from(quarantineTrashPaths));
            if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
          },
          !WS.meta.fsRootHandle,
        ),
      );
    }
    if (quarantineStoragePaths.size) {
      menu.appendChild(
        makeBtn("Remove from Storage", async () => {
          await setStorageStateForFolderPaths(
            Array.from(quarantineStoragePaths),
            false,
          );
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
        }),
      );
    }
    PREVIEW_CONTEXT_MENU_STATE = {
      dirPath: String(anchorPath || ""),
      bulkPaths: selectedPaths.slice(),
    };
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
    return;
  }

  const addToTagRow = createSelectMenuAddToTagRow(
    makeBtn(
      "Tag",
      () => startPreviewFolderTagEdit(selectedPaths),
      anyTrash || anyStorage,
    ),
    {
      kind: "bulk",
      paths: selectedPaths,
      fileIds: [],
      entries: [],
    },
  );
  if (addToTagRow) menu.appendChild(addToTagRow);

  const bulkRenameButton = makeBtn(
    "Rename",
    () => startPreviewFolderRenameEdit(singleSelectedDirPath),
    !singleSelectedDirPath || !WS.meta.fsRootHandle || anyStorage || anyTrash,
  );
  // Folder options is filled in once its Overrides and Thumbnail exist (below).
  const folderOptionsSlot = document.createElement("div");
  menu.appendChild(folderOptionsSlot);
  if (!allStorage) {
    const sendToStorageButton = makeBtn(
      "Send to storage",
      async () => {
        const n = selectedPaths.length;
        if (
          !(await showAppMenuConfirm(
            `Move ${n} item${n === 1 ? "" : "s"} to Storage?`,
            { danger: false },
          ))
        )
          return;
        await setStorageStateForFolderPaths(selectedPaths, true);
        if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
      },
      anyTrash,
    );
    sendToStorageButton.setAttribute("data-action", "send-to-storage");
    menu.appendChild(sendToStorageButton);
  }

  if (canRemoveSelectedFromAlbum) {
    menu.appendChild(
      makeBtn("Remove from album", () => {
        let changed = false;
        for (let i = 0; i < selectedPaths.length; i++) {
          if (metaSetAlbumForPath(selectedPaths[i], "")) changed = true;
        }
        if (!changed) {
          showStatusMessage("No folders updated.");
          return;
        }
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage("Removed selected folders from album.");
        if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
      }),
    );
  }
  if (canRemoveSelectedFromGallery) {
    menu.appendChild(
      makeBtn("Remove from gallery", () => {
        let changed = false;
        for (let i = 0; i < selectedPaths.length; i++) {
          const next = metaGetGalleriesForPath(selectedPaths[i]).filter(
            (item) => item !== activeGalleryRemovalName,
          );
          if (metaSetGalleriesForPath(selectedPaths[i], next)) changed = true;
        }
        if (!changed) {
          showStatusMessage("No folders updated.");
          return;
        }
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage("Removed selected folders from gallery.");
        if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
      }),
    );
  }
  const bulkThumbnailSubmenu = createBulkThumbnailSubmenu(
    bulkThumbnailTargetsFromSelection(selectedPaths, []),
    {
      closeMenus: () => closePreviewContextMenu(),
    },
  );
  let bulkFolderFiltersEntry = null;
  if (!anyStorage && !anyTrash) {
    const presetIds = selectedPaths.map((path) =>
      metaGetFolderAppearancePresetId(path),
    );
    const mixedPresets = !presetIds.every((id) => id === presetIds[0]);
    const currentPresetId = mixedPresets ? "" : presetIds[0] || "";
    bulkFolderFiltersEntry = createAppearancePresetCycleButton({
      currentPresetId,
      hasOverride: mixedPresets || !!currentPresetId,
      mixed: mixedPresets,
      onChoosePreset: (presetId) => {
        let changed = false;
        for (let i = 0; i < selectedPaths.length; i++) {
          if (metaSetFolderAppearancePresetId(selectedPaths[i], presetId))
            changed = true;
        }
        if (!changed) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage(
          `Folder media preset: ${appearancePresetDisplayName(presetId)}.`,
        );
      },
      onClear: () => {
        let changed = false;
        for (let i = 0; i < selectedPaths.length; i++) {
          if (metaClearFolderAppearancePreset(selectedPaths[i])) changed = true;
        }
        if (!changed) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage("Folder media preset reset to inherited.");
      },
    });
  }

  let bulkFolderSortEntry = null;
  if (!anyStorage && !anyTrash) {
    const currentSortModes = selectedPaths.map((path) =>
      metaGetFolderContainerSortMode(path),
    );
    const commonSortMode = currentSortModes.every(
      (mode) => mode === currentSortModes[0],
    )
      ? currentSortModes[0]
      : null;
    bulkFolderSortEntry = createCyclingItemMenuButton(
      "Sort",
      containerSortModeOptions(),
      commonSortMode || "",
      (mode) => {
        let changed = false;
        for (const path of selectedPaths) {
          if (metaSetFolderContainerSortMode(path, mode)) changed = true;
        }
        if (!changed) return;
        applyFolderSortModeEverywhere(true);
        showStatusMessage(
          `Container sort: ${mode ? dirSortModeLabel(mode) : "None"}.`,
        );
      },
      commonSortMode == null,
    );
  }
  let bulkFolderMediaTypeEntry = null;
  if (!anyStorage && !anyTrash) {
    const mediaSelections = selectedPaths.map((path) =>
      folderMediaFilterAxisSelectionForPath(path),
    );
    const mixedMediaTypes = !mediaSelections.every(
      (selection) => selection === mediaSelections[0],
    );
    bulkFolderMediaTypeEntry = createCyclingItemMenuButton(
      "Media type",
      folderMediaFilterCycleOptions(),
      mixedMediaTypes ? "" : mediaSelections[0] || "",
      (onlyType) => {
        let changed = false;
        for (const path of selectedPaths) {
          const nextValue = setTagMediaFilterAxis(
            metaGetFolderMediaFilter(path),
            TAG_MEDIA_FILTER_MEDIA_TYPES,
            onlyType || null,
          );
          if (metaSetFolderMediaFilter(path, nextValue)) changed = true;
        }
        if (!changed) return;
        metaScheduleSave(META_DOC_IDS.tags);
        refreshAfterTagMetadataChange();
        showStatusMessage(
          `Folder media type filter: ${onlyType ? `${tagMediaFilterTypeLabel(onlyType)} only` : "all"}.`,
        );
      },
      mixedMediaTypes,
    );
  }
  const bulkFolderScoreEntries =
    anyStorage || anyTrash ? [] : scoreFilterOverrideButtonsForFolders(selectedPaths);
  const overridesSubmenu = createDropdownMenuSubmenu(
    "Overrides",
    [
      bulkFolderSortEntry,
      bulkFolderFiltersEntry,
      bulkFolderMediaTypeEntry,
      ...bulkFolderScoreEntries,
    ].filter(Boolean),
  );
  // Two or more Sets: move everything into the one whose name sorts first.
  const mergeSetNodes =
    WS.meta.fsRootHandle && !anyTrash && !anyStorage
      ? mergeableSetNodesForPaths(selectedPaths)
      : null;
  const mergeFoldersButton = mergeSetNodes
    ? makeBtn("Merge folders", async () => {
        const n = mergeSetNodes.length;
        const into = dirDisplayName(mergeSetNodes[0]) || mergeSetNodes[0].name;
        if (
          !(await showAppMenuConfirm(
            `Merge ${n} sets into '${into}'? Their files are moved there and renamed in name order.`,
            { danger: false },
          ))
        )
          return;
        await mergeSelectedSets(mergeSetNodes.map((node) => node.path));
      })
    : null;
  const folderOptionsSubmenu = createFolderOptionsSubmenu(
    selectedPaths,
    anyTrash || anyStorage,
    {
      before: [bulkRenameButton],
      after: [overridesSubmenu, bulkThumbnailSubmenu, mergeFoldersButton],
    },
  );
  if (folderOptionsSubmenu) folderOptionsSlot.replaceWith(folderOptionsSubmenu);
  else folderOptionsSlot.remove();

  if (
    singleSelectedDirNode &&
    singleSelectedDirNode.preserveOrder &&
    dirFileOrderDiffersFromIndexedNameOrder(singleSelectedDirNode)
  ) {
    menu.appendChild(
      makeBtn("Reset order", () => {
        resetDirFileOrder(singleSelectedDirNode, {
          silent: false,
          selectId: null,
        });
        showStatusMessage(
          `Files in ${dirDisplayName(singleSelectedDirNode)} back in name order.`,
        );
      }),
    );
  }

  PREVIEW_CONTEXT_MENU_STATE = {
    dirPath: String(anchorPath || ""),
    bulkPaths: selectedPaths.slice(),
  };
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

function openPreviewBulkFileActionMenu(fileIds, anchorFileId, opts = {}) {
  if (!previewActionMenuEl) return;
  const selectedIds = Array.from(
    new Set((fileIds || []).map((id) => String(id || "")).filter(Boolean)),
  );
  if (!selectedIds.length) return;
  const selectedRecords = selectedIds
    .map((id) => WS.fileById.get(id))
    .filter(Boolean);
  if (!selectedRecords.length) return;
  // A supplied container means the entries are being hosted elsewhere (the app
  // menu's "Selected Item(s)" section) rather than shown as a standalone menu.
  const hostContainer = opts.container || null;
  if (!hostContainer) closeActionMenus();

  const menu = hostContainer || previewActionMenuEl;
  if (!hostContainer) menu.innerHTML = "";
  const makeBtn = (label, onClick, disabled = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(label || "");
    btn.disabled = !!disabled;
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      closePreviewContextMenu();
      await onClick();
    });
    return btn;
  };

  const trashTargets = Array.from(
    new Set(
      selectedRecords
        .map((rec) => trashTopLevelItemPathForFileRecord(rec))
        .filter(Boolean),
    ),
  );
  const allTrash =
    trashTargets.length &&
    selectedRecords.length === selectedIds.length &&
    selectedRecords.every((rec) => !!trashTopLevelItemPathForFileRecord(rec));
  const storagePaths = Array.from(
    new Set(
      selectedRecords
        .map((rec) => String(rec?.dirPath || ""))
        .filter((path) => path && pathIsStorageQuarantine(path)),
    ),
  );
  const allStorage =
    storagePaths.length &&
    selectedRecords.length === selectedIds.length &&
    selectedRecords.every((rec) => fileRecordIsStorageQuarantine(rec));
  if (allTrash) {
    menu.appendChild(
      makeBtn(
        "Remove from Trash",
        async () => {
          await putBackTrashFolderPaths(trashTargets);
          finalizeBulkSelectionAction();
        },
        !WS.meta.fsRootHandle,
      ),
    );
  }
  if (allStorage) {
    menu.appendChild(
      makeBtn("Remove from Storage", async () => {
        await setStorageStateForFolderPaths(storagePaths, false);
        finalizeBulkSelectionAction();
      }),
    );
  }

  const singleFile = selectedRecords.length === 1 ? selectedRecords[0] : null;

  if (!allTrash && !allStorage) {
    menu.appendChild(
      makeBtn(
        "Rename",
        async () => {
          if (singleFile) startPreviewFileRenameEdit(singleFile.id);
        },
        !singleFile || !WS.meta.fsRootHandle,
      ),
    );
  }

  PREVIEW_CONTEXT_MENU_STATE = {
    fileId: String(anchorFileId || ""),
    bulkFileIds: selectedIds.slice(),
  };
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

function openPreviewBulkTagActionMenu(entries, anchorSelectionKey, opts = {}) {
  if (!previewActionMenuEl) return;
  const selectedEntries = Array.isArray(entries)
    ? entries.filter((entry) => entry && entry.kind === "tag")
    : [];
  if (!selectedEntries.length) return;
  // A supplied container means the entries are being hosted elsewhere (the app
  // menu's "Selected Item(s)" section) rather than shown as a standalone menu.
  const hostContainer = opts.container || null;
  if (!hostContainer) closeActionMenus();

  const menu = hostContainer || previewActionMenuEl;
  if (!hostContainer) menu.innerHTML = "";
  const makeBtn = (
    label,
    onClick,
    closeMenu = true,
    disabled = false,
    className = "",
  ) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(label || "");
    btn.disabled = !!disabled;
    if (className) btn.className = String(className);
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      if (closeMenu) closePreviewContextMenu();
      await onClick();
    });
    return btn;
  };
  const presetAssignableTagEntries = selectedEntries.filter(
    (entry) =>
      entry &&
      !entry.special &&
      !entry.placeholder &&
      (!!String(entry.tag || "").trim() ||
        !!normalizeTagAlbumName(entry.album || "") ||
        !!normalizeGalleryName(entry.gallery || "")),
  );
  const tagAppearancePresetKeys = Array.from(
    new Set(
      presetAssignableTagEntries
        .map((entry) => tagThumbnailKeyForEntry(entry))
        .filter(Boolean),
    ),
  );
  const tagMediaFilterTargets = tagAppearancePresetKeys.slice();
  const albumAssignableTagEntries = selectedEntries.filter(
    (entry) =>
      entry &&
      !entry.special &&
      !entry.placeholder &&
      !!String(entry.tag || "").trim(),
  );
  const taggableAlbumEntries = selectedEntries.filter(
    (entry) =>
      entry &&
      !entry.special &&
      !entry.placeholder &&
      !String(entry.tag || "").trim() &&
      !!normalizeTagAlbumName(entry.album || ""),
  );
  const galleryAssignableEntries = selectedEntries.filter((entry) =>
    !!galleryTargetForTagEntry(entry),
  );
  const deletableGalleryEntries = selectedEntries.filter(
    (entry) =>
      entry &&
      !entry.special &&
      !entry.placeholder &&
      !String(entry.tag || "").trim() &&
      !normalizeTagAlbumName(entry.album || "") &&
      !!normalizeGalleryName(entry.gallery || ""),
  );
  const hideableEntries = selectedEntries.filter(
    (entry) =>
      entry &&
      !entry.special &&
      !entry.placeholder &&
      (!!String(entry.tag || "").trim() ||
        !!normalizeTagAlbumName(entry.album || "") ||
        !!normalizeGalleryName(entry.gallery || "")),
  );
  const hideableTagKeys = Array.from(
    new Set(hideableEntries.map((entry) => hiddenTagKeyForEntry(entry)).filter(Boolean)),
  );
  const hideableNoun = hiddenToggleNounForEntries(hideableEntries);
  const allHiddenTags =
    !!hideableTagKeys.length &&
    hideableTagKeys.every((key) => metaHasHiddenTagByKey(key));
  const singleRenameEntry =
    selectedEntries.length === 1 ? selectedEntries[0] || null : null;
  const canSingleRename = !!(
    singleRenameEntry &&
    !singleRenameEntry.special &&
    !singleRenameEntry.placeholder &&
    (String(singleRenameEntry.tag || "").trim() ||
      normalizeTagAlbumName(singleRenameEntry.album || "") ||
      normalizeGalleryName(singleRenameEntry.gallery || ""))
  );
  const singleRegularTagEntry =
    singleRenameEntry &&
    !singleRenameEntry.special &&
    !singleRenameEntry.placeholder &&
    !!String(singleRenameEntry.tag || "").trim() &&
    !normalizeTagAlbumName(singleRenameEntry.album || "");
  const nestableTagNames = normalizeTagList(
    selectedEntries
      .filter((entry) => entry && !entry.special && !entry.placeholder)
      .map((entry) => entry.tag),
  );
  if (nestableTagNames.length) {
    const addToTagRow = createSelectMenuAddToTagRow(
      makeBtn("Tag", async () => {
        finalizeBulkSelectionAction();
        startBulkTagInTag(nestableTagNames, "preview");
      }),
      { kind: "bulk", paths: [], fileIds: [], entries: selectedEntries },
    );
    if (addToTagRow) menu.appendChild(addToTagRow);
  }
  const bulkTagRenameButton = makeBtn(
    "Rename",
    async () => {
      if (!singleRenameEntry) return;
      allowMenuClose();
      closeAppMenu();
      finalizeBulkSelectionAction();
      beginTagRenameForEntry(singleRenameEntry, "preview");
    },
    true,
    !canSingleRename,
  );
  // Rename leads Tag options when there is one, as it does for a single Tag.
  const bulkTagOptionsItems = nestableTagNames.length ? [bulkTagRenameButton] : [];
  if (!nestableTagNames.length) menu.appendChild(bulkTagRenameButton);
  const bulkTagOptionsSlot = document.createElement("div");
  if (nestableTagNames.length) {
    menu.appendChild(bulkTagOptionsSlot);
    const allExclusive = nestableTagNames.every((name) => tagIsExclusive(name));
    const exclusiveButton = makeBtn(
      `${allExclusive ? "●" : "○"} Exclusive`,
      async () => {
        let changed = 0;
        for (const name of nestableTagNames) {
          if (metaSetTagExclusive(name, !allExclusive)) changed++;
        }
        if (!changed) return;
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage(
          `${changed} tag${changed === 1 ? "" : "s"} ${allExclusive ? "no longer" : "now"} exclusive.`,
        );
      },
      false,
    );
    exclusiveButton.setAttribute("data-action", "toggle-exclusive");
    bulkTagOptionsItems.push(exclusiveButton);
    // Use anywhere, for the selected Tags that can be held to a place;
    // ● when every one of them is set to it.
    const heldNames = nestableTagNames.filter((name) => tagCanBeHeld(name));
    if (heldNames.length) {
      const allOn = heldNames.every((name) => tagUsesAnywhere(name));
      bulkTagOptionsItems.push(
        createSelectMenuToggleButton("Use anywhere", allOn, () => {
          let changed = 0;
          for (const name of heldNames) changed += metaSetTagUseAnywhere(name, !allOn);
          if (!changed) return;
          metaScheduleSave();
          refreshAfterTagMetadataChange();
          showStatusMessage(
            `${changed} tag${changed === 1 ? "" : "s"} ${allOn ? "are held to where their content is again." : "can now be used anywhere."}`,
          );
        }),
      );
    }
  }
  if (nestableTagNames.length && hideableTagKeys.length) {
    bulkTagOptionsItems.push(
      createSelectMenuToggleButton("Hidden", allHiddenTags, () => {
        let changed = false;
        for (let i = 0; i < hideableTagKeys.length; i++) {
          if (metaSetHiddenTagByKey(hideableTagKeys[i], !allHiddenTags))
            changed = true;
        }
        if (!changed) return;
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage(
          `${allHiddenTags ? "Unhid" : "Hid"} ${hideableTagKeys.length} ${hideableNoun}${hideableTagKeys.length === 1 ? "" : "s"}.`,
        );
      }),
    );
  }
  if (singleRegularTagEntry) {
    const inverseButton = makeBtn("Create inverse", async () => {
      createInverseTagForEntry(singleRegularTagEntry);
      finalizeBulkSelectionAction();
    });
    inverseButton.setAttribute("data-action", "create-inverse");
    bulkTagOptionsItems.push(inverseButton);
  }

  const bulkThumbnailSubmenu = createBulkThumbnailSubmenu(
    bulkThumbnailTargetsFromSelection([], selectedEntries),
    {
      closeMenus: () => closePreviewContextMenu(),
    },
  );
  if (bulkThumbnailSubmenu) menu.appendChild(bulkThumbnailSubmenu);

  let bulkTagFiltersEntry = null;
  if (tagAppearancePresetKeys.length) {
    const presetIds = tagAppearancePresetKeys.map((key) =>
      metaGetTagAppearancePresetIdByKey(key),
    );
    const mixedPresets = !presetIds.every((id) => id === presetIds[0]);
    const currentPresetId = mixedPresets ? "" : presetIds[0] || "";
    bulkTagFiltersEntry = createAppearancePresetCycleButton({
      currentPresetId,
      hasOverride: mixedPresets || !!currentPresetId,
      mixed: mixedPresets,
      onChoosePreset: (presetId) => {
        let changed = false;
        for (let i = 0; i < tagAppearancePresetKeys.length; i++) {
          if (
            metaSetTagAppearancePresetIdByKey(
              tagAppearancePresetKeys[i],
              presetId,
            )
          )
            changed = true;
        }
        if (!changed) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage(
          `Tag media preset: ${appearancePresetDisplayName(presetId)}.`,
        );
      },
      onClear: () => {
        let changed = false;
        for (let i = 0; i < tagAppearancePresetKeys.length; i++) {
          if (metaClearTagAppearancePresetByKey(tagAppearancePresetKeys[i]))
            changed = true;
        }
        if (!changed) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage("Tag media preset reset.");
      },
    });
  }
  let bulkTagSortEntry = null;
  if (tagAppearancePresetKeys.length) {
    const sortModes = tagAppearancePresetKeys.map((key) =>
      metaGetTagContainerSortMode(key),
    );
    const commonSortMode = sortModes.every((mode) => mode === sortModes[0])
      ? sortModes[0]
      : null;
    bulkTagSortEntry = createCyclingItemMenuButton(
      "Sort",
      containerSortModeOptions(),
      commonSortMode || "",
      (mode) => {
        let changed = false;
        for (const key of tagAppearancePresetKeys) {
          if (metaSetTagContainerSortMode(key, mode)) changed = true;
        }
        if (!changed) return;
        applyFolderSortModeEverywhere(true);
        showStatusMessage(
          `Container sort: ${mode ? dirSortModeLabel(mode) : "None"}.`,
        );
      },
      commonSortMode == null,
    );
  }
  let bulkTagMediaTypeEntry = null;
  if (tagMediaFilterTargets.length) {
    const mediaSelections = tagMediaFilterTargets.map((key) =>
      tagMediaFilterAxisSelection(
        metaGetTagMediaFilterByKey(key),
        TAG_MEDIA_FILTER_MEDIA_TYPES,
      ),
    );
    const mixedMediaTypes = !mediaSelections.every(
      (selection) => selection === mediaSelections[0],
    );
    bulkTagMediaTypeEntry = createCyclingItemMenuButton(
      "Media type",
      tagMediaFilterAxisCycleOptions(TAG_MEDIA_FILTER_MEDIA_TYPES, "All"),
      mixedMediaTypes ? "" : mediaSelections[0] || "",
      (onlyType) => {
        let changed = false;
        for (const key of tagMediaFilterTargets) {
          const nextValue = setTagMediaFilterAxis(
            metaGetTagMediaFilterByKey(key),
            TAG_MEDIA_FILTER_MEDIA_TYPES,
            onlyType || null,
          );
          if (metaSetTagMediaFilterByKey(key, nextValue)) changed = true;
        }
        if (!changed) return;
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage(
          `Tag media type filter: ${onlyType ? `${tagMediaFilterTypeLabel(onlyType)} only` : "all"}.`,
        );
      },
      mixedMediaTypes,
    );
  }
  const overridesSubmenu = createDropdownMenuSubmenu(
    "Overrides",
    [
      bulkTagSortEntry,
      bulkTagFiltersEntry,
      bulkTagMediaTypeEntry,
      ...scoreFilterOverrideButtonsForTags(
        presetAssignableTagEntries
          .filter(
            (entry) =>
              !normalizeTagAlbumName(entry.album || "") &&
              !normalizeGalleryName(entry.gallery || ""),
          )
          .map((entry) => entry.tag),
      ),
    ].filter(Boolean),
  );
  if (nestableTagNames.length) {
    const tagOptionsSubmenu = createDropdownMenuSubmenu(
      "Tag options",
      bulkTagOptionsItems.concat(overridesSubmenu ? [overridesSubmenu] : []),
    );
    if (tagOptionsSubmenu) bulkTagOptionsSlot.replaceWith(tagOptionsSubmenu);
    else bulkTagOptionsSlot.remove();
  } else if (overridesSubmenu) {
    menu.appendChild(overridesSubmenu);
  }

  PREVIEW_CONTEXT_MENU_STATE = {
    tagKey: String(anchorSelectionKey || ""),
    bulkTagKeys: selectedEntries
      .map((entry) => String(tagEntrySelectionKey(entry) || ""))
      .filter(Boolean),
  };
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

function openPreviewFolderActionMenu(dirNode, opts = {}) {
  if (separateItemMenuDisabled() && !opts.container) return;
  if (!previewActionMenuEl || !dirNode) return;
  if (folderNodeHasNoItemMenu(dirNode)) return;
  const p = String(dirNode.path || "");
  if (!p) return;
  if (shouldUsePreviewBulkFolderMenu(p)) {
    openPreviewBulkFolderActionMenu(
      getPreviewFolderMenuSelectionPaths(p),
      p,
      opts,
    );
    return;
  }
  const selectedPaths = getPreviewFolderMenuSelectionPaths(p);
  if (selectedPaths.length > 1) {
    openPreviewBulkFolderActionMenu(selectedPaths, p, opts);
    return;
  }

  // A supplied container means the entries are being hosted elsewhere (the app
  // menu's "Selected Item(s)" section) rather than shown as a standalone menu.
  const hostContainer = opts.container || null;
  if (!hostContainer) closeActionMenus();

  const menu = hostContainer || previewActionMenuEl;
  if (!hostContainer) menu.innerHTML = "";
  const menuState = buildFolderMenuState(dirNode);
  buildFolderActionMenuDom(
    menu,
    menuState,
    (action) => {
      closePreviewContextMenu();
      if (action === "tag") {
        startPreviewFolderTagEdit([p]);
        return;
      }
      if (action === "rename") {
        startPreviewFolderRenameEdit(p);
        return;
      }
      runFolderActionFromMenu(action, dirNode).catch(() => {});
    },
    {
      appearancePresetCycleButton: () =>
        createAppearancePresetCycleButton({
          currentPresetId: menuState.assignedAppearancePresetId,
          hasOverride: !!menuState.assignedAppearancePresetId,
          onChoosePreset: (presetId) => {
            if (!metaSetFolderAppearancePresetId(p, presetId)) return;
            refreshAfterProcessingMetadataChange();
            showStatusMessage(
              `Folder media preset: ${appearancePresetDisplayName(presetId)}.`,
            );
          },
          onClear: () => {
            if (!metaClearFolderAppearancePreset(p)) return;
            refreshAfterProcessingMetadataChange();
            showStatusMessage("Folder media preset reset.");
          },
        }),
    },
  );

  PREVIEW_CONTEXT_MENU_STATE = { dirPath: p };
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
