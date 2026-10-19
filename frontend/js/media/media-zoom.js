/* Cursor zoom
   Cursor zoom on open media. */

/* =========================================================
   Cursor zoom on open media (mouse and trackpad only)
   =========================================================
   This sits ON TOP OF the keyboard model rather than inside it. There is
   deliberately no keybind, no menu entry and no stored option: nothing else in
   the app has to know it exists, and everything the app can do is still
   reachable without ever touching the cursor. Zoom is a transient view of the
   item currently open -- changing media drops it (syncMediaZoomForCurrentTarget
   below), and it is never persisted.

   Two gesture dialects, chosen by whichever one STARTED the zoom rather than by
   sniffing the hardware -- a wheel event cannot reliably be told apart from a
   two-finger scroll, and guessing wrong is worse than asking the gesture:

     - started with a plain wheel  -> a plain wheel keeps zooming, and panning
       is a drag. That is a mouse.
     - started with a pinch (a wheel event carrying ctrlKey, which is what a
       trackpad pinch reports) -> a plain wheel pans in any direction, because a
       trackpad user's next gesture is a two-finger scroll, not a drag.

   MEDIA_ZOOM.mode holds that choice and is sticky until the media changes:
   pinching back out to fit does NOT hand a trackpad user back to the mouse
   dialect, which would make an idle two-finger scroll zoom in on them.

   The transform is written as three custom properties on the viewport, so the
   stylesheet (#mediaZoomStyles) decides which layers wear it. Panning is
   clamped against the picture's own letterboxed rect, not the element box, so
   the media can never be pushed off into the surrounding black. */

const MEDIA_ZOOM_MIN_SCALE = 1;
const MEDIA_ZOOM_MAX_SCALE = 10;
const MEDIA_ZOOM_WHEEL_RATE = 0.004;
const MEDIA_ZOOM_PINCH_RATE = 0.018;
const MEDIA_ZOOM_LINE_PX = 16;
// Budgets for the filter canvas while it is zoomed (see mediaZoomRenderBoost).
// Playing video redraws every frame, so it gets the smaller one.
const MEDIA_ZOOM_RENDER_MAX_PIXELS = 32000000;
const MEDIA_ZOOM_RENDER_MAX_PIXELS_VIDEO = 12000000;

const MEDIA_ZOOM = {
  container: null,
  key: "",
  scale: 1,
  appliedScale: 1,
  tx: 0,
  ty: 0,
  mode: "wheel",
  drag: null,
};

function mediaZoomShownMediaEl(el) {
  if (!el || !el.isConnected) return null;
  if (el.style && el.style.display === "none") return null;
  return el;
}

/* The viewport currently showing a single open file, plus the raw media element
   inside it -- the element is what carries the intrinsic size the pan clamp
   needs. Returns null for a folder card, the grid, or an empty preview. */
function mediaZoomSurface() {
  if (VIEWER_MODE) {
    if (!viewport || !viewport.isConnected) return null;
    const media =
      mediaZoomShownMediaEl(viewerImgEl) || mediaZoomShownMediaEl(viewerVideoEl);
    return media && media.parentElement === viewport
      ? { container: viewport, media }
      : null;
  }
  if (!previewViewportBox || !previewViewportBox.isConnected) return null;
  const media =
    mediaZoomShownMediaEl(previewImgEl) || mediaZoomShownMediaEl(previewVideoEl);
  return media && media.parentElement === previewViewportBox
    ? { container: previewViewportBox, media }
    : null;
}

function mediaZoomTargetKey() {
  const item = Array.isArray(viewerItems) ? viewerItems[viewerIndex] : null;
  const id = item && !item.isFolder ? String(item.id || "") : "";
  return `${VIEWER_MODE ? "viewer" : "preview"}:${id}`;
}

/* Tall/wide scroll (an extreme-aspect image) already owns the wheel in that
   viewport, and the image is deliberately laid out larger than the box there.
   Leave it alone. */
function mediaZoomScrollModeActive(container) {
  return !!(
    container &&
    container.classList &&
    (container.classList.contains("tallScrollMode") ||
      container.classList.contains("wideScrollMode"))
  );
}

function clearMediaZoomOnContainer(container) {
  if (!container || !container.classList) return;
  container.classList.remove("mediaZoomActive");
  container.classList.remove("mediaZoomPanning");
  if (!container.style) return;
  container.style.removeProperty("--media-zoom-scale");
  container.style.removeProperty("--media-zoom-x");
  container.style.removeProperty("--media-zoom-y");
}

function resetMediaZoomState() {
  const prev = MEDIA_ZOOM.container;
  const wasZoomed = MEDIA_ZOOM.scale > 1;
  MEDIA_ZOOM.drag = null;
  MEDIA_ZOOM.container = null;
  MEDIA_ZOOM.appliedScale = 1;
  MEDIA_ZOOM.scale = 1;
  MEDIA_ZOOM.tx = 0;
  MEDIA_ZOOM.ty = 0;
  MEDIA_ZOOM.mode = "wheel";
  clearMediaZoomOnContainer(prev);
  if (wasZoomed) requestMediaZoomFilterRedraw();
}

function resetMediaZoom() {
  resetMediaZoomState();
  MEDIA_ZOOM.key = "";
}

function applyMediaZoom(container) {
  if (!container) return;
  if (!(MEDIA_ZOOM.scale > MEDIA_ZOOM_MIN_SCALE + 0.0001)) {
    const wasZoomed = MEDIA_ZOOM.appliedScale > 1;
    MEDIA_ZOOM.scale = 1;
    MEDIA_ZOOM.appliedScale = 1;
    MEDIA_ZOOM.tx = 0;
    MEDIA_ZOOM.ty = 0;
    MEDIA_ZOOM.container = null;
    clearMediaZoomOnContainer(container);
    if (wasZoomed) requestMediaZoomFilterRedraw();
    return;
  }
  const scaleChanged = MEDIA_ZOOM.scale !== MEDIA_ZOOM.appliedScale;
  MEDIA_ZOOM.container = container;
  MEDIA_ZOOM.appliedScale = MEDIA_ZOOM.scale;
  container.classList.add("mediaZoomActive");
  container.style.setProperty("--media-zoom-scale", String(MEDIA_ZOOM.scale));
  container.style.setProperty("--media-zoom-x", `${Math.round(MEDIA_ZOOM.tx)}px`);
  container.style.setProperty("--media-zoom-y", `${Math.round(MEDIA_ZOOM.ty)}px`);
  // A new scale may put the filter canvas in a different resolution step, and
  // nothing else would ask it to redraw on a still.
  if (scaleChanged) requestMediaZoomFilterRedraw();
}

function requestMediaZoomFilterRedraw() {
  try {
    if (
      typeof MediaFilterEngine !== "undefined" &&
      MediaFilterEngine &&
      typeof MediaFilterEngine.requestRender === "function"
    )
      MediaFilterEngine.requestRender();
  } catch {}
}

/* The media is object-fit: contain inside a full-size box, so the picture is a
   letterboxed rect in the middle of the viewport. Pan is bounded by that rect
   at the current scale, which is what stops a portrait image from being dragged
   sideways into empty black. */
function clampMediaZoomPan(container, media) {
  if (!container) return;
  const vw = Math.max(1, Number(container.clientWidth) || 0);
  const vh = Math.max(1, Number(container.clientHeight) || 0);
  let nw = 0;
  let nh = 0;
  if (media && String(media.tagName || "").toLowerCase() === "video") {
    nw = Number(media.videoWidth) || 0;
    nh = Number(media.videoHeight) || 0;
  } else if (media) {
    nw = Number(media.naturalWidth) || 0;
    nh = Number(media.naturalHeight) || 0;
  }
  let cw = vw;
  let ch = vh;
  if (nw > 0 && nh > 0) {
    const fit = Math.min(vw / nw, vh / nh);
    cw = nw * fit;
    ch = nh * fit;
  }
  const maxX = Math.max(0, (cw * MEDIA_ZOOM.scale - vw) / 2);
  const maxY = Math.max(0, (ch * MEDIA_ZOOM.scale - vh) / 2);
  MEDIA_ZOOM.tx = Math.max(-maxX, Math.min(maxX, MEDIA_ZOOM.tx));
  MEDIA_ZOOM.ty = Math.max(-maxY, Math.min(maxY, MEDIA_ZOOM.ty));
}

/* Called from both single-file render paths once the index they are drawing is
   settled. A different item -- or no open item at all -- drops the zoom; the
   same item re-rendered (a filter change, a refresh) keeps it, only re-clamped
   in case the viewport resized. */
function syncMediaZoomForCurrentTarget() {
  const surf = mediaZoomSurface();
  if (!surf) {
    resetMediaZoom();
    return;
  }
  bindMediaZoomContainer(surf.container);
  const key = mediaZoomTargetKey();
  const moved =
    key !== MEDIA_ZOOM.key ||
    (MEDIA_ZOOM.container && MEDIA_ZOOM.container !== surf.container);
  if (moved) resetMediaZoomState();
  MEDIA_ZOOM.key = key;
  if (MEDIA_ZOOM.scale > 1) {
    clampMediaZoomPan(surf.container, surf.media);
    applyMediaZoom(surf.container);
  }
}

/* How much extra resolution the WebGL filter canvas in `container` should be
   rendered at, given that the cursor zoom is scaling it up with CSS. Called
   from MediaFilterEngine's draw path; returns 1 whenever nothing is zoomed, so
   the unzoomed cost is exactly what it was.

   Three bounds, in order:
     - the zoom itself, rounded UP to a power of two, so a continuous zoom
       resizes the canvas about four times across its whole range instead of
       on every wheel tick (each resize also restages the still's texture).
     - what the source actually holds. `renderDpr` already resolves a large
       still up to the pipeline's own pixel budget, so the headroom asked for
       here is only what that budget had to leave on the table; past native
       resolution there is nothing left to recover and the boost is 1.
     - a pixel budget of its own, since the canvas covers the whole viewport
       at every scale -- the zoomed-out part of it is rendered and clipped. */
function mediaZoomRenderBoost(
  container,
  rect,
  srcW,
  srcH,
  baseDpr,
  isVideoPlaying,
) {
  if (!container || MEDIA_ZOOM.container !== container) return 1;
  const zoom = Number(MEDIA_ZOOM.scale) || 1;
  if (!(zoom > 1.0001)) return 1;
  const dpr = Math.max(0.5, Number(baseDpr) || 1);
  const destW = Math.max(1, Number(rect && rect.w) || 1) * dpr;
  const destH = Math.max(1, Number(rect && rect.h) || 1) * dpr;
  const headroom = Math.min(
    Math.max(1, Number(srcW) || 1) / destW,
    Math.max(1, Number(srcH) || 1) / destH,
  );
  if (!(headroom > 1.0001)) return 1;
  const stepped = Math.pow(2, Math.ceil(Math.log2(zoom)));
  let boost = Math.min(stepped, headroom);
  const cw = Math.max(1, Number(container.clientWidth) || 1);
  const ch = Math.max(1, Number(container.clientHeight) || 1);
  const budget = isVideoPlaying
    ? MEDIA_ZOOM_RENDER_MAX_PIXELS_VIDEO
    : MEDIA_ZOOM_RENDER_MAX_PIXELS;
  boost *= capScaleForPixelBudget(cw * dpr * boost, ch * dpr * boost, budget);
  return Math.max(1, boost);
}

function bindMediaZoomContainer(container) {
  if (!container || !container.dataset) return;
  if (container.dataset.mediaZoomBound === "1") return;
  container.dataset.mediaZoomBound = "1";
  container.addEventListener("wheel", onMediaZoomWheel, { passive: false });
  container.addEventListener("pointerdown", onMediaZoomPointerDown);
  container.addEventListener("pointermove", onMediaZoomPointerMove);
  container.addEventListener("pointerup", onMediaZoomPointerEnd);
  container.addEventListener("pointercancel", onMediaZoomPointerEnd);
  container.addEventListener("lostpointercapture", onMediaZoomPointerEnd);
  container.addEventListener("dragstart", (e) => {
    if (MEDIA_ZOOM.container === container) e.preventDefault();
  });
}

function onMediaZoomWheel(e) {
  const surf = mediaZoomSurface();
  if (!surf || surf.container !== e.currentTarget) return;
  if (mediaZoomScrollModeActive(surf.container)) return;
  const container = surf.container;
  const px = e.deltaMode === 1 ? MEDIA_ZOOM_LINE_PX : 1;
  const dx = (Number(e.deltaX) || 0) * px;
  const dy = (Number(e.deltaY) || 0) * px;
  const pinch = !!e.ctrlKey;
  if (pinch) MEDIA_ZOOM.mode = "pinch";

  if (!pinch && MEDIA_ZOOM.mode === "pinch") {
    // Trackpad dialect: a two-finger scroll pans. At fit there is nothing to
    // pan, so the event is left alone rather than swallowed.
    if (!(MEDIA_ZOOM.scale > 1)) return;
    if (!dx && !dy) return;
    MEDIA_ZOOM.tx -= dx;
    MEDIA_ZOOM.ty -= dy;
    clampMediaZoomPan(container, surf.media);
    applyMediaZoom(container);
    e.preventDefault();
    return;
  }

  if (!dy) return;
  const prev = MEDIA_ZOOM.scale;
  const rate = pinch ? MEDIA_ZOOM_PINCH_RATE : MEDIA_ZOOM_WHEEL_RATE;
  const next = Math.max(
    MEDIA_ZOOM_MIN_SCALE,
    Math.min(MEDIA_ZOOM_MAX_SCALE, prev * Math.exp(-dy * rate)),
  );
  if (Math.abs(next - prev) < 0.00001) {
    // Already at fit and being scrolled further out: nothing to do, and nothing
    // else in a single-file view wants the wheel, so let it pass.
    if (prev > 1) e.preventDefault();
    return;
  }
  // Pin the point under the cursor while the scale changes, so zooming walks
  // into what you are pointing at instead of the middle of the picture.
  const rect = container.getBoundingClientRect();
  const cx = (Number(e.clientX) || 0) - (rect.left + rect.width / 2);
  const cy = (Number(e.clientY) || 0) - (rect.top + rect.height / 2);
  const ratio = next / prev;
  MEDIA_ZOOM.tx = cx - (cx - MEDIA_ZOOM.tx) * ratio;
  MEDIA_ZOOM.ty = cy - (cy - MEDIA_ZOOM.ty) * ratio;
  MEDIA_ZOOM.scale = next;
  clampMediaZoomPan(container, surf.media);
  applyMediaZoom(container);
  e.preventDefault();
}

function onMediaZoomPointerDown(e) {
  if (MEDIA_ZOOM.drag) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (!(MEDIA_ZOOM.scale > 1)) return;
  const surf = mediaZoomSurface();
  if (!surf || surf.container !== e.currentTarget) return;
  if (mediaZoomScrollModeActive(surf.container)) return;
  MEDIA_ZOOM.drag = {
    id: e.pointerId,
    x: Number(e.clientX) || 0,
    y: Number(e.clientY) || 0,
  };
  surf.container.classList.add("mediaZoomPanning");
  try {
    surf.container.setPointerCapture(e.pointerId);
  } catch {}
  e.preventDefault();
}

function onMediaZoomPointerMove(e) {
  const drag = MEDIA_ZOOM.drag;
  if (!drag || e.pointerId !== drag.id) return;
  const surf = mediaZoomSurface();
  if (!surf) {
    onMediaZoomPointerEnd(e);
    return;
  }
  const x = Number(e.clientX) || 0;
  const y = Number(e.clientY) || 0;
  MEDIA_ZOOM.tx += x - drag.x;
  MEDIA_ZOOM.ty += y - drag.y;
  drag.x = x;
  drag.y = y;
  clampMediaZoomPan(surf.container, surf.media);
  applyMediaZoom(surf.container);
  e.preventDefault();
}

function onMediaZoomPointerEnd(e) {
  const drag = MEDIA_ZOOM.drag;
  if (!drag) return;
  if (e && e.pointerId != null && e.pointerId !== drag.id) return;
  MEDIA_ZOOM.drag = null;
  const container =
    (e && e.currentTarget) || MEDIA_ZOOM.container || previewViewportBox;
  if (container && container.classList) {
    try {
      container.releasePointerCapture(drag.id);
    } catch {}
    container.classList.remove("mediaZoomPanning");
  }
}
