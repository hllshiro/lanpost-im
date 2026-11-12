# 内网传书（Lanpost-IM）

基于内网通 NWT 私有协议的跨平台局域网即时通信，无需服务器，文字与文件直传。

## 项目状态

第一版功能已经完成：文字、文件、图片、文件夹、群聊与头像都能与真实内网通走私有通道收发；IPMSG 兼容层已移除，只保留 NWT 私有协议。

- 开发交接与环境切换：`docs/handoff.md`
- 文件传输状态机：`docs/file-transfer.md`
- NWT 兼容矩阵：`docs/nwt-compatibility.md`
- 内网通私有协议（文字、文件、图片、头像）：`docs/nwt-private-protocol.md`
- 内网通私有文件与文件夹数据通道：`docs/nwt-file-channel.md`
- 内网通私有群协议：`docs/nwt-group-protocol.md`
- 内网通私有命令号与 XML 模板：`docs/nwt-command-map.md`
- 内网通真机抓包结论：`docs/nwt-live-findings.md`
- 内网通功能清单（对端静态盘点）：`docs/nwt-feature-inventory.md`
- 抓包与协议调试：`docs/protocol-debugging.md`
- 已知限制：`docs/known-limits.md`

## 当前能力

- 局域网自动发现、在线状态、分组、签名。
- 一对一文字消息、送达/已读回执、手动刷新联系人。
- 私有通道文件、图片与文件夹收发；图片内联显示、点击放大、右键另存/复制；文件与文件夹卡片。
- 图文混排：文字、图片与表情按输入顺序合成一条消息，待发区可逐项移除。
- 群聊：建群、拉人、踢人、退群、解散，群资料与成员、成员变动公告、群文字、群图片、群文件与群文件夹。
- 头像：个人头像可设置并同步给联系人；群头像由群主设置，成员自动取图。
- 表情：QQ、微信、内网通三组表情与收藏，按使用频率排序。
- SQLite 消息历史、旧历史导入、会话搜索、托盘常驻、系统通知、免打扰。
- 桌面集成：全局快捷键、开机启动、最小化启动、空闲自动离开、在线状态快捷切换、接收目录布局、防火墙检测与修复。
- 与真实内网通私有通道互通；不再支持 IPMSG、飞秋、飞鸽。

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
pnpm build:linux   # Linux x64/ARM64，deb、rpm 与 AppImage
```

私有协议默认使用 9011/UDP 发现、9012/UDP ENet、9013/TCP 文件、9014/TCP 文件夹；可在设置中修改。Windows 安装包会添加按程序路径的防火墙规则，Linux deb/rpm 会为默认端口添加 ufw/firewalld 规则。

版本号写在 `package.json`。推送 `v*` 标签会触发 GitHub Actions 构建 Windows x64 与 Linux x64/ARM64 安装包，并创建 GitHub Release；也可以在 Actions 里手动运行。

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
