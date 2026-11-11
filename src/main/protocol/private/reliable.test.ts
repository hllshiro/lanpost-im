import { describe, expect, it } from 'vitest'
import {
  ENET_CMD_ACK,
  ENET_CMD_SEND_FRAGMENT,
  ENET_FLAG_ACK,
  ENET_MTU,
  EnetError,
  ReliableEnd,
  buildAckPayload,
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

function makePair(initialSeq?: number, initialPeerSeq?: number): Pair {
  let clock = 1000
  const aOut: Buffer[] = []
  const bOut: Buffer[] = []
  const a = new ReliableEnd({ peerId: 1, send: (d) => aOut.push(d), now: () => clock, initialSeq })
  const b = new ReliableEnd({
    peerId: 2,
    send: (d) => bOut.push(d),
    now: () => clock,
    initialPeerSeq
  })
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
    const { a, flush } = makePair(65534, 65534)
    a.send(Buffer.from('x'))
    a.send(Buffer.from('y'))
    a.send(Buffer.from('z'))
    expect(flush().map((b) => b.toString())).toEqual(['x', 'y', 'z'])
  })

  it('acks each reliable command on the channel it arrived on', () => {
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
    expect(ack.commands[0].channelId).toBe(0)
    expect(ack.commands[0].reliableSeq).toBe(1)
    expect(parseAckPayload(ack.commands[0].payload)).toEqual({ receivedSeq: 1, sentTime: 1000 })
    expect(a.receive(bOut[0])).toEqual([])
    expect(a.pendingCount).toBe(0)
  })

  it('writes the session id into every outgoing header', () => {
    const clock = 1000
    const aOut: Buffer[] = []
    const bOut: Buffer[] = []
    const a = new ReliableEnd({
      peerId: 1,
      sessionId: 2,
      send: (d) => aOut.push(d),
      now: () => clock
    })
    const b = new ReliableEnd({
      peerId: 2,
      sessionId: 3,
      send: (d) => bOut.push(d),
      now: () => clock
    })
    a.send(Buffer.from('hi'))
    expect(aOut[0]!.readUInt16BE(0)).toBe(0xa001)
    expect(decodeDatagram(aOut[0]!).sessionId).toBe(2)
    expect(b.receive(aOut[0]!)).toHaveLength(1)
    expect(bOut[0]!.readUInt16BE(0)).toBe(0xb002)
    expect(decodeDatagram(bOut[0]!).sessionId).toBe(3)
  })

  it('waits for the expected first sequence instead of moving the baseline', () => {
    const clock = 1000
    const out: Buffer[] = []
    const a = new ReliableEnd({ peerId: 1, send: (d) => out.push(d), now: () => clock })
    const b = new ReliableEnd({ peerId: 2, send: () => {}, now: () => clock })
    a.send(Buffer.from('one'))
    a.send(Buffer.from('two'))
    expect(b.receive(out[1])).toEqual([])
    expect(b.receive(out[0]).map((d) => d.toString())).toEqual(['one', 'two'])
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

  it('ignores an ack whose sentTime does not match the last transmission', () => {
    const clock = 1000
    const a = new ReliableEnd({ peerId: 1, send: () => {}, now: () => clock })
    a.send(Buffer.from('hi'))
    const stale = encodeDatagram(2, clock & 0xffff, [
      {
        command: ENET_CMD_ACK,
        channelId: 0xff,
        reliableSeq: 1,
        payload: buildAckPayload(1, 999)
      }
    ])
    expect(a.receive(stale)).toEqual([])
    expect(a.pendingCount).toBe(1)
    const fresh = encodeDatagram(2, clock & 0xffff, [
      {
        command: ENET_CMD_ACK,
        channelId: 0xff,
        reliableSeq: 1,
        payload: buildAckPayload(1, 1000)
      }
    ])
    a.receive(fresh)
    expect(a.pendingCount).toBe(0)
  })

  it('rejects a fragment over the inbound message limit', () => {
    const receiver = new ReliableEnd({ peerId: 2, send: () => {}, now: () => 0 })
    const fragmentDatagram = (input: { fragmentCount: number; totalLength: number }): Buffer =>
      encodeDatagram(1, 0, [
        {
          command: ENET_CMD_SEND_FRAGMENT | ENET_FLAG_ACK,
          channelId: 0,
          reliableSeq: 1,
          payload: buildFragmentPayload({
            startSeq: 1,
            fragmentCount: input.fragmentCount,
            fragmentNumber: 0,
            totalLength: input.totalLength,
            offset: 0,
            data: Buffer.alloc(10)
          })
        }
      ])
    const hugeTotalLength = fragmentDatagram({ fragmentCount: 1_000_000, totalLength: 0xffffffff })
    expect(() => receiver.receive(hugeTotalLength)).toThrow(EnetError)
    const justOverOneMiB = fragmentDatagram({
      fragmentCount: 750,
      totalLength: 1024 * 1024 + 1
    })
    expect(() => receiver.receive(justOverOneMiB)).toThrow(EnetError)
    const tooManyFragments = fragmentDatagram({ fragmentCount: 1000, totalLength: 1000 })
    expect(() => receiver.receive(tooManyFragments)).toThrow(EnetError)
    expect(() => receiver.send(Buffer.alloc(1024 * 1024 + 1))).toThrow(EnetError)
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

  it('evicts an incomplete fragment group after 30 seconds', () => {
    let clock = 1000
    const aOut: Buffer[] = []
    const bOut: Buffer[] = []
    const cOut: Buffer[] = []
    const a = new ReliableEnd({ peerId: 1, send: (d) => aOut.push(d), now: () => clock })
    const b = new ReliableEnd({ peerId: 2, send: (d) => bOut.push(d), now: () => clock })
    const c = new ReliableEnd({
      peerId: 1,
      send: (d) => cOut.push(d),
      now: () => clock,
      initialSeq: 2
    })
    a.send(Buffer.alloc(3000, 7))
    expect(b.receive(aOut[0])).toEqual([])
    clock += 31_000
    b.pump()
    c.send(Buffer.alloc(2000, 9))
    const delivered: Buffer[] = []
    for (const datagram of cOut) delivered.push(...b.receive(datagram))
    expect(delivered).toHaveLength(1)
    expect(delivered[0].length).toBe(2000)
  })

  it('does not resurrect an expired fragment group on retransmission', () => {
    let clock = 1000
    const aOut: Buffer[] = []
    const a = new ReliableEnd({ peerId: 1, send: (d) => aOut.push(d), now: () => clock })
    const b = new ReliableEnd({ peerId: 2, send: () => {}, now: () => clock })
    a.send(Buffer.alloc(3000, 7))
    expect(b.receive(aOut[0])).toEqual([])
    clock += 31_000
    b.pump()
    a.pump()
    const replayed: Buffer[] = []
    while (aOut.length > 0) replayed.push(...b.receive(aOut.shift()!))
    expect(replayed).toEqual([])
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
