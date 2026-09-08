"use strict";

/**
 * DSH child-process supervisor.
 *
 * The Electron/tray shell must stay alive if a plugin crashes the DSH
 * host. This module never calls `process.exit` and never lets child
 * `error`/`exit` events become unhandled exceptions on the shell.
 *
 * Official DSH (CLI reference): SIGTERM is a supervisor stop and exits 0;
 * unexpected nonzero / signals are crashes. After a crash the product
 * policy is to return to plugin-free `safe` mode (separate DSH_HOME).
 */

const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { basename, dirname, join } = require("node:path");
const defaultProtocol = require("../adapters/dsh-protocol");
const { HOME_KINDS } = require("./dsh-paths");
const { redactDiagnosticText } = require("./redact");

const STATES = Object.freeze(["stopped", "starting", "running", "crashed", "stopping"]);
const MODES = Object.freeze(["safe", "active", "staging"]);
const DEFAULT_BACKOFF_MS = Object.freeze([250, 500, 1000, 2000, 4000]);
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RECOVERIES = 5;
const MAX_RECENT_OUTPUT = 12_000;

function isJsEntry(filePath) {
  return /\.(c|m)?js$/i.test(String(filePath || ""));
}

function invokeSpawn(spawnFn, spec) {
  if (typeof spawnFn !== "function") {
    throw new Error("spawnFn is required");
  }
  if (spawnFn.length >= 2) {
    return spawnFn(spec.command, spec.args, {
      env: spec.env,
      cwd: spec.cwd,
      windowsHide: true,
      stdio: spec.stdio || ["ignore", "pipe", "pipe"],
    });
  }
  return spawnFn(spec);
}

function defaultSpawn(command, args, options) {
  return spawn(command, args, options);
}

function homeForMode(dshHome, mode) {
  if (!dshHome || !mode) return dshHome;
  const kind = basename(dshHome);
  const parent = dirname(dshHome);
  if (HOME_KINDS.includes(kind) && basename(parent) === "homes") {
    return join(parent, mode);
  }
  return dshHome;
}

function noopLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

function createSupervisor({ spawnFn, protocol, logger, autoRecoverSafe, backoffMs, maxRecoveries, killFn } = {}) {
  const proto = protocol || defaultProtocol;
  const log = logger || noopLogger();
  const spawnImpl = spawnFn || defaultSpawn;
  const recoverOnCrash = autoRecoverSafe !== false;
  const delays = Array.isArray(backoffMs) && backoffMs.length ? backoffMs : DEFAULT_BACKOFF_MS;
  const recoverLimit = Number.isFinite(maxRecoveries) ? maxRecoveries : DEFAULT_MAX_RECOVERIES;

  const emitter = new EventEmitter();
  emitter.setMaxListeners(50);

  const supervisor = {
    _state: "stopped",
    _child: undefined,
    _pid: undefined,
    _mode: undefined,
    _dshHome: undefined,
    _dshBinary: undefined,
    _lastStart: undefined,
    _lastExit: undefined,
    _crashCount: 0,
    _recoverCount: 0,
    _startedAt: undefined,
    _readyUrl: undefined,
    _stopping: false,
    _startGeneration: 0,
    _recoverTimer: undefined,
    _lineBuffers: { stdout: "", stderr: "" },
    _recentOutput: "",
  };

  function emitStatus() {
    emitter.emit("status", getStatus());
  }

  function setState(next) {
    if (supervisor._state === next) return;
    supervisor._state = next;
    emitStatus();
  }

  function getStatus() {
    return {
      state: supervisor._state,
      mode: supervisor._mode,
      pid: supervisor._pid,
      dshHome: supervisor._dshHome,
      dshBinary: supervisor._dshBinary,
      lastExit: supervisor._lastExit,
      crashCount: supervisor._crashCount,
      recoverCount: supervisor._recoverCount,
      startedAt: supervisor._startedAt,
      readyUrl: supervisor._readyUrl,
      recentOutput: supervisor._recentOutput,
    };
  }

  function clearRecoverTimer() {
    if (supervisor._recoverTimer) {
      clearTimeout(supervisor._recoverTimer);
      supervisor._recoverTimer = undefined;
    }
  }

  function appendRecentOutput(chunk) {
    supervisor._recentOutput += redactDiagnosticText(chunk);
    if (supervisor._recentOutput.length > MAX_RECENT_OUTPUT) {
      supervisor._recentOutput = supervisor._recentOutput.slice(-MAX_RECENT_OUTPUT);
    }
  }

  function failureError(message) {
    const output = supervisor._recentOutput.trim();
    return new Error(output ? `${message}\n\nDSH 输出：\n${output}` : message);
  }

  function handleOutputChunk(source, chunk) {
    appendRecentOutput(chunk);
    supervisor._lineBuffers[source] += String(chunk);
    const lines = supervisor._lineBuffers[source].split(/\r?\n/);
    supervisor._lineBuffers[source] = lines.pop() ?? "";
    for (const line of lines) {
      emitter.emit(source, line);
      let parsed;
      try {
        parsed = proto.parseStdoutLine(line);
      } catch (error) {
        log.warn?.("parseStdoutLine failed", error);
        continue;
      }
      if (parsed && parsed.type === "ready" && parsed.url && !supervisor._readyUrl) {
        supervisor._readyUrl = parsed.url;
        emitStatus();
      }
    }
  }

  function detachChild(child) {
    if (!child) return;
    child.removeAllListeners("exit");
    child.removeAllListeners("close");
    child.removeAllListeners("error");
    child.stdout?.removeAllListeners("data");
    child.stderr?.removeAllListeners("data");
  }

  function scheduleSafeRecover(generation) {
    if (!recoverOnCrash) return;
    if (!supervisor._lastStart) return;
    if (supervisor._recoverCount >= recoverLimit) {
      log.warn?.("safe recover limit reached; staying crashed");
      return;
    }
    const delay = delays[Math.min(supervisor._recoverCount, delays.length - 1)];
    supervisor._recoverCount += 1;
    log.info?.(`scheduling safe-mode recover in ${delay}ms`);
    supervisor._recoverTimer = setTimeout(() => {
      supervisor._recoverTimer = undefined;
      if (generation !== supervisor._startGeneration) return;
      if (supervisor._state === "stopping" || supervisor._stopping) return;
      const next = {
        ...supervisor._lastStart,
        mode: "safe",
        dshHome: homeForMode(supervisor._lastStart.dshHome, "safe"),
      };
      start(next).catch((error) => {
        log.error?.("safe recover start failed", error);
      });
    }, delay);
  }

  function onChildFinished(child, code, signal, generation) {
    if (supervisor._child !== child) return;
    detachChild(child);
    supervisor._child = undefined;
    supervisor._pid = undefined;

    const requestedStop = supervisor._stopping || supervisor._state === "stopping";
    const classification = requestedStop
      ? { kind: "stopped", code, signal }
      : { kind: "crash", code, signal, unexpected: true };

    supervisor._lastExit = {
      code,
      signal,
      classification,
      recentOutput: supervisor._recentOutput,
      at: Date.now(),
    };
    emitter.emit("exit", supervisor._lastExit);

    if (requestedStop) {
      supervisor._stopping = false;
      setState("stopped");
      return;
    }

    supervisor._crashCount += 1;
    setState("crashed");
    try {
      emitter.emit("crash", supervisor._lastExit);
    } catch (error) {
      log.error?.("crash listener threw", error);
    }
    scheduleSafeRecover(generation);
  }

  function start(options = {}) {
    const {
      dshBinary,
      dshHome,
      mode,
      extraEnv,
      nodeBinary,
      cwd,
      extraArgs,
      waitForReady = true,
      readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
      host,
      port,
      noOpen,
      trustedHosts,
      profileStyle,
      command,
    } = options;

    if (!dshBinary) {
      return Promise.reject(new Error("dshBinary is required"));
    }
    if (!dshHome) {
      return Promise.reject(new Error("dshHome is required; refuse to inherit the user-global ~/.dsh"));
    }
    const resolvedMode = mode || "safe";
    if (!MODES.includes(resolvedMode)) {
      return Promise.reject(new Error(`unsupported mode: ${mode}`));
    }

    clearRecoverTimer();
    const begin = async () => {
      if (supervisor._child) {
        await stop();
      }

      supervisor._startGeneration += 1;
      const generation = supervisor._startGeneration;
      supervisor._stopping = false;
      supervisor._readyUrl = undefined;
      supervisor._lineBuffers = { stdout: "", stderr: "" };
      supervisor._recentOutput = "";
      supervisor._mode = resolvedMode;
      supervisor._dshHome = dshHome;
      supervisor._dshBinary = dshBinary;
      supervisor._lastStart = {
        dshBinary,
        dshHome,
        mode: resolvedMode,
        extraEnv,
        nodeBinary,
        cwd,
        extraArgs,
        waitForReady,
        readyTimeoutMs,
        host,
        port,
        noOpen,
        trustedHosts,
        profileStyle,
        command,
      };
      setState("starting");

      const argv = proto.buildArgv({
        command: command || "web",
        mode: resolvedMode,
        host,
        port,
        noOpen,
        trustedHosts,
        extraArgs,
        profileStyle,
      });
      const env = proto.buildEnv
        ? proto.buildEnv({ dshHome, mode: resolvedMode, extraEnv })
        : { ...process.env, ...(extraEnv || {}), DSH_HOME: dshHome };

      const commandPath = isJsEntry(dshBinary)
        ? (nodeBinary || process.execPath)
        : dshBinary;
      const args = isJsEntry(dshBinary) ? [dshBinary, ...argv] : argv;

      let child;
      try {
        child = invokeSpawn(spawnImpl, {
          command: commandPath,
          args,
          env,
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (error) {
        supervisor._lastExit = {
          code: null,
          signal: null,
          classification: { kind: "crash", error },
          at: Date.now(),
        };
        supervisor._crashCount += 1;
        setState("crashed");
        emitter.emit("crash", supervisor._lastExit);
        throw error;
      }

      supervisor._child = child;
      supervisor._pid = child.pid;
      supervisor._startedAt = Date.now();

      if (child.stdout) {
        child.stdout.setEncoding?.("utf8");
        child.stdout.on("data", (chunk) => {
          try {
            handleOutputChunk("stdout", chunk);
          } catch (error) {
            log.error?.("stdout handler failed", error);
          }
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding?.("utf8");
        child.stderr.on("data", (chunk) => {
          try {
            handleOutputChunk("stderr", chunk);
          } catch (error) {
            log.error?.("stderr handler failed", error);
          }
        });
      }

      child.on("error", (error) => {
        log.error?.("dsh child error", error);
        onChildFinished(child, null, null, generation);
      });
      child.on("exit", (code, signal) => {
        onChildFinished(child, code, signal, generation);
      });

      if (child.exitCode != null || child.signalCode != null) {
        const err = failureError(
          `dsh exited before ready (code ${child.exitCode ?? "null"} signal ${child.signalCode ?? "null"})`,
        );
        if (supervisor._state !== "crashed") {
          onChildFinished(child, child.exitCode, child.signalCode, generation);
        }
        throw err;
      }

      if (!waitForReady) {
        if (generation === supervisor._startGeneration && supervisor._child === child) {
          setState("running");
        }
        return getStatus();
      }

      return waitUntilReady(child, generation, readyTimeoutMs);
    };

    return begin();
  }

  function waitUntilReady(child, generation, timeoutMs) {
    return new Promise((resolveReady, rejectReady) => {
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        emitter.off("status", onStatus);
        fn(value);
      };

      const onStatus = (status) => {
        if (generation !== supervisor._startGeneration) return;
        if (status.readyUrl && supervisor._child === child) {
          setState("running");
          finish(resolveReady, getStatus());
        }
      };

      const timer = setTimeout(() => {
        finish(rejectReady, failureError("waiting for DSH ready timed out"));
      }, timeoutMs);

      emitter.on("status", onStatus);
      if (supervisor._readyUrl) onStatus(getStatus());

      const onEarlyExit = () => {
        if (settled) return;
        const exit = supervisor._lastExit;
        finish(rejectReady, failureError(
          `dsh exited before ready (code ${exit?.code ?? "null"} signal ${exit?.signal ?? "null"})`,
        ));
      };
      child.once("exit", onEarlyExit);
      child.once("error", onEarlyExit);
    });
  }

  function signalChild(child, signal) {
    if (typeof killFn === "function") {
      killFn(child, signal);
      return;
    }
    if (typeof child.kill === "function") {
      child.kill(signal);
    }
  }

  function killChild(child) {
    return new Promise((resolveKill) => {
      if (!child) {
        resolveKill();
        return;
      }
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolveKill();
      };
      child.once("exit", finish);
      child.once("close", finish);
      try {
        signalChild(child, "SIGTERM");
      } catch {
        try {
          child.kill?.("SIGTERM");
        } catch {
          finish();
          return;
        }
      }
      setTimeout(() => {
        try {
          signalChild(child, "SIGKILL");
        } catch {
          try {
            child.kill?.("SIGKILL");
          } catch {
            /* already gone */
          }
        }
        finish();
      }, 1500).unref?.();
    });
  }

  async function stop() {
    clearRecoverTimer();
    supervisor._stopping = true;
    const child = supervisor._child;
    if (!child) {
      supervisor._stopping = false;
      setState("stopped");
      return getStatus();
    }
    setState("stopping");
    await killChild(child);
    if (supervisor._child === child) {
      detachChild(child);
      supervisor._child = undefined;
      supervisor._pid = undefined;
    }
    supervisor._stopping = false;
    if (supervisor._state !== "stopped") {
      setState("stopped");
    }
    return getStatus();
  }

  async function restart(overrides = {}) {
    const last = supervisor._lastStart || {};
    await stop();
    return start({ ...last, ...overrides });
  }

  return {
    start,
    stop,
    restart,
    getStatus,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    STATES,
    MODES,
  };
}

module.exports = {
  createSupervisor,
  redactDiagnosticText,
  STATES,
  MODES,
  DEFAULT_BACKOFF_MS,
  DEFAULT_READY_TIMEOUT_MS,
};
