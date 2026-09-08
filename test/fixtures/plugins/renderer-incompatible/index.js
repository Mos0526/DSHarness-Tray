"use strict";

module.exports = {
  id: "fixture.renderer-incompatible",
  kind: "renderer-incompatible",
  activate() {
    return { ok: true, host: true, renderer: false, reason: "renderer settle failed" };
  },
};
