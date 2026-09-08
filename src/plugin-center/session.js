"use strict";

const { buildViewModel } = require("./view-model");

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function emptySnapshot(now = Date.now()) {
  return {
    now,
    catalog: { entries: [], stale: false, fetchedAt: now },
    lifecycle: { items: [] },
    receipts: [],
    signals: { stale: false, fetchedAt: now },
  };
}

function findLife(state, id) {
  const items = state.lifecycle.items || (state.lifecycle.items = []);
  let item = items.find((row) => row.id === id);
  if (!item) {
    item = { id };
    items.push(item);
  }
  return item;
}

function findEntry(state, id) {
  return (state.catalog.entries || []).find((row) => row.id === id);
}

class PluginCenterSession {
  constructor(initial) {
    this.state = clone(initial && Object.keys(initial).length ? initial : emptySnapshot());
    if (!this.state.lifecycle) this.state.lifecycle = { items: [] };
    if (!Array.isArray(this.state.lifecycle.items)) this.state.lifecycle.items = [];
    if (!this.state.receipts) this.state.receipts = [];
    this._installWaiters = new Map();
  }

  raw() {
    return clone(this.state);
  }

  snapshot() {
    return buildViewModel(this.raw());
  }

  _receipt(partial) {
    const row = { at: Date.now(), ...partial };
    this.state.receipts.push(row);
    return row;
  }

  async install(id, { signal, defer = false } = {}) {
    if (signal?.aborted) {
      this._receipt({ id, op: "install", status: "aborted" });
      const life = findLife(this.state, id);
      life.state = "available";
      life.installed = false;
      life.interrupted = true;
      return { ok: false, interrupted: true, error: "安装已中断" };
    }
    const entry = findEntry(this.state, id);
    const life = findLife(this.state, id);
    life.state = "staging";
    life.installed = true;
    life.interrupted = false;
    if (!defer) return this.completeInstall(id);

    const waiter = {};
    waiter.promise = new Promise((resolve) => {
      waiter.resolve = resolve;
    });
    this._installWaiters.set(id, waiter);

    const abort = () => {
      if (!this._installWaiters.has(id)) return;
      this._receipt({ id, op: "install", status: "aborted", version: entry?.exactVersion });
      life.state = "available";
      life.installed = false;
      life.interrupted = true;
      this._installWaiters.delete(id);
      waiter.resolve({ ok: false, interrupted: true, error: "安装已中断" });
    };
    if (signal) signal.addEventListener("abort", abort, { once: true });

    const result = await waiter.promise;
    this._installWaiters.delete(id);
    return result;
  }

  completeInstall(id, { fail = false } = {}) {
    const waiter = this._installWaiters.get(id);
    const entry = findEntry(this.state, id);
    const life = findLife(this.state, id);
    if (fail) {
      life.state = "failed";
      life.verifyFailed = true;
      this._receipt({ id, op: "install", status: "failed", version: entry?.exactVersion });
      const result = { ok: false, error: "安装失败" };
      waiter?.resolve(result);
      return result;
    }
    life.state = "active";
    life.installed = true;
    life.interrupted = false;
    life.installedVersion = entry?.exactVersion || entry?.latestVersion || "0.0.0";
    life.availableVersion = entry?.latestVersion || life.installedVersion;
    life.verify = { host: "pass", renderer: "pass", ok: true };
    this._receipt({ id, op: "install", status: "committed", version: life.installedVersion, integrity: entry?.integrity });
    const result = { ok: true };
    waiter?.resolve(result);
    if (!waiter) return result;
    return result;
  }

  async uninstall(id) {
    const life = findLife(this.state, id);
    const version = life.installedVersion;
    life.state = "available";
    life.installed = false;
    life.quarantined = false;
    life.verifyFailed = false;
    life.updateAvailable = false;
    delete life.verify;
    delete life.installedVersion;
    this._receipt({ id, op: "uninstall", status: "committed", version });
    return { ok: true };
  }

  async upgrade(id) {
    const entry = findEntry(this.state, id);
    const life = findLife(this.state, id);
    const next = life.availableVersion || entry?.latestVersion;
    if (!next) return { ok: false, error: "没有可升级版本" };
    life.installedVersion = next;
    life.updateAvailable = false;
    life.state = "active";
    life.quarantined = false;
    life.verifyFailed = false;
    life.verify = { host: "pass", renderer: "pass", ok: true };
    this._receipt({ id, op: "upgrade", status: "committed", version: next });
    return { ok: true, version: next };
  }

  async openQuarantine(id) {
    const model = this.snapshot();
    return { ok: true, plugin: model.plugins.find((row) => row.id === id) || null };
  }

  interruptInstall(id) {
    const waiter = this._installWaiters.get(id);
    const life = findLife(this.state, id);
    life.state = "available";
    life.installed = false;
    life.interrupted = true;
    this._receipt({ id, op: "install", status: "aborted" });
    const result = { ok: false, interrupted: true, error: "安装已中断" };
    waiter?.resolve(result);
    return result;
  }
}

module.exports = {
  PluginCenterSession,
  emptySnapshot,
};
