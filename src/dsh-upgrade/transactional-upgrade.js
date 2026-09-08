"use strict";

/**
 * Single-directory transactional DSH upgrade.
 *
 * Product rules:
 * - One persistent shell-owned DSH directory. No multi-version keep.
 * - Artifact is verified in a short-lived staging dir, then atomically
 *   swapped onto dest. Failure leaves dest untouched and does not keep
 *   a second install around.
 * - Success marks "next boot must be safe mode" (no community plugins).
 *
 * Network download is out of scope: pass an already-populated `stagingDir`
 * (or a `replaceFn` / `verifyFn`). Staging should sit on the same volume
 * as dest so `rename` is atomic.
 */

const {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { dirname, resolve } = require("node:path");

const STATE_SUFFIX = ".upgrade-state.json";
const BACKUP_SUFFIX = ".dsh-upgrade-bak";

const IDLE_STATE = Object.freeze({
  version: 1,
  status: "idle",
  safeBootRequired: false,
  lastUpgradeAt: null,
  lastError: null,
});

function statePath(destDir) {
  const dest = resolve(destDir);
  return `${dest}${STATE_SUFFIX}`;
}

function readUpgradeState(destDir) {
  if (!destDir) throw new Error("destDir is required");
  const file = statePath(destDir);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      ...IDLE_STATE,
      ...parsed,
      safeBootRequired: Boolean(parsed.safeBootRequired),
    };
  } catch {
    return { ...IDLE_STATE };
  }
}

function writeUpgradeState(destDir, state) {
  const dest = resolve(destDir);
  mkdirSync(dirname(dest), { recursive: true });
  const next = {
    ...IDLE_STATE,
    ...readUpgradeState(dest),
    ...state,
    version: 1,
  };
  writeFileSync(statePath(dest), JSON.stringify(next, null, 2));
  return next;
}

function markSafeBootRequired(destDir) {
  return writeUpgradeState(destDir, { safeBootRequired: true });
}

function clearSafeBootRequired(destDir) {
  return writeUpgradeState(destDir, { safeBootRequired: false });
}

/**
 * Next boot after upgrade is safe. Clear the flag only after that safe
 * start actually reached ready — never at the beginning of start().
 */
function acknowledgeSuccessfulStart(destDir, { mode, ready } = {}) {
  if (!destDir) throw new Error("destDir is required");
  if (ready && mode === "safe") return clearSafeBootRequired(destDir);
  return readUpgradeState(destDir);
}

function rmIfExists(dir) {
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
}

function defaultReplace({ destDir, stagingDir }) {
  const dest = resolve(destDir);
  const staging = resolve(stagingDir);
  const backup = dest + BACKUP_SUFFIX;

  if (existsSync(backup)) {
    if (!existsSync(dest)) {
      renameSync(backup, dest);
    } else {
      rmIfExists(backup);
    }
  }

  mkdirSync(dirname(dest), { recursive: true });
  const destExisted = existsSync(dest);
  if (destExisted) {
    renameSync(dest, backup);
  }

  try {
    renameSync(staging, dest);
  } catch (error) {
    if (destExisted && existsSync(backup) && !existsSync(dest)) {
      try {
        renameSync(backup, dest);
      } catch (restoreError) {
        error.restoreError = restoreError;
      }
    }
    throw error;
  }

  rmIfExists(backup);
}

async function upgradeDsh({ destDir, stagingDir, verifyFn, replaceFn } = {}) {
  if (!destDir) throw new Error("destDir is required");
  if (!stagingDir) throw new Error("stagingDir is required");

  const dest = resolve(destDir);
  const staging = resolve(stagingDir);
  if (dest === staging) {
    throw new Error("stagingDir must be different from destDir");
  }
  if (!existsSync(staging)) {
    throw new Error("stagingDir does not exist");
  }

  writeUpgradeState(dest, { status: "verifying", lastError: null });

  try {
    if (typeof verifyFn === "function") {
      await verifyFn(staging);
    }
  } catch (error) {
    rmIfExists(staging);
    writeUpgradeState(dest, {
      status: "verify_failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  writeUpgradeState(dest, { status: "replacing" });
  const replace = typeof replaceFn === "function" ? replaceFn : defaultReplace;

  try {
    await replace({ destDir: dest, stagingDir: staging });
  } catch (error) {
    if (existsSync(staging) && existsSync(dest)) {
      rmIfExists(staging);
    }
    writeUpgradeState(dest, {
      status: "rolled_back",
      lastError: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  if (existsSync(staging)) {
    rmIfExists(staging);
  }

  return writeUpgradeState(dest, {
    status: "ok",
    safeBootRequired: true,
    lastUpgradeAt: new Date().toISOString(),
    lastError: null,
  });
}

module.exports = {
  STATE_SUFFIX,
  BACKUP_SUFFIX,
  upgradeDsh,
  readUpgradeState,
  writeUpgradeState,
  markSafeBootRequired,
  clearSafeBootRequired,
  acknowledgeSuccessfulStart,
  defaultReplace,
  statePath,
};
