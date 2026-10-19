/* Filters
   Sorting for display, the score filters and passesFilter.
   (normalizeMinScoreFilterValue is in core/options.js.) */

function recordPassesTagMediaFilter(rec, filterValue) {
  if (!rec) return false;
  const hiddenTypes = normalizeTagMediaFilterValue(filterValue);
  if (!hiddenTypes.length) return true;
  const recordType = recordMediaFilterType(rec);
  if (recordType && hiddenTypes.includes(recordType)) return false;
  return true;
}

function effectiveFilterCacheKey() {
  const aspectMode = normalizeAspectRatioFilterMode(
    WS.view && WS.view.aspectRatioFilterMode,
  );
  return `global:${String(WS?.view?.filterMode || "all")}|aspect:${aspectMode}`;
}

function reseedRandomSortMode() {
  const workspaceSeed = computeWorkspaceSeed();
  const timeSeed = Date.now() >>> 0;
  const randSeed = Math.floor(Math.random() * 0xffffffff) >>> 0;
  WS.view.randomSeed = (workspaceSeed ^ timeSeed ^ randSeed) >>> 0;
  if (!WS.view.randomSeed) WS.view.randomSeed = (workspaceSeed || 1) >>> 0;
  WS.view.randomFolderCache = new Map();
}

function getRandomOrderForDirs(dirs) {
  const list = Array.isArray(dirs) ? dirs.slice() : [];
  const kind = randomOrderActiveForDirs(list);
  if (!kind) return list;
  const parentPath = String(list.find(Boolean)?.parent?.path || "");
  return stableRandomOrder(kind, `dir:${parentPath}`, list, randomOrderDirPath);
}

function sortDirsByMode(dirs, requestedMode) {
  const out = Array.isArray(dirs) ? dirs.slice() : [];
  const sortMode = normalizeDirSortMode(requestedMode);
  if (sortMode === "score") {
    out.sort((a, b) => {
      const sa = metaGetScore(a?.path || "");
      const sb = metaGetScore(b?.path || "");
      if (sa !== sb) return sb - sa;
      return byName(a, b);
    });
    return out;
  }

  if (
    sortMode === "efficiency" ||
    sortMode === "size-desc" ||
    sortMode === "count-recursive"
  ) {
    const metrics = buildDirSortMetrics();
    out.sort((a, b) => {
      const pathA = String(a?.path || "");
      const pathB = String(b?.path || "");

      let va = 0;
      let vb = 0;
      if (sortMode === "efficiency") {
        va = metrics.efficiencyByPath.get(pathA) || 0;
        vb = metrics.efficiencyByPath.get(pathB) || 0;
      } else if (sortMode === "size-desc") {
        va = metrics.sizeByPath.get(pathA) || 0;
        vb = metrics.sizeByPath.get(pathB) || 0;
      } else {
        va = metrics.recursiveCountByPath.get(pathA) || 0;
        vb = metrics.recursiveCountByPath.get(pathB) || 0;
      }

      if (va !== vb) return vb - va;
      if (sortMode === "efficiency") {
        const sizeA = metrics.sizeByPath.get(pathA) || 0;
        const sizeB = metrics.sizeByPath.get(pathB) || 0;
        if (sizeA !== sizeB) return sizeA - sizeB;
      }
      return byName(a, b);
    });
    return out;
  }

  out.sort(byName);
  return out;
}

function sortDirsForDisplay(dirs) {
  const out = Array.isArray(dirs) ? dirs.slice() : [];
  const parentNode = out.length ? out[0]?.parent || null : null;
  const containerSortMode = effectiveContainerSortModeForDir(parentNode);
  // Randomize model order shuffles the root's list (the Models), Randomize
  // set order every Model's list (its Sets); anything else keeps the sort.
  if (!containerSortMode && out.length && randomOrderActiveForDirs(out))
    return getRandomOrderForDirs(out);
  return sortDirsByMode(
    out,
    containerSortMode || normalizeDirSortMode(WS.meta.dirSortMode),
  );
}

function sortDirCollectionForDisplay(dirs, key = "collection") {
  const out = Array.isArray(dirs) ? dirs.slice() : [];
  const randomKind = randomOrderActiveForDirs(out);
  if (randomKind)
    return stableRandomOrder(randomKind, `collection:${String(key || "collection")}`, out, randomOrderDirPath);
  return sortDirsByMode(out, normalizeDirSortMode(WS.meta.dirSortMode));
}

/* Basics -> "Set score is at least" and "Model score is at least". Each is Off
   (null) or a whole number, and each acts on its own kind of folder only:

   - A Set passes on its own score. Its files pass with it, wherever they are
     seen (a Tag, All Sets, a random jump).
   - A Model passes on its own score. A Model whose Sets all fail the Set
     filter is hidden too, since it would be an empty folder.

   The root always shows; the Trash and Storage are never filtered.

   Containers can override either (`scoreFilterOverrides`, keyed `dir:<path>`
   or `tag:<name>`, saved in tags.log.json): a Model's Overrides hold "Set score
   is at least" for its own Sets, a Tag's hold both for whatever it shows. An
   override is a number or "off"; no entry means the container follows Basics.
   What applies to a folder is, first found wins: the Tag it is being looked
   at through (innermost first), then -- for a Set -- its Model, then Basics.

   `var`, not `let`: these are read from functions that can run before this
   line is reached. */
var SCORE_FILTER_REVISION = 0;
var SCORE_FILTER_MEMO = null;

const SCORE_FILTER_KINDS = Object.freeze(["set", "model"]);

// An override value: undefined (none), "off", or a whole number.
function normalizeScoreFilterOverrideValue(raw) {
  if (raw === "off") return "off";
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) ? n : undefined;
}

function globalMinScoreFilterValue(kind) {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  if (!opt) return null;
  return normalizeMinScoreFilterValue(
    kind === "model" ? opt.minModelScoreFilter : opt.minSetScoreFilter,
  );
}

function bumpScoreFilterRevision() {
  SCORE_FILTER_REVISION++;
  SCORE_FILTER_MEMO = null;
  refreshCertifiedFreshAfterScoreChange();
}

function scoreFilterOverrideMap() {
  if (!WS.meta) return null;
  if (!(WS.meta.scoreFilterOverrides instanceof Map))
    WS.meta.scoreFilterOverrides = new Map();
  return WS.meta.scoreFilterOverrides;
}

function metaGetScoreFilterOverride(key, kind) {
  const map = scoreFilterOverrideMap();
  const entry = map ? map.get(String(key || "")) : null;
  return entry ? normalizeScoreFilterOverrideValue(entry[kind]) : undefined;
}

function metaSetScoreFilterOverride(key, kind, value) {
  const map = scoreFilterOverrideMap();
  const k = String(key || "");
  if (!map || !k || !SCORE_FILTER_KINDS.includes(kind)) return false;
  const next = normalizeScoreFilterOverrideValue(value);
  if (metaGetScoreFilterOverride(k, kind) === next) return false;
  const entry = { ...(map.get(k) || {}) };
  if (next === undefined) delete entry[kind];
  else entry[kind] = next;
  if (Object.keys(entry).length) map.set(k, entry);
  else map.delete(k);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  bumpScoreFilterRevision();
  invalidateDirMetricsCaches();
  return true;
}

// Which kinds any override anywhere sets, so the common case (none) never has
// to work out what a folder is being looked at through.
function scoreFilterOverrideKindsInUse() {
  const memo = scoreFilterMemo();
  if (memo.kindsInUse) return memo.kindsInUse;
  const used = { set: { dir: false, tag: false }, model: { dir: false, tag: false } };
  const map = scoreFilterOverrideMap();
  if (map) {
    for (const [key, entry] of map.entries()) {
      const where = key.startsWith("tag:") ? "tag" : "dir";
      for (const kind of SCORE_FILTER_KINDS) {
        if (normalizeScoreFilterOverrideValue(entry && entry[kind]) !== undefined)
          used[kind][where] = true;
      }
    }
  }
  memo.kindsInUse = used;
  return used;
}

function scoreFilterContextSignature() {
  const view = WS.view || {};
  const stack = Array.isArray(view.tagNavStack) ? view.tagNavStack : [];
  const previewDir = WS.preview && WS.preview.dirNode;
  return [
    String(view.tagFolderActiveMode || ""),
    String(view.tagFolderActiveTag || ""),
    stack.map((frame) => (frame && frame.type === "tag-view" ? `${frame.mode}:${frame.tag}` : "")).join(","),
    previewDir && previewDir._skipTagFilters ? String(previewDir._tagPreviewTag || "") : "",
  ].join("|");
}

function scoreFilterMemo() {
  const key = `${SCORE_FILTER_REVISION}|${NAV_ENTRY_RESTORE_REVISION}|${scoreFilterContextSignature()}`;
  if (!SCORE_FILTER_MEMO || SCORE_FILTER_MEMO.key !== key)
    SCORE_FILTER_MEMO = { key, values: new Map(), kindsInUse: null };
  return SCORE_FILTER_MEMO;
}

// The Tags a folder is being looked at through, innermost first: a Tag being
// previewed, the open Tag, then Tag views further back that still hold it.
function scoreFilterContextTagsForDirPath(dirPath) {
  const path = normalizeDirPathValue(dirPath);
  const out = [];
  const add = (tag) => {
    if (tag && !out.includes(tag)) out.push(tag);
  };
  const view = WS.view || {};
  const previewDir = WS.preview && WS.preview.dirNode;
  if (
    previewDir &&
    previewDir._skipTagFilters &&
    String(previewDir._tagPreviewMode || "") === "tag"
  ) {
    const tag = normalizeTag(previewDir._tagPreviewTag || "");
    if (tag && tagHoldsFolderPath(tag, path)) add(tag);
  }
  if (String(view.tagFolderActiveMode || "") === "tag") {
    const tag = normalizeTag(view.tagFolderActiveTag || "");
    if (tag && tagHoldsFolderPath(tag, path)) add(tag);
  }
  const stack = Array.isArray(view.tagNavStack) ? view.tagNavStack : [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (!frame || frame.type !== "tag-view" || String(frame.mode || "") !== "tag")
      continue;
    const tag = normalizeTag(frame.tag || "");
    if (tag && findMatchingVirtualPortalRootPath(frame, path)) add(tag);
  }
  return out;
}

// "model", "set" or "" for a path, read off the library's fixed shape. A path
// deeper than a Set belongs to the Set it is in.
function scoreFilterShapePaths(dirPath) {
  const path = normalizeDirPathValue(dirPath);
  if (!path || isPathInsideInternalTrash(path)) return null;
  const parts = path.split("/");
  return {
    kind: parts.length === 1 ? "model" : "set",
    model: parts[0],
    set: parts.length > 1 ? `${parts[0]}/${parts[1]}` : "",
  };
}

/* The threshold that applies to one folder of the given kind, or null for
   none. `askingTag` is a Tag asking on its own card's behalf (its pool), which
   is looked at before the Tags on screen. */
function effectiveMinScoreFor(kind, dirPath, askingTag = "") {
  const path = normalizeDirPathValue(dirPath);
  const inUse = scoreFilterOverrideKindsInUse()[kind];
  const global = globalMinScoreFilterValue(kind);
  if (!inUse.tag && !inUse.dir) return global;
  const memo = scoreFilterMemo();
  const memoKey = `${kind}|${path}|${askingTag}`;
  if (memo.values.has(memoKey)) return memo.values.get(memoKey);
  let result;
  if (inUse.tag) {
    const tags = askingTag ? [askingTag] : [];
    for (const tag of scoreFilterContextTagsForDirPath(path)) {
      if (!tags.includes(tag)) tags.push(tag);
    }
    for (const tag of tags) {
      const value = metaGetScoreFilterOverride(`tag:${tag}`, kind);
      if (value !== undefined) {
        result = value;
        break;
      }
    }
  }
  if (result === undefined && inUse.dir && kind === "set") {
    const shape = scoreFilterShapePaths(path);
    if (shape) result = metaGetScoreFilterOverride(`dir:${shape.model}`, "set");
  }
  const out =
    result === undefined ? global : normalizeMinScoreFilterValue(result);
  memo.values.set(memoKey, out);
  return out;
}

function scoreFilterMayApply() {
  if (globalMinScoreFilterValue("set") != null) return true;
  if (globalMinScoreFilterValue("model") != null) return true;
  const inUse = scoreFilterOverrideKindsInUse();
  return inUse.set.dir || inUse.set.tag || inUse.model.dir || inUse.model.tag;
}

function setPassesScoreFilter(setPath, askingTag = "") {
  const min = effectiveMinScoreFor("set", setPath, askingTag);
  return min == null || metaGetScore(setPath) >= min;
}

function dirPassesScoreFilter(dirNode, askingTag = "") {
  if (!dirNode) return true;
  if (isInternalTrashDirNode(dirNode) || isStorageStubDirNode(dirNode)) return true;
  const shape = scoreFilterShapePaths(dirNode.path || "");
  if (!shape) return true;
  if (shape.kind === "set") return setPassesScoreFilter(shape.set, askingTag);
  const min = effectiveMinScoreFor("model", shape.model, askingTag);
  if (min != null && metaGetScore(shape.model) < min) return false;
  // A Model whose every Set is filtered away would be an empty folder.
  const sets = (dirNode.childrenDirs || []).filter(
    (child) => child && !child.isMissingPlaceholder && !isStorageStubDirNode(child),
  );
  if (!sets.length) return true;
  return sets.some((child) =>
    setPassesScoreFilter(normalizeDirPathValue(child.path || ""), askingTag),
  );
}

function recordPassesScoreFilter(rec, allowTags = null) {
  if (!rec) return true;
  const shape = scoreFilterShapePaths(rec.dirPath || "");
  if (!shape || shape.kind !== "set") return true;
  const inUse = scoreFilterOverrideKindsInUse().set;
  if (globalMinScoreFilterValue("set") == null && !inUse.dir && !inUse.tag)
    return true;
  const askingTag =
    allowTags && allowTags.size ? String(allowTags.values().next().value || "") : "";
  return setPassesScoreFilter(shape.set, askingTag);
}

// A cycle runs from one above the lowest score of its kind of folder to the
// highest, then back to Off. Only Sets that hold media count for the Set
// cycle, so its top can never leave every visible Set empty.
function scoreFilterCycleValues(kind = "set") {
  let lo = Infinity;
  let hi = -Infinity;
  for (const node of WS.dirByPath.values()) {
    if (!node || isInternalTrashDirNode(node)) continue;
    const shape = scoreFilterShapePaths(node.path || "");
    if (!shape) continue;
    const path = normalizeDirPathValue(node.path || "");
    if (kind === "model") {
      if (shape.kind !== "model") continue;
    } else {
      if (shape.kind !== "set" || path !== shape.set) continue;
      const holdsMedia =
        (Number(node.directFileCount) || 0) > 0 ||
        (Array.isArray(node.childrenFiles) && node.childrenFiles.length > 0);
      if (!holdsMedia) continue;
    }
    const score = metaGetScore(path);
    if (score < lo) lo = score;
    if (score > hi) hi = score;
  }
  if (!Number.isFinite(lo) || hi <= lo) return [];
  const out = [];
  for (let v = lo + 1; v <= hi; v++) out.push(v);
  return out;
}

// The options an Overrides cycler steps through: None (follow Basics), Off,
// then the same numbers the Basics cycle offers.
// A stored number the library's scores have since moved past is kept in the
// list, so the row still names it.
function scoreFilterOverrideCycleOptions(kind, current = undefined) {
  const values = scoreFilterCycleValues(kind);
  if (Number.isInteger(current) && !values.includes(current)) {
    values.push(current);
    values.sort((a, b) => a - b);
  }
  return [
    { value: "", label: "None" },
    { value: "off", label: "Off" },
    ...values.map((v) => ({ value: String(v), label: String(v) })),
  ];
}

function scoreFilterOverrideLabel(kind) {
  return kind === "model" ? "Model score is at least" : "Set score is at least";
}

// One cycler over one or several containers (a bulk selection reads "Mixed"
// until a press sets them all alike).
function scoreFilterOverrideCycleButton(keys, kind, scopeLabel) {
  const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
  if (!list.length) return null;
  const values = list.map((key) => metaGetScoreFilterOverride(key, kind));
  const mixed = !values.every((value) => value === values[0]);
  const current = mixed ? undefined : values[0];
  const options = scoreFilterOverrideCycleOptions(kind, current);
  const currentValue = current === undefined ? "" : String(current);
  const label = scoreFilterOverrideLabel(kind);
  return createCyclingItemMenuButton(
    label,
    options,
    currentValue,
    (value) => {
      let changed = false;
      for (const key of list) {
        if (metaSetScoreFilterOverride(key, kind, value)) changed = true;
      }
      if (!changed) return;
      metaScheduleSave();
      applyViewModesEverywhere(true);
      const shown = options.find((option) => option.value === String(value || ""));
      showStatusMessage(
        `${scopeLabel} ${label.charAt(0).toLowerCase()}${label.slice(1)}: ${shown ? shown.label : "None"}.`,
      );
    },
    mixed,
  );
}

// A Model's Overrides hold the Set filter for its own Sets. Anything else (a
// Set, the root, the Trash) has none.
function scoreFilterOverrideButtonsForFolders(paths) {
  const list = (Array.isArray(paths) ? paths : [])
    .map((path) => normalizeDirPathValue(path))
    .filter(Boolean);
  if (!list.length) return [];
  const allModels = list.every((path) => {
    const shape = scoreFilterShapePaths(path);
    return shape && shape.kind === "model" && !metaHasStorage(path);
  });
  if (!allModels) return [];
  return [
    scoreFilterOverrideCycleButton(
      list.map((path) => `dir:${path}`),
      "set",
      list.length === 1 ? "Model" : "Models",
    ),
  ].filter(Boolean);
}

// A Tag can hold Models or Sets, so its Overrides hold both filters.
function scoreFilterOverrideButtonsForTags(names) {
  const list = normalizeTagList(names).filter(
    (name) => name && !isInternalTagName(name),
  );
  if (!list.length) return [];
  const keys = list.map((name) => `tag:${name}`);
  const scope = list.length === 1 ? "Tag" : "Tags";
  return [
    scoreFilterOverrideCycleButton(keys, "set", scope),
    scoreFilterOverrideCycleButton(keys, "model", scope),
  ].filter(Boolean);
}

function passesFilter(rec, allowTags = null) {
  if (!rec) return false;
  if (fileRecordIsInactiveAltSource(rec)) return false;
  if (!recordPassesScoreFilter(rec, allowTags)) return false;
  const m = WS.view && WS.view.filterMode;
  let mediaPass = true;
  if (m === "images") mediaPass = rec.type === "image";
  else if (m === "videos") mediaPass = rec.type === "video";
  else if (m === "text") mediaPass = rec.type === "markdown";
  if (!mediaPass) return false;
  if (!recordPassesAspectRatioFilter(rec)) return false;
  return !recordIsHeldByExclusiveFileTag(rec, allowTags);
}

function catalogAspectFilteredCount(counts, aspect) {
  if (!counts || typeof counts !== "object") return 0;
  const wanted = Math.max(0, Number(counts[aspect]) || 0);
  const unknown = Math.max(0, Number(counts.unknown) || 0);
  // Record-level filtering deliberately keeps unknown aspect-ratio files visible
  // until they are measured. Folder/catalog summaries must obey the same rule,
  // otherwise folders can falsely collapse to "empty" under an aspect filter.
  return wanted + unknown;
}

function catalogSummaryFileCountForFilter(summary, filterMode = "all", aspectMode = "all") {
  if (!summary) return -1;
  const mode = String(filterMode || "all");
  const aspect = normalizeAspectRatioFilterMode(aspectMode);
  if (aspect !== "all") {
    if (mode === "images" || mode === "videos" || mode === "text") {
      const mediaAspect =
        summary.recursiveMediaAspectCounts &&
        typeof summary.recursiveMediaAspectCounts === "object"
          ? summary.recursiveMediaAspectCounts[mode]
          : null;
      return catalogAspectFilteredCount(mediaAspect, aspect);
    }
    const aspectCounts =
      summary.recursiveAspectCounts && typeof summary.recursiveAspectCounts === "object"
        ? summary.recursiveAspectCounts
        : null;
    return catalogAspectFilteredCount(aspectCounts, aspect);
  }
  if (mode === "images")
    return catalogSummaryMediaBucketCountForTagFilter(summary, "images");
  if (mode === "videos")
    return catalogSummaryMediaBucketCountForTagFilter(summary, "videos");
  if (mode === "text")
    return catalogSummaryMediaBucketCountForTagFilter(summary, "text");
  return Math.max(0, Number(summary.recursiveFileCount) || 0);
}

function catalogSummaryFileCountForCurrentFilters(summary) {
  if (!summary) return -1;
  return catalogSummaryFileCountForFilter(
    summary,
    WS.view && WS.view.filterMode,
    WS.view && WS.view.aspectRatioFilterMode,
  );
}

function catalogSummaryFileCountForTagMediaFilter(summary, filterValue) {
  if (!summary) return -1;
  const hidden = normalizeTagMediaFilterValue(filterValue);
  if (!hidden.length) return catalogSummaryFileCountForFilter(summary, "all", "all");
  const hiddenAspectBuckets = hidden.filter(
    (value) => value === "portrait" || value === "square" || value === "landscape",
  );
  const allowedAspects = ["portrait", "square", "landscape"].filter(
    (bucket) => !hiddenAspectBuckets.includes(bucket),
  );
  const visibleBuckets = ["images", "videos", "text"].filter(
    (bucket) => !hidden.includes(bucket),
  );
  if (!visibleBuckets.length) return 0;
  let total = 0;
  const mediaAspectCounts =
    summary.recursiveMediaAspectCounts &&
    typeof summary.recursiveMediaAspectCounts === "object"
      ? summary.recursiveMediaAspectCounts
      : null;
  if (hiddenAspectBuckets.length && !mediaAspectCounts) {
    const hasMediaTypeFilter = hidden.some(
      (value) => value === "images" || value === "videos" || value === "text",
    );
    const aspectCounts =
      summary.recursiveAspectCounts && typeof summary.recursiveAspectCounts === "object"
        ? summary.recursiveAspectCounts
        : null;
    if (!hasMediaTypeFilter && aspectCounts) {
      if (!allowedAspects.length) {
        return Math.max(0, Number(aspectCounts.unknown) || 0);
      }
      return catalogAspectFilteredCountForAllowedBuckets(aspectCounts, allowedAspects);
    }
    return -1;
  }
  if (!allowedAspects.length) {
    if (!mediaAspectCounts) return 0;
    for (let i = 0; i < visibleBuckets.length; i++) {
      const counts = mediaAspectCounts[visibleBuckets[i]];
      total += Math.max(0, Number(counts && counts.unknown) || 0);
    }
    return total;
  }
  for (let i = 0; i < visibleBuckets.length; i++) {
    total += catalogSummaryMediaBucketCountForTagFilter(
      summary,
      visibleBuckets[i],
      allowedAspects,
    );
  }
  return total;
}

function catalogAspectFilteredCountForAllowedBuckets(counts, allowedAspects) {
  if (!counts || typeof counts !== "object") return 0;
  const allowed = Array.isArray(allowedAspects) && allowedAspects.length
    ? allowedAspects
    : ["portrait", "square", "landscape"];
  let count = Math.max(0, Number(counts.unknown) || 0);
  for (let i = 0; i < allowed.length; i++) {
    count += Math.max(0, Number(counts[allowed[i]]) || 0);
  }
  return count;
}

function catalogAspectCountsTotal(counts) {
  if (!counts || typeof counts !== "object") return 0;
  return ["portrait", "square", "landscape", "unknown"].reduce(
    (total, key) => total + Math.max(0, Number(counts[key]) || 0),
    0,
  );
}

function catalogSummaryMediaBucketCountForTagFilter(summary, mediaBucket, allowedAspects = null) {
  if (!summary) return 0;
  const bucket = normalizeMediaTypeStorageType(mediaBucket);
  if (!bucket) return 0;
  if (
    bucket === "text" &&
    Object.prototype.hasOwnProperty.call(summary, "recursiveTextCount") &&
    !(Array.isArray(allowedAspects) && allowedAspects.length)
  ) {
    return Math.max(0, Number(summary.recursiveTextCount) || 0);
  }
  if (
    bucket === "text" &&
    !Object.prototype.hasOwnProperty.call(summary, "recursiveTextCount")
  ) {
    // Catalog schema 1 counted Markdown inside recursiveImageCount, but its
    // media-aspect buckets still separated real images and videos. Derive the
    // missing text total so existing catalogs gain Text filtering without a
    // costly full workspace reindex.
    const mediaCounts = summary.recursiveMediaAspectCounts || {};
    const imageCount = catalogAspectCountsTotal(mediaCounts.images);
    const videoCount = catalogAspectCountsTotal(mediaCounts.videos);
    return Math.max(
      0,
      Math.max(0, Number(summary.recursiveFileCount) || 0) -
        imageCount -
        videoCount,
    );
  }
  const mediaAspectCounts =
    summary.recursiveMediaAspectCounts &&
    typeof summary.recursiveMediaAspectCounts === "object"
      ? summary.recursiveMediaAspectCounts[bucket]
      : null;
  if (mediaAspectCounts && typeof mediaAspectCounts === "object") {
    const allowed = Array.isArray(allowedAspects) && allowedAspects.length
      ? allowedAspects
      : ["portrait", "square", "landscape"];
    let count = Math.max(0, Number(mediaAspectCounts.unknown) || 0);
    for (let i = 0; i < allowed.length; i++) {
      count += Math.max(0, Number(mediaAspectCounts[allowed[i]]) || 0);
    }
    return count;
  }
  if (bucket === "videos") return Math.max(0, Number(summary.recursiveVideoCount) || 0);
  if (bucket === "text") return Math.max(0, Number(summary.recursiveTextCount) || 0);
  return Math.max(0, Number(summary.recursiveImageCount) || 0);
}

function catalogSummaryMediaBucketsForGlobalFilterMode(filterMode) {
  const mode = String(filterMode || "all");
  if (mode === "videos") return ["videos"];
  if (mode === "images") return ["images"];
  if (mode === "text") return ["text"];
  return ["images", "videos", "text"];
}

function catalogSummaryFileCountForCurrentAndTagMediaFilters(summary, filterValue) {
  if (!summary) return -1;
  const hidden = normalizeTagMediaFilterValue(filterValue);
  if (!hidden.length) return catalogSummaryFileCountForCurrentFilters(summary);
  const buckets = catalogSummaryMediaBucketsForGlobalFilterMode(
    WS.view && WS.view.filterMode,
  ).filter((bucket) => !hidden.includes(bucket));
  if (!buckets.length) return 0;
  const aspectMode = WS.view && WS.view.aspectRatioFilterMode;
  let total = 0;
  for (let i = 0; i < buckets.length; i++) {
    const count = catalogSummaryFileCountForFilter(
      summary,
      buckets[i],
      aspectMode,
    );
    if (count < 0) return -1;
    total += count;
  }
  return total;
}

function catalogSummaryHasVisibleRecordForTagEntry(summary, entry, dirNode = null) {
  if (!summary) return null;
  return (
    catalogSummaryFileCountForCurrentAndTagMediaFilters(
      summary,
      combineTagMediaFilterValues(
        nearestFolderMediaFilterForPath(String(dirNode?.path || "")),
        effectiveTagMediaFilterForEntry(entry),
      ),
    ) > 0
  );
}

function tagEntryVisibilityNeedsExactAspectScan(entry) {
  return false;
}

function loadedDirHasVisibleRecordForTagEntry(dirNode, entry) {
  if (!dirNode || !entry || entry.kind !== "tag") return null;
  if (dirNode.loadState !== "loaded") return null;
  const fileIds = Array.isArray(dirNode.childrenFiles)
    ? dirNode.childrenFiles
    : [];
  for (let i = 0; i < fileIds.length; i++) {
    const rec = WS.fileById.get(String(fileIds[i] || ""));
    if (rec && recordPassesTagEntryFilter(rec, entry)) return true;
  }
  const children = getVisibleChildDirsForTagEvaluation(dirNode);
  for (let i = 0; i < children.length; i++) {
    const childResult = loadedDirHasVisibleRecordForTagEntry(children[i], entry);
    if (childResult === true) return true;
    if (childResult == null) return null;
  }
  return false;
}

function dirItemCount(node) {
  if (!node) return 0;
  const filterKey = effectiveFilterCacheKey();
  const contextualFilter = contextualTagMediaFilterForDirPath(
    String(node.path || ""),
  );
  // Files held by an Exclusive Tag with an override depend on where you are
  // looking from, which neither the catalog summary nor the cache can know.
  const claimed = dirPathHasExclusiveFileClaims(String(node.path || ""));
  // The catalog summary counts every file, whatever the Set's score. And a
  // Tag's score override makes the count depend on where it is looked at
  // from, which the cache below cannot know.
  const scoreFiltered = scoreFilterMayApply();
  const scoreContextual =
    scoreFilterOverrideKindsInUse().set.tag;
  const summary = claimed || scoreFiltered ? null : getCatalogSummaryForNode(node);
  const summaryCount = contextualFilter.length
    ? catalogSummaryFileCountForCurrentAndTagMediaFilters(
        summary,
        contextualFilter,
      )
    : catalogSummaryFileCountForCurrentFilters(summary);
  if (summaryCount >= 0) return summaryCount;
  if (
    !claimed &&
    !scoreFiltered &&
    filterKey === "global:all" &&
    ensureDirectoryDerivedIndex() &&
    Number.isFinite(Number(node.recursiveFileCount))
  ) {
    return Math.max(0, Number(node.recursiveFileCount) || 0);
  }
  if (DIR_ITEM_COUNT_CACHE_FILTER_MODE !== filterKey) {
    DIR_ITEM_COUNT_CACHE_FILTER_MODE = filterKey;
    DIR_ITEM_COUNT_CACHE.clear();
  }
  const pathKey = String(node.path || "");
  // The item-count cache is keyed only by the global filter, so it cannot hold a
  // contextual tag-filtered count without going stale when the tag filter
  // changes. Skip the cache entirely while a contextual filter is active.
  if (
    !contextualFilter.length &&
    !claimed &&
    !scoreContextual &&
    DIR_ITEM_COUNT_CACHE.has(pathKey)
  )
    return DIR_ITEM_COUNT_CACHE.get(pathKey) || 0;
  let c = 0;
  for (const id of node.childrenFiles) {
    const rec = WS.fileById.get(id);
    if (!passesFilter(rec)) continue;
    if (
      contextualFilter.length &&
      !recordPassesTagMediaFilter(rec, contextualFilter)
    )
      continue;
    c++;
  }
  for (const d of node.childrenDirs) c += dirItemCount(d);
  if (!contextualFilter.length && !claimed && !scoreContextual)
    DIR_ITEM_COUNT_CACHE.set(pathKey, c);
  return c;
}

function dirCanAppearUnderCurrentContentFilters(dirNode) {
  if (!dirNode || dirNode.type !== "dir") return false;
  if (dirNode.isMissingPlaceholder) return true;
  if (dirNode.altVariants) return true;
  const hasMissingChild =
    (Array.isArray(dirNode.childrenDirs) &&
      dirNode.childrenDirs.some((child) => child && child.isMissingPlaceholder)) ||
    (Array.isArray(dirNode.childrenFiles) &&
      dirNode.childrenFiles.some((id) => {
        const rec = WS.fileById.get(id);
        return !!(rec && rec.isMissingPlaceholder);
      }));
  if (hasMissingChild) return true;
  if (metaHasFolderMediaFilter(dirNode.path || "")) return true;
  if (dirItemCount(dirNode) > 0) return true;
  if (dirNode.fsHandle && dirNode.loadState !== "loaded") return true;
  return !!(isStorageStubDirNode(dirNode) && !getCatalogSummaryForNode(dirNode));
}
