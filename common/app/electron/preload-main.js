const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("grokChameleonNative", {
  openExternalMedia(payload) {
    return ipcRenderer.invoke("grok-chameleon:external-media-open", payload);
  },
  finishExternalMediaDrag(point) {
    return ipcRenderer.invoke("grok-chameleon:external-media-finish-drag", point);
  },
  updateExternalMedia(payload) {
    ipcRenderer.send("grok-chameleon:external-media-update", payload);
  },
  closeExternalMedia() {
    ipcRenderer.send("grok-chameleon:external-media-close");
  },
  onExternalMediaClosed(callback) {
    const listener = () => callback();
    ipcRenderer.on("grok-chameleon:external-media-closed", listener);
    return () => ipcRenderer.removeListener("grok-chameleon:external-media-closed", listener);
  },
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
  extractVideoFrame(payload) {
    return ipcRenderer.invoke("grok-chameleon:extract-video-frame", payload || {});
  },
  captureFullscreenVideo(payload) {
    return ipcRenderer.invoke("grok-chameleon:capture-fullscreen-video", payload || {});
  },
  captureLog(message) {
    return ipcRenderer.invoke("grok-chameleon:capture-log", String(message || ""));
  },
  isWindowFullscreen() {
    return ipcRenderer.invoke("grok-chameleon:is-window-fullscreen");
  },
  leaveCaptureFullscreen() {
    return ipcRenderer.invoke("grok-chameleon:leave-capture-fullscreen");
  },
  previewVideoJoin(payload) {
    return ipcRenderer.invoke("grok-chameleon:preview-video-join", payload || {});
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
  onLibraryBackupProgress(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("grok-chameleon:library-backup-progress", listener);
    return () => ipcRenderer.removeListener("grok-chameleon:library-backup-progress", listener);
  },
});
