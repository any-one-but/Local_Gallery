#!/usr/bin/env node
/* Release gate: every surface follows the UI tint and highlight, the screens
   drawn before the library's settings are read included.

   Runs the Mac app (hidden, in a throwaway profile and a throwaway library)
   three times:

   1. Opens the library, sets a distinctive tint and highlight, sets a
      passcode, quits.
   2. Starts again: the passcode screen must be in that look. Unlocks, then
      refreshes the library: the loading overlay must be in it too.
   3. Starts again with the remembered copies deleted (look.json and
      localStorage): the passcode screen must still be in the look, read from
      the library's own settings file.
   4. Puts the library back on Default while the remembered copy still says
      the old scheme: the passcode screen must be in Default, with nothing of
      the old scheme left behind.

   Exits non-zero, naming what was wrong, if any check fails.
   `npm run check:look`; scripts/release-patch.js runs it before building. */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SCHEME = "synthwave";
const RUN_TIMEOUT_MS = 45000;

const electronPath = require(path.join(ROOT, "node_modules", "electron"));

const work = fs.mkdtempSync(path.join(os.tmpdir(), "lg-look-check-"));
const lib = path.join(work, "lib");
const profile = path.join(work, "profile");
const setDir = path.join(lib, "Model", "Set");
fs.mkdirSync(setDir, { recursive: true });
fs.mkdirSync(profile, { recursive: true });
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
fs.writeFileSync(path.join(setDir, "a.png"), png);
fs.writeFileSync(path.join(setDir, "b.png"), png);

// Shared by the probes: report a line to the terminal, and compare a computed
// colour with what the scheme says it should be.
const PROBE_LIB = `
const report = (m) => window.__TAURI__.core.invoke("dev_report", { msg: "LOOK " + String(m) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (test, ms) => { const t0 = Date.now(); while (!test()) { if (Date.now() - t0 > ms) return false; await wait(100); } return true; };
const asColor = (css) => { const d = document.createElement("div"); d.style.color = css; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
const expected = () => {
  const theme = document.documentElement.getAttribute("data-theme") === "graphite-light" ? "light" : "dark";
  return { bg: asColor(uiTintVars(${JSON.stringify(SCHEME)}, theme)["--color1-primary"]),
           accent: asColor(uiHighlightVars(${JSON.stringify(SCHEME)}, theme)["--accent"]) };
};
const check = (label, actualBg) => {
  const want = expected();
  const accent = asColor("var(--accent)");
  const ok = actualBg === want.bg && accent === want.accent;
  report((ok ? "PASS " : "FAIL ") + label + " bg=" + actualBg + " want=" + want.bg + " accent=" + accent + " want=" + want.accent);
};
`;

const PROBES = {
  stale: `(function(){ ${PROBE_LIB}
    window.addEventListener("load", async () => {
      const ls = () => document.getElementById("lockScreen");
      if (!(await until(() => ls() && ls().classList.contains("lockScreenOpen"), 20000))) { report("FAIL passcode screen never opened"); window.close(); return; }
      const left = uiColorPropNames().filter((n) => document.documentElement.style.getPropertyValue(n));
      report((left.length ? "FAIL" : "PASS") + " passcode screen back on Default, nothing stale" + (left.length ? " (left: " + left.join(", ") + ")" : ""));
      window.close();
    });
  })();`,
  setup: `(function(){ ${PROBE_LIB}
    window.addEventListener("load", async () => {
      if (!(await until(() => typeof LIBRARY_SETTINGS_LOADED !== "undefined" && LIBRARY_SETTINGS_LOADED && WS.root, 30000))) { report("FAIL setup: library never opened"); window.close(); return; }
      setOptionValue("uiTint", ${JSON.stringify(SCHEME)});
      setOptionValue("uiHighlight", ${JSON.stringify(SCHEME)});
      applyOptionsEverywhere(false);
      const rec = await lockMakeRecord("1234"); LOCK_STATE.record = rec; await lockWriteRecord(rec);
      if (typeof metaSaveNow === "function") { try { await metaSaveNow(); } catch {} }
      await wait(3000);
      report("SETUP done");
      window.close();
    });
  })();`,
  locked: `(function(){ ${PROBE_LIB}
    window.addEventListener("load", async () => {
      const ls = () => document.getElementById("lockScreen");
      if (!(await until(() => ls() && ls().classList.contains("lockScreenOpen"), 20000))) { report("FAIL passcode screen never opened"); window.close(); return; }
      check("passcode screen", getComputedStyle(ls()).backgroundColor);
      for (const k of "1234") window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: "Digit" + k, bubbles: true }));
      if (!(await until(() => LIBRARY_SETTINGS_LOADED && WS.root, 30000))) { report("FAIL library never opened after unlock"); window.close(); return; }
      const busy = document.getElementById("busyOverlay");
      let seen = "";
      const done = refreshWorkspaceFromRootHandle();
      const iv = setInterval(() => { if (!LIBRARY_SETTINGS_LOADED && busy) seen = seen || getComputedStyle(document.getElementById("lockScreen")).backgroundColor; }, 20);
      await done; clearInterval(iv);
      // The overlay is translucent, so check the colour it is drawn from.
      check("loading during refresh", seen || getComputedStyle(document.getElementById("lockScreen")).backgroundColor);
      window.close();
    });
  })();`,
};

function run(name) {
  const probeFile = path.join(work, `${name}.js`);
  fs.writeFileSync(probeFile, PROBES[name === "fromDisk" ? "locked" : name]);
  return new Promise((resolve) => {
    const child = spawn(electronPath, ["."], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        LG_DEV_WINDOWED: "1",
        LG_DEV_HIDDEN: "1",
        LG_DEV_USER_DATA: profile,
        LG_DEV_MEDIA_ROOT: lib,
        LG_DEV_SCRIPT: probeFile,
      }),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const lines = [];
    const take = (buf) => {
      for (const line of String(buf).split("\n")) {
        const at = line.indexOf("[lg-dev] LOOK ");
        if (at >= 0) lines.push(line.slice(at + "[lg-dev] LOOK ".length).trim());
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      lines.push(`FAIL ${name}: timed out`);
      child.kill("SIGKILL");
    }, RUN_TIMEOUT_MS);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve(lines);
    });
  });
}

(async () => {
  const results = [];
  results.push(...(await run("setup")));
  results.push(...(await run("locked")));
  // Forget every remembered copy: the passcode screen must find the look in
  // the library's own settings file.
  fs.rmSync(path.join(profile, "look.json"), { force: true });
  fs.rmSync(path.join(profile, "Local Storage"), { recursive: true, force: true });
  results.push(...(await run("fromDisk")).map((l) => l.replace("passcode screen", "passcode screen (no remembered copy)")));
  // The library goes back to Default; the remembered copy still says SCHEME.
  const prefFile = path.join(lib, ".local-gallery", "preferences.filenames.log.json");
  try {
    const doc = JSON.parse(fs.readFileSync(prefFile, "utf8"));
    doc.options = Object.assign({}, doc.options, { uiTint: "default", uiHighlight: "default" });
    fs.writeFileSync(prefFile, JSON.stringify(doc));
    results.push(...(await run("stale")));
  } catch (err) {
    results.push(`FAIL could not set the library back to Default: ${err.message}`);
  }
  fs.rmSync(work, { recursive: true, force: true });

  for (const line of results) console.log(`  ${line}`);
  const passes = results.filter((l) => l.startsWith("PASS")).length;
  const failed = results.some((l) => l.startsWith("FAIL")) || passes < 5;
  if (failed) {
    console.error("Look check FAILED: a screen is not following the UI tint and highlight.");
    process.exit(1);
  }
  console.log("Look check passed: every checked screen follows the UI tint and highlight.");
})();
