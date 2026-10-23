/* Opening zoom
   A picture opened from the grid grows out of its card, and shrinks back into
   the card on the way out (Experimental -> Opening media). */

/* ===== Opening zoom ===== */

// The zoom is a layer of its own over the whole window: a black backdrop and
// a frame holding a copy of the picture. Nothing in the gallery moves; the
// layer does the moving, and the gallery changes underneath it where it
// cannot be seen.
//
// Opening: the frame starts exactly over the card's picture -- the same part
// of the picture the card shows, zoom and crop included -- and grows to where
// the viewer will show it, while the backdrop darkens over the grid. Only
// then is the key run and the viewer opened, underneath. The layer stays up
// until the viewer has really drawn the new file: the right file in its
// element (not the one left from the last time media was open), decoded, and
// -- with a filter on -- drawn through the filter (openedMediaIsPresented).
// Then the layer goes in one step, so what was a copy becomes the real thing
// with nothing in between.
//
// Closing: the frame starts over the picture as the viewer shows it, drawn
// from what is actually on screen (the filter's own output when a filter is
// on), the key is run at once so the grid comes back underneath, and the
// frame shrinks to the card it lands on while the backdrop clears.
//
// Only opening and closing animate; stepping between open files stays a hard
// cut. Any key pressed while the layer is up finishes it at once (running the
// opening's key first if it has not run yet), so the keyboard never waits.

const MEDIA_OPEN_ZOOM_CYCLE = Object.freeze([
  Object.freeze({ value: "zoom", label: "Zoom" }),
  Object.freeze({ value: "instant", label: "Instant" }),
]);
const MEDIA_OPEN_ZOOM_MS = 240;
const MEDIA_OPEN_ZOOM_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
// The longest the layer waits for the viewer before giving up and going.
const MEDIA_OPEN_ZOOM_PRESENT_TIMEOUT_MS = 2500;
let MEDIA_OPEN_ZOOM_ACTIVE = null;

function normalizeMediaOpenAnimationValue(value, fallback = "zoom") {
  const v = String(value || "").trim().toLowerCase();
  return v === "zoom" || v === "instant" ? v : fallback;
}

function mediaOpenAnimation() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return normalizeMediaOpenAnimationValue(opt && opt.mediaOpenAnimation);
}

function setAppMenuMediaOpenAnimation(value) {
  setOptionValue("mediaOpenAnimation", normalizeMediaOpenAnimationValue(value));
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(
    `Opening media: ${labelForCycleValue(MEDIA_OPEN_ZOOM_CYCLE, mediaOpenAnimation())}`,
  );
  return true;
}

function mediaOpenZoomEnabled() {
  if (mediaOpenAnimation() !== "zoom") return false;
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  } catch {}
  return true;
}

function previewMediaIsOpen() {
  const appEl = document.getElementById("app");
  return !!(appEl && appEl.classList.contains("preview-media-mode"));
}

function selectedPreviewGridCard() {
  const selectedKey = String(WS.view.previewSelectedKey || "");
  if (selectedKey) {
    const card = document.querySelector(
      `#previewPane [data-preview-item-key="${CSS.escape(selectedKey)}"]`,
    );
    if (card) return card;
  }
  return document.querySelector("#previewPane .previewSelected[data-preview-item-key]");
}

function mediaOpenZoomSize(el) {
  if (!el) return null;
  const tag = el.tagName;
  const w = tag === "VIDEO" ? el.videoWidth : tag === "CANVAS" ? el.width : el.naturalWidth;
  const h = tag === "VIDEO" ? el.videoHeight : tag === "CANVAS" ? el.height : el.naturalHeight;
  return w > 0 && h > 0 ? { w, h } : null;
}

function mediaOpenZoomDrawable(el) {
  if (!el || !el.isConnected) return false;
  if (el.tagName === "IMG") return el.complete && el.naturalWidth > 0;
  if (el.tagName === "VIDEO") return el.readyState >= 2 && el.videoWidth > 0;
  return false;
}

function rectOf(r) {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function containRect(box, size) {
  const scale = Math.min(box.width / size.w, box.height / size.h);
  const width = size.w * scale;
  const height = size.h * scale;
  return {
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width,
    height,
  };
}

function windowBox() {
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

// A card's picture: its square on screen, its corner, and which part of the
// picture that square shows (in the picture's own pixels). The part is read
// off where the <img> or <video> really sits -- a zoomed or moved thumbnail is
// larger than its square and offset -- with object-fit: cover inside its box.
function gridCardPicture(card) {
  if (!card) return null;
  const square =
    card.querySelector(":scope > .cardPicture") ||
    card.querySelector(".dirSquareMedia") ||
    card;
  const squareStyle = getComputedStyle(square);
  // Under "On picture" the folder's square draws no box; the card is it.
  const box = squareStyle.display === "contents" ? card : square;
  const squareRect = rectOf(box.getBoundingClientRect());
  if (squareRect.width < 4 || squareRect.height < 4) return null;
  const radius =
    parseFloat(getComputedStyle(box).borderTopLeftRadius) ||
    parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
  let media = null;
  for (const el of card.querySelectorAll("img, video")) {
    if (mediaOpenZoomDrawable(el) && el.getBoundingClientRect().width > 0) {
      media = el;
      break;
    }
  }
  if (!media) return { squareRect, radius, media: null };
  const size = mediaOpenZoomSize(media);
  const mediaBox = media.getBoundingClientRect();
  const scale = Math.max(mediaBox.width / size.w, mediaBox.height / size.h);
  const drawnLeft = mediaBox.left + (mediaBox.width - size.w * scale) / 2;
  const drawnTop = mediaBox.top + (mediaBox.height - size.h * scale) / 2;
  const part = {
    x: (squareRect.left - drawnLeft) / scale,
    y: (squareRect.top - drawnTop) / scale,
    w: squareRect.width / scale,
    h: squareRect.height / scale,
  };
  const filter = getComputedStyle(media).filter;
  return { squareRect, radius, media, size, part, filter: filter && filter !== "none" ? filter : "" };
}

// The whole picture at its own shape, at most `maxSide` pixels on its longer
// side.
function pictureCopy(el, maxSide = 2048) {
  const size = mediaOpenZoomSize(el);
  if (!size) return null;
  const scale = Math.min(1, maxSide / Math.max(size.w, size.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(size.w * scale));
  canvas.height = Math.max(1, Math.round(size.h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  return canvas;
}

// The open picture as it is on screen: where it sits, and a copy of exactly
// what is drawn there -- the filter's output when a filter is on.
function openMediaPicture() {
  const id = String(WS.preview?.fileId || "");
  const rec = id ? WS.fileById.get(id) : null;
  if (!rec || (rec.type !== "image" && rec.type !== "video")) return null;
  const viewport = document.getElementById("filePreviewViewport");
  if (!viewport || viewport.classList.contains("mediaZoomActive")) return null;
  const el = rec.type === "video" ? previewVideoEl : previewImgEl;
  if (!el || String(el.dataset.previewFileId || "") !== id) return null;
  const size = mediaOpenZoomSize(el);
  if (!size) return null;
  const box = rectOf(viewport.getBoundingClientRect());
  if (box.width < 4 || box.height < 4) return null;
  const rect = containRect(box, size);
  let copy = null;
  // The filter's canvas covers the whole viewport; rendered now, its buffer
  // is good for this task, so cut the picture's rectangle out of it.
  const live =
    typeof targetRequiresMediaProcessingPipeline === "function" &&
    targetRequiresMediaProcessingPipeline(rec)
      ? MediaFilterEngine.renderSurfaceNow("preview")
      : null;
  if (live && live.width > 0 && live.height > 0) {
    const sx = live.width / box.width;
    const sy = live.height / box.height;
    copy = document.createElement("canvas");
    copy.width = Math.max(1, Math.round(rect.width * sx));
    copy.height = Math.max(1, Math.round(rect.height * sy));
    try {
      copy
        .getContext("2d")
        .drawImage(
          live,
          (rect.left - box.left) * sx,
          (rect.top - box.top) * sy,
          rect.width * sx,
          rect.height * sy,
          0,
          0,
          copy.width,
          copy.height,
        );
    } catch {
      copy = null;
    }
  }
  if (!copy) {
    if (!mediaOpenZoomDrawable(el)) return null;
    copy = pictureCopy(el, Math.max(rect.width, rect.height) * 2);
    if (copy) {
      const filter = getComputedStyle(el).filter;
      if (filter && filter !== "none") copy.style.filter = filter;
    }
  }
  return copy ? { rect, copy } : null;
}

// Has the viewer drawn the file now open -- the right one, ready, and through
// the filter if there is one?
function openedMediaIsPresented() {
  if (!previewMediaIsOpen()) return false;
  const id = String(WS.preview?.fileId || "");
  const rec = id ? WS.fileById.get(id) : null;
  if (!rec) return false;
  if (rec.type !== "image" && rec.type !== "video") return true;
  const el = rec.type === "video" ? previewVideoEl : previewImgEl;
  if (!el || String(el.dataset.previewFileId || "") !== id) return false;
  if (rec.type === "video" ? el.readyState < 2 : !(el.complete && el.naturalWidth > 0)) {
    return false;
  }
  if (
    typeof targetRequiresMediaProcessingPipeline === "function" &&
    targetRequiresMediaProcessingPipeline(rec)
  ) {
    return MediaFilterEngine.isShowingTarget("preview", rec);
  }
  return !el.classList.contains("mediaHidden");
}

// Would the enter key on the selected grid card open media? A file does; a
// folder does when quick navigation would dive into it (navigateToDirectory).
function mediaOpenZoomPredictsOpen(card) {
  const itemKey = String(card?.getAttribute("data-preview-item-key") || "");
  if (itemKey.startsWith("file:")) {
    const rec = WS.fileById.get(itemKey.slice(5));
    return !!rec && (rec.type === "image" || rec.type === "video");
  }
  if (!itemKey.startsWith("dir:")) return false;
  const node = WS.dirByPath && WS.dirByPath.get(itemKey.slice(4));
  return !!(
    node &&
    quickNavigationEnabled() &&
    node !== WS.root &&
    !node._skipTagFilters &&
    dirNodeIsMediaOnlyForQuickNavigation(node)
  );
}

// The file a card's picture is of: a file card's own, or the record a folder
// card's thumbnail was drawn from.
function gridCardPictureFileId(card, media) {
  const itemKey = String(card?.getAttribute("data-preview-item-key") || "");
  if (itemKey.startsWith("file:")) return itemKey.slice(5);
  return String(media?.getAttribute("data-dir-preview-id") || "");
}

// The file the enter key on this card will open: the file itself, or the
// first file quick navigation's dive lands on.
function gridCardOpensFileId(card) {
  const itemKey = String(card?.getAttribute("data-preview-item-key") || "");
  if (itemKey.startsWith("file:")) return itemKey.slice(5);
  const node = itemKey.startsWith("dir:") && WS.dirByPath ? WS.dirByPath.get(itemKey.slice(4)) : null;
  if (!node || typeof getPreviewFileIdsForDir !== "function") return "";
  return String(getPreviewFileIdsForDir(node)[0] || "");
}

// The layer: backdrop, and a frame that clips the picture's copy.
function buildMediaOpenZoomLayer(copy) {
  const layer = document.createElement("div");
  layer.className = "mediaOpenZoom";
  layer.setAttribute("aria-hidden", "true");
  const backdrop = document.createElement("div");
  backdrop.className = "mediaOpenZoomBackdrop";
  const frame = document.createElement("div");
  frame.className = "mediaOpenZoomFrame";
  copy.classList.add("mediaOpenZoomPicture");
  frame.appendChild(copy);
  layer.append(backdrop, frame);
  return { layer, backdrop, frame, copy };
}

// Where the frame and the picture inside it sit for a square showing `part`
// of a picture of `size`, the copy being the whole picture.
function placementForPart(squareRect, radius, size, part) {
  const scale = squareRect.width / part.w;
  return {
    frame: { ...squareRect, radius },
    picture: {
      left: -part.x * scale,
      top: -part.y * scale,
      width: size.w * scale,
      height: size.h * scale,
    },
  };
}

function placementForWhole(rect) {
  return {
    frame: { ...rect, radius: 0 },
    picture: { left: 0, top: 0, width: rect.width, height: rect.height },
  };
}

// The middle of a square, as a card shows a picture with no crop.
function centredPart(squareRect, size) {
  const scale = Math.max(squareRect.width / size.w, squareRect.height / size.h);
  const w = squareRect.width / scale;
  const h = squareRect.height / scale;
  return { x: (size.w - w) / 2, y: (size.h - h) / 2, w, h };
}

function frameKeyframe(p) {
  return {
    left: `${p.frame.left}px`,
    top: `${p.frame.top}px`,
    width: `${p.frame.width}px`,
    height: `${p.frame.height}px`,
    borderRadius: `${p.frame.radius}px`,
  };
}

function pictureKeyframe(p) {
  return {
    left: `${p.picture.left}px`,
    top: `${p.picture.top}px`,
    width: `${p.picture.width}px`,
    height: `${p.picture.height}px`,
  };
}

function placeMediaOpenZoom(parts, p) {
  Object.assign(parts.frame.style, frameKeyframe(p));
  Object.assign(parts.copy.style, pictureKeyframe(p));
}

function animateMediaOpenZoom(parts, from, to, backdropFrom, backdropTo) {
  const timing = { duration: MEDIA_OPEN_ZOOM_MS, easing: MEDIA_OPEN_ZOOM_EASE, fill: "forwards" };
  placeMediaOpenZoom(parts, to);
  parts.backdrop.style.opacity = String(backdropTo);
  return [
    parts.frame.animate([frameKeyframe(from), frameKeyframe(to)], timing),
    parts.copy.animate([pictureKeyframe(from), pictureKeyframe(to)], timing),
    parts.backdrop.animate([{ opacity: backdropFrom }, { opacity: backdropTo }], timing),
  ];
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function endMediaOpenZoom(zoom) {
  if (!zoom || zoom.ended) return;
  zoom.ended = true;
  for (const a of zoom.animations || []) {
    try { a.cancel(); } catch {}
  }
  zoom.parts.layer.remove();
  if (MEDIA_OPEN_ZOOM_ACTIVE === zoom) MEDIA_OPEN_ZOOM_ACTIVE = null;
}

// A key while the layer is up: do at once what was left to do, and go.
function finishMediaOpenZoomNow() {
  const zoom = MEDIA_OPEN_ZOOM_ACTIVE;
  if (!zoom) return;
  if (!zoom.ran) {
    zoom.ran = true;
    zoom.run();
  }
  endMediaOpenZoom(zoom);
}

function startMediaOpen(card, run) {
  const from = gridCardPicture(card);
  if (!from || !from.media) return false;
  // Only a card showing the very file that opens can grow into it. A Set
  // whose thumbnail is some other file of it (or a Model's, or a pinned
  // pick) would hold the wrong picture on screen while the viewer loads, so
  // it opens without the zoom.
  const shownId = gridCardPictureFileId(card, from.media);
  if (!shownId || shownId !== gridCardOpensFileId(card)) return false;
  const copy = pictureCopy(from.media);
  if (!copy) return false;
  if (from.filter) copy.style.filter = from.filter;
  const size = { w: copy.width, h: copy.height };
  const scaleToCopy = copy.width / from.size.w;
  const part = {
    x: from.part.x * scaleToCopy,
    y: from.part.y * scaleToCopy,
    w: from.part.w * scaleToCopy,
    h: from.part.h * scaleToCopy,
  };
  const parts = buildMediaOpenZoomLayer(copy);
  const start = placementForPart(from.squareRect, from.radius, size, part);
  const end = placementForWhole(containRect(windowBox(), size));
  placeMediaOpenZoom(parts, start);
  parts.backdrop.style.opacity = "0";
  document.body.appendChild(parts.layer);
  const zoom = { parts, ran: false, ended: false, run, animations: [] };
  MEDIA_OPEN_ZOOM_ACTIVE = zoom;
  zoom.animations = animateMediaOpenZoom(parts, start, end, 0, 1);
  zoom.animations[0].finished
    .then(async () => {
      if (zoom.ended) return;
      zoom.ran = true;
      run();
      // If what opened is not the file the copy shows after all, the copy
      // must not stand in for it: go at once.
      if (previewMediaIsOpen() && String(WS.preview?.fileId || "") !== shownId) {
        endMediaOpenZoom(zoom);
        return;
      }
      const t0 = performance.now();
      // Opening a folder can wait on loading it; then the viewer has to load,
      // decode and (with a filter) draw the file.
      while (!zoom.ended && performance.now() - t0 < MEDIA_OPEN_ZOOM_PRESENT_TIMEOUT_MS) {
        if (previewMediaIsOpen() && String(WS.preview?.fileId || "") !== shownId) break;
        if (openedMediaIsPresented()) break;
        if (performance.now() - t0 > 600 && !previewMediaIsOpen()) break;
        await nextFrame();
      }
      // One more frame so the viewer's picture has been composited.
      await nextFrame();
      endMediaOpenZoom(zoom);
    })
    .catch(() => endMediaOpenZoom(zoom));
  return true;
}

function startMediaClose(run) {
  const from = openMediaPicture();
  if (!from) return false;
  const { copy } = from;
  const size = { w: copy.width, h: copy.height };
  const parts = buildMediaOpenZoomLayer(copy);
  const start = placementForWhole(from.rect);
  placeMediaOpenZoom(parts, start);
  parts.backdrop.style.opacity = "1";
  document.body.appendChild(parts.layer);
  const zoom = { parts, ran: true, ended: false, run, animations: [] };
  MEDIA_OPEN_ZOOM_ACTIVE = zoom;
  run();
  (async () => {
    // The grid draws its cards over the next frames and scrolls the one you
    // land on into view: wait until that card's square stops moving.
    let target = null;
    let last = "";
    const t0 = performance.now();
    while (!zoom.ended && performance.now() - t0 < 400) {
      await nextFrame();
      if (previewMediaIsOpen()) continue;
      const pic = gridCardPicture(selectedPreviewGridCard());
      if (!pic) continue;
      const key = [pic.squareRect.left, pic.squareRect.top, pic.squareRect.width].map(Math.round).join(",");
      target = pic;
      if (key === last) break;
      last = key;
    }
    if (zoom.ended) return;
    if (!target || previewMediaIsOpen()) {
      zoom.animations = [
        parts.layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: "forwards" }),
      ];
    } else {
      let part;
      if (target.media && target.size) {
        const k = size.w / target.size.w;
        part = { x: target.part.x * k, y: target.part.y * k, w: target.part.w * k, h: target.part.h * k };
      } else {
        part = centredPart(target.squareRect, size);
      }
      zoom.animations = animateMediaOpenZoom(
        parts,
        start,
        placementForPart(target.squareRect, target.radius, size, part),
        1,
        0,
      );
    }
    zoom.animations[0].finished
      .then(() => endMediaOpenZoom(zoom))
      .catch(() => endMediaOpenZoom(zoom));
  })();
  return true;
}

// Called by the gallery's keydown listener before it handles a key. Answers
// true when it has taken the key: then `run(e)` is called by the zoom (for an
// opening, once the picture has grown) and the listener does nothing now.
function mediaOpenZoomTakesKey(e, run) {
  // A key while the layer is up finishes it before anything else happens.
  if (MEDIA_OPEN_ZOOM_ACTIVE) finishMediaOpenZoomNow();
  if (!mediaOpenZoomEnabled() || !WS.root) return false;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
  // The same test the listener makes: a key the app reserved is still ours.
  if (e.defaultPrevented && !RESERVED_APP_KEYBIND_EVENTS.has(e)) return false;
  if (isTextInputTarget(e.target) || variationsIsOpen() || BANIC_ACTIVE) return false;
  if (typeof lockScreenIsOpen === "function" && lockScreenIsOpen()) return false;
  const key = keybindValueFromEvent(e);
  if (!key) return false;
  const action = keybindActionFor(key);
  const runKey = () => run(e);
  let taken = false;
  if (previewMediaIsOpen()) {
    if (key === "Escape" || action === "back" || action === "leaveDir") {
      taken = startMediaClose(runKey);
    }
  } else if (action === "enterDir") {
    const card = selectedPreviewGridCard();
    if (mediaOpenZoomPredictsOpen(card)) taken = startMediaOpen(card, runKey);
  }
  if (!taken) return false;
  // Kept from the browser, and marked as the app's own so the listener still
  // takes it when the zoom runs it.
  RESERVED_APP_KEYBIND_EVENTS.add(e);
  e.preventDefault();
  return true;
}
