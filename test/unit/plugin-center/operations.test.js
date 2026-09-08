"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
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
} = require("../../../src/plugin-center/operations");

describe("plugin operation adversarial guard", () => {
  it("rejects concurrent install or uninstall operations", async () => {
    const guard = createOperationGuard();
    let release;
    const first = guard.run("plugin-a", () => new Promise((resolve) => {
      release = resolve;
    }));
    const second = await guard.run("plugin-b", async () => ({ ok: true }));
    assert.equal(second.ok, false);
    assert.match(second.error, /plugin-a/);
    release({ ok: true });
    assert.equal((await first).ok, true);
    assert.equal(guard.active, null);
  });

  it("releases the lock even when an operation throws", async () => {
    const guard = createOperationGuard();
    await assert.rejects(() => guard.run("broken", async () => {
      throw new Error("boom");
    }), /boom/);
    const retry = await guard.run("retry", async () => ({ ok: true }));
    assert.equal(retry.ok, true);
  });

  it("blocks stale or incomplete npm pins before touching profiles", () => {
    assert.match(validateInstallPin({ stale: true }), /过期/);
    assert.match(validateInstallPin({ exactVersion: "1.0.0" }), /integrity/);
    assert.equal(validateInstallPin({
      exactVersion: "1.0.0",
      integrity: "sha512-demo",
      manifest: { name: "demo", version: "1.0.0" },
    }), "");
  });

  it("turns low-level failures into actionable Chinese messages", () => {
    assert.match(friendlyPluginError(new Error("ERR_PNPM_FETCH_500")), /网络/);
    assert.match(friendlyPluginError(new Error("integrity checksum mismatch")), /完整性/);
    assert.match(friendlyPluginError(new Error("command timeout")), /超时/);
    assert.match(
      friendlyPluginError(new Error("The requested module '@deepseek-ai/dsh-settings' does not provide an export named 'settingsNamespace'")),
      /接口不兼容/,
    );
  });

  it("removes credentials from untrusted staging environments", () => {
    const env = sanitizeUntrustedEnv({
      PATH: "C:\\Windows",
      OPENAI_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      DATABASE_PASSWORD: "secret",
      NORMAL_SETTING: "kept",
    });
    assert.equal(env.PATH, "C:\\Windows");
    assert.equal(env.NORMAL_SETTING, "kept");
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.GITHUB_TOKEN, undefined);
    assert.equal(env.DATABASE_PASSWORD, undefined);
  });

  it("copies active profile metadata without pnpm virtual-store links", () => {
    const root = mkdtempSync(join(tmpdir(), "dsh-staging-profile-"));
    const active = join(root, "active", "profiles", "web");
    const staging = join(root, "staging", "profiles", "web");
    mkdirSync(join(active, "node_modules"), { recursive: true });
    writeFileSync(join(active, "package.json"), "{\"name\":\"profile\"}");
    writeFileSync(join(active, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
    writeFileSync(join(active, "node_modules", ".modules.yaml"), "virtualStoreDir: C:/active/.pnpm");
    try {
      assert.equal(prepareStagingProfile(active, staging), true);
      assert.equal(readFileSync(join(staging, "package.json"), "utf8"), "{\"name\":\"profile\"}");
      assert.equal(existsSync(join(staging, "pnpm-lock.yaml")), true);
      assert.equal(existsSync(join(staging, "node_modules")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("verifies npm identity from the repository rather than trusting npm metadata", async () => {
    const repo = { host: "github.com", owner: "owner", repo: "plugin" };
    assert.ok(repositoryPackageUrls(repo).some((url) => /owner\/plugin\/main\/package\.json$/.test(url)));
    assert.ok(repositoryPackageUrls(repo).some((url) => /integrations\/deepseek-harness\/package\.json$/.test(url)));
    const ok = await verifyRepositoryPackageName({
      repo,
      npmName: "dsh-plugin",
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ name: "dsh-plugin", version: "1.0.0" }),
      }),
    });
    assert.equal(ok.ok, true);
    await assert.rejects(
      () => verifyRepositoryPackageName({
        repo,
        npmName: "dsh-plugin",
        fetchFn: async () => ({
          ok: true,
          json: async () => ({ name: "attacker-package" }),
        }),
      }),
      /不是 dsh-plugin/,
    );
    const corrected = await resolveRepositoryPackageIdentity({
      repo,
      candidateNpmName: "plugin",
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ name: "@owner/dsh-plugin", version: "2.0.0" }),
      }),
    });
    assert.equal(corrected.npmName, "@owner/dsh-plugin");
    assert.equal(corrected.corrected, true);
  });

  it("prefers a DSH plugin package.json in a known monorepo subdirectory", async () => {
    const resolved = await resolveRepositoryPackageIdentity({
      repo: { host: "github.com", owner: "tt-a1i", repo: "archify" },
      candidateNpmName: "archify",
      fetchFn: async (url) => {
        if (String(url).includes("integrations/deepseek-harness/package.json")) {
          return {
            ok: true,
            json: async () => ({
              name: "@tt-a1i/archify-dsh",
              version: "0.1.0",
              dsh: { bundle: { patch: "./cordis.patch.yml" } },
              repository: { url: "git+https://github.com/tt-a1i/archify.git" },
            }),
          };
        }
        if (/\/package\.json$/.test(String(url)) && !String(url).includes("/integrations/")) {
          return { ok: true, json: async () => ({ name: "archify-website" }) };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      },
    });
    assert.equal(resolved.npmName, "@tt-a1i/archify-dsh");
    assert.equal(resolved.corrected, true);
  });

  it("adds plugins with ignore-scripts but never passes that flag to pnpm remove", () => {
    const add = pluginAddArgs("@liustack/modlens@3.24.1");
    assert.deepEqual(add, [
      "add",
      "@liustack/modlens@3.24.1",
      "--save-exact",
      "--ignore-scripts",
    ]);
    assert.equal(add.includes("--prefer-offline"), false);
    assert.deepEqual(pluginAddArgs("@liustack/modlens@3.24.1", { preferOffline: true }).slice(-1), [
      "--prefer-offline",
    ]);
    const remove = pluginRemoveArgs("@liustack/modlens");
    assert.deepEqual(remove, ["remove", "@liustack/modlens"]);
    assert.equal(remove.includes("--ignore-scripts"), false);
    assert.equal(remove.some((arg) => String(arg).includes("ignore-scripts")), false);
  });

  it("rejects command-injection and path-traversal package names before spawning uninstall", () => {
    assert.throws(() => pluginRemoveArgs("foo --ignore-scripts"), /无效/);
    assert.throws(() => pluginRemoveArgs("../../../windows/system32"), /无效/);
    assert.throws(() => pluginRemoveArgs("@owner/name; rm -rf /"), /无效/);
    assert.throws(() => pluginRemoveArgs("github:liustack/modlens"), /无效/);
    assert.throws(() => pluginRemoveArgs("--help"), /无效/);
    assert.throws(() => pluginRemoveArgs(""), /无效/);
  });

  it("disables lifecycle scripts via env even when pnpm remove rejects the CLI flag", () => {
    const env = pluginCliEnv({
      PATH: "C:\\Windows",
      OPENAI_API_KEY: "secret",
      NORMAL_SETTING: "kept",
    }, { untrusted: true });
    assert.equal(env.npm_config_ignore_scripts, "true");
    assert.equal(env.PATH, "C:\\Windows");
    assert.equal(env.NORMAL_SETTING, "kept");
    assert.equal(env.OPENAI_API_KEY, undefined);
  });

  it("matches an installed plugin by npm name when the UI id is a repository identity", () => {
    const installed = [
      { pluginId: "@liustack/modlens", exactVersion: "3.24.1" },
      { pluginId: "dsh-better-sidebar", exactVersion: "0.15.2" },
    ];
    const hit = findInstalledPlugin(installed, {
      id: "github:liustack/modlens",
      plugin: { npmName: "@liustack/modlens", stableId: "github:liustack/modlens" },
    });
    assert.equal(hit.pluginId, "@liustack/modlens");
    const sidebar = findInstalledPlugin(installed, {
      id: "dsh-better-sidebar",
      plugin: { npmName: "dsh-better-sidebar" },
    });
    assert.equal(sidebar.pluginId, "dsh-better-sidebar");
    assert.equal(findInstalledPlugin(installed, { id: "github:missing/plugin" }), null);
  });

  it("maps the pnpm ignore-scripts uninstall failure to a recoverable message", () => {
    assert.match(
      friendlyPluginError(new Error("Unknown option: 'ignore-scripts' Did you mean 'ignore-workspace'?")),
      /pnpm/,
    );
  });

  it("explains a staging pnpm profile failure without claiming the live home changed", () => {
    const text = friendlyPluginError(new Error(
      "退出码 1\n'pnpm'\ndsh: pnpm failed in profile directory C:\\Users\\[user]\\AppData\\Roaming\\dsh-tray\\dsh\\homes\\staging\\profiles\\web",
    ));
    assert.match(text, /隔离环境/);
    assert.match(text, /正式插件环境未改动/);
    assert.match(text, /staging\\profiles\\web/);
  });
});
