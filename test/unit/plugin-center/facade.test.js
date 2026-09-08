"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createFacade } = require("../../../src/plugin-center/facade");

describe("plugin-center facade update overlay", () => {
  it("marks updateAvailable from catalog even when the ledger field is false", async () => {
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          listPlugins: () => [{
            stableId: "dsh-demo-plugin",
            npmName: "dsh-demo-plugin",
            displayName: "Demo",
            supplyChain: { exactVersion: "2.0.0" },
          }],
        },
        homes: {
          listInstalled: (kind) => (
            kind === "active"
              ? [{ pluginId: "dsh-demo-plugin", exactVersion: "1.0.0" }]
              : []
          ),
        },
        install: {
          getPluginLifecycle: () => ({
            state: "active",
            updateAvailable: false,
            exactVersion: "1.0.0",
            shellVerification: { status: "passed" },
          }),
        },
      },
    });
    const snap = await facade.loadSnapshot();
    const item = snap.lifecycle.items.find((row) => row.id === "dsh-demo-plugin");
    assert.equal(item.updateAvailable, true);
    assert.equal(item.availableVersion, "2.0.0");
  });

  it("uses resolveInstallPin when the catalog row has no exact version", async () => {
    let pinned = 0;
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          listPlugins: () => [{
            npmName: "dsh-demo-plugin",
            displayName: "Demo",
          }],
          resolveInstallPin: async ({ npmName }) => {
            pinned += 1;
            assert.equal(npmName, "dsh-demo-plugin");
            return { exactVersion: "3.1.0" };
          },
        },
        homes: {
          listInstalled: (kind) => (
            kind === "quarantine"
              ? [{ pluginId: "dsh-demo-plugin", exactVersion: "1.0.0" }]
              : []
          ),
        },
        install: {
          getPluginLifecycle: () => ({
            state: "quarantine",
            updateAvailable: false,
            exactVersion: "1.0.0",
            shellVerification: { status: "failed" },
          }),
        },
      },
    });
    const snap = await facade.loadSnapshot();
    assert.equal(pinned, 1);
    const item = snap.lifecycle.items.find((row) => row.id === "dsh-demo-plugin");
    assert.equal(item.updateAvailable, true);
    assert.equal(item.availableVersion, "3.1.0");
    assert.equal(item.quarantined, true);
  });

  it("merges an installed npm package into the matching repository catalog row", async () => {
    const preferred = {
      stableId: "npm:dsh-demo|repo:github.com/owner/dsh-demo",
      npmName: "dsh-demo",
      displayName: "owner/dsh-demo",
      repo: { host: "github.com", owner: "owner", repo: "dsh-demo" },
      community: { inAwesomeDeepseekHarness: true, inAwesomeDshPlugin: true },
    };
    const fork = {
      stableId: "npm:dsh-demo|repo:github.com/fork/dsh-demo",
      npmName: "dsh-demo",
      displayName: "fork/dsh-demo",
      repo: { host: "github.com", owner: "fork", repo: "dsh-demo" },
    };
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          listPlugins: () => [fork, preferred],
          getCatalogStatus: () => ({ stale: false, errors: [] }),
        },
        homes: {
          listInstalled: (kind) => kind === "active"
            ? [{ pluginId: "dsh-demo", exactVersion: "1.2.3" }]
            : [],
        },
        install: {
          readLedgerReceipt: () => ({
            pluginId: "dsh-demo",
            exactVersion: "1.2.3",
            integrity: "sha512-demo",
            repoIdentity: { host: "github.com", owner: "owner", repo: "dsh-demo" },
            hostCompat: { ok: true },
            rendererCompat: { ok: true },
            installedAt: "2026-08-24T00:00:00.000Z",
          }),
          getPluginLifecycle: () => ({
            state: "active",
            exactVersion: "1.2.3",
            shellVerification: { status: "unknown" },
          }),
        },
      },
    });
    const snapshot = await facade.loadSnapshot();
    assert.equal(snapshot.lifecycle.items.length, 1);
    assert.equal(snapshot.lifecycle.items[0].id, preferred.stableId);
    assert.equal(snapshot.lifecycle.items[0].verify.ok, true);
    assert.equal(snapshot.receipts[0].id, preferred.stableId);
  });

  it("lets a newer committed receipt replace a stale failed lifecycle result", async () => {
    const plugin = {
      stableId: "npm:demo|repo:github.com/owner/demo",
      npmName: "demo",
      displayName: "Demo",
      repo: { host: "github.com", owner: "owner", repo: "demo" },
    };
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          listPlugins: () => [plugin],
          getCatalogStatus: () => ({ stale: false, errors: [] }),
        },
        homes: {
          listInstalled: (kind) => kind === "active"
            ? [{ pluginId: "demo", exactVersion: "2.0.0" }]
            : [],
        },
        install: {
          readLedgerReceipt: () => ({
            pluginId: "demo",
            exactVersion: "2.0.0",
            integrity: "sha512-demo",
            repoIdentity: plugin.repo,
            hostCompat: { ok: true },
            rendererCompat: { ok: true },
            installedAt: "2026-08-24T12:00:00.000Z",
          }),
          getPluginLifecycle: () => ({
            state: "active",
            shellVerification: {
              status: "failed",
              reasons: ["old failure"],
              lastVerifiedAt: "2026-08-24T11:00:00.000Z",
            },
          }),
        },
      },
    });
    const snapshot = await facade.loadSnapshot();
    assert.equal(snapshot.lifecycle.items[0].verify.ok, true);
  });

  it("maps a repository-derived npm name even when the directory guessed another name", async () => {
    const plugin = {
      stableId: "npm:wallpaper-engine|repo:github.com/owner/wallpaper-engine",
      npmName: "wallpaper-engine",
      displayName: "owner/wallpaper-engine",
      repo: { host: "github.com", owner: "owner", repo: "wallpaper-engine" },
    };
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          listPlugins: () => [plugin],
          getCatalogStatus: () => ({ stale: false, errors: [] }),
        },
        homes: {
          listInstalled: (kind) => kind === "active"
            ? [{ pluginId: "dsh-plugin-wallpaper-engine", exactVersion: "0.6.2" }]
            : [],
        },
        install: {
          readLedgerReceipt: () => ({
            pluginId: "dsh-plugin-wallpaper-engine",
            exactVersion: "0.6.2",
            repoIdentity: plugin.repo,
            hostCompat: { ok: true },
            rendererCompat: { ok: true },
            installedAt: "2026-08-24T12:00:00.000Z",
          }),
          getPluginLifecycle: () => ({
            state: "active",
            shellVerification: { status: "passed" },
          }),
        },
      },
    });
    const snapshot = await facade.loadSnapshot();
    assert.equal(snapshot.lifecycle.items[0].id, plugin.stableId);
    assert.equal(snapshot.lifecycle.items[0].npmName, "dsh-plugin-wallpaper-engine");
  });

  it("loads catalog rows via refreshCatalog when the in-memory list is empty", async () => {
    let refreshed = 0;
    const facade = createFacade({
      modules: {
        catalog: {
          listPlugins: () => [],
          refreshCatalog: async ({ waitForSignals }) => {
            refreshed += 1;
            assert.equal(waitForSignals, false);
            return {
              plugins: [{
                stableId: "dsh-spotlight",
                displayName: "dsh-spotlight",
                npmName: "dsh-spotlight",
                community: { inAwesomeDeepseekHarness: true, inAwesomeDshPlugin: true },
              }],
              fetchedAt: new Date().toISOString(),
              stale: false,
              errors: [],
            };
          },
        },
      },
    });
    const snap = await facade.loadSnapshot();
    assert.equal(refreshed, 1);
    assert.equal(snap.catalog.entries.length, 1);
    assert.equal(snap.catalog.stale, false);
    assert.equal(snap.catalog.entries[0].id, "dsh-spotlight");
  });

  it("refreshes an existing catalog snapshot after its refresh window", async () => {
    const now = Date.parse("2026-08-31T08:00:00.000Z");
    let refreshed = 0;
    const plugin = { stableId: "x", displayName: "x", npmName: "x" };
    const facade = createFacade({
      now: () => now,
      modules: {
        catalog: {
          listPlugins: () => [plugin],
          getCatalogStatus: () => ({
            fetchedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
            stale: false,
            errors: [],
          }),
          refreshCatalog: async () => {
            refreshed += 1;
            return {
              plugins: [plugin],
              fetchedAt: new Date(now).toISOString(),
              stale: false,
              errors: [],
            };
          },
        },
      },
    });
    const snapshot = await facade.loadSnapshot();
    assert.equal(refreshed, 1);
    assert.equal(snapshot.catalog.fetchedAt, now);
  });

  it("force-refreshes the catalog from the refresh action", async () => {
    const calls = [];
    const facade = createFacade({
      modules: {
        catalog: {
          listPlugins: () => [{ stableId: "x", displayName: "x", npmName: "x" }],
          getCatalogStatus: () => ({ fetchedAt: new Date().toISOString(), stale: false, errors: [], count: 1 }),
          refreshCatalog: async (opts) => {
            calls.push(opts);
            return { plugins: [{ stableId: "x", displayName: "x", npmName: "x" }], fetchedAt: new Date().toISOString(), stale: false, errors: [] };
          },
        },
      },
    });
    await facade.actions.refresh();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].force, true);
    assert.equal(calls[0].waitForSignals, false);
  });

  it("passes the selected catalog plugin to the production install executor", async () => {
    const plugin = {
      stableId: "repo:github.com/demo/plugin",
      npmName: "dsh-demo-plugin",
      displayName: "Demo",
    };
    let received;
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          getPlugin: (id) => (id === plugin.stableId ? plugin : null),
          listPlugins: () => [plugin],
        },
      },
      installExecutor: async (input) => {
        received = input;
        return { ok: true };
      },
    });
    const result = await facade.actions.install(plugin.stableId);
    assert.equal(result.ok, true);
    assert.equal(received.plugin, plugin);
    assert.equal(received.root, "E:\\shell-dsh");
  });

  it("passes the selected catalog plugin to the production uninstall executor", async () => {
    const plugin = { stableId: "repo:demo", npmName: "dsh-demo-plugin" };
    let received;
    const facade = createFacade({
      root: "E:\\shell-dsh",
      modules: {
        catalog: {
          getPlugin: () => plugin,
          listPlugins: () => [plugin],
        },
      },
      uninstallExecutor: async (input) => {
        received = input;
        return { ok: true };
      },
    });
    const result = await facade.actions.uninstall(plugin.stableId);
    assert.equal(result.ok, true);
    assert.equal(received.plugin, plugin);
  });

  it("enrichVisible only asks the catalog to refresh selected ids", async () => {
    const seen = [];
    const details = [];
    const signalOptions = [];
    const detailOptions = [];
    const facade = createFacade({
      modules: {
        catalog: {
          listPlugins: () => [{ stableId: "x", displayName: "x", npmName: "x", community: { stars: 9 } }],
          getCatalogStatus: () => ({ fetchedAt: new Date().toISOString(), stale: false, errors: [], count: 1 }),
          enrichSignalsFor: async (ids, options) => {
            seen.push(ids);
            signalOptions.push(options);
            return [];
          },
          enrichDetailsFor: async (ids, options) => {
            details.push(ids);
            detailOptions.push(options);
            return [];
          },
        },
      },
    });
    await facade.actions.enrichVisible(["x"], { detailIds: ["x"], force: true });
    assert.deepEqual(seen, [["x"]]);
    assert.deepEqual(details, [["x"]]);
    assert.deepEqual(signalOptions, [{ force: true }]);
    assert.deepEqual(detailOptions, [{ force: true }]);
  });

  it("surfaces fetch errors instead of treating an empty catalog as merely stale", async () => {
    const facade = createFacade({
      modules: {
        catalog: {
          listPlugins: () => [],
          refreshCatalog: async () => ({
            plugins: [],
            fetchedAt: new Date().toISOString(),
            stale: true,
            expired: false,
            errors: [{ sourceId: "awesome-deepseek-harness", error: "HTTP 403" }],
          }),
        },
      },
    });
    const snap = await facade.loadSnapshot();
    assert.equal(snap.catalog.entries.length, 0);
    assert.match(snap.catalog.sourceError, /HTTP 403/);
    assert.equal(snap.catalog.stale, true);
  });
});
