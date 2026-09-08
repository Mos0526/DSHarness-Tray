"use strict";

function activate() {
  throw new Error("fixture host-incompatible: refuse to start host");
}

module.exports = {
  id: "fixture.host-incompatible",
  kind: "host-incompatible",
  activate,
};
