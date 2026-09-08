"use strict";

const { buildViewModel, filterPlugins, queryPlugins } = require("./view-model");
const { createPluginCenterWindow, openPluginCenter, getPluginCenterWindow, resetPluginCenterWindow, UI_INDEX, PRELOAD } = require("./window");
const { createFacade } = require("./facade");
const { PluginCenterSession, emptySnapshot } = require("./session");
const { demoSnapshot } = require("./demo-snapshot");
const { createFavoritesStore } = require("./favorites");

module.exports = {
  buildViewModel,
  filterPlugins,
  queryPlugins,
  createPluginCenterWindow,
  openPluginCenter,
  getPluginCenterWindow,
  resetPluginCenterWindow,
  createFacade,
  PluginCenterSession,
  emptySnapshot,
  demoSnapshot,
  createFavoritesStore,
  UI_INDEX,
  PRELOAD,
};
