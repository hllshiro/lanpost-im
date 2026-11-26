import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Client } from 'rpc-websockets'
import { openDatabase } from '../store/db'
import { GatewayServer } from './server'
import type { GatewayBridge, GatewayBridgeEvent } from './bridge'
import { RPC_PATH } from './protocol'

const TOKEN = 'test-token-0123456789abcdefghijklmnopqrstu'
const PEER = 'aaaa1111aaaa1111aaaa1111aaaa1111'
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body')
])

interface FakeBridge extends GatewayBridge {
  emit: (event: GatewayBridgeEvent) => void
}

function fakeBridge(): FakeBridge {
  const listeners = new Set<(event: GatewayBridgeEvent) => void>()
  return {
    listPeers: () => [
      {
        protocolId: PEER,
        username: 'alice',
        displayName: 'Alice',
        hostname: 'DESKTOP-A',
        online: true,
        lastSeenAt: Date.UTC(2026, 10, 26, 2, 0, 0)
      }
    ],
    getPeer: (protocolId) =>
      protocolId === PEER
        ? {
            protocolId,
            username: 'alice',
            displayName: 'Alice',
            hostname: 'DESKTOP-A',
            online: true,
            lastSeenAt: Date.UTC(2026, 10, 26, 2, 0, 0)
          }
        : null,
    listGroups: () => [],
    getGroup: () => null,
    sendPrivateText: async () => ({ imMessageId: 7, nwtMsgId: 3, status: 'sent' }),
    sendGroupText: async () => ({ imMessageId: 8, nwtMsgId: 4, status: 'sent' }),
    sendPrivateImage: async () => ({ imMessageId: 9, nwtMsgId: 5, status: 'sent' }),
    sendGroupImage: async () => ({ imMessageId: 10, nwtMsgId: 6, status: 'sent' }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit: (event) => {
      for (const listener of listeners) listener(event)
    }
  }
}

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function connect(port: number): Promise<Client> {
  const client = new Client(`ws://127.0.0.1:${port}${RPC_PATH}`)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('连接超时')), 5000)
    client.once('open', () => {
      clearTimeout(timer)
      resolve(client)
    })
    client.once('error', (error: Error) => {
      clearTimeout(timer)
      reject(error)
    })
    client.connect()
  })
}

function callMedia(
  port: number,
  method: 'POST' | 'GET',
  path: string,
  headers: Record<string, string | number>,
  body?: Buffer
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
      }
    )
    req.on('error', reject)
    if (body) req.end(body)
    else req.end()
  })
}

const dbs: DatabaseSync[] = []
const dirs: string[] = []
const servers: GatewayServer[] = []
const clients: Client[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) {
    try {
      client.close()
    } catch {
      // 已关闭
    }
  }
  for (const server of servers.splice(0)) {
    await server.stop()
  }
  for (const db of dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // 已关闭
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

function makeServer(): { server: GatewayServer; bridge: FakeBridge; port: number } {
  const db = openDatabase(':memory:')
  dbs.push(db)
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-gateway-server-'))
  dirs.push(dir)
  const bridge = fakeBridge()
  const server = new GatewayServer({
    db,
    bridge,
    dataDir: dir,
    host: '127.0.0.1',
    port: 0,
    token: TOKEN
  })
  servers.push(server)
  return { server, bridge, port: 0 }
}

async function started(): Promise<{ server: GatewayServer; bridge: FakeBridge; port: number }> {
  const ctx = makeServer()
  const result = await ctx.server.start()
  return { ...ctx, port: result.port }
}

describe('GatewayServer', () => {
  it('启动、停止、再启动', async () => {
    const { server } = makeServer()
    const first = await server.start()
    expect(first.port).toBeGreaterThan(0)
    expect(first.url).toBe(`ws://127.0.0.1:${first.port}${RPC_PATH}`)
    expect(server.status().running).toBe(true)

    await server.stop()
    expect(server.status().running).toBe(false)

    const second = await server.start()
    expect(second.port).toBeGreaterThan(0)
  }, 20000)

  it('未登录调用业务方法得到 -32605，login 后可用', async () => {
    const { port } = await started()
    const client = await connect(port)
    clients.push(client)

    await expect(client.call('users.list', { page: 1, page_size: 10 })).rejects.toMatchObject({
      code: -32605
    })
    await expect(client.login({ token: 'wrong-token' })).rejects.toThrow('authentication failed')
    await expect(client.login({ token: TOKEN })).resolves.toBe(true)
    const users = (await client.call('users.list', { page: 1, page_size: 10 })) as {
      total: number
    }
    expect(users.total).toBe(1)
  }, 20000)

  it('message.sendUser 返回 queued，订阅后可收到 message.received', async () => {
    const { port, bridge } = await started()
    const client = await connect(port)
    clients.push(client)
    await client.login({ token: TOKEN })

    const sent = (await client.call('message.sendUser', {
      request_id: 'req-1',
      protocol_id: PEER,
      content: { type: 'text', text: '你好' }
    })) as { delivery_status: string; message_id: string }
    expect(sent.delivery_status).toBe('queued')
    expect(sent.message_id).toBe('im:7')

    const received = new Promise<Record<string, unknown>>((resolve) => {
      client.on('message.received', (params: Record<string, unknown>) => resolve(params))
    })
    await client.subscribe('message.received')
    bridge.emit({
      kind: 'text-in',
      imMessageId: 21,
      conversationId: `direct:${PEER}`,
      conversationType: 'private',
      sender: {
        protocolId: PEER,
        username: 'alice',
        displayName: 'Alice',
        hostname: 'DESKTOP-A'
      },
      text: '在的',
      timestamp: Date.UTC(2026, 10, 26, 3, 0, 0)
    })
    const event = await received
    expect(event).toMatchObject({ method: 'message.received', sequence: 1 })
    expect(event.data).toMatchObject({ message_id: 'im:21' })
  }, 20000)

  it('未订阅的连接收不到事件；events.resume 能补发', async () => {
    const { port, bridge } = await started()
    const subscribed = await connect(port)
    const silent = await connect(port)
    clients.push(subscribed, silent)
    await subscribed.login({ token: TOKEN })
    await silent.login({ token: TOKEN })
    await subscribed.subscribe('message.received')

    const received = new Promise<Record<string, unknown>>((resolve) => {
      subscribed.on('message.received', (params: Record<string, unknown>) => resolve(params))
    })
    let silentGot = false
    silent.on('message.received', () => {
      silentGot = true
    })
    bridge.emit({
      kind: 'text-in',
      imMessageId: 22,
      conversationId: `direct:${PEER}`,
      conversationType: 'private',
      sender: {
        protocolId: PEER,
        username: 'alice',
        displayName: 'Alice',
        hostname: 'DESKTOP-A'
      },
      text: '补发测试',
      timestamp: 1
    })
    await received
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(silentGot).toBe(false)

    const resumed = (await silent.call('events.resume', { last_sequence: 0 })) as {
      latest_sequence: number
      events: Array<Record<string, unknown>>
    }
    expect(resumed.latest_sequence).toBe(1)
    expect(resumed.events).toHaveLength(1)
    expect(resumed.events[0]).toMatchObject({ method: 'message.received', sequence: 1 })

    const acked = (await silent.call('events.ack', {
      event_id: resumed.events[0].event_id,
      sequence: 1
    })) as { acked: boolean; latest_sequence: number }
    expect(acked.acked).toBe(true)
    const empty = (await silent.call('events.resume', { last_sequence: 0 })) as {
      events: unknown[]
    }
    expect(empty.events).toHaveLength(0)
  }, 20000)

  it('/media 需要 Bearer，上传后可原样取回', async () => {
    const { port } = await started()
    await callMedia(port, 'POST', '/media', { 'content-type': 'image/png' })
      .catch(() => ({ status: 0, body: Buffer.alloc(0) }))
      .then((res) => expect(res.status).toBe(401))
    const unauth = await callMedia(port, 'POST', '/media', { 'content-type': 'image/png' })
    expect(unauth.status).toBe(401)

    const client = await connect(port)
    clients.push(client)
    await client.login({ token: TOKEN })
    const prepared = (await client.call('media.prepareUpload', {
      mime_type: 'image/png',
      name: 'a.png',
      size: PNG.length,
      sha256: sha256(PNG)
    })) as { transfer_id: string; max_bytes: number }

    const upload = await callMedia(
      port,
      'POST',
      '/media',
      {
        authorization: `Bearer ${TOKEN}`,
        'x-transfer-id': prepared.transfer_id,
        'x-sha256': sha256(PNG),
        'content-type': 'image/png',
        'content-length': PNG.length
      },
      PNG
    )
    expect(upload.status).toBe(200)
    const { attachment_id: attachmentId } = JSON.parse(upload.body.toString('utf8')) as {
      attachment_id: string
    }
    expect(attachmentId).toMatch(/^att_[0-9a-f]{16}$/)

    const download = await callMedia(port, 'GET', `/media/${attachmentId}`, {
      authorization: `Bearer ${TOKEN}`
    })
    expect(download.status).toBe(200)
    expect(download.body).toEqual(PNG)
  }, 20000)

  it('setToken 断开旧连接，新令牌可登录', async () => {
    const { server, port } = await started()
    const client = await connect(port)
    clients.push(client)
    await client.login({ token: TOKEN })

    const closed = new Promise<number>((resolve) => {
      client.once('close', (code: number) => resolve(code))
    })
    const nextToken = 'next-token-0123456789abcdefghijklmnopqr'
    server.setToken(nextToken)
    expect(await closed).toBe(4401)

    const fresh = await connect(port)
    clients.push(fresh)
    await expect(fresh.login({ token: TOKEN })).rejects.toThrow('authentication failed')
    await expect(fresh.login({ token: nextToken })).resolves.toBe(true)
  }, 20000)
})
