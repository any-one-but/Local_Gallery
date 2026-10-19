/* Video thumbnail cache
   The static video-thumbnail cache and releasing thumbnail media. */

// ===== Static video-thumbnail cache (renderer-canvas, Electron only) =====
// Grid video tiles only ever display a single still frame (they never play),
// yet each mounts a full <video>/WebMediaPlayer on the whole file. This module
// caches one JPEG frame per video under .local-gallery/video-thumbs/ and lets
// the grid render a plain <img>, so repeat views cost nothing and the live
// <video> path (and its WebMediaPlayer budget) is avoided. Web (non-Electron)
// mode keeps the live-<video> path. The cached frame honors the user's chosen
// thumbnail frame time; the filename encodes size + frame so an edited frame or
// a replaced file produces a new name (no stale browser caching).
const VIDEO_THUMB_CACHE_DIR = "video-thumbs";
const VIDEO_THUMB_EDGE = 512; // longest edge of the cached frame
const VIDEO_THUMB_JPEG_QUALITY = 0.82;
const VIDEO_THUMB_GEN_CONCURRENCY = 3;
const VIDEO_THUMB_GEN_TIMEOUT_MS = 8000;
const VIDEO_THUMB_WARM_DELAY_MS = 1500;
// Kill-switch for the renderer-canvas video-thumbnail cache. It was added after
// v1.06.54 and is the source of the "opening a tag/album is laggy" reports
// (it decodes a video frame per video folder on demand, plus warms the whole
// library in the background). Turning it OFF falls back to v1.06.54 behavior
// (live <video> thumbnails, no frame generation). Flip to true to re-enable.
const VIDEO_THUMB_CACHE_ENABLED = false;

const VideoThumbCache = {
  ready: false,
  dirHandle: null, // FileSystemDirectoryHandle for the cache dir
  dirAbsPath: "", // absolute fs path of the cache dir (for file:// URLs)
  files: new Set(), // filenames currently present in the cache dir
  generating: new Set(), // record ids mid-generation
  queued: new Set(), // record ids anywhere in a queue
  queueHigh: [], // on-demand: videos in the folder being viewed
  queueLow: [], // background warm: the rest of the library
  active: 0,
  swapTimer: 0,
  warmToken: 0, // bumped on reset to cancel an in-flight warm sweep
  warmTimer: 0,
};

// cyrb53 — stable, low-collision string hash rendered as base36.
function videoThumbHash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(36);
}

function videoThumbPrefixForRecord(rec) {
  const relPath = String(rec?.relPath || rec?.name || "");
  if (!relPath) return "";
  return `vt_${videoThumbHash(relPath)}__`;
}

function videoThumbFileNameForRecord(rec) {
  if (!rec || rec.type !== "video") return "";
  const prefix = videoThumbPrefixForRecord(rec);
  if (!prefix) return "";
  const size = Math.max(0, Number(rec.size) || 0);
  const frameMs = Math.max(
    0,
    Math.round((Number(metaGetVideoThumbnailTimeForRecord(rec)) || 0) * 1000),
  );
  return `${prefix}${size}__${frameMs}.jpg`;
}

// Absolute path of the cache dir, derived once from any record's native path
// (root abs path = record's native path minus its relPath).
function videoThumbCacheDirAbsPath() {
  if (VideoThumbCache.dirAbsPath) return VideoThumbCache.dirAbsPath;
  for (const rec of WS.fileById.values()) {
    const np = String(nativePathForRecord(rec) || "").replace(/\\/g, "/");
    const rel = String(rec.relPath || "");
    if (np && rel && np.endsWith(rel)) {
      const root = np.slice(0, np.length - rel.length).replace(/\/+$/, "");
      if (root) {
        VideoThumbCache.dirAbsPath = `${root}/.local-gallery/${VIDEO_THUMB_CACHE_DIR}`;
        return VideoThumbCache.dirAbsPath;
      }
    }
  }
  return "";
}

function videoThumbCachedUrlForRecord(rec) {
  if (!VIDEO_THUMB_CACHE_ENABLED) return "";
  if (!VideoThumbCache.ready || !rec || rec.type !== "video") return "";
  const name = videoThumbFileNameForRecord(rec);
  if (!name || !VideoThumbCache.files.has(name)) return "";
  const dirAbs = videoThumbCacheDirAbsPath();
  if (!dirAbs) return "";
  return nativePathToFileUrl(`${dirAbs}/${name}`);
}

function resetVideoThumbCacheState() {
  if (VideoThumbCache.swapTimer) {
    try { clearTimeout(VideoThumbCache.swapTimer); } catch {}
  }
  if (VideoThumbCache.warmTimer) {
    try { clearTimeout(VideoThumbCache.warmTimer); } catch {}
  }
  VideoThumbCache.ready = false;
  VideoThumbCache.dirHandle = null;
  VideoThumbCache.dirAbsPath = "";
  VideoThumbCache.files = new Set();
  VideoThumbCache.generating = new Set();
  VideoThumbCache.queued = new Set();
  VideoThumbCache.queueHigh = [];
  VideoThumbCache.queueLow = [];
  VideoThumbCache.active = 0;
  VideoThumbCache.swapTimer = 0;
  VideoThumbCache.warmTimer = 0;
  VideoThumbCache.warmToken++;
}

// Scan the cache dir into the in-memory index on workspace open. Creates the
// dir so generation can write to it. No-op (and stays inactive) off Electron.
async function initVideoThumbCacheForWorkspace(rootHandle) {
  resetVideoThumbCacheState();
  if (!VIDEO_THUMB_CACHE_ENABLED) return;
  if (!getElectronApi() || !rootHandle) return;
  try {
    const sys = await rootHandle.getDirectoryHandle(".local-gallery", {
      create: true,
    });
    const dir = await sys.getDirectoryHandle(VIDEO_THUMB_CACHE_DIR, {
      create: true,
    });
    VideoThumbCache.dirHandle = dir;
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === "file" && name.startsWith("vt_")) {
        VideoThumbCache.files.add(name);
      }
    }
    VideoThumbCache.ready = true;
  } catch {
    resetVideoThumbCacheState();
  }
}

// Decode a single frame of `src` at `frameTime` (seconds) into a JPEG Blob.
function captureVideoFrameBlob(src, frameTime) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    prepareMediaElementForCanvas(v);
    v.muted = true;
    v.defaultMuted = true;
    v.preload = "auto";
    v.playsInline = true;
    let done = false;
    const cleanup = () => {
      try { v.removeAttribute("src"); v.load(); } catch {}
    };
    const finish = (blob) => {
      if (done) return;
      done = true;
      try { clearTimeout(timer); } catch {}
      cleanup();
      resolve(blob || null);
    };
    const timer = setTimeout(() => finish(null), VIDEO_THUMB_GEN_TIMEOUT_MS);
    v.addEventListener("error", () => finish(null));
    v.addEventListener("loadedmetadata", () => {
      const d = Number(v.duration) || 0;
      let t = Number(frameTime);
      t = Number.isFinite(t)
        ? Math.min(Math.max(0, t), Math.max(0, d - 0.05))
        : Math.min(0.1, Math.max(0, d * 0.02));
      try { v.currentTime = t; } catch { finish(null); }
    });
    v.addEventListener("seeked", () => {
      if (done) return;
      const vw = Number(v.videoWidth) || 0;
      const vh = Number(v.videoHeight) || 0;
      if (!(vw > 0 && vh > 0)) return finish(null);
      const scale = Math.min(1, VIDEO_THUMB_EDGE / Math.max(vw, vh));
      const cw = Math.max(1, Math.round(vw * scale));
      const ch = Math.max(1, Math.round(vh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return finish(null);
      try { ctx.drawImage(v, 0, 0, cw, ch); } catch { return finish(null); }
      try {
        canvas.toBlob((blob) => finish(blob), "image/jpeg", VIDEO_THUMB_JPEG_QUALITY);
      } catch {
        finish(null);
      }
    });
    try { v.src = src; v.load(); } catch { finish(null); }
  });
}

// Remove older cached variants for the same video (different size/frame).
async function videoThumbDeleteStaleVariants(rec, keepName) {
  const prefix = videoThumbPrefixForRecord(rec);
  if (!prefix || !VideoThumbCache.dirHandle) return;
  const stale = [];
  for (const name of VideoThumbCache.files) {
    if (name !== keepName && name.startsWith(prefix)) stale.push(name);
  }
  for (let i = 0; i < stale.length; i++) {
    try { await VideoThumbCache.dirHandle.removeEntry(stale[i]); } catch {}
    VideoThumbCache.files.delete(stale[i]);
  }
}

async function videoThumbCacheGenerate(rec) {
  if (!VideoThumbCache.ready || !VideoThumbCache.dirHandle || !rec) return;
  const name = videoThumbFileNameForRecord(rec);
  if (!name || VideoThumbCache.files.has(name)) return;
  if (!rec.file && typeof ensureFileObjectForRecord === "function") {
    try { await ensureFileObjectForRecord(rec); } catch {}
  }
  // Capture from a blob: URL of the File rather than the file:// media URL.
  // A blob is same-origin, so the canvas is never tainted and toBlob() works
  // regardless of Electron's webSecurity setting (file:// would taint it).
  let blobUrl = "";
  try {
    if (rec.file) blobUrl = URL.createObjectURL(rec.file);
  } catch {}
  const src = blobUrl || ensureMediaUrl(rec);
  if (!src) return;
  let blob = null;
  try {
    blob = await captureVideoFrameBlob(
      src,
      metaGetVideoThumbnailTimeForRecord(rec),
    );
  } finally {
    if (blobUrl) {
      try { URL.revokeObjectURL(blobUrl); } catch {}
    }
  }
  if (!blob) return;
  try {
    const fh = await VideoThumbCache.dirHandle.getFileHandle(name, {
      create: true,
    });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch {
    return;
  }
  VideoThumbCache.files.add(name);
  await videoThumbDeleteStaleVariants(rec, name);
  // Only re-render if this video is in the folder currently on screen, so the
  // background warm sweep doesn't thrash the UI with off-screen completions.
  const previewDirPath = String(WS.preview?.dirNode?.path || "");
  if (String(rec.dirPath || "") === previewDirPath) scheduleVideoThumbSwapRefresh();
}

function videoThumbCachePump() {
  while (
    VideoThumbCache.active < VIDEO_THUMB_GEN_CONCURRENCY &&
    (VideoThumbCache.queueHigh.length || VideoThumbCache.queueLow.length)
  ) {
    const id = VideoThumbCache.queueHigh.length
      ? VideoThumbCache.queueHigh.shift()
      : VideoThumbCache.queueLow.shift();
    VideoThumbCache.queued.delete(id);
    const rec = WS.fileById.get(id);
    if (!rec || rec.type !== "video") continue;
    if (videoThumbCachedUrlForRecord(rec)) continue;
    VideoThumbCache.active++;
    VideoThumbCache.generating.add(id);
    Promise.resolve()
      .then(() => videoThumbCacheGenerate(rec))
      .catch(() => {})
      .then(() => {
        VideoThumbCache.generating.delete(id);
        VideoThumbCache.active = Math.max(0, VideoThumbCache.active - 1);
        videoThumbCachePump();
      });
  }
}

// Queue a frame capture for a video whose thumbnail isn't cached yet. The grid
// render path calls this (high priority) for videos actually on screen; the
// background warm sweep calls it with { warm: true } (low priority).
function videoThumbCacheEnqueue(rec, opts = null) {
  if (!VIDEO_THUMB_CACHE_ENABLED) return;
  if (!VideoThumbCache.ready || !VideoThumbCache.dirHandle) return;
  if (!rec || rec.type !== "video") return;
  const id = String(rec.id || "");
  if (!id || VideoThumbCache.generating.has(id)) return;
  if (videoThumbCachedUrlForRecord(rec)) return;
  const warm = !!(opts && opts.warm);
  if (VideoThumbCache.queued.has(id)) {
    // Already queued: if an on-demand request arrives for something the warm
    // sweep parked in the low queue, promote it to the front of the high queue.
    if (!warm) {
      const i = VideoThumbCache.queueLow.indexOf(id);
      if (i !== -1) {
        VideoThumbCache.queueLow.splice(i, 1);
        VideoThumbCache.queueHigh.push(id);
        videoThumbCachePump();
      }
    }
    return;
  }
  VideoThumbCache.queued.add(id);
  (warm ? VideoThumbCache.queueLow : VideoThumbCache.queueHigh).push(id);
  videoThumbCachePump();
}

// Background sweep: queue every not-yet-cached video in the library at low
// priority so the whole library warms over time without competing with the
// folder you're actively viewing. Cancelled by resetVideoThumbCacheState.
function startVideoThumbWarm() {
  if (!VIDEO_THUMB_CACHE_ENABLED) return;
  if (!VideoThumbCache.ready || !VideoThumbCache.dirHandle) return;
  if (VideoThumbCache.warmTimer) {
    try { clearTimeout(VideoThumbCache.warmTimer); } catch {}
  }
  const token = VideoThumbCache.warmToken;
  VideoThumbCache.warmTimer = setTimeout(() => {
    VideoThumbCache.warmTimer = 0;
    if (token !== VideoThumbCache.warmToken || !VideoThumbCache.ready) return;
    for (const rec of WS.fileById.values()) {
      if (token !== VideoThumbCache.warmToken) return;
      if (rec && rec.type === "video") videoThumbCacheEnqueue(rec, { warm: true });
    }
  }, VIDEO_THUMB_WARM_DELAY_MS);
}

// Coalesced re-render so freshly-cached tiles swap from live <video> to <img>.
function scheduleVideoThumbSwapRefresh() {
  if (VideoThumbCache.swapTimer) return;
  VideoThumbCache.swapTimer = setTimeout(() => {
    VideoThumbCache.swapTimer = 0;
    try {
      if (WS.root) renderPreviewPane(false, true);
    } catch {}
  }, 600);
}

function collectMainMediaRecordIds() {
  const out = new Set();
  const add = (id) => {
    const value = String(id || "");
    if (value) out.add(value);
  };
  add(WS.preview && WS.preview.kind === "file" ? WS.preview.fileId : "");
  try {
    const item = Array.isArray(viewerItems) ? viewerItems[viewerIndex] : null;
    if (item && !item.isFolder) add(item.id);
  } catch {}
  try {
    if (QUAD_PLAYBACK && Array.isArray(QUAD_PLAYBACK.slots)) {
      for (let i = 0; i < QUAD_PLAYBACK.slots.length; i++)
        add(QUAD_PLAYBACK.slots[i]?.fileId || "");
    }
  } catch {}
  return out;
}

function collectRenderedThumbnailRecordIds() {
  const out = new Set();
  const add = (id) => {
    const value = String(id || "");
    if (value) out.add(value);
  };
  const roots = [directoriesListEl, previewBodyEl].filter(Boolean);
  for (let i = 0; i < roots.length; i++) {
    const nodes = roots[i].querySelectorAll(
      "[data-dir-preview-id], [data-file-id]",
    );
    for (let j = 0; j < nodes.length; j++) {
      add(nodes[j]?.dataset?.dirPreviewId || nodes[j]?.dataset?.fileId || "");
    }
  }
  return out;
}

function clearPreloadMediaCache() {
  let count = 0;
  try {
    if (PRELOAD_CACHE instanceof Map) {
      for (const value of PRELOAD_CACHE.values()) {
        if (stopCachedMediaElement(value)) count++;
      }
      count += PRELOAD_CACHE.size;
      PRELOAD_CACHE.clear();
    }
  } catch {}
  try {
    if (PINNED_HOT_NAV_DECODE_CACHE instanceof Map) {
      count += PINNED_HOT_NAV_DECODE_CACHE.size;
      PINNED_HOT_NAV_DECODE_CACHE.clear();
    }
  } catch {}
  try {
    if (PREVIEW_PLACEHOLDER_PRELOAD_CACHE instanceof Map) {
      count += PREVIEW_PLACEHOLDER_PRELOAD_CACHE.size;
      PREVIEW_PLACEHOLDER_PRELOAD_CACHE.clear();
    }
  } catch {}
  return count;
}

function detachRenderedThumbnailMedia(protectedIds) {
  const protectedSet = protectedIds instanceof Set ? protectedIds : new Set();
  let count = 0;
  const roots = [directoriesListEl, previewBodyEl].filter(Boolean);
  for (let i = 0; i < roots.length; i++) {
    const nodes = roots[i].querySelectorAll(
      "img[data-dir-preview-id], video[data-dir-preview-id], .fileCard[data-file-id] img.thumb, .fileCard[data-file-id] video.thumb",
    );
    for (let j = 0; j < nodes.length; j++) {
      const node = nodes[j];
      const card = node.closest ? node.closest("[data-file-id]") : null;
      const id = String(
        node?.dataset?.dirPreviewId ||
          node?.dataset?.fileId ||
          card?.dataset?.fileId ||
          "",
      );
      if (id && protectedSet.has(id)) continue;
      if (stopCachedMediaElement(node)) count++;
    }
  }
  return count;
}

function releaseLoadedThumbnailMedia(opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const includeRendered = !!options.includeRendered;
  const preservePreloads = !!options.preservePreloads;
  const protectedIds = collectMainMediaRecordIds();
  if (!includeRendered) {
    collectRenderedThumbnailRecordIds().forEach((id) => protectedIds.add(id));
  }
  const result = {
    revokedThumbnailUrls: 0,
    revokedMediaUrls: 0,
    droppedFileObjects: 0,
    clearedPreloadItems: 0,
    detachedRenderedMedia: 0,
  };

  clearQueuedThumbnailWork();
  bumpThumbnailDemandToken();
  // Full-resolution preview blobs are whole image files kept in RAM; the LRU
  // caps them, but a release pass should also let go of the ones that are only
  // still there because the cap has not been reached yet.
  releaseAllPreviewFullResBlobs(protectedIds);
  if (!preservePreloads)
    result.clearedPreloadItems = clearPreloadMediaCache();
  if (includeRendered) {
    result.detachedRenderedMedia = detachRenderedThumbnailMedia(protectedIds);
  }

  try {
    PREVIEW_FILE_OBJECT_PROMISES.clear();
    PREVIEW_FILE_OBJECT_WARM_TOKEN++;
    if (PREVIEW_FILE_OBJECT_WARM_TIMER) {
      clearTimeout(PREVIEW_FILE_OBJECT_WARM_TIMER);
      PREVIEW_FILE_OBJECT_WARM_TIMER = 0;
    }
  } catch {}
  try {
    if (HOT_NAV_CACHE_TIMER) {
      clearTimeout(HOT_NAV_CACHE_TIMER);
      HOT_NAV_CACHE_TIMER = 0;
    }
    HOT_NAV_CACHE_TOKEN++;
    HOT_NAV_DIR_PATHS.clear();
    PINNED_HOT_NAV_DIR_PATHS.clear();
  } catch {}

  try {
    const records = Array.isArray(WS.files) ? WS.files : [];
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      if (!rec) continue;
      const id = String(rec.id || "");
      if (rec.thumbUrl) {
        try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
        rec.thumbUrl = null;
        result.revokedThumbnailUrls++;
      }
      if (rec.videoThumbUrl) {
        try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
        rec.videoThumbUrl = null;
        result.revokedThumbnailUrls++;
      }
      rec.thumbMode = "placeholder";
      rec.videoThumbMode = "placeholder";
      const url = String(rec.url || "");
      const isBlobUrl = rec.urlKind === "blob" || url.startsWith("blob:");
      const isWarmPreload =
        preservePreloads && PRELOAD_CACHE instanceof Map && PRELOAD_CACHE.has(url);
      if (url && isBlobUrl && !protectedIds.has(id) && !isWarmPreload) {
        try { URL.revokeObjectURL(url); } catch {}
        rec.url = null;
        rec.urlKind = "";
        result.revokedMediaUrls++;
        if (WS.meta && WS.meta.fsRootHandle && rec.file) {
          rec.file = null;
          result.droppedFileObjects++;
        }
      }
    }
  } catch {}
  return result;
}

function scheduleLoadedThumbnailMediaRelease(delayMs = 900) {
  if (LOADED_THUMB_RELEASE_TIMER) {
    try { clearTimeout(LOADED_THUMB_RELEASE_TIMER); } catch {}
  }
  LOADED_THUMB_RELEASE_TIMER = setTimeout(() => {
    LOADED_THUMB_RELEASE_TIMER = 0;
    // Adjacent preview players are intentional decode-ahead state, not stale
    // thumbnail media. Keep them warm across the routine cleanup pass; explicit
    // memory-pressure/reset paths still clear the cache.
    releaseLoadedThumbnailMedia({
      includeRendered: false,
      preservePreloads: true,
    });
  }, Math.max(100, Number(delayMs) || 900));
}

function releaseColdNavigationThumbs() {
  return releaseLoadedThumbnailMedia({ includeRendered: false });
}
