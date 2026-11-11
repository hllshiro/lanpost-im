import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { decodeBeacon } from './beacon'
import { ENET_CMD_CONNECT, decodeDatagram } from './enet'
import type { PrivateProfile, RemoteProfile } from './messages'
import { PrivateSession, type SessionCallbacks, type SessionState } from './session'

const COMMAND_MASK = 0x7f
const DEFAULT_ENET_PORT = 9012
const PUMP_INTERVAL_MS = 200
const DISCOVERY_BEACON_TYPES = [1, 2]

export interface PrivateServiceOptions {
  identity: { userId: string; peerId: Buffer }
  profile: PrivateProfile
  bindAddr: string
  beaconPort: number
  enetPort: number
  localIp?: string
  seeds: Array<{ ip: string; port?: number }>
  callbacks: {
    onText(ip: string, msgId: number, text: string): void
    onUnsupported(ip: string, msgId: number): void
    onAck(ip: string, msgId: number): void
    onReceipt(ip: string, msgId: number): void
    onState(ip: string, state: SessionState, profile: PrivateProfile | null): void
    onLog(message: string): void
    onError(error: Error): void
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function detectLocalIp(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return '0.0.0.0'
}

function hasConnectCommand(data: Buffer): boolean {
  return decodeDatagram(data).commands.some(
    (command) => (command.command & COMMAND_MASK) === ENET_CMD_CONNECT
  )
}

function bindSocket(socket: Socket, port: number, address: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      socket.off('error', onError)
      reject(error)
    }
    socket.once('error', onError)
    socket.bind(port, address, () => {
      socket.off('error', onError)
      resolve()
    })
  })
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.close(() => resolve())
  })
}

export class PrivateService {
  private readonly options: PrivateServiceOptions
  private profile: PrivateProfile
  private localIp = ''
  private enet: Socket | null = null
  private discovery: Socket | null = null
  private pumpTimer: ReturnType<typeof setInterval> | null = null
  private boundEnetPort = 0
  private running = false
  // 键是远端 IP；同一 IP 只保留一个会话，对端 ENet 端口记录在 peerPorts 里供建立会话时取用
  private readonly sessions = new Map<string, PrivateSession>()
  private readonly peerPorts = new Map<string, number>()
  private readonly peerProfiles = new Map<string, RemoteProfile>()

  constructor(options: PrivateServiceOptions) {
    this.options = options
    this.profile = options.profile
  }

  get localEnetPort(): number {
    return this.boundEnetPort
  }

  async start(): Promise<void> {
    if (this.running) {
      throw new Error('私有通道服务已经启动')
    }
    this.localIp = this.options.localIp ?? detectLocalIp()

    const enet = createSocket('udp4')
    try {
      await bindSocket(enet, this.options.enetPort, this.options.bindAddr)
    } catch (error) {
      enet.close()
      throw error
    }
    this.boundEnetPort = enet.address().port
    enet.on('message', (data, rinfo) => this.handleEnetMessage(data, rinfo))
    enet.on('error', (error) => this.reportError(error))
    this.enet = enet

    if (this.options.beaconPort > 0) {
      const discovery = createSocket('udp4')
      let bound = true
      try {
        await bindSocket(discovery, this.options.beaconPort, this.options.bindAddr)
      } catch (error) {
        bound = false
        this.log(
          `发现端口 ${this.options.beaconPort} 绑定失败，私有通道只走种子与对端主动连接: ${describeError(error)}`
        )
      }
      if (bound) {
        discovery.on('message', (data, rinfo) => this.handleBeaconMessage(data, rinfo))
        discovery.on('error', (error) => this.reportError(error))
        this.discovery = discovery
      } else {
        discovery.close()
      }
    }

    for (const seed of this.options.seeds) {
      if (this.sessions.has(seed.ip)) continue
      const port = seed.port ?? DEFAULT_ENET_PORT
      this.peerPorts.set(seed.ip, port)
      this.createSession('client', seed.ip, port).start()
    }

    this.pumpTimer = setInterval(() => this.pump(), PUMP_INTERVAL_MS)
    this.running = true
  }

  async stop(): Promise<void> {
    if (this.pumpTimer !== null) {
      clearInterval(this.pumpTimer)
      this.pumpTimer = null
    }
    const closing: Array<Promise<void>> = []
    const sessions = Array.from(this.sessions.values())
    this.sessions.clear()
    for (const session of sessions) {
      session.close()
    }
    const enet = this.enet
    const discovery = this.discovery
    this.enet = null
    this.discovery = null
    this.running = false
    if (enet !== null) closing.push(closeSocket(enet))
    if (discovery !== null) closing.push(closeSocket(discovery))
    await Promise.all(closing)
  }

  sendText(ip: string, msgId: number, text: string): boolean {
    const session = this.sessions.get(ip)
    if (session === undefined) return false
    return session.sendText(msgId, text)
  }

  sendReceipt(ip: string, msgId: number): void {
    const session = this.sessions.get(ip)
    if (session === undefined) {
      this.log(`没有到 ${ip} 的私有会话，无法发送已读回执 ${msgId}`)
      return
    }
    session.sendReceipt(msgId)
  }

  isReady(ip: string): boolean {
    return this.sessions.get(ip)?.state === 'ready'
  }

  updateProfile(profile: PrivateProfile): void {
    this.profile = profile
  }

  private pump(): void {
    for (const session of Array.from(this.sessions.values())) {
      session.pump()
    }
  }

  private handleEnetMessage(data: Buffer, rinfo: RemoteInfo): void {
    const existing = this.sessions.get(rinfo.address)
    if (existing !== undefined && existing.state !== 'connecting') {
      existing.receive(data)
      return
    }
    if (!this.isConnectDatagram(data, rinfo)) {
      if (existing !== undefined) {
        existing.receive(data)
      } else {
        this.log(`忽略来自未知对端 ${rinfo.address}:${rinfo.port} 的数据报`)
      }
      return
    }
    // 双方同时发起时由接收侧接管：关闭仍在连接中的出站会话，改用服务端角色应答
    existing?.close()
    this.peerPorts.set(rinfo.address, rinfo.port)
    this.createSession('server', rinfo.address, rinfo.port).receive(data)
  }

  private isConnectDatagram(data: Buffer, rinfo: RemoteInfo): boolean {
    try {
      return hasConnectCommand(data)
    } catch (error) {
      if (!this.sessions.has(rinfo.address)) {
        this.log(
          `忽略来自 ${rinfo.address}:${rinfo.port} 的无法解析数据报: ${describeError(error)}`
        )
      }
      return false
    }
  }

  private handleBeaconMessage(data: Buffer, rinfo: RemoteInfo): void {
    const beacon = decodeBeacon(data)
    if (beacon === null) {
      this.log(`忽略来自 ${rinfo.address}:${rinfo.port} 的非法发现报文`)
      return
    }
    if (!DISCOVERY_BEACON_TYPES.includes(beacon.type) || beacon.enetPort <= 0) return
    const ip = rinfo.address
    this.peerPorts.set(ip, beacon.enetPort)
    if (this.sessions.has(ip)) return
    this.createSession('client', ip).start()
  }

  private createSession(role: 'client' | 'server', ip: string, port?: number): PrivateSession {
    const remotePort = port ?? this.peerPorts.get(ip)
    if (remotePort === undefined) {
      throw new Error(`缺少对端 ${ip} 的 ENet 端口`)
    }
    const callbacks: SessionCallbacks = {
      onText: (msgId, text) => this.options.callbacks.onText(ip, msgId, text),
      onUnsupported: (msgId) => this.options.callbacks.onUnsupported(ip, msgId),
      onAck: (msgId) => this.options.callbacks.onAck(ip, msgId),
      onReceipt: (msgId) => this.options.callbacks.onReceipt(ip, msgId),
      onProfile: (profile) => this.peerProfiles.set(ip, profile),
      onState: (state) => this.handleState(ip, state, session),
      onLog: (message) => this.options.callbacks.onLog(message)
    }
    const session = new PrivateSession({
      role,
      remoteIp: ip,
      remotePort,
      localIp: this.localIp,
      localPort: this.boundEnetPort,
      identity: this.options.identity,
      profile: this.profile,
      send: (data) => this.sendRaw(ip, remotePort, data),
      callbacks
    })
    this.sessions.set(ip, session)
    return session
  }

  private handleState(ip: string, state: SessionState, session: PrivateSession): void {
    if (state === 'closed' && this.sessions.get(ip) === session) {
      this.sessions.delete(ip)
    }
    this.options.callbacks.onState(ip, state, this.peerProfiles.get(ip) ?? null)
  }

  private sendRaw(ip: string, port: number, data: Buffer): void {
    const socket = this.enet
    if (socket === null) {
      this.log(`私有通道已停止，丢弃发往 ${ip}:${port} 的 ${data.length} 字节数据报`)
      return
    }
    socket.send(data, port, ip, (error) => {
      if (error !== null) this.reportError(error)
    })
  }

  private reportError(error: Error): void {
    this.log(`私有通道 socket 错误: ${describeError(error)}`)
    this.options.callbacks.onError(error)
  }

  private log(message: string): void {
    this.options.callbacks.onLog(message)
  }
}
