"use strict";

const { join } = require("node:path");
const { attachPluginCenterIpc } = require("./ipc");
const { createFacade } = require("./facade");

const UI_INDEX = join(__dirname, "ui", "index.html");
const PRELOAD = join(__dirname, "preload.js");

let currentWindow = null;

function resolveElectron(injected) {
  if (injected) return injected;
  try {
    const electron = require("electron");
    if (electron && typeof electron === "object" && electron.BrowserWindow) return electron;
  } catch {
    /* running under plain node */
  }
  return null;
}

function backgroundColorFor(electron, override) {
  if (override) return override;
  return electron.nativeTheme?.shouldUseDarkColors ? "#202020" : "#f3f3f3";
}

/**
 * Factory: create a plugin-center BrowserWindow.
 * Does not create a window on module load. Does not await DSH.
 */
function createPluginCenterWindow(options = {}) {
  const electron = resolveElectron(options.electron);
  if (!electron?.BrowserWindow) {
    throw new Error("插件中心窗口需要 Electron BrowserWindow（请从壳进程打开，不要 await DSH）");
  }

  const facade = options.facade || createFacade(options);
  const loadSnapshot = options.loadSnapshot || (() => facade.loadSnapshot());
  const actions = options.actions || facade.actions;

  const win = new electron.BrowserWindow({
    width: options.width ?? 920,
    height: options.height ?? 680,
    minWidth: options.minWidth ?? 720,
    minHeight: options.minHeight ?? 480,
    title: options.title ?? "插件",
    show: options.show ?? false,
    autoHideMenuBar: true,
    backgroundColor: backgroundColorFor(electron, options.backgroundColor),
    icon: options.icon,
    parent: options.parent,
    webPreferences: {
      preload: options.preload || PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  attachPluginCenterIpc(win, {
    ipcMain: options.ipcMain || electron.ipcMain,
    shell: options.shell || electron.shell,
    clipboard: options.clipboard || electron.clipboard,
    loadSnapshot,
    actions,
  });

  win.once("ready-to-show", () => {
    if (options.show !== false) win.show();
  });
  win.on("page-title-updated", (event) => {
    event.preventDefault();
    win.setTitle(options.title ?? "插件");
  });
  win.webContents?.setWindowOpenHandler?.(({ url }) => {
    if (/^https?:/i.test(url) && electron.shell?.openExternal) void electron.shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadFile(options.page || UI_INDEX);
  win._pluginCenter = { loadSnapshot, actions, facade, uiPath: options.page || UI_INDEX };
  return win;
}

function openPluginCenter(options = {}) {
  if (currentWindow && !currentWindow.isDestroyed()) {
    if (typeof currentWindow.restore === "function" && currentWindow.isMinimized?.()) currentWindow.restore();
    currentWindow.show();
    currentWindow.focus();
    return currentWindow;
  }
  currentWindow = createPluginCenterWindow(options);
  currentWindow.on("closed", () => {
    if (currentWindow && currentWindow.isDestroyed()) currentWindow = null;
  });
  return currentWindow;
}

function getPluginCenterWindow() {
  return currentWindow && !currentWindow.isDestroyed() ? currentWindow : null;
}

function resetPluginCenterWindow() {
  if (currentWindow && !currentWindow.isDestroyed()) currentWindow.close();
  currentWindow = null;
}

module.exports = {
  UI_INDEX,
  PRELOAD,
  createPluginCenterWindow,
  openPluginCenter,
  getPluginCenterWindow,
  resetPluginCenterWindow,
};
