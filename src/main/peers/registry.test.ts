import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../shared/domain'
import { PeerRegistry } from './registry'

function seedPeer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: '10.0.0.1|alice',
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
  it('seeds historical peers offline and reuses the old key by IP', () => {
    const events: PeerInfo[][] = []
    const registry = new PeerRegistry([seedPeer()], { onPeers: (peers) => events.push(peers) })
    expect(registry.getPeers()[0]).toMatchObject({ key: '10.0.0.1|alice', online: false })

    const peer = registry.upsertPrivatePeer(input())
    expect(peer.key).toBe('10.0.0.1|alice')
    expect(peer.name).toBe('Bob')
    expect(peer.online).toBe(true)
    expect(events.at(-1)?.[0]?.key).toBe('10.0.0.1|alice')
  })

  it('creates a key from IP and private user id for a new peer', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    const peer = registry.upsertPrivatePeer(input({ ip: '10.0.0.2', userId: 'carol' }))
    expect(peer.key).toBe('10.0.0.2|carol')
    expect(registry.peerKeyForIp('10.0.0.2')).toBe('10.0.0.2|carol')
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
    registry.upsertPrivatePeer(input({ ip: '10.0.0.5', userId: 'frank' }))
    const peers = registry.getPeers()
    peers[0]!.name = 'mutated'
    expect(registry.getPeers()[0]?.name).toBe('Bob')
  })

  it('returns null for an unknown IP', () => {
    const registry = new PeerRegistry([], { onPeers: () => {} })
    expect(registry.peerKeyForIp('10.0.0.9')).toBeNull()
  })
})
