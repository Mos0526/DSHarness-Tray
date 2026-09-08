"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { redactDiagnosticText } = require("../../../src/runtime/redact");

describe("redactDiagnosticText", () => {
  it("redacts tokens, API keys, and home directories", () => {
    const raw = [
      "request failed at /?token=top-secret",
      "Authorization: Bearer abc.def",
      "DEEPSEEK_API_KEY=sk-thisisalongkeyvalue",
      "open C:\\Users\\alice\\.dsh\\profiles\\web",
      "home /Users/bob/.dsh",
    ].join("\n");
    const redacted = redactDiagnosticText(raw);
    assert.match(redacted, /token=\[redacted\]/);
    assert.match(redacted, /Authorization: Bearer \[redacted\]/);
    assert.match(redacted, /DEEPSEEK_API_KEY=\[redacted\]/);
    assert.match(redacted, /C:\\Users\\\[user\]\\.dsh/);
    assert.match(redacted, /\/Users\/\[user\]\/\.dsh/);
    assert.doesNotMatch(redacted, /top-secret/);
    assert.doesNotMatch(redacted, /alice|bob/);
    assert.doesNotMatch(redacted, /sk-thisisalongkeyvalue/);
  });
});
