"use strict";

const RESERVED_OWNERS = new Set([
  "topics",
  "settings",
  "orgs",
  "marketplace",
  "users",
  "about",
  "login",
  "apps",
  "features",
  "pricing",
  "explore",
  "sponsors",
  "notifications",
  "pulls",
  "issues",
  "search",
  "new",
]);

const HOST_ALIASES = {
  github: "github.com",
  gitlab: "gitlab.com",
};

function normalizeNpmName(name) {
  if (name == null) return "";
  return String(name)
    .trim()
    .replace(/^npm:/i, "")
    .replace(/^package:/i, "")
    .toLowerCase();
}

function isLikelyNpmName(name) {
  const npm = normalizeNpmName(name);
  if (!npm || npm.length > 214) return false;
  if (/\s/.test(npm)) return false;
  // Must start with an alphanumeric so CLI flags like --help cannot be
  // forwarded to pnpm add/remove as a package name.
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(npm);
}

function normalizeSources(sources) {
  return [...new Set((sources || []).map((item) => String(item || "").trim()).filter(Boolean))].sort();
}

function stripGitSuffix(name) {
  return String(name || "").replace(/\.git$/i, "");
}

function canonicalRepoUrl(host, owner, repo) {
  return `https://${host}/${owner}/${repo}`;
}

function parseRepoIdentity(url) {
  if (url == null) return null;
  let raw = String(url).trim();
  if (!raw) return null;

  const shorthand = raw.match(/^(github|gitlab):([^/#]+)\/([^#]+)(?:#(.+))?$/i);
  if (shorthand) {
    const host = HOST_ALIASES[shorthand[1].toLowerCase()];
    const owner = shorthand[2];
    const repo = stripGitSuffix(shorthand[3]);
    const directory = shorthand[4] && !/^(readme|head)$/i.test(shorthand[4]) ? shorthand[4] : null;
    if (!host || !owner || !repo || RESERVED_OWNERS.has(owner.toLowerCase())) return null;
    return {
      host,
      owner,
      repo,
      directory,
      url: canonicalRepoUrl(host, owner, repo),
      id: null,
    };
  }

  raw = raw.replace(/^git\+/i, "").replace(/^ssh:\/\//i, "");
  const scp = raw.match(/^git@([^:]+):(.+)$/);
  if (scp) raw = `https://${scp[1]}/${scp[2]}`;

  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!raw.includes("/")) return null;
    raw = `https://${raw.replace(/^\/+/, "")}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (!/(^|\.)github\.com$|(^|\.)gitlab\.com$/.test(host)) return null;

  const parts = parsed.pathname
    .replace(/\.git$/i, "")
    .split("/")
    .filter(Boolean);
  const owner = parts[0];
  const repo = stripGitSuffix(parts[1] || "");
  if (!owner || !repo || RESERVED_OWNERS.has(owner.toLowerCase())) return null;

  let directory = null;
  if (parts[2] === "tree" || parts[2] === "blob" || parts[2] === "raw") {
    const rest = parts.slice(4);
    if (rest.length) directory = rest.join("/");
  }

  return {
    host,
    owner,
    repo,
    directory,
    url: canonicalRepoUrl(host, owner, repo),
    id: null,
  };
}

function repoKey(identity) {
  if (!identity) return "";
  const dir = identity.directory ? `/${identity.directory.replace(/^\/+|\/+$/g, "")}` : "";
  return `${identity.host}/${identity.owner}/${identity.repo}${dir}`.toLowerCase();
}

function sameRepoIdentity(left, right) {
  if (!left || !right) return false;
  if (left.id && right.id && String(left.id) === String(right.id) && (left.directory || "") === (right.directory || "")) {
    return true;
  }
  return repoKey(left) === repoKey(right);
}

function stableIdFrom({ npmName, repoUrl, sources } = {}) {
  const npm = normalizeNpmName(npmName);
  const repo = typeof repoUrl === "object" && repoUrl && repoUrl.owner
    ? {
        host: repoUrl.host || "github.com",
        owner: repoUrl.owner,
        repo: repoUrl.repo,
        directory: repoUrl.directory || null,
      }
    : parseRepoIdentity(repoUrl);
  const parts = [];
  if (npm) parts.push(`npm:${npm}`);
  if (repo) parts.push(`repo:${repoKey(repo)}`);
  if (!npm && !repo) {
    const src = normalizeSources(sources);
    if (src.length) parts.push(`src:${src.join("+")}`);
  }
  return parts.join("|") || "unknown";
}

module.exports = {
  stableIdFrom,
  parseRepoIdentity,
  normalizeNpmName,
  isLikelyNpmName,
  normalizeSources,
  repoKey,
  sameRepoIdentity,
};
