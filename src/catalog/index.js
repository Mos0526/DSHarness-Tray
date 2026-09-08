"use strict";

const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { dirname, join } = require("node:path");
const { createCachedFetcher } = require("./fetch");
const {
  SOURCE_AWESOME_DEEPSEEK_HARNESS,
  SOURCE_AWESOME_DSH_PLUGIN,
  DEFAULT_LISTING_SOURCES,
  DEFAULT_METRIC_SOURCES,
  githubReadmeUrls,
  githubFileUrls,
  parseAwesomeMarkdown,
  parseCatalogJson,
  parseMetricsJson,
  mergeMetricMaps,
  applyDirectoryMetrics,
  mergeCatalogEntries,
} = require("./sources");
const { localizeDescription, hasCjk, parsePluginYml, pluginYmlUrls } = require("./descriptions");
const { fetchDetailDescription, fetchRepositoryPackageIdentity, mergeDetail } = require("./detail");
const { guessedPluginNpmNames } = require("../identity/plugin-package");
const { stableIdFrom, parseRepoIdentity, sameRepoIdentity } = require("../identity/stable-id");
const { createGithubSignals } = require("../signals/github");
const { createNpmSignals } = require("../signals/npm");

const DEFAULT_SOURCES = DEFAULT_LISTING_SOURCES;

function laterIso(...values) {
  const times = values.filter(Boolean).map((item) => Date.parse(item)).filter(Number.isFinite);
  if (!times.length) return null;
  return new Date(Math.max(...times)).toISOString();
}

function readSnapshot(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeSnapshot(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

async function mapPool(items, limit, fn) {
  const list = [...items];
  const out = new Array(list.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, list.length || 1)) }, async () => {
    while (cursor < list.length) {
      const index = cursor++;
      out[index] = await fn(list[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

function supplyChanges(entry, github, npm) {
  const changes = [];
  if (entry.repo && npm.repoIdentity && !sameRepoIdentity(entry.repo, npm.repoIdentity)) {
    changes.push({
      type: "repo-mismatch",
      catalog: entry.repo,
      npm: npm.repoIdentity,
    });
  }
  if (github.repoIdentity && npm.repoIdentity && !sameRepoIdentity(github.repoIdentity, npm.repoIdentity)) {
    changes.push({
      type: "github-npm-repo-mismatch",
      github: github.repoIdentity,
      npm: npm.repoIdentity,
    });
  }
  for (const conflict of entry.conflicts || []) changes.push({ type: "catalog-conflict", ...conflict });
  return changes;
}

function emptyGithub(entry) {
  return {
    stars: Number.isFinite(entry?.stars) ? entry.stars : null,
    archived: null,
    lastCommitAt: null,
    about: entry?.about || null,
    repoId: null,
    repoIdentity: entry?.repo || null,
    stale: false,
    expired: false,
    lastCheckedAt: null,
  };
}

function emptyNpm(entry) {
  return {
    npmName: entry?.npmName || "",
    downloads: Number.isFinite(entry?.downloads) ? entry.downloads : null,
    lastVersionAt: null,
    deprecated: false,
    integrity: null,
    exactVersion: null,
    repoIdentity: null,
    stale: false,
    expired: false,
    lastCheckedAt: null,
  };
}

function pickNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function persistSnapshot(filePath, value) {
  try {
    writeSnapshot(filePath, value);
  } catch {
    /* cache write must not fail refresh */
  }
}

function toPlugin(entry, github, npm) {
  const repo = github.repoIdentity || entry.repo || parseRepoIdentity(entry.repoUrl);
  const lastCheckedAt = laterIso(github.lastCheckedAt, npm.lastCheckedAt);
  const localized = localizeDescription({ ...entry, repo, npmName: entry.npmName || npm.npmName });
  return {
    stableId: entry.stableId || stableIdFrom({ npmName: entry.npmName, repoUrl: repo || entry.repoUrl }),
    displayName: entry.displayName || entry.name,
    npmName: entry.npmName || npm.npmName || "",
    description: localized.description,
    descriptionZh: localized.descriptionZh || Boolean(entry.descriptionZh),
    longDescription: entry.longDescription || "",
    descriptionSource: entry.descriptionSource || "",
    detailFetchedAt: entry.detailFetchedAt || null,
    missingZh: entry.missingZh == null ? !localized.descriptionZh : Boolean(entry.missingZh),
    about: github.about || entry.about || "",
    repo: repo
      ? {
          host: repo.host,
          owner: repo.owner,
          repo: repo.repo,
          directory: repo.directory || null,
          url: repo.url,
          id: github.repoId ?? repo.id ?? null,
        }
      : null,
    community: {
      inAwesomeDeepseekHarness: Boolean(entry.inAwesomeDeepseekHarness),
      inAwesomeDshPlugin: Boolean(entry.inAwesomeDshPlugin),
      stars: pickNumber(github.stars, entry.stars),
      npmDownloads: pickNumber(npm.downloads, entry.downloads),
      metricsCheckedAt: entry.metricsCheckedAt || null,
      starsCheckedAt: github.lastCheckedAt || null,
      downloadsCheckedAt: npm.lastCheckedAt || null,
      starsStale: Boolean(github.stale || github.expired),
      downloadsStale: Boolean(npm.stale || npm.expired),
    },
    maintenance: {
      lastVersionAt: npm.lastVersionAt,
      lastCommitAt: github.lastCommitAt,
      latestVersion: npm.latestVersion || npm.exactVersion || null,
      deprecated: npm.deprecated == null ? null : Boolean(npm.deprecated),
      archived: github.archived == null ? null : Boolean(github.archived),
      lastCheckedAt,
    },
    supplyChain: {
      exactVersion: npm.exactVersion,
      integrity: npm.integrity,
      repoIdentity: npm.repoIdentity || repo || null,
      changes: supplyChanges(entry, github, npm),
    },
    shellVerification: null,
    stale: Boolean(github.stale || npm.stale),
    expired: Boolean(github.expired || npm.expired),
  };
}

function createCatalog({
  cacheDir,
  fetchFn,
  now,
  sources = DEFAULT_SOURCES,
  metricSources = DEFAULT_METRIC_SOURCES,
  enrichSignals = true,
  concurrency = 4,
  ttlMs,
  expireMs,
  translateFn,
  hostVersion,
  getHostVersion,
} = {}) {
  if (!cacheDir) throw new Error("createCatalog requires cacheDir");
  const fetcher = createCachedFetcher({ cacheDir, fetchFn, now, ttlMs, expireMs });
  const github = createGithubSignals({ fetcher });
  const npm = createNpmSignals({ fetcher });
  const snapshotPath = join(cacheDir, "catalog-snapshot.json");
  let memory = readSnapshot(snapshotPath);
  let inflight = null;
  let lastMerged = [];

  function resolveHostVersion(options = {}) {
    if (options.hostVersion) return options.hostVersion;
    if (typeof getHostVersion === "function") {
      try {
        return getHostVersion() || "";
      } catch {
        return "";
      }
    }
    return hostVersion || "";
  }

  async function loadSource(source, force) {
    const errors = [];
    let staleCandidate = null;
    for (const url of source.urls || []) {
      const result = await fetcher.get(url, { force });
      if (result.error && !result.body) {
        errors.push({ sourceId: source.id, url, error: result.error });
        continue;
      }
      try {
        const parsed = source.format === "json" || /\.json(\?|$)/i.test(url)
          ? parseCatalogJson(result.body, source.id)
          : parseAwesomeMarkdown(result.body, source.id);
        if (!parsed.length) {
          errors.push({ sourceId: source.id, url, error: "parsed 0 entries" });
          continue;
        }
        const degraded = Boolean(result.error || result.stale || result.expired);
        if (!degraded) return { entries: parsed, errors: [], stale: false };
        if (!staleCandidate) staleCandidate = parsed;
        errors.push({
          sourceId: source.id,
          url,
          error: result.error || (result.expired ? "cached source expired" : "cached source stale"),
        });
      } catch (error) {
        errors.push({ sourceId: source.id, url, error: String(error.message || error) });
      }
    }
    if (staleCandidate) return { entries: staleCandidate, errors, stale: true };
    return { entries: [], errors, stale: errors.length > 0 };
  }

  async function loadMetrics(force) {
    const maps = [];
    let stale = false;
    for (const source of metricSources || []) {
      let loaded = null;
      let staleCandidate = null;
      for (const url of source.urls || []) {
        const result = await fetcher.get(url, { force });
        if (result.error && !result.body) continue;
        try {
          const parsed = parseMetricsJson(result.body);
          if (parsed.size) {
            if (!result.error && !result.stale && !result.expired) {
              loaded = parsed;
              break;
            }
            if (!staleCandidate) staleCandidate = parsed;
          }
        } catch {
          /* metrics are optional */
        }
      }
      if (!loaded && staleCandidate) {
        loaded = staleCandidate;
        stale = true;
      }
      if (loaded) maps.push(loaded);
    }
    return { metrics: mergeMetricMaps(...maps), stale };
  }

  async function enrichDescriptionFromYml(entry) {
    if (hasCjk(entry.description)) return entry;
    const urls = pluginYmlUrls(entry.repo, githubFileUrls);
    for (const url of urls) {
      const result = await fetcher.get(url);
      if (!result.body) continue;
      const parsed = parsePluginYml(result.body);
      if (parsed.descriptionZh) {
        return { ...entry, description: parsed.descriptionZh };
      }
    }
    return entry;
  }

  async function recoverMismatchedNpm(entry, pack, force) {
    if (!entry?.repo || !pack?.repoIdentity || sameRepoIdentity(entry.repo, pack.repoIdentity)) {
      return { entry, pack };
    }
    const recovered = await fetchRepositoryPackageIdentity(entry, { fetcher, fileUrls: githubFileUrls });
    const guesses = [
      recovered.npmName,
      ...guessedPluginNpmNames(entry.repo),
    ].filter((name) => name && name !== entry.npmName);
    for (const name of guesses) {
      const nextPack = await npm.fetchNpmSignals(name, { force: true, hostVersion: resolveHostVersion() });
      if (nextPack.repoIdentity && sameRepoIdentity(entry.repo, nextPack.repoIdentity)) {
        return { entry: { ...entry, npmName: name }, pack: nextPack };
      }
    }
    return { entry, pack };
  }

  async function enrich(entry, force) {
    if (!enrichSignals) return toPlugin(entry, emptyGithub(entry), emptyNpm(entry));
    const [gh, pack] = await Promise.all([
      entry.repo ? github.fetchRepoSignals(entry.repo, { force }) : Promise.resolve(emptyGithub(entry)),
      entry.npmName
        ? npm.fetchNpmSignals(entry.npmName, { force, hostVersion: resolveHostVersion() })
        : Promise.resolve(emptyNpm(entry)),
    ]);
    const recovered = await recoverMismatchedNpm(entry, pack, force);
    return toPlugin(recovered.entry, gh, recovered.pack);
  }

  function publish(next) {
    memory = next;
    persistSnapshot(snapshotPath, memory);
    return { plugins: next.plugins, fetchedAt: next.fetchedAt, stale: next.stale, expired: next.expired, errors: next.errors };
  }

  async function doRefresh({ force = false, waitForSignals } = {}) {
    const errors = [];
    const collected = [];
    let stale = false;
    for (const source of sources) {
      const loaded = await loadSource(source, force);
      collected.push(...loaded.entries);
      errors.push(...loaded.errors);
      stale = stale || loaded.stale;
    }

    const fetchedAt = new Date((typeof now === "function" ? now() : Date.now())).toISOString();
    if (!collected.length) {
      const fatal = errors.length ? errors : [{ error: "all catalog sources returned 0 entries" }];
      if (memory?.plugins?.length) {
        return {
          plugins: memory.plugins,
          fetchedAt: memory.fetchedAt,
          stale: true,
          expired: true,
          errors: fatal,
        };
      }
      return publish({ plugins: [], fetchedAt, stale: true, expired: false, errors: fatal });
    }

    const metricsLoaded = await loadMetrics(force);
    stale = stale || metricsLoaded.stale;
    const merged = applyDirectoryMetrics(mergeCatalogEntries(collected), metricsLoaded.metrics);
    lastMerged = merged;
    const bare = merged.map((entry) => toPlugin(entry, emptyGithub(entry), emptyNpm(entry)));
    const listed = publish({ plugins: bare, fetchedAt, stale, expired: false, errors });

    if (!enrichSignals) return listed;
    if (waitForSignals === false) return listed;

    const plugins = await mapPool(merged, concurrency, (entry) => enrich(entry, force));
    return publish({ plugins, fetchedAt, stale, expired: false, errors });
  }

  async function refreshCatalog(options = {}) {
    const force = Boolean(options.force);
    if (inflight && !force) return inflight;
    const run = doRefresh(options);
    inflight = run;
    try {
      return await run;
    } finally {
      if (inflight === run) inflight = null;
    }
  }

  function listPlugins() {
    return memory?.plugins ? [...memory.plugins] : [];
  }

  function getPlugin(stableId) {
    return listPlugins().find((item) => item.stableId === stableId) || null;
  }

  function pluginToEntry(plugin) {
    const stored = lastMerged.find((item) => item.stableId === plugin.stableId);
    const base = stored || {
      stableId: plugin.stableId,
      displayName: plugin.displayName,
      name: plugin.displayName,
      npmName: plugin.npmName,
      description: plugin.description,
      repo: plugin.repo,
      repoUrl: plugin.repo?.url,
      inAwesomeDeepseekHarness: plugin.community?.inAwesomeDeepseekHarness,
      inAwesomeDshPlugin: plugin.community?.inAwesomeDshPlugin,
      stars: plugin.community?.stars,
      downloads: plugin.community?.npmDownloads,
      metricsCheckedAt: plugin.maintenance?.lastCheckedAt,
    };
    return {
      ...base,
      description: plugin.description || base.description,
      longDescription: plugin.longDescription || base.longDescription,
      descriptionZh: plugin.descriptionZh ?? base.descriptionZh,
      descriptionSource: plugin.descriptionSource || base.descriptionSource,
      detailFetchedAt: plugin.detailFetchedAt || base.detailFetchedAt,
      missingZh: plugin.missingZh ?? base.missingZh,
      about: plugin.about || base.about,
      repo: plugin.repo || base.repo,
    };
  }

  async function enrichSignalsFor(ids, { force = false } = {}) {
    const want = new Set((ids || []).map((id) => String(id || "")).filter(Boolean));
    if (!want.size || !memory?.plugins?.length) return listPlugins();
    const next = [...memory.plugins];
    const targets = next.filter((plugin) => want.has(plugin.stableId));
    if (!targets.length) return listPlugins();
    await mapPool(targets, Math.min(concurrency, 4), async (plugin) => {
      let entry = pluginToEntry(plugin);
      entry = await enrichDescriptionFromYml(entry);
      const enriched = enrichSignals
        ? await enrich(entry, force)
        : toPlugin(entry, emptyGithub(entry), emptyNpm(entry));
      if (enriched.community.stars == null && plugin.community?.stars != null) {
        enriched.community.stars = plugin.community.stars;
      }
      if (enriched.community.npmDownloads == null && plugin.community?.npmDownloads != null) {
        enriched.community.npmDownloads = plugin.community.npmDownloads;
      }
      if (plugin.longDescription && !enriched.longDescription) {
        enriched.longDescription = plugin.longDescription;
        enriched.descriptionZh = plugin.descriptionZh;
        enriched.descriptionSource = plugin.descriptionSource;
        enriched.detailFetchedAt = plugin.detailFetchedAt;
        enriched.missingZh = plugin.missingZh;
      }
      if (plugin.about && !enriched.about) enriched.about = plugin.about;
      const index = next.findIndex((row) => row.stableId === plugin.stableId);
      if (index >= 0) next[index] = enriched;
    });
    return publish({
      ...memory,
      plugins: next,
    }).plugins;
  }

  async function enrichDetailsFor(ids, { force = false } = {}) {
    const want = new Set((ids || []).map((id) => String(id || "")).filter(Boolean));
    if (!want.size || !memory?.plugins?.length) return listPlugins();
    const next = [...memory.plugins];
    const targets = next.filter((plugin) => want.has(plugin.stableId));
    if (!targets.length) return listPlugins();
    await mapPool(targets, 1, async (plugin) => {
      const entry = pluginToEntry(plugin);
      let detail;
      try {
        detail = await fetchDetailDescription(entry, {
          fetcher,
          translateFn,
          fetchFn,
          about: plugin.about || entry.about,
          fileUrls: githubFileUrls,
          force,
          now,
        });
      } catch {
        return;
      }
      let merged = mergeDetail(plugin, detail);
      if (detail.npmName && detail.npmName !== plugin.npmName) {
        try {
          const entryWithIdentity = pluginToEntry(merged);
          const pack = await npm.fetchNpmSignals(detail.npmName, {
            force: true,
            hostVersion: resolveHostVersion(),
          });
          merged = {
            ...merged,
            npmName: detail.npmName,
            community: {
              ...merged.community,
              npmDownloads: pack.downloads,
            },
            maintenance: {
              ...merged.maintenance,
              lastVersionAt: pack.lastVersionAt,
              latestVersion: pack.latestVersion,
              deprecated: pack.deprecated,
              lastCheckedAt: pack.lastCheckedAt || merged.maintenance?.lastCheckedAt,
            },
            supplyChain: {
              exactVersion: pack.exactVersion,
              integrity: pack.integrity,
              repoIdentity: pack.repoIdentity || merged.repo,
              changes: supplyChanges(entryWithIdentity, emptyGithub(entryWithIdentity), pack),
            },
            stale: Boolean(merged.stale || pack.stale),
            expired: Boolean(merged.expired || pack.expired),
          };
        } catch {
          /* keep the repository-derived npm identity even if npm is offline */
        }
      }
      const index = next.findIndex((row) => row.stableId === plugin.stableId);
      if (index >= 0) next[index] = merged;
    });
    return publish({
      ...memory,
      plugins: next,
    }).plugins;
  }

  function getCatalogStatus() {
    return {
      fetchedAt: memory?.fetchedAt || null,
      stale: Boolean(memory?.stale),
      expired: Boolean(memory?.expired),
      errors: memory?.errors ? [...memory.errors] : [],
      count: memory?.plugins?.length || 0,
    };
  }

  async function resolveInstallPin(query, options = {}) {
    return npm.resolveInstallPin(query, {
      ...options,
      hostVersion: options.hostVersion || resolveHostVersion(options),
    });
  }

  return {
    refreshCatalog,
    listPlugins,
    getPlugin,
    getCatalogStatus,
    resolveInstallPin,
    enrichSignalsFor,
    enrichDetailsFor,
    fetcher,
  };
}

let configured = null;

function configureCatalog(options) {
  configured = createCatalog(options);
  return configured;
}

function activeCatalog(options) {
  if (options?.cacheDir) {
    configured = createCatalog(options);
    return configured;
  }
  return configured;
}

async function refreshCatalog(options = {}) {
  const catalog = activeCatalog(options);
  if (!catalog) {
    return {
      plugins: [],
      fetchedAt: new Date().toISOString(),
      stale: true,
      errors: [{ error: "configureCatalog({ cacheDir }) or pass cacheDir" }],
    };
  }
  return catalog.refreshCatalog(options);
}

function listPlugins() {
  return configured ? configured.listPlugins() : [];
}

function getPlugin(stableId) {
  return configured ? configured.getPlugin(stableId) : null;
}

function getCatalogStatus() {
  if (!configured) {
    return {
      fetchedAt: null,
      stale: true,
      expired: false,
      errors: [{ error: "configureCatalog({ cacheDir }) first" }],
      count: 0,
    };
  }
  return configured.getCatalogStatus();
}

async function enrichSignalsFor(ids, options) {
  if (!configured) return [];
  return configured.enrichSignalsFor(ids, options);
}

async function enrichDetailsFor(ids, options) {
  if (!configured) return [];
  return configured.enrichDetailsFor(ids, options);
}

async function resolveInstallPin(query, options) {
  if (!configured) {
    return {
      exactVersion: null,
      integrity: null,
      repoIdentity: null,
      deprecated: false,
      lastCheckedAt: null,
      stale: true,
      expired: false,
      error: "configureCatalog({ cacheDir }) first",
    };
  }
  return configured.resolveInstallPin(query, options);
}

module.exports = {
  createCatalog,
  configureCatalog,
  refreshCatalog,
  listPlugins,
  getPlugin,
  getCatalogStatus,
  resolveInstallPin,
  enrichSignalsFor,
  enrichDetailsFor,
  DEFAULT_SOURCES,
  DEFAULT_METRIC_SOURCES,
  SOURCE_AWESOME_DEEPSEEK_HARNESS,
  SOURCE_AWESOME_DSH_PLUGIN,
  githubReadmeUrls,
  githubFileUrls,
  parseAwesomeMarkdown,
  parseCatalogJson,
  parseMetricsJson,
  applyDirectoryMetrics,
  mergeCatalogEntries,
};
