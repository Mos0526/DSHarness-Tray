"use strict";

const { isExactVersion } = require("./semver");
const { integrityEquals, parseIntegrity } = require("./integrity");
const { InstallGateError } = require("./errors");

const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "preuninstall", "prepare"];

const MARKETPLACE_NAME_RE = /plugin[-_]?hub|plugin[-_]?market|plugin[-_]?center|plugin[-_]?store|dsh-plugins-marketplace/i;
const MARKETPLACE_KEYWORDS = new Set([
  "plugin-marketplace",
  "dsh-marketplace",
  "plugin-hub",
  "plugin-manager-marketplace",
]);

function versionDocument(packument, version) {
  if (!packument) return null;
  if (packument.versions?.[version]) return packument.versions[version];
  if (packument.version === version && (packument.dist || packument.integrity)) return packument;
  return null;
}

function parseGithubRepo(input) {
  if (!input) return null;
  const url = typeof input === "string" ? input : input.url || "";
  const directory = typeof input === "object" ? input.directory : undefined;
  const text = String(url).trim();
  if (!text) return null;
  const match = text.match(/github\.com[:/]([^/]+)\/([^/#]+)/i);
  if (!match) return null;
  return {
    host: "github.com",
    owner: match[1],
    name: String(match[2]).replace(/\.git$/i, ""),
    directory: directory || undefined,
  };
}

function identityKey(identity) {
  if (!identity) return "";
  if (identity.id != null && identity.id !== "") return `id:${identity.id}`;
  const host = identity.host || "github.com";
  const owner = identity.owner || "";
  const name = identity.name || identity.repo || "";
  const directory = identity.directory ? `#${identity.directory}` : "";
  return `${host}/${owner}/${name}${directory}`.toLowerCase();
}

function identitiesMatch(left, right) {
  if (!left || !right) return false;
  if (left.id != null && right.id != null && String(left.id) === String(right.id)) {
    return true;
  }
  const host = (value) => String(value.host || "github.com").toLowerCase();
  const owner = (value) => String(value.owner || "").toLowerCase();
  const name = (value) => String(value.name || value.repo || "").toLowerCase();
  return host(left) === host(right)
    && owner(left) === owner(right)
    && name(left) === name(right);
}

function isMarketplacePlugin(manifest) {
  const name = manifest?.name || manifest?.requestedName || "";
  if (MARKETPLACE_NAME_RE.test(name)) return true;
  if (manifest?.dsh?.kind === "marketplace" || manifest?.dsh?.role === "marketplace") return true;
  const keywords = manifest?.keywords || [];
  if (keywords.some((word) => MARKETPLACE_KEYWORDS.has(String(word).toLowerCase()))) return true;
  return false;
}

function hasLifecycleScripts(doc) {
  const scripts = doc?.scripts || {};
  return LIFECYCLE_SCRIPTS.filter((name) => Boolean(scripts[name]));
}

function isMovingGitSpec(spec) {
  const text = String(spec || "");
  if (!/^(github:|git\+|git|:\/\/|.*\.git)/i.test(text) && !/github\.com/.test(text)) return false;
  if (/#[0-9a-f]{7,40}$/i.test(text)) return false;
  if (/#v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(text)) return false;
  return true;
}

function maintainerNames(input) {
  const list = input || [];
  return [...new Set(list.map((item) => (typeof item === "string" ? item : item.name || item.email || "")).filter(Boolean))].sort();
}

function pushChange(changes, type, detail) {
  changes.push({ type, ...detail });
}

function assertInstallGate({ requested = {}, packument, repoIdentity, previousReceipt, pluginManifest } = {}) {
  const reasons = [];
  const changes = [];
  const name = requested.name || packument?.name || pluginManifest?.name;
  const version = requested.version;
  const spec = requested.spec || (name && version ? `${name}@${version}` : requested.spec);

  if (!name) reasons.push("package name is required");
  if (!version || !isExactVersion(version)) {
    reasons.push("install requires a locked exact version (no tag, range, or latest)");
  }
  if (requested.tag || /^(latest|next|beta|canary|rc)$/i.test(String(version || ""))) {
    reasons.push("moving npm dist-tag is not allowed");
  }
  if (isMovingGitSpec(spec) || isMovingGitSpec(requested.sourceSpec)) {
    reasons.push("git/GitHub specs must pin a commit or exact version tag");
  }

  const manifest = pluginManifest || requested.manifest || versionDocument(packument, version) || {};
  if (isMarketplacePlugin({ ...manifest, name, requestedName: name })) {
    reasons.push("plugin-marketplace packages are not installed by this shell");
  }

  const doc = versionDocument(packument, version);
  if (version && packument && !doc) reasons.push(`packument has no version ${version}`);

  const packumentIntegrity = doc?.dist?.integrity || doc?.integrity || requested.packumentIntegrity;
  const requestedIntegrity = requested.integrity;
  if (!packumentIntegrity && !requestedIntegrity) {
    reasons.push("npm integrity (dist.integrity) is required");
  } else if (packumentIntegrity && !parseIntegrity(packumentIntegrity)) {
    reasons.push("packument integrity is not a valid SRI string");
  }
  if (requestedIntegrity && packumentIntegrity && !integrityEquals(requestedIntegrity, packumentIntegrity)) {
    reasons.push("requested integrity does not match packument dist.integrity");
  }
  const integrity = requestedIntegrity || packumentIntegrity;

  const lifecycle = hasLifecycleScripts(doc || manifest);
  if (lifecycle.length) {
    if (requested.ignoreScripts === true) {
      pushChange(changes, "lifecycle-scripts-ignored", { scripts: lifecycle });
    } else {
      reasons.push(`lifecycle scripts are not allowed: ${lifecycle.join(", ")}`);
    }
  }

  if (!repoIdentity || (repoIdentity.id == null && !repoIdentity.owner && !repoIdentity.name)) {
    reasons.push("repository identity is required");
  } else if (doc?.repository || packument?.repository) {
    const fromNpm = parseGithubRepo(doc?.repository || packument?.repository);
    if (fromNpm && !identitiesMatch(fromNpm, repoIdentity) && repoIdentity.id == null) {
      reasons.push("npm repository field does not match repoIdentity");
    } else if (fromNpm && repoIdentity.owner && repoIdentity.name) {
      const repoName = repoIdentity.name || repoIdentity.repo || "";
      const nameMatch = fromNpm.owner.toLowerCase() === String(repoIdentity.owner).toLowerCase()
        && fromNpm.name.toLowerCase() === String(repoName).toLowerCase();
      if (!nameMatch && repoIdentity.id == null) {
        reasons.push("npm repository owner/name does not match repoIdentity");
      }
      if (!nameMatch && repoIdentity.id != null) {
        pushChange(changes, "repository-mapping", {
          from: identityKey(fromNpm),
          to: identityKey(repoIdentity),
        });
      }
    }
    const npmDir = typeof (doc?.repository || packument?.repository) === "object"
      ? (doc?.repository || packument?.repository).directory
      : undefined;
    if ((npmDir || repoIdentity.directory) && String(npmDir || "") !== String(repoIdentity.directory || "")) {
      pushChange(changes, "repository-directory", {
        from: npmDir || null,
        to: repoIdentity.directory || null,
      });
    }
  }

  const deprecated = doc?.deprecated || packument?.deprecated;
  if (deprecated) {
    pushChange(changes, "deprecated", { message: String(deprecated) });
    reasons.push("deprecated package requires re-validation before install");
  }

  if (previousReceipt) {
    if (
      previousReceipt.integrity
      && integrity
      && !integrityEquals(previousReceipt.integrity, integrity)
      && previousReceipt.exactVersion === version
    ) {
      pushChange(changes, "integrity", {
        from: previousReceipt.integrity,
        to: integrity,
        exactVersion: version,
        previousVersion: previousReceipt.exactVersion,
      });
    }
    if (previousReceipt.repoIdentity && repoIdentity && !identitiesMatch(previousReceipt.repoIdentity, repoIdentity)) {
      pushChange(changes, "repo-transfer", {
        from: previousReceipt.repoIdentity,
        to: repoIdentity,
      });
    }
    const prevMaintainers = maintainerNames(previousReceipt.maintainers || previousReceipt.supplyChain?.maintainers);
    const nextMaintainers = maintainerNames(doc?.maintainers || packument?.maintainers);
    if (prevMaintainers.length && nextMaintainers.length && prevMaintainers.join() !== nextMaintainers.join()) {
      pushChange(changes, "npm-maintainers", { from: prevMaintainers, to: nextMaintainers });
    }
    if (previousReceipt.pluginId && name && previousReceipt.pluginId !== name && previousReceipt.packageName !== name) {
      pushChange(changes, "package-mapping", { from: previousReceipt.pluginId, to: name });
    }
    if (previousReceipt.source && requested.source && previousReceipt.source !== requested.source) {
      pushChange(changes, "source", { from: previousReceipt.source, to: requested.source });
    }
  }

  const blockingChangeTypes = new Set([
    "repo-transfer",
    "npm-maintainers",
    "deprecated",
    "package-mapping",
    "repository-mapping",
    "integrity",
  ]);
  const blockingChanges = changes.filter((item) => blockingChangeTypes.has(item.type));
  if (previousReceipt && blockingChanges.length) {
    reasons.push("supply-chain change requires re-validation before one-click install");
  }

  if (reasons.length) {
    throw new InstallGateError(reasons[0], { code: "INSTALL_GATE", reasons, changes });
  }

  return {
    ok: true,
    name,
    version,
    integrity,
    repoIdentity,
    source: requested.source || "npm",
    supplyChain: { changes },
    spec,
  };
}

module.exports = {
  assertInstallGate,
  hasLifecycleScripts,
  identitiesMatch,
  isMarketplacePlugin,
  parseGithubRepo,
  versionDocument,
};
