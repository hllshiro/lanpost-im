import { describe, expect, it } from 'vitest'
import { findUtf16Md5 } from './scan'

describe('findUtf16Md5', () => {
  it('finds the md5 written as UTF-16 at an unaligned offset', () => {
    const body = Buffer.alloc(488)
    body.write('0123456789abcdef0123456789abcdef', 149, 'utf16le')
    expect(findUtf16Md5(body)).toBe('0123456789abcdef0123456789abcdef')
  })

  it('normalizes upper-case hex to lower case', () => {
    const body = Buffer.alloc(128)
    body.write('ABCDEF0123456789ABCDEF0123456789', 20, 'utf16le')
    expect(findUtf16Md5(body)).toBe('abcdef0123456789abcdef0123456789')
  })

  it('returns an empty string when no md5 is present', () => {
    expect(findUtf16Md5(Buffer.alloc(200, 1))).toBe('')
    expect(findUtf16Md5(Buffer.from('not-an-md5'))).toBe('')
  })
})
