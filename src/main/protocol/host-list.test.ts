import { describe, expect, it } from 'vitest'
import { buildHostList, parseHostList, type HostListEntry } from './host-list'

const alice: HostListEntry = {
  user: 'alice',
  host: 'alice-pc',
  status: 0,
  addr: '192.168.1.10',
  port: 2425,
  nickname: '爱丽丝',
  group: '研发'
}

const bob: HostListEntry = {
  user: 'bob',
  host: 'bob-pc',
  status: 2,
  addr: '192.168.1.11',
  port: 2425,
  nickname: '鲍勃',
  group: '测试'
}

describe('host-list', () => {
  it('round-trips two hosts', () => {
    const parsed = parseHostList(buildHostList(0, [alice, bob]))
    expect(parsed.hosts).toEqual([alice, bob])
  })

  it('reports next = 0 at the end of the list', () => {
    expect(parseHostList(buildHostList(0, [alice, bob])).next).toBe(0)
  })

  it('keeps batch start for the next request', () => {
    expect(parseHostList(buildHostList(5, [alice, bob])).next).toBe(5)
  })

  it('writes the header as %5d and the host count', () => {
    const buf = buildHostList(0, [alice, bob])
    expect(buf.subarray(0, 12).toString('ascii')).toBe('    0\u0007    2\u0007')
  })

  it('writes fields in order with \\a separators', () => {
    const buf = buildHostList(0, [alice]).toString('utf8')
    expect(buf.slice(12)).toBe(
      'alice\u0007alice-pc\u00070\u0007192.168.1.10\u000730985\u0007爱丽丝\u0007研发\u0007\u0007'
    )
  })

  it('writes ports in host byte order', () => {
    const buf = buildHostList(0, [alice]).toString('utf8')
    expect(buf).toContain('\u000730985\u0007')
    expect(buf).not.toContain('\u00072425\u0007')
    expect(parseHostList(buildHostList(0, [alice])).hosts[0].port).toBe(2425)
  })

  it('handles an empty host list', () => {
    const parsed = parseHostList(buildHostList(0, []))
    expect(parsed).toEqual({ next: 0, hosts: [] })
  })

  it('trims trailing NUL padding', () => {
    const padded = Buffer.concat([buildHostList(0, [alice]), Buffer.from([0, 0])])
    expect(parseHostList(padded).hosts).toEqual([alice])
  })

  it('returns empty hosts for a malformed payload without throwing', () => {
    expect(parseHostList(Buffer.from('garbage'))).toEqual({ next: 0, hosts: [] })
    expect(parseHostList(Buffer.alloc(0))).toEqual({ next: 0, hosts: [] })
    expect(parseHostList(Buffer.from('    0\u0007    3\u0007alice\u0007'))).toEqual({
      next: 0,
      hosts: []
    })
  })
})
