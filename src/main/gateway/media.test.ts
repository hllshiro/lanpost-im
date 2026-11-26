import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Readable, Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../store/db'
import { GatewayStore } from './store'
import { AttachmentStore } from './attachments'
import { handleMediaRequest } from './media'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body')
])

const TOKEN = 'test-token-0123456789'
const dirs: string[] = []
const dbs: DatabaseSync[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-gateway-media-'))
  dirs.push(dir)
  return dir
}

function setup(maxImageBytes = 10 * 1024 * 1024): {
  attachments: AttachmentStore
  store: GatewayStore
  maxImageBytes: number
} {
  const db = openDatabase(':memory:')
  dbs.push(db)
  const store = new GatewayStore(db)
  return { attachments: new AttachmentStore(store, tempDir()), store, maxImageBytes }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

class FakeResponse extends Writable {
  statusCode = 0
  headers: Record<string, string> = {}
  private chunks: Buffer[] = []

  constructor() {
    super()
  }

  get headersSent(): boolean {
    return this.statusCode !== 0
  }

  writeHead(code: number, headers: Record<string, string> = {}): this {
    this.statusCode = code
    this.headers = { ...headers }
    return this
  }

  setHeader(name: string, value: string): void {
    this.headers[name.toLowerCase()] = value
  }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  body(): Buffer {
    return Buffer.concat(this.chunks)
  }

  json(): Record<string, unknown> {
    return JSON.parse(this.body().toString('utf8')) as Record<string, unknown>
  }
}

function request(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: Buffer
): IncomingMessage {
  const stream = Readable.from(body ? [body] : [])
  Object.assign(stream, { method, url, headers })
  return stream as unknown as IncomingMessage
}

async function call(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: Buffer | undefined,
  ctx: { attachments: AttachmentStore; maxImageBytes: number }
): Promise<FakeResponse> {
  const res = new FakeResponse()
  await handleMediaRequest(request(method, url, headers, body), res as unknown as ServerResponse, {
    attachments: ctx.attachments,
    maxImageBytes: ctx.maxImageBytes,
    expectedToken: TOKEN
  })
  return res
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('handleMediaRequest 认证', () => {
  it('缺少 Bearer 返回 401', async () => {
    const ctx = setup()
    const res = await call('GET', '/media/att_12345678', {}, undefined, ctx)
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ code: -32001, message: 'UNAUTHORIZED' })
  })

  it('错误 Bearer 返回 401', async () => {
    const ctx = setup()
    const res = await call('POST', '/media', { authorization: 'Bearer wrong' }, PNG, ctx)
    expect(res.statusCode).toBe(401)
  })

  it('非 /media 路径直接 404', async () => {
    const ctx = setup()
    const res = await call('GET', '/other', {}, undefined, ctx)
    expect(res.statusCode).toBe(404)
  })
})

describe('handleMediaRequest 上传', () => {
  it('上传后返回 attachment_id，并可下载原字节与校验头', async () => {
    const ctx = setup()
    const transfer = ctx.attachments.prepare({
      mimeType: 'image/png',
      name: 'a.png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    const upload = await call(
      'POST',
      '/media',
      {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'image/png',
        'x-transfer-id': transfer.transferId,
        'x-sha256': sha256(PNG),
        'x-name': encodeURIComponent('a.png')
      },
      PNG,
      ctx
    )
    expect(upload.statusCode).toBe(200)
    const attachmentId = String(upload.json().attachment_id)

    const download = await call(
      'GET',
      `/media/${attachmentId}`,
      { authorization: `Bearer ${TOKEN}` },
      undefined,
      ctx
    )
    expect(download.statusCode).toBe(200)
    expect(download.headers['content-type']).toBe('image/png')
    expect(download.headers['x-sha256']).toBe(sha256(PNG))
    expect(download.body()).toEqual(PNG)
  })

  it('7 MiB 通过，11 MiB 被 413 拒绝', async () => {
    const ctx = setup(8 * 1024 * 1024)
    const big = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(7 * 1024 * 1024 - 8)])
    const bigSha = sha256(big)
    const transfer = ctx.attachments.prepare({
      mimeType: 'image/png',
      name: 'big.png',
      size: big.length,
      sha256: bigSha
    })
    const upload = await call(
      'POST',
      '/media',
      {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'image/png',
        'x-transfer-id': transfer.transferId,
        'x-sha256': bigSha
      },
      big,
      ctx
    )
    expect(upload.statusCode).toBe(200)

    const tooBig = await call(
      'POST',
      '/media',
      {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'image/png',
        'x-transfer-id': 'tr_ignored',
        'x-sha256': 'a'.repeat(64)
      },
      Buffer.alloc(11 * 1024 * 1024),
      ctx
    )
    expect(tooBig.statusCode).toBe(413)
    expect(tooBig.json().code).toBe(-32013)
  })

  it('未知 transfer_id 返回 404', async () => {
    const ctx = setup()
    const res = await call(
      'POST',
      '/media',
      {
        authorization: `Bearer ${TOKEN}`,
        'content-type': 'image/png',
        'x-transfer-id': 'tr_missing',
        'x-sha256': sha256(PNG)
      },
      PNG,
      ctx
    )
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe(-32016)
  })
})

describe('handleMediaRequest 下载', () => {
  it('不存在与非法 id 都返回 404', async () => {
    const ctx = setup()
    const missing = await call(
      'GET',
      '/media/att_notfound01',
      { authorization: `Bearer ${TOKEN}` },
      undefined,
      ctx
    )
    expect(missing.statusCode).toBe(404)

    const traversal = await call(
      'GET',
      '/media/..%2F..%2Fetc%2Fpasswd',
      { authorization: `Bearer ${TOKEN}` },
      undefined,
      ctx
    )
    expect(traversal.statusCode).toBe(404)
  })

  it('入站附件可下载', async () => {
    const ctx = setup()
    const source = join(tempDir(), 'in.png')
    writeFileSync(source, PNG)
    const { attachmentId } = ctx.attachments.importInbound({
      path: source,
      name: 'in.png',
      mimeType: 'image/png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    const res = await call(
      'GET',
      `/media/${attachmentId}`,
      { authorization: `Bearer ${TOKEN}` },
      undefined,
      ctx
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.body()).toEqual(PNG)
  })
})
