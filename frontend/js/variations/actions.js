/* Variations: changes to the document
   Every mutation, takes, the clipboard, import and export. */

// -- imports (generated) --
import { $, $$, askConfirm, askText, el, toast } from "./dom.js";
import { open } from "./main.js";
import { renderAll, renderOutput } from "./output.js";
import { renderRail } from "./rail.js";
import { renderStack } from "./stack.js";
import { HOST, NULL_ID, activeArrangement, activeVariant, activeVersion, applyArrangement, blockById, conditionHosts, depOff, flushSave, groupById, invalidateDeps, isApp, makeArrangement, makeBlock, makeGroup, makeProject, makeVariant, makeVersion, normalize, normalizeGroupOrder, now, project, pruneConditionSources, remapConditions, save, stackUnits, state, touch, ui, uid, versionIdIsValid, versionIsNull } from "./store.js";
// -- end imports --

/* ============================================================
   8. Mutations
   ============================================================ */

export function selectProject(id) {
  if (id === state.activeProjectId) return;
  state.activeProjectId = id;
  ui.focusBlockId = null;
  renderAll();
}

export function newProject() {
  askText("New project", "Name this prompt", "Untitled prompt", (name) => {
    const p = makeProject(name, [makeBlock("Role", null), makeBlock("Task", null)]);
    state.projects.unshift(p);
    state.activeProjectId = p.id;
    ui.focusBlockId = null;
    renderAll();
    toast("Created “" + name + "”");
  });
}

export function duplicateProject(id) {
  const src = state.projects.find((p) => p.id === id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid("p");
  copy.name = src.name + " copy";
  copy.createdAt = copy.updatedAt = now();
  /* Fresh ids throughout, and re-point actives/groups/takes at them. */
  const vmap = {}, bmap = {}, gmap = {}, amap = {};
  copy.groups = Array.isArray(copy.groups) ? copy.groups : [];
  copy.groups.forEach((g) => {
    const oldG = g.id; g.id = uid("g"); gmap[oldG] = g.id;
    g.variants.forEach((a) => { const oldA = a.id; a.id = uid("a"); amap[oldA] = a.id; });
    g.activeVariantId = amap[g.activeVariantId] || g.variants[0].id;
  });
  const smap = {}, kmap = {}, wmap = {};
  copy.banks = Array.isArray(copy.banks) ? copy.banks : [];
  copy.banks.forEach((k) => {
    const oldK = k.id; k.id = uid("k"); kmap[oldK] = k.id;
    k.words.forEach((w) => { const oldW = w.id; w.id = uid("w"); wmap[oldW] = w.id; });
    k.activeWordId = wmap[k.activeWordId] || k.words[0].id;
  });
  copy.blocks.forEach((b) => {
    const oldB = b.id; b.id = uid("b"); bmap[oldB] = b.id;
    b.variants.forEach((v) => {
      const oldV = v.id; v.id = uid("v"); vmap[oldV] = v.id;
      v.versions.forEach((sv) => { const oldS = sv.id; sv.id = uid("s"); smap[oldS] = sv.id; });
      v.activeVersionId = smap[v.activeVersionId] || v.versions[0].id;
    });
    b.activeVariantId = vmap[b.activeVariantId] || b.variants[0].id;
    b.compareId = b.compareId ? (vmap[b.compareId] || null) : null;
    b.groupId = b.groupId ? (gmap[b.groupId] || null) : null;
  });
  copy.groups.forEach((g) => g.variants.forEach((a) => {
    const picks = {};
    for (const k in a.picks) {
      const pick = a.picks[k];
      if (!bmap[k] || !pick || !vmap[pick.v]) continue;
      picks[bmap[k]] = { v: vmap[pick.v], ver: pick.ver ? (smap[pick.ver] || null) : null };
    }
    a.picks = picks;
    a.off = (a.off || []).map((k) => bmap[k]).filter(Boolean);
  }));
  /* Conditions point at ids too, and a copy has to depend on its own blocks
     rather than reaching back into the project it was copied from. */
  const condMaps = { b: bmap, v: vmap, s: smap, g: gmap, a: amap };
  conditionHosts(copy).forEach((item) => { item.conditions = remapConditions(item.conditions, condMaps); });
  copy.takes.forEach((t) => {
    t.id = uid("t");
    const blocks = {};
    for (const k in (t.blocks || {})) {
      if (!bmap[k]) continue;
      blocks[bmap[k]] = {
        v: vmap[t.blocks[k].v] || null,
        ver: t.blocks[k].ver ? (smap[t.blocks[k].ver] || null) : null,
        on: !!t.blocks[k].on,
      };
    }
    t.blocks = blocks;
    const groups = {};
    for (const k in (t.groups || {})) {
      if (!gmap[k]) continue;
      groups[gmap[k]] = { v: amap[t.groups[k].v] || null, on: !!t.groups[k].on };
    }
    t.groups = groups;
    const banks = {};
    for (const k in (t.banks || {})) {
      if (kmap[k] && wmap[t.banks[k]]) banks[kmap[k]] = wmap[t.banks[k]];
    }
    t.banks = banks;
  });
  state.projects.splice(state.projects.indexOf(src) + 1, 0, copy);
  state.activeProjectId = copy.id;
  renderAll();
  toast("Duplicated");
}

export function deleteProject(id) {
  state.projects = state.projects.filter((p) => p.id !== id);
  if (!state.projects.length) state.projects.push(makeProject("Untitled prompt", null));
  if (!state.projects.some((p) => p.id === state.activeProjectId)) state.activeProjectId = state.projects[0].id;
  ui.focusBlockId = null;
  renderAll();
  toast("Deleted");
}

export function addBlock(groupId) {
  const p = project();
  const b = makeBlock("New block", null);
  if (groupId && p.groups.some((g) => g.id === groupId)) {
    b.groupId = groupId;
    /* Land it at the end of its group's run rather than the end of the stack. */
    let last = -1;
    p.blocks.forEach((x, i) => { if (x.groupId === groupId) last = i; });
    p.blocks.splice(last + 1, 0, b);
  } else {
    p.blocks.push(b);
  }
  normalizeGroupOrder(p);
  ui.focusBlockId = b.id;
  touch(); renderAll();
  const node = $('#vxStackBody .block[data-block="' + b.id + '"]');
  if (node) { node.scrollIntoView({ block: "center" }); const inp = node.querySelector(".blocklabel"); if (inp) { inp.focus(); inp.select(); } }
}

export function duplicateBlock(id) {
  const p = project();
  const src = blockById(id);
  if (!src) return;
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid("b");
  copy.label = src.label + " copy";
  const vmap = {}, smap = {};
  copy.variants.forEach((v) => {
    const old = v.id; v.id = uid("v"); vmap[old] = v.id;
    v.versions.forEach((s) => { const oldS = s.id; s.id = uid("s"); smap[oldS] = s.id; });
    v.activeVersionId = smap[v.activeVersionId] || v.versions[0].id;
  });
  copy.activeVariantId = vmap[copy.activeVariantId] || copy.variants[0].id;
  copy.compareId = copy.compareId ? (vmap[copy.compareId] || null) : null;
  /* The copy's own conditions still point at the same *sources* — those blocks
     and groups are right where they were. Only the ids inside this block have
     moved, and nothing in a condition names them. */
  const selfMaps = { b: {}, v: {}, s: {}, g: {}, a: {} };
  conditionHosts({ blocks: [copy], groups: [] })
    .forEach((item) => { item.conditions = remapConditions(item.conditions, selfMaps); });
  p.blocks.splice(p.blocks.indexOf(src) + 1, 0, copy);
  ui.focusBlockId = copy.id;
  touch(); renderAll();
}

export function deleteBlock(id) {
  const p = project();
  const b = blockById(id);
  if (!b) return;
  const run = () => {
    p.blocks = p.blocks.filter((x) => x.id !== id);
    if (!p.blocks.length) p.blocks.push(makeBlock("Section", null));
    p.takes.forEach((t) => { delete t.blocks[id]; });
    p.groups.forEach((g) => g.variants.forEach((a) => {
      delete a.picks[id];
      a.off = a.off.filter((x) => x !== id);
    }));
    /* A group that has lost its last member is not a group any more. */
    dropEmptyGroups(p);
    /* Conditions naming the block that just went are dropped rather than left
       to fail open forever — they would read as live rules in the dialog. */
    pruneConditionSources(p);
    ui.focusBlockId = p.blocks[0].id;
    touch(); renderAll();
  };
  const hasContent = b.variants.some((v) => v.versions.some((s) => s.text.trim()));
  if (hasContent) askConfirm("Delete block", "Delete “" + b.label + "” and its " + b.variants.length + " variants?", "Delete", run);
  else run();
}

/* Reordering happens between units, so a loose block steps over an entire
   group instead of landing inside it. */
export function moveUnit(index, dir) {
  const p = project();
  const units = stackUnits(p);
  const j = index + dir;
  if (index < 0 || index >= units.length || j < 0 || j >= units.length) return;
  const [u] = units.splice(index, 1);
  units.splice(j, 0, u);
  p.blocks = units.flatMap((x) => (x.kind === "group" ? x.blocks : [x.block]));
  touch(); renderStack(); renderOutput();
}

export function moveBlockWithinGroup(id, dir) {
  const p = project();
  const b = blockById(id);
  if (!b || !b.groupId) return;
  const run = p.blocks.filter((x) => x.groupId === b.groupId);
  const i = run.indexOf(b);
  const j = i + dir;
  if (j < 0 || j >= run.length) return;
  const start = p.blocks.indexOf(run[0]);
  run.splice(i, 1);
  run.splice(j, 0, b);
  p.blocks.splice(start, run.length, ...run);
  ui.focusBlockId = id;
  touch(); renderStack(); renderOutput();
}

/* The two the drop lands on. A slot index is where the item would be inserted
   *before* it is lifted out, so once it is out everything after it has shifted
   down by one and the target has to follow. */
export function moveUnitTo(from, to) {
  const p = project();
  const units = stackUnits(p);
  if (from < 0 || from >= units.length) return;
  let target = to > from ? to - 1 : to;
  target = Math.max(0, Math.min(units.length - 1, target));
  if (target === from) return;
  const [u] = units.splice(from, 1);
  units.splice(target, 0, u);
  p.blocks = units.flatMap((x) => (x.kind === "group" ? x.blocks : [x.block]));
  normalizeGroupOrder(p);
  touch(); renderStack(); renderOutput();
}

export function moveBlockWithinGroupTo(id, to) {
  const p = project();
  const b = blockById(id);
  if (!b || !b.groupId) return;
  const run = p.blocks.filter((x) => x.groupId === b.groupId);
  const i = run.indexOf(b);
  if (i < 0) return;
  let target = to > i ? to - 1 : to;
  target = Math.max(0, Math.min(run.length - 1, target));
  if (target === i) return;
  const start = p.blocks.indexOf(run[0]);
  run.splice(i, 1);
  run.splice(target, 0, b);
  p.blocks.splice(start, run.length, ...run);
  normalizeGroupOrder(p);
  ui.focusBlockId = id;
  touch(); renderStack(); renderOutput();
}

/* ---------- Groups ---------- */

export function dropEmptyGroups(p) {
  const dead = p.groups.filter((g) => !p.blocks.some((b) => b.groupId === g.id)).map((g) => g.id);
  if (!dead.length) return;
  p.groups = p.groups.filter((g) => !dead.includes(g.id));
  p.takes.forEach((t) => dead.forEach((gid) => { delete t.groups[gid]; }));
  pruneConditionSources(p);
}

export function newGroupFrom(blockId) {
  const p = project();
  const b = blockById(blockId);
  if (!b) return;
  askText("New group", "Name this group", "Group " + (p.groups.length + 1), (label) => {
    const g = makeGroup(label);
    p.groups.push(g);
    setBlockGroup(blockId, g.id, { silent: true });
    toast("“" + label + "” created — set other blocks to it to wire them in");
  });
}

/* Joining a group moves the block next to its group-mates: a group is one
   container on screen, so its members have to be a contiguous run. */
export function setBlockGroup(blockId, groupId, opts) {
  const p = project();
  const b = blockById(blockId);
  if (!b || b.groupId === groupId) return;
  const from = b.groupId;

  if (from) {
    p.groups.forEach((g) => {
      if (g.id !== from) return;
      g.variants.forEach((a) => { delete a.picks[blockId]; a.off = a.off.filter((x) => x !== blockId); });
    });
  }
  b.groupId = groupId || null;

  if (groupId) {
    /* Sit at the end of the target group's run — but a group that has no
       members yet (one just made for this block) has no run to join, and the
       block should stay exactly where it is rather than jump to the top. */
    const at = p.blocks.indexOf(b);
    const others = p.blocks.filter((x) => x.id !== blockId);
    let last = -1;
    others.forEach((x, i) => { if (x.groupId === groupId) last = i; });
    others.splice(last < 0 ? at : last + 1, 0, b);
    p.blocks = others;
  }
  normalizeGroupOrder(p);
  dropEmptyGroups(p);
  ui.focusBlockId = blockId;
  touch(); renderAll();
  if (!opts || !opts.silent) {
    const g = groupById(groupId);
    toast(g ? "Wired “" + b.label + "” into “" + g.label + "”" : "“" + b.label + "” left its group");
  }
}

export function toggleGroup(id) {
  const g = groupById(id);
  if (!g) return;
  g.enabled = !g.enabled;
  touch(); renderStack(); renderOutput(); renderRail();
}

/* Folding is a view and touches nothing the prompt is made of, so unlike every
   other toggle in here it does not re-render the output or the rail. */
export function toggleBlockCollapsed(id, force) {
  const b = blockById(id);
  if (!b) return;
  const next = force === undefined ? !b.collapsed : !!force;
  if (next === b.collapsed) return;
  b.collapsed = next;
  touch(); renderStack();
}

/* One key for the whole outline. Folding wins the tie: with a mixed stack the
   useful next state is "show me all the headings", and pressing it again opens
   everything back up. Members of groups are included — a group's own fold hides
   its members entirely, which is a different thing from folding each of them. */
export function toggleAllBlocksCollapsed() {
  const p = project();
  if (!p.blocks.length) return;
  const fold = p.blocks.some((b) => !b.collapsed);
  p.blocks.forEach((b) => { b.collapsed = fold; });
  touch(); renderStack();
  toast(fold ? "Folded every block" : "Unfolded every block");
}

/* Disbanding keeps every block and whatever it is currently showing; only the
   wiring goes. The arrangements go with it — they described this group. */
export function disbandGroup(id) {
  const p = project();
  const g = groupById(id);
  if (!g) return;
  const run = () => {
    p.blocks.forEach((b) => { if (b.groupId === id) b.groupId = null; });
    p.groups = p.groups.filter((x) => x.id !== id);
    p.takes.forEach((t) => { delete t.groups[id]; });
    pruneConditionSources(p);
    touch(); renderAll();
    toast("Disbanded “" + g.label + "”");
  };
  if (g.variants.length > 1) {
    askConfirm("Disband group", "Disband “" + g.label + "”? Its " + g.variants.length +
      " arrangements are lost; the blocks stay exactly as they are now.", "Disband", run);
  } else run();
}

/* ---------- Arrangements (a group's own variants) ---------- */

export function pickArrangement(groupId, arrangementId) {
  const g = groupById(groupId);
  if (!g) return;
  /* Picking an arrangement is also how a group comes back from Null. The one
     exception is a group a dependency is holding off: its own switch stayed
     locked when it was a switch, so it stays locked as a chip. */
  const wake = !g.enabled && !depOff(g);
  if (g.activeVariantId === arrangementId && !wake) return;
  /* touch() syncs the *active* arrangement from the members, so the switch has
     to happen first — otherwise the outgoing one is overwritten. */
  g.activeVariantId = arrangementId;
  if (wake) g.enabled = true;
  applyArrangement(g);
  touch(); renderStack(); renderOutput(); renderRail();
}

/* Null is the first stop in the ring, so cycling walks off the end of the
   arrangements into "nothing" and back round, exactly as the chips read. */
export function cycleArrangement(groupId, dir) {
  const g = groupById(groupId);
  if (!g) return;
  const ring = (depOff(g) ? [] : [null]).concat(g.variants);
  if (ring.length < 2) return;
  let i = g.enabled ? ring.findIndex((a) => a && a.id === g.activeVariantId) : 0;
  if (i < 0) i = 0;
  const n = ring.length;
  const next = ring[(((i + dir) % n) + n) % n];
  if (next) pickArrangement(groupId, next.id); else setGroupNull(groupId);
}

/* A new arrangement starts as a copy of how the group looks right now — the
   useful default, since you make one in order to vary from here. */
export function addArrangement(groupId) {
  const g = groupById(groupId);
  if (!g) return;
  const src = activeArrangement(g);
  const a = makeArrangement(nextArrangementName(g, src ? src.name : "a"));
  a.picks = Object.assign({}, src ? src.picks : {});
  a.off = (src ? src.off : []).slice();
  g.variants.splice(g.variants.indexOf(src) + 1, 0, a);
  g.activeVariantId = a.id;
  touch(); renderStack(); renderOutput(); renderRail();
  const node = $('#vxStackBody .group[data-group="' + g.id + '"] .chip.arr.on .chipname');
  if (node) { node.focus(); node.select(); }
}

export function nextArrangementName(g, name) {
  const base = String(name || "a").replace(/\s+\d+$/, "");
  let n = 2;
  const taken = new Set(g.variants.map((a) => a.name));
  while (taken.has(base + " " + n)) n++;
  return base + " " + n;
}

export function deleteArrangement(groupId, arrangementId) {
  const g = groupById(groupId);
  if (!g || g.variants.length < 2) return;
  const a = g.variants.find((x) => x.id === arrangementId);
  if (!a) return;
  const run = () => {
    const i = g.variants.indexOf(a);
    g.variants.splice(i, 1);
    project().takes.forEach((t) => {
      const rec = t.groups[groupId];
      if (rec && rec.v === arrangementId) rec.v = null;
    });
    if (g.activeVariantId === arrangementId) {
      g.activeVariantId = g.variants[Math.max(0, i - 1)].id;
      applyArrangement(g);
    }
    pruneConditionSources(project());
    touch(); renderStack(); renderOutput(); renderRail();
  };
  askConfirm("Delete arrangement", "Delete “" + a.name + "”? The blocks stay; only this pairing of them goes.", "Delete", run);
}

/* A fork is a *duplicate*, and a variant is not a leaf — the text lives on its
   versions. Forking used to build a fresh one-version variant out of
   `variantText(src)`, which is only the version that happened to be showing, so
   a variant holding three degrees of "concise" forked down to one and the other
   two were silently gone. It now clones the whole ladder: every version, its
   name, its text, its conditions, and which one was open.

   The conditions are carried across unchanged rather than cleared. They name
   sources that live *outside* this variant and are still exactly where they
   were, so the copy goes on meaning what the original meant — the same reason
   `duplicateBlock` remaps only the ids it moved. A fork you did not want
   conditional is one click from not being; a fork that quietly lost them is
   the bug above wearing a different hat. */
export function forkVariant(b, src) {
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = uid("v");
  copy.name = nextForkName(b, src.name);
  const smap = {};
  copy.versions = (copy.versions || []).map((s) => {
    const old = s.id;
    s.id = uid("s");
    smap[old] = s.id;
    return s;
  });
  if (!copy.versions.length) copy.versions = [makeVersion("1", "")];
  copy.activeVersionId = smap[src.activeVersionId] || copy.versions[0].id;
  copy.createdAt = now();
  copy.updatedAt = now();
  return copy;
}

export function addVariant(blockId, fork) {
  const b = blockById(blockId);
  if (!b) return;
  const src = activeVariant(b);
  const v = fork
    ? forkVariant(b, src)
    : makeVariant("v" + (b.variants.length + 1), "");
  b.variants.splice(b.variants.indexOf(src) + 1, 0, v);
  b.activeVariantId = v.id;
  /* Making a variant is asking to write in it, and Null has no editor — so a
     block sitting on Null comes back on, the same way the `e` key unfolds. */
  if (!depOff(b)) b.enabled = true;
  ui.focusBlockId = b.id;
  /* Both of these put the caret in the editor, and a folded block has no
     editor to put it in — so making one unfolds the block that gets it. */
  b.collapsed = false;
  touch(); renderStack(); renderOutput(); renderRail();
  const ta = $('#vxStackBody .block[data-block="' + b.id + '"] .editor');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

/* "tight" forks to "tight 2", then "tight 3"… */
export function nextForkName(b, name) {
  const base = name.replace(/\s+\d+$/, "");
  let n = 2;
  const taken = new Set(b.variants.map((v) => v.name));
  while (taken.has(base + " " + n)) n++;
  return base + " " + n;
}

export function deleteVariant(blockId, variantId) {
  const b = blockById(blockId);
  if (!b || b.variants.length < 2) return;
  const v = b.variants.find((x) => x.id === variantId);
  const run = () => {
    const i = b.variants.indexOf(v);
    b.variants.splice(i, 1);
    if (b.activeVariantId === variantId) b.activeVariantId = b.variants[Math.max(0, i - 1)].id;
    if (b.compareId === variantId) b.compareId = null;
    const p = project();
    p.takes.forEach((t) => {
      const rec = t.blocks[blockId];
      if (rec && rec.v === variantId) rec.v = b.activeVariantId;
    });
    /* Arrangements that pointed at the deleted variant fall back to whatever
       the block shows now, rather than silently dropping the member. */
    p.groups.forEach((g) => g.variants.forEach((a) => {
      const pick = a.picks[blockId];
      if (pick && pick.v === variantId) a.picks[blockId] = { v: b.activeVariantId, ver: null };
    }));
    /* Conditions that named the variant that just went go with it. */
    pruneConditionSources(p);
    touch(); renderStack(); renderOutput(); renderRail();
  };
  if (v.versions.some((s) => s.text.trim())) askConfirm("Delete variant", "Delete “" + v.name + "” and its " + v.versions.length + " version(s)? Other variants of this block stay.", "Delete", run);
  else run();
}

/* ---------- Versions (a variant's own variants) ---------- */

export function variantIn(b, variantId) {
  return b ? b.variants.find((v) => v.id === variantId) || null : null;
}

export function pickVersion(blockId, variantId, versionId) {
  const b = blockById(blockId);
  const v = variantIn(b, variantId);
  if (!v || v.activeVersionId === versionId) return;
  if (!v.versions.some((s) => s.id === versionId)) return;
  v.activeVersionId = versionId;
  v.updatedAt = now();
  ui.focusBlockId = blockId;
  touch(); renderStack(); renderOutput(); renderRail();
}

export function cycleVersion(blockId, dir) {
  const b = blockById(blockId);
  const v = b ? activeVariant(b) : null;
  if (!v) return;
  const ring = [null].concat(v.versions.filter((s) => !depOff(s)));
  if (ring.length < 2) return;
  let i = versionIsNull(v) ? 0 : ring.findIndex((s) => s && s.id === v.activeVersionId);
  if (i < 0) i = 0;
  const n = ring.length;
  const next = ring[(((i + dir) % n) + n) % n];
  if (next) pickVersion(blockId, v.id, next.id); else setVersionNull(blockId, v.id);
}

export function addVersion(blockId, variantId, fork) {
  const b = blockById(blockId);
  const v = variantIn(b, variantId);
  if (!v) return;
  const src = activeVersion(v);
  const s = makeVersion(
    fork ? nextVersionName(v, src ? src.name : "1") : String(v.versions.length + 1),
    fork && src ? src.text : "",
  );
  v.versions.splice(v.versions.indexOf(src) + 1, 0, s);
  v.activeVersionId = s.id;
  v.updatedAt = now();
  if (!depOff(b)) b.enabled = true;
  ui.focusBlockId = blockId;
  b.collapsed = false;
  touch(); renderStack(); renderOutput(); renderRail();
  const ta = $('#vxStackBody .block[data-block="' + b.id + '"] .editor');
  if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

export function nextVersionName(v, name) {
  const base = String(name || "1").replace(/\s+\d+$/, "");
  let n = 2;
  const taken = new Set(v.versions.map((s) => s.name));
  while (taken.has(base + " " + n)) n++;
  return base + " " + n;
}

export function deleteVersion(blockId, variantId, versionId) {
  const b = blockById(blockId);
  const v = variantIn(b, variantId);
  if (!v || v.versions.length < 2) return;
  const s = v.versions.find((x) => x.id === versionId);
  if (!s) return;
  const run = () => {
    const i = v.versions.indexOf(s);
    v.versions.splice(i, 1);
    if (v.activeVersionId === versionId) v.activeVersionId = v.versions[Math.max(0, i - 1)].id;
    v.updatedAt = now();
    /* Snapshots that named this version fall back to "no opinion", which means
       the variant keeps whatever version it is on rather than being blanked. */
    const p = project();
    p.takes.forEach((t) => {
      const rec = t.blocks[blockId];
      if (rec && rec.ver === versionId) rec.ver = null;
    });
    p.groups.forEach((g) => g.variants.forEach((a) => {
      const pick = a.picks[blockId];
      if (pick && pick.ver === versionId) pick.ver = null;
    }));
    pruneConditionSources(p);
    touch(); renderStack(); renderOutput(); renderRail();
  };
  if (s.text.trim()) {
    askConfirm("Delete version", "Delete version “" + s.name + "” of “" + v.name + "”? The variant's other versions stay.", "Delete", run);
  } else run();
}

export function pickVariant(blockId, variantId) {
  const b = blockById(blockId);
  if (!b) return;
  /* Picking a variant is also how a block comes back from Null — unless a
     dependency is holding it off, in which case its own on/off stays exactly
     where it was, which is what the switch this replaced did. */
  const wake = !b.enabled && !depOff(b);
  if (b.activeVariantId === variantId && !wake) return;
  b.activeVariantId = variantId;
  if (wake) b.enabled = true;
  if (b.compareId === variantId) b.compareId = null;
  ui.focusBlockId = blockId;
  touch(); renderStack(); renderOutput(); renderRail();
}

/* Cycling steps over anything a condition has switched off, the way it steps
   over a chip that is not on screen — the keys move between the variants you
   could have clicked. */
export function cycleVariant(blockId, dir) {
  const b = blockById(blockId);
  if (!b) return;
  const ring = (depOff(b) ? [] : [null]).concat(b.variants.filter((v) => !depOff(v)));
  if (ring.length < 2) return;
  let i = b.enabled ? ring.findIndex((v) => v && v.id === b.activeVariantId) : 0;
  if (i < 0) i = 0;
  const n = ring.length;
  const next = ring[(((i + dir) % n) + n) % n];
  if (next) pickVariant(blockId, next.id); else setBlockNull(blockId);
}

export function pickVariantByIndex(blockId, index) {
  const b = blockById(blockId);
  if (!b || !b.variants[index]) return;
  if (depOff(b.variants[index])) { toast("A dependency is holding that variant off"); return; }
  pickVariant(blockId, b.variants[index].id);
}

/* ---------- Setting the Null slot ----------
   The three "show nothing" moves. Blocks and groups write `enabled`, which is
   the store every take, arrangement and condition already reads; a variant
   writes the sentinel into activeVersionId, which is the only place versions
   needed a new word. Nothing is forgotten either way — the variant, the
   version and the arrangement you came from are all still recorded. */

export function setBlockNull(blockId) {
  const b = blockById(blockId);
  if (!b || !b.enabled) return;
  b.enabled = false;
  ui.focusBlockId = blockId;
  touch(); renderStack(); renderOutput(); renderRail();
}

export function setGroupNull(groupId) {
  const g = groupById(groupId);
  if (!g || !g.enabled) return;
  g.enabled = false;
  touch(); renderStack(); renderOutput(); renderRail();
}

export function setVersionNull(blockId, variantId) {
  const b = blockById(blockId);
  const v = variantIn(b, variantId);
  if (!v || versionIsNull(v)) return;
  v.activeVersionId = NULL_ID;
  v.updatedAt = now();
  ui.focusBlockId = blockId;
  touch(); renderStack(); renderOutput(); renderRail();
}

/* Shuffle rolls the groups first and lets their arrangements land, then rolls
   whatever is still loose — otherwise the arrangement would immediately
   overwrite the members it had just randomised. */
export function shuffleMix() {
  const p = project();
  invalidateDeps();
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  p.groups.forEach((g) => {
    g.activeVariantId = pick(g.variants).id;
    applyArrangement(g);
  });
  p.blocks.forEach((b) => {
    if (b.groupId) return;
    /* Rolling a variant a condition has switched off would land the block on
       something it cannot show, so the roll is over what is available. */
    const open = b.variants.filter((v) => !depOff(v));
    b.activeVariantId = pick(open.length ? open : b.variants).id;
  });
  touch(); renderStack(); renderOutput(); renderRail();
  toast("Shuffled");
}

export function setView(v) { ui.view = v; save(); renderStack(); }

export function setFocusBlock(id, scroll) {
  if (ui.focusBlockId === id) return;
  const prev = ui.focusBlockId;
  ui.focusBlockId = id;
  save();
  /* Cheap: just move the marker classes rather than rebuilding the stack. */
  $$('#vxStackBody [data-block]').forEach((n) => {
    if (!n.classList.contains("block") && !n.classList.contains("mixrow")) return;
    n.classList.toggle("focused", n.getAttribute("data-block") === id);
  });
  if (scroll) {
    const n = $('#vxStackBody [data-block="' + id + '"]');
    if (n) n.scrollIntoView({ block: "nearest" });
  }
  void prev;
}

/* ---------- Takes ----------
   A take records the whole rig, not just the picks: every block's variant
   *and* whether it was on, every group's arrangement *and* whether it was on.

   The rule for anything a take never saw — a block or group added after it
   was saved — is that it is off. A snapshot can only vouch for what existed
   when it was taken, and silently switching on a block written weeks later
   would put text into the prompt that the take never approved.

   One deliberate exception, at the group level. Grouping two blocks that an
   older take had on would otherwise hide them both, because the group the
   take never saw would come back off. So an unknown *group* takes its state
   from its members: on if the take had any of them on. Nothing the take
   actually said is contradicted, and nothing appears that it had off. */

export function resolveTake(t, p) {
  const blocks = {}, groups = {}, banks = {};
  p.blocks.forEach((b) => {
    const r = t.blocks ? t.blocks[b.id] : null;
    const variant = (r && r.v && b.variants.some((v) => v.id === r.v))
      ? b.variants.find((v) => v.id === r.v)
      : activeVariant(b);
    blocks[b.id] = {
      known: !!r,
      on: !!(r && r.on),
      v: variant ? variant.id : null,
      /* A take from before versions existed, or one whose version has since
         been deleted, has no opinion: the variant keeps the version it is on. */
      ver: (r && r.ver && variant && versionIdIsValid(variant, r.ver))
        ? r.ver
        : (variant ? variant.activeVersionId : null),
    };
  });
  p.groups.forEach((g) => {
    const r = t.groups ? t.groups[g.id] : null;
    groups[g.id] = {
      known: !!r,
      on: r ? !!r.on : p.blocks.some((b) => b.groupId === g.id && blocks[b.id] && blocks[b.id].on),
      v: (r && r.v && g.variants.some((a) => a.id === r.v)) ? r.v : g.activeVariantId,
    };
  });
  /* Banks have no on/off, so the "absent means off" rule cannot apply to them.
     A bank the take never saw simply keeps its current word. */
  (p.banks || []).forEach((k) => {
    const wid = t.banks ? t.banks[k.id] : null;
    const known = !!(wid && k.words.some((w) => w.id === wid));
    banks[k.id] = { known, w: known ? wid : k.activeWordId };
  });
  return { blocks, groups, banks };
}

/* Two states are the same take only if every switch and every pick agrees —
   including the groups, so muting a group alone breaks the match. */
export function signatureFrom(p, res) {
  return p.blocks.map((b) => {
    const r = res.blocks[b.id];
    return b.id + ":" + (r.on ? r.v + "/" + r.ver : "off");
  }).join("|") +
    " || " + p.groups.map((g) => g.id + ":" + (res.groups[g.id].on ? res.groups[g.id].v : "off")).join("|") +
    " || " + (p.banks || []).map((k) => k.id + ":" + res.banks[k.id].w).join("|");
}

export function currentSignature() {
  const p = project();
  const res = { blocks: {}, groups: {}, banks: {} };
  p.blocks.forEach((b) => {
    const v = activeVariant(b);
    res.blocks[b.id] = { on: b.enabled, v: b.activeVariantId, ver: v ? v.activeVersionId : null };
  });
  p.groups.forEach((g) => { res.groups[g.id] = { on: g.enabled, v: g.activeVariantId }; });
  (p.banks || []).forEach((k) => { res.banks[k.id] = { w: k.activeWordId }; });
  return signatureFrom(p, res);
}

export function takeSignature(t) {
  const p = project();
  return signatureFrom(p, resolveTake(t, p));
}

export function captureTakeState(p) {
  const blocks = {}, groups = {}, banks = {};
  p.blocks.forEach((b) => {
    const v = activeVariant(b);
    blocks[b.id] = { v: b.activeVariantId, ver: v ? v.activeVersionId : null, on: !!b.enabled };
  });
  p.groups.forEach((g) => { groups[g.id] = { v: g.activeVariantId, on: !!g.enabled }; });
  (p.banks || []).forEach((k) => { banks[k.id] = k.activeWordId; });
  return { blocks, groups, banks };
}

export function saveTake() {
  const p = project();
  const suggested = "Take " + (p.takes.length + 1);
  askText("Save take", "Name this combination", suggested, (name) => {
    const snap = captureTakeState(p);
    p.takes.unshift({ id: uid("t"), name, createdAt: now(), blocks: snap.blocks, groups: snap.groups, banks: snap.banks });
    touch(); renderRail();
    toast("Saved “" + name + "”");
  });
}

export function updateTake(id) {
  const p = project();
  const t = p.takes.find((x) => x.id === id);
  if (!t) return;
  const snap = captureTakeState(p);
  t.blocks = snap.blocks;
  t.groups = snap.groups;
  t.banks = snap.banks;
  touch(); renderRail();
  toast("Updated “" + t.name + "”");
}

export function applyTake(id) {
  const p = project();
  const t = p.takes.find((x) => x.id === id);
  if (!t) return;
  const res = resolveTake(t, p);
  p.groups.forEach((g) => {
    const r = res.groups[g.id];
    g.enabled = r.on;
    g.activeVariantId = r.v;
  });
  /* Blocks are restored *after* the groups, and literally: the take's own
     record wins over what the arrangement would have replayed. The two agree
     whenever the take was saved from a settled state, and where an
     arrangement has been redefined since, what the user asked for back is the
     take. touch() then writes that restored state into the active
     arrangements, so a group never sits half-way between two definitions. */
  p.blocks.forEach((b) => {
    const r = res.blocks[b.id];
    b.enabled = r.on;
    if (r.v && b.variants.some((v) => v.id === r.v)) b.activeVariantId = r.v;
    const variant = activeVariant(b);
    if (variant && r.ver && versionIdIsValid(variant, r.ver)) {
      variant.activeVersionId = r.ver;
    }
  });
  (p.banks || []).forEach((k) => {
    const r = res.banks[k.id];
    if (r && r.w && k.words.some((w) => w.id === r.w)) k.activeWordId = r.w;
  });
  touch(); renderStack(); renderOutput(); renderRail();

  const unseen = p.blocks.filter((b) => !res.blocks[b.id].known).length;
  toast("“" + t.name + "”" + (unseen ? " · " + unseen + " newer block" + (unseen > 1 ? "s" : "") + " left off" : ""));
}

/* ---------- Clipboard, import, export ---------- */

export async function copyText(text, msg) {
  if (!text.trim()) { toast("Nothing to copy"); return; }
  try {
    await navigator.clipboard.writeText(text);
    toast(msg || "Copied");
  } catch (e) {
    /* Clipboard API needs a secure context; fall back to a scratch textarea. */
    const ta = el("textarea", { style: "position:fixed;opacity:0;left:-9999px" });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (e2) { ok = false; }
    ta.remove();
    toast(ok ? (msg || "Copied") : "Could not copy");
  }
}

/* Export takes a copy out; it never changes where the live document is kept.
   In the app the bytes go through the same native `write_download_file` the
   gallery uses for its own exports (it sanitizes the name and avoids
   collisions, Finder-style); without the bridge it falls back to a download. */
/* Named the way the gallery names its log exports ("YYMMDD-HHMMSS - <name>"),
   in local time with seconds. It used to take the date off toISOString(), which
   is UTC: no time at all, and after a late-evening export, tomorrow's date. */
export function exportFileName(d = new Date()) {
  const p2 = (n) => String(n).padStart(2, "0");
  const stamp = p2(d.getFullYear() % 100) + p2(d.getMonth() + 1) + p2(d.getDate()) +
    "-" + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  return stamp + " - Variations.json";
}

/* Local wall-clock time with its UTC offset, e.g. 2026-09-15T14:30:12-07:00,
   so the moment is exact and still reads as the time on the clock. */
export function localIsoWithOffset(d) {
  const p2 = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
    "T" + p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) +
    (off >= 0 ? "+" : "-") + p2(off / 60) + ":" + p2(off % 60);
}

export function exportJson() {
  const d = new Date();
  /* The document as it is, plus when it was taken out. Import reads only
     `projects`, so the two stamps ride along without changing what imports. */
  const json = JSON.stringify(
    Object.assign({ exportedAt: d.getTime(), exportedAtLocal: localIsoWithOffset(d) }, state),
    null, 2,
  );
  const name = exportFileName(d);

  if (isApp()) {
    HOST.invoke("write_download_file", {
      fileName: name,
      bytes: Array.from(new TextEncoder().encode(json)),
    })
      .then((path) => toast("Exported to " + String(path || name)))
      .catch((e) => toast("Export failed: " + e));
    return;
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Exported");
}

export function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(String(reader.result)); }
    catch (e) { toast("That file is not valid JSON"); return; }
    const incoming = parsed && Array.isArray(parsed.projects) ? parsed.projects
                   : (parsed && parsed.blocks ? [parsed] : null);
    if (!incoming || !incoming.length) { toast("No projects found in that file"); return; }
    /* Import adds; it never replaces what is already here. */
    const merged = normalize({ projects: incoming, activeProjectId: null });
    merged.projects.forEach((p) => { p.id = uid("p"); state.projects.unshift(p); });
    state.activeProjectId = state.projects[0].id;
    ui.focusBlockId = null;
    renderAll();
    /* renderAll only schedules the debounced write. An import is a large,
       deliberate change, so put it on disk now — in the app that means the
       library's metadata folder, the same place every other edit lands. */
    flushSave();
    toast("Imported " + merged.projects.length + " project" + (merged.projects.length > 1 ? "s" : ""));
  };
  reader.readAsText(file);
}

