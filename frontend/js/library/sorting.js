/* Sorting
   Listing caches, sort modes and the random orders. */

/* =========================================================
       Sorting helpers
       ========================================================= */

let DIR_SORT_METRICS_CACHE = null;
let DIR_ITEM_COUNT_CACHE = new Map();
let DIR_ITEM_COUNT_CACHE_FILTER_MODE = "";
let TAG_ENTRY_DIRS_CACHE = new Map();
let TAG_ENTRY_METRICS_CACHE = new Map();
let TAG_ENTRY_PREVIEW_POOL_CACHE = new Map();
let TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE = new Map();
let TAG_GROUPS_BY_DIR_CACHE = new Map();
let TAG_ALBUM_STATS_BY_SCOPE_CACHE = new Map();
let TAG_FOLDER_ENTRIES_CACHE = new Map();
let TAG_ALBUM_TAG_ENTRIES_CACHE = new Map();
let TAG_FOLDER_VIEW_DIRS_CACHE = new Map();
let TAG_SCOPE_MODEL_CACHE = new Map();
// The library-wide Tag index (members, Tag-in-Tag links, placement, what an
// Exclusive Tag takes out of its real place). Rebuilt lazily after any change.
let TAG_MODEL_CACHE = null;
let EFFECTIVE_HIDDEN_GALLERY_NAMES_CACHE = null;
let NAV_ENTRY_RESTORE_REVISION = 0;

function clearTagEntryDerivedCaches() {
  TAG_ENTRY_DIRS_CACHE = new Map();
  TAG_ENTRY_METRICS_CACHE = new Map();
  TAG_ENTRY_PREVIEW_POOL_CACHE = new Map();
  TAG_ENTRY_VISIBLE_RECORD_DIR_CACHE = new Map();
  TAG_GROUPS_BY_DIR_CACHE = new Map();
  TAG_ALBUM_STATS_BY_SCOPE_CACHE = new Map();
  TAG_FOLDER_ENTRIES_CACHE = new Map();
  TAG_ALBUM_TAG_ENTRIES_CACHE = new Map();
  TAG_FOLDER_VIEW_DIRS_CACHE = new Map();
  TAG_SCOPE_MODEL_CACHE = new Map();
  TAG_MODEL_CACHE = null;
}

function invalidateDirSortMetricsCache() {
  DIR_SORT_METRICS_CACHE = null;
}

function invalidateDirItemCountCache() {
  DIR_ITEM_COUNT_CACHE = new Map();
  DIR_ITEM_COUNT_CACHE_FILTER_MODE = "";
}

// Everything a folder-sort-mode change must invalidate. The revision bump is the
// load-bearing part: cached nav-entry snapshots (captureViewerCloseRestoreState)
// and saved tag-frame orders are keyed off it, so without it, closing a file that
// was opened before the sort changed restores WS.nav.entries in the *old* order —
// and since every later capture re-snapshots those stale entries, the folder stays
// stuck in the old order until the app restarts.
function invalidateDirSortOrderCaches() {
  NAV_ENTRY_RESTORE_REVISION++;
  invalidateDirSortMetricsCache();
  clearTagEntryDerivedCaches();
}

function invalidateDirMetricsCaches() {
  NAV_ENTRY_RESTORE_REVISION++;
  invalidateDirSortMetricsCache();
  invalidateDirItemCountCache();
  clearTagEntryDerivedCaches();
  EFFECTIVE_HIDDEN_GALLERY_NAMES_CACHE = null;
  DIR_NAV_MANIFESTS.clear();
  HOT_NAV_DIR_PATHS.clear();
  PINNED_HOT_NAV_DIR_PATHS.clear();
  PINNED_HOT_NAV_DECODE_CACHE.clear();
}

function dirSortDisplayCacheKey() {
  const mode = normalizeDirSortMode(WS.meta && WS.meta.dirSortMode);
  return ["dirsort", mode, randomOrderSignature(), String(NAV_ENTRY_RESTORE_REVISION || 0)].join(":");
}

function invalidateHiddenVisibilityState() {
  invalidateDirMetricsCaches();
  ROTATING_PREVIEW_POOLS.clear();
  ROTATING_PREVIEW_ORDER.clear();
  ROTATING_PREVIEW_INDEX.clear();
  ROTATING_PREVIEW_NEXT_AT.clear();
  bumpThumbnailDemandToken();
  try {
    finishDirectoriesGridFileDrag();
  } catch {}
  try {
    closeActionMenus();
  } catch {}
}

function byName(a, b) {
  return compareIndexedNames(a?.name || "", b?.name || "");
}

function dirSortModeOptions(includeScoreUi = true) {
  const options = [
    { value: "name", label: "Name" },
    { value: "score", label: "Score" },
    { value: "efficiency", label: "Efficiency" },
    { value: "size-desc", label: "Size" },
    { value: "count-recursive", label: "Item count" },
  ];
  if (includeScoreUi) return options;
  return options.filter(
    (opt) => opt.value !== "score" && opt.value !== "efficiency",
  );
}

function normalizeDirSortMode(mode) {
  const raw = String(mode || "");
  const allowed = dirSortModeOptions().map((opt) => opt.value);
  if (allowed.includes(raw)) return raw;
  return "name";
}

function dirSortModeLabel(mode) {
  const normalized = normalizeDirSortMode(mode);
  const found = dirSortModeOptions().find((opt) => opt.value === normalized);
  return found ? found.label : "Name";
}

function cycleDirSortMode(mode, includeScoreUi = true) {
  const values = dirSortModeOptions(includeScoreUi).map((opt) => opt.value);
  const current = normalizeDirSortMode(mode);
  const idx = values.indexOf(current);
  return values[(idx >= 0 ? idx + 1 : 0) % values.length];
}

function containerSortModeOptions() {
  return [{ value: "", label: "None" }].concat(dirSortModeOptions());
}

function normalizeContainerSortMode(mode) {
  const raw = String(mode || "");
  return dirSortModeOptions().some((option) => option.value === raw) ? raw : "";
}

function metaGetFolderContainerSortMode(path) {
  if (!WS.meta || !WS.meta.containerSortByFolderPath) return "";
  return normalizeContainerSortMode(
    WS.meta.containerSortByFolderPath.get(normalizeDirPathValue(path)),
  );
}

function metaSetFolderContainerSortMode(path, mode) {
  if (!WS.meta || !WS.meta.containerSortByFolderPath) return false;
  const normalizedPath = normalizeDirPathValue(path);
  const next = normalizeContainerSortMode(mode);
  const previous = metaGetFolderContainerSortMode(normalizedPath);
  if (previous === next) return false;
  if (next) WS.meta.containerSortByFolderPath.set(normalizedPath, next);
  else WS.meta.containerSortByFolderPath.delete(normalizedPath);
  invalidateDirSortOrderCaches();
  metaMarkDirty(META_DOC_IDS.prefGeneral);
  return true;
}

function metaGetTagContainerSortMode(tagKey) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.containerSortByTagKey) return "";
  return normalizeContainerSortMode(WS.meta.containerSortByTagKey.get(key));
}

function metaSetTagContainerSortMode(tagKey, mode) {
  const key = String(tagKey || "");
  if (!key || !WS.meta || !WS.meta.containerSortByTagKey) return false;
  const next = normalizeContainerSortMode(mode);
  const previous = metaGetTagContainerSortMode(key);
  if (previous === next) return false;
  if (next) WS.meta.containerSortByTagKey.set(key, next);
  else WS.meta.containerSortByTagKey.delete(key);
  invalidateDirSortOrderCaches();
  metaMarkDirty(META_DOC_IDS.prefGeneral);
  return true;
}

function effectiveFolderContainerSortMode(dirNode) {
  let node = dirNode || null;
  while (node) {
    const path = String(node.path || "");
    const mode = metaGetFolderContainerSortMode(path);
    if (mode) return mode;
    node = node.parent || null;
  }
  return "";
}

function tagContainerSortModeForContext(modeRaw, tagRaw, albumRaw, originRaw) {
  const mode = String(modeRaw || "");
  if (!mode) return "";
  const entry = {
    kind: "tag",
    special:
      mode === "favorites" || mode === "untagged" || mode === "hidden" || mode === "storage"
        ? mode
        : "",
    tag: mode === "tag" ? String(tagRaw || "") : "",
    album: mode === "album" ? String(albumRaw || "") : "",
    originPath: String(originRaw || ""),
  };
  const direct = metaGetTagContainerSortMode(tagThumbnailKeyForEntry(entry));
  if (direct) return direct;
  if (mode === "tag" && albumRaw) {
    return metaGetTagContainerSortMode(
      tagThumbnailKeyForAlbum(albumRaw, originRaw),
    );
  }
  return "";
}

function activeTagContainerSortMode() {
  if (!WS.view) return "";
  const direct = tagContainerSortModeForContext(
    WS.view.tagFolderActiveMode,
    WS.view.tagFolderActiveTag,
    WS.view.tagFolderActiveAlbum,
    WS.view.tagFolderOriginPath,
  );
  if (direct) return direct;
  const currentPath = String(WS.nav?.dirNode?.path || "");
  const stack = Array.isArray(WS.view.tagNavStack)
    ? WS.view.tagNavStack
    : [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i];
    if (!frame || frame.type !== "tag-view") continue;
    // A Tag view lends its sort only to folders inside it. The root's path is
    // "", which used to skip this test entirely -- so any Tag view left in the
    // back-history (a restored session can carry one) imposed its sort
    // on the root, and "Sort: Score" came out alphabetical there. The root is
    // never inside a Tag view, and findMatchingVirtualPortalRootPath says so.
    if (!findMatchingVirtualPortalRootPath(frame, currentPath)) continue;
    const inherited = tagContainerSortModeForContext(
      frame.mode,
      frame.tag,
      frame.album,
      frame.originPath,
    );
    if (inherited) return inherited;
  }
  return "";
}

function effectiveContainerSortModeForDir(dirNode) {
  return activeTagContainerSortMode() || effectiveFolderContainerSortMode(dirNode);
}

function buildDirSortMetrics() {
  if (DIR_SORT_METRICS_CACHE) return DIR_SORT_METRICS_CACHE;
  const sizeByPath = new Map();
  const recursiveCountByPath = new Map();
  const recursiveScoreByPath = new Map();
  const efficiencyByPath = new Map();

  if (!WS.root) {
    return {
      sizeByPath,
      recursiveCountByPath,
      recursiveScoreByPath,
      efficiencyByPath,
    };
  }

  if (ensureDirectoryDerivedIndex()) {
    for (const node of WS.dirByPath.values()) {
      if (!node) continue;
      const path = String(node.path || "");
      const size = Math.max(0, Number(node.recursiveSizeBytes) || 0);
      const recursiveCount = Math.max(0, Number(node.recursiveItemCount) || 0);
      const recursiveScore = Number(metaGetScore(path)) || 0;
      sizeByPath.set(path, size);
      recursiveCountByPath.set(path, recursiveCount);
      recursiveScoreByPath.set(path, recursiveScore);
      efficiencyByPath.set(path, recursiveScore / Math.max(1, recursiveCount));
    }
    DIR_SORT_METRICS_CACHE = {
      sizeByPath,
      recursiveCountByPath,
      recursiveScoreByPath,
      efficiencyByPath,
    };
    return DIR_SORT_METRICS_CACHE;
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
    const recursiveScore = Number(metaGetScore(path)) || 0;
    sizeByPath.set(path, size);
    recursiveCountByPath.set(path, recursiveCount);
    recursiveScoreByPath.set(path, recursiveScore);
    efficiencyByPath.set(path, recursiveScore / Math.max(1, recursiveCount));
  })(WS.root);

  DIR_SORT_METRICS_CACHE = {
    sizeByPath,
    recursiveCountByPath,
    recursiveScoreByPath,
    efficiencyByPath,
  };
  return DIR_SORT_METRICS_CACHE;
}

/* Randomize (Controls): model order, set order and file order, three
   switches. Each is a stored option (randomOrderModels / Sets / Files) and
   only its own control writes it -- nothing that resets the view, rebuilds the
   workspace or reloads settings touches them. (Set order used to live in
   WS.view, where several of those resets quietly turned it off.)

   Each has its own seed, drawn fresh when it is turned on, so turning one on
   reshuffles only its own kind. The seeds live outside WS.view too, so a
   refresh keeps the same order. stableRandomOrder memoizes each list's order,
   so one seen again comes back the same, and items that join later go on the
   end rather than reshuffling the rest. */
const RANDOM_ORDER_KINDS = Object.freeze({
  models: Object.freeze({ option: "randomOrderModels", label: "model order" }),
  sets: Object.freeze({ option: "randomOrderSets", label: "set order" }),
  files: Object.freeze({ option: "randomOrderFiles", label: "file order" }),
});
var RANDOM_ORDER_SEEDS = { models: 0, sets: 0, files: 0 }; // `var`: read by renders that can run before this line.
var RANDOM_ORDER_MEMO = new Map();

function randomOrderOn(kind) {
  const spec = RANDOM_ORDER_KINDS[kind];
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  return !!(spec && opt && opt[spec.option] === true);
}

function freshRandomOrderSeed() {
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}

function randomOrderSeed(kind) {
  if (!RANDOM_ORDER_SEEDS[kind]) RANDOM_ORDER_SEEDS[kind] = freshRandomOrderSeed();
  return RANDOM_ORDER_SEEDS[kind];
}

// For cache keys: which shuffles are on, and with which seed.
function randomOrderSignature() {
  return Object.keys(RANDOM_ORDER_KINDS)
    .map((kind) => (randomOrderOn(kind) ? `${kind}:${randomOrderSeed(kind)}` : `${kind}:off`))
    .join(",");
}

// Which kind a list of folders is, read off the library's shape: Models sit
// in the root, Sets in a Model.
function randomOrderKindForDirs(dirs) {
  const first = Array.isArray(dirs) ? dirs.find(Boolean) : null;
  const parent = first ? first.parent : null;
  if (!parent || !WS.root) return "";
  if (parent === WS.root) return "models";
  if (parent.parent === WS.root) return "sets";
  return "";
}

// The shuffle that applies to this list of folders, or "".
function randomOrderActiveForDirs(dirs) {
  const kind = randomOrderKindForDirs(dirs);
  return kind && randomOrderOn(kind) ? kind : "";
}

function stableRandomOrder(kind, key, items, idOf) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (list.length <= 1) return list;
  const seed = randomOrderSeed(kind);
  const memoKey = `${kind}:${seed}:${key}`;
  const memo = RANDOM_ORDER_MEMO.get(memoKey);
  if (memo) {
    const byId = new Map(list.map((item) => [idOf(item), item]));
    const placed = new Set();
    const out = [];
    for (const id of memo) {
      if (placed.has(id) || !byId.has(id)) continue;
      placed.add(id);
      out.push(byId.get(id));
    }
    const added = list.filter((item) => !placed.has(idOf(item)));
    if (!added.length) return out;
    out.push(...added);
    RANDOM_ORDER_MEMO.set(memoKey, memo.concat(added.map(idOf)));
    return out;
  }
  const shuffled = shuffleWithSeed(list, (seed ^ hash32(`${kind}:${key}`)) >>> 0);
  RANDOM_ORDER_MEMO.set(memoKey, shuffled.map(idOf));
  return shuffled;
}

function randomOrderDirPath(node) {
  return String(node?.path || "");
}

// A set's files in their shuffled order, when Randomize file order is on.
function randomOrderFileIds(dirNode, ids) {
  if (!randomOrderOn("files")) return ids;
  return stableRandomOrder("files", `files:${String(dirNode?.path || "")}`, ids, String);
}

function toggleRandomOrder(kind) {
  const spec = RANDOM_ORDER_KINDS[kind];
  if (!spec || !WS.root || !WS.meta) return false;
  const on = !randomOrderOn(kind);
  setOptionValue(spec.option, on);
  for (const key of Array.from(RANDOM_ORDER_MEMO.keys()))
    if (key.startsWith(`${kind}:`)) RANDOM_ORDER_MEMO.delete(key);
  if (on) RANDOM_ORDER_SEEDS[kind] = freshRandomOrderSeed();
  WS.view.randomFolderCache = new Map();
  clearTagEntryDerivedCaches();
  invalidateDirMetricsCaches();
  applyRandomSortModeEverywhere(true);
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(`Randomize ${spec.label}: ${on ? "On" : "Off"}`, "random-order");
  return true;
}

// The random controls, in the order Controls and the hold-[ page list them.
const RANDOM_CONTROL_IDS = Object.freeze([
  "randomFileInFolderJump",
  "randomFileInModelJump",
  "randomFileInRootJump",
  "randomFirstFileJump",
  "randomRootSetJump",
  "randomModelJump",
  "toggleRandomModelOrder",
  "toggleRandomFolderSort",
  "toggleRandomFileOrder",
]);
const RANDOM_CONTROL_ID_SET = new Set(RANDOM_CONTROL_IDS);
