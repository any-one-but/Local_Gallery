/* App volume
   One volume for everything the app plays. (normalizeAppVolumeValue is in
   core/options.js.) */

/* =========================================================
       App volume
       =========================================================

   One volume for everything the app plays -- video and music -- with no
   control on screen: volumeUp / volumeDown (Option+Up / Option+Down by
   default) step it by APP_VOLUME_STEP between 0 and 100, and a status message
   says where it is. Stored as the appVolume option (general preferences).

   It is applied as the element volume: every <video> gets it when it starts
   loading or playing (capture listeners, since media events do not bubble),
   every video on the page and the music player's Audio get it when it
   changes. Mute stays its own thing: a muted video is still muted. */
const APP_VOLUME_STEP = 5;

function appVolumePercent() {
  return normalizeAppVolumeValue(WS.meta && WS.meta.options && WS.meta.options.appVolume, 100);
}

// The number stepped through is linear in how loud things sound; the gain an
// element gets is not. Loudness halves for every 10 dB of attenuation, so a
// level of p (0..1) is 10*log2(p) dB, i.e. a gain of p^(log2(10)/2) ~ p^1.66:
// 50% plays at -10 dB (0.32), 25% at -20 dB (0.10), 5% at -43 dB.
const APP_VOLUME_LOUDNESS_EXPONENT = Math.log2(10) / 2;

function appVolumeFactor() {
  const p = appVolumePercent() / 100;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return Math.pow(p, APP_VOLUME_LOUDNESS_EXPONENT);
}

function applyAppVolumeToElement(el) {
  if (!el || typeof el.volume !== "number") return;
  const v = appVolumeFactor();
  if (Math.abs(el.volume - v) > 0.001) {
    try {
      el.volume = v;
    } catch {}
  }
}

function applyAppVolumeEverywhere() {
  document.querySelectorAll("video").forEach(applyAppVolumeToElement);
  if (typeof MUSIC !== "undefined" && MUSIC.audio) applyAppVolumeToElement(MUSIC.audio);
  if (PRELOAD_CACHE instanceof Map) {
    for (const el of PRELOAD_CACHE.values()) {
      if (el && el.tagName === "VIDEO") applyAppVolumeToElement(el);
    }
  }
}

function stepAppVolume(direction) {
  if (!WS.meta) return false;
  const current = appVolumePercent();
  const next = normalizeAppVolumeValue(current + (direction > 0 ? 1 : -1) * APP_VOLUME_STEP);
  if (next !== current) {
    setOptionValue("appVolume", next);
    metaScheduleSave();
  }
  applyAppVolumeEverywhere();
  showStatusMessage(`Volume ${next}%`, "", { force: false });
  return true;
}

for (const type of ["loadstart", "loadedmetadata", "play"]) {
  document.addEventListener(
    type,
    (e) => {
      const el = e.target;
      if (el && el.tagName === "VIDEO" && !getQuadPlaybackSlots().some((s) => s && s.videoEl === el))
        applyAppVolumeToElement(el);
    },
    true,
  );
}
