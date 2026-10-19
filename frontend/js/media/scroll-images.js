/* Scroll images
   Viewing modes and the tall/wide scroll layout. */

function galleryModeDisabled(opt = null) {
  return true;
}

function slideshowBehavior() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return opt ? String(opt.slideshowDefault || "cycle") : "cycle";
}

function preloadMode() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const raw = String((opt && opt.preloadNextMode) || "on")
    .trim()
    .toLowerCase();
  if (raw === "ultra") return "ultra";
  if (raw === "off") return "off";
  return "on";
}

function previewDisplayMode() {
  return "grid";
}

function expandedPreviewModeEnabled() {
  return false;
}

const SCROLL_IMAGE_EXTREME_RATIO = 2.2;
const TALL_SCROLL_TARGET_ASPECT = 2 / 3;

function getImageAspectForScrollDetect(rec, imgEl) {
  const naturalW = Number(imgEl?.naturalWidth || 0);
  const naturalH = Number(imgEl?.naturalHeight || 0);
  if (naturalW > 0 && naturalH > 0) {
    return naturalW / naturalH;
  }
  return normalizePreviewAspect(
    rec?.previewAspect ||
      rec?.thumbAspect ||
      rec?.videoAspect ||
      rec?.aspectRatio ||
      rec?.aspect,
    4 / 3,
  );
}

function detectScrollImageMode(rec, imgEl) {
  if (!rec || rec.type !== "image") return "none";
  if (isGifRecord(rec)) return "none";
  const aspect = getImageAspectForScrollDetect(rec, imgEl);
  if (aspect <= 1 / SCROLL_IMAGE_EXTREME_RATIO) return "tall";
  if (aspect >= SCROLL_IMAGE_EXTREME_RATIO) return "wide";
  return "none";
}

function predictScrollImageModeForRecord(rec) {
  return detectScrollImageMode(rec, null);
}

function applyScrollImageMode(containerEl, imgEl, mode, resetScroll = false) {
  const normalizedMode = mode === "tall" || mode === "wide" ? mode : "none";
  if (containerEl) {
    containerEl.classList.toggle("tallScrollMode", normalizedMode === "tall");
    containerEl.classList.toggle("wideScrollMode", normalizedMode === "wide");

    if (normalizedMode === "tall") {
      const h = Math.max(1, Number(containerEl.clientHeight || 0));
      const w = Math.max(1, Number(containerEl.clientWidth || 0));
      const targetW = Math.max(
        220,
        Math.min(w, Math.round(h * TALL_SCROLL_TARGET_ASPECT)),
      );
      containerEl.style.setProperty("--tall-scroll-max-width", `${targetW}px`);
    } else {
      containerEl.style.removeProperty("--tall-scroll-max-width");
    }

    if (resetScroll) {
      containerEl.scrollTop = 0;
      containerEl.scrollLeft = 0;
    }
  }
  if (imgEl) {
    imgEl.classList.toggle("tallScrollImage", normalizedMode === "tall");
    imgEl.classList.toggle("wideScrollImage", normalizedMode === "wide");
  }
}

function revealScrollImageLayout(imgEl, isCurrent, onReveal = null) {
  if (!imgEl) return;
  if (typeof isCurrent === "function" && !isCurrent()) return;
  imgEl.style.removeProperty("visibility");
  imgEl.classList.add("ready");
  MediaFilterEngine.requestRender();
  if (typeof onReveal === "function") onReveal();
}

function scrollImageFallbackCssFilter(rec, mode) {
  if (mode === "none") return "none";
  if (!rec || rec.type !== "image") return "none";
  const overlayCfg = resolveMediaOverlayConfigForTarget(rec);
  if (!overlayCfg) return "none";
  const filterMode = getMediaFilterForType(rec);
  const intensity = getMediaFilterIntensity();
  const baseCfgRaw =
    filterMode && filterMode !== "off"
      ? MEDIA_FILTER_CONFIGS[filterMode]
      : null;
  const baseCfg = scaleBaseFilterConfig(baseCfgRaw, intensity);
  const overlayColorFilter = mediaOverlayConfigColorFilterCss(overlayCfg) || "none";
  const colorFilter =
    overlayColorFilter && overlayColorFilter !== "none"
      ? overlayColorFilter
      : baseCfg && baseCfg.color
        ? String(baseCfg.color)
        : "none";
  return colorFilter && colorFilter !== "none" ? colorFilter : "none";
}

function applyScrollImageProcessingFallback(imgEl, rec, mode) {
  syncMediaElementAppearance(imgEl, rec, mode);
}

function showPreviewViewportMessage(label = "File unavailable", meta = "") {
  ensurePreviewFileElements();
  if (previewImgEl) {
    previewImgEl.classList.remove("ready");
    previewImgEl.style.removeProperty("visibility");
    previewImgEl.style.display = "none";
  }
  if (previewVideoEl) {
    cancelResponsiveVideoSeek(previewVideoEl);
    try { previewVideoEl.pause(); } catch {}
    previewVideoEl.classList.remove("ready");
    previewVideoEl.style.display = "none";
  }
  if (previewVideoTransitionCanvas) hidePreviewVideoTransitionFrame(true);
  if (!previewFolderEl) return;
  previewFolderEl.style.display = "flex";
  previewFolderEl.style.flexDirection = "column";
  previewFolderEl.style.alignItems = "center";
  previewFolderEl.style.justifyContent = "center";
  previewFolderEl.style.minWidth = "220px";
  previewFolderEl.style.maxWidth = "80%";
  previewFolderEl.style.padding = "24px 32px";
  previewFolderEl.style.borderRadius = "var(--radius-md)";
  previewFolderEl.style.background = "var(--color1-secondary)";
  previewFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";
  previewFolderEl.innerHTML = `<div style="font-size:14px;color:var(--color0-primary);text-align:center;">${escapeHtml(label)}</div>${meta ? `<div class="label" style="margin-top:8px;text-align:center;overflow-wrap:anywhere;">${escapeHtml(meta)}</div>` : ""}`;
}
