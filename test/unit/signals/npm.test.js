"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createCachedFetcher } = require("../../../src/catalog/fetch");
const { createNpmSignals } = require("../../../src/signals/npm");
const { clock, mockFetch, mockResponse, removeDir, tempCacheDir } = require("../catalog/helpers");

const fixtures = join(__dirname, "fixtures");
const packument = readFileSync(join(fixtures, "npm-packument.json"), "utf8");
const deprecated = readFileSync(join(fixtures, "npm-deprecated-packument.json"), "utf8");
const downloads = readFileSync(join(fixtures, "npm-downloads.json"), "utf8");
const channelPackument = readFileSync(join(fixtures, "npm-channel-packument.json"), "utf8");

function client(fetchFn, now) {
  const cacheDir = tempCacheDir();
  const fetcher = createCachedFetcher({ cacheDir, fetchFn, now, ttlMs: 10 });
  return { cacheDir, npm: createNpmSignals({ fetcher }) };
}

test("fetchNpmSignals reads downloads, latest version, integrity and repo identity", async () => {
  const { cacheDir, npm } = client(mockFetch((url) => {
    if (url.includes("downloads")) return mockResponse({ status: 200, body: downloads });
    return mockResponse({ status: 200, body: packument });
  }));
  const signals = await npm.fetchNpmSignals("dsh-spotlight");
  assert.equal(signals.downloads, 313);
  assert.equal(signals.latestVersion, "1.2.3");
  assert.equal(signals.exactVersion, "1.2.3");
  assert.equal(signals.lastVersionAt, "2026-08-14T10:41:00.000Z");
  assert.equal(signals.deprecated, false);
  assert.match(signals.integrity, /^sha512-/);
  assert.equal(signals.repoIdentity.owner, "0xsline");
  const pin = await npm.resolveInstallPin({ npmName: "dsh-spotlight" });
  assert.equal(pin.exactVersion, "1.2.3");
  assert.equal(pin.integrity, signals.integrity);
  assert.equal(pin.manifest.name, "dsh-spotlight");
  assert.match(pin.tarball, /\.tgz$/);
  removeDir(cacheDir);
});

test("deprecated latest version is flagged", async () => {
  const { cacheDir, npm } = client(mockFetch((url) => {
    if (url.includes("downloads")) return mockResponse({ status: 200, body: "{\"downloads\":1}" });
    return mockResponse({ status: 200, body: deprecated });
  }));
  const signals = await npm.fetchNpmSignals("old-plugin");
  assert.equal(signals.deprecated, true);
  assert.match(signals.deprecatedMessage, /no longer maintained/);
  removeDir(cacheDir);
});

test("missing packument does not throw and can reuse cache after outage", async () => {
  const time = clock();
  let live = true;
  const { cacheDir, npm } = client(mockFetch((url) => {
    if (!live) throw new Error("ECONNRESET");
    if (url.includes("downloads")) return mockResponse({ status: 200, body: downloads });
    return mockResponse({ status: 200, body: packument });
  }), time.now);
  const first = await npm.fetchNpmSignals("dsh-spotlight");
  assert.equal(first.exactVersion, "1.2.3");
  live = false;
  time.advance(20);
  const second = await npm.fetchNpmSignals("dsh-spotlight");
  assert.equal(second.exactVersion, "1.2.3");
  assert.equal(second.stale, true);
  const missing = await npm.fetchNpmSignals("definitely-not-a-real-pkg-zzzz");
  assert.equal(missing.exactVersion, null);
  assert.equal(missing.stale, true);
  removeDir(cacheDir);
});

test("alpha DSH hosts pin the npm alpha tag instead of latest", async () => {
  const { cacheDir, npm } = client(mockFetch((url) => {
    if (url.includes("downloads")) return mockResponse({ status: 200, body: "{\"downloads\":1}" });
    return mockResponse({ status: 200, body: channelPackument });
  }));
  const latest = await npm.fetchNpmSignals("dsh-better-sidebar");
  assert.equal(latest.exactVersion, "0.17.1");
  assert.equal(latest.latestVersion, "0.17.1");

  const alphaHost = await npm.resolveInstallPin(
    { npmName: "dsh-better-sidebar" },
    { force: true, hostVersion: "0.1.2-alpha.2" },
  );
  assert.equal(alphaHost.exactVersion, "0.18.0-alpha.0");
  assert.equal(alphaHost.latestVersion, "0.17.1");
  assert.equal(alphaHost.installTag, "alpha");
  assert.match(alphaHost.integrity, /alphaChannelIntegrity/);

  const olderAlpha = await npm.resolveInstallPin(
    { npmName: "dsh-better-sidebar" },
    { force: true, hostVersion: "0.1.2-alpha.1" },
  );
  assert.equal(olderAlpha.exactVersion, "0.17.1");

  const stable = await npm.resolveInstallPin(
    { npmName: "dsh-better-sidebar" },
    { force: true, hostVersion: "0.1.1-rc.2" },
  );
  assert.equal(stable.exactVersion, "0.17.1");
  removeDir(cacheDir);
});

test("downloads API outage does not make a fresh install pin stale", async () => {
  const { cacheDir, npm } = client(mockFetch((url) => {
    if (url.includes("downloads")) throw new Error("downloads API offline");
    return mockResponse({ status: 200, body: packument });
  }));
  const pin = await npm.resolveInstallPin({ npmName: "dsh-spotlight" }, { force: true });
  assert.equal(pin.exactVersion, "1.2.3");
  assert.equal(pin.stale, false);
  assert.ok(pin.manifest);
  removeDir(cacheDir);
});
