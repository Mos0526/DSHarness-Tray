"use strict";

const { buildViewModel } = require("./view-model");

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ""));
}

function attachPluginCenterIpc(win, { ipcMain, shell, clipboard, loadSnapshot, actions } = {}) {
  if (!win || !ipcMain) throw new Error("attachPluginCenterIpc requires win and ipcMain");

  const handles = [];
  const handle = (channel, fn) => {
    ipcMain.handle(channel, fn);
    handles.push(channel);
  };

  const pushSnapshot = async () => {
    const raw = await loadSnapshot();
    const model = raw?.plugins && raw?.filters ? raw : buildViewModel(raw || {});
    if (!win.isDestroyed()) win.webContents.send("plugin-center:snapshot", model);
    return model;
  };

  const fromThisWindow = (event) => event.sender === win.webContents;
  const operationReporter = (id, method) => (update = {}) => {
    if (win.isDestroyed()) return;
    win.webContents.send("plugin-center:operation", {
      id,
      method,
      stage: update.stage || "",
      message: update.message || "",
      done: Boolean(update.done),
      ok: update.ok,
    });
  };

  handle("plugin-center:ready", async (event) => {
    if (!fromThisWindow(event)) return null;
    return pushSnapshot();
  });
  handle("plugin-center:refresh", async (event) => {
    if (!fromThisWindow(event)) return null;
    if (typeof actions?.refresh === "function") await actions.refresh();
    return pushSnapshot();
  });
  handle("plugin-center:enrich", async (event, payload) => {
    if (!fromThisWindow(event)) return null;
    const ids = Array.isArray(payload) ? payload : payload?.ids || [];
    const detailIds = Array.isArray(payload) ? [] : payload?.detailIds || [];
    const force = Boolean(!Array.isArray(payload) && payload?.force);
    if (typeof actions?.enrichVisible === "function") {
      await actions.enrichVisible(ids, { detailIds, force });
    }
    return pushSnapshot();
  });
  handle("plugin-center:install", async (event, id) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    const pluginId = String(id);
    const report = operationReporter(pluginId, "install");
    report({ stage: "prepare", message: "正在准备安装…" });
    const result = await actions.install(pluginId, { onProgress: report });
    report({ stage: result?.ok === false ? "failed" : "done", message: result?.ok === false ? result.error : "安装完成", done: true, ok: result?.ok !== false });
    await pushSnapshot();
    return result;
  });
  handle("plugin-center:uninstall", async (event, id) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    const pluginId = String(id);
    const report = operationReporter(pluginId, "uninstall");
    report({ stage: "remove", message: "正在卸载…" });
    const result = await actions.uninstall(pluginId, { onProgress: report });
    report({ stage: result?.ok === false ? "failed" : "done", message: result?.ok === false ? result.error : "卸载完成", done: true, ok: result?.ok !== false });
    await pushSnapshot();
    return result;
  });
  handle("plugin-center:upgrade", async (event, id) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    const pluginId = String(id);
    const report = operationReporter(pluginId, "upgrade");
    report({ stage: "prepare", message: "正在准备升级…" });
    const result = await actions.upgrade(pluginId, { onProgress: report });
    report({ stage: result?.ok === false ? "failed" : "done", message: result?.ok === false ? result.error : "升级完成", done: true, ok: result?.ok !== false });
    await pushSnapshot();
    return result;
  });
  handle("plugin-center:open-quarantine", async (event, id) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    return actions.openQuarantine(String(id));
  });
  handle("plugin-center:toggle-favorite", async (event, payload) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "收藏信息无效" };
    }
    try {
      const result = await actions.toggleFavorite({
        id: String(payload.id || ""),
        name: String(payload.name || ""),
        npmName: String(payload.npmName || ""),
        repositoryUrl: String(payload.repositoryUrl || ""),
      }, typeof payload.favorite === "boolean" ? payload.favorite : undefined);
      const model = await pushSnapshot();
      return { ...result, model };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  handle("plugin-center:open-external", async (event, url) => {
    if (!fromThisWindow(event)) return { ok: false };
    if (!isHttpUrl(url)) return { ok: false, error: "拒绝打开该链接" };
    if (shell?.openExternal) await shell.openExternal(url);
    return { ok: true };
  });
  handle("plugin-center:copy-text", async (event, text) => {
    if (!fromThisWindow(event)) return { ok: false, error: "窗口不匹配" };
    const value = String(text || "");
    if (!value || value.length > 1_000 || !/^npm install\s/i.test(value)) {
      return { ok: false, error: "拒绝复制该内容" };
    }
    if (!clipboard?.writeText) return { ok: false, error: "剪贴板不可用" };
    clipboard.writeText(value);
    return { ok: true };
  });

  const detach = () => {
    for (const channel of handles) {
      if (typeof ipcMain.removeHandler === "function") ipcMain.removeHandler(channel);
    }
    handles.length = 0;
  };
  win.on("closed", detach);
  return { pushSnapshot, detach };
}

module.exports = { attachPluginCenterIpc };
