"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createCachedFetcher } = require("../../../src/catalog/fetch");
const { createGithubSignals } = require("../../../src/signals/github");
const { clock, mockFetch, mockResponse, removeDir, tempCacheDir } = require("../catalog/helpers");

const fixtures = join(__dirname, "fixtures");
const repoJson = readFileSync(join(fixtures, "github-repo.json"), "utf8");
const commitsJson = readFileSync(join(fixtures, "github-commits.json"), "utf8");
const archivedJson = readFileSync(join(fixtures, "github-archived.json"), "utf8");

function client(fetchFn, now) {
  const cacheDir = tempCacheDir();
  const fetcher = createCachedFetcher({ cacheDir, fetchFn, now, ttlMs: 10 });
  return { cacheDir, github: createGithubSignals({ fetcher }) };
}

test("fetchRepoSignals maps repository signals without a second commits request", async () => {
  const urls = [];
  const { cacheDir, github } = client(mockFetch((url) => {
    urls.push(url);
    if (url.endsWith("/commits?per_page=1")) return mockResponse({ status: 200, body: commitsJson });
    return mockResponse({ status: 200, body: repoJson });
  }));
  const signals = await github.fetchRepoSignals("https://github.com/0xsline/dsh-spotlight");
  assert.equal(signals.stars, 10);
  assert.equal(signals.archived, false);
  assert.equal(signals.pushedAt, "2026-08-14T10:40:39Z");
  assert.equal(signals.lastCommitAt, "2026-08-14T10:40:39Z");
  assert.equal(signals.repoId, 1333136466);
  assert.equal(signals.repoIdentity.owner, "0xsline");
  assert.equal(urls.some((url) => url.includes("/commits")), false);
  removeDir(cacheDir);
});

test("archived repo is reported without a synthetic score", async () => {
  const { cacheDir, github } = client(mockFetch((url) => {
    if (url.includes("/commits")) return mockResponse({ status: 200, body: "[]" });
    return mockResponse({ status: 200, body: archivedJson });
  }));
  const signals = await github.fetchRepoSignals({ owner: "example", repo: "old-plugin" });
  assert.equal(signals.archived, true);
  assert.equal(signals.stars, 3);
  assert.equal("safetyScore" in signals, false);
  removeDir(cacheDir);
});

test("falls back to ungh.cc when GitHub REST has no star count", async () => {
  const { cacheDir, github } = client(mockFetch((url) => {
    if (url.includes("ungh.cc")) {
      return mockResponse({
        status: 200,
        body: JSON.stringify({ repo: { stars: 42, pushedAt: "2026-08-01T00:00:00Z" } }),
      });
    }
    if (url.includes("/commits")) return mockResponse({ status: 200, body: "[]" });
    return mockResponse({ status: 403, body: "rate limit" });
  }));
  const signals = await github.fetchRepoSignals({ owner: "0xsline", repo: "dsh-spotlight" });
  assert.equal(signals.stars, 42);
  removeDir(cacheDir);
});

test("rate-limited GitHub calls serve cache and stay stale", async () => {
  const time = clock();
  let live = true;
  const { cacheDir, github } = client(mockFetch((url) => {
    if (url.includes("ungh.cc")) return mockResponse({ status: 503, body: "" });
    if (live) return mockResponse({ status: 200, body: repoJson, headers: { etag: "\"g1\"" } });
    return mockResponse({ status: 403, body: "rate limit", headers: { "retry-after": "20" } });
  }), time.now);
  const first = await github.fetchRepoSignals({ owner: "0xsline", repo: "dsh-spotlight" });
  assert.equal(first.stars, 10);
  live = false;
  time.advance(20);
  const second = await github.fetchRepoSignals({ owner: "0xsline", repo: "dsh-spotlight" });
  assert.equal(second.stars, 10);
  assert.equal(second.stale, true);
  removeDir(cacheDir);
});

test("fresh mirror data replaces a stale rate-limited GitHub cache", async () => {
  const time = clock();
  let live = true;
  const { cacheDir, github } = client(mockFetch((url) => {
    if (url.includes("ungh.cc")) {
      return mockResponse({
        status: 200,
        body: JSON.stringify({ repo: { stars: 42, pushedAt: "2026-08-30T00:00:00Z" } }),
      });
    }
    if (live) return mockResponse({ status: 200, body: repoJson });
    return mockResponse({ status: 403, body: "rate limit" });
  }), time.now);
  await github.fetchRepoSignals({ owner: "0xsline", repo: "dsh-spotlight" });
  live = false;
  time.advance(20);
  const recovered = await github.fetchRepoSignals({ owner: "0xsline", repo: "dsh-spotlight" });
  assert.equal(recovered.stars, 42);
  assert.equal(recovered.lastCommitAt, "2026-08-30T00:00:00Z");
  assert.equal(recovered.stale, false);
  removeDir(cacheDir);
});
