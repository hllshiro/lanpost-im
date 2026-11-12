// 聊天记录与输入框共用的富文本剪贴板格式：文字、图片和内置表情按原顺序保存
export const RICH_CLIPBOARD_TYPE = 'text/x-lanpost-rich'

export type RichCopyPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; path: string; name: string; sticker: boolean }
  | { kind: 'emotion'; key: string }

// 按 DOM 顺序收集文字与图片，块级元素之间补换行
export function walkRichCopy(
  root: Node,
  resolveImage: (image: HTMLImageElement) => RichCopyPart | null
): RichCopyPart[] {
  const parts: RichCopyPart[] = []
  const pushText = (value: string): void => {
    if (value === '') return
    const last = parts[parts.length - 1]
    if (last !== undefined && last.kind === 'text') last.text += value
    else parts.push({ kind: 'text', text: value })
  }
  const pushBreak = (): void => {
    const last = parts[parts.length - 1]
    if (last === undefined) return
    if (last.kind === 'text' && last.text.endsWith('\n')) return
    pushText('\n')
  }
  const walk = (node: Node): void => {
    // 3 = 文本节点，1 = 元素节点；用数字常量，Node 的纯逻辑部分可以在单测里跑
    if (node.nodeType === 3) {
      pushText(node.textContent ?? '')
      return
    }
    if (node.nodeType !== 1) return
    const element = node as HTMLElement
    if (element.tagName === 'IMG') {
      const part = resolveImage(element as HTMLImageElement)
      if (part !== null) parts.push(part)
      return
    }
    if (element.tagName === 'BR') {
      pushText('\n')
      return
    }
    const block =
      element.tagName === 'DIV' ||
      element.tagName === 'P' ||
      element.tagName === 'LI' ||
      element.tagName === 'TR'
    if (block) pushBreak()
    for (const child of Array.from(element.childNodes)) walk(child)
  }
  for (const child of Array.from(root.childNodes)) walk(child)
  return trimParts(parts)
}

function trimParts(parts: RichCopyPart[]): RichCopyPart[] {
  while (parts.length > 0) {
    const first = parts[0]
    if (first.kind !== 'text') break
    first.text = first.text.replace(/^\s+/, '')
    if (first.text !== '') break
    parts.shift()
  }
  while (parts.length > 0) {
    const last = parts[parts.length - 1]
    if (last.kind !== 'text') break
    last.text = last.text.replace(/\s+$/, '')
    if (last.text !== '') break
    parts.pop()
  }
  return parts
}

export function richCopyPlainText(parts: RichCopyPart[]): string {
  return parts
    .map((part) => {
      if (part.kind === 'text') return part.text
      return part.kind === 'emotion' ? '[表情]' : '[图片]'
    })
    .join('')
    .trim()
}

// 选中内容里有图片或表情才写自定义格式，纯文字沿用浏览器默认复制
export function writeRichCopy(event: ClipboardEvent, parts: RichCopyPart[]): boolean {
  if (!parts.some((part) => part.kind !== 'text')) return false
  event.preventDefault()
  event.clipboardData?.setData('text/plain', richCopyPlainText(parts))
  event.clipboardData?.setData(RICH_CLIPBOARD_TYPE, JSON.stringify(parts))
  return true
}

export function parseRichCopy(raw: string): RichCopyPart[] | null {
  if (raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const parts: RichCopyPart[] = []
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    if (record.kind === 'text' && typeof record.text === 'string') {
      parts.push({ kind: 'text', text: record.text })
      continue
    }
    if (
      record.kind === 'image' &&
      typeof record.path === 'string' &&
      typeof record.name === 'string'
    ) {
      parts.push({
        kind: 'image',
        path: record.path,
        name: record.name,
        sticker: record.sticker === true
      })
      continue
    }
    if (record.kind === 'emotion' && typeof record.key === 'string') {
      parts.push({ kind: 'emotion', key: record.key })
    }
  }
  return parts.length > 0 ? parts : null
}
