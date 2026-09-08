"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { describeIfModule } = require("../helpers/try-require");
const { createMockElectron, windowEvent } = require("../helpers/electron-mock");
const { crashSnapshot } = require("../helpers/sample-snapshot");
const { PluginCenterSession } = require("../../src/plugin-center/session");
const { createPluginCenterWindow, resetPluginCenterWindow } = require("../../src/plugin-center/window");
const { computeBadge } = require("../../src/tray-plugin/badge");

describe("Quarantine uninstall", () => {
  afterEach(() => {
    resetPluginCenterWindow();
  });

  it("uninstalls a quarantined plugin from the plugin center without DSH", async () => {
    const session = new PluginCenterSession(crashSnapshot());
    const electron = createMockElectron();
    const win = createPluginCenterWindow({ electron, session });
    const before = await electron.ipcMain.invoke("plugin-center:ready", windowEvent(win));
    assert.equal(before.plugins[0].status, "quarantined");
    assert.ok(computeBadge({ lifecycle: session.raw().lifecycle }).show);

    const result = await electron.ipcMain.invoke("plugin-center:uninstall", windowEvent(win), "crashy-host");
    assert.equal(result.ok, true);
    const after = await electron.ipcMain.invoke("plugin-center:refresh", windowEvent(win));
    const plugin = after.plugins.find((row) => row.id === "crashy-host");
    assert.equal(plugin.status, "available");
    assert.equal(plugin.actions.uninstall, false);
    assert.equal(computeBadge({ lifecycle: session.raw().lifecycle }).show, false);
  });
});

describeIfModule("../../src/install", "Quarantine uninstall via src/install + src/homes", (install) => {
  it("rebuilds a clean active home without the quarantined plugin", async () => {
    const homes = require("../../src/homes");
    const { makeTempRoot, removeTempRoot } = require("../helpers/tmp");
    const { fixtureInstallOpts } = require("../helpers/install-opts");
    const plugins = require("../fixtures/plugins");
    const root = makeTempRoot("dsh-q-");
    try {
      const ctx = install.createInstallContext(root);
      const installed = await ctx.installPlugin(fixtureInstallOpts(plugins.compatible));
      assert.equal(installed.ok, true);
      const quarantined = await ctx.quarantinePlugin({ pluginId: "dsh-fixture-compatible", reasons: ["Host 启动时进程退出。"] });
      assert.equal(quarantined.state, "quarantine");
      assert.ok(homes.listInstalled("quarantine", root).some((row) => row.pluginId === "dsh-fixture-compatible"));
      const removed = await ctx.uninstallPlugin({ pluginId: "dsh-fixture-compatible" });
      assert.equal(removed.state, "uninstalled");
      assert.equal(homes.listInstalled("active", root).some((row) => row.pluginId === "dsh-fixture-compatible"), false);
      assert.equal(homes.listInstalled("quarantine", root).some((row) => row.pluginId === "dsh-fixture-compatible"), false);
    } finally {
      removeTempRoot(root);
    }
  });
});
