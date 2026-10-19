/* Folder thumbnails
   Retired thumbnail-pipeline stubs, then folder preview thumbnails and
   deferred video upgrades. */

async function loadThumbnailRecordForWorkspace() { return true; }
function queueRootPinnedThumbnailWork() { clearQueuedThumbnailWork(); }
async function ensureRootChildWorkspaceThumbnailsLoaded() { return true; }
async function finalizeDirectoryNavigationRenderWithWorkspaceThumbnails(dirNode, opts = null) {
  return finalizeDirectoryNavigationRender(opts);
}
async function warmWorkspaceNavigationThumbsInBackground() { return true; }
function forceThumbnailDemandRefreshNow() { clearQueuedThumbnailWork(); }
function kickVideoThumbsForPreview() { reprioritizeThumbs(); }
function kickImageThumbsForPreview() { reprioritizeThumbs(); }
function enqueueVideoThumb() { return false; }
function enqueueImageThumb() { return false; }
async function drainVideoThumbQueue() { clearQueuedThumbnailWork(); }
async function drainImageThumbQueue() { clearQueuedThumbnailWork(); }
async function generateVideoThumb() { return false; }
async function generateImageThumb() { return false; }
async function materializeNativeImageThumb() { return false; }
async function seekVideoForThumb() { return false; }
function computeVideoThumbSeekTimes() { return []; }
function getPriorityPreviewThumbRecords() { return []; }
function clearVideoThumbRetryState() {}
function reconcileVideoThumbRetryState() {}
function scheduleVideoThumbRetry() { return false; }
function removeVideoThumbIdFromQueue() { return false; }

function folderThumbnailTitlesVisibleForNode() { return false; }
function shouldUseLightweightTagAlbumThumbnailsForNode(dirNode = null) {
  if (!dirNode) return false;
  return isViewingPerformanceSensitiveTagAlbumFolder();
}
function previewPlaceholderThumbnailRecordForDirNode() { return null; }
function previewPlaceholderThumbSrcForRecord() { return ""; }
function preloadPreviewPlaceholderThumbSrc() { return ""; }
function previewPlaceholderThumbnailRecordForEntry() { return null; }
function warmPreviewPlaceholderNeighborThumbs() {}
function previewContainerThumbnailRecordAllowed(rec) {
  return !!(
    rec &&
    (rec.type === "image" || rec.type === "video") &&
    passesFilter(rec)
  );
}

function collectRecursiveMediaPreviewRecordsForContainers(dirNodes, limit = 96) {
  const roots = Array.isArray(dirNodes) ? dirNodes.filter(Boolean) : [];
  const capRaw = Number(limit);
  const cap = Number.isFinite(capRaw) && capRaw > 0 ? Math.floor(capRaw) : 96;
  const out = [];
  const seenDirs = new Set();
  const seenIds = new Set();

  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    if (!root) continue;
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      if (!cur) continue;
      const dirKey = String(cur.path || `__anon_${r}_${q}`);
      if (seenDirs.has(dirKey)) continue;
      seenDirs.add(dirKey);

      const ids = getOrderedFileIdsForDir(cur, false);
      for (let i = 0; i < ids.length; i++) {
        const id = String(ids[i] || "");
        if (!id || seenIds.has(id)) continue;
        const rec = WS.fileById.get(id);
        if (!previewContainerThumbnailRecordAllowed(rec)) continue;
        seenIds.add(id);
        out.push(rec);
        if (out.length >= cap) return out;
      }

      const kids = getChildDirsForNode(cur);
      for (let i = 0; i < kids.length; i++) queue.push(kids[i]);
    }
  }

  return out;
}

function getFirstRecursiveMediaPreviewRecordForContainer(dirNode) {
  if (!dirNode) return null;
  const records = collectRecursiveMediaPreviewRecordsForContainers([dirNode], 1);
  return records[0] || null;
}

function folderPreviewThumbMode() {
  return folderPreviewMediaThumbnailsEnabled() ? "cover" : "off";
}

function folderPreviewThumbUsesContainMode() {
  return false;
}

function getFirstPreviewRecordForDir(dirNode) {
  return getFirstRecursiveMediaPreviewRecordForContainer(dirNode);
}

function replacePreviewVideoThumbImageWithFallback(img, rec) {
  if (!img) return false;
  stopCachedMediaElement(img);
  const fallback = document.createElement("div");
  const isFolderThumb = img.classList && img.classList.contains("folderThumb");
  fallback.className = isFolderThumb
    ? "folderThumb folderThumbFallback"
    : "dirInlinePreview thumbFallback";
  fallback.setAttribute("aria-hidden", "true");
  // Carry over inline style EXCEPT the cover-crop layout (width/height/left/top):
  // a crop only makes sense for media, and applying it to the centered type
  // icon pushes the icon off-center.
  const srcStyle = img.getAttribute("style") || "";
  if (srcStyle) {
    const cleaned = srcStyle
      .replace(/(?:^|;)\s*(?:width|height|left|top)\s*:[^;]*/gi, "")
      .replace(/^;+/, "")
      .trim();
    if (cleaned) fallback.setAttribute("style", cleaned);
  }
  const recId = String(img?.dataset?.dirPreviewId || rec?.id || "");
  if (rec && rec.type === "video" && recId) {
    fallback.classList.add("passiveVideoThumbPending");
    fallback.dataset.passiveVideoId = recId;
    fallback.dataset.dirPreviewId = recId;
  }
  if (img.hasAttribute("data-rotate-key")) {
    fallback.setAttribute(
      "data-rotate-key",
      img.getAttribute("data-rotate-key") || "",
    );
  }
  setAppIcon(fallback, iconKeyForRecordType(rec && rec.type ? rec.type : "video"));
  try {
    img.replaceWith(fallback);
    return true;
  } catch {
    return false;
  }
}

let DEFERRED_PREVIEW_VIDEO_UPGRADE_TIMER = 0;
let DEFERRED_PREVIEW_VIDEO_UPGRADE_TOKEN = 0;

function makePassivePreviewVideoElement(sourceEl, rec, recId, opts = null) {
  const options = opts && typeof opts === "object" ? opts : {};
  const src = getPassivePreviewSrcForRecord(rec, {
    allowImageMediaFallback: true,
  });
  if (!sourceEl || !rec || rec.type !== "video" || !recId || !src) return null;
  const video = document.createElement("video");
  prepareMediaElementForCanvas(video);
  video.className = String(sourceEl.className || "");
  video.classList.remove(
    "folderThumbFallback",
    "thumbFallback",
    "passiveVideoThumbPending",
  );
  if (
    !video.classList.contains("folderThumb") &&
    !video.classList.contains("dirInlinePreview") &&
    !video.classList.contains("thumb")
  ) {
    video.classList.add("thumb");
  }
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  video.controls = false;
  video.draggable = false;
  video.dataset.dirPreviewId = recId;
  if (sourceEl.hasAttribute("data-rotate-key")) {
    video.setAttribute(
      "data-rotate-key",
      sourceEl.getAttribute("data-rotate-key") || "",
    );
  }
  if (sourceEl.getAttribute("style")) {
    video.setAttribute("style", sourceEl.getAttribute("style") || "");
  }
  video.src = src;
  video.addEventListener("loadedmetadata", () => {
    if (
      options.renderToken != null &&
      Number(options.renderToken) !== Number(PREVIEW_FILES_RENDER_TOKEN)
    ) {
      stopCachedMediaElement(video);
      return;
    }
    const duration = Number(video.duration) || 0;
    if (duration > 0) {
      try {
        const customFrameTime = metaGetVideoThumbnailTimeForRecord(rec);
        video.currentTime = Number.isFinite(customFrameTime)
          ? Math.min(Math.max(0, customFrameTime), Math.max(0, duration - 0.05))
          : Math.min(0.1, Math.max(0, duration * 0.02));
      } catch {}
    }
    const w = Number(video.videoWidth) || 0;
    const h = Number(video.videoHeight) || 0;
    if (!(w > 0 && h > 0)) return;
    const card = video.closest(".fitInsideCard");
    const aspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(rec));
    rec.previewAspect = aspect;
    // The crop layout copied from the source <img> was computed before the
    // video's real aspect was known; recompute it now so container video
    // thumbnails stay centered on the chosen crop.
    applyFileThumbCropStyle(video, rec);
    if (card) card.dataset.aspect = String(aspect);
    const grid = video.closest(".fitInsideJustified");
    if (grid) requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
  });
  return video;
}

function replacePassivePreviewVideoFallbackWithVideo(fallback, renderToken = null) {
  const recId = String(
    fallback?.dataset?.passiveVideoId ||
      fallback?.dataset?.dirPreviewId ||
      fallback?.closest?.(".fileCard[data-file-id]")?.dataset?.fileId ||
      "",
  );
  const rec = recId ? WS.fileById.get(recId) || null : null;
  const video = makePassivePreviewVideoElement(fallback, rec, recId, {
    renderToken,
  });
  if (!video) return false;
  try {
    fallback.replaceWith(video);
    return true;
  } catch {
    stopCachedMediaElement(video);
    return false;
  }
}

function deferredPreviewVideoThumbCandidates(container = previewBodyEl) {
  if (!container || !container.querySelectorAll) return [];
  return Array.from(
    container.querySelectorAll(
      ".passiveVideoThumbPending[data-passive-video-id], .thumbFallback[data-passive-video-id], .folderThumbFallback[data-passive-video-id]",
    ),
  ).filter((node) => node && node.isConnected);
}

function scheduleDeferredPreviewVideoThumbUpgrade(delayMs = 180) {
  if (!previewBodyEl) return;
  DEFERRED_PREVIEW_VIDEO_UPGRADE_TOKEN = PREVIEW_FILES_RENDER_TOKEN;
  if (DEFERRED_PREVIEW_VIDEO_UPGRADE_TIMER) {
    clearTimeout(DEFERRED_PREVIEW_VIDEO_UPGRADE_TIMER);
  }
  DEFERRED_PREVIEW_VIDEO_UPGRADE_TIMER = setTimeout(() => {
    DEFERRED_PREVIEW_VIDEO_UPGRADE_TIMER = 0;
    upgradeDeferredPreviewVideoThumbs(DEFERRED_PREVIEW_VIDEO_UPGRADE_TOKEN);
  }, Math.max(40, Number(delayMs) || 180));
}

function upgradeDeferredPreviewVideoThumbs(renderToken = PREVIEW_FILES_RENDER_TOKEN) {
  if (Number(renderToken) !== Number(PREVIEW_FILES_RENDER_TOKEN)) return;
  if (!previewBodyEl || WS.preview.kind !== "dir") return;
  const candidates = deferredPreviewVideoThumbCandidates(previewBodyEl);
  if (!candidates.length) return;
  const near = candidates.filter((node) =>
    elementNearVisibleInContainer(
      previewBodyEl,
      node.closest?.(".fileCard, .folderCard") || node,
      1200,
    ),
  );
  if (!near.length) return;
  const limit = responsiveNavigationGuardActive() ? 2 : 4;
  let upgraded = 0;
  for (let i = 0; i < near.length && upgraded < limit; i++) {
    if (replacePassivePreviewVideoFallbackWithVideo(near[i], renderToken)) {
      upgraded++;
    }
  }
  if (
    deferredPreviewVideoThumbCandidates(previewBodyEl).some((node) =>
      elementNearVisibleInContainer(
        previewBodyEl,
        node.closest?.(".fileCard, .folderCard") || node,
        1200,
      ),
    )
  ) {
    scheduleDeferredPreviewVideoThumbUpgrade(
      responsiveNavigationGuardActive() ? 400 : 150,
    );
  }
}

function upgradeContainerPreviewVideoThumbs(container, opts = null) {
  if (!container || !container.querySelectorAll) return;
  const options = opts && typeof opts === "object" ? opts : {};
  if (
    options.renderToken != null &&
    Number(options.renderToken) !== Number(PREVIEW_FILES_RENDER_TOKEN)
  ) {
    return;
  }
  const thumbs = container.querySelectorAll(
    "img.folderThumb[data-dir-preview-id], img.dirInlinePreview[data-dir-preview-id]",
  );
  const existingVideoCount = container.querySelectorAll(
    "video.folderThumb[data-dir-preview-id], video.dirInlinePreview[data-dir-preview-id]",
  ).length;
  const videoThumbs = [];
  thumbs.forEach((img) => {
    const recId = String(img?.dataset?.dirPreviewId || "");
    const rec = recId ? WS.fileById.get(recId) || null : null;
    if (rec && rec.type === "video") videoThumbs.push({ img, rec, recId });
  });
  const heavyVideoThumbs =
    !!options.passiveWhenHeavy &&
    (existingVideoCount + videoThumbs.length > PREVIEW_VIDEO_FOLDER_UPGRADE_LIMIT ||
      responsiveNavigationGuardActive());
  if (heavyVideoThumbs) {
    for (let i = 0; i < videoThumbs.length; i++) {
      replacePreviewVideoThumbImageWithFallback(
        videoThumbs[i].img,
        videoThumbs[i].rec,
      );
    }
    scheduleDeferredPreviewVideoThumbUpgrade(
      responsiveNavigationGuardActive() ? 600 : 180,
    );
    return;
  }
  const remainingUpgradeSlots = Math.max(
    0,
    PREVIEW_VIDEO_FOLDER_UPGRADE_LIMIT - existingVideoCount,
  );
  for (let i = 0; i < videoThumbs.length; i++) {
    if (i >= remainingUpgradeSlots) {
      replacePreviewVideoThumbImageWithFallback(
        videoThumbs[i].img,
        videoThumbs[i].rec,
      );
      continue;
    }
    if (
      options.renderToken != null &&
      Number(options.renderToken) !== Number(PREVIEW_FILES_RENDER_TOKEN)
    ) {
      return;
    }
    const { img, rec, recId } = videoThumbs[i];
    const video = makePassivePreviewVideoElement(img, rec, recId, {
      renderToken: options.renderToken,
    });
    if (!video) {
      replacePreviewVideoThumbImageWithFallback(img, rec);
      continue;
    }
    img.replaceWith(video);
  }
  if (deferredPreviewVideoThumbCandidates(previewBodyEl).length) {
    scheduleDeferredPreviewVideoThumbUpgrade(260);
  }
}
