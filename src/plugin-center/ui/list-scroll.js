"use strict";

/**
 * Wheel → scrollTop mapping for the plugin list.
 * Each wheel event is applied once. No setTimeout / rAF momentum.
 * Trackpads already send decaying deltas; mouse wheels send discrete ticks.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.pluginCenterListScroll = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ROW_ESTIMATE = 112;
  const LIST_PAD = 8;

  function wheelDeltaY(event, { lineHeight = 16, pageHeight = 480 } = {}) {
    const y = Number(event && event.deltaY) || 0;
    if (event && event.deltaMode === 1) return y * lineHeight;
    if (event && event.deltaMode === 2) return y * pageHeight;
    return y;
  }

  function clampScrollTop(scrollTop, delta, maxScroll) {
    const next = Number(scrollTop) + Number(delta);
    const max = Math.max(0, Number(maxScroll) || 0);
    if (!Number.isFinite(next)) return 0;
    return Math.max(0, Math.min(max, next));
  }

  function shouldHandleWheel(event) {
    if (!event || event.ctrlKey) return false;
    const dy = Math.abs(Number(event.deltaY) || 0);
    const dx = Math.abs(Number(event.deltaX) || 0);
    return dy >= dx && dy !== 0;
  }

  function applyWheelScroll(state, event, viewport) {
    if (!shouldHandleWheel(event)) {
      return { scrollTop: state.scrollTop, maxScroll: state.maxScroll, applied: false };
    }
    const next = clampScrollTop(state.scrollTop, wheelDeltaY(event, viewport), state.maxScroll);
    return { scrollTop: next, maxScroll: state.maxScroll, applied: true };
  }

  function sizerHeight(itemCount) {
    return LIST_PAD * 2 + Math.max(0, itemCount) * ROW_ESTIMATE;
  }

  function windowOffset(start) {
    return Math.max(0, start) * ROW_ESTIMATE;
  }

  return {
    ROW_ESTIMATE,
    LIST_PAD,
    wheelDeltaY,
    clampScrollTop,
    shouldHandleWheel,
    applyWheelScroll,
    sizerHeight,
    windowOffset,
  };
});
