/* Gallery viewer
   The overlay viewer, slideshow and stepping through its items. */

/* =========================================================
       Image thumbnails (lazy) for Preview Pane
       ========================================================= */

/* =========================================================
       Gallery Mode (Overlay)
       - Rotated control model:
         Up/Down = previous/next item
         Left/Right = leave/enter directory
       - Nav buttons now represent Left/Right directory actions
       ========================================================= */

function buildViewerItemsForDir(dirNode) {
  const items = [];
  if (!dirNode) return items;
  const usePreviewContextItems =
    !VIEWER_MODE &&
    WS.preview &&
    WS.preview.kind === "file" &&
    WS.preview.dirNode === dirNode;
  if (usePreviewContextItems) {
    const previewEntries = getPreviewFolderAndFileEntries(dirNode, {
      includeFiles: true,
      useCurrentViewEntries: true,
    });
    const folderEntries = Array.isArray(previewEntries.folderEntries)
      ? previewEntries.folderEntries
      : [];
    const fileIds = Array.isArray(previewEntries.fileIds)
      ? previewEntries.fileIds
      : [];
    for (let i = 0; i < folderEntries.length; i++) {
      const entry = folderEntries[i];
      if (!entry) continue;
      if (entry.kind === "dir" && entry.node) {
        items.push({ isFolder: true, dirNode: entry.node });
        continue;
      }
      if (entry.kind === "tag") {
        const tagNode = makeTagPreviewNode(entry);
        if (tagNode) items.push({ isFolder: true, dirNode: tagNode });
      }
    }
    for (let i = 0; i < fileIds.length; i++)
      items.push({ isFolder: false, id: fileIds[i] });
    return items;
  }

  const dirs = getChildDirsForNode(dirNode);
  for (const d of dirs) items.push({ isFolder: true, dirNode: d });

  const ids = getOrderedFileIdsForDir(dirNode);
  for (const id of ids) items.push({ isFolder: false, id });

  return items;
}

function pausePreviewVideoForOverlay() {
  PREVIEW_VIDEO_PAUSE.active = false;
  PREVIEW_VIDEO_PAUSE.fileId = null;
  PREVIEW_VIDEO_PAUSE.time = 0;
  PREVIEW_VIDEO_PAUSE.wasPlaying = false;

  if (WS.preview.kind !== "file" || !WS.preview.fileId) return;
  const rec = WS.fileById.get(WS.preview.fileId);
  if (!rec || rec.type !== "video") return;
  if (!previewVideoEl || previewVideoEl.style.display === "none") return;

  try {
    VIDEO_CARRY.active = true;
    VIDEO_CARRY.fileId = rec.id;
    VIDEO_CARRY.time = previewVideoEl.currentTime || 0;
    VIDEO_CARRY.wasPlaying = !previewVideoEl.paused;
    cancelResponsiveVideoSeek(previewVideoEl);
    previewVideoEl.pause();
  } catch {}
}

function resumePreviewVideoAfterOverlay() {
  if (!VIDEO_CARRY.active) return;
  if (!previewVideoEl || previewVideoEl.style.display === "none") return;
  applyVideoCarryToElement(previewVideoEl, VIDEO_CARRY.fileId || "");
}

function openQuadPlaybackForRecords(records, requestFullscreen = false) {
  showStatusMessage("Gallery mode is no longer available.");
  return true;
}

function openQuadPlaybackFromSelection(requestFullscreen = false) {
  showStatusMessage("Gallery mode is no longer available.");
  return true;
}

function openGalleryForDir(
  dirNode,
  startId = null,
  requestFullscreen = false,
  skipDirSyncOnClose = false,
) {
  if (!WS.root || !dirNode) return false;
  if (searchResultsVisibleInDirectoriesPane()) {
    enterSearchResultContext(dirNode.path || "");
  }
  if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
    WS.view.favoritesRootActive = false;
    WS.view.favoritesAnchorPath = dirNode.path || "";
  }
  if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
    WS.view.hiddenRootActive = false;
    WS.view.hiddenAnchorPath = dirNode.path || "";
  }
  WS.nav.dirNode = dirNode;
  WS.view.aboveRootView = false;
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncHiddenUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();
  const targetIndex =
    typeof startId === "string" && startId
      ? findFileEntryIndexById(startId)
      : selectionIndexForDirectoryEnter();
  WS.nav.selectedIndex = findNearestSelectableIndex(
    targetIndex >= 0 ? targetIndex : selectionIndexForDirectoryEnter(),
    1,
  );
  syncPreviewToSelection({ force: true });
  WS.view.returnToPreviewPaneAfterFileClose = false;
  WS.view.previewFileSelectionBridgeActive = false;
  WS.view.previewFileBridgeReturnState = null;
  WS.view.previewFolderBridgeReturnState = null;
  scheduleNearbyDirectoryRamWarm(currentNavigationSnapshot());
  renderDirectoriesPane(true);
  renderPreviewPane(true, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
  return true;
}

function openGalleryForFileRecord(rec, requestFullscreen = false, opts = null) {
  if (!rec) return false;
  const opened = focusDirectoriesOnFileRecord(rec);
  if (opened) {
    WS.view.returnToPreviewPaneAfterFileClose = false;
    WS.view.previewFileSelectionBridgeActive = false;
    WS.view.previewFileBridgeReturnState = null;
    WS.view.previewFolderBridgeReturnState = null;
  }
  return opened;
}

function openGalleryFromDirectoriesSelection(requestFullscreen) {
  if (!WS.nav.entries.length) return false;
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (!entry) return false;

  if (entry.kind === "dir") {
    enterSelectedDirectory();
    return true;
  } else if (entry.kind === "file") {
    const rec = WS.fileById.get(entry.id);
    if (!rec) return false;
    const restoreState = captureFilePaneEnterAutoRestoreState(entry);
    const fileId = String(rec.id || "");
    if (
      String(WS.view?.activePane || "") === "preview" &&
      WS.preview.kind === "file" &&
      String(WS.preview.fileId || "") === fileId
    ) {
      closePanesForFilePaneEnterAutoRestore(restoreState);
      return true;
    }
    const opened = focusDirectoriesOnFileRecord(rec);
    if (opened) {
      WS.view.returnToPreviewPaneAfterFileClose = false;
      WS.view.previewFileSelectionBridgeActive = false;
      WS.view.previewFileBridgeReturnState = null;
      WS.view.previewFolderBridgeReturnState = null;
      closePanesForFilePaneEnterAutoRestore(restoreState);
    }
    return opened;
  }
  return false;
}

function openGalleryFromViewerState(requestFullscreen) {
  if (
    String(WS.view?.activePane || "") === "preview" &&
    WS.preview.kind === "file" &&
    WS.preview.fileId
  ) {
    return true;
  }
  return openGalleryFromDirectoriesSelection(requestFullscreen);
}

function ensureViewerTransitionCanvas() {
  if (!viewport) return null;
  if (!viewerTransitionCanvas) {
    viewerTransitionCanvas = document.createElement("canvas");
    viewerTransitionCanvas.className = "viewerTransitionFrame";
    viewerTransitionCanvas.setAttribute("aria-hidden", "true");
  }
  if (!viewport.contains(viewerTransitionCanvas))
    viewport.appendChild(viewerTransitionCanvas);
  return viewerTransitionCanvas;
}

function showViewerTransitionFrame(canvas = null) {
  const frame = canvas || ensureViewerTransitionCanvas();
  if (!frame) return false;
  if (VIEWER_TRANSITION_HIDE_TIMER) {
    clearTimeout(VIEWER_TRANSITION_HIDE_TIMER);
    VIEWER_TRANSITION_HIDE_TIMER = 0;
  }
  frame.style.transition = "none";
  frame.style.opacity = "1";
  frame.style.display = "block";
  return true;
}

function hideViewerTransitionFrame(immediate = false) {
  const frame = viewerTransitionCanvas;
  if (!frame) return;
  if (VIEWER_TRANSITION_HIDE_TIMER) {
    clearTimeout(VIEWER_TRANSITION_HIDE_TIMER);
    VIEWER_TRANSITION_HIDE_TIMER = 0;
  }
  if (immediate || frame.style.display !== "block") {
    frame.style.transition = "none";
    frame.style.opacity = "1";
    frame.style.display = "none";
    return;
  }
  // Hard cut, one frame late; see hidePreviewVideoTransitionFrame.
  VIEWER_TRANSITION_HIDE_TIMER = setTimeout(() => {
    VIEWER_TRANSITION_HIDE_TIMER = 0;
    frame.style.transition = "none";
    frame.style.opacity = "1";
    frame.style.display = "none";
  }, TRANSITION_FRAME_CUT_DELAY_MS);
}

function hideViewerTransitionFrameAfterPaint(token, isCurrent = null) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (Number(token) !== VIEWER_TRANSITION_TOKEN) return;
      if (typeof isCurrent === "function" && !isCurrent()) return;
      hideViewerTransitionFrame(false);
    });
  });
}

function sourceDimensionsForSnapshot(source) {
  if (!source) return null;
  const tag = String(source.tagName || "").toUpperCase();
  if (tag === "CANVAS") {
    return {
      width: Number(source.width) || 0,
      height: Number(source.height) || 0,
      drawFull: true,
    };
  }
  if (tag === "VIDEO") {
    return {
      width: Number(source.videoWidth) || 0,
      height: Number(source.videoHeight) || 0,
    };
  }
  return {
    width: Number(source.naturalWidth) || 0,
    height: Number(source.naturalHeight) || 0,
  };
}

function drawViewerSnapshotSource(ctx, source, pixelWidth, pixelHeight, dpr) {
  const dims = sourceDimensionsForSnapshot(source);
  if (!dims || !(dims.width > 0) || !(dims.height > 0)) return false;
  if (dims.drawFull) {
    // Canvas-derived pixels are already graded.
    ctx.drawImage(source, 0, 0, pixelWidth, pixelHeight);
    applyTransitionFrameSourceFilter(ctx.canvas, null);
    return true;
  }
  const cssWidth = pixelWidth / dpr;
  const cssHeight = pixelHeight / dpr;
  const scale = Math.min(cssWidth / dims.width, cssHeight / dims.height);
  const drawWidth = dims.width * scale * dpr;
  const drawHeight = dims.height * scale * dpr;
  const drawX = (pixelWidth - drawWidth) / 2;
  const drawY = (pixelHeight - drawHeight) / 2;
  // ctx.filter does not exist in WKWebView; grade the snapshot with a CSS
  // filter on the canvas element instead. See applyTransitionFrameSourceFilter.
  ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
  applyTransitionFrameSourceFilter(ctx.canvas, source);
  return true;
}

function captureViewerTransitionFrame() {
  if (!VIEWER_MODE || isQuadPlaybackMode() || !viewport) return false;
  const canvas = ensureViewerTransitionCanvas();
  if (!canvas) return false;

  let source = MediaFilterEngine.renderSurfaceNow("viewer");
  if (
    source &&
    (source.style.display === "none" || !source.width || !source.height)
  )
    source = null;
  // Same rule as the preview capture: a bare `.mediaCanvas.ready` is not a
  // usable source once the surface has been retargeted, because its GL buffer
  // has already been discarded by the compositor. The retained hold frame is
  // the persistent copy of that same filtered picture.
  if (!source) {
    const held = MediaFilterEngine.holdFrameCanvas("viewer");
    if (held && held.width > 0 && held.height > 0) source = held;
  }
  if (
    !source &&
    viewerVideoEl &&
    viewerVideoEl.style.display !== "none" &&
    viewerVideoEl.readyState >= 2 &&
    viewerVideoEl.videoWidth > 0 &&
    viewerVideoEl.videoHeight > 0
  ) {
    source = viewerVideoEl;
  }
  if (
    !source &&
    viewerImgEl &&
    viewerImgEl.style.display !== "none" &&
    viewerImgEl.complete &&
    viewerImgEl.naturalWidth > 0 &&
    viewerImgEl.naturalHeight > 0
  ) {
    source = viewerImgEl;
  }
  if (!source) {
    // Same retention rule as the preview capture: hold a recent snapshot, but
    // never re-show an ageing one (see capturePreviewVideoTransitionFrame).
    if (
      canvas.style.display === "block" &&
      performance.now() - VIEWER_TRANSITION_FRAME_AT <
        PREVIEW_TRANSITION_FRAME_MAX_AGE_MS
    )
      return true;
    return false;
  }

  const cssWidth = Math.max(1, viewport.clientWidth || 0);
  const cssHeight = Math.max(1, viewport.clientHeight || 0);
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return false;
  try {
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    if (!drawViewerSnapshotSource(ctx, source, pixelWidth, pixelHeight, dpr))
      return false;
  } catch {
    return false;
  }
  VIEWER_TRANSITION_FRAME_AT = performance.now();
  paintDebugMediaLayer(canvas, "mask");
  return showViewerTransitionFrame(canvas);
}

function ensureViewerElements() {
  if (!viewerImgEl) {
    viewerImgEl = document.createElement("img");
    prepareMediaElementForCanvas(viewerImgEl);
    viewerImgEl.style.display = "none";
    viewerImgEl.onload = () => {
      viewerImgEl.classList.add("ready");
      MediaFilterEngine.requestRender();
    };
    viewport.appendChild(viewerImgEl);
  }
  if (!viewerVideoEl) {
    viewerVideoEl = document.createElement("video");
    prepareMediaElementForCanvas(viewerVideoEl);
    viewerVideoEl.controls = true;
    viewerVideoEl.preload = "auto";
    viewerVideoEl.playsInline = true;
    viewerVideoEl.autoplay = true;
    normalizeVideoPlaybackRate(viewerVideoEl);
    viewerVideoEl.poster = BLACK_POSTER_URL;
    viewerVideoEl.style.display = "none";
    viewport.appendChild(viewerVideoEl);
  }
  if (!viewerFolderEl) {
    viewerFolderEl = document.createElement("div");
    viewerFolderEl.style.display = "none";
    viewport.appendChild(viewerFolderEl);
  }
  if (!viewerQuadGridEl) {
    viewerQuadGridEl = document.createElement("div");
    viewerQuadGridEl.id = "viewerQuadGrid";
    viewerQuadGridEl.style.display = "none";
    viewerQuadSlots = [];
    for (let i = 0; i < 4; i++) {
      const cellEl = document.createElement("div");
      cellEl.className = "viewerQuadCell";
      const videoEl = document.createElement("video");
      prepareMediaElementForCanvas(videoEl);
      videoEl.preload = "auto";
      videoEl.playsInline = true;
      videoEl.autoplay = true;
      videoEl.controls = false;
      videoEl.poster = BLACK_POSTER_URL;
      normalizeVideoPlaybackRate(videoEl);
      cellEl.appendChild(videoEl);
      const slot = {
        cellEl,
        videoEl,
        surfaceName: `viewerQuad${i}`,
        fileId: "",
        rec: null,
      };
      cellEl.addEventListener("pointerenter", () => {
        if (slot.fileId) setQuadPlaybackFocus(slot.fileId);
      });
      cellEl.addEventListener("pointermove", () => {
        if (slot.fileId) setQuadPlaybackFocus(slot.fileId);
      });
      cellEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (slot.fileId) setQuadPlaybackFocus(slot.fileId);
      });
      viewerQuadSlots.push(slot);
      viewerQuadGridEl.appendChild(cellEl);
    }
    viewport.appendChild(viewerQuadGridEl);
  }
}

function showOverlay() {
  pausePreviewVideoForOverlay();
  VIEWER_MODE = true;
  ACTIVE_MEDIA_SURFACE = "overlay";
  overlay.classList.add("active");
  ensureViewerElements();
  renderViewerItem(viewerIndex);
  if (uiHideTimer) {
    clearTimeout(uiHideTimer);
    uiHideTimer = null;
  }
  overlay.classList.add("ui-hidden");
}

/* ===== Slideshow ===== */
// Basics -> Slideshow and Duration. While it is on, an open image stays on
// screen for the duration and an open video plays to its end; then the app
// steps to the next file, exactly as the next key would (across Sets too). Slideshow duration: Cycle turns the Slideshow
// toggle into a cycler: Off, then each duration, then Off. On/off lives in
// WS.view only, so a launch, a refresh or any reset turns it off.
//
// One timer checks ten times a second rather than one timeout per item, so
// nothing has to tell it the file changed: whatever moves to another file (a
// key, a jump, the slideshow itself) restarts that file's full duration, and
// a video's end is only noted, so the step after it waits the same way. Time
// does not run while there is no open file, a menu is up, the lock screen
// is showing, the panic screen is on or a text field has the caret.
const SLIDESHOW_SECONDS = Object.freeze([1, 3, 5, 10, 20]);
const SLIDESHOW_DURATION_CYCLE = Object.freeze(
  SLIDESHOW_SECONDS.map((n) => ({ value: String(n), label: `${n} sec` })).concat(
    [{ value: "cycle", label: "Cycle" }],
  ),
);
const SLIDESHOW_MODE_CYCLE = Object.freeze(
  [{ value: "0", label: "Off" }].concat(
    SLIDESHOW_SECONDS.map((n) => ({ value: String(n), label: `${n} sec` })),
  ),
);
const SLIDESHOW_TICK_MS = 100;
const SLIDESHOW_CLOCK = { fileKey: "", shownAt: 0, videoEndedKey: "" };

function slideshowDurationSetting() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return normalizeSlideshowDurationValue(opt && opt.slideshowDuration);
}

function slideshowCycleMode() {
  return slideshowDurationSetting() === "cycle";
}

function slideshowSecondsLabel(seconds) {
  return seconds > 0 ? `${seconds} sec` : "Off";
}

function slideshowOpenFileKey() {
  if (VIEWER_MODE) {
    const item = viewerItems[viewerIndex] || null;
    return item && !item.isFolder && item.id ? `viewer:${item.id}` : "";
  }
  if (WS.preview && WS.preview.kind === "file" && WS.preview.fileId)
    return `preview:${WS.preview.fileId}`;
  return "";
}

function slideshowOpenFileIsVideo() {
  let id = "";
  if (VIEWER_MODE) {
    const item = viewerItems[viewerIndex] || null;
    id = item && !item.isFolder ? String(item.id || "") : "";
  } else if (WS.preview && WS.preview.kind === "file") {
    id = String(WS.preview.fileId || "");
  }
  const rec = id ? WS.fileById.get(id) : null;
  return !!(rec && rec.type === "video");
}

// A video's `ended` (set in both video render paths while the slideshow runs,
// and by syncSlideshowVideos when it starts mid-video).
function slideshowNoteVideoEnded() {
  if (!WS.view.slideshowActive) return;
  SLIDESHOW_CLOCK.videoEndedKey = slideshowOpenFileKey();
}

function slideshowIsPaused() {
  if (BANIC_ACTIVE) return true;
  if (typeof lockScreenIsOpen === "function" && lockScreenIsOpen()) return true;
  if (document.querySelector(".dropdownMenu.open")) return true;
  if (variationsIsOpen()) return true;
  if (isTextInputTarget(document.activeElement)) return true;
  return false;
}

function slideshowStepToNextFile() {
  if (VIEWER_MODE) {
    if (!normalizeViewerStateForCurrentFilters()) {
      renderPreviewPane(false, true);
      return false;
    }
    return viewerStep(1);
  }
  // The open file in the preview pane: the same step the next key takes.
  if (handleClosedFilePaneNavigationAction("selectRight")) return true;
  return handlePreviewPaneAction("selectRight", true);
}

function slideshowTick() {
  if (!WS.view.slideshowActive || !(WS.view.slideshowSeconds > 0)) return;
  const now = performance.now();
  const key = slideshowOpenFileKey();
  if (key !== SLIDESHOW_CLOCK.fileKey) SLIDESHOW_CLOCK.videoEndedKey = "";
  if (!key || slideshowIsPaused() || key !== SLIDESHOW_CLOCK.fileKey) {
    // Nothing to time, or a different file: its clock starts now.
    SLIDESHOW_CLOCK.fileKey = key;
    SLIDESHOW_CLOCK.shownAt = now;
    return;
  }
  if (slideshowOpenFileIsVideo()) {
    // No duration for a video: it moves on once it has played to its end.
    if (SLIDESHOW_CLOCK.videoEndedKey !== key) return;
  } else if (now - SLIDESHOW_CLOCK.shownAt < WS.view.slideshowSeconds * 1000) {
    return;
  }
  SLIDESHOW_CLOCK.videoEndedKey = "";
  try {
    slideshowStepToNextFile();
  } catch (err) {
    debugModeLog("error", `Slideshow step failed: ${err && err.message}`);
  }
  // The file just stepped to starts its duration now, not on the next tick.
  SLIDESHOW_CLOCK.fileKey = slideshowOpenFileKey();
  SLIDESHOW_CLOCK.shownAt = performance.now();
}

// A video already on screen when the slideshow starts or stops: while it runs
// a video does not loop, so it can end; afterwards it goes back to the video
// end behaviour (a "next" video steps on its next render, as before).
function syncSlideshowVideos() {
  const on = !!WS.view.slideshowActive;
  for (const vid of [previewVideoEl, viewerVideoEl]) {
    if (!vid) continue;
    vid.loop = on ? false : videoEndBehavior() === "loop";
    if (on) vid.onended = slideshowNoteVideoEnded;
  }
}

function stopSlideshow() {
  const wasActive = WS.view.slideshowActive;
  WS.view.slideshowActive = false;
  WS.view.slideshowSeconds = 0;
  SLIDESHOW_CLOCK.videoEndedKey = "";
  if (WS.view.slideshowTimer) {
    clearInterval(WS.view.slideshowTimer);
    WS.view.slideshowTimer = null;
  }
  if (wasActive) syncSlideshowVideos();
}

function startSlideshow(seconds) {
  const n = Number(seconds) | 0;
  if (!(n > 0)) {
    stopSlideshow();
    return;
  }
  if (WS.view.slideshowTimer) clearInterval(WS.view.slideshowTimer);
  WS.view.slideshowActive = true;
  WS.view.slideshowSeconds = n;
  // The file on screen gets the whole new duration from now.
  SLIDESHOW_CLOCK.fileKey = slideshowOpenFileKey();
  SLIDESHOW_CLOCK.shownAt = performance.now();
  WS.view.slideshowTimer = setInterval(slideshowTick, SLIDESHOW_TICK_MS);
  syncSlideshowVideos();
}

function setSlideshowSeconds(seconds) {
  const n = Number(seconds) | 0;
  if (n > 0) startSlideshow(n);
  else stopSlideshow();
  showSlideshowMessage(`Slideshow: ${slideshowSecondsLabel(WS.view.slideshowSeconds)}`);
  return true;
}

// The Slideshow toggle (Basics, and the bindable "slideshow" control): on/off
// at the chosen duration, or under Cycle the next of Off, 1, 3, 5, 10, 20 sec.
function toggleSlideshow() {
  if (slideshowCycleMode()) {
    const current = WS.view.slideshowActive ? WS.view.slideshowSeconds : 0;
    const at = SLIDESHOW_SECONDS.indexOf(current);
    return setSlideshowSeconds(
      at + 1 < SLIDESHOW_SECONDS.length ? SLIDESHOW_SECONDS[at + 1] : 0,
    );
  }
  if (WS.view.slideshowActive) return setSlideshowSeconds(0);
  return setSlideshowSeconds(Number(slideshowDurationSetting()));
}

// Basics -> Slideshow duration. A running slideshow carries on at the new duration;
// switching to Cycle keeps it at the duration it was running at.
function setSlideshowDuration(value) {
  const next = normalizeSlideshowDurationValue(value);
  setOptionValue("slideshowDuration", next);
  if (WS.view.slideshowActive && next !== "cycle") startSlideshow(Number(next));
  showStatusMessage(
    `Slideshow duration: ${labelForCycleValue(SLIDESHOW_DURATION_CYCLE, next)}`,
  );
  return true;
}

function hideOverlay() {
  const quadMode = isQuadPlaybackMode();
  try {
    const item = viewerItems[viewerIndex] || null;
    if (!quadMode && item && !item.isFolder) {
      const rec = WS.fileById.get(item.id);
      if (
        rec &&
        rec.type === "video" &&
        viewerVideoEl &&
        viewerVideoEl.style.display !== "none"
      ) {
        VIDEO_CARRY.active = true;
        VIDEO_CARRY.fileId = rec.id;
        VIDEO_CARRY.time = viewerVideoEl.currentTime || 0;
        VIDEO_CARRY.wasPlaying = !viewerVideoEl.paused;
      }
    }
  } catch {}

  overlay.classList.remove("active");
  VIEWER_MODE = false;
  if (viewerVideoEl) {
    cancelResponsiveVideoSeek(viewerVideoEl);
    try {
      viewerVideoEl.pause();
    } catch {}
    try {
      viewerVideoEl.removeAttribute("src");
    } catch {}
    try {
      viewerVideoEl.load();
    } catch {}
    viewerVideoEl.dataset.playbackSrc = "";
    viewerVideoEl.classList.remove("ready");
    viewerVideoEl.classList.remove("mediaHidden");
    clearPendingFilmCornerMask(viewerVideoEl);
    viewerVideoEl.style.display = "none";
  }
  if (viewerImgEl) {
    try {
      viewerImgEl.removeAttribute("src");
    } catch {}
    viewerImgEl.classList.remove("ready");
    viewerImgEl.classList.remove("mediaHidden");
    viewerImgEl.style.removeProperty("visibility");
    clearPendingFilmCornerMask(viewerImgEl);
    viewerImgEl.style.display = "none";
  }
  MediaFilterEngine.detach("viewer");
  if (viewerFolderEl) viewerFolderEl.style.display = "none";
  clearQuadPlaybackSession();
  filenameEl.textContent = "";
  exitFullscreenIfNeeded();
  if (uiHideTimer) {
    clearTimeout(uiHideTimer);
    uiHideTimer = null;
  }
  overlay.classList.remove("ui-hidden");
  statusMessageEl.classList.remove("visible");
  const skipDirSyncOnClose = !quadMode && !!VIEWER_SKIP_DIR_SYNC_ON_CLOSE;
  const closeRestoreState = !quadMode ? VIEWER_CLOSE_RESTORE_STATE : null;
  VIEWER_SKIP_DIR_SYNC_ON_CLOSE = false;
  VIEWER_CLOSE_RESTORE_STATE = null;
  VIEWER_LAYOUT_MODE = "single";
  if (quadMode) {
    // Special quad playback preserves the existing file selection and directory state.
  } else if (closeRestoreState) {
    restoreViewerCloseState(closeRestoreState);
  } else if (skipDirSyncOnClose) {
    leaveDirectory();
  } else {
    syncDirectoriesToViewerState();
    if (
      !directoriesPaneOpenEnabled() &&
      WS.preview.kind === "file" &&
      WS.preview.fileId
    ) {
      closeFilePreviewToFolder();
    }
  }
  if (!VIEWER_MODE && WS.preview.kind === "file" && WS.preview.fileId)
    ACTIVE_MEDIA_SURFACE = "preview";
  else if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
  resumePreviewVideoAfterOverlay();
}

function showUI() {
  overlay.classList.remove("ui-hidden");
}
function hideUI() {
  overlay.classList.add("ui-hidden");
}

function showGlobalCursor() {
  document.body.classList.remove("cursor-hidden");
}

function hideGlobalCursor() {
  document.body.classList.add("cursor-hidden");
}

function resetGlobalCursorHideTimer() {
  showGlobalCursor();
  if (globalCursorHideTimer) {
    clearTimeout(globalCursorHideTimer);
    globalCursorHideTimer = null;
  }
  globalCursorHideTimer = setTimeout(() => {
    hideGlobalCursor();
  }, 2000);
}

function resetUIHideTimer() {
  showUI();
  if (uiHideTimer) {
    clearTimeout(uiHideTimer);
    uiHideTimer = null;
  }
  uiHideTimer = setTimeout(() => {
    hideUI();
  }, 2000);
}

overlay.addEventListener("mousemove", () => {
  if (!VIEWER_MODE) return;
  resetUIHideTimer();
});

document.addEventListener("mousemove", resetGlobalCursorHideTimer, {
  passive: true,
});
resetGlobalCursorHideTimer();

function findFirstFileIndex(items) {
  for (let i = 0; i < items.length; i++) if (!items[i].isFolder) return i;
  return -1;
}

function findLastFileIndex(items) {
  for (let i = items.length - 1; i >= 0; i--) if (!items[i].isFolder) return i;
  return -1;
}

function moveToNextDirectoryFile() {
  if (!viewerDirNode) return false;
  const originalDir = viewerDirNode;

  const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
  const idx = siblingDirs.indexOf(viewerDirNode);
  if (idx === -1) return false;

  for (let s = idx + 1; s < siblingDirs.length; s++) {
    const dir = siblingDirs[s];
    viewerDirNode = dir;
    viewerItems = buildViewerItemsForDir(viewerDirNode);
    if (!viewerItems.length) continue;

    const firstFileIndex = findFirstFileIndex(viewerItems);
    if (firstFileIndex === -1) continue;

    viewerIndex = firstFileIndex;
    if (VIEWER_MODE) renderViewerItem(viewerIndex);
    syncDirectoriesToViewerState();
    return true;
  }

  viewerDirNode = originalDir;
  viewerItems = buildViewerItemsForDir(viewerDirNode);
  return false;
}

function moveToPrevDirectoryFile() {
  if (!viewerDirNode) return false;
  const originalDir = viewerDirNode;

  const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
  const idx = siblingDirs.indexOf(viewerDirNode);
  if (idx === -1) return false;

  for (let s = idx - 1; s >= 0; s--) {
    const dir = siblingDirs[s];
    viewerDirNode = dir;
    viewerItems = buildViewerItemsForDir(viewerDirNode);
    if (!viewerItems.length) continue;

    const lastFileIndex = findLastFileIndex(viewerItems);
    if (lastFileIndex === -1) continue;

    viewerIndex = lastFileIndex;
    if (VIEWER_MODE) renderViewerItem(viewerIndex);
    syncDirectoriesToViewerState();
    return true;
  }

  viewerDirNode = originalDir;
  viewerItems = buildViewerItemsForDir(viewerDirNode);
  return false;
}

function moveToPrevDirectoryFirstFile() {
  if (!viewerDirNode) return false;
  const originalDir = viewerDirNode;

  const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
  const idx = siblingDirs.indexOf(viewerDirNode);
  if (idx === -1) return false;

  for (let s = idx - 1; s >= 0; s--) {
    const dir = siblingDirs[s];
    viewerDirNode = dir;
    viewerItems = buildViewerItemsForDir(viewerDirNode);
    if (!viewerItems.length) continue;

    const firstFileIndex = findFirstFileIndex(viewerItems);
    if (firstFileIndex === -1) continue;

    viewerIndex = firstFileIndex;
    if (VIEWER_MODE) renderViewerItem(viewerIndex);
    syncDirectoriesToViewerState();
    return true;
  }

  viewerDirNode = originalDir;
  viewerItems = buildViewerItemsForDir(viewerDirNode);
  return false;
}

function viewerStepMediaOnly(delta) {
  normalizeViewerStateForCurrentFilters();
  if (!viewerItems.length) return false;
  const direction = delta < 0 ? -1 : 1;
  const prevDir = viewerDirNode;
  const prevIdx = viewerIndex;
  const behavior = normalizeFolderBehavior(WS.view.folderBehavior, "slide");

  let i = viewerIndex + direction;
  while (i >= 0 && i < viewerItems.length) {
    const item = viewerItems[i];
    if (item && !item.isFolder) {
      viewerIndex = i;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
      return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
    }
    i += direction;
  }

  if (behavior === "slide") {
    return direction > 0 ? moveToNextDirectoryFile() : moveToPrevDirectoryFile();
  }

  return false;
}

function viewerStep(delta) {
  normalizeViewerStateForCurrentFilters();
  if (!viewerItems.length) return false;
  const n = viewerItems.length;
  const prevDir = viewerDirNode;
  const prevIdx = viewerIndex;
  const behavior = normalizeFolderBehavior(WS.view.folderBehavior, "slide");

  let i = viewerIndex + delta;

  if (behavior === "slide") {
    if (i < 0) {
      if (!moveToPrevDirectoryFile()) return false;
      return true;
    }
    if (i >= n) {
      if (!moveToNextDirectoryFile()) return false;
      return true;
    }

    viewerIndex = i;
    if (VIEWER_MODE) renderViewerItem(viewerIndex);
    syncDirectoriesToViewerState();
    return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
  }

  if (i < 0) i = 0;
  if (i >= n) i = n - 1;

  viewerIndex = i;
  if (VIEWER_MODE) renderViewerItem(viewerIndex);
  syncDirectoriesToViewerState();
  return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
}

function viewerJumpRelative(delta) {
  if (!viewerItems.length) return;
  const step = delta > 0 ? 1 : -1;
  let remaining = Math.abs(delta);
  while (remaining > 0) {
    const moved = viewerStep(step);
    if (!moved) break;
    remaining--;
  }
}

function viewerJumpToNextFolderFirstFile() {
  if (!viewerDirNode) return;
  moveToNextDirectoryFile();
}

function viewerJumpToPrevFolderFirstFile() {
  if (!viewerDirNode) return;
  moveToPrevDirectoryFirstFile();
}

function renderQuadPlaybackView() {
  ensureViewerElements();
  applyScrollImageMode(viewport, viewerImgEl, "none");
  viewport.classList.add("viewerQuadMode");

  if (viewerVideoEl) {
    cancelResponsiveVideoSeek(viewerVideoEl);
    try {
      viewerVideoEl.pause();
    } catch {}
    viewerVideoEl.classList.remove("ready");
    viewerVideoEl.style.display = "none";
    clearPendingFilmCornerMask(viewerVideoEl);
  }
  if (viewerImgEl) {
    viewerImgEl.classList.remove("ready");
    viewerImgEl.style.removeProperty("visibility");
    viewerImgEl.style.display = "none";
    clearPendingFilmCornerMask(viewerImgEl);
  }
  if (viewerFolderEl) viewerFolderEl.style.display = "none";
  const preserveViewerFrame = mediaFilterEnabled();
  MediaFilterEngine.detach("viewer", { preserveFrame: preserveViewerFrame });
  if (!preserveViewerFrame) {
    if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
    if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
  }

  const slots = getQuadPlaybackSlots();
  const records = getQuadPlaybackRecords();
  viewerQuadGridEl.style.display = "grid";
  viewerQuadGridEl.classList.add("active");
  filenameEl.textContent = "";

  const shouldLoop = videoEndBehavior() === "loop";
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const rec = records[i] || null;
    if (!slot) continue;
    if (!rec) {
      clearQuadPlaybackSlot(slot);
      continue;
    }

    slot.fileId = String(rec.id || "");
    slot.rec = rec;
    slot.cellEl.style.display = "block";
    slot.videoEl.dataset.quadFileId = slot.fileId;
    slot.videoEl.autoplay = !BANIC_ACTIVE;
    slot.videoEl.loop = shouldLoop;
    slot.videoEl.onended = null;
    slot.videoEl.onloadeddata = () => {
      slot.videoEl.classList.add("ready");
      MediaFilterEngine.requestRender();
    };

    applyVideoPoster(slot.videoEl, rec);
    applyPendingFilmCornerMask(slot.videoEl, rec);
    const src = ensureMediaUrl(rec) || "";
    const same = slot.videoEl.src === src;
    if (!same) {
      slot.videoEl.classList.remove("ready");
      slot.videoEl.src = src;
      try {
        slot.videoEl.load();
      } catch {}
    }
    slot.videoEl.style.display = "block";
    slot.videoEl.setAttribute("data-dir-path", rec.dirPath || "");
    syncMediaFilterSurface(
      slot.surfaceName,
      slot.videoEl,
      slot.cellEl,
      "video",
      rec,
    );
    if (slot.videoEl.readyState >= 2) {
      requestAnimationFrame(() => {
        if (slot.videoEl.dataset.quadFileId !== slot.fileId) return;
        slot.videoEl.classList.add("ready");
        MediaFilterEngine.requestRender();
      });
    }
  }

  applyQuadPlaybackAudioState();
  if (!BANIC_ACTIVE) {
    for (let i = 0; i < slots.length; i++) {
      const videoEl = slots[i]?.videoEl || null;
      if (!videoEl || !videoEl.dataset.quadFileId) continue;
      try {
        videoEl.play();
      } catch {}
    }
  }
}

function renderViewerItem(idx) {
  if (isQuadPlaybackMode()) {
    renderQuadPlaybackView();
    return;
  }
  if (!viewerItems.length) {
    if (viewerQuadGridEl) {
      viewerQuadGridEl.style.display = "none";
      viewerQuadGridEl.classList.remove("active");
    }
    viewport.classList.remove("viewerQuadMode");
    resetMediaZoom();
    applyScrollImageMode(viewport, viewerImgEl, "none");
    if (viewerImgEl) viewerImgEl.style.display = "none";
    if (viewerVideoEl) viewerVideoEl.style.display = "none";
    if (viewerFolderEl) viewerFolderEl.style.display = "none";
    filenameEl.textContent = "";
    MediaFilterEngine.detach("viewer");
    if (viewerImgEl) {
      viewerImgEl.classList.remove("mediaHidden");
      clearPendingFilmCornerMask(viewerImgEl);
    }
    if (viewerVideoEl) {
      viewerVideoEl.classList.remove("mediaHidden");
      clearPendingFilmCornerMask(viewerVideoEl);
    }
    hideViewerTransitionFrame(true);
    return;
  }

  ensureViewerElements();
  if (viewerQuadGridEl) {
    viewerQuadGridEl.style.display = "none";
    viewerQuadGridEl.classList.remove("active");
  }
  viewport.classList.remove("viewerQuadMode");

  const n = viewerItems.length;
  let i = idx;
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  viewerIndex = i;
  syncMediaZoomForCurrentTarget();

  const item = viewerItems[viewerIndex];
  const viewerTransitionToken = ++VIEWER_TRANSITION_TOKEN;
  const viewerTransitionActive =
    mediaFilterEnabled() && captureViewerTransitionFrame();

  if (viewerVideoEl) {
    cancelResponsiveVideoSeek(viewerVideoEl);
    try {
      viewerVideoEl.pause();
    } catch {}
    viewerVideoEl.classList.remove("ready");
    viewerVideoEl.style.display = "none";
    clearPendingFilmCornerMask(viewerVideoEl);
  }
  if (viewerImgEl) {
    viewerImgEl.classList.remove("ready");
    viewerImgEl.style.display = "none";
    clearPendingFilmCornerMask(viewerImgEl);
  }
  if (viewerFolderEl) viewerFolderEl.style.display = "none";
  const preserveViewerFrame = mediaFilterEnabled();
  MediaFilterEngine.detach("viewer", { preserveFrame: preserveViewerFrame });
  if (!preserveViewerFrame) {
    if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
    if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
  }

  if (!item) return;
  const viewerDisplayPositions = buildDisplayPositionMapsForViewerItems(
    viewerItems,
  );

  if (item.isFolder) {
    applyScrollImageMode(viewport, viewerImgEl, "none");
    viewerFolderEl.style.display = "flex";
    viewerFolderEl.style.flexDirection = "column";
    viewerFolderEl.style.alignItems = "center";
    viewerFolderEl.style.justifyContent = "center";
    viewerFolderEl.style.minWidth = "200px";
    viewerFolderEl.style.maxWidth = "80%";
    viewerFolderEl.style.padding = "24px 32px";
    viewerFolderEl.style.borderRadius = "var(--radius-md)";
    viewerFolderEl.style.background = "var(--color1-secondary)";
    viewerFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";

    viewerFolderEl.innerHTML = "";

    const icon = document.createElement("div");
    icon.style.fontSize = "56px";
    icon.style.marginBottom = "12px";
    setAppIcon(icon, "folder");

    const name = document.createElement("div");
    name.style.fontSize = "14px";
    name.style.color = "var(--color0-primary)";
    name.style.textAlign = "center";
    name.style.whiteSpace = "nowrap";
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.whiteSpace = "normal";
    name.style.overflow = "visible";
    name.style.textOverflow = "clip";
    name.style.overflowWrap = "anywhere";
    name.style.wordBreak = "break-word";
    name.textContent =
      prefixDisplayLabelWithPosition(
        dirUiLabel(item.dirNode),
        viewerDisplayPositions.dirPositions.get(
          String(item.dirNode?.path || ""),
        ),
      ) || "Folder";

    viewerFolderEl.appendChild(icon);
    viewerFolderEl.appendChild(name);

    filenameEl.textContent = prefixDisplayLabelWithPosition(
      item.dirNode?.path
        ? storageDisplayPathForPath(item.dirNode.path)
        : dirUiLabel(item.dirNode) || "",
      viewerDisplayPositions.dirPositions.get(String(item.dirNode?.path || "")),
    );
    if (viewerTransitionActive)
      hideViewerTransitionFrameAfterPaint(viewerTransitionToken);
    return;
  }

  const rec = WS.fileById.get(item.id);
  if (!rec) {
    hideViewerTransitionFrame(true);
    return;
  }
  const viewerRecordStillCurrent = (candidate) => {
    const activeItem = viewerItems[viewerIndex] || null;
    return !!(
      candidate &&
      activeItem &&
      !activeItem.isFolder &&
      String(activeItem.id || "") === String(candidate.id || "")
    );
  };

  filenameEl.textContent = relPathDisplayName(rec.relPath || rec.name || "", {
    finalPrefix: displayPositionPrefix(
      viewerDisplayPositions.filePositions.get(String(item.id || "")),
    ),
  });

  if (rec.type === "video") {
    applyScrollImageMode(viewport, viewerImgEl, "none");
    const mode = galleryVideoMode();
    const doAuto = mode !== "off" && !BANIC_ACTIVE;
    if (previewVideoEl) {
      cancelResponsiveVideoSeek(previewVideoEl);
      try {
        previewVideoEl.pause();
      } catch {}
    }
    normalizeVideoPlaybackRate(viewerVideoEl);
    viewerVideoEl.autoplay = doAuto;
    viewerVideoEl.onloadeddata = null;
    viewerVideoEl.onended = null;
    viewerVideoEl.muted = mode === "muted" || BANIC_ACTIVE;
    const endBehavior = videoEndBehavior();
    if (WS.view.slideshowActive) {
      // A video plays to its end and then the slideshow moves on.
      viewerVideoEl.loop = false;
      viewerVideoEl.onended = slideshowNoteVideoEnded;
    } else if (endBehavior === "loop") {
      viewerVideoEl.loop = true;
    } else if (endBehavior === "next") {
      viewerVideoEl.loop = false;
      viewerVideoEl.onended = () => {
        if (!WS.view.slideshowActive) viewerStep(1);
      };
    } else {
      viewerVideoEl.loop = false;
    }
    viewerVideoEl.onloadeddata = () => {
      if (!viewerRecordStillCurrent(rec)) return;
      try { applyDirectMediaCssEffectsForTarget(viewerVideoEl, rec); } catch {}
      syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video", rec);
      viewerVideoEl.classList.add("ready");
      MediaFilterEngine.requestRender();
      if (viewerTransitionActive)
        hideViewerTransitionFrameAfterPaint(
          viewerTransitionToken,
          () => viewerRecordStillCurrent(rec),
        );
    };

    applyVideoPoster(viewerVideoEl, rec);
    const src = ensureMediaUrl(rec) || "";
    const same = viewerVideoEl.src === src;
    if (!same) {
      viewerVideoEl.src = src;
      try {
        viewerVideoEl.load();
      } catch {}
    }
    viewerVideoEl.setAttribute("data-dir-path", rec.dirPath || "");
    if (same) {
      try { applyDirectMediaCssEffectsForTarget(viewerVideoEl, rec); } catch {}
      syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video", rec);
    }
    viewerVideoEl.style.display = "block";

    applyVideoCarryToElement(viewerVideoEl, rec.id);

    if (same && viewerVideoEl.readyState >= 2) {
      requestAnimationFrame(() => {
        const activeItem = viewerItems[viewerIndex] || null;
        if (
          !activeItem ||
          activeItem.isFolder ||
          String(activeItem.id || "") !== String(rec.id || "")
        )
          return;
        try { applyDirectMediaCssEffectsForTarget(viewerVideoEl, rec); } catch {}
        syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video", rec);
        viewerVideoEl.classList.add("ready");
        MediaFilterEngine.requestRender();
        if (viewerTransitionActive)
          hideViewerTransitionFrameAfterPaint(
            viewerTransitionToken,
            () => viewerRecordStillCurrent(rec),
          );
      });
    }
    if (doAuto) {
      try {
        viewerVideoEl.play();
      } catch {}
    }
    preloadNextMedia(viewerItems, viewerIndex);
    return;
  }

  viewerImgEl.onload = () => {
    if (!viewerRecordStillCurrent(rec)) return;
    try { applyDirectMediaCssEffectsForTarget(viewerImgEl, rec); } catch {}
    const imageMode = detectScrollImageMode(rec, viewerImgEl);
    applyScrollImageMode(
      viewport,
      viewerImgEl,
      imageMode,
      false,
    );
    if (imageMode !== "none") {
      clearMediaFilterSurface("viewer", viewerImgEl);
      applyScrollImageProcessingFallback(viewerImgEl, rec, imageMode);
      viewerImgEl.classList.remove("mediaHidden");
    } else {
      syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", rec);
    }
    viewerImgEl.style.display = "block";
    revealScrollImageLayout(
      viewerImgEl,
      () => {
        const activeItem = viewerItems[viewerIndex] || null;
        return !!(
          activeItem &&
          !activeItem.isFolder &&
          String(activeItem.id || "") === String(rec.id || "")
        );
      },
      () => {
        if (viewerTransitionActive)
          hideViewerTransitionFrameAfterPaint(
            viewerTransitionToken,
            () => viewerRecordStillCurrent(rec),
          );
      },
    );
  };
  const src = ensureMediaUrl(rec) || "";
  const same = viewerImgEl.src === src;
  viewerImgEl.setAttribute("data-dir-path", rec.dirPath || "");
  const viewerMode = same
    ? detectScrollImageMode(rec, viewerImgEl)
    : predictScrollImageModeForRecord(rec);
  applyScrollImageMode(viewport, viewerImgEl, viewerMode, !same);
  if (same) {
    try { applyDirectMediaCssEffectsForTarget(viewerImgEl, rec); } catch {}
  }
  if (!same) {
    viewerImgEl.classList.remove("ready");
    viewerImgEl.style.removeProperty("visibility");
    viewerImgEl.src = src;
    viewerImgEl.style.display = "block";
    preloadNextMedia(viewerItems, viewerIndex);
    return;
  } else {
    viewerImgEl.style.removeProperty("visibility");
  }
  if (viewerMode !== "none") {
    clearPendingFilmCornerMask(viewerImgEl);
    clearMediaFilterSurface("viewer", viewerImgEl);
    applyScrollImageProcessingFallback(viewerImgEl, rec, viewerMode);
    viewerImgEl.classList.remove("mediaHidden");
  } else {
    syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", rec);
  }
  viewerImgEl.style.display = "block";

  if (viewerImgEl.complete && viewerImgEl.naturalWidth > 0) {
    requestAnimationFrame(() => {
      const activeItem = viewerItems[viewerIndex] || null;
      if (
        !activeItem ||
        activeItem.isFolder ||
        String(activeItem.id || "") !== String(rec.id || "")
      )
        return;
      try { applyDirectMediaCssEffectsForTarget(viewerImgEl, rec); } catch {}
      const imageMode = detectScrollImageMode(rec, viewerImgEl);
      applyScrollImageMode(viewport, viewerImgEl, imageMode, false);
      if (imageMode !== "none") {
        clearPendingFilmCornerMask(viewerImgEl);
        clearMediaFilterSurface("viewer", viewerImgEl);
        applyScrollImageProcessingFallback(viewerImgEl, rec, imageMode);
        viewerImgEl.classList.remove("mediaHidden");
      } else {
        syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", rec);
      }
      viewerImgEl.style.display = "block";
      revealScrollImageLayout(
        viewerImgEl,
        () => {
          const activeItem = viewerItems[viewerIndex] || null;
          return !!(
            activeItem &&
            !activeItem.isFolder &&
            String(activeItem.id || "") === String(rec.id || "")
          );
        },
        () => {
          if (viewerTransitionActive)
            hideViewerTransitionFrameAfterPaint(
              viewerTransitionToken,
              () => viewerRecordStillCurrent(rec),
            );
        },
      );
    });
  }
  preloadNextMedia(viewerItems, viewerIndex);
}

function viewerEnterDir() {
  // Right
  const it = viewerItems[viewerIndex];
  if (it && it.isFolder && it.dirNode) {
    if (viewerDirNode) viewerDirNode.lastIndex = viewerIndex;
    viewerDirNode = it.dirNode;
    viewerItems = buildViewerItemsForDir(viewerDirNode);
    let idx =
      typeof viewerDirNode.lastIndex === "number" ? viewerDirNode.lastIndex : 0;
    if (idx < 0) idx = 0;
    if (idx >= viewerItems.length) idx = viewerItems.length - 1;
    viewerIndex = idx;
    if (VIEWER_MODE) renderViewerItem(viewerIndex);
    syncDirectoriesToViewerState();
  }
}

function viewerLeaveDir() {
  // Left
  if (VIEWER_SKIP_DIR_SYNC_ON_CLOSE) {
    if (VIEWER_MODE) hideOverlay();
    return;
  }
  if (
    viewerDirNode &&
    !viewerDirNode._skipTagFilters &&
    tryRestoreTagDirectoryContext(viewerDirNode.path || "")
  )
    return;
  if (isViewingTagFolder()) {
    exitTagFolderView();
    return;
  }
  if (searchBrowsingResultFolder()) {
    if (VIEWER_MODE) hideOverlay();
    returnToSearchResults();
    return;
  }
  if (!viewerDirNode || !viewerDirNode.parent) return;
  const child = viewerDirNode;
  child.lastIndex = viewerIndex;
  viewerDirNode = viewerDirNode.parent;
  viewerItems = buildViewerItemsForDir(viewerDirNode);

  let idx = 0;
  for (let i = 0; i < viewerItems.length; i++) {
    const it = viewerItems[i];
    if (it.isFolder && it.dirNode === child) {
      idx = i;
      break;
    }
  }
  viewerDirNode.lastIndex = idx;
  viewerIndex = idx;
  if (VIEWER_MODE) renderViewerItem(viewerIndex);
  WS.view.pendingDirScroll = "center-selected";
  syncDirectoriesToViewerState();
}

function getActiveMediaVideos() {
  if (VIEWER_MODE && isQuadPlaybackMode()) return getQuadPlaybackVideos();
  if (VIEWER_MODE)
    return viewerVideoEl && viewerVideoEl.style.display !== "none"
      ? [viewerVideoEl]
      : [];
  if (ACTIVE_MEDIA_SURFACE === "preview")
    return previewVideoEl && previewVideoEl.style.display !== "none"
      ? [previewVideoEl]
      : [];
  return [];
}

function getActiveMediaVideo() {
  const vids = getActiveMediaVideos();
  return vids.length ? vids[0] : null;
}
