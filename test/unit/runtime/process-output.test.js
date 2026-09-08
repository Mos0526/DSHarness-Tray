"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { decodeProcessOutput } = require("../../../src/runtime/process-output");

describe("decodeProcessOutput", () => {
  it("keeps valid UTF-8", () => {
    assert.equal(decodeProcessOutput(Buffer.from("安装失败", "utf8")), "安装失败");
    assert.equal(decodeProcessOutput("already a string"), "already a string");
  });

  it("decodes Windows GBK pnpm errors instead of replacement diamonds", () => {
    const gbk = Buffer.from("CAA7B0DC", "hex"); // 失败
    assert.equal(decodeProcessOutput(gbk), "失败");
  });
});
