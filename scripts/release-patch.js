#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = path.join(ROOT, "package-lock.json");
const TAURI_CONF_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML_PATH = path.join(ROOT, "src-tauri", "Cargo.toml");
const DRY_RUN = process.argv.includes("--dry-run");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function bumpPatchVersion(version) {
  const parts = String(version || "").split(".");
  if (!parts.length || parts.some((part) => !/^\d+$/.test(part))) {
    fail(`Unsupported version format: ${version}`);
  }
  const widths = parts.map((part) => part.length);
  const lastIndex = parts.length - 1;
  const nextPatch = String((parseInt(parts[lastIndex], 10) || 0) + 1).padStart(widths[lastIndex], "0");
  parts[lastIndex] = nextPatch;
  return parts.join(".");
}

// Convert zero-padded app version (e.g. "01.06.60") to clean semver for
// Tauri/Cargo ("1.6.60"). Tauri and Cargo use standard semver for bundle metadata.
function toTauriVersion(padded) {
  return String(padded || "")
    .split(".")
    .map((p) => String(parseInt(p, 10) || 0))
    .join(".");
}

function runCommand(cmd, args, options = {}) {
  const mutate = !!options.mutate;
  const printable = [cmd, ...args].join(" ");
  console.log(`> ${printable}${DRY_RUN && mutate ? " [dry-run]" : ""}`);
  if (DRY_RUN && mutate) return { status: 0, stdout: "", stderr: "" };

  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    encoding: "utf8"
  });

  if (result.error) fail(result.error.message);
  if ((result.status || 0) !== 0) {
    const stderr = String(result.stderr || "").trim();
    if (stderr) console.error(stderr);
    process.exit(result.status || 1);
  }
  return result;
}

function detectCurrentBranch() {
  const result = runCommand("git", ["branch", "--show-current"], { capture: true });
  const branch = String(result.stdout || "").trim();
  if (!branch) fail("Unable to determine the current git branch.");
  return branch;
}

function detectPushTarget(branch) {
  const upstream = spawnSync(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    {
      cwd: ROOT,
      stdio: ["inherit", "pipe", "pipe"],
      encoding: "utf8"
    }
  );
  if (!upstream.error && (upstream.status || 0) === 0) {
    const upstreamRef = String(upstream.stdout || "").trim();
    if (upstreamRef) return [];
  }
  return ["-u", "origin", branch];
}

const packageJson = readJson(PACKAGE_JSON_PATH);
const packageLock = readJson(PACKAGE_LOCK_PATH);
const currentVersion = String(packageJson.version || "");

if (!currentVersion) fail("package.json is missing a version.");
if (String(packageLock.version || "") !== currentVersion) {
  fail("package.json and package-lock.json versions do not match.");
}
if (!packageLock.packages || !packageLock.packages[""] || String(packageLock.packages[""].version || "") !== currentVersion) {
  fail('package-lock.json packages[""].version does not match package.json.');
}

const nextVersion = bumpPatchVersion(currentVersion);
packageJson.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[""].version = nextVersion;

const tauriVersion = toTauriVersion(nextVersion);
const tauriConf = readJson(TAURI_CONF_PATH);
tauriConf.version = tauriVersion;

let cargoToml = fs.readFileSync(CARGO_TOML_PATH, "utf8");
cargoToml = cargoToml.replace(
  /(\[package\][\s\S]*?^\s*version\s*=\s*)"[^"]*"/m,
  `$1"${tauriVersion}"`
);

console.log(`Releasing ${currentVersion} -> ${nextVersion} (tauri ${tauriVersion})`);

if (!DRY_RUN) {
  writeJson(PACKAGE_JSON_PATH, packageJson);
  writeJson(PACKAGE_LOCK_PATH, packageLock);
  writeJson(TAURI_CONF_PATH, tauriConf);
  fs.writeFileSync(CARGO_TOML_PATH, cargoToml);
}

runCommand("git", ["add", "-A"], { mutate: true });
runCommand("git", ["commit", "-m", `release: v${nextVersion}`], { mutate: true });

const branch = detectCurrentBranch();
const pushTarget = detectPushTarget(branch);
runCommand("git", ["push", ...pushTarget], { mutate: true });
runCommand(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "tauri:build"], { mutate: true });

console.log(`Release complete: v${nextVersion}`);
