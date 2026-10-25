/* Tag model
   getTagModel: placement, Exclusive, library-shape views and Tag
   rename/delete. */

function getTagModel() {
  if (TAG_MODEL_CACHE) return TAG_MODEL_CACHE;
  const names = new Set();
  const members = new Map();
  const collect = (map) => {
    if (!(map instanceof Map)) return;
    for (const [rawPath, rawTags] of map.entries()) {
      const path = normalizeDirPathValue(rawPath);
      if (!path || !Array.isArray(rawTags)) continue;
      for (const raw of rawTags) {
        const tag = normalizeTag(raw);
        if (
          !tag ||
          isReservedFolderTag(tag) ||
          tag === LEGACY_PROCESSING_DISABLED_TAG ||
          tag === TAG_STORAGE_NAME
        )
          continue;
        names.add(tag);
        if (!members.has(tag)) members.set(tag, new Set());
        members.get(tag).add(path);
      }
    }
  };
  collect(WS.meta && WS.meta.dirTags);
  collect(WS.meta && WS.meta.pendingTagsByPath);

  // Contents rules (see contentsSourceKeysForSelection). A folder rule puts
  // every folder directly inside it in the Tag -- whatever is there now, which
  // is what makes it live; a Tag rule puts every folder of that Tag in it.
  // Folder rules first, so a Tag rule also sees members they added.
  const contentRules =
    WS.meta && WS.meta.contentTags instanceof Map ? WS.meta.contentTags : new Map();
  const addMember = (tag, path) => {
    if (tag === TAG_STORAGE_NAME) return;
    names.add(tag);
    if (!members.has(tag)) members.set(tag, new Set());
    members.get(tag).add(path);
  };
  for (const [key, tagSet] of contentRules.entries()) {
    if (!String(key).startsWith("dir:")) continue;
    const sourcePath = String(key).slice(4);
    const source = sourcePath ? WS.dirByPath.get(sourcePath) : WS.root;
    for (const child of (source && source.childrenDirs) || []) {
      const childPath = normalizeDirPathValue(child?.path || "");
      if (!childPath || child.isMissingPlaceholder || isInternalTrashDirNode(child))
        continue;
      for (const tag of tagSet || []) addMember(tag, childPath);
    }
  }
  for (const [key, tagSet] of contentRules.entries()) {
    if (!String(key).startsWith("tag:")) continue;
    const sourceTag = String(key).slice(4);
    const sourceMembers = Array.from(members.get(sourceTag) || []);
    for (const tag of tagSet || []) {
      if (tag === sourceTag) continue;
      for (const path of sourceMembers) addMember(tag, path);
    }
  }

  const children = new Map();
  const parentsMap = WS.meta && WS.meta.tagParents instanceof Map ? WS.meta.tagParents : new Map();
  for (const [child, parents] of parentsMap.entries()) {
    if (!child) continue;
    names.add(child);
    for (const parent of parents || []) {
      if (!parent || parent === child) continue;
      names.add(parent);
      if (!children.has(parent)) children.set(parent, new Set());
      children.get(parent).add(child);
    }
  }

  const placement = new Map();
  const visiting = new Set();
  const place = (tag) => {
    if (placement.has(tag)) return placement.get(tag);
    if (visiting.has(tag)) return null;
    visiting.add(tag);
    let where = null;
    let any = false;
    for (const path of members.get(tag) || []) {
      if (!tagModelFolderExists(path)) continue;
      const parent = tagModelParentPath(path);
      where = any ? tagModelCommonPath(where, parent) : parent;
      any = true;
    }
    for (const child of children.get(tag) || []) {
      const childWhere = place(child);
      if (childWhere == null) continue;
      where = any ? tagModelCommonPath(where, childWhere) : childWhere;
      any = true;
    }
    visiting.delete(tag);
    placement.set(tag, any ? where : null);
    return placement.get(tag);
  };
  for (const tag of names) place(tag);

  const exclusive = new Set(
    WS.meta && WS.meta.exclusiveTags instanceof Set ? WS.meta.exclusiveTags : [],
  );
  // Tag storage is always Exclusive (it holds only Tags, so only they move).
  exclusive.add(TAG_STORAGE_NAME);
  const exclusiveFolders = new Set();
  const exclusiveChildTags = new Set();
  // An Exclusive Tag with a media type override takes only the files that pass
  // the override, and leaves its folders (and their other files) where they
  // are. See recordIsHeldByExclusiveFileTag.
  const fileClaimsByFolder = new Map();
  for (const tag of exclusive) {
    const filter = metaGetTagMediaFilterByKey(tagThumbnailKeyForTag(tag));
    for (const path of members.get(tag) || []) {
      // A trashed folder keeps its Tags (so putting it back restores them),
      // but the Tag no longer shows it -- so it must not be taken out of the
      // Trash either, or it is in neither place.
      if (isPathInsideInternalTrash(path)) continue;
      if (!filter.length) {
        exclusiveFolders.add(path);
        continue;
      }
      if (!fileClaimsByFolder.has(path)) fileClaimsByFolder.set(path, []);
      fileClaimsByFolder.get(path).push({ tag, filter });
    }
    for (const child of children.get(tag) || []) exclusiveChildTags.add(child);
  }

  const byName = (a, b) => String(a).localeCompare(String(b));
  const tagsByPlacement = new Map();
  for (const [tag, where] of placement.entries()) {
    if (where == null || exclusiveChildTags.has(tag) || tag === TAG_STORAGE_NAME) continue;
    if (!tagsByPlacement.has(where)) tagsByPlacement.set(where, []);
    tagsByPlacement.get(where).push(tag);
  }
  for (const list of tagsByPlacement.values()) list.sort(byName);

  TAG_MODEL_CACHE = {
    // tag + sort key -> that Tag's folders in display order, filled on demand.
    // The cache is dropped on every tag, tree or sort change, so this never
    // outlives what it was built from.
    memberNodesMemo: new Map(),
    names,
    membersByTag: new Map(Array.from(members.entries()).map(([t, set]) => [t, Array.from(set)])),
    childrenByTag: new Map(Array.from(children.entries()).map(([t, set]) => [t, Array.from(set).sort(byName)])),
    placementByTag: placement,
    tagsByPlacement,
    exclusiveFolders,
    exclusiveChildTags,
    fileClaimsByFolder,
  };
  return TAG_MODEL_CACHE;
}

function getAllTagNames() {
  return Array.from(getTagModel().names).sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
}

function tagNameExists(name) {
  const tag = normalizeTag(name);
  return !!tag && getTagModel().names.has(tag);
}

function tagPlacementPath(name) {
  const where = getTagModel().placementByTag.get(normalizeTag(name));
  return where == null ? null : where;
}

function tagMemberPaths(name) {
  const tag = normalizeTag(name);
  if (isLibraryShapeViewName(tag)) return libraryShapeViewMemberPaths(tag);
  return (getTagModel().membersByTag.get(tag) || []).slice();
}

// Every Model (the folders directly inside the root) or every Set (the folders
// directly inside a Model), read off the tree itself. Tags, Exclusive and
// contents rules play no part. The Trash and Storage are not the library's
// Models, so neither they nor anything in them is listed. Remembered on the tag
// model, which is rebuilt whenever the tree or the tags change.
function libraryShapeViewNodeIsUsable(node) {
  return (
    !!node &&
    node.type === "dir" &&
    !isInternalTrashDirNode(node) &&
    !isStorageStubDirNode(node) &&
    !node.isMissingPlaceholder &&
    !dirNodeIsHiddenAlt(node) &&
    !metaHasStorage(node.path || "")
  );
}

function libraryShapeViewMemberPaths(name) {
  const tag = normalizeTag(name);
  if (!WS.root || !isLibraryShapeViewName(tag)) return [];
  const model = getTagModel();
  if (!(model.libraryShapeMembers instanceof Map)) model.libraryShapeMembers = new Map();
  // Certified fresh depends on scores and on whether hidden Sets count, so its
  // memo is keyed by both (scores do not rebuild the tag model).
  const memoKey =
    tag === CERTIFIED_FRESH_NAME
      ? `${tag}|${SCORE_FILTER_REVISION}|${hiddenContentVisibleInCurrentView() ? 1 : 0}`
      : tag;
  const memo = model.libraryShapeMembers.get(memoKey);
  if (memo) return memo.slice();
  const usable = libraryShapeViewNodeIsUsable;
  const out = [];
  const modelView = parseModelMediaViewName(tag);
  if (modelView) {
    // A Model's media view: that Model's Sets. The media type is its filter
    // (metaGetTagMediaFilterByKey), so a Set without that type drops out of
    // the grid like any folder a Tag's filter empties.
    const modelNode = WS.dirByPath.get(modelView.modelPath);
    if (modelNode && modelNode.parent === WS.root && usable(modelNode)) {
      for (const node of ensureDirectoryChildNodesFromCatalog(modelNode)) {
        if (usable(node)) out.push(String(node.path || ""));
      }
    }
    const paths = out.filter(Boolean);
    model.libraryShapeMembers.set(memoKey, paths);
    return paths.slice();
  }
  const models = ensureDirectoryChildNodesFromCatalog(WS.root).filter(usable);
  if (tag === CERTIFIED_FRESH_NAME) {
    out.push(...certifiedFreshModelPaths());
  } else if (tag === ALL_MODELS_NAME) {
    for (const node of models) out.push(String(node.path || ""));
  } else {
    for (const modelNode of models) {
      for (const node of ensureDirectoryChildNodesFromCatalog(modelNode)) {
        if (usable(node)) out.push(String(node.path || ""));
      }
    }
  }
  const paths = out.filter(Boolean);
  model.libraryShapeMembers.set(memoKey, paths);
  return paths.slice();
}

// The media views a Model gets: one per media type its Sets hold, and none at
// all when they hold only one type (the view would be the Model again).
function modelMediaViewNamesForModel(modelNode) {
  if (!modelNode || modelNode.parent !== WS.root) return [];
  if (!libraryShapeViewNodeIsUsable(modelNode)) return [];
  const counts = { images: 0, videos: 0, text: 0 };
  for (const node of ensureDirectoryChildNodesFromCatalog(modelNode)) {
    if (!libraryShapeViewNodeIsUsable(node)) continue;
    counts.images += Number(node.recursiveImageCount) || 0;
    counts.videos += Number(node.recursiveVideoCount) || 0;
    counts.text += Number(node.recursiveTextCount) || 0;
  }
  const present = MODEL_MEDIA_VIEW_KINDS.filter((k) => counts[k.type] > 0);
  if (present.length < 2) return [];
  const modelPath = String(modelNode.path || "");
  return present.map((k) => modelMediaViewName(modelPath, k.type));
}

// The Models holding at least one Set whose own score is above 0. A hidden Set
// does not count while hidden items are hidden (a hidden Model is dropped by
// the ordinary visibility test, like everywhere else).
function certifiedFreshModelPaths() {
  if (!WS.root) return [];
  const showHidden = hiddenContentVisibleInCurrentView();
  const out = [];
  for (const modelNode of ensureDirectoryChildNodesFromCatalog(WS.root)) {
    if (!libraryShapeViewNodeIsUsable(modelNode)) continue;
    const fresh = ensureDirectoryChildNodesFromCatalog(modelNode).some(
      (setNode) =>
        libraryShapeViewNodeIsUsable(setNode) &&
        metaGetScore(setNode.path || "") > 0 &&
        (showHidden || !isDirHidden(setNode)),
    );
    if (fresh) out.push(String(modelNode.path || ""));
  }
  return out.filter(Boolean);
}

// Scores do not rebuild the tag model, so a score change that moves a Model in
// or out of Certified fresh drops the Tag-derived caches (its card count and
// grid are cached there). Only checked once the view has been asked for.
var CERTIFIED_FRESH_LAST_PATHS = null; // `var`: read by resetWorkspace and bumpScoreFilterRevision, which can run before this line.
function refreshCertifiedFreshAfterScoreChange() {
  if (CERTIFIED_FRESH_LAST_PATHS == null || !WS.root) return;
  const next = certifiedFreshModelPaths().join("\n");
  if (next === CERTIFIED_FRESH_LAST_PATHS) return;
  CERTIFIED_FRESH_LAST_PATHS = next;
  clearTagEntryDerivedCaches();
}

function tagChildNames(name) {
  const tag = normalizeTag(name);
  // "All tags" holds every Tag that has a place. It is not in the model and
  // holds no folders of its own, so opening it, previewing it and picking its
  // thumbnail all go through the ordinary Tag paths, and each Tag inside is the
  // real one rather than a copy.
  if (tag === ALL_TAGS_NAME) return allTagsFolderChildNames();
  return (getTagModel().childrenByTag.get(tag) || []).slice();
}

function allTagsFolderChildNames() {
  const model = getTagModel();
  return Array.from(model.names)
    .filter(
      (tag) =>
        tag &&
        !isInternalTagName(tag) &&
        model.placementByTag.get(tag) != null,
    )
    .sort((a, b) => String(a).localeCompare(String(b)));
}

function tagParentNames(name) {
  const parents = WS.meta && WS.meta.tagParents instanceof Map
    ? WS.meta.tagParents.get(normalizeTag(name))
    : null;
  return parents ? Array.from(parents).sort((a, b) => String(a).localeCompare(String(b))) : [];
}

function tagIsExclusive(name) {
  const tag = normalizeTag(name);
  return !!tag && WS.meta && WS.meta.exclusiveTags instanceof Set && WS.meta.exclusiveTags.has(tag);
}

/* Exclusive + media type override: the files the override lets through belong
   to that Tag alone. Everywhere else -- the folder they really sit in, other
   Tags holding the same folder -- they are filtered out, while the folder and
   its remaining files stay put. A Tag that holds a Model and shows only videos
   therefore takes the videos out of the Model's sets. */
function exclusiveFileTagsClaimingRecord(rec) {
  const claims = getTagModel().fileClaimsByFolder;
  if (!rec || !claims.size) return null;
  let path = normalizeDirPathValue(rec.dirPath || "");
  let out = null;
  while (path) {
    const list = claims.get(path);
    if (list) {
      for (const claim of list) {
        if (!recordPassesTagMediaFilter(rec, claim.filter)) continue;
        if (!out) out = [];
        out.push(claim.tag);
      }
    }
    path = tagModelParentPath(path);
  }
  return out;
}

function dirPathHasExclusiveFileClaims(dirPath) {
  const claims = getTagModel().fileClaimsByFolder;
  if (!claims.size) return false;
  const path = normalizeDirPathValue(dirPath);
  for (const key of claims.keys()) {
    if (isSameOrDescendantPath(key, path) || isSameOrDescendantPath(path, key))
      return true;
  }
  return false;
}

function tagHoldsFolderPath(tag, path) {
  const members = tagMemberPaths(tag);
  return members.some((member) => isSameOrDescendantPath(path, member));
}

// The Tags a folder is being looked at through right now: the open Tag, Tag
// views further back that still contain it, and a Tag being previewed.
function tagViewNamesForDirPath(dirPath) {
  const path = normalizeDirPathValue(dirPath);
  const out = new Set();
  const view = WS.view || {};
  if (String(view.tagFolderActiveMode || "") === "tag") {
    const tag = normalizeTag(view.tagFolderActiveTag || "");
    if (tag && tagHoldsFolderPath(tag, path)) out.add(tag);
  }
  const stack = Array.isArray(view.tagNavStack) ? view.tagNavStack : [];
  for (const frame of stack) {
    if (!frame || frame.type !== "tag-view" || String(frame.mode || "") !== "tag")
      continue;
    const tag = normalizeTag(frame.tag || "");
    if (tag && findMatchingVirtualPortalRootPath(frame, path)) out.add(tag);
  }
  const previewDir = WS.preview && WS.preview.dirNode;
  if (
    previewDir &&
    previewDir._skipTagFilters &&
    String(previewDir._tagPreviewMode || "") === "tag"
  ) {
    const tag = normalizeTag(previewDir._tagPreviewTag || "");
    if (tag && tagHoldsFolderPath(tag, path)) out.add(tag);
  }
  return out;
}

// allowTags: Tags the caller is asking on behalf of (a Tag card's own pool).
function recordIsHeldByExclusiveFileTag(rec, allowTags = null) {
  const claimants = exclusiveFileTagsClaimingRecord(rec);
  if (!claimants) return false;
  if (allowTags && claimants.some((tag) => allowTags.has(tag))) return false;
  // All Models / All Sets (and a Model's media views) show every file,
  // whichever Tag has taken it.
  if (allowTags && Array.from(allowTags).some(isLibraryShapeViewName)) return false;
  const viewing = tagViewNamesForDirPath(rec.dirPath || "");
  if (Array.from(viewing).some(isLibraryShapeViewName)) return false;
  return !claimants.some((tag) => viewing.has(tag));
}

function exclusiveFileClaimContextKey(dirPath) {
  if (!dirPathHasExclusiveFileClaims(dirPath)) return "";
  return Array.from(tagViewNamesForDirPath(dirPath)).sort().join(",");
}

function tagIsHiddenFromCurrentView(name) {
  return !hiddenContentVisibleInCurrentView() && tagIsEffectivelyHidden(name);
}

// The Tag's folders that are really in the tree, in display order. No media or
// hidden filtering: callers that draw them filter, callers that edit them do not.
function tagMemberDirNodes(name) {
  const tag = normalizeTag(name);
  if (!tag) return [];
  const model = getTagModel();
  const memoKey = `${tag}@@${dirSortDisplayCacheKey()}`;
  const memo = model.memberNodesMemo.get(memoKey);
  if (memo) return memo.slice();
  const out = [];
  for (const path of tagMemberPaths(tag)) {
    if (!tagModelFolderExists(path)) continue;
    const node = WS.dirByPath.get(path);
    if (node) out.push(node);
  }
  const sorted = sortDirCollectionForDisplay(out, `tag-members:${tag}`);
  model.memberNodesMemo.set(memoKey, sorted);
  return sorted.slice();
}

// The card for one Tag, or null when it has nowhere to sit or nothing to show.
function tagEntryForName(name) {
  const tag = normalizeTag(name);
  if (!tag) return null;
  const model = getTagModel();
  const where = model.placementByTag.get(tag);
  if (where == null) return null;
  if (tagIsHiddenFromCurrentView(tag)) return null;
  if (!tagHasUnfilteredContent(tag)) return null;
  const entry = { kind: "tag", tag, label: tag, originPath: where };
  const dirs = filterTagEntryDirsByVisibleRecords(tagMemberDirNodes(tag), entry);
  let childCount = 0;
  for (const child of model.childrenByTag.get(tag) || []) {
    if (model.placementByTag.get(child) == null) continue;
    if (tagIsHiddenFromCurrentView(child) || !tagHasUnfilteredContent(child)) continue;
    childCount++;
  }
  return Object.assign(entry, { count: dirs.length + childCount });
}

// The Tags held by a Tag, as cards -- what opening that Tag lists above its
// folders. Exclusive does not apply here: this is the place they were moved to.
function getChildTagEntriesForTag(name) {
  const out = [];
  for (const child of tagChildNames(name)) {
    const entry = tagEntryForName(child);
    if (entry) out.push(entry);
  }
  return out;
}

// True when `holder` holds `name`, directly or through Tags it holds.
function tagHoldsTransitively(holder, name) {
  const target = normalizeTag(name);
  const start = normalizeTag(holder);
  if (!target || !start) return false;
  const seen = new Set();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const child of tagChildNames(current)) {
      if (child === target) return true;
      stack.push(child);
    }
  }
  return false;
}

/* Putting one Tag in another. Refused when it would make a Tag hold itself,
   directly or round a loop -- placement and hidden state both walk these links
   and a loop has no answer. */
function metaAddTagParent(childName, parentName) {
  const child = normalizeTag(childName);
  const parent = normalizeTag(parentName);
  if (!child || !parent || !WS.meta || !(WS.meta.tagParents instanceof Map))
    return false;
  if (child === parent || tagHoldsTransitively(child, parent)) return false;
  if (tagLockRefusesTag(parent, child)) {
    showStatusMessage(tagLockRefusalMessage(parent));
    return false;
  }
  let parents = WS.meta.tagParents.get(child);
  if (parents && parents.has(parent)) return false;
  if (!parents) {
    parents = new Set();
    WS.meta.tagParents.set(child, parents);
  }
  parents.add(parent);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  // A Tag put in a held Tag is held too, with what it holds: Use anywhere
  // would be a promise its holder's lock no longer lets it keep.
  if (tagIsLocked(parent)) metaSetTagUseAnywhere(child, false);
  return true;
}

function metaRemoveTagParent(childName, parentName) {
  const child = normalizeTag(childName);
  const parent = normalizeTag(parentName);
  if (!child || !parent || !WS.meta || !(WS.meta.tagParents instanceof Map))
    return false;
  const parents = WS.meta.tagParents.get(child);
  if (!parents || !parents.delete(parent)) return false;
  if (!parents.size) WS.meta.tagParents.delete(child);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

/* Where a Tag's content lives, in the library's shape: the Models its Sets
   sit in, and whether it holds a Model itself. Read through the Tags it holds,
   at any depth; trashed and vanished folders do not count. Memoized on the tag
   model, which is rebuilt whenever the tags or the tree change. */
function tagContentModelInfo(name) {
  const tag = normalizeTag(name);
  const model = getTagModel();
  if (!(model.contentModelMemo instanceof Map)) model.contentModelMemo = new Map();
  const memo = model.contentModelMemo.get(tag);
  if (memo) return memo;
  const models = new Set();
  let holdsModels = false;
  let holdsOther = false;
  const seen = new Set();
  const stack = tag ? [tag] : [];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    for (const path of model.membersByTag.get(current) || []) {
      if (isPathInsideInternalTrash(path) || !tagModelFolderExists(path)) continue;
      const parts = String(path).split("/");
      if (parts.length === 1) holdsModels = true;
      else if (parts.length === 2) models.add(parts[0]);
      else holdsOther = true;
    }
    for (const child of model.childrenByTag.get(current) || []) stack.push(child);
  }
  const info = { models, holdsModels, holdsOther };
  model.contentModelMemo.set(tag, info);
  return info;
}

// The one Model a Tag's content is all in, or null (nothing, several Models,
// or a Model itself among it).
function tagSingleContentModelPath(name) {
  const info = tagContentModelInfo(name);
  if (info.holdsModels || info.holdsOther || info.models.size !== 1) return null;
  return Array.from(info.models)[0];
}

/* Where a Tag may be used. Every Tag is held to the place its content is in,
   read off the content and never stored:

   - content all Sets of one Model: the Tag takes Sets from that Model only,
     and is offered only to them. Renaming or moving the Model needs nothing
     re-keyed.
   - content all Models: the Tag takes Models only, and is offered only to
     them.
   - anything else (nothing yet, Sets of several Models, Sets and Models
     mixed): there is no one place to hold to, so anything goes. A new Tag is
     held from the first thing put in it.

   The one switch is Use anywhere (Tag options, off by default, stored as names
   in WS.meta.useAnywhereTags), which lets the Tag take anything from
   anywhere, as every Tag once did. It passes down to the Tags a Tag holds
   (metaSetTagUseAnywhere). A held Tag is also kept to the lock of every Tag
   holding it, at any depth, so a Tag inside a held Tag can never take in
   something that would spill its holder out of its place (tagLockers). Tag
   storage holds Tags from anywhere and is never held. */
function tagUseAnywhereSet() {
  if (!WS.meta) return null;
  if (!(WS.meta.useAnywhereTags instanceof Set)) WS.meta.useAnywhereTags = new Set();
  return WS.meta.useAnywhereTags;
}

function tagUsesAnywhere(name) {
  const tag = normalizeTag(name);
  const set = tagUseAnywhereSet();
  return !!tag && !!set && set.has(tag);
}

// Real Tags only: Tag storage, the utility containers and the special buckets
// have no place to be held to.
function tagCanBeHeld(name) {
  const tag = normalizeTag(name);
  return !!tag && tag !== TAG_STORAGE_NAME && !isInternalTagName(tag);
}

// Content that is Models and nothing else.
function tagContentIsOnlyModels(name) {
  const info = tagContentModelInfo(name);
  return info.holdsModels && !info.holdsOther && info.models.size === 0;
}

// The Tag's own lock: "model" (Sets of one Model), "root" (Models) or "".
function tagLockKind(name) {
  if (!tagCanBeHeld(name) || tagUsesAnywhere(name)) return "";
  if (tagContentIsOnlyModels(name)) return "root";
  if (tagSingleContentModelPath(name) != null) return "model";
  return "";
}

function modelOnlyTagModelPath(name) {
  return tagLockKind(name) === "model" ? tagSingleContentModelPath(name) : null;
}

// The Tags whose lock binds what goes into this one: the Tag itself and every
// Tag holding it, at any depth, nearest first, each only while it has a lock.
function tagLockers(name) {
  const start = normalizeTag(name);
  if (!start) return [];
  const out = [];
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    if (tagLockKind(current)) out.push(current);
    for (const parent of tagParentNames(current)) queue.push(parent);
  }
  return out;
}

function tagIsLocked(name) {
  return tagLockers(name).length > 0;
}

// Sets Use anywhere on a Tag and every Tag it holds, at any depth -- turning
// it on frees them all, turning it off holds them all. Answers how many Tags
// changed (0 when none did).
function metaSetTagUseAnywhere(name, on) {
  const tag = normalizeTag(name);
  const set = tagUseAnywhereSet();
  if (!tagCanBeHeld(tag) || !set) return 0;
  const want = !!on;
  const children = getTagModel().childrenByTag;
  const seen = new Set();
  const stack = [tag];
  let changed = 0;
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    if (tagCanBeHeld(current) && set.has(current) !== want) {
      if (want) set.add(current);
      else set.delete(current);
      changed++;
    }
    stack.push(...(children.get(current) || []));
  }
  if (!changed) return 0;
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return changed;
}

function libraryShapeModelPathOfSet(path) {
  const parts = normalizeDirPathValue(path).split("/");
  return parts.length === 2 && parts[0] && parts[1] ? parts[0] : null;
}

function libraryShapePathIsModel(path) {
  const p = normalizeDirPathValue(path);
  return !!p && !p.includes("/");
}

// Whether one lock refuses these folders: a Models lock takes only Models, a
// Model's lock only Sets of that Model.
function tagLockerRefusesPaths(locker, paths) {
  const kind = tagLockKind(locker);
  if (kind === "root") return paths.some((path) => !libraryShapePathIsModel(path));
  if (kind !== "model") return false;
  const modelPath = tagSingleContentModelPath(locker);
  return paths.some((path) => libraryShapeModelPathOfSet(path) !== modelPath);
}

// Whether a Tag refuses these folders, through its own lock or a holder's.
function tagLockRefusesPaths(name, paths) {
  const list = paths || [];
  if (!list.length) return false;
  return tagLockers(name).some((locker) => tagLockerRefusesPaths(locker, list));
}

// Whether a Tag refuses a Tag being put in it: the held Tag's content must fit
// every lock binding the holder (an empty Tag fits any).
function tagLockRefusesTag(name, childName) {
  const info = tagContentModelInfo(childName);
  return tagLockers(name).some((locker) => {
    const kind = tagLockKind(locker);
    if (kind === "root") return info.holdsOther || info.models.size > 0;
    const modelPath = tagSingleContentModelPath(locker);
    if (info.holdsModels || info.holdsOther) return true;
    return Array.from(info.models).some((m) => m !== modelPath);
  });
}

// What a Tag's own lock lets in, for messages: "Models" or "Sets from <Model>".
function tagLockTakesText(locker) {
  if (tagLockKind(locker) === "root") return "Models";
  const modelPath = tagSingleContentModelPath(locker);
  const node = modelPath ? WS.dirByPath.get(modelPath) : null;
  return `Sets from ${node ? dirDisplayName(node) || modelPath : modelPath || "its Model"}`;
}

function tagLockRefusalMessage(name) {
  const lockers = tagLockers(name);
  const label = tagDisplayName(name);
  if (!lockers.length) return `'${label}' can't take that.`;
  const locker = lockers[0];
  const takes = tagLockTakesText(locker);
  return normalizeTag(locker) === normalizeTag(name)
    ? `'${label}' only takes ${takes}.`
    : `'${label}' is in '${tagDisplayName(locker)}', which only takes ${takes}.`;
}

// The tags a user edit may add to a folder: a locked Tag the folder cannot
// join is dropped, and named in `refused`. Tags the folder already has pass.
function filterLockedTagsForPath(path, tags, refused = null) {
  const have = new Set(metaGetTags(path));
  return (tags || []).filter((tag) => {
    if (have.has(tag) || !tagLockRefusesPaths(tag, [path])) return true;
    if (refused) refused.add(tag);
    return false;
  });
}

function announceTagLockRefusals(refused) {
  const list = Array.from(refused || []);
  if (!list.length) return;
  showStatusMessage(list.map(tagLockRefusalMessage).join(" "));
}

function metaSetTagExclusive(name, exclusive) {
  const tag = normalizeTag(name);
  if (!tag || !WS.meta || !(WS.meta.exclusiveTags instanceof Set)) return false;
  const on = !!exclusive;
  if (WS.meta.exclusiveTags.has(tag) === on) return false;
  if (on) WS.meta.exclusiveTags.add(tag);
  else WS.meta.exclusiveTags.delete(tag);
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return true;
}

/* Renames a Tag everywhere it is named: on every folder, in every Tag-in-Tag
   link, in the Exclusive set, and in every setting keyed by it. Names are
   library-wide, so renaming onto a name that is taken is refused rather than
   merged -- a merge would silently hand one Tag's settings to another. */
function renameTagEverywhere(oldName, newName) {
  const from = normalizeTag(oldName);
  const to = normalizeTag(newName);
  if (!from || !to || from === to) return { ok: false, reason: "unchanged" };
  if (isReservedFolderTag(to) || isInternalTagName(to))
    return { ok: false, reason: "reserved" };
  if (to.includes(",")) return { ok: false, reason: "comma" };
  if (tagNameExists(to)) return { ok: false, reason: "exists" };
  const rewrite = (map) => {
    if (!(map instanceof Map)) return;
    for (const [path, tags] of Array.from(map.entries())) {
      if (!Array.isArray(tags) || !tags.includes(from)) continue;
      map.set(path, normalizeTagList(tags.map((t) => (t === from ? to : t))));
    }
  };
  rewrite(WS.meta.dirTags);
  rewrite(WS.meta.pendingTagsByPath);
  const nextParents = new Map();
  for (const [child, parents] of WS.meta.tagParents.entries()) {
    const nextChild = child === from ? to : child;
    const set = new Set(Array.from(parents).map((p) => (p === from ? to : p)));
    set.delete(nextChild);
    if (set.size) nextParents.set(nextChild, set);
  }
  WS.meta.tagParents = nextParents;
  if (WS.meta.exclusiveTags.delete(from)) WS.meta.exclusiveTags.add(to);
  if (tagUseAnywhereSet().delete(from)) tagUseAnywhereSet().add(to);
  if (WS.meta.contentTags instanceof Map) {
    const nextContent = new Map();
    for (const [key, tags] of WS.meta.contentTags.entries()) {
      nextContent.set(
        key === `tag:${from}` ? `tag:${to}` : key,
        new Set(Array.from(tags).map((t) => (t === from ? to : t))),
      );
    }
    WS.meta.contentTags = nextContent;
  }
  if (
    WS.meta.scoreFilterOverrides instanceof Map &&
    WS.meta.scoreFilterOverrides.has(`tag:${from}`)
  ) {
    WS.meta.scoreFilterOverrides.set(
      `tag:${to}`,
      WS.meta.scoreFilterOverrides.get(`tag:${from}`),
    );
    WS.meta.scoreFilterOverrides.delete(`tag:${from}`);
    bumpScoreFilterRevision();
  }
  const oldKey = tagThumbnailKeyForTag(from);
  const newKey = tagThumbnailKeyForTag(to);
  rekeyTagThumbnailState(oldKey, newKey);
  rekeyTagAppearancePresetState(oldKey, newKey);
  rekeyTagMediaFilterState(oldKey, newKey);
  rekeyHiddenTagState(oldKey, newKey);
  if (WS.view && normalizeTag(WS.view.tagFolderActiveTag || "") === from)
    WS.view.tagFolderActiveTag = to;
  for (const frame of (WS.view && WS.view.tagNavStack) || []) {
    if (!frame) continue;
    if (normalizeTag(frame.tag || "") === from) frame.tag = to;
    if (normalizeTag(frame.entryTag || "") === from) frame.entryTag = to;
    if (normalizeTag(frame.prevTag || "") === from) frame.prevTag = to;
  }
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return { ok: true };
}

/* Deletes a Tag. Nothing it holds is touched: folders simply stop carrying the
   name and held Tags stop being inside it. Its settings go with it. */
function deleteTagEverywhere(name) {
  const tag = normalizeTag(name);
  if (!tag || !WS.meta) return false;
  let changed = false;
  const strip = (map) => {
    if (!(map instanceof Map)) return;
    for (const [path, tags] of Array.from(map.entries())) {
      if (!Array.isArray(tags) || !tags.includes(tag)) continue;
      map.set(path, tags.filter((t) => t !== tag));
      changed = true;
    }
  };
  strip(WS.meta.dirTags);
  strip(WS.meta.pendingTagsByPath);
  if (WS.meta.tagParents.delete(tag)) changed = true;
  for (const [child, parents] of Array.from(WS.meta.tagParents.entries())) {
    if (!parents.delete(tag)) continue;
    changed = true;
    if (!parents.size) WS.meta.tagParents.delete(child);
  }
  if (WS.meta.exclusiveTags.delete(tag)) changed = true;
  if (tagUseAnywhereSet().delete(tag)) changed = true;
  if (WS.meta.contentTags instanceof Map) {
    if (WS.meta.contentTags.delete(`tag:${tag}`)) changed = true;
    for (const [key, tags] of Array.from(WS.meta.contentTags.entries())) {
      if (!tags.delete(tag)) continue;
      changed = true;
      if (!tags.size) WS.meta.contentTags.delete(key);
    }
  }
  if (
    WS.meta.scoreFilterOverrides instanceof Map &&
    WS.meta.scoreFilterOverrides.delete(`tag:${tag}`)
  ) {
    changed = true;
    bumpScoreFilterRevision();
  }
  const key = tagThumbnailKeyForTag(tag);
  const isKey = (candidate) => candidate === key;
  if (clearTagThumbnailStateByMatch(isKey)) changed = true;
  if (clearTagAppearancePresetStateByMatch(isKey)) changed = true;
  if (clearTagMediaFilterStateByMatch(isKey)) changed = true;
  if (clearHiddenTagStateByMatch(isKey)) changed = true;
  metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  invalidateDirMetricsCaches();
  return changed;
}

/* Commas separate Tag names wherever names are typed ("a, b" is two Tags), so
   no Tag may have one in its name (2026-10-25). A library with such names has
   each comma made a space when it opens ("sex, riding" -> "sex riding"),
   through renameTagEverywhere so every setting follows; a name that would
   clash with an existing Tag gets " 2", " 3". Answers how many were renamed. */
function tagNameWithoutCommas(name) {
  return normalizeTag(String(name || "").replace(/,/g, " ").replace(/\s+/g, " "));
}

function metaRemoveCommasFromTagNames() {
  if (!WS.meta) return 0;
  const names = Array.from(getTagModel().names).filter((name) => String(name).includes(","));
  let renamed = 0;
  for (const name of names) {
    const base = tagNameWithoutCommas(name);
    if (!base) continue;
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? base : `${base} ${n}`;
      if (renameTagEverywhere(name, candidate).ok) {
        renamed++;
        // The next name's clash check reads the tag model.
        clearTagEntryDerivedCaches();
        break;
      }
    }
  }
  return renamed;
}
