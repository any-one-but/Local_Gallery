/* Directories pane layout
   Its headers, grid sizing, thumbnail worker limits and virtualization.
   (currentThumbWorkerCpuBudget is in core/runtime-state.js.) */

function renderDirectoriesTagsHeader() {
  if (!directoriesTagsRowEl) return;
  directoriesTagsRowEl.style.display = "none";
  directoriesTagsRowEl.innerHTML = "";
}

function renderDirectoriesActionHeader() {
  if (!directoriesActionRowEl || !directoriesActionMenuEl) return;

  if (!WS.root) {
    directoriesActionRowEl.style.display = "none";
    if (WS.view.bulkActionMenuOpen) {
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.bulkActionMenuPoint = null;
    }
    directoriesActionMenuEl.classList.remove("open");
    directoriesActionMenuEl.innerHTML = "";
    return;
  }

  const canBulk = canUseBulkSelection();
  if (!canBulk && WS.view.bulkSelectMode) {
    WS.view.bulkSelectMode = false;
    clearBulkTagSelection();
  }

  const selectedDirs = canBulk ? getSelectedPathsInCurrentDir() : [];
  const selectedTagFolders = canBulk
    ? getSelectedTagFolderKeysInCurrentView()
    : [];
  const selectedTagEntries = canBulk
    ? getSelectedTagEntriesInCurrentView()
    : [];
  const selectedFiles = canBulk ? getSelectedFileIdsInCurrentView() : [];
  const selCount =
    selectedDirs.length + selectedTagFolders.length + selectedFiles.length;
  const hasActionSelection =
    selectedDirs.length + selectedTagFolders.length + selectedFiles.length > 0;
  if (!selCount) {
    WS.view.bulkActionMenuOpen = false;
    WS.view.bulkActionMenuAnchorPath = "";
    WS.view.bulkActionMenuPoint = null;
  }

  const rowVisible =
    canBulk && (WS.view.bulkSelectMode || WS.view.bulkActionMenuOpen);
  directoriesActionRowEl.style.display = rowVisible ? "flex" : "none";

  if (directoriesSelectAllBtn) {
    const visibleFiles = canBulk
      ? Array.from(getVisibleFileIdsInEntries())
      : [];
    const allSelected =
      visibleFiles.length > 0 && selectedFiles.length === visibleFiles.length;
    directoriesSelectAllBtn.style.display = "none";
    directoriesSelectAllBtn.disabled =
      !WS.view.bulkSelectMode || !visibleFiles.length || allSelected;
  }

  const menuOpen = WS.view.bulkActionMenuOpen && canBulk && hasActionSelection;
  directoriesActionMenuEl.classList.toggle("open", menuOpen);
  directoriesActionMenuEl.innerHTML = "";

  if (!menuOpen) return;

  const anyAssignedAppearancePreset =
    !!selectedDirs.length &&
    selectedDirs.some((p) => metaHasFolderAppearancePreset(p));
  const presetAssignableTagEntries = selectedTagEntries.filter(
    (entry) =>
      entry &&
      entry.kind === "tag" &&
      !entry.special &&
      !entry.placeholder &&
      (!!String(entry.tag || "").trim() ||
        !!normalizeTagAlbumName(entry.album || "") ||
        !!normalizeGalleryName(entry.gallery || "")),
  );
  const tagAppearancePresetKeys = (() => {
    const out = [];
    const seen = new Set();
    for (let i = 0; i < presetAssignableTagEntries.length; i++) {
      const key = tagThumbnailKeyForEntry(presetAssignableTagEntries[i]);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
    return out;
  })();
  const anyAssignedTagAppearancePreset =
    !!tagAppearancePresetKeys.length &&
    tagAppearancePresetKeys.some((key) => metaHasTagAppearancePresetByKey(key));
  const tagMediaFilterTargets = [];
  const anyAssignedTagMediaFilter = false;
  const singleSelectedTagEntry =
    selectedTagEntries.length === 1 ? selectedTagEntries[0] || null : null;
  const singleRegularSelectedTagEntry =
    singleSelectedTagEntry &&
    !singleSelectedTagEntry.special &&
    !singleSelectedTagEntry.placeholder &&
    !!String(singleSelectedTagEntry.tag || "").trim() &&
    !normalizeTagAlbumName(singleSelectedTagEntry.album || "");
  const makeActionBtn = (
    label,
    onClick,
    closeMenu = true,
    className = "",
    disabled = false,
  ) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = !!disabled;
    if (className) btn.className = String(className);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      if (closeMenu) {
        closeActionMenus();
        renderDirectoriesPane(true);
      }
      onClick();
    });
    return btn;
  };

  const makeTwoColRow = (leftBtn, rightBtn) => {
    const frag = document.createDocumentFragment();
    if (leftBtn) frag.appendChild(leftBtn);
    if (rightBtn) frag.appendChild(rightBtn);
    return frag;
  };

  if (selectedTagEntries.length) {
    // Tag, album, rename, delete, and hide stay out of item menus. The same
    // bindable actions handle both individual and multi-selected tag entries.
    if (singleRegularSelectedTagEntry) {
      directoriesActionMenuEl.appendChild(
        makeActionBtn("Create inverse", () => {
          WS.view.bulkActionMenuOpen = false;
          createInverseTagForEntry(singleRegularSelectedTagEntry);
          finalizeBulkSelectionAction();
        }),
      );
    }
  }

  if (!selectedFiles.length && (selectedDirs.length || selectedTagEntries.length)) {
    const bulkThumbnailSubmenu = createBulkThumbnailSubmenu(
      bulkThumbnailTargetsFromSelection(selectedDirs, selectedTagEntries),
      {
        closeMenus: () => {
          closeActionMenus();
          renderDirectoriesPane(true);
        },
      },
    );
    if (bulkThumbnailSubmenu)
      directoriesActionMenuEl.appendChild(bulkThumbnailSubmenu);
  }

  if (tagAppearancePresetKeys.length) {
    const dirTagFiltersSubmenu = buildAppearancePresetSubmenu({
      currentPresetId:
        tagAppearancePresetKeys.length === 1
          ? metaGetTagAppearancePresetIdByKey(tagAppearancePresetKeys[0])
          : "",
      hasOverride: anyAssignedTagAppearancePreset,
      onChoosePreset: (presetId) => {
        closeActionMenus();
        renderDirectoriesPane(true);
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
        finalizeBulkSelectionAction();
      },
      onClear: () => {
        closeActionMenus();
        renderDirectoriesPane(true);
        let changed = false;
        for (let i = 0; i < tagAppearancePresetKeys.length; i++) {
          if (metaClearTagAppearancePresetByKey(tagAppearancePresetKeys[i]))
            changed = true;
        }
        if (!changed) return;
        refreshAfterProcessingMetadataChange();
        showStatusMessage("Tag media preset reset.");
        finalizeBulkSelectionAction();
      },
    });
    if (dirTagFiltersSubmenu)
      directoriesActionMenuEl.appendChild(dirTagFiltersSubmenu);
  }

  if (tagMediaFilterTargets.length) {
    directoriesActionMenuEl.appendChild(
      makeActionBtn(
        "Set content filter",
        () => {
          const currentValue =
            tagMediaFilterTargets.length === 1
              ? metaGetTagMediaFilterByKey(tagMediaFilterTargets[0])
              : [];
          buildTagMediaFilterChoiceMenu(directoriesActionMenuEl, {
            title: "Tag content filter",
            currentValue,
            onBack: () => {
              renderDirectoriesActionHeader();
              if (
                directoriesActionMenuEl.classList.contains("open") &&
                anchorBtn
              ) {
                requestAnimationFrame(() =>
                  positionDropdownMenu(anchorBtn, directoriesActionMenuEl),
                );
              }
            },
            onChoose: (nextValue) => {
              let changed = false;
              for (let i = 0; i < tagMediaFilterTargets.length; i++) {
                if (
                  metaSetTagMediaFilterByKey(
                    tagMediaFilterTargets[i],
                    nextValue,
                  )
                )
                  changed = true;
              }
              if (!changed) return;
              metaScheduleSave();
              refreshAfterTagMetadataChange();
              showStatusMessage(
                `Tag content filter: ${describeTagMediaFilterValue(nextValue)}.`,
              );
              finalizeBulkSelectionAction();
            },
            onRendered: () => {
              if (anchorBtn)
                positionDropdownMenu(anchorBtn, directoriesActionMenuEl);
            },
          });
        },
        false,
      ),
    );
  }

  if (anyAssignedTagMediaFilter) {
    directoriesActionMenuEl.appendChild(
      makeActionBtn("Clear content filter", () => {
        WS.view.bulkActionMenuOpen = false;
        let changed = false;
        for (let i = 0; i < tagMediaFilterTargets.length; i++) {
          if (metaClearTagMediaFilterByKey(tagMediaFilterTargets[i]))
            changed = true;
        }
        if (!changed) return;
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage("Tag content filter cleared.");
        finalizeBulkSelectionAction();
      }),
    );
  }

  if (selectedDirs.length) {
    const selectedFileRecordsForTrashMenu = selectedFiles.length
      ? getSelectedFileRecordsInCurrentView()
      : [];
    const selectedFileTrashTargetsForTrashMenu = Array.from(
      new Set(
        selectedFileRecordsForTrashMenu
          .map((rec) => trashTopLevelItemPathForFileRecord(rec))
          .filter(Boolean),
      ),
    );
    const selectedFileStoragePathsForTrashMenu = Array.from(
      new Set(
        selectedFileRecordsForTrashMenu
          .map((rec) => String(rec?.dirPath || ""))
          .filter((path) => path && pathIsStorageQuarantine(path)),
      ),
    );
    const selectedFilesAreQuarantineItems =
      !selectedFiles.length ||
      (selectedFileRecordsForTrashMenu.length === selectedFiles.length &&
        selectedFileRecordsForTrashMenu.every(
          (rec) =>
            !!trashTopLevelItemPathForFileRecord(rec) ||
            fileRecordIsStorageQuarantine(rec),
        ));
    const quarantineTrashPaths = new Set(
      selectedFileTrashTargetsForTrashMenu,
    );
    selectedDirs.forEach((path) => {
      const trashPath = trashTopLevelItemPathForPath(path);
      if (trashPath) quarantineTrashPaths.add(trashPath);
    });
    const quarantineStoragePaths = new Set(
      selectedFileStoragePathsForTrashMenu,
    );
    selectedDirs.forEach((path) => {
      if (pathIsStorageQuarantine(path)) quarantineStoragePaths.add(path);
    });
    const quarantineOnlyContext =
      selectedFilesAreQuarantineItems &&
      selectedDirs.every(
        (path) =>
          !!trashTopLevelItemPathForPath(path) ||
          pathIsStorageQuarantine(path),
      ) &&
      (quarantineTrashPaths.size || quarantineStoragePaths.size);
    if (quarantineOnlyContext) {
      if (quarantineTrashPaths.size) {
        directoriesActionMenuEl.appendChild(
          makeActionBtn(
            "Remove from Trash",
            async () => {
              await putBackTrashFolderPaths(Array.from(quarantineTrashPaths));
              if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
            },
            true,
            "",
            !WS.meta.fsRootHandle,
          ),
        );
      }
      if (quarantineStoragePaths.size) {
        directoriesActionMenuEl.appendChild(
          makeActionBtn("Remove from Storage", async () => {
            await setStorageStateForFolderPaths(
              Array.from(quarantineStoragePaths),
              false,
            );
            if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
          }),
        );
      }
    } else {
      // Tag / Album / Rename / Favorite / Store / Hide / Move to trash are all
      // keybound now (the *Selection actions) and intentionally omitted from the
      // multiselect menu. Only Filters (below) remains.
      const dirFolderFiltersSubmenu = buildAppearancePresetSubmenu({
        currentPresetId:
          selectedDirs.length === 1
            ? effectiveAppearancePresetIdForMenuPath(selectedDirs[0])
            : "",
        hasOverride: anyAssignedAppearancePreset,
        onChoosePreset: (presetId) => {
          closeActionMenus();
          renderDirectoriesPane(true);
          let changed = false;
          for (let i = 0; i < selectedDirs.length; i++) {
            if (metaSetFolderAppearancePresetId(selectedDirs[i], presetId))
              changed = true;
          }
          if (!changed) return;
          refreshAfterProcessingMetadataChange();
          showStatusMessage(
            `Folder media preset: ${appearancePresetDisplayName(presetId)}.`,
          );
          finalizeBulkSelectionAction();
        },
        onClear: () => {
          closeActionMenus();
          renderDirectoriesPane(true);
          let changed = false;
          for (let i = 0; i < selectedDirs.length; i++) {
            if (metaClearFolderAppearancePreset(selectedDirs[i]))
              changed = true;
          }
          if (!changed) return;
          refreshAfterProcessingMetadataChange();
          showStatusMessage("Folder media preset reset to inherited.");
          finalizeBulkSelectionAction();
        },
      });
      if (dirFolderFiltersSubmenu)
        directoriesActionMenuEl.appendChild(dirFolderFiltersSubmenu);
    }
  }


  // Some selections (most notably files outside quad playback) have no
  // remaining contextual menu actions after the bindable actions are removed.
  // Keep the menu closed instead of displaying an empty popup.
  if (!directoriesActionMenuEl.children.length) {
    WS.view.bulkActionMenuOpen = false;
    directoriesActionMenuEl.classList.remove("open");
    return;
  }

  const anchorBtn = findDirMenuButtonForAnchorKey(
    WS.view.bulkActionMenuAnchorPath,
  );
  if (anchorBtn) {
    requestAnimationFrame(() =>
      positionDropdownMenu(anchorBtn, directoriesActionMenuEl),
    );
  } else if (
    WS.view.bulkActionMenuPoint &&
    Number.isFinite(Number(WS.view.bulkActionMenuPoint.x)) &&
    Number.isFinite(Number(WS.view.bulkActionMenuPoint.y))
  ) {
    const x = Number(WS.view.bulkActionMenuPoint.x);
    const y = Number(WS.view.bulkActionMenuPoint.y);
    requestAnimationFrame(() =>
      positionDropdownMenuAtPoint(directoriesActionMenuEl, x, y),
    );
  }
}

function findDirMenuButtonForAnchorKey(anchorKey) {
  const key = String(anchorKey || "");
  if (!directoriesListEl) return null;
  const rows = directoriesListEl.querySelectorAll(
    ".dirRow, [data-file-pane-item]",
  );
  let fallback = null;
  for (const row of rows) {
    const btn = row.querySelector(".dirMenuBtn");
    if (btn && !fallback) fallback = btn;
    if (key && row.dataset && row.dataset.bulkAnchor === key) {
      return btn;
    }
  }
  return fallback;
}

function findDirRowForPath(path) {
  if (!directoriesListEl) return null;
  const rows = directoriesListEl.querySelectorAll(".dirRow");
  for (const row of rows) {
    if (String(row?.dataset?.dirPath || "") === String(path || "")) return row;
  }
  return null;
}

function setDirectoriesHeaderActive(active) {
  if (!directoriesHeader) return;
  directoriesHeader.classList.toggle("active", !!active);
}

function applyDirectoriesFilesOnlyChromeMode(active) {
  if (!document || !document.body) return;
  document.body.classList.toggle("directories-files-only", !!active);
}

function renderDirectoriesBulkHeader() {
  if (!directoriesBulkRowEl) return;
  directoriesBulkRowEl.style.display = "none";
  directoriesBulkRowEl.innerHTML = "";
}

let LAST_DIRECTORIES_SCROLL_CONTEXT = "";
function directoriesScrollContextKey() {
  if (!WS.root) return "none";
  if (WS.view.aboveRootView) return "above-root";
  if (isViewingTagFolder()) {
    return `tag:${String(WS.view.tagFolderActiveMode || "")}:${String(WS.view.tagFolderActiveTag || "")}:${String(WS.view.tagFolderActiveAlbum || "")}:${String(WS.view.tagFolderOriginPath || "")}`;
  }
  if (searchResultsVisibleInDirectoriesPane()) {
    return `search:${String(WS.view.searchRootPath || "")}`;
  }
  if (WS.view.favoritesMode && WS.view.favoritesRootActive)
    return "favorites-root";
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden-root";
  return `dir:${String(WS.nav.dirNode?.path || "")}`;
}

let GRID_CARD_SIZE_RAF = 0;
function gridModeColumnCountForScale(scaleValue) {
  const scale = normalizeThumbnailScaleValue(scaleValue, "row7");
  const cols = GRID_CROPPED_COLS_BY_SCALE[scale];
  if (Number.isFinite(cols) && cols >= 1) return cols;
  return GRID_CROPPED_COLS_BY_SCALE.row7;
}

function applyGridModeCardSizing() {
  if (!directoriesListEl) return;
  if (
    !isGridInteractionMode() ||
    !directoriesListEl.classList.contains("gridModeList")
  ) {
    directoriesListEl.style.removeProperty("--grid-card-size");
    directoriesListEl.style.removeProperty("--grid-cols");
    invalidateGridRowMetricsCache();
    return;
  }
  const cs = getComputedStyle(directoriesListEl);
  const padLeft = parseFloat(cs.paddingLeft || "0") || 0;
  const padRight = parseFloat(cs.paddingRight || "0") || 0;
  const gap = Math.max(0, parseFloat(cs.columnGap || cs.gap || "0") || 0);
  const available = Math.max(
    0,
    directoriesListEl.clientWidth - padLeft - padRight,
  );
  if (available <= 0) return;
  const activeScale = getActiveThumbnailScale(
    WS.meta && WS.meta.options ? WS.meta.options : null,
  );
  let cols = gridModeColumnCountForScale(activeScale);
  const baseMin = Math.max(
    120,
    parseFloat(cs.getPropertyValue("--grid-card-min") || "0") || 120,
  );
  while (cols > 1) {
    const candidate = (available - gap * Math.max(0, cols - 1)) / cols;
    if (candidate >= baseMin * 0.6) break;
    cols -= 1;
  }
  if (!Number.isFinite(cols) || cols < 1) cols = 1;
  // Fit cards exactly to the width for each scale tier so rows stay gapless.
  const card = Math.max(80, (available - gap * Math.max(0, cols - 1)) / cols);
  directoriesListEl.style.setProperty("--grid-cols", String(cols));
  directoriesListEl.style.setProperty(
    "--grid-card-size",
    `${card.toFixed(3)}px`,
  );
  invalidateGridRowMetricsCache();
}

function scheduleGridModeCardSizing() {
  if (GRID_CARD_SIZE_RAF) {
    try {
      cancelAnimationFrame(GRID_CARD_SIZE_RAF);
    } catch {}
    GRID_CARD_SIZE_RAF = 0;
  }
  GRID_CARD_SIZE_RAF = requestAnimationFrame(() => {
    GRID_CARD_SIZE_RAF = 0;
    applyGridModeCardSizing();
  });
}

function navigationThumbWorkerLimit(kind = "blocking") {
  const cores = currentThumbWorkerCpuBudget();
  if (kind === "startup") return Math.max(4, Math.min(8, cores));
  if (kind === "background")
    return Math.max(2, Math.min(4, Math.floor(cores / 2)));
  return Math.max(3, Math.min(6, Math.floor((cores * 3) / 4)));
}

function videoThumbPoolLimits() {
  const cores = currentThumbWorkerCpuBudget();
  const active = Math.max(2, Math.min(3, Math.floor((cores + 1) / 3)));
  const background = 0;
  return { active, background };
}

function imageThumbPoolLimit() {
  const cores = currentThumbWorkerCpuBudget();
  return Math.max(2, Math.min(3, Math.floor((cores + 2) / 4)));
}

function shouldVirtualizeDirectoriesPane(gridModeActive) {
  // The tag/album file-pane virtualizer can strand the list after the first
  // mounted window when users scroll quickly through many folders. Keep tag
  // folders fully mounted until this path is replaced with a measured virtual
  // list that cannot produce a blank spacer-only wall.
  return false;
}

function measureDirectoriesGridVirtualMetrics() {
  if (!directoriesListEl) return null;
  const cs = getComputedStyle(directoriesListEl);
  const gap = Math.max(0, parseFloat(cs.rowGap || cs.gap || "0") || 0);
  const card = Math.max(
    80,
    parseFloat(cs.getPropertyValue("--grid-card-size") || "0") || 0,
  );
  const colsRaw = parseInt(cs.getPropertyValue("--grid-cols"), 10);
  const cols = Math.max(1, Number.isFinite(colsRaw) ? colsRaw : 1);
  const rowHeight = Math.max(96, card) + gap;
  return { gap, card, cols, rowHeight };
}

function measureDirectoriesListVirtualMetrics() {
  if (!directoriesListEl) return null;
  const cs = getComputedStyle(directoriesListEl);
  const gap = Math.max(0, parseFloat(cs.rowGap || cs.gap || "0") || 0);
  const fontSize = Math.max(10, parseFloat(cs.fontSize || "12") || 12);
  const rowHeight = Math.max(34, Math.round(fontSize * 1.5 + 16 + gap));
  return { gap, card: rowHeight, cols: 1, rowHeight };
}

function measureDirectoriesVirtualMetrics(gridModeActive) {
  return gridModeActive
    ? measureDirectoriesGridVirtualMetrics()
    : measureDirectoriesListVirtualMetrics();
}

function computeDirectoriesVirtualWindow(
  entryCount,
  metrics,
  suppressSelectionReveal = false,
) {
  if (!directoriesListEl || !metrics || !entryCount) return null;
  const totalRows = Math.max(
    1,
    Math.ceil(entryCount / Math.max(1, metrics.cols)),
  );
  const scrollTop = Math.max(0, Number(directoriesListEl.scrollTop) || 0);
  const clientHeight = Math.max(1, Number(directoriesListEl.clientHeight) || 1);
  let anchorRow = Math.max(
    0,
    Math.floor(scrollTop / Math.max(1, metrics.rowHeight)),
  );
  const viewportRows = Math.max(
    1,
    Math.ceil((clientHeight + metrics.gap) / Math.max(1, metrics.rowHeight)),
  );
  const selectedRow = Math.max(
    0,
    Math.floor(
      Math.max(0, Number(WS.nav.selectedIndex) || 0) /
        Math.max(1, metrics.cols),
    ),
  );
  if (
    !suppressSelectionReveal &&
    (WS.view.pendingDirScroll === "center-selected" ||
      WS.view.pendingDirScroll === "grid-nearest" ||
      selectedRow < anchorRow ||
      selectedRow > anchorRow + viewportRows)
  ) {
    anchorRow = Math.max(0, selectedRow - Math.floor(viewportRows / 2));
  }
  const overscanRows = 2;
  const startRow = Math.max(0, anchorRow - overscanRows);
  const endRow = Math.min(
    totalRows - 1,
    anchorRow + viewportRows + overscanRows,
  );
  return {
    startIndex: startRow * metrics.cols,
    endIndexExclusive: Math.min(entryCount, (endRow + 1) * metrics.cols),
    topSpacerHeight: startRow * metrics.rowHeight,
    bottomSpacerHeight: Math.max(
      0,
      (totalRows - endRow - 1) * metrics.rowHeight,
    ),
  };
}

function appendVirtualFlexSpacer(frag, heightPx, gridModeActive = false) {
  const height = Math.max(0, Math.round(Number(heightPx) || 0));
  if (!frag || height <= 0) return;
  const spacer = document.createElement("div");
  spacer.className = "virtualFlexSpacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.height = `${height}px`;
  if (gridModeActive) {
    spacer.style.flex = "0 0 100%";
    spacer.style.width = "100%";
  } else {
    spacer.style.flex = "0 0 auto";
    spacer.style.width = "100%";
  }
  frag.appendChild(spacer);
}

function scheduleDirectoriesVirtualViewportRefresh() {
  if (!directoriesListEl || directoriesListEl.dataset.virtualized !== "1")
    return;
  if (DIRECTORIES_VIRTUAL_SCROLL_RAF) return;
  DIRECTORIES_VIRTUAL_SCROLL_RAF = requestAnimationFrame(() => {
    DIRECTORIES_VIRTUAL_SCROLL_RAF = 0;
    if (!directoriesListEl || directoriesListEl.dataset.virtualized !== "1")
      return;
    renderDirectoriesPane(true, { suppressSelectionReveal: true });
  });
}

function entryBulkSelected(entry) {
  if (!entry || !WS.view || !WS.view.bulkSelectMode) return false;
  if (entry.kind === "dir") {
    const p = String(entry.node?.path || "");
    return !!p && WS.view.bulkTagSelectedPaths.has(p);
  }
  if (entry.kind === "file") {
    const id = String(entry.id || "");
    return !!id && WS.view.bulkFileSelectedIds.has(id);
  }
  if (entry.kind === "tag") {
    const key = tagEntrySelectionKey(entry);
    return !!key && WS.view.bulkTagFolderSelectedKeys.has(key);
  }
  return false;
}

function forcePreviewPaneThumbTitleBar(meta) {
  if (!meta || !meta.style || !meta.classList) return;
  if (
    meta.classList.contains("previewThumbOverlayMetaMenuOnly") ||
    meta.classList.contains("thumbOverlayMetaMenuOnly") ||
    meta.classList.contains("dirSquareOverlayMenuOnly") ||
    meta.classList.contains("dirFileOverlayMenuOnly")
  ) {
    meta.style.setProperty("background", "none", "important");
    meta.style.setProperty("background-color", "transparent", "important");
    meta.style.setProperty("background-image", "none", "important");
    meta.style.setProperty("border-top", "0", "important");
    meta.style.setProperty("backdrop-filter", "none", "important");
    meta.style.setProperty("-webkit-backdrop-filter", "none", "important");
    return;
  }
  // Never fall back to solid secondary — that was the flash on first paint
  // before the frosted var resolved / when media behind was still empty.
  const fg = "var(--preview-pane-thumb-title-bar-fg)";
  meta.style.setProperty("background", "transparent", "important");
  meta.style.setProperty("background-color", "transparent", "important");
  meta.style.setProperty("background-image", "none", "important");
  meta.style.setProperty("opacity", "1", "important");
  meta.style.setProperty("backdrop-filter", "none", "important");
  meta.style.setProperty("-webkit-backdrop-filter", "none", "important");
  meta.style.setProperty("box-shadow", "none", "important");
  meta.style.setProperty("border-top", "0", "important");
  meta.style.setProperty("color", fg, "important");
}
