"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { describeIfModule } = require("../helpers/try-require");
const { outdatedSnapshot } = require("../helpers/sample-snapshot");
const { buildViewModel } = require("../../src/plugin-center/view-model");
const { computeBadge } = require("../../src/tray-plugin/badge");
const plugins = require("../fixtures/plugins");

describe("Incompatible upgrade", () => {
  it("keeps the old plugin isolated and offers the compatible new version", () => {
    const oldPkg = JSON.parse(readFileSync(join(plugins.outdated, "package.json"), "utf8"));
    const newPkg = JSON.parse(readFileSync(join(plugins.outdatedUpdate, "package.json"), "utf8"));
    assert.equal(oldPkg.dshFixture.compat.currentDsh, false);
    assert.equal(newPkg.dshFixture.compat.host, true);

    const model = buildViewModel(outdatedSnapshot());
    const plugin = model.plugins.find((row) => row.id === "fixture.outdated");
    assert.equal(plugin.status, "quarantined");
    assert.ok(plugin.tags.some((tag) => tag.id === "quarantined"));
    assert.ok(plugin.tags.some((tag) => tag.id === "updateAvailable"));
    assert.equal(plugin.versions.installed, "1.0.0");
    assert.equal(plugin.versions.available, "2.0.0");
    assert.equal(plugin.actions.upgrade, true);
    assert.equal(plugin.actions.uninstall, true);
    const reasons = computeBadge({ lifecycle: outdatedSnapshot().lifecycle }).reasons;
    assert.ok(reasons.includes("updateAvailable"));
    assert.ok(reasons.includes("quarantined"));
  });
});

describeIfModule("../../src/install", "Incompatible upgrade via src/install", (install) => {
  it("does not roll back DSH; isolates the old plugin and detects a newer compatible candidate", () => {
    const oldPkg = JSON.parse(readFileSync(join(plugins.outdated, "package.json"), "utf8"));
    const newPkg = JSON.parse(readFileSync(join(plugins.outdatedUpdate, "package.json"), "utf8"));
    const dshInfo = { version: "0.9.0", host: "0.9.0", renderer: "0.9.0" };
    const current = install.checkCompat({ pluginManifest: oldPkg, dshInfo });
    const next = install.checkCompat({ pluginManifest: newPkg, dshInfo });
    assert.equal(current.ok, false);
    assert.equal(next.ok, true);
    const found = install.findCompatibleUpdate({
      pluginId: "dsh-fixture-outdated",
      dshInfo,
      availableVersions: [
        { version: oldPkg.version, manifest: oldPkg },
        { version: newPkg.version, manifest: newPkg },
      ],
    });
    assert.equal(found.version, "2.0.0");
  });
});
