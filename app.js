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
      const hideIndices = opt ? !!opt.hideIndicesInNames : true;
      let out = hideIndices ? splitIndexPrefix(name).clean : String(name || "");
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
        imageThumbSize: "medium",
        videoThumbSize: "medium",
        mediaThumbUiSize: "medium",
        folderPreviewSize: "medium",
        hideFileExtensions: false,
        defaultFilterMode: "all",
        defaultRandomMode: false,
        defaultFolderBehavior: "slide",
        folderScoreDisplay: "no-arrows",
        tagFilterMode: "or",
        tagChipCycle: "tri",
        previewMode: "grid",
        videoSkipStep: "10",
        preloadNextMode: "off",
        videoEndBehavior: "loop",
        slideshowDefault: "cycle",
        hideIndicesInNames: true,
        hideUnderscoresInNames: false,
        hideBeforeLastDashInFileNames: false,
        hideAfterFirstUnderscoreInFileNames: false,
        forceTitleCaps: false,
        banicOpenWindow: true,
        altGalleryMode: false,
        retroMode: true,
        mediaFilter: "off",
        colorScheme: "retro90s-dark",
        leftPaneWidthPct: 0.28
      };
    }

    function normalizeOptions(o) {
      const d = defaultOptions();
      const src = (o && typeof o === "object") ? o : {};
      const out = {
        videoPreview: (src.videoPreview === "unmuted" || src.videoPreview === "muted" || src.videoPreview === "off") ? src.videoPreview : d.videoPreview,
        videoGallery: (src.videoGallery === "unmuted" || src.videoGallery === "muted" || src.videoGallery === "off") ? src.videoGallery : d.videoGallery,
        imageThumbSize: (src.imageThumbSize === "tiny" || src.imageThumbSize === "small" || src.imageThumbSize === "medium" || src.imageThumbSize === "high") ? src.imageThumbSize : d.imageThumbSize,
        videoThumbSize: (src.videoThumbSize === "tiny" || src.videoThumbSize === "small" || src.videoThumbSize === "medium" || src.videoThumbSize === "high") ? src.videoThumbSize : d.videoThumbSize,
        mediaThumbUiSize: (src.mediaThumbUiSize === "small" || src.mediaThumbUiSize === "medium" || src.mediaThumbUiSize === "large") ? src.mediaThumbUiSize : d.mediaThumbUiSize,
        folderPreviewSize: (src.folderPreviewSize === "small" || src.folderPreviewSize === "medium" || src.folderPreviewSize === "large") ? src.folderPreviewSize : d.folderPreviewSize,
        hideFileExtensions: (typeof src.hideFileExtensions === "boolean") ? src.hideFileExtensions : ((typeof src.showFileExtensions === "boolean") ? !src.showFileExtensions : d.hideFileExtensions),
        defaultFilterMode: (src.defaultFilterMode === "all" || src.defaultFilterMode === "images" || src.defaultFilterMode === "videos" || src.defaultFilterMode === "gifs") ? src.defaultFilterMode : d.defaultFilterMode,
        defaultRandomMode: (typeof src.defaultRandomMode === "boolean") ? src.defaultRandomMode : d.defaultRandomMode,
        defaultFolderBehavior: (src.defaultFolderBehavior === "stop" || src.defaultFolderBehavior === "loop" || src.defaultFolderBehavior === "slide") ? src.defaultFolderBehavior : d.defaultFolderBehavior,
        folderScoreDisplay: (src.folderScoreDisplay === "show" || src.folderScoreDisplay === "no-arrows" || src.folderScoreDisplay === "hidden") ? src.folderScoreDisplay : ((typeof src.showFolderScores === "boolean") ? (src.showFolderScores ? "show" : "hidden") : d.folderScoreDisplay),
        tagFilterMode: (src.tagFilterMode === "and" || src.tagFilterMode === "or") ? src.tagFilterMode : d.tagFilterMode,
        tagChipCycle: (src.tagChipCycle === "bi" || src.tagChipCycle === "tri") ? src.tagChipCycle : d.tagChipCycle,
        previewMode: (src.previewMode === "grid" || src.previewMode === "expanded") ? src.previewMode : d.previewMode,
        videoSkipStep: (src.videoSkipStep === "3" || src.videoSkipStep === "5" || src.videoSkipStep === "10" || src.videoSkipStep === "30") ? src.videoSkipStep : d.videoSkipStep,
        preloadNextMode: (src.preloadNextMode === "off" || src.preloadNextMode === "on" || src.preloadNextMode === "ultra") ? src.preloadNextMode : d.preloadNextMode,
        videoEndBehavior: (src.videoEndBehavior === "loop" || src.videoEndBehavior === "next" || src.videoEndBehavior === "stop") ? src.videoEndBehavior : d.videoEndBehavior,
        slideshowDefault: (src.slideshowDefault === "cycle" || src.slideshowDefault === "1" || src.slideshowDefault === "3" || src.slideshowDefault === "5" || src.slideshowDefault === "10") ? src.slideshowDefault : d.slideshowDefault,
        hideIndicesInNames: (typeof src.hideIndicesInNames === "boolean") ? src.hideIndicesInNames : d.hideIndicesInNames,
        hideUnderscoresInNames: (typeof src.hideUnderscoresInNames === "boolean") ? src.hideUnderscoresInNames : d.hideUnderscoresInNames,
        hideBeforeLastDashInFileNames: (typeof src.hideBeforeLastDashInFileNames === "boolean") ? src.hideBeforeLastDashInFileNames : d.hideBeforeLastDashInFileNames,
        hideAfterFirstUnderscoreInFileNames: (typeof src.hideAfterFirstUnderscoreInFileNames === "boolean") ? src.hideAfterFirstUnderscoreInFileNames : d.hideAfterFirstUnderscoreInFileNames,
        forceTitleCaps: (typeof src.forceTitleCaps === "boolean") ? src.forceTitleCaps : d.forceTitleCaps,
        banicOpenWindow: (typeof src.banicOpenWindow === "boolean") ? src.banicOpenWindow : d.banicOpenWindow,
        altGalleryMode: (typeof src.altGalleryMode === "boolean") ? src.altGalleryMode : d.altGalleryMode,
        retroMode: (typeof src.retroMode === "boolean") ? src.retroMode : d.retroMode,
        colorScheme: (src.colorScheme === "classic" || src.colorScheme === "light" || src.colorScheme === "superdark" || src.colorScheme === "synthwave" || src.colorScheme === "verdant" || src.colorScheme === "azure" || src.colorScheme === "ember" || src.colorScheme === "amber" || src.colorScheme === "retro90s" || src.colorScheme === "retro90s-dark") ? src.colorScheme : d.colorScheme
      ,
      leftPaneWidthPct: (function(){
        const v = parseFloat(src.leftPaneWidthPct);
        if (Number.isFinite(v)) return Math.max(0.05, Math.min(0.9, v));
        return 0.28;
      })()
      ,
/* Media filters: UI */
mediaFilter: (
  src.mediaFilter === 'off' ||
  src.mediaFilter === 'vibrant' ||
  src.mediaFilter === 'ultra' ||
  src.mediaFilter === 'kodak' ||
  src.mediaFilter === 'polaroid' ||
  src.mediaFilter === 'cooked' ||
  src.mediaFilter === 'blackwhite' ||
  src.mediaFilter === 'uv' ||
  src.mediaFilter === 'orangeTeal' /* ||
  src.mediaFilter === 'cinematic' ||
  src.mediaFilter === 'kodak+' ||
  src.mediaFilter === 'soft' */
) ? src.mediaFilter : d.mediaFilter
    };
      return out;
    }

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
      WS.view.filterMode = String(opt.defaultFilterMode || "all");
      WS.view.randomMode = !!opt.defaultRandomMode;
      WS.view.folderBehavior = String(opt.defaultFolderBehavior || "slide");
      WS.view.folderScoreDisplay = (opt.folderScoreDisplay === "show" || opt.folderScoreDisplay === "no-arrows" || opt.folderScoreDisplay === "hidden") ? opt.folderScoreDisplay : "hidden";
      WS.view.tagFilterMode = (opt.tagFilterMode === "and") ? "and" : "or";
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

    function applyRetroMediaFromOptions() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const appEl = document.getElementById("app");
      if (!appEl) return;
      const filter = opt && opt.mediaFilter ? String(opt.mediaFilter) : "off";
      if (filter && filter !== "off") appEl.setAttribute("data-media-filter", filter);
      else appEl.removeAttribute("data-media-filter");
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
        applyRetroMediaFromOptions();
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
      applyRetroMediaFromOptions();
      applyDisplaySizesFromOptions();
      rebuildDirectoriesEntries();
      WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
      syncPreviewToSelection();
      renderDirectoriesPane(true);
      renderPreviewPane(true, true);
      applyPaneDividerFromOptions();
      applyRetroMediaFromOptions();
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
        saveTimer: null,
        dirty: false,
        options: normalizeOptions(null)
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
        tagPanelOpen: false,
        tagFilterMode: "or",
        tagIncludeFilters: new Set(),
        tagExcludeFilters: new Set(),
        bulkSelectMode: false,
        bulkTagPanelOpen: false,
        bulkTagSelectedPaths: new Set(),
        bulkTagPickSet: new Set(),
        bulkTagSelectionsByDir: new Map(),
        bulkFileSelectedIds: new Set(),
        bulkFileSelectionsByDir: new Map(),
        bulkActionMenuOpen: false,
        dirActionMenuPath: "",
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
      WS.meta.dirty = false;
      WS.meta.options = normalizeOptions(null);
      if (WS.meta.saveTimer) { clearTimeout(WS.meta.saveTimer); WS.meta.saveTimer = null; }

      applyDefaultViewFromOptions();
      WS.view.loopWithinDir = false;
      WS.view.randomSeed = 0;
      WS.view.randomCache = new Map();
      WS.view.dirLoopRepeats = 3;
      WS.view.previewLoopRepeats = 3;
      WS.view.slideshowModeIndex = 0;
      WS.view.slideshowActive = false;
      WS.view.tagPanelOpen = false;
      WS.view.tagIncludeFilters.clear();
      WS.view.tagExcludeFilters.clear();
      WS.view.bulkSelectMode = false;
      WS.view.bulkTagPanelOpen = false;
      WS.view.bulkTagSelectedPaths = new Set();
      WS.view.bulkTagPickSet.clear();
      WS.view.bulkTagSelectionsByDir = new Map();
      WS.view.bulkFileSelectedIds = new Set();
      WS.view.bulkFileSelectionsByDir = new Map();
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = "";
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
    const helpBtn = $("helpBtn");
    const optionsBtn = $("optionsBtn");
    const refreshBtn = $("refreshBtn");
    const openWritableBtn = $("openWritableBtn");

    // Help Overlay
    const helpOverlay = $("helpOverlay");
    const helpCloseBtn = $("helpCloseBtn");
    const helpBodyEl = $("helpBody");
    const helpHoldOverlay = $("helpHoldOverlay");

    // Options Overlay
    const optionsOverlay = $("optionsOverlay");
    const optionsCloseBtn = $("optionsCloseBtn");
    const optionsBodyEl = $("optionsBody");
    const optionsResetBtn = $("optionsResetBtn");
    const optionsDoneBtn = $("optionsDoneBtn");
    const optionsStatusLabel = $("optionsStatusLabel");

    // Directories Pane
    const directoriesPathEl = $("directoriesPath");
    const directoriesListEl = $("directoriesList");
    const favoritesBtn = $("favoritesBtn");
    const hiddenBtn = $("hiddenBtn");
    const toggleTagsBtn = $("toggleTagsBtn");
    const directoriesTagsRowEl = $("directoriesTagsRow");
    const directoriesActionRowEl = $("directoriesActionRow");
    const directoriesSelectBtn = $("directoriesSelectBtn");
    const directoriesSelectAllBtn = $("directoriesSelectAllBtn");
    // Select menu (three line / ☰) button.
    const directoriesMenuBtn = $("directoriesMenuBtn");
    const directoriesActionMenuEl = $("directoriesActionMenu");
    const directoriesClearBtn = $("directoriesClearBtn");
    const directoriesBulkRowEl = $("directoriesBulkRow");
    const directoriesSearchInput = $("directoriesSearchInput");
    const directoriesSearchClearBtn = $("directoriesSearchClearBtn");
    const dirBackBtn = $("dirBackBtn");
    const dirForwardBtn = $("dirForwardBtn");
    const dirUpBtn = $("dirUpBtn");
    const busyOverlay = $("busyOverlay");
    const busyLabel = $("busyLabel");

    // Preview Pane
    const breadcrumbInlineEl = $("breadcrumbInline");
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
      applyRetroMediaFromOptions();
    })();

    let MAIN_STATUS_TIMEOUT = null;

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

    let ACTIVE_MEDIA_SURFACE = "none";

    let PREVIEW_VIDEO_PAUSE = { active: false, fileId: null, time: 0, wasPlaying: false };

    let VIDEO_CARRY = { active: false, fileId: null, time: 0, wasPlaying: false };

    let PRELOAD_CACHE = new Map();

    let TAG_EDIT_PATH = null;
    let RENAME_EDIT_PATH = null;
    let RENAME_EDIT_FILE_ID = null;
    let RENAME_BUSY = false;

    let HELP_OPEN = false;
    let OPTIONS_OPEN = false;
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

    function showStatusMessage(text) {
      statusMessageEl.textContent = text || "";
      statusMessageEl.classList.add("visible");
      if (WS.view.statusTimeout) {
        clearTimeout(WS.view.statusTimeout);
        WS.view.statusTimeout = null;
      }
      WS.view.statusTimeout = setTimeout(() => {
        statusMessageEl.classList.remove("visible");
      }, 1200);
    }

    function showSlideshowMessage(text) {
      if (VIEWER_MODE) {
        showStatusMessage(text);
        return;
      }
      mainStatusMessageEl.textContent = text || "";
      mainStatusMessageEl.classList.add("visible");
      if (MAIN_STATUS_TIMEOUT) { clearTimeout(MAIN_STATUS_TIMEOUT); MAIN_STATUS_TIMEOUT = null; }
      MAIN_STATUS_TIMEOUT = setTimeout(() => {
        mainStatusMessageEl.classList.remove("visible");
      }, 1200);
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
      const f = WS.view.filterMode === "all" ? "All" : (WS.view.filterMode === "images" ? "Images only" : (WS.view.filterMode === "videos" ? "Videos only" : "GIFs only"));
      const r = WS.view.randomMode ? "On" : "Off";
      const b = WS.view.folderBehavior === "loop" ? "Loop" : (WS.view.folderBehavior === "slide" ? "Slide" : "Stop");
      const s = WS.meta.dirSortMode === "score" ? "Score" : "Name";
      modePill.textContent = `Content filter: ${f} | Random mode: ${r} | Folder behavior: ${b} | Dir sort: ${s}`;
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
    if (helpOverlay) helpOverlay.addEventListener("click", (e) => {
      if (e.target === helpOverlay) closeHelp();
    });

    /* =========================================================
       Options overlay
       ========================================================= */

    function openOptions() {
      OPTIONS_OPEN = true;
      if (optionsOverlay) optionsOverlay.classList.add("active");
      renderOptionsUi();
      setOptionsStatus("Saved automatically");
    }

    function closeOptions() {
      OPTIONS_OPEN = false;
      if (optionsOverlay) optionsOverlay.classList.remove("active");
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

      const filterModes = [
        { value: "all", label: "All media" },
        { value: "images", label: "Images only" },
        { value: "videos", label: "Videos only" },
        { value: "gifs", label: "GIFs only" }
      ];

      const onOffModes = [
        { value: "on", label: "On" },
        { value: "off", label: "Off" }
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

      const tagFilterModes = [
        { value: "or", label: "OR (match any)" },
        { value: "and", label: "AND (match all)" }
      ];

      const tagChipCycleModes = [
        { value: "tri", label: "Inactive → Active → Hide" },
        { value: "bi", label: "Inactive → Active" }
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
       { value: "ultra", label: "Palm Tree" },
       { value: "kodak", label: "Kodak" },
       { value: "polaroid", label: "Polaroid" },
       { value: "cooked", label: "Cooked" },
       { value: "blackwhite", label: "Black and White" },
       { value: "uv", label: "UV Camera" },
       { value: "orangeTeal", label: "Orange+Teal" }/*
       { value: "cinematic", label: "Cinematic" },
       { value: "kodak+", label: "Kodak+" },
       { value: "soft", label: "Soft" }*/
      ];

      optionsBodyEl.innerHTML = `
        <div class="label" style="margin-bottom:8px;">Option preferences are automatically stored in preferences.log.json in the .local-gallery system folder in the root directory.</div>

<h1>General</h1>
${makeSelectRow("Folder sort", "Sort folders by name or score.", "opt_dirSortMode", WS.meta.dirSortMode === "score" ? "score" : "name", dirSortModes)}
${makeSelectRow("Folder scores", "Choose how folder scores appear in lists + previews.", "opt_folderScoreDisplay", String(opt.folderScoreDisplay || "hidden"), folderScoreModes)}
${makeSelectRow("Tag filter mode", "When multiple tags are active, match any or all tags.", "opt_tagFilterMode", String(opt.tagFilterMode || "or"), tagFilterModes)}
${makeSelectRow("Tag button cycle", "Choose whether tags can be set to hide or only active/inactive.", "opt_tagChipCycle", String(opt.tagChipCycle || "tri"), tagChipCycleModes)}
${makeCheckRow("Alt gallery mode", "Enter on a file opens Gallery; exit with A/J.", "opt_altGalleryMode", !!opt.altGalleryMode)}
${makeCheckRow("BANIC! opens decoy window", "When enabled, BANIC! opens a harmless site in a new window.", "opt_banicOpenWindow", opt.banicOpenWindow !== false)}

<h1>Defaults</h1>
${makeSelectRow("Default content filter", "Initial filter when loading a root directory.", "opt_defaultFilterMode", String(opt.defaultFilterMode || "all"), filterModes)}
${makeSelectRow("Default random mode", "Initial random mode.", "opt_defaultRandomMode", opt.defaultRandomMode ? "on" : "off", onOffModes)}
${makeSelectRow("Default folder behavior", "Initial folder behavior.", "opt_defaultFolderBehavior", String(opt.defaultFolderBehavior || "slide"), folderModes)}

<h1>Appearance</h1>
${makeSelectRow("Color scheme", "Switch the overall interface palette.", "opt_colorScheme", String(opt.colorScheme || "classic"), colorSchemes)}
${makeSelectRow("Media Filter", "Apply a visual filter to media elements.", "opt_mediaFilter", String(opt.mediaFilter || "off"), mediaFilterModes)}
${makeCheckRow("Retro Mode", "Pixelated, low-res UI styling across themes.", "opt_retroMode", !!opt.retroMode)}

<h1>Playback</h1>
${makeSelectRow("Video audio (preview)", "Controls autoplay + mute in the in-pane preview player.", "opt_videoPreview", String(opt.videoPreview || "muted"), vidModes)}
${makeSelectRow("Video audio (gallery)", "Controls autoplay + mute in fullscreen gallery mode.", "opt_videoGallery", String(opt.videoGallery || "muted"), vidModes)}
${makeSelectRow("Video skip step", "Seek increment for Q/E/U/O shortcuts.", "opt_videoSkipStep", String(opt.videoSkipStep || "10"), skipSteps)}
${makeSelectRow("Video end behavior", "What happens when a video ends (outside slideshow).", "opt_videoEndBehavior", String(opt.videoEndBehavior || "loop"), videoEndModes)}
${makeSelectRow("Preload next item", "Preload the next item for smoother browsing.", "opt_preloadNextMode", String(opt.preloadNextMode || "off"), preloadModes)}
${makeSelectRow("Slideshow speed", "Controls Shift behavior for slideshows.", "opt_slideshowDefault", String(opt.slideshowDefault || "cycle"), slideshowModes)}

<h1>Preview</h1>
${makeSelectRow("Image thumbnail size", "Controls generated image thumbnail quality (smaller is faster).", "opt_imageThumbSize", String(opt.imageThumbSize || "medium"), thumbModes)}
${makeSelectRow("Video thumbnail size", "Controls generated video thumbnail quality (smaller is faster).", "opt_videoThumbSize", String(opt.videoThumbSize || "medium"), thumbModes)}
${makeSelectRow("Media thumbnail scale", "Controls how large media cards appear in the preview pane.", "opt_mediaThumbUiSize", String(opt.mediaThumbUiSize || "medium"), previewSizeModes)}
${makeSelectRow("Folder preview scale", "Controls how large folder cards appear in the preview pane.", "opt_folderPreviewSize", String(opt.folderPreviewSize || "medium"), previewSizeModes)}
${makeSelectRow("Preview mode", "Controls how folders are shown in the preview pane.", "opt_previewMode", String(opt.previewMode || "grid"), previewModes)}

<h1>Filenames</h1>
${makeCheckRow("Hide file extensions", "Hide .jpg / .mp4 in file names.", "opt_hideFileExtensions", !!opt.hideFileExtensions)}
${makeCheckRow("Hide indices from display names", "Hide numeric prefixes like '01 - '.", "opt_hideIndicesInNames", !!opt.hideIndicesInNames)}
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
      bindSelect("opt_defaultFilterMode", "defaultFilterMode", false, () => {
        applyDefaultViewFromOptions();
      });
      bindSelect("opt_defaultRandomMode", "defaultRandomMode", false, () => {
        applyDefaultViewFromOptions();
      }, (val) => val === "on");
      bindSelect("opt_defaultFolderBehavior", "defaultFolderBehavior", false, () => {
        applyDefaultViewFromOptions();
      });
      bindSelect("opt_folderScoreDisplay", "folderScoreDisplay", false, (val) => {
        WS.view.folderScoreDisplay = (val === "show" || val === "no-arrows" || val === "hidden") ? val : "hidden";
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
      });
      bindSelect("opt_tagFilterMode", "tagFilterMode", false, (val) => {
        WS.view.tagFilterMode = (val === "and") ? "and" : "or";
        rebuildDirectoriesEntries();
        WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
        syncPreviewToSelection();
        renderDirectoriesPane(true);
        renderPreviewPane(false, true);
        syncButtons();
      });
      bindSelect("opt_tagChipCycle", "tagChipCycle", false, () => {
        renderDirectoriesPane(true);
      });
      bindSelect("opt_videoSkipStep", "videoSkipStep", false);
      bindSelect("opt_preloadNextMode", "preloadNextMode", false, (val) => {
        if (val === "off") PRELOAD_CACHE = new Map();
      });
      bindSelect("opt_videoEndBehavior", "videoEndBehavior", false);
      bindSelect("opt_slideshowDefault", "slideshowDefault", false);
      bindCheck("opt_altGalleryMode", "altGalleryMode");
      bindCheck("opt_banicOpenWindow", "banicOpenWindow");
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
      bindSelect("opt_mediaFilter", "mediaFilter", false, (val) => {
        applyRetroMediaFromOptions();
      });
      bindCheck("opt_hideFileExtensions", "hideFileExtensions");
      bindCheck("opt_hideIndicesInNames", "hideIndicesInNames");
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

    if (optionsBtn) optionsBtn.addEventListener("click", () => openOptions());
    if (optionsCloseBtn) optionsCloseBtn.addEventListener("click", () => closeOptions());
    if (optionsDoneBtn) optionsDoneBtn.addEventListener("click", () => closeOptions());
    if (optionsResetBtn) optionsResetBtn.addEventListener("click", () => resetOptionsToDefaults());
    if (optionsOverlay) optionsOverlay.addEventListener("click", (e) => {
      if (e.target === optionsOverlay) closeOptions();
    });

    /* =========================================================
       Workspace loading (read-only input)
       ========================================================= */

    function closeBulkTagPanel() {
      WS.view.bulkTagPanelOpen = false;
      WS.view.bulkTagPickSet.clear();
    }

    function getBulkSelectionKey() {
      if (WS.view.dirSearchPinned && WS.view.searchRootActive) return "search";
      if (WS.view.favoritesMode && WS.view.favoritesRootActive) return "favorites";
      if (WS.view.hiddenMode && WS.view.hiddenRootActive) return "hidden";
      const dn = WS.nav.dirNode;
      return dn ? String(dn.path || "") : "";
    }

    function openBulkTagPanel() {
      WS.view.bulkTagPanelOpen = true;
      WS.view.bulkTagPickSet.clear();
      closeActionMenus();
      renderDirectoriesPane(true);
      setTimeout(() => {
        const input = directoriesBulkRowEl ? directoriesBulkRowEl.querySelector(".tagEditInput") : null;
        if (input) {
          try { input.focus(); input.select(); } catch {}
        }
      }, 0);
    }

    function clearBulkTagSelection() {
      closeBulkTagPanel();
      closeActionMenus();
      if (WS.view.bulkTagSelectedPaths && WS.view.bulkTagSelectedPaths.clear) WS.view.bulkTagSelectedPaths.clear();
      if (WS.view.bulkFileSelectedIds && WS.view.bulkFileSelectedIds.clear) WS.view.bulkFileSelectedIds.clear();
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
      const p = String(path || "");
      const fav = metaHasFavorite(p);
      const hidden = metaHasHidden(p);
      const v = normalizeTagList(userTags).filter(t => t !== FAVORITE_TAG && t !== HIDDEN_TAG);
      const merged = [];
      if (fav) merged.push(FAVORITE_TAG);
      if (hidden) merged.push(HIDDEN_TAG);
      merged.push(...v);
      WS.meta.dirTags.set(p, merged);
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

    function metaMakeTagFiltersLogObject() {
      return {
        include: normalizeTagList(Array.from(WS.view.tagIncludeFilters || [])),
        exclude: normalizeTagList(Array.from(WS.view.tagExcludeFilters || []))
      };
    }

    function metaApplyTagFiltersFromLog(log) {
      const src = log && typeof log === "object" ? log.tagFilters : null;
      const include = normalizeTagList(src && Array.isArray(src.include) ? src.include : []);
      const exclude = normalizeTagList(src && Array.isArray(src.exclude) ? src.exclude : []);
      const includeSet = new Set(include);
      const excludeClean = exclude.filter(t => !includeSet.has(t));
      WS.view.tagIncludeFilters.clear();
      WS.view.tagExcludeFilters.clear();
      for (const t of includeSet) WS.view.tagIncludeFilters.add(t);
      for (const t of excludeClean) WS.view.tagExcludeFilters.add(t);
    }

    function metaMakeOptionsLogObject() {
      return {
        schema: 1,
        updatedAt: Date.now(),
        options: normalizeOptions(WS.meta.options || null),
        tagFilters: metaMakeTagFiltersLogObject()
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
      metaApplyTagFiltersFromLog(log);
      applyDefaultViewFromOptions();
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyRetroMediaFromOptions();
      applyDisplaySizesFromOptions();
    }

    function metaApplyFromLog(log) {
      if (!log || typeof log !== "object") return;

      const sortMode = log.sortMode === "score" ? "score" : "name";
      WS.meta.dirSortMode = sortMode;

      WS.meta.options = normalizeOptions(log.options || null);
      applyColorSchemeFromOptions();
      applyRetroModeFromOptions();
      applyRetroMediaFromOptions();
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

      metaApplyTagFiltersFromLog(log);
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
      WS.meta.dirty = false;
    }

    async function metaEnsureFsHandles(rootHandle) {
      if (!rootHandle) return false;
      try {
        const sys = await rootHandle.getDirectoryHandle(".local-gallery", { create: true });
        const scoresFile = await sys.getFileHandle("folder-scores.log.json", { create: true });
        const tagsFile = await sys.getFileHandle("folder-tags.log.json", { create: true });
        const optionsFile = await sys.getFileHandle("preferences.log.json", { create: true });
        const legacyFile = await sys.getFileHandle("folder-votes.log.json", { create: true });
        WS.meta.fsRootHandle = rootHandle;
        WS.meta.fsSysDirHandle = sys;
        WS.meta.fsScoresFileHandle = scoresFile;
        WS.meta.fsTagsFileHandle = tagsFile;
        WS.meta.fsOptionsFileHandle = optionsFile;
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
      await metaSaveFsDoc(scores, metaMakeScoresLogObject());
      await metaSaveFsDoc(tags, metaMakeTagsLogObject());
      await metaSaveFsDoc(options, metaMakeOptionsLogObject());
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

        if (scoresLog) metaApplyScoresLog(scoresLog);
        if (tagsLog) metaApplyTagsLog(tagsLog);
        if (optionsLog) metaApplyOptionsLog(optionsLog);

        if (!scoresLog && !tagsLog && !optionsLog && keys) {
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

      if (scoresLog) metaApplyScoresLog(scoresLog);
      if (tagsLog) metaApplyTagsLog(tagsLog);
      if (optionsLog) metaApplyOptionsLog(optionsLog);

      if (!scoresLog && !tagsLog && !optionsLog) {
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
      applyRetroMediaFromOptions();

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
      applyRetroMediaFromOptions();

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
          randomMode: WS.view.randomMode,
          loopWithinDir: WS.view.loopWithinDir,
          folderBehavior: WS.view.folderBehavior,
          folderScoreDisplay: WS.view.folderScoreDisplay,
          tagFilterMode: WS.view.tagFilterMode,
          tagIncludeFilters: new Set(WS.view.tagIncludeFilters),
          tagExcludeFilters: new Set(WS.view.tagExcludeFilters),
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
      WS.view.randomMode = viewState.randomMode;
      WS.view.loopWithinDir = viewState.loopWithinDir;
      WS.view.folderBehavior = viewState.folderBehavior;
      WS.view.folderScoreDisplay = viewState.folderScoreDisplay;
      WS.view.tagFilterMode = viewState.tagFilterMode;
      WS.view.tagIncludeFilters = new Set(viewState.tagIncludeFilters || []);
      WS.view.tagExcludeFilters = new Set(viewState.tagExcludeFilters || []);
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

      if (WS.view.randomMode) {
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
      if (WS.view.hiddenMode) return base;
      return base.filter(d => !isDirOrAncestorHidden(d));
    }

    function getAvailableTagsForDir(dirNode) {
      const base = getChildDirsForNodeBase(dirNode);
      const set = new Set();
      for (const d of base) {
        const tags = metaGetUserTags(d.path || "");
        for (let i = 0; i < tags.length; i++) set.add(tags[i]);
      }
      return set;
    }

    function getAvailableTagsForCurrentDir() {
      return getAvailableTagsForDir(WS.nav.dirNode);
    }

    function getEffectiveTagFiltersForDir(dirNode) {
      if (!dirNode) return null;
      const available = getAvailableTagsForDir(dirNode);
      if (!available.size) return null;
      const include = new Set();
      const exclude = new Set();
      for (const t of WS.view.tagIncludeFilters) if (available.has(t)) include.add(t);
      for (const t of WS.view.tagExcludeFilters) if (available.has(t)) exclude.add(t);
      if (!include.size && !exclude.size) return null;
      return {
        include,
        exclude,
        mode: WS.view.tagFilterMode === "and" ? "and" : "or"
      };
    }

    function dirMatchesTagFilters(dirNode, filters) {
      if (!dirNode) return false;
      if (!filters) return true;
      const tags = metaGetUserTags(dirNode.path || "");
      const tagSet = new Set(tags);
      const mode = filters.mode === "and" ? "and" : "or";

      const hasAny = (set) => {
        for (const t of set) if (tagSet.has(t)) return true;
        return false;
      };
      const hasAll = (set) => {
        for (const t of set) if (!tagSet.has(t)) return false;
        return true;
      };

      const includeSet = filters.include || new Set();
      const excludeSet = filters.exclude || new Set();

      const includeOk = includeSet.size ? (mode === "and" ? hasAll(includeSet) : hasAny(includeSet)) : true;
      if (!includeOk) return false;

      const excludeHit = excludeSet.size ? (mode === "and" ? hasAll(excludeSet) : hasAny(excludeSet)) : false;
      if (excludeHit) return false;

      return true;
    }

    function getChildDirsForNode(dirNode) {
      const base = getChildDirsForNodeBase(dirNode);
      const eff = getEffectiveTagFiltersForDir(dirNode);
      if (!eff) return base;
      return base.filter(d => dirMatchesTagFilters(d, eff));
    }

    function getVisibleSiblingDirsForSlide(dirNode) {
      const dp = String(dirNode?.path || "");

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
      let out = getChildDirsForNodeBase(p);

      const eff = getEffectiveTagFiltersForDir(p);
      if (eff) out = out.filter(d => dirMatchesTagFilters(d, eff));

      return out;
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
      const searchTagFilters = (WS.view.tagExcludeFilters.size) ? {
        include: new Set(),
        exclude: new Set(WS.view.tagExcludeFilters),
        mode: WS.view.tagFilterMode === "and" ? "and" : "or"
      } : null;

      const consider = (node, includeSelf) => {
        if (!node) return;
        if (skipHidden && isDirOrAncestorHidden(node)) return;
        if (getCount(node) <= 0) return;

        const name = displayName(node.name || "").toLowerCase();
        if (includeSelf && name.includes(q)) {
          const p = String(node.path || "");
          if (searchTagFilters && !dirMatchesTagFilters(node, searchTagFilters)) {
            // Respect tag filtering in search results.
          } else if (p && !addSet.has(p)) {
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

      if (WS.view.dirSearchPinned && WS.view.searchRootActive) {
        const dirs = (WS.view.searchResults || []).slice();
        for (let i = 0; i < dirs.length; i++) WS.nav.entries.push({ kind: "dir", node: dirs[i] });
        return;
      }

      if (WS.view.favoritesMode && WS.view.favoritesRootActive) {
        const dirs = getAllFavoriteDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      if (WS.view.hiddenMode && WS.view.hiddenRootActive) {
        const dirs = getAllHiddenDirs();
        for (const d of dirs) WS.nav.entries.push({ kind: "dir", node: d });
        return;
      }

      const dirNode = WS.nav.dirNode;
      if (!dirNode) return;

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
      return entry && (entry.kind === "dir" || entry.kind === "file");
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
      } else {
        WS.preview.kind = "file";
        WS.preview.fileId = entry.id;
        WS.preview.dirNode = null;
      }
    }

    function altGalleryModeEnabled() {
      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      return !!(opt && opt.altGalleryMode);
    }

    function enterSelectedDirectory() {
      TAG_EDIT_PATH = null;
      closeBulkTagPanel();

      const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
      if (!entry) return;
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
      closeBulkTagPanel();

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
      if (!WS.nav.dirNode || !WS.nav.dirNode.parent) return;
      leaveDirectory();
    }

    function getDirectoriesPathText() {
      if (!WS.root) return "—";
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
      closeBulkTagPanel();
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
      closeBulkTagPanel();
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
      WS.view.dirActionMenuPath = "";
      WS.view.fileActionMenuId = "";
    }

    function openDirMenuForPath(path) {
      const p = String(path || "");
      if (!p) return;
      WS.view.bulkActionMenuOpen = false;
      WS.view.dirActionMenuPath = p;
      WS.view.fileActionMenuId = "";
      TAG_EDIT_PATH = null;
      RENAME_EDIT_PATH = null;
      RENAME_EDIT_FILE_ID = null;
      closeBulkTagPanel();

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
      closeBulkTagPanel();

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

    function renderDirectoriesTagsHeader() {
      if (!directoriesTagsRowEl || !toggleTagsBtn) return;

      toggleTagsBtn.style.display = "none";

      if (!WS.root || !WS.nav.dirNode || (WS.view.dirSearchPinned && WS.view.searchRootActive) || (WS.view.favoritesMode && WS.view.favoritesRootActive) || (WS.view.hiddenMode && WS.view.hiddenRootActive)) {
        directoriesTagsRowEl.style.display = "none";
        directoriesTagsRowEl.innerHTML = "";
        return;
      }

      const base = getChildDirsForNodeBase(WS.nav.dirNode);
      const counts = new Map();
      for (const d of base) {
        const tags = metaGetUserTags(d.path || "");
        const uniq = new Set(tags);
        for (const t of uniq) {
          counts.set(t, (counts.get(t) || 0) + 1);
        }
      }

      const available = Array.from(counts.keys());
      const hasTagged = available.length > 0;

      if (!hasTagged) {
        directoriesTagsRowEl.style.display = "none";
        directoriesTagsRowEl.innerHTML = "";
        return;
      }

      available.sort((a,b) => String(a).localeCompare(String(b)));

      directoriesTagsRowEl.innerHTML = "";
      directoriesTagsRowEl.style.display = "flex";

      const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
      const cycle = opt && opt.tagChipCycle === "bi" ? "bi" : "tri";
      const frag = document.createDocumentFragment();

      for (let i = 0; i < available.length; i++) {
        const t = available[i];
        const chip = document.createElement("span");
        const state = WS.view.tagIncludeFilters.has(t) ? "include" : (WS.view.tagExcludeFilters.has(t) ? "exclude" : "off");
        chip.className = "tag" + (state === "include" ? " include" : (state === "exclude" ? " exclude" : ""));
        chip.textContent = `${t} (${counts.get(t) || 0})`;
        chip.style.cursor = "pointer";
        chip.title = state === "include" ? "Tag filter: include" : (state === "exclude" ? "Tag filter: hide" : "Tag filter: off");
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (cycle === "bi") {
            if (WS.view.tagIncludeFilters.has(t)) {
              WS.view.tagIncludeFilters.delete(t);
            } else {
              WS.view.tagExcludeFilters.delete(t);
              WS.view.tagIncludeFilters.add(t);
            }
          } else {
            if (WS.view.tagIncludeFilters.has(t)) {
              WS.view.tagIncludeFilters.delete(t);
              WS.view.tagExcludeFilters.add(t);
            } else if (WS.view.tagExcludeFilters.has(t)) {
              WS.view.tagExcludeFilters.delete(t);
            } else {
              WS.view.tagIncludeFilters.add(t);
            }
          }

          WS.meta.dirty = true;
          metaScheduleSave();
          rebuildDirectoriesEntries();
          WS.nav.selectedIndex = findNearestSelectableIndex(WS.nav.selectedIndex, 1);
          syncPreviewToSelection();
          renderDirectoriesPane(true);
          renderPreviewPane(false, true);
          syncButtons();
          kickVideoThumbsForPreview();
          kickImageThumbsForPreview();
        });
        frag.appendChild(chip);
      }

      directoriesTagsRowEl.appendChild(frag);
    }

    function renderDirectoriesActionHeader() {
      if (!directoriesActionRowEl || !directoriesSelectBtn || !directoriesMenuBtn || !directoriesClearBtn || !directoriesActionMenuEl) return;

      if (!WS.root) {
        directoriesActionRowEl.style.display = "none";
        return;
      }

      directoriesActionRowEl.style.display = "flex";

      const canBulk = canUseBulkSelection();
      if (!canBulk && WS.view.bulkSelectMode) {
        WS.view.bulkSelectMode = false;
        clearBulkTagSelection();
      }
      const selectedDirs = canBulk ? getSelectedPathsInCurrentDir() : [];
      const selectedFiles = canBulk ? getSelectedFileIdsInCurrentView() : [];
      const selCount = selectedDirs.length + selectedFiles.length;
      const hasDirSelection = selectedDirs.length > 0;
      if (!selCount && WS.view.bulkActionMenuOpen) WS.view.bulkActionMenuOpen = false;

      directoriesSelectBtn.textContent = WS.view.bulkSelectMode ? `Select${selCount ? ` (${selCount})` : ""}` : "Select";
      directoriesSelectBtn.disabled = !canBulk;
      directoriesMenuBtn.disabled = !canBulk || !hasDirSelection;
      directoriesClearBtn.disabled = !canBulk || !selCount;

      const menuOpen = WS.view.bulkActionMenuOpen && canBulk && hasDirSelection;
      directoriesActionMenuEl.classList.toggle("open", menuOpen);
      directoriesActionMenuEl.innerHTML = "";

      if (directoriesSelectAllBtn) {
        const visibleFiles = canBulk ? Array.from(getVisibleFileIdsInEntries()) : [];
        const allSelected = visibleFiles.length > 0 && selectedFiles.length === visibleFiles.length;
        directoriesSelectAllBtn.style.display = WS.view.bulkSelectMode && visibleFiles.length ? "inline-flex" : "none";
        directoriesSelectAllBtn.disabled = !WS.view.bulkSelectMode || !visibleFiles.length || allSelected;
      }

      if (menuOpen) {
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
        });
        scoreUpBtn.classList.add("scoreBtn");
        const scoreDownBtn = makeActionBtn("-", () => {
          WS.view.bulkActionMenuOpen = false;
          metaBumpScoreBulk(selectedDirs, -1);
        });
        scoreDownBtn.classList.add("scoreBtn");
        scoreRow.appendChild(scoreUpBtn);
        scoreRow.appendChild(scoreDownBtn);
        directoriesActionMenuEl.appendChild(scoreRow);

        directoriesActionMenuEl.appendChild(makeActionBtn("Tag selected", () => {
          WS.view.bulkActionMenuOpen = false;
          openBulkTagPanel();
        }));

        directoriesActionMenuEl.appendChild(makeActionBtn(allFavorite ? "Unfavorite selected" : "Favorite selected", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetFavoriteBulk(selectedDirs, !allFavorite);
        }));

        directoriesActionMenuEl.appendChild(makeActionBtn(allHidden ? "Unhide selected" : "Hide selected", () => {
          WS.view.bulkActionMenuOpen = false;
          metaSetHiddenBulk(selectedDirs, !allHidden);
        }));

        requestAnimationFrame(() => positionDropdownMenu(directoriesMenuBtn, directoriesActionMenuEl));
      }
    }

    function renderDirectoriesBulkHeader() {
      if (!directoriesBulkRowEl) return;

      if (!canUseBulkSelection()) {
        directoriesBulkRowEl.style.display = "none";
        directoriesBulkRowEl.innerHTML = "";
        return;
      }

      const selectedInThisDir = getSelectedPathsInCurrentDir();
      const selCount = selectedInThisDir.length;

      if (!selCount && WS.view.bulkTagPanelOpen) {
        closeBulkTagPanel();
      }

      if (!selCount || !WS.view.bulkTagPanelOpen) {
        directoriesBulkRowEl.style.display = "none";
        directoriesBulkRowEl.innerHTML = "";
        return;
      }

      directoriesBulkRowEl.style.display = "flex";
      directoriesBulkRowEl.innerHTML = "";

      const countPill = document.createElement("span");
      countPill.className = "pill";
      countPill.textContent = `${selCount} selected`;

      directoriesBulkRowEl.appendChild(countPill);

      const input = document.createElement("input");
      input.type = "text";
      input.className = "tagEditInput";
      input.placeholder = "tag1, tag2";
      input.style.width = "220px";
      input.addEventListener("click", (e) => e.stopPropagation());
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          WS.view.bulkTagPanelOpen = false;
          WS.view.bulkTagPickSet.clear();
          renderDirectoriesPane(true);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const typed = normalizeTagsFromText(input.value || "");
          const picked = Array.from(WS.view.bulkTagPickSet);
          const all = normalizeTagList(typed.concat(picked));
          if (all.length) metaAddUserTagsBulk(selectedInThisDir, all);
          clearBulkTagSelection();
          renderDirectoriesPane(true);
          return;
        }
      });

      const btnApply = document.createElement("button");
      btnApply.type = "button";
      btnApply.className = "miniBtn";
      btnApply.textContent = "Apply";
      btnApply.disabled = !selCount;

      const btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "miniBtn";
      btnCancel.textContent = "Cancel";

      btnCancel.addEventListener("click", (e) => {
        e.stopPropagation();
        WS.view.bulkTagPanelOpen = false;
        WS.view.bulkTagPickSet.clear();
        renderDirectoriesPane(true);
      });

      btnApply.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!selCount) return;
        const typed = normalizeTagsFromText(input.value || "");
        const picked = Array.from(WS.view.bulkTagPickSet);
        const all = normalizeTagList(typed.concat(picked));
        if (all.length) metaAddUserTagsBulk(selectedInThisDir, all);
        clearBulkTagSelection();
        renderDirectoriesPane(true);
      });

      directoriesBulkRowEl.appendChild(input);

      const available = Array.from(getAvailableTagsForCurrentDir()).slice().sort((a,b) => String(a).localeCompare(String(b)));
      for (let i = 0; i < available.length; i++) {
        const t = available[i];
        const chip = document.createElement("span");
        chip.className = "tag" + (WS.view.bulkTagPickSet.has(t) ? " sel" : "");
        chip.textContent = t;
        chip.style.cursor = "pointer";
        chip.title = "Toggle tag to apply";
        chip.addEventListener("click", (e) => {
          e.stopPropagation();
          if (WS.view.bulkTagPickSet.has(t)) WS.view.bulkTagPickSet.delete(t);
          else WS.view.bulkTagPickSet.add(t);
          renderDirectoriesPane(true);
        });
        directoriesBulkRowEl.appendChild(chip);
      }

      directoriesBulkRowEl.appendChild(btnApply);
      directoriesBulkRowEl.appendChild(btnCancel);
    }

    function renderDirectoriesPane(keepScroll = false) {
      const prevScroll = keepScroll ? directoriesListEl.scrollTop : 0;
      directoriesListEl.innerHTML = "";
      const canBulk = WS.view.bulkSelectMode && canUseBulkSelection();

      if (!WS.root) {
        directoriesPathEl.textContent = "—";
        renderDirectoriesTagsHeader();
        renderDirectoriesActionHeader();
        renderDirectoriesBulkHeader();
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">Load a folder to begin.</div>`;
        return;
      }

      directoriesPathEl.textContent = getDirectoriesPathText();
      renderDirectoriesTagsHeader();
      renderDirectoriesActionHeader();
      renderDirectoriesBulkHeader();

      if (!WS.nav.entries.length) {
        directoriesListEl.innerHTML = `<div class="label" style="padding:10px;">Empty directory.</div>`;
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

        let icon = "📁";
        let name = "";
        let meta = "";
        let voteHtml = "";
        let rightHtml = "";
        let fileMenuHtml = "";

        if (entry.kind === "dir") {
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
              WS.view.bulkActionMenuOpen = false;
              WS.view.dirActionMenuPath = (WS.view.dirActionMenuPath === p) ? "" : p;
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

      if (keepScroll) {
        directoriesListEl.scrollTop = prevScroll;
        return;
      }

      const selected = directoriesListEl.querySelector(".dirRow.selected");
      if (selected) {
        const r = selected.getBoundingClientRect();
        const c = directoriesListEl.getBoundingClientRect();
        if (r.top < c.top || r.bottom > c.bottom) selected.scrollIntoView({ block: "nearest" });
      }
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

    if (directoriesSelectBtn) {
      directoriesSelectBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canUseBulkSelection()) return;
        WS.view.bulkActionMenuOpen = false;
        WS.view.dirActionMenuPath = "";
        if (WS.view.bulkSelectMode) {
          WS.view.bulkSelectMode = false;
          clearBulkTagSelection();
        } else {
          WS.view.bulkSelectMode = true;
        }
        renderDirectoriesPane(true);
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

    if (directoriesMenuBtn) {
      directoriesMenuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canUseBulkSelection()) return;
        const selected = getSelectedPathsInCurrentDir();
        if (!selected.length) return;
        WS.view.dirActionMenuPath = "";
        WS.view.bulkActionMenuOpen = !WS.view.bulkActionMenuOpen;
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

    if (directoriesClearBtn) {
      directoriesClearBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!canUseBulkSelection()) return;
        WS.view.bulkActionMenuOpen = false;
        clearBulkTagSelection();
        renderDirectoriesPane(true);
      });
    }

    document.addEventListener("click", (e) => {
      if (!WS.view.bulkActionMenuOpen && !WS.view.dirActionMenuPath) return;
      const target = e.target;
      if (target && target.closest) {
        if (target.closest(".dirMenu")) return;
        if (target.closest("#directoriesActionRow")) return;
      }
      closeActionMenus();
      renderDirectoriesPane(true);
    });

    toggleTagsBtn.addEventListener("click", () => {
      if (!WS.root || !WS.nav.dirNode) return;
      const available = getAvailableTagsForCurrentDir();
      if (!available.size) {
        renderDirectoriesPane(true);
        return;
      }
      WS.view.tagPanelOpen = !WS.view.tagPanelOpen;
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
        closeBulkTagPanel();
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
          closeBulkTagPanel();
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
        closeBulkTagPanel();
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
        closeBulkTagPanel();
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
        closeBulkTagPanel();
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
      closeBulkTagPanel();
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
      closeBulkTagPanel();
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
      closeBulkTagPanel();
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

    function getPreviewCounts() {
      const dirNode = getPreviewTargetDir();
      if (!dirNode) return { items: 0 };
      const items = getChildDirsForNode(dirNode).length + getOrderedFileIdsForDir(dirNode).length;
      return { items };
    }

    function getBreadcrumbNodesForDir(dirNode) {
      const nodes = [];
      let cur = dirNode;
      while (cur) { nodes.push(cur); cur = cur.parent; }
      nodes.reverse();
      return nodes;
    }

    function renderBreadcrumbInline(dirNode) {
      breadcrumbInlineEl.innerHTML = "";
      if (!WS.root || !dirNode) return;

      const crumbs = getBreadcrumbNodesForDir(dirNode);
      const frag = document.createDocumentFragment();

      crumbs.forEach((node, i) => {
        const el = document.createElement("div");
        el.className = "crumb";
        el.title = node.path ? displayPath(node.path) : "root";
        el.innerHTML = `<span>${escapeHtml(node === WS.root ? "root" : (displayName(node.name || "folder") || "folder"))}</span>`;
        el.addEventListener("click", () => {
          navigateToDirectory(node);
        });
        frag.appendChild(el);

        if (i < crumbs.length - 1) {
          const sep = document.createElement("div");
          sep.className = "sep";
          sep.textContent = "›";
          frag.appendChild(sep);
        }
      });

      breadcrumbInlineEl.appendChild(frag);
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
        previewImgEl.onload = () => previewImgEl.classList.add("ready");
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
        previewVideoEl.onloadeddata = () => previewVideoEl.classList.add("ready");

        const src = ensureMediaUrl(rec) || "";
        const same = previewVideoEl.src === src;
        if (!same) {
          previewVideoEl.src = src;
        }
        previewVideoEl.style.display = "block";

        applyVideoCarryToElement(previewVideoEl, rec.id);

        if (previewVideoEl.readyState >= 2) {
          requestAnimationFrame(() => { previewVideoEl.classList.add("ready"); });
        }
        if (doAuto) { try { previewVideoEl.play(); } catch {} }
        else { try { previewVideoEl.pause(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      previewImgEl.onload = () => previewImgEl.classList.add("ready");
      const src = ensureMediaUrl(rec) || "";
      const same = previewImgEl.src === src;
      if (!same) previewImgEl.src = src;
      previewImgEl.style.display = "block";

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
      closeBulkTagPanel();
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
        renderBreadcrumbInline(null);
        updateModePill();
        itemsPill.textContent = "Items: —";
        previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">Load a folder to begin.</div>`;
        return;
      }

      const targetDir = getPreviewTargetDir();
      const counts = getPreviewCounts();
      updateModePill();
      itemsPill.textContent = `Items: ${counts.items}`;
      renderBreadcrumbInline(targetDir);

      if (WS.preview.kind === "file" && WS.preview.fileId) {
        const rec = WS.fileById.get(WS.preview.fileId);
        if (!rec) {
          previewBodyEl.innerHTML = "";
          previewBodyEl.innerHTML = `<div class="label" style="padding:10px;">File not found.</div>`;
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

      if (!VIEWER_MODE) ACTIVE_MEDIA_SURFACE = "none";

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
        viewerImgEl.onload = () => viewerImgEl.classList.add("ready");
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
        viewerVideoEl.style.display = "none";
      }
      if (viewerImgEl) {
        try { viewerImgEl.removeAttribute("src"); } catch {}
        viewerImgEl.classList.remove("ready");
        viewerImgEl.style.display = "none";
      }
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
        viewerVideoEl.onloadeddata = () => viewerVideoEl.classList.add("ready");

        const src = ensureMediaUrl(rec) || "";
        const same = viewerVideoEl.src === src;
        if (!same) {
          viewerVideoEl.src = src;
          try { viewerVideoEl.load(); } catch {}
        }
        viewerVideoEl.style.display = "block";

        applyVideoCarryToElement(viewerVideoEl, rec.id);

        if (viewerVideoEl.readyState >= 2) {
          requestAnimationFrame(() => { viewerVideoEl.classList.add("ready"); });
        }
        if (doAuto) { try { viewerVideoEl.play(); } catch {} }
        preloadNextMedia(viewerItems, viewerIndex);
        return;
      }

      viewerImgEl.onload = () => viewerImgEl.classList.add("ready");
      const src = ensureMediaUrl(rec) || "";
      const same = viewerImgEl.src === src;
      if (!same) viewerImgEl.src = src;
      viewerImgEl.style.display = "block";

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

      if (toggleTagsBtn) toggleTagsBtn.disabled = true;
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

    function toggleRandomMode() {
      WS.view.randomMode = !WS.view.randomMode;
      applyViewModesEverywhere(true);
      showStatusMessage(`Random: ${WS.view.randomMode ? "On" : "Off"}`);
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

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "/") {
        if (isTextInputTarget(e.target)) return;
        if (VIEWER_MODE) return;
        if (directoriesSearchInput && !directoriesSearchInput.disabled) {
          e.preventDefault();
          try { directoriesSearchInput.focus(); directoriesSearchInput.select(); } catch {}
          return;
        }
        e.preventDefault();
        setHelpHold(true);
        return;
      }

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        applyBanicState(!BANIC_ACTIVE);
        return;
      }

      if (BANIC_ACTIVE) return;

      if (e.key === "Escape") {
        if (HELP_OPEN) { e.preventDefault(); closeHelp(); return; }
        if (OPTIONS_OPEN) { e.preventDefault(); closeOptions(); return; }
        if (WS.view.bulkActionMenuOpen || WS.view.dirActionMenuPath) {
          e.preventDefault();
          closeActionMenus();
          renderDirectoriesPane(true);
          return;
        }
      }

      if (HELP_OPEN) return;
      if (OPTIONS_OPEN) return;

      if (isTextInputTarget(e.target)) return;

      if (VIEWER_MODE) {
        const k = e.key;
        const altGallery = altGalleryModeEnabled();

        if (k === "Escape" || (!altGallery && (k === "g" || k === "G"))) { e.preventDefault(); hideOverlay(); return; }
        if (altGallery && (k === "a" || k === "A" || k === "j" || k === "J")) { e.preventDefault(); hideOverlay(); return; }

        if (k === "ArrowUp" || k === "w" || k === "W" || k === "i" || k === "I") { e.preventDefault(); viewerStep(-1); return; }
        if (k === "ArrowDown" || k === "s" || k === "S" || k === "k" || k === "K") { e.preventDefault(); viewerStep(1); return; }

        if (!altGallery && (k === "ArrowLeft" || k === "a" || k === "A" || k === "j" || k === "J" || k === "Backspace")) { e.preventDefault(); viewerLeaveDir(); return; }
        if (!altGallery && (k === "ArrowRight" || k === "d" || k === "D" || k === "l" || k === "L" || k === "Enter")) { e.preventDefault(); viewerEnterDir(); return; }

        if (k === " " ) { e.preventDefault(); toggleViewerVideoPlayPause(); return; }
        if (k === "q" || k === "Q" || k === "u" || k === "U") { e.preventDefault(); seekViewerVideo(-videoSkipStepSeconds()); return; }
        if (k === "e" || k === "E" || k === "o" || k === "O") { e.preventDefault(); seekViewerVideo(videoSkipStepSeconds()); return; }

        if (k === "f" || k === "F" || k === "h" || k === "H") { e.preventDefault(); cycleFilterMode(); return; }
        if (k === "r" || k === "R" || k === "y" || k === "Y") { e.preventDefault(); toggleRandomMode(); return; }
        if (k === "c" || k === "C" || k === "n" || k === "N") { e.preventDefault(); cycleFolderBehavior(); return; }
        if (k === "x" || k === "X" || k === "m" || k === "M") { e.preventDefault(); viewerJumpToNextFolderFirstFile(); return; }

        if (k === "Shift") {
          e.preventDefault();
          handleSlideshowHotkey(true);
          return;
        }

        if (k === "1" || k === "6") { e.preventDefault(); viewerJumpRelative(-50); return; }
        if (k === "2" || k === "7") { e.preventDefault(); viewerJumpRelative(-10); return; }
        if (k === "3" || k === "8") { e.preventDefault(); viewerJumpToPrevFolderFirstFile(); return; }
        if (k === "4" || k === "9") { e.preventDefault(); viewerJumpRelative(10); return; }
        if (k === "5" || k === "0") { e.preventDefault(); viewerJumpRelative(50); return; }

        return;
      }

      if (!WS.root) return;

      const k = e.key;

      const inFilePreview = (WS.preview.kind === "file" && !!WS.preview.fileId);

      if ((k === "g" || k === "G") && !altGalleryModeEnabled()) {
        e.preventDefault();
        if (inFilePreview) openGalleryFromViewerState(true);
        else openGalleryFromDirectoriesSelection(true);
        return;
      }

      if (k === "Escape") {
        e.preventDefault();
        if (inFilePreview) closeFilePreviewToFolder();
        return;
      }

      if (inFilePreview) {
        if (altGalleryModeEnabled() && (k === "d" || k === "D" || k === "l" || k === "L" || k === "Enter")) {
          e.preventDefault();
          openGalleryFromDirectoriesSelection(true);
          return;
        }
        if (k === "ArrowUp" || k === "w" || k === "W" || k === "i" || k === "I") { e.preventDefault(); viewerStep(-1); return; }
        if (k === "ArrowDown" || k === "s" || k === "S" || k === "k" || k === "K") { e.preventDefault(); viewerStep(1); return; }
        if (k === "ArrowLeft" || k === "a" || k === "A" || k === "j" || k === "J" || k === "Backspace") { e.preventDefault(); viewerLeaveDir(); return; }
        if (k === "ArrowRight" || k === "d" || k === "D" || k === "l" || k === "L" || k === "Enter") { e.preventDefault(); viewerEnterDir(); return; }

        if (k === " " ) { e.preventDefault(); toggleViewerVideoPlayPause(); return; }
        if (k === "q" || k === "Q" || k === "u" || k === "U") { e.preventDefault(); seekViewerVideo(-videoSkipStepSeconds()); return; }
        if (k === "e" || k === "E" || k === "o" || k === "O") { e.preventDefault(); seekViewerVideo(videoSkipStepSeconds()); return; }

        if (k === "f" || k === "F" || k === "h" || k === "H") { e.preventDefault(); cycleFilterMode(); return; }
        if (k === "r" || k === "R" || k === "y" || k === "Y") { e.preventDefault(); toggleRandomMode(); return; }
        if (k === "c" || k === "C" || k === "n" || k === "N") { e.preventDefault(); cycleFolderBehavior(); return; }
        if (k === "x" || k === "X" || k === "m" || k === "M") { e.preventDefault(); jumpToNextFolderFirstFile(); return; }

        if (k === "Shift") {
          e.preventDefault();
          handleSlideshowHotkey(false);
          return;
        }

        if (k === "1" || k === "6") { e.preventDefault(); viewerJumpRelative(-50); return; }
        if (k === "2" || k === "7") { e.preventDefault(); viewerJumpRelative(-10); return; }
        if (k === "3" || k === "8") { e.preventDefault(); viewerJumpToPrevFolderFirstFile(); return; }
        if (k === "4" || k === "9") { e.preventDefault(); viewerJumpRelative(10); return; }
        if (k === "5" || k === "0") { e.preventDefault(); viewerJumpRelative(50); return; }

        return;
      }

      if (k === "ArrowUp" || k === "w" || k === "W" || k === "i" || k === "I") { e.preventDefault(); moveDirectoriesSelection(-1); return; }
      if (k === "ArrowDown" || k === "s" || k === "S" || k === "k" || k === "K") { e.preventDefault(); moveDirectoriesSelection(1); return; }

      if (k === "ArrowLeft" || k === "a" || k === "A" || k === "j" || k === "J" || k === "Backspace") { e.preventDefault(); leaveDirectory(); return; }
      if (k === "ArrowRight" || k === "d" || k === "D" || k === "l" || k === "L" || k === "Enter") { e.preventDefault(); enterSelectedDirectory(); return; }

      if (k === "1" || k === "6") { e.preventDefault(); moveDirectoriesSelection(-50); return; }
      if (k === "2" || k === "7") { e.preventDefault(); moveDirectoriesSelection(-10); return; }
      if (k === "3" || k === "8") { e.preventDefault(); jumpToPrevFolderFirstFile(); return; }
      if (k === "4" || k === "9") { e.preventDefault(); moveDirectoriesSelection(10); return; }
      if (k === "5" || k === "0") { e.preventDefault(); moveDirectoriesSelection(50); return; }

      if (k === "f" || k === "F" || k === "h" || k === "H") { e.preventDefault(); cycleFilterMode(); return; }
      if (k === "r" || k === "R" || k === "y" || k === "Y") { e.preventDefault(); toggleRandomMode(); return; }
      if (k === "c" || k === "C" || k === "n" || k === "N") { e.preventDefault(); cycleFolderBehavior(); return; }
      if (k === "x" || k === "X" || k === "m" || k === "M") { e.preventDefault(); jumpToNextFolderFirstFile(); return; }

      if (k === "Shift") {
        e.preventDefault();
        handleSlideshowHotkey(false);
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
    renderDirectoriesPane();
    renderPreviewPane(true);
    syncButtons();

  
