"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  wheelDeltaY,
  clampScrollTop,
  shouldHandleWheel,
  applyWheelScroll,
  sizerHeight,
  ROW_ESTIMATE,
} = require("../../../src/plugin-center/ui/list-scroll");

test("wheel delta maps line and page modes to pixels", () => {
  assert.equal(wheelDeltaY({ deltaY: 80, deltaMode: 0 }), 80);
  assert.equal(wheelDeltaY({ deltaY: 3, deltaMode: 1 }, { lineHeight: 16 }), 48);
  assert.equal(wheelDeltaY({ deltaY: 1, deltaMode: 2 }, { pageHeight: 400 }), 400);
});

test("applyWheelScroll moves once and does not invent momentum", () => {
  const first = applyWheelScroll(
    { scrollTop: 200, maxScroll: 4000 },
    { deltaY: 120, deltaMode: 0 },
  );
  assert.equal(first.applied, true);
  assert.equal(first.scrollTop, 320);

  const rest = applyWheelScroll(
    { scrollTop: first.scrollTop, maxScroll: 4000 },
    { deltaY: 0, deltaMode: 0 },
  );
  assert.equal(rest.applied, false);
  assert.equal(rest.scrollTop, 320);
  assert.equal(clampScrollTop(3900, 500, 4000), 4000);
  assert.equal(shouldHandleWheel({ deltaY: 10, deltaX: 40 }), false);
  assert.equal(shouldHandleWheel({ deltaY: 10, ctrlKey: true }), false);
});

test("virtual list sizer height is stable per item count", () => {
  assert.equal(sizerHeight(0) < ROW_ESTIMATE, true);
  assert.equal(sizerHeight(10), sizerHeight(10));
  assert.ok(sizerHeight(20) > sizerHeight(10));
});

test("list UI does not install fake timeout momentum", () => {
  const src = readFileSync(join(__dirname, "../../../src/plugin-center/ui/app.js"), "utf8");
  assert.equal(/setTimeout\s*\([^)]*momentum|velocity\s*\*=/.test(src), false);
  assert.match(src, /applyWheelScroll/);
  assert.match(src, /preventDefault/);
  assert.match(src, /plugin-intro/);
});
