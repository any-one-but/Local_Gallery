const { app, BrowserWindow, Menu, ipcMain } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const THUMB_CACHE_DIR_NAME = "thumb-cache";
const THUMB_CACHE_EXT = "jpg";

function hashCacheKey(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function thumbCacheBaseDir() {
  return path.join(app.getPath("userData"), THUMB_CACHE_DIR_NAME);
}

function thumbCacheFilePath(scopeKey, cacheKey, ext = THUMB_CACHE_EXT) {
  const scopeHash = hashCacheKey(scopeKey);
  const cacheHash = hashCacheKey(cacheKey);
  const safeExt = String(ext || THUMB_CACHE_EXT).replace(/[^a-z0-9]/gi, "").toLowerCase() || THUMB_CACHE_EXT;
  return path.join(thumbCacheBaseDir(), scopeHash, cacheHash.slice(0, 2), `${cacheHash}.${safeExt}`);
}

function thumbCacheFileUrl(filePath) {
  try {
    return pathToFileURL(filePath).href;
  } catch {
    return "";
  }
}

ipcMain.handle("thumb-cache-read", async (_event, payload = {}) => {
  const scopeKey = String(payload && payload.scopeKey || "").trim();
  const cacheKey = String(payload && payload.cacheKey || "").trim();
  const ext = String(payload && payload.ext || THUMB_CACHE_EXT).trim() || THUMB_CACHE_EXT;
  if (!scopeKey || !cacheKey) return "";
  const filePath = thumbCacheFilePath(scopeKey, cacheKey, ext);
  try {
    await fs.access(filePath);
    return thumbCacheFileUrl(filePath);
  } catch {
    return "";
  }
});

ipcMain.handle("thumb-cache-write", async (_event, payload = {}) => {
  const scopeKey = String(payload && payload.scopeKey || "").trim();
  const cacheKey = String(payload && payload.cacheKey || "").trim();
  const ext = String(payload && payload.ext || THUMB_CACHE_EXT).trim() || THUMB_CACHE_EXT;
  const rawBytes = payload ? payload.bytes : null;
  if (!scopeKey || !cacheKey || !rawBytes) return "";

  const filePath = thumbCacheFilePath(scopeKey, cacheKey, ext);
  try {
    const bytes = ArrayBuffer.isView(rawBytes)
      ? Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
      : Buffer.from(rawBytes);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return thumbCacheFileUrl(filePath);
  } catch {
    return "";
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.setMenuBarVisibility(false);
  win.webContents.setIgnoreMenuShortcuts(true);
  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
