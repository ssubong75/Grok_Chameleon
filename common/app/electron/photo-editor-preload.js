const { contextBridge, ipcRenderer,webUtils } = require("electron");

contextBridge.exposeInMainWorld("photocraftHost", {
  fileSave(operation,value){return ipcRenderer.invoke('grok-chameleon:photo-editor-file-save',operation,value);},
  adoptFile(file){const path=webUtils.getPathForFile(file);return path?ipcRenderer.invoke('grok-chameleon:photo-editor-file-save','adopt',{path}):Promise.resolve(null);},
  setTitle(title){ipcRenderer.send('grok-chameleon:photo-editor-title',title);},
  syncMenu(model){ipcRenderer.send('grok-chameleon:photo-editor-menu',model);},
  onMenuCommand(callback){const listener=(_event,id)=>callback(id);ipcRenderer.on('grok-chameleon:photo-editor-menu-command',listener);return()=>ipcRenderer.removeListener('grok-chameleon:photo-editor-menu-command',listener);},
  appendHistoryLog(line){return ipcRenderer.invoke('grok-chameleon:photo-editor-history-log',line);},
  encodeLosslessWebp(bytes){return ipcRenderer.invoke('grok-chameleon:photo-editor-webp',bytes);},
  exportRaster(bytes,name){return ipcRenderer.invoke('grok-chameleon:photo-editor-export-raster',bytes,name);},
  recentFiles(operation,value){if(!['list','open','clear'].includes(operation))throw Error('Unsupported recent-file operation.');return ipcRenderer.invoke('grok-chameleon:photo-editor-recents',operation,value);},
  rememberFile(file){const path=webUtils.getPathForFile(file);return path?ipcRenderer.invoke('grok-chameleon:photo-editor-recents','remember',path):Promise.resolve(false);},
  recovery(operation,value){return ipcRenderer.invoke('grok-chameleon:photo-editor-recovery',operation,value);},
  loadWorkspace(){return ipcRenderer.invoke('grok-chameleon:photo-editor-workspace',null);},
  saveWorkspace(value){return ipcRenderer.invoke('grok-chameleon:photo-editor-workspace',value);},
  loadPreferences(){return ipcRenderer.invoke('grok-chameleon:photo-editor-preferences',null);},
  savePreferences(value){return ipcRenderer.invoke('grok-chameleon:photo-editor-preferences',value);},
  chooseLinkedFile() {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-linked-file", null);
  },
  readLinkedFile(token) {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-linked-file", token);
  },
  saved(bytes) {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-save", bytes);
  },
  closed() {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-close");
  },
  writeClipboard(bytes) {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-clipboard-write", bytes);
  },
  readClipboard() {
    return ipcRenderer.invoke("grok-chameleon:photo-editor-clipboard-read");
  },
});
