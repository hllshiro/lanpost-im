import { describe, expect, it } from 'vitest'
import { decodeBeacon } from './beacon'
import {
  ENET_CMD_CONNECT,
  ENET_CMD_SEND_RELIABLE,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  buildVerifyPayload,
  decodeDatagram,
  encodeDatagram,
  parseConnectPayload,
  parseReliablePayload
} from './enet'
import type { PrivateProfile } from './messages'
import { decodeFrame } from './frame'
import { PrivateSession } from './session'

const profile: PrivateProfile = {
  name: '本机',
  group: '',
  corporation: '',
  department: '',
  sign: '',
  status: 0
}

function makeSession(
  role: 'client' | 'server',
  send: (data: Buffer) => void,
  events: string[],
  now: () => number
): PrivateSession {
  return new PrivateSession({
    role,
    remoteIp: '127.0.0.1',
    remotePort: 9012,
    localIp: '127.0.0.1',
    localPort: 19012,
    identity: {
      userId: '0123456789abcdef0123456789abcdef',
      peerId: Buffer.alloc(16, role === 'client' ? 1 : 2)
    },
    profile,
    send,
    now,
    callbacks: {
      onText: (id, text) => events.push(`text:${id}:${text}`),
      onUnsupported: (id) => events.push(`unsupported:${id}`),
      onAck: (id) => events.push(`ack:${id}`),
      onReceipt: (id) => events.push(`receipt:${id}`),
      onProfile: () => events.push('profile'),
      onState: (state) => events.push(`state:${state}`),
      onLog: () => {}
    }
  })
}

interface Pair {
  a: PrivateSession
  b: PrivateSession
  toA: Buffer[]
  toB: Buffer[]
  aEvents: string[]
  bEvents: string[]
}

function connectPair(now: () => number): Pair {
  const toA: Buffer[] = []
  const toB: Buffer[] = []
  const aEvents: string[] = []
  const bEvents: string[] = []
  return {
    a: makeSession('client', (d) => toB.push(d), aEvents, now),
    b: makeSession('server', (d) => toA.push(d), bEvents, now),
    toA,
    toB,
    aEvents,
    bEvents
  }
}

function flushAll(pair: Pair): void {
  let moved = true
  while (moved) {
    moved = false
    while (pair.toB.length > 0) {
      pair.b.receive(pair.toB.shift()!)
      moved = true
    }
    while (pair.toA.length > 0) {
      pair.a.receive(pair.toA.shift()!)
      moved = true
    }
  }
}

function appFrames(datagrams: Buffer[]): Array<{ cmd: number; xml: string }> {
  const frames: Array<{ cmd: number; xml: string }> = []
  for (const datagram of datagrams) {
    for (const command of decodeDatagram(datagram).commands) {
      if ((command.command & 0x7f) !== ENET_CMD_SEND_RELIABLE) continue
      frames.push(decodeFrame(parseReliablePayload(command.payload)))
    }
  }
  return frames
}

describe('private session', () => {
  it('reaches ready on both sides and delivers text', () => {
    const clock = 0
    const toA: Buffer[] = []
    const toB: Buffer[] = []
    const aEvents: string[] = []
    const bEvents: string[] = []
    const a = makeSession(
      'client',
      (d) => toB.push(d),
      aEvents,
      () => clock
    )
    const b = makeSession(
      'server',
      (d) => toA.push(d),
      bEvents,
      () => clock
    )
    const flush = (): void => {
      let moved = true
      while (moved) {
        moved = false
        while (toB.length > 0) {
          b.receive(toB.shift()!)
          moved = true
        }
        while (toA.length > 0) {
          a.receive(toA.shift()!)
          moved = true
        }
      }
    }
    a.start()
    flush()
    expect(a.state).toBe('ready')
    expect(b.state).toBe('ready')
    expect(a.sendText(1, 'hi')).toBe(true)
    flush()
    expect(bEvents).toContain('text:1:hi')
    expect(aEvents).toContain('ack:1')
  })

  it('refuses to send before ready and closes after 120s of silence', () => {
    let clock = 0
    const sent: Buffer[] = []
    const session = makeSession(
      'client',
      (d) => sent.push(d),
      [],
      () => clock
    )
    expect(session.sendText(1, 'hi')).toBe(false)
    session.start()
    clock += 120000
    session.pump()
    expect(session.state).toBe('closed')
  })

  it('ignores malformed datagrams and reports receipts once ready', () => {
    const clock = 0
    const toA: Buffer[] = []
    const toB: Buffer[] = []
    const aEvents: string[] = []
    const a = makeSession(
      'client',
      (d) => toB.push(d),
      aEvents,
      () => clock
    )
    const b = makeSession(
      'server',
      (d) => toA.push(d),
      [],
      () => clock
    )
    const flush = (): void => {
      let moved = true
      while (moved) {
        moved = false
        while (toB.length > 0) {
          b.receive(toB.shift()!)
          moved = true
        }
        while (toA.length > 0) {
          a.receive(toA.shift()!)
          moved = true
        }
      }
    }
    expect(() => a.receive(Buffer.from('not a datagram'))).not.toThrow()
    a.start()
    flush()
    expect(a.state).toBe('ready')
    expect(b.state).toBe('ready')
    b.sendReceipt(7)
    flush()
    expect(aEvents).toContain('receipt:7')
  })

  it('replies VERIFY_CONNECT with the assigned peer id', () => {
    const clock = 0
    const pair = connectPair(() => clock)
    pair.a.start()
    const connectDatagram = pair.toB[0]!
    const connect = decodeDatagram(connectDatagram)
    expect(connect.peerId).toBe(0x0fff)
    expect(connect.commands[0]!.command).toBe(ENET_CMD_CONNECT | ENET_FLAG_ACK)
    pair.b.receive(connectDatagram)
    const verify = decodeDatagram(pair.toA[0]!)
    expect(verify.peerId).toBe(0)
    expect(verify.commands[0]!.command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
    expect(verify.commands[0]!.payload.readUInt16BE(0)).toBe(1)
    expect(pair.b.state).toBe('verifying')
  })

  it('resends the same VERIFY_CONNECT when the CONNECT is repeated', () => {
    const clock = 0
    const pair = connectPair(() => clock)
    pair.a.start()
    const connect = pair.toB[0]!
    pair.b.receive(connect)
    expect(pair.b.state).toBe('verifying')
    expect(pair.toA.length).toBe(1)
    pair.b.receive(connect)
    expect(pair.b.state).toBe('verifying')
    expect(pair.toA.length).toBe(2)
    expect(pair.toA[1]!.equals(pair.toA[0]!)).toBe(true)
    expect(decodeDatagram(pair.toA[1]!).commands[0]!.command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
  })

  it('waits for the VERIFY ack before sending the server hello', () => {
    const clock = 0
    const pair = connectPair(() => clock)
    pair.a.start()
    pair.b.receive(pair.toB.shift()!)
    expect(pair.b.state).toBe('verifying')
    expect(appFrames(pair.toA)).toHaveLength(0)
    pair.a.receive(pair.toA.shift()!)
    const ack = pair.toB.shift()!
    pair.b.receive(ack)
    expect(pair.b.state).toBe('handshaking')
    const hello = decodeDatagram(pair.toA[0]!).commands[0]!
    expect(hello.command).toBe(ENET_CMD_SEND_RELIABLE | ENET_FLAG_ACK)
    expect(hello.reliableSeq).toBe(1)
    const payload = parseReliablePayload(hello.payload)
    expect(payload.length).toBe(304)
    expect(payload.readUInt32BE(0)).toBe(304)
    expect(payload.readUInt32BE(4)).toBe(4)
    expect(decodeBeacon(payload)).toMatchObject({ type: 4, enetPort: 19012 })
  })

  it('ignores VERIFY_CONNECT with a different connect id', () => {
    const clock = 0
    const pair = connectPair(() => clock)
    pair.a.start()
    const connect = parseConnectPayload(decodeDatagram(pair.toB[0]!).commands[0]!.payload)
    const verify = encodeDatagram(0, 0, [
      {
        command: ENET_CMD_VERIFY | ENET_FLAG_ACK,
        channelId: 0xff,
        reliableSeq: 1,
        payload: buildVerifyPayload(1, (connect.connectId + 1) >>> 0)
      }
    ])
    pair.a.receive(verify)
    expect(pair.a.state).toBe('connecting')
    expect(pair.toB.length).toBe(1)
  })

  it('sends a heartbeat after 30s in ready', () => {
    let clock = 0
    const pair = connectPair(() => clock)
    pair.a.start()
    flushAll(pair)
    expect(pair.a.state).toBe('ready')
    expect(pair.b.state).toBe('ready')
    clock += 30000
    pair.a.pump()
    expect(appFrames(pair.toB).map((frame) => frame.cmd)).toContain(1016)
  })

  it('sends X_QUIT on close and refuses to send text afterwards', () => {
    const clock = 0
    const pair = connectPair(() => clock)
    pair.a.start()
    flushAll(pair)
    expect(pair.a.state).toBe('ready')
    pair.a.close()
    expect(pair.a.state).toBe('closed')
    expect(pair.a.sendText(2, 'hi')).toBe(false)
    expect(appFrames(pair.toB).map((frame) => frame.cmd)).toContain(1017)
  })
})
