/* Key actions
   handleExtrasKeybindAction and grid movement. */

function handleExtrasKeybindAction(action) {
  if (!action || !WS.meta) return false;
  if (action === "volumeUp") return stepAppVolume(1);
  if (action === "volumeDown") return stepAppVolume(-1);
  if (handleMusicKeybindAction(action)) return true;
  const presetId = appearancePresetIdFromKeybindAction(action);
  if (presetId) {
    const preset = getAppearancePresetById(presetId);
    if (!preset) return false;
    const activeId = effectiveActiveAppearancePresetId();
    const currentlyApplied =
      activeId === presetId && currentAppearanceBucket() !== "editing";
    const nextPresetId = currentlyApplied
      ? BUILTIN_NULL_APPEARANCE_PRESET_ID
      : presetId;
    if (!applyAppearancePresetById(nextPresetId)) return false;
    showStatusMessage(
      `Appearance preset: ${appearancePresetDisplayName(nextPresetId, "Default")}`,
    );
    return true;
  }
  switch (action) {
    case "toggleSettingsAndDirectoriesPanes":
      return toggleSettingsAndDirectoriesPanesKeybindAction();
    case "refreshWorkspace":
      return refreshWorkspaceKeybindAction();
    case "grabReorderItem":
      return toggleGrabReorderKeybindAction();
    case "toggleGrokWindow":
      return toggleGrokWindowKeybindAction();
    case "toggleClaudeWindow":
      return toggleClaudeWindowKeybindAction();
    case "toggleVariationsWindow":
      return toggleVariationsWindowKeybindAction();
    case "toggleRandomModelOrder":
      return toggleRandomOrder("models");
    case "toggleRandomFolderSort":
      return toggleRandomOrder("sets");
    case "toggleRandomFileOrder":
      return toggleRandomOrder("files");
    case "randomFileInFolderJump":
      return randomFileJump("folder");
    case "randomFileInModelJump":
      return randomFileJump("model");
    case "randomFileInRootJump":
      return randomFileJump("root");
    case "randomFirstFileJump":
      return randomSetJump();
    case "randomRootSetJump":
      return randomRootSetJump();
    case "randomModelJump":
      return randomModelJump();
    case "jumpToRoot":
      return jumpToLibraryRoot();
    case "toggleAnimatedFilters": {
      const next = cycleOptionValue(
        "animatedMediaFilters",
        ANIMATED_FILTER_CYCLE,
      );
      refreshLiveSettingsPaneFromKeyboardAction();
      applyMediaFilterFromOptions();
      showStatusMessage(
        `Animated filters: ${labelForCycleValue(ANIMATED_FILTER_CYCLE, next)}`,
        "cycle-animated-filters",
      );
      return true;
    }
    case "cycleAppearancePresets":
      return cycleAppearancePresetKeybindAction();
    case "cycleFolderSort": {
      WS.meta.dirSortMode = cycleDirSortMode(
        WS.meta.dirSortMode,
        scoreInterfaceEnabled(),
      );
      invalidateDirSortOrderCaches();
      metaMarkDirty(META_DOC_IDS.prefGeneral);
      refreshLiveSettingsPaneFromKeyboardAction();
      applyFolderSortModeEverywhere(true);
      showStatusMessage(
        `Folder sort: ${dirSortModeLabel(WS.meta.dirSortMode)}`,
        "cycle-folder-sort",
      );
      return true;
    }
    case "cycleVideoEndBehavior": {
      const next = cycleOptionValue(
        "videoEndBehavior",
        VIDEO_END_BEHAVIOR_CYCLE,
      );
      refreshLiveSettingsPaneFromKeyboardAction();
      showStatusMessage(
        `Video end: ${labelForCycleValue(VIDEO_END_BEHAVIOR_CYCLE, next)}`,
        "cycle-video-end",
      );
      return true;
    }
    case "toggleShowHiddenFolder": {
      const next = toggleOptionValue("showHiddenFolder");
      invalidateHiddenVisibilityState();
      refreshLiveSettingsPaneFromKeyboardAction();
      if (!next && WS.view.tagFolderActiveMode === "hidden") {
        exitTagFolderView();
      }
      rebuildDirectoriesEntries();
      preserveActivePreviewTargetDuringDirectoriesRefresh();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage(`Reveal hidden items: ${next ? "On" : "Off"}`, "visibility-toggles");
      return true;
    }
    case "slideshow":
      return toggleSlideshow();
    case "toggleUtilityContainers": {
      const next = toggleOptionValue("showUtilityContainers");
      invalidateDirMetricsCaches();
      refreshLiveSettingsPaneFromKeyboardAction();
      if (!next) {
        // Step out of any of them that is open, the way each one's own
        // toggle used to.
        navigateOutOfTrashIfHidden();
        navigateOutOfStorageIfHidden();
        if (
          WS.view.tagFolderActiveMode === "untagged" ||
          (isViewingTagFolder() &&
            isViewOnlyTagName(normalizeTag(WS.view.tagFolderActiveTag || "")))
        )
          exitTagFolderView();
      }
      rebuildDirectoriesEntries();
      preserveActivePreviewTargetDuringDirectoriesRefresh();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage(`Utility containers: ${next ? "On" : "Off"}`, "visibility-toggles");
      return true;
    }
    case "toggleMuteMessages":
      if (!MUTE_MESSAGES_EXPOSED) return false;
      setMuteMessagesEnabled(!muteMessagesEnabled());
      return true;
    case "prevRootFolder":
      stepRootFolder(-1, "key");
      return true;
    case "nextRootFolder":
      stepRootFolder(1, "key");
      return true;
    case "toggleQuickNavigation": {
      const next = toggleOptionValue("quickNavigation");
      refreshLiveSettingsPaneFromKeyboardAction();
      showStatusMessage(`Quick navigation: ${next ? "On" : "Off"}`, "quick-navigation");
      return true;
    }
    case "toggleForceTitleCaps": {
      const next = toggleOptionValue("forceTitleCaps");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Force title caps: ${next ? "On" : "Off"}`);
      return true;
    }
    case "toggleShowPositionNumbers": {
      const next = toggleOptionValue("showPositionNumbersInNames");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Position number prefixes: ${next ? "On" : "Off"}`);
      return true;
    }
    case "toggleHideBeforeLastDash": {
      const next = toggleOptionValue("hideBeforeLastDashInFileNames");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Trim before last dash: ${next ? "On" : "Off"}`);
      return true;
    }
    case "toggleHideFileExtensions": {
      /* `hideFileExtensionsInFileNames` already existed and already worked --
         `fileDisplayName` has always consulted it -- but nothing ever exposed
         it, so it sat on its `true` default and extensions were unconditionally
         hidden. This is the switch it never had, not a new feature. */
      const next = toggleOptionValue("hideFileExtensionsInFileNames");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Hide file extensions: ${next ? "On" : "Off"}`);
      return true;
    }
    case "toggleShowFileNames": {
      const next = toggleOptionValue("showFileNames");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Show file names: ${next ? "On" : "Off"}`);
      return true;
    }
    case "cycleAppTheme": {
      const next = cycleOptionValue("appTheme", APP_THEME_CYCLE);
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Theme: ${labelForCycleValue(APP_THEME_CYCLE, next)}`);
      return true;
    }
    case "toggleFloatTags": {
      const next = toggleOptionValue("showTagFolderSpacerRow");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Float tags: ${next ? "On" : "Off"}`);
      return true;
    }
    case "toggleFloatSpecialContainers": {
      const next = toggleOptionValue("showSpecialContainerSpacerRow");
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(`Float utility containers: ${next ? "On" : "Off"}`);
      return true;
    }
    case "cycleThumbnailSize": {
      const next = cycleOptionValue("thumbnailSize", THUMBNAIL_SIZE_CYCLE);
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(
        `Thumbnail size: ${labelForCycleValue(THUMBNAIL_SIZE_CYCLE, next)}`,
      );
      return true;
    }
    case "cycleGlassDiffusion": {
      const next = cycleOptionValue("glassDiffusion", GLASS_DIFFUSION_CYCLE);
      refreshLiveSettingsPaneFromKeyboardAction();
      applyOptionsEverywhere(false);
      showStatusMessage(
        `Diffusion: ${labelForCycleValue(GLASS_DIFFUSION_CYCLE, next)}`,
      );
      return true;
    }
    case "cycleVideoSkipStep": {
      const next = cycleOptionValue("videoSkipStep", VIDEO_SKIP_STEP_CYCLE);
      refreshLiveSettingsPaneFromKeyboardAction();
      showStatusMessage(
        `Video skip step: ${labelForCycleValue(VIDEO_SKIP_STEP_CYCLE, next)}`,
      );
      return true;
    }
    default:
      return false;
  }
}

function moveDirectoriesSelection(delta) {
  if (!WS.root) return;
  if (!WS.nav.entries.length) return;

  // USER NOTE: keep a single selection path for files + folders.
  // Splitting file/folder movement logic here reintroduced file autoscroll regressions multiple times.
  WS.view.pendingDirScroll = "center-selected";
  setDirectoriesSelection(WS.nav.selectedIndex + delta);
}

function saveGridSelectionForCurrentContext() {
  if (!isGridInteractionMode()) return;
  if (
    !WS.view.gridSelectionByContext ||
    !(WS.view.gridSelectionByContext instanceof Map)
  ) {
    WS.view.gridSelectionByContext = new Map();
  }
  const key = directoriesScrollContextKey();
  if (!key) return;
  WS.view.gridSelectionByContext.set(key, WS.nav.selectedIndex | 0);
}

function restoreGridSelectionForCurrentContext(fallbackIndex = 0) {
  if (!isGridInteractionMode())
    return findNearestSelectableIndex(fallbackIndex, 1);
  const key = directoriesScrollContextKey();
  const saved =
    WS.view.gridSelectionByContext &&
    WS.view.gridSelectionByContext instanceof Map
      ? WS.view.gridSelectionByContext.get(key)
      : null;
  const seed = Number.isFinite(saved) ? Number(saved) : Number(fallbackIndex);
  return findNearestSelectableIndex(seed, 1);
}

let GRID_ROW_METRICS_CACHE_KEY = "";
let GRID_ROW_METRICS_CACHE = null;
function invalidateGridRowMetricsCache() {
  GRID_ROW_METRICS_CACHE_KEY = "";
  GRID_ROW_METRICS_CACHE = null;
}

function getGridRowMetrics() {
  if (!directoriesListEl) return [];
  const cacheKey = [
    directoriesScrollContextKey(),
    WS.nav.entries.length,
    directoriesListEl.clientWidth,
    directoriesListEl.clientHeight,
    directoriesListEl.scrollHeight,
    directoriesListEl.scrollWidth,
  ].join("|");
  if (GRID_ROW_METRICS_CACHE && GRID_ROW_METRICS_CACHE_KEY === cacheKey) {
    return GRID_ROW_METRICS_CACHE;
  }
  const rows = Array.from(directoriesListEl.querySelectorAll(".dirRow"));
  const out = [];
  for (const rowEl of rows) {
    const idx = Number(rowEl?.dataset?.entryIndex);
    if (!Number.isFinite(idx)) continue;
    const left = Number(rowEl.offsetLeft) || 0;
    const top = Number(rowEl.offsetTop) || 0;
    const width = Number(rowEl.offsetWidth) || 0;
    const height = Number(rowEl.offsetHeight) || 0;
    out.push({
      idx,
      rowEl,
      cx: left + width * 0.5,
      cy: top + height * 0.5,
    });
  }
  GRID_ROW_METRICS_CACHE_KEY = cacheKey;
  GRID_ROW_METRICS_CACHE = out;
  return out;
}

function moveGridSelectionByDirection(direction) {
  if (!WS.root || !WS.nav.entries.length) return false;
  const metrics = getGridRowMetrics();
  if (!metrics.length) return false;
  const selected = metrics.find((m) => m.idx === WS.nav.selectedIndex);
  if (!selected) return false;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const m of metrics) {
    if (!m || m.idx === selected.idx) continue;
    const dx = m.cx - selected.cx;
    const dy = m.cy - selected.cy;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let primary = 0;
    let secondary = 0;
    let valid = false;
    if (direction === "up" && dy < -2) {
      valid = true;
      primary = -dy;
      secondary = ax;
    } else if (direction === "down" && dy > 2) {
      valid = true;
      primary = dy;
      secondary = ax;
    } else if (direction === "left" && dx < -2) {
      valid = true;
      primary = -dx;
      secondary = ay;
    } else if (direction === "right" && dx > 2) {
      valid = true;
      primary = dx;
      secondary = ay;
    }
    if (!valid) continue;
    const score = primary * 1000 + secondary;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (!best) {
    const step = direction === "up" || direction === "left" ? -1 : 1;
    const start = Number.isFinite(WS.nav.selectedIndex)
      ? WS.nav.selectedIndex
      : 0;
    for (
      let idx = start + step;
      idx >= 0 && idx < WS.nav.entries.length;
      idx += step
    ) {
      const entry = WS.nav.entries[idx];
      if (!isSelectableEntry(entry)) continue;
      WS.view.pendingDirScroll = "grid-nearest";
      setDirectoriesSelection(idx, { keepScroll: true });
      return true;
    }
    return false;
  }
  WS.view.pendingDirScroll = "grid-nearest";
  setDirectoriesSelection(best.idx, { keepScroll: true });
  return true;
}

function getGridViewerItemForEntry(entry) {
  if (!entry) return null;
  if (entry.kind === "file") {
    const rec = WS.fileById.get(entry.id);
    if (!rec) return null;
    return { isFolder: false, id: rec.id };
  }
  if (entry.kind === "dir" && entry.node) {
    return { isFolder: true, dirNode: entry.node };
  }
  if (entry.kind === "tag") {
    const tagNode = makeTagPreviewNode(entry);
    if (tagNode) return { isFolder: true, dirNode: tagNode };
  }
  return null;
}

function renderCurrentGridSelectionInViewer() {
  if (!WS.root || !VIEWER_MODE) return false;
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  const item = getGridViewerItemForEntry(entry);
  if (!item) return false;
  viewerDirNode = WS.nav.dirNode || WS.root;
  viewerItems = [item];
  viewerIndex = 0;
  renderViewerItem(0);
  return true;
}

function moveGridGallerySelectionByDirection(direction) {
  if (!WS.root || !VIEWER_MODE || !isGridInteractionMode()) return false;
  const step = direction === "up" || direction === "left" ? -1 : 1;
  const slide = slideStepFileInternal(step);
  if (slide.moved) {
    WS.view.pendingDirScroll = "grid-nearest";
    setDirectoriesSelection(WS.nav.selectedIndex, { keepScroll: true });
    return renderCurrentGridSelectionInViewer();
  }
  let moved = false;
  const start = Number.isFinite(WS.nav.selectedIndex)
    ? WS.nav.selectedIndex
    : 0;
  for (
    let idx = start + step;
    idx >= 0 && idx < WS.nav.entries.length;
    idx += step
  ) {
    const entry = WS.nav.entries[idx];
    if (!entry || entry.kind !== "file") continue;
    WS.view.pendingDirScroll = "grid-nearest";
    setDirectoriesSelection(idx, { keepScroll: true });
    moved = true;
    break;
  }
  if (!moved) moved = moveGridSelectionByDirection(direction);
  if (!moved) return false;
  return renderCurrentGridSelectionInViewer();
}

function openSelectedEntryInGridMode(requestFullscreen = true) {
  if (!WS.root || !WS.nav.entries.length) return false;
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (!entry) return false;
  if (entry.kind === "file") {
    openGalleryFromDirectoriesSelection(!!requestFullscreen);
    return true;
  }
  if (entry.kind === "tag") {
    enterSelectedDirectory();
    return true;
  }
  if (entry.kind !== "dir" || !entry.node) return false;
  enterSelectedDirectory();
  return true;
}

function getDirectorySelectionForKeybindAction() {
  const out = [];
  const seen = new Set();
  let usedBulk = false;

  if (WS.view.bulkSelectMode) {
    const selected = getSelectedPathsInCurrentDir();
    if (selected.length) {
      usedBulk = true;
      for (let i = 0; i < selected.length; i++) {
        const p = String(selected[i] || "");
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
      return { paths: out, usedBulk, source: "bulk" };
    }
  }

  const previewCard = findSelectedPreviewCard();
  const previewKind = String(previewCard?.dataset?.previewItemKind || "");
  const previewKey = String(WS.view?.previewSelectedKey || "");
  if (previewKind === "dir" || previewKey.startsWith("dir:")) {
    const p = previewDirPathForCard(previewCard) || previewDirPathForSelectionKey(previewKey);
    if (p && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
    return { paths: out, usedBulk, source: "preview" };
  }

  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (entry && entry.kind === "dir") {
    const p = String(entry.node?.path || "");
    if (p && !seen.has(p)) out.push(p);
  }

  return { paths: out, usedBulk, source: out.length ? "directories" : "" };
}

function getFileSelectionForKeybindAction() {
  const out = [];
  const seen = new Set();
  let usedBulk = false;

  if (WS.view.bulkSelectMode) {
    const selected = getSelectedFileIdsInCurrentView();
    if (selected.length) {
      usedBulk = true;
      for (let i = 0; i < selected.length; i++) {
        const id = String(selected[i] || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
      }
      return { ids: out, usedBulk };
    }
  }

  const previewCard = findSelectedPreviewCard();
  const previewKind = String(previewCard?.dataset?.previewItemKind || "");
  const previewKey = String(WS.view?.previewSelectedKey || "");
  if (previewKind === "file" || previewKey.startsWith("file:")) {
    const id =
      previewFileIdForCard(previewCard) ||
      (previewKey.startsWith("file:") ? previewKey.slice(5) : "");
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
    return { ids: out, usedBulk };
  }

  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (entry && entry.kind === "file") {
    const id = String(entry.id || "");
    if (id && !seen.has(id)) out.push(id);
  }

  return { ids: out, usedBulk };
}

function getTagSelectionForKeybindAction() {
  const entries = [];
  const seen = new Set();
  let usedBulk = false;
  const addEntry = (entry) => {
    if (
      !entry ||
      entry.kind !== "tag" ||
      entry.special ||
      entry.placeholder
    )
      return;
    const tag = String(entry.tag || "").trim();
    const album = normalizeTagAlbumName(entry.album || "");
    const gallery = normalizeGalleryName(entry.gallery || "");
    if (!tag && !album && !gallery) return;
    const key = gallery
      ? `gallery:${gallery}`
      : `${String(entry.originPath || "")}\n${tag ? `tag:${tag}` : `album:${album}`}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  if (WS.view.bulkSelectMode) {
    const selected = getSelectedTagEntriesInCurrentView();
    for (let i = 0; i < selected.length; i++) addEntry(selected[i]);
    if (entries.length)
      return { entries, usedBulk: true, source: "bulk" };
  }

  const previewActive =
    !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
  const previewCard = findSelectedPreviewCard();
  const previewKind = String(previewCard?.dataset?.previewItemKind || "");
  const previewKey = String(WS.view?.previewSelectedKey || "");
  if (
    previewActive &&
    (previewKind === "tag" || previewKey.startsWith("tag:"))
  ) {
    addEntry(previewCard?.__previewTagEntry || null);
    if (entries.length)
      return { entries, usedBulk, source: "preview" };
  }

  addEntry(WS.nav.entries[WS.nav.selectedIndex] || null);
  return {
    entries,
    usedBulk,
    source: entries.length ? "directories" : "",
  };
}

function getFolderTargetPathsForSelectionActions() {
  const folderSelection = getDirectorySelectionForKeybindAction();
  if (folderSelection.paths.length) return folderSelection;

  const fileSelection = getFileSelectionForKeybindAction();
  const paths = [];
  const seen = new Set();
  for (let i = 0; i < fileSelection.ids.length; i++) {
    const rec = WS.fileById.get(String(fileSelection.ids[i] || ""));
    const dirPath = String(rec?.dirPath || "");
    if (!dirPath || seen.has(dirPath)) continue;
    seen.add(dirPath);
    paths.push(dirPath);
  }
  return { paths, usedBulk: fileSelection.usedBulk };
}

/* Put the file-pane cursor on an item. Every caller is an inline-edit starter
   that needs the cursor on the row it is about to draw an <input> in.

   The preview sync is deliberately *not* forced. Forcing it re-applies the
   preview state even when the selection did not actually move, and re-applying
   it re-derives the preview from the file pane -- which drops the grid cursor
   (`previewSelectedKey`) and, when the file pane and the grid are listing the
   same directory, swaps the grid for the single-item view. That is the
   "renaming jumped me somewhere else" bug, and it moved the location out from
   under an input that was about to be focused. Unforced, the sync still
   follows a selection that genuinely moved -- which is the normal model, the
   preview being one level below the file pane -- and does nothing when it did
   not, which is the case every rename is in. */
function selectDirectoryEntryByPath(path) {
  const p = String(path || "");
  if (!p) return false;
  const idx = findDirEntryIndexByPath(p);
  if (idx < 0) return false;
  WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
  syncPreviewToSelection();
  return true;
}

function selectFileEntryById(fileId) {
  const id = String(fileId || "");
  if (!id) return false;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (entry && entry.kind === "file" && String(entry.id || "") === id) {
      WS.nav.selectedIndex = findNearestSelectableIndex(i, 1);
      syncPreviewToSelection();
      return true;
    }
  }
  return false;
}
