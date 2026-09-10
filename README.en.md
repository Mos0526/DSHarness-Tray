# DS harness (dsh-tray)

[中文](README.md) | **English**

[![test](https://github.com/Mos0526/DSHarness-Tray/actions/workflows/test.yml/badge.svg)](https://github.com/Mos0526/DSHarness-Tray/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A Windows tray app. It does **not** implement DeepSeek Harness itself. It:

1. Finds or installs local [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)
2. Starts `dsh web` with an isolated `DSH_HOME`
3. Embeds the Web GUI in an Electron window
4. Opens a plugin center from the tray and installs or uninstalls community plugins behind a supply-chain gate

Product name: **DS harness**. The installer shortcut uses the same name. The executable is `DSH.exe`.

Repository: <https://github.com/Mos0526/DSHarness-Tray>

This repo is the Electron shell source. It is **not** published to npm. DSH itself comes from the official package. This project is not affiliated with DeepSeek.

---

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Tests](#tests)
- [Packaging](#packaging)
- [Daily use](#daily-use)
- [Data directories](#data-directories)
- [What a plugin install does](#what-a-plugin-install-does)
- [Project layout](#project-layout)
- [Scripts](#scripts)
- [Docs](#docs)
- [Troubleshooting](#troubleshooting)
- [Safety boundary](#safety-boundary)
- [License](#license)

## Features

- Stays in the system tray; click opens the window; single-instance
- Tray **设置**: start at login, keep running on the lock screen
- Prepares Node.js automatically (system Node ≥ 20, or the portable Node inside the installer)
- Finds or installs pnpm on startup (`dsh plugin` needs it) and prepends the shim directory to `PATH`
- First launch runs `npm install -g @deepseek-ai/dsh`; prereleases that lack dependencies are skipped
- Checks for DSH updates once a day (tray **关于与更新** can check manually)
- If the DSH child crashes, the tray stays up and falls back to safe mode with no community plugins
- On exit or mode switch, Windows uses `taskkill /T` on the DSH process tree so file locks do not block updates
- Plugin center: community catalog, Chinese descriptions, stars / downloads, favorites, install / upgrade / uninstall, isolated failures
- Monorepos (for example `integrations/deepseek-harness/`) still resolve the real plugin package name
- Installs use an exact version + integrity + repository identity check; verify in a staging home first, then write the live environment
- When the current DSH is a prerelease, the install pin follows the matching npm dist-tag (`next` / `rc`)
- Custom tray popup (same palette as the plugin center); themed dialogs follow system light / dark
- Tokens, secrets, and user home paths in startup failures or DSH output are redacted before display; on Chinese Windows, child logs fall back to GBK

## Requirements

| Item | Requirement |
| --- | --- |
| OS | Windows 10 or later (unpacking portable Node needs system `tar.exe`) |
| Node | Development needs Node.js 20+; the installer may ship portable Node 24 |
| pnpm | No need to preinstall. Startup searches `PATH` / the Node directory / the npm global / the private prefix / `%LOCALAPPDATA%\pnpm`, then runs `npm install -g pnpm` if nothing is found |
| Network | Needed to install DSH and pnpm, refresh the plugin catalog, and fetch npm / GitHub signals |

## Quick start

```bat
git clone https://github.com/Mos0526/DSHarness-Tray.git
cd DSHarness-Tray
npm install
npm start
```

Without git, double-click `scripts\dev-demo.cmd` or `launch.vbs` in Explorer. Both start `electron .` from the repo root.

Dev logs go to the terminal that launched the command. Use tray **退出** or close that terminal to stop.

## Tests

Unit and integration tests use the built-in Node test runner and do not open a real Electron window:

```bat
npm test
```

Optional live catalog tests (hits GitHub / community READMEs):

```bat
set DSH_CATALOG_LIVE=1
npm test
```

CI runs the same `npm test` on a GitHub Actions Windows runner.

## Packaging

```bat
npm run dist
```

This runs `scripts/prepare-node.js` first, puts portable Node in `runtime/node/` (gitignored), then electron-builder builds an NSIS installer. Output is in `release/`:

- `DS-harness-Setup-<version>.exe` — one-click install, with desktop and Start Menu shortcuts

Prepare portable Node only, without packaging:

```bat
npm run prepare-node
```

Regenerate `icon.ico` from `icon-16/32/48/256.png`:

```bat
node make-ico.js
```

## Daily use

Tray menu (**right-click** the icon; **left-click** still opens the main window):

| Item | Action |
| --- | --- |
| 打开窗口 | Show the embedded DSH Web GUI |
| 打开 .dsh 目录 | Open the current **active** `DSH_HOME` |
| 插件商店 | Open the plugin center. A red dot appears when something needs upgrade / isolation / failed verification |
| 设置 | Start at login, keep running on the lock screen (toggles, above About and updates) |
| 关于与更新 | Current DSH version and release notes; **检查更新**, then **更新版本** |
| 退出 | Stop the DSH child, then quit the shell |

Login start uses `--autostart` so the window stays in the tray. Lock-screen keep-alive prevents the OS from suspending the app and turns off Chromium background throttling.

The plugin center is only reachable from the tray. The list supports search, filters (installed / upgradable / favorites / isolated, and so on), and category shortcuts (high stars, UI, vision, memory, Bot, tools). After selecting a row you can read the description, community heat, maintenance status, and supply-chain evidence, then install, upgrade, uninstall, or favorite. Favorites live only in local `plugin-favorites.json` and are not uploaded.

## Data directories

The shell stores its own data in Electron `userData` (usually `%APPDATA%\DS harness`):

```
%APPDATA%\DS harness\
  dsh\
    homes\
      safe\          # no community plugins; used after upgrades or crash recovery
      active\        # internal spare; the current tray points active at ~/.dsh
      staging\       # isolated verify before install; deleted afterwards
      quarantine\    # failed generations / isolation records
    ledger\          # WAL, receipt, lifecycle
    tmp\             # DSH binary upgrade scratch (library code; the tray uses npm -g)
  catalog-cache\     # catalog and GitHub / npm signal cache
  runtime\           # portable Node extracted from the installer (only if system Node is unusable)
  shell-state.json   # lastCheckAt, safeBootRequired, shellSettings
  plugin-favorites.json  # plugin favorites and local history (no account)
```

**Current tray wiring:**

- The DSH **binary** is installed with `npm install -g @deepseek-ai/dsh`. System Node writes to `%APPDATA%\npm`; portable Node writes to the shell's private npm prefix.
- **pnpm** is installed into the same prefix (or reused from `PATH` / `%LOCALAPPDATA%\pnpm`), then that directory is prepended to the child `PATH`. On Windows, `dsh plugin` uses `shell: true`, so `pnpm.cmd` must be callable directly.
- The live **active home** is `~/.dsh` (`%USERPROFILE%\.dsh`), the same config and profile as running `dsh` in a terminal.
- Credentials and settings (`.credentials.yaml`, `settings.yaml`, `pet.json`) are copied into `homes/safe` when entering safe mode.
- Community plugins are still verified in `homes/staging` first, then written to `~/.dsh/profiles/web`.

`src/runtime` also defines a shell-exclusive `{userData}/dsh/current` layout for the transactional upgrade library. The tray boot path does not use that directory today. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What a plugin install does

An "install" is not a raw `npm i` into the live environment. The order is:

1. Confirm the npm package name from the selected GitHub repo's `package.json`
2. Fetch an **exact version + integrity + manifest** from the npm registry
3. `assertInstallGate`: reject floating git specs, marketplace-style plugins, and lifecycle scripts; check repository identity; detect supply-chain changes against the last receipt
4. Check host / renderer compatibility with the current DSH
5. After pnpm is available, copy the active profile to staging (without `node_modules`) and run `dsh plugin add --save-exact --ignore-scripts` in the isolated home
6. Start isolated DSH and probe host / renderer
7. Only then write the live profile, record WAL and a receipt; on failure, roll back or enter safe mode

Catalog sources (discovery only, **not** a safety score):

- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

Stars and downloads never drive the tray red dot. The dot only means: upgrade available, isolated, or verification failed.

## Project layout

```
main.js                 Electron main process: tray, windows, DSH lifecycle, plugin-install orchestration
dialog.html             Themed dialogs for About / Update / Confirm
preload-dialog.js
src/
  adapters/             DSH CLI argv / stdout / exit codes, not pinned to one preview
  runtime/              paths, supervisor, process tree, output decode, pnpm resolve, version candidates, diagnostic redact
  dsh-upgrade/          single-directory transactional upgrade library (tested; not wired in the current tray)
  homes/                four DSH_HOME isolations, ledger paths, profile inventory
  install/              gate, WAL, receipt, compatibility, install pipeline
  identity/             stable plugin IDs, repo / npm identity, monorepo package.json
  catalog/              community catalog fetch, Chinese descriptions, details
  signals/              GitHub / npm heat and maintenance signals
  plugin-center/        plugin-center window, IPC, view model, UI
  tray-plugin/          tray 插件商店 label and red dot
  tray-menu/            custom right-click tray popup
  shell-settings/       tray 设置: login start, lock-screen keep-alive
scripts/                tests, portable Node, dev demo, smoke install
test/                   unit tests, integration tests, fixtures
docs/                   architecture and live-code inventory
```

Each `src/*` package has its own README. Full file list: [docs/MODULES.md](docs/MODULES.md). Design notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | `electron .` |
| `npm test` | `node scripts/run-tests.js` |
| `npm run prepare-node` | Download and arrange portable Node under `runtime/node/` |
| `npm run dist` | Prepare Node, then build the Windows NSIS installer |
| `scripts\dev-demo.cmd` | Local `npm install` if needed, then `npm start` |
| `node scripts/smoke-plugin-install.js [spec]` | Isolated install smoke against global DSH (requires dsh already installed) |
| `node make-ico.js` | Build `icon.ico` from PNGs |

## Docs

| Doc | Contents |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Process model, boot, homes, install pipeline, catalog, recovery |
| [docs/MODULES.md](docs/MODULES.md) | Live source and test map |
| [src/adapters/README.md](src/adapters/README.md) | DSH protocol adapter |
| [src/runtime/README.md](src/runtime/README.md) | Paths, supervisor, process tree, output decode, pnpm, diagnostic redact |
| [src/dsh-upgrade/README.md](src/dsh-upgrade/README.md) | Transactional upgrade library |
| [src/homes/README.md](src/homes/README.md) | Homes and ledger |
| [src/install/README.md](src/install/README.md) | Install gate and WAL |
| [src/catalog/README.md](src/catalog/README.md) | Community catalog |
| [src/plugin-center/README.md](src/plugin-center/README.md) | Plugin center |
| [src/identity/README.md](src/identity/README.md) | Stable identity |
| [src/signals/README.md](src/signals/README.md) | GitHub / npm signals |
| [src/tray-plugin/README.md](src/tray-plugin/README.md) | Tray plugin entry |
| [src/tray-menu/README.md](src/tray-menu/README.md) | Custom tray menu |
| [src/shell-settings/README.md](src/shell-settings/README.md) | Login start and lock-screen keep-alive |

Package READMEs under `src/` are in English. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/MODULES.md](docs/MODULES.md) are in Chinese.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| `npm start` cannot find Electron | Run `npm install` at the repo root |
| Splash stays on preparing Node / installing DSH | Check the network; prereleases that lack dependencies are skipped automatically |
| Window opens but the page is an error | Check the launch-terminal logs; the tray is still running — **退出** and reopen |
| Plugin install fails, live environment unchanged | Expected: a staging verify failure does not write `~/.dsh` |
| Plugin install says pnpm is missing | The shell runs `npm install -g pnpm` on startup and before install. If that still fails, run the command yourself, or start the tray from a terminal that already has pnpm |
| DSH crash, fewer features | Safe mode (no community plugins). Reinstall from the plugin center after fixing |
| Prompt says safe mode is on | Community plugins in normal mode are incompatible with the current DSH and were disabled; paths and tokens in the dialog are already redacted |
| Tasks freeze after lock screen | Tray → 设置 → enable lock-screen keep-alive |
| After a DSH update it still looks old / files are locked | Quit from the tray first; the shell uses `taskkill /T` on the process tree. If still locked, end leftover `node.exe` and retry |
| A second double-click of the installer / `npm start` opens no new window | Single-instance lock: it focuses the existing window |
| `npm run dist` fails to unpack Node | Confirm system `tar.exe` (ships with Windows 10+) |

## Safety boundary

The shell can guarantee: npm integrity and repository identity are checked before install; community plugins use `--ignore-scripts`; they run isolated before entering `~/.dsh`; the renderer cannot open arbitrary links or write arbitrary clipboard content.

The shell cannot guarantee: once a plugin is in active, it has Host capabilities in that home. On Windows the default is `danger-full-access`, matching the official GUI permission model — this is not a sandbox. Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) section 9.

## License

MIT. See [LICENSE](LICENSE).

DeepSeek Harness (`@deepseek-ai/dsh`) and community plugins have their own licenses, outside this repository.

## Related links

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [CLI user guide](https://deepseekdocs.com/en/docs/user-guide/cli)
- Community catalogs: [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness), [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- Issues: [GitHub Issues](https://github.com/Mos0526/DSHarness-Tray/issues)
