const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("externalMedia", {
  onState(callback) { ipcRenderer.on("external-media:state", (_event, state) => callback(state)); },
  close() { ipcRenderer.send("external-media:close"); },
});
