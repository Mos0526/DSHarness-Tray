# Community catalog

Discovery only. Dual listing on awesome-deepseek-harness and
awesome-dsh-plugin is a consistency signal, not a safety score.

## Sources (fetched 2026-08-24)

- [0xsline/awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
  — `README.md`, `README.zh-CN.md`, `CATALOG.md`
- [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  — `README.md`, `data/stars.json`, `data/downloads.json`, `data/plugins/*.yml`

## API

```js
const { configureCatalog, refreshCatalog, listPlugins } = require("./index");

configureCatalog({ cacheDir });
await refreshCatalog({ waitForSignals: false }); // list first
const plugins = listPlugins();
```

`createCatalog` also exposes `enrichSignalsFor`, `enrichDetailsFor`, and
`resolveInstallPin` (exact version + integrity from npm). HTTP goes through
`fetch.js` (TTL 6h, expire 7d, ETag, backoff). Chinese copy prefers catalog
zh files; README detail may call MyMemory (`translate.js`) and must not
throw on failure.

Boot in `main.js`: cache under `{userData}/catalog-cache`.
