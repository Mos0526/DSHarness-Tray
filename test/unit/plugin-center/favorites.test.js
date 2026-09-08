"use strict";

const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const {
  createFavoritesStore,
  MAX_HISTORY,
} = require("../../../src/plugin-center/favorites");
const { makeTempRoot, removeTempRoot } = require("../../helpers/tmp");

describe("plugin favorites", () => {
  let root;

  afterEach(() => removeTempRoot(root));

  it("persists favorites and records add/remove history without duplicates", () => {
    root = makeTempRoot("dsh-favorites-");
    const filePath = join(root, "plugin-favorites.json");
    let clock = Date.parse("2026-08-31T08:00:00.000Z");
    const store = createFavoritesStore({
      filePath,
      now: () => {
        clock += 1_000;
        return clock;
      },
    });
    const plugin = {
      id: "demo",
      name: "Demo",
      npmName: "@owner/demo",
      repositoryUrl: "https://github.com/owner/demo",
    };

    assert.equal(store.toggle(plugin, true).favorite, true);
    assert.equal(store.toggle(plugin, true).favorites.history.length, 1);
    assert.equal(store.toggle(plugin, false).favorite, false);

    const reloaded = createFavoritesStore({ filePath }).snapshot();
    assert.deepEqual(reloaded.favorites, []);
    assert.deepEqual(reloaded.history.map((item) => item.action), ["unfavorite", "favorite"]);
    assert.equal(reloaded.history[0].npmName, "@owner/demo");
  });

  it("bounds history and rejects entries without a stable id", () => {
    const store = createFavoritesStore();
    assert.throws(() => store.toggle({ name: "missing" }), /插件 ID/);
    for (let i = 0; i < MAX_HISTORY + 10; i += 1) {
      store.toggle({ id: `plugin-${i}` }, true);
    }
    assert.equal(store.snapshot().history.length, MAX_HISTORY);
  });
});
