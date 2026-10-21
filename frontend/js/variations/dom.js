/* Variations: small DOM helpers
   Lookup inside #variations, element building, icons, messages and the dialog. */

// -- imports (generated) --
// -- end imports --

/* Everything Variations draws lives inside #variations, so lookups start there
   and can never land on a gallery node that happens to share a selector. */
export const ROOT = document.getElementById("variations");

export const $  = (sel, root) => (root || ROOT).querySelector(sel);
export const $$ = (sel, root) => Array.from((root || ROOT).querySelectorAll(sel));

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Messages go through the gallery's own status bubble, so they look like every
   other message in the app and follow Experimental -> System notifications.
   Forced: these were always shown, and none of them has a per-source switch. */
export function toast(msg) {
  if (typeof showStatusMessage === "function") {
    showStatusMessage(String(msg || ""), "", { force: true });
  }
}

export function el(tag, attrs, children) {
  const n = document.createElement(tag);
  for (const k in (attrs || {})) {
    const val = attrs[k];
    if (val === null || val === undefined || val === false) continue;
    if (k === "class") n.className = val;
    else if (k === "text") n.textContent = val;
    else if (k === "html") n.innerHTML = val;
    else if (k === "icon") n.insertAdjacentHTML("afterbegin", icon(val));
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), val);
    else n.setAttribute(k, val === true ? "" : val);
  }
  for (const c of (children || [])) if (c) n.appendChild(c);
  return n;
}

/* Lucide outlines, the icon family the gallery's menus use. Only what the
   composer's buttons need; the gallery's own APP_ICON_SVGS is not reached
   into, so renaming one of its keys can never blank a button here. */
export const ICON_PATHS = {
  up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  fork: '<circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9"/><path d="M12 12v3"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  panelLeft: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
  panelRight: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>',
  shuffle: '<path d="m18 14 4 4-4 4"/><path d="m18 2 4 4-4 4"/><path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-7.6a4 4 0 0 1 3.3-1.7H22"/><path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/><path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  clipboard: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
};

export function icon(name) {
  const d = ICON_PATHS[name];
  if (!d) return "";
  return '<svg class="vx-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    d + "</svg>";
}

/* A small square button carrying only an icon; the title says what it does. */
export function iconBtn(name, title, onclick, extra) {
  const b = el("button", Object.assign({ class: "btn ghost tiny iconbtn", title, "aria-label": title, onclick }, extra || {}));
  b.innerHTML = icon(name);
  return b;
}

/* Modal dialogs — one place, so nothing calls window.prompt/confirm. */
export const dialogOpen = () => $("#vxScrim").classList.contains("show");

export function showDialog() { $("#vxScrim").classList.add("show"); }

export function closeDialog() {
  $("#vxScrim").classList.remove("show");
  $("#vxDlgBody").innerHTML = "";
  $("#vxDlgFoot").innerHTML = "";
}

export function askText(title, labelText, initial, onOk) {
  $("#vxDlgTitle").textContent = title;
  const input = el("input", { type: "text", class: "dlginput", value: initial || "" });
  $("#vxDlgBody").innerHTML = "";
  $("#vxDlgBody").append(el("h3", { text: labelText }), input);
  $("#vxDlgFoot").innerHTML = "";
  const ok = el("button", { class: "btn primary", text: "OK", onclick: () => { const v = input.value.trim(); closeDialog(); if (v) onOk(v); } });
  $("#vxDlgFoot").append(el("button", { class: "btn", text: "Cancel", onclick: closeDialog }), ok);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ok.click(); } });
  showDialog();
  setTimeout(() => { input.focus(); input.select(); }, 10);
}

export function askConfirm(title, message, okLabel, onOk) {
  $("#vxDlgTitle").textContent = title;
  $("#vxDlgBody").innerHTML = "";
  $("#vxDlgBody").append(el("h3", { text: message }));
  $("#vxDlgFoot").innerHTML = "";
  const ok = el("button", { class: "btn primary", text: okLabel || "Delete", onclick: () => { closeDialog(); onOk(); } });
  $("#vxDlgFoot").append(el("button", { class: "btn", text: "Cancel", onclick: closeDialog }), ok);
  showDialog();
  setTimeout(() => ok.focus(), 10);
}
