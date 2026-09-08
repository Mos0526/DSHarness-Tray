"use strict";

const paths = require("./dsh-paths");
const supervisor = require("./dsh-supervisor");
const protocol = require("../adapters");
const upgrade = require("../dsh-upgrade/transactional-upgrade");
const { promoteStagedInstall } = require("../dsh-upgrade");
const versions = require("./dsh-versions");
const globalDsh = require("./global-dsh");
const redact = require("./redact");
const processTree = require("./process-tree");
const processOutput = require("./process-output");
const pnpm = require("./pnpm");

module.exports = {
  ...paths,
  ...supervisor,
  ...protocol,
  ...upgrade,
  ...versions,
  ...redact,
  ...processTree,
  ...processOutput,
  ...pnpm,
  protocol,
  upgrade,
  versions,
  globalDsh,
  redact,
  processTree,
  processOutput,
  pnpm,
  createSupervisor: supervisor.createSupervisor,
  resolveShellDshRoot: paths.resolveShellDshRoot,
  resolveDshBinary: paths.resolveDshBinary,
  resolveHome: paths.resolveHome,
  resolveCurrentInstall: paths.resolveCurrentInstall,
  resolveUpgradeStaging: paths.resolveUpgradeStaging,
  upgradeDsh: upgrade.upgradeDsh,
  readUpgradeState: upgrade.readUpgradeState,
  markSafeBootRequired: upgrade.markSafeBootRequired,
  clearSafeBootRequired: upgrade.clearSafeBootRequired,
  acknowledgeSuccessfulStart: upgrade.acknowledgeSuccessfulStart,
  promoteStagedInstall,
};
