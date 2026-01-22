    /* =========================================================
       Core model
       ========================================================= */

    const imgRE = /\.(jpe?g|png|gif|webp|tiff|bmp|avif)$/i;
    const vidRE = /\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$/i;
    const indexPrefixRE = /^(\d+)\s-\s/;

    const FAVORITE_TAG = "__favorite__";
    const HIDDEN_TAG = "__hidden__";

    function isImageName(name) { return imgRE.test((name || "").toLowerCase()); }
    function isVideoName(name) { return vidRE.test((name || "").toLowerCase()); }

    function fileKey(file, relPathOverride) {
      const rp = relPathOverride || file.webkitRelativePath || "";
      return (file.name + "::" + file.lastModified + "::" + file.size + "::" + rp);
    }

    function splitIndexPrefix(name) {
      const s = String(name || "");
      const m = s.match(indexPrefixRE);
      if (!m) return { idx: null, clean: s };
      return { idx: parseInt(m[1], 10), clean: s.slice(m[0].length) };
    }

    function toTitleCaps(str) {
      return String(str || "").replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
      });
    }

    function displayName(name) {
      const opt = (typeof WS !== "undefined" && WS.meta && WS.meta.options) ? WS.meta.options : null;
      let out = splitIndexPrefix(name).clean;
      out = applyFileNameFilters(out, opt);
      if (opt && opt.hideUnderscoresInNames) out = out.replace(/_/g, " ");
      if (opt && opt.forceTitleCaps) out = toTitleCaps(out);
      return out;
    }

    function splitNameExt(name) {
      const raw = String(name || "");
      const i = raw.lastIndexOf(".");
      if (i <= 0) return { base: raw, ext: "" };
      return { base: raw.slice(0, i), ext: raw.slice(i) };
    }

    function applyFileNameFilters(base, opt) {
      let out = String(base || "");
      if (opt && opt.hideBeforeLastDashInFileNames) {
        const idx = out.lastIndexOf(" - ");
        if (idx >= 0) out = out.slice(idx + 3);
      }
      if (opt && opt.hideAfterFirstUnderscoreInFileNames) {
        const idx = out.indexOf("_");
        if (idx >= 0) out = out.slice(0, idx);
      }
      return out;
    }

    function compareIndexedNames(a, b) {
      const A = splitIndexPrefix(a);
      const B = splitIndexPrefix(b);
      const ai = (A.idx === null || !Number.isFinite(A.idx)) ? Infinity : A.idx;
      const bi = (B.idx === null || !Number.isFinite(B.idx)) ? Infinity : B.idx;
      if (ai !== bi) return ai - bi;
      const ac = (A.clean || "").toLowerCase();
      const bc = (B.clean || "").toLowerCase();
      const c = ac.localeCompare(bc);
      if (c) return c;
      return String(a || "").localeCompare(String(b || ""));
    }

    function displayPath(path) {
      const parts = String(path || "").split("/").filter(Boolean);
      const out = parts.map(seg => displayName(seg));
      return out.join("/") || "";
    }

    function displayRelPath(relPath) {
      const parts = String(relPath || "").split("/").filter(Boolean);
      const out = parts.map(seg => displayName(seg));
      return out.join("/") || "";
    }

    function normalizeFolderNameInput(name) {
      return String(name || "").trim();
    }

    function isValidFolderName(name) {
      if (!name) return false;
      if (name === "." || name === "..") return false;
      if (/[\/\\]/.test(name)) return false;
      return true;
    }

    function isValidFileName(name) {
      if (!name) return false;
      if (name === "." || name === "..") return false;
      if (/[\/\\]/.test(name)) return false;
      return true;
    }

    function remapPathPrefix(oldPrefix, newPrefix, path) {
      const p = String(path || "");
      if (!oldPrefix) return p;
      if (p === oldPrefix) return newPrefix;
      if (p.startsWith(oldPrefix + "/")) return newPrefix + p.slice(oldPrefix.length);
      return p;
    }

    function remapPathSet(src, oldPrefix, newPrefix) {
      const next = new Set();
      for (const p of src || []) next.add(remapPathPrefix(oldPrefix, newPrefix, p));
      return next;
    }

    function remapPathMapKeys(src, oldPrefix, newPrefix) {
      const next = new Map();
      for (const [key, value] of src || []) {
        next.set(remapPathPrefix(oldPrefix, newPrefix, key), value);
      }
      return next;
    }

    function makeDirNode(name, parent) {
      return {
        type: "dir",
        name,
        parent,
        childrenDirs: [],
        childrenFiles: [],
        lastIndex: 0,
        path: ""
      };
    }

    function defaultOptions() {
      return {
        videoPreview: "muted",
        videoGallery: "muted",
        imageThumbSize: "small",
        videoThumbSize: "small",
        mediaThumbUiSize: "small",
        folderPreviewSize: "small",
        hideFileExtensions: false,
        defaultFolderBehavior: "slide",
        folderScoreDisplay: "no-arrows",
        previewMode: "grid",
        videoSkipStep: "10",
        preloadNextMode: "off",
        videoEndBehavior: "loop",
        slideshowDefault: "cycle",
        hideUnderscoresInNames: true,
        hideBeforeLastDashInFileNames: true,
        hideAfterFirstUnderscoreInFileNames: true,
        forceTitleCaps: true,
        banicOpenWindow: true,
        altGalleryMode: true,
        retroMode: false,
        mediaFilter: "off",
        animatedMediaFilters: true,
        crtPixelateRes: "off",
        crtOverlayEnabled: false,
        colorScheme: "classic",
        leftPaneWidthPct: 0.28,
        treatTagsAsFolders: true,
        showHiddenFolder: false
      };
    }

    function normalizeOptions(o) {
      const d = defaultOptions();
      const src = (o && typeof o === "object") ? o : {};
      const mediaFilterRaw = (src && src.mediaFilter === "vhs") ? "crt" : src.mediaFilter;
      const crtPixelateResRaw = (src && src.crtPixelateRes != null) ? String(src.crtPixelateRes) : null;
      const crtOverlayEnabledRaw = (typeof src.crtOverlayEnabled === "boolean") ? src.crtOverlayEnabled : null;
      const crtOverlayEnabled = (crtOverlayEnabledRaw !== null)
        ? crtOverlayEnabledRaw
        : (crtPixelateResRaw ? crtPixelateResRaw !== "off" : d.crtOverlayEnabled);
      const crtPixelateRes = crtOverlayEnabled ? "medium" : "off";
      const out = {
        videoPreview: (src.videoPreview === "unmuted" || src.videoPreview === "muted" || src.videoPreview === "off") ? src.videoPreview : d.videoPreview,
        videoGallery: (src.videoGallery === "unmuted" || src.videoGallery === "muted" || src.videoGallery === "off") ? src.videoGallery : d.videoGallery,
        imageThumbSize: (src.imageThumbSize === "tiny" || src.imageThumbSize === "small" || src.imageThumbSize === "medium" || src.imageThumbSize === "high") ? src.imageThumbSize : d.imageThumbSize,
        videoThumbSize: (src.videoThumbSize === "tiny" || src.videoThumbSize === "small" || src.videoThumbSize === "medium" || src.videoThumbSize === "high") ? src.videoThumbSize : d.videoThumbSize,
        mediaThumbUiSize: (src.mediaThumbUiSize === "small" || src.mediaThumbUiSize === "medium" || src.mediaThumbUiSize === "large") ? src.mediaThumbUiSize : d.mediaThumbUiSize,
        folderPreviewSize: (src.folderPreviewSize === "small" || src.folderPreviewSize === "medium" || src.folderPreviewSize === "large") ? src.folderPreviewSize : d.folderPreviewSize,
        hideFileExtensions: (typeof src.hideFileExtensions === "boolean") ? src.hideFileExtensions : ((typeof src.showFileExtensions === "boolean") ? !src.showFileExtensions : d.hideFileExtensions),
        defaultFolderBehavior: (src.defaultFolderBehavior === "stop" || src.defaultFolderBehavior === "loop" || src.defaultFolderBehavior === "slide") ? src.defaultFolderBehavior : d.defaultFolderBehavior,
        folderScoreDisplay: (src.folderScoreDisplay === "show" || src.folderScoreDisplay === "no-arrows" || src.folderScoreDisplay === "hidden") ? src.folderScoreDisplay : ((typeof src.showFolderScores === "boolean") ? (src.showFolderScores ? "show" : "hidden") : d.folderScoreDisplay),
        previewMode: (src.previewMode === "grid" || src.previewMode === "expanded") ? src.previewMode : d.previewMode,
        videoSkipStep: (src.videoSkipStep === "3" || src.videoSkipStep === "5" || src.videoSkipStep === "10" || src.videoSkipStep === "30") ? src.videoSkipStep : d.videoSkipStep,
        preloadNextMode: (src.preloadNextMode === "off" || src.preloadNextMode === "on" || src.preloadNextMode === "ultra") ? src.preloadNextMode : d.preloadNextMode,
        videoEndBehavior: (src.videoEndBehavior === "loop" || src.videoEndBehavior === "next" || src.videoEndBehavior === "stop") ? src.videoEndBehavior : d.videoEndBehavior,
        slideshowDefault: (src.slideshowDefault === "cycle" || src.slideshowDefault === "1" || src.slideshowDefault === "3" || src.slideshowDefault === "5" || src.slideshowDefault === "10") ? src.slideshowDefault : d.slideshowDefault,
        hideUnderscoresInNames: (typeof src.hideUnderscoresInNames === "boolean") ? src.hideUnderscoresInNames : d.hideUnderscoresInNames,
        hideBeforeLastDashInFileNames: (typeof src.hideBeforeLastDashInFileNames === "boolean") ? src.hideBeforeLastDashInFileNames : d.hideBeforeLastDashInFileNames,
        hideAfterFirstUnderscoreInFileNames: (typeof src.hideAfterFirstUnderscoreInFileNames === "boolean") ? src.hideAfterFirstUnderscoreInFileNames : d.hideAfterFirstUnderscoreInFileNames,
        forceTitleCaps: (typeof src.forceTitleCaps === "boolean") ? src.forceTitleCaps : d.forceTitleCaps,
        banicOpenWindow: (typeof src.banicOpenWindow === "boolean") ? src.banicOpenWindow : d.banicOpenWindow,
        altGalleryMode: true,
        retroMode: (typeof src.retroMode === "boolean") ? src.retroMode : d.retroMode,
        colorScheme: (src.colorScheme === "classic" || src.colorScheme === "light" || src.colorScheme === "superdark" || src.colorScheme === "synthwave" || src.colorScheme === "verdant" || src.colorScheme === "azure" || src.colorScheme === "ember" || src.colorScheme === "amber" || src.colorScheme === "retro90s" || src.colorScheme === "retro90s-dark") ? src.colorScheme : d.colorScheme,
        treatTagsAsFolders: d.treatTagsAsFolders,
        showHiddenFolder: (typeof src.showHiddenFolder === "boolean") ? src.showHiddenFolder : ((typeof src.treatHiddenAsFolder === "boolean") ? src.treatHiddenAsFolder : d.showHiddenFolder),
        leftPaneWidthPct: (function(){
          const v = parseFloat(src.leftPaneWidthPct);
          if (Number.isFinite(v)) return Math.max(0.05, Math.min(0.9, v));
          return 0.28;
        })(),
        /* Media filters: UI */
        mediaFilter: (
  mediaFilterRaw === 'off' ||
  mediaFilterRaw === 'vibrant' ||
  mediaFilterRaw === 'uv' ||
  mediaFilterRaw === 'orangeTeal' ||
  mediaFilterRaw === 'cinematic'
) ? mediaFilterRaw : d.mediaFilter,
        animatedMediaFilters: (typeof src.animatedMediaFilters === "boolean") ? src.animatedMediaFilters : d.animatedMediaFilters,
        crtPixelateRes,
        crtOverlayEnabled
    };
      return out;
    }

    const MEDIA_FILTER_STATE = {
      mode: "off",
      animated: true
    };

    const MEDIA_FILTER_CONFIGS = {
      vibrant: { color: "saturate(1.45) contrast(1.12) brightness(1.06) hue-rotate(-3deg)" },
      uv: { color: "saturate(1.6) hue-rotate(220deg) contrast(1.3) brightness(0.95)" },
      orangeTeal: { color: "hue-rotate(-22deg) saturate(1.32) contrast(1.12) brightness(1.05)" },
      cinematic: { color: "contrast(1.3) saturate(1.2) brightness(1.02) hue-rotate(-2deg)" }
    };

    const CRT_OVERLAY_CONFIG = {
      scanlines: 0.4,
      scanlineBlur: 0.8,
      chroma: 0.7,
      vignette: 0.22,
      jitter: 0.75,
      blur: 0.25,
      grain: 0.06,
      pixelate: 2
    };

    function computeContainRect(srcW, srcH, dstW, dstH) {
      if (!srcW || !srcH || !dstW || !dstH) return { x: 0, y: 0, w: dstW, h: dstH };
      const srcRatio = srcW / srcH;
      const dstRatio = dstW / dstH;
      let w = dstW;
      let h = dstH;
      if (srcRatio > dstRatio) {
        h = dstW / srcRatio;
      } else {
        w = dstH * srcRatio;
      }
      const x = (dstW - w) * 0.5;
      const y = (dstH - h) * 0.5;
      return { x, y, w, h };
    }

    function computeCoverRect(srcW, srcH, dstW, dstH) {
      if (!srcW || !srcH || !dstW || !dstH) return { x: 0, y: 0, w: dstW, h: dstH };
      const srcRatio = srcW / srcH;
      const dstRatio = dstW / dstH;
      let w = dstW;
      let h = dstH;
      if (srcRatio > dstRatio) {
        w = dstH * srcRatio;
      } else {
        h = dstW / srcRatio;
      }
      const x = (dstW - w) * 0.5;
      const y = (dstH - h) * 0.5;
      return { x, y, w, h };
    }

    function getMediaFilterForType() {
      return MEDIA_FILTER_STATE.mode || "off";
    }

    function crtPixelateScale() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return (opt && opt.crtOverlayEnabled) ? 2 : 1;
    }

    function crtOverlayEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.crtOverlayEnabled);
    }

    const THUMB_FILTER_CACHE = {
      noiseCanvas: null,
      noiseCtx: null,
      scanCanvas: null,
      scanPattern: null,
      lastNoise: 0
    };

    function ensureThumbNoiseCanvas() {
      if (!THUMB_FILTER_CACHE.noiseCanvas) {
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 128;
        THUMB_FILTER_CACHE.noiseCanvas = c;
        THUMB_FILTER_CACHE.noiseCtx = c.getContext("2d");
      }
      return THUMB_FILTER_CACHE.noiseCanvas;
    }

    function updateThumbNoiseCanvas() {
      const c = ensureThumbNoiseCanvas();
      const ctx = THUMB_FILTER_CACHE.noiseCtx;
      const imageData = ctx.createImageData(c.width, c.height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const v = Math.floor(Math.random() * 255);
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);
      THUMB_FILTER_CACHE.lastNoise = Date.now();
    }

    function ensureThumbScanlinePattern(ctx) {
      if (!THUMB_FILTER_CACHE.scanCanvas) {
        const c = document.createElement("canvas");
        c.width = 2;
        c.height = 4;
        const sctx = c.getContext("2d");
        sctx.fillStyle = "rgba(0,0,0,0.5)";
        sctx.fillRect(0, 0, 2, 3);
        sctx.fillStyle = "rgba(0,0,0,0)";
        sctx.fillRect(0, 3, 2, 1);
        THUMB_FILTER_CACHE.scanCanvas = c;
        THUMB_FILTER_CACHE.scanPattern = null;
      }
      if (!THUMB_FILTER_CACHE.scanPattern || THUMB_FILTER_CACHE.scanPattern._ctx !== ctx) {
        const pattern = ctx.createPattern(THUMB_FILTER_CACHE.scanCanvas, "repeat");
        if (pattern) pattern._ctx = ctx;
        THUMB_FILTER_CACHE.scanPattern = pattern;
      }
      return THUMB_FILTER_CACHE.scanPattern;
    }

    function renderFilteredToCanvas(ctx, source, srcW, srcH, dstW, dstH, mode, cover = true) {
      if (!mode || mode === "off" || !MEDIA_FILTER_CONFIGS[mode]) {
        const rect = cover ? computeCoverRect(srcW, srcH, dstW, dstH) : computeContainRect(srcW, srcH, dstW, dstH);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, dstW, dstH);
        ctx.filter = "none";
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
        return;
      }
      const cfg = MEDIA_FILTER_CONFIGS[mode];
      const rect = cover ? computeCoverRect(srcW, srcH, dstW, dstH) : computeContainRect(srcW, srcH, dstW, dstH);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, dstW, dstH);
      const colorFilter = cfg.color && cfg.color !== "none" ? cfg.color : "none";

      if (cfg.pixelate) {
        const scale = Math.max(1.5, cfg.pixelate);
        const smallW = Math.max(1, Math.round(rect.w / scale));
        const smallH = Math.max(1, Math.round(rect.h / scale));
        const off = document.createElement("canvas");
        off.width = smallW;
        off.height = smallH;
        const offctx = off.getContext("2d");
        const smallRect = computeCoverRect(srcW, srcH, smallW, smallH);
        offctx.imageSmoothingEnabled = true;
        offctx.filter = cfg.blur ? `${colorFilter} blur(${cfg.blur}px)` : colorFilter;
        offctx.drawImage(source, smallRect.x, smallRect.y, smallRect.w, smallRect.h);
        ctx.imageSmoothingEnabled = false;
        ctx.filter = "none";
        ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.filter = cfg.blur ? `${colorFilter} blur(${cfg.blur}px)` : colorFilter;
        ctx.drawImage(source, rect.x, rect.y, rect.w, rect.h);
      }

      if (cfg.chroma) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.18;
        ctx.filter = "none";
        ctx.drawImage(source, rect.x + cfg.chroma, rect.y, rect.w, rect.h);
        ctx.drawImage(source, rect.x - cfg.chroma, rect.y, rect.w, rect.h);
        ctx.restore();
      }

      if (cfg.scanlines) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        ctx.globalAlpha = cfg.scanlines;
        const pattern = ensureThumbScanlinePattern(ctx);
        if (pattern) {
          ctx.fillStyle = pattern;
          if (cfg.scanlineBlur) ctx.filter = `blur(${cfg.scanlineBlur}px)`;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        ctx.restore();
      }

      if (cfg.grain) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        if (!THUMB_FILTER_CACHE.lastNoise) updateThumbNoiseCanvas();
        const noiseCanvas = ensureThumbNoiseCanvas();
        const pattern = ctx.createPattern(noiseCanvas, "repeat");
        if (pattern) {
          ctx.globalAlpha = cfg.grain;
          ctx.globalCompositeOperation = "overlay";
          ctx.fillStyle = pattern;
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        }
        ctx.restore();
      }

      if (cfg.vignette) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, rect.h);
        ctx.clip();
        const cx = rect.x + rect.w * 0.5;
        const cy = rect.y + rect.h * 0.5;
        const g = ctx.createRadialGradient(
          cx,
          cy,
          Math.min(rect.w, rect.h) * 0.2,
          cx,
          cy,
          Math.max(rect.w, rect.h) * 0.7
        );
        g.addColorStop(0, "rgba(0,0,0,0)");
        g.addColorStop(1, `rgba(0,0,0,${cfg.vignette})`);
        ctx.fillStyle = g;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.restore();
      }
    }

    const MediaFilterEngine = (() => {
      const surfaces = new Map();
      let rafId = null;
      const noise = { canvas: null, ctx: null, size: 128, lastTime: 0 };
      const scanlines = { canvas: null, pattern: null, lastCtx: null };

      function ensureNoiseCanvas() {
        if (!noise.canvas) {
          noise.canvas = document.createElement("canvas");
          noise.canvas.width = noise.size;
          noise.canvas.height = noise.size;
          noise.ctx = noise.canvas.getContext("2d");
        }
        return noise.canvas;
      }

      function updateNoiseCanvas() {
        ensureNoiseCanvas();
        const ctx = noise.ctx;
        const imageData = ctx.createImageData(noise.size, noise.size);
        const data = imageData.data;
        for (let i = 0; i < data.length; i += 4) {
          const v = Math.floor(Math.random() * 255);
          data[i] = v;
          data[i + 1] = v;
          data[i + 2] = v;
          data[i + 3] = 255;
        }
        ctx.putImageData(imageData, 0, 0);
      }

      function ensureScanlinePattern(ctx) {
        if (!scanlines.canvas) {
          scanlines.canvas = document.createElement("canvas");
          scanlines.canvas.width = 2;
          scanlines.canvas.height = 4;
          const sctx = scanlines.canvas.getContext("2d");
          sctx.fillStyle = "rgba(0,0,0,0.5)";
          sctx.fillRect(0, 0, 2, 3);
          sctx.fillStyle = "rgba(0,0,0,0)";
          sctx.fillRect(0, 3, 2, 1);
        }
        if (scanlines.lastCtx !== ctx) {
          scanlines.pattern = ctx.createPattern(scanlines.canvas, "repeat");
          scanlines.lastCtx = ctx;
        }
        return scanlines.pattern;
      }

      function updateEngineState() {
        const appEl = document.getElementById("app");
        if (!appEl) return;
        const anyDrawn = Array.from(surfaces.values()).some(s => s.active && s.hasDrawn);
        if (anyDrawn) appEl.setAttribute("data-media-filter-engine", "on");
        else appEl.removeAttribute("data-media-filter-engine");
      }

      function ensureSurface(name) {
        if (surfaces.has(name)) return surfaces.get(name);
        const surface = {
          name,
          container: null,
          mediaEl: null,
          type: null,
          filterMode: "off",
          canvas: null,
          ctx: null,
          offscreen: null,
          offctx: null,
          active: false,
          bound: false,
          hasDrawn: false,
          videoFrameActive: false
        };
        surfaces.set(name, surface);
        return surface;
      }

      function ensureCanvas(surface) {
        if (!surface.canvas) {
          surface.canvas = document.createElement("canvas");
          surface.canvas.className = "mediaCanvas";
          surface.canvas.style.display = "none";
        }
        if (!surface.ctx) surface.ctx = surface.canvas.getContext("2d");
        if (!surface.offscreen) surface.offscreen = document.createElement("canvas");
        if (!surface.offctx) surface.offctx = surface.offscreen.getContext("2d");
        if (surface.container && !surface.container.contains(surface.canvas)) {
          surface.container.appendChild(surface.canvas);
        }
      }

      function bindMediaEvents(surface, el) {
        if (!el || surface.mediaEl === el) return;
        if (surface.mediaEl && surface.bound) {
          surface.mediaEl.removeEventListener("loadeddata", requestRender);
          surface.mediaEl.removeEventListener("play", requestRender);
          surface.mediaEl.removeEventListener("pause", requestRender);
          surface.mediaEl.removeEventListener("seeked", requestRender);
        }
        surface.mediaEl = el;
        surface.bound = true;
        el.addEventListener("loadeddata", requestRender);
        el.addEventListener("play", requestRender);
        el.addEventListener("pause", requestRender);
        el.addEventListener("seeked", requestRender);
      }

      function attach(name, mediaEl, container, type, filterMode) {
        const surface = ensureSurface(name);
        surface.container = container;
        surface.type = type;
        surface.filterMode = filterMode || "off";
        surface.active = true;
        surface.hasDrawn = false;
        bindMediaEvents(surface, mediaEl);
        ensureCanvas(surface);
        if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
        if (type === "video" && mediaEl && typeof mediaEl.requestVideoFrameCallback === "function") {
          surface.videoFrameActive = true;
          const onFrame = () => {
            if (!surface.active || !surface.videoFrameActive) return;
            requestRender();
            mediaEl.requestVideoFrameCallback(onFrame);
          };
          mediaEl.requestVideoFrameCallback(onFrame);
        } else {
          surface.videoFrameActive = false;
        }
        requestRender();
        let pulseCount = 0;
        const pulse = () => {
          if (!surface.active) return;
          if (surface.hasDrawn) return;
          pulseCount++;
          requestRender();
          if (pulseCount < 20) requestAnimationFrame(pulse);
        };
        requestAnimationFrame(pulse);
      }

      function detach(name) {
        const surface = surfaces.get(name);
        if (!surface) return;
        surface.active = false;
        surface.hasDrawn = false;
        surface.videoFrameActive = false;
        if (surface.canvas) surface.canvas.style.display = "none";
        updateEngineState();
      }

      function requestRender() {
        if (rafId) return;
        rafId = requestAnimationFrame(render);
      }

      function render(time) {
        rafId = null;
        let needsMore = false;
        for (const surface of surfaces.values()) {
          if (!surface.active) continue;
          if (drawSurface(surface, time)) needsMore = true;
        }
        updateEngineState();
        if (needsMore) requestRender();
      }

      function drawSurface(surface, time) {
        const mode = surface.filterMode || "off";
        const cfg = (mode && mode !== "off") ? MEDIA_FILTER_CONFIGS[mode] : null;
        const overlayEnabled = crtOverlayEnabled();
        const overlayCfg = overlayEnabled ? CRT_OVERLAY_CONFIG : null;
        if (!cfg && !overlayCfg) {
          if (surface.canvas) surface.canvas.style.display = "none";
          if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
          return false;
        }
        if (!surface.mediaEl || !surface.container || !surface.canvas || !surface.ctx) return false;

        const el = surface.mediaEl;
        const isVideo = surface.type === "video";
        const ready = isVideo ? (el.readyState >= 2 && el.videoWidth > 0 && el.videoHeight > 0) : (el.complete && el.naturalWidth > 0 && el.naturalHeight > 0);
        if (!ready) return false;

        const cw = surface.container.clientWidth || 0;
        const ch = surface.container.clientHeight || 0;
        if (!cw || !ch) return false;

        const dpr = window.devicePixelRatio || 1;
        const pixelW = Math.max(1, Math.round(cw * dpr));
        const pixelH = Math.max(1, Math.round(ch * dpr));
        if (surface.canvas.width !== pixelW || surface.canvas.height !== pixelH) {
          surface.canvas.width = pixelW;
          surface.canvas.height = pixelH;
        }

        const ctx = surface.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.clearRect(0, 0, cw, ch);

        const srcW = isVideo ? el.videoWidth : el.naturalWidth;
        const srcH = isVideo ? el.videoHeight : el.naturalHeight;
        const rect = computeContainRect(srcW, srcH, cw, ch);

        const jitterStrength = Math.max((cfg && cfg.jitter) ? cfg.jitter : 0, (overlayCfg && overlayCfg.jitter) ? overlayCfg.jitter : 0);
        const jitter = jitterStrength ? (MEDIA_FILTER_STATE.animated ? Math.sin(time * 0.005) * jitterStrength : 0) : 0;
        const dx = rect.x + jitter;
        const dy = rect.y;

        const colorFilter = (cfg && cfg.color && cfg.color !== "none") ? cfg.color : "none";
        let drew = false;
        try {
          const pixelateBase = (overlayCfg && overlayCfg.pixelate) ? Math.max(2, overlayCfg.pixelate) : (cfg && cfg.pixelate ? Math.max(2, cfg.pixelate) : 0);
          if (pixelateBase) {
            const scale = overlayEnabled ? (pixelateBase * crtPixelateScale()) : pixelateBase;
            const smallW = Math.max(1, Math.round(rect.w / scale));
            const smallH = Math.max(1, Math.round(rect.h / scale));
            surface.offscreen.width = smallW;
            surface.offscreen.height = smallH;
            surface.offctx.setTransform(1, 0, 0, 1, 0, 0);
            surface.offctx.imageSmoothingEnabled = true;
            surface.offctx.clearRect(0, 0, smallW, smallH);
            surface.offctx.filter = "none";
            const blur = overlayCfg && overlayCfg.blur ? overlayCfg.blur : (cfg && cfg.blur ? cfg.blur : 0);
            if (blur) surface.offctx.filter = `blur(${blur}px)`;
            surface.offctx.drawImage(el, 0, 0, smallW, smallH);
            ctx.imageSmoothingEnabled = false;
            ctx.filter = colorFilter;
            ctx.drawImage(surface.offscreen, dx, dy, rect.w, rect.h);
          } else {
            ctx.imageSmoothingEnabled = true;
            const blur = overlayCfg && overlayCfg.blur ? overlayCfg.blur : (cfg && cfg.blur ? cfg.blur : 0);
            ctx.filter = blur ? `${colorFilter} blur(${blur}px)` : colorFilter;
            ctx.drawImage(el, dx, dy, rect.w, rect.h);
          }
          drew = true;
        } catch {
          if (surface.canvas) surface.canvas.style.display = "none";
          if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
          return false;
        }
        if (!drew) return false;

        const chroma = overlayCfg && overlayCfg.chroma ? overlayCfg.chroma : (cfg && cfg.chroma ? cfg.chroma : 0);
        if (chroma) {
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.globalAlpha = 0.18;
          ctx.filter = "none";
          ctx.drawImage(el, dx + chroma, dy, rect.w, rect.h);
          ctx.drawImage(el, dx - chroma, dy, rect.w, rect.h);
          ctx.restore();
        }

        const scanlines = overlayCfg && overlayCfg.scanlines ? overlayCfg.scanlines : (cfg && cfg.scanlines ? cfg.scanlines : 0);
        if (scanlines) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, rect.w, rect.h);
          ctx.clip();
          ctx.globalAlpha = scanlines;
          const pattern = ensureScanlinePattern(ctx);
          if (pattern) {
            ctx.fillStyle = pattern;
            const slBlur = overlayCfg && overlayCfg.scanlineBlur ? overlayCfg.scanlineBlur : (cfg && cfg.scanlineBlur ? cfg.scanlineBlur : 0);
            if (slBlur) ctx.filter = `blur(${slBlur}px)`;
            if (MEDIA_FILTER_STATE.animated) {
              ctx.translate(0, (time * 0.015) % 4);
            }
            ctx.fillRect(dx, dy, rect.w, rect.h);
          }
          ctx.restore();
        }

        const grain = overlayCfg && overlayCfg.grain ? overlayCfg.grain : (cfg && cfg.grain ? cfg.grain : 0);
        if (grain) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, rect.w, rect.h);
          ctx.clip();
          const noiseCanvas = ensureNoiseCanvas();
          if (MEDIA_FILTER_STATE.animated) {
            if (time - noise.lastTime > 80) {
              updateNoiseCanvas();
              noise.lastTime = time;
            }
          } else if (!noise.lastTime) {
            updateNoiseCanvas();
            noise.lastTime = time;
          }
          const pattern = ctx.createPattern(noiseCanvas, "repeat");
          if (pattern) {
            ctx.globalAlpha = grain;
            ctx.globalCompositeOperation = "overlay";
            ctx.fillStyle = pattern;
            ctx.fillRect(dx, dy, rect.w, rect.h);
          }
          ctx.restore();
        }

        const vignette = overlayCfg && overlayCfg.vignette ? overlayCfg.vignette : (cfg && cfg.vignette ? cfg.vignette : 0);
        if (vignette) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, rect.w, rect.h);
          ctx.clip();
          const cx = dx + rect.w * 0.5;
          const cy = dy + rect.h * 0.5;
          const g = ctx.createRadialGradient(
            cx,
            cy,
            Math.min(rect.w, rect.h) * 0.2,
            cx,
            cy,
            Math.max(rect.w, rect.h) * 0.7
          );
          g.addColorStop(0, "rgba(0,0,0,0)");
          g.addColorStop(1, `rgba(0,0,0,${vignette})`);
          ctx.fillStyle = g;
          ctx.fillRect(dx, dy, rect.w, rect.h);
          ctx.restore();
        }

        surface.canvas.style.display = "block";
        surface.canvas.classList.add("ready");
        surface.hasDrawn = true;
        if (surface.mediaEl) surface.mediaEl.classList.add("mediaHidden");

        const needsAnim = MEDIA_FILTER_STATE.animated && ((cfg && (cfg.grain || cfg.scanlines || cfg.jitter || cfg.chroma)) || (overlayCfg && (overlayCfg.grain || overlayCfg.scanlines || overlayCfg.jitter || overlayCfg.chroma)));
        if (isVideo) {
          if (surface.videoFrameActive) {
            return needsAnim;
          }
          if (!el.paused) return true;
          return needsAnim;
        }
        return needsAnim;
      }

      return {
        attach,
        detach,
        requestRender,
        hasSurfaceDrawn: (name) => {
          const surface = surfaces.get(name);
          return !!(surface && surface.hasDrawn);
        }
      };
    })();

    function fileDisplayName(name) {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const parts = splitNameExt(name || "");
      const base = displayName(parts.base || "") || "";
      if (!opt || !opt.hideFileExtensions) return base + (parts.ext || "");
      return base;
    }

    function relPathDisplayName(relPath) {
      const parts = String(relPath || "").split("/").filter(Boolean);
      if (!parts.length) return "";
      const out = parts.map((seg, idx) => {
        if (idx !== parts.length - 1) return displayName(seg || "") || "";
        return fileDisplayName(seg || "") || "";
      });
      return out.join("/") || "";
    }

    function folderScoreDisplayMode() {
      const mode = WS.view && typeof WS.view.folderScoreDisplay === "string" ? WS.view.folderScoreDisplay : "hidden";
      if (mode === "show" || mode === "no-arrows" || mode === "hidden") return mode;
      return "hidden";
    }

    function imageThumbWidthForOption() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const m = opt ? String(opt.imageThumbSize || "medium") : "medium";
      if (m === "tiny") return 120;
      if (m === "small") return 220;
      if (m === "high") return 900;
      return 420;
    }

    function videoThumbWidthForOption() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const m = opt ? String(opt.videoThumbSize || "medium") : "medium";
      if (m === "tiny") return 100;
      if (m === "small") return 180;
      if (m === "high") return 520;
      return 240;
    }

    function setOptionsStatus(text) {
      if (!optionsStatusLabel) return;
      optionsStatusLabel.textContent = text || "—";
    }

    function applyDefaultViewFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      if (!opt) return;
      WS.view.filterMode = "all";
      WS.view.randomMode = false;
      WS.view.folderBehavior = String(opt.defaultFolderBehavior || "slide");
      WS.view.folderScoreDisplay = (opt.folderScoreDisplay === "show" || opt.folderScoreDisplay === "no-arrows" || opt.folderScoreDisplay === "hidden") ? opt.folderScoreDisplay : "hidden";
      applyColorSchemeFromOptions();
    }

    function applyColorSchemeFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const scheme = opt ? String(opt.colorScheme || "classic") : "classic";
      const root = document.documentElement;
      if (!root) return;
      if (scheme === "classic") root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", scheme);
    }

    function applyRetroModeFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const on = !!(opt && opt.retroMode);
      if (on) root.setAttribute("data-retro", "on");
      else root.removeAttribute("data-retro");
    }

    function applyMediaFilterFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const appEl = document.getElementById("app");
      if (!appEl) return;
      const filter = opt && opt.mediaFilter ? String(opt.mediaFilter) : "off";
      if (filter && filter !== "off") appEl.setAttribute("data-media-filter", filter);
      else appEl.removeAttribute("data-media-filter");
      const root = document.documentElement;
      if (root) {
        const cfg = (filter && filter !== "off") ? MEDIA_FILTER_CONFIGS[filter] : null;
        const thumbFilter = (cfg && cfg.color && cfg.color !== "none") ? cfg.color : "none";
        root.style.setProperty("--thumb-filter", thumbFilter);
      }
      MEDIA_FILTER_STATE.mode = filter || "off";
      MEDIA_FILTER_STATE.animated = !!(opt && opt.animatedMediaFilters);
      if (!mediaFilterEnabled()) {
        MediaFilterEngine.detach("preview");
        MediaFilterEngine.detach("viewer");
        if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
        if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
        if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
        if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
        appEl.removeAttribute("data-media-filter-engine");
      } else {
        if (VIEWER_MODE) {
          if (viewerVideoEl && viewerVideoEl.style.display !== "none") {
            syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video");
          } else if (viewerImgEl && viewerImgEl.style.display !== "none") {
            syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image");
          }
        }
        if (ACTIVE_MEDIA_SURFACE === "preview") {
          if (previewVideoEl && previewVideoEl.style.display !== "none") {
            syncMediaFilterSurface("preview", previewVideoEl, previewViewportBox, "video");
          } else if (previewImgEl && previewImgEl.style.display !== "none") {
            syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image");
          }
        }
      }
      MediaFilterEngine.requestRender();
    }

    function mediaFilterEnabled() {
      const mode = getMediaFilterForType();
      return (mode && mode !== "off" && !!MEDIA_FILTER_CONFIGS[mode]) || crtOverlayEnabled();
    }

    function syncMediaFilterSurface(surfaceName, mediaEl, container, type) {
      if (!mediaEl || !container) return;
      if (!mediaFilterEnabled()) {
        mediaEl.classList.remove("mediaHidden");
        MediaFilterEngine.detach(surfaceName);
        return;
      }
      MediaFilterEngine.attach(surfaceName, mediaEl, container, type, getMediaFilterForType());
    }

    function clearMediaFilterSurface(surfaceName, mediaEl) {
      MediaFilterEngine.detach(surfaceName);
      if (mediaEl) mediaEl.classList.remove("mediaHidden");
    }

    function applyDisplaySizesFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const mediaSize = opt ? String(opt.mediaThumbUiSize || "medium") : "medium";
      const folderSize = opt ? String(opt.folderPreviewSize || "medium") : "medium";
      if (mediaSize === "medium") root.removeAttribute("data-media-size");
      else root.setAttribute("data-media-size", mediaSize);
      if (folderSize === "medium") root.removeAttribute("data-folder-size");
      else root.setAttribute("data-folder-size", folderSize);
    }

    function applyOptionsEverywhere(invalidateThumbs = false) {
      if (!WS.root) {
        applyColorSchemeFromOptions();
        applyRetroModeFromOptions();
        applyMediaFilterFromOptions();
        applyDisplaySizesFromOptions();
        applyPaneDividerFromOptions();
        syncButtons();
        return;
      }

      if (invalidateThumbs) {
        invalidateAllThumbs();
      }

      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyDisplaySizesFromOptions();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      applyPaneDividerFromOptions();
      applyMediaFilterFromOptions();
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      else if (ACTIVE_MEDIA_SURFACE === "preview") renderPreviewViewerItem(viewerIndex);
    }

    function applyPaneDividerFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const pct = (opt && typeof opt.leftPaneWidthPct === 'number') ? opt.leftPaneWidthPct : (opt && !Number.isNaN(parseFloat(opt.leftPaneWidthPct)) ? parseFloat(opt.leftPaneWidthPct) : 0.28);
      setDividerPositionFromPct(pct);
    }

    function setDividerPositionFromPct(pct) {
      pct = Math.max(0.05, Math.min(0.9, Number(pct) || 0.28));
      const appEl = document.getElementById("app");
      if (!appEl) return;
      appEl.style.gridTemplateColumns = `${(pct * 100).toFixed(2)}% 1fr`;
      const dividerEl = document.getElementById("divider");
      if (dividerEl) {
        const left = Math.round(appEl.clientWidth * pct);
        dividerEl.style.left = left + "px";
      }
    }

    const SAFE_KEY_VALUES = (() => {
      const out = [];
      for (let i = 0; i < 26; i++) out.push(String.fromCharCode(97 + i));
      for (let i = 0; i < 10; i++) out.push(String(i));
      out.push("Space");
      return out;
    })();

    const SAFE_KEY_SET = new Set(SAFE_KEY_VALUES);

    const KEY_LABELS = {
      Escape: "Escape",
      Space: "Space"
    };

    function normalizeKeyValue(key) {
      if (!key) return "";
      if (key === " ") return "Space";
      if (key.length === 1) return key.toLowerCase();
      return key;
    }

    function isSafeKey(key) {
      const norm = normalizeKeyValue(key);
      return SAFE_KEY_SET.has(norm);
    }

    function keyLabel(key) {
      if (!key) return "Unassigned";
      const norm = normalizeKeyValue(key);
      if (KEY_LABELS[norm]) return KEY_LABELS[norm];
      if (norm.length === 1) return norm.toUpperCase();
      return norm;
    }

    const KEYBIND_SECTIONS = [
      { id: "navigation", label: "Navigation" },
      { id: "media", label: "Media" },
      { id: "jump", label: "Jump" },
      { id: "history", label: "History" },
      { id: "global", label: "Global" }
    ];

    const KEYBIND_ACTIONS = [
      { id: "selectUp", label: "Up selection", hint: "Move selection up.", section: "navigation" },
      { id: "selectDown", label: "Down selection", hint: "Move selection down.", section: "navigation" },
      { id: "leaveDir", label: "Up directory", hint: "Go to the parent directory.", section: "navigation" },
      { id: "enterDir", label: "Enter directory", hint: "Enter a folder or open gallery for a file.", section: "navigation" },
      { id: "prevFolder", label: "Previous folder", hint: "Jump to the previous folder's first file.", section: "navigation" },
      { id: "nextFolder", label: "Next folder", hint: "Jump to the next folder's first file.", section: "navigation" },
      { id: "randomJump", label: "Random jump", hint: "Jump to a random file or folder.", section: "navigation" },
      { id: "cycleFilter", label: "Cycle filter", hint: "Cycle the content filter.", section: "navigation" },
      { id: "slideshow", label: "Slideshow mode", hint: "Toggle slideshow.", section: "media" },
      { id: "seekBack", label: "Video skip backward", hint: "Seek video backward.", section: "media" },
      { id: "seekForward", label: "Video skip forward", hint: "Seek video forward.", section: "media" },
      { id: "playPause", label: "Pause/Play video", hint: "Toggle video playback.", section: "media" },
      { id: "muteToggle", label: "Mute/Unmute video", hint: "Toggle video mute.", section: "media" },
      { id: "jumpMinus50", label: "-50 items", hint: "Move selection up by 50 items.", section: "jump" },
      { id: "jumpMinus10", label: "-10 items", hint: "Move selection up by 10 items.", section: "jump" },
      { id: "jumpPlus10", label: "+10 items", hint: "Move selection down by 10 items.", section: "jump" },
      { id: "jumpPlus50", label: "+50 items", hint: "Move selection down by 50 items.", section: "jump" },
      { id: "historyBack", label: "History back", hint: "Go to the previous directory in history.", section: "history" },
      { id: "historyForward", label: "History forward", hint: "Go to the next directory in history.", section: "history" },
      { id: "panic", label: "PANIC!", hint: "Toggle the decoy window mode.", section: "global" },
      { id: "back", label: "Back/Close", hint: "Close overlays or back out of special modes.", section: "global" }
    ];

    const KEYBIND_PRESETS = {
      right: {
        label: "Right-handed (WASD)",
        bindings: {
          selectUp: "w",
          selectDown: "s",
          leaveDir: "a",
          enterDir: "d",
          prevFolder: "b",
          nextFolder: "x",
          randomJump: "r",
          cycleFilter: "f",
          slideshow: "v",
          seekBack: "z",
          seekForward: "c",
          playPause: "Space",
          muteToggle: "m",
          jumpMinus50: "1",
          jumpMinus10: "2",
          jumpPlus10: "3",
          jumpPlus50: "4",
          historyBack: "q",
          historyForward: "e",
          panic: "g",
          back: "Escape"
        }
      },
      left: {
        label: "Left-handed (IJKL)",
        bindings: {
          selectUp: "i",
          selectDown: "k",
          leaveDir: "j",
          enterDir: "l",
          prevFolder: "h",
          nextFolder: "n",
          randomJump: "y",
          cycleFilter: "t",
          slideshow: "b",
          seekBack: "u",
          seekForward: "o",
          playPause: "Space",
          muteToggle: "g",
          jumpMinus50: "7",
          jumpMinus10: "8",
          jumpPlus10: "9",
          jumpPlus50: "0",
          historyBack: "p",
          historyForward: "m",
          panic: "v",
          back: "Escape"
        }
      }
    };

    function defaultKeybinds(presetId) {
      const preset = KEYBIND_PRESETS[presetId] || KEYBIND_PRESETS.right;
      return KEYBIND_ACTIONS.map(def => {
        const key = preset.bindings[def.id] || "";
        return Object.assign({}, def, { key: normalizeKeyValue(key) });
      });
    }

    function enforceUniqueKeybinds(bindings) {
      const used = new Set();
      bindings.forEach((binding) => {
        const key = normalizeKeyValue(binding.key);
        if (!key) { binding.key = ""; return; }
        if (used.has(key)) {
          binding.key = "";
          return;
        }
        used.add(key);
        binding.key = key;
      });
    }

    function normalizeKeybinds(log) {
      const presetId = (log && log.preset && KEYBIND_PRESETS[log.preset]) ? log.preset : "right";
      const bindings = defaultKeybinds(presetId);
      const byId = new Map(bindings.map(b => [b.id, b]));
      if (log && Array.isArray(log.bindings)) {
        for (const entry of log.bindings) {
          if (!entry || !entry.id || !byId.has(entry.id)) continue;
          const key = normalizeKeyValue(entry.key || "");
          if (key && !isSafeKey(key) && !(entry.id === "back" && key === "Escape")) continue;
          byId.get(entry.id).key = key;
        }
      }
      enforceUniqueKeybinds(bindings);
      return { bindings, presetId };
    }

    const KEYBIND_INDEX = new Map();

    function rebuildKeybindIndex() {
      KEYBIND_INDEX.clear();
      const bindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds("right");
      for (const binding of bindings) {
        const key = normalizeKeyValue(binding.key);
        if (!key || KEYBIND_INDEX.has(key)) continue;
        KEYBIND_INDEX.set(key, binding.id);
      }
    }

    function keybindActionFor(key) {
      return KEYBIND_INDEX.get(key) || null;
    }

    const WS = {
      root: null,
      fileById: new Map(),   // id -> FileRecord
      dirByPath: new Map(),  // path -> DirNode

      meta: {
        dirScores: new Map(),
        dirTags: new Map(),
        dirFingerprints: new Map(),
        dirSortMode: "name",
        storageMode: "local",
        storageKey: "",
        fsRootHandle: null,
        fsSysDirHandle: null,
        fsScoresFileHandle: null,
        fsTagsFileHandle: null,
        fsOptionsFileHandle: null,
        fsLegacyFileHandle: null,
        fsKeybindsFileHandle: null,
        saveTimer: null,
        dirty: false,
        options: normalizeOptions(null),
        keybinds: defaultKeybinds("right"),
        keybindsPreset: "right"
      },

      view: {
        filterMode: "all",
        randomMode: false,
        loopWithinDir: false,
        folderBehavior: "slide",
        folderScoreDisplay: "hidden",
        randomSeed: 0,
        randomCache: new Map(),
        dirLoopRepeats: 3,
        previewLoopRepeats: 3,
        loopMaxRepeats: 200,
        slideshowDurations: [0, 1000, 3000, 5000, 10000],
        slideshowModeIndex: 0,
        slideshowActive: false,
        slideshowTimer: null,
        statusTimeout: null,
        scrollBusyDirs: false,
        scrollBusyPreview: false,
        pendingDirScroll: "",
        bulkSelectMode: false,
        bulkTagSelectedPaths: new Set(),
        bulkTagSelectionsByDir: new Map(),
        bulkFileSelectedIds: new Set(),
        bulkFileSelectionsByDir: new Map(),
        bulkActionMenuOpen: false,
        bulkActionMenuAnchorPath: "",
        dirActionMenuPath: "",
        tagFolderActiveMode: "",
        tagFolderActiveTag: "",
        tagFolderOriginPath: "",
        tagNavStack: [],
        dirSearchPinned: false,
        dirSearchQuery: "",
        dirHistory: [],
        dirHistoryIndex: -1,
        dirSelectAnchorIndex: -1,
        fileActionMenuId: "",
        favoritesMode: false,
        favoritesRootActive: false,
        favoritesAnchorPath: "",
        favoritesReturnState: null,
        hiddenMode: false,
        hiddenRootActive: false,
        hiddenAnchorPath: "",
        hiddenReturnState: null,
        searchRootActive: false,
        searchRootPath: "",
        searchAnchorPath: "",
        searchEntryRootPath: "",
        searchRootIsFavorites: false,
        searchRootFavorites: [],
        searchRootIsHidden: false,
        searchRootHidden: [],
        searchResults: []
      },

      // Directories Pane navigation state
      nav: {
        dirNode: null,       // current directory listed in Directories Pane
        entries: [],         // [{kind:"dir", node},{kind:"file", id}]
        selectedIndex: 0
      },

      // Preview target derived from Directories selection
      preview: {
        kind: null,          // "dir"|"file"|null
        dirNode: null,
        fileId: null
      },

      // video thumbs
      videoThumbQueue: [],
      videoThumbActive: 0,

      // image thumbs
      imageThumbQueue: [],
      imageThumbActive: 0
    };

    /* FileRecord:
       {
         id, file, name, relPath, dirPath, ext, type,
         size, lastModified,
         url, thumbUrl, videoThumbUrl,
         indices
       }
    */

    function revokeAllObjectURLs() {
      for (const it of WS.fileById.values()) {
        try { if (it.url) URL.revokeObjectURL(it.url); } catch {}
        try { if (it.thumbUrl) URL.revokeObjectURL(it.thumbUrl); } catch {}
        try { if (it.videoThumbUrl) URL.revokeObjectURL(it.videoThumbUrl); } catch {}
        it.url = null;
        it.thumbUrl = null;
        it.videoThumbUrl = null;
        it.thumbMode = null;
        it.videoThumbMode = null;
      }
    }

    function resetWorkspace() {
      revokeAllObjectURLs();
      WS.root = null;
      WS.fileById.clear();
      WS.dirByPath.clear();
      DIR_HANDLE_CACHE = new Map();

      WS.meta.dirScores.clear();
      WS.meta.dirTags.clear();
      WS.meta.dirFingerprints.clear();
      WS.meta.dirSortMode = "name";
      WS.meta.storageMode = "local";
      WS.meta.storageKey = "";
      WS.meta.fsRootHandle = null;
      WS.meta.fsSysDirHandle = null;
      WS.meta.fsScoresFileHandle = null;
      WS.meta.fsTagsFileHandle = null;
      WS.meta.fsOptionsFileHandle = null;
      WS.meta.fsLegacyFileHandle = null;
      WS.meta.fsKeybindsFileHandle = null;
      WS.meta.dirty = false;
      WS.meta.options = normalizeOptions(null);
      WS.meta.keybinds = defaultKeybinds("right");
      WS.meta.keybindsPreset = "right";
      if (WS.meta.saveTimer) { clearTimeout(WS.meta.saveTimer); WS.meta.saveTimer = null; }

      applyDefaultViewFromOptions();
      rebuildKeybindIndex();
      WS.view.loopWithinDir = false;
      WS.view.randomSeed = 0;
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;
      WS.view.slideshowModeIndex = 0;
      WS.view.slideshowActive = false;
      WS.view.bulkSelectMode = false;
      WS.view.bulkTagSelectedPaths = new Set();
      WS.view.bulkTagSelectionsByDir = new Map();
      WS.view.bulkFileSelectedIds = new Set();
      WS.view.bulkFileSelectionsByDir = new Map();
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.dirActionMenuPath = "";
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderOriginPath = "";
      WS.view.tagNavStack = [];
      WS.view.dirSearchPinned = false;
      WS.view.dirSearchQuery = "";
      WS.view.dirHistory = [];
      WS.view.dirHistoryIndex = -1;
      WS.view.dirSelectAnchorIndex = -1;
      WS.view.fileActionMenuId = "";
      WS.view.favoritesMode = false;
      WS.view.favoritesRootActive = false;
      WS.view.favoritesAnchorPath = "";
      WS.view.favoritesReturnState = null;
      WS.view.hiddenMode = false;
      WS.view.hiddenRootActive = false;
      WS.view.hiddenAnchorPath = "";
      WS.view.hiddenReturnState = null;
      WS.view.searchRootActive = false;
      WS.view.searchRootPath = "";
      WS.view.searchAnchorPath = "";
      WS.view.searchEntryRootPath = "";
      WS.view.searchRootIsFavorites = false;
      WS.view.searchRootFavorites = [];
      WS.view.searchRootIsHidden = false;
      WS.view.searchRootHidden = [];
      WS.view.searchResults = [];
      if (WS.view.slideshowTimer) { clearInterval(WS.view.slideshowTimer); WS.view.slideshowTimer = null; }
      if (WS.view.statusTimeout) { clearTimeout(WS.view.statusTimeout); WS.view.statusTimeout = null; }

      WS.nav.dirNode = null;
      WS.nav.entries = [];
      WS.nav.selectedIndex = 0;

      WS.preview.kind = null;
      WS.preview.dirNode = null;
      WS.preview.fileId = null;

      WS.videoThumbQueue = [];
      WS.videoThumbActive = 0;

      WS.imageThumbQueue = [];
      WS.imageThumbActive = 0;
      PRELOAD_CACHE = new Map();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      syncMetaButtons();
      renderOptionsUi();
    }

    function clearWorkspaceEmptyState() {
      if (directoriesListEl) directoriesListEl.innerHTML = "";
      if (previewBodyEl) previewBodyEl.innerHTML = "";
    }

    /* =========================================================
       UI references
       ========================================================= */

    const $ = (id) => document.getElementById(id);

    // Title Pane
    const keybindsBtn = $("keybindsBtn");
    const helpBtn = $("helpBtn");
    const optionsBtn = $("optionsBtn");
    const refreshBtn = $("refreshBtn");
    const openWritableBtn = $("openWritableBtn");
    const titleLabel = $("titleLabel");

    // Help Overlay
    const helpOverlay = $("helpOverlay");
    const helpCloseBtn = $("helpCloseBtn");
    const helpBodyEl = $("helpBody");
    const helpHoldOverlay = $("helpHoldOverlay");
    const helpCard = $("helpCard");
    const helpHeader = $("helpHeader");

    // Options Overlay
    const optionsOverlay = $("optionsOverlay");
    const optionsCloseBtn = $("optionsCloseBtn");
    const optionsBodyEl = $("optionsBody");
    const optionsResetBtn = $("optionsResetBtn");
    const optionsDoneBtn = $("optionsDoneBtn");
    const optionsStatusLabel = $("optionsStatusLabel");
    const optionsCard = $("optionsCard");
    const optionsHeader = $("optionsHeader");

    // Keybinds Overlay
    const keybindsOverlay = $("keybindsOverlay");
    const keybindsCloseBtn = $("keybindsCloseBtn");
    const keybindsBodyEl = $("keybindsBody");
    const keybindsResetBtn = $("keybindsResetBtn");
    const keybindsDoneBtn = $("keybindsDoneBtn");
    const keybindsStatusLabel = $("keybindsStatusLabel");
    const keybindsCard = $("keybindsCard");
    const keybindsHeader = $("keybindsHeader");

    const overlayWindowStates = {
      help: { x: null, y: null, width: null, height: null },
      options: { x: null, y: null, width: null, height: null },
      keybinds: { x: null, y: null, width: null, height: null }
    };
    const overlayCards = {
      help: helpCard,
      options: optionsCard,
      keybinds: keybindsCard
    };
    const overlayCardHeaders = {
      help: helpHeader,
      options: optionsHeader,
      keybinds: keybindsHeader
    };
    const overlayWindowNames = Object.keys(overlayWindowStates);
    const overlayResizeObserver = (typeof ResizeObserver === "function") ? new ResizeObserver((entries) => {
      for (const entry of entries) {
        const name = entry.target.dataset.overlayName;
        const state = overlayWindowStates[name];
        if (!state) continue;
        const width = entry.contentRect.width || state.width || (entry.target.offsetWidth || 0);
        const height = entry.contentRect.height || state.height || (entry.target.offsetHeight || 0);
        if (!width || !height) continue;
        state.width = width;
        state.height = height;
        clampOverlayWindowPosition(name, state.x, state.y);
      }
    }) : null;

    function clampOverlayWindowPosition(name, desiredX, desiredY) {
      const card = overlayCards[name];
      const state = overlayWindowStates[name];
      if (!card || !state) return;
      const rect = card.getBoundingClientRect();
      const width = rect.width || state.width || card.offsetWidth || 0;
      const height = rect.height || state.height || card.offsetHeight || 0;
      if (!width || !height) return;
      const maxX = Math.max(8, window.innerWidth - width - 8);
      const maxY = Math.max(8, window.innerHeight - height - 8);
      let x = (typeof desiredX === "number") ? desiredX : (typeof state.x === "number" ? state.x : (window.innerWidth - width) / 2);
      let y = (typeof desiredY === "number") ? desiredY : (typeof state.y === "number" ? state.y : (window.innerHeight - height) / 2);
      x = Math.min(maxX, Math.max(8, x));
      y = Math.min(maxY, Math.max(8, y));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      state.x = x;
      state.y = y;
      state.width = width;
      state.height = height;
    }

    function applyOverlayWindowState(name) {
      const card = overlayCards[name];
      const state = overlayWindowStates[name];
      if (!card || !state) return;
      if (state.width) card.style.width = `${state.width}px`;
      else card.style.removeProperty("width");
      if (state.height) card.style.height = `${state.height}px`;
      else card.style.removeProperty("height");
      clampOverlayWindowPosition(name);
    }

    function registerOverlayWindow(name, card, header) {
      if (!card) return;
      card.dataset.overlayName = name;
      if (overlayResizeObserver) overlayResizeObserver.observe(card);

      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let activePointerId = null;

      const onPointerMove = (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        const rect = card.getBoundingClientRect();
        const nextX = rect.left + (ev.clientX - lastX);
        const nextY = rect.top + (ev.clientY - lastY);
        lastX = ev.clientX;
        lastY = ev.clientY;
        clampOverlayWindowPosition(name, nextX, nextY);
      };

      const stopDrag = () => {
        if (!dragging) return;
        dragging = false;
        if (header && activePointerId !== null) {
          try { header.releasePointerCapture(activePointerId); } catch (e) {}
        }
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", stopDrag);
        document.removeEventListener("pointercancel", stopDrag);
        card.classList.remove("overlayCardDragging");
        activePointerId = null;
      };

      if (header) {
        header.addEventListener("pointerdown", (ev) => {
          if (ev.button !== 0) return;
          if (ev.target && ev.target.closest && ev.target.closest("button")) return;
          ev.preventDefault();
          dragging = true;
          lastX = ev.clientX;
          lastY = ev.clientY;
          activePointerId = ev.pointerId;
          try { header.setPointerCapture(activePointerId); } catch (e) {}
          document.addEventListener("pointermove", onPointerMove);
          document.addEventListener("pointerup", stopDrag);
          document.addEventListener("pointercancel", stopDrag);
          card.classList.add("overlayCardDragging");
        });
      }
    }

    overlayWindowNames.forEach((name) => {
      registerOverlayWindow(name, overlayCards[name], overlayCardHeaders[name]);
    });

    window.addEventListener("resize", () => {
      overlayWindowNames.forEach((name) => applyOverlayWindowState(name));
    });

    // Directories Pane
    const directoriesListEl = $("directoriesList");
    const directoriesHeader = $("directoriesHeader");
    const favoritesBtn = $("favoritesBtn");
    const hiddenBtn = $("hiddenBtn");
    const directoriesTagsRowEl = $("directoriesTagsRow");
    const directoriesActionRowEl = $("directoriesActionRow");
    const directoriesSelectAllBtn = $("directoriesSelectAllBtn");
    const directoriesActionMenuEl = $("directoriesActionMenu");
    const directoriesBulkRowEl = $("directoriesBulkRow");
    const directoriesSearchInput = $("directoriesSearchInput");
    const directoriesSearchClearBtn = $("directoriesSearchClearBtn");
    const tagActionMenuEl = $("tagActionMenu");
    if (tagActionMenuEl) {
      tagActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
    }
    const dirBackBtn = $("dirBackBtn");
    const dirForwardBtn = $("dirForwardBtn");
    const dirUpBtn = $("dirUpBtn");
    const busyOverlay = $("busyOverlay");
    const busyLabel = $("busyLabel");

    // Preview Pane
    const modePill = $("modePill");
    const itemsPill = $("itemsPill");
    const previewBodyEl = $("previewBody");

    /* Gallery Mode (Overlay) */
    const overlay = $("overlay");
    const viewport = $("viewerViewport");
    const closeBtn = $("closeBtn");
    const filenameEl = $("filename");

    const statusMessageEl = document.createElement("div");
    statusMessageEl.id = "statusMessage";
    overlay.appendChild(statusMessageEl);

    const mainStatusMessageEl = document.createElement("div");
    mainStatusMessageEl.id = "mainStatusMessage";
    document.body.appendChild(mainStatusMessageEl);

    const banicOverlayEl = document.createElement("div");
    banicOverlayEl.id = "banicOverlay";
    document.body.appendChild(banicOverlayEl);

    let VIEWER_MODE = false;
    let viewerDirNode = null;
    let viewerItems = []; // { isFolder, dirNode } or { isFolder:false, id }
    let viewerIndex = 0;
    let uiHideTimer = null;

    let viewerImgEl = null;
    let viewerVideoEl = null;
    let viewerFolderEl = null;

    let DIR_HANDLE_CACHE = new Map();

    let previewViewportBox = null;
    let previewImgEl = null;
    let previewVideoEl = null;
    let previewFolderEl = null;

    // Divider setup: attach drag handlers and initialize position
    (function setupDivider() {
      const appEl = document.getElementById("app");
      const divider = document.getElementById("divider");
      if (!appEl || !divider) return;

      let dragging = false;
      let activePointerId = null;

      function onMoveClientX(clientX) {
        const rect = appEl.getBoundingClientRect();
        const min = Math.max(180, Math.round(rect.width * 0.12));
        const max = Math.max(min + 50, rect.width - 200);
        let left = Math.min(Math.max(clientX - rect.left, min), max);
        const pct = left / rect.width;
        WS.meta.options.leftPaneWidthPct = pct;
        setDividerPositionFromPct(pct);
      }

      divider.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        dragging = true;
        activePointerId = ev.pointerId;
        try { divider.setPointerCapture(activePointerId); } catch (e) {}
      });

      document.addEventListener('pointermove', (ev) => {
        if (!dragging) return;
        onMoveClientX(ev.clientX);
      });

      document.addEventListener('pointerup', (ev) => {
        if (!dragging) return;
        dragging = false;
        try { divider.releasePointerCapture(activePointerId); } catch (e) {}
        activePointerId = null;
        if (typeof metaScheduleSave === 'function') metaScheduleSave();
      });

      window.addEventListener('resize', () => { applyPaneDividerFromOptions(); });

      // initial apply from saved options
      applyPaneDividerFromOptions();
      applyMediaFilterFromOptions();
    })();

    let MAIN_STATUS_TIMEOUT = null;

    let ACTIVE_MEDIA_SURFACE = "none";

    let PREVIEW_VIDEO_PAUSE = { active: false, fileId: null, time: 0, wasPlaying: false };

    let VIDEO_CARRY = { active: false, fileId: null, time: 0, wasPlaying: false };

    let PRELOAD_CACHE = new Map();

    let TAG_EDIT_PATH = null;
    let TAG_CONTEXT_MENU_STATE = null;
    let TAG_ENTRY_RENAME_STATE = null;
    let BULK_TAG_PLACEHOLDER = null;
    let RENAME_EDIT_PATH = null;
    let RENAME_EDIT_FILE_ID = null;
    let RENAME_BUSY = false;

    let HELP_OPEN = false;
    let OPTIONS_OPEN = false;
    let KEYBINDS_OPEN = false;
    let HELP_HOLD_ACTIVE = false;
    let PROPERTIES_OPEN = false;

    let BANIC_ACTIVE = false;
    let BANIC_STATE = { preview: null, viewer: null, slideshowWasActive: false };
    const BANIC_LINKS = [
      "https://www.youtube.com/",
      "https://www.google.com/",
      "https://www.coolmathgames.com/",
      "https://www.wikipedia.org/",
      "https://www.nasa.gov/"
    ];

    /* =========================================================
       Status/progress helpers
       ========================================================= */

    function clamp01(x) { return Math.max(0, Math.min(1, x)); }

    function showMainStatusMessage(text) {
      mainStatusMessageEl.textContent = text || "";
      mainStatusMessageEl.classList.add("visible");
      if (MAIN_STATUS_TIMEOUT) { clearTimeout(MAIN_STATUS_TIMEOUT); MAIN_STATUS_TIMEOUT = null; }
      MAIN_STATUS_TIMEOUT = setTimeout(() => {
        mainStatusMessageEl.classList.remove("visible");
      }, 1200);
    }

    function showStatusMessage(text) {
      if (VIEWER_MODE) {
        statusMessageEl.textContent = text || "";
        statusMessageEl.classList.add("visible");
        if (WS.view.statusTimeout) {
          clearTimeout(WS.view.statusTimeout);
          WS.view.statusTimeout = null;
        }
        WS.view.statusTimeout = setTimeout(() => {
          statusMessageEl.classList.remove("visible");
        }, 1200);
        return;
      }
      showMainStatusMessage(text);
    }

    function showSlideshowMessage(text) {
      if (VIEWER_MODE) {
        showStatusMessage(text);
        return;
      }
      showMainStatusMessage(text);
    }

    function captureVideoState(vid) {
      if (!vid) return null;
      return {
        muted: !!vid.muted,
        paused: !!vid.paused
      };
    }

    function applyBanicState(active) {
      if (active === BANIC_ACTIVE) return;
      BANIC_ACTIVE = active;

      if (BANIC_ACTIVE) {
        BANIC_STATE.preview = captureVideoState(previewVideoEl);
        BANIC_STATE.viewer = captureVideoState(viewerVideoEl);
        BANIC_STATE.slideshowWasActive = WS.view.slideshowActive;

        if (WS.view.slideshowActive) stopSlideshow();

        const vids = Array.from(document.querySelectorAll("video"));
        vids.forEach((vid) => {
          try { vid.pause(); } catch {}
          vid.muted = true;
        });
        banicOverlayEl.classList.add("active");
        const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
        const shouldOpenWindow = !opt || opt.banicOpenWindow !== false;
        if (shouldOpenWindow) {
          const link = BANIC_LINKS[Math.floor(Math.random() * BANIC_LINKS.length)];
          try {
            const win = window.open(link, "_blank");
            if (win && win.focus) win.focus();
          } catch {}
        }
        return;
      }

      banicOverlayEl.classList.remove("active");
      const restore = (vid, state) => {
        if (!vid || !state) return;
        vid.muted = !!state.muted;
        if (!state.paused) { try { vid.play(); } catch {} }
      };
      restore(previewVideoEl, BANIC_STATE.preview);
      restore(viewerVideoEl, BANIC_STATE.viewer);
      if (BANIC_STATE.slideshowWasActive) {
        const mode = slideshowBehavior();
        if (mode === "cycle") {
          const ms = WS.view.slideshowDurations[WS.view.slideshowModeIndex] | 0;
          if (ms) startSlideshow(ms);
        } else {
          const seconds = parseInt(mode, 10);
          if (Number.isFinite(seconds) && seconds > 0) startSlideshow(seconds * 1000);
        }
      }
      BANIC_STATE = { preview: null, viewer: null, slideshowWasActive: false };
    }

    function updateModePill() {
      if (!modePill) return;
      const defs = defaultOptions();
      const parts = [];
      const filterMode = WS.view.filterMode;
      const filterLabel = filterMode === "all" ? "All" : (filterMode === "images" ? "Images only" : (filterMode === "videos" ? "Videos only" : "GIFs only"));
      if (filterMode !== "all") {
        parts.push(`Content filter: ${filterLabel}`);
      }

      const behaviorLabel = WS.view.folderBehavior === "loop" ? "Loop" : (WS.view.folderBehavior === "slide" ? "Slide" : "Stop");
      if (WS.view.folderBehavior !== (defs.defaultFolderBehavior || "slide")) {
        parts.push(`Folder behavior: ${behaviorLabel}`);
      }

      if (WS.meta.dirSortMode === "score") {
        parts.push("Dir sort: Score");
      }

      modePill.textContent = parts.length ? parts.join(" | ") : "Mode: default";
    }

    function getCurrentTitleText() {
      const path = getDirectoriesPathText();
      return path || "—";
    }

    function updateTitleLabel() {
      if (!titleLabel) return;
      titleLabel.textContent = getCurrentTitleText();
    }

    function syncMetaButtons() {
      syncFavoritesUi();
      syncHiddenUi();
    }

    /* =========================================================
       Help overlay
       ========================================================= */

    const HELP_MD_FALLBACK = "Help content is unavailable. Check help.md.";
    let HELP_MD_CACHE = null;

    function renderInlineMarkdown(text) {
      const parts = String(text || "").split("`");
      return parts.map((part, idx) => {
        const safe = escapeHtml(part);
        return (idx % 2) ? `<code>${safe}</code>` : safe;
      }).join("");
    }

    function markdownToHtml(md) {
      const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
      let out = "";
      let inList = false;
      let sawBody = false;

      const closeList = () => {
        if (!inList) return;
        out += "</ul>";
        inList = false;
      };

      for (const raw of lines) {
        const line = raw.trimEnd();
        if (!line.trim()) {
          closeList();
          continue;
        }
        if (line.startsWith("## ")) {
          closeList();
          out += `<h2>${renderInlineMarkdown(line.slice(3).trim())}</h2>`;
          sawBody = true;
          continue;
        }
        if (line.startsWith("- ")) {
          if (!inList) {
            out += "<ul>";
            inList = true;
          }
          out += `<li>${renderInlineMarkdown(line.slice(2).trim())}</li>`;
          sawBody = true;
          continue;
        }
        closeList();
        if (!sawBody) {
          out += `<div class="label" style="margin-bottom:8px;">${renderInlineMarkdown(line.trim())}</div>`;
        } else {
          out += `<p>${renderInlineMarkdown(line.trim())}</p>`;
        }
        sawBody = true;
      }
      closeList();
      return out || `<div class="label">${escapeHtml(HELP_MD_FALLBACK)}</div>`;
    }

    async function loadHelpMarkdown() {
      if (HELP_MD_CACHE !== null) return HELP_MD_CACHE;
      try {
        const res = await fetch("help.md", { cache: "no-store" });
        if (!res.ok) throw new Error("help.md not found");
        const text = await res.text();
        HELP_MD_CACHE = text;
      } catch {
        HELP_MD_CACHE = HELP_MD_FALLBACK;
      }
      return HELP_MD_CACHE;
    }

    async function openHelp() {
      HELP_OPEN = true;
      if (helpOverlay) helpOverlay.classList.add("active");
      requestAnimationFrame(() => applyOverlayWindowState("help"));
      if (!helpBodyEl) return;
      helpBodyEl.innerHTML = `<div class="label">Loading help...</div>`;
      const md = await loadHelpMarkdown();
      helpBodyEl.innerHTML = markdownToHtml(md);
    }

    function closeHelp() {
      HELP_OPEN = false;
      if (helpOverlay) helpOverlay.classList.remove("active");
    }

    function setHelpHold(active) {
      if (active === HELP_HOLD_ACTIVE) return;
      HELP_HOLD_ACTIVE = active;
      if (helpHoldOverlay) helpHoldOverlay.classList.toggle("active", HELP_HOLD_ACTIVE);
    }

    if (helpBtn) helpBtn.addEventListener("click", () => openHelp());
    if (helpCloseBtn) helpCloseBtn.addEventListener("click", () => closeHelp());

    /* =========================================================
       Options overlay
       ========================================================= */

    function openOptions() {
      OPTIONS_OPEN = true;
      if (optionsOverlay) optionsOverlay.classList.add("active");
      requestAnimationFrame(() => applyOverlayWindowState("options"));
      renderOptionsUi();
      setOptionsStatus("Saved automatically");
    }

    function closeOptions() {
      OPTIONS_OPEN = false;
      if (optionsOverlay) optionsOverlay.classList.remove("active");
    }

    /* =========================================================
       Keybinds overlay
       ========================================================= */

    function setKeybindsStatus(text) {
      if (!keybindsStatusLabel) return;
      keybindsStatusLabel.textContent = text || "—";
    }

    function openKeybinds() {
      KEYBINDS_OPEN = true;
      if (keybindsOverlay) keybindsOverlay.classList.add("active");
      requestAnimationFrame(() => applyOverlayWindowState("keybinds"));
      renderKeybindsUi();
      setKeybindsStatus("Saved automatically");
    }

    function closeKeybinds() {
      KEYBINDS_OPEN = false;
      if (keybindsOverlay) keybindsOverlay.classList.remove("active");
    }

    function applyKeybindPreset(presetId) {
      const preset = KEYBIND_PRESETS[presetId] ? presetId : "right";
      WS.meta.keybindsPreset = preset;
      WS.meta.keybinds = defaultKeybinds(preset);
      rebuildKeybindIndex();
      WS.meta.dirty = true;
      metaScheduleSave();
      renderKeybindsUi();
      setKeybindsStatus("Preset applied");
    }

    function renderKeybindsUi() {
      if (!keybindsBodyEl) return;
      const bindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds("right");
      const presetId = (WS.meta && WS.meta.keybindsPreset && KEYBIND_PRESETS[WS.meta.keybindsPreset]) ? WS.meta.keybindsPreset : "right";

      const bySection = new Map();
      for (const binding of bindings) {
        if (!bySection.has(binding.section)) bySection.set(binding.section, []);
        bySection.get(binding.section).push(binding);
      }

      const makeOptions = (selected, allowEscape = false) => {
        const opts = [];
        opts.push(`<option value="">Unassigned</option>`);
        if (allowEscape || selected === "Escape") {
          const selectedAttr = selected === "Escape" ? " selected" : "";
          opts.push(`<option value="Escape"${selectedAttr}>Escape</option>`);
        }
        for (const key of SAFE_KEY_VALUES) {
          const val = escapeHtml(key);
          const label = escapeHtml(keyLabel(key));
          const isSelected = key === selected ? " selected" : "";
          opts.push(`<option value="${val}"${isSelected}>${label}</option>`);
        }
        return opts.join("");
      };

      let html = `<div class="label" style="margin-bottom:8px;">Keybinds are stored in keyboard-configuration.log.json in the .local-gallery folder. Escape always closes overlays.</div>`;
      html += `
        <div class="optRow">
          <div class="optLeft">
            <div class="optTitle">Preset</div>
            <div class="optHint">Apply a left/right-handed base layout.</div>
          </div>
          <div class="optRight">
            <select id="keybindPresetSelect">
              ${Object.entries(KEYBIND_PRESETS).map(([id, preset]) => {
                const selected = id === presetId ? " selected" : "";
                return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(preset.label)}</option>`;
              }).join("")}
            </select>
          </div>
        </div>
      `;

      for (const section of KEYBIND_SECTIONS) {
        const list = bySection.get(section.id) || [];
        if (!list.length) continue;
        html += `<h1>${escapeHtml(section.label)}</h1>`;
        for (const binding of list) {
          const selected = binding.key || "";
          const allowEscape = binding.id === "back";
          html += `
            <div class="optRow">
              <div class="optLeft">
                <div class="optTitle">${escapeHtml(binding.label)}</div>
                <div class="optHint">${escapeHtml(binding.hint)}</div>
              </div>
              <div class="optRight">
                <select data-bind-id="${escapeHtml(binding.id)}">${makeOptions(selected, allowEscape)}</select>
              </div>
            </div>
          `;
        }
      }

      keybindsBodyEl.innerHTML = html;

      const presetSelect = keybindsBodyEl.querySelector("#keybindPresetSelect");
      if (presetSelect) {
        presetSelect.addEventListener("click", (e) => e.stopPropagation());
        presetSelect.addEventListener("keydown", (e) => e.stopPropagation());
        presetSelect.addEventListener("change", () => {
          applyKeybindPreset(presetSelect.value);
        });
      }

      const selects = keybindsBodyEl.querySelectorAll("select[data-bind-id]");
      selects.forEach((sel) => {
        sel.addEventListener("click", (e) => e.stopPropagation());
        sel.addEventListener("keydown", (e) => e.stopPropagation());
        sel.addEventListener("change", () => {
          const id = sel.getAttribute("data-bind-id");
          if (!id || !WS.meta || !Array.isArray(WS.meta.keybinds)) return;
          const binding = WS.meta.keybinds.find(b => b.id === id);
          if (!binding) return;

          const nextKey = normalizeKeyValue(sel.value || "");
          if (nextKey && !isSafeKey(nextKey) && !(binding.id === "back" && nextKey === "Escape")) return;

          const prevKey = binding.key || "";
          if (nextKey === prevKey) return;

          const conflict = nextKey
            ? WS.meta.keybinds.find(b => b.id !== binding.id && b.key === nextKey)
            : null;

          binding.key = nextKey;
          if (conflict) conflict.key = prevKey;

          rebuildKeybindIndex();
          WS.meta.dirty = true;
          metaScheduleSave();
          setKeybindsStatus("Saved");

          if (conflict) {
            const otherSelect = keybindsBodyEl.querySelector(`select[data-bind-id="${conflict.id}"]`);
            if (otherSelect) otherSelect.value = conflict.key || "";
          }
        });
      });
    }

    function resetKeybindsToDefaults() {
      const presetId = (WS.meta && WS.meta.keybindsPreset && KEYBIND_PRESETS[WS.meta.keybindsPreset]) ? WS.meta.keybindsPreset : "right";
      WS.meta.keybinds = defaultKeybinds(presetId);
      rebuildKeybindIndex();
      WS.meta.dirty = true;
      metaScheduleSave();
      renderKeybindsUi();
      setKeybindsStatus("Reset");
    }

    function renderOptionsUi() {
      if (!optionsBodyEl) return;
      const opt = WS.meta && WS.meta.options ? WS.meta.options : normalizeOptions(null);

      const makeSelectRow = (title, hint, id, value, items) => {
        const opts = items.map(it => `<option value="${escapeHtml(it.value)}"${it.value === value ? " selected" : ""}>${escapeHtml(it.label)}</option>`).join("");
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight">
              <select id="${escapeHtml(id)}">${opts}</select>
            </div>
          </div>
        `;
      };

      const makeCheckRow = (title, hint, id, checked) => {
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight">
              <input id="${escapeHtml(id)}" type="checkbox"${checked ? " checked" : ""} />
            </div>
          </div>
        `;
      };

      const vidModes = [
        { value: "unmuted", label: "Auto-play unmuted" },
        { value: "muted", label: "Auto-play muted" },
        { value: "off", label: "No autoplay" }
      ];

      const folderModes = [
        { value: "stop", label: "Stop" },
        { value: "loop", label: "Loop" },
        { value: "slide", label: "Slide" }
      ];

      const dirSortModes = [
        { value: "name", label: "Name" },
        { value: "score", label: "Score" }
      ];

      const skipSteps = [
        { value: "3", label: "3 seconds" },
        { value: "5", label: "5 seconds" },
        { value: "10", label: "10 seconds" },
        { value: "30", label: "30 seconds" }
      ];

      const preloadModes = [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
        { value: "ultra", label: "Ultra" }
      ];

      const videoEndModes = [
        { value: "loop", label: "Loop video" },
        { value: "next", label: "Advance to next item" },
        { value: "stop", label: "Stop at end" }
      ];

      const slideshowModes = [
        { value: "cycle", label: "Cycle speeds" },
        { value: "1", label: "Toggle 1s" },
        { value: "3", label: "Toggle 3s" },
        { value: "5", label: "Toggle 5s" },
        { value: "10", label: "Toggle 10s" }
      ];

      const thumbModes = [
        { value: "tiny", label: "Tiny" },
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "high", label: "High" }
      ];

      const previewModes = [
        { value: "grid", label: "Grid" },
        { value: "expanded", label: "Expanded" }
      ];


      const previewSizeModes = [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" }
      ];

      const folderScoreModes = [
        { value: "show", label: "Show score + arrows" },
        { value: "no-arrows", label: "Hide arrows" },
        { value: "hidden", label: "Hide score + arrows" }
      ];

      const colorSchemes = [
        { value: "classic", label: "Classic Dark" },
        { value: "light", label: "Light" },
        { value: "superdark", label: "Super Dark" },
        { value: "synthwave", label: "Synthwave" },
        { value: "verdant", label: "Verdant" },
        { value: "azure", label: "Azure" },
        { value: "ember", label: "Ember" },
        { value: "amber", label: "Amber" },
        { value: "retro90s", label: "Retro 90s" },
        { value: "retro90s-dark", label: "Retro 90s Dark" }
      ];

      const mediaFilterModes = [
        /* media filters: names */
       { value: "off", label: "Off" },
       { value: "vibrant", label: "Vibrant" },
       { value: "cinematic", label: "Cinematic" },
       { value: "orangeTeal", label: "Orange+Teal" },
       { value: "uv", label: "UV Camera" }/*
       { value: "cinematic", label: "Cinematic" },
       { value: "soft", label: "Soft" }*/
      ];

      optionsBodyEl.innerHTML = `
        <div class="label" style="margin-bottom:8px;">Option preferences are automatically stored in preferences.log.json in the .local-gallery system folder in the root directory.</div>

<h1>General</h1>
${makeSelectRow("Folder sort", "Sort folders by name or score.", "opt_dirSortMode", WS.meta.dirSortMode === "score" ? "score" : "name", dirSortModes)}
${makeSelectRow("Folder scores", "Choose how folder scores appear in lists + previews.", "opt_folderScoreDisplay", String(opt.folderScoreDisplay || "hidden"), folderScoreModes)}
${makeSelectRow("Folder behavior", "Sets how folders behave when browsing.", "opt_defaultFolderBehavior", String(opt.defaultFolderBehavior || "slide"), folderModes)}
${makeCheckRow("PANIC! opens decoy window", "When enabled, PANIC! opens a harmless site in a new window.", "opt_banicOpenWindow", opt.banicOpenWindow !== false)}
${makeCheckRow("Show Hidden Folder", "Display a dedicated hidden-folder tag near the top of the directories pane when tag folders are enabled.", "opt_showHiddenFolder", !!opt.showHiddenFolder)}

<h1>Appearance</h1>
${makeSelectRow("Color scheme", "Switch the overall interface palette.", "opt_colorScheme", String(opt.colorScheme || "classic"), colorSchemes)}
${makeCheckRow("Retro Mode", "Pixelated, low-res UI styling across themes.", "opt_retroMode", !!opt.retroMode)}
${makeSelectRow("Media filter", "Apply a visual filter to media.", "opt_mediaFilter", String(opt.mediaFilter || "off"), mediaFilterModes)}
${makeCheckRow("CRT overlay", "CRT scanlines/grain with fixed intermediate pixelation.", "opt_crtOverlayEnabled", !!opt.crtOverlayEnabled)}
${makeCheckRow("Animated filters", "When enabled, scanlines/grain/jitter animate.", "opt_animatedMediaFilters", opt.animatedMediaFilters !== false)}

<h1>Playback</h1>
${makeSelectRow("Video audio (preview)", "Controls autoplay + mute in the in-pane preview player.", "opt_videoPreview", String(opt.videoPreview || "muted"), vidModes)}
${makeSelectRow("Video audio (gallery)", "Controls autoplay + mute in fullscreen gallery mode.", "opt_videoGallery", String(opt.videoGallery || "muted"), vidModes)}
${makeSelectRow("Video skip step", "Seek increment for video skip shortcuts.", "opt_videoSkipStep", String(opt.videoSkipStep || "10"), skipSteps)}
${makeSelectRow("Video end behavior", "What happens when a video ends (outside slideshow).", "opt_videoEndBehavior", String(opt.videoEndBehavior || "loop"), videoEndModes)}
${makeSelectRow("Preload next item", "Preload the next item for smoother browsing.", "opt_preloadNextMode", String(opt.preloadNextMode || "off"), preloadModes)}
${makeSelectRow("Slideshow speed", "Controls slideshow timing when toggled.", "opt_slideshowDefault", String(opt.slideshowDefault || "cycle"), slideshowModes)}

<h1>Preview</h1>
${makeSelectRow("Image thumbnail size", "Controls generated image thumbnail quality (smaller is faster).", "opt_imageThumbSize", String(opt.imageThumbSize || "medium"), thumbModes)}
${makeSelectRow("Video thumbnail size", "Controls generated video thumbnail quality (smaller is faster).", "opt_videoThumbSize", String(opt.videoThumbSize || "medium"), thumbModes)}
${makeSelectRow("Media thumbnail scale", "Controls how large media cards appear in the preview pane.", "opt_mediaThumbUiSize", String(opt.mediaThumbUiSize || "medium"), previewSizeModes)}
${makeSelectRow("Folder preview scale", "Controls how large folder cards appear in the preview pane.", "opt_folderPreviewSize", String(opt.folderPreviewSize || "medium"), previewSizeModes)}
${makeSelectRow("Preview mode", "Controls how folders are shown in the preview pane.", "opt_previewMode", String(opt.previewMode || "grid"), previewModes)}

<h1>Filenames</h1>
${makeCheckRow("Hide file extensions", "Hide .jpg / .mp4 in file names.", "opt_hideFileExtensions", !!opt.hideFileExtensions)}
${makeCheckRow("Hide underscores from display names", "Replace underscores with spaces.", "opt_hideUnderscoresInNames", !!opt.hideUnderscoresInNames)}
${makeCheckRow("Hide prefix before last ' - ' in file names", "Show only text after the last ' - ' in file names.", "opt_hideBeforeLastDashInFileNames", !!opt.hideBeforeLastDashInFileNames)}
${makeCheckRow("Hide suffix after first underscore in file names", "Show only text before the first underscore in file names.", "opt_hideAfterFirstUnderscoreInFileNames", !!opt.hideAfterFirstUnderscoreInFileNames)}
${makeCheckRow("Force title caps in display names", "Apply Title Case to display names.", "opt_forceTitleCaps", !!opt.forceTitleCaps)}
      `;

      const bindSelect = (id, key, invalidateThumbs, onChange, valueParser) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("change", () => {
          const next = {};
          next[key] = valueParser ? valueParser(el.value) : el.value;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(el.value);
          applyOptionsEverywhere(!!invalidateThumbs);
        });
      };

      const bindCheck = (id, key, onChange) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("change", () => {
          const next = {};
          next[key] = !!el.checked;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(!!el.checked);
          applyOptionsEverywhere(false);
        });
      };

      bindSelect("opt_videoPreview", "videoPreview", false);
      bindSelect("opt_videoGallery", "videoGallery", false);
      bindSelect("opt_defaultFolderBehavior", "defaultFolderBehavior", false, () => {
        applyDefaultViewFromOptions();
      });
      bindSelect("opt_folderScoreDisplay", "folderScoreDisplay", false, (val) => {
        WS.view.folderScoreDisplay = (val === "show" || val === "no-arrows" || val === "hidden") ? val : "hidden";
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
      });
      bindSelect("opt_videoSkipStep", "videoSkipStep", false);
      bindSelect("opt_preloadNextMode", "preloadNextMode", false, (val) => {
        if (val === "off") PRELOAD_CACHE = new Map();
      });
      bindSelect("opt_videoEndBehavior", "videoEndBehavior", false);
      bindSelect("opt_slideshowDefault", "slideshowDefault", false);
      bindCheck("opt_banicOpenWindow", "banicOpenWindow");
      bindCheck("opt_showHiddenFolder", "showHiddenFolder", (enabled) => {
        if (!enabled && WS.view.tagFolderActiveMode === "hidden") {
          exitTagFolderView();
        }
        renderDirectoriesPane(true);
      });
      bindSelect("opt_imageThumbSize", "imageThumbSize", true);
      bindSelect("opt_videoThumbSize", "videoThumbSize", true);
      bindSelect("opt_mediaThumbUiSize", "mediaThumbUiSize", false);
      bindSelect("opt_folderPreviewSize", "folderPreviewSize", false);
      bindSelect("opt_colorScheme", "colorScheme", false, () => {
        applyColorSchemeFromOptions();
      });
      bindSelect("opt_previewMode", "previewMode", false, () => {
        renderPreviewPane(true);
      });
      bindCheck("opt_retroMode", "retroMode", () => {
        applyRetroModeFromOptions();
      });
      bindSelect("opt_mediaFilter", "mediaFilter", true, (val) => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_crtOverlayEnabled", "crtOverlayEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_animatedMediaFilters", "animatedMediaFilters", () => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_hideFileExtensions", "hideFileExtensions");
      bindCheck("opt_hideUnderscoresInNames", "hideUnderscoresInNames");
      bindCheck("opt_hideBeforeLastDashInFileNames", "hideBeforeLastDashInFileNames");
      bindCheck("opt_hideAfterFirstUnderscoreInFileNames", "hideAfterFirstUnderscoreInFileNames");
      bindCheck("opt_forceTitleCaps", "forceTitleCaps");

      const dirSortSelect = $("opt_dirSortMode");
      if (dirSortSelect) {
        dirSortSelect.addEventListener("click", (e) => e.stopPropagation());
        dirSortSelect.addEventListener("keydown", (e) => e.stopPropagation());
        dirSortSelect.addEventListener("change", () => {
          WS.meta.dirSortMode = dirSortSelect.value === "score" ? "score" : "name";
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          applyViewModesEverywhere(true);
        });
      }
    }

    function resetOptionsToDefaults() {
      WS.meta.options = normalizeOptions(defaultOptions());
      WS.meta.dirty = true;
      metaScheduleSave();
      setOptionsStatus("Reset");
      renderOptionsUi();
      applyOptionsEverywhere(true);
    }

    if (keybindsBtn) keybindsBtn.addEventListener("click", () => openKeybinds());
    if (keybindsCloseBtn) keybindsCloseBtn.addEventListener("click", () => closeKeybinds());
    if (keybindsDoneBtn) keybindsDoneBtn.addEventListener("click", () => closeKeybinds());
    if (keybindsResetBtn) keybindsResetBtn.addEventListener("click", () => resetKeybindsToDefaults());

    if (optionsBtn) optionsBtn.addEventListener("click", () => openOptions());
    if (optionsCloseBtn) optionsCloseBtn.addEventListener("click", () => closeOptions());
    if (optionsDoneBtn) optionsDoneBtn.addEventListener("click", () => closeOptions());
    if (optionsResetBtn) optionsResetBtn.addEventListener("click", () => resetOptionsToDefaults());

    /* =========================================================
       Workspace loading (read-only input)
       ========================================================= */
    function getBulkSelectionKey() {
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return "search";
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
      const dn = WS.nav.dirNode;
      return dn ? String(dn.path || "") : "";
    }

    function clearBulkTagSelection() {
      clearBulkTagPlaceholder();
      closeActionMenus();
      if (WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.clear) WS.view.bulkTagSelectedPaths.clear();
      if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear) WS.view.bulkFileSelectedIds.clear();
    }

    function finalizeBulkSelectionAction() {
      if (!WS.view.bulkSelectMode &&
          !(WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.size) &&
          !(WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.size)) {
        return;
      }
      WS.view.bulkSelectMode = false;
      clearBulkTagSelection();
    }

    function syncBulkSelectionForCurrentDir() {
      const p = getBulkSelectionKey();
      if (!WS.view.bulkTagSelectionsByDir) WS.view.bulkTagSelectionsByDir = new Map();
      if (!WS.view.bulkTagSelectionsByDir.has(p)) WS.view.bulkTagSelectionsByDir.set(p, new Set());
      WS.view.bulkTagSelectedPaths = WS.view.bulkTagSelectionsByDir.get(p);
      if (!WS.view.bulkFileSelectionsByDir) WS.view.bulkFileSelectionsByDir = new Map();
      if (!WS.view.bulkFileSelectionsByDir.has(p)) WS.view.bulkFileSelectionsByDir.set(p, new Set());
      WS.view.bulkFileSelectedIds = WS.view.bulkFileSelectionsByDir.get(p);
    }

    function applyVideoCarryToElement(vid, fileId) {
      if (!vid) return;
      if (!VIDEO_CARRY.active) return;
      if ((VIDEO_CARRY.fileId || "") !== (fileId || "")) return;

      const t = VIDEO_CARRY.time || 0;
      const wp = !!VIDEO_CARRY.wasPlaying;

      const doApply = () => {
        try { if (isFinite(t)) vid.currentTime = t; } catch {}
        if (wp) { try { vid.play(); } catch {} }
        else { try { vid.pause(); } catch {} }
        VIDEO_CARRY.active = false;
        VIDEO_CARRY.fileId = null;
        VIDEO_CARRY.time = 0;
        VIDEO_CARRY.wasPlaying = false;
      };

      if (vid.readyState >= 1) {
        setTimeout(doApply, 0);
        return;
      }

      const once = () => {
        try { vid.removeEventListener("loadedmetadata", once); } catch {}
        doApply();
      };
      try { vid.addEventListener("loadedmetadata", once); } catch {}
    }

    function ensureDirPath(path) {
      const norm = path || "";
      if (WS.dirByPath.has(norm)) return WS.dirByPath.get(norm);

      const segments = norm.split("/").filter(Boolean);
      let cur = WS.root;
      let accum = "";
      for (const seg of segments) {
        accum = accum ? (accum + "/" + seg) : seg;
        let node = WS.dirByPath.get(accum);
        if (!node) {
          node = makeDirNode(seg, cur);
          node.path = accum;
          WS.dirByPath.set(accum, node);
          cur.childrenDirs.push(node);
        }
        cur = node;
      }
      return cur;
    }

    function normalizeRootIfSingleDir() {
      const rootDirs = WS.root.childrenDirs;
      const rootFiles = WS.root.childrenFiles;
      if (rootDirs.length === 1 && rootFiles.length === 0) {
        const actual = rootDirs[0];
        actual.parent = null;
        actual.path = "";
        WS.root = actual;

        WS.dirByPath.clear();
        WS.dirByPath.set("", WS.root);
        (function reindex(node, basePath) {
          node.path = basePath;
          for (const d of node.childrenDirs) {
            const p = basePath ? (basePath + "/" + d.name) : d.name;
            WS.dirByPath.set(p, d);
            reindex(d, p);
          }
        })(WS.root, "");
      }
    }

    function hash32(str) {
      let h = 2166136261 >>> 0;
      const s = String(str || "");
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function makeRng(seed) {
      let x = (seed >>> 0) || 1;
      return () => {
        x = (Math.imul(1664525, x) + 1013904223) >>> 0;
        return x / 4294967296;
      };
    }

    function shuffleWithSeed(arr, seed) {
      const rnd = makeRng(seed);
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }

    function computeWorkspaceSeed() {
      const keys = Array.from(WS.fileById.keys()).slice().sort();
      let h = 2166136261 >>> 0;
      for (let i = 0; i < keys.length; i++) {
        h ^= hash32(keys[i]);
        h = Math.imul(h, 16777619);
      }
      return h >>> 0;
    }

    function metaGetScore(path) {
      const p = String(path || "");
      const v = WS.meta.dirScores.get(p);
      return Number.isFinite(v) ? v : 0;
    }

    function metaSetScore(path, score) {
      const p = String(path || "");
      const v = Number(score || 0) | 0;
      WS.meta.dirScores.set(p, v);
      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      if (WS.meta.dirSortMode === "score") {
        applyViewModesEverywhere(true);
        return;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function metaBumpScore(path, delta) {
      const p = String(path || "");
      const cur = metaGetScore(p);
      metaSetScore(p, (cur + (delta | 0)) | 0);
    }

    function metaBumpScoreBulk(paths, delta) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const d = delta | 0;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const cur = metaGetScore(p);
        WS.meta.dirScores.set(p, (cur + d) | 0);
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      if (WS.meta.dirSortMode === "score") {
        applyViewModesEverywhere(true);
        return;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function normalizeTag(t) {
      const s = String(t || "").trim().toLowerCase();
      return s;
    }

    function normalizeTagList(list) {
      const out = [];
      const seen = new Set();
      const arr = Array.isArray(list) ? list : [];
      for (let i = 0; i < arr.length; i++) {
        const t = normalizeTag(arr[i]);
        if (!t) continue;
        if (seen.has(t)) continue;
        seen.add(t);
        out.push(t);
      }
      return out;
    }

    function normalizeTagsFromText(text) {
      const raw = String(text || "");
      if (!raw.trim()) return [];
      const parts = raw.split(",").map(s => normalizeTag(s));
      return normalizeTagList(parts);
    }

    function arraysEqual(a, b) {
      if (a === b) return true;
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }

    function metaWriteUserTags(path, userTags) {
      if (!WS.meta || !WS.meta.dirTags) return false;
      const p = String(path || "");
      const existing = metaGetTags(p);
      const fav = existing.includes(FAVORITE_TAG);
      const hidden = existing.includes(HIDDEN_TAG);
      const normalized = normalizeTagList(userTags).filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
      const merged = [];
      if (fav) merged.push(FAVORITE_TAG);
      if (hidden) merged.push(HIDDEN_TAG);
      for (const tag of normalized) {
        if (!tag) continue;
        if (merged.includes(tag)) continue;
        merged.push(tag);
      }
      const prev = WS.meta.dirTags.get(p);
      if (arraysEqual(prev || [], merged)) return false;
      WS.meta.dirTags.set(p, merged);
      WS.meta.dirty = true;
      return true;
    }

    function metaGetTags(path) {
      const p = String(path || "");
      const v = WS.meta.dirTags.get(p);
      return Array.isArray(v) ? v.slice() : [];
    }

    function metaGetUserTags(path) {
      const tags = metaGetTags(path);
      return tags.filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
    }

    function metaHasFavorite(path) {
      const tags = metaGetTags(path);
      return tags.includes(FAVORITE_TAG);
    }

    function metaHasHidden(path) {
      const tags = metaGetTags(path);
      return tags.includes(HIDDEN_TAG);
    }

    function metaSetUserTags(path, userTags) {
      const changed = metaWriteUserTags(path, userTags);
      if (!changed) return;
      metaScheduleSave();
      TAG_EDIT_PATH = null;
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function refreshAfterTagMetadataChange() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function clearBulkTagPlaceholder() {
      if (!BULK_TAG_PLACEHOLDER) return false;
      BULK_TAG_PLACEHOLDER = null;
      TAG_ENTRY_RENAME_STATE = null;
      return true;
    }

    function canUseBulkTagPlaceholderUi() {
      if (!treatTagsAsFoldersEnabled()) return false;
      if (!WS.root) return false;
      return true;
    }

    function startBulkTagging(paths) {
      if (canUseBulkTagPlaceholderUi() && setBulkTagPlaceholder(paths, "New tag folder")) return;
    }

    function setBulkTagPlaceholder(paths, label = "New tag folder") {
      clearBulkTagPlaceholder();
      const unique = Array.from(new Set((paths || []).map(p => String(p || "")))).filter(p => p);
      if (!unique.length) return false;
      BULK_TAG_PLACEHOLDER = {
        paths: unique,
        label: label,
        count: unique.length
      };
      TAG_ENTRY_RENAME_STATE = {
        tag: "",
        label,
        paths: unique.slice(),
        placeholder: true
      };
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      renderDirectoriesPane(true);
      setTimeout(() => {
        focusTagEntryRenameInput();
      }, 0);
      return true;
    }

    function focusTagEntryRenameInput() {
      if (!directoriesListEl) return;
      const input = directoriesListEl.querySelector(".tagEntryRenameInput");
      if (!input) return;
      try { input.focus(); input.select(); } catch {}
    }

    function cancelTagEntryRename() {
      const state = TAG_ENTRY_RENAME_STATE;
      if (!state) return;
      if (state.placeholder) {
        clearBulkTagPlaceholder();
        renderDirectoriesPane(true);
        return;
      }
      TAG_ENTRY_RENAME_STATE = null;
      renderDirectoriesPane(true);
    }

    function commitTagEntryRename(inputEl) {
      if (!TAG_ENTRY_RENAME_STATE || !inputEl) return;
      const state = TAG_ENTRY_RENAME_STATE;
      const desired = normalizeTag(inputEl.value || "");
      if (!desired) {
        showStatusMessage("Tag name cannot be empty.");
        renderDirectoriesPane(true);
        return;
      }
      const isPlaceholder = !!state.placeholder;
      TAG_ENTRY_RENAME_STATE = null;
      if (!isPlaceholder && desired === state.tag) {
        showStatusMessage("Tag name unchanged.");
        renderDirectoriesPane(true);
        return;
      }
      if (isPlaceholder) {
        clearBulkTagPlaceholder();
        metaAddUserTagsBulk(state.paths, [desired]);
        finalizeBulkSelectionAction();
        return;
      }
      const changed = renameTagForPaths(state.tag, desired, state.paths);
      if (!changed) {
        showStatusMessage("No folders updated.");
        renderDirectoriesPane(true);
        return;
      }
      metaScheduleSave();
      refreshAfterTagMetadataChange();
    }

    function metaToggleFavorite(path) {
      const p = String(path || "");
      const tags = metaGetTags(p);
      const has = tags.includes(FAVORITE_TAG);
      const next = has ? tags.filter(t => t !== FAVORITE_TAG) : [FAVORITE_TAG].concat(tags.filter(t => t !== FAVORITE_TAG));
      WS.meta.dirTags.set(p, normalizeTagList(next));
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaToggleHidden(path) {
      const p = String(path || "");
      const tags = metaGetTags(p);
      const has = tags.includes(HIDDEN_TAG);
      const next = has ? tags.filter(t => t !== HIDDEN_TAG) : [HIDDEN_TAG].concat(tags.filter(t => t !== HIDDEN_TAG));
      WS.meta.dirTags.set(p, normalizeTagList(next));
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      syncHiddenUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaAddUserTagsBulk(paths, tagsToAdd) {
      const add = normalizeTagList(tagsToAdd).filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
      if (!add.length) return;

      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;

      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const fav = metaHasFavorite(p);
        const hidden = metaHasHidden(p);
        const curUser = metaGetUserTags(p);
        const mergedUser = normalizeTagList(curUser.concat(add));
        const merged = [];
        if (fav) merged.push(FAVORITE_TAG);
        if (hidden) merged.push(HIDDEN_TAG);
        merged.push(...mergedUser);
        WS.meta.dirTags.set(p, normalizeTagList(merged));
      }

      WS.meta.dirty = true;
      metaScheduleSave();
      TAG_EDIT_PATH = null;
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaSetFavoriteBulk(paths, enable) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const target = !!enable;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const tags = metaGetTags(p);
        const has = tags.includes(FAVORITE_TAG);
        if (target === has) continue;
        const next = target ? [FAVORITE_TAG].concat(tags.filter(t => t !== FAVORITE_TAG)) : tags.filter(t => t !== FAVORITE_TAG);
        WS.meta.dirTags.set(p, normalizeTagList(next));
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaSetHiddenBulk(paths, enable) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const target = !!enable;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const tags = metaGetTags(p);
        const has = tags.includes(HIDDEN_TAG);
        if (target === has) continue;
        const next = target ? [HIDDEN_TAG].concat(tags.filter(t => t !== HIDDEN_TAG)) : tags.filter(t => t !== HIDDEN_TAG);
        WS.meta.dirTags.set(p, normalizeTagList(next));
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncFavoritesUi();
      syncHiddenUi();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function metaComputeFingerprints() {
      WS.meta.dirFingerprints.clear();
      if (!WS.root) return;

      (function walk(node) {
        for (const d of node.childrenDirs) walk(d);

        const fileIds = node.childrenFiles.slice().sort();
        const childFps = node.childrenDirs.slice().map(d => {
          const fp = WS.meta.dirFingerprints.get(d.path || "");
          return Number.isFinite(fp) ? fp : 0;
        }).sort((a,b) => a - b);

        let s = "F:";
        for (let i = 0; i < fileIds.length; i++) s += fileIds[i] + "|";
        s += "D:";
        for (let i = 0; i < childFps.length; i++) s += childFps[i] + "|";

        const fp = hash32(s);
        WS.meta.dirFingerprints.set(node.path || "", fp);
      })(WS.root);
    }

    function metaMakeScoresLogObject() {
      const folders = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        folders[path] = { score: metaGetScore(path), fp: fp >>> 0 };
      }
      return {
        schema: 1,
        updatedAt: Date.now(),
        sortMode: WS.meta.dirSortMode === "score" ? "score" : "name",
        folders
      };
    }

    function metaMakeTagsLogObject() {
      const folders = {};
      const tagByFp = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tags = metaGetTags(path);
        folders[path] = { fp: fp >>> 0, tags: tags };
        if (tags && tags.length) {
          const k = String(fp >>> 0);
          if (!tagByFp[k]) tagByFp[k] = tags.slice();
        }
      }
      return {
        schema: 1,
        updatedAt: Date.now(),
        folders,
        tagByFp
      };
    }

    function metaMakeOptionsLogObject() {
      return {
        schema: 1,
        updatedAt: Date.now(),
      options: normalizeOptions(WS.meta.options || null)
    };
  }

    function metaMakeKeybindsLogObject() {
      const bindings = Array.isArray(WS.meta.keybinds) ? WS.meta.keybinds : defaultKeybinds("right");
      const presetId = (WS.meta && WS.meta.keybindsPreset && KEYBIND_PRESETS[WS.meta.keybindsPreset]) ? WS.meta.keybindsPreset : "right";
      return {
        schema: 1,
        updatedAt: Date.now(),
        preset: presetId,
        bindings: bindings.map(b => ({ id: b.id, key: b.key || "" }))
      };
    }

    function metaMakeLogObject() {
      const folders = {};
      const tagByFp = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tags = metaGetTags(path);
        folders[path] = { score: metaGetScore(path), fp: fp >>> 0, tags: tags };
        if (tags && tags.length) {
          const k = String(fp >>> 0);
          if (!tagByFp[k]) tagByFp[k] = tags.slice();
        }
      }
      return {
        schema: 2,
        updatedAt: Date.now(),
        sortMode: WS.meta.dirSortMode === "score" ? "score" : "name",
        folders,
        tagByFp,
        options: normalizeOptions(WS.meta.options || null)
      };
    }

    function metaApplyScoresLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = log.sortMode === "score" ? "score" : "name";
      WS.meta.dirSortMode = sortMode;

      const folders = log.folders && typeof log.folders === "object" ? log.folders : {};
      const oldByPath = new Map();
      const oldByFp = new Map();

      for (const p of Object.keys(folders)) {
        const it = folders[p];
        const sc = (it && Number.isFinite(it.score)) ? (it.score | 0) : 0;
        const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
        oldByPath.set(p, { score: sc, fp });
        if (!oldByFp.has(fp)) oldByFp.set(fp, []);
        oldByFp.get(fp).push({ path: p, score: sc });
      }

      const claimed = new Set();
      WS.meta.dirScores.clear();

      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        if (oldByPath.has(path)) {
          WS.meta.dirScores.set(path, oldByPath.get(path).score | 0);
          claimed.add(path);
          continue;
        }
        const list = oldByFp.get(fp >>> 0) || null;
        if (list && list.length) {
          let picked = null;
          for (let i = 0; i < list.length; i++) {
            const cand = list[i];
            if (!claimed.has(cand.path)) { picked = cand; break; }
          }
          if (picked) {
            WS.meta.dirScores.set(path, picked.score | 0);
            claimed.add(picked.path);
            continue;
          }
        }
        WS.meta.dirScores.set(path, 0);
      }
    }

    function metaApplyTagsLog(log) {
      if (!log || typeof log !== "object") return;

      const folders = log.folders && typeof log.folders === "object" ? log.folders : {};
      const oldTagsByPath = new Map();

      for (const p of Object.keys(folders)) {
        const it = folders[p];
        const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
        if (tg.length) oldTagsByPath.set(p, tg);
      }

      const oldTagByFp = new Map();
      if (log.tagByFp && typeof log.tagByFp === "object") {
        for (const k of Object.keys(log.tagByFp)) {
          const fp = (Number(k) >>> 0) || 0;
          const tg = normalizeTagList(log.tagByFp[k]);
          if (tg.length) oldTagByFp.set(fp >>> 0, tg);
        }
      }
      if (!oldTagByFp.size) {
        for (const [p, tg] of oldTagsByPath.entries()) {
          const it = folders[p];
          const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
          if (!fp) continue;
          if (!oldTagByFp.has(fp)) oldTagByFp.set(fp, tg.slice());
        }
      }

      WS.meta.dirTags.clear();
      for (const [path, node] of WS.dirByPath.entries()) {
        if (oldTagsByPath.has(path)) {
          WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
          continue;
        }
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tg = oldTagByFp.get(fp >>> 0) || [];
        WS.meta.dirTags.set(path, tg.slice());
      }
    }

    function metaApplyOptionsLog(log) {
      if (!log || typeof log !== "object") return;
      WS.meta.options = normalizeOptions(log.options || null);
      applyDefaultViewFromOptions();
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyDisplaySizesFromOptions();
    }

    function metaApplyKeybindsLog(log) {
      if (!log || typeof log !== "object") return;
      const normalized = normalizeKeybinds(log);
      WS.meta.keybinds = normalized.bindings;
      WS.meta.keybindsPreset = normalized.presetId;
      rebuildKeybindIndex();
    }

    function metaApplyFromLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = log.sortMode === "score" ? "score" : "name";
      WS.meta.dirSortMode = sortMode;

      WS.meta.options = normalizeOptions(log.options || null);
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyDisplaySizesFromOptions();

      const folders = log.folders && typeof log.folders === "object" ? log.folders : {};
      const oldByPath = new Map();
      const oldByFp = new Map();

      const oldTagsByPath = new Map();

      for (const p of Object.keys(folders)) {
        const it = folders[p];
        const sc = (it && Number.isFinite(it.score)) ? (it.score | 0) : 0;
        const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
        oldByPath.set(p, { score: sc, fp });
        if (!oldByFp.has(fp)) oldByFp.set(fp, []);
        oldByFp.get(fp).push({ path: p, score: sc });

        const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
        if (tg.length) oldTagsByPath.set(p, tg);
      }

      const oldTagByFp = new Map();
      if (log.tagByFp && typeof log.tagByFp === "object") {
        for (const k of Object.keys(log.tagByFp)) {
          const fp = (Number(k) >>> 0) || 0;
          const tg = normalizeTagList(log.tagByFp[k]);
          if (tg.length) oldTagByFp.set(fp >>> 0, tg);
        }
      }
      if (!oldTagByFp.size) {
        for (const [p, tg] of oldTagsByPath.entries()) {
          const it = folders[p];
          const fp = (it && Number.isFinite(it.fp)) ? (it.fp >>> 0) : 0;
          if (!fp) continue;
          if (!oldTagByFp.has(fp)) oldTagByFp.set(fp, tg.slice());
        }
      }

      const claimed = new Set();
      WS.meta.dirScores.clear();

      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        if (oldByPath.has(path)) {
          WS.meta.dirScores.set(path, oldByPath.get(path).score | 0);
          claimed.add(path);
          continue;
        }
        const list = oldByFp.get(fp >>> 0) || null;
        if (list && list.length) {
          let picked = null;
          for (let i = 0; i < list.length; i++) {
            const cand = list[i];
            if (!claimed.has(cand.path)) { picked = cand; break; }
          }
          if (picked) {
            WS.meta.dirScores.set(path, picked.score | 0);
            claimed.add(picked.path);
            continue;
          }
        }
        WS.meta.dirScores.set(path, 0);
      }

      WS.meta.dirTags.clear();
      for (const [path, node] of WS.dirByPath.entries()) {
        if (oldTagsByPath.has(path)) {
          WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
          continue;
        }
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tg = oldTagByFp.get(fp >>> 0) || [];
        WS.meta.dirTags.set(path, tg.slice());
      }

      applyDefaultViewFromOptions();
      syncMetaButtons();
      renderOptionsUi();
    }

    function metaParseText(text) {
      const t = String(text || "").trim();
      if (!t) return null;
      try { return JSON.parse(t); } catch { return null; }
    }

    function metaLocalKeys() {
      const k = String(WS.meta.storageKey || "");
      if (!k) return null;
      return {
        scores: `LocalGalleryScores::${k}`,
        tags: `LocalGalleryTags::${k}`,
        options: `LocalGalleryPreferences::${k}`,
        keybinds: `LocalGalleryKeyboard::${k}`,
        legacy: `LocalGalleryVotes::${k}`
      };
    }

    function metaLoadLocalDoc(key) {
      if (!key) return null;
      try {
        const txt = localStorage.getItem(key);
        return metaParseText(txt);
      } catch { return null; }
    }

    function metaSaveLocalDoc(key, obj) {
      if (!key) return;
      try { localStorage.setItem(key, JSON.stringify(obj)); } catch {}
    }

    function metaSaveLocalNow() {
      const keys = metaLocalKeys();
      if (!keys) return;
      metaSaveLocalDoc(keys.scores, metaMakeScoresLogObject());
      metaSaveLocalDoc(keys.tags, metaMakeTagsLogObject());
      metaSaveLocalDoc(keys.options, metaMakeOptionsLogObject());
      metaSaveLocalDoc(keys.keybinds, metaMakeKeybindsLogObject());
      WS.meta.dirty = false;
    }

    async function metaEnsureFsHandles(rootHandle) {
      if (!rootHandle) return false;
      try {
        const sys = await rootHandle.getDirectoryHandle(".local-gallery", { create: true });
        const scoresFile = await sys.getFileHandle("folder-scores.log.json", { create: true });
        const tagsFile = await sys.getFileHandle("folder-tags.log.json", { create: true });
        const optionsFile = await sys.getFileHandle("preferences.log.json", { create: true });
        const keybindsFile = await sys.getFileHandle("keyboard-configuration.log.json", { create: true });
        const legacyFile = await sys.getFileHandle("folder-votes.log.json", { create: true });
        WS.meta.fsRootHandle = rootHandle;
        WS.meta.fsSysDirHandle = sys;
        WS.meta.fsScoresFileHandle = scoresFile;
        WS.meta.fsTagsFileHandle = tagsFile;
        WS.meta.fsOptionsFileHandle = optionsFile;
        WS.meta.fsKeybindsFileHandle = keybindsFile;
        WS.meta.fsLegacyFileHandle = legacyFile;
        WS.meta.storageMode = "fs";
        return true;
      } catch {
        return false;
      }
    }

    async function metaLoadFsDoc(fh) {
      if (!fh) return null;
      try {
        const f = await fh.getFile();
        const txt = await f.text();
        return metaParseText(txt);
      } catch {
        return null;
      }
    }

    async function metaSaveFsDoc(fh, obj) {
      if (!fh) return;
      const txt = JSON.stringify(obj);
      try {
        const writable = await fh.createWritable();
        await writable.write(txt);
        await writable.close();
      } catch {}
    }

    async function metaSaveFsNow() {
      const scores = WS.meta.fsScoresFileHandle;
      const tags = WS.meta.fsTagsFileHandle;
      const options = WS.meta.fsOptionsFileHandle;
      const keybinds = WS.meta.fsKeybindsFileHandle;
      await metaSaveFsDoc(scores, metaMakeScoresLogObject());
      await metaSaveFsDoc(tags, metaMakeTagsLogObject());
      await metaSaveFsDoc(options, metaMakeOptionsLogObject());
      await metaSaveFsDoc(keybinds, metaMakeKeybindsLogObject());
      WS.meta.dirty = false;
    }

    function metaScheduleSave() {
      if (WS.meta.saveTimer) return;
      WS.meta.saveTimer = setTimeout(async () => {
        WS.meta.saveTimer = null;
        if (!WS.meta.dirty) return;
        if (WS.meta.storageMode === "fs") await metaSaveFsNow();
        else metaSaveLocalNow();
      }, 500);
    }

    function showBusyOverlay(text) {
      if (busyLabel) busyLabel.textContent = text || "Working...";
      if (busyOverlay) busyOverlay.classList.add("active");
    }

    function hideBusyOverlay() {
      if (busyOverlay) busyOverlay.classList.remove("active");
    }

    function metaInitForCurrentWorkspace() {
      metaComputeFingerprints();

      if (WS.meta.storageMode === "local") {
        const keys = metaLocalKeys();
        const scoresLog = keys ? metaLoadLocalDoc(keys.scores) : null;
        const tagsLog = keys ? metaLoadLocalDoc(keys.tags) : null;
        const optionsLog = keys ? metaLoadLocalDoc(keys.options) : null;
        const keybindsLog = keys ? metaLoadLocalDoc(keys.keybinds) : null;

        if (scoresLog) metaApplyScoresLog(scoresLog);
        if (tagsLog) metaApplyTagsLog(tagsLog);
        if (optionsLog) metaApplyOptionsLog(optionsLog);
        if (keybindsLog) metaApplyKeybindsLog(keybindsLog);

        if (!scoresLog && !tagsLog && !optionsLog && !keybindsLog && keys) {
          /* LEGACY MIGRATION (remove later): read combined log and split it. */
          const legacyLog = metaLoadLocalDoc(keys.legacy);
          if (legacyLog) {
            metaApplyFromLog(legacyLog);
          }
        }
      }

      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      renderOptionsUi();
    }

    async function metaInitForCurrentWorkspaceFs() {
      metaComputeFingerprints();
      const scoresLog = await metaLoadFsDoc(WS.meta.fsScoresFileHandle);
      const tagsLog = await metaLoadFsDoc(WS.meta.fsTagsFileHandle);
      const optionsLog = await metaLoadFsDoc(WS.meta.fsOptionsFileHandle);
      const keybindsLog = await metaLoadFsDoc(WS.meta.fsKeybindsFileHandle);

      if (scoresLog) metaApplyScoresLog(scoresLog);
      if (tagsLog) metaApplyTagsLog(tagsLog);
      if (optionsLog) metaApplyOptionsLog(optionsLog);
      if (keybindsLog) metaApplyKeybindsLog(keybindsLog);

      if (!scoresLog && !tagsLog && !optionsLog && !keybindsLog) {
        /* LEGACY MIGRATION (remove later): read combined log and split it. */
        const legacyLog = await metaLoadFsDoc(WS.meta.fsLegacyFileHandle);
        if (legacyLog) {
          metaApplyFromLog(legacyLog);
        }
      }
      WS.meta.dirty = true;
      metaScheduleSave();
      syncMetaButtons();
      renderOptionsUi();
    }

    function buildWorkspaceFromFiles(fileList) {
      resetWorkspace();
      clearWorkspaceEmptyState();

      WS.root = makeDirNode("root", null);
      WS.root.path = "";
      WS.dirByPath.set("", WS.root);
      applyMediaFilterFromOptions();

      const files = Array.from(fileList || []);

      for (const f of files) {
        if (!f || !f.name) continue;
        if (f.name[0] === ".") continue;

        const relPath = f.webkitRelativePath || f.name;
        if (relPath.split("/").includes(".local-gallery")) continue;

        const parts = relPath.split("/").filter(Boolean);
        if (!parts.length) continue;

        const filename = parts[parts.length - 1];
        const dirPath = parts.slice(0, -1).join("/");
        const isImg = isImageName(filename);
        const isVid = isVideoName(filename);
        if (!isImg && !isVid) continue;

        const id = fileKey(f, relPath);
        if (WS.fileById.has(id)) continue;

        const extDot = filename.lastIndexOf(".");
        const ext = extDot >= 0 ? filename.slice(extDot).toLowerCase() : "";

        const rec = {
          id,
          file: f,
          name: filename,
          relPath,
          dirPath,
          ext,
          type: isVid ? "video" : "image",
          size: f.size,
          lastModified: f.lastModified,
          url: null,
          thumbUrl: null,
          videoThumbUrl: null,
          indices: null,
          thumbMode: null,
          videoThumbMode: null
        };

        WS.fileById.set(id, rec);
        const dirNode = ensureDirPath(dirPath);
        dirNode.childrenFiles.push(id);
      }

      normalizeRootIfSingleDir();

      WS.view.randomSeed = computeWorkspaceSeed();
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;

      WS.meta.storageMode = "local";
      WS.meta.storageKey = String(WS.view.randomSeed >>> 0);

      metaInitForCurrentWorkspace();

      // Initialize Directories Pane at root listing
      WS.nav.dirNode = WS.root;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      syncMetaButtons();
      initDirHistory();
    }

    async function collectFilesFromDirHandle(dirHandle, basePath, out) {
      for await (const [name, handle] of dirHandle.entries()) {
        if (name === ".local-gallery") continue;
        if (handle.kind === "file") {
          const f = await handle.getFile();
          if (!f || !f.name) continue;
          if (f.name[0] === ".") continue;
          const relPath = basePath ? (basePath + "/" + name) : name;
          out.push({ file: f, relPath });
        } else if (handle.kind === "directory") {
          const nextBase = basePath ? (basePath + "/" + name) : name;
          await collectFilesFromDirHandle(handle, nextBase, out);
        }
      }
    }

    async function buildWorkspaceFromDirectoryHandle(rootHandle) {
      resetWorkspace();
      clearWorkspaceEmptyState();

      WS.root = makeDirNode("root", null);
      WS.root.path = "";
      WS.dirByPath.set("", WS.root);
      applyMediaFilterFromOptions();

      const all = [];
      await collectFilesFromDirHandle(rootHandle, "", all);

      for (const it of all) {
        const f = it.file;
        const relPath = it.relPath || f.name;
        if (relPath.split("/").includes(".local-gallery")) continue;

        const parts = relPath.split("/").filter(Boolean);
        if (!parts.length) continue;

        const filename = parts[parts.length - 1];
        const dirPath = parts.slice(0, -1).join("/");
        const isImg = isImageName(filename);
        const isVid = isVideoName(filename);
        if (!isImg && !isVid) continue;

        const id = fileKey(f, relPath);
        if (WS.fileById.has(id)) continue;

        const extDot = filename.lastIndexOf(".");
        const ext = extDot >= 0 ? filename.slice(extDot).toLowerCase() : "";

        const rec = {
          id,
          file: f,
          name: filename,
          relPath,
          dirPath,
          ext,
          type: isVid ? "video" : "image",
          size: f.size,
          lastModified: f.lastModified,
          url: null,
          thumbUrl: null,
          videoThumbUrl: null,
          indices: null,
          thumbMode: null,
          videoThumbMode: null
        };

        WS.fileById.set(id, rec);
        const dirNode = ensureDirPath(dirPath);
        dirNode.childrenFiles.push(id);
      }

      normalizeRootIfSingleDir();

      WS.view.randomSeed = computeWorkspaceSeed();
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;

      const ok = await metaEnsureFsHandles(rootHandle);
      if (!ok) {
        WS.meta.storageMode = "local";
        WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
        metaInitForCurrentWorkspace();
      } else {
        WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
        await metaInitForCurrentWorkspaceFs();
      }

      WS.nav.dirNode = WS.root;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      syncMetaButtons();
      initDirHistory();
    }

    function snapshotRefreshState() {
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      let entryKey = null;
      if (entry && entry.kind === "dir") {
        entryKey = { kind: "dir", path: String(entry.node?.path || "") };
      } else if (entry && entry.kind === "file") {
        const rec = WS.fileById.get(entry.id);
        entryKey = { kind: "file", relPath: String(rec?.relPath || "") };
      }

      return {
        dirPath: String(WS.nav.dirNode?.path || ""),
        entryKey,
        view: {
          filterMode: WS.view.filterMode,
          loopWithinDir: WS.view.loopWithinDir,
          folderBehavior: WS.view.folderBehavior,
          folderScoreDisplay: WS.view.folderScoreDisplay,
          favoritesMode: WS.view.favoritesMode,
          hiddenMode: WS.view.hiddenMode,
          dirSearchPinned: WS.view.dirSearchPinned,
          dirSearchQuery: WS.view.dirSearchQuery,
          searchRootActive: WS.view.searchRootActive,
          searchRootPath: WS.view.searchRootPath,
          searchAnchorPath: WS.view.searchAnchorPath,
          searchEntryRootPath: WS.view.searchEntryRootPath,
          searchRootIsFavorites: WS.view.searchRootIsFavorites,
          searchRootIsHidden: WS.view.searchRootIsHidden
        }
      };
    }

    function restoreRefreshViewState(viewState) {
      if (!viewState) return;
      WS.view.filterMode = viewState.filterMode;
      WS.view.randomMode = false;
      WS.view.loopWithinDir = viewState.loopWithinDir;
      WS.view.folderBehavior = viewState.folderBehavior;
      WS.view.folderScoreDisplay = viewState.folderScoreDisplay;
      WS.view.favoritesMode = !!viewState.favoritesMode;
      WS.view.hiddenMode = !!viewState.hiddenMode;
      WS.view.dirSearchPinned = !!viewState.dirSearchPinned;
      WS.view.dirSearchQuery = String(viewState.dirSearchQuery || "");
      WS.view.searchRootActive = !!viewState.searchRootActive;
      WS.view.searchRootPath = String(viewState.searchRootPath || "");
      WS.view.searchAnchorPath = String(viewState.searchAnchorPath || "");
      WS.view.searchEntryRootPath = String(viewState.searchEntryRootPath || "");
      WS.view.searchRootIsFavorites = !!viewState.searchRootIsFavorites;
      WS.view.searchRootIsHidden = !!viewState.searchRootIsHidden;
      WS.view.searchRootFavorites = WS.view.searchRootIsFavorites ? getAllFavoriteDirs() : [];
      WS.view.searchRootHidden = WS.view.searchRootIsHidden ? getAllHiddenDirs() : [];
    }

    function restoreRefreshSelection(entryKey) {
      if (!entryKey) return 0;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry) continue;
        if (entryKey.kind === "dir" && entry.kind === "dir") {
          if (String(entry.node?.path || "") === String(entryKey.path || "")) return i;
        } else if (entryKey.kind === "file" && entry.kind === "file") {
          const rec = WS.fileById.get(entry.id);
          if (String(rec?.relPath || "") === String(entryKey.relPath || "")) return i;
        }
      }
      return 0;
    }

    async function refreshWorkspaceFromRootHandle() {
      const rootHandle = WS.meta.fsRootHandle;
      if (!rootHandle) return;
      const state = snapshotRefreshState();

      await buildWorkspaceFromDirectoryHandle(rootHandle);

      restoreRefreshViewState(state?.view);
      const targetDir = WS.dirByPath.get(state?.dirPath || "") || WS.root;
      if (targetDir) WS.nav.dirNode = targetDir;

      if (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim()) {
        computeDirectorySearchResults();
      }

      rebuildDirectoriesEntries();
      const idx = restoreRefreshSelection(state?.entryKey);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    async function getDirectoryHandleForPath(rootHandle, path) {
      const norm = String(path || "").replace(/^\/+|\/+$/g, "");
      if (!norm) {
        DIR_HANDLE_CACHE.set("", rootHandle);
        return rootHandle;
      }
      if (DIR_HANDLE_CACHE.has(norm)) return DIR_HANDLE_CACHE.get(norm);
      let cur = rootHandle;
      let acc = "";
      const parts = norm.split("/").filter(Boolean);
      for (const part of parts) {
        acc = acc ? (acc + "/" + part) : part;
        if (DIR_HANDLE_CACHE.has(acc)) {
          cur = DIR_HANDLE_CACHE.get(acc);
          continue;
        }
        cur = await cur.getDirectoryHandle(part);
        DIR_HANDLE_CACHE.set(acc, cur);
      }
      return cur;
    }

    function invalidateDirHandleCache(prefix) {
      const p = String(prefix || "");
      if (!p) {
        DIR_HANDLE_CACHE = new Map();
        return;
      }
      for (const key of Array.from(DIR_HANDLE_CACHE.keys())) {
        if (key === p || key.startsWith(p + "/")) DIR_HANDLE_CACHE.delete(key);
      }
    }

    async function copyDirectoryHandle(srcHandle, dstHandle) {
      for await (const [name, handle] of srcHandle.entries()) {
        if (name === ".local-gallery") continue;
        if (handle.kind === "file") {
          const file = await handle.getFile();
          const dstFile = await dstHandle.getFileHandle(name, { create: true });
          const writable = await dstFile.createWritable();
          await writable.write(file);
          await writable.close();
        } else if (handle.kind === "directory") {
          const childDst = await dstHandle.getDirectoryHandle(name, { create: true });
          await copyDirectoryHandle(handle, childDst);
        }
      }
    }

    async function renameDirectoryOnDisk(oldPath, newName) {
      const rootHandle = WS.meta.fsRootHandle;
      if (!rootHandle) throw new Error("No writable folder loaded.");

      const parts = String(oldPath || "").split("/").filter(Boolean);
      const oldName = parts.pop() || "";
      const parentPath = parts.join("/");

      const parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath);

      let existing = null;
      try { existing = await parentHandle.getDirectoryHandle(newName); } catch {}
      if (existing) throw new Error("Target folder exists.");

      const srcHandle = await parentHandle.getDirectoryHandle(oldName);

      if (typeof srcHandle.move === "function") {
        try {
          await srcHandle.move(parentHandle, newName);
          return;
        } catch {}
      }

      const dstHandle = await parentHandle.getDirectoryHandle(newName, { create: true });
      await copyDirectoryHandle(srcHandle, dstHandle);
      await parentHandle.removeEntry(oldName, { recursive: true });
    }

    async function renameFileOnDisk(dirHandle, fileHandle, oldName, newName) {
      if (!dirHandle || !fileHandle) return false;
      if (typeof fileHandle.move === "function") {
        try {
          await fileHandle.move(dirHandle, newName);
          return true;
        } catch {}
      }
      try {
        const file = await fileHandle.getFile();
        const dstFile = await dirHandle.getFileHandle(newName, { create: true });
        const writable = await dstFile.createWritable();
        await writable.write(file);
        await writable.close();
        await dirHandle.removeEntry(oldName);
        return true;
      } catch {}
      return false;
    }

    function updateViewStatePathsForRename(oldPrefix, newPrefix) {
      WS.view.dirActionMenuPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.dirActionMenuPath);
      WS.view.searchRootPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.searchRootPath);
      WS.view.searchAnchorPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.searchAnchorPath);
      WS.view.searchEntryRootPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.searchEntryRootPath);
      WS.view.favoritesAnchorPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.favoritesAnchorPath);
      WS.view.hiddenAnchorPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.hiddenAnchorPath);

      if (WS.view.favoritesReturnState) {
        WS.view.favoritesReturnState.dirPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.favoritesReturnState.dirPath);
        if (WS.view.favoritesReturnState.sel && WS.view.favoritesReturnState.sel.kind === "dir") {
          WS.view.favoritesReturnState.sel.path = remapPathPrefix(oldPrefix, newPrefix, WS.view.favoritesReturnState.sel.path);
        }
      }

      if (WS.view.hiddenReturnState) {
        WS.view.hiddenReturnState.dirPath = remapPathPrefix(oldPrefix, newPrefix, WS.view.hiddenReturnState.dirPath);
        if (WS.view.hiddenReturnState.sel && WS.view.hiddenReturnState.sel.kind === "dir") {
          WS.view.hiddenReturnState.sel.path = remapPathPrefix(oldPrefix, newPrefix, WS.view.hiddenReturnState.sel.path);
        }
      }

      WS.view.bulkTagSelectionsByDir = remapPathMapKeys(WS.view.bulkTagSelectionsByDir, oldPrefix, newPrefix);
      WS.view.bulkFileSelectionsByDir = remapPathMapKeys(WS.view.bulkFileSelectionsByDir, oldPrefix, newPrefix);
      WS.view.bulkTagSelectedPaths = remapPathSet(WS.view.bulkTagSelectedPaths, oldPrefix, newPrefix);
    }

    function updateMetaPathsForRename(oldPrefix, newPrefix) {
      WS.meta.dirScores = remapPathMapKeys(WS.meta.dirScores, oldPrefix, newPrefix);
      WS.meta.dirTags = remapPathMapKeys(WS.meta.dirTags, oldPrefix, newPrefix);
      WS.meta.dirFingerprints = remapPathMapKeys(WS.meta.dirFingerprints, oldPrefix, newPrefix);
    }

    function applyRenameInMemory(dirNode, newName) {
      const oldPath = String(dirNode?.path || "");
      const parentPath = String(dirNode?.parent?.path || "");
      const newPath = parentPath ? (parentPath + "/" + newName) : newName;

      dirNode.name = newName;

      (function walk(node) {
        node.path = remapPathPrefix(oldPath, newPath, node.path || "");
        for (const d of node.childrenDirs) walk(d);
      })(dirNode);

      WS.dirByPath = remapPathMapKeys(WS.dirByPath, oldPath, newPath);
      updateMetaPathsForRename(oldPath, newPath);
      updateViewStatePathsForRename(oldPath, newPath);
      invalidateDirHandleCache(oldPath);
      return { oldPath, newPath };
    }

    function remapFileSelectionIds(idMap) {
      const next = new Set();
      for (const id of WS.view.bulkFileSelectedIds || []) {
        next.add(idMap.get(id) || id);
      }
      WS.view.bulkFileSelectedIds = next;
    }

    function remapFileIdsInDirTree(idMap) {
      for (const node of WS.dirByPath.values()) {
        if (!node || !node.childrenFiles) continue;
        for (let i = 0; i < node.childrenFiles.length; i++) {
          const oldId = String(node.childrenFiles[i] || "");
          if (idMap.has(oldId)) node.childrenFiles[i] = idMap.get(oldId);
        }
      }
    }

    function updateFileRecordsForRename(oldPrefix, newPrefix) {
      const idMap = new Map();
      const nextFileById = new Map();
      for (const [id, rec] of WS.fileById.entries()) {
        const oldDirPath = String(rec.dirPath || "");
        const oldRelPath = String(rec.relPath || "");
        const nextDirPath = remapPathPrefix(oldPrefix, newPrefix, oldDirPath);
        const nextRelPath = remapPathPrefix(oldPrefix, newPrefix, oldRelPath);
        const nextId = (nextRelPath !== oldRelPath) ? fileKey(rec.file, nextRelPath) : id;
        rec.dirPath = nextDirPath;
        rec.relPath = nextRelPath;
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
      }
      WS.fileById = nextFileById;
      if (idMap.size) {
        remapFileIdsInDirTree(idMap);
        remapFileSelectionIds(idMap);
        if (WS.preview.kind === "file" && WS.preview.fileId && idMap.has(WS.preview.fileId)) {
          WS.preview.fileId = idMap.get(WS.preview.fileId);
        }
        for (const entry of WS.nav.entries || []) {
          if (entry && entry.kind === "file" && idMap.has(String(entry.id || ""))) {
            entry.id = idMap.get(String(entry.id || ""));
          }
        }
        for (const it of viewerItems || []) {
          if (it && !it.isFolder && idMap.has(String(it.id || ""))) it.id = idMap.get(String(it.id || ""));
        }
      }
      WS.view.randomCache = remapPathMapKeys(WS.view.randomCache, oldPrefix, newPrefix);
    }

    function updateFileRecordsForFileRenames(dirNode, renameMap) {
      if (!dirNode || !renameMap || !renameMap.size) return;
      const dirPath = String(dirNode.path || "");
      const idMap = new Map();
      const nextFileById = new Map();

      for (const [id, rec] of WS.fileById.entries()) {
        if (String(rec.dirPath || "") !== dirPath) {
          nextFileById.set(id, rec);
          continue;
        }
        const oldName = String(rec.name || "");
        if (!renameMap.has(oldName)) {
          nextFileById.set(id, rec);
          continue;
        }
        const newName = renameMap.get(oldName);
        const extDot = newName.lastIndexOf(".");
        const ext = extDot >= 0 ? newName.slice(extDot).toLowerCase() : "";
        const relPath = dirPath ? (dirPath + "/" + newName) : newName;
        rec.name = newName;
        rec.ext = ext;
        rec.relPath = relPath;
        const nextId = fileKey(rec.file, relPath);
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
      }

      WS.fileById = nextFileById;

      if (idMap.size) {
        remapFileIdsInDirTree(idMap);
        remapFileSelectionIds(idMap);
        if (WS.preview.kind === "file" && WS.preview.fileId && idMap.has(WS.preview.fileId)) {
          WS.preview.fileId = idMap.get(WS.preview.fileId);
        }
        for (const entry of WS.nav.entries || []) {
          if (entry && entry.kind === "file" && idMap.has(String(entry.id || ""))) {
            entry.id = idMap.get(String(entry.id || ""));
          }
        }
        for (const it of viewerItems || []) {
          if (it && !it.isFolder && idMap.has(String(it.id || ""))) it.id = idMap.get(String(it.id || ""));
        }
      }

      WS.view.randomCache.delete(dirPath);
    }

    async function performBatchIndexForDir(dirNode, opts = {}) {
      if (!dirNode || !WS.meta.fsRootHandle) return { renamed: false, files: 0 };

      const dirPath = String(dirNode.path || "");
      const base = String(dirNode.name || "folder");
      const dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);

      const files = [];
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind !== "file") continue;
        files.push({ name, handle });
      }

      files.sort((a, b) => a.name.localeCompare(b.name));

      const count = files.length;
      if (!count) return { renamed: false, files: 0 };
      const width = String(count).length + 1;

      const renameMap = new Map();
      const labelBase = opts.label || "Batch Index";
      for (let i = 0; i < count; i++) {
        const idx = String(i + 1).padStart(width, "0");
        const oldName = files[i].name;
        const dot = oldName.lastIndexOf(".");
        const ext = dot >= 0 ? oldName.slice(dot + 1) : "";
        const newName = `${base}_${idx}${ext ? "." + ext : ""}`;
        if (newName === oldName) continue;

        let exists = false;
        try {
          await dirHandle.getFileHandle(newName);
          exists = true;
        } catch {}
        if (exists) continue;

        if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (${i + 1}/${count})`);
        else showBusyOverlay(`${labelBase}... ${i + 1}/${count}`);
        const ok = await renameFileOnDisk(dirHandle, files[i].handle, oldName, newName);
        if (ok) renameMap.set(oldName, newName);
      }

      if (renameMap.size) {
        updateFileRecordsForFileRenames(dirNode, renameMap);
        return { renamed: true, files: renameMap.size };
      }
      return { renamed: false, files: 0 };
    }

    async function batchIndexFolderFiles(dirNode) {
      if (RENAME_BUSY) return false;
      if (!dirNode) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      RENAME_BUSY = true;
      showBusyOverlay("Batch Index I...");
      try {
        const res = await performBatchIndexForDir(dirNode, { label: "Batch Index I" });
        if (res.renamed) {
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          showStatusMessage("Batch Index I complete.");
          return true;
        }
        showStatusMessage("No files renamed.");
        return false;
      } finally {
        RENAME_BUSY = false;
        hideBusyOverlay();
      }
    }

    async function batchIndexChildFolderFiles(dirNode) {
      if (RENAME_BUSY) return false;
      if (!dirNode) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      const children = (dirNode.childrenDirs || []).slice();
      children.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
      if (!children.length) {
        showStatusMessage("No subfolders found.");
        return false;
      }

      RENAME_BUSY = true;
      showBusyOverlay("Batch Index II...");
      let renamedAny = false;
      try {
        for (let i = 0; i < children.length; i++) {
          const child = children[i];
          if (!child) continue;
          const progress = `${i + 1}/${children.length}`;
          const res = await performBatchIndexForDir(child, { label: "Batch Index II", progress });
          if (res.renamed) renamedAny = true;
        }

        if (renamedAny) {
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          showStatusMessage("Batch Index II complete.");
          return true;
        }
        showStatusMessage("No files renamed.");
        return false;
      } finally {
        RENAME_BUSY = false;
        hideBusyOverlay();
      }
    }

    async function renameFolderDirNode(dirNode, nextName) {
      if (!dirNode) return false;
      if (!dirNode.parent) {
        showStatusMessage("Root folder cannot be renamed.");
        return false;
      }
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Rename requires a writable folder.");
        return false;
      }

      const clean = normalizeFolderNameInput(nextName);
      if (!isValidFolderName(clean)) {
        showStatusMessage("Invalid folder name.");
        return false;
      }
      if (clean === String(dirNode.name || "")) return true;

      const lower = clean.toLowerCase();
      for (const d of dirNode.parent.childrenDirs || []) {
        if (d !== dirNode && String(d.name || "").toLowerCase() === lower) {
          showStatusMessage("A folder with that name already exists.");
          return false;
        }
      }

      const oldPath = String(dirNode.path || "");
      const state = snapshotRefreshState();
      showBusyOverlay("Renaming folder...");
      try {
        await renameDirectoryOnDisk(oldPath, clean);
        const { oldPath: prevPath, newPath } = applyRenameInMemory(dirNode, clean);
        updateFileRecordsForRename(prevPath, newPath);
        metaComputeFingerprints();
        WS.meta.dirty = true;

        try {
          if (WS.meta.storageMode === "fs") await metaSaveFsNow();
          else metaSaveLocalNow();
        } catch {}

        const entryKey = state?.entryKey || null;
        if (entryKey && entryKey.kind === "dir") {
          entryKey.path = remapPathPrefix(prevPath, newPath, entryKey.path);
        } else if (entryKey && entryKey.kind === "file") {
          entryKey.relPath = remapPathPrefix(prevPath, newPath, entryKey.relPath);
        }

        rebuildDirectoriesEntries();
        const idx = restoreRefreshSelection(entryKey);
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();

        showStatusMessage("Rename complete.");
        return true;
      } catch {
        showStatusMessage("Rename failed.");
        return false;
      } finally {
        hideBusyOverlay();
      }
    }

    if (refreshBtn) refreshBtn.addEventListener("click", async () => {
      try {
        await refreshWorkspaceFromRootHandle();
      } catch {}
    });

    openWritableBtn.addEventListener("click", async () => {
      if (!window.showDirectoryPicker) return;
      try {
        const rootHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        if (!rootHandle) return;
        await buildWorkspaceFromDirectoryHandle(rootHandle);
      } catch {}
    });

    /* =========================================================
       Sorting helpers
       ========================================================= */

    function byName(a, b) {
      return compareIndexedNames(a?.name || "", b?.name || "");
    }

    function sortDirsForDisplay(dirs) {
      const out = dirs.slice();
      if (WS.meta.dirSortMode === "score") {
        out.sort((a, b) => {
          const sa = metaGetScore(a?.path || "");
          const sb = metaGetScore(b?.path || "");
          if (sa !== sb) return sb - sa;
          return byName(a, b);
        });
        return out;
      }
      out.sort(byName);
      return out;
    }

    function passesFilter(rec) {
      if (!rec) return false;
      const m = WS.view.filterMode;
      if (m === "images") return rec.type === "image";
      if (m === "videos") return rec.type === "video";
      if (m === "gifs") return rec.ext === ".gif";
      return true;
    }

    function dirItemCount(node) {
      let c = 0;
      for (const id of node.childrenFiles) {
        const rec = WS.fileById.get(id);
        if (passesFilter(rec)) c++;
      }
      for (const d of node.childrenDirs) c += dirItemCount(d);
      return c;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
      }[c]));
    }

    function getRandomOrderForDir(dirNode) {
      if (!dirNode) return [];
      const p = dirNode.path || "";
      if (WS.view.randomCache.has(p)) return WS.view.randomCache.get(p).slice();
      const ids = dirNode.childrenFiles.slice();
      ids.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      const seed = (WS.view.randomSeed ^ hash32(p)) >>> 0;
      const out = shuffleWithSeed(ids.slice(), seed);
      WS.view.randomCache.set(p, out.slice());
      return out.slice();
    }

    function getOrderedFileIdsForDir(dirNode, includeChildren = false) {
      if (!dirNode) return [];
      let ids = [];

      if (dirNode.preserveOrder) {
        ids = dirNode.childrenFiles.slice();
      } else {
        ids = dirNode.childrenFiles.slice();
        ids.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      }

      ids = ids.filter(id => passesFilter(WS.fileById.get(id)));

      if (!includeChildren) return ids;

      for (const child of getChildDirsForNode(dirNode)) {
        const childIds = getOrderedFileIdsForDir(child, false);
        for (const id of childIds) ids.push(id);
      }

      return ids;
    }

    function invalidateAllThumbs() {
      for (const it of WS.fileById.values()) {
        if (!it) continue;
        if (it.thumbUrl && it.thumbMode && it.thumbMode !== "high") {
          try { URL.revokeObjectURL(it.thumbUrl); } catch {}
          it.thumbUrl = null;
        }
        it.thumbMode = null;

        if (it.videoThumbUrl) {
          try { URL.revokeObjectURL(it.videoThumbUrl); } catch {}
          it.videoThumbUrl = null;
        }
        it.videoThumbMode = null;
      }
      WS.videoThumbQueue = [];
      WS.imageThumbQueue = [];
    }

    /* =========================================================
       Directories Pane
       - lists folders + files for WS.nav.dirNode
       - selection drives Preview Pane
       ========================================================= */

    function isDirHidden(dirNode) {
      if (!dirNode) return false;
      return metaHasHidden(dirNode.path || "");
    }

    function isDirOrAncestorHidden(dirNode) {
      let cur = dirNode;
      while (cur) {
        if (metaHasHidden(cur.path || "")) return true;
        cur = cur.parent;
      }
      return false;
    }

    async function renameSingleFile(rec, nextName) {
      if (!rec) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      const clean = String(nextName || "").trim();
      if (!isValidFileName(clean)) {
        showStatusMessage("Invalid file name.");
        return false;
      }
      if (clean === String(rec.name || "")) return true;

      const dirPath = String(rec.dirPath || "");
      const dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);
      let existing = false;
      try {
        await dirHandle.getFileHandle(clean);
        existing = true;
      } catch {}
      if (existing) {
        showStatusMessage("A file with that name already exists.");
        return false;
      }

      const fileHandle = await dirHandle.getFileHandle(String(rec.name || ""));
      const ok = await renameFileOnDisk(dirHandle, fileHandle, String(rec.name || ""), clean);
      if (!ok) {
        showStatusMessage("Rename failed.");
        return false;
      }

      const dirNode = WS.dirByPath.get(dirPath) || null;
      if (dirNode) {
        const renameMap = new Map([[String(rec.name || ""), clean]]);
        updateFileRecordsForFileRenames(dirNode, renameMap);
      }

      metaComputeFingerprints();
      WS.meta.dirty = true;
      try {
        if (WS.meta.storageMode === "fs") await metaSaveFsNow();
        else metaSaveLocalNow();
      } catch {}

      showStatusMessage("Rename complete.");
      return true;
    }

    function getChildDirsForNodeBase(dirNode) {
      if (!dirNode) return [];
      const base = sortDirsForDisplay(dirNode.childrenDirs).filter(d => dirItemCount(d) > 0);
      const showHidden = WS.view.hiddenMode || (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden");
      if (showHidden) return base;
      return base.filter(d => !isDirOrAncestorHidden(d));
    }

    function treatTagsAsFoldersEnabled() {
      return true;
    }

    function showHiddenFolderEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showHiddenFolder);
    }

    function isViewingTagFolder() {
      return !!WS.view.tagFolderActiveMode;
    }

    function gatherTagGroupsForDir(dirNode) {
      const groups = new Map();
      if (!dirNode) return groups;
      const children = getChildDirsForNodeBase(dirNode);
      for (const child of children) {
        const tags = metaGetUserTags(child.path || "");
        const seen = new Set();
        for (const tag of tags) {
          const key = String(tag || "");
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const list = groups.get(key) || [];
          list.push(child);
          groups.set(key, list);
        }
      }
      return groups;
    }

    function getTagFolderEntries() {
      if (!treatTagsAsFoldersEnabled()) return [];
      if (!WS.root || !WS.nav.dirNode) return [];
      if (WS.view.dirSearchPinned || WS.view.favoritesMode || WS.view.hiddenMode) return [];

      const entries = [];
      if (BULK_TAG_PLACEHOLDER) {
        entries.push({
          kind: "tag",
          label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
          tag: "",
          count: BULK_TAG_PLACEHOLDER.count || 0,
          placeholder: true
        });
      }

      const dirNode = WS.nav.dirNode;
      const allChildren = sortDirsForDisplay(dirNode.childrenDirs).filter(d => dirItemCount(d) > 0);
      const children = getChildDirsForNodeBase(dirNode);

      const favs = allChildren.filter(d => metaHasFavorite(d.path || ""));
      if (favs.length) {
        entries.push({ kind: "tag", label: "Favorites", special: "favorites", count: favs.length });
      }
      if (showHiddenFolderEnabled()) {
        const hidden = allChildren.filter(d => metaHasHidden(d.path || ""));
        if (hidden.length) {
          entries.push({ kind: "tag", label: "Hidden", special: "hidden", count: hidden.length });
        }
      }

      const tagGroups = gatherTagGroupsForDir(dirNode);
      if (tagGroups.size) {
        const sorted = Array.from(tagGroups.keys()).sort((a, b) => String(a).localeCompare(String(b)));
        for (const tag of sorted) {
          const nodes = tagGroups.get(tag) || [];
          if (!nodes.length) continue;
          entries.push({ kind: "tag", tag, label: tag, count: nodes.length });
        }
      }

      return entries;
    }

    function getTagFolderBaseNode() {
      const basePath = String(WS.view.tagFolderOriginPath || "");
      if (basePath) {
        const node = WS.dirByPath.get(basePath);
        if (node) return node;
      }
      return WS.nav.dirNode || WS.root;
    }

    function getDirsForTagFolderView() {
      if (!isViewingTagFolder()) return [];
      const baseNode = getTagFolderBaseNode();
      if (!baseNode) return [];
      const children = getChildDirsForNodeBase(baseNode);
      if (WS.view.tagFolderActiveMode === "favorites") {
        return children.filter(d => metaHasFavorite(d.path || ""));
      }
      if (WS.view.tagFolderActiveMode === "hidden") {
        return children.filter(d => metaHasHidden(d.path || ""));
      }
      const tag = String(WS.view.tagFolderActiveTag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function getDirsForTagViewFrame(frame) {
      if (!frame) return [];
      const baseNode = WS.dirByPath.get(String(frame.originPath || "")) || WS.root;
      if (!baseNode) return [];
      const children = getChildDirsForNodeBase(baseNode);
      if (frame.mode === "favorites") return children.filter(d => metaHasFavorite(d.path || ""));
      if (frame.mode === "hidden") return children.filter(d => metaHasHidden(d.path || ""));
      const tag = String(frame.tag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function getDirsForTagEntry(entry) {
      if (!entry || entry.kind !== "tag") return [];
      const dirNode = WS.nav.dirNode;
      if (!dirNode) return [];
      const children = getChildDirsForNodeBase(dirNode);
      if (!children.length) return [];
      if (entry.special) {
        if (entry.special === "favorites") {
          return children.filter(d => metaHasFavorite(d.path || ""));
        }
        if (entry.special === "hidden") {
          return children.filter(d => metaHasHidden(d.path || ""));
        }
        return [];
      }
      const tag = String(entry.tag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function makeTagPreviewNode(entry) {
      const baseNode = WS.nav.dirNode;
      if (!entry || !baseNode) return null;
      const dirs = getDirsForTagEntry(entry);
      const label = String(entry.label || entry.tag || entry.special || "Tag");
      const pathSuffix = entry.special ? entry.special : entry.tag || "tag";
      const safeSuffix = String(pathSuffix || "tag").replace(/[\/\\]/g, "_");
      const virtualPath = `${String(baseNode.path || "")}/@tag-${safeSuffix}`;
      return {
        type: "dir",
        name: label,
        parent: baseNode,
        childrenDirs: dirs,
        childrenFiles: [],
        path: virtualPath,
        _skipTagFilters: true
      };
    }

    function findTagEntryIndex(mode, tag) {
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "tag") continue;
        if (mode && entry.special && entry.special === mode) return i;
        if (mode === "tag" && entry.tag && entry.tag === tag) return i;
      }
      return -1;
    }

    function restoreTagFolderEntrySelection(ctx) {
      if (!ctx) return false;
      const baseNode = WS.dirByPath.get(String(ctx.originPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderOriginPath = "";
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findTagEntryIndex(ctx.mode, ctx.tag);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return true;
    }

    function setTagFolderViewState(mode, tag, originPath) {
      WS.view.tagFolderActiveMode = mode;
      WS.view.tagFolderActiveTag = tag;
      WS.view.tagFolderOriginPath = String(originPath || "");
      closeActionMenus();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function getDirectoriesScrollTop() {
      if (!directoriesListEl) return 0;
      return directoriesListEl.scrollTop || 0;
    }

    function setDirectoriesScrollTop(value) {
      if (!directoriesListEl || typeof value !== "number") return;
      directoriesListEl.scrollTop = value;
    }

    function ensureTagNavStack() {
      if (!Array.isArray(WS.view.tagNavStack)) WS.view.tagNavStack = [];
      return WS.view.tagNavStack;
    }

    function pushTagNavFrame(frame) {
      if (!frame) return;
      ensureTagNavStack().push(frame);
    }

    function pushTagEntryContext(mode, tag) {
      pushTagNavFrame({
        type: "tag-entry",
        dirPath: String(WS.nav.dirNode?.path || ""),
        entryMode: mode || "",
        entryTag: tag || "",
        selectedIndex: WS.nav.selectedIndex,
        scrollTop: getDirectoriesScrollTop()
      });
    }

    function pushTagViewContext(selectedDirPath) {
      const orderedPaths = getDirsForTagFolderView().map(d => String(d?.path || "")).filter(Boolean);
      pushTagNavFrame({
        type: "tag-view",
        mode: WS.view.tagFolderActiveMode,
        tag: WS.view.tagFolderActiveTag,
        originPath: String(WS.view.tagFolderOriginPath || ""),
        selectedDirPath: String(selectedDirPath || ""),
        scrollTop: getDirectoriesScrollTop(),
        orderedPaths
      });
    }

    function restoreTagViewFromFrame(frame) {
      if (!frame) return false;
      const baseNode = WS.dirByPath.get(String(frame.originPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      setTagFolderViewState(frame.mode || "", frame.tag || "", frame.originPath);
      const idx = frame.selectedDirPath ? findDirEntryIndexByPath(frame.selectedDirPath) : -1;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      setDirectoriesScrollTop(frame.scrollTop);
      return true;
    }

    function restoreDirectoriesFromTagEntryFrame(frame) {
      if (!frame) return false;
      const baseNode = WS.dirByPath.get(String(frame.dirPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderOriginPath = "";
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findTagEntryIndex(frame.entryMode, frame.entryTag);
      const targetIndex = idx >= 0 ? idx : (typeof frame.selectedIndex === "number" ? frame.selectedIndex : 0);
      WS.nav.selectedIndex = findNearestSelectableIndex(targetIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      setDirectoriesScrollTop(frame.scrollTop);
      return true;
    }

    function tryRestoreTagDirectoryContext() {
      const stack = WS.view.tagNavStack;
      if (!Array.isArray(stack) || !stack.length) return false;
      const frame = stack[stack.length - 1];
      if (frame.type !== "tag-view") return false;
      stack.pop();
      return restoreTagViewFromFrame(frame);
    }

    function tryRestoreTagEntryContext() {
      const stack = WS.view.tagNavStack;
      if (!Array.isArray(stack) || !stack.length) return false;
      const frame = stack[stack.length - 1];
      if (frame.type !== "tag-entry") return false;
      stack.pop();
      return restoreDirectoriesFromTagEntryFrame(frame);
    }

    function exitTagFolderView() {
      if (!isViewingTagFolder()) return;
      if (tryRestoreTagEntryContext()) return;
      const ctx = {
        mode: WS.view.tagFolderActiveMode,
        tag: WS.view.tagFolderActiveTag,
        originPath: WS.view.tagFolderOriginPath
      };
      if (!restoreTagFolderEntrySelection(ctx)) {
        setTagFolderViewState("", "", "");
      }
    }

    function openTagFolderEntry(entry) {
      if (!entry) return;
      const mode = entry.special ? entry.special : "tag";
      const tag = entry.special ? "" : (entry.tag || "");
      pushTagEntryContext(mode, tag);
      const originPath = String(WS.nav.dirNode?.path || "");
      setTagFolderViewState(mode, tag, originPath);
    }

    function getChildDirsForNode(dirNode) {
      return getChildDirsForNodeBase(dirNode);
    }

    function getVisibleSiblingDirsForSlide(dirNode) {
      const dp = String(dirNode?.path || "");
      const stack = WS.view.tagNavStack;
      if (Array.isArray(stack) && stack.length) {
        const frame = stack[stack.length - 1];
        if (frame && frame.type === "tag-view") {
          if (Array.isArray(frame.orderedPaths) && frame.orderedPaths.length) {
            const nodes = frame.orderedPaths
              .map(p => WS.dirByPath.get(String(p || "")))
              .filter(Boolean);
            if (nodes.length) {
              const match = nodes.some(d => String(d?.path || "") === dp);
              if (match) return nodes;
            }
          }
          const tagDirs = getDirsForTagViewFrame(frame);
          if (tagDirs.length) {
            const match = tagDirs.some(d => String(d?.path || "") === dp);
            if (match) return tagDirs;
          }
        }
      }

      if (WS.view.dirSearchPinned && !WS.view.searchRootActive && dp && dp === String(WS.view.searchAnchorPath || "")) {
        return (WS.view.searchResults || []).slice();
      }

      if (WS.view.favoritesMode && !WS.view.favoritesRootActive && dp && dp === String(WS.view.favoritesAnchorPath || "")) {
        return getAllFavoriteDirs();
      }

      if (WS.view.hiddenMode && !WS.view.hiddenRootActive && dp && dp === String(WS.view.hiddenAnchorPath || "")) {
        return getAllHiddenDirs();
      }

      const p = dirNode?.parent;
      if (!p) return [];
      return getChildDirsForNodeBase(p);
    }

    function getNextSiblingDirWithFiles(dirNode) {
      if (!dirNode) return null;
      const sibs = getVisibleSiblingDirsForSlide(dirNode);
      const idx = sibs.indexOf(dirNode);
      if (idx < 0) return null;
      for (let i = idx + 1; i < sibs.length; i++) {
        const d = sibs[i];
        if (getOrderedFileIdsForDir(d).length) return d;
      }
      return null;
    }

    function getPrevSiblingDirWithFiles(dirNode) {
      if (!dirNode) return null;
      const sibs = getVisibleSiblingDirsForSlide(dirNode);
      const idx = sibs.indexOf(dirNode);
      if (idx < 0) return null;
      for (let i = idx - 1; i >= 0; i--) {
        const d = sibs[i];
        if (getOrderedFileIdsForDir(d).length) return d;
      }
      return null;
    }

    function getAllFavoriteDirs() {
      const out = [];
      if (!WS.root) return out;
      for (const [path, node] of WS.dirByPath.entries()) {
        const p = String(path || "");
        if (!p) continue;
        if (!node || node.type !== "dir") continue;
        if (metaHasFavorite(p) && !metaHasHidden(p)) out.push(node);
      }
      out.sort((a, b) => {
        const ap = displayPath(a.path || "");
        const bp = displayPath(b.path || "");
        const c = ap.localeCompare(bp);
        if (c) return c;
        return compareIndexedNames(a?.name || "", b?.name || "");
      });
      return out;
    }

    function getAllHiddenDirs() {
      const out = [];
      if (!WS.root) return out;
      for (const [path, node] of WS.dirByPath.entries()) {
        const p = String(path || "");
        if (!p) continue;
        if (!node || node.type !== "dir") continue;
        if (metaHasHidden(p)) out.push(node);
      }
      out.sort((a, b) => {
        const ap = displayPath(a.path || "");
        const bp = displayPath(b.path || "");
        const c = ap.localeCompare(bp);
        if (c) return c;
        return compareIndexedNames(a?.name || "", b?.name || "");
      });
      return out;
    }

    function cancelDirectorySearch() {
      WS.view.dirSearchPinned = false;
      WS.view.dirSearchQuery = "";
      WS.view.searchRootActive = false;
      WS.view.searchRootPath = "";
      WS.view.searchAnchorPath = "";
      WS.view.searchEntryRootPath = "";
      WS.view.searchRootIsFavorites = false;
      WS.view.searchRootFavorites = [];
      WS.view.searchRootIsHidden = false;
      WS.view.searchRootHidden = [];
      WS.view.searchResults = [];
    }

    function computeDirectorySearchResults() {
      const q = String(WS.view.dirSearchQuery || "").trim().toLowerCase();
      WS.view.searchResults = [];
      if (!WS.root || !q) return;

      const countMemo = new Map();
      const getCount = (node) => {
        if (!node) return 0;
        const p = String(node.path || "");
        if (countMemo.has(p)) return countMemo.get(p);
        const c = dirItemCount(node) | 0;
        countMemo.set(p, c);
        return c;
      };

      const addSet = new Set();
      const results = [];
      const skipHidden = !WS.view.hiddenMode;
      const consider = (node, includeSelf) => {
        if (!node) return;
        if (skipHidden && isDirOrAncestorHidden(node)) return;
        if (getCount(node) <= 0) return;

        const name = displayName(node.name || "").toLowerCase();
        if (includeSelf && name.includes(q)) {
          const p = String(node.path || "");
          if (p && !addSet.has(p)) {
            addSet.add(p);
            results.push(node);
          }
        }

        for (const d of node.childrenDirs) consider(d, true);
      };

      if (WS.view.searchRootIsFavorites) {
        const roots = Array.isArray(WS.view.searchRootFavorites) ? WS.view.searchRootFavorites : [];
        for (let i = 0; i < roots.length; i++) consider(roots[i], true);
      } else if (WS.view.searchRootIsHidden) {
        const roots = Array.isArray(WS.view.searchRootHidden) ? WS.view.searchRootHidden : [];
        for (let i = 0; i < roots.length; i++) consider(roots[i], true);
      } else {
        const rp = String(WS.view.searchRootPath || "");
        const rootNode = WS.dirByPath.get(rp) || WS.root;
        consider(rootNode, false);
      }

      results.sort((a, b) => {
        const ap = displayPath(a.path || "");
        const bp = displayPath(b.path || "");
        const c = ap.localeCompare(bp);
        if (c) return c;
        return compareIndexedNames(a?.name || "", b?.name || "");
      });

      WS.view.searchResults = results;
    }

    function syncFavoritesUi() {
      if (favoritesBtn) {
        const n = WS.root ? getAllFavoriteDirs().length : 0;
        favoritesBtn.textContent = `Favorites${n ? ` (${n})` : ""}`;
        favoritesBtn.classList.toggle("active", !!WS.view.favoritesMode);
        favoritesBtn.disabled = !WS.root;
      }
    }

    function syncHiddenUi() {
      if (hiddenBtn) {
        const n = WS.root ? getAllHiddenDirs().length : 0;
        hiddenBtn.textContent = `Hidden${n ? ` (${n})` : ""}`;
        hiddenBtn.classList.toggle("active", !!WS.view.hiddenMode);
        hiddenBtn.disabled = !WS.root;
      }
    }

    function syncTagUiForCurrentDir() {
      if (!WS.root || !WS.nav.dirNode) return;
    }

    function rebuildDirectoriesEntries() {
      WS.nav.entries = [];

      if (!WS.root) return;

      if (isViewingTagFolder()) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const nodes = getDirsForTagFolderView();
        for (const d of nodes) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const dirs = (WS.view.searchResults || []).slice();
        for (let i = 0; i < dirs.length; i++) WS.nav.entries.push({ kind: "dir", node: dirs[i] });
        return;
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const dirs = getAllFavoriteDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        if (BULK_TAG_PLACEHOLDER) {
          WS.nav.entries.push({
            kind: "tag",
            label: BULK_TAG_PLACEHOLDER.label || "New tag folder",
            tag: "",
            count: BULK_TAG_PLACEHOLDER.count || 0,
            placeholder: true
          });
        }
        const dirs = getAllHiddenDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      const dirNode = WS.nav.dirNode;
      if (!dirNode) return;

      const tagEntries = getTagFolderEntries();
      if (tagEntries.length) {
        for (const entry of tagEntries) WS.nav.entries.push(entry);
      }

      const dirs = getChildDirsForNode(dirNode);
      for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });

      const baseFiles = getOrderedFileIdsForDir(dirNode);

      if (WS.view.folderBehavior === "loop") {
        const reps = Math.max(1, WS.view.dirLoopRepeats | 0);
        for (let r = 0; r < reps; r++) {
          for (const id of baseFiles) WS.nav.entries.push({ kind: "file", id });
        }
      } else {
        for (const id of baseFiles) WS.nav.entries.push({ kind: "file", id });
      }
    }

    function isSelectableEntry(entry) {
      return entry && (entry.kind === "dir" || entry.kind === "file" || entry.kind === "tag");
    }

    function findNearestSelectableIndex(idx, direction) {
      if (!WS.nav.entries.length) return 0;
      let i = Math.max(0, Math.min(WS.nav.entries.length - 1, idx));
      if (isSelectableEntry(WS.nav.entries[i])) return i;
      const step = direction >= 0 ? 1 : -1;
      let j = i;
      while (j >= 0 && j < WS.nav.entries.length) {
        if (isSelectableEntry(WS.nav.entries[j])) return j;
        j += step;
      }
      j = i - step;
      while (j >= 0 && j < WS.nav.entries.length) {
        if (isSelectableEntry(WS.nav.entries[j])) return j;
        j -= step;
      }
      return i;
    }

    function findDirEntryIndexByPath(path) {
      const p = String(path || "");
      if (!p) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "dir" && String(entry.node?.path || "") === p) return i;
      }
      return -1;
    }

    function setDirectoriesSelection(idx) {
      if (!WS.nav.entries.length) {
        WS.nav.selectedIndex = 0;
        WS.preview.kind = null;
        WS.preview.dirNode = null;
        WS.preview.fileId = null;
        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        return;
      }
      closeActionMenus();
      const i = findNearestSelectableIndex(idx, idx >= WS.nav.selectedIndex ? 1 : -1);
      WS.nav.selectedIndex = i;
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(false);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function returnToSearchResults() {
      const target = String(WS.view.searchEntryRootPath || WS.view.searchAnchorPath || "");
      WS.view.searchRootActive = true;
      WS.view.searchAnchorPath = "";
      WS.view.searchEntryRootPath = "";
      rebuildDirectoriesEntries();
      const idx = target ? findDirEntryIndexByPath(target) : -1;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      recordDirHistory();
    }

    function syncPreviewToSelection() {
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry || !isSelectableEntry(entry)) {
        WS.preview.kind = null;
        WS.preview.dirNode = null;
        WS.preview.fileId = null;
        return;
      }
      if (entry.kind === "dir") {
        WS.preview.kind = "dir";
        WS.preview.dirNode = entry.node;
        WS.preview.fileId = null;
      } else if (entry.kind === "file") {
        WS.preview.kind = "file";
        WS.preview.fileId = entry.id;
        WS.preview.dirNode = null;
      } else if (entry.kind === "tag") {
        const node = makeTagPreviewNode(entry);
        if (node) {
          WS.preview.kind = "dir";
          WS.preview.dirNode = node;
          WS.preview.fileId = null;
        } else {
          WS.preview.kind = null;
          WS.preview.dirNode = null;
          WS.preview.fileId = null;
        }
      } else {
        WS.preview.kind = null;
        WS.preview.dirNode = null;
        WS.preview.fileId = null;
      }
    }

    function altGalleryModeEnabled() {
      return true;
    }

    function enterSelectedDirectory() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return;
      if (entry.kind === "tag") {
        openTagFolderEntry(entry);
        return;
      }

      if (isViewingTagFolder()) {
        pushTagViewContext(entry.node?.path || "");
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderOriginPath = "";
      }
      if (entry.kind !== "dir" || !entry.node) {
        if (altGalleryModeEnabled() && entry.kind === "file") {
          openGalleryFromDirectoriesSelection(true);
        }
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        WS.view.searchRootActive = false;
        WS.view.searchAnchorPath = entry.node.path || "";
        WS.view.searchEntryRootPath = entry.node.path || "";
        WS.nav.dirNode = entry.node;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();

        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        WS.view.favoritesRootActive = false;
        WS.view.favoritesAnchorPath = entry.node.path || "";
        WS.nav.dirNode = entry.node;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();

        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        WS.view.hiddenRootActive = false;
        WS.view.hiddenAnchorPath = entry.node.path || "";
        WS.nav.dirNode = entry.node;
        syncBulkSelectionForCurrentDir();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();

        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      WS.nav.dirNode = entry.node;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      recordDirHistory();
    }

    function leaveDirectory() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();

      if (tryRestoreTagDirectoryContext()) return;

      if (isViewingTagFolder()) {
        exitTagFolderView();
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;

      if (WS.view.dirSearchPinned && !WS.view.searchRootActive) {
        returnToSearchResults();
        return;
      }

      if (WS.view.favoritesMode && !WS.view.favoritesRootActive) {
        const cur = String(WS.nav.dirNode?.path || "");
        if (cur && cur === String(WS.view.favoritesAnchorPath || "")) {
          WS.view.favoritesRootActive = true;
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
          syncPreviewToSelection();
          renderDirectoriesPane();
          renderPreviewPane(true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      if (WS.view.hiddenMode && !WS.view.hiddenRootActive) {
        const cur = String(WS.nav.dirNode?.path || "");
        if (cur && cur === String(WS.view.hiddenAnchorPath || "")) {
          WS.view.hiddenRootActive = true;
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
          syncPreviewToSelection();
          renderDirectoriesPane();
          renderPreviewPane(true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
      const child = WS.nav.dirNode;
      WS.nav.dirNode = WS.nav.dirNode.parent;

      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      let idx = 0;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const e = WS.nav.entries[i];
        if (e.kind === "dir" && (e.node === child || (child.path && e.node?.path === child.path))) { idx = i; break; }
      }
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();

      WS.view.pendingDirScroll = "center-selected";
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();

      recordDirHistory();
    }

    function goDirHistory(delta) {
      if (!WS.view.dirHistory.length) return;
      const next = WS.view.dirHistoryIndex + delta;
      if (next < 0 || next >= WS.view.dirHistory.length) return;
      WS.view.dirHistoryIndex = next;
      restoreDirHistoryEntry(WS.view.dirHistory[next]);
    }

    function goDirUp() {
      if (tryRestoreTagDirectoryContext()) return;
      if (isViewingTagFolder()) {
        exitTagFolderView();
        return;
      }
      if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
      leaveDirectory();
    }

    function getDirectoriesPathText() {
      if (!WS.root) return "—";
      if (isViewingTagFolder()) {
        const basePath = String(WS.view.tagFolderOriginPath || "");
        const baseLabel = basePath ? displayPath(basePath) : "root";
        if (WS.view.tagFolderActiveMode === "favorites") return `${baseLabel} · Favorites`;
        if (WS.view.tagFolderActiveMode === "hidden") return `${baseLabel} · Hidden`;
        const tagLabel = String(WS.view.tagFolderActiveTag || "").trim();
        return tagLabel ? `${baseLabel} · ${tagLabel}` : baseLabel;
      }
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return "search";
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
      if (!WS.nav.dirNode) return "—";
      if (WS.nav.dirNode === WS.root) return "root";
      const p = WS.nav.dirNode.path ? displayPath(WS.nav.dirNode.path) : "root";
      return p || "root";
    }

    function toggleFavoritesMode() {
      if (!WS.root) return;

      if (!WS.view.favoritesMode) {
        const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
        WS.view.favoritesReturnState = {
          dirPath: String(WS.nav.dirNode?.path || ""),
          sel: entry ? (entry.kind === "dir" ? { kind: "dir", path: String(entry.node?.path || "") } : { kind: "file", id: String(entry.id || "") }) : null
        };
        WS.view.favoritesMode = true;
        WS.view.favoritesRootActive = true;
        WS.view.favoritesAnchorPath = "";
      } else {
        WS.view.favoritesMode = false;
        WS.view.favoritesRootActive = false;
        WS.view.favoritesAnchorPath = "";

        const st = WS.view.favoritesReturnState;
        WS.view.favoritesReturnState = null;

        if (st && WS.root) {
          const dn = WS.dirByPath.get(String(st.dirPath || "")) || WS.root;
          WS.nav.dirNode = dn;
          syncBulkSelectionForCurrentDir();
          syncFavoritesUi();
          syncTagUiForCurrentDir();
          rebuildDirectoriesEntries();

          let idx = 0;
          if (st.sel && st.sel.kind === "dir") {
            const p = String(st.sel.path || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "dir" && String(e2.node?.path || "") === p) { idx = i; break; }
            }
          } else if (st.sel && st.sel.kind === "file") {
            const id = String(st.sel.id || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "file" && String(e2.id || "") === id) { idx = i; break; }
            }
          }
          WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function toggleHiddenMode() {
      if (!WS.root) return;

      if (!WS.view.hiddenMode) {
        const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
        WS.view.hiddenReturnState = {
          dirPath: String(WS.nav.dirNode?.path || ""),
          sel: entry ? (entry.kind === "dir" ? { kind: "dir", path: String(entry.node?.path || "") } : { kind: "file", id: String(entry.id || "") }) : null
        };
        WS.view.hiddenMode = true;
        WS.view.hiddenRootActive = true;
        WS.view.hiddenAnchorPath = "";
      } else {
        WS.view.hiddenMode = false;
        WS.view.hiddenRootActive = false;
        WS.view.hiddenAnchorPath = "";

        const st = WS.view.hiddenReturnState;
        WS.view.hiddenReturnState = null;

        if (st && WS.root) {
          const dn = WS.dirByPath.get(String(st.dirPath || "")) || WS.root;
          WS.nav.dirNode = dn;
          syncBulkSelectionForCurrentDir();
          syncFavoritesUi();
          syncHiddenUi();
          syncTagUiForCurrentDir();
          rebuildDirectoriesEntries();

          let idx = 0;
          if (st.sel && st.sel.kind === "dir") {
            const p = String(st.sel.path || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "dir" && String(e2.node?.path || "") === p) { idx = i; break; }
            }
          } else if (st.sel && st.sel.kind === "file") {
            const id = String(st.sel.id || "");
            for (let i = 0; i < WS.nav.entries.length; i++) {
              const e2 = WS.nav.entries[i];
              if (e2 && e2.kind === "file" && String(e2.id || "") === id) { idx = i; break; }
            }
          }
          WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(true, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function canUseBulkSelection() {
      if (!WS.root) return false;
      if (WS.nav.dirNode) return true;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return true;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return true;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return true;
      return false;
    }

    function getVisibleDirPathsInEntries() {
      const set = new Set();
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "dir") continue;
        const p = String(entry.node?.path || "");
        if (p) set.add(p);
      }
      return set;
    }

    function getVisibleFileIdsInEntries() {
      const set = new Set();
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "file") continue;
        const id = String(entry.id || "");
        if (id) set.add(id);
      }
      return set;
    }

    function getSelectedPathsInCurrentDir() {
      const baseSet = getVisibleDirPathsInEntries();
      return Array.from(WS.view.bulkTagSelectedPaths || []).filter(p => baseSet.has(String(p || "")));
    }

    function getSelectedFileIdsInCurrentView() {
      const baseSet = getVisibleFileIdsInEntries();
      return Array.from(WS.view.bulkFileSelectedIds || []).filter(id => baseSet.has(String(id || "")));
    }

    function closeActionMenus() {
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
      closeTagContextMenu();
    }

    function openBulkActionMenuForSelection(path) {
      const p = String(path || "");
      if (!p) return false;
      if (!WS.view.bulkSelectMode) return false;
      const selectedDirs = getSelectedPathsInCurrentDir();
      if (!selectedDirs.length) return false;
      if (!selectedDirs.includes(p)) return false;
      if (WS.view.bulkActionMenuOpen && WS.view.bulkActionMenuAnchorPath === p) {
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return true;
      }
      WS.view.bulkActionMenuOpen = true;
      WS.view.bulkActionMenuAnchorPath = p;
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      const idx = findDirEntryIndexByPath(p);
      if (idx >= 0) {
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      return true;
    }

    function openDirMenuForPath(path) {
      const p = String(path || "");
      if (!p) return;
      if (openBulkActionMenuForSelection(p)) return;
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = p;
      WS.view.fileActionMenuId = "";
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      const idx = findDirEntryIndexByPath(p);
      if (idx >= 0) {
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function openFileMenuForId(fileId) {
      const id = String(fileId || "");
      if (!id) return;
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = id;
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "file" && String(entry.id || "") === id) {
          WS.nav.selectedIndex = findNearestSelectableIndex(i, 1);
          syncPreviewToSelection();
          break;
        }
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    }

    function entryKeyForSelection(entry) {
      if (!entry) return "";
      if (entry.kind === "dir") return `dir:${String(entry.node?.path || "")}`;
      if (entry.kind === "file") return `file:${String(entry.id || "")}`;
      return "";
    }

    function findEntryIndexByKey(key) {
      if (!key) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entryKeyForSelection(entry) === key) return i;
      }
      return -1;
    }

    function toggleEntrySelection(entry) {
      if (!entry) return;
      if (entry.kind === "dir") {
        const p = String(entry.node?.path || "");
        if (!p) return;
        if (WS.view.bulkTagSelectedPaths.has(p)) WS.view.bulkTagSelectedPaths.delete(p);
        else WS.view.bulkTagSelectedPaths.add(p);
      } else if (entry.kind === "file") {
        const id = String(entry.id || "");
        if (!id) return;
        if (WS.view.bulkFileSelectedIds.has(id)) WS.view.bulkFileSelectedIds.delete(id);
        else WS.view.bulkFileSelectedIds.add(id);
      }
    }

    function addEntrySelection(entry) {
      if (!entry) return;
      if (entry.kind === "dir") {
        const p = String(entry.node?.path || "");
        if (p) WS.view.bulkTagSelectedPaths.add(p);
      } else if (entry.kind === "file") {
        const id = String(entry.id || "");
        if (id) WS.view.bulkFileSelectedIds.add(id);
      }
    }

    function selectEntryRange(anchorIdx, targetIdx) {
      if (anchorIdx < 0 || targetIdx < 0) return;
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      clearBulkTagSelection();
      WS.view.bulkSelectMode = true;
      for (let i = start; i <= end; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || !isSelectableEntry(entry)) continue;
        addEntrySelection(entry);
      }
    }

    function canTrackDirHistory() {
      if (!WS.root) return false;
      if (!WS.nav.dirNode) return false;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode || WS.view.hiddenMode) return false;
      return true;
    }

    function recordDirHistory() {
      if (!canTrackDirHistory()) return;
      const path = String(WS.nav.dirNode?.path || "");
      const selectedKey = entryKeyForSelection(WS.nav.entries[WS.nav.selectedIndex] || null);
      const cur = WS.view.dirHistory[WS.view.dirHistoryIndex] || null;
      if (cur && cur.path === path) {
        cur.selectedKey = selectedKey;
        return;
      }
      if (WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1) {
        WS.view.dirHistory = WS.view.dirHistory.slice(0, WS.view.dirHistoryIndex + 1);
      }
      WS.view.dirHistory.push({ path, selectedKey });
      WS.view.dirHistoryIndex = WS.view.dirHistory.length - 1;
    }

    function initDirHistory() {
      WS.view.dirHistory = [];
      WS.view.dirHistoryIndex = -1;
      if (!WS.root || !WS.nav.dirNode) return;
      const path = String(WS.nav.dirNode?.path || "");
      const selectedKey = entryKeyForSelection(WS.nav.entries[WS.nav.selectedIndex] || null);
      WS.view.dirHistory.push({ path, selectedKey });
      WS.view.dirHistoryIndex = 0;
    }

    function restoreDirHistoryEntry(entry) {
      if (!entry || !WS.root) return;
      const node = WS.dirByPath.get(String(entry.path || "")) || WS.root;
      WS.nav.dirNode = node;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      const idx = findEntryIndexByKey(String(entry.selectedKey || ""));
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function positionDropdownMenu(menuBtn, menuEl) {
      if (!menuBtn || !menuEl) return;
      menuEl.classList.add("fixed");
      menuEl.style.left = "0px";
      menuEl.style.top = "0px";
      menuEl.style.right = "auto";

      const btnRect = menuBtn.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();

      let left = btnRect.right - menuRect.width;
      if (left < 8) left = 8;
      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }

      let top = btnRect.bottom + 4;
      if (top + menuRect.height > window.innerHeight - 8) {
        top = btnRect.top - 4 - menuRect.height;
      }
      if (top < 8) top = 8;

      menuEl.style.left = `${left}px`;
      menuEl.style.top = `${top}px`;
    }

    async function commitRenameEdit(path, inputEl) {
      if (RENAME_BUSY) return;
      const dirNode = WS.dirByPath.get(String(path || ""));
      if (!dirNode) {
        RENAME_EDIT_PATH = null;
        renderDirectoriesPane(true);
        return;
      }
      RENAME_BUSY = true;
      const ok = await renameFolderDirNode(dirNode, inputEl.value || "");
      RENAME_BUSY = false;
      if (ok) {
        RENAME_EDIT_PATH = null;
        closeActionMenus();
        return;
      }
      renderDirectoriesPane(true);
    }

    async function commitFileRenameEdit(fileId, inputEl) {
      if (RENAME_BUSY) return;
      const rec = WS.fileById.get(String(fileId || ""));
      if (!rec) {
        RENAME_EDIT_FILE_ID = null;
        renderDirectoriesPane(true);
        return;
      }
      RENAME_BUSY = true;
      const ok = await renameSingleFile(rec, inputEl.value || "");
      RENAME_BUSY = false;
      if (ok) {
        RENAME_EDIT_FILE_ID = null;
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        return;
      }
      renderDirectoriesPane(true);
    }

    function getDirectoriesWithTag(tag) {
      if (!tag) return [];
      if (!WS.nav.dirNode) return [];
      const children = getChildDirsForNodeBase(WS.nav.dirNode);
      if (!children.length) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function gatherTagPathsForDirs(dirs) {
      const seen = new Set();
      const out = [];
      for (const dir of dirs || []) {
        const p = String(dir?.path || "");
        if (!p || seen.has(p)) continue;
        seen.add(p);
        out.push(p);
      }
      return out;
    }

    function closeTagContextMenu() {
      if (!tagActionMenuEl) return;
      tagActionMenuEl.classList.remove("open", "fixed");
      tagActionMenuEl.innerHTML = "";
      tagActionMenuEl.style.left = "";
      tagActionMenuEl.style.top = "";
      TAG_CONTEXT_MENU_STATE = null;
    }

    function openTagContextMenu(context) {
      if (!context || !tagActionMenuEl) return;
      const tag = String(context.tag || "").trim();
      const paths = Array.isArray(context.paths) ? context.paths : [];
      const anchor = context.anchor;
      if (!tag || !paths.length || !anchor) return;
      closeTagContextMenu();
      closeActionMenus();
      const menu = tagActionMenuEl;
      menu.appendChild(createTagMenuButton("Rename tag", () => handleTagMenuAction("rename")));
      menu.appendChild(createTagMenuButton("Delete tag", () => handleTagMenuAction("delete")));
      TAG_CONTEXT_MENU_STATE = {
        tag,
        label: context.label || tag,
        paths: paths.slice()
      };
      requestAnimationFrame(() => {
        menu.classList.add("open");
        positionDropdownMenu(anchor, menu);
      });
    }

    function createTagMenuButton(label, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        onClick();
      });
      return btn;
    }

    function renameTagForPaths(tag, newName, paths) {
      const normalizedOld = String(tag || "");
      const normalizedNew = normalizeTag(newName || "");
      if (!normalizedOld || !normalizedNew || normalizedOld === normalizedNew) return false;
      const uniquePaths = Array.from(new Set((paths || []).filter(p => p)));
      let changed = false;
      for (const p of uniquePaths) {
        const tags = metaGetUserTags(p);
        if (!tags.includes(normalizedOld)) continue;
        const updated = tags.slice();
        for (let i = 0; i < updated.length; i++) {
          if (updated[i] === normalizedOld) updated[i] = normalizedNew;
        }
        const deduped = [];
        const seen = new Set();
        for (const t of updated) {
          if (!t) continue;
          if (seen.has(t)) continue;
          seen.add(t);
          deduped.push(t);
        }
        if (metaWriteUserTags(p, deduped)) changed = true;
      }
      return changed;
    }

    function deleteTagFromPaths(tag, paths) {
      const normalized = String(tag || "");
      if (!normalized) return false;
      const uniquePaths = Array.from(new Set((paths || []).filter(p => p)));
      let changed = false;
      for (const p of uniquePaths) {
        const tags = metaGetUserTags(p);
        if (!tags.includes(normalized)) continue;
        const filtered = tags.filter(t => t !== normalized);
        if (metaWriteUserTags(p, filtered)) changed = true;
      }
      return changed;
    }

    function handleTagMenuAction(action) {
      const ctx = TAG_CONTEXT_MENU_STATE;
      if (!ctx) return;
      closeTagContextMenu();
      const tag = ctx.tag || "";
      const label = ctx.label || tag;
      const paths = ctx.paths || [];
      if (!tag || !paths.length) {
        showStatusMessage("No folders contain that tag.");
        return;
      }
      if (action === "rename") {
        TAG_ENTRY_RENAME_STATE = { tag, label, paths };
        renderDirectoriesPane(true);
        return;
      }
      if (action === "delete") {
        const confirmed = confirm(`Remove tag '${label}' from these folders?`);
        if (!confirmed) return;
        const changed = deleteTagFromPaths(tag, paths);
        if (!changed) {
          showStatusMessage("No folders updated.");
          return;
        }
        metaScheduleSave();
        refreshAfterTagMetadataChange();
      }
    }

    function renderDirectoriesTagsHeader() {
      if (!directoriesTagsRowEl) return;
      directoriesTagsRowEl.style.display = "none";
      directoriesTagsRowEl.innerHTML = "";
    }

    function renderDirectoriesActionHeader() {
      if (!directoriesActionRowEl || !directoriesActionMenuEl) return;

      if (!WS.root) {
        directoriesActionRowEl.style.display = "none";
        if (WS.view.bulkActionMenuOpen) {
          WS.view.bulkActionMenuOpen = false;
          WS.view.bulkActionMenuAnchorPath = "";
        }
        directoriesActionMenuEl.classList.remove("open");
        directoriesActionMenuEl.innerHTML = "";
        return;
      }

      const canBulk = canUseBulkSelection();
      if (!canBulk && WS.view.bulkSelectMode) {
        WS.view.bulkSelectMode = false;
        clearBulkTagSelection();
      }

      const selectedDirs = canBulk ? getSelectedPathsInCurrentDir() : [];
      const selectedFiles = canBulk ? getSelectedFileIdsInCurrentView() : [];
      const selCount = selectedDirs.length + selectedFiles.length;
      const hasDirSelection = selectedDirs.length > 0;
      if (!selCount) {
        WS.view.bulkActionMenuOpen = false;
        WS.view.bulkActionMenuAnchorPath = "";
      }

      const rowVisible = canBulk && (WS.view.bulkSelectMode || WS.view.bulkActionMenuOpen);
      directoriesActionRowEl.style.display = rowVisible ? "flex" : "none";

      if (directoriesSelectAllBtn) {
        const visibleFiles = canBulk ? Array.from(getVisibleFileIdsInEntries()) : [];
        const allSelected = visibleFiles.length > 0 && selectedFiles.length === visibleFiles.length;
        directoriesSelectAllBtn.style.display = WS.view.bulkSelectMode && visibleFiles.length ? "inline-flex" : "none";
        directoriesSelectAllBtn.disabled = !WS.view.bulkSelectMode || !visibleFiles.length || allSelected;
      }

      const menuOpen = WS.view.bulkActionMenuOpen && canBulk && hasDirSelection;
      directoriesActionMenuEl.classList.toggle("open", menuOpen);
      directoriesActionMenuEl.innerHTML = "";

      if (!menuOpen) return;

      const allFavorite = selectedDirs.every(p => metaHasFavorite(p));
      const allHidden = selectedDirs.every(p => metaHasHidden(p));

      const makeActionBtn = (label, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onClick();
        });
        return btn;
      };

      const scoreRow = document.createElement("div");
      scoreRow.className = "scoreRow";
      const scoreUpBtn = makeActionBtn("+", () => {
        WS.view.bulkActionMenuOpen = false;
        metaBumpScoreBulk(selectedDirs, 1);
        finalizeBulkSelectionAction();
      });
      scoreUpBtn.classList.add("scoreBtn");
      const scoreDownBtn = makeActionBtn("-", () => {
        WS.view.bulkActionMenuOpen = false;
        metaBumpScoreBulk(selectedDirs, -1);
        finalizeBulkSelectionAction();
      });
      scoreDownBtn.classList.add("scoreBtn");
      scoreRow.appendChild(scoreUpBtn);
      scoreRow.appendChild(scoreDownBtn);
      directoriesActionMenuEl.appendChild(scoreRow);

      directoriesActionMenuEl.appendChild(makeActionBtn("Tag selected", () => {
        WS.view.bulkActionMenuOpen = false;
        if (!selectedDirs.length) return;
        finalizeBulkSelectionAction();
        startBulkTagging(selectedDirs);
      }));

      directoriesActionMenuEl.appendChild(makeActionBtn(allFavorite ? "Unfavorite selected" : "Favorite selected", () => {
        WS.view.bulkActionMenuOpen = false;
        metaSetFavoriteBulk(selectedDirs, !allFavorite);
        finalizeBulkSelectionAction();
      }));

      directoriesActionMenuEl.appendChild(makeActionBtn(allHidden ? "Unhide selected" : "Hide selected", () => {
        WS.view.bulkActionMenuOpen = false;
        metaSetHiddenBulk(selectedDirs, !allHidden);
        finalizeBulkSelectionAction();
      }));

      const anchorBtn = findDirMenuButtonForPath(WS.view.bulkActionMenuAnchorPath);
      if (anchorBtn) {
        requestAnimationFrame(() => positionDropdownMenu(anchorBtn, directoriesActionMenuEl));
      }
    }

    function findDirMenuButtonForPath(path) {
      if (!directoriesListEl) return null;
      const rows = directoriesListEl.querySelectorAll(".dirRow");
      let fallback = null;
      for (const row of rows) {
        const btn = row.querySelector(".dirMenuBtn");
        if (btn && !fallback) fallback = btn;
        if (path && row.dataset && row.dataset.dirPath === path) {
          return btn;
        }
      }
      return fallback;
    }

    function setDirectoriesHeaderActive(active) {
      if (!directoriesHeader) return;
      directoriesHeader.classList.toggle("active", !!active);
    }

    function renderDirectoriesBulkHeader() {
      if (!directoriesBulkRowEl) return;
      directoriesBulkRowEl.style.display = "none";
      directoriesBulkRowEl.innerHTML = "";
    }

    function renderDirectoriesPane(keepScroll = false) {
      const prevScroll = keepScroll ? directoriesListEl.scrollTop : 0;
      directoriesListEl.innerHTML = "";
      updateTitleLabel();
      const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
      setDirectoriesHeaderActive(!!WS.root);

      renderDirectoriesTagsHeader();
      renderDirectoriesBulkHeader();

      if (!WS.root) {
        renderDirectoriesActionHeader();
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">Load a folder to begin.</div>`;
        return;
      }


      if (!WS.nav.entries.length) {
        let emptyMsg = "Empty directory.";
        if (isViewingTagFolder()) {
          if (WS.view.tagFolderActiveMode === "favorites") emptyMsg = "No favorite folders.";
          else if (WS.view.tagFolderActiveMode === "hidden") emptyMsg = "No hidden folders.";
          else {
            const tagLabel = String(WS.view.tagFolderActiveTag || "");
            emptyMsg = tagLabel ? `No folders tagged '${tagLabel}'.` : "No tagged folders.";
          }
        }
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">${escapeHtml(emptyMsg)}</div>`;
        renderDirectoriesActionHeader();
        return;
      }

      let maxMetaLen = 10;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "dir") {
          const m = `${dirItemCount(entry.node)} items`;
          if (m.length > maxMetaLen) maxMetaLen = m.length;
        }
      }
      try { directoriesListEl.style.setProperty("--dirMetaCh", String(maxMetaLen)); } catch {}

      const frag = document.createDocumentFragment();
      WS.nav.entries.forEach((entry, idx) => {
        const row = document.createElement("div");
        row.className = "dirRow" + (idx === WS.nav.selectedIndex ? " selected" : "");
        row.tabIndex = -1;

        const isTagEntry = entry.kind === "tag";
        if (isTagEntry) {
          row.classList.add("tagEntry");
        }

        const renameActive = isTagEntry && !entry.special && TAG_ENTRY_RENAME_STATE && (
          (entry.placeholder && TAG_ENTRY_RENAME_STATE.placeholder) ||
          (entry.tag && entry.tag === TAG_ENTRY_RENAME_STATE.tag)
        );
        if (isTagEntry) {
          const label = String(entry.label || entry.tag || "Tag");
          const countText = entry.count ? `${entry.count} folders` : "Tag folder";
          if (renameActive) {
            const initialValue = TAG_ENTRY_RENAME_STATE.label || label;
            row.innerHTML = `
              <div class="dirIcon">🏷</div>
              <div class="dirName"><input class="tagEditInput tagEntryRenameInput renameEditInput" type="text" value="${escapeHtml(initialValue)}" placeholder="${escapeHtml(label)}" /></div>
              <div class="dirMeta">${escapeHtml(countText)}</div>
            `;
          } else {
            row.innerHTML = `
              <div class="dirIcon">🏷</div>
              <div class="dirName" title="${escapeHtml(label)}">${escapeHtml(label)}</div>
              <div class="dirMeta">${escapeHtml(countText)}</div>
            `;
          }
        } else {
          let icon = "📁";
          let name = "";
          let meta = "";
          let voteHtml = "";
          let rightHtml = "";
          let fileMenuHtml = "";

          if (entry.kind === "dir") {
            row.dataset.dirPath = entry.node?.path || "";
            const p = entry.node?.path || "";
            const isFavorite = metaHasFavorite(p);
            const isHidden = metaHasHidden(p);
            const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
            const canRename = !!WS.meta.fsRootHandle;
            const canBatchIndex = !!WS.meta.fsRootHandle;
            icon = canBulk ? (sel ? "☑" : "☐") : (isHidden ? "🙈" : (isFavorite ? "♥" : "📁"));
            name = displayName(entry.node?.name || "folder") || "folder";
            meta = `${dirItemCount(entry.node)} items`;
            const sc = metaGetScore(p);
            const scoreMode = folderScoreDisplayMode();
            if (scoreMode !== "hidden") {
              const arrows = scoreMode === "show";
              voteHtml = `
          <div class="voteBox" data-path="${escapeHtml(p)}">
            ${arrows ? `<div class="voteBtn up">▲</div>` : ""}
            <div class="voteScore">${sc}</div>
            ${arrows ? `<div class="voteBtn down">▼</div>` : ""}
          </div>
          `;
            }
            const menuOpen = WS.view.dirActionMenuPath === p;
            // Folder menu (three dot / ⋯) for single-folder actions.
            const menuHtml = `
              <div class="dirMenu">
              <button class="dirMenuBtn" title="Folder menu">⋯</button>
              <div class="dropdownMenu${menuOpen ? " open" : ""}">
                <div class="scoreRow">
                  <button type="button" class="scoreBtn" data-action="score-up">+</button>
                  <button type="button" class="scoreBtn" data-action="score-down">-</button>
                </div>
                <button type="button" data-action="tag">Tag</button>
                <button type="button" data-action="rename"${canRename ? "" : " disabled"}>Rename</button>
                <button type="button" data-action="batch-index-1"${canBatchIndex ? "" : " disabled"}>Batch Index I</button>
                <button type="button" data-action="batch-index-2"${canBatchIndex ? "" : " disabled"}>Batch Index II</button>
                <button type="button" data-action="favorite">${isFavorite ? "Unfavorite" : "Favorite"}</button>
                <button type="button" data-action="hidden">${isHidden ? "Unhide" : "Hide"}</button>
              </div>
            </div>
            `;
            rightHtml = `<div class="dirRight"><div class="dirMeta">${escapeHtml(meta)}</div>${menuHtml}</div>`;
          } else {
            const rec = WS.fileById.get(entry.id);
            const isVid = rec?.type === "video";
            const sel = canBulk && WS.view.bulkFileSelectedIds.has(String(entry.id || ""));
            icon = canBulk ? (sel ? "☑" : "☐") : (isVid ? "🎞" : "🖼");
            name = fileDisplayName(rec?.name || "file") || "file";
            meta = isVid ? "video" : "image";
            const fileMenuOpen = WS.view.fileActionMenuId === String(entry.id || "");
            // File menu (three dot / ⋯) for single-file actions.
            fileMenuHtml = `
              <div class="dirMenu">
              <button class="dirMenuBtn" title="File menu">⋯</button>
              <div class="dropdownMenu${fileMenuOpen ? " open" : ""}">
                <button type="button" data-action="rename-file">Rename</button>
              </div>
            </div>
            `;
          }

          if (entry.kind === "dir" && (entry.node?.path || "") === (RENAME_EDIT_PATH || "")) {
            const curName = String(entry.node?.name || "");
            if (voteHtml) {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="folder name" /></div>
                ${voteHtml}
                ${rightHtml}
              `;
            } else {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="folder name" /></div>
                ${rightHtml}
              `;
            }
          } else if (entry.kind === "dir" && (entry.node?.path || "") === (TAG_EDIT_PATH || "")) {
            const p = entry.node?.path || "";
            const curTags = metaGetUserTags(p).join(", ");
            if (voteHtml) {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput" type="text" value="${escapeHtml(curTags)}" placeholder="tag1, tag2" /></div>
                ${voteHtml}
                ${rightHtml}
              `;
            } else {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName"><input class="tagEditInput" type="text" value="${escapeHtml(curTags)}" placeholder="tag1, tag2" /></div>
                ${rightHtml}
              `;
            }
          } else {
            if (entry.kind === "dir") {
              if (voteHtml) {
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                  ${voteHtml}
                  ${rightHtml}
                `;
              } else {
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                  ${rightHtml}
                `;
              }
            } else {
              if (String(entry.id || "") === String(RENAME_EDIT_FILE_ID || "")) {
                const rec = WS.fileById.get(entry.id);
                const curName = String(rec?.name || "");
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName"><input class="tagEditInput renameEditInput" type="text" value="${escapeHtml(curName)}" placeholder="file name" /></div>
                  <div class="dirMeta">${escapeHtml(meta)}</div>
                  ${fileMenuHtml}
                `;
              } else {
                row.innerHTML = `
                  <div class="dirIcon">${icon}</div>
                  <div class="dirName" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
                  <div class="dirMeta">${escapeHtml(meta)}</div>
                  ${fileMenuHtml}
                `;
              }
            }
          }
        }

        if (isTagEntry && !entry.special && entry.tag) {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const dirs = getDirsForTagEntry(entry);
            const paths = gatherTagPathsForDirs(dirs);
            openTagContextMenu({
              tag: String(entry.tag || ""),
              label: String(entry.label || entry.tag || ""),
              anchor: row,
              paths
            });
          });
        }

        if (isTagEntry && renameActive) {
          const renameInput = row.querySelector(".tagEntryRenameInput");
          if (renameInput) {
            renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
            renameInput.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                cancelTagEntryRename();
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitTagEntryRename(renameInput);
              }
            });
            renameInput.addEventListener("blur", () => {
              commitTagEntryRename(renameInput);
            });
          }
        }

        row.addEventListener("click", (e) => {
          closeActionMenus();
          if (e.shiftKey) {
            const anchor = WS.view.dirSelectAnchorIndex >= 0 ? WS.view.dirSelectAnchorIndex : idx;
            selectEntryRange(anchor, idx);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx);
            return;
          }
          if (e.ctrlKey || e.metaKey) {
            WS.view.bulkSelectMode = true;
            toggleEntrySelection(entry);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx);
            return;
          }

          if (WS.view.bulkSelectMode && (WS.view.bulkTagSelectedPaths.size || WS.view.bulkFileSelectedIds.size)) {
            clearBulkTagSelection();
            WS.view.bulkSelectMode = false;
          }
          WS.view.dirSelectAnchorIndex = idx;
          setDirectoriesSelection(idx);
        });

        if (entry.kind === "dir") {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openDirMenuForPath(entry.node?.path || "");
          });
        } else if (entry.kind === "file") {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            openFileMenuForId(entry.id);
          });
        }

        if (entry.kind === "dir") {
          const p = entry.node?.path || "";

          const iconEl = row.querySelector(".dirIcon");
          if (iconEl) {
            const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
            const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
            if (canBulk) {
              iconEl.classList.add("dirCheckbox");
              iconEl.title = sel ? "Deselect folder" : "Select folder";
              iconEl.style.cursor = "pointer";
              iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!p) return;
                if (WS.view.bulkTagSelectedPaths.has(p)) WS.view.bulkTagSelectedPaths.delete(p);
                else WS.view.bulkTagSelectedPaths.add(p);
                renderDirectoriesPane(true);
              });
            } else {
              iconEl.style.cursor = "default";
            }
          }

          const up = row.querySelector(".voteBtn.up");
          const down = row.querySelector(".voteBtn.down");
          if (up) up.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(entry.node?.path || "", 1); });
          if (down) down.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(entry.node?.path || "", -1); });

          const menuBtn = row.querySelector(".dirMenuBtn");
          if (menuBtn) {
            menuBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (openBulkActionMenuForSelection(p)) return;
              if (WS.view.dirActionMenuPath === p) {
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              openDirMenuForPath(p);
            });
          }

          const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
          if (menuDropdown) {
            menuDropdown.addEventListener("click", (e) => e.stopPropagation());
            const actionButtons = Array.from(menuDropdown.querySelectorAll("button[data-action]"));
            actionButtons.forEach((btn) => {
              btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                WS.view.dirActionMenuPath = "";
                if (action === "tag") {
                  TAG_EDIT_PATH = p;
                  RENAME_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .tagEditInput") || row.querySelector(".tagEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
                if (action === "rename") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Rename requires a writable folder.");
                    return;
                  }
                  RENAME_EDIT_PATH = p;
                  TAG_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput") || row.querySelector(".renameEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
                if (action === "batch-index-1") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Renaming files requires a writable folder.");
                    return;
                  }
                  batchIndexFolderFiles(entry.node);
                  return;
                }
                if (action === "batch-index-2") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Renaming files requires a writable folder.");
                    return;
                  }
                  batchIndexChildFolderFiles(entry.node);
                  return;
                }
                if (action === "favorite") {
                  metaToggleFavorite(p);
                  return;
                }
                if (action === "hidden") {
                  metaToggleHidden(p);
                  return;
                }
                if (action === "score-up") {
                  metaBumpScore(p, 1);
                  return;
                }
                if (action === "score-down") {
                  metaBumpScore(p, -1);
                  return;
                }
              });
            });
            if (menuDropdown.classList.contains("open")) {
              requestAnimationFrame(() => positionDropdownMenu(menuBtn, menuDropdown));
            }
          }

          const renameInput = row.querySelector(".renameEditInput");
          if (renameInput) {
            renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
            renameInput.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                RENAME_EDIT_PATH = null;
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitRenameEdit(p, renameInput);
                return;
              }
            });
            renameInput.addEventListener("blur", () => {
              commitRenameEdit(p, renameInput);
            });
          }

          const input = row.querySelector(".tagEditInput:not(.renameEditInput)");
          if (input) {
            input.addEventListener("click", (e) => { e.stopPropagation(); });
            input.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                TAG_EDIT_PATH = null;
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                const tags = normalizeTagsFromText(input.value || "");
                metaSetUserTags(p, tags);
                return;
              }
            });
            input.addEventListener("blur", () => {
              const tags = normalizeTagsFromText(input.value || "");
              metaSetUserTags(p, tags);
            });
          }
        } else if (entry.kind === "file") {
          const iconEl = row.querySelector(".dirIcon");
          if (iconEl) {
            const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
            const id = String(entry.id || "");
            const sel = canBulk && WS.view.bulkFileSelectedIds.has(id);
            if (canBulk) {
              iconEl.classList.add("dirCheckbox");
              iconEl.title = sel ? "Deselect file" : "Select file";
              iconEl.style.cursor = "pointer";
              iconEl.addEventListener("click", (e) => {
                e.stopPropagation();
                if (!id) return;
                if (WS.view.bulkFileSelectedIds.has(id)) WS.view.bulkFileSelectedIds.delete(id);
                else WS.view.bulkFileSelectedIds.add(id);
                renderDirectoriesPane(true);
              });
            } else {
              iconEl.style.cursor = "default";
            }
          }

          const menuBtn = row.querySelector(".dirMenuBtn");
          if (menuBtn) {
            menuBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              WS.view.bulkActionMenuOpen = false;
              WS.view.dirActionMenuPath = "";
              const id = String(entry.id || "");
              WS.view.fileActionMenuId = (WS.view.fileActionMenuId === id) ? "" : id;
              renderDirectoriesPane(true);
            });
          }

          const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
          if (menuDropdown) {
            menuDropdown.addEventListener("click", (e) => e.stopPropagation());
            const actionButtons = Array.from(menuDropdown.querySelectorAll("button[data-action]"));
            actionButtons.forEach((btn) => {
              btn.addEventListener("click", (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                WS.view.fileActionMenuId = "";
                if (action === "rename-file") {
                  if (!WS.meta.fsRootHandle) {
                    showStatusMessage("Renaming files requires a writable folder.");
                    return;
                  }
                  RENAME_EDIT_FILE_ID = String(entry.id || "");
                  RENAME_EDIT_PATH = null;
                  TAG_EDIT_PATH = null;
                  renderDirectoriesPane(true);
                  setTimeout(() => {
                    const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput") || row.querySelector(".renameEditInput");
                    if (input) {
                      try { input.focus(); input.select(); } catch {}
                    }
                  }, 0);
                  return;
                }
              });
            });
            if (menuDropdown.classList.contains("open")) {
              requestAnimationFrame(() => positionDropdownMenu(menuBtn, menuDropdown));
            }
          }

          const renameInput = row.querySelector(".renameEditInput");
          if (renameInput) {
            renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
            renameInput.addEventListener("keydown", (e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                RENAME_EDIT_FILE_ID = null;
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                commitFileRenameEdit(entry.id, renameInput);
                return;
              }
            });
            renameInput.addEventListener("blur", () => {
              commitFileRenameEdit(entry.id, renameInput);
            });
          }
        }

        frag.appendChild(row);
      });

      directoriesListEl.appendChild(frag);
      renderDirectoriesActionHeader();

      const shouldCenter = WS.view.pendingDirScroll === "center-selected";
      if (shouldCenter) WS.view.pendingDirScroll = "";

      if (keepScroll && !shouldCenter) {
        directoriesListEl.scrollTop = prevScroll;
        if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
        return;
      }

      const selected = directoriesListEl.querySelector(".dirRow.selected");
      if (selected && shouldCenter) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const selectedRow = directoriesListEl.querySelector(".dirRow.selected");
            if (!selectedRow) return;
            const target = selectedRow.offsetTop - (directoriesListEl.clientHeight / 2) + (selectedRow.offsetHeight / 2);
            const maxScroll = Math.max(0, directoriesListEl.scrollHeight - directoriesListEl.clientHeight);
            WS.view.scrollBusyDirs = true;
            directoriesListEl.scrollTop = Math.max(0, Math.min(maxScroll, target));
            requestAnimationFrame(() => { WS.view.scrollBusyDirs = false; });
          });
        });
      } else if (selected) {
        const r = selected.getBoundingClientRect();
        const c = directoriesListEl.getBoundingClientRect();
        if (r.top < c.top || r.bottom > c.bottom) selected.scrollIntoView({ block: "nearest" });
      }
      if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
    }

    directoriesListEl.addEventListener("scroll", () => {
      if (WS.view.folderBehavior !== "loop") return;
      if (!WS.root || !WS.nav.dirNode) return;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;
      if (WS.view.scrollBusyDirs) return;

      const el = directoriesListEl;
      const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
      if (!near) return;

      const baseCount = getOrderedFileIdsForDir(WS.nav.dirNode).length;
      if (!baseCount) return;

      if (WS.view.dirLoopRepeats >= WS.view.loopMaxRepeats) return;

      WS.view.scrollBusyDirs = true;
      WS.view.dirLoopRepeats = Math.min(WS.view.loopMaxRepeats, WS.view.dirLoopRepeats + 2);

      const saved = el.scrollTop;
      rebuildDirectoriesEntries();
      renderDirectoriesPane(true);
      el.scrollTop = saved;

      WS.view.scrollBusyDirs = false;
    });

    if (favoritesBtn) {
      favoritesBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (WS.view.hiddenMode) toggleHiddenMode();
        toggleFavoritesMode();
      });
    }

    if (hiddenBtn) {
      hiddenBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (WS.view.favoritesMode) toggleFavoritesMode();
        toggleHiddenMode();
      });
    }

    if (directoriesSelectAllBtn) {
      directoriesSelectAllBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canUseBulkSelection()) return;
        if (!WS.view.bulkSelectMode) return;
        const visible = Array.from(getVisibleFileIdsInEntries());
        if (!visible.length) return;
        if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear) WS.view.bulkFileSelectedIds.clear();
        for (let i = 0; i < visible.length; i++) WS.view.bulkFileSelectedIds.add(String(visible[i] || ""));
        renderDirectoriesPane(true);
      });
    }

    if (dirBackBtn) {
      dirBackBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goDirHistory(-1);
      });
    }

    if (dirForwardBtn) {
      dirForwardBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goDirHistory(1);
      });
    }

    if (dirUpBtn) {
      dirUpBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        goDirUp();
      });
    }

    function exitBulkSelectModeIfNeeded(target) {
      if (!WS.view.bulkSelectMode) return false;
      if (!target || !target.closest) {
        exitBulkSelectMode();
        return true;
      }
      if (target.closest(".dirRow")) return false;
      if (target.closest(".dirMenu")) return false;
      if (target.closest(".dropdownMenu")) return false;
      if (target.closest("#directoriesActionRow")) return false;
      if (target.closest("#directoriesBulkRow")) return false;
      if (target.closest("#directoriesSearchRow")) return false;
      if (target.closest("#directoriesTagsRow")) return false;
      exitBulkSelectMode();
      return true;
    }

    function exitBulkSelectMode() {
      if (!WS.view.bulkSelectMode) return false;
      WS.view.bulkSelectMode = false;
      clearBulkTagSelection();
      renderDirectoriesPane(true);
      return true;
    }

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (TAG_CONTEXT_MENU_STATE) {
        if (target && target.closest && target.closest("#tagActionMenu")) {
          return;
        }
        closeTagContextMenu();
      }
      if (exitBulkSelectModeIfNeeded(target)) return;
      if (!WS.view.bulkActionMenuOpen && !WS.view.dirActionMenuPath && !WS.view.fileActionMenuId) return;
      if (target && target.closest) {
        if (target.closest(".dirMenu")) return;
        if (target.closest("#directoriesActionRow")) return;
      }
      closeActionMenus();
      renderDirectoriesPane(true);
    });

    if (directoriesSearchInput) {
      directoriesSearchInput.addEventListener("click", (e) => { e.stopPropagation(); });
      const startDirectorySearch = () => {
        if (!WS.root) return;
        const q = String(WS.view.dirSearchQuery || "").trim();
        if (!q) return;

        const keepRoot = WS.view.dirSearchPinned && WS.view.searchRootActive;
        if (!keepRoot) {
          if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
            WS.view.searchRootIsFavorites = true;
            WS.view.searchRootFavorites = getAllFavoriteDirs();
            WS.view.searchRootIsHidden = false;
            WS.view.searchRootHidden = [];
            WS.view.searchRootPath = "";
          } else if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
            WS.view.searchRootIsFavorites = false;
            WS.view.searchRootFavorites = [];
            WS.view.searchRootIsHidden = true;
            WS.view.searchRootHidden = getAllHiddenDirs();
            WS.view.searchRootPath = "";
          } else {
            WS.view.searchRootIsFavorites = false;
            WS.view.searchRootFavorites = [];
            WS.view.searchRootIsHidden = false;
            WS.view.searchRootHidden = [];
            WS.view.searchRootPath = String(WS.nav.dirNode?.path || "");
          }
        }

        WS.view.dirSearchPinned = true;
        WS.view.searchRootActive = true;
        WS.view.searchAnchorPath = "";
        WS.view.searchEntryRootPath = "";
        computeDirectorySearchResults();

        if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = false;

        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();

        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      };

      directoriesSearchInput.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          startDirectorySearch();
          try { directoriesSearchInput.blur(); } catch {}
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          cancelDirectorySearch();
          directoriesSearchInput.value = "";
          if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = true;

          TAG_EDIT_PATH = null;
          clearBulkTagPlaceholder();
          syncBulkSelectionForCurrentDir();

          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      });
      directoriesSearchInput.addEventListener("input", () => {
        const val = directoriesSearchInput.value || "";
        WS.view.dirSearchQuery = val;
        if (directoriesSearchClearBtn) {
          const enabled = !!(WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim());
          directoriesSearchClearBtn.disabled = !enabled;
        }
      });
    }

    if (directoriesSearchClearBtn) {
      directoriesSearchClearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        cancelDirectorySearch();
        if (directoriesSearchInput) directoriesSearchInput.value = "";
        directoriesSearchClearBtn.disabled = true;

        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();

        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      });
    }

    function firstFileEntryIndexForDirEntries() {
      for (let i = 0; i < WS.nav.entries.length; i++) if (WS.nav.entries[i]?.kind === "file") return i;
      return -1;
    }

    function lastFileEntryIndexForDirEntries() {
      for (let i = WS.nav.entries.length - 1; i >= 0; i--) if (WS.nav.entries[i]?.kind === "file") return i;
      return -1;
    }

    function slideStepFileInternal(step) {
      if (!WS.root || !WS.nav.dirNode) return { moved: false, dirChanged: false };
      if (WS.view.folderBehavior !== "slide") return { moved: false, dirChanged: false };
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return { moved: false, dirChanged: false };
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return { moved: false, dirChanged: false };
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return { moved: false, dirChanged: false };

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry || entry.kind !== "file") return { moved: false, dirChanged: false };

      const fileIdxs = [];
      for (let i = 0; i < WS.nav.entries.length; i++) if (WS.nav.entries[i]?.kind === "file") fileIdxs.push(i);
      if (!fileIdxs.length) return { moved: false, dirChanged: false };

      const pos = fileIdxs.indexOf(WS.nav.selectedIndex);
      if (pos === -1) return { moved: false, dirChanged: false };

      const nextPos = pos + step;
      if (nextPos >= 0 && nextPos < fileIdxs.length) {
        WS.nav.selectedIndex = fileIdxs[nextPos];
        syncPreviewToSelection();
        return { moved: true, dirChanged: false };
      }

      if (step > 0) {
        const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
        if (!nextDir) return { moved: false, dirChanged: false };
        WS.nav.dirNode = nextDir;
        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        const idx = firstFileEntryIndexForDirEntries();
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        return { moved: true, dirChanged: true };
      } else {
        const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
        if (!prevDir) return { moved: false, dirChanged: false };
        WS.nav.dirNode = prevDir;
        TAG_EDIT_PATH = null;
        clearBulkTagPlaceholder();
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        const idx = lastFileEntryIndexForDirEntries();
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        return { moved: true, dirChanged: true };
      }
    }

    function slideMoveFiles(delta) {
      const step = delta > 0 ? 1 : -1;
      let remaining = Math.abs(delta);
      let moved = false;
      let dirChanged = false;

      while (remaining > 0) {
        const r = slideStepFileInternal(step);
        if (!r.moved) break;
        moved = true;
        if (r.dirChanged) dirChanged = true;
        remaining--;
      }

      if (!moved) return;

      renderDirectoriesPane();
      renderPreviewPane(dirChanged);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function jumpToNextFolderFirstFile() {
      if (!WS.root || !WS.nav.dirNode) return;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;

      const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
      if (!nextDir) return;

      WS.nav.dirNode = nextDir;
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      const idx = firstFileEntryIndexForDirEntries();
      if (idx >= 0) WS.nav.selectedIndex = idx;
      else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);

      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function jumpToPrevFolderFirstFile() {
      if (!WS.root || !WS.nav.dirNode) return;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return;

      const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
      if (!prevDir) return;

      WS.nav.dirNode = prevDir;
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      const idx = firstFileEntryIndexForDirEntries();
      if (idx >= 0) WS.nav.selectedIndex = idx;
      else WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);

      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    /* =========================================================
       Preview Pane
       - inline breadcrumb + counts
       - folder preview shows folder contents
       - file preview shows large in-pane preview (video autoplay)
       ========================================================= */

    function navigateToDirectory(node) {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      if (!node) return;

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        WS.view.searchRootActive = false;
        WS.view.searchAnchorPath = node.path || "";
        WS.view.searchEntryRootPath = node.path || "";
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        WS.view.favoritesRootActive = false;
        WS.view.favoritesAnchorPath = node.path || "";
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        WS.view.hiddenRootActive = false;
        WS.view.hiddenAnchorPath = node.path || "";
      }

      WS.nav.dirNode = node;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function getPreviewTargetDir() {
      if (WS.preview.kind === "dir" && WS.preview.dirNode) return WS.preview.dirNode;
      if (WS.preview.kind === "file" && WS.preview.fileId) {
        const rec = WS.fileById.get(WS.preview.fileId);
        const p = rec ? (rec.dirPath || "") : "";
        return WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;
      }
      return WS.nav.dirNode || WS.root;
    }

    function getDirectoryItemCount(dirNode) {
      if (!dirNode) return 0;
      const dirs = getChildDirsForNode(dirNode);
      const files = getOrderedFileIdsForDir(dirNode);
      return dirs.length + files.length;
    }

    function getBreadcrumbNodesForDir(dirNode) {
      const nodes = [];
      let cur = dirNode;
      while (cur) { nodes.push(cur); cur = cur.parent; }
      nodes.reverse();
      return nodes;
    }

    function setPreviewBodyMode(mode) {
      if (!previewBodyEl) return;
      previewBodyEl.classList.toggle("preview-file", mode === "file");
      previewBodyEl.classList.toggle("preview-grid", mode !== "file");
    }

    function ensureThumbUrl(rec) {
      if (!rec) return null;
      if (rec.type !== "image") return rec.thumbUrl || null;

      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const mode = opt ? String(opt.imageThumbSize || "medium") : "medium";

      if (mode === "high") {
        if (rec.thumbUrl && rec.thumbMode === "high") return rec.thumbUrl;
        if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
          try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
          rec.thumbUrl = null;
        }
        rec.thumbMode = "high";
        try { rec.thumbUrl = URL.createObjectURL(rec.file); return rec.thumbUrl; } catch { return null; }
      }

      if (rec.thumbUrl && rec.thumbMode === mode) return rec.thumbUrl;

      if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
        try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
        rec.thumbUrl = null;
      }
      rec.thumbMode = null;

      enqueueImageThumb(rec);
      return ensureMediaUrl(rec) || null;
    }

    function ensureMediaUrl(rec) {
      if (!rec) return null;
      if (rec.url) return rec.url;
      try { rec.url = URL.createObjectURL(rec.file); return rec.url; } catch { return null; }
    }

    function preloadMediaRecord(rec, aggressive) {
      if (!rec) return;
      const url = ensureMediaUrl(rec);
      if (!url) return;
      if (PRELOAD_CACHE.has(url)) return;
      if (rec.type === "image") {
        const img = new Image();
        img.src = url;
        PRELOAD_CACHE.set(url, img);
        return;
      }
      const vid = document.createElement("video");
      vid.preload = aggressive ? "auto" : "metadata";
      vid.muted = true;
      vid.playsInline = true;
      vid.src = url;
      try { if (aggressive) vid.load(); } catch {}
      PRELOAD_CACHE.set(url, vid);
    }

    function preloadNextMedia(items, startIdx) {
      const mode = preloadMode();
      if (mode === "off") return;
      if (!Array.isArray(items) || !items.length) return;
      const aggressive = (mode === "ultra");
      const count = aggressive ? 3 : 1;
      let idx = startIdx;
      let found = 0;
      let guard = 0;
      while (found < count && guard < items.length * 2) {
        idx = (idx + 1) % items.length;
        const it = items[idx];
        if (it && !it.isFolder) {
          const rec = WS.fileById.get(it.id);
          if (rec) {
            preloadMediaRecord(rec, aggressive);
            found++;
          }
        }
        guard++;
      }
    }

    function ensurePreviewFileElements() {
      if (!previewViewportBox) {
        previewViewportBox = document.createElement("div");
        previewViewportBox.id = "filePreviewViewport";
      }
      if (!previewImgEl) {
        previewImgEl = document.createElement("img");
        previewImgEl.style.display = "none";
        previewImgEl.onload = () => {
          previewImgEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };
        previewViewportBox.appendChild(previewImgEl);
      }
      if (!previewVideoEl) {
        previewVideoEl = document.createElement("video");
        previewVideoEl.controls = true;
        previewVideoEl.preload = "metadata";
        previewVideoEl.playsInline = true;
        previewVideoEl.autoplay = true;
        previewVideoEl.muted = false;
        previewVideoEl.style.display = "none";
        previewViewportBox.appendChild(previewVideoEl);
      }
      if (!previewFolderEl) {
        previewFolderEl = document.createElement("div");
        previewFolderEl.style.display = "none";
        previewViewportBox.appendChild(previewFolderEl);
      }
    }

    function ensureViewerFromPreviewFileId(fileId) {
      if (!WS.root || !fileId) return;
      const rec = WS.fileById.get(fileId);
      if (!rec) return;

      const p = rec ? (rec.dirPath || "") : "";
      const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;

      viewerDirNode = dn;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      let idx = 0;
      const found = viewerItems.findIndex(it => !it.isFolder && it.id === fileId);
      if (found >= 0) idx = found;
      viewerIndex = idx;
    }

    function previewVideoMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.videoPreview || "muted") : "muted";
    }

    function galleryVideoMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.videoGallery || "muted") : "muted";
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

    function slideshowBehavior() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.slideshowDefault || "cycle") : "cycle";
    }

    function preloadMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.preloadNextMode || "off") : "off";
    }

    function previewDisplayMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return opt ? String(opt.previewMode || "grid") : "grid";
    }

    function renderPreviewViewerItem(idx) {
      ensurePreviewFileElements();

      if (!viewerItems.length) {
        if (previewImgEl) previewImgEl.style.display = "none";
        if (previewVideoEl) previewVideoEl.style.display = "none";
        if (previewFolderEl) previewFolderEl.style.display = "none";
        MediaFilterEngine.detach("preview");
        if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
        if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
        return;
      }

      const n = viewerItems.length;
      let i = idx;
      if (i < 0) i = 0;
      if (i >= n) i = n - 1;
      viewerIndex = i;

      const item = viewerItems[viewerIndex];

      let willShowVideo = false;
      let rec = null;
      if (item && !item.isFolder) {
        rec = WS.fileById.get(item.id);
        if (rec && rec.type === "video") willShowVideo = true;
      }

      if (previewVideoEl) {
        try { previewVideoEl.pause(); } catch {}
        previewVideoEl.classList.remove("ready");
        if (!willShowVideo) previewVideoEl.style.display = "none";
      }
      if (previewImgEl) {
        previewImgEl.classList.remove("ready");
        previewImgEl.style.display = "none";
      }
      if (previewFolderEl) previewFolderEl.style.display = "none";
      MediaFilterEngine.detach("preview");
      if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
      if (previewImgEl) previewImgEl.classList.remove("mediaHidden");

      if (!item) return;

      if (item.isFolder) {
        previewFolderEl.style.display = "flex";
        previewFolderEl.style.flexDirection = "column";
        previewFolderEl.style.alignItems = "center";
        previewFolderEl.style.justifyContent = "center";
        previewFolderEl.style.minWidth = "200px";
        previewFolderEl.style.maxWidth = "80%";
        previewFolderEl.style.padding = "24px 32px";
        previewFolderEl.style.borderRadius = "4px";
        previewFolderEl.style.background = "var(--color1-secondary)";
        previewFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";

        previewFolderEl.innerHTML = "";

        const icon = document.createElement("div");
        icon.style.fontSize = "56px";
        icon.style.marginBottom = "12px";
        icon.textContent = "📁";

        const name = document.createElement("div");
        name.style.fontSize = "14px";
        name.style.color = "var(--color0-primary)";
        name.style.textAlign = "center";
        name.style.whiteSpace = "nowrap";
        name.style.overflow = "hidden";
        name.style.textOverflow = "ellipsis";
        name.textContent = displayName(item.dirNode?.name || "Folder") || "Folder";

        previewFolderEl.appendChild(icon);
        previewFolderEl.appendChild(name);
        return;
      }

      if (!rec) return;

      if (rec.type === "video") {
        const mode = previewVideoMode();
        const doAuto = mode !== "off" && !BANIC_ACTIVE && !VIEWER_MODE;
        if (!VIEWER_MODE && viewerVideoEl) { try { viewerVideoEl.pause(); } catch {} }
        previewVideoEl.autoplay = doAuto;
        previewVideoEl.onloadeddata = null;
        previewVideoEl.onended = null;
        previewVideoEl.muted = (mode === "muted") || BANIC_ACTIVE || VIEWER_MODE;
        const endBehavior = videoEndBehavior();
        if (WS.view.slideshowActive) {
          previewVideoEl.loop = false;
          previewVideoEl.onended = () => { if (WS.view.slideshowActive) viewerStep(1); };
        } else if (endBehavior === "loop") {
          previewVideoEl.loop = true;
        } else if (endBehavior === "next") {
          previewVideoEl.loop = false;
          previewVideoEl.onended = () => { if (!WS.view.slideshowActive) viewerStep(1); };
        } else {
          previewVideoEl.loop = false;
        }
        previewVideoEl.onloadeddata = () => {
          previewVideoEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };

        const src = ensureMediaUrl(rec) || "";
        const same = previewVideoEl.src === src;
        if (!same) {
          previewVideoEl.src = src;
        }
        previewVideoEl.style.display = "block";
        syncMediaFilterSurface("preview", previewVideoEl, previewViewportBox, "video");

        applyVideoCarryToElement(previewVideoEl, rec.id);

        if (previewVideoEl.readyState >= 2) {
          requestAnimationFrame(() => { previewVideoEl.classList.add("ready"); });
        }
        if (doAuto) { try { previewVideoEl.play(); } catch {} }
        else { try { previewVideoEl.pause(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      previewImgEl.onload = () => {
        previewImgEl.classList.add("ready");
        MediaFilterEngine.requestRender();
      };
      const src = ensureMediaUrl(rec) || "";
      const same = previewImgEl.src === src;
      if (!same) previewImgEl.src = src;
      previewImgEl.style.display = "block";
      syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image");

      if (previewImgEl.complete && previewImgEl.naturalWidth > 0) {
        requestAnimationFrame(() => { previewImgEl.classList.add("ready"); });
      }
      preloadNextMedia(viewerItems, viewerIndex);
    }

    function syncDirectoriesToViewerState() {
      if (!WS.root) return;
      if (!viewerDirNode) return;
      if (!viewerItems.length) return;

      WS.nav.dirNode = viewerDirNode;
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      const item = viewerItems[viewerIndex] || null;

      let idx = 0;
      if (item) {
        if (item.isFolder) {
          for (let i = 0; i < WS.nav.entries.length; i++) {
            const e = WS.nav.entries[i];
            if (e && e.kind === "dir" && e.node === item.dirNode) { idx = i; break; }
          }
        } else {
          for (let i = 0; i < WS.nav.entries.length; i++) {
            const e = WS.nav.entries[i];
            if (e && e.kind === "file" && e.id === item.id) { idx = i; break; }
          }
        }
      }

      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();

      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function renderPreviewPane(animate = false, keepScroll = false) {
      const prevScroll = keepScroll ? previewBodyEl.scrollTop : 0;

      if (!WS.root || !WS.nav.dirNode) {
        previewBodyEl.innerHTML = "";
        setPreviewBodyMode("grid");
        updateModePill();
        if (itemsPill) itemsPill.textContent = "Items: —";
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">Load a folder to begin.</div>`;
        return;
      }

      const targetDir = getPreviewTargetDir();
      updateModePill();
      const currentDirCount = getDirectoryItemCount(WS.nav.dirNode || WS.root);
      if (itemsPill) itemsPill.textContent = `Items: ${currentDirCount}`;

      if (WS.preview.kind === "file" && WS.preview.fileId) {
        setPreviewBodyMode("file");
        const rec = WS.fileById.get(WS.preview.fileId);
        if (!rec) {
          previewBodyEl.innerHTML = "";
          previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">File not found.</div>`;
          MediaFilterEngine.detach("preview");
          if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
          if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
          return;
        }

        ensurePreviewFileElements();

        if (previewBodyEl.firstChild !== previewViewportBox || previewBodyEl.childNodes.length !== 1) {
          previewBodyEl.innerHTML = "";
          previewBodyEl.appendChild(previewViewportBox);
        }

        ensureViewerFromPreviewFileId(rec.id);
        if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "preview";
        renderPreviewViewerItem(viewerIndex);

        if (keepScroll) previewBodyEl.scrollTop = prevScroll;
        return;
      }

      setPreviewBodyMode("grid");
      if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
      MediaFilterEngine.detach("preview");
      if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
      if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");

      previewBodyEl.innerHTML = "";

      const dirNode = targetDir;
      if (!dirNode) {
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">No preview.</div>`;
        return;
      }

      if (previewDisplayMode() === "expanded") {
        renderExpandedPreviewPane(dirNode, animate, keepScroll, prevScroll);
        return;
      }

      renderFolderContents(dirNode, previewBodyEl, animate);

      if (animate) {
        requestAnimationFrame(() => {
          const cards = previewBodyEl.querySelectorAll(".fileCard.enter");
          cards.forEach(c => c.classList.remove("enter"));
        });
      }

      if (keepScroll) previewBodyEl.scrollTop = prevScroll;
    }

    previewBodyEl.addEventListener("scroll", () => {
      if (WS.view.folderBehavior !== "loop") return;
      if (!WS.root || !WS.nav.dirNode) return;
      if (WS.preview.kind === "file") return;
      if (WS.view.scrollBusyPreview) return;

      const dirNode = getPreviewTargetDir();
      if (!dirNode) return;

      const baseCount = getOrderedFileIdsForDir(dirNode).length;
      if (!baseCount) return;

      const el = previewBodyEl;
      const near = el.scrollTop + el.clientHeight >= el.scrollHeight - 120;
      if (!near) return;

      if (WS.view.previewLoopRepeats >= WS.view.loopMaxRepeats) return;

      WS.view.scrollBusyPreview = true;
      WS.view.previewLoopRepeats = Math.min(WS.view.loopMaxRepeats, WS.view.previewLoopRepeats + 2);

      const saved = el.scrollTop;
      renderPreviewPane(false, true);
      el.scrollTop = saved;

      WS.view.scrollBusyPreview = false;
    });


    function makeSpacer() {
      const sp = document.createElement("div");
      sp.className = "previewSectionSpacer";
      return sp;
    }

    function makeFolderPreviewCard(dirNode) {
      const card = document.createElement("div");
      card.className = "folderCard";
      card.style.cursor = "pointer";
      const icon = "📁";
      const nm = displayName(dirNode?.name || "folder") || "folder";
      const sc = metaGetScore(dirNode?.path || "");
      const scoreMode = folderScoreDisplayMode();
      const voteSeg = scoreMode !== "hidden" ? `
          <div class="voteBox">
            ${scoreMode === "show" ? `<div class="voteBtn up">▲</div>` : ""}
            <div class="voteScore">${sc}</div>
            ${scoreMode === "show" ? `<div class="voteBtn down">▼</div>` : ""}
          </div>
          ` : ``;
      card.innerHTML = `
        <div class="left">
          <div class="icon">${icon}</div>
          <div class="name" title="${escapeHtml(nm)}">${escapeHtml(nm)}</div>
        </div>
        <div class="folderRight">
          ${voteSeg}
          <div class="meta">${dirItemCount(dirNode)} items</div>
        </div>
      `;
      const up = card.querySelector(".voteBtn.up");
      const down = card.querySelector(".voteBtn.down");
      if (up) up.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(dirNode?.path || "", 1); });
      if (down) down.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(dirNode?.path || "", -1); });

      card.addEventListener("click", () => {
        navigateToDirectory(dirNode);
      });
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openDirMenuForPath(dirNode?.path || "");
      });
      return card;
    }

    function renderFilesGrid(ids, container, animate) {
      const LIMIT = 800;
      if (!ids.length) return 0;

      const grid = document.createElement("div");
      grid.className = "gridFiles";
      const frag = document.createDocumentFragment();

      let rendered = 0;
      for (let i = 0; i < ids.length && rendered < LIMIT; i++) {
        const id = ids[i];
        const rec = WS.fileById.get(id);
        if (!rec) continue;

        const card = makePreviewFileCard(rec, animate);
        frag.appendChild(card);
        rendered++;
      }

      grid.appendChild(frag);
      container.appendChild(grid);
      return rendered;
    }

    function renderFolderContents(dirNode, container, animate) {
      const folders = getChildDirsForNode(dirNode);
      let hasContent = false;

      if (folders.length) {
        const gridF = document.createElement("div");
        gridF.className = "gridFolders";
        const fragF = document.createDocumentFragment();

        for (const d of folders) {
          fragF.appendChild(makeFolderPreviewCard(d));
        }

        gridF.appendChild(fragF);
        container.appendChild(gridF);
        container.appendChild(makeSpacer());
        hasContent = true;
      }

      const ids = getOrderedFileIdsForDir(dirNode);
      if (ids.length) {
        renderFilesGrid(ids, container, animate);
        hasContent = true;
      }

      if (!hasContent) {
        const empty = document.createElement("div");
        empty.className = "label";
        empty.style.padding = "10px";
        empty.textContent = "Empty folder.";
        container.appendChild(empty);
      }

      return {
        folderCount: folders.length,
        fileCount: ids.length,
        hasContent
      };
    }

    function renderExpandedPreviewPane(dirNode, animate, keepScroll, prevScroll) {
      previewBodyEl.innerHTML = "";

      const baseDirs = getChildDirsForNode(dirNode);
      const baseFiles = getOrderedFileIdsForDir(dirNode);
      const targetPath = WS.preview.kind === "dir" && WS.preview.dirNode ? String(WS.preview.dirNode.path || "") : "";

      let hasAny = false;
      let scrollTarget = null;

      const makeSection = (title, metaText, path) => {
        const section = document.createElement("div");
        section.className = "expandedSection";
        if (path) section.dataset.path = path;

        const bar = document.createElement("div");
        bar.className = "expandedBar";

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = title;

        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = metaText;

        bar.appendChild(name);
        bar.appendChild(meta);
        section.appendChild(bar);
        return section;
      };

      if (baseFiles.length) {
        const section = makeSection("Files in this folder", `${baseFiles.length} files`, "");
        renderFilesGrid(baseFiles, section, animate);
        previewBodyEl.appendChild(section);
        hasAny = true;
      }

      for (const child of baseDirs) {
        const nm = displayName(child.name || "folder") || "folder";
        const childFolders = getChildDirsForNode(child).length;
        const childFiles = getOrderedFileIdsForDir(child).length;
        const total = childFolders + childFiles;
        const section = makeSection(nm, `${total} items`, child.path || "");
        renderFolderContents(child, section, animate);
        previewBodyEl.appendChild(section);
        hasAny = true;
        if (targetPath && String(child.path || "") === targetPath) scrollTarget = section;
      }

      if (!hasAny) {
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">Empty folder.</div>`;
        return;
      }

      if (animate) {
        requestAnimationFrame(() => {
          const cards = previewBodyEl.querySelectorAll(".fileCard.enter");
          cards.forEach(c => c.classList.remove("enter"));
        });
      }

      if (keepScroll) {
        previewBodyEl.scrollTop = prevScroll;
      } else if (scrollTarget) {
        previewBodyEl.scrollTop = scrollTarget.offsetTop;
      }
    }

    function makePreviewFileCard(rec, animate) {
      const card = document.createElement("div");
      card.className = "fileCard";
      card.style.cursor = "pointer";
      if (animate) card.classList.add("enter");

      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = "lazy";
      img.alt = fileDisplayName(rec.name || "") || "";

      if (rec.type === "image") {
        img.src = ensureThumbUrl(rec) || "";
      } else {
        img.src = rec.videoThumbUrl || "";
        if (!img.src) img.style.objectFit = "contain";
      }

      const meta = document.createElement("div");
      meta.className = "metaBlock";

      const top = document.createElement("div");
      top.className = "topLine";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = fileDisplayName(rec.name || "—") || "—";
      name.title = relPathDisplayName(rec.relPath || rec.name || "");

      top.appendChild(name);

      const mini = document.createElement("div");
      mini.className = "mini";
      mini.textContent = rec.type === "video" ? "video" : "image";

      meta.appendChild(top);
      meta.appendChild(mini);

      card.appendChild(img);
      card.appendChild(meta);

      card.addEventListener("click", () => {
        if (!WS.root) return;

        const p = rec.dirPath || "";
        const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;

        if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
          WS.view.searchRootActive = false;
          WS.view.searchAnchorPath = dn.path || "";
          WS.view.searchEntryRootPath = dn.path || "";
        }

        if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
          WS.view.favoritesRootActive = false;
          WS.view.favoritesAnchorPath = dn.path || "";
        }

        if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
          WS.view.hiddenRootActive = false;
          WS.view.hiddenAnchorPath = dn.path || "";
        }

        WS.nav.dirNode = dn;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();

        let idx = 0;
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e = WS.nav.entries[i];
          if (e && e.kind === "file" && e.id === rec.id) { idx = i; break; }
        }
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();

        renderDirectoriesPane(true);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      });

      return card;
    }

    /* =========================================================
       Video thumbnails (lazy, low quality) for Preview Pane
       ========================================================= */

    function enqueueVideoThumb(rec) {
      if (!rec) return;
      WS.videoThumbQueue.push(rec.id);
    }

    function getPreviewFileIdsForDir(dirNode, includeChildren = false) {
      if (!dirNode) return [];
      const ids = dirNode.childrenFiles.slice();
      if (!dirNode.preserveOrder) ids.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      const out = ids.filter(id => passesFilter(WS.fileById.get(id)));

      if (!includeChildren) return out;

      for (const child of getChildDirsForNode(dirNode)) {
        const childIds = getPreviewFileIdsForDir(child, false);
        for (const id of childIds) out.push(id);
      }

      return out;
    }

    function kickVideoThumbsForPreview() {
      const dirNode = getPreviewTargetDir();
      if (!dirNode) return;

      const includeChildren = previewDisplayMode() === "expanded" && WS.preview.kind !== "file";
      const ids = getPreviewFileIdsForDir(dirNode, includeChildren);
      for (const id of ids) {
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "video") continue;
        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;
        enqueueVideoThumb(rec);
      }
      drainVideoThumbQueue();
    }

    async function drainVideoThumbQueue() {
      if (WS.videoThumbActive >= 4) return;
      while (WS.videoThumbActive < 4 && WS.videoThumbQueue.length) {
        const id = WS.videoThumbQueue.shift();
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "video") continue;
        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;

        WS.videoThumbActive++;
        generateVideoThumb(rec).catch(() => {}).finally(() => {
          WS.videoThumbActive--;
          renderPreviewPane(false);
          drainVideoThumbQueue();
        });
      }
    }

    async function generateVideoThumb(rec) {
      const url = ensureMediaUrl(rec);
      if (!url) return;

      const mode = WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
      if (rec.videoThumbUrl) {
        try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
        rec.videoThumbUrl = null;
      }
      rec.videoThumbMode = mode;

      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      v.src = url;
      v.crossOrigin = "anonymous";

      await new Promise((resolve, reject) => {
        const onMeta = () => resolve();
        const onErr = () => reject(new Error("video load failed"));
        v.addEventListener("loadedmetadata", onMeta, { once: true });
        v.addEventListener("error", onErr, { once: true });
      });

      const t = Math.min(0.25, Math.max(0, (v.duration || 0) * 0.10));
      try { v.currentTime = isFinite(t) ? t : 0; } catch {}

      await new Promise((resolve) => {
        const done = () => resolve();
        v.addEventListener("seeked", done, { once: true });
        setTimeout(done, 350);
      });

      const w = videoThumbWidthForOption();
      const ar = (v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (4/3);
      const h = Math.max(120, Math.round(w / ar));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(v, 0, 0, w, h);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", mode === "high" ? 0.75 : 0.6));
      if (!blob) return;

      rec.videoThumbUrl = URL.createObjectURL(blob);
    }

    /* =========================================================
       Image thumbnails (lazy) for Preview Pane
       ========================================================= */

    function enqueueImageThumb(rec) {
      if (!rec) return;
      if (rec.type !== "image") return;
      WS.imageThumbQueue.push(rec.id);
      drainImageThumbQueue();
    }

    async function drainImageThumbQueue() {
      if (WS.imageThumbActive >= 4) return;
      while (WS.imageThumbActive < 4 && WS.imageThumbQueue.length) {
        const id = WS.imageThumbQueue.shift();
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "image") continue;

        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
        if (mode === "high") continue;
        if (rec.thumbUrl && rec.thumbMode === mode) continue;

        WS.imageThumbActive++;
        generateImageThumb(rec).catch(() => {}).finally(() => {
          WS.imageThumbActive--;
          renderPreviewPane(false);
          drainImageThumbQueue();
        });
      }
    }

    async function generateImageThumb(rec) {
      const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
      if (mode === "high") {
        rec.thumbMode = "high";
        return;
      }

      if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
        try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
        rec.thumbUrl = null;
      }

      const w = imageThumbWidthForOption();
      const file = rec.file;
      if (!file) return;

      let bmp = null;
      try { bmp = await createImageBitmap(file); } catch { bmp = null; }
      if (!bmp) return;

      const ar = (bmp.width && bmp.height) ? (bmp.width / bmp.height) : (4/3);
      const h = Math.max(120, Math.round(w / ar));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0, w, h);

      try { bmp.close(); } catch {}

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", mode === "high" ? 0.85 : (mode === "medium" ? 0.75 : 0.65)));
      if (!blob) return;

      rec.thumbUrl = URL.createObjectURL(blob);
      rec.thumbMode = mode;
    }

    function kickImageThumbsForPreview() {
      const dirNode = getPreviewTargetDir();
      if (!dirNode) return;

      const ids = getPreviewFileIdsForDir(dirNode);
      for (const id of ids) {
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "image") continue;
        const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
        if (mode === "high") continue;
        if (rec.thumbUrl && rec.thumbMode === mode) continue;
        enqueueImageThumb(rec);
      }
    }

    /* =========================================================
       Gallery Mode (Overlay)
       - Rotated control model:
         Up/Down = previous/next item
         Left/Right = leave/enter directory
       - Nav buttons now represent Left/Right directory actions
       ========================================================= */

    function buildViewerItemsForDir(dirNode) {
      const items = [];
      if (!dirNode) return items;

      const dirs = getChildDirsForNode(dirNode);
      for (const d of dirs) items.push({ isFolder: true, dirNode: d });

      const ids = getOrderedFileIdsForDir(dirNode);
      for (const id of ids) items.push({ isFolder: false, id });

      return items;
    }

    function pausePreviewVideoForOverlay() {
      PREVIEW_VIDEO_PAUSE.active = false;
      PREVIEW_VIDEO_PAUSE.fileId = null;
      PREVIEW_VIDEO_PAUSE.time = 0;
      PREVIEW_VIDEO_PAUSE.wasPlaying = false;

      if (WS.preview.kind !== "file" || !WS.preview.fileId) return;
      const rec = WS.fileById.get(WS.preview.fileId);
      if (!rec || rec.type !== "video") return;
      if (!previewVideoEl || previewVideoEl.style.display === "none") return;

      try {
        VIDEO_CARRY.active = true;
        VIDEO_CARRY.fileId = rec.id;
        VIDEO_CARRY.time = previewVideoEl.currentTime || 0;
        VIDEO_CARRY.wasPlaying = !previewVideoEl.paused;
        previewVideoEl.pause();
      } catch {}
    }

    function resumePreviewVideoAfterOverlay() {
      if (!VIDEO_CARRY.active) return;
      if (!previewVideoEl || previewVideoEl.style.display === "none") return;
      applyVideoCarryToElement(previewVideoEl, VIDEO_CARRY.fileId || "");
    }

    function openGalleryForDir(dirNode, startId = null, requestFullscreen = false) {
      viewerDirNode = dirNode;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      if (!viewerItems.length) return;

      let idx = 0;
      if (startId) {
        const found = viewerItems.findIndex(it => !it.isFolder && it.id === startId);
        if (found >= 0) idx = found;
      }
      viewerIndex = idx;

      showOverlay();
      if (requestFullscreen) enterFullscreenIfPossible();
    }

    function openGalleryFromDirectoriesSelection(requestFullscreen) {
      if (!WS.nav.entries.length) return;
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return;

      if (entry.kind === "dir") {
        if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
          WS.view.searchRootActive = false;
          WS.view.searchAnchorPath = entry.node?.path || "";
          WS.view.searchEntryRootPath = entry.node?.path || "";
        }
        if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
          WS.view.favoritesRootActive = false;
          WS.view.favoritesAnchorPath = entry.node?.path || "";
        }
        if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
          WS.view.hiddenRootActive = false;
          WS.view.hiddenAnchorPath = entry.node?.path || "";
        }
        openGalleryForDir(entry.node, null, requestFullscreen);
      } else if (entry.kind === "file") {
        const rec = WS.fileById.get(entry.id);
        const p = rec ? (rec.dirPath || "") : (WS.nav.dirNode?.path || "");
        const dn = WS.dirByPath.get(p) || WS.nav.dirNode;
        openGalleryForDir(dn, entry.id, requestFullscreen);
      }
    }

    function openGalleryFromViewerState(requestFullscreen) {
      if (!viewerDirNode || !viewerItems.length) {
        openGalleryFromDirectoriesSelection(requestFullscreen);
        return;
      }
      showOverlay();
      if (requestFullscreen) enterFullscreenIfPossible();
    }

    function ensureViewerElements() {
      if (!viewerImgEl) {
        viewerImgEl = document.createElement("img");
        viewerImgEl.style.display = "none";
        viewerImgEl.onload = () => {
          viewerImgEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };
        viewport.appendChild(viewerImgEl);
      }
      if (!viewerVideoEl) {
        viewerVideoEl = document.createElement("video");
        viewerVideoEl.controls = true;
        viewerVideoEl.preload = "metadata";
        viewerVideoEl.playsInline = true;
        viewerVideoEl.autoplay = true;
        viewerVideoEl.style.display = "none";
        viewport.appendChild(viewerVideoEl);
      }
      if (!viewerFolderEl) {
        viewerFolderEl = document.createElement("div");
        viewerFolderEl.style.display = "none";
        viewport.appendChild(viewerFolderEl);
      }
    }

    function showOverlay() {
      pausePreviewVideoForOverlay();
      VIEWER_MODE = true;
      ACTIVE_MEDIA_SURFACE = "overlay";
      overlay.classList.add("active");
      ensureViewerElements();
      renderViewerItem(viewerIndex);
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      overlay.classList.add("ui-hidden");
    }

    function stopSlideshow() {
      WS.view.slideshowActive = false;
      if (WS.view.slideshowTimer) {
        clearInterval(WS.view.slideshowTimer);
        WS.view.slideshowTimer = null;
      }
    }

    function startSlideshow(delayMs) {
      stopSlideshow();
      WS.view.slideshowActive = true;
      WS.view.slideshowTimer = setInterval(() => {
        if (!WS.view.slideshowActive) return;
        const item = viewerItems[viewerIndex] || null;
        if (item && !item.isFolder) {
          const rec = WS.fileById.get(item.id);
          if (rec && rec.type === "video") return;
        }
        viewerStep(1);
      }, delayMs);
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      else if (ACTIVE_MEDIA_SURFACE === "preview") renderPreviewViewerItem(viewerIndex);
    }

    function handleSlideshowHotkey(useViewerStatus) {
      const mode = slideshowBehavior();
      if (mode === "cycle") {
        WS.view.slideshowModeIndex = (WS.view.slideshowModeIndex + 1) % WS.view.slideshowDurations.length;
        const ms = WS.view.slideshowDurations[WS.view.slideshowModeIndex] | 0;
        if (!ms) {
          stopSlideshow();
          if (useViewerStatus) showStatusMessage("Slideshow: Off");
          else showSlideshowMessage("Slideshow: Off");
        } else {
          startSlideshow(ms);
          if (useViewerStatus) showStatusMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
          else showSlideshowMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
        }
        return;
      }

      const seconds = parseInt(mode, 10);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : 0;
      if (WS.view.slideshowActive) {
        stopSlideshow();
        if (useViewerStatus) showStatusMessage("Slideshow: Off");
        else showSlideshowMessage("Slideshow: Off");
        return;
      }
      if (ms > 0) {
        startSlideshow(ms);
        if (useViewerStatus) showStatusMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
        else showSlideshowMessage(`Slideshow: ${Math.round(ms / 1000)}s`);
      }
    }

    function hideOverlay() {
      try {
        const item = viewerItems[viewerIndex] || null;
        if (item && !item.isFolder) {
          const rec = WS.fileById.get(item.id);
          if (rec && rec.type === "video" && viewerVideoEl && viewerVideoEl.style.display !== "none") {
            VIDEO_CARRY.active = true;
            VIDEO_CARRY.fileId = rec.id;
            VIDEO_CARRY.time = viewerVideoEl.currentTime || 0;
            VIDEO_CARRY.wasPlaying = !viewerVideoEl.paused;
          }
        }
      } catch {}

      overlay.classList.remove("active");
      VIEWER_MODE = false;
      if (viewerVideoEl) {
        try { viewerVideoEl.pause(); } catch {}
        try { viewerVideoEl.removeAttribute("src"); } catch {}
        try { viewerVideoEl.load(); } catch {}
        viewerVideoEl.classList.remove("ready");
        viewerVideoEl.classList.remove("mediaHidden");
        viewerVideoEl.style.display = "none";
      }
      if (viewerImgEl) {
        try { viewerImgEl.removeAttribute("src"); } catch {}
        viewerImgEl.classList.remove("ready");
        viewerImgEl.classList.remove("mediaHidden");
        viewerImgEl.style.display = "none";
      }
      MediaFilterEngine.detach("viewer");
      if (viewerFolderEl) viewerFolderEl.style.display = "none";
      filenameEl.textContent = "";
      exitFullscreenIfNeeded();
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      overlay.classList.remove("ui-hidden");
      stopSlideshow();
      statusMessageEl.classList.remove("visible");
      syncDirectoriesToViewerState();
      if (!VIEWER_MODE && WS.preview.kind === "file" && WS.preview.fileId) ACTIVE_MEDIA_SURFACE = "preview";
      else if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
      resumePreviewVideoAfterOverlay();
    }

    function showUI() { overlay.classList.remove("ui-hidden"); }
    function hideUI() { overlay.classList.add("ui-hidden"); }

    function resetUIHideTimer() {
      showUI();
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      uiHideTimer = setTimeout(() => { hideUI(); }, 2000);
    }

    overlay.addEventListener("mousemove", () => {
      if (!VIEWER_MODE) return;
      resetUIHideTimer();
    });

    function findFirstFileIndex(items) {
      for (let i = 0; i < items.length; i++) if (!items[i].isFolder) return i;
      return -1;
    }

    function findLastFileIndex(items) {
      for (let i = items.length - 1; i >= 0; i--) if (!items[i].isFolder) return i;
      return -1;
    }

    function moveToNextDirectoryFile() {
      if (!viewerDirNode) return false;
      const originalDir = viewerDirNode;

      const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
      const idx = siblingDirs.indexOf(viewerDirNode);
      if (idx === -1) return false;

      for (let s = idx + 1; s < siblingDirs.length; s++) {
        const dir = siblingDirs[s];
        viewerDirNode = dir;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) continue;

        const firstFileIndex = findFirstFileIndex(viewerItems);
        if (firstFileIndex === -1) continue;

        viewerIndex = firstFileIndex;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return true;
      }

      viewerDirNode = originalDir;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      return false;
    }

    function moveToPrevDirectoryFile() {
      if (!viewerDirNode) return false;
      const originalDir = viewerDirNode;

      const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
      const idx = siblingDirs.indexOf(viewerDirNode);
      if (idx === -1) return false;

      for (let s = idx - 1; s >= 0; s--) {
        const dir = siblingDirs[s];
        viewerDirNode = dir;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) continue;

        const lastFileIndex = findLastFileIndex(viewerItems);
        if (lastFileIndex === -1) continue;

        viewerIndex = lastFileIndex;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return true;
      }

      viewerDirNode = originalDir;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      return false;
    }

    function moveToPrevDirectoryFirstFile() {
      if (!viewerDirNode) return false;
      const originalDir = viewerDirNode;

      const siblingDirs = getVisibleSiblingDirsForSlide(viewerDirNode);
      const idx = siblingDirs.indexOf(viewerDirNode);
      if (idx === -1) return false;

      for (let s = idx - 1; s >= 0; s--) {
        const dir = siblingDirs[s];
        viewerDirNode = dir;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) continue;

        const firstFileIndex = findFirstFileIndex(viewerItems);
        if (firstFileIndex === -1) continue;

        viewerIndex = firstFileIndex;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return true;
      }

      viewerDirNode = originalDir;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      return false;
    }

    function viewerStep(delta) {
      if (!viewerItems.length) return false;
      const n = viewerItems.length;
      const prevDir = viewerDirNode;
      const prevIdx = viewerIndex;

      let i = viewerIndex + delta;

      if (WS.view.folderBehavior === "loop") {
        i = i % n;
        if (i < 0) i += n;
        viewerIndex = i;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
      }

      if (WS.view.folderBehavior === "slide") {
        if (i < 0) {
          if (!moveToPrevDirectoryFile()) return false;
          return true;
        }
        if (i >= n) {
          if (!moveToNextDirectoryFile()) return false;
          return true;
        }

        viewerIndex = i;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
      }

      if (i < 0) i = 0;
      if (i >= n) i = n - 1;

      viewerIndex = i;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
      return !(prevDir === viewerDirNode && prevIdx === viewerIndex);
    }

    function viewerJumpRelative(delta) {
      if (!viewerItems.length) return;
      const step = delta > 0 ? 1 : -1;
      let remaining = Math.abs(delta);
      while (remaining > 0) {
        const moved = viewerStep(step);
        if (!moved) break;
        remaining--;
      }
    }

    function viewerJumpRandom() {
      if (!viewerItems.length) return;
      const fileIdxs = [];
      for (let i = 0; i < viewerItems.length; i++) if (!viewerItems[i].isFolder) fileIdxs.push(i);
      const pool = fileIdxs.length ? fileIdxs : viewerItems.map((_, i) => i);
      if (!pool.length) return;

      let next = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1) {
        let guard = 0;
        while (next === viewerIndex && guard++ < 12) next = pool[Math.floor(Math.random() * pool.length)];
      }
      viewerIndex = next;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
    }

    function viewerJumpToNextFolderFirstFile() {
      if (!viewerDirNode) return;
      moveToNextDirectoryFile();
    }

    function viewerJumpToPrevFolderFirstFile() {
      if (!viewerDirNode) return;
      moveToPrevDirectoryFirstFile();
    }

    function renderViewerItem(idx) {
      if (!viewerItems.length) {
        if (viewerImgEl) viewerImgEl.style.display = "none";
        if (viewerVideoEl) viewerVideoEl.style.display = "none";
        if (viewerFolderEl) viewerFolderEl.style.display = "none";
        filenameEl.textContent = "";
        MediaFilterEngine.detach("viewer");
        if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
        if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
        return;
      }

      ensureViewerElements();

      const n = viewerItems.length;
      let i = idx;
      if (i < 0) i = 0;
      if (i >= n) i = n - 1;
      viewerIndex = i;

      const item = viewerItems[viewerIndex];

      if (viewerVideoEl) {
        try { viewerVideoEl.pause(); } catch {}
        viewerVideoEl.classList.remove("ready");
        viewerVideoEl.style.display = "none";
      }
      if (viewerImgEl) {
        viewerImgEl.classList.remove("ready");
        viewerImgEl.style.display = "none";
      }
      if (viewerFolderEl) viewerFolderEl.style.display = "none";
      MediaFilterEngine.detach("viewer");
      if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
      if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");

      if (!item) return;

      if (item.isFolder) {
        viewerFolderEl.style.display = "flex";
        viewerFolderEl.style.flexDirection = "column";
        viewerFolderEl.style.alignItems = "center";
        viewerFolderEl.style.justifyContent = "center";
        viewerFolderEl.style.minWidth = "200px";
        viewerFolderEl.style.maxWidth = "80%";
        viewerFolderEl.style.padding = "24px 32px";
        viewerFolderEl.style.borderRadius = "4px";
        viewerFolderEl.style.background = "var(--color1-secondary)";
        viewerFolderEl.style.boxShadow = "0 8px 24px rgba(0,0,0,.7)";

        viewerFolderEl.innerHTML = "";

        const icon = document.createElement("div");
        icon.style.fontSize = "56px";
        icon.style.marginBottom = "12px";
        icon.textContent = "📁";

        const name = document.createElement("div");
        name.style.fontSize = "14px";
        name.style.color = "var(--color0-primary)";
        name.style.textAlign = "center";
        name.style.whiteSpace = "nowrap";
        name.style.overflow = "hidden";
        name.style.textOverflow = "ellipsis";
        name.textContent = displayName(item.dirNode?.name || "Folder") || "Folder";

        viewerFolderEl.appendChild(icon);
        viewerFolderEl.appendChild(name);

        filenameEl.textContent = item.dirNode?.path ? displayPath(item.dirNode.path) : (displayName(item.dirNode?.name || "") || "");
        return;
      }

      const rec = WS.fileById.get(item.id);
      if (!rec) return;

      filenameEl.textContent = relPathDisplayName(rec.relPath || rec.name || "");

      if (rec.type === "video") {
        const mode = galleryVideoMode();
        const doAuto = mode !== "off" && !BANIC_ACTIVE;
        if (previewVideoEl) { try { previewVideoEl.pause(); } catch {} }
        viewerVideoEl.autoplay = doAuto;
        viewerVideoEl.onloadeddata = null;
        viewerVideoEl.onended = null;
        viewerVideoEl.muted = (mode === "muted") || BANIC_ACTIVE;
        const endBehavior = videoEndBehavior();
        if (WS.view.slideshowActive) {
          viewerVideoEl.loop = false;
          viewerVideoEl.onended = () => { if (WS.view.slideshowActive) viewerStep(1); };
        } else if (endBehavior === "loop") {
          viewerVideoEl.loop = true;
        } else if (endBehavior === "next") {
          viewerVideoEl.loop = false;
          viewerVideoEl.onended = () => { if (!WS.view.slideshowActive) viewerStep(1); };
        } else {
          viewerVideoEl.loop = false;
        }
        viewerVideoEl.onloadeddata = () => {
          viewerVideoEl.classList.add("ready");
          MediaFilterEngine.requestRender();
        };

        const src = ensureMediaUrl(rec) || "";
        const same = viewerVideoEl.src === src;
        if (!same) {
          viewerVideoEl.src = src;
          try { viewerVideoEl.load(); } catch {}
        }
        viewerVideoEl.style.display = "block";
        syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video");

        applyVideoCarryToElement(viewerVideoEl, rec.id);

        if (viewerVideoEl.readyState >= 2) {
          requestAnimationFrame(() => { viewerVideoEl.classList.add("ready"); });
        }
        if (doAuto) { try { viewerVideoEl.play(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      viewerImgEl.onload = () => {
        viewerImgEl.classList.add("ready");
        MediaFilterEngine.requestRender();
      };
      const src = ensureMediaUrl(rec) || "";
      const same = viewerImgEl.src === src;
      if (!same) viewerImgEl.src = src;
      viewerImgEl.style.display = "block";
      syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image");

      if (viewerImgEl.complete && viewerImgEl.naturalWidth > 0) {
        requestAnimationFrame(() => { viewerImgEl.classList.add("ready"); });
      }
      preloadNextMedia(viewerItems, viewerIndex);
    }

    function viewerEnterDir() { // Right
      const it = viewerItems[viewerIndex];
      if (it && it.isFolder && it.dirNode) {
        if (viewerDirNode) viewerDirNode.lastIndex = viewerIndex;
        viewerDirNode = it.dirNode;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        let idx = typeof viewerDirNode.lastIndex === "number" ? viewerDirNode.lastIndex : 0;
        if (idx < 0) idx = 0;
        if (idx >= viewerItems.length) idx = viewerItems.length - 1;
        viewerIndex = idx;
        if (VIEWER_MODE) renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
      }
    }

    function viewerLeaveDir() { // Left
      if (WS.view.dirSearchPinned && !WS.view.searchRootActive) {
        if (VIEWER_MODE) hideOverlay();
        returnToSearchResults();
        return;
      }
      if (!viewerDirNode || !viewerDirNode.parent) return;
      const child = viewerDirNode;
      child.lastIndex = viewerIndex;
      viewerDirNode = viewerDirNode.parent;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      let idx = 0;
      for (let i = 0; i < viewerItems.length; i++) {
        const it = viewerItems[i];
        if (it.isFolder && it.dirNode === child) { idx = i; break; }
      }
      viewerDirNode.lastIndex = idx;
      viewerIndex = idx;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
    }

    function getActiveMediaVideo() {
      if (VIEWER_MODE) return viewerVideoEl && viewerVideoEl.style.display !== "none" ? viewerVideoEl : null;
      if (ACTIVE_MEDIA_SURFACE === "preview") return previewVideoEl && previewVideoEl.style.display !== "none" ? previewVideoEl : null;
      return null;
    }

    function seekViewerVideo(deltaSeconds) {
      const vid = getActiveMediaVideo();
      if (!vid) return;
      try {
        let t = (vid.currentTime || 0) + deltaSeconds;
        if (t < 0) t = 0;
        if (!isNaN(vid.duration) && isFinite(vid.duration) && vid.duration >= 0) {
          if (t > vid.duration) t = vid.duration;
        }
        vid.currentTime = t;
      } catch {}
    }

    function toggleViewerVideoPlayPause() {
      const vid = getActiveMediaVideo();
      if (!vid) return;
      try {         if (vid.paused) {
          vid.play();
        } else {
          vid.pause();
        }
      } catch {}
    }

    function toggleViewerVideoMute() {
      const vid = getActiveMediaVideo();
      if (!vid) return;
      try {
        vid.muted = !vid.muted;
      } catch {}
    }

    /* =========================================================
       Fullscreen helpers
       ========================================================= */

    async function enterFullscreenIfPossible() {
      if (!overlay) return;
      if (document.fullscreenElement) return;
      try { await overlay.requestFullscreen(); } catch {}
    }

    function exitFullscreenIfNeeded() {
      if (!document.fullscreenElement) return;
      try { document.exitFullscreen(); } catch {}
    }

    /* =========================================================
       Overlay buttons + basic wiring
       ========================================================= */

    if (closeBtn) closeBtn.addEventListener("click", (e) => { e.stopPropagation(); hideOverlay(); });

    overlay.addEventListener("click", (e) => {
      if (!VIEWER_MODE) return;
    });

    /* =========================================================
       Global UI sync helpers
       ========================================================= */

    function syncButtons() {
      const hasWS = !!WS.root && (!!WS.nav.dirNode || WS.view.favoritesMode || WS.view.hiddenMode);
      if (favoritesBtn) favoritesBtn.disabled = !hasWS;
      if (hiddenBtn) hiddenBtn.disabled = !hasWS;
      if (refreshBtn) refreshBtn.disabled = !WS.meta.fsRootHandle;

      if (directoriesSearchInput) {
        directoriesSearchInput.disabled = !hasWS;
        const v = String(WS.view.dirSearchQuery || "");
        if (directoriesSearchInput.value !== v) directoriesSearchInput.value = v;
      }
      if (directoriesSearchClearBtn) {
        const enabled = hasWS && (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim());
        directoriesSearchClearBtn.disabled = !enabled;
      }

      if (dirBackBtn) dirBackBtn.disabled = !(WS.view.dirHistoryIndex > 0);
      if (dirForwardBtn) dirForwardBtn.disabled = !(WS.view.dirHistoryIndex >= 0 && WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1);
      if (dirUpBtn) dirUpBtn.disabled = !WS.nav.dirNode || !WS.nav.dirNode.parent || (WS.view.dirSearchPinned && WS.view.searchRootActive) || WS.view.favoritesMode || WS.view.hiddenMode;

      syncMetaButtons();
      updateModePill();
    }

    function applyViewModesEverywhere(animate = false) {
      if (!WS.root || (!WS.nav.dirNode && !WS.view.favoritesMode && !WS.view.hiddenMode)) {
        renderDirectoriesPane();
        renderPreviewPane(true);
        syncButtons();
        return;
      }

      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;

      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane(true);
      renderPreviewPane(animate, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    /* =========================================================
       Key controls
       ========================================================= */

    function isTextInputTarget(el) {
      if (!el) return false;
      const tag = (el.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function cycleFilterMode() {
      const m = WS.view.filterMode;
      WS.view.filterMode = (m === "all") ? "images" : (m === "images") ? "videos" : (m === "videos") ? "gifs" : "all";
      applyViewModesEverywhere(true);
      showStatusMessage(`Filter: ${WS.view.filterMode}`);
    }

    function cycleFolderBehavior() {
      const b = WS.view.folderBehavior;
      WS.view.folderBehavior = (b === "stop") ? "loop" : (b === "loop") ? "slide" : "stop";
      applyViewModesEverywhere(true);
      showStatusMessage(`Folder behavior: ${WS.view.folderBehavior}`);
    }

    function moveDirectoriesSelection(delta) {
      if (!WS.root) return;
      if (!WS.nav.entries.length) return;

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;

      if (WS.view.folderBehavior === "slide" && entry && entry.kind === "file") {
        slideMoveFiles(delta);
        return;
      }

      setDirectoriesSelection(WS.nav.selectedIndex + delta);
    }

    function randomDirectoriesSelection() {
      if (!WS.root) return;
      const n = WS.nav.entries.length;
      if (!n) return;
      let idx = Math.floor(Math.random() * n);
      let guard = 0;
      while (guard++ < 24 && !isSelectableEntry(WS.nav.entries[idx])) idx = Math.floor(Math.random() * n);
      setDirectoriesSelection(idx);
      showStatusMessage("Random jump");
    }

    function bumpSelectedFolderScore(delta) {
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry || entry.kind !== "dir") return false;
      const path = String(entry.node?.path || "");
      if (!path) return false;
      metaBumpScore(path, delta);
      return true;
    }

    function closeFilePreviewToFolder() {
      if (!WS.root) return;
      if (WS.preview.kind !== "file") return;
      WS.preview.kind = "dir";
      WS.preview.fileId = null;
      WS.preview.dirNode = getPreviewTargetDir();
      ACTIVE_MEDIA_SURFACE = "none";
      renderPreviewPane(true, true);
      syncButtons();
    }

    function handleBackAction() {
      if (HELP_OPEN) { closeHelp(); return true; }
      if (OPTIONS_OPEN) { closeOptions(); return true; }
      if (KEYBINDS_OPEN) { closeKeybinds(); return true; }
      if (WS.view.bulkActionMenuOpen || WS.view.dirActionMenuPath || WS.view.fileActionMenuId) {
        closeActionMenus();
        renderDirectoriesPane(true);
        return true;
      }
      if (VIEWER_MODE) { hideOverlay(); return true; }
      if (WS.preview.kind === "file" && WS.preview.fileId) {
        closeFilePreviewToFolder();
        return true;
      }
      return false;
    }

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = normalizeKeyValue(e.key);
      if (!key) return;

      if (key === ".") {
        if (isTextInputTarget(e.target)) return;
        if (VIEWER_MODE) return;
        if (directoriesSearchInput && !directoriesSearchInput.disabled) {
          e.preventDefault();
          try { directoriesSearchInput.focus(); directoriesSearchInput.select(); } catch {}
          return;
        }
      }

      if (key === "/") {
        if (isTextInputTarget(e.target)) return;
        if (VIEWER_MODE) return;
        e.preventDefault();
        setHelpHold(true);
        return;
      }

      const action = keybindActionFor(key);

      if (action === "panic") {
        e.preventDefault();
        applyBanicState(!BANIC_ACTIVE);
        return;
      }

      if (BANIC_ACTIVE) return;

      if (key === "Escape" || action === "back") {
        const handled = handleBackAction();
        if (handled) e.preventDefault();
        return;
      }

      if (HELP_OPEN) return;
      if (OPTIONS_OPEN) return;
      if (KEYBINDS_OPEN) return;

      if (isTextInputTarget(e.target)) return;

      if (VIEWER_MODE) {
        switch (action) {
          case "selectUp":
            e.preventDefault();
            viewerStep(-1);
            return;
          case "selectDown":
            e.preventDefault();
            viewerStep(1);
            return;
          case "leaveDir":
            e.preventDefault();
            viewerLeaveDir();
            return;
          case "enterDir":
            e.preventDefault();
            viewerEnterDir();
            return;
          case "prevFolder":
            e.preventDefault();
            viewerJumpToPrevFolderFirstFile();
            return;
          case "nextFolder":
            e.preventDefault();
            viewerJumpToNextFolderFirstFile();
            return;
          case "randomJump":
            e.preventDefault();
            viewerJumpRandom();
            showStatusMessage("Random jump");
            return;
          case "cycleFilter":
            e.preventDefault();
            cycleFilterMode();
            return;
          case "slideshow":
            e.preventDefault();
            handleSlideshowHotkey(true);
            return;
          case "seekBack":
            e.preventDefault();
            seekViewerVideo(-videoSkipStepSeconds());
            return;
          case "seekForward":
            e.preventDefault();
            seekViewerVideo(videoSkipStepSeconds());
            return;
          case "playPause":
            e.preventDefault();
            toggleViewerVideoPlayPause();
            return;
          case "muteToggle":
            e.preventDefault();
            toggleViewerVideoMute();
            return;
          case "jumpMinus50":
            e.preventDefault();
            viewerJumpRelative(-50);
            return;
          case "jumpMinus10":
            e.preventDefault();
            viewerJumpRelative(-10);
            return;
          case "jumpPlus10":
            e.preventDefault();
            viewerJumpRelative(10);
            return;
          case "jumpPlus50":
            e.preventDefault();
            viewerJumpRelative(50);
            return;
          default:
            return;
        }
      }

      if (!WS.root) return;

      const inFilePreview = (WS.preview.kind === "file" && !!WS.preview.fileId);

      if (inFilePreview) {
        switch (action) {
          case "selectUp":
            e.preventDefault();
            viewerStep(-1);
            return;
          case "selectDown":
            e.preventDefault();
            viewerStep(1);
            return;
          case "leaveDir":
            e.preventDefault();
            viewerLeaveDir();
            return;
          case "enterDir":
            e.preventDefault();
            openGalleryFromViewerState(true);
            return;
          case "prevFolder":
            e.preventDefault();
            viewerJumpToPrevFolderFirstFile();
            return;
          case "nextFolder":
            e.preventDefault();
            jumpToNextFolderFirstFile();
            return;
          case "randomJump":
            e.preventDefault();
            randomDirectoriesSelection();
            return;
          case "cycleFilter":
            e.preventDefault();
            cycleFilterMode();
            return;
          case "slideshow":
            e.preventDefault();
            handleSlideshowHotkey(false);
            return;
          case "seekBack":
            e.preventDefault();
            seekViewerVideo(-videoSkipStepSeconds());
            return;
          case "seekForward":
            e.preventDefault();
            seekViewerVideo(videoSkipStepSeconds());
            return;
          case "playPause":
            e.preventDefault();
            toggleViewerVideoPlayPause();
            return;
          case "muteToggle":
            e.preventDefault();
            toggleViewerVideoMute();
            return;
          case "jumpMinus50":
            e.preventDefault();
            viewerJumpRelative(-50);
            return;
          case "jumpMinus10":
            e.preventDefault();
            viewerJumpRelative(-10);
            return;
          case "jumpPlus10":
            e.preventDefault();
            viewerJumpRelative(10);
            return;
          case "jumpPlus50":
            e.preventDefault();
            viewerJumpRelative(50);
            return;
          case "historyBack":
            e.preventDefault();
            goDirHistory(-1);
            return;
          case "historyForward":
            e.preventDefault();
            goDirHistory(1);
            return;
          default:
            return;
        }
      }

      switch (action) {
        case "selectUp":
          e.preventDefault();
          moveDirectoriesSelection(-1);
          return;
        case "selectDown":
          e.preventDefault();
          moveDirectoriesSelection(1);
          return;
        case "leaveDir":
          e.preventDefault();
          leaveDirectory();
          return;
        case "enterDir":
          e.preventDefault();
          enterSelectedDirectory();
          return;
        case "prevFolder":
          e.preventDefault();
          jumpToPrevFolderFirstFile();
          return;
        case "nextFolder":
          e.preventDefault();
          jumpToNextFolderFirstFile();
          return;
        case "randomJump":
          e.preventDefault();
          randomDirectoriesSelection();
          return;
        case "cycleFilter":
          e.preventDefault();
          cycleFilterMode();
          return;
        case "jumpMinus50":
          e.preventDefault();
          moveDirectoriesSelection(-50);
          return;
        case "jumpMinus10":
          e.preventDefault();
          moveDirectoriesSelection(-10);
          return;
        case "jumpPlus10":
          e.preventDefault();
          moveDirectoriesSelection(10);
          return;
        case "jumpPlus50":
          e.preventDefault();
          moveDirectoriesSelection(50);
          return;
        case "historyBack":
          e.preventDefault();
          goDirHistory(-1);
          return;
        case "historyForward":
          e.preventDefault();
          goDirHistory(1);
          return;
        default:
          return;
      }
    });

    document.addEventListener("keyup", (e) => {
      if (e.key === "/") setHelpHold(false);
    });

    window.addEventListener("blur", () => setHelpHold(false));

    /* =========================================================
       Initial UI state
       ========================================================= */

    if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = true;
    applyColorSchemeFromOptions();
    applyRetroModeFromOptions();
    rebuildKeybindIndex();
    renderDirectoriesPane();
    renderPreviewPane(true);
    syncButtons();

  
