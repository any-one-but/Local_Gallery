/* Media filters
   Turning the filter options into an overlay config, resolving which preset
   applies where, and the canvas effects (scanlines, halation, VHS...). */

function addColorFilter(filters, filterText) {
  const text = String(filterText || "").trim();
  if (!text || text === "none") return;
  filters.push(text);
}

function optionalOverlayAmount(value, min, max) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clampNumber(parsed, min, max, 0);
}

function firstPresentOverlayValue(opt, ...keys) {
  if (!opt || typeof opt !== "object") return null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (!Object.prototype.hasOwnProperty.call(opt, key)) continue;
    const value = opt[key];
    if (value == null || value === "") continue;
    return value;
  }
  return keys.length ? opt[keys[0]] : null;
}

// ===========================================================================
// Filters master switch.
//
// Set to true to bring the whole appearance/media-filter system back. While it
// is false:
//   * no overlay config is ever produced, so nothing (preview, viewer,
//     thumbnails, snapshots) can apply a colour filter, blur or film-corner
//     mask to media -- every resolver below returns null/false at the source;
//   * the "Filters" submenu is dropped from the app menu, along with
//     the per-folder / per-tag "Filters" preset overrides and the bulk ones;
//   * the per-preset "Toggle preset: ..." keybind actions disappear from the
//     Controls tab and are ignored at runtime.
//
// Stored data is deliberately left untouched -- saved presets, per-folder and
// per-tag assignments and the option values all stay on disk, so flipping this
// back to true restores exactly what was there.
const APPEARANCE_FILTERS_ENABLED = true;

function buildMediaOverlayConfigFromOptions(opt) {
  if (!APPEARANCE_FILTERS_ENABLED) return null;
  if (!opt) return null;
  const colorFilters = [];
  const brightnessAmount = optionalOverlayAmount(
    opt.brightnessOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.brightness.min,
    OVERLAY_SLIDER_LIMITS.brightness.max,
  );
  if (brightnessAmount != null && Math.abs(brightnessAmount) > 0.0001) {
    const amount = brightnessAmount;
    addColorFilter(
      colorFilters,
      `brightness(${Math.max(0, 1 + amount).toFixed(3)})`,
    );
  }
  const brightness =
    brightnessAmount != null && Math.abs(brightnessAmount) > 0.0001
      ? brightnessAmount
      : 0;
  const contrastAmount = optionalOverlayAmount(
    opt.contrastOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.contrast.min,
    OVERLAY_SLIDER_LIMITS.contrast.max,
  );
  if (contrastAmount != null && Math.abs(contrastAmount) > 0.0001) {
    const amount = contrastAmount;
    addColorFilter(
      colorFilters,
      `contrast(${Math.max(0, 1 + amount).toFixed(3)})`,
    );
  }
  const contrast =
    contrastAmount != null && Math.abs(contrastAmount) > 0.0001
      ? contrastAmount
      : 0;
  const saturationAmount = optionalOverlayAmount(
    opt.saturationOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.saturation.min,
    OVERLAY_SLIDER_LIMITS.saturation.max,
  );
  if (saturationAmount != null && Math.abs(saturationAmount) > 0.0001) {
    const amount = saturationAmount;
    addColorFilter(
      colorFilters,
      `saturate(${Math.max(0, 1 + amount).toFixed(3)})`,
    );
  }
  const saturation =
    saturationAmount != null && Math.abs(saturationAmount) > 0.0001
      ? saturationAmount
      : 0;
  const temperatureAmount = optionalOverlayAmount(
    firstPresentOverlayValue(
      opt,
      "warmthOverlayIntensity",
      "temperatureOverlayIntensity",
    ),
    OVERLAY_SLIDER_LIMITS.warmth.min,
    OVERLAY_SLIDER_LIMITS.warmth.max,
  );
  const temperature =
    temperatureAmount != null && Math.abs(temperatureAmount) > 0.0001
      ? temperatureAmount
      : 0;
  const hueShiftAmount = optionalOverlayAmount(
    opt.hueShiftOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.hueShift.min,
    OVERLAY_SLIDER_LIMITS.hueShift.max,
  );
  if (hueShiftAmount != null && Math.abs(hueShiftAmount) > 0.0001)
    addColorFilter(colorFilters, `hue-rotate(${hueShiftAmount.toFixed(1)}deg)`);
  const hueShift =
    hueShiftAmount != null && Math.abs(hueShiftAmount) > 0.0001
      ? hueShiftAmount
      : 0;

  const blackCrushAmount = optionalOverlayAmount(
    opt.blackCrushOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.blackCrush.min,
    OVERLAY_SLIDER_LIMITS.blackCrush.max,
  );
  const blackCrush =
    blackCrushAmount != null && blackCrushAmount > 0.0001
      ? blackCrushAmount
      : 0;
  const whiteCrushAmount = optionalOverlayAmount(
    opt.whiteCrushOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.whiteCrush.min,
    OVERLAY_SLIDER_LIMITS.whiteCrush.max,
  );
  const whiteCrush =
    whiteCrushAmount != null && whiteCrushAmount > 0.0001
      ? whiteCrushAmount
      : 0;
  const colorCrushAmount = optionalOverlayAmount(
    opt.colorCrushOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.colorCrush.min,
    OVERLAY_SLIDER_LIMITS.colorCrush.max,
  );
  const colorCrush =
    colorCrushAmount != null && colorCrushAmount > 0.0001
      ? colorCrushAmount
      : 0;
  const pixelateAmount = optionalOverlayAmount(
    opt.pixelateOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.pixelate.min,
    OVERLAY_SLIDER_LIMITS.pixelate.max,
  );
  const pixelate =
    pixelateAmount != null &&
    pixelateAmount > OVERLAY_SLIDER_LIMITS.pixelate.min + 0.0001
      ? pixelateAmount
      : 0;
  const blurAmount = optionalOverlayAmount(
    opt.blurOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.blur.min,
    OVERLAY_SLIDER_LIMITS.blur.max,
  );
  const blur = blurAmount != null && blurAmount > 0.0001 ? blurAmount : 0;
  const upscale = 0;
  const upscaler = 0;
  const chromaAmount = optionalOverlayAmount(
    opt.chromaOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.chroma.min,
    OVERLAY_SLIDER_LIMITS.chroma.max,
  );
  const chroma =
    chromaAmount != null && chromaAmount > 0.0001 ? chromaAmount : 0;
  const halation = 0;
  const ghosting = 0;
  const lineDamage = 0;
  const grainAmount = optionalOverlayAmount(
    opt.grainOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.grain.min,
    OVERLAY_SLIDER_LIMITS.grain.max,
  );
  const grain = grainAmount != null && grainAmount > 0.0001 ? grainAmount : 0;
  const vignetteAmount = optionalOverlayAmount(
    opt.vignetteOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.vignette.min,
    OVERLAY_SLIDER_LIMITS.vignette.max,
  );
  const vignette =
    vignetteAmount != null && vignetteAmount > 0.0001 ? vignetteAmount : 0;
  const cornerAmount = optionalOverlayAmount(
    opt.filmCornerOverlayIntensity,
    OVERLAY_SLIDER_LIMITS.filmCorner.min,
    OVERLAY_SLIDER_LIMITS.filmCorner.max,
  );
  const cornerRadius =
    cornerAmount != null && cornerAmount > 0.0001 ? cornerAmount : 0;

  if (
    !colorFilters.length &&
    !brightness &&
    !contrast &&
    !saturation &&
    !temperature &&
    !hueShift &&
    !colorCrush &&
    !blackCrush &&
    !whiteCrush &&
    !halation &&
    !ghosting &&
    !lineDamage &&
    !pixelate &&
    !blur &&
    !upscale &&
    !upscaler &&
    !chroma &&
    !grain &&
    !vignette &&
    !cornerRadius
  ) {
    return null;
  }
  return {
    colorFilters,
    brightness,
    contrast,
    saturation,
    temperature,
    hueShift,
    colorCrush,
    blackCrush,
    whiteCrush,
    halation,
    ghosting,
    lineDamage,
    pixelate,
    blur,
    upscale,
    upscaler,
    chroma,
    grain,
    vignette,
    cornerRadius,
  };
}



function serializeAppearanceValues(values) {
  const parts = [];
  for (let i = 0; i < APPEARANCE_SLIDER_OPTION_KEYS.length; i++) {
    const key = APPEARANCE_SLIDER_OPTION_KEYS[i];
    const value =
      values && Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : null;
    parts.push(`${key}:${value == null ? "null" : String(value)}`);
  }
  return parts.join("|");
}

function buildAppearancePresetCacheKey() {
  const currentValues = currentAppearanceValuesFromOptions(
    WS.meta && WS.meta.options ? WS.meta.options : null,
  );
  const presetSig = Array.isArray(
    WS.meta && WS.meta.appearancePresets ? WS.meta.appearancePresets : null,
  )
    ? WS.meta.appearancePresets
        .map((preset) => {
          const id = normalizeAppearancePresetIdValue(preset && preset.id);
          return `${id}:${serializeAppearanceValues(preset && preset.values ? preset.values : {})}`;
        })
        .join("||")
    : "";
  const folderSig =
    WS.meta && WS.meta.dirAppearancePresetIds
      ? Array.from(WS.meta.dirAppearancePresetIds.entries())
          .map(
            ([path, presetId]) =>
              `${normalizeDirPathValue(path)}=>${normalizeAppearancePresetIdValue(presetId)}`,
          )
          .sort()
          .join("||")
      : "";
  const tagSig =
    WS.meta && WS.meta.tagAppearancePresetIds
      ? Array.from(WS.meta.tagAppearancePresetIds.entries())
          .map(
            ([tagKey, presetId]) =>
              `${String(tagKey || "")}=>${normalizeAppearancePresetIdValue(presetId)}`,
          )
          .sort()
          .join("||")
      : "";
  const tagFilterSig =
    WS.meta && WS.meta.tagMediaFilterByKey
      ? Array.from(WS.meta.tagMediaFilterByKey.entries())
          .map(
            ([tagKey, filterValue]) =>
              `${String(tagKey || "")}=>${normalizeTagMediaFilterValue(filterValue).join(",")}`,
          )
          .sort()
          .join("||")
      : "";
  const folderFilterSig =
    WS.meta && WS.meta.folderMediaFilterByPath
      ? Array.from(WS.meta.folderMediaFilterByPath.entries())
          .map(
            ([path, filterValue]) =>
              `${normalizeDirPathValue(path)}=>${normalizeTagMediaFilterValue(filterValue).join(",")}`,
          )
          .sort()
          .join("||")
      : "";
  const activeContextSig = (() => {
    const direct = [
      String((WS.view && WS.view.tagFolderActiveMode) || ""),
      String((WS.view && WS.view.tagFolderActiveTag) || ""),
      String((WS.view && WS.view.tagFolderActiveAlbum) || ""),
      String((WS.view && WS.view.tagFolderOriginPath) || ""),
    ].join("|");
    const stackSig = Array.isArray(WS.view && WS.view.tagNavStack)
      ? WS.view.tagNavStack
          .map((frame) => {
            if (!frame || frame.type !== "tag-view") return "";
            return [
              "tag-view",
              String(frame.mode || ""),
              String(frame.tag || ""),
              String(frame.album || ""),
              String(frame.originPath || ""),
              String(frame.selectedDirPath || ""),
            ].join("|");
          })
          .filter(Boolean)
          .join("||")
      : "";
    return `${direct}###${stackSig}`;
  })();
  return `${serializeAppearanceValues(currentValues)}###${presetSig}###${folderSig}###${tagSig}###${tagFilterSig}###${folderFilterSig}###${activeContextSig}`;
}

function resolveDirPathForAppearanceTarget(target) {
  if (typeof target === "string") return normalizeDirPathValue(target);
  if (target && typeof target === "object") {
    if (typeof target.dirPath === "string")
      return normalizeDirPathValue(target.dirPath);
    if (typeof target.path === "string")
      return normalizeDirPathValue(target.path);
  }
  return "";
}

function contextualAppearancePresetIdForTagContext(
  mode,
  tag,
  album,
  originPath,
) {
  const contextMode = String(mode || "");
  const contextTag = normalizeTag(tag || "");
  const contextAlbum = normalizeTagAlbumName(album || "");
  const scopePath = normalizeDirPathValue(originPath);
  if (contextMode === "gallery" && contextTag) {
    return metaGetTagAppearancePresetIdByKey(
      tagThumbnailKeyForGallery(contextTag),
    );
  }
  if (contextMode === "tag" && contextTag) {
    const tagPresetId = metaGetTagAppearancePresetIdByKey(
      tagThumbnailKeyForTag(contextTag, scopePath),
    );
    if (tagPresetId) return tagPresetId;
    if (contextAlbum) {
      const albumPresetId = metaGetTagAppearancePresetIdByKey(
        tagThumbnailKeyForAlbum(contextAlbum, scopePath),
      );
      if (albumPresetId) return albumPresetId;
    }
    return "";
  }
  if (contextMode === "album" && contextAlbum) {
    return metaGetTagAppearancePresetIdByKey(
      tagThumbnailKeyForAlbum(contextAlbum, scopePath),
    );
  }
  return "";
}

function contextualTagMediaFilterForTagContext(mode, tag, album, originPath) {
  const contextMode = String(mode || "");
  const contextTag = normalizeTag(tag || "");
  const contextAlbum = normalizeTagAlbumName(album || "");
  if (contextMode === "gallery" && contextTag) {
    return metaGetTagMediaFilterByKey(tagThumbnailKeyForGallery(contextTag));
  }
  const scopePath = normalizeDirPathValue(originPath);
  if (contextMode === "tag" && contextTag) {
    const values = [
      metaGetTagMediaFilterByKey(tagThumbnailKeyForTag(contextTag, scopePath)),
    ];
    if (contextAlbum) {
      values.push(
        metaGetTagMediaFilterByKey(
          tagThumbnailKeyForAlbum(contextAlbum, scopePath),
        ),
      );
    }
    return combineTagMediaFilterValues(...values);
  }
  if (contextMode === "album" && contextAlbum) {
    return metaGetTagMediaFilterByKey(
      tagThumbnailKeyForAlbum(contextAlbum, scopePath),
    );
  }
  return [];
}

function contextualTagMediaFilterForDirPath(dirPath) {
  const normalized = normalizeDirPathValue(dirPath);
  const collected = [nearestFolderMediaFilterForPath(normalized)];
  const activeMode = String((WS.view && WS.view.tagFolderActiveMode) || "");
  if (activeMode) {
    const originPath = String((WS.view && WS.view.tagFolderOriginPath) || "");
    const activeTag =
      activeMode === "tag" || activeMode === "gallery"
        ? String((WS.view && WS.view.tagFolderActiveTag) || "")
        : "";
    const activeAlbum = String((WS.view && WS.view.tagFolderActiveAlbum) || "");
    const portalRoots = getPortalRootPathsForTagContext(
      activeMode,
      activeTag,
      activeAlbum,
      originPath,
    );
    for (let i = 0; i < portalRoots.length; i++) {
      if (!isSameOrDescendantPath(normalized, portalRoots[i])) continue;
      collected.push(
        contextualTagMediaFilterForTagContext(
          activeMode,
          activeTag,
          activeAlbum,
          originPath,
        ),
      );
      break;
    }
  }
  const stack = Array.isArray(WS.view && WS.view.tagNavStack)
    ? WS.view.tagNavStack
    : [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (!frame || frame.type !== "tag-view") continue;
    const rootPath = findMatchingVirtualPortalRootPath(frame, normalized);
    if (!rootPath) continue;
    collected.push(
      contextualTagMediaFilterForTagContext(
        frame.mode,
        frame.tag,
        frame.album,
        frame.originPath,
      ),
    );
  }
  return combineTagMediaFilterValues(...collected);
}

function currentContextualTagMediaFilterValue() {
  const context = currentActiveTagFolderContext();
  if (!context) return [];
  return contextualTagMediaFilterForTagContext(
    context.mode,
    context.tag,
    context.album,
    context.originPath,
  );
}

function currentActiveTagFolderContext() {
  if (!isViewingTagFolder()) return null;
  const mode = String((WS.view && WS.view.tagFolderActiveMode) || "");
  const originPath = String((WS.view && WS.view.tagFolderOriginPath) || "");
  if (mode === "tag") {
    const tag = normalizeTag((WS.view && WS.view.tagFolderActiveTag) || "");
    if (!tag) return null;
    return {
      mode,
      tag,
      album: normalizeTagAlbumName(
        (WS.view && WS.view.tagFolderActiveAlbum) || "",
      ),
      originPath,
    };
  }
  if (mode === "album") {
    const album = normalizeTagAlbumName(
      (WS.view && WS.view.tagFolderActiveAlbum) || "",
    );
    if (!album) return null;
    return { mode, tag: "", album, originPath };
  }
  if (mode === "gallery") {
    const gallery = normalizeGalleryName(
      (WS.view && WS.view.tagFolderActiveTag) || "",
    );
    if (!gallery) return null;
    return { mode, tag: gallery, album: "", gallery, originPath: "" };
  }
  return null;
}

function currentFolderMenuTagRemovalContext() {
  const context = currentActiveTagFolderContext();
  if (!context || context.mode !== "tag" || !context.tag) return null;
  return context;
}

function currentFolderMenuAlbumRemovalContext() {
  const context = currentActiveTagFolderContext();
  if (!context || context.mode !== "album" || !context.album) return null;
  return context;
}

function currentFolderMenuGalleryRemovalContext() {
  const context = currentActiveTagFolderContext();
  if (!context || context.mode !== "gallery" || !context.gallery) return null;
  return context;
}

function currentTagMenuAlbumRemovalContext() {
  const context = currentActiveTagFolderContext();
  if (!context || context.mode !== "album" || !context.album) return null;
  return context;
}

function currentTagMenuGalleryRemovalContext() {
  const context = currentActiveTagFolderContext();
  if (!context || context.mode !== "gallery" || !context.gallery) return null;
  return context;
}

function getPortalRootPathsForTagContext(mode, tag, album, originPath) {
  const contextMode = String(mode || "");
  const contextTag = normalizeTag(tag || "");
  const contextAlbum = normalizeTagAlbumName(album || "");
  if (contextMode === "gallery" && contextTag) {
    return getDirectDirsForGallery(contextTag)
      .map((node) => String(node?.path || ""))
      .filter(Boolean);
  }
  const scopePath = normalizeDirPathValue(originPath);
  const baseNode = WS.dirByPath.get(scopePath) || (!scopePath ? WS.root : null);
  if (!baseNode) return [];
  const showHidden =
    WS.view.hiddenMode ||
    showHiddenFolderEnabled() ||
    (isViewingTagFolder() && WS.view.tagFolderActiveMode === "hidden");
  const children = sortDirsForDisplay(baseNode.childrenDirs)
    .filter((child) => child && child.type === "dir")
    .filter((child) => (showHidden ? true : !isDirOrAncestorHidden(child)));
  if (contextMode === "tag" && contextTag) {
    // A Tag's folders can sit anywhere in the library, not just below the
    // folder its card is in.
    return tagMemberDirNodes(contextTag)
      .filter((node) => (showHidden ? true : !isDirOrAncestorHidden(node)))
      .map((node) => String(node.path || ""))
      .filter(Boolean);
  }
  if (contextMode === "album" && contextAlbum) {
    return children
      .filter((child) => {
        if (metaGetAlbumForPath(child.path || "") === contextAlbum)
          return true;
        const tags = metaGetUserTags(child.path || "");
        for (let i = 0; i < tags.length; i++) {
          if (metaGetTagAlbumForTag(tags[i], scopePath) === contextAlbum)
            return true;
        }
        return false;
      })
      .map((child) => String(child.path || ""))
      .filter(Boolean);
  }
  return [];
}

function contextualAppearancePresetIdForDirPath(dirPath) {
  const normalized = normalizeDirPathValue(dirPath);
  if (!normalized) return "";
  const activeMode = String((WS.view && WS.view.tagFolderActiveMode) || "");
  if (activeMode === "tag") {
    const originPath = String((WS.view && WS.view.tagFolderOriginPath) || "");
    const node = WS.dirByPath.get(normalized) || null;
    if (node) {
      const activeTag = normalizeTag(
        (WS.view && WS.view.tagFolderActiveTag) || "",
      );
      if (activeTag) {
        const userTags = metaGetUserTags(normalized);
        if (userTags.includes(activeTag)) {
          const directPresetId = contextualAppearancePresetIdForTagContext(
            activeMode,
            activeTag,
            WS.view && WS.view.tagFolderActiveAlbum,
            originPath,
          );
          if (directPresetId) return directPresetId;
        }
      }
    }
  }
  const stack = Array.isArray(WS.view && WS.view.tagNavStack)
    ? WS.view.tagNavStack
    : [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (!frame || frame.type !== "tag-view") continue;
    const rootPath = findMatchingVirtualPortalRootPath(frame, normalized);
    if (!rootPath) continue;
    const presetId = contextualAppearancePresetIdForTagContext(
      frame.mode,
      frame.tag,
      frame.album,
      frame.originPath,
    );
    if (presetId) return presetId;
  }
  return "";
}

function resolveAppearancePresetIdForTarget(target) {
  const dirPath = resolveDirPathForAppearanceTarget(target);
  const contextualPresetId = contextualAppearancePresetIdForDirPath(dirPath);
  if (contextualPresetId) return contextualPresetId;
  return nearestFolderAppearancePresetIdForPath(dirPath);
}

function resolveAppearanceValuesForTarget(target) {
  const presetId = resolveAppearancePresetIdForTarget(target);
  if (presetId) {
    const preset = getAppearancePresetById(presetId);
    if (!preset || !preset.values) return {};
    return preset.values;
  }
  return currentAppearanceValuesFromOptions(
    WS.meta && WS.meta.options ? WS.meta.options : null,
  );
}

function resolveMediaOverlayConfigForTarget(target) {
  if (!APPEARANCE_FILTERS_ENABLED) return null;
  if (!mediaProcessingEnabledForTarget(target)) return null;
  const presetId = resolveAppearancePresetIdForTarget(target);
  if (presetId) {
    const preset = getAppearancePresetById(presetId);
    if (preset)
      return buildMediaOverlayConfigFromOptions(preset.values || null);
  }
  return (
    MEDIA_OVERLAY_STATE ||
    buildMediaOverlayConfigFromOptions(
      WS.meta && WS.meta.options ? WS.meta.options : null,
    )
  );
}

// resolveMediaOverlayConfigForTarget() allocates a fresh colorFilters array plus
// several template strings on every call. drawSurface() calls it once per
// rendered video frame (up to 60/sec for the preview pane), so during video
// playback this runs continuously — steady per-frame allocation is exactly the
// kind of pressure that leads to a GC pause showing up as a stuck frame (video
// keeps decoding underneath; only the canvas redraw stalls for that pause).
// A short TTL cache, keyed per WebGL surface, cuts the rebuild rate drastically
// while staying well under the threshold where a live filter tweak would look
// laggy (50ms is imperceptible against a ~16ms frame budget already gating on
// requestRender).
const OVERLAY_CONFIG_CACHE_TTL_MS = 50;
function resolveMediaOverlayConfigForSurface(surface) {
  if (!surface) return resolveMediaOverlayConfigForTarget(null);
  const now =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  if (
    surface._overlayCfgTarget === surface.target &&
    surface._overlayCfgAt != null &&
    now - surface._overlayCfgAt < OVERLAY_CONFIG_CACHE_TTL_MS
  ) {
    return surface._overlayCfgVal;
  }
  const cfg = resolveMediaOverlayConfigForTarget(surface.target);
  surface._overlayCfgTarget = surface.target;
  surface._overlayCfgAt = now;
  surface._overlayCfgVal = cfg;
  return cfg;
}

function resolveFolderOnlyMediaOverlayConfigForTarget(target) {
  if (!APPEARANCE_FILTERS_ENABLED) return null;
  if (!mediaProcessingEnabledForTarget(target)) return null;
  const dirPath = resolveDirPathForAppearanceTarget(target);
  const folderPresetId = nearestFolderAppearancePresetIdForPath(dirPath);
  if (folderPresetId) {
    const preset = getAppearancePresetById(folderPresetId);
    if (preset)
      return buildMediaOverlayConfigFromOptions(preset.values || null);
  }
  return buildMediaOverlayConfigFromOptions(
    WS.meta && WS.meta.options ? WS.meta.options : null,
  );
}

const EMPTY_MEDIA_OVERLAY_CONFIG = Object.freeze({
  colorFilters: Object.freeze([]),
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  hueShift: 0,
  colorCrush: 0,
  blackCrush: 0,
  whiteCrush: 0,
  halation: 0,
  ghosting: 0,
  lineDamage: 0,
  pixelate: 0,
  blur: 0,
  upscale: 0,
  upscaler: 0,
  chroma: 0,
  grain: 0,
  vignette: 0,
  cornerRadius: 0,
});

function mediaOverlayConfigHasVisualEffect(cfg) {
  if (!cfg) return false;
  if (Array.isArray(cfg.colorFilters) && cfg.colorFilters.length) return true;
  const keys = [
    "brightness",
    "contrast",
    "saturation",
    "temperature",
    "hueShift",
    "colorCrush",
    "blackCrush",
    "whiteCrush",
    "halation",
    "ghosting",
    "lineDamage",
    "pixelate",
    "blur",
    "chroma",
    "grain",
    "vignette",
    "cornerRadius",
  ];
  for (let i = 0; i < keys.length; i++) {
    if (Math.abs(Number(cfg[keys[i]]) || 0) > 0.0001) return true;
  }
  return false;
}

function mediaOverlayConfigRequiresProcessingPipeline(cfg) {
  if (!cfg) return false;
  const pipelineKeys = [
    "temperature",
    "colorCrush",
    "blackCrush",
    "whiteCrush",
    "halation",
    "ghosting",
    "lineDamage",
    "pixelate",
    "upscale",
    "upscaler",
    "chroma",
    "grain",
    "vignette",
  ];
  for (let i = 0; i < pipelineKeys.length; i++) {
    if (Math.abs(Number(cfg[pipelineKeys[i]]) || 0) > 0.0001) return true;
  }
  return false;
}

function mediaOverlayConfigColorFilterCss(cfg) {
  if (!cfg || !Array.isArray(cfg.colorFilters) || !cfg.colorFilters.length)
    return "";
  return cfg.colorFilters.join(" ");
}

function mediaOverlayConfigDirectFilterCss(cfg) {
  const parts = [];
  const colorFilter = mediaOverlayConfigColorFilterCss(cfg);
  if (colorFilter) parts.push(colorFilter);
  const blur = Number(cfg && cfg.blur);
  if (Number.isFinite(blur) && blur > 0.0001) {
    parts.push(`blur(${clampNumber(blur, 0, OVERLAY_SLIDER_LIMITS.blur.max, 0).toFixed(2)}px)`);
  }
  return parts.join(" ");
}

function targetRequiresMediaProcessingPipeline(target) {
  if (isGifRecord(target)) return false;
  return mediaOverlayConfigRequiresProcessingPipeline(
    resolveMediaOverlayConfigForTarget(target),
  );
}

function drawBlurredCanvasToScratch(
  sourceCanvas,
  scratchCanvas,
  scratchCtx,
  tempCanvas,
  tempCtx,
  blurPx,
  overlayCfg,
) {
  const amount = Number(blurPx);
  if (!Number.isFinite(amount) || amount <= 0.0001) return false;
  resizeCanvasBuffer(scratchCanvas, sourceCanvas.width, sourceCanvas.height);
  scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
  const scale = clampNumber(1 / (1 + amount * 0.65), 0.08, 0.82, 0.5);
  resizeCanvasBuffer(
    tempCanvas,
    Math.max(1, Math.round(sourceCanvas.width * scale)),
    Math.max(1, Math.round(sourceCanvas.height * scale)),
  );
  tempCtx.setTransform(1, 0, 0, 1, 0, 0);
  tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
  tempCtx.imageSmoothingEnabled = true;
  tempCtx.filter = "none";
  tempCtx.drawImage(sourceCanvas, 0, 0, tempCanvas.width, tempCanvas.height);
  configureCanvasUpscaleSmoothing(scratchCtx, overlayCfg, 1);
  scratchCtx.filter = "none";
  scratchCtx.imageSmoothingEnabled = true;
  scratchCtx.drawImage(
    tempCanvas,
    0,
    0,
    scratchCanvas.width,
    scratchCanvas.height,
  );
  return true;
}

function mediaOverlayLiveVideoProfile(overlayCfg) {
  if (!overlayCfg) {
    return {
      maxFps: 30,
      maxOutputPixels: 1600000,
      maxWorkPixels: 1000000,
    };
  }
  let cost = 0;
  if (Array.isArray(overlayCfg.colorFilters) && overlayCfg.colorFilters.length)
    cost += 1.4;
  if (
    Math.abs(Number(overlayCfg.temperature) || 0) > 0.0001 ||
    Number(overlayCfg.colorCrush || 0) > 0.0001 ||
    Number(overlayCfg.blackCrush || 0) > 0.0001 ||
    Number(overlayCfg.whiteCrush || 0) > 0.0001
  )
    cost += 3.0;
  if (Number(overlayCfg.chroma || 0) > 0.0001) cost += 2.2;
  if (Number(overlayCfg.blur || 0) > 0.0001)
    cost += Number(overlayCfg.blur || 0) > 2 ? 2.1 : 1.1;
  if (Number(overlayCfg.pixelate || 0) > 0.0001) cost += 0.4;
  if (Number(overlayCfg.grain || 0) > 0.0001) cost += 0.4;
  if (Number(overlayCfg.vignette || 0) > 0.0001) cost += 0.25;
  if (Number(overlayCfg.cornerRadius || 0) > 0.0001) cost += 0.25;

  if (cost >= 7) {
    return {
      maxFps: 16,
      maxOutputPixels: 700000,
      maxWorkPixels: 360000,
    };
  }
  if (cost >= 4) {
    return {
      maxFps: 20,
      maxOutputPixels: 900000,
      maxWorkPixels: 520000,
    };
  }
  return {
    maxFps: 24,
    maxOutputPixels: 1200000,
    maxWorkPixels: 780000,
  };
}

function capScaleForPixelBudget(width, height, maxPixels) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const max = Math.max(1, Number(maxPixels) || 1);
  const pixels = w * h;
  if (!(pixels > max)) return 1;
  return clampNumber(Math.sqrt(max / pixels), 0.1, 1, 1);
}


function anyMediaFilterEnabled() {
  if (!APPEARANCE_FILTERS_ENABLED) return false;
  if (
    MEDIA_OVERLAY_STATE ||
    buildMediaOverlayConfigFromOptions(
      WS.meta && WS.meta.options ? WS.meta.options : null,
    )
  )
    return true;
  if (WS.meta && WS.meta.dirAppearancePresetIds) {
    for (const presetId of WS.meta.dirAppearancePresetIds.values()) {
      const preset = getAppearancePresetById(presetId);
      if (preset && buildMediaOverlayConfigFromOptions(preset.values || null))
        return true;
    }
  }
  if (WS.meta && WS.meta.tagAppearancePresetIds) {
    for (const presetId of WS.meta.tagAppearancePresetIds.values()) {
      const preset = getAppearancePresetById(presetId);
      if (preset && buildMediaOverlayConfigFromOptions(preset.values || null))
        return true;
    }
  }
  return false;
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

const PREVIEW_RENDER_MAX_PIXELS_IMAGE = 24000000;
const PREVIEW_RENDER_MAX_PIXELS_IMAGE_FILTERED = 10000000;
const PREVIEW_RENDER_MAX_PIXELS_VIDEO = 18000000;
const PREVIEW_RENDER_MAX_PIXELS_VIDEO_LIVE = 14000000;

function mediaOverlayStillImageProfile(overlayCfg) {
  if (!mediaOverlayConfigRequiresProcessingPipeline(overlayCfg)) {
    return { maxPixels: PREVIEW_RENDER_MAX_PIXELS_IMAGE };
  }
  let cost = 0;
  if (
    Math.abs(Number(overlayCfg.temperature) || 0) > 0.0001 ||
    Number(overlayCfg.colorCrush || 0) > 0.0001 ||
    Number(overlayCfg.blackCrush || 0) > 0.0001 ||
    Number(overlayCfg.whiteCrush || 0) > 0.0001
  )
    cost += 1.8;
  if (Number(overlayCfg.chroma || 0) > 0.0001) cost += 1.8;
  if (Number(overlayCfg.blur || 0) > 0.0001)
    cost += Number(overlayCfg.blur || 0) > 2 ? 2.2 : 1.2;
  if (Number(overlayCfg.pixelate || 0) > 0.0001) cost += 0.4;
  if (Number(overlayCfg.grain || 0) > 0.0001) cost += 0.7;
  if (Number(overlayCfg.vignette || 0) > 0.0001) cost += 0.25;
  if (Number(overlayCfg.cornerRadius || 0) > 0.0001) cost += 0.25;
  if (cost >= 4) return { maxPixels: 6000000 };
  if (cost >= 2) return { maxPixels: 8000000 };
  return { maxPixels: PREVIEW_RENDER_MAX_PIXELS_IMAGE_FILTERED };
}

function previewPaneUpscaleAmountForSurface(surface, overlayCfg) {
  if (!surface || String(surface.name || "") === "preview") return 0;
  if (!overlayCfg || !mediaOverlayConfigHasVisualEffect(overlayCfg)) return 0;
  return 1;
}

function previewPaneUpscaleRenderScaleForSurface(surface, overlayCfg, rect, isVideo = false) {
  const amount = previewPaneUpscaleAmountForSurface(surface, overlayCfg);
  if (!(amount > 0.0001)) return 1;
  const baseW = Math.max(1, Number(rect && rect.w) || 1);
  const baseH = Math.max(1, Number(rect && rect.h) || 1);
  const desiredScale = 1 + amount;
  const maxPixels = isVideo ? 6000000 : 12000000;
  const desiredPixels = baseW * baseH * desiredScale * desiredScale;
  if (desiredPixels <= maxPixels) return desiredScale;
  const cappedScale = Math.sqrt(maxPixels / Math.max(1, baseW * baseH));
  return clampNumber(cappedScale, 1, desiredScale, 1);
}

function previewRenderMaxPixels(surface, isVideo, isVideoPlaying, overlayCfg) {
  if (!surface || String(surface.name || "") !== "preview") {
    return isVideo ? 12000000 : 16000000;
  }
  if (isVideo && isVideoPlaying) {
    return mediaOverlayConfigHasVisualEffect(overlayCfg)
      ? PREVIEW_RENDER_MAX_PIXELS_VIDEO_LIVE
      : PREVIEW_RENDER_MAX_PIXELS_VIDEO;
  }
  if (isVideo) return PREVIEW_RENDER_MAX_PIXELS_VIDEO;
  return mediaOverlayStillImageProfile(overlayCfg).maxPixels;
}

function computePreviewRenderScale(
  surface,
  overlayCfg,
  rect,
  croppedSrcW,
  croppedSrcH,
  isVideo = false,
  pixelScale = 1,
) {
  const isPreview = !!(surface && String(surface.name || "") === "preview");
  const dpr = window.devicePixelRatio || 1;
  const destW = Math.max(1, Number(rect && rect.w) || 1) * dpr * Math.max(1, pixelScale);
  const destH = Math.max(1, Number(rect && rect.h) || 1) * dpr * Math.max(1, pixelScale);
  const srcW = Math.max(1, Number(croppedSrcW) || 1);
  const srcH = Math.max(1, Number(croppedSrcH) || 1);
  const sourceScale = Math.min(srcW / destW, srcH / destH);
  if (!isPreview) {
    if (mediaOverlayConfigHasVisualEffect(overlayCfg)) {
      return previewPaneUpscaleRenderScaleForSurface(surface, overlayCfg, rect, isVideo);
    }
    return 1;
  }
  const maxPixels = previewRenderMaxPixels(surface, isVideo, false, overlayCfg);
  const basePixels =
    Math.max(1, Number(rect && rect.w) || 1) *
    Math.max(1, Number(rect && rect.h) || 1) *
    dpr *
    dpr;
  const maxScale = Math.sqrt(maxPixels / basePixels);
  return clampNumber(sourceScale, 1, maxScale, 1);
}

function expandRectFromCenter(rect, pad) {
  const p = Math.max(0, Number(pad) || 0);
  return {
    x: rect.x - p,
    y: rect.y - p,
    w: rect.w + p * 2,
    h: rect.h + p * 2,
  };
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

function getMediaFilterForType(target = undefined) {
  const cfg = resolveMediaOverlayConfigForTarget(target);
  return cfg ? "custom" : "off";
}

function getMediaFilterIntensity() {
  return 1;
}

function parseFilterNumberWithUnit(raw) {
  const m = String(raw || "")
    .trim()
    .match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
  if (!m) return null;
  const value = parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  return { value, unit: String(m[2] || "") };
}

function scaleCssFilterString(filterText, intensity) {
  const t = Math.max(
    0,
    Number.isFinite(Number(intensity)) ? Number(intensity) : 1,
  );
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
    if (fn === "saturate" || fn === "contrast" || fn === "brightness")
      ident = unit === "%" ? 100 : 1;
    else if (fn === "hue-rotate") ident = 0;
    else if (fn === "grayscale" || fn === "sepia" || fn === "invert") ident = 0;
    if (ident === null) {
      out.push(`${fn}(${argRaw})`);
      continue;
    }
    const next = ident + (target - ident) * t;
    const shown =
      Math.abs(next) >= 100 || Number.isInteger(next)
        ? String(Math.round(next))
        : next.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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
  return normalizeAnimatedMediaFiltersValue(
    MEDIA_FILTER_STATE.animatedMode,
    "on",
  );
}

function animatedMediaFiltersEnabledForType(type) {
  const mode = animatedMediaFiltersMode();
  if (mode === "off") return false;
  if (mode === "videos") return type === "video";
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
  if (target && typeof target === "object") {
    if (isGifRecord(target)) return false;
  }
  return true;
}

function resizeCanvasBuffer(canvas, width, height) {
  if (!canvas) return;
  const w = Math.max(1, Math.round(width || 1));
  const h = Math.max(1, Math.round(height || 1));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}

function overlayUpscaleSmoothingAmount(overlayCfg, fallback = 1) {
  if (
    overlayCfg &&
    Object.prototype.hasOwnProperty.call(overlayCfg, "upscaleSmoothing") &&
    overlayCfg.upscaleSmoothing != null
  ) {
    const parsed = Number(overlayCfg.upscaleSmoothing);
    if (Number.isFinite(parsed)) return clampNumber(parsed, 0, 1, fallback);
  }
  const fallbackParsed = Number(fallback);
  return Number.isFinite(fallbackParsed) ? clampNumber(fallbackParsed, 0, 1, 1) : 1;
}

function configureCanvasUpscaleSmoothing(ctx, overlayCfg, fallback = 1) {
  if (!ctx) return overlayUpscaleSmoothingAmount(overlayCfg, fallback);
  const amount = overlayUpscaleSmoothingAmount(overlayCfg, fallback);
  ctx.imageSmoothingEnabled = amount > 0.0001;
  if (ctx.imageSmoothingEnabled && "imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = amount >= 0.74 ? "high" : amount >= 0.34 ? "medium" : "low";
  }
  return amount;
}

function hashNoise1(seed) {
  const x = Math.sin(Number(seed || 0) * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function ensureEffectWorkCanvas(
  host,
  canvasKey,
  ctxKey,
  width,
  height,
  ctxOptions = undefined,
) {
  if (!host[canvasKey]) host[canvasKey] = document.createElement("canvas");
  const canvas = host[canvasKey];
  if (!host[ctxKey]) host[ctxKey] = canvas.getContext("2d", ctxOptions);
  const ctx = host[ctxKey];
  resizeCanvasBuffer(canvas, width, height);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  return { canvas, ctx };
}

function drawActualScanlinesToContext(ctx, rect, amount, options = null) {
  if (!ctx || !rect || !(amount > 0.0001)) return;
  const dpr = Math.max(1, Number(options && options.dpr) || 1);
  const alpha = clampNumber(0.16 + amount * 0.68, 0, 0.92);
  const glowAlpha = clampNumber(alpha * 0.24, 0, 0.22);
  const lineWidth = 1 / dpr;
  const x0 = Number(rect.x || 0);
  const x1 = x0 + Math.max(0, Number(rect.w || 0));
  const yStartPx = Math.floor(Number(rect.y || 0) * dpr);
  const yEndPx = Math.ceil(
    (Number(rect.y || 0) + Math.max(0, Number(rect.h || 0))) * dpr,
  );
  if (x1 <= x0 || yEndPx <= yStartPx) return;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.globalCompositeOperation = "multiply";
  ctx.strokeStyle = `rgba(0,0,0,${alpha.toFixed(3)})`;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (let yPx = yStartPx; yPx < yEndPx; yPx += 2) {
    const y = (yPx + 0.5) / dpr;
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
  }
  ctx.stroke();
  if (glowAlpha > 0.0001) {
    ctx.globalCompositeOperation = "screen";
    ctx.strokeStyle = `rgba(255,255,255,${glowAlpha.toFixed(3)})`;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    for (let yPx = yStartPx + 1; yPx < yEndPx; yPx += 2) {
      const y = (yPx + 0.5) / dpr;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function buildHalationMaskCanvas(sourceCanvas, amount, host) {
  if (!sourceCanvas || !(amount > 0.0001) || !host) return null;
  const srcW = Math.max(1, sourceCanvas.width || 1);
  const srcH = Math.max(1, sourceCanvas.height || 1);
  const sampleScale = clampNumber(0.16 + amount * 0.12, 0.16, 0.3);
  const sampleW = Math.max(12, Math.round(srcW * sampleScale));
  const sampleH = Math.max(12, Math.round(srcH * sampleScale));
  const extract = ensureEffectWorkCanvas(
    host,
    "halationExtractCanvas",
    "halationExtractCtx",
    sampleW,
    sampleH,
    { willReadFrequently: true },
  );
  extract.ctx.drawImage(sourceCanvas, 0, 0, sampleW, sampleH);
  let imageData = null;
  try {
    imageData = extract.ctx.getImageData(0, 0, sampleW, sampleH);
  } catch {
    imageData = null;
  }
  if (!imageData) return null;
  const data = imageData.data;
  const lumas = new Float32Array(sampleW * sampleH);
  for (let i = 0, px = 0; i < data.length; i += 4, px++) {
    lumas[px] =
      (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  }
  const threshold = clampNumber(0.68 - amount * 0.12, 0.5, 0.74);
  const highlightSoftness = 0.15 + amount * 0.08;
  const localSoftness = Math.max(0.05, 0.11 - amount * 0.03);
  for (let y = 0; y < sampleH; y++) {
    const yOff = y * sampleW;
    const yPrev = (y > 0 ? y - 1 : y) * sampleW;
    const yNext = (y + 1 < sampleH ? y + 1 : y) * sampleW;
    for (let x = 0; x < sampleW; x++) {
      const idx = yOff + x;
      const i = idx * 4;
      const luma = lumas[idx];
      const left = lumas[yOff + (x > 0 ? x - 1 : x)];
      const right = lumas[yOff + (x + 1 < sampleW ? x + 1 : x)];
      const up = lumas[yPrev + x];
      const down = lumas[yNext + x];
      const localAvg = (left + right + up + down) * 0.25;
      const localPeak = luma - localAvg;
      const localEdge = Math.max(
        Math.abs(luma - left),
        Math.abs(luma - right),
        Math.abs(luma - up),
        Math.abs(luma - down),
      );
      const peakMask = clampNumber(
        (luma - threshold) / highlightSoftness,
        0,
        1,
      );
      const isolationMask = clampNumber(
        (localPeak + localEdge * 0.55 - 0.015) / localSoftness,
        0,
        1,
      );
      const coreMask = clampNumber((luma - 0.9) / 0.07, 0, 1);
      const mask = clampNumber(
        peakMask * (0.25 + isolationMask * 1.05) + coreMask * 0.35,
        0,
        1,
      );
      if (mask <= 0.0001) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 0;
        continue;
      }
      const warm = clampNumber(isolationMask * (0.5 + amount * 0.18), 0, 0.72);
      const whiteLift = clampNumber(coreMask * 0.9, 0, 0.9);
      data[i] = 255;
      data[i + 1] = clampNumber(
        Math.round(228 + warm * 16 + whiteLift * 18),
        0,
        255,
        255,
      );
      data[i + 2] = clampNumber(
        Math.round(196 + whiteLift * 56 - warm * 24),
        0,
        255,
        255,
      );
      data[i + 3] = Math.round(255 * Math.pow(mask, 0.76));
    }
  }
  extract.ctx.putImageData(imageData, 0, 0);
  return extract;
}

function drawHalationToContext(ctx, sourceCanvas, rect, amount, host) {
  if (!ctx || !sourceCanvas || !rect || !(amount > 0.0001) || !host) return;
  const extract = buildHalationMaskCanvas(sourceCanvas, amount, host);
  if (!extract) return;
  const minSide = Math.max(1, Math.min(rect.w, rect.h));
  const workW = Math.max(12, Math.round(rect.w * 0.38));
  const workH = Math.max(12, Math.round(rect.h * 0.38));
  const work = ensureEffectWorkCanvas(
    host,
    "halationWorkCanvas",
    "halationWorkCtx",
    workW,
    workH,
  );
  const bloomBlur = 0.6 + amount * 2.2;
  const coreBlur = 0.3 + amount * 0.95;
  const smearPx = Math.max(
    1,
    (minSide * 0.004 + amount * 7) * (workH / Math.max(1, rect.h)),
  );
  const steps = Math.max(1, Math.round(2 + amount * 2));
  work.ctx.imageSmoothingEnabled = true;
  work.ctx.filter = `blur(${bloomBlur.toFixed(2)}px)`;
  work.ctx.globalCompositeOperation = "source-over";
  work.ctx.globalAlpha = 1;
  work.ctx.drawImage(extract.canvas, 0, 0, workW, workH);
  work.ctx.globalCompositeOperation = "lighter";
  for (let step = 1; step <= steps; step++) {
    const falloff = 1 - step / (steps + 1);
    const offset = smearPx * step;
    work.ctx.globalAlpha = clampNumber(
      (0.12 + amount * 0.16) * falloff,
      0,
      0.32,
    );
    work.ctx.drawImage(extract.canvas, 0, offset, workW, workH);
    work.ctx.drawImage(extract.canvas, 0, -(offset * 0.55), workW, workH);
  }
  work.ctx.globalCompositeOperation = "screen";
  work.ctx.globalAlpha = clampNumber(0.25 + amount * 0.18, 0, 0.42);
  work.ctx.filter = `blur(${coreBlur.toFixed(2)}px)`;
  work.ctx.drawImage(extract.canvas, 0, 0, workW, workH);
  work.ctx.filter = "none";
  work.ctx.globalAlpha = 1;
  work.ctx.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = clampNumber(0.12 + amount * 0.26, 0, 0.42);
  ctx.filter = "none";
  ctx.drawImage(work.canvas, rect.x, rect.y, rect.w, rect.h);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = clampNumber(0.04 + amount * 0.08, 0, 0.14);
  ctx.drawImage(extract.canvas, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawTemporalGhostingToContext(
  ctx,
  sourceCanvas,
  rect,
  amount,
  time,
  host,
  options = null,
) {
  if (!ctx || !sourceCanvas || !rect || !(amount > 0.0001) || !host) return;
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const animated = !!(options && options.animated);
  const ghostScale = clampNumber(0.58 - amount * 0.18, 0.34, 0.58);
  const ghostW = Math.max(12, Math.round(w * ghostScale));
  const ghostH = Math.max(12, Math.round(h * ghostScale));
  if (!host.ghostPrevCanvas)
    host.ghostPrevCanvas = document.createElement("canvas");
  if (!host.ghostPrevCtx)
    host.ghostPrevCtx = host.ghostPrevCanvas.getContext("2d");
  if (!host.ghostWorkCanvas)
    host.ghostWorkCanvas = document.createElement("canvas");
  if (!host.ghostWorkCtx)
    host.ghostWorkCtx = host.ghostWorkCanvas.getContext("2d");
  resizeCanvasBuffer(host.ghostPrevCanvas, ghostW, ghostH);
  resizeCanvasBuffer(host.ghostWorkCanvas, ghostW, ghostH);
  const prevCtx = host.ghostPrevCtx;
  const workCtx = host.ghostWorkCtx;
  const hasPrev = animated && !!host.ghostHasFrame;
  workCtx.setTransform(1, 0, 0, 1, 0, 0);
  workCtx.clearRect(0, 0, ghostW, ghostH);
  workCtx.imageSmoothingEnabled = true;
  const shiftX =
    (animated ? Math.sin((time || 0) * 0.0031) : 0.75) *
    (0.9 + amount * 5.4) *
    (ghostW / Math.max(1, w));
  const shiftY =
    (animated ? Math.cos((time || 0) * 0.0022) * 0.35 * amount : 0) *
    (ghostH / Math.max(1, h));
  workCtx.filter = `blur(${Math.max(0.35, 0.45 + amount * 0.85).toFixed(2)}px)`;
  if (hasPrev) {
    workCtx.drawImage(host.ghostPrevCanvas, shiftX, shiftY, ghostW, ghostH);
  } else {
    workCtx.drawImage(sourceCanvas, shiftX, shiftY, ghostW, ghostH);
  }
  workCtx.filter = "none";

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = clampNumber(0.08 + amount * 0.26, 0, 0.38);
  ctx.drawImage(host.ghostWorkCanvas, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();

  if (animated) {
    prevCtx.setTransform(1, 0, 0, 1, 0, 0);
    prevCtx.clearRect(0, 0, ghostW, ghostH);
    prevCtx.imageSmoothingEnabled = true;
    prevCtx.filter = "none";
    prevCtx.drawImage(sourceCanvas, 0, 0, ghostW, ghostH);
    host.ghostHasFrame = true;
  } else {
    host.ghostHasFrame = false;
  }
}

function drawLineDamageToContext(
  ctx,
  sourceCanvas,
  rect,
  amount,
  time,
  host,
  options = null,
) {
  if (!ctx || !sourceCanvas || !rect || !(amount > 0.0001) || !host) return;
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const animated = !!(options && options.animated);
  const baseSeed = animated ? Number(time || 0) * 0.0027 : 13.25;
  const layerScale = clampNumber(0.52 - amount * 0.12, 0.34, 0.52);
  const layerW = Math.max(24, Math.round(w * layerScale));
  const layerH = Math.max(24, Math.round(h * layerScale));
  const layer = ensureEffectWorkCanvas(
    host,
    "lineDamageCanvas",
    "lineDamageCtx",
    layerW,
    layerH,
  );
  const lctx = layer.ctx;
  const targetBands = Math.max(48, Math.round(70 + amount * 80));
  const stripH = Math.max(1, Math.ceil(layerH / targetBands));
  for (let y = 0; y < layerH; y += stripH) {
    const seed = baseSeed + y * 0.091;
    let shift = (hashNoise1(seed) - 0.5) * amount * 5.2;
    if (hashNoise1(seed * 1.8) > 0.958) {
      shift += (hashNoise1(seed * 3.4) > 0.5 ? 1 : -1) * (1 + amount * 5.5);
    }
    lctx.globalAlpha = clampNumber(0.18 + amount * 0.26, 0, 0.42);
    const srcY = Math.floor((y / layerH) * sourceCanvas.height);
    const srcH = Math.max(
      1,
      Math.ceil((Math.min(stripH, layerH - y) / layerH) * sourceCanvas.height),
    );
    lctx.drawImage(
      sourceCanvas,
      0,
      srcY,
      sourceCanvas.width,
      srcH,
      shift,
      y,
      layerW,
      Math.min(stripH, layerH - y),
    );
    if (hashNoise1(seed * 2.7) > 0.88) {
      const alpha = clampNumber(0.02 + amount * 0.08, 0, 0.14);
      lctx.fillStyle =
        hashNoise1(seed * 4.1) > 0.5
          ? `rgba(255,255,255,${alpha.toFixed(3)})`
          : `rgba(0,0,0,${alpha.toFixed(3)})`;
      lctx.fillRect(0, y, layerW, Math.max(1, Math.round(stripH * 0.5)));
    }
  }
  lctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = clampNumber(0.34 + amount * 0.22, 0, 0.62);
  ctx.drawImage(layer.canvas, rect.x, rect.y, rect.w, rect.h);
  ctx.restore();
}

function drawJitterWarpToCanvas(
  targetCtx,
  sourceCanvas,
  amount,
  time,
  options = null,
) {
  if (!targetCtx || !sourceCanvas || !(amount > 0.0001)) return false;
  const w = Math.max(1, sourceCanvas.width || 0);
  const h = Math.max(1, sourceCanvas.height || 0);
  if (!w || !h) return false;
  const animated = !!(options && options.animated);
  const speed = clampNumber(0.05 + amount * 0.95, 0.05, 1, 0.05);
  const t = animated ? Number(time || 0) * 0.001 * speed : 12.75;
  const amplitude = Math.min(Math.max(0.9, 0.75 * 2.8), Math.max(3, w * 0.04));
  const bandCount = Math.max(18, Math.round(18 + 0.75 * 11));
  const stripH = Math.max(1, Math.ceil(h / bandCount));
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, w, h);
  targetCtx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in targetCtx)
    targetCtx.imageSmoothingQuality = "high";
  targetCtx.filter = "none";
  targetCtx.globalCompositeOperation = "source-over";
  targetCtx.globalAlpha = 1;
  const drawStripWithExtrudedEdges = (
    stripY,
    stripH,
    drawOffset,
    alpha = 1,
  ) => {
    targetCtx.globalAlpha = alpha;
    targetCtx.drawImage(
      sourceCanvas,
      0,
      stripY,
      w,
      stripH,
      drawOffset,
      stripY,
      w,
      stripH,
    );
    targetCtx.globalAlpha = 1;
    if (drawOffset > 0.0001) {
      targetCtx.drawImage(
        sourceCanvas,
        0,
        stripY,
        1,
        stripH,
        0,
        stripY,
        drawOffset,
        stripH,
      );
    } else if (drawOffset < -0.0001) {
      const gapW = -drawOffset;
      targetCtx.drawImage(
        sourceCanvas,
        w - 1,
        stripY,
        1,
        stripH,
        w - gapW,
        stripY,
        gapW,
        stripH,
      );
    }
  };

  for (let y = 0; y < h; y += stripH) {
    const sh = Math.min(stripH, h - y);
    const yNorm = y / Math.max(1, h);
    const phaseA = yNorm * 12.5 + t * 6.3;
    const phaseB =
      yNorm * 31.5 - t * 10.1 + hashNoise1((y + 1) * 0.173) * Math.PI * 2;
    const phaseC =
      yNorm * 8.4 + t * 3.4 + hashNoise1((y + 7) * 0.067) * Math.PI * 2;
    const offset =
      (Math.sin(phaseA) * 0.58 +
        Math.sin(phaseB) * 0.27 +
        Math.sin(phaseC) * 0.15) *
      amplitude;
    drawStripWithExtrudedEdges(y, sh, offset);
    if (animated) {
      const shimmerAlpha = clampNumber(0.018 + 0.75 * 0.018, 0, 0.08);
      if (shimmerAlpha > 0.0001) {
        drawStripWithExtrudedEdges(
          y,
          sh,
          offset + Math.sin(phaseB * 1.7) * (0.35 + 0.75 * 0.3),
          shimmerAlpha,
        );
      }
    }
  }
  targetCtx.globalAlpha = 1;
  targetCtx.filter = "none";
  return true;
}

function drawVhsFuzzToContext(
  ctx,
  sourceCanvas,
  rect,
  amount,
  time,
  host,
  options = null,
) {
  if (!ctx || !sourceCanvas || !rect || !(amount > 0.0001) || !host) return;
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  if (!w || !h) return;
  const animated = !!(options && options.animated);
  const baseSeed = animated ? Number(time || 0) * 0.0014 : 47.35;
  const lowScale = clampNumber(0.58 - amount * 0.22, 0.28, 0.58);
  const lowW = Math.max(8, Math.round(w * lowScale));
  const lowH = Math.max(8, Math.round(h * lowScale));
  const lowLayer = ensureEffectWorkCanvas(
    host,
    "vhsFuzzLowCanvas",
    "vhsFuzzLowCtx",
    lowW,
    lowH,
  );
  const stripLayer = ensureEffectWorkCanvas(
    host,
    "vhsFuzzStripCanvas",
    "vhsFuzzStripCtx",
    w,
    h,
  );
  const fuzzLayer = ensureEffectWorkCanvas(
    host,
    "vhsFuzzCanvas",
    "vhsFuzzCtx",
    lowW,
    lowH,
  );
  const lowCtx = lowLayer.ctx;
  const stripCtx = stripLayer.ctx;
  const fuzzCtx = fuzzLayer.ctx;
  lowCtx.imageSmoothingEnabled = true;
  lowCtx.filter = "none";
  lowCtx.drawImage(sourceCanvas, 0, 0, lowW, lowH);

  stripCtx.imageSmoothingEnabled = true;
  stripCtx.filter = `blur(${(0.25 + amount * 0.45).toFixed(2)}px)`;
  stripCtx.drawImage(lowLayer.canvas, 0, 0, w, h);
  stripCtx.filter = "none";

  const targetBands = Math.max(44, Math.round(56 + amount * 52));
  const stripH = Math.max(2, Math.ceil(h / targetBands));
  for (let y = 0; y < h; y += stripH) {
    const seed = baseSeed + y * 0.071;
    const sy = Math.max(0, Math.floor((y / h) * lowH));
    const sh = Math.max(1, Math.ceil((Math.min(stripH, h - y) / h) * lowH));
    let offset = (hashNoise1(seed) - 0.5) * (0.45 + amount * 2);
    offset +=
      Math.sin(seed * 7.3 + (animated ? time * 0.0012 : 0)) *
      (0.12 + amount * 0.45);
    stripCtx.globalAlpha = clampNumber(0.05 + amount * 0.08, 0, 0.12);
    stripCtx.drawImage(
      lowLayer.canvas,
      0,
      sy,
      lowW,
      sh,
      offset,
      y,
      w,
      Math.min(stripH, h - y),
    );
  }
  stripCtx.globalAlpha = 1;

  fuzzCtx.imageSmoothingEnabled = true;
  fuzzCtx.drawImage(stripLayer.canvas, 0, 0, lowW, lowH);
  fuzzCtx.globalCompositeOperation = "screen";
  fuzzCtx.globalAlpha = clampNumber(0.02 + amount * 0.05, 0, 0.08);
  fuzzCtx.drawImage(stripLayer.canvas, 0.2 + amount * 0.55, 0, lowW, lowH);
  fuzzCtx.globalCompositeOperation = "multiply";
  fuzzCtx.globalAlpha = clampNumber(0.025 + amount * 0.04, 0, 0.07);
  fuzzCtx.drawImage(stripLayer.canvas, -(0.15 + amount * 0.35), 0, lowW, lowH);
  fuzzCtx.globalCompositeOperation = "source-over";
  fuzzCtx.globalAlpha = 1;

  const hazeCount = Math.max(1, Math.round(1 + amount * 2));
  for (let i = 0; i < hazeCount; i++) {
    const seed = baseSeed + 100 + i * 19.37;
    const bandY = Math.floor(hashNoise1(seed) * lowH);
    const bandH = Math.max(
      4,
      Math.round(4 + hashNoise1(seed * 1.4) * (6 + amount * 8)),
    );
    const alpha = clampNumber(
      (0.012 + amount * 0.022) * (0.7 + hashNoise1(seed * 2.1) * 0.6),
      0,
      0.05,
    );
    fuzzCtx.fillStyle =
      hashNoise1(seed * 2.8) > 0.5
        ? `rgba(255,255,255,${alpha.toFixed(3)})`
        : `rgba(0,0,0,${(alpha * 0.9).toFixed(3)})`;
    fuzzCtx.fillRect(0, bandY, lowW, Math.min(bandH, lowH - bandY));
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = clampNumber(0.14 + amount * 0.18, 0, 0.32);
  ctx.filter = `blur(${Math.max(0.2, 0.25 + amount * 0.35).toFixed(2)}px)`;
  ctx.drawImage(fuzzLayer.canvas, rect.x, rect.y, rect.w, rect.h);
  ctx.globalAlpha = clampNumber(0.04 + amount * 0.1, 0, 0.14);
  ctx.filter = `blur(${Math.max(0.25, 0.35 + amount * 0.45).toFixed(2)}px)`;
  ctx.drawImage(lowLayer.canvas, rect.x, rect.y, rect.w, rect.h);
  ctx.filter = "none";
  ctx.restore();
}

function applyPixelOpsToCanvas(canvas, config) {
  if (!canvas || !config) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const width = canvas.width || 0;
  const height = canvas.height || 0;
  if (!width || !height) return;
  const brightness = clampNumber(
    config.brightness,
    OVERLAY_SLIDER_LIMITS.brightness.min,
    OVERLAY_SLIDER_LIMITS.brightness.max,
    0,
  );
  const contrast = clampNumber(
    config.contrast,
    OVERLAY_SLIDER_LIMITS.contrast.min,
    OVERLAY_SLIDER_LIMITS.contrast.max,
    0,
  );
  const saturation = clampNumber(
    config.saturation,
    OVERLAY_SLIDER_LIMITS.saturation.min,
    OVERLAY_SLIDER_LIMITS.saturation.max,
    0,
  );
  const temperature = clampNumber(
    config.temperature,
    OVERLAY_SLIDER_LIMITS.warmth.min,
    OVERLAY_SLIDER_LIMITS.warmth.max,
    0,
  );
  const hueShift = clampNumber(
    config.hueShift,
    OVERLAY_SLIDER_LIMITS.hueShift.min,
    OVERLAY_SLIDER_LIMITS.hueShift.max,
    0,
  );
  const colorCrush = clampNumber(
    config.colorCrush,
    0,
    OVERLAY_SLIDER_LIMITS.colorCrush.max,
    0,
  );
  const blackCrush = clampNumber(
    config.blackCrush,
    0,
    OVERLAY_SLIDER_LIMITS.blackCrush.max,
    0,
  );
  const whiteCrush = clampNumber(
    config.whiteCrush,
    0,
    OVERLAY_SLIDER_LIMITS.whiteCrush.max,
    0,
  );
  if (
    !(
      Math.abs(brightness) > 0.0001 ||
      Math.abs(contrast) > 0.0001 ||
      Math.abs(saturation) > 0.0001 ||
      Math.abs(temperature) > 0.0001 ||
      Math.abs(hueShift) > 0.0001 ||
      colorCrush > 0 ||
      blackCrush > 0 ||
      whiteCrush > 0
    )
  )
    return;
  let imageData = null;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    imageData = null;
  }
  if (!imageData) return;
  const data = imageData.data;
  const crushLevels =
    colorCrush > 0 ? Math.max(2, Math.round(24 - colorCrush * 10)) : 0;
  const blackFloor = blackCrush > 0 ? blackCrush * 255 : 0;
  const whiteCeil = whiteCrush > 0 ? 255 - whiteCrush * 255 : 255;
  const brightnessMul = Math.max(0, 1 + brightness);
  const contrastMul = Math.max(0, 1 + contrast);
  const saturationMul = Math.max(0, 1 + saturation);
  const hueRad = (hueShift * Math.PI) / 180;
  const hueCos = Math.cos(hueRad);
  const hueSin = Math.sin(hueRad);
  const applyHue = Math.abs(hueShift) > 0.0001;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    if (Math.abs(brightness) > 0.0001) {
      r *= brightnessMul;
      g *= brightnessMul;
      b *= brightnessMul;
    }

    if (Math.abs(contrast) > 0.0001) {
      r = (r - 128) * contrastMul + 128;
      g = (g - 128) * contrastMul + 128;
      b = (b - 128) * contrastMul + 128;
    }

    if (Math.abs(saturation) > 0.0001) {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = luma + (r - luma) * saturationMul;
      g = luma + (g - luma) * saturationMul;
      b = luma + (b - luma) * saturationMul;
    }

    if (Math.abs(temperature) > 0.0001) {
      const prevLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const redMul = 1 + temperature * 0.22;
      const greenMul = 1 + temperature * 0.05;
      const blueMul = 1 - temperature * 0.24;
      r *= redMul;
      g *= greenMul;
      b *= blueMul;
      const nextLuma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lumaOffset = prevLuma - nextLuma;
      r += lumaOffset;
      g += lumaOffset;
      b += lumaOffset;
    }

    if (applyHue) {
      const nr =
        (0.213 + hueCos * 0.787 - hueSin * 0.213) * r +
        (0.715 - hueCos * 0.715 - hueSin * 0.715) * g +
        (0.072 - hueCos * 0.072 + hueSin * 0.928) * b;
      const ng =
        (0.213 - hueCos * 0.213 + hueSin * 0.143) * r +
        (0.715 + hueCos * 0.285 + hueSin * 0.14) * g +
        (0.072 - hueCos * 0.072 - hueSin * 0.283) * b;
      const nb =
        (0.213 - hueCos * 0.213 - hueSin * 0.787) * r +
        (0.715 - hueCos * 0.715 + hueSin * 0.715) * g +
        (0.072 + hueCos * 0.928 + hueSin * 0.072) * b;
      r = nr;
      g = ng;
      b = nb;
    }

    if (blackFloor > 0) {
      r =
        r <= blackFloor
          ? 0
          : ((r - blackFloor) / Math.max(1, 255 - blackFloor)) * 255;
      g =
        g <= blackFloor
          ? 0
          : ((g - blackFloor) / Math.max(1, 255 - blackFloor)) * 255;
      b =
        b <= blackFloor
          ? 0
          : ((b - blackFloor) / Math.max(1, 255 - blackFloor)) * 255;
    }
    if (whiteCeil < 255) {
      r = r >= whiteCeil ? 255 : (r / Math.max(1, whiteCeil)) * 255;
      g = g >= whiteCeil ? 255 : (g / Math.max(1, whiteCeil)) * 255;
      b = b >= whiteCeil ? 255 : (b / Math.max(1, whiteCeil)) * 255;
    }

    if (colorCrush > 0 && crushLevels > 1) {
      const snap = 255 / (crushLevels - 1);
      r = Math.round(r / snap) * snap;
      g = Math.round(g / snap) * snap;
      b = Math.round(b / snap) * snap;
    }

    data[i] = clampNumber(r, 0, 255, 0);
    data[i + 1] = clampNumber(g, 0, 255, 0);
    data[i + 2] = clampNumber(b, 0, 255, 0);
  }
  ctx.putImageData(imageData, 0, 0);

}

function applyHeuristicUpscalerToCanvas(canvas, amount) {
  if (!canvas) return false;
  const strength = clampNumber(Number(amount), 0, 1, 0);
  if (!(strength > 0.0001)) return false;
  const width = canvas.width || 0;
  const height = canvas.height || 0;
  if (width < 3 || height < 3) return false;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  let imageData = null;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    return false;
  }
  if (!imageData || !imageData.data) return false;

  const src = imageData.data;
  const out = new Uint8ClampedArray(src);
  const stride = width * 4;
  const normalizedStrength = clampNumber(strength, 0, 1, 0);
  const sharpen = 0.55 + normalizedStrength * 1.45;
  const textureStrength = normalizedStrength * 5.5;
  const contrastLift = normalizedStrength * 0.18;
  const hashByte = (x, y, c) => {
    let h = (x * 374761393 + y * 668265263 + c * 1442695041) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) & 255) / 255 - 0.5;
  };

  for (let y = 1; y < height - 1; y++) {
    const row = y * stride;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x * 4;
      const li = i - 4;
      const ri = i + 4;
      const ui = i - stride;
      const di = i + stride;

      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lumaL = 0.2126 * src[li] + 0.7152 * src[li + 1] + 0.0722 * src[li + 2];
      const lumaR = 0.2126 * src[ri] + 0.7152 * src[ri + 1] + 0.0722 * src[ri + 2];
      const lumaU = 0.2126 * src[ui] + 0.7152 * src[ui + 1] + 0.0722 * src[ui + 2];
      const lumaD = 0.2126 * src[di] + 0.7152 * src[di + 1] + 0.0722 * src[di + 2];
      const localDelta =
        Math.abs(luma - lumaL) +
        Math.abs(luma - lumaR) +
        Math.abs(luma - lumaU) +
        Math.abs(luma - lumaD);
      const edge = clampNumber(localDelta / 180, 0, 1, 0);
      const flatGuard = clampNumber((localDelta - 4) / 72, 0, 1, 0);
      const edgeWeight = 0.2 + edge * 0.8;

      for (let c = 0; c < 3; c++) {
        const center = src[i + c];
        const blur =
          (center * 4 + src[li + c] + src[ri + c] + src[ui + c] + src[di + c]) / 8;
        const high = center - blur;
        const localContrast = (center - 128) * contrastLift * flatGuard;
        const micro = hashByte(x, y, c) * textureStrength * edgeWeight * flatGuard;
        out[i + c] = clampNumber(
          center + high * sharpen * edgeWeight + localContrast + micro,
          0,
          255,
          center,
        );
      }
    }
  }

  imageData.data.set(out);
  ctx.putImageData(imageData, 0, 0);
  return true;
}

function drawChannelIsolatedCanvas(targetCtx, sourceCanvas, tint) {
  if (!targetCtx || !sourceCanvas) return;
  const width = sourceCanvas.width || 0;
  const height = sourceCanvas.height || 0;
  if (!width || !height) return;
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, width, height);
  targetCtx.globalCompositeOperation = "copy";
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height);
  targetCtx.globalCompositeOperation = "multiply";
  targetCtx.fillStyle = tint;
  targetCtx.fillRect(0, 0, width, height);
  targetCtx.globalCompositeOperation = "source-over";
}

function drawChromaticAberrationToContext(
  targetCtx,
  sourceCanvas,
  dx,
  dy,
  dw,
  dh,
  amount,
  buffers = null,
) {
  if (!targetCtx || !sourceCanvas) return false;
  const shift = Number(amount);
  if (!Number.isFinite(shift) || shift <= 0.0001) return false;
  const width = sourceCanvas.width || 0;
  const height = sourceCanvas.height || 0;
  if (!width || !height) return false;
  const compositeCanvas =
    buffers && buffers.compositeCanvas
      ? buffers.compositeCanvas
      : document.createElement("canvas");
  const channelCanvas =
    buffers && buffers.channelCanvas
      ? buffers.channelCanvas
      : document.createElement("canvas");
  resizeCanvasBuffer(compositeCanvas, width, height);
  resizeCanvasBuffer(channelCanvas, width, height);
  const compositeCtx =
    buffers && buffers.compositeCtx
      ? buffers.compositeCtx
      : compositeCanvas.getContext("2d");
  const channelCtx =
    buffers && buffers.channelCtx
      ? buffers.channelCtx
      : channelCanvas.getContext("2d");
  if (!compositeCtx || !channelCtx) return false;
  const xShift = shift;
  const yShift = shift * 0.18;

  compositeCtx.setTransform(1, 0, 0, 1, 0, 0);
  compositeCtx.clearRect(0, 0, width, height);

  drawChannelIsolatedCanvas(channelCtx, sourceCanvas, "rgb(255, 0, 0)");
  compositeCtx.globalCompositeOperation = "copy";
  compositeCtx.drawImage(channelCanvas, -xShift, -yShift, width, height);

  drawChannelIsolatedCanvas(channelCtx, sourceCanvas, "rgb(0, 255, 0)");
  compositeCtx.globalCompositeOperation = "lighter";
  compositeCtx.drawImage(channelCanvas, 0, 0, width, height);

  drawChannelIsolatedCanvas(channelCtx, sourceCanvas, "rgb(0, 0, 255)");
  compositeCtx.drawImage(channelCanvas, xShift, yShift, width, height);

  compositeCtx.globalCompositeOperation = "destination-in";
  compositeCtx.drawImage(sourceCanvas, 0, 0, width, height);
  compositeCtx.globalCompositeOperation = "source-over";

  targetCtx.drawImage(compositeCanvas, dx, dy, dw, dh);
  return true;
}

function crtOverlayEnabled(target = undefined) {
  if (typeof target !== "undefined")
    return !!resolveMediaOverlayConfigForTarget(target);
  return anyMediaFilterEnabled();
}

const THUMB_FILTER_CACHE = {
  noiseCanvas: null,
  noiseCtx: null,
  scanCanvas: null,
  scanPattern: null,
  halationExtractCanvas: null,
  halationExtractCtx: null,
  vhsFuzzCanvas: null,
  vhsFuzzCtx: null,
  vhsFuzzStripCanvas: null,
  vhsFuzzStripCtx: null,
  vhsFuzzLowCanvas: null,
  vhsFuzzLowCtx: null,
  lastNoise: 0,
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
    c.width = 1;
    c.height = 2;
    const sctx = c.getContext("2d");
    sctx.clearRect(0, 0, 1, 2);
    sctx.fillStyle = "rgba(0,0,0,0.82)";
    sctx.fillRect(0, 0, 1, 1);
    THUMB_FILTER_CACHE.scanCanvas = c;
    THUMB_FILTER_CACHE.scanPattern = null;
  }
  if (
    !THUMB_FILTER_CACHE.scanPattern ||
    THUMB_FILTER_CACHE.scanPattern._ctx !== ctx
  ) {
    const pattern = ctx.createPattern(THUMB_FILTER_CACHE.scanCanvas, "repeat");
    if (pattern) pattern._ctx = ctx;
    THUMB_FILTER_CACHE.scanPattern = pattern;
  }
  return THUMB_FILTER_CACHE.scanPattern;
}

function renderFilteredToCanvas(
  ctx,
  source,
  srcW,
  srcH,
  dstW,
  dstH,
  mode,
  cover = true,
  target = undefined,
  options = null,
) {
  const forceOverlayConfig =
    options && Object.prototype.hasOwnProperty.call(options, "overlayConfig")
      ? options.overlayConfig
      : undefined;
  const allowFilters =
    typeof forceOverlayConfig !== "undefined"
      ? true
      : thumbFiltersActive(target);
  const overlayCfg =
    typeof forceOverlayConfig !== "undefined"
      ? forceOverlayConfig
      : allowFilters
        ? resolveMediaOverlayConfigForTarget(target)
        : null;
  const sourceCrop = { sx: 0, sy: 0, sw: srcW, sh: srcH };
  const croppedSrcW = Math.max(1, Number(sourceCrop.sw || srcW || 1));
  const croppedSrcH = Math.max(1, Number(sourceCrop.sh || srcH || 1));
  const drawCropped = (targetCtx, dx, dy, dw, dh) => {
    if (sourceCrop.sw > 0 && sourceCrop.sh > 0) {
      targetCtx.drawImage(
        source,
        sourceCrop.sx,
        sourceCrop.sy,
        sourceCrop.sw,
        sourceCrop.sh,
        dx,
        dy,
        dw,
        dh,
      );
      return;
    }
    targetCtx.drawImage(source, dx, dy, dw, dh);
  };
  if (!overlayCfg) {
    const rect = cover
      ? computeCoverRect(croppedSrcW, croppedSrcH, dstW, dstH)
      : computeContainRect(croppedSrcW, croppedSrcH, dstW, dstH);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dstW, dstH);
    ctx.filter = "none";
    ctx.imageSmoothingEnabled = true;
    drawCropped(ctx, rect.x, rect.y, rect.w, rect.h);
    return;
  }
  const rect = cover
    ? computeCoverRect(croppedSrcW, croppedSrcH, dstW, dstH)
    : computeContainRect(croppedSrcW, croppedSrcH, dstW, dstH);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, dstW, dstH);

  const work = document.createElement("canvas");
  const scratch = document.createElement("canvas");
  const off = document.createElement("canvas");
  resizeCanvasBuffer(work, rect.w, rect.h);
  resizeCanvasBuffer(scratch, rect.w, rect.h);
  const workctx = work.getContext("2d");
  const scratchctx = scratch.getContext("2d", { willReadFrequently: true });
  const fitRect = cover
    ? computeCoverRect(croppedSrcW, croppedSrcH, work.width, work.height)
    : computeContainRect(croppedSrcW, croppedSrcH, work.width, work.height);
  workctx.setTransform(1, 0, 0, 1, 0, 0);
  workctx.clearRect(0, 0, work.width, work.height);
  configureCanvasUpscaleSmoothing(workctx, overlayCfg, 1);
  workctx.filter = "none";
  drawCropped(workctx, fitRect.x, fitRect.y, fitRect.w, fitRect.h);

  let currentCanvas = work;
  let currentCtx = workctx;
  let scratchCanvas = scratch;
  let scratchCtx = scratchctx;
  const swapBuffers = () => {
    const oldCanvas = currentCanvas;
    const oldCtx = currentCtx;
    currentCanvas = scratchCanvas;
    currentCtx = scratchCtx;
    scratchCanvas = oldCanvas;
    scratchCtx = oldCtx;
  };
  applyPixelOpsToCanvas(currentCanvas, overlayCfg);
  if (overlayCfg.pixelate > 0) {
    const scale = Math.max(1, overlayCfg.pixelate);
    resizeCanvasBuffer(
      off,
      Math.max(1, Math.round(currentCanvas.width / scale)),
      Math.max(1, Math.round(currentCanvas.height / scale)),
    );
    const offctx = off.getContext("2d");
    offctx.setTransform(1, 0, 0, 1, 0, 0);
    offctx.clearRect(0, 0, off.width, off.height);
    offctx.imageSmoothingEnabled = true;
    offctx.filter = "none";
    offctx.drawImage(currentCanvas, 0, 0, off.width, off.height);
    resizeCanvasBuffer(
      scratchCanvas,
      currentCanvas.width,
      currentCanvas.height,
    );
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, scratchCanvas.width, scratchCanvas.height);
    configureCanvasUpscaleSmoothing(scratchCtx, overlayCfg, 0);
    scratchCtx.filter = "none";
    scratchCtx.drawImage(off, 0, 0, scratchCanvas.width, scratchCanvas.height);
    swapBuffers();
  }
  if (overlayCfg.blur > 0) {
    const offctx = off.getContext("2d");
    if (drawBlurredCanvasToScratch(
      currentCanvas,
      scratchCanvas,
      scratchCtx,
      off,
      offctx,
      overlayCfg.blur,
      overlayCfg,
    )) {
      swapBuffers();
    }
  }
  if (overlayCfg.upscaler > 0) {
    applyHeuristicUpscalerToCanvas(currentCanvas, overlayCfg.upscaler);
  }
  const outputRect = rect;
  configureCanvasUpscaleSmoothing(ctx, overlayCfg, 1);
  ctx.filter = "none";
  if (
    !drawChromaticAberrationToContext(
      ctx,
      currentCanvas,
      outputRect.x,
      outputRect.y,
      outputRect.w,
      outputRect.h,
      overlayCfg.chroma,
    )
  ) {
    ctx.drawImage(
      currentCanvas,
      outputRect.x,
      outputRect.y,
      outputRect.w,
      outputRect.h,
    );
  }

  if (overlayCfg.halation) {
    drawHalationToContext(
      ctx,
      currentCanvas,
      outputRect,
      overlayCfg.halation,
      THUMB_FILTER_CACHE,
    );
  }

  if (overlayCfg.ghosting) {
    drawTemporalGhostingToContext(
      ctx,
      currentCanvas,
      outputRect,
      overlayCfg.ghosting,
      0,
      THUMB_FILTER_CACHE,
      { animated: false },
    );
  }

  if (overlayCfg.lineDamage) {
    drawLineDamageToContext(
      ctx,
      currentCanvas,
      outputRect,
      overlayCfg.lineDamage,
      0,
      THUMB_FILTER_CACHE,
      { animated: false },
    );
  }

  if (overlayCfg.grain) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(outputRect.x, outputRect.y, outputRect.w, outputRect.h);
    ctx.clip();
    if (!THUMB_FILTER_CACHE.lastNoise) updateThumbNoiseCanvas();
    const noiseCanvas = ensureThumbNoiseCanvas();
    const pattern = ctx.createPattern(noiseCanvas, "repeat");
    if (pattern) {
      ctx.globalAlpha = overlayCfg.grain;
      ctx.globalCompositeOperation = "overlay";
      ctx.fillStyle = pattern;
      ctx.fillRect(outputRect.x, outputRect.y, outputRect.w, outputRect.h);
    }
    ctx.restore();
  }

  if (overlayCfg.vignette) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(outputRect.x, outputRect.y, outputRect.w, outputRect.h);
    ctx.clip();
    const cx = outputRect.x + outputRect.w * 0.5;
    const cy = outputRect.y + outputRect.h * 0.5;
    const g = ctx.createRadialGradient(
      cx,
      cy,
      Math.min(outputRect.w, outputRect.h) * 0.2,
      cx,
      cy,
      Math.max(outputRect.w, outputRect.h) * 0.7,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${overlayCfg.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(outputRect.x, outputRect.y, outputRect.w, outputRect.h);
    ctx.restore();
  }

  if (overlayCfg.cornerRadius) {
    const radius = Math.max(
      0,
      Math.min(outputRect.w, outputRect.h) * overlayCfg.cornerRadius,
    );
    applyRoundedCornerMask(ctx, outputRect, radius);
  }
}
