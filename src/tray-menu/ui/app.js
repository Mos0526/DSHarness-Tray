"use strict";

const ICONS = {
  window: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6.5h11" stroke="currentColor" stroke-width="1.4"/></svg>',
  folder: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 5.5v6.2c0 .7.6 1.3 1.3 1.3h8.4c.7 0 1.3-.6 1.3-1.3V7.2c0-.7-.6-1.3-1.3-1.3H8L6.7 4.4H3.8c-.7 0-1.3.6-1.3 1.1z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  plugin: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="8.5" y="2.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="2.5" y="8.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/><rect x="8.5" y="8.5" width="5" height="5" rx="1.2" stroke="currentColor" stroke-width="1.4"/></svg>',
  info: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.25" stroke="currentColor" stroke-width="1.4"/><path d="M8 7.2V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="8" cy="5.2" r=".8" fill="currentColor"/></svg>',
  quit: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.2 4.1a5.25 5.25 0 1 0 3.6 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8 2.5v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
};

const DEMO_MODEL = {
  appName: "DS harness",
  updating: false,
  groups: [
    {
      id: "main",
      items: [
        { id: "open-window", label: "打开窗口", type: "command", icon: "window", enabled: true },
        { id: "open-dsh", label: "打开 .dsh 目录", type: "command", icon: "folder", enabled: true },
        { id: "plugin-center", label: "插件商店  •", type: "command", icon: "plugin", enabled: true, badge: true },
      ],
    },
    {
      id: "settings",
      label: "设置",
      items: [
        { id: "open-at-login", label: "开机自启动", type: "toggle", checked: true },
        { id: "run-on-lock-screen", label: "允许锁屏运行", type: "toggle", checked: false },
      ],
    },
    {
      id: "about",
      items: [{ id: "about", label: "关于与更新", type: "command", icon: "info", enabled: true }],
    },
    {
      id: "quit",
      items: [{ id: "quit", label: "退出", type: "command", icon: "quit", enabled: true, danger: true }],
    },
  ],
};

const els = {
  groups: document.getElementById("groups"),
  panel: document.getElementById("panel"),
};

const api = window.trayMenu;
let model = DEMO_MODEL;
let focusIndex = 0;
let lastReportedHeight = 0;

function itemNodes() {
  return [...els.groups.querySelectorAll("[data-id]")];
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderItem(item) {
  const disabled = item.enabled === false;
  const isToggle = item.type === "toggle";
  const classes = ["item"];
  if (item.danger) classes.push("danger");
  const icon = item.icon && ICONS[item.icon] ? `<span class="icon">${ICONS[item.icon]}</span>` : "";
  const badge = item.badge ? '<span class="badge" aria-hidden="true"></span>' : "";
  const sw = isToggle ? '<span class="switch" aria-hidden="true"></span>' : "";
  const checkedAttr = isToggle ? ` aria-checked="${String(Boolean(item.checked))}"` : "";
  return `<button type="button" class="${classes.join(" ")}" data-id="${escapeHtml(item.id)}" data-type="${isToggle ? "toggle" : "command"}" role="${isToggle ? "menuitemcheckbox" : "menuitem"}"${checkedAttr} aria-disabled="${disabled}" ${disabled ? "disabled" : ""}>${icon}<span class="label">${escapeHtml(item.label)}</span>${badge}${sw}</button>`;
}

function render(next) {
  model = next || model;
  els.groups.innerHTML = (model.groups || []).map((group) => {
    const label = group.label ? `<div class="group-label">${escapeHtml(group.label)}</div>` : "";
    const items = (group.items || []).map(renderItem).join("");
    return `<section class="group" data-group="${escapeHtml(group.id)}">${label}${items}</section>`;
  }).join("");
  const nodes = itemNodes();
  if (nodes[focusIndex] && document.activeElement && nodes.includes(document.activeElement)) {
    nodes[focusIndex].focus();
  }
  reportHeight();
}

function reportHeight() {
  if (!api?.resize) return;
  const height = Math.ceil(els.panel.offsetHeight);
  if (height <= 0 || height === lastReportedHeight) return;
  lastReportedHeight = height;
  void api.resize(height);
}

async function activate(button) {
  if (!button || button.disabled) return;
  const id = button.dataset.id;
  if (button.dataset.type === "toggle") {
    const next = button.getAttribute("aria-checked") !== "true";
    button.setAttribute("aria-checked", String(next));
    if (api?.action) await api.action(id, { checked: next });
    return;
  }
  if (api?.action) await api.action(id);
}

function moveFocus(delta) {
  const nodes = itemNodes().filter((node) => !node.disabled);
  if (!nodes.length) return;
  const current = nodes.indexOf(document.activeElement);
  const start = current >= 0 ? current : focusIndex;
  const next = (start + delta + nodes.length) % nodes.length;
  focusIndex = itemNodes().indexOf(nodes[next]);
  nodes[next].focus();
}

els.groups.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  void activate(button);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (api?.dismiss) void api.dismiss();
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    moveFocus(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    moveFocus(-1);
  }
});

async function boot() {
  document.documentElement.classList.toggle("preview", !api);
  if (api?.onModel) api.onModel(render);
  if (api?.ready) {
    const live = await api.ready();
    if (live) render(live);
    else render(DEMO_MODEL);
    return;
  }
  render(DEMO_MODEL);
}

void boot();
