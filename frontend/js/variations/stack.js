/* Variations: the composer
   The filter, the stack of blocks and groups, and the mixer. */

// -- imports (generated) --
import { addArrangement, addBlock, addVariant, addVersion, copyText, cycleArrangement, cycleVariant, deleteArrangement, deleteBlock, deleteVariant, deleteVersion, disbandGroup, duplicateBlock, moveBlockWithinGroup, moveUnit, newGroupFrom, pickArrangement, pickVariant, pickVersion, saveTake, setBlockGroup, setBlockNull, setFocusBlock, setGroupNull, setVersionNull, setView, shuffleMix, toggleBlockCollapsed } from "./actions.js";
import { depReasonText, openDependsDialog } from "./depends.js";
import { $, $$, el, esc, icon } from "./dom.js";
import { beginChipDrag, beginMemberDrag, beginUnitDrag, moveInArray } from "./drag.js";
import { litGroupSegment, litSegment, renderOutput } from "./output.js";
import { countWords, renderDiffHtml } from "./prompt.js";
import { renderRail } from "./rail.js";
import { activeArrangement, activeVariant, activeVersion, depOff, effectiveVariant, groupOf, hasNotes, invalidateDeps, now, project, splitNotes, stackUnits, stripNotes, substituteBanks, touch, ui, variantText, versionIsNull } from "./store.js";
// -- end imports --

/* ============================================================
   5b. The filter
   ------------------------------------------------------------
   A view over the stack and nothing more: it hides rows, it never
   touches the document. Switching a variant, muting a block or
   saving a take while a filter is up all operate on the real data,
   so what you snapshot is the whole rig rather than the part of it
   you can currently see. The Assembled pane is likewise untouched —
   the prompt is always the whole prompt.
   ============================================================ */

export const NO_FILTER = {
  active: false, query: "", shown: 0, total: 0,
  blockShown: () => true, groupShown: () => true, groupHit: () => false,
  variantShown: () => true, versionShown: () => true, matchesIn: () => 0, matchesInBlock: () => 0,
};

export function stackFilter(p) {
  const q = String(ui.searchQuery || "").trim().toLowerCase();
  if (!q) return Object.assign({}, NO_FILTER, { total: p.blocks.length });

  const hit = (s) => String(s == null ? "" : s).toLowerCase().includes(q);
  /* A bank is a piece of the text as much as the typed words are, so a version
     that mentions one is found by the bank's name, by the word it currently
     resolves to, and by any other word the bank holds — the text a version
     will say under a different pick is still text this version owns. */
  const hotBanks = (p.banks || [])
    .filter((k) => hit(k.name) || k.words.some((w) => hit(w.text)))
    .map((k) => new RegExp("(^|[^A-Z0-9_])" + k.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Z0-9_])"));
  const versionHit = (s) =>
    hit(s.name) || hit(s.text) || hit(substituteBanks(s.text)) ||
    hotBanks.some((re) => re.test(s.text));
  const variantHit = (v) => hit(v.name) || v.versions.some(versionHit);
  const groupHit = (g) => hit(g.label) || g.variants.some((a) => hit(a.name));

  const blocks = new Map();     // block id -> { shown, ownHit, variants:Set|null }
  const groups = new Map();     // group id -> { shown, hit, inside }
  (p.groups || []).forEach((g) => groups.set(g.id, { shown: false, hit: groupHit(g), inside: 0 }));

  p.blocks.forEach((b) => {
    const g = b.groupId ? groups.get(b.groupId) : null;
    const matched = b.variants.filter(variantHit);
    const ownHit = hit(b.label);
    const shown = ownHit || matched.length > 0 || !!(g && g.hit);
    /* Chips narrow only when the search actually found something inside this
       block. A block matched by its own label is shown whole — nothing in it
       was asked for in particular. The active variant always stays, or the
       editor below would be showing text whose chip is missing. */
    blocks.set(b.id, {
      shown,
      variants: matched.length ? new Set(matched.map((v) => v.id)) : null,
      versions: matched.length ? new Set(
        b.variants.flatMap((v) => v.versions.filter(versionHit).map((s) => s.id))) : null,
    });
    if (shown && g) { g.shown = true; g.inside++; }
  });
  /* A group is drawn if any member survived, or if the group itself matched —
     in which case its members are all shown, since the match was the group. */
  groups.forEach((r) => { if (r.hit) r.shown = true; });

  const shown = p.blocks.filter((b) => blocks.get(b.id).shown).length;
  return {
    active: true, query: q, shown, total: p.blocks.length,
    blockShown: (b) => !!(blocks.get(b.id) || {}).shown,
    groupShown: (g) => !!(groups.get(g.id) || {}).shown,
    groupHit: (g) => !!(groups.get(g.id) || {}).hit,
    matchesIn: (g) => ((groups.get(g.id) || {}).inside) || 0,
    /* The block equivalent, and deliberately a different number: a group
       counts members, a block counts the variants the search found in it.
       Null variants means the block matched by its own label, and a block
       whose heading is the hit has nothing hidden to report. */
    matchesInBlock: (b) => {
      const r = blocks.get(b.id);
      return r && r.variants ? r.variants.size : 0;
    },
    variantShown: (b, v) => {
      const r = blocks.get(b.id);
      if (!r || !r.variants) return true;
      return r.variants.has(v.id) || v.id === b.activeVariantId;
    },
    versionShown: (b, v, s) => {
      const r = blocks.get(b.id);
      if (!r || !r.versions) return true;
      return r.versions.has(s.id) || s.id === v.activeVersionId;
    },
  };
}

/* The blocks the stack is currently drawing, in order — what j/k walk and what
   the result count reports. The filter is the only thing that takes a block
   out of this list: a condition holds a block off, it never removes it, so a
   held-off block is still somewhere the cursor can land. */
export function visibleBlocks() {
  const p = project();
  const flt = stackFilter(p);
  return p.blocks.filter((b) => !flt.active || flt.blockShown(b));
}

export function setSearchQuery(q) {
  const next = String(q == null ? "" : q);
  if (next === ui.searchQuery) return;
  ui.searchQuery = next;
  renderStack();
}

export function syncSearchChrome(flt) {
  const box = $("#vxSearchBox");
  const input = $("#vxSearchInput");
  if (!box || !input) return;
  box.classList.toggle("on", !!flt.active);
  if (input.value !== ui.searchQuery) input.value = ui.searchQuery;
  $("#vxSearchCount").textContent = flt.active ? flt.shown + " of " + flt.total : "";
}

/* ============================================================
   6. Rendering — the stack (edit view and mixer view)
   ============================================================ */

export function renderStack() {
  const body = $("#vxStackBody");
  const scroll = body.scrollTop;
  body.innerHTML = "";
  const p = project();
  invalidateDeps();
  const flt = stackFilter(p);

  /* Toolbar */
  const nameInput = el("input", { class: "ghost-field projname", value: p.name, spellcheck: "false", "aria-label": "Project name" });
  nameInput.addEventListener("input", () => { p.name = nameInput.value; touch(); renderRail(); });

  const seg = el("div", { class: "segbtn" }, [
    el("button", { class: ui.view === "edit" ? "on" : "", text: "Edit", onclick: () => setView("edit") }),
    el("button", { class: ui.view === "mixer" ? "on" : "", text: "Mixer", onclick: () => setView("mixer") }),
  ]);

  const labelsToggle = el("label", { class: "togline" }, [
    el("input", { type: "checkbox", checked: p.includeLabels, onchange: (e) => { p.includeLabels = e.target.checked; touch(); renderOutput(); } }),
    el("span", { text: "Emit labels" }),
  ]);

  body.appendChild(el("div", { class: "stack-toolbar" }, [
    nameInput, seg, labelsToggle,
    el("button", { class: "btn tiny", text: "Shuffle", title: "Random combination", onclick: shuffleMix }),
    el("button", { class: "btn tiny", text: "Snapshot", title: "Save this combination as a take", onclick: saveTake }),
  ]));

  /* Which units survive the filter — the only thing that removes a row. A
     condition never does; it holds its item off in place. The unit's real
     index travels with it, so ↑↓ and a drop still address the stack itself
     rather than the slice of it on screen. */
  const units = stackUnits(p);
  const drawn = [];
  units.forEach((u, i) => {
    const shown = u.kind === "group" ? flt.groupShown(u.group) : flt.blockShown(u.block);
    if (flt.active && !shown) return;
    drawn.push({ u, i, dep: depOff(u.kind === "group" ? u.group : u.block) });
  });

  /* Counted over the blocks rather than the units, so a member held off inside
     a group it is still sitting in is counted too. */
  const depHeld = p.blocks.filter((b) => {
    const g = groupOf(b);
    return depOff(b) || (!!g && depOff(g));
  }).length;

  if (ui.view === "mixer") body.appendChild(renderMixer(p, drawn, units.length, flt));
  else if (!drawn.length) {
    body.appendChild(el("div", { class: "emptyfilter", text: "Nothing matches “" + ui.searchQuery.trim() + "”." }));
  } else drawn.forEach((d) => {
    body.appendChild(d.u.kind === "group"
      ? renderGroup(d.u, d.i, units.length, p, { dep: d.dep, filter: flt })
      : renderBlock(d.u.block, p, { unitIndex: d.i, unitCount: units.length, dep: d.dep, filter: flt }));
  });

  body.appendChild(el("button", { class: "addblock", text: "+  Add a block", onclick: () => addBlock() }));
  /* Height first, then scroll — see growEditors. */
  growEditors(body);
  body.scrollTop = scroll;

  syncSearchChrome(flt);

  const arrs = p.groups.reduce((n, g) => n + g.variants.length, 0);
  $("#vxStackHint").textContent = p.blocks.length + " blocks · " +
    p.blocks.reduce((n, b) => n + b.variants.length, 0) + " variants" +
    (p.groups.length ? " · " + p.groups.length + (p.groups.length > 1 ? " groups · " : " group · ") +
      arrs + (arrs > 1 ? " arrangements" : " arrangement") : "") +
    (depHeld ? " · " + depHeld + " held off by dependencies" : "");
}

/* ---------- A group container ---------- */

/* A group's extent is marked by a bar down its left edge, in the highlight
   colour, so where a run of wired blocks begins and ends reads at a glance
   while a long project scrolls past. It is absolutely placed in the gutter
   the stack's left padding leaves, so it stretches with the group. */
export function groupBookmarkNodes() {
  return [el("span", { class: "gribbon", "aria-hidden": "true" })];
}

export function renderGroup(unit, unitIndex, unitCount, p, opts) {
  opts = opts || {};
  const flt = opts.filter || NO_FILTER;
  const dep = !!opts.dep;
  const g = unit.group;
  const a = activeArrangement(g);
  const onCount = unit.blocks.filter((b) => b.enabled).length;

  /* Sized to its content so the dashed rule beside it has room — an input has
     no intrinsic width, so this is kept in step by hand exactly as the chip
     name fields are. The floor stops an empty name collapsing to nothing. */
  const groupLabelSize = (v) => Math.max(4, String(v || "").length + 1);
  const labelInput = el("input", {
    class: "ghost-field grouplabel", value: g.label, spellcheck: "false",
    size: String(groupLabelSize(g.label)), "aria-label": "Group label",
  });
  labelInput.addEventListener("input", () => {
    g.label = labelInput.value;
    labelInput.size = groupLabelSize(labelInput.value);
    touch(); renderRail();
  });

  /* No switch: the group's on/off is the Null arrangement in the row below,
     the same move the blocks make. */
  const head = el("div", { class: "ghead" }, [
    el("span", { class: "gtag", text: "Group" }),
    labelInput,
    dep ? el("span", { class: "deplock", text: "held off", title: depReasonText(g) }) : null,
    g.conditions.length ? el("button", {
      class: "depbadge", text: "⋔ " + g.conditions.length,
      title: depReasonText(g), onclick: () => openDependsDialog({ kind: "group", group: g }),
    }) : null,
    flt.active && g.collapsed && flt.matchesIn(g)
      ? el("span", { class: "matchnote", text: flt.matchesIn(g) + " inside", title: "Matches are inside this collapsed group" })
      : null,
    el("span", { class: "gline", "aria-hidden": "true" }),
    el("span", { class: "groupmeta", text: onCount + "/" + unit.blocks.length + " on · " + g.variants.length + " arr" }),
    el("button", {
      class: "btn ghost tiny iconbtn", html: icon(g.collapsed ? "chevronRight" : "chevronDown"), title: g.collapsed ? "Expand" : "Collapse",
      onclick: () => { g.collapsed = !g.collapsed; touch(); renderStack(); },
    }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("up"), title: "Move the whole group up", disabled: unitIndex === 0, onclick: () => moveUnit(unitIndex, -1) }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("down"), title: "Move the whole group down", disabled: unitIndex === unitCount - 1, onclick: () => moveUnit(unitIndex, 1) }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("x"), title: "Disband — the blocks stay, the wiring goes", onclick: () => disbandGroup(g.id) }),
  ]);

  /* Arrangement chips: Null, then the group's own variants. Null is where the
     group's switch went — an arrangement in which nothing is arranged. It is
     locked while a dependency is holding the group off, which is exactly what
     the switch it replaced used to do. */
  const arrs = el("div", { class: "arrs" }, [el("span", { class: "label-cap", text: "Arrangements" })]);
  const moveArrangement = (from, to) => {
    if (!moveInArray(g.variants, from, to)) return;
    touch(); renderStack(); renderOutput(); renderRail();
  };
  arrs.appendChild(el("button", {
    class: "chip arr nul" + (g.enabled ? "" : " on") + (dep ? " locked" : ""),
    title: dep ? "A dependency is holding this group off"
         : g.enabled ? "Show nothing — the whole group drops out of the prompt"
                     : "This group is showing nothing · pick an arrangement to bring it back",
    onclick: () => { if (!dep) setGroupNull(g.id); },
  }, [el("span", { class: "k", text: "0" }), el("span", { class: "t", text: "Null" })]));
  g.variants.forEach((av, i) => {
    const isOn = g.enabled && av.id === g.activeVariantId;
    const chip = el("button", {
      class: "chip arr" + (isOn ? " on" : ""),
      "data-chip-index": String(i),
      title: isOn ? "Active arrangement — click the name to rename it · drag to reorder"
                  : "Switch this group to “" + av.name + "” · drag to reorder",
      onclick: () => { pickArrangement(g.id, av.id); },
    });
    chip.addEventListener("pointerdown", (e) => beginChipDrag(e, chip, arrs, i, moveArrangement));
    chip.appendChild(el("span", { class: "k", text: i < 9 ? String(i + 1) : "·" }));
    if (isOn) {
      const nameInput = el("input", { class: "chipname", value: av.name, size: Math.max(2, av.name.length), spellcheck: "false", "aria-label": "Arrangement name" });
      nameInput.addEventListener("input", () => {
        av.name = nameInput.value; nameInput.size = Math.max(2, nameInput.value.length);
        av.updatedAt = now(); touch();
      });
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      chip.appendChild(nameInput);
    } else {
      const missing = unit.blocks.filter((b) => !Object.prototype.hasOwnProperty.call(av.picks, b.id)).length;
      const onHere = unit.blocks.filter((b) => Object.prototype.hasOwnProperty.call(av.picks, b.id) && !av.off.includes(b.id)).length;
      chip.appendChild(el("span", { class: "t", text: av.name || "—" }));
      chip.title += " · " + onHere + " of " + unit.blocks.length + " on" +
        (missing ? " · " + missing + " added since (off here)" : "");
    }
    arrs.appendChild(chip);
  });
  arrs.appendChild(el("button", {
    class: "chip add arr", html: icon("plus"),
    title: "New arrangement, starting from how the group looks right now",
    onclick: () => addArrangement(g.id),
  }));
  if (g.variants.length > 1) {
    arrs.appendChild(el("button", {
      class: "chip add arr", html: icon("x"),
      title: "Delete the active arrangement",
      onclick: () => deleteArrangement(g.id, g.activeVariantId),
    }));
  }

  const body = el("div", { class: "gbody" });
  unit.blocks.forEach((b, i) => {
    if (flt.active && !flt.blockShown(b) && !flt.groupHit(g)) return;
    body.appendChild(renderBlock(b, p, {
      inGroup: g, memberIndex: i, memberCount: unit.blocks.length, dep: depOff(b), filter: flt,
    }));
  });

  const foot = el("div", { class: "gfoot" }, [
    el("span", { text: (g.enabled ? "“" + (a ? a.name : "—") + "”" : "Null") + " · " + onCount + " of " + unit.blocks.length + " blocks on" }),
    el("span", { class: "grow" }),
    el("button", {
      class: "btn ghost tiny", text: "Depends…", title: "Make this group conditional on another block or group",
      onclick: () => openDependsDialog({ kind: "group", group: g }),
    }),
    el("button", { class: "btn ghost tiny", text: "+ Block in group", title: "Add a new block to this group", onclick: () => addBlock(g.id) }),
  ]);

  const wrap = el("section", {
    class: "group" + (g.enabled ? "" : " off") + (g.collapsed ? " collapsed" : "") + (dep ? " depoff" : ""),
    "data-group": g.id, "data-unit-index": String(unitIndex),
  }, [head, arrs, body, foot].concat(groupBookmarkNodes()));
  /* On the head, not the container — the members light their own slices. */
  head.addEventListener("mouseenter", () => litGroupSegment(g.id, true));
  head.addEventListener("mouseleave", () => litGroupSegment(g.id, false));
  /* The header is the group's grip: the whole run travels together. */
  head.addEventListener("pointerdown", (e) => beginUnitDrag(e, wrap, unitIndex));
  return wrap;
}

export function renderBlock(b, p, opts) {
  opts = opts || {};
  const flt = opts.filter || NO_FILTER;
  const dep = !!opts.dep;
  const idx = p.blocks.indexOf(b);
  const focused = ui.focusBlockId === b.id;
  const av = activeVariant(b);
  /* What the block is really showing. It differs from the active variant only
     when a condition has switched that one off, and the foot says so. */
  const eff = effectiveVariant(b);
  const grp = opts.inGroup || null;

  /* Head */
  const labelInput = el("input", { class: "ghost-field blocklabel", value: b.label, spellcheck: "false", "aria-label": "Block label" });
  labelInput.addEventListener("input", () => { b.label = labelInput.value; touch(); if (p.includeLabels) renderOutput(); });

  /* ↑↓ move within the group when the block is in one, and move the whole
     unit when it is loose — so a loose block hops over a group rather than
     tunnelling into the middle of it. */
  const upDisabled  = grp ? opts.memberIndex === 0 : opts.unitIndex === 0;
  const dnDisabled  = grp ? opts.memberIndex === opts.memberCount - 1 : opts.unitIndex === opts.unitCount - 1;
  const move = (dir) => (grp ? moveBlockWithinGroup(b.id, dir) : moveUnit(opts.unitIndex, dir));

  const grip = el("span", { class: "blocknum", text: String(idx + 1), title: "Drag to reorder" });
  grip.addEventListener("pointerdown", (e) => {
    if (grp) beginMemberDrag(e, card, grp, opts.memberIndex);
    else beginUnitDrag(e, card, opts.unitIndex);
  });

  /* No switch: on/off is the Null chip in the row below. */
  const head = el("div", { class: "head" }, [
    grip,
    labelInput,
    dep ? el("span", { class: "deplock", text: "held off", title: depReasonText(b) }) : null,
    b.conditions.length ? el("button", {
      class: "depbadge", text: "⋔ " + b.conditions.length,
      title: depReasonText(b), onclick: () => openDependsDialog({ kind: "block", block: b }),
    }) : null,
    /* Same note the group header carries, for the same reason: the filter
       narrows what is drawn but never unfolds anything, so a fold with hits
       inside it has to say so or the count in the title bar looks wrong. */
    flt.active && b.collapsed && flt.matchesInBlock(b)
      ? el("span", { class: "matchnote", text: flt.matchesInBlock(b) + " inside", title: "Matches are inside this folded block" })
      : null,
    el("span", { class: "blockmeta", text: blockMetaText(b) }),
    el("button", {
      class: "btn ghost tiny iconbtn", html: icon(b.collapsed ? "chevronRight" : "chevronDown"),
      title: b.collapsed ? "Unfold this block" : "Fold this block down to its heading",
      onclick: () => toggleBlockCollapsed(b.id),
    }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("up"), title: grp ? "Move up inside the group" : "Move up", disabled: upDisabled, onclick: () => move(-1) }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("down"), title: grp ? "Move down inside the group" : "Move down", disabled: dnDisabled, onclick: () => move(1) }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("copy"), title: "Duplicate block", onclick: () => duplicateBlock(b.id) }),
    el("button", { class: "btn ghost tiny iconbtn", html: icon("x"), title: "Delete block", onclick: () => deleteBlock(b.id) }),
  ]);

  /* Chips — Null, then every variant, always visible. The active one is
     renameable in place, and any of them can be dragged into a new order.
     Null is where this block's switch went: it cannot be renamed, moved or
     written into, and it is locked while a dependency is holding the block
     off, which is what the switch did. */
  const nulled = !b.enabled;
  const chips = el("div", { class: "chips" });
  const moveVariant = (from, to) => {
    if (!moveInArray(b.variants, from, to)) return;
    touch(); renderStack(); renderOutput(); renderRail();
  };
  chips.appendChild(el("button", {
    class: "chip nul" + (nulled ? " on" : "") + (dep ? " locked" : ""),
    title: dep ? "A dependency is holding this block off"
         : nulled ? "This block is showing nothing · pick a variant to bring it back"
                  : "Show nothing — this block drops out of the prompt",
    onclick: () => { if (!dep) setBlockNull(b.id); },
  }, [el("span", { class: "k", text: "0" }), el("span", { class: "t", text: "Null" })]));
  b.variants.forEach((v, i) => {
    if (!flt.variantShown(b, v)) return;
    const vdep = depOff(v);
    const isOn = !nulled && v.id === b.activeVariantId;
    const isCmp = b.compareId === v.id;
    const chip = el("button", {
      class: "chip" + (isOn ? " on" : "") + (isCmp ? " cmp" : "") + (vdep ? " depoff" : ""),
      "data-chip-index": String(i),
      title: vdep ? "A dependency is holding this variant off · " + depReasonText(v)
           : isOn ? "Active — click the name to rename. Shift-click another chip to compare. Drag to reorder."
                  : "Click to use · Shift-click to compare · drag to reorder",
      onclick: (e) => {
        if (vdep) return;
        if (e.shiftKey && !isOn) { b.compareId = isCmp ? null : v.id; touch(); renderStack(); return; }
        pickVariant(b.id, v.id);
      },
    });
    if (!vdep) chip.addEventListener("pointerdown", (e) => beginChipDrag(e, chip, chips, i, moveVariant));
    chip.appendChild(el("span", { class: "k", text: i < 9 ? String(i + 1) : "·" }));
    if (isOn) {
      const nameInput = el("input", { class: "chipname", value: v.name, size: Math.max(2, v.name.length), spellcheck: "false", "aria-label": "Variant name" });
      nameInput.addEventListener("input", () => {
        v.name = nameInput.value; nameInput.size = Math.max(2, nameInput.value.length);
        v.updatedAt = now(); touch();
      });
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      chip.appendChild(nameInput);
    } else {
      chip.appendChild(el("span", { class: "t", text: v.name || "—" }));
    }
    /* How many versions are folded inside, so a variant never hides its depth
       just because it is not the one currently open. */
    if (v.versions.length > 1) {
      chip.appendChild(el("span", { class: "vcount", text: String(v.versions.length) }));
      chip.title += " · " + v.versions.length + " versions";
    }
    if (v.conditions.length) {
      chip.appendChild(el("span", { class: "vcount", text: "⋔" + v.conditions.length }));
      chip.title += " · " + depReasonText(v);
    }
    chips.appendChild(chip);
  });
  chips.appendChild(el("button", { class: "chip add", html: icon("plus"), title: "New empty variant", onclick: () => addVariant(b.id, false) }));
  chips.appendChild(el("button", { class: "chip add", html: icon("fork"), title: "Fork the active variant", onclick: () => addVariant(b.id, true) }));

  /* The active variant's versions, one row down. They are shown rather than
     tucked into a dropdown because the whole premise of this app is that every
     version of every part stays on the table; burying them would contradict it.
     Only the open variant's versions appear, so the row stays short. */
  const verNull = versionIsNull(av);
  const vers = el("div", { class: "vers" }, [el("span", { class: "label-cap", text: "Versions" })]);
  const moveVersion = (from, to) => {
    if (!moveInArray(av.versions, from, to)) return;
    av.updatedAt = now();
    touch(); renderStack(); renderOutput(); renderRail();
  };
  vers.appendChild(el("button", {
    class: "chip ver nul" + (verNull ? " on" : ""),
    title: verNull ? "This variant is showing no version · pick one to bring its text back"
                   : "Show no version — “" + av.name + "” adds nothing while this is picked",
    onclick: () => { if (!verNull) setVersionNull(b.id, av.id); },
  }, [el("span", { class: "k", text: "0" }), el("span", { class: "t", text: "Null" })]));
  av.versions.forEach((s, i) => {
    if (!flt.versionShown(b, av, s)) return;
    const sdep = depOff(s);
    const isNow = !verNull && s.id === av.activeVersionId;
    const vchip = el("button", {
      class: "chip ver" + (isNow ? " on" : "") + (sdep ? " depoff" : ""),
      "data-chip-index": String(i),
      title: sdep ? "A dependency is holding this version off · " + depReasonText(s)
           : isNow ? "Showing this version — click the name to rename it · drag to reorder"
                   : "Show “" + (s.name || "—") + "” of “" + av.name + "” · drag to reorder",
      onclick: () => { if (!sdep && !isNow) pickVersion(b.id, av.id, s.id); },
    });
    if (!sdep) vchip.addEventListener("pointerdown", (e) => beginChipDrag(e, vchip, vers, i, moveVersion));
    vchip.appendChild(el("span", { class: "k", text: i < 9 ? String(i + 1) : "·" }));
    if (isNow) {
      const nameInput = el("input", { class: "chipname", value: s.name, size: Math.max(2, s.name.length), spellcheck: "false", "aria-label": "Version name" });
      nameInput.addEventListener("input", () => {
        s.name = nameInput.value; nameInput.size = Math.max(2, nameInput.value.length);
        s.updatedAt = now(); touch();
      });
      nameInput.addEventListener("click", (e) => e.stopPropagation());
      vchip.appendChild(nameInput);
    } else {
      vchip.appendChild(el("span", { class: "t", text: s.name || "—" }));
      vchip.title += " · " + countWords(stripNotes(s.text)) + "w";
    }
    if (s.conditions.length) {
      vchip.appendChild(el("span", { class: "vcount", text: "⋔" + s.conditions.length }));
      vchip.title += " · " + depReasonText(s);
    }
    vers.appendChild(vchip);
  });
  vers.appendChild(el("button", { class: "chip add ver", html: icon("plus"), title: "New empty version of “" + av.name + "”", onclick: () => addVersion(b.id, av.id, false) }));
  vers.appendChild(el("button", { class: "chip add ver", html: icon("fork"), title: "Fork this version", onclick: () => addVersion(b.id, av.id, true) }));
  if (av.versions.length > 1 && !verNull) {
    vers.appendChild(el("button", { class: "chip add ver", html: icon("x"), title: "Delete this version", onclick: () => deleteVersion(b.id, av.id, av.activeVersionId) }));
  }

  /* Editor — typing must never re-render this card, or the caret jumps. */
  const cur = nulled ? null : activeVersion(av);
  const ta = el("textarea", {
    class: "editor", spellcheck: "true",
    placeholder: "Write this part of the prompt…  (a line starting with // is a note and never ships)",
    "data-block": b.id,
  });
  ta.value = cur ? cur.text : "";
  /* Null has no text and takes none: the editor goes flat and says which of
     the two Nulls is showing. Everything you wrote is still on the chip you
     came from, one click away. */
  if (!cur) {
    ta.disabled = true;
    ta.placeholder = nulled
      ? "Null — this block is showing nothing, so nothing of it reaches the prompt. Pick a variant above to write."
      : "Null — this variant is showing no version, so it adds nothing. Pick a version above to write.";
  }
  const edback = el("div", { class: "edback", "aria-hidden": "true" });
  const edwrap = el("div", { class: "edwrap" }, [edback, ta]);
  paintNoteBands(edback, ta.value);
  ta.addEventListener("input", () => {
    if (cur) { cur.text = ta.value; cur.updatedAt = now(); }
    av.updatedAt = now(); touch();
    autoGrow(ta);
    paintNoteBands(edback, ta.value);
    head.querySelector(".blockmeta").textContent = blockMetaText(b);
    renderOutput();
    if (b.compareId) refreshDiff(card, b);
  });
  ta.addEventListener("focus", () => setFocusBlock(b.id, false));

  /* Foot: compare picker + counts */
  const cmpSelect = el("select", { title: "Compare the active variant against another" });
  cmpSelect.appendChild(el("option", { value: "", text: "Compare with…" }));
  b.variants.filter((v) => v.id !== b.activeVariantId).forEach((v) => {
    cmpSelect.appendChild(el("option", { value: v.id, text: v.name, selected: b.compareId === v.id }));
  });
  cmpSelect.value = b.compareId || "";
  cmpSelect.addEventListener("change", () => { b.compareId = cmpSelect.value || null; touch(); renderStack(); });

  /* Which group this block is wired into. Choosing one moves the block next
     to its group-mates, because a group is drawn as one container. */
  const grpSelect = el("select", { title: "Wire this block into a group" });
  grpSelect.appendChild(el("option", { value: "", text: "No group" }));
  p.groups.forEach((g2) => grpSelect.appendChild(el("option", { value: g2.id, text: "Group: " + (g2.label || "—") })));
  grpSelect.appendChild(el("option", { value: "__new", text: "New group…" }));
  grpSelect.value = b.groupId || "";
  grpSelect.addEventListener("change", () => {
    const v = grpSelect.value;
    if (v === "__new") { grpSelect.value = b.groupId || ""; newGroupFrom(b.id); return; }
    setBlockGroup(b.id, v || null);
  });

  /* Counts are of the text that actually ships: the notes are out and the
     banks are in. */
  const noteInfo = splitNotes(cur ? cur.text : "");
  const resolved = substituteBanks(noteInfo.prompt);
  const foot = el("div", { class: "foot" }, [
    cmpSelect,
    grpSelect,
    el("span", { class: "grow" }),
    noteInfo.notes.length
      ? el("span", { class: "deplock", text: noteInfo.notes.length + (noteInfo.notes.length === 1 ? " note" : " notes"),
                     title: noteInfo.notes.join("\n\n") })
      : null,
    eff && eff.id !== b.activeVariantId
      ? el("span", { class: "deplock", text: "shipping “" + eff.name + "”",
                     title: "A dependency has switched off the variant this block is set to, so it is showing the first one still available. Nothing has been rewritten." })
      : null,
    el("span", { text: resolved.length + " ch · " + countWords(resolved) + " words" }),
    el("button", { class: "btn ghost tiny", text: "Copy part", onclick: () => copyText(resolved, "Copied “" + b.label + "”") }),
    el("button", {
      class: "btn ghost tiny", text: "Depends…", title: "Make this block, variant or version conditional on another",
      onclick: () => openDependsDialog({ kind: "block", block: b }),
    }),
    el("button", {
      class: "btn ghost tiny", text: "Delete variant", disabled: b.variants.length < 2 || nulled,
      onclick: () => deleteVariant(b.id, b.activeVariantId),
    }),
  ]);

  /* What a folded block shows in place of everything else: the variant it is
     actually on, and the opening of what that says. The name alone is not
     enough -- half the point of folding a stack is to read it as an outline,
     and "formal" tells you nothing about the sentence. Built unconditionally
     and hidden by CSS rather than skipped when open, so unfolding never has to
     wait for a re-render to have something to draw.

     `eff` rather than the active variant, and `mixSnippet` rather than the raw
     text, so the line is the one that would actually ship: a condition holding
     the chosen variant off is reflected here, the notes are out and the banks
     are in. */
  const peek = el("div", { class: "peek", title: "Unfold this block" }, [
    el("span", { class: "peekvar", text: nulled ? "Null" : (eff ? eff.name : "—") }),
    el("span", { class: "peektext", text: nulled ? "—" : mixSnippet(eff) }),
  ]);
  peek.addEventListener("click", () => toggleBlockCollapsed(b.id));

  const card = el("section", {
    class: "block" + (focused ? " focused" : "") + (b.enabled ? "" : " off") +
           (b.collapsed ? " collapsed" : "") +
           (b.enabled && grp && !grp.enabled ? " mutedbygroup" : "") + (dep ? " depoff" : ""),
    "data-block": b.id,
    "data-unit-index": grp ? null : String(opts.unitIndex),
    "data-member-index": grp ? String(opts.memberIndex) : null,
  }, [head, peek, chips].concat(nulled ? [] : [vers]).concat([edwrap, foot]));

  card.addEventListener("mouseenter", () => litSegment(b.id, true));
  card.addEventListener("mouseleave", () => litSegment(b.id, false));
  card.addEventListener("mousedown", () => setFocusBlock(b.id, false));

  if (b.compareId) refreshDiff(card, b);
  /* No autoGrow here: the card is still detached, so it cannot be measured.
     renderStack grows the whole stack at once once everything is in the DOM. */
  return card;
}

/* "3 var · 2 ver · 41w" — the version count only shows when there is one to
   report, so a plain block reads exactly as it did before versions existed. */
export function blockMetaText(b) {
  if (!b.enabled) return b.variants.length + " var · null";
  const av = activeVariant(b);
  const words = countWords(substituteBanks(stripNotes(variantText(av))));
  return b.variants.length + " var" +
    (av && av.versions.length > 1 ? " · " + av.versions.length + " ver" : "") +
    " · " + words + "w";
}

export const mixSnippet = (v) => substituteBanks(stripNotes(variantText(v))).replace(/\s+/g, " ").trim() || "—";

export function refreshDiff(card, b) {
  let box = card.querySelector(".diffbox");
  const other = b.variants.find((v) => v.id === b.compareId);
  if (!other) { if (box) box.remove(); return; }
  if (!box) {
    box = el("div", { class: "diffbox" });
    card.insertBefore(box, card.querySelector(".foot"));
  }
  const av = activeVariant(b);
  box.innerHTML =
    '<span class="legend">' + esc(other.name) + " → " + esc(av.name) +
    "  ·  <del>removed</del> <ins>added</ins></span>" +
    renderDiffHtml(variantText(other), variantText(av));
}

export function autoGrow(ta) {
  ta.style.height = "auto";
  ta.style.height = Math.max(70, ta.scrollHeight) + "px";
}

/* The band behind each note line. One div per line, mirroring the textarea's
   own wrapping, with transparent text — the visible glyphs are always the
   textarea's, so this can only ever be a rectangle in the wrong place, never a
   second copy of the text. Built only when the version actually contains a
   note, so ordinary editing carries none of it.

   The zero-width space keeps an empty line one row tall; a div with nothing in
   it would collapse and every band below it would slide up a line. */
export function paintNoteBands(host, text) {
  if (!host) return;
  if (!hasNotes(text)) { if (host.firstChild) host.textContent = ""; return; }
  const flags = splitNotes(text).lineFlags;
  host.innerHTML = String(text).split("\n").map((line, i) =>
    '<div class="edline' + (flags[i] ? " note" : "") + '">' + esc(line) + "\u200b</div>").join("");
}

/* Grow every editor at once, synchronously.

   This has to happen before renderStack restores the scroll position. A freshly
   built editor has no height yet, so the whole stack sits at its 70px-per-block
   minimum; write scrollTop against that and the browser clamps it to the short
   content, and the position is gone for good — the view jumps upward. Growing
   them a tick later (which is what used to happen) is far too late.

   Batched into one read pass and one write pass, so measuring a long stack
   costs a single layout rather than one per block. */
export function growEditors(root) {
  const list = $$(".editor", root);
  list.forEach((ta) => { ta.style.height = "auto"; });
  const heights = list.map((ta) => Math.max(70, ta.scrollHeight));
  list.forEach((ta, i) => { ta.style.height = heights[i] + "px"; });
}

/* The mixer draws the same surviving units the edit view does — a row the
   filter or a dependency has taken out of one is out of the other. */
export function renderMixer(p, drawn, unitCount, flt) {
  flt = flt || NO_FILTER;
  const wrap = el("div", { class: "mixer" });
  if (!drawn.length) {
    wrap.appendChild(el("div", { class: "emptyfilter", text: "Nothing matches “" + ui.searchQuery.trim() + "”." }));
    return wrap;
  }
  drawn.forEach((d) => {
    const u = d.u;
    if (u.kind === "group") {
      wrap.appendChild(renderMixerGroupRow(u, d.dep));
      u.blocks.forEach((b) => {
        if (flt.active && !flt.blockShown(b) && !flt.groupHit(u.group)) return;
        wrap.appendChild(renderMixerRow(b, u.group, depOff(b)));
      });
      return;
    }
    wrap.appendChild(renderMixerRow(u.block, null, d.dep));
  });
  return wrap;
}

export function renderMixerGroupRow(unit, dep) {
  dep = !!dep;
  const g = unit.group;
  const a = activeArrangement(g);
  const ai = g.variants.indexOf(a);
  const onCount = unit.blocks.filter((b) => b.enabled).length;
  const row = el("div", { class: "mixgroup" + (g.enabled ? "" : " off") + (dep ? " depoff" : ""), "data-group": g.id }, [
    el("div", { class: "mlabel" }, [
      el("span", { class: "gtag", text: "Grp" }),
      el("span", { text: g.label, title: g.label }),
      dep ? el("span", { class: "deplock", text: "⋔", title: depReasonText(g) }) : null,
    ]),
    el("div", { class: "mixpick" }, [
      el("button", { class: "arw", text: "◀", title: "Previous arrangement", onclick: () => cycleArrangement(g.id, -1) }),
      el("button", {
        class: "now" + (g.enabled ? "" : " nul"), text: g.enabled ? (a ? a.name : "—") : "Null",
        title: "Click to advance · " + (g.enabled ? ai + 2 : 1) + " of " + (g.variants.length + 1),
        onclick: () => cycleArrangement(g.id, 1),
      }),
      el("button", { class: "arw", text: "▶", title: "Next arrangement", onclick: () => cycleArrangement(g.id, 1) }),
    ]),
    el("span", { class: "snip", text: g.enabled ? onCount + " of " + unit.blocks.length + " blocks on" : "nothing from this group" }),
    el("span", { class: "ct", text: (g.enabled ? ai + 2 : 1) + "/" + (g.variants.length + 1) }),
  ]);
  row.addEventListener("mouseenter", () => litGroupSegment(g.id, true));
  row.addEventListener("mouseleave", () => litGroupSegment(g.id, false));
  return row;
}

export function renderMixerRow(b, grp, dep) {
  dep = !!dep;
  const av = activeVariant(b);
  const vi = b.variants.indexOf(av);
  const row = el("div", {
    class: "mixrow" + (b.enabled ? "" : " off") + (grp ? " ingroup" : "") +
           (dep ? " depoff" : "") + (ui.focusBlockId === b.id ? " focused" : ""),
    "data-block": b.id,
  }, [
    el("span", { class: "mlabel", text: b.label + (dep ? " ⋔" : ""), title: dep ? depReasonText(b) : b.label }),
    el("div", { class: "mixpick" }, [
      el("button", { class: "arw", text: "◀", title: "Previous variant", onclick: () => cycleVariant(b.id, -1) }),
      el("button", {
        class: "now" + (b.enabled ? "" : " nul"), text: b.enabled ? av.name : "Null",
        title: "Click to advance · " + (b.enabled ? vi + 2 : 1) + " of " + (b.variants.length + 1),
        onclick: () => cycleVariant(b.id, 1),
      }),
      el("button", { class: "arw", text: "▶", title: "Next variant", onclick: () => cycleVariant(b.id, 1) }),
    ]),
    el("span", { class: "snip", text: b.enabled ? mixSnippet(av) : "—", title: b.enabled ? variantText(av) : "Showing nothing" }),
    el("span", { class: "ct", text: (b.enabled ? vi + 2 : 1) + "/" + (b.variants.length + 1) }),
  ]);
  row.addEventListener("mouseenter", () => litSegment(b.id, true));
  row.addEventListener("mouseleave", () => litSegment(b.id, false));
  row.addEventListener("mousedown", () => setFocusBlock(b.id, false));
  return row;
}

