#!/bin/bash
# Build "Local Gallery Web.app" (the Chrome app-mode launcher) from its
# AppleScript source, give it the app icon, and put it in ~/Applications.
# Named "Web" so it is never mistaken for the desktop app, /Applications/Local
# Gallery.app.
#   bash launcher/build-launcher.sh            -> ~/Applications/Local Gallery Web.app
#   bash launcher/build-launcher.sh <folder>   -> <folder>/Local Gallery Web.app
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/.." && pwd)"
dest_dir="${1:-$HOME/Applications}"
app="$dest_dir/Local Gallery Web.app"
mkdir -p "$dest_dir"
rm -rf "$app"
osacompile -o "$app" "$here/Local Gallery.applescript"
cp "$repo/src-tauri/icons/icon.icns" "$app/Contents/Resources/applet.icns"
# osacompile also ships a default icon in an asset catalog, which newer macOS
# prefers over applet.icns; drop it so the app shows the Local Gallery icon.
rm -f "$app/Contents/Resources/Assets.car"
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Set :CFBundleName Local Gallery Web" "$app/Contents/Info.plist" 2>/dev/null || true
# The bundle changed after osacompile signed it; sign it again (ad hoc).
codesign --force --sign - "$app" >/dev/null 2>&1 || true
# Refresh Finder's idea of the icon.
touch "$app"
echo "Built $app"
