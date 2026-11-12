import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { networkInterfaces } from 'node:os'
import { decodeBeacon } from './beacon'
import { ENET_CMD_CONNECT, decodeDatagram, parseConnectPayload } from './enet'
import type {
  PrivateFileOffer,
  PrivateFolderOffer,
  PrivateImageRef,
  PrivateProfile,
  RemoteProfile
} from './messages'
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
  // 本机私有文件通道的 TCP 监听端口，写进 X_HANDSHARK 的 NET 节点
  filePort?: number
  // 本机私有文件夹通道的 TCP 监听端口，写进 X_HANDSHARK 的 NET 节点
  folderPort?: number
  callbacks: {
    onText(ip: string, msgId: number, text: string, images: PrivateImageRef[]): void
    onUnsupported(ip: string, msgId: number): void
    onAck(ip: string, msgId: number): void
    onReceipt(ip: string, msgId: number): void
    // 对端的 X_HANDSHARK 解析出新资料时触发，与状态推进无关
    onProfile(
      ip: string,
      profile: RemoteProfile,
      filePort: number,
      reversePort: number,
      folderPort: number,
      folderReversePort: number
    ): void
    onFileOffer(ip: string, offer: PrivateFileOffer): void
    onFileOperate(ip: string, cmd: number, taskId: string, op: number): void
    onFileProgress(ip: string, taskId: string, totalSize: number, recvdSize: number): void
    onFileReverse(ip: string, taskId: string): void
    onFolderOffer(ip: string, offer: PrivateFolderOffer): void
    onFolderOperate(ip: string, cmd: number, taskId: string, op: number): void
    onFolderReverse(ip: string, taskId: string): void
    // 已经交给 ENet 的文字重传耗尽，本条消息没有送达
    onSendFailed(ip: string, msgId: number): void
    onState(ip: string, state: SessionState, profile: RemoteProfile | null): void
    // 收到属于某个会话的数据报时先触发，调用方用它刷新联系人活跃时间
    onActivity(ip: string): void
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

// 返回 CONNECT 命令里的 connectID；数据报里没有 CONNECT 或无法解析时返回 null
function connectIdOf(data: Buffer): number | null {
  for (const command of decodeDatagram(data).commands) {
    if ((command.command & COMMAND_MASK) === ENET_CMD_CONNECT) {
      return parseConnectPayload(command.payload).connectId
    }
  }
  return null
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

// 四段点分十进制按数值比较，避免 "10.0.0.10" 与 "10.0.0.9" 之类的字符串误判
function ipToNumber(ip: string): number {
  return ip.split('.').reduce((value, part) => value * 256 + Number(part), 0)
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
  // 键是远端 IP；同一 IP 只保留一个会话，对端 ENet 端口记录在 peerPorts 里供建立会话与同时发起比较使用
  private readonly sessions = new Map<string, PrivateSession>()
  private readonly peerPorts = new Map<string, number>()
  private readonly peerProfiles = new Map<string, RemoteProfile>()
  // 对端 X_HANDSHARK 里公布的私有文件通道 TCP 端口
  private readonly peerFilePorts = new Map<string, number>()
  private readonly peerReversePorts = new Map<string, number>()
  private readonly peerFolderPorts = new Map<string, number>()
  private readonly peerFolderReversePorts = new Map<string, number>()

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
    if (!isValidIpv4(this.localIp)) {
      throw new Error(`本机地址格式错误: ${this.localIp}`)
    }

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
      this.createSession('client', seed.ip, port)?.start()
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
    const session = this.ensureSession(ip)
    if (session === null) return false
    return session.sendText(msgId, text)
  }

  // 会话缺失、已关闭或还没就绪时补一次客户端发起，避免对端重启后通道一直空着
  ensureSession(ip: string): PrivateSession | null {
    const existing = this.sessions.get(ip)
    if (existing !== undefined && existing.state === 'closed') {
      this.sessions.delete(ip)
    } else if (existing !== undefined) {
      return existing
    }
    const port = this.peerPorts.get(ip)
    if (port === undefined) return null
    const session = this.createSession('client', ip, port)
    session?.start()
    return session
  }

  sendReceipt(ip: string, msgId: number): void {
    const session = this.sessions.get(ip)
    if (session === undefined) {
      this.log(`没有到 ${ip} 的私有会话，无法发送已读回执 ${msgId}`)
      return
    }
    session.sendReceipt(msgId)
  }

  sendFileOffer(
    ip: string,
    input: { taskId: string; fileId: number; name: string; size: number; lastModify: string }
  ): boolean {
    return this.sessions.get(ip)?.sendFileOffer(input) ?? false
  }

  sendFolderOffer(
    ip: string,
    input: { taskId: string; name: string; size: number; maxItemPath: number; maxItemSize: number }
  ): boolean {
    return this.sessions.get(ip)?.sendFolderOffer(input) ?? false
  }

  sendOperateSendFile(ip: string, taskId: string, op: number): void {
    this.sessions.get(ip)?.sendOperateSendFile(taskId, op)
  }

  sendOperateRecvFile(ip: string, taskId: string, op: number): void {
    this.sessions.get(ip)?.sendOperateRecvFile(taskId, op)
  }

  sendOperateSendFolder(ip: string, taskId: string, op: number): void {
    this.sessions.get(ip)?.sendOperateSendFolder(taskId, op)
  }

  sendOperateRecvFolder(ip: string, taskId: string, op: number): void {
    this.sessions.get(ip)?.sendOperateRecvFolder(taskId, op)
  }

  sendReverseFolderReq(ip: string, taskId: string): void {
    this.sessions.get(ip)?.sendReverseFolderReq(taskId)
  }

  sendProgressRecvFile(ip: string, taskId: string, totalSize: number, recvdSize: number): void {
    this.sessions.get(ip)?.sendProgressRecvFile(taskId, totalSize, recvdSize)
  }

  sendReverseFileReq(ip: string, taskId: string): void {
    this.sessions.get(ip)?.sendReverseFileReq(taskId)
  }

  sendRetrieveImages(ip: string, msgId: number, refs: PrivateImageRef[]): void {
    this.sessions.get(ip)?.sendRetrieveImages(msgId, refs)
  }

  sendImageCard(ip: string, msgId: number, value: string): boolean {
    return this.sessions.get(ip)?.sendImageCard(msgId, value) ?? false
  }

  // 对端公布的文件通道端口；0 表示没收到或没公布
  peerFilePort(ip: string): number {
    return this.peerFilePorts.get(ip) ?? 0
  }

  // 对端公布的反向文件端口，直连不通时发送方按它反过来连接
  peerReversePort(ip: string): number {
    return this.peerReversePorts.get(ip) ?? 0
  }

  // 对端公布的文件夹通道端口；0 表示对端不接收文件夹
  peerFolderPort(ip: string): number {
    return this.peerFolderPorts.get(ip) ?? 0
  }

  peerFolderReversePort(ip: string): number {
    return this.peerFolderReversePorts.get(ip) ?? 0
  }

  peerUserId(ip: string): string {
    return this.peerProfiles.get(ip)?.userId ?? ''
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
    // 会话存在时每个入站数据报都算活跃，心跳和重传都包括在内
    if (this.sessions.has(rinfo.address)) {
      this.options.callbacks.onActivity(rinfo.address)
    }
    const existing = this.sessions.get(rinfo.address)
    const connectId = this.readConnectId(data, rinfo)
    if (existing !== undefined && connectId === null) {
      existing.receive(data)
      return
    }
    if (existing !== undefined && existing.state === 'connecting') {
      // 双方同时发起时按确定性规则只保留一个方向：本机地址更大的一方接管接收侧，
      // 另一方忽略这条 CONNECT，继续等待对端应答自己的出站连接
      if (!this.shouldTakeOver(rinfo.address, rinfo.port)) {
        this.log(`与 ${rinfo.address} 同时发起连接，本端保留出站会话，忽略对方 CONNECT`)
        return
      }
      existing.close()
      this.createSession('server', rinfo.address, rinfo.port)?.receive(data)
      return
    }
    if (existing !== undefined) {
      // 对端重发同一条 CONNECT 不等于重连：会话已就绪时不再重建，避免打乱双方序号
      if (existing.connectIdentifier === connectId) {
        existing.receive(data)
        return
      }
      if (!this.shouldTakeOver(rinfo.address, rinfo.port)) {
        this.log(
          `对端 ${rinfo.address} 用新的连接标识 ${connectId} 重新连接，本端按规则保留现有会话，忽略`
        )
        return
      }
      this.log(`对端 ${rinfo.address} 用新的连接标识 ${connectId} 重新连接，重建会话`)
      existing.close()
      this.createSession('server', rinfo.address, rinfo.port)?.receive(data)
      return
    }
    if (connectId === null) {
      this.log(`忽略来自未知对端 ${rinfo.address}:${rinfo.port} 的数据报`)
      return
    }
    this.createSession('server', rinfo.address, rinfo.port)?.receive(data)
  }

  private readConnectId(data: Buffer, rinfo: RemoteInfo): number | null {
    try {
      return connectIdOf(data)
    } catch (error) {
      if (!this.sessions.has(rinfo.address)) {
        this.log(
          `忽略来自 ${rinfo.address}:${rinfo.port} 的无法解析数据报: ${describeError(error)}`
        )
      }
      return null
    }
  }

  private shouldTakeOver(remoteIp: string, remotePort: number): boolean {
    const local = ipToNumber(this.localIp)
    const remote = ipToNumber(remoteIp)
    if (local !== remote) return local > remote
    return this.boundEnetPort > remotePort
  }

  private handleBeaconMessage(data: Buffer, rinfo: RemoteInfo): void {
    const beacon = decodeBeacon(data)
    if (beacon === null) {
      this.log(`忽略来自 ${rinfo.address}:${rinfo.port} 的非法发现报文`)
      return
    }
    if (!DISCOVERY_BEACON_TYPES.includes(beacon.type) || beacon.enetPort <= 0) return
    const ip = rinfo.address
    if (this.sessions.has(ip)) return
    this.createSession('client', ip, beacon.enetPort)?.start()
  }

  private createSession(
    role: 'client' | 'server',
    ip: string,
    port?: number
  ): PrivateSession | null {
    const remotePort = port ?? this.peerPorts.get(ip)
    if (remotePort === undefined) {
      this.reportError(new Error(`缺少对端 ${ip} 的 ENet 端口`))
      return null
    }
    let session: PrivateSession
    const callbacks: SessionCallbacks = {
      onText: (msgId, text, images) => this.options.callbacks.onText(ip, msgId, text, images),
      onUnsupported: (msgId) => this.options.callbacks.onUnsupported(ip, msgId),
      onAck: (msgId) => this.options.callbacks.onAck(ip, msgId),
      onReceipt: (msgId) => this.options.callbacks.onReceipt(ip, msgId),
      onProfile: (profile, filePort, reversePort, folderPort, folderReversePort) => {
        this.peerProfiles.set(ip, profile)
        if (filePort > 0) {
          this.peerFilePorts.set(ip, filePort)
        }
        if (reversePort > 0) {
          this.peerReversePorts.set(ip, reversePort)
        }
        if (folderPort > 0) {
          this.peerFolderPorts.set(ip, folderPort)
        }
        if (folderReversePort > 0) {
          this.peerFolderReversePorts.set(ip, folderReversePort)
        }
        this.options.callbacks.onProfile(
          ip,
          profile,
          filePort,
          reversePort,
          folderPort,
          folderReversePort
        )
      },
      onFileOffer: (offer) => this.options.callbacks.onFileOffer(ip, offer),
      onFileOperate: (cmd, taskId, op) => this.options.callbacks.onFileOperate(ip, cmd, taskId, op),
      onFileProgress: (taskId, totalSize, recvdSize) =>
        this.options.callbacks.onFileProgress(ip, taskId, totalSize, recvdSize),
      onFileReverse: (taskId) => this.options.callbacks.onFileReverse(ip, taskId),
      onFolderOffer: (offer) => this.options.callbacks.onFolderOffer(ip, offer),
      onFolderOperate: (cmd, taskId, op) =>
        this.options.callbacks.onFolderOperate(ip, cmd, taskId, op),
      onFolderReverse: (taskId) => this.options.callbacks.onFolderReverse(ip, taskId),
      onSendFailed: (msgId) => this.options.callbacks.onSendFailed(ip, msgId),
      onState: (state) => this.handleState(ip, state, session),
      onLog: (message) => this.options.callbacks.onLog(message)
    }
    try {
      session = new PrivateSession({
        role,
        remoteIp: ip,
        remotePort,
        localIp: this.localIp,
        localPort: this.boundEnetPort,
        identity: this.options.identity,
        profile: this.profile,
        filePort: this.options.filePort,
        folderPort: this.options.folderPort,
        send: (data) => this.sendRaw(ip, remotePort, data),
        callbacks
      })
    } catch (error) {
      this.reportError(error instanceof Error ? error : new Error(String(error)))
      return null
    }
    this.sessions.set(ip, session)
    this.peerPorts.set(ip, remotePort)
    return session
  }

  private handleState(ip: string, state: SessionState, session: PrivateSession | null): void {
    if (state === 'closed' && session !== null && this.sessions.get(ip) === session) {
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
