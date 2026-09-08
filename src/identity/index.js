"use strict";

const stableId = require("./stable-id");
const pluginPackage = require("./plugin-package");

module.exports = {
  ...stableId,
  ...pluginPackage,
};
