"use strict";

const api = window.pluginCenter;
const listScroll = window.pluginCenterListScroll || {};
const SEARCH_DEBOUNCE_MS = 180;
const ROW_ESTIMATE = listScroll.ROW_ESTIMATE || 112;
const OVERSCAN = 8;
const FIRST_SCREEN = 24;

const state = {
  model: null,
  filter: "all",
  query: "",
  facets: [],
  selectedId: null,
  busy: false,
  operation: null,
  error: "",
  visible: [],
  windowStart: 0,
  windowEnd: 0,
};

const signalEnriched = new Set();
const detailEnriched = new Set();
const detailPending = new Set();

const els = {
  filters: document.getElementById("filters"),
  facets: document.getElementById("facets"),
  listPane: document.getElementById("list-pane"),
  list: document.getElementById("list"),
  listSizer: document.getElementById("list-sizer"),
  empty: document.getElementById("empty"),
  detail: document.getElementById("detail"),
  banner: document.getElementById("banner"),
  search: document.getElementById("search"),
  refresh: document.getElementById("refresh"),
  favoriteHistory: document.getElementById("favorite-history"),
  history: document.getElementById("history"),
  historyList: document.getElementById("history-list"),
  historyEmpty: document.getElementById("history-empty"),
  historyClose: document.getElementById("history-close"),
  confirm: document.getElementById("confirm"),
  confirmBody: document.getElementById("confirm-body"),
  confirmOk: document.getElementById("confirm-ok"),
  confirmCancel: document.getElementById("confirm-cancel"),
};

function matchesFilter(plugin, filterId) {
  if (!filterId || filterId === "all") return true;
  if (filterId === "favorites") return plugin.favorite?.active === true;
  if (filterId === "installed") return plugin.status === "installed" || plugin.status === "updateAvailable";
  if (filterId === "available") return plugin.status === "available" || plugin.status === "interrupted";
  if (filterId === "updateAvailable") return plugin.tags.some((tag) => tag.id === "updateAvailable");
  if (filterId === "quarantined") return plugin.status === "quarantined" || plugin.status === "verifyFailed";
  return plugin.status === filterId;
}

function matchesQuery(plugin, query) {
  if (!query) return true;
  const hay = plugin.searchText || [plugin.name, plugin.description, plugin.detailDescription, plugin.category, plugin.npmName].join(" ").toLowerCase();
  return hay.includes(query);
}

function matchesFacets(plugin, facets) {
  if (!facets.length) return true;
  return facets.every((id) => {
    if (id === "stars") return plugin.flags?.highStars;
    return plugin.flags?.types?.includes(id) || plugin.types?.includes(id);
  });
}

function computeVisible() {
  const query = state.query.trim().toLowerCase();
  const plugins = state.model?.plugins || [];
  state.visible = plugins.filter((plugin) => (
    matchesFilter(plugin, state.filter)
    && matchesQuery(plugin, query)
    && matchesFacets(plugin, state.facets)
  ));
}

function selectedPlugin() {
  return (state.model?.plugins || []).find((plugin) => plugin.id === state.selectedId) || null;
}

function ensureSelection() {
  const items = state.visible;
  if (!state.selectedId || !items.some((item) => item.id === state.selectedId)) {
    state.selectedId = items[0]?.id || null;
  }
}

function renderBanner() {
  const banner = state.model?.banner;
  if (!banner?.message) {
    els.banner.hidden = true;
    els.banner.textContent = "";
    return;
  }
  els.banner.hidden = false;
  els.banner.textContent = banner.message;
}

function renderFilters() {
  els.filters.replaceChildren();
  for (const filter of state.model?.filters || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = filter.attention ? "chip attention" : "chip";
    btn.setAttribute("aria-pressed", String(state.filter === filter.id));
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(filter.count);
    btn.append(filter.label, count);
    btn.addEventListener("click", () => {
      state.filter = filter.id;
      renderAfterFilterChange();
    });
    els.filters.append(btn);
  }
}

function renderFacets() {
  els.facets.replaceChildren();
  for (const facet of state.model?.facets || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.setAttribute("aria-pressed", String(state.facets.includes(facet.id)));
    const count = document.createElement("span");
    count.className = "count";
    count.textContent = String(facet.count);
    btn.append(facet.label, count);
    btn.addEventListener("click", () => {
      if (state.facets.includes(facet.id)) {
        state.facets = state.facets.filter((id) => id !== facet.id);
      } else {
        state.facets = [...state.facets, facet.id];
      }
      renderAfterFilterChange();
    });
    els.facets.append(btn);
  }
}

function tagEls(tags) {
  const wrap = document.createElement("div");
  wrap.className = "tags";
  for (const tag of tags) {
    const span = document.createElement("span");
    span.className = `tag ${tag.tone || "muted"}`;
    span.textContent = tag.label;
    wrap.append(span);
  }
  return wrap;
}

function renderCard(plugin) {
  const li = document.createElement("li");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = plugin.attention ? "card attention" : "card";
  btn.setAttribute("aria-selected", String(plugin.id === state.selectedId));
  const head = document.createElement("div");
  head.className = "card-head";
  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = plugin.name;
  const stars = document.createElement("span");
  stars.className = "card-stars";
  stars.textContent = plugin.preview?.stars || "★ —";
  head.append(name, stars);

  const desc = document.createElement("p");
  desc.className = "card-desc";
  desc.textContent = plugin.description || "暂无说明";

  const meta = document.createElement("div");
  meta.className = "card-meta";
  if (plugin.preview?.heat?.length) {
    const heat = document.createElement("div");
    heat.className = "heat";
    for (const item of plugin.preview.heat) {
      const chip = document.createElement("span");
      chip.className = "heat-tag";
      chip.textContent = item.label;
      heat.append(chip);
    }
    meta.append(heat);
  }
  meta.append(tagEls(plugin.tags));

  btn.append(head, desc, meta);
  btn.addEventListener("click", () => {
    state.selectedId = plugin.id;
    state.error = "";
    renderListWindow();
    renderDetail();
    void requestDetail(plugin.id);
  });
  li.append(btn);
  return li;
}

function listWindowRange() {
  const items = state.visible;
  const scrollTop = els.listPane?.scrollTop || 0;
  const viewport = els.listPane?.clientHeight || 480;
  const start = Math.max(0, Math.floor(scrollTop / ROW_ESTIMATE) - OVERSCAN);
  const visibleCount = Math.ceil(viewport / ROW_ESTIMATE) + OVERSCAN * 2;
  const end = Math.min(items.length, start + Math.max(30, visibleCount));
  return { start, end };
}

function renderListWindow() {
  const items = state.visible;
  els.empty.hidden = items.length > 0;
  if (els.listSizer) els.listSizer.hidden = items.length === 0;
  const { start, end } = listWindowRange();
  state.windowStart = start;
  state.windowEnd = end;

  if (els.listSizer) {
    els.listSizer.style.height = `${typeof listScroll.sizerHeight === "function" ? listScroll.sizerHeight(items.length) : items.length * ROW_ESTIMATE}px`;
  }
  const offset = typeof listScroll.windowOffset === "function" ? listScroll.windowOffset(start) : start * ROW_ESTIMATE;
  els.list.style.transform = `translateY(${offset}px)`;

  els.list.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = start; i < end; i += 1) {
    frag.append(renderCard(items[i]));
  }
  els.list.append(frag);
}

function appendInline(node, text) {
  const parts = String(text || "").split(/(`[^`]+`)/);
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
      const code = document.createElement("code");
      code.textContent = part.slice(1, -1);
      node.append(code);
    } else if (part) {
      node.append(part);
    }
  }
}

function appendIntro(container, text) {
  const paras = String(text || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  for (const para of paras.slice(0, 2)) {
    const p = document.createElement("p");
    appendInline(p, para);
    container.append(p);
  }
}

function evidenceArticle(title, summary, rows) {
  const article = document.createElement("article");
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const p = document.createElement("p");
  p.textContent = summary;
  article.append(h3, p);
  if (rows?.length) {
    const dl = document.createElement("dl");
    for (const [key, value] of rows) {
      if (!value) continue;
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      if (key === "手动 npm") {
        dt.className = "command-label";
        dd.className = "command";
        dd.title = "可在终端复制运行";
        const code = document.createElement("code");
        code.textContent = value;
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "copy-command";
        copy.textContent = "复制";
        copy.addEventListener("click", async () => {
          const result = await api?.copyText?.(value);
          copy.textContent = result?.ok ? "已复制" : "复制失败";
          setTimeout(() => { copy.textContent = "复制"; }, 1_500);
        });
        dd.append(code, copy);
      } else {
        dd.textContent = value;
      }
      dl.append(dt, dd);
    }
    article.append(dl);
  }
  return article;
}

function renderDetail() {
  const plugin = selectedPlugin();
  els.detail.replaceChildren();
  if (!plugin) {
    const empty = document.createElement("div");
    empty.className = "detail-empty";
    const p = document.createElement("p");
    p.textContent = "选择左侧插件，查看更详细的说明、社区热度、维护与供应链。";
    empty.append(p);
    els.detail.append(empty);
    return;
  }

  const wrap = document.createElement("div");
  wrap.className = "detail";
  const titleRow = document.createElement("div");
  titleRow.className = "detail-title";
  const title = document.createElement("h2");
  title.textContent = plugin.name;
  const favorite = actionButton(
    plugin.favorite?.active ? "★ 已收藏" : "☆ 收藏",
    plugin.favorite?.active ? "favorite active" : "favorite",
    () => toggleFavorite(plugin),
  );
  favorite.setAttribute("aria-pressed", String(Boolean(plugin.favorite?.active)));
  titleRow.append(title, favorite);
  wrap.append(titleRow, tagEls(plugin.tags));

  if (plugin.favorite?.favoritedAt) {
    const favoriteAt = document.createElement("p");
    favoriteAt.className = "favorite-at";
    favoriteAt.textContent = `收藏于 ${formatDateTime(plugin.favorite.favoritedAt)}`;
    wrap.append(favoriteAt);
  }

  const short = plugin.description || "";
  const intro = plugin.intro || "";
  const introDistinct = intro && intro !== short;

  const desc = document.createElement("p");
  desc.className = "desc";
  desc.textContent = short || "暂无说明";
  wrap.append(desc);

  const introEl = document.createElement("div");
  introEl.className = "plugin-intro";
  if (detailPending.has(plugin.id) && !introDistinct) {
    introEl.classList.add("is-loading");
    introEl.textContent = "正在加载简介…";
    wrap.append(introEl);
  } else if (introDistinct) {
    appendIntro(introEl, intro);
    wrap.append(introEl);
  }

  if (plugin.missingZh && !detailPending.has(plugin.id) && !introDistinct) {
    const meta = document.createElement("p");
    meta.className = "desc-meta";
    meta.textContent = "暂无中文说明";
    wrap.append(meta);
  }

  const evidence = document.createElement("div");
  evidence.className = "evidence";
  const cards = plugin.evidence || [];
  for (const card of cards) {
    evidence.append(evidenceArticle(card.title, card.summary, card.rows));
  }
  wrap.append(evidence);

  const actions = document.createElement("div");
  actions.className = "actions";
  const currentOperation = state.operation?.id === plugin.id ? state.operation : null;
  if (plugin.actions.upgrade) {
    const label = currentOperation?.method === "upgrade" && state.busy
      ? "正在升级…"
      : "升级到 " + (plugin.versions.available || "新版本");
    actions.append(actionButton(label, "primary", () => run("upgrade", plugin.id)));
  }
  if (plugin.actions.install) {
    const label = currentOperation?.method === "install" && state.busy
      ? "正在安装…"
      : plugin.status === "interrupted" ? "继续安装" : "安装";
    actions.append(actionButton(label, "primary", () => run("install", plugin.id)));
  }
  if (plugin.actions.uninstall) {
    const label = currentOperation?.method === "uninstall" && state.busy ? "正在卸载…" : "卸载";
    actions.append(actionButton(label, "", () => confirmUninstall(plugin)));
  }
  if (plugin.actions.openQuarantine) {
    actions.append(actionButton("打开隔离详情", "", () => showQuarantine(plugin)));
  }
  if (plugin.repositoryUrl) {
    actions.append(actionButton("打开仓库", "", () => api?.openExternal(plugin.repositoryUrl)));
  }
  wrap.append(actions);

  if (!plugin.actions.install && plugin.status === "available" && plugin.actions.installReason) {
    const reason = document.createElement("p");
    reason.className = "note";
    reason.textContent = plugin.actions.installReason;
    wrap.append(reason);
  }

  if (plugin.receipt?.interrupted) {
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "上次安装中断，可重新安装。不会留下半套环境。";
    wrap.append(note);
  }
  if (state.busy && currentOperation?.message) {
    const progress = document.createElement("p");
    progress.className = "operation-status is-running";
    progress.textContent = currentOperation.message;
    wrap.append(progress);
  } else if (state.error) {
    const err = document.createElement("p");
    err.className = "error";
    err.textContent = state.error;
    wrap.append(err);
  }
  els.detail.append(wrap);
}

function actionButton(label, kind, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = kind ? `btn ${kind}` : "btn";
  btn.textContent = label;
  btn.disabled = state.busy;
  btn.addEventListener("click", onClick);
  return btn;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value || "");
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function toggleFavorite(plugin) {
  if (!api?.toggleFavorite || state.busy) return;
  state.busy = true;
  state.error = "";
  render();
  try {
    const result = await api.toggleFavorite({
      id: plugin.id,
      name: plugin.name,
      npmName: plugin.npmName,
      repositoryUrl: plugin.repositoryUrl,
      favorite: !plugin.favorite?.active,
    });
    if (result?.ok === false) {
      state.error = result.error || "收藏操作失败";
    } else if (result?.model) {
      applyModel(result.model);
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function renderFavoriteHistory() {
  const history = state.model?.favoriteHistory || [];
  els.historyList.replaceChildren();
  els.historyEmpty.hidden = history.length > 0;
  for (const item of history) {
    const row = document.createElement("li");
    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const action = document.createElement("span");
    action.textContent = item.action === "unfavorite" ? "取消收藏" : "加入收藏";
    copy.append(name, action);
    const at = document.createElement("time");
    at.dateTime = item.at;
    at.textContent = formatDateTime(item.at);
    row.append(copy, at);
    els.historyList.append(row);
  }
}

function renderChrome() {
  renderBanner();
  renderFilters();
  renderFacets();
}

function render() {
  computeVisible();
  ensureSelection();
  renderChrome();
  renderListWindow();
  renderDetail();
}

function renderAfterFilterChange() {
  computeVisible();
  ensureSelection();
  renderChrome();
  if (els.listPane) els.listPane.scrollTop = 0;
  renderListWindow();
  renderDetail();
  const selected = state.selectedId ? [state.selectedId] : [];
  void requestEnrich({ ids: state.visible.slice(0, FIRST_SCREEN).map((plugin) => plugin.id), detailIds: selected });
}

async function run(method, id) {
  if (!api || state.busy) return;
  state.busy = true;
  state.operation = {
    id,
    method,
    stage: "starting",
    message: method === "uninstall" ? "正在准备卸载…" : method === "upgrade" ? "正在准备升级…" : "正在准备安装…",
    done: false,
  };
  state.error = "";
  render();
  try {
    const result = await api[method](id);
    if (result && result.ok === false) state.error = result.error || "操作未完成";
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    render();
  }
}

function confirmUninstall(plugin) {
  resetConfirm();
  els.confirmBody.textContent = `卸载「${plugin.name}」会从本壳的可用环境中移除它。隔离中的插件也可以从这里清掉，不必等 DSH 恢复。`;
  els.confirm.hidden = false;
  els.confirmOk.onclick = async () => {
    els.confirm.hidden = true;
    await run("uninstall", plugin.id);
  };
}

function resetConfirm() {
  document.getElementById("confirm-title").textContent = "确认卸载";
  els.confirmCancel.textContent = "取消";
  els.confirmOk.textContent = "卸载";
  els.confirmOk.className = "btn danger";
  els.confirmOk.onclick = null;
}

els.confirmCancel.addEventListener("click", () => {
  els.confirm.hidden = true;
  resetConfirm();
});

async function showQuarantine(plugin) {
  let fresh = null;
  try {
    fresh = await api?.openQuarantine(plugin.id);
  } catch {
    fresh = null;
  }
  const detail = fresh?.detail || fresh?.plugin || {};
  const shellVerify = detail.shellVerification || plugin.shellVerify || {};
  const bits = [
    shellVerify.quarantineReason || shellVerify.reasons?.join("；") || "该插件已被隔离，不会进入 active 环境。",
    shellVerify.stage ? `失败阶段：${shellVerify.stage}` : "",
    shellVerify.logExcerpt ? `日志：${shellVerify.logExcerpt}` : "",
    plugin.versions.lastGood ? `上次可用版本：${plugin.versions.lastGood}` : "",
  ].filter(Boolean);
  els.confirmBody.textContent = bits.join("\n");
  document.getElementById("confirm-title").textContent = "隔离详情";
  els.confirmCancel.textContent = "关闭";
  els.confirmOk.textContent = "卸载";
  els.confirm.hidden = false;
  els.confirmOk.onclick = async () => {
    els.confirm.hidden = true;
    resetConfirm();
    await run("uninstall", plugin.id);
  };
}

els.refresh.addEventListener("click", async () => {
  if (!api || state.busy) return;
  state.busy = true;
  state.error = "";
  render();
  try {
    signalEnriched.clear();
    detailEnriched.clear();
    const model = await api.refresh();
    if (model) applyModel(model, { forceEnrich: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.busy = false;
    render();
  }
});

els.favoriteHistory.addEventListener("click", () => {
  renderFavoriteHistory();
  els.history.hidden = false;
});

els.historyClose.addEventListener("click", () => {
  els.history.hidden = true;
});

let searchTimer = 0;
els.search.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value;
    renderAfterFilterChange();
  }, SEARCH_DEBOUNCE_MS);
});

let scrollFrame = 0;
els.listPane.addEventListener("scroll", () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    const next = listWindowRange();
    if (next.start !== state.windowStart || next.end !== state.windowEnd) {
      renderListWindow();
    }
  });
}, { passive: true });

els.listPane.addEventListener("wheel", (event) => {
  const pane = els.listPane;
  if (!pane) return;
  const maxScroll = Math.max(0, pane.scrollHeight - pane.clientHeight);
  const next = typeof listScroll.applyWheelScroll === "function"
    ? listScroll.applyWheelScroll(
      { scrollTop: pane.scrollTop, maxScroll },
      event,
      { pageHeight: pane.clientHeight },
    )
    : null;
  if (!next || !next.applied) return;
  event.preventDefault();
  event.stopPropagation();
  pane.scrollTop = next.scrollTop;
}, { passive: false });

function applyModel(model, { forceEnrich = false } = {}) {
  state.model = model;
  if (state.selectedId && !(model.plugins || []).some((plugin) => plugin.id === state.selectedId)) {
    state.selectedId = null;
  }
  render();
  const visibleIds = state.visible.slice(0, FIRST_SCREEN).map((plugin) => plugin.id);
  const selected = state.selectedId ? [state.selectedId] : [];
  void requestEnrich({ ids: visibleIds, detailIds: selected, force: forceEnrich });
}

async function requestEnrich({ ids = [], detailIds = [], force = false } = {}) {
  if (!api?.enrich) return;
  const signalIds = [...new Set(ids.filter((id) => id && !signalEnriched.has(id)))];
  const details = [...new Set(detailIds.filter((id) => id && !detailEnriched.has(id)))];
  if (!signalIds.length && !details.length) return;
  signalIds.forEach((id) => signalEnriched.add(id));
  details.forEach((id) => {
    detailEnriched.add(id);
    detailPending.add(id);
  });
  if (details.length) renderDetail();
  try {
    const model = await api.enrich({ ids: signalIds, detailIds: details, force });
    if (model) {
      state.model = model;
      computeVisible();
      renderListWindow();
      renderDetail();
    }
  } catch {
    signalIds.forEach((id) => signalEnriched.delete(id));
    details.forEach((id) => detailEnriched.delete(id));
  } finally {
    details.forEach((id) => detailPending.delete(id));
    if (details.length) renderDetail();
  }
}

async function requestDetail(id) {
  if (!id) return;
  await requestEnrich({ ids: [id], detailIds: [id] });
}

if (api) {
  api.onSnapshot(applyModel);
  api.onOperation?.((operation) => {
    state.operation = operation;
    if (operation?.ok === false) state.error = operation.message || "操作未完成";
    renderDetail();
  });
  api.ready().then((model) => {
    if (model) applyModel(model);
  }).catch((error) => {
    state.error = error instanceof Error ? error.message : String(error);
    render();
  });
} else {
  state.error = "插件中心未能连接到壳进程。";
  render();
}
