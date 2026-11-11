import { describe, expect, it } from 'vitest'
import { decodeBeacon } from './beacon'
import {
  ENET_CMD_CONNECT,
  ENET_CMD_SEND_RELIABLE,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  decodeDatagram,
  parseReliablePayload
} from './enet'
import type { PrivateProfile } from './messages'
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

  it('replies VERIFY_CONNECT and sends the hello as a raw 304-byte payload', () => {
    const clock = 0
    const toA: Buffer[] = []
    const toB: Buffer[] = []
    const a = makeSession(
      'client',
      (d) => toB.push(d),
      [],
      () => clock
    )
    const b = makeSession(
      'server',
      (d) => toA.push(d),
      [],
      () => clock
    )
    a.start()
    const connectDatagram = toB[0]!
    const connect = decodeDatagram(connectDatagram)
    expect(connect.peerId).toBe(0x0fff)
    expect(connect.commands[0]!.command).toBe(ENET_CMD_CONNECT | ENET_FLAG_ACK)
    b.receive(connectDatagram)
    const verify = decodeDatagram(toA[0]!)
    expect(verify.peerId).toBe(0)
    expect(verify.commands[0]!.command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
    expect(verify.commands[0]!.payload.readUInt16BE(0)).toBe(1)
    const hello = decodeDatagram(toA[1]!).commands[0]!
    expect(hello.command).toBe(ENET_CMD_SEND_RELIABLE | ENET_FLAG_ACK)
    const payload = parseReliablePayload(hello.payload)
    expect(payload.length).toBe(304)
    expect(payload.readUInt32BE(0)).toBe(304)
    expect(payload.readUInt32BE(4)).toBe(4)
    expect(decodeBeacon(payload)).toMatchObject({ type: 4, enetPort: 19012 })
  })
})
