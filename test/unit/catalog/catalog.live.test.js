"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createCatalog } = require("../../../src/catalog");
const { removeDir, tempCacheDir } = require("./helpers");

const live = process.env.DSH_CATALOG_LIVE === "1";

test("optional live fetch of both awesome READMEs", { skip: live ? false : "set DSH_CATALOG_LIVE=1 to hit the network" }, async () => {
  const cacheDir = tempCacheDir();
  const catalog = createCatalog({ cacheDir, enrichSignals: false });
  const result = await catalog.refreshCatalog();
  assert.ok(result.plugins.length > 10);
  assert.ok(result.plugins.some((item) => item.community.inAwesomeDeepseekHarness));
  assert.ok(result.plugins.some((item) => item.community.inAwesomeDshPlugin));
  removeDir(cacheDir);
});
