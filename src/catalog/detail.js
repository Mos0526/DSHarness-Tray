"use strict";

const {
  hasCjk,
  stripZhMissing,
  ZH_MISSING_MARK,
  parsePluginYml,
  pluginYmlUrls,
  pluginReadmeUrls,
  extractReadmeLead,
  looksLikeIntro,
  preferDescription,
} = require("./descriptions");
const { translateToZh } = require("./translate");
const { pickPluginManifest, pluginPackageJsonPaths } = require("../identity/plugin-package");

const MIN_LONG_ZH = 40;

function emptyDetail(partial = {}) {
  return {
    longDescription: partial.longDescription || "",
    descriptionZh: Boolean(partial.descriptionZh),
    descriptionSource: partial.descriptionSource || "",
    detailFetchedAt: partial.detailFetchedAt || null,
    missingZh: Boolean(partial.missingZh),
    about: partial.about || "",
    npmName: partial.npmName || "",
    packageVersion: partial.packageVersion || "",
  };
}

function alreadyCached(entry) {
  const text = stripZhMissing(entry?.longDescription);
  if (!entry?.detailFetchedAt || !looksLikeIntro(text)) return false;
  if (text.length > 900) return false;
  const paras = text.split(/\n{2,}/).filter(Boolean);
  if (paras.length > 2) return false;
  return hasCjk(text) ? text.length >= MIN_LONG_ZH : true;
}

async function firstBody(urls, fetcher) {
  for (const url of urls || []) {
    try {
      const result = await fetcher.get(url);
      if (result?.body && String(result.body).trim()) return String(result.body);
    } catch {
      /* try next mirror */
    }
  }
  return "";
}

function pluginPackageJsonUrls(repo, fileUrls) {
  if (!repo?.owner || !repo?.repo || typeof fileUrls !== "function") return [];
  return pluginPackageJsonPaths(repo).flatMap((path) => [
    ...fileUrls(repo.owner, repo.repo, path, "main"),
    ...fileUrls(repo.owner, repo.repo, path, "master"),
  ]);
}

async function fetchRepositoryPackageIdentity(entry, { fetcher, fileUrls } = {}) {
  if (!fetcher || !entry?.repo) return { npmName: "", packageVersion: "" };
  const candidates = [];
  for (const url of pluginPackageJsonUrls(entry.repo, fileUrls)) {
    try {
      const result = await fetcher.get(url);
      if (!result?.body) continue;
      const manifest = JSON.parse(result.body);
      if (typeof manifest?.name === "string" && manifest.name.trim()) {
        candidates.push({ manifest, url });
      }
    } catch {
      /* try the next branch / mirror */
    }
  }
  const picked = pickPluginManifest(candidates, entry.repo);
  if (!picked) return { npmName: "", packageVersion: "" };
  return {
    npmName: picked.manifest.name.trim().toLowerCase(),
    packageVersion: String(picked.manifest.version || ""),
  };
}

async function collectCandidates(entry, { fetcher, about, fileUrls } = {}) {
  const repo = entry?.repo || null;
  const catalogText = stripZhMissing(entry?.description || entry?.longDescription || "");
  const candidates = [];
  if (catalogText) {
    candidates.push({
      text: catalogText,
      zh: hasCjk(catalogText),
      source: "catalog",
    });
  }
  if (about && String(about).trim()) {
    candidates.push({
      text: String(about).trim(),
      zh: hasCjk(about),
      source: "about",
    });
  }

  if (fetcher && repo) {
    const ymlUrls = pluginYmlUrls(repo, fileUrls);
    const ymlBody = await firstBody(ymlUrls, fetcher);
    if (ymlBody) {
      const parsed = parsePluginYml(ymlBody);
      if (parsed.descriptionZh) {
        candidates.push({ text: parsed.descriptionZh, zh: true, source: "yml" });
      }
      if (parsed.descriptionEn) {
        candidates.push({ text: parsed.descriptionEn, zh: hasCjk(parsed.descriptionEn), source: "yml-en" });
      }
    }

    const readme = pluginReadmeUrls(repo, fileUrls);
    const zhMd = await firstBody(readme.zh, fetcher);
    const zhLead = extractReadmeLead(zhMd);
    if (zhLead) candidates.push({ text: zhLead, zh: hasCjk(zhLead), source: "readme-zh" });

    const enMd = await firstBody(readme.en, fetcher);
    const enLead = extractReadmeLead(enMd);
    if (enLead) candidates.push({ text: enLead, zh: hasCjk(enLead), source: "readme" });
  }

  return candidates;
}

function chooseBest(candidates) {
  const zh = candidates.filter((item) => item.zh).sort((a, b) => b.text.length - a.text.length);
  const en = candidates.filter((item) => !item.zh).sort((a, b) => {
    const rank = (item) => (item.source.startsWith("readme") || item.source === "about" ? 1 : 0);
    if (rank(a) !== rank(b)) return rank(b) - rank(a);
    return b.text.length - a.text.length;
  });
  return { zh: zh[0] || null, en: en[0] || null };
}

/**
 * Fetch a longer description for one catalog entry, then translate if needed.
 * Cache hits (detailFetchedAt + long text) skip the network.
 */
async function fetchDetailDescription(entry, {
  fetcher,
  translateFn,
  fetchFn,
  about,
  fileUrls,
  force = false,
  now = Date.now(),
} = {}) {
  const packageIdentity = await fetchRepositoryPackageIdentity(entry, { fetcher, fileUrls });
  if (!force && alreadyCached(entry)) {
    return emptyDetail({
      ...packageIdentity,
      longDescription: entry.longDescription,
      descriptionZh: hasCjk(entry.longDescription),
      descriptionSource: entry.descriptionSource || "cache",
      detailFetchedAt: entry.detailFetchedAt,
      missingZh: !hasCjk(entry.longDescription),
      about: entry.about || about || "",
    });
  }

  let candidates = [];
  try {
    candidates = await collectCandidates(entry, { fetcher, about: about || entry.about, fileUrls });
  } catch {
    candidates = [];
  }

  const { zh, en } = chooseBest(candidates);
  const fetchedAt = typeof now === "function" ? now() : now;

  if (zh && (zh.text.length >= MIN_LONG_ZH || !en || zh.text.length >= Math.floor((en.text.length || 0) * 0.4))) {
    return emptyDetail({
      ...packageIdentity,
      longDescription: zh.text,
      descriptionZh: true,
      descriptionSource: zh.source,
      detailFetchedAt: fetchedAt,
      missingZh: false,
      about: about || entry.about || "",
    });
  }

  const source = en || zh;
  if (!source) {
    return emptyDetail({
      ...packageIdentity,
      longDescription: ZH_MISSING_MARK,
      descriptionZh: false,
      descriptionSource: "none",
      detailFetchedAt: fetchedAt,
      missingZh: true,
      about: about || entry.about || "",
    });
  }

  if (hasCjk(source.text)) {
    return emptyDetail({
      ...packageIdentity,
      longDescription: source.text,
      descriptionZh: true,
      descriptionSource: source.source,
      detailFetchedAt: fetchedAt,
      missingZh: false,
      about: about || entry.about || "",
    });
  }

  const translated = await translateToZh(source.text, { translateFn, fetchFn });
  return emptyDetail({
    ...packageIdentity,
    longDescription: translated.text,
    descriptionZh: translated.zh,
    descriptionSource: translated.translated ? "translated" : source.source,
    detailFetchedAt: fetchedAt,
    missingZh: translated.missingZh,
    about: about || entry.about || "",
  });
}

function mergeDetail(plugin, detail) {
  const next = { ...plugin };
  if (detail.longDescription) next.longDescription = detail.longDescription;
  next.descriptionZh = Boolean(detail.descriptionZh);
  next.descriptionSource = detail.descriptionSource || next.descriptionSource || "";
  next.detailFetchedAt = detail.detailFetchedAt || next.detailFetchedAt || null;
  next.missingZh = Boolean(detail.missingZh);
  if (detail.about) next.about = detail.about;
  if (detail.npmName) next.npmName = detail.npmName;
  if (detail.packageVersion) next.packageVersion = detail.packageVersion;
  if (detail.descriptionZh && hasCjk(detail.longDescription)) {
    const short = stripZhMissing(next.description);
    if (!hasCjk(short) || (detail.longDescription.length > (short?.length || 0) && detail.longDescription.length <= 160)) {
      next.description = preferDescription(next.description, detail.longDescription);
    }
    next.descriptionZh = true;
  }
  return next;
}

module.exports = {
  MIN_LONG_ZH,
  alreadyCached,
  fetchDetailDescription,
  fetchRepositoryPackageIdentity,
  mergeDetail,
  extractReadmeLead,
  pluginPackageJsonUrls,
};
