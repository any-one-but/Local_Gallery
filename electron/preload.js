// The one door between the page and the main process. The page reaches it as
// `window.__TAURI__.core.invoke` (written into the page by media.js), so the
// Tauri-era bridge and shims run unchanged.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__lgIpc", {
  invoke(cmd, args) {
    return ipcRenderer.invoke("lg:invoke", String(cmd), args || {}).then((res) => {
      if (res && res.ok) return res.value;
      // Rejected with the message itself, the way Tauri rejects.
      throw res ? res.error : "no answer from the app";
    });
  },
});
