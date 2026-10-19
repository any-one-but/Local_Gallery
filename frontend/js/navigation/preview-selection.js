/* Preview selection
   The grid cursor: selecting, revealing and moving between cards. */

function currentPreviewSelectionContextKeyFromState(state = null) {
  const src = state && typeof state === "object" ? state : WS.preview;
  if (!src || !src.kind) return "none";
  if (src.kind === "dir" && src.dirNode)
    return `dir:${String(src.dirNode.path || "")}`;
  if (src.kind === "file" && src.fileId)
    return `file:${String(src.fileId || "")}`;
  return "none";
}

function clearPreviewSelectionState(contextKey = null) {
  if (!WS.view) return;
  WS.view.previewSelectAnchorKey = "";
  WS.view.previewSelectedKey = "";
  WS.view.previewSelectionContextKey = String(
    contextKey || currentPreviewSelectionContextKeyFromState() || "none",
  );
}

function previewThumbnailSelectionEnabled() {
  return true;
}

function applyPendingPreviewSelectionForCurrentTarget() {
  if (!WS.view) return false;
  if (!previewThumbnailSelectionEnabled()) {
    WS.view.pendingPreviewSelectionKey = "";
    clearPreviewSelectionState(currentPreviewSelectionContextKeyFromState());
    return false;
  }
  const nextKey = String(WS.view.pendingPreviewSelectionKey || "");
  if (!nextKey) return false;
  if (parsePreviewFileSelectionKey(nextKey)) {
    revealPendingPreviewSelectionInVirtualGrid(nextKey);
  }
  const card = findPreviewSelectableCardByKey(nextKey);
  if (!card) return false;
  WS.view.pendingPreviewSelectionKey = "";
  WS.view.previewSelectionContextKey =
    currentPreviewSelectionContextKeyFromState();
  WS.view.previewSelectedKey = String(card.dataset.previewItemKey || nextKey);
  return true;
}

function notePreviewTargetChanged(nextState = null) {
  bumpThumbnailDemandToken();
  clearPreviewSelectionState(
    currentPreviewSelectionContextKeyFromState(nextState),
  );
  if (!directoriesPaneOpenEnabled()) {
    setActivePane("preview");
  } else if (
    WS.view.activePane !== "directories" &&
    WS.view.activePane !== "preview"
  ) {
    setActivePane("directories");
  }
  updateTitleLabel();
}

function getPreviewSelectableCards() {
  if (!previewBodyEl) return [];
  if (!previewThumbnailSelectionEnabled()) return [];
  return Array.from(previewBodyEl.querySelectorAll("[data-preview-item-key]"));
}

function getPreviewItemCards() {
  if (!previewBodyEl) return [];
  return Array.from(previewBodyEl.querySelectorAll("[data-preview-item-key]"));
}

function getPreviewCardRelativeRect(card) {
  if (!card || !previewBodyEl || !card.getBoundingClientRect) return null;
  const containerRect = previewBodyEl.getBoundingClientRect();
  const rect = card.getBoundingClientRect();
  const width = Number(rect.width || 0);
  const height = Number(rect.height || 0);
  if (width <= 0 || height <= 0) return null;
  const left = rect.left - containerRect.left + (previewBodyEl.scrollLeft || 0);
  const top = rect.top - containerRect.top + (previewBodyEl.scrollTop || 0);
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

function getPreviewSelectableCardMetrics() {
  if (!previewBodyEl) return [];
  const cards = getPreviewSelectableCards();
  const out = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const key = String(card?.dataset?.previewItemKey || "");
    const rect = getPreviewCardRelativeRect(card);
    if (!key || !rect) continue;
    out.push({
      key,
      card,
      cx: rect.left + rect.width * 0.5,
      cy: rect.top + rect.height * 0.5,
    });
  }
  return out;
}

function cssEscapeValue(value) {
  const raw = String(value || "");
  if (typeof CSS !== "undefined" && CSS && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

function makeExpandedPreviewFileSelectionKey(fileId, dirPath) {
  const id = String(fileId || "");
  if (!id) return "";
  return `file:${id}`;
}

function parsePreviewFileSelectionKey(key) {
  const raw = String(key || "");
  if (raw.startsWith("file:")) {
    const fileId = raw.slice(5);
    return fileId ? { fileId, dirPath: "" } : null;
  }
  if (!raw.startsWith("expanded-file:")) return null;
  const rest = raw.slice("expanded-file:".length);
  const split = rest.indexOf(":");
  if (split < 0) return null;
  try {
    const dirPath = decodeURIComponent(rest.slice(0, split));
    const fileId = decodeURIComponent(rest.slice(split + 1));
    return fileId ? { fileId, dirPath } : null;
  } catch {
    return null;
  }
}

function findPreviewSelectableCardByKey(key) {
  const targetKey = String(key || "");
  if (!targetKey || !previewBodyEl) return null;
  const exact = getPreviewSelectableCards().find(
    (card) => String(card?.dataset?.previewItemKey || "") === targetKey,
  );
  if (exact) return exact;
  if (targetKey.startsWith("dir:")) {
    const p = targetKey.slice(4);
    if (p) {
      return previewBodyEl.querySelector(
        `[data-preview-item-kind="dir"][data-dir-path="${cssEscapeValue(p)}"]`,
      );
    }
  }
  const fileTarget = parsePreviewFileSelectionKey(targetKey);
  if (fileTarget) {
    const candidates = Array.from(
      previewBodyEl.querySelectorAll(
        `[data-preview-item-kind="file"][data-file-id="${cssEscapeValue(fileTarget.fileId)}"]`,
      ),
    );
    if (fileTarget.dirPath) {
      const match = candidates.find((card) => {
        const section = expandedPreviewSectionForCard(card);
        return String(section?.dataset?.path || "") === fileTarget.dirPath;
      });
      if (match) return match;
    }
    return candidates[0] || null;
  }
  return null;
}

function findSelectedPreviewCard() {
  return findPreviewSelectableCardByKey(WS.view && WS.view.previewSelectedKey);
}

function previewDirPathForCard(card) {
  if (!card || !card.dataset) return "";
  const direct = String(card.dataset.dirPath || "");
  if (direct) return direct;
  const key = String(
    card.dataset.previewBaseItemKey || card.dataset.previewItemKey || "",
  );
  return key.startsWith("dir:") ? key.slice(4) : "";
}

function previewFileIdForCard(card) {
  if (!card || !card.dataset) return "";
  const direct = String(card.dataset.fileId || "");
  if (direct) return direct;
  const key = String(
    card.dataset.previewBaseItemKey || card.dataset.previewItemKey || "",
  );
  return key.startsWith("file:") ? key.slice(5) : "";
}

function previewTagFolderKeyForCard(card) {
  if (!card || !card.dataset) return "";
  const key = String(
    card.dataset.previewBaseItemKey || card.dataset.previewItemKey || "",
  );
  return key.startsWith("tag:") ? key.slice(4) : "";
}

function previewDirPathForSelectionKey(key) {
  const targetKey = String(key || "");
  const card = findPreviewSelectableCardByKey(targetKey);
  return (
    previewDirPathForCard(card) ||
    (targetKey.startsWith("dir:") ? targetKey.slice(4) : "")
  );
}

function findFirstVisiblePreviewCard() {
  if (!previewBodyEl) return null;
  const cards = getPreviewSelectableCards();
  if (!cards.length) return null;
  const viewTop = Math.max(0, Number(previewBodyEl.scrollTop) || 0);
  const viewLeft = Math.max(0, Number(previewBodyEl.scrollLeft) || 0);
  const viewBottom =
    viewTop + Math.max(1, Number(previewBodyEl.clientHeight) || 1);
  const viewRight =
    viewLeft + Math.max(1, Number(previewBodyEl.clientWidth) || 1);
  let bestFully = null;
  let bestPartial = null;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const rect = getPreviewCardRelativeRect(card);
    if (!rect) continue;
    const intersects =
      rect.bottom > viewTop + 1 &&
      rect.top < viewBottom - 1 &&
      rect.right > viewLeft + 1 &&
      rect.left < viewRight - 1;
    if (!intersects) continue;
    const fullyVisible =
      rect.top >= viewTop + 1 &&
      rect.bottom <= viewBottom - 1 &&
      rect.left >= viewLeft + 1 &&
      rect.right <= viewRight - 1;
    const score = rect.top * 100000 + rect.left;
    if (fullyVisible) {
      if (!bestFully || score < bestFully.score) bestFully = { card, score };
    } else if (!bestPartial || score < bestPartial.score) {
      bestPartial = { card, score };
    }
  }
  return (
    (bestFully && bestFully.card) ||
    (bestPartial && bestPartial.card) ||
    cards[0] ||
    null
  );
}

function isPreviewTopRowCard(card) {
  if (!card || !previewBodyEl) return false;
  const cards = getPreviewSelectableCards();
  if (!cards.length) return false;
  let minTop = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cards.length; i++) {
    const rect = getPreviewCardRelativeRect(cards[i]);
    if (!rect) continue;
    if (rect.top < minTop) minTop = rect.top;
  }
  if (!Number.isFinite(minTop)) return false;
  const rect = getPreviewCardRelativeRect(card);
  if (!rect) return false;
  return rect.top <= minTop + 2;
}

function previewRevealStrokeInsetPx() {
  if (typeof getComputedStyle !== "function") return 4;
  const rootStyle = getComputedStyle(document.documentElement);
  const stroke = parseFloat(
    rootStyle.getPropertyValue("--ui-preview-selection-stroke") || "0",
  );
  return Math.max(4, (Number.isFinite(stroke) ? stroke : 2) + 2);
}

function previewRevealBottomInsetPx() {
  if (!previewBodyEl || typeof getComputedStyle !== "function") return 6;
  const bodyStyle = getComputedStyle(previewBodyEl);
  const gutter = parseFloat(bodyStyle.paddingTop || "0");
  const gutterInset = Number.isFinite(gutter) && gutter > 0 ? gutter : 0;
  return Math.max(6, previewRevealStrokeInsetPx(), gutterInset);
}

function revealPreviewCard(card = null) {
  const target = card || findSelectedPreviewCard();
  const rect = getPreviewCardRelativeRect(target);
  if (!target || !previewBodyEl || !rect) return;
  const maxTop = Math.max(
    0,
    previewBodyEl.scrollHeight - previewBodyEl.clientHeight,
  );
  const maxLeft = Math.max(
    0,
    previewBodyEl.scrollWidth - previewBodyEl.clientWidth,
  );
  const viewTop = Math.max(0, Number(previewBodyEl.scrollTop) || 0);
  const viewLeft = Math.max(0, Number(previewBodyEl.scrollLeft) || 0);
  const viewBottom =
    viewTop + Math.max(1, Number(previewBodyEl.clientHeight) || 1);
  const viewRight =
    viewLeft + Math.max(1, Number(previewBodyEl.clientWidth) || 1);
  let nextTop = viewTop;
  let nextLeft = viewLeft;
  const topInset = previewRevealStrokeInsetPx();
  const bottomInset = previewRevealBottomInsetPx();
  if (isPreviewTopRowCard(target)) nextTop = 0;
  else if (rect.top < viewTop + topInset) nextTop = rect.top - topInset;
  else if (rect.bottom > viewBottom - bottomInset)
    nextTop = rect.bottom - previewBodyEl.clientHeight + bottomInset;
  const sideInset = topInset;
  if (rect.left < viewLeft + sideInset) nextLeft = rect.left - sideInset;
  else if (rect.right > viewRight - sideInset)
    nextLeft = rect.right - previewBodyEl.clientWidth + sideInset;
  previewBodyEl.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
  previewBodyEl.scrollLeft = Math.max(0, Math.min(maxLeft, nextLeft));
}

// Holding the grid still while its membership changes. The first favorite
// puts a Favorites card in front of every folder (the last one takes it away):
// with Float tags on that is a new row and a half-row spacer above everything,
// with it off every card moves one slot. Re-rendering with the scroll kept
// moved the whole screen. So the change is bracketed: capture the cards on
// screen first, then after the render scroll back so the card you are on (or,
// if it is gone, the first card still there) sits exactly where it was, and let
// anything that still had to move glide from its old place rather than snap.
// A card that wrapped to the next row slides in from beside its new slot, so
// a one-slot shift reads as every row stepping over together.
const PREVIEW_GRID_GLIDE_MS = 180;

function capturePreviewGridLayout() {
  if (!previewBodyEl || !previewBodyEl.isConnected) return null;
  if (WS.preview?.kind !== "dir") return null;
  const body = previewBodyEl.getBoundingClientRect();
  if (!(body.height > 0)) return null;
  const rects = new Map();
  const order = [];
  const cards = getPreviewSelectableCards();
  for (let i = 0; i < cards.length; i++) {
    const key = String(cards[i]?.dataset?.previewItemKey || "");
    if (!key || rects.has(key)) continue;
    const r = cards[i].getBoundingClientRect();
    if (!(r.width > 0)) continue;
    // A screen above and below as well, for cards that move into view.
    if (r.bottom < body.top - body.height || r.top > body.bottom + body.height)
      continue;
    rects.set(key, r);
    if (r.bottom > body.top && r.top < body.bottom) order.push(key);
  }
  const selectedKey = String(WS.view?.previewSelectedKey || "");
  const anchors = order.includes(selectedKey)
    ? [selectedKey].concat(order.filter((key) => key !== selectedKey))
    : order;
  if (!anchors.length) return null;
  return { rects, anchors, bodyTop: body.top };
}

function settlePreviewGridLayout(before) {
  if (!before || !previewBodyEl || WS.preview?.kind !== "dir") return;
  const body = previewBodyEl.getBoundingClientRect();
  for (let i = 0; i < before.anchors.length; i++) {
    const key = before.anchors[i];
    const card = findPreviewSelectableCardByKey(key);
    if (!card || !card.isConnected) continue;
    const was = before.rects.get(key);
    const shift =
      card.getBoundingClientRect().top - body.top - (was.top - before.bodyTop);
    if (Math.abs(shift) >= 1) previewBodyEl.scrollTop += shift;
    break;
  }
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) return;
  const moves = [];
  const cards = getPreviewSelectableCards();
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const key = String(card?.dataset?.previewItemKey || "");
    const was = key ? before.rects.get(key) : null;
    if (!was) continue;
    const now = card.getBoundingClientRect();
    if (now.bottom < body.top || now.top > body.bottom) continue;
    const dx = was.left - now.left;
    const dy = was.top - before.bodyTop - (now.top - body.top);
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    moves.push({ card, dx, dy, width: now.width });
  }
  if (!moves.length) return;
  // A card that went from one end of a row to the other wrapped. Its row
  // mates moved one slot; that slot's width is the stride it enters by.
  const wrapAt = Math.max(1, body.width / 2);
  const stepping = moves.filter((m) => Math.abs(m.dx) < wrapAt);
  const stride = stepping.length
    ? Math.abs(stepping[0].dx) || stepping[0].width
    : moves[0].width;
  const rowDy = stepping.length ? stepping[0].dy : 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    let { dx, dy } = m;
    if (Math.abs(dx) >= wrapAt) {
      dx = dx > 0 ? -stride : stride;
      dy = rowDy;
    }
    try {
      m.card.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: PREVIEW_GRID_GLIDE_MS,
          easing: "cubic-bezier(0.2, 0, 0, 1)",
          composite: "add",
        },
      );
    } catch {}
  }
}

function updatePreviewSelectionClasses() {
  const activeKey = String((WS.view && WS.view.previewSelectedKey) || "");
  const previewActive = !!(WS.view && WS.view.activePane === "preview");
  syncActivePaneWithLayout();
  const cards = getPreviewItemCards();
  if (!previewThumbnailSelectionEnabled()) {
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      card.classList.remove("bulkSelected", "previewSelected");
    }
    return;
  }
  // Gate on bulkSelectMode: with the mode off, set contents are not a
  // selection (hasBulkSelection is false, actions and click-to-clear ignore
  // them), so painting them would show unremovable ghost borders.
  const canBulk = !!(WS.view && WS.view.bulkSelectMode);
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const kind = String(card?.dataset?.previewItemKind || "");
    const key = String(card?.dataset?.previewItemKey || "");
    const selected = String(card?.dataset?.previewItemKey || "") === activeKey;
    let bulkSelected = false;
    if (!canBulk) {
      bulkSelected = false;
    } else if (kind === "dir") {
      const p = previewDirPathForCard(card);
      bulkSelected = !!p && WS.view.bulkTagSelectedPaths.has(p);
    } else if (kind === "file") {
      const id = previewFileIdForCard(card);
      bulkSelected = !!id && WS.view.bulkFileSelectedIds.has(id);
    } else if (kind === "tag") {
      const tagKey = previewTagFolderKeyForCard(card);
      bulkSelected = !!tagKey && WS.view.bulkTagFolderSelectedKeys.has(tagKey);
    }
    card.classList.toggle("bulkSelected", bulkSelected);
    card.classList.toggle("previewSelected", selected && previewActive);
  }
}

function ensurePreviewSelectionForCurrentTarget(reset = false) {
  const contextKey = currentPreviewSelectionContextKeyFromState();
  if (!previewThumbnailSelectionEnabled()) {
    clearPreviewSelectionState(contextKey);
    updatePreviewSelectionClasses();
    return false;
  }
  const cards = getPreviewSelectableCards();
  if (!cards.length) {
    clearPreviewSelectionState(contextKey);
    updatePreviewSelectionClasses();
    return false;
  }
  if (
    reset ||
    String((WS.view && WS.view.previewSelectionContextKey) || "") !== contextKey
  ) {
    clearPreviewSelectionState(contextKey);
  }
  let key = String((WS.view && WS.view.previewSelectedKey) || "");
  let selectedCard = key
    ? cards.find((card) => String(card?.dataset?.previewItemKey || "") === key)
    : null;
  if (!selectedCard) {
    const pendingKey = String(
      (WS.view && WS.view.pendingPreviewSelectionKey) || "",
    );
    if (pendingKey) {
      const pendingCard = findPreviewSelectableCardByKey(pendingKey);
      if (pendingCard) {
        selectedCard = pendingCard;
        key = String(pendingCard?.dataset?.previewItemKey || pendingKey);
        WS.view.pendingPreviewSelectionKey = "";
      } else {
        WS.view.pendingPreviewSelectionKey = "";
      }
    }
    if (!selectedCard) {
      const shouldRespectScroll =
        !!previewBodyEl &&
        ((previewBodyEl.scrollTop || 0) > 0 ||
          (previewBodyEl.scrollLeft || 0) > 0);
      selectedCard = shouldRespectScroll
        ? findFirstVisiblePreviewCard() || cards[0]
        : cards[0];
      key = String(selectedCard?.dataset?.previewItemKey || "");
    }
  }
  WS.view.previewSelectionContextKey = contextKey;
  WS.view.previewSelectedKey = key;
  updatePreviewSelectionClasses();
  return !!selectedCard;
}

function setPreviewSelectionKey(key, opts = null) {
  if (!previewThumbnailSelectionEnabled()) return false;
  const nextKey = String(key || "");
  if (!nextKey) return false;
  const card = findPreviewSelectableCardByKey(nextKey);
  if (!card) return false;
  return setPreviewSelectionCard(card, opts);
}

function setPreviewSelectionCard(card, opts = null) {
  if (!previewThumbnailSelectionEnabled()) return false;
  const key = String(card?.dataset?.previewItemKey || "");
  if (!card || !key) return false;
  if (WS.view) {
    WS.view.previewSelectionContextKey =
      currentPreviewSelectionContextKeyFromState();
    WS.view.previewSelectedKey = key;
    if (!(opts && opts.activate === false)) setActivePane("preview");
  }
  updatePreviewSelectionClasses();
  // Re-assert frosted strip paint on the newly selected card. Virtualized /
  // freshly-created cards can briefly inherit a solid rule before force is
  // applied; selection is when users notice the flash most.
  try {
    const metas = card.querySelectorAll?.(
      ".previewThumbOverlayMeta, .thumbOverlayMeta, .dirSquareOverlay, .dirFileOverlay",
    );
    if (metas && metas.length) {
      metas.forEach((meta) => forcePreviewPaneThumbTitleBar(meta));
    }
  } catch {}
  if (!(opts && opts.skipReveal)) revealPreviewCard(card);
  return true;
}

function activatePreviewPaneSelection() {
  if (!previewThumbnailSelectionEnabled()) {
    clearPreviewSelectionState(currentPreviewSelectionContextKeyFromState());
    updatePreviewSelectionClasses();
    return false;
  }
  setActivePane("preview");
  syncActivePaneWithLayout();
  const hasSelection = ensurePreviewSelectionForCurrentTarget(false);
  updatePreviewSelectionClasses();
  if (hasSelection) revealPreviewCard();
  return true;
}

function resetPreviewPaneForEnteredTarget() {
  if (!WS.view) return;
  WS.view.pendingPreviewSelectionKey = "";
  const dirNode = getPreviewTargetDir();
  const dirKey = previewScrollKeyForDir(dirNode);
  if (dirKey && WS.view.previewScrollByDir instanceof Map) {
    WS.view.previewScrollByDir.delete(dirKey);
  }
  if (previewBodyEl) {
    previewBodyEl.scrollTop = 0;
    previewBodyEl.scrollLeft = 0;
  }
  clearPreviewSelectionState(currentPreviewSelectionContextKeyFromState());
}

function activateDirectoriesPaneSelection() {
  if (!directoriesPaneOpenEnabled()) return false;
  setActivePane("directories");
  updatePreviewSelectionClasses();
  return true;
}

function getExpandedPreviewFolderHeaderCards() {
  if (!previewBodyEl || !expandedPreviewModeEnabled()) return [];
  return Array.from(
    previewBodyEl.querySelectorAll(
      '[data-preview-item-kind="dir"][data-expanded-folder-header="1"]',
    ),
  );
}

function isExpandedPreviewHeaderCard(card) {
  return !!(
    card &&
    card.dataset &&
    String(card.dataset.expandedFolderHeader || "") === "1"
  );
}

function expandedPreviewSectionForCard(card) {
  if (!card || !card.closest) return null;
  const section = card.closest(".expandedSection");
  return section && previewBodyEl && previewBodyEl.contains(section)
    ? section
    : null;
}

function expandedPreviewHeaderForSection(section) {
  if (!section || !section.querySelector) return null;
  return section.querySelector(
    '[data-preview-item-kind="dir"][data-expanded-folder-header="1"]',
  );
}

function expandedPreviewContentCardsForSection(section) {
  if (!section) return [];
  return getPreviewSelectableCards().filter(
    (card) =>
      expandedPreviewSectionForCard(card) === section &&
      !isExpandedPreviewHeaderCard(card),
  );
}

function expandedPreviewHeaderMemory() {
  if (!WS.view) return null;
  if (!(WS.view.expandedHeaderReturnKeys instanceof Map))
    WS.view.expandedHeaderReturnKeys = new Map();
  return WS.view.expandedHeaderReturnKeys;
}

function rememberExpandedHeaderReturnItem(headerCard, contentCard) {
  const headerKey = String(headerCard?.dataset?.previewItemKey || "");
  const contentKey = String(contentCard?.dataset?.previewItemKey || "");
  const memory = expandedPreviewHeaderMemory();
  if (!memory || !headerKey || !contentKey) return;
  memory.set(headerKey, contentKey);
}

function rememberedExpandedHeaderReturnCard(headerCard, section) {
  const headerKey = String(headerCard?.dataset?.previewItemKey || "");
  const memory = expandedPreviewHeaderMemory();
  const rememberedKey = headerKey && memory ? String(memory.get(headerKey) || "") : "";
  if (!rememberedKey) return null;
  const card = findPreviewSelectableCardByKey(rememberedKey);
  if (!card || expandedPreviewSectionForCard(card) !== section) return null;
  if (isExpandedPreviewHeaderCard(card)) return null;
  return card;
}

function uniquifyExpandedSectionContentSelectionKeys(section, sectionPath) {
  if (!section) return;
  const path = String(sectionPath || section.dataset?.path || "");
  if (!path) return;
  const cards = Array.from(section.querySelectorAll("[data-preview-item-key]"));
  const activeKey = String((WS.view && WS.view.previewSelectedKey) || "");
  const anchorKey = String((WS.view && WS.view.previewSelectAnchorKey) || "");
  let index = 0;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || isExpandedPreviewHeaderCard(card)) continue;
    const oldKey = String(card.dataset.previewItemKey || "");
    const baseKey = String(
      card.dataset.previewBaseItemKey || oldKey || "",
    );
    if (!baseKey) continue;
    card.dataset.previewBaseItemKey = baseKey;
    const nextKey = `expanded-content:${path}:${index}:${baseKey}`;
    card.dataset.previewItemKey = nextKey;
    if (WS.view && activeKey && (activeKey === oldKey || activeKey === baseKey))
      WS.view.previewSelectedKey = nextKey;
    if (WS.view && anchorKey && (anchorKey === oldKey || anchorKey === baseKey))
      WS.view.previewSelectAnchorKey = nextKey;
    index++;
  }
}

function moveExpandedHeaderSelectionDown(headerCard) {
  if (!isExpandedPreviewHeaderCard(headerCard)) return false;
  const section = expandedPreviewSectionForCard(headerCard);
  if (!section) return false;
  const remembered = rememberedExpandedHeaderReturnCard(headerCard, section);
  const cards = expandedPreviewContentCardsForSection(section);
  const target = remembered || cards[0] || null;
  if (!target) return false;
  return setPreviewSelectionCard(target, { activate: true });
}

function previewThumbnailGridForCard(card) {
  if (!card || !card.closest) return null;
  const grid = card.closest(".gridFolders, .gridFiles");
  return grid && previewBodyEl && previewBodyEl.contains(grid) ? grid : null;
}

function previewRectsShareNavigationRow(a, b) {
  if (!a || !b) return false;
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const minHeight = Math.max(1, Math.min(a.height || 0, b.height || 0));
  if (overlap >= minHeight * 0.45) return true;
  const acy = a.top + (a.height || 0) * 0.5;
  const bcy = b.top + (b.height || 0) * 0.5;
  return Math.abs(acy - bcy) <= minHeight * 0.45;
}

function moveExpandedPreviewSelectionLaterally(direction, selectedCard) {
  if (!expandedPreviewModeEnabled()) return false;
  if (direction !== "left" && direction !== "right") return false;
  if (isExpandedPreviewHeaderCard(selectedCard)) return true;
  const grid = previewThumbnailGridForCard(selectedCard);
  if (!grid) return true;
  const selectedRect = getPreviewCardRelativeRect(selectedCard);
  if (!selectedRect) return true;
  const selectedCx = selectedRect.left + selectedRect.width * 0.5;
  const selectedCy = selectedRect.top + selectedRect.height * 0.5;
  const cards = getPreviewSelectableCards();
  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (!card || card === selectedCard) continue;
    if (isExpandedPreviewHeaderCard(card)) continue;
    if (previewThumbnailGridForCard(card) !== grid) continue;
    const rect = getPreviewCardRelativeRect(card);
    if (!rect || !previewRectsShareNavigationRow(selectedRect, rect)) continue;
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    const dx = cx - selectedCx;
    if (direction === "left" && dx >= -2) continue;
    if (direction === "right" && dx <= 2) continue;
    const score = Math.abs(dx) * 1000 + Math.abs(cy - selectedCy);
    if (score < bestScore) {
      bestScore = score;
      best = card;
    }
  }
  if (!best) return true;
  return setPreviewSelectionCard(best, { activate: true });
}

function previewBodyTopInset() {
  if (!previewBodyEl || typeof getComputedStyle !== "function") return 0;
  const style = getComputedStyle(previewBodyEl);
  const paddingTop = parseFloat(style.paddingTop || "0");
  return Number.isFinite(paddingTop) && paddingTop > 0 ? paddingTop : 0;
}

function scrollPreviewCardToTop(card) {
  const rect = getPreviewCardRelativeRect(card);
  if (!previewBodyEl || !rect) return false;
  const maxTop = Math.max(
    0,
    previewBodyEl.scrollHeight - previewBodyEl.clientHeight,
  );
  const topInset = previewBodyTopInset();
  previewBodyEl.scrollTop = Math.max(0, Math.min(maxTop, rect.top - topInset));
  return true;
}

function movePreviewSelectionBetweenExpandedFolderHeaders(step) {
  const headers = getExpandedPreviewFolderHeaderCards();
  if (!headers.length) return false;
  const cards = getPreviewSelectableCards();
  if (!cards.length) return false;
  const activeKey = String((WS.view && WS.view.previewSelectedKey) || "");
  const activeIndex = cards.findIndex(
    (card) => String(card?.dataset?.previewItemKey || "") === activeKey,
  );
  const headerIndexes = headers
    .map((header) => cards.indexOf(header))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b);
  if (!headerIndexes.length) return false;

  let targetIndex = -1;
  if (step > 0) {
    targetIndex = headerIndexes.find((idx) => idx > activeIndex);
    if (targetIndex < 0 && activeIndex < 0) targetIndex = headerIndexes[0];
  } else {
    for (let i = headerIndexes.length - 1; i >= 0; i--) {
      if (activeIndex < 0 || headerIndexes[i] < activeIndex) {
        targetIndex = headerIndexes[i];
        break;
      }
    }
  }
  if (targetIndex < 0) return false;
  const target = cards[targetIndex] || null;
  const key = String(target?.dataset?.previewItemKey || "");
  if (!setPreviewSelectionKey(key, { activate: true, skipReveal: true }))
    return false;
  scrollPreviewCardToTop(target);
  return true;
}

function movePreviewSelectionByDirection(direction) {
  if (!ensurePreviewSelectionForCurrentTarget(false)) return false;
  const metrics = getPreviewSelectableCardMetrics();
  if (!metrics.length) return false;
  const activeKey = String((WS.view && WS.view.previewSelectedKey) || "");
  const selectedCard = findSelectedPreviewCard();
  if (
    (direction === "left" || direction === "right") &&
    moveExpandedPreviewSelectionLaterally(direction, selectedCard)
  ) {
    return true;
  }
  if (direction === "down" && isExpandedPreviewHeaderCard(selectedCard)) {
    if (moveExpandedHeaderSelectionDown(selectedCard)) return true;
  }
  const selected =
    metrics.find((m) => m.card === selectedCard) ||
    metrics.find((m) => m.key === activeKey) ||
    metrics[0];
  if (!selected) return false;

  let best = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const lateralMove = direction === "left" || direction === "right";
  for (let i = 0; i < metrics.length; i++) {
    const m = metrics[i];
    if (!m || m.card === selected.card) continue;
    if (lateralMove && isExpandedPreviewHeaderCard(m.card)) continue;
    const dx = m.cx - selected.cx;
    const dy = m.cy - selected.cy;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let primary = 0;
    let secondary = 0;
    let valid = false;
    if (direction === "up" && dy < -2) {
      valid = true;
      primary = -dy;
      secondary = ax;
    } else if (direction === "down" && dy > 2) {
      valid = true;
      primary = dy;
      secondary = ax;
    } else if (direction === "left" && dx < -2) {
      valid = true;
      primary = -dx;
      secondary = ay;
    } else if (direction === "right" && dx > 2) {
      valid = true;
      primary = dx;
      secondary = ay;
    }
    if (!valid) continue;
    const score = primary * 1000 + secondary;
    if (score < bestScore) {
      bestScore = score;
      best = m;
    }
  }
  if (!best) return false;
  if (
    direction === "up" &&
    isExpandedPreviewHeaderCard(best.card) &&
    !isExpandedPreviewHeaderCard(selected.card)
  ) {
    const selectedSection = expandedPreviewSectionForCard(selected.card);
    if (expandedPreviewSectionForCard(best.card) === selectedSection)
      rememberExpandedHeaderReturnItem(best.card, selected.card);
  }
  return setPreviewSelectionCard(best.card, { activate: true });
}
