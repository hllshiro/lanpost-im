import { createServer, connect, type Server, type Socket } from 'node:net'

const FRAME_HEADER_SIZE = 12
const MAX_FRAME_BYTES = 8 * 1024 * 1024

export interface FolderProbeOptions {
  bindAddr: string
  port: number
  log(message: string): void
}

// 把载荷里能读出来的 UTF-16LE 串挑出来，便于核对路径、通道号这类字段
export function scanUtf16(body: Buffer): string[] {
  const found: string[] = []
  let current: number[] = []
  for (let offset = 0; offset + 1 < body.length; offset += 2) {
    const code = body.readUInt16LE(offset)
    const printable = code === 9 || (code >= 0x20 && code !== 0xffff)
    if (printable) {
      current.push(code)
      continue
    }
    if (current.length >= 3) {
      found.push(Buffer.from(Uint16Array.from(current).buffer).toString('utf16le'))
    }
    current = []
  }
  if (current.length >= 3) {
    found.push(Buffer.from(Uint16Array.from(current).buffer).toString('utf16le'))
  }
  return found
}

// 文件夹通道研究用：只把收到的帧结构写进日志，不落盘、不应答
export class FolderProbe {
  private readonly options: FolderProbeOptions
  private server: Server | null = null
  private readonly active = new Set<Socket>()
  private inbound = 0

  constructor(options: FolderProbeOptions) {
    this.options = options
  }

  get port(): number {
    return this.options.port
  }

  // 已经收到多少条对端连进来的连接，用来判断要不要反过来拨过去
  get inboundCount(): number {
    return this.inbound
  }

  async start(): Promise<void> {
    if (this.server !== null) return
    this.server = await new Promise<Server>((resolve, reject) => {
      const server = createServer((socket) => {
        this.inbound += 1
        this.log(`文件夹通道收到连接 ${socket.remoteAddress}:${socket.remotePort}`)
        this.attach(socket)
      })
      server.once('error', reject)
      server.listen(this.options.port, this.options.bindAddr, () => resolve(server))
    })
    this.log(`文件夹通道探针监听 ${this.options.bindAddr}:${this.options.port}`)
  }

  // 对端等着我们连过去时，用它拨一次对方的文件夹端口
  dial(ip: string, port: number): void {
    const socket = connect({ host: ip, port })
    this.log(`文件夹通道连出 ${ip}:${port}`)
    this.attach(socket)
  }

  stop(): void {
    for (const socket of this.active) socket.destroy()
    this.active.clear()
    this.server?.close()
    this.server = null
  }

  private attach(socket: Socket): void {
    this.active.add(socket)
    socket.on('close', () => this.active.delete(socket))
    socket.on('error', (error) => {
      this.log(`文件夹通道连接错误: ${error.message}`)
      this.active.delete(socket)
    })
    let pending = Buffer.alloc(0)
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      while (pending.length >= FRAME_HEADER_SIZE) {
        const length = pending.readUInt32BE(0)
        if (length < FRAME_HEADER_SIZE || length > MAX_FRAME_BYTES) {
          this.log(`文件夹通道帧长异常 ${length}，丢弃剩余 ${pending.length} 字节`)
          pending = Buffer.alloc(0)
          return
        }
        if (pending.length < length) return
        const frame = pending.subarray(0, length)
        pending = pending.subarray(length)
        this.report(frame)
      }
    })
  }

  private report(frame: Buffer): void {
    const proto = frame.readUInt32BE(4)
    const cmd = frame.readUInt32BE(8)
    const body = frame.subarray(FRAME_HEADER_SIZE)
    this.log(`文件夹通道帧 proto=${proto} cmd=${cmd} 总长=${frame.length} 载荷=${body.length}`)
    this.log(`  载荷头 64 字节 ${body.subarray(0, 64).toString('hex')}`)
    const strings = scanUtf16(body)
    if (strings.length > 0) {
      this.log(`  载荷里的 UTF-16 串: ${strings.join(' | ')}`)
    }
  }

  private log(message: string): void {
    this.options.log(message)
  }
}
