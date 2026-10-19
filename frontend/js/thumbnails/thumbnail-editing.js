/* Thumbnail editing
   Video frame stepping, viewport nudge/zoom and rotating thumbnails. */

const THUMB_VIEWPORT_NUDGE_STEP_RESTORED = 8;
const THUMB_VIEWPORT_ZOOM_STEP_RESTORED = 0.2;
const VIDEO_THUMB_FRAME_RATE_FALLBACK = 30;
const VIDEO_THUMB_FRAME_REFRESH_INTERVAL_MS = 160;
const VIDEO_THUMB_TIMING_CACHE = new Map();
const VIDEO_THUMB_FRAME_SEEK_STATE = {
  recId: "",
  direction: 0,
  startedAt: 0,
  lastEventAt: 0,
  pendingFrames: 0,
  processing: false,
};
let VIDEO_THUMB_FRAME_REFRESH_TIMER = 0;
let VIDEO_THUMB_FRAME_REFRESH_RECORD = null;
let VIDEO_THUMB_FRAME_LAST_REFRESH_AT = 0;

function videoThumbnailTimingCacheKey(rec) {
  if (!rec) return "";
  return [
    String(rec.id || rec.relPath || ""),
    String(rec.size || 0),
    String(rec.lastModified || 0),
  ].join("@@");
}

function mountedVideoDurationForRecord(rec) {
  if (!rec) return 0;
  if (
    previewVideoEl &&
    String(WS.preview?.fileId || "") === String(rec.id || "")
  ) {
    const duration = Number(previewVideoEl.duration);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  const escapedId =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(String(rec.id || ""))
      : String(rec.id || "").replace(/["\\]/g, "\\$&");
  const mounted = escapedId
    ? document.querySelector(
        `video[data-dir-preview-id="${escapedId}"], video[data-file-id="${escapedId}"]`,
      )
    : null;
  const duration = Number(mounted?.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function probeVideoTimingInBrowser(rec) {
  return new Promise((resolve) => {
    const src = rec ? ensureMediaUrl(rec) || "" : "";
    if (!src) {
      resolve({ duration: 0, frameRate: VIDEO_THUMB_FRAME_RATE_FALLBACK });
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const duration = Number(video.duration);
      try {
        video.removeAttribute("src");
        video.load();
      } catch {}
      resolve({
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        frameRate: VIDEO_THUMB_FRAME_RATE_FALLBACK,
      });
    };
    video.addEventListener("loadedmetadata", finish, { once: true });
    video.addEventListener("error", finish, { once: true });
    timer = setTimeout(finish, 1800);
    try {
      video.src = src;
      video.load();
    } catch {
      finish();
    }
  });
}

async function getVideoThumbnailTiming(rec) {
  const key = videoThumbnailTimingCacheKey(rec);
  if (!key) {
    return { duration: 0, frameRate: VIDEO_THUMB_FRAME_RATE_FALLBACK };
  }
  if (VIDEO_THUMB_TIMING_CACHE.has(key))
    return await VIDEO_THUMB_TIMING_CACHE.get(key);
  const promise = (async () => {
    let duration = mountedVideoDurationForRecord(rec);
    let frameRate = 0;
    const nativePath = nativePathForRecord(rec);
    if (
      nativePath &&
      window.__lg &&
      typeof window.__lg.probeVideoTiming === "function"
    ) {
      try {
        const timing = await window.__lg.probeVideoTiming(nativePath);
        const nativeDuration = Number(timing?.duration);
        const nativeFrameRate = Number(
          timing?.frameRate ?? timing?.frame_rate,
        );
        if (Number.isFinite(nativeDuration) && nativeDuration > 0)
          duration = nativeDuration;
        if (Number.isFinite(nativeFrameRate) && nativeFrameRate > 0)
          frameRate = nativeFrameRate;
      } catch {}
    }
    if (!(duration > 0) || !(frameRate > 0)) {
      const browserTiming = await probeVideoTimingInBrowser(rec);
      if (!(duration > 0) && Number(browserTiming.duration) > 0)
        duration = Number(browserTiming.duration);
      if (!(frameRate > 0) && Number(browserTiming.frameRate) > 0)
        frameRate = Number(browserTiming.frameRate);
    }
    return {
      duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
      frameRate: Number.isFinite(frameRate)
        ? Math.min(480, Math.max(1, frameRate))
        : VIDEO_THUMB_FRAME_RATE_FALLBACK,
    };
  })();
  VIDEO_THUMB_TIMING_CACHE.set(key, promise);
  const timing = await promise;
  VIDEO_THUMB_TIMING_CACHE.set(key, timing);
  return timing;
}

function invalidateVideoThumbnailFrameRecord(rec) {
  if (!rec || rec.type !== "video") return;
  if (rec.videoThumbUrl) {
    try {
      URL.revokeObjectURL(rec.videoThumbUrl);
    } catch {}
  }
  rec.videoThumbUrl = null;
  rec.videoThumbMode = null;
  enqueueVideoThumb(rec);
  videoThumbCacheEnqueue(rec);
}

function flushVideoThumbnailFrameRefresh() {
  VIDEO_THUMB_FRAME_REFRESH_TIMER = 0;
  const rec = VIDEO_THUMB_FRAME_REFRESH_RECORD;
  VIDEO_THUMB_FRAME_REFRESH_RECORD = null;
  if (!rec || rec.type !== "video") return;
  VIDEO_THUMB_FRAME_LAST_REFRESH_AT = performance.now();
  invalidateVideoThumbnailFrameRecord(rec);
  clearPreviewThumbTargetCache();
  renderDirectoriesPane(true);
  // A full-file video preview may be playing; refreshing that pane for a
  // thumbnail-only edit would restart playback on every held-key tick.
  if (WS.preview?.kind === "dir") renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function scheduleVideoThumbnailFrameRefresh(rec, immediate = false) {
  if (!rec || rec.type !== "video") return;
  VIDEO_THUMB_FRAME_REFRESH_RECORD = rec;
  if (VIDEO_THUMB_FRAME_REFRESH_TIMER) return;
  const elapsed = performance.now() - VIDEO_THUMB_FRAME_LAST_REFRESH_AT;
  const delay = immediate
    ? 0
    : Math.max(0, VIDEO_THUMB_FRAME_REFRESH_INTERVAL_MS - elapsed);
  VIDEO_THUMB_FRAME_REFRESH_TIMER = setTimeout(
    flushVideoThumbnailFrameRefresh,
    delay,
  );
}

function videoThumbnailFrameRampCount(heldMs) {
  const rampSeconds = Math.max(0, (Number(heldMs) - 320) / 1000);
  return Math.min(
    72,
    Math.max(1, Math.round(1 + Math.pow(rampSeconds * 1.45, 1.7))),
  );
}

function defaultVideoThumbnailFrameTime(duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  return Math.max(0, Math.min(0.1, safeDuration * 0.02));
}

async function drainVideoThumbnailFrameSeekQueue() {
  const state = VIDEO_THUMB_FRAME_SEEK_STATE;
  if (state.processing) return;
  state.processing = true;
  try {
    while (state.pendingFrames) {
      const recId = String(state.recId || "");
      const rec = recId ? WS.fileById.get(recId) || null : null;
      const frameDelta = state.pendingFrames;
      state.pendingFrames = 0;
      if (!rec || rec.type !== "video") continue;
      const timing = await getVideoThumbnailTiming(rec);
      if (recId !== String(state.recId || "")) continue;
      const frameRate = Math.min(
        480,
        Math.max(1, Number(timing.frameRate) || VIDEO_THUMB_FRAME_RATE_FALLBACK),
      );
      const duration = Math.max(0, Number(timing.duration) || 0);
      const savedTime = metaGetVideoThumbnailTimeForRecord(rec);
      const currentTime = Number.isFinite(savedTime)
        ? savedTime
        : defaultVideoThumbnailFrameTime(duration);
      const currentFrame = Math.max(0, Math.round(currentTime * frameRate));
      const lastFrame = duration > 0
        ? Math.max(0, Math.floor(Math.max(0, duration - 0.05) * frameRate))
        : Number.MAX_SAFE_INTEGER;
      const nextFrame = Math.max(
        0,
        Math.min(lastFrame, currentFrame + frameDelta),
      );
      const nextTime = nextFrame / frameRate;
      const changed = metaSetVideoThumbnailTimeForRecord(
        rec,
        nextTime,
        duration || null,
      );
      if (!changed) continue;
      scheduleVideoThumbnailFrameRefresh(rec, !state.lastEventAt);
      showStatusMessage(
        `Video thumbnail frame: ${formatThumbnailEditorTimeLabel(nextTime)}`,
        "thumbnail-frame",
      );
    }
  } finally {
    state.processing = false;
    if (state.pendingFrames) drainVideoThumbnailFrameSeekQueue();
  }
}

function seekSelectedVideoThumbnailFrame(direction, isRepeat = false) {
  const rec = getSelectedEditableThumbnailSourceRecord();
  if (!rec || rec.type !== "video") return false;
  const state = VIDEO_THUMB_FRAME_SEEK_STATE;
  const nextDirection = direction < 0 ? -1 : 1;
  const now = performance.now();
  const continuesHold = !!(
    isRepeat &&
    state.recId === String(rec.id || "") &&
    state.direction === nextDirection &&
    now - state.lastEventAt < 1000
  );
  if (!continuesHold) {
    state.recId = String(rec.id || "");
    state.direction = nextDirection;
    state.startedAt = now;
    state.pendingFrames = 0;
  }
  const frameCount = isRepeat
    ? videoThumbnailFrameRampCount(now - state.startedAt)
    : 1;
  state.pendingFrames += nextDirection * frameCount;
  state.lastEventAt = now;
  drainVideoThumbnailFrameSeekQueue();
  return true;
}

function resetVideoThumbnailFrameSeekHold() {
  const state = VIDEO_THUMB_FRAME_SEEK_STATE;
  state.direction = 0;
  state.startedAt = 0;
  state.lastEventAt = 0;
}

function resetVideoThumbnailFrameSeekRuntime() {
  resetVideoThumbnailFrameSeekHold();
  VIDEO_THUMB_FRAME_SEEK_STATE.recId = "";
  VIDEO_THUMB_FRAME_SEEK_STATE.pendingFrames = 0;
  VIDEO_THUMB_TIMING_CACHE.clear();
  VIDEO_THUMB_FRAME_REFRESH_RECORD = null;
  if (VIDEO_THUMB_FRAME_REFRESH_TIMER) {
    clearTimeout(VIDEO_THUMB_FRAME_REFRESH_TIMER);
    VIDEO_THUMB_FRAME_REFRESH_TIMER = 0;
  }
}

function nudgeSelectedThumbnailViewport(dx, dy, opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const rec = getSelectedEditableThumbnailSourceRecord();
  if (!rec) {
    if (!options.quietNoTarget)
      showStatusMessage("Selected item has no editable thumbnail source.");
    return false;
  }
  const stepX = Number(dx) || 0;
  const stepY = Number(dy) || 0;
  if (!stepX && !stepY) return false;
  const current = normalizeThumbCropValue(
    metaGetFileThumbnailCropForRecord(rec) || { x: 50, y: 50, zoom: 1 },
  );
  const next = normalizeThumbCropValue({
    x: current.x + stepX,
    y: current.y + stepY,
    zoom: current.zoom,
  });
  if (next.x === current.x && next.y === current.y) return false;
  metaSetFileThumbnailCropForRecord(rec, next);
  refreshThumbnailUiAfterMetadataChange();
  if (!options.quietSuccess) showStatusMessage("Thumbnail viewport updated.");
  return true;
}

function zoomSelectedThumbnailViewport(delta, opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const rec = getSelectedEditableThumbnailSourceRecord();
  if (!rec) {
    if (!options.quietNoTarget)
      showStatusMessage("Selected item has no editable thumbnail source.");
    return false;
  }
  const step = Number(delta) || 0;
  if (!step) return false;
  const current = normalizeThumbCropValue(
    metaGetFileThumbnailCropForRecord(rec) || { x: 50, y: 50, zoom: 1 },
  );
  const next = normalizeThumbCropValue({
    x: current.x,
    y: current.y,
    zoom: Math.round((current.zoom + step) * 100) / 100,
  });
  if (Math.abs(next.zoom - current.zoom) < 0.0001)
    return !!options.consumeAtLimit;
  metaSetFileThumbnailCropForRecord(rec, next);
  refreshThumbnailUiAfterMetadataChange();
  if (!options.quietSuccess)
    showStatusMessage(`Thumbnail zoom: ${next.zoom.toFixed(2)}×.`);
  return true;
}

function rotatePreviewThumbnailsTick() {
  const nodes = Array.from(
    document.querySelectorAll("[data-rotate-key][data-dir-preview-id]"),
  );
  if (!nodes.length) {
    if (ROTATING_PREVIEW_TIMER) {
      clearInterval(ROTATING_PREVIEW_TIMER);
      ROTATING_PREVIEW_TIMER = 0;
    }
    return;
  }
  const activeKeys = new Set();
  const now = Date.now();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const key = String(node && node.dataset && node.dataset.rotateKey || "");
    if (!key) continue;
    activeKeys.add(key);
    const poolIds = ROTATING_PREVIEW_POOLS.get(key) || [];
    if (poolIds.length < 2) continue;
    const nextAt = Number(ROTATING_PREVIEW_NEXT_AT.get(key) || 0);
    if (Number.isFinite(nextAt) && nextAt > now) continue;
    const order = ROTATING_PREVIEW_ORDER.get(key) || poolIds;
    if (!order.length) continue;
    const currentIndex = Number(ROTATING_PREVIEW_INDEX.get(key) || 0);
    const nextIndex = (currentIndex + 1) % order.length;
    ROTATING_PREVIEW_INDEX.set(key, nextIndex);
    ROTATING_PREVIEW_NEXT_AT.set(
      key,
      now + ROTATING_PREVIEW_INTERVAL_MS + Math.round(Math.random() * ROTATING_PREVIEW_JITTER_MS),
    );
    const recId = String(order[nextIndex] || "");
    const rec = WS.fileById.get(recId);
    if (!rec || String(node.dataset.dirPreviewId || "") === recId) continue;
    if (node.tagName && String(node.tagName).toLowerCase() === "video") {
      const img = document.createElement("img");
      img.className = node.className;
      img.setAttribute("data-rotate-key", key);
      if (node.getAttribute("style")) img.setAttribute("style", node.getAttribute("style") || "");
      try { node.replaceWith(img); } catch {}
      crossfadePreviewRecordOnImageElement(img, rec);
    } else {
      crossfadePreviewRecordOnImageElement(node, rec);
    }
  }
  for (const key of Array.from(ROTATING_PREVIEW_POOLS.keys())) {
    if (activeKeys.has(key)) continue;
    ROTATING_PREVIEW_POOLS.delete(key);
    ROTATING_PREVIEW_ORDER.delete(key);
    ROTATING_PREVIEW_INDEX.delete(key);
    ROTATING_PREVIEW_NEXT_AT.delete(key);
  }
}

function entryUsesRotatingThumbnail(entry) {
  if (!entry) return false;
  if (entry.kind === "dir") {
    if (isStorageStubDirNode(entry.node)) return false;
    const lead = getDisplayLeadPreviewForDir(entry.node || null, "dir");
    return !!String(lead && lead.rotateKey || "");
  }
  if (entry.kind === "tag") {
    if (naturalAspectThumbnailCardsEnabled()) return false;
    const key = tagThumbnailKeyForEntry(entry);
    if (!key || !tagThumbnailUsesRotationByKey(key)) return false;
    return (
      getRecursivePreviewRecordsForTagEntry(
        entry,
        tagThumbnailPreviewSampleLimit("rotate"),
      ).length > 1
    );
  }
  return false;
}

function teleportFromRotatingThumbnail(entry, rowEl = null) {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  if (!opt || !opt.clickSelectedRotatingThumbTeleports) return false;
  if (!entryUsesRotatingThumbnail(entry)) return false;
  const row =
    rowEl ||
    (directoriesListEl
      ? directoriesListEl.querySelector(".dirRow.selected")
      : null);
  const img =
    row && row.querySelector
      ? row.querySelector("[data-dir-preview-id]")
      : null;
  const id = String(img && img.getAttribute("data-dir-preview-id") || "");
  const rec = id ? WS.fileById.get(id) : null;
  return rec ? focusDirectoriesOnFileRecord(rec) : false;
}
