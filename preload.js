const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  readThumbCache(payload) {
    return ipcRenderer.invoke("thumb-cache-read", payload || {});
  },
  writeThumbCache(payload) {
    return ipcRenderer.invoke("thumb-cache-write", payload || {});
  },
});
