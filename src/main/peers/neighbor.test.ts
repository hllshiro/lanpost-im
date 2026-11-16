import { describe, expect, it } from 'vitest'
import { normalizeMac, parseMac, parseMacTable } from './neighbor'

describe('normalizeMac', () => {
  it('normalizes windows and unix separators', () => {
    expect(normalizeMac('AA-BB-CC-DD-EE-01')).toBe('aa:bb:cc:dd:ee:01')
    expect(normalizeMac('aa:bb:cc:dd:ee:01')).toBe('aa:bb:cc:dd:ee:01')
  })

  it('rejects broadcast, all-zero and multicast addresses', () => {
    expect(normalizeMac('ff-ff-ff-ff-ff-ff')).toBe('')
    expect(normalizeMac('00-00-00-00-00-00')).toBe('')
    expect(normalizeMac('01-00-5e-00-00-01')).toBe('')
    expect(normalizeMac('not-a-mac')).toBe('')
  })
})

describe('parseMacTable', () => {
  it('collects every address from a windows arp table', () => {
    const output = [
      '接口: 192.168.2.119 --- 0x8',
      '  Internet 地址         物理地址              类型',
      '  192.168.2.125         aa-bb-cc-dd-ee-01     动态',
      '  192.168.2.126         02-11-22-33-44-55     动态',
      '  192.168.2.255         ff-ff-ff-ff-ff-ff     静态'
    ].join('\r\n')
    const table = parseMacTable(output)
    expect(table.get('192.168.2.125')).toBe('aa:bb:cc:dd:ee:01')
    expect(table.get('192.168.2.126')).toBe('02:11:22:33:44:55')
    expect(table.has('192.168.2.255')).toBe(false)
  })

  it('collects rows from ip neigh', () => {
    const output = [
      '192.168.2.125 dev eth0 lladdr AA:BB:CC:DD:EE:01 REACHABLE',
      '192.168.2.126 dev eth0 lladdr 02:11:22:33:44:55 STALE'
    ].join('\n')
    const table = parseMacTable(output)
    expect(table.get('192.168.2.125')).toBe('aa:bb:cc:dd:ee:01')
    expect(table.get('192.168.2.126')).toBe('02:11:22:33:44:55')
  })
})

describe('parseMac', () => {
  it('parses a windows arp row', () => {
    const output = [
      '接口: 192.168.2.119 --- 0x8',
      '  Internet 地址         物理地址              类型',
      '  192.168.2.125         aa-bb-cc-dd-ee-01     动态'
    ].join('\r\n')
    expect(parseMac(output, '192.168.2.125')).toBe('aa:bb:cc:dd:ee:01')
  })

  it('parses an ip neigh row', () => {
    const output = '192.168.2.125 dev eth0 lladdr 02:11:22:33:44:55 REACHABLE'
    expect(parseMac(output, '192.168.2.125')).toBe('02:11:22:33:44:55')
  })

  it('does not take a MAC from a different address', () => {
    const output = '192.168.2.126 dev eth0 lladdr 02:11:22:33:44:55 REACHABLE'
    expect(parseMac(output, '192.168.2.125')).toBe('')
  })
})
