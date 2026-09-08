"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { describeIfModule } = require("../helpers/try-require");
const { createMockElectron, windowEvent } = require("../helpers/electron-mock");
const { crashSnapshot } = require("../helpers/sample-snapshot");
const { PluginCenterSession } = require("../../src/plugin-center/session");
const { createPluginCenterWindow, resetPluginCenterWindow } = require("../../src/plugin-center/window");
const { computeBadge } = require("../../src/tray-plugin/badge");
const plugins = require("../fixtures/plugins");
const { spawnFakeDsh, waitForReady, stopFakeDsh } = require("../fixtures/fake-dsh");

describe("Host crash: shell still opens plugin center", () => {
  const children = [];
  afterEach(async () => {
    resetPluginCenterWindow();
    await Promise.all(children.splice(0).map((child) => stopFakeDsh(child)));
  });

  it("opens the plugin center and uninstall entry after fake Host crash", async () => {
    const child = spawnFakeDsh({ plugin: plugins.hostIncompatible });
    children.push(child);
    await assert.rejects(() => waitForReady(child, 3000), /就绪前退出|code 1/);

    let dshRestarted = 0;
    const session = new PluginCenterSession(crashSnapshot());
    const electron = createMockElectron();
    const win = createPluginCenterWindow({
      electron,
      session,
      loadSnapshot: async () => {
        assert.equal(dshRestarted, 0);
        return session.raw();
      },
    });
    const model = await electron.ipcMain.invoke("plugin-center:ready", windowEvent(win));
    const plugin = model.plugins.find((row) => row.id === "crashy-host");
    assert.ok(plugin, "quarantined plugin is listed");
    assert.equal(plugin.actions.uninstall, true);
    assert.equal(plugin.actions.openQuarantine, true);
    const badge = computeBadge({ lifecycle: session.raw().lifecycle });
    assert.ok(badge.reasons.includes("quarantined"));
    assert.equal(dshRestarted, 0);
  });
});

describeIfModule("../../src/runtime", "Host crash via src/runtime", (runtime) => {
  it("keeps plugin-center available after supervisor reports host crash", async () => {
    const { makeTempRoot, removeTempRoot } = require("../helpers/tmp");
    const { BIN } = require("../fixtures/fake-dsh");
    const { join } = require("node:path");
    assert.equal(typeof runtime.createSupervisor, "function");
    const root = makeTempRoot("dsh-host-");
    const supervisor = runtime.createSupervisor({ autoRecoverSafe: false });
    try {
      await assert.rejects(() => supervisor.start({
        dshBinary: BIN,
        dshHome: join(root, "homes", "safe"),
        mode: "safe",
        extraEnv: { FAKE_DSH_MODE: "crash-host" },
        readyTimeoutMs: 4000,
      }));
      assert.equal(supervisor.getStatus().state, "crashed");
      const electron = createMockElectron();
      const win = createPluginCenterWindow({ electron, initial: crashSnapshot() });
      const model = await electron.ipcMain.invoke("plugin-center:ready", windowEvent(win));
      assert.ok(model.plugins.some((row) => row.actions.uninstall));
    } finally {
      await supervisor.stop();
      removeTempRoot(root);
    }
  });
});
