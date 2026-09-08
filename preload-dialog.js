const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("dshDialog", {
  onData: (callback) => {
    ipcRenderer.on("dialog-data", (_event, data) => callback(data));
  },
  choose: (index) => ipcRenderer.send("dialog-choice", index),
});
