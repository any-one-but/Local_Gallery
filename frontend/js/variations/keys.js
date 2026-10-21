/* Variations: the keyboard
   Every key Variations answers to while it is open. */

// -- imports (generated) --
import { addVariant, copyText, cycleArrangement, cycleVariant, cycleVersion, exportJson, pickVariant, pickVariantByIndex, saveTake, setBlockNull, setFocusBlock, setView, toggleAllBlocksCollapsed, toggleBlockCollapsed, toggleGroup } from "./actions.js";
import { blockGroupMenu, openDependsDialog } from "./depends.js";
import { $, closeDialog, dialogOpen, toast } from "./dom.js";
import { chipDrag, dragState } from "./drag.js";
import { showHelp } from "./help.js";
import { closeVariations, isOpen } from "./main.js";
import { assemble } from "./prompt.js";
import { renderStack, visibleBlocks } from "./stack.js";
import { groupOf, project, ui } from "./store.js";
// -- end imports --

/* ============================================================
   9. Keyboard
   ============================================================ */

export function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function focusedBlock() {
  const p = project();
  return p.blocks.find((b) => b.id === ui.focusBlockId) || visibleBlocks()[0] || p.blocks[0] || null;
}

/* The cursor walks what is drawn. With a filter up that is the matches; with a
   dependency holding something back it is what is left — in both cases the
   keys move between the cards you can actually see. */
export function moveFocus(dir) {
  const list = visibleBlocks();
  if (!list.length) return;
  const i = list.findIndex((b) => b.id === ui.focusBlockId);
  if (i < 0) { setFocusBlock(list[0].id, true); return; }
  const next = Math.max(0, Math.min(list.length - 1, i + dir));
  setFocusBlock(list[next].id, true);
}

/* ⌘F from anywhere. The field is in the top bar rather than the stack, so it
   is there to be typed into whatever the stack is scrolled to. */
export function focusSearch() {
  const input = $("#vxSearchInput");
  if (!input) return;
  input.focus();
  input.select();
}

export function clearSearch(refocus) {
  const input = $("#vxSearchInput");
  if (input) { input.value = ""; if (refocus === false) input.blur(); }
  if (!ui.searchQuery) return;
  ui.searchQuery = "";
  renderStack();
  const list = visibleBlocks();
  if (list.length && !list.some((b) => b.id === ui.focusBlockId)) setFocusBlock(list[0].id, true);
}

/* Base key of an event, read off e.code where it can be so a binding set on
   one keyboard layout still matches on another. */
export function baseKeyForEvent(e) {
  const code = e.code || "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "Space") return "Space";
  if (code === "Escape") return "Escape";
  const key = e.key || "";
  return key.length === 1 ? key.toLowerCase() : key;
}

/* The gallery's own action for this key, through its own binding table, so
   whatever the Variations / Grok / Claude keys are set to in Controls is what
   is honoured here -- nothing has to be forwarded or kept in step. */
export function galleryActionFor(e) {
  try {
    const key = keybindValueFromEvent(e);
    return key ? keybindActionFor(key) : null;
  } catch (err) {
    return null;
  }
}

/* Grok and Claude are still windows of their own, laid over the whole app.
   Opening one closes Variations first, as switching between the three always
   has. */
export const SWITCH_ACTIONS = {
  toggleGrokWindow: () => toggleGrokWindowKeybindAction(),
  toggleClaudeWindow: () => toggleClaudeWindowKeybindAction(),
};

/* Shift+Cmd+W closes whichever of the overlays is up, whatever state it is in. */
export const isEscapeHatch = (e) =>
  e.metaKey && e.shiftKey && !e.altKey && !e.ctrlKey && baseKeyForEvent(e) === "w";

/* ------------------------------------------------------------
   Keyboard, and the one rule that governs it.

   While Variations is open it has the whole keyboard: the gallery's
   own key handling stands aside (variationsIsOpen() in its
   listeners). Every command here is either a bare key (no ⌘/⌃/⌥
   held) or one of the three ⌘ combos in matchesAppChord, plus the
   app-level keys above. A modified key nothing here claims is left
   alone, so ⌘C, ⌘V, ⌘Z and ⌘A do what they do in any text field.

   The failure the single modifier bail below exists to prevent: the
   bare-key switch used to run whatever the modifiers were, so ⌘1
   quietly picked a variant as well. A test per case is a thing you
   can forget to add; one bail is not.
   ------------------------------------------------------------ */

/* The only chords Variations claims. */
export function matchesAppChord(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return "";
  const k = baseKeyForEvent(e);
  if (k === "f" && !e.shiftKey) return "find";
  if (k === "c" && e.shiftKey) return "copy";
  if (k === "e" && e.shiftKey) return "export";
  return "";
}

/* Registered by main.js on window, capture phase: it runs before the
   gallery's own document listener, and before any field's own listener.
   Does nothing while Variations is closed -- which is also why the key that
   opens it is not seen here as the key that closes it. */
export function handleKey(e) {
  if (!isOpen()) return;
  /* A drag in progress answers Escape itself (drag.js). */
  if (dragState || chipDrag) return;
  /* The lock screen, if it comes up, owns the keyboard ahead of everything. */
  if (typeof lockScreenIsOpen === "function" && lockScreenIsOpen()) return;

  // Before anything else, so the toggle always gets you back out.
  /* A bare key typed into a field is text, even if Controls has bound it to
     one of the three windows. */
  const bareTyping = isTyping(e) && !e.metaKey && !e.ctrlKey && !e.altKey;
  const action = bareTyping ? null : galleryActionFor(e);
  if (action === "toggleVariationsWindow" || isEscapeHatch(e)) {
    e.preventDefault(); e.stopPropagation();
    closeVariations();
    return;
  }

  /* Then the other two windows' toggles. These are ⌘ combos by default, so
     they come before the bare-key bail below. */
  if (SWITCH_ACTIONS[action]) {
    e.preventDefault(); e.stopPropagation();
    closeVariations();
    SWITCH_ACTIONS[action]();
    return;
  }

  /* Escape unmodified only. ⌘⎋ and friends belong to the OS. */
  if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (dialogOpen()) { closeDialog(); e.preventDefault(); return; }
    /* In the filter field Escape means "give me the stack back", not "leave
       the field with the stack still cut down to a dozen rows". */
    if (e.target && e.target.id === "vxSearchInput") {
      e.preventDefault();
      if (ui.searchQuery) clearSearch(false); else e.target.blur();
      return;
    }
    if (isTyping(e)) { e.target.blur(); e.preventDefault(); return; }
    // Nothing left to back out of, so Esc closes Variations. Stopped here, or
    // the gallery would take the same Escape as its own back key.
    e.preventDefault(); e.stopPropagation();
    closeVariations();
    return;
  }

  /* The three claimed chords. These work from anywhere, typing included. */
  const chord = matchesAppChord(e);
  if (chord === "copy") { e.preventDefault(); copyText(assemble(), "Prompt copied"); return; }
  if (chord === "export") { e.preventDefault(); exportJson(); return; }
  if (chord === "find" && !dialogOpen()) { e.preventDefault(); focusSearch(); return; }

  /* Everything past this point is a bare key. Anything holding a modifier
     belongs to the text field or the OS, and is left untouched. */
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (isTyping(e) || dialogOpen()) return;

  const b = focusedBlock();

  switch (e.key) {
    case "j": case "ArrowDown": e.preventDefault(); moveFocus(1); return;
    case "k": case "ArrowUp":   e.preventDefault(); moveFocus(-1); return;
    case "h": case "ArrowLeft": if (b) { e.preventDefault(); cycleVariant(b.id, -1); } return;
    case "l": case "ArrowRight":if (b) { e.preventDefault(); cycleVariant(b.id, 1); } return;
    /* Space flips between Null and whatever the block was last showing. */
    case " ": if (b) { e.preventDefault(); if (b.enabled) setBlockNull(b.id); else pickVariant(b.id, b.activeVariantId); } return;
    /* 0 is the Null chip's own number, so the digits read straight off the row. */
    case "0": if (b) { e.preventDefault(); setBlockNull(b.id); } return;
    case "m": e.preventDefault(); setView(ui.view === "mixer" ? "edit" : "mixer"); return;
    case "g": if (b) { e.preventDefault(); blockGroupMenu(b); } return;
    case "G": if (b) { e.preventDefault(); const g = groupOf(b); if (g) toggleGroup(g.id); else toast("“" + b.label + "” is not in a group"); } return;
    /* Versions sit one level below variants, so they get the keys next to the
       ones that cycle variants. */
    case ",": if (b) { e.preventDefault(); cycleVersion(b.id, -1); } return;
    case ".": if (b) { e.preventDefault(); cycleVersion(b.id, 1); } return;
    case "[": case "]": {
      if (!b) return;
      e.preventDefault();
      const g = groupOf(b);
      if (!g) { toast("“" + b.label + "” is not in a group"); return; }
      cycleArrangement(g.id, e.key === "[" ? -1 : 1);
      return;
    }
    case "d": if (b) { e.preventDefault(); openDependsDialog({ kind: "block", block: b }); } return;
    case "n": if (b) { e.preventDefault(); addVariant(b.id, false); } return;
    case "f": if (b) { e.preventDefault(); addVariant(b.id, true); } return;
    case "s": e.preventDefault(); saveTake(); return;
    /* Fold this block; shifted, fold the whole stack down to its headings. */
    case "z": if (b) { e.preventDefault(); toggleBlockCollapsed(b.id); } return;
    case "Z": e.preventDefault(); toggleAllBlocksCollapsed(); return;
    /* The output is what Variations is for, so it gets a bare key as well as
       the chord. */
    case "c": e.preventDefault(); copyText(assemble(), "Prompt copied"); return;
    case "?": e.preventDefault(); showHelp(); return;
    case "e": {
      if (!b) return;
      e.preventDefault();
      if (ui.view !== "edit") { setView("edit"); }
      /* Asking to edit a folded block is asking to unfold it — otherwise the
         key appears to do nothing, the editor being the thing that is hidden.
         This re-renders, so the textarea is looked up afterwards. */
      if (b.collapsed) toggleBlockCollapsed(b.id, false);
      const ta = $('#vxStackBody .block[data-block="' + b.id + '"] .editor');
      if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      return;
    }
  }

  if (/^[1-9]$/.test(e.key) && b) { e.preventDefault(); pickVariantByIndex(b.id, Number(e.key) - 1); }
}

