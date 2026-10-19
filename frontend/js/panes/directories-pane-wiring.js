/* Directories pane wiring
   Its buttons, document listeners and the search field. */

// Legacy loop-repeat-on-scroll behavior was removed to avoid first/last adjacency in item lists.

if (favoritesBtn) {
  favoritesBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (WS.view.hiddenMode) toggleHiddenMode();
    toggleFavoritesMode();
  });
}

if (hiddenBtn) {
  hiddenBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (WS.view.favoritesMode) toggleFavoritesMode();
    toggleHiddenMode();
  });
}

if (directoriesSelectAllBtn) {
  directoriesSelectAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!canUseBulkSelection()) return;
    if (!WS.view.bulkSelectMode) return;
    const visible = Array.from(getVisibleFileIdsInEntries());
    if (!visible.length) return;
    if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear)
      WS.view.bulkFileSelectedIds.clear();
    for (let i = 0; i < visible.length; i++)
      WS.view.bulkFileSelectedIds.add(String(visible[i] || ""));
    renderDirectoriesPane(true);
  });
}

if (dirBackBtn) {
  dirBackBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goDirHistory(-1);
  });
}

if (dirForwardBtn) {
  dirForwardBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goDirHistory(1);
  });
}

if (dirUpBtn) {
  dirUpBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (VIEWER_MODE) {
      hideOverlay();
      return;
    }
    goDirUp();
  });
}

function exitBulkSelectModeIfNeeded(target) {
  if (!WS.view.bulkSelectMode) return false;
  if (!target || !target.closest) {
    exitBulkSelectMode();
    return true;
  }
  if (target.closest(".dirRow")) return false;
  if (target.closest(".folderCard")) return false;
  if (target.closest(".fileCard")) return false;
  if (target.closest("[data-preview-item-key]")) return false;
  if (target.closest(".dirMenu")) return false;
  if (target.closest(".dropdownMenu")) return false;
  if (target.closest("#directoriesActionRow")) return false;
  if (target.closest("#directoriesBulkRow")) return false;
  if (target.closest("#directoriesSearchRow")) return false;
  if (target.closest("#directoriesTagsRow")) return false;
  if (target.closest("#previewActionMenu")) return false;
  exitBulkSelectMode();
  return true;
}

function exitBulkSelectMode() {
  if (!WS.view.bulkSelectMode) return false;
  WS.view.bulkSelectMode = false;
  clearBulkTagSelection();
  renderDirectoriesPane(true);
  updatePreviewSelectionClasses();
  syncButtons();
  return true;
}

function isTextFieldElement(el) {
  if (!el || !el.tagName) return false;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return !!el.isContentEditable;
  const type = String(el.type || "text").toLowerCase();
  return (
    type === "text" ||
    type === "search" ||
    type === "url" ||
    type === "email" ||
    type === "number" ||
    type === "tel" ||
    type === "password"
  );
}

document.addEventListener(
  "pointerdown",
  (e) => {
    const active = document.activeElement;
    if (!isTextFieldElement(active)) return;
    const target = e.target;
    if (target === active) return;
    if (active && active.contains && active.contains(target)) return;
    try {
      active.blur();
    } catch {}
  },
  true,
);

document.addEventListener("click", async (e) => {
  const target = e.target;
  // A click landing outside the menus is a deliberate dismissal, so it drops
  // the auto-close suppression window an option activation may have opened.
  if (!target?.closest?.(".dropdownMenu, .dirMenu")) allowMenuClose();
  if (APP_MENU_STATE) {
    const anchor = APP_MENU_STATE.anchor || null;
    if (target && target.closest && target.closest("#appActionMenu")) {
      return;
    }
    if (
      anchor &&
      (target === anchor || (anchor.contains && anchor.contains(target)))
    ) {
      return;
    }
    closeAppMenu();
  }
  if (TAG_CONTEXT_MENU_STATE) {
    const anchor = TAG_CONTEXT_MENU_STATE.anchor || null;
    if (target && target.closest && target.closest("#tagActionMenu")) {
      return;
    }
    if (
      anchor &&
      (target === anchor || (anchor.contains && anchor.contains(target)))
    ) {
      return;
    }
    closeTagContextMenu();
  }
  if (previewActionMenuEl && previewActionMenuEl.classList.contains("open")) {
    if (target && target.closest && target.closest("#previewActionMenu")) {
      return;
    }
    closePreviewContextMenu();
  }
  if (SCORE_HISTORY_DAY_MENU_STATE) {
    const menu = document.getElementById("scoreHistoryDayMenu");
    const inMenu =
      target && target.closest && target.closest("#scoreHistoryDayMenu");
    if (inMenu) {
      const journalBtn =
        target && target.closest
          ? target.closest("button[data-score-history-journal-day]")
          : null;
      if (journalBtn) {
        e.preventDefault();
        e.stopPropagation();
        const dayKey = String(
          journalBtn.getAttribute("data-score-history-journal-day") || "",
        );
        openDailyJournalEditor(dayKey);
        return;
      }
      const dayRootBtn =
        target && target.closest
          ? target.closest(
              "button[data-score-history-delete-day-root][data-score-history-delete-day]",
            )
          : null;
      if (dayRootBtn) {
        e.preventDefault();
        e.stopPropagation();
        const dayKey = String(
          dayRootBtn.getAttribute("data-score-history-delete-day") || "",
        );
        const rootPath = String(
          dayRootBtn.getAttribute("data-score-history-delete-day-root") || "",
        );
        const removed = removeScoreHistoryLinesByDateAndRoot(dayKey, rootPath);
        if (removed > 0) {
          metaMarkDirty(META_DOC_IDS.scoreHistory);
          closeScoreHistoryDayMenu();
          renderCalendarUi();
          setCalendarStatus("Saved");
          showStatusMessage("Score log line deleted.");
        } else {
          setCalendarStatus("No changes");
        }
      }
      const dayBtn =
        target && target.closest
          ? target.closest("button[data-score-history-delete-day]")
          : null;
      if (dayBtn && !dayRootBtn) {
        e.preventDefault();
        e.stopPropagation();
        const dayKey = String(
          dayBtn.getAttribute("data-score-history-delete-day") || "",
        );
        if (!dayKey) return;
        const ok = await showConfirmDialog(
          `Delete all score log events on ${scoreHistoryDateLabel(dayKey)}?`,
          { okLabel: "Delete", danger: true },
        );
        if (!ok) return;
        const removed = removeScoreHistoryEntriesByDateKey(dayKey);
        if (removed > 0) {
          metaMarkDirty(META_DOC_IDS.scoreHistory);
          closeScoreHistoryDayMenu();
          renderCalendarUi();
          setCalendarStatus("Saved");
          showStatusMessage(
            `Deleted ${removed} score log event${removed === 1 ? "" : "s"}.`,
          );
        } else {
          setCalendarStatus("No changes");
        }
      }
      return;
    }
    const anchor = SCORE_HISTORY_DAY_MENU_STATE.anchor || null;
    if (
      anchor &&
      (target === anchor || (anchor.contains && anchor.contains(target)))
    ) {
      return;
    }
    if (menu && menu.classList.contains("open")) closeScoreHistoryDayMenu();
  }
  if (exitBulkSelectModeIfNeeded(target)) return;
  const hasActionMenu =
    WS.view.bulkActionMenuOpen ||
    WS.view.dirActionMenuPath ||
    WS.view.fileActionMenuId;
  const hasPreviewMenu = !!(
    previewActionMenuEl && previewActionMenuEl.classList.contains("open")
  );
  const hasAppMenu = !!(
    appActionMenuEl && appActionMenuEl.classList.contains("open")
  );
  if (!hasActionMenu && !hasPreviewMenu && !hasAppMenu) return;
  if (target && target.closest) {
    if (target.closest(".dirMenu")) return;
  }
  closeActionMenus();
  renderDirectoriesPane(true);
});

document.addEventListener("click", (e) => {
  if (!directoriesSearchInput) return;
  if (
    !(
      WS.view.dirSearchPinned ||
      WS.view.previewSearchActive ||
      String(WS.view.dirSearchQuery || "").trim()
    )
  )
    return;
  const target = e.target;
  if (target && target.closest) {
    if (target.closest("#directoriesSearchRow")) return;
    if (
      target.closest(
        "#appActionMenu, #previewActionMenu, #tagContextMenu, #menuOverlay, .dirMenu",
      )
    )
      return;
    if (target.closest(".dirRow")) return;
    if (target.closest("[data-preview-item-key]")) return;
    if (target.closest(".folderCard")) return;
    if (target.closest(".fileCard")) return;
  }
  clearDirectorySearchUi();
});

if (directoriesSearchInput) {
  directoriesSearchInput.addEventListener("click", (e) => {
    e.stopPropagation();
  });
  const startDirectorySearch = () => {
    if (!WS.root) return;
    const q = String(WS.view.dirSearchQuery || "").trim();
    if (!q) return;
    const searchInPreview = isCompactTitleLayout();
    const reuseExistingRoot =
      searchSessionActive() &&
      !!WS.view.previewSearchActive === !!searchInPreview;

    finalizeBulkSelectionAction();

    WS.view.dirSearchPinned = true;
    WS.view.previewSearchActive = !!searchInPreview;
    WS.view.searchRootActive = true;
    WS.view.searchAnchorPath = "";
    WS.view.searchEntryRootPath = "";

    if (searchInPreview) {
      if (!reuseExistingRoot) {
        const previewDir = getPreviewTargetDir() || WS.nav.dirNode || WS.root;
        WS.view.searchRootIsFavorites = false;
        WS.view.searchRootFavorites = [];
        WS.view.searchRootIsHidden = false;
        WS.view.searchRootHidden = [];
        WS.view.searchRootPath = String(previewDir?.path || "");
      }
      setActivePane("preview");
    } else {
      if (!reuseExistingRoot) {
        if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
          WS.view.searchRootIsFavorites = true;
          WS.view.searchRootFavorites = getAllFavoriteDirs();
          WS.view.searchRootIsHidden = false;
          WS.view.searchRootHidden = [];
          WS.view.searchRootPath = "";
        } else if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
          WS.view.searchRootIsFavorites = false;
          WS.view.searchRootFavorites = [];
          WS.view.searchRootIsHidden = true;
          WS.view.searchRootHidden = getAllHiddenDirs();
          WS.view.searchRootPath = "";
        } else {
          WS.view.searchRootIsFavorites = false;
          WS.view.searchRootFavorites = [];
          WS.view.searchRootIsHidden = false;
          WS.view.searchRootHidden = [];
          WS.view.searchRootPath = String(WS.nav.dirNode?.path || "");
        }
      }
    }

    computeDirectorySearchResults();
    const firstResult = WS.view.searchResults && WS.view.searchResults[0];
    WS.view.pendingPreviewSelectionKey = firstResult
      ? `dir:${String(firstResult.path || "")}`
      : "";

    TAG_EDIT_PATH = null;
    clearBulkTagPlaceholder();
    WS.view.dirSelectAnchorIndex = -1;
    WS.view.previewSelectAnchorKey = "";
    syncBulkSelectionForCurrentDir();

    if (searchResultsVisibleInPreviewPane()) {
      renderPreviewPane(true, false);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return;
    }

    rebuildDirectoriesEntries();
    WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
    syncPreviewToSelection({ force: true });
    renderDirectoriesPane(true);
    renderPreviewPane(true, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  };

  directoriesSearchInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      startDirectorySearch();
      try {
        directoriesSearchInput.blur();
      } catch {}
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      clearDirectorySearchUi();
    }
  });
  directoriesSearchInput.addEventListener("input", () => {
    const val = directoriesSearchInput.value || "";
    WS.view.dirSearchQuery = val;
    if (
      !String(val || "").trim() &&
      (WS.view.dirSearchPinned || WS.view.previewSearchActive)
    ) {
      clearDirectorySearchUi();
    }
  });
}
