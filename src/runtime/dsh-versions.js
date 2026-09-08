"use strict";

const { compareVersions } = require("../install/semver");

function normalizeVersion(text) {
  const match = String(text || "").trim().match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match ? match[0] : "";
}

function pickDshCandidates({ versions, tags, githubVersion, limit = 8 } = {}) {
  const list = Array.isArray(versions) ? versions.map(String) : [];
  const unique = [];
  const push = (version, { publishedOnly = true } = {}) => {
    const normalized = normalizeVersion(version);
    if (!normalized || unique.includes(normalized)) return;
    if (publishedOnly && !list.includes(normalized)) return;
    unique.push(normalized);
  };
  push(githubVersion);
  push(tags?.latest);
  push(tags?.next);
  const newestFirst = list.slice().sort((a, b) => {
    const cmp = compareVersions(b, a);
    return Number.isNaN(cmp) ? 0 : cmp;
  });
  for (const version of newestFirst) push(version);
  return unique.slice(0, Math.max(1, Number(limit) || 8));
}

function dshInstallSpec(version) {
  const clean = normalizeVersion(version);
  return clean ? `@deepseek-ai/dsh@${clean}` : "";
}

function versionIsNewer(candidate, installed) {
  const left = normalizeVersion(candidate);
  const right = normalizeVersion(installed);
  if (!left) return false;
  if (!right) return true;
  const cmp = compareVersions(left, right);
  if (Number.isNaN(cmp)) return left !== right;
  return cmp > 0;
}

function summarizeDshUpdate({ installed, candidates = [], githubVersion = "" } = {}) {
  const latestPublished = normalizeVersion(Array.isArray(candidates) ? candidates[0] : "") || "";
  const github = normalizeVersion(githubVersion);
  const updateAvailable = versionIsNewer(latestPublished, installed);
  return {
    latestPublished,
    githubVersion: github,
    updateAvailable,
    githubUnpublished: versionIsNewer(github, installed)
      && (!latestPublished || versionIsNewer(github, latestPublished)),
  };
}

function parseAtomEntries(xml) {
  return String(xml || "").split(/<entry>/i).slice(1).map((entry) => {
    const title = (entry.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    const updated = (entry.match(/<updated>([^<]*)<\/updated>/i) || [])[1] || "";
    const content = (entry.match(/<content[^>]*>([\s\S]*?)<\/content>/i) || [])[1] || "";
    return {
      title,
      version: normalizeVersion(title),
      updated,
      content,
    };
  });
}

function matchAtomEntry(entries, version) {
  const clean = normalizeVersion(version);
  if (!clean) return null;
  return (Array.isArray(entries) ? entries : []).find((item) => item.version === clean) || null;
}

module.exports = {
  normalizeVersion,
  pickDshCandidates,
  parseAtomEntries,
  matchAtomEntry,
  dshInstallSpec,
  summarizeDshUpdate,
};
