# DS harness（dsh-tray）

[![test](https://github.com/Mos0526/DSHarness-Tray/actions/workflows/test.yml/badge.svg)](https://github.com/Mos0526/DSHarness-Tray/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Windows 托盘应用。它**不实现** DeepSeek Harness 本体，而是：

1. 找到或安装本机 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh)
2. 用独立 `DSH_HOME` 启动 `dsh web`
3. 把 Web GUI 嵌进 Electron 窗口
4. 从托盘打开插件中心，按供应链门禁安装 / 卸载社区插件

产品名：**DS harness**。安装包快捷方式同名，可执行文件为 `DSH.exe`。

仓库：<https://github.com/Mos0526/DSHarness-Tray>

本仓库是 Electron 壳源码，**不发布到 npm**。DSH 本体来自官方包；本项目与 DeepSeek 官方无隶属关系。

---

## 目录

- [功能](#功能)
- [环境](#环境)
- [快速开始](#快速开始)
- [测试](#测试)
- [打包](#打包)
- [日常使用](#日常使用)
- [数据目录](#数据目录)
- [插件安装在做什么](#插件安装在做什么)
- [项目结构](#项目结构)
- [脚本](#脚本)
- [文档](#文档)
- [故障排查](#故障排查)
- [安全边界](#安全边界)
- [源码与诊断脱敏](#源码与诊断脱敏)
- [许可证](#许可证)

## 功能

- 系统托盘常驻；单击打开窗口，单实例运行
- 托盘「设置」：开机自启动、允许锁屏运行
- 自动准备 Node.js（系统 Node ≥ 20，或安装包内的便携 Node）
- 首次启动自动 `npm install -g @deepseek-ai/dsh`；缺依赖的预发布会跳过
- 每天检查一次 DSH 更新（托盘「关于与更新」可手动检查）
- DSH 子进程崩溃时托盘不退出，自动切到无社区插件的安全模式
- 退出或切换模式时在 Windows 上 `taskkill /T` 杀掉 DSH 进程树，避免文件锁挡住更新
- 插件中心：社区目录、中文说明、星标 / 下载量、收藏、安装 / 升级 / 卸载、隔离失败项
- 单体仓库（如 `integrations/deepseek-harness/`）也能解析出真正的插件包名
- 插件安装走精确版本 + integrity + 仓库身份校验；先在 staging home 验证，再写入正式环境
- 当前 DSH 是预发布时，安装 pin 跟随对应 npm dist-tag（如 `next` / `rc`）
- 自定义托盘弹出菜单（与插件中心同色板）；主题对话框跟随系统浅色 / 深色
- 启动失败或 DSH 输出里的 token、密钥、用户主目录会先脱敏再显示；中文 Windows 下按 GBK 解码子进程日志

## 环境

| 项 | 要求 |
| --- | --- |
| 系统 | Windows 10 及以上（打包解压便携 Node 需要系统 `tar.exe`） |
| Node | 开发需要 Node.js 20+；安装包可自带便携 Node 24 |
| 网络 | 安装 DSH、刷新插件目录、拉取 npm / GitHub 信号时需要 |

## 快速开始

```bat
git clone https://github.com/Mos0526/DSHarness-Tray.git
cd DSHarness-Tray
npm install
npm start
```

没有 git 时，也可在资源管理器中双击 `scripts\dev-demo.cmd` 或 `launch.vbs`。二者都会在项目根目录启动 `electron .`。

开发时日志打在启动该命令的终端。托盘「退出」或关掉该终端即可结束进程。

## 测试

单元测试与集成测试走 Node 内置测试运行器，不启动真实 Electron 窗口：

```bat
npm test
```

可选联网目录测试（会打 GitHub / 社区 README）：

```bat
set DSH_CATALOG_LIVE=1
npm test
```

CI 在 GitHub Actions 的 Windows runner 上跑同一套 `npm test`。

## 打包

```bat
npm run dist
```

会先执行 `scripts/prepare-node.js`，把便携 Node 放进 `runtime/node/`（该目录已被 gitignore），再由 electron-builder 打 NSIS 安装包。产出在 `release/`：

- `DS-harness-Setup-<version>.exe` — 一键安装，带桌面与开始菜单快捷方式

仅准备便携 Node、不打包：

```bat
npm run prepare-node
```

重新生成 `icon.ico`（从 `icon-16/32/48/256.png`）：

```bat
node make-ico.js
```

## 日常使用

托盘菜单（**右键**图标；**单击**仍打开主窗口）：

| 项 | 作用 |
| --- | --- |
| 打开窗口 | 显示已嵌好的 DSH Web GUI |
| 打开 .dsh 目录 | 打开当前 **active** `DSH_HOME` |
| 插件商店 | 打开插件中心。有待升级 / 隔离 / 验证失败时显示红点 |
| 设置 | 开机自启动、允许锁屏运行（开关，位于关于与更新之上） |
| 关于与更新 | 当前 DSH 版本与发行说明；点「检查更新」后再「更新版本」 |
| 退出 | 先停 DSH 子进程再退出壳 |

开机自启动会带 `--autostart`，窗口留在托盘、不弹出。允许锁屏运行会阻止系统挂起应用，并关闭 Chromium 后台节流。

插件中心只从托盘进入。列表支持搜索、筛选（已安装 / 可升级 / 收藏 / 隔离等）和分类快捷（高星、UI、视觉、记忆、Bot、工具）。选中条目后可看说明、社区热度、维护状态与供应链信息，再安装、升级、卸载或收藏。收藏只存在本机 `plugin-favorites.json`，不上传。

## 数据目录

壳自己的数据在 Electron `userData`（通常是 `%APPDATA%\DS harness`）：

```
%APPDATA%\DS harness\
  dsh\
    homes\
      safe\          # 无社区插件；升级后或崩溃恢复时启动
      active\        # 壳内部备用；当前托盘会把 active 指到用户 ~/.dsh
      staging\       # 安装前隔离验证，用完删除
      quarantine\    # 失败代次 / 隔离记录
    ledger\          # WAL、receipt、lifecycle
    tmp\             # DSH 本体升级暂存（库代码；当前托盘走 npm -g）
  catalog-cache\     # 目录与 GitHub / npm 信号缓存
  runtime\           # 从安装包解出的便携 Node（仅当系统 Node 不可用）
  shell-state.json   # lastCheckAt、safeBootRequired、shellSettings
  plugin-favorites.json  # 插件收藏与本地历史（无账号）
```

**当前托盘接线：**

- DSH **二进制**通过 `npm install -g @deepseek-ai/dsh` 安装。有系统 Node 时写入 `%APPDATA%\npm`；只有便携 Node 时写入壳的私有 npm prefix。
- 正式 **active home** 是用户目录下的 `~/.dsh`（`%USERPROFILE%\.dsh`），与终端里直接跑 `dsh` 共用同一份配置和 profile。
- 凭证与设置（`.credentials.yaml`、`settings.yaml`、`pet.json`）在切到安全模式时会同步到 `homes/safe`。
- 社区插件仍先在 `homes/staging` 验证，通过后再写入 `~/.dsh/profiles/web`。

`src/runtime` 里还有一套「壳独占 `{userData}/dsh/current`」路径约定，供事务升级库使用。托盘启动路径目前不走那套目录，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 插件安装在做什么

一次「安装」不是直接 `npm i` 进正式环境，顺序是：

1. 用所选 GitHub 仓库的 `package.json` 确认 npm 包名
2. 向 npm registry 取 **精确版本 + integrity + manifest**
3. `assertInstallGate`：禁止浮动 git spec、市场类插件、生命周期脚本；核对仓库身份；相对上次 receipt 检测供应链变更
4. 检查与当前 DSH 的 host / renderer 兼容范围
5. 把 active profile 拷到 staging（不含 `node_modules`），在隔离 home 里 `dsh plugin add --save-exact --ignore-scripts`
6. 启动隔离 DSH，做 host / renderer 探活
7. 通过后才写入正式 profile，记 WAL 与 receipt；失败则回滚或切安全模式

目录来源（发现用，**不是**安全评分）：

- [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)

热度（星标、下载）从不参与托盘红点。红点只来自：可升级、已隔离、验证失败。

## 项目结构

```
main.js                 Electron 主进程：托盘、窗口、DSH 生命周期、插件安装编排
dialog.html             「关于 / 更新 / 确认」主题对话框
preload-dialog.js
src/
  adapters/             DSH CLI argv / stdout / 退出码，不绑死某一预览版
  runtime/              路径、监督器、进程树、输出解码、版本候选、诊断脱敏
  dsh-upgrade/          单目录事务升级库（测试覆盖；当前托盘未接线）
  homes/                DSH_HOME 四种隔离、ledger 路径、profile 清单
  install/              门禁、WAL、receipt、兼容性、安装管线
  identity/             稳定插件 ID、仓库 / npm 身份、单体仓库 package.json
  catalog/              社区目录抓取、中文说明、详情
  signals/              GitHub / npm 热度与维护信号
  plugin-center/        插件中心窗口、IPC、视图模型、UI
  tray-plugin/          托盘「插件商店」文案与红点
  tray-menu/            右键托盘的自定义弹出菜单
  shell-settings/       托盘「设置」：开机自启、锁屏运行
scripts/                测试、便携 Node、开发演示、冒烟安装
test/                   单元测试、集成测试、夹具
docs/                   架构与有效代码清单
```

每个 `src/*` 包都有 README。完整文件清单见 [docs/MODULES.md](docs/MODULES.md)，设计说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `npm start` | `electron .` |
| `npm test` | `node scripts/run-tests.js` |
| `npm run prepare-node` | 下载并整理便携 Node 到 `runtime/node/` |
| `npm run dist` | 准备 Node 后打 Windows NSIS 安装包 |
| `scripts\dev-demo.cmd` | 缺依赖则本地 `npm install`，再 `npm start` |
| `node scripts/smoke-plugin-install.js [spec]` | 对全局 DSH 做一次隔离安装冒烟（需已安装 dsh） |
| `node make-ico.js` | 从 PNG 生成 `icon.ico` |

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 进程模型、启动、Home、安装管线、目录、故障恢复 |
| [docs/MODULES.md](docs/MODULES.md) | 有效源码与测试对照表 |
| [src/adapters/README.md](src/adapters/README.md) | DSH 协议适配 |
| [src/runtime/README.md](src/runtime/README.md) | 路径、监督器、进程树、输出解码、诊断脱敏 |
| [src/dsh-upgrade/README.md](src/dsh-upgrade/README.md) | 事务升级库 |
| [src/homes/README.md](src/homes/README.md) | Home 与 ledger |
| [src/install/README.md](src/install/README.md) | 安装门禁与 WAL |
| [src/catalog/README.md](src/catalog/README.md) | 社区目录 |
| [src/plugin-center/README.md](src/plugin-center/README.md) | 插件中心 |
| [src/identity/README.md](src/identity/README.md) | 稳定身份 |
| [src/signals/README.md](src/signals/README.md) | GitHub / npm 信号 |
| [src/tray-plugin/README.md](src/tray-plugin/README.md) | 托盘插件入口 |
| [src/tray-menu/README.md](src/tray-menu/README.md) | 自定义托盘菜单 |
| [src/shell-settings/README.md](src/shell-settings/README.md) | 开机自启与锁屏运行 |

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `npm start` 提示找不到 Electron | 在仓库根目录执行 `npm install` |
| 启动页停在「正在准备 Node / 安装 DSH」 | 检查网络；预发布缺依赖时会自动跳过并试下一个版本 |
| 窗口能开、页面是错误页 | 看启动终端日志；托盘仍在，可「退出」后重开 |
| 插件安装失败、正式环境未变 | 预期行为：staging 验证失败不会写入 `~/.dsh` |
| DSH 崩溃后功能变少 | 已切到安全模式（无社区插件）；修好后可在插件中心重新安装 |
| 启动后提示「已进入安全模式」 | 正常模式里的社区插件和当前 DSH 不兼容，已自动停用社区插件；对话框里的路径和 token 已经脱敏 |
| 锁屏后任务停住 | 托盘 → 设置 → 打开「允许锁屏运行」 |
| 更新 DSH 后仍像旧版本 / 文件被占用 | 先托盘退出再更新；壳会 `taskkill /T` 杀进程树。若仍占用，结束残留 `node.exe` 后再试 |
| 第二次双击安装包 / `npm start` 没有新窗口 | 单实例锁：会唤起已有窗口 |
| `npm run dist` 解压 Node 失败 | 确认系统有 `tar.exe`（Windows 10+ 自带） |

## 安全边界

壳能保证：安装前校验 npm integrity 与仓库身份；社区插件 `--ignore-scripts`；先隔离运行再进入 `~/.dsh`；渲染进程不能乱开链接或复制任意剪贴板。

壳不能保证：插件一旦进入 active，就拥有该 home 下 Host 的能力；Windows 上默认 `danger-full-access`，与官方 GUI 权限模型一致，不是沙箱。细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) 第 9 节。

## 源码与诊断脱敏

本仓库按可公开源码整理，不含本机路径、账号或密钥：

| 项 | 做法 |
| --- | --- |
| 作者 | `package.json` / `LICENSE` / git 作者只用公开身份 `Mos0526`，邮箱 `Mos0526@users.noreply.github.com` |
| 忽略 | `.env`、`*.pem`、`credentials.json`、`release/`、便携 `runtime/` |
| 运行时 | `src/runtime/redact.js` 抹掉 URL token、`Authorization`、`sk-` / `ghp_` / `npm_`、`API_KEY=`、`C:\Users\<name>` |
| 插件环境 | 隔离安装时去掉 `API_KEY` / `TOKEN` / `SECRET` / `PASSWORD` |
| 目录请求 | 不附带 GitHub token；列表默认只用 `pushed_at`，不按行打 commits |
| git 历史 | 已重写：作者与提交邮箱只用公开身份 `Mos0526` |

测试夹具里的 `alice`、`top-secret` 等是虚构值，用来断言脱敏生效。

## 许可证

MIT。见 [LICENSE](LICENSE)。

DeepSeek Harness（`@deepseek-ai/dsh`）及其社区插件各有自己的许可证，不在本仓库范围内。

## 相关链接

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [CLI 用户指南](https://deepseekdocs.com/en/docs/user-guide/cli)
- 社区目录：[awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness)、[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 问题反馈：[GitHub Issues](https://github.com/Mos0526/DSHarness-Tray/issues)
