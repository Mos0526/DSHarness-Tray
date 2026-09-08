"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { createWal } = require("../../../src/install/wal");
const { tempRoot } = require("./helpers");

describe("WAL", () => {
  it("recovers an interrupted install by rolling back leftover files", () => {
    const root = tempRoot("dsh-wal-");
    const walDir = join(root, "wal");
    const pluginDir = join(root, "staging", "shell-plugins", "dsh-demo-plugin");
    const wal = createWal(walDir);
    const open = wal.begin({ op: "install", pluginId: "dsh-demo-plugin" });
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "partial.txt"), "crashed mid-unpack");
    wal.append(open.id, { name: "unpack-staging", undo: { type: "rm", path: pluginDir } });

    assert.equal(wal.readOpen().length, 1);
    assert.ok(existsSync(join(pluginDir, "partial.txt")));

    const recovered = createWal(walDir).recover();
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].status, "aborted");
    assert.equal(existsSync(pluginDir), false);
    assert.equal(createWal(walDir).readOpen().length, 0);
  });

  it("commit leaves artifacts in place; abort undoes recorded steps", () => {
    const root = tempRoot("dsh-wal-commit-");
    const wal = createWal(join(root, "wal"));
    const file = join(root, "artifact.txt");
    const rec = wal.begin({ op: "install", pluginId: "x" });
    writeFileSync(file, "keep");
    wal.append(rec.id, { name: "write", undo: { type: "rm", path: file } });
    wal.commit(rec.id);
    assert.ok(existsSync(file));
    assert.equal(wal.readOpen().length, 0);

    const rec2 = wal.begin({ op: "install", pluginId: "y" });
    const other = join(root, "other.txt");
    writeFileSync(other, "drop");
    wal.append(rec2.id, { name: "write", undo: { type: "rm", path: other } });
    wal.abort(rec2.id);
    assert.equal(existsSync(other), false);
  });

  it("restores an entire active profile after a production CLI interruption", () => {
    const root = tempRoot("dsh-wal-profile-");
    const active = join(root, "active-profile");
    const backup = join(root, "snapshot");
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, "package.json"), "old profile");
    cpSync(active, backup, { recursive: true });
    const wal = createWal(join(root, "wal"));
    const rec = wal.begin({ op: "production-install", pluginId: "demo" });
    wal.append(rec.id, {
      name: "active-profile-snapshot",
      undo: { type: "restore", path: active, from: backup },
    });

    rmSync(active, { recursive: true, force: true });
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, "package.json"), "partially written profile");
    writeFileSync(join(active, "pnpm-lock.yaml"), "partial lock");

    createWal(join(root, "wal")).recover();
    assert.equal(readFileSync(join(active, "package.json"), "utf8"), "old profile");
    assert.equal(existsSync(join(active, "pnpm-lock.yaml")), false);
  });
});
