"use strict";

const { readJson, writeJsonAtomic } = require("../homes/io");

const FAVORITES_SCHEMA_VERSION = 1;
const MAX_FAVORITES = 500;
const MAX_HISTORY = 200;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, limit = 300) {
  return String(value || "").trim().slice(0, limit);
}

function normalizePlugin(value) {
  const input = value && typeof value === "object" ? value : {};
  const id = cleanText(input.id, 200);
  if (!id) throw new Error("收藏缺少插件 ID");
  return {
    id,
    name: cleanText(input.name || id),
    npmName: cleanText(input.npmName, 214),
    repositoryUrl: /^https?:\/\//i.test(String(input.repositoryUrl || ""))
      ? cleanText(input.repositoryUrl, 1_000)
      : "",
  };
}

function normalizeState(value) {
  const input = value && typeof value === "object" ? value : {};
  const favorites = Array.isArray(input.favorites)
    ? input.favorites.filter((item) => item?.id).slice(0, MAX_FAVORITES)
    : [];
  const history = Array.isArray(input.history)
    ? input.history.filter((item) => item?.id && item?.at).slice(0, MAX_HISTORY)
    : [];
  return {
    version: FAVORITES_SCHEMA_VERSION,
    favorites,
    history,
  };
}

function createFavoritesStore({ filePath, initial, now = () => Date.now() } = {}) {
  let state = normalizeState(
    initial || (filePath ? readJson(filePath, null) : null),
  );

  function persist() {
    if (filePath) writeJsonAtomic(filePath, state);
  }

  function snapshot() {
    return cloneJson(state);
  }

  function toggle(plugin, nextValue) {
    const identity = normalizePlugin(plugin);
    const index = state.favorites.findIndex((item) => item.id === identity.id);
    const active = typeof nextValue === "boolean" ? nextValue : index < 0;
    if (active === (index >= 0)) {
      return { ok: true, favorite: active, favorites: snapshot() };
    }

    const at = new Date(now()).toISOString();
    if (active) {
      state.favorites.unshift({ ...identity, favoritedAt: at });
      state.favorites = state.favorites.slice(0, MAX_FAVORITES);
    } else {
      state.favorites.splice(index, 1);
    }
    state.history.unshift({
      ...identity,
      action: active ? "favorite" : "unfavorite",
      at,
    });
    state.history = state.history.slice(0, MAX_HISTORY);
    persist();
    return { ok: true, favorite: active, favorites: snapshot() };
  }

  return {
    snapshot,
    toggle,
  };
}

module.exports = {
  FAVORITES_SCHEMA_VERSION,
  MAX_FAVORITES,
  MAX_HISTORY,
  createFavoritesStore,
  normalizePlugin,
  normalizeState,
};
