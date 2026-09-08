"use strict";

const { demoSnapshot } = require("../../src/plugin-center/demo-snapshot");

function crashSnapshot(now = Date.now()) {
  return {
    now,
    catalog: {
      stale: true,
      sourceError: "network",
      fetchedAt: now - 3 * 24 * 60 * 60 * 1000,
      entries: [
        {
          id: "crashy-host",
          name: "dsh-crashy-host",
          description: "Host crashed",
          exactVersion: "2.0.0",
          latestVersion: "2.0.0",
          integrity: "sha512-crash",
          inAwesomeDshPlugin: true,
        },
      ],
    },
    lifecycle: {
      items: [
        {
          id: "crashy-host",
          state: "quarantined",
          installed: true,
          installedVersion: "2.0.0",
          verify: { host: "fail", renderer: "skipped", ok: false, reason: "Host 启动时进程退出。", stage: "host-boot" },
        },
      ],
    },
    receipts: [{ id: "crashy-host", op: "verify", status: "failed", version: "2.0.0", at: now }],
    signals: { stale: true, fetchedAt: now - 3 * 24 * 60 * 60 * 1000 },
  };
}

function rendererFailSnapshot(now = Date.now()) {
  return {
    now,
    catalog: {
      entries: [{ id: "renderer-flake", name: "dsh-renderer-flake", exactVersion: "1.0.4", inAwesomeDeepseekHarness: true }],
    },
    lifecycle: {
      items: [
        {
          id: "renderer-flake",
          state: "failed",
          installed: true,
          installedVersion: "1.0.4",
          verifyFailed: true,
          verify: { host: "pass", renderer: "fail", ok: false, reason: "Renderer 未就绪", stage: "renderer-settle" },
        },
      ],
    },
    receipts: [],
    signals: { stale: false, fetchedAt: now },
  };
}

function outdatedSnapshot(now = Date.now()) {
  return {
    now,
    catalog: {
      entries: [
        {
          id: "fixture.outdated",
          name: "dsh-fixture-outdated",
          npmName: "dsh-fixture-outdated",
          exactVersion: "1.0.0",
          latestVersion: "2.0.0",
          inAwesomeDshPlugin: true,
        },
      ],
    },
    lifecycle: {
      items: [
        {
          id: "fixture.outdated",
          state: "quarantined",
          installed: true,
          installedVersion: "1.0.0",
          availableVersion: "2.0.0",
          updateAvailable: true,
          lastGoodVersion: "",
          verify: { host: "fail", renderer: "fail", ok: false, reason: "当前版本与 DSH 不兼容" },
        },
      ],
    },
    receipts: [],
    signals: { stale: false, fetchedAt: now },
  };
}

module.exports = {
  demoSnapshot,
  crashSnapshot,
  rendererFailSnapshot,
  outdatedSnapshot,
};
