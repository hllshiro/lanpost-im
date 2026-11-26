import { createReadStream } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { checkBearer } from './auth'
import { gwError, toRpcError } from './errors'
import type { AttachmentStore } from './attachments'

export interface MediaContext {
  attachments: AttachmentStore
  maxImageBytes: number
  expectedToken: string
  onLog?: (message: string) => void
}

const ATTACHMENT_ID = /^att_[A-Za-z0-9_-]{8,}$/

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(text))
  })
  res.end(text)
}

function httpStatus(code: number): number {
  switch (code) {
    case -32001:
      return 401
    case -32013:
      return 413
    case -32014:
    case -32018:
      return 415
    case -32016:
      return 404
    default:
      return 400
  }
}

async function upload(req: IncomingMessage, res: ServerResponse, ctx: MediaContext): Promise<void> {
  const transferId = headerValue(req.headers['x-transfer-id'])
  const sha256 = headerValue(req.headers['x-sha256'])
  const mimeType = headerValue(req.headers['content-type']).split(';')[0].trim()
  if (!transferId || !sha256 || !mimeType) {
    throw gwError('INVALID_ARGUMENT', '缺少 x-transfer-id、x-sha256 或 content-type')
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    total += buf.length
    if (total > ctx.maxImageBytes) {
      sendJson(res, 413, { code: -32013, message: 'MESSAGE_TOO_LARGE' })
      req.destroy()
      return
    }
    chunks.push(buf)
  }

  const { attachmentId } = ctx.attachments.acceptUpload(transferId, Buffer.concat(chunks), {
    mimeType,
    sha256
  })
  sendJson(res, 200, { attachment_id: attachmentId })
}

async function download(
  res: ServerResponse,
  attachmentId: string,
  ctx: MediaContext
): Promise<void> {
  if (!ATTACHMENT_ID.test(attachmentId)) {
    sendJson(res, 404, { code: -32016, message: 'ATTACHMENT_NOT_FOUND' })
    return
  }
  const file = ctx.attachments.openDownload(attachmentId)
  if (!file) {
    sendJson(res, 404, { code: -32016, message: 'ATTACHMENT_NOT_FOUND' })
    return
  }
  res.writeHead(200, {
    'content-type': file.mimeType,
    'content-length': String(file.size),
    'x-sha256': file.sha256,
    'cache-control': 'no-store'
  })
  await new Promise<void>((resolve) => {
    const stream = createReadStream(file.path)
    stream.once('error', () => {
      ctx.onLog?.(`media 读取失败: ${attachmentId}`)
      if (!res.headersSent) {
        sendJson(res, 404, { code: -32016, message: 'ATTACHMENT_NOT_FOUND' })
      } else {
        res.destroy()
      }
      resolve()
    })
    res.once('finish', resolve)
    stream.pipe(res)
  })
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** 处理 /media 的上传与下载；调用方只在 pathname 命中时调用。 */
export async function handleMediaRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: MediaContext
): Promise<void> {
  const url = new URL(req.url ?? '/', 'https://lanpost.local')
  if (url.pathname !== '/media' && !url.pathname.startsWith('/media/')) {
    sendJson(res, 404, { code: -32010, message: 'NOT_FOUND' })
    return
  }
  if (!checkBearer(ctx.expectedToken, req.headers.authorization)) {
    ctx.onLog?.('media 401: Bearer 缺失或错误')
    sendJson(res, 401, { code: -32001, message: 'UNAUTHORIZED' })
    return
  }
  try {
    if (req.method === 'POST' && url.pathname === '/media') {
      await upload(req, res, ctx)
      return
    }
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const raw = url.pathname.slice('/media/'.length)
      await download(res, safeDecode(raw), ctx)
      return
    }
    sendJson(res, 404, { code: -32010, message: 'NOT_FOUND' })
  } catch (error) {
    const rpc = toRpcError(error)
    ctx.onLog?.(`media ${rpc.code}: ${rpc.message}`)
    sendJson(res, httpStatus(rpc.code), rpc)
  }
}
