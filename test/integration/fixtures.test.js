"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const plugins = require("../fixtures/plugins");
const { BIN, spawnFakeDsh, waitForReady, waitForExit, stopFakeDsh, parseReadyLine } = require("../fixtures/fake-dsh");

function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

describe("plugin fixtures", () => {
  it("covers compatible, host-incompatible, renderer-incompatible, and a compat update", () => {
    const compatible = readPkg(plugins.compatible);
    const host = readPkg(plugins.hostIncompatible);
    const renderer = readPkg(plugins.rendererIncompatible);
    const old = readPkg(plugins.outdated);
    const next = readPkg(plugins.outdatedUpdate);
    assert.equal(compatible.dshFixture.compat.host, true);
    assert.equal(compatible.dshFixture.compat.renderer, true);
    assert.equal(host.dshFixture.compat.host, false);
    assert.equal(renderer.dshFixture.compat.renderer, false);
    assert.equal(old.version, "1.0.0");
    assert.equal(next.version, "2.0.0");
    assert.equal(old.dshFixture.update.version, "2.0.0");
    assert.equal(next.dshFixture.compat.host, true);
    assert.ok(existsSync(join(plugins.compatible, "index.js")));
  });
});

describe("fake DSH process", () => {
  const children = [];
  afterEach(async () => {
    await Promise.all(children.splice(0).map((child) => stopFakeDsh(child)));
  });

  it("speaks the dsh web stdout protocol on ok", async () => {
    const child = spawnFakeDsh({ mode: "ok" });
    children.push(child);
    const url = await waitForReady(child);
    assert.ok(url.port);
    assert.equal(url.hostname, "127.0.0.1");
    const res = await fetch(url);
    assert.equal(res.status, 200);
  });

  it("simulates a host crash before ready", async () => {
    const child = spawnFakeDsh({ mode: "crash-host" });
    children.push(child);
    await assert.rejects(() => waitForReady(child, 3000), /就绪前退出|code 1/);
  });

  it("simulates renderer failure after the ready line", async () => {
    const child = spawnFakeDsh({ mode: "fail-renderer" });
    children.push(child);
    const url = await waitForReady(child);
    assert.ok(url.port);
    const exited = await waitForExit(child);
    assert.equal(exited.code, 2);
  });

  it("derives crash-host from a host-incompatible plugin fixture", async () => {
    const child = spawnFakeDsh({ plugin: plugins.hostIncompatible, env: { FAKE_DSH_MODE: "" } });
    children.push(child);
    const exited = await waitForExit(child);
    assert.equal(exited.code, 1);
  });

  it("parses the same ready prefix as the shell", () => {
    const url = parseReadyLine("dsh web: http://127.0.0.1:34567");
    assert.equal(url.href, "http://127.0.0.1:34567/");
    assert.equal(existsSync(BIN), true);
  });
});
