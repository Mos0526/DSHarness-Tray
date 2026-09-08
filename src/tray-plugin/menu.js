"use strict";

const { computeBadge } = require("./badge");

const PLUGIN_MENU_ID = "plugin-center";
const PLUGIN_MENU_LABEL = "插件商店";
const PLUGIN_MENU_BADGE_MARK = "•";

function pluginMenuLabel(badge) {
  return badge?.show ? `${PLUGIN_MENU_LABEL}  ${PLUGIN_MENU_BADGE_MARK}` : PLUGIN_MENU_LABEL;
}

/**
 * Single tray entry for the plugin center. No quarantine/upgrade submenu.
 *
 * @param {{ onOpen?: () => void, badge?: { show?: boolean, reasons?: string[] } | { plugins?: object[], lifecycle?: object } }} options
 * @returns {Electron.MenuItemConstructorOptions[]}
 */
function buildPluginMenuItems({ onOpen, badge } = {}) {
  const resolved = badge && typeof badge === "object" && ("show" in badge || "reasons" in badge)
    ? { show: Boolean(badge.show), reasons: badge.reasons || [] }
    : computeBadge(badge || {});
  return [
    {
      id: PLUGIN_MENU_ID,
      label: pluginMenuLabel(resolved),
      click: () => {
        onOpen?.();
      },
    },
  ];
}

module.exports = {
  PLUGIN_MENU_ID,
  PLUGIN_MENU_LABEL,
  PLUGIN_MENU_BADGE_MARK,
  pluginMenuLabel,
  buildPluginMenuItems,
};
