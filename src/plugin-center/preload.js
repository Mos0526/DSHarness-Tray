"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pluginCenter", {
  onSnapshot: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("plugin-center:snapshot", handler);
    return () => ipcRenderer.removeListener("plugin-center:snapshot", handler);
  },
  onOperation: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("plugin-center:operation", handler);
    return () => ipcRenderer.removeListener("plugin-center:operation", handler);
  },
  ready: () => ipcRenderer.invoke("plugin-center:ready"),
  refresh: () => ipcRenderer.invoke("plugin-center:refresh"),
  enrich: (payload) => ipcRenderer.invoke("plugin-center:enrich", payload),
  install: (id) => ipcRenderer.invoke("plugin-center:install", id),
  uninstall: (id) => ipcRenderer.invoke("plugin-center:uninstall", id),
  upgrade: (id) => ipcRenderer.invoke("plugin-center:upgrade", id),
  openQuarantine: (id) => ipcRenderer.invoke("plugin-center:open-quarantine", id),
  toggleFavorite: (plugin) => ipcRenderer.invoke("plugin-center:toggle-favorite", plugin),
  openExternal: (url) => ipcRenderer.invoke("plugin-center:open-external", url),
  copyText: (text) => ipcRenderer.invoke("plugin-center:copy-text", text),
});
