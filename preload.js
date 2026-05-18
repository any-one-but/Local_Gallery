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
  writeDownloadFile(payload) {
    return ipcRenderer.invoke("downloads-write-file", payload || {});
  },
});
