// The development switches (LG_DEV_WINDOWED, LG_DEV_SCRIPT, LG_DEV_MEDIA_ROOT,
// ffmpeg logging) work in an unpackaged run, or in the packaged app when it is
// started from a terminal with LG_DEV=1 -- which is how a built app is tested
// without it taking over the screen. Nobody sets an environment variable by
// accident, so the packaged app behaves normally otherwise.

"use strict";

const { app } = require("electron");

function devMode() {
  return !app.isPackaged || process.env.LG_DEV === "1";
}

module.exports = { devMode };
