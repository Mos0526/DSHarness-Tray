"use strict";

const { computeBadge, BADGE_REASONS } = require("./badge");
const {
  buildPluginMenuItems,
  pluginMenuLabel,
  PLUGIN_MENU_ID,
  PLUGIN_MENU_LABEL,
  PLUGIN_MENU_BADGE_MARK,
} = require("./menu");

module.exports = {
  BADGE_REASONS,
  computeBadge,
  buildPluginMenuItems,
  pluginMenuLabel,
  PLUGIN_MENU_ID,
  PLUGIN_MENU_LABEL,
  PLUGIN_MENU_BADGE_MARK,
};
