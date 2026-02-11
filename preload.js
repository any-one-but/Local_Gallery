const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  fetchUrl: (payload) => ipcRenderer.invoke("online-fetch", payload),
  downloadUrl: (payload) => ipcRenderer.invoke("online-download-file", payload),
  scrubFolder: (payload) => ipcRenderer.invoke("scrub-folder", payload),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return ""; }
  },
});
