"use strict";

const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_UA = "dsh-tray-catalog/1.0 (+https://github.com/0xsline/awesome-deepseek-harness)";
const MAX_BACKOFF_MS = 60 * 1000;

function defaultNow() {
  return Date.now();
}

async function defaultFetchFn(url, init) {
  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable");
  }
  return fetch(url, init);
}

function cacheName(url) {
  return createHash("sha256").update(String(url)).digest("hex");
}

function headerGet(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase()) || "";
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

function ensureDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function createCachedFetcher({ cacheDir, fetchFn = defaultFetchFn, now = defaultNow, ttlMs = DEFAULT_TTL_MS, expireMs = DEFAULT_EXPIRE_MS, userAgent = DEFAULT_UA } = {}) {
  if (!cacheDir) throw new Error("createCachedFetcher requires cacheDir");

  const httpDir = join(cacheDir, "http");
  const backoffPath = join(cacheDir, "backoff.json");

  function cachePath(url) {
    return join(httpDir, `${cacheName(url)}.json`);
  }

  function readBackoff() {
    return readJson(backoffPath) || { hosts: {} };
  }

  function writeBackoff(state) {
    writeJson(backoffPath, state);
  }

  function backoffUntil(url) {
    const rec = readBackoff().hosts[hostOf(url)];
    return rec?.until || 0;
  }

  function noteBackoff(url, retryAfterMs) {
    const state = readBackoff();
    const host = hostOf(url);
    const prev = state.hosts[host] || { failures: 0, until: 0 };
    const failures = (prev.failures || 0) + 1;
    const delay = retryAfterMs || Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(failures, 6));
    state.hosts[host] = { failures, until: now() + delay };
    writeBackoff(state);
  }

  function noteSuccess(url) {
    const state = readBackoff();
    const host = hostOf(url);
    if (!state.hosts[host]) return;
    delete state.hosts[host];
    writeBackoff(state);
  }

  function decorate(record, { stale, error, fromCache, status }) {
    const checked = record?.lastCheckedAt || toIso(now());
    const success = record?.lastSuccessAt || null;
    const successMs = success ? Date.parse(success) : NaN;
    const expired = Number.isFinite(successMs) ? now() - successMs > expireMs : false;
    return {
      ok: Boolean(record?.body) && !error,
      status: status ?? record?.status ?? 0,
      body: record?.body ?? "",
      etag: record?.etag || "",
      fromCache: Boolean(fromCache),
      stale: Boolean(stale),
      expired: Boolean(expired),
      lastCheckedAt: checked,
      lastSuccessAt: success,
      error: error ? String(error.message || error) : "",
    };
  }

  async function get(url, options = {}) {
    const force = Boolean(options.force);
    const record = readJson(cachePath(url));
    const freshMs = options.ttlMs ?? ttlMs;
    // A failed check must not make old content look fresh. lastCheckedAt tracks
    // attempts; lastSuccessAt is the timestamp that owns cache freshness.
    const freshnessAt = record?.lastSuccessAt || record?.lastCheckedAt;
    const age = freshnessAt ? now() - Date.parse(freshnessAt) : Infinity;
    if (!force && record?.body && Number.isFinite(age) && age >= 0 && age < freshMs) {
      return decorate(record, { stale: false, fromCache: true, status: record.status });
    }

    if (!force && now() < backoffUntil(url) && record?.body) {
      const updated = { ...record, lastCheckedAt: toIso(now()) };
      writeJson(cachePath(url), updated);
      return decorate(updated, { stale: true, fromCache: true, status: record.status, error: "backoff" });
    }

    try {
      const headers = {
        "User-Agent": userAgent,
        Accept: "text/plain, text/markdown;q=0.9, */*;q=0.8",
        ...(options.headers || {}),
      };
      if (record?.etag && !force) headers["If-None-Match"] = record.etag;
      if (record?.lastModified && !force) headers["If-Modified-Since"] = record.lastModified;

      const response = await fetchFn(url, { headers, signal: options.signal });
      const status = Number(response?.status || 0);
      const retryAfter = Number(headerGet(response?.headers, "retry-after"));
      const retryMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;

      if (status === 304 && record?.body) {
        noteSuccess(url);
        const updated = {
          ...record,
          status: 200,
          lastCheckedAt: toIso(now()),
          lastSuccessAt: toIso(now()),
        };
        writeJson(cachePath(url), updated);
        return decorate(updated, { stale: false, fromCache: true, status: 304 });
      }

      if (status === 429 || status === 403) {
        noteBackoff(url, retryMs);
        if (record?.body) {
          const updated = { ...record, lastCheckedAt: toIso(now()) };
          writeJson(cachePath(url), updated);
          return decorate(updated, { stale: true, fromCache: true, status, error: `HTTP ${status}` });
        }
        return decorate(record, { stale: true, fromCache: false, status, error: `HTTP ${status}` });
      }

      if (status < 200 || status >= 300) {
        if (record?.body) {
          const updated = { ...record, lastCheckedAt: toIso(now()) };
          writeJson(cachePath(url), updated);
          return decorate(updated, { stale: true, fromCache: true, status, error: `HTTP ${status}` });
        }
        return decorate(null, { stale: true, fromCache: false, status, error: `HTTP ${status}` });
      }

      const body = typeof response.text === "function" ? await response.text() : String(response.body || "");
      noteSuccess(url);
      const saved = {
        url,
        status,
        body,
        etag: headerGet(response.headers, "etag"),
        lastModified: headerGet(response.headers, "last-modified"),
        lastCheckedAt: toIso(now()),
        lastSuccessAt: toIso(now()),
      };
      writeJson(cachePath(url), saved);
      return decorate(saved, { stale: false, fromCache: false, status });
    } catch (error) {
      if (record?.body) {
        const updated = { ...record, lastCheckedAt: toIso(now()) };
        writeJson(cachePath(url), updated);
        return decorate(updated, { stale: true, fromCache: true, status: record.status, error });
      }
      return decorate(null, { stale: true, fromCache: false, status: 0, error });
    }
  }

  async function getJson(url, options = {}) {
    const result = await get(url, options);
    if (!result.body) return { ...result, json: null };
    try {
      return { ...result, json: JSON.parse(result.body) };
    } catch (error) {
      return { ...result, json: null, error: result.error || String(error.message || error), stale: true };
    }
  }

  return {
    get,
    getJson,
    cachePath,
    ttlMs,
    expireMs,
  };
}

module.exports = {
  createCachedFetcher,
  DEFAULT_TTL_MS,
  DEFAULT_EXPIRE_MS,
};
