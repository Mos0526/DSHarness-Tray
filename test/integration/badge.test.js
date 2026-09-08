"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeBadge } = require("../../src/tray-plugin/badge");

describe("computeBadge", () => {
  it("hides the dot when nothing needs attention", () => {
    const badge = computeBadge({
      plugins: [{ id: "a", state: "active", stars: 2 }],
      lifecycle: { items: [{ id: "a", state: "installed" }] },
    });
    assert.deepEqual(badge, { show: false, reasons: [] });
  });

  it("shows updateAvailable without expanding details", () => {
    const badge = computeBadge({
      plugins: [{ id: "a", updateAvailable: true, stars: 1 }],
    });
    assert.equal(badge.show, true);
    assert.deepEqual(badge.reasons, ["updateAvailable"]);
  });

  it("shows quarantined from lifecycle list", () => {
    const badge = computeBadge({
      lifecycle: { quarantined: ["crashy"] },
    });
    assert.equal(badge.show, true);
    assert.deepEqual(badge.reasons, ["quarantined"]);
  });

  it("shows verifyFailed only for installed-like plugins", () => {
    const hidden = computeBadge({
      plugins: [{ id: "catalog-only", verify: { ok: false }, state: "available" }],
    });
    assert.equal(hidden.show, false);

    const shown = computeBadge({
      plugins: [{ id: "in", installed: true, verify: { ok: false } }],
    });
    assert.deepEqual(shown.reasons, ["verifyFailed"]);
  });

  it("collects multiple reasons in a stable order", () => {
    const badge = computeBadge({
      lifecycle: {
        items: [
          { id: "a", state: "quarantined" },
          { id: "b", updateAvailable: true, installed: true },
          { id: "c", verifyFailed: true, state: "failed" },
        ],
      },
    });
    assert.deepEqual(badge.reasons, ["updateAvailable", "quarantined", "verifyFailed"]);
    assert.equal(badge.show, true);
  });

  it("does not badge on low stars or missing downloads", () => {
    const badge = computeBadge({
      plugins: [{ id: "a", stars: 0, npmDownloads: 0, state: "available" }],
    });
    assert.equal(badge.show, false);
  });
});
