# Single-directory transactional DSH upgrade

One persistent shell-owned install. A short-lived `stagingDir` is used to
verify an artifact, then atomically renamed onto `destDir`. Failure rolls
back; a second version is not kept.

State is a **sibling** file `{destDir}.upgrade-state.json` so swapping the
directory does not lose `safeBootRequired`.

```js
const { upgradeDsh, readUpgradeState, markSafeBootRequired } = require("./transactional-upgrade");

await upgradeDsh({ destDir, stagingDir, verifyFn, replaceFn });
readUpgradeState(destDir);      // { safeBootRequired, status, ... }
markSafeBootRequired(destDir);  // next boot must be mode=safe
```

After a successful upgrade the state always sets `safeBootRequired: true`.
The supervisor should then start with `mode: "safe"` and the safe
`DSH_HOME` (no community plugins). Plugin re-validation belongs to another
task.

`stagingDir` must be on the same volume as `destDir` so `rename` is atomic
on Windows. Download/network is out of scope — populate staging first.
