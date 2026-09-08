# DSH runtime (paths + supervisor + versions)

The tray/Electron process stays independent of the DSH child. A plugin that
crashes Host must not take down the tray or uninstall entry.

## Layout

`resolveShellDshRoot(appData)` → `{appData}/dsh` (never `~/.dsh` or
`%APPDATA%/npm`). Unique current install: `{root}/current`. Homes:

| kind | path | role |
| --- | --- | --- |
| safe | `{root}/homes/safe` | no community plugins |
| active | `{root}/homes/active` | verified combo |
| staging | `{root}/homes/staging` | temporary verify |
| quarantine | `{root}/homes/quarantine` | isolated records |

WAL / receipt / rebuild-on-uninstall are **not** implemented here. See
`HOME_ISOLATION_CONTRACT` — `src/install` owns that ledger.

Official evidence: [`@deepseek-ai/dsh-home-paths`](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/home-paths/src/index.ts)
uses a single `$DSH_HOME`. Same binary + different homes is the supported
isolation mechanism.

## Supervisor

`createSupervisor({ spawnFn, protocol, logger, killFn })`

- States: `stopped | starting | running | crashed | stopping`
- `start({ dshBinary, dshHome, mode, extraEnv })` — `mode` is
  `safe | active | staging`. `dshHome` is required so we never inherit
  `~/.dsh`.
- Events: `crash`, `exit`, `stdout`, `stderr`, `status`
- `recentOutput` is a rolling, redacted tail of child stdout/stderr. Ready /
  crash errors append this tail so the tray dialog never shows raw tokens or
  `C:\Users\<name>` paths. See `redact.js`.
- Child crash → `crashed`, emit `crash`, optional backoff restart in
  **safe** (`autoRecoverSafe`, default on). Shell process is never exited.
- `killFn(child)` — optional. The tray passes a process-tree killer
  (`taskkill /T /F` on Windows) so a stop actually releases `DSH_HOME`
  and the global DSH files. Tests keep the default `child.kill`.

Pass a JS entry plus `nodeBinary` when running under Electron
(`process.execPath` is Electron, not Node — same reason `main.js` uses a
bundled `node.exe`).

## Global DSH (`global-dsh.js`)

Resolves the `dsh` JS entry and `npm install -g` argv:

- System Node → `%APPDATA%\npm\node_modules\@deepseek-ai\dsh\...`
- Bundled Node → private npm prefix next to the portable runtime

Never uses a staging prefix for the binary itself. The current tray path
is still `npm install -g`, not `{root}/current`.

## Versions (`dsh-versions.js`)

Pure helpers used by `main.js` when installing or checking updates:

- `pickDshCandidates` — GitHub title + dist-tags + published versions, cap 8
- `dshInstallSpec` — `@deepseek-ai/dsh@<exact>`
- `summarizeDshUpdate` — whether npm has something newer than installed
- `parseAtomEntries` / `matchAtomEntry` — GitHub `releases.atom` notes

A GitHub-only version is **not** offered for install until npm has published it.

## Process tree and output

- `process-tree.js` — Windows `taskkill /T /F` so Host / plugin workers do
  not keep `DSH_HOME` locked after stop.
- `process-output.js` — decode child stdout/stderr as UTF-8, then GBK if
  UTF-8 would show replacement diamonds (common for pnpm on Chinese Windows).

## Diagnostics (`redact.js`)

`redactDiagnosticText` strips query tokens, `Authorization` headers, `sk-` /
`ghp_` / `github_pat_` / `npm_` secrets, `API_KEY=` assignments, and user home
directories (`C:\Users\<name>`, `/Users/<name>`, `/home/<name>`). `main.js`
uses it for splash pages and themed dialogs.

## Current tray wiring

`main.js` still installs DSH with `npm install -g` and redirects `active`
to the user's `~/.dsh` via `configureActiveHome`. The `{root}/current`
layout and `src/dsh-upgrade` remain the library contract for a
shell-exclusive binary; they are tested but not used on the boot path.
Safe / staging / quarantine homes under this root **are** used.
