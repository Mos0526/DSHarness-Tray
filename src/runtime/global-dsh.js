"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");

function globalDshEntry(appData) {
  return join(appData || "", "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
}

function privateDshEntry(prefix) {
  return join(prefix, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
}

function resolveDshEntry({ isolated, prefix, appData, existsFn = existsSync } = {}) {
  const entry = isolated ? privateDshEntry(prefix) : globalDshEntry(appData);
  return existsFn(entry) ? entry : undefined;
}

function buildGlobalInstallArgs(npmCli, spec, flags = []) {
  if (!npmCli) throw new Error("npmCli is required");
  if (!spec) throw new Error("spec is required");
  return [npmCli, "install", "-g", spec, ...flags];
}

module.exports = {
  globalDshEntry,
  privateDshEntry,
  resolveDshEntry,
  buildGlobalInstallArgs,
};
