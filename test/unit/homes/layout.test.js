"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  HOME_KINDS,
  clearActiveHome,
  configureActiveHome,
  ensureHomes,
  homePath,
  listInstalled,
  readHomeMeta,
  readProfile,
  resolveHome,
} = require("../../../src/homes");
const { addToProfile } = require("../../../src/install/pipeline");
const { tempRoot } = require("../install/helpers");

describe("homes layout", () => {
  it("creates safe/active/staging/quarantine DSH_HOME trees", () => {
    const root = tempRoot("dsh-homes-");
    const api = ensureHomes(root);
    for (const kind of HOME_KINDS) {
      const home = api.paths[kind];
      assert.equal(home, resolveHome(root, kind));
      assert.equal(home, homePath(root, kind));
      assert.equal(readHomeMeta(root, kind).kind, kind);
      assert.equal(readHomeMeta(root, kind).communityPluginsAllowed, kind !== "safe");
      assert.ok(existsSync(join(home, "profiles", "web", "package.json")));
      assert.ok(existsSync(join(home, "profiles", "web", "cordis.patch.yml")));
      assert.ok(existsSync(join(home, "shell-plugins")));
    }
    const safePkg = JSON.parse(readFileSync(join(api.paths.safe, "profiles", "web", "package.json"), "utf8"));
    assert.deepEqual(safePkg.dsh.profile.bundles, ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]);
    assert.deepEqual(safePkg.dependencies, {});
    assert.deepEqual(api.listInstalled("safe"), []);
    assert.deepEqual(listInstalled("active", root), []);
  });

  it("strips community plugins out of safe home on ensure", () => {
    const root = tempRoot("dsh-homes-safe-");
    const api = ensureHomes(root);
    addToProfile(api.paths.safe, "evil-community", "9.9.9");
    assert.ok(readProfile(api.paths.safe).dependencies["evil-community"]);
    ensureHomes(root);
    assert.equal(readProfile(api.paths.safe).dependencies["evil-community"], undefined);
    assert.ok(!readProfile(api.paths.safe).dsh.profile.bundles.includes("evil-community"));
  });

  it("does not rewrite an externally configured user active home on startup", () => {
    const root = tempRoot("dsh-homes-external-root-");
    const userHome = tempRoot("dsh-homes-user-");
    const credentials = join(userHome, ".credentials.yaml");
    writeFileSync(credentials, "provider: existing\n", "utf8");
    try {
      configureActiveHome(root, userHome);
      const api = ensureHomes(root);
      assert.equal(api.paths.active, userHome);
      assert.equal(readFileSync(credentials, "utf8"), "provider: existing\n");
      assert.equal(existsSync(join(userHome, ".dsh-shell-home.json")), false);
      assert.equal(existsSync(join(userHome, "shell-plugins")), false);
      assert.equal(existsSync(join(userHome, "profiles")), false);
      assert.ok(existsSync(join(api.paths.safe, ".dsh-shell-home.json")));
    } finally {
      clearActiveHome(root);
    }
  });

  it("rejects an unknown home kind", () => {
    const root = tempRoot("dsh-homes-kind-");
    assert.throws(() => homePath(root, "preview"), /unknown DSH_HOME kind/);
  });
});
