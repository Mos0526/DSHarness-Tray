"use strict";

const { PluginCenterSession, emptySnapshot } = require("./session");
const { demoSnapshot } = require("./demo-snapshot");
const { buildViewModel } = require("./view-model");
const { createFavoritesStore } = require("./favorites");
const { catalogLatestVersion, detectUpdateAvailable, matchCatalogPlugin } = require("../install/updates");
const { sameRepoIdentity } = require("../identity/stable-id");

const CATALOG_SNAPSHOT_REFRESH_MS = 6 * 60 * 60 * 1000;

function tryRequire(id) {
  try {
    return require(id);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function asSignal(value, parent) {
  if (value && typeof value === "object") return value;
  if (value == null) return { value: null, fetchedAt: parent?.maintenance?.lastCheckedAt || null, stale: Boolean(parent?.stale) };
  return { value, fetchedAt: parent?.maintenance?.lastCheckedAt || null, stale: Boolean(parent?.stale) };
}

function catalogSignal(value, checkedAt, stale) {
  if (value && typeof value === "object") return asSignal(value);
  return {
    value: value ?? null,
    fetchedAt: checkedAt || null,
    stale: Boolean(stale),
  };
}

function mapCatalogEntry(plugin) {
  if (!plugin || typeof plugin !== "object") return null;
  const id = plugin.stableId || plugin.id || plugin.npmName || plugin.displayName;
  if (!id) return null;
  const changes = plugin.supplyChain?.changes || [];
  return {
    id,
    name: plugin.displayName || plugin.name || plugin.npmName || id,
    description: plugin.description || "",
    longDescription: plugin.longDescription || "",
    descriptionZh: plugin.descriptionZh,
    descriptionSource: plugin.descriptionSource || "",
    detailFetchedAt: plugin.detailFetchedAt || null,
    missingZh: plugin.missingZh,
    about: plugin.about || "",
    category: plugin.category || "",
    repositoryUrl: plugin.repo?.url || plugin.repositoryUrl || "",
    repositoryId: plugin.repo?.id || plugin.repositoryId || "",
    npmName: plugin.npmName || "",
    exactVersion: plugin.supplyChain?.exactVersion || plugin.exactVersion || "",
    latestVersion: plugin.maintenance?.latestVersion || plugin.latestVersion || plugin.supplyChain?.exactVersion || "",
    integrity: plugin.supplyChain?.integrity || plugin.integrity || "",
    inAwesomeDeepseekHarness: plugin.community?.inAwesomeDeepseekHarness ?? plugin.inAwesomeDeepseekHarness,
    inAwesomeDshPlugin: plugin.community?.inAwesomeDshPlugin ?? plugin.inAwesomeDshPlugin,
    catalogConflict: changes.some((change) => change.type === "catalog-conflict"),
    identityChanged: changes.some((change) => /mismatch|mapping|identity/i.test(change.type || "")),
    stars: catalogSignal(
      plugin.community?.stars ?? plugin.stars,
      plugin.community?.starsCheckedAt,
      plugin.community?.starsStale,
    ),
    npmDownloads: catalogSignal(
      plugin.community?.npmDownloads ?? plugin.npmDownloads,
      plugin.community?.downloadsCheckedAt,
      plugin.community?.downloadsStale,
    ),
    lastCommitAt: plugin.maintenance?.lastCommitAt || plugin.lastCommitAt,
    lastCheckedAt: plugin.maintenance?.lastCheckedAt || plugin.lastCheckedAt,
    deprecated: plugin.maintenance?.deprecated ?? plugin.deprecated,
    archived: plugin.maintenance?.archived ?? plugin.archived,
    signalsStale: Boolean(plugin.stale || plugin.expired),
  };
}

function mapLifecycle(item, life) {
  const state = life?.state || item.homeKind || item.state;
  const verify = life?.shellVerification || item.shellVerification || {};
  const quarantined = state === "quarantine" || state === "quarantined";
  return {
    id: item.pluginId || item.id,
    name: item.pluginId || item.name || item.id,
    state: quarantined ? "quarantined" : state,
    installed: ["active", "installed", "staging", "quarantine", "quarantined"].includes(state),
    quarantined,
    verifyFailed: verify.status === "failed",
    installedVersion: item.exactVersion || life?.exactVersion,
    availableVersion: item.availableVersion || life?.availableVersion,
    updateAvailable: Boolean(item.updateAvailable || life?.updateAvailable),
    verify: {
      ok: verify.status === "passed" ? true : verify.status === "failed" ? false : null,
      host: verify.host?.ok === false
        ? "fail"
        : verify.host?.ok === true && !verify.host?.skipped
          ? "pass"
          : "unknown",
      renderer: verify.renderer?.ok === false
        ? "fail"
        : verify.renderer?.ok === true && !verify.renderer?.skipped
          ? "pass"
          : "unknown",
      reason: Array.isArray(verify.reasons) ? verify.reasons.join("；") : (verify.reason || ""),
      dshVersion: life?.dshVersion || "",
      stage: verify.stage || life?.stage || "",
      logExcerpt: verify.logExcerpt || life?.logExcerpt || "",
      lastVerifiedAt: verify.lastVerifiedAt || null,
    },
  };
}

function catalogPluginKeys(entry) {
  return [entry?.stableId, entry?.id, entry?.npmName, entry?.pluginId, entry?.name, entry?.displayName]
    .map((value) => String(value || "").toLowerCase())
    .filter(Boolean);
}

function selectCatalogPlugin(pluginId, catalogPlugins, receipt) {
  const key = String(pluginId || "").toLowerCase();
  if (receipt?.repoIdentity) {
    const byRepository = (catalogPlugins || []).find((entry) => sameRepoIdentity(
      entry.repo || entry.supplyChain?.repoIdentity,
      receipt.repoIdentity,
    ));
    if (byRepository) return byRepository;
  }
  const candidates = (catalogPlugins || []).filter((entry) => catalogPluginKeys(entry).includes(key));
  if (!candidates.length) return null;
  return candidates.sort((left, right) => {
    const leftDual = Number(Boolean(left.community?.inAwesomeDeepseekHarness && left.community?.inAwesomeDshPlugin));
    const rightDual = Number(Boolean(right.community?.inAwesomeDeepseekHarness && right.community?.inAwesomeDshPlugin));
    if (leftDual !== rightDual) return rightDual - leftDual;
    return Number(right.community?.stars || 0) - Number(left.community?.stars || 0);
  })[0];
}

function wrapSession(session) {
  return {
    kind: "session",
    session,
    async loadSnapshot() {
      return session.raw();
    },
    actions: {
      install: (id, opts) => session.install(id, opts),
      uninstall: (id) => session.uninstall(id),
      upgrade: (id) => session.upgrade(id),
      openQuarantine: (id) => session.openQuarantine(id),
      interruptInstall: (id) => session.interruptInstall(id),
      enrichVisible: async () => ({ ok: true }),
    },
  };
}

function formatCatalogErrors(errors) {
  return (errors || []).map((item) => {
    if (!item) return "";
    if (typeof item === "string") return item;
    const err = item.error || item.message || String(item);
    return item.sourceId ? `${err}（${item.sourceId}）` : err;
  }).filter(Boolean).join("；");
}

function catalogFetchedAtMs(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function wrapModules(modules, options = {}) {
  const root = options.root || options.shellDshRoot || null;
  const homeKinds = ["active", "staging", "quarantine"];
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const snapshotRefreshMs = options.snapshotRefreshMs ?? CATALOG_SNAPSHOT_REFRESH_MS;

  async function pullCatalog({ force = false } = {}) {
    if (typeof modules.catalog?.refreshCatalog !== "function") return null;
    return modules.catalog.refreshCatalog({ force, waitForSignals: false });
  }

  async function loadSnapshot() {
    let catalogPlugins = [];
    let entries = [];
    let catalogStale = false;
    let catalogError = "";
    let catalogErrors = [];
    let catalogFetchedAt = now();
    try {
      if (typeof modules.catalog?.listPlugins === "function") {
        catalogPlugins = modules.catalog.listPlugins() || [];
      }
      const status = typeof modules.catalog?.getCatalogStatus === "function"
        ? modules.catalog.getCatalogStatus()
        : null;
      const statusFetchedAt = catalogFetchedAtMs(status?.fetchedAt);
      const snapshotAge = statusFetchedAt == null ? Infinity : now() - statusFetchedAt;
      const shouldRefresh = !catalogPlugins.length
        || !Number.isFinite(snapshotAge)
        || snapshotAge < 0
        || snapshotAge >= snapshotRefreshMs;
      if (shouldRefresh && typeof modules.catalog?.refreshCatalog === "function") {
        const refreshed = await pullCatalog({ force: false });
        catalogPlugins = refreshed?.plugins || modules.catalog.listPlugins() || [];
        catalogStale = Boolean(refreshed?.stale);
        catalogErrors = refreshed?.errors || [];
        catalogError = formatCatalogErrors(catalogErrors);
        catalogFetchedAt = catalogFetchedAtMs(refreshed?.fetchedAt) || now();
      } else if (status) {
        catalogStale = Boolean(status.stale);
        catalogErrors = status.errors || [];
        catalogError = formatCatalogErrors(catalogErrors);
        catalogFetchedAt = statusFetchedAt || now();
      }
      entries = catalogPlugins.map(mapCatalogEntry).filter(Boolean);
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error);
      catalogStale = true;
      entries = catalogPlugins.map(mapCatalogEntry).filter(Boolean);
    }

    const items = [];
    const receipts = [];
    if (root && typeof modules.homes?.listInstalled === "function") {
      const seen = new Set();
      for (const kind of homeKinds) {
        let listed = [];
        try {
          listed = modules.homes.listInstalled(kind, root) || [];
        } catch {
          listed = [];
        }
        for (const item of listed) {
          const id = item.pluginId || item.id;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          let receipt = null;
          try {
            receipt = modules.install?.readLedgerReceipt?.(root, id) || null;
          } catch {
            receipt = null;
          }
          let pin = null;
          const catalogRow = selectCatalogPlugin(id, catalogPlugins, receipt)
            || matchCatalogPlugin(id, catalogPlugins);
          if (
            catalogRow?.npmName
            && !catalogLatestVersion(catalogRow)
            && typeof modules.catalog?.resolveInstallPin === "function"
          ) {
            try {
              pin = await modules.catalog.resolveInstallPin({ npmName: catalogRow.npmName }, {
                hostVersion: typeof options.getHostVersion === "function" ? options.getHostVersion() : options.hostVersion,
              });
            } catch {
              pin = null;
            }
          }
          let life = null;
          try {
            life = modules.install?.getPluginLifecycle?.(id, root, {
              catalogPlugins,
              pin,
            }) || null;
          } catch {
            life = null;
          }
          const receiptAt = Date.parse(receipt?.installedAt || "") || 0;
          const verificationAt = Date.parse(life?.shellVerification?.lastVerifiedAt || "") || 0;
          const receiptWins = receipt
            && receipt.hostCompat?.ok !== false
            && receipt.rendererCompat?.ok !== false
            && (!verificationAt || receiptAt >= verificationAt);
          if (receipt && (
            !life?.shellVerification
            || life.shellVerification.status === "unknown"
            || receiptWins
          )) {
            const verified = receipt.hostCompat?.ok !== false && receipt.rendererCompat?.ok !== false;
            life = {
              ...(life || {}),
              shellVerification: {
                status: verified ? "passed" : "failed",
                host: receipt.hostCompat,
                renderer: receipt.rendererCompat,
                reasons: verified ? [] : [
                  receipt.hostCompat?.reason,
                  receipt.rendererCompat?.reason,
                ].filter(Boolean),
                lastVerifiedAt: receipt.installedAt,
              },
            };
          }
          const hint = detectUpdateAvailable({
            pluginId: id,
            installedVersion: item.exactVersion || life?.exactVersion,
            catalogPlugins,
            pin,
          });
          const mapped = mapLifecycle({
            ...item,
            homeKind: kind,
            exactVersion: item.exactVersion || receipt?.exactVersion,
            updateAvailable: hint.updateAvailable || item.updateAvailable,
            availableVersion: hint.availableVersion || item.availableVersion,
          }, life);
          if (catalogRow?.stableId) {
            mapped.id = catalogRow.stableId;
            mapped.name = catalogRow.displayName || catalogRow.npmName || mapped.name;
            mapped.npmName = id;
            mapped.packageId = id;
          }
          items.push(mapped);
          if (receipt) {
            receipts.push({
              ...receipt,
              id: mapped.id,
              packageId: id,
              version: receipt.exactVersion,
              status: "committed",
              at: receipt.installedAt ? Date.parse(receipt.installedAt) : null,
            });
          }
        }
      }
    }

    return {
      catalog: {
        entries,
        stale: catalogStale,
        sourceError: catalogError || undefined,
        errors: catalogErrors,
        fetchedAt: catalogFetchedAt,
      },
      lifecycle: { items },
      receipts,
      signals: { stale: catalogStale, fetchedAt: catalogFetchedAt, error: catalogError || undefined },
      now: Date.now(),
    };
  }

  return {
    kind: "modules",
    modules,
    root,
    loadSnapshot,
    actions: {
      async refresh() {
        await pullCatalog({ force: true });
        return { ok: true };
      },
      async enrichVisible(ids = [], options = {}) {
        const list = Array.isArray(ids) ? ids : [];
        const detailIds = Array.isArray(options.detailIds) ? options.detailIds : [];
        const force = Boolean(options.force);
        if (typeof modules.catalog?.enrichSignalsFor === "function" && list.length) {
          await modules.catalog.enrichSignalsFor(list, { force });
        }
        if (typeof modules.catalog?.enrichDetailsFor === "function" && detailIds.length) {
          await modules.catalog.enrichDetailsFor(detailIds, { force });
        }
        return { ok: true };
      },
      async install(id, opts = {}) {
        if (typeof options.installExecutor === "function") {
          const plugin = modules.catalog?.getPlugin?.(id)
            || (modules.catalog?.listPlugins?.() || []).find((item) => (
              item.stableId === id || item.npmName === id
            ));
          return options.installExecutor({ id, plugin, root, modules, ...opts });
        }
        if (!root || typeof modules.install?.installPlugin !== "function") {
          return { ok: false, error: "安装需要壳目录，DSH 未就绪时仍可卸载已隔离插件。" };
        }
        return modules.install.installPlugin({ root, pluginId: id, ...opts });
      },
      async uninstall(id, opts = {}) {
        if (typeof options.uninstallExecutor === "function") {
          const plugin = modules.catalog?.getPlugin?.(id)
            || (modules.catalog?.listPlugins?.() || []).find((item) => (
              item.stableId === id || item.npmName === id
            ));
          return options.uninstallExecutor({ id, plugin, root, modules, ...opts });
        }
        if (!root || typeof modules.install?.uninstallPlugin !== "function") {
          return { ok: false, error: "卸载模块尚未就绪" };
        }
        return modules.install.uninstallPlugin({ root, pluginId: id });
      },
      async upgrade(id, opts = {}) {
        if (typeof options.installExecutor === "function") {
          const plugin = modules.catalog?.getPlugin?.(id)
            || (modules.catalog?.listPlugins?.() || []).find((item) => (
              item.stableId === id || item.npmName === id
            ));
          return options.installExecutor({ id, plugin, root, modules, upgrade: true, ...opts });
        }
        if (!root || typeof modules.install?.installPlugin !== "function") {
          return { ok: false, error: "升级模块尚未就绪" };
        }
        return modules.install.installPlugin({ root, pluginId: id, ...opts });
      },
      async openQuarantine(id) {
        if (root && typeof modules.install?.getPluginLifecycle === "function") {
          return { ok: true, detail: modules.install.getPluginLifecycle(id, root) };
        }
        const snap = await loadSnapshot();
        const model = buildViewModel(snap);
        return { ok: true, plugin: model.plugins.find((row) => row.id === id) || null };
      },
    },
  };
}

function detectModules() {
  return {
    runtime: tryRequire("../runtime"),
    homes: tryRequire("../homes"),
    install: tryRequire("../install"),
    catalog: tryRequire("../catalog"),
    signals: tryRequire("../signals"),
  };
}

function hasBackend(modules) {
  return Boolean(modules.homes || modules.install || modules.catalog || modules.runtime);
}

function withFavorites(facade, options = {}) {
  const store = options.favoritesStore || createFavoritesStore({
    filePath: options.favoritesPath,
    initial: options.initial?.favorites,
  });
  return {
    ...facade,
    favoritesStore: store,
    async loadSnapshot() {
      const raw = await facade.loadSnapshot();
      return { ...(raw || {}), favorites: store.snapshot() };
    },
    actions: {
      ...(facade.actions || {}),
      toggleFavorite(plugin, nextValue) {
        return store.toggle(plugin, nextValue);
      },
    },
  };
}

/**
 * Bind plugin-center UI to homes/install/catalog when they exist.
 * Otherwise keep an in-memory session so the window still opens after DSH crash.
 */
function createFacade(options = {}) {
  let facade;
  if (options.session) facade = wrapSession(options.session);
  if (!facade && (options.demo || process.env.DSH_PLUGIN_CENTER_DEMO === "1")) {
    facade = wrapSession(new PluginCenterSession(demoSnapshot(options.now)));
  }
  if (!facade && options.initial) facade = wrapSession(new PluginCenterSession(options.initial));
  if (!facade && (options.loadSnapshot || options.actions)) {
    facade = {
      kind: "custom",
      loadSnapshot: options.loadSnapshot || (async () => emptySnapshot()),
      actions: {
        install: async () => ({ ok: false, error: "未提供安装实现" }),
        uninstall: async () => ({ ok: false, error: "未提供卸载实现" }),
        upgrade: async () => ({ ok: false, error: "未提供升级实现" }),
        openQuarantine: async () => ({ ok: false, error: "未提供隔离详情" }),
        enrichVisible: async () => ({ ok: true }),
        ...options.actions,
      },
    };
  }
  if (!facade) {
    const modules = options.modules || detectModules();
    facade = hasBackend(modules)
      ? wrapModules(modules, options)
      : wrapSession(new PluginCenterSession(emptySnapshot()));
  }
  return withFavorites(facade, options);
}

module.exports = {
  createFacade,
  detectModules,
  hasBackend,
  withFavorites,
  tryRequire,
  emptySnapshot,
  mapCatalogEntry,
  mapLifecycle,
  CATALOG_SNAPSHOT_REFRESH_MS,
};
