"use strict";

const AUTOSTART_FLAG = "--autostart";
const SETTINGS_MENU_ID = "settings";
const SETTINGS_MENU_LABEL = "设置";
const OPEN_AT_LOGIN_ID = "open-at-login";
const OPEN_AT_LOGIN_LABEL = "开机自启动";
const RUN_ON_LOCK_SCREEN_ID = "run-on-lock-screen";
const RUN_ON_LOCK_SCREEN_LABEL = "允许锁屏运行";

const DEFAULT_LOGIN_ITEM_NAME = "DS harness";
const LEGACY_LOGIN_ITEM_NAME = "DSHDesktop";

const LOCK_SCREEN_CHROMIUM_SWITCHES = Object.freeze([
  "disable-renderer-backgrounding",
  "disable-background-timer-throttling",
  "disable-backgrounding-occluded-windows",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeSettings(input) {
  const raw = asObject(input);
  return {
    openAtLogin: Boolean(raw.openAtLogin),
    runOnLockScreen: Boolean(raw.runOnLockScreen),
  };
}

function settingsFromState(state) {
  return normalizeSettings(asObject(state).shellSettings);
}

function mergeSettings(current, patch) {
  return normalizeSettings({ ...normalizeSettings(current), ...asObject(patch) });
}

function withSettings(state, settings) {
  return { ...asObject(state), shellSettings: normalizeSettings(settings) };
}

function wantsHiddenStart(argv = process.argv) {
  return Array.isArray(argv) && argv.includes(AUTOSTART_FLAG);
}

function loginItemLaunchArgs({ packaged, appPath } = {}) {
  if (packaged) return [AUTOSTART_FLAG];
  const resolved = String(appPath || "").trim() || ".";
  return [resolved, AUTOSTART_FLAG];
}

function loginItemOptions({
  openAtLogin,
  execPath,
  appPath,
  packaged,
  name,
} = {}) {
  const path = String(execPath || "").trim();
  if (!path) throw new Error("login item requires execPath");
  const enabled = Boolean(openAtLogin);
  return {
    openAtLogin: enabled,
    enabled,
    path,
    args: loginItemLaunchArgs({ packaged: Boolean(packaged), appPath }),
    name: String(name || DEFAULT_LOGIN_ITEM_NAME),
  };
}

function isKnownLegacyLoginCommand(command) {
  return /(?:^|[\\/])dsh-desktop-launcher\.exe(?:["\s]|$)/i.test(String(command || ""));
}

function lockScreenRuntime(runOnLockScreen) {
  const enabled = Boolean(runOnLockScreen);
  return {
    preventAppSuspension: enabled,
    backgroundThrottling: !enabled,
  };
}

function chromiumLockScreenSwitches(runOnLockScreen) {
  return Boolean(runOnLockScreen) ? [...LOCK_SCREEN_CHROMIUM_SWITCHES] : [];
}

function applyChromiumLockScreenSwitches(commandLine, runOnLockScreen) {
  if (!commandLine || typeof commandLine.appendSwitch !== "function") return;
  for (const name of chromiumLockScreenSwitches(runOnLockScreen)) {
    commandLine.appendSwitch(name);
  }
}

/**
 * Tray submenu: 开机自启动 + 允许锁屏运行.
 *
 * @param {{
 *   settings?: { openAtLogin?: boolean, runOnLockScreen?: boolean },
 *   onToggleOpenAtLogin?: (checked: boolean) => void,
 *   onToggleRunOnLockScreen?: (checked: boolean) => void,
 * }} [options]
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildSettingsMenuItems({
  settings,
  onToggleOpenAtLogin,
  onToggleRunOnLockScreen,
} = {}) {
  const resolved = normalizeSettings(settings);
  return [
    {
      id: SETTINGS_MENU_ID,
      label: SETTINGS_MENU_LABEL,
      submenu: [
        {
          id: OPEN_AT_LOGIN_ID,
          label: OPEN_AT_LOGIN_LABEL,
          type: "checkbox",
          checked: resolved.openAtLogin,
          click: (item) => {
            onToggleOpenAtLogin?.(Boolean(item?.checked));
          },
        },
        {
          id: RUN_ON_LOCK_SCREEN_ID,
          label: RUN_ON_LOCK_SCREEN_LABEL,
          type: "checkbox",
          checked: resolved.runOnLockScreen,
          click: (item) => {
            onToggleRunOnLockScreen?.(Boolean(item?.checked));
          },
        },
      ],
    },
  ];
}

module.exports = {
  AUTOSTART_FLAG,
  SETTINGS_MENU_ID,
  SETTINGS_MENU_LABEL,
  OPEN_AT_LOGIN_ID,
  OPEN_AT_LOGIN_LABEL,
  RUN_ON_LOCK_SCREEN_ID,
  RUN_ON_LOCK_SCREEN_LABEL,
  DEFAULT_LOGIN_ITEM_NAME,
  LEGACY_LOGIN_ITEM_NAME,
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
};
