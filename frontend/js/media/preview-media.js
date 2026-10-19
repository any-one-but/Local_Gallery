/* Preview media
   Media URLs, full-resolution upgrades, posters and the media layer debugger. */

function ensureMediaUrl(rec) {
  if (!rec || rec.isMissingPlaceholder) return null;
  if (getElectronApi() && !rec.nativeUrlFailed) {
    const nativePath = nativePathForRecord(rec);
    // Under Tauri, WKWebView blocks file:// from the app origin, so serve media
    // through the asset protocol (convertFileSrc). Electron keeps file://.
    const useTauriAsset =
      window.electronAPI &&
      window.electronAPI.isTauri &&
      window.__lg &&
      typeof window.__lg.assetUrl === "function";
    // Videos stream over the app's loopback HTTP server (videoUrl); see
    // media.rs for why a custom scheme cannot carry them.
    const nativeUrl = useTauriAsset
      ? rec.type === "video" && typeof window.__lg.videoUrl === "function"
        ? window.__lg.videoUrl(nativePath)
        : window.__lg.assetUrl(nativePath)
      : nativePathToFileUrl(nativePath);
    if (nativeUrl) {
      if (rec.url && rec.url !== nativeUrl && rec.urlKind === "blob") {
        try { URL.revokeObjectURL(rec.url); } catch {}
      }
      rec.url = nativeUrl;
      rec.urlKind = "native";
      return rec.url;
    }
  }
  if (rec.url) return rec.url;
  if (!rec.file) return null;
  try {
    rec.url = URL.createObjectURL(rec.file);
    rec.urlKind = "blob";
    return rec.url;
  } catch {
    return null;
  }
}

function prepareMediaElementForCanvas(el) {
  if (!el) return el;
  try {
    if ("crossOrigin" in el) el.crossOrigin = "anonymous";
    el.setAttribute("crossorigin", "anonymous");
  } catch {}
  return el;
}

function configurePreviewMediaElementForMaxQuality(el) {
  if (!el) return el;
  try {
    el.loading = "eager";
  } catch {}
  try {
    // In the app (WebKit) an async-decoded large image paints nothing until it
    // is decoded, which is an empty frame on every file change. Sync decoding
    // holds the paint until the picture is ready instead. Chromium does not
    // blank, and keeps async.
    el.decoding = LG_HOST_IS_APP ? "sync" : "async";
  } catch {}
  try {
    el.fetchPriority = "high";
  } catch {}
  return el;
}

/* Full-resolution preview blobs are the app's single largest memory cost: each
   one is the whole image file held in RAM, and they used to live on the record
   until the workspace was torn down. Browsing a few thousand photos in one
   sitting therefore grew the web process without bound — measured at 15.5GB in
   a macOS jetsam report, which is what killed the page (blank/frozen window, or
   a reload back to the lock screen). They are a decode-ahead convenience, not
   state, so only the few most recent are kept and the rest are revoked. The
   record then simply falls back to its asset URL, which is what it renders from
   before the upgrade lands anyway. */
const PREVIEW_FULLRES_LRU = [];
const PREVIEW_FULLRES_LRU_LIMIT = 3;

function dropRecordFullResBlob(rec) {
  if (!rec || !rec.previewFullResUrl) return false;
  try {
    URL.revokeObjectURL(rec.previewFullResUrl);
  } catch {}
  rec.previewFullResUrl = null;
  return true;
}

function touchPreviewFullResLru(rec) {
  if (!rec) return;
  const id = String(rec.id || "");
  if (!id) return;
  const at = PREVIEW_FULLRES_LRU.indexOf(id);
  if (at >= 0) PREVIEW_FULLRES_LRU.splice(at, 1);
  PREVIEW_FULLRES_LRU.push(id);
  while (PREVIEW_FULLRES_LRU.length > PREVIEW_FULLRES_LRU_LIMIT) {
    const stale = PREVIEW_FULLRES_LRU.shift();
    // Never pull the blob out from under the image currently on screen.
    if (String(WS.preview?.fileId || "") === stale) {
      PREVIEW_FULLRES_LRU.push(stale);
      break;
    }
    dropRecordFullResBlob(WS.fileById.get(stale));
  }
}

function releaseAllPreviewFullResBlobs(keepIds = null) {
  const keep = keepIds instanceof Set ? keepIds : new Set();
  let dropped = 0;
  for (let i = PREVIEW_FULLRES_LRU.length - 1; i >= 0; i--) {
    const id = PREVIEW_FULLRES_LRU[i];
    if (keep.has(id) || String(WS.preview?.fileId || "") === id) continue;
    if (dropRecordFullResBlob(WS.fileById.get(id))) dropped++;
    PREVIEW_FULLRES_LRU.splice(i, 1);
  }
  return dropped;
}

function previewImageNeedsFullResBlobUpgrade(rec) {
  if (!rec || rec.type !== "image") return false;
  // The app's own media protocol (lgmedia://) already serves the whole file,
  // off the main thread. Reading it a second time through IPC and swapping the
  // src was a second full read per image and a second src change on screen --
  // a flicker every time a file was opened.
  if (window.__lg && window.__lg.mediaScheme) return false;
  return !!(
    window.electronAPI &&
    window.electronAPI.isTauri &&
    window.__TAURI__ &&
    window.__TAURI__.core &&
    typeof window.__TAURI__.core.invoke === "function"
  );
}

function ensurePreviewImageSrc(rec) {
  if (!rec || rec.type !== "image") return ensureMediaUrl(rec) || "";
  if (rec.previewFullResUrl) {
    touchPreviewFullResLru(rec);
    return rec.previewFullResUrl;
  }
  return ensureMediaUrl(rec) || "";
}

function kickUpgradePreviewImageToFullRes(rec) {
  if (!previewImageNeedsFullResBlobUpgrade(rec)) return;
  if (rec.previewFullResUrl || rec.previewFullResLoading) return;
  const p = nativePathForRecord(rec);
  if (!p) return;
  const id = String(rec.id || "");
  rec.previewFullResLoading = true;
  (async () => {
    try {
      const arr = await window.__TAURI__.core.invoke("read_file_bytes", { path: p });
      const blob = new Blob([new Uint8Array(arr)]);
      const url = URL.createObjectURL(blob);
      if (String(rec.id || "") !== id) {
        try {
          URL.revokeObjectURL(url);
        } catch {}
        return;
      }
      if (rec.previewFullResUrl && rec.previewFullResUrl !== url) {
        try {
          URL.revokeObjectURL(rec.previewFullResUrl);
        } catch {}
      }
      rec.previewFullResUrl = url;
      touchPreviewFullResLru(rec);
      if (
        previewImgEl &&
        String(WS.preview?.fileId || "") === id &&
        String(previewImgEl.dataset.previewFileId || "") === id
      ) {
        previewImgEl.src = url;
      }
    } catch {
    } finally {
      if (String(rec.id || "") === id) rec.previewFullResLoading = false;
    }
  })();
}

function retryNativePreviewMediaAsBlob(rec) {
  if (!rec || rec.urlKind !== "native") return false;
  rec.nativeUrlFailed = true;
  rec.url = null;
  renderPreviewPane(false, true);
  return true;
}

function applyDirectoryInlineAspect(imgEl, aspectValue) {
  if (!imgEl) return;
  const aspect = normalizePreviewAspect(aspectValue, 4 / 3);
  const cssAspect = Number(aspect).toFixed(4);
  imgEl.style.setProperty("--dir-inline-ar", cssAspect);
  if (!naturalAspectThumbnailCardsEnabled()) return;
  if (imgEl.closest(".dirTagQuadGrid")) return;
  const card = imgEl.closest(".dirFileThumbCard, .dirSquareCard");
  if (card) card.style.setProperty("--dir-card-ar", cssAspect);
}

function syncDirectoryInlineAspectFromNaturalSize(imgEl, rec) {
  if (!imgEl || !rec || rec.type !== "image") return false;
  const w = Number(imgEl.naturalWidth) || 0;
  const h = Number(imgEl.naturalHeight) || 0;
  if (!(w > 0 && h > 0)) return false;
  const naturalAspect = normalizePreviewAspect(
    w / h,
    getPreviewAspectForRecord(rec),
  );
  setRecordAspectRatio(rec, naturalAspect);
  applyDirectoryInlineAspect(imgEl, naturalAspect);
  return true;
}

function syncDirectoryInlineAspectForRenderedImages() {
  if (!directoriesListEl || !naturalAspectThumbnailCardsEnabled()) return;
  const imgs = directoriesListEl.querySelectorAll(
    ".dirInlinePreview[data-dir-preview-id]",
  );
  for (const img of imgs) {
    const recId = String(img?.dataset?.dirPreviewId || "");
    if (!recId) continue;
    const rec = WS.fileById.get(recId);
    if (!rec || rec.type !== "image") continue;
    if (syncDirectoryInlineAspectFromNaturalSize(img, rec)) continue;
    if (img.dataset.dirAspectPending === "1") continue;
    img.dataset.dirAspectPending = "1";
    img.addEventListener(
      "load",
      () => {
        delete img.dataset.dirAspectPending;
        syncDirectoryInlineAspectFromNaturalSize(img, rec);
      },
      { once: true },
    );
  }
}

function applyVideoPoster(videoEl, rec, options = null) {
  if (!videoEl) return;
  const poster = getVideoPosterForRecord(rec, options);
  if (videoEl.poster !== poster) videoEl.poster = poster;
}

function schedulePreviewVideoPosterRequest(rec, delayMs = 900) {
  if (!rec || rec.type !== "video" || rec.videoThumbUrl) return;
  if (
    !window.electronAPI ||
    !window.electronAPI.isTauri ||
    !window.__lg ||
    typeof window.__lg.requestThumb !== "function"
  )
    return;
  const p = nativePathForRecord(rec);
  if (!p) return;
  if (PREVIEW_VIDEO_POSTER_TIMER) clearTimeout(PREVIEW_VIDEO_POSTER_TIMER);
  const token = ++PREVIEW_VIDEO_POSTER_TOKEN;
  PREVIEW_VIDEO_POSTER_TIMER = setTimeout(() => {
    PREVIEW_VIDEO_POSTER_TIMER = 0;
    if (token !== PREVIEW_VIDEO_POSTER_TOKEN) return;
    const currentRec =
      WS.preview && WS.preview.fileId
        ? WS.fileById.get(String(WS.preview.fileId))
        : null;
    if (!currentRec || currentRec.id !== rec.id) return;
    const frameTime = metaGetVideoThumbnailTimeForRecord
      ? metaGetVideoThumbnailTimeForRecord(rec)
      : null;
    window.__lg
      .requestThumb(p, 640, frameTime)
      .then((u) => {
        if (!u) return;
        rec.videoThumbUrl = u;
        const stillCurrent =
          WS.preview && String(WS.preview.fileId || "") === String(rec.id || "");
        if (stillCurrent && previewVideoEl && previewVideoEl.poster !== u) {
          previewVideoEl.poster = u;
        }
      })
      .catch(() => {});
  }, Math.max(0, Number(delayMs) || 0));
}

function ensurePreviewVideoTransitionCanvas() {
  if (!previewViewportBox) return null;
  if (!previewVideoTransitionCanvas) {
    previewVideoTransitionCanvas = document.createElement("canvas");
    previewVideoTransitionCanvas.className = "previewVideoTransitionFrame";
    previewVideoTransitionCanvas.setAttribute("aria-hidden", "true");
  }
  if (!previewViewportBox.contains(previewVideoTransitionCanvas))
    previewViewportBox.appendChild(previewVideoTransitionCanvas);
  return previewVideoTransitionCanvas;
}

function showPreviewVideoTransitionFrame(canvas = null) {
  const frame = canvas || ensurePreviewVideoTransitionCanvas();
  if (!frame) return false;
  if (PREVIEW_VIDEO_TRANSITION_HIDE_TIMER) {
    clearTimeout(PREVIEW_VIDEO_TRANSITION_HIDE_TIMER);
    PREVIEW_VIDEO_TRANSITION_HIDE_TIMER = 0;
  }
  frame.style.transition = "none";
  frame.style.opacity = "1";
  frame.style.display = "block";
  return true;
}

function hidePreviewVideoTransitionFrame(immediate = false) {
  const frame = previewVideoTransitionCanvas;
  if (!frame) return;
  if (PREVIEW_VIDEO_TRANSITION_HIDE_TIMER) {
    clearTimeout(PREVIEW_VIDEO_TRANSITION_HIDE_TIMER);
    PREVIEW_VIDEO_TRANSITION_HIDE_TIMER = 0;
  }
  if (immediate || frame.style.display !== "block") {
    frame.style.transition = "none";
    frame.style.opacity = "1";
    frame.style.display = "none";
    return;
  }
  // Changing files is a hard cut: the held frame vanishes in one step, never a
  // dissolve. WKWebView can report a new frame just before it is actually
  // composited, so the cut waits one frame (TRANSITION_FRAME_CUT_DELAY_MS)
  // rather than fading -- the old frame stays whole until the new one is up.
  PREVIEW_VIDEO_TRANSITION_HIDE_TIMER = setTimeout(() => {
    PREVIEW_VIDEO_TRANSITION_HIDE_TIMER = 0;
    frame.style.transition = "none";
    frame.style.opacity = "1";
    frame.style.display = "none";
  }, TRANSITION_FRAME_CUT_DELAY_MS);
}

const TRANSITION_FRAME_CUT_DELAY_MS = 16;

// Take the held frame down as soon as the new image can be on screen, in one
// step. An image shown directly is ready once it has decoded: removing the
// held frame in the same task means the next painted frame is the new picture,
// with nothing in between. An image drawn through the filter pipeline needs
// its canvas rendered first, which happens on the next animation frame, so the
// held frame goes one frame after that.
function hidePreviewVideoTransitionFrameAfterPaint(isCurrent = null) {
  const stillCurrent = () => typeof isCurrent !== "function" || isCurrent();
  const img = previewImgEl;
  const direct =
    img &&
    img.style.display !== "none" &&
    !img.classList.contains("mediaHidden") &&
    typeof img.decode === "function";
  if (direct) {
    img
      .decode()
      .catch(() => {})
      .then(() => {
        if (stillCurrent()) hidePreviewVideoTransitionFrame(true);
      });
    return;
  }
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (stillCurrent()) hidePreviewVideoTransitionFrame(true);
    });
  });
}

// ===========================================================================
// TEMPORARY DIAGNOSTIC — media layer visualiser.
//
// Set LG_DEBUG_MEDIA_LAYERS to false (or call __lgDebugLayers(false) at
// runtime) to turn this off. Delete this whole block once the colour-drain
// question is settled.
//
// Every layer that can sit between "the filtered frame you were looking at"
// and "the filtered frame you should be looking at" is painted a flat colour
// with a label, so it is obvious which one is actually on screen during a
// media change, and for how long:
//
//   PURPLE  MASK — the outgoing-media snapshot shown while the next file loads
//   ORANGE  HOLD — the retained filtered frame
//   CYAN outline    the RAW media element is visible (CSS-only appearance —
//                   this is the layer that would look "drained")
//   GREEN outline   the live WebGL canvas is presenting (correct output)
//
// The HUD in the top-left reports live visibility plus, per layer, how many
// times it appeared and the total milliseconds it was on screen.
// ===========================================================================
let LG_DEBUG_MEDIA_LAYERS = false;

const LG_DEBUG_LAYER_PAINT = {
  mask: { fill: "#7A00FF", label: "MASK" },
  hold: { fill: "#FF7A00", label: "HOLD" },
};

function paintDebugMediaLayer(canvas, kind) {
  if (!LG_DEBUG_MEDIA_LAYERS || !canvas) return false;
  const style = LG_DEBUG_LAYER_PAINT[kind];
  if (!style) return false;
  let ctx = null;
  try { ctx = canvas.getContext("2d"); } catch { return false; }
  if (!ctx) return false;
  try {
    // Keep the debug fill a true flat colour rather than a graded one.
    canvas.style.removeProperty("filter");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.fillStyle = style.fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const size = Math.max(20, Math.round(canvas.height * 0.06));
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${size}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(style.label, canvas.width / 2, canvas.height / 2);
  } catch {
    return false;
  }
  return true;
}

const LG_DEBUG_LAYER_STATS = {
  MASK: { on: false, since: 0, count: 0, ms: 0 },
  HOLD: { on: false, since: 0, count: 0, ms: 0 },
  RAW: { on: false, since: 0, count: 0, ms: 0 },
  GL: { on: false, since: 0, count: 0, ms: 0 },
};
let LG_DEBUG_LAYER_LOG = [];
let LG_DEBUG_LAYER_HUD = null;
let LG_DEBUG_LAYER_RAF = 0;

function lgDebugLayerVisible(name) {
  const box = VIEWER_MODE && typeof viewport !== "undefined" && viewport
    ? viewport
    : previewViewportBox;
  if (!box) return false;
  const shown = (el) =>
    !!(el && el.style.display !== "none" && Number(getComputedStyle(el).opacity) > 0.01);
  if (name === "MASK") {
    const el = VIEWER_MODE ? (typeof viewerTransitionCanvas !== "undefined" ? viewerTransitionCanvas : null) : previewVideoTransitionCanvas;
    return shown(el);
  }
  if (name === "HOLD") return shown(box.querySelector(".mediaHoldCanvas.ready"));
  if (name === "GL") return shown(box.querySelector(".mediaCanvas.ready"));
  if (name === "RAW") {
    const els = box.querySelectorAll("img, video");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.classList.contains("mediaHidden")) continue;
      if (shown(el)) return true;
    }
    return false;
  }
  return false;
}

function lgDebugLayerTick() {
  LG_DEBUG_LAYER_RAF = 0;
  if (!LG_DEBUG_MEDIA_LAYERS) return;
  const now = performance.now();
  const names = ["MASK", "HOLD", "RAW", "GL"];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    const st = LG_DEBUG_LAYER_STATS[name];
    const on = lgDebugLayerVisible(name);
    if (on && !st.on) {
      st.on = true;
      st.since = now;
      st.count++;
      LG_DEBUG_LAYER_LOG.push(`${name} on`);
    } else if (!on && st.on) {
      const dur = Math.round(now - st.since);
      st.on = false;
      st.ms += dur;
      LG_DEBUG_LAYER_LOG[LG_DEBUG_LAYER_LOG.length - 1] = `${name} ${dur}ms`;
    }
  }
  if (LG_DEBUG_LAYER_LOG.length > 14) LG_DEBUG_LAYER_LOG = LG_DEBUG_LAYER_LOG.slice(-14);
  if (LG_DEBUG_LAYER_HUD) {
    const row = (name, colour) => {
      const st = LG_DEBUG_LAYER_STATS[name];
      let extra = "";
      if (name === "MASK" && st.on && PREVIEW_TRANSITION_FRAME_AT)
        extra = `  age ${Math.round(now - PREVIEW_TRANSITION_FRAME_AT)}ms`;
      return `<div style="color:${colour}">${st.on ? "●" : "○"} ${name.padEnd(5)} x${String(st.count).padEnd(4)} ${st.ms}ms${extra}</div>`;
    };
    LG_DEBUG_LAYER_HUD.innerHTML =
      row("MASK", "#c79bff") +
      row("HOLD", "#ffb066") +
      row("RAW", "#66e5ff") +
      row("GL", "#66ff9e") +
      `<div style="opacity:.8;margin-top:6px;border-top:1px solid #444;padding-top:4px">ctx.filter: ${LG_DEBUG_CANVAS_FILTER_SUPPORT}</div>` +
      `<div style="opacity:.65;margin-top:4px;border-top:1px solid #444;padding-top:4px">${LG_DEBUG_LAYER_LOG.join("<br>")}</div>`;
  }
  LG_DEBUG_LAYER_RAF = requestAnimationFrame(lgDebugLayerTick);
}

function lgDebugLayersSetEnabled(on) {
  LG_DEBUG_MEDIA_LAYERS = !!on;
  const root = document.documentElement;
  if (root) root.classList.toggle("lgDebugMediaLayers", LG_DEBUG_MEDIA_LAYERS);
  if (!LG_DEBUG_MEDIA_LAYERS) {
    if (LG_DEBUG_LAYER_RAF) cancelAnimationFrame(LG_DEBUG_LAYER_RAF);
    LG_DEBUG_LAYER_RAF = 0;
    if (LG_DEBUG_LAYER_HUD && LG_DEBUG_LAYER_HUD.parentElement)
      LG_DEBUG_LAYER_HUD.parentElement.removeChild(LG_DEBUG_LAYER_HUD);
    LG_DEBUG_LAYER_HUD = null;
    return false;
  }
  if (!LG_DEBUG_LAYER_HUD) {
    LG_DEBUG_LAYER_HUD = document.createElement("div");
    LG_DEBUG_LAYER_HUD.id = "lgDebugLayerHud";
    document.body.appendChild(LG_DEBUG_LAYER_HUD);
  }
  if (!LG_DEBUG_CANVAS_FILTER_SUPPORT)
    LG_DEBUG_CANVAS_FILTER_SUPPORT = lgDebugProbeCanvasFilterSupport();
  if (!LG_DEBUG_LAYER_RAF) LG_DEBUG_LAYER_RAF = requestAnimationFrame(lgDebugLayerTick);
  return true;
}

// The mask bakes an element's appearance in with `ctx.filter = <css filter>`.
// If the engine ignores ctx.filter, every mask captured from a raw element is
// completely UNFILTERED — which would show up as the outgoing media losing its
// grade for the whole load. Chromium supports it; WKWebView is the question, so
// probe it for real rather than assuming.
function lgDebugProbeCanvasFilterSupport() {
  try {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    const ctx = c.getContext("2d");
    if (!ctx) return "no-2d-context";
    if (!("filter" in ctx)) return "UNSUPPORTED (no ctx.filter property)";
    const src = document.createElement("canvas");
    src.width = 4;
    src.height = 4;
    const sctx = src.getContext("2d");
    sctx.fillStyle = "#ff0000";
    sctx.fillRect(0, 0, 4, 4);
    ctx.filter = "hue-rotate(120deg) saturate(2)";
    ctx.drawImage(src, 0, 0);
    ctx.filter = "none";
    const d = ctx.getImageData(2, 2, 1, 1).data;
    const changed = !(d[0] > 200 && d[1] < 60 && d[2] < 60);
    return changed
      ? `ok (red -> rgb(${d[0]},${d[1]},${d[2]}))`
      : `IGNORED (red stayed rgb(${d[0]},${d[1]},${d[2]}))`;
  } catch (e) {
    return "probe-failed: " + (e && e.message ? e.message : e);
  }
}
let LG_DEBUG_CANVAS_FILTER_SUPPORT = "";

function lgDebugLayersReset() {
  const names = ["MASK", "HOLD", "RAW", "GL"];
  for (let i = 0; i < names.length; i++)
    LG_DEBUG_LAYER_STATS[names[i]] = { on: false, since: 0, count: 0, ms: 0 };
  LG_DEBUG_LAYER_LOG = [];
  return "reset";
}

try {
  window.__lgDebugLayers = lgDebugLayersSetEnabled;
  window.__lgDebugLayersReset = lgDebugLayersReset;
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", () => lgDebugLayersSetEnabled(LG_DEBUG_MEDIA_LAYERS), { once: true });
  else lgDebugLayersSetEnabled(LG_DEBUG_MEDIA_LAYERS);
} catch {}
