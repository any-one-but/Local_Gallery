/* Select menu
   What the select menu acts on, quarantine and removal rows, ordering and
   icons. */

// What the app menu's first section acts on. An open media file wins so the app
// menu follows what the user is looking at; otherwise the multi-item (bulk)
// selection wins when there is one. After that it is whichever single item the
// active pane has selected, using the same pane-priority rule the item menu used
// before it was folded in here.
function appMenuSelectionTarget() {
  if (!WS.root) return null;
  const openMediaRec = currentOpenMediaFileRecordForAppMenu();
  if (openMediaRec) return { kind: "file", rec: openMediaRec };
  if (hasBulkSelection()) {
    const paths = getSelectedPathsInCurrentDir();
    const tagKeys = getSelectedTagFolderKeysInCurrentView();
    const fileIds = getSelectedFileIdsInCurrentView();
    const count = paths.length + tagKeys.length + fileIds.length;
    if (count > 1) {
      return {
        kind: "bulk",
        count,
        paths,
        fileIds,
        entries: getSelectedTagEntriesInCurrentView(),
      };
    }
  }
  if (previewPaneOwnsSelection()) {
    const card = findSelectedPreviewCard();
    const kind = String(card?.dataset?.previewItemKind || "");
    if (kind === "file") {
      const rec = WS.fileById.get(String(previewFileIdForCard(card) || ""));
      if (rec) return { kind: "file", rec, card };
    } else if (kind === "dir") {
      // Storage portal rows are stubs and may not live in dirByPath — resolve
      // through the storage-aware helper so a single stored folder still gets
      // a real selection target (and the quarantine Remove action).
      const path = String(previewDirPathForCard(card) || "");
      const node =
        resolveDirNodeForPathOrStorageStub(path) ||
        WS.dirByPath.get(path) ||
        null;
      if (node) return { kind: "dir", node, card };
    } else if (kind === "tag") {
      const entry = card.__previewTagEntry || null;
      if (entry) return { kind: "tag", entry, card };
    }
  }
  const entry = WS.nav.entries[Number(WS.nav.selectedIndex)] || null;
  if (entry?.kind === "dir" && entry.node)
    return { kind: "dir", node: entry.node };
  if (entry?.kind === "dir" && entry.path) {
    const node = resolveDirNodeForPathOrStorageStub(String(entry.path || ""));
    if (node) return { kind: "dir", node };
  }
  if (entry?.kind === "file") {
    const rec = WS.fileById.get(String(entry.id || ""));
    if (rec) return { kind: "file", rec };
  }
  if (entry?.kind === "tag") return { kind: "tag", entry };
  return null;
}

function appMenuSelectionSummary() {
  const target = appMenuSelectionTarget();
  if (!target) return { target: null, title: "No selection", label: "Selection" };
  if (target.kind === "bulk") {
    return {
      target,
      title: `${target.count} Selected Items`,
      label: "Selected Items",
    };
  }
  let name = "";
  if (target.kind === "dir")
    name = dirUiLabel(target.node) || displayName(target.node.name) || "Root";
  else if (target.kind === "file")
    name = displayName(target.rec.name) || String(target.rec.name || "");
  else if (target.kind === "tag")
    name =
      String(target.entry.label || target.entry.tag || target.entry.album || target.entry.gallery || "") ||
      "Tag";
  return { target, title: name || "Selected Item", label: "Selected Item" };
}

// True when a folder path is a removable Trash top-level item (not the Trash
// portal itself). Matches what putBackTrashFolderPaths actually accepts.
function pathIsTrashQuarantine(path) {
  return !!trashTopLevelItemPathForPath(path);
}

// True when a folder path is in Storage (tag or stub). Storage is folder-level.
function pathIsStorageQuarantine(path) {
  const p = String(path || "");
  if (!p) return false;
  if (metaHasStorage(p)) return true;
  return isStorageStubDirNode(resolveDirNodeForPathOrStorageStub(p));
}

function fileRecordIsTrashQuarantine(rec) {
  return !!trashTopLevelItemPathForFileRecord(rec);
}

function fileRecordIsStorageQuarantine(rec) {
  if (!rec) return false;
  // A file is "in storage" by virtue of its parent folder (including stubs that
  // are not loaded into dirByPath).
  return pathIsStorageQuarantine(String(rec.dirPath || ""));
}

function makeSelectedItemQuarantineAction(label, kind, target) {
  return { label, kind, target };
}

// An item sitting in Trash or Storage has no meaningful item menu -- almost
// every action is refused for it anyway. Returns the inverse action(s) that do
// apply, so the select menu can offer only those buttons for quarantine
// selections, single or bulk.
function selectedItemQuarantineActions(target) {
  if (!target) return [];
  if (target.kind === "dir") {
    if (isTrashRootPortalNode(target.node)) return [];
    const p = String(target.node?.path || "");
    if (!p) return [];
    if (pathIsTrashQuarantine(p))
      return [makeSelectedItemQuarantineAction("Remove from Trash", "trash", target)];
    if (pathIsStorageQuarantine(p) || isStorageStubDirNode(target.node))
      return [
        makeSelectedItemQuarantineAction(
          "Remove from Storage",
          "storage",
          target,
        ),
      ];
    return [];
  }

  if (target.kind === "file") {
    if (!target.rec) return [];
    if (fileRecordIsTrashQuarantine(target.rec))
      return [makeSelectedItemQuarantineAction("Remove from Trash", "trash", target)];
    if (fileRecordIsStorageQuarantine(target.rec))
      return [
        makeSelectedItemQuarantineAction(
          "Remove from Storage",
          "storage",
          target,
        ),
      ];
    return [];
  }

  if (target.kind !== "bulk") return [];

  const paths = Array.isArray(target.paths)
    ? target.paths.map((p) => String(p || "")).filter(Boolean)
    : [];
  const fileIds = Array.isArray(target.fileIds)
    ? target.fileIds.map((id) => String(id || "")).filter(Boolean)
    : [];
  const recs = fileIds.map((id) => WS.fileById.get(id)).filter(Boolean);
  // Incomplete bulk (missing file records) — fall back to the full submenu.
  if (fileIds.length && recs.length !== fileIds.length) return [];
  if (!paths.length && !recs.length) return [];

  // Every selected unit must be in a quarantine location. Mixed Trash + Storage
  // still gets inverse actions; mixed quarantine + normal content falls back to
  // the normal menu so the generic removal action can describe the full set.
  let anyTrash = false;
  let anyStorage = false;
  for (let i = 0; i < paths.length; i++) {
    const isTrash = pathIsTrashQuarantine(paths[i]);
    const isStorage = pathIsStorageQuarantine(paths[i]);
    if (!isTrash && !isStorage) return [];
    if (isTrash) anyTrash = true;
    if (isStorage) anyStorage = true;
  }
  for (let i = 0; i < recs.length; i++) {
    const isTrash = fileRecordIsTrashQuarantine(recs[i]);
    const isStorage = fileRecordIsStorageQuarantine(recs[i]);
    if (!isTrash && !isStorage) return [];
    if (isTrash) anyTrash = true;
    if (isStorage) anyStorage = true;
  }
  const actions = [];
  if (anyTrash)
    actions.push(
      makeSelectedItemQuarantineAction("Remove from Trash", "trash", target),
    );
  if (anyStorage)
    actions.push(
      makeSelectedItemQuarantineAction(
        "Remove from Storage",
        "storage",
        target,
      ),
    );
  return actions;
}

function selectedItemQuarantineAction(target) {
  return selectedItemQuarantineActions(target)[0] || null;
}

function buildSelectedItemQuarantineButton(quarantine) {
  return appMenuChoiceButton(quarantine.label, () => {
    const target = quarantine.target;
    if (quarantine.kind === "trash") {
      if (target.kind === "file") {
        runFileActionFromMenu("put-back", String(target.rec?.id || ""));
        return;
      }
      const trashPaths = new Set();
      if (target.kind === "bulk") {
        (target.paths || []).forEach((p) => {
          const t = trashTopLevelItemPathForPath(p);
          if (t) trashPaths.add(t);
        });
        (target.fileIds || []).forEach((id) => {
          const rec = WS.fileById.get(String(id || ""));
          const t = rec ? trashTopLevelItemPathForFileRecord(rec) : "";
          if (t) trashPaths.add(t);
        });
      } else {
        const t = trashTopLevelItemPathForPath(String(target.node?.path || ""));
        if (t) trashPaths.add(t);
      }
      if (trashPaths.size) {
        putBackTrashFolderPaths(Array.from(trashPaths));
        if (target.kind === "bulk") finalizeBulkSelectionAction();
      }
      return;
    }
    // Storage is folder-level: single file → its parent folder; bulk files →
    // unique parent folders that are in storage.
    const paths = new Set();
    if (target.kind === "bulk") {
      (target.paths || []).forEach((p) => {
        if (pathIsStorageQuarantine(p)) paths.add(String(p));
      });
      (target.fileIds || []).forEach((id) => {
        const rec = WS.fileById.get(String(id || ""));
        const dirPath = String(rec?.dirPath || "");
        if (dirPath && pathIsStorageQuarantine(dirPath)) paths.add(dirPath);
      });
    } else if (target.kind === "file") {
      const dirPath = String(target.rec?.dirPath || "");
      if (dirPath) paths.add(dirPath);
    } else {
      const p = String(target.node?.path || "");
      if (p) paths.add(p);
    }
    if (paths.size) {
      setStorageStateForFolderPaths(Array.from(paths), false);
      if (target.kind === "bulk") finalizeBulkSelectionAction();
    }
  }, null, true);
}

function pruneUnavailableSelectedItemMenuOptions(menuEl) {
  if (!menuEl) return;
  menuEl.querySelectorAll("button:disabled").forEach((button) => {
    button.remove();
  });
  menuEl.querySelectorAll(".menuTwoColRow").forEach((row) => {
    if (!row.querySelector("button")) row.remove();
  });
  const submenus = Array.from(
    menuEl.querySelectorAll(".dropdownMenuSubmenu"),
  ).reverse();
  for (let i = 0; i < submenus.length; i++) {
    const submenu = submenus[i];
    const panel = submenu.querySelector(
      ":scope > .dropdownMenuSubmenuPanel",
    );
    const hasAvailableContent = !!(
      panel &&
      panel.querySelector(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), .dropdownMenuItemInfoFooter, .dropdownMenuItemInfoRows",
      )
    );
    if (!hasAvailableContent) submenu.remove();
  }
}

function selectedItemMenuElementLabel(el) {
  if (!el) return "";
  if (el.classList?.contains("dropdownMenuSubmenu")) {
    const trigger = el.querySelector(":scope > .dropdownMenuSubmenuTrigger");
    return String(trigger?.textContent || "").trim();
  }
  return String(el.textContent || "").trim();
}

function isSelectMenuTopLevelElement(el) {
  const label = selectedItemMenuElementLabel(el);
  const lower = label.toLowerCase();
  if (el?.classList?.contains("dropdownMenuSubmenu")) {
    return (
      label === ADD_TO_TAG_LABEL ||
      label === ADD_CONTENTS_TO_TAG_LABEL ||
      label === REMOVE_TAG_LABEL ||
      lower === "tag options" ||
      lower === "folder options" ||
      lower === "overrides" ||
      lower === "thumbnail" ||
      lower === "alts"
    );
  }
  if (el?.tagName === "BUTTON") {
    const action = String(el.getAttribute("data-action") || "");
    return (
      label === ADD_TO_TAG_LABEL ||
      label === ADD_CONTENTS_TO_TAG_LABEL ||
      action === "rename" ||
      action === "rename-file" ||
      action === "empty-trash" ||
      action === "toggle-exclusive" ||
      lower === "rename"
    );
  }
  return false;
}

function isExistingSelectMenuRemovalElement(el) {
  if (!el || el.tagName !== "BUTTON") return false;
  const label = selectedItemMenuElementLabel(el).toLowerCase();
  const action = String(el.getAttribute("data-action") || "");
  if (action === "empty-trash") return false;
  return (
    el.classList?.contains("destructiveAction") ||
    action === "delete" ||
    action === "move-to-trash" ||
    label === "delete" ||
    label === "trash" ||
    label === "move to trash"
  );
}

function selectMenuDeleteLabelForTagEntry(entry) {
  if (!entry || entry.kind !== "tag") return "Delete item";
  const special = String(entry.special || "").trim();
  if (special) {
    const label = String(entry.label || special || "item").trim();
    return `Delete ${label.toLowerCase()}`;
  }
  return "Delete tag";
}

function selectMenuBulkRemovalLabel(paths, entries) {
  const folderCount = Array.isArray(paths) ? paths.length : 0;
  const otherCount = Array.isArray(entries) ? entries.length : 0;
  const folderNoun = `folder${folderCount === 1 ? "" : "s"}`;
  const itemNoun = `item${otherCount === 1 ? "" : "s"}`;
  if (folderCount && otherCount) {
    return `Move ${folderCount} ${folderNoun} to trash and delete ${otherCount} other ${itemNoun}`;
  }
  if (folderCount) return `Move ${folderCount} ${folderNoun} to trash`;
  return `Delete ${otherCount} ${itemNoun}`;
}

function buildSelectMenuRemovalButton(target) {
  if (!target) return null;
  let label = "";
  let action = "delete";
  let disabled = false;
  let onClick = null;

  if (target.kind === "dir") {
    const node = target.node || null;
    const state = buildFolderMenuState(node);
    if (!node || state.isRootNode || state.isTrashRootPortal) return null;
    if (state.isTrashItem || state.isStorageRestricted) return null;
    label = "Move to trash";
    action = "move-to-trash";
    disabled = !state.canMoveToTrash;
    onClick = () => runFolderActionFromMenu("move-to-trash", node);
  } else if (target.kind === "tag") {
    const entry = target.entry || null;
    if (!entry || entry.placeholder) return null;
    const deletable =
      entry.special === "favorites" ||
      (!entry.special &&
        (String(entry.tag || "").trim() ||
          normalizeTagAlbumName(entry.album || "") ||
          normalizeGalleryName(entry.gallery || "")));
    if (!deletable) return null;
    label = selectMenuDeleteLabelForTagEntry(entry);
    onClick = () => handleTagMenuAction("delete");
  } else if (target.kind === "bulk") {
    const paths = Array.isArray(target.paths)
      ? target.paths.map((p) => String(p || "")).filter(Boolean)
      : [];
    const entries = Array.isArray(target.entries)
      ? target.entries.filter((entry) => entry && entry.kind === "tag")
      : [];
    if (!paths.length && !entries.length) return null;
    label = selectMenuBulkRemovalLabel(paths, entries);
    onClick = async () => {
      const confirmed = await showAppMenuConfirm(label + "?", {
        danger: true,
      });
      if (!confirmed) return false;
      let changed = false;
      const storagePaths = [];
      const trashPaths = new Set();
      const movablePaths = [];
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (pathIsStorageQuarantine(path)) {
          storagePaths.push(path);
          continue;
        }
        const trashPath = trashTopLevelItemPathForPath(path);
        if (trashPath) {
          trashPaths.add(trashPath);
          continue;
        }
        if (isFolderPathMovableToTrash(path)) movablePaths.push(path);
      }
      if (storagePaths.length)
        changed =
          (await setStorageStateForFolderPaths(storagePaths, false)) ||
          changed;
      if (trashPaths.size)
        changed =
          (await putBackTrashFolderPaths(Array.from(trashPaths))) || changed;
      if (movablePaths.length)
        changed = (await moveFolderPathsToTrash(movablePaths)) || changed;
      const deletableEntries = entries.filter(
        (entry) => !entry.special || entry.special === "favorites",
      );
      const favoritesEntries = deletableEntries.filter(
        (entry) => entry.special === "favorites",
      );
      for (let i = 0; i < favoritesEntries.length; i++) {
        const favoritePaths = gatherTagPathsForDirs(
          getUnfilteredMembershipDirsForTagEntry(favoritesEntries[i]),
        );
        if (favoritePaths.length && metaSetFavoriteBulk(favoritePaths, false)) {
          changed = true;
          metaScheduleSave();
        }
      }
      const regularEntries = deletableEntries.filter((entry) => !entry.special);
      if (regularEntries.length)
        changed =
          (await deleteSelectedTagAlbumEntries(regularEntries, false, {
            skipConfirm: true,
          })) || changed;
      if (changed) {
        refreshAfterTagMetadataChange();
        finalizeBulkSelectionAction();
      } else {
        showStatusMessage("No removable items selected.");
      }
      return changed;
    };
  } else {
    return null;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = !!disabled;
  button.className = "destructiveAction";
  button.setAttribute("data-action", action);
  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (button.disabled || typeof onClick !== "function") return;
    await onClick();
  });
  return button;
}

/* The order the file-order actions read in, wherever they land: undo-able
   moves first, then the one that writes the order into the file names. */
const SELECT_MENU_ORDER_ACTION_RANK = Object.freeze({
  "Reverse file order": 0,
  "Reset order": 1,
  Index: 2,
});

function selectMenuOrderActionRank(el) {
  const rank = SELECT_MENU_ORDER_ACTION_RANK[selectedItemMenuElementLabel(el)];
  return rank == null ? -1 : rank;
}

function organizeSelectMenuItems(items, target) {
  const source = Array.isArray(items) ? items.filter(Boolean) : [];
  const editTags = [];
  const topLevel = [];
  const other = [];
  const infoBlocks = [];
  let sendToStorageButton = null;
  for (let i = 0; i < source.length; i++) {
    const item = source[i];
    if (isExistingSelectMenuRemovalElement(item)) continue;
    // Send to storage sits right above the red removal row.
    if (String(item.getAttribute?.("data-action") || "") === "send-to-storage") {
      sendToStorageButton = item;
      continue;
    }
    // Add tag, Add tag to all contents and Remove tag go together in Edit tags,
    // the first option.
    const label = selectedItemMenuElementLabel(item);
    if (
      label === ADD_TO_TAG_LABEL ||
      label === ADD_CONTENTS_TO_TAG_LABEL ||
      label === REMOVE_TAG_LABEL
    ) {
      editTags.push(item);
      continue;
    }
    if (
      item.classList?.contains("dropdownMenuItemInfoHeader") ||
      item.classList?.contains("dropdownMenuItemInfoFooter") ||
      item.classList?.contains("dropdownMenuItemInfo")
    ) {
      infoBlocks.push(item);
      continue;
    }
    if (isSelectMenuTopLevelElement(item)) topLevel.push(item);
    else other.push(item);
  }
  const editTagsOrder = [ADD_TO_TAG_LABEL, ADD_CONTENTS_TO_TAG_LABEL, REMOVE_TAG_LABEL];
  editTags.sort(
    (a, b) =>
      editTagsOrder.indexOf(selectedItemMenuElementLabel(a)) -
      editTagsOrder.indexOf(selectedItemMenuElementLabel(b)),
  );
  const organized = [];
  const editTagsSubmenu = createDropdownMenuSubmenu(EDIT_TAGS_LABEL, editTags);
  if (editTagsSubmenu) organized.push(editTagsSubmenu);
  organized.push(...topLevel);
  // What used to collect in Other (Reverse file order, Reset order, Index)
  // belongs to the item itself, so it joins Folder options / Tag options.
  // Other is only made when the selection has neither.
  other.sort((a, b) => selectMenuOrderActionRank(a) - selectMenuOrderActionRank(b));
  const optionsPanel = topLevel
    .filter((el) => {
      const label = selectedItemMenuElementLabel(el);
      return label === "Folder options" || label === "Tag options";
    })
    .map((el) => el.querySelector(":scope > .dropdownMenuSubmenuPanel"))
    .find(Boolean);
  if (optionsPanel && other.length) {
    other.forEach((el) => optionsPanel.appendChild(el));
  } else {
    const otherSubmenu = createDropdownMenuSubmenu("Other", other);
    if (otherSubmenu) organized.push(otherSubmenu);
  }
  const altsSubmenu = buildSelectMenuAltsSubmenu(target);
  if (altsSubmenu) organized.push(altsSubmenu);
  if (sendToStorageButton) organized.push(sendToStorageButton);
  const removalButton = buildSelectMenuRemovalButton(target);
  if (removalButton) organized.push(removalButton);
  organized.push(...infoBlocks);
  return organized;
}

// The whole item menu, hosted as the app menu's first submenu. The per-kind
// builders write into a detached container, so these are the same entries the
// standalone item menus show rather than a reimplementation of them.
/* The selected item's actions as a flat list. `buildSelectedItemMenuSubmenu`
   wraps this in a submenu for the (now retired) in-app-menu section; the select
   menu uses the list directly, since that menu *is* this section. */
function selectedItemMenuSectionItems(summary) {
  const target = summary?.target;
  if (!target) return null;
  const host = document.createElement("div");
  host.className = "dropdownMenu dropdownMenuSubmenuPanel";

  if (target.kind === "dir") {
    const node = target.node;
    const p = String(node.path || "");
    if (folderNodeHasNoItemMenu(node)) return null;
    const menuState = buildFolderMenuState(node);
    buildFolderActionMenuDom(
      host,
      menuState,
      (action) => {
        if (action === "tag") {
          startPreviewFolderTagEdit([p]);
          return;
        }
        if (action === "rename") {
          startPreviewFolderRenameEdit(p);
          return;
        }
        runFolderActionFromMenu(action, node).catch(() => {});
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
    if (menuState.isTrashRootPortal) {
      return Array.from(host.children).filter(
        (child) =>
          child?.tagName === "BUTTON" &&
          String(child.getAttribute("data-action") || "") === "empty-trash",
      );
    }
  } else if (target.kind === "file") {
    if (!target.rec || fileRecordHasNoItemMenu(target.rec)) return null;
    const fileId = String(target.rec.id || "");
    buildFileActionMenuDom(host, target.rec, (action) =>
      runFileActionFromMenu(action, fileId),
    );
  } else if (target.kind === "tag") {
    const entry = target.entry;
    // All tags, All Models and All Sets are views, not Tags: nothing to
    // rename, tag or delete.
    if (entry.placeholder || isViewOnlyTagName(normalizeTag(entry.tag || "")))
      return null;
    openTagContextMenu({
      entry,
      tag: String(entry.tag || ""),
      album: String(entry.album || ""),
      gallery: String(entry.gallery || ""),
      tagKey: tagThumbnailKeyForEntry(entry),
      special: entry.special || "",
      label: String(entry.label || entry.tag || entry.album || entry.gallery || ""),
      anchor: target.card || selectedItemMenuAnchor(),
      paths: gatherTagPathsForDirs(
        getUnfilteredMembershipDirsForTagEntry(entry),
      ),
      originPath: String(entry.originPath || ""),
      container: host,
    });
  } else if (target.kind === "bulk") {
    if (target.paths.length) {
      openPreviewBulkFolderActionMenu(target.paths, target.paths[0], {
        container: host,
      });
    } else if (target.fileIds.length) {
      openPreviewBulkFileActionMenu(target.fileIds, target.fileIds[0], {
        container: host,
      });
    } else if (target.entries.length) {
      openPreviewBulkTagActionMenu(target.entries, "", { container: host });
    }
  }

  // The old view-context removals exposed only the album/gallery currently
  // being viewed. The membership submenu below supersedes them with every
  // label shared by the selection.
  Array.from(host.children).forEach((child) => {
    if (child.tagName !== "BUTTON") return;
    const label = String(child.textContent || "").trim().toLowerCase();
    if (label === "remove from album" || label === "remove from gallery")
      child.remove();
  });

  // "Reverse file order" is the last action for a single selected folder, acting
  // on that folder's own files. Not offered for files, tags, or bulk selections.
  if (target.kind === "dir" && target.node) {
    const reverseBtn = buildAppMenuReverseFilesButton(target.node);
    if (reverseBtn) host.appendChild(reverseBtn);
  }

  // "Add tag to all contents" sits directly under "Add tag", or first when
  // the selection cannot itself go in a Tag. organizeSelectMenuItems keeps the
  // pair at the top of the menu.
  const findAddToTagRow = () =>
    Array.from(host.children).find(
      (child) => selectedItemMenuElementLabel(child) === ADD_TO_TAG_LABEL,
    ) || null;
  const addContentsSubmenu = buildAddContentsToTagSubmenu(target);
  if (addContentsSubmenu) {
    const addToTagRow = findAddToTagRow();
    if (addToTagRow) addToTagRow.after(addContentsSubmenu);
    else host.insertBefore(addContentsSubmenu, host.firstChild);
  }

  const removeFromSubmenu = createLabelRemovalSubmenu(target);
  if (removeFromSubmenu) {
    const after = addContentsSubmenu || findAddToTagRow();
    if (after && after.parentNode === host) after.after(removeFromSubmenu);
    else host.appendChild(removeFromSubmenu);
  }


  const infoBlock = promoteItemInfoDropdownToHeader(host);
  if (infoBlock) {
    // Item Info sits at the bottom of the section, under the options.
    infoBlock.classList.add("dropdownMenuItemInfoFooter");
    host.appendChild(infoBlock);
  }
  pruneUnavailableSelectedItemMenuOptions(host);
  const items = organizeSelectMenuItems(Array.from(host.children), target);
  items.forEach((el) => {
    if (el.parentNode === host) host.removeChild(el);
  });
  return items;
}

function buildSelectedItemMenuSubmenu(summary) {
  const items = selectedItemMenuSectionItems(summary);
  if (!items) return null;
  return createDropdownMenuSubmenu(summary.label, items);
}

// The bold heading at the top of the app menu. Not a button, so
// numberedMenuOptionsForPanel skips it and it can never take the cursor.
function buildAppMenuTitleElement(summary) {
  const el = document.createElement("div");
  el.className = "dropdownMenuTitle";
  el.setAttribute("aria-hidden", "true");
  el.textContent = summary.title;
  return el;
}

// The top-level sections of the app menu each carry an icon left of the name.
// Applied here, where the list is assembled, rather than in each builder, so a
// section's label is the single thing that decides its icon.
const APP_MENU_SECTION_ICON_KEYS = Object.freeze({
  "Jump to...": "menuJumpTo",
  Basics: "menuBasics",
  Filters: "menuFilters",
  Appearance: "menuAppearance",
  Thumbnails: "luImage",
  "Display names": "luType",
  History: "menuHistory",
  Controls: "menuControls",
  Lock: "menuPasscode",
  Experimental: "luFlaskConical",
  Music: "luMusic",
  "Export logs": "menuMetadata",
  "Export journal": "menuJournal",
  "Refresh App": "menuRefresh",
});

function withAppMenuSectionIcon(item) {
  return withMenuItemIcon(item, (label) => APP_MENU_SECTION_ICON_KEYS[label]);
}

/* The select menu's first page gets the same treatment. Most rows are matched
   by label; the red removal row is matched by what it does, because its label
   names the selection ("Delete album", "Move 3 folders to trash"). */
const SELECT_MENU_ITEM_ICON_KEYS = Object.freeze({
  "Edit tags": "tag",
  Rename: "selectRename",
  "Tag options": "selectTagOptions",
  "Folder options": "selectTagOptions",
  "Send to storage": "storage",
  Overrides: "selectOverrides",
  Thumbnail: "selectThumbnail",
  Other: "selectOther",
  ALTs: "selectAlts",
  "Empty Trash": "selectTrash",
  "Remove from Trash": "selectTrashOff",
  "Remove from Storage": "storage",
});

function selectMenuItemIconKey(label, item) {
  const action = String(item?.getAttribute?.("data-action") || "");
  if (action === "move-to-trash" || action === "delete") return "selectTrash";
  return SELECT_MENU_ITEM_ICON_KEYS[label];
}

function withSelectMenuItemIcon(item) {
  withMenuItemIcon(item, selectMenuItemIconKey);
  decorateSelectMenuNestedIcons(item);
  return item;
}

/* Rows below the first page get icons too, keyed by the submenu they sit in
   rather than by label alone -- a Tag name under Add tag is a place, and "Random"
   means something only inside Thumbnail. Cycle rows read "Sort: Name", so only
   the part before the colon is matched. */
const SELECT_MENU_OVERRIDE_ICON_KEYS = Object.freeze({
  Sort: "listSort",
  Filters: "menuFilters",
  "Media type": "mediaType",
  "Set score is at least": "scoreFilter",
  "Model score is at least": "scoreFilter",
});

const SELECT_MENU_THUMBNAIL_OWN_ICON_KEYS = Object.freeze({
  Default: "selectThumbnail",
  Random: "thumbRandom",
  Shuffle: "thumbShuffle",
  Blank: "noItem",
});

const SELECT_MENU_NESTED_ICON_KEYS = Object.freeze({
  Overrides: SELECT_MENU_OVERRIDE_ICON_KEYS,
  "Edit tags": Object.freeze({
    "Add tag": "selectAddTo",
    "Add tag to all contents": "luTags",
    "Remove tag": "selectRemoveFrom",
  }),
  // Add tag: Create new, then every Tag by name.
  "Add tag": Object.freeze({ "Create new": "luPlus", "*": "tag" }),
  "Add tag to all contents": Object.freeze({ "Create new": "luPlus", "*": "tag" }),
  "Create new": Object.freeze({
    ...SELECT_MENU_OVERRIDE_ICON_KEYS,
    Exclusive: "tagExclusive",
    Create: "luCheck",
  }),
  "Folder options": Object.freeze({
    Rename: "selectRename",
    "Copy path": "luCopy",
    "Copy folder": "luFolders",
    Favorite: "favorite",
    Hidden: "hidden",
    Overrides: "selectOverrides",
    Thumbnail: "selectThumbnail",
    "Reverse file order": "luArrowDownUp",
    "Reset order": "luRotateCcw",
    Index: "luFileSearch",
    "Merge folders": "luMerge",
  }),
  "Tag options": Object.freeze({
    Rename: "selectRename",
    Exclusive: "tagExclusive",
    Hidden: "hidden",
    "Create inverse": "tagInverse",
    Overrides: "selectOverrides",
  }),
  Other: Object.freeze({
    Index: "luFileSearch",
    "Reverse file order": "luArrowDownUp",
    "Reset order": "luRotateCcw",
  }),
  ALTs: Object.freeze({ "*": "luLayers" }),
  Thumbnail: Object.freeze({
    ...SELECT_MENU_THUMBNAIL_OWN_ICON_KEYS,
    // A container's own settings sit under one of these tabs, above the list
    // of places its picture can be handed up to.
    "This folder": "folder",
    "This tag": "tag",
  }),
  "This folder": SELECT_MENU_THUMBNAIL_OWN_ICON_KEYS,
  "This tag": SELECT_MENU_THUMBNAIL_OWN_ICON_KEYS,
});

// A file's Thumbnail submenu lists every place the file sits in; each row is
// marked with that place's own icon, read off the action it runs.
function thumbnailTargetPlaceIconKey(item) {
  const action = String(item?.getAttribute?.("data-action") || "");
  if (action.startsWith("set-folder-thumbnail-target:")) return "folder";
  if (!action.startsWith("set-tag-thumbnail:")) return "";
  let key = "";
  try {
    key = decodeURIComponent(action.slice("set-tag-thumbnail:".length));
  } catch {
    key = "";
  }
  return key.startsWith("special:favorites") ? "favorite" : "tag";
}

function selectMenuNestedIconKey(
  panelLabel,
  label,
  item,
  map = SELECT_MENU_NESTED_ICON_KEYS,
) {
  // A submenu whose trigger is a cycle row ("Preset: Default") is keyed by the
  // part before the colon, like the rows themselves.
  const keys = map[panelLabel] || map[String(panelLabel || "").split(":")[0].trim()];
  if (!keys) return "";
  if (panelLabel === "Thumbnail") {
    const place = thumbnailTargetPlaceIconKey(item);
    if (place) return place;
  }
  // "*" is for panels whose rows are named by the user (ALT labels): one icon
  // for every row, so the toggle state still has somewhere to show.
  return keys[String(label || "").split(":")[0].trim()] || keys["*"] || "";
}

function decorateSelectMenuNestedIcons(item, map = SELECT_MENU_NESTED_ICON_KEYS) {
  if (!item?.classList?.contains("dropdownMenuSubmenu")) return;
  const trigger = item.querySelector(":scope > .dropdownMenuSubmenuTrigger");
  const panel = item.querySelector(":scope > .dropdownMenuSubmenuPanel");
  if (!trigger || !panel) return;
  const labelEl =
    trigger.querySelector(".dropdownMenuSubmenuLabelWithIcon > span:last-child") ||
    trigger.querySelector(":scope > span:first-child");
  const panelLabel = String(labelEl?.textContent || "").trim();
  Array.from(panel.children).forEach((child) => {
    // Rows with their own multi-part layout take their icon where they are
    // built (buildAppMenuFilterControlButton); rewriting them here would
    // flatten the layout.
    if (child.classList?.contains("appMenuFilterControl")) return;
    withMenuItemIcon(child, (label, el) =>
      selectMenuNestedIconKey(panelLabel, label, el, map),
    );
    decorateSelectMenuNestedIcons(child, map);
  });
}

/* The settings menu's own nested rows, keyed the same way: by the submenu
   they sit in, then by label (the part before a colon for cycle rows).
   Controls, Jump to... and Stats are left out on purpose -- their rows are
   built with their own layout and carry their own marks. */
const APP_MENU_NESTED_ICON_KEYS = Object.freeze({
  Filters: Object.freeze({
    Preset: "luPalette",
    "Animated filters": "luSparkles",
  }),
  Preset: Object.freeze({
    Update: "luSave",
    "Create new preset": "luPlus",
    "Revert changes": "luUndo2",
    Rename: "selectRename",
    Delete: "selectTrash",
    "Confirm delete": "selectTrash",
  }),
  Appearance: Object.freeze({
    Theme: "luSunMoon",
    "Theme color": "luPalette",
    "Accent color": "luScan",
    "Top bar": "luAppWindow",
    "Bubble diffusion": "luCloudFog",
    "Bubble tint": "luPaintbrush",
    "Float tags": "luTags",
    "Float utility containers": "luPanelTop",
  }),
  "Display names": Object.freeze({
    "Show file names": "luCaseSensitive",
    "Force title caps": "luCaseUpper",
    "Position number prefixes": "luListOrdered",
    "Trim before last dash": "luScissors",
    "Hide file extensions": "luFileMinus",
  }),
  Thumbnails: Object.freeze({
    "Media thumbnails": "luImage",
    "Thumbnail size": "luScaling",
    "Full resolution": "luMaximize",
    "Icon placement": "luMove",
    "Score placement": "luListOrdered",
  }),
  Experimental: Object.freeze({
    "Thumbnail edits": "luCrop",
    "Default thumbnails only": "luRotateCcw",
    "Sidebar settings menu": "luPanelLeft",
    "Sidebar select menu": "luPanelRight",
    "Menu placement": "luMove",
    "Select Menu": "luSquareMenu",
    "Folder names": "luPanelBottom",
    "Opening media": "luMaximize",
    "Thumbnail isn't the first file": "luBlend",
  }),
  "Select Menu": Object.freeze({
    "Menu distance": "luMoveHorizontal",
    "Menu height": "luMoveVertical",
  }),
  Music: Object.freeze({
    Play: "luPlay",
    Pause: "luPause",
    "Next song": "luSkipForward",
    "Previous song": "luSkipBack",
    Shuffle: "luShuffle",
    "Repeat song": "luRepeat1",
    Songs: "luListOrdered",
  }),
  Songs: Object.freeze({
    "*": "luMusic",
  }),
  History: Object.freeze({
    Stats: "luChartColumn",
    Calendar: "luCalendarDays",
    Journal: "luNotebookPen",
  }),
  Calendar: Object.freeze({
    "Open in journal": "luNotebookPen",
    "Delete this day": "selectTrash",
    "Confirm delete": "selectTrash",
  }),
  Lock: Object.freeze({
    "Turn lock on": "luFingerprint",
    "Lock now": "tagExclusive",
    "Turn lock off": "luLockOpen",
    "Hide gallery folder": "luEyeOff",
  }),
  "Add items": Object.freeze({
    "Add folders...": "folder",
    "Add files...": "file",
  }),
});

const APP_MENU_FILTER_CONTROL_ICON_KEYS = Object.freeze({
  Brightness: "luSun",
  Contrast: "luContrast",
  Saturation: "luDroplet",
  Temperature: "luThermometer",
  "Hue shift": "luRainbow",
  "Black crush": "luMoon",
  "White crush": "luSunDim",
  "Color crush": "luPaintBucket",
  Pixelation: "luGrid3x3",
  Blur: "luAperture",
  "Chromatic aberration": "luBlend",
  Grain: "luCircleDotDashed",
  Vignette: "luScan",
  "Film corners": "luFilm",
});

function withAppMenuNestedIcons(item) {
  decorateSelectMenuNestedIcons(item, APP_MENU_NESTED_ICON_KEYS);
  return item;
}
