"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const {
  upgradeDsh,
  readUpgradeState,
  markSafeBootRequired,
  clearSafeBootRequired,
  acknowledgeSuccessfulStart,
  STATE_SUFFIX,
  BACKUP_SUFFIX,
} = require("../../../src/dsh-upgrade/transactional-upgrade");

function makeDirs(label) {
  const root = join(tmpdir(), `dsh-upgrade-${label}-${process.pid}-${Date.now()}`);
  const destDir = join(root, "current");
  const stagingDir = join(root, "tmp", "dsh-staging");
  mkdirSync(destDir, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(destDir, "old.txt"), "old-binary");
  writeFileSync(join(stagingDir, "new.txt"), "new-binary");
  return { root, destDir, stagingDir };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

describe("upgradeDsh failure rollback", () => {
  it("leaves dest untouched and removes staging when verifyFn fails", async () => {
    const { root, destDir, stagingDir } = makeDirs("verify-fail");
    try {
      await assert.rejects(
        () => upgradeDsh({
          destDir,
          stagingDir,
          verifyFn: async () => {
            throw new Error("cli probe failed");
          },
        }),
        /cli probe failed/,
      );
      assert.equal(readFileSync(join(destDir, "old.txt"), "utf8"), "old-binary");
      assert.equal(existsSync(join(destDir, "new.txt")), false);
      assert.equal(existsSync(stagingDir), false);
      assert.equal(existsSync(destDir + BACKUP_SUFFIX), false);
      const state = readUpgradeState(destDir);
      assert.equal(state.safeBootRequired, false);
      assert.equal(state.status, "verify_failed");
    } finally {
      cleanup(root);
    }
  });

  it("rolls dest back when replaceFn throws", async () => {
    const { root, destDir, stagingDir } = makeDirs("replace-fail");
    try {
      await assert.rejects(
        () => upgradeDsh({
          destDir,
          stagingDir,
          verifyFn: async () => {},
          replaceFn: async () => {
            throw new Error("rename failed");
          },
        }),
        /rename failed/,
      );
      assert.equal(readFileSync(join(destDir, "old.txt"), "utf8"), "old-binary");
      assert.equal(existsSync(destDir + BACKUP_SUFFIX), false);
      assert.equal(readUpgradeState(destDir).status, "rolled_back");
      assert.equal(readUpgradeState(destDir).safeBootRequired, false);
    } finally {
      cleanup(root);
    }
  });
});

describe("upgradeDsh success marks safe boot", () => {
  it("atomically replaces dest and sets safeBootRequired", async () => {
    const { root, destDir, stagingDir } = makeDirs("ok");
    try {
      const result = await upgradeDsh({
        destDir,
        stagingDir,
        verifyFn: async (dir) => {
          assert.equal(readFileSync(join(dir, "new.txt"), "utf8"), "new-binary");
        },
      });
      assert.equal(result.safeBootRequired, true);
      assert.equal(result.status, "ok");
      assert.equal(readFileSync(join(destDir, "new.txt"), "utf8"), "new-binary");
      assert.equal(existsSync(join(destDir, "old.txt")), false);
      assert.equal(existsSync(stagingDir), false);
      assert.equal(existsSync(destDir + BACKUP_SUFFIX), false);
      assert.equal(readUpgradeState(destDir).safeBootRequired, true);
      assert.ok(existsSync(destDir + STATE_SUFFIX));
    } finally {
      cleanup(root);
    }
  });

  it("markSafeBootRequired persists without swapping the install", () => {
    const { root, destDir } = makeDirs("mark");
    try {
      const state = markSafeBootRequired(destDir);
      assert.equal(state.safeBootRequired, true);
      assert.equal(readUpgradeState(destDir).safeBootRequired, true);
      assert.equal(readFileSync(join(destDir, "old.txt"), "utf8"), "old-binary");
    } finally {
      cleanup(root);
    }
  });

  it("clears safeBootRequired only after a successful safe start", () => {
    const { root, destDir } = makeDirs("clear");
    try {
      markSafeBootRequired(destDir);
      const bootMode = readUpgradeState(destDir).safeBootRequired ? "safe" : "active";
      assert.equal(bootMode, "safe");
      acknowledgeSuccessfulStart(destDir, { mode: bootMode, ready: false });
      assert.equal(readUpgradeState(destDir).safeBootRequired, true);
      acknowledgeSuccessfulStart(destDir, { mode: "active", ready: true });
      assert.equal(readUpgradeState(destDir).safeBootRequired, true);
      const cleared = acknowledgeSuccessfulStart(destDir, { mode: "safe", ready: true });
      assert.equal(cleared.safeBootRequired, false);
      assert.equal(clearSafeBootRequired(destDir).safeBootRequired, false);
      const nextMode = readUpgradeState(destDir).safeBootRequired ? "safe" : "active";
      assert.equal(nextMode, "active");
    } finally {
      cleanup(root);
    }
  });
});
