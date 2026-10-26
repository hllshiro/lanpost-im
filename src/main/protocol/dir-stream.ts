import { parseExtAttrs } from './attrs'

// 目录流头部：headerSize:name:size:attr[:key=value...]:
// 所有数值与扩展属性都是十六进制；name 里的 ':' 转义为 '::'。
// headerSize 是从 headerSize 字段开头到最后一个冒号的 UTF-8 字节数，
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

export function encodeDirHeader(entry: DirHeaderInput): Buffer {
  const name = entry.name.replaceAll(':', '::')
  const size = hexField(entry.size)
  const attr = hexField(entry.attr)
  let ext = ''
  if (entry.ext !== undefined) {
    for (const [key, value] of entry.ext) {
      ext += `:${key.toString(16)}=${value}`
    }
  }

  const build = (sizeField: string): string => `${sizeField}:${name}:${size}:${attr}${ext}:`
  let sizeField = '0000'
  // 长度字段的位数会改变自身长度，迭代到稳定（最多从 4 位涨到 5 位）。
  for (let attempt = 0; attempt < 4; attempt++) {
    const header = build(sizeField)
    const length = Buffer.byteLength(header, 'utf8')
    const next = length.toString(16).padStart(4, '0')
    if (next === sizeField) {
      return Buffer.from(header, 'utf8')
    }
    sizeField = next
  }
  throw new Error('无法确定目录头长度')
}

function parseHexField(text: string, max: number): number | null {
  if (!HEX.test(text)) {
    return null
  }
  const value = Number.parseInt(text, 16)
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    return null
  }
  return value
}

// 按未转义的 ':' 切分字段，'::' 还原成一个冒号。
function splitFields(header: string, start: number): string[] {
  const end = header.length - 1
  const fields: string[] = []
  let current = ''
  for (let i = start; i < end; i++) {
    const char = header[i]
    if (char !== ':') {
      current += char
      continue
    }
    if (header[i + 1] === ':' && i + 1 < end) {
      current += ':'
      i++
      continue
    }
    fields.push(current)
    current = ''
  }
  if (current !== '') {
    fields.push(current)
  }
  return fields
}

export function parseDirHeader(buffer: Buffer): DirHeader | null {
  let separator = -1
  for (let i = 0; i < buffer.length && i <= 8; i++) {
    const byte = buffer[i]
    if (byte === COLON) {
      separator = i
      break
    }
    if (!HEX.test(String.fromCharCode(byte))) {
      return null
    }
  }
  if (separator < 0) {
    return null
  }

  const headerSize = parseHexField(buffer.subarray(0, separator).toString('ascii'), 0xffffffff)
  if (headerSize === null || headerSize < 6 || headerSize > MAX_HEADER_SIZE) {
    return null
  }
  if (headerSize > buffer.length || buffer[headerSize - 1] !== COLON) {
    return null
  }

  const header = buffer.subarray(0, headerSize).toString('utf8')
  const fields = splitFields(header, separator + 1)
  if (fields.length < 3) {
    return null
  }

  const name = fields[0]
  const size = parseHexField(fields[1], Number.MAX_SAFE_INTEGER)
  const attr = parseHexField(fields[2], 0xffffffff)
  if (name === '' || size === null || attr === null) {
    return null
  }

  return {
    headerSize,
    name,
    size,
    attr,
    ext: parseExtAttrs(fields.slice(3)),
    contentOffset: headerSize
  }
}
