// Process-scoped session state, and the watchdog that brings a dead or wedged
// page back already unlocked and where it was. Mirrors src-tauri/src/session.rs,
// which explains the history; the short version is that the unlock flag lives
// in this process's memory and nowhere else, so quitting the app locks it and
// a reload does not.

"use strict";

const HEARTBEAT_INTERVAL_MS = 5000;
// Silence longer than this, while the window is focused, means the page is
// gone or wedged. Generous, so a big folder scan can never trip it.
const HEARTBEAT_DEADLINE_MS = 30000;
// Never reload twice in quick succession.
const RELOAD_COOLDOWN_MS = 90000;

const state = {
  unlocked: false,
  view: null,
  lastBeat: null,
  lastReload: null,
  reloads: 0,
};

function status() {
  return {
    unlocked: state.unlocked,
    resuming: state.lastBeat !== null,
    reloads: state.reloads,
    view: state.view,
  };
}

function setUnlocked(unlocked) {
  state.unlocked = unlocked;
  if (!unlocked) state.view = null;
}

function saveView(view) {
  state.view = view || null;
}

function heartbeat() {
  state.lastBeat = Date.now();
}

function shouldReloadNow() {
  if (state.lastBeat === null) return false;
  const now = Date.now();
  if (now - state.lastBeat < HEARTBEAT_DEADLINE_MS) return false;
  if (state.lastReload !== null && now - state.lastReload < RELOAD_COOLDOWN_MS) return false;
  state.lastReload = now;
  // The fresh page gets a full deadline before it could be reloaded again.
  state.lastBeat = now;
  state.reloads += 1;
  return true;
}

// A page whose renderer died is reloaded at once; one that has gone silent is
// crashed and reloaded, since a wedged main thread would never answer a plain
// reload. Only while the window is focused: an unfocused page's timers are
// throttled and its silence means nothing.
function startWatchdog(getWindow) {
  setInterval(() => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (!win.isFocused()) {
      if (state.lastBeat !== null) state.lastBeat = Date.now();
      return;
    }
    if (!shouldReloadNow()) return;
    const wc = win.webContents;
    try {
      wc.forcefullyCrashRenderer();
    } catch {}
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.reload();
    }, 250);
  }, HEARTBEAT_INTERVAL_MS);
}

module.exports = { status, setUnlocked, saveView, heartbeat, startWatchdog };
