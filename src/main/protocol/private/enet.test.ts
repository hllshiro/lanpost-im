import { describe, expect, it } from 'vitest'
import {
  ENET_CMD_PING,
  ENET_CMD_SEND_FRAGMENT,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  buildFragmentPayload,
  buildVerifyPayload,
  decodeDatagram,
  encodeDatagram,
  parseFragmentPayload,
  parseVerifyPayload
} from './enet'

const CONNECT_DATAGRAM =
  '8fffd03082ff00010000ffff0000057800010000000000010000000000000000000013880000000200000002e417824b00000000'
const VERIFY_DATAGRAM =
  '8000ca1b83ff0001000100000000057800010000000000010000000000000000000013880000000200000002e417824b'

describe('enet codec', () => {
  it('decodes the captured connect datagram', () => {
    const d = decodeDatagram(Buffer.from(CONNECT_DATAGRAM, 'hex'))
    expect(d.peerId).toBe(0x0fff)
    expect(d.sentTime).toBe(0xd030)
    expect(d.commands).toHaveLength(1)
    expect(d.commands[0].command).toBe(0x02 | ENET_FLAG_ACK)
    expect(d.commands[0].reliableSeq).toBe(1)
    expect(d.commands[0].payload.length).toBe(44)
  })

  it('re-encodes the captured verify datagram', () => {
    const d = decodeDatagram(Buffer.from(VERIFY_DATAGRAM, 'hex'))
    expect(d.commands[0].command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
    expect(parseVerifyPayload(d.commands[0].payload)).toEqual({
      peerId: 1,
      connectId: 0xe417824b
    })
    expect(encodeDatagram(d.peerId, d.sentTime ?? 0, d.commands).toString('hex')).toBe(
      VERIFY_DATAGRAM
    )
    expect(buildVerifyPayload(1, 0xe417824b).equals(d.commands[0].payload)).toBe(true)
  })

  it('parses a captured fragment header', () => {
    const hex = '80006a0f880000010001055c00000002000000000000061e00000000'
    const d = decodeDatagram(Buffer.from(hex, 'hex'))
    const frag = parseFragmentPayload(d.commands[0].payload)
    expect(d.commands[0].command).toBe(ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK)
    expect(frag).toMatchObject({
      startSeq: 1,
      fragmentCount: 2,
      fragmentNumber: 0,
      totalLength: 0x61e,
      offset: 0
    })
  })

  it('round-trips a constructed fragment', () => {
    const payload = buildFragmentPayload({
      startSeq: 5,
      fragmentCount: 2,
      fragmentNumber: 1,
      totalLength: 100,
      offset: 44,
      data: Buffer.from('tail')
    })
    const parsed = parseFragmentPayload(payload)
    expect(parsed).toMatchObject({
      startSeq: 5,
      fragmentCount: 2,
      fragmentNumber: 1,
      totalLength: 100,
      offset: 44
    })
    expect(parsed.data.toString()).toBe('tail')
  })

  it('builds a ping command with the ack flag', () => {
    const raw = encodeDatagram(0x8001, 0x1234, [
      {
        command: ENET_CMD_PING | ENET_FLAG_ACK,
        channelId: 0xff,
        reliableSeq: 2,
        payload: Buffer.alloc(0)
      }
    ])
    expect(raw.toString('hex')).toBe('8001123485ff0002')
  })
})
