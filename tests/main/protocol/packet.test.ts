import { describe, expect, it } from 'vitest'
import { decodePacket, encodePacket, PacketError } from '../../../src/main/protocol/packet'

describe('packet', () => {
  it('encodes a standard version 1 header', () => {
    expect(
      encodePacket({
        seq: 100,
        user: 'alice',
        host: 'pc',
        cmd: 32,
        payload: Buffer.from('Hi')
      }).toString()
    ).toBe('1:100:alice:pc:32:Hi')
  })

  it('decodes an empty payload', () => {
    expect(decodePacket(Buffer.from('1:0:a:b:1:')).payload.length).toBe(0)
  })

  it('rejects seq over 32 bits', () => {
    expect(() => decodePacket(Buffer.from('1:4294967296:a:b:1:'))).toThrow(PacketError)
  })

  it('rejects unknown versions and truncated headers', () => {
    expect(() => decodePacket(Buffer.from('2:1:a:b:1:'))).toThrow(PacketError)
    expect(() => decodePacket(Buffer.from('1:1:a'))).toThrow(PacketError)
  })

  it('accepts legacy version tokens with a leading 1', () => {
    expect(decodePacket(Buffer.from('1@shiyeline:1:a:b:1:')).version).toBe('1')
    expect(decodePacket(Buffer.from('1_lbt80_0#123#9:1:a:b:1:')).version).toBe('1')
  })
})

describe('private version compatibility', () => {
  it('accepts the NWT private version used by file cancel', () => {
    const packet = Buffer.concat([
      Buffer.from('5@shiyeline:1:peer:host:230:6adffd84:', 'ascii'),
      Buffer.from([0]),
      Buffer.from('7', 'ascii'),
      Buffer.from([0])
    ])
    expect(decodePacket(packet).version).toBe('5@shiyeline')
    expect(() => decodePacket(Buffer.from('5:1:a:b:1:'))).toThrow(PacketError)
  })
})
