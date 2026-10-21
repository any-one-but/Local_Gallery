/* App lock
   Session recovery, the lock gate (Touch ID or the Mac's password), hiding the
   library folder, and opening the managed library. The auto-open at launch is
   in boot.js. */

/* =========================================================
       App lock
       =========================================================

   An optional lock, asked at launch *before* the library is built. That
   ordering is the whole point: while the lock screen is up nothing has been
   scanned, no thumbnail has been asked for and no media URL exists, so there
   is nothing behind the overlay to glimpse -- it is not a curtain over a
   loaded app.

   The lock has no passcode of its own: Touch ID (or an Apple Watch) where the
   Mac has it, and the Mac's own login password, both checked by macOS
   (electron/system-auth.js and its helper). The lock screen is the whole UI --
   the fingerprint, a password field, the messages; macOS's dialog is never
   shown, because macOS will not put it in the middle of the screen. Touch ID
   waits while the screen is up and the field takes the password at the same
   time, whichever comes first.

   The record lives beside the other logs, in `<library>/.local-gallery/
   lock.log.json`, and says only whether the lock is on:
   `{ schema: 2, enabled: true, method: "system" }`. A record written by the
   old four-digit passcode (a salted hash) counts as on, so a library that was
   locked stays locked, now behind the Mac's own check; its hash is never read.

   Deliberately NOT in META_DOC_FILE_NAMES, so no metadata code path ever
   loads or rewrites it. It is a door, not encryption: the media on disk is
   untouched. */

const LOCK_DOC_FILE_NAME = "lock.log.json";

/* What the asking is for, as macOS records it with the Touch ID request. */
const LOCK_SYSTEM_REASONS = Object.freeze({
  unlock: "unlock your library",
  turnOn: "turn on the lock",
  turnOff: "turn off the lock",
  hide: "hide the gallery folder",
  show: "show the gallery folder",
});

/* === Session recovery ======================================================
   The page can go away underneath the user: WebKit kills the content process
   (memory), or a bad frame wedges it. Before this, either one cost the same two
   things — the unlock, and the place in the library you had browsed to.

   The native side (session.rs) keeps three facts for the life of the *app
   process*, on nothing but memory: whether the lock has been answered,
   where the page last was, and when the page last checked in. A reload
   therefore comes back unlocked and in place, while quitting the app still
   clears everything, which is what the lock is actually for.

   All of this is app-host only; a browser tab has no such process to remember
   into, and every call below degrades to a no-op there. */
const LG_SESSION = {
  active: false,
  resuming: false,
  view: null,
  viewConsumed: false,
  lastViewSignature: "",
  heartbeatTimer: 0,
  recordRead: false,
};

function lgSessionInvoke(cmd, args) {
  try {
    if (
      !window.electronAPI ||
      !window.electronAPI.isTauri ||
      !window.__TAURI__ ||
      !window.__TAURI__.core ||
      typeof window.__TAURI__.core.invoke !== "function"
    )
      return null;
    return window.__TAURI__.core.invoke(cmd, args || {});
  } catch {
    return null;
  }
}

/* Read the process's memory of this session before the library is opened. Must
   be awaited ahead of the lock gate, since it is what lets the gate skip. */
async function initSessionRecovery() {
  const p = lgSessionInvoke("session_status");
  if (!p) return;
  let status = null;
  try {
    status = await p;
  } catch {
    return;
  }
  if (!status || typeof status !== "object") return;
  LG_SESSION.active = true;
  LG_SESSION.resuming = !!status.resuming;
  LG_SESSION.view = status.view || null;
  if (status.unlocked) {
    // Already answered in this app run. A reload is not a new launch.
    LOCK_STATE.unlocked = true;
  }
  startSessionHeartbeat();
}

function markSessionUnlocked(unlocked) {
  lgSessionInvoke("session_set_unlocked", { unlocked: !!unlocked });
  if (!unlocked) {
    LG_SESSION.view = null;
    LG_SESSION.viewConsumed = true;
    LG_SESSION.lastViewSignature = "";
  }
}

/* The heartbeat is what the native watchdog waits on. It doubles as the trigger
   for saving the browsing location: the capture is only serialized when a cheap
   signature says the view actually moved, so an idle app does nothing. */
function startSessionHeartbeat() {
  if (LG_SESSION.heartbeatTimer) return;
  LG_SESSION.heartbeatTimer = window.setInterval(() => {
    lgSessionInvoke("session_heartbeat");
    try {
      saveSessionViewIfChanged();
    } catch {}
  }, 5000);
  lgSessionInvoke("session_heartbeat");
}

function sessionViewSignature() {
  const preview = WS.preview || {};
  return [
    String(WS.nav?.dirNode?.path || ""),
    String(preview.kind || ""),
    String(preview.fileId || ""),
    String(preview.dirNode?.path || ""),
    String(WS.view?.previewSelectedKey || ""),
  ].join("|");
}

function saveSessionViewIfChanged() {
  if (!LG_SESSION.active || !WS.root || !LOCK_STATE.unlocked) return;
  const signature = sessionViewSignature();
  if (signature === LG_SESSION.lastViewSignature) return;
  LG_SESSION.lastViewSignature = signature;
  let payload = "";
  try {
    const state = serializeLocationState(captureViewerCloseRestoreState());
    payload = state ? JSON.stringify(state) : "";
  } catch {
    return;
  }
  lgSessionInvoke("session_save_view", { view: payload });
}

/* Consumed once, by the first workspace build after a reload. A fresh launch
   has no stored view, and a later refresh in the same run must not be yanked
   back to where the page was before it died. */
function consumeSessionResumeView() {
  if (!LG_SESSION.active || !LG_SESSION.resuming) return null;
  if (LG_SESSION.viewConsumed) return null;
  LG_SESSION.viewConsumed = true;
  const raw = LG_SESSION.view;
  LG_SESSION.view = null;
  if (!raw) return null;
  try {
    return deserializeLocationState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/* The launch gate runs once per app run. `record` is the parsed file (or null),
   kept in memory so the menu can ask "is the lock on?" without touching disk,
   and `unlocked` is what stops a later library refresh re-asking. */
const LOCK_STATE = {
  record: null,
  unlocked: false,
};

/* The ask in progress (lockConfirmWithSystem), or null; and, when the checks
   could not run at launch, the Return that tries again. */
let LOCK_ASK = null;
let LOCK_RETRY = null;
let LOCK_KEY_HANDLER_BOUND = false;

function lockScreenEl() {
  return document.getElementById("lockScreen");
}

function lockScreenIsOpen() {
  const el = lockScreenEl();
  return !!(el && el.classList.contains("lockScreenOpen"));
}

/* --- The stored record ---------------------------------------------------- */

function lockRecordIsActive(rec) {
  return !!(rec && rec.enabled);
}

function lockIsOn() {
  return lockRecordIsActive(LOCK_STATE.record);
}

function lockMakeRecord(enabled) {
  return {
    schema: 2,
    enabled: !!enabled,
    method: "system",
    updatedAt: new Date().toISOString(),
  };
}

function lockParseRecord(text) {
  try {
    const obj = JSON.parse(String(text || ""));
    if (!obj || typeof obj !== "object") return null;
    // On when it says so: either the Mac's check, or an old passcode record
    // (hash and salt), which is now answered by the Mac's check instead.
    const on =
      obj.enabled !== false && (obj.method === "system" || !!(obj.hash && obj.salt));
    return {
      schema: 2,
      enabled: on,
      method: "system",
      updatedAt: obj.updatedAt || null,
    };
  } catch {
    return null;
  }
}

/* The metadata folder as a handle, from whichever host we are in. In the app it
   comes from the shim (which resolves the managed library even before a
   workspace exists); in the browser it has to come from the root the user just
   granted, which is why the browser callers pass one in. */
async function lockMetaDirHandle(rootHandle = null, { create = false } = {}) {
  if (rootHandle) {
    try {
      return await rootHandle.getDirectoryHandle(".local-gallery", { create });
    } catch {
      return null;
    }
  }
  if (WS && WS.meta && WS.meta.fsSysDirHandle) return WS.meta.fsSysDirHandle;
  const api = window.__lg;
  if (api && typeof api.getAppMetaDirectoryHandle === "function") {
    try {
      if (typeof api.ensureAppRoots === "function") await api.ensureAppRoots();
      return await api.getAppMetaDirectoryHandle();
    } catch {
      return null;
    }
  }
  return null;
}

async function lockReadRecord(rootHandle = null) {
  const dir = await lockMetaDirHandle(rootHandle);
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(LOCK_DOC_FILE_NAME, { create: false });
    const file = await fh.getFile();
    return lockParseRecord(await file.text());
  } catch {
    return null;
  }
}

async function lockWriteRecord(rec) {
  const dir = await lockMetaDirHandle(null, { create: true });
  if (!dir) return false;
  try {
    const fh = await dir.getFileHandle(LOCK_DOC_FILE_NAME, { create: true });
    const w = await fh.createWritable();
    await w.write(
      new TextEncoder().encode(JSON.stringify(rec || { enabled: false }, null, 2)),
    );
    await w.close();
    return true;
  } catch (err) {
    console.error("Could not save the lock setting.", err);
    return false;
  }
}

/* --- Asking macOS ----------------------------------------------------------- */

async function lockInvoke(cmd, args, fallback) {
  const p = lgSessionInvoke(cmd, args);
  if (!p) return fallback;
  try {
    return await p;
  } catch {
    return fallback;
  }
}

/* { available, biometrics }: available is false when the Mac has no password
   (nothing to check against), helper false when the checks cannot run. */
async function lockSystemStatus() {
  const st = await lockInvoke("system_auth_status", {}, null);
  if (!st || typeof st !== "object") return { available: false, biometrics: false, helper: false };
  return st;
}

/* --- The screen ----------------------------------------------------------- */

function lockPasswordEl() {
  return document.getElementById("lockPassword");
}

/* `asking` shows the password field; `touch` is Touch ID waiting for a finger
   (the glyph breathes); without it the glyph is dimmed. */
function lockSetScreen({
  title = "Local Gallery",
  sub = "",
  message = "",
  hint = "",
  asking = false,
  touch = false,
}) {
  const titleEl = document.getElementById("lockTitle");
  const subEl = document.getElementById("lockSub");
  const msgEl = document.getElementById("lockMessage");
  const hintEl = document.getElementById("lockHint");
  const el = lockScreenEl();
  if (titleEl) titleEl.textContent = String(title || "");
  if (subEl) subEl.textContent = String(sub || "");
  if (msgEl) msgEl.textContent = String(message || "");
  if (hintEl) hintEl.innerHTML = String(hint || "");
  if (el) {
    el.classList.toggle("lockAsking", !!asking);
    el.classList.toggle("lockTouchWaiting", !!(asking && touch));
  }
}

function lockRenderAsk(ask, { message = "" } = {}) {
  const touchHint = ask.biometrics && !ask.touch;
  lockSetScreen({
    title: ask.title,
    sub: ask.touch ? "Touch ID or your Mac password" : "Enter your Mac password",
    message,
    hint: [
      touchHint ? "<kbd>Return</kbd> with no password tries Touch ID again" : "",
      ask.retry ? "" : "<kbd>Esc</kbd> to cancel",
    ]
      .filter(Boolean)
      .join(" &middot; "),
    asking: true,
    touch: ask.touch,
  });
}

/* A "no" from the field: shaken, like the Mac's own password fields. */
function lockShakeField() {
  const field = lockPasswordEl();
  if (!field) return;
  field.classList.remove("lockShake");
  void field.offsetWidth;
  field.classList.add("lockShake");
}

function lockFocusField() {
  const field = lockPasswordEl();
  if (field && lockScreenIsOpen() && document.activeElement !== field) {
    try {
      field.focus({ preventScroll: true });
    } catch {}
  }
}

function lockStartTouchId(ask) {
  if (ask.done || ask.touch || !ask.biometrics) return;
  ask.touch = true;
  lockRenderAsk(ask);
  lockInvoke("system_auth_touchid", { reason: String(ask.reason || "") }, "failed").then(
    (answer) => {
      if (ask.done) return;
      ask.touch = false;
      if (answer === "ok") {
        lockFinishAsk(ask, "ok");
        return;
      }
      if (answer === "unavailable") ask.biometrics = false;
      lockRenderAsk(ask, {
        message:
          answer === "failed" ? "Touch ID didn’t work. Enter your Mac password." : "",
      });
    },
  );
}

async function lockSubmitPassword(ask) {
  const field = lockPasswordEl();
  if (!ask || ask.done || ask.checking || !field) return;
  const password = field.value;
  if (!password) {
    if (ask.biometrics && !ask.touch) lockStartTouchId(ask);
    else lockShakeField();
    return;
  }
  ask.checking = true;
  field.disabled = true;
  const answer = await lockInvoke("system_auth_password", { password }, "failed");
  ask.checking = false;
  field.disabled = false;
  if (ask.done) return;
  if (answer === "ok") {
    lockFinishAsk(ask, "ok");
    return;
  }
  field.value = "";
  lockRenderAsk(ask, {
    message:
      answer === "wrong"
        ? "Wrong password. Try again."
        : "macOS could not check the password. Try again.",
  });
  lockFocusField();
  lockShakeField();
}

function lockFinishAsk(ask, answer) {
  if (!ask || ask.done) return;
  ask.done = true;
  if (LOCK_ASK === ask) LOCK_ASK = null;
  if (ask.touch) lgSessionInvoke("system_auth_cancel", {});
  ask.touch = false;
  const field = lockPasswordEl();
  if (field) {
    field.value = "";
    field.blur();
  }
  try {
    ask.resolve(answer);
  } catch {}
}

/* The lock screen owns the keyboard outright while it is up: the handler runs
   in the capture phase and stops every key, so nothing can reach the app behind
   it (which, at launch, has not been built at all). While it is asking, typing
   is let through to the password field -- and only to it. */
function lockKeyHandler(e) {
  if (!lockScreenIsOpen()) return;
  e.stopImmediatePropagation();
  const ask = LOCK_ASK;
  if (e.key === "Escape") {
    e.preventDefault();
    if (e.repeat || !ask) return;
    if (!ask.retry) lockFinishAsk(ask, "cancel");
    else if (lockPasswordEl()) lockPasswordEl().value = "";
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (e.repeat) return;
    if (ask) lockSubmitPassword(ask);
    else if (LOCK_RETRY) {
      const retryNow = LOCK_RETRY;
      LOCK_RETRY = null;
      retryNow();
    }
    return;
  }
  if (ask && lockPasswordEl() && !ask.checking) {
    lockFocusField();
    return;
  }
  e.preventDefault();
}

function lockOpenScreen() {
  const el = lockScreenEl();
  if (!el) return;
  el.classList.add("lockScreenOpen");
  if (!LOCK_KEY_HANDLER_BOUND) {
    window.addEventListener("keydown", lockKeyHandler, true);
    LOCK_KEY_HANDLER_BOUND = true;
  }
}

function lockCloseScreen() {
  const el = lockScreenEl();
  if (el) el.classList.remove("lockScreenOpen", "lockAsking", "lockTouchWaiting");
  if (LOCK_ASK) lockFinishAsk(LOCK_ASK, "cancel");
  lockSetScreen({});
}

/* Ask for Touch ID or the Mac password, on the lock screen. `retry` (the
   launch gate) keeps asking until the owner answers -- there is no way out
   but in; without it, Escape gives up. Resolves with "ok", "cancel",
   "unavailable" (the Mac has no password, so there is nothing to ask) or
   "failed" (the checks cannot run). The screen is left up for the caller. */
async function lockConfirmWithSystem({ title = "Local Gallery", reason, retry = false }) {
  lockOpenScreen();
  if (LOCK_ASK) lockFinishAsk(LOCK_ASK, "cancel");
  lockSetScreen({ title, sub: "" });
  let st = await lockSystemStatus();
  // The checks cannot run (the helper is missing or broke). At launch that is
  // not a way in: the screen stays up and Return tries again.
  while (!st.available && st.helper === false && retry) {
    lockSetScreen({
      title,
      sub: "Locked",
      message: "macOS could not check it. Try again.",
      hint: "Press <kbd>Return</kbd> to try again",
    });
    await new Promise((r) => {
      LOCK_RETRY = r;
    });
    st = await lockSystemStatus();
  }
  if (!st.available) return st.helper === false ? "failed" : "unavailable";
  return new Promise((resolve) => {
    const ask = {
      resolve,
      title,
      reason,
      retry: !!retry,
      biometrics: !!st.biometrics,
      touch: false,
      checking: false,
      done: false,
    };
    LOCK_ASK = ask;
    const field = lockPasswordEl();
    if (field) field.value = "";
    lockRenderAsk(ask);
    lockStartTouchId(ask);
    requestAnimationFrame(lockFocusField);
  });
}

/* --- The launch gate ------------------------------------------------------ */

/* Called before the workspace is built. Returns once the library may be opened:
   immediately when the lock is off, otherwise only after macOS has confirmed
   the Mac's owner. There is no way out other than that (or quitting), which is
   what "nothing can be glimpsed" means. */
async function lockGateBeforeLibraryOpens(rootHandle = null, { record = null } = {}) {
  // Whatever happens next -- the lock screen, the boot splash, the loading
  // overlay -- is drawn in the library's own look, read from its file.
  try {
    await applyLibraryLookFromDisk(rootHandle);
  } catch {}
  if (LOCK_STATE.unlocked) {
    // A resumed run skipped the gate entirely, so the record was never read and
    // the Lock menu would think the lock was off. Read it once, here, and only
    // for that case — an ordinary refresh already has it.
    if (LG_SESSION.resuming && !LG_SESSION.recordRead) {
      LG_SESSION.recordRead = true;
      try {
        LOCK_STATE.record = await lockReadRecord(rootHandle);
      } catch {}
    }
    return true;
  }
  /* `record` is for re-locking without quitting: the library has just been torn
     down, and the record we already had in memory is the truth. */
  let rec = record || null;
  if (!rec) {
    try {
      rec = await lockReadRecord(rootHandle);
    } catch {
      rec = null;
    }
  }
  LOCK_STATE.record = rec;
  if (!lockRecordIsActive(rec)) {
    LOCK_STATE.unlocked = true;
    markSessionUnlocked(true);
    return true;
  }
  // Take the splash down: the lock screen is the thing to look at now.
  try {
    dismissBootSplash();
  } catch {}
  // "unavailable" means the Mac itself has no password to ask for, so it has
  // no lock either; refusing would only lock the owner out of their library.
  await lockConfirmWithSystem({ reason: LOCK_SYSTEM_REASONS.unlock, retry: true });
  LOCK_STATE.unlocked = true;
  markSessionUnlocked(true);
  lockCloseScreen();
  return true;
}

/* --- Turning it on and off ------------------------------------------------ */

/* Turning on asks first, so the lock is only ever put behind a check this Mac
   can actually answer. */
async function lockTurnOnFromMenu() {
  if (lockIsOn()) return;
  try {
    const answer = await lockConfirmWithSystem({
      title: "Turn on lock",
      reason: LOCK_SYSTEM_REASONS.turnOn,
    });
    lockCloseScreen();
    if (answer === "unavailable") {
      showStatusMessage("This Mac has no password to ask for, so the lock can't be turned on.");
      return;
    }
    if (answer !== "ok") {
      if (answer === "failed") showStatusMessage("macOS could not check it. The lock is still off.");
      return;
    }
    const rec = lockMakeRecord(true);
    if (!(await lockWriteRecord(rec))) {
      showStatusMessage("Could not turn the lock on.");
      return;
    }
    LOCK_STATE.record = rec;
    LOCK_STATE.unlocked = true;
    showStatusMessage("Lock on. Local Gallery will ask for Touch ID or your Mac password when it opens.");
  } catch (err) {
    console.error("Turning the lock on failed.", err);
    lockCloseScreen();
    showStatusMessage("Could not turn the lock on.");
  }
}

async function lockTurnOffFromMenu() {
  if (!lockIsOn()) return;
  try {
    const answer = await lockConfirmWithSystem({
      title: "Turn off lock",
      reason: LOCK_SYSTEM_REASONS.turnOff,
    });
    lockCloseScreen();
    if (answer !== "ok" && answer !== "unavailable") {
      if (answer === "failed") showStatusMessage("macOS could not check it. The lock is still on.");
      return;
    }
    if (!(await lockWriteRecord(lockMakeRecord(false)))) {
      showStatusMessage("Could not turn the lock off.");
      return;
    }
    LOCK_STATE.record = null;
    LOCK_STATE.unlocked = true;
    showStatusMessage("Lock off.");
  } catch (err) {
    console.error("Turning the lock off failed.", err);
    lockCloseScreen();
    showStatusMessage("Could not turn the lock off.");
  }
}

/* Lock the library again without quitting: the workspace is torn down first, so
   the screen behind the lock is as empty as it is at launch. */
async function lockNowFromMenu() {
  if (!lockIsOn()) return;
  const rec = LOCK_STATE.record;
  try {
    closeActionMenus();
  } catch {}
  try {
    resetWorkspace();
  } catch {}
  try {
    closeMusicPlayer();
    musicStop();
  } catch {}
  LOCK_STATE.unlocked = false;
  markSessionUnlocked(false);
  await lockGateBeforeLibraryOpens(null, { record: rec });
  // Unlocked again: reopen exactly the way boot does.
  try {
    await openFixedAppMediaFolder();
  } catch (err) {
    console.error("Reopening after lock failed.", err);
  }
}

/* --- Hiding the library folder from the OS -------------------------------- */

/* The managed library can sit under either of two names, `Local Gallery` or
   `.Local Gallery`, and the leading dot is the whole of the hidden state --
   there is no stored flag, so the folder's own name is the truth and renaming
   it by hand works exactly as the toggle does. `get_media_root` prefers the
   dotted one, which is what lets the app follow the folder either way.

   This is the app host only: a web page cannot rename the folder it was handed,
   and there is no single managed library there to rename. */

let MEDIA_FOLDER_HIDDEN = false;

function lockNativeInvoke() {
  const core = window.__TAURI__ && window.__TAURI__.core;
  return core && typeof core.invoke === "function" ? core.invoke : null;
}

function hiddenLibraryToggleSupported() {
  return !!(LG_HOST_IS_APP && lockNativeInvoke());
}

/* Read the state off disk. Called before the library opens (so the menu can
   render its marker without a round trip) and again after every change. */
async function refreshMediaFolderHiddenState() {
  const invoke = lockNativeInvoke();
  if (!invoke) return false;
  try {
    MEDIA_FOLDER_HIDDEN = !!(await invoke("media_folder_is_hidden"));
  } catch {
    MEDIA_FOLDER_HIDDEN = false;
  }
  return MEDIA_FOLDER_HIDDEN;
}

/* Rename the library, then reopen it. The order matters: pending metadata is
   flushed and the workspace torn down first, because every path the open
   library holds -- catalog shards, thumbnail cache, asset scopes -- names the
   old folder, and writing through one of them after the rename would put the
   file back at a path that no longer exists. */
async function toggleHiddenLibraryFromMenu() {
  const invoke = lockNativeInvoke();
  if (!invoke) return;
  const hidingNow = !MEDIA_FOLDER_HIDDEN;
  try {
    if (lockIsOn()) {
      const answer = await lockConfirmWithSystem({
        title: hidingNow ? "Hide gallery folder" : "Show gallery folder",
        reason: hidingNow ? LOCK_SYSTEM_REASONS.hide : LOCK_SYSTEM_REASONS.show,
      });
      if (answer !== "ok" && answer !== "unavailable") {
        lockCloseScreen();
        if (answer === "failed") showStatusMessage("macOS could not check it. Nothing was changed.");
        return;
      }
    }
    lockCloseScreen();
    try {
      await flushPendingMetadataSaveNow();
    } catch {}
    try {
      resetWorkspace();
    } catch {}
    await invoke("set_media_folder_hidden", { hidden: hidingNow });
    await refreshMediaFolderHiddenState();
    await openFixedAppMediaFolder();
    showStatusMessage(
      hidingNow
        ? "Gallery folder hidden — it is now “.Local Gallery”."
        : "Gallery folder visible again — “Local Gallery”.",
    );
  } catch (err) {
    console.error("Hiding the gallery folder failed.", err);
    lockCloseScreen();
    // Whatever went wrong, the library must not be left closed.
    try {
      await refreshMediaFolderHiddenState();
      if (!WS.root) await openFixedAppMediaFolder();
    } catch {}
    showStatusMessage(
      String(err && err.message ? err.message : err) ||
        "Could not change the gallery folder.",
    );
  }
}

function buildAppMenuLockSubmenu() {
  const on = lockIsOn();
  const items = on
    ? [
        appMenuChoiceButton("Lock now", () => lockNowFromMenu(), null, true),
        appMenuChoiceButton("Turn lock off", () => lockTurnOffFromMenu(), null, true),
      ]
    : [appMenuChoiceButton("Turn lock on", () => lockTurnOnFromMenu(), null, true)];
  if (hiddenLibraryToggleSupported()) {
    items.push(
      appMenuChoiceButton(
        "Hide gallery folder",
        () => toggleHiddenLibraryFromMenu(),
        MEDIA_FOLDER_HIDDEN,
        true,
      ),
    );
  }
  return createDropdownMenuSubmenu("Lock", items);
}

// --- Single managed media folder auto-open (Tauri app folder model) -----------


async function openFixedAppMediaFolder() {
  const api = window.__lg || window.electronAPI;
  if (!api || typeof api.getAppMediaDirectoryHandle !== "function") {
    // Not in the Tauri shim environment or old shim — fall back to classic picker flow.
    return false;
  }
  try {
    // Ensure asset scopes for media + metadata are granted early.
    if (typeof api.ensureAppRoots === "function") {
      await api.ensureAppRoots();
    }
    // The lock is answered here, before the library is scanned: nothing is
    // read, decoded or rendered until it is answered.
    await lockGateBeforeLibraryOpens();
    await refreshMediaFolderHiddenState();
    const handle = await api.getAppMediaDirectoryHandle();
    if (handle) {
      // Build workspace directly from the managed folder. This replaces the
      // old "user must pick a root" flow.
      await buildWorkspaceFromDirectoryHandle(handle, { silent: true });
      // No status message on initial silent startup
      return true;
    }
  } catch (err) {
    console.warn("Failed to auto-open managed media folder:", err);
    showStatusMessage("Could not open Local Gallery folder. Check permissions.");
  }
  return false;
}
