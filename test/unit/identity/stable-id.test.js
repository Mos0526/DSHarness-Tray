"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseRepoIdentity,
  stableIdFrom,
  normalizeNpmName,
  sameRepoIdentity,
} = require("../../../src/identity/stable-id");

test("parseRepoIdentity understands https, git@, tree paths, and github: shorthand", () => {
  assert.deepEqual(parseRepoIdentity("https://github.com/0xsline/dsh-spotlight"), {
    host: "github.com",
    owner: "0xsline",
    repo: "dsh-spotlight",
    directory: null,
    url: "https://github.com/0xsline/dsh-spotlight",
    id: null,
  });
  assert.equal(parseRepoIdentity("git@github.com:0xsline/dsh-spotlight.git").repo, "dsh-spotlight");
  assert.equal(
    parseRepoIdentity("https://github.com/heartleo/hn-cli/tree/main/plugins/hacker-news").directory,
    "plugins/hacker-news",
  );
  assert.equal(parseRepoIdentity("github:ayahunter/dsh-trail").owner, "ayahunter");
  assert.equal(parseRepoIdentity("https://www.github.com/0xsline/dsh-spotlight.git").host, "github.com");
});

test("parseRepoIdentity ignores display-only or reserved GitHub URLs", () => {
  assert.equal(parseRepoIdentity("https://github.com/topics/dsh-plugin"), null);
  assert.equal(parseRepoIdentity("#core--bundles"), null);
  assert.equal(parseRepoIdentity(""), null);
});

test("stableIdFrom does not use a marketing display name as the primary key", () => {
  const fromTitle = stableIdFrom({
    npmName: "deepseek-harness-ultimate",
    repoUrl: "https://github.com/18126295767-cell/deepseek-harness-ultimate",
  });
  const fromRepo = stableIdFrom({
    npmName: "deepseek-harness-ultimate",
    repoUrl: "https://github.com/18126295767-cell/deepseek-harness-ultimate.git",
  });
  assert.equal(fromTitle, fromRepo);
  assert.ok(!fromTitle.includes("ultimate installer"));
  assert.match(fromTitle, /^npm:deepseek-harness-ultimate\|repo:github.com\/18126295767-cell\/deepseek-harness-ultimate$/);
});

test("stableIdFrom keeps monorepo directory and ignores source order", () => {
  const a = stableIdFrom({
    npmName: "dsh-hacker-news",
    repoUrl: "https://github.com/heartleo/hn-cli/tree/main/plugins/hacker-news",
    sources: ["awesome-dsh-plugin", "awesome-deepseek-harness"],
  });
  const b = stableIdFrom({
    npmName: "DSH-Hacker-News",
    repoUrl: "https://github.com/heartleo/hn-cli/tree/main/plugins/hacker-news",
    sources: ["awesome-deepseek-harness", "awesome-dsh-plugin"],
  });
  assert.equal(a, b);
  assert.match(a, /plugins\/hacker-news/);
});

test("normalizeNpmName and sameRepoIdentity", () => {
  assert.equal(normalizeNpmName(" npm:@Scope/Name "), "@scope/name");
  assert.equal(
    sameRepoIdentity(
      parseRepoIdentity("https://github.com/0xsline/dsh-spotlight"),
      { host: "github.com", owner: "0xsline", repo: "dsh-spotlight", directory: null, id: 1333136466 },
    ),
    true,
  );
});

test("isLikelyNpmName rejects CLI flags and traversal", () => {
  const { isLikelyNpmName } = require("../../../src/identity/stable-id");
  assert.equal(isLikelyNpmName("@liustack/modlens"), true);
  assert.equal(isLikelyNpmName("dsh-better-sidebar"), true);
  assert.equal(isLikelyNpmName("--help"), false);
  assert.equal(isLikelyNpmName("-rf"), false);
  assert.equal(isLikelyNpmName(".hidden"), false);
  assert.equal(isLikelyNpmName("../evil"), false);
});
