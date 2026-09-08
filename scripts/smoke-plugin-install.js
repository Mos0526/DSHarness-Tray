"use strict";

const { spawn } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { prepareStagingProfile } = require("../src/plugin-center/operations");

const spec = process.argv[2] || "dsh-better-sidebar@0.15.2";
const dshEntry = join(
  process.env.APPDATA || "",
  "npm",
  "node_modules",
  "@deepseek-ai",
  "dsh",
  "lib",
  "bin.js",
);

if (!existsSync(dshEntry)) {
  console.error(`global DSH not found: ${dshEntry}`);
  process.exit(2);
}

function run(args, env, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [dshEntry, ...args], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const take = (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 100_000) output = output.slice(-100_000);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`timeout: ${args.join(" ")}\n${output}`));
    }, timeoutMs);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(new Error(`exit ${code}: ${args.join(" ")}\n${output}`));
    });
  });
}

function waitForReady(env, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      dshEntry,
      "web",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--no-open",
    ], {
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const take = (chunk) => {
      output += chunk.toString("utf8");
      if (/dsh web:\s+https?:\/\//i.test(output)) {
        clearTimeout(timer);
        child.kill();
        resolve(output);
      }
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.once("error", reject);
    child.once("close", (code) => {
      if (!/dsh web:\s+https?:\/\//i.test(output)) {
        clearTimeout(timer);
        reject(new Error(`web exited ${code} before ready\n${output}`));
      }
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`web ready timeout\n${output}`));
    }, timeoutMs);
  });
}

(async () => {
  const home = mkdtempSync(join(tmpdir(), "dsh-tray-plugin-smoke-"));
  const env = { ...process.env, DSH_HOME: home };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    console.log(`staging home: ${home}`);
    const activeProfile = join(process.env.USERPROFILE || "", ".dsh", "profiles", "web");
    const stagingProfile = join(home, "profiles", "web");
    if (prepareStagingProfile(activeProfile, stagingProfile)) {
      console.log("active profile metadata copied without node_modules");
    }
    console.log(`installing: ${spec}`);
    await run([
      "plugin",
      "--profile",
      "web",
      "add",
      spec,
      "--save-exact",
      "--ignore-scripts",
    ], env);
    console.log("plugin add: ok");
    const versionAt = spec.lastIndexOf("@");
    const npmName = spec.slice(0, versionAt);
    const version = spec.slice(versionAt + 1);
    const packument = await fetch(`https://registry.npmjs.org/${encodeURIComponent(npmName)}`).then((response) => response.json());
    const expected = packument.versions?.[version]?.dist?.integrity;
    const lock = readFileSync(join(home, "profiles", "web", "pnpm-lock.yaml"), "utf8");
    if (!expected || !lock.includes(expected)) throw new Error("pnpm lock integrity does not match npm");
    console.log("lock integrity: ok");
    await waitForReady(env);
    console.log("isolated web ready: ok");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
