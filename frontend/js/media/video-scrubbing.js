/* Video scrubbing
   Holding the skip keys to scrub. */

/* =========================================================
       Video scrubbing
       =========================================================

   The skip keys (seekBack / seekForward) scrub for as long as they are held.
   There is no on-screen readout: the picture is the feedback.

   Speed (x real time) starts at VIDEO_SCRUB_START_RATE and curves up with the
   hold (videoScrubRate), capped by the video's length (videoScrubMaxRate) so a
   short clip never flies past.

   In the app, whether scrubbing freezes depends on the media protocol, not on
   anything here: Tauri's asset:// read every seek's bytes on the main thread
   and froze the window. The app serves media through lgmedia:// instead
   (src-tauri/src/media.rs).

   How the picture follows is what keeps the machine responsive:
   - Forward, up to VIDEO_SCRUB_PLAY_MAX_RATE, the video simply plays, muted,
     at that playbackRate. No seeking at all, so nothing to pile up.
   - Faster than that, and always backward, it is paused and stepped with
     seeks through requestResponsiveVideoSeek, at most one every
     VIDEO_SCRUB_SEEK_INTERVAL_MS and never while one is still in flight. The
     old version asked for a seek every tick, and a decoder thrashing through
     seeks can stall the whole display, not just this window.
   On release a stepped scrub lands with one exact seek; either way the video
   gets its speed, sound and play state back.

   Keyup of the key that started it ends the scrub, as does the window losing
   focus or the video going away, so it can never stick. */
const VIDEO_SCRUB_START_RATE = 2;
const VIDEO_SCRUB_TAP_SECONDS = 0.25;
const VIDEO_SCRUB_PLAY_MAX_RATE = 4;
const VIDEO_SCRUB_SEEK_INTERVAL_MS = 140;
const VIDEO_SCRUB_TICK_MS = 40;
const VIDEO_SCRUB = {
  active: false,
  dir: 0,
  code: "",
  key: "",
  videos: [],
  saved: [],
  wasPlaying: false,
  playing: false,
  stepped: false,
  position: 0,
  startedAt: 0,
  lastTickAt: 0,
  lastSeekAt: 0,
  timer: 0,
};
const VIDEO_SCRUB_KEYS_DOWN = new Map();

function videoScrubMaxRate(duration) {
  const d = Number(duration) || 0;
  // Full length in no less than ~12s at top speed.
  return Math.max(VIDEO_SCRUB_START_RATE, Math.min(400, d / 12));
}

// 2x at once, ~4.5x after a second, ~9x after two, ~35x after five.
function videoScrubRate(heldSeconds, duration) {
  const t = Math.max(0, heldSeconds);
  const rate = VIDEO_SCRUB_START_RATE + 1.5 * t + t * t;
  return Math.min(videoScrubMaxRate(duration), rate);
}

function videoScrubLead() {
  const vid = VIDEO_SCRUB.videos[0];
  return vid && vid.isConnected ? vid : null;
}

function videoScrubSetPlaying(rate) {
  for (const vid of VIDEO_SCRUB.videos) {
    try {
      vid.muted = true;
      if (Math.abs(vid.playbackRate - rate) > 0.01) vid.playbackRate = rate;
      if (vid.paused && !vid.ended) {
        const p = vid.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
    } catch {}
  }
  VIDEO_SCRUB.playing = true;
}

function videoScrubPauseAll() {
  for (const vid of VIDEO_SCRUB.videos) {
    try {
      vid.pause();
    } catch {}
  }
  VIDEO_SCRUB.playing = false;
}

function videoScrubTick() {
  VIDEO_SCRUB.timer = 0;
  if (!VIDEO_SCRUB.active) return;
  const lead = videoScrubLead();
  if (!lead) {
    stopVideoScrub({ cancelled: true });
    return;
  }
  const now = performance.now();
  const dt = Math.min(0.2, Math.max(0, (now - VIDEO_SCRUB.lastTickAt) / 1000));
  VIDEO_SCRUB.lastTickAt = now;
  const duration = Number(lead.duration) || 0;
  const rate = videoScrubRate((now - VIDEO_SCRUB.startedAt) / 1000, duration);
  if (VIDEO_SCRUB.dir > 0 && rate <= VIDEO_SCRUB_PLAY_MAX_RATE) {
    if (lead.currentTime >= duration - 0.05) {
      if (VIDEO_SCRUB.playing) videoScrubPauseAll();
    } else {
      videoScrubSetPlaying(rate);
    }
    VIDEO_SCRUB.position = lead.currentTime;
  } else {
    if (VIDEO_SCRUB.playing) {
      videoScrubPauseAll();
      VIDEO_SCRUB.position = lead.currentTime;
    }
    VIDEO_SCRUB.stepped = true;
    VIDEO_SCRUB.position = Math.max(
      0,
      Math.min(duration, VIDEO_SCRUB.position + VIDEO_SCRUB.dir * rate * dt),
    );
    if (
      now - VIDEO_SCRUB.lastSeekAt >= VIDEO_SCRUB_SEEK_INTERVAL_MS &&
      !VIDEO_SCRUB.videos.some((v) => v.seeking)
    ) {
      VIDEO_SCRUB.lastSeekAt = now;
      videoScrubSeekTo(VIDEO_SCRUB.position, rate > VIDEO_SCRUB_PLAY_MAX_RATE);
    }
  }
  VIDEO_SCRUB.timer = setTimeout(videoScrubTick, VIDEO_SCRUB_TICK_MS);
}

function videoScrubSeekTo(time, fast) {
  for (const vid of VIDEO_SCRUB.videos) {
    const duration = Number(vid.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    requestResponsiveVideoSeek(vid, Math.max(0, Math.min(duration, time)), {
      fast,
      direct: true,
      resume: false,
    });
  }
}

function startVideoScrub(dir, keyInfo) {
  const vids = getActiveMediaVideos().filter((v) => {
    const d = Number(v.duration);
    return Number.isFinite(d) && d > 0;
  });
  if (!vids.length) return false;
  const direction = dir < 0 ? -1 : 1;
  if (VIDEO_SCRUB.active) {
    if (VIDEO_SCRUB.dir === direction) return true; // key repeat
    stopVideoScrub();
  }
  const lead = vids[0];
  VIDEO_SCRUB.active = true;
  VIDEO_SCRUB.dir = direction;
  VIDEO_SCRUB.code = String(keyInfo?.code || "");
  VIDEO_SCRUB.key = String(keyInfo?.key || "").toLowerCase();
  VIDEO_SCRUB.videos = vids;
  VIDEO_SCRUB.saved = vids.map((v) => ({
    muted: v.muted,
    rate: v.playbackRate || 1,
  }));
  VIDEO_SCRUB.wasPlaying = vids.some((v) => !v.paused && !v.ended);
  VIDEO_SCRUB.playing = false;
  VIDEO_SCRUB.stepped = false;
  for (const vid of vids) {
    cancelResponsiveVideoSeek(vid);
    try {
      vid.pause();
    } catch {}
  }
  // Keep the preview's own autoplay from restarting the video mid-scrub.
  if (!VIEWER_MODE && vids.includes(previewVideoEl))
    setPreviewVideoUserPauseLock(WS.preview?.fileId || "", true);
  const duration = Number(lead.duration);
  VIDEO_SCRUB.position = Math.max(
    0,
    Math.min(duration, lead.currentTime + direction * VIDEO_SCRUB_TAP_SECONDS),
  );
  const now = performance.now();
  VIDEO_SCRUB.startedAt = now;
  VIDEO_SCRUB.lastTickAt = now;
  VIDEO_SCRUB.lastSeekAt = now;
  VIDEO_SCRUB.stepped = true; // the tap nudge is a seek
  videoScrubSeekTo(VIDEO_SCRUB.position, false);
  VIDEO_SCRUB.timer = setTimeout(videoScrubTick, VIDEO_SCRUB_TICK_MS);
  return true;
}

function stopVideoScrub(opts = null) {
  if (!VIDEO_SCRUB.active) return;
  VIDEO_SCRUB.active = false;
  if (VIDEO_SCRUB.timer) clearTimeout(VIDEO_SCRUB.timer);
  VIDEO_SCRUB.timer = 0;
  const vids = VIDEO_SCRUB.videos;
  const saved = VIDEO_SCRUB.saved;
  const resume = VIDEO_SCRUB.wasPlaying;
  const lead = videoScrubLead();
  const wasPlayingScrub = VIDEO_SCRUB.playing;
  const target = wasPlayingScrub && lead ? lead.currentTime : VIDEO_SCRUB.position;
  VIDEO_SCRUB.videos = [];
  VIDEO_SCRUB.saved = [];
  VIDEO_SCRUB.playing = false;
  vids.forEach((vid, i) => {
    if (!vid.isConnected) return;
    try {
      vid.playbackRate = saved[i]?.rate || 1;
      vid.muted = !!saved[i]?.muted;
      if (!resume) vid.pause();
    } catch {}
  });
  if (!VIEWER_MODE && vids.includes(previewVideoEl))
    setPreviewVideoUserPauseLock(WS.preview?.fileId || "", !resume);
  if (opts?.cancelled) return;
  for (const vid of vids) {
    if (!vid.isConnected) continue;
    const duration = Number(vid.duration);
    if (!Number.isFinite(duration) || duration <= 0) continue;
    // A stepped scrub may have stopped short of the last requested position;
    // one exact landing puts it there. A played scrub is already where it is.
    if (!wasPlayingScrub && Math.abs(vid.currentTime - target) > 0.04) {
      requestResponsiveVideoSeek(vid, Math.min(duration, target), {
        fast: false,
        direct: true,
        resume,
      });
    }
    if (resume && !vid.ended) {
      try {
        const p = vid.play();
        if (p && typeof p.catch === "function") p.catch(() => {});
      } catch {}
    }
  }
}

function videoScrubIsHolding(video) {
  return VIDEO_SCRUB.active && VIDEO_SCRUB.videos.includes(video);
}

function videoScrubKeyMatches(e) {
  if (!VIDEO_SCRUB.active) return false;
  if (VIDEO_SCRUB.code && e.code === VIDEO_SCRUB.code) return true;
  return !!VIDEO_SCRUB.key && String(e.key || "").toLowerCase() === VIDEO_SCRUB.key;
}

// The skip actions arrive without their event, so the key that is down right
// now is read from here: the most recent keydown not yet released.
let VIDEO_SCRUB_LAST_KEYDOWN = null;
window.addEventListener(
  "keydown",
  (e) => {
    VIDEO_SCRUB_LAST_KEYDOWN = { code: e.code, key: e.key, at: performance.now() };
    VIDEO_SCRUB_KEYS_DOWN.set(e.code || e.key, true);
  },
  true,
);
window.addEventListener(
  "keyup",
  (e) => {
    VIDEO_SCRUB_KEYS_DOWN.delete(e.code || e.key);
    if (videoScrubKeyMatches(e)) stopVideoScrub();
  },
  true,
);
window.addEventListener("blur", () => {
  VIDEO_SCRUB_KEYS_DOWN.clear();
  stopVideoScrub();
});

function seekViewerVideo(deltaSeconds) {
  const dir = Number(deltaSeconds) < 0 ? -1 : 1;
  const down = VIDEO_SCRUB_LAST_KEYDOWN;
  const heldKey =
    down &&
    performance.now() - down.at < 250 &&
    VIDEO_SCRUB_KEYS_DOWN.has(down.code || down.key)
      ? down
      : null;
  if (heldKey) {
    startVideoScrub(dir, heldKey);
    return;
  }
  // Not from a held key (nothing calls it that way today): a plain jump.
  const vids = getActiveMediaVideos();
  for (let i = 0; i < vids.length; i++) {
    const vid = vids[i];
    let t = responsiveVideoSeekBaseTime(vid) + deltaSeconds;
    if (t < 0) t = 0;
    if (!isNaN(vid.duration) && isFinite(vid.duration) && vid.duration >= 0) {
      if (t > vid.duration) t = vid.duration;
    }
    requestResponsiveVideoSeek(vid, t, { fast: true, direct: true });
  }
}

function toggleViewerVideoPlayPause() {
  const vids = getActiveMediaVideos();
  if (!vids.length) return;
  const shouldPlay = vids.some((vid) => !!vid.paused);
  for (let i = 0; i < vids.length; i++) {
    const vid = vids[i];
    if (!VIEWER_MODE && vid === previewVideoEl) {
      const fileId = WS.preview && WS.preview.fileId ? WS.preview.fileId : "";
      setPreviewVideoUserPauseLock(fileId, !shouldPlay);
    }
    try {
      if (shouldPlay) vid.play();
      else {
        cancelResponsiveVideoSeek(vid);
        vid.pause();
      }
    } catch {}
  }
}

function toggleViewerVideoMute() {
  toggleDefaultVideoAudioMode();
}
