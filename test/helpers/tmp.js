"use strict";

const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function makeTempRoot(prefix = "dsh-tray-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function removeTempRoot(root) {
  if (!root) return;
  rmSync(root, { recursive: true, force: true });
}

module.exports = { makeTempRoot, removeTempRoot };
