"use strict";

const { satisfies, sortVersionsDesc } = require("./semver");

/**
 * Official DSH (developer preview) has no stable Host/Renderer semver field.
 * Evidence: publish.md / plugin-anatomy — the only real manifest is package.json
 * `dsh` (`dsh.bundle.patch`, `dsh.client` + exports["./client"]).
 *
 * This adapter reads ranges from several observed / reserved locations without
 * binding the shell to one preview schema. First non-empty match wins per axis.
 */

function asRange(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    if (typeof value.range === "string") return value.range.trim();
    if (typeof value.version === "string") return value.version.trim();
    if (typeof value.compat === "string") return value.compat.trim();
  }
  return "";
}

function pickFirstRange(...candidates) {
  for (const candidate of candidates) {
    const range = asRange(candidate);
    if (range) return range;
  }
  return "";
}

function hasRendererSurface(manifest) {
  const dsh = manifest?.dsh || {};
  if (dsh.client) return true;
  if (dsh.compat?.renderer || dsh.engines?.renderer || dsh.renderer) return true;
  const exportsMap = manifest?.exports;
  if (exportsMap && typeof exportsMap === "object" && exportsMap["./client"]) return true;
  return false;
}

function readHostRange(manifest) {
  const dsh = manifest?.dsh || {};
  const engines = manifest?.engines || {};
  const peers = manifest?.peerDependencies || {};
  return pickFirstRange(
    dsh.compat?.host,
    dsh.engines?.host,
    typeof dsh.host === "string" ? dsh.host : dsh.host?.range,
    engines["dsh-host"],
    engines.dsh,
    peers["@deepseek-ai/dsh"],
    peers["@deepseek-ai/dsh-base"],
    peers["@deepseek-ai/dsh-settings"],
  );
}

function readRendererRange(manifest) {
  const dsh = manifest?.dsh || {};
  const engines = manifest?.engines || {};
  const peers = manifest?.peerDependencies || {};
  return pickFirstRange(
    dsh.compat?.renderer,
    dsh.engines?.renderer,
    typeof dsh.renderer === "string" ? dsh.renderer : dsh.renderer?.range,
    dsh.client?.compat,
    dsh.client?.engines,
    engines["dsh-renderer"],
    engines["dsh-web"],
    peers["@deepseek-ai/dsh-web-app"],
    peers["@deepseek-ai/dsh-host-frontend-static"],
  );
}

function axisVersion(dshInfo, axis) {
  if (!dshInfo) return "";
  if (axis === "host") {
    return asRange(dshInfo.host)
      || asRange(dshInfo.hostVersion)
      || asRange(dshInfo.packages?.["@deepseek-ai/dsh"])
      || asRange(dshInfo.packages?.["@deepseek-ai/dsh-base"])
      || asRange(dshInfo.version);
  }
  return asRange(dshInfo.renderer)
    || asRange(dshInfo.rendererVersion)
    || asRange(dshInfo.packages?.["@deepseek-ai/dsh-web-app"])
    || asRange(dshInfo.version);
}

function checkAxis({ name, range, version, required }) {
  if (!range) {
    if (required === false) {
      return { ok: true, skipped: true, axis: name, range: null, version: version || null };
    }
    return { ok: true, skipped: true, axis: name, range: null, version: version || null };
  }
  if (!version) {
    return {
      ok: false,
      axis: name,
      range,
      version: null,
      reason: `${name} version unknown; cannot satisfy ${range}`,
    };
  }
  const ok = satisfies(version, range);
  return {
    ok,
    axis: name,
    range,
    version,
    reason: ok ? null : `${name} ${version} does not satisfy ${range}`,
  };
}

function mergeRuntime(staticAxis, runtimeAxis) {
  if (!runtimeAxis) return staticAxis;
  if (runtimeAxis.ok === false) {
    return {
      ...staticAxis,
      ok: false,
      runtime: false,
      reason: runtimeAxis.reason || runtimeAxis.error || `${staticAxis.axis} runtime failed`,
    };
  }
  return { ...staticAxis, runtime: true };
}

function checkCompat({ pluginManifest, dshInfo, runtime } = {}) {
  const manifest = pluginManifest || {};
  const hostRange = readHostRange(manifest);
  const rendererRange = readRendererRange(manifest);
  const rendererRequired = hasRendererSurface(manifest) && Boolean(rendererRange);

  let host = checkAxis({
    name: "host",
    range: hostRange,
    version: axisVersion(dshInfo, "host"),
    required: Boolean(hostRange),
  });
  let renderer = checkAxis({
    name: "renderer",
    range: rendererRange,
    version: axisVersion(dshInfo, "renderer"),
    required: rendererRequired,
  });

  if (runtime?.host) host = mergeRuntime(host, runtime.host);
  if (runtime?.renderer) renderer = mergeRuntime(renderer, runtime.renderer);

  const reasons = [host.reason, renderer.reason].filter(Boolean);
  if (Array.isArray(runtime?.reasons)) reasons.push(...runtime.reasons.filter(Boolean));

  return {
    ok: host.ok && renderer.ok && runtime?.ok !== false,
    host,
    renderer,
    reasons,
    fields: {
      hostRange: hostRange || null,
      rendererRange: rendererRange || null,
      hasRendererSurface: hasRendererSurface(manifest),
    },
  };
}

function findCompatibleUpdate({ pluginId, availableVersions, dshInfo } = {}) {
  const list = Array.isArray(availableVersions) ? availableVersions : [];
  const sorted = sortVersionsDesc(list.map((item) => (
    typeof item === "string" ? { version: item, manifest: {} } : item
  )));
  for (const item of sorted) {
    const manifest = item.manifest || item.pluginManifest || {};
    const compat = checkCompat({ pluginManifest: manifest, dshInfo, runtime: item.runtime });
    if (compat.ok) {
      return {
        pluginId: pluginId || item.pluginId || manifest.name || null,
        version: item.version,
        manifest,
        compat,
      };
    }
  }
  return null;
}

module.exports = {
  checkCompat,
  findCompatibleUpdate,
  hasRendererSurface,
  readHostRange,
  readRendererRange,
};
