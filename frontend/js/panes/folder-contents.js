/* Folder contents
   renderFolderContents and the grid's drag-reorder. */

function renderFolderContents(
  dirNode,
  container,
  animate,
  opts = null,
  renderToken = PREVIEW_FILES_RENDER_TOKEN,
) {
  const options = opts && typeof opts === "object" ? opts : {};
  const previewEntries =
    options.previewEntries && typeof options.previewEntries === "object"
      ? options.previewEntries
      : getPreviewFolderAndFileEntries(dirNode, opts);
  const folderEntries = Array.isArray(previewEntries.folderEntries)
    ? previewEntries.folderEntries
    : [];
  const ids = Array.isArray(previewEntries.fileIds)
    ? previewEntries.fileIds
    : [];
  const folderMediaPreviewGrid = !!options.folderMediaPreviewGrid;
  const previewDisplayPositions = buildDisplayPositionMapsForFolderAndFileEntries(
    folderEntries,
    ids,
  );
  if (shouldChunkTagPreviewForHare(dirNode, folderEntries, ids)) {
    return renderTagPreviewFolderEntriesInHareChunks(
      dirNode,
      container,
      folderEntries,
      previewDisplayPositions,
      renderToken,
      folderMediaPreviewGrid,
    );
  }
  let hasContent = false;

  if (folderEntries.length) {
    const gridF = document.createElement("div");
    gridF.className = "gridFolders";
    if (folderMediaPreviewGrid) {
      gridF.classList.add("folderMediaPreviewGrid", "folderContentsPreviewGrid");
      gridF.setAttribute("aria-label", "Folder contents preview folders");
    }
    const useFolderFitInsideJustified = folderPreviewThumbUsesContainMode();
    if (useFolderFitInsideJustified) gridF.classList.add("fitInsideJustified");
    const fragF = document.createDocumentFragment();
    const folderSizeMemo = new Map();
    const floatSpacerBefore = makeFloatLayerSpacerGate();

    for (let i = 0; i < folderEntries.length; i++) {
      const entry = folderEntries[i];
      if (floatSpacerBefore(entry)) fragF.appendChild(makePreviewTagSpacer());
      if (!entry) continue;
      if (entry.kind === "tag") {
        fragF.appendChild(makeTagPreviewCard(entry));
        continue;
      }
      fragF.appendChild(
        makeFolderPreviewCard(
          entry.node,
          folderSizeMemo,
          previewDisplayPositions.dirPositions.get(
            String(entry.node?.path || ""),
          ),
        ),
      );
    }

    gridF.appendChild(fragF);
    container.appendChild(gridF);
    if (useFolderFitInsideJustified) applyFitInsideJustifiedLayout(gridF);
    else applyPreviewGridTracks(gridF);
    container.appendChild(makeSpacer());
    hasContent = true;
  }

  if (ids.length) {
    renderFilesGrid(
      ids,
      container,
      animate,
      dirNode,
      renderToken,
      previewDisplayPositions.filePositions,
      folderMediaPreviewGrid
        ? { folderMediaPreviewGrid: true }
        : null,
    );
    hasContent = true;
  }

  if (!hasContent) {
    container.appendChild(makePreviewEmptyState("Empty folder", "folder"));
  }

  return {
    folderCount: folderEntries.length,
    fileCount: ids.length,
    hasContent,
  };
}

function shouldExpandPreviewFolderEntry(entry) {
  if (!entry || entry.kind !== "dir") return false;
  if (entry.specialRootTrash) return false;
  const node = entry.node || null;
  if (!node) return false;
  if (isStorageStubDirNode(node)) return false;
  return true;
}

function canReorderFilesInPreviewDir(dirNode) {
  const target = getPreviewTargetDir();
  if (!target || !dirNode) return false;
  if (String(target.path || "") !== String(dirNode.path || "")) return false;
  return canReorderFilesInDir(dirNode);
}

const PREVIEW_DRAG_STATE = {
  placeholder: null,
  grid: null,
  draggedId: null,
  draggedCard: null,
  dirNode: null,
  visibleIds: null,
  raf: 0,
  lastX: 0,
  lastY: 0,
  pendingHide: false,
};

function ensurePreviewDragPlaceholder(card) {
  if (!PREVIEW_DRAG_STATE.placeholder) {
    const ph = document.createElement("div");
    ph.className = "fileCard drag-placeholder";
    ph.setAttribute("aria-hidden", "true");
    PREVIEW_DRAG_STATE.placeholder = ph;
  }
  const rect = card.getBoundingClientRect();
  const ph = PREVIEW_DRAG_STATE.placeholder;
  ph.style.width = `${Math.max(1, Math.round(rect.width))}px`;
  ph.style.height = `${Math.max(1, Math.round(rect.height))}px`;
  return ph;
}

function placePreviewDragPlaceholder(card) {
  const grid = card.parentElement;
  if (!grid) return;
  const ph = ensurePreviewDragPlaceholder(card);
  if (ph.parentElement && ph.parentElement !== grid) {
    ph.parentElement.removeChild(ph);
  }
  PREVIEW_DRAG_STATE.grid = grid;
  if (card !== ph) grid.insertBefore(ph, card);
}

function clearPreviewDragPlaceholder() {
  const ph = PREVIEW_DRAG_STATE.placeholder;
  if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
  PREVIEW_DRAG_STATE.grid = null;
}

function getPreviewGridCards(grid) {
  if (!grid) return [];
  return Array.from(grid.querySelectorAll(".fileCard")).filter(
    (card) =>
      !card.classList.contains("drag-placeholder") &&
      !card.classList.contains("drag-hidden"),
  );
}

function updatePreviewPlaceholderFromPoint(grid, x, y) {
  const cards = getPreviewGridCards(grid);
  if (!cards.length) {
    const ph = PREVIEW_DRAG_STATE.placeholder;
    if (ph) grid.appendChild(ph);
    return;
  }
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const rowMid = rect.top + rect.height / 2;
    if (y < rowMid) {
      placePreviewDragPlaceholder(card);
      return;
    }
    if (y >= rect.top && y <= rect.bottom) {
      const colMid = rect.left + rect.width / 2;
      if (x < colMid) {
        placePreviewDragPlaceholder(card);
        return;
      }
    }
  }
  const ph = PREVIEW_DRAG_STATE.placeholder;
  if (ph) grid.appendChild(ph);
}

function schedulePreviewDragUpdate(grid, x, y) {
  PREVIEW_DRAG_STATE.lastX = x;
  PREVIEW_DRAG_STATE.lastY = y;
  if (PREVIEW_DRAG_STATE.raf) return;
  PREVIEW_DRAG_STATE.raf = requestAnimationFrame(() => {
    PREVIEW_DRAG_STATE.raf = 0;
    updatePreviewPlaceholderFromPoint(
      grid,
      PREVIEW_DRAG_STATE.lastX,
      PREVIEW_DRAG_STATE.lastY,
    );
  });
}

function beginPreviewDrag(card, dragDir, visibleIds) {
  PREVIEW_DRAG_STATE.draggedCard = card;
  PREVIEW_DRAG_STATE.draggedId = String(card?.dataset?.fileId || "");
  PREVIEW_DRAG_STATE.dirNode = dragDir;
  PREVIEW_DRAG_STATE.visibleIds = Array.isArray(visibleIds)
    ? visibleIds.slice()
    : null;
  const grid = card?.parentElement || null;
  PREVIEW_DRAG_STATE.grid = grid;
  PREVIEW_DRAG_STATE.pendingHide = true;
}

function finishPreviewDrag() {
  if (PREVIEW_DRAG_STATE.raf) {
    cancelAnimationFrame(PREVIEW_DRAG_STATE.raf);
    PREVIEW_DRAG_STATE.raf = 0;
  }
  const card = PREVIEW_DRAG_STATE.draggedCard;
  if (card) card.classList.remove("drag-hidden", "dragging");
  PREVIEW_DRAG_STATE.draggedCard = null;
  PREVIEW_DRAG_STATE.draggedId = null;
  PREVIEW_DRAG_STATE.dirNode = null;
  PREVIEW_DRAG_STATE.visibleIds = null;
  PREVIEW_DRAG_STATE.pendingHide = false;
  clearPreviewDragPlaceholder();
}

function commitPreviewDraggedCardToPlaceholder() {
  const card = PREVIEW_DRAG_STATE.draggedCard;
  const ph = PREVIEW_DRAG_STATE.placeholder;
  const grid =
    PREVIEW_DRAG_STATE.grid || ph?.parentElement || card?.parentElement || null;
  if (!card || !ph || !grid || ph.parentElement !== grid) return false;
  card.classList.remove("drag-hidden");
  grid.insertBefore(card, ph);
  return true;
}

function ensurePreviewDragHidden() {
  if (!PREVIEW_DRAG_STATE.pendingHide) return;
  const card = PREVIEW_DRAG_STATE.draggedCard;
  const grid = PREVIEW_DRAG_STATE.grid || card?.parentElement || null;
  if (!card || !grid) return;
  PREVIEW_DRAG_STATE.pendingHide = false;
  placePreviewDragPlaceholder(card);
  card.classList.add("drag-hidden");
}

function setupPreviewGridDrag(grid) {
  if (!grid || grid.dataset.previewDragBound === "1") return;
  grid.dataset.previewDragBound = "1";

  grid.addEventListener("dragover", (e) => {
    if (!PREVIEW_DRAG_STATE.draggedId) return;
    if (PREVIEW_DRAG_STATE.grid && PREVIEW_DRAG_STATE.grid !== grid) return;
    e.preventDefault();
    ensurePreviewDragHidden();
    schedulePreviewDragUpdate(grid, e.clientX, e.clientY);
  });

  grid.addEventListener("drop", (e) => {
    if (!PREVIEW_DRAG_STATE.draggedId) return;
    if (PREVIEW_DRAG_STATE.grid && PREVIEW_DRAG_STATE.grid !== grid) return;
    e.preventDefault();
    e.stopPropagation();
    updatePreviewPlaceholderFromPoint(grid, e.clientX, e.clientY);
    const dirNode = PREVIEW_DRAG_STATE.dirNode;
    const dragId = PREVIEW_DRAG_STATE.draggedId;
    const ids =
      PREVIEW_DRAG_STATE.visibleIds ||
      (dirNode ? getOrderedFileIdsForDir(dirNode) : []);
    const list = ids.filter((id) => String(id || "") !== String(dragId));
    const children = Array.from(grid.children);
    let insertIdx = 0;
    for (const child of children) {
      if (child === PREVIEW_DRAG_STATE.placeholder) break;
      if (
        child.classList &&
        child.classList.contains("fileCard") &&
        !child.classList.contains("drag-hidden") &&
        !child.classList.contains("drag-placeholder")
      ) {
        insertIdx++;
      }
    }
    insertIdx = Math.max(0, Math.min(list.length, insertIdx));
    let targetId = null;
    let placeAfter = false;
    if (list.length) {
      if (insertIdx >= list.length) {
        targetId = list[list.length - 1];
        placeAfter = true;
      } else {
        targetId = list[insertIdx];
        placeAfter = false;
      }
    }
    let moved = false;
    if (dirNode && targetId) {
      moved = reorderFilesInDir(dirNode, dragId, targetId, placeAfter, {
        visibleIds: ids,
      });
    }
    DIR_FILE_DRAG.id = null;
    DIR_FILE_DRAG.dirPath = null;
    if (moved) commitPreviewDraggedCardToPlaceholder();
    finishPreviewDrag();
    if (moved) {
      syncAfterDirOrderChange(null, {
        preserveSelection: true,
        preservePreviewTarget: true,
        renderPreview: false,
      });
    }
  });
}

function makePreviewFileCard(
  rec,
  animate,
  dirNode,
  visibleIds,
  useFitInsideJustified = false,
  useSquareMediaCards = false,
  displayPosition = null,
  opts = null,
) {
  const options = opts && typeof opts === "object" ? opts : {};
  const visibility = previewThumbnailVisibilityForKind("file");
  const showSize = visibility.showSize;
  const showItemCount = visibility.showItemCount;
  const showItemTypeLabel = visibility.showItemTypeLabel;
  const showFileThumbnailTitles = visibility.showTitle;
  const card = document.createElement("div");
  card.className = "fileCard";
  if (rec && rec.isMissingPlaceholder) {
    card.classList.add("missingAltPlaceholder");
  }
  const useNaturalAspectCards = naturalAspectThumbnailCardsEnabled();
  const fileId = String(rec.id || "");
  if (fileId) card.dataset.previewItemKey = `file:${fileId}`;
  card.dataset.previewItemKind = "file";
  card.__previewOpenAction = () => {
    if (!WS.root) return;
    if (rec && rec.isMissingPlaceholder) {
      showStatusMessage("This item is missing from the current ALT.");
      return;
    }
    openPreviewFileFromPreviewCard(rec);
  };
  if (useSquareMediaCards) card.classList.add("previewSquareCard");
  if (useNaturalAspectCards) card.classList.add("previewNaturalCard");
  if (useFitInsideJustified) {
    card.classList.add("fitInsideCard");
    card.dataset.aspect = String(getPreviewAspectForRecord(rec));
  }
  const isRenameEditing = String(RENAME_EDIT_FILE_ID || "") === fileId;
  card.style.cursor = "pointer";
  if (animate) card.classList.add("enter");

  const mediaSrc = getPassivePreviewSrcForRecord(rec, {
    allowImageMediaFallback: true,
  });
  const cachedVideoThumbSrc =
    rec && rec.type === "video" ? videoThumbCachedUrlForRecord(rec) : "";
  const usePassiveVideoThumb =
    rec && rec.type === "video" && !!options.passiveVideoThumbs && !cachedVideoThumbSrc;
  let mediaEl = null;
  if (mediaSrc && !usePassiveVideoThumb) {
    if (rec.type === "video" && cachedVideoThumbSrc) {
      // Cached still frame: render a cheap <img>, no WebMediaPlayer.
      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = options.folderMediaPreviewGrid ? "eager" : "lazy";
      img.decoding = options.folderMediaPreviewGrid ? "sync" : "async";
      img.draggable = false;
      img.dataset.dirPreviewId = fileId;
      registerThumbEl(img, cachedVideoThumbSrc, { kind: "img" });
      if (useFitInsideJustified) {
        img.addEventListener("load", () => {
          const w = Number(img.naturalWidth) || 0;
          const h = Number(img.naturalHeight) || 0;
          if (w > 0 && h > 0) {
            const aspect = normalizePreviewAspect(
              w / h,
              getPreviewAspectForRecord(rec),
            );
            rec.previewAspect = aspect;
            card.dataset.aspect = String(aspect);
            const grid = card.parentElement;
            if (grid && grid.classList.contains("fitInsideJustified")) {
              requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
            }
          }
        });
      }
      mediaEl = img;
    } else if (rec.type === "video" && !tauriThumbnailsActive()) {
      // No cached frame yet: show the live <video> still and queue a background
      // capture so future renders use a cached <img> instead. (Under Tauri this
      // branch is skipped — video falls through to the <img> path below, which
      // renders a cached native thumbnail instead of a live WebMediaPlayer.)
      videoThumbCacheEnqueue(rec);
      const video = document.createElement("video");
      prepareMediaElementForCanvas(video);
      video.className = "thumb";
      video.preload = options.folderMediaPreviewGrid ? "auto" : "metadata";
      video.muted = true;
      video.playsInline = true;
      video.controls = false;
      video.draggable = false;
      video.dataset.dirPreviewId = fileId;
      registerThumbEl(video, mediaSrc, { kind: "video" });
      video.addEventListener("loadedmetadata", () => {
        if (
          options.renderToken != null &&
          Number(options.renderToken) !== Number(PREVIEW_FILES_RENDER_TOKEN)
        ) {
          stopCachedMediaElement(video);
          return;
        }
        const duration = Number(video.duration) || 0;
        if (duration > 0) {
          try {
            const customFrameTime = metaGetVideoThumbnailTimeForRecord(rec);
            video.currentTime = Number.isFinite(customFrameTime)
              ? Math.min(Math.max(0, customFrameTime), Math.max(0, duration - 0.05))
              : Math.min(0.1, Math.max(0, duration * 0.02));
          } catch {}
        }
        const w = Number(video.videoWidth) || 0;
        const h = Number(video.videoHeight) || 0;
        if (w > 0 && h > 0) {
          const aspect = normalizePreviewAspect(
            w / h,
            getPreviewAspectForRecord(rec),
          );
          rec.previewAspect = aspect;
          card.dataset.aspect = String(aspect);
          const grid = card.parentElement;
          if (grid && grid.classList.contains("fitInsideJustified")) {
            requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
          }
        }
      });
      mediaEl = video;
    } else {
      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = options.folderMediaPreviewGrid ? "eager" : "lazy";
      img.decoding = options.folderMediaPreviewGrid ? "sync" : "async";
      if (options.folderMediaPreviewGrid) {
        try { img.fetchPriority = "high"; } catch {}
      }
      img.draggable = false;
      img.alt =
        prefixDisplayLabelWithPosition(
          fileDisplayNameForRecord(rec),
          displayPosition,
        ) || "";
      img.dataset.dirPreviewId = fileId;
      registerThumbEl(img, mediaSrc, { kind: "img" });
      if (useFitInsideJustified) {
        img.addEventListener("load", () => {
          const w = Number(img.naturalWidth) || 0;
          const h = Number(img.naturalHeight) || 0;
          if (w > 0 && h > 0) {
            const aspect = normalizePreviewAspect(
              w / h,
              getPreviewAspectForRecord(rec),
            );
            rec.previewAspect = aspect;
            card.dataset.aspect = String(aspect);
            const grid = card.parentElement;
            if (grid && grid.classList.contains("fitInsideJustified")) {
              requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
            }
          }
        });
      }
      mediaEl = img;
    }
    if (!useFitInsideJustified && useSquareMediaCards) {
      applyFileThumbCropStyle(mediaEl, rec);
      attachFileThumbCropAspectReapply(mediaEl, rec);
    }
  } else {
    const fallback = document.createElement("div");
    fallback.className = "thumb thumbFallback";
    fallback.setAttribute("aria-hidden", "true");
    if (rec && rec.type === "video" && usePassiveVideoThumb && fileId) {
      fallback.classList.add("passiveVideoThumbPending");
      fallback.dataset.passiveVideoId = fileId;
      fallback.dataset.dirPreviewId = fileId;
      // Queue a background frame capture so this heavy-folder video gets a
      // cached <img> on the next render instead of upgrading to a live <video>.
      videoThumbCacheEnqueue(rec);
    }
    setAppIcon(fallback, iconKeyForRecordType(rec.type));
    card.appendChild(fallback);
  }

  const showNameMeta = false;
  const forceOverlayMeta = !!useSquareMediaCards || !!useNaturalAspectCards;
  const fileDisplayLabel = prefixDisplayLabelWithPosition(
    fileDisplayNameForRecord(rec),
    displayPosition,
  );
  const isFavorite = pathIsFavoriteFolder(rec?.dirPath || "");
  const isFileHidden = isPathOrAncestorHidden(rec?.dirPath || "");
  const fileMenuScore = metaGetScore(rec?.dirPath || "");
  const showPreviewFileMenuBtn =
    !!fileId && visibility.showMenuButton && !fileRecordHasNoItemMenu(rec);
  // Info text (size / type / counts) is no longer part of the strip -- see the
  // title strip geometry block in the stylesheet. The strip carries the title
  // and the badge, nothing else.
  const showFileThumbnailTitle = showFileThumbnailTitles || isRenameEditing;
  const showAnyMeta =
    showNameMeta || showFileThumbnailTitle || showPreviewFileMenuBtn;
  let meta = null;
  if (showAnyMeta) {
    meta = document.createElement("div");
    meta.className = forceOverlayMeta
      ? "metaBlock compact previewThumbOverlayMeta"
      : showNameMeta
        ? "metaBlock"
        : "metaBlock compact";
    if (forceOverlayMeta) forcePreviewPaneThumbTitleBar(meta);

    // The strip is always the same two rows, whatever the card holds: the title
    // on its own full-width row, the badge on a second row below it. It used to
    // collapse into a menu-only, an inline, or a two-row shape depending on
    // whether that particular record happened to have any info bits, so cards
    // in one grid ended up different heights. Only a card with neither a title
    // nor a badge has no strip at all.
    const menuOnlyOverlayMeta = forceOverlayMeta && !showFileThumbnailTitle;
    if (forceOverlayMeta && !menuOnlyOverlayMeta) {
      const top = document.createElement("div");
      top.className = "topLine previewThumbOverlayTopLine";
      if (isRenameEditing) {
        const renameInput = document.createElement("input");
        renameInput.type = "text";
        renameInput.className =
          "tagEditInput renameEditInput previewFileRenameInput";
        renameInput.value = String(rec?.name || "");
        renameInput.placeholder = "file name";
        top.appendChild(renameInput);
      } else {
        const name = document.createElement("div");
        name.className = "name";
        setThumbnailTitle(
          name,
          iconKeyForRecordType(rec.type),
          fileDisplayLabel || "\u2014",
          { hidden: isFileHidden },
        );
        name.title = relPathDisplayName(rec.relPath || rec.name || "", {
          finalPrefix: displayPositionPrefix(displayPosition),
        });
        top.appendChild(name);
      }
      meta.appendChild(top);
    }

    if (menuOnlyOverlayMeta) {
      meta.classList.add("previewThumbOverlayMetaMenuOnly");
      forcePreviewPaneThumbTitleBar(meta);
    }
    if (forceOverlayMeta || showPreviewFileMenuBtn) {
      const bottom = document.createElement("div");
      bottom.className = forceOverlayMeta
        ? "previewThumbOverlayBottomLine"
        : "previewThumbBottomLine";
      if (showPreviewFileMenuBtn) {
        const menuWrap = document.createElement("div");
        menuWrap.className = "dirMenu thumbOverlayMenu previewThumbOverlayMenu";
        const menuBtn = document.createElement("button");
        menuBtn.type = "button";
        configureThumbnailMenuButton(
          menuBtn,
          "File menu",
          fileMenuScore,
          isFavorite,
          "thumbOverlayMenuBtn previewThumbOverlayMenuBtn",
          null,
          FAVORITE_MENU_BUTTON_DISPLAY_TINT,
        );
        const openPreviewFileMenu = (e, atPoint = false) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          if (atPoint) {
            openPreviewFileActionMenu(rec, {
              x: Number(e?.clientX) || 0,
              y: Number(e?.clientY) || 0,
            });
          } else {
            openPreviewFileActionMenu(rec, { anchor: menuBtn });
          }
        };
        menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        menuBtn.addEventListener("click", (e) => {
          openPreviewFileMenu(e, false);
        });
        menuBtn.addEventListener("contextmenu", (e) => {
          openPreviewFileMenu(e, false);
        });
        menuWrap.appendChild(menuBtn);
        bottom.appendChild(menuWrap);
      }
      // The badge row is appended whether or not it has a badge in it: it is
      // half the strip's fixed height, so skipping it would shorten the strip
      // on cards with the badge turned off.
      meta.appendChild(bottom);
    }
  }

  if (mediaEl) card.appendChild(mediaEl);
  if (meta && meta.childNodes.length) card.appendChild(meta);

  if (fileId) card.dataset.fileId = fileId;
  const dragDir = dirNode || WS.dirByPath.get(rec.dirPath || "") || null;
  if (fileId && dragDir && canReorderFilesInPreviewDir(dragDir)) {
    const handleDragStart = (e) => {
      if (!canReorderFilesInPreviewDir(dragDir) || WS.view.bulkSelectMode) {
        e.preventDefault();
        return;
      }
      DIR_FILE_DRAG.id = fileId;
      DIR_FILE_DRAG.dirPath = String(dragDir.path || "");
      card.classList.add("dragging");
      beginPreviewDrag(card, dragDir, visibleIds);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try {
          e.dataTransfer.setData("text/plain", fileId);
        } catch {}
        try {
          const rect = card.getBoundingClientRect();
          e.dataTransfer.setDragImage(card, rect.width / 2, rect.height / 2);
        } catch {}
      }
    };
    const handleDragEnd = () => {
      DIR_FILE_DRAG.id = null;
      DIR_FILE_DRAG.dirPath = null;
      card.classList.remove("dragging");
      finishPreviewDrag();
    };
    const setupDragSource = (el) => {
      if (!el) return;
      el.draggable = true;
      el.addEventListener("dragstart", handleDragStart);
      el.addEventListener("dragend", handleDragEnd);
    };
    setupDragSource(card);
    setupDragSource(mediaEl);
    setupDragSource(meta);
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
    if (!fileId) return;
    openPreviewFileActionMenu(rec, { anchor: card });
  });

  const renameInput = card.querySelector(".previewFileRenameInput");
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
        renderPreviewPane(false, true);
        syncButtons();
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (commitRequested) return;
        commitRequested = true;
        await commitFileRenameEdit(fileId, renameInput);
      }
    });
    renameInput.addEventListener("blur", () => {
      if (commitRequested || RENAME_BUSY) return;
      RENAME_EDIT_FILE_ID = null;
      closeActionMenus();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    });
  }

  return card;
}
