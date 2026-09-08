"use strict";

const model = require("./model");
const {
  UI_INDEX,
  PRELOAD,
  createTrayMenuWindow,
  prepareTrayMenu,
  openTrayMenu,
  hideTrayMenu,
  refreshTrayMenu,
  getTrayMenuWindow,
  isTrayMenuOpen,
  resetTrayMenuWindow,
  applyPopupWindowSwitches,
  PARK_X,
} = require("./window");

module.exports = {
  ...model,
  UI_INDEX,
  PRELOAD,
  PARK_X,
  createTrayMenuWindow,
  prepareTrayMenu,
  openTrayMenu,
  hideTrayMenu,
  refreshTrayMenu,
  getTrayMenuWindow,
  isTrayMenuOpen,
  resetTrayMenuWindow,
  applyPopupWindowSwitches,
};
