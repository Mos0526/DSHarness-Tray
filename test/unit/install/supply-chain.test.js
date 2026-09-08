"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { InstallGateError } = require("../../../src/install/errors");
const { computeNpmIntegrity } = require("../../../src/install/integrity");
const { assertInstallGate } = require("../../../src/install/supply-chain");
const { gateFixture } = require("./helpers");

describe("supply-chain gate", () => {
  it("accepts an exact version with matching npm integrity and repo identity", () => {
    const fixture = gateFixture();
    const gate = assertInstallGate(fixture);
    assert.equal(gate.ok, true);
    assert.equal(gate.version, "1.2.3");
    assert.equal(gate.integrity, fixture.integrity);
    assert.deepEqual(gate.supplyChain.changes, []);
  });

  it("treats catalog repo and npm name fields as the same repository identity", () => {
    const fixture = gateFixture({
      extraVersion: {
        repository: {
          type: "git",
          url: "https://github.com/omdsh-dev/DSH-better-sidebar",
        },
      },
    });
    fixture.repoIdentity = {
      host: "github.com",
      owner: "omdsh-dev",
      repo: "DSH-better-sidebar",
      id: null,
    };
    const gate = assertInstallGate(fixture);
    assert.equal(gate.ok, true);
    assert.deepEqual(gate.supplyChain.changes, []);
  });

  it("accepts the same monorepo while recording a package-directory correction", () => {
    const fixture = gateFixture({
      extraVersion: {
        repository: {
          type: "git",
          url: "https://github.com/acme/dsh-demo-plugin",
          directory: "packages/plugin",
        },
      },
    });
    fixture.repoIdentity = {
      host: "github.com",
      owner: "acme",
      repo: "dsh-demo-plugin",
      directory: null,
      id: null,
    };
    const gate = assertInstallGate(fixture);
    assert.equal(gate.ok, true);
    assert.ok(gate.supplyChain.changes.some((change) => change.type === "repository-directory"));
  });

  it("rejects an integrity mismatch", () => {
    const fixture = gateFixture();
    fixture.requested.integrity = computeNpmIntegrity(Buffer.from("other-bytes"));
    assert.throws(
      () => assertInstallGate(fixture),
      (error) => error instanceof InstallGateError
        && /integrity/.test(error.message)
        && error.reasons.some((reason) => /integrity/.test(reason)),
    );
  });

  it("rejects an npm package that claims a different repository", () => {
    const fixture = gateFixture({
      extraVersion: {
        repository: {
          type: "git",
          url: "https://github.com/attacker/dsh-demo-plugin",
        },
      },
    });
    fixture.repoIdentity = {
      host: "github.com",
      owner: "acme",
      repo: "dsh-demo-plugin",
      id: null,
    };
    assert.throws(
      () => assertInstallGate(fixture),
      /repository.*does not match/i,
    );
  });

  it("rejects lifecycle scripts unless installation explicitly ignores them", () => {
    const blocked = gateFixture({
      extraVersion: { scripts: { prepare: "node build.js" } },
    });
    assert.throws(() => assertInstallGate(blocked), /lifecycle scripts/);

    const ignored = gateFixture({
      extraVersion: { scripts: { prepare: "node build.js" } },
      extraRequested: { ignoreScripts: true },
    });
    const gate = assertInstallGate(ignored);
    assert.ok(gate.supplyChain.changes.some((change) => (
      change.type === "lifecycle-scripts-ignored"
      && change.scripts.includes("prepare")
    )));
  });

  it("rejects tags, marketplace plugins, and same-version integrity swaps", () => {
    assert.throws(
      () => assertInstallGate({
        requested: { name: "x", version: "latest", source: "npm" },
        packument: { name: "x", versions: {} },
        repoIdentity: { id: "1", owner: "a", name: "x" },
      }),
      /exact version/,
    );

    const market = gateFixture({ name: "dsh-plugin-hub" });
    assert.throws(() => assertInstallGate(market), /marketplace/);

    const fixture = gateFixture();
    const previous = {
      pluginId: "dsh-demo-plugin",
      exactVersion: "1.2.3",
      integrity: computeNpmIntegrity(Buffer.from("old-bytes")),
      repoIdentity: fixture.repoIdentity,
      maintainers: [{ name: "old-owner" }],
    };
    assert.throws(
      () => assertInstallGate({ ...fixture, previousReceipt: previous }),
      (error) => error instanceof InstallGateError
        && error.changes.some((change) => change.type === "integrity"),
    );
  });
});
