import { describe, expect, it } from 'vitest'
import type { GatewayBridge, GatewayPeer } from './bridge'
import { listUsers, requirePeer } from './users'

const peers: GatewayPeer[] = [
  {
    protocolId: 'aaaa1111aaaa1111aaaa1111aaaa1111',
    username: 'alice',
    displayName: 'Alice',
    hostname: 'DESKTOP-A',
    online: true,
    lastSeenAt: Date.UTC(2026, 10, 26, 2, 0, 0)
  },
  {
    protocolId: 'bbbb2222bbbb2222bbbb2222bbbb2222',
    username: 'bob',
    displayName: 'Bob',
    hostname: 'DESKTOP-B',
    online: false,
    lastSeenAt: Date.UTC(2026, 10, 25, 2, 0, 0)
  },
  {
    protocolId: 'cccc3333cccc3333cccc3333cccc3333',
    username: 'carol',
    displayName: 'Carol',
    hostname: 'LAPTOP-C',
    online: false,
    lastSeenAt: Date.UTC(2026, 10, 24, 2, 0, 0)
  }
]

function fakeBridge(): Pick<GatewayBridge, 'listPeers' | 'getPeer'> {
  return {
    listPeers: () => peers,
    getPeer: (protocolId: string) => peers.find((p) => p.protocolId === protocolId) ?? null
  }
}

describe('listUsers', () => {
  it('映射字段并把 lastSeen 转 ISO，online 在前', () => {
    const result = listUsers(fakeBridge(), {})
    expect(result.total).toBe(3)
    expect(result.page).toBe(1)
    expect(result.page_size).toBe(50)
    expect(result.users.map((u) => u.protocol_id)).toEqual([
      'aaaa1111aaaa1111aaaa1111aaaa1111',
      'bbbb2222bbbb2222bbbb2222bbbb2222',
      'cccc3333cccc3333cccc3333cccc3333'
    ])
    expect(result.users[0]).toEqual({
      protocol_id: 'aaaa1111aaaa1111aaaa1111aaaa1111',
      username: 'alice',
      display_name: 'Alice',
      hostname: 'DESKTOP-A',
      online: true,
      last_seen_at: '2026-11-26T02:00:00.000Z'
    })
  })

  it('keyword 大小写不敏感匹配显示名/账号/主机名', () => {
    expect(listUsers(fakeBridge(), { keyword: 'ALI' }).total).toBe(1)
    expect(listUsers(fakeBridge(), { keyword: 'lap' }).users[0]?.username).toBe('carol')
    expect(listUsers(fakeBridge(), { keyword: 'zzz' }).total).toBe(0)
  })

  it('online 三态筛选', () => {
    expect(listUsers(fakeBridge(), { online: true }).users).toHaveLength(1)
    expect(listUsers(fakeBridge(), { online: false }).users.map((u) => u.username)).toEqual([
      'bob',
      'carol'
    ])
    expect(listUsers(fakeBridge(), { online: null }).total).toBe(3)
  })

  it('分页切片且 total 保持筛选后的总数', () => {
    const result = listUsers(fakeBridge(), { page: 2, page_size: 2 })
    expect(result.total).toBe(3)
    expect(result.users.map((u) => u.username)).toEqual(['carol'])
  })

  it('非法分页参数返回 -32010', () => {
    for (const params of [
      { page: 0 },
      { page: 1.5 },
      { page_size: 0 },
      { page_size: 201 },
      { keyword: 1 },
      { online: 'yes' }
    ]) {
      try {
        listUsers(fakeBridge(), params)
        throw new Error('应当抛错')
      } catch (error) {
        expect((error as { rpcCode?: number }).rpcCode).toBe(-32010)
      }
    }
  })
})

describe('requirePeer', () => {
  it('未知用户返回 -32011', () => {
    try {
      requirePeer(fakeBridge(), 'nope')
      throw new Error('应当抛错')
    } catch (error) {
      expect((error as { rpcCode?: number }).rpcCode).toBe(-32011)
    }
  })

  it('已知用户原样返回', () => {
    expect(requirePeer(fakeBridge(), peers[0].protocolId)).toEqual(peers[0])
  })
})
