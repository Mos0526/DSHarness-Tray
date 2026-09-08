"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { ensureHomes, listInstalled, pluginStorePath, resolveHome, walDir } = require("../../../src/homes");
const { findCompatibleUpdate } = require("../../../src/install/compat");
const { InstallCrashError, InstallGateError } = require("../../../src/install/errors");
const {
  defaultUnpackFn,
  getPluginLifecycle,
  installPlugin,
  uninstallPlugin,
} = require("../../../src/install/pipeline");
const { createWal } = require("../../../src/install/wal");
const { compatManifest, gateFixture, tempRoot } = require("./helpers");

function installArgs(root, extra = {}) {
  const fixture = gateFixture({
    name: extra.name || "dsh-demo-plugin",
    version: extra.version || "1.2.3",
    extraVersion: extra.extraVersion,
  });
  return {
    root,
    pluginId: fixture.requested.name,
    requested: fixture.requested,
    packument: fixture.packument,
    repoIdentity: fixture.repoIdentity,
    pluginManifest: extra.pluginManifest || fixture.pluginManifest,
    dshInfo: extra.dshInfo || fixture.dshInfo,
    files: extra.files,
    verifyFn: extra.verifyFn,
    unpackFn: extra.unpackFn,
    npmFetchFn: extra.npmFetchFn,
    crashAfter: extra.crashAfter,
    previousReceipt: extra.previousReceipt,
  };
}

describe("install pipeline", () => {
  it("promotes a compatible plugin to active", async () => {
    const root = tempRoot("dsh-pipe-ok-");
    ensureHomes(root);
    const result = await installPlugin(installArgs(root));
    assert.equal(result.ok, true);
    assert.equal(result.state, "active");
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).state, "active");
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).shellVerification.status, "passed");
    assert.equal(listInstalled("active", root).length, 1);
    assert.equal(listInstalled("staging", root).length, 0);
    assert.equal(listInstalled("quarantine", root).length, 0);
  });

  it("quarantines an incompatible upgrade and later detects a compatible version", async () => {
    const root = tempRoot("dsh-pipe-q-");
    ensureHomes(root);
    const first = await installPlugin(installArgs(root, { version: "1.0.0" }));
    assert.equal(first.state, "active");

    const bad = await installPlugin(installArgs(root, {
      version: "2.0.0",
      pluginManifest: compatManifest("dsh-demo-plugin", "2.0.0", { host: "^9.0.0", renderer: "^1.0.0" }),
    }));
    assert.equal(bad.ok, false);
    assert.equal(bad.state, "quarantine");
    assert.equal(bad.compat.host.ok, false);
    assert.equal(listInstalled("quarantine", root)[0].pluginId, "dsh-demo-plugin");
    assert.equal(listInstalled("quarantine", root)[0].exactVersion, "2.0.0");
    assert.equal(
      listInstalled("active", root).some((item) => item.pluginId === "dsh-demo-plugin" && item.exactVersion === "2.0.0"),
      false,
    );
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).latestAttempt, "quarantine");
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).shellVerification.status, "failed");

    const found = findCompatibleUpdate({
      pluginId: "dsh-demo-plugin",
      availableVersions: [
        { version: "2.0.0", manifest: compatManifest("dsh-demo-plugin", "2.0.0", { host: "^9.0.0", renderer: "^1.0.0" }) },
        { version: "2.1.0", manifest: compatManifest("dsh-demo-plugin", "2.1.0", { host: "^1.0.0", renderer: "^1.0.0" }) },
      ],
      dshInfo: { version: "1.4.0", host: "1.4.0", renderer: "1.4.0" },
    });
    assert.equal(found.version, "2.1.0");
  });

  it("rolls back a mid-install crash via recover()", async () => {
    const root = tempRoot("dsh-pipe-crash-");
    ensureHomes(root);
    await assert.rejects(
      () => installPlugin(installArgs(root, { crashAfter: "unpack" })),
      (error) => error instanceof InstallCrashError && error.step === "unpack",
    );
    const leftover = pluginStorePath(resolveHome(root, "staging"), "dsh-demo-plugin");
    assert.ok(existsSync(leftover));
    const recovered = createWal(walDir(root)).recover();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, "aborted");
    assert.equal(existsSync(leftover), false);
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).state, "uninstalled");
  });

  it("rejects integrity mismatch before writing homes", async () => {
    const root = tempRoot("dsh-pipe-int-");
    ensureHomes(root);
    const args = installArgs(root);
    args.requested = { ...args.requested, integrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" };
    await assert.rejects(() => installPlugin(args), (error) => error instanceof InstallGateError);
    assert.equal(listInstalled("active", root).length, 0);
    assert.equal(listInstalled("staging", root).length, 0);
    assert.equal(listInstalled("quarantine", root).length, 0);
  });

  it("classifies host vs renderer runtime failures into quarantine reasons", async () => {
    const root = tempRoot("dsh-pipe-axis-");
    ensureHomes(root);
    const host = await installPlugin(installArgs(root, {
      name: "host-fail-plugin",
      verifyFn: async () => ({
        ok: false,
        host: { ok: false, reason: "host crashed during staging boot" },
        renderer: { ok: true },
        reasons: ["host crashed during staging boot"],
      }),
    }));
    assert.equal(host.state, "quarantine");
    assert.equal(host.compat.host.ok, false);
    assert.equal(host.compat.renderer.ok, true);

    const renderer = await installPlugin(installArgs(root, {
      name: "renderer-fail-plugin",
      verifyFn: async () => ({
        ok: false,
        host: { ok: true },
        renderer: { ok: false, reason: "renderer failed to settle" },
        reasons: ["renderer failed to settle"],
      }),
    }));
    assert.equal(renderer.state, "quarantine");
    assert.equal(renderer.compat.host.ok, true);
    assert.equal(renderer.compat.renderer.ok, false);
  });

  it("uninstalls a quarantined plugin", async () => {
    const root = tempRoot("dsh-pipe-un-");
    ensureHomes(root);
    await installPlugin(installArgs(root, {
      pluginManifest: compatManifest("dsh-demo-plugin", "1.2.3", { host: "^9.0.0" }),
    }));
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).state, "quarantine");
    const store = pluginStorePath(resolveHome(root, "quarantine"), "dsh-demo-plugin");
    assert.ok(existsSync(store));
    const result = await uninstallPlugin({ root, pluginId: "dsh-demo-plugin" });
    assert.equal(result.state, "uninstalled");
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).state, "uninstalled");
    assert.equal(existsSync(store), false);
    assert.equal(listInstalled("quarantine", root).length, 0);
  });

  it("accepts injected unpackFn / npmFetchFn", async () => {
    const root = tempRoot("dsh-pipe-inject-");
    ensureHomes(root);
    const fixture = gateFixture({ name: "inject-plug", version: "3.0.0" });
    let fetched = false;
    let unpacked = false;
    const result = await installPlugin({
      root,
      requested: { name: "inject-plug", version: "3.0.0", source: "npm" },
      repoIdentity: fixture.repoIdentity,
      pluginManifest: fixture.pluginManifest,
      dshInfo: fixture.dshInfo,
      npmFetchFn: async () => {
        fetched = true;
        return fixture.packument;
      },
      unpackFn: async ({ destDir }) => {
        unpacked = true;
        const { writeFileSync } = require("node:fs");
        writeFileSync(join(destDir, "package.json"), JSON.stringify(fixture.pluginManifest));
      },
    });
    assert.equal(fetched, true);
    assert.equal(unpacked, true);
    assert.equal(result.state, "active");
  });

  it("rejects archive entries that escape the plugin directory", async () => {
    const root = tempRoot("dsh-unpack-containment-");
    const dest = join(root, "package");
    const outside = join(root, "..", "outside.txt");
    await assert.rejects(
      () => defaultUnpackFn({
        destDir: dest,
        pluginManifest: { name: "demo", version: "1.0.0" },
        files: { "../../outside.txt": "owned" },
      }),
      /escapes plugin directory/,
    );
    assert.equal(existsSync(outside), false);
  });

  it("keeps ledger updateAvailable false unless catalog overlay is passed", async () => {
    const root = tempRoot("dsh-pipe-update-");
    ensureHomes(root);
    await installPlugin(installArgs(root, { version: "1.0.0" }));
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).updateAvailable, false);
    const overlaid = getPluginLifecycle("dsh-demo-plugin", root, {
      catalogPlugins: [{
        npmName: "dsh-demo-plugin",
        supplyChain: { exactVersion: "1.4.0" },
      }],
    });
    assert.equal(overlaid.updateAvailable, true);
    assert.equal(overlaid.availableVersion, "1.4.0");
    assert.equal(getPluginLifecycle("dsh-demo-plugin", root).updateAvailable, false);
  });
});
