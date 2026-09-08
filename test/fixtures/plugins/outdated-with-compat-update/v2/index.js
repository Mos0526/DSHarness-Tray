"use strict";

module.exports = {
  id: "fixture.outdated",
  kind: "compat-update",
  version: "2.0.0",
  activate() {
    return { ok: true, host: true, renderer: true };
  },
};
