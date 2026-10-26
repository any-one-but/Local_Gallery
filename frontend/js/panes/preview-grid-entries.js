/* Preview grid entries
   What the grid lists, its render recovery, search results and Tag cards. */

function makeSpacer(extraClass = "") {
  const sp = document.createElement("div");
  const suffix = String(extraClass || "").trim();
  sp.className = `previewSectionSpacer${suffix ? ` ${suffix}` : ""}`;
  return sp;
}

function makeSearchResultsPreviewSpacer() {
  const sp = document.createElement("div");
  sp.className = "tagSpacerVisualRow previewSearchSpacerRow";
  sp.setAttribute("aria-hidden", "true");
  sp.innerHTML = `<div class="tagSpacerCell" aria-hidden="true"></div>`;
  return sp;
}

function previewUsesCurrentViewEntries(dirNode, opts = null) {
  if (!(opts && opts.useCurrentViewEntries)) return false;
  if (!dirNode || !WS.nav.dirNode) return false;
  if (dirNode === WS.nav.dirNode) return true;
  const dirPath = String(dirNode.path || "");
  const navPath = String(WS.nav.dirNode.path || "");
  if (dirNode === WS.root && WS.nav.dirNode === WS.root) return true;
  return !!dirPath && dirPath === navPath;
}

function getPreviewFolderAndFileEntries(dirNode, opts = null) {
  const result = getPreviewFolderAndFileEntriesCore(dirNode, opts);
  // Guarantee: while a preview-initiated bulk tag is in progress, the
  // "new tag folder" placeholder card always appears in the preview grid,
  // regardless of how the entries were built (current view, tag preview, or
  // general folder listing). The file pane never renders it in that case, so
  // the naming interaction always resolves here, in the preview.
  if (
    result &&
    Array.isArray(result.folderEntries) &&
    BULK_TAG_PLACEHOLDER &&
    BULK_TAG_PLACEHOLDER.preferPane === "preview" &&
    !result.folderEntries.some((e) => e && e.placeholder)
  ) {
    const placeholder = buildBulkTagPlaceholderEntry();
    if (placeholder)
      result.folderEntries = [placeholder].concat(result.folderEntries);
  }
  return result;
}

function getPreviewFolderAndFileEntriesCore(dirNode, opts = null) {
  const includeFiles = !(opts && opts.includeFiles === false);
  if (previewUsesCurrentViewEntries(dirNode, opts)) {
    const folderEntries = [];
    const fileIds = [];
    const useSessionFileOrder =
      includeFiles &&
      !isViewingTagFolder() &&
      !searchResultsVisibleInDirectoriesPane() &&
      !(WS.view.favoritesMode && WS.view.favoritesRootActive) &&
      !(WS.view.hiddenMode && WS.view.hiddenRootActive);
    for (let i = 0; i < WS.nav.entries.length; i++) {
      const entry = WS.nav.entries[i];
      if (!entry) continue;
      if (entry.kind === "tag" || entry.kind === "dir") {
        folderEntries.push(entry);
        continue;
      }
      if (includeFiles && entry.kind === "file") {
        const id = String(entry.id || "");
        if (id) fileIds.push(id);
      }
    }
    return {
      folderEntries,
      fileIds: useSessionFileOrder ? getOrderedFileIdsForDir(dirNode) : fileIds,
    };
  }
  if (dirNode && String(dirNode._tagPreviewMode || "")) {
    const baseNode =
      WS.dirByPath.get(String(dirNode._tagPreviewOriginPath || "")) ||
      dirNode.parent ||
      WS.root;
    const mode = String(dirNode._tagPreviewMode || "");
    if (mode !== "album") {
      const entry = {
        kind: "tag",
        originPath: String(baseNode?.path || ""),
        label: String(dirNode.name || mode || "Tag"),
      };
      if (
        mode === "favorites" ||
        mode === "hidden" ||
        mode === "untagged" ||
        mode === "storage"
      ) {
        entry.special = mode;
      } else if (mode === "gallery") {
        entry.gallery = String(
          dirNode._tagPreviewGallery || dirNode._tagPreviewTag || "",
        );
      } else {
        entry.tag = String(dirNode._tagPreviewTag || "");
        entry.album = String(dirNode._tagPreviewAlbum || "");
      }
      const folderEntries =
        mode === "tag"
          ? getChildTagEntriesForTag(String(dirNode._tagPreviewTag || ""))
          : [];
      const dirs = getDirsForTagEntry(entry);
      return {
        folderEntries: folderEntries.concat(
          dirs.map((node) => ({ kind: "dir", node })),
        ),
        fileIds: [],
      };
    }
    const album = String(dirNode._tagPreviewAlbum || "");
    const albumEntry = {
      kind: "tag",
      album,
      label: album,
      originPath: String(baseNode?.path || ""),
    };
    const directDirs = filterTagEntryDirsByVisibleRecords(
      getDirectDirsForAlbumForBaseNode(baseNode, album),
      albumEntry,
    );
    return {
      folderEntries: getTagEntriesForAlbumForBaseNode(baseNode, album).concat(
        directDirs.map((node) => ({ kind: "dir", node })),
      ),
      fileIds: [],
    };
  }
  const folderEntries = [];
  if (shouldShowRootTrashEntry(dirNode)) {
    const rootTrashEntry = buildRootTrashDirEntry();
    if (rootTrashEntry) folderEntries.push(rootTrashEntry);
  }
  const tagEntries = getTagFolderEntriesForDir(dirNode, {
    includePlaceholder: false,
  });
  for (let i = 0; i < tagEntries.length; i++) folderEntries.push(tagEntries[i]);
  const childDirs = getChildDirsForNode(dirNode);
  for (let i = 0; i < childDirs.length; i++)
    folderEntries.push({ kind: "dir", node: childDirs[i] });
  return {
    folderEntries,
    fileIds: includeFiles ? getOrderedFileIdsForDir(dirNode) : [],
  };
}

function getPreviewMediaFileIdsForDir(dirNode) {
  if (!dirNode) return [];
  const previewEntries = getPreviewFolderAndFileEntries(dirNode, {
    includeFiles: true,
    useCurrentViewEntries: true,
  });
  const ids = Array.isArray(previewEntries.fileIds)
    ? previewEntries.fileIds
    : [];
  return ids.filter((id) => {
    const rec = WS.fileById.get(String(id || ""));
    return (
      !!rec &&
      !rec.isMissingPlaceholder &&
      (rec.type === "image" || rec.type === "video")
    );
  });
}

function makePreviewGridRenderStage() {
  const stage = document.createElement("div");
  stage.className = "previewGridRenderStage";
  stage.style.visibility = "hidden";
  stage.style.pointerEvents = "none";
  stage.style.width = "100%";
  stage.style.flex = "0 0 auto";
  stage.style.alignSelf = "stretch";
  stage.style.minHeight = "max-content";
  return stage;
}

const PREVIEW_GRID_RENDER_RECOVERY = {
  key: "",
  attempts: 0,
  raf: 0,
};

function previewGridStageHasRenderableContent(stage, expectedCount) {
  if (!stage) return false;
  if (
    stage.querySelector(
      ".gridFiles .fileCard, .gridFolders .folderCard, .previewTagFolderCard, .label, .previewEmptyState",
    )
  ) {
    return true;
  }
  return Math.max(0, Number(expectedCount) || 0) <= 0 && stage.childElementCount > 0;
}

function swapPreviewGridRenderStage(stage) {
  if (!previewBodyEl || !stage || !stage.parentElement) return false;
  releaseContainerThumbMedia(previewBodyEl);
  previewBodyEl.innerHTML = "";
  while (stage.firstChild) previewBodyEl.appendChild(stage.firstChild);
  refreshPreviewGridTracks();
  refreshFitInsidePreviewGrids();
  return true;
}

function previewGridRecoveryKeyForDir(dirNode) {
  return [
    String(dirNode?.path || "__root__"),
    String(WS.view?.filterMode || "all"),
    normalizeAspectRatioFilterMode(WS.view?.aspectRatioFilterMode),
    normalizeDirSortMode(WS.meta?.dirSortMode),
    randomOrderSignature(),
  ].join("|");
}

function resetPreviewGridRenderRecovery() {
  PREVIEW_GRID_RENDER_RECOVERY.key = "";
  PREVIEW_GRID_RENDER_RECOVERY.attempts = 0;
  if (PREVIEW_GRID_RENDER_RECOVERY.raf) {
    cancelAnimationFrame(PREVIEW_GRID_RENDER_RECOVERY.raf);
    PREVIEW_GRID_RENDER_RECOVERY.raf = 0;
  }
}

function ensurePreviewGridFallbackLabel(text) {
  if (!previewBodyEl || previewBodyEl.childElementCount) return;
  const label = document.createElement("div");
  label.className = "label";
  label.style.padding = "10px";
  label.textContent = text || "Preview is updating.";
  previewBodyEl.appendChild(label);
}

function schedulePreviewGridRenderRecovery(dirNode, renderToken) {
  if (!dirNode || !previewBodyEl) return;
  const key = previewGridRecoveryKeyForDir(dirNode);
  if (PREVIEW_GRID_RENDER_RECOVERY.key !== key) {
    PREVIEW_GRID_RENDER_RECOVERY.key = key;
    PREVIEW_GRID_RENDER_RECOVERY.attempts = 0;
  }
  if (PREVIEW_GRID_RENDER_RECOVERY.attempts >= 1) {
    ensurePreviewGridFallbackLabel("Preview could not be rendered.");
    return;
  }
  PREVIEW_GRID_RENDER_RECOVERY.attempts += 1;
  ensurePreviewGridFallbackLabel("Preview is updating.");
  if (PREVIEW_GRID_RENDER_RECOVERY.raf) return;
  PREVIEW_GRID_RENDER_RECOVERY.raf = requestAnimationFrame(() => {
    PREVIEW_GRID_RENDER_RECOVERY.raf = 0;
    if (renderToken !== PREVIEW_FILES_RENDER_TOKEN) return;
    if (WS.preview.kind !== "dir" || WS.preview.dirNode !== dirNode) return;
    renderPreviewPane(false, true);
  });
}

function renderSelectedFolderMediaPreview(
  dirNode,
  animate,
  keepScroll,
  prevScroll,
  renderToken,
) {
  if (!dirNode) return false;
  const canonicalDirNode = canonicalDirNodeForActiveState(dirNode);
  if (canonicalDirNode && canonicalDirNode !== dirNode) {
    dirNode = canonicalDirNode;
    if (WS.preview.kind === "dir") WS.preview.dirNode = canonicalDirNode;
  }
  // Above-root view shows the root folder's real subfolders (folders only),
  // not the synthetic single [root] file-pane entry.
  const showRootFoldersOnly = WS.view.aboveRootView && dirNode === WS.root;
  const previewEntries = getPreviewFolderAndFileEntries(dirNode, {
    includeFiles: !showRootFoldersOnly,
    useCurrentViewEntries: !showRootFoldersOnly,
  });
  const folderEntries = Array.isArray(previewEntries.folderEntries)
    ? previewEntries.folderEntries
    : [];
  const ids = (Array.isArray(previewEntries.fileIds)
    ? previewEntries.fileIds
    : [])
    .map((id) => String(id || ""))
    .filter((id) => !!id && WS.fileById.has(id));

  setPreviewBodyMode("grid");
  if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
  MediaFilterEngine.detach("preview");
  if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
  if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");

  WS.view.previewScrollActiveKey = previewScrollKeyForDir(dirNode);
  // Note: selection is NOT cleared here. ensurePreviewSelectionForCurrentTarget
  // (below) preserves the current selection when the preview target is
  // unchanged and only resets it when the context (folder) actually changes —
  // so closing a sidebar pane keeps the grid selection in place.
  const expectedItems = folderEntries.length + ids.length;
  const stage = makePreviewGridRenderStage();
  previewBodyEl.appendChild(stage);

  let result = null;
  try {
    result =
      renderFolderContents(
        dirNode,
        stage,
        animate,
        {
          previewEntries: { folderEntries, fileIds: ids },
          folderMediaPreviewGrid: true,
          useCurrentViewEntries: true,
        },
        renderToken,
      ) || { folderCount: folderEntries.length, fileCount: ids.length };
  } catch (err) {
    try {
      console.error("Preview grid render failed", err);
    } catch {}
    if (stage.parentElement) stage.parentElement.removeChild(stage);
    schedulePreviewGridRenderRecovery(dirNode, renderToken);
    scheduleThumbnailDemandRefresh();
    return true;
  }

  if (!previewGridStageHasRenderableContent(stage, expectedItems)) {
    if (stage.parentElement) stage.parentElement.removeChild(stage);
    schedulePreviewGridRenderRecovery(dirNode, renderToken);
    scheduleThumbnailDemandRefresh();
    return true;
  }

  resetPreviewGridRenderRecovery();
  swapPreviewGridRenderStage(stage);
  if (tauriThumbnailsActive()) {
    tauriThumbnailizeContainer(previewBodyEl);
  } else {
    upgradeContainerPreviewVideoThumbs(previewBodyEl, {
      renderToken,
      passiveWhenHeavy: true,
    });
  }
  reapplyInlineThumbCropsIn(previewBodyEl);
  const hadPendingSelection = applyPendingPreviewSelectionForCurrentTarget();

  const totalItems =
    Math.max(0, Number(result.folderCount) || folderEntries.length || 0) +
    Math.max(0, Number(result.fileCount) || ids.length || 0);
  if (itemsPill) itemsPill.textContent = `Items: ${totalItems}`;
  const savedScroll = getSavedPreviewScrollForDir(dirNode);
  const targetScroll = keepScroll ? prevScroll : savedScroll;
  // When a pending selection was applied (e.g. the folder/file you just left
  // on exit), scroll to reveal it instead of restoring the folder's saved
  // scroll, so the item you left is always visible.
  if (!hadPendingSelection && Number.isFinite(targetScroll)) {
    previewBodyEl.scrollTop = Math.max(0, Number(targetScroll) || 0);
  }
  schedulePreviewVirtualGridRefresh();
  ensurePreviewSelectionForCurrentTarget(false);
  updatePreviewSelectionClasses();
  if (
    hadPendingSelection &&
    WS.view &&
    WS.view.activePane === "preview"
  ) {
    revealPreviewCard();
  }
  scheduleThumbnailDemandRefresh();
  return true;
}

function renderPreviewSearchResults(container) {
  if (!container) return { count: 0 };
  const dirs = Array.isArray(WS.view.searchResults)
    ? WS.view.searchResults.slice()
    : [];
  const placeholderEntry = buildBulkTagPlaceholderEntry();
  if (!dirs.length && !placeholderEntry) {
    container.innerHTML = "";
    container.appendChild(
      makePreviewEmptyState("No matching folders", "luFileSearch"),
    );
    return { count: 0 };
  }

  const directCount = Math.max(
    0,
    Math.min(dirs.length, Number(WS.view.searchResultsDirectCount) || 0),
  );
  const directDirs = directCount > 0 ? dirs.slice(0, directCount) : [];
  const recursiveDirs =
    directCount > 0 ? dirs.slice(directCount) : dirs.slice();
  const searchPreviewPositions = buildDisplayPositionMapsForFolderAndFileEntries(
    dirs.map((dirNode) => ({ kind: "dir", node: dirNode })),
    [],
  );
  const folderSizeMemo = new Map();
  const gridF = document.createElement("div");
  // Match the normal preview-pane folder grid so search results look identical
  // to browsing (sizing, spacing, card chrome) instead of the file-pane list.
  gridF.className = "gridFolders folderMediaPreviewGrid folderContentsPreviewGrid";
  gridF.setAttribute("aria-label", "Search result folders");
  const useFolderFitInsideJustified = folderPreviewThumbUsesContainMode();
  if (useFolderFitInsideJustified) gridF.classList.add("fitInsideJustified");
  const frag = document.createDocumentFragment();

  if (placeholderEntry) {
    frag.appendChild(makeTagPreviewCard(placeholderEntry));
    if (dirs.length) frag.appendChild(makePreviewTagSpacer());
  }

  for (let i = 0; i < directDirs.length; i++) {
    const dirNode = directDirs[i];
    if (!dirNode) continue;
    frag.appendChild(
      makeFolderPreviewCard(
        dirNode,
        folderSizeMemo,
        searchPreviewPositions.dirPositions.get(String(dirNode?.path || "")),
      ),
    );
  }
  if (directDirs.length && recursiveDirs.length) {
    frag.appendChild(makePreviewTagSpacer());
  }
  for (let i = 0; i < recursiveDirs.length; i++) {
    const dirNode = recursiveDirs[i];
    if (!dirNode) continue;
    frag.appendChild(
      makeFolderPreviewCard(
        dirNode,
        folderSizeMemo,
        searchPreviewPositions.dirPositions.get(String(dirNode?.path || "")),
      ),
    );
  }

  gridF.appendChild(frag);
  container.appendChild(gridF);
  if (useFolderFitInsideJustified) applyFitInsideJustifiedLayout(gridF);
  else applyPreviewGridTracks(gridF);
  container.appendChild(makeSpacer());
  return { count: dirs.length };
}

function buildPreviewTagCardMarkup(entry) {
  const visibility = previewThumbnailVisibilityForKind("tag");
  const showFolderCount = visibility.showFolderCount;
  const showFileCount = visibility.showFileCount;
  const showSize = visibility.showSize;
  const showItemTypeLabel = visibility.showItemTypeLabel;
  const showTagThumbnailTitles = visibility.showTitle;
  const naturalThumbCards = naturalAspectThumbnailCardsEnabled();
  const label = String(entry.label || entry.tag || entry.album || entry.gallery || "Tag");
  const labelDisplay = tagCardDisplayLabel(label);
  const countText = getTagEntryCountText(entry);
  const iconHtml = getTagEntryDisplayIcon(entry);
  const isStoragePortalEntry = entry.special === "storage";
  const tagTypeLabel = tagItemTypeLabelForEntry(entry);
  const isHiddenTag = metaHasHiddenTagByKey(hiddenTagKeyForEntry(entry));
  const lightweightTagMetrics =
    !tortoiseNavigationEnabled() &&
    isViewingPerformanceSensitiveTagAlbumFolder();
  const lightweightTagThumbs = false;
  const tagMetrics = lightweightTagMetrics
    ? {
        folderCount: Math.max(0, Number(entry.count) || 0),
        fileCount: 0,
        sizeBytes: 0,
        score: 0,
      }
    : getTagEntryAggregateMetrics(entry);
  const tagSummaryBits = [];
  if (showFolderCount && showFileCount) tagSummaryBits.push(countText);
  else if (showFolderCount) tagSummaryBits.push(`${tagMetrics.folderCount} ${tagMetrics.folderCount === 1 ? "Folder" : "Folders"}`);
  else if (showFileCount) tagSummaryBits.push(`${tagMetrics.fileCount} ${tagMetrics.fileCount === 1 ? "File" : "Files"}`);
  if (showSize) tagSummaryBits.push(formatBytes(tagMetrics.sizeBytes));
  const tagThumbKey = tagThumbnailKeyForEntry(entry);
  const tagThumbMode = isStoragePortalEntry || lightweightTagThumbs
    ? "none"
    : metaGetTagThumbnailModeByKey(tagThumbKey);
  const tagThumbIsRotating =
    !isStoragePortalEntry &&
    !lightweightTagThumbs &&
    tagThumbnailUsesRotationByKey(tagThumbKey);
  const presetRec = isStoragePortalEntry || lightweightTagThumbs
    ? null
    : getTagPresetPreviewRecordForEntry(entry);
  const tagPool =
    tagThumbMode !== "none" && !presetRec && !naturalThumbCards
      ? getRecursivePreviewRecordsForTagEntry(
          entry,
          tagThumbnailPreviewSampleLimit(
            tagThumbIsRotating ? "rotate" : tagThumbMode,
          ),
        )
      : [];
  const tagAllowsRotation =
    !isStoragePortalEntry && !lightweightTagThumbs && !naturalThumbCards;
  const tagRotateScope = String(WS.nav.dirNode?.path || "");
  const tagRotateKey = entry.special
    ? `tag:${tagRotateScope}:special:${entry.special}`
    : entry.album && !entry.tag
      ? `tag:${tagRotateScope}:album:${String(entry.album || "")}`
      : entry.gallery && !entry.tag && !entry.album
        ? `tag:${tagRotateScope}:gallery:${String(entry.gallery || "")}`
      : `tag:${tagRotateScope}:name:${String(entry.tag || "")}`;
  const renameActive = isTagEntryRenameActive(entry);

  // A thumbnail is expected when the tag/album is in a thumb mode and actually
  // contains media. Until its lead thumbnail resolves, show a calm pending slot
  // rather than the image-icon fallback, so it doesn't flash before swapping in.
  const tagExpectsThumb =
    mediaThumbnailsEnabled() &&
    tagThumbMode !== "none" &&
    Number(tagMetrics?.fileCount || 0) > 0;
  let squareMediaHtml = isStoragePortalEntry
    ? `<div class="dirSquareFallback systemPortalThumbFallback">${appIconHtml("storage")}</div>`
    : tagExpectsThumb
      ? `<div class="dirSquareFallback thumbIconPending" aria-hidden="true"></div>`
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
    } else if (tagAllowsRotation && tagThumbMode === "quad" && tagPool.length) {
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
          if (quadHtml.length)
            squareMediaHtml = `<div class="dirTagQuadGrid">${quadHtml.join("")}</div>`;
        }
      }
    }
  }
  // Nothing above produced a picture (natural-aspect cards skip the pool, and a
  // quad needs rotation) but the Tag has media: take its first record rather
  // than leave the pending slot empty forever, and failing that show it the way
  // the Blank setting does.
  if (tagExpectsThumb && squareMediaHtml.includes("thumbIconPending")) {
    const rec =
      tagPool[0] ||
      getRecursivePreviewRecordsForTagEntry(entry, 1)[0] ||
      null;
    const previewSrc = rec
      ? getPassivePreviewSrcForRecord(rec, { allowImageMediaFallback: true })
      : "";
    squareMediaHtml = previewSrc
      ? `<img class="dirInlinePreview ${inlineThumbInitClass(previewSrc)} dirTagSingleThumb" data-dir-preview-id="${escapeHtml(String(rec.id || ""))}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(getPreviewAspectForRecord(rec)).toFixed(4)};" />`
      : `<div class="dirSquareFallback">${iconHtml}</div>`;
  }

  const canOpenTagMenu = !entry.placeholder && !!tagThumbKey;
  const showTagMenuButton = canOpenTagMenu && visibility.showMenuButton;
  const tagMenuCountLabel = isStoragePortalEntry
    ? formatSystemPortalItemCountLabel(entry.count)
    : "";
  const showTagThumbnailTitle = showTagThumbnailTitles || renameActive;
  // Info text is off the strip, so a tag card is title row + badge row like
  // every other card; nothing collapses it into an inline shape any more.
  const menuOnlyTagCard =
    !renameActive && !showTagThumbnailTitle && showTagMenuButton;
  const tagMenuHtml = showTagMenuButton
    ? `
        <div class="dirMenu dirTagMenu">
          ${buildThumbnailMenuButtonHtml(
            "Tag menu",
            tagMetrics.score,
            false,
            "",
            false,
            null,
            FAVORITE_MENU_BUTTON_DISPLAY_ICON,
            tagMenuCountLabel,
          )}
        </div>
      `
    : ``;
  const tagTitleClass =
    entry.special === "favorites"
      ? "dirSquareNameTagFavorite"
      : entry.album && !entry.tag
        ? "dirSquareNameTagAlbum"
        : "dirSquareNameTag";
  const tagTitleIconKey = getTagEntryIconKey(entry);
  const topNameHtml = renameActive
    ? `<input class="tagEditInput tagEntryRenameInput renameEditInput dirSquareRenameInput" type="text" value="${escapeHtml(TAG_ENTRY_RENAME_STATE.label || label)}" placeholder="${escapeHtml(label)}" />`
    : showTagThumbnailTitle
      ? isStoragePortalEntry
        ? `<span class="dirSquareName ${tagTitleClass}" title="${escapeHtml(labelDisplay)}">${escapeHtml(labelDisplay)}</span>`
        : `<span class="dirSquareName ${tagTitleClass} thumbnailTitleWithIcon" title="${escapeHtml(labelDisplay)}">${thumbnailTitleHtml(tagTitleIconKey, labelDisplay)}</span>`
      : "";
  const typeBubbleHtml = isStoragePortalEntry
    ? ""
    : thumbnailTypeIconBubbleHtml(
        tagTitleIconKey,
        isHiddenTag,
        entry.special ? "" : tagLockIconKey(entry.tag),
      );
  const typeBadgeHtml = "";
  const scoreBadgeHtml = ``;
  const countMetaHtml = "";
  const rightMetaHtml =
    scoreBadgeHtml || typeBadgeHtml || tagMenuHtml
      ? `
              <div class="dirSquareRightMeta">
                ${scoreBadgeHtml}
                ${typeBadgeHtml}
                ${tagMenuHtml}
              </div>
            `
      : ``;
  const tagCardStyle =
    naturalThumbCards && presetRec
      ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(presetRec)).toFixed(4)};"`
      : "";
  // No compact variant any more -- every card is the same two rows.
  const bottomMetaHtml =
    countMetaHtml || rightMetaHtml
      ? `
            <div class="dirSquareBottom">
              ${countMetaHtml}
              ${rightMetaHtml}
            </div>
          `
      : ``;
  const overlayHtml =
    typeBubbleHtml || topNameHtml || bottomMetaHtml
      ? `
          <div class="dirSquareOverlay${menuOnlyTagCard ? " dirSquareOverlayMenuOnly" : ""}">
            ${typeBubbleHtml}
            ${topNameHtml ? `<div class="dirSquareTop">${topNameHtml}</div>` : ""}
            ${bottomMetaHtml}
          </div>
        `
      : "";

  return `
        <div class="dirSquareCard"${tagCardStyle}>
          <div class="dirSquareMedia">${squareMediaHtml}</div>
          ${overlayHtml}
        </div>
      `;
}

function makePreviewTagSpacer() {
  const spacer = document.createElement("div");
  spacer.className = "tagSpacerVisualRow previewTagSpacerRow";
  spacer.setAttribute("aria-hidden", "true");
  spacer.innerHTML = `<div class="tagSpacerCell" aria-hidden="true"></div>`;
  return spacer;
}

function makeTagPreviewCard(entry) {
  const card = document.createElement("div");
  const previewItemKey = `tag:${String(tagEntrySelectionKey(entry) || entry.tag || entry.label || "tag")}`;
  card.className = "folderCard folderThumbCard previewTagFolderCard";
  card.dataset.previewItemKey = previewItemKey;
  card.dataset.previewItemKind = "tag";
  card.__previewTagEntry = entry;
  const naturalThumbCards = naturalAspectThumbnailCardsEnabled();
  card.style.cursor = "default";
  card.innerHTML = buildPreviewTagCardMarkup(entry);
  card.__previewOpenAction = () => {
    if (entry && !entry.placeholder) {
      closeActionMenus();
      openPreviewTagFolderEntry(entry);
    }
  };
  if (naturalThumbCards) {
    card.classList.add("fitInsideCard", "previewNaturalCard");
    let aspect = 1;
    const previewImg = card.querySelector(
      ".dirInlinePreview[data-dir-preview-id]",
    );
    const recId = String(previewImg?.dataset?.dirPreviewId || "");
    const rec = recId ? WS.fileById.get(recId) || null : null;
    if (rec) aspect = getPreviewAspectForRecord(rec);
    card.dataset.aspect = String(normalizePreviewAspect(aspect, 1));
    if (previewImg && rec && rec.type === "image") {
      previewImg.addEventListener(
        "load",
        () => {
          const w = Number(previewImg.naturalWidth) || 0;
          const h = Number(previewImg.naturalHeight) || 0;
          if (!(w > 0 && h > 0)) return;
          const resolved = normalizePreviewAspect(
            w / h,
            getPreviewAspectForRecord(rec),
          );
          rec.previewAspect = resolved;
          card.dataset.aspect = String(resolved);
          const grid = card.parentElement;
          if (grid && grid.classList.contains("fitInsideJustified")) {
            requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
          }
        },
        { once: true },
      );
    }
  }

  const renameInput = card.querySelector(".tagEntryRenameInput");
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

  const tagMenuBtn = card.querySelector(".dirTagMenu .dirMenuBtn");
  if (tagMenuBtn) {
    tagMenuBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openTagEntryContextMenu(entry, tagMenuBtn);
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
    openTagEntryContextMenu(entry, card);
  });

  return card;
}
