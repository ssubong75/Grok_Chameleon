const { contextBridge, ipcRenderer, webUtils } = require("electron");

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
  extractAudio(payload) {
    return ipcRenderer.invoke("grok-chameleon:extract-audio", payload || {});
  },
  audioPeaks(payload) {
    return ipcRenderer.invoke("grok-chameleon:audio-peaks", payload || {});
  },
  localAudioPeaks(payload) {
    return ipcRenderer.invoke("grok-chameleon:local-audio-peaks", payload || {});
  },
  readAudioFile(payload) {
    return ipcRenderer.invoke("grok-chameleon:read-audio-file", payload || {});
  },
  saveAudioEdit(payload) {
    return ipcRenderer.invoke("grok-chameleon:save-audio-edit", payload || {});
  },
  pickAudioFiles() {
    return ipcRenderer.invoke("grok-chameleon:pick-audio-files");
  },
  getPathForFile(file) {
    return webUtils.getPathForFile(file);
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
  openPhotoEditor(payload) {
    return ipcRenderer.invoke("grok-chameleon:open-photo-editor", payload || {});
  },
  onPhotoEditorDone(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("grok-chameleon:photo-editor-done", listener);
    return () => ipcRenderer.removeListener("grok-chameleon:photo-editor-done", listener);
  },
  onLibraryBackupProgress(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("grok-chameleon:library-backup-progress", listener);
    return () => ipcRenderer.removeListener("grok-chameleon:library-backup-progress", listener);
  },
});
