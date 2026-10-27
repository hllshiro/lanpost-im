import { NWT_PRIVATE_VERSION } from './commands'

export class PacketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PacketError'
  }
}

export type Vendor = 'standard' | 'nwt' | 'feiq'

export interface PacketHeader {
  version: string
  vendor: Vendor
  seq: number
  user: string
  host: string
  cmd: number
  payload: Buffer
}

export interface OutgoingPacket {
  seq: number
  user: string
  host: string
  cmd: number
  payload?: Buffer
}

const COLON = 0x3a
const DECIMAL = /^\d+$/

function splitFields(data: Buffer, limit: number): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  while (parts.length < limit - 1) {
    const index = data.indexOf(COLON, start)
    if (index < 0) break
    parts.push(data.subarray(start, index))
    start = index + 1
  }
  parts.push(data.subarray(start))
  return parts
}

function parseDecimal(field: Buffer, name: string, max: number): number {
  const text = field.toString('ascii')
  if (!DECIMAL.test(text)) {
    throw new PacketError(`报文头 ${name} 不是十进制数字: ${JSON.stringify(text)}`)
  }
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value > max) {
    throw new PacketError(`报文头 ${name} 超出范围: ${text}`)
  }
  return value
}

export function encodePacket(header: OutgoingPacket): Buffer {
  return encodePacketVersioned('1', header)
}

export function encodePacketVersioned(version: string, header: OutgoingPacket): Buffer {
  const payload = header.payload ?? Buffer.alloc(0)
  const head = Buffer.from(
    `${version}:${header.seq}:${header.user}:${header.host}:${header.cmd}:`,
    'utf8'
  )
  return Buffer.concat([head, payload])
}

export function decodePacket(data: Buffer): PacketHeader {
  const parts = splitFields(data, 6)
  if (parts.length < 5) {
    throw new PacketError('报文头字段不足')
  }
  const version = parts[0].toString('ascii')
  // 允许 1、1@shiyeline、1_lbt80_0#...#9 等历史外层头，但版本号必须是 1。
  const numeric = version.match(/^(\d+)/)
  const privateNwt = version === NWT_PRIVATE_VERSION
  if (!privateNwt && (numeric === null || numeric[1] !== '1')) {
    throw new PacketError(`不支持的报文版本: ${JSON.stringify(version)}`)
  }
  const seq = parseDecimal(parts[1], 'seq', 0xffffffff)
  const cmd = parseDecimal(parts[4], 'cmd', 0xffffffff)
  const vendor: Vendor =
    privateNwt || version.endsWith('@shiyeline')
      ? 'nwt'
      : version.startsWith('1_lbt80')
        ? 'feiq'
        : 'standard'
  return {
    version: privateNwt ? NWT_PRIVATE_VERSION : '1',
    vendor,
    seq,
    user: parts[2].toString('utf8'),
    host: parts[3].toString('utf8'),
    cmd,
    payload: parts.length === 6 ? parts[5] : Buffer.alloc(0)
  }
}

export function trimNul(data: Buffer): Buffer {
  let end = data.length
  while (end > 0 && data[end - 1] === 0) {
    end--
  }
  return data.subarray(0, end)
}

export function splitNul(data: Buffer): Buffer[] {
  const trimmed = trimNul(data)
  const out: Buffer[] = []
  let start = 0
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== 0) continue
    out.push(trimmed.subarray(start, i))
    start = i + 1
  }
  out.push(trimmed.subarray(start))
  return out
}

const KNOWN_COMMANDS = new Set([
  0x01, 0x02, 0x03, 0x04, 0x10, 0x11, 0x12, 0x13, 0x20, 0x21, 0x30, 0x31, 0x32, 0x40, 0x41, 0x50,
  0x51, 0x60, 0x61, 0x62
])

export function isStandardCommand(cmd: number): boolean {
  return KNOWN_COMMANDS.has(cmd & 0xff)
}
