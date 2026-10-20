/* Preview viewer item
   Drawing a single open file in the preview pane. */

function renderPreviewViewerItem(idx) {
  ensurePreviewFileElements();

  if (!viewerItems.length) {
    resetMediaZoom();
    applyScrollImageMode(previewViewportBox, previewImgEl, "none");
    if (previewImgEl) previewImgEl.style.display = "none";
    if (previewVideoEl) previewVideoEl.style.display = "none";
    if (previewFolderEl) previewFolderEl.style.display = "none";
    MediaFilterEngine.detach("preview");
    if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
    if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
    if (previewVideoTransitionCanvas) hidePreviewVideoTransitionFrame(true);
    return;
  }

  const n = viewerItems.length;
  let i = idx;
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  viewerIndex = i;
  syncMediaZoomForCurrentTarget();

  const item = viewerItems[viewerIndex];

  let willShowVideo = false;
  let willShowImage = false;
  let rec = null;
  if (item && !item.isFolder) {
    rec = WS.fileById.get(item.id);
    if (rec && rec.type === "video") willShowVideo = true;
    else if (rec) willShowImage = true;
  }
  if (!willShowImage) applyScrollImageMode(previewViewportBox, previewImgEl, "none");
  const previewVideoTransitionToken = beginPreviewVideoTransition(rec);
  const promotedWarmPreviewVideo = willShowVideo
    ? promotePreloadedPreviewVideo(rec)
    : false;
  const suppressStalePreviewFrame = !!PREVIEW_SUPPRESS_STALE_FRAME_ONCE;
  PREVIEW_SUPPRESS_STALE_FRAME_ONCE = false;
  const keepPreviewImageFrame = !!(
    !suppressStalePreviewFrame &&
    willShowImage &&
    !mediaFilterEnabled() &&
    previewImgEl &&
    previewImgEl.style.display !== "none" &&
    String(previewImgEl.src || "") &&
    rec &&
    String(previewImgEl.dataset.previewFileId || "") === String(rec.id || "")
  );
  const keepPreviewFilterFrame = !!(
    !suppressStalePreviewFrame &&
    mediaFilterEnabled() &&
    willShowImage &&
    previewImgEl &&
    rec &&
    String(previewImgEl.dataset.previewFileId || "") === String(rec.id || "")
  );
  const hasVisiblePreviewImageFrame = !!(
    willShowImage &&
    previewImgEl &&
    previewImgEl.style.display !== "none" &&
    String(previewImgEl.src || "")
  );
  const holdPreviewImageFrame = !!(
    !suppressStalePreviewFrame &&
    hasVisiblePreviewImageFrame &&
    !keepPreviewImageFrame &&
    rec &&
    String(previewImgEl.dataset.previewFileId || "") !== String(rec.id || "")
  );
  const keepPreviewVideoElement = !!(
    willShowVideo &&
    previewVideoEl &&
    rec &&
    String(previewVideoEl.dataset.previewFileId || "") === String(rec.id || "")
  );
  const holdPreviewVideoElementDuringRetarget = !!(
    !suppressStalePreviewFrame &&
    mediaFilterEnabled() &&
    willShowVideo &&
    previewVideoEl &&
    previewVideoEl.style.display !== "none" &&
    rec &&
    String(previewVideoEl.dataset.previewFileId || "") !== String(rec.id || "")
  );

  if (previewVideoEl) {
    if (!keepPreviewVideoElement) {
      cancelResponsiveVideoSeek(previewVideoEl);
      try {
        previewVideoEl.pause();
      } catch {}
      previewVideoEl.classList.remove("ready");
      if (holdPreviewVideoElementDuringRetarget)
        previewVideoEl.classList.add("mediaHidden");
    }
    if (!willShowVideo) {
      previewVideoEl.style.display = "none";
      delete previewVideoEl.dataset.previewFileId;
    }
    clearPendingFilmCornerMask(previewVideoEl);
  }
  if (previewImgEl) {
    if (!keepPreviewImageFrame && !keepPreviewFilterFrame && !holdPreviewImageFrame) {
      previewImgEl.classList.remove("ready");
      previewImgEl.style.display = "none";
      previewImgEl.style.removeProperty("visibility");
      delete previewImgEl.dataset.previewFileId;
      if (willShowImage) previewImgEl.removeAttribute("src");
      clearPendingFilmCornerMask(previewImgEl);
    } else if (keepPreviewFilterFrame || holdPreviewImageFrame) {
      previewImgEl.classList.add("ready");
      previewImgEl.style.display = "block";
      if (holdPreviewImageFrame && mediaFilterEnabled())
        previewImgEl.classList.add("mediaHidden");
    }
  }
  if (previewFolderEl) previewFolderEl.style.display = "none";
  // Retargeting the surface must never drop the frame already on the canvas:
  // clearing it exposes the source element (or nothing) until the next file has
  // decoded, which reads as the filter switching itself off and back on. The
  // video cases hold their frame for the same reason the image cases do.
  const preservePreviewFrame =
    keepPreviewFilterFrame ||
    holdPreviewImageFrame ||
    keepPreviewVideoElement ||
    holdPreviewVideoElementDuringRetarget;
  MediaFilterEngine.detach("preview", { preserveFrame: preservePreviewFrame });
  if (!preservePreviewFrame) {
    if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
    if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
  }

  if (!item) return;

  const viewerDisplayPositions = buildDisplayPositionMapsForViewerItems(
    viewerItems,
  );

  if (item.isFolder) {
    syncPreviewVideoUserPauseLockToItem(null);
    previewFolderEl.style.display = "flex";
    previewFolderEl.style.flexDirection = "column";
    previewFolderEl.style.alignItems = "center";
    previewFolderEl.style.justifyContent = "center";
    previewFolderEl.style.minWidth = "200px";
    previewFolderEl.style.maxWidth = "80%";
    previewFolderEl.style.padding = "24px 32px";
    previewFolderEl.style.borderRadius = "var(--radius-md)";
    previewFolderEl.style.background = "var(--color1-secondary)";
    previewFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";

    previewFolderEl.innerHTML = "";

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

    previewFolderEl.appendChild(icon);
    previewFolderEl.appendChild(name);
    return;
  }

  if (!rec) return;
  if (!rec.file && WS.meta && WS.meta.fsRootHandle) {
    ensureFileObjectForRecord(rec)
      .then((file) => {
        if (String(WS.preview.fileId || "") !== String(rec.id || "")) return;
        if (!file) {
          showPreviewViewportMessage("Could not load file", rec.relPath || rec.name || "");
          return;
        }
        renderPreviewPane(false, true);
      })
      .catch(() => {
        if (String(WS.preview.fileId || "") !== String(rec.id || "")) return;
        showPreviewViewportMessage("Could not load file", rec.relPath || rec.name || "");
      });
    return;
  }
  syncPreviewVideoUserPauseLockToItem(rec.id);

  if (rec.type === "video") {
    const holdFilteredFrame = shouldHoldPreviewFilteredFrameForTarget(rec);
    const mode = previewVideoMode();
    const doAuto = mode !== "off" && !BANIC_ACTIVE && !VIEWER_MODE;
    const pauseLocked = previewVideoUserPausedFor(rec.id);
    const shouldAutoPlay = doAuto && !pauseLocked;
    if (!VIEWER_MODE && viewerVideoEl) {
      cancelResponsiveVideoSeek(viewerVideoEl);
      try {
        viewerVideoEl.pause();
      } catch {}
    }
    normalizeVideoPlaybackRate(previewVideoEl);
    previewVideoEl.autoplay = shouldAutoPlay;
    previewVideoEl.onloadeddata = null;
    previewVideoEl.oncanplay = null;
    previewVideoEl.onplaying = null;
    previewVideoEl.onended = null;
    previewVideoEl.onerror = null;
    previewVideoEl.muted = mode === "muted" || BANIC_ACTIVE || VIEWER_MODE;
    const endBehavior = videoEndBehavior();
    if (WS.view.slideshowActive) {
      // A video plays to its end and then the slideshow moves on.
      previewVideoEl.loop = false;
      previewVideoEl.onended = slideshowNoteVideoEnded;
    } else if (endBehavior === "loop") {
      previewVideoEl.loop = true;
    } else if (endBehavior === "next") {
      previewVideoEl.loop = false;
      previewVideoEl.onended = () => {
        if (!WS.view.slideshowActive) viewerStep(1);
      };
    } else {
      previewVideoEl.loop = false;
    }
    const handlePreviewVideoReady = () => {
      // canplay fires again after every seek; a held scrub keeps it paused.
      // A video the user paused stays paused too (a seek fires canplay again).
      if (
        shouldAutoPlay &&
        previewVideoEl.paused &&
        !videoScrubIsHolding(previewVideoEl) &&
        !previewVideoUserPausedFor(rec.id)
      ) {
        try {
          const playPromise = previewVideoEl.play();
          if (playPromise && typeof playPromise.then === "function")
            playPromise.catch(() => {});
        } catch {}
      }
      armPreviewVideoFirstFrame(
        previewVideoEl,
        rec.id,
        previewVideoTransitionToken,
        shouldAutoPlay,
      );
      if (!shouldAutoPlay)
        revealPreviewVideoFrame(
          previewVideoEl,
          rec.id,
          previewVideoTransitionToken,
        );
      MediaFilterEngine.requestRender();
    };
    const handlePreviewVideoStarted = () => {
      armPreviewVideoFirstFrame(
        previewVideoEl,
        rec.id,
        previewVideoTransitionToken,
        shouldAutoPlay,
      );
      schedulePreviewVideoPosterRequest(rec);
      handlePreviewVideoReady();
    };
    previewVideoEl.onloadeddata = handlePreviewVideoReady;
    previewVideoEl.oncanplay = handlePreviewVideoReady;
    previewVideoEl.onplaying = handlePreviewVideoStarted;
    previewVideoEl.onerror = () => {
      if (String(WS.preview.fileId || "") !== String(rec.id || "")) return;
      if (retryNativePreviewMediaAsBlob(rec)) return;
      showPreviewViewportMessage("Could not load video", rec.relPath || rec.name || "");
    };

    applyVideoPoster(previewVideoEl, rec);
    previewVideoEl.dataset.previewFileId = String(rec.id || "");
    previewVideoEl.__lgPreviewFrameToken = previewVideoTransitionToken;
    if (shouldAutoPlay && !keepPreviewVideoElement) previewVideoEl.classList.remove("ready");
    else if (!shouldAutoPlay) previewVideoEl.classList.add("ready");
    const src = ensureMediaUrl(rec) || "";
    if (!src) {
      showPreviewViewportMessage("Could not load video", rec.relPath || rec.name || "");
      return;
    }
    const same = previewVideoEl.src === src;
    previewVideoEl.preload = "auto";
    if (!same) {
      previewVideoEl.src = src;
      try {
        previewVideoEl.load();
      } catch {}
    }
    armPreviewVideoFirstFrame(
      previewVideoEl,
      rec.id,
      previewVideoTransitionToken,
      shouldAutoPlay,
    );
    // Direct CSS color filter on preview video for reliable application
    try { applyDirectMediaCssEffectsForTarget(previewVideoEl, rec); } catch {}
    // Explicit play kick helps eliminate the initial 1-2s hesitation on first
    // selection under Tauri/WKWebView (was instant with direct file: in Electron).
    if (shouldAutoPlay) {
      try {
        const p = previewVideoEl.play();
        if (p && typeof p.then === "function") p.catch(() => {});
      } catch {}
    }
    // Kick filter engine immediately so the first decoded frame (with any
    // preset optical filters/overlays) gets processed without extra delay.
    try { MediaFilterEngine.requestRender(); } catch {}
    previewVideoEl.style.display = "block";
    if (holdFilteredFrame || holdPreviewVideoElementDuringRetarget)
      previewVideoEl.classList.add("mediaHidden");
    else previewVideoEl.classList.remove("mediaHidden");
    previewVideoEl.setAttribute("data-dir-path", rec.dirPath || "");
    syncMediaFilterSurface(
      "preview",
      previewVideoEl,
      previewViewportBox,
      "video",
      rec,
    );
    if (holdPreviewVideoElementDuringRetarget)
      previewVideoEl.classList.add("mediaHidden");

    applyVideoCarryToElement(previewVideoEl, rec.id, {
      allowPlay: !pauseLocked,
    });

    if (previewVideoEl.readyState >= 2) {
      requestAnimationFrame(() => {
        if (String(WS.preview.fileId || "") !== String(rec.id || "")) return;
        if (promotedWarmPreviewVideo || !shouldAutoPlay || !previewVideoEl.paused)
          armPreviewVideoFirstFrame(
            previewVideoEl,
            rec.id,
            previewVideoTransitionToken,
            shouldAutoPlay,
          );
      });
    }
    if (shouldAutoPlay) {
      try {
        previewVideoEl.play();
      } catch {}
    } else {
      cancelResponsiveVideoSeek(previewVideoEl);
      try {
        previewVideoEl.pause();
      } catch {}
    }
    preloadNextMedia(viewerItems, viewerIndex);
    return;
  }

  const finalizePreviewImageFrame = () => {
    if (
      String(previewImgEl.dataset.previewFileId || "") !==
        String(rec.id || "") ||
      String(WS.preview.fileId || "") !== String(rec.id || "")
    )
      return false;
    const imageMode = detectScrollImageMode(rec, previewImgEl);
    applyScrollImageMode(
      previewViewportBox,
      previewImgEl,
      imageMode,
      false,
    );
    if (imageMode !== "none") {
      clearMediaFilterSurface("preview", previewImgEl);
      applyScrollImageProcessingFallback(previewImgEl, rec, imageMode);
      previewImgEl.classList.remove("mediaHidden");
    } else {
      syncMediaFilterSurface(
        "preview",
        previewImgEl,
        previewViewportBox,
        "image",
        rec,
      );
    }
    previewImgEl.style.display = "block";
    revealScrollImageLayout(
      previewImgEl,
      () =>
        String(previewImgEl.dataset.previewFileId || "") ===
          String(rec.id || "") &&
        String(WS.preview.fileId || "") === String(rec.id || ""),
      () =>
        hidePreviewVideoTransitionFrameAfterPaint(
          () =>
            String(previewImgEl.dataset.previewFileId || "") ===
              String(rec.id || "") &&
            String(WS.preview.fileId || "") === String(rec.id || ""),
        ),
    );
    return true;
  };
  previewImgEl.onload = finalizePreviewImageFrame;
  previewImgEl.onerror = () => {
    if (String(WS.preview.fileId || "") !== String(rec.id || "")) return;
    if (retryNativePreviewMediaAsBlob(rec)) return;
    showPreviewViewportMessage("Could not load image", rec.relPath || rec.name || "");
  };
  configurePreviewMediaElementForMaxQuality(previewImgEl);
  const src = ensurePreviewImageSrc(rec) || "";
  if (!src) {
    showPreviewViewportMessage("Could not load image", rec.relPath || rec.name || "");
    return;
  }
  kickUpgradePreviewImageToFullRes(rec);
  const same = previewImgEl.src === src;
  const holdFilteredFrame = shouldHoldPreviewFilteredFrameForTarget(rec);
  previewImgEl.dataset.previewFileId = String(rec.id || "");
  const initialPreviewMode = same
    ? detectScrollImageMode(rec, previewImgEl)
    : predictScrollImageModeForRecord(rec);
  applyScrollImageMode(
    previewViewportBox,
    previewImgEl,
    initialPreviewMode,
    false,
  );
  if (holdFilteredFrame || (holdPreviewImageFrame && mediaFilterEnabled()))
    previewImgEl.classList.add("mediaHidden");
  else previewImgEl.classList.remove("mediaHidden");
  previewImgEl.setAttribute("data-dir-path", rec.dirPath || "");
  try { applyDirectMediaCssEffectsForTarget(previewImgEl, rec); } catch {}
  if (!same) {
    PREVIEW_IMAGE_SWAP_TOKEN = (PREVIEW_IMAGE_SWAP_TOKEN + 1) >>> 0;
    previewImgEl.dataset.previewFileId = String(rec.id || "");
    previewImgEl.classList.remove("ready");
    previewImgEl.style.removeProperty("visibility");
    previewImgEl.src = src;
    previewImgEl.style.display = "block";
    preloadNextMedia(viewerItems, viewerIndex);
    return;
  }
  previewImgEl.style.removeProperty("visibility");
  const previewMode = initialPreviewMode;
  if (previewMode !== "none") {
    clearPendingFilmCornerMask(previewImgEl);
    clearMediaFilterSurface("preview", previewImgEl);
    applyScrollImageProcessingFallback(previewImgEl, rec, previewMode);
    previewImgEl.classList.remove("mediaHidden");
  } else {
    syncMediaFilterSurface(
      "preview",
      previewImgEl,
      previewViewportBox,
      "image",
      rec,
    );
  }
  previewImgEl.style.display = "block";
  revealScrollImageLayout(
    previewImgEl,
    () =>
      String(previewImgEl.dataset.previewFileId || "") === String(rec.id || "") &&
      String(WS.preview.fileId || "") === String(rec.id || ""),
    () =>
      hidePreviewVideoTransitionFrameAfterPaint(
        () =>
          String(previewImgEl.dataset.previewFileId || "") ===
            String(rec.id || "") &&
          String(WS.preview.fileId || "") === String(rec.id || ""),
      ),
  );

  if (previewImgEl.complete && previewImgEl.naturalWidth > 0) {
    requestAnimationFrame(() => {
      if (
        String(previewImgEl.dataset.previewFileId || "") !==
          String(rec.id || "") ||
        String(WS.preview.fileId || "") !== String(rec.id || "")
      )
        return;
      const imageMode = detectScrollImageMode(rec, previewImgEl);
      applyScrollImageMode(previewViewportBox, previewImgEl, imageMode, false);
      if (imageMode !== "none") {
        clearPendingFilmCornerMask(previewImgEl);
        clearMediaFilterSurface("preview", previewImgEl);
        applyScrollImageProcessingFallback(previewImgEl, rec, imageMode);
        previewImgEl.classList.remove("mediaHidden");
      } else {
        syncMediaFilterSurface(
          "preview",
          previewImgEl,
          previewViewportBox,
          "image",
          rec,
        );
      }
      previewImgEl.style.display = "block";
      revealScrollImageLayout(
        previewImgEl,
        () =>
          String(previewImgEl.dataset.previewFileId || "") ===
            String(rec.id || "") &&
          String(WS.preview.fileId || "") === String(rec.id || ""),
        () =>
          hidePreviewVideoTransitionFrameAfterPaint(
            () =>
              String(previewImgEl.dataset.previewFileId || "") ===
                String(rec.id || "") &&
              String(WS.preview.fileId || "") === String(rec.id || ""),
          ),
      );
    });
  }
  preloadNextMedia(viewerItems, viewerIndex);
}

// USER NOTE (DO NOT CASUALLY CHANGE):
// Viewer/file stepping must synchronize back through the SAME pending-center directory scroll path used by
// folder navigation. Keep the pendingDirScroll + renderDirectoriesPane(false) pair together.
function syncDirectoriesToViewerState() {
  if (!WS.root) return;
  if (!viewerDirNode) return;
  if (!viewerItems.length) return;
  const preservePreviewOwnedContext =
    !VIEWER_MODE &&
    !!WS.view.returnToPreviewPaneAfterFileClose &&
    WS.preview.kind === "file";
  const previewOwnedDirNode = preservePreviewOwnedContext
    ? viewerDirNode || WS.preview.dirNode || null
    : null;

  WS.nav.dirNode = viewerDirNode;
  if (searchBrowsingResultFolder()) {
    enterSearchResultContext(viewerDirNode.path || "");
  }
  TAG_EDIT_PATH = null;
  clearBulkTagPlaceholder();
  syncBulkSelectionForCurrentDir();
  syncFavoritesUi();
  syncTagUiForCurrentDir();
  rebuildDirectoriesEntries();

  normalizeViewerStateForCurrentFilters();
  const item = viewerItems[viewerIndex] || null;

  let idx = 0;
  if (item) {
    if (item.isFolder) {
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const e = WS.nav.entries[i];
        if (e && e.kind === "dir" && e.node === item.dirNode) {
          idx = i;
          break;
        }
      }
    } else {
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const e = WS.nav.entries[i];
        if (
          e &&
          e.kind === "file" &&
          String(e.id || "") === String(item.id || "")
        ) {
          idx = i;
          break;
        }
      }
    }
  }

  WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
  saveGridSelectionForCurrentContext();
  if (preservePreviewOwnedContext && item && !item.isFolder && item.id) {
    applyPreviewState({
      kind: "file",
      dirNode: previewOwnedDirNode,
      fileId: item.id,
    });
  } else {
    syncPreviewToSelection({ force: true });
  }

  // Critical for file-row autoscroll parity with folders.
  WS.view.pendingDirScroll = isGridInteractionMode()
    ? "grid-nearest"
    : "center-selected";
  renderDirectoriesPane(false);
  renderPreviewPane(false, true);
  if (searchBrowsingResultFolder() && viewerDirNode) {
    const restorePane =
      String(WS.view.activePane || "") === "preview"
        ? "preview"
        : "directories";
    VIEWER_CLOSE_RESTORE_STATE = captureSearchResultsRestoreState(
      viewerDirNode,
      { activePane: restorePane },
    );
  }
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}
