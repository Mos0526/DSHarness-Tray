"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { terminateProcessTree, terminateChildTree } = require("../../../src/runtime/process-tree");

describe("terminateProcessTree", () => {
  it("runs taskkill /T /F on Windows so DSH grandchildren are reaped", () => {
    const calls = [];
    const ok = terminateProcessTree(4321, {
      platform: "win32",
      systemRoot: "C:\\Windows",
      execFileSync: (cmd, args, opts) => {
        calls.push({ cmd, args, opts });
      },
    });
    assert.equal(ok, true);
    assert.match(calls[0].cmd.replace(/\\/g, "/"), /\/System32\/taskkill\.exe$/i);
    assert.deepEqual(calls[0].args, ["/pid", "4321", "/t", "/f"]);
    assert.equal(calls[0].opts.windowsHide, true);
  });

  it("signals the pid off Windows", () => {
    const killed = [];
    const ok = terminateProcessTree(9, {
      platform: "linux",
      kill: (pid, signal) => {
        killed.push([pid, signal]);
      },
    });
    assert.equal(ok, true);
    assert.deepEqual(killed, [[9, "SIGTERM"]]);
  });

  it("returns false for an invalid pid", () => {
    assert.equal(terminateProcessTree(0), false);
    assert.equal(terminateProcessTree("nope"), false);
  });
});

describe("terminateChildTree", () => {
  it("falls back to child.kill when the pid cannot be reaped", () => {
    const signals = [];
    const child = {
      pid: 0,
      kill(signal) {
        signals.push(signal);
      },
    };
    assert.equal(terminateChildTree(child), true);
    assert.deepEqual(signals, ["SIGTERM"]);
  });
});
