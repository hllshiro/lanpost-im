# IM Agent Gateway（Agent 接入）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **修订 2026-11-26（第 3 版）：** ① 增加最小认证：RPC 用 `rpc-websockets` 内建的 `setAuth`/`rpc.login` + `.protected()`，图片 HTTP 用 `Authorization: Bearer`，令牌随设置保存、可在设置页重新生成；② 相关设置全部放在「设置 → 网络 → RPC」分组，网络分类本身默认隐藏（连点设置按钮 5 次解锁），因此 RPC 设置默认不可见；③ 计划按「服务端（本项目）」与「客户端（对方）」两部分组织；④ 传输用 `rpc-websockets@10.0.1`，图片二进制走同一 https server 的 `/media` HTTP 路由（不再开第二条 WebSocket）。

**Goal:** 在 lanpost-im 的 Electron 主进程内嵌一个带最小认证的 WebSocket 网关（默认 `wss://127.0.0.1:8443/ws/dsh`），让 AI agent（DSH Channel Plugin）用令牌登录后查询联系人、按用户号或群号发文字/图片、订阅入站消息与投递状态；网关以本机内网通账号身份收发，agent 发出的消息在聊天界面正常可见。

**Architecture:** 新增 `src/main/gateway/` 模块，只依赖 `node:https`、`rpc-websockets`、`node:sqlite`、`node:crypto` 与 shared 纯逻辑，不 import `electron`，可被 Vitest 直接测试。业务动作经 `GatewayBridge` 接口回调 `AppService`，复用现有会话/消息仓储与 `PrivateService`；入站消息、投递 ACK、失败在 `AppService` 现有回调里转发给网关。事件持久化在同一个 SQLite（schema 升到 7），网关负责序列、ACK、补发与附件落盘，不持有业务真相。认证令牌由客户端调用 `rpc.login` 提交，服务端只比对设置里的令牌；媒体请求用同一个令牌的 Bearer 头。

**Tech Stack:** Electron 44 主进程（Node 24）、TypeScript 5.9、`rpc-websockets@10.0.1`（自带类型，依赖 `ws@8`）、`node:https`/`node:crypto`/`node:sqlite`、Vitest（Node 侧）、Vue 3 设置页。

**Spec:** 附件《IM 与 DSH Channel Plugin 接入开发指南》第一部分（IM 服务端）与第二部分（Channel Plugin 客户端）。附件只读副本：`C:\Users\xqkj\.dsh\attachments\v1\files\82\8276071cffd5baa02372521b102fcdb21beab73e6b40b13d67d5be6d53bcae73\writing-block.md`。

**对外契约：** [`docs/gateway-api.md`](../../gateway-api.md)（v1.0，已先行落地）；本计划与它冲突时以文档为准，并回改本计划。客户端（对方）按该文档并行开发。

## 前置事实（已勘察，2026-11-26）

- 仓库没有任何服务端/Gateway 代码，也没有 `rpc-websockets`/`ws` 依赖；需 `pnpm add rpc-websockets@^10.0.1`（自带类型，`ws` 随依赖安装，不需要单独 `@types/ws`）。
- `peers.key` 在 v5 迁移后就是 32 位十六进制私有用户号（`src/main/store/peer-keys.ts:35-42` 的 `migratePeerKeys` 把 `key` 改成 `user`）；`src/shared/private-id.ts` 的 `isPrivateUserId` 是判定函数。会话 `id` 形如 `direct:<peerKey>`、`group:<groupId>`。
- `PrivateService` 已提供 `peerIpByUserId(userId)`、`isReady(ip)`、`sendText`、`sendGroupMessage`、`sendImageCard`、`sendGroupImage`、`sendReceipt`；协议栈无 Electron 依赖。
- 发送文字已有离线排队：`AppService.sendText`（`src/main/app-service.ts:1979`）在非就绪时写 `queued`，`handlePrivateReady` → `flushQueuedMessages`（`src/main/app-service.ts:4817`）在对端上线后补发；这就是本项目对「离线消息」的既有语义（`docs/nwt-feature-inventory.md:428`）。
- 图片走 TCP 文件通道：入站 `handlePrivateText` → `requestImages` → 文件落盘 → `handlePrivateFileDone`（`src/main/app-service.ts:5147`）；出站 `sendPrivateImages`（`src/main/app-service.ts:3617`，当前返回 `void`）与 `sendGroupImages`（`src/main/app-service.ts:3401`）。
- 群成员用私有用户号标识：`this.repos.groups.members(groupId)`（`src/main/app-service.ts:2056`），发送时逐个成员按 `service.peerIpByUserId(member.userId)` 找 IP。
- 数据库：`SCHEMA_VERSION = 6`（`src/main/store/schema.ts:1`），`openDatabase` 在版本更高时直接拒绝；新增表必须走 `SCHEMA_SQL` + 版本号自增。
- 设置：`src/shared/settings.ts` 的 zod schema（`networkSchema` :21-32，`settingsSchema` :89-99，`SettingsPatch` :102-104，`defaultSettings` :106）；`mergeSettings` 对 record 递归合并（`src/shared/settings-merge.ts:8-24`）；`AppService.applySettings`（`src/main/app-service.ts:3797`）是运行时应用入口。
- 设置页隐藏机制：`NavRail.vue:25` 两秒内连点设置按钮 5 次 → `App.vue:253` 的 `networkUnlocked = true` → `SettingsOverlay.vue:44-49` 的 prop → `:56-71` 的 `categories` 过滤掉 `network`。网络分类默认不可见，解锁后才有；因此 RPC 分组不需要新开关。
- 设置页结构：`saveField(section, patch)`（`SettingsOverlay.vue:328-330`）→ `pushPatch`（`:300-326`）调 `window.api.settings.update`；网络区块在 `:688-813`，样式类 `.group/.row/.row-text/.label/.restart/.hint/.control/.input/.textarea/.note`，已有 `ToggleSwitch.vue`。
- 主进程 IPC：`src/main/ipc/app-ipc.ts` 的 `registerAppIpc(service)` 逐条映射，可直接加网关状态/换令牌；新增 IPC 必须同时改 `src/shared/ipc.ts` 的 `IPC` 与 `Api`、`src/preload/index.ts`、`app-ipc.ts` 与渲染进程调用方。
- 基线：56 个 `*.test.ts`；验证顺序 `pnpm lint` → `pnpm typecheck` → `pnpm test`；`pnpm test` 在本沙箱里会因 vite 的 `spawn EPERM` 起不来（harness 禁止管道子进程），这不是用例失败，必要时单独跑 `pnpm exec vitest run <file>` 或依赖 CI。

## 设计决策（含理由）

1. **RPC 传输用 `rpc-websockets@10.0.1`。** 方法注册、参数解析、连接与请求分发、认证钩子由库负责（`Server.register/event/setAuth`、`createError`），网关只写业务 handler；客户端侧 `Client.call/login/subscribe/on` 与附件示例一致。代价是绑定其版本与 `ws` 传递依赖，计划锁 `^10.0.1`。注意 v10 的命名空间取 WebSocket URL 的 pathname（连 `/ws/dsh` 即命名空间 `/ws/dsh`），`register/event/setAuth` 必须显式传该 ns；事件只发给先 `rpc.on` 订阅过的连接，服务端用 `server.of(ns).emit(event, params)` 推送，`server.emit` 只是本地事件。
2. **最小认证启用。** `setAuth` 实际上就是库内建的 `rpc.login` 方法（`setAuth(fn)` = `register('rpc.login', fn)`）：客户端 `client.login({ token })`，服务端严格返回 `true` 才把该 socket 标为已认证；所有业务方法与两个事件都 `.protected()`，未认证调用得到库的 `-32605`，未认证订阅受保护事件得到 `-32606`。图片 HTTP 走 `Authorization: Bearer <token>`。不引入用户体系、不做多账号；一个网关一个令牌。理由：`127.0.0.1` 只能挡住外部网络，挡不住本机其它进程；令牌成本约 30 行，且与 DSH 插件“每次打开都先 login”的契约一致。
3. **设置放「设置 → 网络 → RPC」，默认不可见。** 复用现有隐藏机制：网络分类只有连点设置按钮 5 次解锁后才出现，重启恢复隐藏；RPC 作为 network 段内的新分组，自然继承隐藏。配置存在 `settings.json` 的 `network.rpc`，由主进程读取，不进渲染进程本地存储。
4. **图片走同一个 https server 的 `/media` HTTP 路由**，不再开第二条 WebSocket：上传 `POST /media`（原始字节 + `x-transfer-id`/`x-sha256`），下载 `GET /media/<attachment_id>`，两者都校验 Bearer。理由：rpc-websockets 只处理 JSON 帧，单独开二进制 WS 要再写一套状态机；HTTP 路由约 80 行、超时与上限由 `https` 层直接控制，测试也简单。
5. **网关跑在 Electron 主进程内，不做独立进程。** 复用 `PrivateService`、仓储与设置；可用性跟随客户端，需在设置页显式开启。
6. **业务写入复用现有仓储。** agent 发出的消息和普通人发的消息在 UI、历史、撤回、搜索里一致；网关只额外记 `gateway_messages` 做 ACK 映射与幂等。
7. **`protocol_id` 即私有用户号（32 位十六进制）。** 没握过手、没有用户号的联系人无法被 agent 定向发送，`users.list` 直接过滤掉。
8. **事件先落库再推送。** `gateway_events` 自增 `sequence` 即全局单调序号；`events.ack` 前不删除；`events.resume {last_sequence}` 在结果里返回未确认事件数组（不再重推一遍通知，避免重复），游标早于保留窗口返回 `-32020`。多客户端共享同一 ACK 游标——本机场景单 agent，够用，文档写明。
9. **离线语义照实说明。** 一对一文字沿用本机 `queued` 队列，对端上线补发；群消息 v1 只投当前在线成员；图片对离线对端排队、`peer-ready` 后重试（最多 3 次，间隔 30 秒）。
10. **安全默认值：** 只监听 `127.0.0.1`；RPC 帧上限 1 MiB、文本 16 KiB、图片 10 MiB；只接受 png/jpeg/webp/gif（按魔数，不看扩展名），v1 拒绝 SVG；附件按 `attachment_id` 存盘，文件名不参与路径；令牌不回显在日志里。

## Wire Protocol（对外契约）

### 端点

| 项 | 值 |
| --- | --- |
| RPC | `wss://<host>:<port>/ws/dsh`（rpc-websockets，JSON-RPC 2.0） |
| 图片上传 | `POST https://<host>:<port>/media`，需 `Authorization: Bearer <token>` |
| 图片下载 | `GET https://<host>:<port>/media/<attachment_id>`，需同一 Bearer |
| 默认监听 | `127.0.0.1:8443`，可在「设置 → 网络 → RPC」改端口/监听地址 |
| 协议版本 | `"1.0"`（出现在 `events.resume` 与文档里，不做握手） |
| 认证 | RPC：`client.login({ token })`；媒体：`Authorization: Bearer <token>`；令牌在设置页生成/重新生成 |

### 认证流程

1. 客户端建立 WebSocket → 调用 `rpc.login`，参数 `{ "token": "<43 字符 base64url>" }`；服务端用恒定时间比较，返回 `true` 才标记已认证。
2. 认证成功后，客户端用 `rpc.on` 订阅 `["message.received", "message.deliveryStatus"]`，再调用 `events.resume` 补发。
3. 令牌错误/缺失：`rpc.login` 返回 `false`；未认证调用受保护方法得到 `-32605`，订阅受保护事件得到 `-32606`。客户端应把 login 返回 `false` 当作认证失败并停止重试，避免锁死。
4. 令牌轮换：设置页点「重新生成」→ 服务端换令牌并关闭所有现有连接（4401），客户端需重新登录。
5. 令牌只出现在 login 参数和 Authorization 头；服务端日志、错误信息、`GatewayStatus` 都不含令牌。

### RPC 方法（全部 `.protected()`，命名空间 `/ws/dsh`）

- `users.list` `{keyword?, online?: boolean|null, page?: number, page_size?: number}` → `{total, page, page_size, users: [{protocol_id, username, display_name, hostname, online, last_seen_at}]}`；`page` 从 1 开始，`page_size` 默认 50、上限 200；`last_seen_at` 为 ISO 8601 UTC 字符串。
- `message.sendUser` `{request_id, protocol_id, content}` → `{message_id, accepted: true, delivery_status: "queued"}`。
- `message.sendGroup` `{request_id, group_id, content}` → 同上。
- `media.prepareUpload` `{mime_type, name, size, sha256}` → `{transfer_id, max_bytes, expires_at}`。
- `events.ack` `{event_id, sequence}` → `{acked: true, latest_sequence}`。
- `events.resume` `{last_sequence}` → `{events: [{event_id, sequence, method, data}], latest_sequence}`；游标过期 `-32020`；完整示例见 `docs/gateway-api.md` 4.6。

`content` 两种形态：

```json
{ "type": "text", "text": "…" }
{ "type": "image", "attachment_id": "att_…", "mime_type": "image/png", "name": "a.png", "size": 12345, "sha256": "…" }
```

### 事件（`server.of('/ws/dsh').emit(event, params)` → 仅发给先 `subscribe` 的连接）

通知的 `params` 就是下面这个对象（`events.resume` 的数组元素结构相同）：

```json
{ "event_id": "evt_…", "sequence": 42, "method": "message.received",
  "data": { "message_id": "im:123", "conversation_id": "direct:<peerKey>",
    "conversation_type": "private", "sender": { "protocol_id": "…", "username": "…",
    "display_name": "…", "hostname": "…" }, "group_id": null,
    "content": { "type": "text", "text": "hi" }, "timestamp": "2026-11-26T02:00:00.000Z" } }
```

`message.deliveryStatus` 的 `data`：`{message_id, conversation_id, status: "queued"|"delivered"|"failed", reason?, timestamp}`。一对一群消息的 `delivered` 以至少一个成员发送成功为准；`queued` 表示已入本机队列。

### 图片 HTTP 路由（两个都需要 Bearer）

- `POST /media`：头 `authorization`、`content-type: image/png|jpeg|webp|gif`、`content-length`、`x-transfer-id`、`x-sha256`、`x-name`（URI 编码）；body 为原始字节。校验：Bearer 正确；`transfer_id` 存在于 `gateway_attachments` 且 `state='pending'`；`size` 与 `content-length` 一致且 ≤ `max_image_bytes`；SHA-256 与魔数匹配。成功 `200 {"attachment_id":"att_…"}`；认证失败 `401 {"code":-32001,"message":"UNAUTHORIZED"}`；其它失败 `4xx {"code":-3201x,"message":"…"}`。超时/超限由 `req` 直接中断。
- `GET /media/<attachment_id>`：返回原始字节，头带 `content-type`、`content-length`、`x-sha256`；未认证 `401`；附件不存在或已过期 `404`。
- 上传超过 60 秒未完成在 cleanup 里清掉；下载不缓存（`cache-control: no-store`）。

### 错误码（handler 抛普通对象 `{ code, message, data }`，不可抛 `Error` 实例）

rpc-websockets 会把 `Error` 实例统一包成 `-32603`（`message` 取 `error.name`、`data` 取 `error.message`）；普通对象则原样透传，所以网关自定义错误码必须抛普通对象。认证失败由库产生：未认证调用 `-32605`、未认证订阅事件 `-32606`、`rpc.login` 缺参数 `-32604`。

| code | 名称 | 触发 |
| --- | --- | --- |
| -32001 | UNAUTHORIZED | `/media` 缺 Bearer 或令牌不符 |
| -32003 | INTERNAL_ERROR | 未预期异常 |
| -32010 | INVALID_ARGUMENT | 参数缺失/类型错 |
| -32011 | USER_NOT_FOUND | protocol_id 不在名册 |
| -32012 | GROUP_NOT_FOUND | group_id 不存在 |
| -32013 | MESSAGE_TOO_LARGE | 文本 > 16 KiB 或图片 > max_bytes |
| -32014 | UNSUPPORTED_CONTENT_TYPE | 非 png/jpeg/webp/gif 或 SVG |
| -32015 | RATE_LIMITED | 保留（v1 不启用限流） |
| -32016 | ATTACHMENT_NOT_FOUND | attachment_id 不存在/已过期/已消费 |
| -32017 | IMAGE_HASH_MISMATCH | SHA-256 不符 |
| -32018 | IMAGE_FORMAT_INVALID | 魔数与声明类型不符 |
| -32019 | TRANSFER_TIMEOUT | 上传超时（HTTP 侧直接 4xx/关闭，保留码位） |
| -32020 | EVENT_CURSOR_EXPIRED | `events.resume` 游标早于保留窗口 |
| -32021 | DUPLICATE_REQUEST | 同 `request_id` 不同内容 |

## 设置与界面位置

`src/shared/settings.ts` 的 `networkSchema` 追加：

```ts
const rpcSchema = z.object({
  enabled: z.boolean().default(false),
  bindAddr: z.string().default('127.0.0.1'),
  port: z.number().int().min(1).max(65535).default(8443),
  token: z.string().default('')
})
```

即 `settings.network.rpc = { enabled, bindAddr, port, token }`。`enabled` 默认 `false`；`token` 默认空，首次开启时由主进程自动生成并写回设置；`bindAddr` 默认 `127.0.0.1`（默认不可从局域网访问）。

界面：`SettingsOverlay.vue` 的 network 分区（`:688-813`）末尾、私有通道说明之后，加一个 `.group`「RPC」：

- 开关「启用 RPC 网关」（`ToggleSwitch`）；
- 监听地址输入（默认 `127.0.0.1`，提示「0.0.0.0 会暴露给局域网」）；
- 端口输入（默认 8443，1–65535）；
- 令牌只读输入框 + 「复制」+「重新生成」（重新生成后立即断开现有连接）；
- 运行状态行：`运行中 wss://127.0.0.1:8443/ws/dsh` 或 `未运行` / `错误：…`，显示证书指纹前 16 位；
- 说明文字：默认关闭；令牌等同密码，不要贴到聊天或日志；网络分类默认隐藏，连点设置按钮 5 次解锁。

## 数据模型（SCHEMA_VERSION 7）

追加到 `src/main/store/schema.ts` 的 `SCHEMA_SQL`：

```sql
CREATE TABLE IF NOT EXISTS gateway_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  method TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  acked_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS gateway_requests (
  request_id TEXT PRIMARY KEY,
  method TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gateway_attachments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,               -- upload | inbound
  mime_type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  path TEXT NOT NULL,
  transfer_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,              -- pending | ready | consumed
  message_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gateway_attachments_transfer
  ON gateway_attachments(transfer_id);

CREATE TABLE IF NOT EXISTS gateway_messages (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,          -- out | in
  conversation_type TEXT NOT NULL,  -- private | group
  conversation_id TEXT NOT NULL,
  protocol_id TEXT NOT NULL DEFAULT '',
  group_id TEXT NOT NULL DEFAULT '',
  im_message_id INTEGER NOT NULL DEFAULT 0,
  nwt_msg_id INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,             -- queued | delivered | failed
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gateway_messages_lookup
  ON gateway_messages(conversation_id, nwt_msg_id);
```

保留策略：已 ACK 事件保留 24 小时后清理；未 ACK 事件保留 `eventRetentionHours`（默认 168）后标记过期并清理，`events.resume` 游标低于最小保留序号返回 `-32020`；`gateway_requests` 保留 24 小时；`gateway_attachments` 中 `pending` 30 分钟过期、`inbound` 在事件 ACK 24 小时后删除、`upload` 在消息发出 24 小时后删除。清理在网关内每小时执行一次，纯函数 `planCleanup(now)` 可单测。

## 模块结构

```text
src/main/gateway/
  protocol.ts        端点、方法名、事件名、错误码、限额、版本常量
  errors.ts          GwError 与 toRpcError()（转成普通对象 {code,message,data}）
  auth.ts            createRpcToken / verifyRpcToken / checkBearer（恒定时间比较）
  tls.ts             证书加载与自签生成、指纹
  store.ts           gateway_* 表的读写（注入 DatabaseSync）
  events.ts          事件追加、ACK、补发窗口、清理
  users.ts           名册映射、搜索、分页
  attachments.ts     附件落盘、魔数、SHA-256、过期清理
  media.ts           /media 上传/下载 HTTP 路由（含 Bearer 校验，node:https 回调）
  pump.ts            通知串行队列（按 sequence 逐条 server.of(ns).emit）
  bridge.ts          GatewayBridge 接口与事件类型（不 import electron）
  messages.ts        发送、幂等、投递状态与入站事件组装
  lifecycle.ts       decideGatewayRestart(prev, next) 纯函数
  server.ts          https + rpc-websockets 装配、setAuth、生命周期
  index.ts           对外导出
  *.test.ts          只测纯模块（server.test.ts 例外：随机端口 + 真 TLS）
src/main/gateway-bridge.ts   AppService 侧的 GatewayBridge 适配器（可拆出降低 app-service 体积）
```

`server.ts` 是唯一 import `node:https` 与 `rpc-websockets` 的文件；`pump.ts`/`media.ts` 只消费回调，便于单测。

## Global Constraints

- 测试策略（按用户 2026-11-26 决定）：只为纯逻辑写最少必要单测——令牌/附件校验/事件序列/幂等/生命周期，约 5 个测试文件；装配、连接、UI 与业务链路以实机和 `scripts/gateway-smoke.mjs` 验证，不追求覆盖率与用例数量。
- 验证顺序固定：`pnpm lint` → `pnpm typecheck` → `pnpm test`；不新增与实现同规模的测试套件。
- 不改 `package.json` 版本号；`CHANGELOG.md` 只加 `[未发布]` 段。
- 不引入原生模块；新增唯一生产依赖是 `rpc-websockets`（纯 JS，锁 `^10.0.1`）。
- 所有网关模块不得 import `electron`；Electron 接线只放在 `app-service.ts`、`ipc/app-ipc.ts`、`index.ts`、`SettingsOverlay.vue`。
- 注释用中文，术语保留英文；提交信息中文，形如 `feat: xxx`。
- 共享类型（IPC/设置/网关状态）放 `src/shared/`，主进程与渲染进程都从那里 import，禁止两边各写一份。
- 测试用临时目录（`mkdtemp` + `afterEach` 的 `rmSync(..., { recursive: true, force: true, maxRetries: 5 })`）；协议测试用随机高端口，禁止占用 9011/9012/9013/9014 与 8443。
- 测试替身只允许“可控的假 bridge / 假 http 请求对象”（`implements GatewayBridge`），不 mock 生产模块的私有实现。
- 新增 IPC 必须同时改 `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/app-ipc.ts` 与调用方（`SettingsOverlay.vue`）。
- 令牌不得出现在日志、错误信息、测试快照或 git 提交里；测试用固定假令牌 `test-token-…`。

## Review Focus

1. **认证不可绕过**：全部业务方法与两个事件 `.protected()`；`/media` 上传与下载都校验 Bearer；未认证时只能调用 `rpc.login`——Task 9 集成测试覆盖（未登录调 `users.list` 得 `-32605`、未登录 `POST /media` 得 401、事件在未认证连接上收不到）。
2. **断线重连不重复、不丢事件**：重连后重新 login + subscribe，再调 `events.resume`；只返回未 ACK 事件；服务端不因重连重置 `sequence`——Task 5 的 `events.test.ts` 与 Task 9 集成测试覆盖。
3. **ACK 时序**：图片事件在插件落盘之后才 `events.ack`；服务端在 ACK 前不得删附件——Task 8 与清理函数测试覆盖。
4. **离线投递**：目标离线时 `message.sendUser` 仍返回 `queued`，对端 ready 后由既有 `flushQueuedMessages` 补发并产生 `delivered`——Task 6 用假 bridge 事件序列验证。
5. **幂等**：同 `request_id` 同内容返回原结果、不重发；不同内容返回 `-32021`——Task 6。
6. **令牌生命周期**：首次开启自动生成；重新生成后旧令牌立即失效且现有连接被断开——Task 11 与 Task 12 手工验证。
7. **群发送**：群成员按私有用户号逐个投递，不在线的跳过；没有可达成员时仍 `accepted` 但状态 `failed` 并带原因——Task 7。
8. **端口与防火墙**：启用时把网关端口加入 `firewallPorts().tcp`，关闭时不加；改端口重启网关实例——Task 11。

---

# 第一部分：服务端（本项目）

## Task 1: 依赖、常量、认证工具与设置项

**Files:**
- Modify: `package.json`、`pnpm-lock.yaml`（`rpc-websockets`）
- Create: `src/main/gateway/protocol.ts`、`src/main/gateway/errors.ts`、`src/main/gateway/auth.ts`
- Create: `src/main/gateway/errors.test.ts`、`src/main/gateway/auth.test.ts`
- Modify: `src/shared/settings.ts`、`src/main/settings/store.test.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: 无。
- Produces:
  - `PROTOCOL_VERSION = '1.0'`、`RPC_PATH = '/ws/dsh'`、`MEDIA_PATH = '/media'`、`DEFAULT_RPC_PORT = 8443`、`DEFAULT_RPC_BIND = '127.0.0.1'`、`MAX_RPC_BYTES = 1024 * 1024`、`MAX_IMAGE_BYTES = 10 * 1024 * 1024`、`MAX_TEXT_BYTES = 16 * 1024`。
  - `GW_METHODS = { usersList: 'users.list', sendUser: 'message.sendUser', sendGroup: 'message.sendGroup', prepareUpload: 'media.prepareUpload', eventsAck: 'events.ack', eventsResume: 'events.resume' } as const`；`GW_EVENTS = ['message.received', 'message.deliveryStatus'] as const`。
  - `GwErrorName` 与 `GW_ERRORS: Record<GwErrorName, { code: number; message: string }>`（覆盖上表全部错误码，含 `UNAUTHORIZED`）。
  - `interface RpcErrorObject { code: number; message: string; data?: unknown }`；`class GwError extends Error { constructor(rpcCode: number, message: string, rpcData?: unknown) }`、`toRpcError(err: unknown): RpcErrorObject`（`GwError` 映射为对应码，未知异常 → `-32003`；handler 必须 `throw toRpcError(e)`，因为直接抛 `Error` 会被库统一包成 `-32603`）。
  - `createRpcToken(): string`（`randomBytes(32).toString('base64url')`，43 字符）；`verifyRpcToken(expected: string, params: unknown): boolean`（`params` 为对象且 `token` 为非空字符串，SHA-256 后 `timingSafeEqual`，`expected` 为空时恒 `false`）；`checkBearer(expected: string, authorization: string | undefined): boolean`（解析 `Bearer <token>`，大小写不敏感）；`constantTimeEqual(a: string, b: string): boolean`。
  - `settingsSchema.network.rpc = { enabled: false, bindAddr: '127.0.0.1', port: 8443, token: '' }`；导出类型 `RpcSettings`。

- [ ] **Step 1: 装依赖**
  `pnpm add rpc-websockets@^10.0.1`，确认 `pnpm-lock.yaml` 只多这一个直接依赖（`ws` 为其传递依赖）。

- [ ] **Step 2: 写失败的测试**
  `errors.test.ts`：`new GwError(-32011, 'x')` → `toRpcError` 返回普通对象且 `code/message` 正确；`new Error('boom')` → `-32003`；普通对象/字符串输入也被包成 `-32003`；返回值不能是 `Error` 实例。
  `auth.test.ts`：`createRpcToken()` 长度 43 且两次不同；`verifyRpcToken(t, {token:t})` 真、错误 token 假、缺 token 假、`params` 非对象假、`expected === ''` 假；`checkBearer` 接受 `Bearer x`/`bearer x`、拒绝空/`Basic`。

- [ ] **Step 3: 跑测试确认失败**
  `pnpm exec vitest run src/main/gateway/errors.test.ts src/main/gateway/auth.test.ts` → FAIL（模块不存在）。

- [ ] **Step 4: 实现 `protocol.ts`、`errors.ts`、`auth.ts`**
  纯函数，无 I/O；不 import `electron`。

- [ ] **Step 5: 设置 schema 与测试**
  `store.test.ts` 追加：`settings.network.rpc` 默认值全量断言；`port` 越界被 zod 拒绝（1–65535）；`bindAddr` 只校验非空字符串（IP 合法性运行时报错）；部分配置合并时 `network` 其它字段不丢；`token` 默认为空字符串。

- [ ] **Step 6: 全量验证并提交**
  `pnpm lint && pnpm typecheck && pnpm exec vitest run src/main/gateway/*.test.ts src/main/settings/store.test.ts`；`git commit -m "feat: 网关依赖、协议常量和最小认证工具"`。

---

## Task 2: 数据库 schema v7 与网关存储层

**Files:**
- Modify: `src/main/store/schema.ts`、`src/main/store/db.test.ts`
- Create: `src/main/gateway/store.ts`、`src/main/gateway/store.test.ts`

**Interfaces:**
- Consumes: `openDatabase`（`src/main/store/db.ts`）。
- Produces `GatewayStore`（注入 `DatabaseSync`）：
  - `appendEvent(input: { eventId; method; payload; createdAt }): number`（返回 sequence）
  - `pendingEvents(afterSequence): GatewayEventRow[]`、`ackedEvent(eventId): GatewayEventRow | null`
  - `ackEvent(eventId, sequence, at): number`（返回最新 sequence）
  - `minSequence(): number | null`、`latestSequence(): number`
  - `findRequest(requestId): GatewayRequestRow | null`、`saveRequest(row)`
  - `insertAttachment(row)`、`attachment(id)`、`attachmentByTransfer(transferId)`、`markAttachmentConsumed(id, messageId)`、`attachmentsForCleanup(now): GatewayAttachmentRow[]`、`deleteAttachment(id)`
  - `insertMessage(row)`、`messageById(id)`、`messageByNwt(conversationId, nwtMsgId)`、`setMessageStatus(id, status, at)`、`pendingMessages(protocolId)`

- [ ] **Step 1: 写失败的 schema 测试**
  `db.test.ts` 追加：新建内存库后 `PRAGMA user_version === 7`；四张 `gateway_*` 表存在；重复 `openDatabase` 不报错；`gateway_events.sequence` 自增且重启后继续（用临时文件库验证）。

- [ ] **Step 2: 跑测试确认失败**
  `pnpm exec vitest run src/main/store/db.test.ts` → FAIL。

- [ ] **Step 3: 追加 DDL 与版本号**
  `SCHEMA_VERSION = 7`，DDL 按上文原样加入；不写数据迁移代码（已有表结构不变）。

- [ ] **Step 4: 实现 `GatewayStore` 并补仓储测试**
  用 `mkdtemp` 临时库；覆盖 append/ack/补发窗口、请求幂等读写、附件状态迁移与 transfer 反查、消息按 `(conversation_id, nwt_msg_id)` 反查。

- [ ] **Step 5: 全量验证并提交**
  `pnpm lint && pnpm typecheck && pnpm exec vitest run src/main/gateway/store.test.ts src/main/store/db.test.ts`；`git commit -m "feat: 网关数据表与存储层"`。

---

## Task 3: TLS 证书（自签与文件两种模式）

**Files:**
- Create: `src/main/gateway/tls.ts`、`src/main/gateway/tls.test.ts`

**Interfaces:**
- Produces:
  - `interface TlsMaterial { key: string; cert: string; fingerprint: string }`
  - `loadTlsMaterial(input: { mode: 'self-signed'|'files'; dir: string; certPath?: string; keyPath?: string; now?: () => number }): Promise<TlsMaterial>`
  - 自签：RSA-2048、SHA-256、有效期 825 天、SAN 含 `DNS:localhost`、`DNS:<os.hostname()>`、`IP:127.0.0.1`、`IP:::1` 与本机全部 IPv4；写到 `<dir>/tls/cert.pem`、`<dir>/tls/key.pem`（`mode 0o600`），已存在且未过期（剩余 > 7 天）直接复用。
  - 文件模式：读取 PEM，用 `new X509Certificate(cert)` 与 `createPrivateKey(key)` 校验匹配，失败抛 `证书与私钥不匹配`。
  - `fingerprint` 为证书 DER 的 `sha256` 十六进制（冒号分隔大写）。
  - 证书过期或 SAN 不含本机当前 IPv4 时重新生成（自签模式）。

- [ ] **Step 1: 写失败测试**：`X509Certificate` 解析生成证书、`checkHost('127.0.0.1')`/`checkHost('localhost')` 通过、`checkPrivateKey` 匹配、文件权限 `0o600`、文件模式不匹配抛错、残留过期证书会重生成（注入 `now`）。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/tls.test.ts`。
- [ ] **Step 3: 实现 `tls.ts`**（手写最小 DER 编码器；只覆盖本证书所需的 ASN.1 结构）。若自签在 Node 24 上出现编码问题，退路是改用 `selfsigned`（纯 JS）并把决策写进计划附录，不引原生模块。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关自签证书与指纹"`。

---

## Task 4: 附件存储与 `/media` HTTP 路由（Bearer 认证）

**Files:**
- Create: `src/main/gateway/attachments.ts`、`src/main/gateway/media.ts`
- Create: `src/main/gateway/attachments.test.ts`、`src/main/gateway/media.test.ts`

**Interfaces:**
- Produces `attachments.ts`：
  - `sniffImage(buf: Buffer): { mime: string; ext: 'png'|'jpg'|'webp'|'gif' } | null`（魔数：PNG `89 50 4E 47`、JPEG `FF D8 FF`、GIF `GIF8`、WEBP `RIFF....WEBP`）
  - `isAllowedImageMime(mime): boolean`（`image/png|jpeg|webp|gif`）
  - `class AttachmentStore { constructor(store, dir); prepare(meta): { transferId; expiresAt }; acceptUpload(transferId, buf, declared: { mimeType; sha256 }): { attachmentId }; importInbound(input: { path; name; mimeType; size; sha256 }): { attachmentId }; openDownload(attachmentId): { path; size; sha256; mimeType; name }; consume(attachmentId, messageId); cleanup(now) }`
  - 文件存 `<dir>/att/<attachmentId>.bin`，路径不含用户文件名；写盘后 `fsync` 再更新状态为 `ready`。
- Produces `media.ts`：
  - `handleMediaRequest(req, res, ctx: { attachments; maxImageBytes; expectedToken: string; onLog? }): Promise<void>`；非 `/media` 路径返回 404 交给调用方（`server.ts` 里只在 `url.pathname` 命中时调用）。
  - 先校验 `authorization`，失败 `401 {"code":-32001,"message":"UNAUTHORIZED"}` 并结束，`req` 不再读取 body。
  - 上传：读 `x-transfer-id`/`x-sha256`/`x-name`，边收边累计 `size`，超限立即 `413` 并 `req.destroy()`；收满后 `acceptUpload`，成功 `200 {"attachment_id"}`。
  - 下载：校验 `attachment_id` 正则 `^att_[A-Za-z0-9_-]{8,}$`，流式 `createReadStream`，`404` 不存在；`cache-control: no-store`。
  - 60 秒超时由 `server.ts` 的 `req.setTimeout(60_000, () => req.destroy())` 控制。
- 令牌比较必须用 `auth.ts` 的 `checkBearer`，禁止字符串 `===`。

- [ ] **Step 1: 写失败测试**：魔数识别（含伪装扩展名）、SVG 被判非法、`7 MiB` 通过 `11 MiB` 拒绝（上限可注入）、SHA 不符、transfer 不存在、upload 后 state=`ready`、download 的 `content-type/sha256` 头、路径穿越 id 返回 404、无 Bearer/错 Bearer 上传与下载都 401。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/attachments.test.ts src/main/gateway/media.test.ts`（media 测试直接构造假 `req`/`res`，不依赖 TLS）。
- [ ] **Step 3: 实现两个模块**，`media.ts` 不 import `rpc-websockets`。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关附件与带认证的图片 HTTP 通道"`。

---

## Task 5: 事件持久化与补发

**Files:**
- Create: `src/main/gateway/events.ts`、`src/main/gateway/events.test.ts`

**Interfaces:**
- Produces:
  - `interface GwEvent { eventId: string; sequence: number; method: string; data: Record<string, unknown> }`
  - `class EventLog { constructor(store, opts: { retentionHours: number; now?: () => number }); append(method, data): GwEvent; pending(afterSequence): GwEvent[]; ack(eventId, sequence): number; resume(lastSequence): { events: GwEvent[]; latestSequence: number; expired: boolean }; cleanup(now): { removed: number } }`
  - `eventId = 'evt_' + crypto.randomUUID()`；落库与推送使用同一个信封 `{ event_id, sequence, method, data }`（即 `docs/gateway-api.md` 5.1）；`sequence` 由 `appendEvent` 返回后回填（一次事务：先插入占位再更新 `payload`，或显式写入 `sequence`，测试固定行为）。

- [ ] **Step 1: 写失败测试**：序列单调递增且跨重启继续；`pending` 只返回未 ACK 且 `> afterSequence` 的事件；`ack` 幂等（重复 ack 不改变结果）；`resume` 返回数组且数量正确；游标早于最小保留序号返回 `expired: true`；清理只删已 ACK 且超 24h 的事件。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/events.test.ts`。
- [ ] **Step 3: 实现 `events.ts`**。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关事件日志与补发"`。

---

## Task 6: `users.list`、`message.sendUser`、幂等与投递状态

**Files:**
- Create: `src/main/gateway/users.ts`、`src/main/gateway/users.test.ts`
- Create: `src/main/gateway/messages.ts`、`src/main/gateway/messages.test.ts`

**Interfaces:**
- Produces `users.ts`：
  - `listUsers(bridge, params): { total; page; page_size; users: [...] }`；`keyword` 对 `displayName/username/hostname` 做大小写不敏感子串匹配；`online` 三态；排序 online desc、lastSeen desc；`username = peer.username`，`protocol_id = peer.protocolId`；`last_seen_at` 转 ISO。
  - `requirePeer(bridge, protocolId)` 抛 `-32011`。
- Produces `messages.ts`：
  - `class MessageSender { constructor(bridge, store, events, now?); sendUser(params): Promise<SendUserResult>; sendGroup(params): Promise<SendUserResult>; onBridgeEvent(event): void }`
  - 幂等：先按 `request_id` 查 `gateway_requests`，命中且 `args_hash` 相同→返回原结果；不同→`-32021`；未命中→执行→落 `result`（事务）。
  - 发送成功：写 `gateway_messages`（`status` 取 bridge 返回的 `queued|sending|sent`，后者统一映射事件状态 `queued`），返回 `{message_id: 'im:<imMessageId>', accepted: true, delivery_status: 'queued'}`；文本 `Buffer.byteLength(text) > MAX_TEXT_BYTES` 抛 `-32013`。
  - `onBridgeEvent` 的 `delivered`/`failed`：按 `(conversationId, nwtMsgId)` 找 `gateway_messages`，更新状态并 `events.append('message.deliveryStatus', data)`；`text-in` 组装 `message.received`；同一条入站消息只发一次（`gateway_messages` 以 `im:<id>` 去重）。`image-in` 在 Task 8 接入。

- [ ] **Step 1: 写失败测试**：`users.list` 分页/过滤/离线包含/无用户号排除/非法 page；`sendUser` 在线与离线返回值；重复 request_id 同内容返回同 `message_id` 且 bridge 只调用一次；不同内容 `-32021`；文本超长 `-32013`；`delivered` 事件把 `queued` 改为 `delivered`；重复投递事件不重复推送。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/users.test.ts src/main/gateway/messages.test.ts`。
- [ ] **Step 3: 实现两个模块**。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关用户查询与一对一消息"`。

---

## Task 7: `message.sendGroup`

**Files:**
- Modify: `src/main/gateway/messages.ts`、`src/main/gateway/messages.test.ts`
- Modify: `src/main/gateway-bridge.ts`、`src/main/app-service.ts`（群发送返回值）

**Interfaces:**
- `sendGroup({request_id, group_id, content})`：`getGroup` 为空 → `-32012`；文字走 `bridge.sendGroupText`；图片走 `bridge.sendGroupImage`（Task 8）。
- 状态：bridge 返回 `sent` → 事件状态 `delivered`（至少一个在线成员已接受）；`queued` → `queued`；无成员可达 → `failed`，原因 `群成员都不在线`（沿用现有中文错误信息）。
- `gateway_messages.conversation_type = 'group'`，`conversation_id = 'group:<groupId>'`。

- [ ] **Step 1: 写失败测试**：群不存在 `-32012`；在线成员投递后的事件状态 → `delivered`；全离线 → 事件状态 `failed` 且 `reason` 非空（RPC 响应仍为 `queued`）；幂等与 Task 6 一致。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/messages.test.ts`。
- [ ] **Step 3: 实现群发送**；`AppService.sendGroupText` 改为返回 `GatewaySendResult`（内部仍走 `sendGroupMessage`），保持 `sendText` 对群会话的 UI 行为。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关群消息发送"`。

---

## Task 8: 图片：`media.prepareUpload`、发送与入站图片

**Files:**
- Modify: `src/main/gateway/messages.ts`、`src/main/gateway/server.ts`
- Modify: `src/main/gateway-bridge.ts`、`src/main/app-service.ts`（`sendPrivateImages`/`sendGroupImages` 返回 `MessageInfo`；入站图片事件带附件）
- Modify: `src/main/gateway/messages.test.ts`、`src/main/gateway/server.test.ts`

**Interfaces:**
- `media.prepareUpload`：校验 `mime_type` 在允许列表、`size ≤ maxImageBytes`、`sha256` 为 64 位 hex；生成 `transfer_id = 'tr_' + uuid` 记入附件表（`kind='upload'`, `state='pending'`），返回 `{transfer_id, max_bytes, expires_at}`（30 分钟）。
- `message.sendUser` 的 `content.type === 'image'`：按 `attachmentId` 取附件，校验 `state='ready'`、`mime/size/sha256` 与内容一致；调 `bridge.sendPrivateImage`；成功后 `consume`。对端离线时 bridge 返回 `queued`，附件保持 `ready`，`gateway_messages.status='queued'`；`peer-ready` 事件重试排队中的图片（最多 3 次，间隔 30 秒，超过置 `failed`）。
- 入站图片：`image-in` bridge 事件 → `importInbound` 复制文件到附件目录 → `message.received` 只带 `attachment_id` 与元数据（`transfer_id` 不出现在事件里）；插件通过 `GET /media/<id>` 下载；`events.ack` 后 24 小时清理。
- 重连补发时复用同一 `attachment_id`。

- [ ] **Step 1: 写失败测试**：准备上传参数校验（非法 mime/尺寸/哈希）；上传响应携带 `attachment_id`；未 ACK 前附件不可删；入站图片事件携带 `attachment_id`；下载 200/404；离线图片 `queued` 后 `peer-ready` 重试一次成功；重试 3 次后 `failed`。
- [ ] **Step 2: 跑测试确认失败**。
- [ ] **Step 3: 实现**。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关图片通道与离线重试"`。

---

## Task 9: https + rpc-websockets 装配（含认证）与集成测试

**Files:**
- Create: `src/main/gateway/pump.ts`、`src/main/gateway/server.ts`、`src/main/gateway/index.ts`
- Create: `src/main/gateway/server.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GatewayServerOptions {
    db: DatabaseSync
    bridge: GatewayBridge
    dataDir: string
    tls: { mode: 'self-signed' | 'files'; certPath?: string; keyPath?: string }
    host: string
    port: number
    token: string
    maxImageBytes?: number
    eventRetentionHours?: number
    onLog?: (message: string, detail?: Record<string, unknown>) => void
  }
  export class GatewayServer {
    constructor(options: GatewayServerOptions)
    start(): Promise<{ url: string; fingerprint: string; port: number }>
    stop(): Promise<void>
    setToken(token: string): void              // 换令牌并断开现有连接（4401）
    status(): { running: boolean; port: number; url: string; fingerprint: string; lastError: string; clients: number }
  }
  ```
- 装配：`https.createServer({ key, cert }, (req, res) => { if (isMediaPath(req.url)) void handleMediaRequest(req, res, { attachments, maxImageBytes, expectedToken: this.token }); else { res.writeHead(404).end(); } })`；`new Server({ server: httpsServer, path: RPC_PATH, maxPayload: MAX_RPC_BYTES })`。
- 认证：`server.setAuth(async (params) => verifyRpcToken(this.token, params), RPC_PATH)`；逐条 `server.register(GW_METHODS.x, handler, RPC_PATH).protected()`；`server.event('message.received', RPC_PATH).protected()`、`server.event('message.deliveryStatus', RPC_PATH).protected()`。v10 命名空间取连接 URL 的 pathname，必须与 `RPC_PATH` 一致，否则方法不可见。
- 推送：`GatewayServer` 向 `MessageSender` 注入 `publish = (event, params) => pump.push(event, params)`，pump 内 `server.of(RPC_PATH).emit(event, params)`；pump 串行，保证按 sequence 顺序发出；发送失败只记日志（未订阅连接静默跳过，补发靠 `events.resume`，不要在这里重试）。
- 端口 0 表示随机端口（测试用）；`start` 失败必须清理已绑定的 listener 并把错误写进 `status().lastError`；`stop` 先 `server.close()`（rpc-websockets）再 `httpsServer.close()`。
- 连接上限 8（可配置），`server.on('connection', (socket) => ...)` 计数并 `socket.close(4409)`（v10 已确认该事件参数为 socket 与 `IncomingMessage`）。
- `setToken` 同时更新内存令牌与 `httpsServer` media 回调读取的 `expectedToken`，并遍历 `server.wss.clients` 逐个 `close(4401, 'token rotated')`。

- [ ] **Step 1: 写集成测试**（`server.test.ts`，随机端口、自签证书、`rpc-websockets` Client `rejectUnauthorized: false`、假 bridge、固定测试令牌）：
  1) 启动/停止/再启动；2) 未 login 调 `users.list` 得到 `-32605`；3) `client.login({ token })` 返回 `true`，业务方法可用；错误令牌 login 返回 `false`；4) `message.sendUser` 返回 `queued`；客户端先 `client.subscribe('message.received')`，再断言 `client.on('message.received')` 收到事件（未订阅收不到，测试一并验证）；5) `events.resume` 返回事件数组；6) `POST /media` 无 Bearer → 401、带 `Bearer <token>` 上传 1×1 PNG（内存生成）→ 得 `attachment_id`，`GET /media/<id>` 原样取回；7) `setToken` 后旧客户端被断开，新令牌 login 成功。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/server.test.ts`。
- [ ] **Step 3: 实现装配**。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 带认证的网关 https 与 rpc-websockets 服务"`。

---

## Task 10: GatewayBridge 与 AppService 适配（名册 + 一对一文字）

**Files:**
- Create: `src/main/gateway/bridge.ts`、`src/main/gateway-bridge.ts`
- Modify: `src/main/app-service.ts`（实现接口、入站与投递钩子、`flushQueuedMessages` 后发 `peer-ready`）
- Create: `src/main/gateway-bridge.test.ts`（用假 `PrivateService` 风格的依赖，不 import electron）

**Interfaces:**
- Produces `bridge.ts`：
  ```ts
  export interface GatewayPeer { protocolId: string; username: string; displayName: string; hostname: string; online: boolean; lastSeenAt: number }
  export interface GatewayGroup { id: string; name: string; members: Array<{ protocolId: string; name: string }> }
  export interface GatewaySendResult { imMessageId: number; nwtMsgId: number; status: 'queued'|'sending'|'sent'|'failed' }
  export type GatewayBridgeEvent =
    | { kind: 'text-in'; imMessageId: number; conversationId: string; conversationType: 'private'|'group'; sender: GatewaySender; text: string; timestamp: number }
    | { kind: 'image-in'; imMessageId: number; conversationId: string; conversationType: 'private'|'group'; sender: GatewaySender; path: string; name: string; mimeType: string; size: number; sha256: string; timestamp: number }
    | { kind: 'delivered'; conversationId: string; nwtMsgId: number }
    | { kind: 'failed'; conversationId: string; nwtMsgId: number; reason: string }
    | { kind: 'peer-ready'; protocolId: string }
  export interface GatewayBridge {
    listPeers(query: { keyword?: string; online?: boolean|null; page: number; pageSize: number }): { total: number; peers: GatewayPeer[] }
    getPeer(protocolId: string): GatewayPeer | null
    listGroups(): GatewayGroup[]
    getGroup(groupId: string): GatewayGroup | null
    sendPrivateText(protocolId: string, text: string): Promise<GatewaySendResult>
    sendGroupText(groupId: string, text: string): Promise<GatewaySendResult>
    sendPrivateImage(protocolId: string, path: string, name: string, mimeType: string): Promise<GatewaySendResult>
    sendGroupImage(groupId: string, path: string, name: string, mimeType: string): Promise<GatewaySendResult>
    subscribe(listener: (event: GatewayBridgeEvent) => void): () => void
  }
  ```
- Produces `gateway-bridge.ts`：`class AppServiceBridge implements GatewayBridge`，依赖 `{ peers, conversations, groups, messages, privateService, privateFiles, settings }` 的最小接口注入，便于单测。
- `app-service.ts` 的改动：实现/持有 bridge；在 `handlePrivateText`、`handleGroupMessage`、`handlePrivateFileDone`（入站图片）、`handlePrivateStatus`、`failPrivateSend`/`handlePrivateSendFailed`、`handlePrivateReady` 处发对应事件；新增 `gatewayBridge()` 供 `GatewayServer` 使用。所有 bridge 事件都做 try/catch，网关异常不得影响正常收发。

- [ ] **Step 1: 写失败的 bridge 测试**：名册映射（有用户号才返回、`alias || name`、`lastSeen` 透传）；一对一发送在线/离线两种结果；文字入站事件字段；投递 ACK 事件；`subscribe` 退订后不再收到。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway-bridge.test.ts`。
- [ ] **Step 3: 实现 bridge + app-service 钩子**；`sendPrivateText` 复用 `sendText` 的写库/排队逻辑（抽 `sendPrivateTextTo(conversationId, text)`，`sendText` 改为调用它，保持 UI 行为不变）。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关业务桥接与一对一文字"`。

---

## Task 11: 生命周期、令牌生成/轮换与防火墙

**Files:**
- Create: `src/main/gateway/lifecycle.ts`、`src/main/gateway/lifecycle.test.ts`
- Modify: `src/main/app-service.ts`（`start`/`stop`/`applySettings`、`firewallPorts`、`ensureRpcToken`、`rotateRpcToken`、`gatewayStatus`）
- Modify: `src/main/index.ts`（无需新逻辑，确认 `appService.stop()` 覆盖网关）

**Interfaces:**
- `decideGatewayRestart(prev: RpcSettings | null, next: RpcSettings): 'noop' | 'start' | 'stop' | 'restart'`（比较 `enabled/bindAddr/port`；`token` 变化不算重启，走 `setToken`）。
- `AppService` 持有 `private gateway: GatewayServer | null` 与 `private gatewayError = ''`。
- `ensureRpcToken(): string`：`network.rpc.token` 非空直接返回；为空则 `createRpcToken()`、`settings.update({ network: { rpc: { ...rpc, token } } })`、`emit({ type: 'settings', settings: next })`，返回新令牌。开启网关前必调，保证 `enabled` 时一定有令牌。
- `start()` 末尾：`network.rpc.enabled` 为真时 `await this.startGateway()`；失败只记日志与 `gatewayError`，不阻塞应用启动。
- `applySettings(next)`：`decideGatewayRestart` 后 `noop` 时若 `next.network.rpc.token !== prev.token` 则 `gateway?.setToken(token)`；`restart` 停旧起新；`start`/`stop` 对应启停。异步启停串行化（`this.gatewayTask = this.gatewayTask.then(...)`），避免快速改设置时并发绑定端口。
- `rotateRpcToken(): Promise<void>`：生成新令牌写设置、`emit` settings、`gateway?.setToken(next)`；网关未运行也生成。
- `stop()`：先 `await this.gateway?.stop()` 再停协议栈。
- `firewallPorts()`：`enabled` 时 tcp 加入 `network.rpc.port`。
- `gatewayStatus(): GatewayStatus`（见 Task 12）；令牌绝不放进返回值。

- [ ] **Step 1: 写失败的 diff 测试**（lifecycle 纯函数）：关闭→开启 `start`；开启→关闭 `stop`；端口/地址变化 `restart`；仅令牌变化 `noop`。
- [ ] **Step 2: 跑测试确认失败**：`pnpm exec vitest run src/main/gateway/lifecycle.test.ts`。
- [ ] **Step 3: 实现接线与 `lifecycle.ts`**；`debugLog('gateway', …)` 记录启停与端口，不记录令牌与消息内容。
- [ ] **Step 4: 全量验证并提交**；`git commit -m "feat: 网关生命周期、令牌轮换与防火墙端口"`。

---

## Task 12: IPC 与设置界面（设置 → 网络 → RPC）

**Files:**
- Modify: `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/app-ipc.ts`
- Modify: `src/renderer/src/components/SettingsOverlay.vue`
- Modify: `src/main/app-service.ts`（暴露状态方法，Task 11 已加）

**Interfaces:**
- `IPC` 新增：`gatewayStatus = 'gateway:status'`、`gatewayRotateToken = 'gateway:rotate-token'`。
- `shared/ipc.ts` 新增：
  ```ts
  export interface GatewayStatus {
    enabled: boolean
    running: boolean
    url: string
    bindAddr: string
    port: number
    fingerprint: string
    lastError: string
    clients: number
  }
  ```
- `Api.gateway`：`status(): Promise<GatewayStatus>`、`rotateToken(): Promise<void>`。
- 设置页：在 `SettingsOverlay.vue` network 分区（`:688-813`）末尾加 `.group`「RPC」：开关、监听地址、端口、令牌只读 + 复制 + 重新生成、运行状态/错误/指纹、连接数、说明文字。保存走 `saveField('network', { rpc: { ...settings.network.rpc, ...patch } })`（`SettingsPatch` 对 `network` 是浅 Partial，必须带完整 `rpc` 对象）。`rotateToken` 成功后重新 `loadSettings()`。
- 不新增解锁手势：network 分类本身默认隐藏（`NavRail.vue:25` 连点 5 次解锁），RPC 随之默认不可见；`SettingsOverlay.vue` 的 `categories` 过滤保持原样。

- [ ] **Step 1: 改 shared + preload + app-ipc，跑 `pnpm typecheck` 确认签名对齐**。
- [ ] **Step 2: 设置页接线**；状态在 `onMounted` 取一次 + 「刷新」按钮，不引入定时器；端口输入 `Number()` 后交给设置校验。
- [ ] **Step 3: 手工验证**：解锁网络分类 → 看到「RPC」分组；开启 → 状态 `running`、显示 `wss://127.0.0.1:8443/ws/dsh`、令牌自动生成；复制令牌可用；关闭 → 端口释放；改端口 → 网关自动 restart；重新生成 → 状态里连接数归零，旧令牌连接被断开。
- [ ] **Step 4: 全量验证**：`pnpm lint && pnpm typecheck && pnpm exec vitest run src/main/gateway/*.test.ts`；`git commit -m "feat: 网关设置页与令牌管理"`。

---

## Task 13: 文档、冒烟脚本与全量验证

**Files:**
- Modify: `docs/gateway-api.md`（已先行冻结 v1.0：认证、端点、方法、事件、错误码、图片 HTTP、客户端示例、离线语义、安全风险；实现后按实际行为校对并修正差异）
- Create: `scripts/gateway-smoke.mjs`（Node 24 + `rpc-websockets` Client，`rejectUnauthorized:false`；子命令 `list` / `send <protocol_id> <text>` / `listen` / `upload <file>`）
- Modify: `docs/known-limits.md`、`docs/handoff.md`、`README.md`、`AGENTS.md`（结构一节加 `src/main/gateway/`）、`CHANGELOG.md`

**Interfaces:**
- 冒烟脚本参数：`--url`（默认 `wss://127.0.0.1:8443/ws/dsh`）、`--token`（或用环境变量 `LANPOST_GATEWAY_TOKEN`）；`listen` 打印事件直到 Ctrl+C；所有网络操作 10 秒超时；脚本不打印令牌。
- `docs/gateway-api.md` 必须同时服务本项目与对方客户端：把「第二部分」的规则原样收进去。

- [ ] **Step 1: 核对 `docs/gateway-api.md`**（已存在，v1.0 冻结），按实现结果修正字段/错误码/示例；若实现与文档冲突，先改文档再改代码。附 `rpc-websockets` Client 的最小示例（`login`/`subscribe`/`resume`/`call`）。
- [ ] **Step 2: 写冒烟脚本并真机验证**（两个实例、不同数据目录与端口）：实例 A 开启网关并入群；脚本 `list` 看到 B；`send` 给 B，B 收到；B 回复，脚本 `listen` 收到 `message.received`；`events.ack` 后重启脚本，`events.resume` 不重复。
- [ ] **Step 3: 更新文档**：`known-limits.md` 增加「AI 接入（RPC 网关）」行（需令牌、群消息离线不重试、单实例等）；`handoff.md` 补本次交接；`CHANGELOG.md` `[未发布]`。
- [ ] **Step 4: 全量验证**
  `pnpm lint && pnpm typecheck && pnpm test && pnpm build`；若本沙箱 `pnpm test` 起不来，记录原因并单独跑新增测试文件 + 依赖 CI。
- [ ] **Step 5: 提交**
  `git add -A && git commit -m "feat: Agent 接入网关"`。

---

# 第二部分：客户端（对方）

> 对方指 DSH Channel Plugin（或任何 agent 侧客户端），不在本仓库实现；本部分是它必须满足的契约与参考实现要求。本仓库只提供 `scripts/gateway-smoke.mjs` 作为可运行的参考。

## 职责边界

- 对方负责：连接、登录、订阅、去重、ACK、媒体上传/下载、重连与退避、把事件投递给 agent。
- 本项目负责：TCP/内网通收发、用户/群名册、消息仓储、事件序列与补发、附件存储、令牌校验。
- 对方不得假设「已连接 = 已认证」「已订阅 = 会收到历史事件」；每次连接都要走完整流程。

## 连接与认证流程

1. 从用户处拿到 `baseUrl`（如 `wss://127.0.0.1:8443/ws/dsh`）与 `token`（设置页复制）。
2. `new Client(url, { autoconnect: false, rejectUnauthorized: false, reconnect: true, reconnect_interval: 2000 })`；先挂 `open`/`close`/`error` 监听，再 `connect()`。
3. `open` 后按顺序执行：`await client.login({ token })` → 返回非 `true` 立即停止（不要重试，避免锁死）→ `await client.subscribe(['message.received', 'message.deliveryStatus'])` → `await client.call('events.resume', { last_sequence })`。
4. 重连成功后重复第 3 步（库不会自动重新 login/订阅）；`last_sequence` 用本地持久化的最后 ACK 序号。
5. 令牌轮换（服务端关闭连接码 4401）后，旧令牌重连会 login 失败；提示用户重新复制令牌。

```js
import { Client } from 'rpc-websockets'

const client = new Client(url, { autoconnect: false, rejectUnauthorized: false, reconnect: true, reconnect_interval: 2000 })
client.on('open', async () => {
  if ((await client.login({ token })) !== true) return client.close()
  await client.subscribe(['message.received', 'message.deliveryStatus'])
  const { events, latest_sequence } = await client.call('events.resume', { last_sequence: lastAcked })
  for (const evt of events) await handleEvent(evt)
  latest = latest_sequence
})
client.connect()
```

## 事件处理与 ACK

- `message.received`：`{ event_id, sequence, data }`；按 `event_id` 去重（持久化已处理 id 或按 `sequence` 单调判断）。
- 文字：先落库，再 `events.ack({ event_id, sequence })`。
- 图片：事件里带 `attachment_id`；先 `GET /media/<id>`（`Authorization: Bearer <token>`）下载并校验 `x-sha256` 落盘，再 `events.ack`；ACK 前服务端不删附件。
- `message.deliveryStatus`：更新本地消息状态；`queued` 不代表对方已读。
- ACK 失败可重试；重复 ACK 服务端幂等。
- `events.resume` 返回 `-32020`（游标已过期）：把本地 `last_sequence` 重置为 0 再 resume 一次，并告知 agent 可能缺历史事件；不要静默丢弃。
- 收到事件顺序按 `sequence` 处理；乱序时先缓存，等缺口补齐（服务端串行推送，正常不会乱序）。

## 媒体上传/下载

```js
// 1) 申请上传
const prep = await client.call('media.prepareUpload', { mime_type: 'image/png', name: 'a.png', size, sha256 })
// 2) 上传原始字节
const r = await fetch(new URL('/media', baseHttp), {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png',
    'x-transfer-id': prep.transfer_id, 'x-sha256': sha256, 'x-name': encodeURIComponent('a.png') },
  body: bytes
})
// 3) 发送图片消息
await client.call('message.sendUser', { request_id, protocol_id, content: { type: 'image', attachment_id: r.attachment_id, mime_type: 'image/png', name: 'a.png', size, sha256 } })
```

- 大小上限 10 MiB、只允许 png/jpeg/webp/gif、v1 拒绝 SVG；`401` 表示令牌错，不要重试上传。
- 下载用 `baseHttp + /media/<id>` 与同一 Bearer；损坏/哈希不符时丢弃并告知 agent。

## 超时、重试与错误处理

- 超时：`users.list` 10s、`media.prepareUpload` 15s、发送消息 30s、图片上传/下载 60s、`events.ack` 10s。
- 重试：网络错误用指数退避（1s/2s/4s，上限 30s）；业务方法重试必须沿用原 `request_id`（服务端幂等）。
- 错误码：`-32605` 未认证 → 重新 login；`-32604` login 缺参 → 修客户端；`-32011/-32012` 目标不存在 → 不重试；`-32013/-32014/-32017/-32018` → 修正内容；`-32020` → 重置游标；`-32021` → `request_id` 冲突，换新 id。
- `message.sendUser` 返回 `delivery_status: "queued"` 表示已入队，不代表对方已收到；等 `message.deliveryStatus` 事件。
- 单进程只开一个连接；不要把令牌写进日志、异常信息或 agent 上下文。

## 客户端验收清单

- [ ] 未 login 调业务方法得到 `-32605`，login 后成功。
- [ ] 错误令牌 login 返回 `false`，客户端停止重试。
- [ ] 先 subscribe 再 resume；重连后重新 login + subscribe + resume，事件不重复。
- [ ] 事件按 `event_id` 去重；图片下载校验 SHA-256 后才 ACK。
- [ ] `events.ack` 后重启客户端，`events.resume` 不再返回已 ACK 事件。
- [ ] `/media` 无 Bearer 返回 401；令牌轮换后旧连接被断开。
- [ ] 断网重连后自动恢复订阅，不丢未 ACK 事件。

---

## 风险与已知限制

- **令牌即权限**：拿到令牌的本机进程就能以本机内网通账号发消息；令牌存在 `settings.json`（用户目录），设置页只显示给解锁网络分类的人；令牌轮换会断开现有 agent。
- **内网通无服务端**：`users.list` 只能列出本机见过/存过的联系人；agent 给离线用户发文字会排队到对端上线（与客户端现有行为一致），超过 24 小时未送达记为 `failed`；群消息离线不重试；图片离线重试 3 次。
- **群身份**：网关以本机账号身份入群；不在的群无法发送（`-32012`）；群消息的 `delivered` 只表示在线成员已接受。
- **自签证书**：插件侧必须允许自签（`rejectUnauthorized: false`）或导入指纹；`docs/gateway-api.md` 明确。
- **单实例**：同一个内网通账号只能由一个客户端实例的网关收发；同一网关只支持一个 ACK 游标（单 agent）。
- **`app-service.ts` 体积**：桥接逻辑尽量放 `src/main/gateway-bridge.ts`，`app-service.ts` 只加入口与钩子（预计 +150 行内）。
- **测试环境**：沙箱内 `pnpm test` 可能因 `spawn EPERM` 起不来，属环境限制；新增测试必须能单文件 `pnpm exec vitest run` 通过。

## 验收清单（服务端）

- [ ] `settings.network.rpc` 默认关闭、默认 `127.0.0.1:8443`、令牌为空；开启时自动生成令牌并写回设置。
- [ ] 设置页「网络 → RPC」默认不可见（网络分类隐藏），解锁后可见，开关/地址/端口/令牌/状态齐全。
- [ ] 认证：未 login 调方法 `-32605`、未 login 订阅事件收不到、错误令牌 login `false`；`/media` 无 Bearer 401。
- [ ] 开启后 `wss://127.0.0.1:8443/ws/dsh` 可用，关闭后端口释放；重新生成令牌后旧连接断开。
- [ ] `users.list` 支持关键字/在线过滤/分页，离线联系人可查，无用户号的联系人不返回。
- [ ] `message.sendUser` 在线即发、离线排队并返回 `queued`，对端上线后收到 `message.deliveryStatus: delivered`。
- [ ] `message.sendGroup` 向在线成员投递，返回 `delivered`/`queued`/`failed`。
- [ ] 图片上传：`prepareUpload` → `POST /media`（Bearer）→ 发送消息；10 MiB 上限、SHA-256、魔数、SVG 拒绝全部生效；入站图片可 `GET /media/<id>` 取回。
- [ ] 入站消息（文字/图片）以 `message.received` 到达插件，`events.ack` 前服务端不删附件，重连 `events.resume` 不重复。
- [ ] `pnpm lint && pnpm typecheck && pnpm test` 通过（或记录环境限制），`pnpm build` 通过。
- [ ] `docs/gateway-api.md` 与冒烟脚本可用；`CHANGELOG.md` 有 `[未发布]` 段。
