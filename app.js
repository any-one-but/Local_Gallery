    /* Local note: version 01.02.08 was the last version to include online features. */
    /* =========================================================
       Core model
       ========================================================= */

    const imgRE = /\.(jpe?g|png|gif|webp|tiff|bmp|avif)$/i;
    const vidRE = /\.(mp4|m4v|mov|wmv|flv|avi|webm|mkv)$/i;
    const indexPrefixRE = /^(\d+)\s-\s/;

    const FAVORITE_TAG = "__favorite__";
    const HIDDEN_TAG = "__hidden__";
    const PROCESSING_DISABLED_TAG = "__processing_disabled__";
    const FOLDER_THUMB_NONE_SENTINEL = "__thumb_none__";
    const FOLDER_THUMB_ROTATE_SENTINEL = "__thumb_rotate__";
    // Legacy thumbnail style switch. "aspect" mode remains in code for future reactivation,
    // but the app currently runs cropped thumbnails only.
    const ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE = false;
    const GRID_CROPPED_COLS_BY_SCALE = Object.freeze({
      small: 7,
      medium: 6,
      large: 5,
      xl: 4,
      xxl: 3,
      xxxl: 2
    });
    const TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT = "sunset-electric";
    const TAG_FOLDER_TITLE_COLOR_PAIRS = Object.freeze([
      Object.freeze({ value: "sunset-soft", label: "Soft Sunset (Orange + Pink)", tag: "#ffd6a0", favorite: "#ffb8dd" }),
      Object.freeze({ value: "sunset-vivid", label: "Vivid Sunset (Orange + Pink)", tag: "#ffb35c", favorite: "#ff7cc7" }),
      Object.freeze({ value: "sunset-electric", label: "Electric Sunset (Orange + Pink)", tag: "#ff9300", favorite: "#ff43b5" }),
      Object.freeze({ value: "neon-arcade", label: "Neon Arcade", tag: "#ff9f1a", favorite: "#ff4dff" }),
      Object.freeze({ value: "disco-fever", label: "Disco Fever", tag: "#ffe45e", favorite: "#ff2ea6" }),
      Object.freeze({ value: "laser-party", label: "Laser Party", tag: "#63f5ff", favorite: "#ff6eff" }),
      Object.freeze({ value: "candy-pop", label: "Candy Pop", tag: "#ffc27a", favorite: "#ff95d0" }),
      Object.freeze({ value: "tropical-glow", label: "Tropical Glow", tag: "#9fffb2", favorite: "#ff9fba" })
    ]);
    const TAG_FOLDER_TITLE_COLOR_PAIR_BY_VALUE = (() => {
      const byValue = new Map();
      for (const pair of TAG_FOLDER_TITLE_COLOR_PAIRS) {
        byValue.set(String(pair.value || ""), pair);
      }
      return byValue;
    })();

    function isImageName(name) { return imgRE.test((name || "").toLowerCase()); }
    function isVideoName(name) { return vidRE.test((name || "").toLowerCase()); }

    function fileKey(file, relPathOverride) {
      const rp = relPathOverride || file.webkitRelativePath || "";
      return (file.name + "::" + file.lastModified + "::" + file.size + "::" + rp);
    }

    function fileKeyForRecord(rec, relPathOverride) {
      const relPath = String(relPathOverride != null ? relPathOverride : (rec?.relPath || ""));
      const name = String(rec?.name || rec?.file?.name || "");
      const lastModified = Number.isFinite(Number(rec?.lastModified))
        ? Number(rec.lastModified)
        : Number(rec?.file?.lastModified || 0);
      const size = Number.isFinite(Number(rec?.size))
        ? Number(rec.size)
        : Number(rec?.file?.size || 0);
      return `${name}::${lastModified}::${size}::${relPath}`;
    }

    function splitIndexPrefix(name) {
      const s = String(name || "");
      const m = s.match(indexPrefixRE);
      if (!m) return { idx: null, clean: s };
      return { idx: parseInt(m[1], 10), clean: s.slice(m[0].length) };
    }

    function displayName(name) {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return applyDisplayNameRules(name, opt, { isFile: false });
    }

    function displayTagFolderLabel(name) {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      let out = String(name || "");
      if (opt && opt.forceTitleCaps) out = toTitleCaps(out);
      return out;
    }

    function splitNameExt(name) {
      const raw = String(name || "");
      const i = raw.lastIndexOf(".");
      if (i <= 0) return { base: raw, ext: "" };
      return { base: raw.slice(0, i), ext: raw.slice(i) };
    }

    function toTitleCaps(str) {
      return String(str || "").replace(/\w\S*/g, (txt) => {
        return txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase();
      });
    }

    function applyDisplayNameRules(name, opt, ctx = null) {
      let out = String(name || "");
      const isFile = !!(ctx && ctx.isFile);
      if (opt && opt.hideBeforeLastDashInFileNames) {
        const idx = out.lastIndexOf(" - ");
        if (idx >= 0) out = out.slice(idx + 3);
      }
      if (isFile && opt && opt.hideAfterFirstUnderscoreInFileNames) {
        const idx = out.lastIndexOf("_");
        if (idx >= 0) out = out.slice(0, idx);
      }
      if (opt && opt.forceTitleCaps) out = toTitleCaps(out);
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
      const p = String(path || "");
      try {
        if (typeof WS !== "undefined" && WS.dirByPath && WS.dirByPath.has(p)) {
          const node = WS.dirByPath.get(p);
          if (node) {
            const parts = [];
            let cur = node;
            while (cur) {
              parts.push(dirDisplayName(cur));
              cur = cur.parent;
            }
            parts.reverse();
            return parts.join("/") || "";
          }
        }
      } catch {}
      const parts = p.split("/").filter(Boolean);
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

    function remapPathMapValues(src, oldPrefix, newPrefix) {
      const next = new Map();
      for (const [key, value] of src || []) {
        next.set(key, remapPathPrefix(oldPrefix, newPrefix, value));
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

    /* =========================================================
       Local-only mode
       ========================================================= */

    function dirDisplayName(node) {
      return displayName(node?.name || "folder") || "folder";
    }

    function fileDisplayNameForRecord(rec) {
      return fileDisplayName(rec?.name || "file") || "file";
    }

    function clampNumber(value, min, max, fallback) {
      const n = typeof value === "number" ? value : parseFloat(value);
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    }

    function normalizeAnimatedMediaFiltersValue(value, fallback = "on") {
      if (value === true) return "on";
      if (value === false) return "off";
      const raw = String(value == null ? "" : value).trim().toLowerCase();
      if (raw === "on" || raw === "off") return raw;
      if (
        raw === "videos" ||
        raw === "video" ||
        raw === "video-only" ||
        raw === "videos-only" ||
        raw === "video_only" ||
        raw === "videos_only"
      ) {
        return "videos";
      }
      return fallback;
    }

    function normalizeFolderBehavior(value, fallback = "slide") {
      const raw = String(value == null ? "" : value).trim().toLowerCase();
      if (raw === "slide" || raw === "stop") return raw;
      // Legacy "loop" mode is retired for item navigation; map to slide.
      if (raw === "loop") return "slide";
      return fallback;
    }

    function normalizeThumbnailScaleValue(value, fallback = "medium") {
      const raw = String(value == null ? "" : value).trim().toLowerCase();
      if (
        raw === "small" ||
        raw === "medium" ||
        raw === "large" ||
        raw === "xl" ||
        raw === "xxl" ||
        raw === "xxxl"
      ) return raw;
      return fallback;
    }

    function normalizeTagFolderTitleColorPairValue(value, fallback = TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT) {
      const raw = String(value == null ? "" : value).trim().toLowerCase();
      if (TAG_FOLDER_TITLE_COLOR_PAIR_BY_VALUE.has(raw)) return raw;
      return TAG_FOLDER_TITLE_COLOR_PAIR_BY_VALUE.has(String(fallback || "")) ? String(fallback || "") : TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT;
    }

    function getTagFolderTitleColorPairByValue(value) {
      const key = normalizeTagFolderTitleColorPairValue(value, TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT);
      return TAG_FOLDER_TITLE_COLOR_PAIR_BY_VALUE.get(key) || TAG_FOLDER_TITLE_COLOR_PAIR_BY_VALUE.get(TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT);
    }

    function defaultOptions() {
      return {
        videoPreview: "muted",
        videoGallery: "unmuted",
        imageThumbSize: "high",
        videoThumbSize: "medium",
        mediaThumbUiSize: "medium",
        folderPreviewSize: "small",
        betaDirFileThumbFullCard: true,
        betaDirFolderSquareCard: true,
        defaultFolderBehavior: "slide",
        folderScoreDisplay: "no-arrows",
        previewMode: "grid",
        videoSkipStep: "5",
        preloadNextMode: "off",
        videoEndBehavior: "loop",
        slideshowDefault: "cycle",
        altGalleryMode: true,
        retroMode: false,
        mediaFilter: "off",
        mediaFilterIntensity: 1,
        vibrantOverlayEnabled: false,
        vibrantOverlayIntensity: 1,
        betaTallImageScrollDetect: true,
        animatedMediaFilters: "on",
        gifsIgnoreProcessing: false,
        crtScanlinesEnabled: false,
        crtPixelateEnabled: false,
        crtGrainEnabled: false,
        crtPixelateResolution: 4,
        crtGrainAmount: 0.06,
        vhsOverlayEnabled: false,
        vhsBlurAmount: 1.2,
        vhsChromaAmount: 1.2,
        filmCornerOverlayEnabled: false,
        colorScheme: "superdark",
        leftPaneWidthPct: 0.28,
        treatTagsAsFolders: true,
        showGridUpDirectoryEntry: true,
        showRootView: true,
        showHiddenFolder: false,
        showUntaggedFolder: false,
        showTagFolderSpacerRow: false,
        tagFolderTitleColorPair: TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT,
        showFolderItemCount: true,
        showFolderSize: true,
        showDirFileTypeLabel: true,
        showPreviewFileTypeLabel: false,
        showPreviewFolderItemCount: true,
        showPreviewFileName: false,
        forceTitleCaps: false,
        hideBeforeLastDashInFileNames: false,
        hideAfterFirstUnderscoreInFileNames: false,
        previewThumbFiltersEnabled: false,
        previewThumbFit: "contain",
        hideOptionDescriptions: false,
        hideKeybindDescriptions: false,
        interactionMode: "grid",
        randomActionMode: "firstFileJump",
        clickSelectedRotatingThumbTeleports: false,
        fileOnlyFoldersOpenInGallery: false,
        thumbnailStyle: "cropped",
        thumbnailScaleCropped: "medium",
        thumbnailScaleAspect: "small"
      };
    }

    function normalizeOptions(o) {
      const d = defaultOptions();
      const src = (o && typeof o === "object") ? o : {};
      const mediaFilterRaw = (src && src.mediaFilter === "vhs") ? "crt" : src.mediaFilter;
      const vibrantOverlayEnabled = (typeof src.vibrantOverlayEnabled === "boolean")
        ? src.vibrantOverlayEnabled
        : (mediaFilterRaw === "vibrant");
      const vibrantOverlayIntensity = clampNumber(
        (src && src.vibrantOverlayIntensity != null) ? src.vibrantOverlayIntensity : src.mediaFilterIntensity,
        0,
        1,
        d.vibrantOverlayIntensity
      );
      const legacyCrtPixelateResRaw = (src && src.crtPixelateRes != null) ? String(src.crtPixelateRes) : null;
      const legacyCrtOverlayEnabledRaw = (typeof src.crtOverlayEnabled === "boolean") ? src.crtOverlayEnabled : null;
      const legacyCrtOverlayEnabled = (legacyCrtOverlayEnabledRaw !== null)
        ? legacyCrtOverlayEnabledRaw
        : (legacyCrtPixelateResRaw ? legacyCrtPixelateResRaw !== "off" : false);
      const crtScanlinesEnabled = (typeof src.crtScanlinesEnabled === "boolean") ? src.crtScanlinesEnabled : legacyCrtOverlayEnabled;
      const crtPixelateEnabled = (typeof src.crtPixelateEnabled === "boolean") ? src.crtPixelateEnabled : legacyCrtOverlayEnabled;
      const crtGrainEnabled = (typeof src.crtGrainEnabled === "boolean") ? src.crtGrainEnabled : legacyCrtOverlayEnabled;
      const crtPixelateResolution = clampNumber(src.crtPixelateResolution, 2, 8, d.crtPixelateResolution);
      const crtGrainAmount = clampNumber(src.crtGrainAmount, 0, 0.25, d.crtGrainAmount);
      const vhsOverlayEnabled = (typeof src.vhsOverlayEnabled === "boolean") ? src.vhsOverlayEnabled : d.vhsOverlayEnabled;
      const vhsBlurAmount = clampNumber(src.vhsBlurAmount, 0, 3, d.vhsBlurAmount);
      const vhsChromaAmount = clampNumber(src.vhsChromaAmount, 0, 3, d.vhsChromaAmount);
      const filmCornerOverlayEnabled = (typeof src.filmCornerOverlayEnabled === "boolean") ? src.filmCornerOverlayEnabled : d.filmCornerOverlayEnabled;
      const thumbnailStyleRaw = String(src.thumbnailStyle || "").trim().toLowerCase();
      const thumbnailStyle = ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE
        ? ((thumbnailStyleRaw === "cropped" || thumbnailStyleRaw === "aspect")
          ? thumbnailStyleRaw
          : (((typeof src.betaAspectRatioThumbCards === "boolean") && src.betaAspectRatioThumbCards) ? "aspect" : d.thumbnailStyle))
        : "cropped";
      const thumbnailScaleCropped = normalizeThumbnailScaleValue(src.thumbnailScaleCropped, d.thumbnailScaleCropped);
      const thumbnailScaleAspect = normalizeThumbnailScaleValue(src.thumbnailScaleAspect, d.thumbnailScaleAspect);
      const out = {
        videoPreview: "muted",
        videoGallery: "unmuted",
        imageThumbSize: "high",
        videoThumbSize: "medium",
        mediaThumbUiSize: "medium",
        folderPreviewSize: "small",
        betaDirFileThumbFullCard: true,
        betaDirFolderSquareCard: true,
        defaultFolderBehavior: normalizeFolderBehavior(src.defaultFolderBehavior, d.defaultFolderBehavior),
        folderScoreDisplay: "no-arrows",
        previewMode: "grid",
        previewThumbFit: "contain",
        videoSkipStep: "5",
        preloadNextMode: (src.preloadNextMode === "off" || src.preloadNextMode === "on" || src.preloadNextMode === "ultra") ? src.preloadNextMode : d.preloadNextMode,
        videoEndBehavior: "loop",
        slideshowDefault: (src.slideshowDefault === "cycle" || src.slideshowDefault === "1" || src.slideshowDefault === "3" || src.slideshowDefault === "5" || src.slideshowDefault === "10") ? src.slideshowDefault : d.slideshowDefault,
        altGalleryMode: true,
        retroMode: false,
        colorScheme: "superdark",
        treatTagsAsFolders: d.treatTagsAsFolders,
        showGridUpDirectoryEntry: (typeof src.showGridUpDirectoryEntry === "boolean") ? src.showGridUpDirectoryEntry : d.showGridUpDirectoryEntry,
        showRootView: (typeof src.showRootView === "boolean") ? src.showRootView : d.showRootView,
        showHiddenFolder: (typeof src.showHiddenFolder === "boolean") ? src.showHiddenFolder : ((typeof src.treatHiddenAsFolder === "boolean") ? src.treatHiddenAsFolder : d.showHiddenFolder),
        showUntaggedFolder: (typeof src.showUntaggedFolder === "boolean") ? src.showUntaggedFolder : d.showUntaggedFolder,
        showTagFolderSpacerRow: (typeof src.showTagFolderSpacerRow === "boolean") ? src.showTagFolderSpacerRow : d.showTagFolderSpacerRow,
        tagFolderTitleColorPair: normalizeTagFolderTitleColorPairValue(src.tagFolderTitleColorPair, d.tagFolderTitleColorPair),
        showFolderItemCount: true,
        showFolderSize: true,
        showDirFileTypeLabel: true,
        showPreviewFileTypeLabel: false,
        showPreviewFolderItemCount: true,
        showPreviewFileName: false,
        forceTitleCaps: (typeof src.forceTitleCaps === "boolean") ? src.forceTitleCaps : d.forceTitleCaps,
        hideBeforeLastDashInFileNames: (typeof src.hideBeforeLastDashInFileNames === "boolean") ? src.hideBeforeLastDashInFileNames : d.hideBeforeLastDashInFileNames,
        hideAfterFirstUnderscoreInFileNames: (typeof src.hideAfterFirstUnderscoreInFileNames === "boolean") ? src.hideAfterFirstUnderscoreInFileNames : d.hideAfterFirstUnderscoreInFileNames,
        previewThumbFiltersEnabled: false,
        hideOptionDescriptions: false,
        hideKeybindDescriptions: false,
        interactionMode: (String(src.interactionMode || "").toLowerCase() === "pane") ? "pane" : "grid",
        randomActionMode: (
          src.randomActionMode === "firstFileJump"
          || src.randomActionMode === "randomFileSort"
          || src.randomActionMode === "randomFolderSort"
        ) ? src.randomActionMode : d.randomActionMode,
        clickSelectedRotatingThumbTeleports: (typeof src.clickSelectedRotatingThumbTeleports === "boolean")
          ? src.clickSelectedRotatingThumbTeleports
          : d.clickSelectedRotatingThumbTeleports,
        fileOnlyFoldersOpenInGallery: (typeof src.fileOnlyFoldersOpenInGallery === "boolean")
          ? src.fileOnlyFoldersOpenInGallery
          : d.fileOnlyFoldersOpenInGallery,
        thumbnailStyle,
        thumbnailScaleCropped,
        thumbnailScaleAspect,
        leftPaneWidthPct: (function(){
          const v = parseFloat(src.leftPaneWidthPct);
          if (Number.isFinite(v)) return Math.max(0.05, Math.min(0.9, v));
          return 0.28;
        })(),
        /* Media filters: UI */
        mediaFilter: "off",
        mediaFilterIntensity: vibrantOverlayIntensity,
        vibrantOverlayEnabled,
        vibrantOverlayIntensity,
        betaTallImageScrollDetect: true,
        animatedMediaFilters: normalizeAnimatedMediaFiltersValue(src.animatedMediaFilters, d.animatedMediaFilters),
        gifsIgnoreProcessing: (typeof src.gifsIgnoreProcessing === "boolean") ? src.gifsIgnoreProcessing : d.gifsIgnoreProcessing,
        crtScanlinesEnabled,
        crtPixelateEnabled,
        crtGrainEnabled,
        crtPixelateResolution,
        crtGrainAmount,
        vhsOverlayEnabled,
        vhsBlurAmount,
        vhsChromaAmount,
        filmCornerOverlayEnabled
    };
      return out;
    }

    const MEDIA_FILTER_STATE = {
      mode: "off",
      animatedMode: "on"
    };
    let MEDIA_OVERLAY_STATE = null;
    let THUMB_FILTER_KEY = "";

    const MEDIA_FILTER_CONFIGS = {
      vibrant: { color: "saturate(1.45) contrast(1.12) brightness(1.06) hue-rotate(-3deg)" },
      uv: { color: "saturate(1.6) hue-rotate(220deg) contrast(1.3) brightness(0.95)" },
      orangeTeal: { color: "hue-rotate(-22deg) saturate(1.32) contrast(1.12) brightness(1.05)" },
      cinematic: { color: "contrast(1.3) saturate(1.2) brightness(1.02) hue-rotate(-2deg)" },
      bw: { color: "grayscale(1) contrast(1.08)", forceMonochrome: true },
      infrared: { color: "saturate(1.6) hue-rotate(-45deg) contrast(1.3) brightness(1.05)" }
    };

    const CRT_OVERLAY_CONFIG = {
      scanlines: 0.4,
      scanlineBlur: 0.8,
      chroma: 0.7,
      vignette: 0.22,
      jitter: 0.75,
      blur: 0.25,
      grain: 0.06,
      pixelate: 4
    };

    const VHS_OVERLAY_CONFIG = {
      scanlines: 0,
      scanlineBlur: 0,
      chroma: 1.2,
      vignette: 0.08,
      jitter: 0.55,
      blur: 1.2,
      grain: 0.035,
      pixelate: 0
    };

    const FILM_CORNER_CONFIG = {
      cornerRadius: 0.08
    };

    function buildCrtOverlayConfigFromOptions(opt) {
      if (!opt) return null;
      const scanlinesOn = !!opt.crtScanlinesEnabled;
      const pixelateOn = !!opt.crtPixelateEnabled;
      const grainOn = !!opt.crtGrainEnabled;
      const pixelate = pixelateOn ? clampNumber(opt.crtPixelateResolution, 2, 8, CRT_OVERLAY_CONFIG.pixelate) : 0;
      const grain = grainOn ? clampNumber(opt.crtGrainAmount, 0, 0.25, CRT_OVERLAY_CONFIG.grain) : 0;
      const scanlines = scanlinesOn ? CRT_OVERLAY_CONFIG.scanlines : 0;
      if (!scanlines && !pixelate && !grain) return null;
      return {
        scanlines,
        scanlineBlur: scanlinesOn ? CRT_OVERLAY_CONFIG.scanlineBlur : 0,
        chroma: pixelateOn ? CRT_OVERLAY_CONFIG.chroma : 0,
        vignette: pixelateOn ? CRT_OVERLAY_CONFIG.vignette : 0,
        jitter: pixelateOn ? CRT_OVERLAY_CONFIG.jitter : 0,
        blur: pixelateOn ? CRT_OVERLAY_CONFIG.blur : 0,
        grain,
        pixelate
      };
    }

    function buildVhsOverlayConfigFromOptions(opt) {
      if (!opt || !opt.vhsOverlayEnabled) return null;
      const blur = clampNumber(opt.vhsBlurAmount, 0, 3, VHS_OVERLAY_CONFIG.blur);
      const chroma = clampNumber(opt.vhsChromaAmount, 0, 3, VHS_OVERLAY_CONFIG.chroma);
      return Object.assign({}, VHS_OVERLAY_CONFIG, { blur, chroma });
    }

    function buildFilmCornerOverlayConfigFromOptions(opt) {
      if (!opt || !opt.filmCornerOverlayEnabled) return null;
      return { cornerRadius: FILM_CORNER_CONFIG.cornerRadius };
    }

    function mergeOverlayConfigs(a, b) {
      if (!a) return b || null;
      if (!b) return a;
      return {
        scanlines: Math.max(a.scanlines || 0, b.scanlines || 0),
        scanlineBlur: Math.max(a.scanlineBlur || 0, b.scanlineBlur || 0),
        chroma: Math.max(a.chroma || 0, b.chroma || 0),
        vignette: Math.max(a.vignette || 0, b.vignette || 0),
        jitter: Math.max(a.jitter || 0, b.jitter || 0),
        blur: Math.max(a.blur || 0, b.blur || 0),
        grain: Math.max(a.grain || 0, b.grain || 0),
        pixelate: Math.max(a.pixelate || 0, b.pixelate || 0),
        cornerRadius: Math.max(a.cornerRadius || 0, b.cornerRadius || 0)
      };
    }

    function buildMediaOverlayConfigFromOptions(opt) {
      const crt = buildCrtOverlayConfigFromOptions(opt);
      const vhs = buildVhsOverlayConfigFromOptions(opt);
      const film = buildFilmCornerOverlayConfigFromOptions(opt);
      return mergeOverlayConfigs(mergeOverlayConfigs(crt, vhs), film);
    }

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

    function roundedRectPath(ctx, x, y, w, h, r) {
      const radius = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }

    function applyRoundedCornerMask(ctx, rect, radius) {
      if (!radius) return;
      ctx.save();
      ctx.globalCompositeOperation = "destination-in";
      roundedRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
      ctx.fillStyle = "#000";
      ctx.fill();
      ctx.restore();
    }

    const VIDEO_BLACK_BAR_DETECT = Object.freeze({
      sampleMax: 320,
      nearBlackMax: 24,
      blackRatioMin: 0.985,
      maxSideFrac: 0.42,
      minSideFrac: 0.05,
      symmetryTolFrac: 0.04,
      centerMinLuma: 24,
      contrastMinLuma: 10
    });

    function normalizeVideoCrop(crop) {
      if (!crop || typeof crop !== "object") return null;
      const left = clampNumber(crop.left, 0, 0.49, 0);
      const right = clampNumber(crop.right, 0, 0.49, 0);
      const top = clampNumber(crop.top, 0, 0.49, 0);
      const bottom = clampNumber(crop.bottom, 0, 0.49, 0);
      if ((left + right) >= 0.92) return null;
      if ((top + bottom) >= 0.92) return null;
      if (!(left > 0 || right > 0 || top > 0 || bottom > 0)) return null;
      return { left, right, top, bottom };
    }

    function hasVideoCrop(crop) {
      const c = normalizeVideoCrop(crop);
      return !!c;
    }

    function getVideoCropForRecord(rec) {
      if (!rec || rec.type !== "video") return null;
      return normalizeVideoCrop(rec.videoCrop);
    }

    function getVideoCropForTarget(target) {
      if (!target || typeof target !== "object") return null;
      return getVideoCropForRecord(target);
    }

    function computeCroppedSourceRect(srcW, srcH, crop) {
      const c = normalizeVideoCrop(crop);
      if (!c || !(srcW > 0) || !(srcH > 0)) {
        return { sx: 0, sy: 0, sw: srcW, sh: srcH };
      }
      const sx = Math.max(0, Math.min(srcW - 1, Math.round(srcW * c.left)));
      const sy = Math.max(0, Math.min(srcH - 1, Math.round(srcH * c.top)));
      const ex = Math.max(sx + 1, Math.min(srcW, Math.round(srcW * (1 - c.right))));
      const ey = Math.max(sy + 1, Math.min(srcH, Math.round(srcH * (1 - c.bottom))));
      return {
        sx,
        sy,
        sw: Math.max(1, ex - sx),
        sh: Math.max(1, ey - sy)
      };
    }

    function detectStaticVideoBlackBars(videoEl) {
      const w = Number(videoEl?.videoWidth || 0);
      const h = Number(videoEl?.videoHeight || 0);
      if (!(w > 32 && h > 32)) return null;

      const maxDim = VIDEO_BLACK_BAR_DETECT.sampleMax;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const sw = Math.max(32, Math.round(w * scale));
      const sh = Math.max(32, Math.round(h * scale));

      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      try {
        ctx.drawImage(videoEl, 0, 0, sw, sh);
      } catch {
        return null;
      }

      let imageData = null;
      try {
        imageData = ctx.getImageData(0, 0, sw, sh);
      } catch {
        return null;
      }
      const data = imageData.data;
      const nearBlackMax = VIDEO_BLACK_BAR_DETECT.nearBlackMax;
      const ratioMin = VIDEO_BLACK_BAR_DETECT.blackRatioMin;

      const rowStats = (y) => {
        let nearBlack = 0;
        let lumaSum = 0;
        const base = y * sw * 4;
        for (let x = 0; x < sw; x++) {
          const i = base + (x * 4);
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const maxC = Math.max(r, g, b);
          if (maxC <= nearBlackMax) nearBlack++;
          lumaSum += (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
        }
        return {
          ratio: nearBlack / sw,
          luma: lumaSum / sw
        };
      };

      const colStats = (x) => {
        let nearBlack = 0;
        let lumaSum = 0;
        for (let y = 0; y < sh; y++) {
          const i = ((y * sw) + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const maxC = Math.max(r, g, b);
          if (maxC <= nearBlackMax) nearBlack++;
          lumaSum += (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
        }
        return {
          ratio: nearBlack / sh,
          luma: lumaSum / sh
        };
      };

      const limitTopBottom = Math.max(1, Math.floor(sh * VIDEO_BLACK_BAR_DETECT.maxSideFrac));
      const limitLeftRight = Math.max(1, Math.floor(sw * VIDEO_BLACK_BAR_DETECT.maxSideFrac));

      let topPx = 0;
      while (topPx < limitTopBottom) {
        const s = rowStats(topPx);
        if (s.ratio >= ratioMin && s.luma <= nearBlackMax) topPx++;
        else break;
      }
      let bottomPx = 0;
      while (bottomPx < limitTopBottom) {
        const s = rowStats(sh - 1 - bottomPx);
        if (s.ratio >= ratioMin && s.luma <= nearBlackMax) bottomPx++;
        else break;
      }
      let leftPx = 0;
      while (leftPx < limitLeftRight) {
        const s = colStats(leftPx);
        if (s.ratio >= ratioMin && s.luma <= nearBlackMax) leftPx++;
        else break;
      }
      let rightPx = 0;
      while (rightPx < limitLeftRight) {
        const s = colStats(sw - 1 - rightPx);
        if (s.ratio >= ratioMin && s.luma <= nearBlackMax) rightPx++;
        else break;
      }

      const minTopBottom = Math.max(4, Math.round(sh * VIDEO_BLACK_BAR_DETECT.minSideFrac));
      const minLeftRight = Math.max(4, Math.round(sw * VIDEO_BLACK_BAR_DETECT.minSideFrac));
      const symY = Math.max(4, Math.round(sh * VIDEO_BLACK_BAR_DETECT.symmetryTolFrac));
      const symX = Math.max(4, Math.round(sw * VIDEO_BLACK_BAR_DETECT.symmetryTolFrac));

      if (topPx < minTopBottom || bottomPx < minTopBottom || Math.abs(topPx - bottomPx) > symY) {
        topPx = 0;
        bottomPx = 0;
      }
      if (leftPx < minLeftRight || rightPx < minLeftRight || Math.abs(leftPx - rightPx) > symX) {
        leftPx = 0;
        rightPx = 0;
      }

      if (!(topPx || bottomPx || leftPx || rightPx)) return null;

      const contentX = leftPx;
      const contentY = topPx;
      const contentW = sw - leftPx - rightPx;
      const contentH = sh - topPx - bottomPx;
      if (contentW < 16 || contentH < 16) return null;

      let contentLumaSum = 0;
      let contentSamples = 0;
      const xStep = Math.max(1, Math.floor(contentW / 64));
      const yStep = Math.max(1, Math.floor(contentH / 64));
      for (let y = contentY; y < contentY + contentH; y += yStep) {
        for (let x = contentX; x < contentX + contentW; x += xStep) {
          const i = ((y * sw) + x) * 4;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          contentLumaSum += (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
          contentSamples++;
        }
      }
      const contentLuma = contentSamples ? (contentLumaSum / contentSamples) : 0;
      if (contentLuma < VIDEO_BLACK_BAR_DETECT.centerMinLuma) return null;
      if ((contentLuma - nearBlackMax) < VIDEO_BLACK_BAR_DETECT.contrastMinLuma) return null;

      return normalizeVideoCrop({
        left: leftPx / sw,
        right: rightPx / sw,
        top: topPx / sh,
        bottom: bottomPx / sh
      });
    }

    function updateVideoCropFromElement(rec, videoEl) {
      if (!rec || rec.type !== "video" || !videoEl) return false;
      if (hasVideoCrop(rec.videoCrop)) return false;
      const crop = detectStaticVideoBlackBars(videoEl);
      if (!crop) return false;
      rec.videoCrop = crop;
      const cropRect = computeCroppedSourceRect(videoEl.videoWidth || 0, videoEl.videoHeight || 0, crop);
      if (cropRect.sw > 0 && cropRect.sh > 0) {
        rec.previewAspect = normalizePreviewAspect(cropRect.sw / cropRect.sh, rec.previewAspect || (4 / 3));
      }
      if (rec.videoThumbUrl) {
        try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
        rec.videoThumbUrl = null;
        rec.videoThumbMode = null;
      }
      return true;
    }

    function applyVideoCropToElement(videoEl, rec) {
      if (!videoEl) return;
      const crop = getVideoCropForRecord(rec);
      if (!crop) {
        videoEl.style.removeProperty("clip-path");
        videoEl.style.removeProperty("-webkit-clip-path");
        videoEl.style.removeProperty("transform-origin");
        videoEl.style.removeProperty("transform");
        return;
      }
      const xVisible = Math.max(0.08, 1 - crop.left - crop.right);
      const yVisible = Math.max(0.08, 1 - crop.top - crop.bottom);
      const scaleX = 1 / xVisible;
      const scaleY = 1 / yVisible;
      const tx = ((crop.right - crop.left) * 0.5 * scaleX) * 100;
      const ty = ((crop.bottom - crop.top) * 0.5 * scaleY) * 100;
      const topPct = (crop.top * 100).toFixed(4);
      const rightPct = (crop.right * 100).toFixed(4);
      const bottomPct = (crop.bottom * 100).toFixed(4);
      const leftPct = (crop.left * 100).toFixed(4);
      const clip = `inset(${topPct}% ${rightPct}% ${bottomPct}% ${leftPct}%)`;
      videoEl.style.setProperty("clip-path", clip);
      videoEl.style.setProperty("-webkit-clip-path", clip);
      videoEl.style.setProperty("transform-origin", "50% 50%");
      videoEl.style.setProperty("transform", `translate(${tx.toFixed(4)}%, ${ty.toFixed(4)}%) scale(${scaleX.toFixed(6)}, ${scaleY.toFixed(6)})`);
    }

    function getMediaFilterForType() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return (opt && opt.vibrantOverlayEnabled) ? "vibrant" : "off";
    }

    function getMediaFilterIntensity() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const raw = opt ? opt.vibrantOverlayIntensity : 1;
      return clampNumber(raw, 0, 1, 1);
    }

    function parseFilterNumberWithUnit(raw) {
      const m = String(raw || "").trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
      if (!m) return null;
      const value = parseFloat(m[1]);
      if (!Number.isFinite(value)) return null;
      return { value, unit: String(m[2] || "") };
    }

    function scaleCssFilterString(filterText, intensity) {
      const t = clampNumber(intensity, 0, 1, 1);
      const src = String(filterText || "").trim();
      if (!src || src === "none") return "none";
      if (t <= 0) return "none";
      if (t >= 1) return src;
      const re = /([a-z-]+)\(([^)]+)\)/gi;
      const out = [];
      let matched = false;
      let m = null;
      while ((m = re.exec(src)) !== null) {
        matched = true;
        const fn = String(m[1] || "").toLowerCase();
        const argRaw = String(m[2] || "").trim();
        const parsed = parseFilterNumberWithUnit(argRaw);
        if (!parsed) {
          out.push(`${fn}(${argRaw})`);
          continue;
        }
        const unit = parsed.unit;
        const target = parsed.value;
        let ident = null;
        if (fn === "saturate" || fn === "contrast" || fn === "brightness") ident = (unit === "%") ? 100 : 1;
        else if (fn === "hue-rotate") ident = 0;
        else if (fn === "grayscale" || fn === "sepia" || fn === "invert") ident = 0;
        if (ident === null) {
          out.push(`${fn}(${argRaw})`);
          continue;
        }
        const next = ident + (target - ident) * t;
        const shown = (Math.abs(next) >= 100 || Number.isInteger(next)) ? String(Math.round(next)) : next.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
        out.push(`${fn}(${shown}${unit})`);
      }
      if (!matched) return src;
      return out.length ? out.join(" ") : "none";
    }

    function scaleBaseFilterConfig(baseCfg, intensity) {
      if (!baseCfg) return null;
      const t = clampNumber(intensity, 0, 1, 1);
      if (!(t > 0)) return null;
      const out = {};
      for (const key of Object.keys(baseCfg)) {
        const value = baseCfg[key];
        if (key === "color") {
          const scaled = scaleCssFilterString(value, t);
          if (scaled && scaled !== "none") out.color = scaled;
          continue;
        }
        if (key === "forceMonochrome") {
          out.forceMonochrome = !!value && t >= 0.999;
          continue;
        }
        if (typeof value === "number" && Number.isFinite(value)) {
          out[key] = value * t;
          continue;
        }
        out[key] = value;
      }
      return out;
    }

    function buildCanvasFilterValue(colorFilter, blurPx = 0) {
      const color = String(colorFilter || "").trim();
      const hasColor = !!color && color !== "none";
      const blur = Number(blurPx);
      const hasBlur = Number.isFinite(blur) && blur > 0;
      if (hasColor && hasBlur) return `${color} blur(${blur}px)`;
      if (hasColor) return color;
      if (hasBlur) return `blur(${blur}px)`;
      return "none";
    }

    function animatedMediaFiltersMode() {
      return normalizeAnimatedMediaFiltersValue(MEDIA_FILTER_STATE.animatedMode, "on");
    }

    function animatedMediaFiltersEnabledForType(type) {
      const mode = animatedMediaFiltersMode();
      if (mode === "off") return false;
      if (mode === "videos") return type === "video";
      return true;
    }

    function thumbFiltersEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.previewThumbFiltersEnabled);
    }

    function gifsIgnoreProcessingEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.gifsIgnoreProcessing);
    }

    function betaTallImageScrollDetectEnabled() {
      return true;
    }

    function isGifRecord(rec) {
      const ext = String(rec?.ext || "").toLowerCase();
      if (ext === ".gif") return true;
      const mime = String(rec?.file?.type || "").toLowerCase();
      return mime === "image/gif";
    }

    function mediaProcessingEnabledForTarget(target) {
      if (typeof target === "undefined" || target === null) return true;
      if (typeof target === "string") {
        return !isPathOrAncestorProcessingDisabled(target);
      }
      if (target && typeof target === "object") {
        if (isGifRecord(target) && gifsIgnoreProcessingEnabled()) return false;
        if (typeof target.dirPath === "string") return !isPathOrAncestorProcessingDisabled(target.dirPath || "");
        if (typeof target.path === "string") return !isPathOrAncestorProcessingDisabled(target.path || "");
      }
      return true;
    }

    function thumbFiltersActive(target) {
      if (!thumbFiltersEnabled() || !mediaFilterEnabled()) return false;
      return mediaProcessingEnabledForTarget(target);
    }

    function buildThumbFilterKey() {
      if (!thumbFiltersActive()) return "off|none";
      const mode = getMediaFilterForType();
      const intensity = getMediaFilterIntensity();
      const o = MEDIA_OVERLAY_STATE;
      if (!o) return `${mode}|${intensity.toFixed(3)}|none`;
      const vals = [
        o.scanlines || 0,
        o.scanlineBlur || 0,
        o.chroma || 0,
        o.vignette || 0,
        o.jitter || 0,
        o.blur || 0,
        o.grain || 0,
        o.pixelate || 0,
        o.cornerRadius || 0
      ];
      return `${mode}|${intensity.toFixed(3)}|${vals.join(",")}`;
    }

    function crtOverlayEnabled() {
      if (MEDIA_OVERLAY_STATE) return true;
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      MEDIA_OVERLAY_STATE = buildMediaOverlayConfigFromOptions(opt);
      return !!MEDIA_OVERLAY_STATE;
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

    function renderFilteredToCanvas(ctx, source, srcW, srcH, dstW, dstH, mode, cover = true, target = undefined) {
      const allowFilters = thumbFiltersActive(target);
      const intensity = getMediaFilterIntensity();
      const baseCfgRaw = (allowFilters && mode && mode !== "off") ? MEDIA_FILTER_CONFIGS[mode] : null;
      const baseCfg = scaleBaseFilterConfig(baseCfgRaw, intensity);
      const overlayCfg = allowFilters ? MEDIA_OVERLAY_STATE : null;
      const sourceCrop = computeCroppedSourceRect(srcW, srcH, getVideoCropForTarget(target));
      const croppedSrcW = Math.max(1, Number(sourceCrop.sw || srcW || 1));
      const croppedSrcH = Math.max(1, Number(sourceCrop.sh || srcH || 1));
      const drawCropped = (targetCtx, dx, dy, dw, dh) => {
        if (sourceCrop.sw > 0 && sourceCrop.sh > 0) {
          targetCtx.drawImage(source, sourceCrop.sx, sourceCrop.sy, sourceCrop.sw, sourceCrop.sh, dx, dy, dw, dh);
          return;
        }
        targetCtx.drawImage(source, dx, dy, dw, dh);
      };
      const forceMonochrome = !!(allowFilters && baseCfg && baseCfg.forceMonochrome);
      const cfg = (baseCfg || overlayCfg) ? {
        color: baseCfg && baseCfg.color ? baseCfg.color : "none",
        pixelate: Math.max(baseCfg && baseCfg.pixelate ? baseCfg.pixelate : 0, overlayCfg && overlayCfg.pixelate ? overlayCfg.pixelate : 0),
        blur: Math.max(baseCfg && baseCfg.blur ? baseCfg.blur : 0, overlayCfg && overlayCfg.blur ? overlayCfg.blur : 0),
        chroma: Math.max(baseCfg && baseCfg.chroma ? baseCfg.chroma : 0, overlayCfg && overlayCfg.chroma ? overlayCfg.chroma : 0),
        scanlines: Math.max(baseCfg && baseCfg.scanlines ? baseCfg.scanlines : 0, overlayCfg && overlayCfg.scanlines ? overlayCfg.scanlines : 0),
        scanlineBlur: Math.max(baseCfg && baseCfg.scanlineBlur ? baseCfg.scanlineBlur : 0, overlayCfg && overlayCfg.scanlineBlur ? overlayCfg.scanlineBlur : 0),
        grain: Math.max(baseCfg && baseCfg.grain ? baseCfg.grain : 0, overlayCfg && overlayCfg.grain ? overlayCfg.grain : 0),
        vignette: Math.max(baseCfg && baseCfg.vignette ? baseCfg.vignette : 0, overlayCfg && overlayCfg.vignette ? overlayCfg.vignette : 0),
        cornerRadius: Math.max(baseCfg && baseCfg.cornerRadius ? baseCfg.cornerRadius : 0, overlayCfg && overlayCfg.cornerRadius ? overlayCfg.cornerRadius : 0)
      } : null;
      if (!cfg) {
        const rect = cover ? computeCoverRect(croppedSrcW, croppedSrcH, dstW, dstH) : computeContainRect(croppedSrcW, croppedSrcH, dstW, dstH);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, dstW, dstH);
        ctx.filter = "none";
        ctx.imageSmoothingEnabled = true;
        drawCropped(ctx, rect.x, rect.y, rect.w, rect.h);
        return;
      }
      const rect = cover ? computeCoverRect(croppedSrcW, croppedSrcH, dstW, dstH) : computeContainRect(croppedSrcW, croppedSrcH, dstW, dstH);

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
        const smallRect = computeCoverRect(croppedSrcW, croppedSrcH, smallW, smallH);
        offctx.imageSmoothingEnabled = true;
        offctx.filter = buildCanvasFilterValue(colorFilter, cfg.blur || 0);
        drawCropped(offctx, smallRect.x, smallRect.y, smallRect.w, smallRect.h);
        ctx.imageSmoothingEnabled = false;
        ctx.filter = "none";
        ctx.drawImage(off, rect.x, rect.y, rect.w, rect.h);
      } else {
        ctx.imageSmoothingEnabled = true;
        ctx.filter = buildCanvasFilterValue(colorFilter, cfg.blur || 0);
        drawCropped(ctx, rect.x, rect.y, rect.w, rect.h);
      }

      if (cfg.chroma && !forceMonochrome) {
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = 0.18;
        ctx.filter = "none";
        drawCropped(ctx, rect.x + cfg.chroma, rect.y, rect.w, rect.h);
        drawCropped(ctx, rect.x - cfg.chroma, rect.y, rect.w, rect.h);
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

      if (cfg.cornerRadius) {
        const radius = Math.max(0, Math.min(rect.w, rect.h) * cfg.cornerRadius);
        applyRoundedCornerMask(ctx, rect, radius);
      }
    }

    const MediaFilterEngine = (() => {
      const surfaces = new Map();
      let rafId = null;
      const noise = { canvas: null, ctx: null, size: 128, lastTime: 0 };
      const scanlines = { canvas: null, pattern: null, lastCtx: null };
      const GIF_FRAME_FALLBACK_MS = 100;

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

      function gifDecodeSupported() {
        return (typeof ImageDecoder === "function") && (typeof fetch === "function") && (typeof createImageBitmap === "function");
      }

      function closeGifBitmap(bitmap) {
        if (!bitmap) return;
        try { if (typeof bitmap.close === "function") bitmap.close(); } catch {}
      }

      function clearGifState(surface) {
        if (!surface || !surface.gifState) return;
        const state = surface.gifState;
        surface.gifState = null;
        closeGifBitmap(state.bitmap);
        state.bitmap = null;
        try {
          if (state.decoder && typeof state.decoder.close === "function") state.decoder.close();
        } catch {}
        state.decoder = null;
      }

      function ensureGifState(surface, mediaEl) {
        if (!surface || !mediaEl || !gifDecodeSupported()) return null;
        const src = String(mediaEl.currentSrc || mediaEl.src || "").trim();
        if (!src) return null;
        const existing = surface.gifState;
        if (existing && existing.src === src) return existing;

        clearGifState(surface);
        const state = {
          src,
          decoder: null,
          bitmap: null,
          frameCount: 0,
          nextFrameIndex: 0,
          nextDue: 0,
          loading: true,
          decoding: false,
          unsupported: false
        };
        surface.gifState = state;

        (async () => {
          let blob = null;
          try {
            const res = await fetch(src, { cache: "force-cache" });
            if (!res || !res.ok) throw new Error("gif_fetch_failed");
            blob = await res.blob();
          } catch {
            if (surface.gifState === state) state.unsupported = true;
            return;
          }
          if (surface.gifState !== state) return;
          try {
            state.decoder = new ImageDecoder({ data: blob, type: "image/gif" });
          } catch {
            if (surface.gifState === state) state.unsupported = true;
            return;
          }
          try {
            if (state.decoder && state.decoder.tracks && state.decoder.tracks.ready) {
              await state.decoder.tracks.ready;
            }
          } catch {}
          if (surface.gifState !== state) return;
          const fc = Number(state.decoder?.tracks?.selectedTrack?.frameCount || 0);
          state.frameCount = Number.isFinite(fc) && fc > 0 ? fc : 0;
          state.nextFrameIndex = 0;
          state.nextDue = 0;
          requestRender();
        })().finally(() => {
          if (surface.gifState === state) state.loading = false;
        });

        return state;
      }

      function scheduleGifFrameDecode(surface, time) {
        const state = surface && surface.gifState;
        if (!state || state.unsupported || state.loading || state.decoding || !state.decoder) return;
        if (Number.isFinite(state.nextDue) && state.nextDue > 0 && time < state.nextDue) return;
        state.decoding = true;
        const frameIndex = Number.isFinite(state.nextFrameIndex) ? Math.max(0, state.nextFrameIndex | 0) : 0;
        const decoder = state.decoder;

        (async () => {
          let decoded = null;
          try {
            decoded = await decoder.decode({ frameIndex });
          } catch {
            if (surface.gifState !== state) return;
            state.nextFrameIndex = 0;
            state.nextDue = performance.now() + GIF_FRAME_FALLBACK_MS;
            return;
          }
          if (surface.gifState !== state) {
            try { decoded?.image?.close?.(); } catch {}
            return;
          }

          const frame = decoded && decoded.image ? decoded.image : null;
          const durationUs = Number(frame?.duration || 0);
          let bitmap = null;
          if (frame) {
            try { bitmap = await createImageBitmap(frame); } catch {}
            try { frame.close(); } catch {}
          }
          if (surface.gifState !== state) {
            closeGifBitmap(bitmap);
            return;
          }
          if (bitmap) {
            closeGifBitmap(state.bitmap);
            state.bitmap = bitmap;
          }
          if (state.frameCount > 0) state.nextFrameIndex = (frameIndex + 1) % state.frameCount;
          else state.nextFrameIndex = frameIndex + 1;
          const durationMs = durationUs > 0 ? Math.max(8, durationUs / 1000) : GIF_FRAME_FALLBACK_MS;
          state.nextDue = performance.now() + durationMs;
          requestRender();
        })().finally(() => {
          if (surface.gifState === state) state.decoding = false;
        });
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
          target: null,
          type: null,
          filterMode: "off",
          canvas: null,
          ctx: null,
          offscreen: null,
          offctx: null,
          active: false,
          bound: false,
          hasDrawn: false,
          videoFrameActive: false,
          gifState: null
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
        clearGifState(surface);
        if (surface.mediaEl && surface.bound) {
          surface.mediaEl.removeEventListener("load", requestRender);
          surface.mediaEl.removeEventListener("loadeddata", requestRender);
          surface.mediaEl.removeEventListener("play", requestRender);
          surface.mediaEl.removeEventListener("pause", requestRender);
          surface.mediaEl.removeEventListener("seeked", requestRender);
        }
        surface.mediaEl = el;
        surface.bound = true;
        el.addEventListener("load", requestRender);
        el.addEventListener("loadeddata", requestRender);
        el.addEventListener("play", requestRender);
        el.addEventListener("pause", requestRender);
        el.addEventListener("seeked", requestRender);
      }

      function attach(name, mediaEl, container, type, filterMode, target = null) {
        const surface = ensureSurface(name);
        surface.container = container;
        surface.target = target;
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
        if (type !== "image") clearGifState(surface);
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
        surface.target = null;
        surface.hasDrawn = false;
        surface.videoFrameActive = false;
        clearGifState(surface);
        if (surface.canvas) surface.canvas.style.display = "none";
        updateEngineState();
      }

      function reset(name) {
        const surface = surfaces.get(name);
        if (!surface) return;
        surface.active = false;
        surface.target = null;
        surface.hasDrawn = false;
        surface.videoFrameActive = false;
        clearGifState(surface);
        if (surface.canvas && surface.canvas.parentElement) {
          surface.canvas.parentElement.removeChild(surface.canvas);
        }
        surface.canvas = null;
        surface.ctx = null;
        surface.offscreen = null;
        surface.offctx = null;
        if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
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
        const intensity = getMediaFilterIntensity();
        const mode = surface.filterMode || "off";
        const baseCfgRaw = (mode && mode !== "off") ? MEDIA_FILTER_CONFIGS[mode] : null;
        const cfg = scaleBaseFilterConfig(baseCfgRaw, intensity);
        const overlayCfg = MEDIA_OVERLAY_STATE;
        if (!cfg && !overlayCfg) {
          if (surface.canvas) surface.canvas.style.display = "none";
          if (surface.mediaEl) surface.mediaEl.classList.remove("mediaHidden");
          return false;
        }
        if (!surface.mediaEl || !surface.container || !surface.canvas || !surface.ctx) return false;

        const el = surface.mediaEl;
        const isVideo = surface.type === "video";
        const isGifImage = !isVideo && String(el.getAttribute("data-is-gif") || "") === "1";
        if (!isGifImage) clearGifState(surface);
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

        let drawSource = el;
        let srcW = isVideo ? el.videoWidth : el.naturalWidth;
        let srcH = isVideo ? el.videoHeight : el.naturalHeight;
        if (isGifImage) {
          const gifState = ensureGifState(surface, el);
          if (gifState && !gifState.unsupported) {
            scheduleGifFrameDecode(surface, time);
            if (gifState.bitmap && gifState.bitmap.width > 0 && gifState.bitmap.height > 0) {
              drawSource = gifState.bitmap;
              srcW = gifState.bitmap.width;
              srcH = gifState.bitmap.height;
            }
          }
        }
        const sourceCrop = isVideo
          ? computeCroppedSourceRect(srcW, srcH, getVideoCropForTarget(surface.target))
          : { sx: 0, sy: 0, sw: srcW, sh: srcH };
        const croppedSrcW = Math.max(1, Number(sourceCrop.sw || srcW || 1));
        const croppedSrcH = Math.max(1, Number(sourceCrop.sh || srcH || 1));
        const drawCropped = (targetCtx, dx2, dy2, dw2, dh2) => {
          if (sourceCrop.sw > 0 && sourceCrop.sh > 0) {
            targetCtx.drawImage(drawSource, sourceCrop.sx, sourceCrop.sy, sourceCrop.sw, sourceCrop.sh, dx2, dy2, dw2, dh2);
            return;
          }
          targetCtx.drawImage(drawSource, dx2, dy2, dw2, dh2);
        };
        const rect = computeContainRect(croppedSrcW, croppedSrcH, cw, ch);
        const animatedForSurface = animatedMediaFiltersEnabledForType(surface.type);

        const jitterStrength = Math.max((cfg && cfg.jitter) ? cfg.jitter : 0, (overlayCfg && overlayCfg.jitter) ? overlayCfg.jitter : 0);
        const jitter = jitterStrength ? (animatedForSurface ? Math.sin(time * 0.005) * jitterStrength : 0) : 0;
        const dx = rect.x + jitter;
        const dy = rect.y;

        const colorFilter = (cfg && cfg.color && cfg.color !== "none") ? cfg.color : "none";
        let drew = false;
        try {
          const pixelateBase = (overlayCfg && overlayCfg.pixelate) ? Math.max(2, overlayCfg.pixelate) : (cfg && cfg.pixelate ? Math.max(2, cfg.pixelate) : 0);
          if (pixelateBase) {
            const scale = pixelateBase;
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
            drawCropped(surface.offctx, 0, 0, smallW, smallH);
            ctx.imageSmoothingEnabled = false;
            ctx.filter = colorFilter;
            ctx.drawImage(surface.offscreen, dx, dy, rect.w, rect.h);
          } else {
            ctx.imageSmoothingEnabled = true;
            const blur = overlayCfg && overlayCfg.blur ? overlayCfg.blur : (cfg && cfg.blur ? cfg.blur : 0);
            ctx.filter = buildCanvasFilterValue(colorFilter, blur);
            drawCropped(ctx, dx, dy, rect.w, rect.h);
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
          drawCropped(ctx, dx + chroma, dy, rect.w, rect.h);
          drawCropped(ctx, dx - chroma, dy, rect.w, rect.h);
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
            if (animatedForSurface) {
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
          if (animatedForSurface) {
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

        const cornerRadius = overlayCfg && overlayCfg.cornerRadius ? overlayCfg.cornerRadius : (cfg && cfg.cornerRadius ? cfg.cornerRadius : 0);
        if (cornerRadius) {
          const radius = Math.max(0, Math.min(rect.w, rect.h) * cornerRadius);
          applyRoundedCornerMask(ctx, { x: dx, y: dy, w: rect.w, h: rect.h }, radius);
        }

        surface.canvas.style.display = "block";
        surface.canvas.classList.add("ready");
        surface.hasDrawn = true;
        if (surface.mediaEl) {
          if (isGifImage) surface.mediaEl.classList.remove("mediaHidden");
          else surface.mediaEl.classList.add("mediaHidden");
        }

        const needsAnim = animatedForSurface && (
          (cfg && (cfg.grain || cfg.scanlines || cfg.jitter || cfg.chroma))
          || (overlayCfg && (overlayCfg.grain || overlayCfg.scanlines || overlayCfg.jitter || overlayCfg.chroma))
        );
        if (isVideo) {
          if (surface.videoFrameActive) {
            return needsAnim;
          }
          if (!el.paused) return true;
          return needsAnim;
        }
        if (isGifImage) return true;
        return needsAnim;
      }

      return {
        attach,
        detach,
        reset,
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
      const base = applyDisplayNameRules(parts.base || "", opt, { isFile: true });
      return `${base}${parts.ext || ""}`;
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

    function getInteractionModeFromOptions(opt = null) {
      const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
      return (String(src && src.interactionMode || "grid").toLowerCase() === "pane") ? "pane" : "grid";
    }

    function isGridInteractionMode() {
      return getInteractionModeFromOptions() === "grid";
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
      if (isGridInteractionMode()) {
        if (m === "tiny") return 120;
        if (m === "small") return 220;
        if (m === "high") return 900;
        return 420;
      }
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
      WS.view.randomFolderMode = false;
      WS.view.randomCache = new Map();
      WS.view.randomFolderCache = new Map();
      WS.view.folderBehavior = normalizeFolderBehavior(opt.defaultFolderBehavior, "slide");
      WS.view.folderScoreDisplay = (opt.folderScoreDisplay === "show" || opt.folderScoreDisplay === "no-arrows" || opt.folderScoreDisplay === "hidden") ? opt.folderScoreDisplay : "hidden";
      applyColorSchemeFromOptions();
      applyTagFolderTitleColorsFromOptions();
    }

    function applyColorSchemeFromOptions() {
      const root = document.documentElement;
      if (!root) return;
      root.setAttribute("data-theme", "superdark");
    }

    function applyTagFolderTitleColorsFromOptions() {
      const root = document.documentElement;
      if (!root) return;
      const pair = getTagFolderTitleColorPairByValue(TAG_FOLDER_TITLE_COLOR_PAIR_DEFAULT);
      const tagColor = String(pair && pair.tag ? pair.tag : "#ff9300");
      const favoriteColor = String(pair && pair.favorite ? pair.favorite : "#ff43b5");
      const albumColor = "#ff6b63";
      root.style.setProperty("--dir-tag-title-color", tagColor);
      root.style.setProperty("--dir-tag-favorite-title-color", favoriteColor);
      root.style.setProperty("--dir-tag-album-title-color", albumColor);
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
      const prevFilterMode = MEDIA_FILTER_STATE.mode || "off";
      MEDIA_OVERLAY_STATE = buildMediaOverlayConfigFromOptions(opt);
      const appEl = document.getElementById("app");
      if (!appEl) return;
      const filter = getMediaFilterForType();
      if (filter && filter !== "off") appEl.setAttribute("data-media-filter", "vibrant-overlay");
      else appEl.removeAttribute("data-media-filter");
      const root = document.documentElement;
      if (root) {
        root.style.setProperty("--thumb-filter", "none");
      }
      MEDIA_FILTER_STATE.mode = filter || "off";
      MEDIA_FILTER_STATE.animatedMode = normalizeAnimatedMediaFiltersValue(opt ? opt.animatedMediaFilters : null, "on");
      if (prevFilterMode !== MEDIA_FILTER_STATE.mode) {
        MediaFilterEngine.detach("preview");
        MediaFilterEngine.detach("viewer");
      }
      const nextThumbKey = buildThumbFilterKey();
      if (nextThumbKey !== THUMB_FILTER_KEY) {
        THUMB_FILTER_KEY = nextThumbKey;
        if (WS.root) {
          invalidateAllThumbs();
          renderPreviewPane(false, true);
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      }
      const filtersActive = mediaFilterEnabled();
      if (!filtersActive) {
        MediaFilterEngine.reset("preview");
        MediaFilterEngine.reset("viewer");
        if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
        if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
        if (viewerImgEl) viewerImgEl.classList.remove("mediaHidden");
        if (viewerVideoEl) viewerVideoEl.classList.remove("mediaHidden");
        applyScrollImageProcessingFallback(previewImgEl, null, "none");
        applyScrollImageProcessingFallback(viewerImgEl, null, "none");
        appEl.removeAttribute("data-media-filter-engine");
      } else {
        const activeViewerItem = viewerItems && viewerItems.length ? (viewerItems[viewerIndex] || null) : null;
        const viewerRec = (activeViewerItem && !activeViewerItem.isFolder) ? (WS.fileById.get(activeViewerItem.id) || null) : null;
        const previewRec = (WS.preview && WS.preview.kind === "file" && WS.preview.fileId)
          ? (WS.fileById.get(WS.preview.fileId) || null)
          : null;
        if (VIEWER_MODE) {
          if (viewerVideoEl && viewerVideoEl.style.display !== "none") {
            syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video", viewerRec);
          } else if (viewerImgEl && viewerImgEl.style.display !== "none") {
            const mode = detectScrollImageMode(viewerRec, viewerImgEl);
            if (mode !== "none") {
              clearMediaFilterSurface("viewer", viewerImgEl);
              applyScrollImageProcessingFallback(viewerImgEl, viewerRec, mode);
            } else {
              applyScrollImageProcessingFallback(viewerImgEl, viewerRec, "none");
              syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", viewerRec);
            }
          }
        }
        if (ACTIVE_MEDIA_SURFACE === "preview") {
          if (previewVideoEl && previewVideoEl.style.display !== "none") {
            syncMediaFilterSurface("preview", previewVideoEl, previewViewportBox, "video", previewRec);
          } else if (previewImgEl && previewImgEl.style.display !== "none") {
            const mode = detectScrollImageMode(previewRec, previewImgEl);
            if (mode !== "none") {
              clearMediaFilterSurface("preview", previewImgEl);
              applyScrollImageProcessingFallback(previewImgEl, previewRec, mode);
            } else {
              applyScrollImageProcessingFallback(previewImgEl, previewRec, "none");
              syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image", previewRec);
            }
          }
        }
      }
      MediaFilterEngine.requestRender();
    }

    function applyThumbFitFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const fit = previewThumbFitMode();
      const useContain = fit === "contain";
      root.style.setProperty("--thumb-fit", useContain ? "contain" : "cover");
      root.style.setProperty("--thumb-bg", "transparent");
      if (useContain) root.setAttribute("data-thumb-fit", "contain");
      else root.removeAttribute("data-thumb-fit");
    }

    function previewThumbFitMode() {
      if (naturalAspectThumbnailCardsEnabled()) return "contain";
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const fit = opt ? String(opt.previewThumbFit || "cover") : "cover";
      return fit === "contain" ? "contain" : "cover";
    }

    function getThumbnailStyleFromOptions(opt = null) {
      if (!ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE) return "cropped";
      const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
      const raw = String(src && src.thumbnailStyle || "cropped").toLowerCase();
      return raw === "aspect" ? "aspect" : "cropped";
    }

    function getThumbnailScaleForStyle(style, opt = null) {
      const src = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
      const s = style === "aspect" ? "aspect" : "cropped";
      const fallback = s === "aspect" ? "small" : "medium";
      const key = s === "aspect" ? "thumbnailScaleAspect" : "thumbnailScaleCropped";
      return normalizeThumbnailScaleValue(src ? src[key] : null, fallback);
    }

    function getActiveThumbnailScale(opt = null) {
      const style = getThumbnailStyleFromOptions(opt);
      return getThumbnailScaleForStyle(style, opt);
    }

    function getActiveThumbnailScaleMultiplier(opt = null) {
      const style = getThumbnailStyleFromOptions(opt);
      const scale = getThumbnailScaleForStyle(style, opt);
      if (style === "aspect") {
        // Shift aspect scales upward so previous XXL maps to Medium.
        if (scale === "small") return 1.52;
        if (scale === "medium") return 1.72;
        if (scale === "large") return 1.94;
        if (scale === "xl") return 2.18;
        if (scale === "xxl") return 2.44;
        if (scale === "xxxl") return 2.72;
        return 1.72;
      }
      if (scale === "small") return 0.86;
      if (scale === "large") return 1.18;
      if (scale === "xl") return 1.34;
      if (scale === "xxl") return 1.52;
      if (scale === "xxxl") return 1.72;
      return 1;
    }

    function naturalAspectThumbnailCardsEnabled() {
      return getThumbnailStyleFromOptions() === "aspect";
    }

    function previewSquareMediaThumbsEnabled() {
      return !naturalAspectThumbnailCardsEnabled();
    }

    function mediaFilterEnabled() {
      const mode = getMediaFilterForType();
      const intensity = getMediaFilterIntensity();
      const baseFilterOn = (mode && mode !== "off" && !!MEDIA_FILTER_CONFIGS[mode] && intensity > 0);
      return !!baseFilterOn || crtOverlayEnabled();
    }

    function formatBytes(bytes) {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return "0 B";
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = n;
      let idx = 0;
      while (value >= 1024 && idx < units.length - 1) {
        value /= 1024;
        idx++;
      }
      const shown = value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1);
      return `${shown} ${units[idx]}`;
    }

    function syncMediaFilterSurface(surfaceName, mediaEl, container, type, target = undefined) {
      if (!mediaEl || !container) return;
      let processingTarget = target;
      if (typeof processingTarget === "undefined") {
        if (mediaEl.hasAttribute("data-dir-path")) {
          processingTarget = mediaEl.getAttribute("data-dir-path") || "";
        } else {
          processingTarget = null;
        }
      }
      if (!mediaFilterEnabled() || !mediaProcessingEnabledForTarget(processingTarget)) {
        mediaEl.classList.remove("mediaHidden");
        MediaFilterEngine.detach(surfaceName);
        return;
      }
      MediaFilterEngine.attach(surfaceName, mediaEl, container, type, getMediaFilterForType(), processingTarget);
    }

    function clearPendingFilmCornerMask(mediaEl) {
      if (!mediaEl) return;
      mediaEl.classList.remove("pendingFilmCorners");
      mediaEl.style.removeProperty("--pending-film-corner-radius");
    }

    function applyPendingFilmCornerMask(mediaEl, processingTarget = null) {
      if (!mediaEl) return;
      clearPendingFilmCornerMask(mediaEl);
      if (!mediaFilterEnabled()) return;
      if (!mediaProcessingEnabledForTarget(processingTarget)) return;
      const cornerRadius = Number((MEDIA_OVERLAY_STATE && MEDIA_OVERLAY_STATE.cornerRadius) || 0);
      if (!(cornerRadius > 0)) return;
      const pct = Math.max(0, Math.min(50, cornerRadius * 100));
      mediaEl.style.setProperty("--pending-film-corner-radius", `${pct}%`);
      mediaEl.classList.add("pendingFilmCorners");
    }

    function clearMediaFilterSurface(surfaceName, mediaEl) {
      MediaFilterEngine.detach(surfaceName);
      clearPendingFilmCornerMask(mediaEl);
      if (mediaEl) mediaEl.classList.remove("mediaHidden");
    }

    function applyDisplaySizesFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const root = document.documentElement;
      if (!root) return;
      const mediaSize = opt ? String(opt.mediaThumbUiSize || "medium") : "medium";
      const folderSize = opt ? String(opt.folderPreviewSize || "medium") : "medium";
      const scaleMult = getActiveThumbnailScaleMultiplier(opt);
      if (mediaSize === "medium") root.removeAttribute("data-media-size");
      else root.setAttribute("data-media-size", mediaSize);
      if (folderSize === "medium") root.removeAttribute("data-folder-size");
      else root.setAttribute("data-folder-size", folderSize);
      root.style.setProperty("--thumb-scale-media", String(scaleMult));
      root.style.setProperty("--thumb-scale-folder", String(scaleMult));
    }

    function applyDirectoryMiniThumbSizeFromOptions() {
      const root = document.documentElement;
      if (!root) return;
      const px = 120;
      root.style.setProperty("--dir-mini-thumb-h", `${px}px`);
    }

    function applyDirectoryFileThumbLayoutFromOptions() {
      const root = document.documentElement;
      if (!root) return;
      root.setAttribute("data-dir-file-thumb-layout", "full-card");
    }

    function applyDirectoryFolderCardLayoutFromOptions() {
      const root = document.documentElement;
      if (!root) return;
      root.setAttribute("data-dir-folder-card-layout", "square");
    }

    function applyNaturalAspectThumbnailModeFromOptions() {
      const root = document.documentElement;
      if (!root) return;
      if (naturalAspectThumbnailCardsEnabled()) root.setAttribute("data-natural-thumb-cards", "on");
      else root.removeAttribute("data-natural-thumb-cards");
    }

    function applyInteractionModeFromOptions() {
      const appEl = document.getElementById("app");
      if (!appEl) return;
      const grid = isGridInteractionMode();
      appEl.classList.toggle("grid-mode", grid);
      updateGridModeListTopInset();
    }

    function applyOptionsEverywhere(invalidateThumbs = false) {
      if (!WS.root) {
        applyColorSchemeFromOptions();
        applyTagFolderTitleColorsFromOptions();
        applyRetroModeFromOptions();
        applyMediaFilterFromOptions();
        applyThumbFitFromOptions();
        applyDisplaySizesFromOptions();
        applyDirectoryMiniThumbSizeFromOptions();
        applyDirectoryFileThumbLayoutFromOptions();
        applyDirectoryFolderCardLayoutFromOptions();
        applyNaturalAspectThumbnailModeFromOptions();
        applyInteractionModeFromOptions();
        applyDescriptionVisibilityFromOptions();
        applyPaneDividerFromOptions();
        syncButtons();
        return;
      }

      if (invalidateThumbs) {
        invalidateAllThumbs();
      }

      applyColorSchemeFromOptions();
      applyTagFolderTitleColorsFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyThumbFitFromOptions();
      applyDisplaySizesFromOptions();
      applyDirectoryMiniThumbSizeFromOptions();
      applyDirectoryFileThumbLayoutFromOptions();
      applyDirectoryFolderCardLayoutFromOptions();
      applyNaturalAspectThumbnailModeFromOptions();
      applyInteractionModeFromOptions();
      applyDescriptionVisibilityFromOptions();
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

    function applyDescriptionVisibilityFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const hideOptionDescriptions = !!(opt && opt.hideOptionDescriptions);
      const hideKeybindDescriptions = !!(opt && opt.hideKeybindDescriptions);
      const optionsBody = document.getElementById("optionsBody");
      const keybindsBody = document.getElementById("keybindsBody");
      if (optionsBody) optionsBody.classList.toggle("hideHints", hideOptionDescriptions);
      if (keybindsBody) keybindsBody.classList.toggle("hideHints", hideKeybindDescriptions);
    }

    function applyPaneDividerFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const pct = (opt && typeof opt.leftPaneWidthPct === 'number') ? opt.leftPaneWidthPct : (opt && !Number.isNaN(parseFloat(opt.leftPaneWidthPct)) ? parseFloat(opt.leftPaneWidthPct) : 0.28);
      setDividerPositionFromPct(pct);
    }

    function setDividerPositionFromPct(pct) {
      const appEl = document.getElementById("app");
      if (!appEl) return;
      if (isGridInteractionMode()) {
        appEl.style.removeProperty("grid-template-columns");
        const dividerEl = document.getElementById("divider");
        if (dividerEl) dividerEl.style.removeProperty("left");
        MediaFilterEngine.requestRender();
        return;
      }
      pct = Math.max(0.05, Math.min(0.9, Number(pct) || 0.28));
      appEl.style.gridTemplateColumns = `${(pct * 100).toFixed(2)}% 1fr`;
      const dividerEl = document.getElementById("divider");
      if (dividerEl) {
        const left = Math.round(appEl.clientWidth * pct);
        dividerEl.style.left = left + "px";
      }
      // Keep filtered preview/video canvases in sync with live pane geometry while dragging the divider.
      MediaFilterEngine.requestRender();
    }

    const SAFE_KEY_VALUES = (() => {
      const out = [];
      for (let i = 0; i < 26; i++) out.push(String.fromCharCode(97 + i));
      for (let i = 0; i < 10; i++) out.push(String(i));
      out.push("Space");
      out.push("Tab");
      out.push("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown");
      return out;
    })();

    const SAFE_KEY_SET = new Set(SAFE_KEY_VALUES);
    const KEY_MODIFIER_ORDER = ["Cmd", "Ctrl", "Alt", "Shift"];
    const MODIFIER_KEY_STATE = {
      Cmd: false,
      Ctrl: false,
      Alt: false,
      Shift: false
    };
    const KEY_MODIFIER_LABELS = Object.freeze({
      Cmd: "Command",
      Ctrl: "Control",
      Alt: "Option",
      Shift: "Shift"
    });
    const MODIFIER_ALIASES = Object.freeze({
      command: "Cmd",
      cmd: "Cmd",
      meta: "Cmd",
      control: "Ctrl",
      ctrl: "Ctrl",
      option: "Alt",
      opt: "Alt",
      alt: "Alt",
      shift: "Shift"
    });

    const KEY_LABELS = {
      Escape: "Escape",
      Space: "Space",
      Tab: "Tab",
      ArrowLeft: "Left Arrow",
      ArrowRight: "Right Arrow",
      ArrowUp: "Up Arrow",
      ArrowDown: "Down Arrow",
      "=": "+ / =",
      "-": "- / _"
    };

    const SHIFT_DIGIT_SYMBOL_TO_KEY = Object.freeze({
      "!": "1",
      "@": "2",
      "#": "3",
      "$": "4",
      "%": "5",
      "^": "6",
      "&": "7",
      "*": "8",
      "(": "9",
      ")": "0"
    });

    function syncModifierKeyStateFromEvent(e) {
      if (!e) return;
      MODIFIER_KEY_STATE.Cmd = !!e.metaKey;
      MODIFIER_KEY_STATE.Ctrl = !!e.ctrlKey;
      MODIFIER_KEY_STATE.Alt = !!e.altKey;
      MODIFIER_KEY_STATE.Shift = !!e.shiftKey;
    }

    function clearModifierKeyState() {
      MODIFIER_KEY_STATE.Cmd = false;
      MODIFIER_KEY_STATE.Ctrl = false;
      MODIFIER_KEY_STATE.Alt = false;
      MODIFIER_KEY_STATE.Shift = false;
    }

    function eventShiftHeld(e) {
      return !!((e && e.shiftKey) || MODIFIER_KEY_STATE.Shift);
    }

    function eventCmdOrCtrlHeld(e) {
      return !!((e && (e.metaKey || e.ctrlKey)) || MODIFIER_KEY_STATE.Cmd || MODIFIER_KEY_STATE.Ctrl);
    }

    function normalizeBaseKeyValue(key) {
      if (!key && key !== 0) return "";
      const raw = String(key);
      if (!raw) return "";
      if (raw === " ") return "Space";
      if (raw === "+" || raw === "=") return "=";
      if (raw === "_" || raw === "-") return "-";
      if (SHIFT_DIGIT_SYMBOL_TO_KEY[raw]) return SHIFT_DIGIT_SYMBOL_TO_KEY[raw];
      if (/^space$/i.test(raw)) return "Space";
      if (/^escape$/i.test(raw) || /^esc$/i.test(raw)) return "Escape";
      if (raw.length === 1) return raw.toLowerCase();
      return raw;
    }

    function normalizeKeyValue(key) {
      if (!key && key !== 0) return "";
      const raw = String(key).trim();
      if (!raw) return "";
      const parts = raw.split("+").map(part => String(part || "").trim()).filter(Boolean);
      if (!parts.length) return "";
      const mods = { Cmd: false, Ctrl: false, Alt: false, Shift: false };
      let base = "";
      for (const partRaw of parts) {
        const part = String(partRaw || "").trim();
        if (!part) continue;
        const mod = MODIFIER_ALIASES[part.toLowerCase()] || "";
        if (mod) {
          mods[mod] = true;
          continue;
        }
        base = normalizeBaseKeyValue(part);
      }
      if (!base) return "";
      if (base === "=" || base === "-" || base === "Escape") return base;
      const modParts = KEY_MODIFIER_ORDER.filter(mod => mods[mod]);
      return modParts.length ? `${modParts.join("+")}+${base}` : base;
    }

    function parseKeybindValue(value) {
      const norm = normalizeKeyValue(value);
      const parsed = {
        key: "",
        mods: { Cmd: false, Ctrl: false, Alt: false, Shift: false }
      };
      if (!norm) return parsed;
      const parts = norm.split("+").filter(Boolean);
      if (!parts.length) return parsed;
      const base = parts[parts.length - 1];
      parsed.key = base;
      for (let i = 0; i < parts.length - 1; i++) {
        const mod = parts[i];
        if (parsed.mods.hasOwnProperty(mod)) parsed.mods[mod] = true;
      }
      return parsed;
    }

    function buildKeybindValue(baseKey, modifiers = null) {
      const base = normalizeBaseKeyValue(baseKey);
      if (!base) return "";
      if (base === "=" || base === "-" || base === "Escape") return base;
      const mods = {
        Cmd: !!(modifiers && modifiers.Cmd),
        Ctrl: !!(modifiers && modifiers.Ctrl),
        Alt: !!(modifiers && modifiers.Alt),
        Shift: !!(modifiers && modifiers.Shift)
      };
      const modParts = KEY_MODIFIER_ORDER.filter(mod => mods[mod]);
      return modParts.length ? `${modParts.join("+")}+${base}` : base;
    }

    function keybindValueFromEvent(e) {
      if (!e) return "";
      const keyRaw = String(e.key || "");
      const codeRaw = String(e.code || "");
      if (!keyRaw && !codeRaw) return "";
      if (keyRaw === "Meta" || keyRaw === "Control" || keyRaw === "Alt" || keyRaw === "Shift") return "";
      const mods = {
        Cmd: !!e.metaKey,
        Ctrl: !!e.ctrlKey,
        Alt: !!e.altKey,
        Shift: !!e.shiftKey
      };

      let base = "";
      if (/^Key[A-Z]$/.test(codeRaw)) {
        base = codeRaw.slice(3).toLowerCase();
      } else if (/^Digit[0-9]$/.test(codeRaw)) {
        base = codeRaw.slice(5);
      } else if (codeRaw === "Space") {
        base = "Space";
      } else if (codeRaw === "Escape") {
        base = "Escape";
      } else if (codeRaw === "Equal") {
        base = "=";
      } else if (codeRaw === "Minus") {
        base = "-";
      } else {
        const shiftedDigitBase = SHIFT_DIGIT_SYMBOL_TO_KEY[keyRaw];
        if (shiftedDigitBase) return buildKeybindValue(shiftedDigitBase, Object.assign({}, mods, { Shift: true }));
        base = normalizeBaseKeyValue(keyRaw);
      }

      if (!base) return "";
      if (base === "=" || base === "-" || base === "Escape") return base;
      return buildKeybindValue(base, mods);
    }

    function isSafeKey(key) {
      const base = normalizeBaseKeyValue(key);
      return SAFE_KEY_SET.has(base);
    }

    function isSafeKeybindValue(keybind) {
      const parsed = parseKeybindValue(keybind);
      if (!parsed.key) return true;
      return isSafeKey(parsed.key);
    }

    function keyLabel(key) {
      if (!key) return "Unassigned";
      const norm = normalizeKeyValue(key);
      const parsed = parseKeybindValue(norm);
      if (!parsed.key) return "Unassigned";
      const modText = KEY_MODIFIER_ORDER
        .filter(mod => parsed.mods[mod])
        .map(mod => KEY_MODIFIER_LABELS[mod] || mod)
        .join("+");
      const base = KEY_LABELS[parsed.key]
        ? KEY_LABELS[parsed.key]
        : (parsed.key.length === 1 ? parsed.key.toUpperCase() : parsed.key);
      return modText ? `${modText}+${base}` : base;
    }

    const KEYBIND_SECTIONS = [
      { id: "navigation", label: "Navigation" },
      { id: "media", label: "Media" },
      { id: "jump", label: "Jump" },
      { id: "history", label: "History" },
      { id: "global", label: "Global" },
      { id: "extras", label: "Odds & Ends" }
    ];

    const KEYBIND_ACTIONS = [
      { id: "selectUp", label: "Up selection", hint: "Move selection up.", section: "navigation" },
      { id: "selectDown", label: "Down selection", hint: "Move selection down.", section: "navigation" },
      { id: "leaveDir", label: "Up directory", hint: "Go to the parent directory.", section: "navigation" },
      { id: "enterDir", label: "Enter directory", hint: "Enter a folder or open gallery for a file.", section: "navigation" },
      { id: "prevFolder", label: "Previous folder", hint: "Jump to the previous folder's first file.", section: "navigation" },
      { id: "nextFolder", label: "Next folder", hint: "Jump to the next folder's first file.", section: "navigation" },
      { id: "randomJump", label: "Random action", hint: "Run the configured random action behavior.", section: "navigation" },
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
      { id: "back", label: "Back/Close", hint: "Close overlays or back out of special modes.", section: "global" },
      { id: "toggleVibrantOverlay", label: "Toggle vibrant overlay", hint: "Toggle the Vibrant color overlay.", section: "extras" },
      { id: "stepVibrantOverlayIntensity", label: "Step vibrant overlay intensity", hint: "Increase vibrant overlay intensity by one step, wrapping to minimum.", section: "extras" },
      { id: "cycleColorScheme", label: "Cycle color scheme", hint: "Cycle the UI color scheme.", section: "extras" },
      { id: "toggleScanlinesOverlay", label: "Toggle scanline overlay", hint: "Toggle CRT scanlines over media.", section: "extras" },
      { id: "togglePixelatedOverlay", label: "Toggle pixelated overlay", hint: "Toggle pixelated media overlay.", section: "extras" },
      { id: "stepPixelationResolution", label: "Step pixelation resolution", hint: "Increase pixelation resolution by one step, wrapping to minimum.", section: "extras" },
      { id: "toggleFilmGrainOverlay", label: "Toggle film grain overlay", hint: "Toggle film grain overlay.", section: "extras" },
      { id: "stepFilmGrainAmount", label: "Step film grain amount", hint: "Increase film grain amount by one step, wrapping to minimum.", section: "extras" },
      { id: "toggleVhsOverlay", label: "Toggle VHS overlay", hint: "Toggle VHS overlay.", section: "extras" },
      { id: "toggleFilmCornersOverlay", label: "Toggle film corners overlay", hint: "Toggle rounded film corners overlay.", section: "extras" },
      { id: "stepVhsIntensity", label: "Step VHS intensity", hint: "Increase VHS intensity by one step, wrapping to minimum.", section: "extras" },
      { id: "toggleAnimatedFilters", label: "Cycle animated filters", hint: "Cycle animated filters: Off, On, Videos only.", section: "extras" },
      { id: "cycleFolderSort", label: "Cycle folder sort", hint: "Cycle folder sort mode.", section: "extras" },
      { id: "toggleShowHiddenFolder", label: "Toggle hidden folder", hint: "Toggle the Hidden folder tag entry.", section: "extras" },
      { id: "toggleShowUntaggedFolder", label: "Toggle untagged folder", hint: "Toggle the Untagged folder tag entry.", section: "extras" },
      { id: "toggleForceTitleCaps", label: "Toggle force Title Case", hint: "Toggle Title Case for displayed file names.", section: "extras" },
      { id: "toggleHideBeforeLastDash", label: "Toggle hide name before last dash", hint: "Toggle hiding everything before the last ' - ' in names.", section: "extras" },
      { id: "toggleHideAfterFirstUnderscore", label: "Toggle hide name after last underscore", hint: "Toggle hiding everything after the last underscore in file names.", section: "extras" },
      { id: "scoreUpSelection", label: "Increase folder score", hint: "Increase score for selected/current folder(s).", section: "extras" },
      { id: "scoreDownSelection", label: "Decrease folder score", hint: "Decrease score for selected/current folder(s).", section: "extras" },
      { id: "tagSelection", label: "Tag folder selection", hint: "Start tag edit for selected/current folder(s).", section: "extras" },
      { id: "favoriteSelection", label: "Favorite folder selection", hint: "Favorite or unfavorite selected/current folder(s).", section: "extras" },
      { id: "renameFolderSelection", label: "Rename selected folder", hint: "Start renaming the selected/current folder.", section: "extras" },
      { id: "renameFileSelection", label: "Rename selected file", hint: "Start renaming the selected/current file.", section: "extras" },
      { id: "moveThumbViewportLeft", label: "Move thumbnail viewport left", hint: "Move thumbnail framing left for the selected item's source thumbnail.", section: "extras" },
      { id: "moveThumbViewportRight", label: "Move thumbnail viewport right", hint: "Move thumbnail framing right for the selected item's source thumbnail.", section: "extras" },
      { id: "moveThumbViewportUp", label: "Move thumbnail viewport up", hint: "Move thumbnail framing up for the selected item's source thumbnail.", section: "extras" },
      { id: "moveThumbViewportDown", label: "Move thumbnail viewport down", hint: "Move thumbnail framing down for the selected item's source thumbnail.", section: "extras" }
    ];

    const GRID_KEYBIND_SECTIONS = [
      { id: "gridnav", label: "Grid Navigation" },
      { id: "gridgallery", label: "Grid Gallery" }
    ];

    const GRID_KEYBIND_ACTIONS = [
      { id: "gridMoveUp", label: "Move selection up", hint: "Move grid selection up.", section: "gridnav" },
      { id: "gridMoveDown", label: "Move selection down", hint: "Move grid selection down.", section: "gridnav" },
      { id: "gridMoveLeft", label: "Move selection left", hint: "Move grid selection left.", section: "gridnav" },
      { id: "gridMoveRight", label: "Move selection right", hint: "Move grid selection right.", section: "gridnav" },
      { id: "gridOpenSelection", label: "Open selection", hint: "Open selected item in grid mode.", section: "gridnav" },
      { id: "gridUpDirectory", label: "Up directory", hint: "Go to parent directory in grid mode.", section: "gridnav" },
      { id: "gridGalleryPrev", label: "Previous media", hint: "In gallery, move to previous media.", section: "gridgallery" },
      { id: "gridGalleryNext", label: "Next media", hint: "In gallery, move to next media.", section: "gridgallery" },
      { id: "gridGalleryBack", label: "Back from gallery", hint: "Exit gallery to the prior grid context.", section: "gridgallery" }
    ];

    const KEYBIND_LOCKED_ACTIONS = Object.freeze({
      playPause: "Space",
      back: "Escape",
      scoreUpSelection: "=",
      scoreDownSelection: "-"
    });
    const KEYBIND_LOCKED_IDS = new Set(Object.keys(KEYBIND_LOCKED_ACTIONS));

    function lockedKeyForAction(actionId) {
      return normalizeKeyValue(KEYBIND_LOCKED_ACTIONS[actionId] || "");
    }

    function isLockedKeybindAction(actionId) {
      return KEYBIND_LOCKED_IDS.has(actionId);
    }

    function isKeyReservedForLockedAction(key, excludeActionId = "") {
      const norm = normalizeKeyValue(key);
      if (!norm) return false;
      for (const [id, fixed] of Object.entries(KEYBIND_LOCKED_ACTIONS)) {
        if (id === excludeActionId) continue;
        if (normalizeKeyValue(fixed) === norm) return true;
      }
      return false;
    }

    const KEYBIND_DEFAULT_BINDINGS = Object.freeze({
      selectUp: "w",
      selectDown: "s",
      leaveDir: "a",
      enterDir: "d",
      prevFolder: "Command+w",
      nextFolder: "Command+s",
      randomJump: "x",
      cycleFilter: "Command+x",
      slideshow: "Command+Shift+x",
      seekBack: "q",
      seekForward: "e",
      playPause: "Space",
      muteToggle: "m",
      jumpMinus50: "Command+Shift+w",
      jumpMinus10: "Shift+w",
      jumpPlus10: "Shift+s",
      jumpPlus50: "Command+Shift+s",
      historyBack: "",
      historyForward: "",
      panic: "g",
      back: "Escape",
      toggleVibrantOverlay: "5",
      stepVibrantOverlayIntensity: "Command+5",
      cycleColorScheme: "i",
      toggleScanlinesOverlay: "",
      togglePixelatedOverlay: "1",
      stepPixelationResolution: "Command+1",
      toggleFilmGrainOverlay: "2",
      stepFilmGrainAmount: "Command+2",
      toggleVhsOverlay: "3",
      toggleFilmCornersOverlay: "4",
      stepVhsIntensity: "Command+3",
      toggleAnimatedFilters: "6",
      cycleFolderSort: "t",
      toggleShowHiddenFolder: "h",
      toggleShowUntaggedFolder: "Command+h",
      toggleForceTitleCaps: "n",
      toggleHideBeforeLastDash: "Command+n",
      toggleHideAfterFirstUnderscore: "Shift+n",
      scoreUpSelection: "=",
      scoreDownSelection: "-",
      tagSelection: "",
      favoriteSelection: "Ctrl+f",
      renameFolderSelection: "",
      renameFileSelection: "",
      moveThumbViewportLeft: "ArrowLeft",
      moveThumbViewportRight: "ArrowRight",
      moveThumbViewportUp: "ArrowUp",
      moveThumbViewportDown: "ArrowDown"
    });

    const GRID_KEYBIND_DEFAULT_BINDINGS = Object.freeze({
      gridMoveUp: "w",
      gridMoveDown: "s",
      gridMoveLeft: "a",
      gridMoveRight: "d",
      gridOpenSelection: "e",
      gridUpDirectory: "q",
      gridGalleryPrev: "",
      gridGalleryNext: "",
      gridGalleryBack: ""
    });

    function applyFixedKeybinds(bindings) {
      const byId = new Map(bindings.map(binding => [binding.id, binding]));
      Object.entries(KEYBIND_LOCKED_ACTIONS).forEach(([id, key]) => {
        const binding = byId.get(id);
        if (!binding) return;
        binding.key = normalizeKeyValue(key);
      });
    }

    function defaultKeybinds() {
      const bindings = KEYBIND_ACTIONS.map(def => {
        const key = KEYBIND_DEFAULT_BINDINGS[def.id] || "";
        return Object.assign({}, def, { key: normalizeKeyValue(key) });
      });
      applyFixedKeybinds(bindings);
      enforceUniqueKeybinds(bindings, KEYBIND_LOCKED_IDS);
      return bindings;
    }

    function defaultGridKeybinds() {
      const bindings = GRID_KEYBIND_ACTIONS.map(def => {
        const key = GRID_KEYBIND_DEFAULT_BINDINGS[def.id] || "";
        return Object.assign({}, def, { key: normalizeKeyValue(key) });
      });
      enforceUniqueKeybinds(bindings);
      return bindings;
    }

    function enforceUniqueKeybinds(bindings, lockedIds = null) {
      const used = new Map();
      bindings.forEach((binding) => {
        const key = normalizeKeyValue(binding.key);
        if (!key) { binding.key = ""; return; }
        const existing = used.get(key);
        if (!existing) {
          used.set(key, binding);
          binding.key = key;
          return;
        }
        const existingLocked = !!(lockedIds && lockedIds.has(existing.id));
        const currentLocked = !!(lockedIds && lockedIds.has(binding.id));
        if (currentLocked && !existingLocked) {
          existing.key = "";
          used.set(key, binding);
          binding.key = key;
          return;
        }
        binding.key = "";
      });
    }

    function normalizeKeybinds(log) {
      const bindings = defaultKeybinds();
      const byId = new Map(bindings.map(b => [b.id, b]));
      if (log && Array.isArray(log.bindings)) {
        for (const entry of log.bindings) {
          const rawId = entry && entry.id ? String(entry.id) : "";
          const id = (
            (rawId === "stepVhsBlurAmount" || rawId === "stepVhsChromaAmount") ? "stepVhsIntensity"
            : (rawId === "cycleMediaFilter") ? "toggleVibrantOverlay"
            : (rawId === "stepMediaFilterIntensity") ? "stepVibrantOverlayIntensity"
            : rawId
          );
          if (!id || !byId.has(id)) continue;
          if (KEYBIND_LOCKED_IDS.has(id)) continue;
          const key = normalizeKeyValue(entry.key || "");
          if (key && !isSafeKeybindValue(key)) continue;
          byId.get(id).key = key;
        }
      }
      // Migrate the old F-key action trio to X-key equivalents when unchanged from legacy defaults.
      const legacyCluster = [
        ["randomJump", "f", "x"],
        ["cycleFilter", "Command+f", "Command+x"],
        ["slideshow", "Command+Shift+f", "Command+Shift+x"]
      ];
      const legacyUnchanged = legacyCluster.every(([id, legacyKey]) => {
        const binding = byId.get(id);
        return binding && normalizeKeyValue(binding.key || "") === normalizeKeyValue(legacyKey);
      });
      if (legacyUnchanged) {
        const blocked = new Set();
        for (const binding of bindings) {
          if (!binding) continue;
          if (binding.id === "randomJump" || binding.id === "cycleFilter" || binding.id === "slideshow") continue;
          const key = normalizeKeyValue(binding.key || "");
          if (key) blocked.add(key);
        }
        const canMigrate = legacyCluster.every(([, , nextKey]) => !blocked.has(normalizeKeyValue(nextKey)));
        if (canMigrate) {
          legacyCluster.forEach(([id, , nextKey]) => {
            const binding = byId.get(id);
            if (binding) binding.key = normalizeKeyValue(nextKey);
          });
        }
      }
      applyFixedKeybinds(bindings);
      enforceUniqueKeybinds(bindings, KEYBIND_LOCKED_IDS);
      return { bindings };
    }

    function normalizeGridKeybinds(log) {
      const bindings = defaultGridKeybinds();
      const byId = new Map(bindings.map(b => [b.id, b]));
      if (log && Array.isArray(log.gridBindings)) {
        for (const entry of log.gridBindings) {
          const id = entry && entry.id ? String(entry.id) : "";
          if (!id || !byId.has(id)) continue;
          const key = normalizeKeyValue(entry.key || "");
          if (key && !isSafeKeybindValue(key)) continue;
          byId.get(id).key = key;
        }
      }
      enforceUniqueKeybinds(bindings);
      return { bindings };
    }

    const KEYBIND_INDEX = new Map();
    const GRID_KEYBIND_INDEX = new Map();

    function rebuildKeybindIndex() {
      KEYBIND_INDEX.clear();
      const bindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds();
      applyFixedKeybinds(bindings);
      enforceUniqueKeybinds(bindings, KEYBIND_LOCKED_IDS);
      for (const binding of bindings) {
        const key = normalizeKeyValue(binding.key);
        if (!key || KEYBIND_INDEX.has(key)) continue;
        KEYBIND_INDEX.set(key, binding.id);
      }
      GRID_KEYBIND_INDEX.clear();
      const gridBindings = (WS.meta && Array.isArray(WS.meta.gridKeybinds)) ? WS.meta.gridKeybinds : defaultGridKeybinds();
      enforceUniqueKeybinds(gridBindings);
      for (const binding of gridBindings) {
        const key = normalizeKeyValue(binding.key);
        if (!key || GRID_KEYBIND_INDEX.has(key)) continue;
        GRID_KEYBIND_INDEX.set(key, binding.id);
      }
    }

    function keybindActionFor(key) {
      return KEYBIND_INDEX.get(key) || null;
    }

    function gridKeybindActionFor(key) {
      return GRID_KEYBIND_INDEX.get(key) || null;
    }

    function getPaneKeybindForAction(actionId) {
      const id = String(actionId || "");
      if (!id) return "";
      const bindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds();
      for (let i = 0; i < bindings.length; i++) {
        const binding = bindings[i];
        if (!binding || binding.id !== id) continue;
        return normalizeKeyValue(binding.key || "");
      }
      return "";
    }

    function gridCommandSeekActionForBaseKey(e, baseKey) {
      if (!isGridInteractionMode()) return null;
      if (!e || !e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
      const base = normalizeBaseKeyValue(baseKey);
      if (!base) return null;
      const seekBackKey = getPaneKeybindForAction("seekBack");
      const seekForwardKey = getPaneKeybindForAction("seekForward");
      const parsedBack = parseKeybindValue(seekBackKey);
      const parsedForward = parseKeybindValue(seekForwardKey);
      const backPlain = parsedBack.key && !parsedBack.mods.Cmd && !parsedBack.mods.Ctrl && !parsedBack.mods.Alt && !parsedBack.mods.Shift;
      const forwardPlain = parsedForward.key && !parsedForward.mods.Cmd && !parsedForward.mods.Ctrl && !parsedForward.mods.Alt && !parsedForward.mods.Shift;
      if (backPlain && parsedBack.key === base) return "seekBack";
      if (forwardPlain && parsedForward.key === base) return "seekForward";
      return null;
    }

    const WS = {
      root: null,
      fileById: new Map(),   // id -> FileRecord
      dirByPath: new Map(),  // path -> DirNode

      meta: {
        dirScores: new Map(),
        dirTags: new Map(),
        tagAlbumByTag: new Map(),
        dirThumbPresets: new Map(),
        fileThumbCrop: new Map(),
        videoThumbTime: new Map(),
        tagThumbModes: new Map(),
        tagThumbPresets: new Map(),
        pendingTagsByPath: new Map(),
        scoreHistory: [],
        dirFingerprints: new Map(),
        dirSortMode: "name",
        storageMode: "local",
        storageKey: "",
        fsRootHandle: null,
        fsSysDirHandle: null,
        fsSiteLogDirHandle: null,
        fsSiteLogProfilesDirHandle: null,
        fsSiteLogIndexHandle: null,
        fsSiteLogRenamesHandle: null,
        fsScoresFileHandle: null,
        fsTagsFileHandle: null,
        fsOptionsFileHandle: null,
        fsLegacyFileHandle: null,
        fsKeybindsFileHandle: null,
        saveTimer: null,
        dirty: false,
        options: normalizeOptions(null),
        keybinds: defaultKeybinds(),
        gridKeybinds: defaultGridKeybinds()
      },

      view: {
        filterMode: "all",
        randomMode: false,
        randomFolderMode: false,
        loopWithinDir: false,
        folderBehavior: "slide",
        folderScoreDisplay: "hidden",
        randomSeed: 0,
        randomCache: new Map(),
        randomFolderCache: new Map(),
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
        bulkTagFolderSelectedKeys: new Set(),
        bulkTagFolderSelectionsByDir: new Map(),
        bulkFileSelectedIds: new Set(),
        bulkFileSelectionsByDir: new Map(),
        bulkActionMenuOpen: false,
        bulkActionMenuAnchorPath: "",
        dirActionMenuPath: "",
        aboveRootView: false,
        tagFolderActiveMode: "",
        tagFolderActiveTag: "",
        tagFolderActiveAlbum: "",
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
        searchResults: [],
        previewScrollByDir: new Map(),
        previewScrollActiveKey: "",
        gridSelectionByContext: new Map()
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
      videoThumbPriorityQueue: [],
      videoThumbQueue: [],
      videoThumbActive: 0,
      videoThumbQueuedIds: new Set(),
      videoThumbInFlightIds: new Set(),
      videoThumbInFlightBackgroundIds: new Set(),
      videoThumbPrewarmBlocking: false,
      videoThumbWorkspaceKickTimer: 0,

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
      invalidateDirMetricsCaches();
      WS.root = null;
      WS.fileById.clear();
      WS.dirByPath.clear();
      DIR_HANDLE_CACHE = new Map();

      WS.meta.dirScores.clear();
      WS.meta.dirTags.clear();
      WS.meta.tagAlbumByTag.clear();
      WS.meta.dirThumbPresets.clear();
      WS.meta.fileThumbCrop.clear();
      WS.meta.videoThumbTime.clear();
      WS.meta.tagThumbModes.clear();
      WS.meta.tagThumbPresets.clear();
      WS.meta.pendingTagsByPath.clear();
      WS.meta.scoreHistory = [];
      WS.meta.dirFingerprints.clear();
      WS.meta.dirSortMode = "name";
      WS.meta.storageMode = "local";
      WS.meta.storageKey = "";
      WS.meta.fsRootHandle = null;
      WS.meta.fsSysDirHandle = null;
      WS.meta.fsSiteLogDirHandle = null;
      WS.meta.fsSiteLogProfilesDirHandle = null;
      WS.meta.fsSiteLogIndexHandle = null;
      WS.meta.fsSiteLogRenamesHandle = null;
      WS.meta.fsScoresFileHandle = null;
      WS.meta.fsTagsFileHandle = null;
      WS.meta.fsOptionsFileHandle = null;
      WS.meta.fsLegacyFileHandle = null;
      WS.meta.fsKeybindsFileHandle = null;
      WS.meta.dirty = false;
      WS.meta.options = normalizeOptions(null);
      WS.meta.keybinds = defaultKeybinds();
      WS.meta.gridKeybinds = defaultGridKeybinds();
      if (WS.meta.saveTimer) { clearTimeout(WS.meta.saveTimer); WS.meta.saveTimer = null; }

      applyDefaultViewFromOptions();
      rebuildKeybindIndex();
      WS.view.loopWithinDir = false;
      WS.view.randomSeed = 0;
      WS.view.randomCache = new Map();
      WS.view.randomFolderMode = false;
      WS.view.randomFolderCache = new Map();
      WS.view.slideshowModeIndex = 0;
      WS.view.slideshowActive = false;
      WS.view.bulkSelectMode = false;
      WS.view.bulkTagSelectedPaths = new Set();
      WS.view.bulkTagSelectionsByDir = new Map();
      WS.view.bulkTagFolderSelectedKeys = new Set();
      WS.view.bulkTagFolderSelectionsByDir = new Map();
      WS.view.bulkFileSelectedIds = new Set();
      WS.view.bulkFileSelectionsByDir = new Map();
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.dirActionMenuPath = "";
      WS.view.aboveRootView = false;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderActiveAlbum = "";
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
      WS.view.previewScrollByDir = new Map();
      WS.view.previewScrollActiveKey = "";
      WS.view.gridSelectionByContext = new Map();
      if (WS.view.slideshowTimer) { clearInterval(WS.view.slideshowTimer); WS.view.slideshowTimer = null; }
      if (WS.view.statusTimeout) { clearTimeout(WS.view.statusTimeout); WS.view.statusTimeout = null; }

      WS.nav.dirNode = null;
      WS.nav.entries = [];
      WS.nav.selectedIndex = 0;

      WS.preview.kind = null;
      WS.preview.dirNode = null;
      WS.preview.fileId = null;

      if (WS.videoThumbWorkspaceKickTimer) {
        try { clearTimeout(WS.videoThumbWorkspaceKickTimer); } catch {}
      }
      WS.videoThumbPriorityQueue = [];
      WS.videoThumbQueue = [];
      WS.videoThumbActive = 0;
      WS.videoThumbQueuedIds = new Set();
      WS.videoThumbInFlightIds = new Set();
      WS.videoThumbInFlightBackgroundIds = new Set();
      WS.videoThumbPrewarmBlocking = false;
      WS.videoThumbWorkspaceKickTimer = 0;

      WS.imageThumbQueue = [];
      WS.imageThumbActive = 0;
      PRELOAD_CACHE = new Map();
      PREVIEW_BULK_TAG_EDIT = null;
      closeThumbnailCropEditor();

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
    const optionsBtn = $("optionsBtn");
    const refreshBtn = $("refreshBtn");
    const openWritableBtn = $("openWritableBtn");
    const titleLabel = $("titleLabel");

    // Menu Overlay
    const menuOverlay = $("menuOverlay");
    const menuCard = $("menuCard");
    const menuHeader = $("menuHeader");
    const menuTabs = $("menuTabs");
    const menuCloseBtn = $("menuCloseBtn");
    const menuTabOptions = $("menuTabOptions");
    const menuTabKeybinds = $("menuTabKeybinds");
    const menuTabCalendar = $("menuTabCalendar");

    const optionsBodyEl = $("optionsBody");
    const optionsResetBtn = $("optionsResetBtn");
    const optionsDoneBtn = $("optionsDoneBtn");
    const optionsStatusLabel = $("optionsStatusLabel");

    // Keybinds Panel
    const keybindsBodyEl = $("keybindsBody");
    const keybindsResetBtn = $("keybindsResetBtn");
    const keybindsDoneBtn = $("keybindsDoneBtn");
    const keybindsStatusLabel = $("keybindsStatusLabel");
    const calendarBodyEl = $("calendarBody");
    const calendarDoneBtn = $("calendarDoneBtn");
    const calendarDeleteAllBtn = $("calendarDeleteAllBtn");
    const calendarStatusLabel = $("calendarStatusLabel");

    const overlayWindowStates = {
      menu: { x: null, y: null, width: null, height: null }
    };
    const overlayCards = {
      menu: menuCard
    };
    const overlayCardHeaders = {
      menu: menuHeader
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
      refreshFitInsidePreviewGrids();
      scheduleGridModeCardSizing();
      updateGridModeListTopInset();
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
    const previewActionMenuEl = $("previewActionMenu");
    if (previewActionMenuEl) {
      previewActionMenuEl.addEventListener("click", (e) => e.stopPropagation());
    }

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
    let VIEWER_SKIP_DIR_SYNC_ON_CLOSE = false;
    let uiHideTimer = null;
    let globalCursorHideTimer = null;

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
        if (!WS.meta.options || typeof WS.meta.options !== "object") WS.meta.options = normalizeOptions(null);
        WS.meta.options.leftPaneWidthPct = pct;
        WS.meta.dirty = true;
        if (typeof metaScheduleSave === "function") metaScheduleSave();
        setDividerPositionFromPct(pct);
        refreshFitInsidePreviewGrids();
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

      window.addEventListener('resize', () => {
        applyPaneDividerFromOptions();
        refreshFitInsidePreviewGrids();
      });

      // initial apply from saved options
      applyPaneDividerFromOptions();
      applyMediaFilterFromOptions();
    })();

    let MAIN_STATUS_TIMEOUT = null;

    let ACTIVE_MEDIA_SURFACE = "none";

    let PREVIEW_VIDEO_PAUSE = { active: false, fileId: null, time: 0, wasPlaying: false };

    let VIDEO_CARRY = { active: false, fileId: null, time: 0, wasPlaying: false };

    let PRELOAD_CACHE = new Map();

    const BLACK_POSTER_URL = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='black'/></svg>";

    let TAG_EDIT_PATH = null;
    let TAG_CONTEXT_MENU_STATE = null;
    let PREVIEW_CONTEXT_MENU_STATE = null;
    let TAG_ENTRY_RENAME_STATE = null;
    let BULK_TAG_PLACEHOLDER = null;
    let PREVIEW_BULK_TAG_EDIT = null;
    let THUMB_CROP_EDITOR = null;
    const THUMB_ASPECT_RESOLVE_PENDING = new Set();
    let RENAME_EDIT_PATH = null;
    let RENAME_EDIT_FILE_ID = null;
    let RENAME_BUSY = false;

    let MENU_OPEN = false;
    let MENU_ACTIVE_TAB = "general";
    let MENU_LAST_TAB = "general";
    let MENU_HAS_OPENED = false;
    const MENU_TAB_SCROLL = { general: 0, appearance: 0, playback: 0, thumbnails: 0, filenames: 0, controls: 0, calendar: 0 };
    let KEYBIND_CAPTURE_ACTION_ID = "";
    let PROPERTIES_OPEN = false;

    let BANIC_ACTIVE = false;
    let BANIC_STATE = { preview: null, viewer: null, slideshowWasActive: false };
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
      if (active && document.fullscreenElement) {
        if (VIEWER_MODE) hideOverlay();
        else exitFullscreenIfNeeded();
      }
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

      const behavior = normalizeFolderBehavior(WS.view.folderBehavior, "slide");
      const behaviorLabel = behavior === "slide" ? "Slide" : "Stop";
      if (behavior !== normalizeFolderBehavior(defs.defaultFolderBehavior, "slide")) {
        parts.push(`Folder behavior: ${behaviorLabel}`);
      }

      const dirSortMode = normalizeDirSortMode(WS.meta.dirSortMode);
      if (dirSortMode !== "name") {
        parts.push(`Dir sort: ${dirSortModeLabel(dirSortMode)}`);
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

    const MENU_TAB_IDS = ["general", "appearance", "playback", "thumbnails", "filenames", "controls", "calendar"];
    const MENU_PANEL_BY_TAB = {
      general: "options",
      appearance: "options",
      playback: "options",
      thumbnails: "options",
      filenames: "options",
      controls: "controls",
      calendar: "calendar"
    };
    const menuTabButtons = menuTabs ? Array.from(menuTabs.querySelectorAll(".menuTabBtn")) : [];
    const menuTabPanels = {
      options: menuTabOptions,
      controls: menuTabKeybinds,
      calendar: menuTabCalendar
    };
    const menuScrollTargets = {
      general: optionsBodyEl,
      appearance: optionsBodyEl,
      playback: optionsBodyEl,
      thumbnails: optionsBodyEl,
      filenames: optionsBodyEl,
      controls: keybindsBodyEl,
      calendar: calendarBodyEl
    };

    function saveMenuTabScroll(tab) {
      const target = menuScrollTargets[tab];
      if (!target) return;
      MENU_TAB_SCROLL[tab] = target.scrollTop || 0;
    }

    function restoreMenuTabScroll(tab) {
      const target = menuScrollTargets[tab];
      if (!target) return;
      const top = MENU_TAB_SCROLL[tab] || 0;
      requestAnimationFrame(() => {
        target.scrollTop = top;
      });
    }

    function ensureOptionsUi(section) {
      renderOptionsUi(section);
      setOptionsStatus("Saved automatically");
      restoreMenuTabScroll(section);
    }

    function ensureKeybindsUi(scope = "pane") {
      renderKeybindsUi(scope);
      setKeybindsStatus("Saved automatically");
      restoreMenuTabScroll("controls");
    }

    function setMenuTab(tabId) {
      const nextCandidate = MENU_TAB_IDS.includes(tabId) ? tabId : "general";
      const next = nextCandidate;
      if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
      if (MENU_ACTIVE_TAB === "controls" && next !== "controls") KEYBIND_CAPTURE_ACTION_ID = "";
      MENU_ACTIVE_TAB = next;
      MENU_LAST_TAB = next;

      menuTabButtons.forEach((btn) => {
        const active = btn.dataset.tab === next;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
        btn.setAttribute("tabindex", active ? "0" : "-1");
      });

      const activePanelId = MENU_PANEL_BY_TAB[next] || "options";
      Object.entries(menuTabPanels).forEach(([id, panel]) => {
        if (!panel) return;
        const active = id === activePanelId;
        panel.classList.toggle("active", active);
        panel.setAttribute("aria-hidden", active ? "false" : "true");
      });

      if (next === "controls") {
        ensureKeybindsUi("pane");
        return;
      }
      if (next === "calendar") {
        renderCalendarUi();
        setCalendarStatus("Saved automatically");
        restoreMenuTabScroll("calendar");
        return;
      }
      ensureOptionsUi(next);
    }

    function openMenu(tabId) {
      MENU_OPEN = true;
      if (menuOverlay) menuOverlay.classList.add("active");
      requestAnimationFrame(() => applyOverlayWindowState("menu"));
      const next = MENU_TAB_IDS.includes(tabId)
        ? tabId
        : (MENU_HAS_OPENED ? MENU_LAST_TAB : "general");
      MENU_HAS_OPENED = true;
      setMenuTab(next);
    }

    function closeMenu() {
      if (MENU_ACTIVE_TAB) saveMenuTabScroll(MENU_ACTIVE_TAB);
      MENU_OPEN = false;
      KEYBIND_CAPTURE_ACTION_ID = "";
      if (menuOverlay) menuOverlay.classList.remove("active");
    }

    if (menuCloseBtn) menuCloseBtn.addEventListener("click", () => closeMenu());
    if (optionsBtn) optionsBtn.addEventListener("click", () => openMenu());
    menuTabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab || "general";
        setMenuTab(tab);
      });
    });

    /* =========================================================
       Keybinds panel
       ========================================================= */

    function setKeybindsStatus(text) {
      if (!keybindsStatusLabel) return;
      keybindsStatusLabel.textContent = text || "—";
    }

    function setCalendarStatus(text) {
      if (!calendarStatusLabel) return;
      calendarStatusLabel.textContent = text || "—";
    }

    function scoreHistoryDateLabel(dateKey) {
      const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return String(dateKey || "");
      const y = Number(m[1]);
      const mo = Number(m[2]) - 1;
      const d = Number(m[3]);
      const dt = new Date(y, mo, d);
      if (!Number.isFinite(dt.getTime())) return String(dateKey || "");
      return dt.toLocaleDateString(undefined, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric"
      });
    }

    function scoreHistoryTimeLabel(ts) {
      const dt = new Date(Number(ts) || Date.now());
      if (!Number.isFinite(dt.getTime())) return "";
      return dt.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      });
    }

    function scoreHistoryChartColor(index) {
      const hue = ((index * 53) % 360 + 360) % 360;
      return `hsl(${hue} 70% 54%)`;
    }

    function getRootFolderScoreRows() {
      const root = WS.root;
      if (!root || !Array.isArray(root.childrenDirs)) return [];
      const out = [];
      for (let i = 0; i < root.childrenDirs.length; i++) {
        const node = root.childrenDirs[i];
        if (!node || node.type !== "dir") continue;
        const path = String(node.path || "");
        out.push({
          path,
          name: dirDisplayName(node),
          score: metaGetScore(path)
        });
      }
      out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      return out;
    }

    function buildRootPositivePieHtml(rootRows) {
      const positives = rootRows.filter((row) => Number(row.score) > 0);
      const total = positives.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
      if (!(total > 0)) {
        return `
          <div class="scorePieWrap scorePieWrapEmpty">
            <div class="scorePieEmpty">No positive root scores yet.</div>
          </div>
        `;
      }
      let acc = 0;
      const gradientParts = [];
      for (let i = 0; i < positives.length; i++) {
        const row = positives[i];
        const startDeg = acc * 360;
        const part = (Number(row.score) || 0) / total;
        acc += part;
        const endDeg = acc * 360;
        gradientParts.push(`${scoreHistoryChartColor(i)} ${startDeg.toFixed(3)}deg ${endDeg.toFixed(3)}deg`);
      }
      const legend = positives.map((row, idx) => {
        const score = Number(row.score) || 0;
        const pct = total > 0 ? (score / total) * 100 : 0;
        return `
          <div class="scorePieLegendRow">
            <span class="scorePieSwatch" style="background:${escapeHtml(scoreHistoryChartColor(idx))};"></span>
            <span class="scorePieName" title="${escapeHtml(row.path || "(root)")}" >${escapeHtml(row.name || "(root)")}</span>
            <span class="scorePieValue">${escapeHtml(String(score))}</span>
            <span class="scorePiePct">${escapeHtml(pct.toFixed(1))}%</span>
          </div>
        `;
      }).join("");
      return `
        <div class="scorePieWrap">
          <div class="scorePieChart" style="background:conic-gradient(${gradientParts.join(", ")});"></div>
          <div class="scorePieLegend">
            ${legend}
          </div>
        </div>
      `;
    }

    function buildRootScoreBarsHtml(rootRows) {
      if (!rootRows.length) {
        return `<div class="scoreBarsEmpty">No root folders available.</div>`;
      }
      const sortedRows = rootRows.slice().sort((a, b) => {
        const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
        if (scoreDiff) return scoreDiff;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      const maxAbs = Math.max(1, ...sortedRows.map((row) => Math.abs(Number(row.score) || 0)));
      const rowsHtml = sortedRows.map((row) => {
        const score = Number(row.score) || 0;
        const widthPct = Math.max(0, Math.min(50, Math.abs(score) / maxAbs * 50));
        const leftPct = score >= 0 ? 50 : Math.max(0, 50 - widthPct);
        const signClass = score >= 0 ? "positive" : "negative";
        const shown = score > 0 ? `+${score}` : String(score);
        return `
          <div class="scoreBarRow">
            <div class="scoreBarLabel" title="${escapeHtml(row.path || "(root)")}" >${escapeHtml(row.name || "(root)")}</div>
            <div class="scoreBarTrack">
              <div class="scoreBarAxis"></div>
              <div class="scoreBarFill ${signClass}" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%;"></div>
            </div>
            <div class="scoreBarValue">${escapeHtml(shown)}</div>
          </div>
        `;
      }).join("");
      return `
        <div class="scoreBarsWrap">
          ${rowsHtml}
        </div>
      `;
    }

    function scoreHistoryRootPathFromChangedPath(path) {
      const normalized = normalizeDirPathValue(path);
      if (!normalized) return "";
      const parts = normalized.split("/").filter(Boolean);
      return parts.length ? String(parts[0] || "") : "";
    }

    function scoreHistoryRootLabelFromPath(path) {
      const rootPath = scoreHistoryRootPathFromChangedPath(path);
      if (!rootPath) return "root";
      const node = WS.dirByPath.get(rootPath) || null;
      return dirDisplayName(node) || rootPath;
    }

    function getRootScoreHistoryLinesForEntry(entry) {
      const out = [];
      if (!entry || !Array.isArray(entry.changed)) return out;
      for (let i = 0; i < entry.changed.length; i++) {
        const item = entry.changed[i];
        if (!item || typeof item !== "object") continue;
        const itemPath = normalizeDirPathValue(item.path);
        if (!itemPath) continue;
        const depth = itemPath.split("/").filter(Boolean).length;
        if (depth !== 1) continue;
        const delta = Number(item.delta) || 0;
        out.push({
          at: Number(entry.at) || Date.now(),
          eventId: String(entry.id || ""),
          rootPath: itemPath,
          rootLabel: scoreHistoryRootLabelFromPath(itemPath),
          delta
        });
      }
      return out;
    }

    function renderCalendarUi() {
      if (!calendarBodyEl) return;
      const history = normalizeScoreHistoryList(WS.meta && Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : []);
      WS.meta.scoreHistory = history;
      const rootRows = getRootFolderScoreRows();
      const positiveCount = rootRows.filter((row) => Number(row.score) > 0).length;
      const totalScore = rootRows.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
      const grouped = new Map();
      for (let i = 0; i < history.length; i++) {
        const entry = history[i];
        const rows = getRootScoreHistoryLinesForEntry(entry);
        for (let j = 0; j < rows.length; j++) {
          const row = rows[j];
          const key = scoreHistoryDateKey(row.at);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key).push(row);
        }
      }
      const dateKeys = Array.from(grouped.keys()).sort((a, b) => String(b).localeCompare(String(a)));
      const historyHtml = dateKeys.length
        ? dateKeys.map((key) => {
          const rows = grouped.get(key) || [];
          rows.sort((a, b) => {
            const timeDiff = (Number(b.at) || 0) - (Number(a.at) || 0);
            if (timeDiff) return timeDiff;
            return String(a.rootPath || "").localeCompare(String(b.rootPath || ""));
          });
          const lineRowsHtml = rows.map((row) => {
            const deltaShown = row.delta > 0 ? `+${row.delta}` : String(row.delta || 0);
            return `
              <div class="scoreHistorySimpleRow">
                <span class="scoreHistorySimpleText">${escapeHtml(scoreHistoryTimeLabel(row.at))} - ${escapeHtml(row.rootLabel)} - ${escapeHtml(deltaShown)}</span>
                <button
                  type="button"
                  class="miniBtn scoreHistoryDeleteBtn"
                  data-score-history-delete-line-event="${escapeHtml(row.eventId)}"
                  data-score-history-delete-line-root="${escapeHtml(row.rootPath)}"
                >Delete</button>
              </div>
            `;
          }).join("");
          return `
            <section class="scoreHistoryDay">
              <div class="scoreHistoryDayHeader">
                <h2>${escapeHtml(scoreHistoryDateLabel(key))}</h2>
                <div class="scoreHistoryDayMeta">
                  <span>${escapeHtml(String(rows.length))} change${rows.length === 1 ? "" : "s"}</span>
                  <button type="button" class="miniBtn scoreHistoryDeleteDayBtn" data-score-history-delete-day="${escapeHtml(key)}">Delete day</button>
                </div>
              </div>
              <div class="scoreHistoryDayEvents">
                ${lineRowsHtml}
              </div>
            </section>
          `;
        }).join("")
        : `<div class="scoreHistoryEmpty">No score changes logged yet.</div>`;

      calendarBodyEl.innerHTML = `
        <div class="calendarPanelIntro">
          <h1>Score Calendar</h1>
          <div class="label">Track score changes by date, and inspect root-folder score distribution.</div>
        </div>
        <section class="calendarAnalytics">
          <div class="calendarAnalyticsCard">
            <h2>Positive score share (root folders)</h2>
            <div class="label">Root folders with positive score: ${escapeHtml(String(positiveCount))}. Total root score sum: ${escapeHtml(String(totalScore))}.</div>
            ${buildRootPositivePieHtml(rootRows)}
          </div>
          <div class="calendarAnalyticsCard">
            <h2>Root folder scores</h2>
            <div class="label">Bars are centered at zero. Positive extends right; negative extends left.</div>
            ${buildRootScoreBarsHtml(rootRows)}
          </div>
        </section>
        <section class="calendarHistory">
          <h2>Score change history</h2>
          ${historyHtml}
        </section>
      `;
      if (calendarDeleteAllBtn) calendarDeleteAllBtn.disabled = !history.length;
    }

    function isGridKeybindAction(actionId) {
      return GRID_KEYBIND_ACTIONS.some(action => action.id === actionId);
    }

    function isLockedGridKeybindAction() {
      return false;
    }

    function isAnyLockedKeybindAction(actionId) {
      return isLockedKeybindAction(actionId) || isLockedGridKeybindAction(actionId);
    }

    function assignKeybindForAction(actionId, rawKeybind) {
      if (!actionId || !WS.meta) return { ok: false, message: "Keybinds unavailable." };
      const isGrid = isGridKeybindAction(actionId);
      const bindingList = isGrid
        ? (Array.isArray(WS.meta.gridKeybinds) ? WS.meta.gridKeybinds : defaultGridKeybinds())
        : (Array.isArray(WS.meta.keybinds) ? WS.meta.keybinds : defaultKeybinds());
      const locked = isGrid ? isLockedGridKeybindAction(actionId) : isLockedKeybindAction(actionId);
      const lockedIds = isGrid ? null : KEYBIND_LOCKED_IDS;
      if (locked) return { ok: false, message: "This action is locked." };
      const binding = bindingList.find(b => b.id === actionId);
      if (!binding) return { ok: false, message: "Action not found." };

      const nextKey = normalizeKeyValue(rawKeybind || "");
      if (nextKey && !isSafeKeybindValue(nextKey)) return { ok: false, message: "That key is not allowed." };
      if (!isGrid && isKeyReservedForLockedAction(nextKey, actionId)) return { ok: false, message: "That key is reserved." };

      const prevKey = normalizeKeyValue(binding.key || "");
      if (nextKey === prevKey) return { ok: true, unchanged: true };

      const conflict = nextKey
        ? bindingList.find((b) => b.id !== binding.id && normalizeKeyValue(b.key || "") === nextKey && !(isGrid ? isLockedGridKeybindAction(b.id) : isLockedKeybindAction(b.id)))
        : null;

      binding.key = nextKey;
      if (conflict) conflict.key = prevKey;
      if (!isGrid) applyFixedKeybinds(bindingList);
      enforceUniqueKeybinds(bindingList, lockedIds);
      if (isGrid) WS.meta.gridKeybinds = bindingList;
      else WS.meta.keybinds = bindingList;
      rebuildKeybindIndex();
      WS.meta.dirty = true;
      metaScheduleSave();
      return { ok: true, swapped: !!conflict };
    }

    function renderKeybindsUi(scope = "pane") {
      if (!keybindsBodyEl) return;
      const paneBindings = (WS.meta && Array.isArray(WS.meta.keybinds)) ? WS.meta.keybinds : defaultKeybinds();
      const gridBindings = (WS.meta && Array.isArray(WS.meta.gridKeybinds)) ? WS.meta.gridKeybinds : defaultGridKeybinds();
      const opt = WS.meta && WS.meta.options ? WS.meta.options : normalizeOptions(null);
      const allBindings = paneBindings.concat(gridBindings);
      if (KEYBIND_CAPTURE_ACTION_ID && !allBindings.some(binding => binding.id === KEYBIND_CAPTURE_ACTION_ID)) {
        KEYBIND_CAPTURE_ACTION_ID = "";
      }

      const paneBySection = new Map();
      for (const binding of paneBindings) {
        if (!paneBySection.has(binding.section)) paneBySection.set(binding.section, []);
        paneBySection.get(binding.section).push(binding);
      }

      const gridBySection = new Map();
      for (const binding of gridBindings) {
        if (!gridBySection.has(binding.section)) gridBySection.set(binding.section, []);
        gridBySection.get(binding.section).push(binding);
      }

      let html = `<div class="label" style="margin-bottom:8px;">Controls are stored in keyboard-configuration.log.json in the .local-gallery folder. Click Set keybind for an action, then hold modifiers and press a key to assign the combo.</div>`;
      html += `
        <div class="optRow">
          <div class="optLeft">
            <div class="optTitle">File-only folders open in gallery</div>
            <div class="optHint">Open file-only folders directly in Gallery Mode on the first file, and on close return straight to the parent folder view.</div>
          </div>
          <div class="optRight">
            <input id="ctl_fileOnlyFoldersOpenInGallery" type="checkbox"${opt.fileOnlyFoldersOpenInGallery ? " checked" : ""} />
          </div>
        </div>
      `;

      const renderBindingRows = (list) => {
        let out = "";
        for (const binding of list) {
          const isLocked = isAnyLockedKeybindAction(binding.id);
          const isCapturing = !isLocked && KEYBIND_CAPTURE_ACTION_ID === binding.id;
          const currentLabel = keyLabel(binding.key || "");
          const lockedLabel = isLocked ? keyLabel(lockedKeyForAction(binding.id)) : "";
          const hintText = isLocked
            ? `${binding.hint} Locked to ${lockedLabel}.`
            : (isCapturing ? `Press the key combination now. ${binding.hint}` : binding.hint);
          const controlHtml = isLocked
            ? `<div class="label">${escapeHtml(lockedLabel)} (Locked)</div>`
            : `
                <div style="display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
                  <div class="label" style="min-width:120px;text-align:right;">${escapeHtml(currentLabel)}</div>
                  <button type="button" data-bind-capture-id="${escapeHtml(binding.id)}">${isCapturing ? "Press keys..." : "Set keybind"}</button>
                  <button type="button" data-bind-clear-id="${escapeHtml(binding.id)}"${binding.key ? "" : " disabled"}>Clear</button>
                </div>
              `;
          out += `
            <div class="optRow">
              <div class="optLeft">
                <div class="optTitle">${escapeHtml(binding.label)}</div>
                <div class="optHint">${escapeHtml(hintText)}</div>
              </div>
              <div class="optRight">
                ${controlHtml}
              </div>
            </div>
          `;
        }
        return out;
      };

      if (scope === "grid") {
        for (const section of GRID_KEYBIND_SECTIONS) {
          const list = gridBySection.get(section.id) || [];
          if (!list.length) continue;
          html += `<h1>${escapeHtml(section.label)}</h1>`;
          html += renderBindingRows(list);
        }
      } else {
        for (const section of KEYBIND_SECTIONS) {
          const list = paneBySection.get(section.id) || [];
          if (!list.length) continue;
          html += `<h1>${escapeHtml(section.label)}</h1>`;
          html += renderBindingRows(list);
        }
      }

      keybindsBodyEl.innerHTML = html;
      applyDescriptionVisibilityFromOptions();

      const fileOnlyFoldersToggle = $("ctl_fileOnlyFoldersOpenInGallery");
      if (fileOnlyFoldersToggle) {
        fileOnlyFoldersToggle.addEventListener("click", (e) => e.stopPropagation());
        fileOnlyFoldersToggle.addEventListener("keydown", (e) => e.stopPropagation());
        fileOnlyFoldersToggle.addEventListener("change", () => {
          const next = {};
          next.fileOnlyFoldersOpenInGallery = !!fileOnlyFoldersToggle.checked;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setKeybindsStatus("Saved");
          applyOptionsEverywhere(false);
        });
      }

      const captureButtons = keybindsBodyEl.querySelectorAll("button[data-bind-capture-id]");
      captureButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute("data-bind-capture-id") || "";
          if (!id || isAnyLockedKeybindAction(id)) return;
          KEYBIND_CAPTURE_ACTION_ID = (KEYBIND_CAPTURE_ACTION_ID === id) ? "" : id;
          setKeybindsStatus(KEYBIND_CAPTURE_ACTION_ID ? "Press key combination to set bind." : "Capture canceled.");
          renderKeybindsUi(scope);
        });
        btn.addEventListener("keydown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });

      const clearButtons = keybindsBodyEl.querySelectorAll("button[data-bind-clear-id]");
      clearButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const id = btn.getAttribute("data-bind-clear-id") || "";
          if (!id || isAnyLockedKeybindAction(id)) return;
          const result = assignKeybindForAction(id, "");
          KEYBIND_CAPTURE_ACTION_ID = "";
          renderKeybindsUi(scope);
          setKeybindsStatus(result.ok ? "Saved" : (result.message || "Unable to update keybind."));
        });
        btn.addEventListener("keydown", (e) => {
          e.preventDefault();
          e.stopPropagation();
        });
      });
    }

    document.addEventListener("keydown", (e) => {
      if (!KEYBIND_CAPTURE_ACTION_ID) return;
      if (!MENU_OPEN || MENU_ACTIVE_TAB !== "controls") {
        KEYBIND_CAPTURE_ACTION_ID = "";
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const isPlainEscape = (
        e.key === "Escape" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      );
      if (isPlainEscape) {
        KEYBIND_CAPTURE_ACTION_ID = "";
        renderKeybindsUi("pane");
        setKeybindsStatus("Capture canceled.");
        return;
      }

      const key = keybindValueFromEvent(e);
      if (!key) return;

      const actionId = KEYBIND_CAPTURE_ACTION_ID;
      KEYBIND_CAPTURE_ACTION_ID = "";
      const result = assignKeybindForAction(actionId, key);
      renderKeybindsUi("pane");
      setKeybindsStatus(result.ok ? "Saved" : (result.message || "Unable to update keybind."));
    }, true);

    function resetKeybindsToDefaults() {
      WS.meta.keybinds = defaultKeybinds();
      WS.meta.gridKeybinds = defaultGridKeybinds();
      rebuildKeybindIndex();
      WS.meta.dirty = true;
      metaScheduleSave();
      KEYBIND_CAPTURE_ACTION_ID = "";
      renderKeybindsUi("pane");
      setKeybindsStatus("Reset");
    }

    function renderOptionsUi(sectionTab = MENU_ACTIVE_TAB) {
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

      const makeRangeRow = (title, hint, id, value, min, max, step, displayValue) => {
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight optRange">
              <input id="${escapeHtml(id)}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(String(value))}" />
              <div class="optRangeValue" id="${escapeHtml(id)}_value">${escapeHtml(displayValue)}</div>
            </div>
          </div>
        `;
      };

      const makeActionRow = (title, hint, actionsHtml) => {
        return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
              <div class="optHint">${escapeHtml(hint)}</div>
            </div>
            <div class="optRight optActions">
              ${actionsHtml}
            </div>
          </div>
        `;
      };

      const dirSortModes = dirSortModeOptions();

      const preloadModes = [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
        { value: "ultra", label: "Ultra" }
      ];

      const slideshowModes = [
        { value: "cycle", label: "Cycle speeds" },
        { value: "1", label: "Toggle 1s" },
        { value: "3", label: "Toggle 3s" },
        { value: "5", label: "Toggle 5s" },
        { value: "10", label: "Toggle 10s" }
      ];

      const randomActionModes = [
        { value: "firstFileJump", label: "First file jump" },
        { value: "randomFileSort", label: "Random file sort" },
        { value: "randomFolderSort", label: "Random folder sort" }
      ];
      const interactionModes = [
        { value: "grid", label: "Grid Mode" },
        { value: "pane", label: "Pane Mode" }
      ];

      const animatedFilterModes = [
        { value: "off", label: "Off" },
        { value: "on", label: "On" },
        { value: "videos", label: "Videos only" }
      ];
      const thumbnailStyleModes = [
        { value: "cropped", label: "Cropped" },
        { value: "aspect", label: "Aspect Ratio" }
      ];
      const thumbnailScaleModes = [
        { value: "small", label: "Small" },
        { value: "medium", label: "Medium" },
        { value: "large", label: "Large" },
        { value: "xl", label: "XL" },
        { value: "xxl", label: "XXL" },
        { value: "xxxl", label: "3XL" }
      ];
      const thumbnailStyleRow = ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE
        ? makeSelectRow("Thumbnail Style", "Choose between fixed cropped thumbnails or natural aspect ratio cards.", "opt_thumbnailStyle", String(opt.thumbnailStyle || "cropped"), thumbnailStyleModes)
        : "";
      const thumbnailScaleHint = ENABLE_ASPECT_RATIO_THUMBNAIL_STYLE
        ? "Small through 3XL are saved separately for each thumbnail style."
        : "Set cropped thumbnail size from Small through 3XL.";

      const formatPixelateResolution = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
      };

      const formatGrainAmount = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${Math.round(n * 100)}%`;
      };

      const pixelateResolutionValue = Number.isFinite(opt.crtPixelateResolution) ? opt.crtPixelateResolution : 4;
      const grainAmountValue = Number.isFinite(opt.crtGrainAmount) ? opt.crtGrainAmount : 0.06;
      const vhsIntensityValue = (function() {
        const blur = Number(opt.vhsBlurAmount);
        const chroma = Number(opt.vhsChromaAmount);
        const blurOk = Number.isFinite(blur);
        const chromaOk = Number.isFinite(chroma);
        if (blurOk && chromaOk) return clampNumber((blur + chroma) * 0.5, 0, 3, 1.2);
        if (blurOk) return clampNumber(blur, 0, 3, 1.2);
        if (chromaOk) return clampNumber(chroma, 0, 3, 1.2);
        return 1.2;
      })();

      const formatVhsIntensity = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${n.toFixed(1)}px`;
      };
      const formatVibrantOverlayIntensity = (value) => {
        const n = Number(value);
        if (!Number.isFinite(n)) return "";
        return `${Math.round(n * 100)}%`;
      };

      const sections = {
        general: {
          title: "General",
          rows: `
${makeSelectRow("Interaction mode", "Choose between full-screen Grid Mode and classic Pane Mode.", "opt_interactionMode", getInteractionModeFromOptions(opt), interactionModes)}
${makeSelectRow("Folder sort", "Sort folders by name, score, recursive size, recursive count, or non-recursive count.", "opt_dirSortMode", normalizeDirSortMode(WS.meta.dirSortMode), dirSortModes)}
${makeSelectRow("Random action behavior", "Choose what the Random action key does.", "opt_randomActionMode", String(opt.randomActionMode || "firstFileJump"), randomActionModes)}
${makeCheckRow("Show Up Directory item", "Show the synthetic Up Directory tile in Grid Mode folders.", "opt_showGridUpDirectoryEntry", !!opt.showGridUpDirectoryEntry)}
${makeCheckRow("Show root view", "Allow navigating above the root to a single root-folder portal card.", "opt_showRootView", opt.showRootView !== false)}
${makeCheckRow("Click selected rotating thumbnail opens file", "When enabled, clicking an already-selected rotating folder/tag item jumps to the thumbnail currently shown.", "opt_clickSelectedRotatingThumbTeleports", !!opt.clickSelectedRotatingThumbTeleports)}
${makeCheckRow("Show Hidden Folder", "Display a dedicated hidden-folder tag near the top of the directories pane when tag folders are enabled.", "opt_showHiddenFolder", !!opt.showHiddenFolder)}
${makeCheckRow("Show Untagged Folder", "Display a dedicated untagged-folder tag in any folder view when tag folders are enabled.", "opt_showUntaggedFolder", !!opt.showUntaggedFolder)}
${makeCheckRow("Blank row after tag folders", "Insert a blank spacer row between tag/favorites/album entries and real folders.", "opt_showTagFolderSpacerRow", !!opt.showTagFolderSpacerRow)}
          `
        },
        appearance: {
          title: "Appearance",
          rows: `
${makeCheckRow("Vibrant overlay", "Apply the Vibrant color treatment as an overlay.", "opt_vibrantOverlayEnabled", !!opt.vibrantOverlayEnabled)}
${makeRangeRow("Vibrant overlay intensity", "Scales vibrant overlay strength from 0% (off) to 100% (full).", "opt_vibrantOverlayIntensity", Number.isFinite(opt.vibrantOverlayIntensity) ? opt.vibrantOverlayIntensity : 1, 0, 1, 0.05, formatVibrantOverlayIntensity(Number.isFinite(opt.vibrantOverlayIntensity) ? opt.vibrantOverlayIntensity : 1))}
${makeCheckRow("Scanline overlay", "Add CRT scanlines over media.", "opt_crtScanlinesEnabled", !!opt.crtScanlinesEnabled)}
${makeCheckRow("Pixelated overlay", "Pixelate media before applying filters.", "opt_crtPixelateEnabled", !!opt.crtPixelateEnabled)}
${makeRangeRow("Pixelation resolution", "Higher values mean chunkier pixels.", "opt_crtPixelateResolution", pixelateResolutionValue, 2, 8, 0.5, formatPixelateResolution(pixelateResolutionValue))}
${makeCheckRow("Film grain overlay", "Adds film grain noise overlay.", "opt_crtGrainEnabled", !!opt.crtGrainEnabled)}
${makeRangeRow("Film grain amount", "Strength of the grain overlay.", "opt_crtGrainAmount", grainAmountValue, 0, 0.25, 0.01, formatGrainAmount(grainAmountValue))}
${makeCheckRow("VHS overlay", "Soft, lo-def magnetic tape look.", "opt_vhsOverlayEnabled", !!opt.vhsOverlayEnabled)}
${makeCheckRow("Film corners overlay", "Rounds media corners for an old film look.", "opt_filmCornerOverlayEnabled", !!opt.filmCornerOverlayEnabled)}
${makeRangeRow("VHS intensity", "Controls VHS blur + chroma together.", "opt_vhsIntensityAmount", vhsIntensityValue, 0, 3, 0.1, formatVhsIntensity(vhsIntensityValue))}
${makeSelectRow("Animated filters", "Control animation for scanlines/grain/jitter.", "opt_animatedMediaFilters", String(opt.animatedMediaFilters || "on"), animatedFilterModes)}
${makeCheckRow("GIFs ignore processing", "Keep GIFs playing unfiltered when media filters/overlays are enabled.", "opt_gifsIgnoreProcessing", !!opt.gifsIgnoreProcessing)}
          `
        },
        thumbnails: {
          title: "Thumbnails",
          rows: `
${thumbnailStyleRow}
${makeSelectRow("Thumbnail Scale", thumbnailScaleHint, "opt_thumbnailScale", getActiveThumbnailScale(opt), thumbnailScaleModes)}
${makeActionRow("Reset Edited Crops", "Reset custom crop/zoom edits for thumbnails while keeping thumbnail assignments.", `
  <button type="button" id="opt_thumb_reset_crops">Reset Edited Crops</button>
`)}
${makeActionRow("Reset Thumbnail Assignments", "Reset folder/tag/root thumbnail assignments to defaults while keeping crop edits.", `
  <button type="button" id="opt_thumb_reset_assignments">Reset Thumbnail Assignments</button>
`)}
${makeActionRow("Reset All Thumbnail Customizations", "Reset all edited crops and thumbnail assignments to defaults.", `
  <button type="button" id="opt_thumb_reset_all">Reset All Thumbnail Customizations</button>
`)}
${makeActionRow("Rebuild Thumbnail Cache", "Queue thumbnail regeneration for current content.", `
  <button type="button" id="opt_thumb_rebuild_cache">Rebuild Thumbnail Cache</button>
`)}
          `
        },
        playback: {
          title: "Playback",
          rows: `
${makeSelectRow("Preload next item", "Preload the next item for smoother browsing.", "opt_preloadNextMode", String(opt.preloadNextMode || "off"), preloadModes)}
${makeSelectRow("Slideshow speed", "Controls slideshow timing when toggled.", "opt_slideshowDefault", String(opt.slideshowDefault || "cycle"), slideshowModes)}
          `
        },
        filenames: {
          title: "Filenames",
          rows: `
${makeCheckRow("Force Title Case", "Apply Title Case to displayed file names.", "opt_forceTitleCaps", !!opt.forceTitleCaps)}
${makeCheckRow("Hide name before last ' - '", "Show only text after the last ' - ' in names.", "opt_hideBeforeLastDashInFileNames", !!opt.hideBeforeLastDashInFileNames)}
${makeCheckRow("Hide name after last underscore", "Show only text before the last underscore in file names.", "opt_hideAfterFirstUnderscoreInFileNames", !!opt.hideAfterFirstUnderscoreInFileNames)}
          `
        }
      };
      const activeSection = sections[sectionTab] ? sectionTab : "general";
      const section = sections[activeSection];

      optionsBodyEl.innerHTML = `
        <div class="label" style="margin-bottom:8px;">Option preferences are automatically stored in preferences.log.json in the .local-gallery system folder in the root directory.</div>
        <h1>${escapeHtml(section.title)}</h1>
        ${section.rows}
      `;
      applyDescriptionVisibilityFromOptions();

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

      const bindRange = (id, key, onChange, formatter) => {
        const el = $(id);
        if (!el) return;
        const valueEl = $(`${id}_value`);
        const updateValue = () => {
          if (!valueEl) return;
          const nextVal = parseFloat(el.value);
          valueEl.textContent = formatter ? formatter(nextVal) : String(el.value);
        };
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("input", updateValue);
        el.addEventListener("change", () => {
          const next = {};
          const val = parseFloat(el.value);
          next[key] = Number.isFinite(val) ? val : 0;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(next[key]);
          applyOptionsEverywhere(false);
        });
        updateValue();
      };

      const bindLinkedRange = (id, keys, onChange, formatter) => {
        const el = $(id);
        if (!el || !Array.isArray(keys) || !keys.length) return;
        const valueEl = $(`${id}_value`);
        const updateValue = () => {
          if (!valueEl) return;
          const nextVal = parseFloat(el.value);
          valueEl.textContent = formatter ? formatter(nextVal) : String(el.value);
        };
        el.addEventListener("click", (e) => e.stopPropagation());
        el.addEventListener("keydown", (e) => e.stopPropagation());
        el.addEventListener("input", updateValue);
        el.addEventListener("change", () => {
          const val = parseFloat(el.value);
          const nextVal = Number.isFinite(val) ? val : 0;
          const next = {};
          keys.forEach((k) => { next[k] = nextVal; });
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          if (typeof onChange === "function") onChange(nextVal);
          applyOptionsEverywhere(false);
        });
        updateValue();
      };

      const bindActionBtn = (id, onClick) => {
        const el = $(id);
        if (!el) return;
        el.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (typeof onClick === "function") onClick();
        });
        el.addEventListener("keydown", (e) => e.stopPropagation());
      };

      bindSelect("opt_preloadNextMode", "preloadNextMode", false, (val) => {
        if (val === "off") PRELOAD_CACHE = new Map();
      });
      bindSelect("opt_interactionMode", "interactionMode", false, (val) => {
        if (String(val || "") === "grid" && WS.nav.dirNode === WS.root) {
          WS.view.aboveRootView = false;
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      });
      bindSelect("opt_slideshowDefault", "slideshowDefault", false);
      bindCheck("opt_showGridUpDirectoryEntry", "showGridUpDirectoryEntry", () => {
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(Math.min(WS.nav.selectedIndex, Math.max(0, WS.nav.entries.length - 1)), 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
      });
      bindCheck("opt_showRootView", "showRootView", (enabled) => {
        if (enabled) return;
        if (WS.view.aboveRootView) {
          WS.view.aboveRootView = false;
          if (!WS.nav.dirNode && WS.root) WS.nav.dirNode = WS.root;
        }
        initDirHistory();
      });
      bindCheck("opt_showHiddenFolder", "showHiddenFolder", (enabled) => {
        if (!enabled && WS.view.tagFolderActiveMode === "hidden") {
          exitTagFolderView();
        }
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showUntaggedFolder", "showUntaggedFolder", (enabled) => {
        if (!enabled && WS.view.tagFolderActiveMode === "untagged") {
          exitTagFolderView();
        }
        renderDirectoriesPane(true);
      });
      bindCheck("opt_showTagFolderSpacerRow", "showTagFolderSpacerRow");
      bindCheck("opt_clickSelectedRotatingThumbTeleports", "clickSelectedRotatingThumbTeleports");
      bindCheck("opt_vibrantOverlayEnabled", "vibrantOverlayEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindRange("opt_vibrantOverlayIntensity", "vibrantOverlayIntensity", () => {
        applyMediaFilterFromOptions();
      }, formatVibrantOverlayIntensity);
      bindCheck("opt_crtScanlinesEnabled", "crtScanlinesEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_crtPixelateEnabled", "crtPixelateEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindRange("opt_crtPixelateResolution", "crtPixelateResolution", () => {
        applyMediaFilterFromOptions();
      }, formatPixelateResolution);
      bindCheck("opt_crtGrainEnabled", "crtGrainEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindRange("opt_crtGrainAmount", "crtGrainAmount", () => {
        applyMediaFilterFromOptions();
      }, formatGrainAmount);
      bindCheck("opt_vhsOverlayEnabled", "vhsOverlayEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindCheck("opt_filmCornerOverlayEnabled", "filmCornerOverlayEnabled", () => {
        applyMediaFilterFromOptions();
      });
      bindLinkedRange("opt_vhsIntensityAmount", ["vhsBlurAmount", "vhsChromaAmount"], () => {
        applyMediaFilterFromOptions();
      }, formatVhsIntensity);
      bindSelect("opt_animatedMediaFilters", "animatedMediaFilters", false, () => {
        applyMediaFilterFromOptions();
      }, (val) => normalizeAnimatedMediaFiltersValue(val, "on"));
      bindCheck("opt_gifsIgnoreProcessing", "gifsIgnoreProcessing", () => {
        applyMediaFilterFromOptions();
      });
      bindSelect("opt_thumbnailStyle", "thumbnailStyle", false, () => {
        if (MENU_ACTIVE_TAB === "thumbnails") {
          renderOptionsUi("thumbnails");
          setOptionsStatus("Saved");
        }
      }, (val) => {
        const raw = String(val || "").toLowerCase();
        return raw === "aspect" ? "aspect" : "cropped";
      });
      const thumbnailScaleSelect = $("opt_thumbnailScale");
      if (thumbnailScaleSelect) {
        thumbnailScaleSelect.addEventListener("click", (e) => e.stopPropagation());
        thumbnailScaleSelect.addEventListener("keydown", (e) => e.stopPropagation());
        thumbnailScaleSelect.addEventListener("change", () => {
          const style = getThumbnailStyleFromOptions(WS.meta && WS.meta.options ? WS.meta.options : null);
          const nextScale = normalizeThumbnailScaleValue(thumbnailScaleSelect.value, style === "aspect" ? "small" : "medium");
          const key = style === "aspect" ? "thumbnailScaleAspect" : "thumbnailScaleCropped";
          const next = {};
          next[key] = nextScale;
          WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, next));
          WS.meta.dirty = true;
          metaScheduleSave();
          setOptionsStatus("Saved");
          applyOptionsEverywhere(false);
          if (MENU_ACTIVE_TAB === "thumbnails") {
            renderOptionsUi("thumbnails");
            setOptionsStatus("Saved");
          }
        });
      }
      bindSelect("opt_randomActionMode", "randomActionMode", false, (val) => {
        if (val === "randomFileSort" || val === "randomFolderSort") return;
        if (!WS.view.randomMode && !WS.view.randomFolderMode) return;
        WS.view.randomMode = false;
        WS.view.randomFolderMode = false;
        WS.view.randomCache = new Map();
        WS.view.randomFolderCache = new Map();
        applyRandomSortModeEverywhere(true);
      });
      bindCheck("opt_forceTitleCaps", "forceTitleCaps");
      bindCheck("opt_hideBeforeLastDashInFileNames", "hideBeforeLastDashInFileNames");
      bindCheck("opt_hideAfterFirstUnderscoreInFileNames", "hideAfterFirstUnderscoreInFileNames");
      bindActionBtn("opt_thumb_reset_crops", () => {
        const count = WS.meta && WS.meta.fileThumbCrop ? WS.meta.fileThumbCrop.size : 0;
        if (!count) {
          setOptionsStatus("No changes");
          showStatusMessage("No edited thumbnail crops to reset.");
          return;
        }
        const ok = confirm(`Reset ${count} edited thumbnail crop${count === 1 ? "" : "s"}?`);
        if (!ok) return;
        const removed = clearEditedThumbnailCrops();
        applyOptionsEverywhere(false);
        setOptionsStatus("Saved");
        showStatusMessage(`Reset ${removed} edited thumbnail crop${removed === 1 ? "" : "s"}.`);
      });
      bindActionBtn("opt_thumb_reset_assignments", () => {
        const dirCount = WS.meta && WS.meta.dirThumbPresets ? WS.meta.dirThumbPresets.size : 0;
        const tagPresetCount = WS.meta && WS.meta.tagThumbPresets ? WS.meta.tagThumbPresets.size : 0;
        const tagModeCount = WS.meta && WS.meta.tagThumbModes ? WS.meta.tagThumbModes.size : 0;
        const total = dirCount + tagPresetCount + tagModeCount;
        if (!total) {
          setOptionsStatus("No changes");
          showStatusMessage("No custom thumbnail assignments to reset.");
          return;
        }
        const ok = confirm(`Reset ${total} custom thumbnail assignment${total === 1 ? "" : "s"} to defaults?`);
        if (!ok) return;
        const removed = clearThumbnailAssignmentsToDefaults();
        applyOptionsEverywhere(false);
        setOptionsStatus("Saved");
        showStatusMessage(`Reset ${removed} thumbnail assignment${removed === 1 ? "" : "s"} to defaults.`);
      });
      bindActionBtn("opt_thumb_reset_all", () => {
        const cropCount = WS.meta && WS.meta.fileThumbCrop ? WS.meta.fileThumbCrop.size : 0;
        const dirCount = WS.meta && WS.meta.dirThumbPresets ? WS.meta.dirThumbPresets.size : 0;
        const tagPresetCount = WS.meta && WS.meta.tagThumbPresets ? WS.meta.tagThumbPresets.size : 0;
        const tagModeCount = WS.meta && WS.meta.tagThumbModes ? WS.meta.tagThumbModes.size : 0;
        const total = cropCount + dirCount + tagPresetCount + tagModeCount;
        if (!total) {
          setOptionsStatus("No changes");
          showStatusMessage("No custom thumbnail data to reset.");
          return;
        }
        const ok = confirm("Reset all thumbnail edits and assignments to defaults?");
        if (!ok) return;
        const summary = clearAllThumbnailCustomizations();
        applyOptionsEverywhere(false);
        setOptionsStatus("Saved");
        showStatusMessage(`Reset ${summary.total} thumbnail customization${summary.total === 1 ? "" : "s"}.`);
      });
      bindActionBtn("opt_thumb_rebuild_cache", () => {
        invalidateAllThumbs();
        applyOptionsEverywhere(false);
        setOptionsStatus("Saved");
        showStatusMessage("Thumbnail cache rebuild queued.");
      });

      const dirSortSelect = $("opt_dirSortMode");
      if (dirSortSelect) {
        dirSortSelect.addEventListener("click", (e) => e.stopPropagation());
        dirSortSelect.addEventListener("keydown", (e) => e.stopPropagation());
        dirSortSelect.addEventListener("change", () => {
          WS.meta.dirSortMode = normalizeDirSortMode(dirSortSelect.value);
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

    if (keybindsDoneBtn) keybindsDoneBtn.addEventListener("click", () => closeMenu());
    if (keybindsResetBtn) keybindsResetBtn.addEventListener("click", () => resetKeybindsToDefaults());

    if (optionsDoneBtn) optionsDoneBtn.addEventListener("click", () => closeMenu());
    if (optionsResetBtn) optionsResetBtn.addEventListener("click", () => resetOptionsToDefaults());
    if (calendarDoneBtn) calendarDoneBtn.addEventListener("click", () => closeMenu());
    if (calendarDeleteAllBtn) {
      calendarDeleteAllBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const count = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory.length : 0;
        if (!count) {
          setCalendarStatus("No logs");
          return;
        }
        const ok = confirm(`Delete all ${count} score log event${count === 1 ? "" : "s"}?`);
        if (!ok) return;
        WS.meta.scoreHistory = [];
        WS.meta.dirty = true;
        metaScheduleSave();
        renderCalendarUi();
        setCalendarStatus("Saved");
        showStatusMessage("Score history cleared.");
      });
    }
    if (calendarBodyEl) {
      calendarBodyEl.addEventListener("click", (e) => {
        const lineBtn = e.target && e.target.closest ? e.target.closest("button[data-score-history-delete-line-event][data-score-history-delete-line-root]") : null;
        if (lineBtn) {
          e.preventDefault();
          e.stopPropagation();
          const id = String(lineBtn.getAttribute("data-score-history-delete-line-event") || "");
          const rootPath = String(lineBtn.getAttribute("data-score-history-delete-line-root") || "");
          const removed = removeScoreHistoryLineByEventAndRoot(id, rootPath);
          if (removed > 0) {
            WS.meta.dirty = true;
            metaScheduleSave();
            renderCalendarUi();
            setCalendarStatus("Saved");
            showStatusMessage("Score log line deleted.");
          } else {
            setCalendarStatus("No changes");
          }
          return;
        }
        const eventBtn = e.target && e.target.closest ? e.target.closest("button[data-score-history-delete-event]") : null;
        if (eventBtn) {
          e.preventDefault();
          e.stopPropagation();
          const id = String(eventBtn.getAttribute("data-score-history-delete-event") || "");
          const removed = removeScoreHistoryEntryById(id);
          if (removed > 0) {
            WS.meta.dirty = true;
            metaScheduleSave();
            renderCalendarUi();
            setCalendarStatus("Saved");
            showStatusMessage("Score log entry deleted.");
          } else {
            setCalendarStatus("No changes");
          }
          return;
        }
        const dayBtn = e.target && e.target.closest ? e.target.closest("button[data-score-history-delete-day]") : null;
        if (dayBtn) {
          e.preventDefault();
          e.stopPropagation();
          const dayKey = String(dayBtn.getAttribute("data-score-history-delete-day") || "");
          if (!dayKey) return;
          const ok = confirm(`Delete all score log events on ${scoreHistoryDateLabel(dayKey)}?`);
          if (!ok) return;
          const removed = removeScoreHistoryEntriesByDateKey(dayKey);
          if (removed > 0) {
            WS.meta.dirty = true;
            metaScheduleSave();
            renderCalendarUi();
            setCalendarStatus("Saved");
            showStatusMessage(`Deleted ${removed} score log event${removed === 1 ? "" : "s"}.`);
          } else {
            setCalendarStatus("No changes");
          }
        }
      });
    }

    /* =========================================================
       Workspace loading (read-only input)
       ========================================================= */
    function getBulkSelectionKey() {
      if (isViewingTagFolder()) {
        return `tag:${String(WS.view.tagFolderActiveMode || "")}:${String(WS.view.tagFolderActiveTag || "")}:${String(WS.view.tagFolderActiveAlbum || "")}:${String(WS.view.tagFolderOriginPath || "")}`;
      }
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
      if (WS.view.bulkTagFolderSelectedKeys && WS.view.bulkTagFolderSelectedKeys.clear) WS.view.bulkTagFolderSelectedKeys.clear();
      if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear) WS.view.bulkFileSelectedIds.clear();
    }

    function finalizeBulkSelectionAction() {
      if (!WS.view.bulkSelectMode &&
          !(WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.size) &&
          !(WS.view.bulkTagFolderSelectedKeys && WS.view.bulkTagFolderSelectedKeys.size) &&
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
      if (!WS.view.bulkTagFolderSelectionsByDir) WS.view.bulkTagFolderSelectionsByDir = new Map();
      if (!WS.view.bulkTagFolderSelectionsByDir.has(p)) WS.view.bulkTagFolderSelectionsByDir.set(p, new Set());
      WS.view.bulkTagFolderSelectedKeys = WS.view.bulkTagFolderSelectionsByDir.get(p);
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

    function normalizeVideoPlaybackRate(vid) {
      if (!vid) return;
      try {
        vid.defaultPlaybackRate = 1;
        vid.playbackRate = 1;
      } catch {}
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

    function inferRootNameFromFileList(fileList) {
      let rootName = "";
      for (const f of Array.from(fileList || [])) {
        if (!f || !f.name) continue;
        const relPath = String(f.webkitRelativePath || f.name || "");
        if (!relPath) continue;
        const parts = relPath.split("/").filter(Boolean);
        if (parts.length < 2) continue;
        const top = String(parts[0] || "").trim();
        if (!top) continue;
        if (!rootName) {
          rootName = top;
          continue;
        }
        if (rootName !== top) return "root";
      }
      return rootName || "root";
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

    const SCORE_HISTORY_MAX_ENTRIES = 4000;

    function scoreHistoryDateKey(ts) {
      const d = new Date(Number(ts) || Date.now());
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    }

    function normalizeScoreHistoryEntry(raw) {
      if (!raw || typeof raw !== "object") return null;
      const atRaw = Number(raw.at);
      const at = Number.isFinite(atRaw) && atRaw > 0 ? Math.floor(atRaw) : Date.now();
      const idRaw = String(raw.id || "").trim();
      const id = idRaw || `score-${at}-${Math.random().toString(36).slice(2, 10)}`;
      const selectedPathsRaw = Array.isArray(raw.selectedPaths) ? raw.selectedPaths : [];
      const selectedPaths = [];
      const selectedSeen = new Set();
      for (let i = 0; i < selectedPathsRaw.length; i++) {
        if (selectedPathsRaw[i] == null) continue;
        const p = String(selectedPathsRaw[i]);
        if (!p && p !== "") continue;
        if (selectedSeen.has(p)) continue;
        selectedSeen.add(p);
        selectedPaths.push(p);
      }
      const changedRaw = Array.isArray(raw.changed) ? raw.changed : [];
      const changed = [];
      for (let i = 0; i < changedRaw.length; i++) {
        const it = changedRaw[i];
        if (!it || typeof it !== "object") continue;
        const path = String(it.path || "");
        if (!path && path !== "") continue;
        const delta = Number(it.delta) | 0;
        const before = Number(it.before) | 0;
        const after = Number(it.after) | 0;
        changed.push({ path, delta, before, after });
      }
      if (!changed.length) return null;
      changed.sort((a, b) => {
        const da = String(a.path || "").split("/").filter(Boolean).length;
        const db = String(b.path || "").split("/").filter(Boolean).length;
        if (da !== db) return db - da;
        return String(a.path || "").localeCompare(String(b.path || ""));
      });
      return { id, at, selectedPaths, changed };
    }

    function normalizeScoreHistoryList(list) {
      const src = Array.isArray(list) ? list : [];
      const out = [];
      const seenIds = new Set();
      for (let i = 0; i < src.length; i++) {
        const entry = normalizeScoreHistoryEntry(src[i]);
        if (!entry) continue;
        if (seenIds.has(entry.id)) continue;
        seenIds.add(entry.id);
        out.push(entry);
      }
      out.sort((a, b) => (b.at | 0) - (a.at | 0));
      if (out.length > SCORE_HISTORY_MAX_ENTRIES) out.length = SCORE_HISTORY_MAX_ENTRIES;
      return out;
    }

    function addScoreHistoryEntry(entry) {
      const normalized = normalizeScoreHistoryEntry(entry);
      if (!normalized) return false;
      const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
      src.unshift(normalized);
      const out = normalizeScoreHistoryList(src);
      WS.meta.scoreHistory = out;
      return true;
    }

    function removeScoreHistoryEntryById(id) {
      const key = String(id || "");
      if (!key) return 0;
      const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
      const next = src.filter((entry) => String(entry && entry.id || "") !== key);
      const removed = src.length - next.length;
      if (removed > 0) WS.meta.scoreHistory = normalizeScoreHistoryList(next);
      return removed;
    }

    function removeScoreHistoryEntriesByDateKey(dateKey) {
      const key = String(dateKey || "");
      if (!key) return 0;
      const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
      const next = src.filter((entry) => scoreHistoryDateKey(entry && entry.at) !== key);
      const removed = src.length - next.length;
      if (removed > 0) WS.meta.scoreHistory = normalizeScoreHistoryList(next);
      return removed;
    }

    function removeScoreHistoryLineByEventAndRoot(eventId, rootPath) {
      const id = String(eventId || "").trim();
      const root = normalizeDirPathValue(rootPath);
      if (!id || !root) return 0;
      const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
      if (!src.length) return 0;
      const next = [];
      let removed = 0;
      for (let i = 0; i < src.length; i++) {
        const normalizedEntry = normalizeScoreHistoryEntry(src[i]);
        if (!normalizedEntry) continue;
        if (String(normalizedEntry.id || "") !== id) {
          next.push(normalizedEntry);
          continue;
        }
        const removedFromEntry = getRootScoreHistoryLinesForEntry(normalizedEntry).filter((line) => String(line.rootPath || "") === root).length;
        if (!removedFromEntry) {
          next.push(normalizedEntry);
          continue;
        }
        const changed = normalizedEntry.changed.filter((item) => scoreHistoryRootPathFromChangedPath(item.path) !== root);
        const nextEntry = Object.assign({}, normalizedEntry, { changed });
        if (getRootScoreHistoryLinesForEntry(nextEntry).length) {
          next.push(nextEntry);
        }
        removed += removedFromEntry;
      }
      if (removed > 0) WS.meta.scoreHistory = normalizeScoreHistoryList(next);
      return removed;
    }

    function scorePropagationChain(path) {
      const raw = String(path || "").trim();
      if (!raw) return [""];
      const segs = raw.split("/").filter(Boolean);
      if (!segs.length) return [""];
      const out = [];
      for (let i = segs.length; i > 0; i--) {
        out.push(segs.slice(0, i).join("/"));
      }
      out.push("");
      return out;
    }

    function applyScoreMutationRender(focusPath = "") {
      syncMetaButtons();
      if (MENU_OPEN && MENU_ACTIVE_TAB === "calendar") {
        renderCalendarUi();
        setCalendarStatus("Saved");
      }
      if (WS.meta.dirSortMode === "score") {
        rebuildDirectoriesEntries();
        const idx = findDirEntryIndexByPath(String(focusPath || ""));
        WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        WS.view.pendingDirScroll = "center-selected";
        renderDirectoriesPane(false);
        renderPreviewPane(true, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        return;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
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
      applyScoreMutationRender(p);
    }

    function metaBumpScore(path, delta) {
      const p = String(path || "");
      metaBumpScoreBulk([p], delta);
    }

    function metaBumpScoreBulk(paths, delta) {
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;
      const d = delta | 0;
      if (!d) return;
      const currentEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
      const currentPath = (currentEntry && currentEntry.kind === "dir")
        ? String(currentEntry.node?.path || "")
        : "";
      const selectedPaths = [];
      const selectedSeen = new Set();
      for (let i = 0; i < list.length; i++) {
        if (list[i] == null) continue;
        const p = String(list[i]);
        if (!p && p !== "") continue;
        if (p !== "" && !WS.dirByPath.has(p)) continue;
        if (selectedSeen.has(p)) continue;
        selectedSeen.add(p);
        selectedPaths.push(p);
      }
      if (!selectedPaths.length) return;

      let focusPath = currentPath && selectedPaths.some((p) => String(p || "") === currentPath)
        ? currentPath
        : String(selectedPaths[0] || "");

      const deltaByPath = new Map();
      for (let i = 0; i < selectedPaths.length; i++) {
        const p = selectedPaths[i];
        const chain = scorePropagationChain(p);
        for (let j = 0; j < chain.length; j++) {
          const targetPath = chain[j];
          if (targetPath !== "" && !WS.dirByPath.has(targetPath)) continue;
          deltaByPath.set(targetPath, (deltaByPath.get(targetPath) || 0) + d);
        }
      }
      if (!deltaByPath.size) return;

      const changed = [];
      for (const [path, scoreDelta] of deltaByPath.entries()) {
        const before = metaGetScore(path);
        const after = (before + (scoreDelta | 0)) | 0;
        WS.meta.dirScores.set(path, after);
        changed.push({
          path,
          delta: scoreDelta | 0,
          before,
          after
        });
      }

      addScoreHistoryEntry({
        at: Date.now(),
        selectedPaths,
        changed
      });

      WS.meta.dirty = true;
      metaScheduleSave();
      applyScoreMutationRender(focusPath);
    }

    function normalizeTag(t) {
      const s = String(t || "").trim().toLowerCase();
      return s;
    }

    function normalizeTagAlbumName(name) {
      return normalizeTag(name);
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

    function isReservedFolderTag(tag) {
      const t = String(tag || "");
      return t === FAVORITE_TAG || t === HIDDEN_TAG || t === PROCESSING_DISABLED_TAG;
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
      const preserved = existing.filter(t => isReservedFolderTag(t));
      const normalized = normalizeTagList(userTags).filter(t => !isReservedFolderTag(t));
      const merged = preserved.slice();
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
      return tags.filter(t => !isReservedFolderTag(t));
    }

    function metaGetTagAlbumForTag(tagName) {
      const tag = normalizeTag(tagName);
      if (!tag || !WS.meta || !WS.meta.tagAlbumByTag) return "";
      return normalizeTagAlbumName(WS.meta.tagAlbumByTag.get(tag));
    }

    function metaSetTagAlbumForTag(tagName, albumName) {
      const tag = normalizeTag(tagName);
      if (!tag || !WS.meta || !WS.meta.tagAlbumByTag) return false;
      const album = normalizeTagAlbumName(albumName);
      const prev = metaGetTagAlbumForTag(tag);
      if (!album) {
        if (!prev) return false;
        WS.meta.tagAlbumByTag.delete(tag);
        WS.meta.dirty = true;
        return true;
      }
      if (prev === album) return false;
      WS.meta.tagAlbumByTag.set(tag, album);
      WS.meta.dirty = true;
      return true;
    }

    function metaHasFavorite(path) {
      const tags = metaGetTags(path);
      return tags.includes(FAVORITE_TAG);
    }

    function metaHasHidden(path) {
      const tags = metaGetTags(path);
      return tags.includes(HIDDEN_TAG);
    }

    function metaHasProcessingDisabled(path) {
      const tags = metaGetTags(path);
      return tags.includes(PROCESSING_DISABLED_TAG);
    }

    function normalizeDirPathValue(path) {
      return String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    }

    function normalizeThumbCropValue(crop) {
      const src = (crop && typeof crop === "object") ? crop : {};
      const xRaw = Number(src.x);
      const yRaw = Number(src.y);
      const zoomRaw = Number(src.zoom);
      const x = Number.isFinite(xRaw) ? Math.min(100, Math.max(0, xRaw)) : 50;
      const y = Number.isFinite(yRaw) ? Math.min(100, Math.max(0, yRaw)) : 50;
      const zoom = Number.isFinite(zoomRaw) ? Math.min(4, Math.max(1, zoomRaw)) : 1;
      return {
        x: Math.round(x * 1000) / 1000,
        y: Math.round(y * 1000) / 1000,
        zoom: Math.round(zoom * 1000) / 1000
      };
    }

    function isThumbCropDefault(crop) {
      const normalized = normalizeThumbCropValue(crop);
      return normalized.x === 50 && normalized.y === 50 && normalized.zoom === 1;
    }

    function normalizeVideoThumbTimeValue(timeValue, durationHint = null) {
      const raw = Number(timeValue);
      if (!Number.isFinite(raw)) return null;
      let out = Math.max(0, raw);
      const duration = Number(durationHint);
      if (Number.isFinite(duration) && duration > 0) {
        out = Math.min(out, Math.max(0, duration - 0.05));
      }
      return Math.round(out * 1000) / 1000;
    }

    function metaGetVideoThumbnailTimeByRelPath(relPath) {
      const key = normalizeWorkspaceRelPath(relPath);
      if (!key || !WS.meta || !WS.meta.videoThumbTime || !WS.meta.videoThumbTime.has(key)) return null;
      return normalizeVideoThumbTimeValue(WS.meta.videoThumbTime.get(key));
    }

    function metaGetVideoThumbnailTimeForRecord(rec) {
      if (!rec || rec.type !== "video") return null;
      return metaGetVideoThumbnailTimeByRelPath(rec.relPath);
    }

    function metaSetVideoThumbnailTimeForRecord(rec, timeValue, durationHint = null) {
      if (!rec || rec.type !== "video") return false;
      const key = normalizeWorkspaceRelPath(rec.relPath);
      if (!key || !WS.meta || !WS.meta.videoThumbTime) return false;
      const normalized = normalizeVideoThumbTimeValue(timeValue, durationHint);
      if (!Number.isFinite(normalized)) {
        const had = WS.meta.videoThumbTime.delete(key);
        if (had) {
          WS.meta.dirty = true;
          metaScheduleSave();
        }
        return had;
      }
      const prev = metaGetVideoThumbnailTimeByRelPath(key);
      if (Number.isFinite(prev) && Math.abs(prev - normalized) < 0.001) return false;
      WS.meta.videoThumbTime.set(key, normalized);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function metaGetFileThumbnailCropByRelPath(relPath) {
      const key = normalizeWorkspaceRelPath(relPath);
      if (!key || !WS.meta || !WS.meta.fileThumbCrop || !WS.meta.fileThumbCrop.has(key)) return null;
      return normalizeThumbCropValue(WS.meta.fileThumbCrop.get(key));
    }

    function metaGetFileThumbnailCropForRecord(rec) {
      return metaGetFileThumbnailCropByRelPath(rec && rec.relPath);
    }

    function metaSetFileThumbnailCropForRecord(rec, crop) {
      const key = normalizeWorkspaceRelPath(rec && rec.relPath);
      if (!key || !WS.meta || !WS.meta.fileThumbCrop) return false;
      const normalized = normalizeThumbCropValue(crop);
      if (isThumbCropDefault(normalized)) {
        const had = WS.meta.fileThumbCrop.delete(key);
        if (had) {
          WS.meta.dirty = true;
          metaScheduleSave();
        }
        return had;
      }
      const prev = metaGetFileThumbnailCropByRelPath(key);
      if (prev && prev.x === normalized.x && prev.y === normalized.y && prev.zoom === normalized.zoom) return false;
      WS.meta.fileThumbCrop.set(key, normalized);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function computeCoverCropLayout(aspect, crop) {
      const ar = (Number.isFinite(Number(aspect)) && Number(aspect) > 0) ? Number(aspect) : 1;
      const c = normalizeThumbCropValue(crop);
      const baseW = ar >= 1 ? ar : 1;
      const baseH = ar >= 1 ? 1 : (1 / ar);
      const w = baseW * c.zoom;
      const h = baseH * c.zoom;
      const u = c.x / 100;
      const v = c.y / 100;
      const minX = 1 - w;
      const minY = 1 - h;
      const left = Math.min(0, Math.max(minX, minX * u));
      const top = Math.min(0, Math.max(minY, minY * v));
      return {
        widthPct: Math.round(w * 100000) / 1000,
        heightPct: Math.round(h * 100000) / 1000,
        leftPct: Math.round(left * 100000) / 1000,
        topPct: Math.round(top * 100000) / 1000
      };
    }

    function computeEditorCropWindow(aspect, crop) {
      const ar = (Number.isFinite(Number(aspect)) && Number(aspect) > 0) ? Number(aspect) : 1;
      const c = normalizeThumbCropValue(crop);
      const safeZoom = Math.max(1, c.zoom);
      const widthFrac = ar >= 1 ? (1 / (ar * safeZoom)) : (1 / safeZoom);
      const heightFrac = ar >= 1 ? (1 / safeZoom) : (ar / safeZoom);
      const clampedW = Math.max(0.0001, Math.min(1, widthFrac));
      const clampedH = Math.max(0.0001, Math.min(1, heightFrac));
      const rangeX = Math.max(0, 1 - clampedW);
      const rangeY = Math.max(0, 1 - clampedH);
      const left = rangeX * (c.x / 100);
      const top = rangeY * (c.y / 100);
      return {
        leftPct: Math.round(left * 100000) / 1000,
        topPct: Math.round(top * 100000) / 1000,
        widthPct: Math.round(clampedW * 100000) / 1000,
        heightPct: Math.round(clampedH * 100000) / 1000,
        rangeXPct: Math.round(rangeX * 100000) / 1000,
        rangeYPct: Math.round(rangeY * 100000) / 1000
      };
    }

    function fileThumbCropLayoutStyle(rec, rotateKey = "") {
      if (!rec || rotateKey) return "";
      if (naturalAspectThumbnailCardsEnabled()) return "";
      const crop = metaGetFileThumbnailCropForRecord(rec);
      if (!crop) return "";
      const aspect = getPreviewAspectForRecord(rec);
      const layout = computeCoverCropLayout(aspect, crop);
      return `width:${layout.widthPct}% !important;height:${layout.heightPct}% !important;left:${layout.leftPct}% !important;top:${layout.topPct}% !important;`;
    }

    function inferFolderThumbnailDefaultMode(path) {
      const p = normalizeDirPathValue(path);
      if (!p) return "rotate";
      const node = WS.dirByPath ? WS.dirByPath.get(p) : null;
      if (!node) return "rotate";
      const hasImmediateFiles = Array.isArray(node.childrenFiles) && node.childrenFiles.length > 0;
      return hasImmediateFiles ? "rotate" : "none";
    }

    function metaGetFolderThumbnailMode(path) {
      const p = normalizeDirPathValue(path);
      if (!WS.meta || !WS.meta.dirThumbPresets || !WS.meta.dirThumbPresets.has(p)) {
        return inferFolderThumbnailDefaultMode(p);
      }
      const raw = String(WS.meta.dirThumbPresets.get(p) || "");
      if (raw === FOLDER_THUMB_NONE_SENTINEL) return "none";
      if (raw === FOLDER_THUMB_ROTATE_SENTINEL) return "rotate";
      const normalizedRelPath = normalizeWorkspaceRelPath(raw);
      return normalizedRelPath ? "manual" : inferFolderThumbnailDefaultMode(p);
    }

    function metaGetFolderThumbnailPresetRelPath(path) {
      const p = normalizeDirPathValue(path);
      if (!WS.meta || !WS.meta.dirThumbPresets) return "";
      const raw = WS.meta.dirThumbPresets.get(p);
      if (String(raw || "") === FOLDER_THUMB_NONE_SENTINEL) return "";
      return normalizeWorkspaceRelPath(raw);
    }

    function metaHasFolderThumbnailPreset(path) {
      return metaGetFolderThumbnailMode(path) === "manual";
    }

    function metaSetFolderThumbnailPreset(path, relPath) {
      if (!WS.meta || !WS.meta.dirThumbPresets) return false;
      const p = normalizeDirPathValue(path);
      if (!WS.dirByPath.has(p)) return false;
      const normalizedRelPath = normalizeWorkspaceRelPath(relPath);
      if (!normalizedRelPath) return false;
      const prev = metaGetFolderThumbnailPresetRelPath(p);
      if (prev === normalizedRelPath && metaGetFolderThumbnailMode(p) === "manual") return false;
      WS.meta.dirThumbPresets.set(p, normalizedRelPath);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function metaSetFolderThumbnailNone(path) {
      if (!WS.meta || !WS.meta.dirThumbPresets) return false;
      const p = normalizeDirPathValue(path);
      if (!WS.dirByPath.has(p)) return false;
      if (metaGetFolderThumbnailMode(p) === "none") return false;
      WS.meta.dirThumbPresets.set(p, FOLDER_THUMB_NONE_SENTINEL);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function metaSetFolderThumbnailRotate(path) {
      if (!WS.meta || !WS.meta.dirThumbPresets) return false;
      const p = normalizeDirPathValue(path);
      if (!WS.dirByPath.has(p)) return false;
      if (metaGetFolderThumbnailMode(p) === "rotate") return false;
      WS.meta.dirThumbPresets.set(p, FOLDER_THUMB_ROTATE_SENTINEL);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function metaClearFolderThumbnailPreset(path) {
      if (!WS.meta || !WS.meta.dirThumbPresets) return false;
      const p = normalizeDirPathValue(path);
      if (!WS.meta.dirThumbPresets.has(p)) return false;
      WS.meta.dirThumbPresets.delete(p);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function remapFolderThumbnailPresetValues(relPathMap) {
      if (!WS.meta || !relPathMap || !relPathMap.size) return;
      const next = new Map();
      if (WS.meta.dirThumbPresets) {
        for (const [dirPath, relPath] of WS.meta.dirThumbPresets.entries()) {
          const raw = String(relPath || "");
          if (raw === FOLDER_THUMB_NONE_SENTINEL || raw === FOLDER_THUMB_ROTATE_SENTINEL) {
            next.set(dirPath, raw);
            continue;
          }
          const from = normalizeWorkspaceRelPath(relPath);
          const to = relPathMap.get(from) || from;
          next.set(dirPath, normalizeWorkspaceRelPath(to));
        }
        WS.meta.dirThumbPresets = next;
      }
      if (WS.meta.tagThumbPresets) {
        const nextTag = new Map();
        for (const [tagKey, relPath] of WS.meta.tagThumbPresets.entries()) {
          const from = normalizeWorkspaceRelPath(relPath);
          const to = relPathMap.get(from) || from;
          const normalized = normalizeWorkspaceRelPath(to);
          if (!normalized) continue;
          nextTag.set(String(tagKey || ""), normalized);
        }
        WS.meta.tagThumbPresets = nextTag;
      }
      if (WS.meta.fileThumbCrop) {
        const nextFile = new Map();
        for (const [relPath, crop] of WS.meta.fileThumbCrop.entries()) {
          const from = normalizeWorkspaceRelPath(relPath);
          const to = relPathMap.get(from) || from;
          const normalized = normalizeWorkspaceRelPath(to);
          if (!normalized) continue;
          nextFile.set(normalized, normalizeThumbCropValue(crop));
        }
        WS.meta.fileThumbCrop = nextFile;
      }
      if (WS.meta.videoThumbTime) {
        const nextVideoTime = new Map();
        for (const [relPath, timeValue] of WS.meta.videoThumbTime.entries()) {
          const from = normalizeWorkspaceRelPath(relPath);
          const to = relPathMap.get(from) || from;
          const normalized = normalizeWorkspaceRelPath(to);
          const normalizedTime = normalizeVideoThumbTimeValue(timeValue);
          if (!normalized || !Number.isFinite(normalizedTime)) continue;
          nextVideoTime.set(normalized, normalizedTime);
        }
        WS.meta.videoThumbTime = nextVideoTime;
      }
    }

    function metaSetFolderThumbnailModeBulk(paths, mode) {
      const nextMode = (mode === "none") ? "none" : "rotate";
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return false;
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const p = normalizeDirPathValue(list[i]);
        if (!p || !WS.dirByPath.has(p)) continue;
        if (nextMode === "none") {
          if (metaSetFolderThumbnailNone(p)) changed = true;
        } else if (metaSetFolderThumbnailRotate(p)) {
          changed = true;
        }
      }
      return changed;
    }

    function normalizeTagThumbnailMode(mode) {
      const raw = String(mode || "").trim().toLowerCase();
      if (raw === "none" || raw === "single" || raw === "quad") return raw;
      return "quad";
    }

    function tagThumbnailKeyForTag(tagName, scopePath = null) {
      const tag = normalizeTag(String(tagName || ""));
      if (!tag) return "";
      if (scopePath == null) return `tag:${tag}`;
      const scopeKey = tagThumbnailScopeKeyFromPath(scopePath);
      return `tag-scope:${encodeURIComponent(tag)}:${encodeURIComponent(scopeKey)}`;
    }

    function tagThumbnailKeyForAlbum(albumName, scopePath = null) {
      const album = normalizeTagAlbumName(String(albumName || ""));
      if (!album) return "";
      if (scopePath == null) return `tag-album:${album}`;
      const scopeKey = tagThumbnailScopeKeyFromPath(scopePath);
      return `tag-album-scope:${encodeURIComponent(album)}:${encodeURIComponent(scopeKey)}`;
    }

    function parseTagThumbnailStructuredKey(tagKey) {
      const key = String(tagKey || "");
      if (!key) return null;
      if (key.startsWith("tag-scope:")) {
        const body = key.slice("tag-scope:".length);
        const sep = body.indexOf(":");
        if (sep <= 0) return null;
        try {
          const tag = normalizeTag(decodeURIComponent(body.slice(0, sep)));
          const scopeRaw = decodeURIComponent(body.slice(sep + 1));
          const scopePath = tagThumbnailScopePathFromKey(scopeRaw);
          if (!tag) return null;
          return { kind: "tag", value: tag, scopePath, scoped: true };
        } catch {
          return null;
        }
      }
      if (key.startsWith("tag-album-scope:")) {
        const body = key.slice("tag-album-scope:".length);
        const sep = body.indexOf(":");
        if (sep <= 0) return null;
        try {
          const album = normalizeTagAlbumName(decodeURIComponent(body.slice(0, sep)));
          const scopeRaw = decodeURIComponent(body.slice(sep + 1));
          const scopePath = tagThumbnailScopePathFromKey(scopeRaw);
          if (!album) return null;
          return { kind: "album", value: album, scopePath, scoped: true };
        } catch {
          return null;
        }
      }
      if (key.startsWith("tag:")) {
        const tag = normalizeTag(key.slice(4));
        if (!tag) return null;
        return { kind: "tag", value: tag, scopePath: "", scoped: false };
      }
      if (key.startsWith("tag-album:")) {
        const album = normalizeTagAlbumName(key.slice("tag-album:".length));
        if (!album) return null;
        return { kind: "album", value: album, scopePath: "", scoped: false };
      }
      return null;
    }

    function tagThumbnailScopeLabelForPath(scopePath) {
      const normalized = normalizeDirPathValue(scopePath);
      if (!normalized) return "root";
      const node = WS.dirByPath.get(normalized) || null;
      return displayPath(normalized) || dirDisplayName(node) || normalized || "folder";
    }

    function getAllTagThumbnailStateKeys() {
      const out = new Set();
      if (WS.meta && WS.meta.tagThumbModes) {
        for (const key of WS.meta.tagThumbModes.keys()) {
          const raw = String(key || "");
          if (raw) out.add(raw);
        }
      }
      if (WS.meta && WS.meta.tagThumbPresets) {
        for (const key of WS.meta.tagThumbPresets.keys()) {
          const raw = String(key || "");
          if (raw) out.add(raw);
        }
      }
      return Array.from(out);
    }

    function rekeyTagThumbnailState(oldKey, newKey) {
      const source = String(oldKey || "");
      const target = String(newKey || "");
      if (!source || !target || source === target) return false;
      let changed = false;
      if (WS.meta && WS.meta.tagThumbModes && WS.meta.tagThumbModes.has(source)) {
        const oldMode = metaGetTagThumbnailModeByKey(source);
        if (!WS.meta.tagThumbModes.has(target)) {
          WS.meta.tagThumbModes.set(target, oldMode);
        }
        WS.meta.tagThumbModes.delete(source);
        changed = true;
      }
      if (WS.meta && WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.has(source)) {
        const oldPreset = metaGetTagThumbnailPresetRelPathByKey(source);
        if (!WS.meta.tagThumbPresets.has(target) && oldPreset) {
          WS.meta.tagThumbPresets.set(target, oldPreset);
        }
        WS.meta.tagThumbPresets.delete(source);
        changed = true;
      }
      return changed;
    }

    function clearTagThumbnailStateByMatch(matchFn) {
      if (typeof matchFn !== "function") return false;
      const keys = getAllTagThumbnailStateKeys();
      let changed = false;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (!key || !matchFn(key)) continue;
        const modeChanged = !!(WS.meta && WS.meta.tagThumbModes && WS.meta.tagThumbModes.delete(key));
        const presetChanged = !!(WS.meta && WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.delete(key));
        if (modeChanged || presetChanged) changed = true;
      }
      return changed;
    }

    function tagThumbnailScopeKeyFromPath(path) {
      const normalized = normalizeDirPathValue(path);
      return normalized ? normalized : "__root__";
    }

    function tagThumbnailScopePathFromKey(scopeKey) {
      const raw = String(scopeKey || "");
      return raw === "__root__" ? "" : raw;
    }

    function rootThumbnailKey() {
      return "special:root";
    }

    function tagThumbnailKeyForEntry(entry) {
      if (!entry || entry.kind !== "tag") return "";
      const scopePath = String(entry.originPath != null ? entry.originPath : (WS.nav?.dirNode?.path || ""));
      if (entry.special) {
        if (entry.special === "favorites") {
          return `special:favorites:${tagThumbnailScopeKeyFromPath(scopePath)}`;
        }
        return `special:${String(entry.special || "")}`;
      }
      if (entry.album && !entry.tag) {
        return tagThumbnailKeyForAlbum(entry.album, scopePath);
      }
      return tagThumbnailKeyForTag(entry.tag || "", scopePath);
    }

    function metaGetTagThumbnailModeByKey(tagKey) {
      const key = String(tagKey || "");
      if (!key || !WS.meta || !WS.meta.tagThumbModes) return "quad";
      const mode = WS.meta.tagThumbModes.get(key);
      return normalizeTagThumbnailMode(mode);
    }

    function metaSetTagThumbnailModeByKey(tagKey, mode) {
      const key = String(tagKey || "");
      if (!key || !WS.meta || !WS.meta.tagThumbModes) return false;
      const nextMode = normalizeTagThumbnailMode(mode);
      const prevMode = metaGetTagThumbnailModeByKey(key);
      const hadPreset = !!(WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.has(key));
      let changed = false;
      if (prevMode !== nextMode) {
        WS.meta.tagThumbModes.set(key, nextMode);
        changed = true;
      }
      if (nextMode !== "single" && WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.has(key)) {
        WS.meta.tagThumbPresets.delete(key);
        changed = true;
      }
      if (!changed && !hadPreset) return false;
      if (changed) {
        WS.meta.dirty = true;
        metaScheduleSave();
      }
      return changed;
    }

    function metaGetTagThumbnailPresetRelPathByKey(tagKey) {
      const key = String(tagKey || "");
      if (!key || !WS.meta || !WS.meta.tagThumbPresets) return "";
      return normalizeWorkspaceRelPath(WS.meta.tagThumbPresets.get(key));
    }

    function metaHasTagThumbnailPresetByKey(tagKey) {
      return !!metaGetTagThumbnailPresetRelPathByKey(tagKey);
    }

    function metaSetTagThumbnailPresetByKey(tagKey, relPath) {
      const key = String(tagKey || "");
      if (!key || !WS.meta || !WS.meta.tagThumbPresets || !WS.meta.tagThumbModes) return false;
      const normalizedRelPath = normalizeWorkspaceRelPath(relPath);
      if (!normalizedRelPath) return false;
      const prevRelPath = metaGetTagThumbnailPresetRelPathByKey(key);
      const prevMode = metaGetTagThumbnailModeByKey(key);
      if (prevRelPath === normalizedRelPath && prevMode === "single") return false;
      WS.meta.tagThumbPresets.set(key, normalizedRelPath);
      WS.meta.tagThumbModes.set(key, "single");
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function metaClearTagThumbnailPresetByKey(tagKey) {
      const key = String(tagKey || "");
      if (!key || !WS.meta || !WS.meta.tagThumbPresets) return false;
      if (!WS.meta.tagThumbPresets.has(key)) return false;
      WS.meta.tagThumbPresets.delete(key);
      WS.meta.dirty = true;
      metaScheduleSave();
      return true;
    }

    function isPathOrAncestorProcessingDisabled(path) {
      const p = String(path || "");
      const node = WS.dirByPath && WS.dirByPath.get(p);
      if (node) {
        let cur = node;
        while (cur) {
          if (metaHasProcessingDisabled(cur.path || "")) return true;
          cur = cur.parent;
        }
        return false;
      }
      let cur = p;
      for (;;) {
        if (metaHasProcessingDisabled(cur)) return true;
        if (!cur) break;
        const idx = cur.lastIndexOf("/");
        cur = idx >= 0 ? cur.slice(0, idx) : "";
      }
      return false;
    }

    function collectDescendantDirPaths(path) {
      const p = String(path || "");
      const start = WS.dirByPath && WS.dirByPath.get(p);
      if (!start) {
        const out = [];
        const prefix = p ? (p + "/") : "";
        if (WS.dirByPath) {
          for (const key of WS.dirByPath.keys()) {
            const k = String(key || "");
            if (k === p) out.push(k);
            else if (prefix && k.startsWith(prefix)) out.push(k);
          }
        }
        if (!out.length) out.push(p);
        out.sort((a, b) => {
          const da = String(a || "").split("/").filter(Boolean).length;
          const db = String(b || "").split("/").filter(Boolean).length;
          return da - db;
        });
        return out;
      }
      const out = [];
      (function walk(node) {
        if (!node) return;
        out.push(String(node.path || ""));
        const children = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
        for (const child of children) walk(child);
      })(start);
      return out;
    }

    function refreshAfterProcessingMetadataChange() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      invalidateAllThumbs();
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      applyMediaFilterFromOptions();
    }

    function setProcessingDisabledForPaths(paths, disable) {
      const target = !!disable;
      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      let changed = false;
      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const tags = metaGetTags(p);
        const has = tags.includes(PROCESSING_DISABLED_TAG);
        if (has === target) continue;
        const next = target
          ? [PROCESSING_DISABLED_TAG].concat(tags.filter(t => t !== PROCESSING_DISABLED_TAG))
          : tags.filter(t => t !== PROCESSING_DISABLED_TAG);
        WS.meta.dirTags.set(p, normalizeTagList(next));
        changed = true;
      }
      return changed;
    }

    function metaSetProcessingDisabledRecursive(path, disable) {
      const paths = collectDescendantDirPaths(path);
      const changed = setProcessingDisabledForPaths(paths, disable);
      if (!changed) return false;
      WS.meta.dirty = true;
      metaScheduleSave();
      refreshAfterProcessingMetadataChange();
      return true;
    }

    function metaSetProcessingDisabledBulk(paths, disable) {
      const uniqueRoots = Array.from(new Set((paths || []).map(p => String(p || "")).filter(Boolean)));
      if (!uniqueRoots.length) return false;
      const all = [];
      const seen = new Set();
      for (let i = 0; i < uniqueRoots.length; i++) {
        const descendants = collectDescendantDirPaths(uniqueRoots[i]);
        for (let j = 0; j < descendants.length; j++) {
          const p = String(descendants[j] || "");
          if (!p || seen.has(p)) continue;
          seen.add(p);
          all.push(p);
        }
      }
      const changed = setProcessingDisabledForPaths(all, disable);
      if (!changed) return false;
      WS.meta.dirty = true;
      metaScheduleSave();
      refreshAfterProcessingMetadataChange();
      return true;
    }

    function metaSetUserTags(path, userTags) {
      const changed = metaWriteUserTags(path, userTags);
      if (!changed) return;
      metaScheduleSave();
      TAG_EDIT_PATH = null;
      PREVIEW_BULK_TAG_EDIT = null;
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
      PREVIEW_BULK_TAG_EDIT = null;
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
      if (canUseBulkTagPlaceholderUi() && setBulkTagPlaceholder(paths, "New tag folder", "tag")) return;
    }

    function startBulkTagAlbuming(tags) {
      if (canUseBulkTagPlaceholderUi() && setBulkTagPlaceholder(tags, "New tag album", "album")) return;
    }

    function setBulkTagPlaceholder(items, label = "New tag folder", placeholderType = "tag") {
      clearBulkTagPlaceholder();
      const type = String(placeholderType || "tag") === "album" ? "album" : "tag";
      let unique = [];
      if (type === "album") {
        unique = normalizeTagList(items).filter((tag) => !isReservedFolderTag(tag));
      } else {
        unique = Array.from(new Set((items || []).map(p => String(p || "")))).filter(p => p);
      }
      if (!unique.length) return false;
      BULK_TAG_PLACEHOLDER = {
        type,
        label: label,
        count: unique.length
      };
      TAG_ENTRY_RENAME_STATE = {
        tag: "",
        label,
        paths: type === "tag" ? unique.slice() : [],
        tags: type === "album" ? unique.slice() : [],
        placeholder: true,
        placeholderType: type
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
        if (state.placeholderType === "album") {
          const changed = assignTagAlbumForTagsBulk(state.tags, desired);
          if (!changed) {
            showStatusMessage("No tags updated.");
            renderDirectoriesPane(true);
            return;
          }
        } else {
          metaAddUserTagsBulk(state.paths, [desired]);
        }
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

    function assignTagAlbumForTagsBulk(tags, albumName) {
      const album = normalizeTagAlbumName(albumName);
      if (!album) return false;
      const normalizedTags = normalizeTagList(tags).filter((tag) => !isReservedFolderTag(tag));
      if (!normalizedTags.length) return false;
      let changed = false;
      let changedCount = 0;
      for (let i = 0; i < normalizedTags.length; i++) {
        if (metaSetTagAlbumForTag(normalizedTags[i], album)) {
          changed = true;
          changedCount++;
        }
      }
      if (!changed) return false;
      metaScheduleSave();
      refreshAfterTagMetadataChange();
      showStatusMessage(`Assigned ${changedCount} tag${changedCount === 1 ? "" : "s"} to album '${album}'.`);
      return true;
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
      const add = normalizeTagList(tagsToAdd).filter(t => !isReservedFolderTag(t));
      if (!add.length) return;

      const list = Array.isArray(paths) ? paths : Array.from(paths || []);
      if (!list.length) return;

      for (let i = 0; i < list.length; i++) {
        const p = String(list[i] || "");
        if (!p) continue;
        const existing = metaGetTags(p);
        const reserved = existing.filter(t => isReservedFolderTag(t));
        const curUser = existing.filter(t => !isReservedFolderTag(t));
        const mergedUser = normalizeTagList(curUser.concat(add));
        const merged = reserved.concat(mergedUser);
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
        schema: 2,
        updatedAt: Date.now(),
        sortMode: normalizeDirSortMode(WS.meta.dirSortMode),
        folders,
        scoreHistory: normalizeScoreHistoryList(WS.meta && Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [])
      };
    }

    function metaMakeTagsLogObject() {
      const folders = {};
      const tagByFp = {};
      const thumbnailByFolder = {};
      const tagThumbnailModeByTag = {};
      const tagThumbnailByTag = {};
      const tagAlbumByTag = {};
      const fileThumbnailCropByRelPath = {};
      const videoThumbnailTimeByRelPath = {};
      for (const [path, node] of WS.dirByPath.entries()) {
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tags = metaGetTags(path);
        folders[path] = { fp: fp >>> 0, tags: tags };
        if (WS.meta && WS.meta.dirThumbPresets && WS.meta.dirThumbPresets.has(path)) {
          const rawThumb = String(WS.meta.dirThumbPresets.get(path) || "");
          if (rawThumb === FOLDER_THUMB_NONE_SENTINEL || rawThumb === FOLDER_THUMB_ROTATE_SENTINEL) {
            thumbnailByFolder[path] = rawThumb;
          } else {
            const presetRelPath = normalizeWorkspaceRelPath(rawThumb);
            if (presetRelPath) thumbnailByFolder[path] = presetRelPath;
          }
        }
        if (tags && tags.length) {
          const k = String(fp >>> 0);
          if (!tagByFp[k]) tagByFp[k] = tags.slice();
        }
      }
      if (WS.meta && WS.meta.tagThumbModes) {
        for (const [tagKey, modeRaw] of WS.meta.tagThumbModes.entries()) {
          const key = String(tagKey || "");
          if (!key) continue;
          const mode = normalizeTagThumbnailMode(modeRaw);
          if (mode === "quad") continue;
          tagThumbnailModeByTag[key] = mode;
        }
      }
      if (WS.meta && WS.meta.tagThumbPresets) {
        for (const [tagKey, relPathRaw] of WS.meta.tagThumbPresets.entries()) {
          const key = String(tagKey || "");
          if (!key) continue;
          const relPath = normalizeWorkspaceRelPath(relPathRaw);
          if (!relPath) continue;
          tagThumbnailByTag[key] = relPath;
        }
      }
      if (WS.meta && WS.meta.tagAlbumByTag) {
        for (const [tagRaw, albumRaw] of WS.meta.tagAlbumByTag.entries()) {
          const tag = normalizeTag(tagRaw);
          const album = normalizeTagAlbumName(albumRaw);
          if (!tag || !album) continue;
          tagAlbumByTag[tag] = album;
        }
      }
      if (WS.meta && WS.meta.fileThumbCrop) {
        for (const [relPathRaw, cropRaw] of WS.meta.fileThumbCrop.entries()) {
          const relPath = normalizeWorkspaceRelPath(relPathRaw);
          if (!relPath) continue;
          const normalizedCrop = normalizeThumbCropValue(cropRaw);
          if (isThumbCropDefault(normalizedCrop)) continue;
          fileThumbnailCropByRelPath[relPath] = normalizedCrop;
        }
      }
      if (WS.meta && WS.meta.videoThumbTime) {
        for (const [relPathRaw, timeRaw] of WS.meta.videoThumbTime.entries()) {
          const relPath = normalizeWorkspaceRelPath(relPathRaw);
          const timeValue = normalizeVideoThumbTimeValue(timeRaw);
          if (!relPath || !Number.isFinite(timeValue)) continue;
          videoThumbnailTimeByRelPath[relPath] = timeValue;
        }
      }
      const pending = WS.meta && WS.meta.pendingTagsByPath ? WS.meta.pendingTagsByPath : null;
      if (pending && pending.size) {
        for (const [path, tags] of pending.entries()) {
          const p = String(path || "");
          if (!p || folders[p]) continue;
          const tg = normalizeTagList(tags);
          if (!tg.length) continue;
          folders[p] = { fp: 0, tags: tg };
        }
      }
      return {
        schema: 1,
        updatedAt: Date.now(),
        folders,
        tagByFp,
        thumbnailByFolder,
        tagThumbnailModeByTag,
        tagThumbnailByTag,
        tagAlbumByTag,
        fileThumbnailCropByRelPath,
        videoThumbnailTimeByRelPath
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
      const bindings = Array.isArray(WS.meta.keybinds) ? WS.meta.keybinds : defaultKeybinds();
      const gridBindings = Array.isArray(WS.meta.gridKeybinds) ? WS.meta.gridKeybinds : defaultGridKeybinds();
      return {
        schema: 1,
        updatedAt: Date.now(),
        bindings: bindings.map(b => ({ id: b.id, key: b.key || "" })),
        gridBindings: gridBindings.map(b => ({ id: b.id, key: b.key || "" }))
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
        sortMode: normalizeDirSortMode(WS.meta.dirSortMode),
        folders,
        tagByFp,
        options: normalizeOptions(WS.meta.options || null)
      };
    }

    function metaApplyScoresLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = normalizeDirSortMode(log.sortMode);
      WS.meta.dirSortMode = sortMode;
      WS.meta.scoreHistory = normalizeScoreHistoryList(log.scoreHistory || []);

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

    function stashPendingTagsFromLog(oldTagsByPath) {
      if (!WS.meta) return;
      WS.meta.pendingTagsByPath = new Map();
      for (const [path, tags] of oldTagsByPath.entries()) {
        if (!tags || !tags.length) continue;
        WS.meta.pendingTagsByPath.set(String(path || ""), normalizeTagList(tags));
      }
    }

    function applyPendingTagsToWorkspace() {
      const pending = WS.meta && WS.meta.pendingTagsByPath;
      if (!pending || !pending.size) return false;
      let applied = false;
      for (const [path, tags] of pending.entries()) {
        if (!WS.dirByPath.has(path)) continue;
        WS.meta.dirTags.set(path, normalizeTagList(tags));
        pending.delete(path);
        applied = true;
      }
      return applied;
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

      stashPendingTagsFromLog(oldTagsByPath);

      WS.meta.dirTags.clear();
      for (const [path, node] of WS.dirByPath.entries()) {
        if (oldTagsByPath.has(path)) {
          WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
          if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
          continue;
        }
        const fp = WS.meta.dirFingerprints.get(path) || 0;
        const tg = oldTagByFp.get(fp >>> 0) || [];
        WS.meta.dirTags.set(path, tg.slice());
      }

      WS.meta.dirThumbPresets.clear();
      const thumbnailByFolder = (log.thumbnailByFolder && typeof log.thumbnailByFolder === "object")
        ? log.thumbnailByFolder
        : {};
      for (const dirPath of Object.keys(thumbnailByFolder)) {
        const normalizedDirPath = normalizeDirPathValue(dirPath);
        const rawValue = String(thumbnailByFolder[dirPath] || "");
        const normalizedRelPath = normalizeWorkspaceRelPath(rawValue);
        if (!normalizedDirPath && !WS.dirByPath.has("")) continue;
        if (!normalizedRelPath && rawValue !== FOLDER_THUMB_NONE_SENTINEL && rawValue !== FOLDER_THUMB_ROTATE_SENTINEL) continue;
        if (!WS.dirByPath.has(normalizedDirPath)) continue;
        if (rawValue === FOLDER_THUMB_NONE_SENTINEL || rawValue === FOLDER_THUMB_ROTATE_SENTINEL) {
          WS.meta.dirThumbPresets.set(normalizedDirPath, rawValue);
        } else {
          WS.meta.dirThumbPresets.set(normalizedDirPath, normalizedRelPath);
        }
      }

      WS.meta.tagThumbModes.clear();
      const tagThumbnailModeByTag = (log.tagThumbnailModeByTag && typeof log.tagThumbnailModeByTag === "object")
        ? log.tagThumbnailModeByTag
        : {};
      for (const rawKey of Object.keys(tagThumbnailModeByTag)) {
        const key = String(rawKey || "");
        if (!key) continue;
        const mode = normalizeTagThumbnailMode(tagThumbnailModeByTag[rawKey]);
        if (mode === "quad") continue;
        WS.meta.tagThumbModes.set(key, mode);
      }

      WS.meta.tagThumbPresets.clear();
      const tagThumbnailByTag = (log.tagThumbnailByTag && typeof log.tagThumbnailByTag === "object")
        ? log.tagThumbnailByTag
        : {};
      for (const rawKey of Object.keys(tagThumbnailByTag)) {
        const key = String(rawKey || "");
        if (!key) continue;
        const relPath = normalizeWorkspaceRelPath(tagThumbnailByTag[rawKey]);
        if (!relPath) continue;
        WS.meta.tagThumbPresets.set(key, relPath);
      }
      for (const key of WS.meta.tagThumbPresets.keys()) {
        const mode = metaGetTagThumbnailModeByKey(key);
        if (mode !== "single") WS.meta.tagThumbModes.set(key, "single");
      }

      WS.meta.tagAlbumByTag.clear();
      const tagAlbumByTag = (log.tagAlbumByTag && typeof log.tagAlbumByTag === "object")
        ? log.tagAlbumByTag
        : {};
      for (const rawTag of Object.keys(tagAlbumByTag)) {
        const tag = normalizeTag(rawTag);
        const album = normalizeTagAlbumName(tagAlbumByTag[rawTag]);
        if (!tag || !album) continue;
        WS.meta.tagAlbumByTag.set(tag, album);
      }

      WS.meta.fileThumbCrop.clear();
      const fileThumbnailCropByRelPath = (log.fileThumbnailCropByRelPath && typeof log.fileThumbnailCropByRelPath === "object")
        ? log.fileThumbnailCropByRelPath
        : {};
      for (const rawRelPath of Object.keys(fileThumbnailCropByRelPath)) {
        const relPath = normalizeWorkspaceRelPath(rawRelPath);
        if (!relPath) continue;
        const crop = normalizeThumbCropValue(fileThumbnailCropByRelPath[rawRelPath]);
        if (isThumbCropDefault(crop)) continue;
        WS.meta.fileThumbCrop.set(relPath, crop);
      }

      WS.meta.videoThumbTime.clear();
      const videoThumbnailTimeByRelPath = (log.videoThumbnailTimeByRelPath && typeof log.videoThumbnailTimeByRelPath === "object")
        ? log.videoThumbnailTimeByRelPath
        : {};
      for (const rawRelPath of Object.keys(videoThumbnailTimeByRelPath)) {
        const relPath = normalizeWorkspaceRelPath(rawRelPath);
        if (!relPath) continue;
        const timeValue = normalizeVideoThumbTimeValue(videoThumbnailTimeByRelPath[rawRelPath]);
        if (!Number.isFinite(timeValue)) continue;
        WS.meta.videoThumbTime.set(relPath, timeValue);
      }
    }

    function metaApplyOptionsLog(log) {
      if (!log || typeof log !== "object") return;
      WS.meta.options = normalizeOptions(log.options || null);
      applyDefaultViewFromOptions();
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyThumbFitFromOptions();
      applyDisplaySizesFromOptions();
      applyDirectoryMiniThumbSizeFromOptions();
      applyDescriptionVisibilityFromOptions();
      applyInteractionModeFromOptions();
      applyPaneDividerFromOptions();
    }

    function metaApplyKeybindsLog(log) {
      if (!log || typeof log !== "object") return;
      const normalized = normalizeKeybinds(log);
      WS.meta.keybinds = normalized.bindings;
      const normalizedGrid = normalizeGridKeybinds(log);
      WS.meta.gridKeybinds = normalizedGrid.bindings;
      rebuildKeybindIndex();
    }

    function metaApplyFromLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = normalizeDirSortMode(log.sortMode);
      WS.meta.dirSortMode = sortMode;

      WS.meta.options = normalizeOptions(log.options || null);
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyMediaFilterFromOptions();
      applyThumbFitFromOptions();
      applyDisplaySizesFromOptions();
      applyDirectoryMiniThumbSizeFromOptions();
      applyDescriptionVisibilityFromOptions();
      applyInteractionModeFromOptions();
      applyPaneDividerFromOptions();

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

      stashPendingTagsFromLog(oldTagsByPath);

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
          if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
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

    function normalizeWorkspaceRelPath(path) {
      const raw = String(path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      if (!raw) return "";
      const parts = raw.split("/").filter(Boolean);
      if (!parts.length) return "";
      if (parts.includes(".local-gallery")) return "";
      return parts.join("/");
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
      applyDescriptionVisibilityFromOptions();
      applyPaneDividerFromOptions();
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
      applyDescriptionVisibilityFromOptions();
      applyPaneDividerFromOptions();
    }

    async function metaReapplyFsScoresAndTags() {
      metaComputeFingerprints();
      const scoresLog = await metaLoadFsDoc(WS.meta.fsScoresFileHandle);
      const tagsLog = await metaLoadFsDoc(WS.meta.fsTagsFileHandle);
      if (scoresLog) metaApplyScoresLog(scoresLog);
      if (tagsLog) metaApplyTagsLog(tagsLog);
    }

    async function buildWorkspaceFromFiles(fileList) {
      resetWorkspace();
      clearWorkspaceEmptyState();

      WS.root = makeDirNode(inferRootNameFromFileList(fileList), null);
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
      WS.view.randomFolderCache = new Map();

      WS.meta.storageMode = "local";
      WS.meta.storageKey = String(WS.view.randomSeed >>> 0);

      metaInitForCurrentWorkspace();
      hydrateEditedThumbnailAspects().then((changed) => {
        if (!changed || !WS.root) return;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      }).catch(() => {});

      // Initialize Directories Pane at root listing
      WS.nav.dirNode = WS.root;
      WS.view.aboveRootView = showRootViewEnabled() ? !isGridInteractionMode() : false;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      await prewarmVideoThumbsBeforeInitialRender();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      scheduleVideoThumbWorkspaceKick(0);
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

      WS.root = makeDirNode(String(rootHandle?.name || "root"), null);
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
      WS.view.randomFolderCache = new Map();

      const ok = await metaEnsureFsHandles(rootHandle);
      if (!ok) {
        WS.meta.storageMode = "local";
        WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
        metaInitForCurrentWorkspace();
      } else {
        WS.meta.storageKey = String(WS.view.randomSeed >>> 0);
        await metaInitForCurrentWorkspaceFs();
        if (WS.meta.saveTimer) {
          clearTimeout(WS.meta.saveTimer);
          WS.meta.saveTimer = null;
        }
        WS.meta.dirty = true;
        metaScheduleSave();
      }

      try { await hydrateEditedThumbnailAspects(); } catch {}

      WS.nav.dirNode = WS.root;
      WS.view.aboveRootView = showRootViewEnabled() ? !isGridInteractionMode() : false;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = 0;
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      await prewarmVideoThumbsBeforeInitialRender();

      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      scheduleVideoThumbWorkspaceKick(0);
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
          randomMode: !!WS.view.randomMode,
          randomFolderMode: !!WS.view.randomFolderMode,
          loopWithinDir: WS.view.loopWithinDir,
          folderBehavior: normalizeFolderBehavior(WS.view.folderBehavior, "slide"),
          folderScoreDisplay: WS.view.folderScoreDisplay,
          aboveRootView: !!WS.view.aboveRootView,
          tagFolderActiveMode: WS.view.tagFolderActiveMode,
          tagFolderActiveTag: WS.view.tagFolderActiveTag,
          tagFolderActiveAlbum: WS.view.tagFolderActiveAlbum,
          tagFolderOriginPath: WS.view.tagFolderOriginPath,
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
      WS.view.randomMode = !!viewState.randomMode;
      WS.view.randomFolderMode = !!viewState.randomFolderMode;
      WS.view.loopWithinDir = viewState.loopWithinDir;
      WS.view.folderBehavior = normalizeFolderBehavior(viewState.folderBehavior, "slide");
      WS.view.folderScoreDisplay = viewState.folderScoreDisplay;
      WS.view.aboveRootView = !!viewState.aboveRootView && showRootViewEnabled();
      WS.view.tagFolderActiveMode = String(viewState.tagFolderActiveMode || "");
      WS.view.tagFolderActiveTag = String(viewState.tagFolderActiveTag || "");
      WS.view.tagFolderActiveAlbum = String(viewState.tagFolderActiveAlbum || "");
      WS.view.tagFolderOriginPath = String(viewState.tagFolderOriginPath || "");
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
      scheduleVideoThumbWorkspaceKick(0);
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

    async function ensureDirectoryHandleForPath(rootHandle, path) {
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
        cur = await cur.getDirectoryHandle(part, { create: true });
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
      WS.view.bulkTagFolderSelectionsByDir = remapPathMapKeys(WS.view.bulkTagFolderSelectionsByDir, oldPrefix, newPrefix);
      WS.view.bulkFileSelectionsByDir = remapPathMapKeys(WS.view.bulkFileSelectionsByDir, oldPrefix, newPrefix);
      WS.view.bulkTagSelectedPaths = remapPathSet(WS.view.bulkTagSelectedPaths, oldPrefix, newPrefix);
    }

    function updateMetaPathsForRename(oldPrefix, newPrefix) {
      WS.meta.dirScores = remapPathMapKeys(WS.meta.dirScores, oldPrefix, newPrefix);
      WS.meta.dirTags = remapPathMapKeys(WS.meta.dirTags, oldPrefix, newPrefix);
      WS.meta.pendingTagsByPath = remapPathMapKeys(WS.meta.pendingTagsByPath, oldPrefix, newPrefix);
      WS.meta.dirFingerprints = remapPathMapKeys(WS.meta.dirFingerprints, oldPrefix, newPrefix);
      WS.meta.dirThumbPresets = remapPathMapKeys(WS.meta.dirThumbPresets, oldPrefix, newPrefix);
      WS.meta.dirThumbPresets = remapPathMapValues(WS.meta.dirThumbPresets, oldPrefix, newPrefix);
      WS.meta.fileThumbCrop = remapPathMapKeys(WS.meta.fileThumbCrop, oldPrefix, newPrefix);
      WS.meta.videoThumbTime = remapPathMapKeys(WS.meta.videoThumbTime, oldPrefix, newPrefix);
      if (Array.isArray(WS.meta.scoreHistory) && WS.meta.scoreHistory.length) {
        WS.meta.scoreHistory = normalizeScoreHistoryList(WS.meta.scoreHistory.map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const selectedRaw = Array.isArray(entry.selectedPaths) ? entry.selectedPaths : [];
          const changedRaw = Array.isArray(entry.changed) ? entry.changed : [];
          const selectedPaths = selectedRaw.map((p) => remapPathPrefix(oldPrefix, newPrefix, p));
          const changed = changedRaw.map((it) => {
            if (!it || typeof it !== "object") return it;
            return Object.assign({}, it, {
              path: remapPathPrefix(oldPrefix, newPrefix, it.path)
            });
          });
          return Object.assign({}, entry, { selectedPaths, changed });
        }));
      }
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

    function remapIdValue(idMap, value) {
      const key = String(value || "");
      if (!key) return "";
      return idMap.get(key) || key;
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

    function remapRuntimeFileStateIds(idMap) {
      if (!idMap || !idMap.size) return;
      WS.view.fileActionMenuId = remapIdValue(idMap, WS.view.fileActionMenuId);
      DIR_FILE_DRAG.id = remapIdValue(idMap, DIR_FILE_DRAG.id);
      PREVIEW_DRAG_STATE.draggedId = remapIdValue(idMap, PREVIEW_DRAG_STATE.draggedId);
      if (Array.isArray(PREVIEW_DRAG_STATE.visibleIds)) {
        PREVIEW_DRAG_STATE.visibleIds = PREVIEW_DRAG_STATE.visibleIds.map(id => remapIdValue(idMap, id)).filter(Boolean);
      }
      PREVIEW_VIDEO_PAUSE.fileId = remapIdValue(idMap, PREVIEW_VIDEO_PAUSE.fileId);
      VIDEO_CARRY.fileId = remapIdValue(idMap, VIDEO_CARRY.fileId);
    }

    function remapFileIdsAcrossViewState(idMap) {
      if (!idMap || !idMap.size) return;
      remapFileIdsInDirTree(idMap);
      remapFileSelectionIds(idMap);
      remapRuntimeFileStateIds(idMap);
      if (WS.preview.kind === "file" && WS.preview.fileId) {
        WS.preview.fileId = remapIdValue(idMap, WS.preview.fileId);
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

    async function refreshRenamedRecordFileFromDisk(rec, dirHandleOverride = null) {
      if (!rec || !WS.meta.fsRootHandle) return false;
      const fileName = String(rec.name || "");
      if (!fileName) return false;

      let dirHandle = dirHandleOverride || null;
      if (!dirHandle) {
        try {
          dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, String(rec.dirPath || ""));
        } catch {}
      }
      if (!dirHandle) return false;

      let fileHandle = null;
      try { fileHandle = await dirHandle.getFileHandle(fileName); } catch {}
      if (!fileHandle) return false;

      let freshFile = null;
      try { freshFile = await fileHandle.getFile(); } catch {}
      if (!freshFile) return false;

      try { if (rec.url) URL.revokeObjectURL(rec.url); } catch {}
      try { if (rec.thumbUrl) URL.revokeObjectURL(rec.thumbUrl); } catch {}
      try { if (rec.videoThumbUrl) URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
      rec.url = null;
      rec.thumbUrl = null;
      rec.videoThumbUrl = null;
      rec.thumbMode = null;
      rec.videoThumbMode = null;

      rec.file = freshFile;
      rec.size = Number.isFinite(freshFile.size) ? freshFile.size : rec.size;
      rec.lastModified = Number.isFinite(freshFile.lastModified) ? freshFile.lastModified : rec.lastModified;
      return true;
    }

    function updateFileRecordsForRename(oldPrefix, newPrefix) {
      const idMap = new Map();
      const nextFileById = new Map();
      for (const [id, rec] of WS.fileById.entries()) {
        const oldDirPath = String(rec.dirPath || "");
        const oldRelPath = String(rec.relPath || "");
        const nextDirPath = remapPathPrefix(oldPrefix, newPrefix, oldDirPath);
        const nextRelPath = remapPathPrefix(oldPrefix, newPrefix, oldRelPath);
        const nextId = (nextRelPath !== oldRelPath) ? fileKeyForRecord(rec, nextRelPath) : id;
        rec.dirPath = nextDirPath;
        rec.relPath = nextRelPath;
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
      }
      WS.fileById = nextFileById;
      remapFileIdsAcrossViewState(idMap);
      WS.view.randomCache = remapPathMapKeys(WS.view.randomCache, oldPrefix, newPrefix);
      WS.view.randomFolderCache = remapPathMapKeys(WS.view.randomFolderCache, oldPrefix, newPrefix);
    }

    async function updateFileRecordsForFileRenames(dirNode, renameMap, dirHandleForRefresh = null) {
      if (!dirNode || !renameMap || !renameMap.size) return;
      const dirPath = String(dirNode.path || "");
      const idMap = new Map();
      const relPathMap = new Map();
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
        const oldRelPath = String(rec.relPath || "");
        rec.name = newName;
        rec.ext = ext;
        rec.relPath = relPath;
        rec.type = isVideoName(newName) ? "video" : "image";
        await refreshRenamedRecordFileFromDisk(rec, dirHandleForRefresh);
        const nextId = fileKeyForRecord(rec, relPath);
        if (oldRelPath && relPath && oldRelPath !== relPath) relPathMap.set(oldRelPath, relPath);
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
      }

      WS.fileById = nextFileById;
      remapFileIdsAcrossViewState(idMap);
      remapFolderThumbnailPresetValues(relPathMap);
      WS.view.randomCache.delete(dirPath);
    }

    async function performBatchIndexForDir(dirNode, opts = {}) {
      if (!dirNode || !WS.meta.fsRootHandle) return { renamed: false, files: 0 };

      const dirPath = String(dirNode.path || "");
      const base = String(dirNode.name || "folder");
      const dirHandle = await getDirectoryHandleForPath(WS.meta.fsRootHandle, dirPath);

      const files = [];
      const handleByName = new Map();
      for await (const [name, handle] of dirHandle.entries()) {
        if (handle.kind !== "file") continue;
        files.push({ name, handle });
        handleByName.set(name, handle);
      }

      const orderedNames = [];
      if (dirNode.preserveOrder) {
        const seen = new Set();
        for (const id of dirNode.childrenFiles || []) {
          const rec = WS.fileById.get(id);
          const name = rec?.name;
          if (!name || !handleByName.has(name) || seen.has(name)) continue;
          orderedNames.push(name);
          seen.add(name);
        }
        const remaining = files.map(f => f.name).sort((a, b) => compareIndexedNames(a, b));
        for (const name of remaining) {
          if (!seen.has(name)) orderedNames.push(name);
        }
      } else {
        orderedNames.push(...files.map(f => f.name).sort((a, b) => compareIndexedNames(a, b)));
      }

      const count = orderedNames.length;
      if (!count) return { renamed: false, files: 0 };
      const width = String(count).length + 1;

      const renamePlan = [];
      const existingNames = new Set(files.map(f => f.name));
      for (let i = 0; i < count; i++) {
        const idx = String(i + 1).padStart(width, "0");
        const oldName = orderedNames[i];
        const handle = handleByName.get(oldName);
        if (!handle) continue;
        const dot = oldName.lastIndexOf(".");
        const ext = dot >= 0 ? oldName.slice(dot + 1) : "";
        const newName = `${base}_${idx}${ext ? "." + ext : ""}`;
        if (newName === oldName) continue;
        renamePlan.push({ oldName, newName, handle, ext: ext ? "." + ext : "" });
      }

      if (!renamePlan.length) return { renamed: false, files: 0 };

      const renameMap = new Map();
      const labelBase = opts.label || "Batch Index";
      const hasConflicts = renamePlan.some(entry => existingNames.has(entry.newName));

      if (!hasConflicts) {
        for (let i = 0; i < renamePlan.length; i++) {
          const entry = renamePlan[i];
          if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (${i + 1}/${renamePlan.length})`);
          else showBusyOverlay(`${labelBase}... ${i + 1}/${renamePlan.length}`);
          const ok = await renameFileOnDisk(dirHandle, entry.handle, entry.oldName, entry.newName);
          if (ok) renameMap.set(entry.oldName, entry.newName);
        }
      } else {
        const usedNames = new Set(existingNames);
        const tempPrefix = "__pg_tmp";
        const tempWidth = String(renamePlan.length).length + 1;
        const tempPlan = renamePlan.map((entry, idx) => {
          let tempName = "";
          do {
            const tempIdx = String(idx + 1).padStart(tempWidth, "0");
            const rand = Math.random().toString(36).slice(2, 10);
            tempName = `${tempPrefix}_${tempIdx}_${rand}${entry.ext}`;
          } while (usedNames.has(tempName));
          usedNames.add(tempName);
          return { ...entry, tempName };
        });

        const tempRenamed = [];
        for (let i = 0; i < tempPlan.length; i++) {
          const entry = tempPlan[i];
          if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (1/2 ${i + 1}/${tempPlan.length})`);
          else showBusyOverlay(`${labelBase}... (1/2 ${i + 1}/${tempPlan.length})`);
          const ok = await renameFileOnDisk(dirHandle, entry.handle, entry.oldName, entry.tempName);
          if (ok) tempRenamed.push(entry);
        }

        for (let i = 0; i < tempRenamed.length; i++) {
          const entry = tempRenamed[i];
          if (opts.progress) showBusyOverlay(`${labelBase}... ${opts.progress} (2/2 ${i + 1}/${tempRenamed.length})`);
          else showBusyOverlay(`${labelBase}... (2/2 ${i + 1}/${tempRenamed.length})`);
          let tempHandle = null;
          try {
            tempHandle = await dirHandle.getFileHandle(entry.tempName);
          } catch {}
          if (!tempHandle) continue;
          const ok = await renameFileOnDisk(dirHandle, tempHandle, entry.tempName, entry.newName);
          if (ok) renameMap.set(entry.oldName, entry.newName);
        }
      }

      if (renameMap.size) {
        await updateFileRecordsForFileRenames(dirNode, renameMap, dirHandle);
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
          resetDirFileOrder(dirNode, { silent: true });
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
          if (res.renamed) {
            resetDirFileOrder(child, { silent: true });
            renamedAny = true;
          }
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

    let DIR_SORT_METRICS_CACHE = null;
    let DIR_ITEM_COUNT_CACHE = new Map();
    let DIR_ITEM_COUNT_CACHE_FILTER_MODE = "";

    function invalidateDirMetricsCaches() {
      DIR_SORT_METRICS_CACHE = null;
      DIR_ITEM_COUNT_CACHE = new Map();
      DIR_ITEM_COUNT_CACHE_FILTER_MODE = "";
    }

    function byName(a, b) {
      return compareIndexedNames(a?.name || "", b?.name || "");
    }

    function dirSortModeOptions() {
      return [
        { value: "name", label: "Name" },
        { value: "score", label: "Score" },
        { value: "size-desc", label: "Size" },
        { value: "count-recursive", label: "Item count recursive" },
        { value: "count-non-recursive", label: "Item count non-recursive" }
      ];
    }

    function normalizeDirSortMode(mode) {
      const raw = String(mode || "");
      const allowed = dirSortModeOptions().map(opt => opt.value);
      if (allowed.includes(raw)) return raw;
      return "name";
    }

    function dirSortModeLabel(mode) {
      const normalized = normalizeDirSortMode(mode);
      const found = dirSortModeOptions().find(opt => opt.value === normalized);
      return found ? found.label : "Name";
    }

    function cycleDirSortMode(mode) {
      const values = dirSortModeOptions().map(opt => opt.value);
      const current = normalizeDirSortMode(mode);
      const idx = values.indexOf(current);
      return values[(idx >= 0 ? idx + 1 : 0) % values.length];
    }

    function buildDirSortMetrics() {
      if (DIR_SORT_METRICS_CACHE) return DIR_SORT_METRICS_CACHE;
      const sizeByPath = new Map();
      const recursiveCountByPath = new Map();
      const nonRecursiveCountByPath = new Map();

      if (!WS.root) {
        return { sizeByPath, recursiveCountByPath, nonRecursiveCountByPath };
      }

      (function walk(node) {
        if (!node) return;
        const files = Array.isArray(node.childrenFiles) ? node.childrenFiles : [];
        const dirs = Array.isArray(node.childrenDirs) ? node.childrenDirs : [];
        const ownCount = files.length + dirs.length;

        let size = 0;
        for (let i = 0; i < files.length; i++) {
          const rec = WS.fileById.get(files[i]);
          const fileSize = Number(rec && rec.size);
          if (Number.isFinite(fileSize) && fileSize > 0) size += fileSize;
        }

        let recursiveCount = ownCount;
        for (let i = 0; i < dirs.length; i++) {
          const child = dirs[i];
          walk(child);
          const childPath = String(child?.path || "");
          size += sizeByPath.get(childPath) || 0;
          recursiveCount += recursiveCountByPath.get(childPath) || 0;
        }

        const path = String(node.path || "");
        sizeByPath.set(path, size);
        recursiveCountByPath.set(path, recursiveCount);
        nonRecursiveCountByPath.set(path, ownCount);
      })(WS.root);

      DIR_SORT_METRICS_CACHE = { sizeByPath, recursiveCountByPath, nonRecursiveCountByPath };
      return DIR_SORT_METRICS_CACHE;
    }

    function randomActionMode() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const mode = opt ? String(opt.randomActionMode || "firstFileJump") : "firstFileJump";
      if (mode === "firstFileJump" || mode === "randomFileSort" || mode === "randomFolderSort") return mode;
      return "firstFileJump";
    }

    function randomSortAffectsFiles() {
      return !!WS.view.randomMode;
    }

    function randomSortAffectsFolders() {
      return !!WS.view.randomFolderMode;
    }

    function reseedRandomSortMode() {
      const workspaceSeed = computeWorkspaceSeed();
      const timeSeed = (Date.now() >>> 0);
      const randSeed = (Math.floor(Math.random() * 0xffffffff) >>> 0);
      WS.view.randomSeed = (workspaceSeed ^ timeSeed ^ randSeed) >>> 0;
      if (!WS.view.randomSeed) WS.view.randomSeed = (workspaceSeed || 1) >>> 0;
      WS.view.randomCache = new Map();
      WS.view.randomFolderCache = new Map();
    }

    function getRandomOrderForDirs(dirs) {
      const list = Array.isArray(dirs) ? dirs.slice() : [];
      if (!list.length) return list;
      const parentPath = String(list[0]?.parent?.path || "");
      if (!parentPath) return list;
      const key = parentPath;
      if (WS.view.randomFolderCache && WS.view.randomFolderCache.has(key)) {
        const cachedPaths = WS.view.randomFolderCache.get(key) || [];
        const byPath = new Map(list.map((node) => [String(node?.path || ""), node]));
        const ordered = [];
        cachedPaths.forEach((p) => {
          const node = byPath.get(String(p || ""));
          if (node) ordered.push(node);
        });
        list.forEach((node) => {
          const p = String(node?.path || "");
          if (!cachedPaths.includes(p)) ordered.push(node);
        });
        if (ordered.length === list.length) return ordered;
      }
      const seed = (WS.view.randomSeed ^ hash32(`dir:${parentPath}`)) >>> 0;
      const shuffled = shuffleWithSeed(list.slice(), seed);
      if (WS.view.randomFolderCache) {
        WS.view.randomFolderCache.set(key, shuffled.map((node) => String(node?.path || "")));
      }
      return shuffled;
    }

    function sortDirsForDisplay(dirs) {
      const out = Array.isArray(dirs) ? dirs.slice() : [];
      if (randomSortAffectsFolders() && out.length) {
        const parentPath = String(out[0]?.parent?.path || "");
        if (parentPath) return getRandomOrderForDirs(out);
      }
      const sortMode = normalizeDirSortMode(WS.meta.dirSortMode);
      if (sortMode === "score") {
        out.sort((a, b) => {
          const sa = metaGetScore(a?.path || "");
          const sb = metaGetScore(b?.path || "");
          if (sa !== sb) return sb - sa;
          return byName(a, b);
        });
        return out;
      }

      if (sortMode === "size-desc" || sortMode === "count-recursive" || sortMode === "count-non-recursive") {
        const metrics = buildDirSortMetrics();
        out.sort((a, b) => {
          const pathA = String(a?.path || "");
          const pathB = String(b?.path || "");

          let va = 0;
          let vb = 0;
          if (sortMode === "size-desc") {
            va = metrics.sizeByPath.get(pathA) || 0;
            vb = metrics.sizeByPath.get(pathB) || 0;
          } else if (sortMode === "count-recursive") {
            va = metrics.recursiveCountByPath.get(pathA) || 0;
            vb = metrics.recursiveCountByPath.get(pathB) || 0;
          } else {
            va = metrics.nonRecursiveCountByPath.get(pathA) || 0;
            vb = metrics.nonRecursiveCountByPath.get(pathB) || 0;
          }

          if (va !== vb) return vb - va;
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
      if (!node) return 0;
      const filterMode = String(WS?.view?.filterMode || "all");
      if (DIR_ITEM_COUNT_CACHE_FILTER_MODE !== filterMode) {
        DIR_ITEM_COUNT_CACHE_FILTER_MODE = filterMode;
        DIR_ITEM_COUNT_CACHE.clear();
      }
      const pathKey = String(node.path || "");
      if (DIR_ITEM_COUNT_CACHE.has(pathKey)) return DIR_ITEM_COUNT_CACHE.get(pathKey) || 0;
      let c = 0;
      for (const id of node.childrenFiles) {
        const rec = WS.fileById.get(id);
        if (passesFilter(rec)) c++;
      }
      for (const d of node.childrenDirs) c += dirItemCount(d);
      DIR_ITEM_COUNT_CACHE.set(pathKey, c);
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

      if (randomSortAffectsFiles()) {
        ids = getRandomOrderForDir(dirNode);
      } else if (dirNode.preserveOrder) {
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

    const DIR_FILE_DRAG = { id: null, dirPath: null };
    const DIRECTORIES_GRID_DRAG_STATE = {
      placeholder: null,
      container: null,
      draggedId: null,
      draggedRow: null,
      dirNode: null,
      visibleIds: null,
      raf: 0,
      lastX: 0,
      lastY: 0,
      pendingHide: false
    };

    function ensureDirectoriesGridDragPlaceholder(row) {
      if (!DIRECTORIES_GRID_DRAG_STATE.placeholder) {
        const ph = document.createElement("div");
        ph.className = "dirRow fileRow drag-placeholder";
        ph.setAttribute("aria-hidden", "true");
        DIRECTORIES_GRID_DRAG_STATE.placeholder = ph;
      }
      const rect = row.getBoundingClientRect();
      const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
      ph.style.width = `${Math.max(1, Math.round(rect.width))}px`;
      ph.style.height = `${Math.max(1, Math.round(rect.height))}px`;
      return ph;
    }

    function placeDirectoriesGridDragPlaceholder(row) {
      const container = row?.parentElement || directoriesListEl;
      if (!container || !row) return;
      const ph = ensureDirectoriesGridDragPlaceholder(row);
      if (ph.parentElement && ph.parentElement !== container) {
        ph.parentElement.removeChild(ph);
      }
      DIRECTORIES_GRID_DRAG_STATE.container = container;
      if (row !== ph) container.insertBefore(ph, row);
    }

    function clearDirectoriesGridDragPlaceholder() {
      const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
      if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
      DIRECTORIES_GRID_DRAG_STATE.container = null;
    }

    function getDirectoriesGridDragRows(container) {
      if (!container) return [];
      return Array.from(container.querySelectorAll(".dirRow.fileRow[data-file-id]"))
        .filter((row) => !row.classList.contains("drag-placeholder") && !row.classList.contains("drag-hidden"));
    }

    function updateDirectoriesGridPlaceholderFromPoint(container, x, y) {
      const rows = getDirectoriesGridDragRows(container);
      if (!rows.length) {
        const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
        if (ph) container.appendChild(ph);
        return;
      }
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        const rowMid = rect.top + rect.height / 2;
        if (y < rowMid) {
          placeDirectoriesGridDragPlaceholder(row);
          return;
        }
        if (y >= rect.top && y <= rect.bottom) {
          const colMid = rect.left + rect.width / 2;
          if (x < colMid) {
            placeDirectoriesGridDragPlaceholder(row);
            return;
          }
        }
      }
      const ph = DIRECTORIES_GRID_DRAG_STATE.placeholder;
      if (ph) container.appendChild(ph);
    }

    function scheduleDirectoriesGridDragUpdate(container, x, y) {
      DIRECTORIES_GRID_DRAG_STATE.lastX = x;
      DIRECTORIES_GRID_DRAG_STATE.lastY = y;
      if (DIRECTORIES_GRID_DRAG_STATE.raf) return;
      DIRECTORIES_GRID_DRAG_STATE.raf = requestAnimationFrame(() => {
        DIRECTORIES_GRID_DRAG_STATE.raf = 0;
        updateDirectoriesGridPlaceholderFromPoint(
          container,
          DIRECTORIES_GRID_DRAG_STATE.lastX,
          DIRECTORIES_GRID_DRAG_STATE.lastY
        );
      });
    }

    function beginDirectoriesGridFileDrag(row, dragDir, visibleIds) {
      DIRECTORIES_GRID_DRAG_STATE.draggedRow = row;
      DIRECTORIES_GRID_DRAG_STATE.draggedId = String(row?.dataset?.fileId || "");
      DIRECTORIES_GRID_DRAG_STATE.dirNode = dragDir;
      DIRECTORIES_GRID_DRAG_STATE.visibleIds = Array.isArray(visibleIds)
        ? visibleIds.map((id) => String(id || ""))
        : null;
      DIRECTORIES_GRID_DRAG_STATE.container = row?.parentElement || null;
      DIRECTORIES_GRID_DRAG_STATE.pendingHide = true;
    }

    function finishDirectoriesGridFileDrag() {
      if (DIRECTORIES_GRID_DRAG_STATE.raf) {
        cancelAnimationFrame(DIRECTORIES_GRID_DRAG_STATE.raf);
        DIRECTORIES_GRID_DRAG_STATE.raf = 0;
      }
      const row = DIRECTORIES_GRID_DRAG_STATE.draggedRow;
      if (row) {
        row.classList.remove("drag-hidden");
        row.classList.remove("dragging");
      }
      DIRECTORIES_GRID_DRAG_STATE.draggedRow = null;
      DIRECTORIES_GRID_DRAG_STATE.draggedId = null;
      DIRECTORIES_GRID_DRAG_STATE.dirNode = null;
      DIRECTORIES_GRID_DRAG_STATE.visibleIds = null;
      DIRECTORIES_GRID_DRAG_STATE.pendingHide = false;
      clearDirectoriesGridDragPlaceholder();
    }

    function ensureDirectoriesGridDragHidden() {
      if (!DIRECTORIES_GRID_DRAG_STATE.pendingHide) return;
      const row = DIRECTORIES_GRID_DRAG_STATE.draggedRow;
      const container = DIRECTORIES_GRID_DRAG_STATE.container || row?.parentElement || null;
      if (!row || !container) return;
      DIRECTORIES_GRID_DRAG_STATE.pendingHide = false;
      placeDirectoriesGridDragPlaceholder(row);
      row.classList.add("drag-hidden");
    }

    function setupDirectoriesGridFileDropZone(container) {
      if (!container || container.dataset.gridFileDropBound === "1") return;
      container.dataset.gridFileDropBound = "1";

      container.addEventListener("dragover", (e) => {
        if (!DIRECTORIES_GRID_DRAG_STATE.draggedId) return;
        if (DIRECTORIES_GRID_DRAG_STATE.container && DIRECTORIES_GRID_DRAG_STATE.container !== container) return;
        if (!container.classList.contains("gridModeList")) return;
        e.preventDefault();
        ensureDirectoriesGridDragHidden();
        scheduleDirectoriesGridDragUpdate(container, e.clientX, e.clientY);
      });

      container.addEventListener("drop", (e) => {
        if (!DIRECTORIES_GRID_DRAG_STATE.draggedId) return;
        if (DIRECTORIES_GRID_DRAG_STATE.container && DIRECTORIES_GRID_DRAG_STATE.container !== container) return;
        if (!container.classList.contains("gridModeList")) return;
        e.preventDefault();
        e.stopPropagation();
        updateDirectoriesGridPlaceholderFromPoint(container, e.clientX, e.clientY);
        const dirNode = DIRECTORIES_GRID_DRAG_STATE.dirNode;
        const dragId = DIRECTORIES_GRID_DRAG_STATE.draggedId;
        const ids = (DIRECTORIES_GRID_DRAG_STATE.visibleIds && DIRECTORIES_GRID_DRAG_STATE.visibleIds.length)
          ? DIRECTORIES_GRID_DRAG_STATE.visibleIds
          : (dirNode ? getOrderedFileIdsForDir(dirNode) : []);
        const list = ids.filter((id) => String(id || "") !== String(dragId));
        const children = Array.from(container.children);
        let insertIdx = 0;
        for (const child of children) {
          if (child === DIRECTORIES_GRID_DRAG_STATE.placeholder) break;
          if (child.classList
            && child.classList.contains("dirRow")
            && child.classList.contains("fileRow")
            && !child.classList.contains("drag-hidden")
            && !child.classList.contains("drag-placeholder")) {
            insertIdx++;
          }
        }
        insertIdx = Math.max(0, Math.min(list.length, insertIdx));
        let targetId = null;
        let placeAfter = false;
        if (list.length) {
          if (insertIdx >= list.length) {
            targetId = list[list.length - 1];
            placeAfter = true;
          } else {
            targetId = list[insertIdx];
            placeAfter = false;
          }
        }
        if (dirNode && targetId) {
          const moved = reorderFilesInDir(dirNode, dragId, targetId, placeAfter, { visibleIds: ids });
          if (moved) syncAfterDirOrderChange(null, { preserveSelection: true });
        }
        DIR_FILE_DRAG.id = null;
        DIR_FILE_DRAG.dirPath = null;
        finishDirectoriesGridFileDrag();
      });
    }

    function setupDirectoriesGridFileDragSource(row, dragDir, visibleIds) {
      if (!row || row.dataset.gridFileDragBound === "1") return;
      row.dataset.gridFileDragBound = "1";
      const fileId = String(row.dataset.fileId || "");
      if (!fileId || !dragDir) return;

      const handleDragStart = (e) => {
        if (!isGridInteractionMode() || !directoriesListEl || !directoriesListEl.classList.contains("gridModeList")) {
          e.preventDefault();
          return;
        }
        if (!canReorderFilesInDir(dragDir) || WS.view.bulkSelectMode) {
          e.preventDefault();
          return;
        }
        DIR_FILE_DRAG.id = fileId;
        DIR_FILE_DRAG.dirPath = String(dragDir.path || "");
        row.classList.add("dragging");
        beginDirectoriesGridFileDrag(row, dragDir, visibleIds);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", fileId); } catch {}
          try {
            const rect = row.getBoundingClientRect();
            e.dataTransfer.setDragImage(row, rect.width / 2, rect.height / 2);
          } catch {}
        }
      };

      const handleDragEnd = () => {
        DIR_FILE_DRAG.id = null;
        DIR_FILE_DRAG.dirPath = null;
        row.classList.remove("dragging");
        finishDirectoriesGridFileDrag();
      };

      const setupDragSource = (el) => {
        if (!el) return;
        el.draggable = true;
        el.addEventListener("dragstart", handleDragStart);
        el.addEventListener("dragend", handleDragEnd);
      };

      setupDragSource(row);
      setupDragSource(row.querySelector(".dirFileThumbCard"));
      setupDragSource(row.querySelector(".dirInlinePreview"));
      setupDragSource(row.querySelector(".dirFileOverlay"));
    }

    function canReorderFilesInDir(dirNode) {
      if (!WS.root || !dirNode) return false;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
      return true;
    }

    function canReorderFilesInCurrentDir() {
      return canReorderFilesInDir(WS.nav.dirNode);
    }

    function findFileEntryIndexById(fileId) {
      const id = String(fileId || "");
      if (!id) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "file" && String(entry.id || "") === id) return i;
      }
      return -1;
    }

    function syncAfterDirOrderChange(selectId, opts = {}) {
      const preserveSelection = !!opts.preserveSelection;
      const prevEntry = preserveSelection ? (WS.nav.entries[WS.nav.selectedIndex] || null) : null;
      rebuildDirectoriesEntries();
      if (selectId) {
        const idx = findFileEntryIndexById(selectId);
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      } else if (preserveSelection && prevEntry) {
        let idx = -1;
        if (prevEntry.kind === "file") {
          idx = findFileEntryIndexById(prevEntry.id);
        } else if (prevEntry.kind === "dir") {
          idx = findDirEntryIndexByPath(prevEntry.node?.path || "");
        } else if (prevEntry.kind === "tag") {
          const tag = String(prevEntry.tag || "");
          const label = String(prevEntry.label || prevEntry.tag || "");
          for (let i = 0; i < WS.nav.entries.length; i++) {
            const entry = WS.nav.entries[i];
            if (entry && entry.kind === "tag" && String(entry.tag || "") === tag && String(entry.label || entry.tag || "") === label) {
              idx = i;
              break;
            }
          }
        }
        if (idx >= 0) WS.nav.selectedIndex = idx;
        else WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      } else {
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      }
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function isDirWithin(rootNode, childNode) {
      if (!rootNode || !childNode) return false;
      const rootPath = String(rootNode.path || "");
      let cur = childNode;
      while (cur) {
        if (cur === rootNode) return true;
        if (rootPath && String(cur.path || "") === rootPath) return true;
        cur = cur.parent;
      }
      return false;
    }

    function resetDirFileOrder(dirNode, opts = {}) {
      if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
      dirNode.preserveOrder = false;
      dirNode.childrenFiles.sort((a,b) => compareIndexedNames(WS.fileById.get(a)?.name || "", WS.fileById.get(b)?.name || ""));
      WS.view.randomCache.delete(dirNode.path || "");
      if (!opts.silent) {
        syncAfterDirOrderChange(opts.selectId || null);
      } else {
        const previewTarget = getPreviewTargetDir();
        const refreshPreview = !!(previewTarget && (isDirWithin(previewTarget, dirNode) || isDirWithin(dirNode, previewTarget)));
        if (refreshPreview) {
          renderPreviewPane(true, true);
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        }
      }
      return true;
    }

    function reorderFilesInDir(dirNode, draggedId, targetId, placeAfter, opts = {}) {
      if (!dirNode || !draggedId || !targetId) return false;
      const list = dirNode.childrenFiles;
      if (!Array.isArray(list) || list.length < 2) return false;
      const dragId = String(draggedId);
      const target = String(targetId);
      if (dragId === target) return false;

      const visible = Array.isArray(opts.visibleIds) ? opts.visibleIds.map(id => String(id || "")) : null;
      if (visible && visible.length) {
        const visibleSet = new Set(visible);
        if (!visibleSet.has(dragId) || !visibleSet.has(target)) return false;
        const reorderedVisible = visible.filter(id => id !== dragId);
        const targetIdx = reorderedVisible.indexOf(target);
        if (targetIdx < 0) return false;
        const insertIdx = Math.max(0, Math.min(reorderedVisible.length, placeAfter ? targetIdx + 1 : targetIdx));
        reorderedVisible.splice(insertIdx, 0, dragId);

        const result = new Array(list.length);
        const slots = [];
        for (let i = 0; i < list.length; i++) {
          const id = String(list[i] || "");
          if (visibleSet.has(id)) slots.push(i);
          else result[i] = id;
        }
        if (slots.length !== reorderedVisible.length) return false;
        for (let i = 0; i < slots.length; i++) {
          result[slots[i]] = reorderedVisible[i];
        }
        list.length = 0;
        list.push(...result);
        dirNode.preserveOrder = true;
        WS.view.randomCache.delete(dirNode.path || "");
        return true;
      }

      const fromIdx = list.indexOf(dragId);
      if (fromIdx < 0) return false;
      list.splice(fromIdx, 1);
      let toIdx = list.indexOf(target);
      if (toIdx < 0) return false;
      if (placeAfter) toIdx += 1;
      toIdx = Math.max(0, Math.min(list.length, toIdx));
      list.splice(toIdx, 0, dragId);
      dirNode.preserveOrder = true;
      WS.view.randomCache.delete(dirNode.path || "");
      return true;
    }

    function reverseFilesInDir(dirNode, opts = {}) {
      if (!dirNode || !Array.isArray(dirNode.childrenFiles)) return false;
      const list = dirNode.childrenFiles;
      if (list.length < 2) return false;

      const visible = Array.isArray(opts.visibleIds) ? opts.visibleIds.map(id => String(id || "")) : null;
      if (visible && visible.length) {
        const visibleSet = new Set(visible);
        const reversedVisible = visible.slice().reverse();
        const result = new Array(list.length);
        const slots = [];
        for (let i = 0; i < list.length; i++) {
          const id = String(list[i] || "");
          if (visibleSet.has(id)) slots.push(i);
          else result[i] = id;
        }
        if (slots.length !== reversedVisible.length) return false;
        for (let i = 0; i < slots.length; i++) {
          result[slots[i]] = reversedVisible[i];
        }
        list.length = 0;
        list.push(...result);
      } else {
        list.reverse();
      }

      dirNode.preserveOrder = true;
      WS.view.randomCache.delete(dirNode.path || "");
      return true;
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
      WS.videoThumbPriorityQueue = [];
      WS.videoThumbQueue = [];
      if (WS.videoThumbQueuedIds instanceof Set) WS.videoThumbQueuedIds.clear();
      else WS.videoThumbQueuedIds = new Set();
      if (WS.videoThumbInFlightIds instanceof Set) WS.videoThumbInFlightIds.clear();
      else WS.videoThumbInFlightIds = new Set();
      if (WS.videoThumbInFlightBackgroundIds instanceof Set) WS.videoThumbInFlightBackgroundIds.clear();
      else WS.videoThumbInFlightBackgroundIds = new Set();
      WS.videoThumbPrewarmBlocking = false;
      WS.imageThumbQueue = [];
      if (WS.videoThumbWorkspaceKickTimer) {
        try { clearTimeout(WS.videoThumbWorkspaceKickTimer); } catch {}
        WS.videoThumbWorkspaceKickTimer = 0;
      }
      if (WS.root) scheduleVideoThumbWorkspaceKick(0);
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
        await updateFileRecordsForFileRenames(dirNode, renameMap, dirHandle);
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
      const visibleBase = showHidden ? base : base.filter(d => !isDirOrAncestorHidden(d));
      return visibleBase;
    }

    function treatTagsAsFoldersEnabled() {
      return true;
    }

    function showRootViewEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !(opt && opt.showRootView === false);
    }

    function showHiddenFolderEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showHiddenFolder);
    }

    function showUntaggedFolderEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showUntaggedFolder);
    }

    function showTagFolderSpacerRowEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.showTagFolderSpacerRow);
    }

    function getUntaggedDirsForNode(dirNode) {
      if (!dirNode) return [];
      const children = getChildDirsForNodeBase(dirNode);
      if (!children.length) return [];
      return children.filter(d => (metaGetUserTags(d.path || "").length === 0));
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

    function collectTagAlbumStatsForGroups(tagGroups) {
      const byAlbum = new Map();
      for (const [tag, nodes] of (tagGroups || []).entries()) {
        const album = metaGetTagAlbumForTag(tag);
        if (!album) continue;
        let bucket = byAlbum.get(album);
        if (!bucket) {
          bucket = {
            tags: new Set(),
            folderPaths: new Set()
          };
          byAlbum.set(album, bucket);
        }
        bucket.tags.add(String(tag || ""));
        for (let i = 0; i < (nodes || []).length; i++) {
          const path = String(nodes[i]?.path || "");
          if (path) bucket.folderPaths.add(path);
        }
      }
      return byAlbum;
    }

    function buildBulkTagPlaceholderEntry() {
      if (!BULK_TAG_PLACEHOLDER) return null;
      const type = String(BULK_TAG_PLACEHOLDER.type || "tag") === "album" ? "album" : "tag";
      return {
        kind: "tag",
        label: BULK_TAG_PLACEHOLDER.label || (type === "album" ? "New tag album" : "New tag folder"),
        tag: "",
        count: BULK_TAG_PLACEHOLDER.count || 0,
        placeholder: true,
        placeholderType: type
      };
    }

    function getTagFolderEntries() {
      if (!treatTagsAsFoldersEnabled()) return [];
      if (!WS.root || !WS.nav.dirNode) return [];
      if (WS.view.dirSearchPinned || WS.view.favoritesMode || WS.view.hiddenMode) return [];

      const entries = [];
      const placeholderEntry = buildBulkTagPlaceholderEntry();
      if (placeholderEntry) entries.push(placeholderEntry);

      const dirNode = WS.nav.dirNode;
      const originPath = String(dirNode.path || "");
      const allChildren = sortDirsForDisplay(dirNode.childrenDirs).filter(d => dirItemCount(d) > 0);
      const children = getChildDirsForNodeBase(dirNode);

      const favs = allChildren.filter(d => metaHasFavorite(d.path || ""));
      if (favs.length) {
        entries.push({ kind: "tag", label: "Favorites", special: "favorites", count: favs.length, originPath });
      }
      if (showUntaggedFolderEnabled()) {
        const untagged = getUntaggedDirsForNode(dirNode);
        if (untagged.length) {
          entries.push({ kind: "tag", label: "Untagged", special: "untagged", count: untagged.length, originPath });
        }
      }
      if (showHiddenFolderEnabled()) {
        const hidden = allChildren.filter(d => metaHasHidden(d.path || ""));
        if (hidden.length) {
          entries.push({ kind: "tag", label: "Hidden", special: "hidden", count: hidden.length, originPath });
        }
      }
      const tagGroups = gatherTagGroupsForDir(dirNode);
      if (tagGroups.size) {
        const albumStats = collectTagAlbumStatsForGroups(tagGroups);
        if (albumStats.size) {
          const sortedAlbums = Array.from(albumStats.keys()).sort((a, b) => String(a).localeCompare(String(b)));
          for (let i = 0; i < sortedAlbums.length; i++) {
            const album = sortedAlbums[i];
            const stats = albumStats.get(album);
            if (!stats || !stats.tags.size) continue;
            entries.push({
              kind: "tag",
              album,
              label: album,
              count: stats.folderPaths.size,
              tagCount: stats.tags.size,
              originPath
            });
          }
        }
        const sorted = Array.from(tagGroups.keys()).sort((a, b) => String(a).localeCompare(String(b)));
        for (const tag of sorted) {
          if (metaGetTagAlbumForTag(tag)) continue;
          const nodes = tagGroups.get(tag) || [];
          if (!nodes.length) continue;
          entries.push({ kind: "tag", tag, label: tag, count: nodes.length, originPath });
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

    function getTagEntriesForTagFolderView() {
      if (!isViewingTagFolder()) return [];
      if (WS.view.tagFolderActiveMode !== "album") return [];
      const album = normalizeTagAlbumName(WS.view.tagFolderActiveAlbum || "");
      if (!album) return [];
      const baseNode = getTagFolderBaseNode();
      if (!baseNode) return [];
      const tagGroups = gatherTagGroupsForDir(baseNode);
      if (!tagGroups.size) return [];
      const sorted = Array.from(tagGroups.keys()).sort((a, b) => String(a).localeCompare(String(b)));
      const out = [];
      for (let i = 0; i < sorted.length; i++) {
        const tag = String(sorted[i] || "");
        if (!tag) continue;
        if (metaGetTagAlbumForTag(tag) !== album) continue;
        const nodes = tagGroups.get(tag) || [];
        if (!nodes.length) continue;
        out.push({
          kind: "tag",
          tag,
          album,
          label: tag,
          count: nodes.length,
          originPath: String(baseNode.path || ""),
          albumTag: true
        });
      }
      return out;
    }

    function getDirsForTagFolderView() {
      if (!isViewingTagFolder()) return [];
      const baseNode = getTagFolderBaseNode();
      if (!baseNode) return [];
      const children = getChildDirsForNodeBase(baseNode);
      if (WS.view.tagFolderActiveMode === "favorites") {
        return children.filter(d => metaHasFavorite(d.path || ""));
      }
      if (WS.view.tagFolderActiveMode === "untagged") {
        return children.filter(d => metaGetUserTags(d.path || "").length === 0);
      }
      if (WS.view.tagFolderActiveMode === "hidden") {
        return children.filter(d => metaHasHidden(d.path || ""));
      }
      if (WS.view.tagFolderActiveMode === "album") {
        return [];
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
      if (frame.mode === "untagged") return children.filter(d => metaGetUserTags(d.path || "").length === 0);
      if (frame.mode === "hidden") return children.filter(d => metaHasHidden(d.path || ""));
      if (frame.mode === "album") return [];
      const tag = String(frame.tag || "");
      if (!tag) return [];
      return children.filter(d => {
        const tags = metaGetUserTags(d.path || "");
        return tags.includes(tag);
      });
    }

    function getDirsForTagEntry(entry) {
      if (!entry || entry.kind !== "tag") return [];
      const originPath = String(entry.originPath || "");
      const dirNode = WS.dirByPath.get(originPath) || WS.nav.dirNode;
      if (!dirNode) return [];
      const children = getChildDirsForNodeBase(dirNode);
      if (!children.length) return [];
      if (entry.album && !entry.tag) {
        const album = normalizeTagAlbumName(entry.album);
        if (!album) return [];
        const tagGroups = gatherTagGroupsForDir(dirNode);
        if (!tagGroups.size) return [];
        const out = [];
        const seen = new Set();
        for (const [tag, nodes] of tagGroups.entries()) {
          if (metaGetTagAlbumForTag(tag) !== album) continue;
          for (let i = 0; i < (nodes || []).length; i++) {
            const node = nodes[i];
            const path = String(node?.path || "");
            if (!path || seen.has(path)) continue;
            seen.add(path);
            out.push(node);
          }
        }
        return out;
      }
      if (entry.special) {
        if (entry.special === "favorites") {
          return children.filter(d => metaHasFavorite(d.path || ""));
        }
        if (entry.special === "untagged") {
          return children.filter(d => metaGetUserTags(d.path || "").length === 0);
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

    function getTagEntryDisplayIcon(entry) {
      if (!entry || entry.kind !== "tag") return "🏷";
      if (entry.album && !entry.tag) return "🗂";
      if (entry.special === "favorites") return "♥";
      if (entry.special === "hidden") return "🙈";
      if (entry.special === "untagged") return "📂";
      return "🏷";
    }

    function getTagEntryCountText(entry) {
      const folderCount = Math.max(0, Number(entry && entry.count) || 0);
      const type = String(entry && entry.placeholderType || "");
      if (entry && entry.album && !entry.tag) {
        const tagCount = Math.max(0, Number(entry.tagCount) || 0);
        if (tagCount && folderCount) return `${tagCount} tags • ${folderCount} folders`;
        if (tagCount) return `${tagCount} tags`;
        if (folderCount) return `${folderCount} folders`;
        return "Tag album";
      }
      if (type === "album") {
        return folderCount ? `${folderCount} tags` : "Tag album";
      }
      return folderCount ? `${folderCount} folders` : "Tag folder";
    }

    const ROTATING_PREVIEW_POOLS = new Map();
    const ROTATING_PREVIEW_ORDER = new Map();
    const ROTATING_PREVIEW_INDEX = new Map();
    const ROTATING_PREVIEW_NEXT_AT = new Map();
    let ROTATING_PREVIEW_TIMER = 0;
    const ROTATING_PREVIEW_INTERVAL_MS = 24000;
    const ROTATING_PREVIEW_JITTER_RATIO = 0.5;
    const ROTATING_PREVIEW_JITTER_MS = Math.round(ROTATING_PREVIEW_INTERVAL_MS * ROTATING_PREVIEW_JITTER_RATIO);
    const ROTATING_PREVIEW_POLL_MS = 1000;
    const ROTATING_PREVIEW_FADE_MS = 900;

    function shuffleArrayInPlace(arr) {
      if (!Array.isArray(arr) || arr.length < 2) return arr;
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    }

    function topRootBucketKeyForDirPath(dirPath) {
      const parts = String(dirPath || "").split("/").filter(Boolean);
      return parts.length ? String(parts[0] || "") : "";
    }

    function buildRootBucketRecursiveMediaCounts() {
      const counts = new Map();
      for (const rec of WS.fileById.values()) {
        if (!rec) continue;
        const bucketKey = topRootBucketKeyForDirPath(rec.dirPath || "");
        counts.set(bucketKey, (counts.get(bucketKey) || 0) + 1);
      }
      return counts;
    }

    function pickWeightedRotationId(ids, weights, totalWeight) {
      const list = Array.isArray(ids) ? ids : [];
      const w = Array.isArray(weights) ? weights : [];
      if (!list.length) return "";
      if (list.length === 1) return String(list[0] || "");
      const total = Number(totalWeight);
      if (!Number.isFinite(total) || total <= 0) {
        return String(list[Math.floor(Math.random() * list.length)] || "");
      }
      let needle = Math.random() * total;
      for (let i = 0; i < list.length; i++) {
        needle -= Number(w[i] || 0);
        if (needle <= 0) return String(list[i] || "");
      }
      return String(list[list.length - 1] || "");
    }

    function buildWeightedRotationOrder(ids) {
      const uniq = [];
      const seen = new Set();
      for (let i = 0; i < (ids || []).length; i++) {
        const id = String(ids[i] || "");
        if (!id || seen.has(id)) continue;
        if (!WS.fileById.has(id)) continue;
        seen.add(id);
        uniq.push(id);
      }
      if (uniq.length < 2) return uniq.slice();

      const rootBucketCounts = buildRootBucketRecursiveMediaCounts();
      const weights = [];
      let totalWeight = 0;
      for (let i = 0; i < uniq.length; i++) {
        const rec = WS.fileById.get(uniq[i]);
        const bucketKey = topRootBucketKeyForDirPath(rec?.dirPath || "");
        const bucketCount = Math.max(1, Number(rootBucketCounts.get(bucketKey) || 0));
        const weight = 1 / bucketCount;
        weights.push(weight);
        totalWeight += weight;
      }
      if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
        return shuffleArrayInPlace(uniq.slice());
      }

      const out = [];
      let lastId = "";
      for (let i = 0; i < uniq.length; i++) {
        let picked = pickWeightedRotationId(uniq, weights, totalWeight);
        if (picked && picked === lastId && uniq.length > 1) {
          for (let tries = 0; tries < 3 && picked === lastId; tries++) {
            picked = pickWeightedRotationId(uniq, weights, totalWeight);
          }
        }
        if (!picked) picked = uniq[Math.floor(Math.random() * uniq.length)] || "";
        out.push(picked);
        lastId = picked;
      }
      return out;
    }

    function sampleRecursivePreviewRecords(dirNodes, limit = 72, includeRootFiles = true) {
      const roots = Array.isArray(dirNodes) ? dirNodes.filter(Boolean) : [];
      if (!roots.length) return [];
      const capRaw = Number(limit);
      const cap = Number.isFinite(capRaw) ? Math.max(0, Math.floor(capRaw)) : 0;
      const out = [];
      const seenIds = new Set();
      for (let r = 0; r < roots.length; r++) {
        const root = roots[r];
        if (!root) continue;
        const queue = [root];
        while (queue.length) {
          const cur = queue.shift();
          if (!cur) continue;
          const includeHere = includeRootFiles || cur !== root;
          if (includeHere) {
            const ids = getOrderedFileIdsForDir(cur, false);
            for (let i = 0; i < ids.length; i++) {
              const id = String(ids[i] || "");
              if (!id || seenIds.has(id)) continue;
              const rec = WS.fileById.get(id);
              if (!rec) continue;
              seenIds.add(id);
              out.push(rec);
            }
          }
          const kids = getChildDirsForNode(cur);
          for (let i = 0; i < kids.length; i++) queue.push(kids[i]);
        }
      }
      if (!cap || out.length <= cap) return out;
      const seedSource = roots.map((n) => String(n && n.path || "")).join("|");
      const seed = hash32(`rotate-sample|${seedSource}|${includeRootFiles ? "1" : "0"}|${out.length}`);
      const shuffled = shuffleWithSeed(out.slice(), seed);
      return shuffled.slice(0, cap);
    }

    function getFirstDirectPreviewRecordForDir(dirNode) {
      const ids = getOrderedFileIdsForDir(dirNode, false);
      if (!ids.length) return null;
      return WS.fileById.get(ids[0]) || null;
    }

    function findFileRecordByRelPath(relPath) {
      const needle = normalizeWorkspaceRelPath(relPath);
      if (!needle) return null;
      for (const rec of WS.fileById.values()) {
        if (!rec) continue;
        if (normalizeWorkspaceRelPath(rec.relPath || "") === needle) return rec;
      }
      return null;
    }

    function isRecordInDirSubtree(rec, dirNode) {
      if (!rec || !dirNode) return false;
      const dirPath = String(dirNode.path || "");
      const recDirPath = String(rec.dirPath || "");
      if (!dirPath) return true;
      return recDirPath === dirPath || recDirPath.startsWith(dirPath + "/");
    }

    function getPresetPreviewRecordForDir(dirNode) {
      if (!dirNode) return null;
      const dirPath = String(dirNode.path || "");
      if (!dirPath && dirNode !== WS.root) return null;
      const relPath = metaGetFolderThumbnailPresetRelPath(dirPath);
      if (!relPath) return null;
      const rec = findFileRecordByRelPath(relPath);
      if (!rec) return null;
      if (!passesFilter(rec)) return null;
      if (!isRecordInDirSubtree(rec, dirNode)) return null;
      return rec;
    }

    function getRecursivePreviewRecordsForDir(dirNode, limit = 72, includeSelfFiles = true) {
      if (!dirNode) return [];
      return sampleRecursivePreviewRecords([dirNode], limit, includeSelfFiles);
    }

    function folderEligibleForParentThumbnailPreset(dirNode) {
      if (!dirNode) return false;
      const dirPath = String(dirNode.path || "");
      if (!dirPath && dirNode !== WS.root) return false;
      if (metaGetFolderThumbnailMode(dirPath) !== "rotate") return true;
      if (getFirstDirectPreviewRecordForDir(dirNode)) return false;
      return getRecursivePreviewRecordsForDir(dirNode, 1, false).length > 0;
    }

    function getDisplayLeadPreviewForDir(dirNode, rotateKeyPrefix = "dir") {
      if (!dirNode) return { record: null, rotateKey: "" };
      const dirPath = String(dirNode.path || "");
      if (metaGetFolderThumbnailMode(dirPath) === "none") return { record: null, rotateKey: "" };
      const presetRec = getPresetPreviewRecordForDir(dirNode);
      if (presetRec) return { record: presetRec, rotateKey: "" };
      const directRec = getFirstDirectPreviewRecordForDir(dirNode);
      if (directRec) return { record: directRec, rotateKey: "" };
      if (naturalAspectThumbnailCardsEnabled()) return { record: null, rotateKey: "" };
      if (!dirPath && dirNode !== WS.root) return { record: null, rotateKey: "" };
      const recursivePool = getRecursivePreviewRecordsForDir(dirNode, 0, false);
      if (!recursivePool.length) return { record: null, rotateKey: "" };
      const rotateKey = `${String(rotateKeyPrefix || "dir")}:${dirPath}:recursive`;
      const record = pickRotatingPreviewRecordForKey(rotateKey, recursivePool);
      return { record: record || null, rotateKey };
    }

    function findNearestPresettableParentForRecord(rec) {
      if (!rec) return null;
      const startNode = WS.dirByPath.get(String(rec.dirPath || ""));
      let cur = startNode && startNode.parent ? startNode.parent : null;
      while (cur) {
        if (folderEligibleForParentThumbnailPreset(cur)) return cur;
        cur = cur.parent;
      }
      return null;
    }

    function setFolderThumbnailTargetFromRecord(rec, targetPath) {
      const normalizedPath = normalizeDirPathValue(targetPath);
      if (!normalizedPath) {
        return setRootThumbnailFromRecord(rec);
      }
      const folderNode = WS.dirByPath.get(normalizedPath);
      if (!folderNode) {
        showStatusMessage("Target folder is unavailable.");
        return false;
      }
      const relPath = normalizeWorkspaceRelPath(rec?.relPath);
      if (!relPath) {
        showStatusMessage("Selected file is unavailable.");
        return false;
      }
      const changed = metaSetFolderThumbnailPreset(normalizedPath, relPath);
      if (!changed) {
        showStatusMessage(`Thumbnail already set for ${dirDisplayName(folderNode)}.`);
        return false;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage(`Set thumbnail for ${dirDisplayName(folderNode)}.`);
      return true;
    }

    function setParentThumbnailFromRecord(rec) {
      const targetNode = findNearestPresettableParentForRecord(rec);
      if (!targetNode || !targetNode.path) {
        showStatusMessage("No eligible parent folder found.");
        return false;
      }
      return setFolderThumbnailTargetFromRecord(rec, String(targetNode.path || ""));
    }

    function setFolderThumbnailFromRecord(rec) {
      const folderPath = String(rec?.dirPath || "");
      if (!folderPath || !WS.dirByPath.has(folderPath)) {
        showStatusMessage("Selected file has no target folder.");
        return false;
      }
      return setFolderThumbnailTargetFromRecord(rec, folderPath);
    }

    function setRootThumbnailFromRecord(rec) {
      if (!WS.root) {
        showStatusMessage("No root folder is available.");
        return false;
      }
      const relPath = normalizeWorkspaceRelPath(rec?.relPath || "");
      if (!relPath) {
        showStatusMessage("Selected file is unavailable.");
        return false;
      }
      const changed = metaSetTagThumbnailPresetByKey(rootThumbnailKey(), relPath);
      if (!changed) {
        showStatusMessage("Root thumbnail is already set to this file.");
        return false;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage("Set thumbnail for root.");
      return true;
    }

    function getRootThumbnailMode() {
      return metaGetTagThumbnailModeByKey(rootThumbnailKey());
    }

    function rootThumbnailHasPreset() {
      return metaHasTagThumbnailPresetByKey(rootThumbnailKey());
    }

    function setRootThumbnailMode(mode) {
      return metaSetTagThumbnailModeByKey(rootThumbnailKey(), mode);
    }

    function clearRootThumbnailPreset() {
      return metaClearTagThumbnailPresetByKey(rootThumbnailKey());
    }

    function resetRootThumbnailToDefault() {
      const cleared = clearRootThumbnailPreset();
      const modeChanged = setRootThumbnailMode("quad");
      return cleared || modeChanged;
    }

    function clearEditedThumbnailCrops() {
      if (!WS.meta) return 0;
      const cropCount = WS.meta.fileThumbCrop ? WS.meta.fileThumbCrop.size : 0;
      const frameCount = WS.meta.videoThumbTime ? WS.meta.videoThumbTime.size : 0;
      const count = cropCount + frameCount;
      if (!count) return 0;
      if (WS.meta.fileThumbCrop) WS.meta.fileThumbCrop.clear();
      if (WS.meta.videoThumbTime) WS.meta.videoThumbTime.clear();
      WS.meta.dirty = true;
      metaScheduleSave();
      return count;
    }

    function clearThumbnailAssignmentsToDefaults() {
      if (!WS.meta) return 0;
      let count = 0;
      if (WS.meta.dirThumbPresets && WS.meta.dirThumbPresets.size) {
        count += WS.meta.dirThumbPresets.size;
        WS.meta.dirThumbPresets.clear();
      }
      if (WS.meta.tagThumbPresets && WS.meta.tagThumbPresets.size) {
        count += WS.meta.tagThumbPresets.size;
        WS.meta.tagThumbPresets.clear();
      }
      if (WS.meta.tagThumbModes && WS.meta.tagThumbModes.size) {
        count += WS.meta.tagThumbModes.size;
        WS.meta.tagThumbModes.clear();
      }
      if (!count) return 0;
      WS.meta.dirty = true;
      metaScheduleSave();
      return count;
    }

    function clearAllThumbnailCustomizations() {
      if (!WS.meta) return { cropCount: 0, assignmentCount: 0, total: 0 };
      const cropCount = (WS.meta.fileThumbCrop ? WS.meta.fileThumbCrop.size : 0)
        + (WS.meta.videoThumbTime ? WS.meta.videoThumbTime.size : 0);
      const dirCount = WS.meta.dirThumbPresets ? WS.meta.dirThumbPresets.size : 0;
      const tagPresetCount = WS.meta.tagThumbPresets ? WS.meta.tagThumbPresets.size : 0;
      const tagModeCount = WS.meta.tagThumbModes ? WS.meta.tagThumbModes.size : 0;
      const assignmentCount = dirCount + tagPresetCount + tagModeCount;
      if (WS.meta.fileThumbCrop) WS.meta.fileThumbCrop.clear();
      if (WS.meta.videoThumbTime) WS.meta.videoThumbTime.clear();
      if (WS.meta.dirThumbPresets) WS.meta.dirThumbPresets.clear();
      if (WS.meta.tagThumbPresets) WS.meta.tagThumbPresets.clear();
      if (WS.meta.tagThumbModes) WS.meta.tagThumbModes.clear();
      const total = cropCount + assignmentCount;
      if (total > 0) {
        WS.meta.dirty = true;
        metaScheduleSave();
      }
      return { cropCount, assignmentCount, total };
    }

    function hasKnownPreviewAspect(rec) {
      const ar = Number(rec && rec.previewAspect);
      return Number.isFinite(ar) && ar > 0;
    }

    async function detectRecordPreviewAspect(rec) {
      if (!rec) return null;
      if (hasKnownPreviewAspect(rec)) {
        return normalizePreviewAspect(rec.previewAspect, 4 / 3);
      }

      if (rec.type === "image") {
        let w = 0;
        let h = 0;
        if (rec.file) {
          try {
            const bmp = await createImageBitmap(rec.file);
            w = Number(bmp && bmp.width) || 0;
            h = Number(bmp && bmp.height) || 0;
            try { bmp.close(); } catch {}
          } catch {}
        }
        if (!(w > 0 && h > 0)) {
          const src = ensureMediaUrl(rec);
          if (src) {
            try {
              const dims = await new Promise((resolve) => {
                const img = new Image();
                const done = (out) => resolve(out || { w: 0, h: 0 });
                img.onload = () => done({ w: Number(img.naturalWidth) || 0, h: Number(img.naturalHeight) || 0 });
                img.onerror = () => done({ w: 0, h: 0 });
                img.src = src;
              });
              w = Number(dims && dims.w) || 0;
              h = Number(dims && dims.h) || 0;
            } catch {}
          }
        }
        if (w > 0 && h > 0) return normalizePreviewAspect(w / h, 4 / 3);
        return null;
      }

      if (rec.type === "video") {
        const knownVideoAspect = Number(rec.videoAspect);
        if (Number.isFinite(knownVideoAspect) && knownVideoAspect > 0) {
          return normalizePreviewAspect(knownVideoAspect, 4 / 3);
        }
        const src = ensureMediaUrl(rec);
        if (!src) return null;
        try {
          const dims = await new Promise((resolve) => {
            const v = document.createElement("video");
            let settled = false;
            const done = (out) => {
              if (settled) return;
              settled = true;
              try {
                v.pause();
                v.removeAttribute("src");
                v.load();
              } catch {}
              resolve(out || { w: 0, h: 0 });
            };
            const timer = setTimeout(() => done({ w: 0, h: 0 }), 2000);
            v.preload = "metadata";
            v.muted = true;
            v.playsInline = true;
            v.onloadedmetadata = () => {
              clearTimeout(timer);
              done({ w: Number(v.videoWidth) || 0, h: Number(v.videoHeight) || 0 });
            };
            v.onerror = () => {
              clearTimeout(timer);
              done({ w: 0, h: 0 });
            };
            v.src = src;
          });
          const w = Number(dims && dims.w) || 0;
          const h = Number(dims && dims.h) || 0;
          if (w > 0 && h > 0) return normalizePreviewAspect(w / h, 4 / 3);
        } catch {}
      }

      return null;
    }

    async function hydrateEditedThumbnailAspects() {
      if (!WS.meta || !WS.meta.fileThumbCrop || !WS.meta.fileThumbCrop.size) return false;
      const records = [];
      const seen = new Set();
      for (const relPath of WS.meta.fileThumbCrop.keys()) {
        const rec = findFileRecordByRelPath(relPath);
        if (!rec) continue;
        const id = String(rec.id || "");
        if (!id || seen.has(id)) continue;
        if (hasKnownPreviewAspect(rec)) continue;
        seen.add(id);
        records.push(rec);
      }
      if (!records.length) return false;

      let changed = false;
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const detected = await detectRecordPreviewAspect(rec);
        if (!detected) continue;
        const prev = Number(rec.previewAspect);
        if (!Number.isFinite(prev) || Math.abs(prev - detected) > 0.0001) {
          rec.previewAspect = detected;
          changed = true;
        }
      }
      return changed;
    }

    function getRootPresetPreviewRecord(rootNode, rootPool = null) {
      if (!rootNode) return null;
      const key = rootThumbnailKey();
      const relPath = metaGetTagThumbnailPresetRelPathByKey(key);
      if (!relPath) return null;
      const rec = findFileRecordByRelPath(relPath);
      if (!rec || !passesFilter(rec) || !isRecordInDirSubtree(rec, rootNode)) return null;
      if (Array.isArray(rootPool) && rootPool.length) {
        const idSet = new Set(rootPool.map((r) => String(r && r.id || "")).filter(Boolean));
        if (!idSet.has(String(rec.id || ""))) return null;
      }
      return rec;
    }

    function tagThumbnailLabelForKey(tagKey) {
      const key = String(tagKey || "");
      if (!key) return "tag";
      const parsed = parseTagThumbnailStructuredKey(key);
      if (parsed) {
        const value = String(parsed.value || "");
        const scopeLabel = parsed.scoped ? tagThumbnailScopeLabelForPath(parsed.scopePath) : "";
        if (parsed.kind === "tag") {
          if (!value) return "tag";
          return parsed.scoped ? `${value} in ${scopeLabel}` : value;
        }
        if (parsed.kind === "album") {
          if (!value) return "Album";
          return parsed.scoped ? `Album ${value} in ${scopeLabel}` : `Album ${value}`;
        }
      }
      if (key === rootThumbnailKey()) return "Root";
      if (key.startsWith("special:favorites:")) {
        const scope = key.slice("special:favorites:".length);
        const scopePath = tagThumbnailScopePathFromKey(scope);
        const scopeLabel = tagThumbnailScopeLabelForPath(scopePath);
        return `Favorites in ${scopeLabel}`;
      }
      if (key === "special:favorites") return "Favorites";
      if (key === "special:hidden") return "Hidden";
      if (key === "special:untagged") return "Untagged";
      if (key.startsWith("special:")) return toTitleCaps(key.slice(8) || "tag");
      return key;
    }

    function getTagThumbnailTargetsForRecord(rec) {
      const out = [];
      const seen = new Set();
      let cur = WS.dirByPath.get(String(rec?.dirPath || "")) || null;
      while (cur) {
        const scopeNode = cur.parent || WS.root || null;
        const scopePath = String(scopeNode ? scopeNode.path || "" : "");
        const scopeLabel = tagThumbnailScopeLabelForPath(scopePath);
        const tags = metaGetUserTags(cur.path || "");
        for (let i = 0; i < tags.length; i++) {
          const tag = normalizeTag(tags[i] || "");
          if (!tag) continue;
          const key = tagThumbnailKeyForTag(tag, scopePath);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({
            key,
            label: `${tag} in ${scopeLabel}`,
            actionLabel: `Set '${tag}' thumbnail in ${scopeLabel}`
          });
          const album = metaGetTagAlbumForTag(tag);
          const albumKey = tagThumbnailKeyForAlbum(album, scopePath);
          if (album && albumKey && !seen.has(albumKey)) {
            seen.add(albumKey);
            out.push({
              key: albumKey,
              label: `Album: ${album} in ${scopeLabel}`,
              actionLabel: `Set '${album}' album thumbnail in ${scopeLabel}`
            });
          }
        }
        if (metaHasFavorite(cur.path || "")) {
          const scopeNode = cur.parent || WS.root || null;
          const scopePath = String(scopeNode ? scopeNode.path || "" : "");
          const scopeKey = tagThumbnailScopeKeyFromPath(scopePath);
          const key = `special:favorites:${scopeKey}`;
          if (!seen.has(key)) {
            seen.add(key);
            const scopeLabel = scopeNode ? dirDisplayName(scopeNode) : "root";
            out.push({
              key,
              label: `Favorites in ${scopeLabel}`,
              actionLabel: `Set favorites thumbnail in ${scopeLabel}`
            });
          }
        }
        cur = cur.parent || null;
      }
      out.sort((a, b) => String(a.actionLabel || a.label || "").localeCompare(String(b.actionLabel || b.label || "")));
      return out;
    }

    function getFolderThumbnailTargetsForRecord(rec) {
      const out = [];
      if (!rec) return out;
      const startPath = String(rec.dirPath || "");
      const seen = new Set();
      let cur = WS.dirByPath.get(startPath) || null;
      while (cur) {
        const p = String(cur.path || "");
        const key = p;
        if (!seen.has(key)) {
          seen.add(key);
          if (p) {
            const folderLabel = displayPath(p) || dirDisplayName(cur) || "folder";
            out.push({
              path: p,
              label: folderLabel,
              actionLabel: `Set '${folderLabel}' thumbnail`
            });
          }
        }
        cur = cur.parent || null;
      }
      if (!out.some((item) => String(item?.path || "") === "")) {
        out.push({
          path: "",
          label: "Root",
          actionLabel: "Set root thumbnail"
        });
      }
      return out;
    }

    function isRecordInAnyDirSubtree(rec, dirs) {
      if (!rec || !Array.isArray(dirs) || !dirs.length) return false;
      for (let i = 0; i < dirs.length; i++) {
        if (isRecordInDirSubtree(rec, dirs[i])) return true;
      }
      return false;
    }

    function tagThumbnailActionForKey(tagKey) {
      return `set-tag-thumbnail:${encodeURIComponent(String(tagKey || ""))}`;
    }

    function folderThumbnailActionForPath(path) {
      const normalized = normalizeDirPathValue(path);
      const key = normalized ? normalized : "__root__";
      return `set-folder-thumbnail-target:${encodeURIComponent(key)}`;
    }

    function parseFolderThumbnailAction(action) {
      const raw = String(action || "");
      const prefix = "set-folder-thumbnail-target:";
      if (!raw.startsWith(prefix)) return null;
      const encoded = raw.slice(prefix.length);
      if (!encoded) return null;
      try {
        const decoded = decodeURIComponent(encoded);
        if (decoded === "__root__") return "";
        return normalizeDirPathValue(decoded);
      } catch {
        return null;
      }
    }

    function parseTagThumbnailAction(action) {
      const raw = String(action || "");
      const prefix = "set-tag-thumbnail:";
      if (!raw.startsWith(prefix)) return "";
      const encoded = raw.slice(prefix.length);
      if (!encoded) return "";
      try {
        return decodeURIComponent(encoded);
      } catch {
        return "";
      }
    }

    function closeThumbnailCropEditor() {
      if (!THUMB_CROP_EDITOR) return;
      const editorVideo = THUMB_CROP_EDITOR.querySelector
        ? THUMB_CROP_EDITOR.querySelector("video.thumbCropEditorPreviewFull")
        : null;
      if (editorVideo) {
        try { editorVideo.pause(); } catch {}
        try { editorVideo.removeAttribute("src"); } catch {}
        try { editorVideo.load(); } catch {}
      }
      try { THUMB_CROP_EDITOR.remove(); } catch {}
      THUMB_CROP_EDITOR = null;
    }

    function formatThumbnailEditorTimeLabel(secondsRaw) {
      const seconds = Math.max(0, Number(secondsRaw) || 0);
      const whole = Math.floor(seconds);
      const mins = Math.floor(whole / 60);
      const secs = whole % 60;
      const frac = Math.floor((seconds - whole) * 100);
      return `${mins}:${String(secs).padStart(2, "0")}.${String(frac).padStart(2, "0")}`;
    }

    function openThumbnailCropEditor(rec) {
      const targetLabel = "this file";
      if (!rec) return false;
      const isVideoEditor = rec.type === "video";
      const previewSrc = isVideoEditor
        ? (ensureMediaUrl(rec) || "")
        : (ensureThumbUrl(rec) || "");
      if (!previewSrc) {
        showStatusMessage("Thumbnail preview is unavailable.");
        return false;
      }

      closeThumbnailCropEditor();

      const crop = normalizeThumbCropValue(metaGetFileThumbnailCropForRecord(rec) || { x: 50, y: 50, zoom: 1 });
      const savedVideoFrameTime = isVideoEditor ? metaGetVideoThumbnailTimeForRecord(rec) : null;
      const mediaHtml = isVideoEditor
        ? `<video class="thumbCropEditorPreviewFull thumbCropEditorPreviewVideo" src="${escapeHtml(previewSrc)}" preload="metadata" playsinline muted></video>`
        : `<img class="thumbCropEditorPreviewFull" src="${escapeHtml(previewSrc)}" alt="" />`;
      const frameControlHtml = isVideoEditor
        ? `
          <div class="thumbCropEditorControl">
            <label>Frame</label>
            <input type="range" min="0" max="0" step="0.01" value="0" data-crop-field="frame" disabled />
            <span data-crop-value="frame">0:00.00</span>
          </div>
        `
        : "";
      const overlay = document.createElement("div");
      overlay.className = "thumbCropEditorOverlay";
      overlay.tabIndex = -1;
      overlay.innerHTML = `
        <div class="thumbCropEditorPanel" role="dialog" aria-modal="true" aria-label="Edit thumbnail">
          <div class="thumbCropEditorTitle">Edit thumbnail</div>
          <div class="thumbCropEditorSubtitle">${escapeHtml(targetLabel)}</div>
          <div class="thumbCropEditorPreviewWrap">
            ${mediaHtml}
            <div class="thumbCropEditorShade" data-crop-shade="top"></div>
            <div class="thumbCropEditorShade" data-crop-shade="left"></div>
            <div class="thumbCropEditorShade" data-crop-shade="right"></div>
            <div class="thumbCropEditorShade" data-crop-shade="bottom"></div>
            <div class="thumbCropEditorCropBox" data-crop-box="1"></div>
            <button type="button" class="thumbCropEditorResizeHandle" data-crop-handle="resize" aria-label="Resize crop viewport" tabindex="-1"></button>
          </div>
          ${frameControlHtml}
          <div class="thumbCropEditorHint">Drag to pan. Drag corner or pinch to zoom.</div>
          <div class="thumbCropEditorControl">
            <label>Horizontal focus</label>
            <input type="range" min="0" max="100" step="1" value="${escapeHtml(String(crop.x))}" data-crop-field="x" />
            <span data-crop-value="x">${escapeHtml(String(Math.round(crop.x)))}</span>
          </div>
          <div class="thumbCropEditorControl">
            <label>Vertical focus</label>
            <input type="range" min="0" max="100" step="1" value="${escapeHtml(String(crop.y))}" data-crop-field="y" />
            <span data-crop-value="y">${escapeHtml(String(Math.round(crop.y)))}</span>
          </div>
          <div class="thumbCropEditorControl">
            <label>Zoom</label>
            <input type="range" min="1" max="4" step="0.01" value="${escapeHtml(String(crop.zoom))}" data-crop-field="zoom" />
            <span data-crop-value="zoom">${escapeHtml(crop.zoom.toFixed(2))}</span>
          </div>
          <div class="thumbCropEditorActions">
            <button type="button" data-crop-action="reset">Reset</button>
            <button type="button" data-crop-action="cancel">Cancel</button>
            <button type="button" data-crop-action="save">Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      THUMB_CROP_EDITOR = overlay;

      const panel = overlay.querySelector(".thumbCropEditorPanel");
      const previewWrap = overlay.querySelector(".thumbCropEditorPreviewWrap");
      const previewMedia = overlay.querySelector(".thumbCropEditorPreviewFull");
      const previewImage = (isVideoEditor ? null : previewMedia);
      const previewVideo = (isVideoEditor ? previewMedia : null);
      const cropBox = overlay.querySelector('[data-crop-box="1"]');
      const shadeTop = overlay.querySelector('[data-crop-shade="top"]');
      const shadeLeft = overlay.querySelector('[data-crop-shade="left"]');
      const shadeRight = overlay.querySelector('[data-crop-shade="right"]');
      const shadeBottom = overlay.querySelector('[data-crop-shade="bottom"]');
      const resizeHandle = overlay.querySelector('[data-crop-handle="resize"]');
      const rangeX = overlay.querySelector('input[data-crop-field="x"]');
      const rangeY = overlay.querySelector('input[data-crop-field="y"]');
      const rangeZoom = overlay.querySelector('input[data-crop-field="zoom"]');
      const rangeFrame = overlay.querySelector('input[data-crop-field="frame"]');
      const valX = overlay.querySelector('[data-crop-value="x"]');
      const valY = overlay.querySelector('[data-crop-value="y"]');
      const valZoom = overlay.querySelector('[data-crop-value="zoom"]');
      const valFrame = overlay.querySelector('[data-crop-value="frame"]');
      let editorAspect = normalizePreviewAspect(getPreviewAspectForRecord(rec), 4 / 3);
      let editorVideoDuration = 0;
      const getEditorAspect = () => normalizePreviewAspect(editorAspect, 4 / 3);
      const applyEditorAspect = (nextAspect) => {
        editorAspect = normalizePreviewAspect(nextAspect, getEditorAspect());
        if (previewWrap) previewWrap.style.setProperty("--editor-ar", String(editorAspect));
      };
      const getCurrent = () => normalizeThumbCropValue({
        x: Number(rangeX?.value || 50),
        y: Number(rangeY?.value || 50),
        zoom: Number(rangeZoom?.value || 1)
      });
      const applyPreview = () => {
        const cur = getCurrent();
        const overlayWin = computeEditorCropWindow(getEditorAspect(), cur);
        const left = Number(overlayWin.leftPct) || 0;
        const top = Number(overlayWin.topPct) || 0;
        const width = Number(overlayWin.widthPct) || 0;
        const height = Number(overlayWin.heightPct) || 0;
        const right = Math.max(0, 100 - (left + width));
        const bottom = Math.max(0, 100 - (top + height));
        if (valX) valX.textContent = String(Math.round(cur.x));
        if (valY) valY.textContent = String(Math.round(cur.y));
        if (valZoom) valZoom.textContent = cur.zoom.toFixed(2);
        if (cropBox) {
          cropBox.style.left = `${left}%`;
          cropBox.style.top = `${top}%`;
          cropBox.style.width = `${width}%`;
          cropBox.style.height = `${height}%`;
        }
        if (shadeTop) {
          shadeTop.style.left = "0%";
          shadeTop.style.top = "0%";
          shadeTop.style.width = "100%";
          shadeTop.style.height = `${top}%`;
        }
        if (shadeBottom) {
          shadeBottom.style.left = "0%";
          shadeBottom.style.top = `${top + height}%`;
          shadeBottom.style.width = "100%";
          shadeBottom.style.height = `${bottom}%`;
        }
        if (shadeLeft) {
          shadeLeft.style.left = "0%";
          shadeLeft.style.top = `${top}%`;
          shadeLeft.style.width = `${left}%`;
          shadeLeft.style.height = `${height}%`;
        }
        if (shadeRight) {
          shadeRight.style.left = `${left + width}%`;
          shadeRight.style.top = `${top}%`;
          shadeRight.style.width = `${right}%`;
          shadeRight.style.height = `${height}%`;
        }
        if (resizeHandle) {
          resizeHandle.style.left = `${left + width}%`;
          resizeHandle.style.top = `${top + height}%`;
        }
      };
      const setCurrent = (nextCrop) => {
        const next = normalizeThumbCropValue(nextCrop);
        if (rangeX) rangeX.value = String(next.x);
        if (rangeY) rangeY.value = String(next.y);
        if (rangeZoom) rangeZoom.value = String(next.zoom);
        applyPreview();
      };
      const clampEditorVideoTime = (timeValue) => normalizeVideoThumbTimeValue(timeValue, editorVideoDuration);
      const getDefaultEditorVideoTime = () => {
        if (!isVideoEditor) return 0;
        const seekTimes = computeVideoThumbSeekTimes(editorVideoDuration || 0);
        return clampEditorVideoTime(seekTimes[0] || 0) || 0;
      };
      const getCurrentEditorVideoTime = () => {
        if (!isVideoEditor || !rangeFrame) return null;
        return clampEditorVideoTime(rangeFrame.value);
      };
      const updateEditorVideoFrameLabel = (timeValue) => {
        if (!valFrame) return;
        valFrame.textContent = formatThumbnailEditorTimeLabel(timeValue);
      };
      const syncEditorVideoTimeToSlider = (timeValue) => {
        if (!rangeFrame) return;
        const clamped = clampEditorVideoTime(timeValue);
        const safeValue = Number.isFinite(clamped) ? clamped : 0;
        rangeFrame.value = String(safeValue);
        updateEditorVideoFrameLabel(safeValue);
      };
      const seekEditorVideoToTime = (timeValue) => {
        if (!previewVideo) return;
        const clamped = clampEditorVideoTime(timeValue);
        if (!Number.isFinite(clamped)) return;
        syncEditorVideoTimeToSlider(clamped);
        try { previewVideo.currentTime = clamped; } catch {}
      };
      const updateEditorVideoFrameRange = () => {
        if (!rangeFrame) return;
        if (!(editorVideoDuration > 0)) {
          rangeFrame.min = "0";
          rangeFrame.max = "0";
          rangeFrame.step = "0.01";
          rangeFrame.value = "0";
          rangeFrame.disabled = true;
          updateEditorVideoFrameLabel(0);
          return;
        }
        const step = Math.max(0.01, Math.min(0.25, editorVideoDuration / 1000));
        rangeFrame.min = "0";
        rangeFrame.max = String(Math.max(0, editorVideoDuration - 0.05));
        rangeFrame.step = String(Math.round(step * 1000) / 1000);
        rangeFrame.disabled = false;
      };
      const getWrapSize = () => {
        const rect = previewWrap && previewWrap.getBoundingClientRect
          ? previewWrap.getBoundingClientRect()
          : null;
        return {
          width: Math.max(1, Number(rect && rect.width) || 1),
          height: Math.max(1, Number(rect && rect.height) || 1)
        };
      };
      const cropWithZoomAroundAnchor = (startCrop, nextZoom, anchorU = null, anchorV = null) => {
        const base = normalizeThumbCropValue(startCrop || getCurrent());
        const zoom = Math.min(4, Math.max(1, Number(nextZoom) || base.zoom || 1));
        const baseWin = computeEditorCropWindow(getEditorAspect(), base);
        const baseLeft = (Number(baseWin.leftPct) || 0) / 100;
        const baseTop = (Number(baseWin.topPct) || 0) / 100;
        const baseW = (Number(baseWin.widthPct) || 0) / 100;
        const baseH = (Number(baseWin.heightPct) || 0) / 100;
        const focusU = Number.isFinite(Number(anchorU))
          ? Math.max(0, Math.min(1, Number(anchorU)))
          : Math.max(0, Math.min(1, baseLeft + (baseW * 0.5)));
        const focusV = Number.isFinite(Number(anchorV))
          ? Math.max(0, Math.min(1, Number(anchorV)))
          : Math.max(0, Math.min(1, baseTop + (baseH * 0.5)));
        const probe = computeEditorCropWindow(getEditorAspect(), { x: 50, y: 50, zoom });
        const nextW = (Number(probe.widthPct) || 0) / 100;
        const nextH = (Number(probe.heightPct) || 0) / 100;
        const nextRangeX = (Number(probe.rangeXPct) || 0) / 100;
        const nextRangeY = (Number(probe.rangeYPct) || 0) / 100;
        const nextLeft = Math.min(nextRangeX, Math.max(0, focusU - (nextW * 0.5)));
        const nextTop = Math.min(nextRangeY, Math.max(0, focusV - (nextH * 0.5)));
        const nextX = nextRangeX > 0.000001 ? (nextLeft / nextRangeX) * 100 : 50;
        const nextY = nextRangeY > 0.000001 ? (nextTop / nextRangeY) * 100 : 50;
        return normalizeThumbCropValue({ x: nextX, y: nextY, zoom });
      };
      const cropFromPanPixels = (startCrop, dx, dy, zoomOverride = null) => {
        const hasZoomOverride = zoomOverride !== null && zoomOverride !== undefined && zoomOverride !== "";
        const overrideZoom = hasZoomOverride ? Number(zoomOverride) : NaN;
        const liveZoom = Number(rangeZoom?.value);
        const currentZoom = Number(getCurrent().zoom);
        const startZoom = Number(startCrop && startCrop.zoom);
        const zoom = Number.isFinite(overrideZoom)
          ? overrideZoom
          : (Number.isFinite(liveZoom)
            ? liveZoom
            : (Number.isFinite(currentZoom)
              ? currentZoom
              : (Number.isFinite(startZoom) ? startZoom : 1)));
        const base = normalizeThumbCropValue({ x: Number(startCrop && startCrop.x), y: Number(startCrop && startCrop.y), zoom });
        const wrapSize = getWrapSize();
        const overlayWin = computeEditorCropWindow(getEditorAspect(), base);
        const rangeX = Math.max(0, Number(overlayWin.rangeXPct) / 100);
        const rangeY = Math.max(0, Number(overlayWin.rangeYPct) / 100);
        const nextX = rangeX > 0.000001
          ? base.x + (((Number(dx) || 0) / wrapSize.width) * (100 / rangeX))
          : base.x;
        const nextY = rangeY > 0.000001
          ? base.y + (((Number(dy) || 0) / wrapSize.height) * (100 / rangeY))
          : base.y;
        return normalizeThumbCropValue({
          x: nextX,
          y: nextY,
          zoom: base.zoom
        });
      };

      [rangeX, rangeY, rangeZoom, rangeFrame].forEach((el) => {
        if (!el) return;
        if (el === rangeFrame) {
          el.addEventListener("input", () => {
            const nextTime = getCurrentEditorVideoTime();
            if (!Number.isFinite(nextTime)) return;
            seekEditorVideoToTime(nextTime);
          });
          return;
        }
        el.addEventListener("input", applyPreview);
      });
      applyEditorAspect(getEditorAspect());
      if (previewImage) {
        previewImage.addEventListener("load", () => {
          const w = Number(previewImage.naturalWidth) || 0;
          const h = Number(previewImage.naturalHeight) || 0;
          if (w > 0 && h > 0) {
            const naturalAspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(rec));
            applyEditorAspect(naturalAspect);
            // Keep render-time crop math in sync with editor math, even before thumb jobs finish.
            if (rec && (rec.type === "image" || previewSrc !== BLACK_POSTER_URL)) {
              rec.previewAspect = naturalAspect;
            }
          }
          applyPreview();
        });
      }
      if (previewVideo) {
        previewVideo.controls = false;
        previewVideo.autoplay = false;
        previewVideo.loop = false;
        previewVideo.muted = true;
        previewVideo.addEventListener("play", () => {
          try { previewVideo.pause(); } catch {}
        });
        previewVideo.addEventListener("loadedmetadata", () => {
          editorVideoDuration = Math.max(0, Number(previewVideo.duration || 0));
          updateEditorVideoFrameRange();
          const w = Number(previewVideo.videoWidth) || 0;
          const h = Number(previewVideo.videoHeight) || 0;
          if (w > 0 && h > 0) {
            const naturalAspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(rec));
            applyEditorAspect(naturalAspect);
            rec.previewAspect = naturalAspect;
          }
          const initial = Number.isFinite(savedVideoFrameTime)
            ? clampEditorVideoTime(savedVideoFrameTime)
            : getDefaultEditorVideoTime();
          seekEditorVideoToTime(initial);
          applyPreview();
        });
        previewVideo.addEventListener("seeked", () => {
          syncEditorVideoTimeToSlider(previewVideo.currentTime || 0);
        });
        previewVideo.addEventListener("loadeddata", () => {
          const w = Number(previewVideo.videoWidth) || 0;
          const h = Number(previewVideo.videoHeight) || 0;
          if (w > 0 && h > 0) {
            const naturalAspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(rec));
            applyEditorAspect(naturalAspect);
            rec.previewAspect = naturalAspect;
          }
          applyPreview();
        });
      }
      applyPreview();

      if (previewWrap) {
        let resizeGesture = null;
        const activePointers = new Map();
        let gesture = null;
        const pointerPosInWrap = (e) => {
          const rect = previewWrap && previewWrap.getBoundingClientRect
            ? previewWrap.getBoundingClientRect()
            : null;
          const left = Number(rect && rect.left) || 0;
          const top = Number(rect && rect.top) || 0;
          return {
            x: (Number(e && e.clientX) || 0) - left,
            y: (Number(e && e.clientY) || 0) - top
          };
        };
        const getFirstTwoPointers = () => {
          const vals = Array.from(activePointers.values());
          if (vals.length < 2) return null;
          return [vals[0], vals[1]];
        };
        const pointerDistance = (a, b) => Math.hypot(Number(a && a.x) - Number(b && b.x), Number(a && a.y) - Number(b && b.y));
        const pointerCenter = (a, b) => ({
          x: (Number(a && a.x) + Number(b && b.x)) * 0.5,
          y: (Number(a && a.y) + Number(b && b.y)) * 0.5
        });
        const refreshGesture = () => {
          if (activePointers.size >= 2) {
            const pair = getFirstTwoPointers();
            if (!pair) return;
            const center = pointerCenter(pair[0], pair[1]);
            gesture = {
              type: "pinch",
              startCrop: getCurrent(),
              startDist: Math.max(0.0001, pointerDistance(pair[0], pair[1])),
              startCenterX: center.x,
              startCenterY: center.y
            };
            previewWrap.classList.add("dragging");
            return;
          }
          if (activePointers.size === 1) {
            const point = Array.from(activePointers.values())[0];
            gesture = {
              type: "pan",
              startCrop: getCurrent(),
              startX: Number(point && point.x) || 0,
              startY: Number(point && point.y) || 0
            };
            previewWrap.classList.add("dragging");
            return;
          }
          gesture = null;
          previewWrap.classList.remove("dragging");
        };
        const onPointerEnd = (e) => {
          if (!activePointers.has(e.pointerId)) return;
          activePointers.delete(e.pointerId);
          try { previewWrap.releasePointerCapture(e.pointerId); } catch {}
          refreshGesture();
        };

        previewWrap.addEventListener("pointerdown", (e) => {
          if (resizeGesture) return;
          if (e.target && e.target.closest && e.target.closest('[data-crop-handle="resize"]')) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          activePointers.set(e.pointerId, { x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 });
          try { previewWrap.setPointerCapture(e.pointerId); } catch {}
          refreshGesture();
          e.preventDefault();
        });
        previewWrap.addEventListener("pointermove", (e) => {
          if (!activePointers.has(e.pointerId)) return;
          activePointers.set(e.pointerId, { x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 });
          if (!gesture) {
            refreshGesture();
            return;
          }
          if (gesture.type === "pinch" && activePointers.size >= 2) {
            const pair = getFirstTwoPointers();
            if (!pair) return;
            const dist = pointerDistance(pair[0], pair[1]);
            const center = pointerCenter(pair[0], pair[1]);
            const scale = Math.max(0.25, Math.min(4, dist / Math.max(0.0001, Number(gesture.startDist) || 1)));
            const nextZoom = Math.min(4, Math.max(1, Number(gesture.startCrop.zoom || 1) * scale));
            const dx = center.x - Number(gesture.startCenterX || 0);
            const dy = center.y - Number(gesture.startCenterY || 0);
            const next = cropFromPanPixels(gesture.startCrop, dx, dy, nextZoom);
            setCurrent(next);
            e.preventDefault();
            return;
          }
          if (gesture.type === "pan" && activePointers.size === 1) {
            const point = Array.from(activePointers.values())[0];
            const dx = (Number(point && point.x) || 0) - Number(gesture.startX || 0);
            const dy = (Number(point && point.y) || 0) - Number(gesture.startY || 0);
            const next = cropFromPanPixels(gesture.startCrop, dx, dy);
            setCurrent(next);
            e.preventDefault();
            return;
          }
          refreshGesture();
        });
        previewWrap.addEventListener("pointerup", onPointerEnd);
        previewWrap.addEventListener("pointercancel", onPointerEnd);
        previewWrap.addEventListener("lostpointercapture", onPointerEnd);
        previewWrap.addEventListener("wheel", (e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          const cur = getCurrent();
          const delta = Number(e.deltaY) || 0;
          if (!delta) return;
          const factor = Math.exp(-delta * 0.0025);
          const nextZoom = Math.min(4, Math.max(1, cur.zoom * factor));
          if (Math.abs(nextZoom - cur.zoom) < 0.0001) return;
          setCurrent({ x: cur.x, y: cur.y, zoom: nextZoom });
          e.preventDefault();
        }, { passive: false });

        if (resizeHandle) {
          const onResizeEnd = (e) => {
            if (!resizeGesture || e.pointerId !== resizeGesture.pointerId) return;
            try { resizeHandle.releasePointerCapture(e.pointerId); } catch {}
            resizeGesture = null;
            previewWrap.classList.remove("resizing");
          };
          resizeHandle.addEventListener("pointerdown", (e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const startCrop = getCurrent();
            const startWin = computeEditorCropWindow(getEditorAspect(), startCrop);
            const anchorU = ((Number(startWin.leftPct) || 0) + ((Number(startWin.widthPct) || 0) * 0.5)) / 100;
            const anchorV = ((Number(startWin.topPct) || 0) + ((Number(startWin.heightPct) || 0) * 0.5)) / 100;
            const wrapSize = getWrapSize();
            const centerPx = {
              x: anchorU * wrapSize.width,
              y: anchorV * wrapSize.height
            };
            const pos = pointerPosInWrap(e);
            const startDist = Math.max(8, Math.hypot(pos.x - centerPx.x, pos.y - centerPx.y));
            resizeGesture = {
              pointerId: e.pointerId,
              startCrop,
              startDist,
              centerPx,
              anchorU,
              anchorV
            };
            try { resizeHandle.setPointerCapture(e.pointerId); } catch {}
            previewWrap.classList.add("resizing");
            e.preventDefault();
            e.stopPropagation();
          });
          resizeHandle.addEventListener("pointermove", (e) => {
            if (!resizeGesture || e.pointerId !== resizeGesture.pointerId) return;
            const pos = pointerPosInWrap(e);
            const dist = Math.max(1, Math.hypot(pos.x - resizeGesture.centerPx.x, pos.y - resizeGesture.centerPx.y));
            const scale = dist / Math.max(1, resizeGesture.startDist);
            const nextZoom = Math.min(4, Math.max(1, Number(resizeGesture.startCrop.zoom || 1) / Math.max(0.2, scale)));
            const next = cropWithZoomAroundAnchor(
              resizeGesture.startCrop,
              nextZoom,
              resizeGesture.anchorU,
              resizeGesture.anchorV
            );
            setCurrent(next);
            e.preventDefault();
            e.stopPropagation();
          });
          resizeHandle.addEventListener("pointerup", onResizeEnd);
          resizeHandle.addEventListener("pointercancel", onResizeEnd);
          resizeHandle.addEventListener("lostpointercapture", onResizeEnd);
        }
      }

      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) closeThumbnailCropEditor();
      });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          closeThumbnailCropEditor();
        }
      });
      if (panel) panel.addEventListener("click", (e) => e.stopPropagation());

      const actionBtns = Array.from(overlay.querySelectorAll("[data-crop-action]"));
      actionBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const action = String(btn.getAttribute("data-crop-action") || "");
          if (action === "cancel") {
            closeThumbnailCropEditor();
            return;
          }
          if (action === "reset") {
            if (rangeX) rangeX.value = "50";
            if (rangeY) rangeY.value = "50";
            if (rangeZoom) rangeZoom.value = "1";
            if (isVideoEditor) {
              seekEditorVideoToTime(getDefaultEditorVideoTime());
            }
            applyPreview();
            return;
          }
          if (action === "save") {
            const nextCrop = getCurrent();
            metaSetFileThumbnailCropForRecord(rec, nextCrop);
            if (isVideoEditor) {
              const selectedFrameTime = getCurrentEditorVideoTime();
              metaSetVideoThumbnailTimeForRecord(rec, selectedFrameTime, editorVideoDuration);
              if (rec.videoThumbUrl) {
                try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
                rec.videoThumbUrl = null;
              }
              rec.videoThumbMode = null;
              enqueueVideoThumb(rec);
            }
            closeThumbnailCropEditor();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage(`Saved thumbnail settings for ${targetLabel}.`);
          }
        });
      });

      requestAnimationFrame(() => {
        try { overlay.focus(); } catch {}
        if (isVideoEditor) {
          try { rangeFrame?.focus(); } catch {}
        } else {
          try { rangeZoom?.focus(); } catch {}
        }
      });
      return true;
    }

    function setTagThumbnailFromRecordByKey(rec, tagKey) {
      const key = String(tagKey || "");
      if (!rec || !key) {
        showStatusMessage("Selected file is unavailable.");
        return false;
      }
      const relPath = normalizeWorkspaceRelPath(rec.relPath || "");
      if (!relPath) {
        showStatusMessage("Selected file is unavailable.");
        return false;
      }
      const changed = metaSetTagThumbnailPresetByKey(key, relPath);
      const tagLabel = tagThumbnailLabelForKey(key);
      if (!changed) {
        showStatusMessage(`Thumbnail already set for '${tagLabel}'.`);
        return false;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage(`Set thumbnail for '${tagLabel}'.`);
      return true;
    }

    function getTagPresetPreviewRecordForEntry(entry, tagPool = null) {
      const key = tagThumbnailKeyForEntry(entry);
      if (!key) return null;
      const relPath = metaGetTagThumbnailPresetRelPathByKey(key);
      if (!relPath) return null;
      const rec = findFileRecordByRelPath(relPath);
      if (!rec || !passesFilter(rec)) return null;
      const dirs = getDirsForTagEntry(entry);
      if (!dirs.length || !isRecordInAnyDirSubtree(rec, dirs)) return null;
      if (Array.isArray(tagPool) && tagPool.length) {
        const idSet = new Set(tagPool.map((r) => String(r && r.id || "")).filter(Boolean));
        if (!idSet.has(String(rec.id || ""))) return null;
      }
      return rec;
    }

    function getRecursivePreviewRecordsForTagEntry(entry, limit = 96) {
      const dirs = getDirsForTagEntry(entry);
      if (!dirs.length) return [];
      return sampleRecursivePreviewRecords(dirs, limit, true);
    }

    function pickRotatingPreviewSlotsForKey(baseKey, records, count = 4) {
      const out = [];
      const k = String(baseKey || "");
      const pool = Array.isArray(records) ? records : [];
      const laneCount = Math.max(1, Number(count) || 1);
      if (!k || !pool.length) return out;
      for (let i = 0; i < laneCount; i++) {
        const laneKey = `${k}:lane:${i + 1}`;
        const rec = pickRotatingPreviewRecordForKey(laneKey, pool);
        out.push({ key: laneKey, rec: rec || null });
      }
      return out;
    }

    function registerRotatingPreviewPool(key, records) {
      const k = String(key || "");
      if (!k) return;
      const idSet = new Set();
      const ids = [];
      for (let i = 0; i < (records || []).length; i++) {
        const id = String(records[i]?.id || "");
        if (!id) continue;
        if (idSet.has(id)) continue;
        idSet.add(id);
        ids.push(id);
      }
      if (!ids.length) {
        ROTATING_PREVIEW_POOLS.delete(k);
        ROTATING_PREVIEW_ORDER.delete(k);
        ROTATING_PREVIEW_INDEX.delete(k);
        ROTATING_PREVIEW_NEXT_AT.delete(k);
        return;
      }
      ROTATING_PREVIEW_POOLS.set(k, ids);
      const existingOrder = ROTATING_PREVIEW_ORDER.get(k) || [];
      const orderValid = existingOrder.length === ids.length && existingOrder.every((id) => idSet.has(id));
      if (!orderValid) {
        ROTATING_PREVIEW_ORDER.set(k, buildWeightedRotationOrder(ids));
        ROTATING_PREVIEW_INDEX.set(k, 0);
      }
      if (!ROTATING_PREVIEW_INDEX.has(k)) {
        ROTATING_PREVIEW_INDEX.set(k, 0);
      }
      if (!ROTATING_PREVIEW_NEXT_AT.has(k)) {
        const initialDelay = ROTATING_PREVIEW_INTERVAL_MS + ((Math.random() * 2 - 1) * ROTATING_PREVIEW_JITTER_MS);
        ROTATING_PREVIEW_NEXT_AT.set(k, Date.now() + Math.max(ROTATING_PREVIEW_POLL_MS, initialDelay));
      }
      ensureRotatingPreviewTicker();
    }

    function pickRotatingPreviewRecordForKey(key, records) {
      const k = String(key || "");
      if (!k || !records || !records.length) return null;
      registerRotatingPreviewPool(k, records);
      const order = ROTATING_PREVIEW_ORDER.get(k) || [];
      if (!order.length) return records[0] || null;
      let idx = Number(ROTATING_PREVIEW_INDEX.get(k));
      if (!Number.isFinite(idx) || idx < 0 || idx >= order.length) idx = 0;
      const rec = WS.fileById.get(order[idx]) || null;
      return rec || records[0] || null;
    }

    function getRootThumbnailReferenceRecord(rootNode) {
      if (!rootNode) return null;
      const rootPool = getRecursivePreviewRecordsForDir(rootNode, 0, true);
      if (!rootPool.length) return null;
      const rootMode = getRootThumbnailMode();
      if (rootMode === "none") return null;
      const presetRec = getRootPresetPreviewRecord(rootNode, rootPool);
      if (presetRec) return presetRec;
      if (naturalAspectThumbnailCardsEnabled()) return null;
      const rootScope = String(WS.meta && WS.meta.storageKey ? WS.meta.storageKey : "workspace");
      if (rootMode === "single" || rootPool.length < 4) {
        const singleKey = `root:${rootScope}:${rootMode === "single" ? "single" : "single-fallback"}`;
        return pickRotatingPreviewRecordForKey(singleKey, rootPool) || null;
      }
      const slots = pickRotatingPreviewSlotsForKey(`root:${rootScope}:quad`, rootPool, 4);
      for (let i = 0; i < slots.length; i++) {
        const rec = slots[i] && slots[i].rec ? slots[i].rec : null;
        if (rec) return rec;
      }
      return null;
    }

    function getTagThumbnailReferenceRecord(entry) {
      if (!entry || entry.kind !== "tag" || entry.placeholder) return null;
      const key = tagThumbnailKeyForEntry(entry);
      if (!key) return null;
      const mode = metaGetTagThumbnailModeByKey(key);
      if (mode === "none") return null;
      const tagPool = getRecursivePreviewRecordsForTagEntry(entry, 0);
      if (!tagPool.length) return null;
      const presetRec = getTagPresetPreviewRecordForEntry(entry, tagPool);
      if (presetRec) return presetRec;
      if (naturalAspectThumbnailCardsEnabled()) return null;

      const tagRotateScope = String(WS.nav && WS.nav.dirNode ? WS.nav.dirNode.path || "" : "");
      const tagRotateKey = entry.special
        ? `tag:${tagRotateScope}:special:${entry.special}`
        : (entry.album && !entry.tag)
          ? `tag:${tagRotateScope}:album:${String(entry.album || "")}`
          : `tag:${tagRotateScope}:name:${String(entry.tag || "")}`;

      if (mode === "single" || tagPool.length < 4) {
        const singleKey = `${tagRotateKey}:${mode === "single" ? "single" : "single-fallback"}`;
        return pickRotatingPreviewRecordForKey(singleKey, tagPool) || null;
      }
      const slots = pickRotatingPreviewSlotsForKey(tagRotateKey, tagPool, 4);
      for (let i = 0; i < slots.length; i++) {
        const rec = slots[i] && slots[i].rec ? slots[i].rec : null;
        if (rec) return rec;
      }
      return null;
    }

    function getSelectedThumbnailSourceRecordFromUi() {
      if (!directoriesListEl || !directoriesListEl.querySelector) return null;
      const selectedRow = directoriesListEl.querySelector(".dirRow.selected");
      if (!selectedRow) return null;
      const img = selectedRow.querySelector(".dirInlinePreview[data-dir-preview-id]");
      if (!img || !img.dataset) return null;
      const recId = String(img.dataset.dirPreviewId || "");
      if (!recId) return null;
      return WS.fileById.get(recId) || null;
    }

    function getSelectedThumbnailSourceRecord() {
      if (!WS.root || !WS.nav || !Array.isArray(WS.nav.entries) || !WS.nav.entries.length) return null;
      const uiRec = getSelectedThumbnailSourceRecordFromUi();
      if (uiRec) return uiRec;
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return null;

      if (entry.kind === "file") {
        return WS.fileById.get(String(entry.id || "")) || null;
      }

      if (entry.kind === "tag") {
        return getTagThumbnailReferenceRecord(entry);
      }

      if (entry.kind === "dir") {
        const node = entry.node || null;
        if (!node) return null;
        if (node === WS.root && WS.view && WS.view.aboveRootView) {
          return getRootThumbnailReferenceRecord(node);
        }
        const leadInfo = getDisplayLeadPreviewForDir(node, "dir");
        return leadInfo && leadInfo.record ? leadInfo.record : null;
      }

      return null;
    }

    const THUMB_VIEWPORT_NUDGE_STEP = 8;

    function nudgeSelectedThumbnailViewport(dx, dy, opts = null) {
      const options = (opts && typeof opts === "object") ? opts : {};
      const quietNoTarget = !!options.quietNoTarget;
      const quietAtEdge = !!options.quietAtEdge;
      const quietSuccess = !!options.quietSuccess;
      const skipAspectResolve = !!options.skipAspectResolve;
      const rec = getSelectedThumbnailSourceRecord();
      if (!rec) {
        if (!quietNoTarget) showStatusMessage("Selected item has no editable thumbnail source.");
        return false;
      }
      const stepX = Number(dx) || 0;
      const stepY = Number(dy) || 0;
      if (!stepX && !stepY) return false;
      if (!skipAspectResolve && !hasKnownPreviewAspect(rec)) {
        const pendingKey = String(rec.id || rec.relPath || "");
        const canQueue = pendingKey && !THUMB_ASPECT_RESOLVE_PENDING.has(pendingKey);
        if (canQueue) {
          THUMB_ASPECT_RESOLVE_PENDING.add(pendingKey);
          detectRecordPreviewAspect(rec).then((detected) => {
            if (!detected) return;
            rec.previewAspect = normalizePreviewAspect(detected, 4 / 3);
            nudgeSelectedThumbnailViewport(stepX, stepY, Object.assign({}, options, {
              skipAspectResolve: true,
              quietNoTarget: true
            }));
          }).finally(() => {
            THUMB_ASPECT_RESOLVE_PENDING.delete(pendingKey);
          });
        }
        if (!quietSuccess) showStatusMessage("Preparing thumbnail framing...");
        return true;
      }
      const current = normalizeThumbCropValue(metaGetFileThumbnailCropForRecord(rec) || { x: 50, y: 50, zoom: 1 });
      const aspect = getPreviewAspectForRecord(rec);
      const movementWindow = computeEditorCropWindow(aspect, current);
      const rangeX = Math.max(0, Number(movementWindow && movementWindow.rangeXPct) || 0);
      const rangeY = Math.max(0, Number(movementWindow && movementWindow.rangeYPct) || 0);
      const wantsX = !!stepX;
      const wantsY = !!stepY;
      const canMoveX = rangeX > 0.0001;
      const canMoveY = rangeY > 0.0001;
      if (wantsX && !canMoveX) {
        if (!quietAtEdge) showStatusMessage("No horizontal movement available at current zoom.");
        return false;
      }
      if (wantsY && !canMoveY) {
        if (!quietAtEdge) showStatusMessage("No vertical movement available at current zoom.");
        return false;
      }
      const next = normalizeThumbCropValue({
        x: current.x + stepX,
        y: current.y + stepY,
        zoom: current.zoom
      });
      if (next.x === current.x && next.y === current.y) {
        if (!quietAtEdge) showStatusMessage("Thumbnail viewport already at edge.");
        return false;
      }
      metaSetFileThumbnailCropForRecord(rec, next);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();

      const direction = stepX < 0
        ? "left"
        : (stepX > 0 ? "right" : (stepY < 0 ? "up" : "down"));
      if (!quietSuccess) showStatusMessage(`Thumbnail viewport moved ${direction}.`);
      return true;
    }

    function applyPreviewRecordToImageElement(imgEl, rec) {
      if (!imgEl || !rec) return false;
      const previewId = String(rec.id || "");
      const previewSrc = rec.type === "video"
        ? getVideoPosterForRecord(rec)
        : (ensureThumbUrl(rec) || "");
      if (rec.type === "video" && !rec.videoThumbUrl) enqueueVideoThumb(rec);
      if (!previewSrc) return false;
      if (imgEl.src !== previewSrc) imgEl.src = previewSrc;
      imgEl.setAttribute("data-dir-preview-id", previewId);
      const previewAspect = getPreviewAspectForRecord(rec);
      applyDirectoryInlineAspect(imgEl, previewAspect);
      if (rec.type === "image" && !syncDirectoryInlineAspectFromNaturalSize(imgEl, rec)) {
        if (imgEl.dataset.dirAspectPending !== "1") {
          imgEl.dataset.dirAspectPending = "1";
          imgEl.addEventListener("load", () => {
            delete imgEl.dataset.dirAspectPending;
            syncDirectoryInlineAspectFromNaturalSize(imgEl, rec);
          }, { once: true });
        }
      }
      const fitCard = imgEl.closest(".fitInsideCard");
      if (fitCard) {
        fitCard.dataset.aspect = String(previewAspect);
      }
      return true;
    }

    function crossfadePreviewRecordOnImageElement(imgEl, rec) {
      if (!imgEl || !rec) return;
      const busyUntil = Number(imgEl.dataset.rotateBusyUntil || "0");
      const now = Date.now();
      if (Number.isFinite(busyUntil) && busyUntil > now) return;
      const until = now + ROTATING_PREVIEW_FADE_MS + 80;
      imgEl.dataset.rotateBusyUntil = String(until);
      imgEl.classList.add("rotatingThumbFade");
      setTimeout(() => {
        applyPreviewRecordToImageElement(imgEl, rec);
        requestAnimationFrame(() => {
          imgEl.classList.remove("rotatingThumbFade");
        });
      }, Math.round(ROTATING_PREVIEW_FADE_MS * 0.55));
    }

    function rotatePreviewThumbnailsTick() {
      const imgs = document ? document.querySelectorAll("img[data-rotate-key]") : [];
      if (!imgs || !imgs.length) return;
      const groups = new Map();
      imgs.forEach((imgEl) => {
        const key = String(imgEl.dataset.rotateKey || "");
        if (!key) return;
        const list = groups.get(key) || [];
        list.push(imgEl);
        groups.set(key, list);
      });
      if (!groups.size) return;
      const now = Date.now();
      for (const [key, list] of groups.entries()) {
        const ids = ROTATING_PREVIEW_POOLS.get(key) || [];
        if (!ids.length) continue;
        let order = ROTATING_PREVIEW_ORDER.get(key) || [];
        if (order.length !== ids.length) {
          order = buildWeightedRotationOrder(ids);
          ROTATING_PREVIEW_ORDER.set(key, order);
          ROTATING_PREVIEW_INDEX.set(key, 0);
        }
        const nextAt = Number(ROTATING_PREVIEW_NEXT_AT.get(key) || 0);
        if (nextAt > now) continue;
        let nextIndex = Number(ROTATING_PREVIEW_INDEX.get(key));
        if (!Number.isFinite(nextIndex) || nextIndex < 0 || nextIndex >= order.length) nextIndex = 0;
        nextIndex += 1;
        if (nextIndex >= order.length) {
          order = buildWeightedRotationOrder(ids);
          ROTATING_PREVIEW_ORDER.set(key, order);
          nextIndex = 0;
        }
        ROTATING_PREVIEW_INDEX.set(key, nextIndex);
        const rec = WS.fileById.get(order[nextIndex]) || null;
        if (!rec) continue;
        list.forEach((imgEl) => crossfadePreviewRecordOnImageElement(imgEl, rec));
        let nextDelay = ROTATING_PREVIEW_INTERVAL_MS + ((Math.random() * 2 - 1) * ROTATING_PREVIEW_JITTER_MS);
        const minDelay = Math.max(3000, Math.floor(ROTATING_PREVIEW_INTERVAL_MS * 0.2));
        if (!Number.isFinite(nextDelay) || nextDelay < minDelay) nextDelay = minDelay;
        ROTATING_PREVIEW_NEXT_AT.set(key, now + nextDelay);
        const grid = list[0] ? list[0].closest(".fitInsideJustified") : null;
        if (grid) requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
      }
      for (const key of Array.from(ROTATING_PREVIEW_POOLS.keys())) {
        if (!groups.has(key)) {
          ROTATING_PREVIEW_ORDER.delete(key);
          ROTATING_PREVIEW_INDEX.delete(key);
          ROTATING_PREVIEW_NEXT_AT.delete(key);
        }
      }
    }

    function ensureRotatingPreviewTicker() {
      if (ROTATING_PREVIEW_TIMER) return;
      ROTATING_PREVIEW_TIMER = setInterval(rotatePreviewThumbnailsTick, ROTATING_PREVIEW_POLL_MS);
    }

    function makeTagPreviewNode(entry) {
      const baseNode = WS.nav.dirNode;
      if (!entry || !baseNode) return null;
      const dirs = getDirsForTagEntry(entry);
      const label = String(entry.label || entry.tag || entry.special || "Tag");
      const pathSuffix = entry.special
        ? entry.special
        : (entry.album && !entry.tag)
          ? `album-${String(entry.album || "")}`
          : (entry.tag || "tag");
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

    function findTagEntryIndex(mode, tag, album = "") {
      const albumKey = normalizeTagAlbumName(album);
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "tag") continue;
        if (mode && entry.special && entry.special === mode) return i;
        if (mode === "album" && entry.album && !entry.tag && normalizeTagAlbumName(entry.album) === albumKey) return i;
        if (mode === "tag" && entry.tag && entry.tag === tag) {
          const entryAlbum = normalizeTagAlbumName(entry.album || "");
          if (albumKey && entryAlbum !== albumKey) continue;
          return i;
        }
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
      WS.view.tagFolderActiveAlbum = "";
      WS.view.tagFolderOriginPath = "";
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findTagEntryIndex(ctx.mode, ctx.tag, ctx.album);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      return true;
    }

    function setTagFolderViewState(mode, tag, originPath, album = "") {
      WS.view.tagFolderActiveMode = mode;
      WS.view.tagFolderActiveTag = tag;
      WS.view.tagFolderActiveAlbum = String(album || "");
      WS.view.tagFolderOriginPath = String(originPath || "");
      closeActionMenus();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
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

    function restoreDirectoriesScrollWithSelectionReveal(value) {
      setDirectoriesScrollTop(Number(value) || 0);
      if (!directoriesListEl) return;
      if (isGridInteractionMode()) {
        revealSelectedDirectoryRowInGridMode(false);
        return;
      }
      const vis = getSelectedDirectoryRowVisibility();
      if (vis.state === "offscreen") {
        centerSelectedDirectoryRow(0);
      } else if (vis.state === "partial") {
        snapSelectedDirectoryRowFullyIntoView();
      }
    }

    function ensureTagNavStack() {
      if (!Array.isArray(WS.view.tagNavStack)) WS.view.tagNavStack = [];
      return WS.view.tagNavStack;
    }

    function isSameOrDescendantPath(path, ancestorPath) {
      const pathNorm = String(path || "");
      const ancestorNorm = String(ancestorPath || "");
      if (!pathNorm || !ancestorNorm) return pathNorm === ancestorNorm;
      return pathNorm === ancestorNorm || pathNorm.startsWith(`${ancestorNorm}/`);
    }

    function clearTagNavigationStack() {
      WS.view.tagNavStack = [];
    }

    // Portal navigation is intentionally centralized here.
    // This area has had long-running regressions where "leave directory" from a folder entered via
    // a virtual folder (especially Favorites/Tags) incorrectly dropped users into the real tree root.
    // Keep all virtual-folder matching/restore decisions in this guard so future virtual folder types
    // can reuse the exact same behavior without duplicating fragile path logic.
    function findMatchingVirtualPortalRootPath(frame, path) {
      const currentPath = String(path || "");
      if (!frame || !currentPath) return "";
      const frameType = String(frame.type || "");
      if (frameType !== "tag-view") return "";
      const selectedRoot = String(frame.selectedDirPath || "");
      if (selectedRoot && isSameOrDescendantPath(currentPath, selectedRoot)) return selectedRoot;
      const ordered = Array.isArray(frame.orderedPaths) ? frame.orderedPaths : [];
      for (let i = 0; i < ordered.length; i++) {
        const candidate = String(ordered[i] || "");
        if (!candidate) continue;
        if (isSameOrDescendantPath(currentPath, candidate)) return candidate;
      }
      return "";
    }

    function isVirtualPortalViewFrame(frame) {
      const frameType = String(frame && frame.type || "");
      return frameType.endsWith("-view");
    }

    function pruneStaleTagEntryFramesForPath(path) {
      const stack = ensureTagNavStack();
      const currentPath = String(path || "");
      let changed = false;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (!top || top.type !== "tag-entry") break;
        const entryDir = String(top.dirPath || "");
        if (entryDir === currentPath) break;
        stack.pop();
        changed = true;
      }
      return changed;
    }

    function pruneStaleVirtualPortalFramesForPath(path) {
      const stack = ensureTagNavStack();
      const currentPath = String(path || "");
      let changed = false;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (!top || !isVirtualPortalViewFrame(top)) break;
        if (!currentPath) break;
        if (findMatchingVirtualPortalRootPath(top, currentPath)) break;
        stack.pop();
        changed = true;
      }
      return changed;
    }

    function pushTagNavFrame(frame) {
      if (!frame) return;
      ensureTagNavStack().push(frame);
    }

    function pushTagEntryContext(mode, tag, album = "") {
      pushTagNavFrame({
        type: "tag-entry",
        dirPath: String(WS.nav.dirNode?.path || ""),
        entryMode: mode || "",
        entryTag: tag || "",
        entryAlbum: String(album || ""),
        prevMode: String(WS.view.tagFolderActiveMode || ""),
        prevTag: String(WS.view.tagFolderActiveTag || ""),
        prevAlbum: String(WS.view.tagFolderActiveAlbum || ""),
        prevOriginPath: String(WS.view.tagFolderOriginPath || ""),
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
        album: WS.view.tagFolderActiveAlbum,
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
      setTagFolderViewState(frame.mode || "", frame.tag || "", frame.originPath, frame.album || "");
      const idx = frame.selectedDirPath ? findDirEntryIndexByPath(frame.selectedDirPath) : -1;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      restoreDirectoriesScrollWithSelectionReveal(frame.scrollTop);
      return true;
    }

    function restoreDirectoriesFromTagEntryFrame(frame) {
      if (!frame) return false;
      const baseNode = WS.dirByPath.get(String(frame.dirPath || "")) || WS.root;
      if (!baseNode) return false;
      WS.nav.dirNode = baseNode;
      WS.view.tagFolderActiveMode = String(frame.prevMode || "");
      WS.view.tagFolderActiveTag = String(frame.prevTag || "");
      WS.view.tagFolderActiveAlbum = String(frame.prevAlbum || "");
      WS.view.tagFolderOriginPath = String(frame.prevOriginPath || "");
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findTagEntryIndex(frame.entryMode, frame.entryTag, frame.entryAlbum);
      const targetIndex = idx >= 0 ? idx : (typeof frame.selectedIndex === "number" ? frame.selectedIndex : 0);
      WS.nav.selectedIndex = findNearestSelectableIndex(targetIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      restoreDirectoriesScrollWithSelectionReveal(frame.scrollTop);
      return true;
    }

    function tryRestoreTagDirectoryContext() {
      // Critical behavior:
      // If a user enters from a tag/favorites virtual folder, then traverses inside matching folders,
      // "leave directory" must return to the same virtual folder view (portal) instead of dropping to
      // the real parent/root. This was a long-standing edge-case bug in favorites-root navigation.
      pruneStaleVirtualPortalFramesForPath(WS.nav.dirNode?.path || "");
      const stack = WS.view.tagNavStack;
      if (!Array.isArray(stack) || !stack.length) return false;
      const frame = stack[stack.length - 1];
      if (frame.type !== "tag-view") return false;
      const curPath = String(WS.nav.dirNode?.path || "");
      const portalRootPath = findMatchingVirtualPortalRootPath(frame, curPath);
      if (!portalRootPath) return false;
      if (curPath !== portalRootPath) return false;
      stack.pop();
      return restoreTagViewFromFrame(Object.assign({}, frame, {
        selectedDirPath: portalRootPath
      }));
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
        album: WS.view.tagFolderActiveAlbum,
        originPath: WS.view.tagFolderOriginPath
      };
      if (!restoreTagFolderEntrySelection(ctx)) {
        setTagFolderViewState("", "", "", "");
      }
    }

    function openTagFolderEntry(entry) {
      if (!entry) return;
      if (entry.placeholder) return;
      // Keep nested tag/favorites portal history. We only drop frames that are no longer relevant to
      // the current real directory path; this avoids the old bug where entering a child tag folder
      // replaced outer portal context and caused bad exits back to the real tree.
      pruneStaleVirtualPortalFramesForPath(WS.nav.dirNode?.path || "");
      pruneStaleTagEntryFramesForPath(WS.nav.dirNode?.path || "");
      const album = String(entry.album || "");
      const isAlbumEntry = !!album && !entry.tag && !entry.special;
      const mode = entry.special ? entry.special : (isAlbumEntry ? "album" : "tag");
      const tag = (mode === "tag") ? (entry.tag || "") : "";
      pushTagEntryContext(mode, tag, album);
      const originPath = String(WS.nav.dirNode?.path || "");
      setTagFolderViewState(mode, tag, originPath, album);
    }

    function getChildDirsForNode(dirNode) {
      return getChildDirsForNodeBase(dirNode);
    }

    function getVisibleSiblingDirsForSlide(dirNode) {
      const dp = String(dirNode?.path || "");
      pruneStaleVirtualPortalFramesForPath(dp);
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

        const name = dirDisplayName(node || null).toLowerCase();
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

    function shouldIncludeGridUpDirectoryEntry() {
      if (!isGridInteractionMode()) return false;
      if (!WS.root || !WS.nav.dirNode) return false;
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      if (opt && opt.showGridUpDirectoryEntry === false) return false;
      if (WS.view.aboveRootView) return false;
      if (isViewingTagFolder()) return true;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
      return WS.nav.dirNode !== WS.root;
    }

    function buildGridUpDirectoryEntry() {
      let parentLabel = "parent folder";
      if (isViewingTagFolder()) {
        const originPath = String(WS.view.tagFolderOriginPath || "");
        const originNode = WS.dirByPath.get(originPath) || WS.root;
        if (originNode) parentLabel = dirDisplayName(originNode);
      } else if (WS.nav.dirNode && WS.nav.dirNode.parent) {
        parentLabel = dirDisplayName(WS.nav.dirNode.parent);
      }
      return {
        kind: "up",
        label: "Up Directory",
        icon: "↩",
        parentLabel
      };
    }

    function selectionIndexForDirectoryEnter() {
      if (isGridInteractionMode()) return findNearestSelectableIndex(0, 1);
      return restoreGridSelectionForCurrentContext(0);
    }

    function rebuildDirectoriesEntries() {
      invalidateDirMetricsCaches();
      WS.nav.entries = [];

      if (!WS.root) return;
      if (WS.view.aboveRootView && !showRootViewEnabled()) {
        WS.view.aboveRootView = false;
      }
      const includeGridUpEntry = shouldIncludeGridUpDirectoryEntry();
      if (WS.view.aboveRootView && WS.nav.dirNode === WS.root) {
        WS.nav.entries.push({ kind: "dir", node: WS.root });
        return;
      }

      if (isViewingTagFolder()) {
        if (includeGridUpEntry) WS.nav.entries.push(buildGridUpDirectoryEntry());
        const placeholderEntry = buildBulkTagPlaceholderEntry();
        if (placeholderEntry) WS.nav.entries.push(placeholderEntry);
        const virtualTagEntries = getTagEntriesForTagFolderView();
        for (let i = 0; i < virtualTagEntries.length; i++) WS.nav.entries.push(virtualTagEntries[i]);
        if (virtualTagEntries.length) return;
        const nodes = getDirsForTagFolderView();
        for (const d of nodes) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        if (includeGridUpEntry) WS.nav.entries.push(buildGridUpDirectoryEntry());
        const placeholderEntry = buildBulkTagPlaceholderEntry();
        if (placeholderEntry) WS.nav.entries.push(placeholderEntry);
        const dirs = (WS.view.searchResults || []).slice();
        for (let i = 0; i < dirs.length; i++) WS.nav.entries.push({ kind: "dir", node: dirs[i] });
        return;
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        if (includeGridUpEntry) WS.nav.entries.push(buildGridUpDirectoryEntry());
        const placeholderEntry = buildBulkTagPlaceholderEntry();
        if (placeholderEntry) WS.nav.entries.push(placeholderEntry);
        const dirs = getAllFavoriteDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        if (includeGridUpEntry) WS.nav.entries.push(buildGridUpDirectoryEntry());
        const placeholderEntry = buildBulkTagPlaceholderEntry();
        if (placeholderEntry) WS.nav.entries.push(placeholderEntry);
        const dirs = getAllHiddenDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      const dirNode = WS.nav.dirNode;
      if (!dirNode) return;

      if (includeGridUpEntry) WS.nav.entries.push(buildGridUpDirectoryEntry());

      const tagEntries = getTagFolderEntries();
      if (tagEntries.length) {
        for (const entry of tagEntries) WS.nav.entries.push(entry);
      }

      const dirs = getChildDirsForNode(dirNode);
      for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });

      const baseFiles = getOrderedFileIdsForDir(dirNode);
      for (const id of baseFiles) WS.nav.entries.push({ kind: "file", id });
    }

    function isSelectableEntry(entry) {
      return entry && (entry.kind === "dir" || entry.kind === "file" || entry.kind === "tag" || entry.kind === "up");
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

    // USER NOTE (DO NOT CASUALLY CHANGE):
    // This shared centering routine is the stable path for both folder and file selection scroll behavior.
    // Regressions here have repeatedly caused major frustration ("super pissed off"). If modified, manually
    // test keyboard selection in folder lists and file-only folders before shipping.
    function updateGridModeListTopInset() {
      if (!directoriesListEl) return;
      const appEl = $("app");
      const titlePaneEl = $("titlePane");
      if (appEl) {
        if (isGridInteractionMode() && titlePaneEl && titlePaneEl.getBoundingClientRect) {
          const titleH = Math.max(0, Math.ceil(titlePaneEl.getBoundingClientRect().height || 0));
          appEl.style.setProperty("--grid-title-h", `${titleH}px`);
        } else {
          appEl.style.removeProperty("--grid-title-h");
        }
      }
    }

    function getDirectoryViewportRange(container) {
      const view = container || directoriesListEl;
      if (!view) {
        return {
          topInset: 0,
          viewTop: 0,
          viewBottom: 0,
          viewHeight: 0
        };
      }

      const topInset = 0;

      const viewTop = (view.scrollTop || 0) + topInset;
      const viewHeight = Math.max(1, (view.clientHeight || 1) - topInset);
      return {
        topInset,
        viewTop,
        viewBottom: viewTop + viewHeight,
        viewHeight
      };
    }

    function isGridTopRowSelection(container, selectedRow) {
      if (!container || !selectedRow || !container.classList || !container.classList.contains("gridModeList")) return false;
      const rows = container.querySelectorAll(".dirRow");
      if (!rows || !rows.length) return false;
      let minTop = Number.POSITIVE_INFINITY;
      for (let i = 0; i < rows.length; i++) {
        const t = Number(rows[i].offsetTop) || 0;
        if (t < minTop) minTop = t;
      }
      if (!Number.isFinite(minTop)) return false;
      const selectedTop = Number(selectedRow.offsetTop) || 0;
      return selectedTop <= (minTop + 2);
    }

    function centerSelectedDirectoryRow(deferFrames = 0, lockRowCenterOffset = null) {
      const schedule = (frames) => {
        if (frames <= 0) {
          const container = directoriesListEl;
          const selectedRow = container ? container.querySelector(".dirRow.selected") : null;
          if (!container || !selectedRow) return;
          const rowMid = selectedRow.offsetTop + (selectedRow.offsetHeight * 0.5);
          const viewport = getDirectoryViewportRange(container);
          const desiredMid = Number.isFinite(lockRowCenterOffset)
            ? Number(lockRowCenterOffset)
            : (viewport.topInset + (viewport.viewHeight * 0.5));
          const target = rowMid - desiredMid;
          const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
          WS.view.scrollBusyDirs = true;
          container.scrollTop = Math.max(0, Math.min(maxScroll, target));
          requestAnimationFrame(() => { WS.view.scrollBusyDirs = false; });
          return;
        }
        requestAnimationFrame(() => schedule(frames - 1));
      };
      schedule(Math.max(0, deferFrames | 0));
    }

    function getSelectedDirectoryRowVisibility() {
      const container = directoriesListEl;
      const selectedRow = container ? container.querySelector(".dirRow.selected") : null;
      if (!container || !selectedRow) return { state: "missing", container: null, row: null };
      const viewport = getDirectoryViewportRange(container);
      const viewTop = viewport.viewTop;
      const viewBottom = viewport.viewBottom;
      const rowTop = selectedRow.offsetTop;
      const rowBottom = rowTop + selectedRow.offsetHeight;
      if (rowBottom <= viewTop || rowTop >= viewBottom) {
        return { state: "offscreen", container, row: selectedRow, rowTop, rowBottom, viewTop, viewBottom };
      }
      if (rowTop < viewTop || rowBottom > viewBottom) {
        return { state: "partial", container, row: selectedRow, rowTop, rowBottom, viewTop, viewBottom };
      }
      return { state: "visible", container, row: selectedRow, rowTop, rowBottom, viewTop, viewBottom };
    }

    function snapSelectedDirectoryRowFullyIntoView() {
      const vis = getSelectedDirectoryRowVisibility();
      if (vis.state !== "partial" || !vis.container) return;
      const { container, row, rowTop, rowBottom, viewTop, viewBottom } = vis;
      const viewport = getDirectoryViewportRange(container);
      const rowHeight = Math.max(0, rowBottom - rowTop);
      let target = container.scrollTop;
      if (isGridTopRowSelection(container, row)) {
        target = 0;
      } else if (rowHeight >= viewport.viewHeight) {
        target = rowTop - viewport.topInset;
      } else if (rowTop < viewTop) {
        target = rowTop - viewport.topInset;
      } else if (rowBottom > viewBottom) {
        target = rowBottom - container.clientHeight;
      }
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      const nextScroll = Math.max(0, Math.min(maxScroll, target));
      WS.view.scrollBusyDirs = true;
      container.scrollTop = nextScroll;
      requestAnimationFrame(() => { WS.view.scrollBusyDirs = false; });
    }

    function revealSelectedDirectoryRowInGridMode(center = false) {
      if (!directoriesListEl) return;
      const selectedRow = directoriesListEl.querySelector(".dirRow.selected");
      if (!selectedRow) return;
      WS.view.scrollBusyDirs = true;
      const container = directoriesListEl;
      const viewport = getDirectoryViewportRange(container);
      const rowTop = selectedRow.offsetTop;
      const rowBottom = rowTop + selectedRow.offsetHeight;
      const rowLeft = selectedRow.offsetLeft;
      const rowRight = rowLeft + selectedRow.offsetWidth;

      const viewTop = viewport.viewTop;
      const viewBottom = viewport.viewBottom;
      const viewLeft = container.scrollLeft;
      const viewRight = viewLeft + container.clientWidth;

      let nextTop = viewTop;
      let nextLeft = viewLeft;

      if (center) {
        const rowMid = rowTop + (selectedRow.offsetHeight * 0.5);
        nextTop = rowMid - (viewport.topInset + (viewport.viewHeight * 0.5));
      } else {
        if (isGridTopRowSelection(container, selectedRow)) {
          nextTop = 0;
        } else if (rowTop < viewTop) nextTop = rowTop - viewport.topInset;
        else if (rowBottom > viewBottom) nextTop = rowBottom - container.clientHeight;
      }

      if (rowLeft < viewLeft) nextLeft = rowLeft;
      else if (rowRight > viewRight) nextLeft = rowRight - container.clientWidth;

      const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
      const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
      container.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
      container.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
      requestAnimationFrame(() => { WS.view.scrollBusyDirs = false; });
    }

    function canUseFastGridSelectionUpdate() {
      if (!isGridInteractionMode()) return false;
      if (!directoriesListEl || !directoriesListEl.classList.contains("gridModeList")) return false;
      if (WS.view.bulkActionMenuOpen || WS.view.dirActionMenuPath || WS.view.fileActionMenuId) return false;
      if (TAG_EDIT_PATH || RENAME_EDIT_PATH || RENAME_EDIT_FILE_ID || TAG_ENTRY_RENAME_STATE) return false;
      if (WS.view.bulkSelectMode) return false;
      if (directoriesActionMenuEl && directoriesActionMenuEl.classList.contains("open")) return false;
      if (directoriesListEl.querySelector(".dropdownMenu.open")) return false;
      if (directoriesListEl.querySelector(".dirRow.bulkSelected")) return false;
      return true;
    }

    function fastUpdateGridSelectedRow(prevIdx, nextIdx) {
      if (!directoriesListEl) return false;
      const nextRow = directoriesListEl.querySelector(`.dirRow[data-entry-index="${String(nextIdx)}"]`);
      if (!nextRow) return false;
      const prevRow = directoriesListEl.querySelector(`.dirRow[data-entry-index="${String(prevIdx)}"]`);
      if (prevRow) prevRow.classList.remove("selected");
      nextRow.classList.add("selected");
      return true;
    }

    function canUseFastPaneSelectionUpdate(hadTransientUi) {
      if (isGridInteractionMode()) return false;
      if (!directoriesListEl || directoriesListEl.classList.contains("gridModeList")) return false;
      if (hadTransientUi) return false;
      if (WS.view.bulkSelectMode) return false;
      return true;
    }

    function fastUpdatePaneSelectedRow(prevIdx, nextIdx) {
      if (!directoriesListEl) return false;
      const nextRow = directoriesListEl.querySelector(`.dirRow[data-entry-index="${String(nextIdx)}"]`);
      if (!nextRow) return false;
      const prevRow = directoriesListEl.querySelector(`.dirRow[data-entry-index="${String(prevIdx)}"]`);
      if (prevRow) prevRow.classList.remove("selected");
      nextRow.classList.add("selected");
      return true;
    }

    let PREVIEW_SELECTION_RENDER_RAF = 0;
    function schedulePreviewRenderForSelection() {
      if (PREVIEW_SELECTION_RENDER_RAF) {
        try { cancelAnimationFrame(PREVIEW_SELECTION_RENDER_RAF); } catch {}
        PREVIEW_SELECTION_RENDER_RAF = 0;
      }
      PREVIEW_SELECTION_RENDER_RAF = requestAnimationFrame(() => {
        PREVIEW_SELECTION_RENDER_RAF = 0;
        renderPreviewPane(false);
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      });
    }

    function reconcileSelectedDirectoryRowVisibility(preferCenter = false, forceCenter = false) {
      if (forceCenter) {
        centerSelectedDirectoryRow(0);
        return;
      }
      const vis = getSelectedDirectoryRowVisibility();
      if (vis.state === "offscreen") {
        centerSelectedDirectoryRow(0);
        return;
      }
      if (vis.state === "partial") {
        if (preferCenter) centerSelectedDirectoryRow(0);
        else snapSelectedDirectoryRowFullyIntoView();
      }
    }

    let DIR_SELECTION_RECONCILE_RAF = 0;
    let DIR_SELECTION_RECONCILE_TIMER = 0;
    function scheduleSelectedDirectoryRowReconcile(delayedMs = 0, preferCenter = false, forceCenter = false) {
      if (DIR_SELECTION_RECONCILE_RAF) {
        try { cancelAnimationFrame(DIR_SELECTION_RECONCILE_RAF); } catch {}
        DIR_SELECTION_RECONCILE_RAF = 0;
      }
      if (DIR_SELECTION_RECONCILE_TIMER) {
        try { clearTimeout(DIR_SELECTION_RECONCILE_TIMER); } catch {}
        DIR_SELECTION_RECONCILE_TIMER = 0;
      }
      DIR_SELECTION_RECONCILE_RAF = requestAnimationFrame(() => {
        DIR_SELECTION_RECONCILE_RAF = 0;
        reconcileSelectedDirectoryRowVisibility(preferCenter, forceCenter);
      });
      if (delayedMs > 0) {
        DIR_SELECTION_RECONCILE_TIMER = setTimeout(() => {
          DIR_SELECTION_RECONCILE_TIMER = 0;
          reconcileSelectedDirectoryRowVisibility(preferCenter, forceCenter);
        }, delayedMs);
      }
    }

    function setDirectoriesSelection(idx, opts = null) {
      const keepScroll = !!(opts && opts.keepScroll);
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
      const hadTransientUi = !!(
        WS.view.bulkActionMenuOpen ||
        WS.view.dirActionMenuPath ||
        WS.view.fileActionMenuId ||
        TAG_EDIT_PATH ||
        RENAME_EDIT_PATH ||
        RENAME_EDIT_FILE_ID ||
        TAG_ENTRY_RENAME_STATE
      );
      closeActionMenus();
      const prevIdx = WS.nav.selectedIndex;
      const i = findNearestSelectableIndex(idx, idx >= WS.nav.selectedIndex ? 1 : -1);
      WS.nav.selectedIndex = i;
      saveGridSelectionForCurrentContext();
      syncPreviewToSelection();

      if (canUseFastGridSelectionUpdate() && fastUpdateGridSelectedRow(prevIdx, i)) {
        const shouldCenter = WS.view.pendingDirScroll === "center-selected";
        const shouldGridReveal = WS.view.pendingDirScroll === "grid-nearest";
        if (shouldCenter || shouldGridReveal) WS.view.pendingDirScroll = "";
        if (shouldCenter) revealSelectedDirectoryRowInGridMode(true);
        else if (shouldGridReveal) revealSelectedDirectoryRowInGridMode(false);
        else scheduleSelectedDirectoryRowReconcile(0, false, false);
        syncButtons();
        return;
      }

      if (canUseFastPaneSelectionUpdate(hadTransientUi) && fastUpdatePaneSelectedRow(prevIdx, i)) {
        const shouldCenter = WS.view.pendingDirScroll === "center-selected";
        if (shouldCenter) WS.view.pendingDirScroll = "";
        if (shouldCenter) centerSelectedDirectoryRow(0);
        else scheduleSelectedDirectoryRowReconcile(0, false, false);
        schedulePreviewRenderForSelection();
        syncButtons();
        return;
      }

      renderDirectoriesPane(keepScroll);
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
      } else if (entry.kind === "up") {
        WS.preview.kind = null;
        WS.preview.dirNode = null;
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

    function entryUsesRotatingThumbnail(entry) {
      if (!entry) return false;
      if (entry.kind === "tag") {
        const key = tagThumbnailKeyForEntry(entry);
        const mode = metaGetTagThumbnailModeByKey(key);
        if (mode === "none") return false;
        if (mode === "single" && metaHasTagThumbnailPresetByKey(key)) return false;
        return getRecursivePreviewRecordsForTagEntry(entry, 1).length > 0;
      }
      if (entry.kind === "dir" && entry.node) {
        const p = String(entry.node.path || "");
        if (metaGetFolderThumbnailMode(p) !== "rotate") return false;
        if (getFirstDirectPreviewRecordForDir(entry.node)) return false;
        return getRecursivePreviewRecordsForDir(entry.node, 1, false).length > 0;
      }
      return false;
    }

    function focusDirectoriesOnFileRecord(rec) {
      if (!rec || !WS.root) return false;
      const p = String(rec.dirPath || "");
      const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root;
      if (!dn) return false;

      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();

      if (isViewingTagFolder()) {
        pushTagViewContext(dn.path || "");
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderActiveAlbum = "";
        WS.view.tagFolderOriginPath = "";
      }

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
      WS.view.aboveRootView = false;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();

      let idx = -1;
      const targetId = String(rec.id || "");
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const e = WS.nav.entries[i];
        if (e && e.kind === "file" && String(e.id || "") === targetId) { idx = i; break; }
      }
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : 0, 1);
      syncPreviewToSelection();
      WS.view.pendingDirScroll = "center-selected";
      renderDirectoriesPane(false);
      renderPreviewPane(true, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      recordDirHistory();
      return true;
    }

    function teleportFromRotatingThumbnail(entry, rowEl = null) {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      if (!opt || !opt.clickSelectedRotatingThumbTeleports) return false;
      if (!entryUsesRotatingThumbnail(entry)) return false;
      const row = rowEl || (directoriesListEl ? directoriesListEl.querySelector(".dirRow.selected") : null);
      const img = row && row.querySelector ? row.querySelector("img.dirInlinePreview[data-dir-preview-id]") : null;
      const id = String(img?.getAttribute("data-dir-preview-id") || "");
      if (!id) return false;
      const rec = WS.fileById.get(id);
      if (!rec) return false;
      return focusDirectoriesOnFileRecord(rec);
    }

    function firstFileIdForDirectFolderGalleryEntry(dirNode) {
      if (!dirNode) return "";
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      if (!opt || !opt.fileOnlyFoldersOpenInGallery) return "";
      const childDirs = getChildDirsForNode(dirNode);
      if (childDirs.length > 0) return "";
      const fileIds = getOrderedFileIdsForDir(dirNode);
      if (!fileIds.length) return "";
      return String(fileIds[0] || "");
    }

    function enterSelectedDirectory() {
      TAG_EDIT_PATH = null;
      clearBulkTagPlaceholder();

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return;
      if (WS.view.aboveRootView) {
        if (entry.kind === "dir" && entry.node === WS.root) {
          WS.view.aboveRootView = false;
          WS.nav.dirNode = WS.root;
          syncBulkSelectionForCurrentDir();
          syncFavoritesUi();
          syncHiddenUi();
          syncTagUiForCurrentDir();
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
          syncPreviewToSelection();
          renderDirectoriesPane();
          renderPreviewPane(true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          recordDirHistory();
        }
        return;
      }
      if (entry.kind === "tag") {
        openTagFolderEntry(entry);
        return;
      }

      if (entry.kind !== "dir" || !entry.node) {
        if (altGalleryModeEnabled() && entry.kind === "file") {
          openGalleryFromDirectoriesSelection(true);
        }
        return;
      }
      const directGalleryFirstId = firstFileIdForDirectFolderGalleryEntry(entry.node);
      if (directGalleryFirstId) {
        if (isViewingTagFolder()) {
          pushTagViewContext(entry.node?.path || "");
          WS.view.tagFolderActiveMode = "";
          WS.view.tagFolderActiveTag = "";
          WS.view.tagFolderActiveAlbum = "";
          WS.view.tagFolderOriginPath = "";
        }
        if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
          WS.view.searchRootActive = false;
          WS.view.searchAnchorPath = entry.node.path || "";
          WS.view.searchEntryRootPath = entry.node.path || "";
        }
        if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
          WS.view.favoritesRootActive = false;
          WS.view.favoritesAnchorPath = entry.node.path || "";
        }
        if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
          WS.view.hiddenRootActive = false;
          WS.view.hiddenAnchorPath = entry.node.path || "";
        }

        // Enter the folder context first so gallery controls operate on this folder's files.
        WS.nav.dirNode = entry.node;
        WS.view.aboveRootView = false;
        syncBulkSelectionForCurrentDir();
        syncFavoritesUi();
        syncHiddenUi();
        syncTagUiForCurrentDir();
        rebuildDirectoriesEntries();
        const fileIdx = findFileEntryIndexById(directGalleryFirstId);
        WS.nav.selectedIndex = findNearestSelectableIndex(fileIdx >= 0 ? fileIdx : selectionIndexForDirectoryEnter(), 1);
        syncPreviewToSelection();
        recordDirHistory();
        openGalleryForDir(entry.node, directGalleryFirstId, true, true);
        return;
      }

      if (isViewingTagFolder()) {
        pushTagViewContext(entry.node?.path || "");
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderActiveAlbum = "";
        WS.view.tagFolderOriginPath = "";
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
        WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
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
        WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
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
        WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
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
      WS.view.aboveRootView = false;
      syncBulkSelectionForCurrentDir();
      syncFavoritesUi();
      syncHiddenUi();
      syncTagUiForCurrentDir();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
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

      if (WS.view.aboveRootView) return;

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
          renderPreviewPane(false);
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
          renderPreviewPane(false);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          return;
        }
      }

      if (WS.nav.dirNode === WS.root) {
        if (!showRootViewEnabled()) return;
        WS.view.aboveRootView = true;
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(0, 1);
        syncPreviewToSelection();
        renderDirectoriesPane();
        renderPreviewPane(false);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        recordDirHistory();
        return;
      }

      if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
      const child = WS.nav.dirNode;
      WS.nav.dirNode = WS.nav.dirNode.parent;
      WS.view.aboveRootView = false;

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
      renderPreviewPane(false);
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
      if (!WS.nav.dirNode) return;
      if (!WS.nav.dirNode.parent && !(WS.nav.dirNode === WS.root && !WS.view.aboveRootView && showRootViewEnabled())) return;
      leaveDirectory();
    }

    function getDirectoriesPathText() {
      if (!WS.root) return "—";
      if (WS.view.aboveRootView) return "root";
      if (isViewingTagFolder()) {
        const basePath = String(WS.view.tagFolderOriginPath || "");
        const baseLabel = basePath ? displayPath(basePath) : (dirDisplayName(WS.root) || "root");
        if (WS.view.tagFolderActiveMode === "favorites") return `${baseLabel} · Favorites`;
        if (WS.view.tagFolderActiveMode === "untagged") return `${baseLabel} · Untagged`;
        if (WS.view.tagFolderActiveMode === "hidden") return `${baseLabel} · Hidden`;
        if (WS.view.tagFolderActiveMode === "album") {
          const albumLabel = displayTagFolderLabel(String(WS.view.tagFolderActiveAlbum || "").trim());
          return albumLabel ? `${baseLabel} · ${albumLabel}` : `${baseLabel} · Album`;
        }
        const albumLabel = displayTagFolderLabel(String(WS.view.tagFolderActiveAlbum || "").trim());
        const tagLabel = displayTagFolderLabel(String(WS.view.tagFolderActiveTag || "").trim());
        if (albumLabel && tagLabel) return `${baseLabel} · ${albumLabel} · ${tagLabel}`;
        return tagLabel ? `${baseLabel} · ${tagLabel}` : baseLabel;
      }
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return "search";
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
      if (!WS.nav.dirNode) return "—";
      if (WS.nav.dirNode === WS.root) return dirDisplayName(WS.root) || "root";
      const p = WS.nav.dirNode.path ? displayPath(WS.nav.dirNode.path) : "root";
      return p || "root";
    }

    function toggleFavoritesMode() {
      if (!WS.root) return;
      clearTagNavigationStack();
      WS.view.aboveRootView = false;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderActiveAlbum = "";
      WS.view.tagFolderOriginPath = "";

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
      clearTagNavigationStack();
      WS.view.aboveRootView = false;
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderActiveAlbum = "";
      WS.view.tagFolderOriginPath = "";

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

    function tagEntrySelectionKey(entry) {
      if (!entry || entry.kind !== "tag") return "";
      if (entry.placeholder) return "";
      if (entry.album && !entry.tag) {
        const album = normalizeTagAlbumName(entry.album);
        return album ? `tag-album:${album}` : "";
      }
      if (entry.special) {
        if (entry.special === "favorites") {
          return tagThumbnailKeyForEntry(entry);
        }
        return `special:${String(entry.special || "")}`;
      }
      const tag = String(entry.tag || "").trim();
      if (!tag) return "";
      return `tag:${tag}`;
    }

    function getVisibleTagFolderKeysInEntries() {
      const set = new Set();
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "tag") continue;
        const key = tagEntrySelectionKey(entry);
        if (key) set.add(key);
      }
      return set;
    }

    function getSelectedTagFolderKeysInCurrentView() {
      const baseSet = getVisibleTagFolderKeysInEntries();
      return Array.from(WS.view.bulkTagFolderSelectedKeys || []).filter(k => baseSet.has(String(k || "")));
    }

    function getSelectedTagEntriesInCurrentView() {
      const keys = new Set(getSelectedTagFolderKeysInCurrentView());
      if (!keys.size) return [];
      const out = [];
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "tag") continue;
        const key = tagEntrySelectionKey(entry);
        if (!key || !keys.has(key)) continue;
        out.push(entry);
      }
      return out;
    }

    function getSelectedFileIdsInCurrentView() {
      const baseSet = getVisibleFileIdsInEntries();
      return Array.from(WS.view.bulkFileSelectedIds || []).filter(id => baseSet.has(String(id || "")));
    }

    function getSelectedFileRecordsInCurrentView() {
      const ids = getSelectedFileIdsInCurrentView();
      const recs = [];
      for (const id of ids) {
        const rec = WS.fileById.get(String(id || ""));
        if (rec) recs.push(rec);
      }
      return recs;
    }

    function getLocalMediaRecordsForDirPath(dirPath) {
      const target = String(dirPath || "").replace(/^\/+|\/+$/g, "");
      const prefix = target ? (target + "/") : "";
      const out = [];
      for (const rec of WS.fileById.values()) {
        if (!rec || !rec.file) continue;
        const rel = String(rec.relPath || "").replace(/\\/g, "/");
        if (target && !rel.startsWith(prefix)) continue;
        out.push(rec);
      }
      return out;
    }

    function joinNativePath(basePath, relPath) {
      const base = String(basePath || "");
      const rel = String(relPath || "").replace(/^\/+|\/+$/g, "");
      if (!rel) return base.replace(/[\/\\]+$/g, "");
      const sep = base.includes("\\") ? "\\" : "/";
      const cleanBase = base.replace(/[\/\\]+$/g, "");
      return cleanBase ? (cleanBase + sep + rel.split("/").filter(Boolean).join(sep)) : rel;
    }

    function resolveAbsoluteDirectoryPath(dirPath) {
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.getPathForFile === "function")
        ? window.electronAPI
        : null;
      if (!electronApi) return "";

      const target = String(dirPath || "").replace(/^\/+|\/+$/g, "");
      const preferred = getLocalMediaRecordsForDirPath(target)
        .sort((a, b) => String(a?.relPath || "").length - String(b?.relPath || "").length);
      const fallback = Array.from(WS.fileById.values())
        .filter(rec => !!(rec && rec.file && rec.relPath))
        .sort((a, b) => String(a?.relPath || "").length - String(b?.relPath || "").length);
      const records = [];
      const seen = new Set();
      for (const rec of preferred.concat(fallback)) {
        const key = `${String(rec?.id || "")}::${String(rec?.relPath || "")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(rec);
      }
      if (!records.length) return "";

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        const absFile = String(electronApi.getPathForFile(rec.file) || "");
        const relPath = String(rec.relPath || "").replace(/\\/g, "/");
        if (!absFile || !relPath) continue;

        const absNorm = absFile.replace(/\\/g, "/");
        if (!absNorm.toLowerCase().endsWith(relPath.toLowerCase())) continue;

        const relNative = relPath.split("/").join(absFile.includes("\\") ? "\\" : "/");
        if (!relNative || absFile.length < relNative.length) continue;
        const rootAbs = absFile.slice(0, absFile.length - relNative.length).replace(/[\/\\]+$/g, "");
        const targetAbs = target ? joinNativePath(rootAbs, target) : rootAbs;
        if (targetAbs) return targetAbs;
      }
      return "";
    }

    function notifyScrubMissingTools(missingTools) {
      const list = Array.from(new Set((missingTools || []).map(v => String(v || "").trim()).filter(Boolean)));
      if (!list.length) return;
      const msg = `Scrub completed, but these tools are missing:\n\n${list.map(t => `- ${t}`).join("\n")}`;
      showStatusMessage(`Scrub missing tools: ${list.join(", ")}`);
      try {
        if (typeof window !== "undefined" && typeof window.alert === "function") {
          window.alert(msg);
        }
      } catch {}
    }

    async function scrubFoldersByPaths(paths, opts = {}) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Scrub requires a writable folder.");
        return { ok: false, missingTools: [], failed: [], skipped: [] };
      }
      const list = Array.from(new Set((paths || []).map(p => String(p || "")).filter(Boolean)));
      if (!list.length) {
        showStatusMessage("No folders selected.");
        return { ok: false, missingTools: [], failed: [], skipped: [] };
      }
      const electronApi = (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.scrubFolder === "function")
        ? window.electronAPI
        : null;
      if (!electronApi) {
        showStatusMessage("Scrub is unavailable.");
        return { ok: false, missingTools: [], failed: [], skipped: [] };
      }

      const missingSet = new Set();
      const failed = [];
      const skipped = [];

      showBusyOverlay(list.length > 1 ? "Scrubbing folders..." : "Scrubbing folder...");
      try {
        for (let i = 0; i < list.length; i++) {
          const relPath = list[i];
          const labelPath = displayPath(relPath || "");
          showBusyOverlay(`Scrubbing ${i + 1}/${list.length}: ${labelPath || relPath || "folder"}`);
          const absPath = resolveAbsoluteDirectoryPath(relPath);
          if (!absPath) {
            skipped.push(relPath);
            continue;
          }
          let result = null;
          try {
            result = await electronApi.scrubFolder({ path: absPath });
          } catch (err) {
            result = { ok: false, error: err && err.message ? String(err.message) : "scrub_failed", missingTools: [] };
          }
          const missing = (result && Array.isArray(result.missingTools)) ? result.missingTools : [];
          for (const tool of missing) {
            const t = String(tool || "").trim();
            if (!t) continue;
            missingSet.add(t);
          }
          if (!result || !result.ok) {
            failed.push({ path: relPath, error: String(result?.error || `exit_${result?.code ?? "unknown"}`) });
          }
        }
      } finally {
        hideBusyOverlay();
      }

      if (opts.refresh !== false && WS.meta.fsRootHandle) {
        await refreshWorkspaceFromRootHandle();
      }

      const okCount = list.length - failed.length - skipped.length;
      if (failed.length) {
        showStatusMessage(`Scrub finished with ${failed.length} error${failed.length === 1 ? "" : "s"}.`);
      } else if (okCount > 0) {
        showStatusMessage(`Scrub complete for ${okCount} folder${okCount === 1 ? "" : "s"}.`);
      } else {
        showStatusMessage("Scrub skipped.");
      }

      notifyScrubMissingTools(Array.from(missingSet));
      return { ok: failed.length === 0, missingTools: Array.from(missingSet), failed, skipped };
    }

    function chooseLooseSetFolderNameFromRecords(records) {
      const names = [];
      for (const rec of records || []) {
        const name = String(rec?.name || "").trim();
        if (name) names.push(name);
      }
      if (!names.length) return "New Folder";
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      let first = names[0] || "New Folder";
      let base = first;
      if (first.includes(".") && !first.startsWith(".")) {
        base = first.slice(0, first.lastIndexOf("."));
      }
      base = normalizeFolderNameInput(base);
      return base || "New Folder";
    }

    async function entryExistsInDir(dirHandle, name) {
      if (!dirHandle || !name) return false;
      try { await dirHandle.getFileHandle(name); return true; } catch {}
      try { await dirHandle.getDirectoryHandle(name); return true; } catch {}
      return false;
    }

    function splitNameExtension(name) {
      const raw = String(name || "");
      if (raw.includes(".") && !raw.startsWith(".")) {
        const idx = raw.lastIndexOf(".");
        if (idx > 0) return { base: raw.slice(0, idx), ext: raw.slice(idx) };
      }
      return { base: raw, ext: "" };
    }

    async function uniqueDestNameInDir(dirHandle, name) {
      const { base, ext } = splitNameExtension(name);
      let candidate = `${base}${ext}`;
      let n = 2;
      while (await entryExistsInDir(dirHandle, candidate)) {
        candidate = `${base} (${n})${ext}`;
        n += 1;
      }
      return candidate;
    }

    async function uniqueDirNameInParent(parentHandle, name) {
      let candidate = String(name || "") || "Merged Items";
      let n = 2;
      while (await entryExistsInDir(parentHandle, candidate)) {
        candidate = `${name} (${n})`;
        n += 1;
      }
      return candidate;
    }

    function normalizeSetMergeFolderBase(name) {
      let base = String(name || "");
      const extIdx = base.lastIndexOf(".");
      if (extIdx > 0 && !base.startsWith(".")) base = base.slice(0, extIdx);
      base = base.replace(/_[0-9]+$/g, "");
      base = normalizeFolderNameInput(base);
      return base || "Merged Items";
    }

    async function chooseSetMergeOutputName(dirHandles) {
      const names = [];
      for (const handle of dirHandles || []) {
        if (!handle) continue;
        for await (const [name] of handle.entries()) {
          if (!name) continue;
          if (name === ".local-gallery") continue;
          names.push(name);
        }
      }
      if (!names.length) return "Merged Items";
      names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
      const first = names[0] || "Merged Items";
      return normalizeSetMergeFolderBase(first);
    }

    async function moveEntryWithCollisionRename(srcDirHandle, entryHandle, entryName, destDirHandle, outInfo) {
      if (!srcDirHandle || !entryHandle || !destDirHandle) return false;
      const desiredName = await uniqueDestNameInDir(destDirHandle, entryName);
      if (typeof entryHandle.move === "function") {
        try {
          await entryHandle.move(destDirHandle, desiredName);
          if (outInfo && typeof outInfo === "object") outInfo.movedName = desiredName;
          return true;
        } catch {}
      }
      if (entryHandle.kind === "file") {
        try {
          const file = await entryHandle.getFile();
          const dstFile = await destDirHandle.getFileHandle(desiredName, { create: true });
          const writable = await dstFile.createWritable();
          await writable.write(file);
          await writable.close();
          await srcDirHandle.removeEntry(entryName);
          if (outInfo && typeof outInfo === "object") outInfo.movedName = desiredName;
          return true;
        } catch {}
        return false;
      }
      if (entryHandle.kind === "directory") {
        try {
          const dstDir = await destDirHandle.getDirectoryHandle(desiredName, { create: true });
          await copyDirectoryHandle(entryHandle, dstDir);
          await srcDirHandle.removeEntry(entryName, { recursive: true });
          if (outInfo && typeof outInfo === "object") outInfo.movedName = desiredName;
          return true;
        } catch {}
        return false;
      }
      return false;
    }

    async function deleteFolderPathsPermanently(paths) {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Delete requires a writable folder.");
        return false;
      }

      const uniquePaths = Array.from(new Set((paths || []).map(p => String(p || "").trim()).filter(Boolean)));
      if (!uniquePaths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }

      uniquePaths.sort((a, b) => {
        const depthA = a.split("/").filter(Boolean).length;
        const depthB = b.split("/").filter(Boolean).length;
        if (depthA !== depthB) return depthB - depthA;
        return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
      });

      const rootHandle = WS.meta.fsRootHandle;
      const targets = [];
      for (const path of uniquePaths) {
        const normalizedPath = normalizeWorkspaceRelPath(path);
        if (!normalizedPath) continue;
        const parts = normalizedPath.split("/").filter(Boolean);
        const folderName = parts.pop() || "";
        const parentPath = parts.join("/");
        if (!folderName) continue;
        if (folderName === ".local-gallery" || parts.includes(".local-gallery")) continue;

        let parentHandle = null;
        try { parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath); } catch {}
        if (!parentHandle) continue;

        let entryHandle = null;
        try { entryHandle = await parentHandle.getDirectoryHandle(folderName); } catch {}
        if (!entryHandle) continue;

        targets.push({ path: normalizedPath, parentPath, folderName, parentHandle, entryHandle });
      }

      if (!targets.length) {
        showStatusMessage("No folders available.");
        return false;
      }

      const label = targets.length === 1
        ? "Deleting folder..."
        : `Deleting ${targets.length} folders...`;
      showBusyOverlay(label);
      let deleted = 0;
      let failed = 0;
      try {
        for (const t of targets) {
          try {
            await t.parentHandle.removeEntry(t.folderName, { recursive: true });
            deleted++;
            invalidateDirHandleCache(t.path);
            invalidateDirHandleCache(t.parentPath);
          } catch {
            failed++;
          }
        }
      } finally {
        hideBusyOverlay();
      }

      if (!deleted) {
        showStatusMessage("Delete failed.");
        return false;
      }

      try { await refreshWorkspaceFromRootHandle(); } catch {}

      if (failed > 0) {
        showStatusMessage(`Deleted ${deleted} folder${deleted === 1 ? "" : "s"}. ${failed} failed.`);
      } else {
        showStatusMessage(`Deleted ${deleted} folder${deleted === 1 ? "" : "s"}.`);
      }
      return true;
    }

    async function setMergeSelectedDirs() {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Set Merge requires a writable folder.");
        return false;
      }
      const selectedPaths = getSelectedPathsInCurrentDir().map(p => String(p || "")).filter(Boolean);
      if (!selectedPaths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      const uniquePaths = Array.from(new Set(selectedPaths));
      const firstParts = uniquePaths[0].split("/").filter(Boolean);
      const parentPath = firstParts.slice(0, -1).join("/");
      for (const p of uniquePaths) {
        const parts = String(p || "").split("/").filter(Boolean);
        const parent = parts.slice(0, -1).join("/");
        if (parent !== parentPath) {
          showStatusMessage("Selected folders must be in the same parent folder.");
          return false;
        }
      }

      const rootHandle = WS.meta.fsRootHandle;
      let parentHandle = null;
      try { parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath); } catch {}
      if (!parentHandle) {
        showStatusMessage("Folder handle unavailable.");
        return false;
      }

      const dirHandles = [];
      for (const p of uniquePaths) {
        try {
          dirHandles.push(await getDirectoryHandleForPath(rootHandle, p));
        } catch {}
      }
      if (!dirHandles.length) {
        showStatusMessage("No folders available.");
        return false;
      }

      const desiredBase = await chooseSetMergeOutputName(dirHandles);
      const tmpBase = `${desiredBase} (Merging)`;
      const tmpName = await uniqueDirNameInParent(parentHandle, tmpBase);
      let tmpHandle = null;
      try { tmpHandle = await parentHandle.getDirectoryHandle(tmpName, { create: true }); } catch {}
      if (!tmpHandle) {
        showStatusMessage("Failed to create merge folder.");
        return false;
      }

      for (let i = 0; i < dirHandles.length; i++) {
        const handle = dirHandles[i];
        const path = uniquePaths[i];
        if (!handle || !path) continue;
        for await (const [name, entryHandle] of handle.entries()) {
          if (!name || name === ".local-gallery") continue;
          const ok = await moveEntryWithCollisionRename(handle, entryHandle, name, tmpHandle);
          if (!ok) {
            showStatusMessage(`Move failed for ${name}.`);
            return false;
          }
        }
        const folderName = path.split("/").filter(Boolean).pop();
        if (folderName) {
          try { await parentHandle.removeEntry(folderName, { recursive: true }); } catch {}
        }
      }

      let finalName = desiredBase;
      if (await entryExistsInDir(parentHandle, finalName)) {
        finalName = await uniqueDirNameInParent(parentHandle, desiredBase);
      }

      const tmpPath = parentPath ? (parentPath + "/" + tmpName) : tmpName;
      try {
        await renameDirectoryOnDisk(tmpPath, finalName);
      } catch {
        showStatusMessage("Failed to finalize merged folder.");
        return false;
      }

      finalizeBulkSelectionAction();
      closeActionMenus();
      await refreshWorkspaceFromRootHandle();

      const finalPath = parentPath ? (parentPath + "/" + finalName) : finalName;
      const idx = findDirEntryIndexByPath(finalPath);
      if (idx >= 0) {
        WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      }
      showStatusMessage("Set Merge complete.");
      return true;
    }

    async function moveFileToDirectoryHandle(srcDirHandle, dstDirHandle, name) {
      if (!srcDirHandle || !dstDirHandle) return false;
      const fname = String(name || "");
      if (!fname) return false;
      let fileHandle = null;
      try { fileHandle = await srcDirHandle.getFileHandle(fname); } catch {}
      if (!fileHandle) return false;
      if (typeof fileHandle.move === "function") {
        try {
          await fileHandle.move(dstDirHandle, fname);
          return true;
        } catch {}
      }
      try {
        const file = await fileHandle.getFile();
        const dstFile = await dstDirHandle.getFileHandle(fname, { create: true });
        const writable = await dstFile.createWritable();
        await writable.write(file);
        await writable.close();
        await srcDirHandle.removeEntry(fname);
        return true;
      } catch {}
      return false;
    }

    function updateFileRecordsForFileMoves(oldDirPath, newDirPath, fileIds) {
      const idSet = new Set((fileIds || []).map(id => String(id || "")));
      if (!idSet.size) return;
      const idMap = new Map();
      const relPathMap = new Map();
      const nextFileById = new Map();
      const movedNewIds = [];

      for (const [id, rec] of WS.fileById.entries()) {
        const key = String(id || "");
        if (!idSet.has(key)) {
          nextFileById.set(id, rec);
          continue;
        }
        const oldRelPath = String(rec.relPath || "");
        const relPath = newDirPath ? (newDirPath + "/" + rec.name) : rec.name;
        rec.dirPath = newDirPath;
        rec.relPath = relPath;
        const nextId = fileKeyForRecord(rec, relPath);
        if (oldRelPath && relPath && oldRelPath !== relPath) relPathMap.set(oldRelPath, relPath);
        rec.id = nextId;
        if (nextId !== id) idMap.set(id, nextId);
        nextFileById.set(nextId, rec);
        movedNewIds.push(nextId);
      }

      WS.fileById = nextFileById;

      const oldNode = WS.dirByPath.get(String(oldDirPath || "")) || null;
      if (oldNode && Array.isArray(oldNode.childrenFiles)) {
        oldNode.childrenFiles = oldNode.childrenFiles.filter(id => !idSet.has(String(id || "")));
      }

      const newNode = WS.dirByPath.get(String(newDirPath || "")) || null;
      if (newNode && Array.isArray(newNode.childrenFiles)) {
        for (const id of movedNewIds) {
          if (!newNode.childrenFiles.includes(id)) newNode.childrenFiles.push(id);
        }
      }

      remapFileIdsAcrossViewState(idMap);
      remapFolderThumbnailPresetValues(relPathMap);
    }

    async function looseSetMergeSelectedFiles() {
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Loose Set Merge requires a writable folder.");
        return false;
      }
      const records = getSelectedFileRecordsInCurrentView();
      if (!records.length) {
        showStatusMessage("No files selected.");
        return false;
      }
      const parentPath = String(records[0].dirPath || "");
      for (const rec of records) {
        if (String(rec.dirPath || "") !== parentPath) {
          showStatusMessage("Selected files must be in the same folder.");
          return false;
        }
      }

      const folderNameRaw = chooseLooseSetFolderNameFromRecords(records);
      const folderName = normalizeFolderNameInput(folderNameRaw);
      if (!isValidFolderName(folderName)) {
        showStatusMessage("Invalid folder name.");
        return false;
      }

      const rootHandle = WS.meta.fsRootHandle;
      let parentHandle = null;
      try { parentHandle = await getDirectoryHandleForPath(rootHandle, parentPath); } catch {}
      if (!parentHandle) {
        showStatusMessage("Folder handle unavailable.");
        return false;
      }

      let existing = null;
      try { existing = await parentHandle.getDirectoryHandle(folderName); } catch {}
      if (existing) {
        showStatusMessage("A folder with that name already exists.");
        return false;
      }
      existing = null;
      try { existing = await parentHandle.getFileHandle(folderName); } catch {}
      if (existing) {
        showStatusMessage("A file with that name already exists.");
        return false;
      }

      let tmpName = "";
      for (let i = 0; i < 24; i++) {
        const cand = `.grouping_tmp.${Math.random().toString(36).slice(2, 8)}`;
        let has = false;
        try { await parentHandle.getDirectoryHandle(cand); has = true; } catch {}
        if (!has) {
          try { await parentHandle.getFileHandle(cand); has = true; } catch {}
        }
        if (has) continue;
        tmpName = cand;
        break;
      }
      if (!tmpName) {
        showStatusMessage("Failed to create temporary folder.");
        return false;
      }

      let tmpHandle = null;
      try { tmpHandle = await parentHandle.getDirectoryHandle(tmpName, { create: true }); } catch {}
      if (!tmpHandle) {
        showStatusMessage("Failed to create temporary folder.");
        return false;
      }

      for (const rec of records) {
        const ok = await moveFileToDirectoryHandle(parentHandle, tmpHandle, rec.name);
        if (!ok) {
          showStatusMessage(`Move failed for ${rec.name || "file"}.`);
          return false;
        }
      }

      const tmpPath = parentPath ? (parentPath + "/" + tmpName) : tmpName;
      try {
        await renameDirectoryOnDisk(tmpPath, folderName);
      } catch {
        showStatusMessage("Failed to rename folder.");
        return false;
      }

      const newDirPath = parentPath ? (parentPath + "/" + folderName) : folderName;
      ensureDirPath(newDirPath);
      updateFileRecordsForFileMoves(parentPath, newDirPath, records.map(r => r.id));
      metaComputeFingerprints();
      WS.meta.dirty = true;
      try {
        if (WS.meta.storageMode === "fs") await metaSaveFsNow();
        else metaSaveLocalNow();
      } catch {}

      finalizeBulkSelectionAction();
      closeActionMenus();
      rebuildDirectoriesEntries();
      const idx = findDirEntryIndexByPath(newDirPath);
      WS.nav.selectedIndex = findNearestSelectableIndex(idx >= 0 ? idx : WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
      showStatusMessage("Loose Set Merge complete.");
      return true;
    }

    function closeActionMenus() {
      WS.view.bulkActionMenuOpen = false;
      WS.view.bulkActionMenuAnchorPath = "";
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
      closeTagContextMenu();
      closePreviewContextMenu();
    }

    function findTagEntryIndexBySelectionKey(selectionKey) {
      const key = String(selectionKey || "");
      if (!key) return -1;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (!entry || entry.kind !== "tag") continue;
        if (tagEntrySelectionKey(entry) === key) return i;
      }
      return -1;
    }

    function openBulkActionMenuForSelection(anchorKey) {
      const key = String(anchorKey || "");
      if (!key) return false;
      if (!WS.view.bulkSelectMode) return false;
      const selectedDirs = getSelectedPathsInCurrentDir();
      const selectedTags = getSelectedTagFolderKeysInCurrentView();
      const selCount = selectedDirs.length + selectedTags.length + getSelectedFileIdsInCurrentView().length;
      if (!selCount) return false;
      if (key.startsWith("dir:")) {
        const p = key.slice(4);
        if (!selectedDirs.includes(p)) return false;
      } else if (key.startsWith("tag:")) {
        const tagKey = key.slice(4);
        if (!selectedTags.includes(tagKey)) return false;
      } else if (key.startsWith("file:")) {
        const fileId = key.slice(5);
        if (!getSelectedFileIdsInCurrentView().includes(fileId)) return false;
      } else {
        return false;
      }
      if (WS.view.bulkActionMenuOpen && WS.view.bulkActionMenuAnchorPath === key) {
        closeActionMenus();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        return true;
      }
      WS.view.bulkActionMenuOpen = true;
      WS.view.bulkActionMenuAnchorPath = key;
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      clearBulkTagPlaceholder();

      let idx = -1;
      if (key.startsWith("dir:")) {
        idx = findDirEntryIndexByPath(key.slice(4));
      } else if (key.startsWith("tag:")) {
        idx = findTagEntryIndexBySelectionKey(key.slice(4));
      } else if (key.startsWith("file:")) {
        const id = key.slice(5);
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const e = WS.nav.entries[i];
          if (e && e.kind === "file" && String(e.id || "") === id) {
            idx = i;
            break;
          }
        }
      }
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
      const isRootPath = p === "" && !!WS.root;
      if (!p && !isRootPath) return;
      if (!isRootPath && openBulkActionMenuForSelection(`dir:${p}`)) return;
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = isRootPath ? "__root__" : p;
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
      if (openBulkActionMenuForSelection(`file:${id}`)) return;
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

    async function runFileActionFromMenu(action, fileId, rowEl = null) {
      const id = String(fileId || "");
      if (!id || !action) return false;

      if (action === "loose-set-merge") {
        if (!WS.meta.fsRootHandle) {
          showStatusMessage("Loose Set Merge requires a writable folder.");
          return true;
        }
        await looseSetMergeSelectedFiles();
        return true;
      }

      const rec = WS.fileById.get(id);
      if (!rec) {
        showStatusMessage("Selected file is unavailable.");
        return true;
      }

      if (action === "edit-thumbnail") {
        openThumbnailCropEditor(rec);
        return true;
      }

      const setFolderThumbPath = parseFolderThumbnailAction(action);
      if (setFolderThumbPath !== null) {
        setFolderThumbnailTargetFromRecord(rec, setFolderThumbPath);
        return true;
      }

      if (action === "set-parent-thumbnail") {
        setParentThumbnailFromRecord(rec);
        return true;
      }

      if (action === "set-folder-thumbnail") {
        setFolderThumbnailFromRecord(rec);
        return true;
      }

      if (action === "set-root-thumbnail") {
        setRootThumbnailFromRecord(rec);
        return true;
      }

      const setTagThumbKey = parseTagThumbnailAction(action);
      if (setTagThumbKey) {
        setTagThumbnailFromRecordByKey(rec, setTagThumbKey);
        return true;
      }

      if (action === "rename-file") {
        if (!WS.meta.fsRootHandle) {
          showStatusMessage("Renaming files requires a writable folder.");
          return true;
        }
        RENAME_EDIT_FILE_ID = id;
        RENAME_EDIT_PATH = null;
        TAG_EDIT_PATH = null;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        setTimeout(() => {
          const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput")
            || (rowEl && rowEl.querySelector ? rowEl.querySelector(".renameEditInput") : null)
            || directoriesListEl.querySelector(".renameEditInput");
          if (input) {
            try { input.focus(); input.select(); } catch {}
          }
        }, 0);
        return true;
      }

      return false;
    }

    function entryKeyForSelection(entry) {
      if (!entry) return "";
      if (entry.kind === "dir") return `dir:${String(entry.node?.path || "")}`;
      if (entry.kind === "file") return `file:${String(entry.id || "")}`;
      if (entry.kind === "tag") return `tag:${tagEntrySelectionKey(entry)}`;
      if (entry.kind === "up") return `up:${directoriesScrollContextKey()}`;
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
      } else if (entry.kind === "tag") {
        const key = tagEntrySelectionKey(entry);
        if (!key) return;
        if (WS.view.bulkTagFolderSelectedKeys.has(key)) WS.view.bulkTagFolderSelectedKeys.delete(key);
        else WS.view.bulkTagFolderSelectedKeys.add(key);
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
      } else if (entry.kind === "tag") {
        const key = tagEntrySelectionKey(entry);
        if (key) WS.view.bulkTagFolderSelectedKeys.add(key);
      } else if (entry.kind === "file") {
        const id = String(entry.id || "");
        if (id) WS.view.bulkFileSelectedIds.add(id);
      }
    }

    function includeCurrentSelectionInBulkSet(excludeIndex = -1) {
      const curIdx = Number(WS.nav.selectedIndex);
      if (!Number.isFinite(curIdx) || curIdx < 0 || curIdx >= WS.nav.entries.length) return;
      if (curIdx === Number(excludeIndex)) return;
      const current = WS.nav.entries[curIdx];
      if (!current || !isSelectableEntry(current)) return;
      addEntrySelection(current);
    }

    function selectEntryRange(anchorIdx, targetIdx) {
      addEntrySelectionRange(anchorIdx, targetIdx, true);
    }

    function addEntrySelectionRange(anchorIdx, targetIdx, clearExisting = false) {
      if (anchorIdx < 0 || targetIdx < 0) return;
      const start = Math.min(anchorIdx, targetIdx);
      const end = Math.max(anchorIdx, targetIdx);
      if (clearExisting) clearBulkTagSelection();
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
      const aboveRoot = !!WS.view.aboveRootView;
      const selectedKey = entryKeyForSelection(WS.nav.entries[WS.nav.selectedIndex] || null);
      const cur = WS.view.dirHistory[WS.view.dirHistoryIndex] || null;
      if (cur && cur.path === path && !!cur.aboveRoot === aboveRoot) {
        cur.selectedKey = selectedKey;
        return;
      }
      if (WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1) {
        WS.view.dirHistory = WS.view.dirHistory.slice(0, WS.view.dirHistoryIndex + 1);
      }
      WS.view.dirHistory.push({ path, aboveRoot, selectedKey });
      WS.view.dirHistoryIndex = WS.view.dirHistory.length - 1;
    }

    function initDirHistory() {
      WS.view.dirHistory = [];
      WS.view.dirHistoryIndex = -1;
      if (!WS.root || !WS.nav.dirNode) return;
      const path = String(WS.nav.dirNode?.path || "");
      const selectedKey = entryKeyForSelection(WS.nav.entries[WS.nav.selectedIndex] || null);
      WS.view.dirHistory.push({ path, aboveRoot: !!WS.view.aboveRootView, selectedKey });
      WS.view.dirHistoryIndex = 0;
    }

    function restoreDirHistoryEntry(entry) {
      if (!entry || !WS.root) return;
      clearTagNavigationStack();
      WS.view.tagFolderActiveMode = "";
      WS.view.tagFolderActiveTag = "";
      WS.view.tagFolderActiveAlbum = "";
      WS.view.tagFolderOriginPath = "";
      const node = WS.dirByPath.get(String(entry.path || "")) || WS.root;
      WS.nav.dirNode = node;
      WS.view.aboveRootView = !!entry.aboveRoot && node === WS.root && showRootViewEnabled();
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

    function positionDropdownMenuAtPoint(menuEl, x, y) {
      if (!menuEl) return;
      menuEl.classList.add("fixed");
      menuEl.style.left = "0px";
      menuEl.style.top = "0px";
      menuEl.style.right = "auto";

      const menuRect = menuEl.getBoundingClientRect();
      let left = x;
      let top = y;

      if (left + menuRect.width > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - menuRect.width - 8);
      }
      if (top + menuRect.height > window.innerHeight - 8) {
        top = Math.max(8, window.innerHeight - menuRect.height - 8);
      }

      left = Math.max(8, left);
      top = Math.max(8, top);

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
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
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

    function closePreviewContextMenu() {
      if (!previewActionMenuEl) return;
      previewActionMenuEl.classList.remove("open", "fixed");
      previewActionMenuEl.innerHTML = "";
      previewActionMenuEl.style.left = "";
      previewActionMenuEl.style.top = "";
      PREVIEW_CONTEXT_MENU_STATE = null;
    }

    function openTagContextMenu(context) {
      if (!context || !tagActionMenuEl) return;
      const tag = String(context.tag || "").trim();
      const album = normalizeTagAlbumName(context.album || "");
      const tagKey = String(context.tagKey || "").trim();
      const paths = Array.isArray(context.paths) ? context.paths : [];
      const anchor = context.anchor;
      if (!tagKey || !anchor) return;
      const isAlbumEntry = !!album && !tag && !context.special;
      const canRename = !!tag && !context.special;
      const canDelete = !context.special && (!!tag || isAlbumEntry);
      const thumbMode = metaGetTagThumbnailModeByKey(tagKey);
      const allowRotatingThumbnails = !naturalAspectThumbnailCardsEnabled();
      const hasPreset = metaHasTagThumbnailPresetByKey(tagKey);
      closeTagContextMenu();
      closeActionMenus();
      const menu = tagActionMenuEl;
      if (canRename) menu.appendChild(createTagMenuButton("Rename tag", () => handleTagMenuAction("rename")));
      if (canDelete) menu.appendChild(createTagMenuButton(isAlbumEntry ? "Delete tag album" : "Delete tag", () => handleTagMenuAction("delete")));
      if (thumbMode !== "none") menu.appendChild(createTagMenuButton("No thumbnail", () => handleTagMenuAction("thumbnail-none")));
      if (allowRotatingThumbnails && (thumbMode !== "single" || hasPreset)) menu.appendChild(createTagMenuButton("Use rotating thumbnail", () => handleTagMenuAction("thumbnail-single")));
      if (allowRotatingThumbnails && thumbMode !== "quad") menu.appendChild(createTagMenuButton("Use quad thumbnail", () => handleTagMenuAction("thumbnail-quad")));
      TAG_CONTEXT_MENU_STATE = {
        tag,
        album,
        isAlbumEntry,
        tagKey,
        label: context.label || tag || album,
        paths: paths.slice(),
        canRename,
        canDelete
      };
      requestAnimationFrame(() => {
        menu.classList.add("open");
        positionDropdownMenu(anchor, menu);
      });
    }

    function openPreviewContextMenu(x, y) {
      if (!previewActionMenuEl) return;
      closeActionMenus();

      const dirNode = getPreviewTargetDir();
      const ids = dirNode ? getOrderedFileIdsForDir(dirNode) : [];
      const canReverse = !!dirNode && canReorderFilesInDir(dirNode) && ids.length > 1;

      const menu = previewActionMenuEl;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Reverse file order";
      if (!canReverse) btn.disabled = true;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canReverse) return;
        if (reverseFilesInDir(dirNode, { visibleIds: ids })) {
          syncAfterDirOrderChange(null, { preserveSelection: true });
        }
        closePreviewContextMenu();
      });
      menu.appendChild(btn);
      PREVIEW_CONTEXT_MENU_STATE = { dirPath: String(dirNode?.path || "") };

      requestAnimationFrame(() => {
        menu.classList.add("open");
        positionDropdownMenuAtPoint(menu, x, y);
      });
    }

    function openPreviewFileActionMenu(rec, opts = {}) {
      if (!previewActionMenuEl || !rec) return;
      closeActionMenus();

      const menu = previewActionMenuEl;
      const fileId = String(rec.id || "");
      const folderThumbTargets = getFolderThumbnailTargetsForRecord(rec);
      const tagThumbTargets = getTagThumbnailTargetsForRecord(rec);

      const makeBtn = (label, action, disabled = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = String(label || "");
        btn.disabled = !!disabled;
        btn.setAttribute("data-action", String(action || ""));
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          closePreviewContextMenu();
          await runFileActionFromMenu(String(action || ""), fileId);
        });
        return btn;
      };

      for (let i = 0; i < folderThumbTargets.length; i++) {
        const t = folderThumbTargets[i];
        const label = String(t && (t.actionLabel || t.label) || "");
        const path = String(t && t.path || "");
        if (!label && path !== "") continue;
        menu.appendChild(makeBtn(label || "Set thumbnail", folderThumbnailActionForPath(path)));
      }
      for (let i = 0; i < tagThumbTargets.length; i++) {
        const t = tagThumbTargets[i];
        const label = String(t && (t.actionLabel || t.label) || "");
        const key = String(t && t.key || "");
        if (!label || !key) continue;
        menu.appendChild(makeBtn(label, tagThumbnailActionForKey(key)));
      }
      menu.appendChild(makeBtn("Edit thumbnail", "edit-thumbnail"));
      menu.appendChild(makeBtn("Rename", "rename-file"));
      PREVIEW_CONTEXT_MENU_STATE = { fileId };

      requestAnimationFrame(() => {
        menu.classList.add("open");
        if (opts.anchor) positionDropdownMenu(opts.anchor, menu);
        else positionDropdownMenuAtPoint(menu, Number(opts.x) || 0, Number(opts.y) || 0);
      });
    }

    function buildFolderMenuState(dirNode) {
      const p = String(dirNode?.path || "");
      const isRootNode = !!dirNode && dirNode === WS.root;
      const isFavorite = metaHasFavorite(p);
      const isHidden = metaHasHidden(p);
      const processingDisabled = isPathOrAncestorProcessingDisabled(p);
      const canRename = !!WS.meta.fsRootHandle;
      const canBatchIndex = !!WS.meta.fsRootHandle;
      const canResetOrder = !!dirNode?.preserveOrder;
      const folderThumbMode = isRootNode ? getRootThumbnailMode() : metaGetFolderThumbnailMode(p);
      const allowRotatingThumbnails = !naturalAspectThumbnailCardsEnabled();
      const canToggleFolderThumbMode = isRootNode ? true : folderEligibleForParentThumbnailPreset(dirNode);
      const hasPreset = isRootNode ? rootThumbnailHasPreset() : metaHasFolderThumbnailPreset(p);
      return {
        path: p,
        isRootNode,
        isFavorite,
        isHidden,
        processingDisabled,
        canRename,
        canBatchIndex,
        canResetOrder,
        showUseDefaultThumbnail: hasPreset || (isRootNode && folderThumbMode !== "quad"),
        showSetNoThumbnail: canToggleFolderThumbMode && folderThumbMode !== "none",
        showSetRotatingThumbnail: allowRotatingThumbnails && canToggleFolderThumbMode && (isRootNode ? (folderThumbMode !== "single" || hasPreset) : folderThumbMode !== "rotate"),
        showSetQuadThumbnail: allowRotatingThumbnails && canToggleFolderThumbMode && isRootNode && folderThumbMode !== "quad"
      };
    }

    function buildFolderActionMenuDom(menuEl, state, onAction) {
      if (!menuEl || !state || typeof onAction !== "function") return;
      const makeBtn = (label, action, disabled = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = String(label || "");
        btn.disabled = !!disabled;
        btn.setAttribute("data-action", String(action || ""));
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          onAction(String(action || ""));
        });
        return btn;
      };
      const appendTwoCol = (leftBtn, rightBtn) => {
        const row = document.createElement("div");
        row.className = "menuTwoColRow";
        row.appendChild(leftBtn);
        row.appendChild(rightBtn);
        menuEl.appendChild(row);
      };
      if (state.isRootNode) {
        if (state.showUseDefaultThumbnail) menuEl.appendChild(makeBtn("Use default thumbnail", "thumbnail-default"));
        if (state.showSetNoThumbnail) menuEl.appendChild(makeBtn("No thumbnail", "thumbnail-none"));
        if (state.showSetRotatingThumbnail) menuEl.appendChild(makeBtn("Use rotating thumbnail", "thumbnail-rotate"));
        if (state.showSetQuadThumbnail) menuEl.appendChild(makeBtn("Use quad thumbnail", "thumbnail-quad"));
        return;
      }
      const scoreRow = document.createElement("div");
      scoreRow.className = "scoreRow";
      scoreRow.appendChild(makeBtn("+", "score-up"));
      scoreRow.appendChild(makeBtn("-", "score-down"));
      menuEl.appendChild(scoreRow);

      appendTwoCol(
        makeBtn("Tag", "tag"),
        makeBtn("Rename", "rename", !state.canRename)
      );
      appendTwoCol(
        makeBtn(state.isFavorite ? "Unfavorite" : "Favorite", "favorite"),
        makeBtn(state.isHidden ? "Unhide" : "Hide", "hidden")
      );
      appendTwoCol(
        makeBtn("Index 1", "batch-index-1", !state.canBatchIndex),
        makeBtn("Index 2", "batch-index-2", !state.canBatchIndex)
      );
      menuEl.appendChild(makeBtn(state.processingDisabled ? "Enable Processing" : "Disable Processing", "processing-toggle"));
      if (state.canResetOrder) menuEl.appendChild(makeBtn("Reset order", "reset-order"));
      if (state.showUseDefaultThumbnail) menuEl.appendChild(makeBtn("Use default thumbnail", "thumbnail-default"));
      if (state.showSetNoThumbnail) menuEl.appendChild(makeBtn("No thumbnail", "thumbnail-none"));
      if (state.showSetRotatingThumbnail) menuEl.appendChild(makeBtn("Use rotating thumbnail", "thumbnail-rotate"));
      if (state.showSetQuadThumbnail) menuEl.appendChild(makeBtn("Use quad thumbnail", "thumbnail-quad"));
    }

    async function runFolderActionFromMenu(action, dirNode) {
      const node = dirNode || null;
      const p = String(node?.path || "");
      const isRootNode = !!node && node === WS.root;
      if (!node || (!p && !isRootNode) || !action) return false;
      if (action === "tag") {
        TAG_EDIT_PATH = p;
        RENAME_EDIT_PATH = null;
        selectDirectoryEntryByPath(p);
        renderDirectoriesPane(true);
        focusSelectedDirectoryInlineInput(".tagEditInput");
        return true;
      }
      if (action === "rename") {
        if (!WS.meta.fsRootHandle) {
          showStatusMessage("Rename requires a writable folder.");
          return true;
        }
        RENAME_EDIT_PATH = p;
        TAG_EDIT_PATH = null;
        selectDirectoryEntryByPath(p);
        renderDirectoriesPane(true);
        focusSelectedDirectoryInlineInput(".renameEditInput");
        return true;
      }
      if (action === "batch-index-1") {
        if (!WS.meta.fsRootHandle) {
          showStatusMessage("Renaming files requires a writable folder.");
          return true;
        }
        batchIndexFolderFiles(node);
        return true;
      }
      if (action === "batch-index-2") {
        if (!WS.meta.fsRootHandle) {
          showStatusMessage("Renaming files requires a writable folder.");
          return true;
        }
        batchIndexChildFolderFiles(node);
        return true;
      }
      if (action === "reset-order") {
        resetDirFileOrder(node, {
          silent: node !== WS.nav.dirNode,
          selectId: null
        });
        if (node !== WS.nav.dirNode) showStatusMessage("Order reset.");
        return true;
      }
      if (action === "favorite") {
        metaToggleFavorite(p);
        return true;
      }
      if (action === "hidden") {
        metaToggleHidden(p);
        return true;
      }
      if (action === "processing-toggle") {
        const currentlyDisabled = isPathOrAncestorProcessingDisabled(p);
        const changed = metaSetProcessingDisabledRecursive(p, !currentlyDisabled);
        const stillDisabled = isPathOrAncestorProcessingDisabled(p);
        if (!changed && currentlyDisabled && stillDisabled) {
          showStatusMessage("Processing remains disabled by a parent folder.");
          return true;
        }
        if (!changed) return true;
        if (currentlyDisabled && stillDisabled) {
          showStatusMessage("Processing remains disabled by a parent folder.");
        } else {
          showStatusMessage((!currentlyDisabled) ? "Processing disabled for folder and subfolders." : "Processing enabled for folder and subfolders.");
        }
        return true;
      }
      if (action === "thumbnail-rotate") {
        if (naturalAspectThumbnailCardsEnabled()) {
          showStatusMessage("Rotating thumbnails are disabled in natural aspect thumbnail mode.");
          return true;
        }
        let changed = false;
        if (isRootNode) {
          const presetCleared = clearRootThumbnailPreset();
          changed = setRootThumbnailMode("single") || presetCleared;
        } else {
          changed = metaSetFolderThumbnailRotate(p);
        }
        if (!changed) return true;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage(isRootNode ? "Root thumbnail set to rotating." : "Folder thumbnail set to rotating.");
        return true;
      }
      if (action === "thumbnail-default") {
        const changed = isRootNode ? resetRootThumbnailToDefault() : metaClearFolderThumbnailPreset(p);
        if (!changed) return true;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage(isRootNode ? "Root thumbnail reset to default." : "Folder thumbnail reset to default.");
        return true;
      }
      if (action === "thumbnail-none") {
        const changed = isRootNode ? setRootThumbnailMode("none") : metaSetFolderThumbnailNone(p);
        if (!changed) return true;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage(isRootNode ? "Root thumbnail removed." : "Folder thumbnail removed.");
        return true;
      }
      if (action === "thumbnail-quad") {
        if (naturalAspectThumbnailCardsEnabled()) {
          showStatusMessage("Rotating thumbnails are disabled in natural aspect thumbnail mode.");
          return true;
        }
        if (!isRootNode) return true;
        const changed = setRootThumbnailMode("quad");
        if (!changed) return true;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage("Root thumbnail set to quad.");
        return true;
      }
      if (action === "score-up") {
        metaBumpScore(p, 1);
        return true;
      }
      if (action === "score-down") {
        metaBumpScore(p, -1);
        return true;
      }
      return false;
    }

    function getPreviewFolderMenuSelectionPaths(anchorPath) {
      const p = String(anchorPath || "");
      if (!p) return [];
      const selected = getSelectedPathsInCurrentDir();
      const canUseSelection = WS.view.bulkSelectMode && selected.length && selected.includes(p);
      if (!canUseSelection) return [p];
      const unique = Array.from(new Set(selected.map((v) => String(v || "")).filter(Boolean)));
      return unique.length ? unique : [p];
    }

    function openPreviewBulkFolderActionMenu(paths, anchorPath, opts = {}) {
      if (!previewActionMenuEl) return;
      const selectedPaths = Array.from(new Set((paths || []).map((p) => String(p || "")).filter(Boolean)));
      if (!selectedPaths.length) return;
      const selectedDirNodes = selectedPaths.map((p) => WS.dirByPath.get(p)).filter(Boolean);
      if (!selectedDirNodes.length) return;
      closeActionMenus();

      const menu = previewActionMenuEl;
      menu.innerHTML = "";
      const makeBtn = (label, onClick, disabled = false) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = String(label || "");
        btn.disabled = !!disabled;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (btn.disabled) return;
          closePreviewContextMenu();
          onClick();
        });
        return btn;
      };
      const appendTwoCol = (leftBtn, rightBtn) => {
        const row = document.createElement("div");
        row.className = "menuTwoColRow";
        row.appendChild(leftBtn);
        row.appendChild(rightBtn);
        menu.appendChild(row);
      };

      const singleSelectedDirNode = selectedDirNodes.length === 1 ? selectedDirNodes[0] : null;
      const singleSelectedDirPath = String(singleSelectedDirNode?.path || "");
      const canRenameBulk = !!singleSelectedDirPath && !!WS.meta.fsRootHandle;
      const canIndexBulk = !!singleSelectedDirNode && !!WS.meta.fsRootHandle;
      const allFavorite = !!selectedPaths.length && selectedPaths.every((p) => metaHasFavorite(p));
      const allHidden = !!selectedPaths.length && selectedPaths.every((p) => metaHasHidden(p));
      const allProcessingDisabled = !!selectedPaths.length && selectedPaths.every((p) => isPathOrAncestorProcessingDisabled(p));
      const thumbTogglePaths = selectedDirNodes
        .filter((node) => folderEligibleForParentThumbnailPreset(node))
        .map((node) => String(node.path || ""))
        .filter(Boolean);
      const allThumbNone = !!thumbTogglePaths.length && thumbTogglePaths.every((p) => metaGetFolderThumbnailMode(p) === "none");
      const allThumbRotate = !!thumbTogglePaths.length && thumbTogglePaths.every((p) => metaGetFolderThumbnailMode(p) === "rotate");

      const scoreRow = document.createElement("div");
      scoreRow.className = "scoreRow";
      const scoreUpBtn = makeBtn("+", () => {
        metaBumpScoreBulk(selectedPaths, 1);
        if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
      });
      scoreUpBtn.classList.add("scoreBtn");
      const scoreDownBtn = makeBtn("-", () => {
        metaBumpScoreBulk(selectedPaths, -1);
        if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
      });
      scoreDownBtn.classList.add("scoreBtn");
      scoreRow.appendChild(scoreUpBtn);
      scoreRow.appendChild(scoreDownBtn);
      menu.appendChild(scoreRow);

      appendTwoCol(
        makeBtn("Tag", () => {
          startPreviewFolderTagEdit(selectedPaths, anchorPath);
        }),
        makeBtn("Rename", () => {
          if (!singleSelectedDirPath) return;
          startPreviewFolderRenameEdit(singleSelectedDirPath);
        }, !canRenameBulk || !singleSelectedDirPath)
      );

      appendTwoCol(
        makeBtn(allFavorite ? "Unfavorite" : "Favorite", () => {
          metaSetFavoriteBulk(selectedPaths, !allFavorite);
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
        }),
        makeBtn(allHidden ? "Unhide" : "Hide", () => {
          metaSetHiddenBulk(selectedPaths, !allHidden);
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
        })
      );

      appendTwoCol(
        makeBtn("Index 1", async () => {
          if (!canIndexBulk || !singleSelectedDirNode) return;
          await batchIndexFolderFiles(singleSelectedDirNode);
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
        }, !canIndexBulk || !singleSelectedDirNode),
        makeBtn("Index 2", async () => {
          if (!canIndexBulk || !singleSelectedDirNode) return;
          await batchIndexChildFolderFiles(singleSelectedDirNode);
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
        }, !canIndexBulk || !singleSelectedDirNode)
      );

      menu.appendChild(makeBtn(allProcessingDisabled ? "Enable Processing" : "Disable Processing", () => {
        const nextDisable = !allProcessingDisabled;
        const changed = metaSetProcessingDisabledBulk(selectedPaths, nextDisable);
        const stillAllDisabled = selectedPaths.every((p) => isPathOrAncestorProcessingDisabled(p));
        if (!changed && allProcessingDisabled && stillAllDisabled) {
          showStatusMessage("Processing remains disabled by a parent folder.");
          return;
        }
        if (!changed) return;
        if (allProcessingDisabled && stillAllDisabled) {
          showStatusMessage("Processing remains disabled by a parent folder.");
        } else {
          showStatusMessage(nextDisable
            ? "Processing disabled for selected folders and subfolders."
            : "Processing enabled for selected folders and subfolders.");
        }
        if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
      }));

      if (thumbTogglePaths.length && !allThumbNone) {
        menu.appendChild(makeBtn("No thumbnail", () => {
          const changed = metaSetFolderThumbnailModeBulk(thumbTogglePaths, "none");
          if (!changed) return;
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          showStatusMessage("Folder thumbnails removed.");
        }));
      }

      if (thumbTogglePaths.length && !allThumbRotate && !naturalAspectThumbnailCardsEnabled()) {
        menu.appendChild(makeBtn("Use rotating thumbnail", () => {
          const changed = metaSetFolderThumbnailModeBulk(thumbTogglePaths, "rotate");
          if (!changed) return;
          if (WS.view.bulkSelectMode) finalizeBulkSelectionAction();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
          showStatusMessage("Folder thumbnails set to rotating.");
        }));
      }

      if (singleSelectedDirNode && singleSelectedDirNode.preserveOrder) {
        menu.appendChild(makeBtn("Reset order", () => {
          resetDirFileOrder(singleSelectedDirNode, { silent: false, selectId: null });
        }));
      }

      PREVIEW_CONTEXT_MENU_STATE = {
        dirPath: String(anchorPath || ""),
        bulkPaths: selectedPaths.slice()
      };
      requestAnimationFrame(() => {
        menu.classList.add("open");
        if (opts.anchor) positionDropdownMenu(opts.anchor, menu);
        else positionDropdownMenuAtPoint(menu, Number(opts.x) || 0, Number(opts.y) || 0);
      });
    }

    function openPreviewFolderActionMenu(dirNode, opts = {}) {
      if (!previewActionMenuEl || !dirNode) return;
      const p = String(dirNode.path || "");
      if (!p) return;
      const selectedPaths = getPreviewFolderMenuSelectionPaths(p);
      if (selectedPaths.length > 1) {
        openPreviewBulkFolderActionMenu(selectedPaths, p, opts);
        return;
      }

      closeActionMenus();

      const menu = previewActionMenuEl;
      menu.innerHTML = "";
      const menuState = buildFolderMenuState(dirNode);
      buildFolderActionMenuDom(menu, menuState, (action) => {
        closePreviewContextMenu();
        if (action === "tag") {
          startPreviewFolderTagEdit([p], p);
          return;
        }
        if (action === "rename") {
          startPreviewFolderRenameEdit(p);
          return;
        }
        runFolderActionFromMenu(action, dirNode).catch(() => {});
      });

      PREVIEW_CONTEXT_MENU_STATE = { dirPath: p };
      requestAnimationFrame(() => {
        menu.classList.add("open");
        if (opts.anchor) positionDropdownMenu(opts.anchor, menu);
        else positionDropdownMenuAtPoint(menu, Number(opts.x) || 0, Number(opts.y) || 0);
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
      const thumbKeys = getAllTagThumbnailStateKeys();
      for (let i = 0; i < thumbKeys.length; i++) {
        const oldKey = thumbKeys[i];
        const parsed = parseTagThumbnailStructuredKey(oldKey);
        if (!parsed || parsed.kind !== "tag" || String(parsed.value || "") !== normalizedOld) continue;
        const newKey = parsed.scoped
          ? tagThumbnailKeyForTag(normalizedNew, parsed.scopePath)
          : tagThumbnailKeyForTag(normalizedNew);
        if (!newKey) continue;
        if (rekeyTagThumbnailState(oldKey, newKey)) changed = true;
      }
      const oldAlbum = metaGetTagAlbumForTag(normalizedOld);
      if (oldAlbum) {
        let albumChanged = false;
        if (!metaGetTagAlbumForTag(normalizedNew)) {
          if (metaSetTagAlbumForTag(normalizedNew, oldAlbum)) albumChanged = true;
        }
        if (metaSetTagAlbumForTag(normalizedOld, "")) albumChanged = true;
        if (albumChanged) changed = true;
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
      if (clearTagThumbnailStateByMatch((key) => {
        const parsed = parseTagThumbnailStructuredKey(key);
        return !!parsed && parsed.kind === "tag" && String(parsed.value || "") === normalized;
      })) changed = true;
      if (metaSetTagAlbumForTag(normalized, "")) changed = true;
      return changed;
    }

    function deleteTagAlbumByName(albumName) {
      const album = normalizeTagAlbumName(albumName || "");
      if (!album) return { changed: false, clearedTags: 0, album: "" };
      let changed = false;
      let clearedTags = 0;
      if (WS.meta && WS.meta.tagAlbumByTag) {
        const entries = Array.from(WS.meta.tagAlbumByTag.entries());
        for (let i = 0; i < entries.length; i++) {
          const tag = String(entries[i][0] || "");
          const assignedAlbum = normalizeTagAlbumName(entries[i][1] || "");
          if (!tag || assignedAlbum !== album) continue;
          if (metaSetTagAlbumForTag(tag, "")) {
            changed = true;
            clearedTags++;
          }
        }
      }
      if (clearTagThumbnailStateByMatch((key) => {
        const parsed = parseTagThumbnailStructuredKey(key);
        return !!parsed && parsed.kind === "album" && String(parsed.value || "") === album;
      })) changed = true;
      return { changed, clearedTags, album };
    }

    function handleTagMenuAction(action) {
      const ctx = TAG_CONTEXT_MENU_STATE;
      if (!ctx) return;
      closeTagContextMenu();
      const tag = ctx.tag || "";
      const album = normalizeTagAlbumName(ctx.album || "");
      const isAlbumEntry = !!ctx.isAlbumEntry && !!album;
      const tagKey = String(ctx.tagKey || "");
      const label = ctx.label || tag || album;
      const paths = ctx.paths || [];
      if (action === "rename") {
        if (!ctx.canRename) return;
        if (!paths.length) {
          showStatusMessage("No folders contain that tag.");
          return;
        }
        TAG_ENTRY_RENAME_STATE = { tag, label, paths };
        renderDirectoriesPane(true);
        return;
      }
      if (action === "delete") {
        if (!ctx.canDelete) return;
        if (isAlbumEntry) {
          const confirmed = confirm(`Delete tag album '${label}'? This keeps all tags and just ungroups them from the album.`);
          if (!confirmed) return;
          const result = deleteTagAlbumByName(album);
          if (!result.changed) {
            showStatusMessage("No tags updated.");
            return;
          }
          metaScheduleSave();
          refreshAfterTagMetadataChange();
          const ungroupedCount = Number(result.clearedTags) || 0;
          showStatusMessage(`Deleted tag album '${label}' and ungrouped ${ungroupedCount} tag${ungroupedCount === 1 ? "" : "s"}.`);
          return;
        }
        if (!paths.length) {
          showStatusMessage("No folders contain that tag.");
          return;
        }
        const confirmed = confirm(`Remove tag '${label}' from these folders?`);
        if (!confirmed) return;
        const changed = deleteTagFromPaths(tag, paths);
        if (!changed) {
          showStatusMessage("No folders updated.");
          return;
        }
        metaScheduleSave();
        refreshAfterTagMetadataChange();
        showStatusMessage(`Removed tag '${label}'.`);
        return;
      }
      if (!tagKey) {
        showStatusMessage("No folders contain that tag.");
        return;
      }
      if (action === "thumbnail-none") {
        const changed = metaSetTagThumbnailModeByKey(tagKey, "none");
        if (!changed) return;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage(`Thumbnail for '${label}' removed.`);
        return;
      }
      if (action === "thumbnail-single") {
        if (naturalAspectThumbnailCardsEnabled()) {
          showStatusMessage("Rotating thumbnails are disabled in natural aspect thumbnail mode.");
          return;
        }
        const presetCleared = metaClearTagThumbnailPresetByKey(tagKey);
        const changed = metaSetTagThumbnailModeByKey(tagKey, "single") || presetCleared;
        if (!changed) return;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage(`'${label}' uses a rotating thumbnail.`);
        return;
      }
      if (action === "thumbnail-quad") {
        if (naturalAspectThumbnailCardsEnabled()) {
          showStatusMessage("Rotating thumbnails are disabled in natural aspect thumbnail mode.");
          return;
        }
        const changed = metaSetTagThumbnailModeByKey(tagKey, "quad");
        if (!changed) return;
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
        showStatusMessage(`'${label}' uses quad thumbnails.`);
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
      const selectedTagFolders = canBulk ? getSelectedTagFolderKeysInCurrentView() : [];
      const selectedTagEntries = canBulk ? getSelectedTagEntriesInCurrentView() : [];
      const selectedFiles = canBulk ? getSelectedFileIdsInCurrentView() : [];
      const selCount = selectedDirs.length + selectedTagFolders.length + selectedFiles.length;
      const hasActionSelection = (selectedDirs.length + selectedTagFolders.length + selectedFiles.length) > 0;
      if (!selCount) {
        WS.view.bulkActionMenuOpen = false;
        WS.view.bulkActionMenuAnchorPath = "";
      }

      const rowVisible = canBulk && (WS.view.bulkSelectMode || WS.view.bulkActionMenuOpen);
      directoriesActionRowEl.style.display = rowVisible ? "flex" : "none";

      if (directoriesSelectAllBtn) {
        const visibleFiles = canBulk ? Array.from(getVisibleFileIdsInEntries()) : [];
        const allSelected = visibleFiles.length > 0 && selectedFiles.length === visibleFiles.length;
        directoriesSelectAllBtn.style.display = "none";
        directoriesSelectAllBtn.disabled = !WS.view.bulkSelectMode || !visibleFiles.length || allSelected;
      }

      const menuOpen = WS.view.bulkActionMenuOpen && canBulk && hasActionSelection;
      directoriesActionMenuEl.classList.toggle("open", menuOpen);
      directoriesActionMenuEl.innerHTML = "";

      if (!menuOpen) return;

      const allFavorite = !!selectedDirs.length && selectedDirs.every(p => metaHasFavorite(p));
      const allHidden = !!selectedDirs.length && selectedDirs.every(p => metaHasHidden(p));
      const allProcessingDisabled = !!selectedDirs.length && selectedDirs.every(p => isPathOrAncestorProcessingDisabled(p));
      const albumAssignableTagEntries = selectedTagEntries.filter((entry) => (
        entry && entry.kind === "tag" && !entry.special && !entry.placeholder && String(entry.tag || "").trim()
      ));
      const deletableTagEntries = albumAssignableTagEntries;
      const deletableTagAlbumEntries = selectedTagEntries.filter((entry) => (
        entry
        && entry.kind === "tag"
        && !entry.special
        && !entry.placeholder
        && !String(entry.tag || "").trim()
        && !!normalizeTagAlbumName(entry.album || "")
      ));
      const tagThumbTargets = (() => {
        const out = [];
        const seen = new Set();
        for (let i = 0; i < selectedTagEntries.length; i++) {
          const entry = selectedTagEntries[i];
          const key = tagThumbnailKeyForEntry(entry);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push(key);
        }
        return out;
      })();
      const allTagThumbNone = !!tagThumbTargets.length && tagThumbTargets.every((key) => metaGetTagThumbnailModeByKey(key) === "none");
      const allTagThumbSingleNoPreset = !!tagThumbTargets.length && tagThumbTargets.every((key) => (
        metaGetTagThumbnailModeByKey(key) === "single" && !metaHasTagThumbnailPresetByKey(key)
      ));
      const allTagThumbQuad = !!tagThumbTargets.length && tagThumbTargets.every((key) => metaGetTagThumbnailModeByKey(key) === "quad");
      const canUseGridTagThumbBulkActions = isGridInteractionMode() && !!tagThumbTargets.length;
      if (!selectedDirs.length && !albumAssignableTagEntries.length && !deletableTagAlbumEntries.length && !canUseGridTagThumbBulkActions && !selectedFiles.length) {
        WS.view.bulkActionMenuOpen = false;
        directoriesActionMenuEl.classList.remove("open");
        return;
      }

      const makeActionBtn = (label, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          closeActionMenus();
          renderDirectoriesPane(true);
          onClick();
        });
        return btn;
      };

      const makeTwoColRow = (leftBtn, rightBtn) => {
        const row = document.createElement("div");
        row.className = "menuTwoColRow";
        row.appendChild(leftBtn);
        row.appendChild(rightBtn);
        return row;
      };

      if (albumAssignableTagEntries.length) {
        directoriesActionMenuEl.appendChild(makeActionBtn("Tag album", () => {
          WS.view.bulkActionMenuOpen = false;
          const tags = normalizeTagList(albumAssignableTagEntries.map((entry) => String(entry.tag || "")));
          if (!tags.length) {
            showStatusMessage("No tags selected.");
            return;
          }
          finalizeBulkSelectionAction();
          startBulkTagAlbuming(tags);
        }));
      }

      if (deletableTagEntries.length) {
        directoriesActionMenuEl.appendChild(makeActionBtn("Delete tags", () => {
          WS.view.bulkActionMenuOpen = false;
          const byTag = new Map();
          for (const entry of deletableTagEntries) {
            const tag = String(entry.tag || "").trim();
            if (!tag) continue;
            const dirs = getDirsForTagEntry(entry);
            const paths = gatherTagPathsForDirs(dirs);
            if (!paths.length) continue;
            byTag.set(tag, paths);
          }
          if (!byTag.size) {
            showStatusMessage("No tags available to delete.");
            return;
          }
          const count = byTag.size;
          const confirmed = confirm(`Remove ${count} selected tag${count === 1 ? "" : "s"} from all included folders?`);
          if (!confirmed) return;
          let changed = false;
          for (const [tag, paths] of byTag.entries()) {
            if (deleteTagFromPaths(tag, paths)) changed = true;
          }
          if (!changed) {
            showStatusMessage("No folders updated.");
            return;
          }
          metaScheduleSave();
          refreshAfterTagMetadataChange();
          showStatusMessage(`Removed ${count} tag${count === 1 ? "" : "s"}.`);
          finalizeBulkSelectionAction();
        }));
      }

      if (deletableTagAlbumEntries.length) {
        directoriesActionMenuEl.appendChild(makeActionBtn("Delete tag albums", () => {
          WS.view.bulkActionMenuOpen = false;
          const albums = [];
          const seenAlbums = new Set();
          for (const entry of deletableTagAlbumEntries) {
            const album = normalizeTagAlbumName(entry.album || "");
            if (!album || seenAlbums.has(album)) continue;
            seenAlbums.add(album);
            albums.push(album);
          }
          if (!albums.length) {
            showStatusMessage("No tag albums available to delete.");
            return;
          }
          const selectedCount = albums.length;
          const confirmed = confirm(`Delete ${selectedCount} selected tag album${selectedCount === 1 ? "" : "s"}? Tags stay and will be ungrouped.`);
          if (!confirmed) return;
          let changed = false;
          let deletedCount = 0;
          let ungroupedTotal = 0;
          for (let i = 0; i < albums.length; i++) {
            const result = deleteTagAlbumByName(albums[i]);
            if (!result.changed) continue;
            changed = true;
            deletedCount++;
            ungroupedTotal += Number(result.clearedTags) || 0;
          }
          if (!changed) {
            showStatusMessage("No tags updated.");
            return;
          }
          metaScheduleSave();
          refreshAfterTagMetadataChange();
          showStatusMessage(`Deleted ${deletedCount} tag album${deletedCount === 1 ? "" : "s"} and ungrouped ${ungroupedTotal} tag${ungroupedTotal === 1 ? "" : "s"}.`);
          finalizeBulkSelectionAction();
        }));
      }

      if (canUseGridTagThumbBulkActions) {
        if (!allTagThumbNone) {
          directoriesActionMenuEl.appendChild(makeActionBtn("No tag thumbnail", () => {
            WS.view.bulkActionMenuOpen = false;
            let changed = false;
            for (let i = 0; i < tagThumbTargets.length; i++) {
              if (metaSetTagThumbnailModeByKey(tagThumbTargets[i], "none")) changed = true;
            }
            if (!changed) return;
            finalizeBulkSelectionAction();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage("Tag folder thumbnails removed.");
          }));
        }

        if (!naturalAspectThumbnailCardsEnabled() && !allTagThumbSingleNoPreset) {
          directoriesActionMenuEl.appendChild(makeActionBtn("Use rotating tag thumbnail", () => {
            WS.view.bulkActionMenuOpen = false;
            let changed = false;
            for (let i = 0; i < tagThumbTargets.length; i++) {
              const key = tagThumbTargets[i];
              const presetCleared = metaClearTagThumbnailPresetByKey(key);
              const modeChanged = metaSetTagThumbnailModeByKey(key, "single");
              if (presetCleared || modeChanged) changed = true;
            }
            if (!changed) return;
            finalizeBulkSelectionAction();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage("Tag folder thumbnails set to rotating.");
          }));
        }

        if (!naturalAspectThumbnailCardsEnabled() && !allTagThumbQuad) {
          directoriesActionMenuEl.appendChild(makeActionBtn("Use quad tag thumbnail", () => {
            WS.view.bulkActionMenuOpen = false;
            let changed = false;
            for (let i = 0; i < tagThumbTargets.length; i++) {
              if (metaSetTagThumbnailModeByKey(tagThumbTargets[i], "quad")) changed = true;
            }
            if (!changed) return;
            finalizeBulkSelectionAction();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage("Tag folder thumbnails set to quad.");
          }));
        }
      }

      if (selectedDirs.length) {
        const selectedDirNodes = selectedDirs.map((p) => WS.dirByPath.get(String(p || ""))).filter(Boolean);
        const singleSelectedDirNode = selectedDirNodes.length === 1 ? selectedDirNodes[0] : null;
        const singleSelectedDirPath = String(singleSelectedDirNode?.path || "");
        const canRenameBulk = !!singleSelectedDirPath && !!WS.meta.fsRootHandle;
        const canIndexBulk = !!singleSelectedDirNode && !!WS.meta.fsRootHandle;
        const thumbTogglePaths = selectedDirNodes
          .filter((node) => folderEligibleForParentThumbnailPreset(node))
          .map((node) => String(node.path || ""))
          .filter(Boolean);
        const thumbDefaultPaths = thumbTogglePaths.filter((p) => metaHasFolderThumbnailPreset(p));
        const allThumbNone = !!thumbTogglePaths.length && thumbTogglePaths.every((p) => metaGetFolderThumbnailMode(p) === "none");
        const allThumbRotate = !!thumbTogglePaths.length && thumbTogglePaths.every((p) => metaGetFolderThumbnailMode(p) === "rotate");

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

        const tagBtn = makeActionBtn("Tag", () => {
          WS.view.bulkActionMenuOpen = false;
          finalizeBulkSelectionAction();
          startBulkTagging(selectedDirs);
        });
        const renameBtn = makeActionBtn("Rename", () => {
          WS.view.bulkActionMenuOpen = false;
          if (!canRenameBulk || !singleSelectedDirPath) return;
          const idx = findDirEntryIndexByPath(singleSelectedDirPath);
          if (idx >= 0) {
            WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
            syncPreviewToSelection();
          }
          RENAME_EDIT_PATH = singleSelectedDirPath;
          TAG_EDIT_PATH = null;
          renderDirectoriesPane(true);
          setTimeout(() => {
            const input = directoriesListEl.querySelector(".dirRow.selected .renameEditInput");
            if (input) {
              try { input.focus(); input.select(); } catch {}
            }
          }, 0);
        });
        if (!canRenameBulk) renameBtn.disabled = true;
        directoriesActionMenuEl.appendChild(makeTwoColRow(tagBtn, renameBtn));

        const favoriteBtn = makeActionBtn(allFavorite ? "Unfavorite" : "Favorite", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetFavoriteBulk(selectedDirs, !allFavorite);
          finalizeBulkSelectionAction();
        });
        const hiddenBtn = makeActionBtn(allHidden ? "Unhide" : "Hide", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetHiddenBulk(selectedDirs, !allHidden);
          finalizeBulkSelectionAction();
        });
        directoriesActionMenuEl.appendChild(makeTwoColRow(favoriteBtn, hiddenBtn));

        const index1Btn = makeActionBtn("Index 1", async () => {
          WS.view.bulkActionMenuOpen = false;
          if (!canIndexBulk || !singleSelectedDirNode) return;
          await batchIndexFolderFiles(singleSelectedDirNode);
          finalizeBulkSelectionAction();
        });
        const index2Btn = makeActionBtn("Index 2", async () => {
          WS.view.bulkActionMenuOpen = false;
          if (!canIndexBulk || !singleSelectedDirNode) return;
          await batchIndexChildFolderFiles(singleSelectedDirNode);
          finalizeBulkSelectionAction();
        });
        if (!canIndexBulk) {
          index1Btn.disabled = true;
          index2Btn.disabled = true;
        }
        directoriesActionMenuEl.appendChild(makeTwoColRow(index1Btn, index2Btn));

        directoriesActionMenuEl.appendChild(makeActionBtn(allProcessingDisabled ? "Enable Processing" : "Disable Processing", () => {
          WS.view.bulkActionMenuOpen = false;
          const nextDisable = !allProcessingDisabled;
          const changed = metaSetProcessingDisabledBulk(selectedDirs, nextDisable);
          const stillAllDisabled = selectedDirs.every(p => isPathOrAncestorProcessingDisabled(p));
          if (!changed && allProcessingDisabled && stillAllDisabled) {
            showStatusMessage("Processing remains disabled by a parent folder.");
            return;
          }
          if (!changed) return;
          if (allProcessingDisabled && stillAllDisabled) {
            showStatusMessage("Processing remains disabled by a parent folder.");
          } else {
            showStatusMessage(nextDisable
              ? "Processing disabled for selected folders and subfolders."
              : "Processing enabled for selected folders and subfolders.");
          }
          finalizeBulkSelectionAction();
        }));

        if (isGridInteractionMode() && thumbDefaultPaths.length) {
          directoriesActionMenuEl.appendChild(makeActionBtn("Use default thumbnail", () => {
            WS.view.bulkActionMenuOpen = false;
            let changed = false;
            for (let i = 0; i < thumbDefaultPaths.length; i++) {
              if (metaClearFolderThumbnailPreset(thumbDefaultPaths[i])) changed = true;
            }
            if (!changed) return;
            finalizeBulkSelectionAction();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage("Folder thumbnails reset to default.");
          }));
        }

        if (thumbTogglePaths.length && !allThumbNone) {
          directoriesActionMenuEl.appendChild(makeActionBtn("No thumbnail", () => {
            WS.view.bulkActionMenuOpen = false;
            const changed = metaSetFolderThumbnailModeBulk(thumbTogglePaths, "none");
            if (!changed) return;
            finalizeBulkSelectionAction();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage("Folder thumbnails removed.");
          }));
        }

        if (thumbTogglePaths.length && !allThumbRotate && !naturalAspectThumbnailCardsEnabled()) {
          directoriesActionMenuEl.appendChild(makeActionBtn("Use rotating thumbnail", () => {
            WS.view.bulkActionMenuOpen = false;
            const changed = metaSetFolderThumbnailModeBulk(thumbTogglePaths, "rotate");
            if (!changed) return;
            finalizeBulkSelectionAction();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            kickVideoThumbsForPreview();
            kickImageThumbsForPreview();
            showStatusMessage("Folder thumbnails set to rotating.");
          }));
        }

        const setMergeBtn = makeActionBtn("Set Merge", async () => {
          WS.view.bulkActionMenuOpen = false;
          await setMergeSelectedDirs();
        });
        if (!WS.meta.fsRootHandle) setMergeBtn.disabled = true;
        directoriesActionMenuEl.appendChild(setMergeBtn);
      }

      if (selectedFiles.length) {
        const selectedFileRecords = selectedFiles
          .map((id) => WS.fileById.get(String(id || "")))
          .filter(Boolean);
        const singleFile = selectedFileRecords.length === 1 ? selectedFileRecords[0] : null;
        const allSameDir = selectedFileRecords.length > 0
          && selectedFileRecords.every((rec) => String(rec.dirPath || "") === String(selectedFileRecords[0].dirPath || ""));

        const renameBtn = makeActionBtn("Rename file", () => {
          WS.view.bulkActionMenuOpen = false;
          startFileRenameSelection();
        });
        if (!singleFile || !WS.meta.fsRootHandle) renameBtn.disabled = true;
        directoriesActionMenuEl.appendChild(renameBtn);

        const mergeBtn = makeActionBtn("Loose Set Merge", async () => {
          WS.view.bulkActionMenuOpen = false;
          await looseSetMergeSelectedFiles();
        });
        if (!WS.meta.fsRootHandle || !allSameDir) mergeBtn.disabled = true;
        directoriesActionMenuEl.appendChild(mergeBtn);
      }

      const anchorBtn = findDirMenuButtonForAnchorKey(WS.view.bulkActionMenuAnchorPath);
      if (anchorBtn) {
        requestAnimationFrame(() => positionDropdownMenu(anchorBtn, directoriesActionMenuEl));
      }
    }

    function findDirMenuButtonForAnchorKey(anchorKey) {
      const key = String(anchorKey || "");
      if (!directoriesListEl) return null;
      const rows = directoriesListEl.querySelectorAll(".dirRow");
      let fallback = null;
      for (const row of rows) {
        const btn = row.querySelector(".dirMenuBtn");
        if (btn && !fallback) fallback = btn;
        if (key && row.dataset && row.dataset.bulkAnchor === key) {
          return btn;
        }
      }
      return fallback;
    }

    function findDirRowForPath(path) {
      if (!directoriesListEl) return null;
      const rows = directoriesListEl.querySelectorAll(".dirRow");
      for (const row of rows) {
        if (String(row?.dataset?.dirPath || "") === String(path || "")) return row;
      }
      return null;
    }

    function setDirectoriesHeaderActive(active) {
      if (!directoriesHeader) return;
      directoriesHeader.classList.toggle("active", !!active);
    }

    function applyDirectoriesFilesOnlyChromeMode(active) {
      if (!document || !document.body) return;
      document.body.classList.toggle("directories-files-only", !!active);
    }

    function renderDirectoriesBulkHeader() {
      if (!directoriesBulkRowEl) return;
      directoriesBulkRowEl.style.display = "none";
      directoriesBulkRowEl.innerHTML = "";
    }

    let LAST_DIRECTORIES_SCROLL_CONTEXT = "";
    function directoriesScrollContextKey() {
      if (!WS.root) return "none";
      if (WS.view.aboveRootView) return "above-root";
      if (isViewingTagFolder()) {
        return `tag:${String(WS.view.tagFolderActiveMode || "")}:${String(WS.view.tagFolderActiveTag || "")}:${String(WS.view.tagFolderActiveAlbum || "")}:${String(WS.view.tagFolderOriginPath || "")}`;
      }
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        return `search:${String(WS.view.searchRootPath || "")}`;
      }
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites-root";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden-root";
      return `dir:${String(WS.nav.dirNode?.path || "")}`;
    }

    let GRID_CARD_SIZE_RAF = 0;
    function gridModeColumnCountForScale(scaleValue) {
      const scale = normalizeThumbnailScaleValue(scaleValue, "medium");
      const cols = GRID_CROPPED_COLS_BY_SCALE[scale];
      if (Number.isFinite(cols) && cols >= 1) return cols;
      return GRID_CROPPED_COLS_BY_SCALE.medium;
    }

    function applyGridModeCardSizing() {
      if (!directoriesListEl) return;
      if (!isGridInteractionMode() || !directoriesListEl.classList.contains("gridModeList")) {
        directoriesListEl.style.removeProperty("--grid-card-size");
        directoriesListEl.style.removeProperty("--grid-cols");
        invalidateGridRowMetricsCache();
        return;
      }
      const cs = getComputedStyle(directoriesListEl);
      const padLeft = parseFloat(cs.paddingLeft || "0") || 0;
      const padRight = parseFloat(cs.paddingRight || "0") || 0;
      const gap = Math.max(0, parseFloat(cs.columnGap || cs.gap || "0") || 0);
      const available = Math.max(0, directoriesListEl.clientWidth - padLeft - padRight);
      if (available <= 0) return;
      const activeScale = getActiveThumbnailScale(WS.meta && WS.meta.options ? WS.meta.options : null);
      let cols = gridModeColumnCountForScale(activeScale);
      const baseMin = Math.max(120, parseFloat(cs.getPropertyValue("--grid-card-min") || "0") || 120);
      while (cols > 1) {
        const candidate = (available - (gap * Math.max(0, cols - 1))) / cols;
        if (candidate >= (baseMin * 0.6)) break;
        cols -= 1;
      }
      if (!Number.isFinite(cols) || cols < 1) cols = 1;
      // Fit cards exactly to the width for each scale tier so rows stay gapless.
      const card = Math.max(80, (available - (gap * Math.max(0, cols - 1))) / cols);
      directoriesListEl.style.setProperty("--grid-cols", String(cols));
      directoriesListEl.style.setProperty("--grid-card-size", `${card.toFixed(3)}px`);
      invalidateGridRowMetricsCache();
    }

    function scheduleGridModeCardSizing() {
      if (GRID_CARD_SIZE_RAF) {
        try { cancelAnimationFrame(GRID_CARD_SIZE_RAF); } catch {}
        GRID_CARD_SIZE_RAF = 0;
      }
      GRID_CARD_SIZE_RAF = requestAnimationFrame(() => {
        GRID_CARD_SIZE_RAF = 0;
        applyGridModeCardSizing();
      });
    }

    function renderDirectoriesPane(keepScroll = false) {
      const nextContextKey = directoriesScrollContextKey();
      const contextChanged = nextContextKey !== LAST_DIRECTORIES_SCROLL_CONTEXT;
      const preserveScroll = !!keepScroll && !contextChanged;
      const prevScroll = preserveScroll ? directoriesListEl.scrollTop : 0;
      const gridModeActive = isGridInteractionMode();
      const prevFilesOnlyChromeMode = !!(document && document.body && document.body.classList.contains("directories-files-only"));
      const prevSelectedRowCenterOffset = (() => {
        const container = directoriesListEl;
        const prevSelected = directoriesListEl.querySelector(".dirRow.selected");
        if (!prevSelected) return null;
        const viewTop = container.scrollTop;
        const viewBottom = viewTop + container.clientHeight;
        const rowTop = prevSelected.offsetTop;
        const rowBottom = rowTop + prevSelected.offsetHeight;
        if (rowTop < viewTop || rowBottom > viewBottom) return null;
        return (rowTop - viewTop) + (prevSelected.offsetHeight * 0.5);
      })();
      invalidateGridRowMetricsCache();
      directoriesListEl.innerHTML = "";
      directoriesListEl.classList.toggle("gridModeList", gridModeActive);
      updateGridModeListTopInset();
      updateTitleLabel();
      const folderSquareCardMode = true;
      const naturalThumbCards = naturalAspectThumbnailCardsEnabled();
      directoriesListEl.classList.toggle("naturalThumbCards", !!naturalThumbCards);
      if (gridModeActive) scheduleGridModeCardSizing();
      else {
        directoriesListEl.style.removeProperty("--grid-card-size");
        directoriesListEl.style.removeProperty("--grid-cols");
      }
      const showFolderItemCount = !(WS.meta && WS.meta.options && WS.meta.options.showFolderItemCount === false);
      const showFolderSize = !(WS.meta && WS.meta.options && WS.meta.options.showFolderSize === false);
      const showDirFileTypeLabel = !(WS.meta && WS.meta.options && WS.meta.options.showDirFileTypeLabel === false);
      const dirSortMetrics = buildDirSortMetrics();
      const dirSizeByPath = dirSortMetrics.sizeByPath;
      const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
      const canReorderGridFileEntries = gridModeActive && canReorderFilesInCurrentDir();
      const visibleFileIdsForGridReorder = canReorderGridFileEntries ? Array.from(getVisibleFileIdsInEntries()) : [];
      const selectedFilesInView = canBulk ? getSelectedFileIdsInCurrentView() : [];
      const selectedFilesInViewCount = selectedFilesInView.length;
      if (gridModeActive) setupDirectoriesGridFileDropZone(directoriesListEl);
      else finishDirectoriesGridFileDrag();
      renderDirectoriesTagsHeader();
      renderDirectoriesBulkHeader();
      renderDirectoriesActionHeader();

      const headerActive = !!WS.root && (
        (directoriesTagsRowEl && directoriesTagsRowEl.style.display !== "none") ||
        (directoriesBulkRowEl && directoriesBulkRowEl.style.display !== "none")
      );
      const filesOnlyDirView = !!WS.root
        && WS.nav.entries.length > 0
        && WS.nav.entries.every((entry) => entry && entry.kind === "file");
      const leadingTagEntries = !!(WS.nav.entries.length && WS.nav.entries[0] && WS.nav.entries[0].kind === "tag");
      const spawnUnderControls = contextChanged && leadingTagEntries;
      const filesOnlyModeChanged = prevFilesOnlyChromeMode !== filesOnlyDirView;
      applyDirectoriesFilesOnlyChromeMode(gridModeActive ? false : filesOnlyDirView);
      setDirectoriesHeaderActive(gridModeActive ? false : (!filesOnlyDirView && headerActive));

      if (!WS.root) {
        LAST_DIRECTORIES_SCROLL_CONTEXT = nextContextKey;
        applyDirectoriesFilesOnlyChromeMode(false);
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">Load a folder to begin.</div>`;
        return;
      }


      if (!WS.nav.entries.length) {
        LAST_DIRECTORIES_SCROLL_CONTEXT = nextContextKey;
        applyDirectoriesFilesOnlyChromeMode(false);
        let emptyMsg = "Empty directory.";
        if (isViewingTagFolder()) {
          if (WS.view.tagFolderActiveMode === "favorites") emptyMsg = "No favorite folders.";
          else if (WS.view.tagFolderActiveMode === "hidden") emptyMsg = "No hidden folders.";
          else if (WS.view.tagFolderActiveMode === "album") {
            const albumLabel = String(WS.view.tagFolderActiveAlbum || "");
            emptyMsg = albumLabel ? `No tags in album '${albumLabel}'.` : "No tags in this album.";
          }
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
          if (showFolderItemCount) {
            const countText = `${dirItemCount(entry.node)} items`;
            if (countText.length > maxMetaLen) maxMetaLen = countText.length;
          }
          if (showFolderSize) {
            const sizeText = formatBytes(dirSizeByPath.get(String(entry.node?.path || "")) || 0);
            if (sizeText.length > maxMetaLen) maxMetaLen = sizeText.length;
          }
        }
      }
      try { directoriesListEl.style.setProperty("--dirMetaCh", String(maxMetaLen)); } catch {}

      const frag = document.createDocumentFragment();
      const showTagSpacer = showTagFolderSpacerRowEnabled()
        && WS.nav.entries.some((entry) => entry && entry.kind === "tag")
        && WS.nav.entries.some((entry) => entry && entry.kind === "dir");
      let seenTagEntryBeforeCurrent = false;
      let insertedTagSpacer = false;
      WS.nav.entries.forEach((entry, idx) => {
        if (showTagSpacer && !insertedTagSpacer && seenTagEntryBeforeCurrent && entry && entry.kind === "dir") {
          const spacerEl = document.createElement("div");
          spacerEl.className = "tagSpacerVisualRow";
          spacerEl.setAttribute("aria-hidden", "true");
          spacerEl.innerHTML = `<div class="tagSpacerCell" aria-hidden="true"></div>`;
          frag.appendChild(spacerEl);
          insertedTagSpacer = true;
        }

        const row = document.createElement("div");
        row.className = "dirRow" + (idx === WS.nav.selectedIndex ? " selected" : "");
        row.tabIndex = -1;
        row.dataset.entryIndex = String(idx);
        if (entry.kind === "file") row.dataset.fileId = String(entry.id || "");

        const isTagEntry = entry.kind === "tag";
        const isUpEntry = entry.kind === "up";
        if (isTagEntry) {
          row.classList.add("tagEntry");
          const selectionKey = tagEntrySelectionKey(entry);
          if (selectionKey) row.dataset.bulkAnchor = `tag:${selectionKey}`;
          const sel = canBulk && selectionKey && WS.view.bulkTagFolderSelectedKeys.has(selectionKey);
          if (sel) row.classList.add("bulkSelected");
        }

        const renameActive = isTagEntry && !entry.special && TAG_ENTRY_RENAME_STATE && (
          (entry.placeholder && TAG_ENTRY_RENAME_STATE.placeholder) ||
          (entry.tag && entry.tag === TAG_ENTRY_RENAME_STATE.tag)
        );
        if (isUpEntry) {
          const upLabel = String(entry.label || "Up Directory");
          const upIcon = String(entry.icon || "↩");
          const upMeta = `Back to ${String(entry.parentLabel || "parent folder")}`;
          row.classList.add("folderRow", "folderSquareCard", "upNavRow");
          row.innerHTML = `
            <div class="dirSquareCard">
              <div class="dirSquareMedia">
                <div class="dirSquareFallback">${escapeHtml(upIcon)}</div>
              </div>
              <div class="dirSquareOverlay">
                <div class="dirSquareTop">
                  <span class="dirSquareName" title="${escapeHtml(upLabel)}">${escapeHtml(upLabel)}</span>
                </div>
                <div class="dirSquareBottom">
                  <div class="dirSquareMeta">${escapeHtml(upMeta)}</div>
                </div>
              </div>
            </div>
          `;
        } else if (isTagEntry) {
          const label = String(entry.label || entry.tag || "Tag");
          const labelDisplay = displayTagFolderLabel(label);
          const countNum = Number(entry.count) || 0;
          const countText = getTagEntryCountText(entry);
          const iconText = getTagEntryDisplayIcon(entry);
          const specialText = entry.special
            ? toTitleCaps(String(entry.special || ""))
            : ((entry.album && !entry.tag) ? "Album" : "");
          const tagPool = getRecursivePreviewRecordsForTagEntry(entry, 0);
          const tagThumbKey = tagThumbnailKeyForEntry(entry);
          const tagThumbMode = metaGetTagThumbnailModeByKey(tagThumbKey);
          const presetRec = getTagPresetPreviewRecordForEntry(entry, tagPool);
          const tagAllowsRotation = !naturalThumbCards;
          const tagRotateScope = String(WS.nav.dirNode?.path || "");
          const tagRotateKey = entry.special
            ? `tag:${tagRotateScope}:special:${entry.special}`
            : (entry.album && !entry.tag)
              ? `tag:${tagRotateScope}:album:${String(entry.album || "")}`
            : `tag:${tagRotateScope}:name:${String(entry.tag || "")}`;
          let squareMediaHtml = `<div class="dirSquareFallback">${escapeHtml(iconText)}</div>`;
          if (tagThumbMode !== "none") {
            if (presetRec) {
              const previewId = String(presetRec.id || "");
              if (presetRec.type === "video" && !presetRec.videoThumbUrl) enqueueVideoThumb(presetRec);
              const previewSrc = presetRec.type === "video"
                ? getVideoPosterForRecord(presetRec)
                : (ensureThumbUrl(presetRec) || "");
              const previewAspect = getPreviewAspectForRecord(presetRec);
              if (previewSrc) {
                const cropStyle = fileThumbCropLayoutStyle(presetRec, "");
                const cropClass = cropStyle ? " thumbCropApplied thumbCropAbsolute" : "";
                squareMediaHtml = `<img class="dirInlinePreview dirTagSingleThumb${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
              }
            } else if (tagAllowsRotation && tagThumbMode === "single" && tagPool.length) {
              const singleKey = `${tagRotateKey}:single`;
              const rec = pickRotatingPreviewRecordForKey(singleKey, tagPool);
              if (rec) {
                const previewId = String(rec.id || "");
                if (rec.type === "video" && !rec.videoThumbUrl) enqueueVideoThumb(rec);
                const previewSrc = rec.type === "video"
                  ? getVideoPosterForRecord(rec)
                  : (ensureThumbUrl(rec) || "");
                const previewAspect = getPreviewAspectForRecord(rec);
                if (previewSrc) {
                  squareMediaHtml = `<img class="dirInlinePreview dirTagSingleThumb" data-rotate-key="${escapeHtml(singleKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                }
              }
            } else if (tagAllowsRotation && tagThumbMode === "quad" && tagPool.length) {
              if (tagPool.length < 4) {
                const singleKey = `${tagRotateKey}:single-fallback`;
                const rec = pickRotatingPreviewRecordForKey(singleKey, tagPool);
                if (rec) {
                  const previewId = String(rec.id || "");
                  if (rec.type === "video" && !rec.videoThumbUrl) enqueueVideoThumb(rec);
                  const previewSrc = rec.type === "video"
                    ? getVideoPosterForRecord(rec)
                    : (ensureThumbUrl(rec) || "");
                  const previewAspect = getPreviewAspectForRecord(rec);
                  if (previewSrc) {
                    squareMediaHtml = `<img class="dirInlinePreview dirTagSingleThumb" data-rotate-key="${escapeHtml(singleKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                  }
                }
              } else {
                const quadSlots = pickRotatingPreviewSlotsForKey(tagRotateKey, tagPool, 4);
                if (quadSlots.length) {
                  const quadHtml = [];
                  for (let i = 0; i < quadSlots.length; i++) {
                    const slot = quadSlots[i];
                    const rec = slot && slot.rec ? slot.rec : null;
                    if (!rec) {
                      quadHtml.push(`<div class="dirTagQuadCell"><div class="dirSquareFallback">${escapeHtml(iconText)}</div></div>`);
                      continue;
                    }
                    const previewId = String(rec.id || "");
                    if (rec.type === "video" && !rec.videoThumbUrl) enqueueVideoThumb(rec);
                    const previewSrc = rec.type === "video"
                      ? getVideoPosterForRecord(rec)
                      : (ensureThumbUrl(rec) || "");
                    const previewAspect = getPreviewAspectForRecord(rec);
                    if (!previewSrc) {
                      quadHtml.push(`<div class="dirTagQuadCell"><div class="dirSquareFallback">${escapeHtml(iconText)}</div></div>`);
                      continue;
                    }
                    quadHtml.push(
                      `<div class="dirTagQuadCell"><img class="dirInlinePreview dirTagQuadThumb" data-rotate-key="${escapeHtml(String(slot.key || ""))}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" /></div>`
                    );
                  }
                  if (quadHtml.length) {
                    squareMediaHtml = `<div class="dirTagQuadGrid">${quadHtml.join("")}</div>`;
                  }
                }
              }
            }
          }
          const canOpenTagMenu = !entry.placeholder && !!tagThumbKey && countNum > 0;
          const tagMenuHtml = `
            <div class="dirMenu dirTagMenu">
              <button class="dirMenuBtn" title="Tag menu"${canOpenTagMenu ? "" : " disabled"}>⋯</button>
            </div>
          `;
          const tagTitleClass = entry.special === "favorites"
            ? "dirSquareNameTagFavorite"
            : ((entry.album && !entry.tag) ? "dirSquareNameTagAlbum" : "dirSquareNameTag");
          const topNameHtml = renameActive
            ? `<input class="tagEditInput tagEntryRenameInput renameEditInput dirSquareRenameInput" type="text" value="${escapeHtml(TAG_ENTRY_RENAME_STATE.label || label)}" placeholder="${escapeHtml(label)}" />`
            : `<span class="dirSquareName ${tagTitleClass}" title="${escapeHtml(labelDisplay)}">${escapeHtml(labelDisplay)}</span>`;
          const typeIconHtml = `<span class="dirSquareTypeIcon" title="Tag folder type">${escapeHtml(iconText)}</span>`;
          const specialBadgeHtml = specialText ? `<span class="dirTagKindBadge">${escapeHtml(specialText)}</span>` : "";
          const tagCardStyle = (naturalThumbCards && presetRec)
            ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(presetRec)).toFixed(4)};"`
            : "";

          row.classList.add("folderRow", "folderSquareCard");
          row.innerHTML = `
            <div class="dirSquareCard"${tagCardStyle}>
              <div class="dirSquareMedia">${squareMediaHtml}</div>
              <div class="dirSquareOverlay">
                <div class="dirSquareTop">
                  ${topNameHtml}
                </div>
                <div class="dirSquareBottom">
                  <div class="dirSquareMeta">${escapeHtml(countText)}</div>
                  <div class="dirSquareRightMeta">
                    ${typeIconHtml}
                    ${specialBadgeHtml}
                    ${tagMenuHtml}
                  </div>
                </div>
              </div>
            </div>
          `;
        } else {
          row.dataset.bulkAnchor = `file:${String(entry.id || "")}`;
          const dirPath = entry.kind === "dir" ? String(entry?.node?.path || "") : "";
          const isRenameEditingDir = entry.kind === "dir"
            && RENAME_EDIT_PATH !== null
            && String(RENAME_EDIT_PATH) === dirPath;
          const isTagEditingDir = entry.kind === "dir"
            && TAG_EDIT_PATH !== null
            && String(TAG_EDIT_PATH) === dirPath;
          let icon = "📁";
          let name = "";
          let nameHtml = "";
          let voteHtml = "";
          let thumbHtml = "";
          let rightHtml = "";
          let fileMenuHtml = "";
          let folderSquareCardHtml = "";

          if (entry.kind === "dir") {
            row.dataset.dirPath = entry.node?.path || "";
            const p = entry.node?.path || "";
            row.dataset.bulkAnchor = `dir:${p}`;
            const isFavorite = metaHasFavorite(p);
            const isHidden = metaHasHidden(p);
            const processingDisabled = isPathOrAncestorProcessingDisabled(p);
            const sel = canBulk && WS.view.bulkTagSelectedPaths.has(p);
            if (sel) row.classList.add("bulkSelected");
            const canRename = !!WS.meta.fsRootHandle;
            const canBatchIndex = !!WS.meta.fsRootHandle;
            const canResetOrder = !!entry.node?.preserveOrder;
            icon = "📁";
            name = dirDisplayName(entry.node);
            const dirMetaLines = [];
            if (showFolderItemCount) dirMetaLines.push(`${dirItemCount(entry.node)} items`);
            if (showFolderSize) dirMetaLines.push(formatBytes(dirSizeByPath.get(String(p || "")) || 0));
            const statusBadges = [];
            if (isFavorite) statusBadges.push(`<span class="dirFavoriteHeart dirStatusBadge" title="Favorite">♥</span>`);
            if (isHidden) statusBadges.push(`<span class="dirHiddenBadge dirStatusBadge" title="Hidden">🙈</span>`);
            const statusBadgeHtml = statusBadges.length ? `<span class="dirStatusBadges">${statusBadges.join("")}</span>` : "";
            let inlinePreviewHtml = "";
            const leadInfo = getDisplayLeadPreviewForDir(entry.node, "dir");
            const firstRec = leadInfo.record;
            const rotateKey = leadInfo.rotateKey;
            if (firstRec) {
              const previewId = String(firstRec.id || "");
              const previewSrc = (firstRec.type === "video")
                ? getVideoPosterForRecord(firstRec)
                : (ensureThumbUrl(firstRec) || "");
              const previewAspect = getPreviewAspectForRecord(firstRec);
              if (firstRec.type === "video" && !firstRec.videoThumbUrl) enqueueVideoThumb(firstRec);
              if (previewSrc) {
                const rotateAttr = rotateKey ? ` data-rotate-key="${escapeHtml(rotateKey)}"` : "";
                const cropStyle = fileThumbCropLayoutStyle(firstRec, rotateKey);
                const cropClass = cropStyle ? " thumbCropApplied thumbCropAbsolute" : "";
                inlinePreviewHtml = `<img class="dirInlinePreview${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}"${rotateAttr} src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
              }
            }
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
            const isRootNode = entry.node === WS.root;
            const menuPathKey = isRootNode ? "__root__" : p;
            const menuOpen = WS.view.dirActionMenuPath === menuPathKey;
            const folderThumbMode = isRootNode ? getRootThumbnailMode() : metaGetFolderThumbnailMode(p);
            const allowRotatingThumbnails = !naturalThumbCards;
            const canToggleFolderThumbMode = isRootNode ? true : folderEligibleForParentThumbnailPreset(entry.node);
            const hasThumbPreset = isRootNode ? rootThumbnailHasPreset() : metaHasFolderThumbnailPreset(p);
            const showUseDefaultThumbnail = hasThumbPreset || (isRootNode && folderThumbMode !== "quad");
            const showSetNoThumbnail = canToggleFolderThumbMode && folderThumbMode !== "none";
            const showSetRotatingThumbnail = allowRotatingThumbnails && canToggleFolderThumbMode && (isRootNode ? (folderThumbMode !== "single" || hasThumbPreset) : folderThumbMode !== "rotate");
            const showSetQuadThumbnail = allowRotatingThumbnails && canToggleFolderThumbMode && isRootNode && folderThumbMode !== "quad";
            // Menu (three dot / ⋯) for single-folder actions.
            let menuButtons = "";
            let menuTitle = "Folder menu";
            if (isRootNode) {
              menuButtons = `
                ${showUseDefaultThumbnail ? `<button type="button" data-action="thumbnail-default">Use default thumbnail</button>` : ``}
                ${showSetNoThumbnail ? `<button type="button" data-action="thumbnail-none">No thumbnail</button>` : ``}
                ${showSetRotatingThumbnail ? `<button type="button" data-action="thumbnail-rotate">Use rotating thumbnail</button>` : ``}
                ${showSetQuadThumbnail ? `<button type="button" data-action="thumbnail-quad">Use quad thumbnail</button>` : ``}
              `;
            } else {
              menuButtons = `
                <div class="scoreRow">
                  <button type="button" class="scoreBtn" data-action="score-up">+</button>
                  <button type="button" class="scoreBtn" data-action="score-down">-</button>
                </div>
                <div class="menuTwoColRow">
                  <button type="button" data-action="tag">Tag</button>
                  <button type="button" data-action="rename"${canRename ? "" : " disabled"}>Rename</button>
                </div>
                <div class="menuTwoColRow">
                  <button type="button" data-action="favorite">${isFavorite ? "Unfavorite" : "Favorite"}</button>
                  <button type="button" data-action="hidden">${isHidden ? "Unhide" : "Hide"}</button>
                </div>
                <div class="menuTwoColRow">
                  <button type="button" data-action="batch-index-1"${canBatchIndex ? "" : " disabled"}>Index 1</button>
                  <button type="button" data-action="batch-index-2"${canBatchIndex ? "" : " disabled"}>Index 2</button>
                </div>
                <button type="button" data-action="processing-toggle">${processingDisabled ? "Enable Processing" : "Disable Processing"}</button>
                ${canResetOrder ? `<button type="button" data-action="reset-order">Reset order</button>` : ``}
                ${showUseDefaultThumbnail ? `<button type="button" data-action="thumbnail-default">Use default thumbnail</button>` : ``}
                ${showSetNoThumbnail ? `<button type="button" data-action="thumbnail-none">No thumbnail</button>` : ``}
                ${showSetRotatingThumbnail ? `<button type="button" data-action="thumbnail-rotate">Use rotating thumbnail</button>` : ``}
                ${showSetQuadThumbnail ? `<button type="button" data-action="thumbnail-quad">Use quad thumbnail</button>` : ``}
              `;
            }
            const menuHtml = `
              <div class="dirMenu">
              <button class="dirMenuBtn" title="${escapeHtml(menuTitle)}">⋯</button>
              <div class="dropdownMenu${menuOpen ? " open" : ""}">
                ${menuButtons}
              </div>
            </div>
            `;
            const metaInlineHtml = dirMetaLines.length
              ? `<div class="dirMetaInline">${dirMetaLines.map(line => `<div class="dirMetaInlineLine">${escapeHtml(line)}</div>`).join("")}</div>`
              : "";
            nameHtml = `
              <div class="dirNameStack">
                <div class="dirNameTop">
                  <span class="dirNameText">${escapeHtml(name)}</span>
                  ${voteHtml}
                  ${statusBadgeHtml}
                </div>
                ${metaInlineHtml}
              </div>
            `;
            const thumbSlotHtml = inlinePreviewHtml ? `<div class="dirThumbSlot">${inlinePreviewHtml}</div>` : "";
            thumbHtml = "";
            rightHtml = `<div class="dirRight dirFolderActions">${thumbSlotHtml}${menuHtml}</div>`;
            if (folderSquareCardMode) {
              const scoreInlineHtml = scoreMode !== "hidden"
                ? `<span class="dirSquareScore" title="Score">${escapeHtml(String(sc))}</span>`
                : "";
              const isRootPortalCard = WS.view.aboveRootView && entry.node === WS.root;
              let squareAspectRec = firstRec || null;
              let rootPortalMediaHtml = "";
              if (isRootPortalCard) {
                const rootPool = getRecursivePreviewRecordsForDir(entry.node, 0, true);
                const rootMode = getRootThumbnailMode();
                const rootPresetRec = getRootPresetPreviewRecord(entry.node, rootPool);
                const rootScope = String(WS.meta.storageKey || "workspace");
                if (rootMode !== "none") {
                  if (rootPresetRec) {
                    squareAspectRec = rootPresetRec;
                    const previewId = String(rootPresetRec.id || "");
                    if (rootPresetRec.type === "video" && !rootPresetRec.videoThumbUrl) enqueueVideoThumb(rootPresetRec);
                    const previewSrc = rootPresetRec.type === "video"
                      ? getVideoPosterForRecord(rootPresetRec)
                      : (ensureThumbUrl(rootPresetRec) || "");
                    const previewAspect = getPreviewAspectForRecord(rootPresetRec);
                    if (previewSrc) {
                      const cropStyle = fileThumbCropLayoutStyle(rootPresetRec, "");
                      const cropClass = cropStyle ? " thumbCropApplied thumbCropAbsolute" : "";
                      rootPortalMediaHtml = `<img class="dirInlinePreview dirTagSingleThumb${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
                    }
                  } else if (!naturalThumbCards && rootMode === "single" && rootPool.length) {
                    const singleKey = `root:${rootScope}:single`;
                    const rec = pickRotatingPreviewRecordForKey(singleKey, rootPool);
                    if (rec) {
                      squareAspectRec = rec;
                      const previewId = String(rec.id || "");
                      if (rec.type === "video" && !rec.videoThumbUrl) enqueueVideoThumb(rec);
                      const previewSrc = rec.type === "video"
                        ? getVideoPosterForRecord(rec)
                        : (ensureThumbUrl(rec) || "");
                      const previewAspect = getPreviewAspectForRecord(rec);
                      if (previewSrc) {
                        rootPortalMediaHtml = `<img class="dirInlinePreview dirTagSingleThumb" data-rotate-key="${escapeHtml(singleKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                      }
                    }
                  } else if (!naturalThumbCards && rootMode === "quad" && rootPool.length) {
                    if (rootPool.length < 4) {
                      const singleKey = `root:${rootScope}:single-fallback`;
                      const rec = pickRotatingPreviewRecordForKey(singleKey, rootPool);
                      if (rec) {
                        squareAspectRec = rec;
                        const previewId = String(rec.id || "");
                        if (rec.type === "video" && !rec.videoThumbUrl) enqueueVideoThumb(rec);
                        const previewSrc = rec.type === "video"
                          ? getVideoPosterForRecord(rec)
                          : (ensureThumbUrl(rec) || "");
                        const previewAspect = getPreviewAspectForRecord(rec);
                        if (previewSrc) {
                          rootPortalMediaHtml = `<img class="dirInlinePreview dirTagSingleThumb" data-rotate-key="${escapeHtml(singleKey)}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" />`;
                        }
                      }
                    } else {
                      const rootQuadKey = `root:${rootScope}:quad`;
                      const rootSlots = pickRotatingPreviewSlotsForKey(rootQuadKey, rootPool, 4);
                      if (rootSlots.length) {
                        const quadHtml = [];
                        for (let i = 0; i < rootSlots.length; i++) {
                          const slot = rootSlots[i];
                          const slotRec = slot && slot.rec ? slot.rec : null;
                          if (!slotRec) {
                            quadHtml.push(`<div class="dirTagQuadCell"><div class="dirSquareFallback">📁</div></div>`);
                            continue;
                          }
                          const previewId = String(slotRec.id || "");
                          if (slotRec.type === "video" && !slotRec.videoThumbUrl) enqueueVideoThumb(slotRec);
                          const previewSrc = slotRec.type === "video"
                            ? getVideoPosterForRecord(slotRec)
                            : (ensureThumbUrl(slotRec) || "");
                          const previewAspect = getPreviewAspectForRecord(slotRec);
                          if (!previewSrc) {
                            quadHtml.push(`<div class="dirTagQuadCell"><div class="dirSquareFallback">📁</div></div>`);
                            continue;
                          }
                          if (!squareAspectRec) squareAspectRec = slotRec;
                          quadHtml.push(
                            `<div class="dirTagQuadCell"><img class="dirInlinePreview dirTagQuadThumb" data-rotate-key="${escapeHtml(String(slot.key || ""))}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};" /></div>`
                          );
                        }
                        if (quadHtml.length) rootPortalMediaHtml = `<div class="dirTagQuadGrid">${quadHtml.join("")}</div>`;
                      }
                    }
                  }
                }
              }
              const squareMediaHtml = rootPortalMediaHtml || inlinePreviewHtml || `<div class="dirSquareFallback">📁</div>`;
              const squareCardStyle = (naturalThumbCards && squareAspectRec)
                ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(squareAspectRec)).toFixed(4)};"`
                : "";
              const metaSummary = dirMetaLines.join(" • ");
              const squareMetaHtml = `<div class="dirSquareMeta">${escapeHtml(metaSummary)}</div>`;
              const topNameHtml = isRenameEditingDir
                ? `<input class="tagEditInput renameEditInput dirSquareRenameInput" type="text" value="${escapeHtml(String(entry.node?.name || ""))}" placeholder="folder name" />`
                : isTagEditingDir
                  ? `<input class="tagEditInput dirSquareRenameInput" type="text" value="${escapeHtml(metaGetUserTags(p).join(", "))}" placeholder="tag1, tag2" />`
                  : `<span class="dirSquareName" title="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
              const squareRightMetaHtml = `
                <div class="dirSquareRightMeta">
                  ${scoreInlineHtml}
                  ${statusBadgeHtml}
                  ${menuHtml}
                </div>
              `;
              folderSquareCardHtml = `
                <div class="dirSquareCard"${squareCardStyle}>
                  <div class="dirSquareMedia">${squareMediaHtml}</div>
                  <div class="dirSquareOverlay">
                    <div class="dirSquareTop">
                      ${topNameHtml}
                    </div>
                    <div class="dirSquareBottom">
                      ${squareMetaHtml}
                      ${squareRightMetaHtml}
                    </div>
                  </div>
                </div>
              `;
            }
          } else {
            const rec = WS.fileById.get(entry.id);
            const isVid = rec?.type === "video";
            const sel = canBulk && WS.view.bulkFileSelectedIds.has(String(entry.id || ""));
            if (sel) row.classList.add("bulkSelected");
            icon = isVid ? "🎞" : "🖼";
            name = fileDisplayNameForRecord(rec);
            const fileMenuOpen = WS.view.fileActionMenuId === String(entry.id || "");
            const bulkFileMenuActive = canBulk && sel && selectedFilesInViewCount > 0;
            const canLooseSetMerge = !!WS.meta.fsRootHandle;
            const folderThumbTargets = rec ? getFolderThumbnailTargetsForRecord(rec) : [];
            const tagThumbTargets = rec ? getTagThumbnailTargetsForRecord(rec) : [];
            const folderThumbButtonsHtml = folderThumbTargets.map((t) => {
              const label = String(t && (t.actionLabel || t.label) || "");
              const path = String(t && t.path || "");
              if (!label && path !== "") return "";
              return `<button type="button" data-action="${escapeHtml(folderThumbnailActionForPath(path))}">${escapeHtml(label || "Set thumbnail")}</button>`;
            }).join("");
            const tagThumbButtonsHtml = tagThumbTargets.map((t) => {
              const label = String(t && (t.actionLabel || t.label) || "");
              const key = String(t && t.key || "");
              if (!label || !key) return "";
              return `<button type="button" data-action="${escapeHtml(tagThumbnailActionForKey(key))}">${escapeHtml(label)}</button>`;
            }).join("");
            const fileMenuButtons = bulkFileMenuActive
              ? `<button type="button" data-action="loose-set-merge"${canLooseSetMerge ? "" : " disabled"}>Loose Set Merge</button>`
              : `
                  ${folderThumbButtonsHtml}
                  ${tagThumbButtonsHtml}
                  <button type="button" data-action="edit-thumbnail">Edit thumbnail</button>
                  <button type="button" data-action="rename-file">Rename</button>
                `;
            const fileTypeLabel = toTitleCaps(String(rec?.type || (isVid ? "video" : "image")));
            const fileSizeLabel = formatBytes(Math.max(0, Number(rec?.size) || 0));
            fileMenuHtml = `
              <div class="dirMenu dirFileMenu">
                <button class="dirMenuBtn" title="File menu">⋯</button>
                <div class="dropdownMenu${fileMenuOpen ? " open" : ""}">
                  ${fileMenuButtons}
                </div>
              </div>
            `;
            let inlinePreviewHtml = "";
            if (rec) {
              const previewId = String(rec.id || "");
              const previewSrc = isVid
                ? getVideoPosterForRecord(rec)
                : (ensureThumbUrl(rec) || "");
              const previewAspect = getPreviewAspectForRecord(rec);
              if (isVid && !rec.videoThumbUrl) enqueueVideoThumb(rec);
              if (previewSrc) {
                const cropStyle = fileThumbCropLayoutStyle(rec, "");
                const cropClass = cropStyle ? " thumbCropApplied thumbCropAbsolute" : "";
                inlinePreviewHtml = `<img class="dirInlinePreview${cropClass}" data-dir-preview-id="${escapeHtml(previewId)}" src="${escapeHtml(previewSrc)}" alt="" style="--dir-inline-ar:${Number(previewAspect).toFixed(4)};${cropStyle}" />`;
              }
            }
            const fileMediaHtml = inlinePreviewHtml
              ? inlinePreviewHtml
              : `<div class="dirSquareFallback">${escapeHtml(icon)}</div>`;
            const fileTypeHtml = showDirFileTypeLabel ? `<span class="dirFileType">${escapeHtml(fileTypeLabel)}</span>` : "";
            const fileMetaBits = [];
            if (fileTypeHtml) fileMetaBits.push(fileTypeHtml);
            fileMetaBits.push(`<span class="dirFileSize">${escapeHtml(fileSizeLabel)}</span>`);
            const fileCardStyle = (naturalThumbCards && rec)
              ? ` style="--dir-card-ar:${Number(getPreviewAspectForRecord(rec)).toFixed(4)};"`
              : "";
            const fileThumbHtml = `
              <div class="dirThumbSlot dirFileThumbSlot">
                <div class="dirFileThumbCard"${fileCardStyle}>
                  ${fileMediaHtml}
                  <div class="dirFileOverlay">
                    <div class="dirFileOverlayTop">
                      <span class="dirFileNameText" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                    </div>
                    <div class="dirFileOverlayBottom">
                      <div class="dirFileMetaLine">${fileMetaBits.join('<span class="dirFileMetaDot">•</span>')}</div>
                      ${fileMenuHtml}
                    </div>
                  </div>
                </div>
              </div>
            `;
            nameHtml = `
              <div class="dirFileStack">
                ${fileThumbHtml}
              </div>
            `;
            rightHtml = "";
          }

          if (entry.kind === "dir") {
            row.classList.add("folderRow");
            if (folderSquareCardMode && folderSquareCardHtml) {
              row.classList.add("folderSquareCard");
              row.innerHTML = folderSquareCardHtml;
            } else {
              row.innerHTML = `
                <div class="dirIcon">${icon}</div>
                <div class="dirName dirNameWithBadge" title="${escapeHtml(name)}">${nameHtml}</div>
                ${thumbHtml}
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
                ${fileMenuHtml}
              `;
            } else {
              row.classList.add("fileRow");
              row.innerHTML = `
                <div class="dirName dirFileNameWrap" title="${escapeHtml(name)}">${nameHtml}</div>
              `;
            }
          }
        }

        if (isTagEntry && !entry.placeholder && Number(entry.count || 0) > 0) {
          row.addEventListener("contextmenu", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const selectionKey = tagEntrySelectionKey(entry);
            if (selectionKey && openBulkActionMenuForSelection(`tag:${selectionKey}`)) return;
            const dirs = getDirsForTagEntry(entry);
            const paths = gatherTagPathsForDirs(dirs);
            const tagKey = tagThumbnailKeyForEntry(entry);
            openTagContextMenu({
              tag: String(entry.tag || ""),
              album: String(entry.album || ""),
              tagKey,
              special: entry.special || "",
              label: String(entry.label || entry.tag || ""),
              anchor: row,
              paths
            });
          });
          const tagMenuBtn = row.querySelector(".dirTagMenu .dirMenuBtn");
          if (tagMenuBtn) {
            tagMenuBtn.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const selectionKey = tagEntrySelectionKey(entry);
              if (selectionKey && openBulkActionMenuForSelection(`tag:${selectionKey}`)) return;
              const dirs = getDirsForTagEntry(entry);
              const paths = gatherTagPathsForDirs(dirs);
              const tagKey = tagThumbnailKeyForEntry(entry);
              openTagContextMenu({
                tag: String(entry.tag || ""),
                album: String(entry.album || ""),
                tagKey,
                special: entry.special || "",
                label: String(entry.label || entry.tag || ""),
                anchor: tagMenuBtn,
                paths
              });
            });
          }
        }

        if (isTagEntry && renameActive) {
          const renameInput = row.querySelector(".tagEntryRenameInput");
          if (renameInput) {
            let commitRequested = false;
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
                commitRequested = true;
                commitTagEntryRename(renameInput);
              }
            });
            renameInput.addEventListener("blur", () => {
              if (commitRequested) {
                commitRequested = false;
                return;
              }
              cancelTagEntryRename();
            });
          }
        }

        row.addEventListener("click", (e) => {
          closeActionMenus();
          const priorSelectedIndex = WS.nav.selectedIndex;
          const isCmdOrCtrl = eventCmdOrCtrlHeld(e);
          const isShift = eventShiftHeld(e);
          if (entry.kind === "up") {
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx, { keepScroll: true });
            return;
          }
          if (!isShift && !isCmdOrCtrl && idx === WS.nav.selectedIndex) {
            if (teleportFromRotatingThumbnail(entry, row)) return;
          }
          if (isShift && isCmdOrCtrl) {
            const anchor = WS.view.dirSelectAnchorIndex >= 0 ? WS.view.dirSelectAnchorIndex : priorSelectedIndex;
            if (!WS.view.bulkSelectMode) includeCurrentSelectionInBulkSet(idx);
            addEntrySelectionRange(anchor, idx, false);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx, { keepScroll: true });
            return;
          }
          if (isShift) {
            const anchor = WS.view.dirSelectAnchorIndex >= 0 ? WS.view.dirSelectAnchorIndex : priorSelectedIndex;
            selectEntryRange(anchor, idx);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx);
            return;
          }
          if (isCmdOrCtrl) {
            if (!WS.view.bulkSelectMode) includeCurrentSelectionInBulkSet(idx);
            WS.view.bulkSelectMode = true;
            toggleEntrySelection(entry);
            WS.view.dirSelectAnchorIndex = idx;
            setDirectoriesSelection(idx, { keepScroll: true });
            return;
          }

          if (WS.view.bulkSelectMode && (
            WS.view.bulkTagSelectedPaths.size ||
            WS.view.bulkTagFolderSelectedKeys.size ||
            WS.view.bulkFileSelectedIds.size
          )) {
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
              const menuPathKey = (entry.node === WS.root) ? "__root__" : p;
              if (p && openBulkActionMenuForSelection(`dir:${p}`)) return;
              if (WS.view.dirActionMenuPath === menuPathKey) {
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
              btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                closeActionMenus();
                renderDirectoriesPane(true);
                await runFolderActionFromMenu(action, entry.node);
              });
            });
            if (menuDropdown.classList.contains("open")) {
              requestAnimationFrame(() => positionDropdownMenu(menuBtn || row, menuDropdown));
            }
          }

          const renameInput = row.querySelector(".renameEditInput");
          if (renameInput) {
            let commitRequested = false;
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
                commitRequested = true;
                commitRenameEdit(p, renameInput);
                return;
              }
            });
            renameInput.addEventListener("blur", () => {
              if (commitRequested) {
                commitRequested = false;
                return;
              }
              RENAME_EDIT_PATH = null;
              closeActionMenus();
              renderDirectoriesPane(true);
            });
          }

          const input = row.querySelector(".tagEditInput:not(.renameEditInput)");
          if (input) {
            let commitRequested = false;
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
                commitRequested = true;
                const tags = normalizeTagsFromText(input.value || "");
                metaSetUserTags(p, tags);
                return;
              }
            });
            input.addEventListener("blur", () => {
              if (commitRequested) {
                commitRequested = false;
                return;
              }
              TAG_EDIT_PATH = null;
              closeActionMenus();
              renderDirectoriesPane(true);
            });
          }
        } else if (entry.kind === "file") {
          const iconEl = row.querySelector(".dirIcon");
          if (iconEl) {
            const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();
            const id = String(entry.id || "");
            const sel = canBulk && WS.view.bulkFileSelectedIds.has(id);
            if (canBulk) {
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
              const id = String(entry.id || "");
              if (!id) return;
              if (WS.view.fileActionMenuId === id && !WS.view.bulkActionMenuOpen) {
                closeActionMenus();
                renderDirectoriesPane(true);
                return;
              }
              openFileMenuForId(id);
            });
          }

          const menuDropdown = row.querySelector(".dirMenu .dropdownMenu");
          if (menuDropdown) {
            menuDropdown.addEventListener("click", (e) => e.stopPropagation());
            const actionButtons = Array.from(menuDropdown.querySelectorAll("button[data-action]"));
            actionButtons.forEach((btn) => {
              btn.addEventListener("click", async (e) => {
                e.stopPropagation();
                const action = btn.getAttribute("data-action");
                closeActionMenus();
                renderDirectoriesPane(true);
                await runFileActionFromMenu(String(action || ""), String(entry.id || ""), row);
              });
            });
            if (menuDropdown.classList.contains("open")) {
              requestAnimationFrame(() => positionDropdownMenu(menuBtn, menuDropdown));
            }
          }

          const renameInput = row.querySelector(".renameEditInput");
          if (renameInput) {
            let commitRequested = false;
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
                commitRequested = true;
                commitFileRenameEdit(entry.id, renameInput);
                return;
              }
            });
            renameInput.addEventListener("blur", () => {
              if (commitRequested) {
                commitRequested = false;
                return;
              }
              RENAME_EDIT_FILE_ID = null;
              closeActionMenus();
              renderDirectoriesPane(true);
            });
          }

          const fileId = String(entry.id || "");
          if (canReorderGridFileEntries
            && fileId
            && String(RENAME_EDIT_FILE_ID || "") !== fileId) {
            setupDirectoriesGridFileDragSource(row, WS.nav.dirNode || null, visibleFileIdsForGridReorder);
          }
        }

        if (isTagEntry) seenTagEntryBeforeCurrent = true;
        frag.appendChild(row);
      });

      directoriesListEl.appendChild(frag);
      invalidateGridRowMetricsCache();
      if (naturalThumbCards) syncDirectoryInlineAspectForRenderedImages();
      if (gridModeActive) scheduleGridModeCardSizing();
      updateGridModeListTopInset();
      renderDirectoriesActionHeader();

      const shouldCenter = WS.view.pendingDirScroll === "center-selected";
      const shouldGridReveal = WS.view.pendingDirScroll === "grid-nearest";
      if (shouldCenter) WS.view.pendingDirScroll = "";
      if (shouldGridReveal) WS.view.pendingDirScroll = "";

      if (preserveScroll) {
        directoriesListEl.scrollTop = prevScroll;
      } else if (gridModeActive && contextChanged) {
        // New folder context in Grid Mode should always spawn at the content top.
        directoriesListEl.scrollTop = 0;
        directoriesListEl.scrollLeft = 0;
      } else if (spawnUnderControls) {
        // When entering a new context that starts with tag/special rows, always spawn at the
        // resting top-of-list position so those rows appear directly under the controls.
        directoriesListEl.scrollTop = 0;
      }

      if (shouldCenter) {
        if (gridModeActive) revealSelectedDirectoryRowInGridMode(true);
        else centerSelectedDirectoryRow(0, prevSelectedRowCenterOffset);
      } else if (gridModeActive && shouldGridReveal) {
        revealSelectedDirectoryRowInGridMode(false);
      } else {
        const vis = getSelectedDirectoryRowVisibility();
        if (vis.state === "offscreen") {
          // If selection is fully off-screen, jump to centered "read head" position.
          centerSelectedDirectoryRow(0);
        } else if (vis.state === "partial") {
          // If selection is clipped, jump immediately so it is fully visible.
          snapSelectedDirectoryRowFullyIntoView();
        }
      }

      LAST_DIRECTORIES_SCROLL_CONTEXT = nextContextKey;

      if (gridModeActive) {
        if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
        return;
      }

      if (preserveScroll && !shouldCenter) {
        scheduleSelectedDirectoryRowReconcile(filesOnlyModeChanged ? 260 : 0, false, filesOnlyModeChanged);
        if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
        return;
      }
      scheduleSelectedDirectoryRowReconcile(filesOnlyModeChanged ? 260 : 0, false, filesOnlyModeChanged);
      if (TAG_ENTRY_RENAME_STATE) focusTagEntryRenameInput();
    }

    // Legacy loop-repeat-on-scroll behavior was removed to avoid first/last adjacency in item lists.

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
        if (VIEWER_MODE) {
          hideOverlay();
          return;
        }
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
      if (target.closest(".folderCard")) return false;
      if (target.closest(".dirMenu")) return false;
      if (target.closest(".dropdownMenu")) return false;
      if (target.closest("#directoriesActionRow")) return false;
      if (target.closest("#directoriesBulkRow")) return false;
      if (target.closest("#directoriesSearchRow")) return false;
      if (target.closest("#directoriesTagsRow")) return false;
      if (target.closest("#previewActionMenu")) return false;
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

    function isTextFieldElement(el) {
      if (!el || !el.tagName) return false;
      const tag = String(el.tagName || "").toUpperCase();
      if (tag === "TEXTAREA") return true;
      if (tag !== "INPUT") return !!el.isContentEditable;
      const type = String(el.type || "text").toLowerCase();
      return (
        type === "text" ||
        type === "search" ||
        type === "url" ||
        type === "email" ||
        type === "number" ||
        type === "tel" ||
        type === "password"
      );
    }

    document.addEventListener("pointerdown", (e) => {
      const active = document.activeElement;
      if (!isTextFieldElement(active)) return;
      const target = e.target;
      if (target === active) return;
      if (active && active.contains && active.contains(target)) return;
      try { active.blur(); } catch {}
    }, true);

    document.addEventListener("click", (e) => {
      const target = e.target;
      if (TAG_CONTEXT_MENU_STATE) {
        if (target && target.closest && target.closest("#tagActionMenu")) {
          return;
        }
        closeTagContextMenu();
      }
      if (previewActionMenuEl && previewActionMenuEl.classList.contains("open")) {
        if (target && target.closest && target.closest("#previewActionMenu")) {
          return;
        }
        closePreviewContextMenu();
      }
      if (exitBulkSelectModeIfNeeded(target)) return;
      const hasActionMenu = WS.view.bulkActionMenuOpen || WS.view.dirActionMenuPath || WS.view.fileActionMenuId;
      const hasPreviewMenu = !!(previewActionMenuEl && previewActionMenuEl.classList.contains("open"));
      if (!hasActionMenu && !hasPreviewMenu) return;
      if (target && target.closest) {
        if (target.closest(".dirMenu")) return;
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

      if (!moved) {
        WS.view.pendingDirScroll = "";
        return;
      }

      renderDirectoriesPane();
      renderPreviewPane(dirChanged);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function canUseFolderJumpActions() {
      if (!WS.root || !WS.nav.dirNode) return false;
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return false;
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return false;
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return false;
      return true;
    }

    function jumpToDirectoryFirstFile(dirNode) {
      if (!dirNode) return false;
      WS.nav.dirNode = dirNode;
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
      return idx >= 0;
    }

    function pickRandomFirstFileJumpTarget(sourceDirNode) {
      if (!sourceDirNode) return null;
      const siblings = getVisibleSiblingDirsForSlide(sourceDirNode);
      const sourcePath = String(sourceDirNode.path || "");
      const eligible = siblings.filter((dir) => {
        if (!dir) return false;
        if (String(dir.path || "") === sourcePath) return false;
        return getOrderedFileIdsForDir(dir).length > 0;
      });
      if (!eligible.length) return null;

      const idx = Math.floor(Math.random() * eligible.length);
      return eligible[idx] || null;
    }

    function jumpToNextFolderFirstFile() {
      if (!canUseFolderJumpActions()) return;
      const nextDir = getNextSiblingDirWithFiles(WS.nav.dirNode);
      if (!nextDir) return;
      jumpToDirectoryFirstFile(nextDir);
    }

    function jumpToPrevFolderFirstFile() {
      if (!canUseFolderJumpActions()) return;
      const prevDir = getPrevSiblingDirWithFiles(WS.nav.dirNode);
      if (!prevDir) return;
      jumpToDirectoryFirstFile(prevDir);
    }

    function randomFirstFileJumpFromDirectories() {
      if (!canUseFolderJumpActions()) {
        showStatusMessage("First File Jump unavailable here.");
        return false;
      }
      const sourceDir = WS.nav.dirNode;
      const targetDir = pickRandomFirstFileJumpTarget(sourceDir);
      if (!targetDir) {
        showStatusMessage("First File Jump: no matching folder.");
        return false;
      }
      const ok = jumpToDirectoryFirstFile(targetDir);
      if (ok) showStatusMessage("First File Jump");
      else showStatusMessage("First File Jump: no files.");
      return ok;
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
      WS.view.aboveRootView = false;
      if (isViewingTagFolder()) {
        const selectedEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
        const selectedPath = (selectedEntry && selectedEntry.kind === "dir")
          ? (selectedEntry.node?.path || "")
          : (node.path || "");
        pushTagViewContext(selectedPath);
        WS.view.tagFolderActiveMode = "";
        WS.view.tagFolderActiveTag = "";
        WS.view.tagFolderActiveAlbum = "";
        WS.view.tagFolderOriginPath = "";
      }

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
      WS.nav.selectedIndex = selectionIndexForDirectoryEnter();
      syncPreviewToSelection();
      renderDirectoriesPane();
      renderPreviewPane(true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function navigateFromPreviewFolderCard(node) {
      if (!node) return;
      const parentNode = node.parent || WS.root || null;
      if (!parentNode || parentNode === node) {
        navigateToDirectory(node);
        return;
      }
      navigateToDirectory(parentNode);
      const selected = selectDirectoryEntryByPath(String(node.path || ""));
      if (!selected) {
        navigateToDirectory(node);
        return;
      }
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
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

    function previewScrollKeyForDir(dirNode) {
      if (!dirNode) return "";
      const p = String(dirNode.path || "");
      return p || "__root__";
    }

    function savePreviewScrollForActiveDir() {
      if (!previewBodyEl) return;
      const key = String(WS.view.previewScrollActiveKey || "");
      if (!key) return;
      if (!previewBodyEl.classList.contains("preview-grid")) return;
      if (!(WS.view.previewScrollByDir instanceof Map)) WS.view.previewScrollByDir = new Map();
      WS.view.previewScrollByDir.set(key, Math.max(0, Number(previewBodyEl.scrollTop) || 0));
    }

    function getSavedPreviewScrollForDir(dirNode) {
      const key = previewScrollKeyForDir(dirNode);
      if (!key || !(WS.view.previewScrollByDir instanceof Map)) return null;
      const val = WS.view.previewScrollByDir.get(key);
      if (!Number.isFinite(val)) return null;
      return Math.max(0, Number(val) || 0);
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
        if (thumbFiltersActive(rec)) {
          if (rec.thumbUrl && rec.thumbMode === "high") return rec.thumbUrl;
          if (rec.thumbUrl && rec.thumbMode && rec.thumbMode !== "high") {
            try { URL.revokeObjectURL(rec.thumbUrl); } catch {}
            rec.thumbUrl = null;
          }
          rec.thumbMode = null;
          enqueueImageThumb(rec);
          return ensureMediaUrl(rec) || null;
        }
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
      if (!rec.file) return null;
      try { rec.url = URL.createObjectURL(rec.file); return rec.url; } catch { return null; }
    }

    function getVideoPosterForRecord(rec) {
      if (rec && rec.videoThumbUrl) return rec.videoThumbUrl;
      return BLACK_POSTER_URL;
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
      const naturalAspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(rec));
      rec.previewAspect = naturalAspect;
      applyDirectoryInlineAspect(imgEl, naturalAspect);
      return true;
    }

    function refreshDirectoryInlinePreviewThumbForRecord(rec) {
      if (!rec || !directoriesEl) return;
      const recId = String(rec.id || "");
      if (!recId) return;
      const src = rec.type === "video"
        ? getVideoPosterForRecord(rec)
        : (ensureThumbUrl(rec) || "");
      if (!src) return;
      const aspect = normalizePreviewAspect(getPreviewAspectForRecord(rec), 4 / 3);
      const imgs = directoriesEl.querySelectorAll(".dirInlinePreview[data-dir-preview-id]");
      for (const img of imgs) {
        if (String(img.dataset.dirPreviewId || "") !== recId) continue;
        if (img.src !== src) img.src = src;
        applyDirectoryInlineAspect(img, aspect);
        if (rec.type === "image" && !syncDirectoryInlineAspectFromNaturalSize(img, rec)) {
          if (img.dataset.dirAspectPending !== "1") {
            img.dataset.dirAspectPending = "1";
            img.addEventListener("load", () => {
              delete img.dataset.dirAspectPending;
              syncDirectoryInlineAspectFromNaturalSize(img, rec);
            }, { once: true });
          }
        }
      }
    }

    function syncDirectoryInlineAspectForRenderedImages() {
      if (!directoriesListEl || !naturalAspectThumbnailCardsEnabled()) return;
      const imgs = directoriesListEl.querySelectorAll(".dirInlinePreview[data-dir-preview-id]");
      for (const img of imgs) {
        const recId = String(img?.dataset?.dirPreviewId || "");
        if (!recId) continue;
        const rec = WS.fileById.get(recId);
        if (!rec || rec.type !== "image") continue;
        if (syncDirectoryInlineAspectFromNaturalSize(img, rec)) continue;
        if (img.dataset.dirAspectPending === "1") continue;
        img.dataset.dirAspectPending = "1";
        img.addEventListener("load", () => {
          delete img.dataset.dirAspectPending;
          syncDirectoryInlineAspectFromNaturalSize(img, rec);
        }, { once: true });
      }
    }

    function applyVideoPoster(videoEl, rec) {
      if (!videoEl) return;
      const poster = getVideoPosterForRecord(rec);
      if (videoEl.poster !== poster) videoEl.poster = poster;
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
      normalizeVideoPlaybackRate(vid);
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
        normalizeVideoPlaybackRate(previewVideoEl);
        previewVideoEl.poster = BLACK_POSTER_URL;
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

    const SCROLL_IMAGE_EXTREME_RATIO = 2.2;
    const TALL_SCROLL_TARGET_ASPECT = 2 / 3;

    function getImageAspectForScrollDetect(rec, imgEl) {
      const naturalW = Number(imgEl?.naturalWidth || 0);
      const naturalH = Number(imgEl?.naturalHeight || 0);
      if (naturalW > 0 && naturalH > 0) {
        return naturalW / naturalH;
      }
      return normalizePreviewAspect(
        rec?.previewAspect || rec?.thumbAspect || rec?.videoAspect || rec?.aspectRatio || rec?.aspect,
        4 / 3
      );
    }

    function detectScrollImageMode(rec, imgEl) {
      if (!betaTallImageScrollDetectEnabled()) return "none";
      if (!rec || rec.type !== "image") return "none";
      if (isGifRecord(rec)) return "none";
      const aspect = getImageAspectForScrollDetect(rec, imgEl);
      if (aspect <= (1 / SCROLL_IMAGE_EXTREME_RATIO)) return "tall";
      if (aspect >= SCROLL_IMAGE_EXTREME_RATIO) return "wide";
      return "none";
    }

    function applyScrollImageMode(containerEl, imgEl, mode, resetScroll = false) {
      const normalizedMode = (mode === "tall" || mode === "wide") ? mode : "none";
      if (containerEl) {
        containerEl.classList.toggle("tallScrollMode", normalizedMode === "tall");
        containerEl.classList.toggle("wideScrollMode", normalizedMode === "wide");

        if (normalizedMode === "tall") {
          const h = Math.max(1, Number(containerEl.clientHeight || 0));
          const w = Math.max(1, Number(containerEl.clientWidth || 0));
          const targetW = Math.max(220, Math.min(w, Math.round(h * TALL_SCROLL_TARGET_ASPECT)));
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

    function scrollImageFallbackCssFilter(rec, mode) {
      if (mode === "none") return "none";
      if (!rec || rec.type !== "image") return "none";
      if (!mediaFilterEnabled()) return "none";
      if (!mediaProcessingEnabledForTarget(rec)) return "none";
      const filterMode = getMediaFilterForType();
      const intensity = getMediaFilterIntensity();
      const baseCfgRaw = (filterMode && filterMode !== "off") ? MEDIA_FILTER_CONFIGS[filterMode] : null;
      const baseCfg = scaleBaseFilterConfig(baseCfgRaw, intensity);
      const colorFilter = baseCfg && baseCfg.color ? String(baseCfg.color) : "none";
      return colorFilter && colorFilter !== "none" ? colorFilter : "none";
    }

    function applyScrollImageProcessingFallback(imgEl, rec, mode) {
      if (!imgEl) return;
      const cssFilter = scrollImageFallbackCssFilter(rec, mode);
      if (cssFilter && cssFilter !== "none") {
        imgEl.style.filter = cssFilter;
      } else {
        imgEl.style.removeProperty("filter");
      }
    }

    function renderPreviewViewerItem(idx) {
      ensurePreviewFileElements();
      applyScrollImageMode(previewViewportBox, previewImgEl, "none");

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
        if (!willShowVideo) {
          previewVideoEl.style.display = "none";
          applyVideoCropToElement(previewVideoEl, null);
        }
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
        name.textContent = dirDisplayName(item.dirNode) || "Folder";

        previewFolderEl.appendChild(icon);
        previewFolderEl.appendChild(name);
        return;
      }

      if (!rec) return;

      if (rec.type === "video") {
        const mode = previewVideoMode();
        const doAuto = mode !== "off" && !BANIC_ACTIVE && !VIEWER_MODE;
        if (!VIEWER_MODE && viewerVideoEl) { try { viewerVideoEl.pause(); } catch {} }
        normalizeVideoPlaybackRate(previewVideoEl);
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
          if (updateVideoCropFromElement(rec, previewVideoEl)) {
            applyVideoCropToElement(previewVideoEl, rec);
            kickVideoThumbsForPreview();
            if (VIEWER_MODE) renderViewerItem(viewerIndex);
          } else {
            applyVideoCropToElement(previewVideoEl, rec);
          }
          MediaFilterEngine.requestRender();
        };

        applyVideoPoster(previewVideoEl, rec);
        applyVideoCropToElement(previewVideoEl, rec);
        const src = ensureMediaUrl(rec) || "";
        const same = previewVideoEl.src === src;
        if (!same) {
          previewVideoEl.src = src;
        }
        previewVideoEl.style.display = "block";
        previewVideoEl.setAttribute("data-dir-path", rec.dirPath || "");
        syncMediaFilterSurface("preview", previewVideoEl, previewViewportBox, "video", rec);

        applyVideoCarryToElement(previewVideoEl, rec.id);

        if (previewVideoEl.readyState >= 2) {
          requestAnimationFrame(() => {
            previewVideoEl.classList.add("ready");
            if (updateVideoCropFromElement(rec, previewVideoEl)) {
              applyVideoCropToElement(previewVideoEl, rec);
              kickVideoThumbsForPreview();
              if (VIEWER_MODE) renderViewerItem(viewerIndex);
            } else {
              applyVideoCropToElement(previewVideoEl, rec);
            }
          });
        }
        if (doAuto) { try { previewVideoEl.play(); } catch {} }
        else { try { previewVideoEl.pause(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      previewImgEl.onload = () => {
        previewImgEl.classList.add("ready");
        const imageMode = detectScrollImageMode(rec, previewImgEl);
        applyScrollImageMode(previewViewportBox, previewImgEl, imageMode, false);
        if (imageMode !== "none") {
          clearMediaFilterSurface("preview", previewImgEl);
          applyScrollImageProcessingFallback(previewImgEl, rec, imageMode);
          previewImgEl.classList.remove("mediaHidden");
        } else {
          applyScrollImageProcessingFallback(previewImgEl, rec, "none");
          syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image", rec);
        }
        MediaFilterEngine.requestRender();
      };
      const src = ensureMediaUrl(rec) || "";
      const same = previewImgEl.src === src;
      if (!same) previewImgEl.src = src;
      previewImgEl.style.display = "block";
      const previewIsGif = isGifRecord(rec);
      previewImgEl.setAttribute("data-is-gif", previewIsGif ? "1" : "0");
      previewImgEl.setAttribute("data-dir-path", rec.dirPath || "");
      const previewMode = detectScrollImageMode(rec, previewImgEl);
      applyScrollImageMode(previewViewportBox, previewImgEl, previewMode, !same);
      if (previewMode !== "none") {
        clearMediaFilterSurface("preview", previewImgEl);
        applyScrollImageProcessingFallback(previewImgEl, rec, previewMode);
        previewImgEl.classList.remove("mediaHidden");
      } else {
        applyScrollImageProcessingFallback(previewImgEl, rec, "none");
        syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image", rec);
      }

      if (previewImgEl.complete && previewImgEl.naturalWidth > 0) {
        requestAnimationFrame(() => {
          previewImgEl.classList.add("ready");
          const imageMode = detectScrollImageMode(rec, previewImgEl);
          applyScrollImageMode(previewViewportBox, previewImgEl, imageMode, false);
          if (imageMode !== "none") {
            clearMediaFilterSurface("preview", previewImgEl);
            applyScrollImageProcessingFallback(previewImgEl, rec, imageMode);
            previewImgEl.classList.remove("mediaHidden");
          } else {
            applyScrollImageProcessingFallback(previewImgEl, rec, "none");
            syncMediaFilterSurface("preview", previewImgEl, previewViewportBox, "image", rec);
          }
        });
      }
      preloadNextMedia(viewerItems, viewerIndex);
    }

    // USER NOTE (DO NOT CASUALLY CHANGE):
    // Viewer/file stepping must synchronize back through the SAME pending-center directory scroll path used by
    // folder navigation. Keep the pendingDirScroll + renderDirectoriesPane(false) pair together.
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
      saveGridSelectionForCurrentContext();
      syncPreviewToSelection();

      // Critical for file-row autoscroll parity with folders.
      WS.view.pendingDirScroll = isGridInteractionMode() ? "grid-nearest" : "center-selected";
      renderDirectoriesPane(false);
      renderPreviewPane(false, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    let PREVIEW_FILES_RENDER_TOKEN = 0;
    function nextPreviewFilesRenderToken() {
      PREVIEW_FILES_RENDER_TOKEN = (PREVIEW_FILES_RENDER_TOKEN + 1) >>> 0;
      return PREVIEW_FILES_RENDER_TOKEN;
    }

    function renderPreviewPane(animate = false, keepScroll = false) {
      const previewRenderToken = nextPreviewFilesRenderToken();
      savePreviewScrollForActiveDir();
      const prevScroll = keepScroll ? previewBodyEl.scrollTop : 0;

      if (!WS.root || !WS.nav.dirNode) {
        WS.view.previewScrollActiveKey = "";
        previewBodyEl.innerHTML = "";
        setPreviewBodyMode("grid");
        updateModePill();
        if (itemsPill) itemsPill.textContent = "Items: —";
        previewBodyEl.innerHTML = "";
        return;
      }

      if (isGridInteractionMode()) {
        WS.view.previewScrollActiveKey = "";
        previewBodyEl.innerHTML = "";
        setPreviewBodyMode("grid");
        if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
        MediaFilterEngine.detach("preview");
        if (previewImgEl) previewImgEl.classList.remove("mediaHidden");
        if (previewVideoEl) previewVideoEl.classList.remove("mediaHidden");
        updateModePill();
        const currentDirCount = getDirectoryItemCount(WS.nav.dirNode || WS.root);
        if (itemsPill) itemsPill.textContent = `Items: ${currentDirCount}`;
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
        WS.view.previewScrollActiveKey = "";
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">No preview.</div>`;
        return;
      }
      const previewDirKey = previewScrollKeyForDir(dirNode);
      const savedScroll = getSavedPreviewScrollForDir(dirNode);
      const shouldRestoreScroll = !!keepScroll || savedScroll !== null;
      const restoreScroll = keepScroll ? prevScroll : Math.max(0, Number(savedScroll) || 0);

      if (previewDisplayMode() === "expanded") {
        renderExpandedPreviewPane(dirNode, animate, shouldRestoreScroll, restoreScroll, previewRenderToken);
        WS.view.previewScrollActiveKey = previewDirKey;
        return;
      }

      const showRootFoldersOnly = WS.view.aboveRootView && dirNode === WS.root;
      renderFolderContents(dirNode, previewBodyEl, animate, { includeFiles: !showRootFoldersOnly }, previewRenderToken);

      if (animate) {
        requestAnimationFrame(() => {
          const cards = previewBodyEl.querySelectorAll(".fileCard.enter");
          cards.forEach(c => c.classList.remove("enter"));
        });
      }

      if (shouldRestoreScroll) previewBodyEl.scrollTop = restoreScroll;
      WS.view.previewScrollActiveKey = previewDirKey;
    }

    previewBodyEl.addEventListener("scroll", () => {
      savePreviewScrollForActiveDir();
    });

    previewBodyEl.addEventListener("contextmenu", (e) => {
      const target = e.target;
      if (target && target.closest) {
        if (target.closest(".fileCard")) return;
        if (target.closest(".folderCard")) return;
        if (target.closest("#filePreviewViewport")) return;
      }
      e.preventDefault();
      e.stopPropagation();
      openPreviewContextMenu(e.clientX, e.clientY);
    });


    function makeSpacer() {
      const sp = document.createElement("div");
      sp.className = "previewSectionSpacer";
      return sp;
    }

    function folderPreviewThumbMode() {
      if (naturalAspectThumbnailCardsEnabled()) return "aspect";
      return "cover";
    }

    function folderPreviewThumbUsesContainMode() {
      return naturalAspectThumbnailCardsEnabled();
    }

    function getFirstPreviewRecordForDir(dirNode) {
      const preset = getPresetPreviewRecordForDir(dirNode);
      if (preset) return preset;
      return getFirstDirectPreviewRecordForDir(dirNode);
    }

    function getDirRecursiveSizeBytesForNode(dirNode, memo = null) {
      if (!dirNode) return 0;
      const path = String(dirNode.path || "");
      if (memo && memo.has(path)) return memo.get(path) || 0;
      let size = 0;
      const fileIds = Array.isArray(dirNode.childrenFiles) ? dirNode.childrenFiles : [];
      for (let i = 0; i < fileIds.length; i++) {
        const rec = WS.fileById.get(fileIds[i]);
        const fileSize = Number(rec && rec.size);
        if (Number.isFinite(fileSize) && fileSize > 0) size += fileSize;
      }
      const dirs = Array.isArray(dirNode.childrenDirs) ? dirNode.childrenDirs : [];
      for (let i = 0; i < dirs.length; i++) {
        size += getDirRecursiveSizeBytesForNode(dirs[i], memo);
      }
      if (memo) memo.set(path, size);
      return size;
    }

    function makeFolderPreviewCard(dirNode, sizeMemo = null) {
      const card = document.createElement("div");
      card.className = "folderCard";
      card.style.cursor = "pointer";
      const icon = "📁";
      const nm = dirDisplayName(dirNode) || "folder";
      const p = String(dirNode?.path || "");
      if (p) card.dataset.dirPath = p;
      const entryIdx = findDirEntryIndexByPath(p);
      const canBulkSelect = WS.view.bulkSelectMode && canUseBulkSelection();
      const isBulkSelected = !!p && canBulkSelect && WS.view.bulkTagSelectedPaths.has(p);
      const isSelected = entryIdx >= 0 && WS.nav.selectedIndex === entryIdx;
      if (isSelected) card.classList.add("selected");
      if (isBulkSelected) card.classList.add("bulkSelected");
      const sc = metaGetScore(dirNode?.path || "");
      const scoreMode = folderScoreDisplayMode();
      const isFavorite = metaHasFavorite(p);
      const isHidden = metaHasHidden(p);
      const showPreviewFolderItemCount = !(WS.meta && WS.meta.options && WS.meta.options.showPreviewFolderItemCount === false);
      const totalItems = dirItemCount(dirNode);
      const totalSizeBytes = getDirRecursiveSizeBytesForNode(dirNode, sizeMemo);
      const thumbMode = folderPreviewThumbMode();
      const thumbAspectMode = thumbMode === "aspect";
      const thumbContainMode = thumbAspectMode || thumbMode === "contain" || thumbMode === "contain-no-name";
      const thumbCoverMode = thumbMode === "cover" || thumbMode === "cover-no-name";
      const thumbOverlayMode = thumbCoverMode || thumbAspectMode;
      const hideNameInMeta = thumbMode === "cover-no-name" || thumbMode === "contain-no-name";
      const showThumbMeta = thumbMode !== "off";
      const bulkTagEditState = PREVIEW_BULK_TAG_EDIT && Array.isArray(PREVIEW_BULK_TAG_EDIT.paths)
        ? PREVIEW_BULK_TAG_EDIT
        : null;
      const bulkTagEditPaths = bulkTagEditState ? bulkTagEditState.paths.map((v) => String(v || "")).filter(Boolean) : [];
      const isBulkTagAnchor = !!bulkTagEditPaths.length && String(bulkTagEditState.anchorPath || "") === p;
      const isRenameEditing = RENAME_EDIT_PATH !== null && String(RENAME_EDIT_PATH) === p;
      const isSingleTagEditing = TAG_EDIT_PATH !== null && String(TAG_EDIT_PATH) === p;
      const isTagEditing = isSingleTagEditing || isBulkTagAnchor;
      const leadInfo = (thumbMode !== "off")
        ? getDisplayLeadPreviewForDir(dirNode, "preview-dir")
        : { record: null, rotateKey: "" };
      const leadRec = leadInfo.record;
      const rotateKey = leadInfo.rotateKey;
      const voteSeg = scoreMode !== "hidden" ? `
          <div class="voteBox">
            ${scoreMode === "show" ? `<div class="voteBtn up">▲</div>` : ""}
            <div class="voteScore">${sc}</div>
            ${scoreMode === "show" ? `<div class="voteBtn down">▼</div>` : ""}
          </div>
          ` : ``;
      const countSeg = showPreviewFolderItemCount ? `<div class="meta">${totalItems} items</div>` : ``;
      if (showThumbMeta) {
        card.classList.add("folderThumbCard");
        card.dataset.thumbMode = thumbMode;
        if (thumbOverlayMode) card.classList.add("folderThumbCoverCard");
        if (thumbContainMode) {
          const fallbackAspect = 1;
          const initialAspect = leadRec ? getPreviewAspectForRecord(leadRec) : fallbackAspect;
          card.classList.add("fitInsideCard");
          card.dataset.aspect = String(normalizePreviewAspect(initialAspect, fallbackAspect));
        }
        if (thumbAspectMode) card.classList.add("previewNaturalCard");
        if (leadRec) {
          const thumb = document.createElement("img");
          thumb.className = "folderThumb";
          thumb.loading = "lazy";
          thumb.draggable = false;
          thumb.alt = nm;
          thumb.style.objectFit = thumbAspectMode ? "cover" : (thumbContainMode ? "contain" : "cover");
          if (leadRec.type === "video") {
            thumb.src = getVideoPosterForRecord(leadRec);
            if (!leadRec.videoThumbUrl) enqueueVideoThumb(leadRec);
          } else {
            thumb.src = ensureThumbUrl(leadRec) || "";
          }
          if (thumbContainMode) {
            thumb.addEventListener("load", () => {
              const w = Number(thumb.naturalWidth) || 0;
              const h = Number(thumb.naturalHeight) || 0;
              if (w > 0 && h > 0) {
                const aspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(leadRec));
                leadRec.previewAspect = aspect;
                card.dataset.aspect = String(aspect);
                const grid = card.parentElement;
                if (grid && grid.classList.contains("fitInsideJustified")) {
                  requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
                }
              }
            });
          }
          if (rotateKey) thumb.setAttribute("data-rotate-key", rotateKey);
          const cropStyle = fileThumbCropLayoutStyle(leadRec, rotateKey);
          if (cropStyle) {
            thumb.classList.add("thumbCropApplied", "thumbCropAbsolute");
            thumb.style.cssText += cropStyle;
          }
          card.appendChild(thumb);
        } else {
          const fallback = document.createElement("div");
          fallback.className = "folderThumb folderThumbFallback";
          fallback.textContent = icon;
          card.appendChild(fallback);
        }

        const meta = document.createElement("div");
        meta.className = thumbOverlayMode ? "metaBlock compact thumbOverlayMeta" : "metaBlock compact";
        const menuWrap = document.createElement("div");
        menuWrap.className = "dirMenu thumbOverlayMenu";
        const menuBtn = document.createElement("button");
        menuBtn.className = "dirMenuBtn thumbOverlayMenuBtn";
        menuBtn.type = "button";
        menuBtn.textContent = "⋯";
        menuBtn.title = "Folder menu";
        const openPreviewFolderMenu = (e) => {
          if (e) {
            e.preventDefault();
            e.stopPropagation();
          }
          openPreviewFolderActionMenu(dirNode, { anchor: menuBtn });
        };
        menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
        menuBtn.addEventListener("click", (e) => {
          openPreviewFolderMenu(e);
        });
        menuBtn.addEventListener("contextmenu", (e) => {
          openPreviewFolderMenu(e);
        });
        menuWrap.appendChild(menuBtn);

        const top = document.createElement("div");
        top.className = thumbOverlayMode ? "topLine thumbOverlayTopLine" : "topLine";
        if (!hideNameInMeta && !isRenameEditing && !isTagEditing) {
          const name = document.createElement("div");
          name.className = "name";
          name.textContent = nm;
          name.title = nm;
          top.appendChild(name);
        } else if (isRenameEditing) {
          const renameInput = document.createElement("input");
          renameInput.type = "text";
          renameInput.className = "tagEditInput renameEditInput previewFolderRenameInput";
          renameInput.value = String(dirNode?.name || "");
          renameInput.placeholder = "folder name";
          top.appendChild(renameInput);
        } else if (isTagEditing) {
          const tagInput = document.createElement("input");
          tagInput.type = "text";
          tagInput.className = "tagEditInput previewFolderTagInput";
          tagInput.value = isSingleTagEditing ? metaGetUserTags(p).join(", ") : "";
          tagInput.placeholder = "tag1, tag2";
          if (isBulkTagAnchor) tagInput.dataset.bulkTagEdit = "1";
          top.appendChild(tagInput);
        }
        meta.appendChild(top);

        const bottom = document.createElement("div");
        bottom.className = thumbOverlayMode ? "thumbOverlayBottomLine" : "metaBottomLine";
        const summaryParts = [];
        if (showPreviewFolderItemCount) summaryParts.push(`${totalItems} items`);
        summaryParts.push(formatBytes(totalSizeBytes));
        if (summaryParts.length) {
          const mini = document.createElement("div");
          mini.className = thumbOverlayMode ? "mini thumbOverlayMini" : "mini";
          mini.textContent = summaryParts.join(" • ");
          bottom.appendChild(mini);
        }
        if (thumbOverlayMode) {
          const rightMeta = document.createElement("div");
          rightMeta.className = "thumbOverlayRightMeta";
          if (scoreMode !== "hidden") {
            const score = document.createElement("span");
            score.className = "thumbOverlayScore";
            score.textContent = String(sc);
            score.title = "Score";
            rightMeta.appendChild(score);
          }
          if (isFavorite) {
            const fav = document.createElement("span");
            fav.className = "dirFavoriteHeart dirStatusBadge";
            fav.textContent = "♥";
            fav.title = "Favorite";
            rightMeta.appendChild(fav);
          }
          if (isHidden) {
            const hidden = document.createElement("span");
            hidden.className = "dirHiddenBadge dirStatusBadge";
            hidden.textContent = "🙈";
            hidden.title = "Hidden";
            rightMeta.appendChild(hidden);
          }
          rightMeta.appendChild(menuWrap);
          bottom.appendChild(rightMeta);
        } else {
          bottom.appendChild(menuWrap);
        }
        meta.appendChild(bottom);
        card.appendChild(meta);
      } else {
        card.innerHTML = `
          <div class="left">
            <div class="icon">${icon}</div>
            <div class="name" title="${escapeHtml(nm)}">${escapeHtml(nm)}</div>
          </div>
          <div class="folderRight">
            ${voteSeg}
            ${countSeg}
          </div>
        `;
      }
      const up = card.querySelector(".voteBtn.up");
      const down = card.querySelector(".voteBtn.down");
      if (up) up.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(dirNode?.path || "", 1); });
      if (down) down.addEventListener("click", (e) => { e.stopPropagation(); metaBumpScore(dirNode?.path || "", -1); });
      const renameInput = card.querySelector(".previewFolderRenameInput");
      if (renameInput) {
        let commitRequested = false;
        renameInput.addEventListener("click", (e) => { e.stopPropagation(); });
        renameInput.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            RENAME_EDIT_PATH = null;
            PREVIEW_BULK_TAG_EDIT = null;
            closeActionMenus();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            commitRequested = true;
            commitRenameEdit(p, renameInput);
          }
        });
        renameInput.addEventListener("blur", () => {
          if (commitRequested) {
            commitRequested = false;
            return;
          }
          RENAME_EDIT_PATH = null;
          PREVIEW_BULK_TAG_EDIT = null;
          closeActionMenus();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
        });
      }
      const tagInput = card.querySelector(".previewFolderTagInput");
      if (tagInput) {
        let commitRequested = false;
        tagInput.addEventListener("click", (e) => { e.stopPropagation(); });
        tagInput.addEventListener("keydown", (e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            TAG_EDIT_PATH = null;
            PREVIEW_BULK_TAG_EDIT = null;
            closeActionMenus();
            renderDirectoriesPane(true);
            renderPreviewPane(false, true);
            syncButtons();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            const tags = normalizeTagsFromText(tagInput.value || "");
            if (!tags.length) {
              showStatusMessage("Tag name cannot be empty.");
              return;
            }
            commitRequested = true;
            if (tagInput.dataset.bulkTagEdit === "1") {
              const bulkPaths = bulkTagEditPaths.slice();
              PREVIEW_BULK_TAG_EDIT = null;
              metaAddUserTagsBulk(bulkPaths, tags);
              finalizeBulkSelectionAction();
              return;
            }
            metaSetUserTags(p, tags);
          }
        });
        tagInput.addEventListener("blur", () => {
          if (commitRequested) {
            commitRequested = false;
            return;
          }
          TAG_EDIT_PATH = null;
          PREVIEW_BULK_TAG_EDIT = null;
          closeActionMenus();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
        });
      }
      card.addEventListener("click", (e) => {
        if (e.defaultPrevented) return;
        const target = e.target;
        if (target && target.closest && target.closest(".dirMenu")) return;
        if (target && target.closest && target.closest(".tagEditInput")) return;
        const idx = findDirEntryIndexByPath(p);
        const entry = idx >= 0 ? WS.nav.entries[idx] : null;
        const priorSelectedIndex = WS.nav.selectedIndex;
        const isCmdOrCtrl = eventCmdOrCtrlHeld(e);
        const isShift = eventShiftHeld(e);
        if (idx >= 0 && isShift && isCmdOrCtrl) {
          closeActionMenus();
          const anchor = WS.view.dirSelectAnchorIndex >= 0 ? WS.view.dirSelectAnchorIndex : priorSelectedIndex;
          if (!WS.view.bulkSelectMode) includeCurrentSelectionInBulkSet(idx);
          addEntrySelectionRange(anchor, idx, false);
          WS.view.dirSelectAnchorIndex = idx;
          setDirectoriesSelection(idx, { keepScroll: true });
          return;
        }
        if (idx >= 0 && isShift) {
          closeActionMenus();
          const anchor = WS.view.dirSelectAnchorIndex >= 0 ? WS.view.dirSelectAnchorIndex : priorSelectedIndex;
          selectEntryRange(anchor, idx);
          WS.view.dirSelectAnchorIndex = idx;
          setDirectoriesSelection(idx, { keepScroll: true });
          return;
        }
        if (idx >= 0 && isCmdOrCtrl) {
          closeActionMenus();
          if (!WS.view.bulkSelectMode) includeCurrentSelectionInBulkSet(idx);
          WS.view.bulkSelectMode = true;
          if (entry && entry.kind === "dir") toggleEntrySelection(entry);
          WS.view.dirSelectAnchorIndex = idx;
          setDirectoriesSelection(idx, { keepScroll: true });
          return;
        }
        if (WS.view.bulkSelectMode && (
          WS.view.bulkTagSelectedPaths.size ||
          WS.view.bulkTagFolderSelectedKeys.size ||
          WS.view.bulkFileSelectedIds.size
        )) {
          clearBulkTagSelection();
          WS.view.bulkSelectMode = false;
        }
        navigateFromPreviewFolderCard(dirNode);
      });
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openPreviewFolderActionMenu(dirNode, { x: e.clientX, y: e.clientY });
      });
      return card;
    }

    function normalizePreviewAspect(value, fallback = 4 / 3) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return fallback;
      return Math.max(0.2, Math.min(6, n));
    }

    function previewRowTargetHeight() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const size = opt ? String(opt.mediaThumbUiSize || "medium") : "medium";
      const scaleMult = getActiveThumbnailScaleMultiplier(opt);
      const scaled = (base) => Math.max(96, Math.round(base * scaleMult));
      if (size === "small") return scaled(180);
      if (size === "large") return scaled(280);
      return scaled(230);
    }

    function getPreviewAspectForRecord(rec) {
      if (!rec) return 4 / 3;
      return normalizePreviewAspect(
        rec.previewAspect || rec.thumbAspect || rec.videoAspect || rec.aspectRatio || rec.aspect,
        4 / 3
      );
    }

    function applyFitInsideJustifiedLayout(gridEl) {
      if (!gridEl || !gridEl.classList.contains("fitInsideJustified")) return;
      const cards = Array.from(gridEl.querySelectorAll(".fitInsideCard"))
        .filter(card => !card.classList.contains("drag-placeholder") && !card.classList.contains("drag-hidden"));
      if (!cards.length) return;

      const computed = getComputedStyle(gridEl);
      const gapRaw = parseFloat(computed.columnGap || computed.gap || "0");
      const gap = Number.isFinite(gapRaw) && gapRaw >= 0 ? gapRaw : 0;
      const gridWidth = Math.max(1, Math.floor(gridEl.clientWidth));
      const targetH = previewRowTargetHeight();
      const minH = Math.max(88, Math.round(targetH * 0.86));
      const maxH = Math.max(minH, Math.round(targetH * 1.14));
      const aspects = cards.map(card => normalizePreviewAspect(card.dataset.aspect, 4 / 3));
      const prefix = [0];
      for (let i = 0; i < aspects.length; i++) prefix.push(prefix[i] + aspects[i]);

      const rowAspectSum = (start, end) => prefix[end + 1] - prefix[start];

      const rowHeightFor = (rowAspect, rowCount, lastRow = false) => {
        const gapsWidth = gap * Math.max(0, rowCount - 1);
        const available = Math.max(1, gridWidth - gapsWidth);
        const safeAspect = Math.max(0.01, rowAspect);
        const fitted = available / safeAspect;
        if (lastRow) {
          const naturalWidth = safeAspect * targetH;
          if (naturalWidth <= available) return targetH;
          return Math.max(minH, Math.min(targetH, fitted));
        }
        return Math.max(minH, Math.min(maxH, fitted));
      };

      const rowCost = (rowAspect, rowCount, lastRow = false) => {
        if (!rowCount || rowAspect <= 0) return Number.POSITIVE_INFINITY;
        const gapsWidth = gap * Math.max(0, rowCount - 1);
        const available = Math.max(1, gridWidth - gapsWidth);
        const safeAspect = Math.max(0.01, rowAspect);
        const fitted = available / safeAspect;
        const rowH = rowHeightFor(rowAspect, rowCount, lastRow);
        const used = safeAspect * rowH;
        const fillError = lastRow
          ? Math.max(0, (used - available) / available)
          : Math.abs(available - used) / available;
        const scaleError = Math.abs(rowH - targetH) / Math.max(1, targetH);
        const crowdPenalty = fitted < minH ? ((minH - fitted) / Math.max(1, targetH)) * 4.2 : 0;
        const sparsePenalty = (!lastRow && fitted > maxH) ? ((fitted - maxH) / Math.max(1, targetH)) * 2.6 : 0;
        const singlePenalty = rowCount === 1 ? (lastRow ? 0.7 : 2.5) : 0;
        return (fillError * (lastRow ? 0.55 : 1.75))
          + (scaleError * 0.95)
          + crowdPenalty
          + sparsePenalty
          + singlePenalty;
      };

      const applyRow = (rowCards, rowAspect, lastRow = false) => {
        if (!rowCards.length) return;
        const gapsWidth = gap * Math.max(0, rowCards.length - 1);
        const available = Math.max(1, gridWidth - gapsWidth);
        const rowH = rowHeightFor(rowAspect, rowCards.length, lastRow);
        const rawWidths = rowCards.map((card) => {
          const aspect = normalizePreviewAspect(card.dataset.aspect, 4 / 3);
          return Math.max(56, rowH * aspect);
        });
        const widths = rawWidths.map((w) => Math.max(56, Math.round(w)));
        if (!lastRow) {
          const widthSum = widths.reduce((sum, w) => sum + w, 0);
          let delta = Math.round(available - widthSum);
          if (delta !== 0 && widths.length) {
            const order = rawWidths
              .map((w, idx) => ({ idx, frac: w - Math.floor(w) }))
              .sort((a, b) => delta > 0 ? (b.frac - a.frac) : (a.frac - b.frac));
            let guard = 0;
            while (delta !== 0 && guard < (Math.abs(delta) * Math.max(1, order.length))) {
              const idx = order[guard % order.length].idx;
              if (delta > 0) {
                widths[idx] += 1;
                delta -= 1;
              } else if (widths[idx] > 56) {
                widths[idx] -= 1;
                delta += 1;
              }
              guard++;
            }
          }
        }
        for (let i = 0; i < rowCards.length; i++) {
          const card = rowCards[i];
          const width = widths[i] || Math.max(56, Math.round(rowH));
          card.style.setProperty("--fit-card-h", `${Math.round(rowH)}px`);
          card.style.setProperty("--fit-card-w", `${width}px`);
        }
      };

      const n = cards.length;
      const dp = new Array(n + 1).fill(Number.POSITIVE_INFINITY);
      const nextBreak = new Array(n).fill(n - 1);
      dp[n] = 0;

      for (let i = n - 1; i >= 0; i--) {
        let best = Number.POSITIVE_INFINITY;
        let bestEnd = i;
        for (let end = i; end < n && end < i + 28; end++) {
          const count = end - i + 1;
          const rowAspect = rowAspectSum(i, end);
          const isLast = end === n - 1;
          const cost = rowCost(rowAspect, count, isLast);
          const tail = isLast ? 0 : dp[end + 1];
          if (!Number.isFinite(cost) || !Number.isFinite(tail)) continue;
          const total = cost + tail;
          if (total < best) {
            best = total;
            bestEnd = end;
          }
          const gapsWidth = gap * Math.max(0, count - 1);
          const available = Math.max(1, gridWidth - gapsWidth);
          const fitted = available / Math.max(0.01, rowAspect);
          if (!isLast && count > 1 && fitted < (minH * 0.72)) break;
        }
        dp[i] = best;
        nextBreak[i] = bestEnd;
      }

      let start = 0;
      while (start < n) {
        let end = nextBreak[start];
        if (!Number.isFinite(end) || end < start || end >= n) end = start;
        const rowCards = cards.slice(start, end + 1);
        const rowAspect = rowAspectSum(start, end);
        const isLast = end === n - 1;
        applyRow(rowCards, rowAspect, isLast);
        start = end + 1;
      }
    }

    function refreshFitInsidePreviewGrids() {
      if (!previewBodyEl) return;
      const grids = Array.from(previewBodyEl.querySelectorAll(".fitInsideJustified"));
      for (const grid of grids) applyFitInsideJustifiedLayout(grid);
    }

    function renderFilesGrid(ids, container, animate, dirNode, renderToken = PREVIEW_FILES_RENDER_TOKEN) {
      const LIMIT = 800;
      if (!ids.length) return 0;

      const grid = document.createElement("div");
      grid.className = "gridFiles";
      const useNaturalAspectCards = naturalAspectThumbnailCardsEnabled();
      const useSquareMediaCards = previewSquareMediaThumbsEnabled();
      const useFitInsideJustified = !useSquareMediaCards && previewThumbFitMode() === "contain";
      if (useFitInsideJustified) grid.classList.add("fitInsideJustified");
      if (useSquareMediaCards) grid.classList.add("previewSquareCards");
      if (useNaturalAspectCards) grid.classList.add("previewNaturalAspectCards");
      if (dirNode && canReorderFilesInPreviewDir(dirNode)) setupPreviewGridDrag(grid);
      container.appendChild(grid);

      const visibleIds = ids.slice(0, LIMIT);
      const totalToRender = visibleIds.length;
      if (!totalToRender) return 0;
      const ANIMATE_CARD_LIMIT = 96;
      const FIRST_CHUNK = 72;
      const NEXT_CHUNK = 56;
      let index = 0;
      let didFirstLayout = false;

      const renderChunk = (chunkSize) => {
        if (renderToken !== PREVIEW_FILES_RENDER_TOKEN) return;
        if (!grid.isConnected) return;
        const frag = document.createDocumentFragment();
        let chunkCount = 0;
        while (index < totalToRender && chunkCount < chunkSize) {
          const id = visibleIds[index];
          index++;
          const rec = WS.fileById.get(id);
          if (!rec) continue;
          const shouldAnimateCard = !!animate && index <= ANIMATE_CARD_LIMIT;
          const card = makePreviewFileCard(rec, shouldAnimateCard, dirNode, visibleIds, useFitInsideJustified, useSquareMediaCards);
          frag.appendChild(card);
          chunkCount++;
        }
        if (frag.childNodes.length) grid.appendChild(frag);
        if (useFitInsideJustified && (!didFirstLayout || index >= totalToRender)) {
          applyFitInsideJustifiedLayout(grid);
          didFirstLayout = true;
        }
        if (index < totalToRender) {
          requestAnimationFrame(() => renderChunk(NEXT_CHUNK));
        }
      };

      renderChunk(FIRST_CHUNK);
      return totalToRender;
    }

    function renderFolderContents(dirNode, container, animate, opts = null, renderToken = PREVIEW_FILES_RENDER_TOKEN) {
      const folders = getChildDirsForNode(dirNode);
      const includeFiles = !(opts && opts.includeFiles === false);
      let hasContent = false;

      if (folders.length) {
        const gridF = document.createElement("div");
        gridF.className = "gridFolders";
        const useFolderFitInsideJustified = folderPreviewThumbUsesContainMode();
        if (useFolderFitInsideJustified) gridF.classList.add("fitInsideJustified");
        const fragF = document.createDocumentFragment();
        const folderSizeMemo = new Map();

        for (const d of folders) {
          fragF.appendChild(makeFolderPreviewCard(d, folderSizeMemo));
        }

        gridF.appendChild(fragF);
        container.appendChild(gridF);
        if (useFolderFitInsideJustified) applyFitInsideJustifiedLayout(gridF);
        container.appendChild(makeSpacer());
        hasContent = true;
      }

      const ids = includeFiles ? getOrderedFileIdsForDir(dirNode) : [];
      if (ids.length) {
        renderFilesGrid(ids, container, animate, dirNode, renderToken);
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

    function renderExpandedPreviewPane(dirNode, animate, keepScroll, prevScroll, renderToken = PREVIEW_FILES_RENDER_TOKEN) {
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
        renderFilesGrid(baseFiles, section, animate, dirNode, renderToken);
        previewBodyEl.appendChild(section);
        hasAny = true;
      }

      for (const child of baseDirs) {
        const nm = dirDisplayName(child) || "folder";
        const childFolders = getChildDirsForNode(child).length;
        const childFiles = getOrderedFileIdsForDir(child).length;
        const total = childFolders + childFiles;
        const section = makeSection(nm, `${total} items`, child.path || "");
        renderFolderContents(child, section, animate, null, renderToken);
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

    function canReorderFilesInPreviewDir(dirNode) {
      const target = getPreviewTargetDir();
      if (!target || !dirNode) return false;
      if (String(target.path || "") !== String(dirNode.path || "")) return false;
      return canReorderFilesInDir(dirNode);
    }

    const PREVIEW_DRAG_STATE = {
      placeholder: null,
      grid: null,
      draggedId: null,
      draggedCard: null,
      dirNode: null,
      visibleIds: null,
      raf: 0,
      lastX: 0,
      lastY: 0,
      pendingHide: false
    };

    function ensurePreviewDragPlaceholder(card) {
      if (!PREVIEW_DRAG_STATE.placeholder) {
        const ph = document.createElement("div");
        ph.className = "fileCard drag-placeholder";
        ph.setAttribute("aria-hidden", "true");
        PREVIEW_DRAG_STATE.placeholder = ph;
      }
      const rect = card.getBoundingClientRect();
      const ph = PREVIEW_DRAG_STATE.placeholder;
      ph.style.width = `${Math.max(1, Math.round(rect.width))}px`;
      ph.style.height = `${Math.max(1, Math.round(rect.height))}px`;
      return ph;
    }

    function placePreviewDragPlaceholder(card) {
      const grid = card.parentElement;
      if (!grid) return;
      const ph = ensurePreviewDragPlaceholder(card);
      if (ph.parentElement && ph.parentElement !== grid) {
        ph.parentElement.removeChild(ph);
      }
      PREVIEW_DRAG_STATE.grid = grid;
      if (card !== ph) grid.insertBefore(ph, card);
    }

    function clearPreviewDragPlaceholder() {
      const ph = PREVIEW_DRAG_STATE.placeholder;
      if (ph && ph.parentElement) ph.parentElement.removeChild(ph);
      PREVIEW_DRAG_STATE.grid = null;
    }

    function getPreviewGridCards(grid) {
      if (!grid) return [];
      return Array.from(grid.querySelectorAll(".fileCard"))
        .filter(card => !card.classList.contains("drag-placeholder") && !card.classList.contains("drag-hidden"));
    }

    function updatePreviewPlaceholderFromPoint(grid, x, y) {
      const cards = getPreviewGridCards(grid);
      if (!cards.length) {
        const ph = PREVIEW_DRAG_STATE.placeholder;
        if (ph) grid.appendChild(ph);
        return;
      }
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const rowMid = rect.top + rect.height / 2;
        if (y < rowMid) {
          placePreviewDragPlaceholder(card);
          return;
        }
        if (y >= rect.top && y <= rect.bottom) {
          const colMid = rect.left + rect.width / 2;
          if (x < colMid) {
            placePreviewDragPlaceholder(card);
            return;
          }
        }
      }
      const ph = PREVIEW_DRAG_STATE.placeholder;
      if (ph) grid.appendChild(ph);
    }

    function schedulePreviewDragUpdate(grid, x, y) {
      PREVIEW_DRAG_STATE.lastX = x;
      PREVIEW_DRAG_STATE.lastY = y;
      if (PREVIEW_DRAG_STATE.raf) return;
      PREVIEW_DRAG_STATE.raf = requestAnimationFrame(() => {
        PREVIEW_DRAG_STATE.raf = 0;
        updatePreviewPlaceholderFromPoint(grid, PREVIEW_DRAG_STATE.lastX, PREVIEW_DRAG_STATE.lastY);
      });
    }

    function beginPreviewDrag(card, dragDir, visibleIds) {
      PREVIEW_DRAG_STATE.draggedCard = card;
      PREVIEW_DRAG_STATE.draggedId = String(card?.dataset?.fileId || "");
      PREVIEW_DRAG_STATE.dirNode = dragDir;
      PREVIEW_DRAG_STATE.visibleIds = Array.isArray(visibleIds) ? visibleIds.slice() : null;
      const grid = card?.parentElement || null;
      PREVIEW_DRAG_STATE.grid = grid;
      PREVIEW_DRAG_STATE.pendingHide = true;
    }

    function finishPreviewDrag() {
      if (PREVIEW_DRAG_STATE.raf) {
        cancelAnimationFrame(PREVIEW_DRAG_STATE.raf);
        PREVIEW_DRAG_STATE.raf = 0;
      }
      const card = PREVIEW_DRAG_STATE.draggedCard;
      if (card) card.classList.remove("drag-hidden");
      PREVIEW_DRAG_STATE.draggedCard = null;
      PREVIEW_DRAG_STATE.draggedId = null;
      PREVIEW_DRAG_STATE.dirNode = null;
      PREVIEW_DRAG_STATE.visibleIds = null;
      PREVIEW_DRAG_STATE.pendingHide = false;
      clearPreviewDragPlaceholder();
    }

    function ensurePreviewDragHidden() {
      if (!PREVIEW_DRAG_STATE.pendingHide) return;
      const card = PREVIEW_DRAG_STATE.draggedCard;
      const grid = PREVIEW_DRAG_STATE.grid || card?.parentElement || null;
      if (!card || !grid) return;
      PREVIEW_DRAG_STATE.pendingHide = false;
      placePreviewDragPlaceholder(card);
      card.classList.add("drag-hidden");
    }

    function setupPreviewGridDrag(grid) {
      if (!grid || grid.dataset.previewDragBound === "1") return;
      grid.dataset.previewDragBound = "1";

      grid.addEventListener("dragover", (e) => {
        if (!PREVIEW_DRAG_STATE.draggedId) return;
        if (PREVIEW_DRAG_STATE.grid && PREVIEW_DRAG_STATE.grid !== grid) return;
        e.preventDefault();
        ensurePreviewDragHidden();
        schedulePreviewDragUpdate(grid, e.clientX, e.clientY);
      });

      grid.addEventListener("drop", (e) => {
        if (!PREVIEW_DRAG_STATE.draggedId) return;
        if (PREVIEW_DRAG_STATE.grid && PREVIEW_DRAG_STATE.grid !== grid) return;
        e.preventDefault();
        e.stopPropagation();
        updatePreviewPlaceholderFromPoint(grid, e.clientX, e.clientY);
        const dirNode = PREVIEW_DRAG_STATE.dirNode;
        const dragId = PREVIEW_DRAG_STATE.draggedId;
        const ids = PREVIEW_DRAG_STATE.visibleIds || (dirNode ? getOrderedFileIdsForDir(dirNode) : []);
        const list = ids.filter(id => String(id || "") !== String(dragId));
        const children = Array.from(grid.children);
        let insertIdx = 0;
        for (const child of children) {
          if (child === PREVIEW_DRAG_STATE.placeholder) break;
          if (child.classList && child.classList.contains("fileCard")
            && !child.classList.contains("drag-hidden")
            && !child.classList.contains("drag-placeholder")) {
            insertIdx++;
          }
        }
        insertIdx = Math.max(0, Math.min(list.length, insertIdx));
        let targetId = null;
        let placeAfter = false;
        if (list.length) {
          if (insertIdx >= list.length) {
            targetId = list[list.length - 1];
            placeAfter = true;
          } else {
            targetId = list[insertIdx];
            placeAfter = false;
          }
        }
        if (dirNode && targetId) {
          const moved = reorderFilesInDir(dirNode, dragId, targetId, placeAfter, { visibleIds: ids });
          if (moved) syncAfterDirOrderChange(null, { preserveSelection: true });
        }
        DIR_FILE_DRAG.id = null;
        DIR_FILE_DRAG.dirPath = null;
        finishPreviewDrag();
      });
    }

    function makePreviewFileCard(rec, animate, dirNode, visibleIds, useFitInsideJustified = false, useSquareMediaCards = false) {
      const card = document.createElement("div");
      card.className = "fileCard";
      const useNaturalAspectCards = naturalAspectThumbnailCardsEnabled();
      if (useSquareMediaCards) card.classList.add("previewSquareCard");
      if (useNaturalAspectCards) card.classList.add("previewNaturalCard");
      if (useFitInsideJustified) {
        card.classList.add("fitInsideCard");
        card.dataset.aspect = String(getPreviewAspectForRecord(rec));
      }
      card.style.cursor = "pointer";
      if (animate) card.classList.add("enter");

      const img = document.createElement("img");
      img.className = "thumb";
      img.loading = "lazy";
      img.draggable = false;
      img.alt = fileDisplayNameForRecord(rec) || "";

      if (rec.type === "image") {
        img.src = ensureThumbUrl(rec) || "";
      } else {
        img.src = rec.videoThumbUrl || "";
        if (!img.src) img.style.objectFit = "contain";
      }
      if (useFitInsideJustified) {
        img.addEventListener("load", () => {
          const w = Number(img.naturalWidth) || 0;
          const h = Number(img.naturalHeight) || 0;
          if (w > 0 && h > 0) {
            const aspect = normalizePreviewAspect(w / h, getPreviewAspectForRecord(rec));
            rec.previewAspect = aspect;
            card.dataset.aspect = String(aspect);
            const grid = card.parentElement;
            if (grid && grid.classList.contains("fitInsideJustified")) {
              requestAnimationFrame(() => applyFitInsideJustifiedLayout(grid));
            }
          }
        });
      }
      if (!useFitInsideJustified && useSquareMediaCards) {
        const cropStyle = fileThumbCropLayoutStyle(rec, "");
        if (cropStyle) {
          img.classList.add("thumbCropApplied", "thumbCropAbsolute");
          img.style.cssText += cropStyle;
        }
      }

      const showPreviewFileTypeLabel = !(WS.meta && WS.meta.options && WS.meta.options.showPreviewFileTypeLabel === false);
      const showPreviewFileName = !(WS.meta && WS.meta.options && WS.meta.options.showPreviewFileName === false);
      const forceOverlayMeta = !!useSquareMediaCards || !!useNaturalAspectCards;
      const fileId = String(rec.id || "");
      const showAnyMeta = forceOverlayMeta || showPreviewFileTypeLabel || showPreviewFileName || !!fileId;
      let meta = null;
      if (showAnyMeta) {
        meta = document.createElement("div");
        meta.className = forceOverlayMeta
          ? "metaBlock compact previewThumbOverlayMeta"
          : ((showPreviewFileTypeLabel && showPreviewFileName) ? "metaBlock" : "metaBlock compact");

        const showPreviewFileMenuBtn = !!fileId;
        if (forceOverlayMeta || showPreviewFileName) {
          const top = document.createElement("div");
          top.className = forceOverlayMeta ? "topLine previewThumbOverlayTopLine" : "topLine";

          const name = document.createElement("div");
          name.className = "name";
          name.textContent = fileDisplayNameForRecord(rec) || "—";
          name.title = relPathDisplayName(rec.relPath || rec.name || "");
          top.appendChild(name);

          meta.appendChild(top);
        }

        if (forceOverlayMeta || showPreviewFileTypeLabel || showPreviewFileMenuBtn) {
          const bottom = document.createElement("div");
          bottom.className = forceOverlayMeta ? "previewThumbOverlayBottomLine" : "previewThumbBottomLine";
          if (forceOverlayMeta || showPreviewFileTypeLabel) {
            const mini = document.createElement("div");
            mini.className = forceOverlayMeta ? "mini previewThumbOverlayMini" : "mini";
            mini.textContent = rec.type === "video" ? "Video" : "Image";
            bottom.appendChild(mini);
          }
          if (showPreviewFileMenuBtn) {
            const menuWrap = document.createElement("div");
            menuWrap.className = "dirMenu thumbOverlayMenu previewThumbOverlayMenu";
            const menuBtn = document.createElement("button");
            menuBtn.className = "dirMenuBtn thumbOverlayMenuBtn previewThumbOverlayMenuBtn";
            menuBtn.type = "button";
            menuBtn.textContent = "⋯";
            menuBtn.title = "File menu";
            const openPreviewFileMenu = (e, atPoint = false) => {
              if (e) {
                e.preventDefault();
                e.stopPropagation();
              }
              if (atPoint) {
                openPreviewFileActionMenu(rec, { x: Number(e?.clientX) || 0, y: Number(e?.clientY) || 0 });
              } else {
                openPreviewFileActionMenu(rec, { anchor: menuBtn });
              }
            };
            menuBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
            menuBtn.addEventListener("click", (e) => {
              openPreviewFileMenu(e, false);
            });
            menuBtn.addEventListener("contextmenu", (e) => {
              openPreviewFileMenu(e, false);
            });
            menuWrap.appendChild(menuBtn);
            bottom.appendChild(menuWrap);
          }
          meta.appendChild(bottom);
        }
      }

      card.appendChild(img);
      if (meta) card.appendChild(meta);

      if (fileId) card.dataset.fileId = fileId;
      const dragDir = dirNode || WS.dirByPath.get(rec.dirPath || "") || null;
      if (fileId && dragDir && canReorderFilesInPreviewDir(dragDir)) {
        const handleDragStart = (e) => {
          if (!canReorderFilesInPreviewDir(dragDir) || WS.view.bulkSelectMode) {
            e.preventDefault();
            return;
          }
          DIR_FILE_DRAG.id = fileId;
          DIR_FILE_DRAG.dirPath = String(dragDir.path || "");
          card.classList.add("dragging");
          beginPreviewDrag(card, dragDir, visibleIds);
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = "move";
            try { e.dataTransfer.setData("text/plain", fileId); } catch {}
            try {
              const rect = card.getBoundingClientRect();
              e.dataTransfer.setDragImage(card, rect.width / 2, rect.height / 2);
            } catch {}
          }
        };
        const handleDragEnd = () => {
          DIR_FILE_DRAG.id = null;
          DIR_FILE_DRAG.dirPath = null;
          card.classList.remove("dragging");
          finishPreviewDrag();
        };
        const setupDragSource = (el) => {
          if (!el) return;
          el.draggable = true;
          el.addEventListener("dragstart", handleDragStart);
          el.addEventListener("dragend", handleDragEnd);
        };
        setupDragSource(card);
        setupDragSource(img);
        setupDragSource(meta);
      }

      card.addEventListener("click", () => {
        if (!WS.root) return;
        focusDirectoriesOnFileRecord(rec);
      });

      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!fileId) return;
        openPreviewFileActionMenu(rec, { x: e.clientX, y: e.clientY });
      });

      return card;
    }

    /* =========================================================
       Video thumbnails (lazy, low quality) for Preview Pane
       ========================================================= */

    function currentVideoThumbMode() {
      return WS.meta && WS.meta.options ? String(WS.meta.options.videoThumbSize || "medium") : "medium";
    }

    function videoThumbPendingCount() {
      const priorityLen = Array.isArray(WS.videoThumbPriorityQueue) ? WS.videoThumbPriorityQueue.length : 0;
      const queueLen = Array.isArray(WS.videoThumbQueue) ? WS.videoThumbQueue.length : 0;
      const inFlight = (WS.videoThumbInFlightIds instanceof Set) ? WS.videoThumbInFlightIds.size : 0;
      return Math.max(0, priorityLen + queueLen + inFlight);
    }

    async function prewarmVideoThumbsBeforeInitialRender() {
      if (!WS.root) return;
      const mode = currentVideoThumbMode();
      const targets = [];
      for (const rec of WS.fileById.values()) {
        if (!rec || rec.type !== "video") continue;
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;
        targets.push(rec);
      }
      const total = targets.length;
      if (!total) return;

      let overlayShown = false;
      WS.videoThumbPrewarmBlocking = true;
      try {
        for (let i = 0; i < targets.length; i++) {
          enqueueVideoThumb(targets[i], { deferDrain: true, priority: true });
        }
        drainVideoThumbQueue();
        while (true) {
          const pending = videoThumbPendingCount();
          const done = Math.max(0, total - pending);
          showBusyOverlay(`Preparing video thumbnails... ${done}/${total}`);
          overlayShown = true;
          if (pending <= 0) break;
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      } finally {
        WS.videoThumbPrewarmBlocking = false;
        if (overlayShown) hideBusyOverlay();
      }
    }

    function removeVideoThumbIdFromQueue(queue, id) {
      if (!Array.isArray(queue)) return false;
      const idx = queue.indexOf(String(id || ""));
      if (idx < 0) return false;
      queue.splice(idx, 1);
      return true;
    }

    function enqueueVideoThumb(rec, opts = null) {
      if (!rec || rec.type !== "video") return false;
      const id = String(rec.id || "");
      if (!id) return false;
      const mode = currentVideoThumbMode();
      const deferDrain = !!(opts && opts.deferDrain);
      const priority = !opts || opts.priority !== false;
      if (rec.videoThumbUrl && rec.videoThumbMode === mode) return false;
      if (!Array.isArray(WS.videoThumbPriorityQueue)) WS.videoThumbPriorityQueue = [];
      if (!Array.isArray(WS.videoThumbQueue)) WS.videoThumbQueue = [];
      if (!(WS.videoThumbQueuedIds instanceof Set)) WS.videoThumbQueuedIds = new Set();
      if (!(WS.videoThumbInFlightIds instanceof Set)) WS.videoThumbInFlightIds = new Set();
      if (!(WS.videoThumbInFlightBackgroundIds instanceof Set)) WS.videoThumbInFlightBackgroundIds = new Set();

      let changed = false;
      if (WS.videoThumbQueuedIds.has(id)) {
        if (priority && removeVideoThumbIdFromQueue(WS.videoThumbQueue, id)) {
          WS.videoThumbPriorityQueue.push(id);
          changed = true;
        }
      } else if (!WS.videoThumbInFlightIds.has(id)) {
        if (priority) WS.videoThumbPriorityQueue.push(id);
        else WS.videoThumbQueue.push(id);
        WS.videoThumbQueuedIds.add(id);
        changed = true;
      }

      if (!deferDrain) drainVideoThumbQueue();
      return changed;
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
      const mode = currentVideoThumbMode();
      for (const id of ids) {
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "video") continue;
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;
        enqueueVideoThumb(rec, { priority: true });
      }
      drainVideoThumbQueue();
    }

    function kickVideoThumbsForWorkspace() {
      if (!WS.root) return;
      kickVideoThumbsForPreview();
      const mode = currentVideoThumbMode();
      const previewPriorityIds = new Set();
      const previewDir = getPreviewTargetDir();
      if (previewDir) {
        const includeChildren = previewDisplayMode() === "expanded" && WS.preview.kind !== "file";
        const ids = getPreviewFileIdsForDir(previewDir, includeChildren);
        for (const id of ids) previewPriorityIds.add(String(id || ""));
      }
      for (const rec of WS.fileById.values()) {
        if (!rec || rec.type !== "video") continue;
        const id = String(rec.id || "");
        if (previewPriorityIds.has(id)) continue;
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;
        enqueueVideoThumb(rec, { deferDrain: true, priority: false });
      }
      drainVideoThumbQueue();
    }

    function scheduleVideoThumbWorkspaceKick(delayMs = 0) {
      if (WS.videoThumbWorkspaceKickTimer) {
        try { clearTimeout(WS.videoThumbWorkspaceKickTimer); } catch {}
      }
      const waitMs = Math.max(0, Number(delayMs) || 0);
      WS.videoThumbWorkspaceKickTimer = setTimeout(() => {
        WS.videoThumbWorkspaceKickTimer = 0;
        kickVideoThumbsForWorkspace();
      }, waitMs);
    }

    async function drainVideoThumbQueue() {
      const MAX_VIDEO_THUMB_ACTIVE = 4;
      const MAX_VIDEO_THUMB_BACKGROUND_ACTIVE = 2;
      if (!Array.isArray(WS.videoThumbPriorityQueue)) WS.videoThumbPriorityQueue = [];
      if (!Array.isArray(WS.videoThumbQueue)) WS.videoThumbQueue = [];
      if (!(WS.videoThumbQueuedIds instanceof Set)) WS.videoThumbQueuedIds = new Set();
      if (!(WS.videoThumbInFlightIds instanceof Set)) WS.videoThumbInFlightIds = new Set();
      if (!(WS.videoThumbInFlightBackgroundIds instanceof Set)) WS.videoThumbInFlightBackgroundIds = new Set();
      if (WS.videoThumbActive >= MAX_VIDEO_THUMB_ACTIVE) return;
      while (WS.videoThumbActive < MAX_VIDEO_THUMB_ACTIVE) {
        const fromPriority = WS.videoThumbPriorityQueue.length > 0;
        if (!fromPriority && WS.videoThumbQueue.length <= 0) break;
        if (!fromPriority && WS.videoThumbInFlightBackgroundIds.size >= MAX_VIDEO_THUMB_BACKGROUND_ACTIVE) break;

        const id = String(fromPriority
          ? (WS.videoThumbPriorityQueue.shift() || "")
          : (WS.videoThumbQueue.shift() || ""));
        if (!id) continue;
        WS.videoThumbQueuedIds.delete(id);
        if (WS.videoThumbInFlightIds.has(id)) continue;
        const rec = WS.fileById.get(id);
        if (!rec || rec.type !== "video") continue;
        const mode = currentVideoThumbMode();
        if (rec.videoThumbUrl && rec.videoThumbMode === mode) continue;

        WS.videoThumbInFlightIds.add(id);
        if (!fromPriority) WS.videoThumbInFlightBackgroundIds.add(id);
        WS.videoThumbActive++;
        generateVideoThumb(rec).catch(() => {}).finally(() => {
          WS.videoThumbInFlightIds.delete(id);
          WS.videoThumbInFlightBackgroundIds.delete(id);
          WS.videoThumbActive = Math.max(0, (WS.videoThumbActive | 0) - 1);
          if (!WS.videoThumbPrewarmBlocking) {
            renderPreviewPane(false);
            refreshDirectoryInlinePreviewThumbForRecord(rec);
          }
          drainVideoThumbQueue();
        });
      }
    }

    async function waitForVideoLoadedData(videoEl, timeoutMs = 1500) {
      if (!videoEl) return;
      if (videoEl.readyState >= 2 && (videoEl.videoWidth || 0) > 0 && (videoEl.videoHeight || 0) > 0) return;
      await new Promise((resolve) => {
        let done = false;
        let timer = 0;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          videoEl.removeEventListener("loadeddata", onReady);
          videoEl.removeEventListener("canplay", onReady);
          resolve();
        };
        const onReady = () => {
          if (videoEl.readyState >= 2 && (videoEl.videoWidth || 0) > 0 && (videoEl.videoHeight || 0) > 0) finish();
        };
        videoEl.addEventListener("loadeddata", onReady);
        videoEl.addEventListener("canplay", onReady);
        timer = setTimeout(finish, Math.max(300, timeoutMs | 0));
        onReady();
      });
    }

    async function waitForVideoMetadata(videoEl, timeoutMs = 2500) {
      if (!videoEl) return;
      if (videoEl.readyState >= 1 && Number(videoEl.videoWidth || 0) > 0 && Number(videoEl.videoHeight || 0) > 0) return;
      await new Promise((resolve, reject) => {
        let done = false;
        let timer = 0;
        const finish = (err = null) => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          try { videoEl.removeEventListener("loadedmetadata", onMeta); } catch {}
          try { videoEl.removeEventListener("error", onErr); } catch {}
          if (err) reject(err);
          else resolve();
        };
        const onMeta = () => finish();
        const onErr = () => finish(new Error("video load failed"));
        try { videoEl.addEventListener("loadedmetadata", onMeta); } catch {}
        try { videoEl.addEventListener("error", onErr); } catch {}
        timer = setTimeout(() => finish(new Error("video metadata timeout")), Math.max(400, timeoutMs | 0));
      });
    }

    async function waitForVideoFrameReady(videoEl, timeoutMs = 1200) {
      if (!videoEl) return;
      await new Promise((resolve) => {
        let done = false;
        let timer = 0;
        let pollTimer = 0;
        let frameHandle = 0;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          if (pollTimer) clearInterval(pollTimer);
          if (typeof videoEl.cancelVideoFrameCallback === "function" && frameHandle) {
            try { videoEl.cancelVideoFrameCallback(frameHandle); } catch {}
          }
          videoEl.removeEventListener("loadeddata", onReadySignal);
          videoEl.removeEventListener("canplay", onReadySignal);
          videoEl.removeEventListener("canplaythrough", onReadySignal);
          resolve();
        };
        const onReadySignal = () => {
          if (videoEl.readyState >= 2 && (videoEl.videoWidth || 0) > 0 && (videoEl.videoHeight || 0) > 0) finish();
        };
        videoEl.addEventListener("loadeddata", onReadySignal);
        videoEl.addEventListener("canplay", onReadySignal);
        videoEl.addEventListener("canplaythrough", onReadySignal);
        if (typeof videoEl.requestVideoFrameCallback === "function") {
          try {
            frameHandle = videoEl.requestVideoFrameCallback(() => finish());
          } catch {}
        }
        pollTimer = setInterval(onReadySignal, 50);
        timer = setTimeout(finish, Math.max(250, timeoutMs | 0));
        onReadySignal();
      });
    }

    async function seekVideoForThumb(videoEl, targetTime, timeoutMs = 1400) {
      if (!videoEl) return;
      const duration = Number(videoEl.duration || 0);
      const maxTime = Number.isFinite(duration) && duration > 0
        ? Math.max(0, duration - 0.05)
        : 0;
      const target = clampNumber(targetTime, 0, maxTime, 0);
      await new Promise((resolve) => {
        let done = false;
        let timer = 0;
        const finish = () => {
          if (done) return;
          done = true;
          if (timer) clearTimeout(timer);
          videoEl.removeEventListener("seeked", onSeeked);
          resolve();
        };
        const onSeeked = () => finish();
        videoEl.addEventListener("seeked", onSeeked);
        timer = setTimeout(finish, Math.max(350, timeoutMs | 0));
        try {
          const cur = Number(videoEl.currentTime || 0);
          if (Math.abs(cur - target) < 0.03) finish();
          else videoEl.currentTime = target;
        } catch {
          finish();
        }
      });
      await waitForVideoFrameReady(videoEl, timeoutMs);
    }

    function computeVideoThumbSeekTimes(durationValue, preferredTime = null) {
      const duration = Number(durationValue || 0);
      if (!Number.isFinite(duration) || duration <= 0) return [0];
      const maxTime = Math.max(0, duration - 0.05);
      const preferred = normalizeVideoThumbTimeValue(preferredTime, duration);
      const raw = [];
      if (Number.isFinite(preferred)) raw.push(preferred);
      raw.push(
        clampNumber(duration * 0.12, 0, maxTime, 0),
        clampNumber(0.8, 0, maxTime, 0),
        clampNumber(duration * 0.33, 0, maxTime, 0),
        clampNumber(duration * 0.5, 0, maxTime, 0)
      );
      const out = [];
      for (const t of raw) {
        if (!Number.isFinite(t)) continue;
        if (!out.length || Math.abs(out[out.length - 1] - t) > 0.08) out.push(t);
      }
      if (!out.length) out.push(0);
      return out;
    }

    function isVideoFrameLikelyBlank(videoEl) {
      const srcW = Number(videoEl?.videoWidth || 0);
      const srcH = Number(videoEl?.videoHeight || 0);
      if (!(srcW > 0 && srcH > 0)) return true;
      const maxSide = 96;
      const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
      const w = Math.max(16, Math.round(srcW * scale));
      const h = Math.max(16, Math.round(srcH * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return false;
      try {
        ctx.drawImage(videoEl, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        let lumaSum = 0;
        let brightCount = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const luma = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
          lumaSum += luma;
          if (Math.max(r, g, b) >= 26) brightCount++;
        }
        const px = Math.max(1, w * h);
        const avgLuma = lumaSum / px;
        const brightRatio = brightCount / px;
        return avgLuma < 12 || brightRatio < 0.015;
      } catch {
        return false;
      }
    }

    async function generateVideoThumb(rec) {
      const url = ensureMediaUrl(rec);
      if (!url) return;

      const mode = currentVideoThumbMode();
      if (rec.videoThumbUrl) {
        try { URL.revokeObjectURL(rec.videoThumbUrl); } catch {}
        rec.videoThumbUrl = null;
      }
      rec.videoThumbMode = mode;

      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      normalizeVideoPlaybackRate(v);
      v.playsInline = true;
      v.crossOrigin = "anonymous";
      v.src = url;

      try {
        await waitForVideoMetadata(v, 2500);
        await waitForVideoLoadedData(v, 1500);

        const seekTimes = computeVideoThumbSeekTimes(v.duration || 0, metaGetVideoThumbnailTimeForRecord(rec));
        const w = videoThumbWidthForOption();
        const jpgQuality = isGridInteractionMode()
          ? (mode === "high" ? 0.85 : (mode === "medium" ? 0.75 : 0.65))
          : (mode === "high" ? 0.75 : 0.6);

        let blob = null;
        for (let i = 0; i < seekTimes.length; i++) {
          await seekVideoForThumb(v, seekTimes[i], 1400);
          const frameLooksBlank = isVideoFrameLikelyBlank(v);
          if (frameLooksBlank && i < seekTimes.length - 1) continue;

          updateVideoCropFromElement(rec, v);
          const cropRect = computeCroppedSourceRect(
            v.videoWidth || w,
            v.videoHeight || Math.max(1, Math.round(w / (4 / 3))),
            getVideoCropForRecord(rec)
          );
          const ar = (cropRect.sw && cropRect.sh)
            ? (cropRect.sw / cropRect.sh)
            : ((v.videoWidth && v.videoHeight) ? (v.videoWidth / v.videoHeight) : (4 / 3));
          rec.previewAspect = normalizePreviewAspect(ar, 4 / 3);
          const h = Math.max(120, Math.round(w / ar));

          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          renderFilteredToCanvas(ctx, v, v.videoWidth || w, v.videoHeight || h, w, h, getMediaFilterForType(), true, rec);

          blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", jpgQuality));
          if (blob) break;
        }

        if (!blob) return;
        rec.videoThumbUrl = URL.createObjectURL(blob);
      } finally {
        try { v.pause(); } catch {}
        try { v.removeAttribute("src"); } catch {}
        try { v.load(); } catch {}
      }
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
        if (mode === "high" && !thumbFiltersActive(rec)) continue;
        if (rec.thumbUrl && rec.thumbMode === mode) continue;

        WS.imageThumbActive++;
        generateImageThumb(rec).catch(() => {}).finally(() => {
          WS.imageThumbActive--;
          renderPreviewPane(false);
          refreshDirectoryInlinePreviewThumbForRecord(rec);
          drainImageThumbQueue();
        });
      }
    }

    async function generateImageThumb(rec) {
      const mode = WS.meta && WS.meta.options ? String(WS.meta.options.imageThumbSize || "medium") : "medium";
      if (mode === "high" && !thumbFiltersActive(rec)) {
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
      rec.previewAspect = normalizePreviewAspect(ar, 4 / 3);
      const h = Math.max(120, Math.round(w / ar));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      renderFilteredToCanvas(ctx, bmp, bmp.width || w, bmp.height || h, w, h, getMediaFilterForType(), true, rec);

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

    function openGalleryForDir(dirNode, startId = null, requestFullscreen = false, skipDirSyncOnClose = false) {
      viewerDirNode = dirNode;
      viewerItems = buildViewerItemsForDir(viewerDirNode);

      if (!viewerItems.length) {
        VIEWER_SKIP_DIR_SYNC_ON_CLOSE = false;
        return;
      }

      let idx = 0;
      if (startId) {
        const found = viewerItems.findIndex(it => !it.isFolder && it.id === startId);
        if (found >= 0) idx = found;
      }
      viewerIndex = idx;
      VIEWER_SKIP_DIR_SYNC_ON_CLOSE = !!skipDirSyncOnClose;

      showOverlay();
      if (requestFullscreen) enterFullscreenIfPossible();
    }

    function openGalleryForFileRecord(rec, requestFullscreen = false) {
      if (!rec) return;
      const p = String(rec.dirPath || "");
      const dn = WS.dirByPath.get(p) || WS.nav.dirNode || WS.root || null;
      viewerDirNode = dn;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      let idx = viewerItems.findIndex(it => !it.isFolder && it.id === rec.id);
      if (idx < 0) {
        viewerItems = [{ isFolder: false, id: rec.id }];
        idx = 0;
      }
      viewerIndex = idx;
      VIEWER_SKIP_DIR_SYNC_ON_CLOSE = false;
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
        if (rec) openGalleryForFileRecord(rec, requestFullscreen);
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
        normalizeVideoPlaybackRate(viewerVideoEl);
        viewerVideoEl.poster = BLACK_POSTER_URL;
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
        applyVideoCropToElement(viewerVideoEl, null);
        viewerVideoEl.classList.remove("ready");
        viewerVideoEl.classList.remove("mediaHidden");
        clearPendingFilmCornerMask(viewerVideoEl);
        viewerVideoEl.style.display = "none";
      }
      if (viewerImgEl) {
        try { viewerImgEl.removeAttribute("src"); } catch {}
        viewerImgEl.classList.remove("ready");
        viewerImgEl.classList.remove("mediaHidden");
        clearPendingFilmCornerMask(viewerImgEl);
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
      const skipDirSyncOnClose = !!VIEWER_SKIP_DIR_SYNC_ON_CLOSE;
      VIEWER_SKIP_DIR_SYNC_ON_CLOSE = false;
      if (skipDirSyncOnClose) {
        leaveDirectory();
      } else {
        syncDirectoriesToViewerState();
        // In grid mode, closing gallery should always land on the Up Directory tile when available.
        selectGridUpEntryIfAvailable();
      }
      if (!VIEWER_MODE && WS.preview.kind === "file" && WS.preview.fileId) ACTIVE_MEDIA_SURFACE = "preview";
      else if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";
      resumePreviewVideoAfterOverlay();
    }

    function showUI() { overlay.classList.remove("ui-hidden"); }
    function hideUI() { overlay.classList.add("ui-hidden"); }

    function showGlobalCursor() {
      document.body.classList.remove("cursor-hidden");
    }

    function hideGlobalCursor() {
      document.body.classList.add("cursor-hidden");
    }

    function resetGlobalCursorHideTimer() {
      showGlobalCursor();
      if (globalCursorHideTimer) { clearTimeout(globalCursorHideTimer); globalCursorHideTimer = null; }
      globalCursorHideTimer = setTimeout(() => { hideGlobalCursor(); }, 2000);
    }

    function resetUIHideTimer() {
      showUI();
      if (uiHideTimer) { clearTimeout(uiHideTimer); uiHideTimer = null; }
      uiHideTimer = setTimeout(() => { hideUI(); }, 2000);
    }

    overlay.addEventListener("mousemove", () => {
      if (!VIEWER_MODE) return;
      resetUIHideTimer();
    });

    document.addEventListener("mousemove", resetGlobalCursorHideTimer, { passive: true });
    resetGlobalCursorHideTimer();

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
      const behavior = normalizeFolderBehavior(WS.view.folderBehavior, "slide");

      let i = viewerIndex + delta;

      if (behavior === "slide") {
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

    function viewerJumpToNextFolderFirstFile() {
      if (!viewerDirNode) return;
      moveToNextDirectoryFile();
    }

    function viewerJumpToPrevFolderFirstFile() {
      if (!viewerDirNode) return;
      moveToPrevDirectoryFirstFile();
    }

    function jumpViewerToDirectoryFirstFile(dirNode) {
      if (!dirNode) return false;
      viewerDirNode = dirNode;
      viewerItems = buildViewerItemsForDir(viewerDirNode);
      if (!viewerItems.length) return false;
      const firstFileIndex = findFirstFileIndex(viewerItems);
      if (firstFileIndex < 0) return false;
      viewerIndex = firstFileIndex;
      if (VIEWER_MODE) renderViewerItem(viewerIndex);
      syncDirectoriesToViewerState();
      return true;
    }

    function randomFirstFileJumpFromViewer() {
      const sourceDir = viewerDirNode || WS.nav.dirNode;
      if (!sourceDir) {
        showStatusMessage("First File Jump unavailable here.");
        return false;
      }
      if (!canUseFolderJumpActions()) {
        showStatusMessage("First File Jump unavailable here.");
        return false;
      }
      const targetDir = pickRandomFirstFileJumpTarget(sourceDir);
      if (!targetDir) {
        showStatusMessage("First File Jump: no matching folder.");
        return false;
      }
      const ok = jumpViewerToDirectoryFirstFile(targetDir);
      if (ok) showStatusMessage("First File Jump");
      else showStatusMessage("First File Jump: no files.");
      return ok;
    }

    function renderViewerItem(idx) {
      if (!viewerItems.length) {
        applyScrollImageMode(viewport, viewerImgEl, "none");
        if (viewerImgEl) viewerImgEl.style.display = "none";
        if (viewerVideoEl) viewerVideoEl.style.display = "none";
        if (viewerFolderEl) viewerFolderEl.style.display = "none";
        filenameEl.textContent = "";
        MediaFilterEngine.detach("viewer");
        if (viewerImgEl) {
          viewerImgEl.classList.remove("mediaHidden");
          clearPendingFilmCornerMask(viewerImgEl);
        }
        if (viewerVideoEl) {
          viewerVideoEl.classList.remove("mediaHidden");
          clearPendingFilmCornerMask(viewerVideoEl);
        }
        return;
      }

      ensureViewerElements();
      applyScrollImageMode(viewport, viewerImgEl, "none");

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
        applyVideoCropToElement(viewerVideoEl, null);
        clearPendingFilmCornerMask(viewerVideoEl);
      }
      if (viewerImgEl) {
        viewerImgEl.classList.remove("ready");
        viewerImgEl.style.display = "none";
        clearPendingFilmCornerMask(viewerImgEl);
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
        name.textContent = dirDisplayName(item.dirNode) || "Folder";

        viewerFolderEl.appendChild(icon);
        viewerFolderEl.appendChild(name);

        filenameEl.textContent = item.dirNode?.path ? displayPath(item.dirNode.path) : (dirDisplayName(item.dirNode) || "");
        return;
      }

      const rec = WS.fileById.get(item.id);
      if (!rec) return;

      filenameEl.textContent = relPathDisplayName(rec.relPath || rec.name || "");

      if (rec.type === "video") {
        const mode = galleryVideoMode();
        const doAuto = mode !== "off" && !BANIC_ACTIVE;
        if (previewVideoEl) { try { previewVideoEl.pause(); } catch {} }
        normalizeVideoPlaybackRate(viewerVideoEl);
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
          if (updateVideoCropFromElement(rec, viewerVideoEl)) {
            applyVideoCropToElement(viewerVideoEl, rec);
            kickVideoThumbsForPreview();
            renderPreviewPane(false, true);
          } else {
            applyVideoCropToElement(viewerVideoEl, rec);
          }
          MediaFilterEngine.requestRender();
        };

        applyVideoPoster(viewerVideoEl, rec);
        applyVideoCropToElement(viewerVideoEl, rec);
        const src = ensureMediaUrl(rec) || "";
        const same = viewerVideoEl.src === src;
        if (!same) {
          viewerVideoEl.src = src;
          try { viewerVideoEl.load(); } catch {}
        }
        viewerVideoEl.style.display = "block";
        viewerVideoEl.setAttribute("data-dir-path", rec.dirPath || "");
        applyPendingFilmCornerMask(viewerVideoEl, rec.dirPath || "");
        syncMediaFilterSurface("viewer", viewerVideoEl, viewport, "video", rec);

        applyVideoCarryToElement(viewerVideoEl, rec.id);

        if (viewerVideoEl.readyState >= 2) {
          requestAnimationFrame(() => {
            viewerVideoEl.classList.add("ready");
            if (updateVideoCropFromElement(rec, viewerVideoEl)) {
              applyVideoCropToElement(viewerVideoEl, rec);
              kickVideoThumbsForPreview();
              renderPreviewPane(false, true);
            } else {
              applyVideoCropToElement(viewerVideoEl, rec);
            }
          });
        }
        if (doAuto) { try { viewerVideoEl.play(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      viewerImgEl.onload = () => {
        viewerImgEl.classList.add("ready");
        const imageMode = detectScrollImageMode(rec, viewerImgEl);
        applyScrollImageMode(viewport, viewerImgEl, imageMode, false);
        if (imageMode !== "none") {
          clearMediaFilterSurface("viewer", viewerImgEl);
          applyScrollImageProcessingFallback(viewerImgEl, rec, imageMode);
          viewerImgEl.classList.remove("mediaHidden");
        } else {
          applyScrollImageProcessingFallback(viewerImgEl, rec, "none");
          syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", rec);
        }
        MediaFilterEngine.requestRender();
      };
      const src = ensureMediaUrl(rec) || "";
      const same = viewerImgEl.src === src;
      if (!same) viewerImgEl.src = src;
      viewerImgEl.style.display = "block";
      const viewerIsGif = isGifRecord(rec);
      viewerImgEl.setAttribute("data-is-gif", viewerIsGif ? "1" : "0");
      viewerImgEl.setAttribute("data-dir-path", rec.dirPath || "");
      const viewerMode = detectScrollImageMode(rec, viewerImgEl);
      applyScrollImageMode(viewport, viewerImgEl, viewerMode, !same);
      if (viewerMode !== "none") {
        clearPendingFilmCornerMask(viewerImgEl);
        clearMediaFilterSurface("viewer", viewerImgEl);
        applyScrollImageProcessingFallback(viewerImgEl, rec, viewerMode);
        viewerImgEl.classList.remove("mediaHidden");
      } else {
        applyPendingFilmCornerMask(viewerImgEl, rec.dirPath || "");
        applyScrollImageProcessingFallback(viewerImgEl, rec, "none");
        syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", rec);
      }

      if (viewerImgEl.complete && viewerImgEl.naturalWidth > 0) {
        requestAnimationFrame(() => {
          viewerImgEl.classList.add("ready");
          const imageMode = detectScrollImageMode(rec, viewerImgEl);
          applyScrollImageMode(viewport, viewerImgEl, imageMode, false);
          if (imageMode !== "none") {
            clearPendingFilmCornerMask(viewerImgEl);
            clearMediaFilterSurface("viewer", viewerImgEl);
            applyScrollImageProcessingFallback(viewerImgEl, rec, imageMode);
            viewerImgEl.classList.remove("mediaHidden");
          } else {
            applyPendingFilmCornerMask(viewerImgEl, rec.dirPath || "");
            applyScrollImageProcessingFallback(viewerImgEl, rec, "none");
            syncMediaFilterSurface("viewer", viewerImgEl, viewport, "image", rec);
          }
        });
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
      if (tryRestoreTagDirectoryContext()) return;
      if (isViewingTagFolder()) {
        exitTagFolderView();
        return;
      }
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
      WS.view.pendingDirScroll = "center-selected";
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
        const placeholderName = (function () {
          if (!hasWS) return "folder";
          if (WS.view.favoritesMode) return "Favorites";
          if (WS.view.hiddenMode) return "Hidden";
          const node = WS.nav.dirNode;
          if (node && node.name) {
            const nm = dirDisplayName(node);
            if (nm) return nm;
          }
          const p = String(node?.path || "");
          if (p) {
            const parts = p.split(/[/\\\\]+/).filter(Boolean);
            if (parts.length) return parts[parts.length - 1];
          }
          return "folder";
        })();
        directoriesSearchInput.placeholder = `Search ${placeholderName}`;
      }
      if (directoriesSearchClearBtn) {
        const enabled = hasWS && (WS.view.dirSearchPinned || String(WS.view.dirSearchQuery || "").trim());
        directoriesSearchClearBtn.disabled = !enabled;
      }

      if (dirBackBtn) dirBackBtn.disabled = !(WS.view.dirHistoryIndex > 0);
      if (dirForwardBtn) dirForwardBtn.disabled = !(WS.view.dirHistoryIndex >= 0 && WS.view.dirHistoryIndex < WS.view.dirHistory.length - 1);
      if (dirUpBtn) {
        const canExitRoot = WS.nav.dirNode === WS.root && !WS.view.aboveRootView && showRootViewEnabled();
        const canGoUp = !!WS.nav.dirNode && (!!WS.nav.dirNode.parent || canExitRoot);
        dirUpBtn.disabled = !canGoUp || (WS.view.dirSearchPinned && WS.view.searchRootActive) || WS.view.favoritesMode || WS.view.hiddenMode;
      }

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

      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();

      renderDirectoriesPane(true);
      renderPreviewPane(animate, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function applyRandomSortModeEverywhere(animate = false) {
      if (VIEWER_MODE) {
        if (!viewerDirNode) return;
        const currentItem = viewerItems[viewerIndex] || null;
        viewerItems = buildViewerItemsForDir(viewerDirNode);
        if (!viewerItems.length) return;
        let nextIndex = 0;
        if (currentItem) {
          if (currentItem.isFolder) {
            const path = String(currentItem.dirNode?.path || "");
            const found = viewerItems.findIndex(item => item.isFolder && String(item.dirNode?.path || "") === path);
            if (found >= 0) nextIndex = found;
          } else {
            const found = viewerItems.findIndex(item => !item.isFolder && item.id === currentItem.id);
            if (found >= 0) nextIndex = found;
          }
        }
        viewerIndex = Math.max(0, Math.min(viewerItems.length - 1, nextIndex));
        renderViewerItem(viewerIndex);
        syncDirectoriesToViewerState();
        return;
      }
      if (!WS.root || (!WS.nav.dirNode && !WS.view.favoritesMode && !WS.view.hiddenMode)) {
        applyViewModesEverywhere(animate);
        return;
      }
      const currentEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
      const currentKey = currentEntry
        ? (currentEntry.kind === "dir"
          ? { kind: "dir", path: String(currentEntry.node?.path || "") }
          : (currentEntry.kind === "file"
            ? { kind: "file", id: String(currentEntry.id || "") }
            : { kind: "tag", label: String(currentEntry.label || ""), tag: String(currentEntry.tag || ""), special: String(currentEntry.special || "") }))
        : null;
      rebuildDirectoriesEntries();
      let nextIndex = -1;
      if (currentKey) {
        for (let i = 0; i < WS.nav.entries.length; i++) {
          const entry = WS.nav.entries[i];
          if (!entry || entry.kind !== currentKey.kind) continue;
          if (entry.kind === "dir" && String(entry.node?.path || "") === currentKey.path) { nextIndex = i; break; }
          if (entry.kind === "file" && String(entry.id || "") === currentKey.id) { nextIndex = i; break; }
          if (entry.kind === "tag"
            && String(entry.label || "") === currentKey.label
            && String(entry.tag || "") === currentKey.tag
            && String(entry.special || "") === currentKey.special) { nextIndex = i; break; }
        }
      }
      const fallbackIndex = nextIndex >= 0 ? nextIndex : WS.nav.selectedIndex;
      WS.nav.selectedIndex = findNearestSelectableIndex(fallbackIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(animate, true);
      syncButtons();
      kickVideoThumbsForPreview();
      kickImageThumbsForPreview();
    }

    function toggleRandomSortMode() {
      if (!WS.root) return false;
      WS.view.randomMode = !WS.view.randomMode;
      if (WS.view.randomMode) {
        WS.view.randomFolderMode = false;
        reseedRandomSortMode();
      } else {
        WS.view.randomCache = new Map();
      }
      WS.view.randomFolderCache = new Map();
      applyRandomSortModeEverywhere(true);
      showStatusMessage(`Random file sort: ${WS.view.randomMode ? "On" : "Off"}`);
      return true;
    }

    function toggleRandomFolderSortMode() {
      if (!WS.root) return false;
      WS.view.randomFolderMode = !WS.view.randomFolderMode;
      if (WS.view.randomFolderMode) {
        WS.view.randomMode = false;
        reseedRandomSortMode();
      } else {
        WS.view.randomFolderCache = new Map();
      }
      WS.view.randomCache = new Map();
      applyRandomSortModeEverywhere(true);
      showStatusMessage(`Random folder sort: ${WS.view.randomFolderMode ? "On" : "Off"}`);
      return true;
    }

    function runRandomActionForDirectories() {
      const mode = randomActionMode();
      if (mode === "randomFileSort") return toggleRandomSortMode();
      if (mode === "randomFolderSort") return toggleRandomFolderSortMode();
      return randomFirstFileJumpFromDirectories();
    }

    function runRandomActionForViewer() {
      const mode = randomActionMode();
      if (mode === "randomFileSort") return toggleRandomSortMode();
      if (mode === "randomFolderSort") return toggleRandomFolderSortMode();
      return randomFirstFileJumpFromViewer();
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

    const COLOR_SCHEME_CYCLE = [
      { value: "classic", label: "Classic Dark" },
      { value: "light", label: "Light" },
      { value: "superdark", label: "OLED Dark" }
    ];

    const VIDEO_END_BEHAVIOR_CYCLE = [
      { value: "loop", label: "Loop video" },
      { value: "next", label: "Advance to next item" },
      { value: "stop", label: "Stop at end" }
    ];

    const ANIMATED_FILTER_CYCLE = [
      { value: "off", label: "Off" },
      { value: "on", label: "On" },
      { value: "videos", label: "Videos only" }
    ];

    const SLIDER_KEYBIND_CONFIG = {
      stepVibrantOverlayIntensity: {
        keys: ["vibrantOverlayIntensity"],
        min: 0,
        max: 1,
        step: 0.05,
        label: "Vibrant overlay intensity",
        format: (value) => `${Math.round(clampNumber(value, 0, 1, 1) * 100)}%`
      },
      stepPixelationResolution: {
        keys: ["crtPixelateResolution"],
        min: 2,
        max: 8,
        step: 0.5,
        label: "Pixelation resolution",
        format: (value) => `${Number(clampNumber(value, 2, 8, 4).toFixed(1)).toString()}x`
      },
      stepFilmGrainAmount: {
        keys: ["crtGrainAmount"],
        min: 0,
        max: 0.25,
        step: 0.01,
        label: "Film grain amount",
        format: (value) => `${Math.round(clampNumber(value, 0, 0.25, 0.06) * 100)}%`
      },
      stepVhsIntensity: {
        keys: ["vhsBlurAmount", "vhsChromaAmount"],
        min: 0,
        max: 3,
        step: 0.1,
        label: "VHS intensity",
        format: (value) => Number(clampNumber(value, 0, 3, 1.2).toFixed(1)).toString()
      }
    };

    function cycleFilterMode() {
      const m = WS.view.filterMode;
      WS.view.filterMode = (m === "all") ? "images" : (m === "images") ? "videos" : (m === "videos") ? "gifs" : "all";
      applyViewModesEverywhere(true);
      showStatusMessage(`Filter: ${WS.view.filterMode}`);
    }

    function cycleFolderBehavior() {
      const b = normalizeFolderBehavior(WS.view.folderBehavior, "slide");
      const next = (b === "stop") ? "slide" : "stop";
      WS.view.folderBehavior = next;
      if (WS.meta && WS.meta.options) {
        WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, { defaultFolderBehavior: next }));
        WS.meta.dirty = true;
        metaScheduleSave();
      }
      applyViewModesEverywhere(true);
      showStatusMessage(`Folder behavior: ${WS.view.folderBehavior}`);
    }

    function setOptionValues(nextValues) {
      if (!WS.meta) return null;
      WS.meta.options = normalizeOptions(Object.assign({}, WS.meta.options || {}, nextValues || {}));
      WS.meta.dirty = true;
      metaScheduleSave();
      return WS.meta.options || null;
    }

    function setOptionValue(key, value) {
      const options = setOptionValues({ [key]: value });
      return options ? options[key] : null;
    }

    function toggleOptionValue(key) {
      const current = WS.meta && WS.meta.options ? !!WS.meta.options[key] : false;
      return setOptionValue(key, !current);
    }

    function cycleOptionValue(key, list) {
      const values = list.map(entry => entry.value);
      const current = WS.meta && WS.meta.options ? String(WS.meta.options[key] || "") : "";
      const idx = values.indexOf(current);
      const next = values[(idx >= 0 ? idx + 1 : 0) % values.length];
      setOptionValue(key, next);
      return next;
    }

    function labelForCycleValue(list, value) {
      const entry = list.find(item => item.value === value);
      return entry ? entry.label : String(value || "");
    }

    function decimalPlaces(value) {
      const raw = String(value);
      const dot = raw.indexOf(".");
      if (dot < 0) return 0;
      return raw.length - dot - 1;
    }

    function stepRangeOptionValue(keys, min, max, step) {
      if (!WS.meta) return null;
      const targetKeys = Array.isArray(keys) ? keys.filter(Boolean) : [String(keys || "")];
      if (!targetKeys.length) return null;
      const options = WS.meta.options || {};
      let total = 0;
      let count = 0;
      for (const key of targetKeys) {
        const currentRaw = Number(options[key]);
        if (!Number.isFinite(currentRaw)) continue;
        total += clampNumber(currentRaw, min, max, min);
        count++;
      }
      const current = count ? (total / count) : min;
      const totalSteps = Math.max(1, Math.round((max - min) / step));
      const currentStep = Math.max(0, Math.min(totalSteps, Math.round((current - min) / step)));
      const nextStep = (currentStep + 1 > totalSteps) ? 0 : (currentStep + 1);
      const places = Math.max(decimalPlaces(step), decimalPlaces(min), decimalPlaces(max));
      const factor = Math.pow(10, places);
      const nextRaw = min + (nextStep * step);
      const next = Math.round(nextRaw * factor) / factor;
      const nextValue = clampNumber(next, min, max, min);
      const updates = {};
      targetKeys.forEach((key) => {
        updates[key] = nextValue;
      });
      setOptionValues(updates);
      return nextValue;
    }

    function handleExtrasKeybindAction(action) {
      if (!action || !WS.meta) return false;
      const sliderCfg = SLIDER_KEYBIND_CONFIG[action];
      if (sliderCfg) {
        const next = stepRangeOptionValue(sliderCfg.keys, sliderCfg.min, sliderCfg.max, sliderCfg.step);
        applyMediaFilterFromOptions();
        const valueLabel = typeof sliderCfg.format === "function" ? sliderCfg.format(next) : String(next);
        showStatusMessage(`${sliderCfg.label}: ${valueLabel}`);
        return true;
      }
      switch (action) {
        case "toggleVibrantOverlay": {
          const next = toggleOptionValue("vibrantOverlayEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Vibrant overlay: ${next ? "On" : "Off"}`);
          return true;
        }
        case "cycleColorScheme": {
          setOptionValues({ colorScheme: "superdark" });
          applyColorSchemeFromOptions();
          showStatusMessage("Color scheme: OLED Dark (locked)");
          return true;
        }
        case "toggleRetroMode": {
          const next = toggleOptionValue("retroMode");
          applyRetroModeFromOptions();
          showStatusMessage(`Retro mode: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleScanlinesOverlay": {
          const next = toggleOptionValue("crtScanlinesEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Scanlines: ${next ? "On" : "Off"}`);
          return true;
        }
        case "togglePixelatedOverlay": {
          const next = toggleOptionValue("crtPixelateEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Pixelated overlay: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleFilmGrainOverlay": {
          const next = toggleOptionValue("crtGrainEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Film grain: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleVhsOverlay": {
          const next = toggleOptionValue("vhsOverlayEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`VHS overlay: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleFilmCornersOverlay": {
          const next = toggleOptionValue("filmCornerOverlayEnabled");
          applyMediaFilterFromOptions();
          showStatusMessage(`Film corners: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleAnimatedFilters": {
          const next = cycleOptionValue("animatedMediaFilters", ANIMATED_FILTER_CYCLE);
          applyMediaFilterFromOptions();
          showStatusMessage(`Animated filters: ${labelForCycleValue(ANIMATED_FILTER_CYCLE, next)}`);
          return true;
        }
        case "cycleFolderSort": {
          WS.meta.dirSortMode = cycleDirSortMode(WS.meta.dirSortMode);
          WS.meta.dirty = true;
          metaScheduleSave();
          applyViewModesEverywhere(true);
          showStatusMessage(`Folder sort: ${dirSortModeLabel(WS.meta.dirSortMode)}`);
          return true;
        }
        case "cycleFolderBehavior": {
          cycleFolderBehavior();
          return true;
        }
        case "cycleVideoEndBehavior": {
          const next = cycleOptionValue("videoEndBehavior", VIDEO_END_BEHAVIOR_CYCLE);
          showStatusMessage(`Video end: ${labelForCycleValue(VIDEO_END_BEHAVIOR_CYCLE, next)}`);
          return true;
        }
        case "toggleShowHiddenFolder": {
          const next = toggleOptionValue("showHiddenFolder");
          if (!next && WS.view.tagFolderActiveMode === "hidden") exitTagFolderView();
          renderDirectoriesPane(true);
          showStatusMessage(`Hidden folder: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowUntaggedFolder": {
          const next = toggleOptionValue("showUntaggedFolder");
          if (!next && WS.view.tagFolderActiveMode === "untagged") exitTagFolderView();
          renderDirectoriesPane(true);
          showStatusMessage(`Untagged folder: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleForceTitleCaps": {
          const next = toggleOptionValue("forceTitleCaps");
          applyOptionsEverywhere(false);
          showStatusMessage(`Force Title Case: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleHideBeforeLastDash": {
          const next = toggleOptionValue("hideBeforeLastDashInFileNames");
          applyOptionsEverywhere(false);
          showStatusMessage(`Hide name before last dash: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleHideAfterFirstUnderscore": {
          const next = toggleOptionValue("hideAfterFirstUnderscoreInFileNames");
          applyOptionsEverywhere(false);
          showStatusMessage(`Hide name after last underscore: ${next ? "On" : "Off"}`);
          return true;
        }
        case "moveThumbViewportLeft":
          return nudgeSelectedThumbnailViewport(-THUMB_VIEWPORT_NUDGE_STEP, 0);
        case "moveThumbViewportRight":
          return nudgeSelectedThumbnailViewport(THUMB_VIEWPORT_NUDGE_STEP, 0);
        case "moveThumbViewportUp":
          return nudgeSelectedThumbnailViewport(0, -THUMB_VIEWPORT_NUDGE_STEP);
        case "moveThumbViewportDown":
          return nudgeSelectedThumbnailViewport(0, THUMB_VIEWPORT_NUDGE_STEP);
        case "toggleShowPreviewFileName": {
          const next = toggleOptionValue("showPreviewFileName");
          renderPreviewPane(true, true);
          showStatusMessage(`Preview file names: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowPreviewFileType": {
          const next = toggleOptionValue("showPreviewFileTypeLabel");
          renderPreviewPane(true, true);
          showStatusMessage(`Preview file types: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowPreviewFolderCounts": {
          const next = toggleOptionValue("showPreviewFolderItemCount");
          renderPreviewPane(true, true);
          showStatusMessage(`Preview folder counts: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowFolderItemCounts": {
          const next = toggleOptionValue("showFolderItemCount");
          renderDirectoriesPane(true);
          showStatusMessage(`Folder counts: ${next ? "On" : "Off"}`);
          return true;
        }
        case "toggleShowDirFileTypeLabel": {
          const next = toggleOptionValue("showDirFileTypeLabel");
          renderDirectoriesPane(true);
          showStatusMessage(`Directory file types: ${next ? "On" : "Off"}`);
          return true;
        }
        default:
          return false;
      }
    }

    function moveDirectoriesSelection(delta) {
      if (!WS.root) return;
      if (!WS.nav.entries.length) return;

      // USER NOTE: keep a single selection path for files + folders.
      // Splitting file/folder movement logic here reintroduced file autoscroll regressions multiple times.
      WS.view.pendingDirScroll = "center-selected";
      setDirectoriesSelection(WS.nav.selectedIndex + delta);
    }

    function saveGridSelectionForCurrentContext() {
      if (!isGridInteractionMode()) return;
      if (!WS.view.gridSelectionByContext || !(WS.view.gridSelectionByContext instanceof Map)) {
        WS.view.gridSelectionByContext = new Map();
      }
      const key = directoriesScrollContextKey();
      if (!key) return;
      WS.view.gridSelectionByContext.set(key, WS.nav.selectedIndex | 0);
    }

    function restoreGridSelectionForCurrentContext(fallbackIndex = 0) {
      if (!isGridInteractionMode()) return findNearestSelectableIndex(fallbackIndex, 1);
      const key = directoriesScrollContextKey();
      const saved = (WS.view.gridSelectionByContext && WS.view.gridSelectionByContext instanceof Map)
        ? WS.view.gridSelectionByContext.get(key)
        : null;
      const seed = Number.isFinite(saved) ? Number(saved) : Number(fallbackIndex);
      return findNearestSelectableIndex(seed, 1);
    }

    let GRID_ROW_METRICS_CACHE_KEY = "";
    let GRID_ROW_METRICS_CACHE = null;
    function invalidateGridRowMetricsCache() {
      GRID_ROW_METRICS_CACHE_KEY = "";
      GRID_ROW_METRICS_CACHE = null;
    }

    function getGridRowMetrics() {
      if (!directoriesListEl) return [];
      const cacheKey = [
        directoriesScrollContextKey(),
        WS.nav.entries.length,
        directoriesListEl.clientWidth,
        directoriesListEl.clientHeight,
        directoriesListEl.scrollHeight,
        directoriesListEl.scrollWidth
      ].join("|");
      if (GRID_ROW_METRICS_CACHE && GRID_ROW_METRICS_CACHE_KEY === cacheKey) {
        return GRID_ROW_METRICS_CACHE;
      }
      const rows = Array.from(directoriesListEl.querySelectorAll(".dirRow"));
      const out = [];
      for (const rowEl of rows) {
        const idx = Number(rowEl?.dataset?.entryIndex);
        if (!Number.isFinite(idx)) continue;
        const left = Number(rowEl.offsetLeft) || 0;
        const top = Number(rowEl.offsetTop) || 0;
        const width = Number(rowEl.offsetWidth) || 0;
        const height = Number(rowEl.offsetHeight) || 0;
        out.push({
          idx,
          rowEl,
          cx: left + (width * 0.5),
          cy: top + (height * 0.5)
        });
      }
      GRID_ROW_METRICS_CACHE_KEY = cacheKey;
      GRID_ROW_METRICS_CACHE = out;
      return out;
    }

    function moveGridSelectionByDirection(direction) {
      if (!WS.root || !WS.nav.entries.length) return false;
      const metrics = getGridRowMetrics();
      if (!metrics.length) return false;
      const selected = metrics.find((m) => m.idx === WS.nav.selectedIndex);
      if (!selected) return false;

      let best = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const m of metrics) {
        if (!m || m.idx === selected.idx) continue;
        const dx = m.cx - selected.cx;
        const dy = m.cy - selected.cy;
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);
        let primary = 0;
        let secondary = 0;
        let valid = false;
        if (direction === "up" && dy < -2) {
          valid = true;
          primary = -dy;
          secondary = ax;
        } else if (direction === "down" && dy > 2) {
          valid = true;
          primary = dy;
          secondary = ax;
        } else if (direction === "left" && dx < -2) {
          valid = true;
          primary = -dx;
          secondary = ay;
        } else if (direction === "right" && dx > 2) {
          valid = true;
          primary = dx;
          secondary = ay;
        }
        if (!valid) continue;
        const score = primary * 1000 + secondary;
        if (score < bestScore) {
          bestScore = score;
          best = m;
        }
      }
      if (!best) {
        const step = (direction === "up" || direction === "left") ? -1 : 1;
        const start = Number.isFinite(WS.nav.selectedIndex) ? WS.nav.selectedIndex : 0;
        for (let idx = start + step; idx >= 0 && idx < WS.nav.entries.length; idx += step) {
          const entry = WS.nav.entries[idx];
          if (!isSelectableEntry(entry)) continue;
          WS.view.pendingDirScroll = "grid-nearest";
          setDirectoriesSelection(idx, { keepScroll: true });
          return true;
        }
        return false;
      }
      WS.view.pendingDirScroll = "grid-nearest";
      setDirectoriesSelection(best.idx, { keepScroll: true });
      return true;
    }

    function getGridViewerItemForEntry(entry) {
      if (!entry) return null;
      if (entry.kind === "file") {
        const rec = WS.fileById.get(entry.id);
        if (!rec) return null;
        return { isFolder: false, id: rec.id };
      }
      if (entry.kind === "dir" && entry.node) {
        return { isFolder: true, dirNode: entry.node };
      }
      if (entry.kind === "tag") {
        const tagNode = makeTagPreviewNode(entry);
        if (tagNode) return { isFolder: true, dirNode: tagNode };
      }
      if (entry.kind === "up") {
        const parentLabel = String(entry.parentLabel || "Parent");
        return {
          isFolder: true,
          dirNode: {
            name: `Up Directory (${parentLabel})`,
            path: `@up/${parentLabel}`,
            childrenDirs: [],
            childrenFiles: []
          }
        };
      }
      return null;
    }

    function renderCurrentGridSelectionInViewer() {
      if (!WS.root || !VIEWER_MODE) return false;
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      const item = getGridViewerItemForEntry(entry);
      if (!item) return false;
      viewerDirNode = WS.nav.dirNode || WS.root;
      viewerItems = [item];
      viewerIndex = 0;
      renderViewerItem(0);
      return true;
    }

    function moveGridGallerySelectionByDirection(direction) {
      if (!WS.root || !VIEWER_MODE || !isGridInteractionMode()) return false;
      const step = (direction === "up" || direction === "left") ? -1 : 1;
      const slide = slideStepFileInternal(step);
      if (slide.moved) {
        WS.view.pendingDirScroll = "grid-nearest";
        setDirectoriesSelection(WS.nav.selectedIndex, { keepScroll: true });
        return renderCurrentGridSelectionInViewer();
      }
      let moved = false;
      const start = Number.isFinite(WS.nav.selectedIndex) ? WS.nav.selectedIndex : 0;
      for (let idx = start + step; idx >= 0 && idx < WS.nav.entries.length; idx += step) {
        const entry = WS.nav.entries[idx];
        if (!entry || entry.kind !== "file") continue;
        WS.view.pendingDirScroll = "grid-nearest";
        setDirectoriesSelection(idx, { keepScroll: true });
        moved = true;
        break;
      }
      if (!moved) moved = moveGridSelectionByDirection(direction);
      if (!moved) return false;
      return renderCurrentGridSelectionInViewer();
    }

    function selectGridUpEntryIfAvailable() {
      if (!WS.root || !isGridInteractionMode()) return false;
      const upIdx = WS.nav.entries.findIndex((entry) => entry && entry.kind === "up");
      if (upIdx < 0) return false;
      WS.view.pendingDirScroll = "grid-nearest";
      setDirectoriesSelection(upIdx, { keepScroll: true });
      return true;
    }

    function openSelectedEntryInGridMode(requestFullscreen = true) {
      if (!WS.root || !WS.nav.entries.length) return false;
      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return false;
      if (entry.kind === "up") {
        goDirUp();
        return true;
      }
      if (entry.kind === "file") {
        openGalleryFromDirectoriesSelection(!!requestFullscreen);
        return true;
      }
      if (entry.kind === "tag") {
        enterSelectedDirectory();
        return true;
      }
      if (entry.kind !== "dir" || !entry.node) return false;
      enterSelectedDirectory();
      return true;
    }

    function getDirectorySelectionForKeybindAction() {
      const out = [];
      const seen = new Set();
      let usedBulk = false;

      if (WS.view.bulkSelectMode) {
        const selected = getSelectedPathsInCurrentDir();
        if (selected.length) usedBulk = true;
        for (let i = 0; i < selected.length; i++) {
          const p = String(selected[i] || "");
          if (!p || seen.has(p)) continue;
          seen.add(p);
          out.push(p);
        }
        return { paths: out, usedBulk };
      }

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (entry && entry.kind === "dir") {
        const p = String(entry.node?.path || "");
        if (p && !seen.has(p)) out.push(p);
      }

      return { paths: out, usedBulk };
    }

    function getFileSelectionForKeybindAction() {
      const out = [];
      const seen = new Set();
      let usedBulk = false;

      if (WS.view.bulkSelectMode) {
        const selected = getSelectedFileIdsInCurrentView();
        if (selected.length) usedBulk = true;
        for (let i = 0; i < selected.length; i++) {
          const id = String(selected[i] || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          out.push(id);
        }
        return { ids: out, usedBulk };
      }

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (entry && entry.kind === "file") {
        const id = String(entry.id || "");
        if (id && !seen.has(id)) out.push(id);
      }

      return { ids: out, usedBulk };
    }

    function selectDirectoryEntryByPath(path) {
      const p = String(path || "");
      if (!p) return false;
      const idx = findDirEntryIndexByPath(p);
      if (idx < 0) return false;
      WS.nav.selectedIndex = findNearestSelectableIndex(idx, 1);
      syncPreviewToSelection();
      return true;
    }

    function selectFileEntryById(fileId) {
      const id = String(fileId || "");
      if (!id) return false;
      for (let i = 0; i < WS.nav.entries.length; i++) {
        const entry = WS.nav.entries[i];
        if (entry && entry.kind === "file" && String(entry.id || "") === id) {
          WS.nav.selectedIndex = findNearestSelectableIndex(i, 1);
          syncPreviewToSelection();
          return true;
        }
      }
      return false;
    }

    function focusSelectedDirectoryInlineInput(selector) {
      setTimeout(() => {
        if (!directoriesListEl) return;
        const selectedInput = directoriesListEl.querySelector(`.dirRow.selected ${selector}`);
        const input = selectedInput || directoriesListEl.querySelector(selector);
        if (!input) return;
        try { input.focus(); input.select(); } catch {}
      }, 0);
    }

    function findPreviewFolderCardByPath(path) {
      const p = String(path || "");
      if (!p || !previewBodyEl) return null;
      const cards = previewBodyEl.querySelectorAll(".folderCard[data-dir-path]");
      for (const card of cards) {
        if (String(card?.dataset?.dirPath || "") === p) return card;
      }
      return null;
    }

    function focusPreviewFolderInlineInput(path, selector) {
      const p = String(path || "");
      const sel = String(selector || "");
      if (!p || !sel) return;
      setTimeout(() => {
        const card = findPreviewFolderCardByPath(p);
        if (!card || !card.querySelector) return;
        const input = card.querySelector(sel);
        if (!input) return;
        try { input.focus(); input.select(); } catch {}
      }, 0);
    }

    function startPreviewFolderTagEdit(paths, anchorPath = "") {
      const unique = Array.from(new Set((paths || []).map((p) => String(p || "")).filter(Boolean)));
      if (!unique.length) return false;
      const anchor = unique.includes(String(anchorPath || "")) ? String(anchorPath || "") : unique[0];
      clearBulkTagPlaceholder();
      closeActionMenus();
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      if (unique.length > 1) {
        TAG_EDIT_PATH = null;
        PREVIEW_BULK_TAG_EDIT = { paths: unique.slice(), anchorPath: anchor };
        if (anchor) selectDirectoryEntryByPath(anchor);
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
        focusPreviewFolderInlineInput(anchor, ".previewFolderTagInput");
        return true;
      }
      PREVIEW_BULK_TAG_EDIT = null;
      TAG_EDIT_PATH = unique[0];
      if (unique[0]) selectDirectoryEntryByPath(unique[0]);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusPreviewFolderInlineInput(unique[0], ".previewFolderTagInput");
      return true;
    }

    function startPreviewFolderRenameEdit(path) {
      const p = String(path || "");
      if (!p) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Rename requires a writable folder.");
        return false;
      }
      clearBulkTagPlaceholder();
      closeActionMenus();
      PREVIEW_BULK_TAG_EDIT = null;
      TAG_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      RENAME_EDIT_PATH = p;
      selectDirectoryEntryByPath(p);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusPreviewFolderInlineInput(p, ".previewFolderRenameInput");
      return true;
    }

    function applyFolderScoreSelectionAction(delta) {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      if (usedBulk) finalizeBulkSelectionAction();
      metaBumpScoreBulk(paths, delta);
      return true;
    }

    function startTagSelectionEdit() {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }

      if (usedBulk) finalizeBulkSelectionAction();

      closeActionMenus();
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;

      if (paths.length > 1) {
        TAG_EDIT_PATH = null;
        startBulkTagging(paths);
        return true;
      }

      const path = paths[0];
      TAG_EDIT_PATH = path;
      clearBulkTagPlaceholder();
      selectDirectoryEntryByPath(path);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusSelectedDirectoryInlineInput(".tagEditInput:not(.renameEditInput)");
      return true;
    }

    function toggleFavoriteSelection() {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      if (usedBulk) finalizeBulkSelectionAction();
      const allFavorite = paths.every(p => metaHasFavorite(p));
      metaSetFavoriteBulk(paths, !allFavorite);
      return true;
    }

    function startFolderRenameSelection() {
      const { paths, usedBulk } = getDirectorySelectionForKeybindAction();
      if (!paths.length) {
        showStatusMessage("No folders selected.");
        return false;
      }
      if (paths.length > 1) {
        showStatusMessage("Select one folder to rename.");
        return false;
      }

      const path = String(paths[0] || "");
      const dirNode = WS.dirByPath.get(path);
      if (!dirNode) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Rename requires a writable folder.");
        return false;
      }

      if (usedBulk) finalizeBulkSelectionAction();

      closeActionMenus();
      TAG_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      RENAME_EDIT_PATH = path;
      clearBulkTagPlaceholder();
      selectDirectoryEntryByPath(path);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusSelectedDirectoryInlineInput(".renameEditInput");
      return true;
    }

    function startFileRenameSelection() {
      const { ids, usedBulk } = getFileSelectionForKeybindAction();
      if (!ids.length) {
        showStatusMessage("No files selected.");
        return false;
      }
      if (ids.length > 1) {
        showStatusMessage("Select one file to rename.");
        return false;
      }

      const id = String(ids[0] || "");
      const rec = WS.fileById.get(id);
      if (!rec) return false;
      if (!WS.meta.fsRootHandle) {
        showStatusMessage("Renaming files requires a writable folder.");
        return false;
      }

      if (usedBulk) finalizeBulkSelectionAction();

      closeActionMenus();
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = id;
      clearBulkTagPlaceholder();
      selectFileEntryById(id);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
      focusSelectedDirectoryInlineInput(".renameEditInput");
      return true;
    }

    function handleSelectionKeybindAction(action) {
      if (!action || !WS.root || VIEWER_MODE) return false;
      switch (action) {
        case "scoreUpSelection":
          return applyFolderScoreSelectionAction(1);
        case "scoreDownSelection":
          return applyFolderScoreSelectionAction(-1);
        case "tagSelection":
          return startTagSelectionEdit();
        case "favoriteSelection":
          return toggleFavoriteSelection();
        case "renameFolderSelection":
          return startFolderRenameSelection();
        case "renameFileSelection":
          return startFileRenameSelection();
        default:
          return false;
      }
    }

    function isGridExclusiveAction(action) {
      return action === "selectUp"
        || action === "selectDown"
        || action === "leaveDir"
        || action === "enterDir"
        || action === "playPause"
        || action === "historyBack"
        || action === "historyForward"
        || action === "gridMoveUp"
        || action === "gridMoveDown"
        || action === "gridMoveLeft"
        || action === "gridMoveRight"
        || action === "gridOpenSelection"
        || action === "gridUpDirectory"
        || action === "gridGalleryPrev"
        || action === "gridGalleryNext"
        || action === "gridGalleryBack";
    }

    function handleGridKeybindAction(action) {
      if (!action || !isGridInteractionMode() || !WS.root) return false;
      if (VIEWER_MODE) {
        switch (action) {
          case "selectUp":
          case "gridMoveUp":
          case "gridGalleryPrev":
            moveGridGallerySelectionByDirection("up");
            return true;
          case "selectDown":
          case "gridMoveDown":
          case "gridGalleryNext":
            moveGridGallerySelectionByDirection("down");
            return true;
          case "leaveDir":
          case "gridMoveLeft":
            moveGridGallerySelectionByDirection("left");
            return true;
          case "enterDir":
          case "gridMoveRight":
            moveGridGallerySelectionByDirection("right");
            return true;
          case "gridGalleryBack":
          case "gridUpDirectory":
            hideOverlay();
            return true;
          case "seekBack":
            seekViewerVideo(-videoSkipStepSeconds());
            return true;
          case "seekForward":
            seekViewerVideo(videoSkipStepSeconds());
            return true;
          case "playPause":
            hideOverlay();
            return true;
          case "muteToggle":
            toggleViewerVideoMute();
            return true;
          case "jumpMinus50":
            viewerJumpRelative(-50);
            return true;
          case "jumpMinus10":
            viewerJumpRelative(-10);
            return true;
          case "jumpPlus10":
            viewerJumpRelative(10);
            return true;
          case "jumpPlus50":
            viewerJumpRelative(50);
            return true;
          default:
            return false;
        }
      }
      switch (action) {
        case "selectUp":
          moveGridSelectionByDirection("up");
          return true;
        case "selectDown":
          moveGridSelectionByDirection("down");
          return true;
        case "leaveDir":
          moveGridSelectionByDirection("left");
          return true;
        case "enterDir":
          moveGridSelectionByDirection("right");
          return true;
        case "playPause":
          // Space is intentionally unbound for opening items in Grid Mode.
          return true;
        case "historyBack":
          goDirHistory(-1);
          return true;
        case "historyForward":
          goDirHistory(1);
          return true;
        case "gridMoveUp":
          moveGridSelectionByDirection("up");
          return true;
        case "gridMoveDown":
          moveGridSelectionByDirection("down");
          return true;
        case "gridMoveLeft":
          moveGridSelectionByDirection("left");
          return true;
        case "gridMoveRight":
          moveGridSelectionByDirection("right");
          return true;
        case "gridOpenSelection":
          openSelectedEntryInGridMode(true);
          return true;
        case "gridUpDirectory":
          goDirUp();
          return true;
        default:
          return false;
      }
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
      if (MENU_OPEN) { closeMenu(); return true; }
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

    function toggleMenuForTab(tabId) {
      if (MENU_OPEN && MENU_ACTIVE_TAB === tabId) closeMenu();
      else openMenu(tabId);
    }

    document.addEventListener("keydown", (e) => {
      syncModifierKeyStateFromEvent(e);
    }, true);

    document.addEventListener("keyup", (e) => {
      syncModifierKeyStateFromEvent(e);
    }, true);

    window.addEventListener("blur", () => {
      clearModifierKeyState();
    });

    // Hard-coded menu toggles: ` / ~ opens the last-used menu tab.
    // Tab opens Controls only in Pane Mode.
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (e.code !== "Backquote") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInputTarget(e.target)) return;
      e.preventDefault();
      toggleMenuForTab(MENU_LAST_TAB || "general");
    }, true);

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      if (e.repeat) return;
      if (e.code !== "Tab") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextInputTarget(e.target)) return;
      e.preventDefault();
      toggleMenuForTab("controls");
    }, true);

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;

      const key = keybindValueFromEvent(e);
      if (!key) return;

      const baseKey = normalizeBaseKeyValue(e.key);
      const gridCommandSeekAction = gridCommandSeekActionForBaseKey(e, baseKey);
      if (baseKey === ".") {
        if (isTextInputTarget(e.target)) return;
        if (VIEWER_MODE) return;
        if (directoriesSearchInput && !directoriesSearchInput.disabled) {
          e.preventDefault();
          try { directoriesSearchInput.focus(); directoriesSearchInput.select(); } catch {}
          return;
        }
      }

      const action = gridCommandSeekAction || keybindActionFor(key);
      const gridAction = isGridInteractionMode()
        ? (function() {
            let next = gridKeybindActionFor(key) || action;
            const plainNoMods = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
            // Hard guard: Space must never open/enter in Grid Mode, even if legacy saved grid binds map it.
            if (key === "Space" && next === "gridOpenSelection") next = "playPause";
            if (plainNoMods && action === "seekBack") next = "gridUpDirectory";
            else if (plainNoMods && action === "seekForward") next = "gridOpenSelection";
            return next;
          })()
        : null;

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

      if (isTextInputTarget(e.target)) return;

      if (handleExtrasKeybindAction(action)) {
        e.preventDefault();
        return;
      }

      if (handleSelectionKeybindAction(action)) {
        e.preventDefault();
        return;
      }

      if (isGridInteractionMode()) {
        if (handleGridKeybindAction(gridAction)) {
          e.preventDefault();
          return;
        }
        if (isGridExclusiveAction(gridAction)) {
          e.preventDefault();
          return;
        }
      }

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
            hideOverlay();
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
            runRandomActionForViewer();
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
            runRandomActionForViewer();
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

      // Directory mode arrow priority:
      // If arrow keys are unbound or still mapped to selection movement from older keybind sets,
      // prefer thumbnail viewport nudging first so arrows do not scroll the list instead.
      if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        let nudgeDx = 0;
        let nudgeDy = 0;
        if (baseKey === "ArrowLeft") nudgeDx = -THUMB_VIEWPORT_NUDGE_STEP;
        else if (baseKey === "ArrowRight") nudgeDx = THUMB_VIEWPORT_NUDGE_STEP;
        else if (baseKey === "ArrowUp") nudgeDy = -THUMB_VIEWPORT_NUDGE_STEP;
        else if (baseKey === "ArrowDown") nudgeDy = THUMB_VIEWPORT_NUDGE_STEP;
        if (nudgeDx || nudgeDy) {
          const actionAllowsArrowNudge = !action
            || action === "selectUp"
            || action === "selectDown"
            || action === "leaveDir"
            || action === "enterDir";
          if (actionAllowsArrowNudge) {
            const nudged = nudgeSelectedThumbnailViewport(nudgeDx, nudgeDy, {
              quietNoTarget: true,
              quietAtEdge: false,
              quietSuccess: false
            });
            if (nudged) {
              e.preventDefault();
              return;
            }
          }
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
          runRandomActionForDirectories();
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

    /* =========================================================
       Initial UI state
       ========================================================= */

    if (directoriesSearchClearBtn) directoriesSearchClearBtn.disabled = true;
    applyColorSchemeFromOptions();
    applyRetroModeFromOptions();
    applyDirectoryMiniThumbSizeFromOptions();
    applyDirectoryFileThumbLayoutFromOptions();
    applyDirectoryFolderCardLayoutFromOptions();
    applyInteractionModeFromOptions();
    rebuildKeybindIndex();
    renderDirectoriesPane();
    renderPreviewPane(true);
    syncButtons();

  
