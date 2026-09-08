# GitHub and npm signals

Enrichment for the catalog UI. Never used as a trust score or tray badge.

- `github.js` — `stargazers_count`, `archived`, `pushed_at`.
  Primary: `api.github.com`. Fallback: `ungh.cc`. Latest-commit fetch is
  opt-in (`includeLatestCommit`) so the catalog does not spend a second
  unauthenticated request per row.
- `npm.js` — packument (full JSON, not install-v1, so `time` is present),
  last-month downloads, `deprecated`, `dist.integrity`,
  `resolveInstallPin`. When the running DSH is a prerelease, the pin
  prefers the matching dist-tag (`next`, `rc`, …) if that version still
  satisfies host/renderer ranges.

Both go through `src/catalog/fetch.js` so 304 / 403 / 429 become stale
cache rather than empty UI. Inject `fetcher` in tests.
