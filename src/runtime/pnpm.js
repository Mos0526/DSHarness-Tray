"use strict";

const { existsSync } = require("node:fs");
const { delimiter, dirname, join } = require("node:path");

const PNPM_SPEC = "pnpm";

function pnpmShimNames(platform = process.platform) {
  return platform === "win32"
    ? ["pnpm.cmd", "pnpm.exe", "pnpm"]
    : ["pnpm"];
}

function uniquePaths(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item) continue;
    const key = String(item).replace(/\\/g, "/").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Search order matches the tray contract:
 * PATH (`which`), Node dir (corepack), %APPDATA%/npm, private prefix,
 * then the standalone installer at %LOCALAPPDATA%/pnpm.
 */
function pnpmSearchDirs({
  nodeDir,
  appData,
  localAppData,
  prefix,
  pathEnv,
  pathDelimiter = delimiter,
} = {}) {
  const dirs = [];
  if (pathEnv) {
    for (const dir of String(pathEnv).split(pathDelimiter)) {
      if (dir) dirs.push(dir);
    }
  }
  if (nodeDir) dirs.push(nodeDir);
  if (appData) dirs.push(join(appData, "npm"));
  if (prefix) dirs.push(prefix);
  if (localAppData) dirs.push(join(localAppData, "pnpm"));
  return uniquePaths(dirs);
}

function pnpmCandidatePaths(options = {}) {
  const names = pnpmShimNames(options.platform);
  const files = [];
  for (const dir of pnpmSearchDirs(options)) {
    for (const name of names) {
      files.push(join(dir, name));
    }
  }
  return uniquePaths(files);
}

function resolvePnpm(options = {}) {
  const existsFn = options.existsFn || existsSync;
  for (const file of pnpmCandidatePaths(options)) {
    if (existsFn(file)) return file;
  }
}

function withPnpmOnPath(env = {}, pnpmPath, { pathDelimiter = delimiter } = {}) {
  const next = { ...env };
  if (!pnpmPath) return next;
  const dir = dirname(pnpmPath);
  const current = next.Path || next.PATH || "";
  const parts = String(current).split(pathDelimiter).filter(Boolean);
  const dirKey = dir.replace(/\\/g, "/").toLowerCase();
  if (!parts.some((part) => part.replace(/\\/g, "/").toLowerCase() === dirKey)) {
    parts.unshift(dir);
  }
  next.Path = parts.join(pathDelimiter);
  next.PATH = next.Path;
  return next;
}

module.exports = {
  PNPM_SPEC,
  pnpmShimNames,
  pnpmSearchDirs,
  pnpmCandidatePaths,
  resolvePnpm,
  withPnpmOnPath,
};
