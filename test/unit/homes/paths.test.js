"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { join, sep } = require("node:path");
const { encodePluginId, ledgerRoot, pluginStorePath, resolveHome, walDir } = require("../../../src/homes/paths");

describe("homes paths", () => {
  it("keeps each kind as an independent DSH_HOME under homes/", () => {
    const root = "E:\\shell-dsh";
    assert.equal(resolveHome(root, "safe"), join(root, "homes", "safe"));
    assert.equal(resolveHome(root, "active"), join(root, "homes", "active"));
    assert.equal(resolveHome(root, "staging"), join(root, "homes", "staging"));
    assert.equal(resolveHome(root, "quarantine"), join(root, "homes", "quarantine"));
    assert.equal(walDir(root), join(root, "ledger", "wal"));
    assert.equal(ledgerRoot(root), join(root, "ledger"));
    assert.equal(encodePluginId("@acme/plug"), encodeURIComponent("@acme/plug"));
  });

  it("keeps hostile plugin ids inside the plugin store", () => {
    const home = "E:\\shell-dsh\\homes\\staging";
    const target = pluginStorePath(home, "..\\..\\outside");
    const store = join(home, "shell-plugins");
    assert.equal(target.startsWith(`${store}${sep}`), true);
    assert.match(target, /%5C/);
    assert.equal(pluginStorePath(home, ".."), join(store, "%2E%2E"));
    assert.equal(pluginStorePath(home, "."), join(store, "%2E"));
    assert.throws(() => pluginStorePath(home, ""), /invalid plugin id/);
    assert.throws(() => pluginStorePath(home, "bad\u0000id"), /invalid plugin id/);
  });
});
