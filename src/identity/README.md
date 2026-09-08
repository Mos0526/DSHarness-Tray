# Stable plugin identity

`stableIdFrom({ npmName, repoUrl })` is the durable key across catalog
sources. npm names are lowercased; GitHub / GitLab URLs (https, ssh,
`github:owner/repo`) parse to `{ host, owner, repo, directory, url, id }`.

`sameRepoIdentity` matches on GitHub repo id when both sides have it,
otherwise host + owner + name (case-insensitive). Used by the catalog merge
and the install gate so an attacker-controlled npm `repository` field cannot
replace the repo the user selected.

`isLikelyNpmName` rejects CLI flags and path traversal so uninstall/add
never forwards `--help` or `../evil` as a package name.

`plugin-package.js` looks up a DSH plugin `package.json` when the catalog
only has the host repo (for example `integrations/deepseek-harness/`).
It prefers a manifest with a `dsh` field or a `dsh-` / `-dsh` package name.
