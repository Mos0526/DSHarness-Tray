"use strict";

const { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { dirname } = require("node:path");

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (fallback !== undefined && (error.code === "ENOENT" || error instanceof SyntaxError)) {
      return fallback;
    }
    throw error;
  }
}

function writeJsonAtomic(file, value) {
  ensureDir(dirname(file));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, file);
  } catch {
    copyFileSync(tmp, file);
    rmSync(tmp, { force: true });
  }
  return value;
}

function pathExists(file) {
  return existsSync(file);
}

function removePath(target) {
  rmSync(target, { recursive: true, force: true });
}

module.exports = {
  ensureDir,
  readJson,
  writeJsonAtomic,
  pathExists,
  removePath,
};
