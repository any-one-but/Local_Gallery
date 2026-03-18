const { contextBridge, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  getPathForFile(file) {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
});
