"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const {
  UI_INDEX,
  PARK_X,
  openTrayMenu,
  prepareTrayMenu,
  hideTrayMenu,
  resetTrayMenuWindow,
  getTrayMenuWindow,
  isTrayMenuOpen,
  applyPopupWindowSwitches,
  OPEN_WINDOW_ID,
} = require("../../src/tray-menu");
const { OPEN_AT_LOGIN_ID } = require("../../src/shell-settings");
const { createMockElectron, windowEvent } = require("../helpers/electron-mock");

describe("tray-menu window factory", () => {
  afterEach(() => {
    resetTrayMenuWindow();
  });

  it("does not create a window when the module is loaded", () => {
    assert.equal(getTrayMenuWindow(), null);
    assert.equal(existsSync(UI_INDEX), true);
  });

  it("disables Windows popup show/hide animations", () => {
    const switches = [];
    applyPopupWindowSwitches({ appendSwitch: (name) => switches.push(name) });
    assert.ok(switches.includes("wm-window-animations-disabled"));
  });

  it("preloads hidden and shows immediately once height is known", async () => {
    const electron = createMockElectron();
    const win = prepareTrayMenu({
      electron,
      bounds: { x: 1800, y: 1000, width: 24, height: 24 },
      state: { settings: { openAtLogin: true } },
      actions: {},
    });
    assert.equal(win.isVisible(), false);
    assert.equal(isTrayMenuOpen(), false);
    await electron.ipcMain.invoke("tray-menu:resize", windowEvent(win), 320);
    assert.equal(win.isVisible(), false);

    const opened = openTrayMenu({
      electron,
      bounds: { x: 1800, y: 1000, width: 24, height: 24 },
      state: { settings: { openAtLogin: true } },
      actions: {},
    });
    assert.equal(opened, win);
    assert.equal(isTrayMenuOpen(), true);
    assert.equal(win._showCount, 1);
  });

  it("reopens without calling show again after the first appearance", async () => {
    const electron = createMockElectron();
    const first = openTrayMenu({
      electron,
      bounds: { x: 1800, y: 1000, width: 24, height: 24 },
      state: { settings: { openAtLogin: true } },
      actions: {},
    });
    const second = openTrayMenu({
      electron,
      bounds: { x: 1800, y: 1000, width: 24, height: 24 },
      state: { settings: { openAtLogin: true } },
      actions: {},
    });
    assert.equal(first, second);
    assert.equal(electron._windows.length, 1);
    assert.equal(first.opts.frame, false);
    assert.equal(first.opts.transparent, true);
    assert.equal(first.opts.type, "toolbar");
    assert.equal(first.opts.skipTaskbar, true);
    assert.equal(first._loaded, UI_INDEX);
    assert.equal(isTrayMenuOpen(), false);
    await electron.ipcMain.invoke("tray-menu:resize", windowEvent(first), 320);
    assert.equal(isTrayMenuOpen(), true);
    assert.equal(first._showCount, 1);

    const model = await electron.ipcMain.invoke("tray-menu:ready", windowEvent(first));
    assert.deepEqual(model.groups.map((group) => group.id), ["main", "settings", "about", "quit"]);
    assert.equal(model.groups[1].items[0].checked, true);

    hideTrayMenu();
    assert.equal(first.isDestroyed(), false);
    assert.equal(isTrayMenuOpen(), false);
    assert.equal(first._opacity, 0);
    assert.equal(first._skipTaskbar, true);
    assert.equal(first.getBounds().x, PARK_X);
    assert.equal(getTrayMenuWindow(), first);

    const again = openTrayMenu({
      electron,
      bounds: { x: 1800, y: 1000, width: 24, height: 24 },
      state: { settings: { openAtLogin: true } },
      actions: {},
    });
    assert.equal(again, first);
    assert.equal(electron._windows.length, 1);
    assert.equal(isTrayMenuOpen(), true);
    assert.equal(first._opacity, 1);
    assert.equal(first._showCount, 1);
    assert.equal(first._skipTaskbar, true);
    assert.notEqual(first.getBounds().x, PARK_X);
  });

  it("dismisses command actions and keeps the popup open for toggles", async () => {
    const electron = createMockElectron();
    let opened = 0;
    let login = null;
    const win = openTrayMenu({
      electron,
      bounds: { x: 100, y: 100, width: 24, height: 24 },
      getState: () => ({ settings: { openAtLogin: Boolean(login) } }),
      actions: {
        [OPEN_WINDOW_ID]: () => {
          opened += 1;
        },
        [OPEN_AT_LOGIN_ID]: (checked) => {
          login = checked;
        },
      },
    });
    await electron.ipcMain.invoke("tray-menu:resize", windowEvent(win), 320);
    await electron.ipcMain.invoke("tray-menu:action", windowEvent(win), OPEN_AT_LOGIN_ID, { checked: true });
    assert.equal(login, true);
    assert.equal(isTrayMenuOpen(), true);
    assert.equal(win.isDestroyed(), false);

    await electron.ipcMain.invoke("tray-menu:action", windowEvent(win), OPEN_WINDOW_ID);
    assert.equal(opened, 1);
    assert.equal(win.isDestroyed(), false);
    assert.equal(isTrayMenuOpen(), false);
    assert.equal(getTrayMenuWindow(), win);
    assert.equal(win._showCount, 1);
  });

  it("does not hide the popup when the tray click steals focus during open", async () => {
    const electron = createMockElectron();
    const win = openTrayMenu({
      electron,
      bounds: { x: 100, y: 100, width: 24, height: 24 },
      state: {},
      actions: {},
    });
    await electron.ipcMain.invoke("tray-menu:resize", windowEvent(win), 320);
    assert.equal(isTrayMenuOpen(), true);
    win._emit("blur");
    assert.equal(isTrayMenuOpen(), true);
  });
});
