"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { join } = require("node:path");
const {
  PNPM_SPEC,
  pnpmCandidatePaths,
  pnpmSearchDirs,
  pnpmShimNames,
  resolvePnpm,
  withPnpmOnPath,
} = require("../../../src/runtime/pnpm");

describe("pnpm resolution", () => {
  it("prefers Windows cmd and exe shims", () => {
    assert.deepEqual(pnpmShimNames("win32"), ["pnpm.cmd", "pnpm.exe", "pnpm"]);
    assert.deepEqual(pnpmShimNames("linux"), ["pnpm"]);
  });

  it("searches PATH, Node dir, npm global, private prefix, then standalone installer", () => {
    const dirs = pnpmSearchDirs({
      pathEnv: "C:\\tools;C:\\other",
      pathDelimiter: ";",
      nodeDir: "C:\\Program Files\\nodejs",
      appData: "C:\\Users\\demo\\AppData\\Roaming",
      prefix: "C:\\AppData\\dsh-tray\\npm-prefix",
      localAppData: "C:\\Users\\demo\\AppData\\Local",
    });
    assert.deepEqual(dirs, [
      "C:\\tools",
      "C:\\other",
      "C:\\Program Files\\nodejs",
      join("C:\\Users\\demo\\AppData\\Roaming", "npm"),
      "C:\\AppData\\dsh-tray\\npm-prefix",
      join("C:\\Users\\demo\\AppData\\Local", "pnpm"),
    ]);
  });

  it("resolves the first existing candidate in that order", () => {
    const standalone = join("C:\\Users\\demo\\AppData\\Local", "pnpm", "pnpm.exe");
    const globalCmd = join("C:\\Users\\demo\\AppData\\Roaming", "npm", "pnpm.cmd");
    const hit = resolvePnpm({
      platform: "win32",
      pathDelimiter: ";",
      appData: "C:\\Users\\demo\\AppData\\Roaming",
      localAppData: "C:\\Users\\demo\\AppData\\Local",
      existsFn: (file) => file === standalone || file === globalCmd,
    });
    assert.equal(hit, globalCmd);
    assert.ok(pnpmCandidatePaths({
      platform: "win32",
      pathDelimiter: ";",
      appData: "C:\\Users\\demo\\AppData\\Roaming",
      localAppData: "C:\\Users\\demo\\AppData\\Local",
    }).includes(standalone));
  });

  it("puts the pnpm directory first on PATH so cmd can see the .cmd shim", () => {
    const next = withPnpmOnPath(
      { PATH: "C:\\Windows;C:\\Windows\\System32" },
      "C:\\Users\\demo\\AppData\\Roaming\\npm\\pnpm.cmd",
      { pathDelimiter: ";" },
    );
    assert.match(next.PATH, /^C:\\Users\\demo\\AppData\\Roaming\\npm;/);
    assert.equal(next.Path, next.PATH);
    assert.equal(PNPM_SPEC, "pnpm");
  });

  it("does not duplicate a directory already on PATH", () => {
    const next = withPnpmOnPath(
      { Path: "C:\\Users\\demo\\AppData\\Roaming\\npm;C:\\Windows" },
      "C:\\Users\\demo\\AppData\\Roaming\\npm\\pnpm.cmd",
      { pathDelimiter: ";" },
    );
    assert.equal(next.PATH, "C:\\Users\\demo\\AppData\\Roaming\\npm;C:\\Windows");
  });
});
