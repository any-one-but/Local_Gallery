/* Passcode lock
   Session recovery, the passcode gate, hiding the library folder, and opening
   the managed library. The auto-open at launch is in boot.js. */

/* =========================================================
       Passcode lock
       =========================================================

   An optional four-digit passcode, asked for at launch *before* the library is
   built. That ordering is the whole point: while the lock screen is up nothing
   has been scanned, no thumbnail has been asked for and no media URL exists, so
   there is nothing behind the overlay to glimpse -- it is not a curtain over a
   loaded app.

   The record lives beside the other logs, in `<library>/.local-gallery/
   lock.log.json`, and is read through an ordinary directory handle. That is the
   one interface both hosts share (the Tauri shim's TauriDirHandle answers the
   same calls as the browser's real one), so there is a single code path here
   rather than a native branch and a browser branch.

   Deliberately NOT in META_DOC_FILE_NAMES: a metadata archive is merged into a
   library wholesale, and an import that could install a passcode nobody knows
   would lock the owner out of their own library. Import and export leave it
   alone.

   What is stored is a salted, iterated hash, never the digits. Four digits is
   ten thousand possibilities, so this stops someone reading the passcode out of
   the file -- it is not encryption, and the media on disk is untouched. */

const LOCK_DOC_FILE_NAME = "lock.log.json";
const LOCK_HASH_ITERATIONS = 150000;
const LOCK_PIN_LENGTH = 4;

/* === Session recovery ======================================================
   The page can go away underneath the user: WebKit kills the content process
   (memory), or a bad frame wedges it. Before this, either one cost the same two
   things — the passcode, and the place in the library you had browsed to.

   The native side (session.rs) keeps three facts for the life of the *app
   process*, on nothing but memory: whether the passcode has been satisfied,
   where the page last was, and when the page last checked in. A reload
   therefore comes back unlocked and in place, while quitting the app still
   clears everything, which is what the passcode is actually for.

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
   kept in memory so the menu can ask "is a passcode set?" without touching
   disk, and `unlocked` is what stops a later library refresh re-asking. */
const LOCK_STATE = {
  record: null,
  unlocked: false,
};

/* The open prompt: one at a time, resolved by the key handler. */
let LOCK_PROMPT = null;
let LOCK_DIGITS = "";
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
  return !!(rec && rec.enabled && rec.hash && rec.salt);
}

function lockPasscodeIsSet() {
  return lockRecordIsActive(LOCK_STATE.record);
}

function lockParseRecord(text) {
  try {
    const obj = JSON.parse(String(text || ""));
    if (!obj || typeof obj !== "object") return null;
    if (!obj.hash || !obj.salt) return null;
    return {
      schema: 1,
      enabled: obj.enabled !== false,
      algo: obj.algo === "fallback" ? "fallback" : "pbkdf2",
      salt: String(obj.salt),
      hash: String(obj.hash),
      iterations: Math.max(1000, Number(obj.iterations) || LOCK_HASH_ITERATIONS),
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
    console.error("Could not save the passcode.", err);
    return false;
  }
}

/* --- Hashing -------------------------------------------------------------- */

function lockBytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function lockHexToBytes(hex) {
  const s = String(hex || "");
  const out = new Uint8Array(Math.floor(s.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16) || 0;
  }
  return out;
}

function lockRandomSaltHex() {
  const bytes = new Uint8Array(16);
  if (window.crypto && typeof window.crypto.getRandomValues === "function") {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  }
  return lockBytesToHex(bytes);
}

/* Used only where the browser's own key derivation is missing (it should never
   be, in either host). Kept so a passcode can still be set rather than the
   feature silently refusing, and the record records which one made it so
   checking always uses the same one. */
function lockFallbackHash(pin, saltHex, iterations) {
  const s = String(saltHex) + "|" + String(pin);
  const rounds = Math.max(1000, Math.min(Number(iterations) || 0, 20000));
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < rounds; i++) {
    for (let j = 0; j < s.length; j++) {
      h1 = (h1 ^ s.charCodeAt(j)) >>> 0;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = (h2 + h1 + i) >>> 0;
      h2 = Math.imul(h2, 2246822519) >>> 0;
    }
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

async function lockComputeHash(pin, saltHex, iterations, algo) {
  const subtle = window.crypto && window.crypto.subtle;
  if (algo !== "fallback" && subtle && subtle.importKey && subtle.deriveBits) {
    try {
      const key = await subtle.importKey(
        "raw",
        new TextEncoder().encode(String(pin)),
        "PBKDF2",
        false,
        ["deriveBits"],
      );
      const bits = await subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: lockHexToBytes(saltHex),
          iterations: Math.max(1000, Number(iterations) || LOCK_HASH_ITERATIONS),
          hash: "SHA-256",
        },
        key,
        256,
      );
      return { algo: "pbkdf2", hash: lockBytesToHex(new Uint8Array(bits)) };
    } catch {
      /* fall through to the plain one */
    }
  }
  return { algo: "fallback", hash: lockFallbackHash(pin, saltHex, iterations) };
}

async function lockMakeRecord(pin) {
  const salt = lockRandomSaltHex();
  const { algo, hash } = await lockComputeHash(pin, salt, LOCK_HASH_ITERATIONS, null);
  return {
    schema: 1,
    enabled: true,
    algo,
    salt,
    hash,
    iterations: LOCK_HASH_ITERATIONS,
    updatedAt: new Date().toISOString(),
  };
}

async function lockPinMatches(pin, rec) {
  if (!lockRecordIsActive(rec)) return false;
  const { hash } = await lockComputeHash(pin, rec.salt, rec.iterations, rec.algo);
  return hash === rec.hash;
}

/* --- The screen ----------------------------------------------------------- */

function lockRenderDots() {
  const dots = document.querySelectorAll("#lockDots .lockDot");
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle("lockDotFilled", i < LOCK_DIGITS.length);
  }
}

function lockSetMessage(text, calm = false) {
  const el = document.getElementById("lockMessage");
  if (!el) return;
  el.textContent = String(text || "");
  el.classList.toggle("lockMessageCalm", !!calm);
}

function lockFlashWrong() {
  const el = document.getElementById("lockDots");
  if (!el) return;
  el.classList.remove("lockDotsWrong");
  // Reading offsetWidth restarts the animation when the same class goes back on.
  void el.offsetWidth;
  el.classList.add("lockDotsWrong");
  window.setTimeout(() => {
    el.classList.remove("lockDotsWrong");
    LOCK_DIGITS = "";
    lockRenderDots();
  }, 440);
}

/* The lock screen owns the keyboard outright while it is up: the handler runs
   in the capture phase and stops every key, so nothing can reach the app behind
   it (which, at launch, has not been built at all). */
function lockKeyHandler(e) {
  if (!lockScreenIsOpen()) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (!LOCK_PROMPT) return;
  const key = e.key;
  if (key === "Escape") {
    if (LOCK_PROMPT.allowCancel) lockSettlePrompt(null);
    return;
  }
  if (key === "Backspace" || key === "Delete") {
    LOCK_DIGITS = LOCK_DIGITS.slice(0, -1);
    lockSetMessage("");
    lockRenderDots();
    return;
  }
  if (!/^[0-9]$/.test(key)) return;
  if (LOCK_DIGITS.length >= LOCK_PIN_LENGTH) return;
  LOCK_DIGITS += key;
  lockSetMessage("");
  lockRenderDots();
  if (LOCK_DIGITS.length === LOCK_PIN_LENGTH) {
    const entered = LOCK_DIGITS;
    // A beat, so the fourth dot is seen to fill before the screen moves on.
    window.setTimeout(() => lockSettlePrompt(entered), 110);
  }
}

function lockSettlePrompt(value) {
  const prompt = LOCK_PROMPT;
  if (!prompt) return;
  LOCK_PROMPT = null;
  try {
    prompt.resolve(value);
  } catch {}
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
  if (el) el.classList.remove("lockScreenOpen");
  LOCK_DIGITS = "";
  lockRenderDots();
  lockSetMessage("");
}

/* Ask for four digits. Resolves with the string, or null when the caller
   allowed Escape and Escape was pressed. The screen stays up between calls, so
   a wrong entry can simply ask again without flickering. */
function lockPromptDigits({ title, sub, hint = "", allowCancel = true }) {
  lockOpenScreen();
  const titleEl = document.getElementById("lockTitle");
  const subEl = document.getElementById("lockSub");
  const hintEl = document.getElementById("lockHint");
  if (titleEl) titleEl.textContent = String(title || "");
  if (subEl) subEl.textContent = String(sub || "");
  if (hintEl) hintEl.innerHTML = String(hint || "");
  LOCK_DIGITS = "";
  lockRenderDots();
  return new Promise((resolve) => {
    LOCK_PROMPT = { resolve, allowCancel: !!allowCancel };
  });
}

/* --- The launch gate ------------------------------------------------------ */

/* Called before the workspace is built. Returns once the library may be opened:
   immediately when no passcode is set, otherwise only after the right one is
   typed. There is no way out other than the right digits (or quitting), which
   is what "nothing can be glimpsed" means. */
async function lockGateBeforeLibraryOpens(rootHandle = null, { record = null } = {}) {
  // Whatever happens next -- the passcode screen, the boot splash, the
  // loading overlay -- is drawn in the library's own look, read from its file.
  try {
    await applyLibraryLookFromDisk(rootHandle);
  } catch {}
  if (LOCK_STATE.unlocked) {
    // A resumed run skipped the gate entirely, so the record was never read and
    // the Passcode menu would think none was set. Read it once, here, and only
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
     down, so in the browser host there is no longer a folder handle to read the
     file through, and the record we already had in memory is the truth. */
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
  lockOpenScreen();
  for (;;) {
    const pin = await lockPromptDigits({
      title: "Local Gallery",
      sub: "Enter your passcode",
      allowCancel: false,
    });
    if (await lockPinMatches(pin, rec)) {
      LOCK_STATE.unlocked = true;
      markSessionUnlocked(true);
      lockCloseScreen();
      return true;
    }
    lockFlashWrong();
    lockSetMessage("That passcode is not right.");
    // Let the shake finish before the next prompt clears the dots under it.
    await new Promise((r) => window.setTimeout(r, 460));
  }
}

/* --- Setting, changing, turning off --------------------------------------- */

/* Ask twice and require the two to agree, so a mistyped new passcode cannot
   lock the library. Returns the digits, or null if cancelled. */
async function lockAskForNewPasscode(title) {
  for (;;) {
    const first = await lockPromptDigits({
      title,
      sub: "Choose four digits",
      hint: "<kbd>Esc</kbd> to cancel",
    });
    if (first == null) return null;
    const second = await lockPromptDigits({
      title,
      sub: "Type them again",
      hint: "<kbd>Esc</kbd> to cancel",
    });
    if (second == null) return null;
    if (first === second) return first;
    lockFlashWrong();
    lockSetMessage("Those did not match. Try again.");
    await new Promise((r) => window.setTimeout(r, 460));
  }
}

/* Confirm the current passcode before changing or removing it. Returns true if
   it was given, false if cancelled. */
async function lockConfirmCurrentPasscode(title) {
  const rec = LOCK_STATE.record;
  if (!lockRecordIsActive(rec)) return true;
  for (;;) {
    const pin = await lockPromptDigits({
      title,
      sub: "Enter your current passcode",
      hint: "<kbd>Esc</kbd> to cancel",
    });
    if (pin == null) return false;
    if (await lockPinMatches(pin, rec)) return true;
    lockFlashWrong();
    lockSetMessage("That passcode is not right.");
    await new Promise((r) => window.setTimeout(r, 460));
  }
}

async function lockSetOrChangePasscodeFromMenu() {
  const changing = lockPasscodeIsSet();
  try {
    if (changing && !(await lockConfirmCurrentPasscode("Change passcode"))) {
      lockCloseScreen();
      return;
    }
    const pin = await lockAskForNewPasscode(changing ? "Change passcode" : "Set a passcode");
    if (pin == null) {
      lockCloseScreen();
      return;
    }
    const rec = await lockMakeRecord(pin);
    const ok = await lockWriteRecord(rec);
    lockCloseScreen();
    if (!ok) {
      showStatusMessage("Could not save the passcode.");
      return;
    }
    LOCK_STATE.record = rec;
    LOCK_STATE.unlocked = true;
    showStatusMessage(changing ? "Passcode changed." : "Passcode set.");
  } catch (err) {
    console.error("Passcode change failed.", err);
    lockCloseScreen();
    showStatusMessage("Could not save the passcode.");
  }
}

async function lockTurnOffPasscodeFromMenu() {
  if (!lockPasscodeIsSet()) return;
  try {
    if (!(await lockConfirmCurrentPasscode("Turn passcode off"))) {
      lockCloseScreen();
      return;
    }
    const ok = await lockWriteRecord({
      schema: 1,
      enabled: false,
      updatedAt: new Date().toISOString(),
    });
    lockCloseScreen();
    if (!ok) {
      showStatusMessage("Could not turn the passcode off.");
      return;
    }
    LOCK_STATE.record = null;
    LOCK_STATE.unlocked = true;
    showStatusMessage("Passcode turned off.");
  } catch (err) {
    console.error("Turning the passcode off failed.", err);
    lockCloseScreen();
    showStatusMessage("Could not turn the passcode off.");
  }
}

/* Lock the library again without quitting: the workspace is torn down first, so
   the screen behind the lock is as empty as it is at launch. */
async function lockNowFromMenu() {
  if (!lockPasscodeIsSet()) return;
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
    if (
      lockPasscodeIsSet() &&
      !(await lockConfirmCurrentPasscode(
        hidingNow ? "Hide gallery folder" : "Show gallery folder",
      ))
    ) {
      lockCloseScreen();
      return;
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

function buildAppMenuPasscodeSubmenu() {
  const isSet = lockPasscodeIsSet();
  const items = [
    appMenuChoiceButton(
      isSet ? "Change passcode" : "Set a passcode",
      () => lockSetOrChangePasscodeFromMenu(),
      null,
      true,
    ),
  ];
  if (isSet) {
    items.push(
      appMenuChoiceButton("Lock now", () => lockNowFromMenu(), null, true),
      appMenuChoiceButton(
        "Turn passcode off",
        () => lockTurnOffPasscodeFromMenu(),
        null,
        true,
      ),
    );
  }
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
  return createDropdownMenuSubmenu("Passcode", items);
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
    // The passcode is asked for here, before the library is scanned: nothing is
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
