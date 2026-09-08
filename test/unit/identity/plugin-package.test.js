"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  guessedPluginNpmNames,
  looksLikeDshPluginManifest,
  pickPluginManifest,
  pluginPackageJsonPaths,
} = require("../../../src/identity/plugin-package");

test("pluginPackageJsonPaths searches known DSH plugin folders before the repo root", () => {
  const paths = pluginPackageJsonPaths({ owner: "tt-a1i", repo: "archify" });
  assert.equal(paths[0], "integrations/deepseek-harness/package.json");
  assert.equal(paths.at(-1), "package.json");
  assert.ok(paths.includes("integrations/dsh/package.json"));
});

test("pluginPackageJsonPaths keeps an explicit catalog directory first", () => {
  const paths = pluginPackageJsonPaths({
    owner: "heartleo",
    repo: "hn-cli",
    directory: "plugins/hacker-news",
  });
  assert.equal(paths[0], "plugins/hacker-news/package.json");
  assert.equal(paths.includes("integrations/deepseek-harness/package.json"), false);
});

test("looksLikeDshPluginManifest accepts dsh.bundle and *-dsh names", () => {
  assert.equal(looksLikeDshPluginManifest({ dsh: { bundle: { patch: "./x.yml" } }, name: "website" }), true);
  assert.equal(looksLikeDshPluginManifest({ name: "@tt-a1i/archify-dsh" }), true);
  assert.equal(looksLikeDshPluginManifest({ name: "archify" }), false);
});

test("pickPluginManifest prefers the DSH plugin over a root website package", () => {
  const picked = pickPluginManifest([
    { manifest: { name: "archify-website" } },
    {
      manifest: {
        name: "@tt-a1i/archify-dsh",
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
        repository: { url: "git+https://github.com/tt-a1i/archify.git" },
      },
    },
  ], { host: "github.com", owner: "tt-a1i", repo: "archify" });
  assert.equal(picked.manifest.name, "@tt-a1i/archify-dsh");
});

test("guessedPluginNpmNames offers scoped plugin names for a host repo", () => {
  assert.deepEqual(guessedPluginNpmNames({ owner: "tt-a1i", repo: "archify" }), [
    "@tt-a1i/archify-dsh",
    "@tt-a1i/archify",
  ]);
});
