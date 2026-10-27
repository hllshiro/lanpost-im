# 第三方局域网 IM 项目调研

调研日期：2026-10-27

目标是评估能否直接复用成熟开源项目，减少继续开发的工作量。约束条件：

- 纯局域网、零服务器
- 必须使用 Web 前端技术（Electron / Tauri / 浏览器）
- 保留 IPMSG 基础兼容：双向文本 + 文件传输
- 不需要音视频和远程控制

## 本地代码位置

第三方源码只用于本地调研，不提交到本仓库：

- `docs/3rd/blip/`：<https://github.com/krwg/blip>，GPL-3.0，浅克隆自 `a2f49a8`（2026-07-28）
- `docs/3rd/LANChat/`：<https://github.com/cap153/LANChat>，MIT，浅克隆自 `95a645c`（2026-09-11）

`.gitignore` 已忽略以上目录。**不要把 BLIP 源码复制进本项目再分发**，GPL-3.0 会要求衍生作品同样开源。

## 结论摘要

不存在可以直接拿来替换本项目的完整项目。

- **BLIP** 是目前最接近“Web 技术 + 零服务器 + 功能丰富”的局域网 IM，群聊、文件、表情、回执、剪贴板、音视频都有实现。但它使用自有协议，不支持 IPMSG；GPL-3.0；群聊没有离线补发；UI 是像素风格、非 Vue。
- **LANChat** 的工程方向更贴近“轻量、跨平台、MIT、离线补发”，已经有可借鉴的发送方离线队列和 Web 端。但它是 Tauri + Rust + 原生 JS，没有 IPMSG，没有群聊，整体 UI/业务也比较简单。
- 两者都不解决本项目最关键的两件事：**IPMSG 兼容**和**群聊离线同步**。
- 建议继续当前 Electron + Vue + IPMSG 代码库，新增自有 P2P 协议，把这两个项目作为协议设计、WebRTC/群聊/离线队列的参考，而不是整体 fork。

## BLIP

### 基本信息

- 技术栈：Electron 35 + Vite 6 + 原生 JavaScript + CSS
- 后端：Electron 主进程，Node.js
- 许可：GPL-3.0
- 社区：约 11 star，1 fork（页面数据），代码库 196 个提交
- 本地版本：`package.json` 为 2.0.5，README 主线仍在开发 2.0.0 Morse

### 网络与协议

- UDP 42069：广播/组播发现，payload 包含 BLIP ID、昵称、presence、TCP/UDP 端口
- mDNS：`_blip._udp.local` 作为发现兜底
- TCP 42070：换行分隔 JSON
- WebRTC：1:1 和群组音视频、屏幕共享，信令走同一条 TCP 连接
- 身份：BLIP ID 1–64（8×8 网格），不是 UUID
- 安全：Ed25519 签名公告 + X25519 + AES-256-GCM 会话；TOFU 信任

TCP 消息类型包括：

```text
message / receipt / reaction / typing / ping / pong
call-* / group-call-*
group-invite / group-invite-ack / group-msg / group-host / group-sync
group-leave / group-disband
file-offer / file-chunk / file-done / file-abort
clipboard-push / mesh-proj-pad / seed-*
```

### 群聊与离线行为

群聊核心在 `renderer/groups.js`、`renderer/groups-wire.js`、`renderer/group-chat.js`：

- 群有 `groupId`、`hostId`、成员列表、文本频道和语音频道
- 发消息时由发送方向所有成员逐个 TCP 发送 `group-msg`
- 接收方校验 `msg.from` 与 TCP 连接身份一致
- `group-sync` 只同步群成员/host 信息，不同步历史消息
- host 掉线后由成员选举新 host

**没有离线群消息补发**。成员离线时，这条 `group-msg` 不会进入任何持久化队列，也不会在成员上线后重发。BLIP 的聊天历史只在各端本地 `localStorage` 中。

### 文件传输

- 单聊小文件：`message.attachment` 内嵌 data URL（≤768 KB）
- 单聊大文件：`file-offer` → `file-chunk` × N → `file-done`
- 群聊大文件：对每个成员分别发起 `file-offer`/分块传输
- 另有 BEACON：局域网种子文件库，支持多 peer 下载

### 可借鉴

- TCP 上的 JSON 消息封套、ACK/回执、reaction、typing 等消息类型划分
- 群聊的 host + 成员列表 + `group-msg` 广播模型
- 文件分块、断点/暂停、传输速度、拖放和剪贴板粘贴
- WebRTC 信令复用 TCP 通道的结构（虽然当前不做音视频）
- 托盘、开机启动、全局快捷键、自动更新、主题/i18n 的产品化细节

### 不适合直接采用

- GPL-3.0，闭源或商业分发会被传染
- 自定义协议，不兼容飞秋/IPMSG/内网通
- 群成员上限 64、8×8 ID 网格，和现有身份码体系冲突
- 群聊没有离线补发，和本项目需要的能力不一致
- 原生 JS + 像素 UI，和当前 Vue/微信风格差距大，替换 UI 等于重做
- 代码量和功能面远大于当前需求，裁剪成本高

## LANChat

### 基本信息

- 技术栈：Tauri 2 + Rust 后端 + 原生 HTML/CSS/JavaScript
- 平台：Linux、Windows、Android、Web（Axum 静态+WebSocket 服务）
- 许可：MIT
- 社区：约 107 star，16 fork，约 180 个提交
- 本地版本：`Cargo.toml` 为 0.1.5

### 网络与协议

- UDP 广播/组播发现，默认端口 8888；支持手动添加 IP/域名/端口
- TCP/WebSocket：文本消息、JSON 自定义消息
- HTTP 分块上传：大文件传输
- SQLite：消息、用户、配置、文件状态
- Web 端：`lanchat-web` 二进制启动 Axum 服务，浏览器访问

### 离线消息实现

这是 LANChat 最值得借鉴的部分：

1. 发送时如果对端离线，消息以 `status = 'pending'` 写入 SQLite。
2. 发送失败也立即标记对端离线，并把消息改成 `pending`。
3. 发现模块收到心跳、判断用户“新上线/重新上线”时，触发 `resend_pending_messages`。
4. 先握手，再按时间顺序补发 pending 文本/文件。
5. 补发成功后把消息标记为 `sent`。

实现比较轻：

- 只有发送方本地队列，没有服务端或第三方节点缓存
- 没有严格的消息 ACK/去重，补发成功与否主要看 TCP/HTTP 调用是否成功
- 文件补发依赖接收方 `auto_download` 设置
- 群聊尚未实现，因此没有群聊离线同步

### 可借鉴

- `pending` 消息 + 用户重新上线触发补发的整体思路
- 手动发现（IP/域名/端口）和心跳自动回复，适合跨 VLAN/WireGuard
- SQLite 消息表把 `status`、文件路径、文件大小放在一起
- 单文件同时支持桌面和 Web（Axum）的工程结构
- MIT 许可，若未来需要参考代码，法律风险低于 BLIP

### 不适合直接采用

- Tauri + Rust 技术栈，和当前 Electron + TypeScript 后端差异大，迁移成本高
- 原生 JS 前端，没有 Vue/Pinia，UI 和状态管理要重做
- 没有 IPMSG，也没有群聊
- Web 端需要运行一个本地/独立 HTTP 服务，和“纯 P2P 零服务端”的直觉不完全一致
- 消息协议较简单，缺少 ACK、去重、版本协商、群组状态机

## 对比

| 需求 | 当前项目 | BLIP | LANChat |
| --- | --- | --- | --- |
| 零服务器 | 是 | 是 | 桌面端是；Web 端需要本地服务 |
| Web 技术 | Electron + Vue | Electron + 原生 JS | Tauri + 原生 JS |
| IPMSG 文本/文件 | 已有 | 无 | 无 |
| 群聊 | 无 | 有，在线成员 | 无 |
| 群聊离线补发 | 无 | 无 | 无 |
| 单聊离线队列 | 无 | 无 | 有，发送方队列 |
| 文件传输 | 已有 | 有，分块 | 有，分块 |
| 音视频 | 无 | 有 | 无 |
| 许可 | 未声明 | GPL-3.0 | MIT |
| 代码/社区成熟度 | 新项目 | 中，个人项目 | 中，个人项目 |

## 对群聊离线消息的建议

结合当前约束，建议采用“发送方队列 + 上线同步”的 A 方案，不引入服务端或复杂 gossip：

1. 每条消息使用稳定 ID：`senderIdentityId + senderSeq`（发送方单调递增）。
2. 本地为每个群保存所有收到的消息，并记录每个发送方已收到的最大 `seq`。
3. 群消息发送时给每个在线成员发一份，并等待 ACK；未 ACK 的成员记录为 pending。
4. 任意成员上线时，双方交换群成员和每个发送方的 `lastSeq`；各自补发对方缺失且自己持有的消息。
5. 发送方本地保留自己的群消息；发送方离线期间造成的缺口，等发送方上线后由它补发。
6. 如果发送方永远不回来，且没有其他成员缓存该消息，则该消息无法补达——这是零服务器 A 方案的明确边界。
7. 群成员变更用 `groupId + version + host/owner` 管理；变更先写本地，再在成员上线时同步，冲突用版本号 + LWW 处理。
8. 后续再决定是否让所有成员互相缓存群消息，以提升“发送方离线”时的可恢复性；这会增加存储和一致性复杂度。

这条路线不需要 BLIP 的 host 选举和群语音，也不需要 LANChat 的 Tauri 后端；可以直接在当前 SQLite/协议层上实现。

## 下一步

1. 明确 lanpost 自有协议的第一版范围：群聊、单聊离线队列、消息 ACK/去重、成员同步。
2. 决定群消息是否采用“所有成员缓存”作为第二阶段能力。
3. 写协议设计文档，再拆实施计划；不直接改代码。
