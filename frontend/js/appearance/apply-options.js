/* Applying options
   Pushing options onto the document: media filters, media appearance, display
   sizes, interaction mode and the divider. The first function is a
   retired-thumbnail stub that applyMediaFilterFromOptions calls at load. */

function syncThumbFilterKeyWithCurrentAppearanceContext() { return false; }

function applyMediaFilterFromOptions(options = null) {
  const deferThumbSync = !!(options && options.deferThumbSync);
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const prevFilterMode = MEDIA_FILTER_STATE.mode || "off";
  MEDIA_OVERLAY_STATE = buildMediaOverlayConfigFromOptions(opt);
  const appEl = document.getElementById("app");
  if (!appEl) return;
  const filter = anyMediaFilterEnabled() ? "custom" : "off";
  if (filter && filter !== "off")
    appEl.setAttribute("data-media-filter", "custom-overlay");
  else appEl.removeAttribute("data-media-filter");
  const root = document.documentElement;
  if (root) {
    const thumbF = mediaOverlayConfigColorFilterCss(MEDIA_OVERLAY_STATE) || "none";
    root.style.setProperty("--thumb-filter", thumbF);
  }
  MEDIA_FILTER_STATE.mode = filter || "off";
  MEDIA_FILTER_STATE.animatedMode = normalizeAnimatedMediaFiltersValue(
    opt ? opt.animatedMediaFilters : null,
    "on",
  );
  if (prevFilterMode !== MEDIA_FILTER_STATE.mode) {
    MediaFilterEngine.detach("preview");
    MediaFilterEngine.detach("viewer");
    const quadSlots = getQuadPlaybackSlots();
    for (let i = 0; i < quadSlots.length; i++) {
      const slot = quadSlots[i];
      if (!slot) continue;
      MediaFilterEngine.detach(slot.surfaceName);
    }
  }
  if (syncThumbFilterKeyWithCurrentAppearanceContext()) {
    if (WS.root) {
      renderPreviewPane(false, true);
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }
  }
  const filtersActive = anyMediaFilterEnabled();
  if (!filtersActive) {
    MediaFilterEngine.reset("preview");
    MediaFilterEngine.reset("viewer");
    // With every filter off the resolved appearance is empty, so one sync per
    // element clears filter and corner mask together (and updates the cached
    // key, so the next sync after a re-enable is not skipped as a no-op).
    const clearedMediaEls = [previewImgEl, previewVideoEl, viewerImgEl, viewerVideoEl];
    const quadSlots = getQuadPlaybackSlots();
    for (let i = 0; i < quadSlots.length; i++) {
      const slot = quadSlots[i];
      if (!slot || !slot.videoEl) continue;
      MediaFilterEngine.reset(slot.surfaceName);
      clearedMediaEls.push(slot.videoEl);
    }
    for (let i = 0; i < clearedMediaEls.length; i++) {
      const el = clearedMediaEls[i];
      if (!el) continue;
      el.classList.remove("mediaHidden");
      syncMediaElementAppearance(el, null, "none");
    }
    appEl.removeAttribute("data-media-filter-engine");
  } else {
    const activeViewerItem =
      viewerItems && viewerItems.length
        ? viewerItems[viewerIndex] || null
        : null;
    const viewerRec =
      activeViewerItem && !activeViewerItem.isFolder
        ? WS.fileById.get(activeViewerItem.id) || null
        : null;
    const previewRec =
      WS.preview && WS.preview.kind === "file" && WS.preview.fileId
        ? WS.fileById.get(WS.preview.fileId) || null
        : null;
    if (VIEWER_MODE) {
      if (isQuadPlaybackMode()) {
        const quadSlots = getQuadPlaybackSlots();
        for (let i = 0; i < quadSlots.length; i++) {
          const slot = quadSlots[i];
          if (
            !slot ||
            !slot.videoEl ||
            slot.videoEl.style.display === "none" ||
            !slot.rec
          )
            continue;
          syncMediaFilterSurface(
            slot.surfaceName,
            slot.videoEl,
            slot.cellEl,
            "video",
            slot.rec,
          );
        }
      } else if (viewerVideoEl && viewerVideoEl.style.display !== "none") {
        syncMediaFilterSurface(
          "viewer",
          viewerVideoEl,
          viewport,
          "video",
          viewerRec,
        );
      } else if (viewerImgEl && viewerImgEl.style.display !== "none") {
        const mode = detectScrollImageMode(viewerRec, viewerImgEl);
        if (mode !== "none") {
          clearMediaFilterSurface("viewer", viewerImgEl);
          applyScrollImageProcessingFallback(viewerImgEl, viewerRec, mode);
        } else {
          applyScrollImageProcessingFallback(viewerImgEl, viewerRec, "none");
          syncMediaFilterSurface(
            "viewer",
            viewerImgEl,
            viewport,
            "image",
            viewerRec,
          );
        }
      }
    }
    if (ACTIVE_MEDIA_SURFACE === "preview") {
      if (previewVideoEl && previewVideoEl.style.display !== "none") {
        syncMediaFilterSurface(
          "preview",
          previewVideoEl,
          previewViewportBox,
          "video",
          previewRec,
        );
      } else if (previewImgEl && previewImgEl.style.display !== "none") {
        const mode = detectScrollImageMode(previewRec, previewImgEl);
        if (mode !== "none") {
          clearMediaFilterSurface("preview", previewImgEl);
          applyScrollImageProcessingFallback(previewImgEl, previewRec, mode);
        } else {
          applyScrollImageProcessingFallback(previewImgEl, previewRec, "none");
          syncMediaFilterSurface(
            "preview",
            previewImgEl,
            previewViewportBox,
            "image",
            previewRec,
          );
        }
      }
    }
  }
  MediaFilterEngine.requestRender();

  // Keep direct media fallback paths in sync; canvas-rendered paths apply color
  // filters inside the filter engine so combined effects are not double-applied.
  // A tall/wide scroll image keeps the scroll variant of the appearance (colour
  // only, no corner mask) — re-asserting the plain one here would round the
  // corners of a scrolling image every time a slider moved.
  try {
    const pTarget = WS.preview && WS.preview.kind === "file" && WS.preview.fileId ? WS.fileById.get(WS.preview.fileId) : null;
    syncMediaElementAppearance(
      previewImgEl,
      pTarget,
      previewImgEl ? detectScrollImageMode(pTarget, previewImgEl) : "none",
    );
    syncMediaElementAppearance(previewVideoEl, pTarget, "none");
  } catch {}

  if (deferThumbSync) scheduleMountedThumbColorFilterSync();
  else syncMountedThumbColorFilters();
}

function getCurrentColorFilterCssForTarget(target) {
  return mediaOverlayConfigColorFilterCss(
    resolveMediaOverlayConfigForTarget(target),
  );
}

function applyCssColorFilterForTarget(mediaEl, target) {
  if (!mediaEl) return "";
  const cssFilter = getCurrentColorFilterCssForTarget(target);
  if (cssFilter) {
    mediaEl.style.filter = cssFilter;
  } else {
    mediaEl.style.removeProperty("filter");
  }
  return cssFilter;
}

// ---------------------------------------------------------------------------
// Media appearance: one writer, applied idempotently.
//
// The CSS-level part of an appearance preset (colour filters, blur, the film
// corner mask) used to be written by four different helpers, each of which
// cleared the property before deciding what to put back. Because those helpers
// run from different frames (src assignment, `load`, a rAF follow-up, the WebGL
// engine's draw pass), a file change would clear the filter in one frame and
// restore it in the next -- which is exactly the on/off blink.
//
// syncMediaElementAppearance() is now the only writer. The value it produces is
// a pure function of the element's current target, it is cached on the element,
// and it is only ever *replaced*, never cleared-then-reapplied. Re-asserting it
// as often as we like is therefore free and cannot blink.
const MEDIA_APPEARANCE_STATE_KEY = "lgAppearance";

function mediaAppearanceStateForTarget(target, scrollMode = "none") {
  const scrolling = !!(scrollMode && scrollMode !== "none");
  if (scrolling) {
    // Tall/wide scroll images bypass the canvas entirely and get a colour-only
    // CSS approximation (no blur, no corner mask -- the image is cropped by the
    // scroll viewport, so rounding its corners would clip content).
    const css = scrollImageFallbackCssFilter(target, scrollMode);
    return { filter: css && css !== "none" ? css : "", cornerPct: 0 };
  }
  const cfg = resolveMediaOverlayConfigForTarget(target);
  const cornerRadius = Number((cfg && cfg.cornerRadius) || 0);
  return {
    filter: mediaOverlayConfigDirectFilterCss(cfg) || "",
    cornerPct: cornerRadius > 0 ? Math.max(0, Math.min(50, cornerRadius * 100)) : 0,
  };
}

function syncMediaElementAppearance(mediaEl, target, scrollMode = "none") {
  if (!mediaEl) return "";
  const next = mediaAppearanceStateForTarget(target, scrollMode);
  const key = `${next.filter}|${next.cornerPct}`;
  if (mediaEl.dataset[MEDIA_APPEARANCE_STATE_KEY] === key) return next.filter;
  if (next.filter) mediaEl.style.filter = next.filter;
  else mediaEl.style.removeProperty("filter");
  if (next.cornerPct > 0) {
    mediaEl.style.setProperty(
      "--pending-film-corner-radius",
      `${next.cornerPct}%`,
    );
    mediaEl.classList.add("pendingFilmCorners");
  } else {
    mediaEl.classList.remove("pendingFilmCorners");
    mediaEl.style.removeProperty("--pending-film-corner-radius");
  }
  mediaEl.dataset[MEDIA_APPEARANCE_STATE_KEY] = key;
  return next.filter;
}

// Anything that writes filter/corner state behind syncMediaElementAppearance's
// back must drop the cached key, or the next sync will skip as a no-op.
function invalidateMediaElementAppearance(mediaEl) {
  if (mediaEl && mediaEl.dataset) delete mediaEl.dataset[MEDIA_APPEARANCE_STATE_KEY];
}

function applyDirectMediaCssEffectsForTarget(mediaEl, target) {
  return syncMediaElementAppearance(mediaEl, target, "none");
}

function folderPreviewMediaThumbnailsEnabled(opt = null) {
  return true;
}

// Whether a thumbnail may paint media at all. Deliberately separate from
// folderPreviewMediaThumbnailsEnabled: that one picks the card *shape*, and
// switching shapes is not what "no thumbnails" should mean. Off, the cards are
// exactly the ones you would otherwise get, each showing its item icon.
function mediaThumbnailsEnabled(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return typeof src?.mediaThumbnails === "boolean"
    ? src.mediaThumbnails
    : MEDIA_THUMBNAILS_DEFAULT;
}

// Experimental -> Thumbnail edits. Off, no card applies a stored crop, zoom or
// video frame: every thumbnail is drawn as if none had been set. The stored
// values are never touched -- only the display readers (metaGetFileThumbnail
// CropForRecord, metaGetVideoThumbnailTimeForRecord) answer "none", and the
// editing keys refuse, since an edit made blind would start from the default
// and overwrite the real value.
function thumbnailEditsEnabled(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return typeof src?.thumbnailEdits === "boolean" ? src.thumbnailEdits : true;
}

// Experimental -> Default thumbnails only. On, every folder, Tag and the root
// shows its Default thumbnail (a Set's first file, a Model's first Set's first
// file, a Tag's rotation) whatever was picked for it. Picks, Blank and Shuffle
// stay stored exactly as they are -- only the display readers ignore them --
// and every way of changing a pick is shut, for the same reason as above.
function defaultThumbnailsOnlyEnabled(opt = null) {
  const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  return src?.defaultThumbnailsOnly === true;
}

// Both switches lock what they hide: true when the thumbnail-pick setters
// must refuse.
function thumbnailPicksLocked() {
  return defaultThumbnailsOnlyEnabled();
}

function mediaFilterEnabled() {
  return anyMediaFilterEnabled();
}

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  const shown =
    value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1);
  return `${shown} ${units[idx]}`;
}

function syncMediaFilterSurface(
  surfaceName,
  mediaEl,
  container,
  type,
  target = undefined,
) {
  if (!mediaEl || !container) return;
  let processingTarget = target;
  if (typeof processingTarget === "undefined") {
    if (mediaEl.hasAttribute("data-dir-path")) {
      processingTarget = mediaEl.getAttribute("data-dir-path") || "";
    } else {
      processingTarget = null;
    }
  }
  const overlayCfg = resolveMediaOverlayConfigForTarget(processingTarget);
  if (isGifRecord(processingTarget)) {
    // GIFs opt out of every appearance effect; the sync resolves to an empty
    // appearance for them, so this clears through the same cached path instead
    // of stomping the inline style behind its back.
    syncMediaElementAppearance(mediaEl, processingTarget, "none");
    mediaEl.classList.remove("mediaHidden");
    MediaFilterEngine.detach(surfaceName);
    return;
  }
  const needsProcessingPipeline =
    mediaOverlayConfigRequiresProcessingPipeline(overlayCfg);
  if (!needsProcessingPipeline) {
    applyDirectMediaCssEffectsForTarget(mediaEl, processingTarget);
    mediaEl.classList.remove("mediaHidden");
    MediaFilterEngine.detach(surfaceName);
    return;
  }
  MediaFilterEngine.attach(
    surfaceName,
    mediaEl,
    container,
    type,
    overlayCfg ? getMediaFilterForType(processingTarget) : "off",
    processingTarget,
  );
}

function clearPendingFilmCornerMask(mediaEl) {
  if (!mediaEl) return;
  mediaEl.classList.remove("pendingFilmCorners");
  mediaEl.style.removeProperty("--pending-film-corner-radius");
  invalidateMediaElementAppearance(mediaEl);
}

function applyPendingFilmCornerMask(mediaEl, processingTarget = null) {
  syncMediaElementAppearance(mediaEl, processingTarget, "none");
}

function clearMediaFilterSurface(surfaceName, mediaEl) {
  MediaFilterEngine.detach(surfaceName);
  clearPendingFilmCornerMask(mediaEl);
  if (mediaEl) mediaEl.classList.remove("mediaHidden");
}

function shouldHoldPreviewFilteredFrameForTarget(target) {
  if (!target || !anyMediaFilterEnabled()) return false;
  if (isGifRecord(target)) return false;
  if (!targetRequiresMediaProcessingPipeline(target)) return false;
  return MediaFilterEngine.hasSurfaceDrawn("preview");
}

function applyDisplaySizesFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  // The thumbnail-size setting is applied as a single multiplicative scale so
  // every grid mode (uniform, folder, and natural-aspect "rubber-band" rows)
  // shifts by the same factor while keeping its flexible wrapping behavior.
  const scaleMult = getActiveThumbnailScaleMultiplier(opt);
  root.removeAttribute("data-media-size");
  root.setAttribute("data-folder-size", "small");
  root.style.setProperty("--thumb-scale-media", String(scaleMult));
  root.style.setProperty("--thumb-scale-folder", String(scaleMult));
}

function applyDirectoryFolderCardLayoutFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  root.setAttribute("data-dir-folder-card-layout", "square");
}

function setActivePane(nextPane, opts = null) {
  if (!WS.view) return false;
  const pane =
    nextPane === "preview" || !directoriesPaneOpenEnabled()
      ? "preview"
      : "directories";
  const prev =
    WS.view.activePane === "preview" || WS.view.activePane === "directories"
      ? WS.view.activePane
      : "";
  if (prev === pane) return false;
  if (!(opts && opts.keepBulkSelection)) {
    finalizeBulkSelectionAction();
  }
  WS.view.activePane = pane;
  updateDirectorySelectionVisualsForActivePane();
  return true;
}

function updateDirectorySelectionVisualsForActivePane() {
  if (!WS.view || !WS.nav) return;
  const listEl =
    (typeof directoriesListEl !== "undefined" && directoriesListEl) ||
    document.getElementById("directoriesList");
  if (!listEl) return;
  const show = WS.view.activePane === "directories";
  const rows = listEl.querySelectorAll(".dirRow");
  const selIdx = Number(WS.nav.selectedIndex);
  rows.forEach((row) => {
    const rowIdx = Number(row.dataset.entryIndex);
    const isMatch = Number.isFinite(rowIdx) && Number.isFinite(selIdx) && rowIdx === selIdx;
    row.classList.toggle("selected", show && isMatch);
  });
}

function syncActivePaneWithLayout() {
  const appEl = document.getElementById("app");
  if (!WS.view) return;
  if (!directoriesPaneOpenEnabled()) {
    setActivePane("preview");
  } else if (
    WS.view.activePane !== "directories" &&
    WS.view.activePane !== "preview"
  ) {
    setActivePane("directories");
  }
  if (appEl) {
    appEl.classList.toggle(
      "directories-pane-active",
      WS.view.activePane === "directories",
    );
    appEl.classList.toggle(
      "preview-pane-active",
      WS.view.activePane === "preview",
    );
  }
}

function applyInteractionModeFromOptions() {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  const root = document.documentElement;
  const sidebarOpen = directoriesPaneOpenEnabled();
  const folderPreviewMediaThumbs = folderPreviewMediaThumbnailsEnabled();
  appEl.classList.toggle("no-root-selected", !WS.root);
  appEl.classList.toggle("sidebar-closed", !sidebarOpen);
  appEl.setAttribute(
    "data-folder-preview-media-thumbs",
    folderPreviewMediaThumbs ? "on" : "off",
  );
  if (root) {
    root.setAttribute(
      "data-folder-preview-media-thumbs",
      folderPreviewMediaThumbs ? "on" : "off",
    );
  }
  appEl.classList.remove("file-pane-thumbnail-view");
  appEl.classList.add("file-pane-list-view");
  appEl.classList.add("title-layout-pane");
  // The in-app Settings window floats over the app (position: fixed) and never
  // occupies a pane, so only the legacy Settings-only window reserves layout.
  const menuOccupiesPane = !!MENU_OPEN && IS_SETTINGS_WINDOW;
  appEl.classList.toggle("menu-pane-open", menuOccupiesPane);
  appEl.classList.toggle("no-side-panes", !sidebarOpen && !menuOccupiesPane);
  appEl.classList.remove("preview-media-pane-background");
  syncActivePaneWithLayout();
  updateGridModeListTopInset();
}

function applyLoadedOptionsToDocument() {
  applyColorSchemeFromOptions();
  applyTagFolderTitleColorsFromOptions();
  applyMediaFilterFromOptions();
  applyThumbFitFromOptions();
  applyThumbnailTitleSizeFromOptions();
  applyGlassDiffusionFromOptions();
  applyBubbleTintFromOptions();
  applyTopBarFromOptions();
  applyShowFileNamesFromOptions();
  applyTypeIconPlacementFromOptions();
  applyScorePlacementFromOptions();
  applyDisplaySizesFromOptions();
  applyDirectoryMiniThumbSizeFromOptions();
  applyDirectoryFileThumbLayoutFromOptions();
  applyDirectoryFolderCardLayoutFromOptions();
  applyNaturalAspectThumbnailModeFromOptions();
  applyDescriptionVisibilityFromOptions();
  applyInteractionModeFromOptions();
  applyPaneDividerFromOptions();
}

function applyOptionsEverywhere(invalidateThumbs = false) {
  const refreshOpenMenu = () => {
    refreshMenuTabAvailability();
    if (!MENU_OPEN) return;
    applyMenuPaneWidthFromOptions();
    setMenuTab(
      isMenuTabAvailable(MENU_ACTIVE_TAB) ? MENU_ACTIVE_TAB : "controls",
    );
  };
  if (!WS.root) {
    applyColorSchemeFromOptions();
    applyTagFolderTitleColorsFromOptions();
    applyMediaFilterFromOptions();
    applyThumbFitFromOptions();
    applyThumbnailTitleSizeFromOptions();
    applyGlassDiffusionFromOptions();
  applyBubbleTintFromOptions();
  applyTopBarFromOptions();
  applyShowFileNamesFromOptions();
  applyTypeIconPlacementFromOptions();
  applyScorePlacementFromOptions();
    applyDisplaySizesFromOptions();
    applyDirectoryMiniThumbSizeFromOptions();
    applyDirectoryFileThumbLayoutFromOptions();
    applyDirectoryFolderCardLayoutFromOptions();
    applyNaturalAspectThumbnailModeFromOptions();
    applyInteractionModeFromOptions();
    applyDescriptionVisibilityFromOptions();
    applyPaneDividerFromOptions();
    refreshOpenMenu();
    syncButtons();
    return;
  }

  if (invalidateThumbs) {
    invalidateAllThumbs();
  }

  applyColorSchemeFromOptions();
  applyTagFolderTitleColorsFromOptions();
  applyMediaFilterFromOptions();
  applyThumbFitFromOptions();
  applyThumbnailTitleSizeFromOptions();
  applyGlassDiffusionFromOptions();
  applyBubbleTintFromOptions();
  applyTopBarFromOptions();
  applyShowFileNamesFromOptions();
  applyTypeIconPlacementFromOptions();
  applyScorePlacementFromOptions();
  applyDisplaySizesFromOptions();
  applyDirectoryMiniThumbSizeFromOptions();
  applyDirectoryFileThumbLayoutFromOptions();
  applyDirectoryFolderCardLayoutFromOptions();
  applyNaturalAspectThumbnailModeFromOptions();
  applyInteractionModeFromOptions();
  applyDescriptionVisibilityFromOptions();
  canonicalizeActiveDirectoryReferences();
  rebuildDirectoriesEntries();
  WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
  canonicalizeActiveDirectoryReferences();
  preserveActivePreviewTargetDuringDirectoriesRefresh();
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  applyPaneDividerFromOptions();
  applyMediaFilterFromOptions();
  refreshOpenMenu();
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  if (VIEWER_MODE) renderViewerItem(viewerIndex);
  else if (ACTIVE_MEDIA_SURFACE === "preview")
    renderPreviewViewerItem(viewerIndex);
}

function applyDescriptionVisibilityFromOptions() {}

function applyPaneDividerFromOptions() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const pct =
    opt && typeof opt.leftPaneWidthPct === "number"
      ? opt.leftPaneWidthPct
      : opt && !Number.isNaN(parseFloat(opt.leftPaneWidthPct))
        ? parseFloat(opt.leftPaneWidthPct)
        : 0.28;
  setDividerPositionFromPct(pct);
}

function setDividerPositionFromPct(pct) {
  const appEl = document.getElementById("app");
  if (!appEl) return;
  if (!directoriesPaneOpenEnabled()) {
    appEl.style.removeProperty("grid-template-columns");
    const dividerEl = document.getElementById("divider");
    if (dividerEl) dividerEl.style.removeProperty("left");
    MediaFilterEngine.requestRender();
    return;
  }
  pct = Math.max(0.05, Math.min(0.9, Number(pct) || 0.28));
  const left = Math.round(appEl.clientWidth * pct);
  appEl.style.gridTemplateColumns = `${left}px 1fr`;
  const dividerEl = document.getElementById("divider");
  if (dividerEl) {
    dividerEl.style.left = left + "px";
  }
  // Keep filtered preview/video canvases in sync with live pane geometry while dragging the divider.
  MediaFilterEngine.requestRender();
}
