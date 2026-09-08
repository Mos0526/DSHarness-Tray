"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const {
  createPluginCenterWindow,
  openPluginCenter,
  resetPluginCenterWindow,
  getPluginCenterWindow,
  UI_INDEX,
} = require("../../src/plugin-center/window");
const { createMockElectron, windowEvent } = require("../helpers/electron-mock");
const { crashSnapshot } = require("../helpers/sample-snapshot");
const { PluginCenterSession } = require("../../src/plugin-center/session");

describe("plugin-center window factory", () => {
  afterEach(() => {
    resetPluginCenterWindow();
  });

  it("does not create a window when the module is loaded", () => {
    const loaded = require("../../src/plugin-center/window");
    assert.equal(typeof loaded.createPluginCenterWindow, "function");
    assert.equal(loaded.getPluginCenterWindow(), null);
  });

  it("loads the plugin-center UI page without awaiting DSH", () => {
    let dshStarted = 0;
    const electron = createMockElectron();
    const session = new PluginCenterSession(crashSnapshot());
    const win = createPluginCenterWindow({
      electron,
      session,
      loadSnapshot: async () => {
        assert.equal(dshStarted, 0);
        return session.raw();
      },
    });
    assert.equal(win._loaded, UI_INDEX);
    assert.equal(existsSync(UI_INDEX), true);
    assert.equal(win.opts.webPreferences.preload.endsWith("preload.js"), true);
    assert.equal(win.opts.webPreferences.contextIsolation, true);
    assert.equal(win.opts.webPreferences.nodeIntegration, false);
    assert.equal(dshStarted, 0);
  });

  it("openPluginCenter reuses the same window", () => {
    const electron = createMockElectron();
    const first = openPluginCenter({ electron, initial: crashSnapshot() });
    const second = openPluginCenter({ electron, initial: crashSnapshot() });
    assert.equal(first, second);
    assert.equal(getPluginCenterWindow(), first);
    assert.equal(electron._windows.length, 1);
  });

  it("refresh IPC force-refreshes the catalog before reloading the snapshot", async () => {
    let refreshed = 0;
    const electron = createMockElectron();
    const session = new PluginCenterSession(crashSnapshot());
    const win = createPluginCenterWindow({
      electron,
      facade: {
        loadSnapshot: async () => session.raw(),
        actions: {
          refresh: async () => {
            refreshed += 1;
            return { ok: true };
          },
          install: async () => ({ ok: false }),
          uninstall: async () => ({ ok: false }),
          upgrade: async () => ({ ok: false }),
          openQuarantine: async () => ({ ok: false }),
        },
      },
    });
    await electron.ipcMain.invoke("plugin-center:refresh", windowEvent(win));
    assert.equal(refreshed, 1);
  });

  it("exposes uninstall after host crash via IPC", async () => {
    const electron = createMockElectron();
    const session = new PluginCenterSession(crashSnapshot());
    const win = createPluginCenterWindow({ electron, session });
    const model = await electron.ipcMain.invoke("plugin-center:ready", windowEvent(win));
    const plugin = model.plugins.find((row) => row.id === "crashy-host");
    assert.equal(plugin.actions.uninstall, true);
    assert.equal(plugin.actions.openQuarantine, true);
    const result = await electron.ipcMain.invoke("plugin-center:uninstall", windowEvent(win), "crashy-host");
    assert.equal(result.ok, true);
    const next = await electron.ipcMain.invoke("plugin-center:refresh", windowEvent(win));
    assert.equal(next.plugins.find((row) => row.id === "crashy-host").status, "available");
  });

  it("toggles favorites through IPC and keeps the history in snapshots", async () => {
    const electron = createMockElectron();
    const win = createPluginCenterWindow({ electron, initial: crashSnapshot() });
    const initial = await electron.ipcMain.invoke("plugin-center:ready", windowEvent(win));
    const plugin = initial.plugins[0];
    const added = await electron.ipcMain.invoke(
      "plugin-center:toggle-favorite",
      windowEvent(win),
      {
        id: plugin.id,
        name: plugin.name,
        npmName: plugin.npmName,
        repositoryUrl: plugin.repositoryUrl,
        favorite: true,
      },
    );
    assert.equal(added.ok, true);
    assert.equal(added.model.plugins.find((item) => item.id === plugin.id).favorite.active, true);
    assert.equal(added.model.favoriteHistory[0].action, "favorite");

    const removed = await electron.ipcMain.invoke(
      "plugin-center:toggle-favorite",
      windowEvent(win),
      { id: plugin.id, name: plugin.name, favorite: false },
    );
    assert.equal(removed.model.plugins.find((item) => item.id === plugin.id).favorite.active, false);
    assert.deepEqual(removed.model.favoriteHistory.map((item) => item.action), ["unfavorite", "favorite"]);
  });

  it("streams install stages to the renderer and finishes with a terminal event", async () => {
    const electron = createMockElectron();
    const session = new PluginCenterSession(crashSnapshot());
    const win = createPluginCenterWindow({
      electron,
      facade: {
        loadSnapshot: async () => session.raw(),
        actions: {
          install: async (_id, { onProgress }) => {
            onProgress({ stage: "gate", message: "正在校验…" });
            onProgress({ stage: "staging-verify", message: "正在隔离验证…" });
            return { ok: true };
          },
          uninstall: async () => ({ ok: true }),
          upgrade: async () => ({ ok: true }),
          openQuarantine: async () => ({ ok: true }),
        },
      },
    });
    const result = await electron.ipcMain.invoke("plugin-center:install", windowEvent(win), "demo");
    assert.equal(result.ok, true);
    const operations = win._sent
      .filter(([channel]) => channel === "plugin-center:operation")
      .map(([, payload]) => payload);
    assert.deepEqual(operations.map((item) => item.stage), [
      "prepare",
      "gate",
      "staging-verify",
      "done",
    ]);
    assert.equal(operations.at(-1).done, true);
    assert.equal(operations.at(-1).ok, true);
  });

  it("copies only bounded npm install commands", async () => {
    const electron = createMockElectron();
    const win = createPluginCenterWindow({ electron, initial: crashSnapshot() });
    const command = "npm install @owner/demo@1.2.3 --ignore-scripts";
    const copied = await electron.ipcMain.invoke(
      "plugin-center:copy-text",
      windowEvent(win),
      command,
    );
    assert.equal(copied.ok, true);
    assert.equal(electron.clipboard.value, command);
    const rejected = await electron.ipcMain.invoke(
      "plugin-center:copy-text",
      windowEvent(win),
      "powershell Remove-Item -Recurse C:\\",
    );
    assert.equal(rejected.ok, false);
  });
});
