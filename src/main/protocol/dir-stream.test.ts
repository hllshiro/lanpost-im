import { describe, expect, it } from 'vitest'
import { EXT_MTIME, FILE_ATTR_DIR, FILE_ATTR_REGULAR, FILE_OPT_RONLY } from './commands'
import { encodeDirHeader, parseDirHeader } from './dir-stream'

function parse(buffer: Buffer): NonNullable<ReturnType<typeof parseDirHeader>> {
  const parsed = parseDirHeader(buffer)
  expect(parsed).not.toBeNull()
  return parsed as NonNullable<ReturnType<typeof parseDirHeader>>
}

describe('encodeDirHeader', () => {
  it('writes a four-digit lowercase hex header size', () => {
    const buffer = encodeDirHeader({ name: 'a.txt', size: 5, attr: FILE_ATTR_REGULAR })
    const text = buffer.toString('utf8')
    const sizeField = text.slice(0, text.indexOf(':'))
    expect(sizeField).toMatch(/^[0-9a-f]{4}$/)
    expect(Number.parseInt(sizeField, 16)).toBe(buffer.length)
    expect(text.endsWith(':')).toBe(true)
  })

  it('escapes colons in names as ::', () => {
    const text = encodeDirHeader({
      name: '报告:2026.txt',
      size: 0,
      attr: FILE_ATTR_REGULAR
    }).toString('utf8')
    expect(text).toContain('报告::2026.txt')
    expect(text).not.toContain('报告:2026.txt')
  })

  it('counts header size in UTF-8 bytes, not characters', () => {
    const buffer = encodeDirHeader({ name: '中文名字.txt', size: 0, attr: FILE_ATTR_REGULAR })
    const text = buffer.toString('utf8')
    const sizeField = Number.parseInt(text.slice(0, text.indexOf(':')), 16)
    expect(sizeField).toBe(buffer.length)
    expect(sizeField).toBeGreaterThan(text.length)
  })
})

describe('parseDirHeader', () => {
  it('round-trips a Chinese name containing a colon', () => {
    const entry = {
      name: '报告:2026.txt',
      size: 1234,
      attr: FILE_ATTR_REGULAR | FILE_OPT_RONLY,
      ext: new Map([[EXT_MTIME, '65a1b2']])
    }
    const buffer = encodeDirHeader(entry)
    const parsed = parse(buffer)

    expect(parsed.name).toBe('报告:2026.txt')
    expect(parsed.size).toBe(1234)
    expect(parsed.attr).toBe(FILE_ATTR_REGULAR | FILE_OPT_RONLY)
    expect(parsed.ext.get(EXT_MTIME)).toBe('65a1b2')
    expect(parsed.headerSize).toBe(buffer.length)
    expect(parsed.contentOffset).toBe(buffer.length)
  })

  it('round-trips a directory root entry', () => {
    const parsed = parse(
      encodeDirHeader({ name: '相册', size: 0, attr: FILE_ATTR_DIR, ext: new Map() })
    )
    expect(parsed.name).toBe('相册')
    expect(parsed.attr & 0xff).toBe(FILE_ATTR_DIR)
    expect(parsed.ext.size).toBe(0)
  })

  it('leaves trailing content after contentOffset', () => {
    const header = encodeDirHeader({ name: 'a.txt', size: 2, attr: FILE_ATTR_REGULAR })
    const stream = Buffer.concat([header, Buffer.from('hi')])
    const parsed = parse(stream)

    expect(parsed.headerSize).toBe(header.length)
    expect(parsed.contentOffset).toBe(header.length)
    expect(stream.subarray(parsed.contentOffset).toString('utf8')).toBe('hi')
  })

  it('unescapes multiple colons in a name', () => {
    const parsed = parse(encodeDirHeader({ name: 'a::b:c', size: 0, attr: FILE_ATTR_REGULAR }))
    expect(parsed.name).toBe('a::b:c')
  })

  it('returns null for empty or non-hex input', () => {
    expect(parseDirHeader(Buffer.alloc(0))).toBeNull()
    expect(parseDirHeader(Buffer.from('no-colon-header'))).toBeNull()
    expect(parseDirHeader(Buffer.from('zz:a:1:1:'))).toBeNull()
    expect(parseDirHeader(Buffer.from('1:a:1:1:'))).toBeNull()
  })

  it('returns null when the header is truncated', () => {
    const buffer = encodeDirHeader({ name: 'a.txt', size: 1, attr: FILE_ATTR_REGULAR })
    expect(parseDirHeader(buffer.subarray(0, buffer.length - 1))).toBeNull()
  })

  it('returns null for oversized or inconsistent header sizes', () => {
    expect(parseDirHeader(Buffer.from('ffff:a:1:1:'))).toBeNull()
    expect(parseDirHeader(Buffer.from('0005:abc:1:'))).toBeNull()
  })

  it('returns null when size or attr is not hex', () => {
    expect(parseDirHeader(Buffer.from('000c:a:zz:1:'))).toBeNull()
    expect(parseDirHeader(Buffer.from('000c:a:1:zz:'))).toBeNull()
  })
})
