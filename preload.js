const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  fetchUrl: (payload) => ipcRenderer.invoke("online-fetch", payload),
});
