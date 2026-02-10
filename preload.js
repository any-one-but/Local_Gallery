const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  fetchUrl: (payload) => ipcRenderer.invoke("online-fetch", payload),
  downloadUrl: (payload) => ipcRenderer.invoke("online-download-file", payload),
});
