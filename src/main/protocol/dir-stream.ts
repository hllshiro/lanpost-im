import { parseExtAttrs } from './attrs'
import { decodeText, encodeGbkLossy } from './encoding'

// 目录流头部：headerSize:name:size:attr[:key=value...]:
// 所有数值与扩展属性都是十六进制；name 里的 ':' 转义为 '::'。
// headerSize 是从 headerSize 字段开头到最后一个冒号的字节数，
// 包含自身与末尾冒号，至少 4 位十六进制。

const COLON = 0x3a
const HEX = /^[0-9a-fA-F]+$/
const MAX_HEADER_SIZE = 0x10000

export interface DirHeader {
  headerSize: number
  name: string
  size: number
  attr: number
  ext: Map<number, string>
  contentOffset: number
}

export interface DirHeaderInput {
  name: string
  size: number
  attr: number
  ext?: Map<number, string>
}

function hexField(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`目录头数值无效: ${value}`)
  }
  return value.toString(16)
}

export function encodeDirHeader(entry: DirHeaderInput, utf8 = true): Buffer {
  const encodedName = utf8
    ? Buffer.from(entry.name.replaceAll(':', '::'), 'utf8')
    : encodeGbkLossy(entry.name.replaceAll(':', '::'))
  const tail = Buffer.from(
    `:${hexField(entry.size)}:${hexField(entry.attr)}${extFields(entry.ext)}:`,
    'ascii'
  )
  let sizeField = '0000'
  for (let attempt = 0; attempt < 4; attempt++) {
    const prefix = Buffer.from(`${sizeField}:`, 'ascii')
    const header = Buffer.concat([prefix, encodedName, tail])
    const next = header.length.toString(16).padStart(4, '0')
    if (next === sizeField) return header
    sizeField = next
  }
  throw new Error('无法确定目录头长度')
}

function extFields(ext?: Map<number, string>): string {
  let value = ''
  if (ext !== undefined) {
    for (const [key, item] of ext) value += `:${key.toString(16)}=${item}`
  }
  return value
}

function parseHexField(text: string, max: number): number | null {
  if (!HEX.test(text)) return null
  const value = Number.parseInt(text, 16)
  if (!Number.isSafeInteger(value) || value < 0 || value > max) return null
  return value
}

// 按未转义的 ':' 切分字节，'::' 还原成一个冒号。
function splitFields(header: Buffer, start: number): Buffer[] {
  const end = header.length - 1
  const fields: Buffer[] = []
  let current: number[] = []
  for (let i = start; i < end; i++) {
    const byte = header[i]
    if (byte !== COLON) {
      current.push(byte)
      continue
    }
    if (header[i + 1] === COLON && i + 1 < end) {
      current.push(COLON)
      i++
      continue
    }
    fields.push(Buffer.from(current))
    current = []
  }
  if (current.length > 0) fields.push(Buffer.from(current))
  return fields
}

export function parseDirHeader(buffer: Buffer, utf8 = true): DirHeader | null {
  let separator = -1
  for (let i = 0; i < buffer.length && i <= 8; i++) {
    const byte = buffer[i]
    if (byte === COLON) {
      separator = i
      break
    }
    if (!HEX.test(String.fromCharCode(byte))) return null
  }
  if (separator < 0) return null

  const headerSize = parseHexField(buffer.subarray(0, separator).toString('ascii'), 0xffffffff)
  if (headerSize === null || headerSize < 6 || headerSize > MAX_HEADER_SIZE) return null
  if (headerSize > buffer.length || buffer[headerSize - 1] !== COLON) return null

  const fields = splitFields(buffer.subarray(0, headerSize), separator + 1)
  if (fields.length < 3) return null
  const name = decodeText(fields[0], utf8)
  const size = parseHexField(fields[1].toString('ascii'), Number.MAX_SAFE_INTEGER)
  const attr = parseHexField(fields[2].toString('ascii'), 0xffffffff)
  if (name === '' || size === null || attr === null) return null

  return {
    headerSize,
    name,
    size,
    attr,
    ext: parseExtAttrs(fields.slice(3).map((field) => field.toString('ascii'))),
    contentOffset: headerSize
  }
}
