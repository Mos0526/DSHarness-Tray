"use strict";

function tryRequire(id) {
  try {
    return require(id);
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") return null;
    throw error;
  }
}

function describeIfModule(id, title, fn) {
  const test = require("node:test");
  const mod = tryRequire(id);
  const block = mod ? test.describe : test.describe.skip;
  block(`${title} (requires ${id})`, function () {
    fn(mod);
  });
  return mod;
}

module.exports = { tryRequire, describeIfModule };
