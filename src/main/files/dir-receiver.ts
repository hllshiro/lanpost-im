import { mkdir, open, rm, type FileHandle } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { Socket } from 'node:net'
import { applyFileAttrs, fileType } from '../protocol/attrs'
import { FILE_ATTR_DIR, FILE_ATTR_REGULAR, FILE_ATTR_RETPARENT } from '../protocol/commands'
import { parseDirHeader } from '../protocol/dir-stream'
import { buildGetDirRequest, openConnection, writeRequest } from './client'
import { safeRelativePath } from './paths'

export interface PullDirRequest {
  peerIp: string
  peerPort: number
  packetId: number
  fileId: number
  seq: number
  user: string
  host: string
  path: string
  signal?: AbortSignal
  onProgress?: (received: number, completed: number) => void
}

export interface PullDirResult {
  received: number
  entries: number
}

const COLON = 0x3a

class SocketReader {
  private chunks: Buffer[] = []
  private ended = false
  private readonly iterator: AsyncIterator<unknown>

  constructor(socket: Socket) {
    this.iterator = socket[Symbol.asyncIterator]() as AsyncIterator<unknown>
  }

  async readExactly(size: number): Promise<Buffer> {
    while (this.total() < size) {
      if (!(await this.fill())) throw new Error('目录传输提前结束')
    }
    return this.take(size)
  }

  async readUntil(byte: number, max: number): Promise<Buffer> {
    for (;;) {
      const index = this.indexOf(byte)
      if (index >= 0) return this.take(index + 1)
      if (this.total() > max) throw new Error('目录头过长')
      if (!(await this.fill())) throw new Error('目录传输提前结束')
    }
  }

  async skip(size: number): Promise<void> {
    let remaining = size
    while (remaining > 0) {
      if (this.total() === 0 && !(await this.fill())) throw new Error('目录传输提前结束')
      const chunk = this.take(Math.min(remaining, this.total()))
      remaining -= chunk.length
    }
  }

  private total(): number {
    return this.chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  }

  private indexOf(byte: number): number {
    let offset = 0
    for (const chunk of this.chunks) {
      const index = chunk.indexOf(byte)
      if (index >= 0) return offset + index
      offset += chunk.length
    }
    return -1
  }

  private take(size: number): Buffer {
    const out: Buffer[] = []
    let remaining = size
    while (remaining > 0) {
      const chunk = this.chunks[0]
      if (chunk === undefined) break
      if (chunk.length <= remaining) {
        out.push(chunk)
        this.chunks.shift()
        remaining -= chunk.length
      } else {
        out.push(chunk.subarray(0, remaining))
        this.chunks[0] = chunk.subarray(remaining)
        remaining = 0
      }
    }
    return Buffer.concat(out)
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return false
    const { value, done } = await this.iterator.next()
    if (done) {
      this.ended = true
      return false
    }
    this.chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array))
    return true
  }
}

function inside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolved = resolve(candidate)
  return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + sep)
}

async function writeFile(
  path: string,
  reader: SocketReader,
  size: number,
  onBytes: (count: number) => void
): Promise<void> {
  const handle = await open(path, 'w')
  try {
    let remaining = size
    while (remaining > 0) {
      const chunk = await reader.readExactly(Math.min(remaining, 64 * 1024))
      await writeAll(handle, chunk)
      remaining -= chunk.length
      onBytes(chunk.length)
    }
  } finally {
    await handle.close()
  }
}

async function writeAll(handle: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset)
    if (bytesWritten === 0) throw new Error('写入目录文件失败')
    offset += bytesWritten
  }
}

// 接收 GETDIRFILES 流：临时目录代表根，第一个 DIR 头不创建子目录；
// 每个 RETPARENT 回到上一层，根层 RETPARENT 表示传输完成。
export async function pullDirectory(request: PullDirRequest): Promise<PullDirResult> {
  if (request.signal?.aborted === true) throw new Error('目录接收已取消')
  await mkdir(request.path, { recursive: true })
  const socket = await openConnection(request.peerIp, request.peerPort, request.signal)
  const reader = new SocketReader(socket)
  const onError = (error: Error): void => {
    socket.destroy(error)
  }
  const onAbort = (): void => {
    socket.destroy(new Error('目录接收已取消'))
  }
  socket.on('error', onError)
  request.signal?.addEventListener('abort', onAbort, { once: true })

  let received = 0
  let entries = 0
  const stack: Array<{ path: string; attrs: ReturnType<typeof parseDirHeader> }> = []
  const root = resolve(request.path)

  try {
    await writeRequest(
      socket,
      buildGetDirRequest({
        packetId: request.packetId,
        fileId: request.fileId,
        seq: request.seq,
        user: request.user,
        host: request.host
      }),
      request.signal
    )

    for (;;) {
      const prefix = await reader.readUntil(COLON, 16)
      const size = Number.parseInt(prefix.subarray(0, -1).toString('ascii'), 16)
      if (!Number.isSafeInteger(size) || size < prefix.length || size > 0x10000) {
        throw new Error('目录头长度无效')
      }
      const rest = await reader.readExactly(size - prefix.length)
      const header = parseDirHeader(Buffer.concat([prefix, rest]))
      if (header === null) throw new Error('目录头无法解析')

      const type = fileType(header.attr)
      const current = stack.length > 0 ? stack[stack.length - 1].path : root

      if (type === FILE_ATTR_DIR) {
        if (stack.length === 0) {
          entries += 1
          stack.push({ path: root, attrs: header })
        } else {
          const relative = safeRelativePath(header.name)
          if (relative === null) throw new Error(`目录名不安全: ${header.name}`)
          const target = resolve(current, relative)
          if (!inside(root, target)) throw new Error('目录路径越界')
          await mkdir(target, { recursive: true })
          entries += 1
          stack.push({ path: target, attrs: header })
        }
        continue
      }

      if (type === FILE_ATTR_RETPARENT) {
        const finished = stack.pop()
        if (finished !== undefined && finished.attrs !== null) {
          applyFileAttrs(finished.path, finished.attrs.attr, finished.attrs.ext)
        }
        if (stack.length === 0) {
          entries += 1
          return { received, entries }
        }
        continue
      }

      if (type === FILE_ATTR_REGULAR) {
        const relative = safeRelativePath(header.name)
        if (relative === null) throw new Error(`文件名不安全: ${header.name}`)
        const target = resolve(current, relative)
        if (!inside(root, target)) throw new Error('文件路径越界')
        await mkdir(resolve(target, '..'), { recursive: true })
        await writeFile(target, reader, header.size, (count) => {
          received += count
          request.onProgress?.(received, entries)
        })
        applyFileAttrs(target, header.attr, header.ext)
        entries += 1
        request.onProgress?.(received, entries)
        continue
      }

      await reader.skip(header.size)
      entries += 1
    }
  } catch (error) {
    await rm(request.path, { recursive: true, force: true })
    throw error
  } finally {
    request.signal?.removeEventListener('abort', onAbort)
    socket.off('error', onError)
    socket.destroy()
  }
}
