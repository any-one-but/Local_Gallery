/* App menu: History
   Stats, Calendar, a day's page and Journal. */

// ---------------------------------------------------------------------------
// History in the app menu (Miscellaneous -> History -> Stats / Calendar). Both
// are real app-menu submenu panels navigated by the keyboard like the rest of
// the menu: Stats is a list of root folders (name + score bar, view-only);
// Calendar is a compact month grid whose day cursor the movement keys walk and
// whose enter key opens that day's journal.
// ---------------------------------------------------------------------------

function buildHistoryCalendarMonthsHtml() {
  const history = normalizeScoreHistoryList(
    WS.meta && Array.isArray(WS.meta.scoreHistory) ? WS.meta.scoreHistory : [],
  );
  WS.meta.scoreHistory = history;
  const includeHidden = includeHiddenItemsInStatsEnabled();
  const hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext();
  const grouped = new Map();
  for (let i = 0; i < history.length; i++) {
    const rows = getRootScoreHistoryLinesForEntry(history[i], includeHidden, hiddenContext);
    for (let j = 0; j < rows.length; j++) {
      const dayKey = scoreHistoryDateKey(rows[j].at);
      const monthKey = scoreHistoryMonthKeyFromDateKey(dayKey);
      if (!monthKey) continue;
      if (!grouped.has(monthKey)) grouped.set(monthKey, new Map());
      const monthDays = grouped.get(monthKey);
      const current = monthDays.get(dayKey) || { delta: 0, count: 0 };
      current.delta += Number(rows[j].delta) || 0;
      current.count += 1;
      monthDays.set(dayKey, current);
    }
  }
  const journalDateKeys = metaGetDailyJournalDateKeys();
  for (let i = 0; i < journalDateKeys.length; i++) {
    const dayKey = journalDateKeys[i];
    const monthKey = scoreHistoryMonthKeyFromDateKey(dayKey);
    if (!monthKey) continue;
    if (!grouped.has(monthKey)) grouped.set(monthKey, new Map());
    const monthDays = grouped.get(monthKey);
    if (!monthDays.has(dayKey)) monthDays.set(dayKey, { delta: 0, count: 0 });
  }
  // Always render the current month (even with no activity) so today has a cell
  // and is visible when the calendar opens scrolled to the bottom.
  const currentMonthKey = scoreHistoryMonthKeyFromDateKey(scoreHistoryDateKey(Date.now()));
  if (currentMonthKey && !grouped.has(currentMonthKey)) grouped.set(currentMonthKey, new Map());
  const monthKeys = Array.from(grouped.keys()).sort((a, b) =>
    String(a).localeCompare(String(b)),
  );
  return monthKeys.length
    ? monthKeys
        .map((monthKey) => buildScoreHistoryMonthPageHtml(monthKey, grouped.get(monthKey)))
        .join("")
    : `<div class="scoreHistoryEmpty">No score changes logged yet.</div>`;
}

// -- Stats submenu: one view-only row per root folder ------------------------
//
// A ranked list, read top to bottom: the name, the score right-aligned and
// tinted by sign, and under it a diverging track whose fill runs out from the
// centre. Everything is drawn from theme tokens, so the panel is the same
// object in both themes rather than a dark slab that survives into light.

function formatAppMenuStatsScore(score) {
  const value = Number(score) || 0;
  return value > 0 ? `+${value}` : String(value);
}

function buildAppMenuStatsFolderButton(row, maxAbsScore) {
  const btn = document.createElement("button");
  btn.type = "button";
  const score = Number(row.score) || 0;
  const sign = score > 0 ? "positive" : score < 0 ? "negative" : "zero";
  btn.className = `appMenuStatsRow appMenuStatsRow-${sign}`;
  const widthPct = Math.max(0, Math.min(50, (Math.abs(score) / maxAbsScore) * 50));
  const leftPct = score >= 0 ? 50 : Math.max(0, 50 - widthPct);
  btn.innerHTML = `
    <span class="appMenuStatsName" title="${escapeHtml(row.path || "(root)")}">${escapeHtml(row.name || "(root)")}</span>
    <span class="appMenuStatsScore">${escapeHtml(formatAppMenuStatsScore(score))}</span>
    <span class="statsLedgerScoreBar" aria-hidden="true">
      <span class="statsLedgerScoreFill ${sign}" style="left:${leftPct.toFixed(3)}%;width:${widthPct.toFixed(3)}%;"></span>
    </span>
  `;
  // View-only: nothing can be done to a root folder from here.
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return btn;
}

// The one-line summary above the list. A div, not a button, so the option
// walker steps straight past it onto the first folder.
function buildAppMenuStatsSummaryEl(rows) {
  const total = rows.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
  const el = document.createElement("div");
  el.className = "appMenuStatsSummary";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML =
    `<span class="appMenuStatsSummaryLabel"></span>` +
    `<span class="appMenuStatsSummaryTotal appMenuStatsScore"></span>`;
  el.querySelector(".appMenuStatsSummaryLabel").textContent =
    `${rows.length} folder${rows.length === 1 ? "" : "s"}`;
  const totalEl = el.querySelector(".appMenuStatsSummaryTotal");
  totalEl.textContent = formatAppMenuStatsScore(total);
  totalEl.classList.add(
    total > 0 ? "positive" : total < 0 ? "negative" : "zero",
  );
  return el;
}

function buildAppMenuStatsSubmenu() {
  const includeHidden = includeHiddenItemsInStatsEnabled();
  const hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext();
  // Trash is a system location, not one of the library's folders, and a ranking
  // it can never meaningfully place in is a row of noise at the bottom.
  const rootRows = getVisibleRootFolderScoreRows(includeHidden, hiddenContext).filter(
    (row) => !isInternalTrashDirNode(WS.dirByPath.get(String(row.path || ""))),
  );
  if (!rootRows.length) return null;
  const sorted = rootRows
    .slice()
    .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const maxAbsScore = Math.max(1, ...sorted.map((r) => Math.abs(Number(r.score) || 0)));
  const submenu = createDropdownMenuSubmenu(
    "Stats",
    [buildAppMenuStatsSummaryEl(sorted)].concat(
      sorted.map((row) => buildAppMenuStatsFolderButton(row, maxAbsScore)),
    ),
  );
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuStatsPanel");
  return submenu;
}

// -- Calendar submenu: a compact month grid as an app-menu panel -------------

// Remembered so the day cursor survives an app-menu rebuild; defaults to today.
let APP_MENU_CALENDAR_SELECTED_DAY = "";

/* Opening a day replaces the month grid with that day's own page, in the same
   submenu. It is a page rather than a floating popup because the app menu is
   driven from the keyboard: as a page it is walked by the ordinary option
   walker, with no second surface to aim a cursor at. The grid itself has no
   options, so it needs handleAppMenuCalendarKey to drive it; the day page has
   nothing but options, so it needs no handler at all beyond the one key that
   steps back out. */
let APP_MENU_CALENDAR_DAY_VIEW = "";
// Deleting a whole day is confirmed in place, by pressing the same option
// twice, rather than through showAppMenuConfirm -- that page closes the menu on
// *either* answer, so cancelling would cost you the menu as well.
let APP_MENU_HISTORY_DAY_DELETE_CONFIRM = "";
// The folder row whose Delete cell currently has the cursor, if any. Same
// column-focus idea the Controls list uses: the row is a label, and Delete is a
// cell you step onto before it can do anything.
let APP_MENU_HISTORY_DELETE_FOCUS_ROOT = "";

function appMenuCalendarDayRows(dayKey) {
  const includeHidden = includeHiddenItemsInStatsEnabled();
  const hiddenContext = includeHidden ? null : createCalendarHiddenStatsContext();
  return getRootScoreHistoryLinesForDateKey(
    String(dayKey || ""),
    includeHidden,
    hiddenContext,
  );
}

// Rebuild the open app menu in place after a history edit, so the day page
// reflects the deletion without the menu closing or losing the cursor.
function refreshAppMenuAfterHistoryEdit() {
  const menu = appActionMenuEl;
  if (!menu || !menu.classList.contains("open")) return;
  const keyState = captureNumberedMenuKeyState(menu);
  suppressMenuAutoClose();
  refreshAppMenuContents(keyState);
}

/* One folder that moved on this day, laid out the way a Controls row is: the
   name is a label and does nothing, and Delete is a separate cell you step
   *right* onto before pressing it. Nothing on this page deletes on a single
   press of a row, which is the point -- the old shape put a whole folder's
   history one keystroke away from the cursor's resting place. */
function buildAppMenuCalendarDayFolderButton(dayKey, row) {
  const btn = document.createElement("button");
  btn.type = "button";
  const rootPath = String(row.rootPath || "");
  const delta = Number(row.delta) || 0;
  const sign = delta > 0 ? "positive" : delta < 0 ? "negative" : "zero";
  btn.className = `appMenuHistoryDayRow appMenuStatsRow-${sign}`;
  btn.dataset.appMenuHistoryRoot = rootPath;
  btn.dataset.menuStateKey = `history-day-root:${rootPath}`;
  btn.setAttribute("data-action", "keep");
  applyAppMenuCalendarDayFolderRow(btn, row);
  // Keyboard-only: the row itself is a label, and its Delete cell is reached
  // with the same right-step the Controls list uses.
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return btn;
}

function applyAppMenuCalendarDayFolderRow(btn, row) {
  const rootPath = String(row.rootPath || "");
  const label = String(row.rootLabel || rootPath || "(root)");
  const focused = APP_MENU_HISTORY_DELETE_FOCUS_ROOT === rootPath && !!rootPath;
  btn.classList.toggle("appMenuHistoryDayFocus", focused);
  btn.title = label;
  btn.innerHTML =
    `<span class="appMenuHistoryDayName"></span>` +
    `<span class="appMenuHistoryDayDelta"></span>` +
    `<span class="appMenuHistoryDayDelete">Delete</span>`;
  btn.querySelector(".appMenuHistoryDayName").textContent = label;
  btn.querySelector(".appMenuHistoryDayDelta").textContent =
    formatAppMenuStatsScore(Number(row.delta) || 0);
}

function appMenuHistoryDayRowEl(rootPath) {
  if (!appActionMenuEl) return null;
  const raw = String(rootPath || "");
  if (!raw) return null;
  const key = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(raw) : raw;
  return appActionMenuEl.querySelector(
    `.appMenuHistoryDayRow[data-app-menu-history-root="${key}"]`,
  );
}

// Move the Delete focus without rebuilding the menu, so the cursor and the open
// submenu chain stay exactly where they are.
function setAppMenuHistoryDeleteFocus(rootPath) {
  const previous = APP_MENU_HISTORY_DELETE_FOCUS_ROOT;
  APP_MENU_HISTORY_DELETE_FOCUS_ROOT = String(rootPath || "");
  for (const path of [previous, APP_MENU_HISTORY_DELETE_FOCUS_ROOT]) {
    const el = appMenuHistoryDayRowEl(path);
    if (el)
      el.classList.toggle(
        "appMenuHistoryDayFocus",
        String(path || "") === APP_MENU_HISTORY_DELETE_FOCUS_ROOT,
      );
  }
}

function deleteAppMenuHistoryDayRoot(dayKey, rootPath) {
  const root = String(rootPath || "");
  const label =
    appMenuHistoryDayRowEl(root)?.querySelector(".appMenuHistoryDayName")
      ?.textContent || root;
  const removed = removeScoreHistoryLinesByDateAndRoot(dayKey, root);
  if (removed > 0) {
    metaMarkDirty(META_DOC_IDS.scoreHistory);
    showStatusMessage(
      `Deleted ${removed} score change${removed === 1 ? "" : "s"} for ${label}.`,
    );
  } else {
    showStatusMessage("Nothing to delete.");
  }
  APP_MENU_HISTORY_DELETE_FOCUS_ROOT = "";
  APP_MENU_HISTORY_DAY_DELETE_CONFIRM = "";
  refreshAppMenuAfterHistoryEdit();
}

function buildAppMenuCalendarDaySubmenu(dayKey) {
  const key = String(dayKey || "");
  const rows = appMenuCalendarDayRows(key);
  const items = [];

  const title = document.createElement("div");
  title.className = "dropdownMenuTitle";
  title.setAttribute("aria-hidden", "true");
  title.textContent = `${scoreHistoryDateLabel(key)}${scoreHistoryDayIsToday(key) ? " · Today" : ""}`;
  items.push(title);

  if (rows.length) {
    const hint = document.createElement("div");
    hint.className = "appMenuConfirmMessage";
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "Step right onto Delete to remove a folder's changes.";
    items.push(hint);
    for (const row of rows)
      items.push(buildAppMenuCalendarDayFolderButton(key, row));
  } else {
    const empty = document.createElement("div");
    empty.className = "appMenuConfirmMessage";
    empty.setAttribute("aria-hidden", "true");
    empty.textContent = "No score changes on this day.";
    items.push(empty);
  }

  if (rows.length) {
    // A rule of its own rather than a border on the button below it: a
    // border-top on a rounded menu option squares its corners off.
    const rule = document.createElement("div");
    rule.className = "appMenuHistoryDayRule";
    rule.setAttribute("aria-hidden", "true");
    items.push(rule);
  }

  const journal = document.createElement("button");
  journal.type = "button";
  journal.className = "appMenuHistoryDayAction";
  journal.textContent = "Open in journal";
  journal.addEventListener("click", (e) => {
    e.stopPropagation();
    APP_MENU_HISTORY_DAY_DELETE_CONFIRM = "";
    openDailyJournalEditor(key, { fromAppMenu: true });
  });
  items.push(journal);

  if (rows.length) {
    const confirming = APP_MENU_HISTORY_DAY_DELETE_CONFIRM === key;
    const deleteAll = document.createElement("button");
    deleteAll.type = "button";
    deleteAll.className = "appMenuHistoryDayAction destructiveAction";
    deleteAll.textContent = confirming
      ? "Confirm delete"
      : "Delete this day";
    deleteAll.dataset.menuStateKey = "history-day-delete";
    deleteAll.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirming) {
        APP_MENU_HISTORY_DAY_DELETE_CONFIRM = key;
        refreshAppMenuAfterHistoryEdit();
        return;
      }
      APP_MENU_HISTORY_DAY_DELETE_CONFIRM = "";
      const removed = removeScoreHistoryEntriesByDateKey(key);
      if (removed > 0) {
        metaMarkDirty(META_DOC_IDS.scoreHistory);
        showStatusMessage(
          `Deleted ${removed} score log event${removed === 1 ? "" : "s"}.`,
        );
      }
      refreshAppMenuAfterHistoryEdit();
    });
    items.push(deleteAll);
  }

  const submenu = createDropdownMenuSubmenu("Calendar", items);
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuHistoryDayPanel");
  return submenu;
}

function buildAppMenuCalendarSubmenu() {
  if (APP_MENU_CALENDAR_DAY_VIEW)
    return buildAppMenuCalendarDaySubmenu(APP_MENU_CALENDAR_DAY_VIEW);
  const cal = document.createElement("div");
  cal.className = "appMenuCalendar";
  cal.innerHTML = buildHistoryCalendarMonthsHtml();
  const cells = Array.from(cal.querySelectorAll("[data-score-history-day]"));
  if (cells.length) {
    const keys = cells.map((c) => String(c.getAttribute("data-score-history-day") || ""));
    let idx = APP_MENU_CALENDAR_SELECTED_DAY ? keys.indexOf(APP_MENU_CALENDAR_SELECTED_DAY) : -1;
    if (idx < 0) idx = keys.indexOf(scoreHistoryDateKey(Date.now()));
    if (idx < 0) idx = cells.length - 1;
    cells[idx].classList.add("appMenuCalendarDaySelected");
    APP_MENU_CALENDAR_SELECTED_DAY = keys[idx];
  }
  return createDropdownMenuSubmenu("Calendar", [cal]);
}

function buildAppMenuHistorySubmenu() {
  return createDropdownMenuSubmenu("History", [
    buildAppMenuStatsSubmenu(),
    buildAppMenuCalendarSubmenu(),
    buildAppMenuJournalSubmenu(),
  ]);
}

/* History -> Journal: every day that has a journal entry, newest first, so a
   day can be found by what it was about. Each row is the date over the entry's
   headings as a comma list -- the "## <folder>" headings a score change adds
   (see markdownHeadingForRootScoreLine), or whatever the user rewrote them to.
   Pressing a row opens that day in the journal editor. The calendar is
   untouched; this is a second way in. */
function journalHeadingsForMarkdown(markdown) {
  const out = [];
  const seen = new Set();
  for (const raw of String(markdown || "").split(/\r?\n/)) {
    const m = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (!m) continue;
    const text = m[1].trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function buildAppMenuJournalDayButton(dateKey) {
  const key = String(dateKey || "");
  const headings = journalHeadingsForMarkdown(metaGetDailyJournal(key));
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "appMenuJournalRow";
  btn.dataset.menuStateKey = `journal-day:${key}`;
  const date = document.createElement("span");
  date.className = "appMenuJournalDate";
  date.textContent = `${scoreHistoryDateLabel(key)}${scoreHistoryDayIsToday(key) ? " · Today" : ""}`;
  const heads = document.createElement("span");
  heads.className = "appMenuJournalHeadings";
  heads.textContent = `  ${headings.length ? headings.join(", ") : "No headings"}`;
  if (!headings.length) heads.classList.add("appMenuJournalHeadingsEmpty");
  btn.append(date, heads);
  btn.setAttribute(
    "aria-label",
    `${date.textContent}${headings.length ? ": " + headings.join(", ") : ""}`,
  );
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    openDailyJournalEditor(key, { fromAppMenu: true });
  });
  return btn;
}

function buildAppMenuJournalSubmenu() {
  const keys = metaGetDailyJournalDateKeys().slice().reverse();
  const items = keys.map(buildAppMenuJournalDayButton);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "appMenuConfirmMessage";
    empty.setAttribute("aria-hidden", "true");
    empty.textContent = "No journal entries yet.";
    items.push(empty);
  }
  const submenu = createDropdownMenuSubmenu("Journal", items);
  submenu
    ?.querySelector?.(":scope > .dropdownMenuSubmenuPanel")
    ?.classList?.add("appMenuLongListPanel", "appMenuJournalPanel");
  return submenu;
}
