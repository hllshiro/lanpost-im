import { describe, expect, it } from 'vitest'
import { decodeMessageText, encodeMessageText } from './text'

describe('text encoding', () => {
  it('uses UTF-8 by default for capable peers and supports emoji', () => {
    const result = encodeMessageText('你好 😀', { utf8: true })
    expect(result.utf8).toBe(true)
    expect(result.lossy).toBe(false)
    expect(decodeMessageText(result.data, true)).toBe('你好 😀')
  })

  it('falls back to GBK for legacy peers', () => {
    const result = encodeMessageText('你好', { utf8: false })
    expect(result.utf8).toBe(false)
    expect(decodeMessageText(result.data, false)).toBe('你好')
  })

  it('marks lossy GBK fallback for emoji', () => {
    const result = encodeMessageText('你好 😀', { utf8: false })
    expect(result.lossy).toBe(true)
    expect(decodeMessageText(result.data, false)).toContain('你好')
  })

  it('normalizes CRLF to LF', () => {
    expect(decodeMessageText(encodeMessageText('a\r\nb\rc', { utf8: true }).data, true)).toBe(
      'a\nb\nc'
    )
  })
})
