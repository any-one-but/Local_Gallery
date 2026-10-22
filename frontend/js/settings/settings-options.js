/* Settings: options (retired pane)
   renderOptionsUi and its widgets. The pane is gone, so this returns at once;
   the definitions stay together here. */

let OPTIONS_SELECT_GLOBAL_BOUND = false;

function makeMenuToggleButtonHtml(id, checked) {
  const isOn = !!checked;
  return `
        <button
          type="button"
          id="${escapeHtml(id)}"
          class="appToggleBtn${isOn ? " isOn" : ""}"
          aria-pressed="${isOn ? "true" : "false"}">
          <span class="appToggleTrack" aria-hidden="true"><span class="appToggleThumb"></span></span>
        </button>
      `;
}

function setMenuToggleButtonState(btn, checked) {
  if (!btn) return;
  const isOn = !!checked;
  btn.classList.toggle("isOn", isOn);
  btn.setAttribute("aria-pressed", isOn ? "true" : "false");
}

function bindMenuToggleButton(id, onToggle) {
  const el = $(id);
  if (!el) return;
  const activate = () => {
    const next = el.getAttribute("aria-pressed") !== "true";
    setMenuToggleButtonState(el, next);
    if (typeof onToggle === "function") onToggle(next);
  };
  el.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    activate();
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      activate();
      return;
    }
    e.stopPropagation();
  });
}

function setOptionsSelectOpenState(rootEl, open) {
  if (!rootEl || !rootEl.querySelector) return;
  const trigger = rootEl.querySelector(".optSelectBtn");
  const menu = rootEl.querySelector(".optSelectMenu");
  if (!trigger || !menu) return;
  menu.classList.toggle("open", !!open);
  trigger.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) {
    const triggerRect = trigger.getBoundingClientRect();
    menu.style.width = "max-content";
    menu.style.minWidth = `${Math.ceil(triggerRect.width)}px`;
    menu.style.maxWidth = `${Math.max(160, window.innerWidth - 16)}px`;
    positionDropdownMenu(trigger, menu);
  } else {
    menu.style.removeProperty("width");
    menu.style.removeProperty("min-width");
    menu.style.removeProperty("max-width");
  }
}

function closeOpenOptionsSelectMenus(exceptId = "") {
  if (!optionsBodyEl) return;
  const keepId = String(exceptId || "");
  const roots = optionsBodyEl.querySelectorAll(
    ".optSelect[data-opt-select-id]",
  );
  roots.forEach((root) => {
    const id = String(root?.dataset?.optSelectId || "");
    if (keepId && id === keepId) return;
    setOptionsSelectOpenState(root, false);
  });
}

function ensureOptionsSelectGlobalBindings() {
  if (OPTIONS_SELECT_GLOBAL_BOUND) return;
  OPTIONS_SELECT_GLOBAL_BOUND = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target;
      if (target && target.closest && target.closest(".optSelect")) return;
      closeOpenOptionsSelectMenus();
    },
    true,
  );
}

// Collapsible menu sections. Open/collapsed state is keyed (e.g.
// "settings:thumbnails", "controls:navigation", "filters:advanced") and
// persisted in preferences so infrequently used groups stay tucked away
// across sessions.
function menuSectionCollapsed(key) {
  const opt = WS.meta && WS.meta.options ? WS.meta.options : null;
  const map = opt && opt.collapsedSections ? opt.collapsedSections : null;
  return !!(map && map[String(key || "")]);
}

function setMenuSectionCollapsed(key, collapsed) {
  if (!WS.meta || !key) return;
  const current =
    WS.meta.options && WS.meta.options.collapsedSections
      ? WS.meta.options.collapsedSections
      : {};
  const next = Object.assign({}, current);
  if (collapsed) next[String(key)] = true;
  else delete next[String(key)];
  WS.meta.options = normalizeOptions(
    Object.assign({}, WS.meta.options || {}, { collapsedSections: next }),
  );
  metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(["collapsedSections"]));
}

// Wire a clickable section heading to toggle (and persist) its collapsed state.
// Toggles the `.collapsed` class on the closest matching section container so
// the change is instant without a full menu re-render.
function bindCollapsibleSectionHeader(headerEl, key, sectionSelector) {
  if (!headerEl || !key) return;
  const section = headerEl.closest(sectionSelector);
  if (!section) return;
  const apply = (collapsed) => {
    section.classList.toggle("collapsed", !!collapsed);
    headerEl.setAttribute("aria-expanded", collapsed ? "false" : "true");
  };
  apply(menuSectionCollapsed(key));
  headerEl.setAttribute("role", "button");
  headerEl.setAttribute("tabindex", "0");
  const toggle = () => {
    const collapsed = !section.classList.contains("collapsed");
    apply(collapsed);
    setMenuSectionCollapsed(key, collapsed);
  };
  headerEl.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  headerEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      toggle();
    }
  });
}

function renderOptionsUi(sectionTab = MENU_ACTIVE_TAB) {
  if (!optionsBodyEl) return;
  const opt =
    WS.meta && WS.meta.options ? WS.meta.options : normalizeOptions(null);

  const makeSelectRow = (title, hint, id, value, items) => {
    const currentValue = String(value ?? "");
    const currentItem =
      items.find((it) => String(it.value) === currentValue) || null;
    const currentLabel = currentItem
      ? String(currentItem.label || "")
      : currentValue;
    const opts = items
      .map((it) => {
        const optionValue = String(it.value ?? "");
        const selected = optionValue === currentValue;
        return `<button type="button" data-opt-select-value="${escapeHtml(optionValue)}"${selected ? ` class="current"` : ""}>${escapeHtml(String(it.label || optionValue))}</button>`;
      })
      .join("");
    return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
            </div>
            <div class="optRight optSelectWrap">
              <input id="${escapeHtml(id)}" type="hidden" value="${escapeHtml(currentValue)}" />
              <div class="dirMenu optSelect" data-opt-select-id="${escapeHtml(id)}">
                <button type="button" class="dirMenuBtn optSelectBtn" data-opt-select-trigger="${escapeHtml(id)}" aria-haspopup="menu" aria-expanded="false">
                  <span class="optSelectBtnLabel">${escapeHtml(currentLabel || "Select")}</span>
                  <span class="optSelectChevron" aria-hidden="true">▾</span>
                </button>
                <div class="dropdownMenu optSelectMenu" data-opt-select-menu="${escapeHtml(id)}">
                  ${opts}
                </div>
              </div>
            </div>
          </div>
        `;
  };

  const makeCheckRow = (title, hint, id, checked) => {
    return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
            </div>
            <div class="optRight">
              ${makeMenuToggleButtonHtml(id, checked)}
            </div>
          </div>
        `;
  };

  const linkedPreviewOptionChecked = (kinds, field) => {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    const keys = list
      .map((kind) => thumbnailVisibilityPreviewOptionKey(kind, field))
      .filter(Boolean);
    return keys.length ? keys.every((key) => !!opt[key]) : false;
  };
  const thumbnailPreviewOptionKeysFor = (kinds, field) => {
    const list = Array.isArray(kinds) ? kinds : [kinds];
    return list
      .map((kind) => thumbnailVisibilityPreviewOptionKey(kind, field))
      .filter(Boolean);
  };
  const thumbnailInfoRows = (heading, kindOrKinds, fields) => {
    // Only the two fields the strip still renders; the info ones are forced
    // off in normalizeThumbnailVisibilityOptions and have no toggle.
    const fieldLabels = {
      title: "Title",
      menuButton: "Menu button",
    };
    const rows = fields
      .map((field) =>
        makeCheckRow(
          fieldLabels[field] || field,
          "",
          `opt_thumbInfo_${String(heading).toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${field}`,
          linkedPreviewOptionChecked(kindOrKinds, field),
        ),
      )
      .join("");
    return `
      <div class="settingsSubsectionTitle">${escapeHtml(heading)}</div>
      ${rows}
    `;
  };

  const makeRangeRow = (
    title,
    hint,
    id,
    value,
    min,
    max,
    step,
    displayValue,
  ) => {
    return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
            </div>
            <div class="optRight optRange">
              <input id="${escapeHtml(id)}" type="range" min="${min}" max="${max}" step="${step}" value="${escapeHtml(String(value))}" />
              <div class="optRangeValue" id="${escapeHtml(id)}_value">${escapeHtml(displayValue)}</div>
            </div>
          </div>
        `;
  };

  const makeActionRow = (title, hint, actionsHtml) => {
    return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
            </div>
            <div class="optRight optActions">
              ${actionsHtml}
            </div>
          </div>
        `;
  };

  const makeTextInputRow = (title, hint, id, value, placeholder = "") => {
    return `
          <div class="optRow">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(title)}</div>
            </div>
            <div class="optRight optActions">
              <input id="${escapeHtml(id)}" type="text" value="${escapeHtml(String(value || ""))}" placeholder="${escapeHtml(String(placeholder || ""))}" />
            </div>
          </div>
        `;
  };

  const optionStepperDownIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-big-down-icon lucide-arrow-big-down" aria-hidden="true"><path d="M9 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6a1 1 0 0 0 1 1h3.293a.707.707 0 0 1 .5 1.207l-7.086 7.086a1 1 0 0 1-1.414 0l-7.086-7.086a.707.707 0 0 1 .5-1.207H8a1 1 0 0 0 1-1z"/></svg>`;
  const optionStepperUpIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-arrow-big-up-icon lucide-arrow-big-up" aria-hidden="true"><path d="M9 19a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1v-6a1 1 0 0 1 1-1h3.293a.707.707 0 0 0 .5-1.207l-7.086-7.086a1 1 0 0 0-1.414 0l-7.086 7.086a.707.707 0 0 0 .5 1.207H8a1 1 0 0 1 1 1z"/></svg>`;
  const optionPlusIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus" aria-hidden="true"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`;

  const overlayScalePercentFromRaw = (value, limits, neutralValue) => {
    const min = Number(limits && limits.min);
    const max = Number(limits && limits.max);
    const raw = Number(value);
    const neutral = Number.isFinite(Number(neutralValue))
      ? Number(neutralValue)
      : min;
    if (!Number.isFinite(raw) || !Number.isFinite(min) || !Number.isFinite(max))
      return 0;
    if (raw >= neutral) {
      const span = Math.max(0.000001, max - neutral);
      return ((raw - neutral) / span) * 100;
    }
    const span = Math.max(0.000001, neutral - min);
    return -((neutral - raw) / span) * 100;
  };

  const formatOverlayScalePercent = (value, limits, neutralValue) => {
    const pct = overlayScalePercentFromRaw(value, limits, neutralValue);
    const rounded = Math.round(pct);
    return `${rounded > 0 ? "+" : ""}${rounded}%`;
  };

  const makeOverlayControlRow = (row) => {
    const neutralValue = Number.isFinite(Number(row.neutralValue))
      ? Number(row.neutralValue)
      : row.limits.min;
    const currentValue =
      row.nullable && row.value == null
        ? neutralValue
        : Number.isFinite(Number(row.value))
          ? Number(row.value)
          : neutralValue;
    const displayValue = row.formatter
      ? row.formatter(currentValue)
      : formatOverlayScalePercent(currentValue, row.limits, neutralValue);
    const minPct = Math.round(
      Math.min(
        overlayScalePercentFromRaw(row.limits.min, row.limits, neutralValue),
        overlayScalePercentFromRaw(row.limits.max, row.limits, neutralValue),
      ),
    );
    const maxPct = Math.round(
      Math.max(
        overlayScalePercentFromRaw(row.limits.min, row.limits, neutralValue),
        overlayScalePercentFromRaw(row.limits.max, row.limits, neutralValue),
      ),
    );
    const toggleHtml =
      row.showToggle === false
        ? `<div class="optOverlayToggleSpacer" aria-hidden="true"></div>`
        : `<input id="${escapeHtml(row.enabledId)}" type="checkbox"${opt[row.enabledKey] ? " checked" : ""} />`;
    const rowClass =
      row.showToggle === false
        ? "optRow optOverlayRow optOverlayRowNoToggle"
        : "optRow optOverlayRow";
    return `
          <div class="${rowClass}">
            <div class="optLeft">
              <div class="optTitle">${escapeHtml(row.title)}</div>
            </div>
            <div class="optOverlayMiddle optRange">
              <input id="${escapeHtml(row.rangeId)}" type="hidden" min="${row.limits.min}" max="${row.limits.max}" step="${row.limits.step}" data-stepper-min="${row.limits.min}" data-stepper-max="${row.limits.max}" data-stepper-neutral="${neutralValue}" data-stepper-percent-step="1" value="${escapeHtml(String(currentValue))}" />
              <div class="optStepper" data-opt-stepper="${escapeHtml(row.rangeId)}">
                <button type="button" class="optStepBtn optStepBtnDown" data-opt-stepper-for="${escapeHtml(row.rangeId)}" data-opt-stepper-delta="-1" aria-label="Decrease ${escapeHtml(row.title)} by 1 percent">${optionStepperDownIcon}</button>
                <input class="optRangeValue" id="${escapeHtml(row.rangeId)}_value" type="text" inputmode="decimal" value="${escapeHtml(displayValue)}" role="spinbutton" aria-label="${escapeHtml(row.title)} percent" aria-valuemin="${minPct}" aria-valuemax="${maxPct}" aria-valuenow="${escapeHtml(displayValue.replace(/%$/, ""))}" />
                <button type="button" class="optStepBtn optStepBtnUp" data-opt-stepper-for="${escapeHtml(row.rangeId)}" data-opt-stepper-delta="1" aria-label="Increase ${escapeHtml(row.title)} by 1 percent">${optionStepperUpIcon}</button>
              </div>
            </div>
            <div class="optRight optOverlayToggle">
              ${toggleHtml}
            </div>
          </div>
        `;
  };

  const scoreUiVisible = scoreInterfaceEnabled(opt);
  const dirSortModes = dirSortModeOptions(scoreUiVisible);

  const slideshowModes = [
    { value: "cycle", label: "Cycle speeds" },
    { value: "1", label: "Toggle 1s" },
    { value: "3", label: "Toggle 3s" },
    { value: "5", label: "Toggle 5s" },
    { value: "10", label: "Toggle 10s" },
  ];

  const videoAudioModes = [
    { value: "muted", label: "Muted" },
    { value: "unmuted", label: "Unmuted" },
  ];
  const thumbnailSizeModes = [
    { value: "small", label: "Small" },
    { value: "medium", label: "Medium" },
    { value: "large", label: "Large" },
  ];
  const videoSkipModes = [
    { value: "1", label: "1 second" },
    { value: "3", label: "3 seconds" },
    { value: "5", label: "5 seconds" },
    { value: "10", label: "10 seconds" },
    { value: "15", label: "15 seconds" },
    { value: "30", label: "30 seconds" },
  ];
  const videoEndModes = [
    { value: "loop", label: "Loop" },
    { value: "next", label: "Advance to next" },
    { value: "stop", label: "Stop" },
  ];
  const mediaFilterModes = [
    { value: "all", label: "All" },
    { value: "images", label: "Images" },
    { value: "videos", label: "Videos" },
    { value: "text", label: "Text" },
  ];
  const animatedFilterModes = [
    { value: "off", label: "Off" },
    { value: "on", label: "On" },
    { value: "videos", label: "Videos only" },
  ];
  const activeAppearancePresetId = effectiveActiveAppearancePresetId();
  const editingAppearancePresetId = (() => {
    return currentAppearanceEditingTargetId();
  })();
  if (WS.view) WS.view.appearancePresetEditingId = editingAppearancePresetId;
  const editingAppearancePreset = getAppearancePresetById(
    editingAppearancePresetId,
  );
  const appearancePresetPromptModeRaw = String(
    (WS.view && WS.view.appearancePresetPromptMode) || "",
  );
  const appearancePresetPromptMode =
    appearancePresetPromptModeRaw === "rename" ||
    appearancePresetPromptModeRaw === "delete"
      ? appearancePresetPromptModeRaw
      : "";
  const appearancePresetDraftName = (() => {
    const raw = String(
      WS.view && typeof WS.view.appearancePresetDraftName === "string"
        ? WS.view.appearancePresetDraftName
        : "",
    );
    if (raw) return raw;
    if (
      editingAppearancePreset &&
      editingAppearancePresetId !== BUILTIN_NULL_APPEARANCE_PRESET_ID
    )
      return String(editingAppearancePreset.name || "");
    return "";
  })();
  const appearancePresetSelectOptions = (
    Array.isArray(
      WS.meta && WS.meta.appearancePresets ? WS.meta.appearancePresets : null,
    )
      ? WS.meta.appearancePresets
      : defaultAppearancePresets()
  ).map((preset) => ({
    value: normalizeAppearancePresetIdValue(preset && preset.id),
    label: String(preset && preset.name ? preset.name : "Preset"),
  }));
  const appearancePresetList = Array.isArray(
    WS.meta && WS.meta.appearancePresets ? WS.meta.appearancePresets : null,
  )
    ? WS.meta.appearancePresets
    : defaultAppearancePresets();
  const buildFilterPresetManagerHtml = () => {
    const activePresetId =
      effectiveActiveAppearancePresetId() || BUILTIN_NULL_APPEARANCE_PRESET_ID;
    const rowsHtml = appearancePresetList
      .map((preset) => {
        const presetId = normalizeAppearancePresetIdValue(preset && preset.id);
        if (!presetId) return "";
        const presetName = normalizeAppearancePresetName(
          preset && preset.name,
          "Filter",
        );
        const isDefault = presetId === BUILTIN_NULL_APPEARANCE_PRESET_ID;
        const isActive = presetId === activePresetId;
        const isRename =
          appearancePresetPromptMode === "rename" &&
          editingAppearancePresetId === presetId;
        const isDelete =
          appearancePresetPromptMode === "delete" &&
          editingAppearancePresetId === presetId;
        if (isRename) {
          return `
            <div class="filterPresetRow" data-filter-preset-id="${escapeHtml(presetId)}">
              <input id="opt_appearancePresetPromptName" class="filterPresetName filterPresetRenameInput" type="text" value="${escapeHtml(appearancePresetDraftName || presetName)}" placeholder="Filter name" />
              <div class="filterPresetActions">
                <button type="button" id="opt_appearancePresetPromptConfirm">Save</button>
                <button type="button" id="opt_appearancePresetPromptCancel">Cancel</button>
              </div>
            </div>
          `;
        }
        if (isDelete) {
          return `
            <div class="filterPresetRow" data-filter-preset-id="${escapeHtml(presetId)}">
              <div class="filterPresetName${isActive ? " isActive" : ""}">Delete ${escapeHtml(presetName)}?</div>
              <div class="filterPresetActions">
                <button type="button" id="opt_appearancePresetDeleteConfirm">Delete</button>
                <button type="button" id="opt_appearancePresetPromptCancel">Cancel</button>
              </div>
            </div>
          `;
        }
        if (isDefault) {
          return `
          <div class="filterPresetRow" data-filter-preset-id="${escapeHtml(presetId)}">
            <div class="filterPresetName${isActive ? " isActive" : ""}">${escapeHtml(presetName)}</div>
          </div>
        `;
        }
        return `
          <div class="filterPresetRow" data-filter-preset-id="${escapeHtml(presetId)}">
            <button type="button" class="filterPresetName${isActive ? " isActive" : ""}" data-appearance-preset-apply="${escapeHtml(presetId)}">${escapeHtml(presetName)}</button>
            <div class="filterPresetActions">
              <button type="button" data-appearance-preset-update="${escapeHtml(presetId)}">Update</button>
              <button type="button" data-appearance-preset-rename="${escapeHtml(presetId)}">Rename</button>
              <button type="button" data-appearance-preset-delete="${escapeHtml(presetId)}">Delete</button>
            </div>
          </div>
        `;
      })
      .join("");
    return `
      <div class="filterPresetPanel">
        <div class="filterPresetHeader">
          <div class="filterPresetHeading">Filter presets</div>
          <button type="button" id="opt_appearancePreset_add" class="filterPresetAddBtn" aria-label="Create filter preset" title="Create filter preset">${optionPlusIcon}</button>
        </div>
        <div class="filterPresetList">
          ${rowsHtml}
        </div>
      </div>
    `;
  };
  const formatPixelateResolution = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${Number.isInteger(n) ? n : n.toFixed(1)}x`;
  };

  const formatPercentAmount = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${Math.round(n * 100)}%`;
  };

  const formatSignedPercentAmount = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    const pct = Math.round(n * 100);
    return `${pct > 0 ? "+" : ""}${pct}%`;
  };

  const formatDegreesAmount = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${n > 0 ? "+" : ""}${Math.round(n)}deg`;
  };

  const formatPixelOffset = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${Number(n.toFixed(2)).toString()}px`;
  };

  const formatGrainAmount = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return formatPercentAmount(n);
  };

  const formatUpscaleAmount = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return `${Math.round(n * 100)}%`;
  };
  const colorOverlayRows = [
    {
      title: "Brightness",
      hint: "Bias the image brighter or darker.",
      enabledId: "opt_brightnessOverlayEnabled",
      enabledKey: "brightnessOverlayEnabled",
      rangeId: "opt_brightnessOverlayIntensity",
      amountKey: "brightnessOverlayIntensity",
      value: opt.brightnessOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.brightness,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.brightness, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Contrast",
      hint: "Lift or flatten contrast.",
      enabledId: "opt_contrastOverlayEnabled",
      enabledKey: "contrastOverlayEnabled",
      rangeId: "opt_contrastOverlayIntensity",
      amountKey: "contrastOverlayIntensity",
      value: opt.contrastOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.contrast,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.contrast, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Saturation",
      hint: "Push or crush saturation in either direction.",
      enabledId: "opt_saturationOverlayEnabled",
      enabledKey: "saturationOverlayEnabled",
      rangeId: "opt_saturationOverlayIntensity",
      amountKey: "saturationOverlayIntensity",
      value: opt.saturationOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.saturation,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.saturation, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Temperature",
      hint: "Warmer yellow/red positive, cooler blue negative.",
      enabledId: "opt_warmthOverlayEnabled",
      enabledKey: "warmthOverlayEnabled",
      rangeId: "opt_warmthOverlayIntensity",
      amountKey: "warmthOverlayIntensity",
      value: opt.warmthOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.warmth,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.warmth, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Hue shift",
      hint: "Rotate hue across a broad bipolar range.",
      enabledId: "opt_hueShiftOverlayEnabled",
      enabledKey: "hueShiftOverlayEnabled",
      rangeId: "opt_hueShiftOverlayIntensity",
      amountKey: "hueShiftOverlayIntensity",
      value: opt.hueShiftOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.hueShift,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.hueShift, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Black crush",
      hint: "Clip and remap shadow detail.",
      enabledId: "opt_blackCrushOverlayEnabled",
      enabledKey: "blackCrushOverlayEnabled",
      rangeId: "opt_blackCrushOverlayIntensity",
      amountKey: "blackCrushOverlayIntensity",
      value: opt.blackCrushOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.blackCrush,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.blackCrush, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "White crush",
      hint: "Clip and remap highlights.",
      enabledId: "opt_whiteCrushOverlayEnabled",
      enabledKey: "whiteCrushOverlayEnabled",
      rangeId: "opt_whiteCrushOverlayIntensity",
      amountKey: "whiteCrushOverlayIntensity",
      value: opt.whiteCrushOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.whiteCrush,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.whiteCrush, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Color crush",
      hint: "Posterize colors into fewer steps.",
      enabledId: "opt_colorCrushOverlayEnabled",
      enabledKey: "colorCrushOverlayEnabled",
      rangeId: "opt_colorCrushOverlayIntensity",
      amountKey: "colorCrushOverlayIntensity",
      value: opt.colorCrushOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.colorCrush,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.colorCrush, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
  ];
  const effectOverlayRows = [
    {
      title: "Pixelation",
      hint: "Pixelate the processed image. Pixelation always happens before blur.",
      enabledId: "opt_pixelateOverlayEnabled",
      enabledKey: "pixelateOverlayEnabled",
      rangeId: "opt_pixelateOverlayIntensity",
      amountKey: "pixelateOverlayIntensity",
      value: opt.pixelateOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.pixelate,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.pixelate, OVERLAY_SLIDER_LIMITS.pixelate.min),
      showToggle: false,
      nullable: true,
      neutralValue: OVERLAY_SLIDER_LIMITS.pixelate.min,
    },
    {
      title: "Blur",
      hint: "Blur the image after pixelation so block edges soften instead of sharpen.",
      enabledId: "opt_blurOverlayEnabled",
      enabledKey: "blurOverlayEnabled",
      rangeId: "opt_blurOverlayIntensity",
      amountKey: "blurOverlayIntensity",
      value: opt.blurOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.blur,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.blur, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Chromatic aberration",
      hint: "Whole-image RGB channel separation across the entire frame.",
      enabledId: "opt_chromaOverlayEnabled",
      enabledKey: "chromaOverlayEnabled",
      rangeId: "opt_chromaOverlayIntensity",
      amountKey: "chromaOverlayIntensity",
      value: opt.chromaOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.chroma,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.chroma, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Grain",
      hint: "Noise/grain pass.",
      enabledId: "opt_grainOverlayEnabled",
      enabledKey: "grainOverlayEnabled",
      rangeId: "opt_grainOverlayIntensity",
      amountKey: "grainOverlayIntensity",
      value: opt.grainOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.grain,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.grain, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Vignette",
      hint: "Edge darkening.",
      enabledId: "opt_vignetteOverlayEnabled",
      enabledKey: "vignetteOverlayEnabled",
      rangeId: "opt_vignetteOverlayIntensity",
      amountKey: "vignetteOverlayIntensity",
      value: opt.vignetteOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.vignette,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.vignette, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
    {
      title: "Film corners",
      hint: "Rounded, old-film style corners.",
      enabledId: "opt_filmCornerOverlayEnabled",
      enabledKey: "filmCornerOverlayEnabled",
      rangeId: "opt_filmCornerOverlayIntensity",
      amountKey: "filmCornerOverlayIntensity",
      value: opt.filmCornerOverlayIntensity,
      limits: OVERLAY_SLIDER_LIMITS.filmCorner,
      formatter: (value) => formatOverlayScalePercent(value, OVERLAY_SLIDER_LIMITS.filmCorner, 0),
      showToggle: false,
      nullable: true,
      neutralValue: 0,
    },
  ];
  const buildOverlayRowsHtml = (rows) =>
    rows.map((row) => makeOverlayControlRow(row)).join("");

  const sections = {
    general: {
      title: "General",
      rows: `
${makeCheckRow("Quick navigation", "When opening a folder that only contains files, enter its media immediately.", "opt_quickNavigation", quickNavigationEnabled())}
${makeSelectRow("Thumbnail size", "How large media thumbnails are in the preview grid.", "opt_thumbnailSize", String(opt.thumbnailSize || "medium"), thumbnailSizeModes)}
${makeCheckRow("Disable messages", "Hide status and notification messages.", "opt_muteMessages", muteMessagesEnabled())}
${makeCheckRow("Float tags", "Insert a blank row separating tag, favorites, and album folders from regular folders in the preview grid.", "opt_showTagFolderSpacerRow", !!opt.showTagFolderSpacerRow)}
          `,
    },
    thumbnails: {
      title: "Thumbnails",
      rows: `

${makeCheckRow("Media thumbnails", "Paint media into folder, tag and file thumbnails. Off, no thumbnail loads any media at all and every item shows its type icon instead. Switching reloads the library.", "opt_mediaThumbnails", mediaThumbnailsEnabled(opt))}
${makeCheckRow("Full resolution","Paint thumbnails from 2048px generated copies. Off uses the lighter 512px pipeline. Switching reloads the library.", "opt_fullResThumbnails", fullResThumbnailsEnabled(opt))}
          `,
    },
    reveal: {
      title: "Reveal",
      rows: `
${makeCheckRow("Hidden items", "Show or hide items hidden by hidden tags.", "opt_showHiddenFolder", showHiddenFolderEnabled())}
${makeCheckRow("Trash folder", "Show or hide the Trash folder entry at root.", "opt_showTrashFolder", showTrashFolderEnabled())}
${makeCheckRow("Storage folder", "Show or hide the Storage folder entry.", "opt_showStorageFolder", showStorageFolderEnabled())}
${makeCheckRow("Untagged folder", "Show or hide the Untagged tag folder entry.", "opt_showUntaggedFolder", showUntaggedFolderEnabled())}
          `,
    },
    playback: {
      title: "Playback",
      rows: `
${makeSelectRow("Video skip step", "How far left/right seek jumps move videos.", "opt_videoSkipStep", String(opt.videoSkipStep || "5"), videoSkipModes)}
${makeSelectRow("Video end behavior", "What to do when a video reaches the end.", "opt_videoEndBehavior", String(opt.videoEndBehavior || "loop"), videoEndModes)}
          `,
    },
  };
  const requestedSection = sections[sectionTab] ? String(sectionTab) : "";
  const settingsSectionOrder = [
    "general",
    "thumbnails",
    "playback",
    "reveal",
  ];
  const settingsSectionsHtml = settingsSectionOrder
    .map((id) => {
      const section = sections[id];
      if (!section) return "";
      const collapsed = menuSectionCollapsed(`settings:${id}`);
      return `
        <section class="settingsSection${collapsed ? " collapsed" : ""}" data-settings-section="${escapeHtml(id)}">
          <h2 class="menuSectionToggle" data-collapse-key="settings:${escapeHtml(id)}">
            <span class="menuSectionToggleLabel">${escapeHtml(section.title)}</span>
            <span class="menuSectionChevron" aria-hidden="true">▾</span>
          </h2>
          ${section.rows}
        </section>
      `;
    })
    .join("");

  optionsBodyEl.innerHTML = settingsSectionsHtml;
  applyAppItemMenuOnlySettingsVisibility(optionsBodyEl);
  optionsBodyEl
    .querySelectorAll(".settingsSection > h2.menuSectionToggle")
    .forEach((headerEl) => {
      bindCollapsibleSectionHeader(
        headerEl,
        headerEl.getAttribute("data-collapse-key") || "",
        ".settingsSection",
      );
    });
  if (requestedSection && requestedSection !== "general") {
    requestAnimationFrame(() => {
      const target = optionsBodyEl.querySelector(
        `[data-settings-section="${cssEscapeValue(requestedSection)}"]`,
      );
      if (target && typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "start" });
      }
    });
  }
  applyDescriptionVisibilityFromOptions();
  ensureOptionsSelectGlobalBindings();

  const bindSelect = (id, key, invalidateThumbs, onChange, valueParser) => {
    const el = $(id);
    if (!el) return;
    const selectRoot = optionsBodyEl.querySelector(
      `.optSelect[data-opt-select-id="${id}"]`,
    );
    const trigger = selectRoot
      ? selectRoot.querySelector(".optSelectBtn")
      : null;
    const labelEl = trigger
      ? trigger.querySelector(".optSelectBtnLabel")
      : null;
    const menu = selectRoot ? selectRoot.querySelector(".optSelectMenu") : null;
    const optionButtons = menu
      ? Array.from(menu.querySelectorAll("button[data-opt-select-value]"))
      : [];
    const syncSelectUi = () => {
      const currentValue = String(el.value || "");
      let currentLabel = "";
      optionButtons.forEach((btn) => {
        const selected =
          String(btn?.dataset?.optSelectValue || "") === currentValue;
        btn.classList.toggle("current", selected);
        if (selected) currentLabel = String(btn.textContent || "");
      });
      if (!currentLabel && optionButtons.length)
        currentLabel = String(optionButtons[0].textContent || "");
      if (labelEl) labelEl.textContent = currentLabel || "Select";
    };
    if (selectRoot && trigger && menu) {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const opening = !menu.classList.contains("open");
        closeOpenOptionsSelectMenus(opening ? id : "");
        setOptionsSelectOpenState(selectRoot, opening);
      });
      trigger.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          setOptionsSelectOpenState(selectRoot, false);
        }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.addEventListener("keydown", (e) => e.stopPropagation());
      optionButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const nextValue = String(btn?.dataset?.optSelectValue || "");
          const prevValue = String(el.value || "");
          setOptionsSelectOpenState(selectRoot, false);
          if (nextValue === prevValue) {
            syncSelectUi();
            return;
          }
          el.value = nextValue;
          syncSelectUi();
          el.dispatchEvent(new Event("change"));
        });
      });
      syncSelectUi();
    }
    el.addEventListener("change", () => {
      const next = {};
      next[key] = valueParser ? valueParser(el.value) : el.value;
      WS.meta.options = normalizeOptions(
        Object.assign({}, WS.meta.options || {}, next),
      );
      metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(Object.keys(next)));
      setOptionsStatus("Saved");
      if (typeof onChange === "function") onChange(el.value);
      applyOptionsEverywhere(!!invalidateThumbs);
    });
  };

  const bindStandaloneSelect = (id, onChange, valueParser = null) => {
    const el = $(id);
    if (!el) return;
    const selectRoot = optionsBodyEl.querySelector(
      `.optSelect[data-opt-select-id="${id}"]`,
    );
    const trigger = selectRoot
      ? selectRoot.querySelector(".optSelectBtn")
      : null;
    const labelEl = trigger
      ? trigger.querySelector(".optSelectBtnLabel")
      : null;
    const menu = selectRoot ? selectRoot.querySelector(".optSelectMenu") : null;
    const optionButtons = menu
      ? Array.from(menu.querySelectorAll("button[data-opt-select-value]"))
      : [];
    const syncSelectUi = () => {
      const currentValue = String(el.value || "");
      let currentLabel = "";
      optionButtons.forEach((btn) => {
        const selected =
          String(btn?.dataset?.optSelectValue || "") === currentValue;
        btn.classList.toggle("current", selected);
        if (selected) currentLabel = String(btn.textContent || "");
      });
      if (!currentLabel && optionButtons.length)
        currentLabel = String(optionButtons[0].textContent || "");
      if (labelEl) labelEl.textContent = currentLabel || "Select";
    };
    if (selectRoot && trigger && menu) {
      trigger.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const opening = !menu.classList.contains("open");
        closeOpenOptionsSelectMenus(opening ? id : "");
        setOptionsSelectOpenState(selectRoot, opening);
      });
      trigger.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          setOptionsSelectOpenState(selectRoot, false);
        }
      });
      menu.addEventListener("click", (e) => e.stopPropagation());
      menu.addEventListener("keydown", (e) => e.stopPropagation());
      optionButtons.forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const nextValue = String(btn?.dataset?.optSelectValue || "");
          const prevValue = String(el.value || "");
          setOptionsSelectOpenState(selectRoot, false);
          if (nextValue === prevValue) {
            syncSelectUi();
            return;
          }
          el.value = nextValue;
          syncSelectUi();
          el.dispatchEvent(new Event("change"));
        });
      });
      syncSelectUi();
    }
    el.addEventListener("change", () => {
      const rawValue = String(el.value || "");
      const nextValue =
        typeof valueParser === "function" ? valueParser(rawValue) : rawValue;
      el.value = String(nextValue ?? "");
      syncSelectUi();
      if (typeof onChange === "function") onChange(nextValue, rawValue);
    });
  };

  const bindCheck = (id, key, onChange) => {
    bindMenuToggleButton(id, (enabled) => {
      const next = {};
      next[key] = !!enabled;
      WS.meta.options = normalizeOptions(
        Object.assign({}, WS.meta.options || {}, next),
      );
      metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(Object.keys(next)));
      setOptionsStatus("Saved");
      if (typeof onChange === "function") onChange(!!enabled);
      applyOptionsEverywhere(false);
    });
  };

  const bindLinkedCheck = (id, keys, onChange) => {
    const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
    if (!list.length) return;
    bindMenuToggleButton(id, (enabled) => {
      const next = {};
      list.forEach((key) => {
        next[key] = !!enabled;
      });
      WS.meta.options = normalizeOptions(
        Object.assign({}, WS.meta.options || {}, next),
      );
      metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(Object.keys(next)));
      setOptionsStatus("Saved");
      if (typeof onChange === "function") onChange(!!enabled);
      applyOptionsEverywhere(false);
      renderDirectoriesPane(true);
      renderPreviewPane(false, true);
      syncButtons();
    });
  };

  const bindRange = (id, key, onChange, formatter, config = null) => {
    const el = $(id);
    if (!el) return;
    const valueEl = $(`${id}_value`);
    const attrNumber = (name, fallback = 0) => {
      const raw = el.getAttribute(name);
      const n = Number(raw);
      return Number.isFinite(n) ? n : fallback;
    };
    const rawMin = attrNumber("data-stepper-min", attrNumber("min", 0));
    const rawMax = attrNumber("data-stepper-max", attrNumber("max", 100));
    const applyEverywhere = !(config && config.applyEverywhere === false);
    const neutralValue =
      config && Number.isFinite(Number(config.neutralValue))
        ? Number(config.neutralValue)
        : attrNumber("data-stepper-neutral", null);
    const nullable = !!(config && config.nullable);
    const stepValue = Math.abs(attrNumber("step", 0));
    const percentStep = Math.max(1, Math.abs(attrNumber("data-stepper-percent-step", 1)));
    const neutralEpsilon = Number.isFinite(Number(config && config.snapEpsilon))
      ? Math.abs(Number(config.snapEpsilon))
      : 0.000001;
    const clampRaw = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return Number.isFinite(neutralValue) ? neutralValue : rawMin;
      return Math.min(rawMax, Math.max(rawMin, n));
    };
    const rawToStepperPercent = (value) => {
      const raw = clampRaw(value);
      if (!Number.isFinite(neutralValue)) {
        const span = Math.max(0.000001, rawMax - rawMin);
        return ((raw - rawMin) / span) * 100;
      }
      if (raw >= neutralValue) {
        const span = Math.max(0.000001, rawMax - neutralValue);
        return ((raw - neutralValue) / span) * 100;
      }
      const span = Math.max(0.000001, neutralValue - rawMin);
      return -((neutralValue - raw) / span) * 100;
    };
    const stepperPercentToRaw = (percent) => {
      const pct = Number(percent);
      if (!Number.isFinite(pct)) return clampRaw(neutralValue);
      if (!Number.isFinite(neutralValue)) {
        const span = rawMax - rawMin;
        return clampRaw(rawMin + (span * pct) / 100);
      }
      if (pct >= 0) {
        return clampRaw(neutralValue + ((rawMax - neutralValue) * pct) / 100);
      }
      return clampRaw(neutralValue + ((neutralValue - rawMin) * pct) / 100);
    };
    const rawStepForPercent = (percent) => {
      const pct = Number(percent);
      const span = !Number.isFinite(neutralValue)
        ? rawMax - rawMin
        : pct >= 0
          ? rawMax - neutralValue
          : neutralValue - rawMin;
      return Math.abs(span * percentStep) / 100;
    };
    const roundRaw = (value, percent) => {
      const n = clampRaw(value);
      const rawStep = rawStepForPercent(percent);
      if (!Number.isFinite(rawStep) || rawStep <= 0) return Number(n.toFixed(6));
      const base = Number.isFinite(neutralValue) ? neutralValue : rawMin;
      return Number((base + Math.round((n - base) / rawStep) * rawStep).toFixed(6));
    };
    const updateValue = () => {
      if (!valueEl) return;
      const nextVal = parseFloat(el.value);
      const displayText = formatter ? formatter(nextVal) : String(el.value);
      if ("value" in valueEl) valueEl.value = displayText;
      else valueEl.textContent = displayText;
      const ariaNow = Math.round(rawToStepperPercent(nextVal));
      valueEl.setAttribute("aria-valuenow", String(ariaNow));
      valueEl.setAttribute("aria-valuetext", displayText);
    };
    const commitValueInput = () => {
      if (!valueEl || !("value" in valueEl)) return false;
      const rawText = String(valueEl.value || "").trim().replace(/%/g, "");
      if (!rawText) {
        updateValue();
        return false;
      }
      const pct = Number(rawText);
      if (!Number.isFinite(pct)) {
        updateValue();
        return false;
      }
      const minPct = Math.min(
        rawToStepperPercent(rawMin),
        rawToStepperPercent(rawMax),
      );
      const maxPct = Math.max(
        rawToStepperPercent(rawMin),
        rawToStepperPercent(rawMax),
      );
      const nextPct = Math.min(maxPct, Math.max(minPct, pct));
      const currentRaw = clampRaw(parseFloat(el.value));
      const nextRaw = roundRaw(stepperPercentToRaw(nextPct), nextPct);
      el.value = String(nextRaw);
      updateValue();
      if (nextRaw !== currentRaw)
        el.dispatchEvent(new Event("change", { bubbles: true }));
      return nextRaw !== currentRaw;
    };
    const rowEl = el.closest(".optOverlayRow");
    const stepButtons = rowEl
      ? Array.from(
          rowEl.querySelectorAll(
            `[data-opt-stepper-for="${cssEscapeValue(id)}"]`,
          ),
        )
      : [];
    const stepBy = (direction) => {
      const currentRaw = clampRaw(parseFloat(el.value));
      const currentPct = rawToStepperPercent(currentRaw);
      const minPct = Math.min(
        rawToStepperPercent(rawMin),
        rawToStepperPercent(rawMax),
      );
      const maxPct = Math.max(
        rawToStepperPercent(rawMin),
        rawToStepperPercent(rawMax),
      );
      const nextPct = Math.min(
        maxPct,
        Math.max(minPct, currentPct + direction * percentStep),
      );
      const nextRaw = roundRaw(stepperPercentToRaw(nextPct), nextPct);
      if (nextRaw === currentRaw) return false;
      el.value = String(nextRaw);
      updateValue();
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => e.stopPropagation());
    el.addEventListener("input", updateValue);
    stepButtons.forEach((btn) => {
      let repeatDelayTimer = null;
      let repeatIntervalTimer = null;
      let suppressNextClick = false;
      let activePointerId = null;
      const deltaForButton = () =>
        Number(btn.dataset.optStepperDelta) < 0 ? -1 : 1;
      const stopRepeat = (e = null) => {
        if (
          e &&
          activePointerId !== null &&
          e.pointerId != null &&
          e.pointerId !== activePointerId
        )
          return;
        if (repeatDelayTimer) clearTimeout(repeatDelayTimer);
        if (repeatIntervalTimer) clearInterval(repeatIntervalTimer);
        repeatDelayTimer = null;
        repeatIntervalTimer = null;
        try {
          if (
            activePointerId !== null &&
            typeof btn.releasePointerCapture === "function" &&
            btn.hasPointerCapture(activePointerId)
          ) {
            btn.releasePointerCapture(activePointerId);
          }
        } catch {}
        activePointerId = null;
        window.removeEventListener("pointerup", stopRepeat, true);
        window.removeEventListener("pointercancel", stopRepeat, true);
        window.removeEventListener("mouseup", stopRepeat, true);
        window.removeEventListener("blur", stopRepeat, true);
      };
      btn.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        suppressNextClick = true;
        const delta = deltaForButton();
        stepBy(delta);
        stopRepeat();
        activePointerId = e.pointerId;
        window.addEventListener("pointerup", stopRepeat, true);
        window.addEventListener("pointercancel", stopRepeat, true);
        window.addEventListener("mouseup", stopRepeat, true);
        window.addEventListener("blur", stopRepeat, true);
        try {
          if (typeof btn.setPointerCapture === "function")
            btn.setPointerCapture(e.pointerId);
        } catch {}
        repeatDelayTimer = setTimeout(() => {
          repeatDelayTimer = null;
          repeatIntervalTimer = setInterval(() => {
            stepBy(delta);
          }, 130);
        }, 360);
      });
      btn.addEventListener("pointerup", stopRepeat);
      btn.addEventListener("pointercancel", stopRepeat);
      btn.addEventListener("lostpointercapture", stopRepeat);
      btn.addEventListener("blur", stopRepeat);
      btn.addEventListener("contextmenu", (e) => {
        stopRepeat();
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (suppressNextClick) {
          suppressNextClick = false;
          return;
        }
        stepBy(deltaForButton());
      });
      btn.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener("keydown", (e) => e.stopPropagation());
    });
    if (valueEl) {
      valueEl.addEventListener("click", (e) => e.stopPropagation());
      valueEl.addEventListener("dblclick", (e) => e.stopPropagation());
      valueEl.addEventListener("focus", (e) => {
        e.stopPropagation();
        if ("select" in valueEl) {
          try {
            valueEl.select();
          } catch {}
        }
      });
      valueEl.addEventListener("blur", () => {
        commitValueInput();
      });
      valueEl.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commitValueInput();
          try {
            valueEl.blur();
          } catch {}
        } else if (e.key === "Escape") {
          e.preventDefault();
          updateValue();
          try {
            valueEl.blur();
          } catch {}
        } else if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          stepBy(1);
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          stepBy(-1);
        } else if (e.key === "Home") {
          e.preventDefault();
          el.value = String(roundRaw(rawMin, rawToStepperPercent(rawMin)));
          updateValue();
          el.dispatchEvent(new Event("change", { bubbles: true }));
        } else if (e.key === "End") {
          e.preventDefault();
          el.value = String(roundRaw(rawMax, rawToStepperPercent(rawMax)));
          updateValue();
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
    }
    el.addEventListener("change", () => {
      const next = {};
      const val = parseFloat(el.value);
      let nextValue = Number.isFinite(val) ? clampRaw(val) : 0;
      if (
        nullable &&
        neutralValue !== null &&
        Math.abs(nextValue - neutralValue) <= neutralEpsilon
      )
        nextValue = null;
      next[key] = nextValue;
      WS.meta.options = normalizeOptions(
        Object.assign({}, WS.meta.options || {}, next),
      );
      metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(Object.keys(next)));
      setOptionsStatus("Saved");
      if (typeof onChange === "function") onChange(next[key]);
      if (applyEverywhere) applyOptionsEverywhere(false);
    });
    if (
      rowEl &&
      nullable &&
      neutralValue !== null &&
      !rowEl.dataset.overlayResetBound
    ) {
      rowEl.dataset.overlayResetBound = "1";
      rowEl.addEventListener("dblclick", (e) => {
        const target = e.target;
        if (
          target &&
          target.closest &&
          target.closest("button, input, .optStepper")
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        const next = {};
        next[key] = null;
        WS.meta.options = normalizeOptions(
          Object.assign({}, WS.meta.options || {}, next),
        );
        metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(Object.keys(next)));
        el.value = String(neutralValue);
        updateValue();
        setOptionsStatus("Saved");
        if (typeof onChange === "function") onChange(next[key]);
        if (applyEverywhere) applyOptionsEverywhere(false);
      });
    }
    updateValue();
  };

  const bindLinkedRange = (id, keys, onChange, formatter) => {
    const el = $(id);
    if (!el || !Array.isArray(keys) || !keys.length) return;
    const valueEl = $(`${id}_value`);
    const updateValue = () => {
      if (!valueEl) return;
      const nextVal = parseFloat(el.value);
      valueEl.textContent = formatter ? formatter(nextVal) : String(el.value);
    };
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("keydown", (e) => e.stopPropagation());
    el.addEventListener("input", updateValue);
    el.addEventListener("change", () => {
      const val = parseFloat(el.value);
      const nextVal = Number.isFinite(val) ? val : 0;
      const next = {};
      keys.forEach((k) => {
        next[k] = nextVal;
      });
      WS.meta.options = normalizeOptions(
        Object.assign({}, WS.meta.options || {}, next),
      );
      metaMarkDirty(...metaPreferenceDocIdsForOptionKeys(Object.keys(next)));
      setOptionsStatus("Saved");
      if (typeof onChange === "function") onChange(nextVal);
      applyOptionsEverywhere(false);
    });
    updateValue();
  };

  const bindActionBtn = (id, onClick) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof onClick === "function") onClick();
    });
    el.addEventListener("keydown", (e) => e.stopPropagation());
  };

  bindCheck("opt_showHiddenFolder", "showHiddenFolder", () => {
    invalidateHiddenVisibilityState();
    if (!showHiddenFolderEnabled() && WS.view.tagFolderActiveMode === "hidden") {
      exitTagFolderView();
    }
    rebuildDirectoriesEntries();
    preserveActivePreviewTargetDuringDirectoriesRefresh();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
    renderCalendarUi();
  });
  bindCheck("opt_showTrashFolder", "showTrashFolder", () => {
    navigateOutOfTrashIfHidden();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  });
  bindCheck("opt_showStorageFolder", "showStorageFolder", () => {
    invalidateDirMetricsCaches();
    navigateOutOfStorageIfHidden();
    rebuildDirectoriesEntries();
    preserveActivePreviewTargetDuringDirectoriesRefresh();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  });
  bindCheck("opt_quickNavigation", "quickNavigation", (enabled) => {
    showStatusMessage(`Quick navigation: ${enabled ? "On" : "Off"}`, "quick-navigation");
  });
  bindSelect("opt_thumbnailSize", "thumbnailSize", false, null, (val) => {
    const raw = String(val || "").trim().toLowerCase();
    return raw === "small" || raw === "large" ? raw : "medium";
  });
  bindCheck("opt_muteMessages", "muteMessages");
  bindCheck("opt_showUntaggedFolder", "showUntaggedFolder", (enabled) => {
    invalidateDirMetricsCaches();
    if (!enabled && WS.view.tagFolderActiveMode === "untagged") {
      exitTagFolderView();
    }
    rebuildDirectoriesEntries();
    preserveActivePreviewTargetDuringDirectoriesRefresh();
    renderDirectoriesPane(true);
    renderPreviewPane(false, true);
    syncButtons();
    kickVideoThumbsForPreview();
    kickImageThumbsForPreview();
  });
  bindCheck(
    "opt_clickSelectedRotatingThumbTeleports",
    "clickSelectedRotatingThumbTeleports",
  );
  // Not listed in APP_ITEM_MENU_SETTING_CONTROL_IDS so the Thumbnails settings
  // section stays reachable under APP_ITEM_MENU_ACTIONS_ONLY (the other thumb
  // controls are menu-only). Changing it forces a Refresh App.
  bindCheck("opt_mediaThumbnails", "mediaThumbnails", (enabled) => {
    applyMediaThumbnailsModeChange(enabled);
  });
  bindCheck("opt_fullResThumbnails", "fullResThumbnails", (enabled) => {
    applyFullResThumbnailsModeChange(enabled);
  });
  colorOverlayRows.forEach((row) => {
    if (row.showToggle !== false) {
      bindCheck(row.enabledId, row.enabledKey, () => {
        applyMediaFilterFromOptions({ deferThumbSync: true });
      });
    }
    bindRange(
      row.rangeId,
      row.amountKey,
      () => {
        applyMediaFilterFromOptions({ deferThumbSync: true });
        syncActiveAppearancePresetSelection(WS.meta.options);
        updateAppearancePresetUiState();
      },
      row.formatter,
      {
        nullable: !!row.nullable,
        neutralValue: row.neutralValue,
        applyEverywhere: false,
      },
    );
  });
  effectOverlayRows.forEach((row) => {
    if (row.showToggle !== false) {
      bindCheck(row.enabledId, row.enabledKey, () => {
        applyMediaFilterFromOptions({ deferThumbSync: true });
      });
    }
    bindRange(
      row.rangeId,
      row.amountKey,
      () => {
        applyMediaFilterFromOptions({ deferThumbSync: true });
        syncActiveAppearancePresetSelection(WS.meta.options);
        updateAppearancePresetUiState();
      },
      row.formatter,
      {
        nullable: !!row.nullable,
        neutralValue: row.neutralValue,
        applyEverywhere: false,
      },
    );
  });
  const appearancePresetPromptInput = $("opt_appearancePresetPromptName");
  const focusAppearancePresetPromptInput = () => {
    const promptInput = $("opt_appearancePresetPromptName");
    if (promptInput) {
      try {
        promptInput.focus();
        promptInput.select();
      } catch {}
    }
  };
  const readAppearancePresetPromptInput = () => {
    const raw = appearancePresetPromptInput
      ? appearancePresetPromptInput.value
      : WS.view && WS.view.appearancePresetDraftName
        ? WS.view.appearancePresetDraftName
        : "";
    return String(raw || "")
      .replace(/\s+/g, " ")
      .trim();
  };
  if (appearancePresetPromptInput) {
    appearancePresetPromptInput.addEventListener("click", (e) =>
      e.stopPropagation(),
    );
    appearancePresetPromptInput.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        if (WS.view) WS.view.appearancePresetPromptMode = "";
        renderOptionsUi("appearance");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const confirmBtn = $("opt_appearancePresetPromptConfirm");
        if (confirmBtn) confirmBtn.click();
      }
    });
    appearancePresetPromptInput.addEventListener("input", () => {
      if (WS.view)
        WS.view.appearancePresetDraftName =
          appearancePresetPromptInput.value || "";
    });
  }
  bindStandaloneSelect(
    "opt_filterMode",
    (value) => {
      const next = normalizeMediaFilterMode(value);
      if (WS.view) WS.view.filterMode = next;
      setOptionsStatus("Saved");
      applyViewModesEverywhere(true);
      showStatusMessage(`Media filter: ${next}`, "cycle-filter");
    },
    (val) => normalizeMediaFilterMode(val),
  );
  bindStandaloneSelect(
    "opt_generalAppearancePreset",
    (value) => {
      const presetId = normalizeAppearancePresetIdValue(value);
      if (!presetId || !applyAppearancePresetById(presetId)) return;
      setOptionsStatus("Saved");
      renderOptionsUi("general");
      showStatusMessage(
        `Applied filter preset '${appearancePresetDisplayName(presetId)}'.`,
        "appearance-presets",
      );
    },
    (val) => normalizeAppearancePresetIdValue(val),
  );
  optionsBodyEl
    .querySelectorAll("[data-appearance-preset-apply]")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const presetId = normalizeAppearancePresetIdValue(
          btn.dataset.appearancePresetApply,
        );
        if (!presetId || !applyAppearancePresetById(presetId)) return;
        renderOptionsUi("appearance");
        showStatusMessage(
          `Applied filter preset '${appearancePresetDisplayName(presetId)}'.`,
          "appearance-presets",
        );
      });
      btn.addEventListener("keydown", (e) => e.stopPropagation());
    });
  optionsBodyEl
    .querySelectorAll("[data-appearance-preset-update]")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const presetId = normalizeAppearancePresetIdValue(
          btn.dataset.appearancePresetUpdate,
        );
        const preset = getAppearancePresetById(presetId);
        if (!preset || preset.id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return;
        if (!updateAppearancePresetFromCurrent(presetId)) {
          showStatusMessage("Filter preset was not updated.");
          return;
        }
        if (WS.view) WS.view.appearancePresetPromptMode = "";
        renderOptionsUi("appearance");
        updateAppearancePresetUiState();
        showStatusMessage(
          `Updated filter preset '${appearancePresetDisplayName(presetId)}'.`,
          "appearance-presets",
        );
      });
      btn.addEventListener("keydown", (e) => e.stopPropagation());
    });
  optionsBodyEl
    .querySelectorAll("[data-appearance-preset-rename]")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const presetId = normalizeAppearancePresetIdValue(
          btn.dataset.appearancePresetRename,
        );
        const preset = getAppearancePresetById(presetId);
        if (!preset || preset.id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return;
        if (WS.view) {
          WS.view.appearancePresetEditingId = presetId;
          WS.view.appearancePresetPromptMode = "rename";
          WS.view.appearancePresetDraftName = String(preset.name || "");
        }
        renderOptionsUi("appearance");
        focusAppearancePresetPromptInput();
      });
      btn.addEventListener("keydown", (e) => e.stopPropagation());
    });
  optionsBodyEl
    .querySelectorAll("[data-appearance-preset-delete]")
    .forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const presetId = normalizeAppearancePresetIdValue(
          btn.dataset.appearancePresetDelete,
        );
        const preset = getAppearancePresetById(presetId);
        if (!preset || preset.id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return;
        if (WS.view) {
          WS.view.appearancePresetEditingId = presetId;
          WS.view.appearancePresetPromptMode = "delete";
          WS.view.appearancePresetDraftName = String(preset.name || "");
        }
        renderOptionsUi("appearance");
      });
      btn.addEventListener("keydown", (e) => e.stopPropagation());
    });
  bindActionBtn("opt_appearancePreset_add", () => {
    const preset = createAppearancePresetFromCurrent(
      nextNewAppearancePresetName(),
    );
    if (!preset) {
      showStatusMessage("Filter preset was not created.");
      return;
    }
    if (WS.view) {
      WS.view.appearancePresetEditingId = preset.id;
      WS.view.appearancePresetPromptMode = "rename";
      WS.view.appearancePresetDraftName = String(preset.name || "");
    }
    renderOptionsUi("appearance");
    focusAppearancePresetPromptInput();
    showStatusMessage("Created filter preset.", "appearance-presets");
  });
  bindSelect(
    "opt_animatedMediaFilters",
    "animatedMediaFilters",
    false,
    () => {
      applyMediaFilterFromOptions();
    },
    (val) => normalizeAnimatedMediaFiltersValue(val, "on"),
  );
  bindSelect("opt_videoSkipStep", "videoSkipStep", false, null, (val) => {
    const parsed = parseInt(String(val || "").trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "5";
  });
  bindSelect("opt_videoEndBehavior", "videoEndBehavior", false, null, (val) => {
    const raw = String(val || "")
      .trim()
      .toLowerCase();
    return raw === "loop" || raw === "next" || raw === "stop" ? raw : "loop";
  });
  bindCheck("opt_showTagFolderSpacerRow", "showTagFolderSpacerRow");
  // Filename display transforms are controlled from the app menu; the legacy
  // settings-pane controls remain intentionally absent.
  bindActionBtn("opt_appearancePresetPromptConfirm", () => {
    const presetName = readAppearancePresetPromptInput();
    const promptMode = String(
      (WS.view && WS.view.appearancePresetPromptMode) || "save",
    );
    if (promptMode === "rename") {
      const presetId = normalizeAppearancePresetIdValue(
        WS.view && WS.view.appearancePresetEditingId,
      );
      const result = renameAppearancePresetById(presetId, presetName);
      if (!result.ok) {
        if (result.reason === "missing-name")
          showStatusMessage("Enter a preset name first.");
        else if (result.reason === "reserved-name")
          showStatusMessage("'Default' is reserved.");
        else if (result.reason === "duplicate-name")
          showStatusMessage("Another preset already uses that name.");
        else if (result.reason === "unchanged")
          showStatusMessage("Preset name is unchanged.");
        else showStatusMessage("Preset was not renamed.");
        return;
      }
      renderOptionsUi("appearance");
      updateAppearancePresetUiState();
      showStatusMessage(
        `Renamed filter preset to '${appearancePresetDisplayName(result.preset && result.preset.id)}'.`,
        "appearance-presets",
      );
      return;
    }

    const result = saveAppearancePresetFromCurrent(presetName);
    if (!result.ok) {
      if (result.reason === "missing-name")
        showStatusMessage("Enter a preset name first.");
      else if (result.reason === "reserved-name")
        showStatusMessage("'Default' is reserved.");
      else showStatusMessage("Preset was not saved.");
      return;
    }
    renderOptionsUi("appearance");
    updateAppearancePresetUiState();
    showStatusMessage(
      `${result.replaced ? "Updated" : "Saved"} filter preset '${appearancePresetDisplayName(result.preset && result.preset.id)}'.`,
      "appearance-presets",
    );
  });
  bindActionBtn("opt_appearancePresetPromptCancel", () => {
    if (WS.view) WS.view.appearancePresetPromptMode = "";
    renderOptionsUi("appearance");
  });
  bindActionBtn("opt_appearancePresetDeleteConfirm", () => {
    const presetId = normalizeAppearancePresetIdValue(
      WS.view && WS.view.appearancePresetEditingId,
    );
    const preset = getAppearancePresetById(presetId);
    if (!preset || preset.id === BUILTIN_NULL_APPEARANCE_PRESET_ID) return;
    if (!deleteAppearancePresetById(presetId)) {
      showStatusMessage("Preset could not be deleted.");
      return;
    }
    renderOptionsUi("appearance");
    updateAppearancePresetUiState();
    applyOptionsEverywhere(true);
    showStatusMessage(`Deleted filter preset '${preset.name}'.`, "appearance-presets");
  });
  bindStandaloneSelect(
    "opt_dirSortMode",
    () => {
      const dirSortSelectEl = $("opt_dirSortMode");
      if (!dirSortSelectEl) return;
      WS.meta.dirSortMode = normalizeDirSortMode(dirSortSelectEl.value);
      invalidateDirSortOrderCaches();
      metaMarkDirty(META_DOC_IDS.prefGeneral);
      setOptionsStatus("Saved");
      applyFolderSortModeEverywhere(true);
    },
    (val) => normalizeDirSortMode(val),
  );
  applyMenuTransientFocusBehavior(optionsBodyEl);
}

const OPTION_TAB_IDS = Object.freeze([
  "general",
  "reveal",
  "appearance",
  "playback",
  "filenames",
  "storage",
]);

if (keybindsResetBtn)
  keybindsResetBtn.addEventListener("click", () => resetKeybindsToDefaults());

if (optionsDoneBtn) optionsDoneBtn.addEventListener("click", () => closeMenu());
if (calendarDeleteAllBtn) {
  calendarDeleteAllBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const count = Array.isArray(WS.meta.scoreHistory)
      ? WS.meta.scoreHistory.length
      : 0;
    if (!count) {
      setCalendarStatus("No logs");
      return;
    }
    const ok = await showConfirmDialog(
      `Delete all ${count} score log event${count === 1 ? "" : "s"}?`,
      { okLabel: "Delete", danger: true },
    );
    if (!ok) return;
    WS.meta.scoreHistory = [];
    metaMarkDirty(META_DOC_IDS.scoreHistory);
    renderCalendarUi();
    setCalendarStatus("Saved");
    showStatusMessage("Score history cleared.");
  });
}
if (calendarBodyEl) {
  calendarBodyEl.addEventListener("click", async (e) => {
    const lineBtn =
      e.target && e.target.closest
        ? e.target.closest(
            "button[data-score-history-delete-line-event][data-score-history-delete-line-root]",
          )
        : null;
    if (lineBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = String(
        lineBtn.getAttribute("data-score-history-delete-line-event") || "",
      );
      const rootPath = String(
        lineBtn.getAttribute("data-score-history-delete-line-root") || "",
      );
      const removed = removeScoreHistoryLineByEventAndRoot(id, rootPath);
      if (removed > 0) {
        metaMarkDirty(META_DOC_IDS.scoreHistory);
        renderCalendarUi();
        setCalendarStatus("Saved");
        showStatusMessage("Score log line deleted.");
      } else {
        setCalendarStatus("No changes");
      }
      return;
    }
    const dayRootBtn =
      e.target && e.target.closest
        ? e.target.closest(
            "button[data-score-history-delete-day-root][data-score-history-delete-day]",
          )
        : null;
    if (dayRootBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dayKey = String(
        dayRootBtn.getAttribute("data-score-history-delete-day") || "",
      );
      const rootPath = String(
        dayRootBtn.getAttribute("data-score-history-delete-day-root") || "",
      );
      const removed = removeScoreHistoryLinesByDateAndRoot(dayKey, rootPath);
      if (removed > 0) {
        metaMarkDirty(META_DOC_IDS.scoreHistory);
        closeScoreHistoryDayMenu();
        renderCalendarUi();
        setCalendarStatus("Saved");
        showStatusMessage("Score log line deleted.");
      } else {
        setCalendarStatus("No changes");
      }
      return;
    }
    const dayCell =
      e.target && e.target.closest
        ? e.target.closest("[data-score-history-day]")
        : null;
    if (dayCell) {
      e.preventDefault();
      e.stopPropagation();
      openScoreHistoryDayMenu(
        String(dayCell.getAttribute("data-score-history-day") || ""),
        dayCell,
      );
      return;
    }
    const eventBtn =
      e.target && e.target.closest
        ? e.target.closest("button[data-score-history-delete-event]")
        : null;
    if (eventBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = String(
        eventBtn.getAttribute("data-score-history-delete-event") || "",
      );
      const removed = removeScoreHistoryEntryById(id);
      if (removed > 0) {
        metaMarkDirty(META_DOC_IDS.scoreHistory);
        renderCalendarUi();
        setCalendarStatus("Saved");
        showStatusMessage("Score log entry deleted.");
      } else {
        setCalendarStatus("No changes");
      }
      return;
    }
    const dayBtn =
      e.target && e.target.closest
        ? e.target.closest("button[data-score-history-delete-day]")
        : null;
    if (dayBtn) {
      e.preventDefault();
      e.stopPropagation();
      const dayKey = String(
        dayBtn.getAttribute("data-score-history-delete-day") || "",
      );
      if (!dayKey) return;
      const ok = await showConfirmDialog(
        `Delete all score log events on ${scoreHistoryDateLabel(dayKey)}?`,
        { okLabel: "Delete", danger: true },
      );
      if (!ok) return;
      const removed = removeScoreHistoryEntriesByDateKey(dayKey);
      if (removed > 0) {
        metaMarkDirty(META_DOC_IDS.scoreHistory);
        renderCalendarUi();
        setCalendarStatus("Saved");
        showStatusMessage(
          `Deleted ${removed} score log event${removed === 1 ? "" : "s"}.`,
        );
      } else {
        setCalendarStatus("No changes");
      }
    }
  });
}
