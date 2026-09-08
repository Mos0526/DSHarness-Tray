"use strict";

/**
 * Version-agnostic DSH CLI / stdout / exit adapter.
 *
 * Official CLI is still developer-preview and has already changed shape
 * (`dsh run` removed; `dsh web` is a hardcoded alias for `--profile web`).
 * This module therefore exposes replaceable `buildArgv` / `parseStdoutLine` /
 * `classifyExit` implementations instead of freezing one preview snapshot.
 *
 * Evidence (official, fetched 2026-08-24):
 * - https://deepseekdocs.com/en/docs/user-guide/cli
 *   `dsh web` ≡ `--profile web`; env `DSH_HOME` overrides `~/.dsh`.
 * - https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/src/index.ts
 *   `DSH_HOME_ENV = 'DSH_HOME'`; blank override is treated as unset.
 * - https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md
 *   After Loader settle, prints a `dsh web:` URL line when `printUrl` is true.
 *   Also prints `dsh web: opening the default browser; pass --no-open to disable`
 *   (NOT a listen URL). `--host 0.0.0.0` is rejected in current web-app.
 * - Current tray `main.js` already uses
 *   `web --host 127.0.0.1 --port 0 --no-open` and parses `dsh web: <url>`.
 *
 * Divergence vs some unofficial docs that show `--host 0.0.0.0` as valid:
 * the official web-app README and CLI reference still reject all-interfaces
 * bind. Default argv therefore keeps loopback, matching both the tray and
 * current official web-app.
 */

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const DSH_HOME_ENV = "DSH_HOME";
const READY_PREFIX_RE = /^dsh web:\s+/i;
const BROWSER_HANDOFF_RE = /^dsh web:\s+opening the default browser/i;
const URL_RE = /https?:\/\/[^\s]+/i;

const HOME_MODES = Object.freeze(["safe", "active", "staging"]);

function tryHttpUrl(text) {
  try {
    const url = new URL(String(text || "").trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    return url;
  } catch {
    return;
  }
}

function defaultBuildArgv(options = {}) {
  const command = options.command == null ? "web" : options.command;
  const extra = Array.isArray(options.extraArgs) ? options.extraArgs.slice() : [];
  const style = options.profileStyle || "alias";

  if (command === "version") {
    return ["--version", ...extra];
  }

  if (command === "plugin") {
    const profile = options.profile || "web";
    return ["plugin", "--profile", profile, ...extra];
  }

  if (command === "dump-config") {
    const head = style === "flag"
      ? ["--profile", options.profile || "web"]
      : ["web"];
    return [...head, "--dump-config", ...extra];
  }

  const head = style === "flag"
    ? ["--profile", options.profile || "web"]
    : [command || "web"];

  const argv = head.slice();
  if (options.host !== false) {
    argv.push("--host", String(options.host ?? DEFAULT_HOST));
  }
  if (options.port !== false) {
    argv.push("--port", String(options.port ?? DEFAULT_PORT));
  }
  if (options.noOpen !== false) {
    argv.push("--no-open");
  }
  if (Array.isArray(options.trustedHosts)) {
    for (const host of options.trustedHosts) {
      argv.push("--trusted-host", String(host));
    }
  }
  argv.push(...extra);
  return argv;
}

function defaultParseStdoutLine(line) {
  const raw = String(line ?? "");
  const trimmed = raw.trim();
  if (!trimmed) return { type: "empty", raw };

  if (BROWSER_HANDOFF_RE.test(trimmed)) {
    return { type: "browser", raw: trimmed };
  }

  if (READY_PREFIX_RE.test(trimmed)) {
    const rest = trimmed.replace(READY_PREFIX_RE, "");
    const token = rest.split(/\s+/)[0];
    const url = tryHttpUrl(token);
    if (url) return { type: "ready", url: url.href, raw: trimmed };
    return { type: "log", raw: trimmed };
  }

  const embedded = trimmed.match(URL_RE);
  if (embedded) {
    const url = tryHttpUrl(embedded[0].replace(/[),.;]+$/, ""));
    if (url && url.port) return { type: "ready", url: url.href, raw: trimmed };
  }

  return { type: "log", raw: trimmed };
}

function defaultClassifyExit(code, signal) {
  if (signal === "SIGTERM" || signal === "SIGKILL") {
    return { kind: "stopped", code, signal };
  }
  if (signal) {
    return { kind: "crash", code, signal };
  }
  if (code === 130) {
    return { kind: "stopped", code, signal: null };
  }
  if (code === 0) {
    return { kind: "ok", code: 0, signal: null };
  }
  if (code == null) {
    return { kind: "ok", code: null, signal: null };
  }
  return { kind: "crash", code, signal: null };
}

function defaultBuildEnv(options = {}, baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  const home = options.dshHome;
  if (home) env[DSH_HOME_ENV] = String(home);
  if (options.extraEnv && typeof options.extraEnv === "object") {
    Object.assign(env, options.extraEnv);
    if (home) env[DSH_HOME_ENV] = String(home);
  }
  return env;
}

function createProtocol(overrides = {}) {
  return {
    buildArgv: overrides.buildArgv || defaultBuildArgv,
    parseStdoutLine: overrides.parseStdoutLine || defaultParseStdoutLine,
    classifyExit: overrides.classifyExit || defaultClassifyExit,
    buildEnv: overrides.buildEnv || defaultBuildEnv,
    homeModes: HOME_MODES,
    dshHomeEnv: DSH_HOME_ENV,
  };
}

const defaults = createProtocol();

module.exports = {
  DSH_HOME_ENV,
  HOME_MODES,
  DEFAULT_HOST,
  DEFAULT_PORT,
  createProtocol,
  buildArgv: defaults.buildArgv,
  parseStdoutLine: defaults.parseStdoutLine,
  classifyExit: defaults.classifyExit,
  buildEnv: defaults.buildEnv,
};
