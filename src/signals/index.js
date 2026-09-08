"use strict";

const github = require("./github");
const npm = require("./npm");

module.exports = {
  ...github,
  ...npm,
};
