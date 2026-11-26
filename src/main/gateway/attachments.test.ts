import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../store/db'
import { GatewayStore } from './store'
import { AttachmentStore, isAllowedImageMime, sniffImage } from './attachments'
import type { GwError } from './errors'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('png-body')
])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body')])
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from('gif-body')])
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([8, 0, 0, 0]),
  Buffer.from('WEBP'),
  Buffer.from('webp-body')
])

const dirs: string[] = []
const dbs: DatabaseSync[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-gateway-att-'))
  dirs.push(dir)
  return dir
}

function createStore(options: { now?: () => number } = {}): {
  attachments: AttachmentStore
  store: GatewayStore
} {
  const db = openDatabase(':memory:')
  dbs.push(db)
  const store = new GatewayStore(db)
  return { attachments: new AttachmentStore(store, tempDir(), options), store }
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function codeOf(error: unknown): number | undefined {
  return (error as GwError | undefined)?.rpcCode
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('sniffImage', () => {
  it('识别四种图片的魔数', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', ext: 'png' })
    expect(sniffImage(JPEG)).toEqual({ mime: 'image/jpeg', ext: 'jpg' })
    expect(sniffImage(GIF)).toEqual({ mime: 'image/gif', ext: 'gif' })
    expect(sniffImage(WEBP)).toEqual({ mime: 'image/webp', ext: 'webp' })
  })

  it('只认魔数，不看扩展名：伪装成 .svg 的 PNG 仍是 PNG', () => {
    const { attachments, store } = createStore()
    const transfer = attachments.prepare({
      mimeType: 'image/png',
      name: 'evil.svg',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    const result = attachments.acceptUpload(transfer.transferId, PNG, {
      mimeType: 'image/png',
      sha256: sha256(PNG)
    })
    expect(store.attachment(result.attachmentId)?.mime_type).toBe('image/png')
  })

  it('SVG 与未知字节返回 null', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffImage(Buffer.from('hello'))).toBeNull()
    expect(isAllowedImageMime('image/svg+xml')).toBe(false)
    expect(isAllowedImageMime('image/png')).toBe(true)
  })
})

describe('AttachmentStore', () => {
  it('prepare 生成 transfer_id 与 30 分钟过期时间', () => {
    const { attachments } = createStore()
    const transfer = attachments.prepare({
      mimeType: 'image/png',
      name: 'a.png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    expect(transfer.transferId).toMatch(/^tr_[A-Za-z0-9]+$/)
    expect(transfer.expiresAt).toBeGreaterThan(Date.now() + 25 * 60_000)
  })

  it('上传后状态为 ready，文件落在 att/ 下', () => {
    const { attachments, store } = createStore()
    const transfer = attachments.prepare({
      mimeType: 'image/png',
      name: 'a.png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    const result = attachments.acceptUpload(transfer.transferId, PNG, {
      mimeType: 'image/png',
      sha256: sha256(PNG)
    })
    const row = store.attachment(result.attachmentId)
    expect(row?.state).toBe('ready')
    expect(row?.path).toContain(`${result.attachmentId}.bin`)
    expect(readFileSync(row!.path)).toEqual(PNG)
    expect(attachments.openDownload(result.attachmentId)?.sha256).toBe(sha256(PNG))
  })

  it('transfer 不存在抛出 -32016', () => {
    const { attachments } = createStore()
    expect(
      codeOf(
        catchError(() =>
          attachments.acceptUpload('tr_missing', PNG, {
            mimeType: 'image/png',
            sha256: sha256(PNG)
          })
        )
      )
    ).toBe(-32016)
  })

  it('SHA-256 不符抛出 -32017', () => {
    const { attachments } = createStore()
    const transfer = attachments.prepare({
      mimeType: 'image/png',
      name: 'a.png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    expect(
      codeOf(
        catchError(() =>
          attachments.acceptUpload(transfer.transferId, PNG, {
            mimeType: 'image/png',
            sha256: 'f'.repeat(64)
          })
        )
      )
    ).toBe(-32017)
  })

  it('声明类型与魔数不符抛出 -32018', () => {
    const { attachments } = createStore()
    const transfer = attachments.prepare({
      mimeType: 'image/png',
      name: 'a.png',
      size: JPEG.length,
      sha256: sha256(JPEG)
    })
    expect(
      codeOf(
        catchError(() =>
          attachments.acceptUpload(transfer.transferId, JPEG, {
            mimeType: 'image/png',
            sha256: sha256(JPEG)
          })
        )
      )
    ).toBe(-32018)
  })

  it('过期 transfer 不能上传', () => {
    let clock = Date.now()
    const { attachments } = createStore({ now: () => clock })
    const transfer = attachments.prepare({
      mimeType: 'image/png',
      name: 'a.png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    clock += 31 * 60_000
    expect(
      codeOf(
        catchError(() =>
          attachments.acceptUpload(transfer.transferId, PNG, {
            mimeType: 'image/png',
            sha256: sha256(PNG)
          })
        )
      )
    ).toBe(-32016)
  })

  it('导入入站图片并可消费', () => {
    const { attachments, store } = createStore()
    const sourceDir = tempDir()
    const source = join(sourceDir, 'received.png')
    writeFileSync(source, PNG)
    const { attachmentId } = attachments.importInbound({
      path: source,
      name: 'b.png',
      mimeType: 'image/png',
      size: PNG.length,
      sha256: sha256(PNG)
    })
    expect(attachments.openDownload(attachmentId)?.name).toBe('b.png')
    attachments.consume(attachmentId, 'im:1')
    expect(store.attachment(attachmentId)?.message_id).toBe('im:1')
  })

  it('清理过期附件并删除文件', () => {
    const { attachments, store } = createStore()
    const file = join(tempDir(), 'expired.bin')
    writeFileSync(file, PNG)
    store.insertAttachment({
      id: 'att_expired0001',
      kind: 'upload',
      mime_type: 'image/png',
      name: 'x.png',
      size: PNG.length,
      sha256: sha256(PNG),
      path: file,
      transfer_id: '',
      state: 'ready',
      message_id: '',
      created_at: 1,
      expires_at: 1
    })
    expect(attachments.cleanup(Date.now()).removed).toBe(1)
    expect(store.attachment('att_expired0001')).toBeNull()
    expect(existsSync(file)).toBe(false)
  })
})

function catchError(fn: () => unknown): unknown {
  try {
    fn()
    return undefined
  } catch (error) {
    return error
  }
}
