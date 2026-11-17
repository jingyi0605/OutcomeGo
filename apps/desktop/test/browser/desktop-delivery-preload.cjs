const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("outcomego", {
  computer: { messagesIcon: async () => null },
  deliveryJournal: {
    read: (scope) => ipcRenderer.invoke("fixture:journal:read", scope),
    write: (scope, record) => ipcRenderer.invoke("fixture:journal:write", scope, record),
  },
});
