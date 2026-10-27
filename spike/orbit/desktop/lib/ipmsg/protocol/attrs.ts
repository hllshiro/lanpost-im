import { chmodSync, utimesSync } from 'node:fs'
import { EXT_MTIME, FILE_OPT_RONLY } from './commands'

const HEX = /^[0-9a-fA-F]+$/

// 附件 attr 的低 8 位是文件类型，其余位是只读、隐藏等选项。
export function fileType(attr: number): number {
  return attr & 0xff
}

// 扩展属性写成 “键=值”，键和值都是十六进制，例如 14=65a1b2。
// 未知键、缺少等号、非十六进制的项都直接忽略。
export function parseExtAttrs(fields: string[]): Map<number, string> {
  const attrs = new Map<number, string>()
  for (const field of fields) {
    const separator = field.indexOf('=')
    if (separator < 0) {
      continue
    }
    const keyText = field.slice(0, separator).trim()
    const valueText = field.slice(separator + 1).trim()
    if (!HEX.test(keyText) || !HEX.test(valueText)) {
      continue
    }
    const key = Number.parseInt(keyText, 16)
    if (!Number.isSafeInteger(key) || key > 0xffffffff) {
      continue
    }
    attrs.set(key, valueText.toLowerCase())
  }
  return attrs
}

// 把对端的扩展属性落到磁盘：mtime 用 unix 秒（十六进制），
// FILE_OPT_RONLY 设为只读。未知键和无法解析的值都忽略，绝不让接收流程抛错。
export function applyFileAttrs(path: string, attr: number, attrs: Map<number, string>): void {
  const rawMtime = attrs.get(EXT_MTIME)
  if (rawMtime !== undefined) {
    const seconds = Number.parseInt(rawMtime, 16)
    if (Number.isSafeInteger(seconds) && seconds >= 0) {
      try {
        const time = new Date(seconds * 1000)
        utimesSync(path, time, time)
      } catch {
        // 文件已被删除或时间超出平台范围：保留接收结果即可。
      }
    }
  }

  if ((attr & FILE_OPT_RONLY) !== 0) {
    try {
      chmodSync(path, 0o444)
    } catch {
      // 只读标记只是附带信息，失败不影响文件内容。
    }
  }
}
