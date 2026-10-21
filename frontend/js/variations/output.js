/* Variations: the Assembled pane
   The prompt as drawn, hover lighting both ways, and renderAll. */

// -- imports (generated) --
import { $, ROOT, el } from "./dom.js";
import { GROUP_JOIN, assemble, countWords, promptUnits } from "./prompt.js";
import { renderRail } from "./rail.js";
import { renderStack } from "./stack.js";
import { invalidateDeps, project, save, ui } from "./store.js";
// -- end imports --

/* ============================================================
   7. Rendering — assembled output
   ============================================================ */

export function renderOutput() {
  const host = $("#vxOutText");
  invalidateDeps();
  const units = promptUnits();
  host.innerHTML = "";
  if (!units.length) {
    host.appendChild(el("div", { class: "placeholder", text: "Nothing to assemble yet. Write into a block, or take one off Null." }));
    $("#vxOutStats").textContent = "";
    return;
  }
  units.forEach((u, i) => {
    /* One node per paragraph, and inside it one node per block, so a group's
       members read as continuous text while each still lights up on its own. */
    const para = el("span", { class: "seg", title: u.label }, []);
    if (u.kind === "group") para.setAttribute("data-group", u.id);
    if (u.heading) para.appendChild(el("span", { class: "segh", text: u.heading + "\n" }));
    u.parts.forEach((part, j) => {
      const piece = el("span", { class: "segpart", "data-block": part.blockId, title: part.label });
      /* One node per run, so a word that came from a bank is visibly a swap
         rather than something someone typed. */
      part.segs.forEach((sg) => {
        if (!sg.bankId) { piece.appendChild(document.createTextNode(sg.text)); return; }
        piece.appendChild(el("span", {
          class: "segbank", text: sg.text,
          title: sg.bankName + " → " + sg.text,
          "data-bank": sg.bankId,
        }));
      });
      piece.addEventListener("mouseenter", () => litBlock(part.blockId, true));
      piece.addEventListener("mouseleave", () => litBlock(part.blockId, false));
      para.appendChild(piece);
      if (j < u.parts.length - 1) para.appendChild(document.createTextNode(GROUP_JOIN));
    });
    if (i < units.length - 1) para.appendChild(document.createTextNode("\n\n"));
    host.appendChild(para);
  });
  const text = assemble();
  $("#vxOutStats").innerHTML =
    "<b>" + countWords(text) + "</b> words · <b>" + text.length + "</b> ch · ~<b>" +
    Math.ceil(text.length / 4) + "</b> tok";
}

/* Hovering a block lights its slice of the prompt, and the reverse. A group's
   head lights the whole paragraph its members were folded into. */
export function litSegment(blockId, on) {
  const n = $('#vxOutText [data-block="' + blockId + '"]');
  if (n) n.classList.toggle("lit", on);
}
export function litGroupSegment(groupId, on) {
  const n = $('#vxOutText .seg[data-group="' + groupId + '"]');
  if (n) n.classList.toggle("lit", on);
}
export function litBlock(blockId, on) {
  const n = $('#vxStackBody [data-block="' + blockId + '"]');
  if (n && n.classList.contains("block")) n.classList.toggle("lit", on);
}

export function renderAll() {
  ROOT.classList.toggle("rail-closed", !ui.railOpen);
  ROOT.classList.toggle("out-closed", !ui.outputOpen);
  const p = project();
  if (!p.blocks.some((b) => b.id === ui.focusBlockId)) ui.focusBlockId = p.blocks.length ? p.blocks[0].id : null;
  renderRail();
  renderStack();
  renderOutput();
  save();
}

