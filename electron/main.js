// Local Gallery on Electron: the same page as the browser version and the
// Tauri app, running on Chromium.
//
// Why this exists: the Tauri app runs the page in WebKit, and WebKit's video
// pipeline could not seek the library's AV1 video reliably -- a seek would
// stall indefinitely, and scrubbing froze the screen -- where Chrome is smooth.
// This shell keeps everything the app adds (the managed library, native
// thumbnails, Grok / Claude / Variations, crash recovery) and swaps only the
// engine underneath. The page takes its app paths exactly as it did under
// Tauri; see media.js for how the bridge is put in front of it.
//
// Development switches (see dev.js for when they apply), matching the Tauri app's:
//   LG_DEV_WINDOWED=1        open in a window, not fullscreen, unthrottled
//   LG_DEV_SCRIPT=<file>     inject a test script into the page
//   LG_DEV_MEDIA_ROOT=<dir>  use a throwaway library
// The `dev_report` command prints "[lg-dev] ..." to stderr.

"use strict";

const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");

const commands = require("./commands");
const { devMode } = require("./dev");
const embedded = require("./embedded");
const media = require("./media");
const session = require("./session");

app.setName("Local Gallery");
media.registerSchemes();

const devWindowed = devMode() && !!process.env.LG_DEV_WINDOWED;

let mainWindow = null;

function runInPage(js) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(js).catch(() => {});
  }
}

// No Cmd+W, Cmd+R or Cmd+Shift+W here: the gallery uses all three (the folder
// keys and the random jumps), and a menu accelerator would take them first.
function installMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "App Menu…",
          click: () => runInPage("window.__lgToggleSettings && window.__lgToggleSettings();"),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "togglefullscreen" },
        { type: "separator" },
        { role: "toggleDevTools" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        {
          // Shift+Cmd+W also closes them from the keyboard (embedded.js); this
          // is the way there for someone who does not know that.
          label: "Close Grok / Claude / Variations",
          click: () => {
            const label = embedded.visibleLabel();
            if (label) embedded.hide(label, true);
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    title: "Local Gallery",
    width: 1100,
    height: 750,
    fullscreen: !devWindowed,
    show: false,
    backgroundColor: "#000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: !devWindowed,
    },
  });
  const wc = mainWindow.webContents;

  // The page never leaves itself: a dropped file or a stray link would
  // otherwise replace the gallery.
  wc.on("will-navigate", (event, url) => {
    if (!url.startsWith(media.APP_ORIGIN)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // The Tauri app's watchdog, plus Chromium's own report of a dead renderer.
  wc.on("render-process-gone", () => {
    setTimeout(() => {
      if (!wc.isDestroyed()) wc.reload();
    }, 250);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    wc.focus();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  embedded.init(mainWindow);
  wc.loadURL(`${media.APP_ORIGIN}/index.html`);
}

commands.registerCommands(embedded.commands);

ipcMain.handle("lg:invoke", (event, cmd, args) => commands.dispatch(cmd, args, event));

app.whenReady().then(() => {
  media.handleProtocols(require("electron").session.defaultSession);
  installMenu();
  createMainWindow();
  session.startWatchdog(() => mainWindow);
  // Development only (LG_DEV_LAG=1): report when the main process -- which
  // also routes every key press to the page -- is held up.
  if (devMode() && process.env.LG_DEV_LAG) {
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - last > 150) console.error(`[lg-dev] main process stalled ${now - last - 50}ms`);
      last = now;
    }, 50);
  }
});

// One window is the whole app: closing it quits.
app.on("window-all-closed", () => app.quit());

app.on("activate", () => {
  if (!mainWindow) createMainWindow();
});
