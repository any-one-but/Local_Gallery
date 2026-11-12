/* Hold [ for the controls list
   The read-only controls bubble. */

/* Hold [ -> the controls list (#keyHelpOverlay): a read-only bubble of every
   command -- bindable and built in, bound or not -- shown the moment [ goes down
   and gone the moment it comes up. Pressing ] while [ is held jumps to
   Settings -> Controls, which is where keys are changed. Matched on the
   physical key (BracketLeft / BracketRight) as well as the character, so Shift
   ({ and }) and other keyboard layouts behave the same. */
let KEY_HELP_HOLD = false;

// Grouped the way Controls is ordered. Ids that are menu-only (their keys do
// nothing) never reach the list; anything bindable that is not named here
// lands in "Other" rather than disappearing.
const KEY_HELP_GROUPS = Object.freeze([
  { title: "Moving around", ids: ["selectUp", "selectLeft", "selectDown", "selectRight", "leaveDir", "enterDir", "prevFolder", "nextFolder", "prevRootFolder", "nextRootFolder", "jumpToRoot", "toggleQuickNavigation", "grabReorderItem"] },
  { title: "Menus", ids: ["settingsMenu", "openAppMenu", "keyHelp"] },
  { title: "Selected item", ids: ["favoriteSelection", "hiddenSelection", "tagSelection", "renameSelection", "scoreUpSelection", "scoreDownSelection", "toggleSelectionInBulk", "selectRangeInBulk", "selectAllInLocation", "cancelMultiSelection"] },
  { title: "Viewing", ids: ["cycleFolderSort", "cycleFilter", "toggleShowHiddenFolder", "toggleUtilityContainers", "toggleFloatTags", "toggleFloatSpecialContainers", "cycleThumbnailSize", "cycleGlassDiffusion", "toggleShowFileNames", "toggleShowPositionNumbers", "toggleHideBeforeLastDash", "toggleHideFileExtensions", "cycleAppTheme", "cycleAppearancePresets", "toggleAnimatedFilters"] },
  { title: "Video", ids: ["playPause", "muteToggle", "seekBack", "seekForward", "cycleVideoSkipStep", "cycleVideoEndBehavior", "slideshow"] },
  { title: "Sound", ids: ["volumeUp", "volumeDown"] },
  { title: "Music", ids: ["musicPlayPause", "musicPrevious", "musicNext", "musicToggleShuffle", "musicToggleRepeat"] },
  { title: "App", ids: ["toggleMuteMessages", "refreshWorkspace", "toggleGrokWindow", "toggleClaudeWindow", "toggleVariationsWindow", "debugMode", "panic"] },
  // Last, as in Controls.
  { title: "Random", ids: RANDOM_CONTROL_IDS.slice() },
]);

// Hidden from Controls (so not in appMenuControlBindings) but live on a fixed key.
const KEY_HELP_ALWAYS_LISTED_IDS = new Set(["scoreUpSelection", "scoreDownSelection"]);

// Keys handled outside KEYBIND_ACTIONS altogether.
const KEY_HELP_BUILT_IN_ROWS = Object.freeze([
  { label: "Search the folder list", keys: ["/", "."] },
  { label: "Open Controls from this list", keys: ["[ + ]"] },
  { label: "Back / close", keys: ["Esc"] },
  { label: "Zoom thumbnail", keys: ["\u2318\u2191", "\u2318\u2193"] },
  { label: "Video thumbnail frame", keys: ["\u2318\u2190", "\u2318\u2192"] },
  { label: "Copy debug report", keys: ["\u2325`"] },
]);

function keyHelpEventIsHoldKey(e) {
  const key = String(e.key || "");
  return key === "[" || key === "{" || e.code === "BracketLeft";
}

function keyHelpEventIsControlsKey(e) {
  const key = String(e.key || "");
  return key === "]" || key === "}" || e.code === "BracketRight";
}

function keyHelpKeyHtml(text) {
  return `<kbd class="keyHelpKey">${escapeHtml(String(text || ""))}</kbd>`;
}

function keyHelpRowHtml(label, keys) {
  const list = (Array.isArray(keys) ? keys : []).filter(Boolean);
  return (
    `<div class="keyHelpRow${list.length ? "" : " keyHelpRowUnset"}">` +
    `<span class="keyHelpName">${escapeHtml(String(label || ""))}</span>` +
    `<span class="keyHelpKeys">${
      list.length
        ? list.map(keyHelpKeyHtml).join("")
        : `<span class="keyHelpUnset">Not set</span>`
    }</span></div>`
  );
}

function keyHelpOverlayHtml() {
  const visible = appMenuControlBindings();
  const byVisibleId = new Map(visible.map((b) => [String(b.id || ""), b]));
  const all =
    WS.meta && Array.isArray(WS.meta.keybinds)
      ? syncPaneKeybindBindingsWithCurrentActions(false)
      : defaultKeybinds(WS.meta && WS.meta.appearancePresets);
  const byAnyId = new Map(all.map((b) => [String(b.id || ""), b]));
  const keyFor = (b) => {
    const fixed = isAnyLockedKeybindAction(b.id) ? lockedKeyForAction(b.id) : "";
    const raw = normalizeKeyValue(fixed || b.key || "");
    return raw ? keyLabel(raw) : "";
  };
  const listed = new Set();
  const groupHtml = (title, rowsHtml) =>
    rowsHtml
      ? `<section class="keyHelpGroup"><h3 class="keyHelpGroupTitle">${escapeHtml(title)}</h3>${rowsHtml}</section>`
      : "";
  let html = "";
  for (const group of KEY_HELP_GROUPS) {
    let rows = "";
    for (const id of group.ids) {
      const b =
        byVisibleId.get(id) ||
        (KEY_HELP_ALWAYS_LISTED_IDS.has(id) &&
        !appItemMenuActionKeybindIsDisabled(id)
          ? byAnyId.get(id)
          : null);
      if (!b) continue;
      listed.add(id);
      const key = keyFor(b);
      rows += keyHelpRowHtml(b.label || id, key ? [key] : []);
    }
    html += groupHtml(group.title, rows);
  }
  let other = "";
  for (const b of visible) {
    if (!b || listed.has(String(b.id || ""))) continue;
    const key = keyFor(b);
    other += keyHelpRowHtml(b.label || b.id, key ? [key] : []);
  }
  html += groupHtml("Other", other);
  html += groupHtml(
    "Built in",
    KEY_HELP_BUILT_IN_ROWS.map((row) => keyHelpRowHtml(row.label, row.keys)).join(""),
  );
  return (
    `<div class="keyHelpHead"><span class="keyHelpTitle">Controls</span>` +
    `<span class="keyHelpHint">Let go of [ to close \u00b7 press ] to change keys</span></div>` +
    `<div class="keyHelpColumns">${html}</div>`
  );
}

function keyHelpOverlayEl() {
  let el = document.getElementById("keyHelpOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "keyHelpOverlay";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

function showKeyHelpOverlay() {
  const el = keyHelpOverlayEl();
  el.innerHTML = keyHelpOverlayHtml();
  el.classList.add("keyHelpOpen");
  // Too tall for the window: tighten rather than scroll -- nothing can scroll a
  // list that disappears the moment the key is released. Each step trades a
  // little size for more columns until the whole list fits.
  const levels = [
    ["300px", []],
    ["300px", ["keyHelpCompact"]],
    ["240px", ["keyHelpCompact"]],
    ["200px", ["keyHelpCompact", "keyHelpTight"]],
    ["170px", ["keyHelpCompact", "keyHelpTight"]],
  ];
  for (const [col, classes] of levels) {
    el.classList.remove("keyHelpCompact", "keyHelpTight");
    classes.forEach((name) => el.classList.add(name));
    el.style.setProperty("--key-help-col", col);
    if (el.scrollHeight <= el.clientHeight + 1) break;
  }
}

function hideKeyHelpOverlay() {
  document.getElementById("keyHelpOverlay")?.classList.remove("keyHelpOpen");
}

function openControlsFromKeyHelp() {
  if (!WS.root || !appActionMenuEl) return false;
  const menuOpen =
    appActionMenuEl.classList.contains("open") && APP_MENU_MODE === "app";
  if (!menuOpen) openAppMenu(null, "app");
  const trigger = Array.from(
    appActionMenuEl.querySelectorAll(".dropdownMenuSubmenuTrigger"),
  ).find((el) => String(el.textContent || "").trim() === "Controls");
  if (!trigger) return false;
  openDropdownSubmenuForTrigger(trigger);
  ensureMenuHighlight(appActionMenuEl);
  return true;
}

function endKeyHelpHold() {
  if (!KEY_HELP_HOLD) return;
  KEY_HELP_HOLD = false;
  hideKeyHelpOverlay();
}

document.addEventListener(
  "keydown",
  (e) => {
    if (KEY_HELP_HOLD) {
      if (keyHelpEventIsHoldKey(e)) {
        // Auto-repeat while held.
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (keyHelpEventIsControlsKey(e) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        hideKeyHelpOverlay();
        openControlsFromKeyHelp();
      }
      return;
    }
    if (!keyHelpEventIsHoldKey(e) || e.repeat) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (
      busyOverlayActive() ||
      confirmDialogIsOpen() ||
      KEYBIND_CAPTURE_ACTION_ID ||
      APP_MENU_CONTROLS_CAPTURE_ID ||
      BANIC_ACTIVE ||
      isTextInputTarget(e.target)
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    KEY_HELP_HOLD = true;
    showKeyHelpOverlay();
  },
  true,
);

document.addEventListener(
  "keyup",
  (e) => {
    if (!KEY_HELP_HOLD || !keyHelpEventIsHoldKey(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    endKeyHelpHold();
  },
  true,
);

// A release that happens in another window never arrives here.
window.addEventListener("blur", () => endKeyHelpHold());

// PANIC always wins. This runs on `window` in the capture phase, so it fires
// before every document-level handler — the app menu, the daily journal, the
// confirm dialog, the search-focus grab — none of which can swallow it
// (they stopImmediatePropagation on `document`, one hop below `window`). The
// one exception is an in-progress keybind capture, where the keypress must be
// recorded as the new binding instead of triggering panic.
//
// The panic key is often a bare letter (default "g"), so the sole place it must
// NOT fire is while typing into a text field — otherwise that letter can never
// be typed and the app is unusable. When the target is a text input we return
// without preventing default or stopping propagation, so the key types normally
// and the document-level handler (which also guards text inputs) leaves it be.
window.addEventListener(
  "keydown",
  (e) => {
    if (KEYBIND_CAPTURE_ACTION_ID || APP_MENU_CONTROLS_CAPTURE_ID) return;
    if (isTextInputTarget(e.target)) return;
    const key = keybindValueFromEvent(e);
    if (!key || keybindActionFor(key) !== "panic") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    applyBanicState(!BANIC_ACTIVE);
  },
  true,
);
