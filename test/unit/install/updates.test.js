"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { detectUpdateAvailable, matchCatalogPlugin } = require("../../../src/install/updates");

describe("detectUpdateAvailable", () => {
  it("is false when catalog has no newer pin", () => {
    const hint = detectUpdateAvailable({
      pluginId: "dsh-demo-plugin",
      installedVersion: "1.2.3",
      catalogPlugins: [{ npmName: "dsh-demo-plugin", supplyChain: { exactVersion: "1.2.3" } }],
    });
    assert.equal(hint.updateAvailable, false);
    assert.equal(hint.availableVersion, null);
  });

  it("flags a newer catalog version for an installed plugin", () => {
    const hint = detectUpdateAvailable({
      pluginId: "dsh-demo-plugin",
      installedVersion: "1.0.0",
      catalogPlugins: [{
        stableId: "demo",
        npmName: "dsh-demo-plugin",
        supplyChain: { exactVersion: "1.4.0" },
      }],
    });
    assert.equal(hint.updateAvailable, true);
    assert.equal(hint.availableVersion, "1.4.0");
  });

  it("uses resolveInstallPin output when catalog exactVersion is missing", () => {
    const hint = detectUpdateAvailable({
      pluginId: "dsh-demo-plugin",
      installedVersion: "1.0.0",
      catalogPlugins: [{ npmName: "dsh-demo-plugin" }],
      pin: { exactVersion: "2.0.0" },
    });
    assert.equal(hint.updateAvailable, true);
    assert.equal(hint.availableVersion, "2.0.0");
  });

  it("picks a compatible candidate after quarantine via findCompatibleUpdate", () => {
    const hint = detectUpdateAvailable({
      pluginId: "dsh-demo-plugin",
      installedVersion: "1.0.0",
      dshInfo: { version: "1.4.0", host: "1.4.0", renderer: "1.4.0" },
      catalogPlugins: [{
        npmName: "dsh-demo-plugin",
        availableVersions: [
          { version: "2.0.0", manifest: { name: "dsh-demo-plugin", dsh: { compat: { host: "^9.0.0" } } } },
          { version: "2.1.0", manifest: { name: "dsh-demo-plugin", dsh: { compat: { host: "^1.0.0" } } } },
        ],
      }],
    });
    assert.equal(hint.updateAvailable, true);
    assert.equal(hint.availableVersion, "2.1.0");
  });

  it("matches catalog rows by npmName or stableId", () => {
    const row = { stableId: "owner/repo", npmName: "dsh-demo-plugin" };
    assert.equal(matchCatalogPlugin("dsh-demo-plugin", [row]), row);
    assert.equal(matchCatalogPlugin("owner/repo", [row]), row);
    assert.equal(matchCatalogPlugin("missing", [row]), null);
  });
});
