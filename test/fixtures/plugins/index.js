"use strict";

const { join } = require("node:path");

const ROOT = __dirname;

module.exports = {
  ROOT,
  compatible: join(ROOT, "compatible"),
  hostIncompatible: join(ROOT, "host-incompatible"),
  rendererIncompatible: join(ROOT, "renderer-incompatible"),
  outdated: join(ROOT, "outdated-with-compat-update", "v1"),
  outdatedUpdate: join(ROOT, "outdated-with-compat-update", "v2"),
};
