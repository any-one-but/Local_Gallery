/* Variations: dependencies
   The Depends on dialog, condition wording, and the group picker. */

// -- imports (generated) --
import { newGroupFrom, setBlockGroup } from "./actions.js";
import { $, closeDialog, el, esc, icon, showDialog, toast } from "./dom.js";
import { renderOutput } from "./output.js";
import { renderStack } from "./stack.js";
import { activeVariant, activeVersion, groupOf, makeCondition, membersOf, project, touch } from "./store.js";
// -- end imports --

/* ---------- The dependency editor ---------- */

/* One line of English per condition, used for the badges, the tooltips and the
   list in the dialog, so the same sentence describes a condition everywhere. */
export function conditionText(c) {
  const p = project();
  if (c.sourceType === "group") {
    const g = p.groups.find((x) => x.id === c.sourceId);
    if (!g) return "an unknown group (so this passes)";
    const names = c.require.arrangementIds
      .map((id) => { const a = g.variants.find((x) => x.id === id); return a ? a.name : "a deleted arrangement"; });
    const bits = [];
    if (names.length) bits.push("is on " + names.map((n) => "“" + n + "”").join(" or "));
    if (typeof c.require.enabled === "boolean") bits.push(c.require.enabled ? "is included" : "is muted");
    return "group “" + g.label + "” " + (bits.length ? bits.join(" and ") : "exists");
  }
  const b = p.blocks.find((x) => x.id === c.sourceId);
  if (!b) return "an unknown block (so this passes)";
  const names = [];
  c.require.variantIds.forEach((id) => {
    const v = b.variants.find((x) => x.id === id);
    names.push(v ? "“" + v.name + "”" : "a deleted variant");
  });
  c.require.versionIds.forEach((id) => {
    let found = null, owner = null;
    b.variants.forEach((v) => v.versions.forEach((s) => { if (s.id === id) { found = s; owner = v; } }));
    names.push(found ? "“" + owner.name + " / " + found.name + "”" : "a deleted version");
  });
  const bits = [];
  if (names.length) bits.push("is showing " + names.join(" or "));
  if (typeof c.require.enabled === "boolean") bits.push(c.require.enabled ? "is included" : "is muted");
  return "“" + b.label + "” " + (bits.length ? bits.join(" and ") : "exists");
}

export function depReasonText(item) {
  if (!item || !item.conditions || !item.conditions.length) return "";
  return item.conditions.map((c) => "Held off unless " + conditionText(c)).join(" · ");
}

export const depItemName = (scope) =>
  scope.kind === "group" ? "Group “" + scope.group.label + "”"
  : scope.kind === "block" ? "Block “" + scope.block.label + "”"
  : scope.kind === "variant" ? "Variant “" + scope.variant.name + "”"
  : "Version “" + scope.version.name + "” of “" + scope.variant.name + "”";

export const depItemOf = (scope) =>
  scope.kind === "group" ? scope.group
  : scope.kind === "block" ? scope.block
  : scope.kind === "variant" ? scope.variant
  : scope.version;

/* Blocks, variants and versions share one dialog with a scope switch at the
   top, rather than three entry points that would each need finding. A group
   has only itself to talk about, so its dialog opens with no switch. */
export function openDependsDialog(target) {
  const p = project();
  const isGroup = target.kind === "group";
  const b = target.block || null;
  let scope = isGroup ? { kind: "group", group: target.group } : { kind: target.kind || "block", block: b };
  if (!isGroup) {
    scope.variant = activeVariant(b);
    scope.version = activeVersion(scope.variant);
    if (!scope.version && scope.kind === "version") scope.kind = "variant";
  }
  let editing = null;   // the condition being added or changed, or null

  const draw = () => {
    const item = depItemOf(scope);
    $("#vxDlgTitle").textContent = "Depends on";
    $("#vxDlgBody").innerHTML = "";
    $("#vxDlgBody").append(el("h3", { text: depItemName(scope) }));

    if (!isGroup) {
      const pick = el("div", { class: "depscope" });
      /* A variant showing Null has no version to speak for, so that tab is not
         offered — there is nothing there to hang a condition on. */
      const tabs = [["block", "Block"], ["variant", "Variant “" + scope.variant.name + "”"]];
      if (scope.version) tabs.push(["version", "Version “" + scope.version.name + "”"]);
      tabs.forEach(([kind, label]) => {
        const n = (depItemOf(Object.assign({}, scope, { kind })).conditions || []).length;
        pick.appendChild(el("button", {
          class: "btn tiny" + (scope.kind === kind ? " primary" : ""),
          text: label + (n ? " (" + n + ")" : ""),
          onclick: () => { scope.kind = kind; editing = null; draw(); },
        }));
      });
      $("#vxDlgBody").append(pick);
    }

    $("#vxDlgBody").append(el("p", {
      class: "dephint",
      text: "While a condition fails, this item is held off: it stays where it is, struck through with its " +
            "Null slot locked, and takes no part in the prompt. It is never taken out of the stack — content " +
            "you cannot see is content you cannot bring back. Nothing is rewritten either: its variant, " +
            "version and slot are all waiting where you left them. A condition that names something you " +
            "have since deleted is thrown away rather than left to fail forever.",
    }));

    if (!item.conditions.length) {
      $("#vxDlgBody").append(el("div", { class: "emptynote", text: "No conditions — this item is always available." }));
    }
    item.conditions.forEach((c) => {
      $("#vxDlgBody").append(el("div", { class: "depcond" }, [
        el("span", { class: "txt", html: "<b>Held off</b> unless " + esc(conditionText(c)) }),
        el("button", { class: "btn ghost tiny", text: "Edit", onclick: () => { editing = c; draw(); } }),
        el("button", {
          class: "btn ghost tiny iconbtn", html: icon("x"), title: "Remove this condition",
          onclick: () => {
            item.conditions = item.conditions.filter((x) => x.id !== c.id);
            if (editing && editing.id === c.id) editing = null;
            touch(); renderStack(); renderOutput(); draw();
          },
        }),
      ]));
    });

    if (editing) $("#vxDlgBody").append(drawConditionForm(item));
    else {
      $("#vxDlgBody").append(el("button", {
        class: "btn tiny", text: "+ Add a condition",
        onclick: () => {
          const first = p.blocks.find((x) => x.id !== (b && b.id)) || p.blocks[0];
          if (!first) { toast("Nothing to depend on yet"); return; }
          editing = makeCondition("block", first.id);
          editing.__isNew = true;
          draw();
        },
      }));
    }

    $("#vxDlgFoot").innerHTML = "";
    $("#vxDlgFoot").append(el("button", { class: "btn primary", text: "Done", onclick: closeDialog }));
    showDialog();
  };

  const drawConditionForm = (item) => {
    const form = el("div", { class: "depform" });
    const sources = []
      .concat(p.blocks.filter((x) => !b || x.id !== b.id).map((x) => ({ type: "block", id: x.id, label: x.label })))
      .concat((p.groups || []).filter((g) => !(isGroup && g.id === target.group.id))
        .map((g) => ({ type: "group", id: g.id, label: "Group: " + g.label })));

    const srcSelect = el("select", {});
    sources.forEach((s) => srcSelect.appendChild(el("option", { value: s.type + ":" + s.id, text: s.label })));
    srcSelect.value = editing.sourceType + ":" + editing.sourceId;
    if (!srcSelect.value && sources.length) {
      editing.sourceType = sources[0].type; editing.sourceId = sources[0].id;
      srcSelect.value = sources[0].type + ":" + sources[0].id;
    }
    srcSelect.addEventListener("change", () => {
      const [type, id] = srcSelect.value.split(":");
      editing.sourceType = type; editing.sourceId = id;
      editing.require = { variantIds: [], versionIds: [], arrangementIds: [], enabled: editing.require.enabled };
      draw();
    });

    const states = el("div", { class: "depstates" });
    if (editing.sourceType === "group") {
      const g = (p.groups || []).find((x) => x.id === editing.sourceId);
      (g ? g.variants : []).forEach((a) => {
        const cb = el("input", { type: "checkbox", checked: editing.require.arrangementIds.includes(a.id) });
        cb.addEventListener("change", () => {
          editing.require.arrangementIds = cb.checked
            ? editing.require.arrangementIds.concat([a.id])
            : editing.require.arrangementIds.filter((x) => x !== a.id);
        });
        states.appendChild(el("label", { class: "sv" }, [cb, el("span", { text: a.name })]));
      });
    } else {
      const src = p.blocks.find((x) => x.id === editing.sourceId);
      (src ? src.variants : []).forEach((v) => {
        const cb = el("input", { type: "checkbox", checked: editing.require.variantIds.includes(v.id) });
        cb.addEventListener("change", () => {
          editing.require.variantIds = cb.checked
            ? editing.require.variantIds.concat([v.id])
            : editing.require.variantIds.filter((x) => x !== v.id);
        });
        states.appendChild(el("label", { class: "sv" }, [cb, el("span", { text: v.name })]));
        if (v.versions.length < 2) return;
        v.versions.forEach((s) => {
          const scb = el("input", { type: "checkbox", checked: editing.require.versionIds.includes(s.id) });
          scb.addEventListener("change", () => {
            editing.require.versionIds = scb.checked
              ? editing.require.versionIds.concat([s.id])
              : editing.require.versionIds.filter((x) => x !== s.id);
          });
          states.appendChild(el("label", { class: "ss" }, [scb, el("span", { text: s.name })]));
        });
      });
    }
    if (!states.children.length) states.appendChild(el("div", { class: "emptynote", text: "Nothing to pick." }));

    const onSelect = el("select", {});
    [["", "no constraint"], ["on", "must be included"], ["off", "must be muted"]].forEach(([v, t]) =>
      onSelect.appendChild(el("option", { value: v, text: t })));
    onSelect.value = editing.require.enabled === true ? "on" : editing.require.enabled === false ? "off" : "";
    onSelect.addEventListener("change", () => {
      editing.require.enabled = onSelect.value === "on" ? true : onSelect.value === "off" ? false : null;
    });

    /* There is no effect to choose: a condition that fails holds its item off,
       and that is the only thing it can do. */
    form.append(
      el("label", { class: "line" }, [el("span", { text: "Depends on" }), srcSelect]),
      el("label", { class: "line" }, [el("span", { text: "In any of" })]),
      states,
      el("div", { style: "height:8px" }),
      el("label", { class: "line" }, [el("span", { text: "And it" }), onSelect]),
      el("div", {}, [
        el("button", { class: "btn tiny", text: "Cancel", onclick: () => { editing = null; draw(); } }),
        el("button", {
          class: "btn tiny primary", text: "Save condition",
          onclick: () => {
            const c = editing;
            const empty = !c.require.variantIds.length && !c.require.versionIds.length &&
                          !c.require.arrangementIds.length && typeof c.require.enabled !== "boolean";
            if (empty) { toast("Pick a state, or the condition asks for nothing"); return; }
            delete c.__isNew;
            if (!item.conditions.some((x) => x.id === c.id)) item.conditions.push(c);
            editing = null;
            touch(); renderStack(); renderOutput(); draw();
          },
        }),
      ]),
    );
    return form;
  };

  draw();
}

/* The keyboard's way into the grouping the block foot's picker offers. */
export function blockGroupMenu(b) {
  const p = project();
  const current = groupOf(b);
  $("#vxDlgTitle").textContent = "Group";
  $("#vxDlgBody").innerHTML = "";
  $("#vxDlgBody").append(
    el("h3", { text: b.label }),
    el("p", { text: current ? "In “" + current.label + "”. Blocks in a group switch on and off together, and the group's arrangements remember which variant each of them shows."
                            : "Not in a group. Wire it into one to switch it with its neighbours." }));
  const list = el("div", { class: "rowlist" });
  p.groups.forEach((g) => {
    if (g.id === b.groupId) return;
    list.appendChild(el("div", {
      class: "row", onclick: () => { closeDialog(); setBlockGroup(b.id, g.id); },
    }, [
      el("span", { class: "name", text: g.label }),
      el("span", { class: "sub", text: membersOf(g).length + " blocks · " + g.variants.length + " arr" }),
    ]));
  });
  if (list.children.length) $("#vxDlgBody").append(el("h4", { text: "Move into" }), list);
  $("#vxDlgFoot").innerHTML = "";
  /* ParentNode.append() would stringify a null, so the optional button is
     filtered out rather than passed through as one. */
  $("#vxDlgFoot").append(...[
    el("button", { class: "btn", text: "Cancel", onclick: closeDialog }),
    current ? el("button", { class: "btn", text: "Leave group", onclick: () => { closeDialog(); setBlockGroup(b.id, null); } }) : null,
    el("button", { class: "btn primary", text: "New group…", onclick: () => { closeDialog(); newGroupFrom(b.id); } }),
  ].filter(Boolean));
  showDialog();
}

