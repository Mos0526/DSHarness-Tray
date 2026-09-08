"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildArgv,
  parseStdoutLine,
  classifyExit,
  buildEnv,
  createProtocol,
  DSH_HOME_ENV,
} = require("../../../src/adapters/dsh-protocol");

describe("dsh-protocol default argv", () => {
  it("matches the current tray web launch, not a frozen preview-only shape", () => {
    assert.deepEqual(buildArgv(), ["web", "--host", "127.0.0.1", "--port", "0", "--no-open"]);
  });

  it("can emit --profile web instead of the web alias", () => {
    assert.deepEqual(
      buildArgv({ profileStyle: "flag", port: 3080 }),
      ["--profile", "web", "--host", "127.0.0.1", "--port", "3080", "--no-open"],
    );
  });

  it("does not emit the removed dsh run command", () => {
    const argv = buildArgv({ command: "web" }).join(" ");
    assert.equal(argv.includes("run"), false);
  });
});

describe("dsh-protocol replaceable parser + argv builder", () => {
  it("lets a caller swap the entire CLI shape", () => {
    const protocol = createProtocol({
      buildArgv(options) {
        return ["--listen", `${options.host}:${options.port}`, "--quiet"];
      },
      parseStdoutLine(line) {
        if (String(line).startsWith("READY ")) {
          return { type: "ready", url: String(line).slice(6).trim() };
        }
        return { type: "log", raw: line };
      },
    });

    assert.deepEqual(
      protocol.buildArgv({ host: "127.0.0.1", port: 9 }),
      ["--listen", "127.0.0.1:9", "--quiet"],
    );
    assert.deepEqual(
      protocol.parseStdoutLine("READY http://127.0.0.1:9/"),
      { type: "ready", url: "http://127.0.0.1:9/" },
    );
    assert.notDeepEqual(protocol.buildArgv({ host: "127.0.0.1", port: 9 }), buildArgv({ host: "127.0.0.1", port: 9 }));
  });
});

describe("parseStdoutLine", () => {
  it("treats official dsh web: URL as ready", () => {
    const parsed = parseStdoutLine("dsh web: http://127.0.0.1:4123");
    assert.equal(parsed.type, "ready");
    assert.equal(parsed.url, "http://127.0.0.1:4123/");
  });

  it("does not treat the official browser-handoff line as ready", () => {
    const parsed = parseStdoutLine("dsh web: opening the default browser; pass --no-open to disable");
    assert.equal(parsed.type, "browser");
    assert.equal(parsed.url, undefined);
  });

  it("accepts a bare listen URL for future CLI wording", () => {
    const parsed = parseStdoutLine("listening on http://127.0.0.1:3080");
    assert.equal(parsed.type, "ready");
    assert.equal(parsed.url, "http://127.0.0.1:3080/");
  });
});

describe("classifyExit", () => {
  it("classifies supervisor SIGTERM as stopped", () => {
    assert.equal(classifyExit(0, "SIGTERM").kind, "stopped");
    assert.equal(classifyExit(1, "SIGKILL").kind, "stopped");
    assert.equal(classifyExit(130, null).kind, "stopped");
  });

  it("classifies unexpected nonzero and fatal signals as crash", () => {
    assert.equal(classifyExit(1, null).kind, "crash");
    assert.equal(classifyExit(null, "SIGABRT").kind, "crash");
    assert.equal(classifyExit(0, null).kind, "ok");
  });
});

describe("buildEnv", () => {
  it("injects DSH_HOME and wins over a inherited user-global value", () => {
    const env = buildEnv(
      { dshHome: "E:/shell/dsh/homes/safe", extraEnv: { DSH_HOME: "C:/Users/me/.dsh" } },
      { DSH_HOME: "C:/Users/me/.dsh", ELECTRON_RUN_AS_NODE: "1" },
    );
    assert.equal(env[DSH_HOME_ENV], "E:/shell/dsh/homes/safe");
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  });
});
