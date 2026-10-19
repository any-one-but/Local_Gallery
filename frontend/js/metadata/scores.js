/* Scores
   Score history and reading, setting and bumping scores. */

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
  const at =
    Number.isFinite(atRaw) && atRaw > 0 ? Math.floor(atRaw) : Date.now();
  const idRaw = String(raw.id || "").trim();
  const id = idRaw || `score-${at}-${Math.random().toString(36).slice(2, 10)}`;
  const selectedPathsRaw = Array.isArray(raw.selectedPaths)
    ? raw.selectedPaths
    : [];
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
    const da = String(a.path || "")
      .split("/")
      .filter(Boolean).length;
    const db = String(b.path || "")
      .split("/")
      .filter(Boolean).length;
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
  if (out.length > SCORE_HISTORY_MAX_ENTRIES)
    out.length = SCORE_HISTORY_MAX_ENTRIES;
  return out;
}

function addScoreHistoryEntry(entry) {
  const normalized = normalizeScoreHistoryEntry(entry);
  if (!normalized) return false;
  const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
  src.unshift(normalized);
  const out = normalizeScoreHistoryList(src);
  WS.meta.scoreHistory = out;
  appendDailyJournalRootHeadersForScoreEntry(normalized);
  return true;
}

function removeScoreHistoryEntryById(id) {
  const key = String(id || "");
  if (!key) return 0;
  const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
  const next = src.filter((entry) => String((entry && entry.id) || "") !== key);
  const removed = src.length - next.length;
  if (removed > 0) WS.meta.scoreHistory = normalizeScoreHistoryList(next);
  return removed;
}

function removeScoreHistoryEntriesByDateKey(dateKey) {
  const key = String(dateKey || "");
  if (!key) return 0;
  const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
  const next = src.filter(
    (entry) => scoreHistoryDateKey(entry && entry.at) !== key,
  );
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
    const removedFromEntry = getRootScoreHistoryLinesForEntry(
      normalizedEntry,
    ).filter((line) => String(line.rootPath || "") === root).length;
    if (!removedFromEntry) {
      next.push(normalizedEntry);
      continue;
    }
    const changed = normalizedEntry.changed.filter(
      (item) => scoreHistoryRootPathFromChangedPath(item.path) !== root,
    );
    const nextEntry = Object.assign({}, normalizedEntry, { changed });
    if (getRootScoreHistoryLinesForEntry(nextEntry).length) {
      next.push(nextEntry);
    }
    removed += removedFromEntry;
  }
  if (removed > 0) WS.meta.scoreHistory = normalizeScoreHistoryList(next);
  return removed;
}

function removeScoreHistoryLinesByDateAndRoot(dateKey, rootPath) {
  const key = String(dateKey || "").trim();
  const root = normalizeDirPathValue(rootPath);
  if (!key || !root) return 0;
  const src = Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [];
  if (!src.length) return 0;
  const next = [];
  let removed = 0;
  for (let i = 0; i < src.length; i++) {
    const normalizedEntry = normalizeScoreHistoryEntry(src[i]);
    if (!normalizedEntry) continue;
    if (scoreHistoryDateKey(normalizedEntry.at) !== key) {
      next.push(normalizedEntry);
      continue;
    }
    const removedFromEntry = getRootScoreHistoryLinesForEntry(
      normalizedEntry,
    ).filter((line) => String(line.rootPath || "") === root).length;
    if (!removedFromEntry) {
      next.push(normalizedEntry);
      continue;
    }
    const changed = normalizedEntry.changed.filter(
      (item) => scoreHistoryRootPathFromChangedPath(item.path) !== root,
    );
    const selectedPaths = normalizedEntry.selectedPaths.filter(
      (path) => scoreHistoryRootPathFromChangedPath(path) !== root,
    );
    const nextEntry = Object.assign({}, normalizedEntry, {
      changed,
      selectedPaths,
    });
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
    // A score edit reorders folders under score sort, so it invalidates cached
    // orderings exactly like a sort-mode change does — including the nav-entry
    // snapshots keyed on NAV_ENTRY_RESTORE_REVISION.
    // The scored item is a card on screen, not a place to go: re-sort, keep the
    // location, and keep the card selected where it moved to.
    invalidateDirSortOrderCaches();
    rebuildDirectoriesEntries();
    preserveActivePreviewTargetDuringDirectoriesRefresh();
    renderDirectoriesPane(false);
    renderPreviewPane(false, true);
    try {
      revealPreviewCard(findSelectedPreviewCard());
    } catch {}
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
  if (Number.isFinite(v)) return v;
  const pending = WS.meta.pendingDirScores
    ? WS.meta.pendingDirScores.get(p)
    : null;
  return Number.isFinite(pending) ? pending : 0;
}

function metaSetScore(path, score) {
  const p = String(path || "");
  const v = Number(score || 0) | 0;
  WS.meta.dirScores.set(p, v);
  metaMarkDirty(META_DOC_IDS.scores);
  bumpScoreFilterRevision();
  if (scoreFilterMayApply()) invalidateDirMetricsCaches();
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
  const currentPath =
    currentEntry && currentEntry.kind === "dir"
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

  let focusPath =
    currentPath && selectedPaths.some((p) => String(p || "") === currentPath)
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
      after,
    });
  }

  bumpScoreFilterRevision();
  if (scoreFilterMayApply()) invalidateDirMetricsCaches();

  addScoreHistoryEntry({
    at: Date.now(),
    selectedPaths,
    changed,
  });

  metaMarkDirty(META_DOC_IDS.scores, META_DOC_IDS.scoreHistory);
  applyScoreMutationRender(focusPath);
}
