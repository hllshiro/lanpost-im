import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ProtocolEngine,
  type ProtocolCallbacks,
  type ProtocolConfig,
  type ProtocolPeer
} from './engine'

const engines: ProtocolEngine[] = []

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()))
})

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => resolve())
  })
  const port = socket.address().port
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return port
}

function config(name: string, port: number, seeds: string[]): ProtocolConfig {
  return {
    name,
    account: name,
    host: `${name}-host`,
    group: '',
    status: 0,
    port,
    bindAddr: '127.0.0.1',
    subnets: [],
    seeds,
    broadcastInterval: 3600
  }
}

function callbacks(): ProtocolCallbacks & { messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    onPeers: () => undefined,
    onMessage: (...args: unknown[]) => messages.push(String(args[1])),
    onMessageStatus: () => undefined,
    onLog: () => undefined,
    onError: (error) => {
      throw error
    }
  }
}

async function waitFor<T>(probe: () => T | null, timeout = 5000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value !== null) return value
    if (Date.now() - started > timeout) throw new Error('等待协议事件超时')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

describe('engine discovery', () => {
  it('sees a peer through a seed address', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const a = new ProtocolEngine(config('alice', portA, [`127.0.0.1:${portB}`]), callbacks())
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), callbacks())
    engines.push(a, b)
    await a.start()
    await b.start()
    const peer = await waitFor(
      () => a.getPeers().find((item: ProtocolPeer) => item.user === 'bob') ?? null
    )
    expect(peer).toMatchObject({ name: 'bob', online: true })
    await waitFor(() => (b.getPeers().some((item) => item.user === 'alice') ? true : null))
  })

  it('sends messages between discovered peers', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const aCallbacks = callbacks()
    const bCallbacks = callbacks()
    const a = new ProtocolEngine(config('alice', portA, [`127.0.0.1:${portB}`]), aCallbacks)
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), bCallbacks)
    engines.push(a, b)
    await a.start()
    await b.start()
    const peer = await waitFor(() => a.getPeers().find((item) => item.user === 'bob') ?? null)
    a.sendText(peer.key, 'hello')
    await waitFor(() => (bCallbacks.messages.includes('hello') ? true : null))
  }, 10000)
})
