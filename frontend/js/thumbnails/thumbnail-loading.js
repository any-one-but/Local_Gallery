/* Thumbnail loading
   The thumbnail observer and queue, native thumbnails and recovering broken
   ones. */

/* === Passive-thumbnail loader =========================================
   Grid/folder thumbnails are full-resolution media. Each one registers here
   instead of assigning `src` at render time. An IntersectionObserver loads
   thumbnails on/near the viewport, nearest-to-center first, a few at a time,
   so visible rows fill in fast; thumbs scrolled far away are evicted and
   reload when they return. Active preview-pane media is NOT routed here.

   Slot accounting is derived from a live Set of in-flight elements (pruned of
   anything disconnected), rather than a running counter — so a thumbnail that
   gets removed mid-load (re-render / virtualization) can never permanently
   occupy a slot and stall future loads. */
const THUMB_MAX_IMG_CONCURRENT = 6;
const THUMB_MAX_VIDEO_CONCURRENT = 2;
const THUMB_WANTED = new Set();
const THUMB_LOADING = new Set();
let THUMB_REPRIORITIZE_RAF = 0;
const THUMB_OBSERVER =
  typeof IntersectionObserver === "function"
    ? new IntersectionObserver(onThumbIntersect, {
        root: null,
        rootMargin: "150% 0% 150% 0%",
      })
    : null;

function thumbElKind(el) {
  return el && el.tagName === "VIDEO" ? "video" : "img";
}

function registerThumbEl(el, src, opts = null) {
  if (!el || !src || !el.dataset) return false;
  const kind = (opts && opts.kind) || thumbElKind(el);
  el.dataset.thumbKind = kind;
  el.dataset.thumbSrc = src;
  el.dataset.thumbState = "idle";
  if (REVEALED_THUMB_SRCS.has(src)) {
    // This source already decoded once this session, so the browser still has
    // the bitmap cached. Start it opaque so rebuilds don't blink blank.
    el.classList.remove("thumbPending");
    el.classList.remove("thumbLoaded");
    el.classList.add("thumbLoadedInstant");
  } else {
    // Opaque dark pending tile (see .thumbPending CSS). Never opacity:0 — that
    // punched a hole under the frosted title strip until decode completed.
    el.classList.add("thumbPending");
    el.classList.remove("thumbLoaded");
    el.classList.remove("thumbLoadedInstant");
    try {
      el.alt = "";
    } catch {}
  }
  if (!el.__thumbBound) {
    el.__thumbBound = true;
    const settled = () => onThumbLoadSettled(el);
    el.addEventListener(kind === "video" ? "loadeddata" : "load", settled);
    el.addEventListener("error", settled);
  }
  if (!THUMB_OBSERVER) {
    assignThumbSrc(el);
    return true;
  }
  try {
    THUMB_OBSERVER.observe(el);
    THUMB_OBSERVED.add(el);
  } catch {}
  return true;
}

// ---- Tauri: native downscaled thumbnails -------------------------------
// Under Tauri, route lazy <img> thumbnails through the Rust thumbnail cache so
// grids load small JPEGs instead of full-resolution media. Bulletproof: if a
// cached thumb isn't ready we fall back to a placeholder (or, for small files, the
// original), then swap in the lighter thumbnail once generated. The full-size viewer
// bypasses assignThumbSrc, so it stays full-resolution.
const TAURI_THUMB_INDEX = new Map(); // `${path}::${edge}` -> asset URL
// Same reasoning as REVEALED_THUMB_SRCS: a pure lookup cache, capped so a long
// session over a large library cannot grow it without limit. A dropped entry
// just means one more round-trip to the Rust thumbnail cache on disk.
const TAURI_THUMB_INDEX_LIMIT = 20000;
// url -> key, so a failed thumbnail can be forgotten without scanning the index.
const TAURI_THUMB_KEY_BY_URL = new Map();
function rememberTauriThumb(key, url) {
  if (!key || !url) return;
  if (TAURI_THUMB_INDEX.has(key)) {
    TAURI_THUMB_KEY_BY_URL.delete(TAURI_THUMB_INDEX.get(key));
    TAURI_THUMB_INDEX.delete(key);
  }
  TAURI_THUMB_INDEX.set(key, url);
  TAURI_THUMB_KEY_BY_URL.set(url, key);
  while (TAURI_THUMB_INDEX.size > TAURI_THUMB_INDEX_LIMIT) {
    const oldest = TAURI_THUMB_INDEX.entries().next();
    if (oldest.done) break;
    TAURI_THUMB_INDEX.delete(oldest.value[0]);
    TAURI_THUMB_KEY_BY_URL.delete(oldest.value[1]);
  }
}
const TAURI_THUMB_EDGE = 512;
// Full-quality thumbnails are user-switchable (the app-menu Thumbnails submenu,
// "Full resolution"). When on, image and video tiles both paint a generated
// copy 2048px on its long side -- sharper than any tile can show -- and when
// off, a 512px one. The generator never enlarges, so an image already that
// small comes back at its own size. Default lives next to
// fullResThumbnailsEnabled (FULL_QUALITY_THUMBNAILS_DEFAULT).
//
// Image tiles used to paint the original itself in this mode. On Chromium (the
// Electron app) a grid of 26-megapixel photos then took up to seconds per key
// press: ~49 originals loaded at ~100MB decoded each overflow the decoded-image
// cache, so every frame -- including the one that moves the selection --
// re-decoded them. Measured on Madison Kate's sets: 170-600ms from key to
// screen with originals, against 32-56ms for a model with small photos.
// generate_thumbnail clamps its edge to 2048, so that is "full quality".
const FULL_QUALITY_THUMB_EDGE = 2048;
// Above this, a tile must NOT fall back to the original while its thumb generates.
// TAURI_THUMB_INDEX is in-memory only, so every session starts cold and every tile
// takes the fallback path at least once — and the fallback used to be the full-res
// original. A 24MP photo decodes to ~100MB of bitmap; six of those in flight (see
// THUMB_MAX_IMG_CONCURRENT), replaced continuously as you scroll, pegs the decoder
// threads and cooks the machine for a picture that is about to be thrown away and
// replaced by a 512px JPEG anyway. Below the threshold the original is already
// thumbnail-sized, so decoding it is cheap and the progressive preview is free.
const TAURI_THUMB_ORIGINAL_FALLBACK_MAX_BYTES = 1024 * 1024;
// 1x1 transparent gif — used for not-yet-generated thumbnails so an <img> never
// tries to load a video file (which it can't render) or a huge original.
const TAURI_TRANSPARENT_PX =
  "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
function tauriThumbnailsActive() {
  return !!(
    typeof window !== "undefined" &&
    window.electronAPI &&
    window.electronAPI.isTauri &&
    window.__lg &&
    typeof window.__lg.requestThumb === "function"
  );
}
function tauriThumbForImgEl(el) {
  if (!tauriThumbnailsActive()) return "";
  if (!el || el.tagName !== "IMG") return "";
  const recId = String(el.dataset.dirPreviewId || el.dataset.fileId || "");
  if (!recId) return "";
  const rec = WS.fileById.get(recId);
  if (!rec || (rec.type !== "image" && rec.type !== "video")) return "";
  const fullRes = fullResThumbnailsEnabled();
  const path = nativePathForRecord(rec);
  if (!path) return "";
  // Honor the user's chosen video thumbnail frame (backwards-compatible with the
  // Electron build); the key includes it so changing the frame regenerates.
  const frameTime =
    rec.type === "video" ? metaGetVideoThumbnailTimeForRecord(rec) : null;
  const ftKey = Number.isFinite(frameTime) ? Math.round(frameTime * 1000) : "d";
  const thumbEdge = fullRes ? FULL_QUALITY_THUMB_EDGE : TAURI_THUMB_EDGE;
  const key = `${path}::${thumbEdge}::${ftKey}`;
  const cached = TAURI_THUMB_INDEX.get(key);
  if (cached) {
    const colF = getCurrentColorFilterCssForTarget(rec);
    if (colF) {
      try { el.style.filter = colF; } catch {}
    } else {
      try { el.style.removeProperty("filter"); } catch {}
    }
    return cached;
  }
  if (!el.__tauriThumbPending) {
    el.__tauriThumbPending = true;
    window.__lg
      .requestThumb(path, thumbEdge, frameTime)
      .then((url) => {
        el.__tauriThumbPending = false;
        if (!url) return;
        rememberTauriThumb(key, url);
        const stillSame =
          el.isConnected &&
          String(el.dataset.dirPreviewId || el.dataset.fileId || "") === recId;
        if (stillSame) {
          try { el.src = url; } catch {}
          const colF = getCurrentColorFilterCssForTarget(rec);
          if (colF) {
            try { el.style.filter = colF; } catch {}
          } else {
            try { el.style.removeProperty("filter"); } catch {}
          }
        }
      })
      .catch(() => { el.__tauriThumbPending = false; });
  }
  // Nothing cached yet; the request above is in flight. Video: an <img> can't render
  // the video file, so hold a transparent pixel. Image: hold a transparent pixel too
  // unless the original is small enough to decode for free — see
  // TAURI_THUMB_ORIGINAL_FALLBACK_MAX_BYTES. Returning "" here makes assignThumbSrc
  // fall back to dataset.thumbSrc, which is the full-resolution original.
  const colF = getCurrentColorFilterCssForTarget(rec);
  if (colF) {
    try { el.style.filter = colF; } catch {}
  } else {
    try { el.style.removeProperty("filter"); } catch {}
  }
  if (rec.type === "video") return TAURI_TRANSPARENT_PX;
  const bytes = Number(rec.size);
  const cheapToDecode =
    Number.isFinite(bytes) &&
    bytes > 0 &&
    bytes <= TAURI_THUMB_ORIGINAL_FALLBACK_MAX_BYTES;
  return cheapToDecode ? "" : TAURI_TRANSPARENT_PX;
}

// Post-render pass for inline folder/tag lead thumbnails (img.dirInlinePreview /
// img.folderThumb), which set their src in markup and bypass assignThumbSrc.
// Routes them through the same cached-thumbnail path (image + video).
function tauriThumbnailizeContainer(container) {
  if (!tauriThumbnailsActive() || !container || !container.querySelectorAll) return;
  const imgs = container.querySelectorAll(
    "img.dirInlinePreview[data-dir-preview-id], img.folderThumb[data-dir-preview-id]",
  );
  imgs.forEach((img) => {
    const s = tauriThumbForImgEl(img);
    if (s) {
      try { img.src = s; } catch {}
    }
  });
}

function assignThumbSrc(el) {
  if (!el || !el.dataset) return;
  let src = el.dataset.thumbSrc || "";
  if (!src) return;
  if (el.dataset.thumbState === "loading" || el.dataset.thumbState === "loaded")
    return;
  const thumbSrc = tauriThumbForImgEl(el);
  if (thumbSrc) src = thumbSrc;
  el.dataset.thumbState = "loading";
  THUMB_LOADING.add(el);
  try { el.src = src; } catch {}
}

// Derive live in-flight counts, pruning anything that was removed from the DOM
// or already settled so leaked slots self-heal.
function thumbActiveCounts() {
  let img = 0;
  let video = 0;
  for (const el of THUMB_LOADING) {
    if (!el.isConnected || !el.dataset || el.dataset.thumbState !== "loading") {
      THUMB_LOADING.delete(el);
      continue;
    }
    if (thumbElKind(el) === "video") video++;
    else img++;
  }
  return { img, video };
}

// Sources (asset URLs) that have decoded at least once this session. A source
// in here has already had its first-appearance fade, so on any later reveal
// (pane rebuild, scroll-back) we snap it in with no animation — killing the
// per-rebuild flicker without changing when thumbnails actually load.
const REVEALED_THUMB_SRCS = new Set();
// Bounded: this is only an anti-flicker hint ("this source decoded once"), and
// on a six-figure library an unbounded set of asset URLs is real memory for no
// benefit. Oldest entries fall out; the worst that costs is one extra fade.
const REVEALED_THUMB_SRCS_LIMIT = 20000;
function rememberRevealedThumbSrc(src) {
  if (!src) return;
  if (REVEALED_THUMB_SRCS.has(src)) return;
  REVEALED_THUMB_SRCS.add(src);
  while (REVEALED_THUMB_SRCS.size > REVEALED_THUMB_SRCS_LIMIT) {
    const oldest = REVEALED_THUMB_SRCS.values().next();
    if (oldest.done) break;
    REVEALED_THUMB_SRCS.delete(oldest.value);
  }
}

function onThumbLoadSettled(el) {
  if (!el || !el.dataset) return;
  THUMB_LOADING.delete(el);
  el.dataset.thumbState = "loaded";
  // Fade in only if it actually decoded. On error (img with no natural size)
  // leave it transparent — a quiet empty slot, never a broken-image icon.
  const decoded =
    thumbElKind(el) === "video" ? true : (Number(el.naturalWidth) || 0) > 0;
  if (decoded) {
    const src = String(el.dataset.thumbSrc || "");
    if (src) rememberRevealedThumbSrc(src);
    // Always snap opaque — never re-run a 0→1 fade under the title strip.
    el.classList.add("thumbLoadedInstant");
    el.classList.remove("thumbLoaded");
    el.classList.remove("thumbPending");
  } else if (el.tagName === "IMG" && el.getAttribute("src")) {
    // A folder card's picture gets the same recovery as the inline ones
    // (another source, then the Blank look); a file tile stays a quiet slot.
    if (el.classList.contains("folderThumb")) {
      const failed = String(el.currentSrc || el.src || "");
      forgetThumbEl(el);
      recoverBrokenInlineThumb(el, failed);
    } else {
      forgetFailedThumbSrc(String(el.currentSrc || el.src || ""));
    }
  }
  pumpThumbQueue();
}

function evictThumbEl(el) {
  if (!el || !el.dataset) return;
  const state = el.dataset.thumbState;
  if (state !== "loading" && state !== "loaded") return;
  THUMB_LOADING.delete(el);
  if (thumbElKind(el) === "video") stopCachedMediaElement(el);
  else { try { el.removeAttribute("src"); } catch {} }
  el.dataset.thumbState = "idle";
  // Re-hide: a re-shown (scrolled-back) thumbnail reveals again instead of
  // briefly showing the now-src-less broken image. Clear the instant-reveal
  // class too, or the transparent-hold (thumbPending) would be overridden and
  // the src-less element could flash a broken image.
  el.classList.add("thumbPending");
  el.classList.remove("thumbLoaded");
  el.classList.remove("thumbLoadedInstant");
}

/* An IntersectionObserver holds a strong reference to every target it is given,
   so a tile that is re-rendered (which this app does constantly) stays alive,
   detached, for the rest of the session unless it is explicitly unobserved.
   Over hours of browsing that is tens of thousands of orphaned <img>/<video>
   nodes. Anything no longer in the document is dropped here and on the sweep
   below. */
function forgetThumbEl(el) {
  if (!el) return;
  THUMB_WANTED.delete(el);
  THUMB_LOADING.delete(el);
  evictThumbEl(el);
  if (THUMB_OBSERVER) {
    try {
      THUMB_OBSERVER.unobserve(el);
    } catch {}
  }
  try {
    delete el.dataset.thumbSrc;
  } catch {}
}

function onThumbIntersect(entries) {
  for (let i = 0; i < entries.length; i++) {
    const el = entries[i].target;
    if (!el.isConnected) {
      forgetThumbEl(el);
      continue;
    }
    if (entries[i].isIntersecting) {
      THUMB_WANTED.add(el);
    } else {
      THUMB_WANTED.delete(el);
      evictThumbEl(el);
    }
  }
  pumpThumbQueue();
}

/* Backstop for tiles that were removed without the observer ever reporting on
   them again (a whole pane replaced in one go is the common case). Cheap: it
   only walks the two live sets, which are bounded by what is on screen. */
const THUMB_OBSERVED = new Set();
function sweepDetachedThumbEls() {
  if (!THUMB_OBSERVED.size) return;
  for (const el of THUMB_OBSERVED) {
    if (el.isConnected) continue;
    THUMB_OBSERVED.delete(el);
    forgetThumbEl(el);
  }
}

function thumbDistanceToViewportCenter(el) {
  const r = el.getBoundingClientRect();
  const cy = (window.innerHeight || 0) / 2;
  const cx = (window.innerWidth || 0) / 2;
  return Math.abs(r.top + r.height / 2 - cy) +
    Math.abs(r.left + r.width / 2 - cx) * 0.25;
}

function pumpThumbQueue() {
  if (!THUMB_WANTED.size) return;
  const idle = [];
  for (const el of THUMB_WANTED) {
    if (!el.isConnected) { THUMB_WANTED.delete(el); continue; }
    if (el.dataset.thumbState === "idle") idle.push(el);
  }
  if (!idle.length) return;
  idle.sort(
    (a, b) =>
      thumbDistanceToViewportCenter(a) - thumbDistanceToViewportCenter(b),
  );
  const counts = thumbActiveCounts();
  for (let i = 0; i < idle.length; i++) {
    const el = idle[i];
    if (thumbElKind(el) === "video") {
      if (counts.video >= THUMB_MAX_VIDEO_CONCURRENT) continue;
      assignThumbSrc(el);
      counts.video++;
    } else {
      if (counts.img >= THUMB_MAX_IMG_CONCURRENT) continue;
      assignThumbSrc(el);
      counts.img++;
    }
  }
}

function reprioritizeThumbs() {
  if (THUMB_REPRIORITIZE_RAF) return;
  THUMB_REPRIORITIZE_RAF = requestAnimationFrame(() => {
    THUMB_REPRIORITIZE_RAF = 0;
    pumpThumbQueue();
  });
}

// Force the IntersectionObserver to re-evaluate every pending thumbnail against
// the current layout. On initial root open, the observer's first callback can
// run before the panes have their final size (the busy overlay is still tearing
// down), so nothing gets marked visible and loading never starts until the user
// navigates — re-observing kicks it off without that nudge.
function primeThumbnailLoadingNow() {
  if (!THUMB_OBSERVER) {
    reprioritizeThumbs();
    return;
  }
  let nodes;
  try {
    nodes = document.querySelectorAll('[data-thumb-state="idle"]');
  } catch {
    reprioritizeThumbs();
    return;
  }
  for (let i = 0; i < nodes.length; i++) {
    try {
      THUMB_OBSERVER.unobserve(nodes[i]);
      THUMB_OBSERVER.observe(nodes[i]);
    } catch {}
  }
  reprioritizeThumbs();
}

// Run the prime a few times after a fresh root open: once layout settles and
// again shortly after, so thumbnails start loading immediately on startup.
function scheduleInitialThumbnailPrime() {
  requestAnimationFrame(() => {
    primeThumbnailLoadingNow();
    setTimeout(primeThumbnailLoadingNow, 250);
    setTimeout(primeThumbnailLoadingNow, 800);
  });
}

// No-op shim retained for legacy call sites.
function primeThumbsNow() {}

try {
  window.addEventListener("scroll", reprioritizeThumbs, true);
  window.addEventListener("resize", reprioritizeThumbs, true);
} catch {}
// No-op shim: navigation-corridor prewarm removed with the v1.6.43 loader.
function prewarmNavigationCorridor() {}


// The initial class for an inline thumbnail's <img>. A source that already
// decoded once this session is still in the browser cache, so emit it opaque
// (thumbLoadedInstant) rather than transparent (thumbPending): on a directories
// rebuild it paints straight from cache with no one-frame blank and no fade.
// First-time sources stay thumbPending so they never flash a broken image.
function inlineThumbInitClass(src) {
  return src && REVEALED_THUMB_SRCS.has(String(src))
    ? "thumbLoadedInstant"
    : "thumbPending";
}

// Inline thumbnails (.dirInlinePreview — custom folder/tag/album thumbs) set
// their src directly in markup and bypass the passive loader, so they have no
// per-element load hook. They render with class "thumbPending" (held invisible)
// and this single delegated, capture-phase listener fades them in once the
// image actually decodes — removing the placeholder->image flicker. load/error
// do not bubble, hence capture. A CSS safety keyframe reveals after 2s if an
// event is ever missed.
function revealInlineThumb(el) {
  if (!el || !el.classList || !el.classList.contains("thumbPending")) return;
  // Same anti-flicker rule as the passive grid loader (see onThumbLoadSettled):
  // the 150ms fade is a nice first-appearance touch, but replaying it every
  // time the directories pane is torn down and rebuilt is exactly the constant
  // flicker seen when toggling settings. Once a source has decoded once this
  // session, snap it back instantly on later rebuilds instead of re-fading.
  const src = String(el.currentSrc || el.src || "");
  const decoded = (Number(el.naturalWidth) || 0) > 0;
  if (src && decoded && REVEALED_THUMB_SRCS.has(src)) {
    el.classList.add("thumbLoadedInstant");
    el.classList.remove("thumbLoaded");
  } else {
    // Only record sources that actually decoded, so a broken thumb never gets
    // marked "revealed" (matches onThumbLoadSettled). A first decode still gets
    // the one-time fade; an error keeps the old reveal-anyway behavior.
    if (src && decoded) rememberRevealedThumbSrc(src);
    el.classList.add("thumbLoaded");
    el.classList.remove("thumbLoadedInstant");
  }
  el.classList.remove("thumbPending");
}
// A thumbnail source that failed to load must not be handed out again: drop
// it from the generated-thumbnail index and the "already decoded" hint, so the
// next render asks for a fresh one instead of repeating the failure.
function forgetFailedThumbSrc(src) {
  const failed = String(src || "");
  if (!failed) return;
  REVEALED_THUMB_SRCS.delete(failed);
  const key = TAURI_THUMB_KEY_BY_URL.get(failed);
  if (key != null) {
    TAURI_THUMB_KEY_BY_URL.delete(failed);
    if (TAURI_THUMB_INDEX.get(key) === failed) TAURI_THUMB_INDEX.delete(key);
  }
}

// The card's own type icon (in the name pill, or its lone bubble), so a
// replaced thumbnail looks exactly like the Blank thumbnail setting for that
// kind of item.
function blankThumbIconHtmlForEl(el) {
  const card = el?.closest?.("[data-preview-item-key], .dirRow, .folderCard");
  const glyph = card?.querySelector?.(".thumbnailTypeIconGlyph");
  if (glyph) {
    const clone = glyph.cloneNode(true);
    clone.classList.remove("thumbnailTypeIconGlyph", "thumbnailTitleTypeIcon");
    return clone.outerHTML;
  }
  const key = String(card?.getAttribute?.("data-preview-item-key") || "");
  if (key.startsWith("tag:")) return appIconHtml("tag");
  if (key.startsWith("dir:")) return appIconHtml("folder");
  const rec = WS.fileById?.get(String(el?.dataset?.dirPreviewId || ""));
  return appIconHtml(rec ? iconKeyForRecordType(rec.type) : "folder");
}

function replaceBrokenThumbWithBlank(img) {
  if (!img || !img.isConnected) return false;
  const blank = document.createElement("div");
  const isFolderThumb = img.classList.contains("folderThumb");
  blank.className = isFolderThumb
    ? "folderThumb folderThumbFallback"
    : "dirSquareFallback";
  blank.setAttribute("aria-hidden", "true");
  blank.dataset.brokenThumb = "1";
  const inQuadCell = !!img.closest(".dirTagQuadCell");
  blank.innerHTML = inQuadCell ? "" : blankThumbIconHtmlForEl(img);
  try {
    img.replaceWith(blank);
    return true;
  } catch {
    return false;
  }
}

/* A thumbnail that fails to load used to be revealed anyway, which put the
   browser's broken-image glyph on the card. Instead: forget the failed source,
   try once more with something that can work (the original picture for an
   image, the file itself as a <video> for a video, since an <img> can never
   show one), and if that fails too, show the card as the Blank thumbnail
   setting would. */
function recoverBrokenInlineThumb(img, failedSrc = "") {
  if (!img || img.tagName !== "IMG" || !img.isConnected) return false;
  const failed = String(failedSrc || img.currentSrc || img.src || "");
  forgetFailedThumbSrc(failed);
  debugModeLog("thumb", "thumbnail failed to load", {
    id: img.dataset.dirPreviewId || "",
    src: failed.slice(0, 160),
  });
  const recId = String(img.dataset.dirPreviewId || "");
  const rec = recId ? WS.fileById.get(recId) || null : null;
  const attempts = Number(img.dataset.thumbRecoveries || 0);
  img.dataset.thumbRecoveries = String(attempts + 1);
  if (rec && attempts === 0 && !rec.isMissingPlaceholder && tauriThumbnailsActive()) {
    // The app: ask for the generated thumbnail once more (the failed one was
    // just forgotten, so this is a fresh request). Never fall back to the
    // original file or a <video> here -- a library with many failures would
    // decode full-size media for every one of them.
    // A transparent placeholder means the request is in flight: hold the empty
    // pixel (never the broken glyph) and let the request set the src when it
    // lands. An empty answer means a small image may use its original.
    const retry = tauriThumbForImgEl(img);
    if (retry && retry !== failed) {
      img.src = retry;
      return true;
    }
    if (!retry && rec.type === "image") {
      const bytes = Number(rec.size);
      const original = String(ensureMediaUrl(rec) || "");
      if (
        original &&
        original !== failed &&
        bytes > 0 &&
        bytes <= TAURI_THUMB_ORIGINAL_FALLBACK_MAX_BYTES
      ) {
        img.src = original;
        return true;
      }
    }
  } else if (rec && attempts === 0 && !rec.isMissingPlaceholder) {
    if (rec.type === "image") {
      const original = String(ensureMediaUrl(rec) || "");
      if (original && original !== failed) {
        img.src = original;
        return true;
      }
    } else if (rec.type === "video") {
      const video = makePassivePreviewVideoElement(img, rec, recId);
      if (video) {
        video.addEventListener(
          "error",
          () => {
            const stub = document.createElement("img");
            stub.className = video.className;
            stub.dataset.dirPreviewId = recId;
            try { video.replaceWith(stub); } catch { return; }
            replaceBrokenThumbWithBlank(stub);
          },
          { once: true },
        );
        img.replaceWith(video);
        return true;
      }
    }
  }
  return replaceBrokenThumbWithBlank(img);
}

function onInlineThumbSettled(e) {
  const t = e && e.target;
  if (!t || t.tagName !== "IMG" || !t.classList) return;
  const inline = t.classList.contains("dirInlinePreview");
  // Passively loaded folder thumbs (data-thumb-src) settle through
  // onThumbLoadSettled; this covers the ones whose src is set in markup.
  const markupFolderThumb =
    t.classList.contains("folderThumb") &&
    t.hasAttribute("data-dir-preview-id") &&
    !t.dataset.thumbSrc;
  if (!inline && !markupFolderThumb) return;
  if (e.type === "error") {
    if (recoverBrokenInlineThumb(t)) return;
  }
  if (inline) revealInlineThumb(t);
}
try {
  document.addEventListener("load", onInlineThumbSettled, true);
  document.addEventListener("error", onInlineThumbSettled, true);
} catch {}

function getVideoPosterForRecord() { return BLACK_POSTER_URL; }
function refreshDirectoryInlinePreviewThumbForRecord() {}
function refreshPreviewInlineThumbForRecord() {}
function materializeCatalogMetadataThumbnailRecords() { return Promise.resolve(0); }
function remapThumbnailUrlRecordIds() {}
function invalidateAllThumbs() { resetThumbnailRuntimeStateV3(); }
function clearQueuedThumbnailWork() {
  try {
    WS.videoThumbPriorityQueue = [];
    WS.videoThumbQueue = [];
    WS.imageThumbPriorityQueue = [];
    WS.imageThumbQueue = [];
    if (WS.videoThumbQueuedIds instanceof Set) WS.videoThumbQueuedIds.clear();
    if (WS.imageThumbQueuedIds instanceof Set) WS.imageThumbQueuedIds.clear();
    if (WS.videoThumbInFlightIds instanceof Set) WS.videoThumbInFlightIds.clear();
    if (WS.imageThumbInFlightIds instanceof Set) WS.imageThumbInFlightIds.clear();
    if (WS.videoThumbInFlightBackgroundIds instanceof Set) WS.videoThumbInFlightBackgroundIds.clear();
    WS.videoThumbActive = 0;
    WS.imageThumbActive = 0;
  } catch {}
}
function revokeThumbnailUrlForRecord(rec) {
  if (!rec) return;
  if (rec.thumbUrl) { try { URL.revokeObjectURL(rec.thumbUrl); } catch {} rec.thumbUrl = null; }
  if (rec.videoThumbUrl) { try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {} rec.videoThumbUrl = null; }
  rec.thumbMode = "placeholder";
  rec.videoThumbMode = "placeholder";
}
function revokeAllThumbnailUrls() {
  try {
    if (!WS || !WS.files) return;
    for (const rec of WS.files) revokeThumbnailUrlForRecord(rec);
  } catch {}
}
function clearThumbnailReadyPromisesForIds() {}
function removeThumbnailIdsFromQueues() { clearQueuedThumbnailWork(); }
function evictThumbnailIds() { clearQueuedThumbnailWork(); }
function evictThumbnailUrlsOutsideDemand() { revokeAllThumbnailUrls(); }
function trackThumbnailUrlForRecord() {}
function ensureThumbnailCacheSets() {
  WS.thumbnailDesiredIds = new Set();
  WS.thumbnailPriorityIds = new Set();
  WS.thumbnailRootPinnedIds = new Set();
  WS.thumbnailActiveWorkspaceIds = new Set();
  WS.thumbnailActiveWorkspaceRootChild = "";
}
function thumbnailRecordDesired() { return false; }
function thumbnailJobContextStillValid() { return false; }
function thumbnailRecordHasCurrentThumb() { return false; }
function thumbnailRecordNeedsWork() { return false; }
function thumbnailQueuesHavePendingWork() { return false; }
function thumbnailBackgroundBatchLimitForContext() { return 0; }
function thumbnailBackgroundViewKey() { return "thumbs-disabled-v3"; }
function ensureThumbnailBackgroundContext() { return false; }
function thumbnailRecordsForNavigationEntry() { return []; }
function collectBackgroundThumbnailDemandRecords() { return []; }
function getPreviewCardThumbnailDemandRecords() { return []; }
function getDirectoriesRowThumbnailDemandRecords() { return []; }
function collectPreviewThumbnailDemandIds() { return new Set(); }
function collectDirectoriesThumbnailDemandIds() { return new Set(); }
function collectThumbnailDemandIds() { return new Set(); }
function syncThumbnailQueueToDemand() { clearQueuedThumbnailWork(); }
function flushThumbnailUiInvalidation() {}
function scheduleThumbnailUiInvalidation() {}
function notifyThumbnailRecordUpdated() {}
function refreshThumbnailDemand() { clearQueuedThumbnailWork(); }
function deferThumbnailDemandForSelection() {}
function scheduleThumbnailDemandRefresh() {
  clearQueuedThumbnailWork();
  try { sweepDetachedThumbEls(); } catch {}
  // Pump the thumbnail queue next frame so freshly-rendered rows start loading
  // immediately instead of waiting on the IntersectionObserver callback.
  reprioritizeThumbs();
  scheduleLoadedThumbnailMediaRelease();
}
function scheduleThumbnailBackgroundContinuation() {}
function collectThumbnailServiceRepairRecords() { return []; }
async function runThumbnailServiceRepair() { return true; }
async function repairRenderedThumbnailPlaceholders() { return true; }
async function repairRootPinnedThumbnails() { return true; }
function scheduleRootPinnedThumbnailPreload() {}
function thumbnailServiceHeartbeatTick() {}
function ensureThumbnailServiceHeartbeat() { resetThumbnailRuntimeStateV3(); }
async function ensureNavigationThumbReady() { return true; }
async function ensureNavigationThumbDisplayReady() { return true; }
async function warmPinnedNavigationThumbDecode() { return true; }
function stopCachedMediaElement(el) {
  if (!el) return false;
  const tag = String(el.tagName || "").toLowerCase();
  try {
    if (tag === "video") {
      cancelResponsiveVideoSeek(el);
      el.pause();
    }
  } catch {}
  try {
    if (tag === "video" || tag === "img") {
      el.removeAttribute("src");
      if (tag === "video") el.load();
      return true;
    }
  } catch {}
  return false;
}

// Release any live thumbnail media (video WebMediaPlayers and img sources)
// inside a container before it is wiped (e.g. innerHTML = ""). Detaching a
// <video> from the DOM does not reliably fire the IntersectionObserver, so
// without this its WebMediaPlayer lingers until GC; with many video thumbnails
// that accumulation can exhaust Chromium's per-renderer WebMediaPlayer budget
// and make later videos fail to load ("Could not load video") until the app is
// restarted. Scoped to thumbnail classes so it never touches the main
// preview/viewer players.
function releaseContainerThumbMedia(container) {
  if (!container || typeof container.querySelectorAll !== "function") return;
  let nodes;
  try {
    nodes = container.querySelectorAll(
      "video.thumb, img.thumb, video.folderThumb, img.folderThumb, video.dirInlinePreview, img.dirInlinePreview",
    );
  } catch {
    return;
  }
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    try { evictThumbEl(node); } catch {}
    if (String(node.tagName || "").toLowerCase() === "video") {
      try { stopCachedMediaElement(node); } catch {}
    }
  }
}
