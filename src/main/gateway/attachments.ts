import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { GatewayStore } from './store'
import { gwError } from './errors'

const ALLOWED_MIMES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
/** prepareUpload 登记的传输有效期。 */
export const TRANSFER_TTL_MS = 30 * 60_000

export interface SniffedImage {
  mime: string
  ext: 'png' | 'jpg' | 'webp' | 'gif'
}

/** 按魔数判断图片类型；无法识别返回 null。 */
export function sniffImage(buf: Buffer): SniffedImage | null {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', ext: 'png' }
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' }
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('ascii') === 'GIF8') {
    return { mime: 'image/gif', ext: 'gif' }
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' }
  }
  return null
}

export function isAllowedImageMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime)
}

export interface AttachmentMeta {
  mimeType: string
  name: string
  size: number
  sha256: string
}

export interface DownloadInfo {
  path: string
  size: number
  sha256: string
  mimeType: string
  name: string
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function newAttachmentId(): string {
  return `att_${randomBytes(8).toString('hex')}`
}

function writeDurable(path: string, data: Buffer): void {
  writeFileSync(path, data, { mode: 0o600 })
  const fd = openSync(path, 'r+')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** 附件落盘、校验与清理；路径只由 attachment_id 生成，不信任文件名。 */
export class AttachmentStore {
  private readonly now: () => number

  constructor(
    private readonly store: GatewayStore,
    private readonly dir: string,
    options: { now?: () => number } = {}
  ) {
    this.now = options.now ?? Date.now
  }

  prepare(meta: AttachmentMeta): { transferId: string; expiresAt: number } {
    const id = newAttachmentId()
    const transferId = `tr_${randomBytes(12).toString('hex')}`
    const now = this.now()
    const expiresAt = now + TRANSFER_TTL_MS
    this.store.insertAttachment({
      id,
      kind: 'upload',
      mime_type: meta.mimeType,
      name: meta.name,
      size: meta.size,
      sha256: meta.sha256,
      path: join(this.dir, 'att', `${id}.bin`),
      transfer_id: transferId,
      state: 'pending',
      message_id: '',
      created_at: now,
      expires_at: expiresAt
    })
    return { transferId, expiresAt }
  }

  acceptUpload(
    transferId: string,
    buf: Buffer,
    declared: { mimeType: string; sha256: string }
  ): { attachmentId: string } {
    const row = this.store.attachmentByTransfer(transferId)
    if (!row || row.state !== 'pending' || (row.expires_at > 0 && row.expires_at <= this.now())) {
      throw gwError('ATTACHMENT_NOT_FOUND')
    }
    if (declared.sha256 !== row.sha256 || sha256Hex(buf) !== row.sha256) {
      throw gwError('IMAGE_HASH_MISMATCH')
    }
    if (buf.length !== row.size) {
      throw gwError('INVALID_ARGUMENT', '上传字节数与登记不一致')
    }
    const sniffed = sniffImage(buf)
    if (!sniffed || sniffed.mime !== row.mime_type || !isAllowedImageMime(declared.mimeType)) {
      throw gwError('IMAGE_FORMAT_INVALID')
    }
    mkdirSync(join(this.dir, 'att'), { recursive: true })
    writeDurable(row.path, buf)
    this.store.markAttachmentReady(row.id, 0)
    return { attachmentId: row.id }
  }

  importInbound(input: {
    path: string
    name: string
    mimeType: string
    size: number
    sha256: string
  }): { attachmentId: string } {
    const id = newAttachmentId()
    const path = join(this.dir, 'att', `${id}.bin`)
    mkdirSync(join(this.dir, 'att'), { recursive: true })
    copyFileSync(input.path, path)
    const fd = openSync(path, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    this.store.insertAttachment({
      id,
      kind: 'inbound',
      mime_type: input.mimeType,
      name: input.name,
      size: input.size,
      sha256: input.sha256,
      path,
      transfer_id: '',
      state: 'ready',
      message_id: '',
      created_at: this.now(),
      expires_at: 0
    })
    return { attachmentId: id }
  }

  openDownload(attachmentId: string): DownloadInfo | null {
    const row = this.store.attachment(attachmentId)
    if (!row || row.state === 'pending') return null
    return {
      path: row.path,
      size: row.size,
      sha256: row.sha256,
      mimeType: row.mime_type,
      name: row.name
    }
  }

  consume(attachmentId: string, messageId: string): void {
    this.store.markAttachmentConsumed(attachmentId, messageId)
  }

  cleanup(now: number): { removed: number } {
    const rows = this.store.attachmentsForCleanup(now)
    let removed = 0
    for (const row of rows) {
      try {
        if (existsSync(row.path)) unlinkSync(row.path)
      } catch {
        // 文件可能已被手工删除；清理表记录即可。
      }
      this.store.deleteAttachment(row.id)
      removed += 1
    }
    return { removed }
  }
}
