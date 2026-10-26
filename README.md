# 内网传书（Lanpost-IM）

基于 IPMSG 的跨平台局域网即时通信，无需服务器，文字与文件直传。

## 项目状态

第一版核心功能已实现；主动外发文件的入站防火墙问题已修复并实机验证。当前在补安装包/Linux 回归和少量边界项。文档按“设计 / 现状 / 计划 / 参考资料”分类，入口见：

- 文档索引：`docs/README.md`
- 变更记录：`CHANGELOG.md`
- 设计基线：`docs/01-设计/2026-10-23-electron-client-design.md`
- 已知限制：`docs/02-现状/known-limits.md`
- 文件传输、兼容矩阵、抓包与 IPMSG 标准：`docs/04-参考资料/`

## 当前能力

- 局域网自动发现、在线状态、分组、签名。
- 一对一文字消息、送达/已读回执、手动刷新联系人。
- TCP 文件收发、进度、同名去重、接收目录配置。
- SQLite 消息历史、旧历史导入。
- 微信布局桌面界面、联系人页、文件页、设置覆盖层。
- 托盘常驻、系统通知、应用内提示、声音和免打扰。
- 与 NWT、飞秋的文字和双向文件收发兼容；入站防火墙规则由安装包或设置页处理。

## 开发

要求 Node.js 24 与 pnpm 12.15.0（`packageManager` 已经写入 `package.json`）。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 保留 Chromium 沙箱。如果所在机器的 GPU 进程无法启动（日志出现 `GPU process launch failed`），使用 `pnpm dev:no-sandbox`。

### Windows 防火墙

正式安装包会按机器安装（需要管理员权限），在安装时按程序路径添加一条入站放行规则（规则名 `lanpost-im`，任意协议与端口，适用于所有网络配置文件），并在卸载时删除。规则按程序放行，所以修改监听端口后不需要重新配置。

开发版运行的是 `node_modules` 里的 `electron.exe`，安装包规则不适用；Windows 还可能已经为这个 `electron.exe` 生成显式“阻止”规则（例如当前网卡被归为“公用”时），显式阻止优先于放行。首次在 Windows 上做文件传输前运行：

```powershell
pnpm firewall:dev
```

脚本会请求一次管理员权限，删除该 `electron.exe` 现有的入站规则，再添加名为 `lanpost-im-dev` 的入站放行规则。以下情况需要重新运行：

- 更换 Electron/pnpm 版本，导致 `electron.exe` 路径变化；
- 更换仓库目录；
- 相关防火墙规则被删除或被安全软件还原。

也可以在“设置 → 网络 → 防火墙”查看状态并点“修复”。如果不想运行脚本，临时把当前网卡的网络配置文件改为“专用”，也能让 Windows 自动生成的放行规则生效。

### Linux 防火墙

deb 安装时脚本会检测已启用的 ufw 或 firewalld，为默认端口 2425 添加 TCP/UDP 入站放行规则，并记录到 `/var/lib/lanpost-im/firewall-ports`；卸载时只删除脚本添加过的规则。AppImage、zip，或安装后才启用防火墙的机器，可以在“设置 → 网络 → 防火墙”点“修复”，应用会通过 `pkexec` 请求权限并按当前监听端口添加规则。修改监听端口后需要再点一次修复，安装时添加的 2425 规则不会自动删除。

Linux 非 root 无法直接读取 ufw 规则，状态依据脚本写入的 `/var/lib/lanpost-im/firewall-ports` 记录；没有记录时显示“需确认”，重复修复是幂等的。没有 ufw/firewalld 或使用自定义 nftables/iptables 时不会自动修改，需要按现有策略手动放行：

```bash
sudo ufw allow 2425/tcp && sudo ufw allow 2425/udp
# 或 firewalld
sudo firewall-cmd --permanent --add-port=2425/tcp --add-port=2425/udp && sudo firewall-cmd --reload
```

## 构建

```bash
pnpm build:win     # Windows x64，NSIS 安装包与 zip
pnpm build:linux   # Linux ARM64，deb 与 AppImage
```

### 数据目录

- 正式环境：Windows `%APPDATA%\lanpost-im`，Linux `~/.config/lanpost-im`。
- 开发环境：`%APPDATA%\lanpost-im-dev`；无法写入时回退到项目下的 `.dev-data`。

### 受限环境

如果终端运行在沙箱中，无法写入 `%APPDATA%\lanpost-im-dev`，开发模式会自动退回到项目下的 `.dev-data` 目录；也可以手动指定：

```powershell
$env:LANPOST_DATA_DIR="D:\wlr\ai\lanpost-im\.tmp-data"
pnpm dev
```

不要用管理员终端启动开发版。Electron 44 在提权环境里 GPU 与渲染进程会启动失败，表现为 `0x80000003` 或 `GPU process isn't usable`。正式使用也从普通权限启动。

构建与测试由 GitHub Actions 执行，工作流见 `.github/workflows/build.yml`。

## 技术

Electron 44、electron-vite 6、Vue 3、TypeScript、Pinia、`node:sqlite`（Electron 内置 Node 24，无需原生模块）。
