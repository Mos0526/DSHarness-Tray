const { app, BrowserWindow, Tray, nativeImage, Notification, shell, nativeTheme, ipcMain, powerSaveBlocker } = require("electron");
const { spawn, execFileSync } = require("node:child_process");
const { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } = require("node:fs");
const { join, delimiter, dirname } = require("node:path");
const runtime = require("./src/runtime");
const globalDsh = require("./src/runtime/global-dsh");
const { terminateChildTree } = require("./src/runtime/process-tree");
const { decodeProcessOutput } = require("./src/runtime/process-output");
const {
  normalizeVersion,
  pickDshCandidates,
  parseAtomEntries,
  matchAtomEntry,
  dshInstallSpec,
  summarizeDshUpdate,
} = require("./src/runtime/dsh-versions");
const { ensureHomes, ledgerRoot, lifecyclePath, listInstalled, profileWebDir, walDir } = require("./src/homes");
const {
  assertInstallGate,
  checkCompat,
  createWal,
  getPluginLifecycle,
  ledgerReceiptPath,
  readLedgerReceipt,
  setLifecycle,
  writeLedgerReceipt,
  isNewerVersion,
} = require("./src/install");
const { configureCatalog, listPlugins, refreshCatalog } = require("./src/catalog");
const { computeBadge, PLUGIN_MENU_ID } = require("./src/tray-plugin");
const {
  applyChromiumLockScreenSwitches,
  isKnownLegacyLoginCommand,
  loginItemOptions,
  lockScreenRuntime,
  settingsFromState,
  wantsHiddenStart,
  withSettings,
  LEGACY_LOGIN_ITEM_NAME,
  OPEN_AT_LOGIN_ID,
  RUN_ON_LOCK_SCREEN_ID,
} = require("./src/shell-settings");
const {
  hideTrayMenu,
  openTrayMenu,
  prepareTrayMenu,
  refreshTrayMenu,
  createTrayClickGuard,
  applyPopupWindowSwitches,
  OPEN_WINDOW_ID,
  OPEN_DSH_ID,
  ABOUT_ID,
  QUIT_ID,
} = require("./src/tray-menu");
const { openPluginCenter } = require("./src/plugin-center/window");
const { createFacade } = require("./src/plugin-center/facade");
const {
  createOperationGuard,
  findInstalledPlugin,
  friendlyPluginError,
  pluginAddArgs,
  pluginCliEnv,
  pluginRemoveArgs,
  prepareStagingProfile,
  resolveRepositoryPackageIdentity,
  sanitizeUntrustedEnv,
  validateInstallPin,
} = require("./src/plugin-center/operations");

const APP_NAME = "DS harness";
const UPDATE_PACKAGE = "@deepseek-ai/dsh";
const MIN_NODE_MAJOR = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const ICON_PNG = join(__dirname, "icon.png");
const ICON_ICO = join(__dirname, "icon.ico");
const TRAY_PNG = join(__dirname, "tray-icon.png");
const GITHUB_RELEASES = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases";

let mainWindow;
let tray;
let server;
let serverUrl;
let supervisor;
let quitting = false;
let updating = false;
let pendingFocus = false;
let startHidden = false;
let lockScreenBlockerId;
let startupRecovery;
const pluginOperationGuard = createOperationGuard();
let cachedDshVersion = "";

function iconPath() {
  return existsSync(TRAY_PNG) ? TRAY_PNG : ICON_PNG;
}

function windowIcon() {
  const png = existsSync(join(__dirname, "icon-256.png")) ? join(__dirname, "icon-256.png") : ICON_PNG;
  const image = nativeImage.createFromPath(png);
  return image.isEmpty() ? png : image;
}

const NPM_INSTALL_FLAGS = ["--no-fund", "--no-audit", "--fetch-retries=3"];
const MAX_INSTALL_CANDIDATES = 8;

function parseNpmJson(out) {
  const start = String(out).search(/[\[{]/);
  if (start < 0) throw new Error(out || "npm 没有返回 JSON");
  return JSON.parse(String(out).slice(start));
}

async function npmViewJson(npm, spec, ...fields) {
  const raw = await runCaptured(npm.node, [npm.cli, "view", spec, ...fields, "--json"], 30_000);
  return parseNpmJson(raw);
}

async function listDshVersions(npm) {
  const versions = [].concat(await npmViewJson(npm, UPDATE_PACKAGE, "versions"));
  if (!versions.length) throw new Error("无法读取 DSH 版本列表");
  return versions;
}

async function fetchGithubFeed() {
  const xml = await fetchText("https://github.com/deepseek-ai/deepseek-harness/releases.atom");
  return parseAtomEntries(xml);
}

async function candidateDshVersions(npm) {
  const versions = await listDshVersions(npm);
  const tags = await npmViewJson(npm, UPDATE_PACKAGE, "dist-tags");
  let githubVersion = "";
  try {
    githubVersion = (await fetchGithubFeed())[0]?.version || "";
  } catch {
    /* registry tags are enough */
  }
  return {
    versions,
    tags,
    latest: tags?.latest || versions[versions.length - 1],
    githubVersion,
    candidates: pickDshCandidates({
      versions,
      tags,
      githubVersion,
      limit: MAX_INSTALL_CANDIDATES,
    }),
  };
}

function isTransientNpmError(error) {
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|network|503|502|504/i.test(String(error?.message || error));
}

function which(command) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];
  const names = command.includes(".") ? [command] : exts.map((ext) => command + ext);
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    for (const name of names) {
      const full = join(dir, name);
      if (existsSync(full)) return full;
    }
  }
}

function npmPrefix() {
  return join(app.getPath("userData"), "npm-prefix");
}

function statePath() {
  return join(app.getPath("userData"), "shell-state.json");
}

function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  mkdirSync(app.getPath("userData"), { recursive: true });
  writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function readShellSettings() {
  return settingsFromState(readState());
}

function persistShellSettings(patch) {
  const state = readState();
  const next = { ...readShellSettings(), ...patch };
  writeState(withSettings(state, next));
  return settingsFromState(readState());
}

function loginItemConfig(openAtLogin) {
  return loginItemOptions({
    openAtLogin,
    execPath: process.execPath,
    appPath: app.getAppPath(),
    packaged: app.isPackaged,
    name: APP_NAME,
  });
}

function applyOpenAtLogin(enabled) {
  app.setLoginItemSettings(loginItemConfig(enabled));
}

function cleanupKnownLegacyLoginItem() {
  if (process.platform !== "win32") return false;
  const reg = join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  try {
    const output = execFileSync(reg, ["query", key, "/v", LEGACY_LOGIN_ITEM_NAME], {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!isKnownLegacyLoginCommand(output)) return false;
    execFileSync(reg, ["delete", key, "/v", LEGACY_LOGIN_ITEM_NAME, "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function applyRunOnLockScreen(enabled) {
  const policy = lockScreenRuntime(enabled);
  if (policy.preventAppSuspension) {
    if (lockScreenBlockerId == null || !powerSaveBlocker.isStarted(lockScreenBlockerId)) {
      lockScreenBlockerId = powerSaveBlocker.start("prevent-app-suspension");
    }
  } else if (lockScreenBlockerId != null && powerSaveBlocker.isStarted(lockScreenBlockerId)) {
    powerSaveBlocker.stop(lockScreenBlockerId);
    lockScreenBlockerId = undefined;
  }
  if (mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.webContents.setBackgroundThrottling === "function") {
    mainWindow.webContents.setBackgroundThrottling(policy.backgroundThrottling);
  }
}

function setOpenAtLogin(enabled) {
  persistShellSettings({ openAtLogin: enabled });
  try {
    applyOpenAtLogin(enabled);
  } catch {
    /* registry write can fail; checkbox still reflects the saved preference */
  }
  rebuildTrayMenu();
}

function setRunOnLockScreen(enabled) {
  persistShellSettings({ runOnLockScreen: enabled });
  applyRunOnLockScreen(enabled);
  rebuildTrayMenu();
}

function npmCliFor(node) {
  if (!node) return;
  const dir = dirname(node);
  const cli = [
    join(dir, "deps", "npm", "bin", "npm-cli.js"),
    join(dir, "node_modules", "npm", "bin", "npm-cli.js"),
  ].find((path) => existsSync(path));
  if (cli) return cli;
}

function bundledNodePath() {
  return app.isPackaged
    ? join(process.resourcesPath, "node", "node.exe")
    : join(__dirname, "runtime", "node", "node.exe");
}

function userBundledNodePath() {
  return join(app.getPath("userData"), "runtime", "node", "node.exe");
}

function isBundledNodePath(nodePath) {
  const n = String(nodePath || "").toLowerCase().replace(/\//g, "\\");
  return n.includes("\\resources\\node\\node.exe") || n.includes("\\runtime\\node\\node.exe");
}

function parseNodeMajor(text) {
  const match = String(text || "").match(/v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function readNodeMajor(node) {
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const out = execFileSync(node, ["-p", "process.versions.node"], {
      windowsHide: true,
      timeout: 8000,
      encoding: "utf8",
      env,
    });
    return parseNodeMajor(out);
  } catch {
    return 0;
  }
}

function isUsableNode(node) {
  return Boolean(node && existsSync(node) && npmCliFor(node) && readNodeMajor(node) >= MIN_NODE_MAJOR);
}

function systemNodeCandidates() {
  return [
    process.env.NODE_EXE,
    join(process.env.ProgramFiles || "", "nodejs", "node.exe"),
    join(process.env["ProgramFiles(x86)"] || "", "nodejs", "node.exe"),
    which("node"),
  ].filter((path) => path && existsSync(path) && !isBundledNodePath(path));
}

let runtimeCache;

function resetRuntimeCache() {
  runtimeCache = undefined;
}

function pickRuntime() {
  if (runtimeCache) return runtimeCache;
  const system = systemNodeCandidates().find(isUsableNode);
  if (system) {
    runtimeCache = { node: system, isolated: false, source: "system" };
    return runtimeCache;
  }
  const bundled = [bundledNodePath(), userBundledNodePath()].find((path) => path && existsSync(path) && npmCliFor(path));
  if (bundled) {
    runtimeCache = { node: bundled, isolated: true, source: "bundled" };
    return runtimeCache;
  }
  runtimeCache = { node: undefined, isolated: true, source: "none" };
  return runtimeCache;
}

function isolatedRuntime() {
  return pickRuntime().isolated;
}

function resolveNode() {
  return pickRuntime().node;
}

function shellDshRoot() {
  const root = runtime.resolveShellDshRoot(app.getPath("userData"));
  runtime.configureActiveHome(root, userDshHome());
  return root;
}

function userDshHome() {
  return join(app.getPath("home"), ".dsh");
}

function syncUserConfigTo(home) {
  mkdirSync(home, { recursive: true });
  for (const name of [".credentials.yaml", "settings.yaml", "pet.json"]) {
    const source = join(userDshHome(), name);
    if (existsSync(source)) copyFileSync(source, join(home, name));
  }
}

function syncSafeUserConfig(root) {
  syncUserConfigTo(runtime.resolveHome(root, "safe"));
}

function portableNodeBinary() {
  const node = resolveNode();
  if (!node) return;
  if (node === process.execPath && /electron/i.test(String(process.execPath))) {
    return [bundledNodePath(), userBundledNodePath()].find((path) => path && existsSync(path) && npmCliFor(path));
  }
  return node;
}

function resolveDshEntry() {
  return globalDsh.resolveDshEntry({
    isolated: isolatedRuntime(),
    prefix: npmPrefix(),
    appData: process.env.APPDATA || "",
  });
}

function resolveNpmCli() {
  const node = resolveNode();
  const cli = npmCliFor(node);
  if (!node || !cli) return;
  return { node, cli };
}

function bundledNodeZip() {
  return app.isPackaged
    ? join(process.resourcesPath, "node-runtime.zip")
    : join(__dirname, "runtime", "node-runtime.zip");
}

function flattenExtractedNode(destRoot) {
  const target = join(destRoot, "node");
  if (npmCliFor(join(target, "node.exe"))) return target;
  let names = [];
  try {
    names = readdirSync(destRoot);
  } catch {
    return target;
  }
  for (const name of names) {
    const nested = join(destRoot, name);
    if (nested === target) continue;
    if (existsSync(join(nested, "node.exe"))) {
      rmSync(target, { recursive: true, force: true });
      renameSync(nested, target);
      break;
    }
  }
  return target;
}

async function ensurePortableNode() {
  resetRuntimeCache();
  if (pickRuntime().source === "system") return;
  if (resolveNpmCli()) return;
  const bundled = bundledNodePath();
  if (existsSync(bundled) && npmCliFor(bundled)) {
    resetRuntimeCache();
    return;
  }
  const zip = bundledNodeZip();
  if (!existsSync(zip)) {
    if (!app.isPackaged) return;
    throw new Error("系统 Node 不可用，安装包里也没有便携 Node。请安装 Node.js 20 及以上，或重新下载安装包。");
  }
  const destRoot = join(app.getPath("userData"), "runtime");
  const destNode = join(destRoot, "node", "node.exe");
  if (existsSync(destNode) && !npmCliFor(destNode)) {
    rmSync(join(destRoot, "node"), { recursive: true, force: true });
  }
  if (mainWindow) void mainWindow.loadURL(page("正在准备 Node.js…"));
  mkdirSync(destRoot, { recursive: true });
  const tar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (!existsSync(tar)) throw new Error("系统没有 tar.exe，需要 Windows 10 及以上才能解压便携 Node。");
  await runCaptured(tar, ["-xf", zip, "-C", destRoot], 120_000);
  flattenExtractedNode(destRoot);
  resetRuntimeCache();
  if (!resolveNpmCli()) throw new Error("便携 Node 解压后仍找不到 npm。");
}

function spawnEnv() {
  const env = { ...process.env };
  if (process.platform === "win32" && (!env.DSH_PERMISSION_MODE || env.DSH_PERMISSION_MODE === "")) {
    env.DSH_PERMISSION_MODE = "danger-full-access";
  }
  delete env.ELECTRON_RUN_AS_NODE;
  const runtime = pickRuntime();
  const parts = [];
  if (runtime.node) parts.push(dirname(runtime.node));
  if (runtime.isolated) {
    const prefix = npmPrefix();
    mkdirSync(prefix, { recursive: true });
    env.npm_config_prefix = prefix;
    env.NPM_CONFIG_PREFIX = prefix;
    parts.push(prefix);
  } else {
    const globalBin = join(process.env.APPDATA || "", "npm");
    if (existsSync(globalBin)) parts.push(globalBin);
  }
  env.Path = [...parts, env.Path || env.PATH || ""].join(delimiter);
  env.PATH = env.Path;
  env.npm_config_fetch_retries = env.npm_config_fetch_retries || "3";
  env.npm_config_audit = "false";
  env.npm_config_fund = "false";
  return env;
}

function spawnHidden(command, args, extra = {}) {
  return spawn(command, args, {
    windowsHide: true,
    stdio: extra.stdio ?? ["ignore", "pipe", "pipe"],
    env: extra.env ?? spawnEnv(),
    cwd: extra.cwd,
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lastLogLine(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .pop() || "";
}

function diagnosticExcerpt(error, limit = 4_000) {
  const text = runtime.redactDiagnosticText(error instanceof Error ? error.message : String(error || ""));
  if (text.length <= limit) return text;
  return `…${text.slice(-limit)}`;
}

function runCaptured(command, args, timeoutOrOpts = 10 * 60 * 1000, onChunk) {
  let timeoutMs = 10 * 60 * 1000;
  let env;
  let cwd;
  if (typeof timeoutOrOpts === "number") timeoutMs = timeoutOrOpts;
  else if (timeoutOrOpts && typeof timeoutOrOpts === "object") {
    timeoutMs = timeoutOrOpts.timeoutMs ?? timeoutMs;
    onChunk = timeoutOrOpts.onChunk || onChunk;
    env = timeoutOrOpts.env;
    cwd = timeoutOrOpts.cwd;
  }
  return new Promise((resolve, reject) => {
    const child = spawnHidden(command, args, { env, cwd });
    let out = "";
    const take = (chunk) => {
      const text = decodeProcessOutput(chunk);
      out += text;
      if (out.length > 80_000) out = out.slice(-80_000);
      onChunk?.(text);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    const timer = setTimeout(() => {
      terminateChildTree(child);
      reject(new Error(`命令超时\n${out}`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out.trim());
      else reject(new Error(`退出码 ${code}\n${out.trim()}`));
    });
  });
}

function peekInstalledDshVersion() {
  if (cachedDshVersion) return cachedDshVersion;
  try {
    const entry = resolveDshEntry();
    if (!entry) return "";
    const pkgPath = join(dirname(entry), "..", "package.json");
    const version = normalizeVersion(JSON.parse(readFileSync(pkgPath, "utf8")).version);
    if (version) cachedDshVersion = version;
    return version;
  } catch {
    return "";
  }
}

async function readDshVersion() {
  const node = resolveNode();
  const entry = resolveDshEntry();
  try {
    if (node && entry && entry.endsWith(".js")) {
      const out = await runCaptured(node, [entry, "--version"], 15_000);
      const raw = out.split(/\r?\n/).filter(Boolean).pop() || out;
      const version = normalizeVersion(raw);
      if (version) cachedDshVersion = version;
      return raw;
    }
    return peekInstalledDshVersion() || "未知";
  } catch (error) {
    return peekInstalledDshVersion() || `无法读取（${error.message.split("\n")[0]}）`;
  }
}

function spawnSupervised(command, args, options = {}) {
  const env = { ...spawnEnv(), ...(options.env || {}) };
  if (options.env?.DSH_HOME) env.DSH_HOME = options.env.DSH_HOME;
  return spawnHidden(command, args, {
    cwd: options.cwd,
    env,
    stdio: options.stdio,
  });
}

function dshChildPid() {
  return supervisor?.getStatus()?.pid;
}

function ensureSupervisor() {
  if (supervisor) return supervisor;
  supervisor = runtime.createSupervisor({
    spawnFn: spawnSupervised,
    protocol: runtime.protocol,
    killFn: terminateChildTree,
  });
  supervisor.on("crash", () => {
    server = undefined;
    serverUrl = undefined;
    if (quitting || updating) return;
    notify("DSH 已退出，正在切到安全模式…");
    if (mainWindow) void mainWindow.loadURL(page("DSH 已退出，正在尝试安全模式…"));
    rebuildTrayMenu();
  });
  supervisor.on("status", (status) => {
    if (quitting) return;
    if (status.state === "running" && status.readyUrl) {
      try {
        serverUrl = new URL(status.readyUrl);
        server = { pid: status.pid };
        if (mainWindow && !updating) void loadDshWindow(serverUrl);
      } catch {
        /* ignore malformed ready URL */
      }
    }
  });
  return supervisor;
}

async function stopServer() {
  server = undefined;
  serverUrl = undefined;
  if (supervisor) await supervisor.stop();
}

async function startServer({ mode, fallbackToSafe = false } = {}) {
  const root = shellDshRoot();
  ensureHomes(root);
  const state = readState();
  const resolvedMode = mode || (state.safeBootRequired ? "safe" : "active");
  if (resolvedMode === "safe") syncSafeUserConfig(root);
  const node = portableNodeBinary();
  const entry = resolveDshEntry();
  if (!node) throw new Error("找不到可用的 Node.js（需要 20 及以上，且带 npm）。");
  if (!entry) throw new Error("找不到 DSH。将尝试自动安装。");

  const startMode = (nextMode) => ensureSupervisor().start({
    dshBinary: entry,
    dshHome: runtime.resolveHome(root, nextMode),
    mode: nextMode,
    extraEnv: windowsPermissionEnv(),
    nodeBinary: node,
    cwd: process.env.USERPROFILE || app.getPath("home"),
  });

  if (fallbackToSafe) startupRecovery = undefined;
  let finalMode = resolvedMode;
  let status;
  try {
    status = await startMode(resolvedMode);
  } catch (activeError) {
    if (!fallbackToSafe || resolvedMode !== "active") throw activeError;
    syncSafeUserConfig(root);
    try {
      status = await startMode("safe");
      finalMode = "safe";
      startupRecovery = { error: activeError, at: Date.now() };
    } catch (safeError) {
      throw new Error(
        `正常模式启动失败：\n${diagnosticExcerpt(activeError)}\n\n`
        + `安全模式也启动失败：\n${diagnosticExcerpt(safeError)}`,
        { cause: safeError },
      );
    }
  }

  if (!status.readyUrl) throw new Error("dsh web 在端口就绪后立刻退出");
  if (finalMode === "safe" && state.safeBootRequired) {
    writeState({ ...state, safeBootRequired: false });
  }
  serverUrl = new URL(status.readyUrl);
  server = { pid: status.pid };
  return serverUrl;
}

function isDark() {
  return nativeTheme.shouldUseDarkColors;
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(message, detail = "") {
  const dark = isDark();
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
  html,body{margin:0;height:100%;background:${dark ? "#202020" : "#f3f3f3"};color:${dark ? "#f3f3f3" : "#1b1b1b"};font:15px/1.5 "Segoe UI",system-ui,sans-serif}
  main{height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;padding:24px;box-sizing:border-box}
  p{opacity:.72;margin:0;text-align:center;max-width:36em}
  .tick{opacity:.5;font-size:13px}
  .log{opacity:.48;font-size:12px;word-break:break-all}
</style></head>
<body><main>
  <h1 style="font-weight:600;margin:0">${escapeHtml(APP_NAME)}</h1>
  <p>${escapeHtml(message)}</p>
  <p class="tick">已等待 <span id="elapsed">0:00</span></p>
  ${detail ? `<p class="log">${escapeHtml(detail)}</p>` : ""}
</main>
<script>
  const t0 = Date.now();
  setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    const el = document.getElementById("elapsed");
    if (el) el.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }, 1000);
</script>
</body></html>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

let splashKey = "";
let lastSplashAt = 0;
function setSplash(message, detail = "") {
  if (!mainWindow) return;
  const key = `${message}\n${detail}`;
  const now = Date.now();
  if (key === splashKey && now - lastSplashAt < 1000) return;
  splashKey = key;
  lastSplashAt = now;
  void mainWindow.loadURL(page(message, detail));
}

function mainWindowHasPage() {
  const url = typeof mainWindow?.webContents?.getURL === "function" ? mainWindow.webContents.getURL() : "";
  return Boolean(url) && url !== "about:blank";
}

function hideMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.hide();
  if (typeof mainWindow.setSkipTaskbar === "function") mainWindow.setSkipTaskbar(true);
}

function showWindow() {
  hideTrayMenu();
  if (!mainWindow || !mainWindowHasPage()) {
    pendingFocus = true;
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (typeof mainWindow.setSkipTaskbar === "function") mainWindow.setSkipTaskbar(false);
  mainWindow.show();
  mainWindow.focus();
}

function createWindow() {
  const settings = readShellSettings();
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: APP_NAME,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: isDark() ? "#202020" : "#f3f3f3",
    icon: windowIcon(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: lockScreenRuntime(settings.runOnLockScreen).backgroundThrottling,
    },
  });
  mainWindow = window;
  window.once("ready-to-show", () => {
    if (startHidden) return;
    if (!mainWindowHasPage()) return;
    showWindow();
  });
  window.on("page-title-updated", (event) => {
    event.preventDefault();
    window.setTitle(APP_NAME);
  });
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    hideMainWindow();
  });
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = undefined;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, target) => {
    if (!serverUrl) return;
    try {
      if (new URL(target).origin === serverUrl.origin) return;
    } catch {
      /* reject below */
    }
    event.preventDefault();
    if (/^https?:/i.test(target)) void shell.openExternal(target);
  });
}

async function clearDshWindowCache() {
  const session = mainWindow?.webContents?.session;
  if (!session) return;
  try {
    await session.clearCache();
  } catch {
    /* session cache is best-effort */
  }
  try {
    await session.clearStorageData?.({
      storages: ["serviceworkers", "cachestorage"],
    });
  } catch {
    /* service worker cache is best-effort */
  }
}

function destroyMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const win = mainWindow;
  win.removeAllListeners("close");
  win.destroy();
  if (mainWindow === win) mainWindow = undefined;
}

async function loadDshWindow(url, { recreate = false } = {}) {
  if (!url) return;
  const href = typeof url === "string" ? url : url.href;
  const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
  if (recreate) {
    destroyMainWindow();
    createWindow();
    applyRunOnLockScreen(readShellSettings().runOnLockScreen);
  } else if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    applyRunOnLockScreen(readShellSettings().runOnLockScreen);
  }
  await clearDshWindowCache();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const current = typeof mainWindow.webContents?.getURL === "function"
    ? mainWindow.webContents.getURL()
    : "";
  if (current === href && typeof mainWindow.webContents.reloadIgnoringCache === "function") {
    mainWindow.webContents.reloadIgnoringCache();
  } else {
    await mainWindow.loadURL(href);
  }
  if ((wasVisible || pendingFocus) && !startHidden) {
    pendingFocus = false;
    showWindow();
  }
}

function notify(body) {
  if (!Notification.isSupported()) return;
  new Notification({ title: APP_NAME, body, icon: ICON_PNG }).show();
}

function normalizeDialogButtons(buttons) {
  const list = Array.isArray(buttons) && buttons.length ? buttons : ["确定"];
  return list.map((item, index) => {
    if (typeof item === "string") {
      return {
        id: `idx:${index}`,
        label: item,
        keepOpen: false,
        primary: index === list.length - 1,
      };
    }
    return {
      id: String(item.id || `idx:${index}`),
      label: String(item.label || item.id || "确定"),
      keepOpen: Boolean(item.keepOpen),
      primary: item.primary ?? index === list.length - 1,
      disabled: Boolean(item.disabled),
    };
  });
}

function serializeDialog(data) {
  return {
    title: data.title,
    message: data.message,
    detail: data.detail,
    shellVersion: data.shellVersion,
    notes: data.notes,
    buttons: normalizeDialogButtons(data.buttons).map((item) => ({
      id: item.id,
      label: item.label,
      primary: item.primary,
      disabled: item.disabled,
    })),
  };
}

function showThemedDialog({ title, message, detail = "", shellVersion = "", notes = "", buttons = ["确定"], width, height, onAction }) {
  const tall = Boolean(notes);
  return new Promise((resolve) => {
    const parent = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()
      ? mainWindow
      : undefined;
    const win = new BrowserWindow({
      parent,
      modal: Boolean(parent),
      width: width ?? (tall ? 560 : 440),
      height: height ?? (tall ? 560 : 240),
      minWidth: 360,
      minHeight: 180,
      show: false,
      skipTaskbar: true,
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      backgroundColor: isDark() ? "#202020" : "#f3f3f3",
      icon: windowIcon(),
      webPreferences: {
        preload: join(__dirname, "preload-dialog.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const current = { title, message, detail, shellVersion, notes, buttons };
    let settled = false;
    let actionGen = 0;
    let busy = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("dialog-choice", onChoice);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    const push = () => {
      if (!win.isDestroyed()) win.webContents.send("dialog-data", serializeDialog(current));
    };
    const apply = (patch) => {
      if (settled || !patch || typeof patch !== "object") return;
      Object.assign(current, patch);
      push();
    };
    const onChoice = async (event, token) => {
      if (event.sender !== win.webContents) return;
      const defs = normalizeDialogButtons(current.buttons);
      const btn = defs.find((item) => item.id === token) || defs[Number(token)];
      if (!btn || btn.disabled) return;
      if (btn.keepOpen) {
        if (busy) return;
        busy = true;
        const gen = ++actionGen;
        apply({
          buttons: defs.map((item) => ({
            ...item,
            disabled: item.keepOpen || item.disabled,
          })),
        });
        try {
          const patch = await onAction?.(btn.id, { apply });
          if (settled || gen !== actionGen) return;
          apply(patch && typeof patch === "object" ? patch : {
            buttons: defs.map((item) => ({ ...item, disabled: false })),
          });
        } catch (error) {
          if (settled || gen !== actionGen) return;
          apply({
            message: `${current.message}\n${error instanceof Error ? error.message : String(error)}`,
            buttons: defs.map((item) => ({ ...item, disabled: false })),
          });
        } finally {
          if (gen === actionGen) busy = false;
        }
        return;
      }
      finish(btn.id.startsWith("idx:") ? Number(btn.id.slice(4)) : btn.id);
    };
    ipcMain.on("dialog-choice", onChoice);
    win.on("closed", () => finish(0));
    win.webContents.once("did-finish-load", () => {
      push();
      win.show();
    });
    void win.loadFile(join(__dirname, "dialog.html"));
  });
}

function stripMarkdown(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .trim();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Mozilla/5.0 dsh-tray",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "text/html,application/atom+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 dsh-tray",
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function htmlToText(html) {
  return decodeEntities(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6]|div|ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function preferChineseNotes(text) {
  const split = text.split(/\n(?=New Features\b)/i);
  if (split.length > 1 && /新增|功能|修复/.test(split[0])) return split[0].trim();
  return text;
}

function formatAtomNotes(hit) {
  if (!hit) return "";
  const date = hit.updated ? `\n发布于 ${String(hit.updated).slice(0, 10)}\n\n` : "\n\n";
  const notes = preferChineseNotes(htmlToText(hit.content || ""));
  if (!notes) return "";
  return `${hit.title || hit.version}${date}${notes}`;
}

async function fetchVersionNotes(version) {
  const clean = normalizeVersion(version) || String(version || "").trim();
  if (!clean || clean.startsWith("无法读取")) return "无法读取本机版本，因此没有版本说明。";

  try {
    const hit = matchAtomEntry(await fetchGithubFeed(), clean);
    const notes = formatAtomNotes(hit);
    if (notes) return notes;
  } catch {
    /* try the HTML release page next */
  }

  try {
    const html = await fetchText(`https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v${clean}`);
    const body = (html.match(/<div[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1];
    if (body) {
      const notes = preferChineseNotes(htmlToText(body));
      if (notes) return `v${clean}\n\n${notes}`;
    }
  } catch {
    /* fall through */
  }

  try {
    const tagged = await fetchJson(`${GITHUB_RELEASES}/tags/dsh-v${clean}`);
    if (tagged?.body) {
      const date = tagged.published_at ? `\n发布于 ${String(tagged.published_at).slice(0, 10)}\n\n` : "\n\n";
      return preferChineseNotes(stripMarkdown(`${tagged.name || tagged.tag_name}${date}${tagged.body}`));
    }
  } catch (error) {
    return `已安装 ${clean}。官方说明拉取失败：${error instanceof Error ? error.message : String(error)}`;
  }
  return `已安装 ${clean}，但没有找到对应的版本说明。`;
}

async function installDsh(spec, onChunk) {
  const npm = resolveNpmCli();
  if (!npm) throw new Error("找不到 npm。请先安装 Node.js。");
  const args = globalDsh.buildGlobalInstallArgs(npm.cli, spec, NPM_INSTALL_FLAGS);
  const opts = { timeoutMs: 10 * 60 * 1000, onChunk };
  try {
    return await runCaptured(npm.node, args, opts);
  } catch (error) {
    if (!isTransientNpmError(error)) throw error;
    return runCaptured(npm.node, args, opts);
  }
}

function windowsPermissionEnv() {
  if (process.platform === "win32" && (!process.env.DSH_PERMISSION_MODE || process.env.DSH_PERMISSION_MODE === "")) {
    return { DSH_PERMISSION_MODE: "danger-full-access" };
  }
  return {};
}

function installProgressText(version, skipped, phase) {
  const skip = skipped.length ? `已跳过 ${skipped.join("、")}。` : "";
  return `正在运行 npm install -g @deepseek-ai/dsh@${version}…${skip}`;
}

function cleanupLegacyShellDshInstall() {
  const root = shellDshRoot();
  const dest = runtime.resolveCurrentInstall(root);
  const staging = runtime.resolveUpgradeStaging(root);
  rmSync(dest, { recursive: true, force: true });
  rmSync(staging, { recursive: true, force: true });
  rmSync(`${dest}.upgrade-state.json`, { force: true });
}

function cleanupPartialDsh() {
  const dir = isolatedRuntime()
    ? join(npmPrefix(), "node_modules", "@deepseek-ai", "dsh")
    : join(process.env.APPDATA || "", "npm", "node_modules", "@deepseek-ai", "dsh");
  rmSync(dir, { recursive: true, force: true });
}

async function installNewestUsableDsh(npm, { onProgress, startFrom, exact = false } = {}) {
  const picked = await candidateDshVersions(npm);
  let candidates = picked.candidates;
  const requested = normalizeVersion(startFrom) || String(startFrom || "");
  if (requested && exact) {
    if (!picked.versions.map(String).includes(requested)) {
      throw new Error(`npm 尚未发布 ${requested}，无法在线安装。`);
    }
    candidates = [requested];
  } else if (requested) {
    if (!candidates.includes(requested)) candidates = [requested];
    else candidates = candidates.slice(candidates.indexOf(requested));
  }
  if (!candidates.length) throw new Error("没有可安装的 DSH 版本");
  const skipped = [];
  let lastError;
  for (const version of candidates) {
    const spec = dshInstallSpec(version) || `${UPDATE_PACKAGE}@${version}`;
    onProgress?.(version, skipped, "download");
    try {
      await installDsh(spec, (chunk) => {
        onProgress?.(version, skipped, "download", lastLogLine(chunk));
      });
      if (!resolveDshEntry()) throw new Error("安装完成但找不到 dsh 入口");
      cleanupLegacyShellDshInstall();
      return { version, skipped, picked };
    } catch (error) {
      lastError = error;
      skipped.push(version);
      cleanupPartialDsh();
    }
  }
  const tried = skipped.length ? `已尝试：${skipped.join("、")}\n` : "";
  throw new Error(`无法安装可用的 DSH。\n${tried}${lastError instanceof Error ? lastError.message : String(lastError || "")}`.trim());
}

async function ensureRuntime() {
  await ensurePortableNode();
  if (!resolveNode()) {
    throw new Error("找不到可用的 Node.js。请安装 Node.js 20 及以上，或使用最新安装包（内含便携 Node）。");
  }
  if (!resolveNpmCli()) {
    throw new Error("找不到 npm，无法自动安装 DSH。");
  }
  if (resolveDshEntry()) {
    cleanupLegacyShellDshInstall();
    return;
  }
  const npm = resolveNpmCli();
  const usingSystem = pickRuntime().source === "system";
  setSplash(
    usingSystem ? "正在安装全局 DSH…" : "正在安装 DSH…",
    "直接运行 npm install -g；插件隔离仍使用独立 DSH_HOME。",
  );
  let notified;
  await installNewestUsableDsh(npm, {
    onProgress: (version, skipped, phase, detail) => {
      setSplash(
        installProgressText(version, skipped, phase),
        detail || "首次安装依赖较多，窗口看起来会停一会儿，后台仍在下载。",
      );
      if (notified !== version) {
        notified = version;
        notify(`正在安装 ${UPDATE_PACKAGE}@${version}`);
      }
    },
  });
}

async function maybeDailyUpdateCheck() {
  if (updating) return;
  const state = readState();
  if (Date.now() - (state.lastCheckAt || 0) < DAY_MS) return;
  const npm = resolveNpmCli();
  if (!npm) return;
  let picked;
  try {
    picked = await candidateDshVersions(npm);
  } catch {
    return;
  }
  writeState({ ...state, lastCheckAt: Date.now() });
  const newest = picked.candidates[0];
  const installed = await readDshVersion();
  if (!newest || !isNewerVersion(newest, normalizeVersion(installed) || installed)) return;
  notify(`发现 DSH ${newest}（当前 ${installed}）`);
  const choice = await showThemedDialog({
    title: "发现新版本",
    message: `当前版本：${installed}\n可安装的最新版：${newest}`,
    detail: "每天会自动检查一次。缺依赖的预发布会自动跳过。是否现在更新？",
    buttons: ["稍后", "立即更新"],
  });
  if (choice === 1) await runUpdate({ confirm: false, targetVersion: newest });
}

function aboutCheckButtons() {
  return [
    { id: "close", label: "关闭" },
    { id: "check", label: "检查更新", keepOpen: true, primary: true },
  ];
}

async function checkInstallableDshUpdate(installed) {
  const npm = resolveNpmCli();
  if (!npm) return { error: "找不到 npm，无法检查更新。" };
  try {
    const picked = await candidateDshVersions(npm);
    return summarizeDshUpdate({
      installed,
      candidates: picked.candidates,
      githubVersion: picked.githubVersion,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function showAbout() {
  const installed = await readDshVersion();
  const installedNotes = await fetchVersionNotes(installed);
  const shellVersion = app.getVersion();
  const runtimeHint = pickRuntime().source === "system"
    ? "已检测到系统 Node，使用全局 DSH（与终端 dsh 同一份）。更新直接运行 npm install -g。"
    : "未检测到可用的系统 Node，使用安装包自带 Node；npm install -g 写入壳的私有 npm prefix。";
  let targetVersion = "";

  const choice = await showThemedDialog({
    title: "关于与更新",
    message: `当前 DSH 版本：${installed}`,
    detail: runtimeHint,
    shellVersion: `DS harness 桌面端 v${shellVersion}`,
    notes: installedNotes,
    width: 560,
    height: 560,
    buttons: aboutCheckButtons(),
    onAction: async (id, { apply }) => {
      if (id !== "check") return;
      apply({
        message: `当前 DSH 版本：${installed}\n正在检查更新…`,
      });
      const result = await checkInstallableDshUpdate(installed);
      if (result.error) {
        return {
          message: `当前 DSH 版本：${installed}\n检查失败：${result.error}`,
          notes: installedNotes,
          buttons: aboutCheckButtons(),
        };
      }
      if (result.updateAvailable) {
        targetVersion = result.latestPublished;
        return {
          message: `当前 DSH 版本：${installed}\n发现可安装版本：${result.latestPublished}`,
          notes: await fetchVersionNotes(result.latestPublished),
          buttons: [
            { id: "close", label: "关闭" },
            { id: "update", label: "更新版本", primary: true },
          ],
        };
      }
      if (result.githubUnpublished) {
        return {
          message: `当前 DSH 版本：${installed}\nGitHub 有 ${result.githubVersion}，但 npm 尚未发布，还不能在线安装。\n可安装的最新版仍是 ${result.latestPublished || installed}`,
          notes: await fetchVersionNotes(result.githubVersion),
          buttons: aboutCheckButtons(),
        };
      }
      return {
        message: `当前 DSH 版本：${installed}\n当前已是可安装的最新版：${result.latestPublished || installed}`,
        notes: installedNotes,
        buttons: aboutCheckButtons(),
      };
    },
  });

  if (choice === "update" && targetVersion) {
    await runUpdate({ confirm: false, targetVersion });
  }
}

function dshHomeDir() {
  const root = shellDshRoot();
  ensureHomes(root);
  return runtime.resolveHome(root, "active");
}

async function openDshHome() {
  const dir = dshHomeDir();
  mkdirSync(dir, { recursive: true });
  const error = await shell.openPath(dir);
  if (error) {
    await showThemedDialog({
      title: "无法打开目录",
      message: `${dir}\n${error}`,
      buttons: ["确定"],
    });
  }
}

async function runUpdate({ confirm = true, targetVersion } = {}) {
  if (updating) return;
  const npm = resolveNpmCli();
  if (!npm) {
    await showThemedDialog({
      title: "找不到 npm",
      message: "请确认已安装 Node.js，并且 node.exe 旁边有 npm。",
      buttons: ["确定"],
    });
    return;
  }
  let picked;
  try {
    picked = await candidateDshVersions(npm);
    targetVersion = targetVersion || picked.candidates[0];
  } catch (error) {
    await showThemedDialog({
      title: "无法检查版本",
      message: error instanceof Error ? error.message : String(error),
      buttons: ["确定"],
    });
    return;
  }
  const installed = await readDshVersion();
  if (!isNewerVersion(targetVersion, normalizeVersion(installed) || installed)) {
    if (confirm) notify(`当前已是可安装的最新版：${normalizeVersion(installed) || targetVersion}`);
    return;
  }
  const spec = dshInstallSpec(targetVersion) || `${UPDATE_PACKAGE}@${targetVersion}`;

  updating = true;
  rebuildTrayMenu();
  if (mainWindow) void mainWindow.loadURL(page(`正在更新到 ${targetVersion}…`));
  notify(`正在安装 ${spec}`);

  try {
    await stopServer();
    if (process.platform === "win32") await delay(400);
    let notified;
    const result = await installNewestUsableDsh(npm, {
      startFrom: targetVersion,
      exact: true,
      onProgress: (version, skipped, phase, detail) => {
        setSplash(
          installProgressText(version, skipped, phase),
          detail || "正在从 npm 拉取依赖，请稍候。",
        );
        if (notified !== version) {
          notified = version;
          notify(`正在安装 ${UPDATE_PACKAGE}@${version}`);
        }
      },
    });
    cachedDshVersion = "";
    writeState({ ...readState(), safeBootRequired: false });
    startupRecovery = undefined;
    const url = await startServer({ mode: "active", fallbackToSafe: true });
    await loadDshWindow(url, { recreate: true });
    const version = await readDshVersion();
    const notes = await fetchVersionNotes(version);
    const skipped = result.skipped.length ? `\n已跳过无法安装的版本：${result.skipped.join("、")}` : "";
    notify(`已更新到 ${version}`);
    if (startupRecovery) notify("社区插件未能启动，已自动进入安全模式。");
    await showThemedDialog({
      title: "更新完成",
      message: `当前版本：${version}${skipped}`,
      notes,
      buttons: ["确定"],
    });
  } catch (error) {
    try {
      const url = await startServer({ mode: "active", fallbackToSafe: true });
      await loadDshWindow(url, { recreate: true });
    } catch {
      if (mainWindow) void mainWindow.loadURL(page("更新失败"));
    }
    await showThemedDialog({
      title: "更新失败",
      message: error instanceof Error ? error.message : String(error),
      buttons: ["确定"],
      width: 520,
      height: 320,
    });
  } finally {
    updating = false;
    rebuildTrayMenu();
  }
}

function pluginBadge() {
  try {
    const root = shellDshRoot();
    const plugins = [];
    for (const kind of ["active", "quarantine"]) {
      for (const item of listInstalled(kind, root)) {
        const id = item.pluginId || item.id;
        if (!id) continue;
        const life = getPluginLifecycle(id, root, { catalogPlugins: listPlugins() });
        plugins.push({
          id,
          installed: true,
          updateAvailable: Boolean(life.updateAvailable),
          quarantined: life.state === "quarantine" || life.state === "quarantined" || kind === "quarantine",
          verifyFailed: life.shellVerification?.status === "failed",
          state: life.state,
        });
      }
    }
    return computeBadge({ plugins });
  } catch {
    return { show: false, reasons: [] };
  }
}

function untrustedPluginEnv() {
  return sanitizeUntrustedEnv(spawnEnv());
}

async function runPluginCli(home, args, { untrusted = false } = {}) {
  const node = portableNodeBinary();
  const entry = resolveDshEntry();
  if (!node || !entry) throw new Error("DSH 未就绪，无法管理插件");
  return runCaptured(node, [entry, "plugin", "--profile", "web", ...args], {
    timeoutMs: 10 * 60 * 1000,
    env: { ...pluginCliEnv(untrusted ? untrustedPluginEnv() : spawnEnv(), { untrusted }), DSH_HOME: home },
    cwd: process.env.USERPROFILE || app.getPath("home"),
  });
}

function verifyProfileLockIntegrity(home, npmName, version, integrity) {
  const lockPath = join(home, "profiles", "web", "pnpm-lock.yaml");
  if (!existsSync(lockPath)) throw new Error("插件安装后没有生成 pnpm lockfile");
  const lock = readFileSync(lockPath, "utf8");
  if (!lock.includes(`${npmName}@${version}`)) {
    throw new Error("pnpm lockfile 没有锁定目标精确版本");
  }
  if (!lock.includes(integrity)) {
    throw new Error("pnpm lockfile integrity 与安装前校验不一致");
  }
}

function verifyRendererUrl(url, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!win.isDestroyed()) win.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error("Renderer settle 超时")), timeoutMs);
    win.webContents.once("did-fail-load", (_event, code, description) => {
      finish(new Error(`Renderer 加载失败 ${code}: ${description}`));
    });
    win.webContents.once("render-process-gone", (_event, details) => {
      finish(new Error(`Renderer 进程退出：${details?.reason || "unknown"}`));
    });
    win.webContents.once("did-finish-load", () => {
      setTimeout(() => finish(), 1_000);
    });
    void win.loadURL(url).catch((error) => finish(error));
  });
}

async function verifyPluginHome(home) {
  const node = portableNodeBinary();
  const entry = resolveDshEntry();
  if (!node || !entry) throw new Error("DSH 未就绪，无法验证插件");
  const cleanEnv = untrustedPluginEnv();
  const probeProtocol = runtime.createProtocol({
    buildEnv: (options) => runtime.buildEnv(options, cleanEnv),
  });
  const probeSpawn = (command, args, options = {}) => spawnHidden(command, args, {
    cwd: options.cwd,
    env: { ...cleanEnv, ...(options.env || {}) },
    stdio: options.stdio,
  });
  const probe = runtime.createSupervisor({
    spawnFn: probeSpawn,
    protocol: probeProtocol,
    autoRecoverSafe: false,
    killFn: terminateChildTree,
  });
  try {
    const status = await probe.start({
      dshBinary: entry,
      dshHome: home,
      mode: "staging",
      extraEnv: windowsPermissionEnv(),
      nodeBinary: node,
      cwd: process.env.USERPROFILE || app.getPath("home"),
    });
    if (!status.readyUrl) throw new Error("插件验证环境未能启动");
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const settled = probe.getStatus();
    if (settled.state !== "running" || !settled.readyUrl) {
      throw new Error("插件在报告就绪后退出");
    }
    const response = await fetch(settled.readyUrl, { signal: AbortSignal.timeout(5_000) });
    if (response.status >= 500) throw new Error(`插件验证 HTTP ${response.status}`);
    await verifyRendererUrl(settled.readyUrl);
    return {
      host: { ok: true, skipped: false, runtime: true, stage: "host-http" },
      renderer: { ok: true, skipped: false, runtime: true, stage: "renderer-settle" },
    };
  } finally {
    await probe.stop();
  }
}

async function performCatalogPluginInstall({ id, plugin, root, modules, onProgress }) {
  if (!root || !plugin) return { ok: false, error: "找不到插件目录条目" };
  let npmName = plugin.npmName || "";

  try {
    onProgress?.({ stage: "repository", message: "正在验证所选仓库的 package.json…" });
    const resolved = await resolveRepositoryPackageIdentity({
      repo: plugin.repo,
      candidateNpmName: npmName,
    });
    npmName = resolved.npmName;
  } catch (error) {
    return { ok: false, error: `仓库身份校验未通过：${error.message || error}` };
  }

  let pin;
  try {
    onProgress?.({ stage: "metadata", message: "正在核对 npm 版本、integrity 与仓库身份…" });
    const hostVersion = normalizeVersion(await readDshVersion()) || peekInstalledDshVersion();
    pin = await modules.catalog.resolveInstallPin({ npmName }, { force: true, hostVersion });
  } catch (error) {
    return { ok: false, error: `无法读取 npm 安装信息：${error.message || error}` };
  }
  const pinError = validateInstallPin(pin);
  if (pinError) return { ok: false, error: pinError };

  // The identity selected by the user is authoritative. The gate compares
  // npm's repository field against it; never let an attacker-controlled npm
  // package replace the selected catalog repository identity.
  const repoIdentity = plugin.repo || pin.repoIdentity;
  const manifest = {
    ...pin.manifest,
    name: npmName,
    version: pin.exactVersion,
    dist: {
      ...(pin.manifest.dist || {}),
      integrity: pin.integrity,
      tarball: pin.tarball || pin.manifest.dist?.tarball,
    },
  };
  const packument = {
    name: npmName,
    repository: manifest.repository,
    versions: { [pin.exactVersion]: manifest },
  };
  const previousReceipt = readLedgerReceipt(root, npmName);
  let gate;
  try {
    onProgress?.({ stage: "gate", message: "正在执行供应链与兼容性门禁…" });
    gate = assertInstallGate({
      requested: {
        name: npmName,
        version: pin.exactVersion,
        integrity: pin.integrity,
        spec: `${npmName}@${pin.exactVersion}`,
        source: "npm",
        ignoreScripts: true,
      },
      packument,
      repoIdentity,
      previousReceipt,
      pluginManifest: manifest,
    });
  } catch (error) {
    return { ok: false, error: `安装前校验未通过：${error.message || error}` };
  }
  const verifiedRepoIdentity = pin.repoIdentity
    ? { ...pin.repoIdentity, id: plugin.repo?.id ?? pin.repoIdentity.id ?? null }
    : gate.repoIdentity;

  const dshVersion = peekInstalledDshVersion();
  const compat = checkCompat({
    pluginManifest: manifest,
    dshInfo: { version: dshVersion, host: dshVersion, renderer: dshVersion },
  });
  if (!compat.ok) {
    return { ok: false, error: `当前 DSH 不兼容：${compat.reasons.join("；")}` };
  }

  ensureHomes(root);
  const staging = runtime.resolveHome(root, "staging");
  const active = runtime.resolveHome(root, "active");
  rmSync(staging, { recursive: true, force: true });
  ensureHomes(root);
  const activeProfile = profileWebDir(active);
  const stagingProfile = profileWebDir(staging);
  prepareStagingProfile(activeProfile, stagingProfile);
  const spec = `${npmName}@${gate.version}`;
  const backup = join(ledgerRoot(root), "snapshots", `active-profile-${Date.now()}`);
  const wal = createWal(walDir(root));
  let walRecord = null;
  let runtimeCompat = null;

  try {
    onProgress?.({ stage: "staging-install", message: "正在隔离环境安装精确版本…" });
    await runPluginCli(
      staging,
      pluginAddArgs(spec),
      { untrusted: true },
    );
    verifyProfileLockIntegrity(staging, npmName, gate.version, gate.integrity);
    onProgress?.({ stage: "staging-verify", message: "正在启动隔离 DSH 验证插件…" });
    runtimeCompat = await verifyPluginHome(staging);

    onProgress?.({ stage: "active-install", message: "隔离验证通过，正在写入正式环境…" });
    const hadActiveProfile = existsSync(activeProfile);
    if (hadActiveProfile) {
      mkdirSync(dirname(backup), { recursive: true });
      cpSync(activeProfile, backup, { recursive: true, force: true });
    }
    const lifecycleSnapshot = existsSync(lifecyclePath(root))
      ? JSON.parse(readFileSync(lifecyclePath(root), "utf8"))
      : { plugins: {} };
    walRecord = wal.begin({
      op: "production-install",
      pluginId: npmName,
      meta: { version: gate.version },
    });
    wal.append(walRecord.id, {
      name: "active-profile-snapshot",
      undo: hadActiveProfile
        ? { type: "restore", path: activeProfile, from: backup }
        : { type: "rm", path: activeProfile },
    });
    wal.append(walRecord.id, {
      name: "lifecycle-snapshot",
      undo: { type: "restore", path: lifecyclePath(root), snapshot: lifecycleSnapshot },
    });
    wal.append(walRecord.id, {
      name: "receipt-snapshot",
      undo: previousReceipt
        ? { type: "restore", path: ledgerReceiptPath(root, npmName), snapshot: previousReceipt }
        : { type: "rm", path: ledgerReceiptPath(root, npmName) },
    });
    await stopServer();
    await runPluginCli(active, pluginAddArgs(spec), { untrusted: true });
    verifyProfileLockIntegrity(active, npmName, gate.version, gate.integrity);
    onProgress?.({ stage: "restart", message: "正在重启 DSH 并确认插件可用…" });
    const url = await startServer({ mode: "active" });
    await loadDshWindow(url);
    const installedAt = new Date().toISOString();
    const receipt = writeLedgerReceipt(root, {
      pluginId: npmName,
      packageName: npmName,
      spec,
      exactVersion: gate.version,
      integrity: gate.integrity,
      repoIdentity: verifiedRepoIdentity,
      source: "npm",
      dshVersion,
      hostCompat: { ...compat.host, ...runtimeCompat.host },
      rendererCompat: { ...compat.renderer, ...runtimeCompat.renderer },
      installedAt,
      walId: walRecord.id,
      homeKind: "active",
      supplyChain: gate.supplyChain,
    });
    setLifecycle(root, npmName, {
      state: "active",
      homeKind: "active",
      exactVersion: gate.version,
      walId: walRecord.id,
      shellVerification: {
        status: "passed",
        host: { ...compat.host, ...runtimeCompat.host },
        renderer: { ...compat.renderer, ...runtimeCompat.renderer },
        reasons: [],
        lastVerifiedAt: installedAt,
      },
    });
    wal.commit(walRecord.id);
    rmSync(backup, { recursive: true, force: true });
    notify(`已安装 ${spec}`);
    return { ok: true, state: "active", receipt, id };
  } catch (error) {
    onProgress?.({ stage: "rollback", message: "验证失败，正在恢复原有插件环境…" });
    if (walRecord) {
      try { wal.abort(walRecord.id); } catch { /* continue to safe recovery */ }
    }
    rmSync(backup, { recursive: true, force: true });
    try {
      const url = await startServer({ mode: "active" });
      await loadDshWindow(url);
    } catch {
      try {
        const url = await startServer({ mode: "safe" });
        await loadDshWindow(url);
      } catch {
        /* tray and uninstall entry must remain alive */
      }
    }
    return { ok: false, error: `安装失败：${friendlyPluginError(error)}` };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

async function installCatalogPlugin(input) {
  const label = input.plugin?.npmName || input.id || "插件安装";
  return pluginOperationGuard.run(label, () => performCatalogPluginInstall(input));
}

async function performCatalogPluginUninstall({ id, plugin, root, modules, onProgress }) {
  if (!root) return { ok: false, error: "插件目录未就绪" };
  const npmName = plugin?.npmName || id;
  const active = runtime.resolveHome(root, "active");
  const activeEntry = findInstalledPlugin(listInstalled("active", root), { plugin, id: npmName });
  if (!activeEntry) {
    try {
      return await modules.install.uninstallPlugin({ root, pluginId: id });
    } catch (error) {
      return { ok: false, error: `卸载失败：${error.message || error}` };
    }
  }

  let removeArgs;
  try {
    removeArgs = pluginRemoveArgs(activeEntry.pluginId || npmName);
  } catch (error) {
    return { ok: false, error: `卸载失败：${friendlyPluginError(error)}` };
  }

  const activeProfile = profileWebDir(active);
  const backup = join(ledgerRoot(root), "snapshots", `uninstall-profile-${Date.now()}`);
  const previousReceipt = readLedgerReceipt(root, npmName);
  const lifecycleSnapshot = existsSync(lifecyclePath(root))
    ? JSON.parse(readFileSync(lifecyclePath(root), "utf8"))
    : { plugins: {} };
  mkdirSync(dirname(backup), { recursive: true });
  cpSync(activeProfile, backup, { recursive: true, force: true });
  const wal = createWal(walDir(root));
  const walRecord = wal.begin({
    op: "production-uninstall",
    pluginId: npmName,
    meta: { version: activeEntry.exactVersion },
  });
  wal.append(walRecord.id, {
    name: "active-profile-snapshot",
    undo: { type: "restore", path: activeProfile, from: backup },
  });
  wal.append(walRecord.id, {
    name: "lifecycle-snapshot",
    undo: { type: "restore", path: lifecyclePath(root), snapshot: lifecycleSnapshot },
  });
  wal.append(walRecord.id, {
    name: "receipt-snapshot",
    undo: previousReceipt
      ? { type: "restore", path: ledgerReceiptPath(root, npmName), snapshot: previousReceipt }
      : { type: "rm", path: ledgerReceiptPath(root, npmName) },
  });

  try {
    onProgress?.({ stage: "remove", message: "正在从正式 profile 卸载插件…" });
    await stopServer();
    await runPluginCli(active, removeArgs, { untrusted: true });
    onProgress?.({ stage: "restart", message: "正在重启 DSH…" });
    const url = await startServer({ mode: "active" });
    await loadDshWindow(url);
    rmSync(ledgerReceiptPath(root, npmName), { force: true });
    setLifecycle(root, npmName, {
      state: "uninstalled",
      homeKind: null,
      exactVersion: activeEntry.exactVersion,
      walId: walRecord.id,
      shellVerification: {
        status: "unknown",
        reasons: [],
        lastVerifiedAt: null,
      },
    });
    wal.commit(walRecord.id);
    rmSync(backup, { recursive: true, force: true });
    notify(`已卸载 ${npmName}`);
    return { ok: true, state: "uninstalled", id };
  } catch (error) {
    try { wal.abort(walRecord.id); } catch { /* restart safe below */ }
    rmSync(backup, { recursive: true, force: true });
    try {
      const url = await startServer({ mode: "active" });
      await loadDshWindow(url);
    } catch {
      /* tray remains available */
    }
    return { ok: false, error: `卸载失败：${friendlyPluginError(error)}` };
  }
}

async function uninstallCatalogPlugin(input) {
  const label = input.plugin?.npmName || input.id || "插件卸载";
  return pluginOperationGuard.run(label, () => performCatalogPluginUninstall(input));
}

function openPluginsFromTray() {
  let root;
  try {
    root = shellDshRoot();
  } catch {
    root = undefined;
  }
  const facade = createFacade({
    root,
    favoritesPath: join(app.getPath("userData"), "plugin-favorites.json"),
    installExecutor: installCatalogPlugin,
    uninstallExecutor: uninstallCatalogPlugin,
    getHostVersion: peekInstalledDshVersion,
  });
  const actions = {};
  for (const [name, fn] of Object.entries(facade.actions || {})) {
    actions[name] = async (...args) => {
      const result = await fn(...args);
      rebuildTrayMenu();
      return result;
    };
  }
  openPluginCenter({ icon: windowIcon(), root, facade: { ...facade, actions } });
}

function trayMenuState() {
  return {
    appName: APP_NAME,
    updating,
    badge: pluginBadge(),
    settings: readShellSettings(),
  };
}

function trayMenuActions() {
  return {
    [OPEN_WINDOW_ID]: showWindow,
    [OPEN_DSH_ID]: () => { void openDshHome(); },
    [PLUGIN_MENU_ID]: openPluginsFromTray,
    [ABOUT_ID]: () => { void showAbout(); },
    [QUIT_ID]: () => { app.quit(); },
    [OPEN_AT_LOGIN_ID]: setOpenAtLogin,
    [RUN_ON_LOCK_SCREEN_ID]: setRunOnLockScreen,
  };
}

function rebuildTrayMenu() {
  refreshTrayMenu();
}

function createTray() {
  const source = nativeImage.createFromPath(iconPath());
  tray = new Tray(source.isEmpty() ? nativeImage.createEmpty() : source);
  tray.setToolTip(APP_NAME);
  const trayClicks = createTrayClickGuard();
  tray.on("click", () => {
    trayClicks.leftClick(showWindow);
  });
  tray.on("double-click", () => {
    trayClicks.cancel();
    showWindow();
  });
  tray.on("right-click", (_event, bounds) => {
    trayClicks.rightClick(() => {
      const trayBounds = bounds && Number.isFinite(bounds.x) ? bounds : tray.getBounds();
      openTrayMenu({
        bounds: trayBounds,
        icon: windowIcon(),
        getState: trayMenuState,
        actions: trayMenuActions(),
      });
    });
  });
  try {
    prepareTrayMenu({
      bounds: tray.getBounds(),
      icon: windowIcon(),
      getState: trayMenuState,
      actions: trayMenuActions(),
    });
  } catch {
    /* popup warms on first right-click */
  }
}

async function boot() {
  nativeTheme.themeSource = "system";
  const settings = readShellSettings();
  cleanupKnownLegacyLoginItem();
  try {
    applyOpenAtLogin(settings.openAtLogin);
  } catch {
    /* login item is best-effort */
  }
  applyRunOnLockScreen(settings.runOnLockScreen);
  const root = shellDshRoot();
  ensureHomes(root);
  createWal(walDir(root)).recover();
  configureCatalog({
    cacheDir: join(app.getPath("userData"), "catalog-cache"),
    getHostVersion: peekInstalledDshVersion,
  });
  void refreshCatalog({ waitForSignals: false }).then(() => { rebuildTrayMenu(); }).catch(() => {});
  createWindow();
  applyRunOnLockScreen(settings.runOnLockScreen);
  createTray();
  try {
    await ensureRuntime();
    const url = await startServer({ fallbackToSafe: true });
    await loadDshWindow(url);
    if (pendingFocus || !startHidden) {
      pendingFocus = false;
      showWindow();
    }
    rebuildTrayMenu();
    if (startupRecovery) {
      const detail = diagnosticExcerpt(startupRecovery.error);
      notify("社区插件未能启动，已自动进入安全模式。");
      if (!startHidden) {
        await showThemedDialog({
          title: "已进入安全模式",
          message: "正常模式中的社区插件与当前 DSH 不兼容。现已自动停用社区插件，托盘和 DSH 仍可正常使用。",
          detail,
          buttons: ["确定"],
          width: 560,
          height: 420,
        });
      }
    }
    void maybeDailyUpdateCheck();
    setInterval(() => { void maybeDailyUpdateCheck(); }, 60 * 60 * 1000);
  } catch (error) {
    const message = runtime.redactDiagnosticText(error instanceof Error ? error.message : String(error));
    await mainWindow.loadURL(page(message));
    rebuildTrayMenu();
    showWindow();
    await showThemedDialog({ title: "启动失败", message, buttons: ["确定"] });
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  startHidden = wantsHiddenStart(process.argv);
  applyPopupWindowSwitches(app.commandLine);
  try {
    applyChromiumLockScreenSwitches(app.commandLine, readShellSettings().runOnLockScreen);
  } catch {
    /* userData may be unavailable; lock-screen switches apply again after ready */
  }
  app.on("second-instance", showWindow);
  app.setAppUserModelId("local.dsh.tray");
  app.whenReady().then(() => void boot());
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (quitting) {
      if (dshChildPid()) event.preventDefault();
      return;
    }
    quitting = true;
    if (dshChildPid()) {
      event.preventDefault();
      void stopServer().then(() => app.quit());
    }
  });
}
