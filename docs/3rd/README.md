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
- `docs/3rd/Orbit-beta/`：<https://github.com/D4niel-dev/Orbit-beta>，MIT，克隆自 `e947539`（2026-10-20，v0.9.0-beta）

`.gitignore` 已忽略以上目录。**不要把 BLIP 源码复制进本项目再分发**，GPL-3.0 会要求衍生作品同样开源。

## 结论摘要

不存在可以直接拿来替换本项目的完整项目。

- **BLIP** 是目前最接近“Web 技术 + 零服务器 + 功能丰富”的局域网 IM，群聊、文件、表情、回执、剪贴板、音视频都有实现。但它使用自有协议，不支持 IPMSG；GPL-3.0；群聊没有离线补发；UI 是像素风格、非 Vue。
- **LANChat** 的工程方向更贴近“轻量、跨平台、MIT、离线补发”，已经有可借鉴的发送方离线队列和 Web 端。但它是 Tauri + Rust + 原生 JS，没有 IPMSG，没有群聊，整体 UI/业务也比较简单。
- **Orbit-beta** 是三者中最接近“完整 IM”的产品：Electron + SQLite + MIT，群聊、角色、邀请码、表情回应、已读、Markdown、文件/图片、相册、搜索、E2EE、Android、测试都有。但它没有 IPMSG，桌面端没有持久化发送队列，群聊也没有离线历史同步。
- 三个项目都不解决本项目最关键的两件事：**IPMSG 兼容**和**群聊离线同步**。
- 建议继续当前 Electron + Vue + IPMSG 代码库，新增自有 P2P 协议，把这三个项目作为协议设计、群聊/离线队列/文件续传的参考，而不是整体 fork。

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

## Orbit-beta

### 基本信息

- 技术栈：Electron 32 + 原生 HTML/CSS/JavaScript；SQLite（better-sqlite3）
- 移动端：Capacitor Android，复用 `shared/` 协议、数据库、UI 模块
- 许可：MIT
- 版本：v0.9.0-beta（2026-10-20），有 Playwright E2E 和一组单元测试
- 目标：local-first、P2P、LAN-first、无云服务

### 网络与协议

- UDP 45678：组播 `224.0.0.251` 发现，5 秒一次 beacon
- TCP 46000：长度前缀 + JSON 包
- 包类型：`MESSAGE`、`TYPING`、`REACTION`、`MESSAGE_EDIT/DELETE`、`READ/READ_RECEIPT`、群组 `GROUP_CREATE/JOIN/LEAVE/MEMBER_ADDED/OWNER_TRANSFER`、文件分块、`CALL_*`、E2EE 密钥交换、账号迁移
- 文件：64 KB 分块，`FILE_TRANSFER_RESUME` 带已收块数和部分文件 SHA-256，支持续传
- E2EE：DM 可选 ECDH + AES-256-GCM
- 发现和连接层没有 IPMSG 兼容

### 功能完整度

已经具备：

- 单聊、群聊、群角色（Owner/Admin/Member）、邀请码、群头像、群公告
- 消息回应、编辑、删除、置顶、已读回执、输入状态
- Markdown、代码高亮、链接预览、表情面板、语音消息、图片/视频/文件
- 全局相册、聊天搜索（SQLite FTS5）、活动中心、未读角标
- 主题/自定义颜色、聊天背景、字体、紧凑模式
- 备份/恢复、账号迁移、QR 配对、Android App
- 桌面托盘、通知、自动更新、测试体系

### 群聊与离线行为

- 群消息由发送方对成员逐个 `networkSend`，没有消息 ACK 和群历史同步
- 群成员变更依靠 `GROUP_CREATE/JOIN_REQUEST/JOIN_RESPONSE/MEMBER_ADDED/OWNER_TRANSFER` 广播
- 桌面端没有持久化 outbox：只有连接建立过程中的内存 pending 队列；对端离线时消息不会落库等待
- Android 端有 `mobile/src/js/components/outbox.js`：localStorage 持久化、15 秒重试、7 天过期、最多 500 条，只缓存真实消息内容，不缓存 typing/reaction/call
- 群聊没有“成员上线后补齐历史”的机制，和 BLIP 一样只覆盖在线成员

### 可借鉴

- 群角色、邀请码、Owner 转移、成员变更广播的产品模型
- 文件 64 KB 分块 + 前缀哈希续传
- Android outbox 的“先入队再尝试发送”、过期/上限、待发送气泡状态
- 端到端加密作为可选功能，而不是默认阻断
- SQLite FTS5 搜索、相册、活动中心、备份恢复
- Playwright E2E 的测试组织方式

### 不适合直接采用

- 没有 IPMSG 兼容，仍需单独写兼容层
- 原生 JS + Electron 32 + better-sqlite3，和当前 Electron 44 + Vue + `node:sqlite` 差异大
- 桌面端没有持久化离线队列，群聊没有离线同步
- UI 是 Discord/现代 IM 风格，不是当前微信风格
- 直接 fork 会同时承担陌生代码库、原生模块构建、Android 工程和后续上游合并

## 对比

| 需求 | 当前项目 | BLIP | LANChat | Orbit-beta |
| --- | --- | --- | --- | --- |
| 零服务器 | 是 | 是 | 桌面端是；Web 端需要本地服务 | 是 |
| Web 技术 | Electron + Vue | Electron + 原生 JS | Tauri + 原生 JS | Electron + 原生 JS |
| IPMSG 文本/文件 | 已有 | 无 | 无 | 无 |
| 群聊 | 无 | 有，在线成员 | 无 | 有，在线成员 |
| 群聊离线补发 | 无 | 无 | 无 | 无 |
| 单聊离线队列 | 无 | 无 | 有，发送方队列 | 桌面无；Android 有 outbox |
| 文件传输 | 已有 | 有，分块 | 有，分块 | 有，分块+续传 |
| 音视频 | 无 | 有 | 无 | 有（通话/语音消息） |
| 许可 | 未声明 | GPL-3.0 | MIT | MIT |
| 代码/社区成熟度 | 新项目 | 中，个人项目 | 中，个人项目 | 较高，beta 但功能/测试最完整 |

## 基于 Orbit 增加 IPMSG 通道的可行性

结论：**技术上可行，而且接入点比较干净；但这是“换底座”，不是给当前项目加一个适配器。工作量中等偏大，是否划算取决于对 Orbit UI 和现有功能的接受程度。**

### 可行的接入方式

Orbit 已经有明确的主进程边界：

```text
desktop/main.js
  ├─ Discovery（UDP 45678）
  ├─ SocketManager（TCP 46000）
  ├─ TransferManager（文件分块）
  ├─ SQLite（friends / messages / groups / attachments）
  └─ preload.js → renderer
```

可以并列增加一个 IPMSG transport：

```text
desktop/lib/ipmsg/
  ├─ engine.ts/engine.js      # 复用当前项目的 IPMSG 核心
  ├─ files.ts/files.js        # 复用当前项目的 IPMSG 文件收发
  └─ bridge.js                # IPMSG 事件 → Orbit 主进程事件
```

- IPMSG 使用 UDP/TCP 2425，Orbit 使用 45678/46000，端口不冲突。
- IPMSG 联系人作为 `friends` 记录写入，`userId` 使用类似 `ipmsg:<ip>|<account>` 的稳定键。
- IPMSG 文本转换成 `MESSAGE` 包，交给 Orbit 的 `store.handleIncomingPacket` 或一个 transport-neutral 的消息服务。
- 发送时由主进程按联系人 `transport` 路由：Orbit 联系人走 `SocketManager`，IPMSG 联系人走 IPMSG。
- 文件：Orbit 联系人走 `TransferManager`，IPMSG 联系人走现有 `FileManager`；两边都写入同一个 `attachments`/消息记录。
- 状态：IPMSG 的 0/1/2 映射到 Orbit 的在线/忙碌/离开；IPMSG 在线状态作为 Orbit 的一个 presence source。
- 身份合并：Orbit BEACON 可以额外携带 IPMSG 身份码，IPMSG Entry 已经携带身份码；两边都存在时按身份码合并，否则保留 `ipmsg:<ip>|<account>` 独立联系人。

### 需要改造的地方

1. **数据模型**
   - `friends` 增加 `transport`、`ipmsgAccount`、`ipmsgIdentityId`、`lastIp` 等字段。
   - `messages` 增加 `transport`、`remoteSeq`、`remoteId`、`deliveredAt` 等字段。
   - 现有 Orbit 的 `chatId` 继续复用：Orbit 联系人用 userId，IPMSG 联系人用 `ipmsg:...`。

2. **收发路由**
   - `networkSend` 增加 transport 选择，或在主进程内部按 `toPeerId` 前缀路由。
   - IPMSG 文本/文件进入 Orbit 的消息表和 UI。
   - IPMSG 不支持 typing/reaction/read receipt/群邀请，IPMSG 联系人要隐藏或禁用这些入口。
   - 文件传输 UI 需要统一 Orbit 的 `transfer-progress` 和 IPMSG 的进度事件。

3. **联系人和群**
   - Orbit 群成员只接受 Orbit 联系人；IPMSG 联系人先按单聊处理，避免“群消息退化成多条私聊”的语义混乱。
   - 若必须把 IPMSG 联系人加入群，需要定义群消息的 fan-out 规则和成员能力标记。

4. **现有功能迁移**
   - 当前项目的目录传输、身份码、快捷键、开机启动、状态自动离开、第三方客户端识别、设置缓存等，Orbit 并非全部具备，需要逐项补。
   - Orbit 没有中文界面，只有消息翻译功能；要么接受英文 UI，要么做一轮完整 i18n。
   - Orbit 的 UI 是 Discord 风格，不是当前微信风格。

5. **数据迁移**
   - 当前项目 SQLite schema 4 → Orbit 的 `friends/messages/groups/attachments` 需要写一次性导入。
   - 会话、消息、文件路径、联系人备注、置顶、草稿等要映射，否则老用户升级后历史丢失。

6. **构建与依赖**
   - Orbit 使用 Electron 32 + better-sqlite3 原生模块；当前项目是 Electron 44 + `node:sqlite`。
   - 迁到 Orbit 需要重新处理 Windows/Linux/ARM64 原生模块、rpm 打包和 CI。
   - Orbit 有 Android/Capacitor 工程；如果保留 Android，IPMSG 只能在桌面端实现，移动端需要另写 Java 插件或不支持 IPMSG。

### 关键判断

如果满足以下条件，Orbit 底座值得认真考虑：

- 能接受 Orbit 的 Discord 风格 UI，或愿意投入一轮完整 UI/i18n 改造；
- 更看重群聊、角色、邀请码、回应、已读、Markdown、相册、搜索、E2EE、Android 等现成功能；
- 接受维护一个约 10 万行、原生 JS + better-sqlite3 的 fork；
- 愿意承担当前项目已有功能的迁移和数据迁移。

如果以下条件更重要，则继续当前项目更划算：

- 必须保留微信风格和中文界面；
- 当前 IPMSG、目录传输、设置、发布链路已经稳定；
- 只缺群聊和离线队列，而这两个本来就要自己设计；
- 希望代码库小、可维护、测试可控。

### 建议的验证方式

不要直接决定全量迁移，先做一个限时 spike：

1. 在 Orbit 分支增加一个最小 IPMSG transport：UDP 2425 发现、双向文本、单文件传输。
2. 把 IPMSG 联系人写入 Orbit 的 `friends`，在联系人和聊天列表里显示。
3. 文本/文件进入 Orbit 的 SQLite 和消息 UI。
4. 验证 Orbit 的 UI、消息模型、文件进度和现有功能是否能承载 IPMSG 语义。
5. 记录改造点数、代码冲突点、构建/打包问题，再决定是否全量切换。

如果 spike 表明“UI 和数据模型不用大改”，Orbit 底座可行；如果一开始就发现群聊、消息模型、i18n 和迁移要重写，那就回到当前项目，只移植 Orbit 的局部实现。

## 最小 IPMSG 兼容的复杂度

把 IPMSG 范围收缩到“用户发现 + 点对点文本 + 文件传送”后，协议层本身不难，因为当前项目已经实现了这套核心，可以抽成独立模块复用。真正的复杂度转移到 Orbit 的数据/UI 适配。

| 工作项 | 复杂度 | 说明 |
| --- | --- | --- |
| IPMSG 发现、文本、文件协议 | 低 | 复用当前 `engine` + `FileManager`，去掉目录、图片、密封、广播等分支 |
| Orbit 主进程挂第二个 transport | 中 | UDP 2425 与 Orbit 45678 不冲突；新增 IPMSG 模块和 IPC 事件 |
| 联系人模型 | 中 | Orbit `friends` 增加 `transport`/`ipmsgAccount`/`lastIp`；IPMSG 联系人用 `ipmsg:<ip>|<account>` |
| 消息模型 | 中 | 复用 Orbit `messages`/`chatId`，增加 `transport`、`remoteSeq`、`remoteId`；文本可直接映射 |
| 文件传输适配 | 中偏高 | Orbit 的 transfer 事件和 IPMSG 的 FileManager 进度/状态要统一；附件表和下载路径要对接 |
| 能力降级 UI | 低 | IPMSG 联系人隐藏 typing/reaction/read receipt/群邀请/编辑 |
| 联系人合并 | 低到中 | 第一阶段可以不复用旧项目”；IPMSG 联系人按独立联系人处理，避免双通道去重复杂化 |
| 旧数据迁移 | 中 | 若 Orbit 是升级而非新装，需要把当前 schema 4 的会话/消息/文件导入 Orbit |
| 中文化和微信风格 UI | 高 | Orbit 目前是英文 Discord 风格；如果坚持微信风格，这部分会抵消复用收益 |
| Android 上的 IPMSG | 高 | Node 的 UDP/TCP 不能直接在 Capacitor WebView 跑，需要 Java 插件；建议桌面优先 |

**当前确认的范围（2026-10-27）：**

- 以 Orbit 桌面端为底座，保留 Orbit 自己的 UI
- 不做双通道联系人合并
- 不做旧数据迁移
- 不做 Android，移除/不构建 Capacitor 端
- IPMSG 只做用户发现、1:1 文本、文件传送；IPMSG 联系人不进群
- 群聊和群聊离线仍使用 Orbit 自己的协议模型

在这个范围内，IPMSG 协议层可以复用当前项目的核心，主要工作变成 Orbit 主进程适配、联系人/消息字段和文件传输 UI 对接；整体复杂度为中低，适合先做限时 spike。

**判断：**

- 只做桌面端、只做 IPMSG 1:1、接受 Orbit UI、暂不迁移旧数据：复杂度从“高”降到“中等”，值得做一个 spike。
- 仍要保留当前微信 UI、中文、旧数据和 Android：复杂度仍然很高，继续当前项目更划算。
- 最小 spike 可以只验证：IPMSG 联系人出现在 Orbit 列表、双向文本、单文件双向传输、Orbit↔Orbit 原有功能不受影响。

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
