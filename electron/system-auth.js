// The app's lock checks with macOS, not a passcode of its own: Touch ID (or an
// Apple Watch) where the Mac has it, and the Mac's login password. Both checks
// are done by a small helper built from native/lg-auth.swift
// (scripts/build-auth-helper.js), with no window of its own: the gallery's
// lock screen is the whole UI -- the fingerprint, the password field, the
// messages -- and asks through the commands below. macOS's own dialog is never
// shown, because macOS alone decides where it goes and will not put it in the
// middle (see lg-auth.swift).
//
// - touchId waits for a finger while the lock screen is up, and is cancelled
//   (cancelTouchId) when the password is typed instead or the screen goes.
// - checkPassword hands the typed password to the helper on stdin and answers
//   ok or wrong. Nothing here keeps it.
//
// Development only: LG_DEV_SYSTEM_AUTH answers without the helper, for
// automated checks -- "allow" (Touch ID and any password succeed), "cancel"
// (Touch ID is cancelled, every password is wrong), "unavailable" (the Mac has
// no password), or "cancel-then-allow" (the first Touch ID try fails, every
// later one succeeds; scripts/check-look.js uses it).

"use strict";

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const { execFile, spawn } = require("child_process");

const { devMode } = require("./dev");

let helperPath = undefined;
let touchChild = null;
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

// Resolves with one word: ok, cancel, failed (a miss, a lockout, or the helper
// broke) or unavailable (no Touch ID or Watch). Never rejects. A second ask
// while one is waiting shares it.
function touchId({ reason } = {}) {
  if (touchInFlight) return touchInFlight;
  touchInFlight = (async () => {
    const fake = fakeMode();
    if (fake) {
      fakeTouchAsks += 1;
      await settle(150);
      if (fake === "allow") return "ok";
      if (fake === "cancel-then-allow") return fakeTouchAsks === 1 ? "failed" : "ok";
      if (fake === "unavailable") return "unavailable";
      return "cancel";
    }
    const helper = findHelper();
    if (!helper) return "failed";
    return new Promise((resolve) => {
      let out = "";
      let child;
      try {
        child = spawn(helper, ["touchid", String(reason || "unlock Local Gallery")], {
          stdio: ["ignore", "pipe", "ignore"],
        });
      } catch {
        resolve("failed");
        return;
      }
      touchChild = child;
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        out += chunk;
      });
      child.on("error", () => resolve("failed"));
      child.on("close", () => {
        if (touchChild === child) touchChild = null;
        const word = out.trim().split("\n").pop();
        resolve(["ok", "cancel", "failed", "unavailable"].includes(word) ? word : "failed");
      });
    });
  })().finally(() => {
    touchInFlight = null;
  });
  return touchInFlight;
}

// Ends a waiting Touch ID check; its ask then answers "cancel".
function cancelTouchId() {
  const child = touchChild;
  touchChild = null;
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
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

module.exports = { status, touchId, cancelTouchId, checkPassword };
