# lanpost-im（内网传书）

Electron 44 + Vue 3 + TypeScript 的局域网即时通信客户端。单应用仓库；pnpm 12.15.0、Node 24 固定，数据库使用 Electron 内置的 `node:sqlite`，没有原生模块。

## 项目目标

- 最终替代内网通桌面客户端。
- 兼容飞秋、飞鸽等基于 IPMSG 的程序。
- 与内网通保持最基本的文字收发和文件收发兼容。
- 基础兼容走 2425 上的 IPMSG；内网通私有 ENet 通道只作为后续扩展，不作为基础发送路径。

## 命令

- `pnpm install`；只用 pnpm，不要混用 npm 或 yarn。
- 开发：`pnpm dev`；GPU 或沙箱启动失败时才用 `pnpm dev:no-sandbox`。不要用管理员终端启动，Electron 44 在提权环境会 GPU/渲染进程启动失败。
- 验证顺序：`pnpm lint` → `pnpm typecheck` → `pnpm test`。CI 执行的是 typecheck → test → build。
- 单测：`pnpm exec vitest run src/main/protocol/discovery.test.ts`；按名称过滤加 `-t "..."`。
- 构建：`pnpm build` 会先跑 typecheck，输出到 `out/`；打包 `pnpm build:win` / `pnpm build:linux` 输出到 `dist/`。
- 不要直接跑 `tsc -p tsconfig.web.json`；用 `pnpm typecheck:web`，脚本里的 `--composite false` 是必需的（`src/shared` 不在 web 的 include 内）。

## 结构

- `src/main/index.ts`：启动、数据目录、窗口、托盘、IPC 注册。
- `src/main/app-service.ts`：主进程编排（协议、仓储、文件、通知）；新业务接这里，不要再塞回 `index.ts`。
- `src/main/protocol/`：IPMSG 发现、文字、私有 XML、GBK；`src/main/files/`：TCP 文件收发；`src/main/firewall.ts`：Windows/Linux 防火墙检测与修复；`src/main/store/`：SQLite schema、仓储、旧历史导入；`src/main/notify/`：通知策略与效果。
- `src/shared/`：main/preload/renderer 的三方契约（`domain.ts`、`ipc.ts`、`settings.ts`），保持不依赖 Electron/Node。新增 IPC 必须同时改 shared 的 `Api`、preload、main handler 和 renderer 调用。
- `src/renderer/src/`：Vue 3 + Pinia；`App.vue` 是外壳，`stores/app.ts` 管快照、事件、当前会话。
- `out/`、`dist/` 是生成物，不要手改；图标、托盘和提示音由 `scripts/gen-assets.py` 生成。

## 协议与文件传输

- 端口 2425 同时承载 UDP 和 TCP，启动时两个服务都绑定；修改端口、监听地址、接收目录后需要重启。
- IPMSG header 的 seq 是 32 位；不要用 `Date.now()*1000` 生成 header 或文件请求 seq。文件任务按 32 位 packetId 匹配。
- 兼容报文 version 为 `1`，内网通私有报文为 `1@shiyeline`；飞秋还使用 `1_lbt80_0#...#9:` 外层头。不要把某一种写死，解析后归一化，回复时保留对端风格。
- 文本优先 GBK，带 UTF8 标志时用 UTF-8。GETFILEDATA 扩展域为十六进制 `packetId:fileId:offset:`。版本按对端选择：内网通作为发送方要求 `1`；对飞秋拉取时，内网通实际使用 `1@shiyeline`。
- 中文搜索使用 `LIKE`；这里的 FTS5 对两字中文查询不可用。
- SQLite 使用 `node:sqlite`，`SCHEMA_VERSION = 1`，只在 `user_version = 0` 时建表；没有增量迁移。第一版尚未发布，目录或命名变更不要写数据迁移代码。
- 改协议前对照 Go 参考实现 `../nwt-re/client/internal/`（存在时只读，不要修改）。

## 数据目录

- 正式：Windows `%APPDATA%\lanpost-im`，Linux `~/.config/lanpost-im`；开发：`%APPDATA%\lanpost-im-dev`。
- 数据库 `lanpost.db` 与 `settings.json` 在数据根目录；`LANPOST_DATA_DIR` 可覆盖。
- 写不进 Roaming 时回退到仓库下的 `.dev-data`。日志出现 `EPERM ... lanpost-im-dev` 时，是终端、沙箱或安全软件拦截了 Electron 进程；换普通、非提权的独立终端，或设置 `LANPOST_DATA_DIR`，不要用管理员权限“修复”。
- 默认接收目录 `Downloads\内网传书`，不可写时回退 `<userData>\recv`。

## 测试

- Vitest 只跑 Node 侧；直接 import `electron` 的模块不能单测，优先测纯逻辑、仓储和协议模块。
- 协议/文件测试使用真实 UDP/TCP 和随机高端口，禁止占用 2425；文件用真实临时文件。
- 用 `mkdtemp` 创建的目录必须在 `afterEach` 删除（`rmSync(..., { recursive: true, force: true, maxRetries: 5 })`），否则会污染系统临时目录。
- 端到端验证用两个实例，各自设置 `LANPOST_DATA_DIR`，并使用不同的 `network.port` 和 `seeds`。
- CI `.github/workflows/build.yml`：Windows x64 + Linux ARM64；只有 `v*` 标签或手动 dispatch 才打包，Release 只在标签触发。

## 参考

- 文档索引：`docs/README.md`。
- 设计基线：`docs/01-设计/2026-10-23-electron-client-design.md`。
- 抓包与协议调试记录：`docs/04-参考资料/protocol-debugging.md`。
- 内网通兼容矩阵：`docs/04-参考资料/nwt-compatibility.md`。
- 文件传输状态机与故障排查：`docs/04-参考资料/file-transfer.md`。
- 已知限制：`docs/02-现状/known-limits.md`。
