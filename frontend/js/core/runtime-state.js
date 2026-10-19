/* Runtime state
   Shared runtime state, timers and tuning constants for navigation, thumbnails
   and filters; the default appearance presets. currentThumbWorkerCpuBudget is
   here because a constant below is computed from it at load. */

const MEDIA_FILTER_STATE = {
  mode: "off",
  animatedMode: "on",
};
let MEDIA_OVERLAY_STATE = null;
let MEDIA_FILTER_THUMB_SYNC_TIMER = null;
let THUMB_FILTER_KEY = "";
const DIR_NAV_MANIFESTS = new Map();
const NAV_THUMB_READY_PROMISES = new Map();
let NAVIGATION_PREP_TOKEN = 0;
const HOT_NAV_DIR_PATHS = new Map();
const PINNED_HOT_NAV_DIR_PATHS = new Set();
const PINNED_HOT_NAV_DECODE_CACHE = new Map();
let HOT_NAV_CACHE_TOKEN = 0;
let HOT_NAV_CACHE_TIMER = 0;
const HOT_NAV_MAX_DIRS = 24;
const HOT_NAV_NEARBY_SIBLING_RADIUS = 3;
const HOT_NAV_CHILD_LIMIT = 8;
const HOT_NAV_LARGE_DIR_LIMIT = 16;
const PINNED_HOT_NAV_DECODE_LIMIT = 2400;
const NAVIGATION_PREP_ENTRY_WINDOW = 72;
const NAVIGATION_PREP_DIR_FILE_LIMIT = 18;
const NAVIGATION_PREP_CHILD_LEAD_LIMIT = 24;
const NAVIGATION_PREP_PREVIEW_FILE_LIMIT = 48;
const NAVIGATION_PREP_PREVIEW_CHILD_LIMIT = 16;
let WORKSPACE_NAV_WARM_TOKEN = 0;
let WORKSPACE_NAV_WARM_TIMER = 0;
let DIRECTORIES_VIRTUAL_SCROLL_RAF = 0;
let PREVIEW_VIRTUAL_SCROLL_RAF = 0;
let THUMBNAIL_DEMAND_RAF = 0;
let THUMBNAIL_DEMAND_DEFER_TIMER = 0;
let THUMBNAIL_DEMAND_DEFER_UNTIL = 0;
let THUMBNAIL_INVALIDATION_RAF = 0;
let ACTIVE_PREVIEW_FILE_VIRTUALIZERS = [];
const THUMBNAIL_URL_RECORD_IDS = new Set();
const THUMBNAIL_VIEWPORT_OVERSCAN_MULTIPLIER = 0.85;
const THUMBNAIL_DIRECTORY_WINDOW_LIMIT = 36;
const THUMBNAIL_PREVIEW_WINDOW_LIMIT = 72;
const THUMBNAIL_BACKGROUND_BATCH_LIMIT = 720;
const THUMBNAIL_BACKGROUND_TAG_BATCH_LIMIT = 240;
const THUMBNAIL_BACKGROUND_IDLE_DELAY_MS = 80;
let THUMBNAIL_BACKGROUND_TIMER = 0;

// v9: A small service heartbeat keeps thumbnail work moving even when a
// particular view transition forgets to poke the legacy demand queue. It is
// intentionally conservative: it repairs mounted cards and root pins in
// bounded batches, then lets the existing image/video workers do the heavy
// lifting.
const THUMBNAIL_SERVICE_HEARTBEAT_MS = 350;
const THUMBNAIL_SERVICE_REPAIR_BATCH_LIMIT = 96;
const THUMBNAIL_SERVICE_ROOT_PIN_BATCH_LIMIT = 72;
let THUMBNAIL_SERVICE_HEARTBEAT_TIMER = 0;
let THUMBNAIL_SERVICE_REPAIR_ACTIVE = false;
let THUMBNAIL_SERVICE_LAST_ROOT_PIN_MS = 0;
let THUMBNAIL_SERVICE_LAST_DEMAND_MS = 0;
let THUMBNAIL_SERVICE_ROOT_PIN_CURSOR = 0;

// v10: central responsiveness guard. Selection/open/close in media folders and
// tag/album views should feel immediate, so background thumbnail repair, root
// pin maintenance, warmers, and full preview renders are paced around it instead
// of all trying to run in the same frame.
const RESPONSIVE_NAV_DEFAULT_MS = 700;
const RESPONSIVE_NAV_TAG_ALBUM_MS = 900;
const RESPONSIVE_NAV_MEDIA_MS = 800;
// Selection-driven preview rebuild used to wait 90–150ms in tag/album views;
// that lag was very noticeable when arrowing through folders. Render on the
// next frame instead.
const RESPONSIVE_PREVIEW_TAG_ALBUM_DELAY_MS = 0;
const RESPONSIVE_PREVIEW_FILTERED_TAG_ALBUM_DELAY_MS = 0;
const PREVIEW_VIDEO_THUMB_HEAVY_COUNT = 16;

function currentThumbWorkerCpuBudget() {
  const reported = Number(
    (typeof navigator !== "undefined" &&
      navigator &&
      navigator.hardwareConcurrency) ||
      0,
  );
  const cores = Number.isFinite(reported) && reported > 0 ? reported : 4;
  return Math.max(2, Math.min(12, Math.round(cores)));
}
// How many folder/tag video thumbnails are upgraded to live <video> elements in
// the first synchronous pass (the rest trickle in via the deferred upgrader).
// Scaled to the machine: a flat 6 left capable boxes upgrading video-derived
// folder/tag thumbnails far slower than they could.
const PREVIEW_VIDEO_FOLDER_UPGRADE_LIMIT = Math.max(
  6,
  Math.min(14, currentThumbWorkerCpuBudget() + 2),
);
let PREVIEW_SELECTION_RENDER_TIMER = 0;
let ROOT_PINNED_THUMBNAIL_PRELOAD_TIMER = 0;
let ROOT_PINNED_THUMBNAIL_PRELOAD_ACTIVE = false;

const TAG_ALBUM_DIRECTORY_VIRTUALIZE_THRESHOLD = 160;

const MEDIA_FILTER_CONFIGS = {};

const OVERLAY_SLIDER_LIMITS = Object.freeze({
  hueShift: { min: -180, max: 180, step: 5 },
  saturation: { min: -1, max: 3, step: 0.05 },
  contrast: { min: -0.75, max: 2, step: 0.05 },
  brightness: { min: -0.6, max: 1.5, step: 0.05 },
  warmth: { min: -1, max: 1, step: 0.05 },
  colorCrush: { min: 0, max: 2, step: 0.02 },
  blackCrush: { min: 0, max: 0.8, step: 0.01 },
  whiteCrush: { min: 0, max: 0.8, step: 0.01 },
  halation: { min: 0, max: 1, step: 0.02 },
  ghosting: { min: 0, max: 1, step: 0.02 },
  lineDamage: { min: 0, max: 1, step: 0.02 },
  pixelate: { min: 1, max: 16, step: 0.5 },
  blur: { min: 0, max: 8, step: 0.1 },
  upscaleSmoothing: { min: 0, max: 1, step: 0.02 },
  chroma: { min: 0, max: 8, step: 0.1 },
  grain: { min: 0, max: 0.5, step: 0.01 },
  vignette: { min: 0, max: 0.6, step: 0.01 },
  filmCorner: { min: 0, max: 0.25, step: 0.01 },
});

const APPEARANCE_SLIDER_OPTION_KEYS = Object.freeze([
  "hueShiftOverlayIntensity",
  "saturationOverlayIntensity",
  "contrastOverlayIntensity",
  "brightnessOverlayIntensity",
  "warmthOverlayIntensity",
  "colorCrushOverlayIntensity",
  "blackCrushOverlayIntensity",
  "whiteCrushOverlayIntensity",
  "pixelateOverlayIntensity",
  "blurOverlayIntensity",
  "chromaOverlayIntensity",
  "grainOverlayIntensity",
  "vignetteOverlayIntensity",
  "filmCornerOverlayIntensity",
]);

const BUILTIN_NULL_APPEARANCE_PRESET_ID = "builtin-null";
const PREVIEW_THUMB_PRIORITY_LIMIT = 72;

const DEFAULT_APPEARANCE_PRESETS = Object.freeze([
  Object.freeze({
    id: BUILTIN_NULL_APPEARANCE_PRESET_ID,
    name: "Default",
    locked: true,
    values: Object.freeze({
      hueShiftOverlayIntensity: null,
      saturationOverlayIntensity: null,
      contrastOverlayIntensity: null,
      brightnessOverlayIntensity: null,
      warmthOverlayIntensity: null,
      colorCrushOverlayIntensity: null,
      blackCrushOverlayIntensity: null,
      whiteCrushOverlayIntensity: null,
      halationOverlayIntensity: null,
      ghostingOverlayIntensity: null,
      lineDamageOverlayIntensity: null,
      pixelateOverlayIntensity: null,
      blurOverlayIntensity: null,
      upscaleSmoothingOverlayIntensity: null,
      upscalerOverlayIntensity: null,
      chromaOverlayIntensity: null,
      grainOverlayIntensity: null,
      vignetteOverlayIntensity: null,
      filmCornerOverlayIntensity: null,
    }),
  }),
  Object.freeze({
    id: "preset-mod8x13x-elw7of",
    name: "Basic",
    locked: false,
    values: Object.freeze({
      hueShiftOverlayIntensity: null,
      saturationOverlayIntensity: null,
      contrastOverlayIntensity: null,
      brightnessOverlayIntensity: null,
      warmthOverlayIntensity: null,
      colorCrushOverlayIntensity: null,
      blackCrushOverlayIntensity: null,
      whiteCrushOverlayIntensity: null,
      halationOverlayIntensity: null,
      ghostingOverlayIntensity: null,
      lineDamageOverlayIntensity: null,
      pixelateOverlayIntensity: null,
      blurOverlayIntensity: null,
      upscaleSmoothingOverlayIntensity: 1,
      upscalerOverlayIntensity: null,
      chromaOverlayIntensity: null,
      grainOverlayIntensity: null,
      vignetteOverlayIntensity: null,
      filmCornerOverlayIntensity: 0.01,
    }),
  }),
  Object.freeze({
    id: "preset-mod8nt73-butsgx",
    name: "Film",
    locked: false,
    values: Object.freeze({
      hueShiftOverlayIntensity: 10,
      saturationOverlayIntensity: 0.35,
      contrastOverlayIntensity: null,
      brightnessOverlayIntensity: null,
      warmthOverlayIntensity: 0.1,
      colorCrushOverlayIntensity: null,
      blackCrushOverlayIntensity: null,
      whiteCrushOverlayIntensity: null,
      halationOverlayIntensity: null,
      ghostingOverlayIntensity: null,
      lineDamageOverlayIntensity: null,
      pixelateOverlayIntensity: null,
      blurOverlayIntensity: null,
      upscaleSmoothingOverlayIntensity: 1,
      upscalerOverlayIntensity: null,
      chromaOverlayIntensity: 0.4,
      grainOverlayIntensity: 0.08,
      vignetteOverlayIntensity: null,
      filmCornerOverlayIntensity: null,
    }),
  }),
  Object.freeze({
    id: "preset-mod8auau-n45sw8",
    name: "Tint",
    locked: false,
    values: Object.freeze({
      hueShiftOverlayIntensity: 10,
      saturationOverlayIntensity: 0.35,
      contrastOverlayIntensity: 0.1,
      brightnessOverlayIntensity: null,
      warmthOverlayIntensity: 0.1,
      colorCrushOverlayIntensity: null,
      blackCrushOverlayIntensity: null,
      whiteCrushOverlayIntensity: null,
      halationOverlayIntensity: null,
      ghostingOverlayIntensity: null,
      lineDamageOverlayIntensity: null,
      pixelateOverlayIntensity: null,
      blurOverlayIntensity: null,
      upscaleSmoothingOverlayIntensity: 1,
      upscalerOverlayIntensity: null,
      chromaOverlayIntensity: null,
      grainOverlayIntensity: null,
      vignetteOverlayIntensity: null,
      filmCornerOverlayIntensity: null,
    }),
  }),
  Object.freeze({
    id: "preset-mnrf0djp-dfta2v",
    name: "VHS",
    locked: false,
    values: Object.freeze({
      hueShiftOverlayIntensity: 10,
      saturationOverlayIntensity: 0.35,
      contrastOverlayIntensity: -0.05,
      brightnessOverlayIntensity: null,
      warmthOverlayIntensity: 0.1,
      colorCrushOverlayIntensity: null,
      blackCrushOverlayIntensity: null,
      whiteCrushOverlayIntensity: null,
      halationOverlayIntensity: 0.16,
      ghostingOverlayIntensity: 0.16,
      lineDamageOverlayIntensity: 0.52,
      pixelateOverlayIntensity: null,
      blurOverlayIntensity: 0.4,
      upscaleSmoothingOverlayIntensity: null,
      upscalerOverlayIntensity: null,
      chromaOverlayIntensity: 1.6,
      grainOverlayIntensity: 0.08,
      vignetteOverlayIntensity: 0.07,
      filmCornerOverlayIntensity: null,
    }),
  }),
  Object.freeze({
    id: "preset-mod8ie4f-fsdlub",
    name: "Win95",
    locked: false,
    values: Object.freeze({
      hueShiftOverlayIntensity: null,
      saturationOverlayIntensity: null,
      contrastOverlayIntensity: null,
      brightnessOverlayIntensity: null,
      warmthOverlayIntensity: null,
      colorCrushOverlayIntensity: 0.02,
      blackCrushOverlayIntensity: null,
      whiteCrushOverlayIntensity: null,
      halationOverlayIntensity: null,
      ghostingOverlayIntensity: null,
      lineDamageOverlayIntensity: null,
      pixelateOverlayIntensity: 3.5,
      blurOverlayIntensity: null,
      upscaleSmoothingOverlayIntensity: 1,
      upscalerOverlayIntensity: null,
      chromaOverlayIntensity: null,
      grainOverlayIntensity: null,
      vignetteOverlayIntensity: null,
      filmCornerOverlayIntensity: null,
    }),
  }),
]);
