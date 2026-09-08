"use strict";

const {
  parseRepoIdentity,
  normalizeNpmName,
  isLikelyNpmName,
  normalizeSources,
  repoKey,
  sameRepoIdentity,
  stableIdFrom,
} = require("../identity/stable-id");
const { preferDescription } = require("./descriptions");

/**
 * Evidence (fetched 2026-08-24):
 *
 * 0xsline/awesome-deepseek-harness
 *   - README.md: English awesome-list bullets.
 *   - README.zh-CN.md: same plugins, Chinese descriptions.
 *   - CATALOG.md: generated Markdown table with Chinese descriptions:
 *     `| [dsh-context-doctor](https://github.com/Zhenyu98/dsh-context-doctor) | 上下文... |`
 *
 * awesome-dsh-plugin/awesome-dsh-plugin
 *   - README.md: English owner/repo bullets (discovery list).
 *   - data/stars.json + data/downloads.json: URL-keyed community metrics
 *     `{ "https://github.com/0xsline/dsh-spotlight": { "stars": 9, "checkedAt": "2026-08-19" } }`
 *   - data/plugins/*.yml: site metadata with description.zh / description.en.
 *
 * Dual listing is a community-consistency signal only, not a safety score.
 * parseCatalogJson() is for injected snapshots / tests.
 */

const SOURCE_AWESOME_DEEPSEEK_HARNESS = "awesome-deepseek-harness";
const SOURCE_AWESOME_DSH_PLUGIN = "awesome-dsh-plugin";

function githubFileUrls(owner, repo, filePath, branch = "main") {
  const path = String(filePath || "").replace(/^\/+/, "");
  return [
    `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`,
    `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${path}`,
  ];
}

function githubReadmeUrls(owner, repo, branch = "main") {
  return githubFileUrls(owner, repo, "README.md", branch);
}

const DEFAULT_LISTING_SOURCES = Object.freeze([
  {
    id: SOURCE_AWESOME_DEEPSEEK_HARNESS,
    urls: githubFileUrls("0xsline", "awesome-deepseek-harness", "README.md"),
  },
  {
    id: SOURCE_AWESOME_DEEPSEEK_HARNESS,
    urls: githubFileUrls("0xsline", "awesome-deepseek-harness", "README.zh-CN.md"),
  },
  {
    id: SOURCE_AWESOME_DEEPSEEK_HARNESS,
    urls: githubFileUrls("0xsline", "awesome-deepseek-harness", "CATALOG.md"),
  },
  {
    id: SOURCE_AWESOME_DSH_PLUGIN,
    urls: githubFileUrls("awesome-dsh-plugin", "awesome-dsh-plugin", "README.md"),
  },
]);

const DEFAULT_METRIC_SOURCES = Object.freeze([
  {
    kind: "stars",
    urls: githubFileUrls("awesome-dsh-plugin", "awesome-dsh-plugin", "data/stars.json"),
  },
  {
    kind: "downloads",
    urls: githubFileUrls("awesome-dsh-plugin", "awesome-dsh-plugin", "data/downloads.json"),
  },
]);

const SOURCE_IDS = Object.freeze({
  awesomeDeepseekHarness: SOURCE_AWESOME_DEEPSEEK_HARNESS,
  awesomeDshPlugin: SOURCE_AWESOME_DSH_PLUGIN,
});

const SKIP_HEADINGS = /^(contents|install|contributing|disclaimer|badge|thanks|related|license|致谢|目录|安装)\b/i;
const GENERIC_FRAGMENTS = new Set(["bundle", "npm", "plugin", "readme", "src", "main", "head", "packages"]);

const LIST_ITEM = /^\s*[-*+]\s+\[([^\]]+)\]\(([^)]+)\)(?:\s*[-–—:]\s*(.*))?$/;
const TABLE_ROW = /^\|?\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|?\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{3,}/;
const NPM_IN_TEXT = /(?:npm:\s*|ships on npm as\s*|dsh plugin(?:\s+--profile\s+\w+)?\s+add\s+)[`'"]?(@?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?)[`'"]?/i;

function stripCodeFences(md) {
  return String(md || "").replace(/```[\s\S]*?```/g, "\n");
}

function cleanDescription(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—:]\s*/, "")
    .trim();
}

function headingName(line) {
  const match = String(line || "").match(/^\s{0,3}#{1,6}\s+(.+)$/);
  return match ? match[1].replace(/[#*`]/g, "").trim() : "";
}

function extractNpmFromText(text) {
  const match = String(text || "").match(NPM_IN_TEXT);
  if (!match) return "";
  const name = normalizeNpmName(match[1]);
  return isLikelyNpmName(name) ? name : "";
}

function inferNpmName({ name, repoUrl, description }) {
  const fromDesc = extractNpmFromText(description);
  if (fromDesc) return fromDesc;

  const link = String(name || "").trim();
  const hash = link.match(/#([^#]+)$/);
  const fragment = hash ? hash[1].trim() : "";
  const withoutHash = hash ? link.slice(0, hash.index) : link;

  if (fragment && isLikelyNpmName(fragment) && !GENERIC_FRAGMENTS.has(fragment.toLowerCase())) {
    return normalizeNpmName(fragment);
  }

  if (isLikelyNpmName(withoutHash) && !withoutHash.includes("/")) {
    return normalizeNpmName(withoutHash);
  }

  const ownerRepo = withoutHash.match(/^([^/]+)\/([^/]+)$/);
  if (ownerRepo && isLikelyNpmName(ownerRepo[2])) {
    return normalizeNpmName(ownerRepo[2]);
  }

  const repo = parseRepoIdentity(repoUrl);
  if (repo && isLikelyNpmName(repo.repo)) return normalizeNpmName(repo.repo);
  return "";
}

function normalizeEntry(raw, sourceId) {
  const repoUrl = String(raw.repoUrl || raw.url || "").trim();
  const repo = parseRepoIdentity(repoUrl);
  const name = String(raw.name || raw.displayName || "").trim();
  const description = cleanDescription(raw.description);
  const npmName = normalizeNpmName(raw.npmName) || inferNpmName({ name, repoUrl, description });
  const sources = normalizeSources([...(raw.sourceIds || raw.sources || []), sourceId]);
  const displayName = name || repo?.repo || npmName || repoUrl;
  return {
    name: displayName,
    displayName,
    npmName,
    repoUrl: repo?.url || repoUrl,
    description,
    sourceIds: sources,
    repo: repo || null,
  };
}

function shouldSkipUrl(href) {
  if (!href) return true;
  const url = String(href).trim();
  if (!url || url.startsWith("#")) return true;
  if (/^mailto:/i.test(url)) return true;
  if (!/^https?:/i.test(url) && !/^(github|gitlab):/i.test(url) && !/^git@/i.test(url)) return true;
  return !parseRepoIdentity(url);
}

function parseAwesomeMarkdown(md, sourceId) {
  if (!sourceId) throw new Error("parseAwesomeMarkdown requires sourceId");
  const entries = [];
  let skipSection = false;
  for (const line of stripCodeFences(md).split(/\r?\n/)) {
    const heading = headingName(line);
    if (heading) {
      skipSection = SKIP_HEADINGS.test(heading);
      continue;
    }
    if (skipSection || TABLE_SEP.test(line)) continue;

    const list = line.match(LIST_ITEM);
    const table = !list && line.match(TABLE_ROW);
    const hit = list || table;
    if (!hit) continue;
    const name = hit[1].trim();
    const href = hit[2].trim();
    const description = cleanDescription(hit[3] || "");
    if (shouldSkipUrl(href)) continue;
    entries.push(normalizeEntry({ name, repoUrl: href, description }, sourceId));
  }
  return entries;
}

function parseCatalogJson(json, sourceId) {
  if (!sourceId) throw new Error("parseCatalogJson requires sourceId");
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const list = Array.isArray(data) ? data : data?.plugins || data?.entries || [];
  return list.map((item) => normalizeEntry(item, sourceId));
}

function mergeKey(entry) {
  if (entry.repo) return `repo:${repoKey(entry.repo)}`;
  if (entry.npmName) return `npm:${entry.npmName}`;
  return `name:${String(entry.name || "").toLowerCase()}`;
}

function asFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMetricsJson(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const map = new Map();
  if (!data || typeof data !== "object" || Array.isArray(data)) return map;
  for (const [url, rec] of Object.entries(data)) {
    const repo = parseRepoIdentity(url);
    if (!repo) continue;
    const stars = asFiniteNumber(rec?.stars ?? rec?.stargazers_count);
    const downloads = asFiniteNumber(rec?.downloads ?? rec?.npmDownloads);
    const checkedAt = rec?.checkedAt || rec?.fetchedAt || null;
    const next = { stars, downloads, checkedAt };
    const key = repoKey(repo);
    const prev = map.get(key) || {};
    map.set(key, {
      stars: next.stars ?? prev.stars ?? null,
      downloads: next.downloads ?? prev.downloads ?? null,
      checkedAt: next.checkedAt || prev.checkedAt || null,
    });
    if (repo.directory) {
      const base = repoKey({ ...repo, directory: null });
      if (!map.has(base)) map.set(base, map.get(key));
    }
  }
  return map;
}

function mergeMetricMaps(...maps) {
  const out = new Map();
  for (const map of maps) {
    if (!map) continue;
    for (const [key, value] of map) {
      const prev = out.get(key) || {};
      out.set(key, {
        stars: value.stars ?? prev.stars ?? null,
        downloads: value.downloads ?? prev.downloads ?? null,
        checkedAt: value.checkedAt || prev.checkedAt || null,
      });
    }
  }
  return out;
}

function lookupDirectoryMetrics(metrics, repo) {
  if (!metrics || !repo) return null;
  const exact = metrics.get(repoKey(repo));
  if (exact) return exact;
  if (repo.directory) return metrics.get(repoKey({ ...repo, directory: null })) || null;
  return null;
}

function applyDirectoryMetrics(entries, metrics) {
  if (!metrics || !metrics.size) return entries || [];
  return (entries || []).map((entry) => {
    const hit = lookupDirectoryMetrics(metrics, entry.repo || parseRepoIdentity(entry.repoUrl));
    if (!hit) return entry;
    return {
      ...entry,
      stars: hit.stars ?? entry.stars ?? null,
      downloads: hit.downloads ?? entry.downloads ?? null,
      metricsCheckedAt: hit.checkedAt || entry.metricsCheckedAt || null,
    };
  });
}

function preferNpmName(current, incoming) {
  if (!current) return incoming || "";
  if (!incoming) return current;
  if (current.startsWith("@") && !incoming.startsWith("@")) return current;
  if (incoming.startsWith("@") && !current.startsWith("@")) return incoming;
  return current;
}

function mergeCatalogEntries(entries) {
  const groups = new Map();
  for (const raw of entries || []) {
    const entry = {
      ...raw,
      sourceIds: normalizeSources(raw.sourceIds || raw.sources),
      npmName: normalizeNpmName(raw.npmName),
      repo: raw.repo || parseRepoIdentity(raw.repoUrl),
    };
    if (entry.repo && !entry.repoUrl) entry.repoUrl = entry.repo.url;
    const key = mergeKey(entry);
    if (!groups.has(key)) {
      groups.set(key, { ...entry, sourceIds: [...entry.sourceIds], conflicts: [] });
      continue;
    }
    const dest = groups.get(key);
    const nextNpm = preferNpmName(dest.npmName, entry.npmName);
    if (dest.npmName && entry.npmName && dest.npmName !== entry.npmName) {
      dest.conflicts.push({ field: "npmName", values: [dest.npmName, entry.npmName] });
    }
    if (dest.repo && entry.repo && !sameRepoIdentity(dest.repo, entry.repo)) {
      dest.conflicts.push({ field: "repo", values: [dest.repoUrl, entry.repoUrl] });
    }
    dest.npmName = nextNpm;
    dest.name = dest.name || entry.name;
    dest.displayName = dest.displayName || entry.displayName || dest.name;
    dest.description = preferDescription(dest.description, entry.description);
    dest.repo = dest.repo || entry.repo;
    dest.repoUrl = dest.repoUrl || entry.repoUrl;
    dest.stars = dest.stars ?? entry.stars ?? null;
    dest.downloads = dest.downloads ?? entry.downloads ?? null;
    dest.metricsCheckedAt = dest.metricsCheckedAt || entry.metricsCheckedAt || null;
    dest.sourceIds = normalizeSources([...dest.sourceIds, ...entry.sourceIds]);
  }

  return [...groups.values()].map((entry) => {
    const sourceIds = normalizeSources(entry.sourceIds);
    return {
      name: entry.displayName || entry.name,
      displayName: entry.displayName || entry.name,
      npmName: entry.npmName || "",
      repoUrl: entry.repoUrl || entry.repo?.url || "",
      description: entry.description || "",
      stars: entry.stars ?? null,
      downloads: entry.downloads ?? null,
      metricsCheckedAt: entry.metricsCheckedAt || null,
      sourceIds,
      repo: entry.repo || null,
      conflicts: entry.conflicts || [],
      inAwesomeDeepseekHarness: sourceIds.includes(SOURCE_AWESOME_DEEPSEEK_HARNESS),
      inAwesomeDshPlugin: sourceIds.includes(SOURCE_AWESOME_DSH_PLUGIN),
      stableId: stableIdFrom({
        npmName: entry.npmName,
        repoUrl: entry.repo || entry.repoUrl,
        sources: sourceIds,
      }),
    };
  });
}

module.exports = {
  SOURCE_IDS,
  SOURCE_AWESOME_DEEPSEEK_HARNESS,
  SOURCE_AWESOME_DSH_PLUGIN,
  DEFAULT_LISTING_SOURCES,
  DEFAULT_METRIC_SOURCES,
  githubFileUrls,
  githubReadmeUrls,
  parseAwesomeMarkdown,
  parseCatalogJson,
  parseMetricsJson,
  mergeMetricMaps,
  applyDirectoryMetrics,
  lookupDirectoryMetrics,
  mergeCatalogEntries,
  inferNpmName,
  normalizeEntry,
};
