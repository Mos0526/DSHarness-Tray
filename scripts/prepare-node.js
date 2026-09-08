const { createWriteStream, existsSync, mkdirSync, rmSync, renameSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const https = require("node:https");
const http = require("node:http");

const NODE_VERSION = "24.19.0";
const ZIP_NAME = `node-v${NODE_VERSION}-win-x64.zip`;
const MIRRORS = [
  `https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${ZIP_NAME}`,
  `https://nodejs.org/dist/v${NODE_VERSION}/${ZIP_NAME}`,
];
const ROOT = join(__dirname, "..");
const RUNTIME = join(ROOT, "runtime", "node");
const STAMP = join(RUNTIME, "node.exe");
const DEPS = join(RUNTIME, "deps");
const NPM_CLI = join(DEPS, "npm", "bin", "npm-cli.js");
const OLD_CLI = join(RUNTIME, "node_modules", "npm", "bin", "npm-cli.js");
const VERSION_MARK = join(RUNTIME, ".bundled-node-version");

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const req = client.get(url, { headers: { "User-Agent": "dsh-tray" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`download ${url} -> HTTP ${res.statusCode}`));
        return;
      }
      pipeline(res, createWriteStream(dest)).then(resolve, reject);
    });
    req.on("error", reject);
  });
}

function flattenNpmLayout() {
  const oldMods = join(RUNTIME, "node_modules");
  if (existsSync(oldMods) && !existsSync(DEPS)) renameSync(oldMods, DEPS);
}

function stripRuntime() {
  for (const name of ["CHANGELOG.md", "README.md", "corepack", "corepack.cmd", "install_tools.bat"]) {
    rmSync(join(RUNTIME, name), { force: true });
  }
  for (const name of ["docs", "man", "html"]) {
    rmSync(join(DEPS, "npm", name), { recursive: true, force: true });
  }
}

function bundledVersionOk() {
  try {
    return readFileSync(VERSION_MARK, "utf8").trim() === NODE_VERSION
      && existsSync(STAMP)
      && existsSync(NPM_CLI);
  } catch {
    return false;
  }
}

async function ensureExtractedNode() {
  flattenNpmLayout();
  if (bundledVersionOk()) {
    stripRuntime();
    return;
  }
  mkdirSync(join(ROOT, "runtime"), { recursive: true });
  const zipPath = join(ROOT, "runtime", ZIP_NAME);
  let lastError;
  for (const url of MIRRORS) {
    try {
      console.log("downloading", url);
      await download(url, zipPath);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      console.warn(String(error.message || error));
    }
  }
  if (lastError) throw lastError;

  const extractDir = join(ROOT, "runtime", `node-v${NODE_VERSION}-win-x64`);
  rmSync(extractDir, { recursive: true, force: true });
  execFileSync("tar", ["-xf", zipPath, "-C", join(ROOT, "runtime")], { stdio: "inherit" });
  rmSync(RUNTIME, { recursive: true, force: true });
  renameSync(extractDir, RUNTIME);
  rmSync(zipPath, { force: true });
  flattenNpmLayout();
  stripRuntime();
  if (!existsSync(STAMP) || !existsSync(NPM_CLI)) throw new Error("portable Node extract failed");
  writeFileSync(VERSION_MARK, NODE_VERSION);
  console.log("prepared", STAMP);
}

async function main() {
  await ensureExtractedNode();
  if (!existsSync(NPM_CLI) && existsSync(OLD_CLI)) flattenNpmLayout();
  stripRuntime();
  if (!existsSync(STAMP) || !existsSync(NPM_CLI)) throw new Error("portable Node is incomplete");
  writeFileSync(VERSION_MARK, NODE_VERSION);
  console.log("portable Node ready:", STAMP, NODE_VERSION);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
