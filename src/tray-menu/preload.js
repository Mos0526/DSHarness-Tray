"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trayMenu", {
  ready: () => ipcRenderer.invoke("tray-menu:ready"),
  action: (id, payload) => ipcRenderer.invoke("tray-menu:action", id, payload),
  dismiss: () => ipcRenderer.invoke("tray-menu:dismiss"),
  resize: (height) => ipcRenderer.invoke("tray-menu:resize", height),
  onModel: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("tray-menu:model", handler);
    return () => ipcRenderer.removeListener("tray-menu:model", handler);
  },
});
