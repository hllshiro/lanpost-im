import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../shared/domain'
import { applyPresence } from './presence'

function peer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: 'alice',
    ip: '10.0.0.1',
    port: 0,
    user: 'alice',
    host: 'pc-a',
    name: 'Alice',
    group: '',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    corpId: '',
    online: true,
    ready: true,
    lastSeen: 0,
    unread: 0,
    alias: '',
    ...overrides
  }
}

describe('applyPresence', () => {
  it('carries the private user id and follows presence flags', () => {
    const online = applyPresence(peer({ online: false, ready: false }), {
      online: true,
      ready: false,
      privateUserId: 'aaaa'
    })
    expect(online).toMatchObject({ online: true, ready: false, privateUserId: 'aaaa' })

    const offline = applyPresence(peer(), { online: false, ready: false, privateUserId: '' })
    expect(offline).toMatchObject({ online: false, ready: false, privateUserId: '' })
  })

  it('keeps other peer fields untouched', () => {
    const result = applyPresence(peer({ alias: '别名', unread: 3 }), {
      online: true,
      ready: true,
      privateUserId: 'bbbb'
    })
    expect(result.alias).toBe('别名')
    expect(result.unread).toBe(3)
    expect(result.ip).toBe('10.0.0.1')
  })
})
