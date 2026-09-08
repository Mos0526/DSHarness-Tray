"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createSupervisor } = require("../../../src/runtime/dsh-supervisor");
const { createProtocol } = require("../../../src/adapters/dsh-protocol");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createFakeChild({ pid = 4242 } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = pid;
  child.killed = false;
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (signal = "SIGTERM") => {
    child.killed = true;
    child.exitCode = 0;
    child.signalCode = signal;
    queueMicrotask(() => child.emit("exit", 0, signal));
  };
  child.crash = (code = 1, signal = null) => {
    child.exitCode = code;
    child.signalCode = signal;
    queueMicrotask(() => child.emit("exit", code, signal));
  };
  child.say = (line) => {
    child.stdout.write(`${line}\n`);
  };
  return child;
}

function createFakeSpawn(bag) {
  let nextPid = 1000;
  return (command, args, options) => {
    const child = createFakeChild({ pid: nextPid++ });
    bag.last = { command, args, options, child };
    bag.spawns.push(bag.last);
    return child;
  };
}

describe("createSupervisor crash isolation", () => {
  it("keeps the supervisor alive when the child crashes", async () => {
    const bag = { spawns: [] };
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: false,
    });

    let exitCalled = 0;
    const realExit = process.exit;
    process.exit = () => {
      exitCalled += 1;
    };

    const crashes = [];
    supervisor.on("crash", (event) => crashes.push(event));

    try {
      const starting = supervisor.start({
        dshBinary: "E:/fake/dsh/lib/bin.js",
        dshHome: "E:/fake/dsh/homes/active",
        mode: "active",
        nodeBinary: "E:/fake/node.exe",
      });
      await delay(0);
      bag.last.child.say("dsh web: http://127.0.0.1:3456");
      await starting;

      bag.last.child.crash(7, null);
      await delay(10);

      assert.equal(exitCalled, 0);
      assert.equal(supervisor.getStatus().state, "crashed");
      assert.equal(crashes.length, 1);
      assert.equal(crashes[0].classification.kind, "crash");
      assert.equal(typeof supervisor.start, "function");
      assert.equal(typeof supervisor.stop, "function");
    } finally {
      process.exit = realExit;
      await supervisor.stop();
    }
  });

  it("includes redacted DSH output when startup exits early", async () => {
    const bag = { spawns: [] };
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: false,
    });
    const starting = supervisor.start({
      dshBinary: "E:/fake/dsh/lib/bin.js",
      dshHome: "E:/fake/dsh/homes/active",
      mode: "active",
      nodeBinary: "E:/fake/node.exe",
    });
    const rejected = assert.rejects(starting, (error) => {
      assert.match(error.message, /plugin tree failed to load/);
      assert.match(error.message, /token=\[redacted\]/);
      assert.doesNotMatch(error.message, /top-secret/);
      assert.doesNotMatch(error.message, /alice/);
      assert.match(error.message, /C:\\Users\\\[user\]/);
      return true;
    });
    await delay(0);
    bag.last.child.stderr.write(
      "plugin tree failed to load\nrequest failed at /?token=top-secret\nopen C:\\Users\\alice\\.dsh\n",
    );
    bag.last.child.crash(1, null);
    await rejected;

    assert.match(supervisor.getStatus().lastExit.recentOutput, /plugin tree failed to load/);
    assert.doesNotMatch(supervisor.getStatus().recentOutput, /top-secret/);
  });
});

describe("safe mode injection", () => {
  it("starts safe mode with an isolated DSH_HOME and default web argv", async () => {
    const bag = { spawns: [] };
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: false,
    });

    const starting = supervisor.start({
      dshBinary: "E:/fake/dsh/lib/bin.js",
      dshHome: "E:/fake/dsh/homes/safe",
      mode: "safe",
      nodeBinary: "E:/fake/node.exe",
      extraEnv: { DSH_PERMISSION_MODE: "workspace-write" },
    });
    await delay(0);
    bag.last.child.say("dsh web: http://127.0.0.1:3080");
    const status = await starting;

    assert.equal(status.state, "running");
    assert.equal(status.mode, "safe");
    assert.equal(bag.last.options.env.DSH_HOME, "E:/fake/dsh/homes/safe");
    assert.equal(bag.last.options.env.DSH_PERMISSION_MODE, "workspace-write");
    assert.deepEqual(bag.last.args.slice(1), ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"]);
    assert.equal(bag.last.command, "E:/fake/node.exe");
    await supervisor.stop();
    assert.equal(supervisor.getStatus().state, "stopped");
  });

  it("uses a replacement protocol argv builder when provided", async () => {
    const bag = { spawns: [] };
    const protocol = createProtocol({
      buildArgv() {
        return ["--profile", "web", "--bind", "loopback"];
      },
    });
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      protocol,
      autoRecoverSafe: false,
    });

    const starting = supervisor.start({
      dshBinary: "E:/fake/dsh.exe",
      dshHome: "E:/fake/dsh/homes/staging",
      mode: "staging",
    });
    await delay(0);
    bag.last.child.say("dsh web: http://127.0.0.1:1");
    await starting;

    assert.deepEqual(bag.last.args, ["--profile", "web", "--bind", "loopback"]);
    await supervisor.stop();
  });
});

describe("status machine and safe recover", () => {
  it("walks stopped → starting → running → stopping → stopped", async () => {
    const bag = { spawns: [] };
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: false,
    });
    const seen = [];
    supervisor.on("status", (status) => seen.push(status.state));

    const starting = supervisor.start({
      dshBinary: "E:/fake/dsh.exe",
      dshHome: "E:/fake/homes/active",
      mode: "active",
    });
    assert.equal(supervisor.getStatus().state, "starting");
    await delay(0);
    bag.last.child.say("dsh web: http://127.0.0.1:9");
    await starting;
    assert.equal(supervisor.getStatus().state, "running");
    await supervisor.stop();
    assert.equal(supervisor.getStatus().state, "stopped");
    assert.ok(seen.includes("starting"));
    assert.ok(seen.includes("running"));
    assert.ok(seen.includes("stopping") || seen.includes("stopped"));
  });

  it("can immediately replace a failed active start with a safe start", async () => {
    const bag = { spawns: [] };
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: true,
      backoffMs: [1_000],
    });
    const active = supervisor.start({
      dshBinary: "E:/fake/dsh.exe",
      dshHome: "E:/fake/homes/active",
      mode: "active",
    });
    const activeRejected = assert.rejects(active, /plugin incompatible/);
    await delay(0);
    bag.last.child.stderr.write("plugin incompatible\n");
    bag.last.child.crash(1, null);
    await activeRejected;

    const safe = supervisor.start({
      dshBinary: "E:/fake/dsh.exe",
      dshHome: "E:/fake/homes/safe",
      mode: "safe",
    });
    await delay(0);
    bag.last.child.say("dsh web: http://127.0.0.1:10");
    const status = await safe;

    assert.equal(bag.spawns.length, 2);
    assert.equal(status.state, "running");
    assert.equal(status.mode, "safe");
    await supervisor.stop();
  });

  it("uses killFn when stopping so the whole process tree can be reaped", async () => {
    const bag = { spawns: [] };
    const killed = [];
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: false,
      killFn: (child, signal) => {
        killed.push({ pid: child.pid, signal });
        child.kill(signal || "SIGKILL");
      },
    });

    const starting = supervisor.start({
      dshBinary: "E:/fake/dsh.exe",
      dshHome: "E:/fake/homes/active",
      mode: "active",
    });
    await delay(0);
    bag.last.child.say("dsh web: http://127.0.0.1:11");
    await starting;

    await supervisor.stop();
    assert.ok(killed.some((row) => row.pid === bag.spawns[0].child.pid));
    assert.equal(supervisor.getStatus().state, "stopped");
  });

  it("restarts in safe mode after a crash when autoRecoverSafe is on", async () => {
    const bag = { spawns: [] };
    const supervisor = createSupervisor({
      spawnFn: createFakeSpawn(bag),
      autoRecoverSafe: true,
      backoffMs: [15],
      maxRecoveries: 1,
    });

    const starting = supervisor.start({
      dshBinary: "E:/fake/dsh.exe",
      dshHome: "E:/fake/homes/active",
      mode: "active",
    });
    await delay(0);
    bag.last.child.say("dsh web: http://127.0.0.1:9");
    await starting;

    bag.last.child.crash(1, null);
    await delay(40);
    if (bag.spawns[1]) {
      bag.spawns[1].child.say("dsh web: http://127.0.0.1:10");
    }
    await delay(20);

    assert.ok(bag.spawns.length >= 2);
    assert.equal(supervisor.getStatus().mode, "safe");
    assert.match(String(bag.spawns[1].options.env.DSH_HOME).replace(/\\/g, "/"), /\/homes\/safe$/);
    await supervisor.stop();
  });
});
