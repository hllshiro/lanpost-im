# 开发交接与环境切换

更新：2026-10-26
撰写时仓库：`main` 在 `aa41f52`，只保留 `main` 分支。

## 当前状态

第一版核心功能已经实现：UDP 发现、联系人、文字消息、送达/已读回执、SQLite 历史、微信三栏界面、联系人页、文件页、设置、托盘、通知、手动刷新。

当前唯一已知阻塞：**我们主动向 NWT 或飞秋发送文件时，对端停在“正在连接”，我方停在“等待对方接收”**。反向（NWT/飞秋发给我们）正常。详细任务见 `docs/TODO-file-send-compat.md`。

现象特征：

- 两个不同对端都在同一处失败，优先查入站 TCP 2425，不要先改报文头。
- 别人发给我们正常，说明出站 TCP 和接收端协议可用。
- 我们发给别人需要对方主动连接我们的 TCP 2425，当前很可能被监听地址、端口占用或防火墙拦住。

## 新环境准备

- Windows 10/11 x64，或 Linux ARM64。
- Node.js 24，pnpm 12.15.0（`packageManager` 已固定）。
- Electron 44.9.3，`node:sqlite`，不需要原生模块编译。
- 可选：Wireshark + Npcap（抓包）、Python + Pillow（重新生成图标/资产）。

```bash
git clone https://github.com/hllshiro/lanpost-im.git
cd lanpost-im
pnpm install
pnpm dev
```

只用 pnpm，不要混用 npm/yarn。`pnpm dev` 保留 Chromium 沙箱；只有 GPU/沙箱启动失败时才使用 `pnpm dev:no-sandbox`。不要用管理员终端启动开发版，Electron 44 在提权环境会出现 GPU/渲染进程启动失败。

## 常用命令

```bash
pnpm dev                         # 开发
pnpm dev:no-sandbox              # 仅 GPU/沙箱启动失败时
pnpm lint                        # ESLint
pnpm typecheck                   # node + web
pnpm test                        # Vitest 全量
pnpm build                       # typecheck + 写 out/
pnpm build:win                   # Windows x64 安装包/zip
pnpm build:linux                 # Linux ARM64 deb/AppImage
pnpm exec vitest run src/main/protocol/discovery.test.ts
pnpm exec vitest run src/main/files
```

不要直接运行 `tsc -p tsconfig.web.json`；必须使用脚本里的 `--composite false`，否则 `src/shared` 不在 web include 内会报 TS6307。

## 当前阻塞的排查顺序

1. 在运行我们客户端的机器上看 `startup.log`：
   - 是否有 `文件服务启动: TCP ...:2425`。
   - 发送失败后是否有 `收到取文件连接: IP:端口`。
   - 是否有 `file service start failed`。
2. 确认 TCP 2425 监听在 `0.0.0.0`，不能被 `127.0.0.1` 或另一个程序占用。
3. 从对端执行 `Test-NetConnection <本机IP> -Port 2425`。
4. 检查 Windows 防火墙/安全软件是否放行 `electron.exe`（开发版）或 `lanpost-im.exe`（安装版）的入站 TCP/UDP 2425。
5. 在客户端机器抓 `tcp port 2425 and host <对端IP>`，区分：
   - 没有 SYN：对端没有连过来，查对端使用的 IP、端口、路由或握手声明。
   - 有 SYN 没有 SYN-ACK：本机防火墙或安全软件拦截。
   - 有 SYN-ACK 没有 `GETFILEDATA`：对端在等待其他通道。
   - 有 `GETFILEDATA` 没有数据：查 packetId/fileId、32 位 seq 和服务端匹配。

建议的修复顺序：

1. P0：绑定地址、端口、防火墙、文件服务失败提示。
2. P1：发送前先登记 outgoing 任务；保持 TCP-only 握手；服务端兼容两种 `GETFILEDATA` 版本。
3. P2：增加 IPMSG 族头风格（standard/nwt/feiq），按对端选择拉取版本。
4. P3：跑完真实对端矩阵并更新抓包文档。

## 飞秋抓包结论

已抓到一次成功的飞秋→真实 NWT 文件传输（206,770 字节 JPG）：

```text
飞秋邀请：1_lbt80_0#131200#9262DDF58171#3415#33107#0#4000#9:1793023679:xqkj:DESKTOP-505STIV:2097440:<NUL>0:355f...jpg:0327b2:69fbeeb9:1:<BEL><NUL>
NWT 确认：1@shiyeline:16559:xqkj:DESKTOP-SM:33:1793023679<NUL>
NWT 拉取：1@shiyeline:16560:xqkj:DESKTOP-SM:96:6adf5ebf:0:0:
```

要点：

- 飞秋邀请有 `1_lbt80_0#...#9:` 外层头，标准字段在后面。
- NWT 拉取飞秋文件时使用 `1@shiyeline`，不是 `1`。
- 文件数据是 TCP 原始字节。
- 抓包文件在本机 `.tmp-feiq/feiq-nwt.pcapng`，没有提交仓库；新环境需要重新抓。

## 双实例验证

两个实例使用独立数据目录、不同端口和互相指向的种子：

```json
{
  "version": 1,
  "identity": {
    "displayName": "测试A",
    "account": "test-a",
    "hostName": "host-a"
  },
  "network": {
    "port": 24250,
    "bindAddr": "127.0.0.1",
    "seeds": ["127.0.0.1:24251"]
  },
  "files": {
    "receiveDir": "D:/tmp/lanpost-a/recv",
    "autoAccept": true,
    "autoAcceptMaxMB": 0
  }
}
```

另一个实例把端口改成 24251，种子指向 24250。分别设置 `LANPOST_DATA_DIR`，不要占用生产端口 2425。文件传输后用 SHA-256 对比源文件和接收文件。

本机回环抓包需要 Npcap 的 “Adapter for loopback traffic capture”；普通 WLAN 抓不到 127.0.0.1 流量。

## 数据目录与权限

- 正式：Windows `%APPDATA%\lanpost-im`，Linux `~/.config/lanpost-im`。
- 开发：`%APPDATA%\lanpost-im-dev`；不可写时回退仓库下 `.dev-data`。
- `LANPOST_DATA_DIR` 可覆盖整个数据目录。
- 默认接收目录 `Downloads\内网传书`，不可写时回退 `<userData>\recv`。
- 日志出现 `EPERM ... lanpost-im-dev`，是 Electron 进程被终端沙箱或安全软件拦住，不是 Windows 账户没有权限；换普通非提权终端或设置 `LANPOST_DATA_DIR`。换 Node 版本不能解决这类 ACL/令牌问题。
- 端口、监听地址、接收目录修改后需要重启。

## 功能边界

- 已实现：IPMSG 发现、文字、送达回执、TCP 文件收发、历史、设置、托盘、通知、联系人页、文件页、手动刷新。
- 未实现：私有 ENet 文件通道、群聊、共享文件柜、远程协助、离线消息、IPMSG 加密、文件夹传输、拒绝回传。
- 我们↔我们：文字和文件可用；我们↔NWT：文字可用，文件外发待修；我们↔飞秋：飞秋→我们可用，我们→飞秋待修。
- 第一版未发布，不为目录、产品名或设置字段变更写旧数据迁移。

## 发布与 CI

- `.github/workflows/build.yml`：Windows x64 + Linux ARM64，执行 typecheck、test、打包。
- 只有 `v*` 标签或手动 `workflow_dispatch` 才构建；Release 只在标签触发。
- 目前没有发布标签，也没有跑过完整 CI 发布链路。
- `electron-builder.yml` 还没有自动添加 Windows 防火墙规则，这是当前文件外发问题的一部分。

## 代码入口

- `src/main/protocol/`：IPMSG 头、发现、文字、私有 XML、GBK、附件表。
- `src/main/files/`：TCP 文件服务、拉取、任务匹配、状态。
- `src/main/app-service.ts`：协议、仓储、文件、通知的编排。
- `src/main/store/`：SQLite schema、仓储、旧历史导入。
- `src/shared/ipc.ts`、`domain.ts`、`settings.ts`：main/preload/renderer 契约。
- `src/renderer/src/`：Vue 3 + Pinia 界面。
- `src/main/index.ts`：窗口、托盘、数据目录、IPC 注册。

## 文档地图

- 项目约束和命令：`AGENTS.md`
- 当前文件外发修复计划：`docs/TODO-file-send-compat.md`
- 文件传输状态机：`docs/file-transfer.md`
- NWT/飞秋兼容矩阵：`docs/nwt-compatibility.md`
- 抓包和报文：`docs/protocol-debugging.md`
- IPMSG 标准：`docs/ipmsg-protocol-zh.md`
- 已知限制：`docs/known-limits.md`
- 设计基线：`docs/superpowers/specs/2026-10-23-electron-client-design.md`

## 注意

- 不提交 pcap、真实账号、主机名或聊天内容。
- 不用管理员权限启动开发版解决网络问题。
- 不在 P0 入站链路确认前改 NWT 标准邀请头。
- 不在私有 ENet 控制载荷未解密前广告 ENet 文件端口。
