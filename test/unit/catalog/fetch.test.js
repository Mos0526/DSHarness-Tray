"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCachedFetcher, DEFAULT_TTL_MS } = require("../../../src/catalog/fetch");
const { clock, mockFetch, mockResponse, removeDir, tempCacheDir } = require("./helpers");

test("ETag 304 reuses the cached body and refreshes lastCheckedAt", async () => {
  const dir = tempCacheDir();
  const time = clock();
  let hits = 0;
  const fetcher = createCachedFetcher({
    cacheDir: dir,
    now: time.now,
    ttlMs: 1000,
    fetchFn: mockFetch((url, init) => {
      hits += 1;
      if (hits === 1) {
        return mockResponse({ status: 200, body: "hello", headers: { etag: "\"v1\"" } });
      }
      assert.equal(init.headers["If-None-Match"], "\"v1\"");
      return mockResponse({ status: 304, body: "", headers: { etag: "\"v1\"" } });
    }),
  });
  const first = await fetcher.get("https://example.test/readme");
  assert.equal(first.body, "hello");
  assert.equal(first.stale, false);
  time.advance(2000);
  const second = await fetcher.get("https://example.test/readme");
  assert.equal(second.status, 304);
  assert.equal(second.body, "hello");
  assert.equal(second.fromCache, true);
  assert.equal(second.stale, false);
  assert.notEqual(second.lastCheckedAt, first.lastCheckedAt);
  removeDir(dir);
});

test("offline / thrown fetch returns cache with stale=true and does not throw", async () => {
  const dir = tempCacheDir();
  const time = clock();
  let mode = "ok";
  const fetcher = createCachedFetcher({
    cacheDir: dir,
    now: time.now,
    ttlMs: 1000,
    expireMs: 60_000,
    fetchFn: mockFetch(() => {
      if (mode === "ok") return mockResponse({ status: 200, body: "cached-readme" });
      throw new Error("ENOTFOUND");
    }),
  });
  await fetcher.get("https://example.test/a");
  time.advance(2000);
  mode = "down";
  const stale = await fetcher.get("https://example.test/a");
  assert.equal(stale.body, "cached-readme");
  assert.equal(stale.stale, true);
  assert.equal(stale.expired, false);
  assert.match(stale.error, /ENOTFOUND/);
  removeDir(dir);
});

test("429 rate limit backs off and later calls skip the network", async () => {
  const dir = tempCacheDir();
  const time = clock();
  let hits = 0;
  const fetcher = createCachedFetcher({
    cacheDir: dir,
    now: time.now,
    ttlMs: 10,
    fetchFn: mockFetch(() => {
      hits += 1;
      if (hits === 1) return mockResponse({ status: 200, body: "v1", headers: { etag: "\"a\"" } });
      return mockResponse({ status: 429, body: "rate", headers: { "retry-after": "30" } });
    }),
  });
  await fetcher.get("https://api.github.com/repos/x/y");
  time.advance(20);
  const limited = await fetcher.get("https://api.github.com/repos/x/y");
  assert.equal(limited.stale, true);
  assert.equal(limited.body, "v1");
  const before = hits;
  const immediate = await fetcher.get("https://api.github.com/repos/x/y");
  assert.equal(hits, before);
  assert.equal(immediate.stale, true);
  assert.match(immediate.error, /backoff|429/);
  time.advance(1000);
  const skipped = await fetcher.get("https://api.github.com/repos/x/y");
  assert.equal(hits, before);
  assert.equal(skipped.stale, true);
  assert.match(skipped.error, /backoff|429/);
  removeDir(dir);
});

test("first failed fetch is stale but not expired", async () => {
  const dir = tempCacheDir();
  const fetcher = createCachedFetcher({
    cacheDir: dir,
    fetchFn: mockFetch(() => {
      throw new Error("offline");
    }),
  });
  const empty = await fetcher.get("https://example.test/missing");
  assert.equal(empty.expired, false);
  assert.equal(empty.stale, true);
  assert.equal(empty.body, "");
  assert.match(empty.error, /offline/);
  assert.ok(DEFAULT_TTL_MS > 0);
  removeDir(dir);
});

test("expired is true when lastSuccessAt is older than expireMs", async () => {
  const dir = tempCacheDir();
  const time = clock();
  let live = true;
  const fetcher = createCachedFetcher({
    cacheDir: dir,
    now: time.now,
    ttlMs: 10,
    expireMs: 50,
    fetchFn: mockFetch(() => {
      if (live) return mockResponse({ status: 200, body: "old" });
      throw new Error("offline");
    }),
  });
  const first = await fetcher.get("https://example.test/missing");
  assert.equal(first.expired, false);
  live = false;
  time.advance(100);
  const cached = await fetcher.get("https://example.test/missing");
  assert.equal(cached.body, "old");
  assert.equal(cached.expired, true);
  assert.equal(cached.stale, true);
  removeDir(dir);
});
