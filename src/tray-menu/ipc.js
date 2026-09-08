"use strict";

const { buildTrayMenuModel, isToggleItem } = require("./model");

function attachTrayMenuIpc(win, { ipcMain, getState, getActions, onDismiss, onResize } = {}) {
  if (!win || !ipcMain) throw new Error("attachTrayMenuIpc requires win and ipcMain");

  const handles = [];
  const handle = (channel, fn) => {
    ipcMain.handle(channel, fn);
    handles.push(channel);
  };
  const fromThisWindow = (event) => event.sender === win.webContents;

  const currentModel = () => buildTrayMenuModel(typeof getState === "function" ? getState() : {});

  const pushModel = () => {
    if (win.isDestroyed()) return null;
    const model = currentModel();
    win.webContents.send("tray-menu:model", model);
    return model;
  };

  handle("tray-menu:ready", async (event) => {
    if (!fromThisWindow(event)) return null;
    return currentModel();
  });

  handle("tray-menu:action", async (event, id, payload) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    const key = String(id || "");
    const fn = (typeof getActions === "function" ? getActions() : {})[key];
    if (typeof fn !== "function") return { ok: false, error: "未知操作" };
    const toggle = isToggleItem(key);
    if (!toggle) onDismiss?.();
    const checked = payload && typeof payload === "object" ? Boolean(payload.checked) : undefined;
    await fn(toggle ? checked : undefined);
    if (toggle && !win.isDestroyed()) pushModel();
    return { ok: true };
  });

  handle("tray-menu:dismiss", async (event) => {
    if (!fromThisWindow(event)) return { ok: false };
    onDismiss?.();
    return { ok: true };
  });

  handle("tray-menu:resize", async (event, height) => {
    if (!fromThisWindow(event)) return { ok: false };
    onResize?.(Number(height) || 0);
    return { ok: true };
  });

  const detach = () => {
    for (const channel of handles) {
      if (typeof ipcMain.removeHandler === "function") ipcMain.removeHandler(channel);
    }
    handles.length = 0;
  };
  win.on("closed", detach);
  return { pushModel, detach };
}

module.exports = { attachTrayMenuIpc };
