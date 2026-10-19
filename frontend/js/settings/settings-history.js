/* Settings: stats and score history (retired pane)
   Score history and the stats ledger as the old Settings pane drew them; the
   History menu reuses the helpers. */

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
    day: "numeric",
  });
}

function scoreHistoryChartColor(index) {
  const hue = (((index * 53) % 360) + 360) % 360;
  return `hsl(${hue} 70% 54%)`;
}

function createCalendarHiddenStatsContext() {
  const hiddenPaths = [];
  const hiddenSet = new Set();
  const hiddenAncestorSet = new Set();
  const selfOrAncestorMemo = new Map();
  const descendantMemo = new Map();
  const pushFrom = (mapLike) => {
    if (!mapLike || typeof mapLike.keys !== "function") return;
    for (const rawPath of mapLike.keys()) {
      const path = normalizeDirPathValue(rawPath);
      if (!path || hiddenSet.has(path)) continue;
      if (!metaHasHidden(path)) continue;
      hiddenSet.add(path);
      hiddenPaths.push(path);
    }
  };
  pushFrom(WS.meta && WS.meta.dirTags);
  pushFrom(WS.meta && WS.meta.pendingTagsByPath);
  hiddenPaths.sort((a, b) => String(a).localeCompare(String(b)));
  for (let i = 0; i < hiddenPaths.length; i++) {
    const parts = String(hiddenPaths[i] || "").split("/").filter(Boolean);
    for (let j = 1; j < parts.length; j++) {
      hiddenAncestorSet.add(parts.slice(0, j).join("/"));
    }
  }
  return {
    hiddenPaths,
    hiddenSet,
    hiddenAncestorSet,
    selfOrAncestorMemo,
    descendantMemo,
  };
}

function isPathOrAncestorHidden(path, hiddenContext = null) {
  const normalized = normalizeDirPathValue(path);
  if (!normalized) return false;
  if (
    hiddenContext &&
    hiddenContext.selfOrAncestorMemo &&
    hiddenContext.selfOrAncestorMemo.has(normalized)
  )
    return hiddenContext.selfOrAncestorMemo.get(normalized);
  const parts = normalized.split("/").filter(Boolean);
  for (let i = parts.length; i > 0; i--) {
    const current = parts.slice(0, i).join("/");
    const hidden = hiddenContext && hiddenContext.hiddenSet
      ? hiddenContext.hiddenSet.has(current)
      : metaHasHidden(current);
    if (hidden) {
      if (hiddenContext && hiddenContext.selfOrAncestorMemo)
        hiddenContext.selfOrAncestorMemo.set(normalized, true);
      return true;
    }
  }
  if (hiddenContext && hiddenContext.selfOrAncestorMemo)
    hiddenContext.selfOrAncestorMemo.set(normalized, false);
  return false;
}

function calendarPathHasKnownHiddenDescendant(path, hiddenContext = null) {
  const base = normalizeDirPathValue(path);
  if (
    hiddenContext &&
    hiddenContext.descendantMemo &&
    hiddenContext.descendantMemo.has(base)
  )
    return hiddenContext.descendantMemo.get(base);
  const isDescendant = (candidate) => {
    const p = normalizeDirPathValue(candidate);
    if (!p) return false;
    if (!base) return !!p;
    return p !== base && p.startsWith(`${base}/`);
  };
  if (hiddenContext && hiddenContext.hiddenAncestorSet) {
    const hasDescendant = base
      ? hiddenContext.hiddenAncestorSet.has(base)
      : !!(
          Array.isArray(hiddenContext.hiddenPaths) &&
          hiddenContext.hiddenPaths.length
        );
    hiddenContext.descendantMemo.set(base, hasDescendant);
    return hasDescendant;
  }
  const scanMap = (mapLike) => {
    if (!mapLike || typeof mapLike.keys !== "function") return false;
    for (const rawPath of mapLike.keys()) {
      if (!isDescendant(rawPath)) continue;
      if (metaHasHidden(rawPath)) return true;
    }
    return false;
  };
  return scanMap(WS.meta && WS.meta.dirTags) || scanMap(WS.meta && WS.meta.pendingTagsByPath);
}

function calendarSummaryDirectSizeBytes(summary, childDirs) {
  if (!summary) return 0;
  let childSize = 0;
  const children = Array.isArray(childDirs) ? childDirs : [];
  for (let i = 0; i < children.length; i++) {
    const childSummary = getCatalogSummaryForNode(children[i]);
    childSize += Math.max(0, Number(childSummary && childSummary.recursiveSizeBytes) || 0);
  }
  return Math.max(0, Math.max(0, Number(summary.recursiveSizeBytes) || 0) - childSize);
}

function calendarEfficiencyForStats(score, itemCount) {
  const count = Math.max(0, Number(itemCount) || 0);
  if (!count) return 0;
  return (Number(score) || 0) / count;
}

function getCalendarVisibleMetricsForDir(
  dirNode,
  memo = new Map(),
  includeHidden = includeHiddenItemsInStatsEnabled(),
  hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext(),
) {
  if (!dirNode || dirNode.type !== "dir")
    return { score: 0, sizeBytes: 0, itemCount: 0 };
  const path = String(dirNode.path || "");
  const key = `${path}::${includeHidden ? "all" : "visible"}`;
  if (memo.has(key)) return memo.get(key);
  if (!includeHidden && isPathOrAncestorHidden(path, hiddenContext)) {
    const hiddenMetrics = { score: 0, sizeBytes: 0, itemCount: 0 };
    memo.set(key, hiddenMetrics);
    return hiddenMetrics;
  }

  const summary = getCatalogSummaryForNode(dirNode);
  const hasKnownHiddenDescendant = !includeHidden && calendarPathHasKnownHiddenDescendant(path, hiddenContext);
  if (summary && !hasKnownHiddenDescendant) {
    const score = Number(metaGetScore(path)) || 0;
    const itemCount = Math.max(0, Number(summary.recursiveItemCount) || 0);
    const metrics = {
      score,
      sizeBytes: Math.max(0, Number(summary.recursiveSizeBytes) || 0),
      itemCount,
    };
    memo.set(key, metrics);
    return metrics;
  }

  const children = (summary
    ? ensureDirectoryChildNodesFromCatalog(dirNode)
    : Array.isArray(dirNode.childrenDirs)
      ? dirNode.childrenDirs
      : []
  ).filter((child) => child && child.type === "dir");

  let childStoredScoreSum = 0;
  let visibleChildScoreSum = 0;
  let visibleChildSizeSum = 0;
  let visibleChildItemCount = 0;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    const childPath = String(child.path || "");
    childStoredScoreSum += Number(metaGetScore(childPath)) || 0;
    if (!includeHidden && isPathOrAncestorHidden(childPath, hiddenContext)) continue;
    const childMetrics = getCalendarVisibleMetricsForDir(
      child,
      memo,
      includeHidden,
      hiddenContext,
    );
    visibleChildScoreSum += Number(childMetrics.score) || 0;
    visibleChildSizeSum += Number(childMetrics.sizeBytes) || 0;
    visibleChildItemCount += 1 + (Number(childMetrics.itemCount) || 0);
  }

  let directFileSizeSum = 0;
  let directItemCount = 0;
  if (summary) {
    directItemCount = Math.max(0, Number(summary.directFileCount) || 0);
    directFileSizeSum = calendarSummaryDirectSizeBytes(summary, children);
  } else {
    const directFiles = Array.isArray(dirNode.childrenFiles)
      ? dirNode.childrenFiles
      : [];
    for (let i = 0; i < directFiles.length; i++) {
      const rec = WS.fileById.get(directFiles[i]);
      const filePath = normalizeDirPathValue(
        rec && rec.relPath
          ? rec.relPath
          : `${String((rec && rec.dirPath) || "")}${rec && rec.dirPath ? "/" : ""}${String((rec && rec.name) || "")}`,
      );
      if (!includeHidden && filePath && isPathOrAncestorHidden(filePath, hiddenContext))
        continue;
      directItemCount++;
      const fileSize = Number(rec && rec.size);
      if (Number.isFinite(fileSize) && fileSize > 0)
        directFileSizeSum += fileSize;
    }
  }
  const directScore = (Number(metaGetScore(path)) || 0) - childStoredScoreSum;
  const metrics = {
    score: directScore + visibleChildScoreSum,
    sizeBytes: directFileSizeSum + visibleChildSizeSum,
    itemCount: directItemCount + visibleChildItemCount,
  };
  memo.set(key, metrics);
  return metrics;
}

function getVisibleRootFolderScoreRows(
  includeHidden = includeHiddenItemsInStatsEnabled(),
  hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext(),
) {
  const root = WS.root;
  if (!root) return [];
  const rootChildren = ensureDirectoryChildNodesFromCatalog(root);
  if (!Array.isArray(rootChildren)) return [];
  const out = [];
  const metricMemo = new Map();
  for (let i = 0; i < rootChildren.length; i++) {
    const node = rootChildren[i];
    if (!node || node.type !== "dir") continue;
    const path = String(node.path || "");
    if (!includeHidden && isPathOrAncestorHidden(path, hiddenContext)) continue;
    const metrics = getCalendarVisibleMetricsForDir(
      node,
      metricMemo,
      includeHidden,
      hiddenContext,
    );
    const sizeBytes = Math.max(0, Number(metrics.sizeBytes) || 0);
    const score = Number(metrics.score) || 0;
    const itemCount = Math.max(0, Number(metrics.itemCount) || 0);
    out.push({
      path,
      name: dirDisplayName(node),
      score,
      sizeBytes,
      itemCount,
      efficiency: calendarEfficiencyForStats(score, itemCount),
    });
  }
  out.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  return out;
}

function formatSizeOnDisk(bytes) {
  const mb = Math.max(0, Number(bytes) || 0) / (1024 * 1024);
  if (mb >= 1024) {
    const gb = mb / 1024;
    if (gb >= 100) return `${Math.round(gb)} GB`;
    if (gb >= 10) return `${gb.toFixed(1)} GB`;
    return `${gb.toFixed(2)} GB`;
  }
  if (mb >= 100) return `${Math.round(mb)} MB`;
  if (mb >= 10) return `${mb.toFixed(1)} MB`;
  return `${mb.toFixed(2)} MB`;
}

function formatScorePortion(value, hasTotalScore) {
  if (!hasTotalScore) return "—";
  return `${(Number(value) || 0).toFixed(1)}%`;
}

function compareCalendarStatsLedgerRows(a, b, sortKey) {
  let diff = 0;
  if (sortKey === "name") {
    return String(a.name || "").localeCompare(String(b.name || ""));
  } else if (sortKey === "sizeBytes") {
    diff = (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0);
  } else if (sortKey === "itemCount") {
    diff = (Number(b.itemCount) || 0) - (Number(a.itemCount) || 0);
  } else if (sortKey === "efficiency") {
    diff = (Number(b.efficiency) || 0) - (Number(a.efficiency) || 0);
  } else if (sortKey === "scorePortion") {
    diff = (Number(b.scorePortion) || 0) - (Number(a.scorePortion) || 0);
  } else {
    diff = (Number(b.score) || 0) - (Number(a.score) || 0);
  }
  if (diff) return diff;
  const scoreDiff = (Number(b.score) || 0) - (Number(a.score) || 0);
  if (scoreDiff && sortKey !== "score") return scoreDiff;
  const sizeDiff = (Number(b.sizeBytes) || 0) - (Number(a.sizeBytes) || 0);
  if (sizeDiff && sortKey !== "sizeBytes") return sizeDiff;
  const itemCountDiff =
    (Number(b.itemCount) || 0) - (Number(a.itemCount) || 0);
  if (itemCountDiff && sortKey !== "itemCount") return itemCountDiff;
  const efficiencyDiff =
    (Number(b.efficiency) || 0) - (Number(a.efficiency) || 0);
  if (efficiencyDiff && sortKey !== "efficiency") return efficiencyDiff;
  return String(a.name || "").localeCompare(String(b.name || ""));
}

function calendarStatsSortKeyFromDirSortMode(mode) {
  const normalized = normalizeDirSortMode(mode);
  if (normalized === "size-desc") return "sizeBytes";
  if (normalized === "count-recursive") return "itemCount";
  if (normalized === "efficiency") return "efficiency";
  if (normalized === "score") return "score";
  return "name";
}

function calendarStatsSortSpec(sortKey) {
  const key = CALENDAR_STATS_SORT_KEYS.includes(sortKey) ? sortKey : "score";
  if (key === "name")
    return { key, label: "Name", detail: "Folder sort: Name" };
  if (key === "sizeBytes")
    return { key, label: "Size", detail: "On disk" };
  if (key === "itemCount")
    return { key, label: "Items", detail: "Recursive count" };
  if (key === "efficiency")
    return { key, label: "Efficiency", detail: "Score per item" };
  if (key === "scorePortion")
    return { key, label: "Share", detail: "% of score" };
  return { key: "score", label: "Score", detail: "Net score" };
}

function formatStatsLedgerMetric(row, sortKey, hasTotalScore) {
  const key = CALENDAR_STATS_SORT_KEYS.includes(sortKey) ? sortKey : "score";
  if (key === "name") {
    const score = Number(row.score) || 0;
    return score > 0 ? `+${score}` : String(score);
  }
  if (key === "sizeBytes") return formatSizeOnDisk(row.sizeBytes);
  if (key === "itemCount") {
    const count = Math.max(0, Number(row.itemCount) || 0);
    return `${count} item${count === 1 ? "" : "s"}`;
  }
  if (key === "efficiency")
    return `${(Number(row.efficiency) || 0).toFixed(3)}`;
  if (key === "scorePortion")
    return formatScorePortion(row.scorePortion, hasTotalScore);
  const score = Number(row.score) || 0;
  return score > 0 ? `+${score}` : String(score);
}

function buildRootFolderLedgerHtml(rootRows, totalScore, activeSortKey) {
  if (!rootRows.length) {
    return `
          <div class="calendarRankingsEmpty">No root folders available.</div>
        `;
  }

  const hasTotalScore = Math.abs(Number(totalScore) || 0) > 0;
  const sortKey = CALENDAR_STATS_SORT_KEYS.includes(activeSortKey)
    ? activeSortKey
    : "score";
  const ledgerRows = rootRows
    .map((row) => {
      const score = Number(row.score) || 0;
      return {
        ...row,
        scorePortion: hasTotalScore ? (score / totalScore) * 100 : 0,
      };
    })
    .sort((a, b) => compareCalendarStatsLedgerRows(a, b, sortKey));
  const maxAbsScore = Math.max(
    1,
    ...ledgerRows.map((row) => Math.abs(Number(row.score) || 0)),
  );
  const activeSpec = calendarStatsSortSpec(sortKey);
  const rowsHtml = ledgerRows
    .map((row) => {
      const score = Number(row.score) || 0;
      const scoreWidthPct = Math.max(
        0,
        Math.min(50, (Math.abs(score) / maxAbsScore) * 50),
      );
      const scoreLeftPct = score >= 0 ? 50 : Math.max(0, 50 - scoreWidthPct);
      const scoreSignClass = score >= 0 ? "positive" : "negative";
      const metricText = formatStatsLedgerMetric(row, sortKey, hasTotalScore);
      const metricHtml =
        sortKey === "score" || sortKey === "name"
          ? `
              <div class="statsLedgerScoreMetric">
                <span class="statsLedgerNumber">${escapeHtml(metricText)}</span>
                <div class="statsLedgerScoreBar" aria-hidden="true">
                  <div class="statsLedgerScoreFill ${scoreSignClass}" style="left:${scoreLeftPct.toFixed(3)}%;width:${scoreWidthPct.toFixed(3)}%;"></div>
                </div>
              </div>
            `
          : escapeHtml(metricText);
      return `
          <tr class="statsLedgerRow">
            <th scope="row" class="statsLedgerFolderCell" title="${escapeHtml(row.path || "(root)")}" >${escapeHtml(row.name || "(root)")}</th>
            <td class="statsLedgerValueCell${sortKey === "score" ? " statsLedgerScoreCell" : ""}">${metricHtml}</td>
          </tr>
        `;
    })
    .join("");

  return `
        <section class="statsLedgerCard">
          <div class="statsLedgerTableWrap">
            <table class="statsLedgerTable">
              <thead>
                <tr>
                  <th scope="col" class="statsLedgerNameHeader">Folder</th>
                  <th scope="col" class="statsLedgerMetricHeader" aria-sort="descending">${escapeHtml(activeSpec.label)}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>
        </section>
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

function getRootScoreHistoryLinesForEntry(
  entry,
  includeHidden = includeHiddenItemsInStatsEnabled(),
  hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext(),
) {
  const out = [];
  if (!entry || !Array.isArray(entry.changed)) return out;
  const selectedPaths = Array.isArray(entry.selectedPaths)
    ? entry.selectedPaths
    : [];
  if (selectedPaths.length) {
    const changedByPath = new Map();
    for (let i = 0; i < entry.changed.length; i++) {
      const item = entry.changed[i];
      if (!item || typeof item !== "object") continue;
      const itemPath = normalizeDirPathValue(item.path);
      if (!itemPath) continue;
      changedByPath.set(itemPath, item);
    }
    const grouped = new Map();
    for (let i = 0; i < selectedPaths.length; i++) {
      const itemPath = normalizeDirPathValue(selectedPaths[i]);
      if (!itemPath) continue;
      if (!includeHidden && isPathOrAncestorHidden(itemPath, hiddenContext)) continue;
      const rootPath = scoreHistoryRootPathFromChangedPath(itemPath);
      if (!rootPath || (!includeHidden && isPathOrAncestorHidden(rootPath, hiddenContext)))
        continue;
      const change = changedByPath.get(itemPath);
      const delta = change ? Number(change.delta) || 0 : 0;
      if (!delta) continue;
      grouped.set(rootPath, (grouped.get(rootPath) || 0) + delta);
    }
    for (const [rootPath, delta] of grouped.entries()) {
      out.push({
        at: Number(entry.at) || Date.now(),
        eventId: String(entry.id || ""),
        rootPath,
        rootLabel: scoreHistoryRootLabelFromPath(rootPath),
        delta,
      });
    }
    out.sort((a, b) =>
      String(a.rootPath || "").localeCompare(String(b.rootPath || "")),
    );
    return out;
  }
  for (let i = 0; i < entry.changed.length; i++) {
    const item = entry.changed[i];
    if (!item || typeof item !== "object") continue;
    const itemPath = normalizeDirPathValue(item.path);
    if (!itemPath) continue;
    if (!includeHidden && isPathOrAncestorHidden(itemPath, hiddenContext)) continue;
    const depth = itemPath.split("/").filter(Boolean).length;
    if (depth !== 1) continue;
    const delta = Number(item.delta) || 0;
    out.push({
      at: Number(entry.at) || Date.now(),
      eventId: String(entry.id || ""),
      rootPath: itemPath,
      rootLabel: scoreHistoryRootLabelFromPath(itemPath),
      delta,
    });
  }
  return out;
}

function getRootScoreHistoryLinesForDateKey(
  dateKey,
  includeHidden = includeHiddenItemsInStatsEnabled(),
  hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext(),
) {
  const key = String(dateKey || "");
  if (!key) return [];
  const history = normalizeScoreHistoryList(
    WS.meta && Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [],
  );
  const grouped = new Map();
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (scoreHistoryDateKey(entry && entry.at) !== key) continue;
    const rows = getRootScoreHistoryLinesForEntry(entry, includeHidden, hiddenContext);
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      const rootPath = normalizeDirPathValue(row.rootPath);
      if (!rootPath) continue;
      const current =
        grouped.get(rootPath) || {
          rootPath,
          rootLabel: row.rootLabel || scoreHistoryRootLabelFromPath(rootPath),
          delta: 0,
          count: 0,
        };
      current.delta += Number(row.delta) || 0;
      current.count += 1;
      grouped.set(rootPath, current);
    }
  }
  return Array.from(grouped.values()).sort((a, b) => {
    const deltaDiff = Math.abs(Number(b.delta) || 0) - Math.abs(Number(a.delta) || 0);
    if (deltaDiff) return deltaDiff;
    return String(a.rootLabel || "").localeCompare(String(b.rootLabel || ""));
  });
}

function scoreHistoryDayIsToday(dateKey) {
  return String(dateKey || "") === scoreHistoryDateKey(Date.now());
}

function scoreHistoryMonthKeyFromDateKey(dateKey) {
  const m = String(dateKey || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

function scoreHistoryMonthLabel(monthKey) {
  const m = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return String(monthKey || "");
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const dt = new Date(y, mo, 1);
  if (!Number.isFinite(dt.getTime())) return String(monthKey || "");
  return dt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
  });
}

function scoreHistoryDaysInMonth(monthKey) {
  const m = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return 0;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dt = new Date(y, mo, 0);
  return Number.isFinite(dt.getTime()) ? dt.getDate() : 0;
}

function scoreHistoryHeatClass(delta) {
  const value = Number(delta) || 0;
  if (!value) return "heatZero";
  const level = Math.max(1, Math.min(6, Math.ceil(Math.abs(value))));
  return `${value > 0 ? "heatPos" : "heatNeg"}${level}`;
}

function buildScoreHistoryMonthPageHtml(monthKey, dayMap) {
  const days = scoreHistoryDaysInMonth(monthKey);
  if (!days) return "";
  let totalEvents = 0;
  let totalDelta = 0;
  const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = weekdayLabels.map(
    (label) => `<div class="scoreHistoryWeekday">${escapeHtml(label)}</div>`,
  );
  const m = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  const firstDate = m ? new Date(Number(m[1]), Number(m[2]) - 1, 1) : null;
  const leading =
    firstDate && Number.isFinite(firstDate.getTime()) ? firstDate.getDay() : 0;
  for (let i = 0; i < leading; i++) {
    cells.push(`<div class="scoreHistoryCalendarDay isBlank" aria-hidden="true"></div>`);
  }
  for (let day = 1; day <= days; day++) {
    const dayKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    const info = dayMap.get(dayKey) || { delta: 0, count: 0 };
    const delta = Number(info.delta) || 0;
    const count = Math.max(0, Number(info.count) || 0);
    totalEvents += count;
    totalDelta += delta;
    const hasScore = !!count;
    const hasJournal = metaDailyJournalHasUserContent(dayKey);
    const heatClass = hasScore ? scoreHistoryHeatClass(delta) : "";
    const deltaShown = delta > 0 ? `+${delta}` : String(delta);
    const titleParts = [
      hasScore
        ? `${deltaShown} net score change across ${count} change${count === 1 ? "" : "s"}`
        : "no score changes",
    ];
    if (hasJournal) titleParts.push("journal");
    const title = `${scoreHistoryDateLabel(dayKey)}: ${titleParts.join("; ")}`;
    cells.push(`
      <div
        class="scoreHistoryCalendarDay${hasScore ? ` hasScore ${heatClass}` : ""}${hasJournal ? " hasJournal" : ""}"
        data-score-history-day="${escapeHtml(dayKey)}"
        title="${escapeHtml(title)}"
        aria-label="${escapeHtml(title)}"
      >
        <span class="scoreHistoryCalendarDayNumber">${escapeHtml(String(day))}</span>
        ${hasScore ? `<span class="scoreHistoryCalendarDayDelta">${escapeHtml(deltaShown)}</span>` : ""}
      </div>
    `);
  }
  const trailing = (7 - ((leading + days) % 7)) % 7;
  for (let i = 0; i < trailing; i++) {
    cells.push(`<div class="scoreHistoryCalendarDay isBlank" aria-hidden="true"></div>`);
  }
  const totalDeltaShown = totalDelta > 0 ? `+${totalDelta}` : String(totalDelta);
  return `
    <section class="scoreHistoryMonth">
      <div class="scoreHistoryMonthHeader">
        <h2>${escapeHtml(scoreHistoryMonthLabel(monthKey))}</h2>
        <div class="scoreHistoryMonthMeta">${escapeHtml(totalDeltaShown)} net • ${escapeHtml(String(totalEvents))} change${totalEvents === 1 ? "" : "s"}</div>
      </div>
      <div class="scoreHistoryCalendarGrid">
        ${cells.join("")}
      </div>
    </section>
  `;
}

function renderCalendarUi() {
  if (!calendarBodyEl) return;
  const history = normalizeScoreHistoryList(
    WS.meta && Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [],
  );
  WS.meta.scoreHistory = history;
  const includeHidden = includeHiddenItemsInStatsEnabled();
  const hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext();
  const rootRows = getVisibleRootFolderScoreRows(includeHidden, hiddenContext);
  const totalScore = rootRows.reduce(
    (sum, row) => sum + (Number(row.score) || 0),
    0,
  );
  const activeSortKey = calendarStatsSortKeyFromDirSortMode(
    WS.meta && WS.meta.dirSortMode,
  );
  const grouped = new Map();
  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    const rows = getRootScoreHistoryLinesForEntry(entry, includeHidden, hiddenContext);
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      const dayKey = scoreHistoryDateKey(row.at);
      const monthKey = scoreHistoryMonthKeyFromDateKey(dayKey);
      if (!monthKey) continue;
      if (!grouped.has(monthKey)) grouped.set(monthKey, new Map());
      const monthDays = grouped.get(monthKey);
      const current = monthDays.get(dayKey) || { delta: 0, count: 0 };
      current.delta += Number(row.delta) || 0;
      current.count += 1;
      monthDays.set(dayKey, current);
    }
  }
  const journalDateKeys = metaGetDailyJournalDateKeys();
  for (let i = 0; i < journalDateKeys.length; i++) {
    const dayKey = journalDateKeys[i];
    const monthKey = scoreHistoryMonthKeyFromDateKey(dayKey);
    if (!monthKey) continue;
    if (!grouped.has(monthKey)) grouped.set(monthKey, new Map());
    const monthDays = grouped.get(monthKey);
    if (!monthDays.has(dayKey)) monthDays.set(dayKey, { delta: 0, count: 0 });
  }
  const monthKeys = Array.from(grouped.keys()).sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
  const historyHtml = monthKeys.length
    ? monthKeys
        .map((monthKey) =>
          buildScoreHistoryMonthPageHtml(monthKey, grouped.get(monthKey)),
        )
        .join("")
    : `<div class="scoreHistoryEmpty">No score changes logged yet.</div>`;
  calendarBodyEl.innerHTML = `
        <div class="statsSinglePage">
          <section class="statsHistoryCard">
            ${historyHtml}
          </section>
          ${buildRootFolderLedgerHtml(rootRows, totalScore, activeSortKey)}
        </div>
      `;
  if (calendarDeleteAllBtn) calendarDeleteAllBtn.disabled = !history.length;
  applyMenuTransientFocusBehavior(calendarBodyEl);
}
