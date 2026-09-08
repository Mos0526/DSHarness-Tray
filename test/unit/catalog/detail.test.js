"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { fetchDetailDescription, fetchRepositoryPackageIdentity } = require("../../../src/catalog/detail");

function fakeFetcher(map) {
  return {
    async get(url) {
      const body = map[url];
      return { body: body || "", status: body ? 200 : 404 };
    },
  };
}

test("fetchDetailDescription prefers Chinese README lead over English about", async () => {
  const detail = await fetchDetailDescription({
    description: "Keyboard-first command palette.",
    repo: { owner: "0xsline", repo: "dsh-spotlight" },
  }, {
    about: "Keyboard-first command palette for DeepSeek Harness Web",
    fileUrls: (owner, repo, file) => [`https://example.test/${owner}/${repo}/${file}`],
    fetcher: fakeFetcher({
      "https://example.test/0xsline/dsh-spotlight/README.zh-CN.md": "# 标题\n\n键盘优先的命令面板，用于快速跳转会话、插件与设置。也可搜索最近打开的项目。\n",
    }),
    translateFn: async () => {
      throw new Error("should not translate");
    },
  });
  assert.equal(detail.descriptionZh, true);
  assert.equal(detail.descriptionSource, "readme-zh");
  assert.match(detail.longDescription, /键盘优先/);
});

test("fetchDetailDescription translates English README via translateFn and caches", async () => {
  let translated = 0;
  const entry = {
    description: "A tiny helper.",
    repo: { owner: "example", repo: "tiny" },
  };
  const fetcher = fakeFetcher({
    "https://example.test/example/tiny/README.md": "# tiny\n\nA longer English introduction that explains what this plugin actually does for users.\n",
  });
  const opts = {
    fileUrls: (owner, repo, file) => [`https://example.test/${owner}/${repo}/${file}`],
    fetcher,
    translateFn: async (text) => {
      translated += 1;
      return `这是更详细的中文说明：${text}`;
    },
  };
  const first = await fetchDetailDescription(entry, opts);
  assert.equal(first.descriptionZh, true);
  assert.equal(first.descriptionSource, "translated");
  assert.match(first.longDescription, /更详细的中文说明/);
  assert.equal(translated, 1);

  const cached = await fetchDetailDescription({ ...entry, ...first }, opts);
  assert.equal(translated, 1);
  assert.equal(cached.longDescription, first.longDescription);
});

test("fetchDetailDescription reads README_CN.md and keeps only the 是什么 paragraph", async () => {
  const detail = await fetchDetailDescription({
    description: "OpenViking: The Context Database for AI Agents",
    repo: { owner: "volcengine", repo: "OpenViking" },
  }, {
    about: "OpenViking: The Context Database for AI Agents",
    fileUrls: (owner, repo, file) => [`https://example.test/${owner}/${repo}/${file}`],
    fetcher: fakeFetcher({
      "https://example.test/volcengine/OpenViking/README_CN.md": `
### OpenViking：AI 智能体的上下文数据库

[English](README.md) / 中文 / [日本語](README_JA.md)

官网 · 在线体验 · GitHub · 问题反馈 · 文档

## OpenViking 是什么

OpenViking 是面向 AI 智能体的开源上下文数据库。记忆、资源、技能统一存放在 \`viking://\` 协议下的虚拟文件系统里。

## 快速开始

pip install openviking
`,
    }),
    translateFn: async () => {
      throw new Error("should not translate");
    },
  });
  assert.equal(detail.descriptionZh, true);
  assert.equal(detail.descriptionSource, "readme-zh");
  assert.match(detail.longDescription, /面向 AI 智能体/);
  assert.equal(detail.longDescription.includes("The Context Database"), false);
  assert.equal(detail.longDescription.includes("pip install"), false);
  assert.equal(detail.longDescription.split(/\n{2,}/).length <= 2, true);
});

test("fetchDetailDescription keeps original and marks missing Chinese when translation fails", async () => {
  const detail = await fetchDetailDescription({
    description: "Rotating status phrases.",
  }, {
    translateFn: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(detail.descriptionZh, false);
  assert.equal(detail.missingZh, true);
  assert.match(detail.longDescription, /Rotating status phrases/);
  assert.match(detail.longDescription, /暂无中文说明/);
});

test("fetchDetailDescription corrects an inferred npm name from repository package.json", async () => {
  const detail = await fetchDetailDescription({
    npmName: "modlens",
    description: "Vision plugin",
    repo: { owner: "liustack", repo: "modlens" },
  }, {
    fileUrls: (owner, repo, file) => [`https://example.test/${owner}/${repo}/${file}`],
    fetcher: fakeFetcher({
      "https://example.test/liustack/modlens/package.json": JSON.stringify({
        name: "@liustack/modlens",
        version: "3.24.1",
      }),
    }),
    translateFn: async (text) => text,
  });
  assert.equal(detail.npmName, "@liustack/modlens");
  assert.equal(detail.packageVersion, "3.24.1");
});

test("fetchRepositoryPackageIdentity prefers a DSH plugin subdirectory over a missing root package", async () => {
  const identity = await fetchRepositoryPackageIdentity({
    repo: { owner: "tt-a1i", repo: "archify", host: "github.com" },
  }, {
    fileUrls: (owner, repo, file) => [`https://example.test/${owner}/${repo}/${file}`],
    fetcher: fakeFetcher({
      "https://example.test/tt-a1i/archify/integrations/deepseek-harness/package.json": JSON.stringify({
        name: "@tt-a1i/archify-dsh",
        version: "0.1.0",
        dsh: { bundle: { patch: "./cordis.patch.yml" } },
        repository: { url: "git+https://github.com/tt-a1i/archify.git" },
      }),
    }),
  });
  assert.equal(identity.npmName, "@tt-a1i/archify-dsh");
  assert.equal(identity.packageVersion, "0.1.0");
});
