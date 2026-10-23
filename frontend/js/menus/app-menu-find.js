/* Settings menu find
   Type a setting's name to find it, then land on it in its place (/ in the
   settings menu). */

/* ===== Settings menu find ===== */

// The settings menu holds well over a hundred rows, several levels deep. With
// it open, / swaps it for a field and a list of every row whose name matches
// what is typed, each with the way to it in grey ("Filters › Brightness").
// Choosing one does what the macOS Help menu does with a menu command: it
// does not run it, it opens the menu at that row with the cursor on it, so the
// row is used the ordinary way from there -- pressed, stepped into, or edited
// like any filter row -- and you can see where it lives.
//
// The list is read off the same rows the menu is built from
// (buildAppMenuItems), so it can never offer a row the menu does not have. A
// row is found by the key the menu restores its cursor with
// (menuOptionStateKey), and the way to it by its submenus' keys, which is the
// state applyNumberedMenuKeyState already knows how to open.
//
// While finding, the keys go to the field: letters type, ↑ ↓ move between
// matches, Return lands on the one picked, Esc goes back to the menu and Tab
// closes it. (The movement keys are letters, so they cannot move the cursor
// here -- they are being typed.)

let APP_MENU_FIND = null;
const APP_MENU_FIND_MAX_RESULTS = 14;
// History is a list of days and folders, not settings; Jump to... is the
// library itself. Neither is searched.
const APP_MENU_FIND_SKIPPED_SECTIONS = new Set(["History", "Jump to..."]);

function appMenuFindIsOpen() {
  return !!APP_MENU_FIND;
}

function appMenuFindRowName(el) {
  const clone = el.cloneNode(true);
  clone.querySelectorAll(".menuRowValue, .appMenuFilterValue, .dropdownMenuNum, .appMenuControlAssign, .appMenuControlClear, .dropdownMenuSubmenuCaret").forEach((n) => n.remove());
  return String(clone.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[●○]\s*/, "");
}

// Every row of the settings menu that does something, with the way to it.
function appMenuFindCandidates() {
  const saved = APP_MENU_FIND;
  APP_MENU_FIND = null;
  let items = [];
  try {
    items = buildAppMenuItems();
  } finally {
    APP_MENU_FIND = saved;
  }
  const out = [];
  const walk = (children, path, names) => {
    for (const el of children) {
      if (!el || !el.classList) continue;
      if (el.classList.contains("dropdownMenuSubmenu")) {
        const trigger = el.querySelector(":scope > .dropdownMenuSubmenuTrigger");
        const panel = el.querySelector(":scope > .dropdownMenuSubmenuPanel");
        if (!trigger) continue;
        const name = appMenuFindRowName(trigger);
        const key = menuOptionStateKey(trigger);
        // A cycler is one setting, not a section: it is a match itself.
        if (el.classList.contains("menuCycleSubmenu") || !panel) {
          out.push({ name, key, path, names, icon: trigger.querySelector(".appIcon") });
          continue;
        }
        if (!path.length && APP_MENU_FIND_SKIPPED_SECTIONS.has(name)) continue;
        walk(panel.children, path.concat(key), names.concat(name));
        continue;
      }
      if (el.tagName !== "BUTTON" || el.disabled) continue;
      const name = appMenuFindRowName(el);
      if (!name) continue;
      out.push({ name, key: menuOptionStateKey(el), path, names, icon: el.querySelector(".appIcon") });
    }
  };
  walk(items, [], []);
  return out;
}

function appMenuFindMatches(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const scored = [];
  for (const c of APP_MENU_FIND.candidates) {
    const name = c.name.toLowerCase();
    const where = c.names.join(" ").toLowerCase();
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.split(/[\s/-]+/).some((w) => w.startsWith(q))) score = 1;
    else if (name.includes(q)) score = 2;
    else if (where.includes(q)) score = 3;
    if (score >= 0) scored.push({ c, score });
  }
  scored.sort((a, b) => a.score - b.score || a.c.names.length - b.c.names.length);
  return scored.slice(0, APP_MENU_FIND_MAX_RESULTS).map((s) => s.c);
}

function appMenuFindResultButton(match, index) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "appMenuFindResult";
  btn.dataset.menuStateKey = `find:${index}:${match.path.join("/")}/${match.key}`;
  btn.setAttribute("data-action", "keep");
  const icon = match.icon ? match.icon.outerHTML : "";
  btn.innerHTML =
    `<span class="dropdownMenuSubmenuLabelWithIcon menuRowWithValue">${icon}` +
    `<span class="appMenuFindName">${escapeHtml(match.name)}</span>` +
    `<span class="menuRowValue appMenuFindWhere">${escapeHtml(match.names.join(" › "))}</span></span>`;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    revealAppMenuFindMatch(match);
  });
  return btn;
}

function appMenuFindEmptyRow(text) {
  const row = document.createElement("div");
  row.className = "appMenuFindEmpty";
  row.textContent = text;
  return row;
}

// The find page: the heading, the field, and the matches.
function buildAppMenuFindItems() {
  const title = document.createElement("div");
  title.className = "dropdownMenuTitle";
  title.textContent = "Find a setting";
  const field = document.createElement("div");
  field.className = "appMenuFindField";
  const input = document.createElement("input");
  input.type = "text";
  input.id = "appMenuFindInput";
  input.className = "tagEditInput";
  input.placeholder = "Setting name";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.value = APP_MENU_FIND.query;
  input.addEventListener("input", () => {
    APP_MENU_FIND.query = input.value;
    APP_MENU_FIND.index = 0;
    renderAppMenuFindResults();
  });
  input.addEventListener("keydown", handleAppMenuFindKey);
  field.appendChild(input);
  return [title, field].concat(appMenuFindResultItems());
}

function appMenuFindResultItems() {
  if (!String(APP_MENU_FIND.query || "").trim()) {
    return [appMenuFindEmptyRow("Type part of a setting's name.")];
  }
  APP_MENU_FIND.matches = appMenuFindMatches(APP_MENU_FIND.query);
  if (!APP_MENU_FIND.matches.length) return [appMenuFindEmptyRow("No setting has that name.")];
  return APP_MENU_FIND.matches.map(appMenuFindResultButton);
}

// Redraws only the matches, so the field keeps its caret.
function renderAppMenuFindResults() {
  const menu = appActionMenuEl;
  if (!menu || !APP_MENU_FIND) return;
  menu.querySelectorAll(":scope > .appMenuFindResult, :scope > .appMenuFindEmpty").forEach((el) => el.remove());
  appMenuFindResultItems().forEach((el) => menu.appendChild(el));
  highlightAppMenuFindResult();
  positionActionMenuInPreviewDock(menu);
}

function highlightAppMenuFindResult() {
  const menu = appActionMenuEl;
  const rows = Array.from(menu.querySelectorAll(":scope > .appMenuFindResult"));
  if (!rows.length) return clearMenuHighlight(menu);
  APP_MENU_FIND.index = Math.max(0, Math.min(APP_MENU_FIND.index, rows.length - 1));
  setMenuHighlight(menu, rows[APP_MENU_FIND.index]);
}

function focusAppMenuFindInput() {
  const input = document.getElementById("appMenuFindInput");
  if (!input) return;
  try {
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  } catch {}
}

function startAppMenuFind() {
  if (!appActionMenuEl || appMenuModeIsSelect()) return false;
  APP_MENU_FIND = { query: "", index: 0, matches: [], candidates: [] };
  APP_MENU_FIND.candidates = appMenuFindCandidates();
  suppressMenuAutoClose();
  refreshAppMenuContents(null);
  focusAppMenuFindInput();
  return true;
}

function endAppMenuFind(keyState = null) {
  if (!APP_MENU_FIND) return;
  APP_MENU_FIND = null;
  suppressMenuAutoClose();
  refreshAppMenuContents(keyState);
  const input = document.getElementById("appMenuFindInput");
  if (input) input.blur();
  if (document.activeElement && document.activeElement.id === "appMenuFindInput") {
    document.activeElement.blur();
  }
}

// Back to the menu, opened at the match with the cursor on it.
function revealAppMenuFindMatch(match) {
  if (!match) return;
  endAppMenuFind({ path: match.path.slice(), activeLabel: match.key, activeIndex: -1 });
}

function handleAppMenuFindKey(e) {
  // The field has the keyboard: nothing behind it sees these keys.
  e.stopPropagation();
  const key = String(e.key || "");
  if (key === "Escape") {
    e.preventDefault();
    endAppMenuFind(null);
    return;
  }
  if (key === "Tab") {
    e.preventDefault();
    APP_MENU_FIND = null;
    allowMenuClose();
    closeAppMenu();
    return;
  }
  if (key === "ArrowDown" || key === "ArrowUp") {
    e.preventDefault();
    APP_MENU_FIND.index += key === "ArrowDown" ? 1 : -1;
    highlightAppMenuFindResult();
    return;
  }
  if (key === "Enter") {
    e.preventDefault();
    const match = (APP_MENU_FIND.matches || [])[APP_MENU_FIND.index];
    if (match && String(APP_MENU_FIND.query || "").trim()) revealAppMenuFindMatch(match);
  }
}
