"use strict";

const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { computeNpmIntegrity } = require("../../../src/install/integrity");

function tempRoot(prefix = "dsh-shell-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function tarballFor(name, version) {
  return Buffer.from(`pkg:${name}@${version}\n`);
}

function compatManifest(name, version, { host = "^1.0.0", renderer = "^1.0.0", extra = {} } = {}) {
  return {
    name,
    version,
    dsh: {
      bundle: { patch: "./cordis.patch.yml" },
      client: { platform: "web" },
      compat: { host, renderer },
      ...extra.dsh,
    },
    exports: { ".": "./index.js", "./client": "./client.js" },
    ...extra,
  };
}

function gateFixture({
  name = "dsh-demo-plugin",
  version = "1.2.3",
  integrity,
  extraVersion = {},
  extraRequested = {},
} = {}) {
  const tarball = tarballFor(name, version);
  const sri = integrity || computeNpmIntegrity(tarball);
  return {
    requested: { name, version, integrity: sri, source: "npm", ...extraRequested },
    packument: {
      name,
      versions: {
        [version]: {
          name,
          version,
          dist: { integrity: sri, tarball: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz` },
          repository: { type: "git", url: "git+https://github.com/acme/dsh-demo-plugin.git" },
          ...extraVersion,
        },
      },
    },
    repoIdentity: { host: "github.com", owner: "acme", name: "dsh-demo-plugin", id: "4242" },
    tarball,
    integrity: sri,
    pluginManifest: compatManifest(name, version),
    dshInfo: { version: "1.4.0", host: "1.4.0", renderer: "1.4.0" },
  };
}

module.exports = {
  compatManifest,
  gateFixture,
  tarballFor,
  tempRoot,
};
