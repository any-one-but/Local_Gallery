/* Thumbnail options
   Retired thumbnail switches (fixed answers) and the thumbnail scale.
   (syncThumbFilterKeyWithCurrentAppearanceContext is in
   appearance/apply-options.js.) */

/* =========================================================
       v3 hard removal: thumbnail plumbing is disabled at runtime
       ========================================================= */

function shouldAutoLoadFileThumbnails() { return false; }
function thumbnailPushQueueEnabled() { return false; }
function thumbFiltersEnabled() { return false; }
function thumbFiltersActive() { return false; }
function buildThumbFilterKey() { return "thumbs-disabled-v3"; }
function currentImageThumbMode() { return "placeholder"; }
function currentVideoThumbMode() { return "placeholder"; }
function imageThumbModeSkipsLoading() { return true; }
function videoThumbModeSkipsLoading() { return true; }
function imageThumbWidthForOption() { return 0; }
function videoThumbWidthForOption() { return 0; }
function naturalAspectThumbnailCardsEnabled() { return false; }
function previewSquareMediaThumbsEnabled() { return true; }
function getThumbnailStyleFromOptions() { return "cropped"; }
function getActiveThumbnailScaleMultiplier(opt = null) {
  const options =
    opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  const size = options && options.thumbnailSize ? options.thumbnailSize : "medium";
  if (size === "xsmall") return 0.4;
  if (size === "small") return 0.8;
  if (size === "large") return 1.3;
  if (size === "xlarge") return 1.7;
  return 1;
}
function getThumbnailScaleForStyle() { return "row7"; }
function getActiveThumbnailScale() { return "row7"; }
function applyThumbFitFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  root.style.setProperty("--thumb-fit", "cover");
  root.style.setProperty("--thumb-bg", "transparent");
  root.style.setProperty("--thumb-filter", "none");
  root.removeAttribute("data-natural-thumb-cards");
}
/* One property, read by every backdrop-filter in the stylesheet. The whole
   control is this: the surfaces derive their own amount from it (a menu frosts
   harder than a pill) rather than each carrying a number of its own, so there
   is one thing to turn and nothing can drift out of step with it. */
function applyGlassDiffusionFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const pct = Number(getGlassDiffusionFromOptions(opt));
  const px = (Number.isFinite(pct) ? pct : 0) / 100 * GLASS_DIFFUSION_MAX_PX;
  root.style.setProperty(
    "--glass-diffusion",
    `${Number.isFinite(px) ? Number(px.toFixed(2)) : 0}px`,
  );
}
function applyThumbnailTitleSizeFromOptions() {
  const root = document.documentElement;
  if (!root) return;
  root.removeAttribute("data-thumbnail-title-size");
  root.removeAttribute("data-preview-file-title-size");
  root.removeAttribute("data-preview-root-folder-title-size");
  root.removeAttribute("data-preview-subfolder-title-size");
  root.removeAttribute("data-preview-tag-title-size");
}
function applyDirectoryMiniThumbSizeFromOptions() {}
function applyDirectoryFileThumbLayoutFromOptions() {}
function applyNaturalAspectThumbnailModeFromOptions() {
  const root = document.documentElement;
  if (root) root.removeAttribute("data-natural-thumb-cards");
}

/* === Instant-navigation shared state ==================================
   Infrastructure shared by the passive-thumbnail loader, navigation entry
   points, and the lead-preview discovery. Two concerns live here:

     1. PREVIEW_THUMB_TARGET_CACHE — remembers which file a folder/tag/album
        resolves to for its thumbnail, so repeated renders during navigation
        don't re-walk the subtree. Stores ids only, never media data.
     2. FAST_NAV — detects rapid repeated navigation so the loader can cancel
        stale work, suppress placeholder churn, and defer non-visible video
        thumbnails until the user settles. */
function navNow() {
  return typeof performance !== "undefined" && performance.now
    ? performance.now()
    : Date.now();
}

// Resolved thumbnail-target decisions, keyed by "<thumbFilterKey>|<scope>"
// where scope is a folder path, tag key, or album key. Values are file-id
// strings (or "" meaning "resolved to nothing"). Cleared on workspace reset
// and whenever thumbnail metadata changes.
let PREVIEW_THUMB_TARGET_CACHE = new Map();
function thumbTargetCacheKey(scope) {
  const filterKey = String(THUMB_FILTER_KEY || buildThumbFilterKey() || "");
  return `${filterKey}|${scope || "__root__"}`;
}
function getCachedThumbTargetId(scope) {
  return PREVIEW_THUMB_TARGET_CACHE.get(thumbTargetCacheKey(scope));
}
function setCachedThumbTargetId(scope, id) {
  PREVIEW_THUMB_TARGET_CACHE.set(thumbTargetCacheKey(scope), id ? String(id) : "");
}
function clearPreviewThumbTargetCache() {
  PREVIEW_THUMB_TARGET_CACHE = new Map();
}

// Fast-nav detection: when navigation events arrive faster than the window
// below, we are in a "burst" and the loader should keep work minimal until the
// user pauses.
const FAST_NAV = {
  _last: 0,
  _settleTimer: 0,
  windowMs: 320,
  active: false,
  // Record a navigation event. Returns true if we are now in a burst.
  mark() {
    const t = navNow();
    const delta = t - this._last;
    this._last = t;
    if (delta < this.windowMs) this.active = true;
    if (this._settleTimer) {
      try { clearTimeout(this._settleTimer); } catch {}
    }
    this._settleTimer = setTimeout(() => {
      this._settleTimer = 0;
      this.active = false;
      onFastNavSettled();
    }, this.windowMs);
    return this.active;
  },
  isActive() {
    return this.active;
  },
};
// Called once a navigation burst ends; fill in the richer, deferred work.
function onFastNavSettled() {
  try { reprioritizeThumbs(); } catch {}
  try { scheduleDeferredPreviewVideoThumbUpgrade(120); } catch {}
  try { prewarmNavigationCorridor(); } catch {}
}
