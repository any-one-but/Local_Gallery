/* Variations: opening, closing and wiring
   The entry module: the one door the gallery uses (window.LGVariations), clicks, the clock. */

// -- imports (generated) --
import { copyText, exportJson, importJson, newProject, saveTake } from "./actions.js";
import { $, ROOT, closeDialog } from "./dom.js";
import { cancelChipDrag, cancelDrag } from "./drag.js";
import { showHelp } from "./help.js";
import { clearSearch, focusSearch, handleKey } from "./keys.js";
import { renderAll } from "./output.js";
import { assemble } from "./prompt.js";
import { newBank } from "./rail.js";
import { growEditors, setSearchQuery } from "./stack.js";
import { HOST, ensureState, flushSave, load, save, state, ui } from "./store.js";
// -- end imports --

/* ============================================================
   11. Opening and closing
   ------------------------------------------------------------
   Variations is part of the gallery page: #variations in
   index.html, drawn over the whole window while it is open. The
   gallery reaches it through window.LGVariations, which its
   toggleVariationsWindow action (Cmd+U by default) calls, and the
   main process calls when the key is pressed from inside Grok or
   Claude, or when the Window menu's Close item is used.

   The document is read the first time it is opened, not at app
   start, so a gallery session that never opens Variations never
   touches its file.
   ============================================================ */

export let open = false;
export let loaded = null;          // the first load, once started
export let returnFocus = null;     // what had the gallery's focus before opening
export let clockTimer = null;

export const isOpen = () => open;

export async function openVariations() {
  if (open) return true;
  open = true;
  returnFocus = document.activeElement && document.activeElement !== document.body
    ? document.activeElement : null;
  if (returnFocus && typeof returnFocus.blur === "function") returnFocus.blur();
  document.documentElement.classList.add("lgVariationsOpen");
  ROOT.classList.add("open");
  ROOT.setAttribute("aria-hidden", "false");
  if (!loaded) {
    loaded = load().catch((e) => {
      console.error("Variations failed to load:", e);
    });
  }
  await loaded;
  ensureState();
  if (!open) return false;  // closed again while the file was being read
  applyHostChrome();
  $("#vxSearchInput").value = ui.searchQuery || "";
  renderAll();
  tickClock();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 20000);
  /* Keys land inside Variations rather than on whatever the gallery had. */
  ROOT.focus({ preventScroll: true });
  return true;
}

export function closeVariations() {
  if (!open) return false;
  open = false;
  cancelDrag();
  cancelChipDrag();
  closeDialog();
  flushSave();
  clearInterval(clockTimer);
  clockTimer = null;
  ROOT.classList.remove("open");
  ROOT.setAttribute("aria-hidden", "true");
  document.documentElement.classList.remove("lgVariationsOpen");
  const back = returnFocus;
  returnFocus = null;
  if (back && back.isConnected && typeof back.focus === "function") {
    try { back.focus({ preventScroll: true }); } catch (e) { /* gone */ }
  } else if (document.activeElement && ROOT.contains(document.activeElement)) {
    document.activeElement.blur();
  }
  return true;
}

export function toggleVariations() {
  if (open) { closeVariations(); return false; }
  openVariations();
  return true;
}

window.LGVariations = Object.freeze({
  open: openVariations,
  close: closeVariations,
  toggle: toggleVariations,
  isOpen,
  /* For the console and test scripts. */
  get state() { return state; },
  get host() { return HOST; },
  assemble,
});

/* ============================================================
   12. Wiring
   ============================================================ */

window.addEventListener("keydown", handleKey, true);

ROOT.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-cmd]");
  if (!btn) return;
  const cmd = btn.getAttribute("data-cmd");
  if (cmd === "new-project") newProject();
  else if (cmd === "toggle-rail") { ui.railOpen = !ui.railOpen; save(); renderAll(); }
  else if (cmd === "toggle-output") { ui.outputOpen = !ui.outputOpen; save(); renderAll(); }
  else if (cmd === "import") $("#vxFileInput").click();
  else if (cmd === "export") exportJson();
  else if (cmd === "help") showHelp();
  else if (cmd === "copy") copyText(assemble(), "Prompt copied");
  else if (cmd === "save-take") saveTake();
  else if (cmd === "new-bank") newBank();
  else if (cmd === "close-window") closeVariations();
});

/* A click on the frosted surround, not the panel, dismisses a dialog. */
$("#vxScrim").addEventListener("mousedown", (e) => { if (e.target.id === "vxScrim") closeDialog(); });

$("#vxSearchInput").addEventListener("input", (e) => setSearchQuery(e.target.value));
$("#vxSearchClear").addEventListener("click", () => { clearSearch(true); focusSearch(); });

$("#vxFileInput").addEventListener("change", (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) importJson(f);
  e.target.value = "";
});

/* A click on empty space would otherwise hand focus back to the gallery's
   body, and the next key would go nowhere useful. */
ROOT.addEventListener("mousedown", (e) => {
  if (e.target === ROOT || e.target.classList.contains("shell")) {
    setTimeout(() => { if (open && document.activeElement === document.body) ROOT.focus({ preventScroll: true }); }, 0);
  }
});

export function tickClock() {
  const d = new Date();
  let h = d.getHours(); const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  $("#vxClock").textContent = h + ":" + String(d.getMinutes()).padStart(2, "0") + " " + ampm;
}

window.addEventListener("resize", () => {
  if (open) growEditors($("#vxStackBody"));
});

/* The top bar says where the document is going when it is not the library's
   own file -- silently saving somewhere else would be worse. */
export function applyHostChrome() {
  const note = $("#vxHostNote");
  note.textContent = HOST.note || "";
  note.title = HOST.note || "";
  note.hidden = !HOST.note;
}
