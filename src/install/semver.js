"use strict";

function parseVersion(input) {
  const text = String(input || "").trim().replace(/^v/i, "");
  const match = text.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] || "",
    raw: text,
  };
}

function isExactVersion(input) {
  return Boolean(parseVersion(input));
}

function compareVersions(left, right) {
  const a = typeof left === "object" && left ? left : parseVersion(left);
  const b = typeof right === "object" && right ? right : parseVersion(right);
  if (!a || !b) return NaN;
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.pre && b.pre) return 1;
  if (a.pre && !b.pre) return -1;
  if (a.pre === b.pre) return 0;
  const as = a.pre.split(".");
  const bs = b.pre.split(".");
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i += 1) {
    if (as[i] === undefined) return -1;
    if (bs[i] === undefined) return 1;
    const an = /^\d+$/.test(as[i]) ? Number(as[i]) : NaN;
    const bn = /^\d+$/.test(bs[i]) ? Number(bs[i]) : NaN;
    if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
    if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  }
  return 0;
}

function caretUpper(parsed) {
  if (parsed.major > 0) return { major: parsed.major + 1, minor: 0, patch: 0, pre: "" };
  if (parsed.minor > 0) return { major: 0, minor: parsed.minor + 1, patch: 0, pre: "" };
  return { major: 0, minor: 0, patch: parsed.patch + 1, pre: "" };
}

function tildeUpper(parsed) {
  return { major: parsed.major, minor: parsed.minor + 1, patch: 0, pre: "" };
}

function expandXRange(token) {
  const text = String(token || "").trim().replace(/^v/i, "");
  const x = text.match(/^(\d+)(?:\.([xX*]|\d+))?(?:\.([xX*]|\d+))?$/);
  if (!x) return null;
  const major = Number(x[1]);
  const minorX = x[2] === undefined || /^[xX*]$/.test(x[2]);
  const patchX = x[3] === undefined || /^[xX*]$/.test(x[3]);
  if (minorX) {
    return {
      ge: { major, minor: 0, patch: 0, pre: "" },
      lt: { major: major + 1, minor: 0, patch: 0, pre: "" },
    };
  }
  const minor = Number(x[2]);
  if (patchX) {
    return {
      ge: { major, minor, patch: 0, pre: "" },
      lt: { major, minor: minor + 1, patch: 0, pre: "" },
    };
  }
  return null;
}

function parseComparator(token) {
  const text = String(token || "").trim();
  if (!text || text === "*" || text === "x" || text === "X") {
    return { ge: { major: 0, minor: 0, patch: 0, pre: "" } };
  }
  const op = text.match(/^(>=|<=|>|<|=|\^|~)?\s*(.+)$/);
  if (!op) return null;
  const operator = op[1] || "=";
  const rest = op[2];
  const xRange = expandXRange(rest);
  if (xRange && (operator === "=" || operator === "^" || operator === "~")) return xRange;
  const parsed = parseVersion(rest);
  if (!parsed) return null;
  if (operator === "^") return { ge: parsed, lt: caretUpper(parsed) };
  if (operator === "~") return { ge: parsed, lt: tildeUpper(parsed) };
  if (operator === ">=") return { ge: parsed };
  if (operator === ">") return { gt: parsed };
  if (operator === "<=") return { le: parsed };
  if (operator === "<") return { lt: parsed };
  return { ge: parsed, le: parsed };
}

function matchesComparator(version, comparator) {
  if (comparator.ge && compareVersions(version, comparator.ge) < 0) return false;
  if (comparator.gt && compareVersions(version, comparator.gt) <= 0) return false;
  if (comparator.le && compareVersions(version, comparator.le) > 0) return false;
  if (comparator.lt && compareVersions(version, comparator.lt) >= 0) return false;
  return true;
}

function satisfies(version, range) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const text = String(range || "").trim();
  if (!text || text === "*" || text === "x") return true;
  const unions = text.split(/\s*\|\|\s*/);
  return unions.some((union) => {
    const parts = union.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return false;
    return parts.every((part) => {
      const comparator = parseComparator(part);
      return Boolean(comparator && matchesComparator(parsed, comparator));
    });
  });
}

function sortVersionsDesc(versions) {
  return [...versions].sort((a, b) => {
    const av = typeof a === "string" ? a : a.version;
    const bv = typeof b === "string" ? b : b.version;
    const cmp = compareVersions(bv, av);
    return Number.isNaN(cmp) ? String(bv).localeCompare(String(av)) : cmp;
  });
}

module.exports = {
  parseVersion,
  isExactVersion,
  compareVersions,
  satisfies,
  sortVersionsDesc,
};
