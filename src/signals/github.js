"use strict";

const { parseRepoIdentity, sameRepoIdentity } = require("../identity/stable-id");

/**
 * Evidence (GET https://api.github.com/repos/0xsline/dsh-spotlight, 2026-08-24):
 * {
 *   "id": 1333136466,
 *   "full_name": "0xsline/dsh-spotlight",
 *   "html_url": "https://github.com/0xsline/dsh-spotlight",
 *   "stargazers_count": 10,
 *   "archived": false,
 *   "pushed_at": "2026-08-14T10:40:39Z"
 * }
 * `pushed_at` is used as the repository update signal. A separate commits
 * request remains available for callers that explicitly need commit precision,
 * but the catalog does not spend a second unauthenticated API request per row.
 * ETag / 304 and 403/429 rate-limit handled by createCachedFetcher.
 */

const DEFAULT_API_BASE = "https://api.github.com";
const DEFAULT_MIRROR_BASE = "https://ungh.cc";
const DEFAULT_UA = "dsh-tray-catalog/1.0 (+https://github.com/0xsline/awesome-deepseek-harness)";

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": DEFAULT_UA,
  };
}

function identityFrom(input) {
  if (!input) return null;
  if (typeof input === "string") return parseRepoIdentity(input);
  if (input.owner && input.repo) {
    return {
      host: input.host || "github.com",
      owner: input.owner,
      repo: input.repo,
      directory: input.directory || null,
      url: input.url || `https://${input.host || "github.com"}/${input.owner}/${input.repo}`,
      id: input.id ?? null,
    };
  }
  return parseRepoIdentity(input.url || input.repoUrl);
}

function emptySignals(identity, extra = {}) {
  return {
    stars: null,
    archived: null,
    pushedAt: null,
    lastCommitAt: null,
    about: extra.about || null,
    repoId: identity?.id ?? null,
    repoIdentity: identity,
    stale: Boolean(extra.stale),
    expired: Boolean(extra.expired),
    lastCheckedAt: extra.lastCheckedAt || null,
    error: extra.error || "",
  };
}

function createGithubSignals({ fetcher, apiBase = DEFAULT_API_BASE, mirrorBase = DEFAULT_MIRROR_BASE } = {}) {
  if (!fetcher?.getJson) throw new Error("createGithubSignals requires a cached fetcher");

  async function fetchRepoFromMirror(repo, options = {}) {
    if (!mirrorBase) return null;
    const url = `${mirrorBase.replace(/\/$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    const result = await fetcher.getJson(url, {
      ...options,
      headers: { Accept: "application/json", "User-Agent": DEFAULT_UA, ...(options.headers || {}) },
    });
    const data = result.json?.repo && typeof result.json.repo === "object" ? result.json.repo : result.json;
    if (!data || typeof data !== "object") return null;
    const stars = Number.isFinite(data.stars) ? data.stars : (Number.isFinite(data.stargazers) ? data.stargazers : null);
    if (stars == null && data.archived == null && !data.pushedAt && !data.pushed_at) return null;
    return {
      stars,
      archived: Boolean(data.archived),
      pushedAt: data.pushedAt || data.pushed_at || null,
      lastCommitAt: data.pushedAt || data.pushed_at || null,
      about: typeof data.description === "string" ? data.description : (data.about || null),
      repoId: data.id ?? null,
      repoIdentity: repo,
      stale: Boolean(result.stale),
      expired: Boolean(result.expired),
      lastCheckedAt: result.lastCheckedAt || null,
      error: result.error || "",
    };
  }

  async function fetchRepo(identity, options = {}) {
    const repo = identityFrom(identity);
    if (!repo || repo.host !== "github.com") {
      return emptySignals(repo, { stale: true, error: "unsupported repo host" });
    }
    const url = `${apiBase.replace(/\/$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`;
    const result = await fetcher.getJson(url, { ...options, headers: { ...githubHeaders(), ...(options.headers || {}) } });
    const json = result.json;
    const valid = Boolean(json && typeof json === "object" && Number.isFinite(json.stargazers_count));
    if (!valid || result.stale || result.expired || result.error) {
      const mirrored = await fetchRepoFromMirror(repo, options);
      if (mirrored && (!mirrored.stale || !valid)) return mirrored;
    }
    if (!valid) {
      return emptySignals(repo, result);
    }
    const next = {
      ...repo,
      id: json.id ?? repo.id ?? null,
      owner: json.owner?.login || json.full_name?.split("/")[0] || repo.owner,
      repo: json.name || repo.repo,
      url: json.html_url || repo.url,
    };
    return {
      stars: Number.isFinite(json.stargazers_count) ? json.stargazers_count : null,
      archived: Boolean(json.archived),
      pushedAt: json.pushed_at || null,
      lastCommitAt: json.pushed_at || null,
      about: typeof json.description === "string" ? json.description : null,
      repoId: json.id ?? null,
      repoIdentity: next,
      stale: Boolean(result.stale),
      expired: Boolean(result.expired),
      lastCheckedAt: result.lastCheckedAt || null,
      error: result.error || "",
    };
  }

  async function fetchLatestCommit(identity, options = {}) {
    const repo = identityFrom(identity);
    if (!repo || repo.host !== "github.com") return { lastCommitAt: null, stale: true, expired: false, lastCheckedAt: null };
    const url = `${apiBase.replace(/\/$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/commits?per_page=1`;
    const result = await fetcher.getJson(url, { ...options, headers: { ...githubHeaders(), ...(options.headers || {}) } });
    const commit = Array.isArray(result.json) ? result.json[0] : null;
    const lastCommitAt = commit?.commit?.committer?.date || commit?.commit?.author?.date || null;
    return {
      lastCommitAt,
      stale: Boolean(result.stale),
      expired: Boolean(result.expired),
      lastCheckedAt: result.lastCheckedAt || null,
      error: result.error || "",
    };
  }

  async function fetchRepoSignals(identity, options = {}) {
    const repo = await fetchRepo(identity, options);
    if (!repo.repoIdentity || options.includeLatestCommit !== true) return repo;
    const commit = await fetchLatestCommit(repo.repoIdentity, options);
    return {
      ...repo,
      lastCommitAt: commit.lastCommitAt || repo.lastCommitAt,
      stale: Boolean(repo.stale || commit.stale),
      expired: Boolean(repo.expired || commit.expired),
      lastCheckedAt: commit.lastCheckedAt || repo.lastCheckedAt,
      error: repo.error || commit.error || "",
    };
  }

  return {
    fetchRepo,
    fetchLatestCommit,
    fetchRepoSignals,
    sameRepoIdentity,
  };
}

module.exports = {
  createGithubSignals,
  identityFrom,
};
