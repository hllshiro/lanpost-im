import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../../shared/domain'
import { eligibleTargets } from './broadcast'

function peer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: '10.0.0.1|alice',
    ip: '10.0.0.1',
    port: 0,
    user: 'alice',
    host: '',
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

describe('eligibleTargets', () => {
  it('drops offline and not-ready peers', () => {
    const targets = eligibleTargets(
      [
        peer({ key: 'a', ip: '10.0.0.1' }),
        peer({ key: 'b', ip: '10.0.0.2', online: false }),
        peer({ key: 'c', ip: '10.0.0.3' })
      ],
      (ip) => ip !== '10.0.0.3'
    )
    expect(targets.map((item) => item.key)).toEqual(['a'])
  })

  it('deduplicates and keeps the input order', () => {
    const targets = eligibleTargets(
      [
        peer({ key: 'b', ip: '10.0.0.2' }),
        peer({ key: 'a', ip: '10.0.0.1' }),
        peer({ key: 'b', ip: '10.0.0.2' })
      ],
      () => true
    )
    expect(targets.map((item) => item.key)).toEqual(['b', 'a'])
  })

  it('returns an empty list when nobody is eligible', () => {
    expect(eligibleTargets([peer({ online: false })], () => true)).toEqual([])
  })
})
