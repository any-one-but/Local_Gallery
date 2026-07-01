#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TAURI_CONF_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
const BUNDLE_ROOT = path.join(ROOT, "src-tauri", "target", "release", "bundle");
const MACOS_BUNDLE_DIR = path.join(BUNDLE_ROOT, "macos");
const DMG_BUNDLE_DIR = path.join(BUNDLE_ROOT, "dmg");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd || ROOT,
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
  });
  return result;
}

function fail(message, status = 1) {
  console.error(message);
  process.exit(status || 1);
}

function removePath(filePath) {
  try {
    fs.rmSync(filePath, { force: true, recursive: true });
  } catch {}
}

function cleanupDmgIntermediates() {
  for (const dir of [MACOS_BUNDLE_DIR, DMG_BUNDLE_DIR]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (/^rw\..*\.dmg$/i.test(entry)) {
        removePath(path.join(dir, entry));
      }
    }
  }
}

function toDmgArch() {
  if (process.arch === "arm64") return "aarch64";
  if (process.arch === "x64") return "x64";
  return process.arch;
}

function dmgConfig(tauriConf) {
  const cfg = (((tauriConf || {}).bundle || {}).macOS || {}).dmg || {};
  const appPosition = cfg.appPosition || { x: 180, y: 170 };
  const applicationFolderPosition =
    cfg.applicationFolderPosition || { x: 480, y: 170 };
  const windowSize = cfg.windowSize || { width: 660, height: 400 };
  return { appPosition, applicationFolderPosition, windowSize };
}

function createFallbackDmg() {
  if (process.platform !== "darwin") {
    fail("Tauri build failed and the DMG fallback only applies on macOS.");
  }

  const tauriConf = readJson(TAURI_CONF_PATH);
  const productName = String(tauriConf.productName || "").trim();
  const version = String(tauriConf.version || "").trim();
  if (!productName || !version) {
    fail("Cannot create fallback DMG: tauri.conf.json is missing productName or version.");
  }

  const appName = `${productName}.app`;
  const appPath = path.join(MACOS_BUNDLE_DIR, appName);
  const bundleScript = path.join(DMG_BUNDLE_DIR, "bundle_dmg.sh");
  if (!fs.existsSync(appPath)) {
    fail(`Tauri build failed before producing ${appPath}; not attempting DMG fallback.`);
  }
  if (!fs.existsSync(bundleScript)) {
    fail(`Tauri build failed and ${bundleScript} is missing; not attempting DMG fallback.`);
  }

  cleanupDmgIntermediates();
  fs.mkdirSync(DMG_BUNDLE_DIR, { recursive: true });
  const dmgPath = path.join(
    DMG_BUNDLE_DIR,
    `${productName}_${version}_${toDmgArch()}.dmg`,
  );
  removePath(dmgPath);

  const { appPosition, applicationFolderPosition, windowSize } =
    dmgConfig(tauriConf);
  console.log("Tauri DMG bundling failed; creating DMG with project fallback.");
  console.log("Skipping Finder AppleScript layout to avoid macOS Apple Events permission failures.");
  const args = [
    bundleScript,
    "--skip-jenkins",
    "--volname",
    productName,
    "--window-size",
    String(windowSize.width || 660),
    String(windowSize.height || 400),
    "--icon",
    appName,
    String(appPosition.x || 180),
    String(appPosition.y || 170),
    "--hide-extension",
    appName,
    "--app-drop-link",
    String(applicationFolderPosition.x || 480),
    String(applicationFolderPosition.y || 170),
    dmgPath,
    MACOS_BUNDLE_DIR,
  ];
  const bundleResult = runCommand("/bin/bash", args);
  if ((bundleResult.status || 0) !== 0) {
    process.exit(bundleResult.status || 1);
  }

  cleanupDmgIntermediates();
  const verifyResult = runCommand("hdiutil", ["verify", dmgPath]);
  if ((verifyResult.status || 0) !== 0) {
    process.exit(verifyResult.status || 1);
  }
}

cleanupDmgIntermediates();

const tauriArgs = ["tauri", "build", ...process.argv.slice(2)];
const result = runCommand("npx", tauriArgs);
if ((result.status || 0) === 0) {
  cleanupDmgIntermediates();
  process.exit(0);
}

createFallbackDmg();
