/* App menu
   Building the app menu, its confirm page and opening it. */

// Relabel a row in place without dropping an icon withMenuItemIcon gave it.
function setMenuButtonLabelText(btn, text) {
  const labelEl = btn?.querySelector?.(
    ".dropdownMenuSubmenuLabelWithIcon > span:last-child",
  );
  if (labelEl) labelEl.textContent = text;
  else if (btn) btn.textContent = text;
}

function withMenuItemIcon(item, iconKeyFor) {
  if (!item || !item.querySelector) return item;
  const host = item.classList.contains("dropdownMenuSubmenu")
    ? item.querySelector(":scope > .dropdownMenuSubmenuTrigger > span:first-child")
    : item.tagName === "BUTTON"
      ? item
      : null;
  if (!host || host.querySelector(".appIcon")) return item;
  const rawLabel = String(host.textContent || "").trim();
  // A toggle's ●/○ marker is dropped once the row has an icon: the icon itself
  // shows the state (menuToggleOn / menuToggleOff), so there is one mark, not two.
  const marker = /^([●○])\s*/.exec(rawLabel);
  const label = marker ? rawLabel.slice(marker[0].length) : rawLabel;
  const iconKey = iconKeyFor(label, item);
  if (!iconKey) return item;
  if (marker) {
    const row =
      host === item
        ? item
        : item.querySelector(":scope > .dropdownMenuSubmenuTrigger") || item;
    const on = marker[1] === "●";
    row.classList.add(on ? "menuToggleOn" : "menuToggleOff");
    row.setAttribute("aria-pressed", on ? "true" : "false");
  }
  const html =
    appIconHtml(iconKey, "dropdownMenuItemTypeIcon") +
    `<span>${escapeHtml(label)}</span>`;
  if (host === item) {
    item.innerHTML = `<span class="dropdownMenuSubmenuLabelWithIcon">${html}</span>`;
  } else {
    host.className = "dropdownMenuSubmenuLabelWithIcon";
    host.innerHTML = html;
  }
  // A cycler's list (buildCycleSubmenu) is its values, with nothing of their
  // own to be named by, so each row takes the cycler's icon.
  if (item.classList.contains("menuCycleSubmenu")) {
    const panel = item.querySelector(":scope > .dropdownMenuSubmenuPanel");
    Array.from(panel?.children || []).forEach((row) =>
      withMenuItemIcon(row, () => iconKey),
    );
  }
  return item;
}

function buildAppMenuItems() {
  const previousBuildMode = BUILDING_NAVIGATION_ONLY_ACTION_MENU;
  BUILDING_NAVIGATION_ONLY_ACTION_MENU = true;
  try {
    // A pending confirmation replaces the whole menu with the "Are You Sure?"
    // page (Yes / No), navigated the same way as any other app-menu options.
    if (APP_MENU_CONFIRM) return buildAppMenuConfirmPageItems();
    const summary = appMenuSelectionSummary();
    if (appMenuModeIsSelect()) {
      // Trash / Storage selections have no meaningful item actions except the
      // inverse location action(s). Keep both single and bulk quarantine menus
      // out of the normal Add To / Rename / Overrides path.
      const quarantineActions = selectedItemQuarantineActions(summary.target);
      const unwrapped = quarantineActions.length
        ? quarantineActions.map((action) =>
            buildSelectedItemQuarantineButton(action),
          )
        : selectedItemMenuSectionItems(summary);
      return [buildAppMenuTitleElement(summary)]
        .concat(stripThumbnailSubmenusWhileLocked(unwrapped.filter(Boolean)))
        .filter(Boolean)
        .map(withSelectMenuItemIcon);
    }

    return [
      buildAppMenuTitleElement({ title: "Settings" }),
      // Jump to... is always first: it is the one entry that is about going
      // somewhere rather than changing something.
      buildAppMenuJumpToSubmenu(),
      // The Selected Item section is not here any more: it is its own menu on
      // its own key (openSelectMenu). This one is about the library and the app.
      buildAppMenuBasicsSubmenu(),
      buildAppMenuAppearanceSubmenu(),
      buildAppMenuAppearanceSettingsSubmenu(),
      // `Random actions` is gone -- its jump weighting was removed outright and
      // its sort toggles are ordinary Controls now. Its builder is kept below.
      // "Add items" (import folders/files into the current preview location) is
      // turned OFF here on purpose -- it is rarely used. The builder
      // (buildAppMenuAddItemsSubmenu) is kept in the code below; drop it back
      // into this list to bring the option back.
      // Miscellaneous is no longer a submenu -- its items live inline here.
      // The Video settings controls have been retired (video is fixed to
      // loop / 10s skip in sanitizeOptions); Slideshow and Slideshow duration are
      // in Basics. "Reverse file order"
      // moved into the single Selected Item menu (it now acts on the selected
      // folder, not the current location).
      buildAppMenuHistorySubmenu(),
      buildAppMenuControlsSubmenu(),
      buildAppMenuLockSubmenu(),
      buildAppMenuExperimentalSubmenu(),
      appMenuChoiceButton(
        "Export logs",
        () => exportLogsArchiveFromMenu(),
        null,
        true,
      ),
      appMenuChoiceButton(
        "Export journal",
        () => exportJournalArchiveFromMenu(),
        null,
        true,
      ),
      // Always last.
      appMenuChoiceButton(
        "Refresh App",
        () => handleExtrasKeybindAction("refreshWorkspace"),
        null,
        true,
      ),
    ]
      .filter(Boolean)
      .map(withAppMenuSectionIcon)
      .map(withAppMenuNestedIcons);
  } finally {
    BUILDING_NAVIGATION_ONLY_ACTION_MENU = previousBuildMode;
  }
}

// The "Are You Sure?" page contents: a title, an optional message line, and the
// Yes / No options. Title and message are non-buttons, so the option walker
// skips them and the cursor lands on Yes.
function buildAppMenuConfirmPageItems() {
  const c = APP_MENU_CONFIRM;
  if (!c) return [];
  const title = document.createElement("div");
  title.className = "dropdownMenuTitle";
  title.setAttribute("aria-hidden", "true");
  title.textContent = c.title || "Are You Sure?";
  const items = [title];
  if (c.message) {
    const msg = document.createElement("div");
    msg.className = "appMenuConfirmMessage";
    msg.setAttribute("aria-hidden", "true");
    msg.textContent = c.message;
    items.push(msg);
  }
  const yes = document.createElement("button");
  yes.type = "button";
  yes.textContent = c.confirmLabel || "Yes";
  if (c.danger) yes.classList.add("destructiveAction");
  yes.addEventListener("click", (e) => {
    e.stopPropagation();
    settleAppMenuConfirm(true);
  });
  const no = document.createElement("button");
  no.type = "button";
  no.textContent = "No";
  no.addEventListener("click", (e) => {
    e.stopPropagation();
    settleAppMenuConfirm(false);
  });
  withMenuItemIcon(yes, () => (c.danger ? "selectTrash" : "luCheck"));
  withMenuItemIcon(no, () => "luX");
  items.push(yes, no);
  return items;
}

// Render the confirm page into the (already open) app menu and put the cursor on
// the first option (Yes).
function renderAppMenuConfirmPage() {
  const menu = appActionMenuEl;
  if (!menu || !APP_MENU_CONFIRM) return;
  menu.innerHTML = "";
  menu.classList.add("appMenuDrillDown");
  buildAppMenuConfirmPageItems().forEach((el) => menu.appendChild(el));
  decorateNumberedMenuOptions(menu);
  ensureMenuHighlight(menu);
  positionActionMenuInPreviewDock(menu);
}

// Resolve a pending confirm and close the page. Clearing APP_MENU_CONFIRM first
// makes closeAppMenu's own settle-on-close a no-op, so the promise resolves once.
function settleAppMenuConfirm(value) {
  const c = APP_MENU_CONFIRM;
  if (!c) return;
  APP_MENU_CONFIRM = null;
  allowMenuClose();
  closeAppMenu();
  try {
    c.resolve(!!value);
  } catch {}
}

// Promise-based confirmation shown as an app-menu page (Yes / No). Drop-in for
// showConfirmDialog in flows that run while the app menu is open; falls back to
// the legacy dialog when it is not (e.g. a keybind-triggered action).
function showAppMenuConfirm(message, opts = {}) {
  const options = opts && typeof opts === "object" ? opts : {};
  if (!appActionMenuEl || !appActionMenuEl.classList.contains("open")) {
    return showConfirmDialog(message, options);
  }
  return new Promise((resolve) => {
    APP_MENU_CONFIRM = {
      title: "Are You Sure?",
      message: String(message == null ? "" : message),
      confirmLabel: options.okLabel || "Yes",
      danger: options.danger !== false,
      resolve,
    };
    // Hold the menu open through the async caller's await; Yes/No reopen the gate.
    suppressMenuAutoClose();
    renderAppMenuConfirmPage();
  });
}

// Rebuild the open app menu without closing it, then put the keyboard cursor
// and the open submenu chain back where they were.
let APP_MENU_REBUILD_GENERATION = 0;

function refreshOpenAppMenuInPlace() {
  if (!appActionMenuEl || !appActionMenuEl.classList.contains("open")) return;
  refreshAppMenuContents(captureNumberedMenuKeyState(appActionMenuEl));
}

function refreshAppMenuContents(keyState) {
  const menu = appActionMenuEl;
  if (!menu || !APP_MENU_STATE || !menu.classList.contains("open")) return;
  APP_MENU_REBUILD_GENERATION++;
  menu.innerHTML = "";
  menu.classList.add("appMenuDrillDown");
  buildAppMenuItems().forEach((item) => menu.appendChild(item));
  decorateNumberedMenuOptions(menu);
  applyNumberedMenuKeyState(menu, keyState);
  applyAppMenuFilterEditVisuals();
  // Rebuild can wipe the Controls edit/capture pills; re-apply them in place.
  if (APP_MENU_CONTROLS_EDIT_ID || APP_MENU_CONTROLS_CAPTURE_ID) {
    refreshAllAppMenuControlRows();
    const editRow = appMenuControlRowEl(
      APP_MENU_CONTROLS_EDIT_ID || APP_MENU_CONTROLS_CAPTURE_ID,
    );
    if (editRow) setMenuHighlight(menu, editRow);
  }
  positionActionMenuInPreviewDock(menu);
  focusAppMenuPresetRenameInput();
}

/* Two menus, one element, one mode flag.

   `app` is everything about the library and the app itself. It has no Selected
   Item section, is hard-bound to Tab, and lands wherever `Menu placement` says.

   `select` is only the selected item's own actions -- the section that used to
   sit at the top of the app menu, or whatever replaces it (an item in Trash or
   Storage gets a single Remove button instead). It keeps the old `openAppMenu`
   binding and still appears beside the item, because it is *about* that item
   and needs to be next to it.

   They share the element because only one can be open at a time; the mode is
   what `buildAppMenuItems` reads to decide which list to build. */
let APP_MENU_MODE = "app";

function appMenuModeIsSelect() {
  return APP_MENU_MODE === "select";
}

function isReservedSettingsMenuTabEvent(e) {
  return !!(
    e &&
    keybindValueFromEvent(e) === "Tab" &&
    !e.metaKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.shiftKey &&
    !e.repeat &&
    !isTextInputTarget(e.target)
  );
}

function resetAppMenuTransientStateForRebuild() {
  APP_MENU_FILTER_EDIT_KEY = "";
  APP_MENU_CONTROLS_EDIT_ID = "";
  APP_MENU_CONTROLS_EDIT_BTN = 0;
  APP_MENU_CONTROLS_CAPTURE_ID = "";
  APP_MENU_PRESET_RENAME_STATE = null;
  APP_MENU_PRESET_DELETE_CONFIRM_ID = "";
}

function openAppMenu(anchor, mode = "app") {
  allowMenuClose();
  if (!appActionMenuEl || !WS.root) return false;
  const wantSelect = mode === "select";
  // The select menu is about an item, so it needs one. The app menu does not:
  // Tab opens it whether or not anything is selected, and its placement can be
  // a window corner.
  const itemAnchor = anchor ? itemMenuAnchorElement(anchor) : null;
  if (wantSelect && !itemAnchor) return false;
  if (
    appActionMenuEl.classList.contains("open") &&
    APP_MENU_MODE === mode &&
    (!wantSelect || APP_MENU_STATE?.anchor === itemAnchor)
  ) {
    closeAppMenu();
    return true;
  }
  const replacingSharedMenu = appActionMenuEl.classList.contains("open");
  if (replacingSharedMenu) {
    resetAppMenuTransientStateForRebuild();
    if (APP_MENU_CONFIRM) {
      const confirmState = APP_MENU_CONFIRM;
      APP_MENU_CONFIRM = null;
      try {
        confirmState.resolve(false);
      } catch {}
    }
  } else {
    closeActionMenus();
  }
  APP_MENU_MODE = wantSelect ? "select" : "app";
  resetAppMenuJumpState();
  resetAddToTagCreateDraft();
  APP_MENU_CALENDAR_DAY_VIEW = "";
  APP_MENU_HISTORY_DAY_DELETE_CONFIRM = "";
  APP_MENU_HISTORY_DELETE_FOCUS_ROOT = "";
  const menu = appActionMenuEl;
  // A sidebar still sliding out is taken over rather than emptied under the
  // new menu (see syncAppMenuSidebar).
  cancelAppMenuSidebarClose();
  menu.innerHTML = "";
  menu.classList.add("appMenuDrillDown");
  menu.classList.toggle("appMenuSelectMode", wantSelect);
  buildAppMenuItems().forEach((item) => menu.appendChild(item));
  const openState = { anchor: itemAnchor };
  APP_MENU_STATE = openState;
  APP_MENU_DOCK_POS = null;
  requestAnimationFrame(() => {
    if (APP_MENU_STATE !== openState) return;
    menu.classList.add("open");
    positionActionMenuInPreviewDock(menu, { reanchor: true });
  });
  return true;
}

function openSelectMenu(anchor) {
  const summary = appMenuSelectionSummary();
  if (
    summary?.target?.kind === "dir" &&
    isTrashRootPortalNode(summary.target.node) &&
    !internalTrashHasItems()
  ) {
    if (appActionMenuEl?.classList?.contains("open") && appMenuModeIsSelect())
      closeAppMenu();
    return false;
  }
  return openAppMenu(anchor, "select");
}
