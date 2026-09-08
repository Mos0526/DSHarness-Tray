# Homes and ledger

Shell-owned `DSH_HOME` trees plus the install ledger. Official DSH uses a
single `$DSH_HOME` (default `~/.dsh`); isolation is **same binary, different
homes**.

## Layout

`ensureHomes(shellDshRoot)` creates ledger dirs and four homes under
`{root}/homes/{kind}` unless `configureActiveHome` redirects `active`.

| kind | community plugins | role |
| --- | --- | --- |
| `safe` | stripped | post-upgrade / crash recover |
| `active` | verified set | production profile |
| `staging` | temporary | install-time verify |
| `quarantine` | isolated records | failed generations |

Ledger: `{root}/ledger/{receipts,wal,lifecycle.json}`.

The tray currently points `active` at the user's `~/.dsh` so the GUI and
terminal `dsh` share one profile. Safe / staging / quarantine stay under
`%APPDATA%\DS harness\dsh\homes\`.

Safe web profile keeps only `@deepseek-ai/dsh-base` and
`@deepseek-ai/dsh-web-app`. Path helpers live in `paths.js` (re-exports
runtime home resolution). Atomic JSON IO is `io.js`.
