/* Settings: keybinds (retired pane)
   The old Controls tab and the journal headings a score change adds. */

function isGridKeybindAction(actionId) {
  return GRID_KEYBIND_ACTIONS.some((action) => action.id === actionId);
}

function isLockedGridKeybindAction() {
  return false;
}

function isAnyLockedKeybindAction(actionId) {
  return isLockedKeybindAction(actionId) || isLockedGridKeybindAction(actionId);
}

function normalizeKeybindModifierTabId(tabId) {
  const raw = String(tabId || "").trim().toLowerCase();
  return KEYBIND_MODIFIER_TAB_SPECS.some((spec) => spec.id === raw)
    ? raw
    : "all";
}

function keybindModifierTabSpec(tabId = KEYBIND_MODIFIER_TAB_ID) {
  const normalized = normalizeKeybindModifierTabId(tabId);
  return (
    KEYBIND_MODIFIER_TAB_SPECS.find((spec) => spec.id === normalized) ||
    KEYBIND_MODIFIER_TAB_SPECS[0]
  );
}

function modifierMapForSingleModifier(modifier) {
  const out = { Cmd: false, Ctrl: false, Alt: false, Shift: false };
  const mod = String(modifier || "");
  if (Object.prototype.hasOwnProperty.call(out, mod)) out[mod] = true;
  return out;
}

function markdownHeadingForRootScoreLine(line) {
  const label = String(
    (line && (line.rootLabel || line.rootPath)) || "root",
  ).trim();
  return `## ${label || "root"}`;
}

function journalContainsHeading(markdown, heading) {
  const target = String(heading || "").trim().toLowerCase();
  if (!target) return true;
  const lines = String(markdown || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (String(lines[i] || "").trim().toLowerCase() === target) return true;
  }
  return false;
}

function appendDailyJournalRootHeadersForScoreEntry(entry) {
  const normalized = normalizeScoreHistoryEntry(entry);
  if (!normalized) return false;
  const dateKey = scoreHistoryDateKey(normalized.at);
  const rows = getRootScoreHistoryLinesForEntry(normalized, true);
  if (!dateKey || !rows.length) return false;
  let markdown = metaGetDailyJournal(dateKey);
  const additions = [];
  for (let i = 0; i < rows.length; i++) {
    const heading = markdownHeadingForRootScoreLine(rows[i]);
    if (journalContainsHeading(markdown, heading)) continue;
    markdown = markdown.trim()
      ? `${markdown.replace(/\s*$/g, "")}\n\n${heading}\n`
      : `${heading}\n`;
    additions.push(heading);
  }
  if (!additions.length) return false;
  return metaSetDailyJournal(dateKey, markdown);
}

function keybindValueForModifierTab(rawKeybind) {
  const spec = keybindModifierTabSpec();
  const modifier = String(spec.modifier || "");
  const normalized = normalizeKeyValue(rawKeybind || "");
  if (!modifier) return normalized;
  const parsed = parseKeybindValue(normalized);
  if (!parsed.key) return "";
  return buildKeybindValue(parsed.key, modifierMapForSingleModifier(modifier));
}

function keybindMatchesModifierTab(key, tabId = KEYBIND_MODIFIER_TAB_ID) {
  const normalized = normalizeKeyValue(key || "");
  if (!normalized) return true;
  const spec = keybindModifierTabSpec(tabId);
  const modifier = String(spec.modifier || "");
  if (!modifier) return true;
  const parsed = parseKeybindValue(normalized);
  if (!parsed.key) return true;
  return KEY_MODIFIER_ORDER.every((mod) => parsed.mods[mod] === (mod === modifier));
}

function assignKeybindForAction(actionId, rawKeybind) {
  if (!actionId || !WS.meta)
    return { ok: false, message: "Keybinds unavailable." };
  const isGrid = isGridKeybindAction(actionId);
  const bindingList = isGrid
    ? Array.isArray(WS.meta.gridKeybinds)
      ? WS.meta.gridKeybinds
      : defaultGridKeybinds()
    : syncPaneKeybindBindingsWithCurrentActions(false);
  const locked = isGrid
    ? isLockedGridKeybindAction(actionId)
    : isLockedKeybindAction(actionId);
  const lockedIds = isGrid ? null : KEYBIND_LOCKED_IDS;
  if (locked) return { ok: false, message: "This action is locked." };
  const binding = bindingList.find((b) => b.id === actionId);
  if (!binding) return { ok: false, message: "Action not found." };

  const nextKey = normalizeKeyValue(rawKeybind || "");
  if (nextKey && !isSafeKeybindValue(nextKey))
    return { ok: false, message: "That key is not allowed." };
  if (!isGrid && isKeyReservedForLockedAction(nextKey, actionId))
    return { ok: false, message: "That key is reserved." };

  const prevKey = normalizeKeyValue(binding.key || "");
  if (nextKey === prevKey) return { ok: true, unchanged: true };

  const conflict = nextKey
    ? bindingList.find(
        (b) =>
          b.id !== binding.id &&
          normalizeKeyValue(b.key || "") === nextKey &&
          !(isGrid
            ? isLockedGridKeybindAction(b.id)
            : isLockedKeybindAction(b.id)),
      )
    : null;

  binding.key = nextKey;
  if (conflict) conflict.key = prevKey;
  if (!isGrid) applyFixedKeybinds(bindingList);
  enforceUniqueKeybinds(bindingList, lockedIds);
  if (isGrid) WS.meta.gridKeybinds = bindingList;
  else WS.meta.keybinds = bindingList;
  rebuildKeybindIndex();
  metaMarkDirty(META_DOC_IDS.keybinds);
  metaScheduleSave();
  return { ok: true, swapped: !!conflict };
}

function renderKeybindsUi(scope = "pane") {
  if (!keybindsBodyEl) return;
  KEYBIND_MODIFIER_TAB_ID = "all";
  const paneBindings =
    WS.meta && Array.isArray(WS.meta.keybinds)
      ? syncPaneKeybindBindingsWithCurrentActions(false)
      : defaultKeybinds(WS.meta && WS.meta.appearancePresets);
  const normalizedScope = String(scope || "pane") === "general" ? "general" : "pane";
  let visiblePaneBindings = paneBindings.filter((binding) => {
    if (!binding || binding.hiddenInUi) return false;
    if (appItemMenuActionKeybindIsDisabled(binding.id)) return false;
    if (normalizedScope === "general" && !isGeneralKeybindActionId(binding.id))
      return false;
    return true;
  });
  if (normalizedScope === "general") {
    visiblePaneBindings = visiblePaneBindings.slice().sort((a, b) => {
      const ai = generalKeybindActionSortIndex(a && a.id);
      const bi = generalKeybindActionSortIndex(b && b.id);
      if (ai !== bi) return ai - bi;
      return String((a && a.label) || "").localeCompare(String((b && b.label) || ""));
    });
  }
  if (
    KEYBIND_CAPTURE_ACTION_ID &&
    !visiblePaneBindings.some(
      (binding) => binding.id === KEYBIND_CAPTURE_ACTION_ID,
    )
  ) {
    KEYBIND_CAPTURE_ACTION_ID = "";
  }

  const paneBySection = new Map();
  for (const binding of visiblePaneBindings) {
    if (!paneBySection.has(binding.section))
      paneBySection.set(binding.section, []);
    paneBySection.get(binding.section).push(binding);
  }

  let html = "";

  const renderBindingRows = (list) => {
    let out = "";
    for (const binding of list) {
      const isLocked = isAnyLockedKeybindAction(binding.id);
      const isCapturing =
        !isLocked &&
        KEYBIND_CAPTURE_ACTION_ID === binding.id;
      const currentLabel = keyLabel(binding.key || "");
      const lockedLabel = isLocked
        ? keyLabel(lockedKeyForAction(binding.id))
        : "";
      const captureLabel = "Set keybind";
      const captureButtonLabel = isCapturing
        ? "Press keys..."
        : currentLabel || captureLabel;
      const controlHtml = isLocked
        ? `<div class="label">${escapeHtml(lockedLabel)} (Locked)</div>`
        : `
                <div class="keybindControlCluster">
                  <button type="button" class="keybindCaptureBtn" data-bind-capture-id="${escapeHtml(binding.id)}" title="${escapeHtml(captureButtonLabel)}">${escapeHtml(captureButtonLabel)}</button>
                  ${binding.key ? `<button type="button" class="keybindClearBtn" data-bind-clear-id="${escapeHtml(binding.id)}">Clear</button>` : ""}
                </div>
              `;
      out += `
            <div class="optRow">
              <div class="optLeft">
                <div class="optTitleLine">
                  <div class="optTitle">${escapeHtml(binding.label)}</div>
                </div>
              </div>
              <div class="optRight">
                ${controlHtml}
              </div>
            </div>
          `;
    }
    return out;
  };

  if (normalizedScope === "general") {
    html += `<section class="keybindSectionGroup">${renderBindingRows(visiblePaneBindings)}</section>`;
  } else {
    for (const section of KEYBIND_SECTIONS) {
      const list = paneBySection.get(section.id) || [];
      if (!list.length) continue;
      const collapsed = menuSectionCollapsed(`controls:${section.id}`);
      html += `<section class="keybindSectionGroup${collapsed ? " collapsed" : ""}"><h2 class="keybindSectionTitle menuSectionToggle" data-collapse-key="controls:${escapeHtml(section.id)}"><span class="menuSectionToggleLabel">${escapeHtml(section.label)}</span><span class="menuSectionChevron" aria-hidden="true">▾</span></h2>${renderBindingRows(list)}</section>`;
    }
  }

  keybindsBodyEl.innerHTML = html;
  keybindsBodyEl
    .querySelectorAll(".keybindSectionGroup > h2.menuSectionToggle")
    .forEach((headerEl) => {
      bindCollapsibleSectionHeader(
        headerEl,
        headerEl.getAttribute("data-collapse-key") || "",
        ".keybindSectionGroup",
      );
    });
  applyDescriptionVisibilityFromOptions();
  ensureOptionsSelectGlobalBindings();

  const captureButtons = keybindsBodyEl.querySelectorAll(
    "button[data-bind-capture-id]",
  );
  captureButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute("data-bind-capture-id") || "";
      if (!id || isAnyLockedKeybindAction(id)) return;
      KEYBIND_CAPTURE_ACTION_ID = KEYBIND_CAPTURE_ACTION_ID === id ? "" : id;
      setKeybindsStatus(
        KEYBIND_CAPTURE_ACTION_ID
          ? "Press key combination to set bind."
          : "Capture canceled.",
      );
      renderKeybindsUi(scope);
    });
    btn.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  const clearButtons = keybindsBodyEl.querySelectorAll(
    "button[data-bind-clear-id]",
  );
  clearButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.getAttribute("data-bind-clear-id") || "";
      if (!id || isAnyLockedKeybindAction(id)) return;
      const result = assignKeybindForAction(id, "");
      KEYBIND_CAPTURE_ACTION_ID = "";
      renderKeybindsUi(scope);
      setKeybindsStatus(
        result.ok ? "Saved" : result.message || "Unable to update keybind.",
      );
    });
    btn.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  applyMenuTransientFocusBehavior(keybindsBodyEl);
}

document.addEventListener(
  "keydown",
  (e) => {
    if (busyOverlayActive()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!KEYBIND_CAPTURE_ACTION_ID) return;
    if (!MENU_OPEN || !isKeybindMenuTab(MENU_ACTIVE_TAB)) {
      KEYBIND_CAPTURE_ACTION_ID = "";
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    const isPlainEscape =
      e.key === "Escape" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey;
    if (isPlainEscape) {
      KEYBIND_CAPTURE_ACTION_ID = "";
      renderKeybindsUi("pane");
      setKeybindsStatus("Capture canceled.");
      return;
    }

    const key = keybindValueForModifierTab(keybindValueFromEvent(e));
    if (!key) return;

    const actionId = KEYBIND_CAPTURE_ACTION_ID;
    KEYBIND_CAPTURE_ACTION_ID = "";
    const result = assignKeybindForAction(actionId, key);
    renderKeybindsUi("pane");
    setKeybindsStatus(
      result.ok ? "Saved" : result.message || "Unable to update keybind.",
    );
  },
  true,
);

function resetKeybindsToDefaults() {
  WS.meta.keybinds = defaultKeybinds(WS.meta.appearancePresets);
  WS.meta.gridKeybinds = defaultGridKeybinds();
  rebuildKeybindIndex();
  metaMarkDirty(META_DOC_IDS.keybinds);
  KEYBIND_CAPTURE_ACTION_ID = "";
  renderKeybindsUi("pane");
  setKeybindsStatus("Reset");
}
