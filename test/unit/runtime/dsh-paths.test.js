"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { join, resolve } = require("node:path");
const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const {
  resolveShellDshRoot,
  resolveDshBinary,
  resolveHome,
  resolveCurrentInstall,
  resolveUpgradeStaging,
  HOME_KINDS,
  HOME_ISOLATION_CONTRACT,
  clearActiveHome,
  configureActiveHome,
  isExternalActiveHome,
  isGlobalUserDshPath,
} = require("../../../src/runtime/dsh-paths");

describe("resolveShellDshRoot", () => {
  it("places shell ledgers and isolated homes under appData", () => {
    const appData = join(tmpdir(), "dsh-tray-appdata-test");
    const root = resolveShellDshRoot(appData);
    assert.equal(root, resolve(join(appData, "dsh")));
    assert.equal(isGlobalUserDshPath(root), false);
    assert.equal(isGlobalUserDshPath(join(appData, ".dsh")), true);
    assert.equal(isGlobalUserDshPath("C:/Users/me/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh"), true);
    assert.equal(isGlobalUserDshPath("C:/Users/me/.dsh"), true);
    assert.throws(() => resolveShellDshRoot(""), /appData/);
  });
});

describe("resolveHome", () => {
  it("exposes safe/active/staging/quarantine under the shell root", () => {
    const root = resolveShellDshRoot(join(tmpdir(), "dsh-tray-homes"));
    assert.deepEqual(HOME_KINDS, ["safe", "active", "staging", "quarantine"]);
    for (const kind of HOME_KINDS) {
      const home = resolveHome(root, kind);
      assert.equal(home, resolve(join(root, "homes", kind)));
      assert.equal(isGlobalUserDshPath(home), false);
    }
    assert.throws(() => resolveHome(root, "global"), /unknown/);
    assert.equal(HOME_ISOLATION_CONTRACT.envVar, "DSH_HOME");
    assert.equal(HOME_ISOLATION_CONTRACT.ledgerOwner, "src/install");
  });

  it("can reuse the original ~/.dsh as active while keeping safe homes isolated", () => {
    const root = resolveShellDshRoot(join(tmpdir(), "dsh-tray-user-home"));
    const userHome = resolve(join(tmpdir(), "user", ".dsh"));
    try {
      configureActiveHome(root, userHome);
      assert.equal(resolveHome(root, "active"), userHome);
      assert.equal(resolveHome(root, "safe"), resolve(join(root, "homes", "safe")));
      assert.equal(isExternalActiveHome(root), true);
    } finally {
      clearActiveHome(root);
    }
    assert.equal(resolveHome(root, "active"), resolve(join(root, "homes", "active")));
  });
});

describe("resolveDshBinary", () => {
  it("prefers an existing npm-layout bin under current/", () => {
    const root = join(tmpdir(), `dsh-paths-bin-${process.pid}-${Date.now()}`);
    const bin = join(root, "current", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    mkdirSync(join(bin, ".."), { recursive: true });
    writeFileSync(bin, "module.exports = {};\n");
    try {
      assert.equal(resolveDshBinary(root), bin);
      assert.equal(resolveCurrentInstall(root), resolve(join(root, "current")));
      assert.ok(resolveUpgradeStaging(root).startsWith(resolve(join(root, "tmp"))));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns the conventional path when nothing is installed yet", () => {
    const root = join(tmpdir(), "dsh-paths-missing");
    const predicted = resolveDshBinary(root);
    assert.match(predicted.replace(/\\/g, "/"), /current\/node_modules\/@deepseek-ai\/dsh\/lib\/bin\.js$/);
    assert.equal(resolveDshBinary(root, { mustExist: true }), undefined);
  });
});
