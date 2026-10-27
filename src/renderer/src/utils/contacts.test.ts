import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../../shared/domain'
import { groupPeers } from './contacts'

function peer(overrides: Partial<PeerInfo>): PeerInfo {
  return {
    key: 'k',
    ip: '192.168.1.2',
    port: 2425,
    user: 'u',
    host: 'h',
    name: 'n',
    group: '',
    status: 0,
    identityId: '',
    clientType: 'unknown',
    online: true,
    lastSeen: 0,
    unread: 0,
    alias: '',
    capUtf8: true,
    capFile: true,
    capClipboard: true,
    dialup: false,
    versionInfo: '',
    absenceInfo: '',
    ...overrides
  }
}

describe('groupPeers', () => {
  it('groups peers by IPMSG group and puts ungrouped last', () => {
    const result = groupPeers([
      peer({ key: 'a', name: '甲', group: '研发' }),
      peer({ key: 'b', name: '乙', group: '' }),
      peer({ key: 'c', name: '丙', group: '研发' })
    ])
    expect(result.map((item) => [item.group, item.peers.length])).toEqual([
      ['研发', 2],
      ['未分组', 1]
    ])
  })

  it('sorts groups by pinyin and keeps names inside groups sorted', () => {
    const result = groupPeers([
      peer({ key: 'a', name: '张三', group: '测试' }),
      peer({ key: 'b', name: '李四', group: '研发' }),
      peer({ key: 'c', name: '王五', group: '测试' })
    ])
    expect(result.map((item) => item.group)).toEqual(['测试', '研发'])
    expect(result[0].peers.map((item) => item.name)).toEqual(['王五', '张三'])
  })
})
