# 开发交接与环境切换

更新：2026-11-12

当前仓库只支持内网通 NWT 私有协议，IPMSG、飞秋、飞鸽兼容层已移除。协议细节以 `docs/nwt-private-protocol.md`、`docs/nwt-file-channel.md`、`docs/nwt-compatibility.md` 和 `docs/known-limits.md` 为准。

## 当前状态

- 发现：UDP 9011 type 1 通告 / type 2 应答；广播不可达时用 `network.privateSeeds` 直连。
- 会话：ENet，默认 UDP 9012；TEA 加密应用帧，命令号 1000 起。
- 文字：`X_SEND_MSG(1004)`，1005 送达、1006 已读。
- 文件：TCP 9013，proto=1 的 HELLO/ACK/PATH/DATA；文件夹：TCP 9014，proto=2。
- 群聊、头像、图片、表情与富文本均已接入。
- 桌面集成：全局快捷键、开机启动、最小化启动、空闲自动离开、在线状态快捷切换、接收目录布局、防火墙检测与修复。

## 新环境准备

- Windows 10/11 x64，或 Linux x64/ARM64。
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
pnpm firewall:dev                # 开发版 Windows 防火墙放行
pnpm lint                        # ESLint
pnpm typecheck                   # node + web
pnpm test                        # Vitest 全量
pnpm build                       # typecheck + 写 out/
pnpm build:win                   # Windows x64 安装包/zip
pnpm build:linux                 # Linux x64/ARM64 deb/rpm/AppImage
pnpm exec vitest run src/main/protocol/private/service.test.ts
pnpm exec vitest run src/main/files
```

不要直接运行 `tsc -p tsconfig.web.json`；必须使用脚本里的 `--composite false`，否则 `src/shared` 不在 web include 内会报 TS6307。

## 排查顺序

1. 看 `startup.log`：私有服务是否启动、9011/9012/9013/9014 是否绑定、发现通告是否发送。
2. 确认 9011/UDP 通告能到达对端；广播不可达时在设置里填 `privateSeeds`。
3. 确认对端 ENet 端口来自通告或种子，不能写死 9012。
4. 文件/文件夹失败先查 9013/9014 TCP 入站规则和防火墙修复结果。
5. 抓包：`udp port 9011 or udp port 9012 or tcp port 9013 or tcp port 9014`。

## 两个实例联调

- 两个实例分别设置 `LANPOST_DATA_DIR`。
- 使用不同的 `network.privatePort` / `privateEnetPort` / `privateFilePort` / `privateFolderPort`。
- 在 `network.privateSeeds` 里互相写入 `IP` 或 `IP:ENet端口`。
- 文件传输后用 SHA-256 对比源文件和接收文件。

## 参考

- `docs/nwt-private-protocol.md`
- `docs/nwt-file-channel.md`
- `docs/nwt-group-protocol.md`
- `docs/nwt-compatibility.md`
- `docs/protocol-debugging.md`
- `docs/known-limits.md`
