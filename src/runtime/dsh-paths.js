"use strict";

/**
 * Shell-owned DSH install + DSH_HOME layout.
 *
 * Product rule: one exclusive DSH under the shell userData tree. Never
 * resolve or create the user-global `~/.dsh` or `%APPDATA%/npm` DSH.
 *
 * Official DSH (packages/util/home-paths) uses a single `$DSH_HOME` root
 * (default `~/.dsh`) and loads community plugins from
 * `$DSH_HOME/profiles/<name>/`. Safe mode is therefore a *different home*,
 * not a second DSH binary: inject `DSH_HOME` at spawn.
 *
 * WAL / receipt / isolation install live in another task (`src/install`).
 * This module only exports path constants and the contract those modules
 * should honor.
 */

const { existsSync } = require("node:fs");
const { join, resolve } = require("node:path");

const SHELL_DSH_DIRNAME = "dsh";
const CURRENT_INSTALL_DIRNAME = "current";
const HOMES_DIRNAME = "homes";
const STAGING_WORKDIR_DIRNAME = "tmp";
const UPGRADE_STAGING_DIRNAME = "dsh-staging";

const HOME_KINDS = Object.freeze(["safe", "active", "staging", "quarantine"]);
const activeHomeOverrides = new Map();

/**
 * Isolation / ledger contract for the install task.
 * Runtime only injects `DSH_HOME` when spawning; it does not write WAL.
 */
const HOME_ISOLATION_CONTRACT = Object.freeze({
  envVar: "DSH_HOME",
  kinds: HOME_KINDS,
  pluginLayout: "profiles/<profile>/",
  officialDefaultHome: "~/.dsh",
  ledgerOwner: "src/install",
  notes: [
    "safe: never install community plugins; used after DSH upgrade and on crash recover.",
    "active: only combinations that passed host/renderer/combo verification.",
    "staging: short-lived verification home; delete after the run.",
    "quarantine: isolated plugin records / failed generations.",
    "WAL + receipt + rebuild-active-on-uninstall are owned by src/install.",
  ],
});

const DSH_BIN_RELATIVE = Object.freeze([
  ["current", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"],
  ["current", "lib", "bin.js"],
  ["node_modules", "@deepseek-ai", "dsh", "lib", "bin.js"],
  ["lib", "bin.js"],
  ["bin.js"],
  ["current", "bin", "dsh.cmd"],
  ["current", "bin", "dsh"],
  ["bin", "dsh.cmd"],
  ["bin", "dsh"],
  ["dsh.cmd"],
  ["dsh.exe"],
]);

function assertAppData(appData) {
  if (!appData || typeof appData !== "string" || !appData.trim()) {
    throw new Error("appData is required; refuse to fall back to a user-global DSH home");
  }
}

function resolveShellDshRoot(appData) {
  assertAppData(appData);
  return resolve(join(appData, SHELL_DSH_DIRNAME));
}

function resolveCurrentInstall(root) {
  if (!root) throw new Error("root is required");
  return resolve(join(root, CURRENT_INSTALL_DIRNAME));
}

function resolveDshBinary(root, options = {}) {
  if (!root) throw new Error("root is required");
  const base = resolve(root);
  for (const parts of DSH_BIN_RELATIVE) {
    const candidate = join(base, ...parts);
    if (existsSync(candidate)) return candidate;
  }
  const preferred = join(base, ...DSH_BIN_RELATIVE[0]);
  if (options.mustExist) return undefined;
  return preferred;
}

function assertHomeKind(kind) {
  if (!HOME_KINDS.includes(kind)) {
    throw new Error(`unknown DSH_HOME kind: ${kind} (expected ${HOME_KINDS.join("|")})`);
  }
  return kind;
}

function resolveHome(root, kind) {
  if (!root) throw new Error("root is required");
  const base = resolve(root);
  const homeKind = assertHomeKind(kind);
  if (homeKind === "active" && activeHomeOverrides.has(base)) {
    return activeHomeOverrides.get(base);
  }
  return resolve(join(base, HOMES_DIRNAME, homeKind));
}

function configureActiveHome(root, activeHome) {
  if (!root) throw new Error("root is required");
  if (!activeHome) throw new Error("activeHome is required");
  activeHomeOverrides.set(resolve(root), resolve(activeHome));
  return resolve(activeHome);
}

function clearActiveHome(root) {
  if (!root) return;
  activeHomeOverrides.delete(resolve(root));
}

function isExternalActiveHome(root) {
  if (!root) return false;
  return activeHomeOverrides.has(resolve(root));
}

function resolveUpgradeStaging(root) {
  if (!root) throw new Error("root is required");
  return resolve(join(root, STAGING_WORKDIR_DIRNAME, UPGRADE_STAGING_DIRNAME));
}

function isGlobalUserDshPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").toLowerCase();
  if (!normalized) return false;
  if (normalized.endsWith("/.dsh") || normalized.includes("/.dsh/")) return true;
  // main.js currently resolves the system-global install as
  // `%APPDATA%/npm/node_modules/@deepseek-ai/dsh/...` (Roaming, not Local\Temp).
  if (normalized.includes("/npm/node_modules/@deepseek-ai/dsh")) return true;
  if (/(?:^|\/)appdata\/roaming\/npm(?:\/|$)/.test(normalized)) return true;
  return false;
}

module.exports = {
  SHELL_DSH_DIRNAME,
  CURRENT_INSTALL_DIRNAME,
  HOMES_DIRNAME,
  HOME_KINDS,
  HOME_ISOLATION_CONTRACT,
  DSH_BIN_RELATIVE,
  assertHomeKind,
  resolveShellDshRoot,
  resolveCurrentInstall,
  resolveDshBinary,
  resolveHome,
  configureActiveHome,
  clearActiveHome,
  isExternalActiveHome,
  resolveUpgradeStaging,
  isGlobalUserDshPath,
};
