import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../shared/domain'
import { chooseMacKeepPeer } from './dedupe'

function peer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: '10.0.0.1',
    ip: '10.0.0.1',
    port: 0,
    user: '',
    host: '',
    name: 'pc',
    group: '',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    corpId: '',
    online: false,
    ready: false,
    lastSeen: 0,
    unread: 0,
    alias: '',
    ...overrides
  }
}

describe('chooseMacKeepPeer', () => {
  it('prefers the real user id key over an address key', () => {
    const keep = chooseMacKeepPeer(
      [peer({ key: '10.0.0.1', user: '', lastSeen: 500 }), peer({ key: 'user-1', user: 'user-1' })],
      () => false
    )
    expect(keep?.key).toBe('user-1')
  })

  it('prefers an online peer when both have real ids', () => {
    const keep = chooseMacKeepPeer(
      [
        peer({ key: 'user-1', user: 'user-1', lastSeen: 500 }),
        peer({ key: 'user-2', user: 'user-2' })
      ],
      (item) => item.key === 'user-2'
    )
    expect(keep?.key).toBe('user-2')
  })

  it('prefers an online record over an offline one', () => {
    const keep = chooseMacKeepPeer(
      [
        peer({ key: 'user-1', user: 'user-1', lastSeen: 500 }),
        peer({ key: '10.0.0.9', user: 'user-2', lastSeen: 100 })
      ],
      (item) => item.key === '10.0.0.9'
    )
    expect(keep?.key).toBe('10.0.0.9')
  })

  it('falls back to the most recent row', () => {
    const keep = chooseMacKeepPeer(
      [
        peer({ key: 'user-1', user: 'user-1', lastSeen: 100 }),
        peer({ key: 'user-2', user: 'user-2', lastSeen: 300 })
      ],
      () => false
    )
    expect(keep?.key).toBe('user-2')
  })
})
