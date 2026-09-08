# Shell settings

Tray **设置** submenu. Preferences live in `shell-state.json` under
`shellSettings`, independent of DSH `settings.yaml`.

| Key | Default | Effect |
| --- | --- | --- |
| `openAtLogin` | `false` | Windows login item; launch with `--autostart` (window stays in tray) |
| `runOnLockScreen` | `false` | `prevent-app-suspension` plus no Chromium background throttling so DSH tasks keep running while the session is locked |

`main.js` applies login items and the power-save blocker. This package is the
pure policy: normalize, persist shape, login-item options, lock-screen flags,
menu template.

On boot it also deletes a known leftover Run key `DSHDesktop` when the value
still points at `dsh-desktop-launcher.exe` (old launcher name). Other Run
entries are left alone.
