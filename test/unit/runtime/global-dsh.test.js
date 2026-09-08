"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildGlobalInstallArgs,
  globalDshEntry,
  privateDshEntry,
  resolveDshEntry,
} = require("../../../src/runtime/global-dsh");

describe("global DSH thin-shell contract", () => {
  it("uses the same global DSH as the terminal when system Node is available", () => {
    const expected = globalDshEntry("C:\\Users\\demo\\AppData\\Roaming");
    assert.match(expected, /npm[\\/]node_modules[\\/]@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js$/);
    assert.equal(resolveDshEntry({
      isolated: false,
      appData: "C:\\Users\\demo\\AppData\\Roaming",
      existsFn: (file) => file === expected,
    }), expected);
  });

  it("keeps bundled Node fallback global only inside its private npm prefix", () => {
    const expected = privateDshEntry("C:\\AppData\\dsh-tray\\npm-prefix");
    assert.equal(resolveDshEntry({
      isolated: true,
      prefix: "C:\\AppData\\dsh-tray\\npm-prefix",
      existsFn: (file) => file === expected,
    }), expected);
  });

  it("updates DSH with npm install -g and never a staging prefix", () => {
    const args = buildGlobalInstallArgs(
      "npm-cli.js",
      "@deepseek-ai/dsh@0.1.1-rc.2",
      ["--no-audit"],
    );
    assert.deepEqual(args, [
      "npm-cli.js",
      "install",
      "-g",
      "@deepseek-ai/dsh@0.1.1-rc.2",
      "--no-audit",
    ]);
    assert.equal(args.includes("--prefix"), false);
  });
});
