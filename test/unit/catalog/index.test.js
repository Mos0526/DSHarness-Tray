"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createCatalog, configureCatalog, listPlugins, getPlugin, DEFAULT_SOURCES } = require("../../../src/catalog");
const { SOURCE_AWESOME_DEEPSEEK_HARNESS, SOURCE_AWESOME_DSH_PLUGIN } = require("../../../src/catalog/sources");
const { clock, mockFetch, mockResponse, removeDir, tempCacheDir } = require("./helpers");

const adh = readFileSync(join(__dirname, "fixtures", "awesome-deepseek-harness.readme.md"), "utf8");
const adhZh = readFileSync(join(__dirname, "fixtures", "awesome-deepseek-harness.zh.md"), "utf8");
const adp = readFileSync(join(__dirname, "fixtures", "awesome-dsh-plugin.readme.md"), "utf8");
const starsJson = readFileSync(join(__dirname, "fixtures", "stars.json"), "utf8");
const downloadsJson = readFileSync(join(__dirname, "fixtures", "downloads.json"), "utf8");
const pluginYml = readFileSync(join(__dirname, "fixtures", "plugin-spotlight.yml"), "utf8");
const repoJson = readFileSync(join(__dirname, "..", "signals", "fixtures", "github-repo.json"), "utf8");
const commitsJson = readFileSync(join(__dirname, "..", "signals", "fixtures", "github-commits.json"), "utf8");
const archivedJson = readFileSync(join(__dirname, "..", "signals", "fixtures", "github-archived.json"), "utf8");
const packument = readFileSync(join(__dirname, "..", "signals", "fixtures", "npm-packument.json"), "utf8");
const deprecated = readFileSync(join(__dirname, "..", "signals", "fixtures", "npm-deprecated-packument.json"), "utf8");
const downloads = readFileSync(join(__dirname, "..", "signals", "fixtures", "npm-downloads.json"), "utf8");

function sourceList() {
  return [
    { id: SOURCE_AWESOME_DEEPSEEK_HARNESS, urls: ["https://raw.example.test/adh.md"] },
    { id: SOURCE_AWESOME_DEEPSEEK_HARNESS, urls: ["https://raw.example.test/adh.zh.md"] },
    { id: SOURCE_AWESOME_DSH_PLUGIN, urls: ["https://raw.example.test/adp.md"] },
  ];
}

function metricList() {
  return [
    { kind: "stars", urls: ["https://raw.example.test/stars.json"] },
    { kind: "downloads", urls: ["https://raw.example.test/downloads.json"] },
  ];
}

function fixtureFetch(overrides = {}) {
  return mockFetch((url) => {
    if (overrides[url]) return overrides[url]();
    if (url.endsWith("/adh.md")) return mockResponse({ status: 200, body: adh, headers: { etag: "\"adh\"" } });
    if (url.endsWith("/adh.zh.md")) return mockResponse({ status: 200, body: adhZh, headers: { etag: "\"adhzh\"" } });
    if (url.endsWith("/adp.md")) return mockResponse({ status: 200, body: adp, headers: { etag: "\"adp\"" } });
    if (url.endsWith("/stars.json")) return mockResponse({ status: 200, body: starsJson });
    if (url.endsWith("/downloads.json")) return mockResponse({ status: 200, body: downloadsJson });
    if (url.includes("0xsline__dsh-spotlight.yml")) return mockResponse({ status: 200, body: pluginYml });
    if (url.includes("api.github.com") && url.includes("/commits")) return mockResponse({ status: 200, body: commitsJson });
    if (url.includes("api.github.com/repos/0xsline/dsh-spotlight")) return mockResponse({ status: 200, body: repoJson });
    if (url.includes("api.github.com/repos/example/old-plugin")) return mockResponse({ status: 200, body: archivedJson });
    if (url.includes("api.github.com")) {
      return mockResponse({
        status: 200,
        body: JSON.stringify({
          id: 1,
          name: "repo",
          full_name: "owner/repo",
          html_url: url.replace("https://api.github.com/repos/", "https://github.com/"),
          stargazers_count: 2,
          archived: false,
          pushed_at: "2026-08-01T00:00:00Z",
          owner: { login: "owner" },
        }),
      });
    }
    if (url.includes("registry.npmjs.org/old-plugin")) return mockResponse({ status: 200, body: deprecated });
    if (url.includes("registry.npmjs.org/dsh-spotlight")) return mockResponse({ status: 200, body: packument });
    if (url.includes("registry.npmjs.org")) {
      return mockResponse({
        status: 200,
        body: JSON.stringify({
          name: "pkg",
          "dist-tags": { latest: "0.0.1" },
          time: { "0.0.1": "2026-08-01T00:00:00.000Z" },
          versions: { "0.0.1": { version: "0.0.1", dist: { integrity: "sha512-aaa=" } } },
        }),
      });
    }
    if (url.includes("downloads")) return mockResponse({ status: 200, body: downloads });
    return mockResponse({ status: 404, body: "missing" });
  });
}

test("refreshCatalog merges dual directories and fills community / maintenance / supplyChain", async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({
    cacheDir,
    fetchFn: fixtureFetch(),
    now: clock().now,
    sources: sourceList(),
    metricSources: metricList(),
  });
  const result = await catalog.refreshCatalog();
  assert.ok(result.plugins.length >= 4);
  const spotlight = result.plugins.find((item) => item.npmName === "dsh-spotlight");
  assert.equal(spotlight.community.inAwesomeDeepseekHarness, true);
  assert.equal(spotlight.community.inAwesomeDshPlugin, true);
  assert.equal(spotlight.community.stars, 10);
  assert.equal(spotlight.community.npmDownloads, 313);
  assert.match(spotlight.description, /键盘/);
  assert.equal(spotlight.maintenance.deprecated, false);
  assert.equal(spotlight.maintenance.archived, false);
  assert.equal(spotlight.maintenance.lastVersionAt, "2026-08-14T10:41:00.000Z");
  assert.equal(spotlight.maintenance.lastCommitAt, "2026-08-14T10:40:39Z");
  assert.ok(spotlight.maintenance.lastCheckedAt);
  assert.equal(spotlight.supplyChain.exactVersion, "1.2.3");
  assert.match(spotlight.supplyChain.integrity, /^sha512-/);
  assert.equal(spotlight.supplyChain.repoIdentity.repo, "dsh-spotlight");
  assert.ok(Array.isArray(spotlight.supplyChain.changes));
  assert.equal(spotlight.shellVerification, null);
  assert.equal("safetyScore" in spotlight, false);
  assert.equal(catalog.getPlugin(spotlight.stableId).npmName, "dsh-spotlight");
  removeDir(cacheDir);
});

test("offline refresh serves the snapshot with stale=true", async () => {
  const cacheDir = tempCacheDir();
  const time = clock();
  let live = true;
  const catalog = createCatalog({
    cacheDir,
    fetchFn: mockFetch((url, init) => {
      if (!live) throw new Error("offline");
      return fixtureFetch()(url, init);
    }),
    now: time.now,
    sources: sourceList(),
    metricSources: metricList(),
    ttlMs: 10,
  });
  const first = await catalog.refreshCatalog();
  assert.equal(first.stale, false);
  live = false;
  time.advance(100);
  const second = await catalog.refreshCatalog();
  assert.equal(second.stale, true);
  assert.ok(second.plugins.length);
  assert.ok(second.plugins.some((item) => item.npmName === "dsh-spotlight"));
  removeDir(cacheDir);
});

test("module-level configureCatalog / listPlugins / getPlugin are require-able", async () => {
  const cacheDir = tempCacheDir();
  const catalog = configureCatalog({
    cacheDir,
    fetchFn: fixtureFetch(),
    sources: sourceList(),
    metricSources: metricList(),
    enrichSignals: false,
  });
  const result = await catalog.refreshCatalog();
  assert.ok(listPlugins().length > 0);
  assert.equal(getPlugin(result.plugins[0].stableId).stableId, result.plugins[0].stableId);
  assert.equal(result.plugins[0].shellVerification, null);
  removeDir(cacheDir);
});

test("default sources include GitHub raw and a jsDelivr fallback", () => {
  for (const source of DEFAULT_SOURCES) {
    assert.ok(source.urls.some((url) => url.includes("raw.githubusercontent.com")));
    assert.ok(source.urls.some((url) => url.includes("cdn.jsdelivr.net/gh/")));
  }
});

test("refreshCatalog falls back to the next URL when GitHub raw fails", async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({
    cacheDir,
    enrichSignals: false,
    sources: [{
      id: SOURCE_AWESOME_DEEPSEEK_HARNESS,
      urls: [
        "https://raw.githubusercontent.com/0xsline/awesome-deepseek-harness/main/README.md",
        "https://cdn.jsdelivr.net/gh/0xsline/awesome-deepseek-harness@main/README.md",
      ],
    }],
    fetchFn: mockFetch((url) => {
      if (url.includes("raw.githubusercontent.com")) return mockResponse({ status: 403, body: "blocked" });
      if (url.includes("cdn.jsdelivr.net")) return mockResponse({ status: 200, body: adh });
      return mockResponse({ status: 404, body: "missing" });
    }),
  });
  const result = await catalog.refreshCatalog({ force: true });
  assert.ok(result.plugins.some((item) => item.npmName === "dsh-spotlight"));
  assert.equal(result.stale, false);
  assert.equal(result.errors.length, 0);
  removeDir(cacheDir);
});

test("refreshCatalog prefers a fresh fallback over a stale cached primary", async () => {
  const cacheDir = tempCacheDir();
  let primaryLive = true;
  const updated = `${adh}\n## Plugins\n- [fresh-plugin](https://github.com/example/fresh-plugin) - npm: fresh-plugin\n`;
  const catalog = createCatalog({
    cacheDir,
    enrichSignals: false,
    metricSources: [],
    sources: [{
      id: SOURCE_AWESOME_DEEPSEEK_HARNESS,
      urls: [
        "https://raw.githubusercontent.com/example/catalog/main/README.md",
        "https://cdn.jsdelivr.net/gh/example/catalog@main/README.md",
      ],
    }],
    fetchFn: mockFetch((url) => {
      if (url.includes("raw.githubusercontent.com")) {
        return primaryLive
          ? mockResponse({ status: 200, body: adh })
          : mockResponse({ status: 403, body: "blocked" });
      }
      return mockResponse({ status: 200, body: updated });
    }),
  });
  await catalog.refreshCatalog({ force: true });
  primaryLive = false;
  const refreshed = await catalog.refreshCatalog({ force: true });
  assert.equal(refreshed.stale, false);
  assert.equal(refreshed.errors.length, 0);
  assert.ok(refreshed.plugins.some((item) => item.npmName === "fresh-plugin"));
  removeDir(cacheDir);
});

test("empty fetch failure is not treated as an expired just-checked snapshot", async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({
    cacheDir,
    enrichSignals: false,
    sources: [{ id: SOURCE_AWESOME_DEEPSEEK_HARNESS, urls: ["https://raw.example.test/adh.md"] }],
    fetchFn: mockFetch(() => mockResponse({ status: 403, body: "" })),
  });
  const result = await catalog.refreshCatalog({ force: true });
  assert.equal(result.plugins.length, 0);
  assert.equal(result.expired, false);
  assert.equal(result.stale, true);
  assert.match(result.errors[0].error, /HTTP 403/);
  assert.equal(catalog.getCatalogStatus().expired, false);
  removeDir(cacheDir);
});

test("parsed 0 entries is recorded instead of silently succeeding", async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({
    cacheDir,
    enrichSignals: false,
    sources: [{ id: SOURCE_AWESOME_DEEPSEEK_HARNESS, urls: ["https://raw.example.test/adh.md"] }],
    fetchFn: mockFetch(() => mockResponse({ status: 200, body: "# Empty\n\nNo plugins here.\n" })),
  });
  const result = await catalog.refreshCatalog({ force: true });
  assert.equal(result.plugins.length, 0);
  assert.match(result.errors[0].error, /parsed 0 entries/);
  removeDir(cacheDir);
});

test("waitForSignals false publishes directory stars without waiting on GitHub", async () => {
  const cacheDir = tempCacheDir();
  let githubHits = 0;
  const catalog = createCatalog({
    cacheDir,
    sources: sourceList(),
    metricSources: metricList(),
    fetchFn: mockFetch(async (url, init) => {
      if (url.includes("api.github.com") || url.includes("ungh.cc") || url.includes("registry.npmjs.org")) {
        githubHits += 1;
        throw new Error("signals should stay deferred");
      }
      return fixtureFetch()(url, init);
    }),
  });
  const listed = await catalog.refreshCatalog({ waitForSignals: false });
  assert.ok(listed.plugins.length >= 4);
  const spotlight = listed.plugins.find((item) => item.npmName === "dsh-spotlight");
  assert.equal(spotlight.community.stars, 9);
  assert.equal(spotlight.community.npmDownloads, 400);
  assert.ok(spotlight.community.metricsCheckedAt);
  assert.equal(spotlight.community.starsCheckedAt, null);
  assert.equal(spotlight.community.downloadsCheckedAt, null);
  assert.equal(spotlight.maintenance.lastCheckedAt, null);
  assert.match(spotlight.description, /键盘/);
  assert.equal(githubHits, 0);
  assert.ok(catalog.listPlugins().length >= 4);
  removeDir(cacheDir);
});

test("missing live signals do not block the catalog list", async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({
    cacheDir,
    sources: sourceList(),
    metricSources: [],
    enrichSignals: false,
    fetchFn: fixtureFetch(),
  });
  const listed = await catalog.refreshCatalog({ waitForSignals: false });
  assert.ok(listed.plugins.length >= 4);
  assert.equal(listed.plugins.find((item) => item.npmName === "dsh-spotlight").community.stars, null);
  removeDir(cacheDir);
});

test("enrichDetailsFor translates the selected plugin and writes catalog cache", async () => {
  const cacheDir = tempCacheDir();
  let translated = 0;
  const catalog = createCatalog({
    cacheDir,
    sources: [{ id: SOURCE_AWESOME_DEEPSEEK_HARNESS, urls: ["https://raw.example.test/adh.md"] }],
    metricSources: [],
    enrichSignals: false,
    translateFn: async (text) => {
      translated += 1;
      return `中文译文：${text}`;
    },
    fetchFn: mockFetch((url) => {
      if (url.endsWith("/adh.md")) {
        return mockResponse({
          status: 200,
          body: "- [english-only](https://github.com/example/english-only) — Rotating status phrases.\n",
        });
      }
      if (url.includes("README.md") && url.includes("english-only")) {
        return mockResponse({
          status: 200,
          body: "# english-only\n\nRotating status phrases for the tray, with a longer English introduction.\n",
        });
      }
      if (url.includes("english-only") && url.endsWith("package.json")) {
        return mockResponse({
          status: 200,
          body: JSON.stringify({ name: "@example/english-plugin", version: "1.0.0" }),
        });
      }
      if (url.includes("%40example%2Fenglish-plugin")) {
        return mockResponse({
          status: 200,
          body: JSON.stringify({
            name: "@example/english-plugin",
            "dist-tags": { latest: "1.0.0" },
            versions: {
              "1.0.0": {
                name: "@example/english-plugin",
                version: "1.0.0",
                dist: { integrity: "sha512-demo", tarball: "https://registry.example/plugin.tgz" },
                repository: { url: "https://github.com/example/english-only" },
              },
            },
          }),
        });
      }
      return mockResponse({ status: 404, body: "missing" });
    }),
  });
  const listed = await catalog.refreshCatalog({ waitForSignals: false });
  const plugin = listed.plugins.find((item) => item.npmName === "english-only" || item.displayName === "english-only");
  assert.ok(plugin);
  await catalog.enrichDetailsFor([plugin.stableId]);
  const detailed = catalog.getPlugin(plugin.stableId);
  assert.equal(detailed.descriptionZh, true);
  assert.equal(detailed.npmName, "@example/english-plugin");
  assert.match(detailed.longDescription, /中文译文/);
  assert.ok(detailed.detailFetchedAt);
  const before = translated;
  await catalog.enrichDetailsFor([plugin.stableId]);
  assert.equal(translated, before);
  removeDir(cacheDir);
});

test("enrichSignalsFor only fetches the requested plugin", async () => {
  const cacheDir = tempCacheDir();
  const hits = [];
  const catalog = createCatalog({
    cacheDir,
    sources: sourceList(),
    metricSources: metricList(),
    fetchFn: mockFetch((url, init) => {
      hits.push(url);
      return fixtureFetch()(url, init);
    }),
  });
  const listed = await catalog.refreshCatalog({ waitForSignals: false });
  const spotlight = listed.plugins.find((item) => item.npmName === "dsh-spotlight");
  const before = hits.filter((url) => url.includes("api.github.com")).length;
  await catalog.enrichSignalsFor([spotlight.stableId]);
  const after = hits.filter((url) => url.includes("api.github.com"));
  assert.ok(after.length > before);
  assert.ok(after.every((url) => url.includes("dsh-spotlight")));
  assert.equal(catalog.getPlugin(spotlight.stableId).community.stars, 10);
  removeDir(cacheDir);
});

test("resolveInstallPin returns exact version and integrity for the install task", async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({
    cacheDir,
    fetchFn: fixtureFetch(),
    sources: sourceList(),
    enrichSignals: false,
  });
  const pin = await catalog.resolveInstallPin({ npmName: "dsh-spotlight" });
  assert.equal(pin.exactVersion, "1.2.3");
  assert.match(pin.integrity, /^sha512-/);
  assert.equal(pin.repoIdentity.owner, "0xsline");
  removeDir(cacheDir);
});

test("resolveInstallPin follows the host DSH prerelease channel", async () => {
  const cacheDir = tempCacheDir();
  const channel = readFileSync(join(__dirname, "..", "signals", "fixtures", "npm-channel-packument.json"), "utf8");
  const catalog = createCatalog({
    cacheDir,
    fetchFn: mockFetch((url) => {
      if (url.includes("dsh-better-sidebar")) return mockResponse({ status: 200, body: channel });
      return mockResponse({ status: 404, body: "{}" });
    }),
    sources: sourceList(),
    enrichSignals: false,
    getHostVersion: () => "0.1.2-alpha.2",
  });
  const pin = await catalog.resolveInstallPin({ npmName: "dsh-better-sidebar" });
  assert.equal(pin.exactVersion, "0.18.0-alpha.0");
  assert.equal(pin.latestVersion, "0.17.1");
  removeDir(cacheDir);
});

test("refreshCatalog recovers a monorepo DSH plugin when the unscoped npm name is a different package", async () => {
  const cacheDir = tempCacheDir();
  const listing = "- [tt-a1i/archify](https://github.com/tt-a1i/archify) - architecture diagrams\n";
  const wrongNpm = JSON.stringify({
    name: "archify",
    "dist-tags": { latest: "0.0.4" },
    time: { "0.0.4": "2022-06-13T03:21:37.586Z" },
    versions: {
      "0.0.4": {
        version: "0.0.4",
        dist: { integrity: "sha512-wrongPackage==" },
        repository: { url: "git+https://github.com/justin-calleja/archify.git" },
      },
    },
  });
  const rightNpm = JSON.stringify({
    name: "@tt-a1i/archify-dsh",
    "dist-tags": { latest: "0.1.0" },
    time: { "0.1.0": "2026-08-30T00:00:00.000Z" },
    versions: {
      "0.1.0": {
        version: "0.1.0",
        dist: { integrity: "sha512-rightPackage==" },
        repository: { url: "git+https://github.com/tt-a1i/archify.git" },
      },
    },
  });
  const pluginPkg = JSON.stringify({
    name: "@tt-a1i/archify-dsh",
    version: "0.1.0",
    dsh: { bundle: { patch: "./cordis.patch.yml" } },
    repository: { url: "git+https://github.com/tt-a1i/archify.git" },
  });
  const catalog = createCatalog({
    cacheDir,
    fetchFn: mockFetch((url) => {
      if (url.includes("listing.md")) return mockResponse({ status: 200, body: listing });
      if (url.includes("archify-dsh") || url.includes("%2Farchify-dsh")) {
        return mockResponse({ status: 200, body: rightNpm });
      }
      if (url.includes("registry.npmjs.org/archify") || url.endsWith("/archify")) {
        return mockResponse({ status: 200, body: wrongNpm });
      }
      if (url.includes("integrations/deepseek-harness/package.json")) {
        return mockResponse({ status: 200, body: pluginPkg });
      }
      if (url.includes("downloads")) return mockResponse({ status: 200, body: "{\"downloads\":10}" });
      if (url.includes("api.github.com")) {
        return mockResponse({
          status: 200,
          body: JSON.stringify({
            id: 1,
            full_name: "tt-a1i/archify",
            html_url: "https://github.com/tt-a1i/archify",
            stargazers_count: 36000,
            archived: false,
            description: "architecture diagrams",
          }),
        });
      }
      return mockResponse({ status: 404, body: "" });
    }),
    sources: [{ id: SOURCE_AWESOME_DSH_PLUGIN, urls: ["https://raw.example.test/listing.md"] }],
    metricSources: [],
  });
  const result = await catalog.refreshCatalog();
  const plugin = result.plugins.find((item) => /archify/.test(`${item.npmName} ${item.displayName}`));
  assert.ok(plugin);
  assert.equal(plugin.npmName, "@tt-a1i/archify-dsh");
  assert.equal(plugin.supplyChain.exactVersion, "0.1.0");
  assert.equal((plugin.supplyChain.changes || []).some((change) => /mismatch/.test(change.type || "")), false);
  removeDir(cacheDir);
});
