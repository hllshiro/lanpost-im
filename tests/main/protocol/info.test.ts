import { describe, expect, it } from 'vitest'
import { buildAbsenceInfo, buildInfo, parseInfo } from '../../../src/main/protocol/info'

describe('info', () => {
  it('builds the version banner as UTF-8', () => {
    const buf = buildInfo('0.1.0')
    const expected = Buffer.from('lanpost-im 0.1.0 (IPMSG draft10; UTF8; FILE; CLIPBOARD)', 'utf8')
    expect(buf.equals(expected)).toBe(true)
  })

  it('builds the online absence text', () => {
    expect(buildAbsenceInfo(false, 'ignored').toString('utf8')).toBe('Not absence mode')
  })

  it('builds the provided absence text', () => {
    expect(buildAbsenceInfo(true, '外出就餐').toString('utf8')).toBe('外出就餐')
  })

  it('falls back to Away when the absence text is empty', () => {
    expect(buildAbsenceInfo(true, '').toString('utf8')).toBe('Away')
    expect(buildAbsenceInfo(true, '   ').toString('utf8')).toBe('Away')
  })

  it('parses info payloads and trims NUL padding', () => {
    const payload = Buffer.concat([Buffer.from('版本 0.1.0', 'utf8'), Buffer.from([0, 0, 0])])
    expect(parseInfo(payload)).toBe('版本 0.1.0')
  })

  it('parses a payload without NUL padding', () => {
    expect(parseInfo(Buffer.from('plain', 'utf8'))).toBe('plain')
  })

  it('returns an empty string for an empty payload', () => {
    expect(parseInfo(Buffer.alloc(0))).toBe('')
  })
})
