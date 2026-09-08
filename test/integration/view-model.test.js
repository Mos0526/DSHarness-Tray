"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildViewModel, filterPlugins, queryPlugins, evidenceCards, HIGH_STARS } = require("../../src/plugin-center/view-model");
const { demoSnapshot } = require("../../src/plugin-center/demo-snapshot");

describe("buildViewModel", () => {
  it("groups evidence and never emits a safetyScore", () => {
    const model = buildViewModel(demoSnapshot());
    assert.ok(!("safetyScore" in model));
    assert.equal(JSON.stringify(model).includes("safetyScore"), false);
    const spotlight = model.plugins.find((p) => p.id === "spotlight");
    assert.ok(spotlight.community);
    assert.ok(spotlight.maintenance);
    assert.ok(spotlight.supplyChain);
    assert.ok(spotlight.shellVerify);
    assert.equal(spotlight.community.listing.kind, "dual");
    assert.deepEqual(spotlight.evidence.map((card) => card.id), ["community", "maintenance", "supplyChain"]);
    assert.equal(spotlight.evidence.some((card) => card.title === "本壳验证"), false);
    assert.equal(evidenceCards(spotlight).length, 3);
    assert.match(spotlight.preview.stars, /★ 128/);
    assert.ok(spotlight.preview.heat.some((tag) => tag.label === "双目录"));
    assert.ok(spotlight.preview.heat.some((tag) => tag.id === "downloads"));
    assert.equal(HIGH_STARS, 10);
    assert.equal(spotlight.attention, true);
    assert.ok(spotlight.tags.some((tag) => tag.id === "updateAvailable"));
    assert.equal(spotlight.actions.upgrade, true);
  });

  it("marks quarantined and verifyFailed with list tags", () => {
    const model = buildViewModel(demoSnapshot());
    const crashy = model.plugins.find((p) => p.id === "crashy-host");
    assert.equal(crashy.status, "quarantined");
    assert.ok(crashy.tags.some((tag) => tag.id === "quarantined"));
    assert.equal(crashy.shellVerify.host, "fail");
    assert.equal(crashy.actions.openQuarantine, true);
    assert.equal(crashy.actions.uninstall, true);

    const flake = model.plugins.find((p) => p.id === "renderer-flake");
    assert.equal(flake.status, "verifyFailed");
    assert.ok(flake.tags.some((tag) => tag.id === "verifyFailed"));
  });

  it("keeps the UI usable when signals are stale", () => {
    const model = buildViewModel({
      now: 1_000_000,
      catalog: {
        stale: true,
        sourceError: "ETIMEDOUT",
        fetchedAt: 1,
        entries: [{ id: "x", name: "x", stars: { value: 3, fetchedAt: 1, stale: true } }],
      },
      lifecycle: { items: [] },
      receipts: [],
      signals: { stale: true, fetchedAt: 1 },
    });
    assert.equal(model.banner.stale, true);
    assert.match(model.banner.message, /缓存|过期|不可用/);
    assert.equal(model.plugins[0].community.stars.stale, true);
    assert.ok(model.plugins.length >= 1);
  });

  it("surfaces interrupted installs from receipts", () => {
    const model = buildViewModel({
      catalog: { entries: [{ id: "theme-kit", name: "theme", npmName: "theme-kit", exactVersion: "3.0.0" }] },
      lifecycle: { items: [] },
      receipts: [{ id: "theme-kit", op: "install", status: "aborted", at: 10 }],
    });
    const plugin = model.plugins[0];
    assert.equal(plugin.receipt.interrupted, true);
    assert.equal(plugin.actions.install, true);
  });

  it("does not offer install for a repository-only entry without an npm package", () => {
    const model = buildViewModel({
      catalog: {
        entries: [{
          id: "repo-only",
          name: "Repo only",
          repositoryUrl: "https://github.com/demo/repo-only",
        }],
      },
    });
    assert.equal(model.plugins[0].actions.install, false);
  });

  it("blocks install when the catalog repository and npm package disagree", () => {
    const model = buildViewModel({
      catalog: {
        entries: [{
          id: "tt-a1i/archify",
          name: "tt-a1i/archify",
          npmName: "archify",
          exactVersion: "0.0.4",
          identityChanged: true,
        }],
      },
      lifecycle: { items: [] },
      receipts: [],
    });
    const plugin = model.plugins[0];
    assert.equal(plugin.actions.install, false);
    assert.match(plugin.actions.installReason, /不属于同一仓库/);
    assert.equal(plugin.supplyChain.identityChanged, true);
  });

  it("does not label an installed plugin verifyFailed when verification is unknown", () => {
    const model = buildViewModel({
      catalog: {
        entries: [{ id: "demo", name: "Demo", npmName: "demo" }],
      },
      lifecycle: {
        items: [{
          id: "demo",
          state: "active",
          installed: true,
          verify: { ok: null, host: "unknown", renderer: "unknown" },
        }],
      },
    });
    assert.equal(model.plugins[0].status, "installed");
    assert.equal(model.plugins[0].attention, false);
  });

  it("shows one canonical row when multiple directories point at the same npm package", () => {
    const model = buildViewModel({
      catalog: {
        entries: [
          {
            id: "fork",
            name: "Fork",
            npmName: "dsh-demo",
            stars: { value: 5 },
          },
          {
            id: "official",
            name: "Official",
            npmName: "dsh-demo",
            inAwesomeDeepseekHarness: true,
            inAwesomeDshPlugin: true,
            stars: { value: 100 },
          },
        ],
      },
      lifecycle: {
        items: [{
          id: "official",
          npmName: "dsh-demo",
          state: "active",
          installed: true,
          installedVersion: "1.0.0",
          verify: { ok: true, host: "pass", renderer: "pass" },
        }],
      },
    });
    assert.equal(model.plugins.length, 1);
    assert.equal(model.plugins[0].id, "official");
    assert.equal(model.plugins[0].status, "installed");
  });

  it("lists an exact manual npm command in supply-chain evidence", () => {
    const model = buildViewModel({
      catalog: {
        entries: [{
          id: "demo",
          name: "Demo",
          npmName: "@owner/demo",
          exactVersion: "1.2.3",
          integrity: "sha512-demo",
        }],
      },
    });
    const supply = model.plugins[0].evidence.find((card) => card.id === "supplyChain");
    assert.deepEqual(supply.rows.map(([label]) => label), ["integrity", "手动 npm"]);
    assert.ok(supply.rows.some(([label, value]) => (
      label === "手动 npm"
      && value === "npm install @owner/demo@1.2.3 --ignore-scripts"
    )));
    assert.equal(supply.rows.some(([label]) => label === "版本" || label === "变化"), false);
  });

  it("filters attention groups used by the UI", () => {
    const model = buildViewModel(demoSnapshot());
    assert.ok(filterPlugins(model, "updateAvailable").length >= 1);
    assert.ok(filterPlugins(model, "quarantined").length >= 1);
    assert.ok(model.counts.updateAvailable >= 1);
    assert.ok(model.counts.quarantined >= 1);
  });

  it("adds favorite tags, a favorite filter, and chronological history", () => {
    const model = buildViewModel({
      catalog: {
        entries: [
          { id: "saved", name: "Saved", npmName: "@owner/saved" },
          { id: "plain", name: "Plain" },
        ],
      },
      favorites: {
        favorites: [{
          id: "old-id",
          name: "Saved",
          npmName: "@owner/saved",
          favoritedAt: "2026-08-31T08:00:00.000Z",
        }],
        history: [
          { id: "saved", name: "Saved", action: "favorite", at: "2026-08-31T08:00:00.000Z" },
          { id: "plain", name: "Plain", action: "unfavorite", at: "2026-08-31T09:00:00.000Z" },
        ],
      },
    });

    const saved = model.plugins.find((plugin) => plugin.id === "saved");
    assert.equal(saved.favorite.active, true);
    assert.ok(saved.tags.some((tag) => tag.id === "favorite"));
    assert.equal(model.counts.favorites, 1);
    assert.equal(model.filters.find((filter) => filter.id === "favorites").count, 1);
    assert.deepEqual(filterPlugins(model, "favorites").map((plugin) => plugin.id), ["saved"]);
    assert.deepEqual(model.favoriteHistory.map((item) => item.id), ["plain", "saved"]);
  });

  it("does not call a just-checked empty catalog expired", () => {
    const now = 1_000_000;
    const model = buildViewModel({
      now,
      catalog: { entries: [], stale: true, fetchedAt: now },
      lifecycle: { items: [] },
      receipts: [],
      signals: { stale: true, fetchedAt: now },
    });
    assert.equal(model.banner.message.includes("过期"), false);
    assert.equal(model.counts.all, 0);
  });

  it("shows HTTP or parse errors on the banner instead of only expired", () => {
    const now = Date.now();
    const model = buildViewModel({
      now,
      catalog: {
        entries: [],
        stale: true,
        sourceError: "HTTP 403（awesome-deepseek-harness）",
        fetchedAt: now,
      },
      lifecycle: { items: [] },
      receipts: [],
      signals: { stale: true, fetchedAt: now },
    });
    assert.match(model.banner.message, /403/);
    assert.equal(model.banner.message.includes("数据已过期"), false);
  });

  it("keeps a successful catalog refresh without a stale banner", () => {
    const now = Date.now();
    const model = buildViewModel({
      now,
      catalog: {
        entries: [{ id: "dsh-spotlight", name: "dsh-spotlight", inAwesomeDeepseekHarness: true }],
        stale: false,
        fetchedAt: now,
      },
      lifecycle: { items: [] },
      receipts: [],
      signals: { stale: false, fetchedAt: now },
    });
    assert.equal(model.counts.available, 1);
    assert.equal(model.banner.stale, false);
    assert.equal(model.banner.message, "");
  });

  it("does not treat low stars as a problem state", () => {
    const model = buildViewModel({
      catalog: { entries: [{ id: "tiny", name: "tiny", stars: { value: 1 }, inAwesomeDshPlugin: true }] },
      lifecycle: { items: [] },
      receipts: [],
    });
    assert.equal(model.plugins[0].attention, false);
    assert.equal(model.plugins[0].status, "available");
  });

  it("sorts by stars then dual listing then downloads, with missing stars last", () => {
    const model = buildViewModel({
      catalog: {
        entries: [
          { id: "low", name: "aaa", stars: { value: 2 }, npmDownloads: { value: 9000 }, inAwesomeDshPlugin: true },
          { id: "mid", name: "bbb", stars: { value: 10 }, inAwesomeDshPlugin: true },
          { id: "hot", name: "ccc", stars: { value: 10 }, inAwesomeDeepseekHarness: true, inAwesomeDshPlugin: true },
          { id: "none", name: "ddd" },
        ],
      },
      lifecycle: { items: [] },
      receipts: [],
    });
    assert.deepEqual(model.plugins.map((plugin) => plugin.id), ["hot", "mid", "low", "none"]);
  });

  it("filters shortcut facets and search together", () => {
    const model = buildViewModel({
      catalog: {
        entries: [
          {
            id: "hot",
            name: "hot-plugin",
            description: "键盘优先的 UI 命令面板与图片预览",
            npmName: "hot-plugin",
            stars: { value: 20 },
            npmDownloads: { value: 5800 },
            inAwesomeDeepseekHarness: true,
            inAwesomeDshPlugin: true,
          },
          {
            id: "en-only",
            name: "english-only",
            description: "Agent memory and context recall.（暂无中文说明）",
            stars: { value: 2 },
          },
          {
            id: "plain",
            name: "plain",
            description: "Bot agent workflow 工具",
            npmName: "plain",
            stars: { value: 1 },
            inAwesomeDshPlugin: true,
          },
        ],
      },
      lifecycle: { items: [] },
      receipts: [],
    });
    const stars = queryPlugins(model, { facets: ["stars"] });
    assert.deepEqual(stars.map((plugin) => plugin.id), ["hot"]);
    assert.deepEqual(queryPlugins(model, { facets: ["ui"] }).map((plugin) => plugin.id), ["hot"]);
    assert.deepEqual(queryPlugins(model, { facets: ["vision"] }).map((plugin) => plugin.id), ["hot"]);
    assert.deepEqual(queryPlugins(model, { facets: ["memory"] }).map((plugin) => plugin.id), ["en-only"]);
    assert.deepEqual(queryPlugins(model, { facets: ["bot"] }).map((plugin) => plugin.id), ["en-only", "plain"]);
    assert.deepEqual(queryPlugins(model, { facets: ["tools"] }).map((plugin) => plugin.id), ["plain"]);
    const both = queryPlugins(model, { query: "hot", facets: ["ui"] });
    assert.deepEqual(both.map((plugin) => plugin.id), ["hot"]);
  });

  it("exposes fetched intro separately from the short catalog description", () => {
    const model = buildViewModel({
      catalog: {
        entries: [{
          id: "openviking",
          name: "OpenViking",
          description: "OpenViking: The Context Database for AI Agents",
          longDescription: "OpenViking 是面向 AI 智能体的开源上下文数据库。记忆、资源、技能统一存放。",
          descriptionZh: true,
        }],
      },
      lifecycle: { items: [] },
      receipts: [],
    });
    const plugin = model.plugins[0];
    assert.match(plugin.description, /Context Database/);
    assert.match(plugin.intro, /面向 AI 智能体/);
    assert.match(plugin.detailDescription, /面向 AI 智能体/);
  });

  it("labels a host-channel install version when it differs from npm latest", () => {
    const model = buildViewModel({
      catalog: {
        entries: [{
          id: "dsh-better-sidebar",
          name: "DSH-better-sidebar",
          npmName: "dsh-better-sidebar",
          exactVersion: "0.18.0-alpha.0",
          latestVersion: "0.17.1",
        }],
      },
      lifecycle: { items: [] },
      receipts: [],
    });
    const plugin = model.plugins[0];
    assert.equal(plugin.maintenance.installVersion, "0.18.0-alpha.0");
    assert.equal(plugin.maintenance.latestVersion, "0.17.1");
    assert.equal(plugin.maintenance.channelAhead, true);
    assert.match(plugin.maintenance.versionLabel, /0\.18\.0-alpha\.0/);
    assert.match(plugin.maintenance.versionLabel, /0\.17\.1/);
    assert.match(plugin.maintenance.summary, /当前 DSH 通道/);
    assert.equal(plugin.supplyChain.exactVersion, "0.18.0-alpha.0");
  });

  it("shows compact star placeholder when stars are missing", () => {
    const model = buildViewModel({
      catalog: { entries: [{ id: "none", name: "none", description: "没有热度" }] },
      lifecycle: { items: [] },
      receipts: [],
    });
    assert.equal(model.plugins[0].preview.stars, "★ —");
    assert.equal(model.plugins[0].preview.heat.length, 0);
    assert.ok(model.facets.some((facet) => facet.id === "stars"));
    assert.ok(model.facets.some((facet) => facet.id === "ui"));
    assert.ok(model.facets.some((facet) => facet.id === "vision"));
    assert.ok(model.facets.some((facet) => facet.id === "memory"));
    assert.ok(model.facets.some((facet) => facet.id === "bot"));
    assert.ok(model.facets.some((facet) => facet.id === "tools"));
  });
});
