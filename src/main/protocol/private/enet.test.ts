import { describe, expect, it } from 'vitest'
import {
  ENET_CMD_PING,
  ENET_CMD_SEND_FRAGMENT,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  EnetError,
  buildAckPayload,
  buildFragmentPayload,
  buildVerifyPayload,
  decodeDatagram,
  encodeDatagram,
  parseAckPayload,
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

  it('decodes the captured ACK + PING datagram', () => {
    const d = decodeDatagram(Buffer.from('8001d09501ff00010001ca1b85ff0002', 'hex'))
    expect(d.peerId).toBe(1)
    expect(d.sentTime).toBe(0xd095)
    expect(d.commands).toHaveLength(2)
    expect(d.commands[0].command).toBe(0x01)
    expect(d.commands[0].channelId).toBe(0xff)
    expect(d.commands[0].reliableSeq).toBe(1)
    expect(parseAckPayload(d.commands[0].payload)).toEqual({ receivedSeq: 1, sentTime: 0xca1b })
    expect(d.commands[1].command).toBe(ENET_CMD_PING | ENET_FLAG_ACK)
    expect(d.commands[1].payload.length).toBe(0)
    expect(buildAckPayload(1, 0xca1b).equals(d.commands[0].payload)).toBe(true)
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
    const datagram = encodeDatagram(1, 7, [
      { command: ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK, channelId: 0, reliableSeq: 5, payload }
    ])
    expect(decodeDatagram(datagram).commands[0].payload.equals(payload)).toBe(true)
  })

  it('rejects a datagram whose declared length exceeds the data', () => {
    const payload = buildFragmentPayload({
      startSeq: 5,
      fragmentCount: 2,
      fragmentNumber: 1,
      totalLength: 100,
      offset: 44,
      data: Buffer.from('tail')
    })
    const datagram = encodeDatagram(1, 7, [
      { command: ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK, channelId: 0, reliableSeq: 5, payload }
    ])
    expect(() => decodeDatagram(datagram.subarray(0, datagram.length - 2))).toThrow()
  })

  it('rejects an unknown command', () => {
    const datagram = encodeDatagram(1, 7, [
      { command: 0x0e, channelId: 0, reliableSeq: 1, payload: Buffer.alloc(0) }
    ])
    expect(() => decodeDatagram(datagram)).toThrow(EnetError)
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
