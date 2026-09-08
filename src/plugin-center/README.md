# Plugin center

Separate BrowserWindow opened from the tray. It must not wait for DSH to
be ready; snapshot load is best-effort.

## Layers

```
window.js  →  ipc.js + preload.js  →  ui/app.js
                ↑
            facade.js  (catalog + homes + install)
                ↑
            view-model.js
```

- `operations.js` — one-at-a-time guard, staging profile copy (no
  `node_modules`), repository `package.json` identity, user-facing errors.
- `favorites.js` — local favorites + history in
  `{userData}/plugin-favorites.json` (plugin id / name / npm / repo URL only).
- `session.js` / `demo-snapshot.js` — injectable state for tests and UI
  demos.
- `ui/list-scroll.js` — one wheel event → one `scrollTop` change.

Renderer CSP: `connect-src 'none'`. External links must be `http(s)`.
Clipboard copy is limited to `npm install …`.
