# lanpost Agent Gateway API

> 协议版本：`1.0`（2026-11-26 冻结）
> 适用：DSH Channel Plugin 或任何 agent 侧客户端
> 实现：lanpost-im 内嵌网关（Electron 主进程），以本机内网通账号身份收发

本文是双方对接的唯一契约。服务端实现与客户端实现都以本文为准；本文没有写的字段，双方都不得依赖。

## 1. 概述

lanpost-im 在设置页提供一个可选的 **Agent Gateway**。开启后，本机进程可以通过加密 WebSocket 连接网关，用令牌登录，然后：

- 查询本机内网通名册（含离线联系人）；
- 按私有用户号发一对一的文字/图片；
- 按群号发群消息；
- 订阅入站消息与投递状态事件。

网关没有集中式服务端：它随 lanpost 客户端运行，消息走内网通私有协议（UDP 9011 发现、ENet 会话、TCP 9013/9014 文件通道）。因此：

- 只能看到本机曾经发现/接触过的联系人；
- **没有历史消息查询**，connected 之前发生的消息不会补发（`events.resume` 只补发未 ACK 的事件）；
- 没有群列表接口，群号由用户提供；
- 对方离线时的文字会进入本机发送队列，对端上线后补发。

## 2. 快速接入

1. 打开 lanpost 设置页：连续点击设置按钮 5 次解锁「网络」分类（重启后恢复隐藏）。
2. 进入「网络 → RPC」，打开「启用 RPC 网关」。首次开启会自动生成令牌。
3. 记录两项：地址（默认 `ws://127.0.0.1:9015/ws/dsh`）、令牌（点「复制」）。
4. 客户端连接 → `rpc.login({ token })` → 订阅事件 → `events.resume` 补发。
5. 之后即可调用业务方法、上传/下载图片。

开关切换立即生效；监听地址或端口修改后，点开关旁的「重启」生效。只换令牌会立即断开旧连接。

设置项说明：

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| 启用 RPC 网关 | 关 | 开启后才监听端口；关闭后端口释放 |
| 监听地址 | `127.0.0.1` | 改成 `0.0.0.0` 会暴露给局域网，需谨慎 |
| 端口 | `9015` | 1–65535，修改后点开关旁的「重启」 |
| 令牌 | 自动生成 | 43 字符 base64url；可重新生成（旧连接立即断开） |

## 3. 传输与认证

### 3.1 端点

| 用途 | 地址 | 认证 |
| --- | --- | --- |
| RPC | `ws://<host>:<port>/ws/dsh` | `rpc.login` 提交令牌 |
| 图片上传 | `POST http://<host>:<port>/media` | `Authorization: Bearer <token>` |
| 图片下载 | `GET http://<host>:<port>/media/<attachment_id>` | 同上 |

协议版本 `1.0` 出现在本文与 `events.resume` 的说明里，不做版本握手；新增字段保持向后兼容，删除/改义才升版本。

### 3.2 明文传输

网关只提供明文 HTTP 与 WebSocket，不做 TLS（`rpc-websockets` 客户端直接连 `ws://` 即可）。默认监听 `127.0.0.1`，流量不出本机；如果把监听地址改成 `0.0.0.0` 或局域网地址，令牌、消息与图片会以明文经过网络，必须只在可信局域网内使用，或在外层自己加 TLS 终止代理。

### 3.3 RPC 认证（`rpc-websockets` 内建）

客户端连接后**必须先**调用：

```json
{ "token": "<43 字符 base64url>" }
```

通过 `client.login({ token })` 发送，方法名实际是 `rpc.login`。服务端严格返回 `true` 才把该连接标记为已认证；返回 `false` 表示令牌错误。

- 未认证调用任何业务方法：JSON-RPC 错误 `-32605`；
- 未认证订阅业务事件：`-32606`；
- `rpc.login` 缺参数：`-32604`；
- 所有业务方法与事件均受保护，没有匿名访问。
- 连接上限默认 8；超出时服务端以关闭码 `4409` 断开。
- 令牌重新生成后，服务端以关闭码 `4401` 断开所有现有连接；客户端需使用新令牌重新登录。

### 3.4 媒体认证

`/media` 的每个请求都必须带 `Authorization: Bearer <token>`。缺头或令牌不符返回：

```
HTTP 401
{"code":-32001,"message":"UNAUTHORIZED"}
```

媒体通道与 RPC 使用同一个令牌；RPC 已登录不会让媒体请求免认证，反之亦然。

## 4. RPC 方法

方法名、参数、返回值如下。所有方法都是 JSON-RPC 2.0 请求（`params` 为对象）；成功时 `result` 为下述返回值，失败时 `error` 为 `{ code, message, data? }`。

### 4.1 `users.list`

查询本机名册。只有持有私有用户号（32 位十六进制）的联系人才会返回；没有用户号的联系人无法被 agent 定向发送。

请求：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `keyword` | string | 否 | 对 `display_name`/`username`/`hostname` 做大小写不敏感子串匹配；空串等同不传 |
| `online` | boolean \| null | 否 | `true` 只返回在线；`false` 只返回离线；`null`/省略返回全部 |
| `page` | number | 否 | 从 1 开始，默认 1 |
| `page_size` | number | 否 | 默认 50，最大 200 |

返回：

```json
{
  "total": 12,
  "page": 1,
  "page_size": 50,
  "users": [
    {
      "protocol_id": "0123456789abcdef0123456789abcdef",
      "username": "zhangsan",
      "display_name": "张三",
      "hostname": "DESKTOP-ABC",
      "online": true,
      "last_seen_at": "2026-11-26T02:00:00.000Z"
    }
  ]
}
```

- `protocol_id`：私有用户号，发消息时使用；
- `username`：对端账号名，可能为空字符串；
- `display_name`：本机备注优先，否则对端昵称；
- `last_seen_at`：ISO 8601 UTC；未知时为 `null`；
- 排序：在线优先，其次 `last_seen_at` 倒序。

错误：`-32010`（`page`/`page_size` 非法）。

### 4.2 `message.sendUser`

给一个联系人发文字或图片。

请求：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `request_id` | string | 是 | 客户端生成的幂等键，建议 UUID；重试必须沿用 |
| `protocol_id` | string | 是 | `users.list` 返回的 `protocol_id` |
| `content` | object | 是 | 见下 |

`content` 两种形态：

```json
{ "type": "text", "text": "你好" }
```

```json
{
  "type": "image",
  "attachment_id": "att_8f14e45fceea167a",
  "mime_type": "image/png",
  "name": "截图.png",
  "size": 12345,
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

返回：

```json
{ "message_id": "im:123", "accepted": true, "delivery_status": "queued" }
```

- `message_id`：本机消息 id，格式 `im:<数字>`；
- `accepted`：网关已接受并写入本机仓储；
- `delivery_status`：初始恒为 `"queued"`；真正投递结果通过 `message.deliveryStatus` 事件通知。

约束：

- 文本按 UTF-8 字节计 ≤ 16 KiB（`-32013`）；
- 图片必须先走 `media.prepareUpload` + `POST /media` 拿到 `attachment_id`，且 `mime_type/size/sha256` 与附件一致（`-32016`/`-32017`/`-32018`）；
- 同 `request_id` 同内容：返回首次结果、不重复发送；同 `request_id` 不同内容：`-32021`；幂等窗口 24 小时；
- 离线联系人：仍返回 `queued`，对端上线后补发；24 小时未送达由 `message.deliveryStatus: failed` 通知。

错误：`-32010`、`-32011`、`-32013`、`-32014`、`-32016`、`-32017`、`-32018`、`-32021`。

### 4.3 `message.sendGroup`

请求：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `request_id` | string | 是 | 幂等键，规则同上 |
| `group_id` | string | 是 | 群号（由用户提供，网关不提供群列表） |
| `content` | object | 是 | 与 `message.sendUser` 相同 |

返回：同 `message.sendUser`。

投递语义：

- 逐个成员投递，只投当前在线成员；离线成员本轮跳过、不排队（v1）；
- 至少一个成员成功即 `delivered`；
- 没有任何成员可达：立即产生 `message.deliveryStatus: failed`，`reason` 为 `群成员都不在线`；
- 网关账号不在的群：`-32012`。

### 4.4 `media.prepareUpload`

先登记一次上传，再发字节。

请求：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mime_type` | string | 是 | `image/png`、`image/jpeg`、`image/webp`、`image/gif` 之一 |
| `name` | string | 是 | 文件名，仅用于展示；≤ 200 字符 |
| `size` | number | 是 | 字节数，≤ 10485760（10 MiB） |
| `sha256` | string | 是 | 小写十六进制，64 字符 |

返回：

```json
{ "transfer_id": "tr_3f2a…", "max_bytes": 10485760, "expires_at": "2026-11-26T02:30:00.000Z" }
```

- `transfer_id` 有效期 30 分钟；过期后上传返回 `-32016`；
- 上传成功后，`attachment_id` 在被消息引用前一直可用；被引用后保留到对应事件 ACK 后 24 小时（入站）或消息发出后 24 小时（出站）。

错误：`-32010`、`-32013`（size 超限）、`-32014`。

### 4.5 `events.ack`

确认客户端已持久化某条事件（及其图片）。

请求：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `event_id` | string | 是 | 事件 id，`evt_…` |
| `sequence` | number | 是 | 该事件的 sequence |

返回：

```json
{ "acked": true, "latest_sequence": 45 }
```

- 幂等：重复 ACK 不改变结果；
- 按 `sequence` 顺序 ACK；不要跳号；
- ACK 前服务端保留事件与关联附件；ACK 后保留 24 小时用于排查。

### 4.6 `events.resume`

补发未确认事件。客户端每次连接（含重连）在 login + subscribe 之后调用。

请求：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `last_sequence` | number | 是 | 客户端已处理的最后序号；首次连接用 0 |

返回：

```json
{
  "latest_sequence": 45,
  "events": [
    {
      "event_id": "evt_9b2f…",
      "sequence": 44,
      "method": "message.received",
      "data": { }
    }
  ]
}
```

- 只返回 `sequence > last_sequence` 且尚未 ACK 的事件，按 sequence 升序；
- 返回数组为空表示没有待补事件；
- 事件被清理导致无法保证连续时返回 `-32020`；客户端应把本地游标重置为 0 再 resume 一次，并告知调用方可能缺历史事件。

## 5. 事件

### 5.1 信封

事件作为 JSON-RPC 通知推送给已订阅的连接；与 `events.resume` 的数组元素结构相同：

```json
{
  "event_id": "evt_9b2f1c6a",
  "sequence": 42,
  "method": "message.received",
  "data": { }
}
```

- `event_id`：全局唯一；客户端必须按它去重（至少一次投递）；
- `sequence`：服务端单调递增（从 1 开始），用于排序与断点续传；
- `method`：`message.received` 或 `message.deliveryStatus`。

订阅方式（`rpc-websockets`）：

```js
await client.subscribe(['message.received', 'message.deliveryStatus'])
```

订阅之前发生的事件不会实时推送，但可通过 `events.resume` 补发；客户端应先 subscribe 再 resume。

### 5.2 `message.received`

入站消息（别人发给本机，或发到本机所在群）。

```json
{
  "message_id": "im:123",
  "conversation_id": "direct:0123456789abcdef0123456789abcdef",
  "conversation_type": "private",
  "group_id": null,
  "sender": {
    "protocol_id": "0123456789abcdef0123456789abcdef",
    "username": "zhangsan",
    "display_name": "张三",
    "hostname": "DESKTOP-ABC"
  },
  "content": { "type": "text", "text": "在吗" },
  "timestamp": "2026-11-26T02:00:00.000Z"
}
```

- `conversation_id`：一对一为 `direct:<peerKey>`，群为 `group:<groupId>`；
- `conversation_type`：`"private"` 或 `"group"`；群消息 `group_id` 非空；
- `content` 图片形态：

```json
{
  "type": "image",
  "attachment_id": "att_8f14e45fceea167a",
  "mime_type": "image/png",
  "name": "截图.png",
  "size": 12345,
  "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
}
```

- 收到图片事件后，先 `GET /media/<attachment_id>` 下载、校验 `x-sha256`，落盘后再 ACK 整条事件；ACK 前服务端不会删除附件。

### 5.3 `message.deliveryStatus`

本机通过网关发出的消息的投递状态。

```json
{
  "message_id": "im:123",
  "conversation_id": "direct:0123456789abcdef0123456789abcdef",
  "status": "delivered",
  "reason": "",
  "timestamp": "2026-11-26T02:00:05.000Z"
}
```

状态：

| status | 含义 |
| --- | --- |
| `queued` | 已进入本机发送队列（对方离线或尚未 ACK） |
| `delivered` | 一对一：对端已确认收到；群：至少一个在线成员已接受 |
| `failed` | 发送失败、24 小时未送达，或群内没有可达成员；`reason` 给原因 |

注意：`queued` 不代表对方已读；网关没有“已读”概念。

### 5.4 交付语义

- **至少一次**：事件可能重复；客户端按 `event_id` 去重。
- **顺序**：服务端按 `sequence` 串行推送；客户端按序处理与 ACK。
- **保留**：未 ACK 事件最多保留 7 天；已 ACK 事件保留 24 小时。
- **补发**：重连后 login → subscribe → `events.resume(last_sequence)`。
- **不补历史**：`resume(0)` 只返回仍保留的未 ACK 事件；更早的消息不会补发。

### 5.5 当前不提供

以下能力 v1.0 没有对应接口，客户端不要依赖：

- 历史消息/会话列表查询；
- 群列表、群成员查询；
- 已读回执、正在输入；
- 撤回、删除、搜索；
- 文件（非图片）传输；
- 多账号/多令牌/权限分级；
- 限流（`-32015` 仅保留码位，当前不会返回）。

## 6. 图片传输

### 6.1 出站（agent → 联系人）

```text
1) media.prepareUpload { mime_type, name, size, sha256 } → transfer_id
2) POST /media
   headers:
     authorization: Bearer <token>
     content-type: <mime_type>
     content-length: <size>
     x-transfer-id: <transfer_id>
     x-sha256: <sha256 小写 hex>
     x-name: <encodeURIComponent(name)>
   body: 原始字节
   → 200 { "attachment_id": "att_…" }
3) message.sendUser / message.sendGroup，content.type = "image"
```

规则：

- 单图 ≤ 10 MiB（可配置，默认 10485760）；
- 只允许 PNG/JPEG/WebP/GIF，按文件魔数校验；声明类型与实际不符 → `-32018`；SVG 一律 `-32014`；
- SHA-256 不符 → `-32017`；`transfer_id` 不存在/过期/已消费 → `-32016`；
- 上传可并发，但建议串行；单次请求超时 60 秒；
- 文件名只用于展示，服务端不会用文件名构造路径。

### 6.2 入站（联系人 → agent）

`message.received` 的 `content.type = "image"`，带 `attachment_id` 与元数据。

```text
GET /media/<attachment_id>
  authorization: Bearer <token>
→ 200，头：content-type、content-length、x-sha256
```

- 下载后校验 `x-sha256` 与内容一致；不一致时丢弃并告知调用方；
- 下载成功、落盘后再 `events.ack`；
- 附件不存在/已过期 → 404；令牌错误 → 401。

## 7. 错误码

JSON-RPC 错误对象：`{ "code": <number>, "message": "<英文可读信息>", "data": <可选> }`。

| code | 名称 | 触发 / 处理 |
| --- | --- | --- |
| -32603 | INTERNAL_ERROR（库） | 未预期异常；可重试一次 |
| -32604 | 缺参数（库） | `rpc.login` 未带参数；修客户端 |
| -32605 | 未认证（库） | 先 `rpc.login` |
| -32606 | 未认证订阅（库） | 先 login 再 subscribe |
| -32001 | UNAUTHORIZED | `/media` 缺 Bearer 或令牌错；检查令牌，不要重试 |
| -32003 | INTERNAL_ERROR | 网关内部错误；重试一次后报错 |
| -32010 | INVALID_ARGUMENT | 参数缺失/类型/范围错；修参数 |
| -32011 | USER_NOT_FOUND | `protocol_id` 不在名册；重新 `users.list` |
| -32012 | GROUP_NOT_FOUND | 群号错误或网关不在该群 |
| -32013 | MESSAGE_TOO_LARGE | 文本 > 16 KiB 或图片 > 10 MiB |
| -32014 | UNSUPPORTED_CONTENT_TYPE | 非 png/jpeg/webp/gif 或 SVG |
| -32015 | RATE_LIMITED | 保留，当前不会返回 |
| -32016 | ATTACHMENT_NOT_FOUND | 附件不存在/过期/已消费；重新上传 |
| -32017 | IMAGE_HASH_MISMATCH | SHA-256 不符；重新上传 |
| -32018 | IMAGE_FORMAT_INVALID | 魔数与声明类型不符 |
| -32019 | TRANSFER_TIMEOUT | 上传超时；重新 prepareUpload |
| -32020 | EVENT_CURSOR_EXPIRED | 游标早于保留窗口；重置为 0 再 resume |
| -32021 | DUPLICATE_REQUEST | 同 `request_id` 不同内容；换新 id |

## 8. 客户端行为规范

### 8.1 连接生命周期

```text
connect
  → login({ token })                 失败：停止，提示用户更新令牌
  → subscribe([两个事件])
  → events.resume({ last_sequence })
  → 正常调用与处理事件
断线（库自动重连）
  → open 后重复 login → subscribe → resume
```

- `rpc-websockets` 重连不会自动重新 login/订阅，必须自己重做；
- 关闭码 `4401`：令牌已轮换，停止重连并提示用户；
- 关闭码 `4409`：连接数超限，延迟后重试；
- 同一进程只保持一个连接。

### 8.2 超时

| 操作 | 超时 |
| --- | --- |
| `users.list` | 10s |
| `media.prepareUpload` | 15s |
| `message.sendUser` / `message.sendGroup` | 30s |
| 图片上传/下载 | 60s |
| `events.ack` | 10s |
| `events.resume` | 15s |

### 8.3 重试与幂等

- 网络错误：指数退避 1s/2s/4s，上限 30s；
- 发送消息重试必须沿用原 `request_id`；
- `events.ack` 可重复调用；
- 不要重试 `-32010/-32011/-32012/-32013/-32014/-32016/-32017/-32018/-32021`（参数或内容问题），先修正再调用。

### 8.4 离线语义

- 一对一文字：立即返回 `queued`，对端上线后由客户端既有队列补发；24 小时未送达 → `failed`；
- 一对一图片：返回 `queued`，对端 ready 后最多重试 3 次（间隔 30 秒）；
- 群消息：只投在线成员，离线成员不补发；无人在线 → `failed`；
- 网关关闭/客户端退出期间不会收消息；重启后只能通过 `events.resume` 拿到未 ACK 的事件。

### 8.5 安全

- 令牌等同账号密码：不要写进日志、异常信息、agent 上下文或 git；
- 建议只监听 `127.0.0.1`；改成 `0.0.0.0` 前必须确认网络环境可信，因为传输没有 TLS 加密；
- 重新生成令牌会断开所有客户端，需要重新分发。

## 9. Node.js 参考实现

依赖：`rpc-websockets@10`（Node ≥ 18；Node 24 内置 `fetch`）。

```js
import { Client } from 'rpc-websockets'

const url = 'ws://127.0.0.1:9015/ws/dsh'
const token = process.env.LANPOST_GATEWAY_TOKEN
const baseHttp = 'http://127.0.0.1:9015'
let lastAcked = 0

const client = new Client(url, {
  autoconnect: false,
  reconnect: true,
  reconnect_interval: 2000,
  max_reconnects: -1
})

client.on('open', async () => {
  try {
    if ((await client.login({ token })) !== true) {
      console.error('令牌无效')
      await client.close()
      return
    }
    await client.subscribe(['message.received', 'message.deliveryStatus'])
    const { events } = await client.call('events.resume', { last_sequence: lastAcked })
    for (const evt of events) await handleEvent(evt)
  } catch (err) {
    console.error('连接初始化失败', err)
  }
})

client.on('message.received', (evt) => { void handleEvent(evt) })
client.on('message.deliveryStatus', (evt) => { void handleEvent(evt) })

async function handleEvent(evt) {
  // 1) 按 evt.event_id 去重
  // 2) 图片：先下载再落盘
  if (evt.data?.content?.type === 'image') {
    const res = await fetch(`${baseHttp}/media/${evt.data.content.attachment_id}`, {
      headers: { authorization: `Bearer ${token}` }
    })
    if (!res.ok) throw new Error(`图片下载失败 ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    // 校验 evt.data.content.sha256 后落盘
  }
  // 3) 业务处理并持久化
  // 4) ACK
  await client.call('events.ack', { event_id: evt.event_id, sequence: evt.sequence })
  lastAcked = evt.sequence
}

async function sendText(protocolId, text) {
  const requestId = crypto.randomUUID()
  return client.call('message.sendUser', {
    request_id: requestId,
    protocol_id: protocolId,
    content: { type: 'text', text }
  })
}

async function uploadImage(protocolId, bytes, name, mimeType) {
  const { createHash } = await import('node:crypto')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const prep = await client.call('media.prepareUpload', {
    mime_type: mimeType, name, size: bytes.length, sha256
  })
  const up = await fetch(`${baseHttp}/media`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': mimeType,
      'content-length': String(bytes.length),
      'x-transfer-id': prep.transfer_id,
      'x-sha256': sha256,
      'x-name': encodeURIComponent(name)
    },
    body: bytes
  })
  if (!up.ok) throw new Error(`上传失败 ${up.status}`)
  const { attachment_id } = await up.json()
  return client.call('message.sendUser', {
    request_id: crypto.randomUUID(),
    protocol_id: protocolId,
    content: { type: 'image', attachment_id, mime_type: mimeType, name, size: bytes.length, sha256 }
  })
}

client.connect()
```

## 10. 冒烟与验收

仓库自带 `scripts/gateway-smoke.mjs`（Node 24，需本机已开启网关并复制令牌），用于服务端与对方客户端联调；不依赖额外 npm 包。

```text
node scripts/gateway-smoke.mjs --url ws://127.0.0.1:9015/ws/dsh --token <token> list
node scripts/gateway-smoke.mjs ... send <protocol_id> "hello"
node scripts/gateway-smoke.mjs ... listen
node scripts/gateway-smoke.mjs ... upload ./a.png <protocol_id>
```

令牌也可用环境变量 `LANPOST_GATEWAY_TOKEN` 传入；脚本默认 10 秒超时，明文 `ws://`/`http://` 直连（仅适合本机联调）。

对方客户端的最小验收：

- [ ] 未 login 调 `users.list` 得到 `-32605`；login 后成功。
- [ ] 错误令牌 login 返回 `false`，客户端停止重试。
- [ ] 先 subscribe 再 resume；重连后重新 login + subscribe + resume，事件不重复。
- [ ] 事件按 `event_id` 去重；图片下载校验 SHA-256 后才 ACK。
- [ ] ACK 后重启客户端，resume 不再返回已 ACK 事件。
- [ ] `/media` 无 Bearer 返回 401；令牌轮换后旧连接以 4401 断开。
- [ ] 断网重连后自动恢复订阅，不丢未 ACK 事件。

## 附录：版本记录

| 版本 | 日期 | 变更 |
| --- | --- | --- |
| 1.0 | 2026-11-26 | 首版：token 登录、users.list、消息收发、事件 ACK/resume、/media 图片 |
