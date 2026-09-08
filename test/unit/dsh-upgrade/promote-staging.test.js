"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { promoteStagedInstall } = require("../../../src/dsh-upgrade/promote-staging");
const { BACKUP_SUFFIX, readUpgradeState } = require("../../../src/dsh-upgrade/transactional-upgrade");

function makeDirs(label) {
  const root = join(tmpdir(), `dsh-promote-${label}-${process.pid}-${Date.now()}`);
  const destDir = join(root, "current");
  const stagingDir = join(root, "tmp", "dsh-staging");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "old.txt"), "old-binary");
  return { root, destDir, stagingDir };
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true });
}

describe("promoteStagedInstall", () => {
  it("populates staging, replaces dest, and marks safe boot", async () => {
    const { root, destDir, stagingDir } = makeDirs("ok");
    try {
      const result = await promoteStagedInstall({
        destDir,
        stagingDir,
        populateFn: async (dir) => {
          writeFileSync(join(dir, "new.txt"), "new-binary");
        },
        verifyFn: async (dir) => {
          assert.equal(readFileSync(join(dir, "new.txt"), "utf8"), "new-binary");
        },
      });
      assert.equal(result.status, "ok");
      assert.equal(result.safeBootRequired, true);
      assert.equal(readFileSync(join(destDir, "new.txt"), "utf8"), "new-binary");
      assert.equal(existsSync(join(destDir, "old.txt")), false);
      assert.equal(existsSync(stagingDir), false);
      assert.equal(existsSync(destDir + BACKUP_SUFFIX), false);
    } finally {
      cleanup(root);
    }
  });

  it("leaves dest untouched and removes staging when populateFn fails", async () => {
    const { root, destDir, stagingDir } = makeDirs("populate-fail");
    try {
      await assert.rejects(
        () => promoteStagedInstall({
          destDir,
          stagingDir,
          populateFn: async () => {
            throw new Error("npm install failed");
          },
        }),
        /npm install failed/,
      );
      assert.equal(readFileSync(join(destDir, "old.txt"), "utf8"), "old-binary");
      assert.equal(existsSync(stagingDir), false);
      assert.equal(readUpgradeState(destDir).safeBootRequired, false);
    } finally {
      cleanup(root);
    }
  });

  it("rolls dest back when verifyFn fails after npm wrote staging", async () => {
    const { root, destDir, stagingDir } = makeDirs("verify-fail");
    try {
      await assert.rejects(
        () => promoteStagedInstall({
          destDir,
          stagingDir,
          populateFn: async (dir) => {
            writeFileSync(join(dir, "new.txt"), "new-binary");
          },
          verifyFn: async () => {
            throw new Error("ready probe failed");
          },
        }),
        /ready probe failed/,
      );
      assert.equal(readFileSync(join(destDir, "old.txt"), "utf8"), "old-binary");
      assert.equal(existsSync(join(destDir, "new.txt")), false);
      assert.equal(existsSync(stagingDir), false);
      assert.equal(existsSync(destDir + BACKUP_SUFFIX), false);
      assert.equal(readUpgradeState(destDir).status, "verify_failed");
      assert.equal(readUpgradeState(destDir).safeBootRequired, false);
    } finally {
      cleanup(root);
    }
  });

  it("does not keep a second version when replace fails", async () => {
    const { root, destDir, stagingDir } = makeDirs("replace-fail");
    try {
      await assert.rejects(
        () => promoteStagedInstall({
          destDir,
          stagingDir,
          populateFn: async (dir) => {
            writeFileSync(join(dir, "new.txt"), "new-binary");
          },
          verifyFn: async () => {},
          replaceFn: async () => {
            throw new Error("atomic rename failed");
          },
        }),
        /atomic rename failed/,
      );
      assert.equal(readFileSync(join(destDir, "old.txt"), "utf8"), "old-binary");
      assert.equal(existsSync(join(destDir, "new.txt")), false);
      assert.equal(existsSync(destDir + BACKUP_SUFFIX), false);
      assert.equal(readUpgradeState(destDir).status, "rolled_back");
    } finally {
      cleanup(root);
    }
  });
});
