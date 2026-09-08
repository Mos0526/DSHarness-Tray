"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  parseAwesomeMarkdown,
  parseCatalogJson,
  parseMetricsJson,
  applyDirectoryMetrics,
  mergeCatalogEntries,
  githubReadmeUrls,
  githubFileUrls,
  DEFAULT_LISTING_SOURCES,
  DEFAULT_METRIC_SOURCES,
  SOURCE_AWESOME_DEEPSEEK_HARNESS,
  SOURCE_AWESOME_DSH_PLUGIN,
} = require("../../../src/catalog/sources");

const fixtures = join(__dirname, "fixtures");

test("parseAwesomeMarkdown reads 0xsline README bullets and skips TOC/Related", () => {
  const md = readFileSync(join(fixtures, "awesome-deepseek-harness.readme.md"), "utf8");
  const entries = parseAwesomeMarkdown(md, SOURCE_AWESOME_DEEPSEEK_HARNESS);
  const names = entries.map((item) => item.npmName);
  assert.ok(names.includes("dsh-spotlight"));
  assert.ok(names.includes("deepseek-harness-ultimate"));
  assert.equal(entries.find((item) => item.npmName === "dsh-hacker-news").repo.directory, "plugins/hacker-news");
  assert.equal(entries.some((item) => /install|sponsors|awesome-dsh-plugin/.test(item.repoUrl)), false);
  assert.equal(entries.every((item) => item.sourceIds.includes(SOURCE_AWESOME_DEEPSEEK_HARNESS)), true);
});

test("parseAwesomeMarkdown reads awesome-dsh-plugin owner/repo lines and scoped npm from description", () => {
  const md = readFileSync(join(fixtures, "awesome-dsh-plugin.readme.md"), "utf8");
  const entries = parseAwesomeMarkdown(md, SOURCE_AWESOME_DSH_PLUGIN);
  assert.equal(entries.find((item) => item.npmName === "dsh-spotlight").name, "0xsline/dsh-spotlight");
  assert.equal(entries.find((item) => item.repo?.directory === "packages/bundle").npmName, "dsh-trail");
  assert.equal(entries.find((item) => item.npmName === "@ttmouse/dsh-taskboard").repo.repo, "dsh-taskboard");
});

test("parseAwesomeMarkdown reads CATALOG.md tables", () => {
  const md = readFileSync(join(fixtures, "catalog-table.md"), "utf8");
  const entries = parseAwesomeMarkdown(md, SOURCE_AWESOME_DEEPSEEK_HARNESS);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].npmName, "dsh-context-doctor");
});

test("parseCatalogJson accepts a snapshot array", () => {
  const entries = parseCatalogJson(
    JSON.stringify([{ name: "spot", npmName: "dsh-spotlight", repoUrl: "https://github.com/0xsline/dsh-spotlight" }]),
    SOURCE_AWESOME_DSH_PLUGIN,
  );
  assert.equal(entries[0].npmName, "dsh-spotlight");
});

test("parseAwesomeMarkdown reads the current live README heading/bullet shape", () => {
  const adh = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-deepseek-harness.live-head.md"), "utf8"),
    SOURCE_AWESOME_DEEPSEEK_HARNESS,
  );
  const adp = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-dsh-plugin.live-head.md"), "utf8"),
    SOURCE_AWESOME_DSH_PLUGIN,
  );
  assert.ok(adh.length >= 5);
  assert.ok(adh.some((item) => item.npmName === "dsh-spotlight"));
  assert.equal(adh.some((item) => /awesome-dsh-plugin/.test(item.repoUrl)), false);
  assert.ok(adp.length >= 3);
  assert.equal(adp.find((item) => item.npmName === "dsh-spotlight").name, "0xsline/dsh-spotlight");
  assert.equal(adp.find((item) => item.npmName === "@ttmouse/dsh-taskboard").repo.repo, "dsh-taskboard");
});

test("githubReadmeUrls prefers GitHub raw and falls back to jsDelivr", () => {
  const urls = githubReadmeUrls("0xsline", "awesome-deepseek-harness");
  assert.equal(urls[0], "https://raw.githubusercontent.com/0xsline/awesome-deepseek-harness/main/README.md");
  assert.equal(urls[1], "https://cdn.jsdelivr.net/gh/0xsline/awesome-deepseek-harness@main/README.md");
});

test("default listing sources include Chinese README and CATALOG.md", () => {
  const urls = DEFAULT_LISTING_SOURCES.flatMap((source) => source.urls);
  assert.ok(urls.some((url) => url.includes("README.zh-CN.md")));
  assert.ok(urls.some((url) => url.includes("CATALOG.md")));
  assert.equal(DEFAULT_METRIC_SOURCES.length, 2);
  assert.ok(DEFAULT_METRIC_SOURCES.every((source) => source.urls.some((url) => url.includes("raw.githubusercontent.com"))));
  assert.ok(DEFAULT_METRIC_SOURCES.every((source) => source.urls.some((url) => url.includes("cdn.jsdelivr.net/gh/"))));
});

test("githubFileUrls builds raw + jsDelivr for a nested path", () => {
  const urls = githubFileUrls("awesome-dsh-plugin", "awesome-dsh-plugin", "data/stars.json");
  assert.equal(urls[0], "https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/data/stars.json");
  assert.equal(urls[1], "https://cdn.jsdelivr.net/gh/awesome-dsh-plugin/awesome-dsh-plugin@main/data/stars.json");
});

test("parseMetricsJson + applyDirectoryMetrics merge URL-keyed stars", () => {
  const metrics = parseMetricsJson(readFileSync(join(fixtures, "stars.json"), "utf8"));
  const adh = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-deepseek-harness.readme.md"), "utf8"),
    SOURCE_AWESOME_DEEPSEEK_HARNESS,
  );
  const applied = applyDirectoryMetrics(adh, metrics);
  assert.equal(applied.find((item) => item.npmName === "dsh-spotlight").stars, 9);
});

test("mergeCatalogEntries prefers Chinese descriptions from zh README", () => {
  const en = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-deepseek-harness.readme.md"), "utf8"),
    SOURCE_AWESOME_DEEPSEEK_HARNESS,
  );
  const zh = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-deepseek-harness.zh.md"), "utf8"),
    SOURCE_AWESOME_DEEPSEEK_HARNESS,
  );
  const merged = mergeCatalogEntries([...en, ...zh]);
  const spotlight = merged.find((item) => item.npmName === "dsh-spotlight");
  assert.match(spotlight.description, /键盘/);
});

test("mergeCatalogEntries marks dual listing without inventing a safety score", () => {
  const adh = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-deepseek-harness.readme.md"), "utf8"),
    SOURCE_AWESOME_DEEPSEEK_HARNESS,
  );
  const adp = parseAwesomeMarkdown(
    readFileSync(join(fixtures, "awesome-dsh-plugin.readme.md"), "utf8"),
    SOURCE_AWESOME_DSH_PLUGIN,
  );
  const merged = mergeCatalogEntries([...adh, ...adp]);
  const spotlight = merged.find((item) => item.npmName === "dsh-spotlight");
  assert.equal(spotlight.inAwesomeDeepseekHarness, true);
  assert.equal(spotlight.inAwesomeDshPlugin, true);
  assert.equal(spotlight.sourceIds.length, 2);
  assert.equal("safetyScore" in spotlight, false);
  assert.ok(merged.some((item) => item.npmName === "dsh-status-rotator" && item.inAwesomeDshPlugin && !item.inAwesomeDeepseekHarness));
});
