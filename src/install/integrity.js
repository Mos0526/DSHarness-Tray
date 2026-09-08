"use strict";

const { createHash } = require("node:crypto");

function normalizeIntegrity(value) {
  const text = String(value || "").trim();
  return text || "";
}

function parseIntegrity(value) {
  const text = normalizeIntegrity(value);
  const match = text.match(/^(sha512|sha256|sha1)-([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { algo: match[1], digest: match[2], raw: text };
}

function computeIntegrity(buffer, algo = "sha512") {
  const hash = createHash(algo).update(buffer).digest("base64");
  return `${algo}-${hash}`;
}

function computeNpmIntegrity(buffer) {
  return computeIntegrity(buffer, "sha512");
}

function integrityEquals(left, right) {
  const a = normalizeIntegrity(left);
  const b = normalizeIntegrity(right);
  return Boolean(a && b && a === b);
}

module.exports = {
  normalizeIntegrity,
  parseIntegrity,
  computeIntegrity,
  computeNpmIntegrity,
  integrityEquals,
};
