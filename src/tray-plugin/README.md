# Tray plugin entry

One item in the tray popup: `插件商店`. No nested quarantine / upgrade
submenu — those live in the plugin center window.

- `menu.js` — label `插件商店`; red-dot suffix `•` when `badge.show`.
- `badge.js` — `updateAvailable` | `quarantined` | `verifyFailed` only.
  Stars and downloads never contribute.

The custom tray popup (`src/tray-menu`) reads this label and badge.
`main.js` refreshes the popup after plugin operations and after the
catalog refresh settles.
