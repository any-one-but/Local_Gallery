/* Journal
   The daily journal editor. */

function closeScoreHistoryDayMenu() {
  const menu = document.getElementById("scoreHistoryDayMenu");
  if (menu) {
    menu.classList.remove("open", "fixed");
    menu.innerHTML = "";
    menu.style.left = "";
    menu.style.top = "";
  }
  SCORE_HISTORY_DAY_MENU_STATE = null;
}

function dailyJournalCloseIconHtml() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-x-icon lucide-x"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
}

function closeDailyJournalEditor() {
  const state = DAILY_JOURNAL_STATE;
  const overlay = document.getElementById("dailyJournalOverlay");
  if (overlay) overlay.remove();
  DAILY_JOURNAL_STATE = null;
  if (state && state.dateKey) {
    flushPendingMetadataSaveNow([META_DOC_IDS.dailyJournals]).catch(() => {});
    renderCalendarUi();
    setCalendarStatus("Saved");
  }
  // Back to the menu page the journal was opened from, as it was, rebuilt so
  // the Journal list and the calendar's dots show what was just written.
  if (state && state.fromAppMenu && appActionMenuEl) {
    appActionMenuEl.classList.remove("appMenuUnderJournal");
    if (APP_MENU_STATE && appActionMenuEl.classList.contains("open")) {
      refreshAppMenuContents(captureNumberedMenuKeyState(appActionMenuEl));
    }
  }
}

// `fromAppMenu`: opened from History (Journal list or a calendar day). The
// menu is left open and only hidden, so a hunt through entries is open,
// Escape, next row, open -- without the menu closing each time.
function openDailyJournalEditor(dateKey, { fromAppMenu = false } = {}) {
  const key = normalizeDailyJournalDateKey(dateKey);
  if (!key) return;
  closeScoreHistoryDayMenu();
  const keepMenu =
    !!fromAppMenu &&
    !!APP_MENU_STATE &&
    !!appActionMenuEl &&
    appActionMenuEl.classList.contains("open");
  if (keepMenu) appActionMenuEl.classList.add("appMenuUnderJournal");
  else {
    allowMenuClose();
    closeActionMenus();
  }
  const existing = document.getElementById("dailyJournalOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "dailyJournalOverlay";
  overlay.className = "dailyJournalOverlay";
  overlay.innerHTML = `
    <section class="dailyJournalDialog" role="dialog" aria-modal="true" aria-label="${escapeHtml(scoreHistoryDateLabel(key))} journal">
      <div class="dailyJournalHeader">
        <div class="dailyJournalHeading">
          <div class="dailyJournalKicker">Journal${scoreHistoryDayIsToday(key) ? " · Today" : ""}</div>
          <div class="dailyJournalTitle">${escapeHtml(scoreHistoryDateLabel(key))}</div>
        </div>
        <div class="dailyJournalHint">Saved as you type · Esc to close</div>
      </div>
      <textarea class="dailyJournalEditor" spellcheck="true" autocomplete="off" autocapitalize="sentences" placeholder="Write about this day..."></textarea>
    </section>
  `;
  document.body.appendChild(overlay);
  const textarea = overlay.querySelector(".dailyJournalEditor");
  DAILY_JOURNAL_STATE = { dateKey: key, textarea, fromAppMenu: keepMenu };
  if (textarea) {
    textarea.value = metaGetDailyJournal(key);
    textarea.addEventListener("input", () => {
      metaSetDailyJournal(key, textarea.value || "");
      setCalendarStatus("Saving...");
    });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
}

document.addEventListener(
  "keydown",
  (e) => {
    if (!DAILY_JOURNAL_STATE) return;
    // Fully own the keyboard while the journal is open (stopImmediatePropagation,
    // not just stopPropagation) so the History calendar overlay's own capture
    // listener underneath doesn't double-handle the same Escape and close too.
    e.stopImmediatePropagation();
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      closeDailyJournalEditor();
    }
  },
  true,
);
