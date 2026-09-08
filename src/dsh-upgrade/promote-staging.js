"use strict";

/**
 * Populate a short-lived staging dir (e.g. npm --prefix), verify, then
 * atomically replace the single persistent current install.
 */

const { existsSync, mkdirSync, rmSync } = require("node:fs");
const { resolve } = require("node:path");
const { defaultReplace, upgradeDsh } = require("./transactional-upgrade");

function rmIfExists(dir) {
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
}

async function promoteStagedInstall({
  destDir,
  stagingDir,
  populateFn,
  verifyFn,
  beforeReplace,
  replaceFn,
} = {}) {
  if (!destDir) throw new Error("destDir is required");
  if (!stagingDir) throw new Error("stagingDir is required");
  if (typeof populateFn !== "function") throw new Error("populateFn is required");

  const dest = resolve(destDir);
  const staging = resolve(stagingDir);
  if (dest === staging) throw new Error("stagingDir must be different from destDir");

  rmIfExists(staging);
  mkdirSync(staging, { recursive: true });

  try {
    await populateFn(staging);
  } catch (error) {
    rmIfExists(staging);
    throw error;
  }

  if (!existsSync(staging)) {
    throw new Error("populateFn did not create stagingDir");
  }

  const replace = typeof replaceFn === "function"
    ? replaceFn
    : async (args) => {
      if (typeof beforeReplace === "function") await beforeReplace(args);
      await defaultReplace(args);
    };

  return upgradeDsh({
    destDir: dest,
    stagingDir: staging,
    verifyFn,
    replaceFn: replace,
  });
}

module.exports = {
  promoteStagedInstall,
};
