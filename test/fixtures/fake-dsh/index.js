"use strict";

const { spawn } = require("node:child_process");
const { join } = require("node:path");

const BIN = join(__dirname, "bin.js");
const READY_PREFIX = "dsh web: ";

function parseReadyLine(line) {
  const trimmed = String(line).trim();
  if (!trimmed.startsWith(READY_PREFIX)) return;
  const candidate = trimmed.slice(READY_PREFIX.length).split(" ")[0];
  try {
    const url = new URL(candidate);
    return url.port ? url : undefined;
  } catch {
    return;
  }
}

function spawnFakeDsh({ mode, plugin, extraArgs = [], env = {}, delayMs } = {}) {
  const child = spawn(process.execPath, [BIN, "web", "--host", "127.0.0.1", "--port", "0", "--no-open", ...extraArgs], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(mode ? { FAKE_DSH_MODE: mode } : {}),
      ...(plugin ? { FAKE_DSH_PLUGIN: plugin } : {}),
      ...(delayMs != null ? { FAKE_DSH_DELAY_MS: String(delayMs) } : {}),
      ...env,
    },
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return child;
}

function waitForReady(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("等待 fake DSH 启动超时")), timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const url = parseReadyLine(line);
        if (url) finish(resolve, url);
      }
    });
    child.once("error", (error) => finish(reject, error));
    child.once("exit", (code) => {
      const url = parseReadyLine(buffer);
      if (url) finish(resolve, url);
      else finish(reject, new Error(`fake-dsh 在就绪前退出（code ${code}）`));
    });
  });
}

function waitForExit(child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (child.exitCode != null) {
      resolve({ code: child.exitCode, signal: child.signalCode });
      return;
    }
    const timer = setTimeout(() => reject(new Error("等待 fake DSH 退出超时")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function stopFakeDsh(child) {
  if (!child || child.exitCode != null) return;
  child.kill();
  await waitForExit(child, 3000).catch(() => {});
}

module.exports = {
  BIN,
  READY_PREFIX,
  parseReadyLine,
  spawnFakeDsh,
  waitForReady,
  waitForExit,
  stopFakeDsh,
};
