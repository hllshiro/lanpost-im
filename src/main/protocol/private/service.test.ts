import { createSocket, type Socket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeBeacon } from './beacon'
import {
  ENET_CMD_CONNECT,
  ENET_CMD_VERIFY,
  ENET_FLAG_ACK,
  buildConnectPayload,
  decodeDatagram,
  encodeDatagram
} from './enet'
import { PrivateService, type PrivateServiceOptions } from './service'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

interface FakePeer {
  socket: Socket
  port: number
  received: Buffer[]
}

async function fakePeer(): Promise<FakePeer> {
  const socket = createSocket('udp4')
  const received: Buffer[] = []
  socket.on('message', (data) => received.push(data))
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  cleanups.push(() => socket.close())
  return { socket, port: socket.address().port, received }
}

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve))
  const port = socket.address().port
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return port
}

function options(
  port: number,
  callbacks: Partial<PrivateServiceOptions['callbacks']> = {}
): PrivateServiceOptions {
  return {
    identity: { userId: '0123456789abcdef0123456789abcdef', peerId: Buffer.alloc(16, 2) },
    profile: { name: '本机', group: '', corporation: '', department: '', sign: '', status: 0 },
    bindAddr: '127.0.0.1',
    beaconPort: 0,
    enetPort: 0,
    localIp: '127.0.0.1',
    seeds: [{ ip: '127.0.0.1', port }],
    callbacks: {
      onText: () => {},
      onUnsupported: () => {},
      onAck: () => {},
      onReceipt: () => {},
      onState: () => {},
      onLog: () => {},
      onError: () => {},
      ...callbacks
    }
  }
}

async function waitFor<T>(probe: () => T | null, timeout = 2000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value !== null) return value
    if (Date.now() - started > timeout) throw new Error('等待私有通道事件超时')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('private service', () => {
  it('connects to a seeded endpoint with a CONNECT', async () => {
    const peer = await fakePeer()
    const service = new PrivateService(options(peer.port))
    await service.start()
    cleanups.push(() => void service.stop())
    const first = await waitFor(() => (peer.received.length > 0 ? peer.received[0] : null))
    const d = decodeDatagram(first)
    expect(d.commands[0].command).toBe(ENET_CMD_CONNECT | ENET_FLAG_ACK)
    expect(service.isReady('127.0.0.1')).toBe(false)
  })

  it('answers an inbound CONNECT and ignores malformed datagrams', async () => {
    const peer = await fakePeer()
    const service = new PrivateService(options(peer.port))
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(Buffer.from('not a packet'), service.localEnetPort, '127.0.0.1')
    peer.socket.send(
      encodeDatagram(0x0fff, 1, [
        {
          command: ENET_CMD_CONNECT | ENET_FLAG_ACK,
          channelId: 0xff,
          reliableSeq: 1,
          payload: buildConnectPayload(0x1234)
        }
      ]),
      service.localEnetPort,
      '127.0.0.1'
    )
    const verify = await waitFor(() => {
      const found = peer.received.find((d) => (d[4] & 0x7f) === ENET_CMD_VERIFY)
      return found ?? null
    })
    const d = decodeDatagram(verify)
    expect(d.commands[0].command).toBe(ENET_CMD_VERIFY | ENET_FLAG_ACK)
  })

  it('dials a peer announced by a discovery beacon', async () => {
    const peer = await fakePeer()
    const beaconPort = await freeUdpPort()
    const service = new PrivateService({
      ...options(peer.port),
      beaconPort,
      seeds: []
    })
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(
      encodeBeacon({
        type: 1,
        ip: '127.0.0.1',
        broadcast: '127.0.0.255',
        userId: '0123456789abcdef0123456789abcdef',
        peerId: Buffer.alloc(16, 2),
        enetPort: peer.port
      }),
      beaconPort,
      '127.0.0.1'
    )
    const first = await waitFor(() => (peer.received.length > 0 ? peer.received[0] : null))
    const d = decodeDatagram(first)
    expect(d.commands[0].command).toBe(ENET_CMD_CONNECT | ENET_FLAG_ACK)
    expect(service.isReady('127.0.0.1')).toBe(false)
  })
})
