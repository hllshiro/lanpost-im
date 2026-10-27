import { createSocket } from 'node:dgram'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeEntry } from '../../../src/main/protocol/entry'
import { encodePacket } from '../../../src/main/protocol/packet'
import {
  ProtocolEngine,
  type MessageMeta,
  type ProtocolCallbacks,
  type ProtocolConfig,
  type ProtocolPeer
} from '../../../src/main/protocol/engine'

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

  it('discovers an existing peer when starting in away mode', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), callbacks(), {
      announceBurstMs: []
    })
    engines.push(b)
    await b.start()
    await new Promise((resolve) => setTimeout(resolve, 150))

    const a = new ProtocolEngine(
      { ...config('alice', portA, [`127.0.0.1:${portB}`]), status: 2 },
      callbacks()
    )
    engines.push(a)
    await a.start()

    const peer = await waitFor(() => a.getPeers().find((item) => item.user === 'bob') ?? null, 1500)
    expect(peer.online).toBe(true)
    const aliceForBob = await waitFor(
      () => b.getPeers().find((item) => item.user === 'alice') ?? null,
      1500
    )
    expect(aliceForBob).toMatchObject({ online: true, status: 2 })
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

  it('broadcasts to all peers and multicasts to selected peers', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const portC = await freeUdpPort()
    const aCallbacks = callbacks()
    const bCallbacks = callbacks()
    const cCallbacks = callbacks()
    const a = new ProtocolEngine(
      config('alice', portA, [`127.0.0.1:${portB}`, `127.0.0.1:${portC}`]),
      aCallbacks
    )
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), bCallbacks)
    const c = new ProtocolEngine(config('carol', portC, [`127.0.0.1:${portA}`]), cCallbacks)
    engines.push(a, b, c)
    await a.start()
    await b.start()
    await c.start()
    await waitFor(() => (a.getPeers().filter((item) => item.online).length >= 2 ? true : null))
    const targets = a.sendBroadcast('hello all')
    expect(targets).toHaveLength(2)
    await waitFor(() => (bCallbacks.messages.includes('hello all') ? true : null))
    await waitFor(() => (cCallbacks.messages.includes('hello all') ? true : null))
    expect(bCallbacks.metas.at(-1)?.flags).toEqual({ broadcast: true })

    const bob = a.getPeers().find((item) => item.user === 'bob')!
    const multicast = a.sendMulticast([bob.key], 'only bob')
    expect(multicast).toHaveLength(1)
    await waitFor(() => (bCallbacks.messages.includes('only bob') ? true : null))
    expect(cCallbacks.messages).not.toContain('only bob')
    expect(bCallbacks.metas.at(-1)?.flags).toEqual({ multicast: true })
  }, 10000)

  it('sees another instance with the same account and host on a different port', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const base = { ...config('same', portA, []), account: 'same', host: 'same-host' }
    const a = new ProtocolEngine(
      { ...base, port: portA, seeds: [`127.0.0.1:${portB}`] },
      callbacks()
    )
    const b = new ProtocolEngine(
      { ...base, port: portB, seeds: [`127.0.0.1:${portA}`] },
      callbacks()
    )
    engines.push(a, b)
    await a.start()
    await b.start()
    await waitFor(() => (a.getPeers().some((item) => item.user === 'same') ? true : null))
    await waitFor(() => (b.getPeers().some((item) => item.user === 'same') ? true : null))
  }, 10000)

  it('surfaces DELMSG and RELEASEFILES callbacks', async () => {
    const port = await freeUdpPort()
    const deleted: Array<[string, number]> = []
    const released: Array<[string, number, number[]]> = []
    const engine = new ProtocolEngine(config('alice', port, []), {
      ...callbacks(),
      onMessageDeleted: (peerKey, seq) => deleted.push([peerKey, seq]),
      onFileRelease: (peerKey, packetId, fileIds) => released.push([peerKey, packetId, fileIds])
    })
    engines.push(engine)
    await engine.start()
    await new Promise<void>((resolve, reject) => {
      const raw = createSocket('udp4')
      raw.once('error', reject)
      raw.bind(0, '127.0.0.1', () => resolve())
      raw.send(
        encodePacket({
          seq: 1,
          user: 'peer',
          host: 'peer-host',
          cmd: 0x01,
          payload: encodeEntry({
            name: 'p',
            group: '',
            account: 'peer',
            host: 'peer-host',
            version: 'v'
          })
        }),
        port,
        '127.0.0.1'
      )
      setTimeout(() => {
        raw.send(
          encodePacket({
            seq: 2,
            user: 'peer',
            host: 'peer-host',
            cmd: 0x31,
            payload: Buffer.from('119')
          }),
          port,
          '127.0.0.1'
        )
        raw.send(
          encodePacket({
            seq: 3,
            user: 'peer',
            host: 'peer-host',
            cmd: 0x61,
            payload: Buffer.from('2:1f')
          }),
          port,
          '127.0.0.1'
        )
        setTimeout(() => raw.close(), 100)
      }, 100)
    })
    await waitFor(() => (deleted.length > 0 && released.length > 0 ? true : null))
    expect(deleted[0][1]).toBe(119)
    expect(released[0][1]).toBe(2)
    expect(released[0][2]).toEqual([0x1f])
  }, 10000)
})

describe('file release protocol', () => {
  it('delivers RELEASEFILES from receiver to sender', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const released: Array<[string, number, number[]]> = []
    const offers: Array<{ peer: ProtocolPeer; packetId: number }> = []
    const a = new ProtocolEngine(config('alice', portA, [`127.0.0.1:${portB}`]), {
      ...callbacks(),
      onFileRelease: (peerKey, packetId, fileIds) => released.push([peerKey, packetId, fileIds])
    })
    const b = new ProtocolEngine(config('bob', portB, [`127.0.0.1:${portA}`]), {
      ...callbacks(),
      onFileOffer: (peer, packetId) => offers.push({ peer, packetId })
    })
    engines.push(a, b)
    await a.start()
    await b.start()
    const bob = await waitFor(() => a.getPeers().find((item) => item.user === 'bob') ?? null)
    const packetId = a.sendFileOffer(bob.key, '', [
      { id: 0x21, name: 'x.txt', size: 1, mtime: 1, attr: 1 }
    ])
    const offer = await waitFor(() => offers.find((item) => item.packetId === packetId) ?? null)
    b.releaseFiles(offer.peer.key, packetId, [0x21])
    await waitFor(() => (released.length > 0 ? true : null))
    expect(released[0]).toEqual([bob.key, packetId, [0x21]])
  }, 10000)
})

describe('NWT private file cancel', () => {
  it('turns version 5 command 230 into a file release', async () => {
    const port = await freeUdpPort()
    const releases: Array<[string, number, number[]]> = []
    const rawCancels: string[] = []
    const engine = new ProtocolEngine(config('alice', port, []), {
      ...callbacks(),
      onFileRelease: (peerKey, packetId, fileIds) => releases.push([peerKey, packetId, fileIds]),
      onNwtFileCancel: (_peerKey, payload) => rawCancels.push(payload.toString('ascii'))
    })
    engines.push(engine)
    await engine.start()
    const raw = createSocket('udp4')
    await new Promise<void>((resolve, reject) => {
      raw.once('error', reject)
      raw.bind(0, '127.0.0.1', () => resolve())
    })
    raw.send(
      Buffer.concat([
        Buffer.from('5@shiyeline:1:peer:peer-host:230:6adffd84:', 'ascii'),
        Buffer.from([0]),
        Buffer.from('7', 'ascii'),
        Buffer.from([0])
      ]),
      port,
      '127.0.0.1'
    )
    await waitFor(() => (releases.length > 0 ? true : null))
    expect(releases[0][1]).toBe(0x6adffd84)
    raw.send(
      Buffer.concat([
        Buffer.from('1@shiyeline:2:peer:peer-host:230:17930643247:', 'ascii'),
        Buffer.from([0])
      ]),
      port,
      '127.0.0.1'
    )
    await waitFor(() => (rawCancels.length > 0 ? true : null))
    expect(rawCancels[0]).toContain('17930643247')
    raw.close()
  }, 10000)
})
