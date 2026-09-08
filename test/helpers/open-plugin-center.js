"use strict";

const { app } = require("electron");
const { openPluginCenter } = require("../../src/plugin-center/window");
const { demoSnapshot } = require("../../src/plugin-center/demo-snapshot");
const { PluginCenterSession } = require("../../src/plugin-center/session");

app.whenReady().then(() => {
  const session = new PluginCenterSession(demoSnapshot());
  const win = openPluginCenter({
    session,
    title: "插件",
  });
  win.on("closed", () => app.quit());
});
