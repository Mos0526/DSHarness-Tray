"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { checkCompat, findCompatibleUpdate } = require("../../../src/install/compat");
const { compatManifest } = require("./helpers");

describe("compat", () => {
  it("classifies host failure separately from renderer failure", () => {
    const dshInfo = { version: "1.4.0", host: "1.4.0", renderer: "1.4.0" };
    const hostFail = checkCompat({
      pluginManifest: compatManifest("plug", "1.0.0", { host: "^3.0.0", renderer: "^1.0.0" }),
      dshInfo,
    });
    assert.equal(hostFail.ok, false);
    assert.equal(hostFail.host.ok, false);
    assert.equal(hostFail.renderer.ok, true);
    assert.ok(hostFail.reasons.some((reason) => /host/.test(reason)));

    const rendererFail = checkCompat({
      pluginManifest: compatManifest("plug", "1.0.0", { host: "^1.0.0", renderer: "^3.0.0" }),
      dshInfo,
    });
    assert.equal(rendererFail.ok, false);
    assert.equal(rendererFail.host.ok, true);
    assert.equal(rendererFail.renderer.ok, false);
    assert.ok(rendererFail.reasons.some((reason) => /renderer/.test(reason)));
  });

  it("treats @deepseek-ai/dsh-settings peers as a host range fallback", () => {
    const compat = checkCompat({
      pluginManifest: {
        name: "dsh-better-sidebar",
        peerDependencies: {
          "@deepseek-ai/dsh-settings": "^0.1.2-alpha.2",
        },
      },
      dshInfo: { version: "0.1.2-alpha.2", host: "0.1.2-alpha.2", renderer: "0.1.2-alpha.2" },
    });
    assert.equal(compat.ok, true);
    assert.equal(compat.fields.hostRange, "^0.1.2-alpha.2");

    const oldHost = checkCompat({
      pluginManifest: {
        name: "dsh-better-sidebar",
        peerDependencies: {
          "@deepseek-ai/dsh-settings": "^0.1.2-alpha.2",
        },
      },
      dshInfo: { version: "0.1.1-rc.2", host: "0.1.1-rc.2", renderer: "0.1.1-rc.2" },
    });
    assert.equal(oldHost.ok, false);
  });

  it("reads adapter-style peerDependency ranges when dsh.compat is absent", () => {
    const compat = checkCompat({
      pluginManifest: {
        name: "legacy-plug",
        peerDependencies: {
          "@deepseek-ai/dsh": "^2.0.0",
          "@deepseek-ai/dsh-web-app": "^2.0.0",
        },
        dsh: { bundle: { patch: "./cordis.patch.yml" }, client: { platform: "web" } },
        exports: { "./client": "./client.js" },
      },
      dshInfo: { version: "1.0.0", host: "1.0.0", renderer: "1.0.0" },
    });
    assert.equal(compat.ok, false);
    assert.equal(compat.host.ok, false);
    assert.equal(compat.renderer.ok, false);
    assert.equal(compat.fields.hostRange, "^2.0.0");
    assert.equal(compat.fields.rendererRange, "^2.0.0");
  });

  it("finds a compatible newer version after quarantine", () => {
    const dshInfo = { version: "2.1.0", host: "2.1.0", renderer: "2.1.0" };
    const found = findCompatibleUpdate({
      pluginId: "dsh-demo-plugin",
      availableVersions: [
        { version: "1.0.0", manifest: compatManifest("dsh-demo-plugin", "1.0.0", { host: "^1.0.0", renderer: "^1.0.0" }) },
        { version: "2.0.0", manifest: compatManifest("dsh-demo-plugin", "2.0.0", { host: "^2.0.0", renderer: "^2.0.0" }) },
        { version: "1.5.0", manifest: compatManifest("dsh-demo-plugin", "1.5.0", { host: "^1.0.0", renderer: "^1.0.0" }) },
      ],
      dshInfo,
    });
    assert.equal(found.version, "2.0.0");
    assert.equal(found.compat.ok, true);

    const none = findCompatibleUpdate({
      pluginId: "dsh-demo-plugin",
      availableVersions: [
        { version: "1.0.0", manifest: compatManifest("dsh-demo-plugin", "1.0.0", { host: "^1.0.0" }) },
      ],
      dshInfo,
    });
    assert.equal(none, null);
  });
});
