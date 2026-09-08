"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { translateToZh } = require("../../../src/catalog/translate");

test("translateToZh keeps Chinese and does not call translateFn", async () => {
  let called = 0;
  const result = await translateToZh("键盘优先的命令面板", {
    translateFn: async () => {
      called += 1;
      return "nope";
    },
  });
  assert.equal(result.zh, true);
  assert.equal(result.translated, false);
  assert.equal(called, 0);
  assert.match(result.text, /键盘/);
});

test("translateToZh uses injected translateFn for English", async () => {
  const result = await translateToZh("Keyboard-first command palette.", {
    translateFn: async (text) => `中文：${text}`,
  });
  assert.equal(result.zh, true);
  assert.equal(result.translated, true);
  assert.match(result.text, /中文/);
});

test("translateToZh keeps original and marks missing Chinese when translateFn fails", async () => {
  const result = await translateToZh("Rotating status phrases.", {
    translateFn: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(result.zh, false);
  assert.equal(result.missingZh, true);
  assert.match(result.text, /Rotating status phrases/);
  assert.match(result.text, /暂无中文说明/);
});
