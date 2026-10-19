/* Crop editor (retired)
   The mouse crop editor, which no longer opens; then the thumbnail runtime
   reset. */

function closeThumbnailCropEditor() {
  if (!THUMB_CROP_EDITOR) return;
  const editorVideo = THUMB_CROP_EDITOR.querySelector
    ? THUMB_CROP_EDITOR.querySelector("video.thumbCropEditorPreviewFull")
    : null;
  if (editorVideo) {
    try {
      editorVideo.pause();
    } catch {}
    try {
      editorVideo.removeAttribute("src");
    } catch {}
    try {
      editorVideo.load();
    } catch {}
  }
  try {
    THUMB_CROP_EDITOR.remove();
  } catch {}
  THUMB_CROP_EDITOR = null;
}

function openThumbnailCropEditor(rec) {
  // The mouse-driven crop editor window has been removed; thumbnails are edited
  // with the keyboard (Cmd+arrows -- see handleThumbnailViewportArrowKey). The
  // dead builder below is left in place but is never entered.
  return false;
  const targetLabel = "this file";
  if (!rec) return false;
  const isVideoEditor = rec.type === "video";
  const previewSrc = isVideoEditor
    ? ensureMediaUrl(rec) || ""
    : ensureThumbUrl(rec) || "";
  if (!previewSrc) {
    showStatusMessage("Thumbnail preview is unavailable.");
    return false;
  }

  closeThumbnailCropEditor();

  const crop = normalizeThumbCropValue(
    metaGetFileThumbnailCropForRecord(rec) || { x: 50, y: 50, zoom: 1 },
  );
  const savedVideoFrameTime = isVideoEditor
    ? metaGetVideoThumbnailTimeForRecord(rec)
    : null;
  const mediaHtml = isVideoEditor
    ? `<video class="thumbCropEditorPreviewFull thumbCropEditorPreviewVideo" src="${escapeHtml(previewSrc)}" preload="metadata" playsinline muted></video><canvas class="thumbCropEditorPreviewFull thumbCropEditorPreviewCanvas" aria-hidden="true"></canvas>`
    : `<img class="thumbCropEditorPreviewFull" src="${escapeHtml(previewSrc)}" alt="" />`;
  const frameControlHtml = isVideoEditor
    ? `
          <div class="thumbCropEditorFrameControl">
            <input type="range" min="0" max="0" step="0.01" value="0" data-crop-field="frame" aria-label="Video thumbnail frame" disabled />
            <span data-crop-value="frame" aria-hidden="true">0:00.00</span>
          </div>
        `
    : "";
  const overlay = document.createElement("div");
  overlay.className = "thumbCropEditorOverlay";
  overlay.tabIndex = -1;
  overlay.innerHTML = `
        <div class="thumbCropEditorPanel" role="dialog" aria-modal="true" aria-label="Edit thumbnail">
          <div class="thumbCropEditorPreviewFrame">
            <div class="thumbCropEditorPreviewWrap">
              ${mediaHtml}
              <div class="thumbCropEditorCropBox" data-crop-box="1"></div>
            </div>
            <div class="thumbCropEditorHandleLayer" aria-hidden="true">
              <button type="button" class="thumbCropEditorResizeHandle" data-crop-handle="resize" data-crop-corner="nw" aria-label="Resize crop viewport from top left" tabindex="-1"></button>
              <button type="button" class="thumbCropEditorResizeHandle" data-crop-handle="resize" data-crop-corner="ne" aria-label="Resize crop viewport from top right" tabindex="-1"></button>
              <button type="button" class="thumbCropEditorResizeHandle" data-crop-handle="resize" data-crop-corner="sw" aria-label="Resize crop viewport from bottom left" tabindex="-1"></button>
              <button type="button" class="thumbCropEditorResizeHandle" data-crop-handle="resize" data-crop-corner="se" aria-label="Resize crop viewport from bottom right" tabindex="-1"></button>
            </div>
          </div>
          ${frameControlHtml}
          <div class="thumbCropEditorHiddenControls" aria-hidden="true">
            <input type="range" min="0" max="100" step="1" value="${escapeHtml(String(crop.x))}" data-crop-field="x" />
            <span data-crop-value="x">${escapeHtml(String(Math.round(crop.x)))}</span>
            <input type="range" min="0" max="100" step="1" value="${escapeHtml(String(crop.y))}" data-crop-field="y" />
            <span data-crop-value="y">${escapeHtml(String(Math.round(crop.y)))}</span>
            <input type="range" min="1" max="4" step="0.01" value="${escapeHtml(String(crop.zoom))}" data-crop-field="zoom" />
            <span data-crop-value="zoom">${escapeHtml(crop.zoom.toFixed(2))}</span>
          </div>
          <div class="thumbCropEditorActions">
            <button type="button" data-crop-action="reset">Reset</button>
            <button type="button" data-crop-action="cancel">Cancel</button>
            <button type="button" data-crop-action="save">Save</button>
          </div>
        </div>
      `;
  document.body.appendChild(overlay);
  THUMB_CROP_EDITOR = overlay;

  const panel = overlay.querySelector(".thumbCropEditorPanel");
  const previewFrame = overlay.querySelector(".thumbCropEditorPreviewFrame");
  const previewWrap = overlay.querySelector(".thumbCropEditorPreviewWrap");
  const previewImage = isVideoEditor
    ? null
    : overlay.querySelector("img.thumbCropEditorPreviewFull");
  const previewVideo = isVideoEditor
    ? overlay.querySelector("video.thumbCropEditorPreviewVideo")
    : null;
  const previewCanvas = isVideoEditor
    ? overlay.querySelector("canvas.thumbCropEditorPreviewCanvas")
    : null;
  const cropBox = overlay.querySelector('[data-crop-box="1"]');
  const resizeHandles = Array.from(
    overlay.querySelectorAll('[data-crop-handle="resize"]'),
  );
  const rangeX = overlay.querySelector('input[data-crop-field="x"]');
  const rangeY = overlay.querySelector('input[data-crop-field="y"]');
  const rangeZoom = overlay.querySelector('input[data-crop-field="zoom"]');
  const rangeFrame = overlay.querySelector('input[data-crop-field="frame"]');
  const valX = overlay.querySelector('[data-crop-value="x"]');
  const valY = overlay.querySelector('[data-crop-value="y"]');
  const valZoom = overlay.querySelector('[data-crop-value="zoom"]');
  const valFrame = overlay.querySelector('[data-crop-value="frame"]');
  let editorAspect = normalizePreviewAspect(
    getPreviewAspectForRecord(rec),
    4 / 3,
  );
  let editorVideoDuration = 0;
  const getEditorAspect = () => normalizePreviewAspect(editorAspect, 4 / 3);
  const applyEditorAspect = (nextAspect) => {
    editorAspect = normalizePreviewAspect(nextAspect, getEditorAspect());
    if (previewFrame)
      previewFrame.style.setProperty("--editor-ar", String(editorAspect));
  };
  const getCurrent = () =>
    normalizeThumbCropValue({
      x: Number(rangeX?.value || 50),
      y: Number(rangeY?.value || 50),
      zoom: Number(rangeZoom?.value || 1),
    });
  const applyPreview = () => {
    const cur = getCurrent();
    const overlayWin = computeEditorCropWindow(getEditorAspect(), cur);
    const left = Number(overlayWin.leftPct) || 0;
    const top = Number(overlayWin.topPct) || 0;
    const width = Number(overlayWin.widthPct) || 0;
    const height = Number(overlayWin.heightPct) || 0;
    if (valX) valX.textContent = String(Math.round(cur.x));
    if (valY) valY.textContent = String(Math.round(cur.y));
    if (valZoom) valZoom.textContent = cur.zoom.toFixed(2);
    if (cropBox) {
      cropBox.style.left = `${left}%`;
      cropBox.style.top = `${top}%`;
      cropBox.style.width = `${width}%`;
      cropBox.style.height = `${height}%`;
    }
    if (resizeHandles.length) {
      for (let i = 0; i < resizeHandles.length; i++) {
        const handle = resizeHandles[i];
        const corner = String(handle.dataset && handle.dataset.cropCorner || "se");
        const isWest = corner.includes("w");
        const isNorth = corner.includes("n");
        handle.style.left = `${isWest ? left : left + width}%`;
        handle.style.top = `${isNorth ? top : top + height}%`;
      }
    }
  };
  const setCurrent = (nextCrop) => {
    const next = normalizeThumbCropValue(nextCrop);
    if (rangeX) rangeX.value = String(next.x);
    if (rangeY) rangeY.value = String(next.y);
    if (rangeZoom) rangeZoom.value = String(next.zoom);
    applyPreview();
  };
  const clampEditorVideoTime = (timeValue) =>
    normalizeVideoThumbTimeValue(timeValue, editorVideoDuration);
  const getDefaultEditorVideoTime = () => {
    if (!isVideoEditor) return 0;
    return clampEditorVideoTime(Math.max(0, Math.min(0.1, editorVideoDuration * 0.02))) || 0;
  };
  const getCurrentEditorVideoTime = () => {
    if (!isVideoEditor || !rangeFrame) return null;
    return clampEditorVideoTime(rangeFrame.value);
  };
  const updateEditorVideoFrameLabel = (timeValue) => {
    if (!valFrame) return;
    valFrame.textContent = formatThumbnailEditorTimeLabel(timeValue);
  };
  const syncEditorVideoTimeToSlider = (timeValue) => {
    if (!rangeFrame) return;
    const clamped = clampEditorVideoTime(timeValue);
    const safeValue = Number.isFinite(clamped) ? clamped : 0;
    rangeFrame.value = String(safeValue);
    updateEditorVideoFrameLabel(safeValue);
  };
  // Paint the currently decoded video frame onto the display canvas. The raw
  // <video> is only a decode source hidden under this canvas; drawing solely on
  // settled frames means the user always sees a complete frame (the previous
  // one is retained until the next lands) instead of black/artifact flicker.
  const drawEditorVideoFrame = () => {
    if (!previewVideo || !previewCanvas) return;
    const vw = Number(previewVideo.videoWidth) || 0;
    const vh = Number(previewVideo.videoHeight) || 0;
    if (!(vw > 0 && vh > 0)) return;
    if (previewCanvas.width !== vw) previewCanvas.width = vw;
    if (previewCanvas.height !== vh) previewCanvas.height = vh;
    const ctx = previewCanvas.getContext("2d");
    if (!ctx) return;
    try {
      ctx.drawImage(previewVideo, 0, 0, vw, vh);
    } catch {}
  };
  // Serialize seeks: only one seek may be in flight at a time. Rapid slider
  // scrubbing otherwise stacks overlapping seeks, which WKWebView renders as
  // partially-decoded (artifact-covered) or fully black frames. We always keep
  // the most recently requested time and apply it once the prior seek settles.
  // A watchdog guarantees we never deadlock waiting for a "seeked" that a
  // no-op/failed seek never fires (which previously froze the preview).
  // While actively dragging we use fastSeek() (jump to nearest keyframe, no
  // full inter-frame decode) so long videos scrub responsively instead of
  // stalling on a slow precise seek per frame. When the user settles, a precise
  // seek lands the exact chosen frame. currentTime is the fallback if the UA
  // lacks fastSeek.
  const canFastSeek =
    !!previewVideo && typeof previewVideo.fastSeek === "function";
  let editorSeekPending = null; // { time, live }
  let editorSeekInFlight = false;
  let editorSeekWatchdog = null;
  const clearEditorSeekWatchdog = () => {
    if (editorSeekWatchdog) {
      try {
        clearTimeout(editorSeekWatchdog);
      } catch {}
      editorSeekWatchdog = null;
    }
  };
  const finishEditorSeek = () => {
    clearEditorSeekWatchdog();
    editorSeekInFlight = false;
    drawEditorVideoFrame();
    if (editorSeekPending !== null) applyEditorPendingSeek();
  };
  const applyEditorPendingSeek = () => {
    if (!previewVideo || editorSeekPending === null) return;
    const target = Number(editorSeekPending.time);
    const live = !!editorSeekPending.live;
    editorSeekPending = null;
    const cur = Number(previewVideo.currentTime) || 0;
    // Already sitting on the target frame with data decoded — just repaint.
    if (previewVideo.readyState >= 2 && Math.abs(cur - target) < 0.002) {
      editorSeekInFlight = false;
      clearEditorSeekWatchdog();
      drawEditorVideoFrame();
      return;
    }
    editorSeekInFlight = true;
    clearEditorSeekWatchdog();
    editorSeekWatchdog = setTimeout(() => {
      editorSeekWatchdog = null;
      // The seek never reported back; recover so scrubbing keeps working.
      editorSeekInFlight = false;
      drawEditorVideoFrame();
      if (editorSeekPending !== null) applyEditorPendingSeek();
    }, 1500);
    try {
      if (live && canFastSeek) {
        previewVideo.fastSeek(target);
      } else {
        previewVideo.currentTime = target;
      }
    } catch {
      try {
        previewVideo.currentTime = target;
      } catch {
        editorSeekInFlight = false;
        clearEditorSeekWatchdog();
      }
    }
  };
  const seekEditorVideoToTime = (timeValue, live = false) => {
    if (!previewVideo) return;
    const clamped = clampEditorVideoTime(timeValue);
    if (!Number.isFinite(clamped)) return;
    syncEditorVideoTimeToSlider(clamped);
    editorSeekPending = { time: clamped, live };
    if (editorSeekInFlight) return;
    applyEditorPendingSeek();
  };
  const updateEditorVideoFrameRange = () => {
    if (!rangeFrame) return;
    if (!(editorVideoDuration > 0)) {
      rangeFrame.min = "0";
      rangeFrame.max = "0";
      rangeFrame.step = "0.01";
      rangeFrame.value = "0";
      rangeFrame.disabled = true;
      updateEditorVideoFrameLabel(0);
      return;
    }
    const step = Math.max(0.01, Math.min(0.25, editorVideoDuration / 1000));
    rangeFrame.min = "0";
    rangeFrame.max = String(Math.max(0, editorVideoDuration - 0.05));
    rangeFrame.step = String(Math.round(step * 1000) / 1000);
    rangeFrame.disabled = false;
  };
  const getWrapSize = () => {
    const rect =
      previewWrap && previewWrap.getBoundingClientRect
        ? previewWrap.getBoundingClientRect()
        : null;
    return {
      width: Math.max(1, Number(rect && rect.width) || 1),
      height: Math.max(1, Number(rect && rect.height) || 1),
    };
  };
  const cropWithZoomAroundAnchor = (
    startCrop,
    nextZoom,
    anchorU = null,
    anchorV = null,
  ) => {
    const base = normalizeThumbCropValue(startCrop || getCurrent());
    const zoom = Math.min(4, Math.max(1, Number(nextZoom) || base.zoom || 1));
    const baseWin = computeEditorCropWindow(getEditorAspect(), base);
    const baseLeft = (Number(baseWin.leftPct) || 0) / 100;
    const baseTop = (Number(baseWin.topPct) || 0) / 100;
    const baseW = (Number(baseWin.widthPct) || 0) / 100;
    const baseH = (Number(baseWin.heightPct) || 0) / 100;
    const focusU = Number.isFinite(Number(anchorU))
      ? Math.max(0, Math.min(1, Number(anchorU)))
      : Math.max(0, Math.min(1, baseLeft + baseW * 0.5));
    const focusV = Number.isFinite(Number(anchorV))
      ? Math.max(0, Math.min(1, Number(anchorV)))
      : Math.max(0, Math.min(1, baseTop + baseH * 0.5));
    const probe = computeEditorCropWindow(getEditorAspect(), {
      x: 50,
      y: 50,
      zoom,
    });
    const nextW = (Number(probe.widthPct) || 0) / 100;
    const nextH = (Number(probe.heightPct) || 0) / 100;
    const nextRangeX = (Number(probe.rangeXPct) || 0) / 100;
    const nextRangeY = (Number(probe.rangeYPct) || 0) / 100;
    const nextLeft = Math.min(nextRangeX, Math.max(0, focusU - nextW * 0.5));
    const nextTop = Math.min(nextRangeY, Math.max(0, focusV - nextH * 0.5));
    const nextX = nextRangeX > 0.000001 ? (nextLeft / nextRangeX) * 100 : 50;
    const nextY = nextRangeY > 0.000001 ? (nextTop / nextRangeY) * 100 : 50;
    return normalizeThumbCropValue({ x: nextX, y: nextY, zoom });
  };
  const cropFromPanPixels = (startCrop, dx, dy, zoomOverride = null) => {
    const overrideZoom =
      zoomOverride !== null && zoomOverride !== undefined ? Number(zoomOverride) : NaN;
    const liveZoom = Number(rangeZoom?.value);
    const currentZoom = Number(getCurrent().zoom);
    const startZoom = Number(startCrop && startCrop.zoom);
    const zoom = Number.isFinite(overrideZoom)
      ? overrideZoom
      : Number.isFinite(liveZoom)
        ? liveZoom
        : Number.isFinite(currentZoom)
          ? currentZoom
          : Number.isFinite(startZoom)
            ? startZoom
            : 1;
    const base = normalizeThumbCropValue({
      x: Number(startCrop && startCrop.x),
      y: Number(startCrop && startCrop.y),
      zoom,
    });
    const wrapSize = getWrapSize();
    const overlayWin = computeEditorCropWindow(getEditorAspect(), base);
    const rangeX = Math.max(0, Number(overlayWin.rangeXPct) / 100);
    const rangeY = Math.max(0, Number(overlayWin.rangeYPct) / 100);
    const nextX =
      rangeX > 0.000001
        ? base.x + ((Number(dx) || 0) / wrapSize.width) * (100 / rangeX)
        : base.x;
    const nextY =
      rangeY > 0.000001
        ? base.y + ((Number(dy) || 0) / wrapSize.height) * (100 / rangeY)
        : base.y;
    return normalizeThumbCropValue({
      x: nextX,
      y: nextY,
      zoom: base.zoom,
    });
  };

  [rangeX, rangeY, rangeZoom, rangeFrame].forEach((el) => {
    if (!el) return;
    if (el === rangeFrame) {
      // Dragging => fast keyframe scrub; releasing (change) => precise land.
      el.addEventListener("input", () => {
        const nextTime = getCurrentEditorVideoTime();
        if (Number.isFinite(nextTime)) seekEditorVideoToTime(nextTime, true);
      });
      el.addEventListener("change", () => {
        const nextTime = getCurrentEditorVideoTime();
        if (Number.isFinite(nextTime)) seekEditorVideoToTime(nextTime, false);
      });
      return;
    }
    el.addEventListener("input", applyPreview);
  });
  applyEditorAspect(getEditorAspect());
  if (previewImage) {
    previewImage.addEventListener("load", () => {
      const w = Number(previewImage.naturalWidth) || 0;
      const h = Number(previewImage.naturalHeight) || 0;
      if (w > 0 && h > 0) {
        const naturalAspect = normalizePreviewAspect(
          w / h,
          getPreviewAspectForRecord(rec),
        );
        applyEditorAspect(naturalAspect);
        rec.previewAspect = naturalAspect;
      }
      applyPreview();
    });
  }
  if (previewVideo) {
    previewVideo.controls = false;
    previewVideo.autoplay = false;
    previewVideo.loop = false;
    previewVideo.muted = true;
    previewVideo.addEventListener("play", () => {
      try {
        previewVideo.pause();
      } catch {}
    });
    previewVideo.addEventListener("loadedmetadata", () => {
      editorVideoDuration = Math.max(0, Number(previewVideo.duration || 0));
      updateEditorVideoFrameRange();
      const w = Number(previewVideo.videoWidth) || 0;
      const h = Number(previewVideo.videoHeight) || 0;
      if (w > 0 && h > 0) {
        const naturalAspect = normalizePreviewAspect(
          w / h,
          getPreviewAspectForRecord(rec),
        );
        applyEditorAspect(naturalAspect);
        rec.previewAspect = naturalAspect;
      }
      const initial = Number.isFinite(savedVideoFrameTime)
        ? clampEditorVideoTime(savedVideoFrameTime)
        : getDefaultEditorVideoTime();
      // Fast keyframe seek so the preview shows something immediately even when
      // the saved frame is deep into a long file (avoids the black-on-open),
      // then a precise seek lands the exact saved frame. The precise pending
      // seek is harmlessly superseded if the user starts scrubbing first.
      seekEditorVideoToTime(initial, true);
      window.setTimeout(() => {
        if (THUMB_CROP_EDITOR === overlay) seekEditorVideoToTime(initial, false);
      }, 350);
      applyPreview();
    });
    previewVideo.addEventListener("seeked", () => {
      // Paint the freshly settled frame and, if a newer target arrived while
      // this seek was running, chase it. The slider keeps showing the user's
      // latest request rather than snapping back to the just-settled frame.
      finishEditorSeek();
    });
    previewVideo.addEventListener("loadeddata", () => {
      drawEditorVideoFrame();
      applyPreview();
    });
    previewVideo.addEventListener("error", () => {
      // Never leave the pipeline stuck waiting on a load/seek that failed.
      clearEditorSeekWatchdog();
      editorSeekInFlight = false;
    });
  }
  applyPreview();

  if (previewWrap) {
    let resizeGesture = null;
    const activePointers = new Map();
    let gesture = null;
    const pointerPosInWrap = (e) => {
      const rect =
        previewWrap && previewWrap.getBoundingClientRect
          ? previewWrap.getBoundingClientRect()
          : null;
      const left = Number(rect && rect.left) || 0;
      const top = Number(rect && rect.top) || 0;
      return {
        x: (Number(e && e.clientX) || 0) - left,
        y: (Number(e && e.clientY) || 0) - top,
      };
    };
    const getFirstTwoPointers = () => {
      const vals = Array.from(activePointers.values());
      if (vals.length < 2) return null;
      return [vals[0], vals[1]];
    };
    const pointerDistance = (a, b) =>
      Math.hypot(
        Number(a && a.x) - Number(b && b.x),
        Number(a && a.y) - Number(b && b.y),
      );
    const pointerCenter = (a, b) => ({
      x: (Number(a && a.x) + Number(b && b.x)) * 0.5,
      y: (Number(a && a.y) + Number(b && b.y)) * 0.5,
    });
    const refreshGesture = () => {
      if (activePointers.size >= 2) {
        const pair = getFirstTwoPointers();
        if (!pair) return;
        const center = pointerCenter(pair[0], pair[1]);
        gesture = {
          type: "pinch",
          startCrop: getCurrent(),
          startDist: Math.max(0.0001, pointerDistance(pair[0], pair[1])),
          startCenterX: center.x,
          startCenterY: center.y,
        };
        previewWrap.classList.add("dragging");
        return;
      }
      if (activePointers.size === 1) {
        const point = Array.from(activePointers.values())[0];
        gesture = {
          type: "pan",
          startCrop: getCurrent(),
          startX: Number(point && point.x) || 0,
          startY: Number(point && point.y) || 0,
        };
        previewWrap.classList.add("dragging");
        return;
      }
      gesture = null;
      previewWrap.classList.remove("dragging");
    };
    const onPointerEnd = (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.delete(e.pointerId);
      try {
        previewWrap.releasePointerCapture(e.pointerId);
      } catch {}
      refreshGesture();
    };

    previewWrap.addEventListener("pointerdown", (e) => {
      if (resizeGesture) return;
      if (
        e.target &&
        e.target.closest &&
        e.target.closest('[data-crop-handle="resize"]')
      )
        return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      activePointers.set(e.pointerId, {
        x: Number(e.clientX) || 0,
        y: Number(e.clientY) || 0,
      });
      try {
        previewWrap.setPointerCapture(e.pointerId);
      } catch {}
      refreshGesture();
      e.preventDefault();
    });
    previewWrap.addEventListener("pointermove", (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.set(e.pointerId, {
        x: Number(e.clientX) || 0,
        y: Number(e.clientY) || 0,
      });
      if (!gesture) {
        refreshGesture();
        return;
      }
      if (gesture.type === "pinch" && activePointers.size >= 2) {
        const pair = getFirstTwoPointers();
        if (!pair) return;
        const dist = pointerDistance(pair[0], pair[1]);
        const center = pointerCenter(pair[0], pair[1]);
        const scale = Math.max(
          0.25,
          Math.min(4, dist / Math.max(0.0001, Number(gesture.startDist) || 1)),
        );
        const nextZoom = Math.min(
          4,
          Math.max(1, Number(gesture.startCrop.zoom || 1) * scale),
        );
        const dx = center.x - Number(gesture.startCenterX || 0);
        const dy = center.y - Number(gesture.startCenterY || 0);
        setCurrent(cropFromPanPixels(gesture.startCrop, dx, dy, nextZoom));
        e.preventDefault();
        return;
      }
      if (gesture.type === "pan" && activePointers.size === 1) {
        const point = Array.from(activePointers.values())[0];
        const dx =
          (Number(point && point.x) || 0) - Number(gesture.startX || 0);
        const dy =
          (Number(point && point.y) || 0) - Number(gesture.startY || 0);
        setCurrent(cropFromPanPixels(gesture.startCrop, dx, dy));
        e.preventDefault();
        return;
      }
      refreshGesture();
    });
    previewWrap.addEventListener("pointerup", onPointerEnd);
    previewWrap.addEventListener("pointercancel", onPointerEnd);
    previewWrap.addEventListener("lostpointercapture", onPointerEnd);
    previewWrap.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        const cur = getCurrent();
        const delta = Number(e.deltaY) || 0;
        if (!delta) return;
        const factor = Math.exp(-delta * 0.0025);
        const nextZoom = Math.min(4, Math.max(1, cur.zoom * factor));
        if (Math.abs(nextZoom - cur.zoom) < 0.0001) return;
        setCurrent({ x: cur.x, y: cur.y, zoom: nextZoom });
        e.preventDefault();
      },
      { passive: false },
    );

    if (resizeHandles.length) {
      const onResizeEnd = (e) => {
        if (!resizeGesture || e.pointerId !== resizeGesture.pointerId) return;
        const handle = resizeGesture.handle || e.currentTarget;
        try {
          handle.releasePointerCapture(e.pointerId);
        } catch {}
        handle?.classList?.remove("isActive");
        resizeGesture = null;
        previewWrap.classList.remove("resizing");
        previewFrame?.classList?.remove("cropResizeActive");
      };
      const onResizePointerDown = (e) => {
        if (resizeGesture) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const handle = e.currentTarget;
        const corner = String(
          handle && handle.dataset && handle.dataset.cropCorner || "se",
        );
        const isWest = corner.includes("w");
        const isNorth = corner.includes("n");
        const startCrop = getCurrent();
        const startWin = computeEditorCropWindow(getEditorAspect(), startCrop);
        const leftPct = (Number(startWin.leftPct) || 0) / 100;
        const topPct = (Number(startWin.topPct) || 0) / 100;
        const rightPct =
          ((Number(startWin.leftPct) || 0) +
            (Number(startWin.widthPct) || 0)) /
          100;
        const bottomPct =
          ((Number(startWin.topPct) || 0) +
            (Number(startWin.heightPct) || 0)) /
          100;
        const anchorU = isWest ? rightPct : leftPct;
        const anchorV = isNorth ? bottomPct : topPct;
        const startCornerU = isWest ? leftPct : rightPct;
        const startCornerV = isNorth ? topPct : bottomPct;
        const wrapSize = getWrapSize();
        const anchorPx = {
          x: anchorU * wrapSize.width,
          y: anchorV * wrapSize.height,
        };
        const startDist = Math.max(
          8,
          Math.hypot(
            (startCornerU - anchorU) * wrapSize.width,
            (startCornerV - anchorV) * wrapSize.height,
          ),
        );
        const startVectorX = (startCornerU - anchorU) * wrapSize.width;
        const startVectorY = (startCornerV - anchorV) * wrapSize.height;
        resizeGesture = {
          pointerId: e.pointerId,
          handle,
          corner,
          startCrop,
          startDist,
          startVectorX,
          startVectorY,
          anchorPx,
          anchorU,
          anchorV,
        };
        try {
          handle.setPointerCapture(e.pointerId);
        } catch {}
        handle.classList.add("isActive");
        previewWrap.classList.add("resizing");
        previewFrame?.classList?.add("cropResizeActive");
        e.preventDefault();
        e.stopPropagation();
      };
      const onResizePointerMove = (e) => {
        if (!resizeGesture || e.pointerId !== resizeGesture.pointerId) return;
        const pos = pointerPosInWrap(e);
        const currentVectorX = pos.x - resizeGesture.anchorPx.x;
        const currentVectorY = pos.y - resizeGesture.anchorPx.y;
        const startDistanceSquared = Math.max(
          1,
          resizeGesture.startDist * resizeGesture.startDist,
        );
        const scale = Math.max(
          0.2,
          (currentVectorX * resizeGesture.startVectorX +
            currentVectorY * resizeGesture.startVectorY) /
            startDistanceSquared,
        );
        const nextZoom = Math.min(
          4,
          Math.max(
            1,
            Number(resizeGesture.startCrop.zoom || 1) / Math.max(0.2, scale),
          ),
        );
        setCurrent(
          cropWithZoomAroundAnchor(
            resizeGesture.startCrop,
            nextZoom,
            resizeGesture.anchorU,
            resizeGesture.anchorV,
          ),
        );
        e.preventDefault();
        e.stopPropagation();
      };
      for (let i = 0; i < resizeHandles.length; i++) {
        const handle = resizeHandles[i];
        handle.addEventListener("pointerdown", onResizePointerDown);
        handle.addEventListener("pointermove", onResizePointerMove);
        handle.addEventListener("pointerup", onResizeEnd);
        handle.addEventListener("pointercancel", onResizeEnd);
        handle.addEventListener("lostpointercapture", onResizeEnd);
      }
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeThumbnailCropEditor();
  });
  overlay.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeThumbnailCropEditor();
    }
  });
  if (panel) panel.addEventListener("click", (e) => e.stopPropagation());

  Array.from(overlay.querySelectorAll("[data-crop-action]")).forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = String(btn.getAttribute("data-crop-action") || "");
      if (action === "cancel") {
        closeThumbnailCropEditor();
        return;
      }
      if (action === "reset") {
        if (rangeX) rangeX.value = "50";
        if (rangeY) rangeY.value = "50";
        if (rangeZoom) rangeZoom.value = "1";
        if (isVideoEditor) seekEditorVideoToTime(getDefaultEditorVideoTime());
        applyPreview();
        return;
      }
      if (action === "save") {
        metaSetFileThumbnailCropForRecord(rec, getCurrent());
        if (isVideoEditor) {
          metaSetVideoThumbnailTimeForRecord(
            rec,
            getCurrentEditorVideoTime(),
            editorVideoDuration,
          );
          if (rec.videoThumbUrl) {
            try {
              URL.revokeObjectURL(rec.videoThumbUrl);
            } catch {}
            rec.videoThumbUrl = null;
          }
          rec.videoThumbMode = null;
          enqueueVideoThumb(rec);
          videoThumbCacheEnqueue(rec);
        }
        closeThumbnailCropEditor();
        refreshThumbnailUiAfterMetadataChange();
        showStatusMessage(`Saved thumbnail settings for ${targetLabel}.`);
      }
    });
  });

  requestAnimationFrame(() => {
    try {
      overlay.focus();
    } catch {}
    try {
      (isVideoEditor ? rangeFrame : rangeZoom)?.focus();
    } catch {}
  });
  return true;
}

resetThumbnailRuntimeStateV3();
