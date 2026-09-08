"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { describeIfModule } = require("../helpers/try-require");
const { PluginCenterSession } = require("../../src/plugin-center/session");
const { demoSnapshot } = require("../../src/plugin-center/demo-snapshot");
const { buildViewModel } = require("../../src/plugin-center/view-model");

describe("Interrupted install", () => {
  it("marks the receipt aborted and leaves the plugin installable", async () => {
    const session = new PluginCenterSession(demoSnapshot());
    const controller = new AbortController();
    const pending = session.install("theme-kit", { defer: true, signal: controller.signal });
    controller.abort();
    const result = await pending;
    assert.equal(result.interrupted, true);
    assert.equal(result.ok, false);
    const model = session.snapshot();
    const plugin = model.plugins.find((row) => row.id === "theme-kit");
    assert.equal(plugin.receipt.interrupted, true);
    assert.equal(plugin.actions.install, true);
    assert.ok(plugin.tags.some((tag) => tag.id === "interrupted"));
  });

  it("can retry after an interrupted install", async () => {
    const session = new PluginCenterSession(demoSnapshot());
    session.interruptInstall("theme-kit");
    const retry = await session.install("theme-kit");
    assert.equal(retry.ok, true);
    const plugin = session.snapshot().plugins.find((row) => row.id === "theme-kit");
    assert.equal(plugin.status, "installed");
    assert.equal(plugin.receipt.status, "committed");
  });

  it("maps aborted receipts into the UI model even without a live session", () => {
    const model = buildViewModel({
      catalog: { entries: [{ id: "theme-kit", name: "dsh-theme-kit" }] },
      lifecycle: { items: [] },
      receipts: [{ id: "theme-kit", op: "install", status: "aborted", at: 1 }],
    });
    assert.equal(model.plugins[0].receipt.interrupted, true);
  });
});

describeIfModule("../../src/install", "Interrupted install via src/install", (install) => {
  it("aborts an in-flight install and does not commit the home", async () => {
    const homes = require("../../src/homes");
    const { makeTempRoot, removeTempRoot } = require("../helpers/tmp");
    const { fixtureInstallOpts } = require("../helpers/install-opts");
    const plugins = require("../fixtures/plugins");
    const root = makeTempRoot("dsh-int-");
    try {
      await assert.rejects(
        () => install.installPlugin(fixtureInstallOpts(plugins.compatible, { root, crashAfter: "unpack" })),
        (error) => error.name === "InstallCrashError" || error.step === "unpack",
      );
      const recovered = install.createWal(homes.walDir(root)).recover();
      assert.ok(recovered.length >= 1);
      assert.equal(recovered[0].status, "aborted");
      assert.equal(homes.listInstalled("active", root).some((row) => row.pluginId === "dsh-fixture-compatible"), false);
    } finally {
      removeTempRoot(root);
    }
  });
});
