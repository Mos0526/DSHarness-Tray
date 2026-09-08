"use strict";

const { existsSync } = require("node:fs");
const { join } = require("node:path");
const { encodePluginId, receiptsDir } = require("../homes/paths");
const { readJson, writeJsonAtomic } = require("../homes/io");
const { computeNpmIntegrity, integrityEquals, parseIntegrity } = require("./integrity");

const RECEIPT_FIELDS = [
  "exactVersion",
  "integrity",
  "repoIdentity",
  "source",
  "dshVersion",
  "hostCompat",
  "rendererCompat",
  "installedAt",
  "walId",
];

function receiptFile(target, pluginId) {
  if (target.endsWith(".json")) return target;
  if (pluginId) return join(target, `${encodePluginId(pluginId)}.json`);
  return join(target, "receipt.json");
}

function normalizeReceipt(input) {
  if (!input || typeof input !== "object") throw new Error("receipt is required");
  const receipt = {
    pluginId: input.pluginId || input.name || null,
    exactVersion: input.exactVersion || input.version || null,
    integrity: input.integrity || null,
    repoIdentity: input.repoIdentity || null,
    source: input.source || "npm",
    dshVersion: input.dshVersion || null,
    hostCompat: input.hostCompat ?? null,
    rendererCompat: input.rendererCompat ?? null,
    installedAt: input.installedAt || new Date().toISOString(),
    walId: input.walId || null,
    homeKind: input.homeKind || null,
    supplyChain: {
      changes: Array.isArray(input.supplyChain?.changes) ? input.supplyChain.changes : [],
    },
  };
  if (input.packageName) receipt.packageName = input.packageName;
  if (input.spec) receipt.spec = input.spec;
  return receipt;
}

function assertReceiptShape(receipt) {
  for (const field of RECEIPT_FIELDS) {
    if (receipt[field] === undefined) throw new Error(`receipt missing ${field}`);
  }
  if (!receipt.pluginId) throw new Error("receipt missing pluginId");
  if (!receipt.exactVersion) throw new Error("receipt missing exactVersion");
  if (!receipt.integrity) throw new Error("receipt missing integrity");
  return receipt;
}

function writeReceipt(target, receipt) {
  const normalized = assertReceiptShape(normalizeReceipt(receipt));
  const file = receiptFile(target, normalized.pluginId);
  writeJsonAtomic(file, normalized);
  return { ...normalized, path: file };
}

function readReceipt(target, pluginId) {
  const candidates = [];
  if (target.endsWith(".json")) candidates.push(target);
  else {
    if (pluginId) candidates.push(join(target, `${encodePluginId(pluginId)}.json`));
    candidates.push(join(target, "receipt.json"));
    if (pluginId) candidates.push(join(target, encodePluginId(pluginId), "receipt.json"));
  }
  for (const file of candidates) {
    if (existsSync(file)) return normalizeReceipt(readJson(file));
  }
  return null;
}

function ledgerReceiptPath(root, pluginId) {
  return join(receiptsDir(root), `${encodePluginId(pluginId)}.json`);
}

function writeLedgerReceipt(root, receipt) {
  return writeReceipt(ledgerReceiptPath(root, receipt.pluginId || receipt.name), receipt);
}

function readLedgerReceipt(root, pluginId) {
  return readReceipt(ledgerReceiptPath(root, pluginId));
}

function verifyReceiptIntegrity(receipt, artifact) {
  const current = receipt?.integrity;
  if (!current) return { ok: false, reason: "receipt missing integrity" };
  if (!parseIntegrity(current)) return { ok: false, reason: "receipt integrity is not an npm sri string" };

  if (artifact == null) return { ok: true, skipped: true, expected: current };

  if (typeof artifact === "string") {
    return {
      ok: integrityEquals(current, artifact),
      expected: current,
      actual: artifact,
      reason: integrityEquals(current, artifact) ? null : "integrity mismatch",
    };
  }

  if (artifact.integrity) {
    if (!integrityEquals(current, artifact.integrity)) {
      return {
        ok: false,
        expected: current,
        actual: artifact.integrity,
        reason: "integrity mismatch",
      };
    }
  }

  const buffer = Buffer.isBuffer(artifact) ? artifact : artifact.buffer || artifact.tarball;
  if (buffer) {
    const computed = computeNpmIntegrity(buffer);
    return {
      ok: integrityEquals(current, computed),
      expected: current,
      computed,
      reason: integrityEquals(current, computed) ? null : "integrity mismatch",
    };
  }

  return { ok: true, expected: current };
}

module.exports = {
  RECEIPT_FIELDS,
  ledgerReceiptPath,
  normalizeReceipt,
  readLedgerReceipt,
  readReceipt,
  verifyReceiptIntegrity,
  writeLedgerReceipt,
  writeReceipt,
};
