"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../../../src/runtime");

describe("src/runtime aggregate exports", () => {
  it("can be required and exposes the integration surface", () => {
    assert.equal(typeof runtime.createSupervisor, "function");
    assert.equal(typeof runtime.resolveShellDshRoot, "function");
    assert.equal(typeof runtime.resolveDshBinary, "function");
    assert.equal(typeof runtime.resolveHome, "function");
    assert.equal(typeof runtime.protocol.buildArgv, "function");
    assert.equal(typeof runtime.upgrade.upgradeDsh, "function");
    assert.equal(typeof runtime.upgrade.readUpgradeState, "function");
    assert.equal(typeof runtime.upgrade.markSafeBootRequired, "function");
    assert.equal(typeof runtime.versions.pickDshCandidates, "function");
    assert.equal(typeof runtime.globalDsh.resolveDshEntry, "function");
    assert.equal(typeof runtime.pickDshCandidates, "function");
    assert.equal(typeof runtime.redactDiagnosticText, "function");
    assert.equal(typeof runtime.redact.redactDiagnosticText, "function");
    assert.equal(typeof runtime.terminateChildTree, "function");
    assert.equal(typeof runtime.terminateProcessTree, "function");
    assert.equal(typeof runtime.decodeProcessOutput, "function");
  });
});
