"use strict";

const BADGE_REASONS = Object.freeze(["updateAvailable", "quarantined", "verifyFailed"]);

const INSTALLED_LIKE = new Set([
  "active",
  "installed",
  "quarantined",
  "staging",
  "failed",
  "verifyFailed",
  "updateAvailable",
]);

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

function collectRecords({ plugins, lifecycle } = {}) {
  const records = [];
  for (const item of asList(plugins)) {
    if (item && typeof item === "object") records.push(item);
  }
  if (Array.isArray(lifecycle)) {
    for (const item of lifecycle) {
      if (item && typeof item === "object") records.push(item);
    }
    return records;
  }
  if (!lifecycle || typeof lifecycle !== "object") return records;
  for (const item of asList(lifecycle.items)) {
    if (item && typeof item === "object") records.push(item);
  }
  for (const item of asList(lifecycle.plugins)) {
    if (item && typeof item === "object") records.push(item);
  }
  for (const item of asList(lifecycle.byId)) {
    if (item && typeof item === "object") records.push(item);
  }
  for (const item of asList(lifecycle.quarantined)) {
    if (typeof item === "string") records.push({ id: item, state: "quarantined" });
    else if (item && typeof item === "object") records.push({ ...item, state: item.state || "quarantined" });
  }
  return records;
}

function isInstalledLike(item) {
  if (item.installed === true || item.quarantined === true) return true;
  const status = item.status || item.state;
  return INSTALLED_LIKE.has(status);
}

function reasonsFrom(item, into) {
  if (!item || typeof item !== "object") return;
  const status = item.status || item.state;
  if (item.updateAvailable === true || status === "updateAvailable") {
    into.add("updateAvailable");
  }
  if (item.quarantined === true || status === "quarantined") {
    into.add("quarantined");
  }
  const verifyFailed =
    item.verifyFailed === true ||
    status === "verifyFailed" ||
    item.verify?.ok === false;
  if (verifyFailed && isInstalledLike(item)) {
    into.add("verifyFailed");
  }
}

/**
 * Tray red-dot: only actionable shell states. Popularity (stars, downloads)
 * never contributes.
 *
 * @param {{ plugins?: object[], lifecycle?: object }} input
 * @returns {{ show: boolean, reasons: Array<"updateAvailable"|"quarantined"|"verifyFailed"> }}
 */
function computeBadge(input = {}) {
  const found = new Set();
  for (const item of collectRecords(input)) reasonsFrom(item, found);
  const reasons = BADGE_REASONS.filter((reason) => found.has(reason));
  return { show: reasons.length > 0, reasons };
}

module.exports = {
  BADGE_REASONS,
  computeBadge,
};
