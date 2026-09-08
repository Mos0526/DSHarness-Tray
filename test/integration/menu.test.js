"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildPluginMenuItems, PLUGIN_MENU_LABEL } = require("../../src/tray-plugin/menu");

describe("buildPluginMenuItems", () => {
  it("exports a single 插件商店 entry without submenus", () => {
    const items = buildPluginMenuItems({ badge: { show: false, reasons: [] } });
    assert.equal(items.length, 1);
    assert.equal(items[0].label, PLUGIN_MENU_LABEL);
    assert.equal(items[0].submenu, undefined);
    assert.equal(items[0].type, undefined);
  });

  it("marks the entry when a badge should show", () => {
    const items = buildPluginMenuItems({
      badge: { show: true, reasons: ["quarantined"] },
    });
    assert.equal(items[0].label, `${PLUGIN_MENU_LABEL}  •`);
    assert.ok(!/隔离|升级|验证/.test(JSON.stringify(items)));
  });

  it("accepts raw plugin/lifecycle input as badge", () => {
    const items = buildPluginMenuItems({
      badge: { plugins: [{ id: "a", updateAvailable: true }] },
    });
    assert.match(items[0].label, /•/);
  });

  it("invokes onOpen and does not enumerate quarantine details", () => {
    let opened = 0;
    const items = buildPluginMenuItems({
      onOpen: () => {
        opened += 1;
      },
      badge: { show: true, reasons: ["verifyFailed", "quarantined"] },
    });
    items[0].click();
    assert.equal(opened, 1);
    assert.equal(items.length, 1);
  });
});
