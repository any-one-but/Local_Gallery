// The app's lock asks macOS, not a passcode of its own: Touch ID (or an Apple
// Watch) where the Mac has it, and the Mac's login password otherwise or on
// "Use Password...". The asking is done by a small helper app built from
// native/lg-auth.swift (scripts/build-auth-helper.js), because Electron's own
// promptTouchID offers the fingerprint only, with no password to fall back on.
//
// Focus is the other half of the job. The dialog is a macOS window, not ours,
// so the window is made the active app before asking (the dialog is presented
// over the app that asked, and takes the keyboard from it) and given the
// keyboard back the moment the helper exits, whatever the answer -- so neither
// the dialog nor the gallery ever needs a click to be typed into. At launch it
// also waits for the fullscreen window to finish arriving (watchWindow).
//
// Where the dialog appears is macOS's choice and cannot be changed (see
// native/lg-auth.swift): centred across the screen beside the Dock, and high
// up. So the lock card goes to it instead: the helper reports the dialog's
// place while it is up, and the page moves the card under it
// (lockPlaceCardAt), so the dialog covers the card rather than sitting a
// little off it. The place is remembered (auth-dialog.json in userData) and
// sent before the next ask, so the card is already there when the dialog
// comes up.
//
// Development only: LG_DEV_SYSTEM_AUTH answers without a dialog, for automated
// checks -- "allow", "cancel", "unavailable", or "cancel-then-allow" (the first
// ask is cancelled, every later one allowed; scripts/check-look.js uses it).

"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const { devMode } = require("./dev");

const ANSWERS = new Set(["ok", "cancel", "unavailable", "failed"]);

let helperPath = undefined;
let inFlight = null;
let fakeAsks = 0;
// Resolves once the main window has finished arriving on screen. At launch the
// lock asks almost at once, while macOS is still sliding the fullscreen window
// into its own Space; a dialog shown during that slide is left behind on the
// desktop Space, out of sight and without the keyboard.
let windowSettled = Promise.resolve();

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

function fakeAnswer() {
  if (!devMode()) return null;
  const mode = String(process.env.LG_DEV_SYSTEM_AUTH || "");
  if (!mode) return null;
  fakeAsks += 1;
  if (mode === "cancel-then-allow") return fakeAsks === 1 ? "cancel" : "ok";
  if (mode === "allow") return "ok";
  return ANSWERS.has(mode) ? mode : "failed";
}

// Resolves with the helper's last line (its answer), or null if it could not
// be run. Each earlier line goes to onLine as it arrives.
function runHelper(args, onLine) {
  const helper = findHelper();
  if (!helper) return Promise.resolve(null);
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(helper, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    let pending = "";
    let last = null;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      let at;
      while ((at = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, at).trim();
        pending = pending.slice(at + 1);
        if (!line) continue;
        last = line;
        if (onLine) {
          try {
            onLine(line);
          } catch {}
        }
      }
    });
    child.on("error", () => resolve(null));
    child.on("close", () => resolve(pending.trim() || last));
  });
}

/* --- The card under the dialog ----------------------------------------------- */

let dialogRect = undefined;

function dialogRectFile() {
  return path.join(app.getPath("userData"), "auth-dialog.json");
}

function rememberedDialogRect() {
  if (dialogRect !== undefined) return dialogRect;
  dialogRect = null;
  try {
    const r = JSON.parse(fs.readFileSync(dialogRectFile(), "utf8"));
    if ([r.x, r.y, r.width, r.height].every(Number.isFinite)) dialogRect = r;
  } catch {}
  return dialogRect;
}

function rememberDialogRect(rect) {
  dialogRect = rect;
  try {
    fs.writeFileSync(dialogRectFile(), JSON.stringify(rect));
  } catch {}
}

// "at x y w h" from the helper, in global screen points (top-left origin, the
// same space Electron's window bounds are in).
function parseDialogLine(line) {
  const m = /^at (-?\d+) (-?\d+) (\d+) (\d+)$/.exec(String(line || ""));
  if (!m) return null;
  return { x: +m[1], y: +m[2], width: +m[3], height: +m[4] };
}

// Tells the page where the dialog's centre is, in the window's own
// coordinates. A dialog on another screen than the window is left alone.
function placeCardUnderDialog(win, rect) {
  if (!win || win.isDestroyed() || !rect || windowIsHidden()) return;
  const b = win.getContentBounds();
  const cx = Math.round(rect.x + rect.width / 2 - b.x);
  const cy = Math.round(rect.y + rect.height / 2 - b.y);
  if (cx < 0 || cy < 0 || cx > b.width || cy > b.height) return;
  win.webContents
    .executeJavaScript(
      `typeof lockPlaceCardAt === "function" ? lockPlaceCardAt(${cx}, ${cy}) : false`,
    )
    .catch(() => {});
}

function mainWindowFor(event) {
  const win =
    (event && BrowserWindow.fromWebContents(event.sender)) ||
    BrowserWindow.getAllWindows()[0] ||
    null;
  return win && !win.isDestroyed() ? win : null;
}

// Called by main.js as the window is made. `fullscreen` is whether it opens
// fullscreen (it does, except in a windowed dev run).
function watchWindow(win, fullscreen) {
  if (!win) return;
  windowSettled = new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // A beat more, for the slide's last frames.
      setTimeout(resolve, 250);
    };
    // Never wait forever: a window that will not go fullscreen still gets asked.
    const cap = setTimeout(finish, 4000);
    const arrived = () => {
      clearTimeout(cap);
      finish();
    };
    if (fullscreen) win.once("enter-full-screen", arrived);
    else win.once("show", arrived);
    win.once("closed", arrived);
  });
}

function windowIsHidden() {
  return devMode() && !!process.env.LG_DEV_HIDDEN;
}

// Make the gallery the active app, so the dialog comes up in front of it with
// the keyboard; and, after, put the keyboard straight back into the page.
function bringToFront(win) {
  if (!win || windowIsHidden()) return;
  try {
    app.focus({ steal: true });
  } catch {}
  try {
    if (!win.isVisible()) win.show();
    win.focus();
    win.webContents.focus();
  } catch {}
}

async function status() {
  if (devMode() && process.env.LG_DEV_SYSTEM_AUTH) {
    return { available: process.env.LG_DEV_SYSTEM_AUTH !== "unavailable", biometrics: false };
  }
  const out = await runHelper(["check"]);
  try {
    const parsed = JSON.parse(out || "");
    return { available: !!parsed.available, biometrics: !!parsed.biometrics, helper: true };
  } catch {
    return { available: false, biometrics: false, helper: false };
  }
}

// Resolves with one word: ok, cancel, unavailable (the Mac has no password to
// ask for) or failed (the helper is missing or broke). Never rejects. A second
// ask while one dialog is up shares the first one's answer rather than
// stacking a second dialog behind it.
function prompt({ reason } = {}, event) {
  if (inFlight) return inFlight;
  const win = mainWindowFor(event);
  inFlight = (async () => {
    const fake = fakeAnswer();
    if (fake) {
      await new Promise((r) => setTimeout(r, 150));
      return fake;
    }
    if (!windowIsHidden()) await windowSettled;
    placeCardUnderDialog(win, rememberedDialogRect());
    bringToFront(win);
    const out = await runHelper(["prompt", String(reason || "unlock Local Gallery")], (line) => {
      const rect = parseDialogLine(line);
      if (!rect) return;
      placeCardUnderDialog(win, rect);
      rememberDialogRect(rect);
    });
    bringToFront(win);
    return ANSWERS.has(out) ? out : "failed";
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

module.exports = { status, prompt, watchWindow };
