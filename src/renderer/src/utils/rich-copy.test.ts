import { describe, expect, it } from 'vitest'
import {
  parseRichCopy,
  richCopyPlainText,
  RICH_CLIPBOARD_TYPE,
  walkRichCopy,
  writeRichCopy
} from './rich-copy'

function text(value: string): Node {
  return { nodeType: 3, textContent: value } as unknown as Node
}

function element(tagName: string, childNodes: Node[]): Node {
  return { nodeType: 1, tagName, childNodes } as unknown as Node
}

describe('rich copy', () => {
  it('keeps text and images in document order', () => {
    const image = element('IMG', [])
    const parts = walkRichCopy(
      element('DIV', [text('第一行'), image, element('DIV', [text('第二行')])]),
      () => ({ kind: 'image', path: 'C:/图片/a.png', name: 'a.png', sticker: false })
    )
    expect(parts).toEqual([
      { kind: 'text', text: '第一行' },
      { kind: 'image', path: 'C:/图片/a.png', name: 'a.png', sticker: false },
      { kind: 'text', text: '\n第二行' }
    ])
  })

  it('trims the leading and trailing whitespace and drops empty text parts', () => {
    const parts = walkRichCopy(element('DIV', [text('\n\n'), text('内容'), text('\n')]), () => null)
    expect(parts).toEqual([{ kind: 'text', text: '内容' }])
  })

  it('turns images and emotions into placeholders in plain text', () => {
    const plain = richCopyPlainText([
      { kind: 'text', text: '你好' },
      { kind: 'emotion', key: '14' },
      { kind: 'image', path: 'C:/a.png', name: 'a.png', sticker: false }
    ])
    expect(plain).toBe('你好[表情][图片]')
  })

  it('round-trips the custom clipboard payload', () => {
    const parts = [
      { kind: 'text' as const, text: '你好\n' },
      { kind: 'image' as const, path: 'C:/a.png', name: 'a.png', sticker: true },
      { kind: 'emotion' as const, key: '14' }
    ]
    expect(parseRichCopy(JSON.stringify(parts))).toEqual(parts)
    expect(parseRichCopy('')).toBeNull()
    expect(parseRichCopy('not json')).toBeNull()
  })

  it('only writes the custom format when the selection contains media', () => {
    const writes: string[] = []
    let prevented = false
    const event = {
      preventDefault: () => {
        prevented = true
      },
      clipboardData: {
        setData: (type: string, value: string) => {
          writes.push(`${type}:${value}`)
        }
      }
    } as unknown as ClipboardEvent

    expect(writeRichCopy(event, [{ kind: 'text', text: '纯文字' }])).toBe(false)
    expect(prevented).toBe(false)
    expect(writes).toEqual([])

    expect(
      writeRichCopy(event, [
        { kind: 'text', text: '看图' },
        { kind: 'image', path: 'C:/a.png', name: 'a.png', sticker: false }
      ])
    ).toBe(true)
    expect(prevented).toBe(true)
    expect(writes[0]).toBe('text/plain:看图[图片]')
    expect(writes[1]?.startsWith(`${RICH_CLIPBOARD_TYPE}:`)).toBe(true)
  })
})
