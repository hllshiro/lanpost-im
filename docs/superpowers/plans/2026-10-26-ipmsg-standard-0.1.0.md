# 标准 IPMSG 0.1.0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把协议层推翻重写为纯标准 IPMSG，启动即可发现局域网成员，并完整支持文字、状态、密封、广播、文件与目录、内嵌图片。

**Architecture:** 新建 `src/main/protocol/` 标准模块，`engine.ts` 统一编排发现、消息与确认重传；删除私有握手、X_* 命令、企业字段与 ready 状态。文件层保留现有 TCP 框架，新增目录流与图片缓存。

**Tech Stack:** Electron 44、Vue 3、TypeScript、Pinia、`node:sqlite`、Vitest、Node 24、pnpm 12.15.0。

**Spec:** `docs/superpowers/specs/2026-10-26-ipmsg-standard-0.1.0-design.md`

## Global Constraints

- 只用 pnpm；不要运行 npm 或 yarn。
- 验证顺序：`pnpm lint` → `pnpm typecheck` → `pnpm test`；发布前再跑 `pnpm build`。
- 测试禁止占用 2425；协议/文件测试使用随机高端口与 `mkdtemp` 临时目录，`afterEach` 递归删除。
- 报文 seq 与文件 packetId 保持 32 位；不要用 `Date.now() * 1000` 生成。
- 有 `CAPUTF8OPT` 的对端默认 UTF-8；否则 GBK 有损回退。
- 不保留私有握手、X_* 命令、企业/部门/签名/ready 字段。
- 新增 IPC 必须同时改 `src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/app-ipc.ts`、renderer 调用。
- `SCHEMA_VERSION = 2`；旧数据库直接清空重建，不写迁移。
- 每个 Task 结束必须通过 lint、typecheck 与该 Task 的 Vitest，然后单独提交。
- 开始前创建分支：`git switch -c feat/ipmsg-standard-0.1.0`。

## Review Focus

- 不支持 UTF-8 的对端发来非 GBK 昵称：必须可见，不能抛异常或丢掉联系人（Task 1、Task 4）。
- 目录流里的恶意文件名（`..`、绝对路径、盘符、NUL、超长、`::`）：必须限制在临时目录内，不能越界写盘（Task 8）。
- 截断头、超范围 seq、未知命令、空载荷：必须忽略并继续服务，不能崩溃或污染状态（Task 1）。
- 对端在邀请或目录传输中途断网：任务进入失败态、临时目录清理、消息不长期停在“发送中”（Task 8）。
- 非 UTF-8 的历史字节串（CP932/非法序列）：解码要回退，消息仍可显示（Task 1、Task 4）。

---

### Task 1: 标准协议核心与发现骨架

**Files:**
- Create: `src/main/protocol/commands.ts`、`packet.ts`、`encoding.ts`、`entry.ts`、`engine.ts`
- Create: `src/main/protocol/packet.test.ts`、`entry.test.ts`、`engine.test.ts`
- Modify: `src/main/protocol/attach.ts`、`src/main/files/client.ts`、`src/main/files/server.ts`、`src/main/app-service.ts`
- Delete: `src/main/protocol/xml.ts`、`xml.test.ts`、`discovery.ts`、`discovery.test.ts`

**Interfaces:**
- Consumes: `Settings['identity']`、`Settings['network']`。
- Produces:
  - `commands.ts`: 标准命令常量与 `LEGACY_FLAGS`；不导出任何 `CMD_HANDSHAKE`/`CMD_CHATMSG`。
  - `packet.ts`: `encodePacket(header: { seq: number; user: string; host: string; cmd: number; payload?: Buffer }): Buffer`、`decodePacket(data: Buffer): PacketHeader`、`PacketError`。
  - `encoding.ts`: `encodeGbk(text: string): Buffer`、`decodeText(data: Buffer, utf8: boolean): string`、`canEncodeGbk(text: string): boolean`。
  - `entry.ts`: `encodeEntry(input: EntryInput): Buffer`、`parseEntry(payload: Buffer): ParsedEntry`。
  - `engine.ts`: `class ProtocolEngine`，构造参数 `{ name, account, host, group, status, port, bindAddr, subnets, seeds, broadcastInterval }`，方法 `start()`、`stop()`、`getPeers()`、`refresh()`、`sendText(peerKey, text)`、`sendFileOffer(peerKey, text, attachments)`、`sendFileAccept(peerKey, packetId)`，回调 `onPeers`、`onMessage`、`onMessageStatus`、`onFileOffer`、`onLog`、`onError`；导出 `toPeerInfo(peer): PeerInfo`（Task 2 之前把已删除的企业字段填为空值）。

- [ ] **Step 1: 写失败测试，固定报文与 Entry 格式**

`src/main/protocol/packet.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { decodePacket, encodePacket, PacketError } from './packet'

describe('packet', () => {
  it('encodes standard version 1 header', () => {
    expect(encodePacket({ seq: 100, user: 'alice', host: 'pc', cmd: 32, payload: Buffer.from('Hi') }).toString())
      .toBe('1:100:alice:pc:32:Hi')
  })
  it('decodes empty payload and rejects seq over 32 bits', () => {
    expect(decodePacket(Buffer.from('1:0:a:b:1:')).payload.length).toBe(0)
    expect(() => decodePacket(Buffer.from('1:4294967296:a:b:1:'))).toThrow(PacketError)
  })
})
```

`src/main/protocol/entry.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { encodeEntry, parseEntry } from './entry'

describe('entry', () => {
  it('keeps GBK traditional fields and exact UTF-8 block', () => {
    const buf = encodeEntry({ name: '张三', group: '研发', account: 'zhangsan', host: 'pc', version: '0.1.0' })
    const parsed = parseEntry(buf)
    expect(parsed.name).toBe('张三')
    expect(parsed.group).toBe('研发')
    expect(parsed.account).toBe('zhangsan')
  })
  it('uses two NULs when group is empty', () => {
    const buf = encodeEntry({ name: 'a', group: '', account: 'a', host: 'pc', version: '0.1.0' })
    expect(buf.subarray(0, 3).toString('hex')).toBe('610000')
  })
})
```

`src/main/protocol/engine.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { ProtocolEngine } from './engine'

const engines: ProtocolEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()))
})

describe('engine discovery', () => {
  it('sees a peer through a seed address', async () => {
    const a = new ProtocolEngine(config('alice', 25001, ['127.0.0.1:25002']), callbacks())
    const b = new ProtocolEngine(config('bob', 25002, ['127.0.0.1:25001']), callbacks())
    engines.push(a, b)
    await a.start()
    await b.start()
    await waitFor(() => a.getPeers().some((peer) => peer.user === 'bob'), 3000)
    expect(a.getPeers()[0]).toMatchObject({ name: 'bob', online: true })
  })
})
```

`waitFor` 与 `config`/`callbacks` 用测试内小工具实现（轮询 20 ms，超时抛错）。端口用 `24000 + Math.floor(Math.random() * 3000)` 生成，避免固定冲突。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/packet.test.ts src/main/protocol/entry.test.ts src/main/protocol/engine.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现标准报文、编码、Entry 与引擎骨架**

`packet.ts` 固定 `1:<seq>:<user>:<host>:<cmd>:<payload>`；`decodePacket` 校验 5 个冒号字段、seq/cmd 十进制且 ≤ `0xffffffff`；空载荷返回空 Buffer。

`entry.ts` 的 `EntryInput` 为 `{ name: string; group: string; account: string; host: string; version: string }`，`ParsedEntry` 为 `{ name: string; group: string; account: string; host: string; version: string }`。编码顺序：GBK 昵称、NUL、GBK 组名、NUL、`\nUN:<account>\nHN:<host>\nNN:<name>\nGN:<group>\nVS:<hex(version)>`。解析时先按 NUL 取前两段，余下以 `\n` 开头的行按 UTF-8 覆盖。`engine` 发送 Entry 类包时统一加 `CAPUTF8OPT | FILEATTACHOPT | CLIPBOARDOPT`。

`engine.ts`：单 UDP socket、`reuseAddr`、`setBroadcast`；启动时绑定并广播 `BR_ENTRY`；收到 `BR_ENTRY` 更新成员并回 `ANSENTRY`；收到 `ANSENTRY` 只更新；收到 `BR_EXIT` 离线；`sendText` 发 `SENDMSG | SENDCHECKOPT` 并记录 seq。成员键 `${rinfo.address}|${header.user}`。`sendFileOffer` 发 `SENDMSG | SENDCHECKOPT | FILEATTACH`，`sendFileAccept` 发 `RECVMSG`；入站 `SENDMSG` 解析附件并调用 `onFileOffer`，入站 `RECVMSG` 调用 `onMessageStatus(..., 'delivered')`。未知命令直接忽略并记日志。

删除 `xml.ts`、`xml.test.ts`、`discovery.ts`、`discovery.test.ts`，把 `app-service.ts`、`files/client.ts`、`files/server.ts` 的旧导入改成新名字（`Encode` → `encodePacket`、`CMD_GETFILE` → `CMD_GETFILEDATA`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/main/protocol/packet.test.ts src/main/protocol/entry.test.ts src/main/protocol/engine.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量校验并提交**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: 全部通过。

```bash
git add -A
git commit -m "refactor(protocol): replace private channel with standard IPMSG core"
```

---

### Task 2: 数据与设置清理、联系人编组 UI

**Files:**
- Modify: `src/main/store/schema.ts`、`db.ts`、`repositories.ts`、`src/shared/domain.ts`、`src/shared/settings.ts`
- Modify: `src/main/app-service.ts`、`src/main/files/manager.ts`、`src/renderer/src/components/ContactsPage.vue`、`ChatPane.vue`、`SettingsOverlay.vue`
- Create: `src/renderer/src/utils/contacts.ts`、`contacts.test.ts`
- Test: `src/main/store/db.test.ts`、`repositories.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `PeerInfo` 使用方。
- Produces:
  - `SCHEMA_VERSION = 2`；`openDatabase` 在 `0 < user_version < 2` 时删除全部业务表并重建。
  - `PeerInfo`：`key, ip, port, user, host, name, group, status, online, lastSeen, unread, alias, capUtf8, capFile, capClipboard, dialup, versionInfo, absenceInfo`。
  - `FileTaskInfo`：增加 `kind: 'file' | 'dir' | 'image'`、`entryCount`、`completedCount`。
  - `groupPeers(peers: PeerInfo[]): { group: string; peers: PeerInfo[] }[]`：空组名归入“未分组”，组按拼音排序且“未分组”固定最后，组内按拼音排序。

- [ ] **Step 1: 写失败测试**

`db.test.ts` 增加：用 v1 schema 建库并写入一行，`openDatabase` 后 `user_version` 为 2 且旧行不存在；`user_version=3` 仍抛错。

`contacts.test.ts`：

```ts
import { expect, it } from 'vitest'
import { groupPeers } from './contacts'

it('groups peers by IPMSG group with fallback', () => {
  const result = groupPeers([
    { key: 'a', name: '甲', group: '研发' } as never,
    { key: 'b', name: '乙', group: '' } as never,
    { key: 'c', name: '丙', group: '研发' } as never
  ])
  expect(result.map((item) => [item.group, item.peers.length])).toEqual([
    ['研发', 2],
    ['未分组', 1]
  ])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/store/db.test.ts src/renderer/src/utils/contacts.test.ts`
Expected: FAIL。

- [ ] **Step 3: 修改 schema、仓储、设置与联系人页**

`peers` 删除 `corporation/department/sign/corp_id/ready`，增加 `cap_utf8/cap_file/cap_clipboard/dialup/version_info/absence_info`；`file_tasks` 增加 `kind/entry_count/completed_count`。`mapPeer`/`mapFile`/`upsert` 同步。`FileManager.toInfo` 默认写 `kind: 'file', entryCount: 0, completedCount: 0`，保证 Task 8/9 之前类型完整。

`settings.ts` 删除 `corporation/department/sign`，`network` 增加 `dialup: boolean` 默认 false。`SettingsOverlay.vue` 删除三个输入框，网络页增加拨号模式开关。

`ContactsPage.vue` 用 `groupPeers` 生成分区，分区标题可折叠；搜索字段删除 `department/sign`，仍可按组名、账号、IP、主机与拼音过滤。字母索引保留为姓名过滤，不改变组分区。

- [ ] **Step 4: 运行测试与类型检查**

Run: `pnpm exec vitest run src/main/store/db.test.ts src/main/store/repositories.test.ts src/renderer/src/utils/contacts.test.ts`
Expected: PASS。
Run: `pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor(data): drop proprietary fields and group contacts by IPMSG group"
```

---

### Task 3: 可靠的启动发现与离开状态

**Files:**
- Modify: `src/main/protocol/engine.ts`、`engine.test.ts`、`src/main/app-service.ts`
- Test: `src/main/protocol/engine.test.ts`

**Interfaces:**
- Consumes: Task 1 的引擎与 Entry。
- Produces:
  - `EngineOptions` 增加 `announceBurstMs?: number[]`（默认 `[0, 1000, 3000]`）、`offlineTimeoutMs?: number`（默认 120000）、`sweepIntervalMs?: number`（默认 5000）、`random?: () => number`；构造函数变为 `(config, callbacks, options?: EngineOptions)`。
  - `announce()`：按 `status` 选择 `BR_ENTRY` 或 `BR_ABSENCE | ABSENCEOPT`，每次都包含全量广播地址与全部种子单播。
  - `updateStatus(status: number)`、`updateProfile(patch)`：昵称/组名变化时立即 `announce()`。
  - `getPeers()` 的成员包含 `online`、`status`、`lastSeen`。

- [ ] **Step 1: 写失败测试**

在 `engine.test.ts` 增加：
- 第一次 `announce` 丢包：用 fake udp? 不模拟丢包，改为直接断言启动后 3.5 秒内成员可见，且发送了至少 3 个 ENTRY（通过 `onLog` 或测试专用 `sentPackets` 计数）。
- 离开状态跨周期：`updateStatus(2)` 后等待 `broadcastInterval + 200ms`，对端 `peer.status` 仍为 2。
- 超时离线：`offlineTimeoutMs: 300`、`sweepIntervalMs: 50` 下停止对端广播，300 ms 后 `online` 为 false。
- `refresh()` 后成员仍在且 `lastSeen` 更新。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/engine.test.ts -t "announce"`
Expected: FAIL。

- [ ] **Step 3: 实现统一 announce 与超时**

启动时安排 `announceBurstMs` 的补发，然后按 `broadcastInterval` 周期调用同一个 `announce()`；每次调用前 `refreshBroadcastTargets()`。`ANSENTRY` 回包延迟 `random() * 200` ms。`updateStatus`/`updateProfile` 复用 `announce()`。sweep 定时器把 `now - lastSeen >= offlineTimeoutMs` 的成员置离线并触发 `onPeers`。

`applyEntryFlags` 从命令位记录 `capUtf8/capFile/capClipboard/dialup`；`announce()` 在 `dialup=true` 时加 `DIALUPOPT`。`AUTORETOPT` 的入站包不再回 `ANSENTRY`/`RECVMSG`；`NOADDLISTOPT` 的陌生来源消息只回调内容、不主动发 ENTRY。状态映射：0 在线；1 忙碌与 2 离开都设置 `ABSENCEOPT`，UI 保留区分。

`app-service.applySettings` 调用 `engine.updateProfile` 与 `engine.updateStatus`；删除旧握手/私有状态同步。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/main/protocol/engine.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(discovery): reliable startup announce and presence state"
```

---

### Task 4: UTF-8 默认与 GBK 回退

**Files:**
- Create: `src/main/protocol/text.ts`、`text.test.ts`
- Modify: `src/main/protocol/engine.ts`、`app-service.ts`

**Interfaces:**
- Consumes: `PeerInfo.capUtf8`、`canEncodeGbk`。
- Produces:
  - `encodeMessageText(text: string, caps: { utf8: boolean }): { data: Buffer; utf8: boolean }`：`caps.utf8` 为 true 时一律 UTF-8，否则 GBK 有损回退。
  - `decodeMessageText(data: Buffer, utf8: boolean): string`：`utf8` 时 UTF-8，否则先 GBK、失败再 UTF-8。
  - `sendText` 根据对端能力设置 `UTF8OPT`。

- [ ] **Step 1: 写失败测试**

```ts
it('uses utf8 by default for capable peers and supports emoji', () => {
  const result = encodeMessageText('你好 😀', { utf8: true })
  expect(result.utf8).toBe(true)
  expect(decodeMessageText(result.data, true)).toBe('你好 😀')
})
it('falls back to gbk for legacy peers', () => {
  const result = encodeMessageText('你好 😀', { utf8: false })
  expect(result.utf8).toBe(false)
  expect(decodeMessageText(result.data, false)).toContain('你好')
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/text.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 text.ts 并接入引擎**

`encodeMessageText` 先把 `\r\n`/`\r` 统一为 `\n`，再按能力选择编码；`utf8` 为 false 且内容无法 GBK 编码时，用 `encodeGbk` 的替换行为并 `onLog` 一次警告。`sendText` 的 cmd 加 `UTF8OPT` 当 `result.utf8`。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/main/protocol/text.test.ts src/main/protocol/engine.test.ts`
Expected: PASS。

```bash
git add -A
git commit -m "feat(protocol): default to UTF-8 for capable peers"
```

---

### Task 5: 确认重传、去重、密封消息与已读

**Files:**
- Create: `src/main/protocol/retransmit.ts`、`retransmit.test.ts`、`seal.ts`、`seal.test.ts`
- Modify: `src/main/protocol/engine.ts`、`app-service.ts`、`src/shared/domain.ts`、`src/shared/ipc.ts`、`src/preload/index.ts`、`src/main/ipc/app-ipc.ts`
- Modify: `src/renderer/src/components/MessageBubble.vue`、`Composer.vue`、`stores/app.ts`

**Interfaces:**
- Consumes: `SENDCHECKOPT`、`SECRETOPT`、`READCHECKOPT`、`RECVMSG`、`READMSG`、`ANSREADMSG`。
- Produces:
  - `Retransmitter`：`add({ seq, peerKey, send: () => void })`、`ack(seq)`、`stop()`、`onFailed: (seq) => void`；间隔 4 秒，最多 4 次。
  - `seal.ts`：`shouldAckRead(cmd: number): boolean`、`readReceiptCommand(inboundCmd: number): number`。
  - `MessageMeta`：`{ sealed?: boolean; opened?: boolean; flags?: { broadcast?: boolean; multicast?: boolean }; files?: string[]; images?: string[]; channel?: 'standard' }`；`MessageInfo.meta` 改为 `MessageMeta`（仓储 `mapMessage` 解析 DB 字符串，写入时 `JSON.stringify`）。
  - `onMessage(peer, text, remoteSeq, meta: MessageMeta)`。
  - `DELMSG`：入站按 `remote_seq` 删除本地消息并 emit；不提供 UI 发起入口。
  - IPC：`messages.unseal({ messageId }) → { message: MessageInfo }`；`messages.send` 增加 `{ sealed?: boolean }`。

- [ ] **Step 1: 写失败测试**

`retransmit.test.ts`：假时钟推进 4 秒共 4 次后 `onFailed` 调用一次；`ack` 后不再重发。
`seal.test.ts`：`SECRET|READCHECK` → `ANSREADMSG`；普通 `SECRET` → `READMSG` 后不要求确认。
引擎测试：同一 `(peer, seq)` 重复 SENDMSG 只回调一次 `onMessage`；密封入站消息 `meta.sealed=true`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/retransmit.test.ts src/main/protocol/seal.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现重传、去重、密封流程**

`sendText`/`sendFileOffer` 在发送后调用 `retransmitter.add`；收到 `RECVMSG`/`ANSREADMSG` 时 `ack(seq)`；失败回调交给 `onMessageStatus(peerKey, seq, 'failed')`。入站维护 `Map<string, number>`，键 `${peerKey}|${seq}`，5 分钟清理。

入站 `SECRETOPT` 时把 `meta` 设为 `{"sealed":true,"opened":false}` 并让 `onMessage` 带上 meta；`app-service.handleIncoming` 存 meta，通知文案改为“收到一条密封消息”。`unseal` 读取消息、更新 `opened=true`、发 `READMSG`（带 `READCHECKOPT` 时）并返回更新后的消息。

出站 `{ sealed: true }` 在 cmd 加 `SECRETOPT`，消息 meta 写 `sealed`；收到 `READMSG` 后按 `remote_seq` 更新状态 `read`。收到 `DELMSG` 时按 `remote_seq` 删除对应消息并通过 `AppEvent` 通知 renderer 移除。

renderer：`MessageBubble` 对 `meta.sealed && !meta.opened && direction==='in'` 显示“密封消息，点击查看”，点击 emit `unseal`；`MessageList`/`App.vue` 接 `store.unseal(messageId)`。`Composer` 增加密封开关，`send` 事件带 `{ text, sealed }`。

- [ ] **Step 4: 运行测试与类型检查**

Run: `pnpm exec vitest run src/main/protocol/retransmit.test.ts src/main/protocol/seal.test.ts src/main/protocol/engine.test.ts && pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(protocol): add retransmit, dedupe and sealed messages"
```

---

### Task 6: 版本/离开信息与主机列表

**Files:**
- Create: `src/main/protocol/info.ts`、`info.test.ts`、`host-list.ts`、`host-list.test.ts`
- Modify: `src/main/protocol/engine.ts`、`app-service.ts`、`src/shared/ipc.ts`、`preload/index.ts`、`main/ipc/app-ipc.ts`、`ChatPane.vue`

**Interfaces:**
- Consumes: `SENDINFO`、`SENDABSENCEINFO`、`ANSLIST`。
- Produces:
  - `parseInfo(payload: Buffer): string`、`buildInfo(version: string): Buffer`、`buildAbsenceInfo(absent: boolean, text: string): Buffer`。
  - `parseHostList(payload: Buffer): { next: number; hosts: HostListEntry[] }`、`buildHostList(start: number, hosts: HostListEntry[]): Buffer`；`HostListEntry = { user, host, status, addr, port, nickname, group }`。
  - `engine.requestInfo(peerKey)`、`getHostList()`。
  - `AppEvent` 增加 `{ type: 'peer'; peer: PeerInfo }`；`store.handleEvent` 更新对应成员。
  - IPC：`peers.requestInfo({ peerKey }) → { peer: PeerInfo }`。

- [ ] **Step 1: 写失败测试**

`info.test.ts`：`buildInfo` 含 `lanpost-im` 与版本；`buildAbsenceInfo(false)` 为 `Not absence mode`。
`host-list.test.ts`：构造 2 个宿主，`parseHostList(buildHostList(0, hosts))` 的 `next=0`、字段顺序正确；分批时 `next` 为下一批起点。
引擎测试：收到 `GETINFO` 回 `SENDINFO`；收到 `GETABSENCEINFO` 回 `SENDABSENCEINFO`；`GETLIST` 回 `ANSLIST`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/info.test.ts src/main/protocol/host-list.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 info/host-list 并接入**

`host-list.ts` 使用 `\a` 分隔，头部 `%5d\a%5d\a`；端口写 `htons` 后的十进制。`engine` 在 dispatch 中处理 `GETINFO/GETABSENCEINFO/GETLIST/ISGETLIST/OKGETLIST/ANSLIST`；`ANSLIST` 只更新已知成员。`requestInfo` 先发 `GETINFO`，离开状态再发 `GETABSENCEINFO`。app-service 在成员信息变化时 emit `{ type: 'peer' }`，store 按 key 更新。

`ChatPane` 联系人详情显示 `versionInfo`、`absenceInfo`、能力标签（UTF-8/文件/图片/拨号）和“刷新信息”按钮；调用 `peers.requestInfo` 后更新 store。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/main/protocol/info.test.ts src/main/protocol/host-list.test.ts src/main/protocol/engine.test.ts && pnpm typecheck`
Expected: PASS。

```bash
git add -A
git commit -m "feat(protocol): add peer info and host list"
```

---

### Task 7: 广播与多播

**Files:**
- Modify: `src/main/protocol/engine.ts`、`engine.test.ts`、`app-service.ts`、`src/shared/domain.ts`、`src/shared/ipc.ts`、`preload/index.ts`、`main/ipc/app-ipc.ts`
- Modify: `src/renderer/src/components/ContactsPage.vue`、`MessageBubble.vue`、`stores/app.ts`

**Interfaces:**
- Consumes: Task 5 的 `MessageMeta.flags`。
- Produces:
  - `engine.sendBroadcast(text: string): number`（返回成功目标数）。
  - `engine.sendMulticast(peerKeys: string[], text: string): number`。
  - IPC：`messages.broadcast({ text }) → { count }`、`messages.multicast({ peerKeys, text }) → { count }`。
  - 每条目标会话落一条出站消息，`meta.flags.broadcast|multicast`。

- [ ] **Step 1: 写失败测试**

引擎测试：两个在线对端时 `sendBroadcast('hi')` 返回 2，两端 `onMessage` 收到的 cmd 含 `BROADCASTOPT`；`sendMulticast(['bob'], 'hi')` 只到 bob，cmd 含 `MULTICASTOPT`。
`app-service` 测试或仓储测试：广播后每个会话各有一条消息，`meta.flags.broadcast=true`。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/engine.test.ts -t "broadcast"`
Expected: FAIL。

- [ ] **Step 3: 实现发送、归档与 UI**

引擎遍历在线成员，逐个 `sendPacket` 并各自登记重传。app-service 对每个目标 `ensureDirect`、`insertOutgoing`、写 meta、`emit`。入站解析 `meta.flags`，`MessageBubble` 在气泡上方显示“广播”/“多播”小标签。

`ContactsPage` 增加“广播消息”按钮与联系人多选模式；`store.broadcast`/`store.multicast` 调 IPC 并刷新会话。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/main/protocol/engine.test.ts && pnpm typecheck`
Expected: PASS。

```bash
git add -A
git commit -m "feat(protocol): support broadcast and multicast"
```

---

### Task 8: 目录传输、扩展属性与取消附件

**Files:**
- Create: `src/main/protocol/attrs.ts`、`attrs.test.ts`、`dir-stream.ts`、`dir-stream.test.ts`
- Create: `src/main/files/dir-sender.ts`、`dir-receiver.ts`、`paths.ts`、`paths.test.ts`、`dir-transfer.test.ts`
- Modify: `src/main/files/server.ts`、`manager.ts`、`client.ts`、`app-service.ts`、`src/main/protocol/attach.ts`、`src/shared/domain.ts`、`ipc.ts`、`preload/index.ts`、`app-ipc.ts`
- Modify: `src/renderer/src/components/Composer.vue`、`MessageBubble.vue`、`MessageList.vue`、`FileCard.vue`、`FilesPage.vue`

**Interfaces:**
- Consumes: `DIR 0x02`、`RETPARENT 0x03`、`CLIPBOARD 0x20`、`GETDIRFILES`、`RELEASEFILES`。
- Produces:
  - `attrs.ts`：`fileType(attr: number): number`、`parseExtAttrs(fields: string[]): Map<number, string>`、`applyFileAttrs(path, attrs)`。
  - `dir-stream.ts`：`parseDirHeader(buffer: Buffer): { headerSize, name, size, attr, ext, contentOffset }`、`encodeDirHeader(entry): Buffer`。
  - `paths.ts`：`safeRelativePath(name: string): string | null`。
  - `Attachment` 增加 `ext?: Record<number, string>`；`attach.ts` 编码/解析 `键=值`。
  - `FileManager.addOutgoingDir(input)`、`offerIncoming` 支持 `kind`；`FileServer` 的 resolve 返回 `{ kind: 'file' | 'dir' }`；`toInfo` 写 `entryCount`/`completedCount`。
  - `MessageList` 的 `filesByMessage` 改为 `Map<number, FileTaskInfo[]>`，`MessageBubble` 接收 `files: FileTaskInfo[]` 并渲染多张 `FileCard`。
  - IPC：`files.pickFolderAndSend(conversationId)`。
  - `FileTaskInfo.kind` 支持 `dir`。

- [ ] **Step 1: 写失败测试**

`dir-stream.test.ts`：构造根 DIR → 子文件 → RETPARENT 的流，解析出根名、子文件名、mtime；`encodeDirHeader` 的 `headerSize` 等于头部字节长度；`::` 还原为 `:`。
`paths.test.ts`：`..`、`../x`、`C:\x`、`/etc/passwd`、含 NUL 返回 null；正常中文名返回原值。
`dir-transfer.test.ts`：临时目录建 `空目录/中文.txt`，启动发送端与接收端，走 offer → GETDIRFILES → 接收，断言树一致、空目录存在、mtime 接近、临时目录已清理；传输中断（接收端在读到一半时 `AbortController.abort()`）后任务为 `canceled` 且临时目录不存在。
`attrs.test.ts`：`0x102` → 类型 `DIR`、只读；未知扩展键忽略。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/dir-stream.test.ts src/main/files/paths.test.ts src/main/files/dir-transfer.test.ts src/main/protocol/attrs.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现目录收发与取消**

发送端遍历目录，先发根 DIR 头，逐项发送；每层结束发 RETPARENT；文件分块写。接收端写入 `.lanpost-<taskId>`，栈空时的第一个 DIR 用附件名，遇到非法路径立即失败并清理；成功后 `rename` 到唯一最终名。`GETDIRFILES` 与 `GETFILEDATA` 共用 TCP 服务，按 cmd 分流。

`FileManager.reject`/`cancel` 对入站任务调用 `onRelease(packetId, fileId)`，app-service 发 `RELEASEFILES`；引擎收到后回调 `fileManager.markReleased(packetId, fileIds)`，出站任务置 `rejected`。

`app-service.sendFiles` 遇到目录时创建 `kind='dir'` 的顶层附件与任务；`sendFolder` 通过 `dialog.showOpenDialog({ properties: ['openDirectory'] })`。`FileCard` 对 `kind==='dir'` 显示文件夹图标与“N 项”，完成后按钮为“打开文件夹”。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/main/protocol/dir-stream.test.ts src/main/files/paths.test.ts src/main/files/dir-transfer.test.ts src/main/protocol/attrs.test.ts src/main/files/transfer.test.ts`
Expected: PASS。

```bash
git add -A
git commit -m "feat(files): add directory transfer and release"
```

---

### Task 9: 内嵌图片

**Files:**
- Create: `src/main/protocol/clipboard.ts`、`clipboard.test.ts`、`src/main/files/media.ts`、`media.test.ts`
- Modify: `src/main/protocol/engine.ts`、`attach.ts`、`app-service.ts`、`src/main/index.ts`
- Modify: `src/shared/domain.ts`、`ipc.ts`、`preload/index.ts`、`app-ipc.ts`
- Modify: `src/renderer/src/components/Composer.vue`、`MessageBubble.vue`、`MessageList.vue`、`stores/app.ts`

**Interfaces:**
- Consumes: `CLIPBOARD 0x20`、`CLIPBOARDPOS 0x8`。
- Produces:
  - `clipboard.ts`：`isClipboardAttachment(attr: number): boolean`、`clipboardPosition(ext: Map<number, string>): number`。
  - `media.ts`：`mediaUrl(taskId: string): string`、`parseMediaRequest(url: string): string | null`、`resolveMediaTask(id)` 仅接受 `kind='image' && state='done'`。
  - `engine.sendImageOffer(peerKey, text, attachments)`。
  - IPC：`files.pickImagesAndSend(conversationId)`。
  - `meta.images: string[]` 保存图片任务 ID。

- [ ] **Step 1: 写失败测试**

`clipboard.test.ts`：`0x20` 判定为图片；`0x21` 不是；`CLIPBOARDPOS=8` 解析为十进制 `"8"`。
`media.test.ts`：合法 `lanpost-media://file/in-1` 解析出 `in-1`；任意路径、`..`、非图片任务返回 null。
引擎测试：入站一次带 2 个 CLIPBOARD 附件的 offer，只触发一次 `onMessage`，`meta.images` 有 2 项；图片任务自动接受。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/main/protocol/clipboard.test.ts src/main/files/media.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现图片收发、媒体协议与气泡**

发送端选择图片后构造 `attr=CLIPBOARD` 附件；单张 >10 MB 或超过 10 张时降级为普通文件。接收端在 `handleFileOffer` 中识别 CLIPBOARD，创建 `kind='image'` 任务并强制自动接受，路径 `<receiveDir>/images/...`；一条 offer 建一条消息，`meta.images` 写任务 ID。`handleFileUpdate` 不因图片任务再建消息。

`main/index.ts` 在 `app.ready` 前 `protocol.registerSchemesAsPrivileged([{ scheme: 'lanpost-media', privileges: { standard: true, secure: true } }])`，`app.ready` 后 `protocol.handle('lanpost-media', ...)` 通过 `resolveMediaTask` 查库并用 `net.fetch(pathToFileURL(path))` 返回。

`Composer` 增加图片按钮；`MessageBubble` 根据 `meta.images` 渲染缩略图网格，点击 `files.open`。

- [ ] **Step 4: 运行测试并提交**

Run: `pnpm exec vitest run src/main/protocol/clipboard.test.ts src/main/files/media.test.ts src/main/protocol/engine.test.ts && pnpm typecheck`
Expected: PASS。

```bash
git add -A
git commit -m "feat(media): send and render clipboard images"
```

---

### Task 10: 0.1.0 发布整理

**Files:**
- Modify: `CHANGELOG.md`、`docs/02-现状/known-limits.md`、`docs/04-参考资料/file-transfer.md`、`package.json`
- Modify: `AGENTS.md`（如仍描述私有通道/企业字段）

**Interfaces:**
- Consumes: 前 9 个 Task 的最终行为。
- Produces: 版本号 `0.1.0`，文档与实现一致。

- [ ] **Step 1: 更新文档与版本**

CHANGELOG 按“新增 / 修复 / 兼容性 / 文档 / 已知限制”汇总上一个 tag 到 HEAD 的变更；known-limits 写入：无加密、目录无续传、密封消息本地明文、旧数据库重置、特殊文件类型跳过、内嵌图片不插入光标处、GETLIST 价值有限。file-transfer 补目录与图片流程。`package.json` 版本改 `0.1.0`。

- [ ] **Step 2: 全量验证**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
Expected: 全部 PASS，`out/` 生成。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "chore(release): prepare 0.1.0"
```

---

## 完成标准

- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全部通过。
- 两个实例用不同 `LANPOST_DATA_DIR`、端口与 seeds 启动：2 秒内互相可见；关闭一端 1 秒内离线。
- 文字（含 emoji）、密封、广播、多播、单文件、目录、内嵌图片均能完成一次真实往返。
- 目录接收树与发送树一致，空目录保留，恶意路径不越界。
- 联系人页按编组分区，聊天消息模块不出现编组属性。
