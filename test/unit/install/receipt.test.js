"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const { computeNpmIntegrity } = require("../../../src/install/integrity");
const { readReceipt, verifyReceiptIntegrity, writeReceipt } = require("../../../src/install/receipt");
const { tempRoot } = require("./helpers");

describe("receipt", () => {
  it("round-trips the required fields and verifies npm integrity", () => {
    const dir = tempRoot("dsh-receipt-");
    const artifact = Buffer.from("demo-tarball");
    const integrity = computeNpmIntegrity(artifact);
    const written = writeReceipt(dir, {
      pluginId: "dsh-demo-plugin",
      exactVersion: "1.2.3",
      integrity,
      repoIdentity: { host: "github.com", owner: "acme", name: "dsh-demo-plugin", id: "4242" },
      source: "npm",
      dshVersion: "1.4.0",
      hostCompat: { ok: true, range: "^1.0.0" },
      rendererCompat: { ok: true, range: "^1.0.0" },
      installedAt: "2026-08-24T00:00:00.000Z",
      walId: "wal_test",
    });
    const read = readReceipt(dir, "dsh-demo-plugin");
    assert.equal(read.exactVersion, "1.2.3");
    assert.equal(read.walId, "wal_test");
    assert.equal(read.integrity, integrity);
    assert.equal(written.path, join(dir, `${encodeURIComponent("dsh-demo-plugin")}.json`));
    assert.equal(verifyReceiptIntegrity(read, artifact).ok, true);
    assert.equal(verifyReceiptIntegrity(read, Buffer.from("tampered")).ok, false);
    assert.equal(verifyReceiptIntegrity(read, { integrity: "sha512-not-the-same" }).ok, false);
  });
});
