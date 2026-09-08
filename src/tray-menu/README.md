# Tray menu

Custom popup for the system tray, replacing the unstyled native context
menu. Tokens match the plugin center and themed dialogs (`#202020` /
`#4f8cff` / Segoe UI).

- `model.js` — item order, toggle vs command, popup placement
- `window.js` — frameless, transparent, skip-taskbar BrowserWindow
- `ui/` — icons, switches, section label **设置**

Right-click the tray icon. Left-click still opens the main window.
Settings sit above 关于与更新, with inline switches instead of a submenu.
