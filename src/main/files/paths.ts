// 目录流里的路径逐段清洗：拒绝穿越、绝对路径、盘符、NUL 与控制字符，
// 单段超长截断。返回的路径只使用 '/'，调用方再与临时目录拼接。

const SEPARATORS = /[\\/]+/
const DRIVE = /^[A-Za-z]:/
const MAX_SEGMENT = 200

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

// Windows 会忽略段尾的点和空格，`.. ` 实际就是 `..`，必须在清洗后判定。
function cleanSegment(raw: string): string | null {
  let segment = raw.trim().replace(/[. ]+$/, '')
  if (segment === '') {
    return null
  }
  const chars = Array.from(segment)
  if (chars.length > MAX_SEGMENT) {
    segment = chars
      .slice(0, MAX_SEGMENT)
      .join('')
      .replace(/[. ]+$/, '')
  }
  if (segment === '' || segment === '.' || segment === '..') {
    return null
  }
  return segment
}

export function safeRelativePath(name: string): string | null {
  if (name === '' || hasControlChar(name)) {
    return null
  }
  if (name.startsWith('/') || name.startsWith('\\') || DRIVE.test(name)) {
    return null
  }

  const segments: string[] = []
  for (const raw of name.split(SEPARATORS)) {
    if (raw.trim() === '') {
      continue
    }
    const segment = cleanSegment(raw)
    if (segment === null) {
      return null
    }
    segments.push(segment)
  }
  if (segments.length === 0) {
    return null
  }
  return segments.join('/')
}
