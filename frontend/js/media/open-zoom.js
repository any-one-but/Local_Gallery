/* Opening zoom
   A picture opened from the grid grows out of its card, and shrinks back into
   the card on the way out (Appearance -> Opening media). */

/* ===== Opening zoom ===== */

// Opening a file or a media folder from the grid, and closing it again, run
// inside a view transition: the browser keeps a picture of the screen before
// the change, makes the change, and animates between the two. One element is
// matched across the two pictures by name (view-transition-name), and that is
// what grows from the card to the full window, or back.
//
// The named element is never the card or the viewer itself. It is a canvas
// laid over each end exactly where the picture is seen -- the card's square on
// the grid, the picture's own letterboxed rectangle in the viewer -- with the
// picture drawn into it. A canvas because drawing is synchronous (the picture
// is on screen at once, decoded or not doesn't come into it, and a video's
// current frame draws the same way), and because the viewer's own element is
// the whole window with the picture letterboxed inside it, which would
// stretch as it shrank into a square.
//
// Only opening and closing animate. Stepping between open files stays a hard
// cut (see "Changing files is a hard cut"), and so does anything that does not
// turn out to open or close media: the key is run inside the transition and,
// if the screen did not change between grid and viewer, the transition is
// skipped.

const MEDIA_OPEN_ZOOM_CYCLE = Object.freeze([
  Object.freeze({ value: "zoom", label: "Zoom" }),
  Object.freeze({ value: "instant", label: "Instant" }),
]);
const MEDIA_OPEN_ZOOM_NAME = "lg-media-zoom";
let MEDIA_OPEN_ZOOM_TRANSITION = null;

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
  if (typeof document.startViewTransition !== "function") return false;
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
  return document.querySelector("#previewPane .previewSelected[data-preview-item-key]");
}

function mediaOpenZoomDrawable(el) {
  if (!el || !el.isConnected) return false;
  if (el.tagName === "IMG") return el.complete && el.naturalWidth > 0;
  if (el.tagName === "VIDEO") return el.readyState >= 2 && el.videoWidth > 0;
  return false;
}

function mediaOpenZoomNaturalSize(el) {
  if (!el) return null;
  const tag = el.tagName;
  const w = tag === "VIDEO" ? el.videoWidth : tag === "CANVAS" ? el.width : el.naturalWidth;
  const h = tag === "VIDEO" ? el.videoHeight : tag === "CANVAS" ? el.height : el.naturalHeight;
  return w > 0 && h > 0 ? { w, h } : null;
}

// Where a grid card's picture is, whether or not it has loaded yet: the box,
// and its corner.
function gridCardPictureBox(card) {
  if (!card) return null;
  const el = card.querySelector(
    "img.folderThumb, img.thumb, img.dirInlinePreview, video, .folderThumb, .dirSquareMedia",
  ) || card;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) ||
    parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
  return { rect, radius };
}

// The picture on a grid card: the element showing it, and the box it fills.
function gridCardZoomEnd(card) {
  if (!card) return null;
  const pictures = card.querySelectorAll(
    "img.folderThumb, img.thumb, img.dirInlinePreview, video",
  );
  for (const el of pictures) {
    if (!mediaOpenZoomDrawable(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) continue;
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) ||
      parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    return { el, rect, fit: "cover", radius };
  }
  return null;
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

// The open picture: where it is actually seen inside the viewer.
function openMediaZoomEnd(fallbackSource = null, { opening = false } = {}) {
  const viewport =
    document.getElementById("filePreviewViewport") ||
    document.getElementById("viewerViewport");
  // A zoomed-in picture is not where containRect says. (A picture being
  // opened is not zoomed, whatever the viewer's classes still say.)
  if (!opening && viewport && viewport.classList.contains("mediaZoomActive")) return null;
  // Open media fills the window, so the window is the box -- also on the
  // way in, before the viewer has been laid out.
  const box = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  const shown = viewport && viewport.querySelector(":scope > img, :scope > video");
  const el = mediaOpenZoomDrawable(shown) ? shown : fallbackSource;
  const size = mediaOpenZoomNaturalSize(el);
  if (!el || !size) return null;
  return { el, rect: containRect(box, size), fit: "contain", radius: 0 };
}

// A canvas laid exactly over one end, the picture drawn into it, carrying the
// name the transition matches.
function makeMediaOpenZoomProxy(end) {
  const { el, rect, radius } = end;
  const size = mediaOpenZoomNaturalSize(el);
  if (!size) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Cover: crop the picture to the box's shape from its middle, as the card
  // does. (A contain end's box already has the picture's shape.)
  const scale = Math.max(canvas.width / size.w, canvas.height / size.h);
  const sw = canvas.width / scale;
  const sh = canvas.height / scale;
  try {
    ctx.drawImage(el, (size.w - sw) / 2, (size.h - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: "0",
    borderRadius: `${radius}px`,
    zIndex: "2147483000",
    pointerEvents: "none",
    viewTransitionName: MEDIA_OPEN_ZOOM_NAME,
  });
  canvas.className = "mediaOpenZoomProxy";
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

// A copy of a whole picture at its own shape (longest side at most 1600px).
// The card's own <img> is emptied once the viewer opens, so the far end of an
// opening is drawn from this.
function mediaOpenZoomSnapshot(el) {
  const size = mediaOpenZoomNaturalSize(el);
  if (!size) return null;
  const scale = Math.min(1, 1600 / Math.max(size.w, size.h));
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

function waitForCondition(test, timeoutMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const tick = () => {
      if (test()) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(tick, 16);
    };
    tick();
  });
}

// Would the enter key on the selected grid card open media? A file does; a
// folder does when quick navigation would dive into it (navigateToDirectory).
function mediaOpenZoomPredictsOpen(card) {
  const itemKey = String(card?.getAttribute("data-preview-item-key") || "");
  if (itemKey.startsWith("file:")) return true;
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

// Called by the gallery's keydown listener before it handles a key. Answers
// true when it has taken the key: then `run(e)` is called inside a transition
// and the listener does nothing more now.
function mediaOpenZoomTakesKey(e, run) {
  if (MEDIA_OPEN_ZOOM_TRANSITION) {
    // A key during the animation ends it, so the keyboard never waits on it.
    try { MEDIA_OPEN_ZOOM_TRANSITION.skipTransition(); } catch {}
  }
  if (!mediaOpenZoomEnabled() || !WS.root) return false;
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return false;
  // The same test the listener makes: a key the app reserved is still ours.
  if (e.defaultPrevented && !RESERVED_APP_KEYBIND_EVENTS.has(e)) return false;
  if (isTextInputTarget(e.target) || variationsIsOpen() || BANIC_ACTIVE) return false;
  if (typeof lockScreenIsOpen === "function" && lockScreenIsOpen()) return false;
  const key = keybindValueFromEvent(e);
  if (!key) return false;
  const action = keybindActionFor(key);
  const mediaOpen = previewMediaIsOpen();
  let kind = "";
  let from = null;
  if (mediaOpen && (key === "Escape" || action === "back" || action === "leaveDir")) {
    kind = "close";
    from = openMediaZoomEnd();
  } else if (!mediaOpen && action === "enterDir") {
    const card = selectedPreviewGridCard();
    if (mediaOpenZoomPredictsOpen(card)) {
      kind = "open";
      from = gridCardZoomEnd(card);
    }
  }
  if (!kind || !from) return false;
  const fromProxy = makeMediaOpenZoomProxy(from);
  if (!fromProxy) return false;
  const openingSource = kind === "open" ? mediaOpenZoomSnapshot(from.el) : null;
  if (kind === "open" && !openingSource) return false;
  document.body.appendChild(fromProxy);
  let toProxy = null;
  let changed = false;
  let transition;
  // The far end is found as soon as the key has done its work, without
  // waiting for a frame: the screen is not drawn while a transition's update
  // runs, so anything that waits for a frame (the grid draws its cards on
  // later frames) would hold the old picture on screen. So the closing end is
  // the card's box as laid out now, and its picture is drawn from the viewer's
  // own copy (fromProxy), which is the whole picture at screen size.
  try {
    transition = document.startViewTransition(async () => {
      fromProxy.remove();
      run(e);
      // Opening a folder can wait on loading it (timers still run here).
      changed = await waitForCondition(
        () => previewMediaIsOpen() === (kind === "open"),
        500,
      );
      if (!changed) return;
      let to = null;
      if (kind === "open") {
        to = openMediaZoomEnd(openingSource, { opening: true });
      } else {
        const selectedKey = String(WS.view.previewSelectedKey || "");
        const card =
          (selectedKey &&
            document.querySelector(
              `#previewPane [data-preview-item-key="${CSS.escape(selectedKey)}"]`,
            )) ||
          selectedPreviewGridCard();
        const box = gridCardPictureBox(card);
        if (box) to = { el: fromProxy, rect: box.rect, radius: box.radius };
      }
      toProxy = to ? makeMediaOpenZoomProxy(to) : null;
      if (toProxy) document.body.appendChild(toProxy);
    });
  } catch {
    fromProxy.remove();
    return false;
  }
  MEDIA_OPEN_ZOOM_TRANSITION = transition;
  transition.updateCallbackDone
    .then(() => {
      if (!changed) transition.skipTransition();
    })
    .catch(() => {});
  transition.finished
    .catch(() => {})
    .finally(() => {
      fromProxy.remove();
      if (toProxy) toProxy.remove();
      if (MEDIA_OPEN_ZOOM_TRANSITION === transition) MEDIA_OPEN_ZOOM_TRANSITION = null;
    });
  // Kept from the browser, and marked as the app's own so the listener still
  // takes it when it runs inside the transition.
  RESERVED_APP_KEYBIND_EVENTS.add(e);
  e.preventDefault();
  return true;
}
