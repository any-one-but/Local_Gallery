/* Folder cards
   makeFolderPreviewCard. */

function getDirRecursiveSizeBytesForNode(dirNode, memo = null) {
  if (!dirNode) return 0;
  const path = String(dirNode.path || "");
  if (memo && memo.has(path)) return memo.get(path) || 0;
  if (
    ensureDirectoryDerivedIndex() &&
    Number.isFinite(Number(dirNode.recursiveSizeBytes))
  ) {
    const size = Math.max(0, Number(dirNode.recursiveSizeBytes) || 0);
    if (memo) memo.set(path, size);
    return size;
  }
  let size = 0;
  const fileIds = Array.isArray(dirNode.childrenFiles)
    ? dirNode.childrenFiles
    : [];
  for (let i = 0; i < fileIds.length; i++) {
    const rec = WS.fileById.get(fileIds[i]);
    const fileSize = Number(rec && rec.size);
    if (Number.isFinite(fileSize) && fileSize > 0) size += fileSize;
  }
  const dirs = Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [];
  for (let i = 0; i < dirs.length; i++) {
    size += getDirRecursiveSizeBytesForNode(dirs[i], memo);
  }
  if (memo) memo.set(path, size);
  return size;
}

function makeFolderPreviewCard(dirNode, sizeMemo = null, displayPosition = null) {
  if (isTrashRootPortalNode(dirNode)) {
    const card = document.createElement("div");
    const p = String(dirNode?.path || "");
    const nm = dirUiLabel(dirNode);
    card.className = "folderCard folderThumbCard";
    card.style.cursor = "default";
    card.__previewDirNode = dirNode || null;
    if (p) card.dataset.dirPath = p;
    if (p) card.dataset.previewItemKey = `dir:${p}`;
    card.dataset.previewItemKind = "dir";
    card.dataset.previewThumbKind = folderThumbnailKindForNode(dirNode);
    card.__previewOpenAction = () => {
      navigateFromPreviewFolderCard(dirNode);
    };

    const fallback = document.createElement("div");
    fallback.className =
      "folderThumb folderThumbFallback systemPortalThumbFallback";
    setAppIcon(fallback, "trash");
    card.appendChild(fallback);

    const meta = document.createElement("div");
    meta.className = "metaBlock compact";
    const top = document.createElement("div");
    top.className = "topLine";
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = nm;
    name.title = nm;
    top.appendChild(name);
    const menuWrap = document.createElement("div");
    menuWrap.className = "dirMenu";
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    configureThumbnailMenuButton(
      menuBtn,
      "Trash menu",
      null,
      false,
      "",
      null,
      FAVORITE_MENU_BUTTON_DISPLAY_ICON,
      formatSystemPortalItemCountLabel(internalTrashTopLevelItemCount()),
    );
    const openPreviewFolderMenu = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      openPreviewFolderActionMenu(dirNode, { anchor: menuBtn });
    };
    menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    menuBtn.addEventListener("click", (e) => openPreviewFolderMenu(e));
    menuBtn.addEventListener("contextmenu", (e) => openPreviewFolderMenu(e));
    menuWrap.appendChild(menuBtn);
    top.appendChild(menuWrap);
    meta.appendChild(top);
    card.appendChild(meta);

    card.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target && target.closest && target.closest(".dirMenu")) return;
      handlePreviewCardSelection(card, card.__previewOpenAction, e);
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPreviewFolderActionMenu(dirNode, { anchor: card });
    });
    return card;
  }
  if (isStorageStubDirNode(dirNode)) {
    const card = document.createElement("div");
    const p = String(dirNode?.path || "");
    const nm = dirUiLabel(dirNode);
    card.className = "folderCard folderThumbCard";
    card.style.cursor = "default";
    card.__previewDirNode = dirNode || null;
    if (p) card.dataset.dirPath = p;
    if (p) card.dataset.previewItemKey = `dir:${p}`;
    card.dataset.previewItemKind = "dir";
    card.dataset.previewThumbKind = folderThumbnailKindForNode(dirNode);
    card.__previewOpenAction = () => {
      showStatusMessage("Storage folders cannot be opened until you remove them from storage.");
    };
    // The one thing loaded for a stored folder is its picture; until it
    // arrives (or if there is none) the slot shows the storage icon.
    const thumbSlot = document.createElement("div");
    thumbSlot.className = "folderThumb folderThumbFallback";
    setAppIcon(thumbSlot, "storage");
    card.appendChild(thumbSlot);
    card.classList.add("folderThumbCoverCard");
    card.dataset.thumbMode = "cover";
    mountStorageStubThumb(card, thumbSlot, p, nm);
    const meta = document.createElement("div");
    meta.className = "metaBlock compact thumbOverlayMeta";
    forcePreviewPaneThumbTitleBar(meta);
    const top = document.createElement("div");
    top.className = "topLine thumbOverlayTopLine";
    const name = document.createElement("div");
    name.className = "name";
    name.style.whiteSpace = "normal";
    name.style.overflow = "visible";
    name.style.textOverflow = "clip";
    name.style.overflowWrap = "anywhere";
    name.style.wordBreak = "break-word";
    setThumbnailTitle(name, "storage", nm);
    name.title = nm;
    top.appendChild(name);
    const menuWrap = document.createElement("div");
    menuWrap.className = "dirMenu";
    const menuBtn = document.createElement("button");
    menuBtn.type = "button";
    configureThumbnailMenuButton(menuBtn, "Folder menu");
    const openPreviewFolderMenu = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      openPreviewFolderActionMenu(dirNode, { anchor: menuBtn });
    };
    menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    menuBtn.addEventListener("click", (e) => openPreviewFolderMenu(e));
    menuBtn.addEventListener("contextmenu", (e) => openPreviewFolderMenu(e));
    menuWrap.appendChild(menuBtn);
    top.appendChild(menuWrap);
    meta.appendChild(top);
    card.appendChild(meta);
    // Storage stubs cannot be opened, but they must stay selectable — plain,
    // Cmd/Ctrl, and Shift clicks all route through the shared selection
    // handler so removing one or many folders from Storage still works here.
    const canBulkSelect = WS.view.bulkSelectMode && canUseBulkSelection();
    if (
      isGridInteractionMode() &&
      !!p &&
      canBulkSelect &&
      WS.view.bulkTagSelectedPaths.has(p)
    ) {
      card.classList.add("bulkSelected");
    }
    card.addEventListener("click", (e) => {
      if (e.defaultPrevented) return;
      const target = e.target;
      if (target && target.closest && target.closest(".dirMenu")) return;
      handlePreviewCardSelection(card, card.__previewOpenAction, e);
    });
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openPreviewFolderActionMenu(dirNode, { anchor: card });
    });
    return card;
  }
  const visibility = previewThumbnailVisibilityForDirNode(dirNode);
  const showFolderCount = visibility.showFolderCount;
  const showFileCount = visibility.showFileCount;
  const showSize = visibility.showSize;
  const showItemTypeLabel = visibility.showItemTypeLabel;
  const card = document.createElement("div");
  card.className = "folderCard";
  if (dirNode && dirNode.isMissingPlaceholder) {
    card.classList.add("missingAltPlaceholder");
  }
  card.style.cursor = "default";
  const iconKey = iconKeyForDirNode(dirNode);
  const nm = prefixDisplayLabelWithPosition(
    dirUiLabel(dirNode),
    displayPosition,
  );
  const p = String(dirNode?.path || "");
  card.__previewDirNode = dirNode || null;
  if (p) card.dataset.dirPath = p;
  if (p) card.dataset.previewItemKey = `dir:${p}`;
  card.dataset.previewItemKind = "dir";
  card.dataset.previewThumbKind = folderThumbnailKindForNode(dirNode);
  card.__previewOpenAction = () => {
    navigateFromPreviewFolderCard(dirNode);
  };
  const canBulkSelect = WS.view.bulkSelectMode && canUseBulkSelection();
  const isBulkSelected =
    !!p && canBulkSelect && WS.view.bulkTagSelectedPaths.has(p);
  if (isGridInteractionMode()) {
    if (isBulkSelected) card.classList.add("bulkSelected");
  }
  const lightweightFolderThumb =
    shouldUseLightweightTagAlbumThumbnailsForNode(dirNode) &&
    !folderPreviewMediaThumbnailsEnabled();
  const sc = metaGetScore(dirNode?.path || "");
  const scoreMode = "hidden";
  const isFavorite = metaHasFavorite(p);
  const isHidden = metaHasHidden(p);
  const totalFolderCount = lightweightFolderThumb
    ? 0
    : getDirectFolderCountForNode(dirNode);
  const totalFileCount = lightweightFolderThumb
    ? 0
    : getRecursiveFileCountForNode(dirNode);
  const totalSizeBytes = lightweightFolderThumb
    ? 0
    : getDirRecursiveSizeBytesForNode(dirNode, sizeMemo);
  const folderSummaryParts = [];
  if (showItemTypeLabel)
    folderSummaryParts.push(folderItemTypeLabelForNode(dirNode));
  if (!lightweightFolderThumb && showFolderCount && showFileCount)
    folderSummaryParts.push(
      formatFolderFileCountSegment(totalFolderCount, totalFileCount),
    );
  else if (!lightweightFolderThumb && showFolderCount)
    folderSummaryParts.push(`${totalFolderCount} ${totalFolderCount === 1 ? "Folder" : "Folders"}`);
  else if (!lightweightFolderThumb && showFileCount)
    folderSummaryParts.push(`${totalFileCount} ${totalFileCount === 1 ? "File" : "Files"}`);
  if (!lightweightFolderThumb && showSize)
    folderSummaryParts.push(formatBytes(totalSizeBytes));
  const thumbMode = folderPreviewThumbMode();
  const thumbAspectMode = thumbMode === "aspect";
  const thumbContainMode =
    thumbAspectMode ||
    thumbMode === "contain" ||
    thumbMode === "contain-no-name";
  const thumbCoverMode = thumbMode === "cover" || thumbMode === "cover-no-name";
  const thumbOverlayMode = thumbCoverMode || thumbAspectMode;
  const hideNameInMeta =
    thumbMode === "cover-no-name" || thumbMode === "contain-no-name";
  const showThumbMeta = thumbMode !== "off";
  const isRenameEditing =
    RENAME_EDIT_PATH !== null && String(RENAME_EDIT_PATH) === p;
  const isTagEditing =
    TAG_EDIT_IN_PREVIEW && TAG_EDIT_PATH !== null && String(TAG_EDIT_PATH) === p;
  const leadInfo =
    thumbMode !== "off" && !lightweightFolderThumb
      ? getDisplayLeadPreviewForDir(dirNode, "preview-dir")
      : { record: null, rotateKey: "" };
  const leadRec = leadInfo.record;
  const rotateKey = leadInfo.rotateKey;
  const voteSeg = ``;
  const countSeg = folderSummaryParts.length
    ? `<div class="meta">${folderSummaryParts.join(" • ")}</div>`
    : "";
  if (showThumbMeta) {
    // A thumbnail is expected when the folder actually contains media; until the
    // lead thumbnail resolves we render a calm pending slot rather than flashing
    // the folder/type icon (see the fallback branches below).
    const folderExpectsThumb =
      mediaThumbnailsEnabled() &&
      getRecursiveFileCountForNode(dirNode) > 0;
    card.classList.add("folderThumbCard");
    card.dataset.thumbMode = thumbMode;
    if (thumbOverlayMode) card.classList.add("folderThumbCoverCard");
    if (thumbContainMode) {
      const fallbackAspect = 1;
      const initialAspect = leadRec
        ? getPreviewAspectForRecord(leadRec)
        : fallbackAspect;
      card.classList.add("fitInsideCard");
      card.dataset.aspect = String(
        normalizePreviewAspect(initialAspect, fallbackAspect),
      );
    }
    if (thumbAspectMode) card.classList.add("previewNaturalCard");
    if (leadRec) {
      const previewSrc = getPassivePreviewSrcForRecord(leadRec, {
        allowImageMediaFallback: true,
      });
      if (previewSrc) {
        const thumb = document.createElement("img");
        thumb.className = "folderThumb";
        thumb.loading = "lazy";
        thumb.decoding = "async";
        thumb.draggable = false;
        thumb.alt = nm;
        thumb.dataset.dirPreviewId = String(leadRec.id || "");
        thumb.style.objectFit = thumbAspectMode
          ? "cover"
          : thumbContainMode
            ? "contain"
            : "cover";
        registerThumbEl(thumb, previewSrc, { kind: "img" });
        if (thumbContainMode) {
          thumb.addEventListener("load", () => {
            const w = Number(thumb.naturalWidth) || 0;
            const h = Number(thumb.naturalHeight) || 0;
            if (w > 0 && h > 0) {
              const aspect = normalizePreviewAspect(
                w / h,
                getPreviewAspectForRecord(leadRec),
              );
              leadRec.previewAspect = aspect;
              card.dataset.aspect = String(aspect);
              const grid = card.parentElement;
              if (grid && grid.classList.contains("fitInsideJustified")) {
                requestAnimationFrame(() =>
                  applyFitInsideJustifiedLayout(grid),
                );
              }
            }
          });
        }
        if (rotateKey) thumb.setAttribute("data-rotate-key", rotateKey);
        const cropStyle = fileThumbCropLayoutStyle(leadRec, rotateKey);
        if (cropStyle) {
          thumb.classList.add("thumbCropApplied", "thumbCropAbsolute");
          thumb.style.cssText += cropStyle;
          if (!rotateKey) attachFileThumbCropAspectReapply(thumb, leadRec);
        }
        card.appendChild(thumb);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "folderThumb folderThumbFallback";
        // Lead record resolved but its media URL isn't ready yet: show a calm
        // pending slot instead of the type icon so it doesn't flash.
        if (folderExpectsThumb) fallback.classList.add("thumbIconPending");
        else setAppIcon(fallback, iconKeyForRecordType(leadRec.type));
        card.appendChild(fallback);
      }
    } else {
      const fallback = document.createElement("div");
      fallback.className = "folderThumb folderThumbFallback";
      // No lead record. The lookup above is synchronous and nothing fills the
      // slot in later, so a pending slot here would stay empty for good: show
      // the card as the Blank thumbnail setting does.
      setAppIcon(fallback, iconKey);
      card.appendChild(fallback);
    }
    const meta = document.createElement("div");
    meta.className = thumbOverlayMode
      ? "metaBlock compact thumbOverlayMeta"
      : "metaBlock compact";
    if (thumbOverlayMode) forcePreviewPaneThumbTitleBar(meta);
    const showPreviewFolderMenuBtn =
      visibility.showMenuButton && !folderNodeHasNoItemMenu(dirNode);
    let menuWrap = null;
    if (showPreviewFolderMenuBtn) {
      menuWrap = document.createElement("div");
      menuWrap.className = "dirMenu thumbOverlayMenu";
      const menuBtn = document.createElement("button");
      menuBtn.type = "button";
      configureThumbnailMenuButton(
        menuBtn,
        "Folder menu",
        sc,
        isFavorite,
        "thumbOverlayMenuBtn previewThumbOverlayMenuBtn",
        null,
        FAVORITE_MENU_BUTTON_DISPLAY_TINT,
      );
      const openPreviewFolderMenu = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        openPreviewFolderActionMenu(dirNode, { anchor: menuBtn });
      };
      menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      menuBtn.addEventListener("click", (e) => {
        openPreviewFolderMenu(e);
      });
      menuBtn.addEventListener("contextmenu", (e) => {
        openPreviewFolderMenu(e);
      });
      menuWrap.appendChild(menuBtn);
    }

    const top = document.createElement("div");
    top.className = thumbOverlayMode
      ? "topLine thumbOverlayTopLine"
      : "topLine";
    const showFolderThumbnailTitle =
      visibility.showTitle || isRenameEditing || isTagEditing;
    const showStatusIcons = false;
    // The title always gets its own row -- there is no longer an "inline with
    // the badge" variant to fall into.
    if (
      !hideNameInMeta &&
      showFolderThumbnailTitle &&
      !isRenameEditing &&
      !isTagEditing
    ) {
      const name = document.createElement("div");
      name.className = "name";
      setThumbnailTitle(name, iconKey, nm, { hidden: isHidden });
      name.title = nm;
      top.appendChild(name);
    } else if (isRenameEditing) {
      const renameInput = document.createElement("input");
      renameInput.type = "text";
      renameInput.className =
        "tagEditInput renameEditInput previewFolderRenameInput";
      renameInput.value = String(dirNode?.name || "");
      renameInput.placeholder = "folder name";
      top.appendChild(renameInput);
    } else if (isTagEditing) {
      const tagInput = document.createElement("input");
      tagInput.type = "text";
      tagInput.className = "tagEditInput previewFolderTagInput";
      tagInput.value = metaGetUserTags(p).join(", ");
      tagInput.placeholder = "tag1, tag2";
      top.appendChild(tagInput);
    }
    // Same fixed two rows as the file cards: title row, then badge row. The
    // compact/inline collapse and the folder summary line are gone -- a folder
    // card and a file card in the same grid have to be the same shape, and the
    // summary was info text, which the strip no longer carries.
    const menuOnlyOverlayMeta =
      thumbOverlayMode &&
      !isRenameEditing &&
      !isTagEditing &&
      !showFolderThumbnailTitle;
    if (menuOnlyOverlayMeta) {
      meta.classList.add("thumbOverlayMetaMenuOnly");
      forcePreviewPaneThumbTitleBar(meta);
    }
    if (top.childNodes.length) meta.appendChild(top);

    const bottom = document.createElement("div");
    bottom.className = thumbOverlayMode
      ? "thumbOverlayBottomLine"
      : "metaBottomLine";
    if (thumbOverlayMode) {
      const rightMeta = document.createElement("div");
      rightMeta.className = "thumbOverlayRightMeta";
      if (menuWrap) rightMeta.appendChild(menuWrap);
      if (rightMeta.childNodes.length) bottom.appendChild(rightMeta);
    } else {
      if (menuWrap) bottom.appendChild(menuWrap);
    }
    if (bottom.childNodes.length) meta.appendChild(bottom);
    if (meta.childNodes.length) card.appendChild(meta);
  } else {
    card.innerHTML = `
          <div class="left">
            <div class="icon">${appIconHtml(iconKey)}</div>
            ${visibility.showTitle ? `<div class="name" title="${escapeHtml(nm)}">${escapeHtml(nm)}</div>` : ``}
          </div>
          <div class="folderRight">
            ${voteSeg}
            ${countSeg}
          </div>
        `;
  }
  const up = card.querySelector(".voteBtn.up");
  const down = card.querySelector(".voteBtn.down");
  if (up)
    up.addEventListener("click", (e) => {
      e.stopPropagation();
      metaBumpScore(dirNode?.path || "", 1);
    });
  if (down)
    down.addEventListener("click", (e) => {
      e.stopPropagation();
      metaBumpScore(dirNode?.path || "", -1);
    });
  const renameInput = card.querySelector(".previewFolderRenameInput");
  if (renameInput) {
    let commitRequested = false;
    renameInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    renameInput.addEventListener("keydown", async (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        RENAME_EDIT_PATH = null;
        PREVIEW_BULK_TAG_EDIT = null;
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (commitRequested) return;
        commitRequested = true;
        await commitRenameEdit(p, renameInput);
      }
    });
    renameInput.addEventListener("blur", () => {
      if (commitRequested || RENAME_BUSY) return;
      RENAME_EDIT_PATH = null;
      PREVIEW_BULK_TAG_EDIT = null;
      closeActionMenus();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    });
  }
  const tagInput = card.querySelector(".previewFolderTagInput");
  if (tagInput) {
    let commitRequested = false;
    tagInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    tagInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        TAG_EDIT_PATH = null;
        PREVIEW_BULK_TAG_EDIT = null;
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const tags = normalizeTagsFromText(tagInput.value || "");
        if (!tags.length) {
          showStatusMessage("Tag name cannot be empty.");
          return;
        }
        commitRequested = true;
        metaSetUserTags(p, tags);
      }
    });
    tagInput.addEventListener("blur", () => {
      if (commitRequested) {
        commitRequested = false;
        return;
      }
      TAG_EDIT_PATH = null;
      PREVIEW_BULK_TAG_EDIT = null;
      closeActionMenus();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    });
  }
  card.addEventListener("click", (e) => {
    if (e.defaultPrevented) return;
    const target = e.target;
    if (target && target.closest && target.closest(".dirMenu")) return;
    if (target && target.closest && target.closest(".tagEditInput")) return;
    handlePreviewCardSelection(card, card.__previewOpenAction, e);
  });
  card.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openPreviewFolderActionMenu(dirNode, { anchor: card });
  });
  return card;
}
