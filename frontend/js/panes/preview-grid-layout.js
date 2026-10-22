/* Preview grid layout
   Grid tracks, fit-inside rows and the virtualized file grid. */

function normalizePreviewAspect(value, fallback = 4 / 3) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(0.2, Math.min(6, n));
}

function previewRowTargetHeight() {
  const size = "medium";
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const scaleMult = getActiveThumbnailScaleMultiplier(opt);
  const scaled = (base) => Math.max(96, Math.round(base * scaleMult));
  if (size === "small") return scaled(180);
  if (size === "large") return scaled(280);
  return scaled(230);
}

function getPreviewAspectForRecord(rec) {
  if (!rec) return 4 / 3;
  return normalizePreviewAspect(
    rec.previewAspect ||
      rec.thumbAspect ||
      rec.videoAspect ||
      rec.aspectRatio ||
      rec.aspect,
    4 / 3,
  );
}

function applyFitInsideJustifiedLayout(gridEl) {
  if (!gridEl || !gridEl.classList.contains("fitInsideJustified")) return;
  const cards = Array.from(gridEl.querySelectorAll(".fitInsideCard")).filter(
    (card) =>
      !card.classList.contains("drag-placeholder") &&
      !card.classList.contains("drag-hidden"),
  );
  if (!cards.length) return;

  const computed = getComputedStyle(gridEl);
  const gapRaw = parseFloat(computed.columnGap || computed.gap || "0");
  const gap = Number.isFinite(gapRaw) && gapRaw >= 0 ? gapRaw : 0;
  const gridWidth = Math.max(1, Math.floor(gridEl.clientWidth));
  const targetH = previewRowTargetHeight();
  const minH = Math.max(88, Math.round(targetH * 0.86));
  const maxH = Math.max(minH, Math.round(targetH * 1.14));
  const aspects = cards.map((card) =>
    normalizePreviewAspect(card.dataset.aspect, 4 / 3),
  );
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
    const crowdPenalty =
      fitted < minH ? ((minH - fitted) / Math.max(1, targetH)) * 4.2 : 0;
    const sparsePenalty =
      !lastRow && fitted > maxH
        ? ((fitted - maxH) / Math.max(1, targetH)) * 2.6
        : 0;
    const singlePenalty = rowCount === 1 ? (lastRow ? 0.7 : 2.5) : 0;
    return (
      fillError * (lastRow ? 0.55 : 1.75) +
      scaleError * 0.95 +
      crowdPenalty +
      sparsePenalty +
      singlePenalty
    );
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
          .sort((a, b) => (delta > 0 ? b.frac - a.frac : a.frac - b.frac));
        let guard = 0;
        while (
          delta !== 0 &&
          guard < Math.abs(delta) * Math.max(1, order.length)
        ) {
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
      if (!isLast && count > 1 && fitted < minH * 0.72) break;
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
  const grids = Array.from(
    previewBodyEl.querySelectorAll(".fitInsideJustified"),
  );
  for (const grid of grids) applyFitInsideJustifiedLayout(grid);
}

// The smallest a card may get. Low enough for Thumbnail size: Extra small
// (0.4 of Medium: 104px folders, 72px files) to take effect.
const PREVIEW_GRID_MIN_CARD_PX = 64;

function previewGridMinCardSizePx(grid, kind) {
  if (!grid || typeof getComputedStyle !== "function") return 0;
  const cs = getComputedStyle(grid);
  const baseVar = kind === "folder" ? "--folder-grid-min" : "--file-grid-min";
  const scaleVar =
    kind === "folder" ? "--thumb-scale-folder" : "--thumb-scale-media";
  const fallback = kind === "folder" ? 260 : 180;
  const base = parseFloat(cs.getPropertyValue(baseVar) || String(fallback));
  const scale = parseFloat(cs.getPropertyValue(scaleVar) || "1");
  const size = (Number.isFinite(base) ? base : fallback) *
    (Number.isFinite(scale) && scale > 0 ? scale : 1);
  return Math.max(PREVIEW_GRID_MIN_CARD_PX, Math.round(size));
}

function previewGridTrackMetrics(grid, kind = "") {
  if (!grid || !grid.classList) return;
  const resolvedKind =
    kind ||
    (grid.classList.contains("gridFolders")
      ? "folder"
      : grid.classList.contains("gridFiles")
        ? "file"
        : "");
  if (!resolvedKind) return null;
  const cs = getComputedStyle(grid);
  const gap = Math.max(0, parseFloat(cs.columnGap || cs.gap || "0") || 0);
  const minCard = previewGridMinCardSizePx(grid, resolvedKind);
  const width = Math.max(1, Number(grid.clientWidth) || 1);
  // Treat the configured card size as a *target*, not a floor: pick the column
  // count whose resulting card width lands closest to it. Rounding (instead of
  // flooring) means a new column is added once cards drift ~halfway past the
  // target, so thumbs stay near a consistent size and the wrap/row length
  // shifts as the pane resizes — rather than a fixed column count letting each
  // card scale up toward 2x before a column finally pops in.
  const cols = Math.max(
    1,
    Math.round((width + gap) / Math.max(1, minCard + gap)),
  );
  const colWidth = Math.max(
    PREVIEW_GRID_MIN_CARD_PX,
    (width - gap * Math.max(0, cols - 1)) / cols,
  );
  return { gap, cols, colWidth, minCard, width };
}

function applyPreviewGridTracks(grid) {
  if (!grid || !grid.classList) return;
  if (grid.classList.contains("fitInsideJustified")) {
    grid.style.removeProperty("grid-template-columns");
    return;
  }
  const metrics = previewGridTrackMetrics(grid);
  if (!metrics) return;
  const track = `repeat(${metrics.cols}, minmax(0, 1fr))`;
  if (grid.style.gridTemplateColumns !== track)
    grid.style.gridTemplateColumns = track;
  // The width a card actually gets, for anything sized in cards (the float
  // spacer: half a row).
  const cardSize = `${Math.round(metrics.colWidth * 100) / 100}px`;
  if (grid.style.getPropertyValue("--preview-card-size") !== cardSize)
    grid.style.setProperty("--preview-card-size", cardSize);
}

function refreshPreviewGridTracks() {
  if (!previewBodyEl) return;
  const grids = previewBodyEl.querySelectorAll(".gridFolders, .gridFiles");
  grids.forEach((grid) => applyPreviewGridTracks(grid));
}

function clearPreviewFileVirtualizers() {
  ACTIVE_PREVIEW_FILE_VIRTUALIZERS = [];
}

function previewFileIdsContainVideos(ids) {
  const list = Array.isArray(ids) ? ids : [];
  for (let i = 0; i < list.length; i++) {
    const rec = WS.fileById.get(String(list[i] || ""));
    if (rec && rec.type === "video") return true;
  }
  return false;
}

function previewFileIdsVideoCount(ids, stopAfter = Number.POSITIVE_INFINITY) {
  const list = Array.isArray(ids) ? ids : [];
  const limit = Math.max(1, Number(stopAfter) || Number.POSITIVE_INFINITY);
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    const rec = WS.fileById.get(String(list[i] || ""));
    if (!(rec && rec.type === "video")) continue;
    count++;
    if (count >= limit) return count;
  }
  return count;
}

function shouldVirtualizePreviewFilesGrid(
  ids,
  useFitInsideJustified,
  dirNode,
  opts = null,
) {
  const list = Array.isArray(ids) ? ids : [];
  const options = opts && typeof opts === "object" ? opts : {};
  const hasVideos = previewFileIdsContainVideos(list);
  const threshold = hasVideos
    ? options.folderMediaPreviewGrid
      ? 48
      : 72
    : options.folderMediaPreviewGrid
      ? 120
      : 220;
  if (list.length < threshold) return false;
  if (useFitInsideJustified) return false;
  if (dirNode && canReorderFilesInPreviewDir(dirNode)) return false;
  return true;
}

function measurePreviewFilesGridMetrics(grid, useSquareMediaCards = false) {
  if (!grid) return null;
  applyPreviewGridTracks(grid);
  const metrics = previewGridTrackMetrics(grid, "file");
  if (!metrics) return null;
  const { gap, cols, colWidth } = metrics;
  const rowHeight = useSquareMediaCards
    ? Math.max(120, Math.round(colWidth))
    : Math.max(150, Math.round(colWidth * 0.75 + 74));
  const rowStride = rowHeight + gap;
  return { gap, cols, colWidth, rowHeight, rowStride };
}

function previewVirtualSkippedRowsHeight(rowCount, metrics) {
  const count = Math.max(0, Math.round(Number(rowCount) || 0));
  if (!count || !metrics) return 0;
  const rowHeight = Math.max(1, Number(metrics.rowHeight) || 1);
  const gap = Math.max(0, Number(metrics.gap) || 0);
  return Math.max(0, count * (rowHeight + gap) - gap);
}

function offsetTopWithinAncestor(el, ancestor) {
  let top = 0;
  let node = el;
  while (node && node !== ancestor) {
    top += Number(node.offsetTop || 0);
    node = node.offsetParent;
  }
  return top;
}

function computePreviewFilesVirtualWindow(state) {
  if (!state || !state.grid || !previewBodyEl) return null;
  const metrics = measurePreviewFilesGridMetrics(
    state.grid,
    state.useSquareMediaCards,
  );
  if (!metrics) return null;
  const totalRows = Math.max(
    1,
    Math.ceil(state.ids.length / Math.max(1, metrics.cols)),
  );
  const gridTop = offsetTopWithinAncestor(state.grid, previewBodyEl);
  const viewTop = Math.max(0, (previewBodyEl.scrollTop || 0) - gridTop);
  const viewportRows = Math.max(
    1,
    Math.ceil(
      ((previewBodyEl.clientHeight || 1) + metrics.gap) /
        Math.max(1, metrics.rowStride || metrics.rowHeight),
    ),
  );
  // Overscan a few rows above and below the viewport so rows are materialized
  // (and their thumbnails start loading) before the keyboard selection jumps
  // them into view — combined with card reuse in updateVirtualPreviewFilesGrid
  // this prevents the grey-row strobe while scrolling.
  const OVERSCAN_ROWS = 4;
  const startRow = Math.max(
    0,
    Math.floor(viewTop / Math.max(1, metrics.rowStride || metrics.rowHeight)) -
      OVERSCAN_ROWS,
  );
  const endRow = Math.min(
    totalRows - 1,
    startRow + viewportRows + OVERSCAN_ROWS * 2,
  );
  return {
    metrics,
    startIndex: startRow * metrics.cols,
    endIndexExclusive: Math.min(state.ids.length, (endRow + 1) * metrics.cols),
    topSpacerHeight: previewVirtualSkippedRowsHeight(startRow, metrics),
    bottomSpacerHeight: previewVirtualSkippedRowsHeight(
      Math.max(0, totalRows - endRow - 1),
      metrics,
    ),
  };
}

function appendVirtualGridSpacer(grid, heightPx) {
  const height = Math.max(0, Math.round(Number(heightPx) || 0));
  if (!grid || height <= 0) return;
  const spacer = document.createElement("div");
  spacer.className = "virtualGridSpacer";
  spacer.setAttribute("aria-hidden", "true");
  spacer.style.height = `${height}px`;
  grid.appendChild(spacer);
}

function softenFolderMediaPreviewCardChrome(card) {
  if (!card || !card.querySelectorAll) return;
  card.classList.add("folderMediaPreviewCard");
  // Use the same frosted title-strip treatment as the rest of the grid —
  // a hard solid black here made navigation feel "heavy" and fought the
  // fixed 30% glass look.
  const metas = card.querySelectorAll(".previewThumbOverlayMeta");
  metas.forEach((meta) => {
    if (!meta || !meta.style || !meta.classList) return;
    forcePreviewPaneThumbTitleBar(meta);
  });
}

function updateVirtualPreviewFilesGrid(state, force = false) {
  if (!state || !state.grid || !state.grid.isConnected) return;
  if (state.renderToken !== PREVIEW_FILES_RENDER_TOKEN) return;
  const windowInfo = computePreviewFilesVirtualWindow(state);
  if (!windowInfo) return;
  if (
    !force &&
    state.currentStart === windowInfo.startIndex &&
    state.currentEnd === windowInfo.endIndexExclusive
  ) {
    return;
  }
  const grid = state.grid;

  // Reuse card nodes across scroll updates. Previously the whole window was
  // rebuilt (grid.innerHTML = "") on every shift, so a single keyboard row jump
  // destroyed and recreated every visible card — their <img>s reloaded and
  // re-faded, producing a grey-row strobe. Here, cards already in the window
  // are kept (moved, never disconnected, so their loaded thumbnails persist);
  // only rows entering the window are built and rows leaving are released.
  const prevCards = state.cardById instanceof Map ? state.cardById : new Map();
  const nextCards = new Map();
  const orderedCards = [];
  for (let i = windowInfo.startIndex; i < windowInfo.endIndexExclusive; i++) {
    const id = state.ids[i];
    const rec = WS.fileById.get(id);
    if (!rec) continue;
    let card = prevCards.get(id);
    if (!card) {
      card = makePreviewFileCard(
        rec,
        false,
        state.dirNode,
        state.ids,
        state.useFitInsideJustified,
        state.useSquareMediaCards,
        state.fileDisplayPositions instanceof Map
          ? state.fileDisplayPositions.get(String(id || ""))
          : null,
        {
          passiveVideoThumbs: !!state.passiveVideoThumbs,
          folderMediaPreviewGrid: !!state.folderMediaPreviewGrid,
          renderToken: state.renderToken,
        },
      );
      if (state.folderMediaPreviewGrid) softenFolderMediaPreviewCardChrome(card);
    }
    nextCards.set(id, card);
    orderedCards.push(card);
  }

  // Release cards that scrolled out of the window (free their thumbnail slots).
  for (const [id, card] of prevCards) {
    if (nextCards.has(id)) continue;
    try {
      const media = card.querySelectorAll(".thumb, .folderThumb");
      for (let m = 0; m < media.length; m++) evictThumbEl(media[m]);
    } catch {}
    if (card.parentNode) card.parentNode.removeChild(card);
  }

  // Reuse two stable spacer nodes as the top/bottom anchors.
  let topSpacer = state.topSpacer;
  if (!topSpacer || topSpacer.parentNode !== grid) {
    topSpacer = document.createElement("div");
    topSpacer.className = "virtualGridSpacer";
    topSpacer.setAttribute("aria-hidden", "true");
    state.topSpacer = topSpacer;
  }
  let bottomSpacer = state.bottomSpacer;
  if (!bottomSpacer || bottomSpacer.parentNode !== grid) {
    bottomSpacer = document.createElement("div");
    bottomSpacer.className = "virtualGridSpacer";
    bottomSpacer.setAttribute("aria-hidden", "true");
    state.bottomSpacer = bottomSpacer;
  }
  topSpacer.style.height = `${Math.max(0, Math.round(windowInfo.topSpacerHeight))}px`;
  bottomSpacer.style.height = `${Math.max(0, Math.round(windowInfo.bottomSpacerHeight))}px`;

  // Reconcile DOM order to: topSpacer, ...orderedCards, bottomSpacer.
  // insertBefore on an already-connected node moves it without disconnecting,
  // so reused cards never lose their loaded <img> state.
  if (grid.firstChild !== topSpacer) {
    grid.insertBefore(topSpacer, grid.firstChild);
  }
  let cursor = topSpacer.nextSibling;
  for (let i = 0; i < orderedCards.length; i++) {
    const card = orderedCards[i];
    if (cursor === card) {
      cursor = card.nextSibling;
      continue;
    }
    grid.insertBefore(card, cursor);
  }
  if (cursor !== bottomSpacer) {
    grid.insertBefore(bottomSpacer, cursor);
  }
  while (bottomSpacer.nextSibling) {
    grid.removeChild(bottomSpacer.nextSibling);
  }

  state.cardById = nextCards;
  state.currentStart = windowInfo.startIndex;
  state.currentEnd = windowInfo.endIndexExclusive;

  const section = expandedPreviewSectionForCard(state.grid);
  if (section) uniquifyExpandedSectionContentSelectionKeys(section);
  applyPendingPreviewSelectionForCurrentTarget();
  ensurePreviewSelectionForCurrentTarget(false);
  scheduleDeferredPreviewVideoThumbUpgrade(140);
  reprioritizeThumbs();
  state.animate = false;
}

function registerPreviewFileVirtualizer(state) {
  if (!state) return;
  ACTIVE_PREVIEW_FILE_VIRTUALIZERS.push(state);
  updateVirtualPreviewFilesGrid(state, true);
}

function schedulePreviewVirtualGridRefresh() {
  if (!ACTIVE_PREVIEW_FILE_VIRTUALIZERS.length) return;
  if (PREVIEW_VIRTUAL_SCROLL_RAF) return;
  PREVIEW_VIRTUAL_SCROLL_RAF = requestAnimationFrame(() => {
    PREVIEW_VIRTUAL_SCROLL_RAF = 0;
    const list = ACTIVE_PREVIEW_FILE_VIRTUALIZERS.slice();
    for (let i = 0; i < list.length; i++)
      updateVirtualPreviewFilesGrid(list[i], false);
  });
}

function revealPendingPreviewSelectionInVirtualGrid(selectionKey) {
  const key = String(selectionKey || "");
  const fileTarget = parsePreviewFileSelectionKey(key);
  if (!fileTarget || !previewBodyEl) return false;
  const fileId = fileTarget.fileId;
  if (!fileId) return false;
  for (let i = 0; i < ACTIVE_PREVIEW_FILE_VIRTUALIZERS.length; i++) {
    const state = ACTIVE_PREVIEW_FILE_VIRTUALIZERS[i];
    if (!state || !Array.isArray(state.ids) || !state.grid) continue;
    if (
      fileTarget.dirPath &&
      String(state.dirNode?.path || "") !== fileTarget.dirPath
    )
      continue;
    const itemIndex = state.ids.indexOf(fileId);
    if (itemIndex < 0) continue;
    const windowInfo = computePreviewFilesVirtualWindow(state);
    if (!windowInfo || !windowInfo.metrics) return false;
    const cols = Math.max(1, Number(windowInfo.metrics.cols) || 1);
    const rowHeight = Math.max(1, Number(windowInfo.metrics.rowHeight) || 1);
    const rowStride = Math.max(
      1,
      Number(windowInfo.metrics.rowStride) || rowHeight,
    );
    const targetRow = Math.floor(itemIndex / cols);
    const gridTop = offsetTopWithinAncestor(state.grid, previewBodyEl);
    const desiredTop =
      gridTop +
      targetRow * rowStride -
      Math.max(0, Math.floor((previewBodyEl.clientHeight || 0) * 0.35));
    const maxTop = Math.max(
      0,
      previewBodyEl.scrollHeight - previewBodyEl.clientHeight,
    );
    previewBodyEl.scrollTop = Math.max(0, Math.min(maxTop, desiredTop));
    updateVirtualPreviewFilesGrid(state, true);
    return true;
  }
  return false;
}

function preferredImmediatePreviewRenderCount(ids, fallbackCount) {
  const baseCount = Math.max(1, Math.floor(Number(fallbackCount) || 1));
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return baseCount;
  let last = -1;
  for (const key of previewKeysToDrawFirst()) {
    const target = parsePreviewFileSelectionKey(key);
    const index = target && target.fileId ? list.indexOf(target.fileId) : -1;
    if (index > last) last = index;
  }
  return last >= 0 ? Math.max(baseCount, last + 1) : baseCount;
}

function renderFilesGrid(
  ids,
  container,
  animate,
  dirNode,
  renderToken = PREVIEW_FILES_RENDER_TOKEN,
  fileDisplayPositions = null,
  opts = null,
) {
  const LIMIT = 800;
  if (!ids.length) return 0;

  const grid = document.createElement("div");
  grid.className = "gridFiles";
  const options = opts && typeof opts === "object" ? opts : {};
  const folderMediaPreviewGrid = !!options.folderMediaPreviewGrid;
  const useNaturalAspectCards = naturalAspectThumbnailCardsEnabled();
  const useSquareMediaCards = previewSquareMediaThumbsEnabled();
  const useFitInsideJustified = !useSquareMediaCards;
  const videoCount = previewFileIdsVideoCount(
    ids,
    PREVIEW_VIDEO_THUMB_HEAVY_COUNT,
  );
  const passiveVideoThumbs =
    folderMediaPreviewGrid &&
    videoCount >= PREVIEW_VIDEO_THUMB_HEAVY_COUNT;
  if (folderMediaPreviewGrid) grid.classList.add("folderMediaPreviewGrid");
  if (useFitInsideJustified) grid.classList.add("fitInsideJustified");
  if (useSquareMediaCards) grid.classList.add("previewSquareCards");
  if (useNaturalAspectCards) grid.classList.add("previewNaturalAspectCards");
  if (dirNode && canReorderFilesInPreviewDir(dirNode))
    setupPreviewGridDrag(grid);
  container.appendChild(grid);
  if (!useFitInsideJustified) applyPreviewGridTracks(grid);

  if (
    shouldVirtualizePreviewFilesGrid(ids, useFitInsideJustified, dirNode, {
      folderMediaPreviewGrid,
    })
  ) {
    registerPreviewFileVirtualizer({
      grid,
      ids: ids.slice(),
      dirNode,
      animate: !!animate,
      renderToken,
      useFitInsideJustified,
      useSquareMediaCards,
      fileDisplayPositions:
        fileDisplayPositions instanceof Map ? new Map(fileDisplayPositions) : null,
      folderMediaPreviewGrid,
      passiveVideoThumbs,
      currentStart: -1,
      currentEnd: -1,
    });
    return ids.length;
  }

  const visibleIds = ids.slice(0, LIMIT);
  const totalToRender = visibleIds.length;
  if (!totalToRender) return 0;
  // Prefer painting the whole visible set in one shot for typical folders —
  // chunked rAF fill made open/close feel laggy even with only a few dozen cards.
  const INSTANT_FULL_RENDER_LIMIT = 120;
  const FIRST_CHUNK = passiveVideoThumbs ? 16 : 48;
  const NEXT_CHUNK = passiveVideoThumbs ? 12 : 36;
  const preferFullFirstPaint =
    totalToRender <= INSTANT_FULL_RENDER_LIMIT && !passiveVideoThumbs;
  const firstChunkSize = preferFullFirstPaint
    ? totalToRender
    : Math.min(
        totalToRender,
        preferredImmediatePreviewRenderCount(visibleIds, FIRST_CHUNK),
      );
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
      // Card enter animation kept cards at opacity:0 without a reliable
      // remove path and cost layout for no gain during fast nav — never animate.
      const card = makePreviewFileCard(
        rec,
        false,
        dirNode,
        visibleIds,
        useFitInsideJustified,
        useSquareMediaCards,
        fileDisplayPositions instanceof Map
          ? fileDisplayPositions.get(String(id || ""))
          : null,
        {
          passiveVideoThumbs,
          folderMediaPreviewGrid,
          renderToken,
        },
      );
      if (folderMediaPreviewGrid) softenFolderMediaPreviewCardChrome(card);
      frag.appendChild(card);
      chunkCount++;
    }
    if (frag.childNodes.length) {
      grid.appendChild(frag);
      const section = expandedPreviewSectionForCard(grid);
      if (section) uniquifyExpandedSectionContentSelectionKeys(section);
      applyPendingPreviewSelectionForCurrentTarget();
      ensurePreviewSelectionForCurrentTarget(false);
    }
    if (useFitInsideJustified && (!didFirstLayout || index >= totalToRender)) {
      applyFitInsideJustifiedLayout(grid);
      didFirstLayout = true;
    }
    if (index < totalToRender) {
      requestAnimationFrame(() => {
        if (renderToken !== PREVIEW_FILES_RENDER_TOKEN) return;
        if (!grid.isConnected) return;
        renderChunk(
          responsiveNavigationGuardActive()
            ? Math.max(6, Math.floor(NEXT_CHUNK / 2))
            : NEXT_CHUNK,
        );
      });
    }
  };

  renderChunk(firstChunkSize);
  return totalToRender;
}

// The pane's "nothing here" message: a large icon over a line of large
// text, centred in the pane (`.previewEmptyState`).
function makePreviewEmptyState(text, iconKey) {
  const empty = document.createElement("div");
  empty.className = "previewEmptyState";
  const icon = document.createElement("div");
  icon.className = "previewEmptyStateIcon";
  icon.innerHTML = APP_ICON_SVGS[iconKey] || APP_ICON_SVGS.folder;
  const label = document.createElement("div");
  label.className = "previewEmptyStateText";
  label.textContent = String(text || "");
  empty.append(icon, label);
  return empty;
}
