"use strict";

const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { computeIntegrity } = require("../../src/install/integrity");

const DEMO_DSH = { version: "0.9.0", host: "0.9.0", renderer: "0.9.0" };

function fixtureInstallOpts(dir, extras = {}) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const integrity = extras.integrity || computeIntegrity(Buffer.from(`fixture:${pkg.name}@${pkg.version}`));
  const { requested: requestedExtra, dshInfo, repoId, ...rest } = extras;
  return {
    pluginId: pkg.name,
    requested: {
      name: pkg.name,
      version: pkg.version,
      integrity,
      ...requestedExtra,
    },
    repoIdentity: {
      host: "github.com",
      owner: "fixture",
      name: pkg.name,
      id: repoId || "fixture-1",
    },
    pluginManifest: pkg,
    files: {
      "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
      "index.js": readFileSync(join(dir, "index.js"), "utf8"),
    },
    dshInfo: dshInfo || DEMO_DSH,
    ...rest,
  };
}

module.exports = { fixtureInstallOpts, DEMO_DSH };
