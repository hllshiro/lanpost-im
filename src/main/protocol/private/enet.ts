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
const BANDWIDTH_PAYLOAD_SIZE = 8

const CONNECT_OUTGOING_PEER_ID = 0
const CONNECT_SESSION_NONE = 0xff
const WINDOW_SIZE = 65536
const CHANNEL_COUNT = 1
const PACKET_THROTTLE_INTERVAL = 5000
const PACKET_THROTTLE_ACCELERATION = 2
const PACKET_THROTTLE_DECELERATION = 2

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
      return data.length - payloadOffset
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
    // 抓包里的分片数据报可能被截断，分片载荷按实际剩余字节裁剪。
    const payloadSize =
      base === ENET_CMD_SEND_FRAGMENT
        ? Math.min(commandPayloadSize(base, data, payloadOffset), data.length - payloadOffset)
        : commandPayloadSize(base, data, payloadOffset)
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
