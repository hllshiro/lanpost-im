import { open, type FileHandle } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { createServer, connect, type Server, type Socket } from 'node:net'
import { basename, dirname } from 'node:path'
import {
  FILE_CHUNK_SIZE,
  FILE_DATA_HEADER_SIZE,
  FILE_FRAME_ACK,
  FILE_FRAME_DATA,
  FILE_FRAME_HELLO,
  FILE_FRAME_PATH,
  FILE_FRAME_WINDOW,
  FILE_WINDOW_BODY_SIZE,
  FILE_HELLO_BODY_SIZE,
  FileFrameReader,
  buildAck,
  buildData,
  buildHello,
  buildPath,
  buildWindow,
  encodeFileFrame,
  parseAck,
  parseDataHeader,
  parseHello,
  parsePath,
  type FileFrame
} from './private-wire'

const CONNECT_TIMEOUT_MS = 5000
const IDLE_TIMEOUT_MS = 60_000

export interface PrivateTransferCallbacks {
  onProgress(fileId: number, received: number): void
  onDone(fileId: number, path: string): void
  onError(fileId: number, error: Error): void
}

export interface OutgoingPrivateFile {
  fileId: number
  path: string
  size: number
  // 反向推送图片时窗口消息里带的 “文件号|md5”
  window?: string
}

export interface IncomingPrivateFile {
  fileId: number
  name: string
  size: number
  savePath: string
  saveDir: string
}

export interface PrivateTransferOptions {
  bindAddr: string
  port: number
  localUserId: string
  localIp: string
  localName: string
  callbacks: PrivateTransferCallbacks
  // 对端来取头像时按文件号找本机头像文件
  resolveAvatar?(fileId: number): { path: string; size: number } | null
  // 对端来取群头像时带的是 md5，不是文件号
  resolveGroupPhoto?(body: Buffer): { path: string; size: number } | null
  onLog(message: string): void
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

// 对端握手里的 <U> 块，字段与真实客户端抓包一致；接收端只用来显示发送方资料
export function peerCardXml(input: { name: string; ip: string }): string {
  return [
    '<U>',
    `    <Name>${input.name}</Name>`,
    '    <Sex>0</Sex>',
    '    <Company/>',
    '    <Department/>',
    '    <Phone/>',
    '    <Mobile/>',
    '    <Mail/>',
    '    <Version>3.4.3055</Version>',
    `    <Ip>${input.ip}</Ip>`,
    '    <Face/>',
    '</U>'
  ].join('\n')
}

// 把 socket 上的字节流拆成消息帧，供两个方向按顺序 await
class FrameChannel {
  private readonly reader = new FileFrameReader()
  private readonly queue: FileFrame[] = []
  private readonly waiters: Array<(frame: FileFrame | null) => void> = []
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

  next(): Promise<FileFrame | null> {
    if (this.queue.length > 0) {
      return Promise.resolve(this.queue.shift() ?? null)
    }
    if (this.closed) {
      return Promise.reject(this.failure ?? new Error('私有文件通道已关闭'))
    }
    return new Promise((resolve, reject) => {
      this.waiters.push((frame) => {
        if (frame === null) {
          reject(this.failure ?? new Error('私有文件通道已关闭'))
        } else {
          resolve(frame)
        }
      })
    })
  }

  private push(frame: FileFrame): void {
    const waiter = this.waiters.shift()
    if (waiter === undefined) {
      this.queue.push(frame)
    } else {
      waiter(frame)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const waiter of this.waiters.splice(0)) {
      waiter(null)
    }
  }
}

export class PrivateFileTransfer {
  private readonly options: PrivateTransferOptions
  private server: Server | null = null
  // 反向接收时对端会按它自己的文件端口号反过来连，这里补开同号监听
  private readonly extraServers = new Map<number, Server>()
  private readonly outgoing = new Map<number, OutgoingPrivateFile>()
  private readonly incoming = new Map<number, IncomingPrivateFile>()
  private readonly active = new Set<Socket>()

  constructor(options: PrivateTransferOptions) {
    this.options = options
  }

  get port(): number {
    return this.options.port
  }

  async start(): Promise<void> {
    if (this.server !== null) return
    this.server = await this.listen(this.options.port)
    this.log(`私有文件通道监听 ${this.options.bindAddr}:${this.options.port}`)
  }

  // 额外监听一个端口，已经监听或端口被占用时返回 false
  async listenExtra(port: number): Promise<boolean> {
    if (port <= 0 || port === this.options.port || this.extraServers.has(port)) {
      return false
    }
    try {
      this.extraServers.set(port, await this.listen(port))
      this.log(`私有文件通道补充监听 ${this.options.bindAddr}:${port}`)
      return true
    } catch (error) {
      this.log(`私有文件通道补充监听 ${port} 失败: ${toError(error).message}`)
      return false
    }
  }

  private listen(port: number): Promise<Server> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => {
        void this.accept(socket).catch((error: unknown) => {
          this.log(`私有文件通道连接失败: ${toError(error).message}`)
          socket.destroy()
        })
      })
      const onError = (error: Error): void => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        server.off('error', onError)
        resolve(server)
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, this.options.bindAddr)
    })
  }

  async stop(): Promise<void> {
    for (const socket of this.active) {
      socket.destroy()
    }
    this.active.clear()
    const servers = [this.server, ...this.extraServers.values()]
    this.server = null
    this.extraServers.clear()
    await Promise.all(
      servers
        .filter((server): server is Server => server !== null)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    )
  }

  registerOutgoing(file: OutgoingPrivateFile): void {
    this.outgoing.set(file.fileId, file)
  }

  registerIncoming(file: IncomingPrivateFile): void {
    this.incoming.set(file.fileId, file)
  }

  forget(fileId: number): void {
    this.outgoing.delete(fileId)
    this.incoming.delete(fileId)
  }

  // 接收方直连发送方：发 HELLO、等 ACK、发 PATH，然后收数据
  async receive(
    peerIp: string,
    peerPort: number,
    fileId: number,
    peerUserId: string
  ): Promise<void> {
    const task = this.incoming.get(fileId)
    if (task === undefined) {
      throw new Error(`没有待接收的文件 ${fileId}`)
    }
    const socket = await this.dial(peerIp, peerPort)
    await this.receiveOver(socket, new FrameChannel(socket), task, fileId, peerUserId, false)
  }

  // 发送方连到接收方的反向端口：发 HELLO、等 ACK 与 PATH，然后推数据
  async sendReverse(peerIp: string, peerPort: number, fileId: number): Promise<void> {
    const task = this.outgoing.get(fileId)
    if (task === undefined) {
      throw new Error(`没有待发送的文件 ${fileId}`)
    }
    const socket = await this.dial(peerIp, peerPort)
    await this.sendOver(socket, new FrameChannel(socket), task, false)
  }

  private async receiveOver(
    socket: Socket,
    channel: FrameChannel,
    task: IncomingPrivateFile,
    fileId: number,
    peerUserId: string,
    listener: boolean
  ): Promise<void> {
    this.active.add(socket)
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    const handle = await open(task.savePath, 'w')
    try {
      if (!listener) {
        socket.write(
          encodeFileFrame(
            FILE_FRAME_HELLO,
            buildHello({
              selfId: this.options.localUserId,
              peerId: peerUserId,
              fileId,
              xml: peerCardXml({ name: this.options.localName, ip: this.options.localIp })
            })
          )
        )
        const ack = await this.requireFrame(channel)
        if (ack.type !== FILE_FRAME_ACK) {
          throw new Error(`私有文件通道期望确认，收到类型 ${ack.type}`)
        }
        const confirmed = parseAck(ack.body)
        if (confirmed.fileId !== fileId) {
          throw new Error('私有文件通道确认了错误的文件')
        }
        // 图片没有 X_SEND_FILE，文件大小只在确认帧里；补上才知道什么时候收完
        if (task.size === 0 && confirmed.size > 0) {
          task.size = confirmed.size
        }
      } else {
        socket.write(
          encodeFileFrame(
            FILE_FRAME_ACK,
            buildAck({ fileId, size: task.size, time: Math.floor(Date.now() / 1000) })
          )
        )
      }
      socket.write(
        encodeFileFrame(FILE_FRAME_PATH, buildPath({ dir: task.saveDir, fileId, name: task.name }))
      )
      for (;;) {
        const frame = await this.requireFrame(channel)
        if (frame.type !== FILE_FRAME_DATA) continue
        const header = parseDataHeader(frame.body)
        if (header.fileId !== fileId) {
          throw new Error(`私有文件通道收到错误的文件 ${header.fileId}`)
        }
        const content = frame.body.subarray(
          FILE_DATA_HEADER_SIZE,
          FILE_DATA_HEADER_SIZE + header.chunkSize
        )
        await writeAt(handle, content, header.offset)
        const received = Math.min(header.offset + header.chunkSize, task.size)
        this.options.callbacks.onProgress(fileId, received)
        if (received >= task.size) break
      }
      this.forget(fileId)
      this.options.callbacks.onDone(fileId, task.savePath)
      socket.end()
    } finally {
      await handle.close()
      this.active.delete(socket)
    }
  }

  private async sendOver(
    socket: Socket,
    channel: FrameChannel,
    task: OutgoingPrivateFile,
    listener: boolean
  ): Promise<void> {
    this.active.add(socket)
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    try {
      if (!listener) {
        // 发送方主动连：先发窗口消息，再等接收方的 HELLO，然后确认
        socket.write(
          encodeFileFrame(
            FILE_FRAME_WINDOW,
            task.window === undefined
              ? Buffer.alloc(FILE_WINDOW_BODY_SIZE)
              : buildWindow({ fileId: task.fileId, value: task.window })
          )
        )
        const hello = await this.requireFrame(channel)
        if (hello.type !== FILE_FRAME_HELLO) {
          throw new Error(`私有文件通道期望接收方握手，收到类型 ${hello.type}`)
        }
        if (parseHello(hello.body).fileId !== task.fileId) {
          throw new Error('私有文件通道握手了错误的文件')
        }
        socket.write(
          encodeFileFrame(
            FILE_FRAME_ACK,
            buildAck({
              fileId: task.fileId,
              size: task.size,
              time: Math.floor(Date.now() / 1000)
            })
          )
        )
      } else {
        socket.write(
          encodeFileFrame(
            FILE_FRAME_ACK,
            buildAck({
              fileId: task.fileId,
              size: task.size,
              time: Math.floor(Date.now() / 1000)
            })
          )
        )
      }
      for (;;) {
        const frame = await this.requireFrame(channel)
        if (frame.type === FILE_FRAME_PATH) {
          if (parsePath(frame.body).fileId !== task.fileId) {
            throw new Error('私有文件通道收到了错误的接收路径')
          }
          break
        }
      }
      await this.streamFile(socket, task)
      this.forget(task.fileId)
      this.options.callbacks.onDone(task.fileId, task.path)
      socket.end()
    } finally {
      this.active.delete(socket)
    }
  }

  private async requireFrame(channel: FrameChannel): Promise<FileFrame> {
    const frame = await channel.next()
    if (frame === null) {
      throw new Error('私有文件通道在握手前关闭')
    }
    return frame
  }

  // 监听方：对端主动连过来。按文件号判断是发送方还是接收方。
  private async accept(socket: Socket): Promise<void> {
    this.active.add(socket)
    socket.setTimeout(IDLE_TIMEOUT_MS, () => socket.destroy())
    const channel = new FrameChannel(socket)
    const first = await this.requireFrame(channel)
    if (first.type === FILE_FRAME_WINDOW) {
      // 反向接收：对端是发送方，本端是接收方，按接收流程发 HELLO 并收数据。
      // 窗口帧在偏移 44 写着这一路要推的文件号，必须按它找任务，不能随便取一个待接收任务
      const pushedId = first.body.length >= 48 ? first.body.readUInt32BE(44) : 0
      const task = this.incoming.get(pushedId) ?? this.pendingIncoming()
      if (task === undefined) {
        throw new Error('私有文件通道收到窗口消息但没有待接收任务')
      }
      this.log(`收到反向图片推送 ${pushedId}，按任务 ${task.fileId} 接收`)
      await this.receiveOver(socket, channel, task, task.fileId, '', false)
      return
    }
    if (first.type !== FILE_FRAME_HELLO) {
      throw new Error(`私有文件通道期望握手，收到类型 ${first.type}`)
    }
    const parsed = parseHello(first.body)
    const incoming = this.incoming.get(parsed.fileId)
    if (incoming !== undefined) {
      // 接收方自己监听：回 ACK、发 PATH，然后收数据
      await this.receiveOver(socket, channel, incoming, parsed.fileId, parsed.selfId, true)
      return
    }
    const outgoing = this.outgoing.get(parsed.fileId)
    if (outgoing === undefined) {
      // 头像走同一个文件端口：文件号就是本机公布的 USER_FACE id，内容不用解析
      const avatar = this.options.resolveAvatar?.(parsed.fileId) ?? null
      if (avatar !== null) {
        await this.serveAvatar(socket, channel, parsed.fileId, avatar)
        return
      }
      const groupPhoto = this.options.resolveGroupPhoto?.(first.body) ?? null
      if (groupPhoto !== null) {
        await this.serveAvatar(socket, channel, parsed.fileId, groupPhoto)
        return
      }
      this.log(
        `未知文件 ${parsed.fileId} 的握手（${socket.remoteAddress ?? '?'}:${socket.remotePort ?? 0} -> 本机 ${socket.localPort ?? 0}）：${first.body.toString('hex').slice(0, 800)}`
      )
      throw new Error(`私有文件通道收到未知文件 ${parsed.fileId} 的握手`)
    }
    await this.sendOver(socket, channel, outgoing, true)
  }

  // 对端取头像：回大小，等它发来请求帧，然后把头像文件推过去
  private async serveAvatar(
    socket: Socket,
    channel: FrameChannel,
    fileId: number,
    file: { path: string; size: number }
  ): Promise<void> {
    this.log(`对端请求头像 ${fileId}，发送 ${file.size} 字节`)
    socket.write(
      encodeFileFrame(
        FILE_FRAME_ACK,
        buildAck({ fileId, size: file.size, time: Math.floor(Date.now() / 1000) })
      )
    )
    await this.requireFrame(channel)
    await this.streamFile(socket, { fileId, path: file.path, size: file.size })
    socket.end()
  }

  // 取对端群头像：HELLO 里把 md5 写在偏移 148（UTF-16），其余走同一套 ACK/PATH/DATA
  async fetchGroupPhoto(input: {
    ip: string
    port: number
    md5: string
    savePath: string
    maxBytes: number
  }): Promise<number> {
    const socket = await this.dial(input.ip, input.port)
    const channel = new FrameChannel(socket)
    try {
      const body = Buffer.alloc(FILE_HELLO_BODY_SIZE)
      body.writeUInt32BE(0, 44)
      body.write(input.md5, 148, 'utf16le')
      socket.write(encodeFileFrame(FILE_FRAME_HELLO, body))
      const ack = await this.requireFrame(channel)
      if (ack.type !== FILE_FRAME_ACK) {
        throw new Error(`取群头像期望确认，收到类型 ${ack.type}`)
      }
      const confirmed = parseAck(ack.body)
      if (confirmed.size <= 0 || confirmed.size > input.maxBytes) {
        throw new Error(`群头像大小异常 ${confirmed.size}`)
      }
      socket.write(
        encodeFileFrame(
          FILE_FRAME_PATH,
          buildPath({
            dir: dirname(input.savePath),
            fileId: confirmed.fileId,
            name: basename(input.savePath)
          })
        )
      )
      const data = Buffer.alloc(confirmed.size)
      let received = 0
      for (;;) {
        const frame = await this.requireFrame(channel)
        if (frame.type !== FILE_FRAME_DATA) continue
        const header = parseDataHeader(frame.body)
        if (header.fileId !== confirmed.fileId) {
          throw new Error(`取群头像时收到错误的文件 ${header.fileId}`)
        }
        const chunk = frame.body.subarray(
          FILE_DATA_HEADER_SIZE,
          FILE_DATA_HEADER_SIZE + header.chunkSize
        )
        chunk.copy(data, header.offset)
        received = Math.max(received, header.offset + header.chunkSize)
        if (received >= confirmed.size) break
      }
      writeFileSync(input.savePath, data.subarray(0, confirmed.size))
      socket.end()
      return confirmed.size
    } finally {
      socket.destroy()
      this.active.delete(socket)
    }
  }

  // 取对端头像：HELLO -> ACK -> PATH -> DATA，头像很小，整段收完再落盘
  async fetchAvatar(input: {
    ip: string
    port: number
    fileId: number
    savePath: string
    maxBytes: number
  }): Promise<number> {
    const socket = await this.dial(input.ip, input.port)
    const channel = new FrameChannel(socket)
    try {
      socket.write(
        encodeFileFrame(
          FILE_FRAME_HELLO,
          buildHello({
            selfId: this.options.localUserId,
            peerId: '',
            fileId: input.fileId,
            xml: peerCardXml({ name: this.options.localName, ip: this.options.localIp })
          })
        )
      )
      const ack = await this.requireFrame(channel)
      if (ack.type !== FILE_FRAME_ACK) {
        throw new Error(`取头像期望确认，收到类型 ${ack.type}`)
      }
      const confirmed = parseAck(ack.body)
      if (confirmed.fileId !== input.fileId) {
        throw new Error('取头像时对端确认了错误的文件')
      }
      if (confirmed.size <= 0 || confirmed.size > input.maxBytes) {
        throw new Error(`头像大小异常 ${confirmed.size}`)
      }
      socket.write(
        encodeFileFrame(
          FILE_FRAME_PATH,
          buildPath({
            dir: dirname(input.savePath),
            fileId: input.fileId,
            name: basename(input.savePath)
          })
        )
      )
      const data = Buffer.alloc(confirmed.size)
      let received = 0
      for (;;) {
        const frame = await this.requireFrame(channel)
        if (frame.type !== FILE_FRAME_DATA) continue
        const header = parseDataHeader(frame.body)
        if (header.fileId !== input.fileId) {
          throw new Error(`取头像时收到错误的文件 ${header.fileId}`)
        }
        const chunk = frame.body.subarray(
          FILE_DATA_HEADER_SIZE,
          FILE_DATA_HEADER_SIZE + header.chunkSize
        )
        chunk.copy(data, header.offset)
        received = Math.max(received, header.offset + header.chunkSize)
        if (received >= confirmed.size) break
      }
      writeFileSync(input.savePath, data.subarray(0, confirmed.size))
      socket.end()
      return confirmed.size
    } finally {
      socket.destroy()
      this.active.delete(socket)
    }
  }

  private pendingIncoming(): IncomingPrivateFile | undefined {
    let latest: IncomingPrivateFile | undefined
    for (const task of this.incoming.values()) {
      latest = task
    }
    return latest
  }

  private async streamFile(socket: Socket, task: OutgoingPrivateFile): Promise<void> {
    const handle = await open(task.path, 'r')
    try {
      const buffer = Buffer.alloc(FILE_CHUNK_SIZE)
      let offset = 0
      while (offset < task.size) {
        const length = Math.min(FILE_CHUNK_SIZE, task.size - offset)
        const result = await handle.read(buffer, 0, length, offset)
        if (result.bytesRead === 0) break
        await writeFrame(
          socket,
          encodeFileFrame(
            FILE_FRAME_DATA,
            buildData({
              fileId: task.fileId,
              size: task.size,
              offset,
              chunk: buffer.subarray(0, result.bytesRead)
            })
          )
        )
        offset += result.bytesRead
        this.options.callbacks.onProgress(task.fileId, offset)
      }
    } finally {
      await handle.close()
    }
  }

  // 对端可能刚收到开始指令才监听端口，第一次连接被拒时短暂重试
  private async dial(ip: string, port: number): Promise<Socket> {
    let lastError: Error | null = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return await this.dialOnce(ip, port)
      } catch (error) {
        lastError = toError(error)
        if (!lastError.message.includes('ECONNREFUSED')) {
          throw lastError
        }
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
    throw lastError ?? new Error(`连接私有文件通道 ${ip}:${port} 失败`)
  }

  private dialOnce(ip: string, port: number): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: ip, port })
      const timer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`连接私有文件通道 ${ip}:${port} 超时`))
      }, CONNECT_TIMEOUT_MS)
      socket.once('connect', () => {
        clearTimeout(timer)
        socket.off('error', onError)
        this.active.add(socket)
        resolve(socket)
      })
      const onError = (error: Error): void => {
        clearTimeout(timer)
        reject(toError(error))
      }
      socket.once('error', onError)
    })
  }

  private log(message: string): void {
    this.options.onLog(message)
  }
}

function writeAt(handle: FileHandle, content: Buffer, offset: number): Promise<void> {
  return (async () => {
    let written = 0
    while (written < content.length) {
      const result = await handle.write(
        content,
        written,
        content.length - written,
        offset + written
      )
      written += result.bytesWritten
    }
  })()
}

function writeFrame(socket: Socket, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed) {
      reject(new Error('私有文件通道连接已关闭'))
      return
    }
    socket.write(frame, (error) =>
      error === null || error === undefined ? resolve() : reject(error)
    )
  })
}
