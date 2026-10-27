import { describe, expect, it } from 'vitest'
import { decodeText, encodeGbk } from '../protocol/encoding'

describe('IPMSG encoding', () => {
  it('round-trips Chinese text through GBK', () => {
    const bytes = encodeGbk('内网传书')
    expect(decodeText(bytes, false)).toBe('内网传书')
  })

  it('decodes UTF-8 text when the flag is present', () => {
    expect(decodeText(Buffer.from('你好 Orbit', 'utf8'), true)).toBe('你好 Orbit')
  })
})
