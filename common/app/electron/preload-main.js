const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("grokChameleonNative", {
  activateImagineAccount(payload) {
    return ipcRenderer.invoke("grok-chameleon:activate-imagine-account", payload || {});
  },
  warmImagineUsage(payload) {
    return ipcRenderer.invoke("grok-chameleon:warm-imagine-usage", payload || {});
  },
  openImagineUsage(payload) {
    return ipcRenderer.invoke("grok-chameleon:open-imagine-usage", payload || {});
  },
  cardPreview(payload) {
    return ipcRenderer.invoke("grok-chameleon:card-preview", payload || {});
  },
  translatePrompt(payload) {
    return ipcRenderer.invoke("grok-chameleon:translate-prompt", payload || {});
  },
  chooseLibraryBackupFolder(payload) {
    return ipcRenderer.invoke("grok-chameleon:library-backup-choose", payload || {});
  },
  libraryBackupStatus(payload) {
    return ipcRenderer.invoke("grok-chameleon:library-backup-status", payload || {});
  },
  analyzeLibraryBackup(payload) {
    return ipcRenderer.invoke("grok-chameleon:library-backup-analyze", payload || {});
  },
  executeLibraryBackup(payload) {
    return ipcRenderer.invoke("grok-chameleon:library-backup-execute", payload || {});
  },
  cancelLibraryBackup() {
    return ipcRenderer.invoke("grok-chameleon:library-backup-cancel");
  },
  onLibraryBackupProgress(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("grok-chameleon:library-backup-progress", listener);
    return () => ipcRenderer.removeListener("grok-chameleon:library-backup-progress", listener);
  },
});
