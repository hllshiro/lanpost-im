import { parseExtAttrs } from './attrs'
import { canEncodeGbk, decodeText, encodeGbk } from './encoding'

export const FILE_ATTR_REGULAR = 0x01

const FILE_IDENT = 0x07
const NUL = 0x00
const COLON = 0x3a

export interface Attachment {
  id: number
  name: string
  size: number
  mtime: number
  attr: number
  ext?: Record<number, string>
}

export function escapeAttachName(name: string): string {
  return name.replaceAll(':', '::')
}

export function encodeAttachmentItem(attachment: Attachment): string {
  const id = attachment.id.toString(16)
  const name = escapeAttachName(attachment.name)
  const size = attachment.size.toString(16)
  const mtime = attachment.mtime.toString(16)
  const attr = attachment.attr.toString(16)
  let ext = ''
  for (const [key, value] of Object.entries(attachment.ext ?? {})) {
    ext += `:${Number(key).toString(16)}=${value}`
  }
  return `${id}:${name}:${size}:${mtime}:${attr}${ext}:`
}

export interface FileBody {
  body: Buffer
  utf8: boolean
}

// SENDMSG 正文：消息文本 + NUL + 附件表，多项附件之间用 \a 分隔。
// 整段正文统一编码：只要有一处无法用 GBK 表示，就全部改用 UTF-8。
export function buildFileBody(text: string, attachments: Attachment[]): FileBody {
  const items = attachments.map((attachment) => encodeAttachmentItem(attachment))
  const utf8 = !canEncodeGbk(text) || items.some((item) => !canEncodeGbk(item))
  const encode = utf8 ? (value: string) => Buffer.from(value, 'utf8') : encodeGbk
  const pieces: Buffer[] = [encode(text), Buffer.from([NUL])]
  for (let i = 0; i < items.length; i++) {
    if (i > 0) pieces.push(Buffer.from([FILE_IDENT]))
    pieces.push(encode(items[i]))
  }
  return { body: Buffer.concat(pieces), utf8 }
}

const HEX = /^[0-9a-fA-F]+$/

function parseHex(field: Buffer, max: number): number | null {
  const text = field.toString('ascii')
  if (!HEX.test(text)) {
    return null
  }
  const value = Number.parseInt(text, 16)
  if (!Number.isSafeInteger(value) || value > max) {
    return null
  }
  return value
}

// 按 ':' 切分附件项，'::' 还原为文件名里的一个冒号。
function splitAttachFields(data: Buffer): Buffer[] {
  const fields: Buffer[] = []
  let current: number[] = []
  for (let i = 0; i < data.length; i++) {
    const byte = data[i]
    if (byte !== COLON) {
      current.push(byte)
      continue
    }
    if (i + 1 < data.length && data[i + 1] === COLON) {
      current.push(COLON)
      i++
      continue
    }
    fields.push(Buffer.from(current))
    current = []
  }
  if (current.length > 0) {
    fields.push(Buffer.from(current))
  }
  return fields
}

function parseAttachmentItem(data: Buffer, utf8: boolean): Attachment | null {
  const fields = splitAttachFields(data)
  if (fields.length < 5) {
    return null
  }
  const id = parseHex(fields[0], Number.MAX_SAFE_INTEGER)
  const size = parseHex(fields[2], Number.MAX_SAFE_INTEGER)
  const mtime = parseHex(fields[3], Number.MAX_SAFE_INTEGER)
  const attr = parseHex(fields[4], 0xffffffff)
  if (id === null || size === null || mtime === null || attr === null) {
    return null
  }
  const name = decodeText(fields[1], utf8)
  if (name === '') {
    return null
  }
  const ext: Record<number, string> = {}
  for (const [key, value] of parseExtAttrs(
    fields.slice(5).map((field) => field.toString('utf8'))
  )) {
    ext[key] = value
  }
  return Object.keys(ext).length > 0
    ? { id, name, size, mtime, attr, ext }
    : { id, name, size, mtime, attr }
}

export interface ParsedOffer {
  text: string
  attachments: Attachment[]
}

export function parseOffer(body: Buffer, utf8: boolean): ParsedOffer {
  const split = body.indexOf(NUL)
  const textRaw = split >= 0 ? body.subarray(0, split) : body
  const table = split >= 0 ? body.subarray(split + 1) : Buffer.alloc(0)
  const text = decodeText(textRaw, utf8)
  const attachments: Attachment[] = []
  let start = 0
  for (let i = 0; i <= table.length; i++) {
    if (i < table.length && table[i] !== FILE_IDENT) continue
    const item = table.subarray(start, i)
    start = i + 1
    let end = item.length
    while (end > 0 && item[end - 1] === NUL) {
      end--
    }
    if (end === 0) continue
    const attachment = parseAttachmentItem(item.subarray(0, end), utf8)
    if (attachment !== null) {
      attachments.push(attachment)
    }
  }
  return { text, attachments }
}
