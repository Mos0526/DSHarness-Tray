"use strict";

const { findCompatibleUpdate } = require("./compat");
const { compareVersions } = require("./semver");

function pluginKeys(entry) {
  if (!entry || typeof entry !== "object") return [];
  return [entry.stableId, entry.id, entry.npmName, entry.pluginId, entry.name, entry.displayName]
    .map((value) => (value == null ? "" : String(value)))
    .filter(Boolean);
}

function matchCatalogPlugin(pluginId, catalogPlugins) {
  const id = String(pluginId || "");
  if (!id) return null;
  const list = Array.isArray(catalogPlugins) ? catalogPlugins : [];
  return list.find((entry) => pluginKeys(entry).includes(id)) || null;
}

function catalogLatestVersion(entry) {
  if (!entry || typeof entry !== "object") return "";
  return entry.supplyChain?.exactVersion
    || entry.latestVersion
    || entry.maintenance?.latestVersion
    || entry.exactVersion
    || "";
}

function isNewerVersion(candidate, installed) {
  if (!candidate) return false;
  if (!installed) return true;
  const cmp = compareVersions(candidate, installed);
  if (Number.isNaN(cmp)) return String(candidate) !== String(installed);
  return cmp > 0;
}

function asVersionItem(item) {
  if (typeof item === "string") return { version: item, manifest: {} };
  if (!item || typeof item !== "object") return null;
  const version = item.version || item.exactVersion;
  if (!version) return null;
  return {
    version,
    manifest: item.manifest || item.pluginManifest || {},
    runtime: item.runtime,
    pluginId: item.pluginId,
  };
}

/**
 * Catalog / pin overlay for "is there a newer compatible version".
 * Does not write the install ledger.
 */
function detectUpdateAvailable({
  pluginId,
  installedVersion,
  catalogPlugins,
  dshInfo,
  pin,
} = {}) {
  const entry = matchCatalogPlugin(pluginId, catalogPlugins);
  const latest = pin?.exactVersion || catalogLatestVersion(entry);
  const candidates = [];
  const seen = new Set();
  const push = (item) => {
    const row = asVersionItem(item);
    if (!row || seen.has(row.version) || !isNewerVersion(row.version, installedVersion)) return;
    seen.add(row.version);
    candidates.push(row);
  };
  push(latest);
  for (const item of entry?.availableVersions || []) push(item);
  if (pin?.exactVersion) push(pin);

  const found = findCompatibleUpdate({
    pluginId,
    availableVersions: candidates,
    dshInfo,
  });
  return {
    updateAvailable: Boolean(found),
    availableVersion: found?.version || null,
    catalogEntry: entry,
  };
}

module.exports = {
  matchCatalogPlugin,
  catalogLatestVersion,
  detectUpdateAvailable,
  isNewerVersion,
};
