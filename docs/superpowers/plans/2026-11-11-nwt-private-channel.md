# 内网通私有通道文字消息 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 与真实内网通 3.4.3055 之间通过私有通道双向收发文字消息，失败时回落现有 IPMSG 路径。

**Architecture:** 在 `src/main/protocol/private/` 下新增 TEA、应用帧、ENet 子集、发现报文、私有 XML、会话状态机与多对端服务；`ProtocolEngine` 增加私有联系人入口，`AppService` 负责路由、消息落库、状态与已读回执。

**Tech Stack:** TypeScript、Node `node:dgram`、Vitest、Electron 44。

**Spec:** `docs/superpowers/specs/2026-11-11-nwt-private-channel-design.md`（协议细节见 `../nwt-re/docs/private-protocol.md`）

## Global Constraints

- 不引入原生模块；ENet 子集用 TypeScript 实现。
- 验证顺序：`pnpm lint` → `pnpm typecheck` → `pnpm test`。
- 协议测试使用随机高端口，禁止占用 2425 与 9011。
- 与真实内网通互通的报文格式以设计文档第 5 节和 `../nwt-re/docs/private-protocol.md` 为准。
- 现有 IPMSG 行为保持不变：没有私有会话时，文字仍走 `SENDMSG`。

## Review Focus

- 对端在握手完成后连续发送多条消息、其中包含分片时，会话按序交付且不丢。
- 长会话里 16 位可靠序号回绕后，可靠通道仍按序交付。
- 收到长度与内容不一致、命令号未知、正文为随机字节的数据报时，进程不崩溃，也不把乱码当文字展示。
- 私有端口被占用或对端不可达时，客户端仍能用 IPMSG 收发文字。
- 同一个 IP 先出现私有会话、后出现 IPMSG 通告时，联系人只有一条，消息不分裂。

---

### Task 1: TEA 加解密

**Files:**
- Create: `src/main/protocol/private/tea.ts`
- Test: `src/main/protocol/private/tea.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export const TEA_KEY: Buffer`
  - `export function encryptBlock(block: Buffer): Buffer`
  - `export function decryptBlock(block: Buffer): Buffer`
  - `export function encryptBody(plain: Buffer): Buffer`
  - `export function decryptBody(cipher: Buffer): Buffer`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { decryptBody, encryptBody } from './tea'

describe('tea', () => {
  it('matches the captured heartbeat frame', () => {
    const plain = Buffer.from('<X_HEARTBEAT docver="1" />', 'utf8')
    expect(encryptBody(plain).toString('hex')).toBe(
      'd529c5439de045c9d3dc11866769e1fedfa896e8e704a5532f3e'
    )
  })

  it('matches captured 8-byte block vectors', () => {
    expect(encryptBody(Buffer.from('<X_READY')).toString('hex')).toBe('5f4d1ebae1485eae')
    expect(encryptBody(Buffer.from(' docver=')).toString('hex')).toBe('3a643fa23c20e0ae')
    expect(encryptBody(Buffer.from('<X_SEND_')).toString('hex')).toBe('69e9b754d98ba061')
    expect(encryptBody(Buffer.from('TE_SEND_')).toString('hex')).toBe('ed84465aa4ec9d10')
  })

  it('leaves the trailing partial block in plaintext and round-trips', () => {
    const plain = Buffer.from(
      '<X_READY docver="1"><USER_ID>68e24da0fa70794981775dd7dbfb7c6f</USER_ID><PARAM>0</PARAM></X_READY>',
      'utf8'
    )
    const cipher = encryptBody(plain)
    expect(cipher.length).toBe(plain.length)
    expect(cipher.subarray(96).toString('hex')).toBe('3e')
    expect(decryptBody(cipher).equals(plain)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/tea.test.ts`
Expected: FAIL，提示找不到模块 `./tea`

- [ ] **Step 3: Implement `tea.ts`**

按 8 字节分组；每块先把 v0、v1、key 的四个字按大端解释（等价于小端读出后 `bswap32`），32 轮 TEA，delta `0x9e3779b9`，结束后按大端写回；`encryptBody`/`decryptBody` 只处理 `len - (len % 8)` 字节，尾部原样拷贝。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/tea.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/tea.ts src/main/protocol/private/tea.test.ts
git commit -m "feat: add private channel TEA codec"
```

---

### Task 2: 应用帧

**Files:**
- Create: `src/main/protocol/private/frame.ts`
- Test: `src/main/protocol/private/frame.test.ts`

**Interfaces:**
- Consumes: `encryptBody`、`decryptBody`（Task 1）
- Produces:
  - `export class FrameError extends Error`
  - `export function encodeFrame(cmd: number, xml: string): Buffer`
  - `export function decodeFrame(data: Buffer): { cmd: number; xml: string }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { FrameError, decodeFrame, encodeFrame } from './frame'

const HEARTBEAT =
  '00000022000003f8d529c5439de045c9d3dc11866769e1fedfa896e8e704a5532f3e'

describe('frame', () => {
  it('decodes a captured heartbeat frame', () => {
    const frame = decodeFrame(Buffer.from(HEARTBEAT, 'hex'))
    expect(frame.cmd).toBe(1016)
    expect(frame.xml).toBe('<X_HEARTBEAT docver="1" />')
  })

  it('re-encodes to the captured bytes', () => {
    expect(encodeFrame(1016, '<X_HEARTBEAT docver="1" />').toString('hex')).toBe(HEARTBEAT)
  })

  it('rejects a length field that does not match the datagram', () => {
    const raw = Buffer.from(HEARTBEAT, 'hex')
    expect(() => decodeFrame(raw.subarray(0, raw.length - 1))).toThrow(FrameError)
  })

  it('rejects a datagram shorter than the header', () => {
    expect(() => decodeFrame(Buffer.from('00000001', 'hex'))).toThrow(FrameError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/frame.test.ts`
Expected: FAIL，提示找不到模块 `./frame`

- [ ] **Step 3: Implement `frame.ts`**

`encodeFrame` 写大端 `u32 总长 = 8 + 正文字节数`、大端 `u32 命令号`、`encryptBody(utf8 正文)`；`decodeFrame` 校验总长等于数据报长度、总长不小于 8，否则抛 `FrameError`，正文用 `decryptBody` 解出后按 UTF-8 解码。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/frame.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/frame.ts src/main/protocol/private/frame.test.ts
git commit -m "feat: add private channel frame codec"
```

---

### Task 3: ENet 报文编解码

**Files:**
- Create: `src/main/protocol/private/enet.ts`
- Test: `src/main/protocol/private/enet.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - 常量：`ENET_CMD_ACK=0x01`、`ENET_CMD_CONNECT=0x02`、`ENET_CMD_VERIFY=0x03`、`ENET_CMD_PING=0x05`、`ENET_CMD_SEND_RELIABLE=0x06`、`ENET_CMD_SEND_FRAGMENT=0x08`、`ENET_CMD_BANDWIDTH=0x0a`、`ENET_FLAG_ACK=0x80`、`ENET_MTU=1400`、`ENET_MAX_PAYLOAD=1280`
  - `export interface EnetCommand { command: number; channelId: number; reliableSeq: number; payload: Buffer }`
  - `export function encodeDatagram(peerId: number, sentTime: number, commands: EnetCommand[]): Buffer`
  - `export function decodeDatagram(data: Buffer): { peerId: number; sentTime: number | null; commands: EnetCommand[] }`
  - `export function buildConnectPayload(connectId: number): Buffer`
  - `export function parseConnectPayload(payload: Buffer): { connectId: number; mtu: number }`
  - `export function buildVerifyPayload(assignedPeerId: number, connectId: number): Buffer`
  - `export function parseVerifyPayload(payload: Buffer): { peerId: number; connectId: number }`
  - `export function buildReliablePayload(data: Buffer): Buffer`
  - `export function parseReliablePayload(payload: Buffer): Buffer`
  - `export function buildFragmentPayload(input: { startSeq: number; fragmentCount: number; fragmentNumber: number; totalLength: number; offset: number; data: Buffer }): Buffer`
  - `export function parseFragmentPayload(payload: Buffer): { startSeq: number; fragmentCount: number; fragmentNumber: number; totalLength: number; offset: number; data: Buffer }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  ENET_CMD_PING,
  ENET_CMD_SEND_FRAGMENT,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  buildFragmentPayload,
  buildVerifyPayload,
  decodeDatagram,
  encodeDatagram,
  parseFragmentPayload,
  parseVerifyPayload
} from './enet'

const CONNECT_DATAGRAM =
  '8fffd03082ff00010000ffff0000057800010000000000010000000000000000000013880000000200000002e417824b00000000'
const VERIFY_DATAGRAM =
  '8000ca1b83ff0001000100000000057800010000000000010000000000000000000013880000000200000002e417824b'

describe('enet codec', () => {
  it('decodes the captured connect datagram', () => {
    const d = decodeDatagram(Buffer.from(CONNECT_DATAGRAM, 'hex'))
    expect(d.peerId).toBe(0x0fff)
    expect(d.sentTime).toBe(0xd030)
    expect(d.commands).toHaveLength(1)
    expect(d.commands[0].command).toBe(0x02 | ENET_FLAG_ACK)
    expect(d.commands[0].reliableSeq).toBe(1)
    expect(d.commands[0].payload.length).toBe(44)
  })

  it('re-encodes the captured verify datagram', () => {
    const d = decodeDatagram(Buffer.from(VERIFY_DATAGRAM, 'hex'))
    expect(d.commands[0].command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
    expect(parseVerifyPayload(d.commands[0].payload)).toEqual({
      peerId: 1,
      connectId: 0xe417824b
    })
    expect(encodeDatagram(d.peerId, d.sentTime ?? 0, d.commands).toString('hex')).toBe(
      VERIFY_DATAGRAM
    )
    expect(buildVerifyPayload(1, 0xe417824b).equals(d.commands[0].payload)).toBe(true)
  })

  it('parses a captured fragment header', () => {
    const hex = '80006a0f880000010001055c00000002000000000000061e00000000'
    const d = decodeDatagram(Buffer.from(hex, 'hex'))
    const frag = parseFragmentPayload(d.commands[0].payload)
    expect(d.commands[0].command).toBe(ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK)
    expect(frag).toMatchObject({
      startSeq: 1,
      fragmentCount: 2,
      fragmentNumber: 0,
      totalLength: 0x61e,
      offset: 0
    })
  })

  it('round-trips a constructed fragment', () => {
    const payload = buildFragmentPayload({
      startSeq: 5,
      fragmentCount: 2,
      fragmentNumber: 1,
      totalLength: 100,
      offset: 44,
      data: Buffer.from('tail')
    })
    const parsed = parseFragmentPayload(payload)
    expect(parsed).toMatchObject({
      startSeq: 5,
      fragmentCount: 2,
      fragmentNumber: 1,
      totalLength: 100,
      offset: 44
    })
    expect(parsed.data.toString()).toBe('tail')
  })

  it('builds a ping command with the ack flag', () => {
    const raw = encodeDatagram(0x8001, 0x1234, [
      { command: ENET_CMD_PING | ENET_FLAG_ACK, channelId: 0xff, reliableSeq: 2, payload: Buffer.alloc(0) }
    ])
    expect(raw.toString('hex')).toBe('8001123485ff0002')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/enet.test.ts`
Expected: FAIL，提示找不到模块 `./enet`

- [ ] **Step 3: Implement `enet.ts`**

头部 `u16 peerID | u16 sentTime`，命令头 `u8 命令 | u8 通道 | u16 可靠序号`；`encodeDatagram` 的 `peerId` 参数传入时不带 0x8000，编码时自动置位；`decodeDatagram` 支持一个数据报里多条命令。CONNECT 载荷按抓包 44 字节字段顺序，VERIFY 载荷 40 字节且不含末尾 data 字段。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/enet.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/enet.ts src/main/protocol/private/enet.test.ts
git commit -m "feat: add enet packet codec"
```

---

### Task 4: 可靠通道与分片

**Files:**
- Modify: `src/main/protocol/private/enet.ts`
- Test: `src/main/protocol/private/reliable.test.ts`

**Interfaces:**
- Consumes: Task 3 的编解码函数与常量
- Produces:
  - `export interface ReliableOptions { peerId: number; send: (data: Buffer) => void; now?: () => number; retransmitMs?: number; maxRetries?: number; initialSeq?: number }`
  - `export class ReliableEnd { constructor(options: ReliableOptions); send(data: Buffer): void; receive(datagram: Buffer): Buffer[]; pump(): void; get pendingCount(): number }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { ReliableEnd } from './enet'

function makePair(initialSeq?: number) {
  let clock = 1000
  const aOut: Buffer[] = []
  const bOut: Buffer[] = []
  const a = new ReliableEnd({ peerId: 1, send: (d) => aOut.push(d), now: () => clock, initialSeq })
  const b = new ReliableEnd({ peerId: 2, send: (d) => bOut.push(d), now: () => clock })
  const flush = (): Buffer[] => {
    const delivered: Buffer[] = []
    while (aOut.length > 0) delivered.push(...b.receive(aOut.shift()!))
    while (bOut.length > 0) delivered.push(...a.receive(bOut.shift()!))
    return delivered
  }
  return { a, b, flush, advance: (ms: number) => (clock += ms) }
}

describe('reliable end', () => {
  it('delivers in order and acks', () => {
    const { a, flush } = makePair()
    a.send(Buffer.from('one'))
    a.send(Buffer.from('two'))
    expect(flush().map((b) => b.toString())).toEqual(['one', 'two'])
  })

  it('retransmits until acked', () => {
    const sent: Buffer[] = []
    let clock = 0
    const a = new ReliableEnd({ peerId: 1, send: (d) => sent.push(d), now: () => clock })
    a.send(Buffer.from('x'))
    expect(sent).toHaveLength(1)
    clock += 500
    a.pump()
    expect(sent).toHaveLength(2)
    expect(a.pendingCount).toBe(1)
  })

  it('reassembles fragments', () => {
    const { a, flush } = makePair()
    a.send(Buffer.alloc(3000, 7))
    const delivered = flush()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].length).toBe(3000)
  })

  it('survives 16-bit sequence wrap', () => {
    const { a, flush } = makePair(65534)
    a.send(Buffer.from('x'))
    a.send(Buffer.from('y'))
    a.send(Buffer.from('z'))
    expect(flush().map((b) => b.toString())).toEqual(['x', 'y', 'z'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/reliable.test.ts`
Expected: FAIL，提示 `ReliableEnd` 未导出

- [ ] **Step 3: Implement `ReliableEnd`**

在同一文件里补充：通道 0 的自增序号；未确认队列（发出时间、重试次数），`pump()` 在超过 `retransmitMs`（默认 500）后重发，1.5 倍退避，`maxRetries`（默认 6）后丢弃；`receive` 对要求 ACK 的命令回 ACK，按 16 位序号比较规则按序交付，超过 `ENET_MAX_PAYLOAD` 的消息用 SEND_FRAGMENT 拆分，按 `startSeq + offset` 重组；增加 `drain(): Buffer[]` 返回并清空已交付消息。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/reliable.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/enet.ts src/main/protocol/private/reliable.test.ts
git commit -m "feat: add enet reliable channel and fragment reassembly"
```

---

### Task 5: 发现报文

**Files:**
- Create: `src/main/protocol/private/beacon.ts`
- Test: `src/main/protocol/private/beacon.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export interface DiscoveryBeacon { type: number; ip: string; ports: { beacon: number; tcp: number; enet: number }; userId: string; peerId: Buffer; enetPort: number }`
  - `export function decodeBeacon(data: Buffer): DiscoveryBeacon | null`
  - `export function encodeBeacon(input: { type: number; ip: string; broadcast: string; userId: string; peerId: Buffer; enetPort: number; beaconPort?: number }): Buffer`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { decodeBeacon, encodeBeacon } from './beacon'

const BEACON_HEX =
  '0000013000000001000000016adad709c0a80087c0a800ff2333233423343638653234646130666137303739343938313737356464376462666237633666000000000000000000000000000000000000000000000000000000000000000000da677fe4558fa381c8033e883c1dd99488000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f400d43a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

describe('beacon', () => {
  it('decodes the captured beacon', () => {
    const raw = Buffer.from(BEACON_HEX, 'hex')
    expect(raw.length).toBe(304)
    expect(decodeBeacon(raw)).toMatchObject({
      type: 1,
      ip: '192.168.0.135',
      ports: { beacon: 9011, tcp: 9012, enet: 9012 },
      userId: '68e24da0fa70794981775dd7dbfb7c6f',
      enetPort: 54330
    })
  })

  it('round-trips a hello message', () => {
    const peerId = Buffer.alloc(16, 0xab)
    const raw = encodeBeacon({
      type: 4,
      ip: '192.168.1.20',
      broadcast: '192.168.1.255',
      userId: '0123456789abcdef0123456789abcdef',
      peerId,
      enetPort: 54321
    })
    expect(raw.length).toBe(304)
    expect(decodeBeacon(raw)).toMatchObject({
      type: 4,
      ip: '192.168.1.20',
      userId: '0123456789abcdef0123456789abcdef',
      enetPort: 54321
    })
    expect(decodeBeacon(raw)?.peerId.equals(peerId)).toBe(true)
  })

  it('rejects wrong lengths and mismatched length fields', () => {
    const raw = Buffer.from(BEACON_HEX, 'hex')
    expect(decodeBeacon(raw.subarray(0, 300))).toBeNull()
    const broken = Buffer.from(raw)
    broken.writeUInt32BE(999, 0)
    expect(decodeBeacon(broken)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/beacon.test.ts`
Expected: FAIL，提示找不到模块 `./beacon`

- [ ] **Step 3: Implement `beacon.ts`**

按设计文档第 5 节的偏移读写：0x04 类型、0x10 IP、0x18/0x1a/0x1c 三个大端 u16、0x1e 32 字节用户标识、0x5f 16 字节标识、0xa5 大端 u16 ENet 端口；编码时清零其余字节，`beaconPort` 默认 9011。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/beacon.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/beacon.ts src/main/protocol/private/beacon.test.ts
git commit -m "feat: add private discovery beacon codec"
```

---

### Task 6: 私有 XML 与文字 JSON

**Files:**
- Create: `src/main/protocol/private/messages.ts`
- Test: `src/main/protocol/private/messages.test.ts`

**Interfaces:**
- Consumes: `src/main/protocol/xml.ts` 的 `encodeChatMsg`、`encodeChatMsgAck`、`encodeChatReceipt`、`encodeReady`、`encodeHeartbeat`、`encodeQuit`、`decodeXml`；`src/main/protocol/packet.ts` 的 `DOCVER`；`./beacon` 的 `encodeBeacon`
- Produces:
  - `export interface PrivateProfile { name: string; group: string; corporation: string; department: string; sign: string; status: number }`
  - `export interface RemoteProfile extends PrivateProfile { userId: string }`
  - `export function helloFrame(input: { ip: string; broadcast: string; userId: string; peerId: Buffer; enetPort: number }): Buffer`
  - `export function handshakeXml(profile: PrivateProfile, userId: string): string`
  - `export function readyXml(userId: string): string`
  - `export function sendMsgXml(msgId: number, text: string): string`
  - `export function sendMsgAckXml(msgId: number): string`
  - `export function sendReceiptXml(msgId: number): string`
  - `export function heartbeatXml(): string`
  - `export function quitXml(): string`
  - `export type IncomingPrivate = { kind: 'text'; msgId: number; text: string } | { kind: 'text-unsupported'; msgId: number } | { kind: 'ack'; msgId: number } | { kind: 'receipt'; msgId: number } | { kind: 'handshake'; profile: RemoteProfile } | { kind: 'ready'; userId: string } | { kind: 'heartbeat' } | { kind: 'quit' } | { kind: 'other'; cmd: number }`
  - `export function parsePrivate(cmd: number, xml: string): IncomingPrivate`
  - `export function messageTextJson(text: string): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  helloFrame,
  parsePrivate,
  readyXml,
  sendMsgAckXml,
  sendMsgXml,
  sendReceiptXml
} from './messages'
import { decodeBeacon } from './beacon'

describe('private messages', () => {
  it('builds X_SEND_MSG with the captured JSON shape', () => {
    const xml = sendMsgXml(7, '你好')
    expect(xml).toContain('<MSG_ID>7</MSG_ID>')
    expect(xml).toContain('<RECEIPT>0</RECEIPT>')
    expect(xml).toContain('&quot;app&quot;&nbsp;:&nbsp;&quot;shiyeline&quot;')
    expect(xml).toContain('&quot;v&quot;&nbsp;:&nbsp;&quot;你好&quot;')
    expect(xml).toContain('<MSG_TIME>0</MSG_TIME><OFFLINE>0</OFFLINE><HIDE_RECORD>0</HIDE_RECORD>')
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text', msgId: 7, text: '你好' })
  })

  it('parses ack and receipt', () => {
    expect(parsePrivate(1005, sendMsgAckXml(9))).toEqual({ kind: 'ack', msgId: 9 })
    expect(parsePrivate(1006, sendReceiptXml(9))).toEqual({ kind: 'receipt', msgId: 9 })
  })

  it('parses X_READY and heartbeat', () => {
    expect(parsePrivate(1018, readyXml('abc'))).toEqual({ kind: 'ready', userId: 'abc' })
    expect(parsePrivate(1016, heartbeatXml())).toEqual({ kind: 'heartbeat' })
  })

  it('builds a 304-byte type 4 hello', () => {
    const peerId = Buffer.alloc(16, 0x5a)
    const raw = helloFrame({
      ip: '192.168.1.20',
      broadcast: '192.168.1.255',
      userId: '0123456789abcdef0123456789abcdef',
      peerId,
      enetPort: 54321
    })
    expect(raw.length).toBe(304)
    expect(decodeBeacon(raw)).toMatchObject({ type: 4, ip: '192.168.1.20', enetPort: 54321 })
  })

  it('ignores messages without text content', () => {
    const xml =
      '<X_SEND_MSG docver="1"><MSG_ID>3</MSG_ID><RECEIPT>0</RECEIPT><MSG>{&quot;app&quot;:&quot;shiyeline&quot;,&quot;dt&quot;:[{&quot;img&quot;:{&quot;v&quot;:&quot;x&quot;}}]}</MSG></X_SEND_MSG>'
    expect(parsePrivate(1004, xml)).toEqual({ kind: 'text-unsupported', msgId: 3 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/messages.test.ts`
Expected: FAIL，提示找不到模块 `./messages`

- [ ] **Step 3: Implement `messages.ts`**

`messageTextJson` 生成与抓包同形的 JSON：`app`、`dt[0].txt.t/v`、`ft`（`微软雅黑`、字号 9、其余 `0`）、`id`（32 位十六进制随机）、`type="0"`、`ver="6.0"`，缩进与空格写成 `&nbsp;`、引号写成 `&quot;`；`sendMsgXml` 用 `encodeChatMsg`，`Msg` 为上述 JSON，`Receipt=0`、`MsgTime=0`、`Offline=0`、`HideRecord=0`。`handshakeXml` 用现有 `encodeHandshake`，FEATURE 只有 `MSG: "2:1"` 与 `HideRecord: "1"`，其余能力位与 NET 端口为 0，`CORP_ID` 用传入的 userId。接收侧用 `decodeXml`，`MSG` 先反转义 `&nbsp;` 为空格、`&quot;` 为引号，再 `JSON.parse`，拼接所有 `dt[].txt.v`；解析失败或无文字时返回 `text-unsupported`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/messages.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/messages.ts src/main/protocol/private/messages.test.ts
git commit -m "feat: add private xml messages and text json"
```

---

### Task 7: 会话状态机

**Files:**
- Create: `src/main/protocol/private/session.ts`
- Test: `src/main/protocol/private/session.test.ts`

**Interfaces:**
- Consumes: Task 1–6
- Produces:
  - `export type SessionState = 'idle' | 'connecting' | 'verifying' | 'handshaking' | 'ready' | 'closed'`
  - `export interface SessionCallbacks { onText(msgId: number, text: string): void; onUnsupported(msgId: number): void; onAck(msgId: number): void; onReceipt(msgId: number): void; onProfile(profile: RemoteProfile): void; onState(state: SessionState): void; onLog(message: string): void }`
  - `export class PrivateSession { constructor(opts: { role: 'client' | 'server'; remoteIp: string; remotePort: number; localIp: string; localPort: number; identity: { userId: string; peerId: Buffer }; profile: PrivateProfile; send: (data: Buffer) => void; now?: () => number; callbacks: SessionCallbacks }); start(): void; receive(data: Buffer): void; pump(): void; sendText(msgId: number, text: string): boolean; sendReceipt(msgId: number): void; close(): void; readonly state: SessionState }`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import type { PrivateProfile } from './messages'
import { PrivateSession } from './session'

const profile: PrivateProfile = {
  name: '本机',
  group: '',
  corporation: '',
  department: '',
  sign: '',
  status: 0
}

function makeSession(
  role: 'client' | 'server',
  send: (data: Buffer) => void,
  events: string[],
  now: () => number
): PrivateSession {
  return new PrivateSession({
    role,
    remoteIp: '127.0.0.1',
    remotePort: 9012,
    localIp: '127.0.0.1',
    localPort: 19012,
    identity: {
      userId: '0123456789abcdef0123456789abcdef',
      peerId: Buffer.alloc(16, role === 'client' ? 1 : 2)
    },
    profile,
    send,
    now,
    callbacks: {
      onText: (id, text) => events.push(`text:${id}:${text}`),
      onUnsupported: (id) => events.push(`unsupported:${id}`),
      onAck: (id) => events.push(`ack:${id}`),
      onReceipt: (id) => events.push(`receipt:${id}`),
      onProfile: () => events.push('profile'),
      onState: (state) => events.push(`state:${state}`),
      onLog: () => {}
    }
  })
}

describe('private session', () => {
  it('reaches ready on both sides and delivers text', () => {
    let clock = 0
    const toA: Buffer[] = []
    const toB: Buffer[] = []
    const aEvents: string[] = []
    const bEvents: string[] = []
    const a = makeSession('client', (d) => toB.push(d), aEvents, () => clock)
    const b = makeSession('server', (d) => toA.push(d), bEvents, () => clock)
    const flush = (): void => {
      let moved = true
      while (moved) {
        moved = false
        while (toB.length > 0) {
          b.receive(toB.shift()!)
          moved = true
        }
        while (toA.length > 0) {
          a.receive(toA.shift()!)
          moved = true
        }
      }
    }
    a.start()
    flush()
    expect(a.state).toBe('ready')
    expect(b.state).toBe('ready')
    expect(a.sendText(1, 'hi')).toBe(true)
    flush()
    expect(bEvents).toContain('text:1:hi')
    expect(aEvents).toContain('ack:1')
  })

  it('refuses to send before ready and closes after 120s of silence', () => {
    let clock = 0
    const sent: Buffer[] = []
    const session = makeSession('client', (d) => sent.push(d), [], () => clock)
    expect(session.sendText(1, 'hi')).toBe(false)
    session.start()
    clock += 120000
    session.pump()
    expect(session.state).toBe('closed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/session.test.ts`
Expected: FAIL，提示找不到模块 `./session`

- [ ] **Step 3: Implement `session.ts`**

实现第 7 节状态机：客户端 `start()` 发 CONNECT 并进入 `connecting`；收到 VERIFY_CONNECT 后记录 peerID、回 ACK 与 PING、发 hello 与 `X_HANDSHARK`，进入 `handshaking`；收到对端 `X_HANDSHARK` 回 `X_READY`；收到对端 `X_READY` 进入 `ready`。服务端在 `receive` 里处理 CONNECT，分配 peerID 1 并回 VERIFY_CONNECT，收到 ACK 后发 hello 与 `X_HANDSHARK`。`pump()` 处理重传、每 30 秒一次 `X_HEARTBEAT`、120 秒无入站判超时并 `closed`。`sendText` 只在 `ready` 时返回 true，内部用 `encodeFrame(1004, sendMsgXml(...))` 交给 `ReliableEnd.send`。收到 1004 时先回 1005，再回调文字。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/session.ts src/main/protocol/private/session.test.ts
git commit -m "feat: add private session state machine"
```

---

### Task 8: 多对端服务

**Files:**
- Create: `src/main/protocol/private/service.ts`
- Test: `src/main/protocol/private/service.test.ts`

**Interfaces:**
- Consumes: Task 1–7
- Produces:
  - `export interface PrivateServiceOptions { identity: { userId: string; peerId: Buffer }; profile: PrivateProfile; bindAddr: string; beaconPort: number; enetPort: number; localIp?: string; seeds: Array<{ ip: string; port?: number }>; callbacks: { onText(ip: string, msgId: number, text: string): void; onUnsupported(ip: string, msgId: number): void; onAck(ip: string, msgId: number): void; onReceipt(ip: string, msgId: number): void; onState(ip: string, state: SessionState, profile: PrivateProfile | null): void; onLog(message: string): void; onError(error: Error): void } }`
  - `export class PrivateService { constructor(options: PrivateServiceOptions); start(): Promise<void>; stop(): Promise<void>; sendText(ip: string, msgId: number, text: string): boolean; sendReceipt(ip: string, msgId: number): void; isReady(ip: string): boolean; updateProfile(profile: PrivateProfile): void; get localEnetPort(): number }`

- [ ] **Step 1: Write the failing test**

```ts
import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ENET_CMD_CONNECT,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  buildConnectPayload,
  decodeDatagram,
  encodeDatagram
} from './enet'
import { PrivateService, type PrivateServiceOptions } from './service'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

async function fakePeer() {
  const socket = createSocket('udp4')
  const received: Buffer[] = []
  socket.on('message', (data) => received.push(data))
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  cleanups.push(() => socket.close())
  return { socket, port: socket.address().port, received }
}

function options(port: number, callbacks: Partial<PrivateServiceOptions['callbacks']> = {}): PrivateServiceOptions {
  return {
    identity: { userId: '0123456789abcdef0123456789abcdef', peerId: Buffer.alloc(16, 2) },
    profile: { name: '本机', group: '', corporation: '', department: '', sign: '', status: 0 },
    bindAddr: '127.0.0.1',
    beaconPort: 0,
    enetPort: 0,
    localIp: '127.0.0.1',
    seeds: [{ ip: '127.0.0.1', port }],
    callbacks: {
      onText: () => {},
      onUnsupported: () => {},
      onAck: () => {},
      onReceipt: () => {},
      onState: () => {},
      onLog: () => {},
      onError: () => {},
      ...callbacks
    }
  }
}

async function waitFor<T>(probe: () => T | null, timeout = 2000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value !== null) return value
    if (Date.now() - started > timeout) throw new Error('等待私有通道事件超时')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('private service', () => {
  it('connects to a seeded endpoint with a CONNECT', async () => {
    const peer = await fakePeer()
    const service = new PrivateService(options(peer.port))
    await service.start()
    cleanups.push(() => void service.stop())
    const first = await waitFor(() => (peer.received.length > 0 ? peer.received[0] : null))
    const d = decodeDatagram(first)
    expect(d.commands[0].command).toBe(ENET_CMD_CONNECT | ENET_FLAG_ACK)
    expect(service.isReady('127.0.0.1')).toBe(false)
  })

  it('answers an inbound CONNECT and ignores malformed datagrams', async () => {
    const peer = await fakePeer()
    const service = new PrivateService(options(peer.port))
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(Buffer.from('not a packet'), service.localEnetPort, '127.0.0.1')
    peer.socket.send(
      encodeDatagram(0x0fff, 1, [
        {
          command: ENET_CMD_CONNECT | ENET_FLAG_ACK,
          channelId: 0xff,
          reliableSeq: 1,
          payload: buildConnectPayload(0x1234)
        }
      ]),
      service.localEnetPort,
      '127.0.0.1'
    )
    const verify = await waitFor(() => {
      const found = peer.received.find((d) => (d[4] & 0x7f) === ENET_CMD_VERIFY)
      return found ?? null
    })
    const d = decodeDatagram(verify)
    expect(d.commands[0].command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/private/service.test.ts`
Expected: FAIL，提示找不到模块 `./service`

- [ ] **Step 3: Implement `service.ts`**

绑定 ENet 与发现两个 UDP socket（端口 0 表示临时端口，`beaconPort` 为 0 时跳过发现绑定）；`start()` 解析 `seeds` 为远端地址并对每个 seed 建会话发 CONNECT；发现 socket 收到报文后 `decodeBeacon`，类型 1/2 且 `enetPort > 0` 时记录 `ip → enetPort`，该 IP 还没有会话就建客户端会话；不发送任何发现报文。维护 `Map<ip, PrivateSession>` 与 `Map<ip, port>`；ENet socket 收到数据报按远端地址找到会话，否则若是 CONNECT 就新建接收侧会话；`sendText`/`sendReceipt` 转发给会话；`pump()` 由内部 200ms 定时器驱动；`stop()` 关闭会话与 socket；`localEnetPort` 返回 ENet socket 的实际端口。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/private/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/private/service.ts src/main/protocol/private/service.test.ts
git commit -m "feat: add private channel service"
```

---

### Task 9: 设置项与私有标识

**Files:**
- Modify: `src/shared/settings.ts`
- Modify: `src/main/identity.ts`
- Modify: `src/main/identity.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `Settings['identity']['privateId']: string`（默认 `''`）
  - `Settings['network']['privatePort']: number`（默认 `9011`）
  - `Settings['network']['privateSeeds']: string[]`（默认 `[]`）
  - `export function createPrivateId(random?: () => number): string`
  - `export function privateUserId(settings: Settings): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { createPrivateId, privateUserId } from './identity'
import { defaultSettings } from '../shared/settings'

describe('private identity', () => {
  it('generates a 32 character hex id', () => {
    const values = [0.1, 0.2, 0.3, 0.4]
    let index = 0
    const id = createPrivateId(() => values[index++ % values.length])
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('ships defaults for the private channel', () => {
    expect(defaultSettings.identity.privateId).toBe('')
    expect(defaultSettings.network.privatePort).toBe(9011)
    expect(defaultSettings.network.privateSeeds).toEqual([])
  })

  it('prefers the stored private id', () => {
    const settings = structuredClone(defaultSettings)
    settings.identity.privateId = 'abcdefabcdefabcdefabcdefabcdefab'
    expect(privateUserId(settings)).toBe('abcdefabcdefabcdefabcdefabcdefab')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/identity.test.ts`
Expected: FAIL，提示 `createPrivateId` 未导出

- [ ] **Step 3: Implement**

`settings.ts` 增加三个字段与默认值；`identity.ts` 增加 `createPrivateId`（16 次随机字节转十六进制）与 `privateUserId`（有 `privateId` 用它，否则回落到现有 `sha256(account@host)` 前 32 位十六进制）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/identity.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings.ts src/main/identity.ts src/main/identity.test.ts
git commit -m "feat: add private channel settings and identity"
```

---

### Task 10: 联系人表接入私有对端

**Files:**
- Modify: `src/main/protocol/discovery.ts`
- Modify: `src/main/protocol/discovery.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `export interface PrivatePeerSnapshot { ip: string; userId: string; name: string; group: string; corporation: string; department: string; sign: string; status: number; online: boolean }`
  - `ProtocolEngine.upsertPrivatePeer(snapshot: PrivatePeerSnapshot): ProtocolPeer`
  - `ProtocolEngine.markPrivatePeerOffline(ip: string): void`
  - `ProtocolEngine.peerKeyForIp(ip: string): string | null`

- [ ] **Step 1: Write the failing test**

```ts
it('keeps one peer when the private session arrives before IPMSG', async () => {
  const port = await freeUdpPort()
  const recorder = createRecorder()
  const engine = new ProtocolEngine(makeConfig({ port }), recorder.callbacks)
  const raw = await openRawSocket()
  try {
    await engine.start()
    const peer = engine.upsertPrivatePeer({
      ip: '127.0.0.1',
      userId: '0123456789abcdef0123456789abcdef',
      name: '上网机 3',
      group: '',
      corporation: '',
      department: '',
      sign: '',
      status: 0,
      online: true
    })
    expect(peer.key).toBe('127.0.0.1|0123456789abcdef0123456789abcdef')
    expect(engine.peerKeyForIp('127.0.0.1')).toBe(peer.key)

    raw.socket.send(
      Encode({
        seq: 1,
        user: 'account-b',
        host: 'host-b',
        cmd: CMD_ENTRY,
        payload: entryPayload('乙', '', '')
      }),
      port,
      '127.0.0.1'
    )
    await waitFor(() => (recorder.peers.size > 0 ? recorder.peers : null))
    expect([...recorder.peers.keys()]).toEqual([peer.key])
    expect(recorder.peers.get(peer.key)?.name).toBe('乙')
    expect(recorder.peers.get(peer.key)?.online).toBe(true)
  } finally {
    raw.socket.close()
    await engine.stop()
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/protocol/discovery.test.ts`
Expected: FAIL，提示 `upsertPrivatePeer` 不存在

- [ ] **Step 3: Implement**

在 `ProtocolEngine` 增加 `ipIndex: Map<string, string>`；`handle()` 创建联系人前先查 `ipIndex`，命中则复用已有 key；`upsertPrivatePeer` 新建时 key 为 `${ip}|${userId}` 并写入 `ipIndex`，更新资料、`online`、`lastSeen` 后调用 `emitPeers()`；`markPrivatePeerOffline` 把 `online` 置 false；`peerKeyForIp` 返回索引。`sendText`/`sendFiles` 的在线校验不改。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/protocol/discovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol/discovery.ts src/main/protocol/discovery.test.ts
git commit -m "feat: add private peer upsert to protocol engine"
```

---

### Task 11: 消息落库、路由与已读回执

**Files:**
- Modify: `src/main/store/repositories.ts`
- Modify: `src/main/store/repositories.test.ts`
- Modify: `src/main/app-service.ts`

**Interfaces:**
- Consumes: Task 8 的 `PrivateService`，Task 9 的 `createPrivateId`/`privateUserId`，Task 10 的引擎入口
- Produces:
  - `Repositories['messages'].listPrivateIncoming(conversationId: string): MessageInfo[]`
  - `AppService` 私有通道接线（无新导出）

- [ ] **Step 1: Write the failing test**

```ts
it('lists only private incoming messages of a conversation', () => {
  const repos = createRepositories(db) // 复用现有测试夹具
  const conversation = repos.conversations.ensureDirect('127.0.0.1|abc', 'p')
  repos.messages.insertIncoming(conversation.id, 'ipmsg', 1)
  repos.messages.insertIncoming(conversation.id, 'private', 2, 'text', '{"source":"private","msgId":"2"}')
  const rows = repos.messages.listPrivateIncoming(conversation.id)
  expect(rows.map((row) => row.text)).toEqual(['private'])
  expect(rows[0].remoteSeq).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/main/store/repositories.test.ts`
Expected: FAIL，提示 `listPrivateIncoming` 不存在

- [ ] **Step 3: Implement**

`repositories.ts` 增加查询：`direction='in' AND meta LIKE '%"source":"private"%' ORDER BY id`。`app-service.ts` 启动时若 `settings.identity.privateId` 为空，用 `createPrivateId()` 生成并通过 `settings.update({ identity: { privateId } })` 持久化；构造 `PrivateService`（身份、资料、`network.privatePort`、`privateSeeds`、引擎资料），`start()` 在引擎之后启动、`stop()` 在引擎之前关闭；`sendText` 先取到联系人的 IP，`privateService.isReady(ip)` 为真时生成私有消息号（`Date.now() * 1000 + 自增序号 % 1000`，与 `nextFileId` 同一方式），调用 `privateService.sendText(ip, msgId, text)` 并把 `msgId` 作为 `remote_seq` 写库、状态置 `sending`，否则保持现有 `engine.sendText`；`handleIncoming` 增加可选 `meta` 参数并透传给 `insertIncoming`；`onText` 调 `handleIncoming(peerKey, name, text, msgId, '{"source":"private","msgId":"..."}')`；`onAck`/`onReceipt` 调 `handleStatus`（回调里的 IP 先用 `engine.peerKeyForIp(ip)` 换成联系人 key）；`onState` 调 `upsertPrivatePeer` / `markPrivatePeerOffline`；`applySettings` 里把新的资料同步给 `privateService.updateProfile`；`markRead` 在更新数据库前，对 `listPrivateIncoming` 里每条尚未发过回执的消息调用 `privateService.sendReceipt`（已发过的记在实例内 `Set<number>`，只对 `isReady` 为真的会话发）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/main/store/repositories.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/store/repositories.ts src/main/store/repositories.test.ts src/main/app-service.ts
git commit -m "feat: wire private channel into message flow"
```

---

### Task 12: 本机联调与文档

**Files:**
- Modify: `docs/nwt-compatibility.md`
- Modify: `docs/known-limits.md`
- Modify: `docs/protocol-debugging.md`
- Test: `docs/superpowers/plans/2026-11-11-nwt-private-channel.md` 的记录步骤（无自动测试）

**Interfaces:**
- Consumes: 全部前置任务
- Produces: 无

- [ ] **Step 1: 准备运行环境**

```bash
cd /d/wlr/ai/lanpost-im
mkdir -p .dev-data/private-live
cat > .dev-data/private-live/settings.json <<'EOF'
{"version":1,"identity":{"displayName":"联调机","account":"lanpost-test","hostName":"lanpost-test","group":"","corporation":"","department":"","sign":"","status":0,"privateId":"0123456789abcdef0123456789abcdef"},"network":{"port":12425,"bindAddr":"0.0.0.0","subnets":[],"seeds":[],"broadcastInterval":30,"privatePort":19011,"privateSeeds":["127.0.0.1:9012"]},"notify":{},"files":{"receiveDir":""},"appearance":{},"general":{},"storage":{}}
EOF
LANPOST_DATA_DIR=.dev-data/private-live pnpm dev
```

- [ ] **Step 2: 启动内网通样本**

在 `D:/wlr/ai/nwt-re/extracted` 运行 `ShiYeLine.exe`，确认 UDP 9012 处于监听状态。

- [ ] **Step 3: 发送与接收验证**

从客户端向样本联系人发送一条中文消息：样本窗口显示文字；客户端日志出现 `private: ready` 与 `1005`。从样本向客户端发送一条中文消息：客户端消息列表出现文字，状态与未读正常。

- [ ] **Step 4: 记录结果并更新文档**

把联调结论写进 `docs/nwt-compatibility.md` 的兼容矩阵（文字行注明私有通道可用于真实内网通）、`docs/known-limits.md`（移除“私有通道未接入”的描述）与 `docs/protocol-debugging.md`（私有通道一节补链接与结论）。

- [ ] **Step 5: 全量验证与提交**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add docs/nwt-compatibility.md docs/known-limits.md docs/protocol-debugging.md
git commit -m "docs: record private channel interoperability"
```
