# 内网传书（Lanpost-IM）

基于 IPMSG 的跨平台局域网即时通信，无需服务器，文字与文件直传。

## 项目状态

第一版核心功能已实现，当前正在修复主动向 NWT/飞秋发送文件时的入站 TCP 兼容问题。进展和待办见：

- 开发交接与环境切换：`docs/handoff.md`
- 文件发送兼容 TODO：`docs/TODO-file-send-compat.md`
- 设计文档：`docs/superpowers/specs/2026-10-23-electron-client-design.md`

其他文档：

- 文件传输状态机：`docs/file-transfer.md`
- NWT/飞秋兼容矩阵：`docs/nwt-compatibility.md`
- 抓包与协议调试：`docs/protocol-debugging.md`
- 已知限制：`docs/known-limits.md`

## 当前能力

- 局域网自动发现、在线状态、分组、签名。
- 一对一文字消息、送达/已读回执、手动刷新联系人。
- TCP 文件收发、进度、同名去重、接收目录配置。
- SQLite 消息历史、旧历史导入。
- 微信布局桌面界面、联系人页、文件页、设置覆盖层。
- 托盘常驻、系统通知、应用内提示、声音和免打扰。
- 与 NWT 的文字和接收文件兼容；主动发送文件仍在修复。
- 与飞秋的接收文件兼容；主动发送文件仍在修复。

## 开发

要求 Node.js 24 与 pnpm 12.15.0（`packageManager` 已经写入 `package.json`）。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 保留 Chromium 沙箱。如果所在机器的 GPU 进程无法启动（日志出现 `GPU process launch failed`），使用 `pnpm dev:no-sandbox`。

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
