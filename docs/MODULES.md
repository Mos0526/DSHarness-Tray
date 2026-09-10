# 有效代码清单

只列构成产品与测试的源码。不含 `node_modules/`、`runtime/`（便携 Node 产物）、`release/`（安装包产物）。

## 接线状态

| 区域 | 托盘是否调用 | 说明 |
| --- | --- | --- |
| `main.js` | 入口 | Electron 主进程 |
| `src/runtime` 监督器 / 路径 / `global-dsh` / `pnpm` / `redact` | 是 | 启动、npm 入口、pnpm PATH、诊断脱敏 |
| `src/adapters` | 是 | 经 `runtime.protocol` |
| `src/homes` | 是 | `ensureHomes`、ledger、listInstalled |
| `src/install` 门禁 / WAL / receipt / compat | 是 | 安装编排直接调用 |
| `src/install/pipeline.js` | 测试 + facade 生命周期 | 托盘一键安装走 CLI；账本 API 给测试与卸载回退 |
| `src/catalog` + `src/signals` + `src/identity` | 是 | 目录与 pin |
| `src/plugin-center` | 是 | 托盘「插件商店」 |
| `src/tray-plugin` | 是 | 插件入口文案与红点 |
| `src/tray-menu` | 是 | 自定义托盘弹出菜单 |
| `src/shell-settings` | 是 | 开机自启、锁屏运行 |
| `src/dsh-upgrade` | 否（仅测试） | 壳独占 current/ 事务升级；保留给后续切换 |

## 根目录

| 文件 | 作用 |
| --- | --- |
| `main.js` | 托盘、主窗口、DSH 安装/更新、监督器接线、插件安装/卸载编排 |
| `dialog.html` / `preload-dialog.js` | 主题确认框（关于、更新、错误） |
| `README.md` / `README.en.md` | 中 / 英说明，页首互相切换 |
| `package.json` / `package-lock.json` | 依赖与 electron-builder 配置 |
| `LICENSE` | MIT |
| `launch.vbs` | 用相对路径启动本地 Electron |
| `make-ico.js` | 由多尺寸 PNG 生成 `icon.ico` |
| `icon.png` / `icon-16.png` / `icon-32.png` / `icon-48.png` / `icon-256.png` | 窗口与 ICO 源 |
| `icon.ico` / `dsh-app.ico` | 应用 / 安装包图标 |
| `tray-icon.png` | 托盘图标（优先于 `icon.png`） |
| `.gitignore` | 忽略 node_modules、release、runtime、日志、`.env`、证书 |
| `.github/workflows/test.yml` | Windows 上跑 `npm test` |

## `src/adapters`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 聚合导出协议适配 |
| `dsh-protocol.js` | `buildArgv` / `parseStdoutLine` / `classifyExit`；`dsh web` 别名、就绪 URL、退出分类 |

## `src/runtime`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 聚合导出 |
| `dsh-paths.js` | `{userData}/dsh` 布局、四种 home、`configureActiveHome` |
| `dsh-supervisor.js` | 子进程状态机、就绪检测、崩溃退避、可选 `killFn` |
| `process-tree.js` | Windows `taskkill /T` 杀进程树，供监督器 stop 使用 |
| `process-output.js` | 子进程输出 UTF-8 / GBK 解码，避免插件错误变成乱码 |
| `global-dsh.js` | 全局 / 私有 prefix 的 dsh 入口与 `npm install -g` 参数 |
| `pnpm.js` | 解析 pnpm 垫片并把目录插入 PATH；缺失时由托盘 `npm install -g pnpm` |
| `dsh-versions.js` | npm / GitHub 版本候选、Atom 发行说明、更新摘要 |
| `redact.js` | 诊断文本脱敏：token、密钥、用户主目录 |

## `src/dsh-upgrade`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 聚合导出 |
| `transactional-upgrade.js` | staging 校验后原子替换 `destDir`；成功则 `safeBootRequired` |
| `promote-staging.js` | `populateFn` 填 staging 再调用 `upgradeDsh` |

## `src/homes`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 导出 paths + layout |
| `paths.js` | ledger / profile / plugin store 路径；复用 runtime 的 home 解析 |
| `layout.js` | `ensureHomes`、safe profile 消毒、`listInstalled` |
| `io.js` | 原子写 JSON、删路径 |

## `src/install`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 聚合导出 |
| `supply-chain.js` | `assertInstallGate` |
| `pipeline.js` | 账本安装 / 隔离 / 提升 / 卸载 + WAL |
| `wal.js` | 预写日志，启动 recover |
| `receipt.js` | 精确版本、integrity、仓库身份收据 |
| `compat.js` | host / renderer 范围（兼容多种 preview 字段） |
| `updates.js` | 目录对照是否有可升级版本 |
| `semver.js` | 解析、比较、`^` / `~` / `satisfies` |
| `integrity.js` | `sha512-` / `sha256-` 解析与比较 |
| `errors.js` | `InstallGateError`、`InstallCrashError` |

## `src/identity`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 聚合导出 |
| `stable-id.js` | npm 名规范化、仓库解析、`stableIdFrom`、`sameRepoIdentity`、`isLikelyNpmName` |
| `plugin-package.js` | 单体仓库里找 DSH 插件 `package.json`、猜 npm 名 |

## `src/catalog`

| 文件 | 作用 |
| --- | --- |
| `index.js` | `createCatalog` / `configureCatalog`；刷新、列表、详情、pin |
| `sources.js` | awesome 列表 URL、Markdown / JSON / 指标解析、合并 |
| `fetch.js` | 带 TTL / ETag / 退避的磁盘缓存 HTTP |
| `descriptions.js` | 中文偏好、yml、README 导语、已知译名表 |
| `detail.js` | 详情长说明、仓库 README、按需翻译 |
| `translate.js` | MyMemory 英译中；失败不抛给调用方 |

## `src/signals`

| 文件 | 作用 |
| --- | --- |
| `github.js` | stars、archived、`pushed_at`；GitHub API + ungh 镜像。默认不打 commits 接口 |
| `npm.js` | packument、下载量、deprecated、integrity、`resolveInstallPin`；安装版本跟随当前 DSH 的 dist-tag 通道 |

## `src/plugin-center`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 包导出 |
| `window.js` | BrowserWindow 工厂 |
| `ipc.js` | 主进程 IPC |
| `preload.js` | `window.pluginCenter` |
| `facade.js` | 快照组装与 install/uninstall/upgrade/收藏 动作 |
| `favorites.js` | 收藏与历史，写入 `{userData}/plugin-favorites.json` |
| `view-model.js` | 筛选、搜索、分类、收藏、证据卡 |
| `operations.js` | 操作互斥、staging profile 拷贝、仓库 package.json 身份、错误文案 |
| `session.js` | 可注入会话状态 |
| `demo-snapshot.js` | UI / 测试用演示数据 |
| `ui/index.html` | 插件中心页面 |
| `ui/app.js` | 渲染进程 UI |
| `ui/styles.css` | 样式 |
| `ui/list-scroll.js` | 列表滚轮（无惯性定时器） |

## `src/tray-plugin`

| 文件 | 作用 |
| --- | --- |
| `menu.js` | 「插件商店」文案与红点后缀 |
| `badge.js` | 红点：updateAvailable / quarantined / verifyFailed |

## `src/tray-menu`

| 文件 | 作用 |
| --- | --- |
| `model.js` | 菜单分组、开关项、靠近托盘的落位 |
| `window.js` | 无边框弹出窗口 |
| `ipc.js` / `preload.js` | 点击、开关、关闭 |
| `ui/` | 与插件中心同色板的菜单界面 |

## `src/shell-settings`

| 文件 | 作用 |
| --- | --- |
| `index.js` | 托盘「设置」：偏好规范化、登录项参数、锁屏策略、清理旧 `DSHDesktop` 开机项 |

## `scripts/`

| 文件 | 作用 |
| --- | --- |
| `run-tests.js` | `node --test` 跑 `test/{unit,integration}/**/*.test.js` |
| `prepare-node.js` | 下载 Node 24 win-x64 zip，整理进 `runtime/node/` |
| `dev-demo.cmd` | 开发演示：按需 `npm install` 后 `npm start` |
| `smoke-plugin-install.js` | 对已安装的全局 DSH 做隔离 `plugin add` 冒烟 |

## 测试

运行器：`npm test` → Node 内置 `node:test`。

### 单元测试 `test/unit/`

| 文件 | 覆盖 |
| --- | --- |
| `adapters/dsh-protocol.test.js` | argv / URL / 退出分类 |
| `runtime/dsh-paths.test.js` | 壳根路径、home kind、active 可指向 `~/.dsh` |
| `runtime/dsh-supervisor.test.js` | 崩溃隔离、safe 注入、状态机、进程树 stop |
| `runtime/process-tree.test.js` | Windows `taskkill /T` |
| `runtime/process-output.test.js` | UTF-8 / GBK 解码 |
| `runtime/pnpm.test.js` | 垫片搜索顺序与 PATH 插入 |
| `runtime/global-dsh.test.js` | 全局入口与 `npm install -g` |
| `runtime/dsh-versions.test.js` | 版本候选、Atom 匹配、更新摘要 |
| `runtime/redact.test.js` | 诊断脱敏 |
| `runtime/index.test.js` | 聚合导出 |
| `dsh-upgrade/*.test.js` | 事务升级成功 / 回滚 / safe boot |
| `homes/paths.test.js` `homes/layout.test.js` | 路径编码、ensureHomes、safe 消毒 |
| `identity/stable-id.test.js` | 仓库与 npm 身份 |
| `identity/plugin-package.test.js` | 单体仓库插件 manifest |
| `install/*.test.js` | 门禁、WAL、管线、compat、receipt、updates |
| `catalog/*.test.js` | 抓取、解析、说明、翻译、详情、目录聚合 |
| `signals/*.test.js` | GitHub / npm 信号 |
| `plugin-center/*.test.js` | facade、operations、收藏、列表滚动 |
| `shell-settings/index.test.js` | 开机自启 / 锁屏运行偏好与菜单 |
| `tray-menu/model.test.js` | 托盘菜单顺序与落位 |
| `catalog/catalog.live.test.js` | 可选真实网络（`DSH_CATALOG_LIVE=1`） |

夹具：`test/unit/catalog/fixtures/`、`test/unit/signals/fixtures/`。

### 集成测试 `test/integration/`

| 文件 | 覆盖 |
| --- | --- |
| `badge.test.js` `menu.test.js` | 托盘红点与「插件商店」文案 |
| `tray-menu-window.test.js` | 自定义托盘弹出窗口（mock Electron） |
| `view-model.test.js` | 插件中心视图 |
| `window-factory.test.js` | 窗口工厂（mock Electron） |
| `fixtures.test.js` | 测试插件夹具形状 |
| `host-crash.test.js` | Host 崩溃 → 隔离 |
| `renderer-fail.test.js` | Renderer 失败 |
| `install-interrupt.test.js` | 安装中断回滚 |
| `incompatible-upgrade.test.js` | 不兼容升级拒绝 |
| `plugin-update.test.js` | 兼容更新 |
| `quarantine-uninstall.test.js` | 隔离后卸载 |

夹具：`test/fixtures/fake-dsh/`（假 CLI）、`test/fixtures/plugins/`（兼容 / 不兼容 / 可升级插件）。

辅助：`test/helpers/`（临时目录、Electron mock、安装选项、打开插件中心）。

## 不提交的产物

| 路径 | 原因 |
| --- | --- |
| `node_modules/` | npm 安装 |
| `runtime/`（仓库根） | `prepare-node` 下载的便携 Node。gitignore 用 `/runtime/`，避免误伤 `src/runtime` |
| `release/` | electron-builder 输出 |
| `*.atom.xml` | 本地抓取的 GitHub releases 缓存 |
| `.env` / `*.pem` / `credentials.json` | 本地密钥与证书，不得提交 |
