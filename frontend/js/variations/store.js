/* Variations: the document
   State, where it is saved, normalising old documents, and the rules (banks, notes, groups, dependencies). */

// -- imports (generated) --
import { $, toast } from "./dom.js";
import { open } from "./main.js";
// -- end imports --

/* ============================================================
   1. State
   ------------------------------------------------------------
   A project is one prompt. A prompt is an ordered stack of
   blocks. A block holds many variants; exactly one is active.

   Adjacent blocks can be wired into a group. A group switches
   its members on and off as one, and holds its own variants —
   arrangements — where an arrangement records which members are
   on and which variant each of them is showing. So the nesting
   is: block variants inside arrangements inside the stack.

   A variant is itself a slot rather than a leaf: it holds
   **versions**, and the text lives on the version. That is what
   lets one idea ("concise") keep three degrees of itself
   without spending three variant slots on the same concept.
   So the ladder is version inside variant inside arrangement
   inside the stack.

   A **word bank** is the one project-wide knob. It is named in
   SCREAMING_SNAKE, holds any number of words with one selected,
   and every occurrence of its name in block text is replaced by
   that word when the prompt is assembled.

   A take is a saved snapshot of the whole rig: every block's
   variant, version *and* on/off state, every group's arrangement
   and on/off state, and every bank's selected word. Anything a
   take never saw is off when it is applied — a snapshot cannot
   vouch for a block that did not exist when it was taken.
   ============================================================ */

export const STORE_KEY = "variations.state.v1";
export const UI_KEY    = "variations.ui.v1";

export let state = null;   // { projects: [...], activeProjectId }
export const ui = {
  view: "edit",       // "edit" | "mixer"
  railOpen: true,
  outputOpen: true,
  focusBlockId: null, // keyboard cursor
  /* Purely a view filter over the stack. It is deliberately blanked on load —
     ui is persisted wholesale, and opening the app into a filtered stack with
     most of the project missing would read as data loss. */
  searchQuery: "",
};

export const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const now = () => Date.now();

/* ---------- Null ----------
   "Off" is presented as a slot rather than a switch: a block is always showing
   one of its variants *or* Null, a group one of its arrangements or Null, a
   variant one of its versions or Null. Null cannot be renamed, reordered,
   deleted or written into — it is the absence, wearing the shape of an option.

   For blocks and groups this is presentation only. The store is still
   `enabled`, which is what takes, arrangements and conditions already speak
   about, so nothing downstream had to learn a new word. A variant had no such
   flag, so its Null is a sentinel in `activeVersionId`; every place that
   validates a stored version id goes through versionIdIsValid, which lets the
   sentinel through, and activeVersion() answers null for it. */
export const NULL_ID = "__null__";
export const versionIdIsValid = (v, id) => id === NULL_ID || !!(v && (v.versions || []).some((x) => x.id === id));
export const versionIsNull = (v) => !!v && v.activeVersionId === NULL_ID;

/* A version is where the text actually lives. A variant is a named slot that
   holds one or more of them, so "concise" can have three degrees of concise
   without spending three variant slots on one idea. A variant with a single
   version behaves exactly like a variant used to. */
export function makeVersion(name, text) {
  return { id: uid("s"), name: name || "1", text: text || "", conditions: [], createdAt: now(), updatedAt: now() };
}
export function makeVariant(name, text) {
  const s = makeVersion("1", text || "");
  return { id: uid("v"), name: name || "v1", versions: [s], activeVersionId: s.id, conditions: [], createdAt: now(), updatedAt: now() };
}

/* A word bank is a project-wide swap. Its name is written into block text and
   replaced by the selected word when the prompt is assembled. The naming rule
   is the whole safety mechanism: SCREAMING_SNAKE never turns up by accident in
   ordinary prose, so no escaping syntax is needed. */
export function bankNameFrom(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}
export function makeWord(text) {
  return { id: uid("w"), text: text || "" };
}
export function makeBank(name, words) {
  const ws = (words && words.length) ? words : [makeWord("")];
  return { id: uid("k"), name: bankNameFrom(name) || "BANK", words: ws, activeWordId: ws[0].id, createdAt: now() };
}
export function makeBlock(label, variants) {
  const vs = (variants && variants.length) ? variants : [makeVariant("v1", "")];
  return {
    id: uid("b"), label: label || "Untitled", enabled: true, collapsed: false,
    variants: vs, activeVariantId: vs[0].id, compareId: null,
    groupId: null, conditions: [],
  };
}

/* An arrangement is a group's variant: which members are on, and which
   variant *and version* each of them shows. `picks` and `off` only ever mention
   members the arrangement knows about — a member added later is simply absent,
   and absent means off, the same rule takes use.

   picks is keyed by block id and holds { v, ver }. A version of null means the
   arrangement predates versions and has no opinion, so the variant keeps
   whichever version it is already on. */
export function makeArrangement(name) {
  return { id: uid("a"), name: name || "a1", picks: {}, off: [], createdAt: now(), updatedAt: now() };
}
export function makeGroup(label) {
  const a = makeArrangement("a1");
  return { id: uid("g"), label: label || "Group", enabled: true, collapsed: false, variants: [a], activeVariantId: a.id, conditions: [] };
}
export function makeProject(name, blocks, groups) {
  return {
    id: uid("p"), name: name || "Untitled prompt",
    createdAt: now(), updatedAt: now(),
    includeLabels: false,
    blocks: blocks || [makeBlock("Section", null)],
    groups: groups || [],
    banks: [],
    takes: [],
  };
}

/* A seed project, so the app opens with something to touch — including one
   group, so the idea is visible rather than only documented. */
export function seedState() {
  const role = makeBlock("Role", [
    makeVariant("plain", "You are a research assistant."),
    makeVariant("expert", "You are a senior research analyst with fifteen years of experience synthesising primary sources."),
    makeVariant("terse", "Act as a research analyst."),
  ]);
  const task = makeBlock("Task", [
    makeVariant("broad", "Read the material below and write a brief that captures what matters."),
    makeVariant("specific", "Read the material below and write a brief covering: the central claim, the evidence behind it, and the strongest objection to it."),
  ]);
  const tone = makeBlock("Tone", [
    makeVariant("neutral", "Write plainly. No hedging, no filler, no summary of your own process."),
    makeVariant("warm", "Write plainly but warmly, as if explaining to a colleague you respect."),
    makeVariant("blunt", "Be blunt. If the evidence is thin, say so in the first sentence."),
  ]);
  const constraints = makeBlock("Constraints", [
    makeVariant("tight", "Stay under 300 words. Do not invent citations. If a fact is not in the material, leave it out."),
    makeVariant("loose", "Length is up to you. Do not invent citations."),
  ]);
  /* "tight" is one idea held at three strengths, which is what versions are
     for: the alternative was three variants all meaning the same thing. */
  const tightVariant = constraints.variants[0];
  tightVariant.versions[0].name = "300";
  tightVariant.versions.push(
    makeVersion("150", "Stay under 150 words. Do not invent citations. If a fact is not in the material, leave it out."),
    makeVersion("no cap", "Do not pad. Stop when the point is made. Do not invent citations."),
  );
  const out = makeBlock("Output", [
    makeVariant("prose", "Return the brief as continuous prose with no headings."),
    makeVariant("sections", "Return the brief with three headings: Claim, Evidence, Objection."),
    makeVariant("json", 'Return JSON: {"claim": string, "evidence": string[], "objection": string}'),
  ]);

  /* Tone and Constraints travel together: two ways of sounding, each one a
     pairing of the two blocks. */
  const voice = makeGroup("Voice");
  tone.groupId = voice.id;
  constraints.groupId = voice.id;
  const house = voice.variants[0];
  house.name = "house";
  house.picks = { [tone.id]: tone.variants[0].id, [constraints.id]: constraints.variants[0].id };
  const unsparing = makeArrangement("unsparing");
  unsparing.picks = { [tone.id]: tone.variants[2].id, [constraints.id]: constraints.variants[1].id };
  voice.variants.push(unsparing);

  const p = makeProject("Research brief", [role, task, tone, constraints, out], [voice]);

  /* One bank, wired into two blocks, so the swap is visible from the start. */
  const audience = makeBank("AUDIENCE", [makeWord("a colleague"), makeWord("a sceptical editor"), makeWord("a newcomer to the field")]);
  p.banks.push(audience);
  tone.variants[1].versions[0].text =
    "Write plainly but warmly, as if explaining to AUDIENCE you respect.";
  task.variants[1].versions[0].text =
    "Read the material below and write a brief for AUDIENCE covering: the central claim, the evidence behind it, and the strongest objection to it.";

  return { version: 1, projects: [p], activeProjectId: p.id };
}

/* ------------------------------------------------------------
   Where the document lives.

   In the app: the library's own metadata folder,
   <library>/.local-gallery/variations.json, through the same
   read_file_bytes / write_file_bytes commands the gallery uses
   (the write is temp file + rename, so a crash mid-write cannot
   truncate it). This is the file the old embedded Variations
   window wrote, so a library keeps its projects across the move.

   If the bridge or the metadata folder cannot be had, the
   document goes to localStorage instead -- the keys the old page
   used in a browser -- and the top bar says so. Silently saving
   somewhere else would be worse than saying it.
   ------------------------------------------------------------ */

export const DOC_NAME = "variations.json";

export const HOST = {
  mode: "local",    // "app" | "local"
  invoke: null,
  file: "",
  note: "",         // shown when the library's file is not available
};

export const isApp = () => HOST.mode === "app";

export async function hostInit() {
  const invoke = window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke;
  if (typeof invoke !== "function") {
    HOST.note = "Saving to this window's local store";
    return;
  }
  HOST.invoke = invoke;
  try {
    const meta = String(await invoke("get_metadata_root") || "").replace(/\/+$/, "");
    if (!meta) throw new Error("empty metadata root");
    HOST.file = meta + "/" + DOC_NAME;
    HOST.mode = "app";
  } catch (e) {
    HOST.note = "No library folder -- saving to this window's local store";
  }
}

export async function hostRead() {
  if (!isApp()) {
    const out = {};
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) out.state = JSON.parse(raw);
    } catch (e) { console.warn("Variations: could not read saved state:", e); }
    try {
      const rawUi = localStorage.getItem(UI_KEY);
      if (rawUi) out.ui = JSON.parse(rawUi);
    } catch (e) { /* defaults are fine */ }
    return out;
  }
  try {
    const bytes = await HOST.invoke("read_file_bytes", { path: HOST.file });
    const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    return { state: doc && doc.state, ui: doc && doc.ui };
  } catch (e) {
    /* First run in this library: the file simply does not exist yet. */
    return {};
  }
}

export function hostWrite() {
  if (!isApp()) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
      localStorage.setItem(UI_KEY, JSON.stringify(ui));
    } catch (e) { toast("Could not save to this window's storage"); }
    return Promise.resolve();
  }
  const json = JSON.stringify({ version: 1, savedAt: now(), state, ui }, null, 2);
  const bytes = Array.from(new TextEncoder().encode(json));
  return HOST.invoke("write_file_bytes", { path: HOST.file, bytes })
    .catch((e) => { toast("Could not save: " + e); });
}

/* Read once, the first time Variations is opened. */
export async function load() {
  await hostInit();
  const doc = await hostRead();
  try {
    if (doc.state && Array.isArray(doc.state.projects) && doc.state.projects.length) {
      state = normalize(doc.state);
    }
  } catch (e) { console.warn("Variations: saved document was unreadable:", e); }
  if (!state) state = seedState();
  if (doc.ui) Object.assign(ui, doc.ui);
  /* The old page had a light/dark switch of its own. The colours follow the
     app's Theme now, so the stored flag is dropped rather than carried. */
  delete ui.dusk;
  /* A filter is a thing you are doing, not a thing you have set. */
  ui.searchQuery = "";
}

/* Never leave an empty window: if loading failed outright, start fresh. */
export function ensureState() {
  if (!state) state = seedState();
}

/* Defensive: a hand-edited or older export should never wedge the app.
   This is also where documents written before groups existed are brought
   forward — they have no `groups`, and their takes carry the old
   picks/disabled pair instead of a per-block record. */
export function normalize(s) {
  s.projects = s.projects.filter(Boolean).map((p) => {
    p.id = p.id || uid("p");
    p.name = typeof p.name === "string" ? p.name : "Untitled prompt";
    p.includeLabels = !!p.includeLabels;
    p.takes = Array.isArray(p.takes) ? p.takes : [];
    p.blocks = (Array.isArray(p.blocks) ? p.blocks : []).filter(Boolean).map((b) => {
      b.id = b.id || uid("b");
      b.label = typeof b.label === "string" ? b.label : "Untitled";
      b.enabled = b.enabled !== false;
      /* Folded shut is a view, not a state of the prompt, but it lives on the
         block the way a group's does rather than in `ui` — so a stack you left
         folded down to its headings opens that way, and does on another
         machine too. Absent means open, which is what every document written
         before this existed means. */
      b.collapsed = !!b.collapsed;
      b.groupId = typeof b.groupId === "string" ? b.groupId : null;
      b.conditions = normalizeConditions(b.conditions);
      b.variants = (Array.isArray(b.variants) ? b.variants : []).filter(Boolean).map((v) => {
        /* Before versions existed the text sat on the variant. Lift it into a
           single version, which is exactly what a one-version variant means. */
        let versions = Array.isArray(v.versions) ? v.versions.filter(Boolean) : null;
        if (!versions || !versions.length) {
          versions = [makeVersion("1", typeof v.text === "string" ? v.text : "")];
        } else {
          versions = versions.map((s) => ({
            id: s.id || uid("s"),
            name: typeof s.name === "string" ? s.name : "1",
            text: typeof s.text === "string" ? s.text : "",
            conditions: normalizeConditions(s.conditions),
            createdAt: s.createdAt || now(), updatedAt: s.updatedAt || now(),
          }));
        }
        const out = {
          id: v.id || uid("v"),
          name: typeof v.name === "string" ? v.name : "v",
          versions,
          activeVersionId: v.activeVersionId,
          conditions: normalizeConditions(v.conditions),
          createdAt: v.createdAt || now(), updatedAt: v.updatedAt || now(),
        };
        if (!versionIdIsValid(out, out.activeVersionId)) out.activeVersionId = versions[0].id;
        return out;
      });
      if (!b.variants.length) b.variants = [makeVariant("v1", "")];
      if (!b.variants.some((v) => v.id === b.activeVariantId)) b.activeVariantId = b.variants[0].id;
      if (b.compareId && !b.variants.some((v) => v.id === b.compareId)) b.compareId = null;
      return b;
    });
    if (!p.blocks.length) p.blocks = [makeBlock("Section", null)];

    /* Groups. A group with no members left is not a group. */
    p.groups = (Array.isArray(p.groups) ? p.groups : []).filter(Boolean).map((g) => {
      g.id = g.id || uid("g");
      g.label = typeof g.label === "string" ? g.label : "Group";
      g.enabled = g.enabled !== false;
      g.collapsed = !!g.collapsed;
      g.conditions = normalizeConditions(g.conditions);
      g.variants = (Array.isArray(g.variants) ? g.variants : []).filter(Boolean).map((a) => ({
        id: a.id || uid("a"),
        name: typeof a.name === "string" ? a.name : "a",
        picks: (a.picks && typeof a.picks === "object") ? a.picks : {},
        off: Array.isArray(a.off) ? a.off.filter((x) => typeof x === "string") : [],
        createdAt: a.createdAt || now(), updatedAt: a.updatedAt || now(),
      }));
      if (!g.variants.length) g.variants = [makeArrangement("a1")];
      if (!g.variants.some((a) => a.id === g.activeVariantId)) g.activeVariantId = g.variants[0].id;
      return g;
    });
    const groupIds = new Set(p.groups.map((g) => g.id));
    p.blocks.forEach((b) => { if (b.groupId && !groupIds.has(b.groupId)) b.groupId = null; });
    p.groups = p.groups.filter((g) => p.blocks.some((b) => b.groupId === g.id));
    const liveGroups = new Set(p.groups.map((g) => g.id));
    p.blocks.forEach((b) => { if (b.groupId && !liveGroups.has(b.groupId)) b.groupId = null; });

    /* An arrangement may only speak about blocks that are still its members.
       A pick used to be a bare variant id; it is now { v, ver }. An old pick
       has no opinion about the version, which is what ver: null means. */
    p.groups.forEach((g) => {
      const members = new Set(p.blocks.filter((b) => b.groupId === g.id).map((b) => b.id));
      g.variants.forEach((a) => {
        const picks = {};
        for (const bid in a.picks) {
          if (!members.has(bid)) continue;
          const b = p.blocks.find((x) => x.id === bid);
          if (!b) continue;
          const raw = a.picks[bid];
          const vid = typeof raw === "string" ? raw : (raw && raw.v);
          const variant = b.variants.find((v) => v.id === vid);
          if (!variant) continue;
          const verRaw = (raw && typeof raw === "object") ? raw.ver : null;
          picks[bid] = {
            v: variant.id,
            ver: versionIdIsValid(variant, verRaw) ? verRaw : null,
          };
        }
        a.picks = picks;
        a.off = a.off.filter((bid) => members.has(bid));
      });
    });
    normalizeGroupOrder(p);
    pruneConditionSources(p);

    /* Word banks. A bank with no words cannot substitute anything, but it is
       kept rather than dropped — an empty bank is a bank you have not filled
       in yet, and deleting the user's work to tidy up would be worse. */
    const seenBankNames = new Set();
    p.banks = (Array.isArray(p.banks) ? p.banks : []).filter(Boolean).map((k) => {
      k.id = k.id || uid("k");
      k.name = bankNameFrom(k.name) || "BANK";
      /* Names are the lookup key, so they have to be unique within a project. */
      let name = k.name, n = 2;
      while (seenBankNames.has(name)) name = k.name + "_" + n++;
      k.name = name;
      seenBankNames.add(name);
      k.words = (Array.isArray(k.words) ? k.words : []).filter(Boolean).map((w) => ({
        id: w.id || uid("w"),
        text: typeof w.text === "string" ? w.text : "",
      }));
      if (!k.words.length) k.words = [makeWord("")];
      if (!k.words.some((w) => w.id === k.activeWordId)) k.activeWordId = k.words[0].id;
      k.createdAt = k.createdAt || now();
      return k;
    });

    /* Takes: bring the old shape forward, then drop what no longer exists. */
    p.takes = p.takes.filter(Boolean).map((t) => {
      t.id = t.id || uid("t");
      t.name = typeof t.name === "string" ? t.name : "Take";
      t.createdAt = t.createdAt || now();
      if (!t.blocks || typeof t.blocks !== "object") {
        const picks = (t.picks && typeof t.picks === "object") ? t.picks : {};
        const disabled = Array.isArray(t.disabled) ? t.disabled : [];
        const blocks = {};
        /* The old format only listed blocks that existed when it was saved,
           so its key set is exactly what this take is entitled to speak for. */
        for (const bid in picks) blocks[bid] = { v: picks[bid], on: !disabled.includes(bid) };
        disabled.forEach((bid) => { if (!blocks[bid]) blocks[bid] = { v: null, on: false }; });
        t.blocks = blocks;
      }
      delete t.picks; delete t.disabled;
      if (!t.groups || typeof t.groups !== "object") t.groups = {};
      if (!t.banks || typeof t.banks !== "object") t.banks = {};
      const keptBlocks = {};
      p.blocks.forEach((b) => {
        const r = t.blocks[b.id];
        if (!r || typeof r !== "object") return;
        const variant = b.variants.find((v) => v.id === r.v) || null;
        keptBlocks[b.id] = {
          v: variant ? variant.id : null,
          /* A take saved before versions has no opinion about which one. */
          ver: variant && versionIdIsValid(variant, r.ver) ? r.ver : null,
          on: !!r.on,
        };
      });
      t.blocks = keptBlocks;
      const keptGroups = {};
      p.groups.forEach((g) => {
        const r = t.groups[g.id];
        if (!r || typeof r !== "object") return;
        keptGroups[g.id] = { v: g.variants.some((a) => a.id === r.v) ? r.v : null, on: !!r.on };
      });
      t.groups = keptGroups;
      const keptBanks = {};
      p.banks.forEach((k) => {
        const wid = t.banks[k.id];
        if (typeof wid !== "string") return;
        if (k.words.some((w) => w.id === wid)) keptBanks[k.id] = wid;
      });
      t.banks = keptBanks;
      return t;
    });
    return p;
  });
  if (!s.projects.some((p) => p.id === s.activeProjectId)) s.activeProjectId = s.projects[0].id;
  return s;
}

/* A group is drawn as one container, so its members have to be contiguous.
   Each group is pulled together at the position of its first member; every
   grouping mutation ends by calling this. */
export function normalizeGroupOrder(p) {
  const out = [];
  const done = new Set();
  for (const b of p.blocks) {
    if (!b.groupId) { out.push(b); continue; }
    if (done.has(b.groupId)) continue;
    done.add(b.groupId);
    for (const m of p.blocks) if (m.groupId === b.groupId) out.push(m);
  }
  p.blocks = out;
}

/* ---------- Conditions: the stored half of the dependency system ----------
   A condition is owned by the *dependent* item. The source knows nothing about
   what hangs off it, which is what keeps deleting a source cheap: nothing has
   to be unwired, and an orphaned condition simply passes. */

export function makeCondition(sourceType, sourceId) {
  return {
    id: uid("c"),
    sourceType: sourceType === "group" ? "group" : "block",
    sourceId: sourceId || "",
    require: { variantIds: [], versionIds: [], arrangementIds: [], enabled: null },
  };
}

export const idList = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === "string") : []);

export function normalizeConditions(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c === "object" && typeof c.sourceId === "string" && c.sourceId).map((c) => {
    const req = (c.require && typeof c.require === "object") ? c.require : {};
    return {
      id: typeof c.id === "string" && c.id ? c.id : uid("c"),
      sourceType: c.sourceType === "group" ? "group" : "block",
      sourceId: c.sourceId,
      require: {
        variantIds: idList(req.variantIds),
        versionIds: idList(req.versionIds),
        arrangementIds: idList(req.arrangementIds),
        enabled: typeof req.enabled === "boolean" ? req.enabled : null,
      },
      /* A condition used to carry an effect, and one of the two was to remove
         the item from the stack entirely. That is dropped rather than migrated:
         content you cannot see is content you cannot switch back on, and a
         section that vanishes takes the way to bring it back with it. */
    };
  });
}

/* Every item that can carry conditions, so the load-time prune and the id
   remap of a duplicate both have one list to walk. */
export function conditionHosts(p) {
  const out = [];
  p.blocks.forEach((b) => {
    out.push(b);
    b.variants.forEach((v) => { out.push(v); v.versions.forEach((s) => out.push(s)); });
  });
  (p.groups || []).forEach((g) => out.push(g));
  return out;
}

/* Conditions carried into a copy. Every id in one is a reference, so each has
   to be looked up in the map for its own kind; an id with no entry is left as
   it is, which is right for a block duplicated inside its own project, where
   the sources have not moved. */
export function remapConditions(list, maps) {
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({
    id: uid("c"),
    sourceType: c.sourceType,
    sourceId: ((c.sourceType === "group" ? maps.g : maps.b)[c.sourceId]) || c.sourceId,
    require: {
      variantIds: (c.require.variantIds || []).map((id) => maps.v[id] || id),
      versionIds: (c.require.versionIds || []).map((id) => maps.s[id] || id),
      arrangementIds: (c.require.arrangementIds || []).map((id) => maps.a[id] || id),
      enabled: c.require.enabled,
    },
  }));
}

/* A condition that names something which no longer exists is dropped, at every
   level: the source block or group it hangs off, and the variants, versions and
   arrangements it names inside that source.

   Dead ids used to be left in place, on the reasoning that a condition naming a
   deleted variant is a condition that no longer passes and that saying so is
   more honest than quietly widening it. In practice it is neither: the rule it
   states can never be met again, so the dependent is held off for good behind a
   state that cannot be reached, and the dialog goes on listing it as a live
   rule. So a list is filtered down to what is still there, and a list that had
   entries and now has none takes its condition with it — as does a condition
   left asking for nothing at all. Fail-open, all the way down. */
export function pruneConditionSources(p) {
  const blocks = new Set(p.blocks.map((b) => b.id));
  const groups = new Set((p.groups || []).map((g) => g.id));
  const variants = new Set();
  const versions = new Set();
  const arrangements = new Set();
  p.blocks.forEach((b) => b.variants.forEach((v) => {
    variants.add(v.id);
    v.versions.forEach((x) => versions.add(x.id));
  }));
  (p.groups || []).forEach((g) => g.variants.forEach((a) => arrangements.add(a.id)));

  conditionHosts(p).forEach((item) => {
    if (!item.conditions || !item.conditions.length) return;
    item.conditions = item.conditions.filter((c) => {
      const liveSource = c.sourceType === "group" ? groups.has(c.sourceId) : blocks.has(c.sourceId);
      if (!liveSource) return false;
      const req = c.require;
      const kept = {
        variantIds: req.variantIds.filter((id) => variants.has(id)),
        versionIds: req.versionIds.filter((id) => versions.has(id)),
        arrangementIds: req.arrangementIds.filter((id) => arrangements.has(id)),
      };
      /* A list emptied by a deletion is a rule that has lost its subject. */
      for (const key in kept) if (req[key].length && !kept[key].length) return false;
      req.variantIds = kept.variantIds;
      req.versionIds = kept.versionIds;
      req.arrangementIds = kept.arrangementIds;
      return req.variantIds.length || req.versionIds.length ||
             req.arrangementIds.length || typeof req.enabled === "boolean";
    });
  });
}

export let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; hostWrite(); }, 180);
}

/* Write now rather than at the end of the debounce: on closing Variations,
   and when the page is going away. */
export function flushSave() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  hostWrite();
}

/* Closing Variations flushes too (main.js); these cover quitting the app
   with it open. */
window.addEventListener("pagehide", flushSave);
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });

export const project = () => state.projects.find((p) => p.id === state.activeProjectId) || state.projects[0];
export const blockById = (id) => project().blocks.find((b) => b.id === id) || null;
export const activeVariant = (b) => b.variants.find((v) => v.id === b.activeVariantId) || b.variants[0];
export const activeVersion = (v) =>
  (!v || v.activeVersionId === NULL_ID)
    ? null
    : (v.versions.find((s) => s.id === v.activeVersionId) || v.versions[0]);

/* The text a variant currently shows. Everything that reads block text goes
   through this rather than reaching for a `.text` that no longer exists. */
export function variantText(v) {
  const s = activeVersion(v);
  return s ? s.text : "";
}
export const blockText = (b) => variantText(activeVariant(b));

/* ---------- Word banks ---------- */

export const banksOf = () => project().banks || [];
export const activeWord = (k) => k.words.find((w) => w.id === k.activeWordId) || k.words[0];

/* Split text into plain runs and bank hits. One pass, longest name first, so
   TONE never eats the front of TONE_STRICT. The guards on either side are
   character classes rather than \b because an underscore is a word character:
   \bTONE\b would already refuse to match inside TONE_STRICT, but spelling the
   rule out keeps it true if the naming rule is ever loosened.

   A bank with no usable word is deliberately left unsubstituted, so an
   unfilled bank shows up in the prompt as its own name instead of silently
   deleting itself. */
export function bankSegments(text) {
  const banks = banksOf();
  if (!banks.length || !text) return [{ text: text || "" }];
  const byName = new Map();
  banks.forEach((k) => byName.set(k.name, k));
  const names = banks.map((k) => k.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text }];
  const re = new RegExp(
    "(^|[^A-Z0-9_])(" + names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")(?![A-Z0-9_])",
    "g",
  );
  const out = [];
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    const bank = byName.get(m[2]);
    const word = bank ? activeWord(bank) : null;
    const hitAt = m.index + m[1].length;
    if (!word || !word.text.trim()) continue;   // unfilled: leave the name in place
    if (hitAt > last) out.push({ text: text.slice(last, hitAt) });
    out.push({ text: word.text, bankId: bank.id, bankName: bank.name });
    last = hitAt + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

export const substituteBanks = (text) => bankSegments(text).map((s) => s.text).join("");

/* ---------- Inline notes ----------

   A note is commentary that lives with the text and never reaches the prompt:
   "works better after scene 2", "only use with the psychic thoughts block".
   Putting that in the prompt itself is the alternative, and it pollutes the
   output; putting it in a separate field is the other alternative, and then it
   is nowhere near the sentence it is about.

   A line beginning with // is a note. A line that is *only* // opens a note
   that runs until the next line that is only //, so a paragraph of commentary
   does not need a marker per line. An unclosed multi-line note runs to the end
   of the version, which is what the marker literally says; the editor bands
   every note line, so a stray opener is visible rather than mysterious.

   This is a parse, not a store: the raw string with the notes in it is what is
   saved, edited, forked, exported and diffed. Only the readers that feed the
   prompt strip them, and they all come through here. */
export function splitNotes(text) {
  const lines = String(text == null ? "" : text).split("\n");
  const prompt = [], notes = [], lineFlags = new Array(lines.length).fill(false);
  let open = false, buf = null;
  const closeBuf = () => { if (buf && buf.join("\n").trim()) notes.push(buf.join("\n")); buf = null; };
  lines.forEach((line, i) => {
    const solo = line.trim() === "//";
    if (open) {
      lineFlags[i] = true;
      if (solo) { closeBuf(); open = false; return; }
      buf.push(line);
      return;
    }
    if (solo) { lineFlags[i] = true; open = true; buf = []; return; }
    if (/^\s*\/\//.test(line)) {
      lineFlags[i] = true;
      const body = line.replace(/^\s*\/\/\s?/, "");
      if (body.trim()) notes.push(body);   // an empty note is not a note
      return;
    }
    prompt.push(line);
  });
  closeBuf();
  return { prompt: prompt.join("\n"), notes, lineFlags };
}

export const stripNotes = (text) => splitNotes(text).prompt;
export const hasNotes = (text) => /(^|\n)\s*\/\//.test(String(text || ""));

/* ---------- Groups ---------- */

export const groupById = (id) => (id ? project().groups.find((g) => g.id === id) || null : null);
export const groupOf = (b) => (b && b.groupId ? groupById(b.groupId) : null);
export const membersOf = (g) => project().blocks.filter((b) => b.groupId === g.id);
export const activeArrangement = (g) => g.variants.find((a) => a.id === g.activeVariantId) || g.variants[0];

/* ---------- Dependencies: the live half ----------

   A block, variant, version or group can declare that it only makes sense when
   something else is in a particular state. The declaration is evaluated on
   every render against the current picks, exactly like an arrangement, and it
   never writes anything back: an item a condition has switched off keeps its
   own on/off setting, its variant and its version, and gets them all back the
   moment the condition passes again.

   **A condition holds an item off; it never takes it out of the stack.** That
   is the one behaviour, and there is nothing to choose. The alternative — a
   dependent that disappears — loses whole sections behind a controller you
   then have to remember, and the way back is exactly the thing that is no
   longer on screen. Held off, it is struck through with its switch locked and
   the reason on it, and it is plainly out of the prompt.

   Three rules make it safe to leave lying around:
     · a condition whose source is missing passes, so deleting a controller
       cannot leave content stuck off;
     · a cycle is broken by treating the re-entered item as passing, rather
       than by refusing to evaluate either end;
     · the result is cached per render pass, so switching a controlling block
       that fifty items hang off is still one walk of the stack. */

export const DEP = { cache: new Map(), busy: new Set(), warned: new Set() };

export function invalidateDeps() { DEP.cache.clear(); }

/* True when one of the item's conditions is currently holding it off. */
export function depOff(item) {
  if (!item || !item.conditions || !item.conditions.length) return false;
  if (DEP.cache.has(item.id)) return DEP.cache.get(item.id);
  if (DEP.busy.has(item.id)) {
    if (!DEP.warned.has(item.id)) {
      DEP.warned.add(item.id);
      console.warn("Variations: dependency cycle through", item.id, "— treating it as satisfied");
    }
    return false;
  }
  DEP.busy.add(item.id);
  let out = false;
  try {
    out = !item.conditions.every(conditionPasses);
  } finally { DEP.busy.delete(item.id); }
  DEP.cache.set(item.id, out);
  return out;
}

/* Within one condition the id lists are OR — any of these states will do —
   and the enabled constraint is a separate AND on top. Several conditions on
   one item are AND. */
export function conditionPasses(c) {
  const p = project();
  if (c.sourceType === "group") {
    const g = p.groups.find((x) => x.id === c.sourceId);
    if (!g) return true;                                  // fail-open
    const want = c.require.arrangementIds;
    if (want.length && !want.includes(g.activeVariantId)) return false;
    if (typeof c.require.enabled === "boolean" && groupIncluded(g) !== c.require.enabled) return false;
    return true;
  }
  const b = p.blocks.find((x) => x.id === c.sourceId);
  if (!b) return true;
  const wantV = c.require.variantIds, wantS = c.require.versionIds;
  if (wantV.length || wantS.length) {
    /* Against what the source is actually showing, which is its effective
       variant — if its own active variant is switched off by a condition, the
       text on screen and in the prompt is the fallback, and that is the state
       a dependent should be reading. */
    const v = effectiveVariant(b);
    const s = v ? effectiveVersion(v) : null;
    const ok = (wantV.length && v && wantV.includes(v.id)) ||
               (wantS.length && s && wantS.includes(s.id));
    if (!ok) return false;
  }
  if (typeof c.require.enabled === "boolean" && blockIncluded(b) !== c.require.enabled) return false;
  return true;
}

/* The variant a block is really showing. Normally the active one; when a
   condition has switched that one off, the first one still available — chosen
   for the render and the prompt only, never written back to activeVariantId. */
export function effectiveVariant(b) {
  const av = activeVariant(b);
  if (!av || !depOff(av)) return av;
  return b.variants.find((v) => !depOff(v)) || null;
}
export function effectiveVersion(v) {
  if (!v) return null;
  const s = activeVersion(v);
  if (!s || !depOff(s)) return s;
  return v.versions.find((x) => !depOff(x)) || null;
}
export function effectiveText(b) {
  const v = effectiveVariant(b);
  const s = effectiveVersion(v);
  return s ? s.text : "";
}

/* What actually reaches the prompt: a block must be on, its conditions must be
   satisfied, and the group holding it must pass both tests too. The switches
   are independent — muting a group does not forget which of its members were
   on, and a condition does not forget either. */
export function groupIncluded(g) {
  return !!g && g.enabled && !depOff(g);
}
export function blockIncluded(b) {
  if (!b.enabled || depOff(b)) return false;
  const g = groupOf(b);
  return !g || groupIncluded(g);
}

/* The stack, read as a sequence of units: a loose block, or a whole group and
   its run of members. Everything that reorders or renders the stack goes
   through this rather than walking p.blocks directly. */
export function stackUnits(p) {
  const units = [];
  for (let i = 0; i < p.blocks.length; ) {
    const b = p.blocks[i];
    const g = b.groupId ? p.groups.find((x) => x.id === b.groupId) : null;
    if (!g) { units.push({ kind: "block", block: b }); i++; continue; }
    const blocks = [];
    while (i < p.blocks.length && p.blocks[i].groupId === g.id) blocks.push(p.blocks[i++]);
    units.push({ kind: "group", group: g, blocks });
  }
  return units;
}

/* Switching to an arrangement replays it onto the members. A member the
   arrangement has never heard of is off — the same rule takes use for blocks
   that postdate them, so "added since" behaves identically at both levels. */
export function applyArrangement(g) {
  const a = activeArrangement(g);
  if (!a) return;
  membersOf(g).forEach((b) => {
    const want = a.picks[b.id];
    if (want && want.v) {
      const variant = b.variants.find((v) => v.id === want.v);
      if (variant) {
        b.activeVariantId = variant.id;
        /* ver null means the arrangement predates versions and has no opinion,
           so the variant keeps whichever version it is already showing. */
        if (want.ver && versionIdIsValid(variant, want.ver)) {
          variant.activeVersionId = want.ver;
        }
      }
    }
    b.enabled = Object.prototype.hasOwnProperty.call(a.picks, b.id) && !a.off.includes(b.id);
  });
}

/* …and the reverse: whatever the members are doing now *is* what the active
   arrangement means. Block variants work this way — typing edits the active
   variant rather than drifting away from it — and arrangements match, so
   there is never a stale "modified" state to reconcile.

   Called from touch(), so no mutation can forget to do it. Writes only on a
   real change, so an ordinary keystroke does not churn timestamps. */
export function syncActiveArrangements(p) {
  p.groups.forEach((g) => {
    const a = activeArrangement(g);
    if (!a) return;
    const picks = {};
    const off = [];
    membersOf(g).forEach((b) => {
      const variant = activeVariant(b);
      picks[b.id] = { v: b.activeVariantId, ver: variant ? variant.activeVersionId : null };
      if (!b.enabled) off.push(b.id);
    });
    const same = JSON.stringify(a.picks) === JSON.stringify(picks) &&
                 JSON.stringify(a.off) === JSON.stringify(off);
    if (same) return;
    a.picks = picks; a.off = off; a.updatedAt = now();
  });
}

export function touch() {
  const p = project();
  /* Any mutation can change what a condition sees, and the cache is only good
     for as long as nothing has moved. */
  invalidateDeps();
  syncActiveArrangements(p);
  p.updatedAt = now();
  save();
}

