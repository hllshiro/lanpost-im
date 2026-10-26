import { mkdir, open, rm, type FileHandle } from 'node:fs/promises'
import { connect, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { CMD_GETFILEDATA } from '../protocol/commands'
import { encodePacket } from '../protocol/packet'

export const CONNECT_TIMEOUT_MS = 10_000
export const WRITE_TIMEOUT_MS = 10_000
export const READ_TIMEOUT_MS = 60_000

export interface PullFileRequest {
  peerIp: string
  peerPort: number
  packetId: number
  fileId: number
  seq: number
  user: string
  host: string
  path: string
  size: number
  signal?: AbortSignal
  onProgress?: (received: number) => void
}

// 拉取请求的版本号必须是不带后缀的 “1”，扩展域为 “包编号:文件ID:0:”，
// 全部十六进制且结尾带冒号，正文不带 NUL。
export function buildGetFilePayload(packetId: number, fileId: number): Buffer {
  return Buffer.from(
    `${packetId.toString(16)}:${fileId.toString(16)}:${(0).toString(16)}:`,
    'ascii'
  )
}

export function buildGetFileRequest(request: {
  packetId: number
  fileId: number
  seq: number
  user: string
  host: string
}): Buffer {
  return encodePacket({
    seq: request.seq,
    user: request.user,
    host: request.host,
    cmd: CMD_GETFILEDATA,
    payload: buildGetFilePayload(request.packetId, request.fileId)
  })
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

function openConnection(peerIp: string, peerPort: number, signal?: AbortSignal): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect({ host: peerIp, port: peerPort })
    let settled = false
    const cleanup = (): void => {
      socket.removeListener('connect', onConnect)
      socket.removeListener('error', onError)
      socket.removeListener('timeout', onTimeout)
      socket.removeListener('close', onClose)
      signal?.removeEventListener('abort', onAbort)
    }
    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      socket.destroy()
      reject(error)
    }
    const onConnect = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      socket.setTimeout(0)
      resolve(socket)
    }
    const onError = (error: Error): void => {
      fail(new Error(`连接发送方 ${peerIp}:${peerPort} 失败: ${error.message}`))
    }
    const onTimeout = (): void => {
      fail(new Error(`连接发送方 ${peerIp}:${peerPort} 超时`))
    }
    const onClose = (): void => {
      fail(new Error(`连接发送方 ${peerIp}:${peerPort} 时连接被关闭`))
    }
    const onAbort = (): void => {
      fail(new Error('文件接收已取消'))
    }
    socket.once('connect', onConnect)
    socket.once('error', onError)
    socket.once('timeout', onTimeout)
    socket.once('close', onClose)
    socket.setNoDelay(true)
    signal?.addEventListener('abort', onAbort, { once: true })
    socket.setTimeout(CONNECT_TIMEOUT_MS)
    if (signal?.aborted === true) {
      fail(new Error('文件接收已取消'))
    }
  })
}

function writeRequest(socket: Socket, data: Buffer, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('文件接收已取消'))
      return
    }
    socket.setTimeout(WRITE_TIMEOUT_MS)
    socket.write(data, (error) => {
      if (error !== null && error !== undefined) {
        reject(new Error(`发送取文件请求失败: ${error.message}`))
        return
      }
      resolve()
    })
  })
}

async function writeChunk(handle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset)
    if (bytesWritten === 0) {
      throw new Error('写入文件失败: 没有写入任何字节')
    }
    offset += bytesWritten
  }
}

// 拉取完成后返回实际写入的字节数。任何失败都会删除没有写完的文件。
export async function pullFile(request: PullFileRequest): Promise<number> {
  const { signal } = request
  if (signal?.aborted === true) {
    throw new Error('文件接收已取消')
  }
  await mkdir(dirname(request.path), { recursive: true })
  const socket = await openConnection(request.peerIp, request.peerPort, signal)
  const onSocketError = (error: Error): void => {
    socket.destroy(error)
  }
  const onTimeout = (): void => {
    socket.destroy(new Error('读取文件数据超时'))
  }
  const onAbort = (): void => {
    socket.destroy(new Error('文件接收已取消'))
  }
  socket.on('error', onSocketError)
  signal?.addEventListener('abort', onAbort, { once: true })

  let handle: FileHandle | null = null
  let written = 0
  try {
    await writeRequest(socket, buildGetFileRequest(request), signal)
    socket.setTimeout(READ_TIMEOUT_MS)
    socket.on('timeout', onTimeout)
    handle = await open(request.path, 'wx')
    for await (const chunk of socket) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      await writeChunk(handle, buffer)
      written += buffer.length
      request.onProgress?.(written)
      if (request.size > 0 && written >= request.size) {
        break
      }
    }
    if (request.size > 0 && written !== request.size) {
      throw new Error(`文件不完整：收到 ${written}/${request.size} 字节`)
    }
    await handle.close()
    handle = null
    return written
  } catch (error) {
    const failure = toError(error)
    if (handle !== null) {
      await handle.close()
    }
    await rm(request.path, { force: true })
    throw failure
  } finally {
    signal?.removeEventListener('abort', onAbort)
    socket.off('timeout', onTimeout)
    socket.off('error', onSocketError)
    socket.destroy()
  }
}
