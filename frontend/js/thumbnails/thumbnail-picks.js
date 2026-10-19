/* Thumbnail picks
   Setting a container's thumbnail, the Thumbnail menus, Random and bulk
   thumbnails. */

function folderEligibleForParentThumbnailPreset(dirNode) {
  if (!dirNode || isStorageStubDirNode(dirNode)) return false;
  const dirPath = String(dirNode.path || "");
  return !!dirPath || dirNode === WS.root;
}

function getDisplayLeadPreviewForDir(dirNode, rotateKeyPrefix = "dir") {
  if (!dirNode) return { record: null, rotateKey: "" };
  if (dirNode.isMissingPlaceholder) return { record: null, rotateKey: "" };
  const dirPath = String(dirNode.path || "");
  const thumbMode = metaGetFolderThumbnailMode(dirPath);
  if (thumbMode === "none") return { record: null, rotateKey: "" };
  const presetRec = getPresetPreviewRecordForDir(dirNode);
  if (presetRec) return { record: presetRec, rotateKey: "" };
  if (!dirPath && dirNode !== WS.root) return { record: null, rotateKey: "" };
  // Keep the resolved-thumbnail cache distinct per active tag content filter so a
  // pick made under one filter (or with none) can't leak filtered-out media into
  // a tag view (or vice versa).
  const contextualFilter = contextualTagMediaFilterForDirPath(dirPath);
  const claimContext = exclusiveFileClaimContextKey(dirPath);
  const scope =
    (dirPath || "__root__") +
    (contextualFilter.length ? `@@ctx:${contextualFilter.join(",")}` : "") +
    (claimContext ? `@@held:${claimContext}` : "");
  // Rotate mode intentionally varies its pick, so it is never cached; every
  // other mode resolves to a stable file we can remember per folder + filter so
  // repeated grid renders during navigation skip the recursive subtree walk.
  const cacheable = thumbMode !== "rotate";
  if (cacheable) {
    const cachedId = getCachedThumbTargetId(scope);
    if (cachedId !== undefined) {
      const cachedRec = cachedId ? WS.fileById.get(cachedId) || null : null;
      if (cachedRec || cachedId === "") {
        return { record: cachedRec, rotateKey: "" };
      }
    }
  }
  const recursivePool = getRecursivePreviewRecordsForDir(dirNode, 72, true);
  const directRec = getFirstDirectPreviewRecordForDir(dirNode);
  if (naturalAspectThumbnailCardsEnabled()) {
    const rec = directRec || recursivePool[0] || null;
    if (cacheable) setCachedThumbTargetId(scope, rec ? rec.id : "");
    return { record: rec, rotateKey: "" };
  }
  if (thumbMode === "rotate" && recursivePool.length > 1) {
    const rotateKey = `${String(rotateKeyPrefix || "dir")}:${scope}`;
    const record = pickRotatingPreviewRecordForKey(rotateKey, recursivePool);
    return { record: record || recursivePool[0] || null, rotateKey };
  }
  const rec = directRec || recursivePool[0] || null;
  if (cacheable) setCachedThumbTargetId(scope, rec ? rec.id : "");
  return { record: rec, rotateKey: "" };
}

function findNearestPresettableParentForRecord(rec) {
  if (!rec) return null;
  const startNode = WS.dirByPath.get(String(rec.dirPath || ""));
  let cur = startNode && startNode.parent ? startNode.parent : null;
  while (cur) {
    if (folderEligibleForParentThumbnailPreset(cur)) return cur;
    cur = cur.parent || null;
  }
  return null;
}

function setFolderThumbnailTargetFromRecord(rec, targetPath) {
  const normalizedPath = normalizeDirPathValue(targetPath);
  if (!normalizedPath) return setRootThumbnailFromRecord(rec);
  const folderNode = WS.dirByPath.get(normalizedPath);
  if (!folderNode) {
    showStatusMessage("Target folder is unavailable.");
    return false;
  }
  const relPath =
    altCanonicalThumbKeyForRecord(rec) ||
    normalizeWorkspaceRelPath(rec && rec.relPath);
  if (!relPath) {
    showStatusMessage("Selected file is unavailable.");
    return false;
  }
  const changed = metaSetFolderThumbnailPreset(normalizedPath, relPath);
  if (!changed) {
    showStatusMessage(`Thumbnail already set for ${dirDisplayName(folderNode)}.`);
    return false;
  }
  refreshThumbnailUiAfterMetadataChange();
  showStatusMessage(`Set thumbnail for ${dirDisplayName(folderNode)}.`);
  return true;
}

function setParentThumbnailFromRecord(rec) {
  const targetNode = findNearestPresettableParentForRecord(rec);
  if (!targetNode) {
    showStatusMessage("No eligible parent folder found.");
    return false;
  }
  return setFolderThumbnailTargetFromRecord(rec, String(targetNode.path || ""));
}

function setFolderThumbnailFromRecord(rec) {
  const folderPath = String(rec && rec.dirPath || "");
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
  const relPath = normalizeWorkspaceRelPath(rec && rec.relPath || "");
  if (!relPath) {
    showStatusMessage("Selected file is unavailable.");
    return false;
  }
  const changed = metaSetTagThumbnailPresetByKey(rootThumbnailKey(), relPath);
  if (!changed) {
    showStatusMessage("Root thumbnail is already set to this file.");
    return false;
  }
  refreshThumbnailUiAfterMetadataChange();
  showStatusMessage("Set thumbnail for root.");
  return true;
}

function getRootThumbnailMode() {
  return metaGetTagThumbnailModeByKey(rootThumbnailKey());
}

function isRootThumbnailModeDefault(mode) {
  return String(mode || "") === defaultRotatingThumbnailMode();
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
  return resetTagThumbnailToDefaultByKey(rootThumbnailKey());
}

function clearEditedThumbnailCrops() {
  if (!WS.meta) return 0;
  const cropCount = WS.meta.fileThumbCrop ? WS.meta.fileThumbCrop.size : 0;
  const frameCount = WS.meta.videoThumbTime ? WS.meta.videoThumbTime.size : 0;
  const count = cropCount + frameCount;
  if (!count) return 0;
  if (WS.meta.fileThumbCrop) WS.meta.fileThumbCrop.clear();
  if (WS.meta.videoThumbTime) WS.meta.videoThumbTime.clear();
  metaMarkDirty(META_DOC_IDS.thumbnails);
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
  if (count) metaMarkDirty(META_DOC_IDS.thumbnails);
  return count;
}

function clearAllThumbnailCustomizations() {
  const cropCount = clearEditedThumbnailCrops();
  const assignmentCount = clearThumbnailAssignmentsToDefaults();
  return {
    cropCount,
    assignmentCount,
    total: cropCount + assignmentCount,
  };
}

async function hydrateEditedThumbnailAspects() {
  if (!WS.meta || !WS.meta.fileThumbCrop || !WS.meta.fileThumbCrop.size)
    return false;
  const records = [];
  const seen = new Set();
  for (const relPath of WS.meta.fileThumbCrop.keys()) {
    const rec = findFileRecordByRelPath(relPath);
    const id = String(rec && rec.id || "");
    if (!rec || !id || seen.has(id)) continue;
    seen.add(id);
    records.push(rec);
  }
  let changed = false;
  for (let i = 0; i < records.length; i++) {
    const aspect = await detectRecordPreviewAspect(records[i]);
    if (aspect && setRecordAspectRatio(records[i], aspect)) changed = true;
  }
  return changed;
}

function getThumbnailMenuTargetsForRecord(rec) {
  if (!rec) return [];
  const startNode =
    WS.dirByPath.get(String(rec.dirPath || "")) || WS.root || null;
  return thumbnailMenuTargetsFromFolder(startNode, { includeStartFolder: true });
}

// Every place above a folder whose thumbnail a picture from inside it can be:
// the folder itself (for a file's menu), each folder up to the root, the Tags
// those folders are in and the Tags that hold those Tags, and Favorites.
// `skipTagKeys` keeps a Tag out of its own list.
function thumbnailMenuTargetsFromFolder(startNode, opts = {}) {
  const out = [];
  const seenFolders = new Set();
  const seenTags = new Set(opts.skipTagKeys || []);
  const pushHeldByTags = (tag) => {
    const queue = tagParentNames(tag);
    for (let i = 0; i < queue.length; i++) {
      const parent = normalizeTag(queue[i] || "");
      const key = parent ? tagThumbnailKeyForTag(parent) : "";
      if (!key || seenTags.has(key)) continue;
      seenTags.add(key);
      out.push({
        action: tagThumbnailActionForKey(key),
        label: `Set '${tagDisplayName(parent)}' thumbnail`,
      });
      queue.push(...tagParentNames(parent));
    }
  };
  let cur = startNode || null;
  while (cur) {
    const folderPath = String(cur.path || "");
    const isStart = cur === startNode;
    // The root is never seen from outside, so it is never offered a picture.
    if (
      folderPath &&
      !seenFolders.has(folderPath) &&
      (!isStart || opts.includeStartFolder)
    ) {
      seenFolders.add(folderPath);
      const folderLabel = thumbnailMenuFolderLabel(cur);
      out.push({
        action: folderThumbnailActionForPath(folderPath),
        label: `Set '${folderLabel}' thumbnail`,
      });
    }

    const scopeNode = cur.parent || WS.root || null;
    const scopePath = String(scopeNode && scopeNode.path || "");
    const scopeLabel = thumbnailMenuScopeLabel(scopeNode);
    // A folder in a Tag through a contents rule is in it as surely as one
    // tagged by hand.
    const tags = folderPath
      ? metaGetUserTags(folderPath).concat(contentTagsForDirPath(folderPath))
      : [];
    for (let i = 0; i < tags.length; i++) {
      const tag = normalizeTag(tags[i] || "");
      if (!tag) continue;
      const key = tagThumbnailKeyForTag(tag, scopePath);
      if (key && !seenTags.has(key)) {
        seenTags.add(key);
        out.push({
          action: tagThumbnailActionForKey(key),
          label: `Set '${tag}' thumbnail in ${scopeLabel}`,
        });
      }
      pushHeldByTags(tag);
      const album = metaGetTagAlbumForTag(tag, scopePath);
      const albumKey = tagThumbnailKeyForAlbum(album, scopePath);
      if (album && albumKey && !seenTags.has(albumKey)) {
        seenTags.add(albumKey);
        out.push({
          action: tagThumbnailActionForKey(albumKey),
          label: `Set album '${album}' thumbnail in ${scopeLabel}`,
        });
      }
    }

    if (folderPath && metaHasFavorite(folderPath)) {
      const scopeKey = tagThumbnailScopeKeyFromPath(scopePath);
      const key = `special:favorites:${scopeKey}`;
      if (!seenTags.has(key)) {
        seenTags.add(key);
        out.push({
          action: tagThumbnailActionForKey(key),
          label: `Set favorites thumbnail in ${scopeLabel}`,
        });
      }
    }

    cur = cur.parent || null;
  }
  return out;
}

// The rows under a container's own Thumbnail tab: every place above it, each
// of which takes the picture the container is showing right now.
function thumbnailMenuTargetsForDirNode(dirNode) {
  if (!dirNode || dirNode === WS.root || dirNode.isMissingPlaceholder) return [];
  if (isStorageStubDirNode(dirNode)) return [];
  const p = String(dirNode.path || "");
  if (!p || metaHasStorage(p) || isPathInsideInternalTrash(p)) return [];
  return thumbnailMenuTargetsFromFolder(dirNode, { includeStartFolder: false });
}

function thumbnailMenuTargetsForTagEntry(entry, tagKey) {
  if (!entry || entry.kind !== "tag" || entry.placeholder) return [];
  if (entry.special === "storage") return [];
  const tag = normalizeTag(entry.tag || "");
  if (isViewOnlyTagName(tag)) return [];
  const key = String(tagKey || tagThumbnailKeyForEntry(entry) || "");
  // A real Tag hangs off the folder it is placed in; a special bucket off the
  // folder it was opened in.
  const placePath =
    tag && !entry.special
      ? tagPlacementPath(tag)
      : String(entry.originPath != null ? entry.originPath : "");
  const placeNode =
    placePath == null
      ? null
      : placePath
        ? WS.dirByPath.get(normalizeDirPathValue(placePath)) || null
        : WS.root || null;
  const out = [];
  const seen = new Set(key ? [key] : []);
  if (tag && !entry.special) {
    const queue = tagParentNames(tag);
    for (let i = 0; i < queue.length; i++) {
      const parent = normalizeTag(queue[i] || "");
      const parentKey = parent ? tagThumbnailKeyForTag(parent) : "";
      if (!parentKey || seen.has(parentKey)) continue;
      seen.add(parentKey);
      out.push({
        action: tagThumbnailActionForKey(parentKey),
        label: `Set '${tagDisplayName(parent)}' thumbnail`,
      });
      queue.push(...tagParentNames(parent));
    }
  }
  if (placeNode) {
    out.push(
      ...thumbnailMenuTargetsFromFolder(placeNode, {
        includeStartFolder: true,
        skipTagKeys: Array.from(seen),
      }),
    );
  }
  return out;
}

// The picture a container is showing right now. The card on screen wins, since
// under Shuffle that is the only place the current pick is written down.
function currentThumbnailRecordForDirNode(dirNode) {
  if (!dirNode) return null;
  const path = String(dirNode.path || "");
  const cards = previewBodyEl
    ? previewBodyEl.querySelectorAll('[data-preview-item-kind="dir"]')
    : [];
  for (const card of cards) {
    if (previewDirPathForCard(card) !== path) continue;
    const id = String(
      card.querySelector("[data-dir-preview-id]")?.dataset?.dirPreviewId || "",
    );
    const rec = id ? WS.fileById.get(id) || null : null;
    if (rec) return rec;
  }
  const leadInfo = getDisplayLeadPreviewForDir(dirNode, "dir");
  return leadInfo && leadInfo.record ? leadInfo.record : null;
}

function currentThumbnailRecordForTagEntry(entry) {
  if (!entry || entry.kind !== "tag") return null;
  const key = tagThumbnailKeyForEntry(entry);
  const cards = previewBodyEl
    ? previewBodyEl.querySelectorAll('[data-preview-item-kind="tag"]')
    : [];
  for (const card of cards) {
    const cardEntry = card.__previewTagEntry || null;
    if (!cardEntry || tagThumbnailKeyForEntry(cardEntry) !== key) continue;
    const id = String(
      card.querySelector("[data-dir-preview-id]")?.dataset?.dirPreviewId || "",
    );
    const rec = id ? WS.fileById.get(id) || null : null;
    if (rec) return rec;
  }
  return getTagThumbnailReferenceRecord(entry);
}

// Hands a container's current picture to a place above it. Returns false when
// the action is not one of these.
function applyContainerThumbnailToTarget(action, rec) {
  const folderTarget = parseFolderThumbnailAction(action);
  const tagTarget = folderTarget === null ? parseTagThumbnailAction(action) : "";
  if (folderTarget === null && !tagTarget) return false;
  if (!rec) {
    showStatusMessage("This item has no thumbnail to use.");
    return true;
  }
  if (folderTarget !== null) setFolderThumbnailTargetFromRecord(rec, folderTarget);
  else setTagThumbnailFromRecordByKey(rec, tagTarget);
  return true;
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
  refreshThumbnailUiAfterMetadataChange();
  showStatusMessage(`Set thumbnail for '${tagLabel}'.`);
  return true;
}

function refreshThumbnailUiAfterMetadataChange() {
  clearPreviewThumbTargetCache();
  renderDirectoriesPane(true);
  renderPreviewPane(false, true);
  syncButtons();
  kickVideoThumbsForPreview();
  kickImageThumbsForPreview();
}

function recordCanBeFolderRandomThumbnail(rec, dirNode) {
  return !!(
    rec &&
    dirNode &&
    isRecordInDirSubtree(rec, dirNode) &&
    passesFilter(rec) &&
    recordPassesFolderMediaFilterForDir(rec, dirNode) &&
    recordPassesContextualTagMediaFilterForDir(rec, dirNode)
  );
}

function firstRecursiveThumbnailCandidateForDirNode(dirNode) {
  if (!dirNode || isStorageStubDirNode(dirNode)) return null;
  const dirPath = String(dirNode.path || "");
  if (!dirPath && dirNode !== WS.root) return null;
  const queue = [dirNode];
  for (let q = 0; q < queue.length; q++) {
    const cur = queue[q];
    if (!cur) continue;
    const ids = getOrderedFileIdsForDir(cur, false);
    for (let i = 0; i < ids.length; i++) {
      const rec = WS.fileById.get(String(ids[i] || ""));
      if (recordCanBeFolderRandomThumbnail(rec, dirNode)) return rec;
    }
    const kids = getChildDirsForNode(cur);
    for (let i = 0; i < kids.length; i++) queue.push(kids[i]);
  }
  return null;
}

function firstRecursiveThumbnailCandidateForTagEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.placeholder) return null;
  const key = tagThumbnailKeyForEntry(entry);
  if (!key) return null;
  const dirs = getThumbnailSourceDirsForTagEntry(entry);
  for (let d = 0; d < dirs.length; d++) {
    const root = dirs[d];
    const queue = [root];
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q];
      if (!cur) continue;
      const ids = getOrderedFileIdsForDir(cur, false);
      for (let i = 0; i < ids.length; i++) {
        const rec = WS.fileById.get(String(ids[i] || ""));
        if (recordPassesTagEntryFilter(rec, entry)) return rec;
      }
      const kids = getChildDirsForNode(cur);
      for (let i = 0; i < kids.length; i++) queue.push(kids[i]);
    }
  }
  return null;
}

function randomThumbnailCandidateForDirNode(dirNode) {
  if (!dirNode || isStorageStubDirNode(dirNode)) return null;
  const dirPath = String(dirNode.path || "");
  if (!dirPath && dirNode !== WS.root) return null;
  const pool = getRecursivePreviewRecordsForDir(dirNode, 0, true).filter(
    (rec) => recordCanBeFolderRandomThumbnail(rec, dirNode),
  );
  return pickRandomPreviewRecord(pool);
}

function randomThumbnailCandidateForTagEntry(entry) {
  if (!entry || entry.kind !== "tag" || entry.placeholder) return null;
  const key = tagThumbnailKeyForEntry(entry);
  if (!key) return null;
  const pool = getRecursivePreviewRecordsForTagEntry(entry, 0);
  return pickRandomPreviewRecord(pool);
}

function setRandomFolderThumbnailForNode(dirNode) {
  if (!dirNode) return false;
  const rec = randomThumbnailCandidateForDirNode(dirNode);
  if (!rec) {
    showStatusMessage("No recursive file found for thumbnail.");
    return false;
  }
  const relPath = normalizeWorkspaceRelPath(rec.relPath || "");
  if (!relPath) {
    showStatusMessage("Selected thumbnail source is unavailable.");
    return false;
  }
  const dirPath = String(dirNode.path || "");
  const changed =
    !dirPath && dirNode === WS.root
      ? metaSetTagThumbnailPresetByKey(rootThumbnailKey(), relPath)
      : metaSetFolderThumbnailPreset(dirPath, relPath);
  if (!changed) {
    showStatusMessage("Random thumbnail picked the current thumbnail.");
    return false;
  }
  refreshThumbnailUiAfterMetadataChange();
  showStatusMessage(
    dirNode === WS.root
      ? "Root thumbnail set to random file."
      : "Folder thumbnail set to random file.",
  );
  return true;
}

function setRandomTagThumbnailForEntry(entry) {
  const key = tagThumbnailKeyForEntry(entry);
  if (!key) return false;
  const rec = randomThumbnailCandidateForTagEntry(entry);
  if (!rec) {
    showStatusMessage("No recursive file found for thumbnail.");
    return false;
  }
  const relPath = normalizeWorkspaceRelPath(rec.relPath || "");
  if (!relPath) {
    showStatusMessage("Selected thumbnail source is unavailable.");
    return false;
  }
  const changed = metaSetTagThumbnailPresetByKey(key, relPath);
  if (!changed) {
    showStatusMessage("Random thumbnail picked the current thumbnail.");
    return false;
  }
  refreshThumbnailUiAfterMetadataChange();
  showStatusMessage(`Set random thumbnail for '${tagThumbnailLabelForKey(key)}'.`);
  return true;
}

function bulkThumbnailTargetsFromSelection(dirPaths = [], tagEntries = []) {
  const out = [];
  const seen = new Set();
  const paths = Array.isArray(dirPaths) ? dirPaths : [];
  for (let i = 0; i < paths.length; i++) {
    const path = normalizeDirPathValue(paths[i]);
    // The root is left out: it is never seen from outside, so it has no
    // thumbnail to set.
    if (!path) continue;
    const node = resolveDirNodeForPathOrStorageStub(path);
    if (!node || node === WS.root || isStorageStubDirNode(node)) continue;
    const key = `dir:${path || "__root__"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "dir", node, path });
  }
  const entries = Array.isArray(tagEntries) ? tagEntries : [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || entry.kind !== "tag" || entry.placeholder) continue;
    const tagKey = tagThumbnailKeyForEntry(entry);
    if (!tagKey) continue;
    const key = `tag:${tagKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind: "tag", entry, tagKey });
  }
  return out;
}

function bulkThumbnailTargetMode(target) {
  if (!target) return "";
  if (target.kind === "dir") {
    if (!target.path && target.node === WS.root) return getRootThumbnailMode();
    return metaGetFolderThumbnailMode(target.path);
  }
  if (target.kind === "tag") return metaGetTagThumbnailModeByKey(target.tagKey);
  return "";
}

function bulkThumbnailTargetHasCustom(target) {
  if (!target) return false;
  if (target.kind === "dir") {
    if (!target.path && target.node === WS.root) {
      return rootThumbnailHasPreset() || !isRootThumbnailModeDefault(getRootThumbnailMode());
    }
    return (
      metaHasFolderThumbnailPreset(target.path) ||
      metaGetFolderThumbnailMode(target.path) !== inferFolderThumbnailDefaultMode(target.path)
    );
  }
  if (target.kind === "tag") {
    return (
      metaHasTagThumbnailPresetByKey(target.tagKey) ||
      metaGetTagThumbnailModeByKey(target.tagKey) !== defaultRotatingThumbnailMode()
    );
  }
  return false;
}

function bulkThumbnailTargetRandomCandidate(target) {
  if (!target) return null;
  if (target.kind === "dir") return randomThumbnailCandidateForDirNode(target.node);
  if (target.kind === "tag") return randomThumbnailCandidateForTagEntry(target.entry);
  return null;
}

function bulkThumbnailTargetHasRandomCandidate(target) {
  if (!target) return false;
  if (target.kind === "dir")
    return !!firstRecursiveThumbnailCandidateForDirNode(target.node);
  if (target.kind === "tag")
    return !!firstRecursiveThumbnailCandidateForTagEntry(target.entry);
  return false;
}

function bulkThumbnailActionAvailability(targets) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!list.length) {
    return { default: false, random: false, rotate: false, none: false };
  }
  const allFolderOrTag = list.every(
    (target) => target.kind === "dir" || target.kind === "tag",
  );
  if (!allFolderOrTag) {
    return { default: false, random: false, rotate: false, none: false };
  }
  return {
    default: list.some((target) => bulkThumbnailTargetHasCustom(target)),
    random: list.every((target) => bulkThumbnailTargetHasRandomCandidate(target)),
    rotate: list.some((target) => bulkThumbnailTargetMode(target) !== "rotate"),
    none: list.some((target) => bulkThumbnailTargetMode(target) !== "none"),
  };
}

function applyBulkThumbnailAction(targets, action) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const op = String(action || "");
  if (!list.length || !op) return false;
  let changed = false;
  let changedCount = 0;
  const mark = (didChange) => {
    if (didChange) {
      changed = true;
      changedCount++;
    }
  };
  for (let i = 0; i < list.length; i++) {
    const target = list[i];
    if (!target) continue;
    if (target.kind === "dir") {
      const isRootTarget = !target.path && target.node === WS.root;
      if (op === "default") {
        mark(isRootTarget ? resetRootThumbnailToDefault() : metaClearFolderThumbnailPreset(target.path));
      } else if (op === "none") {
        mark(isRootTarget ? setRootThumbnailMode("none") : metaSetFolderThumbnailNone(target.path));
      } else if (op === "rotate") {
        mark(isRootTarget ? metaSetTagThumbnailRotateByKey(rootThumbnailKey()) : metaSetFolderThumbnailRotate(target.path));
      } else if (op === "random") {
        const rec = bulkThumbnailTargetRandomCandidate(target);
        const relPath = normalizeWorkspaceRelPath(rec && rec.relPath || "");
        if (!relPath) continue;
        mark(
          isRootTarget
            ? metaSetTagThumbnailPresetByKey(rootThumbnailKey(), relPath)
            : metaSetFolderThumbnailPreset(target.path, relPath),
        );
      }
    } else if (target.kind === "tag") {
      if (op === "default") {
        mark(resetTagThumbnailToDefaultByKey(target.tagKey));
      } else if (op === "none") {
        mark(metaSetTagThumbnailModeByKey(target.tagKey, "none"));
      } else if (op === "rotate") {
        mark(metaSetTagThumbnailRotateByKey(target.tagKey));
      } else if (op === "random") {
        const rec = bulkThumbnailTargetRandomCandidate(target);
        const relPath = normalizeWorkspaceRelPath(rec && rec.relPath || "");
        if (!relPath) continue;
        mark(metaSetTagThumbnailPresetByKey(target.tagKey, relPath));
      }
    }
  }
  if (!changed) {
    showStatusMessage("No thumbnails changed.");
    return false;
  }
  refreshThumbnailUiAfterMetadataChange();
  const actionLabel =
    op === "default"
      ? "reset"
      : op === "none"
        ? "blanked"
        : op === "rotate"
          ? "set to shuffle"
          : "set to random files";
  showStatusMessage(
    `Thumbnail ${actionLabel} for ${changedCount} item${changedCount === 1 ? "" : "s"}.`,
  );
  return true;
}

function createBulkThumbnailSubmenu(targets, opts = null) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  if (!list.length) return null;
  const availability = bulkThumbnailActionAvailability(list);
  const options = opts && typeof opts === "object" ? opts : {};
  const makeBtn = (label, action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.setAttribute("data-action", `bulk-thumbnail-${action}`);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (typeof options.closeMenus === "function") options.closeMenus();
      const applied = applyBulkThumbnailAction(list, action);
      if (applied && options.finalize !== false) finalizeBulkSelectionAction();
    });
    return btn;
  };
  const buttons = [];
  if (availability.default) buttons.push(makeBtn("Default", "default"));
  if (availability.random) buttons.push(makeBtn("Random", "random"));
  if (availability.rotate) buttons.push(makeBtn("Shuffle", "rotate"));
  if (availability.none) buttons.push(makeBtn("Blank", "none"));
  return createDropdownMenuSubmenu("Thumbnail", buttons);
}

// The folders a Tag's card may take pictures from: what it shows (its own
// folders) plus, for a regular Tag, the folders of every Tag it holds at any
// depth -- filtered exactly as those Tags' own cards would be.
function getThumbnailSourceDirsForTagEntry(entry, ancestry = null) {
  const own = getDirsForTagEntry(entry);
  if (!entry || entry.kind !== "tag" || entry.special) return own;
  const tag = normalizeTag(entry.tag || "");
  if (!tag) return own;
  const visited = ancestry instanceof Set ? ancestry : new Set();
  if (visited.has(tag)) return [];
  visited.add(tag);
  const out = own.slice();
  const seen = new Set(out.map((node) => String(node?.path || "")));
  for (const child of tagChildNames(tag)) {
    if (tagIsHiddenFromCurrentView(child)) continue;
    const childEntry = {
      kind: "tag",
      tag: child,
      label: child,
      originPath: tagPlacementPath(child) || "",
    };
    for (const node of getThumbnailSourceDirsForTagEntry(childEntry, visited)) {
      const path = String(node?.path || "");
      if (!path || seen.has(path)) continue;
      seen.add(path);
      out.push(node);
    }
  }
  return out;
}

function getRecursivePreviewRecordsForTagEntry(entry, limit = 96) {
  const normalizedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const cacheKey =
    entry && entry.kind === "tag"
      ? `${String(tagEntrySelectionKey(entry) || "")}@@${String(
          entry.originPath || "",
        )}@@${effectiveFilterCacheKey()}@@${String(
          effectiveTagMediaFilterForEntry(entry).join(","),
        )}@@${String(normalizedLimit)}`
      : "";
  if (cacheKey && TAG_ENTRY_PREVIEW_POOL_CACHE.has(cacheKey)) {
    return TAG_ENTRY_PREVIEW_POOL_CACHE.get(cacheKey) || [];
  }
  const dirs = getThumbnailSourceDirsForTagEntry(entry);
  if (!dirs.length) return [];
  const result = sampleRecursivePreviewRecords(dirs, normalizedLimit, true).filter(
    (rec) => recordPassesTagEntryFilter(rec, entry),
  );
  if (cacheKey) TAG_ENTRY_PREVIEW_POOL_CACHE.set(cacheKey, result);
  return result;
}

function getTagPresetPreviewRecordForEntry(entry, tagPool = null) {
  const key = tagThumbnailKeyForEntry(entry);
  if (!key || getTagThumbnailDisplayModeByKey(key) !== "single") return null;
  const relPath = metaGetTagThumbnailPresetRelPathByKey(key);
  if (!relPath) return null;
  const rec = findFileRecordByRelPath(relPath);
  if (!rec || !recordPassesTagEntryFilter(rec, entry)) return null;
  const dirs = getThumbnailSourceDirsForTagEntry(entry);
  if (!dirs.length || !isRecordInAnyDirSubtree(rec, dirs)) return null;
  return rec;
}

function tagThumbnailPreviewSampleLimit(modeRaw) {
  const mode = String(modeRaw || "").trim().toLowerCase();
  if (mode === "none") return 0;
  return mode === "rotate" ? 48 : 24;
}

function getRootThumbnailReferenceRecord(rootNode) {
  if (!rootNode) return null;
  const rootPool = getRecursivePreviewRecordsForDir(rootNode, 96, true);
  if (!rootPool.length || getRootThumbnailMode() === "none") return null;
  const presetRec = getRootPresetPreviewRecord(rootNode, rootPool);
  return presetRec || rootPool[0] || null;
}

function getTagThumbnailReferenceRecord(entry) {
  if (!entry || entry.kind !== "tag" || entry.placeholder) return null;
  const key = tagThumbnailKeyForEntry(entry);
  if (!key || metaGetTagThumbnailModeByKey(key) === "none") return null;
  const presetRec = getTagPresetPreviewRecordForEntry(entry);
  if (presetRec) return presetRec;
  const tagPool = getRecursivePreviewRecordsForTagEntry(
    entry,
    tagThumbnailPreviewSampleLimit(metaGetTagThumbnailModeByKey(key)),
  );
  return tagPool[0] || null;
}

function getSelectedThumbnailSourceRecordFromUi() {
  const resolveFromContainer = (container) => {
    if (!container || !container.querySelector) return null;
    const selected = container.querySelector(".previewSelected, .dirRow.selected");
    if (!selected || !selected.querySelector) return null;
    const selectedFileId = String(
      selected.dataset?.fileId ||
        selected.querySelector("[data-file-id]")?.dataset?.fileId ||
        "",
    );
    if (selectedFileId) {
      const selectedFile = WS.fileById.get(selectedFileId) || null;
      if (selectedFile) return selectedFile;
    }
    const img = selected.querySelector("[data-dir-preview-id]");
    const recId = String(
      (img && img.dataset && img.dataset.dirPreviewId) || "",
    );
    return recId ? WS.fileById.get(recId) || null : null;
  };
  return resolveFromContainer(previewBodyEl) || resolveFromContainer(directoriesListEl);
}

function getSelectedPreviewThumbnailSourceRecord() {
  const previewOwnsSelection =
    !directoriesPaneOpenEnabled() || WS.view?.activePane === "preview";
  if (!previewOwnsSelection) return null;
  if (WS.preview?.kind === "file" && WS.preview.fileId) {
    return WS.fileById.get(String(WS.preview.fileId)) || null;
  }
  const card = findSelectedPreviewCard();
  if (!card) return null;
  const kind = String(card.dataset?.previewItemKind || "");
  const displayedPreviewId = String(
    card.querySelector?.("[data-dir-preview-id]")?.dataset?.dirPreviewId || "",
  );
  if (displayedPreviewId) {
    const displayedRecord = WS.fileById.get(displayedPreviewId) || null;
    if (displayedRecord) return displayedRecord;
  }
  if (kind === "file") {
    const fileId = previewFileIdForCard(card);
    return fileId ? WS.fileById.get(fileId) || null : null;
  }
  if (kind === "tag") {
    return getTagThumbnailReferenceRecord(card.__previewTagEntry || null);
  }
  if (kind !== "dir") return null;
  const path = previewDirPathForCard(card);
  const node = WS.dirByPath.get(String(path || "")) ||
    (!path ? WS.root : null);
  if (!node) return null;
  if (node === WS.root && WS.view?.aboveRootView)
    return getRootThumbnailReferenceRecord(node);
  const leadInfo = getDisplayLeadPreviewForDir(node, "dir");
  return leadInfo && leadInfo.record ? leadInfo.record : null;
}

function getSelectedThumbnailSourceRecord() {
  if (!WS.root || !WS.nav || !Array.isArray(WS.nav.entries)) return null;
  const previewRec = getSelectedPreviewThumbnailSourceRecord();
  if (previewRec) return previewRec;
  const uiRec = getSelectedThumbnailSourceRecordFromUi();
  if (uiRec) return uiRec;
  const entry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (!entry) return null;
  if (entry.kind === "file") return WS.fileById.get(String(entry.id || "")) || null;
  if (entry.kind === "tag") return getTagThumbnailReferenceRecord(entry);
  if (entry.kind === "dir") {
    const node = entry.node || null;
    if (!node) return null;
    if (node === WS.root && WS.view && WS.view.aboveRootView)
      return getRootThumbnailReferenceRecord(node);
    const leadInfo = getDisplayLeadPreviewForDir(node, "dir");
    return leadInfo && leadInfo.record ? leadInfo.record : null;
  }
  return null;
}

function getSelectedEditableThumbnailSourceRecord() {
  const rec = getSelectedThumbnailSourceRecord();
  return rec && (rec.type === "image" || rec.type === "video") ? rec : null;
}
