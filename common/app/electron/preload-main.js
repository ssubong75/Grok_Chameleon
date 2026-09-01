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
});
