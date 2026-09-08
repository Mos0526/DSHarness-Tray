# Plugin install

Supply-chain gate, compatibility check, WAL, receipts, and the ledger
pipeline. The tray's one-click flow in `main.js` calls the gate / WAL /
receipt APIs directly, then runs real `dsh plugin add` in staging then
active. `pipeline.js` is the testable ledger implementation used by
integration tests (crash injection via `crashAfter`).

## Gate (`supply-chain.js`)

`assertInstallGate` requires an exact version, npm integrity, and a
repository identity that matches the catalog selection. It rejects
marketplace-shaped packages, lifecycle scripts, and floating git specs.
Against a previous receipt it also blocks repo transfers, maintainer
changes, integrity drift, and package-name remaps.

## Other modules

| file | role |
| --- | --- |
| `compat.js` | host / renderer ranges from several preview `package.json` shapes |
| `updates.js` | catalog vs installed → `updateAvailable` |
| `wal.js` | begin / append / commit / abort / recover |
| `receipt.js` | pinned version + integrity + repo identity on disk |
| `semver.js` / `integrity.js` / `errors.js` | primitives |

`--ignore-scripts` is mandatory for community plugins. Popularity metrics
never influence the gate.
