const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chat', {
  send: (message) => ipcRenderer.invoke('chat:send', message),
  onEvent: (callback) => ipcRenderer.on('chat:event', (_e, event) => callback(event)),
});
