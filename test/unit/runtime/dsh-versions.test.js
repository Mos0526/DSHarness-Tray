"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeVersion,
  pickDshCandidates,
  parseAtomEntries,
  matchAtomEntry,
  dshInstallSpec,
  summarizeDshUpdate,
} = require("../../../src/runtime/dsh-versions");
const { isNewerVersion } = require("../../../src/install/updates");

describe("dsh version candidates", () => {
  it("picks a newer GitHub prerelease when it is already on npm", () => {
    const candidates = pickDshCandidates({
      versions: ["0.1.1-rc.1", "0.1.1-rc.2", "0.1.2-alpha.1"],
      tags: { latest: "0.1.1-rc.2", next: "0.1.1-rc.2" },
      githubVersion: "0.1.2-alpha.1",
    });
    assert.equal(candidates[0], "0.1.2-alpha.1");
    assert.equal(isNewerVersion(candidates[0], "0.1.1-rc.2"), true);
  });

  it("ignores a GitHub prerelease until npm has published it", () => {
    const candidates = pickDshCandidates({
      versions: ["0.1.1-rc.1", "0.1.1-rc.2"],
      tags: { latest: "0.1.1-rc.2" },
      githubVersion: "0.1.2-alpha.1",
    });
    assert.equal(candidates[0], "0.1.1-rc.2");
    assert.equal(candidates.includes("0.1.2-alpha.1"), false);
    assert.equal(dshInstallSpec("v0.1.2-alpha.1"), "@deepseek-ai/dsh@0.1.2-alpha.1");
  });
});

describe("manual update check summary", () => {
  it("offers an npm-published newer version", () => {
    const summary = summarizeDshUpdate({
      installed: "0.1.1-rc.2",
      candidates: ["0.1.2-alpha.1", "0.1.1-rc.2"],
      githubVersion: "0.1.2-alpha.1",
    });
    assert.equal(summary.updateAvailable, true);
    assert.equal(summary.latestPublished, "0.1.2-alpha.1");
    assert.equal(summary.githubUnpublished, false);
  });

  it("does not offer a GitHub-only version as installable", () => {
    const summary = summarizeDshUpdate({
      installed: "0.1.1-rc.2",
      candidates: ["0.1.1-rc.2"],
      githubVersion: "0.1.2-alpha.1",
    });
    assert.equal(summary.updateAvailable, false);
    assert.equal(summary.githubUnpublished, true);
    assert.equal(summary.githubVersion, "0.1.2-alpha.1");
  });

  it("treats matching npm and GitHub versions as already latest", () => {
    const summary = summarizeDshUpdate({
      installed: "0.1.1-rc.2",
      candidates: ["0.1.1-rc.2"],
      githubVersion: "0.1.1-rc.2",
    });
    assert.equal(summary.updateAvailable, false);
    assert.equal(summary.githubUnpublished, false);
  });
});

describe("GitHub release notes matching", () => {
  it("matches the installed version by title, not a mention in newer notes", () => {
    const entries = parseAtomEntries(`
      <feed>
        <entry><title>v0.1.2-alpha.1</title><updated>2026-08-28T00:00:00Z</updated><content>fixes from 0.1.1-rc.2</content></entry>
        <entry><title>v0.1.1-rc.2</title><updated>2026-08-21T00:00:00Z</updated><content>current notes</content></entry>
      </feed>
    `);
    assert.equal(normalizeVersion("dsh-v0.1.1-rc.2"), "0.1.1-rc.2");
    assert.equal(matchAtomEntry(entries, "0.1.1-rc.2").title, "v0.1.1-rc.2");
    assert.equal(matchAtomEntry(entries, "0.1.1-rc.2").content, "current notes");
  });
});
