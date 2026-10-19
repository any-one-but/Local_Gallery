/* Appearance presets
   Saved filter presets: creating, renaming, applying and deleting them. */

function normalizeAppearancePresetIdValue(value) {
  return String(value || "").trim() || "";
}

function normalizeAppearancePresetName(name, fallback = "Preset") {
  const text = String(name || "")
    .replace(/\s+/g, " ")
    .trim();
  return text || fallback;
}

function normalizeAppearancePresetValues(values) {
  const normalized = normalizeOptions(Object.assign({}, values || {}));
  const out = {};
  for (let i = 0; i < APPEARANCE_SLIDER_OPTION_KEYS.length; i++) {
    const key = APPEARANCE_SLIDER_OPTION_KEYS[i];
    out[key] = normalized[key] == null ? null : normalized[key];
  }
  return out;
}

function cloneAppearancePreset(preset) {
  const src = preset && typeof preset === "object" ? preset : {};
  return {
    id: normalizeAppearancePresetIdValue(src.id),
    name: normalizeAppearancePresetName(src.name),
    locked: !!src.locked,
    values: normalizeAppearancePresetValues(src.values || {}),
  };
}

function defaultAppearancePresets() {
  return DEFAULT_APPEARANCE_PRESETS.map((preset) =>
    cloneAppearancePreset(preset),
  );
}

function normalizeAppearancePresetList(rawList, useDefaultsIfMissing = true) {
  const source = Array.isArray(rawList)
    ? rawList
    : useDefaultsIfMissing
      ? defaultAppearancePresets()
      : [];
  const out = [];
  const seenIds = new Set();
  const seenNames = new Set();
  const pushPreset = (preset, fallbackName = "Preset") => {
    const cloned = cloneAppearancePreset(preset);
    let id = normalizeAppearancePresetIdValue(cloned.id);
    if (!id)
      id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (seenIds.has(id)) return;
    let name = normalizeAppearancePresetName(cloned.name, fallbackName);
    let suffix = 2;
    let uniqueName = name;
    while (seenNames.has(uniqueName.toLowerCase())) {
      uniqueName = `${name} ${suffix++}`;
    }
    cloned.id = id;
    cloned.name = uniqueName;
    seenIds.add(id);
    seenNames.add(uniqueName.toLowerCase());
    out.push(cloned);
  };
  let sawDefault = false;
  for (let i = 0; i < source.length; i++) {
    const preset = source[i];
    const id = normalizeAppearancePresetIdValue(preset && preset.id);
    if (id === BUILTIN_NULL_APPEARANCE_PRESET_ID) {
      sawDefault = true;
      pushPreset(
        Object.assign({}, preset, {
          id: BUILTIN_NULL_APPEARANCE_PRESET_ID,
          name: "Default",
          locked: true,
        }),
      );
      continue;
    }
    if (id.startsWith("builtin-")) {
      continue;
    }
    pushPreset(preset, `Preset ${out.length + 1}`);
  }
  if (!sawDefault) {
    pushPreset(DEFAULT_APPEARANCE_PRESETS[0], "Default");
  }
  out.sort((a, b) => {
    if (a.id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return -1;
    if (b.id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""), undefined, {
      sensitivity: "base",
    });
  });
  return out;
}

function currentAppearanceValuesFromOptions(opt = null) {
  const source = opt || (WS.meta && WS.meta.options ? WS.meta.options : null);
  const out = {};
  const normalized = source ? normalizeOptions(source) : normalizeOptions(null);
  for (let i = 0; i < APPEARANCE_SLIDER_OPTION_KEYS.length; i++) {
    const key = APPEARANCE_SLIDER_OPTION_KEYS[i];
    out[key] = normalized[key] == null ? null : normalized[key];
  }
  return out;
}

function appearanceValuesEqual(a, b) {
  for (let i = 0; i < APPEARANCE_SLIDER_OPTION_KEYS.length; i++) {
    const key = APPEARANCE_SLIDER_OPTION_KEYS[i];
    const av =
      a && Object.prototype.hasOwnProperty.call(a, key) ? a[key] : null;
    const bv =
      b && Object.prototype.hasOwnProperty.call(b, key) ? b[key] : null;
    if (av == null && bv == null) continue;
    if (Number(av) !== Number(bv)) return false;
  }
  return true;
}

function getAppearancePresetById(id) {
  const presetId = normalizeAppearancePresetIdValue(id);
  if (!presetId || !WS.meta || !Array.isArray(WS.meta.appearancePresets))
    return null;
  for (let i = 0; i < WS.meta.appearancePresets.length; i++) {
    const preset = WS.meta.appearancePresets[i];
    if (normalizeAppearancePresetIdValue(preset && preset.id) === presetId)
      return preset;
  }
  return null;
}

function findAppearancePresetByName(name) {
  const normalizedName = normalizeAppearancePresetName(name, "").toLowerCase();
  if (!normalizedName || !WS.meta || !Array.isArray(WS.meta.appearancePresets))
    return null;
  for (let i = 0; i < WS.meta.appearancePresets.length; i++) {
    const preset = WS.meta.appearancePresets[i];
    if (
      normalizeAppearancePresetName(preset && preset.name, "").toLowerCase() ===
      normalizedName
    )
      return preset;
  }
  return null;
}

function effectiveActiveAppearancePresetId() {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const raw = normalizeAppearancePresetIdValue(
    opt && opt.activeAppearancePresetId,
  );
  if (!raw) return "";
  return getAppearancePresetById(raw) ? raw : "";
}

function buildOptionsWithAppearanceValues(
  values,
  activePresetId = null,
  baseOptions = null,
) {
  const base = Object.assign(
    {},
    baseOptions || (WS.meta && WS.meta.options ? WS.meta.options : {}),
  );
  const next = {};
  for (let i = 0; i < APPEARANCE_SLIDER_OPTION_KEYS.length; i++) {
    const key = APPEARANCE_SLIDER_OPTION_KEYS[i];
    next[key] =
      values && Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : null;
  }
  next.activeAppearancePresetId =
    normalizeAppearancePresetIdValue(activePresetId) || null;
  return normalizeOptions(Object.assign(base, next));
}

function syncActiveAppearancePresetSelection(options = null) {
  if (!WS.meta) return "";
  const opt = options || WS.meta.options || normalizeOptions(null);
  const values = currentAppearanceValuesFromOptions(opt);
  const presets = Array.isArray(WS.meta.appearancePresets)
    ? WS.meta.appearancePresets
    : [];
  const currentId = normalizeAppearancePresetIdValue(
    opt.activeAppearancePresetId,
  );
  const currentPreset = currentId ? getAppearancePresetById(currentId) : null;

  // Preserve the explicitly selected preset by ID when its values match.
  // Multiple presets can intentionally share identical slider values, and
  // selecting/deleting them must not collapse to whichever matching preset
  // happens to appear first in the sorted list.
  if (
    currentPreset &&
    currentPreset.values &&
    appearanceValuesEqual(values, currentPreset.values)
  ) {
    return currentId;
  }

  // Once the selected preset no longer matches the sliders, treat the state as
  // an edit of that preset rather than auto-selecting another same-valued preset.
  if (currentPreset) {
    opt.activeAppearancePresetId = null;
    return "";
  }

  opt.activeAppearancePresetId = null;
  return "";
}

function currentAppearanceBucket(options = null) {
  const rawActiveId = normalizeAppearancePresetIdValue(
    (options || (WS.meta && WS.meta.options) || {}).activeAppearancePresetId,
  );
  const activeId = getAppearancePresetById(rawActiveId) ? rawActiveId : "";
  if (activeId === BUILTIN_NULL_APPEARANCE_PRESET_ID) return "default";
  if (activeId) return "saved";
  return "editing";
}

function currentAppearanceEditingTargetId() {
  const promptMode = String((WS.view && WS.view.appearancePresetPromptMode) || "");
  if (promptMode === "rename" || promptMode === "delete") {
    const promptedId = normalizeAppearancePresetIdValue(
      WS.view && WS.view.appearancePresetEditingId,
    );
    if (promptedId && getAppearancePresetById(promptedId)) return promptedId;
  }
  const activeId = effectiveActiveAppearancePresetId();
  if (activeId) return activeId;
  const raw = normalizeAppearancePresetIdValue(
    WS.view && WS.view.appearancePresetEditingId,
  );
  if (raw && getAppearancePresetById(raw)) return raw;
  return BUILTIN_NULL_APPEARANCE_PRESET_ID;
}

function createAppearancePresetId() {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appearancePresetDisplayName(id, fallback = "Custom") {
  const preset = getAppearancePresetById(id);
  return preset ? String(preset.name || "") : fallback;
}

function currentAppearanceStatusLabel(options = null) {
  const bucket = currentAppearanceBucket(options);
  const activeId = effectiveActiveAppearancePresetId();
  if (bucket !== "editing")
    return appearancePresetDisplayName(activeId, "Default");
  const editingId = currentAppearanceEditingTargetId();
  return `${appearancePresetDisplayName(editingId, "Default")} (unsaved changes)`;
}

function buildAppearancePresetChoiceMenu(menuEl, options = {}) {
  if (!menuEl) return;
  const currentPresetId = normalizeAppearancePresetIdValue(
    options.currentPresetId,
  );
  const presets = Array.isArray(
    WS.meta && WS.meta.appearancePresets ? WS.meta.appearancePresets : null,
  )
    ? WS.meta.appearancePresets
    : defaultAppearancePresets();
  menuEl.innerHTML = "";
  const buttons = [];
  const appendButton = (label, onClick, disabled = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(label || "");
    btn.disabled = !!disabled;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      if (typeof onClick === "function") onClick();
    });
    buttons.push(btn);
    return btn;
  };
  if (typeof options.onBack === "function") {
    appendButton("Back", options.onBack);
  }
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const presetId = normalizeAppearancePresetIdValue(preset && preset.id);
    if (!presetId) continue;
    const label =
      presetId === currentPresetId
        ? `Current: ${String(preset.name || "Preset")}`
        : String(preset.name || "Preset");
    appendButton(label, () => {
      if (typeof options.onChoosePreset === "function")
        options.onChoosePreset(presetId);
    });
  }
  const panelItems =
    buttons.length > 10
      ? buttons.slice(0, 9).concat(createDropdownMenuSubmenu("More...", buttons.slice(9)))
      : buttons;
  panelItems.forEach((item) => menuEl.appendChild(item));
  if (typeof options.onRendered === "function") {
    requestAnimationFrame(() => options.onRendered());
  }
}

// Flyout submenu variant of the appearance-preset chooser, styled like the
// Thumbnail / Media type / Aspect ratio submenus. Returns a submenu element
// listing every preset with a ●/○ marker on the active one; picking one calls
// onChoosePreset. Used by the item context menus (folders, tags, and their bulk
// variants) so "Filters" behaves like the other dropdown filters.
function buildAppearancePresetSubmenu(options = {}) {
  const currentPresetId = normalizeAppearancePresetIdValue(
    options.currentPresetId,
  );
  const onChoosePreset =
    typeof options.onChoosePreset === "function"
      ? options.onChoosePreset
      : null;
  if (!onChoosePreset) return null;
  const onClear =
    typeof options.onClear === "function" ? options.onClear : null;
  // Whether the item carries its own preset override. When it does not, the
  // null "None" entry is the active one and the item simply follows the global
  // appearance.
  const hasOverride = !!options.hasOverride;
  const presets = Array.isArray(
    WS.meta && WS.meta.appearancePresets ? WS.meta.appearancePresets : null,
  )
    ? WS.meta.appearancePresets
    : defaultAppearancePresets();
  const buttons = [];
  const marker = (active) => (active ? "● " : "○ ");
  // Null option, always present and selected by default: clears any per-item
  // override so the item just uses the global appearance setting.
  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.textContent = `${marker(!hasOverride)}None`;
  noneBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (onClear) onClear();
    else onChoosePreset("");
  });
  buttons.push(noneBtn);
  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const presetId = normalizeAppearancePresetIdValue(preset && preset.id);
    if (!presetId) continue;
    const active = hasOverride && presetId === currentPresetId;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${marker(active)}${String(preset.name || "Preset")}`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onChoosePreset(presetId);
    });
    buttons.push(btn);
  }
  return createDropdownMenuSubmenu(String(options.label || "Filters"), buttons);
}

function effectiveAppearancePresetIdForMenuPath(path) {
  const normalized = normalizeDirPathValue(path);
  if (normalized === "" && WS.root) return effectiveActiveAppearancePresetId();
  return nearestFolderAppearancePresetIdForPath(normalized);
}

function updateAppearancePresetUiState() {
  const bucket = currentAppearanceBucket();
  const activeId = effectiveActiveAppearancePresetId();
  const uiTargetId =
    bucket === "editing"
      ? currentAppearanceEditingTargetId()
      : activeId || BUILTIN_NULL_APPEARANCE_PRESET_ID;
  if (bucket !== "editing" && WS.view) {
    WS.view.appearancePresetEditingId = uiTargetId;
  }
  const presetSelectEl = $("opt_generalAppearancePreset");
  if (presetSelectEl && presetSelectEl.value !== uiTargetId) {
    presetSelectEl.value = uiTargetId;
  }
}

function markAppearanceStateChanged(invalidateThumbs = true, options = null) {
  if (!WS.meta) return;
  syncActiveAppearancePresetSelection(WS.meta.options);
  metaMarkDirty(META_DOC_IDS.prefAppearance);
  setOptionsStatus("Saved");
  if (options && options.liveOnly) {
    applyMediaFilterFromOptions({ deferThumbSync: true });
    if (invalidateThumbs) {
      setTimeout(() => {
        kickVideoThumbsForPreview();
        kickImageThumbsForPreview();
      }, 160);
    }
  } else {
    applyOptionsEverywhere(!!invalidateThumbs);
  }
  updateAppearancePresetUiState();
}

function applyAppearancePresetById(presetId, options = {}) {
  // Nothing may write appearance values into the live options while the system
  // is off, so no stray surface can re-arm a filter.
  if (!APPEARANCE_FILTERS_ENABLED) return false;
  const id = normalizeAppearancePresetIdValue(presetId);
  const preset = getAppearancePresetById(id);
  if (!preset) return false;
  WS.meta.options = buildOptionsWithAppearanceValues(preset.values || {}, id);
  if (WS.view) {
    WS.view.appearancePresetEditingId = id;
    WS.view.appearancePresetPromptMode = "";
    WS.view.appearancePresetDraftName =
      id === BUILTIN_NULL_APPEARANCE_PRESET_ID ? "" : String(preset.name || "");
  }
  markAppearanceStateChanged(options.invalidateThumbs !== false, {
    liveOnly: options.liveOnly !== false,
  });
  if (
    options.refreshUi !== false &&
    MENU_OPEN &&
    (MENU_ACTIVE_TAB === "appearance" || MENU_ACTIVE_TAB === "general")
  ) {
    renderOptionsUi(MENU_ACTIVE_TAB);
  }
  return true;
}

function getAppearancePresetCycleList() {
  const source = Array.isArray(WS.meta && WS.meta.appearancePresets)
    ? WS.meta.appearancePresets
    : defaultAppearancePresets();
  return source
    .filter((preset) => normalizeAppearancePresetIdValue(preset && preset.id))
    .slice()
    .sort((a, b) => {
      const aId = normalizeAppearancePresetIdValue(a && a.id);
      const bId = normalizeAppearancePresetIdValue(b && b.id);
      const aIsDefault = aId === BUILTIN_NULL_APPEARANCE_PRESET_ID;
      const bIsDefault = bId === BUILTIN_NULL_APPEARANCE_PRESET_ID;
      if (aIsDefault || bIsDefault) {
        if (aIsDefault === bIsDefault) return 0;
        return aIsDefault ? -1 : 1;
      }
      return normalizeAppearancePresetName(a && a.name, "Preset").localeCompare(
        normalizeAppearancePresetName(b && b.name, "Preset"),
        undefined,
        { numeric: true, sensitivity: "base" },
      );
    });
}

function cycleAppearancePresetKeybindAction() {
  if (!WS.meta) return false;
  const presets = getAppearancePresetCycleList();
  if (!presets.length) return false;
  const activeId = effectiveActiveAppearancePresetId();
  const currentIndex = activeId
    ? presets.findIndex(
        (preset) =>
          normalizeAppearancePresetIdValue(preset && preset.id) === activeId,
      )
    : -1;
  const nextPreset =
    presets[(currentIndex + 1 + presets.length) % presets.length];
  const nextPresetId = normalizeAppearancePresetIdValue(
    nextPreset && nextPreset.id,
  );
  if (!nextPresetId || !applyAppearancePresetById(nextPresetId)) return false;
  showStatusMessage(
    `Appearance preset: ${appearancePresetDisplayName(nextPresetId, "Default")}`,
  );
  return true;
}

function saveAppearancePresetValues(name, values) {
  if (!WS.meta) return { ok: false, reason: "missing-meta" };
  const presetName = normalizeAppearancePresetName(name, "");
  if (!presetName) return { ok: false, reason: "missing-name" };
  if (presetName.toLowerCase() === "default")
    return { ok: false, reason: "reserved-name" };
  const normalizedValues = normalizeAppearancePresetValues(values || {});
  const existing = findAppearancePresetByName(presetName);
  let presetId = "";
  let replaced = false;
  if (
    existing &&
    normalizeAppearancePresetIdValue(existing.id) !==
      BUILTIN_NULL_APPEARANCE_PRESET_ID
  ) {
    presetId = normalizeAppearancePresetIdValue(existing.id);
    WS.meta.appearancePresets = (WS.meta.appearancePresets || []).map(
      (preset) => {
        if (normalizeAppearancePresetIdValue(preset && preset.id) !== presetId)
          return preset;
        return Object.assign({}, preset, {
          name: presetName,
          values: normalizedValues,
        });
      },
    );
    replaced = true;
  } else {
    presetId = createAppearancePresetId();
    WS.meta.appearancePresets = [].concat(WS.meta.appearancePresets || [], [
      {
        id: presetId,
        name: presetName,
        locked: false,
        values: normalizedValues,
      },
    ]);
  }
  WS.meta.appearancePresets = normalizeAppearancePresetList(
    WS.meta.appearancePresets,
    false,
  );
  syncPaneKeybindBindingsWithCurrentActions(false);
  rebuildKeybindIndex();
  if (MENU_OPEN && isKeybindMenuTab(MENU_ACTIVE_TAB)) renderKeybindsUi("pane");
  const savedPreset = findAppearancePresetByName(presetName);
  const nextId =
    normalizeAppearancePresetIdValue(savedPreset && savedPreset.id) || presetId;
  if (WS.meta.options) WS.meta.options.activeAppearancePresetId = nextId;
  if (WS.view) {
    WS.view.appearancePresetEditingId = nextId;
    WS.view.appearancePresetPromptMode = "";
    WS.view.appearancePresetDraftName = presetName;
  }
  metaMarkDirty(
    META_DOC_IDS.appearancePresets,
    META_DOC_IDS.keybinds,
    META_DOC_IDS.prefAppearance,
  );
  setOptionsStatus("Saved");
  applyOptionsEverywhere(true);
  updateAppearancePresetUiState();
  return {
    ok: true,
    replaced,
    preset: getAppearancePresetById(nextId),
  };
}

function saveAppearancePresetFromCurrent(name) {
  if (!WS.meta) return { ok: false, reason: "missing-meta" };
  return saveAppearancePresetValues(
    name,
    currentAppearanceValuesFromOptions(WS.meta.options),
  );
}

function nextNewAppearancePresetName() {
  const base = "New Filter";
  if (!findAppearancePresetByName(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const name = `${base} ${i}`;
    if (!findAppearancePresetByName(name)) return name;
  }
  return `${base} ${Date.now()}`;
}

function createAppearancePresetFromCurrent(name) {
  if (!WS.meta) return null;
  const presetName = normalizeAppearancePresetName(name, "Preset");
  const preset = {
    id: createAppearancePresetId(),
    name: presetName,
    locked: false,
    values: currentAppearanceValuesFromOptions(WS.meta.options),
  };
  WS.meta.appearancePresets = normalizeAppearancePresetList(
    [].concat(WS.meta.appearancePresets || [], [preset]),
    false,
  );
  syncPaneKeybindBindingsWithCurrentActions(false);
  rebuildKeybindIndex();
  if (WS.view) WS.view.appearancePresetEditingId = preset.id;
  if (WS.meta.options) WS.meta.options.activeAppearancePresetId = preset.id;
  metaMarkDirty(
    META_DOC_IDS.appearancePresets,
    META_DOC_IDS.keybinds,
    META_DOC_IDS.prefAppearance,
  );
  setOptionsStatus("Saved");
  return getAppearancePresetById(preset.id);
}

function updateAppearancePresetFromCurrent(presetId) {
  const id = normalizeAppearancePresetIdValue(presetId);
  if (!id || id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return false;
  const presets = Array.isArray(
    WS.meta && WS.meta.appearancePresets ? WS.meta.appearancePresets : null,
  )
    ? WS.meta.appearancePresets
    : [];
  let changed = false;
  WS.meta.appearancePresets = presets.map((preset) => {
    if (normalizeAppearancePresetIdValue(preset && preset.id) !== id)
      return preset;
    changed = true;
    return Object.assign({}, preset, {
      values: currentAppearanceValuesFromOptions(WS.meta.options),
    });
  });
  if (!changed) return false;
  if (WS.meta.options) WS.meta.options.activeAppearancePresetId = id;
  if (WS.view) WS.view.appearancePresetEditingId = id;
  if (WS.view)
    WS.view.appearancePresetDraftName = String(
      (getAppearancePresetById(id) || {}).name || "",
    );
  metaMarkDirty(META_DOC_IDS.appearancePresets, META_DOC_IDS.prefAppearance);
  setOptionsStatus("Saved");
  return true;
}

function renameAppearancePresetById(presetId, nextName) {
  const id = normalizeAppearancePresetIdValue(presetId);
  if (!id || id === BUILTIN_NULL_APPEARANCE_PRESET_ID || !WS.meta)
    return { ok: false, reason: "invalid-preset" };
  const normalizedName = normalizeAppearancePresetName(nextName, "");
  if (!normalizedName) return { ok: false, reason: "missing-name" };
  if (normalizedName.toLowerCase() === "default")
    return { ok: false, reason: "reserved-name" };
  const existingPresets = Array.isArray(WS.meta.appearancePresets)
    ? WS.meta.appearancePresets
    : [];
  const duplicate = existingPresets.find((preset) => {
    const presetIdValue = normalizeAppearancePresetIdValue(preset && preset.id);
    if (!presetIdValue || presetIdValue === id) return false;
    return (
      normalizeAppearancePresetName(preset && preset.name, "").toLowerCase() ===
      normalizedName.toLowerCase()
    );
  });
  if (duplicate) return { ok: false, reason: "duplicate-name", duplicate };

  let changed = false;
  WS.meta.appearancePresets = existingPresets.map((preset) => {
    if (normalizeAppearancePresetIdValue(preset && preset.id) !== id)
      return preset;
    if (String(preset.name || "") === normalizedName) return preset;
    changed = true;
    return Object.assign({}, preset, { name: normalizedName });
  });
  if (!changed) return { ok: false, reason: "unchanged" };

  WS.meta.appearancePresets = normalizeAppearancePresetList(
    WS.meta.appearancePresets,
    false,
  );
  const renamedPreset = getAppearancePresetById(id);
  if (WS.meta.options) WS.meta.options.activeAppearancePresetId = id;
  if (WS.view) {
    WS.view.appearancePresetEditingId = id;
    WS.view.appearancePresetPromptMode = "";
    WS.view.appearancePresetDraftName = renamedPreset
      ? String(renamedPreset.name || normalizedName)
      : normalizedName;
  }
  syncPaneKeybindBindingsWithCurrentActions(false);
  rebuildKeybindIndex();
  if (MENU_OPEN && isKeybindMenuTab(MENU_ACTIVE_TAB)) renderKeybindsUi("pane");
  metaMarkDirty(
    META_DOC_IDS.appearancePresets,
    META_DOC_IDS.keybinds,
    META_DOC_IDS.prefAppearance,
  );
  setOptionsStatus("Saved");
  return { ok: true, preset: renamedPreset || getAppearancePresetById(id) };
}

function clearDeletedAppearancePresetReferences(presetId) {
  const id = normalizeAppearancePresetIdValue(presetId);
  if (!id || !WS.meta) return false;
  let changed = false;
  if (WS.meta.dirAppearancePresetIds) {
    for (const [path, assignedId] of Array.from(
      WS.meta.dirAppearancePresetIds.entries(),
    )) {
      if (normalizeAppearancePresetIdValue(assignedId) !== id) continue;
      WS.meta.dirAppearancePresetIds.delete(path);
      changed = true;
    }
  }
  if (WS.meta.tagAppearancePresetIds) {
    for (const [tagKey, assignedId] of Array.from(
      WS.meta.tagAppearancePresetIds.entries(),
    )) {
      if (normalizeAppearancePresetIdValue(assignedId) !== id) continue;
      WS.meta.tagAppearancePresetIds.delete(tagKey);
      changed = true;
    }
  }
  if (
    WS.meta.options &&
    normalizeAppearancePresetIdValue(
      WS.meta.options.activeAppearancePresetId,
    ) === id
  ) {
    WS.meta.options.activeAppearancePresetId = null;
    changed = true;
  }
  return changed;
}

function deleteAppearancePresetById(presetId) {
  const id = normalizeAppearancePresetIdValue(presetId);
  if (!id || id === BUILTIN_NULL_APPEARANCE_PRESET_ID || !WS.meta) return false;
  const before = Array.isArray(WS.meta.appearancePresets)
    ? WS.meta.appearancePresets.length
    : 0;
  WS.meta.appearancePresets = (WS.meta.appearancePresets || []).filter(
    (preset) => normalizeAppearancePresetIdValue(preset && preset.id) !== id,
  );
  if (WS.meta.appearancePresets.length === before) return false;
  clearDeletedAppearancePresetReferences(id);
  syncActiveAppearancePresetSelection(WS.meta.options);
  if (
    WS.view &&
    normalizeAppearancePresetIdValue(WS.view.appearancePresetEditingId) === id
  ) {
    WS.view.appearancePresetEditingId =
      effectiveActiveAppearancePresetId() || BUILTIN_NULL_APPEARANCE_PRESET_ID;
  }
  if (WS.view) {
    WS.view.appearancePresetPromptMode = "";
    if (
      normalizeAppearancePresetIdValue(WS.view.appearancePresetEditingId) ===
      BUILTIN_NULL_APPEARANCE_PRESET_ID
    ) {
      WS.view.appearancePresetDraftName = "";
    }
  }
  syncPaneKeybindBindingsWithCurrentActions(false);
  rebuildKeybindIndex();
  if (MENU_OPEN && isKeybindMenuTab(MENU_ACTIVE_TAB)) renderKeybindsUi("pane");
  metaMarkDirty(
    META_DOC_IDS.appearancePresets,
    META_DOC_IDS.appearanceAssignments,
    META_DOC_IDS.prefAppearance,
    META_DOC_IDS.keybinds,
  );
  setOptionsStatus("Saved");
  return true;
}
