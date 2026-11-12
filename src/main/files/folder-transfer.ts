import { mkdirSync, openSync, readSync, writeSync, closeSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { dirname, join, normalize, sep } from 'node:path'
import {
  FOLDER_CHUNK_SIZE,
  FOLDER_CMD_DATA,
  FOLDER_CMD_ITEM_CONFIRM,
  FOLDER_CMD_ITEM_RECEIVED,
  FOLDER_CMD_ITEM_SENT,
  FOLDER_CMD_START,
  FolderFrameReader,
  buildAccept,
  buildData,
  buildItemAck,
  buildManifest,
  buildProgress,
  buildStart,
  parseAccept,
  parseData,
  parseItemAck,
  parseManifest,
  parseStart,
  type FolderFrame
} from './folder-wire'

const IDLE_TIMEOUT_MS = 60_000

export interface IncomingFolder {
  taskId: string
  name: string
  saveDir: string
  size: number
}

export interface OutgoingFolder {
  taskId: string
  // 给对端的完整路径（真实客户端就是这么发的）
  name: string
  root: string
  size: number
  items: Array<{ name: string; dir: boolean; size: number; time: number }>
}

export interface FolderTransferCallbacks {
  onProgress(taskId: string, received: number, total: number): void
  onDone(taskId: string, dir: string): void
  onError(taskId: string, error: Error): void
}

export interface FolderTransferOptions {
  bindAddr: string
  port: number
  callbacks: FolderTransferCallbacks
  onLog(message: string): void
}

interface OpenItem {
  index: number
  path: string
  size: number
  written: number
  handle: number | null
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

// 把清单里的相对路径限制在保存目录内；返回 null 表示拒绝
export function safeItemPath(root: string, name: string): string | null {
  const cleaned = name.replaceAll('\\', sep)
  const resolved = normalize(join(root, cleaned))
  const base = normalize(root)
  if (resolved !== base && !resolved.startsWith(base.endsWith(sep) ? base : base + sep)) {
    return null
  }
  return resolved
}

export class PrivateFolderTransfer {
  private readonly options: FolderTransferOptions
  private server: Server | null = null
  // 对端反向连接时会用它自己的文件夹端口号，本机要按这个号补开监听
  private readonly extraServers = new Map<number, Server>()
  private readonly incoming = new Map<string, IncomingFolder>()
  private readonly active = new Set<Socket>()

  constructor(options: FolderTransferOptions) {
    this.options = options
  }

  get port(): number {
    return this.options.port
  }

  async start(): Promise<void> {
    if (this.server !== null) return
    this.server = await this.listen(this.options.port)
    this.log(`文件夹通道监听 ${this.options.bindAddr}:${this.options.port}`)
  }

  // 对端反向连接时连的是它自己的文件夹端口号，握手后按这个号补开监听
  async listenExtra(port: number): Promise<boolean> {
    if (port <= 0 || port === this.options.port || this.extraServers.has(port)) {
      return false
    }
    try {
      this.extraServers.set(port, await this.listen(port))
      this.log(`文件夹通道补充监听 ${this.options.bindAddr}:${port}`)
      return true
    } catch (error) {
      this.log(`文件夹通道补充监听 ${port} 失败: ${toError(error).message}`)
      return false
    }
  }

  private listen(port: number): Promise<Server> {
    return new Promise<Server>((resolve, reject) => {
      const server = createServer((socket) => {
        void this.accept(socket).catch((error: unknown) => {
          this.log(`文件夹通道连接失败: ${toError(error).message}`)
          socket.destroy()
        })
      })
      server.once('error', reject)
      server.listen(port, this.options.bindAddr, () => resolve(server))
    })
  }

  stop(): void {
    for (const socket of this.active) socket.destroy()
    this.active.clear()
    for (const server of [this.server, ...this.extraServers.values()]) {
      server?.close()
    }
    this.extraServers.clear()
    this.server = null
  }

  registerIncoming(folder: IncomingFolder): void {
    this.incoming.set(folder.taskId, folder)
  }

  // 发送方：连接收方的文件夹端口，先发开场与清单，再逐项推数据
  async send(ip: string, folder: OutgoingFolder, port: number): Promise<void> {
    const socket = await this.dial(ip, port)
    this.active.add(socket)
    this.log(`文件夹通道已连上 ${ip}:${port}（任务 ${folder.taskId}）`)
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    const frames = new FrameQueue(socket)
    try {
      socket.write(buildStart(folder.taskId, folder.items.length, folder.size))
      const accept = await frames.next()
      if (accept === null || accept.cmd !== 2) {
        throw new Error(`文件夹通道期望接受帧，收到 ${accept?.cmd ?? '关闭'}`)
      }
      if (parseAccept(accept.body) !== folder.taskId) {
        throw new Error('文件夹通道接受了别的任务')
      }

      socket.write(
        buildManifest(
          folder.items.map((item, index) => ({
            name: item.name,
            dir: item.dir,
            index,
            size: item.size,
            time: item.time
          }))
        )
      )
      const progress = await frames.next()
      if (progress === null || progress.cmd !== 4) {
        throw new Error(`文件夹通道期望进度帧，收到 ${progress?.cmd ?? '关闭'}`)
      }

      for (const [index, item] of folder.items.entries()) {
        if (item.dir) continue
        await this.sendItem(socket, frames, folder, index, item)
      }
      // 全部项发完再做一次收尾握手：7 由发送方发，8 由接收方回
      socket.write(buildItemAck(FOLDER_CMD_ITEM_SENT, 0, 0))
      const confirm = await frames.next()
      this.log(`文件夹通道收尾 cmd=${confirm?.cmd ?? '关闭'}`)
      this.log(`文件夹通道发送完成 任务=${folder.taskId}`)
    } finally {
      socket.destroy()
      this.active.delete(socket)
    }
  }

  private async sendItem(
    socket: Socket,
    frames: FrameQueue,
    folder: OutgoingFolder,
    index: number,
    item: { name: string; size: number }
  ): Promise<void> {
    const path = join(folder.root, item.name.replaceAll('\\', sep))
    const handle = openSync(path, 'r')
    try {
      // 项的开场标记：正文只带一个 0 字节，接收方不落盘
      socket.write(buildData(index, 2, Buffer.from([0])))
      let offset = 0
      const chunk = Buffer.alloc(FOLDER_CHUNK_SIZE)
      while (offset < item.size) {
        const read = readSync(
          handle,
          chunk,
          0,
          Math.min(FOLDER_CHUNK_SIZE, item.size - offset),
          offset
        )
        if (read <= 0) break
        socket.write(buildData(index, 0, chunk.subarray(0, read)))
        offset += read
      }
      const ack = await frames.next()
      if (ack === null) {
        this.log(`文件夹通道项 ${index} 没等到回执，连接已关闭`)
        return
      }
      this.log(
        `文件夹通道项 ${index} 回执 cmd=${ack.cmd} 序号=${ack.body.readUInt32BE(0x14)} ` +
          `已收=${Number(ack.body.readBigUInt64BE(0x18))}`
      )
      this.options.callbacks.onProgress(folder.taskId, offset, folder.size)
    } finally {
      closeSync(handle)
    }
  }

  private dial(ip: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: ip, port })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`连接文件夹端口超时 ${ip}:${port}`))
      }, 5000)
      socket.once('connect', () => {
        clearTimeout(timer)
        resolve(socket)
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  forget(taskId: string): void {
    this.incoming.delete(taskId)
  }

  // 接收方：对端连进来后先发 1（开场），我们回 2，再收 3（清单）回 4，
  // 然后收 5（数据块）并逐项落盘，每项收完回 6
  private async accept(socket: Socket): Promise<void> {
    this.active.add(socket)
    this.log(`文件夹通道收到连接 ${socket.remoteAddress}:${socket.remotePort}`)
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    const frames = new FrameQueue(socket)
    try {
      const start = await frames.next()
      if (start === null || start.cmd !== FOLDER_CMD_START) {
        throw new Error(`文件夹通道期望开场帧，收到 ${start?.cmd ?? '关闭'}`)
      }
      const startInfo = parseStart(start.body)
      const folder = this.incoming.get(startInfo.taskId)
      if (folder === undefined) {
        throw new Error(`没有待接收的文件夹任务 ${startInfo.taskId}`)
      }
      this.log(
        `文件夹通道开场 任务=${startInfo.taskId} 项数=${startInfo.count} 总大小=${startInfo.totalSize}`
      )
      socket.write(buildAccept(startInfo.taskId))

      const manifest = await frames.next()
      if (manifest === null || manifest.cmd !== 3) {
        throw new Error(`文件夹通道期望清单帧，收到 ${manifest?.cmd ?? '关闭'}`)
      }
      const items = parseManifest(manifest.body)
      this.log(`文件夹通道清单 ${items.length} 项`)
      const opened: OpenItem[] = []
      for (const item of items) {
        const path = safeItemPath(folder.saveDir, item.name)
        if (path === null) {
          throw new Error(`文件夹通道拒绝越界路径 ${item.name}`)
        }
        if (item.dir) {
          mkdirSync(path, { recursive: true })
          opened.push({ index: item.index, path, size: 0, written: 0, handle: null })
          continue
        }
        mkdirSync(dirname(path), { recursive: true })
        opened.push({
          index: item.index,
          path,
          size: item.size,
          written: 0,
          handle: openSync(path, 'w')
        })
      }
      // 每项带一条进度：offset 0、action 0，与真实接收端一致
      socket.write(
        buildProgress(opened.map((item) => ({ index: item.index, offset: 0, action: 0 })))
      )

      let received = 0
      const byIndex = new Map(opened.map((item) => [item.index, item]))
      for (;;) {
        const frame = await frames.next()
        if (frame === null) break
        if (frame.cmd === FOLDER_CMD_DATA) {
          const data = parseData(frame.body)
          const item = byIndex.get(data.index)
          if (item === undefined) continue
          // action=2 是项的开场标记，正文那一个字节不属于文件
          if (data.action === 2 || item.handle === null) continue
          writeSync(item.handle, data.chunk)
          item.written += data.chunk.length
          received += data.chunk.length
          this.options.callbacks.onProgress(folder.taskId, received, folder.size)
          if (item.written >= item.size) {
            closeSync(item.handle)
            item.handle = null
            socket.write(buildItemAck(FOLDER_CMD_ITEM_RECEIVED, item.index, item.written))
          }
          continue
        }
        if (frame.cmd === FOLDER_CMD_ITEM_SENT) {
          const ack = parseItemAck(frame.body)
          socket.write(buildItemAck(FOLDER_CMD_ITEM_CONFIRM, ack.index, ack.offset))
          continue
        }
        this.log(`文件夹通道控制帧 cmd=${frame.cmd} 长度=${frame.body.length}`)
        if (frame.cmd === FOLDER_CMD_ITEM_CONFIRM) {
          break
        }
      }
      for (const item of opened) {
        if (item.handle !== null) closeSync(item.handle)
      }
      this.incoming.delete(folder.taskId)
      this.log(`文件夹通道接收完成 任务=${folder.taskId} 目录=${folder.saveDir}`)
      this.options.callbacks.onDone(folder.taskId, folder.saveDir)
    } finally {
      socket.destroy()
      this.active.delete(socket)
    }
  }

  private log(message: string): void {
    this.options.onLog(message)
  }
}

// 把 socket 上的字节流按帧切好，供接收流程按顺序 await
class FrameQueue {
  private readonly reader = new FolderFrameReader()
  private readonly queue: FolderFrame[] = []
  private readonly waiters: Array<(frame: FolderFrame | null) => void> = []
  private closed = false
  private failure: Error | null = null

  constructor(socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.reader.push(chunk)) this.push(frame)
      } catch (error) {
        this.failure = toError(error)
        this.close()
      }
    })
    socket.on('close', () => this.close())
    socket.on('error', (error) => {
      this.failure = toError(error)
      this.close()
    })
  }

  next(): Promise<FolderFrame | null> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift() ?? null)
    }
    if (this.closed) {
      return Promise.reject(this.failure ?? new Error('文件夹通道已关闭'))
    }
    return new Promise((resolve) => {
      this.waiters.push((frame) => {
        if (frame === null) {
          // 关闭时把等待者交还给调用方，由它决定是否算失败
          this.queue.length === 0 ? resolve(null) : resolve(frame)
        } else {
          resolve(frame)
        }
      })
    })
  }

  private push(frame: FolderFrame): void {
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.queue.push(frame)
    } else {
      waiter(frame)
    }
  }

  private close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter(null)
    }
  }
}
