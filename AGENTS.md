# lanpost-im（内网传书）

Electron 44 + Vue 3 + TypeScript 的局域网即时通信客户端。单应用仓库；pnpm 12.15.0、Node 24 固定，数据库使用 Electron 内置的 `node:sqlite`，没有原生模块。

## 项目目标

- 最终替代内网通桌面客户端。
- 只支持内网通 NWT 私有协议，不实现 IPMSG、飞秋、飞鸽兼容。
- 发现、文字、文件、文件夹、群聊都走私有协议：UDP 9011 发现，ENet 会话（默认 UDP 9012），TCP 9013/9014 传文件与文件夹。

## 命令

- `pnpm install`；只用 pnpm，不要混用 npm 或 yarn。
- 开发：`pnpm dev`；GPU 或沙箱启动失败时才用 `pnpm dev:no-sandbox`。不要用管理员终端启动，Electron 44 在提权环境会 GPU/渲染进程启动失败。
- 验证顺序：`pnpm lint` → `pnpm typecheck` → `pnpm test`。CI 执行的是 typecheck → test → build。
- 单测：`pnpm exec vitest run src/main/protocol/private/service.test.ts`；按名称过滤加 `-t "..."`。
- 构建：`pnpm build` 会先跑 typecheck，输出到 `out/`；打包 `pnpm build:win` / `pnpm build:linux` 输出到 `dist/`。
- 不要直接跑 `tsc -p tsconfig.web.json`；用 `pnpm typecheck:web`，脚本里的 `--composite false` 是必需的（`src/shared` 不在 web 的 include 内）。

## 结构

- `src/main/index.ts`：启动、数据目录、窗口、托盘、IPC 注册。
- `src/main/app-service.ts`：主进程编排（协议、仓储、文件、通知）；新业务接这里，不要再塞回 `index.ts`。
- `src/main/protocol/private/`：9011 发现、ENet 会话、TEA 与私有 XML；`src/main/peers/registry.ts`：联系人状态源；`src/main/files/`：私有 TCP 文件与文件夹收发；`src/main/store/`：SQLite schema、仓储、旧历史导入；`src/main/notify/`：通知策略与效果。
- `src/main/shortcuts.ts`、`src/main/autostart.ts`、`src/main/presence.ts`、`src/main/firewall.ts`：桌面集成；默认值在 `src/shared/settings.ts`。
- `src/shared/`：main/preload/renderer 的三方契约（`domain.ts`、`ipc.ts`、`settings.ts`），保持不依赖 Electron/Node。新增 IPC 必须同时改 shared 的 `Api`、preload、main handler 和 renderer 调用。
- `src/renderer/src/`：Vue 3 + Pinia；`App.vue` 是外壳，`stores/app.ts` 管快照、事件、当前会话。
- `out/`、`dist/` 是生成物，不要手改；图标、托盘和提示音由 `scripts/gen-assets.py` 生成。

## 协议与文件传输

- 端口：9011/UDP 发现，ENet 默认 9012/UDP（占用时回退临时端口），文件 9013/TCP，文件夹 9014/TCP；修改端口、监听地址、接收目录后需要重启。
- 发现报文 304 字节：type 1 通告、type 2 应答、type 4 会话 hello；本机只依赖 9011 通告与 `privateSeeds`，不再绑定 2425。
- ENet 会话维护 16 位可靠序号、ACK/重传、分片与心跳；应用帧用 TEA 加密，命令号 1000 起。
- 文件与文件夹任务按 `TASK_ID`/文件号匹配；不再有 IPMSG packetId 路径。
- 中文搜索使用 `LIKE`；这里的 FTS5 对两字中文查询不可用。
- SQLite 使用 `node:sqlite`，schema 版本见 `src/main/store/schema.ts`；第一版尚未发布，目录或命名变更不要写数据迁移代码。
- 改协议前对照 `docs/nwt-private-protocol.md`、`docs/nwt-file-channel.md` 和真实客户端样本；参考实现存在时只读，不要修改。

## 数据目录

- 正式：Windows `%APPDATA%\lanpost-im`，Linux `~/.config/lanpost-im`；开发：`%APPDATA%\lanpost-im-dev`。
- 数据库 `lanpost.db` 与 `settings.json` 在数据根目录；`LANPOST_DATA_DIR` 可覆盖。
- 写不进 Roaming 时回退到仓库下的 `.dev-data`。日志出现 `EPERM ... lanpost-im-dev` 时，是终端、沙箱或安全软件拦截了 Electron 进程；换普通、非提权的独立终端，或设置 `LANPOST_DATA_DIR`，不要用管理员权限“修复”。
- 默认接收目录 `Downloads\内网传书`，不可写时回退 `<userData>\recv`。

## 测试

- Vitest 只跑 Node 侧；直接 import `electron` 的模块不能单测，优先测纯逻辑、仓储和协议模块。
- 协议/文件测试使用真实 UDP/TCP 和随机高端口，禁止占用 9011/9012/9013/9014；文件用真实临时文件。
- 用 `mkdtemp` 创建的目录必须在 `afterEach` 删除（`rmSync(..., { recursive: true, force: true, maxRetries: 5 })`），否则会污染系统临时目录。
- 端到端验证用两个实例，各自设置 `LANPOST_DATA_DIR`，并使用不同的 `network.privatePort` / `privateEnetPort` / `privateFilePort` / `privateFolderPort`，互相写入 `privateSeeds`。
- CI `.github/workflows/build.yml`：Windows x64 + Linux x64/ARM64（deb、rpm、AppImage）；只有 `v*` 标签或手动 dispatch 才打包，Release 只在标签触发。

## 参考

- 设计基线：`docs/superpowers/specs/2026-10-23-electron-client-design.md`。
- 开发交接与环境切换：`docs/handoff.md`。
- 抓包与协议调试记录：`docs/protocol-debugging.md`。
- 内网通私有协议：`docs/nwt-private-protocol.md`。
- 内网通兼容矩阵：`docs/nwt-compatibility.md`。
- 文件传输状态机与故障排查：`docs/file-transfer.md`。
- 已知限制：`docs/known-limits.md`。
