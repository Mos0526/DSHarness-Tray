"use strict";

const CJK = /[\u3400-\u9fff]/;
const ZH_MISSING_MARK = "暂无中文说明";

/**
 * Lightweight offline map for fixtures / well-known plugins.
 * Catalog Chinese (README.zh-CN / CATALOG.md / yml zh) always wins over this.
 */
const KNOWN_ZH = Object.freeze({
  "dsh-spotlight": "键盘优先的命令面板，快速跳转会话、插件与设置。",
  "dsh-status-rotator": "循环展示状态短语。",
  "dsh-trail": "轨迹标签页替代。",
  "@ttmouse/dsh-taskboard": "本地优先的议题看板。",
  "dsh-taskboard": "本地优先的议题看板。",
  "dsh-hacker-news": "Hacker News 实时资讯、帖子线程与搜索。",
  "deepseek-harness-ultimate": "社区维护的可复现 profile 安装器。",
});

function hasCjk(text) {
  return CJK.test(String(text || ""));
}

function stripZhMissing(text) {
  return String(text || "").replace(/\s*（暂无中文说明）\s*$/u, "").trim();
}

function lookupKnownZh(entry) {
  const npm = String(entry?.npmName || "").toLowerCase();
  if (npm && KNOWN_ZH[npm]) return KNOWN_ZH[npm];
  const repo = String(entry?.repo?.repo || "").toLowerCase();
  if (repo && KNOWN_ZH[repo]) return KNOWN_ZH[repo];
  const name = String(entry?.name || entry?.displayName || "").toLowerCase();
  if (name && KNOWN_ZH[name]) return KNOWN_ZH[name];
  return "";
}

function preferDescription(current, incoming) {
  const a = stripZhMissing(current);
  const b = stripZhMissing(incoming);
  if (!a) return b;
  if (!b) return a;
  const aZh = hasCjk(a);
  const bZh = hasCjk(b);
  if (aZh !== bZh) return bZh ? b : a;
  return b.length >= a.length ? b : a;
}

function localizeDescription(entry) {
  const raw = stripZhMissing(entry?.description);
  if (hasCjk(raw)) return { description: raw, descriptionZh: true };
  const known = lookupKnownZh(entry);
  if (known) return { description: known, descriptionZh: true };
  if (!raw) return { description: ZH_MISSING_MARK, descriptionZh: false };
  return { description: `${raw}（${ZH_MISSING_MARK}）`, descriptionZh: false };
}

function quotedOrBare(match) {
  if (!match) return "";
  return String(match[1] || match[2] || match[3] || "").trim();
}

function parsePluginYml(yml) {
  const text = String(yml || "");
  const zh = quotedOrBare(text.match(/(?:^|\n)[ \t]*zh:[ \t]*(?:"([^"]*)"|'([^']*)'|(\S[^\n]*))/));
  const en = quotedOrBare(text.match(/(?:^|\n)[ \t]*en:[ \t]*(?:"([^"]*)"|'([^']*)'|(\S[^\n]*))/));
  const url = quotedOrBare(text.match(/(?:^|\n)url:[ \t]*(\S+)/));
  return {
    descriptionZh: zh,
    descriptionEn: en,
    repoUrl: url,
  };
}

function pluginYmlUrls(repo, fileUrls = null) {
  if (!repo?.owner || !repo?.repo) return [];
  const file = `data/plugins/${repo.owner}__${repo.repo}.yml`;
  if (typeof fileUrls === "function") return fileUrls("awesome-dsh-plugin", "awesome-dsh-plugin", file);
  return [
    `https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/${file}`,
    `https://cdn.jsdelivr.net/gh/awesome-dsh-plugin/awesome-dsh-plugin@main/${file}`,
  ];
}

function pluginReadmeUrls(repo, fileUrls = null) {
  if (!repo?.owner || !repo?.repo) return { zh: [], en: [] };
  const files = (name) => (
    typeof fileUrls === "function"
      ? fileUrls(repo.owner, repo.repo, name)
      : [
          `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/main/${name}`,
          `https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.repo}@main/${name}`,
        ]
  );
  return {
    zh: [
      ...files("README.zh-CN.md"),
      ...files("README.zh.md"),
      ...files("README_CN.md"),
      ...files("README-CN.md"),
      ...files("README.CN.md"),
      ...files("README-zh.md"),
    ],
    en: files("README.md"),
  };
}

const INTRO_HEADING_RE = /^(?:what\s+is\b[\s\w.-]{0,48}|[\w\u3400-\u9fff.\s-]{1,48}是什么|简介|introduction|overview)\s*$/i;
const STOP_HEADING_RE = /^(install(?:ation)?|quick\s*start|getting\s*started|usage|api|features?|why\b|license|changelog|配置|安装|快速开始|入门|为什么|评测|接入|部署|许可证|核心理念)\b/i;
const LANG_TOKEN_RE = /^(english|en|中文|汉语|简体|繁體|日本語|日本语|한국어|fran[cç]ais|deutsch|espa[nñ]ol|readme(?:[._-]?(?:cn|zh|en|ja))?)$/i;

function stripHeadingMarks(line) {
  return String(line || "").replace(/^#+\s+/, "").replace(/^>\s*/, "").trim();
}

function isLanguageSwitcher(line) {
  const parts = String(line || "")
    .replace(/[\[\]()]/g, " ")
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 8) return false;
  return parts.every((part) => LANG_TOKEN_RE.test(part) || part.length <= 8);
}

function isLinkPile(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  const parts = text.split(/\s*[·•|]\s*/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3 && parts.every((part) => part.length <= 18 && !/[。！？]/.test(part))) return true;
  const stripped = text.replace(/https?:\/\/\S+/g, "").replace(/\[[^\]]*\]/g, "").trim();
  return stripped.length < 3;
}

function isCaption(line) {
  const text = String(line || "").trim();
  return /^\*(?!\*)/.test(text) && /\*$/.test(text);
}

function isTitleOnly(line) {
  const text = String(line || "").trim();
  if (text.length >= 40 || /[。！？]/.test(text) || /\.(?:\s|$)/.test(text)) return false;
  return /[:：]/.test(text) || /^(openviking|[\w.-]{2,40})$/i.test(text);
}

function isSkippableLeadLine(line) {
  const text = String(line || "").trim();
  if (!text) return true;
  if (/^[-*|]\s*-{3,}/.test(text) || /^[-_*]{3,}$/.test(text) || /^\|/.test(text)) return true;
  if (/^[-*+]\s+/.test(text) || /^\d+\.\s+/.test(text)) return true;
  if (isLanguageSwitcher(text) || isLinkPile(text) || isCaption(text) || isTitleOnly(text)) return true;
  if (/^(join our community|加入.{0,12}社区)/i.test(text)) return true;
  if (/^[\u{1F300}-\u{1FAFF}👋📱✨⭐️⭐]/u.test(text) && text.length < 48) return true;
  return false;
}

function looksLikeIntro(text) {
  const value = stripZhMissing(text);
  if (value.length < 28) return false;
  const body = value.split(/\n+/).map((line) => line.trim()).filter((line) => line && !isSkippableLeadLine(line));
  if (!body.length) return false;
  return body.some((line) => (
    line.length >= 28
    && (/[。！？]/.test(line) || /[.!](?:\s|$)/.test(line) || (hasCjk(line) && line.length >= 40))
  ));
}

/**
 * First 1–2 meaningful paragraphs from a README.
 * Prefers a 「XXX 是什么」 / “What is …” section; skips badges, TOC, language
 * switchers, link piles, and later Install / API sections.
 */
function extractReadmeLead(markdown, maxChars = 720) {
  let text = String(markdown || "");
  text = text.replace(/<!--[\s\S]*?-->/g, "\n");
  text = text.replace(/```[\s\S]*?```/g, "\n");
  text = text.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "");
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
  text = text.replace(/\[[^\]]+\]\([^)]+\)/g, (match) => {
    const label = match.match(/^\[([^\]]+)\]/);
    return label ? label[1] : "";
  });
  text = text.replace(/<[^>]+>/g, " ");

  const lines = text.split(/\r?\n/);
  let start = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = stripHeadingMarks(lines[i]);
    if (INTRO_HEADING_RE.test(heading)) {
      start = i + 1;
      break;
    }
  }

  const paras = [];
  let buf = [];
  const flush = () => {
    const para = buf.join(" ").replace(/\s+/g, " ").trim();
    buf = [];
    if (!para || para.length < 12) return;
    if (isSkippableLeadLine(para) || INTRO_HEADING_RE.test(para) || STOP_HEADING_RE.test(para)) return;
    paras.push(para);
  };

  for (let i = start; i < lines.length; i += 1) {
    const raw = String(lines[i] || "").trim();
    if (!raw) {
      flush();
      if (paras.length >= 2) break;
      continue;
    }
    const heading = stripHeadingMarks(raw);
    if (/^#{1,6}\s+\S/.test(raw) || STOP_HEADING_RE.test(heading) || INTRO_HEADING_RE.test(heading)) {
      flush();
      if (paras.length >= 1) break;
      continue;
    }
    if (isSkippableLeadLine(raw) || isSkippableLeadLine(heading)) continue;
    buf.push(heading);
  }
  flush();

  const lead = paras.slice(0, 2).join("\n\n").trim();
  if (lead.length <= maxChars) return lead;
  return `${lead.slice(0, maxChars).replace(/\s+\S*$/, "").trim()}…`;
}

function pickLongerZh(current, incoming) {
  return preferDescription(current, incoming);
}

module.exports = {
  CJK,
  ZH_MISSING_MARK,
  KNOWN_ZH,
  hasCjk,
  lookupKnownZh,
  preferDescription,
  localizeDescription,
  parsePluginYml,
  pluginYmlUrls,
  pluginReadmeUrls,
  extractReadmeLead,
  looksLikeIntro,
  pickLongerZh,
  stripZhMissing,
};
