/* Directories pane render
   renderDirectoriesPane. */

function renderDirectoriesPane(keepScroll = false, opts = null) {
  const suppressSelectionReveal = !!(opts && opts.suppressSelectionReveal);
  syncThumbFilterKeyWithCurrentAppearanceContext();
  // Preview-only UI: the file pane is permanently closed. Rebuilding its full
  // DOM on every folder open/close was pure overhead (~thousands of nodes) and
  // the main reason navigation still felt sluggish after earlier speed work.
  if (!directoriesPaneOpenEnabled()) {
    try {
      updateTitleLabel();
    } catch {}
    LAST_DIRECTORIES_SCROLL_CONTEXT = directoriesScrollContextKey();
    return;
  }
  const nextContextKey = directoriesScrollContextKey();
  const contextChanged = nextContextKey !== LAST_DIRECTORIES_SCROLL_CONTEXT;
  const preserveScroll = !!keepScroll && !contextChanged;
  const prevScroll = preserveScroll ? directoriesListEl.scrollTop : 0;
  const gridModeActive = isGridInteractionMode();
  const prevFilesOnlyChromeMode = !!(
    document &&
    document.body &&
    document.body.classList.contains("directories-files-only")
  );
  const prevSelectedRowCenterOffset = (() => {
    const container = directoriesListEl;
    const prevSelected = directoriesListEl.querySelector(".dirRow.selected");
    if (!prevSelected) return null;
    const viewTop = container.scrollTop;
    const viewBottom = viewTop + container.clientHeight;
    const rowTop = prevSelected.offsetTop;
    const rowBottom = rowTop + prevSelected.offsetHeight;
    if (rowTop < viewTop || rowBottom > viewBottom) return null;
    return rowTop - viewTop + prevSelected.offsetHeight * 0.5;
  })();
  invalidateGridRowMetricsCache();
  releaseContainerThumbMedia(directoriesListEl);
  directoriesListEl.innerHTML = "";
  directoriesListEl.classList.toggle("gridModeList", gridModeActive);
  updateGridModeListTopInset();
  updateTitleLabel();
  const folderSquareCardMode = !!gridModeActive;
  const naturalThumbCards = naturalAspectThumbnailCardsEnabled();
  directoriesListEl.classList.toggle("naturalThumbCards", !!naturalThumbCards);
  if (gridModeActive) {
    applyGridModeCardSizing();
    scheduleGridModeCardSizing();
  } else {
    directoriesListEl.style.removeProperty("--grid-card-size");
    directoriesListEl.style.removeProperty("--grid-cols");
  }
  let dirSortMetrics = null;
  let dirSizeByPath = null;
  const getDirSizeByPathForRender = () => {
    if (!dirSortMetrics) dirSortMetrics = buildDirSortMetrics();
    if (!dirSizeByPath) dirSizeByPath = dirSortMetrics.sizeByPath || new Map();
    return dirSizeByPath;
  };
  const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
  const canReorderGridFileEntries =
    gridModeActive && canReorderFilesInCurrentDir();
  const visibleFileIdsForGridReorder = canReorderGridFileEntries
    ? Array.from(getVisibleFileIdsInEntries())
    : [];
  const selectedFilesInView = canBulk ? getSelectedFileIdsInCurrentView() : [];
  const selectedFilesInViewCount = selectedFilesInView.length;
  if (gridModeActive) setupDirectoriesGridFileDropZone(directoriesListEl);
  else finishDirectoriesGridFileDrag();
  renderDirectoriesTagsHeader();
  renderDirectoriesBulkHeader();
  renderDirectoriesActionHeader();

  const headerActive =
    !!WS.root &&
    ((directoriesTagsRowEl && directoriesTagsRowEl.style.display !== "none") ||
      (directoriesBulkRowEl && directoriesBulkRowEl.style.display !== "none"));
  const filesOnlyDirView =
    !!WS.root &&
    WS.nav.entries.length > 0 &&
    WS.nav.entries.every((entry) => entry && entry.kind === "file");
  const leadingTagEntries = !!(
    WS.nav.entries.length &&
    WS.nav.entries[0] &&
    WS.nav.entries[0].kind === "tag"
  );
  const spawnUnderControls = contextChanged && leadingTagEntries;
  const filesOnlyModeChanged = prevFilesOnlyChromeMode !== filesOnlyDirView;
  applyDirectoriesFilesOnlyChromeMode(
    gridModeActive ? false : filesOnlyDirView,
  );
  setDirectoriesHeaderActive(
    gridModeActive ? false : !filesOnlyDirView && headerActive,
  );

  if (!WS.root) {
    LAST_DIRECTORIES_SCROLL_CONTEXT = nextContextKey;
    applyDirectoriesFilesOnlyChromeMode(false);
    directoriesListEl.innerHTML = "";
    scheduleThumbnailDemandRefresh();
    return;
  }

  if (!WS.nav.entries.length) {
    LAST_DIRECTORIES_SCROLL_CONTEXT = nextContextKey;
    applyDirectoriesFilesOnlyChromeMode(false);
    let emptyMsg = "Empty directory.";
    if (isViewingTagFolder()) {
      if (WS.view.tagFolderActiveMode === "favorites")
        emptyMsg = "No favorite folders.";
      else if (WS.view.tagFolderActiveMode === "hidden")
        emptyMsg = "No hidden folders.";
      else if (WS.view.tagFolderActiveMode === "album") {
        const albumLabel = String(WS.view.tagFolderActiveAlbum || "");
        emptyMsg = albumLabel
          ? `No tags in album '${albumLabel}'.`
          : "No tags in this album.";
      } else {
        const tagLabel = String(WS.view.tagFolderActiveTag || "");
        emptyMsg = tagLabel
          ? `No folders tagged '${tagLabel}'.`
          : "No tagged folders.";
      }
    }
    directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">${escapeHtml(emptyMsg)}</div>`;
    renderDirectoriesActionHeader();
    scheduleThumbnailDemandRefresh();
    return;
  }

  let maxMetaLen = 10;
  const lightweightTagAlbumDirectoryMetrics =
    !tortoiseNavigationEnabled() &&
    isViewingPerformanceSensitiveTagAlbumFolder();
  if (!lightweightTagAlbumDirectoryMetrics) {
    for (let i = 0; i < WS.nav.entries.length; i++) {
      const entry = WS.nav.entries[i];
      if (entry && entry.kind === "dir") {
        const dirVisibility = directoriesThumbnailVisibilityForDirNode(
          entry.node,
        );
        if (dirVisibility.showFolderCount || dirVisibility.showFileCount) {
          const countText = buildDirFolderFileCountText(entry.node);
          if (countText.length > maxMetaLen) maxMetaLen = countText.length;
        }
        if (dirVisibility.showSize) {
          const sizeText = formatBytes(
            getDirSizeByPathForRender().get(String(entry.node?.path || "")) || 0,
          );
          if (sizeText.length > maxMetaLen) maxMetaLen = sizeText.length;
        }
      }
    }
  }
  try {
    directoriesListEl.style.setProperty("--dirMetaCh", String(maxMetaLen));
  } catch {}

  const frag = document.createDocumentFragment();
  const virtualizeDirectories = shouldVirtualizeDirectoriesPane(gridModeActive);
  const virtualMetrics = virtualizeDirectories
    ? measureDirectoriesVirtualMetrics(gridModeActive)
    : null;
  const virtualWindow = virtualizeDirectories
    ? computeDirectoriesVirtualWindow(
        WS.nav.entries.length,
        virtualMetrics,
        suppressSelectionReveal,
      )
    : null;
  const entryStart = virtualWindow
    ? Math.max(
        0,
        Math.min(WS.nav.entries.length, virtualWindow.startIndex),
      )
    : 0;
  const entryEndExclusive = virtualWindow
    ? Math.max(
        entryStart,
        Math.min(WS.nav.entries.length, virtualWindow.endIndexExclusive),
      )
    : WS.nav.entries.length;
  directoriesListEl.dataset.virtualized = virtualWindow ? "1" : "0";
  appendVirtualFlexSpacer(
    frag,
    virtualWindow ? virtualWindow.topSpacerHeight : 0,
    gridModeActive,
  );
  const searchResultsDirectCount = searchResultsVisibleInDirectoriesPane()
    ? Math.max(0, Number(WS.view.searchResultsDirectCount) || 0)
    : 0;
  const showSearchSpacer =
    searchResultsDirectCount > 0 &&
    searchResultsDirectCount <
      (Array.isArray(WS.view.searchResults) ? WS.view.searchResults.length : 0);
  const navDisplayPositions = displayPositionNumbersInNamesEnabled()
    ? buildDisplayPositionMapsForNavEntries(WS.nav.entries)
    : { dirPositions: new Map(), filePositions: new Map() };
  const floatSpacerBefore = makeFloatLayerSpacerGate();
  // A virtualized window starts part way down; the layers above it still count.
  for (let idx = 0; idx < entryStart; idx++)
    floatSpacerBefore(WS.nav.entries[idx]);
  let seenSearchResultDirCount = 0;
  for (let idx = entryStart; idx < entryEndExclusive; idx++) {
    const entry = WS.nav.entries[idx];
    if (
      showSearchSpacer &&
      entry &&
      entry.kind === "dir" &&
      seenSearchResultDirCount === searchResultsDirectCount
    ) {
      const spacerEl = document.createElement("div");
      spacerEl.className = "tagSpacerVisualRow searchResultsSpacerRow";
      spacerEl.setAttribute("aria-hidden", "true");
      spacerEl.innerHTML = `<div class="tagSpacerCell" aria-hidden="true"></div>`;
      frag.appendChild(spacerEl);
    }
    if (floatSpacerBefore(entry)) {
      const tagSpacerEl = document.createElement("div");
      tagSpacerEl.className = "tagSpacerVisualRow";
      tagSpacerEl.setAttribute("aria-hidden", "true");
      tagSpacerEl.innerHTML = `<div class="tagSpacerCell" aria-hidden="true"></div>`;
      frag.appendChild(tagSpacerEl);
    }

    const row = document.createElement("div");
    const showDirSel = !!(WS.view && WS.view.activePane === "directories");
    const isRowSelected = showDirSel && idx === WS.nav.selectedIndex;
    row.className = "dirRow" + (isRowSelected ? " selected" : "");
    row.tabIndex = -1;
    row.dataset.entryIndex = String(idx);
    if (entry.kind === "file") row.dataset.fileId = String(entry.id || "");
    if (entry && entry.kind === "dir") seenSearchResultDirCount++;

    const isTagEntry = entry.kind === "tag";
    if (isTagEntry) {
      row.__dirTagEntry = entry;
      row.classList.add("tagEntry");
      const selectionKey = tagEntrySelectionKey(entry);
      if (selectionKey) row.dataset.bulkAnchor = `tag:${selectionKey}`;
      const sel =
        canBulk &&
        selectionKey &&
        WS.view.bulkTagFolderSelectedKeys.has(selectionKey);
      if (sel) row.classList.add("bulkSelected");
    }

    const renameActive = isTagEntry && isTagEntryRenameActive(entry);
    if (isTagEntry) {
      const tagVisibility = directoriesThumbnailVisibilityForKind("tag");
      const label = String(entry.label || entry.tag || entry.album || entry.gallery || "Tag");
      const labelDisplay = displayTagFolderLabel(label);
      const countText = getTagEntryCountText(entry);
      const tagTypeLabel = tagItemTypeLabelForEntry(entry);
      const isHiddenTag = metaHasHiddenTagByKey(hiddenTagKeyForEntry(entry));
      const tagIconKey = getTagEntryIconKey(entry);
      const tagLockIcon = entry.special ? "" : tagLockIconKey(entry.tag);
      const iconHtml = itemTypeIconHtml(tagIconKey, isHiddenTag, tagLockIcon);
      const lightweightTagThumbs =
        !tortoiseNavigationEnabled() &&
        isViewingPerformanceSensitiveTagAlbumFolder();
      const tagMetrics = lightweightTagThumbs
        ? {
            folderCount: Math.max(0, Number(entry.count) || 0),
            fileCount: 0,
            sizeBytes: 0,
            score: 0,
          }
        : getTagEntryAggregateMetrics(entry);
      const tagSummaryBits = [];
      if (tagVisibility.showFolderCount && tagVisibility.showFileCount) tagSummaryBits.push(countText);
      else if (tagVisibility.showFolderCount)
        tagSummaryBits.push(`${tagMetrics.folderCount} ${tagMetrics.folderCount === 1 ? "Folder" : "Folders"}`);
      else if (tagVisibility.showFileCount)
        tagSummaryBits.push(`${tagMetrics.fileCount} ${tagMetrics.fileCount === 1 ? "File" : "Files"}`);
      if (tagVisibility.showSize)
        tagSummaryBits.push(formatBytes(tagMetrics.sizeBytes));
      const isStoragePortalEntry = entry.special === "storage";
      const tagThumbKey = tagThumbnailKeyForEntry(entry);
      const tagThumbMode = folderSquareCardMode
        ? isStoragePortalEntry || lightweightTagThumbs
          ? "none"
          : metaGetTagThumbnailModeByKey(tagThumbKey)
        : "none";
      const tagThumbIsRotating =
        folderSquareCardMode &&
        !isStoragePortalEntry &&
        !lightweightTagThumbs &&
        tagThumbnailUsesRotationByKey(tagThumbKey);
      const presetRec = folderSquareCardMode
        ? isStoragePortalEntry || lightweightTagThumbs
          ? null
          : getTagPresetPreviewRecordForEntry(entry)
        : null;
      const tagPool =
        folderSquareCardMode &&
        tagThumbMode !== "none" &&
        !presetRec &&
        !naturalThumbCards
          ? getRecursivePreviewRecordsForTagEntry(
              entry,
              tagThumbnailPreviewSampleLimit(
                tagThumbIsRotating ? "rotate" : tagThumbMode,
              ),
            )
          : [];
      const tagAllowsRotation =
        folderSquareCardMode &&
        !isStoragePortalEntry &&
        !lightweightTagThumbs &&
        !naturalThumbCards;
      const tagRotateScope = String(WS.nav.dirNode?.path || "");
      const tagRotateKey = entry.special
        ? `tag:${tagRotateScope}:special:${entry.special}`
        : entry.album && !entry.tag
          ? `tag:${tagRotateScope}:album:${String(entry.album || "")}`
          : entry.gallery && !entry.tag && !entry.album
            ? `tag:${tagRotateScope}:gallery:${String(entry.gallery || "")}`
          : `tag:${tagRotateScope}:name:${String(entry.tag || "")}`;
      let squareMediaHtml = isStoragePortalEntry
        ? `<div class="dirSquareFallback systemPortalThumbFallback">${appIconHtml("storage")}</div>`
        : `<div class="dirSquareFallback">${iconHtml}</div>`;
      if (tagThumbMode !== "none") {
        if (presetRec) {
          const previewId = String(presetRec.id || "");
          const previewSrc = getPassivePreviewSrcForRecord(presetRec, {
            allowImageMediaFallback: true,
          });
          const previewAspect = getPreviewAspectForRecord(presetRec);
          if (previewSrc) {
            const cropStyle = fileThumbCropLayoutStyle(presetRec, "");
            const cropClass = cropStyle
              ? " thumbCropApplied thumbCropAbsolute"
              : "";
            squareMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
          }
        } else if (tagThumbIsRotating && tagPool.length) {
          const rec = pickRotatingPreviewRecordForKey(tagRotateKey, tagPool);
          if (rec) {
            const previewId = String(rec.id || "");
            const previewSrc = getPassivePreviewSrcForRecord(rec, {
              allowImageMediaFallback: true,
            });
            const previewAspect = getPreviewAspectForRecord(rec);
            if (previewSrc) {
              squareMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-rotate-key="${escapeHtml(tagRotateKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
            }
          }
        } else if (tagThumbMode === "single" && tagPool.length) {
          const rec = tagPool[0] || null;
          if (rec) {
            const previewId = String(rec.id || "");
            const previewSrc = getPassivePreviewSrcForRecord(rec, {
              allowImageMediaFallback: true,
            });
            const previewAspect = getPreviewAspectForRecord(rec);
            if (previewSrc) {
              squareMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
            }
          }
        } else if (
          tagAllowsRotation &&
          tagThumbMode === "quad" &&
          tagPool.length
        ) {
          if (tagPool.length < 4) {
            const singleKey = `${tagRotateKey}:single-fallback`;
            const rec = pickRotatingPreviewRecordForKey(singleKey, tagPool);
            if (rec) {
              const previewId = String(rec.id || "");
              const previewSrc = getPassivePreviewSrcForRecord(rec, {
                allowImageMediaFallback: true,
              });
              const previewAspect = getPreviewAspectForRecord(rec);
              if (previewSrc) {
                squareMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-rotate-key="${escapeHtml(singleKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
              }
            }
          } else {
            const quadSlots = pickRotatingPreviewSlotsForKey(
              tagRotateKey,
              tagPool,
              4,
            );
            if (quadSlots.length) {
              const quadHtml = [];
              for (let i = 0; i < quadSlots.length; i++) {
                const slot = quadSlots[i];
                const rec = slot && slot.rec ? slot.rec : null;
                if (!rec) {
                  quadHtml.push(
                    `<div class="dirTagQuadCell"><div class="dirSquareFallback">${iconHtml}</div></div>`,
                  );
                  continue;
                }
                const previewId = String(rec.id || "");
                const previewSrc = getPassivePreviewSrcForRecord(rec, {
                  allowImageMediaFallback: true,
                });
                const previewAspect = getPreviewAspectForRecord(rec);
                if (!previewSrc) {
                  quadHtml.push(
                    `<div class="dirTagQuadCell"><div class="dirSquareFallback">${iconHtml}</div></div>`,
                  );
                  continue;
                }
                quadHtml.push(
                  `<div class="dirTagQuadCell"><img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagQuadThumb" data-rotate-key="${escapeHtml(String(slot.key || ""))}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" /></div>`,
                );
              }
              if (quadHtml.length) {
                squareMediaHtml = `<div class="dirTagQuadGrid">${quadHtml.join("")}</div>`;
              }
            }
          }
        }
      }
      const canOpenTagMenu = !entry.placeholder && !!tagThumbKey;
      const tagMenuCountLabel = isStoragePortalEntry
        ? formatSystemPortalItemCountLabel(entry.count)
        : "";
      const tagMenuHtml = tagVisibility.showMenuButton
        ? `
            <div class="dirMenu dirTagMenu">
              ${buildThumbnailMenuButtonHtml(
                "Tag menu",
                tagMetrics.score,
                false,
                "",
                !canOpenTagMenu,
                null,
                FAVORITE_MENU_BUTTON_DISPLAY_ICON,
                tagMenuCountLabel,
              )}
            </div>
          `
        : "";
      const tagTitleClass =
        entry.special === "favorites"
          ? "dirSquareNameTagFavorite"
          : entry.album && !entry.tag
            ? "dirSquareNameTagAlbum"
            : entry.gallery && !entry.tag && !entry.album
              ? "dirSquareNameTagAlbum"
            : "dirSquareNameTag";
      const showTagThumbnailTitle = true;
      const showTagTextMeta =
        !!tagSummaryBits.length ||
        tagVisibility.showItemTypeLabel;
      const menuOnlyTagSquareCard =
        !renameActive && !showTagThumbnailTitle && !showTagTextMeta;
      const inlineTagTitleCompact = false;
      const topNameHtml = renameActive
        ? `<input class="tagEditInput tagEntryRenameInput renameEditInput dirSquareRenameInput" type="text" value="${escapeHtml(TAG_ENTRY_RENAME_STATE.label || label)}" placeholder="${escapeHtml(label)}" />`
        : showTagThumbnailTitle && !inlineTagTitleCompact
          ? `<span class="dirSquareName ${tagTitleClass}" title="${escapeHtml(labelDisplay)}">${escapeHtml(labelDisplay)}</span>`
          : "";
      const typeBadgeHtml =
        !menuOnlyTagSquareCard && tagVisibility.showItemTypeLabel
          ? `<span class="dirTagKindBadge">${escapeHtml(tagTypeLabel)}</span>`
          : "";
      const scoreBadgeHtml = ``;
      const countMetaHtml = inlineTagTitleCompact
        ? `<span class="dirSquareName ${tagTitleClass} dirSquareNameInlineCompact" title="${escapeHtml(labelDisplay)}">${escapeHtml(labelDisplay)}</span>`
        : !menuOnlyTagSquareCard && tagSummaryBits.length
          ? `<div class="dirSquareMeta">${escapeHtml(tagSummaryBits.join(" • "))}</div>`
          : "";
      const tagCardStyle =
        naturalThumbCards && presetRec
          ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(presetRec)).toFixed(4)};"`
          : "";
      const compactTagSquareCard =
        !menuOnlyTagSquareCard &&
        (!showTagThumbnailTitle || inlineTagTitleCompact);

      row.classList.add("folderRow");
      if (folderSquareCardMode) {
        row.classList.add("folderSquareCard");
        row.innerHTML = `
		              <div class="dirSquareCard"${tagCardStyle}>
		                <div class="dirSquareMedia">${squareMediaHtml}</div>
		                <div class="dirSquareOverlay${compactTagSquareCard ? " dirSquareOverlayCompact" : ""}${menuOnlyTagSquareCard ? " dirSquareOverlayMenuOnly" : ""}">
                    ${isStoragePortalEntry ? "" : thumbnailTypeIconBubbleHtml(tagIconKey, isHiddenTag, tagLockIcon)}
		                  ${topNameHtml ? `<div class="dirSquareTop${compactTagSquareCard ? " dirSquareTopCompact" : ""}">${topNameHtml}</div>` : ""}
	                  <div class="dirSquareBottom${compactTagSquareCard ? " dirSquareBottomCompact" : ""}">
	                    ${countMetaHtml}
	                    <div class="dirSquareRightMeta">
	                      ${scoreBadgeHtml}
	                      ${typeBadgeHtml}
	                      ${tagMenuHtml}
                    </div>
                  </div>
                </div>
              </div>
            `;
      } else {
        const tagNameHtml = renameActive
          ? `<input class="tagEditInput tagEntryRenameInput renameEditInput" type="text" value="${escapeHtml(TAG_ENTRY_RENAME_STATE.label || label)}" placeholder="${escapeHtml(label)}" />`
          : `<span class="dirNameText ${tagTitleClass}" title="${escapeHtml(labelDisplay)}">${escapeHtml(labelDisplay)}</span>`;
        row.classList.add("folderBarCard", "tagBarCard");
        row.innerHTML = `
              <div class="dirIcon${isHiddenTag || tagLockIcon ? " dirIconHiddenBubble" : ""}">${iconHtml}</div>
              <div class="dirName">${tagNameHtml}</div>
              <div class="dirRight dirFolderActions">
                ${(() => {
                  const tagMetaParts = [];
                  if (tagVisibility.showItemTypeLabel)
                    tagMetaParts.push(tagTypeLabel);
                  if (tagVisibility.showFolderCount && tagVisibility.showFileCount)
                    tagMetaParts.push(countText);
                  else if (tagVisibility.showFolderCount)
                    tagMetaParts.push(`${tagMetrics.folderCount} ${tagMetrics.folderCount === 1 ? "Folder" : "Folders"}`);
                  else if (tagVisibility.showFileCount)
                    tagMetaParts.push(`${tagMetrics.fileCount} ${tagMetrics.fileCount === 1 ? "File" : "Files"}`);
                  if (tagVisibility.showSize)
                    tagMetaParts.push(formatBytes(tagMetrics.sizeBytes));
                  return tagMetaParts.length
                    ? `<div class="dirBarMetaText">${escapeHtml(tagMetaParts.join(" • "))}</div>`
                    : "";
                })()}
                ${tagMenuHtml}
              </div>
            `;
      }
    } else {
      row.dataset.bulkAnchor = `file:${String(entry.id || "")}`;
      const dirPath =
        entry.kind === "dir" ? String(entry?.node?.path || "") : "";
      const isRenameEditingDir =
        entry.kind === "dir" &&
        RENAME_EDIT_PATH !== null &&
        String(RENAME_EDIT_PATH) === dirPath;
      const isTagEditingDir =
        entry.kind === "dir" &&
        !TAG_EDIT_IN_PREVIEW &&
        TAG_EDIT_PATH !== null &&
        String(TAG_EDIT_PATH) === dirPath;
      let iconHtml = appIconHtml("folder");
      let name = "";
      let nameHtml = "";
      let voteHtml = "";
      let thumbHtml = "";
      let rightHtml = "";
      let fileMenuHtml = "";
      let folderSquareCardHtml = "";
      let rowIconHidden = false;

      if (entry.kind === "dir") {
        row.__dirNode = entry.node || null;
        const dirVisibility = directoriesThumbnailVisibilityForDirNode(
          entry.node,
        );
        row.dataset.dirPath = entry.node?.path || "";
        const p = entry.node?.path || "";
        const isTrashRootPortal = isTrashRootPortalNode(entry.node);
        const isStorageGhost = isStorageStubDirNode(entry.node);
        const fixedIconFolderThumb = isStorageGhost || isTrashRootPortal;
        const lightweightFolderThumb =
          shouldUseLightweightTagAlbumThumbnailsForNode(entry.node);
        row.dataset.bulkAnchor = `dir:${p}`;
        const isFavorite = !isStorageGhost && metaHasFavorite(p);
        const isHidden = !isStorageGhost && metaHasHidden(p);
        rowIconHidden = isHidden;
        const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
        if (sel) row.classList.add("bulkSelected");
        const canRename = !!WS.meta.fsRootHandle && !isStorageGhost;
        const canResetOrder = !!entry.node?.preserveOrder && !isStorageGhost;
        const dirIconKey = iconKeyForDirNode(entry.node);
        iconHtml = itemTypeIconHtml(dirIconKey, isHidden);
        name = prefixDisplayLabelWithPosition(
          dirUiLabel(entry.node),
          navDisplayPositions.dirPositions.get(String(p || "")),
        );
        const dirMetaLines = [];
        if (
          !isStorageGhost &&
          (dirVisibility.showFolderCount || dirVisibility.showFileCount)
        ) {
          const folderCount = getDirectFolderCountForNode(entry.node);
          const fileCount = getRecursiveFileCountForNode(entry.node);
          if (dirVisibility.showFolderCount && dirVisibility.showFileCount) {
            dirMetaLines.push(formatFolderFileCountSegment(folderCount, fileCount));
          } else if (dirVisibility.showFolderCount) {
            dirMetaLines.push(`${folderCount} ${folderCount === 1 ? "Folder" : "Folders"}`);
          } else if (dirVisibility.showFileCount) {
            dirMetaLines.push(`${fileCount} ${fileCount === 1 ? "File" : "Files"}`);
          }
        }
        if (!isStorageGhost && dirVisibility.showSize)
          dirMetaLines.push(
            formatBytes(getDirSizeByPathForRender().get(String(p || "")) || 0),
          );
        const statusBadgeHtml = "";
        let inlinePreviewHtml = "";
        let firstRec = null;
        let rotateKey = "";
        if (!fixedIconFolderThumb && !lightweightFolderThumb) {
          const leadInfo = getDisplayLeadPreviewForDir(entry.node, "dir");
          firstRec = leadInfo.record;
          rotateKey = leadInfo.rotateKey;
        }
        if (firstRec) {
          const previewId = String(firstRec.id || "");
          const previewSrc = getPassivePreviewSrcForRecord(firstRec, {
            allowImageMediaFallback: true,
          });
          const previewAspect = getPreviewAspectForRecord(firstRec);
          if (previewSrc) {
            const rotateAttr = rotateKey
              ? ` data-rotate-key="${escapeHtml(rotateKey)}"`
              : "";
            const cropStyle = fileThumbCropLayoutStyle(firstRec, rotateKey);
            const cropClass = cropStyle
              ? " thumbCropApplied thumbCropAbsolute"
              : "";
            inlinePreviewHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)}${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}"${rotateAttr} src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
          }
        }
        const sc = isStorageGhost ? 0 : metaGetScore(p);
        const isRootNode = entry.node === WS.root;
        const folderMenuState = buildFolderMenuState(entry.node);
        const canIndex = !!folderMenuState.canIndex;
        const menuPathKey = isRootNode ? "__root__" : p;
        const menuOpen = WS.view.dirActionMenuPath === menuPathKey;
        const folderMenuCountLabel = folderMenuState.isTrashRootPortal
          ? formatSystemPortalItemCountLabel(internalTrashTopLevelItemCount())
          : "";
        const folderThumbMode = isRootNode
          ? getRootThumbnailMode()
          : metaGetFolderThumbnailMode(p);
        const canToggleFolderThumbMode = !!entry.node && (isRootNode || !!p);
        const hasThumbPreset = isRootNode
          ? rootThumbnailHasPreset()
          : metaHasFolderThumbnailPreset(p);
        const showUseDefaultThumbnail =
          hasThumbPreset ||
          (isRootNode && !isRootThumbnailModeDefault(folderThumbMode)) ||
          (!isRootNode &&
            canToggleFolderThumbMode &&
            folderThumbMode !== inferFolderThumbnailDefaultMode(p));
        const showSetRotateThumbnail =
          canToggleFolderThumbMode &&
          !(isRootNode
            ? tagThumbnailUsesRotationByKey(rootThumbnailKey())
            : folderThumbMode === "rotate");
        const showSetNoThumbnail =
          canToggleFolderThumbMode && folderThumbMode !== "none";
        const showSetRandomThumbnail =
          canToggleFolderThumbMode &&
          !folderMenuState.isStorageGhost &&
          !!firstRecursiveThumbnailCandidateForDirNode(entry.node);
        const folderThumbnailMenuHtml = buildFolderThumbnailSubmenuHtml({
          showUseDefaultThumbnail,
          showSetRotateThumbnail,
          showSetNoThumbnail,
          showSetRandomThumbnail,
        });
        const folderMenuTarget = { kind: "dir", node: entry.node };
        const folderMenuInfoHtml = buildItemInfoDropdownHtml(folderMenuTarget);
        const folderMenuOverridesHtml = buildFolderOverridesSubmenuHtml(
          folderMenuTarget,
          folderMenuState,
        );
        const folderMenuAddToHtml = buildFolderAddToSubmenuHtml(folderMenuState);
        // Menu (three dot / ⋯) for single-folder actions.
        let menuButtons = "";
        let menuTitle = "Folder menu";
        if (folderMenuState.isTrashRootPortal) {
          const emptyTrashCount = internalTrashTopLevelItemCount();
          menuTitle = "Trash menu";
          menuButtons = `
                <button type="button" class="destructiveAction" data-action="empty-trash"${WS.meta.fsRootHandle && emptyTrashCount ? "" : " disabled"}>Empty Trash</button>
              `;
        } else if (isRootNode) {
          menuButtons = `
                ${folderMenuInfoHtml}
                ${folderMenuOverridesHtml}
                ${canIndex ? `<button type="button" data-action="index">Index</button>` : ``}
              `;
        } else {
          menuButtons = `
                ${folderMenuInfoHtml}
                ${folderMenuAddToHtml}
                <button type="button" data-action="rename"${canRename ? "" : " disabled"}>Rename</button>
                ${folderMenuState.canRemoveFromAlbum ? `<button type="button" data-action="remove-from-album">Remove from album</button>` : ``}
                ${folderMenuState.canRemoveFromGallery ? `<button type="button" data-action="remove-from-gallery">Remove from gallery</button>` : ``}
                ${folderMenuOverridesHtml}
                ${folderThumbnailMenuHtml}
                ${canIndex ? `<button type="button" data-action="index">Index</button>` : ``}
                ${canResetOrder ? `<button type="button" data-action="reset-order">Reset order</button>` : ``}
              `;
        }
        const menuHtml =
          !dirVisibility.showMenuButton
          ? ""
          : `
              <div class="dirMenu">
              ${buildThumbnailMenuButtonHtml(
                menuTitle,
                sc,
                isFavorite,
                "",
	                false,
	                null,
	                FAVORITE_MENU_BUTTON_DISPLAY_TINT,
	                folderMenuCountLabel,
	              )}
              <div class="dropdownMenu itemActionMenu${menuOpen ? " open" : ""}">
                ${menuButtons}
              </div>
            </div>
            `;
        const metaSummaryText = dirMetaLines.join(" • ");
        const nameStyle = isStorageGhost
          ? ` style="white-space:normal;overflow:visible;text-overflow:clip;overflow-wrap:anywhere;word-break:break-word;"`
          : "";
        nameHtml = `<span class="dirNameText"${nameStyle}>${escapeHtml(name)}</span>${statusBadgeHtml}`;
        thumbHtml = "";
        rightHtml = `
              <div class="dirRight dirFolderActions">
                ${metaSummaryText ? `<div class="dirBarMetaText">${escapeHtml(metaSummaryText)}</div>` : ""}
                ${menuHtml}
              </div>
            `;
        if (folderSquareCardMode) {
          const scoreInlineHtml = "";
          const isRootPortalCard =
            WS.view.aboveRootView && entry.node === WS.root;
          let squareAspectRec = firstRec || null;
          let rootPortalMediaHtml = "";
          if (isRootPortalCard) {
            const rootPool = getRecursivePreviewRecordsForDir(
              entry.node,
              PREVIEW_THUMB_PRIORITY_LIMIT,
              true,
            );
            const rootMode = getRootThumbnailMode();
            const rootThumbIsRotating = tagThumbnailUsesRotationByKey(
              rootThumbnailKey(),
            );
            const rootPresetRec = getRootPresetPreviewRecord(
              entry.node,
              rootPool,
            );
            const rootScope = String(WS.meta.storageKey || "workspace");
            if (rootMode !== "none") {
              if (rootPresetRec) {
                squareAspectRec = rootPresetRec;
                const previewId = String(rootPresetRec.id || "");
                const previewSrc = getPassivePreviewSrcForRecord(
                  rootPresetRec,
                  { allowImageMediaFallback: true },
                );
                const previewAspect = getPreviewAspectForRecord(rootPresetRec);
                if (previewSrc) {
                  const cropStyle = fileThumbCropLayoutStyle(rootPresetRec, "");
                  const cropClass = cropStyle
                    ? " thumbCropApplied thumbCropAbsolute"
                    : "";
                  rootPortalMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
                }
              } else if (rootThumbIsRotating && rootPool.length) {
                const rootRotateKey = `root:${rootScope}:rotate`;
                const rec = pickRotatingPreviewRecordForKey(
                  rootRotateKey,
                  rootPool,
                );
                if (rec) {
                  squareAspectRec = rec;
                  const previewId = String(rec.id || "");
                  const previewSrc = getPassivePreviewSrcForRecord(rec, {
                    allowImageMediaFallback: true,
                  });
                  const previewAspect = getPreviewAspectForRecord(rec);
                  if (previewSrc) {
                    rootPortalMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-rotate-key="${escapeHtml(rootRotateKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                  }
                }
              } else if (rootMode === "single" && rootPool.length) {
                const rec = rootPool[0] || null;
                if (rec) {
                  squareAspectRec = rec;
                  const previewId = String(rec.id || "");
                  const previewSrc = getPassivePreviewSrcForRecord(rec, {
                    allowImageMediaFallback: true,
                  });
                  const previewAspect = getPreviewAspectForRecord(rec);
                  if (previewSrc) {
                    rootPortalMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                  }
                }
              } else if (
                !naturalThumbCards &&
                rootMode === "quad" &&
                rootPool.length
              ) {
                if (rootPool.length < 4) {
                  const singleKey = `root:${rootScope}:single-fallback`;
                  const rec = pickRotatingPreviewRecordForKey(
                    singleKey,
                    rootPool,
                  );
                  if (rec) {
                    squareAspectRec = rec;
                    const previewId = String(rec.id || "");
                    const previewSrc = getPassivePreviewSrcForRecord(rec, {
                      allowImageMediaFallback: true,
                    });
                    const previewAspect = getPreviewAspectForRecord(rec);
                    if (previewSrc) {
                      rootPortalMediaHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-rotate-key="${escapeHtml(singleKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                    }
                  }
                } else {
                  const rootQuadKey = `root:${rootScope}:quad`;
                  const rootSlots = pickRotatingPreviewSlotsForKey(
                    rootQuadKey,
                    rootPool,
                    4,
                  );
                  if (rootSlots.length) {
                    const quadHtml = [];
                    for (let i = 0; i < rootSlots.length; i++) {
                      const slot = rootSlots[i];
                      const slotRec = slot && slot.rec ? slot.rec : null;
                      if (!slotRec) {
                        quadHtml.push(
                          `<div class="dirTagQuadCell"><div class="dirSquareFallback">${appIconHtml("folder")}</div></div>`,
                        );
                        continue;
                      }
                      const previewId = String(slotRec.id || "");
                      const previewSrc = getPassivePreviewSrcForRecord(
                        slotRec,
                        { allowImageMediaFallback: true },
                      );
                      const previewAspect = getPreviewAspectForRecord(slotRec);
                      if (!previewSrc) {
                        quadHtml.push(
                          `<div class="dirTagQuadCell"><div class="dirSquareFallback">${appIconHtml("folder")}</div></div>`,
                        );
                        continue;
                      }
                      if (!squareAspectRec) squareAspectRec = slotRec;
                      quadHtml.push(
                        `<div class="dirTagQuadCell"><img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagQuadThumb" data-rotate-key="${escapeHtml(String(slot.key || ""))}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" /></div>`,
                      );
                    }
                    if (quadHtml.length)
                      rootPortalMediaHtml = `<div class="dirTagQuadGrid">${quadHtml.join("")}</div>`;
                  }
                }
              }
            }
          }
          const squareMediaHtml =
            rootPortalMediaHtml ||
            inlinePreviewHtml ||
            `<div class="dirSquareFallback${isTrashRootPortal ? " systemPortalThumbFallback" : ""}">${iconHtml}</div>`;
          const squareCardStyle =
            naturalThumbCards && squareAspectRec
              ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(squareAspectRec)).toFixed(4)};"`
              : "";
          const metaSummary = dirMetaLines.join(" • ");
          const squareMetaHtml = metaSummary
            ? `<div class="dirSquareMeta">${escapeHtml(metaSummary)}</div>`
            : "";
          const showFolderThumbnailTitle = true;
          const topNameHtml = isRenameEditingDir
            ? `<input class="tagEditInput renameEditInput dirSquareRenameInput" type="text" value="${escapeHtml(String(entry.node?.name || ""))}" placeholder="folder name" />`
            : isTagEditingDir
              ? `<input class="tagEditInput dirSquareRenameInput" type="text" value="${escapeHtml(metaGetUserTags(p).join(", "))}" placeholder="tag1, tag2" />`
              : showFolderThumbnailTitle
                ? `<span class="dirSquareName" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`
                : "";
          const menuOnlyFolderSquareCard =
            !isRenameEditingDir &&
            !isTagEditingDir &&
            !showFolderThumbnailTitle &&
            dirMetaLines.length === 0;
          const squareRightMetaHtml = `
                <div class="dirSquareRightMeta">
                  ${menuOnlyFolderSquareCard ? "" : scoreInlineHtml}
                  ${menuOnlyFolderSquareCard ? "" : statusBadgeHtml}
                  ${menuHtml}
                </div>
              `;
          const compactFolderSquareCard =
            !menuOnlyFolderSquareCard && !showFolderThumbnailTitle;
          folderSquareCardHtml = `
		              <div class="dirSquareCard"${squareCardStyle}>
		                <div class="dirSquareMedia">${squareMediaHtml}</div>
		                <div class="dirSquareOverlay${compactFolderSquareCard ? " dirSquareOverlayCompact" : ""}${menuOnlyFolderSquareCard ? " dirSquareOverlayMenuOnly" : ""}">
                    ${isTrashRootPortal ? "" : thumbnailTypeIconBubbleHtml(dirIconKey, isHidden)}
		                  <div class="dirSquareTop${compactFolderSquareCard ? " dirSquareTopCompact" : ""}">
	                    ${topNameHtml}
                    </div>
                    <div class="dirSquareBottom${compactFolderSquareCard ? " dirSquareBottomCompact" : ""}">
                      ${squareMetaHtml}
                      ${squareRightMetaHtml}
                    </div>
                  </div>
                </div>
              `;
        }
      } else {
        const rec = WS.fileById.get(entry.id);
        const fileVisibility = directoriesThumbnailVisibilityForKind("file");
        const isVid = rec?.type === "video";
        const fileIconKey = appIconKeyForType(rec?.type);
        const isFileHidden = isPathOrAncestorHidden(rec?.dirPath || "");
        rowIconHidden = isFileHidden;
        const isFavorite = pathIsFavoriteFolder(rec?.dirPath || "");
        const sel =
          canBulk && WS.view.bulkFileSelectedIds.has(String(entry.id || ""));
        if (sel) row.classList.add("bulkSelected");
        iconHtml = itemTypeIconHtml(fileIconKey, isFileHidden);
        name = prefixDisplayLabelWithPosition(
          fileDisplayNameForRecord(rec),
          navDisplayPositions.filePositions.get(String(entry.id || "")),
        );
        const fileMenuOpen =
          WS.view.fileActionMenuId === String(entry.id || "");
        const bulkFileMenuActive =
          canBulk && sel && selectedFilesInViewCount > 0;
        const canLooseSetMerge = !!WS.meta.fsRootHandle;
        const fileTrashTargetPath = trashTopLevelItemPathForFileRecord(rec);
        const fileMenuButtons = fileTrashTargetPath
          ? `
                  ${buildItemInfoDropdownHtml({ kind: "file", record: rec })}
                  <button type="button" data-action="put-back"${WS.meta.fsRootHandle ? "" : " disabled"}>Remove from Trash</button>
                `
          : `
                  ${buildItemInfoDropdownHtml({ kind: "file", record: rec })}
                  ${buildFileThumbnailSubmenuHtml(
                    getThumbnailMenuTargetsForRecord(rec),
                    !!rec,
                  )}
                  <button type="button" data-action="rename-file"${WS.meta.fsRootHandle ? "" : " disabled"}>Rename</button>
                `;
        const fileTypeLabel = fileItemTypeLabelForRecord(
          rec || { type: isVid ? "video" : "image" },
        );
        const fileSizeLabel = formatBytes(Math.max(0, Number(rec?.size) || 0));
        const fileMenuScore = metaGetScore(rec?.dirPath || "");
        fileMenuHtml = fileVisibility.showMenuButton
          ? `
              <div class="dirMenu dirFileMenu">
                ${buildThumbnailMenuButtonHtml(
                  "File menu",
                  fileMenuScore,
                  isFavorite,
                  "",
                  false,
                  null,
                  FAVORITE_MENU_BUTTON_DISPLAY_TINT,
                )}
                <div class="dropdownMenu itemActionMenu${fileMenuOpen ? " open" : ""}">
                  ${fileMenuButtons}
                </div>
              </div>
            `
          : "";
        const fileMetaSummary = [
          fileVisibility.showItemTypeLabel ? fileTypeLabel : "",
          fileVisibility.showItemCount ? "1 item" : "",
          fileVisibility.showSize ? fileSizeLabel : "",
        ]
          .filter(Boolean)
          .join(" • ");
        if (folderSquareCardMode) {
          let inlinePreviewHtml = "";
          if (rec) {
            const previewId = String(rec.id || "");
            const previewSrc = getPassivePreviewSrcForRecord(rec, {
              allowImageMediaFallback: true,
            });
            const previewAspect = getPreviewAspectForRecord(rec);
            if (previewSrc) {
              const cropStyle = fileThumbCropLayoutStyle(rec, "");
              const cropClass = cropStyle
                ? " thumbCropApplied thumbCropAbsolute"
                : "";
              inlinePreviewHtml = `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)}${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
            }
          }
          const fileMediaHtml = inlinePreviewHtml
            ? inlinePreviewHtml
            : `<div class="dirSquareFallback" aria-hidden="true">${appIconHtml(
                fileIconKey,
              )}</div>`;
          const fileMetaBits = [];
          if (fileVisibility.showItemTypeLabel)
            fileMetaBits.push(
              `<span class="dirFileType">${escapeHtml(fileTypeLabel)}</span>`,
            );
          if (fileVisibility.showItemCount)
            fileMetaBits.push(`<span class="dirFileCount">1 item</span>`);
          if (fileVisibility.showSize)
            fileMetaBits.push(
              `<span class="dirFileSize">${escapeHtml(fileSizeLabel)}</span>`,
            );
          const fileCardStyle =
            naturalThumbCards && rec
              ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(rec)).toFixed(4)};"`
              : "";
          const showFileThumbnailTitle = true;
          const menuOnlyFileThumbCard =
            !showFileThumbnailTitle && fileMetaBits.length === 0;
          const compactFileThumbCard =
            !menuOnlyFileThumbCard && !showFileThumbnailTitle;
          const fileThumbHtml = `
                <div class="dirThumbSlot dirFileThumbSlot">
                  <div class="dirFileThumbCard"${fileCardStyle}>
	                    ${fileMediaHtml}
	                    <div class="dirFileOverlay${compactFileThumbCard ? " dirFileOverlayCompact" : ""}${menuOnlyFileThumbCard ? " dirFileOverlayMenuOnly" : ""}">
                      ${thumbnailTypeIconBubbleHtml(fileIconKey, isFileHidden)}
	                      <div class="dirFileOverlayTop${compactFileThumbCard ? " dirFileOverlayTopCompact" : ""}">
	                        ${showFileThumbnailTitle ? `<span class="dirFileNameText" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` : ""}
                      </div>
                      <div class="dirFileOverlayBottom${compactFileThumbCard ? " dirFileOverlayBottomCompact" : ""}">
                        <div class="dirFileMetaLine">${fileMetaBits.join('<span class="dirFileMetaDot">•</span>')}</div>
                        ${fileMenuHtml}
                      </div>
                    </div>
                  </div>
                </div>
              `;
          nameHtml = `
                <div class="dirFileStack">
                  ${fileThumbHtml}
                </div>
              `;
          rightHtml = "";
        } else {
          nameHtml = `<span class="dirNameText">${escapeHtml(name)}</span>`;
          rightHtml = `
                <div class="dirRight dirFileBarActions">
                  ${fileMetaSummary ? `<div class="dirBarMetaText">${escapeHtml(fileMetaSummary)}</div>` : ""}
                  ${fileMenuHtml}
                </div>
              `;
        }
      }

      if (entry.kind === "dir") {
        row.classList.add("folderRow");
        if (folderSquareCardMode && folderSquareCardHtml) {
          row.classList.add("folderSquareCard");
          row.innerHTML = folderSquareCardHtml;
        } else {
          row.classList.add("folderBarCard");
          if (isRenameEditingDir) {
            row.innerHTML = `
                  <div class="dirIcon${rowIconHidden ? " dirIconHiddenBubble" : ""}">${iconHtml}</div>
                  <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(String(entry.node?.name || ""))}" placeholder="folder name" /></div>
                  ${rightHtml}
                `;
          } else if (isTagEditingDir) {
            row.innerHTML = `
                  <div class="dirIcon${rowIconHidden ? " dirIconHiddenBubble" : ""}">${iconHtml}</div>
                  <div class="dirName"><input class="tagEditInput" type="text" value="${escapeHtml(metaGetUserTags(String(entry.node?.path || "")).join(", "))}" placeholder="tag1, tag2" /></div>
                  ${rightHtml}
                `;
          } else {
            row.innerHTML = `
                  <div class="dirIcon${rowIconHidden ? " dirIconHiddenBubble" : ""}">${iconHtml}</div>
                  <div class="dirName dirNameWithBadge" title="${escapeHtml(name)}">${nameHtml}</div>
                  ${thumbHtml}
                  ${rightHtml}
                `;
          }
        }
      } else {
        if (String(entry.id || "") === String(RENAME_EDIT_FILE_ID || "")) {
          const rec = WS.fileById.get(entry.id);
          const curName = String(rec?.name || "");
          if (folderSquareCardMode) {
            row.innerHTML = `
                  <div class="dirIcon${rowIconHidden ? " dirIconHiddenBubble" : ""}">${iconHtml}</div>
                  <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="file name" /></div>
                  ${fileMenuHtml}
                `;
          } else {
            row.classList.add("fileRow", "fileBarCard");
            row.innerHTML = `
                  <div class="dirIcon${rowIconHidden ? " dirIconHiddenBubble" : ""}">${iconHtml}</div>
                  <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="file name" /></div>
                  ${rightHtml}
                `;
          }
        } else {
          if (folderSquareCardMode) {
            row.classList.add("fileRow", "fileThumbCardRow");
            row.innerHTML = `
                  <div class="dirName dirFileNameWrap" title="${escapeHtml(name)}">${nameHtml}</div>
                `;
          } else {
            row.classList.add("fileRow", "fileBarCard");
            row.innerHTML = `
                  <div class="dirIcon">${iconHtml}</div>
                  <div class="dirName" title="${escapeHtml(name)}">${nameHtml}</div>
                  ${rightHtml}
                `;
          }
        }
      }
    }

    if (isTagEntry && !entry.placeholder && Number(entry.count || 0) > 0) {
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openTagEntryContextMenu(entry, row);
      });
      const tagMenuBtn = row.querySelector(".dirTagMenu .dirMenuBtn");
      if (tagMenuBtn) {
        tagMenuBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openTagEntryContextMenu(entry, tagMenuBtn);
        });
      }
    }

    if (isTagEntry && renameActive) {
      const renameInput = row.querySelector(".tagEntryRenameInput");
      if (renameInput) {
        let commitRequested = false;
        renameInput.addEventListener("click", (e) => {
          e.stopPropagation();
        });
        renameInput.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            cancelTagEntryRename();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            commitRequested = true;
            commitTagEntryRename(renameInput);
          }
        });
        renameInput.addEventListener("blur", () => {
          if (commitRequested) {
            commitRequested = false;
            return;
          }
          cancelTagEntryRename();
        });
      }
    }

    row.addEventListener("click", (e) => {
      closeActionMenus();
      const priorSelectedIndex = WS.nav.selectedIndex;
      const isCmdOrCtrl = eventCmdOrCtrlHeld(e);
      const isShift = eventShiftHeld(e);
      if (!isShift && !isCmdOrCtrl && idx === WS.nav.selectedIndex) {
        if (teleportFromRotatingThumbnail(entry, row)) return;
      }
      if (isShift && isCmdOrCtrl) {
        const anchor =
          WS.view.dirSelectAnchorIndex >= 0
            ? WS.view.dirSelectAnchorIndex
            : priorSelectedIndex;
        if (!WS.view.bulkSelectMode) includeCurrentSelectionInBulkSet(idx);
        addEntrySelectionRange(anchor, idx, false);
        WS.view.dirSelectAnchorIndex = idx;
        setDirectoriesSelection(idx, { keepScroll: true });
        return;
      }
      if (isShift) {
        const anchor =
          WS.view.dirSelectAnchorIndex >= 0
            ? WS.view.dirSelectAnchorIndex
            : priorSelectedIndex;
        selectEntryRange(anchor, idx);
        WS.view.dirSelectAnchorIndex = idx;
        setDirectoriesSelection(idx);
        return;
      }
      if (isCmdOrCtrl) {
        if (!WS.view.bulkSelectMode) includeCurrentSelectionInBulkSet(idx);
        WS.view.bulkSelectMode = true;
        toggleEntrySelection(entry);
        WS.view.dirSelectAnchorIndex = idx;
        setDirectoriesSelection(idx, { keepScroll: true });
        return;
      }

      if (
        WS.view.bulkSelectMode &&
        (WS.view.bulkTagSelectedPaths.size ||
          WS.view.bulkTagFolderSelectedKeys.size ||
          WS.view.bulkFileSelectedIds.size)
      ) {
        clearBulkTagSelection();
        WS.view.bulkSelectMode = false;
      }
      WS.view.dirSelectAnchorIndex = idx;
      setDirectoriesSelection(idx);
    });

    if (entry.kind === "dir") {
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openDirMenuForPath(entry.node?.path || "");
      });
    } else if (entry.kind === "file") {
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openFileMenuForId(entry.id);
      });
    }

    if (entry.kind === "dir") {
      const p = entry.node?.path || "";

      const iconEl = row.querySelector(".dirIcon");
      if (iconEl) {
        const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
        const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
        if (canBulk) {
          iconEl.title = sel ? "Deselect folder" : "Select folder";
          iconEl.style.cursor = "default";
          iconEl.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!p) return;
            if (WS.view.bulkTagSelectedPaths.has(p))
              WS.view.bulkTagSelectedPaths.delete(p);
            else WS.view.bulkTagSelectedPaths.add(p);
            renderDirectoriesPane(true);
          });
        } else {
          iconEl.style.cursor = "default";
        }
      }

      const up = row.querySelector(".voteBtn.up");
      const down = row.querySelector(".voteBtn.down");
      if (up)
        up.addEventListener("click", (e) => {
          e.stopPropagation();
          metaBumpScore(entry.node?.path || "", 1);
        });
      if (down)
        down.addEventListener("click", (e) => {
          e.stopPropagation();
          metaBumpScore(entry.node?.path || "", -1);
        });

      const menuBtn = row.querySelector(".dirMenuBtn");
      if (menuBtn) {
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const menuPathKey = entry.node === WS.root ? "__root__" : p;
          if (p && openBulkActionMenuForSelection(`dir:${p}`)) return;
          if (WS.view.dirActionMenuPath === menuPathKey) {
            allowMenuClose();
            closeActionMenus();
            renderDirectoriesPane(true);
            return;
          }
          openDirMenuForPath(p);
        });
      }

      const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
      if (menuDropdown) {
        menuDropdown.addEventListener("click", (e) => e.stopPropagation());
        const actionButtons = Array.from(
          menuDropdown.querySelectorAll("button[data-action]"),
        );
        actionButtons.forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = btn.getAttribute("data-action");
            if (action === "appearance-preset-set") {
              const isRootNode = entry.node === WS.root;
              const currentPresetId = isRootNode
                ? effectiveActiveAppearancePresetId()
                : effectiveAppearancePresetIdForMenuPath(p);
              buildAppearancePresetChoiceMenu(menuDropdown, {
                currentPresetId,
                onBack: () => {
                  renderDirectoriesPane(true);
                  renderPreviewPane(false, true);
                  syncButtons();
                },
                onChoosePreset: (presetId) => {
                  closeActionMenus();
                  renderDirectoriesPane(true);
                  if (isRootNode) {
                    if (!applyAppearancePresetById(presetId)) return;
                    if (MENU_ACTIVE_TAB === "general")
                      renderOptionsUi("appearance");
                    showStatusMessage(
                      `Root media preset: ${appearancePresetDisplayName(presetId)}.`,
                    );
                    return;
                  }
                  if (!metaSetFolderAppearancePresetId(p, presetId)) return;
                  refreshAfterProcessingMetadataChange();
                  showStatusMessage(
                    `Folder media preset: ${appearancePresetDisplayName(presetId)}.`,
                  );
                },
                onRendered: () => {
                  if (menuBtn) positionDropdownMenu(menuBtn, menuDropdown);
                },
              });
              return;
            }
            const sticky = isStickyItemMenuAction(action);
            const keyState = sticky
              ? captureNumberedMenuKeyState(menuDropdown)
              : null;
            if (sticky) suppressMenuAutoClose();
            else {
              allowMenuClose();
              closeActionMenus();
            }
            renderDirectoriesPane(true);
            await runFolderActionFromMenu(action, entry.node);
            if (sticky) scheduleNumberedMenuKeyStateRestore(keyState);
          });
        });
        if (menuDropdown.classList.contains("open")) {
          requestAnimationFrame(() =>
            positionDropdownMenu(menuBtn || row, menuDropdown),
          );
        }
      }

      const renameInput = row.querySelector(".renameEditInput");
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
            closeActionMenus();
            renderDirectoriesPane(true);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (commitRequested) return;
            commitRequested = true;
            await commitRenameEdit(p, renameInput);
            return;
          }
        });
        renameInput.addEventListener("blur", () => {
          if (commitRequested || RENAME_BUSY) return;
          RENAME_EDIT_PATH = null;
          closeActionMenus();
          renderDirectoriesPane(true);
        });
      }

      const input = row.querySelector(".tagEditInput:not(.renameEditInput)");
      if (input) {
        let commitRequested = false;
        input.addEventListener("click", (e) => {
          e.stopPropagation();
        });
        input.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            TAG_EDIT_PATH = null;
            closeActionMenus();
            renderDirectoriesPane(true);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            commitRequested = true;
            const tags = normalizeTagsFromText(input.value || "");
            metaSetUserTags(p, tags);
            return;
          }
        });
        input.addEventListener("blur", () => {
          if (commitRequested) {
            commitRequested = false;
            return;
          }
          TAG_EDIT_PATH = null;
          closeActionMenus();
          renderDirectoriesPane(true);
        });
      }
    } else if (entry.kind === "file") {
      const iconEl = row.querySelector(".dirIcon");
      if (iconEl) {
        const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
        const id = String(entry.id || "");
        const sel = canBulk && WS.view.bulkFileSelectedIds.has(id);
        if (canBulk) {
          iconEl.title = sel ? "Deselect file" : "Select file";
          iconEl.style.cursor = "default";
          iconEl.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!id) return;
            if (WS.view.bulkFileSelectedIds.has(id))
              WS.view.bulkFileSelectedIds.delete(id);
            else WS.view.bulkFileSelectedIds.add(id);
            renderDirectoriesPane(true);
          });
        } else {
          iconEl.style.cursor = "default";
        }
      }

      const menuBtn = row.querySelector(".dirMenuBtn");
      if (menuBtn) {
        menuBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = String(entry.id || "");
          if (!id) return;
          if (WS.view.fileActionMenuId === id && !WS.view.bulkActionMenuOpen) {
            allowMenuClose();
            closeActionMenus();
            renderDirectoriesPane(true);
            return;
          }
          openFileMenuForId(id);
        });
      }

      const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
      if (menuDropdown) {
        menuDropdown.addEventListener("click", (e) => e.stopPropagation());
        const actionButtons = Array.from(
          menuDropdown.querySelectorAll("button[data-action]"),
        );
        actionButtons.forEach((btn) => {
          btn.addEventListener("click", async (e) => {
            e.stopPropagation();
            const action = btn.getAttribute("data-action");
            const sticky = isStickyItemMenuAction(action);
            const keyState = sticky
              ? captureNumberedMenuKeyState(menuDropdown)
              : null;
            if (sticky) suppressMenuAutoClose();
            else {
              allowMenuClose();
              closeActionMenus();
            }
            renderDirectoriesPane(true);
            await runFileActionFromMenu(
              String(action || ""),
              String(entry.id || ""),
              row,
            );
            if (sticky) scheduleNumberedMenuKeyStateRestore(keyState);
          });
        });
        if (menuDropdown.classList.contains("open")) {
          requestAnimationFrame(() =>
            positionDropdownMenu(menuBtn, menuDropdown),
          );
        }
      }

      const renameInput = row.querySelector(".renameEditInput");
      if (renameInput) {
        let commitRequested = false;
        renameInput.addEventListener("click", (e) => {
          e.stopPropagation();
        });
        renameInput.addEventListener("keydown", async (e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            RENAME_EDIT_FILE_ID = null;
            closeActionMenus();
            renderDirectoriesPane(true);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            if (commitRequested) return;
            commitRequested = true;
            await commitFileRenameEdit(entry.id, renameInput);
            return;
          }
        });
        renameInput.addEventListener("blur", () => {
          if (commitRequested || RENAME_BUSY) return;
          RENAME_EDIT_FILE_ID = null;
          closeActionMenus();
          renderDirectoriesPane(true);
        });
      }

      const fileId = String(entry.id || "");
      if (
        canReorderGridFileEntries &&
        fileId &&
        String(RENAME_EDIT_FILE_ID || "") !== fileId
      ) {
        setupDirectoriesGridFileDragSource(
          row,
          WS.nav.dirNode || null,
          visibleFileIdsForGridReorder,
        );
      }
    }

    frag.appendChild(row);
  }
  appendVirtualFlexSpacer(
    frag,
    virtualWindow ? virtualWindow.bottomSpacerHeight : 0,
    gridModeActive,
  );

  directoriesListEl.appendChild(frag);
  invalidateGridRowMetricsCache();
  if (naturalThumbCards) syncDirectoryInlineAspectForRenderedImages();
  if (tauriThumbnailsActive()) tauriThumbnailizeContainer(directoriesListEl);
  reapplyInlineThumbCropsIn(directoriesListEl);
  if (gridModeActive) scheduleGridModeCardSizing();
  updateGridModeListTopInset();
  if (
    !WS.view.bulkActionMenuOpen &&
    (WS.view.dirActionMenuPath || WS.view.fileActionMenuId)
  ) {
    const hasOpenRowMenu = !!directoriesListEl.querySelector(
      ".dirMenu .dropdownMenu.open",
    );
    if (!hasOpenRowMenu) {
      closeActionMenus();
    }
  }
  renderDirectoriesActionHeader();

  const shouldCenter = WS.view.pendingDirScroll === "center-selected";
  const shouldGridReveal = WS.view.pendingDirScroll === "grid-nearest";
  if (shouldCenter) WS.view.pendingDirScroll = "";
  if (shouldGridReveal) WS.view.pendingDirScroll = "";

  if (preserveScroll) {
    directoriesListEl.scrollTop = prevScroll;
  } else if (gridModeActive && contextChanged) {
    // New folder context in Grid Mode should always spawn at the content top.
    directoriesListEl.scrollTop = 0;
    directoriesListEl.scrollLeft = 0;
  } else if (spawnUnderControls) {
    // When entering a new context that starts with tag/special rows, always spawn at the
    // resting top-of-list position so those rows appear directly under the controls.
    directoriesListEl.scrollTop = 0;
  }

  if (!suppressSelectionReveal) {
    if (shouldCenter) {
      if (gridModeActive) revealSelectedDirectoryRowInGridMode(true);
      else centerSelectedDirectoryRow(0, prevSelectedRowCenterOffset);
    } else if (gridModeActive && shouldGridReveal) {
      revealSelectedDirectoryRowInGridMode(false);
    } else {
      const vis = getSelectedDirectoryRowVisibility();
      if (vis.state === "offscreen" || vis.state === "partial") {
        // Keep list selection moving naturally until it hits an edge,
        // then scroll just enough to fully reveal it.
        snapSelectedDirectoryRowFullyIntoView();
      }
    }
  }

  LAST_DIRECTORIES_SCROLL_CONTEXT = nextContextKey;

  if (gridModeActive) {
    if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
    scheduleThumbnailDemandRefresh();
    return;
  }

  if (preserveScroll && !shouldCenter) {
    scheduleSelectedDirectoryRowReconcile(
      filesOnlyModeChanged ? 260 : 0,
      false,
      filesOnlyModeChanged,
    );
    if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
    scheduleThumbnailDemandRefresh();
    return;
  }
  scheduleSelectedDirectoryRowReconcile(
    filesOnlyModeChanged ? 260 : 0,
    false,
    filesOnlyModeChanged,
  );
  if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
  scheduleThumbnailDemandRefresh();
}
