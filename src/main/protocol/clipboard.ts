import { EXT_CLIPBOARDPOS, FILE_ATTR_CLIPBOARD } from './commands'

// 内嵌图片：单张上限 10 MB，一次最多 10 张；超出时发送端降级为普通文件。
export const MAX_CLIPBOARD_BYTES = 10 * 1024 * 1024
export const MAX_CLIPBOARD_COUNT = 10

const DECIMAL = /^[0-9]+$/
const HEX = /^(?:0x)?[0-9a-fA-F]+$/

// 附件类型只看低 8 位；0x100 及以上的位是文件选项（只读、隐藏等）。
export function isClipboardAttachment(attr: number): boolean {
  return (attr & 0xff) === FILE_ATTR_CLIPBOARD
}

// CLIPBOARDPOS 记录图片在正文里的位置（文字长度 + 序号）。
// 标准对端写十进制，部分实现写十六进制；无法解析时按 0 处理。
export function clipboardPosition(ext: Map<number, string>): number {
  const raw = ext.get(EXT_CLIPBOARDPOS)
  if (raw === undefined) {
    return 0
  }
  const text = raw.trim()
  let value: number
  if (DECIMAL.test(text)) {
    value = Number.parseInt(text, 10)
  } else if (HEX.test(text)) {
    value = Number.parseInt(text, 16)
  } else {
    return 0
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function canSendAsClipboard(size: number, count: number): boolean {
  if (!Number.isInteger(size) || !Number.isInteger(count)) {
    return false
  }
  if (count < 1 || count > MAX_CLIPBOARD_COUNT) {
    return false
  }
  return size >= 1 && size <= MAX_CLIPBOARD_BYTES
}
