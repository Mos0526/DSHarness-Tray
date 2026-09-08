#!/usr/bin/env node
"use strict";

const http = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const READY_PREFIX = "dsh web: ";

function argValue(name, fallback) {
  const prefix = `${name}=`;
  const hit = process.argv.find((arg) => arg.startsWith(prefix));
  if (hit) return hit.slice(prefix.length);
  const at = process.argv.indexOf(name);
  if (at >= 0 && process.argv[at + 1]) return process.argv[at + 1];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function readPluginCompat() {
  const dir = process.env.FAKE_DSH_PLUGIN;
  if (!dir) return null;
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).dshFixture || null;
  } catch {
    return null;
  }
}

function resolveMode() {
  const fromArg = argValue("--fake-mode") || argValue("--mode");
  if (fromArg) return fromArg;
  if (process.env.FAKE_DSH_MODE) return process.env.FAKE_DSH_MODE;
  const fixture = readPluginCompat();
  if (fixture?.kind === "host-incompatible" || fixture?.compat?.host === false) return "crash-host";
  if (fixture?.kind === "renderer-incompatible" || fixture?.compat?.renderer === false) return "fail-renderer";
  return "ok";
}

function parseHostPort() {
  return {
    host: argValue("--host", "127.0.0.1"),
    port: Number(argValue("--port", "0")) || 0,
  };
}

function printReady(url) {
  process.stdout.write(`${READY_PREFIX}${url.href}\n`);
}

function keepAliveUntilSignal(server) {
  const stop = () => {
    server?.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 200).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGBREAK", stop);
}

function startHttp(host, port, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health" || req.url === "/") {
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8", ...extraHeaders });
        res.end("fake-dsh ok");
        return;
      }
      res.writeHead(404);
      res.end("not found");
    });
    server.on("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        server,
        url: new URL(`http://${host}:${address.port}/`),
      });
    });
  });
}

async function main() {
  const command = process.argv[2];
  if (hasFlag("--version") || command === "--version") {
    process.stdout.write("fake-dsh 0.0.1\n");
    return;
  }

  const mode = resolveMode();
  const delay = Number(process.env.FAKE_DSH_DELAY_MS || 0);
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));

  if (mode === "crash-host") {
    process.stderr.write("fake-dsh: host crashed before ready\n");
    process.exit(1);
  }

  if (mode === "hang") {
    setInterval(() => {}, 60_000);
    return;
  }

  if (command !== "web" && command !== undefined && !String(command).startsWith("-")) {
    process.stderr.write(`fake-dsh: unknown command ${command}\n`);
    process.exit(2);
  }

  const { host, port } = parseHostPort();

  if (mode === "ok" || mode === "protocol" || mode === "fail-renderer" || mode === "exit-early") {
    if (mode === "protocol") {
      process.stdout.write("fake-dsh boot\n");
      process.stdout.write("checking plugins\n");
    }
    const { server, url } = await startHttp(host, port, {
      "x-fake-dsh-mode": mode,
    });
    printReady(url);
    if (mode === "exit-early") {
      server.close(() => process.exit(1));
      return;
    }
    if (mode === "fail-renderer") {
      setTimeout(() => {
        process.stderr.write("fake-dsh: renderer settle failed\n");
        server.close(() => process.exit(2));
      }, Number(process.env.FAKE_DSH_RENDERER_MS || 40));
      return;
    }
    keepAliveUntilSignal(server);
    return;
  }

  process.stderr.write(`fake-dsh: unknown mode ${mode}\n`);
  process.exit(2);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
