"use strict";

const { spawnSync } = require("node:child_process");
const { globSync } = require("node:fs");

const files = globSync("test/{unit,integration}/**/*.test.js", { windowsPathsNoEscape: true });
if (!files.length) {
  console.error("No test files found under test/unit or test/integration.");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
