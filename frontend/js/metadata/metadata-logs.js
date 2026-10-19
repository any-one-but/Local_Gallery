/* Metadata logs
   Building each .local-gallery document from memory and applying the older log
   formats. */

function metaMakeOptionsLogObject() {
  return {
    schema: 2,
    updatedAt: Date.now(),
    options: normalizeOptions(WS.meta.options || null),
    appearancePresets: normalizeAppearancePresetList(
      WS.meta && Array.isArray(WS.meta.appearancePresets)
        ? WS.meta.appearancePresets
        : null,
    ),
  };
}

function metaMakeKeybindsLogObject() {
  const bindings = Array.isArray(WS.meta.keybinds)
    ? syncPaneKeybindBindingsWithCurrentActions(false)
    : defaultKeybinds(WS.meta && WS.meta.appearancePresets);
  const gridBindings = Array.isArray(WS.meta.gridKeybinds)
    ? WS.meta.gridKeybinds
    : defaultGridKeybinds();
  return {
    schema: 1,
    updatedAt: Date.now(),
    bindings: bindings.map((b) => ({ id: b.id, key: b.key || "" })),
    gridBindings: gridBindings.map((b) => ({ id: b.id, key: b.key || "" })),
  };
}

function metaApplyScoresLog(log) {
  if (!log || typeof log !== "object") return;

  const sortMode = normalizeDirSortMode(log.sortMode);
  WS.meta.dirSortMode = sortMode;
  WS.meta.scoreHistory = normalizeScoreHistoryList(log.scoreHistory || []);

  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  const oldByPath = new Map();
  const oldByFp = new Map();

  for (const p of Object.keys(folders)) {
    const it = folders[p];
    const sc = it && Number.isFinite(it.score) ? it.score | 0 : 0;
    const fp = it && Number.isFinite(it.fp) ? it.fp >>> 0 : 0;
    oldByPath.set(p, { score: sc, fp });
    if (!oldByFp.has(fp)) oldByFp.set(fp, []);
    oldByFp.get(fp).push({ path: p, score: sc });
  }

  const claimed = new Set();
  WS.meta.dirScores.clear();
  WS.meta.pendingDirScores = new Map();

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
        if (!claimed.has(cand.path)) {
          picked = cand;
          break;
        }
      }
      if (picked) {
        WS.meta.dirScores.set(path, picked.score | 0);
        claimed.add(picked.path);
        continue;
      }
    }
    WS.meta.dirScores.set(path, 0);
  }
  for (const [path, entry] of oldByPath.entries()) {
    if (claimed.has(path) || WS.dirByPath.has(path)) continue;
    WS.meta.pendingDirScores.set(path, Number(entry?.score) | 0);
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

function canRestoreTagsByFingerprintForPath(path, fp) {
  const normalizedPath = normalizeDirPathValue(path);
  if (!normalizedPath) return false;
  if (!Number.isFinite(fp) || (fp >>> 0) === 0) return false;
  return normalizedPath.includes("/");
}

function addTagFingerprintFallback(oldTagByFp, fp, tags) {
  if (!oldTagByFp || !Number.isFinite(fp) || (fp >>> 0) === 0) return;
  const normalizedTags = normalizeTagList(tags);
  if (!normalizedTags.length) return;
  const key = fp >>> 0;
  if (!oldTagByFp.has(key)) oldTagByFp.set(key, normalizedTags);
}

function seedTagFingerprintFallbackFromPaths(oldTagByFp, oldTagsByPath, folders) {
  if (!oldTagByFp || !oldTagsByPath || !folders) return;
  for (const [path, tags] of oldTagsByPath.entries()) {
    const entry = folders[path];
    const fp = entry && Number.isFinite(entry.fp) ? entry.fp >>> 0 : 0;
    if (!canRestoreTagsByFingerprintForPath(path, fp)) continue;
    addTagFingerprintFallback(oldTagByFp, fp, tags);
  }
}

function seedLegacyTagFingerprintFallback(oldTagByFp, tagByFp) {
  if (!oldTagByFp || !tagByFp || typeof tagByFp !== "object") return;
  for (const key of Object.keys(tagByFp)) {
    const fp = Number(key) >>> 0 || 0;
    addTagFingerprintFallback(oldTagByFp, fp, tagByFp[key]);
  }
}

function metaApplyTagsLog(log) {
  if (!log || typeof log !== "object") return;

  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  const oldTagsByPath = new Map();
  const legacyProcessingDisabledPaths = new Set();

  for (const p of Object.keys(folders)) {
    const it = folders[p];
    const rawTags = it && Array.isArray(it.tags) ? it.tags : [];
    for (let i = 0; i < rawTags.length; i++) {
      if (normalizeTag(rawTags[i]) !== LEGACY_PROCESSING_DISABLED_TAG) continue;
      legacyProcessingDisabledPaths.add(normalizeDirPathValue(p));
      break;
    }
    const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
    if (tg.length) oldTagsByPath.set(p, tg);
  }

  const oldTagByFp = new Map();
  seedTagFingerprintFallbackFromPaths(oldTagByFp, oldTagsByPath, folders);
  if (!oldTagByFp.size)
    seedLegacyTagFingerprintFallback(oldTagByFp, log.tagByFp);

  stashPendingTagsFromLog(oldTagsByPath);

  WS.meta.dirTags.clear();
  for (const [path, node] of WS.dirByPath.entries()) {
    if (oldTagsByPath.has(path)) {
      WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
      if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
      continue;
    }
    const fp = WS.meta.dirFingerprints.get(path) || 0;
    const tg = canRestoreTagsByFingerprintForPath(path, fp)
      ? oldTagByFp.get(fp >>> 0) || []
      : [];
    WS.meta.dirTags.set(path, tg.slice());
  }

  WS.meta.dirThumbPresets.clear();
  WS.meta.pendingDirThumbPresets = new Map();
  const thumbnailByFolder =
    log.thumbnailByFolder && typeof log.thumbnailByFolder === "object"
      ? log.thumbnailByFolder
      : {};
  for (const dirPath of Object.keys(thumbnailByFolder)) {
    const normalizedDirPath = normalizeDirPathValue(dirPath);
    const rawValue = String(thumbnailByFolder[dirPath] || "");
    const normalizedRelPath = normalizeWorkspaceRelPath(rawValue);
    if (
      !normalizedRelPath &&
      rawValue !== FOLDER_THUMB_NONE_SENTINEL &&
      rawValue !== FOLDER_THUMB_ROTATE_SENTINEL
    )
      continue;
    const finalValue =
      rawValue === FOLDER_THUMB_NONE_SENTINEL ||
      rawValue === FOLDER_THUMB_ROTATE_SENTINEL
        ? rawValue
        : normalizedRelPath;
    if (!normalizedDirPath && !WS.dirByPath.has("")) continue;
    if (WS.dirByPath.has(normalizedDirPath)) {
      WS.meta.dirThumbPresets.set(normalizedDirPath, finalValue);
    } else if (normalizedDirPath) {
      WS.meta.pendingDirThumbPresets.set(normalizedDirPath, finalValue);
    }
  }

  WS.meta.dirAppearancePresetIds.clear();
  WS.meta.pendingDirAppearancePresetIds = new Map();
  const mediaPresetByFolder =
    log.mediaPresetByFolder && typeof log.mediaPresetByFolder === "object"
      ? log.mediaPresetByFolder
      : {};
  for (const dirPath of Object.keys(mediaPresetByFolder)) {
    const normalizedDirPath = normalizeDirPathValue(dirPath);
    const presetId = normalizeAppearancePresetIdValue(
      mediaPresetByFolder[dirPath],
    );
    if (!presetId) continue;
    if (
      presetId === BUILTIN_NULL_APPEARANCE_PRESET_ID &&
      legacyProcessingDisabledPaths.has(normalizedDirPath)
    )
      continue;
    if (!normalizedDirPath && !WS.dirByPath.has("")) continue;
    if (WS.dirByPath.has(normalizedDirPath)) {
      WS.meta.dirAppearancePresetIds.set(normalizedDirPath, presetId);
    } else if (normalizedDirPath) {
      WS.meta.pendingDirAppearancePresetIds.set(normalizedDirPath, presetId);
    }
  }

  WS.meta.tagAppearancePresetIds.clear();
  const mediaPresetByTagContext =
    log.mediaPresetByTagContext &&
    typeof log.mediaPresetByTagContext === "object"
      ? log.mediaPresetByTagContext
      : {};
  for (const rawTagKey of Object.keys(mediaPresetByTagContext)) {
    const tagKey = String(rawTagKey || "");
    const presetId = normalizeAppearancePresetIdValue(
      mediaPresetByTagContext[rawTagKey],
    );
    if (!tagKey || !presetId) continue;
    WS.meta.tagAppearancePresetIds.set(tagKey, presetId);
  }

  WS.meta.hiddenTagKeys.clear();
  const hiddenTagByKey =
    log.hiddenTagByKey && typeof log.hiddenTagByKey === "object"
      ? log.hiddenTagByKey
      : {};
  for (const rawTagKey of Object.keys(hiddenTagByKey)) {
    const tagKey = String(rawTagKey || "");
    if (!tagKey || !hiddenTagByKey[rawTagKey]) continue;
    WS.meta.hiddenTagKeys.add(tagKey);
  }

  WS.meta.folderMediaFilterByPath.clear();
  const folderMediaFilterByPath =
    log.folderMediaFilterByPath && typeof log.folderMediaFilterByPath === "object"
      ? log.folderMediaFilterByPath
      : {};
  for (const rawPath of Object.keys(folderMediaFilterByPath)) {
    const path = normalizeDirPathValue(rawPath);
    const filterValue = normalizeTagMediaFilterValue(
      folderMediaFilterByPath[rawPath],
    );
    if ((!path && path !== "") || !filterValue.length) continue;
    WS.meta.folderMediaFilterByPath.set(path, filterValue);
  }

  WS.meta.tagThumbModes.clear();
  const tagThumbnailModeByTag =
    log.tagThumbnailModeByTag && typeof log.tagThumbnailModeByTag === "object"
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
  const tagThumbnailByTag =
    log.tagThumbnailByTag && typeof log.tagThumbnailByTag === "object"
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
    if (!WS.meta.tagThumbModes.has(key)) WS.meta.tagThumbModes.set(key, "single");
  }

  WS.meta.tagAlbumByTag.clear();
  WS.meta.folderAlbumByPath.clear();
  WS.meta.albumTagsByAlbum.clear();
  const tagAlbumByTag =
    log.tagAlbumByTag && typeof log.tagAlbumByTag === "object"
      ? log.tagAlbumByTag
      : {};
  for (const rawKey of Object.keys(tagAlbumByTag)) {
    const parsed = parseTagAlbumMembershipKey(rawKey);
    const album = normalizeTagAlbumName(tagAlbumByTag[rawKey]);
    if (!parsed || !album) continue;
    WS.meta.tagAlbumByTag.set(parsed.key, album);
  }
  const folderAlbumByPath =
    log.folderAlbumByPath && typeof log.folderAlbumByPath === "object"
      ? log.folderAlbumByPath
      : {};
  for (const rawPath of Object.keys(folderAlbumByPath)) {
    const path = normalizeDirPathValue(rawPath);
    const album = normalizeTagAlbumName(folderAlbumByPath[rawPath]);
    if (!path || !album) continue;
    WS.meta.folderAlbumByPath.set(path, album);
  }
  const albumTagsByAlbum =
    log.albumTagsByAlbum && typeof log.albumTagsByAlbum === "object"
      ? log.albumTagsByAlbum
      : {};
  for (const rawKey of Object.keys(albumTagsByAlbum)) {
    const parsed = parseAlbumTagMembershipKey(rawKey);
    if (!parsed) continue;
    const tags = normalizeTagList(albumTagsByAlbum[rawKey])
      .filter((tag) => !isReservedFolderTag(tag))
      .filter((tag) => tag !== parsed.album);
    if (!tags.length) continue;
    WS.meta.albumTagsByAlbum.set(parsed.key, tags);
  }

  WS.meta.fileThumbCrop.clear();
  const fileThumbnailCropByRelPath =
    log.fileThumbnailCropByRelPath &&
    typeof log.fileThumbnailCropByRelPath === "object"
      ? log.fileThumbnailCropByRelPath
      : {};
  for (const rawRelPath of Object.keys(fileThumbnailCropByRelPath)) {
    const relPath = normalizeWorkspaceRelPath(rawRelPath);
    if (!relPath) continue;
    const crop = normalizeThumbCropValue(
      fileThumbnailCropByRelPath[rawRelPath],
    );
    if (isThumbCropDefault(crop)) continue;
    WS.meta.fileThumbCrop.set(relPath, crop);
  }

  WS.meta.videoThumbTime.clear();
  const videoThumbnailTimeByRelPath =
    log.videoThumbnailTimeByRelPath &&
    typeof log.videoThumbnailTimeByRelPath === "object"
      ? log.videoThumbnailTimeByRelPath
      : {};
  for (const rawRelPath of Object.keys(videoThumbnailTimeByRelPath)) {
    const relPath = normalizeWorkspaceRelPath(rawRelPath);
    if (!relPath) continue;
    const timeValue = normalizeVideoThumbTimeValue(
      videoThumbnailTimeByRelPath[rawRelPath],
    );
    if (!Number.isFinite(timeValue)) continue;
    WS.meta.videoThumbTime.set(relPath, timeValue);
  }

  if (cleanupLegacyProcessingDisabledMetadata()) {
    metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  }
  invalidateDirMetricsCaches();
}

function metaApplyOptionsLog(log) {
  if (!log || typeof log !== "object") return;
  WS.meta.appearancePresets = normalizeAppearancePresetList(
    log.appearancePresets,
    !Array.isArray(log.appearancePresets),
  );
  WS.meta.options = normalizeOptions(log.options || null);
  syncActiveAppearancePresetSelection(WS.meta.options);
  WS.view.appearancePresetEditingId =
    effectiveActiveAppearancePresetId() || BUILTIN_NULL_APPEARANCE_PRESET_ID;
  WS.view.appearancePresetDraftName = "";
  WS.view.appearancePresetPromptMode = "";
  applyDefaultViewFromOptions();
  applyLoadedOptionsToDocument();
}

function metaApplyKeybindsLog(log) {
  if (!log || typeof log !== "object") return;
  const normalized = normalizeKeybinds(
    log,
    WS.meta && WS.meta.appearancePresets,
  );
  WS.meta.keybinds = normalized.bindings;
  const normalizedGrid = normalizeGridKeybinds(log);
  WS.meta.gridKeybinds = normalizedGrid.bindings;
  rebuildKeybindIndex();
}

function metaApplyFromLog(log) {
  if (!log || typeof log !== "object") return;

  const sortMode = normalizeDirSortMode(log.sortMode);
  WS.meta.dirSortMode = sortMode;

  WS.meta.appearancePresets = defaultAppearancePresets();
  WS.meta.options = normalizeOptions(log.options || null);
  syncActiveAppearancePresetSelection(WS.meta.options);
  WS.view.appearancePresetEditingId =
    effectiveActiveAppearancePresetId() || BUILTIN_NULL_APPEARANCE_PRESET_ID;
  WS.view.appearancePresetDraftName = "";
  WS.view.appearancePresetPromptMode = "";
  applyColorSchemeFromOptions();
  applyMediaFilterFromOptions();
  applyThumbFitFromOptions();
  applyDisplaySizesFromOptions();
  applyDirectoryMiniThumbSizeFromOptions();
  applyDescriptionVisibilityFromOptions();
  applyInteractionModeFromOptions();
  applyPaneDividerFromOptions();

  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  const oldByPath = new Map();
  const oldByFp = new Map();

  const oldTagsByPath = new Map();

  for (const p of Object.keys(folders)) {
    const it = folders[p];
    const sc = it && Number.isFinite(it.score) ? it.score | 0 : 0;
    const fp = it && Number.isFinite(it.fp) ? it.fp >>> 0 : 0;
    oldByPath.set(p, { score: sc, fp });
    if (!oldByFp.has(fp)) oldByFp.set(fp, []);
    oldByFp.get(fp).push({ path: p, score: sc });

    const tg = it && Array.isArray(it.tags) ? normalizeTagList(it.tags) : [];
    if (tg.length) oldTagsByPath.set(p, tg);
  }

  const oldTagByFp = new Map();
  seedTagFingerprintFallbackFromPaths(oldTagByFp, oldTagsByPath, folders);
  if (!oldTagByFp.size)
    seedLegacyTagFingerprintFallback(oldTagByFp, log.tagByFp);

  stashPendingTagsFromLog(oldTagsByPath);

  const claimed = new Set();
  WS.meta.dirScores.clear();
  WS.meta.pendingDirScores = new Map();

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
        if (!claimed.has(cand.path)) {
          picked = cand;
          break;
        }
      }
      if (picked) {
        WS.meta.dirScores.set(path, picked.score | 0);
        claimed.add(picked.path);
        continue;
      }
    }
    WS.meta.dirScores.set(path, 0);
  }
  for (const [path, entry] of oldByPath.entries()) {
    if (claimed.has(path) || WS.dirByPath.has(path)) continue;
    WS.meta.pendingDirScores.set(path, Number(entry?.score) | 0);
  }

  WS.meta.dirTags.clear();
  for (const [path, node] of WS.dirByPath.entries()) {
    if (oldTagsByPath.has(path)) {
      WS.meta.dirTags.set(path, oldTagsByPath.get(path).slice());
      if (WS.meta.pendingTagsByPath) WS.meta.pendingTagsByPath.delete(path);
      continue;
    }
    const fp = WS.meta.dirFingerprints.get(path) || 0;
    const tg = canRestoreTagsByFingerprintForPath(path, fp)
      ? oldTagByFp.get(fp >>> 0) || []
      : [];
    WS.meta.dirTags.set(path, tg.slice());
  }

  WS.meta.dirAppearancePresetIds.clear();
  WS.meta.pendingDirAppearancePresetIds = new Map();
  if (cleanupLegacyProcessingDisabledMetadata()) {
    metaTrackDirtyDocIds([META_DOC_IDS.tags]);
  }

  applyDefaultViewFromOptions();
  syncMetaButtons();
  renderOptionsUi();
}

function metaMakeScoresDocObject() {
  const folders = {};
  for (const [path] of WS.dirByPath.entries()) {
    const fp = WS.meta.dirFingerprints.get(path) || 0;
    folders[path] = { score: metaGetScore(path), fp: fp >>> 0 };
  }
  if (WS.meta && WS.meta.pendingDirScores) {
    for (const [path, scoreRaw] of WS.meta.pendingDirScores.entries()) {
      const normalizedPath = normalizeDirPathValue(path);
      if (!normalizedPath || folders[normalizedPath]) continue;
      folders[normalizedPath] = {
        score: Number(scoreRaw) | 0,
        fp: metaFingerprintForPath(normalizedPath),
      };
    }
  }
  // Anything still scored that is no longer in the tree - deleted, moved out,
  // emptied from the Trash - is written out under its own path with its last
  // known fingerprint. Dropping it here is what used to lose the score for
  // good the first time the app saved after a folder went away.
  if (WS.meta && WS.meta.dirScores) {
    for (const [pathRaw, scoreRaw] of WS.meta.dirScores.entries()) {
      const path = normalizeDirPathValue(pathRaw);
      if (!path || Object.prototype.hasOwnProperty.call(folders, path)) continue;
      folders[path] = {
        score: Number(scoreRaw) | 0,
        fp: metaFingerprintForPath(path),
      };
    }
  }
  return {
    schema: 1,
    updatedAt: Date.now(),
    folders,
  };
}

function metaMakeScoreHistoryDocObject() {
  return {
    schema: 1,
    updatedAt: Date.now(),
    history: normalizeScoreHistoryList(
      WS.meta && Array.isArray(WS.meta.scoreHistory)
        ? WS.meta.scoreHistory
        : [],
    ),
  };
}

function normalizeDailyJournalDateKey(dateKey) {
  const key = String(dateKey || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : "";
}

function metaGetDailyJournal(dateKey) {
  const key = normalizeDailyJournalDateKey(dateKey);
  if (!key || !WS.meta || !WS.meta.dailyJournals) return "";
  return String(WS.meta.dailyJournals.get(key) || "");
}

function metaSetDailyJournal(dateKey, markdown) {
  const key = normalizeDailyJournalDateKey(dateKey);
  if (!key || !WS.meta || !WS.meta.dailyJournals) return false;
  const next = String(markdown || "");
  const current = metaGetDailyJournal(key);
  if (current === next) return false;
  if (next.trim()) WS.meta.dailyJournals.set(key, next);
  else WS.meta.dailyJournals.delete(key);
  metaMarkDirty(META_DOC_IDS.dailyJournals);
  return true;
}

function metaHasDailyJournal(dateKey) {
  return !!metaGetDailyJournal(dateKey).trim();
}

// A day whose journal holds only the "## <root>" headings auto-appended when a
// score changes (with nothing written under them) is not a real journal entry,
// so it should not earn the calendar's journal dot. Returns true only when some
// non-blank line survives after those auto-headings are removed. The score-
// history scan is skipped for the common empty-journal case.
function metaDailyJournalHasUserContent(dateKey) {
  const markdown = metaGetDailyJournal(dateKey);
  if (!markdown.trim()) return false;
  const autoHeadings = new Set();
  const rows = getRootScoreHistoryLinesForDateKey(dateKey, true);
  for (let i = 0; i < rows.length; i++) {
    const heading = markdownHeadingForRootScoreLine(rows[i]).trim().toLowerCase();
    if (heading) autoHeadings.add(heading);
  }
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || "").trim();
    if (!line) continue;
    if (autoHeadings.has(line.toLowerCase())) continue;
    return true;
  }
  return false;
}

function metaGetDailyJournalDateKeys() {
  const source = WS.meta && WS.meta.dailyJournals;
  if (!source || typeof source.entries !== "function") return [];
  const out = [];
  for (const [dateKeyRaw, markdownRaw] of source.entries()) {
    const dateKey = normalizeDailyJournalDateKey(dateKeyRaw);
    if (!dateKey || !String(markdownRaw || "").trim()) continue;
    out.push(dateKey);
  }
  out.sort((a, b) => String(a).localeCompare(String(b)));
  return out;
}

function metaMakeDailyJournalsDocObject() {
  const days = {};
  const source = WS.meta && WS.meta.dailyJournals;
  if (source && typeof source.entries === "function") {
    for (const [dateKeyRaw, markdownRaw] of source.entries()) {
      const dateKey = normalizeDailyJournalDateKey(dateKeyRaw);
      const markdown = String(markdownRaw || "");
      if (!dateKey || !markdown.trim()) continue;
      days[dateKey] = markdown;
    }
  }
  return {
    schema: 1,
    updatedAt: Date.now(),
    days,
  };
}

function metaMakeTagsDocObject() {
  const folders = {};
  const tagByFp = {};
  const hiddenTagByKey = {};
  const folderMediaFilterByPath = {};
  const tagMediaFilterByKey = {};
  for (const [path] of WS.dirByPath.entries()) {
    const fp = WS.meta.dirFingerprints.get(path) || 0;
    const tags = metaGetTags(path).filter(
      (tag) => tag !== LEGACY_PROCESSING_DISABLED_TAG,
    );
    folders[path] = { fp: fp >>> 0, tags };
    if (tags && tags.length && canRestoreTagsByFingerprintForPath(path, fp)) {
      const key = String(fp >>> 0);
      if (!tagByFp[key]) tagByFp[key] = tags.slice();
    }
  }
  // Tags of folders that are no longer in the tree survive the same way the
  // scores do: written out under their own path, with the last fingerprint we
  // knew for it so the folder can be recognised by content if it comes back
  // somewhere else.
  if (WS.meta && WS.meta.dirTags) {
    for (const [pathRaw, tagsRaw] of WS.meta.dirTags.entries()) {
      const path = normalizeDirPathValue(pathRaw);
      if (!path || Object.prototype.hasOwnProperty.call(folders, path)) continue;
      const tags = normalizeTagList(tagsRaw).filter(
        (tag) => tag !== LEGACY_PROCESSING_DISABLED_TAG,
      );
      if (!tags.length) continue;
      folders[path] = { fp: metaFingerprintForPath(path), tags };
    }
  }
  const pending =
    WS.meta && WS.meta.pendingTagsByPath ? WS.meta.pendingTagsByPath : null;
  if (pending && pending.size) {
    for (const [path, tags] of pending.entries()) {
      const normalizedPath = String(path || "");
      if (!normalizedPath || folders[normalizedPath]) continue;
      const normalizedTags = normalizeTagList(tags);
      if (!normalizedTags.length) continue;
      folders[normalizedPath] = {
        fp: metaFingerprintForPath(normalizedPath),
        tags: normalizedTags,
      };
    }
  }
  if (WS.meta && WS.meta.hiddenTagKeys) {
    for (const tagKeyRaw of WS.meta.hiddenTagKeys.values()) {
      const tagKey = String(tagKeyRaw || "");
      if (!tagKey) continue;
      hiddenTagByKey[tagKey] = true;
    }
  }
  if (WS.meta && WS.meta.folderMediaFilterByPath) {
    for (const [pathRaw, filterValueRaw] of WS.meta.folderMediaFilterByPath.entries()) {
      const path = normalizeDirPathValue(pathRaw);
      const filterValue = normalizeTagMediaFilterValue(filterValueRaw);
      if ((!path && path !== "") || !filterValue.length) continue;
      folderMediaFilterByPath[path] = filterValue.slice();
    }
  }
  if (WS.meta && WS.meta.tagMediaFilterByKey) {
    for (const [
      tagKeyRaw,
      filterValueRaw,
    ] of WS.meta.tagMediaFilterByKey.entries()) {
      const tagKey = String(tagKeyRaw || "");
      const filterValue = normalizeTagMediaFilterValue(filterValueRaw);
      if (!tagKey || !filterValue.length) continue;
      tagMediaFilterByKey[tagKey] = filterValue.slice();
    }
  }
  const tagParents = {};
  if (WS.meta && WS.meta.tagParents instanceof Map) {
    for (const [child, parents] of WS.meta.tagParents.entries()) {
      const list = Array.from(parents || []).filter(Boolean).sort();
      if (child && list.length) tagParents[child] = list;
    }
  }
  const exclusiveTags =
    WS.meta && WS.meta.exclusiveTags instanceof Set
      ? Array.from(WS.meta.exclusiveTags).filter(Boolean).sort()
      : [];
  const contentTags = {};
  if (WS.meta && WS.meta.contentTags instanceof Map) {
    for (const [key, tags] of WS.meta.contentTags.entries()) {
      const list = Array.from(tags || []).filter(Boolean).sort();
      if (key && list.length) contentTags[key] = list;
    }
  }
  const scoreFilterOverrides = {};
  if (WS.meta && WS.meta.scoreFilterOverrides instanceof Map) {
    for (const [key, entry] of WS.meta.scoreFilterOverrides.entries()) {
      const out = {};
      for (const kind of SCORE_FILTER_KINDS) {
        const value = normalizeScoreFilterOverrideValue(entry && entry[kind]);
        if (value !== undefined) out[kind] = value;
      }
      if (key && Object.keys(out).length) scoreFilterOverrides[key] = out;
    }
  }
  return {
    schema: TAGS_SCHEMA_VERSION,
    updatedAt: Date.now(),
    folders,
    tagByFp,
    hiddenTagByKey,
    folderMediaFilterByPath,
    tagMediaFilterByKey,
    tagParents,
    exclusiveTags,
    contentTags,
    scoreFilterOverrides,
    tagStorage: TAG_STORAGE_NAME,
  };
}

function metaMakeTagAlbumsDocObject() {
  const legacyMaps = [
    WS.meta && WS.meta.tagAlbumByTag,
    WS.meta && WS.meta.folderAlbumByPath,
    WS.meta && WS.meta.albumTagsByAlbum,
    WS.meta && WS.meta.folderGalleriesByPath,
    WS.meta && WS.meta.galleryMemberTagsByGallery,
    WS.meta && WS.meta.galleryMemberAlbumsByGallery,
    WS.meta && WS.meta.galleryUserTagsByGallery,
    WS.meta && WS.meta.galleryAlbumByGallery,
  ];
  if (!legacyMaps.some((map) => map instanceof Map && map.size)) {
    return { schema: 5, updatedAt: Date.now(), convertedToTags: true };
  }
  const tagAlbumByTag = {};
  const folderAlbumByPath = {};
  const albumTagsByAlbum = {};
  const folderGalleriesByPath = {};
  const galleryMemberTagsByGallery = {};
  const galleryMemberAlbumsByGallery = {};
  const galleryUserTagsByGallery = {};
  const galleryAlbumByGallery = {};
  if (WS.meta && WS.meta.tagAlbumByTag) {
    for (const [tagKeyRaw, albumRaw] of WS.meta.tagAlbumByTag.entries()) {
      const parsed = parseTagAlbumMembershipKey(tagKeyRaw);
      const album = normalizeTagAlbumName(albumRaw);
      if (!parsed || !album) continue;
      tagAlbumByTag[parsed.key] = album;
    }
  }
  if (WS.meta && WS.meta.folderAlbumByPath) {
    for (const [pathRaw, albumRaw] of WS.meta.folderAlbumByPath.entries()) {
      const path = normalizeDirPathValue(pathRaw);
      const album = normalizeTagAlbumName(albumRaw);
      if (!path || !album) continue;
      folderAlbumByPath[path] = album;
    }
  }
  if (WS.meta && WS.meta.albumTagsByAlbum) {
    for (const [albumKeyRaw, tagsRaw] of WS.meta.albumTagsByAlbum.entries()) {
      const parsed = parseAlbumTagMembershipKey(albumKeyRaw);
      if (!parsed) continue;
      const tags = normalizeTagList(tagsRaw)
        .filter((tag) => !isReservedFolderTag(tag))
        .filter((tag) => tag !== parsed.album);
      if (!tags.length) continue;
      albumTagsByAlbum[parsed.key] = tags;
    }
  }
  if (WS.meta && WS.meta.folderGalleriesByPath) {
    for (const [pathRaw, galleriesRaw] of WS.meta.folderGalleriesByPath.entries()) {
      const path = normalizeDirPathValue(pathRaw);
      const galleries = normalizeTagList(galleriesRaw).map(normalizeGalleryName).filter(Boolean);
      if (!path || !galleries.length) continue;
      folderGalleriesByPath[path] = galleries;
    }
  }
  if (WS.meta && WS.meta.galleryMemberTagsByGallery) {
    for (const [galleryRaw, tagsRaw] of WS.meta.galleryMemberTagsByGallery.entries()) {
      const gallery = normalizeGalleryName(galleryRaw);
      const tags = normalizeGalleryMemberTargets(tagsRaw, "tag");
      if (!gallery || !tags.length) continue;
      galleryMemberTagsByGallery[gallery] = tags;
    }
  }
  if (WS.meta && WS.meta.galleryMemberAlbumsByGallery) {
    for (const [galleryRaw, albumsRaw] of WS.meta.galleryMemberAlbumsByGallery.entries()) {
      const gallery = normalizeGalleryName(galleryRaw);
      const albums = normalizeGalleryMemberTargets(albumsRaw, "album");
      if (!gallery || !albums.length) continue;
      galleryMemberAlbumsByGallery[gallery] = albums;
    }
  }
  if (WS.meta && WS.meta.galleryUserTagsByGallery) {
    for (const [galleryRaw, tagsRaw] of WS.meta.galleryUserTagsByGallery.entries()) {
      const gallery = normalizeGalleryName(galleryRaw);
      const tags = normalizeTagList(tagsRaw)
        .filter((tag) => !isReservedFolderTag(tag))
        .filter((tag) => tag !== gallery);
      if (!gallery || !tags.length) continue;
      galleryUserTagsByGallery[gallery] = tags;
    }
  }
  if (WS.meta && WS.meta.galleryAlbumByGallery) {
    for (const [galleryRaw, albumRaw] of WS.meta.galleryAlbumByGallery.entries()) {
      const gallery = normalizeGalleryName(galleryRaw);
      const album = normalizeTagAlbumName(albumRaw);
      if (!gallery || !album || album === gallery) continue;
      galleryAlbumByGallery[gallery] = album;
    }
  }
  return {
    schema: 4,
    updatedAt: Date.now(),
    tagAlbumByTag,
    folderAlbumByPath,
    albumTagsByAlbum,
    folderGalleriesByPath,
    galleryMemberTagsByGallery,
    galleryMemberAlbumsByGallery,
    galleryUserTagsByGallery,
    galleryAlbumByGallery,
  };
}


function metaMakeAspectRatiosDocObject() {
  const filesByPath = {};
  const source = WS.meta && WS.meta.aspectRatios ? WS.meta.aspectRatios : null;
  if (source) {
    for (const [relPathRaw, entryRaw] of source.entries()) {
      const relPath = normalizeWorkspaceRelPath(relPathRaw);
      const entry = normalizeAspectRatioLogEntry(relPath, entryRaw);
      if (!relPath || !entry) continue;
      filesByPath[relPath] = entry;
    }
  }
  return {
    schema: 1,
    updatedAt: Date.now(),
    filesByPath,
  };
}

function metaMakeAppearancePresetsDocObject() {
  return {
    schema: 1,
    updatedAt: Date.now(),
    presets: normalizeAppearancePresetList(
      WS.meta && Array.isArray(WS.meta.appearancePresets)
        ? WS.meta.appearancePresets
        : null,
    ),
  };
}

function metaMakeAppearanceAssignmentsDocObject() {
  const mediaPresetByFolder = {};
  const mediaPresetByTagContext = {};
  if (WS.meta && WS.meta.dirAppearancePresetIds) {
    for (const [
      path,
      presetIdRaw,
    ] of WS.meta.dirAppearancePresetIds.entries()) {
      const presetId = normalizeAppearancePresetIdValue(presetIdRaw);
      if (!presetId) continue;
      mediaPresetByFolder[path] = presetId;
    }
  }
  if (WS.meta && WS.meta.pendingDirAppearancePresetIds) {
    for (const [
      path,
      presetIdRaw,
    ] of WS.meta.pendingDirAppearancePresetIds.entries()) {
      const normalizedPath = normalizeDirPathValue(path);
      const presetId = normalizeAppearancePresetIdValue(presetIdRaw);
      if (!normalizedPath || !presetId || mediaPresetByFolder[normalizedPath]) continue;
      mediaPresetByFolder[normalizedPath] = presetId;
    }
  }
  if (WS.meta && WS.meta.tagAppearancePresetIds) {
    for (const [
      tagKeyRaw,
      presetIdRaw,
    ] of WS.meta.tagAppearancePresetIds.entries()) {
      const tagKey = String(tagKeyRaw || "");
      const presetId = normalizeAppearancePresetIdValue(presetIdRaw);
      if (!tagKey || !presetId) continue;
      mediaPresetByTagContext[tagKey] = presetId;
    }
  }
  return {
    schema: 1,
    updatedAt: Date.now(),
    mediaPresetByFolder,
    mediaPresetByTagContext,
  };
}

function metaMakePreferenceSectionLogObject(docId) {
  const optionKeys =
    docId === META_DOC_IDS.prefGeneral
      ? META_GENERAL_PREFERENCE_OPTION_KEYS
      : docId === META_DOC_IDS.prefNotifications
        ? META_PREFERENCE_SECTION_OPTION_KEYS.notifications
      : docId === META_DOC_IDS.prefAppearance
        ? META_PREFERENCE_SECTION_OPTION_KEYS.appearance
        : docId === META_DOC_IDS.prefPlayback
          ? META_PREFERENCE_SECTION_OPTION_KEYS.playback
          : docId === META_DOC_IDS.prefThumbnails
            ? META_PREFERENCE_SECTION_OPTION_KEYS.thumbnails
            : docId === META_DOC_IDS.prefFilenames
              ? META_PREFERENCE_SECTION_OPTION_KEYS.filenames
              : docId === META_DOC_IDS.prefControls
                ? META_PREFERENCE_SECTION_OPTION_KEYS.controls
                : [];
  const source =
    WS.meta && WS.meta.options
      ? normalizeOptions(WS.meta.options)
      : normalizeOptions(null);
  const options = {};
  for (let i = 0; i < optionKeys.length; i++) {
    const key = String(optionKeys[i] || "");
    if (!key) continue;
    options[key] = Object.prototype.hasOwnProperty.call(source, key)
      ? source[key]
      : null;
  }
  const out = {
    schema: 1,
    updatedAt: Date.now(),
    options,
  };
  if (docId === META_DOC_IDS.prefGeneral) {
    out.dirSortMode = normalizeDirSortMode(WS.meta && WS.meta.dirSortMode);
    out.containerSortByFolderPath = Object.fromEntries(
      Array.from(WS.meta.containerSortByFolderPath || []).filter(
        ([, mode]) => !!normalizeContainerSortMode(mode),
      ),
    );
    out.containerSortByTagKey = Object.fromEntries(
      Array.from(WS.meta.containerSortByTagKey || []).filter(
        ([key, mode]) => String(key || "") && normalizeContainerSortMode(mode),
      ),
    );
    out.folderAltByPath = Object.fromEntries(
      Array.from(WS.meta.folderAltByPath || []).filter(
        ([path, label]) => String(path || "") && String(label || ""),
      ),
    );
  }
  return out;
}

function metaMakeTrashDocObject() {
  const itemsByTrashPath = {};
  for (const [trashPath, item] of WS.meta.trashItemsByPath.entries()) {
    const normalizedTrashPath = normalizeWorkspaceRelPath(trashPath);
    const normalizedOriginalPath = normalizeWorkspaceRelPath(
      item && item.originalPath,
    );
    if (!normalizedTrashPath || !isPathInsideInternalTrash(normalizedTrashPath))
      continue;
    if (!normalizedOriginalPath || isPathInsideInternalTrash(normalizedOriginalPath))
      continue;
    itemsByTrashPath[normalizedTrashPath] = {
      originalPath: normalizedOriginalPath,
      trashedAt:
        typeof item?.trashedAt === "string" && item.trashedAt.trim()
          ? item.trashedAt
          : new Date().toISOString(),
    };
  }
  return {
    schema: 1,
    updatedAt: Date.now(),
    itemsByTrashPath,
  };
}

function metaDocObjectForId(docId) {
  if (!metadataDocEnabled(docId)) return null;
  switch (docId) {
    case META_DOC_IDS.scores:
      return metaMakeScoresDocObject();
    case META_DOC_IDS.scoreHistory:
      return metaMakeScoreHistoryDocObject();
    case META_DOC_IDS.dailyJournals:
      return metaMakeDailyJournalsDocObject();
    case META_DOC_IDS.tags:
      return metaMakeTagsDocObject();
    case META_DOC_IDS.tagAlbums:
      return metaMakeTagAlbumsDocObject();
    case META_DOC_IDS.trash:
      return metaMakeTrashDocObject();
    case META_DOC_IDS.thumbnails:
      return metaMakeThumbnailsDocObject();
    case META_DOC_IDS.aspectRatios:
      return metaMakeAspectRatiosDocObject();
    case META_DOC_IDS.appearancePresets:
      return metaMakeAppearancePresetsDocObject();
    case META_DOC_IDS.appearanceAssignments:
      return metaMakeAppearanceAssignmentsDocObject();
    case META_DOC_IDS.prefGeneral:
    case META_DOC_IDS.prefNotifications:
    case META_DOC_IDS.prefAppearance:
    case META_DOC_IDS.prefPlayback:
    case META_DOC_IDS.prefThumbnails:
    case META_DOC_IDS.prefFilenames:
    case META_DOC_IDS.prefControls:
      return metaMakePreferenceSectionLogObject(docId);
    case META_DOC_IDS.keybinds:
      return metaMakeKeybindsLogObject();
    default:
      return null;
  }
}

function metadataIsPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function metadataArchiveRootName() {
  const rootPath = String(window.__lg?.rootPath || "").replace(/\/+$/, "");
  if (rootPath) return rootPath.split("/").filter(Boolean).pop() || "root";
  return String(WS.root?.name || WS.catalog?.index?.rootName || "root");
}

function sanitizeMetadataArchiveNamePart(value) {
  return String(value || "root")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "") || "root";
}

function metadataArchiveDownloadFileName() {
  const d = new Date();
  const yy = String(d.getFullYear() % 100).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  const folderName = sanitizeMetadataArchiveNamePart(metadataArchiveRootName());
  return `${yy}${mm}${dd}-${hh}${mi}${ss} - ${folderName} logs.zip`;
}

function journalArchiveDownloadFileName() {
  return metadataArchiveDownloadFileName().replace(/ logs\.zip$/, " journal.zip");
}

// Settings -> Export journal: each journal day as its own .md file (named for
// the day, 2026-09-15.md), loose in one folder, zipped into Downloads with the
// same kind of name Export logs uses. Days holding only the headings a score
// change adds are skipped -- the calendar does not count those as entries.
async function exportJournalArchiveFromMenu() {
  if (!WS.root || !WS.meta) {
    showStatusMessage("Open a library before exporting the journal.");
    return false;
  }
  const api = window.electronAPI || {};
  if (typeof api.exportJournalArchive !== "function") {
    showStatusMessage("Export journal is available in the desktop app.");
    return false;
  }
  const entries = metaGetDailyJournalDateKeys()
    .filter((dateKey) => metaDailyJournalHasUserContent(dateKey))
    .map((dateKey) => ({
      file_name: `${dateKey}.md`,
      text: metaGetDailyJournal(dateKey),
    }));
  if (!entries.length) {
    showStatusMessage("There are no journal entries to export.", "", { force: true });
    return false;
  }
  try {
    const archiveFileName = journalArchiveDownloadFileName();
    const path = await api.exportJournalArchive({
      entries,
      archiveFileName,
      folderName: archiveFileName.replace(/\.zip$/, ""),
    });
    const fileName = String(path || "").split(/[\\/]/).pop();
    const days = `${entries.length} ${entries.length === 1 ? "day" : "days"}`;
    showStatusMessage(
      fileName
        ? `Journal exported to Downloads (${days}): ${fileName}`
        : `Journal exported to Downloads (${days}).`,
      "",
      { force: true },
    );
    return true;
  } catch (err) {
    console.error("Journal export failed.", err);
    showStatusMessage("Journal export failed.", "", { force: true });
    return false;
  }
}

function currentMetadataDirectoryPath() {
  const metaPath = String(window.__lg?.metaPath || "").replace(/\/+$/, "");
  if (metaPath) return metaPath;
  const rootPath = String(window.__lg?.rootPath || "").replace(/\/+$/, "");
  return rootPath ? `${rootPath}/.local-gallery` : "";
}

// Settings -> Export logs: the whole .local-gallery folder -- every log, the
// catalog, the thumbnail cache -- zipped into Downloads. Pending saves are
// flushed first so the archive holds what is on screen. There is no import.
async function exportLogsArchiveFromMenu() {
  if (!WS.root || !WS.meta) {
    showStatusMessage("Open a library before exporting logs.");
    return false;
  }
  const api = window.electronAPI || {};
  if (typeof api.exportMetadataArchive !== "function") {
    showStatusMessage("Export logs is available in the desktop app.");
    return false;
  }
  const metadataDir = currentMetadataDirectoryPath();
  if (!metadataDir) {
    showStatusMessage("Logs folder unavailable.");
    return false;
  }
  // A big thumbnail cache takes a while to zip: cover the window until the
  // archive lands, and always say how it ended -- even with messages disabled.
  showBusyOverlay();
  if (busyLabel) busyLabel.textContent = "Exporting logs";
  try {
    await new Promise((resolve) => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
      setTimeout(resolve, 250);
    });
    await flushPendingMetadataSaveNow();
    const path = await api.exportMetadataArchive({
      metadataDir,
      archiveFileName: metadataArchiveDownloadFileName(),
    });
    const fileName = String(path || "").split(/[\\/]/).pop();
    showStatusMessage(
      fileName
        ? `Logs exported to Downloads: ${fileName}`
        : "Logs exported to Downloads.",
      "",
      { force: true },
    );
    return true;
  } catch (err) {
    console.error("Log export failed.", err);
    showStatusMessage("Log export failed.", "", { force: true });
    return false;
  } finally {
    hideBusyOverlay(true);
  }
}

function metaApplyScoresDocLog(log) {
  if (!log || typeof log !== "object") return;
  const folders =
    log.folders && typeof log.folders === "object" ? log.folders : {};
  const oldByPath = new Map();
  const oldByFp = new Map();

  for (const p of Object.keys(folders)) {
    const it = folders[p];
    const sc = it && Number.isFinite(it.score) ? it.score | 0 : 0;
    const fp = it && Number.isFinite(it.fp) ? it.fp >>> 0 : 0;
    oldByPath.set(p, { score: sc, fp });
    if (!oldByFp.has(fp)) oldByFp.set(fp, []);
    oldByFp.get(fp).push({ path: p, score: sc });
  }

  // Remember every fingerprint the log carries, including those of folders
  // that are not here any more, so one that comes back under a different name
  // can still be matched to its old score by content.
  for (const [path, entry] of oldByPath.entries())
    metaRememberFingerprintForPath(path, entry && entry.fp);

  const claimed = new Set();
  WS.meta.dirScores.clear();
  WS.meta.pendingDirScores = new Map();
  for (const [path] of WS.dirByPath.entries()) {
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
        if (!claimed.has(cand.path)) {
          picked = cand;
          break;
        }
      }
      if (picked) {
        WS.meta.dirScores.set(path, picked.score | 0);
        claimed.add(picked.path);
        continue;
      }
    }
    WS.meta.dirScores.set(path, 0);
  }
  for (const [path, entry] of oldByPath.entries()) {
    if (claimed.has(path) || WS.dirByPath.has(path)) continue;
    WS.meta.pendingDirScores.set(path, Number(entry?.score) | 0);
  }
}

function metaApplyScoreHistoryDocLog(log) {
  if (!log || typeof log !== "object") return;
  WS.meta.scoreHistory = normalizeScoreHistoryList(
    log.history || log.scoreHistory || [],
  );
}

function metaApplyDailyJournalsDocLog(log) {
  if (!WS.meta) return;
  if (!(WS.meta.dailyJournals instanceof Map)) WS.meta.dailyJournals = new Map();
  WS.meta.dailyJournals.clear();
  if (!log || typeof log !== "object") return;
  const days = log.days && typeof log.days === "object" ? log.days : {};
  for (const rawKey of Object.keys(days)) {
    const dateKey = normalizeDailyJournalDateKey(rawKey);
    const markdown = String(days[rawKey] || "");
    if (!dateKey || !markdown.trim()) continue;
    WS.meta.dailyJournals.set(dateKey, markdown);
  }
}
