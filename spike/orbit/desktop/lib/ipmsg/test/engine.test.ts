import { createSocket } from 'node:dgram'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IpmsgTransport,
  type IpmsgFile,
  type IpmsgPeer,
  type IpmsgText
} from '../index'

const transports: IpmsgTransport[] = []
const dirs: string[] = []

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.stop()))
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
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

function receiveDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-ipmsg-'))
  dirs.push(dir)
  return dir
}

function makeTransport(
  name: string,
  port: number,
  seeds: string[],
  events: {
    peers: IpmsgPeer[][]
    texts: IpmsgText[]
    files: IpmsgFile[]
    statuses: Array<[string, number, string]>
  },
  status = 0
): IpmsgTransport {
  const transport = new IpmsgTransport(
    {
      name,
      account: name,
      host: `${name}-host`,
      status,
      port,
      bindAddr: '127.0.0.1',
      seeds,
      broadcastInterval: 3600,
      receiveDir: receiveDir(),
      autoAccept: true
    },
    {
      onPeers: (peers) => events.peers.push(peers),
      onText: (text) => events.texts.push(text),
      onTextStatus: (peerKey, seq, value) =>
        events.statuses.push([peerKey, seq, value]),
      onFile: (file) => events.files.push(file),
      onLog: () => undefined,
      onError: (error) => {
        throw error
      }
    }
  )
  transports.push(transport)
  return transport
}

function events(): {
  peers: IpmsgPeer[][]
  texts: IpmsgText[]
  files: IpmsgFile[]
  statuses: Array<[string, number, string]>
} {
  return { peers: [], texts: [], files: [], statuses: [] }
}

async function waitFor<T>(probe: () => T | null, timeout = 8000): Promise<T> {
  const started = Date.now()
  for (;;) {
    const value = probe()
    if (value !== null) return value
    if (Date.now() - started > timeout) throw new Error('等待协议事件超时')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function findPeer(transport: IpmsgTransport, account: string): Promise<IpmsgPeer> {
  return waitFor(() => transport.getPeers().find((peer) => peer.account === account) ?? null)
}

describe('IpmsgTransport', () => {
  it('discovers a peer through a seed address', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const a = makeTransport('alice', portA, [`127.0.0.1:${portB}`], events())
    const b = makeTransport('bob', portB, [`127.0.0.1:${portA}`], events())
    await a.start()
    await b.start()

    expect(await findPeer(a, 'bob')).toMatchObject({ online: true })
    expect(await findPeer(b, 'alice')).toMatchObject({ online: true })
  }, 15000)

  it('discovers an existing peer when starting away', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const b = makeTransport('bob', portB, [], events())
    await b.start()
    await new Promise((resolve) => setTimeout(resolve, 150))
    const a = makeTransport('alice', portA, [`127.0.0.1:${portB}`], events(), 2)
    await a.start()

    expect(await findPeer(a, 'bob')).toMatchObject({ online: true })
  }, 15000)

  it('sends text and receives delivery ACK', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const aEvents = events()
    const bEvents = events()
    const a = makeTransport('alice', portA, [`127.0.0.1:${portB}`], aEvents)
    const b = makeTransport('bob', portB, [`127.0.0.1:${portA}`], bEvents)
    await a.start()
    await b.start()
    const bob = await findPeer(a, 'bob')

    const seq = a.sendText(bob.key, '你好 Orbit')
    const received = await waitFor(() => bEvents.texts.find((item) => item.text === '你好 Orbit') ?? null)

    expect(received.seq).toBe(seq)
    expect(received.text).toBe('你好 Orbit')
    await waitFor(() => aEvents.statuses.find((item) => item[1] === seq && item[2] === 'delivered') ?? null)
  }, 20000)

  it('auto-accepts and transfers a file', async () => {
    const portA = await freeUdpPort()
    const portB = await freeUdpPort()
    const aEvents = events()
    const bEvents = events()
    const a = makeTransport('alice', portA, [`127.0.0.1:${portB}`], aEvents)
    const b = makeTransport('bob', portB, [`127.0.0.1:${portA}`], bEvents)
    await a.start()
    await b.start()
    const bob = await findPeer(a, 'bob')

    const sourceDir = receiveDir()
    const source = join(sourceDir, '中文文件.txt')
    writeFileSync(source, 'hello from orbit')
    await a.sendFile(bob.key, source)

    const received = await waitFor(
      () => bEvents.files.find((file) => file.direction === 'in' && file.state === 'done') ?? null
    )
    expect(received.name).toBe('中文文件.txt')
    expect(received.path).not.toBe('')
    expect(readFileSync(received.path, 'utf8')).toBe('hello from orbit')
  }, 25000)
})
