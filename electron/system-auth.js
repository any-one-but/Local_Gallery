// The app's lock checks with macOS, not a passcode of its own: Touch ID (or an
// Apple Watch) where the Mac has it, and the Mac's login password. The
// gallery's lock screen is the whole UI -- the fingerprint, the password
// field, the messages -- and asks through the commands below. macOS's own
// dialog is never shown, because macOS alone decides where it goes and will
// not put it in the middle (see native/lg-auth.swift).
//
// - touchId puts Apple's Touch ID view into the window over the page's
//   fingerprint (the lg-touchid.node add-on, native/lg-touchid.m) and waits
//   for a finger; cancelTouchId ends it when the password is typed instead or
//   the screen goes. It is in the app's own window because macOS only takes a
//   fingerprint for a view that is really on screen.
// - checkPassword hands the typed password to the helper (native/lg-auth.swift)
//   on stdin and answers ok or wrong. Nothing here keeps it.
//
// Both native pieces are built by scripts/build-auth-helper.js.
//
// Development only: LG_DEV_SYSTEM_AUTH answers without the helper, for
// automated checks -- "allow" (Touch ID and any password succeed), "cancel"
// (Touch ID is cancelled, every password is wrong), "unavailable" (the Mac has
// no password), or "cancel-then-allow" (the first Touch ID try fails, every
// later one succeeds; scripts/check-look.js uses it).

"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const { devMode } = require("./dev");

let helperPath = undefined;
let touchInFlight = null;
let fakeTouchAsks = 0;

function findHelper() {
  if (helperPath !== undefined && helperPath && fs.existsSync(helperPath)) return helperPath;
  const rel = path.join("LocalGalleryAuth.app", "Contents", "MacOS", "lg-auth");
  if (app.isPackaged) {
    helperPath = path.join(process.resourcesPath, rel);
  } else {
    // `npm start` builds it first (prestart); build it here too, so starting
    // electron directly still has a lock that works.
    try {
      helperPath = require("../scripts/build-auth-helper").build({ quiet: true });
    } catch (err) {
      console.error(`[lg] ${err.message}`);
      helperPath = null;
    }
  }
  if (helperPath && !fs.existsSync(helperPath)) helperPath = null;
  return helperPath;
}

function fakeMode() {
  if (!devMode()) return "";
  return String(process.env.LG_DEV_SYSTEM_AUTH || "");
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

async function status() {
  const fake = fakeMode();
  if (fake) return { available: fake !== "unavailable", biometrics: fake !== "unavailable" };
  const helper = findHelper();
  if (!helper) return { available: false, biometrics: false, helper: false };
  const out = await new Promise((resolve) => {
    execFile(helper, ["check"], (err, stdout) => resolve(String(stdout || "")));
  });
  try {
    const parsed = JSON.parse(out.trim());
    return { available: !!parsed.available, biometrics: !!parsed.biometrics, helper: true };
  } catch {
    return { available: false, biometrics: false, helper: false };
  }
}

/* --- Touch ID, in the window (native/lg-touchid.m) ------------------------- */

let touchAddon = undefined;
let touchTimer = null;
let touchFinish = null;

function loadTouchAddon() {
  if (touchAddon !== undefined) return touchAddon;
  touchAddon = null;
  try {
    let file;
    if (app.isPackaged) {
      file = path.join(process.resourcesPath, "lg-touchid.node");
    } else {
      // `npm start` builds it with the helper (prestart); build it here too.
      file = require("../scripts/build-auth-helper").buildTouchId({ quiet: true });
    }
    touchAddon = require(file);
  } catch (err) {
    console.error(`[lg] Touch ID add-on unavailable: ${err.message || err}`);
  }
  return touchAddon;
}

// The page's rectangle (CSS pixels from the top-left of the page) in window
// points.
function rectInPoints(rect, event) {
  const zoom = (event && event.sender && event.sender.getZoomFactor()) || 1;
  const r = rect || {};
  const vals = [r.x, r.y, r.width, r.height].map((v) => Number(v) * zoom);
  return vals.every(Number.isFinite) && vals[2] > 0 && vals[3] > 0 ? vals : null;
}

function endTouchWait(word) {
  if (touchTimer) clearInterval(touchTimer);
  touchTimer = null;
  const finish = touchFinish;
  touchFinish = null;
  if (finish) finish(word);
}

// Resolves with one word: ok, cancel, failed (a miss, a lockout, or it could
// not be shown) or unavailable (no Touch ID or Watch). Never rejects. `rect`
// is where the page draws its fingerprint: Apple's Touch ID view is put
// exactly there, above the page, for as long as the check waits. A second
// ask while one is waiting shares it (and moves the view to the new rect).
function touchId({ reason, rect } = {}, event) {
  const fake = fakeMode();
  if (fake) {
    if (touchInFlight) return touchInFlight;
    touchInFlight = (async () => {
      fakeTouchAsks += 1;
      await settle(150);
      if (fake === "allow") return "ok";
      if (fake === "cancel-then-allow") return fakeTouchAsks === 1 ? "failed" : "ok";
      if (fake === "unavailable") return "unavailable";
      return "cancel";
    })().finally(() => {
      touchInFlight = null;
    });
    return touchInFlight;
  }
  if (touchInFlight) {
    moveTouchId({ rect }, event);
    return touchInFlight;
  }
  const addon = loadTouchAddon();
  const win = event && BrowserWindow.fromWebContents(event.sender);
  const r = rectInPoints(rect, event);
  if (!addon || !win || win.isDestroyed() || !r) return Promise.resolve("failed");
  let started;
  try {
    started = addon.start(win.getNativeWindowHandle(), ...r, String(reason || "unlock Local Gallery"));
  } catch {
    started = "failed";
  }
  if (started !== "started") return Promise.resolve(started === "unavailable" ? "unavailable" : "failed");
  touchInFlight = new Promise((resolve) => {
    touchFinish = resolve;
    touchTimer = setInterval(() => {
      let word = "failed";
      try {
        word = addon.poll();
      } catch {}
      if (word !== "waiting") endTouchWait(word === "idle" ? "cancel" : word);
    }, 100);
  });
  // A page that reloads or a window that closes takes the check with it.
  const sender = event.sender;
  const onNavigate = (details) => {
    if (details && details.isMainFrame && !details.isSameDocument) cancelTouchId();
  };
  const onGone = () => cancelTouchId();
  sender.on("did-start-navigation", onNavigate);
  sender.once("destroyed", onGone);
  touchInFlight = touchInFlight.finally(() => {
    touchInFlight = null;
    if (!sender.isDestroyed()) {
      sender.removeListener("did-start-navigation", onNavigate);
      sender.removeListener("destroyed", onGone);
    }
  });
  return touchInFlight;
}

function moveTouchId({ rect } = {}, event) {
  const addon = touchAddon;
  const r = rectInPoints(rect, event);
  if (addon && r && touchInFlight) {
    try {
      addon.move(...r);
    } catch {}
  }
  return true;
}

// Ends a waiting Touch ID check (and takes its view away); its ask then
// answers "cancel".
function cancelTouchId() {
  if (touchAddon) {
    try {
      touchAddon.stop();
    } catch {}
  }
  endTouchWait("cancel");
  return true;
}

// ok, wrong, or failed (the check itself could not run). Never rejects.
function checkPassword({ password } = {}) {
  const fake = fakeMode();
  if (fake) return settle(150).then(() => (fake === "allow" ? "ok" : "wrong"));
  const helper = findHelper();
  if (!helper) return Promise.resolve("failed");
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(helper, ["password"], { stdio: ["pipe", "pipe", "ignore"] });
    } catch {
      resolve("failed");
      return;
    }
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.on("error", () => resolve("failed"));
    child.on("close", () => {
      const word = out.trim();
      resolve(word === "ok" || word === "wrong" ? word : "failed");
    });
    child.stdin.on("error", () => {});
    child.stdin.end(String(password || ""));
  });
}

// A Touch ID check must not outlive the app.
app.on("will-quit", cancelTouchId);

module.exports = { status, touchId, moveTouchId, cancelTouchId, checkPassword };
