import { describe, expect, it } from 'vitest'
import {
  canEncodeGbk,
  decodeGbk,
  decodeText,
  encodeGbk,
  encodeText
} from '../../../src/main/protocol/encoding'

describe('encoding', () => {
  it('round-trips Chinese text through GBK', () => {
    const text = '项目:最终报告.docx'
    expect(canEncodeGbk(text)).toBe(true)
    const encoded = encodeText(text)
    expect(encoded.utf8).toBe(false)
    expect(encoded.data.equals(encodeGbk(text))).toBe(true)
    expect(decodeText(encoded.data, false)).toBe(text)
    expect(decodeGbk(encoded.data)).toBe(text)
  })

  it('falls back to UTF-8 for characters GBK cannot represent', () => {
    const text = '看这个📄'
    expect(canEncodeGbk(text)).toBe(false)
    const encoded = encodeText(text)
    expect(encoded.utf8).toBe(true)
    expect(encoded.data.equals(Buffer.from(text, 'utf8'))).toBe(true)
    expect(decodeText(encoded.data, true)).toBe(text)
  })

  it('decodes by the UTF-8 flag', () => {
    const text = '中文消息'
    expect(decodeText(Buffer.from(text, 'utf8'), true)).toBe(text)
    expect(decodeText(encodeGbk(text), false)).toBe(text)
  })

  it('throws when strict GBK encoding is impossible', () => {
    expect(() => encodeGbk('📄')).toThrow()
  })
})
