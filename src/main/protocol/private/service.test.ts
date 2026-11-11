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

async function fakePeer(port = 0, address = '127.0.0.1'): Promise<FakePeer> {
  const socket = createSocket('udp4')
  const received: Buffer[] = []
  socket.on('message', (data) => received.push(data))
  await new Promise<void>((resolve) => socket.bind(port, address, resolve))
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

async function twoFreePorts(): Promise<[number, number]> {
  for (;;) {
    const first = await freeUdpPort()
    const second = await freeUdpPort()
    if (first !== second) return [first, second]
  }
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

function connectDatagram(connectId: number): Buffer {
  return encodeDatagram(0x0fff, 1, [
    {
      command: ENET_CMD_CONNECT | ENET_FLAG_ACK,
      channelId: 0xff,
      reliableSeq: 1,
      payload: buildConnectPayload(connectId)
    }
  ])
}

function isCommand(data: Buffer, command: number): boolean {
  return (data[4] & 0x7f) === command
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
    const service = new PrivateService({ ...options(peer.port), seeds: [] })
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(Buffer.from('not a packet'), service.localEnetPort, '127.0.0.1')
    peer.socket.send(connectDatagram(0x1234), service.localEnetPort, '127.0.0.1')
    const verify = await waitFor(() => {
      const found = peer.received.find((d) => isCommand(d, ENET_CMD_VERIFY))
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

  it('resolves simultaneous connects by port when both share an address', async () => {
    const [portA, portB] = await twoFreePorts()
    const a = new PrivateService({
      ...options(portB),
      enetPort: portA,
      seeds: [{ ip: '127.0.0.1', port: portB }]
    })
    const b = new PrivateService({
      ...options(portA),
      enetPort: portB,
      seeds: [{ ip: '127.0.0.1', port: portA }]
    })
    cleanups.push(
      () => void a.stop(),
      () => void b.stop()
    )
    await Promise.all([a.start(), b.start()])
    await waitFor(() => (a.isReady('127.0.0.1') && b.isReady('127.0.0.1') ? true : null), 5000)
    await Promise.all([a.stop(), b.stop()])
  })

  it('resolves simultaneous connects by address when they differ', async () => {
    const [portA, portB] = await twoFreePorts()
    const a = new PrivateService({
      ...options(portB),
      bindAddr: '127.0.0.1',
      localIp: '127.0.0.1',
      enetPort: portA,
      seeds: [{ ip: '127.0.0.2', port: portB }]
    })
    const b = new PrivateService({
      ...options(portA),
      bindAddr: '127.0.0.2',
      localIp: '127.0.0.2',
      enetPort: portB,
      seeds: [{ ip: '127.0.0.1', port: portA }]
    })
    cleanups.push(
      () => void a.stop(),
      () => void b.stop()
    )
    await Promise.all([a.start(), b.start()])
    await waitFor(() => (a.isReady('127.0.0.2') && b.isReady('127.0.0.1') ? true : null), 5000)
    await Promise.all([a.stop(), b.stop()])
  })

  it('takes over an inbound CONNECT when the local address is larger', async () => {
    const peer = await fakePeer()
    const service = new PrivateService({
      ...options(peer.port),
      localIp: '127.0.0.2',
      seeds: [{ ip: '127.0.0.1', port: peer.port }]
    })
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(connectDatagram(0x1234), service.localEnetPort, '127.0.0.1')
    await waitFor(() => peer.received.find((d) => isCommand(d, ENET_CMD_VERIFY)) ?? null)
  })

  it('keeps its outgoing connect when the local address is smaller', async () => {
    const peer = await fakePeer(0, '127.0.0.2')
    const service = new PrivateService({
      ...options(peer.port),
      localIp: '127.0.0.1',
      seeds: [{ ip: '127.0.0.2', port: peer.port }]
    })
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(connectDatagram(0x1234), service.localEnetPort, '127.0.0.1')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(peer.received.some((d) => isCommand(d, ENET_CMD_VERIFY))).toBe(false)
  })

  it('takes over an inbound CONNECT when the local port is larger', async () => {
    const [first, second] = await twoFreePorts()
    const peerPort = Math.min(first, second)
    const localPort = Math.max(first, second)
    const peer = await fakePeer(peerPort)
    const service = new PrivateService({
      ...options(peerPort),
      enetPort: localPort,
      seeds: [{ ip: '127.0.0.1', port: peerPort }]
    })
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(connectDatagram(0x1234), service.localEnetPort, '127.0.0.1')
    await waitFor(() => peer.received.find((d) => isCommand(d, ENET_CMD_VERIFY)) ?? null)
  })

  it('keeps its outgoing connect when the local port is smaller', async () => {
    const [first, second] = await twoFreePorts()
    const peerPort = Math.max(first, second)
    const localPort = Math.min(first, second)
    const peer = await fakePeer(peerPort)
    const service = new PrivateService({
      ...options(peerPort),
      enetPort: localPort,
      seeds: [{ ip: '127.0.0.1', port: peerPort }]
    })
    await service.start()
    cleanups.push(() => void service.stop())
    peer.socket.send(connectDatagram(0x1234), service.localEnetPort, '127.0.0.1')
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(peer.received.some((d) => isCommand(d, ENET_CMD_VERIFY))).toBe(false)
  })

  it('rejects an invalid local address before binding', async () => {
    const port = await freeUdpPort()
    const service = new PrivateService({
      ...options(port),
      localIp: 'not-an-ip',
      enetPort: port,
      seeds: []
    })
    await expect(service.start()).rejects.toThrow('本机地址格式错误')
    expect(service.localEnetPort).toBe(0)
    const probe = createSocket('udp4')
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.bind(port, '127.0.0.1', resolve)
    })
    cleanups.push(() => probe.close())
  })
})
