"use strict";

const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

/**
 * Reap a process and its descendants.
 *
 * On Windows, `child.kill()` only ends that one PID. DSH's host / plugin
 * workers then keep `DSH_HOME` and `@deepseek-ai/dsh` files locked, so a
 * later `npm install -g` plus in-process restart still boots a mixed tree
 * until the Electron job object dies. `taskkill /T /F` matches a shell quit.
 */
function terminateProcessTree(pid, options = {}) {
  const id = Number(pid);
  if (!Number.isFinite(id) || id <= 0) return false;
  const platform = options.platform || process.platform;
  const exec = options.execFileSync || execFileSync;
  if (platform === "win32") {
    try {
      exec(
        join(options.systemRoot || process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"),
        ["/pid", String(id), "/t", "/f"],
        {
          windowsHide: true,
          timeout: options.timeoutMs || 5_000,
          stdio: "ignore",
        },
      );
      return true;
    } catch {
      return false;
    }
  }
  const kill = options.kill || process.kill.bind(process);
  try {
    kill(id, options.signal || "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

function terminateChildTree(child, options = {}) {
  if (!child) return false;
  if (terminateProcessTree(child.pid, options)) return true;
  try {
    child.kill?.(options.signal || "SIGTERM");
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  terminateProcessTree,
  terminateChildTree,
};
