"use strict";

const upgrade = require("./transactional-upgrade");
const { promoteStagedInstall } = require("./promote-staging");

module.exports = {
  ...upgrade,
  promoteStagedInstall,
};
