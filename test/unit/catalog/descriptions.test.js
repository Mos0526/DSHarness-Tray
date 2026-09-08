"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const {
  hasCjk,
  preferDescription,
  localizeDescription,
  parsePluginYml,
  pluginReadmeUrls,
  extractReadmeLead,
  looksLikeIntro,
} = require("../../../src/catalog/descriptions");

test("preferDescription keeps Chinese over a longer English string", () => {
  const chosen = preferDescription(
    "Keyboard-first command palette for the DSH Web UI.",
    "键盘优先的命令面板",
  );
  assert.equal(chosen, "键盘优先的命令面板");
  assert.equal(hasCjk(chosen), true);
});

test("localizeDescription uses the known-plugin map when catalogs are English-only", () => {
  const localized = localizeDescription({
    npmName: "dsh-spotlight",
    description: "Keyboard-first command palette for the DSH Web UI.",
  });
  assert.equal(localized.descriptionZh, true);
  assert.match(localized.description, /键盘/);
});

test("localizeDescription keeps English and marks missing Chinese", () => {
  const localized = localizeDescription({
    npmName: "unknown-plugin",
    description: "Rotating status phrases.",
  });
  assert.equal(localized.descriptionZh, false);
  assert.equal(localized.description, "Rotating status phrases.（暂无中文说明）");
});

test("parsePluginYml reads description.zh from site metadata", () => {
  const yml = readFileSync(join(__dirname, "fixtures", "plugin-spotlight.yml"), "utf8");
  const parsed = parsePluginYml(yml);
  assert.match(parsed.descriptionZh, /键盘优先/);
  assert.match(parsed.descriptionEn, /Keyboard-first/);
});

test("extractReadmeLead keeps the first paragraphs and skips badges", () => {
  const lead = extractReadmeLead(`
# dsh-spotlight

[![npm](https://img.shields.io/npm/v/dsh-spotlight)](https://www.npmjs.com/package/dsh-spotlight)

键盘优先的命令面板，用于在 DeepSeek Harness 里快速跳转会话、插件与设置。

也可搜索最近打开的项目，不必离开当前会话。

## Install

\`\`\`
npm i dsh-spotlight
\`\`\`

后面还有安装步骤和 API 说明，都不该进入简介。
`);
  assert.match(lead, /键盘优先/);
  assert.match(lead, /也可搜索/);
  assert.equal(lead.includes("npm i"), false);
  assert.equal(lead.includes("img.shields.io"), false);
  assert.equal(lead.includes("API"), false);
  assert.equal(lead.split(/\n{2,}/).length <= 2, true);
});

test("extractReadmeLead prefers 是什么 section and skips language / link chrome", () => {
  const lead = extractReadmeLead(`
### OpenViking: The Context Database for AI Agents

English / [中文](README_CN.md) / [日本語](README_JA.md)

 Website · Live Demo · GitHub · Issues · Docs 

[![stars](https://img.shields.io/github/stars/volcengine/OpenViking)](https://github.com/volcengine/OpenViking)

👋 加入我们的社区

## OpenViking 是什么

OpenViking 是面向 AI 智能体的开源上下文数据库。记忆、资源、技能统一存放在 \`viking://\` 协议下的虚拟文件系统里，智能体用 \`ls\`、\`tree\`、\`find\` 浏览自己的上下文。完整介绍见[入门文档](https://docs.openviking.ai/zh/getting-started/01-introduction)。

*[OpenViking Studio](https://openviking.ai/studio) 实验场——在线 Demo。*

## 为什么用 OpenViking

后面是安装和 API，不要出现在简介里。
`);
  assert.match(lead, /面向 AI 智能体/);
  assert.match(lead, /viking:\/\//);
  assert.equal(lead.includes("The Context Database"), false);
  assert.equal(lead.includes("English"), false);
  assert.equal(lead.includes("Website"), false);
  assert.equal(lead.includes("为什么"), false);
  assert.equal(lead.includes("安装"), false);
  assert.equal(looksLikeIntro(lead), true);
});

test("pluginReadmeUrls includes README_CN.md for Chinese READMEs", () => {
  const urls = pluginReadmeUrls({ owner: "volcengine", repo: "OpenViking" });
  assert.ok(urls.zh.some((url) => url.includes("README_CN.md")));
  assert.ok(urls.zh.some((url) => url.includes("README.zh-CN.md")));
});

test("looksLikeIntro rejects title plus language switcher chrome", () => {
  assert.equal(looksLikeIntro("OpenViking: The Context Database for AI Agents\n\nEnglish / 中文 / 日本語"), false);
  assert.equal(looksLikeIntro("OpenViking 是面向 AI 智能体的开源上下文数据库。记忆、资源、技能统一存放。"), true);
});
