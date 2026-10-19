/* Preview transitions
   Held frames between files, and preloading. */

// A transition snapshot must composite exactly like the media it stands in for,
// or the hand-over reads as the picture changing appearance.
//
// It CANNOT do that by baking the grade in with `ctx.filter` during drawImage:
// WKWebView — the engine this app actually ships on — has no `filter` property
// on CanvasRenderingContext2D at all, so that assignment is silently dropped and
// the snapshot comes out completely ungraded. (Chromium implements it, which is
// why this survived browser-based testing for so long.)
//
// CSS `filter` on the canvas *element* is universally supported, so mirror the
// source element's own computed filter onto the snapshot instead. Pass a null
// source for canvas-derived pixels, which are already graded.
let PREVIEW_TRANSITION_FRAME_AT = 0;
let VIEWER_TRANSITION_FRAME_AT = 0;
// How long a snapshot may keep standing in when no fresh one can be taken.
// Long enough to bridge one slow decode, short enough that a held-down next
// key cannot drag a frame from several files back across the whole run.
const PREVIEW_TRANSITION_FRAME_MAX_AGE_MS = 400;

function applyTransitionFrameSourceFilter(canvas, sourceEl) {
  if (!canvas) return "";
  let cssFilter = "";
  let radius = "";
  if (sourceEl && typeof getComputedStyle === "function") {
    try {
      const cs = getComputedStyle(sourceEl);
      cssFilter = cs.filter && cs.filter !== "none" ? cs.filter : "";
      radius = cs.borderRadius && cs.borderRadius !== "0px" ? cs.borderRadius : "";
    } catch {}
  }
  if (cssFilter) canvas.style.filter = cssFilter;
  else canvas.style.removeProperty("filter");
  // The film-corner mask is a border-radius on the media element; carry it over
  // so a rounded frame does not square off for the length of the transition.
  if (radius) {
    canvas.style.borderRadius = radius;
    canvas.style.overflow = "hidden";
  } else {
    canvas.style.removeProperty("border-radius");
    canvas.style.removeProperty("overflow");
  }
  return cssFilter;
}

function capturePreviewVideoTransitionFrame() {
  const canvas = ensurePreviewVideoTransitionCanvas();
  if (!canvas || !previewViewportBox) return false;

  // Freshly redraw the active filter canvas so the drawImage() below reads real
  // pixels. The GL context is preserveDrawingBuffer:false, so a canvas last
  // drawn on a previous frame has had its buffer cleared by the compositor and
  // would capture as black — which is exactly the filtered-nav flash. This must
  // stay synchronous through to the drawImage call (no await/yield) so the fresh
  // buffer survives.
  let source = MediaFilterEngine.renderSurfaceNow("preview");
  if (
    source &&
    (source.style.display === "none" || !source.width || !source.height)
  )
    source = null;
  // If the surface has already been retargeted, renderSurfaceNow() is null and
  // the live canvas is an empty husk -- but the retained hold frame is a 2D
  // canvas whose pixels persist, and it is exactly what the user is looking at.
  // Prefer it over re-deriving the frame from the raw element, which would bake
  // in only the cheap CSS approximation and lose the whole optical pipeline.
  if (!source) {
    const held = MediaFilterEngine.holdFrameCanvas("preview");
    if (held && held.width > 0 && held.height > 0) source = held;
  }
  // NOTE: there is deliberately no fallback to a bare `.mediaCanvas.ready`
  // here. If renderSurfaceNow() declined, that canvas is exactly the one whose
  // GL buffer the compositor has already discarded, so drawImage()-ing it
  // captures transparent black — a mask that flashes instead of masking.
  // renderSurfaceNow (live) and the retained hold frame are the only canvases
  // whose pixels are guaranteed real.
  if (
    !source &&
    previewVideoEl &&
    previewVideoEl.style.display !== "none" &&
    previewVideoEl.readyState >= 2 &&
    previewVideoEl.videoWidth > 0 &&
    previewVideoEl.videoHeight > 0
  ) {
    source = previewVideoEl;
  }
  if (
    !source &&
    previewImgEl &&
    previewImgEl.style.display !== "none" &&
    previewImgEl.complete &&
    previewImgEl.naturalWidth > 0 &&
    previewImgEl.naturalHeight > 0
  ) {
    source = previewImgEl;
  }
  if (!source) {
    // Nothing current is snapshot-able. Retaining a RECENT mask keeps fast
    // stepping from flashing black, but the old code retained it unconditionally
    // AND re-showed it via showPreviewVideoTransitionFrame() -- which resets
    // transition:none/opacity:1. Held down, every hop yanked one ancient capture
    // back to full opacity while the previous hop's 84ms fade was still running,
    // so media from several files back flickered on and off over the media you
    // were actually browsing. Leave the frame strictly alone here: an in-flight
    // fade completes instead of being snapped back, and a stale one ages out.
    if (
      canvas.style.display === "block" &&
      performance.now() - PREVIEW_TRANSITION_FRAME_AT <
        PREVIEW_TRANSITION_FRAME_MAX_AGE_MS
    )
      return true;
    return false;
  }

  const cssWidth = Math.max(1, previewViewportBox.clientWidth || 0);
  const cssHeight = Math.max(1, previewViewportBox.clientHeight || 0);
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
    if (source.tagName === "CANVAS") {
      // Canvas sources (the live GL output, or the retained hold frame) already
      // contain graded pixels.
      ctx.drawImage(source, 0, 0, pixelWidth, pixelHeight);
      applyTransitionFrameSourceFilter(canvas, null);
    } else {
      const sourceWidth =
        source.tagName === "VIDEO" ? source.videoWidth : source.naturalWidth;
      const sourceHeight =
        source.tagName === "VIDEO" ? source.videoHeight : source.naturalHeight;
      const scale = Math.min(cssWidth / sourceWidth, cssHeight / sourceHeight);
      const drawWidth = sourceWidth * scale * dpr;
      const drawHeight = sourceHeight * scale * dpr;
      const drawX = (pixelWidth - drawWidth) / 2;
      const drawY = (pixelHeight - drawHeight) / 2;
      ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
      applyTransitionFrameSourceFilter(canvas, source);
    }
  } catch {
    return false;
  }
  PREVIEW_TRANSITION_FRAME_AT = performance.now();
  paintDebugMediaLayer(canvas, "mask");
  return showPreviewVideoTransitionFrame(canvas);
}

function beginPreviewVideoTransition(rec) {
  const token = ++PREVIEW_VIDEO_TRANSITION_TOKEN;
  const canvas = ensurePreviewVideoTransitionCanvas();
  if (!rec || (rec.type !== "video" && rec.type !== "image")) {
    if (canvas) hidePreviewVideoTransitionFrame(true);
    return token;
  }
  const currentEl = rec.type === "video" ? previewVideoEl : previewImgEl;
  const currentId = String(currentEl?.dataset?.previewFileId || "");
  if (
    currentId &&
    currentId === String(rec.id || "") &&
    currentEl &&
    currentEl.style.display !== "none"
  )
    return token;
  if (!capturePreviewVideoTransitionFrame() && canvas)
    canvas.style.display = "none";
  return token;
}

function revealPreviewVideoFrame(videoEl, fileId, transitionToken) {
  if (!videoEl || videoEl !== previewVideoEl) return false;
  if (String(videoEl.dataset.previewFileId || "") !== String(fileId || ""))
    return false;
  if (String(WS.preview?.fileId || "") !== String(fileId || "")) return false;
  if (Number(transitionToken) !== PREVIEW_VIDEO_TRANSITION_TOKEN) return false;
  if (
    videoEl.readyState < 2 ||
    !(Number(videoEl.videoWidth) > 0) ||
    !(Number(videoEl.videoHeight) > 0)
  )
    return false;
  const rec = WS.fileById.get(String(fileId || "")) || null;
  if (!targetRequiresMediaProcessingPipeline(rec))
    videoEl.classList.remove("mediaHidden");
  videoEl.classList.add("ready");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (videoEl !== previewVideoEl) return;
      if (String(WS.preview?.fileId || "") !== String(fileId || "")) return;
      if (Number(transitionToken) !== PREVIEW_VIDEO_TRANSITION_TOKEN) return;
      hidePreviewVideoTransitionFrame(false);
    });
  });
  return true;
}

function armPreviewVideoFirstFrame(videoEl, fileId, transitionToken, autoplay) {
  if (!videoEl) return;
  const token = Number(transitionToken) || 0;
  videoEl.__lgPreviewFrameToken = token;
  const reveal = () => {
    if (videoEl.__lgPreviewFrameToken !== token) return;
    revealPreviewVideoFrame(videoEl, fileId, token);
  };
  if (
    autoplay &&
    typeof videoEl.requestVideoFrameCallback === "function"
  ) {
    if (videoEl.__lgPreviewFrameCallbackToken === token) return;
    videoEl.__lgPreviewFrameCallbackToken = token;
    try {
      videoEl.requestVideoFrameCallback(() => {
        if (videoEl.__lgPreviewFrameCallbackToken === token)
          videoEl.__lgPreviewFrameCallbackToken = 0;
        reveal();
      });
      return;
    } catch {}
  }
  if (videoEl.readyState >= 2) requestAnimationFrame(reveal);
}

function resetPreviewVideoTransientHandlers(videoEl) {
  if (!videoEl) return;
  videoEl.onloadeddata = null;
  videoEl.oncanplay = null;
  videoEl.onplaying = null;
  videoEl.onended = null;
  videoEl.onerror = null;
}

function wirePreviewVideoElement(videoEl) {
  if (!videoEl) return null;
  prepareMediaElementForCanvas(videoEl);
  configurePreviewMediaElementForMaxQuality(videoEl);
  videoEl.controls = false;
  videoEl.preload = "auto";
  videoEl.playsInline = true;
  normalizeVideoPlaybackRate(videoEl);
  if (!videoEl.poster) videoEl.poster = BLACK_POSTER_URL;
  if (videoEl.__lgPreviewVideoWired) return videoEl;
  videoEl.__lgPreviewVideoWired = true;
  [
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "play",
    "pause",
    "volumechange",
    "ended",
    "emptied",
  ].forEach((eventName) => {
    videoEl.addEventListener(eventName, () => {
      if (videoEl === previewVideoEl) syncControlPaneState();
    });
  });
  const markPreviewVideoStarted = () => {
    if (videoEl !== previewVideoEl) return;
    const fileId = String(videoEl.dataset.previewFileId || "");
    if (!fileId || String(WS.preview?.fileId || "") !== fileId) return;
    // `playing` can precede the first composited frame in WKWebView. Keep the
    // transition canvas up until requestVideoFrameCallback confirms a frame.
    armPreviewVideoFirstFrame(
      videoEl,
      fileId,
      Number(videoEl.__lgPreviewFrameToken) || PREVIEW_VIDEO_TRANSITION_TOKEN,
      true,
    );
    const rec = WS.fileById.get(fileId) || null;
    if (rec && rec.type === "video") schedulePreviewVideoPosterRequest(rec);
  };
  videoEl.addEventListener("playing", markPreviewVideoStarted);
  videoEl.addEventListener("timeupdate", markPreviewVideoStarted);
  return videoEl;
}

function trimPreloadMediaCache() {
  if (!(PRELOAD_CACHE instanceof Map)) return;
  const maxItems = preloadMode() === "ultra" ? 12 : 8;
  while (PRELOAD_CACHE.size > maxItems) {
    const first = PRELOAD_CACHE.entries().next();
    if (first.done) break;
    const [url, mediaEl] = first.value;
    PRELOAD_CACHE.delete(url);
    if (mediaEl !== previewVideoEl) stopCachedMediaElement(mediaEl);
  }
}

function cachePreviewVideoElement(videoEl) {
  if (!videoEl || !(PRELOAD_CACHE instanceof Map)) return false;
  const src = String(videoEl.currentSrc || videoEl.getAttribute("src") || "");
  if (!src) return false;
  cancelResponsiveVideoSeek(videoEl);
  resetPreviewVideoTransientHandlers(videoEl);
  try { videoEl.pause(); } catch {}
  try { videoEl.currentTime = 0; } catch {}
  videoEl.muted = true;
  videoEl.autoplay = false;
  videoEl.loop = false;
  videoEl.style.display = "none";
  videoEl.classList.remove("ready", "mediaHidden");
  videoEl.style.removeProperty("filter");
  invalidateMediaElementAppearance(videoEl);
  delete videoEl.dataset.previewFileId;
  videoEl.removeAttribute("data-dir-path");
  const existing = PRELOAD_CACHE.get(src);
  if (existing && existing !== videoEl) stopCachedMediaElement(existing);
  PRELOAD_CACHE.delete(src);
  PRELOAD_CACHE.set(src, videoEl);
  trimPreloadMediaCache();
  return true;
}

function promotePreloadedPreviewVideo(rec) {
  if (!rec || rec.type !== "video" || !(PRELOAD_CACHE instanceof Map))
    return false;
  const src = ensureMediaUrl(rec) || "";
  if (!src) return false;
  const warmed = PRELOAD_CACHE.get(src);
  if (!warmed || String(warmed.tagName || "").toLowerCase() !== "video")
    return false;
  PRELOAD_CACHE.delete(src);
  if (warmed === previewVideoEl) return warmed.readyState >= 2;

  const outgoing = previewVideoEl;
  resetPreviewVideoTransientHandlers(warmed);
  wirePreviewVideoElement(warmed);
  warmed.style.display = "none";
  warmed.classList.remove("ready", "mediaHidden");
  if (outgoing && outgoing.parentElement === previewViewportBox) {
    previewViewportBox.replaceChild(warmed, outgoing);
  } else if (previewFolderEl && previewFolderEl.parentElement === previewViewportBox) {
    previewViewportBox.insertBefore(warmed, previewFolderEl);
  } else {
    previewViewportBox.appendChild(warmed);
  }
  previewVideoEl = warmed;
  if (outgoing && outgoing !== warmed && !cachePreviewVideoElement(outgoing))
    stopCachedMediaElement(outgoing);
  ensurePreviewVideoTransitionCanvas();
  return warmed.readyState >= 2;
}

async function preloadMediaRecord(rec, aggressive) {
  if (!rec || rec.__lgPreviewPreloadPending) return;
  rec.__lgPreviewPreloadPending = true;
  try {
    if (!rec.file) await ensureFileObjectForRecord(rec);
    const url = ensureMediaUrl(rec);
    if (!url || PRELOAD_CACHE.has(url)) return;
    if (rec.type === "image") {
      const img = new Image();
      img.src = url;
      PRELOAD_CACHE.set(url, img);
      trimPreloadMediaCache();
      return;
    }
    const vid = document.createElement("video");
    prepareMediaElementForCanvas(vid);
    vid.preload = aggressive ? "auto" : "metadata";
    vid.muted = true;
    normalizeVideoPlaybackRate(vid);
    vid.playsInline = true;
    vid.src = url;
    PRELOAD_CACHE.set(url, vid);
    trimPreloadMediaCache();
    try {
      vid.load();
    } catch {}
  } finally {
    rec.__lgPreviewPreloadPending = false;
  }
}

function preloadNextMedia(items, startIdx) {
  const mode = preloadMode();
  if (mode === "off") return;
  if (!Array.isArray(items) || !items.length) return;
  const aggressive = mode === "ultra";
  const perDirection = aggressive ? 4 : 2;
  const seen = new Set();
  const currentItem = items[startIdx] || null;
  if (currentItem && !currentItem.isFolder)
    seen.add(String(currentItem.id || ""));
  for (const direction of [1, -1]) {
    let idx = startIdx;
    let found = 0;
    let guard = 0;
    while (found < perDirection && guard < items.length * 2) {
      idx = (idx + direction + items.length) % items.length;
      const it = items[idx];
      if (it && !it.isFolder && !seen.has(String(it.id || ""))) {
        seen.add(String(it.id || ""));
        const rec = WS.fileById.get(it.id);
        if (rec) {
          preloadMediaRecord(rec, aggressive);
          found++;
        }
      }
      guard++;
    }
  }
}

function ensurePreviewFileElements() {
  if (!previewViewportBox) {
    previewViewportBox = document.createElement("div");
    previewViewportBox.id = "filePreviewViewport";
  }
  if (!previewImgEl) {
    previewImgEl = document.createElement("img");
    prepareMediaElementForCanvas(previewImgEl);
    configurePreviewMediaElementForMaxQuality(previewImgEl);
    previewImgEl.style.display = "none";
    previewImgEl.onload = () => {
      previewImgEl.classList.add("ready");
      MediaFilterEngine.requestRender();
    };
    previewViewportBox.appendChild(previewImgEl);
  }
  if (!previewVideoEl) {
    previewVideoEl = wirePreviewVideoElement(document.createElement("video"));
    previewVideoEl.autoplay = true;
    previewVideoEl.muted = false;
    previewVideoEl.poster = BLACK_POSTER_URL;
    previewVideoEl.style.display = "none";
    previewViewportBox.appendChild(previewVideoEl);
  }
  if (!previewFolderEl) {
    previewFolderEl = document.createElement("div");
    previewFolderEl.style.display = "none";
    previewViewportBox.appendChild(previewFolderEl);
  }
  ensurePreviewVideoTransitionCanvas();
}

function seedPreviewViewportWithRecordHint(rec) {
  if (!rec) return false;
  ensurePreviewFileElements();
  if (previewFolderEl) previewFolderEl.style.display = "none";
  if (rec.type === "image" && previewImgEl) {
    const holdFilteredFrame = shouldHoldPreviewFilteredFrameForTarget(rec);
    const hintSrc =
      getPassivePreviewSrcForRecord(rec, { allowImageMediaFallback: true }) ||
      ensureMediaUrl(rec) ||
      "";
    if (!hintSrc) return false;
    configurePreviewMediaElementForMaxQuality(previewImgEl);
    previewImgEl.dataset.previewFileId = String(rec.id || "");
    previewImgEl.setAttribute("data-dir-path", rec.dirPath || "");
    previewImgEl.classList.add("ready");
    if (holdFilteredFrame) previewImgEl.classList.add("mediaHidden");
    else previewImgEl.classList.remove("mediaHidden");
    try { applyDirectMediaCssEffectsForTarget(previewImgEl, rec); } catch {}
    if (String(previewImgEl.getAttribute("src") || "") !== String(hintSrc)) {
      previewImgEl.src = hintSrc;
    }
    previewImgEl.style.display = "block";
    if (previewVideoEl) {
      cancelResponsiveVideoSeek(previewVideoEl);
      try { previewVideoEl.pause(); } catch {}
      previewVideoEl.style.display = "none";
      previewVideoEl.classList.remove("ready");
      previewVideoEl.classList.remove("mediaHidden");
    }
    return true;
  }
  if (rec.type === "video" && previewVideoEl) {
    const holdFilteredFrame = shouldHoldPreviewFilteredFrameForTarget(rec);
    const mode = previewVideoMode();
    const shouldAutoPlay =
      mode !== "off" &&
      !BANIC_ACTIVE &&
      !VIEWER_MODE &&
      !previewVideoUserPausedFor(rec.id);
    applyVideoPoster(previewVideoEl, rec);
    previewVideoEl.dataset.previewFileId = String(rec.id || "");
    previewVideoEl.setAttribute("data-dir-path", rec.dirPath || "");
    if (shouldAutoPlay) previewVideoEl.classList.remove("ready");
    else previewVideoEl.classList.add("ready");
    previewVideoEl.autoplay = shouldAutoPlay;
    previewVideoEl.muted = mode === "muted" || BANIC_ACTIVE || VIEWER_MODE;
    if (holdFilteredFrame) previewVideoEl.classList.add("mediaHidden");
    else previewVideoEl.classList.remove("mediaHidden");
    // Ensure color filters via CSS on preview video before the element is visible.
    try { applyDirectMediaCssEffectsForTarget(previewVideoEl, rec); } catch {}
    // Start loading the video src as early as possible (selection hint time)
    // so decode starts before full render. This reduces the first-select lag
    // under Tauri asset protocol (was faster with direct file:// in Electron).
    const vsrc = ensureMediaUrl(rec) || "";
    if (vsrc) {
      previewVideoEl.preload = "auto";
      if (String(previewVideoEl.getAttribute("src") || "") !== vsrc) {
        previewVideoEl.src = vsrc;
        try { previewVideoEl.load(); } catch {}
      }
    }
    if (shouldAutoPlay) {
      try {
        const playPromise = previewVideoEl.play();
        if (playPromise && typeof playPromise.then === "function")
          playPromise.catch(() => {});
      } catch {}
    }
    previewVideoEl.style.display = "block";
    if (previewImgEl) {
      previewImgEl.style.display = "none";
      previewImgEl.classList.remove("ready");
      previewImgEl.classList.remove("mediaHidden");
    }
    return true;
  }
  return false;
}

function ensureViewerFromPreviewFileId(fileId) {
  const targetId = String(fileId || "");
  if (!WS.root || !targetId) return false;
  const rec = WS.fileById.get(targetId);
  if (!rec || !passesFilter(rec)) return false;

  const p = rec ? rec.dirPath || "" : "";
  const previewContextDir =
    WS.preview && WS.preview.kind === "file" && WS.preview.dirNode
      ? WS.preview.dirNode
      : null;
  const contextDirContainsFile = (dirNode) => {
    if (!dirNode) return false;
    if (!dirNode._skipTagFilters) {
      return (
        String(dirNode.path || "") === String(p || "") &&
        recordPassesContextualTagMediaFilterForDir(rec, dirNode)
      );
    }
    const items = buildViewerItemsForDir(dirNode);
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.isFolder) continue;
      if (String(item.id || "") === String(fileId || "")) return true;
    }
    return false;
  };
  const contextDir =
    previewContextDir && contextDirContainsFile(previewContextDir)
      ? previewContextDir
      : null;
  const dn = contextDir || WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;

  viewerDirNode = dn;
  viewerItems = buildViewerItemsForDir(viewerDirNode);

  let idx = 0;
  const found = viewerItems.findIndex(
    (it) => !it.isFolder && String(it.id || "") === targetId,
  );
  if (found >= 0) {
    idx = found;
  } else {
    idx = findFirstFileIndex(viewerItems);
    if (idx < 0) return false;
  }
  viewerIndex = idx;
  return true;
}
