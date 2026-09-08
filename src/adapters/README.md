# DSH protocol adapter

CLI argv, stdout events, and exit classification are isolated here so the
shell does not freeze a single `@deepseek-ai/dsh` developer-preview snapshot.

## Official behavior this default maps (2026-08-24)

- `dsh web` is a hardcoded alias for `--profile web`
  ([CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/apps/cli/reference/README.md),
  [user CLI guide](https://deepseekdocs.com/en/docs/user-guide/cli)).
- Web flags: `--host`, `--port` (`0` = OS-assigned), `--no-open`, repeatable
  `--trusted-host`. Current official web-app **rejects** `--host 0.0.0.0`
  ([web-app README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/bundle/web-app/README.md)).
  Some unofficial pages still show `0.0.0.0` as valid — we keep loopback,
  matching existing `main.js`.
- After Loader settle the runtime prints a `dsh web:` **URL** line. It also
  prints `dsh web: opening the default browser; ...`, which is **not** ready.
- `$DSH_HOME` overrides the user-data root (default `~/.dsh`). Community
  plugins live under `$DSH_HOME/profiles/<name>/`. Safe mode is a clean home,
  not a second binary.
- `dsh run` has been removed; one-off tasks use `--profile headless`. This
  adapter does not emit `run`.

Replace parsers via `createProtocol({ buildArgv, parseStdoutLine, classifyExit })`.

Community catalogs ([awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness),
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin))
are discovery sources only; this module does not aggregate them.
