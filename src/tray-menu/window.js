"use strict";

const { join } = require("node:path");
const { attachTrayMenuIpc } = require("./ipc");
const {
  DEFAULT_PANEL_HEIGHT,
  PANEL_WIDTH,
  SHADOW_PAD,
  placeTrayPopup,
  sameBounds,
  shouldIgnoreBlur,
  windowSizeForPanel,
} = require("./model");

const UI_INDEX = join(__dirname, "ui", "index.html");
const PRELOAD = join(__dirname, "preload.js");
const PARK_X = -16000;
const PARK_Y = -16000;

let currentWindow = null;
let currentGetState = () => ({});
let currentActions = {};
let lastTrayBounds = { x: 0, y: 0, width: 24, height: 24 };
let lastWorkArea = { x: 0, y: 0, width: 1920, height: 1040 };
let lastPanelHeight = DEFAULT_PANEL_HEIGHT;
let hideTimer;
let showFallback;
let attached = null;
let pendingShow = false;
let heightKnown = false;
let panelOpen = false;
let everShown = false;
let openedAt = 0;

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

function workAreaNear(electron, point) {
  const display = electron.screen?.getDisplayNearestPoint?.(point) || electron.screen?.getPrimaryDisplay?.();
  return display?.workArea || { x: 0, y: 0, width: 1920, height: 1040 };
}

function cancelHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = undefined;
}

function clearShowFallback() {
  if (showFallback) clearTimeout(showFallback);
  showFallback = undefined;
}

function applySession(options = {}) {
  const electron = resolveElectron(options.electron);
  if (options.getState || options.state) {
    currentGetState = options.getState || (() => options.state || {});
  }
  if (options.actions) currentActions = options.actions;
  if (options.bounds) lastTrayBounds = options.bounds;
  lastWorkArea = options.workArea || workAreaNear(electron, {
    x: lastTrayBounds.x,
    y: lastTrayBounds.y,
  });
  return electron;
}

function applyPopupWindowSwitches(commandLine) {
  if (!commandLine || typeof commandLine.appendSwitch !== "function") return;
  commandLine.appendSwitch("wm-window-animations-disabled");
}

function disposeWindow() {
  cancelHide();
  clearShowFallback();
  pendingShow = false;
  heightKnown = false;
  panelOpen = false;
  everShown = false;
  const win = currentWindow;
  currentWindow = null;
  attached = null;
  if (!win || win.isDestroyed()) return;
  if (typeof win.destroy === "function") win.destroy();
  else win.close();
}

function parkWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (typeof win.setSkipTaskbar === "function") win.setSkipTaskbar(true);
  if (typeof win.setFocusable === "function") win.setFocusable(false);
  if (typeof win.setIgnoreMouseEvents === "function") win.setIgnoreMouseEvents(true);
  if (typeof win.setOpacity === "function") win.setOpacity(0);
  const size = windowSizeForPanel(lastPanelHeight, { width: PANEL_WIDTH, shadow: SHADOW_PAD });
  if (typeof win.setBounds === "function") {
    win.setBounds({ x: PARK_X, y: PARK_Y, width: size.width, height: size.height }, false);
  } else if (typeof win.setPosition === "function") {
    win.setPosition(PARK_X, PARK_Y, false);
  }
}

function hideTrayMenu() {
  cancelHide();
  clearShowFallback();
  pendingShow = false;
  panelOpen = false;
  if (!currentWindow || currentWindow.isDestroyed()) return;
  if (!everShown) return;
  parkWindow(currentWindow);
}

function scheduleHide() {
  cancelHide();
  hideTimer = setTimeout(() => {
    hideTrayMenu();
  }, 80);
}

function applyPlacement(win) {
  if (!win || win.isDestroyed()) return;
  const size = windowSizeForPanel(lastPanelHeight, { width: PANEL_WIDTH, shadow: SHADOW_PAD });
  const placed = placeTrayPopup({
    trayBounds: lastTrayBounds,
    menuSize: size,
    workArea: lastWorkArea,
  });
  const current = typeof win.getBounds === "function" ? win.getBounds() : null;
  if (sameBounds(current, placed)) return;
  if (typeof win.setBounds === "function") win.setBounds(placed, false);
  else if (typeof win.setPosition === "function") win.setPosition(placed.x, placed.y, false);
}

function showAt(win) {
  if (!win || win.isDestroyed()) return;
  clearShowFallback();
  pendingShow = false;
  cancelHide();
  openedAt = Date.now();
  if (typeof win.setFocusable === "function") win.setFocusable(true);
  if (typeof win.setIgnoreMouseEvents === "function") win.setIgnoreMouseEvents(false);
  if (typeof win.setAlwaysOnTop === "function") win.setAlwaysOnTop(true, "pop-up-menu");
  applyPlacement(win);
  if (typeof win.setOpacity === "function") win.setOpacity(1);
  if (typeof win.setSkipTaskbar === "function") win.setSkipTaskbar(true);
  if (!everShown) {
    win.show();
    everShown = true;
  } else if (typeof win.isVisible === "function" && !win.isVisible()) {
    win.show();
  } else if (typeof win.focus === "function") {
    win.focus();
  }
  if (typeof win.setSkipTaskbar === "function") win.setSkipTaskbar(true);
  panelOpen = true;
}

function armShowFallback(win) {
  clearShowFallback();
  showFallback = setTimeout(() => {
    if (pendingShow && currentWindow === win && !win.isDestroyed()) showAt(win);
  }, 120);
}

function onPanelResize(win, panelHeight) {
  const next = Math.ceil(Number(panelHeight) || 0);
  if (next <= 0) return;
  lastPanelHeight = next;
  heightKnown = true;
  if (pendingShow) {
    showAt(win);
    return;
  }
  if (panelOpen) applyPlacement(win);
}

function createTrayMenuWindow(options = {}) {
  const electron = resolveElectron(options.electron);
  if (!electron?.BrowserWindow) {
    throw new Error("托盘菜单窗口需要 Electron BrowserWindow");
  }

  const size = windowSizeForPanel(lastPanelHeight);
  const placed = placeTrayPopup({
    trayBounds: lastTrayBounds,
    menuSize: size,
    workArea: lastWorkArea,
  });

  const win = new electron.BrowserWindow({
    width: placed.width,
    height: placed.height,
    x: placed.x,
    y: placed.y,
    show: false,
    frame: false,
    transparent: true,
    type: "toolbar",
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    thickFrame: false,
    focusable: true,
    paintWhenInitiallyHidden: true,
    backgroundColor: "#00000000",
    icon: options.icon,
    webPreferences: {
      preload: options.preload || PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  attached = attachTrayMenuIpc(win, {
    ipcMain: options.ipcMain || electron.ipcMain,
    getState: () => currentGetState(),
    getActions: () => currentActions,
    onDismiss: hideTrayMenu,
    onResize: (panelHeight) => onPanelResize(win, panelHeight),
  });

  win.on("blur", () => {
    if (!panelOpen) return;
    if (shouldIgnoreBlur(openedAt)) return;
    scheduleHide();
  });
  win.on("closed", () => {
    if (currentWindow === win) currentWindow = null;
    if (attached) attached = null;
    pendingShow = false;
    heightKnown = false;
    panelOpen = false;
    everShown = false;
  });

  void win.loadFile(options.page || UI_INDEX);
  if (pendingShow) armShowFallback(win);
  return win;
}

function ensureWindow(options = {}) {
  const electron = applySession(options);
  if (!electron?.BrowserWindow) {
    throw new Error("托盘菜单窗口需要 Electron BrowserWindow");
  }
  if (currentWindow && !currentWindow.isDestroyed()) return currentWindow;
  currentWindow = createTrayMenuWindow({ ...options, electron });
  return currentWindow;
}

function prepareTrayMenu(options = {}) {
  pendingShow = false;
  return ensureWindow(options);
}

function openTrayMenu(options = {}) {
  cancelHide();
  openedAt = Date.now();
  const win = ensureWindow(options);
  if (panelOpen) {
    applyPlacement(win);
    return win;
  }
  if (heightKnown || everShown) {
    showAt(win);
    return win;
  }
  pendingShow = true;
  attached?.pushModel?.();
  armShowFallback(win);
  return win;
}

function refreshTrayMenu() {
  if (!currentWindow || currentWindow.isDestroyed()) return;
  attached?.pushModel?.();
}

function getTrayMenuWindow() {
  return currentWindow && !currentWindow.isDestroyed() ? currentWindow : null;
}

function isTrayMenuOpen() {
  return Boolean(panelOpen && currentWindow && !currentWindow.isDestroyed());
}

function resetTrayMenuWindow() {
  disposeWindow();
  openedAt = 0;
}

module.exports = {
  UI_INDEX,
  PRELOAD,
  PARK_X,
  PARK_Y,
  applyPopupWindowSwitches,
  createTrayMenuWindow,
  prepareTrayMenu,
  openTrayMenu,
  hideTrayMenu,
  refreshTrayMenu,
  getTrayMenuWindow,
  isTrayMenuOpen,
  resetTrayMenuWindow,
};
