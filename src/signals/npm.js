"use strict";

const { parseRepoIdentity, normalizeNpmName, isLikelyNpmName } = require("../identity/stable-id");
const { parseVersion, satisfies } = require("../install/semver");
const { readHostRange } = require("../install/compat");

/**
 * Evidence — npm packument GET https://registry.npmjs.org/{package}
 * (full document; do not send application/vnd.npm.install-v1+json or `time` is omitted):
 * {
 *   "name": "dsh-spotlight",
 *   "dist-tags": { "latest": "1.2.3" },
 *   "time": { "1.2.3": "2026-08-14T10:40:39.000Z", "modified": "..." },
 *   "versions": {
 *     "1.2.3": {
 *       "version": "1.2.3",
 *       "deprecated": "use other",          // omitted when not deprecated
 *       "dist": { "integrity": "sha512-...", "tarball": "https://registry.npmjs.org/dsh-spotlight/-/dsh-spotlight-1.2.3.tgz" },
 *       "repository": { "type": "git", "url": "git+https://github.com/0xsline/dsh-spotlight.git" }
 *     }
 *   },
 *   "repository": { "type": "git", "url": "git+https://github.com/0xsline/dsh-spotlight.git" }
 * }
 * Scoped packages: GET /%40scope%2Fname
 *
 * Downloads: GET https://api.npmjs.org/downloads/point/last-month/{package}
 * { "downloads": 313, "start": "2026-07-20", "end": "2026-08-18", "package": "dsh-spotlight" }
 */

const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const DEFAULT_DOWNLOADS = "https://api.npmjs.org/downloads/point/last-month";

function encodeNpmPath(name) {
  const npm = normalizeNpmName(name);
  return encodeURIComponent(npm).replace(/%2F/gi, "%2F");
}

function repoFromPackument(packument, versionDoc) {
  const raw = versionDoc?.repository?.url || versionDoc?.repository || packument?.repository?.url || packument?.repository;
  return parseRepoIdentity(typeof raw === "string" ? raw : raw?.url);
}

function versionDoc(packument, version) {
  return packument?.versions?.[version] || null;
}

function prereleaseChannel(version) {
  const parsed = parseVersion(version);
  if (!parsed?.pre) return "";
  const token = String(parsed.pre).split(".")[0].toLowerCase();
  if (token === "alpha" || token === "beta" || token === "rc") return token;
  return "";
}

function resolveTaggedVersion(packument, token) {
  const tags = packument?.["dist-tags"] || {};
  if (!token) return "";
  if (packument?.versions?.[token]) return token;
  const tagged = tags[token];
  return tagged && packument?.versions?.[tagged] ? tagged : "";
}

function hostRangeFits(manifest, hostVersion) {
  const range = readHostRange(manifest);
  if (!range) return true;
  return Boolean(hostVersion) && satisfies(hostVersion, range);
}

/**
 * Prefer the npm dist-tag that matches the running DSH prerelease channel.
 * Plugin authors publish breaking host adaptations as `alpha` / `rc` while
 * leaving `latest` on the last stable-compatible build.
 */
function pickNpmInstallVersion(packument, { version, hostVersion } = {}) {
  const tags = packument?.["dist-tags"] || {};
  const requested = resolveTaggedVersion(packument, version);
  if (version) return requested || version;
  const latest = resolveTaggedVersion(packument, tags.latest) || tags.latest || "";
  const channel = prereleaseChannel(hostVersion);
  const channelVersion = channel ? resolveTaggedVersion(packument, channel) : "";
  if (channelVersion && hostRangeFits(versionDoc(packument, channelVersion), hostVersion)) {
    return channelVersion;
  }
  return latest;
}

function emptyNpm(extra = {}) {
  return {
    npmName: extra.npmName || "",
    downloads: null,
    latestVersion: null,
    lastVersionAt: null,
    deprecated: false,
    deprecatedMessage: "",
    integrity: null,
    exactVersion: null,
    repoIdentity: null,
    stale: Boolean(extra.stale),
    expired: Boolean(extra.expired),
    lastCheckedAt: extra.lastCheckedAt || null,
    error: extra.error || "",
  };
}

function createNpmSignals({
  fetcher,
  registryUrl = DEFAULT_REGISTRY,
  downloadsUrl = DEFAULT_DOWNLOADS,
} = {}) {
  if (!fetcher?.getJson) throw new Error("createNpmSignals requires a cached fetcher");

  function packumentUrl(npmName) {
    return `${registryUrl.replace(/\/$/, "")}/${encodeNpmPath(npmName)}`;
  }

  function pointUrl(npmName) {
    return `${downloadsUrl.replace(/\/$/, "")}/${encodeNpmPath(npmName)}`;
  }

  async function fetchPackument(npmName, options = {}) {
    const name = normalizeNpmName(npmName);
    if (!isLikelyNpmName(name)) return { ...emptyNpm({ npmName: name, stale: true, error: "invalid npm name" }), packument: null };
    const result = await fetcher.getJson(packumentUrl(name), options);
    return { ...result, npmName: name, packument: result.json };
  }

  function pinFromPackument(packument, version, extra = {}) {
    const tags = packument?.["dist-tags"] || {};
    const latest = tags.latest || null;
    const picked = pickNpmInstallVersion(packument, {
      version,
      hostVersion: extra.hostVersion || "",
    }) || latest;
    const doc = picked ? versionDoc(packument, picked) : null;
    const deprecated = Boolean(doc?.deprecated) || Boolean(packument?.deprecated);
    return {
      exactVersion: picked,
      latestVersion: latest,
      installTag: picked && picked !== latest
        ? (prereleaseChannel(extra.hostVersion) || null)
        : (version && tags[version] ? version : null),
      lastVersionAt: packument?.time?.[picked] || packument?.time?.[latest] || packument?.time?.modified || null,
      deprecated,
      deprecatedMessage: typeof doc?.deprecated === "string" ? doc.deprecated : "",
      integrity: doc?.dist?.integrity || null,
      tarball: doc?.dist?.tarball || null,
      manifest: doc || null,
      repoIdentity: repoFromPackument(packument, doc),
    };
  }

  async function fetchDownloads(npmName, options = {}) {
    const name = normalizeNpmName(npmName);
    if (!isLikelyNpmName(name)) return { downloads: null, stale: true, expired: false, lastCheckedAt: null };
    const result = await fetcher.getJson(pointUrl(name), options);
    const downloads = Number.isFinite(result.json?.downloads) ? result.json.downloads : null;
    return {
      downloads,
      stale: Boolean(result.stale),
      expired: Boolean(result.expired),
      lastCheckedAt: result.lastCheckedAt || null,
      error: result.error || "",
    };
  }

  async function fetchNpmSignals(npmName, options = {}) {
    const name = normalizeNpmName(npmName);
    if (!isLikelyNpmName(name)) return emptyNpm({ npmName: name, stale: true, error: "invalid npm name" });
    const pack = await fetchPackument(name, options);
    const down = await fetchDownloads(name, options);
    if (!pack.packument) {
      return {
        ...emptyNpm({ ...pack, npmName: name }),
        downloads: down.downloads,
        stale: Boolean(pack.stale || down.stale),
        expired: Boolean(pack.expired || down.expired),
        lastCheckedAt: down.lastCheckedAt || pack.lastCheckedAt || null,
      };
    }
    const pin = pinFromPackument(pack.packument, options.version, { hostVersion: options.hostVersion });
    return {
      npmName: name,
      downloads: down.downloads,
      latestVersion: pin.latestVersion,
      lastVersionAt: pin.lastVersionAt,
      deprecated: pin.deprecated,
      deprecatedMessage: pin.deprecatedMessage,
      integrity: pin.integrity,
      tarball: pin.tarball,
      manifest: pin.manifest,
      exactVersion: pin.exactVersion,
      repoIdentity: pin.repoIdentity,
      stale: Boolean(pack.stale || down.stale),
      expired: Boolean(pack.expired || down.expired),
      lastCheckedAt: down.lastCheckedAt || pack.lastCheckedAt || null,
      error: pack.error || down.error || "",
    };
  }

  async function resolveInstallPin({ npmName, version } = {}, options = {}) {
    const name = normalizeNpmName(npmName);
    const pack = await fetchPackument(name, options);
    if (!pack.packument) {
      return {
        ...pinFromPackument(null, version, { hostVersion: options.hostVersion }),
        repoIdentity: null,
        tarball: null,
        manifest: null,
        stale: true,
        expired: Boolean(pack.expired),
        lastCheckedAt: pack.lastCheckedAt || null,
        error: pack.error || "npm packument unavailable",
      };
    }
    const signals = {
      ...pinFromPackument(pack.packument, version, { hostVersion: options.hostVersion }),
      stale: Boolean(pack.stale),
      expired: Boolean(pack.expired),
      lastCheckedAt: pack.lastCheckedAt || null,
      error: pack.error || "",
    };
    return {
      exactVersion: signals.exactVersion,
      latestVersion: signals.latestVersion,
      installTag: signals.installTag || null,
      integrity: signals.integrity,
      tarball: signals.tarball,
      manifest: signals.manifest,
      repoIdentity: signals.repoIdentity,
      deprecated: signals.deprecated,
      lastCheckedAt: signals.lastCheckedAt,
      stale: signals.stale,
      expired: signals.expired,
      error: signals.error,
    };
  }

  return {
    fetchPackument,
    fetchDownloads,
    fetchNpmSignals,
    resolveInstallPin,
    pinFromPackument,
    packumentUrl,
    pointUrl,
  };
}

module.exports = {
  createNpmSignals,
  encodeNpmPath,
  repoFromPackument,
  pickNpmInstallVersion,
  prereleaseChannel,
};
