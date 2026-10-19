/* App menu: filters and presets
   The filter sliders and preset rename/delete rows. */

// The controls shown in the app menu's Filters submenu. A missing
// value is presented as a neutral 0%, and keyboard edits always land on a 5%
// boundary even though the underlying options keep their native value ranges.
const FILTER_MENU_COLOR_CONTROLS = Object.freeze([
  {
    label: "Brightness",
    key: "brightnessOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.brightness,
    neutral: 0,
  },
  {
    label: "Contrast",
    key: "contrastOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.contrast,
    neutral: 0,
  },
  {
    label: "Saturation",
    key: "saturationOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.saturation,
    neutral: 0,
  },
  {
    label: "Temperature",
    key: "warmthOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.warmth,
    neutral: 0,
  },
  {
    label: "Hue shift",
    key: "hueShiftOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.hueShift,
    neutral: 0,
  },
  {
    label: "Black crush",
    key: "blackCrushOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.blackCrush,
    neutral: 0,
  },
  {
    label: "White crush",
    key: "whiteCrushOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.whiteCrush,
    neutral: 0,
  },
  {
    label: "Color crush",
    key: "colorCrushOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.colorCrush,
    neutral: 0,
  },
]);

const FILTER_MENU_EFFECT_CONTROLS = Object.freeze([
  {
    label: "Pixelation",
    key: "pixelateOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.pixelate,
    neutral: OVERLAY_SLIDER_LIMITS.pixelate.min,
  },
  {
    label: "Blur",
    key: "blurOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.blur,
    neutral: 0,
  },
  {
    label: "Chromatic aberration",
    key: "chromaOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.chroma,
    neutral: 0,
  },
  {
    label: "Grain",
    key: "grainOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.grain,
    neutral: 0,
  },
  {
    label: "Vignette",
    key: "vignetteOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.vignette,
    neutral: 0,
  },
  {
    label: "Film corners",
    key: "filmCornerOverlayIntensity",
    limits: OVERLAY_SLIDER_LIMITS.filmCorner,
    neutral: 0,
  },
]);

function filterMenuControlPercent(control, value) {
  if (!control || value == null || value === "") return 0;
  const limits = control.limits || { min: 0, max: 1 };
  const min = Number(limits.min);
  const max = Number(limits.max);
  const neutral = Number(control.neutral);
  const raw = Math.min(max, Math.max(min, Number(value) || 0));
  if (raw >= neutral) {
    return ((raw - neutral) / Math.max(0.000001, max - neutral)) * 100;
  }
  return -((neutral - raw) / Math.max(0.000001, neutral - min)) * 100;
}

function filterMenuControlValueForPercent(control, percent) {
  const limits = control?.limits || { min: 0, max: 1 };
  const min = Number(limits.min);
  const max = Number(limits.max);
  const neutral = Number(control?.neutral);
  const minPercent = neutral > min ? -100 : 0;
  const roundedPercent = Math.round((Number(percent) || 0) / 5) * 5;
  const nextPercent = Math.min(100, Math.max(minPercent, roundedPercent));
  if (Math.abs(nextPercent) < 0.000001) return null;
  const raw =
    nextPercent > 0
      ? neutral + ((max - neutral) * nextPercent) / 100
      : neutral + ((neutral - min) * nextPercent) / 100;
  return Number(Math.min(max, Math.max(min, raw)).toFixed(6));
}

function filterMenuControlLabel(control) {
  const value = WS.meta?.options?.[control.key];
  const percent =
    value == null || value === ""
      ? 0
      : Math.round(filterMenuControlPercent(control, value) / 5) * 5;
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function setFilterMenuControlPercent(control, percent) {
  if (!WS.meta || !control?.key) return false;
  const editingTargetId = currentAppMenuAppearancePresetId();
  const nextValue = filterMenuControlValueForPercent(control, percent);
  WS.meta.options = normalizeOptions(
    Object.assign({}, WS.meta.options || {}, { [control.key]: nextValue }),
  );
  metaMarkDirty(...metaPreferenceDocIdsForOptionKeys([control.key]));
  setOptionsStatus("Saved");
  applyMediaFilterFromOptions({ deferThumbSync: true });
  syncActiveAppearancePresetSelection(WS.meta.options);
  const editingTarget = getAppearancePresetById(editingTargetId);
  if (
    editingTarget &&
    !effectiveActiveAppearancePresetId() &&
    appearanceValuesEqual(
      currentAppearanceValuesFromOptions(WS.meta.options),
      editingTarget.values || {},
    )
  ) {
    WS.meta.options.activeAppearancePresetId = editingTargetId;
    if (WS.view) WS.view.appearancePresetEditingId = editingTargetId;
  }
  updateAppearancePresetUiState();
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(
    `${control.label}: ${filterMenuControlLabel(control)}`,
    "appearance-filter",
  );
  return true;
}

function adjustFilterMenuControl(control, direction) {
  const current = filterMenuControlPercent(
    control,
    WS.meta?.options?.[control.key],
  );
  return setFilterMenuControlPercent(
    control,
    Math.round(current / 5) * 5 + (direction < 0 ? -5 : 5),
  );
}

function currentAppMenuAppearancePresetId() {
  return (
    effectiveActiveAppearancePresetId() || currentAppearanceEditingTargetId()
  );
}

function appMenuAppearancePresetHasUnsavedChanges(presetId = null) {
  const id =
    normalizeAppearancePresetIdValue(presetId) ||
    currentAppMenuAppearancePresetId();
  const preset = getAppearancePresetById(id);
  if (!preset) return false;
  return !appearanceValuesEqual(
    currentAppearanceValuesFromOptions(WS.meta?.options),
    preset.values || {},
  );
}

function updateCurrentAppMenuAppearancePreset() {
  const presetId = currentAppMenuAppearancePresetId();
  const preset = getAppearancePresetById(presetId);
  if (!preset || !updateAppearancePresetFromCurrent(presetId)) return false;
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(`Updated filter preset '${preset.name}'.`);
  return true;
}

function revertCurrentAppMenuAppearancePreset() {
  const presetId = currentAppMenuAppearancePresetId();
  const preset = getAppearancePresetById(presetId);
  if (!preset || !appMenuAppearancePresetHasUnsavedChanges(presetId))
    return false;
  if (!applyAppearancePresetById(presetId)) return false;
  APP_MENU_PRESET_RENAME_STATE = null;
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(`Reverted changes to filter preset '${preset.name}'.`);
  return true;
}

function startCurrentAppMenuPresetRename() {
  const presetId = currentAppMenuAppearancePresetId();
  const preset = getAppearancePresetById(presetId);
  if (!preset || presetId === BUILTIN_NULL_APPEARANCE_PRESET_ID) return false;
  APP_MENU_PRESET_RENAME_STATE = {
    id: presetId,
    draft: String(preset.name || ""),
  };
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
  return true;
}

function cancelAppMenuPresetRename(keyState = null) {
  APP_MENU_PRESET_RENAME_STATE = null;
  refreshAppMenuContents(
    keyState || captureNumberedMenuKeyState(appActionMenuEl),
  );
}

function commitAppMenuPresetRename(keyState = null) {
  const state = APP_MENU_PRESET_RENAME_STATE;
  if (!state) return false;
  const result = renameAppearancePresetById(state.id, state.draft);
  if (!result.ok) {
    if (result.reason === "missing-name")
      showStatusMessage("Enter a preset name first.");
    else if (result.reason === "reserved-name")
      showStatusMessage("'Default' is reserved.");
    else if (result.reason === "duplicate-name")
      showStatusMessage("Another preset already uses that name.");
    else if (result.reason === "unchanged") {
      cancelAppMenuPresetRename(keyState);
      return true;
    } else showStatusMessage("Preset was not renamed.");
    return false;
  }
  APP_MENU_PRESET_RENAME_STATE = null;
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(
    `Renamed filter preset to '${result.preset?.name || "Preset"}'.`,
  );
  refreshAppMenuContents(
    keyState || captureNumberedMenuKeyState(appActionMenuEl),
  );
  return true;
}

function deleteCurrentAppMenuAppearancePreset() {
  const presetId = currentAppMenuAppearancePresetId();
  const preset = getAppearancePresetById(presetId);
  if (!preset || presetId === BUILTIN_NULL_APPEARANCE_PRESET_ID) return false;
  if (APP_MENU_PRESET_DELETE_CONFIRM_ID !== presetId) {
    APP_MENU_PRESET_DELETE_CONFIRM_ID = presetId;
    showStatusMessage("Select Confirm delete to remove this preset.");
    return true;
  }
  const name = String(preset.name || "Preset");
  if (!deleteAppearancePresetById(presetId)) return false;
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
  APP_MENU_PRESET_RENAME_STATE = null;
  applyOptionsEverywhere(true);
  showStatusMessage(`Deleted filter preset '${name}'.`);
  return true;
}

function createAppMenuAppearancePreset() {
  const preset = createAppearancePresetFromCurrent(
    nextNewAppearancePresetName(),
  );
  if (!preset) return false;
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
  refreshLiveSettingsPaneFromKeyboardAction();
  showStatusMessage(`Created filter preset '${preset.name}'.`);
  return true;
}

function buildAppMenuPresetRenameRow(presetId) {
  const state = APP_MENU_PRESET_RENAME_STATE;
  if (!state || state.id !== presetId) return null;
  const preset = getAppearancePresetById(presetId);
  if (!preset) return null;
  const row = document.createElement("div");
  row.className = "appMenuPresetRenameRow";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "appMenuPresetRenameInput";
  input.value = String(state.draft || preset.name || "");
  input.setAttribute("aria-label", `Rename ${preset.name || "preset"}`);
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("input", () => {
    if (APP_MENU_PRESET_RENAME_STATE?.id === presetId)
      APP_MENU_PRESET_RENAME_STATE.draft = input.value;
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      commitAppMenuPresetRename(captureNumberedMenuKeyState(appActionMenuEl));
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelAppMenuPresetRename(captureNumberedMenuKeyState(appActionMenuEl));
    }
  });
  const hint = document.createElement("div");
  hint.className = "appMenuPresetRenameHint";
  hint.textContent = "Enter saves · Esc cancels";
  row.append(input, hint);
  return row;
}

function focusAppMenuPresetRenameInput() {
  if (!APP_MENU_PRESET_RENAME_STATE) return;
  requestAnimationFrame(() => {
    const input = appActionMenuEl?.querySelector?.(
      ".dropdownMenuSubmenu.submenuOpen .appMenuPresetRenameInput",
    );
    if (!input || document.activeElement === input) return;
    try {
      input.focus();
      input.select();
    } catch {}
  });
}

function buildAppMenuPresetHybridSubmenu(options = null) {
  const presetId = currentAppMenuAppearancePresetId();
  const hasUnsavedChanges =
    appMenuAppearancePresetHasUnsavedChanges(presetId);
  const editable =
    !!getAppearancePresetById(presetId) &&
    presetId !== BUILTIN_NULL_APPEARANCE_PRESET_ID;
  const updateBtn =
    editable && hasUnsavedChanges
      ? appMenuChoiceButton("Update", updateCurrentAppMenuAppearancePreset)
      : null;
  const createBtn = hasUnsavedChanges
    ? appMenuChoiceButton("Create new preset", createAppMenuAppearancePreset)
    : null;
  const revertBtn = hasUnsavedChanges
    ? appMenuChoiceButton(
        "Revert changes",
        revertCurrentAppMenuAppearancePreset,
      )
    : null;
  const renameBtn = appMenuChoiceButton(
    "Rename",
    startCurrentAppMenuPresetRename,
  );
  const confirming = APP_MENU_PRESET_DELETE_CONFIRM_ID === presetId;
  const deleteBtn = appMenuChoiceButton(
    confirming ? "Confirm delete" : "Delete",
    deleteCurrentAppMenuAppearancePreset,
  );
  renameBtn.disabled = !editable;
  deleteBtn.disabled = !editable;
  if (updateBtn)
    updateBtn.dataset.menuStateKey = "appearance-preset-update";
  if (createBtn)
    createBtn.dataset.menuStateKey = "appearance-preset-create";
  if (revertBtn)
    revertBtn.dataset.menuStateKey = "appearance-preset-revert";
  renameBtn.dataset.menuStateKey = "appearance-preset-rename";
  deleteBtn.dataset.menuStateKey = "appearance-preset-delete";
  const renameRow = editable ? buildAppMenuPresetRenameRow(presetId) : null;
  return createDropdownMenuSubmenu(
    `Preset: ${currentAppearanceStatusLabel(options)}`,
    [renameRow, updateBtn, createBtn, revertBtn, renameBtn, deleteBtn],
    "",
    {
      stateKey: "appearance-preset",
      onActivate: () => {
        APP_MENU_PRESET_RENAME_STATE = null;
        APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
        return cycleAppearancePresetKeybindAction();
      },
    },
  );
}

function buildAppMenuFilterControlButton(control) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "appMenuFilterControl";
  btn.dataset.appMenuFilterControl = String(control.key || "");
  btn.dataset.menuStateKey = `appearance-filter:${control.key}`;
  btn.setAttribute("data-action", "keep");
  btn.setAttribute(
    "aria-label",
    `${control.label}: ${filterMenuControlLabel(control)}`,
  );
  const label = document.createElement("span");
  label.className = "appMenuFilterLabel";
  const iconKey = APP_MENU_FILTER_CONTROL_ICON_KEYS[control.label];
  if (iconKey) {
    label.innerHTML =
      `<span class="dropdownMenuSubmenuLabelWithIcon">` +
      appIconHtml(iconKey, "dropdownMenuItemTypeIcon") +
      `<span>${escapeHtml(control.label)}</span></span>`;
  } else {
    label.textContent = control.label;
  }
  const value = document.createElement("span");
  value.className = "appMenuFilterValue";
  value.textContent = filterMenuControlLabel(control);
  btn.append(label, value);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    suppressMenuAutoClose();
    APP_MENU_FILTER_EDIT_KEY = control.key;
    setMenuHighlight(appActionMenuEl, btn);
    applyAppMenuFilterEditVisuals();
  });
  return btn;
}

function applyAppMenuFilterEditVisuals() {
  const menu = appActionMenuEl;
  if (!menu) return;
  menu.querySelectorAll(".appMenuFilterEditing").forEach((btn) =>
    btn.classList.remove("appMenuFilterEditing"),
  );
  if (!APP_MENU_FILTER_EDIT_KEY) return;
  const btn = Array.from(
    menu.querySelectorAll("button[data-app-menu-filter-control]"),
  ).find(
    (candidate) =>
      candidate.dataset.appMenuFilterControl === APP_MENU_FILTER_EDIT_KEY,
  );
  if (btn) btn.classList.add("appMenuFilterEditing");
  else APP_MENU_FILTER_EDIT_KEY = "";
}

function stopAppMenuFilterEdit() {
  if (!APP_MENU_FILTER_EDIT_KEY) return false;
  APP_MENU_FILTER_EDIT_KEY = "";
  applyAppMenuFilterEditVisuals();
  return true;
}

function stepAppMenuFilterEdit(direction) {
  const control = FILTER_MENU_COLOR_CONTROLS.concat(
    FILTER_MENU_EFFECT_CONTROLS,
  ).find((candidate) => candidate.key === APP_MENU_FILTER_EDIT_KEY);
  if (!control) return false;
  const keyState = captureNumberedMenuKeyState(appActionMenuEl);
  suppressMenuAutoClose();
  if (!adjustFilterMenuControl(control, direction)) return false;
  refreshAppMenuContents(keyState);
  return true;
}

function ensureScoreHistoryDayMenuEl() {
  let menu = document.getElementById("scoreHistoryDayMenu");
  if (menu) return menu;
  menu = document.createElement("div");
  menu.id = "scoreHistoryDayMenu";
  menu.className = "dropdownMenu scoreHistoryDayMenu";
  document.body.appendChild(menu);
  return menu;
}
