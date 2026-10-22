/* Option setters and toggles
   Setting and cycling options from keys, quick navigation's pane capture and
   the embedded windows. */

/* =========================================================
       Key controls
       ========================================================= */

function isTextInputTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (el.isContentEditable) return true;
  return false;
}

const VIDEO_END_BEHAVIOR_CYCLE = [
  { value: "loop", label: "Loop video" },
  { value: "next", label: "Advance to next item" },
  { value: "stop", label: "Stop at end" },
];

const ANIMATED_FILTER_CYCLE = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
  { value: "videos", label: "Videos only" },
];

const THUMBNAIL_SIZE_CYCLE = [
  { value: "xsmall", label: "Extra small" },
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
  { value: "xlarge", label: "Extra large" },
];

const GLASS_DIFFUSION_CYCLE = GLASS_DIFFUSION_PERCENT_VALUES.map(
  (value) => ({ value, label: `${value}%` }),
);

const VIDEO_SKIP_STEP_CYCLE = [
  { value: "1", label: "1 second" },
  { value: "3", label: "3 seconds" },
  { value: "5", label: "5 seconds" },
  { value: "10", label: "10 seconds" },
  { value: "15", label: "15 seconds" },
  { value: "30", label: "30 seconds" },
];

function cycleFilterMode() {
  const m = WS.view && WS.view.filterMode;
  WS.view.filterMode =
    m === "all"
      ? "images"
      : m === "images"
        ? "videos"
        : m === "videos"
          ? "text"
          : "all";
  applyViewModesEverywhere(true);
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(`Media filter: ${WS.view.filterMode}`, "cycle-filter");
  return true;
}

function setOptionValues(nextValues) {
  if (!WS.meta) return null;
  WS.meta.options = normalizeOptions(
    Object.assign({}, WS.meta.options || {}, nextValues || {}),
  );
  metaMarkDirty(
    ...metaPreferenceDocIdsForOptionKeys(Object.keys(nextValues || {})),
  );
  return WS.meta.options || null;
}

function setOptionValue(key, value) {
  const options = setOptionValues({ [key]: value });
  return options ? options[key] : null;
}

function toggleOptionValue(key) {
  const current = WS.meta && WS.meta.options ? !!WS.meta.options[key] : false;
  return setOptionValue(key, !current);
}

function setMuteMessagesEnabled(enabled) {
  const next = !!enabled;
  const prev = muteMessagesEnabled();
  if (prev === next) return next;
  setOptionValue("muteMessages", next);
  refreshLiveSettingsPaneFromKeyboardAction();
  if (next) hideStatusMessages();
  showStatusMessage(`Disable messages: ${next ? "On" : "Off"}`, "", {
    force: true,
  });
  return next;
}

function cycleOptionValue(key, list) {
  const values = list.map((entry) => entry.value);
  const current =
    WS.meta && WS.meta.options ? String(WS.meta.options[key] || "") : "";
  const idx = values.indexOf(current);
  const next = values[(idx >= 0 ? idx + 1 : 0) % values.length];
  setOptionValue(key, next);
  return next;
}

function labelForCycleValue(list, value) {
  const entry = list.find((item) => item.value === value);
  return entry ? entry.label : String(value || "");
}

function setDirectoriesPaneOpenKeybindState(nextOpen) {
  if (!setDirectoriesPaneOpenValue(nextOpen)) return false;
  if (nextOpen) {
    // Only move focus to the file pane if the preview grid isn't actively
    // selected — so closing then re-opening the pane doesn't kick you out.
    if (WS.view.activePane !== "preview") setActivePane("directories");
  } else {
    syncActivePaneWithLayout();
  }
  refreshAfterDirectoriesPaneToggle(false, true);
  refreshLiveSettingsPaneFromKeyboardAction();
  return true;
}

function currentDirectoryEntriesContainOnlyFilesForQuickNavigation() {
  if (!WS.root || !WS.nav || !Array.isArray(WS.nav.entries)) return false;
  let fileCount = 0;
  for (let i = 0; i < WS.nav.entries.length; i++) {
    const entry = WS.nav.entries[i];
    if (!entry) continue;
    if (entry.kind === "file") {
      fileCount += 1;
      continue;
    }
    if (isSelectableEntry(entry)) return false;
  }
  return fileCount > 0;
}

function captureQuickNavigationDirectoryEnterRestoreState(entry = null) {
  if (!quickNavigationEnabled()) return null;
  if (!WS.root || !WS.meta || VIEWER_MODE) return null;
  if (!directoriesPaneOpenEnabled()) return null;
  if (!entry || entry.kind !== "dir" || !entry.node) return null;
  if (isStorageStubDirNode(entry.node)) return null;
  return {
    restoreDirectoriesPane: true,
    restoreSettingsPane: !!MENU_OPEN,
    settingsTab: String(MENU_ACTIVE_TAB || MENU_LAST_TAB || "controls"),
    activePane:
      WS.view && WS.view.activePane === "preview" ? "preview" : "directories",
    goUpOnRestore: true,
    quickNavigation: true,
  };
}

function maybeClosePanesForQuickNavigationDirectoryEnter(restoreState) {
  if (!restoreState || !quickNavigationEnabled()) return false;
  if (!currentDirectoryEntriesContainOnlyFilesForQuickNavigation()) return false;
  return closePanesForFilePaneEnterAutoRestore(
    Object.assign({}, restoreState, {
      goUpOnRestore: true,
      quickNavigation: true,
    }),
  );
}

function selectedFilePaneEntryForEnterAutoClose(entry = null) {
  if (entry && entry.kind === "file") {
    const selectedEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
    if (
      selectedEntry === entry ||
      (selectedEntry &&
        selectedEntry.kind === "file" &&
        String(selectedEntry.id || "") === String(entry.id || ""))
    ) {
      return entry;
    }
  }

  const navEntry = WS.nav.entries[WS.nav.selectedIndex] || null;
  if (navEntry && navEntry.kind === "file") return navEntry;

  const selectedEl = directoriesListEl
    ? directoriesListEl.querySelector(
        ".dirRow.selected, [data-file-pane-item].selected",
      )
    : null;
  const domIndex = Number(selectedEl?.dataset?.entryIndex);
  const domEntry = Number.isFinite(domIndex)
    ? WS.nav.entries[domIndex] || null
    : null;
  return domEntry && domEntry.kind === "file" ? domEntry : null;
}

function captureFilePaneEnterAutoRestoreState(entry = null) {
  if (!WS.root || !WS.meta || VIEWER_MODE) return null;
  if (!directoriesPaneOpenEnabled()) return null;
  const selectedEntry = selectedFilePaneEntryForEnterAutoClose(entry);
  if (!selectedEntry) return null;
  return {
    restoreDirectoriesPane: true,
    restoreSettingsPane: !!MENU_OPEN,
    settingsTab: String(MENU_ACTIVE_TAB || MENU_LAST_TAB || "controls"),
    activePane:
      WS.view && WS.view.activePane === "preview" ? "preview" : "directories",
  };
}

function closePanesForFilePaneEnterAutoRestore(restoreState) {
  if (!restoreState || !WS.view || !WS.meta) return false;
  WS.view.filePaneEnterAutoClosedPanes = {
    restoreDirectoriesPane: !!restoreState.restoreDirectoriesPane,
    restoreSettingsPane: !!restoreState.restoreSettingsPane,
    settingsTab: String(restoreState.settingsTab || MENU_LAST_TAB || "controls"),
    activePane:
      restoreState.activePane === "preview" ? "preview" : "directories",
    goUpOnRestore: !!restoreState.goUpOnRestore,
    quickNavigation: !!restoreState.quickNavigation,
  };

  let changed = false;
  if (restoreState.restoreSettingsPane && MENU_OPEN) {
    closeMenu();
    changed = true;
  }
  if (restoreState.restoreDirectoriesPane && directoriesPaneOpenEnabled()) {
    changed = setDirectoriesPaneOpenKeybindState(false) || changed;
  }
  return changed;
}

function restorePanesClosedByFilePaneEnter() {
  if (!WS.view || !WS.meta) return false;
  const restoreState = WS.view.filePaneEnterAutoClosedPanes;
  if (!restoreState || typeof restoreState !== "object") return false;
  WS.view.filePaneEnterAutoClosedPanes = null;

  if (restoreState.restoreDirectoriesPane && !directoriesPaneOpenEnabled()) {
    setDirectoriesPaneOpenKeybindState(true);
  }
  if (restoreState.restoreSettingsPane && !MENU_OPEN) {
    openMenu(String(restoreState.settingsTab || MENU_LAST_TAB || "controls"));
  }
  if (restoreState.restoreDirectoriesPane && restoreState.restoreSettingsPane && MENU_OPEN) {
    syncSidePaneWidthsToSmallerSide();
  }
  setActivePane(restoreState.activePane === "preview" ? "preview" : "directories");
  updatePreviewSelectionClasses();
  syncButtons();
  if (restoreState.goUpOnRestore) {
    // Two cases for exiting a quick-nav media folder:
    //  - Opened from the GRID: a full grid return state was captured. Restore
    //    it so both panes jump back together to the pre-open browsing view
    //    (file pane up two+ levels, preview back to the grid) with the media
    //    folder kept selected in the grid.
    //  - Opened from the FILE PANE: no grid return state; the media folder is a
    //    direct child of the current directory, so a single step up restores
    //    the pre-open view.
    if (WS.view.previewFolderBridgeReturnState) {
      syncGridReturnStateToExitedFolder(WS.nav.dirNode);
      restorePreviewFolderBridgeState();
    } else if (!exitUnbridgedOpenFileToSetSelection()) {
      // A dive whose bridge was replaced since (a random jump, say)
      // still leaves onto the model's grid with the set selected, above.
      leaveDirectory();
    }
  }
  return true;
}

function refreshLiveSettingsPaneFromKeyboardAction() {
  if (!MENU_OPEN) return;
  const activeTab = String(MENU_ACTIVE_TAB || "controls");
  if (!isMenuTabAvailable(activeTab)) return;
  if (activeTab === "controls") {
    const savedTop = Number(keybindsBodyEl?.scrollTop || 0) || 0;
    renderKeybindsUi("pane");
    setKeybindsStatus("Saved automatically");
    requestAnimationFrame(() => {
      if (keybindsBodyEl) keybindsBodyEl.scrollTop = savedTop;
    });
    return;
  }
  if (activeTab === "calendar") {
    const savedTop = Number(calendarBodyEl?.scrollTop || 0) || 0;
    renderCalendarUi();
    setCalendarStatus("Saved automatically");
    requestAnimationFrame(() => {
      if (calendarBodyEl) calendarBodyEl.scrollTop = savedTop;
    });
    return;
  }
  const savedTop = Number(optionsBodyEl?.scrollTop || 0) || 0;
  renderOptionsUi(activeTab);
  setOptionsStatus("Saved automatically");
  requestAnimationFrame(() => {
    if (optionsBodyEl) optionsBodyEl.scrollTop = savedTop;
  });
}

function toggleSettingsAndDirectoriesPanesKeybindAction() {
  if (!WS.meta) return false;
  // Secondary (bindable) path to the in-app Settings window; Tab is the primary
  // reserved toggle.
  toggleSettingsWindow(MENU_LAST_TAB || "controls");
  return true;
}

// The Grok and Claude windows live entirely in the main process
// (electron/embedded.js) — they are separate views over the window, so there
// is no DOM here to toggle. Closing is handled on that side too: once one has
// focus this page sees no keys at all, so the main process reads them first.
// Keybind action -> the field name embedded.js keeps each binding under. The
// Variations key goes over too: pressed inside Grok or Claude, it is how the
// main process knows to hand back to this page and open Variations here.
const EMBEDDED_SITE_KEY_FIELDS = Object.freeze({
  toggleGrokWindow: "grok",
  toggleClaudeWindow: "claude",
  toggleVariationsWindow: "variations",
});

function embeddedSiteKeyBindings() {
  const out = { grok: "", claude: "", variations: "" };
  for (const [key, id] of KEYBIND_INDEX) {
    const field = EMBEDDED_SITE_KEY_FIELDS[id];
    if (field && !out[field]) out[field] = key;
  }
  return out;
}

function toggleEmbeddedSiteWindowKeybindAction(actionId, command, name) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) {
    showStatusMessage(`${name} needs the desktop app.`);
    return false;
  }
  // Forwarded so the page can close itself with the same combo: once the
  // embedded window has focus, this window stops receiving keys entirely.
  // KEYBIND_INDEX is key -> id and is rebuilt whenever bindings change, so
  // reversing it always yields the live, normalized combo.
  //
  // All three bindings go over, not just this window's, for the same reason
  // there is a close key at all: the window that ends up in front swallows
  // every key, so the other two toggles never reach this page either. The main
  // process keeps the set, which is what lets any of them replace any other
  // without being closed first.
  const bindings = embeddedSiteKeyBindings();
  const closeKey = bindings[EMBEDDED_SITE_KEY_FIELDS[actionId]] || "";
  invoke(command, { closeKey, siteKeys: bindings })
    .then((visible) => {
      if (!visible) showStatusMessage(`${name} closed.`);
    })
    .catch((err) => {
      showStatusMessage(`${name} failed: ${err}`);
    });
  return true;
}

function toggleGrokWindowKeybindAction() {
  return toggleEmbeddedSiteWindowKeybindAction(
    "toggleGrokWindow",
    "toggle_grok_window",
    "Grok",
  );
}

function toggleClaudeWindowKeybindAction() {
  return toggleEmbeddedSiteWindowKeybindAction(
    "toggleClaudeWindow",
    "toggle_claude_window",
    "Claude",
  );
}

// Variations (the prompt composer) is part of this page: #variations, drawn
// by the module graph in js/variations/ and reached through the one object it
// exposes. While it is open it has the keyboard, so the gallery's own key
// handling asks variationsIsOpen() and stands aside.
function variationsIsOpen() {
  return !!(window.LGVariations && window.LGVariations.isOpen());
}

function toggleVariationsWindowKeybindAction() {
  if (!window.LGVariations) {
    showStatusMessage("Variations is still loading.");
    return false;
  }
  window.LGVariations.toggle();
  return true;
}

function refreshWorkspaceKeybindAction() {
  if (!WS.meta || !WS.meta.fsRootHandle) {
    showStatusMessage("Refresh requires a writable folder.");
    return false;
  }
  if (WORKSPACE_REFRESH_IN_FLIGHT) {
    showStatusMessage("Refresh already running.");
    return true;
  }
  WORKSPACE_REFRESH_IN_FLIGHT = true;
  showStatusMessage("Refreshing workspace...");
  (async () => {
    try {
      await refreshWorkspaceFromRootHandle();
      showStatusMessage("Refresh complete.");
    } catch {
      showStatusMessage("Refresh failed.");
    } finally {
      WORKSPACE_REFRESH_IN_FLIGHT = false;
    }
  })();
  return true;
}
