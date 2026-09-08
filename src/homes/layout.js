"use strict";

const { existsSync, readdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  HOME_KINDS,
  assertHomeKind,
  homeMetaPath,
  homePath,
  isOfficialBundle,
  ledgerRoot,
  lifecyclePath,
  pluginsStoreDir,
  profilePackagePath,
  profileWebDir,
  receiptsDir,
  resolveHome,
  isExternalActiveHome,
  walDir,
} = require("./paths");
const { ensureDir, pathExists, readJson, writeJsonAtomic } = require("./io");

const WEB_OFFICIAL_BUNDLES = Object.freeze([
  "@deepseek-ai/dsh-base",
  "@deepseek-ai/dsh-web-app",
]);

function emptyProfileManifest(kind) {
  return {
    name: `dsh-profile-web-${kind}`,
    private: true,
    dependencies: {},
    dsh: {
      profile: {
        bundles: [...WEB_OFFICIAL_BUNDLES],
      },
    },
  };
}

function communityDependencies(pkg) {
  return Object.keys(pkg?.dependencies || {}).filter((name) => !isOfficialBundle(name));
}

function communityBundles(pkg) {
  const bundles = pkg?.dsh?.profile?.bundles || [];
  return bundles.filter((name) => !isOfficialBundle(name));
}

function sanitizeSafeProfile(pkg) {
  const next = {
    ...pkg,
    dependencies: { ...pkg.dependencies },
    dsh: {
      ...(pkg.dsh || {}),
      profile: {
        ...(pkg.dsh?.profile || {}),
        bundles: [...(pkg.dsh?.profile?.bundles || WEB_OFFICIAL_BUNDLES)],
      },
    },
  };
  for (const name of communityDependencies(next)) delete next.dependencies[name];
  next.dsh.profile.bundles = next.dsh.profile.bundles.filter((name) => isOfficialBundle(name));
  if (!next.dsh.profile.bundles.length) next.dsh.profile.bundles = [...WEB_OFFICIAL_BUNDLES];
  return next;
}

function ensureProfile(home, kind) {
  const web = ensureDir(profileWebDir(home));
  const pkgPath = profilePackagePath(home);
  if (!pathExists(pkgPath)) {
    writeJsonAtomic(pkgPath, emptyProfileManifest(kind));
  } else if (kind === "safe") {
    const current = readJson(pkgPath, emptyProfileManifest(kind));
    const cleaned = sanitizeSafeProfile(current);
    if (JSON.stringify(current) !== JSON.stringify(cleaned)) writeJsonAtomic(pkgPath, cleaned);
  }
  const patchPath = join(web, "cordis.patch.yml");
  if (!existsSync(patchPath)) writeFileSync(patchPath, "[]\n", "utf8");
  const workspace = join(web, "pnpm-workspace.yaml");
  if (!existsSync(workspace)) writeFileSync(workspace, "packages:\n  - '.'\n", "utf8");
  return { web, pkgPath, patchPath };
}

function ensureHome(root, kind) {
  assertHomeKind(kind);
  const home = resolveHome(root, kind);
  ensureDir(home);
  // The original ~/.dsh is the user's live home. Merely opening the tray
  // must not add shell metadata or rewrite its profile. Plugin operations
  // create only the files they explicitly need.
  if (kind === "active" && isExternalActiveHome(root)) return home;
  ensureDir(pluginsStoreDir(home));
  const metaPath = homeMetaPath(home);
  const existing = pathExists(metaPath) ? readJson(metaPath, null) : null;
  if (existing && existing.kind && existing.kind !== kind) {
    throw new Error(`home ${home} is marked ${existing.kind}, expected ${kind}`);
  }
  writeJsonAtomic(metaPath, {
    kind,
    communityPluginsAllowed: kind !== "safe",
    createdAt: existing?.createdAt || new Date().toISOString(),
    validatedAt: new Date().toISOString(),
  });
  ensureProfile(home, kind);
  return home;
}

function ensureLedger(root) {
  ensureDir(ledgerRoot(root));
  ensureDir(receiptsDir(root));
  ensureDir(walDir(root));
  if (!pathExists(lifecyclePath(root))) {
    writeJsonAtomic(lifecyclePath(root), { plugins: {} });
  }
}

function ensureHomes(root) {
  if (!root) throw new Error("ensureHomes(root) requires shellDshRoot");
  ensureLedger(root);
  const paths = {};
  for (const kind of HOME_KINDS) paths[kind] = ensureHome(root, kind);
  return {
    root,
    paths,
    listInstalled: (homeKind) => listInstalled(homeKind, root),
    homePath: (kind) => homePath(root, kind),
  };
}

function readProfile(home) {
  return readJson(profilePackagePath(home), emptyProfileManifest("active"));
}

function listFromProfile(home, homeKind) {
  const pkg = readProfile(home);
  const names = new Set([...communityDependencies(pkg), ...communityBundles(pkg)]);
  return [...names].sort().map((pluginId) => ({
    pluginId,
    exactVersion: pkg.dependencies?.[pluginId] || null,
    homeKind,
    source: "profile",
  }));
}

function listFromStore(home, homeKind) {
  const store = pluginsStoreDir(home);
  if (!pathExists(store)) return [];
  const out = [];
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(store, entry.name);
    const receipt = readJson(join(dir, "receipt.json"), null);
    const pkg = readJson(join(dir, "package", "package.json"), readJson(join(dir, "package.json"), null));
    const pluginId = receipt?.pluginId || pkg?.name || decodeURIComponent(entry.name);
    if (isOfficialBundle(pluginId)) continue;
    out.push({
      pluginId,
      exactVersion: receipt?.exactVersion || pkg?.version || null,
      homeKind,
      receipt,
      source: "store",
    });
  }
  return out;
}

function listInstalled(homeKind, root) {
  if (!root) throw new Error("listInstalled(homeKind, root) requires root (or call ensureHomes(root).listInstalled)");
  const kind = assertHomeKind(homeKind);
  const home = resolveHome(root, kind);
  if (kind === "safe") {
    const community = [...listFromProfile(home, kind), ...listFromStore(home, kind)];
    return community.filter((item) => !isOfficialBundle(item.pluginId));
  }
  const byId = new Map();
  for (const item of [...listFromStore(home, kind), ...listFromProfile(home, kind)]) {
    const prev = byId.get(item.pluginId);
    if (!prev || (item.receipt && !prev.receipt)) byId.set(item.pluginId, { ...prev, ...item });
    else byId.set(item.pluginId, { ...item, ...prev });
  }
  return [...byId.values()].sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

function readHomeMeta(root, kind) {
  return readJson(homeMetaPath(resolveHome(root, kind)), null);
}

module.exports = {
  WEB_OFFICIAL_BUNDLES,
  communityBundles,
  communityDependencies,
  emptyProfileManifest,
  ensureHome,
  ensureHomes,
  ensureLedger,
  homePath,
  listInstalled,
  readHomeMeta,
  readProfile,
  sanitizeSafeProfile,
};
