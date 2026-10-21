/* Variations: the Library rail
   Projects, word banks and takes, and their dialogs. */

// -- imports (generated) --
import { applyTake, currentSignature, deleteProject, duplicateProject, resolveTake, selectProject, takeSignature, updateTake } from "./actions.js";
import { $, askConfirm, askText, closeDialog, el, esc, icon, showDialog, toast } from "./dom.js";
import { renderAll, renderOutput } from "./output.js";
import { renderStack } from "./stack.js";
import { activeWord, bankNameFrom, invalidateDeps, makeBank, makeWord, project, stackUnits, state, stripNotes, touch } from "./store.js";
// -- end imports --

/* ============================================================
   5. Rendering — rail
   ============================================================ */

export function renderRail() {
  invalidateDeps();
  const list = $("#vxProjectList");
  list.innerHTML = "";
  for (const p of state.projects) {
    const isActive = p.id === state.activeProjectId;
    const row = el("div", { class: "row" + (isActive ? " active" : ""), onclick: () => selectProject(p.id) }, [
      el("span", { class: "name", text: p.name, title: p.name }),
      el("span", { class: "sub", text: p.blocks.length + "×" + p.blocks.reduce((n, b) => n + b.variants.length, 0) }),
      el("button", {
        class: "btn ghost tiny iconbtn rowact", html: icon("more"), title: "Rename, duplicate or delete",
        onclick: (e) => { e.stopPropagation(); projectMenu(p); },
      }),
    ]);
    list.appendChild(row);
  }

  const p = project();
  renderBankList(p);

  const takes = $("#vxTakeList");
  takes.innerHTML = "";
  const sig = currentSignature();
  if (!p.takes.length) {
    takes.appendChild(el("div", { class: "emptynote", text: "No takes yet. Snapshot a combination you like and jump back to it in one click." }));
  }
  for (const t of p.takes) {
    const isCurrent = takeSignature(t) === sig;
    const res = resolveTake(t, p);
    const on = p.blocks.filter((b) => {
      const g = b.groupId ? p.groups.find((x) => x.id === b.groupId) : null;
      return res.blocks[b.id].on && (!g || res.groups[g.id].on);
    }).length;
    const row = el("div", { class: "row take-row" + (isCurrent ? " current" : ""), onclick: () => applyTake(t.id) }, [
      el("span", { class: "pip" }),
      el("span", { class: "name", text: t.name, title: t.name }),
      el("span", { class: "sub", text: on + "/" + p.blocks.length, title: on + " of " + p.blocks.length + " blocks reach the prompt in this take" }),
      el("button", {
        class: "btn ghost tiny iconbtn rowact", html: icon("more"), title: "Update, rename or delete",
        onclick: (e) => { e.stopPropagation(); takeMenu(t); },
      }),
    ]);
    takes.appendChild(row);
  }
}

/* Word banks live in the rail because they are project-wide: one row per bank,
   showing the name exactly as you must type it and the word it currently
   resolves to. Clicking the row advances to the next word, which is the same
   cycle-button idiom the rest of the app uses. */
export function renderBankList(p) {
  const host = $("#vxBankList");
  host.innerHTML = "";
  const banks = p.banks || [];
  if (!banks.length) {
    host.appendChild(el("div", {
      class: "emptynote",
      text: "No word banks. A bank is a name like TONE that you write into any block; the prompt gets the word you picked.",
    }));
    return;
  }
  const usage = bankUsageCounts(p);
  banks.forEach((k) => {
    const w = activeWord(k);
    const uses = usage[k.id] || 0;
    const row = el("div", {
      class: "row bank-row", title: "Click to advance · " + k.name + " → " + ((w && w.text) || "(empty)") +
        " · used in " + uses + " version" + (uses === 1 ? "" : "s"),
      onclick: () => cycleBankWord(k.id, 1),
    }, [
      el("span", { class: "bankname", text: k.name }),
      el("span", { class: "bankword", text: (w && w.text.trim()) || "—" }),
      el("span", { class: "sub", text: k.words.length + (uses ? "" : " ·0") }),
      el("button", {
        class: "btn ghost tiny iconbtn rowact", html: icon("more"), title: "Edit words, rename or delete",
        onclick: (e) => { e.stopPropagation(); bankMenu(k); },
      }),
    ]);
    if (!uses) row.classList.add("bank-unused");
    host.appendChild(row);
  });
}

/* How many versions actually mention each bank. A bank nothing references is
   almost always a typo in the block text, so it is worth showing. */
export function bankUsageCounts(p) {
  const counts = {};
  (p.banks || []).forEach((k) => { counts[k.id] = 0; });
  const names = (p.banks || []).map((k) => k.name).filter(Boolean);
  if (!names.length) return counts;
  p.blocks.forEach((b) => b.variants.forEach((v) => v.versions.forEach((s) => {
    (p.banks || []).forEach((k) => {
      if (!k.name) return;
      const re = new RegExp("(^|[^A-Z0-9_])" + k.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Z0-9_])");
      /* Only mentions that can actually substitute count — a bank named inside
         a note is a bank nothing uses, and the strike-through should say so. */
      if (re.test(stripNotes(s.text))) counts[k.id]++;
    });
  })));
  return counts;
}

export function cycleBankWord(bankId, dir) {
  const p = project();
  const k = (p.banks || []).find((x) => x.id === bankId);
  if (!k || k.words.length < 2) return;
  const i = k.words.findIndex((w) => w.id === k.activeWordId);
  k.activeWordId = k.words[(i + dir + k.words.length) % k.words.length].id;
  touch(); renderStack(); renderOutput(); renderRail();
}

export function newBank() {
  askText("New word bank", "Name it — capitals and underscores, so it never turns up by accident", "TONE", (raw) => {
    const p = project();
    const name = bankNameFrom(raw);
    if (!name) { toast("That name has no letters or digits in it"); return; }
    if ((p.banks || []).some((k) => k.name === name)) { toast("“" + name + "” already exists"); return; }
    const k = makeBank(name, null);
    p.banks.push(k);
    touch(); renderAll();
    bankMenu(k);
  });
}

/* One dialog for the whole bank: its words, which is selected, and the
   destructive actions. Editing a word writes straight through, the way the
   block editor writes straight through to its version. */
export function bankMenu(k) {
  const p = project();
  const draw = () => {
    $("#vxDlgTitle").textContent = "Word bank";
    $("#vxDlgBody").innerHTML = "";
    $("#vxDlgBody").append(
      el("h3", { text: k.name }),
      el("p", { html: "Write <code>" + esc(k.name) + "</code> anywhere in a block and the prompt gets the selected word." }),
    );
    const list = el("div", { class: "rowlist" });
    k.words.forEach((w) => {
      const isOn = w.id === k.activeWordId;
      const input = el("input", { type: "text", class: "bankwordinput", value: w.text, placeholder: "a word or phrase" });
      input.addEventListener("input", () => { w.text = input.value; touch(); renderStack(); renderOutput(); renderRail(); });
      const row = el("div", { class: "row bankedit" + (isOn ? " active" : "") }, [
        el("button", {
          class: "pip pipbtn" + (isOn ? " on" : ""), title: isOn ? "Selected" : "Use this word",
          onclick: () => { k.activeWordId = w.id; touch(); renderStack(); renderOutput(); renderRail(); draw(); },
        }),
        input,
        el("button", {
          class: "btn ghost tiny iconbtn", html: icon("x"), title: "Remove this word", disabled: k.words.length < 2,
          onclick: () => {
            const i = k.words.indexOf(w);
            k.words.splice(i, 1);
            if (k.activeWordId === w.id) k.activeWordId = k.words[Math.max(0, i - 1)].id;
            p.takes.forEach((t) => { if (t.banks && t.banks[k.id] === w.id) delete t.banks[k.id]; });
            touch(); renderStack(); renderOutput(); renderRail(); draw();
          },
        }),
      ]);
      list.appendChild(row);
    });
    $("#vxDlgBody").append(list);
    $("#vxDlgBody").append(el("button", {
      class: "btn tiny", text: "+ Add a word",
      onclick: () => { const w = makeWord(""); k.words.push(w); k.activeWordId = w.id; touch(); renderRail(); draw(); },
    }));

    $("#vxDlgFoot").innerHTML = "";
    $("#vxDlgFoot").append(
      el("button", { class: "btn", text: "Close", onclick: closeDialog }),
      el("button", {
        class: "btn", text: "Rename",
        onclick: () => askText("Rename bank", "New name", k.name, (raw) => {
          const name = bankNameFrom(raw);
          if (!name) { toast("That name has no letters or digits in it"); return; }
          if (name !== k.name && (p.banks || []).some((x) => x.name === name)) { toast("“" + name + "” already exists"); return; }
          /* Renaming rewrites every mention, or the bank would silently stop
             resolving everywhere it was already used. */
          const old = k.name;
          const re = new RegExp("(^|[^A-Z0-9_])" + old.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![A-Z0-9_])", "g");
          let rewritten = 0;
          p.blocks.forEach((b) => b.variants.forEach((v) => v.versions.forEach((s) => {
            const next = s.text.replace(re, (m, pre) => pre + name);
            if (next !== s.text) { s.text = next; rewritten++; }
          })));
          k.name = name;
          touch(); renderAll();
          toast(rewritten ? "Renamed, and rewrote " + rewritten + " version" + (rewritten === 1 ? "" : "s") : "Renamed");
          draw();
        }),
      }),
      el("button", {
        class: "btn primary", text: "Delete",
        onclick: () => {
          closeDialog();
          askConfirm("Delete word bank", "Delete “" + k.name + "”? Blocks that mention it will show the bare name instead.", "Delete", () => {
            p.banks = p.banks.filter((x) => x.id !== k.id);
            p.takes.forEach((t) => { if (t.banks) delete t.banks[k.id]; });
            touch(); renderAll();
          });
        },
      }),
    );
    showDialog();
  };
  draw();
}

export function projectMenu(p) {
  $("#vxDlgTitle").textContent = "Project";
  $("#vxDlgBody").innerHTML = "";
  $("#vxDlgBody").append(el("h3", { text: p.name }),
    el("p", { text: p.blocks.length + " blocks · " + p.blocks.reduce((n, b) => n + b.variants.length, 0) + " variants · " +
      p.groups.length + " groups · " + p.groups.reduce((n, g) => n + g.variants.length, 0) + " arrangements · " +
      p.takes.length + " takes" }));
  $("#vxDlgFoot").innerHTML = "";
  $("#vxDlgFoot").append(
    el("button", { class: "btn", text: "Close", onclick: closeDialog }),
    el("button", { class: "btn", text: "Duplicate", onclick: () => { closeDialog(); duplicateProject(p.id); } }),
    el("button", { class: "btn", text: "Rename", onclick: () => { closeDialog(); askText("Rename", "Project name", p.name, (v) => { p.name = v; touch(); renderAll(); }); } }),
    el("button", {
      class: "btn primary", text: "Delete",
      onclick: () => { closeDialog(); askConfirm("Delete project", "Delete “" + p.name + "” and all its variants?", "Delete", () => deleteProject(p.id)); },
    }));
  showDialog();
}

export function takeMenu(t) {
  const p = project();
  const res = resolveTake(t, p);
  $("#vxDlgTitle").textContent = "Take";
  $("#vxDlgBody").innerHTML = "";

  /* Read out in stack order, so it matches what applying it will do —
     including the blocks and groups this take predates. */
  const lines = [];
  stackUnits(p).forEach((u) => {
    if (u.kind === "group") {
      const g = u.group, r = res.groups[g.id];
      const a = g.variants.find((x) => x.id === r.v);
      lines.push("<b>" + esc(g.label) + "</b> (group) → " +
        (r.on ? esc(a ? a.name : "—") : "off") + (r.known ? "" : " <i>· not yet made</i>"));
      u.blocks.forEach((b) => {
        const rb = res.blocks[b.id];
        const v = b.variants.find((x) => x.id === rb.v);
        lines.push("&nbsp;&nbsp;↳ " + esc(b.label) + " → " + (rb.on ? esc(v ? v.name : "—") : "off") +
          (rb.known ? "" : " <i>· added since, so off</i>"));
      });
      return;
    }
    const b = u.block, rb = res.blocks[b.id];
    const v = b.variants.find((x) => x.id === rb.v);
    lines.push(esc(b.label) + " → " + (rb.on ? esc(v ? v.name : "—") : "off") +
      (rb.known ? "" : " <i>· added since, so off</i>"));
  });
  $("#vxDlgBody").append(el("h3", { text: t.name }), el("p", { html: lines.join("<br>") }));
  $("#vxDlgFoot").innerHTML = "";
  $("#vxDlgFoot").append(
    el("button", { class: "btn", text: "Close", onclick: closeDialog }),
    el("button", { class: "btn", text: "Update to current", onclick: () => { closeDialog(); updateTake(t.id); } }),
    el("button", { class: "btn", text: "Rename", onclick: () => { closeDialog(); askText("Rename take", "Take name", t.name, (v) => { t.name = v; touch(); renderRail(); }); } }),
    el("button", {
      class: "btn primary", text: "Delete",
      onclick: () => { closeDialog(); p.takes = p.takes.filter((x) => x.id !== t.id); touch(); renderRail(); },
    }));
  showDialog();
}

