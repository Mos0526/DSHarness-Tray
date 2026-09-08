"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { describeIfModule } = require("../helpers/try-require");
const { createMockElectron, windowEvent } = require("../helpers/electron-mock");
const { rendererFailSnapshot } = require("../helpers/sample-snapshot");
const { PluginCenterSession } = require("../../src/plugin-center/session");
const { createPluginCenterWindow, resetPluginCenterWindow } = require("../../src/plugin-center/window");
const { computeBadge } = require("../../src/tray-plugin/badge");
const { buildViewModel } = require("../../src/plugin-center/view-model");
const plugins = require("../fixtures/plugins");
const { spawnFakeDsh, waitForReady, waitForExit, stopFakeDsh } = require("../fixtures/fake-dsh");

describe("Renderer failure", () => {
  const children = [];
  afterEach(async () => {
    resetPluginCenterWindow();
    await Promise.all(children.splice(0).map((child) => stopFakeDsh(child)));
  });

  it("records verifyFailed after fake renderer settle failure", async () => {
    const child = spawnFakeDsh({ plugin: plugins.rendererIncompatible });
    children.push(child);
    await waitForReady(child);
    const exited = await waitForExit(child);
    assert.equal(exited.code, 2);

    const raw = rendererFailSnapshot();
    const model = buildViewModel(raw);
    const plugin = model.plugins.find((row) => row.id === "renderer-flake");
    assert.equal(plugin.status, "verifyFailed");
    assert.equal(plugin.shellVerify.renderer, "fail");
    assert.equal(plugin.shellVerify.host, "pass");
    assert.ok(plugin.tags.some((tag) => tag.id === "verifyFailed"));
    assert.deepEqual(computeBadge({ lifecycle: raw.lifecycle }).reasons, ["verifyFailed"]);

    const electron = createMockElectron();
    const win = createPluginCenterWindow({
      electron,
      session: new PluginCenterSession(raw),
    });
    const snapshot = await electron.ipcMain.invoke("plugin-center:ready", windowEvent(win));
    assert.equal(snapshot.plugins[0].actions.openQuarantine, true);
  });
});

describeIfModule("../../src/runtime", "Renderer failure via src/runtime", (runtime) => {
  it("surfaces renderer settle failure through the supervisor", async () => {
    const { makeTempRoot, removeTempRoot } = require("../helpers/tmp");
    const { BIN } = require("../fixtures/fake-dsh");
    const { join } = require("node:path");
    const { checkCompat } = require("../../src/install/compat");
    const { readFileSync } = require("node:fs");
    const root = makeTempRoot("dsh-renderer-");
    const supervisor = runtime.createSupervisor({ autoRecoverSafe: false });
    try {
      try {
        await supervisor.start({
          dshBinary: BIN,
          dshHome: join(root, "homes", "safe"),
          mode: "safe",
          extraEnv: { FAKE_DSH_MODE: "fail-renderer" },
          readyTimeoutMs: 4000,
        });
      } catch {
        /* ready may lose the race to the renderer exit */
      }
      const deadline = Date.now() + 2500;
      while (supervisor.getStatus().state !== "crashed" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(supervisor.getStatus().state, "crashed");
      const pkg = JSON.parse(readFileSync(require("node:path").join(plugins.rendererIncompatible, "package.json"), "utf8"));
      const compat = checkCompat({
        pluginManifest: pkg,
        dshInfo: { version: "0.9.0", host: "0.9.0", renderer: "0.9.0" },
      });
      assert.equal(compat.ok, false);
      assert.equal(compat.renderer.ok, false);
    } finally {
      await supervisor.stop();
      removeTempRoot(root);
    }
  });
});
