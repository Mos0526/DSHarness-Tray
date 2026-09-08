"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { describeIfModule } = require("../helpers/try-require");
const { PluginCenterSession } = require("../../src/plugin-center/session");
const { outdatedSnapshot } = require("../helpers/sample-snapshot");
const plugins = require("../fixtures/plugins");

describe("Plugin newer version detection", () => {
  it("detects v2 as the compatible update for the outdated fixture", async () => {
    const oldPkg = JSON.parse(readFileSync(join(plugins.outdated, "package.json"), "utf8"));
    const newPkg = JSON.parse(readFileSync(join(plugins.outdatedUpdate, "package.json"), "utf8"));
    assert.notEqual(oldPkg.version, newPkg.version);
    assert.equal(oldPkg.dshFixture.update.path, "../v2");
    assert.equal(newPkg.dshFixture.replaces, "1.0.0");

    const session = new PluginCenterSession(outdatedSnapshot());
    const before = session.snapshot().plugins[0];
    assert.equal(before.updateAvailable || before.tags.some((tag) => tag.id === "updateAvailable"), true);
    const upgraded = await session.upgrade("fixture.outdated");
    assert.equal(upgraded.ok, true);
    const after = session.snapshot().plugins[0];
    assert.equal(after.versions.installed, "2.0.0");
    assert.equal(after.status, "installed");
    assert.equal(after.tags.some((tag) => tag.id === "updateAvailable"), false);
  });
});

describeIfModule("../../src/catalog", "Plugin update via src/catalog", (catalog) => {
  it("lists the outdated fixture from a local catalog snapshot and pairs it with a newer candidate", async () => {
    const { makeTempRoot, removeTempRoot } = require("../helpers/tmp");
    const { findCompatibleUpdate } = require("../../src/install/compat");
    const cacheDir = makeTempRoot("dsh-catalog-");
    try {
      const created = catalog.createCatalog({
        cacheDir,
        enrichSignals: false,
        fetchFn: async () => ({
          status: 200,
          headers: { etag: "\"fixture\"" },
          text: async () => "## Plugins\n\n- [example/dsh-fixture-outdated](https://github.com/example/dsh-fixture-outdated) - outdated fixture npm: dsh-fixture-outdated\n",
        }),
      });
      const refreshed = await created.refreshCatalog({ force: true });
      assert.ok(refreshed.plugins.some((row) => /outdated/i.test(`${row.displayName} ${row.npmName} ${row.stableId}`)));
      const oldPkg = JSON.parse(readFileSync(join(plugins.outdated, "package.json"), "utf8"));
      const newPkg = JSON.parse(readFileSync(join(plugins.outdatedUpdate, "package.json"), "utf8"));
      const found = findCompatibleUpdate({
        pluginId: "dsh-fixture-outdated",
        dshInfo: { version: "0.9.0", host: "0.9.0", renderer: "0.9.0" },
        availableVersions: [
          { version: oldPkg.version, manifest: oldPkg },
          { version: newPkg.version, manifest: newPkg },
        ],
      });
      assert.equal(found.version, "2.0.0");
    } finally {
      removeTempRoot(cacheDir);
    }
  });
});
