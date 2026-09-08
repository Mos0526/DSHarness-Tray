"use strict";

module.exports = {
  id: "fixture.compatible",
  kind: "compatible",
  activate() {
    return { ok: true, host: true, renderer: true };
  },
};
