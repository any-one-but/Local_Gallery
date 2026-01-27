const { app, BrowserWindow, ipcMain } = require("electron");
const https = require("https");
const http = require("http");
const path = require("path");

function requestUrl(url, opts = {}) {
  return new Promise((resolve) => {
    let parsed = null;
    try { parsed = new URL(url); } catch {
      resolve({ ok: false, status: 0, error: "invalid_url" });
      return;
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const headers = Object.assign({}, opts.headers || {});
    if (opts.referrer) headers.Referer = opts.referrer;
    if (!headers["User-Agent"]) headers["User-Agent"] = "Mozilla/5.0";

    const req = lib.request(parsed, { method: "GET", headers }, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers && res.headers.location;
      if (status >= 300 && status < 400 && loc && (opts.redirects || 0) < 4) {
        res.resume();
        const next = new URL(loc, parsed).toString();
        resolve(requestUrl(next, Object.assign({}, opts, { redirects: (opts.redirects || 0) + 1 })));
        return;
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({ ok: status >= 200 && status < 300, status, text });
      });
    });
    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err ? err.message : "network_error" });
    });
    req.end();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("online-fetch", async (event, payload) => {
    const url = payload && payload.url ? String(payload.url) : "";
    if (!url) return { ok: false, status: 0, error: "invalid_url" };
    const headers = (payload && payload.headers && typeof payload.headers === "object") ? payload.headers : {};
    const referrer = payload && payload.referrer ? String(payload.referrer) : "";
    return requestUrl(url, { headers, referrer, redirects: 0 });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
