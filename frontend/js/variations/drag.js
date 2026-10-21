/* Variations: dragging
   Reordering blocks, groups and chips with the pointer. */

// -- imports (generated) --
import { moveBlockWithinGroupTo, moveUnitTo, setFocusBlock } from "./actions.js";
import { $, $$, ROOT, dialogOpen, el } from "./dom.js";
import { ui } from "./store.js";
// -- end imports --

/* ============================================================
   6b. Drag to reorder
   ------------------------------------------------------------
   A pointer drag, not HTML5 drag-and-drop: the gallery page's
   own drop handling is the thing everything else works around,
   and a plain pointer gesture touches none of it.

   It moves the same things the ↑↓ buttons move, through the same
   two primitives, so nothing here can invent an ordering the
   keyboard could not produce. A loose block and a whole group are
   the units of the top level; a member moves only within its own
   group. There is deliberately no drop position that would split a
   group or move a block across one: the insertion line simply is
   not offered there, and grouping stays a thing you say out loud
   through the picker or `g`.

   Positions are read once, when the drag starts, because nothing
   moves until the drop.
   ============================================================ */

export let dragState = null;

export function beginUnitDrag(e, node, unitIndex) {
  beginDrag(e, node, { mode: "unit", unitIndex: unitIndex });
}
export function beginMemberDrag(e, node, group, memberIndex) {
  beginDrag(e, node, { mode: "member", group: group, memberIndex: memberIndex });
}

export function beginDrag(e, node, info) {
  if (e.button !== 0 || ui.view !== "edit" || dragState) return;
  /* The head is full of controls; only the bare handle starts a drag. */
  if (e.target.closest("button, input, select, textarea, a")) return;
  if (dialogOpen()) return;
  /* Suppresses the text selection and the native image drag. It also
     suppresses the compatibility mousedown, which is what would normally move
     the focus ring here, so that is done by hand. */
  e.preventDefault();
  const blockId = node.getAttribute("data-block");
  if (blockId) setFocusBlock(blockId, false);
  dragState = {
    info, node, body: $("#vxStackBody"),
    startY: e.clientY, startX: e.clientX, lastY: e.clientY,
    active: false, slots: null, line: null, target: null, scroller: null,
  };
  window.addEventListener("pointermove", onDragMove, true);
  window.addEventListener("pointerup", onDragEnd, true);
  window.addEventListener("pointercancel", cancelDrag, true);
  window.addEventListener("keydown", onDragKey, true);
}

/* Every legal insertion point, as a y in the stack's own scrolled coordinate
   space and the index it would drop at. The indices are the *real* ones, taken
   off the rendered nodes, so a filtered view still moves things in the whole
   stack rather than in the slice on screen. */
export function collectDropSlots(st) {
  const body = st.body;
  const bodyRect = body.getBoundingClientRect();
  const toContent = (clientY) => clientY - bodyRect.top + body.scrollTop;
  const attr = st.info.mode === "unit" ? "data-unit-index" : "data-member-index";
  const nodes = st.info.mode === "unit"
    ? $$("#vxStackBody > [data-unit-index]")
    : $$('.group[data-group="' + st.info.group.id + '"] > .gbody > [data-member-index]');
  if (!nodes.length) return null;
  const slots = [];
  let left = 0, width = 0;
  nodes.forEach((n) => {
    const r = n.getBoundingClientRect();
    left = r.left - bodyRect.left + body.scrollLeft;
    width = r.width;
    slots.push({ y: toContent(r.top), index: Number(n.getAttribute(attr)) });
  });
  const lastRect = nodes[nodes.length - 1].getBoundingClientRect();
  slots.push({
    y: toContent(lastRect.bottom),
    index: Number(nodes[nodes.length - 1].getAttribute(attr)) + 1,
  });
  return { slots, left, width, toContent };
}

export function onDragMove(e) {
  const st = dragState;
  if (!st) return;
  st.lastY = e.clientY;
  if (!st.active) {
    if (Math.abs(e.clientY - st.startY) < 4 && Math.abs(e.clientX - st.startX) < 4) return;
    const geo = collectDropSlots(st);
    if (!geo) { cancelDrag(); return; }
    st.geo = geo;
    st.active = true;
    ROOT.classList.add("dragging");
    st.node.classList.add("dragsrc");
    st.line = el("div", { class: "dropline" });
    st.line.style.left = geo.left + "px";
    st.line.style.width = geo.width + "px";
    st.body.appendChild(st.line);
    st.scroller = setInterval(() => edgeScroll(st), 40);
  }
  e.preventDefault();
  paintDropTarget(st);
}

/* Near the top or bottom edge the stack creeps, so a block can be dragged
   somewhere that was off screen when the drag began. */
export function edgeScroll(st) {
  if (!st.active) return;
  const r = st.body.getBoundingClientRect();
  const margin = 44;
  let dy = 0;
  if (st.lastY < r.top + margin) dy = -Math.ceil((r.top + margin - st.lastY) / 4);
  else if (st.lastY > r.bottom - margin) dy = Math.ceil((st.lastY - (r.bottom - margin)) / 4);
  if (!dy) return;
  const before = st.body.scrollTop;
  st.body.scrollTop = Math.max(0, before + dy);
  if (st.body.scrollTop !== before) paintDropTarget(st);
}

export function paintDropTarget(st) {
  const y = st.geo.toContent(st.lastY);
  let best = st.geo.slots[0];
  st.geo.slots.forEach((s) => { if (Math.abs(s.y - y) < Math.abs(best.y - y)) best = s; });
  st.target = best.index;
  st.line.style.top = best.y + "px";
}

export function onDragKey(e) {
  if (e.key !== "Escape" || !dragState) return;
  e.preventDefault(); e.stopPropagation();
  cancelDrag();
}

export function onDragEnd() {
  const st = dragState;
  if (!st) return;
  const info = st.info, target = st.target, moved = st.active;
  const blockId = st.node.getAttribute("data-block");
  cancelDrag();
  if (!moved || target === null || target === undefined) return;
  if (info.mode === "unit") moveUnitTo(info.unitIndex, target);
  else if (blockId) moveBlockWithinGroupTo(blockId, target);
}

export function cancelDrag() {
  const st = dragState;
  if (!st) return;
  dragState = null;
  clearInterval(st.scroller);
  window.removeEventListener("pointermove", onDragMove, true);
  window.removeEventListener("pointerup", onDragEnd, true);
  window.removeEventListener("pointercancel", cancelDrag, true);
  window.removeEventListener("keydown", onDragKey, true);
  ROOT.classList.remove("dragging");
  st.node.classList.remove("dragsrc");
  if (st.line) st.line.remove();
}

/* ------------------------------------------------------------
   Chip drag: reordering variants, versions and arrangements
   ------------------------------------------------------------
   The same pointer gesture as the stack drag, for the same reason, and it
   commits through one primitive — moveInArray — so a drag can only produce an
   order the ✕/+ buttons could have produced too. Three differences from the
   stack:

     · Chips wrap, so the insertion point is chosen by distance in *both* axes
       rather than by a y alone. The vertical distance is weighted heavily, so
       the pointer picks a row first and a gap within it second.
     · The indices are the real ones, read off `data-chip-index`, so a filtered
       row still reorders the whole list rather than the slice on screen.
     · A chip is a button, and preventing the default on pointerdown would take
       its click with it. So nothing is prevented until the drag actually
       starts, and the click that follows a real drag is swallowed instead.

   Null carries no data-chip-index and no handler: it is not in the array, so
   there is nothing to move and nowhere for it to go but first.
   ============================================================ */

/* `to` is an insertion index in the array as it stands now. */
export function moveInArray(arr, from, to) {
  if (from === to || from === to - 1) return false;
  if (from < 0 || from >= arr.length) return false;
  const item = arr.splice(from, 1)[0];
  arr.splice(from < to ? to - 1 : to, 0, item);
  return true;
}

export let chipDrag = null;

export function beginChipDrag(e, node, row, index, commit) {
  if (e.button !== 0 || chipDrag || dragState) return;
  /* The active chip's name field is a real text input: a drag started in it is
     the user selecting text. */
  if (e.target.closest("input")) return;
  if (dialogOpen()) return;
  chipDrag = {
    node, row, index, commit,
    startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
    active: false, geo: null, target: null, line: null,
  };
  window.addEventListener("pointermove", onChipDragMove, true);
  window.addEventListener("pointerup", onChipDragEnd, true);
  window.addEventListener("pointercancel", cancelChipDrag, true);
  window.addEventListener("keydown", onChipDragKey, true);
}

export function collectChipSlots(st) {
  const rowRect = st.row.getBoundingClientRect();
  const nodes = $$("[data-chip-index]", st.row);
  if (!nodes.length) return null;
  const slots = [];
  nodes.forEach((n) => {
    const r = n.getBoundingClientRect();
    slots.push({
      x: r.left - rowRect.left, y: r.top - rowRect.top, h: r.height,
      mid: r.top - rowRect.top + r.height / 2,
      index: Number(n.getAttribute("data-chip-index")),
    });
  });
  const last = nodes[nodes.length - 1].getBoundingClientRect();
  slots.push({
    x: last.right - rowRect.left, y: last.top - rowRect.top, h: last.height,
    mid: last.top - rowRect.top + last.height / 2,
    index: Number(nodes[nodes.length - 1].getAttribute("data-chip-index")) + 1,
  });
  return { slots, rowRect };
}

export function onChipDragMove(e) {
  const st = chipDrag;
  if (!st) return;
  st.lastX = e.clientX; st.lastY = e.clientY;
  if (!st.active) {
    if (Math.abs(e.clientX - st.startX) < 4 && Math.abs(e.clientY - st.startY) < 4) return;
    const geo = collectChipSlots(st);
    if (!geo) { cancelChipDrag(); return; }
    st.geo = geo;
    st.active = true;
    ROOT.classList.add("dragging");
    st.node.classList.add("chipdragsrc");
    st.line = el("div", { class: "chipdropline" });
    st.row.appendChild(st.line);
  }
  e.preventDefault();
  paintChipDropTarget(st);
}

export function paintChipDropTarget(st) {
  const r = st.row.getBoundingClientRect();
  const x = st.lastX - r.left, y = st.lastY - r.top;
  /* Rows first, gaps second: a chip row that has wrapped is read as lines. */
  const score = (sl) => Math.abs(sl.x - x) + Math.abs(sl.mid - y) * 6;
  let best = st.geo.slots[0];
  st.geo.slots.forEach((sl) => { if (score(sl) < score(best)) best = sl; });
  st.target = best.index;
  st.line.style.left = (best.x - 3) + "px";
  st.line.style.top = best.y + "px";
  st.line.style.height = best.h + "px";
}

export function onChipDragKey(e) {
  if (e.key !== "Escape" || !chipDrag) return;
  e.preventDefault(); e.stopPropagation();
  cancelChipDrag();
}

export function onChipDragEnd() {
  const st = chipDrag;
  if (!st) return;
  const moved = st.active, target = st.target, commit = st.commit, from = st.index;
  cancelChipDrag();
  if (!moved) return;
  /* A drag that ends over a chip would otherwise click it on the way up. */
  window.addEventListener("click", swallowChipClick, true);
  setTimeout(() => window.removeEventListener("click", swallowChipClick, true), 0);
  if (target === null || target === undefined) return;
  commit(from, target);
}

export function swallowChipClick(e) {
  window.removeEventListener("click", swallowChipClick, true);
  e.preventDefault(); e.stopPropagation();
}

export function cancelChipDrag() {
  const st = chipDrag;
  if (!st) return;
  chipDrag = null;
  window.removeEventListener("pointermove", onChipDragMove, true);
  window.removeEventListener("pointerup", onChipDragEnd, true);
  window.removeEventListener("pointercancel", cancelChipDrag, true);
  window.removeEventListener("keydown", onChipDragKey, true);
  ROOT.classList.remove("dragging");
  st.node.classList.remove("chipdragsrc");
  if (st.line) st.line.remove();
}

