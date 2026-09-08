"use strict";

const { join } = require("node:path");
const {
  HOME_KINDS,
  assertHomeKind,
  clearActiveHome,
  configureActiveHome,
  isExternalActiveHome,
  resolveHome,
} = require("../runtime/dsh-paths");

/**
 * Ledger / home paths. `resolveHome`, `HOME_KINDS`, and `assertHomeKind`
 * are owned by `src/runtime/dsh-paths` so both modules share
 * `{root}/homes/{kind}`.
 *
 * Official DSH resolves a single home via $DSH_HOME || ~/.dsh
 * (packages/util/home-paths). Each kind here is a full DSH_HOME with its own
 * profiles/ tree so the same binary can boot safe (no community plugins),
 * active (verified set), staging (temp verify), or quarantine (isolated).
 */

const OFFICIAL_PROFILE_BUNDLES = Object.freeze([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
  "@deepseek-ai/dsh-headless",
]);

function homePath(root, kind) {
  return resolveHome(root, kind);
}

function ledgerRoot(shellDshRoot) {
  return join(shellDshRoot, "ledger");
}

function receiptsDir(shellDshRoot) {
  return join(ledgerRoot(shellDshRoot), "receipts");
}

function walDir(shellDshRoot) {
  return join(ledgerRoot(shellDshRoot), "wal");
}

function lifecyclePath(shellDshRoot) {
  return join(ledgerRoot(shellDshRoot), "lifecycle.json");
}

function homeMetaPath(home) {
  return join(home, ".dsh-shell-home.json");
}

function profileWebDir(home) {
  return join(home, "profiles", "web");
}

function profilePackagePath(home) {
  return join(profileWebDir(home), "package.json");
}

function pluginsStoreDir(home) {
  return join(home, "shell-plugins");
}

function encodePluginId(pluginId) {
  const value = String(pluginId || "");
  if (!value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("invalid plugin id");
  }
  if (value === ".") return "%2E";
  if (value === "..") return "%2E%2E";
  return encodeURIComponent(value);
}

function pluginStorePath(home, pluginId) {
  return join(pluginsStoreDir(home), encodePluginId(pluginId));
}

function isOfficialBundle(name) {
  return OFFICIAL_PROFILE_BUNDLES.includes(String(name));
}

module.exports = {
  HOME_KINDS,
  OFFICIAL_PROFILE_BUNDLES,
  assertHomeKind,
  clearActiveHome,
  configureActiveHome,
  isExternalActiveHome,
  resolveHome,
  homePath,
  ledgerRoot,
  receiptsDir,
  walDir,
  lifecyclePath,
  homeMetaPath,
  profileWebDir,
  profilePackagePath,
  pluginsStoreDir,
  encodePluginId,
  pluginStorePath,
  isOfficialBundle,
};
