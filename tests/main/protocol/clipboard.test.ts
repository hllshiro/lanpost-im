import { describe, expect, it } from 'vitest'
import { FILE_ATTR_CLIPBOARD, EXT_CLIPBOARDPOS } from '../../../src/main/protocol/commands'
import {
  MAX_CLIPBOARD_BYTES,
  MAX_CLIPBOARD_COUNT,
  canSendAsClipboard,
  clipboardPosition,
  isClipboardAttachment
} from '../../../src/main/protocol/clipboard'

describe('isClipboardAttachment', () => {
  it('treats attr 0x20 as a clipboard attachment', () => {
    expect(isClipboardAttachment(0x20)).toBe(true)
    expect(isClipboardAttachment(FILE_ATTR_CLIPBOARD)).toBe(true)
  })

  it('ignores only the low 8 bits so option bits do not matter', () => {
    expect(isClipboardAttachment(0x1020)).toBe(true)
    expect(isClipboardAttachment(0xff20)).toBe(true)
  })

  it('rejects 0x21 and other file types', () => {
    expect(isClipboardAttachment(0x21)).toBe(false)
    expect(isClipboardAttachment(0x01)).toBe(false)
    expect(isClipboardAttachment(0x02)).toBe(false)
    expect(isClipboardAttachment(0x00)).toBe(false)
  })
})

describe('clipboardPosition', () => {
  it('parses a decimal CLIPBOARDPOS value', () => {
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '8']]))).toBe(8)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '0']]))).toBe(0)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '42']]))).toBe(42)
  })

  it('parses a non-decimal value as hex', () => {
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, 'a']]))).toBe(10)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '1f']]))).toBe(31)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '0x10']]))).toBe(16)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, 'FF']]))).toBe(255)
  })

  it('returns 0 when the extension is missing', () => {
    expect(clipboardPosition(new Map())).toBe(0)
    expect(clipboardPosition(new Map([[0x14, '8']]))).toBe(0)
  })

  it('returns 0 for invalid values', () => {
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '']]))).toBe(0)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, 'zz']]))).toBe(0)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '1 2']]))).toBe(0)
    expect(clipboardPosition(new Map([[EXT_CLIPBOARDPOS, '-8']]))).toBe(0)
  })
})

describe('canSendAsClipboard', () => {
  it('accepts 1..10 attachments within 10 MB', () => {
    expect(canSendAsClipboard(1, 1)).toBe(true)
    expect(canSendAsClipboard(MAX_CLIPBOARD_BYTES, MAX_CLIPBOARD_COUNT)).toBe(true)
    expect(canSendAsClipboard(2048, 3)).toBe(true)
  })

  it('rejects an oversized single image', () => {
    expect(canSendAsClipboard(MAX_CLIPBOARD_BYTES + 1, 1)).toBe(false)
    expect(canSendAsClipboard(0, 1)).toBe(false)
    expect(canSendAsClipboard(-1, 1)).toBe(false)
  })

  it('rejects empty or too many attachments', () => {
    expect(canSendAsClipboard(1024, 0)).toBe(false)
    expect(canSendAsClipboard(1024, MAX_CLIPBOARD_COUNT + 1)).toBe(false)
  })

  it('rejects non-integer sizes and counts', () => {
    expect(canSendAsClipboard(1024.5, 1)).toBe(false)
    expect(canSendAsClipboard(1024, 1.5)).toBe(false)
  })
})
