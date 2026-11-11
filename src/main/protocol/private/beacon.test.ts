import { describe, expect, it } from 'vitest'
import { decodeBeacon, encodeBeacon } from './beacon'

const BEACON_HEX =
  '0000013000000001000000016adad709c0a80087c0a800ff2333233423343638653234646130666137303739343938313737356464376462666237633666000000000000000000000000000000000000000000000000000000000000000000da677fe4558fa381c8033e883c1dd99488000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001f400d43a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'

describe('beacon', () => {
  it('decodes the captured beacon', () => {
    const raw = Buffer.from(BEACON_HEX, 'hex')
    expect(raw.length).toBe(304)
    expect(decodeBeacon(raw)).toMatchObject({
      type: 1,
      ip: '192.168.0.135',
      ports: { beacon: 9011, tcp: 9012, enet: 9012 },
      userId: '68e24da0fa70794981775dd7dbfb7c6f',
      enetPort: 54330
    })
  })

  it('round-trips a hello message', () => {
    const peerId = Buffer.alloc(16, 0xab)
    const raw = encodeBeacon({
      type: 4,
      ip: '192.168.1.20',
      broadcast: '192.168.1.255',
      userId: '0123456789abcdef0123456789abcdef',
      peerId,
      enetPort: 54321
    })
    expect(raw.length).toBe(304)
    expect(raw.readUInt32BE(0x04)).toBe(4)
    expect(raw.readUInt32BE(0x08)).toBe(1)
    expect(raw.readUInt32BE(0x0c)).toBe(0x5fc1d8ec)
    expect(raw.readUInt32BE(0xa0)).toBe(500)
    expect(decodeBeacon(raw)).toMatchObject({
      type: 4,
      ip: '192.168.1.20',
      userId: '0123456789abcdef0123456789abcdef',
      enetPort: 54321
    })
    expect(decodeBeacon(raw)?.peerId.equals(peerId)).toBe(true)
  })

  it('rejects wrong lengths and mismatched length fields', () => {
    const raw = Buffer.from(BEACON_HEX, 'hex')
    expect(decodeBeacon(raw.subarray(0, 300))).toBeNull()
    const broken = Buffer.from(raw)
    broken.writeUInt32BE(999, 0)
    expect(decodeBeacon(broken)).toBeNull()
  })
})
