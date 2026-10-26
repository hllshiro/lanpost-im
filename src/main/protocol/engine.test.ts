import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeEntry } from './entry'
import { encodePacket } from './packet'
import {
  ProtocolEngine,
  type MessageMeta,
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

function callbacks(): ProtocolCallbacks & {
  messages: string[]
  metas: MessageMeta[]
  statuses: Array<[string, number, string]>
} {
  const messages: string[] = []
  const metas: MessageMeta[] = []
  const statuses: Array<[string, number, string]> = []
  return {
    messages,
    metas,
    statuses,
    onPeers: () => undefined,
    onMessage: (...args: unknown[]) => {
      messages.push(String(args[1]))
      metas.push(args[3] as MessageMeta)
    },
    onMessageStatus: (peerKey, seq, status) => statuses.push([peerKey, seq, status]),
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

  it('keeps away status across periodic announces', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const a = new ProtocolEngine(
      { ...config('alice', portA, [`127.0.0.1:${portB}`]), broadcastInterval: 0.3 },
      callbacks()
    )
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), callbacks())
    engines.push(a, b)
    await a.start()
    await b.start()
    await waitFor(() => (b.getPeers().some((item) => item.user === 'alice') ? true : null))
    a.updateStatus(2)
    await waitFor(() =>
      b.getPeers().find((item) => item.user === 'alice')?.status === 2 ? true : null
    )
    await new Promise((resolve) => setTimeout(resolve, 900))
    expect(b.getPeers().find((item) => item.user === 'alice')?.status).toBe(2)
  }, 10000)

  it('marks a silent peer offline after the timeout', async () => {
    const port = await freeUdpPort()
    const engine = new ProtocolEngine(config('alice', port, []), callbacks(), {
      offlineTimeoutMs: 300,
      sweepIntervalMs: 50,
      announceBurstMs: []
    })
    const raw = createSocket('udp4')
    engines.push(engine)
    await new Promise<void>((resolve, reject) => {
      raw.once('error', reject)
      raw.bind(0, '127.0.0.1', () => resolve())
    })
    await engine.start()
    const payload = encodeEntry({
      name: '沉默用户',
      group: '',
      account: 'silent',
      host: 'silent-host',
      version: 'v'
    })
    raw.send(
      encodePacket({ seq: 1, user: 'silent', host: 'silent-host', cmd: 0x01, payload }),
      port,
      '127.0.0.1'
    )
    await waitFor(() => engine.getPeers().find((item) => item.user === 'silent') ?? null)
    await waitFor(
      () =>
        engine.getPeers().find((item) => item.user === 'silent')?.online === false ? true : null,
      2000
    )
    raw.close()
  }, 10000)

  it('marks sealed messages and reads them back', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const aCallbacks = callbacks()
    const bCallbacks = callbacks()
    const a = new ProtocolEngine(config('alice', portA, [`127.0.0.1:${portB}`]), aCallbacks)
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), bCallbacks)
    engines.push(a, b)
    await a.start()
    await b.start()
    const peerA = await waitFor(() => a.getPeers().find((item) => item.user === 'bob') ?? null)
    const seq = a.sendText(peerA.key, 'secret', { sealed: true })
    await waitFor(() => (bCallbacks.messages.includes('secret') ? true : null))
    expect(bCallbacks.metas[0]).toMatchObject({ sealed: true, opened: false })
    const peerB = b.getPeers().find((item) => item.user === 'alice')!
    b.sendReadMessage(peerB.key, seq, false)
    await waitFor(() =>
      aCallbacks.statuses.some(([, value, status]) => value === seq && status === 'read')
        ? true
        : null
    )
  }, 10000)

  it('asks a peer for its version information', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const a = new ProtocolEngine(config('alice', portA, [`127.0.0.1:${portB}`]), callbacks())
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), callbacks())
    engines.push(a, b)
    await a.start()
    await b.start()
    const peer = await waitFor(() => a.getPeers().find((item) => item.user === 'bob') ?? null)
    a.requestInfo(peer.key)
    await waitFor(() => {
      const updated = a.getPeers().find((item) => item.user === 'bob')
      return updated && updated.versionInfo !== '' ? true : null
    })
    expect(a.getPeers().find((item) => item.user === 'bob')?.versionInfo).toContain('lanpost-im')
  }, 10000)
})
