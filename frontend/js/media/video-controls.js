/* Video controls
   Audio modes, the control pane and responsive seeking. */

function normalizeVideoAudioModeValue(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  return raw === "muted" ? "muted" : "unmuted";
}

function previewVideoMode() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return opt ? normalizeVideoAudioModeValue(opt.videoAudio) : "unmuted";
}

function galleryVideoMode() {
  return previewVideoMode();
}

function applyDefaultVideoAudioModeToActiveVideos(mode = previewVideoMode()) {
  const muted = normalizeVideoAudioModeValue(mode) === "muted";
  if (previewVideoEl && previewVideoEl.style.display !== "none") {
    previewVideoEl.muted = muted || BANIC_ACTIVE || VIEWER_MODE;
  }
  if (viewerVideoEl && viewerVideoEl.style.display !== "none") {
    viewerVideoEl.muted = muted || BANIC_ACTIVE;
  }
  if (QUAD_PLAYBACK && QUAD_PLAYBACK.active) {
    QUAD_PLAYBACK.muted = muted;
    applyQuadPlaybackAudioState();
  }
  syncControlPaneState();
}

function setDefaultVideoAudioMode(mode, options = {}) {
  if (!WS.meta) return false;
  const next = normalizeVideoAudioModeValue(mode);
  if (previewVideoMode() !== next) setOptionValue("videoAudio", next);
  applyDefaultVideoAudioModeToActiveVideos(next);
  refreshLiveSettingsPaneFromKeyboardAction();
  if (!options.quiet) {
    showStatusMessage(
      `Video audio: ${next === "muted" ? "Muted" : "Unmuted"}`,
      "playback",
    );
  }
  return true;
}

function toggleDefaultVideoAudioMode() {
  return setDefaultVideoAudioMode(
    previewVideoMode() === "muted" ? "unmuted" : "muted",
  );
}

function normalizePreviewVideoPauseLockId(fileId) {
  const id = String(fileId || "");
  return id || null;
}

function setPreviewVideoUserPauseLock(fileId, locked) {
  PREVIEW_VIDEO_USER_PAUSE_FILE_ID = locked
    ? normalizePreviewVideoPauseLockId(fileId)
    : null;
}

function previewVideoUserPausedFor(fileId) {
  const id = normalizePreviewVideoPauseLockId(fileId);
  return !!id && PREVIEW_VIDEO_USER_PAUSE_FILE_ID === id;
}

function syncPreviewVideoUserPauseLockToItem(fileId) {
  const id = normalizePreviewVideoPauseLockId(fileId);
  if (PREVIEW_VIDEO_USER_PAUSE_FILE_ID && PREVIEW_VIDEO_USER_PAUSE_FILE_ID !== id)
    PREVIEW_VIDEO_USER_PAUSE_FILE_ID = null;
}

function videoSkipStepSeconds() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const raw = opt ? String(opt.videoSkipStep || "10") : "10";
  const v = parseInt(raw, 10);
  return Number.isFinite(v) ? v : 10;
}

function videoEndBehavior() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return opt ? String(opt.videoEndBehavior || "loop") : "loop";
}

function formatControlPaneTime(seconds) {
  const raw = Number(seconds);
  if (!Number.isFinite(raw) || raw < 0) return "00:00";
  const total = Math.floor(raw);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${String(h).padStart(2, "0")}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function getControlPaneVideo() {
  if (!previewVideoEl) return null;
  if (previewVideoEl.style.display === "none") return null;
  if (!WS.preview || WS.preview.kind !== "file" || !WS.preview.fileId)
    return null;
  const rec = WS.fileById.get(String(WS.preview.fileId || ""));
  if (!rec || rec.type !== "video") return null;
  return previewVideoEl;
}

function controlPaneHasNavigablePreviewItem() {
  return !!(
    WS.preview &&
    WS.preview.kind === "file" &&
    WS.preview.fileId &&
    Array.isArray(viewerItems) &&
    viewerItems.length
  );
}

function getFloatingControlPaneBounds() {
  const host = previewMainStackEl || controlPane?.parentElement || previewPane;
  const bounds = previewViewportBox || previewBodyEl || host;
  if (!host || !bounds || !host.getBoundingClientRect || !bounds.getBoundingClientRect)
    return null;
  const hostRect = host.getBoundingClientRect();
  const boundsRect = bounds.getBoundingClientRect();
  if (!hostRect.width || !hostRect.height || !boundsRect.width || !boundsRect.height)
    return null;
  return { hostRect, boundsRect };
}

function setFloatingControlPaneVisible(visible) {
  if (!controlPane) return;
  controlPane.classList.toggle("control-floating-visible", !!visible);
}

function clearFloatingControlPaneHideTimer() {
  if (!CONTROL_PANE_HIDE_TIMER) return;
  clearTimeout(CONTROL_PANE_HIDE_TIMER);
  CONTROL_PANE_HIDE_TIMER = 0;
}

function scheduleFloatingControlPaneHide() {
  if (!controlPane || !controlPane.classList.contains("control-floating-active"))
    return;
  clearFloatingControlPaneHideTimer();
  CONTROL_PANE_HIDE_TIMER = setTimeout(() => {
    CONTROL_PANE_HIDE_TIMER = 0;
    if (CONTROL_PANE_DRAGGING || CONTROL_PANE_HOVER || CONTROL_PROGRESS_DRAGGING) {
      scheduleFloatingControlPaneHide();
      return;
    }
    setFloatingControlPaneVisible(false);
  }, CONTROL_PANE_AUTO_HIDE_MS);
}

function showFloatingControlPane(temporary = true) {
  if (!controlPane || !controlPane.classList.contains("control-floating-active"))
    return;
  setFloatingControlPaneVisible(true);
  if (temporary) scheduleFloatingControlPaneHide();
}

function applyFloatingControlPanePosition() {
  if (!controlPane || !controlPane.classList.contains("control-floating-active"))
    return;
  const geometry = getFloatingControlPaneBounds();
  if (!geometry) return;
  const { hostRect, boundsRect } = geometry;
  const paneRect = controlPane.getBoundingClientRect();
  const paneWidth = paneRect.width || 0;
  const paneHeight = paneRect.height || 0;
  const minLeft = Math.max(0, boundsRect.left - hostRect.left + 8);
  const minTop = Math.max(0, boundsRect.top - hostRect.top + 8);
  const maxLeft = Math.max(minLeft, boundsRect.right - hostRect.left - paneWidth - 8);
  const maxTop = Math.max(minTop, boundsRect.bottom - hostRect.top - paneHeight - 8);

  if (!CONTROL_PANE_SESSION_POSITION) {
    controlPane.style.left = "50%";
    controlPane.style.top = "";
    controlPane.style.bottom = "18px";
    controlPane.style.transform = "translateX(-50%)";
    return;
  }

  const leftRange = Math.max(1, maxLeft - minLeft);
  const topRange = Math.max(1, maxTop - minTop);
  const left = Math.min(
    maxLeft,
    Math.max(minLeft, minLeft + leftRange * CONTROL_PANE_SESSION_POSITION.x),
  );
  const top = Math.min(
    maxTop,
    Math.max(minTop, minTop + topRange * CONTROL_PANE_SESSION_POSITION.y),
  );
  controlPane.style.left = `${left}px`;
  controlPane.style.top = `${top}px`;
  controlPane.style.bottom = "auto";
  controlPane.style.transform = "none";
}

function storeFloatingControlPanePosition(left, top) {
  const geometry = getFloatingControlPaneBounds();
  if (!geometry || !controlPane) return;
  const { hostRect, boundsRect } = geometry;
  const paneRect = controlPane.getBoundingClientRect();
  const paneWidth = paneRect.width || 0;
  const paneHeight = paneRect.height || 0;
  const minLeft = Math.max(0, boundsRect.left - hostRect.left + 8);
  const minTop = Math.max(0, boundsRect.top - hostRect.top + 8);
  const maxLeft = Math.max(minLeft, boundsRect.right - hostRect.left - paneWidth - 8);
  const maxTop = Math.max(minTop, boundsRect.bottom - hostRect.top - paneHeight - 8);
  const clampedLeft = Math.min(maxLeft, Math.max(minLeft, left));
  const clampedTop = Math.min(maxTop, Math.max(minTop, top));
  CONTROL_PANE_SESSION_POSITION = {
    x: maxLeft === minLeft ? 0 : (clampedLeft - minLeft) / (maxLeft - minLeft),
    y: maxTop === minTop ? 0 : (clampedTop - minTop) / (maxTop - minTop),
  };
  controlPane.style.left = `${clampedLeft}px`;
  controlPane.style.top = `${clampedTop}px`;
  controlPane.style.bottom = "auto";
  controlPane.style.transform = "none";
}

function syncFloatingControlPaneAvailability(hasVideo) {
  if (!controlPane) return;
  const active = !!hasVideo;
  const activeKey =
    active && WS.preview && WS.preview.fileId ? String(WS.preview.fileId || "") : "";
  const activeItemChanged = CONTROL_PANE_ACTIVE_KEY !== activeKey;
  controlPane.classList.toggle("control-floating-active", active);
  if (!active) {
    CONTROL_PANE_ACTIVE_KEY = "";
    clearFloatingControlPaneHideTimer();
    setFloatingControlPaneVisible(false);
    return;
  }
  applyFloatingControlPanePosition();
  if (activeItemChanged) {
    CONTROL_PANE_ACTIVE_KEY = activeKey;
    clearFloatingControlPaneHideTimer();
    setFloatingControlPaneVisible(false);
  }
}

function setControlButtonDisabled(button, disabled) {
  if (button) button.disabled = !!disabled;
}

function syncControlPaneState() {
  const video = getControlPaneVideo();
  const hasVideo = !!video;
  const hasDuration = !!(
    video &&
    Number.isFinite(Number(video.duration)) &&
    Number(video.duration) > 0
  );
  const duration = hasDuration ? Math.max(0, Number(video.duration) || 0) : 0;
  const seekState = video ? RESPONSIVE_VIDEO_SEEK_STATES.get(video) : null;
  const preparedTarget = Number(seekState?.preparedSeek?.target);
  const current =
    hasDuration && Number.isFinite(preparedTarget)
      ? Math.max(0, Math.min(duration, preparedTarget))
      : video
        ? Math.max(0, Number(video.currentTime) || 0)
        : 0;
  const canNavigate = controlPaneHasNavigablePreviewItem();

  syncFloatingControlPaneAvailability(hasVideo);
  if (controlPane)
    controlPane.classList.toggle("control-disabled", !hasVideo && !WS.meta);
  setControlButtonDisabled(controlPrevItemBtn, !canNavigate);
  setControlButtonDisabled(controlNextItemBtn, !canNavigate);
  setControlButtonDisabled(controlSkipBackBtn, !hasDuration);
  setControlButtonDisabled(controlSkipForwardBtn, !hasDuration);
  setControlButtonDisabled(controlPlayPauseBtn, !hasVideo);
  setControlButtonDisabled(controlMuteBtn, !WS.meta);

  if (controlPlayPauseBtn) {
    const paused = !video || video.paused;
    controlPlayPauseBtn.classList.remove("active");
    controlPlayPauseBtn.classList.toggle("is-playing", hasVideo && !paused);
    setMediaControlIconButton(controlPlayPauseBtn, paused ? "play" : "pause");
    const label = paused ? "Play" : "Pause";
    controlPlayPauseBtn.setAttribute("aria-label", label);
    controlPlayPauseBtn.title = label;
  }
  if (controlMuteBtn) {
    const muted = previewVideoMode() === "muted";
    controlMuteBtn.classList.remove("active");
    controlMuteBtn.classList.toggle("is-muted", muted);
    setMediaControlIconButton(controlMuteBtn, muted ? "volumeOff" : "volumeOn");
    const label = muted ? "Video audio: muted" : "Video audio: unmuted";
    controlMuteBtn.setAttribute("aria-label", label);
    controlMuteBtn.title = label;
  }
  if (controlSkipBackBtn) {
    const seconds = videoSkipStepSeconds();
    setMediaControlIconButton(controlSkipBackBtn, "rewind");
    controlSkipBackBtn.setAttribute("aria-label", `Skip back ${seconds} seconds`);
    controlSkipBackBtn.title = `Skip back ${seconds} seconds`;
  }
  if (controlSkipForwardBtn) {
    const seconds = videoSkipStepSeconds();
    setMediaControlIconButton(controlSkipForwardBtn, "fastForward");
    controlSkipForwardBtn.setAttribute("aria-label", `Skip forward ${seconds} seconds`);
    controlSkipForwardBtn.title = `Skip forward ${seconds} seconds`;
  }
  if (controlProgressRange) {
    controlProgressRange.disabled = !hasDuration;
    controlProgressRange.max = String(duration || 0);
    if (!CONTROL_PROGRESS_DRAGGING) {
      controlProgressRange.value = String(Math.min(current, duration || current));
    }
    const value = Number(controlProgressRange.value) || 0;
    const pct = hasDuration ? Math.max(0, Math.min(100, (value / duration) * 100)) : 0;
    controlProgressRange.style.setProperty("--control-progress-pct", `${pct.toFixed(3)}%`);
  }
  if (controlTimecode) {
    controlTimecode.textContent = `${formatControlPaneTime(current)} / ${formatControlPaneTime(duration)}`;
  }
}

function clearResponsiveVideoSeekWatchdog(state) {
  if (!state || !state.watchdog) return;
  clearTimeout(state.watchdog);
  state.watchdog = 0;
}

function playAfterResponsiveVideoSeek(video, state) {
  if (!video || !state || !state.resumeAfterSeek || video.ended) return;
  try {
    const promise = video.play();
    if (promise && typeof promise.catch === "function") promise.catch(() => {});
  } catch {}
}

function settleResponsiveVideoSeek(video, state) {
  if (!video || !state || !state.inFlight) return;
  clearResponsiveVideoSeekWatchdog(state);
  state.inFlight = false;
  state.activeTarget = null;
  state.activeFast = null;
  try { MediaFilterEngine.requestRender(); } catch {}
  if (state.pending) {
    applyPendingResponsiveVideoSeek(video, state);
    return;
  }
  playAfterResponsiveVideoSeek(video, state);
  state.resumeAfterSeek = false;
  syncControlPaneState();
}

function getResponsiveVideoSeekState(video) {
  if (!video) return null;
  let state = RESPONSIVE_VIDEO_SEEK_STATES.get(video);
  if (state) return state;
  state = {
    pending: null,
    inFlight: false,
    activeTarget: null,
    activeFast: null,
    resumeAfterSeek: false,
    watchdog: 0,
    token: 0,
    preparedSeek: null,
  };
  RESPONSIVE_VIDEO_SEEK_STATES.set(video, state);
  video.addEventListener("seeked", () => {
    settleResponsiveVideoSeek(video, state);
  });
  video.addEventListener("emptied", () => {
    cancelResponsiveVideoSeek(video);
  });
  return state;
}

function cancelResponsiveVideoSeek(video) {
  const state = video ? RESPONSIVE_VIDEO_SEEK_STATES.get(video) : null;
  if (!state) return;
  disposePreparedVideoSeek(state);
  clearResponsiveVideoSeekWatchdog(state);
  state.pending = null;
  state.inFlight = false;
  state.activeTarget = null;
  state.activeFast = null;
  state.resumeAfterSeek = false;
  state.token++;
}

function videoTimeIsBuffered(video, time, margin = 0.2) {
  const ranges = video?.buffered;
  if (!ranges) return false;
  const target = Number(time);
  if (!Number.isFinite(target)) return false;
  for (let i = 0; i < ranges.length; i++) {
    try {
      if (target >= ranges.start(i) - margin && target <= ranges.end(i) + margin)
        return true;
    } catch {}
  }
  return false;
}

function disposePreparedVideoSeek(state, preserveElement = false) {
  const job = state?.preparedSeek || null;
  if (!job) return;
  state.preparedSeek = null;
  if (job.commitTimer) clearTimeout(job.commitTimer);
  job.commitTimer = 0;
  const el = job.el;
  if (!el) return;
  el.onloadedmetadata = null;
  el.onseeked = null;
  el.onerror = null;
  if (preserveElement) return;
  try { el.pause(); } catch {}
  try {
    el.removeAttribute("src");
    el.load();
  } catch {}
  try { el.remove(); } catch {}
}

function preparedVideoSeekSurface(video) {
  if (video && video === previewVideoEl && !VIEWER_MODE) return "preview";
  if (
    video &&
    video === viewerVideoEl &&
    VIEWER_MODE &&
    !isQuadPlaybackMode()
  )
    return "viewer";
  return "";
}

function preparedVideoSeekFileId(video, surface) {
  if (surface === "preview")
    return String(video?.dataset?.previewFileId || WS.preview?.fileId || "");
  if (surface === "viewer") {
    const item = viewerItems[viewerIndex] || null;
    return item && !item.isFolder ? String(item.id || "") : "";
  }
  return "";
}

function preparedVideoSeekIsCurrent(video, job) {
  if (!video || !job) return false;
  if (job.surface === "preview") {
    return (
      video === previewVideoEl &&
      !VIEWER_MODE &&
      String(WS.preview?.fileId || "") === job.fileId &&
      String(video.dataset.previewFileId || "") === job.fileId
    );
  }
  if (job.surface === "viewer") {
    const item = viewerItems[viewerIndex] || null;
    return !!(
      video === viewerVideoEl &&
      VIEWER_MODE &&
      item &&
      !item.isFolder &&
      String(item.id || "") === job.fileId
    );
  }
  return false;
}

function commitPreparedVideoSeek(video, state, job, requestToken) {
  if (
    !state ||
    state.preparedSeek !== job ||
    job.requestToken !== requestToken ||
    !preparedVideoSeekIsCurrent(video, job)
  )
    return false;

  const prepared = job.el;
  const outgoing = video;
  const src = String(job.src || "");
  const resume = !!job.resume;
  const target = Number(job.target) || 0;
  if (!prepared || prepared.readyState < 2) return false;

  // The active and prepared elements use the same resource. Avoid allowing an
  // older cached copy to replace the newly-decoded frame during the rerender.
  const cached = PRELOAD_CACHE instanceof Map ? PRELOAD_CACHE.get(src) : null;
  if (cached && cached !== prepared && cached !== outgoing) {
    PRELOAD_CACHE.delete(src);
    stopCachedMediaElement(cached);
  } else if (PRELOAD_CACHE instanceof Map) {
    PRELOAD_CACHE.delete(src);
  }

  prepared.onloadedmetadata = null;
  prepared.onseeked = null;
  prepared.onerror = null;
  if (job.commitTimer) clearTimeout(job.commitTimer);
  job.commitTimer = 0;
  prepared.className = outgoing.className;
  prepared.style.cssText = outgoing.style.cssText;
  prepared.controls = outgoing.controls;
  prepared.autoplay = outgoing.autoplay;
  prepared.loop = outgoing.loop;
  prepared.muted = outgoing.muted;
  prepared.volume = outgoing.volume;
  prepared.playbackRate = outgoing.playbackRate;
  prepared.defaultPlaybackRate = outgoing.defaultPlaybackRate;
  prepared.poster = outgoing.poster || BLACK_POSTER_URL;
  prepared.onloadeddata = outgoing.onloadeddata;
  prepared.oncanplay = outgoing.oncanplay;
  prepared.onplaying = outgoing.onplaying;
  prepared.onended = outgoing.onended;
  prepared.onerror = outgoing.onerror;
  prepared.__lgPreviewFrameToken = outgoing.__lgPreviewFrameToken;
  prepared.setAttribute(
    "data-dir-path",
    outgoing.getAttribute("data-dir-path") || "",
  );
  if (job.surface === "preview")
    prepared.dataset.previewFileId = job.fileId;

  state.preparedSeek = null;
  if (outgoing.parentElement) outgoing.parentElement.replaceChild(prepared, outgoing);
  else if (job.surface === "preview" && previewViewportBox)
    previewViewportBox.appendChild(prepared);
  else if (job.surface === "viewer" && viewport) viewport.appendChild(prepared);

  if (job.surface === "preview") {
    previewVideoEl = wirePreviewVideoElement(prepared);
  } else {
    viewerVideoEl = prepared;
  }
  resetPreviewVideoTransientHandlers(outgoing);
  cancelResponsiveVideoSeek(outgoing);
  stopCachedMediaElement(outgoing);

  // Reconnect the active filter surface without rerendering the viewer. The
  // prepared element already has the decoded target and the outgoing element's
  // item handlers, so the DOM replacement remains a single visual operation.
  const rec = WS.fileById.get(job.fileId) || null;
  if (rec) {
    if (job.surface === "preview") {
      syncMediaFilterSurface(
        "preview",
        previewVideoEl,
        previewViewportBox,
        "video",
        rec,
      );
    } else {
      syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video", rec);
    }
  }
  const active = job.surface === "preview" ? previewVideoEl : viewerVideoEl;
  if (active) {
    try {
      if (Math.abs((Number(active.currentTime) || 0) - target) > 0.04)
        active.currentTime = target;
    } catch {}
    if (resume) {
      try {
        const promise = active.play();
        if (promise && typeof promise.catch === "function")
          promise.catch(() => {});
      } catch {}
    } else {
      try { active.pause(); } catch {}
    }
  }
  syncControlPaneState();
  try { MediaFilterEngine.requestRender(); } catch {}
  return true;
}

function requestPreparedVideoSeek(video, state, target, resume) {
  const surface = preparedVideoSeekSurface(video);
  if (!surface || !state) return false;
  const src = String(video.currentSrc || video.getAttribute("src") || "");
  const fileId = preparedVideoSeekFileId(video, surface);
  if (!src || !fileId) return false;

  let job = state.preparedSeek;
  if (!job || job.src !== src || job.fileId !== fileId) {
    disposePreparedVideoSeek(state);
    const el = document.createElement("video");
    prepareMediaElementForCanvas(el);
    el.preload = "auto";
    el.playsInline = true;
    el.controls = false;
    el.autoplay = false;
    el.muted = true;
    el.poster = video.poster || BLACK_POSTER_URL;
    el.style.position = "fixed";
    el.style.left = "-2px";
    el.style.top = "-2px";
    el.style.width = "1px";
    el.style.height = "1px";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    el.style.zIndex = "-1";
    job = {
      el,
      src,
      fileId,
      surface,
      target,
      resume: !!resume,
      requestToken: 0,
      commitTimer: 0,
    };
    state.preparedSeek = job;
    document.body.appendChild(el);
    el.src = src;
    try { el.load(); } catch {}
  }

  job.target = target;
  job.resume = job.resume || !!resume;
  if (job.commitTimer) {
    clearTimeout(job.commitTimer);
    job.commitTimer = 0;
  }
  const requestToken = ++job.requestToken;
  const commit = () => {
    if (
      state.preparedSeek !== job ||
      job.requestToken !== requestToken ||
      Math.abs((Number(job.el.currentTime) || 0) - job.target) > 0.12
    )
      return;
    if (typeof job.el.requestVideoFrameCallback === "function") {
      try {
        job.el.requestVideoFrameCallback(() =>
          commitPreparedVideoSeek(video, state, job, requestToken),
        );
        if (job.commitTimer) clearTimeout(job.commitTimer);
        job.commitTimer = setTimeout(
          () => commitPreparedVideoSeek(video, state, job, requestToken),
          140,
        );
        return;
      } catch {}
    }
    commitPreparedVideoSeek(video, state, job, requestToken);
  };
  const seekPrepared = () => {
    if (state.preparedSeek !== job || job.requestToken !== requestToken) return;
    try {
      job.el.currentTime = job.target;
    } catch {
      return;
    }
    if (!job.el.seeking && job.el.readyState >= 2)
      requestAnimationFrame(commit);
  };
  job.el.onloadedmetadata = seekPrepared;
  job.el.onseeked = commit;
  job.el.onerror = () => {
    if (state.preparedSeek !== job) return;
    disposePreparedVideoSeek(state);
    state.pending = { time: target, fast: true, resume: !!resume };
    if (!state.inFlight) applyPendingResponsiveVideoSeek(video, state);
  };
  if (job.el.readyState >= 1) seekPrepared();
  return true;
}

function applyPendingResponsiveVideoSeek(video, state) {
  if (!video || !state || state.inFlight || !state.pending) return false;
  const request = state.pending;
  state.pending = null;
  state.inFlight = true;
  state.activeTarget = request.time;
  state.activeFast = request.fast;
  state.resumeAfterSeek = state.resumeAfterSeek || request.resume;
  const token = ++state.token;
  try {
    if (
      request.fast &&
      !videoTimeIsBuffered(video, request.time) &&
      typeof video.fastSeek === "function"
    )
      video.fastSeek(request.time);
    else
      video.currentTime = request.time;
  } catch {
    try {
      video.currentTime = request.time;
    } catch {
      state.inFlight = false;
      state.activeTarget = null;
      state.activeFast = null;
      state.resumeAfterSeek = false;
      return false;
    }
  }

  // WebKit can report the player as paused while it locates a distant
  // keyframe. Reassert the pre-seek play state immediately and once settled.
  playAfterResponsiveVideoSeek(video, state);
  clearResponsiveVideoSeekWatchdog(state);
  // A seek WebKit never answers leaves the picture frozen for good. Ask again
  // (twice), then fall back to a keyframe seek, before giving up on it.
  let retries = 0;
  const watch = () => {
    if (state.token !== token) return;
    if (video.seeking && retries < 3) {
      retries++;
      try {
        if (retries === 3 && typeof video.fastSeek === "function")
          video.fastSeek(request.time);
        else video.currentTime = request.time;
      } catch {}
      state.watchdog = setTimeout(watch, 1500);
      return;
    }
    settleResponsiveVideoSeek(video, state);
  };
  state.watchdog = setTimeout(watch, 1500);
  requestAnimationFrame(() => {
    if (state.token !== token || !state.inFlight) return;
    if (!video.seeking) settleResponsiveVideoSeek(video, state);
  });
  return true;
}

function requestResponsiveVideoSeek(video, targetTime, options = null) {
  if (!video) return false;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const target = Math.max(0, Math.min(duration, Number(targetTime) || 0));
  const opts = options && typeof options === "object" ? options : {};
  const state = getResponsiveVideoSeekState(video);
  if (!state) return false;
  const resume =
    typeof opts.resume === "boolean"
      ? opts.resume
      : state.resumeAfterSeek || (!video.paused && !video.ended);
  const fast = opts.fast !== false;
  // The prepared-seek path keeps the live video playing while an offscreen clone
  // reloads the source and seeks to the (unbuffered) target, then swaps it in.
  // That's smooth for scrubbing, but for a skip it defers the jump until the
  // clone catches up — the "pauses and lags instead of jumping" behavior. Skip
  // callers pass { direct: true } to force an immediate native seek instead.
  if (
    !opts.direct &&
    !videoTimeIsBuffered(video, target) &&
    preparedVideoSeekSurface(video)
  ) {
    state.resumeAfterSeek = state.resumeAfterSeek || resume;
    state.pending = null;
    return requestPreparedVideoSeek(video, state, target, resume);
  }
  // A fresh direct request supersedes any in-flight prepared seek.
  if (opts.direct && state.preparedSeek) disposePreparedVideoSeek(state);
  if (state.preparedSeek) disposePreparedVideoSeek(state);
  if (
    state.pending &&
    Math.abs(Number(state.pending.time) - target) < 0.005 &&
    state.pending.fast === fast
  ) {
    state.pending.resume = state.pending.resume || resume;
    state.resumeAfterSeek = state.resumeAfterSeek || resume;
    return true;
  }
  if (
    state.inFlight &&
    !state.pending &&
    state.activeTarget !== null &&
    Math.abs(Number(state.activeTarget) - target) < 0.005 &&
    state.activeFast === fast
  ) {
    state.resumeAfterSeek = state.resumeAfterSeek || resume;
    return true;
  }
  state.pending = {
    time: target,
    fast,
    resume,
  };
  state.resumeAfterSeek = state.resumeAfterSeek || resume;
  if (!state.inFlight) return applyPendingResponsiveVideoSeek(video, state);
  return true;
}

function responsiveVideoSeekBaseTime(video) {
  const state = video ? RESPONSIVE_VIDEO_SEEK_STATES.get(video) : null;
  if (
    state?.preparedSeek &&
    Number.isFinite(Number(state.preparedSeek.target))
  )
    return Number(state.preparedSeek.target);
  if (state?.pending && Number.isFinite(Number(state.pending.time)))
    return Number(state.pending.time);
  if (
    state &&
    state.activeTarget !== null &&
    Number.isFinite(Number(state.activeTarget))
  )
    return Number(state.activeTarget);
  return Math.max(0, Number(video?.currentTime) || 0);
}

function seekControlPaneVideo(deltaSeconds) {
  const video = getControlPaneVideo();
  if (!video) return false;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return false;
  const next = Math.max(
    0,
    Math.min(duration, responsiveVideoSeekBaseTime(video) + deltaSeconds),
  );
  if (!requestResponsiveVideoSeek(video, next, { fast: true, direct: true }))
    return false;
  syncControlPaneState();
  return true;
}

function toggleControlPanePlayPause() {
  const video = getControlPaneVideo();
  if (!video) return false;
  const fileId = WS.preview && WS.preview.fileId ? WS.preview.fileId : "";
  try {
    if (video.paused) {
      setPreviewVideoUserPauseLock(fileId, false);
      video.play();
    } else {
      cancelResponsiveVideoSeek(video);
      setPreviewVideoUserPauseLock(fileId, true);
      video.pause();
    }
  } catch {
    return false;
  }
  syncControlPaneState();
  return true;
}

function toggleControlPaneMute() {
  return toggleDefaultVideoAudioMode();
}

function moveControlPaneItem(delta) {
  if (!controlPaneHasNavigablePreviewItem()) return false;
  const moved = viewerStep(delta < 0 ? -1 : 1);
  syncControlPaneState();
  return moved;
}

if (controlPrevItemBtn)
  controlPrevItemBtn.addEventListener("click", () => {
    moveControlPaneItem(-1);
  });
if (controlNextItemBtn)
  controlNextItemBtn.addEventListener("click", () => {
    moveControlPaneItem(1);
  });
if (controlSkipBackBtn)
  controlSkipBackBtn.addEventListener("click", () => {
    seekControlPaneVideo(-videoSkipStepSeconds());
  });
if (controlSkipForwardBtn)
  controlSkipForwardBtn.addEventListener("click", () => {
    seekControlPaneVideo(videoSkipStepSeconds());
  });
if (controlPlayPauseBtn)
  controlPlayPauseBtn.addEventListener("click", () => {
    toggleControlPanePlayPause();
  });
if (controlMuteBtn)
  controlMuteBtn.addEventListener("click", () => {
    toggleControlPaneMute();
  });
if (controlProgressRange) {
  controlProgressRange.addEventListener("pointerdown", () => {
    CONTROL_PROGRESS_DRAGGING = true;
    showFloatingControlPane(false);
  });
  controlProgressRange.addEventListener("pointerup", () => {
    const video = getControlPaneVideo();
    const next = Number(controlProgressRange.value);
    if (video && Number.isFinite(next))
      requestResponsiveVideoSeek(video, next, { fast: false });
    CONTROL_PROGRESS_DRAGGING = false;
    syncControlPaneState();
    scheduleFloatingControlPaneHide();
  });
  controlProgressRange.addEventListener("input", () => {
    const video = getControlPaneVideo();
    if (!video) return;
    const next = Number(controlProgressRange.value);
    if (!Number.isFinite(next)) return;
    requestResponsiveVideoSeek(video, next, { fast: true });
    syncControlPaneState();
  });
  controlProgressRange.addEventListener("change", () => {
    const video = getControlPaneVideo();
    const next = Number(controlProgressRange.value);
    if (video && Number.isFinite(next))
      requestResponsiveVideoSeek(video, next, { fast: false });
    CONTROL_PROGRESS_DRAGGING = false;
    syncControlPaneState();
    scheduleFloatingControlPaneHide();
  });
}
if (controlPane) {
  controlPane.addEventListener("pointerenter", () => {
    CONTROL_PANE_HOVER = true;
    showFloatingControlPane(false);
  });
  controlPane.addEventListener("pointerleave", () => {
    CONTROL_PANE_HOVER = false;
    if (!CONTROL_PANE_DRAGGING) scheduleFloatingControlPaneHide();
  });
  controlPane.addEventListener("pointermove", () => {
    showFloatingControlPane(!CONTROL_PANE_HOVER);
  });
  controlPane.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    const target = ev.target;
    if (
      target &&
      target.closest &&
      target.closest("button, input, select, textarea, a")
    )
      return;
    if (!controlPane.classList.contains("control-floating-active")) return;
    const geometry = getFloatingControlPaneBounds();
    if (!geometry) return;
    ev.preventDefault();
    CONTROL_PANE_DRAGGING = true;
    CONTROL_PANE_DRAG_POINTER_ID = ev.pointerId;
    const hostRect = geometry.hostRect;
    const paneRect = controlPane.getBoundingClientRect();
    CONTROL_PANE_DRAG_OFFSET_X = ev.clientX - paneRect.left;
    CONTROL_PANE_DRAG_OFFSET_Y = ev.clientY - paneRect.top;
    controlPane.classList.add("control-floating-dragging");
    showFloatingControlPane(false);
    storeFloatingControlPanePosition(
      paneRect.left - hostRect.left,
      paneRect.top - hostRect.top,
    );
    try {
      controlPane.setPointerCapture(ev.pointerId);
    } catch {}
  });
}
if (previewBodyEl) {
  previewBodyEl.addEventListener("pointermove", () => {
    if (getControlPaneVideo()) {
      showFloatingControlPane(true);
    }
  });
}
document.addEventListener("pointermove", (ev) => {
  if (!CONTROL_PANE_DRAGGING || !controlPane) return;
  const geometry = getFloatingControlPaneBounds();
  if (!geometry) return;
  storeFloatingControlPanePosition(
    ev.clientX - geometry.hostRect.left - CONTROL_PANE_DRAG_OFFSET_X,
    ev.clientY - geometry.hostRect.top - CONTROL_PANE_DRAG_OFFSET_Y,
  );
});
document.addEventListener("pointerup", (ev) => {
  if (!CONTROL_PANE_DRAGGING) return;
  CONTROL_PANE_DRAGGING = false;
  if (controlPane) {
    controlPane.classList.remove("control-floating-dragging");
    try {
      controlPane.releasePointerCapture(CONTROL_PANE_DRAG_POINTER_ID);
    } catch {}
  }
  CONTROL_PANE_DRAG_POINTER_ID = null;
  if (!CONTROL_PANE_HOVER) scheduleFloatingControlPaneHide();
});
window.addEventListener("resize", () => {
  applyFloatingControlPanePosition();
});
// The only thing in the control pane that advances on its own is video playback
// position, so the 4Hz poll only earns its keep while a video is mounted. With no
// video it was still doing ~15 unconditional DOM writes per tick, forever, including
// while the window was hidden — pure background heat. Every other input it reflects
// (nav availability, mute, skip step) changes through syncButtons(), which calls
// syncControlPaneState() directly; the slow idle tick below is just a safety net so a
// freshly-mounted video can't sit unsynced.
let CONTROL_PANE_IDLE_TICKS = 0;
if (typeof window !== "undefined") {
  window.setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return;
    if (getControlPaneVideo()) {
      CONTROL_PANE_IDLE_TICKS = 0;
    } else {
      CONTROL_PANE_IDLE_TICKS = (CONTROL_PANE_IDLE_TICKS + 1) % 4;
      if (CONTROL_PANE_IDLE_TICKS !== 0) return;
    }
    syncControlPaneState();
  }, 250);
}
syncControlPaneState();
