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
  it('carries the private user id and follows the session state', () => {
    const online = applyPresence(peer({ online: false, ready: false }), {
      ready: true,
      privateUserId: 'aaaa'
    })
    expect(online).toMatchObject({ online: true, ready: true, privateUserId: 'aaaa' })

    const offline = applyPresence(peer(), { ready: false, privateUserId: '' })
    expect(offline).toMatchObject({ online: false, ready: false, privateUserId: '' })
  })

  it('keeps other peer fields untouched', () => {
    const result = applyPresence(peer({ alias: '别名', unread: 3 }), {
      ready: true,
      privateUserId: 'bbbb'
    })
    expect(result.alias).toBe('别名')
    expect(result.unread).toBe(3)
    expect(result.ip).toBe('10.0.0.1')
  })
})
