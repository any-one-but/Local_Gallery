#!/usr/bin/env node
/* Builds the two native pieces of the app's lock into dist-native/:

   - electron/native/lg-auth.swift -> LocalGalleryAuth.app, the helper that
     checks the Mac's password (and says whether Touch ID can be used);
   - electron/native/lg-touchid.m -> lg-touchid.node, the add-on that shows
     Apple's Touch ID view in the gallery's window (buildTouchId).

   Runs before `npm start` and `npm run build` (prestart / prebuild);
   electron-builder copies the result into Contents/Resources. Skips the build
   when the binary is already newer than its source.

   It is a small app bundle rather than a bare program because macOS names the
   asker in its dialog: a bare program reads "lg-auth is trying to..." under a
   terminal icon, the bundle reads "Local Gallery is trying to..." under the
   app's own icon. LSUIElement keeps it out of the Dock. */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "electron", "native", "lg-auth.swift");
const ICON = path.join(ROOT, "build", "icon.icns");
const OUT_DIR = path.join(ROOT, "dist-native");
const BUNDLE = path.join(OUT_DIR, "LocalGalleryAuth.app");
const OUT = path.join(BUNDLE, "Contents", "MacOS", "lg-auth");
const TOUCH_SRC = path.join(ROOT, "electron", "native", "lg-touchid.m");
const TOUCH_OUT = path.join(OUT_DIR, "lg-touchid.node");

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.anyonebut.localgallery.auth</string>
  <key>CFBundleName</key><string>Local Gallery</string>
  <key>CFBundleDisplayName</key><string>Local Gallery</string>
  <key>CFBundleExecutable</key><string>lg-auth</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`;

function mtime(p) {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return 0;
  }
}

function build({ quiet = false } = {}) {
  const stamp = Math.max(mtime(SRC), mtime(__filename));
  if (mtime(OUT) > stamp) return OUT;
  fs.rmSync(BUNDLE, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.mkdirSync(path.join(BUNDLE, "Contents", "Resources"), { recursive: true });
  fs.writeFileSync(path.join(BUNDLE, "Contents", "Info.plist"), INFO_PLIST);
  if (fs.existsSync(ICON)) {
    fs.copyFileSync(ICON, path.join(BUNDLE, "Contents", "Resources", "icon.icns"));
  }
  const res = spawnSync(
    "xcrun",
    [
      "swiftc",
      "-O",
      "-target",
      "arm64-apple-macos12.0",
      SRC,
      "-framework",
      "OpenDirectory",
      "-o",
      OUT,
    ],
    { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" },
  );
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : String(res.stderr || "").trim();
    throw new Error(`Could not build the Touch ID helper (lg-auth). ${why}`);
  }
  // Ad-hoc sign it, as the rest of the app is.
  spawnSync("codesign", ["--force", "--sign", "-", BUNDLE], { stdio: "pipe" });
  return OUT;
}

/* The add-on is plain clang: its few Node-API calls are declared in the source
   and found in Electron when it loads (-undefined dynamic_lookup), so there
   are no headers to download and nothing ties it to an Electron version. */
function buildTouchId({ quiet = false } = {}) {
  const stamp = Math.max(mtime(TOUCH_SRC), mtime(__filename));
  if (mtime(TOUCH_OUT) > stamp) return TOUCH_OUT;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const res = spawnSync(
    "xcrun",
    [
      "clang",
      "-fobjc-arc",
      "-O2",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-target",
      "arm64-apple-macos12.0",
      TOUCH_SRC,
      "-framework",
      "AppKit",
      "-framework",
      "LocalAuthentication",
      "-framework",
      "LocalAuthenticationEmbeddedUI",
      "-o",
      TOUCH_OUT,
    ],
    { stdio: quiet ? "pipe" : "inherit", encoding: "utf8" },
  );
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : String(res.stderr || "").trim();
    throw new Error(`Could not build the Touch ID add-on (lg-touchid). ${why}`);
  }
  spawnSync("codesign", ["--force", "--sign", "-", TOUCH_OUT], { stdio: "pipe" });
  return TOUCH_OUT;
}

if (require.main === module) {
  try {
    build();
    buildTouchId();
    console.log(`Lock helpers ready: ${path.relative(ROOT, BUNDLE)}, ${path.relative(ROOT, TOUCH_OUT)}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { build, buildTouchId, OUT, BUNDLE, TOUCH_OUT };
