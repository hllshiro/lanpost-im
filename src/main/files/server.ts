import { open, type FileHandle } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import { CMD_GETDIRFILES, CMD_GETFILEDATA } from '../protocol/commands'
import { decodePacket, trimNul, type PacketHeader } from '../protocol/packet'
import { sendDirectory } from './dir-sender'

const FIRST_BYTE_TIMEOUT_MS = 3000
const IDLE_TIMEOUT_MS = 300
const MAX_REQUEST_BYTES = 8192
const CHUNK_SIZE = 64 * 1024

const HEX = /^[0-9a-fA-F]+$/

export interface GetFileRequest {
  packetId: number
  fileIds: number[]
  version: string
  remoteIp: string
  cmd: number
}

export interface FileServeTarget {
  path: string
  kind: 'file' | 'dir'
  onStart?: () => void
  onProgress?: (sent: number) => void
  onDone?: (sent: number) => void
  onError?: (error: Error) => void
}

export interface FileServerOptions {
  bindAddr: string
  port: number
  resolve: (request: GetFileRequest) => FileServeTarget | null
  onLog: (message: string) => void
  onError: (error: Error) => void
}

export interface FileServerAddress {
  address: string
  port: number
}

function parseHex(text: string, max: number): number | null {
  const trimmed = text.trim()
  if (!HEX.test(trimmed)) {
    return null
  }
  const value = Number.parseInt(trimmed, 16)
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    return null
  }
  return value
}

// GETFILEDATA 的扩展域是 “包编号:文件ID:偏移:”，全部十六进制，结尾冒号可以省略。
// 标准 IPMSG 只回传文件标识，因此单字段请求也作为文件标识候选。
export function parseGetFileRequest(payload: Buffer): { packetId: number; fileIds: number[] } {
  const raw = trimNul(payload).toString('ascii')
  const parts = raw.split(':')
  const first = parts.length > 0 ? parts[0] : ''
  const packetId = parseHex(first, 0xffffffff) ?? 0
  const fileIds: number[] = []
  if (parts.length === 1) {
    const single = parseHex(first, Number.MAX_SAFE_INTEGER)
    if (single !== null && single !== 0) {
      fileIds.push(single)
    }
  }
  for (const part of parts.slice(1)) {
    if (part.trim() === '') {
      continue
    }
    const value = parseHex(part, Number.MAX_SAFE_INTEGER)
    if (value !== null && value !== 0) {
      fileIds.push(value)
    }
  }
  return { packetId, fileIds }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

// 读取一个 TCP 请求报文：首字节最多等 3 秒，之后 300 毫秒没有新字节视为结束。
// 报文可能以 NUL 结尾，也可能直接以首字节超时结束。
function readRequest(socket: Socket): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve, reject) => {
    let data: Buffer = Buffer.alloc(0)
    let settled = false
    let firstByte = false

    const cleanup = (): void => {
      socket.removeListener('data', onData)
      socket.removeListener('end', onEnd)
      socket.removeListener('close', onEnd)
      socket.removeListener('error', fail)
      socket.removeListener('timeout', onTimeout)
      socket.setTimeout(0)
    }
    const finish = (): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(data.length > 0 ? data : null)
    }
    const fail = (error: Error): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(error)
    }
    const onData = (chunk: Buffer): void => {
      if (!firstByte) {
        firstByte = true
        socket.setTimeout(IDLE_TIMEOUT_MS)
      }
      let cut = chunk.length
      const nul = chunk.indexOf(0)
      if (nul >= 0) {
        cut = Math.min(cut, nul)
      }
      const lineFeed = chunk.indexOf(0x0a)
      if (lineFeed >= 0) {
        cut = Math.min(cut, lineFeed)
      }
      data = Buffer.concat([data, chunk.subarray(0, cut)])
      if (cut < chunk.length) {
        finish()
        return
      }
      if (data.length > MAX_REQUEST_BYTES) {
        fail(new Error('取文件请求过长'))
      }
    }
    const onEnd = (): void => {
      finish()
    }
    const onTimeout = (): void => {
      finish()
    }

    socket.on('data', onData)
    socket.once('end', onEnd)
    socket.once('close', onEnd)
    socket.once('error', fail)
    socket.once('timeout', onTimeout)
    socket.setTimeout(FIRST_BYTE_TIMEOUT_MS)
  })
}

function writeAll(socket: Socket, chunk: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error('对端连接已经关闭'))
      return
    }
    socket.write(chunk, (error) => {
      if (error !== null && error !== undefined) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

export class FileServer {
  private readonly options: FileServerOptions
  private server: Server | null = null
  private readonly sockets = new Set<Socket>()
  private bound: FileServerAddress | null = null

  constructor(options: FileServerOptions) {
    this.options = options
  }

  async start(): Promise<void> {
    if (this.server !== null) {
      throw new Error('文件服务已经启动')
    }
    const server = createServer((socket) => {
      void this.handle(socket)
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.removeListener('listening', onListening)
        this.server = null
        reject(
          new Error(`绑定 TCP ${this.options.bindAddr}:${this.options.port} 失败: ${error.message}`)
        )
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({ host: this.options.bindAddr, port: this.options.port })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') {
      server.close()
      throw new Error('文件服务没有返回监听地址')
    }
    this.server = server
    this.bound = { address: address.address, port: address.port }
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.bound = null
    for (const socket of this.sockets) {
      socket.destroy()
    }
    this.sockets.clear()
    if (server === null) {
      return
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  address(): FileServerAddress {
    if (this.bound === null) {
      throw new Error('文件服务尚未启动')
    }
    return this.bound
  }

  private async handle(socket: Socket): Promise<void> {
    this.sockets.add(socket)
    socket.setNoDelay(true)
    socket.once('close', () => {
      this.sockets.delete(socket)
    })
    // 对端中断连接时 write 回调已经能拿到错误，这里只避免未处理的 error 事件。
    socket.on('error', () => undefined)
    this.options.onLog(`收到取文件连接: ${socket.remoteAddress ?? ''}:${socket.remotePort ?? 0}`)
    try {
      const raw = await readRequest(socket)
      if (raw === null) {
        return
      }
      let header: PacketHeader
      try {
        header = decodePacket(raw)
      } catch (error) {
        this.options.onLog(`忽略无法解析的取文件请求: ${toError(error).message}`)
        return
      }
      const mode = header.cmd & 0xff
      if (mode !== CMD_GETFILEDATA && mode !== CMD_GETDIRFILES) {
        this.options.onLog(`忽略非取文件命令: ${header.cmd}`)
        return
      }
      const parsed = parseGetFileRequest(header.payload)
      const request: GetFileRequest = {
        ...parsed,
        version: header.version,
        remoteIp: socket.remoteAddress ?? '',
        cmd: header.cmd & 0xff
      }
      const target = this.options.resolve(request)
      if (target === null) {
        this.options.onLog(
          `忽略未知的取文件请求: 包编号 ${request.packetId} 文件 ${request.fileIds.join(',')}`
        )
        return
      }
      if (request.cmd === CMD_GETDIRFILES) {
        if (target.kind !== 'dir') {
          this.options.onLog(`目录请求匹配到普通文件: ${request.packetId}`)
          return
        }
        await this.streamDirectory(socket, target)
      } else {
        if (target.kind !== 'file') {
          this.options.onLog(`文件请求匹配到目录: ${request.packetId}`)
          return
        }
        await this.stream(socket, target)
      }
    } catch (error) {
      this.options.onError(toError(error))
    } finally {
      socket.end()
    }
  }

  private async streamDirectory(socket: Socket, target: FileServeTarget): Promise<void> {
    target.onStart?.()
    try {
      const sent = await sendDirectory(socket, target.path, (count) => target.onProgress?.(count))
      target.onDone?.(sent)
    } catch (error) {
      const failure = toError(error)
      if (target.onError !== undefined) target.onError(failure)
      else this.options.onError(failure)
      socket.destroy()
    }
  }

  private async stream(socket: Socket, target: FileServeTarget): Promise<void> {
    let handle: FileHandle | null = null
    let completed = false
    try {
      handle = await open(target.path, 'r')
      target.onStart?.()
      const buffer = Buffer.alloc(CHUNK_SIZE)
      let sent = 0
      for (;;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) {
          break
        }
        await writeAll(socket, buffer.subarray(0, bytesRead))
        sent += bytesRead
        target.onProgress?.(sent)
      }
      completed = true
      target.onDone?.(sent)
    } catch (error) {
      const failure = toError(error)
      if (target.onError !== undefined) {
        target.onError(failure)
      } else {
        this.options.onError(failure)
      }
    } finally {
      if (handle !== null) {
        await handle.close()
      }
      if (!completed) {
        socket.destroy()
      }
    }
  }
}
