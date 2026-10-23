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
// A Set's card often shows a picture picked for the card, not the file that
// opens first. How the zoom bridges the two is Experimental -> Thumbnail isn't
// the first file (`mediaOpenZoomMismatch`), to try them side by side:
//   Morph          the card's picture grows and dissolves into the first file
//                  as it goes, the frame taking the first file's shape;
//   First file     the first file grows out of the card's square from the
//                  start (it is fetched first, so the zoom can begin a moment
//                  later; if it cannot be had in time, the card's picture is
//                  used);
//   Switch at end  the card's picture grows, then dissolves into the first
//                  file once it is full size;
//   Don't zoom     the Set opens at once, as with Opening media on Instant.
// The first file is drawn from the same thumbnail the grid uses
// (`requestThumb`), so it is usually there already.
//
// Only opening and closing animate; stepping between open files stays a hard
// cut. Any key pressed while the layer is up finishes it at once (running the
// opening's key first if it has not run yet), so the keyboard never waits.

const MEDIA_OPEN_ZOOM_CYCLE = Object.freeze([
  Object.freeze({ value: "zoom", label: "Zoom" }),
  Object.freeze({ value: "instant", label: "Instant" }),
]);
const MEDIA_OPEN_ZOOM_MISMATCH_CYCLE = Object.freeze([
  Object.freeze({ value: "morph", label: "Morph" }),
  Object.freeze({ value: "first", label: "First file" }),
  Object.freeze({ value: "switch", label: "Switch at end" }),
  Object.freeze({ value: "none", label: "Don't zoom" }),
]);
// How long "First file" waits for the first file's picture before it gives
// up and grows the card's picture instead.
const MEDIA_OPEN_ZOOM_FIRST_WAIT_MS = 220;
const MEDIA_OPEN_ZOOM_FADE_MS = 140;
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

function normalizeMediaOpenZoomMismatchValue(value, fallback = "morph") {
  const v = String(value || "").trim().toLowerCase();
  return MEDIA_OPEN_ZOOM_MISMATCH_CYCLE.some((c) => c.value === v) ? v : fallback;
}

function mediaOpenZoomMismatch() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return normalizeMediaOpenZoomMismatchValue(opt && opt.mediaOpenZoomMismatch);
}

function setAppMenuMediaOpenZoomMismatch(value) {
  setOptionValue("mediaOpenZoomMismatch", normalizeMediaOpenZoomMismatchValue(value));
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(
    `Thumbnail isn't the first file: ${labelForCycleValue(MEDIA_OPEN_ZOOM_MISMATCH_CYCLE, mediaOpenZoomMismatch())}`,
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

// The file that opens, as the grid's own thumbnail of it: a canvas copy,
// with the grid's colour filter, or null if it cannot be had within
// `timeoutMs`.
async function firstFilePictureCopy(rec, timeoutMs) {
  const path = rec && typeof nativePathForRecord === "function" ? nativePathForRecord(rec) : "";
  if (!path || !window.__lg || typeof window.__lg.requestThumb !== "function") return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const fetch = (async () => {
    const edge = fullResThumbnailsEnabled() ? FULL_QUALITY_THUMB_EDGE : TAURI_THUMB_EDGE;
    const frameTime = rec.type === "video" ? metaGetVideoThumbnailTimeForRecord(rec) : null;
    const ftKey = Number.isFinite(frameTime) ? Math.round(frameTime * 1000) : "d";
    const key = `${path}::${edge}::${ftKey}`;
    let url = TAURI_THUMB_INDEX.get(key);
    if (!url) {
      url = await window.__lg.requestThumb(path, edge, frameTime);
      if (url) rememberTauriThumb(key, url);
    }
    if (!url) return null;
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  })().catch(() => null);
  const img = await Promise.race([fetch, timeout]);
  if (!img || !img.naturalWidth) return null;
  const copy = pictureCopy(img);
  if (!copy) return null;
  const filter =
    typeof getCurrentColorFilterCssForTarget === "function" ? getCurrentColorFilterCssForTarget(rec) : "";
  if (filter) copy.style.filter = filter;
  return copy;
}

// A picture's shape before it has loaded, from what the library knows of it.
function recordShape(rec, fallback) {
  const aspect = rec && typeof getPreviewAspectForRecord === "function" ? getPreviewAspectForRecord(rec) : 0;
  return aspect > 0 ? { w: aspect * 1000, h: 1000 } : fallback;
}

function addZoomPicture(parts, copy) {
  copy.classList.add("mediaOpenZoomPicture");
  parts.frame.appendChild(copy);
  return copy;
}

function animatePicture(copy, from, to, timing) {
  Object.assign(copy.style, pictureKeyframe(to));
  return copy.animate([pictureKeyframe(from), pictureKeyframe(to)], timing);
}

function fadePicture(copy, fromOpacity, toOpacity, timing) {
  copy.style.opacity = String(toOpacity);
  return copy.animate([{ opacity: fromOpacity }, { opacity: toOpacity }], timing);
}

// The open, once the picture has grown: run the key, then hold the layer
// until the viewer has drawn the file that opened.
async function finishMediaOpenAfterGrow(zoom, opensId) {
  if (zoom.ended) return;
  zoom.ran = true;
  zoom.run();
  const t0 = performance.now();
  // Opening a folder can wait on loading it; then the viewer has to load,
  // decode and (with a filter) draw the file.
  while (!zoom.ended && performance.now() - t0 < MEDIA_OPEN_ZOOM_PRESENT_TIMEOUT_MS) {
    // Something else opened after all: the layer must not stand in for it.
    if (previewMediaIsOpen() && String(WS.preview?.fileId || "") !== opensId) break;
    if (openedMediaIsPresented()) break;
    if (performance.now() - t0 > 600 && !previewMediaIsOpen()) break;
    await nextFrame();
  }
  // One more frame so the viewer's picture has been composited.
  await nextFrame();
  endMediaOpenZoom(zoom);
}

function startMediaOpen(card, run) {
  const from = gridCardPicture(card);
  if (!from || !from.media) return false;
  const shownId = gridCardPictureFileId(card, from.media);
  const opensId = gridCardOpensFileId(card);
  if (!shownId || !opensId) return false;
  const differs = shownId !== opensId;
  const style = differs ? mediaOpenZoomMismatch() : "same";
  if (style === "none") return false;
  const opensRec = WS.fileById.get(opensId);
  if (!opensRec || (opensRec.type !== "image" && opensRec.type !== "video")) return false;
  const cardCopy = pictureCopy(from.media);
  if (!cardCopy) return false;
  if (from.filter) cardCopy.style.filter = from.filter;
  const cardSize = { w: cardCopy.width, h: cardCopy.height };
  const k = cardCopy.width / from.size.w;
  const cardPart = { x: from.part.x * k, y: from.part.y * k, w: from.part.w * k, h: from.part.h * k };
  const square = from.squareRect;
  const radius = from.radius;

  const layer = buildMediaOpenZoomLayer(document.createElement("canvas"));
  layer.copy.remove();
  const parts = { layer: layer.layer, backdrop: layer.backdrop, frame: layer.frame };
  Object.assign(parts.frame.style, frameKeyframe({ frame: { ...square, radius } }));
  parts.backdrop.style.opacity = "0";
  document.body.appendChild(parts.layer);
  const zoom = { parts, ran: false, ended: false, run, animations: [] };
  MEDIA_OPEN_ZOOM_ACTIVE = zoom;
  const timing = { duration: MEDIA_OPEN_ZOOM_MS, easing: MEDIA_OPEN_ZOOM_EASE, fill: "forwards" };

  // Grow the frame from the square to `endRect`, the backdrop with it, and
  // each picture from its start placement to its end placement.
  const grow = (endRect, pictures) => {
    const frameFrom = { frame: { ...square, radius } };
    const frameTo = { frame: { ...endRect, radius: 0 } };
    Object.assign(parts.frame.style, frameKeyframe(frameTo));
    parts.backdrop.style.opacity = "1";
    const list = [
      parts.frame.animate([frameKeyframe(frameFrom), frameKeyframe(frameTo)], timing),
      parts.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], timing),
    ];
    for (const p of pictures) list.push(animatePicture(p.copy, p.from, p.to, timing));
    zoom.animations.push(...list);
    return list[0].finished;
  };
  // Where a picture sits to cover a rectangle from its middle.
  const covering = (rect, size) => placementForPart(rect, 0, size, centredPart(rect, size));
  const cardStart = placementForPart(square, radius, cardSize, cardPart);

  if (!differs) {
    addZoomPicture(parts, cardCopy);
    Object.assign(cardCopy.style, pictureKeyframe(cardStart));
    const endRect = containRect(windowBox(), cardSize);
    grow(endRect, [{ copy: cardCopy, from: cardStart, to: placementForWhole(endRect) }])
      .then(() => finishMediaOpenAfterGrow(zoom, opensId))
      .catch(() => endMediaOpenZoom(zoom));
    return true;
  }

  const firstShape = recordShape(opensRec, cardSize);
  const firstPicture = firstFilePictureCopy(opensRec, style === "first" ? MEDIA_OPEN_ZOOM_FIRST_WAIT_MS : MEDIA_OPEN_ZOOM_PRESENT_TIMEOUT_MS);

  if (style === "first") {
    // Wait for the first file, briefly; the card shows through meanwhile.
    firstPicture.then((firstCopy) => {
      if (zoom.ended) return;
      const size = firstCopy ? { w: firstCopy.width, h: firstCopy.height } : cardSize;
      const copy = firstCopy || cardCopy;
      const endRect = containRect(windowBox(), size);
      const start = firstCopy ? covering(square, size) : cardStart;
      Object.assign(copy.style, pictureKeyframe(start));
      addZoomPicture(parts, copy);
      grow(endRect, [{ copy, from: start, to: placementForWhole(endRect) }])
        .then(() => finishMediaOpenAfterGrow(zoom, opensId))
        .catch(() => endMediaOpenZoom(zoom));
    });
    return true;
  }

  // Morph and Switch at end: the card's picture grows at once, into the first
  // file's shape, covering the frame from its middle by the end. Until the
  // first file's picture is here its shape is a guess (what the library
  // knows of it); once it is, the frame re-aims at the real one from wherever
  // it has got to.
  let endRect = containRect(windowBox(), firstShape);
  addZoomPicture(parts, cardCopy);
  Object.assign(cardCopy.style, pictureKeyframe(cardStart));
  const started = performance.now();
  // Settles when the frame has reached its end -- the first grow's, or a
  // re-aimed one's.
  let resolveGrown;
  const grown = new Promise((resolve) => {
    resolveGrown = resolve;
  });
  grow(endRect, [{ copy: cardCopy, from: cardStart, to: covering(endRect, cardSize) }])
    .then(() => resolveGrown())
    .catch(() => {});
  const placementNow = (el) => {
    const cs = getComputedStyle(el);
    return {
      left: parseFloat(cs.left) || 0,
      top: parseFloat(cs.top) || 0,
      width: parseFloat(cs.width) || 0,
      height: parseFloat(cs.height) || 0,
    };
  };
  // Move the frame and the card's picture from where they are now to a new
  // end, over `ms`.
  const reaim = (newEnd, ms) => {
    const frameNow = placementNow(parts.frame);
    const cardNow = placementNow(cardCopy);
    const radiusNow = parseFloat(getComputedStyle(parts.frame).borderTopLeftRadius) || 0;
    for (const a of zoom.animations.splice(0)) {
      if (a.effect && (a.effect.target === parts.frame || a.effect.target === cardCopy)) {
        try { a.cancel(); } catch {}
      } else {
        zoom.animations.push(a);
      }
    }
    const t = { duration: ms, easing: MEDIA_OPEN_ZOOM_EASE, fill: "forwards" };
    const frameFrom = { frame: { ...frameNow, radius: radiusNow } };
    const frameTo = { frame: { ...newEnd, radius: 0 } };
    Object.assign(parts.frame.style, frameKeyframe(frameTo));
    const cardTo = covering(newEnd, cardSize);
    const frameMove = parts.frame.animate([frameKeyframe(frameFrom), frameKeyframe(frameTo)], t);
    frameMove.finished.then(() => resolveGrown()).catch(() => {});
    zoom.animations.push(frameMove, animatePicture(cardCopy, { picture: cardNow }, cardTo, t));
    endRect = newEnd;
    return frameNow;
  };
  firstPicture.then((firstCopy) => {
    if (zoom.ended || !firstCopy) return;
    const size = { w: firstCopy.width, h: firstCopy.height };
    const realEnd = containRect(windowBox(), size);
    const elapsed = performance.now() - started;
    const shapeDiffers =
      Math.abs(realEnd.width - endRect.width) > 2 || Math.abs(realEnd.height - endRect.height) > 2;
    if (shapeDiffers) {
      const left = Math.max(MEDIA_OPEN_ZOOM_FADE_MS, MEDIA_OPEN_ZOOM_MS - elapsed);
      reaim(realEnd, left);
    }
    const to = placementForWhole(endRect);
    if (style === "morph" && elapsed < MEDIA_OPEN_ZOOM_MS) {
      // Joins the grow part way: from covering the frame where it is now to
      // filling it at the end, fading in over what is left of the grow.
      const left = Math.max(MEDIA_OPEN_ZOOM_FADE_MS, MEDIA_OPEN_ZOOM_MS - elapsed);
      const frameNow = placementNow(parts.frame);
      const from = covering({ left: 0, top: 0, width: frameNow.width, height: frameNow.height }, size);
      Object.assign(firstCopy.style, pictureKeyframe(from), { opacity: "0" });
      addZoomPicture(parts, firstCopy);
      const t = { duration: left, easing: MEDIA_OPEN_ZOOM_EASE, fill: "forwards" };
      zoom.animations.push(
        animatePicture(firstCopy, from, to, t),
        fadePicture(firstCopy, 0, 1, { duration: left, fill: "forwards" }),
      );
      return;
    }
    // Switch at end (or a morph whose first file came late): once the grow is
    // done, dissolve into the first file where it will be shown.
    grown.then(() => {
      if (zoom.ended) return;
      Object.assign(firstCopy.style, pictureKeyframe(to), { opacity: "0" });
      addZoomPicture(parts, firstCopy);
      zoom.animations.push(fadePicture(firstCopy, 0, 1, { duration: MEDIA_OPEN_ZOOM_FADE_MS, fill: "forwards" }));
    });
  });
  // Switch at end opens once the dissolve has had its time; Morph as soon as
  // the grow is done.
  grown
    .then(async () => {
      if (style === "switch") {
        const t = performance.now();
        await Promise.race([firstPicture, new Promise((r) => setTimeout(r, 400))]);
        const waited = performance.now() - t;
        if (waited < MEDIA_OPEN_ZOOM_FADE_MS) {
          await new Promise((r) => setTimeout(r, MEDIA_OPEN_ZOOM_FADE_MS - waited));
        }
      }
      return finishMediaOpenAfterGrow(zoom, opensId);
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
