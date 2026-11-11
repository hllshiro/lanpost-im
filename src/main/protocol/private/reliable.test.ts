import { describe, expect, it } from 'vitest'
import {
  ENET_CMD_ACK,
  ENET_CMD_SEND_FRAGMENT,
  ENET_FLAG_ACK,
  ENET_MTU,
  EnetError,
  ReliableEnd,
  buildFragmentPayload,
  decodeDatagram,
  encodeDatagram,
  parseAckPayload
} from './enet'

interface Pair {
  a: ReliableEnd
  b: ReliableEnd
  flush: () => Buffer[]
  advance: (ms: number) => void
}

function makePair(initialSeq?: number): Pair {
  let clock = 1000
  const aOut: Buffer[] = []
  const bOut: Buffer[] = []
  const a = new ReliableEnd({ peerId: 1, send: (d) => aOut.push(d), now: () => clock, initialSeq })
  const b = new ReliableEnd({ peerId: 2, send: (d) => bOut.push(d), now: () => clock })
  const flush = (): Buffer[] => {
    const delivered: Buffer[] = []
    while (aOut.length > 0) delivered.push(...b.receive(aOut.shift()!))
    while (bOut.length > 0) delivered.push(...a.receive(bOut.shift()!))
    return delivered
  }
  return { a, b, flush, advance: (ms: number) => (clock += ms) }
}

describe('reliable end', () => {
  it('delivers in order and acks', () => {
    const { a, flush } = makePair()
    a.send(Buffer.from('one'))
    a.send(Buffer.from('two'))
    expect(flush().map((b) => b.toString())).toEqual(['one', 'two'])
  })

  it('retransmits until acked', () => {
    const sent: Buffer[] = []
    let clock = 0
    const a = new ReliableEnd({ peerId: 1, send: (d) => sent.push(d), now: () => clock })
    a.send(Buffer.from('x'))
    expect(sent).toHaveLength(1)
    clock += 500
    a.pump()
    expect(sent).toHaveLength(2)
    expect(a.pendingCount).toBe(1)
  })

  it('reassembles fragments', () => {
    const { a, flush } = makePair()
    a.send(Buffer.alloc(3000, 7))
    const delivered = flush()
    expect(delivered).toHaveLength(1)
    expect(delivered[0].length).toBe(3000)
  })

  it('survives 16-bit sequence wrap', () => {
    const { a, flush } = makePair(65534)
    a.send(Buffer.from('x'))
    a.send(Buffer.from('y'))
    a.send(Buffer.from('z'))
    expect(flush().map((b) => b.toString())).toEqual(['x', 'y', 'z'])
  })

  it('acks each reliable command on channel 0xff', () => {
    const clock = 1000
    const aOut: Buffer[] = []
    const bOut: Buffer[] = []
    const a = new ReliableEnd({ peerId: 1, send: (d) => aOut.push(d), now: () => clock })
    const b = new ReliableEnd({ peerId: 2, send: (d) => bOut.push(d), now: () => clock })
    a.send(Buffer.from('hi'))
    expect(b.receive(aOut[0])).toHaveLength(1)
    expect(a.pendingCount).toBe(1)
    const ack = decodeDatagram(bOut[0])
    expect(ack.peerId).toBe(2)
    expect(ack.commands).toHaveLength(1)
    expect(ack.commands[0].command).toBe(ENET_CMD_ACK)
    expect(ack.commands[0].channelId).toBe(0xff)
    expect(ack.commands[0].reliableSeq).toBe(1)
    expect(parseAckPayload(ack.commands[0].payload)).toEqual({ receivedSeq: 1, sentTime: 1000 })
    expect(a.receive(bOut[0])).toEqual([])
    expect(a.pendingCount).toBe(0)
  })

  it('holds out-of-order commands until the gap fills', () => {
    const clock = 1000
    const out: Buffer[] = []
    const a = new ReliableEnd({ peerId: 1, send: (d) => out.push(d), now: () => clock })
    const b = new ReliableEnd({ peerId: 2, send: () => {}, now: () => clock })
    a.send(Buffer.from('one'))
    a.send(Buffer.from('two'))
    a.send(Buffer.from('three'))
    expect(b.receive(out[0]).map((d) => d.toString())).toEqual(['one'])
    expect(b.receive(out[2])).toEqual([])
    expect(b.receive(out[1]).map((d) => d.toString())).toEqual(['two', 'three'])
  })

  it('rejects a fragment whose total length exceeds the fragment count', () => {
    const receiver = new ReliableEnd({ peerId: 2, send: () => {}, now: () => 0 })
    const payload = buildFragmentPayload({
      startSeq: 1,
      fragmentCount: 2,
      fragmentNumber: 0,
      totalLength: ENET_MTU * 2 + 1,
      offset: 0,
      data: Buffer.alloc(10)
    })
    const datagram = encodeDatagram(1, 0, [
      { command: ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK, channelId: 0, reliableSeq: 1, payload }
    ])
    expect(() => receiver.receive(datagram)).toThrow(EnetError)
  })

  it('drops a command after maxRetries retransmissions', () => {
    const sent: Buffer[] = []
    let clock = 0
    const a = new ReliableEnd({
      peerId: 1,
      send: (d) => sent.push(d),
      now: () => clock,
      retransmitMs: 100,
      maxRetries: 2
    })
    a.send(Buffer.from('x'))
    clock = 100
    a.pump()
    clock = 250
    a.pump()
    expect(sent).toHaveLength(3)
    expect(a.pendingCount).toBe(1)
    clock = 475
    a.pump()
    expect(sent).toHaveLength(3)
    expect(a.pendingCount).toBe(0)
  })
})
