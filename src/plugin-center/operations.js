"use strict";

const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { basename, dirname } = require("node:path");
const { isLikelyNpmName, normalizeNpmName } = require("../identity/stable-id");
const { pickPluginManifest, pluginPackageJsonPaths } = require("../identity/plugin-package");
const { redactDiagnosticText } = require("../runtime/redact");

function friendlyPluginError(error) {
  const raw = redactDiagnosticText(String(error?.message || error || "未知错误"));
  if (/timeout|超时/i.test(raw)) return "操作超时，已保留原有插件环境。";
  if (/ERR_PNPM_FETCH|ENOTFOUND|ECONN|network/i.test(raw)) return "网络不可用，插件未写入正式环境。";
  if (/integrity|checksum/i.test(raw)) return "npm 完整性校验失败，已阻止安装。";
  if (/peer depend/i.test(raw)) return "插件依赖与当前 DSH 不兼容。";
  if (/does not provide an export named/i.test(raw)) {
    return [
      "插件与当前 DSH 的接口不兼容：调用了宿主已不再导出的 API。",
      "已阻止写入正式环境。请安装与当前 DSH 通道匹配的插件版本（例如 alpha 宿主应对应 npm alpha 通道）。",
      "",
      raw,
    ].join("\n");
  }
  if (/Unknown option:\s*'ignore-scripts'/i.test(raw)) {
    return "卸载命令与当前 pnpm 不兼容，已阻止带生命周期脚本的删除。";
  }
  if (/pnpm failed in profile directory|退出码\s*1[\s\S]*\bpnpm\b/i.test(raw)) {
    return [
      "隔离环境里的 pnpm 安装失败，正式插件环境未改动。",
      "常见原因：隔离目录没有本地缓存、网络不可用，或当前 DSH 与插件 / lockfile 不兼容。",
      "",
      raw,
    ].join("\n");
  }
  return raw;
}

function pluginCliEnv(baseEnv = {}, { untrusted = false } = {}) {
  const env = untrusted ? sanitizeUntrustedEnv(baseEnv) : { ...baseEnv };
  // pnpm remove does not accept --ignore-scripts as a command flag.
  // Setting the npm/pnpm config via env still blocks lifecycle scripts.
  env.npm_config_ignore_scripts = "true";
  return env;
}

function pluginAddArgs(spec, { preferOffline = false } = {}) {
  const args = ["add", spec, "--save-exact", "--ignore-scripts"];
  // Staging is a fresh DSH_HOME with no pnpm store. --prefer-offline then
  // fails with an opaque "pnpm failed in profile directory" instead of
  // fetching the already-pinned exact tarball.
  if (preferOffline) args.push("--prefer-offline");
  return args;
}

function pluginRemoveArgs(npmName) {
  const name = normalizeNpmName(npmName);
  if (!isLikelyNpmName(name)) {
    throw new Error("插件包名无效，已阻止卸载。");
  }
  // Do not pass --ignore-scripts here: `pnpm remove` rejects it as an unknown
  // option and the uninstall aborts before the package is removed.
  return ["remove", name];
}

function findInstalledPlugin(installed, { plugin, id } = {}) {
  const list = Array.isArray(installed) ? installed : [];
  const candidates = new Set(
    [plugin?.npmName, plugin?.packageName, plugin?.pluginId, plugin?.id, id]
      .filter(Boolean)
      .map((value) => normalizeNpmName(value))
      .filter(Boolean),
  );
  return list.find((item) => {
    const pluginId = normalizeNpmName(item?.pluginId || item?.id || "");
    return pluginId && candidates.has(pluginId);
  }) || null;
}

function validateInstallPin(pin) {
  if (!pin || typeof pin !== "object") return "npm 未返回安装信息，已阻止安装。";
  if (pin.stale || pin.expired) return "npm 安装信息已过期且刷新失败，已阻止安装。请检查网络后重试。";
  if (!pin.exactVersion || !pin.integrity || !pin.manifest) {
    return "npm 未返回精确版本、integrity 或 manifest，已阻止安装。";
  }
  return "";
}

function sanitizeUntrustedEnv(baseEnv = {}) {
  const env = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (/(?:^|_)(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)(?:_|$)/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

function createOperationGuard() {
  let active = null;
  return {
    get active() {
      return active;
    },
    async run(label, task) {
      if (active) return { ok: false, error: `已有插件操作正在进行：${active}` };
      active = label || "插件操作";
      try {
        return await task();
      } finally {
        active = null;
      }
    },
  };
}

function prepareStagingProfile(activeProfile, stagingProfile) {
  if (!activeProfile || !stagingProfile) throw new Error("activeProfile and stagingProfile are required");
  rmSync(stagingProfile, { recursive: true, force: true });
  if (!existsSync(activeProfile)) return false;
  mkdirSync(dirname(stagingProfile), { recursive: true });
  cpSync(activeProfile, stagingProfile, {
    recursive: true,
    force: true,
    filter: (source) => basename(source).toLowerCase() !== "node_modules",
  });
  // Defensive cleanup for Node versions whose cp filter still traversed a
  // junction. pnpm's .modules.yaml must never point back to active.
  rmSync(require("node:path").join(stagingProfile, "node_modules"), {
    recursive: true,
    force: true,
  });
  return true;
}

function repositoryPackageUrls(repo) {
  if (!repo?.owner || !(repo.repo || repo.name)) return [];
  if ((repo.host || "github.com").toLowerCase() !== "github.com") return [];
  const name = repo.repo || repo.name;
  const owner = repo.owner;
  return pluginPackageJsonPaths({ ...repo, repo: name }).flatMap((path) => [
    `https://raw.githubusercontent.com/${owner}/${name}/main/${path}`,
    `https://raw.githubusercontent.com/${owner}/${name}/master/${path}`,
    `https://cdn.jsdelivr.net/gh/${owner}/${name}@main/${path}`,
  ]);
}

async function verifyRepositoryPackageName({ repo, npmName, fetchFn = globalThis.fetch } = {}) {
  const expected = String(npmName || "").trim().toLowerCase();
  if (!expected) throw new Error("缺少 npm 包名");
  const urls = repositoryPackageUrls(repo);
  if (!urls.length || typeof fetchFn !== "function") throw new Error("无法验证仓库 package.json");
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": "dsh-tray" },
        signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(8_000) : undefined,
      });
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
      const manifest = await response.json();
      const actual = String(manifest?.name || "").trim().toLowerCase();
      if (!actual) throw new Error("仓库 package.json 没有 name");
      if (actual !== expected) {
        throw new Error(`仓库 package.json 名称为 ${actual}，不是 ${expected}`);
      }
      return { ok: true, manifest, url };
    } catch (error) {
      if (/不是/.test(String(error?.message || error))) throw error;
      lastError = error;
    }
  }
  throw new Error(`无法从所选仓库验证 package.json：${lastError?.message || lastError || "unknown"}`);
}

async function resolveRepositoryPackageIdentity({ repo, candidateNpmName, fetchFn = globalThis.fetch } = {}) {
  const urls = repositoryPackageUrls(repo);
  if (!urls.length || typeof fetchFn !== "function") throw new Error("无法验证仓库 package.json");
  const candidates = [];
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": "dsh-tray" },
        signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(8_000) : undefined,
      });
      if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
      const manifest = await response.json();
      const npmName = String(manifest?.name || "").trim().toLowerCase();
      if (!npmName) throw new Error("仓库 package.json 没有 name");
      candidates.push({ manifest, url, npmName });
    } catch (error) {
      lastError = error;
    }
  }
  const picked = pickPluginManifest(candidates, repo);
  if (!picked) {
    throw new Error(`无法从所选仓库读取 package.json：${lastError?.message || lastError || "unknown"}`);
  }
  const npmName = String(picked.manifest.name || "").trim().toLowerCase();
  return {
    npmName,
    manifest: picked.manifest,
    url: picked.url,
    corrected: Boolean(candidateNpmName)
      && npmName !== String(candidateNpmName).trim().toLowerCase(),
  };
}

module.exports = {
  createOperationGuard,
  findInstalledPlugin,
  friendlyPluginError,
  pluginAddArgs,
  pluginCliEnv,
  pluginRemoveArgs,
  prepareStagingProfile,
  repositoryPackageUrls,
  resolveRepositoryPackageIdentity,
  sanitizeUntrustedEnv,
  validateInstallPin,
  verifyRepositoryPackageName,
};
