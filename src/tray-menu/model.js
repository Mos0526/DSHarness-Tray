"use strict";

const { computeBadge, pluginMenuLabel, PLUGIN_MENU_ID } = require("../tray-plugin");
const {
  SETTINGS_MENU_ID,
  SETTINGS_MENU_LABEL,
  OPEN_AT_LOGIN_ID,
  OPEN_AT_LOGIN_LABEL,
  RUN_ON_LOCK_SCREEN_ID,
  RUN_ON_LOCK_SCREEN_LABEL,
  normalizeSettings,
} = require("../shell-settings");

const OPEN_WINDOW_ID = "open-window";
const OPEN_DSH_ID = "open-dsh";
const ABOUT_ID = "about";
const QUIT_ID = "quit";

const PANEL_WIDTH = 200;
const SHADOW_PAD = 12;
const POPUP_GAP = 4;
const DEFAULT_PANEL_HEIGHT = 360;

const TOGGLE_IDS = new Set([OPEN_AT_LOGIN_ID, RUN_ON_LOCK_SCREEN_ID]);

function resolveBadge(badge) {
  if (badge && typeof badge === "object" && ("show" in badge || "reasons" in badge)) {
    return { show: Boolean(badge.show), reasons: badge.reasons || [] };
  }
  return computeBadge(badge || {});
}

function command(id, label, icon, extra = {}) {
  return {
    id,
    label,
    type: "command",
    icon,
    enabled: extra.enabled !== false,
    badge: Boolean(extra.badge),
    danger: Boolean(extra.danger),
  };
}

function toggle(id, label, checked) {
  return {
    id,
    label,
    type: "toggle",
    icon: null,
    enabled: true,
    checked: Boolean(checked),
    badge: false,
    danger: false,
  };
}

/**
 * Custom tray popup model. Settings sit above 关于与更新 as a labeled section
 * with inline switches, not a nested submenu.
 */
function buildTrayMenuModel({
  appName = "DS harness",
  updating = false,
  badge,
  settings,
} = {}) {
  const resolvedBadge = resolveBadge(badge);
  const prefs = normalizeSettings(settings);
  return {
    appName,
    updating: Boolean(updating),
    groups: [
      {
        id: "main",
        items: [
          command(OPEN_WINDOW_ID, "打开窗口", "window", { enabled: !updating }),
          command(OPEN_DSH_ID, "打开 .dsh 目录", "folder", { enabled: !updating }),
          command(PLUGIN_MENU_ID, pluginMenuLabel(resolvedBadge), "plugin", { badge: resolvedBadge.show }),
        ],
      },
      {
        id: SETTINGS_MENU_ID,
        label: SETTINGS_MENU_LABEL,
        items: [
          toggle(OPEN_AT_LOGIN_ID, OPEN_AT_LOGIN_LABEL, prefs.openAtLogin),
          toggle(RUN_ON_LOCK_SCREEN_ID, RUN_ON_LOCK_SCREEN_LABEL, prefs.runOnLockScreen),
        ],
      },
      {
        id: "about",
        items: [
          command(ABOUT_ID, updating ? "正在更新…" : "关于与更新", "info", { enabled: !updating }),
        ],
      },
      {
        id: "quit",
        items: [command(QUIT_ID, "退出", "quit", { danger: true })],
      },
    ],
  };
}

function isToggleItem(id) {
  return TOGGLE_IDS.has(String(id || ""));
}

function groupOrder(model) {
  return (model?.groups || []).map((group) => group.id);
}

function windowSizeForPanel(panelHeight, { width = PANEL_WIDTH, shadow = SHADOW_PAD } = {}) {
  const height = Math.max(1, Math.ceil(Number(panelHeight) || DEFAULT_PANEL_HEIGHT));
  return {
    width: width + shadow * 2,
    height: height + shadow * 2,
  };
}

function placeTrayPopup({
  trayBounds = { x: 0, y: 0, width: 24, height: 24 },
  menuSize = windowSizeForPanel(DEFAULT_PANEL_HEIGHT),
  workArea = { x: 0, y: 0, width: 1920, height: 1040 },
  gap = POPUP_GAP,
  shadow = SHADOW_PAD,
} = {}) {
  const width = Math.max(1, Math.round(menuSize.width));
  const height = Math.max(1, Math.round(menuSize.height));
  const iconX = Number(trayBounds.x) || 0;
  const iconY = Number(trayBounds.y) || 0;
  const iconW = Number(trayBounds.width) || 24;
  const iconH = Number(trayBounds.height) || 24;
  const areaX = Number(workArea.x) || 0;
  const areaY = Number(workArea.y) || 0;
  const areaW = Number(workArea.width) || width;
  const pad = Math.max(0, Math.round(Number(shadow) || 0));
  const visualGap = Math.round(Number(gap) || 0);

  let x = Math.round(iconX + iconW / 2 - width / 2);
  // menuSize includes shadow padding; sit the visible panel `visualGap` from the icon.
  let y = Math.round(iconY - height + pad - visualGap);
  if (y + pad < areaY + visualGap) y = Math.round(iconY + iconH - pad + visualGap);

  const minX = areaX - pad + visualGap;
  const maxX = areaX + areaW - width + pad - visualGap;
  const minY = areaY - pad + visualGap;
  x = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  if (y < minY) y = minY;
  return { x, y, width, height };
}

const BLUR_GRACE_MS = 400;
const TRAY_LEFT_CLICK_DELAY_MS = 80;

function createTrayClickGuard({ delayMs = TRAY_LEFT_CLICK_DELAY_MS } = {}) {
  let timer;
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return {
    leftClick(fn) {
      cancel();
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, delayMs);
    },
    rightClick(fn) {
      cancel();
      fn();
    },
    cancel,
  };
}

function shouldIgnoreBlur(openedAt, now = Date.now(), graceMs = BLUR_GRACE_MS) {
  return Number(openedAt) > 0 && now - openedAt < graceMs;
}

function sameBounds(a, b) {
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

module.exports = {
  OPEN_WINDOW_ID,
  OPEN_DSH_ID,
  ABOUT_ID,
  QUIT_ID,
  PANEL_WIDTH,
  SHADOW_PAD,
  POPUP_GAP,
  DEFAULT_PANEL_HEIGHT,
  TOGGLE_IDS,
  buildTrayMenuModel,
  isToggleItem,
  groupOrder,
  windowSizeForPanel,
  placeTrayPopup,
  BLUR_GRACE_MS,
  TRAY_LEFT_CLICK_DELAY_MS,
  shouldIgnoreBlur,
  sameBounds,
  createTrayClickGuard,
};
