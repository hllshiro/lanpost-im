export const ENET_CMD_ACK = 0x01
export const ENET_CMD_CONNECT = 0x02
export const ENET_CMD_VERIFY = 0x03
export const ENET_CMD_PING = 0x05
export const ENET_CMD_SEND_RELIABLE = 0x06
export const ENET_CMD_SEND_FRAGMENT = 0x08
export const ENET_CMD_BANDWIDTH = 0x0a
export const ENET_FLAG_ACK = 0x80
export const ENET_MTU = 1400
export const ENET_MAX_PAYLOAD = 1280

const COMMAND_MASK = 0x7f
const PEER_ID_MASK = 0x7fff
const PEER_ID_FLAG = 0x8000
const DATAGRAM_HEADER_SIZE = 4
const SHORT_DATAGRAM_HEADER_SIZE = 2
const COMMAND_HEADER_SIZE = 4
const CONNECT_PAYLOAD_SIZE = 44
const VERIFY_PAYLOAD_SIZE = 40
const RELIABLE_HEADER_SIZE = 2
const FRAGMENT_HEADER_SIZE = 20
const ACK_PAYLOAD_SIZE = 4
const BANDWIDTH_PAYLOAD_SIZE = 8

const CONNECT_OUTGOING_PEER_ID = 0
const CONNECT_SESSION_NONE = 0xff
const WINDOW_SIZE = 65536
const CHANNEL_COUNT = 1
const PACKET_THROTTLE_INTERVAL = 5000
const PACKET_THROTTLE_ACCELERATION = 2
const PACKET_THROTTLE_DECELERATION = 2

const APPLICATION_CHANNEL_ID = 0
const ACK_CHANNEL_ID = 0xff
const SEQUENCE_HALF = 0x8000
const FIRST_RELIABLE_SEQ = 1
const DEFAULT_RETRANSMIT_MS = 500
const DEFAULT_MAX_RETRIES = 6
const RETRANSMIT_BACKOFF = 1.5

const CONNECT_MTU_OFFSET = 4
const CONNECT_THROTTLE_OFFSET = 24
const CONNECT_ID_OFFSET = 36

export class EnetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EnetError'
  }
}

export interface EnetCommand {
  command: number
  channelId: number
  reliableSeq: number
  payload: Buffer
}

// 命令头之后的载荷长度；可靠与分片命令自带长度字段，其余命令按固定布局计算。
function commandPayloadSize(base: number, data: Buffer, payloadOffset: number): number {
  switch (base) {
    case ENET_CMD_ACK:
      return ACK_PAYLOAD_SIZE
    case ENET_CMD_PING:
      return 0
    case ENET_CMD_BANDWIDTH:
      return BANDWIDTH_PAYLOAD_SIZE
    case ENET_CMD_CONNECT:
      return CONNECT_PAYLOAD_SIZE
    case ENET_CMD_VERIFY:
      return VERIFY_PAYLOAD_SIZE
    case ENET_CMD_SEND_RELIABLE: {
      if (data.length - payloadOffset < RELIABLE_HEADER_SIZE) {
        throw new EnetError('SEND_RELIABLE 命令缺少长度字段')
      }
      return RELIABLE_HEADER_SIZE + data.readUInt16BE(payloadOffset)
    }
    case ENET_CMD_SEND_FRAGMENT: {
      if (data.length - payloadOffset < FRAGMENT_HEADER_SIZE) {
        throw new EnetError('SEND_FRAGMENT 命令缺少分片头')
      }
      return FRAGMENT_HEADER_SIZE + data.readUInt16BE(payloadOffset + 2)
    }
    default:
      throw new EnetError(
        `无法确定命令 0x${base.toString(16)} 的载荷长度，命令偏移 ${payloadOffset - COMMAND_HEADER_SIZE}`
      )
  }
}

export function encodeDatagram(peerId: number, sentTime: number, commands: EnetCommand[]): Buffer {
  const size = commands.reduce(
    (total, command) => total + COMMAND_HEADER_SIZE + command.payload.length,
    DATAGRAM_HEADER_SIZE
  )
  const out = Buffer.alloc(size)
  out.writeUInt16BE((peerId & PEER_ID_MASK) | PEER_ID_FLAG, 0)
  out.writeUInt16BE(sentTime & 0xffff, 2)
  let offset = DATAGRAM_HEADER_SIZE
  for (const command of commands) {
    out.writeUInt8(command.command & 0xff, offset)
    out.writeUInt8(command.channelId & 0xff, offset + 1)
    out.writeUInt16BE(command.reliableSeq & 0xffff, offset + 2)
    command.payload.copy(out, offset + COMMAND_HEADER_SIZE)
    offset += COMMAND_HEADER_SIZE + command.payload.length
  }
  return out
}

export function decodeDatagram(data: Buffer): {
  peerId: number
  sentTime: number | null
  commands: EnetCommand[]
} {
  if (data.length < SHORT_DATAGRAM_HEADER_SIZE) {
    throw new EnetError(`数据报长度 ${data.length} 小于头部长度 ${SHORT_DATAGRAM_HEADER_SIZE}`)
  }
  const rawPeerId = data.readUInt16BE(0)
  const hasSentTime = (rawPeerId & PEER_ID_FLAG) !== 0
  const headerSize = hasSentTime ? DATAGRAM_HEADER_SIZE : SHORT_DATAGRAM_HEADER_SIZE
  if (data.length < headerSize) {
    throw new EnetError(`数据报长度 ${data.length} 小于头部长度 ${headerSize}`)
  }
  const peerId = rawPeerId & PEER_ID_MASK
  const sentTime = hasSentTime ? data.readUInt16BE(2) : null
  const commands: EnetCommand[] = []
  let offset = headerSize
  while (offset < data.length) {
    if (data.length - offset < COMMAND_HEADER_SIZE) {
      throw new EnetError(`偏移 ${offset} 处的命令头不足 ${COMMAND_HEADER_SIZE} 字节`)
    }
    const command = data.readUInt8(offset)
    const channelId = data.readUInt8(offset + 1)
    const reliableSeq = data.readUInt16BE(offset + 2)
    const payloadOffset = offset + COMMAND_HEADER_SIZE
    const base = command & COMMAND_MASK
    const payloadSize = commandPayloadSize(base, data, payloadOffset)
    if (payloadOffset + payloadSize > data.length) {
      throw new EnetError(
        `命令 0x${command.toString(16)} 载荷 ${payloadSize} 字节超出数据报剩余长度`
      )
    }
    commands.push({
      command,
      channelId,
      reliableSeq,
      payload: Buffer.from(data.subarray(payloadOffset, payloadOffset + payloadSize))
    })
    offset = payloadOffset + payloadSize
  }
  return { peerId, sentTime, commands }
}

export function buildAckPayload(receivedSeq: number, sentTime: number): Buffer {
  const payload = Buffer.alloc(ACK_PAYLOAD_SIZE)
  payload.writeUInt16BE(receivedSeq & 0xffff, 0)
  payload.writeUInt16BE(sentTime & 0xffff, 2)
  return payload
}

export function parseAckPayload(payload: Buffer): { receivedSeq: number; sentTime: number } {
  if (payload.length < ACK_PAYLOAD_SIZE) {
    throw new EnetError(`ACK 载荷长度 ${payload.length} 小于 ${ACK_PAYLOAD_SIZE}`)
  }
  return {
    receivedSeq: payload.readUInt16BE(0),
    sentTime: payload.readUInt16BE(2)
  }
}

export function buildConnectPayload(connectId: number): Buffer {
  const payload = Buffer.alloc(CONNECT_PAYLOAD_SIZE)
  payload.writeUInt16BE(CONNECT_OUTGOING_PEER_ID, 0)
  payload.writeUInt8(CONNECT_SESSION_NONE, 2)
  payload.writeUInt8(CONNECT_SESSION_NONE, 3)
  payload.writeUInt32BE(ENET_MTU, CONNECT_MTU_OFFSET)
  payload.writeUInt32BE(WINDOW_SIZE, 8)
  payload.writeUInt32BE(CHANNEL_COUNT, 12)
  payload.writeUInt32BE(PACKET_THROTTLE_INTERVAL, CONNECT_THROTTLE_OFFSET)
  payload.writeUInt32BE(PACKET_THROTTLE_ACCELERATION, 28)
  payload.writeUInt32BE(PACKET_THROTTLE_DECELERATION, 32)
  payload.writeUInt32BE(connectId, CONNECT_ID_OFFSET)
  return payload
}

export function parseConnectPayload(payload: Buffer): { connectId: number; mtu: number } {
  if (payload.length < CONNECT_PAYLOAD_SIZE) {
    throw new EnetError(`CONNECT 载荷长度 ${payload.length} 小于 ${CONNECT_PAYLOAD_SIZE}`)
  }
  return {
    connectId: payload.readUInt32BE(CONNECT_ID_OFFSET),
    mtu: payload.readUInt32BE(CONNECT_MTU_OFFSET)
  }
}

export function buildVerifyPayload(assignedPeerId: number, connectId: number): Buffer {
  const payload = Buffer.alloc(VERIFY_PAYLOAD_SIZE)
  payload.writeUInt16BE(assignedPeerId & 0xffff, 0)
  payload.writeUInt32BE(ENET_MTU, CONNECT_MTU_OFFSET)
  payload.writeUInt32BE(WINDOW_SIZE, 8)
  payload.writeUInt32BE(CHANNEL_COUNT, 12)
  payload.writeUInt32BE(PACKET_THROTTLE_INTERVAL, CONNECT_THROTTLE_OFFSET)
  payload.writeUInt32BE(PACKET_THROTTLE_ACCELERATION, 28)
  payload.writeUInt32BE(PACKET_THROTTLE_DECELERATION, 32)
  payload.writeUInt32BE(connectId, CONNECT_ID_OFFSET)
  return payload
}

export function parseVerifyPayload(payload: Buffer): { peerId: number; connectId: number } {
  if (payload.length < VERIFY_PAYLOAD_SIZE) {
    throw new EnetError(`VERIFY_CONNECT 载荷长度 ${payload.length} 小于 ${VERIFY_PAYLOAD_SIZE}`)
  }
  return {
    peerId: payload.readUInt16BE(0),
    connectId: payload.readUInt32BE(CONNECT_ID_OFFSET)
  }
}

export function buildReliablePayload(data: Buffer): Buffer {
  if (data.length > 0xffff) {
    throw new EnetError(`SEND_RELIABLE 数据长度 ${data.length} 超出 16 位上限`)
  }
  const payload = Buffer.alloc(RELIABLE_HEADER_SIZE + data.length)
  payload.writeUInt16BE(data.length, 0)
  data.copy(payload, RELIABLE_HEADER_SIZE)
  return payload
}

export function parseReliablePayload(payload: Buffer): Buffer {
  if (payload.length < RELIABLE_HEADER_SIZE) {
    throw new EnetError(`SEND_RELIABLE 载荷长度 ${payload.length} 小于 ${RELIABLE_HEADER_SIZE}`)
  }
  const length = payload.readUInt16BE(0)
  if (RELIABLE_HEADER_SIZE + length > payload.length) {
    throw new EnetError(`SEND_RELIABLE 声明长度 ${length} 超出载荷 ${payload.length}`)
  }
  return Buffer.from(payload.subarray(RELIABLE_HEADER_SIZE, RELIABLE_HEADER_SIZE + length))
}

export function buildFragmentPayload(input: {
  startSeq: number
  fragmentCount: number
  fragmentNumber: number
  totalLength: number
  offset: number
  data: Buffer
}): Buffer {
  if (input.data.length > 0xffff) {
    throw new EnetError(`分片数据长度 ${input.data.length} 超出 16 位上限`)
  }
  const payload = Buffer.alloc(FRAGMENT_HEADER_SIZE + input.data.length)
  payload.writeUInt16BE(input.startSeq & 0xffff, 0)
  payload.writeUInt16BE(input.data.length, 2)
  payload.writeUInt32BE(input.fragmentCount, 4)
  payload.writeUInt32BE(input.fragmentNumber, 8)
  payload.writeUInt32BE(input.totalLength, 12)
  payload.writeUInt32BE(input.offset, 16)
  input.data.copy(payload, FRAGMENT_HEADER_SIZE)
  return payload
}

export function parseFragmentPayload(payload: Buffer): {
  startSeq: number
  fragmentCount: number
  fragmentNumber: number
  totalLength: number
  offset: number
  data: Buffer
} {
  if (payload.length < FRAGMENT_HEADER_SIZE) {
    throw new EnetError(`SEND_FRAGMENT 载荷长度 ${payload.length} 小于 ${FRAGMENT_HEADER_SIZE}`)
  }
  return {
    startSeq: payload.readUInt16BE(0),
    fragmentCount: payload.readUInt32BE(4),
    fragmentNumber: payload.readUInt32BE(8),
    totalLength: payload.readUInt32BE(12),
    offset: payload.readUInt32BE(16),
    data: Buffer.from(payload.subarray(FRAGMENT_HEADER_SIZE))
  }
}

export interface ReliableOptions {
  // 本端在对端侧的编号，写入每个数据报头部；VERIFY_CONNECT 握手时确定
  peerId: number
  send: (data: Buffer) => void
  now?: () => number
  retransmitMs?: number
  maxRetries?: number
  // 通道 0 的第一个可靠序号；ENet 从 1 开始
  initialSeq?: number
}

interface OutboundCommand {
  seq: number
  command: EnetCommand
  sentAt: number
  retries: number
}

interface FragmentGroup {
  fragmentCount: number
  totalLength: number
  data: Buffer
  numbers: Set<number>
}

// 16 位序号比较：候选是否比参照更晚（含回绕）
function isNewerSequence(candidate: number, reference: number): boolean {
  const delta = (candidate - reference) & 0xffff
  return delta !== 0 && delta < SEQUENCE_HALF
}

// 单通道（通道 0）可靠传输：自增序号、重传、ACK、分片拆分与重组、按序交付
export class ReliableEnd {
  private readonly peerId: number
  private readonly sendRaw: (data: Buffer) => void
  private readonly now: () => number
  private readonly retransmitMs: number
  private readonly maxRetries: number
  private nextSeq: number
  private readonly pending = new Map<number, OutboundCommand>()
  // 对端第一个可靠命令的序号作为交付起点：本层看不到握手过程，无法预先得知对端起始序号
  private expectedSeq: number | null = null
  private readonly received = new Map<number, EnetCommand>()
  private readonly fragments = new Map<number, FragmentGroup>()

  constructor(options: ReliableOptions) {
    this.peerId = options.peerId
    this.sendRaw = options.send
    this.now = options.now ?? Date.now
    this.retransmitMs = options.retransmitMs ?? DEFAULT_RETRANSMIT_MS
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.nextSeq = options.initialSeq ?? FIRST_RELIABLE_SEQ
  }

  get pendingCount(): number {
    return this.pending.size
  }

  send(data: Buffer): void {
    if (data.length <= ENET_MAX_PAYLOAD) {
      this.transmit({
        command: ENET_CMD_SEND_RELIABLE | ENET_FLAG_ACK,
        channelId: APPLICATION_CHANNEL_ID,
        reliableSeq: this.allocateSequence(),
        payload: buildReliablePayload(data)
      })
      return
    }
    const fragmentCount = Math.ceil(data.length / ENET_MAX_PAYLOAD)
    const startSeq = this.allocateSequence()
    this.nextSeq = (startSeq + fragmentCount) & 0xffff
    for (let index = 0; index < fragmentCount; index += 1) {
      const offset = index * ENET_MAX_PAYLOAD
      const chunk = data.subarray(offset, Math.min(offset + ENET_MAX_PAYLOAD, data.length))
      this.transmit({
        command: ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK,
        channelId: APPLICATION_CHANNEL_ID,
        reliableSeq: (startSeq + index) & 0xffff,
        payload: buildFragmentPayload({
          startSeq,
          fragmentCount,
          fragmentNumber: index,
          totalLength: data.length,
          offset,
          data: chunk
        })
      })
    }
  }

  receive(datagram: Buffer): Buffer[] {
    const { sentTime, commands } = decodeDatagram(datagram)
    const delivered: Buffer[] = []
    for (const command of commands) {
      const base = command.command & COMMAND_MASK
      if (base === ENET_CMD_ACK) {
        this.acknowledge(command.payload)
        continue
      }
      if ((command.command & ENET_FLAG_ACK) !== 0) {
        this.sendAck(command.reliableSeq, sentTime ?? 0)
      }
      if (base === ENET_CMD_SEND_RELIABLE || base === ENET_CMD_SEND_FRAGMENT) {
        this.accept(command, delivered)
      }
    }
    return delivered
  }

  pump(): void {
    const now = this.now()
    for (const entry of this.pending.values()) {
      const interval = this.retransmitMs * RETRANSMIT_BACKOFF ** entry.retries
      if (now - entry.sentAt < interval) continue
      if (entry.retries >= this.maxRetries) {
        this.pending.delete(entry.seq)
        continue
      }
      entry.retries += 1
      entry.sentAt = now
      this.sendDatagram(entry.command)
    }
  }

  private allocateSequence(): number {
    const seq = this.nextSeq
    this.nextSeq = (this.nextSeq + 1) & 0xffff
    return seq
  }

  private transmit(command: EnetCommand): void {
    this.pending.set(command.reliableSeq, {
      seq: command.reliableSeq,
      command,
      sentAt: this.now(),
      retries: 0
    })
    this.sendDatagram(command)
  }

  private sendDatagram(command: EnetCommand): void {
    this.sendRaw(encodeDatagram(this.peerId, this.now() & 0xffff, [command]))
  }

  private sendAck(seq: number, peerSentTime: number): void {
    this.sendRaw(
      encodeDatagram(this.peerId, this.now() & 0xffff, [
        {
          command: ENET_CMD_ACK,
          channelId: ACK_CHANNEL_ID,
          reliableSeq: seq,
          payload: buildAckPayload(seq, peerSentTime)
        }
      ])
    )
  }

  private acknowledge(payload: Buffer): void {
    const { receivedSeq } = parseAckPayload(payload)
    this.pending.delete(receivedSeq)
  }

  // 按 16 位序号顺序交付；乱序命令缓存到缺口补齐
  private accept(command: EnetCommand, delivered: Buffer[]): void {
    const seq = command.reliableSeq
    let expected = this.expectedSeq
    if (expected === null) expected = seq
    if (seq === expected) {
      this.dispatch(command, delivered)
      this.expectedSeq = (seq + 1) & 0xffff
      this.drain(delivered)
      return
    }
    if (isNewerSequence(seq, expected)) {
      this.received.set(seq, command)
    }
  }

  private drain(delivered: Buffer[]): void {
    let expected = this.expectedSeq
    while (expected !== null) {
      const command = this.received.get(expected)
      if (command === undefined) break
      this.received.delete(expected)
      this.dispatch(command, delivered)
      expected = (expected + 1) & 0xffff
    }
    this.expectedSeq = expected
  }

  private dispatch(command: EnetCommand, delivered: Buffer[]): void {
    const base = command.command & COMMAND_MASK
    if (base === ENET_CMD_SEND_RELIABLE) {
      delivered.push(parseReliablePayload(command.payload))
      return
    }
    const fragment = parseFragmentPayload(command.payload)
    if (fragment.fragmentCount === 0 || fragment.fragmentNumber >= fragment.fragmentCount) {
      throw new EnetError(
        `分片编号 ${fragment.fragmentNumber} 超出分片总数 ${fragment.fragmentCount}`
      )
    }
    if (fragment.totalLength > fragment.fragmentCount * ENET_MTU) {
      throw new EnetError(
        `分片总长 ${fragment.totalLength} 超出 ${fragment.fragmentCount} 片按 MTU ${ENET_MTU} 计算的上限`
      )
    }
    if (fragment.offset + fragment.data.length > fragment.totalLength) {
      throw new EnetError(
        `分片偏移 ${fragment.offset} 加数据长度 ${fragment.data.length} 超出总长 ${fragment.totalLength}`
      )
    }
    let group = this.fragments.get(fragment.startSeq)
    if (group === undefined) {
      group = {
        fragmentCount: fragment.fragmentCount,
        totalLength: fragment.totalLength,
        data: Buffer.alloc(fragment.totalLength),
        numbers: new Set<number>()
      }
      this.fragments.set(fragment.startSeq, group)
    } else if (
      group.fragmentCount !== fragment.fragmentCount ||
      group.totalLength !== fragment.totalLength
    ) {
      throw new EnetError(`分片组 ${fragment.startSeq} 的元数据前后不一致`)
    }
    fragment.data.copy(group.data, fragment.offset)
    group.numbers.add(fragment.fragmentNumber)
    if (group.numbers.size === group.fragmentCount) {
      this.fragments.delete(fragment.startSeq)
      delivered.push(group.data)
    }
  }
}
