/* App menu: Controls
   Rebinding keys, and the calendar and history keyboard handlers. */

// ---------------------------------------------------------------------------
// Controls submenu: keybind list replacing the settings Controls tab. Modeled
// on the appearance-filter menu -- three columns (name / assign / clear),
// scroll the names, move right onto assign then clear, move left to go back.
// Hard-coded WASD/QE/Tab come first, greyed and non-editable. Menu-only / hidden
// actions stay in the data model but are not listed here.
// ---------------------------------------------------------------------------

function appMenuControlBindings() {
  const all =
    WS.meta && Array.isArray(WS.meta.keybinds)
      ? syncPaneKeybindBindingsWithCurrentActions(false)
      : defaultKeybinds(WS.meta && WS.meta.appearancePresets);
  // Keep disabled/hidden actions in KEYBIND_ACTIONS + persistence; only skip
  // them in this UI (same filter the old Settings Controls tab used).
  const visible = all.filter(
    (b) =>
      b &&
      !b.hiddenInUi &&
      !appItemMenuActionKeybindIsDisabled(b.id),
  );
  return [
    APP_MENU_SETTINGS_CONTROL_BINDING,
    APP_MENU_KEY_HELP_CONTROL_BINDING,
    APP_MENU_DEBUG_CONTROL_BINDING,
  ].concat(visible);
}

function appMenuControlBindingById(id) {
  return appMenuControlBindings().find((b) => b && b.id === String(id || "")) || null;
}

// A key can't be assigned to an ordinary action if it's one of the hard-coded
// nav/app-menu keys or a locked score key (=/-). Those all live in
// KEYBIND_LOCKED_ACTIONS now, so one check covers them.
function appMenuControlKeyReserved(key, excludeId) {
  return isKeyReservedForLockedAction(key, excludeId);
}

function appMenuControlHasClearColumn(binding, locked) {
  if (locked) return false;
  return !!(binding && normalizeKeyValue(binding.key || ""));
}

// Set a control row's classes + three-column content from its binding and the
// current edit/capture state. Used both to build a row and to refresh one (or
// all) in place -- rebuilding the whole menu on every keystroke loses the open
// submenu / cursor, so edits update the DOM directly, like Filters.
function applyAppMenuControlRow(btn, binding, locked) {
  btn.classList.toggle("appMenuControlLocked", !!locked);
  btn.disabled = !!locked;
  const editing = !locked && APP_MENU_CONTROLS_EDIT_ID === binding.id;
  const hasClear = appMenuControlHasClearColumn(binding, locked);
  // If clear vanished (just unbound), snap focus back onto assign.
  if (editing && APP_MENU_CONTROLS_EDIT_BTN > 0 && !hasClear) {
    APP_MENU_CONTROLS_EDIT_BTN = 0;
  }
  btn.classList.toggle("appMenuControlEditing", editing);
  btn.classList.toggle("appMenuControlCol0", editing && APP_MENU_CONTROLS_EDIT_BTN === 0);
  btn.classList.toggle("appMenuControlCol1", editing && APP_MENU_CONTROLS_EDIT_BTN === 1);
  const capturing =
    editing && APP_MENU_CONTROLS_CAPTURE_ID === binding.id;

  const nameHtml = `<span class="appMenuControlName">${escapeHtml(binding.label || binding.id)}</span>`;

  let assignHtml;
  if (locked) {
    const fixed = lockedKeyForAction(binding.id);
    const keyText = keyLabel(fixed || binding.key || "") || "—";
    assignHtml = `<span class="appMenuControlAssign">${escapeHtml(keyText)}</span>`;
  } else if (capturing) {
    assignHtml = `<span class="appMenuControlAssign appMenuControlCapturing">Press key…</span>`;
  } else if (binding.key) {
    assignHtml = `<span class="appMenuControlAssign">${escapeHtml(keyLabel(binding.key))}</span>`;
  } else {
    assignHtml = `<span class="appMenuControlAssign appMenuControlKeyEmpty">Assign</span>`;
  }

  // Locked rows keep the third column empty; greying alone signals non-editable.
  let clearHtml;
  if (!locked && hasClear) {
    clearHtml = `<span class="appMenuControlClear">Clear</span>`;
  } else {
    clearHtml = `<span class="appMenuControlClear appMenuControlClearEmpty" aria-hidden="true">Clear</span>`;
  }

  btn.innerHTML = nameHtml + assignHtml + clearHtml;
}

function buildAppMenuControlButton(binding, locked) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "appMenuControlRow";
  btn.dataset.appMenuControl = String(binding.id || "");
  btn.dataset.menuStateKey = `control:${binding.id}`;
  btn.setAttribute("data-action", "keep");
  applyAppMenuControlRow(btn, binding, locked);
  return btn;
}

function appMenuControlRowIsLocked(id) {
  return APP_MENU_CONTROLS_HARDCODED_SET.has(id) || isAnyLockedKeybindAction(id);
}

function appMenuControlRowEl(id) {
  if (!appActionMenuEl || !id) return null;
  const key = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(id)) : String(id);
  return appActionMenuEl.querySelector(`.appMenuControlRow[data-app-menu-control="${key}"]`);
}

function renderAppMenuControlRow(id) {
  const row = appMenuControlRowEl(id);
  const binding = appMenuControlBindingById(id);
  if (row && binding) applyAppMenuControlRow(row, binding, appMenuControlRowIsLocked(id));
}

// After a key change (which can swap a key off another row) refresh every row.
function refreshAllAppMenuControlRows() {
  if (!appActionMenuEl) return;
  appActionMenuEl.querySelectorAll(".appMenuControlRow").forEach((row) => {
    const id = String(row.dataset.appMenuControl || "");
    const binding = appMenuControlBindingById(id);
    if (binding) applyAppMenuControlRow(row, binding, appMenuControlRowIsLocked(id));
  });
}

function buildAppMenuControlsSubmenu() {
  // Only what can be rebound. The hard-coded keys are listed, with everything
  // else, on the hold-[ controls page, so a greyed row here would only be a
  // second copy of it.
  const buttons = appMenuControlBindings()
    .filter(
      (b) =>
        b &&
        !APP_MENU_CONTROLS_HARDCODED_SET.has(b.id) &&
        !isAnyLockedKeybindAction(b.id),
    )
    // The random controls go last, below everything -- the appearance
    // preset actions included, which are appended after KEYBIND_ACTIONS.
    .sort(
      (a, b) =>
        (RANDOM_CONTROL_ID_SET.has(a.id) ? 1 : 0) -
        (RANDOM_CONTROL_ID_SET.has(b.id) ? 1 : 0),
    )
    .map((b) => buildAppMenuControlButton(b, false));
  const submenu = createDropdownMenuSubmenu("Controls", buttons);
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuControlsPanel");
  return submenu;
}

function startAppMenuControlsEdit(id) {
  const actionId = String(id || "");
  if (!actionId || appMenuControlRowIsLocked(actionId)) return false;
  APP_MENU_CONTROLS_EDIT_ID = actionId;
  APP_MENU_CONTROLS_EDIT_BTN = 0;
  APP_MENU_CONTROLS_CAPTURE_ID = "";
  suppressMenuAutoClose();
  const row = appMenuControlRowEl(actionId);
  if (row) setMenuHighlight(appActionMenuEl, row);
  renderAppMenuControlRow(actionId);
  return true;
}

function stopAppMenuControlsEdit() {
  const id = APP_MENU_CONTROLS_EDIT_ID;
  if (!id) return false;
  APP_MENU_CONTROLS_EDIT_ID = "";
  APP_MENU_CONTROLS_EDIT_BTN = 0;
  APP_MENU_CONTROLS_CAPTURE_ID = "";
  renderAppMenuControlRow(id);
  return true;
}

// Keys for an open Controls edit/capture state. Returns true when handled.
function handleAppMenuControlsKey(menu, action, e) {
  if (menu.id !== "appActionMenu") return false;

  // Capture mode: the next key becomes this control's binding.
  if (APP_MENU_CONTROLS_CAPTURE_ID) {
    const id = APP_MENU_CONTROLS_CAPTURE_ID;
    if (e.key === "Escape") {
      APP_MENU_CONTROLS_CAPTURE_ID = "";
      renderAppMenuControlRow(id);
      return true;
    }
    const key = keybindValueFromEvent(e);
    if (!key) return true; // bare modifier press, keep waiting
    APP_MENU_CONTROLS_CAPTURE_ID = "";
    if (appMenuControlKeyReserved(key, id)) {
      showStatusMessage("That key is reserved.");
    } else {
      const result = assignKeybindForAction(id, key);
      if (!result.ok) showStatusMessage(result.message || "Unable to update keybind.");
    }
    refreshAllAppMenuControlRows();
    return true;
  }

  // Edit mode: cursor is on the assign (col 0) or clear (col 1) column.
  if (APP_MENU_CONTROLS_EDIT_ID) {
    const id = APP_MENU_CONTROLS_EDIT_ID;
    const binding = appMenuControlBindingById(id);
    const hasClear = appMenuControlHasClearColumn(binding, false);
    switch (action) {
      case "selectRight":
        if (APP_MENU_CONTROLS_EDIT_BTN === 0 && hasClear) {
          APP_MENU_CONTROLS_EDIT_BTN = 1;
          renderAppMenuControlRow(id);
        }
        return true;
      case "selectLeft":
        if (APP_MENU_CONTROLS_EDIT_BTN > 0) {
          APP_MENU_CONTROLS_EDIT_BTN = 0;
          renderAppMenuControlRow(id);
        } else {
          stopAppMenuControlsEdit();
        }
        return true;
      case "selectUp":
        stopAppMenuControlsEdit();
        moveMenuHighlight(menu, -1);
        return true;
      case "selectDown":
        stopAppMenuControlsEdit();
        moveMenuHighlight(menu, 1);
        return true;
      case "enterDir":
        if (e.repeat) return true;
        if (APP_MENU_CONTROLS_EDIT_BTN === 1 && hasClear) {
          assignKeybindForAction(id, "");
          // Stay on the row in assign column after clearing.
          APP_MENU_CONTROLS_EDIT_BTN = 0;
          refreshAllAppMenuControlRows();
        } else {
          APP_MENU_CONTROLS_CAPTURE_ID = id;
          renderAppMenuControlRow(id);
        }
        return true;
      case "openAppMenu":
      case "leaveDir":
        closeNumberedMenuFromKeyboard(menu);
        return true;
      default:
        return true; // swallow other keys while editing
    }
  }
  return false;
}

// The open Calendar submenu's panel, if one is open (its grid has no button
// options, so it is found by its .appMenuCalendar marker rather than the normal
// option walker).
function appMenuActiveCalendarPanel(menu) {
  const openSubs = Array.from(
    menu?.querySelectorAll?.(".dropdownMenuSubmenu.submenuOpen") || [],
  );
  for (const sub of openSubs) {
    const panel = sub.querySelector(":scope > .dropdownMenuSubmenuPanel");
    if (panel && panel.querySelector(":scope > .appMenuCalendar")) return panel;
  }
  return null;
}

function appMenuCalendarDayCells(panel) {
  const cal = panel.querySelector(":scope > .appMenuCalendar") || panel;
  return Array.from(cal.querySelectorAll("[data-score-history-day]"));
}

function applyAppMenuCalendarSelectionIndex(panel, idx, scroll) {
  const cells = appMenuCalendarDayCells(panel);
  panel
    .querySelectorAll(".appMenuCalendarDaySelected")
    .forEach((el) => el.classList.remove("appMenuCalendarDaySelected"));
  const cell = cells[idx];
  if (!cell) return;
  cell.classList.add("appMenuCalendarDaySelected");
  APP_MENU_CALENDAR_SELECTED_DAY = String(cell.getAttribute("data-score-history-day") || "");
  if (scroll) cell.scrollIntoView({ block: "nearest" });
}

function ensureAppMenuCalendarSelection(panel) {
  const cells = appMenuCalendarDayCells(panel);
  if (!cells.length) return -1;
  let idx = cells.findIndex((c) => c.classList.contains("appMenuCalendarDaySelected"));
  if (idx >= 0) return idx;
  const keys = cells.map((c) => String(c.getAttribute("data-score-history-day") || ""));
  idx = APP_MENU_CALENDAR_SELECTED_DAY ? keys.indexOf(APP_MENU_CALENDAR_SELECTED_DAY) : -1;
  if (idx < 0) idx = keys.indexOf(scoreHistoryDateKey(Date.now()));
  if (idx < 0) idx = cells.length - 1;
  applyAppMenuCalendarSelectionIndex(panel, idx, false);
  return idx;
}

function moveAppMenuCalendarSelection(panel, delta) {
  const cells = appMenuCalendarDayCells(panel);
  if (!cells.length) return;
  let idx = ensureAppMenuCalendarSelection(panel);
  idx = Math.max(0, Math.min(cells.length - 1, idx + delta));
  applyAppMenuCalendarSelectionIndex(panel, idx, true);
}

// Handle a key for an open Calendar panel. Returns true when it owned the key
// (the movement keys walk days, the enter key opens the day's journal, the exit
// key steps back to the History submenu). Called from the app-menu keydown
// handler, which has already preventDefault'd/stopped the event.
function handleAppMenuCalendarKey(menu, action, e) {
  const panel = appMenuActiveCalendarPanel(menu);
  if (!panel) return false;
  ensureAppMenuCalendarSelection(panel);
  switch (action) {
    case "selectLeft":
      moveAppMenuCalendarSelection(panel, -1);
      return true;
    case "selectRight":
      moveAppMenuCalendarSelection(panel, 1);
      return true;
    case "selectUp":
      moveAppMenuCalendarSelection(panel, -7);
      return true;
    case "selectDown":
      moveAppMenuCalendarSelection(panel, 7);
      return true;
    case "enterDir":
    case "openAppMenu": {
      if (e.repeat) return true;
      const day = String(
        panel
          .querySelector(".appMenuCalendarDaySelected")
          ?.getAttribute("data-score-history-day") || "",
      );
      if (!day) return true;
      // Opening a day swaps the grid for that day's page in the same submenu;
      // the journal is a button on that page rather than the day's only action.
      APP_MENU_CALENDAR_DAY_VIEW = day;
      APP_MENU_CALENDAR_SELECTED_DAY = day;
      refreshAppMenuAfterHistoryEdit();
      return true;
    }
    case "leaveDir": {
      // Step back out of the calendar to the History submenu (the calendar has
      // no button options, so the option walker alone would skip it).
      const sub = panel.closest(".dropdownMenuSubmenu");
      const trigger = sub?.querySelector(":scope > .dropdownMenuSubmenuTrigger");
      if (sub) setDropdownSubmenuOpen(sub, false);
      if (trigger) setMenuHighlight(menu, trigger);
      if (menu.id === "appActionMenu") positionActionMenuInPreviewDock(menu);
      return true;
    }
    default:
      // Swallow anything else while the calendar owns the menu.
      return true;
  }
}

// The open day page, if one is up. Its panel is the marker; the page itself is
// walked by the ordinary option walker, so this exists only to catch the key
// that steps back to the month grid -- which would otherwise close the whole
// Calendar submenu.
function appMenuActiveHistoryDayPanel(menu) {
  if (!APP_MENU_CALENDAR_DAY_VIEW) return null;
  const openSubs = Array.from(
    menu?.querySelectorAll?.(".dropdownMenuSubmenu.submenuOpen") || [],
  );
  for (const sub of openSubs) {
    const panel = sub.querySelector(":scope > .dropdownMenuSubmenuPanel");
    if (panel && panel.classList.contains("appMenuHistoryDayPanel")) return panel;
  }
  return null;
}

function handleAppMenuHistoryDayKey(menu, action, e) {
  if (!appMenuActiveHistoryDayPanel(menu)) return false;
  const dayKey = APP_MENU_CALENDAR_DAY_VIEW;

  // The cursor is on a folder row's Delete cell: it owns every key until it is
  // stepped off, so nothing else in the page can be reached by accident.
  if (APP_MENU_HISTORY_DELETE_FOCUS_ROOT) {
    const root = APP_MENU_HISTORY_DELETE_FOCUS_ROOT;
    switch (action) {
      case "selectLeft":
        setAppMenuHistoryDeleteFocus("");
        return true;
      case "selectUp":
      case "selectDown":
        setAppMenuHistoryDeleteFocus("");
        moveMenuHighlight(menu, action === "selectUp" ? -1 : 1);
        return true;
      case "enterDir":
        if (e && e.repeat) return true;
        deleteAppMenuHistoryDayRoot(dayKey, root);
        return true;
      case "leaveDir":
        break; // falls through to the step back to the month grid
      default:
        return true; // swallow everything else while Delete has the cursor
    }
  }

  // Step right (or Enter) off a folder row's name and onto its Delete cell.
  if (action === "selectRight" || action === "enterDir") {
    const root = String(
      highlightedMenuOption(menu)?.dataset?.appMenuHistoryRoot || "",
    );
    if (!root) return false;
    if (e && e.repeat) return true;
    setAppMenuHistoryDeleteFocus(root);
    return true;
  }

  if (action !== "selectLeft" && action !== "leaveDir") return false;
  if (e && e.repeat) return true;
  APP_MENU_CALENDAR_DAY_VIEW = "";
  APP_MENU_HISTORY_DAY_DELETE_CONFIRM = "";
  APP_MENU_HISTORY_DELETE_FOCUS_ROOT = "";
  refreshAppMenuAfterHistoryEdit();
  // The rebuilt grid has no options for the cursor to land on, so put the day
  // marker back and bring it into view once the panel exists again.
  requestAnimationFrame(() => {
    const liveMenu = openNumberedItemMenu();
    const panel = liveMenu ? appMenuActiveCalendarPanel(liveMenu) : null;
    if (!panel) return;
    ensureAppMenuCalendarSelection(panel);
    try {
      panel
        .querySelector(".appMenuCalendarDaySelected")
        ?.scrollIntoView({ block: "nearest" });
    } catch {}
  });
  return true;
}

function renderScoreHistoryDayMenu(dayKey) {
  const key = String(dayKey || "");
  const menu = ensureScoreHistoryDayMenuEl();
  const rows = getRootScoreHistoryLinesForDateKey(key);
  const todayIcon = scoreHistoryDayIsToday(key)
    ? `<span class="scoreHistoryTodayIcon" title="Today" aria-label="Today"></span>`
    : "";
  const linesHtml = rows.length
    ? rows
        .map((row) => {
          const delta = Number(row.delta) || 0;
          const deltaShown = delta > 0 ? `+${delta}` : String(delta);
          return `
            <div class="scoreHistoryDayMenuLine">
              <span class="scoreHistoryDayMenuFolder" title="${escapeHtml(row.rootPath || "")}">${escapeHtml(row.rootLabel || row.rootPath || "root")}</span>
              <span class="scoreHistoryDayMenuDelta">${escapeHtml(deltaShown)}</span>
              <button
                type="button"
                data-score-history-delete-day-root="${escapeHtml(row.rootPath || "")}"
                data-score-history-delete-day="${escapeHtml(key)}"
              >Delete</button>
            </div>
          `;
        })
        .join("")
    : `<div class="calendarRankingsEmpty">No score changes for this day.</div>`;
  menu.innerHTML = `
    <div class="scoreHistoryDayMenuHeader">
      <div class="scoreHistoryDayMenuTitle">
        ${todayIcon}
        <span>${escapeHtml(scoreHistoryDateLabel(key))}</span>
      </div>
      <button
        type="button"
        class="scoreHistoryDayMenuDeleteDay"
        data-score-history-delete-day="${escapeHtml(key)}"
      >Delete day</button>
    </div>
    <div class="scoreHistoryDayMenuList">
      ${linesHtml}
    </div>
    <button
      type="button"
      class="scoreHistoryDayMenuJournalBtn"
      data-score-history-journal-day="${escapeHtml(key)}"
    >Journal</button>
  `;
  return menu;
}

function openScoreHistoryDayMenu(dayKey, anchor) {
  const key = String(dayKey || "");
  if (!key || !anchor) return;
  closeActionMenus();
  const menu = renderScoreHistoryDayMenu(key);
  SCORE_HISTORY_DAY_MENU_STATE = { dayKey: key, anchor };
  menu.classList.add("open");
  positionScoreHistoryDayMenu(anchor, menu);
}
