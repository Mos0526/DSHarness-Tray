"use strict";

const { randomBytes } = require("node:crypto");
const { existsSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { ensureDir, pathExists, readJson, removePath, writeJsonAtomic } = require("../homes/io");

function nowIso() {
  return new Date().toISOString();
}

function newWalId() {
  return `wal_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}

function applyUndo(undo) {
  if (!undo) return;
  if (undo.type === "rm" || undo.type === "rmdir") {
    removePath(undo.path);
    return;
  }
  if (undo.type === "restore") {
    if (undo.snapshot != null) {
      ensureDir(require("node:path").dirname(undo.path));
      if (typeof undo.snapshot === "object" && !Buffer.isBuffer(undo.snapshot)) {
        writeJsonAtomic(undo.path, undo.snapshot);
      } else {
        writeFileSync(undo.path, undo.snapshot);
      }
      return;
    }
    if (undo.from && existsSync(undo.from)) {
      const { cpSync } = require("node:fs");
      removePath(undo.path);
      cpSync(undo.from, undo.path, { recursive: true, force: true });
    }
  }
}

function walFile(walDir, id) {
  return join(walDir, `${id}.json`);
}

function createWal(dir) {
  if (!dir) throw new Error("createWal(walDir) requires a directory");
  ensureDir(dir);

  function writeRecord(record) {
    record.updatedAt = nowIso();
    writeJsonAtomic(walFile(dir, record.id), record);
    return record;
  }

  function read(id) {
    return readJson(walFile(dir, id), null);
  }

  function begin(init = {}) {
    const record = {
      id: init.id || newWalId(),
      status: "open",
      op: init.op || "install",
      pluginId: init.pluginId || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      steps: [],
      meta: init.meta || {},
    };
    writeRecord(record);
    return record;
  }

  function append(id, step) {
    const record = read(id);
    if (!record) throw new Error(`WAL not found: ${id}`);
    if (record.status !== "open") throw new Error(`WAL ${id} is ${record.status}, cannot append`);
    record.steps.push({
      at: nowIso(),
      name: step.name,
      payload: step.payload || null,
      undo: step.undo || null,
    });
    return writeRecord(record);
  }

  function rollback(record) {
    for (const step of [...record.steps].reverse()) {
      try {
        applyUndo(step.undo);
      } catch {
        /* keep applying remaining undo records */
      }
    }
  }

  function commit(id) {
    const record = read(id);
    if (!record) throw new Error(`WAL not found: ${id}`);
    if (record.status === "committed") return record;
    record.status = "committed";
    record.committedAt = nowIso();
    return writeRecord(record);
  }

  function abort(id) {
    const record = read(id);
    if (!record) throw new Error(`WAL not found: ${id}`);
    if (record.status === "aborted") return record;
    if (record.status === "open") rollback(record);
    record.status = "aborted";
    record.abortedAt = nowIso();
    return writeRecord(record);
  }

  function readOpen() {
    const out = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name.endsWith(".tmp")) continue;
      const record = readJson(join(dir, name), null);
      if (record?.status === "open") out.push(record);
    }
    return out.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function recover() {
    const open = readOpen();
    const recovered = [];
    for (const record of open) {
      recovered.push(abort(record.id));
    }
    return recovered;
  }

  return {
    begin,
    append,
    commit,
    abort,
    recover,
    readOpen,
    read,
    dir,
  };
}

function isOpenWal(record) {
  return record?.status === "open";
}

module.exports = {
  createWal,
  isOpenWal,
  applyUndo,
  newWalId,
};
