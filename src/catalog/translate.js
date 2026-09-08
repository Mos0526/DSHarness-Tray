"use strict";

const { hasCjk, stripZhMissing, ZH_MISSING_MARK } = require("./descriptions");

const DEFAULT_UA = "dsh-tray-catalog/1.0 (+https://github.com/0xsline/awesome-deepseek-harness)";
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_QUERY_CHARS = 450;

function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("translate timeout")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function defaultFetchFn(url, init) {
  if (typeof fetch !== "function") throw new Error("global fetch is unavailable");
  return fetch(url, init);
}

/**
 * Lightweight public endpoint (MyMemory). No SDK.
 * Inject translateFn in tests. Failures must never throw to callers.
 */
async function defaultMyMemoryTranslate(text, { fetchFn = defaultFetchFn, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const q = String(text || "").trim().slice(0, MAX_QUERY_CHARS);
  if (!q) return "";
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=en|zh-CN`;
  const response = await withTimeout(fetchFn(url, {
    headers: {
      "User-Agent": DEFAULT_UA,
      Accept: "application/json",
    },
  }), timeoutMs);
  const status = Number(response?.status || 0);
  if (status && (status < 200 || status >= 300)) throw new Error(`HTTP ${status}`);
  const body = typeof response?.text === "function" ? await response.text() : String(response?.body || "");
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error("translate parse error");
  }
  const translated = json?.responseData?.translatedText;
  if (typeof translated !== "string" || !translated.trim()) throw new Error("empty translation");
  return translated.trim();
}

function markMissingZh(text) {
  const raw = stripZhMissing(text);
  if (!raw) return ZH_MISSING_MARK;
  if (raw.includes(ZH_MISSING_MARK)) return raw;
  return `${raw}（${ZH_MISSING_MARK}）`;
}

/**
 * Translate English catalog/README text into Chinese.
 * @param {string} text
 * @param {{ translateFn?: Function, fetchFn?: Function, timeoutMs?: number }} [options]
 */
async function translateToZh(text, options = {}) {
  const raw = stripZhMissing(text);
  if (!raw) {
    return { text: ZH_MISSING_MARK, zh: false, translated: false, missingZh: true };
  }
  if (hasCjk(raw)) {
    return { text: raw, zh: true, translated: false, missingZh: false };
  }

  const translateFn = options.translateFn;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const out = translateFn
      ? await withTimeout(Promise.resolve(translateFn(raw, "zh")), timeoutMs)
      : await defaultMyMemoryTranslate(raw, { fetchFn: options.fetchFn, timeoutMs });
    const translated = stripZhMissing(out);
    if (hasCjk(translated)) {
      return { text: translated, zh: true, translated: true, missingZh: false };
    }
  } catch {
    /* keep original */
  }
  return { text: markMissingZh(raw), zh: false, translated: false, missingZh: true };
}

module.exports = {
  DEFAULT_UA,
  DEFAULT_TIMEOUT_MS,
  translateToZh,
  markMissingZh,
  defaultMyMemoryTranslate,
};
