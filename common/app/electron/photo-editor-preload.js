const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("photocraftHost", {
  saved(bytes) {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-save", bytes);
  },
  closed() {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-close");
  },
});
