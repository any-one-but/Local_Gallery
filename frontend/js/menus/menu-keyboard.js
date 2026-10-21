/* Menu keyboard
   The option cursor, submenus and the menus' keyboard model. */

// Lucide chevron-right, used as the flyout indicator on every item-menu
// submenu trigger (Thumbnail / Media type / Aspect ratio / Filters).
const SUBMENU_CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const MAX_NUMBERED_ITEM_MENU_OPTIONS = 10;

// The app menu is navigation-only. It deliberately keeps the older menu
// helpers for cursor movement and submenu traversal, but does not expose
// number labels, digit activation, or ten-option pagination.
let BUILDING_NAVIGATION_ONLY_ACTION_MENU = false;

function isNavigationOnlyActionMenu(menu) {
  return !!(menu && menu.id === "appActionMenu");
}

function isNumberedItemMenu(menu) {
  if (!menu || !menu.classList?.contains("dropdownMenu")) return false;
  if (menu.classList.contains("dropdownMenuSubmenuPanel")) return false;
  if (menu.classList.contains("optSelectMenu")) return false;
  if (
    menu.id === "directoriesActionMenu" ||
    menu.id === "tagActionMenu" ||
    menu.id === "previewActionMenu" ||
    menu.id === "appActionMenu"
  )
    return true;
  return !!menu.closest?.(".dirMenu");
}

function numberedMenuOptionsForPanel(panel) {
  if (!panel) return [];
  const out = [];
  for (const child of Array.from(panel.children || [])) {
    if (child.matches?.("button")) {
      out.push(child);
      continue;
    }
    if (child.classList?.contains("dropdownMenuSubmenu")) {
      const trigger = child.querySelector(
        ":scope > .dropdownMenuSubmenuTrigger",
      );
      if (trigger) out.push(trigger);
      continue;
    }
    if (child.classList?.contains("menuTwoColRow")) {
      out.push(...Array.from(child.querySelectorAll(":scope > button")));
    }
  }
  return out.filter((btn) => !btn.hidden && btn.getAttribute("aria-hidden") !== "true");
}

function itemMenuNumberLabel(index) {
  return index === 9 ? "0" : String(index + 1);
}

function decorateNumberedMenuPanel(panel) {
  const options = numberedMenuOptionsForPanel(panel);
  for (let i = 0; i < options.length; i++) {
    const btn = options[i];
    btn.querySelectorAll(":scope > .dropdownMenuNum").forEach((el) => el.remove());
    btn.removeAttribute("data-menu-number");
    btn.removeAttribute("aria-keyshortcuts");
    if (i >= MAX_NUMBERED_ITEM_MENU_OPTIONS) continue;
    const label = itemMenuNumberLabel(i);
    const number = document.createElement("span");
    number.className = "dropdownMenuNum";
    number.setAttribute("aria-hidden", "true");
    number.textContent = label;
    btn.prepend(number);
    btn.dataset.menuNumber = label;
    btn.setAttribute("aria-keyshortcuts", label);
  }
}

function decorateNumberedMenuOptions(menu) {
  if (!isNumberedItemMenu(menu)) return;
  if (isNavigationOnlyActionMenu(menu)) {
    menu.querySelectorAll(".dropdownMenuNum").forEach((el) => el.remove());
    menu.querySelectorAll("[data-menu-number]").forEach((option) => {
      option.removeAttribute("data-menu-number");
      option.removeAttribute("aria-keyshortcuts");
    });
    return;
  }
  decorateNumberedMenuPanel(menu);
  menu
    .querySelectorAll(".dropdownMenuSubmenuPanel")
    .forEach((panel) => decorateNumberedMenuPanel(panel));
}

function setDropdownSubmenuOpen(submenu, open) {
  if (!submenu) return;
  const trigger = submenu.querySelector(
    ":scope > .dropdownMenuSubmenuTrigger",
  );
  submenu.classList.toggle("submenuOpen", !!open);
  if (!open) {
    submenu.classList.remove("submenuOpenLeft", "submenuOpenRight");
    const ownPanel = submenu.querySelector(
      ":scope > .dropdownMenuSubmenuPanel",
    );
    if (ownPanel) ownPanel.style.top = "";
  }
  if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
  if (!open) {
    submenu
      .querySelectorAll(".dropdownMenuSubmenu.submenuOpen")
      .forEach((nested) => setDropdownSubmenuOpen(nested, false));
  }
  const rootMenu = submenu.closest?.("#appActionMenu.open");
  if (rootMenu) {
    syncAppMenuDrillHeader(rootMenu);
    // Width can change when a wide section (Controls/Stats) opens or closes.
    positionActionMenuInPreviewDock(rootMenu);
  }
}

/* Moving between levels of the app menu is shown as movement, so it reads as a
   place you went into or came back out of: stepping into a level slides it in
   from the right, stepping back out slides the level you return to in from
   the left, both with a quick fade (the level you leave goes at once; the
   eye follows what arrives). The heading naming the level moves with it.
   Only the user's own steps call this -- a rebuild restoring the open levels
   after a setting changes does not, so the menu never moves on its own.
   `"in"` / `"out"`; `{ beside: true }` is a new Jump to... column opening
   beside the last, which grows out of it instead (from the left). */
const APP_MENU_LEVEL_SLIDE_PX = 18;
const APP_MENU_LEVEL_SLIDE_MS = 190;

function appMenuMotionAllowed() {
  try {
    return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
}

// What a level is on screen: the deepest open submenu's panel, or, at the
// top, the menu's own rows.
function appMenuVisibleLevelElements(menu) {
  const openSubs = Array.from(menu.querySelectorAll(".dropdownMenuSubmenu.submenuOpen"));
  let deepest = null;
  let deepestDepth = -1;
  for (const sub of openSubs) {
    let depth = 0;
    let cur = sub;
    while ((cur = cur.parentElement) && cur !== menu) {
      if (cur.classList?.contains("dropdownMenuSubmenu")) depth++;
    }
    if (depth > deepestDepth) {
      deepestDepth = depth;
      deepest = sub;
    }
  }
  if (deepest) {
    const panel = deepest.querySelector(":scope > .dropdownMenuSubmenuPanel");
    return panel ? [panel] : [];
  }
  return Array.from(menu.children).filter(
    (el) => !el.classList.contains("appMenuDrillHeader") && el.offsetParent !== null,
  );
}

function animateAppMenuElements(elements, fromX) {
  const keyframes = [
    { opacity: 0, transform: `translateX(${fromX}px)` },
    { opacity: 1, transform: "translateX(0)" },
  ];
  const timing = {
    duration: APP_MENU_LEVEL_SLIDE_MS,
    easing: "cubic-bezier(0.32, 0.72, 0, 1)",
  };
  for (const el of elements) {
    try {
      el.getAnimations?.().forEach((a) => a.cancel());
      el.animate(keyframes, timing);
    } catch {}
  }
}

function animateAppMenuLevel(menu, direction, { beside = false, target = null } = {}) {
  if (!menu || menu.id !== "appActionMenu" || !appMenuMotionAllowed()) return;
  const sign = direction === "out" ? -1 : 1;
  const fromX = beside ? -APP_MENU_LEVEL_SLIDE_PX * 0.6 : sign * APP_MENU_LEVEL_SLIDE_PX;
  const elements = target ? [target] : appMenuVisibleLevelElements(menu);
  animateAppMenuElements(elements, fromX);
  const header = menu.querySelector(":scope > .appMenuDrillHeader");
  if (header && !beside) animateAppMenuElements([header], sign * APP_MENU_LEVEL_SLIDE_PX * 0.5);
}

function openDropdownSubmenuForTrigger(trigger) {
  const submenu = trigger?.closest?.(".dropdownMenuSubmenu");
  if (!submenu) return false;
  const parentPanel = submenu.parentElement;
  for (const sibling of Array.from(parentPanel?.children || [])) {
    if (sibling !== submenu && sibling.classList?.contains("dropdownMenuSubmenu"))
      setDropdownSubmenuOpen(sibling, false);
  }
  submenu.classList.remove("submenuOpenLeft", "submenuOpenRight");
  setDropdownSubmenuOpen(submenu, true);
  const rootMenu = submenu.closest(".dropdownMenu.open");
  if (rootMenu) decorateNumberedMenuOptions(rootMenu);
  const flyout = submenu.querySelector(
    ":scope > .dropdownMenuSubmenuPanel",
  );
  const isAppMenu = !!(rootMenu && rootMenu.id === "appActionMenu");
  // Legacy context menus still fly out beside the trigger. The app menu is a
  // single-column drill-down, so it skips the side-panel placement entirely.
  if (rootMenu && flyout && !isAppMenu) {
    submenu.classList.add("submenuOpenRight");
    let flyoutRect = flyout.getBoundingClientRect();
    const baseTop = -5;
    let top = baseTop;
    if (flyoutRect.bottom > window.innerHeight - 8) {
      top -= flyoutRect.bottom - (window.innerHeight - 8);
    }
    if (flyoutRect.top + (top - baseTop) < 8) {
      top += 8 - (flyoutRect.top + (top - baseTop));
    }
    flyout.style.top = `${Math.round(top)}px`;
  }
  // The Calendar panel renders months oldest -> newest, so today sits at the
  // bottom: open it scrolled all the way down so today is always in view.
  const calEl = flyout?.querySelector?.(":scope > .appMenuCalendar");
  if (calEl) {
    const scrollToBottom = () => {
      calEl.scrollTop = calEl.scrollHeight;
    };
    scrollToBottom();
    requestAnimationFrame(scrollToBottom);
  }
  if (isAppMenu) {
    syncAppMenuDrillHeader(rootMenu);
    positionActionMenuInPreviewDock(rootMenu);
  }
  return true;
}

function deepestOpenNumberedSubmenuPanel(menu) {
  const openSubmenus = Array.from(
    menu?.querySelectorAll?.(".dropdownMenuSubmenu.submenuOpen") || [],
  ).filter((submenu) =>
    numberedMenuOptionsForPanel(
      submenu.querySelector(":scope > .dropdownMenuSubmenuPanel"),
    ).length,
  );
  if (!openSubmenus.length) return null;
  openSubmenus.sort((a, b) => {
    const depth = (el) => {
      let count = 0;
      let cur = el;
      while ((cur = cur.parentElement)) {
        if (cur.classList?.contains("dropdownMenuSubmenu")) count++;
      }
      return count;
    };
    return depth(b) - depth(a);
  });
  return openSubmenus[0].querySelector(
    ":scope > .dropdownMenuSubmenuPanel",
  );
}

function openNumberedItemMenu() {
  const menus = Array.from(document.querySelectorAll(".dropdownMenu.open"));
  for (let i = menus.length - 1; i >= 0; i--) {
    if (isNumberedItemMenu(menus[i])) return menus[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Keyboard-driven menu navigation
//
// While an item/app menu is open the arrow keys drive a highlighted option
// inside the menu instead of the file tree: Up/Down move within the deepest
// open panel, Right opens the highlighted submenu and steps into it, Left
// closes the current submenu, and Left at the top level closes the menu (you
// walk back out toward the spine). Enter activates. Legacy context menus keep
// their number shortcuts; the unified app menu intentionally does not.
//
// Because the file tree must not move while a menu is open, this handler runs
// in the capture phase and swallows every navigation key before the global
// keydown listener sees it.
// ---------------------------------------------------------------------------

const MENU_KEY_ACTIVE_CLASS = "menuKeyActive";
let PENDING_MENU_KEY_STATE = null;

// Label of an option with the number badge and the ●/○ toggle marker removed,
// so a state snapshot still matches its button after a toggle flipped it.
function menuOptionLabelText(btn) {
  if (!btn) return "";
  const clone = btn.cloneNode(true);
  clone.querySelectorAll(".dropdownMenuNum").forEach((el) => el.remove());
  return String(clone.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[●○]\s*/, "");
}

function menuOptionStateKey(btn) {
  const explicit = String(btn?.dataset?.menuStateKey || "");
  return explicit || menuOptionLabelText(btn);
}

function activeNumberedMenuPanel(menu) {
  return deepestOpenNumberedSubmenuPanel(menu) || menu;
}

function clearMenuHighlight(menu) {
  menu
    ?.querySelectorAll?.(`.${MENU_KEY_ACTIVE_CLASS}`)
    .forEach((el) => el.classList.remove(MENU_KEY_ACTIVE_CLASS));
}

function setMenuHighlight(menu, btn) {
  clearMenuHighlight(menu);
  if (!btn) return;
  btn.classList.add(MENU_KEY_ACTIVE_CLASS);
  try {
    // Controls panel: locked (disabled) rows sit above the first selectable
    // entry. scrollIntoView on that first entry only brings *it* into view, so
    // the locked header disappears and wrap-around can't recover it. When the
    // cursor is on the first selectable control, pin the panel scroll to the
    // true top so the greyed keys stay readable.
    const controlsPanel = btn.closest?.(".appMenuControlsPanel");
    if (controlsPanel) {
      const selectable = numberedMenuOptionsForPanel(controlsPanel).filter(
        (option) => !option.disabled,
      );
      if (selectable[0] === btn) {
        controlsPanel.scrollTop = 0;
        return;
      }
    }
    btn.scrollIntoView({ block: "nearest" });
  } catch {}
}

function highlightedMenuOption(menu) {
  const panel = activeNumberedMenuPanel(menu);
  return (
    numberedMenuOptionsForPanel(panel).find((btn) =>
      btn.classList.contains(MENU_KEY_ACTIVE_CLASS),
    ) || null
  );
}

const MENU_PANELS_CLAMPING_AT_ENDS = Object.freeze([
  "appMenuControlsPanel",
  "appMenuStatsPanel",
  "appMenuLongListPanel",
]);

function moveMenuHighlight(menu, delta) {
  const panel = activeNumberedMenuPanel(menu);
  const options = numberedMenuOptionsForPanel(panel).filter(
    (btn) => !btn.disabled,
  );
  if (!options.length) return;
  const current = options.findIndex((btn) =>
    btn.classList.contains(MENU_KEY_ACTIVE_CLASS),
  );
  // Controls and Stats are long scrollable lists — clamp at the ends so Up/Down
  // (and the wheel, which routes through the same highlight move) stop instead
  // of wrapping around. Shorter menus still wrap.
  const clampAtEnds = MENU_PANELS_CLAMPING_AT_ENDS.some((cls) =>
    panel?.classList?.contains(cls),
  );
  let next;
  if (current < 0) {
    next = delta > 0 ? 0 : options.length - 1;
  } else if (clampAtEnds) {
    next = Math.max(0, Math.min(options.length - 1, current + delta));
  } else {
    next = (current + delta + options.length) % options.length;
  }
  setMenuHighlight(menu, options[next]);
}

function submenuPanelForTrigger(trigger) {
  return (
    trigger
      ?.closest?.(".dropdownMenuSubmenu")
      ?.querySelector(":scope > .dropdownMenuSubmenuPanel") || null
  );
}

// Snapshot of "where the keyboard is" in a menu, expressed as labels rather
// than element refs so it survives the menu being torn down and rebuilt by a
// re-render (which is how item menus refresh their ●/○ markers).
function captureNumberedMenuKeyState(menu) {
  if (!menu) return null;
  const path = [];
  let panel = menu;
  for (;;) {
    const openSub = Array.from(panel.children || []).find(
      (child) =>
        child.classList?.contains("dropdownMenuSubmenu") &&
        child.classList.contains("submenuOpen"),
    );
    if (!openSub) break;
    const trigger = openSub.querySelector(
      ":scope > .dropdownMenuSubmenuTrigger",
    );
    const nextPanel = openSub.querySelector(
      ":scope > .dropdownMenuSubmenuPanel",
    );
    if (!trigger || !nextPanel) break;
    path.push(menuOptionStateKey(trigger));
    panel = nextPanel;
  }
  const active = highlightedMenuOption(menu);
  return {
    path,
    activeLabel: active ? menuOptionStateKey(active) : "",
    activeIndex: active ? numberedMenuOptionsForPanel(panel).indexOf(active) : -1,
  };
}

function applyNumberedMenuKeyState(menu, state) {
  if (!menu || !state) return;
  let panel = menu;
  for (const label of state.path || []) {
    const trigger = numberedMenuOptionsForPanel(panel).find(
      (btn) =>
        btn.classList.contains("dropdownMenuSubmenuTrigger") &&
        menuOptionStateKey(btn) === label,
    );
    if (!trigger) break;
    openDropdownSubmenuForTrigger(trigger);
    const nextPanel = submenuPanelForTrigger(trigger);
    if (!nextPanel) break;
    panel = nextPanel;
  }
  if (!state.activeLabel) return;
  const options = numberedMenuOptionsForPanel(panel);
  // An option can rename itself when toggled ("Blank" becomes
  // "Shuffle"), or drop out of the menu entirely — fall back to the
  // same slot so the cursor never silently vanishes.
  const target =
    options.find((btn) => menuOptionStateKey(btn) === state.activeLabel) ||
    options[Math.min(Math.max(state.activeIndex ?? -1, 0), options.length - 1)];
  if (target) setMenuHighlight(menu, target);
}

// Re-apply a snapshot for a few frames, because the render that rebuilds a menu
// after an action can land one or several frames later (and sometimes twice).
// The suppression window is re-armed on every tick so an async close arriving
// late in that sequence still cannot take the menu down.
function scheduleNumberedMenuKeyStateRestore(state) {
  if (!state) return;
  PENDING_MENU_KEY_STATE = state;
  let frames = 0;
  const tick = () => {
    if (PENDING_MENU_KEY_STATE !== state) return;
    const menu = openNumberedItemMenu();
    if (menu) {
      decorateNumberedMenuOptions(menu);
      applyNumberedMenuKeyState(menu, state);
    }
    if (++frames < 12) {
      suppressMenuAutoClose(400);
      requestAnimationFrame(tick);
    } else PENDING_MENU_KEY_STATE = null;
  };
  requestAnimationFrame(tick);
}

// The outermost menu an element belongs to (submenu panels are themselves
// .dropdownMenu nodes, which isNumberedItemMenu deliberately rejects).
function rootNumberedMenuFor(el) {
  let found = null;
  let cur = el?.closest?.(".dropdownMenu") || null;
  while (cur) {
    if (isNumberedItemMenu(cur)) found = cur;
    cur = cur.parentElement?.closest?.(".dropdownMenu") || null;
  }
  return found;
}

// Every option activation — mouse or keyboard, in any of these menus — passes
// through here first, so "changing a setting never closes the menu" holds no
// matter which handler the option happens to be wired to.
document.addEventListener(
  "click",
  (e) => {
    const btn = e.target?.closest?.("button");
    if (!btn) return;
    const menu = rootNumberedMenuFor(btn);
    if (!menu || !menu.classList.contains("open")) return;
    if (
      menu.id === "appActionMenu" &&
      APP_MENU_FILTER_EDIT_KEY &&
      btn.dataset.appMenuFilterControl !== APP_MENU_FILTER_EDIT_KEY
    ) {
      stopAppMenuFilterEdit();
    }
    if (btn.classList.contains("dropdownMenuSubmenuTrigger")) return;
    if (btn.disabled) return;
    if (!isStickyItemMenuAction(btn.getAttribute("data-action") || "keep")) {
      allowMenuClose();
      return;
    }
    suppressMenuAutoClose();
    const keyState = captureNumberedMenuKeyState(menu);
    scheduleNumberedMenuKeyStateRestore(keyState);
    // The select menu is built from item-menu builders whose options only
    // change metadata; nothing redraws the menu afterwards, so a toggle's ●/○
    // (Exclusive, a preset, a media type...) would show its old state until the
    // menu was reopened. Rebuild once the option's own handlers have run, unless
    // the option already rebuilt it (cyclers do).
    if (menu.id === "appActionMenu" && appMenuModeIsSelect()) {
      const generation = APP_MENU_REBUILD_GENERATION;
      setTimeout(() => {
        if (generation !== APP_MENU_REBUILD_GENERATION) return;
        if (APP_MENU_CONFIRM || !appMenuModeIsSelect()) return;
        const active = document.activeElement;
        if (active && menu.contains(active) && isTextInputTarget(active)) return;
        refreshAppMenuContents(keyState);
      }, 0);
    }
  },
  true,
);

function enterMenuSubmenuFromTrigger(menu, trigger) {
  if (!trigger || trigger.disabled) return false;
  if (!trigger.classList.contains("dropdownMenuSubmenuTrigger")) return false;
  openDropdownSubmenuForTrigger(trigger);
  const panel = submenuPanelForTrigger(trigger);
  const first = panel
    ? numberedMenuOptionsForPanel(panel).filter((btn) => !btn.disabled)[0]
    : null;
  setMenuHighlight(menu, first || trigger);
  animateAppMenuLevel(menu, "in");
  return true;
}

function closeNumberedMenuFromKeyboard(menu) {
  const renderFilePane = !!menu?.closest?.("#directoriesPane");
  PENDING_MENU_KEY_STATE = null;
  allowMenuClose();
  closeActionMenus();
  if (renderFilePane) renderDirectoriesPane(true);
}

// The first option is selected as soon as a menu appears, so the exit/open keys
// always have something to act on without an orienting keypress first. The
// cursor also has to live in the panel the keys currently act on, so a stale
// highlight left behind in a parent panel is pulled down into the open submenu
// rather than treated as "already highlighted".
function ensureMenuHighlight(menu) {
  if (!menu || !isNumberedItemMenu(menu)) return;
  const options = numberedMenuOptionsForPanel(activeNumberedMenuPanel(menu));
  if (options.some((btn) => btn.classList.contains(MENU_KEY_ACTIVE_CLASS)))
    return;
  const first = options.filter((btn) => !btn.disabled)[0];
  if (first) setMenuHighlight(menu, first);
}

// Left: step back out one level, or leave the menu entirely from the top level.
function collapseOrCloseNumberedMenu(menu) {
  if (menu?.id === "appActionMenu") {
    stopAppMenuFilterEdit();
    stopAppMenuControlsEdit();
  }
  // Prefer the deepest open submenu by DOM nesting (including empty panels
  // like Calendar) so left always steps back one level in the app menu.
  let submenu = null;
  if (menu?.id === "appActionMenu") {
    const openSubs = Array.from(
      menu.querySelectorAll(".dropdownMenuSubmenu.submenuOpen") || [],
    );
    openSubs.sort((a, b) => {
      const depth = (el) => {
        let count = 0;
        let cur = el;
        while ((cur = cur.parentElement)) {
          if (cur.classList?.contains("dropdownMenuSubmenu")) count++;
        }
        return count;
      };
      return depth(b) - depth(a);
    });
    submenu = openSubs[0] || null;
  } else {
    const panel = deepestOpenNumberedSubmenuPanel(menu);
    submenu = panel?.closest?.(".dropdownMenuSubmenu") || null;
  }
  if (submenu) {
    const trigger = submenu.querySelector(
      ":scope > .dropdownMenuSubmenuTrigger",
    );
    setDropdownSubmenuOpen(submenu, false);
    setMenuHighlight(menu, trigger);
    if (menu.id === "appActionMenu") positionActionMenuInPreviewDock(menu);
    animateAppMenuLevel(menu, "out");
    return;
  }
  closeNumberedMenuFromKeyboard(menu);
}

function activateNumberedMenuOption(menu, option) {
  if (!option || option.disabled) return;
  if (option.classList.contains("dropdownMenuSubmenuTrigger")) {
    if (option.dataset.keyboardEnterSubmenu === "true") {
      enterMenuSubmenuFromTrigger(menu, option);
      return;
    }
    if (option.dataset.appMenuHybrid === "true") {
      setMenuHighlight(menu, option);
      option.click();
      return;
    }
    enterMenuSubmenuFromTrigger(menu, option);
    return;
  }
  // Activating an option moves the cursor there too, so the highlight always
  // sits on the option that was just chosen.
  setMenuHighlight(menu, option);
  // The menu deliberately stays open when an option is chosen, so remember the
  // cursor position across whatever re-render the action triggers.
  scheduleNumberedMenuKeyStateRestore(captureNumberedMenuKeyState(menu));
  option.click();
}

// An open menu takes the whole keyboard. It runs on the user's own navigation
// bindings (selectUp/Down walk the options, selectLeft/Right close and open
// submenus, the open key activates, the exit key closes the menu outright), and
// every other key is swallowed so nothing can reach the file tree behind it —
// no selection move, no folder change, no bound toggle. Escape is kept as a
// fixed way out in case the exit action is left unbound.
document.addEventListener(
  "keydown",
  (e) => {
    const menu = openNumberedItemMenu();
    if (!menu || isTextInputTarget(e.target)) return;

    // Bare modifier presses are not commands; let them through untouched.
    if (/^(Shift|Control|Alt|Meta)$/.test(String(e.key || ""))) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    // The user is driving again, so stop any in-flight restore from an earlier
    // activation before it can pull the cursor back to where it used to be.
    PENDING_MENU_KEY_STATE = null;

    // While capturing a keybind for a Controls row, every key -- including
    // Escape (which cancels) -- goes to the capture handler, not the menu's
    // normal Escape-closes-menu path.
    if (menu.id === "appActionMenu" && APP_MENU_CONTROLS_CAPTURE_ID) {
      handleAppMenuControlsKey(menu, "", e);
      return;
    }

    if (menu.id === "appActionMenu" && isReservedSettingsMenuTabEvent(e)) {
      if (appMenuModeIsSelect()) toggleAppMenuFromReservedKey();
      else closeNumberedMenuFromKeyboard(menu);
      return;
    }

    if (e.key === "Escape") {
      closeNumberedMenuFromKeyboard(menu);
      return;
    }

    decorateNumberedMenuOptions(menu);
    ensureMenuHighlight(menu);

    const key = keybindValueFromEvent(e);
    const action = key ? keybindActionFor(key) : "";

    if (menu.id === "appActionMenu" && action === "openAppMenu" && !appMenuModeIsSelect()) {
      openAppMenuForSelectionKeybindAction();
      return;
    }

    if (menu.id === "appActionMenu" && APP_MENU_FILTER_EDIT_KEY) {
      switch (action) {
        case "selectUp":
          stepAppMenuFilterEdit(1);
          return;
        case "selectDown":
          stepAppMenuFilterEdit(-1);
          return;
        case "selectLeft":
          stopAppMenuFilterEdit();
          return;
        case "leaveDir":
          closeNumberedMenuFromKeyboard(menu);
          return;
        default:
          return;
      }
    }

    // When the Jump to... tree is open, the movement keys walk it and the enter
    // key jumps the view instead of the normal option walker.
    if (menu.id === "appActionMenu" && handleAppMenuJumpKey(menu, action, e)) {
      return;
    }

    // The day page is walked by the ordinary option walker; the Delete cells and
    // the step back to the month grid are what have to be intercepted.
    if (menu.id === "appActionMenu" && handleAppMenuHistoryDayKey(menu, action, e)) {
      return;
    }

    // When the History -> Calendar panel is open, the movement keys walk its day
    // grid and the enter key opens that day's page instead of the normal
    // option walker.
    if (menu.id === "appActionMenu" && handleAppMenuCalendarKey(menu, action, e)) {
      return;
    }

    // Controls submenu: while a row's Assign/Clear options are open (or a key is
    // being captured), route keys there instead of the normal option walker.
    if (handleAppMenuControlsKey(menu, action, e)) {
      return;
    }

    switch (action) {
      case "selectUp":
        moveMenuHighlight(menu, -1);
        return;
      case "selectDown":
        moveMenuHighlight(menu, 1);
        return;
      case "selectRight":
        {
          const highlighted = highlightedMenuOption(menu);
          if (highlighted?.dataset?.appMenuFilterControl) {
            highlighted.click();
            return;
          }
          // A control row opens its Assign/Clear options instead of a submenu.
          if (highlighted?.dataset?.appMenuControl) {
            startAppMenuControlsEdit(highlighted.dataset.appMenuControl);
            return;
          }
          enterMenuSubmenuFromTrigger(menu, highlighted);
        }
        return;
      case "selectLeft":
        // Step back out one level; from the top level this leaves the menu.
        collapseOrCloseNumberedMenu(menu);
        return;
      // Enter activates the highlighted option; the app-menu key (Tab) instead
      // toggles the menu shut while it is open, rather than confirming.
      case "enterDir":
        if (e.repeat) return;
        {
          const highlighted = highlightedMenuOption(menu);
          // Control rows: Enter opens Assign/Clear (same as selectRight), since
          // they have no click action of their own.
          if (highlighted?.dataset?.appMenuControl) {
            startAppMenuControlsEdit(highlighted.dataset.appMenuControl);
            return;
          }
          activateNumberedMenuOption(menu, highlighted);
        }
        return;
      case "openAppMenu":
        closeNumberedMenuFromKeyboard(menu);
        return;
      case "leaveDir":
        closeNumberedMenuFromKeyboard(menu);
        return;
      default:
        break;
    }

    // The app menu is driven only by navigation actions.
    if (isNavigationOnlyActionMenu(menu)) return;

    // Other legacy context menus retain their number shortcuts.
    const digit = /^[0-9]$/.test(String(e.key || "")) ? String(e.key) : "";
    if (!digit || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const option = numberedMenuOptionsForPanel(
      activeNumberedMenuPanel(menu),
    ).find((btn) => btn.dataset.menuNumber === digit);
    if (!option || e.repeat) return;
    activateNumberedMenuOption(menu, option);
  },
  true,
);

function createDropdownMenuSubmenu(
  label,
  items,
  iconKey = "",
  behavior = null,
) {
  const config = behavior && typeof behavior === "object" ? behavior : {};
  const buttons = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!buttons.length) return null;
  const panelItems =
    !BUILDING_NAVIGATION_ONLY_ACTION_MENU &&
    buttons.length > MAX_NUMBERED_ITEM_MENU_OPTIONS
      ? buttons
          .slice(0, MAX_NUMBERED_ITEM_MENU_OPTIONS - 1)
          .concat(
            createDropdownMenuSubmenu(
              "More...",
              buttons.slice(MAX_NUMBERED_ITEM_MENU_OPTIONS - 1),
            ),
          )
      : buttons;

  const wrap = document.createElement("div");
  wrap.className = "dropdownMenuSubmenu";
  wrap.addEventListener("click", (e) => e.stopPropagation());

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "dropdownMenuSubmenuTrigger";
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  if (config.stateKey)
    trigger.dataset.menuStateKey = String(config.stateKey || "");
  if (typeof config.onActivate === "function")
    trigger.dataset.appMenuHybrid = "true";
  if (config.keyboardEnterSubmenu)
    trigger.dataset.keyboardEnterSubmenu = "true";

  const labelSpan = document.createElement("span");
  if (iconKey) {
    labelSpan.className = "dropdownMenuSubmenuLabelWithIcon";
    labelSpan.innerHTML =
      `${appIconHtml(iconKey, "dropdownMenuItemTypeIcon")}` +
      `<span>${escapeHtml(String(label || ""))}</span>`;
  } else {
    labelSpan.textContent = String(label || "");
  }
  const caretSpan = document.createElement("span");
  caretSpan.className = "dropdownMenuSubmenuCaret";
  caretSpan.setAttribute("aria-hidden", "true");
  caretSpan.innerHTML = SUBMENU_CHEVRON_SVG;

  trigger.appendChild(labelSpan);
  trigger.appendChild(caretSpan);
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (typeof config.onActivate === "function") {
      const hostedInAppMenu = !!trigger.closest("#appActionMenu");
      const keyState = hostedInAppMenu
        ? captureNumberedMenuKeyState(appActionMenuEl)
        : null;
      if (hostedInAppMenu) suppressMenuAutoClose();
      const shouldRefresh = config.onActivate() !== false;
      if (hostedInAppMenu && shouldRefresh)
        refreshAppMenuContents(keyState);
      return;
    }
    const open = !wrap.classList.contains("submenuOpen");
    if (open) openDropdownSubmenuForTrigger(trigger);
    else setDropdownSubmenuOpen(wrap, false);
  });

  const panel = document.createElement("div");
  panel.className = "dropdownMenu dropdownMenuSubmenuPanel";
  for (let i = 0; i < panelItems.length; i++) panel.appendChild(panelItems[i]);

  wrap.appendChild(trigger);
  wrap.appendChild(panel);
  return wrap;
}

document.addEventListener("pointerover", (e) => {
  const target = e.target;
  const submenu =
    target && target.closest ? target.closest(".dropdownMenuSubmenu") : null;
  if (!submenu) return;
  const menu = submenu.closest && submenu.closest(".dropdownMenu.open");
  if (!menu) return;
  openDropdownSubmenuForTrigger(
    submenu.querySelector(":scope > .dropdownMenuSubmenuTrigger"),
  );
});

document.addEventListener("pointerout", (e) => {
  const target = e.target;
  const submenu =
    target && target.closest ? target.closest(".dropdownMenuSubmenu") : null;
  if (!submenu) return;
  const related = e.relatedTarget;
  if (related && submenu.contains && submenu.contains(related)) return;
  setDropdownSubmenuOpen(submenu, false);
});

// Submenus emitted as HTML use the same click behavior as DOM-built submenus.
document.addEventListener("click", (e) => {
  const trigger = e.target?.closest?.(".dropdownMenuSubmenuTrigger");
  if (!trigger) return;
  const menu = trigger.closest(".dropdownMenu.open");
  if (!menu || !isNumberedItemMenu(menu)) return;
  e.stopPropagation();
  const submenu = trigger.closest(".dropdownMenuSubmenu");
  if (!submenu) return;
  if (submenu.classList.contains("submenuOpen"))
    setDropdownSubmenuOpen(submenu, false);
  else openDropdownSubmenuForTrigger(trigger);
});
