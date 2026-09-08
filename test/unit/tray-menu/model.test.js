"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  ABOUT_ID,
  OPEN_WINDOW_ID,
  SHADOW_PAD,
  POPUP_GAP,
  buildTrayMenuModel,
  groupOrder,
  isToggleItem,
  placeTrayPopup,
  windowSizeForPanel,
  shouldIgnoreBlur,
  sameBounds,
  createTrayClickGuard,
} = require("../../../src/tray-menu/model");
const { OPEN_AT_LOGIN_ID, SETTINGS_MENU_ID } = require("../../../src/shell-settings");
const { PLUGIN_MENU_ID } = require("../../../src/tray-plugin");

describe("tray menu model", () => {
  it("puts 设置 above 关于与更新 and inlines the toggles", () => {
    const model = buildTrayMenuModel({
      updating: false,
      badge: { show: true, reasons: ["quarantined"] },
      settings: { openAtLogin: true, runOnLockScreen: false },
    });
    assert.deepEqual(groupOrder(model), ["main", SETTINGS_MENU_ID, "about", "quit"]);
    const settings = model.groups[1];
    assert.equal(settings.label, "设置");
    assert.equal(settings.items[0].id, OPEN_AT_LOGIN_ID);
    assert.equal(settings.items[0].type, "toggle");
    assert.equal(settings.items[0].checked, true);
    assert.equal(settings.items[1].label, "允许锁屏运行");
    assert.equal(model.groups[2].items[0].id, ABOUT_ID);
    assert.equal(model.groups[0].items.find((item) => item.id === PLUGIN_MENU_ID).label, "插件商店  •");
  });

  it("disables window actions while updating", () => {
    const model = buildTrayMenuModel({ updating: true });
    const byId = Object.fromEntries(model.groups.flatMap((group) => group.items).map((item) => [item.id, item]));
    assert.equal(byId[OPEN_WINDOW_ID].enabled, false);
    assert.equal(byId[ABOUT_ID].enabled, false);
    assert.equal(byId[ABOUT_ID].label, "正在更新…");
    assert.equal(isToggleItem(OPEN_AT_LOGIN_ID), true);
    assert.equal(isToggleItem(OPEN_WINDOW_ID), false);
  });

  it("places the visible panel close above a bottom-right tray icon", () => {
    const size = windowSizeForPanel(360);
    const placed = placeTrayPopup({
      trayBounds: { x: 1880, y: 1048, width: 24, height: 24 },
      menuSize: size,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    });
    assert.equal(placed.width, size.width);
    assert.equal(placed.y + placed.height - SHADOW_PAD, 1048 - POPUP_GAP);
    assert.ok(placed.x + placed.width - SHADOW_PAD <= 1920);
  });

  it("opens below a top-aligned tray icon", () => {
    const placed = placeTrayPopup({
      trayBounds: { x: 100, y: 0, width: 24, height: 24 },
      menuSize: windowSizeForPanel(200),
      workArea: { x: 0, y: 0, width: 1280, height: 800 },
    });
    assert.equal(placed.y + SHADOW_PAD, 24 + POPUP_GAP);
  });

  it("ignores blur only within the open grace period", () => {
    assert.equal(shouldIgnoreBlur(1000, 1100, 400), true);
    assert.equal(shouldIgnoreBlur(1000, 1500, 400), false);
    assert.equal(shouldIgnoreBlur(0, 1100, 400), false);
    assert.equal(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 4 }), true);
    assert.equal(sameBounds({ x: 1, y: 2, width: 3, height: 4 }, { x: 1, y: 2, width: 3, height: 5 }), false);
  });

  it("drops a left click that is followed by a right click", async () => {
    const guard = createTrayClickGuard({ delayMs: 20 });
    let left = 0;
    let right = 0;
    guard.leftClick(() => {
      left += 1;
    });
    guard.rightClick(() => {
      right += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(left, 0);
    assert.equal(right, 1);
  });
});
