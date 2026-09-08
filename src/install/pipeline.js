"use strict";

const { cpSync, existsSync, writeFileSync } = require("node:fs");
const { dirname, join, resolve, sep } = require("node:path");
const homes = require("../homes");
const { ensureDir, readJson, removePath, writeJsonAtomic } = require("../homes/io");
const { checkCompat } = require("./compat");
const { detectUpdateAvailable } = require("./updates");
const { InstallCrashError } = require("./errors");
const { readLedgerReceipt, writeLedgerReceipt, writeReceipt } = require("./receipt");
const { assertInstallGate } = require("./supply-chain");
const { createWal } = require("./wal");

function maybeCrash(opts, step) {
  if (opts?.crashAfter === step) throw new InstallCrashError(`simulated crash after ${step}`, step);
}

function pluginPackageDir(home, pluginId) {
  return join(homes.pluginStorePath(home, pluginId), "package");
}

async function defaultUnpackFn({ destDir, pluginManifest, files }) {
  ensureDir(destDir);
  const root = resolve(destDir);
  if (files && typeof files === "object") {
    for (const [rel, content] of Object.entries(files)) {
      const file = resolve(root, rel);
      if (file !== root && !file.startsWith(`${root}${sep}`)) {
        throw new Error(`archive path escapes plugin directory: ${rel}`);
      }
      ensureDir(dirname(file));
      writeFileSync(file, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`);
    }
    return destDir;
  }
  writeJsonAtomic(join(destDir, "package.json"), pluginManifest || {});
  return destDir;
}

async function defaultVerifyFn({ pluginManifest, dshInfo }) {
  return checkCompat({ pluginManifest, dshInfo });
}

async function defaultNpmFetchFn() {
  return undefined;
}

function addToProfile(home, pluginId, version) {
  const pkgPath = homes.profilePackagePath(home);
  const pkg = homes.readProfile(home);
  pkg.dependencies = { ...(pkg.dependencies || {}) };
  pkg.dependencies[pluginId] = version;
  pkg.dsh = pkg.dsh || {};
  pkg.dsh.profile = pkg.dsh.profile || {};
  const bundles = [...(pkg.dsh.profile.bundles || [])];
  if (!bundles.includes(pluginId)) bundles.push(pluginId);
  pkg.dsh.profile.bundles = bundles;
  writeJsonAtomic(pkgPath, pkg);
}

function removeFromProfile(home, pluginId) {
  const pkgPath = homes.profilePackagePath(home);
  const pkg = homes.readProfile(home);
  if (pkg.dependencies) delete pkg.dependencies[pluginId];
  if (pkg.dsh?.profile?.bundles) {
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((name) => name !== pluginId);
  }
  writeJsonAtomic(pkgPath, pkg);
}

function readLifecycle(root) {
  return readJson(homes.lifecyclePath(root), { plugins: {} });
}

function writeLifecycle(root, data) {
  return writeJsonAtomic(homes.lifecyclePath(root), data);
}

function setLifecycle(root, pluginId, patch) {
  const data = readLifecycle(root);
  const prev = data.plugins[pluginId] || {};
  data.plugins[pluginId] = {
    ...prev,
    ...patch,
    pluginId,
    shellVerification: patch.shellVerification || prev.shellVerification || {
      status: "unknown",
      reasons: [],
      lastVerifiedAt: null,
    },
  };
  writeLifecycle(root, data);
  return data.plugins[pluginId];
}

function deriveHomeState(root, pluginId) {
  for (const kind of ["active", "staging", "quarantine"]) {
    const found = homes.listInstalled(kind, root).find((item) => item.pluginId === pluginId);
    if (found) return { kind, found };
  }
  return { kind: "uninstalled", found: null };
}

function getPluginLifecycle(id, root, options = {}) {
  if (!root) throw new Error("getPluginLifecycle(id, root) requires root");
  const entry = readLifecycle(root).plugins?.[id];
  const derived = deriveHomeState(root, id);
  if (!entry && derived.kind === "uninstalled") {
    return {
      state: "uninstalled",
      shellVerification: { status: "unknown", reasons: [], lastVerifiedAt: null },
      updateAvailable: false,
    };
  }
  const exactVersion = derived.found?.exactVersion || entry?.exactVersion || null;
  const hint = detectUpdateAvailable({
    pluginId: id,
    installedVersion: exactVersion,
    catalogPlugins: options.catalogPlugins,
    dshInfo: options.dshInfo,
    pin: options.pin,
  });
  return {
    state: derived.kind,
    latestAttempt: entry?.state || derived.kind,
    shellVerification: entry?.shellVerification || { status: "unknown", reasons: [], lastVerifiedAt: null },
    exactVersion,
    homeKind: derived.kind === "uninstalled" ? null : derived.kind,
    walId: entry?.walId || null,
    updateAvailable: Boolean(entry?.updateAvailable) || hint.updateAvailable,
    availableVersion: hint.availableVersion || entry?.availableVersion || null,
  };
}

function copyPlugin(fromHome, toHome, pluginId) {
  const src = homes.pluginStorePath(fromHome, pluginId);
  const dest = homes.pluginStorePath(toHome, pluginId);
  ensureDir(homes.pluginsStoreDir(toHome));
  if (existsSync(dest)) removePath(dest);
  if (existsSync(src)) cpSync(src, dest, { recursive: true });
  return dest;
}

function snapshotDir(src, dest) {
  if (!existsSync(src)) return null;
  ensureDir(dirname(dest));
  cpSync(src, dest, { recursive: true });
  return dest;
}

function mergeCompat(pluginManifest, dshInfo, runtime) {
  const staticCompat = checkCompat({ pluginManifest, dshInfo });
  const withRuntime = checkCompat({ pluginManifest, dshInfo, runtime });
  const reasons = [...new Set([
    ...(staticCompat.reasons || []),
    ...(runtime?.reasons || []),
    ...(withRuntime.reasons || []),
  ])];
  const host = withRuntime.host;
  const renderer = withRuntime.renderer;
  const ok = staticCompat.ok && withRuntime.ok && runtime?.ok !== false && host.ok && renderer.ok;
  return { ok, host, renderer, reasons, fields: withRuntime.fields };
}

function resolveWal(root, wal) {
  return wal || createWal(homes.walDir(root));
}

function writePluginReceipt(home, pluginId, receipt) {
  const dest = join(homes.pluginStorePath(home, pluginId), "receipt.json");
  return writeReceipt(dest, receipt);
}

async function quarantineFromStaging({ root, pluginId, wal, walId, receiptBase, compat, verifiedAt }) {
  const staging = homes.resolveHome(root, "staging");
  const quarantine = homes.resolveHome(root, "quarantine");
  const prevProfile = homes.readProfile(quarantine);
  const dest = copyPlugin(staging, quarantine, pluginId);
  wal.append(walId, { name: "copy-quarantine", undo: { type: "rm", path: dest } });
  addToProfile(quarantine, pluginId, receiptBase.exactVersion);
  wal.append(walId, {
    name: "profile-quarantine",
    undo: { type: "restore", path: homes.profilePackagePath(quarantine), snapshot: prevProfile },
  });
  const receipt = writePluginReceipt(quarantine, pluginId, {
    ...receiptBase,
    homeKind: "quarantine",
    hostCompat: compat.host,
    rendererCompat: compat.renderer,
  });
  writeLedgerReceipt(root, receipt);
  removePath(homes.pluginStorePath(staging, pluginId));
  removeFromProfile(staging, pluginId);
  setLifecycle(root, pluginId, {
    state: "quarantine",
    homeKind: "quarantine",
    exactVersion: receiptBase.exactVersion,
    walId,
    shellVerification: { status: "failed", reasons: compat.reasons, lastVerifiedAt: verifiedAt },
  });
  wal.commit(walId);
  return {
    ok: false,
    state: "quarantine",
    receipt,
    compat,
    walId,
    lifecycle: getPluginLifecycle(pluginId, root),
  };
}

async function promoteFromStaging({ root, pluginId, wal, walId, receiptBase, compat, version, opts }) {
  const staging = homes.resolveHome(root, "staging");
  const active = homes.resolveHome(root, "active");
  const snap = snapshotDir(
    homes.pluginStorePath(active, pluginId),
    join(homes.ledgerRoot(root), "snapshots", `${homes.encodePluginId(pluginId)}-${Date.now()}`),
  );
  const prevProfile = homes.readProfile(active);
  if (snap) {
    wal.append(walId, {
      name: "snapshot-active",
      undo: { type: "restore", path: homes.pluginStorePath(active, pluginId), from: snap },
    });
  }
  const dest = copyPlugin(staging, active, pluginId);
  wal.append(walId, { name: "copy-active", undo: { type: "rm", path: dest } });
  maybeCrash(opts, "promote");
  addToProfile(active, pluginId, version);
  wal.append(walId, {
    name: "profile-active",
    undo: { type: "restore", path: homes.profilePackagePath(active), snapshot: prevProfile },
  });
  const receipt = writePluginReceipt(active, pluginId, {
    ...receiptBase,
    homeKind: "active",
    hostCompat: compat.host,
    rendererCompat: compat.renderer,
  });
  writeLedgerReceipt(root, receipt);
  removePath(homes.pluginStorePath(staging, pluginId));
  removeFromProfile(staging, pluginId);
  const verifiedAt = receiptBase.installedAt;
  setLifecycle(root, pluginId, {
    state: "active",
    homeKind: "active",
    exactVersion: version,
    walId,
    shellVerification: { status: "passed", reasons: [], lastVerifiedAt: verifiedAt },
  });
  wal.commit(walId);
  return {
    ok: true,
    state: "active",
    receipt,
    compat,
    walId,
    lifecycle: getPluginLifecycle(pluginId, root),
  };
}

async function installPlugin(opts = {}) {
  const root = opts.root;
  if (!root) throw new Error("installPlugin requires opts.root (shellDshRoot)");
  homes.ensureHomes(root);
  const wal = resolveWal(root, opts.wal);
  const requested = opts.requested || {};
  const packument = opts.packument || (opts.npmFetchFn ? await opts.npmFetchFn(requested) : await defaultNpmFetchFn(requested));
  const pluginId = opts.pluginId || requested.name;
  const previousReceipt = opts.previousReceipt !== undefined
    ? opts.previousReceipt
    : (pluginId ? readLedgerReceipt(root, pluginId) : null);

  const gate = assertInstallGate({
    requested,
    packument,
    repoIdentity: opts.repoIdentity,
    previousReceipt,
    pluginManifest: opts.pluginManifest,
  });

  const id = pluginId || gate.name;
  const record = wal.begin({ op: "install", pluginId: id, meta: { version: gate.version } });
  const staging = homes.resolveHome(root, "staging");
  const destRoot = homes.pluginStorePath(staging, id);
  const destDir = join(destRoot, "package");
  const prevLifecycle = readLifecycle(root);
  const prevStagingProfile = homes.readProfile(staging);

  try {
    wal.append(record.id, {
      name: "lifecycle-snapshot",
      undo: { type: "restore", path: homes.lifecyclePath(root), snapshot: prevLifecycle },
    });
    removePath(destRoot);
    ensureDir(destDir);
    const unpackFn = opts.unpackFn || defaultUnpackFn;
    await unpackFn({
      destDir,
      destRoot,
      home: staging,
      pluginId: id,
      pluginManifest: opts.pluginManifest,
      files: opts.files,
      requested,
      packument,
    });
    wal.append(record.id, { name: "unpack-staging", undo: { type: "rm", path: destRoot } });
    maybeCrash(opts, "unpack");

    const pluginManifest = opts.pluginManifest
      || readJson(join(destDir, "package.json"), null)
      || { name: id, version: gate.version, dsh: { bundle: { patch: "./cordis.patch.yml" } } };

    const verifyFn = opts.verifyFn || defaultVerifyFn;
    const runtime = await verifyFn({
      pluginManifest,
      dshInfo: opts.dshInfo,
      pluginDir: destDir,
      home: staging,
      pluginId: id,
    });
    const compat = mergeCompat(pluginManifest, opts.dshInfo, runtime);
    const verifiedAt = new Date().toISOString();
    const receiptBase = {
      pluginId: id,
      exactVersion: gate.version,
      integrity: gate.integrity,
      repoIdentity: gate.repoIdentity,
      source: gate.source,
      dshVersion: opts.dshInfo?.version || null,
      hostCompat: compat.host,
      rendererCompat: compat.renderer,
      installedAt: verifiedAt,
      walId: record.id,
      supplyChain: gate.supplyChain,
    };

    writePluginReceipt(staging, id, { ...receiptBase, homeKind: "staging" });
    addToProfile(staging, id, gate.version);
    wal.append(record.id, {
      name: "stage-profile",
      undo: { type: "restore", path: homes.profilePackagePath(staging), snapshot: prevStagingProfile },
    });
    setLifecycle(root, id, {
      state: "staging",
      homeKind: "staging",
      exactVersion: gate.version,
      walId: record.id,
      shellVerification: {
        status: compat.ok ? "pending" : "failed",
        reasons: compat.reasons,
        lastVerifiedAt: verifiedAt,
      },
    });
    maybeCrash(opts, "verify");

    if (!compat.ok) {
      return quarantineFromStaging({
        root,
        pluginId: id,
        wal,
        walId: record.id,
        receiptBase,
        compat,
        verifiedAt,
      });
    }

    return promoteFromStaging({
      root,
      pluginId: id,
      wal,
      walId: record.id,
      receiptBase,
      compat,
      version: gate.version,
      opts,
    });
  } catch (error) {
    if (error instanceof InstallCrashError) throw error;
    try {
      wal.abort(record.id);
    } catch {
      /* recover() can still clean leftovers */
    }
    throw error;
  }
}

async function quarantinePlugin(opts = {}) {
  const root = opts.root;
  const pluginId = opts.pluginId;
  if (!root || !pluginId) throw new Error("quarantinePlugin requires root and pluginId");
  homes.ensureHomes(root);
  const wal = resolveWal(root, opts.wal);
  const record = wal.begin({ op: "quarantine", pluginId });
  const reasons = opts.reasons || ["manually quarantined"];
  const verifiedAt = new Date().toISOString();
  let moved = false;
  for (const kind of ["active", "staging"]) {
    const home = homes.resolveHome(root, kind);
    const store = homes.pluginStorePath(home, pluginId);
    if (!existsSync(store)) continue;
    const quarantine = homes.resolveHome(root, "quarantine");
    const dest = copyPlugin(home, quarantine, pluginId);
    wal.append(record.id, { name: `copy-from-${kind}`, undo: { type: "rm", path: dest } });
    const prevQ = homes.readProfile(quarantine);
    const version = opts.exactVersion || homes.readProfile(home).dependencies?.[pluginId] || "0.0.0";
    addToProfile(quarantine, pluginId, version);
    wal.append(record.id, {
      name: `q-profile-${kind}`,
      undo: { type: "restore", path: homes.profilePackagePath(quarantine), snapshot: prevQ },
    });
    const prev = homes.readProfile(home);
    removePath(store);
    removeFromProfile(home, pluginId);
    wal.append(record.id, {
      name: `clear-${kind}`,
      undo: { type: "restore", path: homes.profilePackagePath(home), snapshot: prev },
    });
    moved = true;
  }
  const prevReceipt = readLedgerReceipt(root, pluginId);
  const receipt = writePluginReceipt(homes.resolveHome(root, "quarantine"), pluginId, {
    pluginId,
    exactVersion: opts.exactVersion || prevReceipt?.exactVersion || "0.0.0",
    integrity: opts.integrity || prevReceipt?.integrity || "sha512-cXVhbnI=",
    repoIdentity: opts.repoIdentity || prevReceipt?.repoIdentity || { host: "github.com", owner: "unknown", name: pluginId, id: "unknown" },
    source: opts.source || prevReceipt?.source || "npm",
    dshVersion: opts.dshInfo?.version || prevReceipt?.dshVersion || null,
    hostCompat: opts.hostCompat || prevReceipt?.hostCompat || { ok: false },
    rendererCompat: opts.rendererCompat || prevReceipt?.rendererCompat || { ok: false },
    installedAt: verifiedAt,
    walId: record.id,
    homeKind: "quarantine",
    supplyChain: prevReceipt?.supplyChain || { changes: [] },
  });
  writeLedgerReceipt(root, receipt);
  setLifecycle(root, pluginId, {
    state: "quarantine",
    homeKind: "quarantine",
    exactVersion: receipt.exactVersion,
    walId: record.id,
    shellVerification: { status: "failed", reasons, lastVerifiedAt: verifiedAt },
  });
  wal.commit(record.id);
  return {
    ok: true,
    state: "quarantine",
    moved,
    receipt,
    walId: record.id,
    lifecycle: getPluginLifecycle(pluginId, root),
  };
}

async function uninstallPlugin(opts = {}) {
  const root = opts.root;
  const pluginId = opts.pluginId;
  if (!root || !pluginId) throw new Error("uninstallPlugin requires root and pluginId");
  homes.ensureHomes(root);
  const wal = resolveWal(root, opts.wal);
  const record = wal.begin({ op: "uninstall", pluginId });
  const previous = getPluginLifecycle(pluginId, root);
  for (const kind of ["active", "staging", "quarantine"]) {
    const home = homes.resolveHome(root, kind);
    const store = homes.pluginStorePath(home, pluginId);
    if (existsSync(store)) {
      const snap = join(homes.ledgerRoot(root), "snapshots", `uninstall-${kind}-${homes.encodePluginId(pluginId)}`);
      snapshotDir(store, snap);
      removePath(store);
      wal.append(record.id, { name: `rm-store-${kind}`, undo: { type: "restore", path: store, from: snap } });
    }
    const prev = homes.readProfile(home);
    if (prev.dependencies?.[pluginId] || prev.dsh?.profile?.bundles?.includes(pluginId)) {
      removeFromProfile(home, pluginId);
      wal.append(record.id, {
        name: `rm-profile-${kind}`,
        undo: { type: "restore", path: homes.profilePackagePath(home), snapshot: prev },
      });
    }
  }
  setLifecycle(root, pluginId, {
    state: "uninstalled",
    homeKind: null,
    exactVersion: previous.exactVersion,
    walId: record.id,
    shellVerification: previous.shellVerification,
  });
  wal.commit(record.id);
  return {
    ok: true,
    state: "uninstalled",
    walId: record.id,
    lifecycle: getPluginLifecycle(pluginId, root),
  };
}

async function promoteStaging(opts = {}) {
  const root = opts.root;
  const pluginId = opts.pluginId;
  if (!root || !pluginId) throw new Error("promoteStaging requires root and pluginId");
  homes.ensureHomes(root);
  const staging = homes.resolveHome(root, "staging");
  const destDir = pluginPackageDir(staging, pluginId);
  if (!existsSync(homes.pluginStorePath(staging, pluginId))) {
    throw new Error(`${pluginId} is not in staging`);
  }
  const pluginManifest = opts.pluginManifest || readJson(join(destDir, "package.json"), {});
  const verifyFn = opts.verifyFn || defaultVerifyFn;
  const runtime = await verifyFn({
    pluginManifest,
    dshInfo: opts.dshInfo,
    pluginDir: destDir,
    home: staging,
    pluginId,
  });
  const compat = mergeCompat(pluginManifest, opts.dshInfo, runtime);
  const wal = resolveWal(root, opts.wal);
  const record = wal.begin({ op: "promote", pluginId });
  const previous = readLedgerReceipt(root, pluginId) || readJson(join(homes.pluginStorePath(staging, pluginId), "receipt.json"), null);
  const verifiedAt = new Date().toISOString();
  const receiptBase = {
    pluginId,
    exactVersion: opts.exactVersion || previous?.exactVersion || pluginManifest.version || "0.0.0",
    integrity: opts.integrity || previous?.integrity || "sha512-cXVhbnI=",
    repoIdentity: opts.repoIdentity || previous?.repoIdentity || { host: "github.com", owner: "unknown", name: pluginId, id: "unknown" },
    source: opts.source || previous?.source || "npm",
    dshVersion: opts.dshInfo?.version || previous?.dshVersion || null,
    hostCompat: compat.host,
    rendererCompat: compat.renderer,
    installedAt: verifiedAt,
    walId: record.id,
    supplyChain: previous?.supplyChain || { changes: [] },
  };
  if (!compat.ok) {
    return quarantineFromStaging({
      root,
      pluginId,
      wal,
      walId: record.id,
      receiptBase,
      compat,
      verifiedAt,
    });
  }
  return promoteFromStaging({
    root,
    pluginId,
    wal,
    walId: record.id,
    receiptBase,
    compat,
    version: receiptBase.exactVersion,
    opts,
  });
}

function createInstallContext(root) {
  homes.ensureHomes(root);
  const wal = createWal(homes.walDir(root));
  return {
    root,
    wal,
    installPlugin: (opts) => installPlugin({ ...opts, root, wal }),
    quarantinePlugin: (opts) => quarantinePlugin({ ...opts, root, wal }),
    uninstallPlugin: (opts) => uninstallPlugin({ ...opts, root, wal }),
    promoteStaging: (opts) => promoteStaging({ ...opts, root, wal }),
    getPluginLifecycle: (id) => getPluginLifecycle(id, root),
    listInstalled: (kind) => homes.listInstalled(kind, root),
    recover: () => wal.recover(),
  };
}

module.exports = {
  addToProfile,
  createInstallContext,
  defaultUnpackFn,
  defaultVerifyFn,
  getPluginLifecycle,
  installPlugin,
  promoteStaging,
  quarantinePlugin,
  removeFromProfile,
  setLifecycle,
  uninstallPlugin,
};
