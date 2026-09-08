"use strict";

const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

function tempCacheDir() {
  return mkdtempSync(join(tmpdir(), "dsh-catalog-"));
}

function removeDir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function mockResponse({ status = 200, body = "", headers = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((item) => item.toLowerCase() === String(name).toLowerCase());
        return key ? headers[key] : "";
      },
    },
    text: async () => body,
    json: async () => JSON.parse(body || "null"),
  };
}

function mockFetch(handler) {
  return async (url, init) => handler(String(url), init || {});
}

function clock(start = Date.parse("2026-08-24T00:00:00.000Z")) {
  let now = start;
  return {
    now: () => now,
    advance(ms) {
      now += ms;
      return now;
    },
  };
}

module.exports = {
  tempCacheDir,
  removeDir,
  mockResponse,
  mockFetch,
  clock,
};
