"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTOSTART_FLAG,
  SETTINGS_MENU_LABEL,
  OPEN_AT_LOGIN_LABEL,
  RUN_ON_LOCK_SCREEN_LABEL,
  LOCK_SCREEN_CHROMIUM_SWITCHES,
  normalizeSettings,
  settingsFromState,
  mergeSettings,
  withSettings,
  wantsHiddenStart,
  loginItemLaunchArgs,
  loginItemOptions,
  isKnownLegacyLoginCommand,
  lockScreenRuntime,
  chromiumLockScreenSwitches,
  applyChromiumLockScreenSwitches,
  buildSettingsMenuItems,
} = require("../../../src/shell-settings");

describe("shell-settings", () => {
  it("defaults both toggles off and ignores junk", () => {
    assert.deepEqual(normalizeSettings(), { openAtLogin: false, runOnLockScreen: false });
    assert.deepEqual(normalizeSettings(null), { openAtLogin: false, runOnLockScreen: false });
    assert.deepEqual(normalizeSettings({ openAtLogin: 1, runOnLockScreen: "yes", extra: true }), {
      openAtLogin: true,
      runOnLockScreen: true,
    });
  });

  it("reads nested shellSettings from shell-state without colliding with other keys", () => {
    assert.deepEqual(
      settingsFromState({ safeBootRequired: true, lastCheckAt: 1, openAtLogin: true }),
      { openAtLogin: false, runOnLockScreen: false },
    );
    assert.deepEqual(
      settingsFromState({
        safeBootRequired: true,
        shellSettings: { openAtLogin: true, runOnLockScreen: false },
      }),
      { openAtLogin: true, runOnLockScreen: false },
    );
  });

  it("merges a patch and writes shellSettings without dropping other state", () => {
    const next = withSettings(
      { safeBootRequired: true, lastCheckAt: 9 },
      mergeSettings({ openAtLogin: true }, { runOnLockScreen: true }),
    );
    assert.equal(next.safeBootRequired, true);
    assert.equal(next.lastCheckAt, 9);
    assert.deepEqual(next.shellSettings, { openAtLogin: true, runOnLockScreen: true });
  });

  it("treats --autostart as a hidden login launch", () => {
    assert.equal(wantsHiddenStart(["electron", ".", AUTOSTART_FLAG]), true);
    assert.equal(wantsHiddenStart(["DSH.exe"]), false);
    assert.equal(wantsHiddenStart(undefined), false);
  });

  it("builds Windows login-item options with a hidden-start flag", () => {
    assert.deepEqual(
      loginItemOptions({
        openAtLogin: true,
        execPath: "C:\\App\\DSH.exe",
        packaged: true,
        name: "DS harness",
      }),
      {
        openAtLogin: true,
        enabled: true,
        path: "C:\\App\\DSH.exe",
        args: [AUTOSTART_FLAG],
        name: "DS harness",
      },
    );
    assert.deepEqual(loginItemLaunchArgs({ packaged: false, appPath: "E:\\dsh-tray" }), [
      "E:\\dsh-tray",
      AUTOSTART_FLAG,
    ]);
    assert.throws(() => loginItemOptions({ openAtLogin: true }), /execPath/);
  });

  it("keeps the same path and args when disabling the login item", () => {
    const off = loginItemOptions({
      openAtLogin: false,
      execPath: "C:\\App\\DSH.exe",
      packaged: true,
    });
    assert.equal(off.openAtLogin, false);
    assert.equal(off.enabled, false);
    assert.deepEqual(off.args, [AUTOSTART_FLAG]);
  });

  it("only recognizes the obsolete desktop launcher login command", () => {
    assert.equal(
      isKnownLegacyLoginCommand('"C:\\tools\\dsh-desktop-launcher\\dsh-desktop-launcher.exe" --hidden'),
      true,
    );
    assert.equal(
      isKnownLegacyLoginCommand("C:\\Users\\me\\AppData\\Local\\Programs\\dsh-tray\\DSH.exe --autostart"),
      false,
    );
    assert.equal(isKnownLegacyLoginCommand("dsh-desktop-launcher-helper.exe"), false);
  });

  it("describes lock-screen keep-alive without preventing display sleep", () => {
    assert.deepEqual(lockScreenRuntime(true), {
      preventAppSuspension: true,
      backgroundThrottling: false,
    });
    assert.deepEqual(lockScreenRuntime(false), {
      preventAppSuspension: false,
      backgroundThrottling: true,
    });
    assert.deepEqual(chromiumLockScreenSwitches(true), [...LOCK_SCREEN_CHROMIUM_SWITCHES]);
    assert.deepEqual(chromiumLockScreenSwitches(false), []);
    const seen = [];
    applyChromiumLockScreenSwitches({ appendSwitch: (name) => seen.push(name) }, true);
    assert.deepEqual(seen, [...LOCK_SCREEN_CHROMIUM_SWITCHES]);
    applyChromiumLockScreenSwitches({ appendSwitch: () => assert.fail("no switches") }, false);
  });

  it("exports a 设置 submenu with the two checkboxes", () => {
    const toggles = [];
    const items = buildSettingsMenuItems({
      settings: { openAtLogin: true, runOnLockScreen: false },
      onToggleOpenAtLogin: (checked) => toggles.push(["login", checked]),
      onToggleRunOnLockScreen: (checked) => toggles.push(["lock", checked]),
    });
    assert.equal(items.length, 1);
    assert.equal(items[0].label, SETTINGS_MENU_LABEL);
    const labels = items[0].submenu.map((item) => item.label);
    assert.deepEqual(labels, [OPEN_AT_LOGIN_LABEL, RUN_ON_LOCK_SCREEN_LABEL]);
    assert.equal(items[0].submenu[0].type, "checkbox");
    assert.equal(items[0].submenu[0].checked, true);
    assert.equal(items[0].submenu[1].checked, false);
    items[0].submenu[0].click({ checked: false });
    items[0].submenu[1].click({ checked: true });
    assert.deepEqual(toggles, [
      ["login", false],
      ["lock", true],
    ]);
  });
});
