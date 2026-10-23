import { LEGACY_FLAGS, LEGACY_COMMAND_MASK } from './commands'

export const VERSION = 1
export const VERSION_SUFFIX = '@shiyeline'
export const DOCVER = 1

const COLON = 0x3a

export class PacketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PacketError'
  }
}

export interface Header {
  version: string
  seq: number
  user: string
  host: string
  cmd: number
  payload: Buffer
  legacy: boolean
}

export type OutgoingHeader = Omit<Header, 'version' | 'payload'> & {
  payload?: Buffer
}

function encodeVersion(legacy: boolean): string {
  return legacy ? '1' : `${VERSION}${VERSION_SUFFIX}`
}

export function Encode(header: OutgoingHeader): Buffer {
  const payload = header.payload ?? Buffer.alloc(0)
  const head = Buffer.from(
    `${encodeVersion(header.legacy)}:${header.seq}:${header.user}:${header.host}:${header.cmd}:`,
    'utf8'
  )
  return Buffer.concat([head, payload])
}

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

const DECIMAL = /^\d+$/

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

export function Decode(data: Buffer): Header {
  const parts = splitFields(data, 6)
  if (parts.length < 5) {
    throw new PacketError('报文头字段不足')
  }
  const version = parts[0].toString('utf8')
  if (!version.endsWith(VERSION_SUFFIX)) {
    throw new PacketError(`报文版本不是私有格式: ${JSON.stringify(version)}`)
  }
  const seq = parseDecimal(parts[1], 'seq', 0xffffffff)
  const cmd = parseDecimal(parts[4], 'cmd', 0xffffffff)
  return {
    version,
    seq,
    user: parts[2].toString('utf8'),
    host: parts[3].toString('utf8'),
    cmd,
    payload: parts.length === 6 ? parts[5] : Buffer.alloc(0),
    legacy: false
  }
}

export function DecodeCompat(data: Buffer): Header {
  try {
    return Decode(data)
  } catch {
    // 标准 IPMSG 报文头不带 @shiyeline 后缀，按 legacy 继续解析。
  }
  const parts = splitFields(data, 6)
  if (parts.length < 5) {
    throw new PacketError('报文头字段不足')
  }
  const seq = parseDecimal(parts[1], 'seq', 0xffffffff)
  const cmd = parseDecimal(parts[4], 'cmd', 0xffffffff)
  return {
    version: parts[0].toString('utf8'),
    seq,
    user: parts[2].toString('utf8'),
    host: parts[3].toString('utf8'),
    cmd,
    payload: parts.length === 6 ? parts[5] : Buffer.alloc(0),
    legacy: true
  }
}

export function TrimNul(data: Buffer): Buffer {
  let end = data.length
  while (end > 0 && data[end - 1] === 0) {
    end--
  }
  return data.subarray(0, end)
}

export function SplitNul(data: Buffer): Buffer[] {
  const trimmed = TrimNul(data)
  const out: Buffer[] = []
  let start = 0
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== 0) continue
    if (i > start) out.push(trimmed.subarray(start, i))
    start = i + 1
  }
  if (start < trimmed.length) out.push(trimmed.subarray(start))
  return out
}

const LEGACY_COMMANDS = new Set([0x01, 0x02, 0x03, 0x20, 0x21, 0x30, 0x31, 0x40, 0x60, 0x61, 0x62])

export function IsLegacy(cmd: number): boolean {
  if ((cmd & ~LEGACY_FLAGS) >>> 0 !== (cmd & LEGACY_COMMAND_MASK) >>> 0) {
    return false
  }
  return LEGACY_COMMANDS.has(cmd & LEGACY_COMMAND_MASK)
}
