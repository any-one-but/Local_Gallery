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

function safeDownloadFileName(inputName) {
  const raw = String(inputName || "").trim();
  const base = raw || "local-gallery-export.gif";
  const cleaned = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");
  return cleaned || "local-gallery-export.gif";
}

function splitFileNameExt(fileName) {
  const src = String(fileName || "");
  const idx = src.lastIndexOf(".");
  if (idx <= 0) return { base: src || "file", ext: "" };
  return { base: src.slice(0, idx), ext: src.slice(idx) };
}

async function uniqueDownloadPath(preferredName) {
  const downloadsDir = app.getPath("downloads");
  const safeName = safeDownloadFileName(preferredName);
  const parts = splitFileNameExt(safeName);
  const ext = parts.ext || ".gif";
  const base = parts.base || "local-gallery-export";
  let candidate = path.join(downloadsDir, `${base}${ext}`);
  let counter = 1;
  while (counter < 10000) {
    try {
      await fs.access(candidate);
      candidate = path.join(downloadsDir, `${base} (${counter})${ext}`);
      counter++;
    } catch {
      return candidate;
    }
  }
  return path.join(downloadsDir, `${base}-${Date.now()}${ext}`);
}

ipcMain.handle("downloads-write-file", async (_event, payload = {}) => {
  const fileName = String(payload && payload.fileName || "").trim();
  const rawBytes = payload ? payload.bytes : null;
  if (!rawBytes) return "";
  try {
    const bytes = ArrayBuffer.isView(rawBytes)
      ? Buffer.from(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
      : Buffer.from(rawBytes);
    const targetPath = await uniqueDownloadPath(fileName || "local-gallery-export.gif");
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, bytes);
    return targetPath;
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
  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const src = sourceId ? `${sourceId}:${line}` : `line:${line}`;
    console.log(`[renderer:${level}] ${src} ${message}`);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error("[renderer] render-process-gone", details);
  });
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
