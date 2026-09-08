"use strict";

const { hasCjk, stripZhMissing } = require("../catalog/descriptions");

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_MS = DAY_MS;
const HIGH_STARS = 10;

const FACETS = [
  { id: "stars", label: "高星" },
  { id: "ui", label: "UI" },
  { id: "vision", label: "视觉" },
  { id: "memory", label: "记忆" },
  { id: "bot", label: "Bot / Agent" },
  { id: "tools", label: "工具" },
];

const CATALOG_AWESOME_DSH = "awesome-deepseek-harness";
const CATALOG_AWESOME_PLUGIN = "awesome-dsh-plugin";

function asList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "object") return Object.values(value);
  return [];
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function classifyPluginTypes(text) {
  const source = String(text || "").toLowerCase();
  const types = [];
  const add = (id, pattern) => {
    if (pattern.test(source)) types.push(id);
  };
  add("ui", /\b(ui|sidebar|theme|wallpaper|panel|layout|frontend|renderer)\b|界面|侧边栏|主题|壁纸|面板|皮肤/iu);
  add("vision", /\b(vision|visual|image|ocr|multimodal|screenshot|video|camera)\b|视觉|图像|图片|截图|多模态|视频/iu);
  add("memory", /\b(memory|context|memo|knowledge|rag|recall)\b|记忆|上下文|知识库|召回/iu);
  add("bot", /\b(bot|agent|assistant|subagent|persona)\b|智能体|机器人|代理|助手|子代理/iu);
  add("tools", /\b(tool|terminal|git|search|review|workflow|skill|mcp|browser|debug)\b|工具|终端|搜索|审查|工作流|技能|调试/iu);
  return types;
}

function formatCount(value) {
  if (value == null || Number.isNaN(Number(value))) return "";
  const n = Number(value);
  if (n >= 10_000) return `${(n / 10_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, "")} 万`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

function formatRelativeTime(ts, now) {
  if (!ts) return "";
  const at = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(at)) return "";
  const delta = now - at;
  if (delta < 60_000) return "刚刚";
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < DAY_MS) return `${Math.floor(delta / 3600_000)} 小时前`;
  if (delta < 30 * DAY_MS) return `${Math.floor(delta / DAY_MS)} 天前`;
  const d = new Date(at);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function readSignal(signal, now, staleMs) {
  if (signal == null || typeof signal !== "object") {
    if (signal == null || signal === "") {
      return { value: null, display: "暂无数据", stale: false, missing: true, fetchedAt: null };
    }
    return { value: signal, display: String(signal), stale: false, missing: false, fetchedAt: null };
  }
  const value = signal.value !== undefined ? signal.value : signal.count;
  const fetchedAt = signal.fetchedAt || signal.checkedAt || null;
  const age = fetchedAt ? now - (typeof fetchedAt === "number" ? fetchedAt : Date.parse(fetchedAt)) : null;
  const stale = Boolean(signal.stale || signal.error || (age != null && Number.isFinite(age) && age > staleMs));
  const missing = value == null || value === "";
  return {
    value: missing ? null : value,
    display: missing ? (stale ? "数据已过期" : "暂无数据") : String(value),
    stale,
    missing,
    fetchedAt,
    error: signal.error || null,
  };
}

function listingFrom(entry) {
  const sources = [];
  const inA = Boolean(entry.inAwesomeDeepseekHarness ?? entry.catalogs?.awesomeDeepseekHarness);
  const inB = Boolean(entry.inAwesomeDshPlugin ?? entry.catalogs?.awesomeDshPlugin);
  if (inA) sources.push(CATALOG_AWESOME_DSH);
  if (inB) sources.push(CATALOG_AWESOME_PLUGIN);
  const conflict = Boolean(entry.catalogConflict || entry.catalogs?.conflict);
  if (conflict) {
    return { kind: "conflict", label: "信息冲突", sources, note: "两个目录信息不一致，安装前请复核。" };
  }
  if (inA && inB) {
    return { kind: "dual", label: "双目录收录", sources, note: "来源相关的目录一致信号，不是两次独立审核。" };
  }
  if (inA || inB) {
    return { kind: "single", label: "单目录收录", sources, note: sources[0] };
  }
  return { kind: "none", label: "未收录", sources, note: "未出现在社区目录中。" };
}

function verifyTone(result) {
  if (result === true || result === "pass") return "pass";
  if (result === false || result === "fail") return "fail";
  if (result === "skipped") return "skipped";
  return "unknown";
}

function verifyLabel(tone, role) {
  const name = role === "host" ? "Host" : "Renderer";
  if (tone === "pass") return `${name} 通过`;
  if (tone === "fail") return `${name} 失败`;
  if (tone === "skipped") return `${name} 已跳过`;
  return `${name} 未验证`;
}

function deriveStatus(item) {
  const state = item.state || item.status;
  const quarantined = item.quarantined === true || state === "quarantined";
  const verifyFailed = item.verifyFailed === true || state === "verifyFailed" || item.verify?.ok === false;
  const interrupted = item.receipt?.status === "aborted" || item.interrupted === true;
  const updateAvailable = item.updateAvailable === true || state === "updateAvailable";
  const installed = item.installed === true || ["active", "installed", "staging"].includes(state);
  if (quarantined) return "quarantined";
  if (verifyFailed && (installed || state === "failed")) return "verifyFailed";
  if (interrupted) return "interrupted";
  if (updateAvailable) return "updateAvailable";
  if (installed) return "installed";
  return "available";
}

function tagsFor(status, item) {
  const tags = [];
  if (status === "quarantined" || item.quarantined) {
    tags.push({ id: "quarantined", label: "已隔离", tone: "danger" });
  }
  if (status === "verifyFailed" || item.verifyFailed || item.verify?.ok === false) {
    if (!tags.some((t) => t.id === "verifyFailed")) {
      tags.push({ id: "verifyFailed", label: "验证异常", tone: "danger" });
    }
  }
  if (item.updateAvailable || status === "updateAvailable") {
    tags.push({ id: "updateAvailable", label: "待升级", tone: "warning" });
  }
  if (status === "interrupted" || item.receipt?.status === "aborted") {
    tags.push({ id: "interrupted", label: "安装中断", tone: "warning" });
  }
  if (status === "installed") tags.push({ id: "installed", label: "已安装", tone: "ok" });
  if (status === "available") tags.push({ id: "available", label: "可安装", tone: "muted" });
  if (
    (status === "installed" || status === "updateAvailable")
    && verifyTone(item.verify?.host) === "pass"
    && verifyTone(item.verify?.renderer) === "pass"
  ) {
    tags.push({ id: "verified", label: "已验证", tone: "ok" });
  }
  const seen = new Set();
  return tags.filter((tag) => {
    if (seen.has(tag.id)) return false;
    seen.add(tag.id);
    return true;
  });
}

function lifecycleById(lifecycle) {
  const map = new Map();
  const items = Array.isArray(lifecycle) ? lifecycle : [
    ...asList(lifecycle?.items),
    ...asList(lifecycle?.plugins),
    ...asList(lifecycle?.byId),
  ];
  for (const item of items) {
    if (item && item.id) map.set(item.id, item);
  }
  for (const item of asList(lifecycle?.quarantined)) {
    if (typeof item === "string") {
      map.set(item, { ...(map.get(item) || {}), id: item, state: "quarantined" });
    } else if (item?.id) {
      map.set(item.id, { ...(map.get(item.id) || {}), ...item, state: item.state || "quarantined" });
    }
  }
  return map;
}

function receiptsById(receipts) {
  const map = new Map();
  for (const receipt of asList(receipts)) {
    if (!receipt?.id) continue;
    const prev = map.get(receipt.id);
    if (!prev || (receipt.at || 0) >= (prev.at || 0)) map.set(receipt.id, receipt);
  }
  return map;
}

function mergeEntry(catalogEntry, life, receipt, signalsForId, now, staleMs) {
  const id = catalogEntry?.id || life?.id || receipt?.id;
  const item = {
    ...catalogEntry,
    ...life,
    id,
    name: catalogEntry?.name || life?.name || id,
    description: catalogEntry?.description || life?.description || "",
    longDescription: catalogEntry?.longDescription || "",
    descriptionZh: catalogEntry?.descriptionZh,
    descriptionSource: catalogEntry?.descriptionSource || "",
    detailFetchedAt: catalogEntry?.detailFetchedAt || null,
    missingZh: catalogEntry?.missingZh,
    about: catalogEntry?.about || "",
    category: catalogEntry?.category || life?.category || "",
    installed: life?.installed === true || ["active", "installed", "staging", "quarantined", "failed", "verifyFailed"].includes(life?.state || life?.status),
    quarantined: life?.quarantined === true || life?.state === "quarantined" || life?.status === "quarantined",
    updateAvailable: life?.updateAvailable === true,
    verifyFailed: life?.verifyFailed === true || life?.verify?.ok === false,
    verify: life?.verify,
    installedVersion: life?.installedVersion || receipt?.version,
    availableVersion: life?.availableVersion || catalogEntry?.exactVersion || catalogEntry?.latestVersion,
    lastGoodVersion: life?.lastGoodVersion || (receipt?.status === "committed" ? receipt.version : undefined),
    receipt,
  };

  const status = deriveStatus(item);
  const stars = readSignal(signalsForId?.stars ?? catalogEntry?.stars, now, staleMs);
  if (stars.value != null && stars.display === String(stars.value)) stars.display = formatCount(stars.value);
  const downloads = readSignal(signalsForId?.npmDownloads ?? catalogEntry?.npmDownloads, now, staleMs);
  if (downloads.value != null && downloads.display === String(downloads.value)) {
    downloads.display = `${formatCount(downloads.value)} 次`;
  }
  const listing = listingFrom(catalogEntry || {});
  const latestAt = signalsForId?.lastCommitAt || catalogEntry?.lastCommitAt || catalogEntry?.latestReleaseAt;
  const latestRel = readSignal(
    typeof latestAt === "object" && latestAt ? latestAt : { value: latestAt, fetchedAt: signalsForId?.fetchedAt || catalogEntry?.signalsFetchedAt },
    now,
    staleMs,
  );
  const deprecated = Boolean(catalogEntry?.deprecated || signalsForId?.deprecated);
  const archived = Boolean(catalogEntry?.archived || signalsForId?.archived);
  const lastCheckedAt = signalsForId?.fetchedAt || catalogEntry?.lastCheckedAt || catalogEntry?.signalsFetchedAt || null;
  const maintStale = Boolean(signalsForId?.stale || catalogEntry?.signalsStale || (lastCheckedAt && now - lastCheckedAt > staleMs));

  const host = verifyTone(item.verify?.host);
  const renderer = verifyTone(item.verify?.renderer);
  const quarantineReason = item.verify?.reason || item.quarantineReason || (status === "quarantined" ? "已隔离，等待处理。" : "");

  const identityChanged = Boolean(catalogEntry?.identityChanged || item.identityChanged);
  const mappingConflict = Boolean(catalogEntry?.mappingConflict || catalogEntry?.catalogConflict);
  const integrity = catalogEntry?.integrity || item.integrity || receipt?.integrity || "";
  const exactVersion = catalogEntry?.exactVersion || item.installedVersion || item.availableVersion || "";

  const communityBits = [listing.label];
  if (!stars.missing) communityBits.push(`★ ${stars.display}`);
  if (!downloads.missing) communityBits.push(`npm ${downloads.display}`);
  if (stars.stale || downloads.stale) communityBits.push("数据已过期");

  const latestVersion = catalogEntry?.latestVersion || item.availableVersion || "";
  const installVersion = exactVersion || latestVersion;
  const channelAhead = Boolean(installVersion && latestVersion && installVersion !== latestVersion);
  const versionLabel = channelAhead
    ? `${installVersion}（当前 DSH 通道；npm latest ${latestVersion}）`
    : (latestVersion || installVersion);

  const maintBits = [];
  if (versionLabel) {
    maintBits.push(versionLabel);
  }
  if (latestRel.value) maintBits.push(formatRelativeTime(latestRel.value, now) || "最近有更新");
  if (deprecated) maintBits.push("已弃用");
  if (archived) maintBits.push("仓库已归档");
  if (maintStale) maintBits.push("数据已过期");
  if (!maintBits.length) maintBits.push(lastCheckedAt ? `上次检查 ${formatRelativeTime(lastCheckedAt, now)}` : "暂无数据");

  const chainBits = [];
  if (exactVersion) chainBits.push(exactVersion);
  chainBits.push(integrity ? "完整性已记录" : "未记录 integrity");
  if (identityChanged) chainBits.push("仓库身份有变化");
  else if (catalogEntry?.repositoryId || item.repositoryId) chainBits.push("仓库身份未变");
  if (mappingConflict) chainBits.push("映射冲突");

  const verifyBits = [verifyLabel(host, "host"), verifyLabel(renderer, "renderer")];
  if (quarantineReason && (status === "quarantined" || status === "verifyFailed")) {
    verifyBits.push(quarantineReason);
  }

  const attention = status === "quarantined" || status === "verifyFailed" || item.updateAvailable === true || status === "updateAvailable";
  const descriptionZh = item.descriptionZh == null
    ? hasCjk(stripZhMissing(item.longDescription || item.description))
    : Boolean(item.descriptionZh);
  const intro = stripZhMissing(item.longDescription || "");
  const detailDescription = intro || item.description || "";
  const missingZh = item.missingZh == null ? !descriptionZh : Boolean(item.missingZh);
  const previewHeat = heatPreview(listing, stars, downloads);
  const searchText = [
    item.name,
    item.description,
    item.longDescription,
    item.category,
    catalogEntry?.npmName || item.npmName,
  ].join(" ").toLowerCase();
  const types = classifyPluginTypes(searchText);
  const flags = {
    dual: listing.kind === "dual",
    highStars: !stars.missing && Number(stars.value) >= HIGH_STARS,
    hasNpm: Boolean(item.npmName || catalogEntry?.npmName),
    hasZh: descriptionZh || hasCjk(stripZhMissing(item.description)) || hasCjk(stripZhMissing(item.longDescription)),
    types,
  };
  const npmName = item.packageId || item.npmName || catalogEntry?.npmName || "";
  const installable = Boolean(npmName && !identityChanged && !mappingConflict);
  const installReason = installable
    ? ""
    : !npmName
      ? "该条目只有仓库链接，没有可验证的 npm 包名。"
      : identityChanged || mappingConflict
        ? "目录仓库与 npm 包不属于同一仓库，已阻止安装，以免装错包。"
        : "该条目暂时无法安装。";

  const plugin = {
    id,
    name: item.name,
    description: item.description,
    detailDescription,
    intro,
    descriptionZh,
    descriptionSource: item.descriptionSource || "",
    missingZh,
    about: item.about || "",
    category: item.category,
    types,
    repositoryUrl: catalogEntry?.repositoryUrl || item.repositoryUrl || "",
    npmName,
    status,
    attention,
    tags: tagsFor(status, item),
    community: {
      listing,
      stars: { ...stars, label: stars.missing ? stars.display : `★ ${stars.display}` },
      downloads: { ...downloads, label: downloads.missing ? downloads.display : `近 30 天 ${downloads.display}` },
      summary: communityBits.join(" · "),
    },
    maintenance: {
      latestVersion: latestVersion || installVersion,
      installVersion,
      versionLabel: versionLabel || latestVersion || installVersion,
      channelAhead,
      lastCommitAt: latestRel.value || null,
      lastCommitLabel: latestRel.value ? formatRelativeTime(latestRel.value, now) : "暂无数据",
      deprecated,
      archived,
      lastCheckedAt,
      lastCheckedLabel: lastCheckedAt ? formatRelativeTime(lastCheckedAt, now) : "暂无数据",
      stale: maintStale,
      missing: !lastCheckedAt && !latestRel.value,
      summary: maintBits.join(" · "),
    },
    supplyChain: {
      exactVersion,
      integrity,
      repositoryId: catalogEntry?.repositoryId || item.repositoryId || "",
      identityChanged,
      mappingConflict,
      installCommand: npmName
        ? `npm install ${npmName}${exactVersion ? `@${exactVersion}` : ""} --ignore-scripts`
        : "",
      summary: chainBits.join(" · "),
    },
    shellVerify: {
      host,
      renderer,
      hostLabel: verifyLabel(host, "host"),
      rendererLabel: verifyLabel(renderer, "renderer"),
      quarantineReason,
      dshVersion: item.verify?.dshVersion || item.dshVersion || "",
      stage: item.verify?.stage || "",
      logExcerpt: item.verify?.logExcerpt || item.logExcerpt || "",
      summary: verifyBits.join(" · "),
    },
    versions: {
      installed: item.installedVersion || "",
      available: item.availableVersion || "",
      lastGood: item.lastGoodVersion || "",
    },
    actions: {
      install: installable && (status === "available" || status === "interrupted"),
      installReason,
      uninstall: ["installed", "updateAvailable", "quarantined", "verifyFailed"].includes(status),
      upgrade: installable
        && Boolean(item.updateAvailable)
        && status !== "available",
      openQuarantine: status === "quarantined" || status === "verifyFailed",
    },
    receipt: receipt
      ? {
          op: receipt.op || "",
          status: receipt.status || "",
          version: receipt.version || "",
          at: receipt.at || null,
          interrupted: receipt.status === "aborted",
        }
      : null,
    preview: {
      stars: stars.missing ? "★ —" : `★ ${stars.display}`,
      starsMissing: stars.missing,
      heat: previewHeat,
    },
    flags,
    searchText,
  };
  plugin.evidence = evidenceCards(plugin);
  return plugin;
}

function heatPreview(listing, stars, downloads) {
  const tags = [];
  if (listing?.kind === "dual") tags.push({ id: "dual", label: "双目录" });
  if (!downloads?.missing && downloads?.value != null) {
    tags.push({ id: "downloads", label: formatCount(downloads.value) });
  } else if (!stars?.missing && Number(stars?.value) >= HIGH_STARS) {
    tags.push({ id: "hot", label: "热" });
  }
  return tags;
}

function evidenceCards(plugin) {
  return [
    {
      id: "community",
      title: "社区热度",
      summary: plugin.community.summary,
      rows: [
        ["收录", plugin.community.listing.label],
        ["Stars", plugin.community.stars.label],
        ["npm", plugin.community.downloads.label],
      ],
    },
    {
      id: "maintenance",
      title: "维护状态",
      summary: plugin.maintenance.summary,
      rows: [
        ["版本", plugin.maintenance.versionLabel || plugin.maintenance.latestVersion || "暂无数据"],
        ["提交", plugin.maintenance.lastCommitLabel],
        ["状态", [plugin.maintenance.deprecated ? "已弃用" : "", plugin.maintenance.archived ? "已归档" : ""].filter(Boolean).join(" · ") || "正常"],
      ],
    },
    {
      id: "supplyChain",
      title: "供应链",
      summary: plugin.supplyChain.summary,
      rows: [
        ["integrity", plugin.supplyChain.integrity || "未记录"],
        ["手动 npm", plugin.supplyChain.installCommand],
      ],
    },
  ];
}

function describeSourceProblem(catalog, signals) {
  if (catalog?.sourceError) return String(catalog.sourceError);
  if (signals?.error) return String(signals.error);
  const errors = asList(catalog?.errors);
  if (!errors.length) return "";
  return errors.map((item) => {
    if (typeof item === "string") return item;
    const err = item?.error || item?.message || String(item);
    return item?.sourceId ? `${err}（${item.sourceId}）` : err;
  }).filter(Boolean).join("；");
}

function starValue(plugin) {
  const raw = plugin?.community?.stars?.value ?? plugin?.community?.stars ?? plugin?.stars;
  if (raw && typeof raw === "object") {
    return Number.isFinite(raw.value) ? raw.value : null;
  }
  return Number.isFinite(raw) ? raw : null;
}

function downloadValue(plugin) {
  const raw = plugin?.community?.downloads?.value ?? plugin?.community?.npmDownloads ?? plugin?.npmDownloads;
  if (raw && typeof raw === "object") {
    return Number.isFinite(raw.value) ? raw.value : null;
  }
  return Number.isFinite(raw) ? raw : null;
}

function heatKeys(plugin) {
  const stars = starValue(plugin);
  const downloads = downloadValue(plugin);
  const dual = plugin?.community?.listing?.kind === "dual" ? 1 : 0;
  return {
    attention: plugin?.attention ? 1 : 0,
    hasStars: stars != null ? 1 : 0,
    stars: stars || 0,
    dual,
    downloads: downloads || 0,
    name: String(plugin?.name || ""),
  };
}

/**
 * Attention (quarantine / update) stays first so those stay visible.
 * Then stars (missing sinks), dual-listing boost, npm downloads, stable name.
 */
function compareByHeat(a, b) {
  const left = heatKeys(a);
  const right = heatKeys(b);
  if (left.attention !== right.attention) return right.attention - left.attention;
  if (left.hasStars !== right.hasStars) return right.hasStars - left.hasStars;
  if (left.stars !== right.stars) return right.stars - left.stars;
  if (left.dual !== right.dual) return right.dual - left.dual;
  if (left.downloads !== right.downloads) return right.downloads - left.downloads;
  return left.name.localeCompare(right.name, "zh");
}

function npmIdentityPriority(plugin) {
  const installed = ["installed", "updateAvailable", "quarantined", "verifyFailed"].includes(plugin.status) ? 1_000_000 : 0;
  const dual = plugin.community?.listing?.kind === "dual" ? 100_000 : 0;
  const pinned = plugin.supplyChain?.exactVersion && plugin.supplyChain?.integrity ? 10_000 : 0;
  const unchanged = plugin.supplyChain?.identityChanged ? 0 : 1_000;
  const stars = Number(plugin.community?.stars?.value || 0);
  return installed + dual + pinned + unchanged + Math.min(stars, 999);
}

function dedupeByNpmIdentity(plugins) {
  const result = [];
  const indexByNpm = new Map();
  for (const plugin of plugins) {
    const npmName = String(plugin.npmName || "").trim().toLowerCase();
    if (!npmName) {
      result.push(plugin);
      continue;
    }
    const existingIndex = indexByNpm.get(npmName);
    if (existingIndex == null) {
      indexByNpm.set(npmName, result.length);
      result.push(plugin);
      continue;
    }
    if (npmIdentityPriority(plugin) > npmIdentityPriority(result[existingIndex])) {
      result[existingIndex] = plugin;
    }
  }
  return result;
}

function fetchedAtMs(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function identityKeys(item) {
  return [item?.id, item?.npmName, item?.repositoryUrl]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean);
}

function applyFavorites(plugins, favorites) {
  const records = asList(favorites?.favorites);
  for (const plugin of plugins) {
    const keys = new Set(identityKeys(plugin));
    const record = records.find((item) => identityKeys(item).some((key) => keys.has(key)));
    plugin.favorite = {
      active: Boolean(record),
      favoritedAt: record?.favoritedAt || null,
    };
    if (record && !plugin.tags.some((tag) => tag.id === "favorite")) {
      plugin.tags.unshift({ id: "favorite", label: "已收藏", tone: "favorite" });
    }
  }
}

function favoriteHistory(favorites) {
  return asList(favorites?.history)
    .filter((item) => item?.id && item?.at)
    .map((item) => ({
      id: String(item.id),
      name: String(item.name || item.id),
      npmName: String(item.npmName || ""),
      action: item.action === "unfavorite" ? "unfavorite" : "favorite",
      at: item.at,
    }))
    .sort((left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0));
}

function bannerFrom({ catalog, signals, now, staleMs }) {
  const problem = describeSourceProblem(catalog, signals);
  const catalogStale = Boolean(catalog?.stale);
  const signalStale = Boolean(signals?.stale);
  const fetchedAt = fetchedAtMs(signals?.fetchedAt || catalog?.fetchedAt);
  const ageStale = fetchedAt != null ? now - fetchedAt > staleMs : false;
  const hasEntries = Boolean(catalog?.entries?.length);
  const stale = Boolean(problem || catalogStale || signalStale || ageStale);
  let message = "";
  if (problem && hasEntries) {
    message = `部分目录数据不可用：${problem}`;
  } else if (problem) {
    message = `目录刷新失败：${problem}`;
  } else if (stale && hasEntries && fetchedAt) {
    message = `数据已过期 · 上次检查 ${formatRelativeTime(fetchedAt, now)}`;
  } else if (stale && hasEntries) {
    message = "部分社区数据暂不可用，列表仍可使用。";
  } else if (stale && !hasEntries && ageStale && fetchedAt) {
    message = `数据已过期 · 上次检查 ${formatRelativeTime(fetchedAt, now)}`;
  }
  return {
    stale,
    fetchedAt,
    message,
    cached: Boolean(stale && hasEntries),
  };
}

/**
 * Map catalog + lifecycle + receipts (+ optional signals) into the plugin-center UI model.
 * Never synthesizes a safetyScore.
 */
function buildViewModel(input = {}) {
  const now = input.now || Date.now();
  const staleMs = input.staleMs || DEFAULT_STALE_MS;
  const catalog = input.catalog || { entries: [] };
  const lifecycle = input.lifecycle || { items: [] };
  const receipts = input.receipts || [];
  const signals = input.signals || {};
  const lifeMap = lifecycleById(lifecycle);
  const receiptMap = receiptsById(receipts);
  const signalMap = signals.byId && typeof signals.byId === "object" ? signals.byId : {};

  const ids = new Set();
  const plugins = [];
  for (const entry of asList(catalog.entries)) {
    if (!entry?.id || ids.has(entry.id)) continue;
    ids.add(entry.id);
    plugins.push(mergeEntry(entry, lifeMap.get(entry.id), receiptMap.get(entry.id), signalMap[entry.id], now, staleMs));
  }
  for (const [id, life] of lifeMap) {
    if (ids.has(id)) continue;
    ids.add(id);
    plugins.push(mergeEntry({ id, name: life.name }, life, receiptMap.get(id), signalMap[id], now, staleMs));
  }

  const uniquePlugins = dedupeByNpmIdentity(plugins);
  uniquePlugins.sort(compareByHeat);
  applyFavorites(uniquePlugins, input.favorites);

  const counts = {
    all: uniquePlugins.length,
    favorites: uniquePlugins.filter((p) => p.favorite?.active).length,
    installed: uniquePlugins.filter((p) => p.status === "installed" || p.status === "updateAvailable").length,
    available: uniquePlugins.filter((p) => p.status === "available" || p.status === "interrupted").length,
    updateAvailable: uniquePlugins.filter((p) => p.tags.some((t) => t.id === "updateAvailable")).length,
    quarantined: uniquePlugins.filter((p) => p.status === "quarantined" || p.status === "verifyFailed").length,
    verifyFailed: uniquePlugins.filter((p) => p.status === "verifyFailed" || p.tags.some((t) => t.id === "verifyFailed")).length,
  };

  const model = {
    title: "插件",
    generatedAt: now,
    banner: bannerFrom({ catalog, signals, now, staleMs }),
    counts,
    filters: [
      { id: "all", label: "全部", count: counts.all },
      { id: "favorites", label: "收藏", count: counts.favorites },
      { id: "installed", label: "已安装", count: counts.installed },
      { id: "available", label: "可安装", count: counts.available },
      { id: "updateAvailable", label: "待升级", count: counts.updateAvailable, attention: counts.updateAvailable > 0 },
      { id: "quarantined", label: "已隔离", count: counts.quarantined, attention: counts.quarantined > 0 },
    ],
    facets: FACETS.map((facet) => ({ ...facet, count: uniquePlugins.filter((plugin) => matchesFacets(plugin, [facet.id])).length })),
    favoriteHistory: favoriteHistory(input.favorites),
    plugins: uniquePlugins,
  };
  return cloneJson(model);
}

function matchesQuery(plugin, query) {
  if (!query) return true;
  const hay = plugin.searchText || [plugin.name, plugin.description, plugin.detailDescription, plugin.category, plugin.npmName].join(" ").toLowerCase();
  return hay.includes(String(query).trim().toLowerCase());
}

function matchesFacets(plugin, facets) {
  if (!facets || !facets.length) return true;
  return facets.every((id) => {
    if (id === "stars") {
      const stars = plugin.community?.stars?.value ?? plugin.community?.stars;
      return plugin.flags?.highStars || (Number.isFinite(stars) && stars >= HIGH_STARS);
    }
    return plugin.flags?.types?.includes(id) || plugin.types?.includes(id);
  });
}

function queryPlugins(model, { filterId, query, facets } = {}) {
  return filterPlugins(model, filterId).filter((plugin) => matchesQuery(plugin, query) && matchesFacets(plugin, facets));
}

function filterPlugins(model, filterId) {
  const plugins = model?.plugins || [];
  if (!filterId || filterId === "all") return plugins;
  if (filterId === "favorites") {
    return plugins.filter((p) => p.favorite?.active);
  }
  if (filterId === "installed") {
    return plugins.filter((p) => p.status === "installed" || p.status === "updateAvailable");
  }
  if (filterId === "available") {
    return plugins.filter((p) => p.status === "available" || p.status === "interrupted");
  }
  if (filterId === "updateAvailable") {
    return plugins.filter((p) => p.tags.some((t) => t.id === "updateAvailable"));
  }
  if (filterId === "quarantined") {
    return plugins.filter((p) => p.status === "quarantined" || p.status === "verifyFailed");
  }
  return plugins.filter((p) => p.status === filterId);
}

module.exports = {
  CATALOG_AWESOME_DSH,
  CATALOG_AWESOME_PLUGIN,
  HIGH_STARS,
  FACETS,
  buildViewModel,
  filterPlugins,
  queryPlugins,
  matchesQuery,
  matchesFacets,
  evidenceCards,
  heatPreview,
  formatCount,
  formatRelativeTime,
  compareByHeat,
  heatKeys,
  dedupeByNpmIdentity,
  applyFavorites,
  favoriteHistory,
};
