# 内网传书（Lanpost-IM）

基于 IPMSG 的跨平台局域网即时通信，无需服务器，文字与文件直传。

## 项目状态

基础工程搭建中。协议实现与界面开发按下面的文档推进：

- 设计文档：`docs/superpowers/specs/2026-10-23-electron-client-design.md`
- 实施计划：`docs/superpowers/plans/2026-10-23-phase-0-foundation.md`

## 功能规划

- 局域网自动发现，显示在线状态、分组、签名。
- 一对一文字消息，送达回执。
- 双向文件传输，显示进度与速度，同名文件自动加序号。
- 完整消息历史，重启与升级后保留，支持搜索与导出。
- 微信布局的桌面界面，托盘常驻，声音、闪烁、系统通知、应用内提示。
- 未来通过自有扩展协议加入群聊等能力，不要求内网通兼容。

## 开发

要求 Node.js 24 与 pnpm 12.15.0（`packageManager` 已经写入 `package.json`）。

```bash
pnpm install
pnpm dev          # 兼容虚拟机与远程桌面，关闭 Chromium 沙箱
pnpm dev:sandbox  # 保留 Chromium 沙箱，需要 GPU 进程可以正常启动
```

## 构建

```bash
pnpm build:win     # Windows x64，NSIS 安装包与 zip
pnpm build:linux   # Linux ARM64，deb 与 AppImage
```

### 受限环境

如果终端运行在沙箱中，无法写入 `%APPDATA%`，可以把数据目录指向项目内并关闭 Chromium 沙箱：

```powershell
$env:LANPOST_DATA_DIR="D:\wlr\ai\lanpost-im\.tmp-data"
pnpm dev:no-sandbox
```

正式使用请从桌面打开终端，保持默认沙箱。

构建与测试由 GitHub Actions 执行，工作流见 `.github/workflows/build.yml`。

## 技术

Electron 44、electron-vite 6、Vue 3、TypeScript、Pinia、`node:sqlite`（Electron 内置 Node 24，无需原生模块）。
