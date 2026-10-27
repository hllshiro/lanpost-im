import { mkdirSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { ProtocolEngine, toPeerInfo, type ProtocolPeer } from './protocol/engine'
import { FILE_ATTR_REGULAR, type Attachment } from './protocol/attach'
import { EXT_MTIME } from './protocol/commands'
import { FileManager } from './files/manager'
import type { FileKind, FileState, FileTaskInfo, MessageMeta } from './types'

export interface IpmsgConfig {
  name: string
  account: string
  host: string
  status?: number
  port: number
  bindAddr?: string
  seeds?: string[]
  broadcastInterval?: number
  receiveDir: string
  autoAccept?: boolean
}

export interface IpmsgPeer {
  key: string
  ip: string
  port: number
  account: string
  host: string
  name: string
  status: number
  online: boolean
  lastSeen: number
  capUtf8: boolean
}

export interface IpmsgText {
  peerKey: string
  text: string
  seq: number
  utf8: boolean
}

export interface IpmsgFile {
  id: string
  peerKey: string
  direction: 'in' | 'out'
  kind: FileKind
  name: string
  size: number
  path: string
  state: FileState
  received: number
  error: string
}

export type IpmsgDeliveryStatus = 'delivered' | 'read' | 'failed'

export interface IpmsgCallbacks {
  onPeers(peers: IpmsgPeer[]): void
  onText(text: IpmsgText): void
  onTextStatus(peerKey: string, seq: number, status: IpmsgDeliveryStatus): void
  onFile(file: IpmsgFile): void
  onLog(message: string): void
  onError(error: Error): void
}

function toIpmsgPeer(peer: ProtocolPeer): IpmsgPeer {
  return {
    key: peer.key,
    ip: peer.ip,
    port: peer.port,
    account: peer.user,
    host: peer.host,
    name: peer.name,
    status: peer.status,
    online: peer.online,
    lastSeen: peer.lastSeen,
    capUtf8: peer.capUtf8
  }
}

function toIpmsgFile(file: FileTaskInfo): IpmsgFile {
  return {
    id: file.id,
    peerKey: file.peerKey ?? '',
    direction: file.direction,
    kind: file.kind,
    name: file.name,
    size: file.size,
    path: file.path,
    state: file.state,
    received: file.received,
    error: file.error
  }
}

export class IpmsgTransport {
  private readonly config: Required<Omit<IpmsgConfig, 'status'>> & { status: number }
  private readonly callbacks: IpmsgCallbacks
  private engine: ProtocolEngine | null = null
  private files: FileManager | null = null
  private started = false
  private fileSeq = Math.floor(Date.now() / 1000) >>> 0
  private requestSeq = Math.floor(Date.now() / 1000) >>> 0

  constructor(config: IpmsgConfig, callbacks: IpmsgCallbacks) {
    this.config = {
      ...config,
      status: config.status ?? 0,
      bindAddr: config.bindAddr ?? '0.0.0.0',
      seeds: config.seeds ?? [],
      broadcastInterval: config.broadcastInterval ?? 30,
      autoAccept: config.autoAccept ?? true
    }
    this.callbacks = callbacks
  }

  async start(): Promise<void> {
    if (this.started) throw new Error('IPMSG transport 已经启动')
    mkdirSync(this.config.receiveDir, { recursive: true })

    let engine: ProtocolEngine | null = null
    const files = new FileManager({
      bindAddr: this.config.bindAddr,
      port: this.config.port,
      receiveDir: this.config.receiveDir,
      receiveLayout: 'flat',
      notifyAccepted: (peerKey, packetId) => engine?.sendFileAccept(peerKey, packetId),
      notifyReleased: (peerKey, packetId, fileIds) =>
        engine?.releaseFiles(peerKey, packetId, fileIds),
      identity: () => ({
        user: this.config.account,
        host: this.config.host,
        seq: (this.requestSeq = (this.requestSeq + 1) >>> 0)
      }),
      callbacks: {
        onUpdate: (file) => this.callbacks.onFile(toIpmsgFile(file)),
        onLog: (message) => this.callbacks.onLog(message),
        onError: (error) => this.callbacks.onError(error)
      }
    })

    engine = new ProtocolEngine(
      {
        name: this.config.name,
        account: this.config.account,
        host: this.config.host,
        group: '',
        status: this.config.status,
        port: this.config.port,
        bindAddr: this.config.bindAddr,
        subnets: [],
        seeds: this.config.seeds,
        broadcastInterval: this.config.broadcastInterval
      },
      {
        onPeers: (peers) => this.callbacks.onPeers(peers.map(toIpmsgPeer)),
        onMessage: (peer, text, seq, meta: MessageMeta) =>
          this.callbacks.onText({
            peerKey: peer.key,
            text,
            seq,
            utf8: (meta.flags?.broadcast ?? false) || peer.capUtf8
          }),
        onMessageStatus: (peerKey, seq, status) =>
          this.callbacks.onTextStatus(peerKey, seq, status),
        onFileOffer: (peer, packetId, _text, attachments, utf8) => {
          const created = files.offerIncoming({
            peerKey: peer.key,
            peerName: peer.name,
            peerIp: peer.ip,
            peerPort: peer.port,
            packetId,
            attachments,
            kind: 'file',
            utf8
          })
          if (!this.config.autoAccept) return
          for (const task of created) {
            void files.accept(task.id).catch((error: unknown) =>
              this.callbacks.onError(error instanceof Error ? error : new Error(String(error)))
            )
          }
        },
        onFileRelease: (peerKey, packetId, fileIds) =>
          files.markReleased(packetId, fileIds),
        onNwtFileCancel: (peerKey, payload) =>
          files.releaseByNwtPayload(peerKey, payload),
        onLog: (message) => this.callbacks.onLog(message),
        onError: (error) => this.callbacks.onError(error)
      }
    )

    this.files = files
    this.engine = engine
    await files.start()
    try {
      await engine.start()
      this.started = true
    } catch (error) {
      await files.stop()
      this.files = null
      this.engine = null
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    const engine = this.engine
    const files = this.files
    this.engine = null
    this.files = null
    await engine?.stop()
    await files?.stop()
  }

  getPeers(): IpmsgPeer[] {
    return this.engine?.getPeers().map(toIpmsgPeer) ?? []
  }

  sendText(peerKey: string, text: string): number {
    if (this.engine === null) throw new Error('IPMSG transport 尚未启动')
    return this.engine.sendText(peerKey, text)
  }

  async sendFile(peerKey: string, path: string): Promise<string> {
    if (this.engine === null || this.files === null) {
      throw new Error('IPMSG transport 尚未启动')
    }
    const peer = this.engine.getPeers().find((item) => item.key === peerKey)
    if (peer === undefined) throw new Error(`未知联系人: ${peerKey}`)
    const stats = statSync(path)
    if (!stats.isFile()) throw new Error('Phase 0 只支持发送普通文件')
    const fileId = (this.fileSeq = (this.fileSeq + 1) >>> 0)
    const mtime = Math.floor(stats.mtimeMs / 1000)
    const attachment: Attachment = {
      id: fileId,
      name: basename(path),
      size: stats.size,
      mtime,
      attr: FILE_ATTR_REGULAR,
      ext: { [EXT_MTIME]: mtime.toString(16) }
    }
    const packetId = this.engine.sendFileOffer(peerKey, '', [attachment])
    const task = this.files.addOutgoing({
      peerKey,
      peerIp: peer.ip,
      peerPort: peer.port,
      name: attachment.name,
      size: attachment.size,
      mtime,
      fileId,
      packetId,
      path,
      kind: 'file',
      utf8: peer.capUtf8
    })
    return task.id
  }

  acceptFile(id: string): void {
    void this.files?.accept(id).catch((error: unknown) =>
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)))
    )
  }

  rejectFile(id: string): void {
    this.files?.reject(id)
  }

  cancelFile(id: string): void {
    this.files?.cancel(id)
  }
}

export { toPeerInfo }
export type { Attachment }
