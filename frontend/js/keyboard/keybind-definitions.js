/* Keybind definitions
   Key parsing and labels, KEYBIND_ACTIONS (the order Controls lists them in),
   default bindings and the key index. */

const SAFE_KEY_VALUES = (() => {
  const out = [];
  for (let i = 0; i < 26; i++) out.push(String.fromCharCode(97 + i));
  for (let i = 0; i < 10; i++) out.push(String(i));
  out.push("Space");
  out.push("Tab");
  out.push(",");
  out.push("ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown");
  return out;
})();

const SAFE_KEY_SET = new Set(SAFE_KEY_VALUES);
const KEY_MODIFIER_ORDER = ["Cmd", "Ctrl", "Alt", "Shift"];
const IS_APPLE_PLATFORM = (() => {
  const platform = String(navigator?.platform || "").toLowerCase();
  const userAgentDataPlatform = String(
    navigator?.userAgentData?.platform || "",
  ).toLowerCase();
  return /mac|iphone|ipad|ipod/.test(platform || userAgentDataPlatform);
})();
const MODIFIER_KEY_STATE = {
  Cmd: false,
  Ctrl: false,
  Alt: false,
  Shift: false,
};
const KEY_MODIFIER_LABELS = Object.freeze({
  Cmd: "Command",
  Ctrl: "Control",
  Alt: IS_APPLE_PLATFORM ? "Option" : "Alt",
  Shift: "Shift",
});
const KEYBIND_MODIFIER_TAB_SPECS = Object.freeze([
  Object.freeze({ id: "all", label: "All", modifier: "" }),
  Object.freeze({
    id: "command",
    label: IS_APPLE_PLATFORM ? "Command" : "Control",
    modifier: IS_APPLE_PLATFORM ? "Cmd" : "Ctrl",
  }),
  Object.freeze({
    id: "option",
    label: IS_APPLE_PLATFORM ? "Option" : "Alt",
    modifier: "Alt",
  }),
  Object.freeze({ id: "shift", label: "Shift", modifier: "Shift" }),
]);
const MODIFIER_ALIASES = Object.freeze({
  command: "Cmd",
  cmd: "Cmd",
  meta: "Cmd",
  control: "Ctrl",
  ctrl: "Ctrl",
  option: "Alt",
  opt: "Alt",
  alt: "Alt",
  shift: "Shift",
});

const KEY_LABELS = {
  Escape: "Escape",
  Space: "Space",
  Tab: "Tab",
  ArrowLeft: "Left Arrow",
  ArrowRight: "Right Arrow",
  ArrowUp: "Up Arrow",
  ArrowDown: "Down Arrow",
  "=": "+ / =",
  "-": "- / _",
};

const SHIFT_DIGIT_SYMBOL_TO_KEY = Object.freeze({
  "!": "1",
  "@": "2",
  "#": "3",
  $: "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
});

function syncModifierKeyStateFromEvent(e) {
  if (!e) return;
  MODIFIER_KEY_STATE.Cmd = !!e.metaKey;
  MODIFIER_KEY_STATE.Ctrl = !!e.ctrlKey;
  MODIFIER_KEY_STATE.Alt = !!e.altKey;
  MODIFIER_KEY_STATE.Shift = !!e.shiftKey;
}

function clearModifierKeyState() {
  MODIFIER_KEY_STATE.Cmd = false;
  MODIFIER_KEY_STATE.Ctrl = false;
  MODIFIER_KEY_STATE.Alt = false;
  MODIFIER_KEY_STATE.Shift = false;
}

function eventShiftHeld(e) {
  return !!((e && e.shiftKey) || MODIFIER_KEY_STATE.Shift);
}

function eventCmdOrCtrlHeld(e) {
  return !!(
    (e && (e.metaKey || e.ctrlKey)) ||
    MODIFIER_KEY_STATE.Cmd ||
    MODIFIER_KEY_STATE.Ctrl
  );
}

function normalizeBaseKeyValue(key) {
  if (!key && key !== 0) return "";
  const raw = String(key);
  if (!raw) return "";
  if (raw === " ") return "Space";
  if (raw === "+" || raw === "=") return "=";
  if (raw === "_" || raw === "-") return "-";
  if (SHIFT_DIGIT_SYMBOL_TO_KEY[raw]) return SHIFT_DIGIT_SYMBOL_TO_KEY[raw];
  if (/^space$/i.test(raw)) return "Space";
  if (/^escape$/i.test(raw) || /^esc$/i.test(raw)) return "Escape";
  if (raw.length === 1) return raw.toLowerCase();
  return raw;
}

function normalizeKeyValue(key) {
  if (!key && key !== 0) return "";
  const raw = String(key).trim();
  if (!raw) return "";
  const parts = raw
    .split("+")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
  if (!parts.length) return "";
  const mods = { Cmd: false, Ctrl: false, Alt: false, Shift: false };
  let base = "";
  for (const partRaw of parts) {
    const part = String(partRaw || "").trim();
    if (!part) continue;
    const mod = MODIFIER_ALIASES[part.toLowerCase()] || "";
    if (mod) {
      mods[mod] = true;
      continue;
    }
    base = normalizeBaseKeyValue(part);
  }
  if (!base) return "";
  if (base === "=" || base === "-" || base === "Escape") return base;
  const modParts = KEY_MODIFIER_ORDER.filter((mod) => mods[mod]);
  return modParts.length ? `${modParts.join("+")}+${base}` : base;
}

function parseKeybindValue(value) {
  const norm = normalizeKeyValue(value);
  const parsed = {
    key: "",
    mods: { Cmd: false, Ctrl: false, Alt: false, Shift: false },
  };
  if (!norm) return parsed;
  const parts = norm.split("+").filter(Boolean);
  if (!parts.length) return parsed;
  const base = parts[parts.length - 1];
  parsed.key = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const mod = parts[i];
    if (parsed.mods.hasOwnProperty(mod)) parsed.mods[mod] = true;
  }
  return parsed;
}

function buildKeybindValue(baseKey, modifiers = null) {
  const base = normalizeBaseKeyValue(baseKey);
  if (!base) return "";
  if (base === "=" || base === "-" || base === "Escape") return base;
  const mods = {
    Cmd: !!(modifiers && modifiers.Cmd),
    Ctrl: !!(modifiers && modifiers.Ctrl),
    Alt: !!(modifiers && modifiers.Alt),
    Shift: !!(modifiers && modifiers.Shift),
  };
  const modParts = KEY_MODIFIER_ORDER.filter((mod) => mods[mod]);
  return modParts.length ? `${modParts.join("+")}+${base}` : base;
}

function keybindValueFromEvent(e) {
  if (!e) return "";
  const keyRaw = String(e.key || "");
  const codeRaw = String(e.code || "");
  if (!keyRaw && !codeRaw) return "";
  if (
    keyRaw === "Meta" ||
    keyRaw === "Control" ||
    keyRaw === "Alt" ||
    keyRaw === "Shift"
  )
    return "";
  const mods = {
    Cmd: !!e.metaKey,
    Ctrl: !!e.ctrlKey,
    Alt: !!e.altKey,
    Shift: !!e.shiftKey,
  };

  let base = "";
  if (/^Key[A-Z]$/.test(codeRaw)) {
    base = codeRaw.slice(3).toLowerCase();
  } else if (/^Digit[0-9]$/.test(codeRaw)) {
    base = codeRaw.slice(5);
  } else if (codeRaw === "Space") {
    base = "Space";
  } else if (codeRaw === "Escape") {
    base = "Escape";
  } else if (codeRaw === "Equal") {
    base = "=";
  } else if (codeRaw === "Minus") {
    base = "-";
  } else {
    const shiftedDigitBase = SHIFT_DIGIT_SYMBOL_TO_KEY[keyRaw];
    if (shiftedDigitBase)
      return buildKeybindValue(
        shiftedDigitBase,
        Object.assign({}, mods, { Shift: true }),
      );
    base = normalizeBaseKeyValue(keyRaw);
  }

  if (!base) return "";
  if (base === "=" || base === "-" || base === "Escape") return base;
  return buildKeybindValue(base, mods);
}

function isSafeKey(key) {
  const base = normalizeBaseKeyValue(key);
  return SAFE_KEY_SET.has(base);
}

function isSafeKeybindValue(keybind) {
  const parsed = parseKeybindValue(keybind);
  if (!parsed.key) return true;
  return isSafeKey(parsed.key);
}

function keyLabel(key) {
  if (!key) return "Unassigned";
  const norm = normalizeKeyValue(key);
  const parsed = parseKeybindValue(norm);
  if (!parsed.key) return "Unassigned";
  const modText = KEY_MODIFIER_ORDER.filter((mod) => parsed.mods[mod])
    .map((mod) => KEY_MODIFIER_LABELS[mod] || mod)
    .join("+");
  const base = KEY_LABELS[parsed.key]
    ? KEY_LABELS[parsed.key]
    : parsed.key.length === 1
      ? parsed.key.toUpperCase()
      : parsed.key;
  return modText ? `${modText}+${base}` : base;
}

const KEYBIND_SECTIONS = [
  { id: "navigation", label: "Navigation" },
  { id: "panes", label: "Panels & Workspace" },
  { id: "random", label: "Random" },
  { id: "filters", label: "Filters & Sorting" },
  { id: "visibility", label: "Folder Visibility" },
  { id: "folderActions", label: "Folder Actions" },
  { id: "playback", label: "Playback" },
  { id: "appearance", label: "Appearance & Presets" },
  { id: "thumbnails", label: "Thumbnail Cards" },
  { id: "filenames", label: "Filenames" },
];

// Set this to false to restore the duplicate Settings/Controls surfaces.
// When true, actions already available in the app menu are menu-only: their
// Settings rows are hidden and their keybinds are ignored at runtime. Stored
// option values and binding assignments are deliberately left untouched.
// Favorite selection and the two random jumps are intentionally absent -- they
// are worth a direct key even though the menu also offers them.
const APP_ITEM_MENU_ACTIONS_ONLY = true;

// The item menu is no longer a surface of its own: it lives inside the app menu
// as the "Selected Item(s)" section, so there is a single bound key for
// everything. Set this to true to bring the standalone menus back (their
// builders are still used by the app menu, so only the entry points are gated).
const SEPARATE_ITEM_MENU_ENABLED = false;

function separateItemMenuDisabled() {
  return !SEPARATE_ITEM_MENU_ENABLED;
}

const APP_ITEM_MENU_ACTION_KEYBIND_IDS = new Set([
  "slideshow",
  // Deliberately NOT gated (so they appear in the Controls list and can be bound
  // to keys, while still remaining app-menu items): the media filter cycle
  // (cycleFilter), the folder sort cycle (cycleFolderSort), the quick-navigation
  // toggle (toggleQuickNavigation), the appearance-preset cycle
  // (cycleAppearancePresets), and the Storage/Trash/Untagged reveal toggles.
  // Reveal Hidden was already exposed.
  "hiddenSelection",
  "tagSelection",
  "renameSelection",
  "toggleMuteMessages",
  "toggleFloatTags",
  "toggleFloatSpecialContainers",
  "cycleThumbnailSize",
  "cycleVideoSkipStep",
  "cycleVideoEndBehavior",
  "toggleAnimatedFilters",
  // Newly surfaced in the app menu. toggleGrokWindow, toggleClaudeWindow and
  // toggleVariationsWindow are deliberately absent: none has a menu entry, so
  // their keybinds are the only way in.
  "refreshWorkspace",
  "toggleShowPositionNumbers",
  "toggleHideBeforeLastDash",
  "toggleHideFileExtensions",
  "toggleShowFileNames",
  "cycleAppTheme",
]);

const APP_ITEM_MENU_SETTING_CONTROL_IDS = Object.freeze([
  "opt_quickNavigation",
  "opt_showHiddenFolder",
  "opt_showTrashFolder",
  "opt_showStorageFolder",
  "opt_showUntaggedFolder",
  "opt_filterMode",
  "opt_dirSortMode",
  "opt_generalAppearancePreset",
  "opt_slideshowDefault",
  "opt_muteMessages",
  "opt_showTagFolderSpacerRow",
  "opt_thumbnailSize",
  "opt_videoSkipStep",
  "opt_videoEndBehavior",
  "opt_animatedMediaFilters",
]);

function appItemMenuActionKeybindIsDisabled(actionId) {
  if (!APP_ITEM_MENU_ACTIONS_ONLY) return false;
  const id = String(actionId || "");
  return (
    APP_ITEM_MENU_ACTION_KEYBIND_IDS.has(id) ||
    id.startsWith("toggleAppearancePreset:")
  );
}

function applyAppItemMenuOnlySettingsVisibility(panel) {
  if (!APP_ITEM_MENU_ACTIONS_ONLY || !panel) return;
  const hideRegion = (region) => {
    if (!region) return;
    region.hidden = true;
    region.style.display = "none";
    region.setAttribute("aria-hidden", "true");
  };
  APP_ITEM_MENU_SETTING_CONTROL_IDS.forEach((id) => {
    const control = panel.querySelector(`#${id}`);
    if (!control) return;
    const region = control.closest(".optRow") || control.parentElement;
    hideRegion(region);
  });
  hideRegion(panel.querySelector('[data-settings-section="reveal"]'));
  panel.querySelectorAll(".settingsSection").forEach((section) => {
    const hasVisibleContent = Array.from(section.children || []).some(
      (child) =>
        !child.matches?.("h2") &&
        !child.hidden &&
        child.style?.display !== "none",
    );
    if (!hasVisibleContent) hideRegion(section);
  });
}

const KEYBIND_ACTIONS = [
  {
    id: "selectUp",
    label: "Up selection",
    hint: "Move selection up.",
    section: "navigation",
  },
  {
    id: "selectLeft",
    label: "Left selection",
    hint: "Move selection left in the preview grid.",
    section: "navigation",
  },
  {
    id: "selectDown",
    label: "Down selection",
    hint: "Move selection down.",
    section: "navigation",
  },
  {
    id: "selectRight",
    label: "Right selection",
    hint: "Move selection right in the preview grid.",
    section: "navigation",
  },
  {
    id: "leaveDir",
    label: "Up directory",
    hint: "Go to the parent folder or close the current item.",
    section: "navigation",
  },
  {
    id: "enterDir",
    label: "Open selection",
    hint: "Open the selected item.",
    section: "navigation",
  },
  {
    id: "prevFolder",
    label: "Previous folder",
    hint: "In a folder grid, jump to the top of the current column. In a media folder, jump to the previous sibling folder's first file.",
    section: "navigation",
  },
  {
    id: "nextFolder",
    label: "Next folder",
    hint: "In a folder grid, jump to the bottom of the current column. In a media folder, jump to the next sibling folder's first file.",
    section: "navigation",
  },
  {
    id: "prevRootFolder",
    label: "Previous folder in root",
    hint: "Jump to the previous folder directly inside the library root.",
    section: "navigation",
  },
  {
    id: "nextRootFolder",
    label: "Next folder in root",
    hint: "Jump to the next folder directly inside the library root.",
    section: "navigation",
  },
  {
    id: "jumpToRoot",
    label: "Jump to root",
    hint: "Go to the library root.",
    section: "navigation",
  },
  {
    id: "openAppMenu",
    label: "Open select menu",
    hint: "Toggle the selected item's own actions beside it. The app menu is Tab.",
    section: "folderActions",
  },
  {
    id: "toggleQuickNavigation",
    label: "Quick navigation",
    hint: "When opening a folder that only contains files, enter its media immediately.",
    section: "navigation",
  },
  {
    id: "grabReorderItem",
    label: "Grab to reorder",
    hint: "Pick up the selected file, in the grid or open; the selection keys then move it. Press again (or Esc) to set it down.",
    section: "navigation",
  },
  {
    id: "favoriteSelection",
    label: "Favorite selection",
    hint: "Favorite or unfavorite the selected item(s).",
    section: "folderActions",
  },
  {
    id: "hiddenSelection",
    label: "Hide/unhide selection",
    hint: "Hide or unhide the selected item(s).",
    section: "folderActions",
  },
  {
    id: "tagSelection",
    label: "Add selection to tag",
    hint: "Add the selected item(s) to a tag.",
    section: "folderActions",
  },
  {
    id: "renameSelection",
    label: "Rename selected item",
    hint: "Start renaming the selected item.",
    section: "folderActions",
  },
  {
    id: "scoreUpSelection",
    label: "Increase folder score",
    hint: "Increase score for selected/current folder(s).",
    section: "folderActions",
    hiddenInUi: true,
  },
  {
    id: "scoreDownSelection",
    label: "Decrease folder score",
    hint: "Decrease score for selected/current folder(s).",
    section: "folderActions",
    hiddenInUi: true,
  },
  {
    id: "toggleSelectionInBulk",
    label: "Add/remove to bulk selection",
    hint: "Add or remove the current item from the bulk selection (keyboard equivalent of Cmd-clicking it).",
    section: "folderActions",
  },
  {
    id: "selectRangeInBulk",
    label: "Select range in bulk selection",
    hint: "Select every item from the bulk selection anchor through the current item (keyboard equivalent of Shift-clicking it).",
    section: "folderActions",
  },
  {
    id: "selectAllInLocation",
    label: "Select all",
    hint: "Select every item in the current location.",
    section: "folderActions",
  },
  {
    id: "cancelMultiSelection",
    label: "Cancel bulk selection",
    hint: "Clear the current bulk selection and return to single-item selection.",
    section: "folderActions",
  },
  {
    id: "cycleFolderSort",
    label: "Cycle folder sort",
    hint: "Cycle folder sort mode.",
    section: "filters",
  },
  {
    id: "cycleFilter",
    label: "Cycle media filter",
    hint: "Cycle the root-wide media filter.",
    section: "filters",
  },
  {
    id: "toggleShowHiddenFolder",
    label: "Reveal hidden items",
    hint: "Toggle showing folders hidden by hidden tags in the current view.",
    section: "visibility",
  },
  {
    id: "toggleUtilityContainers",
    label: "Utility containers",
    hint: "Show or hide the utility containers in the root all at once: Trash, Storage, Untagged, All tags, All Models, All Sets and Certified fresh.",
    section: "visibility",
  },
  {
    id: "toggleFloatTags",
    label: "Float tags",
    hint: "Toggle the blank spacer row separating tag folders from regular folders.",
    section: "panes",
  },
  {
    id: "toggleFloatSpecialContainers",
    label: "Float utility containers",
    hint: "Toggle the blank spacer row separating the utility containers (and Favorites) from the Tags below them.",
    section: "panes",
  },
  {
    id: "cycleThumbnailSize",
    label: "Cycle thumbnail size",
    hint: "Cycle how large media thumbnails are in the preview grid.",
    section: "thumbnails",
  },
  {
    id: "cycleGlassDiffusion",
    label: "Cycle diffusion",
    hint: "Cycle how hard every translucent surface frosts, from Off to 100%.",
    section: "thumbnails",
    hiddenInUi: true,
  },
  {
    id: "toggleShowFileNames",
    label: "Show file names",
    hint: "Toggle the name and score bubbles on file thumbnails.",
    section: "filenames",
  },
  {
    id: "toggleShowPositionNumbers",
    label: "Position number prefixes",
    hint: "Toggle position-number prefixes on displayed names.",
    section: "filenames",
  },
  {
    id: "toggleHideBeforeLastDash",
    label: "Trim before last dash",
    hint: "Toggle trimming before the last dash.",
    section: "filenames",
  },
  {
    id: "toggleHideFileExtensions",
    label: "Hide file extensions",
    hint: "Toggle showing the .jpg / .mp4 on displayed file names.",
    section: "filenames",
  },
  {
    id: "cycleAppTheme",
    label: "Cycle theme",
    hint: "Switch between the dark and light themes.",
    section: "panes",
  },
  {
    id: "cycleAppearancePresets",
    label: "Cycle Presets",
    hint: "Cycle appearance presets alphabetically, with Default first.",
    section: "appearance",
  },
  {
    id: "toggleAnimatedFilters",
    label: "Cycle animated filters",
    hint: "Cycle animated filters.",
    section: "filters",
  },
  {
    id: "playPause",
    label: "Pause/Play video",
    hint: "Toggle video playback.",
    section: "playback",
  },
  {
    id: "muteToggle",
    label: "Mute/Unmute video",
    hint: "Toggle video mute.",
    section: "playback",
  },
  {
    id: "seekBack",
    label: "Scrub video backward (hold)",
    hint: "Hold to scrub backward; it speeds up the longer you hold.",
    section: "playback",
  },
  {
    id: "seekForward",
    label: "Scrub video forward (hold)",
    hint: "Hold to scrub forward; it speeds up the longer you hold.",
    section: "playback",
  },
  {
    id: "cycleVideoSkipStep",
    label: "Cycle video skip step",
    hint: "Cycle how far left/right seek jumps move videos.",
    section: "playback",
  },
  {
    id: "cycleVideoEndBehavior",
    label: "Cycle video end behavior",
    hint: "Cycle what happens when a video reaches the end.",
    section: "playback",
  },
  {
    id: "slideshow",
    label: "Slideshow mode",
    hint: "Toggle slideshow.",
    section: "playback",
  },
  {
    id: "volumeUp",
    label: "Volume up",
    hint: "Raise the app's volume (video and music) by 5%.",
    section: "playback",
  },
  {
    id: "volumeDown",
    label: "Volume down",
    hint: "Lower the app's volume (video and music) by 5%.",
    section: "playback",
  },
  {
    id: "toggleMusicPlayer",
    label: "Music player",
    hint: "Open or close the music player.",
    section: "playback",
  },
  {
    id: "musicPlayPause",
    label: "Play/Pause music",
    hint: "Play or pause the music player from anywhere.",
    section: "playback",
  },
  {
    id: "musicPrevious",
    label: "Previous song",
    hint: "Go to the previous song (or the start of this one).",
    section: "playback",
  },
  {
    id: "musicNext",
    label: "Next song",
    hint: "Go to the next song.",
    section: "playback",
  },
  {
    id: "musicToggleShuffle",
    label: "Shuffle music",
    hint: "Turn the music player's Shuffle on or off.",
    section: "playback",
  },
  {
    id: "musicToggleRepeat",
    label: "Repeat song",
    hint: "Turn the music player's Repeat song on or off.",
    section: "playback",
  },
  {
    id: "toggleMuteMessages",
    label: "Disable messages",
    hint: "Toggle status and notification messages on or off.",
    section: "panes",
  },
  {
    id: "refreshWorkspace",
    label: "Refresh App",
    hint: "Refresh the loaded writable folder from disk.",
    section: "panes",
  },
  {
    id: "toggleGrokWindow",
    label: "Toggle Grok",
    hint: "Show or hide Grok inside the app. Esc closes it.",
    section: "panes",
  },
  {
    id: "toggleClaudeWindow",
    label: "Toggle Claude",
    hint: "Show or hide Claude inside the app. Esc closes it.",
    section: "panes",
  },
  {
    id: "toggleVariationsWindow",
    label: "Toggle Variations",
    hint: "Show or hide the prompt composer inside the app. Esc closes it.",
    section: "panes",
  },
  {
    id: "panic",
    label: "PANIC!",
    hint: "Toggle the decoy window mode.",
    section: "panes",
  },
  // The random controls are last, on purpose: Controls lists this array in
  // order, and Jo keeps them together at the bottom (buildAppMenuControlsSubmenu
  // also holds them there below the appearance preset actions).
  {
    id: "randomFileInFolderJump",
    label: "Jump to random file in current folder",
    hint: "Open a random file from the folder you are in: its own files in a set, every set's files in a model or a Tag.",
    section: "random",
  },
  {
    id: "randomFileInModelJump",
    label: "Jump to random file in current model",
    hint: "Open a random file from any set in the model folder you are in.",
    section: "random",
  },
  {
    id: "randomFileInRootJump",
    label: "Jump to random file in root",
    hint: "Open a random file from anywhere in the library.",
    section: "random",
  },
  {
    id: "randomFirstFileJump",
    label: "Jump to random set in current model",
    hint: "Open the first file of a random set in the model folder you are in (inside a Tag, among the Tag's sets).",
    section: "random",
  },
  {
    id: "randomRootSetJump",
    label: "Jump to random set in root",
    hint: "Open the first file of a random set in any model folder.",
    section: "random",
  },
  {
    id: "randomModelJump",
    label: "Jump to random model",
    hint: "Go into a random model folder.",
    section: "random",
  },
  {
    id: "toggleRandomModelOrder",
    label: "Randomize model order",
    hint: "Shuffle the model folders. Each time it is turned on is a new order. Only this control turns it off.",
    section: "random",
  },
  {
    id: "toggleRandomFolderSort",
    label: "Randomize set order",
    hint: "Shuffle the sets inside each model folder. Each time it is turned on is a new order. Only this control turns it off.",
    section: "random",
  },
  {
    id: "toggleRandomFileOrder",
    label: "Randomize file order",
    hint: "Shuffle the files inside each set. Each time it is turned on is a new order. Only this control turns it off.",
    section: "random",
  },
];

const GRID_KEYBIND_SECTIONS = [
  { id: "gridnav", label: "Grid Navigation" },
];

const GRID_KEYBIND_ACTIONS = [
  {
    id: "gridMoveUp",
    label: "Move selection up",
    hint: "Move grid selection up.",
    section: "gridnav",
  },
  {
    id: "gridMoveDown",
    label: "Move selection down",
    hint: "Move grid selection down.",
    section: "gridnav",
  },
  {
    id: "gridOpenSelection",
    label: "Open selection",
    hint: "Open selected item in grid mode.",
    section: "gridnav",
  },
];

const APPEARANCE_PRESET_KEYBIND_ACTION_PREFIX = "toggleAppearancePreset:";

function appearancePresetKeybindActionId(presetId) {
  const id = normalizeAppearancePresetIdValue(presetId);
  return id ? `${APPEARANCE_PRESET_KEYBIND_ACTION_PREFIX}${id}` : "";
}

function appearancePresetIdFromKeybindAction(actionId) {
  if (!APPEARANCE_FILTERS_ENABLED) return "";
  const raw = String(actionId || "");
  if (!raw.startsWith(APPEARANCE_PRESET_KEYBIND_ACTION_PREFIX)) return "";
  return normalizeAppearancePresetIdValue(
    raw.slice(APPEARANCE_PRESET_KEYBIND_ACTION_PREFIX.length),
  );
}

function isAppearancePresetKeybindAction(actionId) {
  if (!APPEARANCE_FILTERS_ENABLED) return false;
  return !!appearancePresetIdFromKeybindAction(actionId);
}

function getAppearancePresetKeybindActions(presets = null) {
  // No "Toggle preset: ..." rows in the Controls tab while the system is off.
  // Existing bindings stay in the stored config, untouched.
  if (!APPEARANCE_FILTERS_ENABLED) return [];
  const source = Array.isArray(presets) ? presets : defaultAppearancePresets();
  const out = [];
  for (let i = 0; i < source.length; i++) {
    const preset = source[i];
    const presetId = normalizeAppearancePresetIdValue(preset && preset.id);
    if (!presetId || presetId === BUILTIN_NULL_APPEARANCE_PRESET_ID) continue;
    const presetName = normalizeAppearancePresetName(
      preset && preset.name,
      "Preset",
    );
    out.push({
      id: appearancePresetKeybindActionId(presetId),
      label: `Toggle preset: ${presetName}`,
      hint: `Toggle appearance preset '${presetName}' on or off.`,
      section: "appearance",
    });
  }
  return out;
}

function paneKeybindActions(presets = null) {
  return KEYBIND_ACTIONS.concat(getAppearancePresetKeybindActions(presets));
}

const GENERAL_KEYBIND_ACTION_IDS = Object.freeze([
  "toggleQuickNavigation",
  "refreshWorkspace",
  "toggleGrokWindow",
  "toggleClaudeWindow",
  "toggleVariationsWindow",
  "cycleFilter",
  "cycleFolderSort",
  "toggleAnimatedFilters",
  "cycleAppearancePresets",
  "randomFileInFolderJump",
  "randomFileInModelJump",
  "randomFileInRootJump",
  "randomFirstFileJump",
  "randomRootSetJump",
  "randomModelJump",
  "toggleRandomModelOrder",
  "toggleRandomFolderSort",
  "toggleRandomFileOrder",
  "toggleShowHiddenFolder",
  "toggleUtilityContainers",
  "toggleMuteMessages",
]);
const GENERAL_KEYBIND_ACTION_ID_SET = new Set(GENERAL_KEYBIND_ACTION_IDS);

function isGeneralKeybindActionId(actionId) {
  const id = String(actionId || "");
  return (
    GENERAL_KEYBIND_ACTION_ID_SET.has(id) ||
    isAppearancePresetKeybindAction(id)
  );
}

function generalKeybindActionSortIndex(actionId) {
  const id = String(actionId || "");
  const index = GENERAL_KEYBIND_ACTION_IDS.indexOf(id);
  if (index >= 0) return index;
  if (isAppearancePresetKeybindAction(id)) {
    const base = GENERAL_KEYBIND_ACTION_IDS.indexOf("cycleAppearancePresets");
    return (base >= 0 ? base : GENERAL_KEYBIND_ACTION_IDS.length) + 0.5;
  }
  return GENERAL_KEYBIND_ACTION_IDS.length + 1000;
}

// Hard-coded keys cannot be reassigned in the Controls menu.
// WASD/QE are navigation; Cmd+W/S step folders and Cmd+Shift+W/S step the
// root's own folders; Tab is the settings menu; F is select menu; =/- are score.
const KEYBIND_LOCKED_ACTIONS = Object.freeze({
  selectUp: "w",
  selectLeft: "a",
  selectDown: "s",
  selectRight: "d",
  leaveDir: "q",
  enterDir: "e",
  prevFolder: "Cmd+w",
  nextFolder: "Cmd+s",
  prevRootFolder: "Cmd+Shift+w",
  nextRootFolder: "Cmd+Shift+s",
  settingsMenu: "Tab",
  // Held, [ shows the controls list (] while held opens Controls). Not rebindable.
  keyHelp: "[",
  // Debug mode (see "Debug mode"). Not rebindable.
  debugMode: "`",
  openAppMenu: "f",
  scoreUpSelection: "=",
  scoreDownSelection: "-",
});
const KEYBIND_LOCKED_IDS = new Set(Object.keys(KEYBIND_LOCKED_ACTIONS));

function lockedKeyForAction(actionId) {
  return normalizeKeyValue(KEYBIND_LOCKED_ACTIONS[actionId] || "");
}

function isLockedKeybindAction(actionId) {
  return KEYBIND_LOCKED_IDS.has(actionId);
}

function isKeyReservedForLockedAction(key, excludeActionId = "") {
  const norm = normalizeKeyValue(key);
  if (!norm) return false;
  for (const [id, fixed] of Object.entries(KEYBIND_LOCKED_ACTIONS)) {
    if (id === excludeActionId) continue;
    if (normalizeKeyValue(fixed) === norm) return true;
  }
  return false;
}

const KEYBIND_DEFAULT_BINDINGS = Object.freeze({
  selectUp: "w",
  selectDown: "s",
  selectLeft: "a",
  selectRight: "d",
  grabReorderItem: "",
  leaveDir: "q",
  enterDir: "e",
  prevFolder: "Cmd+w",
  nextFolder: "Cmd+s",
  prevRootFolder: "Cmd+Shift+w",
  nextRootFolder: "Cmd+Shift+s",
  jumpToRoot: "",
  toggleSettingsAndDirectoriesPanes: "",
  refreshWorkspace: "",
  toggleGrokWindow: "Cmd+g",
  toggleClaudeWindow: "Cmd+j",
  toggleVariationsWindow: "Cmd+u",
  randomFirstFileJump: "r",
  // The newer random controls ship unbound.
  randomRootSetJump: "",
  randomModelJump: "",
  randomFileInFolderJump: "",
  randomFileInModelJump: "",
  randomFileInRootJump: "",
  toggleRandomModelOrder: "",
  toggleRandomFolderSort: "Cmd+r",
  toggleRandomFileOrder: "",
  cycleThumbnailSize: "",
  // Media filter is menu-only. The select menu opens with F (openAppMenu, locked).
  cycleFilter: "",
  slideshow: "v",
  volumeUp: "Alt+ArrowUp",
  volumeDown: "Alt+ArrowDown",
  toggleMusicPlayer: "m",
  musicPlayPause: "",
  musicPrevious: "",
  musicNext: "",
  musicToggleShuffle: "",
  musicToggleRepeat: "",
  panic: "g",
  cycleFolderSort: "t",
  toggleShowHiddenFolder: "h",
  toggleUtilityContainers: "u",
  toggleQuickNavigation: "",
  favoriteSelection: "Cmd+f",
  tagSelection: "Shift+t",
  renameSelection: "",
  toggleSelectionInBulk: "",
  selectRangeInBulk: "",
  cancelMultiSelection: "",
  selectAllInLocation: "Cmd+Alt+f",
  openAppMenu: "f",
  seekBack: "z",
  seekForward: "c",
  playPause: "x",
  muteToggle: "Cmd+x",
  toggleAnimatedFilters: "Cmd+i",
  cycleAppearancePresets: "",
  toggleHideBeforeLastDash: "n",
  scoreUpSelection: "=",
  scoreDownSelection: "-",
  "toggleAppearancePreset:preset-mod8x13x-elw7of": "1",
  "toggleAppearancePreset:preset-mod8nt73-butsgx": "2",
  "toggleAppearancePreset:preset-mod8auau-n45sw8": "3",
  "toggleAppearancePreset:preset-mnrf0djp-dfta2v": "4",
  "toggleAppearancePreset:preset-mod8ie4f-fsdlub": "5",
});

const GRID_KEYBIND_DEFAULT_BINDINGS = Object.freeze({
  gridMoveUp: "",
  gridMoveDown: "",
  gridOpenSelection: "d",
});

function applyFixedKeybinds(bindings) {
  const byId = new Map(bindings.map((binding) => [binding.id, binding]));
  Object.entries(KEYBIND_LOCKED_ACTIONS).forEach(([id, key]) => {
    const binding = byId.get(id);
    if (!binding) return;
    binding.key = normalizeKeyValue(key);
  });
}

function defaultKeybinds(presets = null) {
  const bindings = paneKeybindActions(presets).map((def) => {
    const key = KEYBIND_DEFAULT_BINDINGS[def.id] || "";
    return Object.assign({}, def, { key: normalizeKeyValue(key) });
  });
  applyFixedKeybinds(bindings);
  enforceUniqueKeybinds(bindings, KEYBIND_LOCKED_IDS);
  return bindings;
}

function defaultGridKeybinds() {
  const bindings = GRID_KEYBIND_ACTIONS.map((def) => {
    const key = GRID_KEYBIND_DEFAULT_BINDINGS[def.id] || "";
    return Object.assign({}, def, { key: normalizeKeyValue(key) });
  });
  enforceUniqueKeybinds(bindings);
  return bindings;
}

function enforceUniqueKeybinds(bindings, lockedIds = null) {
  const used = new Map();
  bindings.forEach((binding) => {
    const key = normalizeKeyValue(binding.key);
    if (!key) {
      binding.key = "";
      return;
    }
    const existing = used.get(key);
    if (!existing) {
      used.set(key, binding);
      binding.key = key;
      return;
    }
    const existingLocked = !!(lockedIds && lockedIds.has(existing.id));
    const currentLocked = !!(lockedIds && lockedIds.has(binding.id));
    if (currentLocked && !existingLocked) {
      existing.key = "";
      used.set(key, binding);
      binding.key = key;
      return;
    }
    binding.key = "";
  });
}

function normalizeKeybinds(log, presets = null) {
  const bindings = defaultKeybinds(presets);
  const byId = new Map(bindings.map((b) => [b.id, b]));
  let legacyRandomJumpKey = "";
  // The six per-container toggles became one. A library that saved keys for
  // them hands the first one (Untagged's, then Trash's, ...) to the new action,
  // unless it has a key saved for the new one already.
  const LEGACY_UTILITY_CONTAINER_IDS = [
    "toggleShowUntaggedFolder",
    "toggleShowTrashFolder",
    "toggleShowStorageFolder",
    "toggleShowAllTagsFolder",
    "toggleShowAllModelsFolder",
    "toggleShowAllSetsFolder",
  ];
  const legacyUtilityKeys = new Map();
  let utilityContainersKeySaved = false;
  const migrateIfKeyMatches = (id, legacyKey, nextKey) => {
    const binding = byId.get(id);
    if (!binding) return;
    if (normalizeKeyValue(binding.key || "") !== normalizeKeyValue(legacyKey))
      return;
    binding.key = normalizeKeyValue(nextKey || "");
  };
  if (log && Array.isArray(log.bindings)) {
    for (const entry of log.bindings) {
      const idRaw = entry && entry.id ? String(entry.id) : "";
      const id = idRaw;
      const key = normalizeKeyValue(entry.key || "");
      if (!id) continue;
      if (key && !isSafeKeybindValue(key)) continue;
      if (id === "randomJump") {
        legacyRandomJumpKey = key;
        continue;
      }
      if (LEGACY_UTILITY_CONTAINER_IDS.includes(id)) {
        legacyUtilityKeys.set(id, key);
        continue;
      }
      if (id === "toggleUtilityContainers") utilityContainersKeySaved = true;
      if (!byId.has(id)) continue;
      if (KEYBIND_LOCKED_IDS.has(id)) continue;
      byId.get(id).key = key;
    }
  }
  if (!utilityContainersKeySaved && legacyUtilityKeys.size) {
    const binding = byId.get("toggleUtilityContainers");
    const legacyKey = LEGACY_UTILITY_CONTAINER_IDS.map(
      (id) => legacyUtilityKeys.get(id) || "",
    ).find(Boolean);
    if (binding) binding.key = legacyKey || "";
  }
  if (legacyRandomJumpKey) {
    const firstJumpBinding = byId.get("randomFirstFileJump");
    if (firstJumpBinding && !normalizeKeyValue(firstJumpBinding.key || "")) {
      firstJumpBinding.key = legacyRandomJumpKey;
    }
  }
  // v8: Do not migrate saved Quick navigation bindings onto retired pane actions.
  // selectLeft/selectRight restored (v1.6.0 layout); leaveDir/enterDir
  // moved back to q/e — undo the earlier migration that sent them to a/d.
  migrateIfKeyMatches("leaveDir", "a", "q");
  migrateIfKeyMatches("enterDir", "d", "e");
  migrateIfKeyMatches("selectLeft", "", "a");
  migrateIfKeyMatches("selectRight", "", "d");
  migrateIfKeyMatches("randomFirstFileJump", "x", "r");
  // App menu is Tab (was F); free f and drop legacy cycleFilter f binds.
  migrateIfKeyMatches("cycleFilter", "Command+f", "");
  migrateIfKeyMatches("cycleFilter", "Command+x", "");
  migrateIfKeyMatches("cycleFilter", "f", "");
  migrateIfKeyMatches("slideshow", "v", "v");
  migrateIfKeyMatches("slideshow", "Command+Shift+x", "v");
  migrateIfKeyMatches("seekBack", "Command+q", "z");
  migrateIfKeyMatches("seekBack", "q", "z");
  migrateIfKeyMatches("seekForward", "Command+e", "c");
  migrateIfKeyMatches("seekForward", "e", "c");
  migrateIfKeyMatches("playPause", "Space", "x");
  // Settings pane is gone; clear any leftover binding for the retired action.
  migrateIfKeyMatches("toggleSettingsAndDirectoriesPanes", "Space", "");
  migrateIfKeyMatches("toggleSettingsAndDirectoriesPanes", "Cmd+,", "");
  migrateIfKeyMatches("toggleSettingsAndDirectoriesPanes", "Tab", "");
  migrateIfKeyMatches("toggleAnimatedFilters", "5", "Command+i");
  migrateIfKeyMatches("toggleAnimatedFilters", "6", "Command+i");
  migrateIfKeyMatches("favoriteSelection", "Ctrl+f", "Cmd+f");
  migrateIfKeyMatches("favoriteSelection", "f", "Cmd+f");
  applyFixedKeybinds(bindings);
  enforceUniqueKeybinds(bindings, KEYBIND_LOCKED_IDS);
  return { bindings };
}

function syncPaneKeybindBindingsWithCurrentActions(markDirty = false) {
  if (!WS || !WS.meta) return defaultKeybinds(defaultAppearancePresets());
  const bindings = defaultKeybinds(WS.meta.appearancePresets);
  const current = Array.isArray(WS.meta.keybinds) ? WS.meta.keybinds : [];
  const currentById = new Map(
    current.map((binding) => [String((binding && binding.id) || ""), binding]),
  );
  let changed = current.length !== bindings.length;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    const existing = currentById.get(binding.id);
    if (!existing) {
      changed = true;
      continue;
    }
    binding.key = normalizeKeyValue(existing.key || "");
    if (
      String(existing.label || "") !== String(binding.label || "") ||
      String(existing.hint || "") !== String(binding.hint || "") ||
      String(existing.section || "") !== String(binding.section || "")
    ) {
      changed = true;
    }
  }
  applyFixedKeybinds(bindings);
  enforceUniqueKeybinds(bindings, KEYBIND_LOCKED_IDS);
  WS.meta.keybinds = bindings;
  if (changed && markDirty) {
    metaMarkDirty(META_DOC_IDS.keybinds);
  }
  return bindings;
}

function normalizeGridKeybinds(log) {
  const bindings = defaultGridKeybinds();
  const byId = new Map(bindings.map((b) => [b.id, b]));
  if (log && Array.isArray(log.gridBindings)) {
    for (const entry of log.gridBindings) {
      const id = entry && entry.id ? String(entry.id) : "";
      if (!id || !byId.has(id)) continue;
      const key = normalizeKeyValue(entry.key || "");
      if (key && !isSafeKeybindValue(key)) continue;
      byId.get(id).key = key;
    }
  }
  const legacyGridDefaults = {
    gridMoveUp: "w",
    gridMoveDown: "s",
  };
  Object.entries(legacyGridDefaults).forEach(([id, legacyKey]) => {
    const binding = byId.get(id);
    if (!binding) return;
    if (normalizeKeyValue(binding.key || "") === normalizeKeyValue(legacyKey)) {
      binding.key = "";
    }
  });
  const migrateIfKeyMatches = (id, legacyKey, nextKey) => {
    const binding = byId.get(id);
    if (!binding) return;
    if (normalizeKeyValue(binding.key || "") !== normalizeKeyValue(legacyKey))
      return;
    binding.key = normalizeKeyValue(nextKey || "");
  };
  migrateIfKeyMatches("gridOpenSelection", "e", "d");
  enforceUniqueKeybinds(bindings);
  return { bindings };
}

const KEYBIND_INDEX = new Map();
const GRID_KEYBIND_INDEX = new Map();

function rebuildKeybindIndex() {
  KEYBIND_INDEX.clear();
  const bindings =
    WS.meta && Array.isArray(WS.meta.keybinds)
      ? syncPaneKeybindBindingsWithCurrentActions(false)
      : defaultKeybinds(WS.meta && WS.meta.appearancePresets);
  for (const binding of bindings) {
    const key = normalizeKeyValue(binding.key);
    if (!key || KEYBIND_INDEX.has(key)) continue;
    KEYBIND_INDEX.set(key, binding.id);
  }
  GRID_KEYBIND_INDEX.clear();
  const gridBindings =
    WS.meta && Array.isArray(WS.meta.gridKeybinds)
      ? WS.meta.gridKeybinds
      : defaultGridKeybinds();
  enforceUniqueKeybinds(gridBindings);
  for (const binding of gridBindings) {
    const key = normalizeKeyValue(binding.key);
    if (!key || GRID_KEYBIND_INDEX.has(key)) continue;
    GRID_KEYBIND_INDEX.set(key, binding.id);
  }
}

function keybindActionFor(key) {
  const action = KEYBIND_INDEX.get(key) || null;
  return appItemMenuActionKeybindIsDisabled(action) ? null : action;
}

function gridKeybindActionFor(key) {
  return GRID_KEYBIND_INDEX.get(key) || null;
}
