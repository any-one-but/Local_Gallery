#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON_PATH = path.join(ROOT, "package.json");
const PACKAGE_LOCK_PATH = path.join(ROOT, "package-lock.json");
const TAURI_CONF_PATH = path.join(ROOT, "src-tauri", "tauri.conf.json");
const CARGO_TOML_PATH = path.join(ROOT, "src-tauri", "Cargo.toml");
const CARGO_LOCK_PATH = path.join(ROOT, "src-tauri", "Cargo.lock");
const DRY_RUN = process.argv.includes("--dry-run");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

  if (result.error) {
    if (options.allowFailure) return result;
    fail(result.error.message);
  }
  if ((result.status || 0) !== 0) {
    const stderr = String(result.stderr || "").trim();
    if (stderr) console.error(stderr);
    if (options.allowFailure) return result;
    process.exit(result.status || 1);
  }
  return result;
}

function updateCargoLockPackageVersion(lockText, packageName, version) {
  const packageBlockRe = new RegExp(
    `(\\[\\[package\\]\\]\\nname = "${packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\nversion = )"[^"]*"`,
    "m",
  );
  const next = lockText.replace(packageBlockRe, `$1"${version}"`);
  if (next === lockText) {
    fail(`Unable to update ${path.relative(ROOT, CARGO_LOCK_PATH)} for package ${packageName}.`);
  }
  return next;
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
const cargoLock = updateCargoLockPackageVersion(
  fs.readFileSync(CARGO_LOCK_PATH, "utf8"),
  "local-gallery",
  tauriVersion,
);

console.log(`Releasing ${currentVersion} -> ${nextVersion} (tauri ${tauriVersion})`);

// Snapshot originals so a failed build can restore the working tree instead of
// leaving the version-bump edits behind.
const fileWrites = [
  [PACKAGE_JSON_PATH, `${JSON.stringify(packageJson, null, 2)}\n`],
  [PACKAGE_LOCK_PATH, `${JSON.stringify(packageLock, null, 2)}\n`],
  [TAURI_CONF_PATH, `${JSON.stringify(tauriConf, null, 2)}\n`],
  [CARGO_TOML_PATH, cargoToml],
  [CARGO_LOCK_PATH, cargoLock],
];
const originalContents = fileWrites.map(([p]) => [p, fs.readFileSync(p, "utf8")]);

function restoreOriginals() {
  for (const [p, text] of originalContents) {
    try {
      fs.writeFileSync(p, text);
    } catch (err) {
      console.error(`Failed to restore ${path.relative(ROOT, p)}: ${err.message}`);
    }
  }
}

if (!DRY_RUN) {
  for (const [p, text] of fileWrites) fs.writeFileSync(p, text);
}

// Build BEFORE committing/pushing. The Tauri build is the step most likely to
// fail (macOS DMG bundling / codesigning), so it must gate the release: if it
// fails, restore the working tree and abort with nothing committed or pushed.
// Committing/pushing first would publish an artifact-less version bump and burn
// a version number on every failed build.
const buildResult = runCommand(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "tauri:build"],
  { mutate: true, allowFailure: true },
);
if ((buildResult.status || 0) !== 0) {
  if (!DRY_RUN) restoreOriginals();
  fail(
    `Build failed (exit ${buildResult.status || 1}); reverted version bump. ` +
      `Nothing was committed or pushed. Fix the build and re-run.`,
  );
}

runCommand("git", ["add", "-A"], { mutate: true });
runCommand("git", ["commit", "-m", `release: v${nextVersion}`], { mutate: true });

const branch = detectCurrentBranch();
const pushTarget = detectPushTarget(branch);
runCommand("git", ["push", ...pushTarget], { mutate: true });

console.log(`Release complete: v${nextVersion}`);
