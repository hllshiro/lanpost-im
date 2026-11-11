const BEACON_SIZE = 304

const TYPE_OFFSET = 0x04
const VERSION_OFFSET = 0x08
// 样本要求这个字段固定为编译期常量，填时间戳会被回 DISCONNECT
const FIXED_MARKER_OFFSET = 0x0c
const IP_OFFSET = 0x10
const BROADCAST_OFFSET = 0x14
const BEACON_PORT_OFFSET = 0x18
const TCP_PORT_OFFSET = 0x1a
const ENET_PORT_OFFSET = 0x1c
const USER_ID_OFFSET = 0x1e
const USER_ID_SIZE = 32
const PEER_ID_OFFSET = 0x5f
const PEER_ID_SIZE = 16
const RESERVED_OFFSET = 0xa0
const SESSION_PORT_OFFSET = 0xa5

const BEACON_VERSION = 1
const BEACON_RESERVED = 500
const FIXED_MARKER = 0x5fc1d8ec
const DEFAULT_BEACON_PORT = 9011
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/

export interface DiscoveryBeacon {
  type: number
  ip: string
  ports: { beacon: number; tcp: number; enet: number }
  userId: string
  peerId: Buffer
  enetPort: number
}

export function decodeBeacon(data: Buffer): DiscoveryBeacon | null {
  if (data.length !== BEACON_SIZE) {
    return null
  }
  const total = data.readUInt32BE(0)
  if (total !== data.length) {
    return null
  }
  return {
    type: data.readUInt32BE(TYPE_OFFSET),
    ip: readIpv4(data, IP_OFFSET),
    ports: {
      beacon: data.readUInt16BE(BEACON_PORT_OFFSET),
      tcp: data.readUInt16BE(TCP_PORT_OFFSET),
      enet: data.readUInt16BE(ENET_PORT_OFFSET)
    },
    userId: readAsciiField(data, USER_ID_OFFSET, USER_ID_SIZE),
    peerId: Buffer.from(data.subarray(PEER_ID_OFFSET, PEER_ID_OFFSET + PEER_ID_SIZE)),
    enetPort: data.readUInt16BE(SESSION_PORT_OFFSET)
  }
}

export function encodeBeacon(input: {
  type: number
  ip: string
  broadcast: string
  userId: string
  peerId: Buffer
  enetPort: number
  beaconPort?: number
}): Buffer {
  const beaconPort = input.beaconPort ?? DEFAULT_BEACON_PORT
  assertPort('enetPort', input.enetPort)
  assertPort('beaconPort', beaconPort)
  if (input.peerId.length !== PEER_ID_SIZE) {
    throw new Error(`发现报文标识必须为 ${PEER_ID_SIZE} 字节，实际 ${input.peerId.length} 字节`)
  }
  if (!PRINTABLE_ASCII.test(input.userId) || input.userId.length > USER_ID_SIZE) {
    throw new Error(
      `发现报文用户标识必须是 1 到 ${USER_ID_SIZE} 个可见 ASCII 字符: ${input.userId}`
    )
  }
  const userId = Buffer.from(input.userId, 'latin1')

  const out = Buffer.alloc(BEACON_SIZE)
  out.writeUInt32BE(BEACON_SIZE, 0)
  out.writeUInt32BE(input.type, TYPE_OFFSET)
  out.writeUInt32BE(BEACON_VERSION, VERSION_OFFSET)
  out.writeUInt32BE(FIXED_MARKER, FIXED_MARKER_OFFSET)
  writeIpv4(out, input.ip, IP_OFFSET)
  writeIpv4(out, input.broadcast, BROADCAST_OFFSET)
  out.writeUInt16BE(beaconPort, BEACON_PORT_OFFSET)
  out.writeUInt16BE(input.enetPort, TCP_PORT_OFFSET)
  out.writeUInt16BE(input.enetPort, ENET_PORT_OFFSET)
  userId.copy(out, USER_ID_OFFSET)
  input.peerId.copy(out, PEER_ID_OFFSET)
  out.writeUInt32BE(BEACON_RESERVED, RESERVED_OFFSET)
  out.writeUInt16BE(input.enetPort, SESSION_PORT_OFFSET)
  return out
}

function assertPort(name: string, port: number): void {
  if (!Number.isInteger(port) || port < 0 || port > 0xffff) {
    throw new Error(`发现报文端口 ${name} 超出 u16 范围: ${port}`)
  }
}

function readIpv4(data: Buffer, offset: number): string {
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]].join('.')
}

function writeIpv4(out: Buffer, ip: string, offset: number): void {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    throw new Error(`IPv4 地址格式错误: ${ip}`)
  }
  for (const [index, part] of parts.entries()) {
    const value = Number(part)
    if (!/^\d{1,3}$/.test(part) || value > 255) {
      throw new Error(`IPv4 地址格式错误: ${ip}`)
    }
    out.writeUInt8(value, offset + index)
  }
}

function readAsciiField(data: Buffer, offset: number, size: number): string {
  const field = data.subarray(offset, offset + size)
  const end = field.indexOf(0)
  return field.subarray(0, end === -1 ? size : end).toString('latin1')
}
