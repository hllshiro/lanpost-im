import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../shared/domain'
import { PeerRegistry } from './registry'

function seedPeer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: 'alice',
    ip: '10.0.0.1',
    port: 0,
    user: 'alice',
    host: 'pc-a',
    name: 'Alice',
    group: '研发',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    corpId: '',
    online: true,
    ready: true,
    lastSeen: 100,
    unread: 0,
    alias: '',
    ...overrides
  }
}

function input(
  overrides: Partial<Parameters<PeerRegistry['upsertPrivatePeer']>[0]> = {}
): Parameters<PeerRegistry['upsertPrivatePeer']>[0] {
  return {
    ip: '10.0.0.1',
    userId: 'bob',
    name: 'Bob',
    group: '',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    online: true,
    ...overrides
  }
}

describe('PeerRegistry', () => {
  it('seeds historical peers offline and keys a new user by their own id', () => {
    const events: PeerInfo[][] = []
    const registry = new PeerRegistry([seedPeer()], { onPeers: (peers) => events.push(peers) })
    expect(registry.getPeers()[0]).toMatchObject({ key: 'alice', online: false })

    const peer = registry.upsertPrivatePeer(input())
    expect(peer.key).toBe('bob')
    expect(peer.name).toBe('Bob')
    expect(peer.online).toBe(true)
    expect(
      registry
        .getPeers()
        .map((item) => item.key)
        .sort()
    ).toEqual(['alice', 'bob'])
    expect(registry.peerKeyForIp('10.0.0.1')).toBe('bob')
  })

  it('uses the private user id as the peer key', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const peer = registry.upsertPrivatePeer(input({ ip: '10.0.0.2', userId: 'carol' }))
    expect(peer.key).toBe('carol')
    expect(registry.peerKeyForIp('10.0.0.2')).toBe('carol')
  })

  it('renames the peer when the user id arrives after the address', () => {
    const changes: Array<[string, string]> = []
    const registry = new PeerRegistry([], {
      onPeers: () => {},
      onPeerKeyChanged: (from, to) => changes.push([from, to])
    })
    const first = registry.upsertPrivatePeer(input({ ip: '10.0.0.9', userId: '', name: '匿名' }))
    expect(first.key).toBe('10.0.0.9')

    const second = registry.upsertPrivatePeer(input({ ip: '10.0.0.9', userId: 'frank' }))
    expect(second.key).toBe('frank')
    expect(changes).toEqual([['10.0.0.9', 'frank']])
    expect(registry.getPeers().map((peer) => peer.key)).toEqual(['frank'])
    expect(registry.peerKeyForIp('10.0.0.9')).toBe('frank')
  })

  it('就绪回调带来用户号时改名', () => {
    const changes: Array<[string, string]> = []
    const registry = new PeerRegistry([], {
      onPeers: () => {},
      onPeerKeyChanged: (from, to) => changes.push([from, to])
    })
    registry.upsertPrivatePeer(input({ ip: '10.0.0.8', userId: '', name: '待识别' }))
    const key = registry.assignUserId('10.0.0.8', 'heidi')
    expect(key).toBe('heidi')
    expect(changes).toEqual([['10.0.0.8', 'heidi']])
    expect(registry.getPeers().map((peer) => [peer.key, peer.user])).toEqual([['heidi', 'heidi']])
    expect(registry.peerKeyForIp('10.0.0.8')).toBe('heidi')
  })

  it('同一地址换成另一个用户时单独建联系人', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const first = registry.upsertPrivatePeer(input({ ip: '10.0.0.11', userId: 'ivan' }))
    const second = registry.upsertPrivatePeer(input({ ip: '10.0.0.11', userId: 'judy' }))
    expect(first.key).toBe('ivan')
    expect(second.key).toBe('judy')
    expect(registry.getPeers()).toHaveLength(2)
    expect(registry.peerKeyForIp('10.0.0.11')).toBe('judy')
  })

  it('keeps one peer when the address changes', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const first = registry.upsertPrivatePeer(input({ ip: '10.0.0.5', userId: 'dave' }))
    const second = registry.upsertPrivatePeer(input({ ip: '10.0.0.6', userId: 'dave' }))
    expect(second.key).toBe(first.key)
    expect(registry.getPeers()).toHaveLength(1)
    expect(registry.peerKeyForIp('10.0.0.5')).toBeNull()
    expect(registry.peerKeyForIp('10.0.0.6')).toBe('dave')
  })

  it('keeps the key stable when the profile changes', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const first = registry.upsertPrivatePeer(input({ ip: '10.0.0.3', userId: 'dave' }))
    const second = registry.upsertPrivatePeer(
      input({ ip: '10.0.0.3', userId: 'dave', name: 'Dave 2', status: 2 })
    )
    expect(second.key).toBe(first.key)
    expect(second.name).toBe('Dave 2')
    expect(second.status).toBe(2)
  })

  it('updates online state and last seen without changing the key', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const peer = registry.upsertPrivatePeer(input({ ip: '10.0.0.4', userId: 'erin' }))
    registry.markPrivatePeerOffline('10.0.0.4')
    expect(registry.getPeers().find((item) => item.key === peer.key)?.online).toBe(false)
    registry.touchPrivatePeer('10.0.0.4')
    const online = registry.getPeers().find((item) => item.key === peer.key)
    expect(online?.online).toBe(true)
    expect(online?.lastSeen).toBeGreaterThan(0)
  })

  it('returns clones so callers cannot mutate registry state', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const peer = registry.upsertPrivatePeer(input({ ip: '10.0.0.7', userId: 'grace' }))
    peer.name = 'changed'
    expect(registry.getPeers()[0].name).toBe('Bob')
  })
})
