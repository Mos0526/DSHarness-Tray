"use strict";

const { normalizeNpmName, isLikelyNpmName, parseRepoIdentity, sameRepoIdentity } = require("./stable-id");

/**
 * Common monorepo locations for a DSH plugin when the catalog only has
 * the host repository (for example tt-a1i/archify).
 */
const DSH_PLUGIN_PACKAGE_PATHS = Object.freeze([
  "integrations/deepseek-harness/package.json",
  "integrations/dsh/package.json",
  "packages/dsh-plugin/package.json",
  "plugin/package.json",
]);

function looksLikeDshPluginManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return false;
  if (manifest.dsh && typeof manifest.dsh === "object") return true;
  const name = normalizeNpmName(manifest.name);
  return /(?:^|\/)(?:dsh-|.*-dsh)$/.test(name) || name.includes("dsh-plugin");
}

function pluginPackageJsonPaths(repo) {
  const directory = repo?.directory
    ? `${String(repo.directory).replace(/^\/+|\/+$/g, "")}/package.json`
    : "";
  const paths = [];
  if (directory) paths.push(directory);
  if (!directory) paths.push(...DSH_PLUGIN_PACKAGE_PATHS);
  paths.push("package.json");
  return [...new Set(paths)];
}

function guessedPluginNpmNames(repo) {
  const owner = String(repo?.owner || "").trim();
  const name = String(repo?.repo || repo?.name || "").trim();
  if (!owner || !name) return [];
  return [`@${owner}/${name}-dsh`, `@${owner}/${name}`]
    .map((item) => normalizeNpmName(item))
    .filter((item) => isLikelyNpmName(item));
}

function manifestMatchesRepo(manifest, repo) {
  if (!repo?.owner || !repo?.repo) return false;
  const raw = manifest?.repository?.url || manifest?.repository || manifest?.homepage;
  const parsed = parseRepoIdentity(typeof raw === "string" ? raw : raw?.url);
  if (!parsed) return false;
  return sameRepoIdentity(
    { host: repo.host || "github.com", owner: repo.owner, repo: repo.repo, directory: null },
    { ...parsed, directory: null },
  );
}

function pickPluginManifest(candidates, repo) {
  const list = (Array.isArray(candidates) ? candidates : []).filter((item) => item?.manifest?.name);
  const plugins = list.filter((item) => looksLikeDshPluginManifest(item.manifest));
  const matchingPlugin = plugins.find((item) => !repo || manifestMatchesRepo(item.manifest, repo) || !item.manifest.repository);
  return matchingPlugin
    || plugins[0]
    || list.find((item) => repo && manifestMatchesRepo(item.manifest, repo))
    || list[0]
    || null;
}

module.exports = {
  DSH_PLUGIN_PACKAGE_PATHS,
  guessedPluginNpmNames,
  looksLikeDshPluginManifest,
  manifestMatchesRepo,
  pickPluginManifest,
  pluginPackageJsonPaths,
};
