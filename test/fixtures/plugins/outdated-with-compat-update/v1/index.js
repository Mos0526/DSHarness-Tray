"use strict";

module.exports = {
  id: "fixture.outdated",
  kind: "outdated",
  version: "1.0.0",
  activate() {
    return { ok: false, reason: "incompatible with current DSH; try 2.0.0" };
  },
};
