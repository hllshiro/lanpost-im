import { randomBytes, createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import {
  app,
  clipboard,
  dialog,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AppEvent,
  AppSnapshot,
  FileTaskInfo,
  MessageInfo,
  MessagesPage,
  SendTextResult,
  StagedAttachment
} from '../shared/domain'
import type {
  AppInfo,
  MessagesListRequest,
  MessagesSendRequest,
  StagePathsResult
} from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { ProtocolEngine, toPeerInfo, type ProtocolPeer } from './protocol/discovery'
import { FILE_ATTR_REGULAR, type Attachment } from './protocol/attach'
import type { PrivateFileOffer, PrivateImageRef } from './protocol/private/messages'
import type { PrivateProfile, RemoteProfile } from './protocol/private/messages'
import {
  nextPrivateSeq,
  outstandingToFail,
  receiptsToSend,
  shouldUsePrivate
} from './protocol/private/route'
import { PrivateService } from './protocol/private/service'
import type { SessionState } from './protocol/private/session'
import { fileTimeFromMs } from './protocol/private/messages'
import { FileManager } from './files/manager'
import { PrivateFolderTransfer, type OutgoingFolder } from './files/folder-transfer'
import { scanFolder } from './files/folder-info'
import { PrivateFileTransfer } from './files/private-transfer'
import { StagedStore, type StagedSource } from './files/staged'
import { sanitizeFileName, uniqueName } from './files/names'
import { NotificationManager } from './notify/manager'
import { createRepositories, directConversationId, type Repositories } from './store/repositories'
import { importLegacyHistory } from './store/import'
import type { SettingsStore } from './settings/store'
import { createPrivateId, privateUserId } from './identity'
import { logStartup } from './startup-log'

function engineConfig(settings: Settings): ConstructorParameters<typeof ProtocolEngine>[0] {
  return {
    name: settings.identity.displayName,
    account: settings.identity.account,
    host: settings.identity.hostName,
    group: settings.identity.group,
    corporation: settings.identity.corporation,
    department: settings.identity.department,
    sign: settings.identity.sign,
    status: settings.identity.status,
    port: settings.network.port,
    bindAddr: settings.network.bindAddr,
    subnets: settings.network.subnets,
    seeds: settings.network.seeds,
    broadcastInterval: settings.network.broadcastInterval
  }
}

function privateProfile(settings: Settings): PrivateProfile {
  return {
    name: settings.identity.displayName,
    group: settings.identity.group,
    corporation: settings.identity.corporation,
    department: settings.identity.department,
    sign: settings.identity.sign,
    status: settings.identity.status
  }
}

// 私有通道种子地址写成 IP 或 IP:端口，端口留空时由服务用默认 ENet 端口
function parsePrivateSeed(value: string): { ip: string; port?: number } | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  const colon = trimmed.lastIndexOf(':')
  const ip = colon >= 0 ? trimmed.slice(0, colon) : trimmed
  if (!isIPv4(ip)) {
    return null
  }
  if (colon < 0) {
    return { ip }
  }
  const port = Number(trimmed.slice(colon + 1))
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? { ip, port } : null
}

function privateSeeds(settings: Settings): Array<{ ip: string; port?: number }> {
  const seeds: Array<{ ip: string; port?: number }> = []
  for (const value of settings.network.privateSeeds) {
    const seed = parsePrivateSeed(value)
    if (seed === null) {
      if (value.trim() !== '') {
        logStartup(`忽略无法解析的私有通道种子地址: ${value}`)
      }
      continue
    }
    seeds.push(seed)
  }
  return seeds
}

// 交给私有通道后等 1005/1006 的期限；超时按发送失败处理，由用户重试
const PRIVATE_SEND_TIMEOUT_MS = 30_000
const PRIVATE_SEND_SWEEP_MS = 1000

const IMAGE_PATH = /\.(png|jpe?g|gif|bmp|webp|avif|tiff?)$/i

function imageExtension(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/bmp':
      return 'bmp'
    case 'image/webp':
      return 'webp'
    default:
      return 'png'
  }
}

function isImagePath(path: string): boolean {
  return IMAGE_PATH.test(path)
}

// 图片卡片里的 md5 用于对端判断缓存命中；只对图片计算，且限制大小
function fileMd5(path: string): string {
  const stats = statSync(path)
  if (stats.size > 32 * 1024 * 1024) {
    return ''
  }
  return createHash('md5').update(readFileSync(path)).digest('hex')
}

function localIpv4(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) return entry.address
    }
  }
  return '127.0.0.1'
}

interface OutstandingPrivateSend {
  ip: string
  conversationId: string
  msgId: number
  sentAt: number
}

interface PrivateIncomingFile {
  taskId: string
  fileId: number
  ip: string
  fileTaskId: string
  name: string
  size: number
  saveDir: string
  savePath: string
  peerUserId: string
  // 用户（或自动接收）已经同意；对端宣布开始（1010）后才真正去连
  accepted: boolean
  startSignaled: boolean
  started: boolean
}

export class AppService {
  private readonly repos: Repositories
  private readonly engine: ProtocolEngine
  private readonly fileManager: FileManager
  private readonly notifications: NotificationManager
  private readonly receiveDir: string
  private window: BrowserWindow | null = null
  private started = false
  private filesStarted = false
  private privateService: PrivateService | null = null
  private privateFiles: PrivateFileTransfer | null = null
  private readonly privateFileTasks = new Map<
    number,
    { fileTaskId: string; direction: 'in' | 'out'; taskId: string; ip: string }
  >()
  private readonly privateIncomingFiles = new Map<string, PrivateIncomingFile>()
  // 图片消息里的文件号 → 消息 id，图片收到后挂到这条消息上
  private readonly privateImageMessages = new Map<number, number>()
  // 只发了卡片的图片：等对端发 1019 来要，再用窗口通道推过去
  private readonly privateImagePushes = new Map<number, { ip: string; taskId: string }>()
  // 文件夹通道的研究探针：只记录收到的帧结构
  private privateFolders: PrivateFolderTransfer | null = null
  private readonly folderOutgoing = new Map<string, OutgoingFolder>()
  private readonly privateTaskIds = new Map<string, number>()
  // 已经因 1019 反向请求开始推数据的文件，避免重复连接
  private readonly privateReverseStarted = new Set<number>()
  private privateSeq = 0
  // 已经发过已读回执的消息 id，避免每次 markRead 重复发送
  private readonly privateReceipts = new Set<number>()
  // 交给私有通道、还在等 1005/1006 的消息，键是私有消息号
  private readonly privateOutstanding = new Map<number, OutstandingPrivateSend>()
  private privateSweep: ReturnType<typeof setInterval> | null = null
  private fileSeq = 0
  private fileRequestSeq = Math.floor(Date.now() / 1000) >>> 0
  private readonly fileLinks = new Map<string, { conversationId: string; messageId: number }>()
  // 待发区：粘贴的图片和选中的文件都在这里等发送
  private readonly staged = new StagedStore()

  constructor(
    private readonly db: DatabaseSync,
    private readonly settings: SettingsStore,
    private readonly appInfo: AppInfo
  ) {
    this.repos = createRepositories(db)
    let receiveDir = settings.get().files.receiveDir
    if (receiveDir === '') {
      const downloads = join(app.getPath('downloads'), '内网传书')
      try {
        mkdirSync(downloads, { recursive: true })
        receiveDir = downloads
      } catch {
        receiveDir = join(app.getPath('userData'), 'recv')
        logStartup(`下载目录不可写，接收目录改为 ${receiveDir}`)
      }
    }
    this.receiveDir = receiveDir
    this.fileManager = new FileManager({
      bindAddr: settings.get().network.bindAddr,
      port: settings.get().network.port,
      receiveDir,
      notifyAccepted: (peerKey, packetId) => this.engine.sendFileAccept(peerKey, packetId),
      identity: () => ({
        user: this.settings.get().identity.account,
        host: this.settings.get().identity.hostName,
        seq: (this.fileRequestSeq = (this.fileRequestSeq + 1) >>> 0)
      }),
      callbacks: {
        onUpdate: (file) => this.handleFileUpdate(file),
        onLog: (message) => logStartup('files: ' + message),
        onError: (error) => logStartup('files error: ' + error.message)
      }
    })
    this.engine = new ProtocolEngine(
      engineConfig(settings.get()),
      {
        onPeers: (peers) => this.handlePeers(peers),
        onMessage: (peer, text, remoteSeq) =>
          this.handleIncoming(peer.key, peer.name, text, remoteSeq),
        onFileOffer: (peer, packetId, text, attachments) =>
          this.handleFileOffer(peer, packetId, text, attachments),
        onMessageStatus: (peerKey, seq, status) => this.handleStatus(peerKey, seq, status),
        onLog: (message) => logStartup('protocol: ' + message),
        onError: (error) => logStartup('protocol error: ' + error.message)
      },
      this.repos.peers.list().map((peer) => ({
        key: peer.key,
        ip: peer.ip,
        lastSeen: peer.lastSeen
      }))
    )
    this.notifications = new NotificationManager(settings, () => this.window)
  }

  attachWindow(window: BrowserWindow | null): void {
    this.window = window
  }

  async start(): Promise<void> {
    this.importLegacyHistory()
    this.ensurePrivateId()
    if (this.settings.get().network.ipmsg) {
      try {
        await this.fileManager.start()
        this.filesStarted = true
      } catch (error) {
        logStartup('file service start failed: ' + (error as Error).message)
      }
      await this.engine.start()
    } else {
      logStartup('IPMSG 兼容层已关闭，仅使用内网通私有协议')
    }
    this.started = true
    await this.startPrivateService()
    this.handlePeers(this.engine.getPeers())
    this.notifications.setUnread(this.unreadTotal())
  }

  // 私有通道的用户标识首次运行时生成并写进设置，之后一直沿用；
  // 数据目录只读时写不进去不影响本次运行，privateUserId 会按账号与主机名派生
  private ensurePrivateId(): void {
    if (this.settings.get().identity.privateId !== '') {
      return
    }
    try {
      this.settings.update({ identity: { privateId: createPrivateId() } })
    } catch (error) {
      logStartup('private id save failed: ' + (error as Error).message)
    }
  }

  // 私有通道失败只影响私有收发，IPMSG 依旧按原路径工作
  private async startPrivateService(): Promise<void> {
    try {
      const settings = this.settings.get()
      const userId = privateUserId(settings)
      const profile = privateProfile(settings)
      const filePort = settings.network.privateFilePort
      const transfer = new PrivateFileTransfer({
        bindAddr: settings.network.bindAddr,
        port: filePort,
        localUserId: userId,
        localIp: localIpv4(),
        localName: profile.name,
        callbacks: {
          onProgress: (fileId, received) => this.handlePrivateFileProgress(fileId, received),
          onDone: (fileId, path) => this.handlePrivateFileDone(fileId, path),
          onError: (fileId, error) => this.handlePrivateFileError(fileId, error)
        },
        onLog: (message) => logStartup('private files: ' + message)
      })
      await transfer.start()
      this.privateFiles = transfer
      const folderPort = await this.startPrivateFolders(
        settings.network.privateFolderPort,
        settings.network.bindAddr
      )
      const service = new PrivateService({
        identity: { userId, peerId: randomBytes(16) },
        profile,
        bindAddr: settings.network.bindAddr,
        beaconPort: settings.network.privatePort,
        enetPort: 0,
        filePort,
        folderPort,
        seeds: privateSeeds(settings),
        callbacks: {
          onText: (ip, msgId, text, images) => this.handlePrivateText(ip, msgId, text, images),
          onUnsupported: (ip, msgId) => logStartup(`私有通道收到暂不支持的消息 ${msgId}（${ip}）`),
          onAck: (ip, msgId) => {
            this.privateOutstanding.delete(msgId)
            this.handlePrivateStatus(ip, msgId, 'delivered')
          },
          onReceipt: (ip, msgId) => {
            this.privateOutstanding.delete(msgId)
            this.handlePrivateStatus(ip, msgId, 'read')
          },
          onProfile: (ip, remote, filePort, _reversePort, folderPort, folderReversePort) => {
            this.upsertPrivatePeer(ip, remote)
            // 对端可能先探测“同号文件端口”再决定是否发图，握手后就把它的端口号也监听起来
            if (filePort > 0) {
              void this.privateFiles?.listenExtra(filePort)
            }
            if (folderPort > 0 || folderReversePort > 0) {
              logStartup(
                `私有会话 ${ip} 对端文件夹端口 ${folderPort}，反向端口 ${folderReversePort}`
              )
              // 对端反向连接时按它自己的端口号连过来，本机要把这个号也监听起来
              if (folderPort > 0) {
                void this.privateFolders?.listenExtra(folderPort)
              }
            }
          },
          onFolderOffer: (ip, offer) => this.handlePrivateFolderOffer(ip, offer),
          onFolderOperate: (ip, cmd, taskId, op) => {
            logStartup(`私有文件夹操作 ${ip} 命令 ${cmd} 任务 ${taskId} OP=${op}`)
            if (cmd === 1015 && op === 2) {
              this.startFolderSend(ip, taskId)
            }
          },
          onFolderReverse: (ip, taskId) => this.handlePrivateFolderReverse(ip, taskId),
          onFileOffer: (ip, offer) => this.handlePrivateFileOffer(ip, offer),
          onFileOperate: (ip, cmd, taskId, op) =>
            this.handlePrivateFileOperate(ip, cmd, taskId, op),
          onFileProgress: (ip, taskId, totalSize, recvdSize) =>
            this.handlePrivateFileRemoteProgress(ip, taskId, totalSize, recvdSize),
          onFileReverse: (ip, taskId) => this.handlePrivateFileReverse(ip, taskId),
          onSendFailed: (ip, msgId) => this.handlePrivateSendFailed(ip, msgId),
          onState: (ip, state, remote) => this.handlePrivateState(ip, state, remote),
          onActivity: (ip) => this.engine.touchPrivatePeer(ip),
          onLog: (message) => logStartup('private: ' + message),
          onError: (error) => logStartup('private error: ' + error.message)
        }
      })
      await service.start()
      this.privateService = service
    } catch (error) {
      logStartup('private service start failed: ' + (error as Error).message)
    }
  }

  // 文件夹通道失败只影响文件夹，私有文字与文件照旧
  private async startPrivateFolders(port: number, bindAddr: string): Promise<number> {
    if (port <= 0) {
      logStartup('私有文件夹通道未启用（端口为 0）')
      return 0
    }
    const transfer = new PrivateFolderTransfer({
      bindAddr,
      port,
      callbacks: {
        onProgress: (taskId, received, total) =>
          logStartup(`私有文件夹进度 任务=${taskId} ${received}/${total}`),
        onDone: (taskId, dir) => logStartup(`私有文件夹接收完成 任务=${taskId} 目录=${dir}`),
        onError: (taskId, error) =>
          logStartup(`私有文件夹接收失败 任务=${taskId}：${error.message}`)
      },
      onLog: (message) => logStartup('private folders: ' + message)
    })
    try {
      await transfer.start()
      this.privateFolders = transfer
      return port
    } catch (error) {
      logStartup('私有文件夹通道监听失败: ' + (error as Error).message)
      return 0
    }
  }

  // 对端发来文件夹邀请：登记任务、回 1015，接着由对端连我们的文件夹端口
  private handlePrivateFolderOffer(
    ip: string,
    offer: { taskId: string; name: string; size: number; maxItemPath: number; maxItemSize: number }
  ): void {
    logStartup(
      `私有文件夹邀请 ${ip} 任务=${offer.taskId} 名称=${offer.name} 大小=${offer.size} ` +
        `最长路径=${offer.maxItemPath} 最大文件=${offer.maxItemSize}`
    )
    const service = this.privateService
    const transfer = this.privateFolders
    if (service === null || transfer === null) return
    const peer = this.repos.peers.get(`private:${ip}`) ?? null
    const peerDir = sanitizeFileName(peer?.name ?? '') || ip
    const name = sanitizeFileName(basename(offer.name)) || '收到的文件夹'
    const saveDir = join(this.receiveDir, peerDir, name)
    mkdirSync(saveDir, { recursive: true })
    transfer.registerIncoming({
      taskId: offer.taskId,
      name,
      saveDir,
      size: offer.size
    })
    service.sendOperateRecvFolder(ip, offer.taskId, 2)
    logStartup(`私有文件夹邀请：已回 1015 OP=2（任务 ${offer.taskId}），保存到 ${saveDir}`)
  }

  // 对端接受文件夹后，连接它的文件夹端口开始推送
  private startFolderSend(ip: string, taskId: string): void {
    const folder = this.folderOutgoing.get(taskId)
    const transfer = this.privateFolders
    const service = this.privateService
    if (folder === undefined || transfer === null || service === null) {
      return
    }
    this.folderOutgoing.delete(taskId)
    const advertised = service.peerFolderPort(ip)
    const port = advertised > 0 ? advertised : 9014
    logStartup(`私有文件夹发送：对端已接受，连接 ${ip}:${port}（任务 ${taskId}）`)
    void transfer.send(ip, folder, port).catch(async (error: unknown) => {
      // 对端公布的口径可能不是它实际监听的端口，9014 再试一次
      if (port === 9014) {
        logStartup(`私有文件夹发送失败：${(error as Error).message}`)
        return
      }
      logStartup(`私有文件夹发送：${port} 失败，改用 9014 重试`)
      try {
        await transfer.send(ip, folder, 9014)
      } catch (retry: unknown) {
        logStartup(`私有文件夹发送失败：${(retry as Error).message}`)
      }
    })
  }

  // 对端发 1020：只有本端作为发送方时才需要响应，接收方向暂不处理
  private handlePrivateFolderReverse(ip: string, taskId: string): void {
    logStartup(`私有文件夹反向请求 ${ip} 任务 ${taskId}`)
  }

  // 研究用：主动向对端发一个文件夹邀请，让真实客户端扮演接收方，
  // 它连上我们的文件夹端口后发的第一帧就是接收方开始帧的样本
  // 发文件夹：先发 1013 邀请，对端回 1015 后再由 folder transfer 连过去推数据
  async sendFolder(conversationId: string, path: string): Promise<void> {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const peer = this.repos.peers.get(conversation.peerKey)
    const service = this.privateService
    const transfer = this.privateFolders
    if (peer === null || service === null || transfer === null) {
      throw new Error('联系人不在线')
    }
    if (!service.isReady(peer.ip)) {
      throw new Error('内网通私有会话未就绪')
    }
    const info = scanFolder(path)
    const taskId = randomBytes(16).toString('hex')
    const sent = service.sendFolderOffer(peer.ip, {
      taskId,
      name: path,
      size: info.totalSize,
      maxItemPath: info.maxPath,
      maxItemSize: info.maxSize
    })
    this.folderOutgoing.set(taskId, {
      taskId,
      name: path,
      root: path,
      size: info.totalSize,
      items: info.items.map((item) => ({
        name: item.name,
        dir: item.dir,
        size: item.size,
        time: item.time
      }))
    })
    logStartup(
      `私有文件夹发送：邀请 ${peer.ip} 任务=${taskId} 名称=${path} 大小=${info.totalSize} ` +
        `项数=${info.items.length} 已交给 ENet=${sent}`
    )
  }

  private importLegacyHistory(): void {
    if (this.repos.conversations.list().length > 0) {
      return
    }
    const candidates = [
      app.getPath('userData'),
      process.cwd(),
      join(app.getPath('documents'), 'nwt'),
      join(app.getPath('appData'), 'nwt'),
      join(app.getPath('home'), 'nwt'),
      join(app.getPath('downloads'), 'nwt')
    ]
    for (const dir of candidates) {
      if (!existsSync(join(dir, 'history.jsonl'))) {
        continue
      }
      const result = importLegacyHistory(this.db, dir)
      logStartup(`legacy import ${dir}: ${result.imported} imported, ${result.skipped} skipped`)
      if (result.imported > 0) {
        this.emit({ type: 'peers', peers: this.repos.peers.list() })
      }
      break
    }
  }

  async stop(): Promise<void> {
    this.notifications.stop()
    if (this.filesStarted) {
      await this.fileManager.stop()
      this.filesStarted = false
    }
    const privateService = this.privateService
    this.privateService = null
    const privateFiles = this.privateFiles
    this.privateFiles = null
    this.privateFolders?.stop()
    this.privateFolders = null
    this.privateReceipts.clear()
    this.privateOutstanding.clear()
    this.privateFileTasks.clear()
    this.privateIncomingFiles.clear()
    this.stopPrivateSweep()
    if (privateFiles !== null) {
      await privateFiles.stop()
    }
    if (privateService !== null) {
      await privateService.stop()
    }
    if (this.started) {
      await this.engine.stop()
      this.started = false
    }
  }

  snapshot(): AppSnapshot {
    const settings = this.settings.get()
    const conversations = this.repos.conversations.list()
    return {
      local: {
        name: settings.identity.displayName,
        account: settings.identity.account,
        host: settings.identity.hostName,
        status: settings.identity.status,
        online: this.started,
        version: this.appInfo.version
      },
      peers: this.repos.peers.list(),
      conversations,
      files: this.repos.files.list(),
      staged: this.staged.all(),
      unread: conversations.reduce((total, item) => total + item.unread, 0)
    }
  }

  listMessages(request: MessagesListRequest): MessagesPage {
    return this.repos.messages.list(request.conversationId, request.beforeId, request.limit ?? 50)
  }

  sendText(request: MessagesSendRequest): SendTextResult {
    const conversation = this.repos.conversations.get(request.conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const peer = this.engine.getPeers().find((item) => item.key === conversation.peerKey)
    if (peer === undefined || !peer.online) {
      throw new Error('联系人不在线')
    }
    const privateService = this.privateService
    if (privateService !== null) {
      const privateReady = privateService.isReady(peer.ip)
      if (shouldUsePrivate(privateReady, peer.port)) {
        const msgId = this.allocatePrivateSeq()
        if (privateService.sendText(peer.ip, msgId, request.text)) {
          const message = this.recordOutgoing(conversation.id, request.text, msgId)
          this.trackPrivateSend(peer.ip, conversation.id, msgId)
          return { message }
        }
      } else {
        // 本条消息按 IPMSG 发送，同时让私有通道开始连接，后续消息才能走私有
        privateService.ensureSession(peer.ip)
      }
    }
    // 只在私有通道出现过的联系人没有 IPMSG 端口，回落过去只会丢包却把消息标成已发送
    if (peer.port <= 0) {
      throw new Error('联系人不在线')
    }
    if (!this.settings.get().network.ipmsg) {
      throw new Error('内网通私有会话未就绪，请稍后重试')
    }
    const seq = this.engine.sendText(peer.key, request.text)
    return { message: this.recordOutgoing(conversation.id, request.text, seq, 'sent') }
  }

  private recordOutgoing(
    conversationId: string,
    text: string,
    remoteSeq: number,
    status?: string
  ): MessageInfo {
    const message = this.repos.messages.insertOutgoing(conversationId, text, remoteSeq)
    if (status !== undefined) {
      this.repos.messages.setStatus(message.id, status)
    }
    const updated = this.repos.messages.getMessage(message.id)
    if (updated === null) {
      throw new Error('消息写入后无法读取')
    }
    this.repos.conversations.touch(conversationId, updated.createdAt, 0)
    this.emit({ type: 'message', message: updated })
    this.emitConversation(conversationId)
    return updated
  }

  // 私有通道的消息号与文件号同一形式：秒级时间戳后接三位自增序号
  private allocatePrivateSeq(): number {
    this.privateSeq = (this.privateSeq + 1) % 1000
    return nextPrivateSeq(Date.now(), this.privateSeq)
  }

  private trackPrivateSend(ip: string, conversationId: string, msgId: number): void {
    this.privateOutstanding.set(msgId, { ip, conversationId, msgId, sentAt: Date.now() })
    if (this.privateSweep === null) {
      this.privateSweep = setInterval(() => this.expirePrivateSends(), PRIVATE_SEND_SWEEP_MS)
    }
  }

  private expirePrivateSends(): void {
    for (const entry of outstandingToFail(
      this.privateOutstanding.values(),
      Date.now(),
      PRIVATE_SEND_TIMEOUT_MS
    )) {
      this.failPrivateSend(entry)
    }
    if (this.privateOutstanding.size === 0) {
      this.stopPrivateSweep()
    }
  }

  private stopPrivateSweep(): void {
    if (this.privateSweep !== null) {
      clearInterval(this.privateSweep)
      this.privateSweep = null
    }
  }

  // 交给 ENet 之后不再回落 IPMSG：消息已经是“发不出去”的状态，交给用户决定是否重试
  private failPrivateSend(entry: OutstandingPrivateSend): void {
    this.privateOutstanding.delete(entry.msgId)
    this.updatePrivateMessageStatus(entry.conversationId, entry.msgId, 'failed')
  }

  private handlePrivateSendFailed(ip: string, msgId: number): void {
    const entry = this.privateOutstanding.get(msgId)
    if (entry !== undefined) {
      this.failPrivateSend(entry)
      return
    }
    const peerKey = this.engine.peerKeyForIp(ip)
    if (peerKey === null) {
      logStartup(`私有消息 ${msgId} 发送失败：没有对应的联系人（${ip}）`)
      return
    }
    this.updatePrivateMessageStatus(directConversationId(peerKey), msgId, 'failed')
  }

  markRead(conversationId: string, messageId: number): void {
    this.sendPrivateReceipts(conversationId, messageId)
    this.repos.conversations.markRead(conversationId, messageId)
    this.emitConversation(conversationId)
    this.notifications.setUnread(this.unreadTotal())
  }

  // 已读回执只对私有会话发送，且每条消息只发一次
  private sendPrivateReceipts(conversationId: string, messageId: number): void {
    const privateService = this.privateService
    if (privateService === null) {
      return
    }
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      return
    }
    const peer = this.engine.getPeers().find((item) => item.key === conversation.peerKey)
    if (peer === undefined || !privateService.isReady(peer.ip)) {
      return
    }
    for (const row of receiptsToSend(
      this.repos.messages.listPrivateIncoming(conversationId),
      messageId,
      this.privateReceipts
    )) {
      privateService.sendReceipt(peer.ip, row.remoteSeq)
      this.privateReceipts.add(row.id)
    }
  }

  setActiveConversation(conversationId: string | null): void {
    this.notifications.setActiveConversation(conversationId)
  }

  saveDraft(conversationId: string, draft: string): void {
    this.repos.conversations.saveDraft(conversationId, draft)
  }

  setPinned(conversationId: string, pinned: boolean): void {
    if (this.repos.conversations.get(conversationId) === null) {
      throw new Error('会话不存在')
    }
    this.repos.conversations.setPinned(conversationId, pinned)
    this.emitConversation(conversationId)
  }

  refreshPeers(): void {
    if (this.settings.get().network.ipmsg) {
      this.engine.refresh()
    }
    this.handlePeers(this.engine.getPeers())
  }

  setAlias(peerKey: string, alias: string): void {
    this.repos.peers.setAlias(peerKey, alias)
    const conversationId = directConversationId(peerKey)
    const peer = this.repos.peers.get(peerKey)
    if (peer !== null) {
      this.repos.conversations.setTitle(
        conversationId,
        alias.trim() === '' ? peer.name || peer.user || peer.ip : alias
      )
      this.emitConversation(conversationId)
    }
    this.emit({ type: 'peers', peers: this.repos.peers.list() })
  }

  listFiles(conversationId?: string): AppSnapshot['files'] {
    return this.repos.files.list(conversationId)
  }

  // 渲染进程读图片用：只暴露已经落盘的文件
  filePath(id: string): string | null {
    const task = this.repos.files.get(id)
    if (task === null || task.path === '' || !existsSync(task.path)) {
      return null
    }
    return task.path
  }

  rejectFile(id: string): void {
    const incoming = this.privateIncomingFiles.get(id)
    if (incoming !== undefined) {
      this.privateIncomingFiles.delete(id)
      this.privateFileTasks.delete(incoming.fileId)
      this.updatePrivateFileTask(id, 'rejected', 0, '')
      return
    }
    if (!this.filesStarted) {
      throw new Error('文件服务未启动')
    }
    this.fileManager.reject(id)
  }

  acceptFile(id: string): void {
    const incoming = this.privateIncomingFiles.get(id)
    if (incoming !== undefined) {
      this.acceptPrivateFile(incoming)
      return
    }
    if (!this.filesStarted) {
      throw new Error('文件服务未启动')
    }
    void this.fileManager.accept(id).catch((error: unknown) => {
      logStartup('file accept failed: ' + (error instanceof Error ? error.message : String(error)))
    })
  }

  private acceptPrivateFile(incoming: PrivateIncomingFile): void {
    const transfer = this.privateFiles
    if (transfer === null) {
      this.updatePrivateFileTask(incoming.fileTaskId, 'failed', 0, '私有文件通道未启动')
      return
    }
    incoming.accepted = true
    this.updatePrivateFileTask(incoming.fileTaskId, 'transferring', 0, '')
    transfer.registerIncoming({
      fileId: incoming.fileId,
      name: incoming.name,
      size: incoming.size,
      savePath: incoming.savePath,
      saveDir: incoming.saveDir
    })
    const service = this.privateService
    // 先请对端反过来连（真实客户端在直连不通时就是这个走法），2 秒没有进展再直连兜底
    if (service !== null && service.peerReversePort(incoming.ip) > 0) {
      const extraPort = service.peerFilePort(incoming.ip)
      // 对端反向连接时用的是它自己的文件端口号，先补开同号监听再请它连
      void transfer.listenExtra(extraPort).finally(() => {
        service.sendReverseFileReq(incoming.ip, incoming.taskId)
      })
    }
    service?.sendOperateRecvFile(incoming.ip, incoming.taskId, 2)
    setTimeout(() => {
      const current = this.privateIncomingFiles.get(incoming.fileTaskId)
      if (current === undefined || current.started) return
      const task = this.repos.files.get(incoming.fileTaskId)
      if (task !== null && task.received > 0) return
      this.startPrivateReceive(incoming)
    }, 2500)
  }

  private startPrivateReceive(incoming: PrivateIncomingFile): void {
    if (incoming.started) return
    incoming.started = true
    const transfer = this.privateFiles
    const service = this.privateService
    if (transfer === null || service === null) {
      this.updatePrivateFileTask(incoming.fileTaskId, 'failed', 0, '私有文件通道未启动')
      return
    }
    const peerPort = service.peerFilePort(incoming.ip)
    if (peerPort <= 0) {
      this.updatePrivateFileTask(incoming.fileTaskId, 'failed', 0, '对端没有公布文件通道端口')
      return
    }
    transfer.registerIncoming({
      fileId: incoming.fileId,
      name: incoming.name,
      size: incoming.size,
      savePath: incoming.savePath,
      saveDir: incoming.saveDir
    })
    void transfer
      .receive(incoming.ip, peerPort, incoming.fileId, incoming.peerUserId)
      .catch((error: unknown) => {
        logStartup(
          'private file receive failed: ' + (error instanceof Error ? error.message : String(error))
        )
      })
  }

  // 「文件」按钮只把文件放进待发区，点发送时才开始传输
  async pickStaged(conversationId: string): Promise<StagedAttachment[]> {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const options: OpenDialogOptions = {
      title: '添加文件',
      properties: ['openFile', 'multiSelections']
    }
    const result =
      this.window === null
        ? await dialog.showOpenDialog(options)
        : await dialog.showOpenDialog(this.window, options)
    if (result.canceled || result.filePaths.length === 0) {
      return this.staged.list(conversationId)
    }
    return this.addStaged(
      conversationId,
      result.filePaths.map((path) => this.stagedSource(path, false))
    )
  }

  // 剪贴板里的图片先落盘进待发区，按原图格式发送
  async pasteStaged(conversationId: string): Promise<StagedAttachment[]> {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const dir = join(app.getPath('userData'), 'clipboard')
    mkdirSync(dir, { recursive: true })
    const paths: string[] = []
    const now = Date.now()
    for (const item of await clipboard.read()) {
      const type = item.types.find((value) => value.startsWith('image/'))
      if (type === undefined) continue
      const blob = await item.getType(type)
      if (!(blob instanceof Blob)) continue
      const path = join(dir, `clip-${now}-${paths.length}.${imageExtension(type)}`)
      writeFileSync(path, Buffer.from(await blob.arrayBuffer()))
      paths.push(path)
    }
    if (paths.length === 0) {
      throw new Error('剪贴板里没有图片')
    }
    return this.addStaged(
      conversationId,
      paths.map((path) => this.stagedSource(path, true))
    )
  }

  // 拖进窗口的文件：有磁盘路径的直接引用原文件，拖进来的文件夹在这里拦下
  stagePaths(conversationId: string, paths: string[]): StagePathsResult {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const sources: StagedSource[] = []
    const skipped: string[] = []
    for (const path of paths) {
      if (!existsSync(path)) {
        skipped.push(basename(path))
        continue
      }
      const stats = statSync(path)
      if (stats.isDirectory()) {
        const info = scanFolder(path)
        sources.push({
          path,
          name: basename(path),
          size: info.totalSize,
          kind: 'folder',
          temporary: false
        })
        continue
      }
      if (!stats.isFile()) {
        skipped.push(basename(path))
        continue
      }
      sources.push(this.stagedSource(path, false))
    }
    return { attachments: this.addStaged(conversationId, sources), skipped }
  }

  // 拖进来但拿不到磁盘路径的内容（网页里直接拖出的图）先落盘再进待发区
  stageBytes(conversationId: string, name: string, data: ArrayBuffer): StagedAttachment[] {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const dir = join(app.getPath('userData'), 'clipboard')
    mkdirSync(dir, { recursive: true })
    const label = sanitizeFileName(name) || '拖入的文件'
    const path = join(dir, `drop-${randomBytes(3).toString('hex')}-${label}`)
    writeFileSync(path, Buffer.from(data))
    return this.addStaged(conversationId, [
      {
        path,
        name: label,
        size: data.byteLength,
        kind: isImagePath(label) ? 'image' : 'file',
        temporary: true
      }
    ])
  }

  removeStaged(conversationId: string, id: string): void {
    const file = this.staged.take(conversationId, id)
    if (file === null) return
    // 粘贴落盘的临时文件随手删掉；从磁盘选来的原文件不能碰
    if (file.temporary) {
      rmSync(file.path, { force: true })
    }
    this.emitStaged(conversationId)
  }

  // 依次发出待发附件，成功一张就移除一张，中途失败时剩下的留在待发区
  async sendStaged(conversationId: string): Promise<void> {
    for (;;) {
      const entry = this.staged.list(conversationId)[0]
      if (entry === undefined) break
      const file = this.staged.file(entry.id)
      if (file === undefined) {
        this.staged.take(conversationId, entry.id)
        this.emitStaged(conversationId)
        continue
      }
      if (entry.kind === 'folder') {
        await this.sendFolder(conversationId, file.path)
      } else {
        this.sendFiles(conversationId, [file.path])
      }
      this.staged.take(conversationId, entry.id)
      logStartup(`待发区发出 ${entry.name}，剩余 ${this.staged.list(conversationId).length} 个`)
      this.emitStaged(conversationId)
    }
  }

  stagedImagePath(id: string): string | null {
    const file = this.staged.file(id)
    if (file === undefined || !existsSync(file.path)) {
      return null
    }
    return file.path
  }

  private addStaged(conversationId: string, sources: StagedSource[]): StagedAttachment[] {
    const attachments = this.staged.add(conversationId, sources)
    logStartup(`待发区加入 ${sources.length} 个附件，当前 ${attachments.length} 个`)
    this.emitStaged(conversationId)
    return attachments
  }

  private stagedSource(path: string, temporary: boolean): StagedSource {
    const stats = statSync(path)
    return {
      path,
      size: stats.size,
      kind: isImagePath(path) ? 'image' : 'file',
      temporary
    }
  }

  private emitStaged(conversationId: string): void {
    this.emit({
      type: 'staged',
      conversationId,
      attachments: this.staged.list(conversationId)
    })
  }

  sendFiles(conversationId: string, paths: string[], text = ''): void {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    if (!this.settings.get().network.ipmsg) {
      this.sendFilesPrivate(conversationId, paths)
      return
    }
    if (!this.filesStarted) {
      throw new Error('文件服务未启动')
    }
    const peer = this.engine.getPeers().find((item) => item.key === conversation.peerKey)
    if (peer === undefined || !peer.online) {
      throw new Error('联系人不在线')
    }
    // 只在私有通道出现过的联系人没有 IPMSG 端口，文件邀请发不出去
    if (peer.port <= 0) {
      throw new Error('联系人不在线')
    }
    for (const path of paths) {
      const stats = statSync(path)
      if (!stats.isFile()) {
        continue
      }
      const fileId = this.nextFileId()
      const name = basename(path)
      const mtime = Math.floor(stats.mtimeMs / 1000)
      const attachment: Attachment = {
        id: fileId,
        name,
        size: stats.size,
        mtime,
        attr: FILE_ATTR_REGULAR
      }
      const packetId = this.engine.sendFileOffer(conversation.peerKey, text, [attachment])
      this.fileManager.addOutgoing({
        peerKey: conversation.peerKey,
        peerIp: peer.ip,
        peerPort: peer.port,
        name,
        size: stats.size,
        mtime,
        fileId,
        packetId,
        path
      })
      text = ''
    }
  }

  // 私有模式下的发送：先发 X_SEND_FILE 邀请，再发 X_OPERATE_SEND_FILE 开始，
  // 对端连到本机文件端口后由 PrivateFileTransfer 推数据
  private sendFilesPrivate(conversationId: string, paths: string[]): void {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const service = this.privateService
    const transfer = this.privateFiles
    if (service === null || transfer === null) {
      throw new Error('内网通私有文件通道未启动')
    }
    const peer = this.repos.peers.get(conversation.peerKey)
    if (peer === null) {
      throw new Error('联系人不在线')
    }
    if (!service.isReady(peer.ip)) {
      throw new Error('内网通私有会话未就绪')
    }
    const peerPort = service.peerFilePort(peer.ip)
    if (peerPort <= 0) {
      throw new Error('对端没有公布文件通道端口')
    }
    for (const path of paths) {
      const stats = statSync(path)
      if (!stats.isFile()) {
        continue
      }
      const fileId = this.nextFileId()
      const taskId = this.nextPrivateTaskId(peer.ip)
      const name = basename(path)
      const image = isImagePath(name)
      const imageValue = image ? `${fileId}|${fileMd5(path)}` : undefined
      const offer = {
        taskId,
        fileId,
        name: path,
        size: stats.size,
        lastModify: fileTimeFromMs(stats.mtimeMs)
      }
      transfer.registerOutgoing({ fileId, path, size: stats.size, window: imageValue })
      const fileTaskId = `pf${fileId}`
      this.privateFileTasks.set(fileId, { fileTaskId, direction: 'out', taskId, ip: peer.ip })
      const now = Date.now()
      const task: FileTaskInfo = {
        id: fileTaskId,
        messageId: null,
        conversationId,
        peerKey: peer.key,
        direction: 'out',
        name,
        size: stats.size,
        mtime: Math.floor(stats.mtimeMs / 1000),
        fileId: String(fileId),
        packetId: 0,
        path,
        state: 'transferring',
        received: 0,
        error: '',
        createdAt: now,
        updatedAt: now
      }
      if (image) {
        // 图片只发卡片，对端会发 1019 来要，再用窗口通道推过去；
        // 这样对端只显示图片，不会多出一条“文件接收成功”
        const value = imageValue ?? `${fileId}`
        const message = this.repos.messages.insertOutgoing(
          conversationId,
          '[图片]',
          this.nextPrivateMessageId(),
          'text',
          JSON.stringify({ source: 'private-image', fileId: fileTaskId })
        )
        this.fileLinks.set(fileTaskId, { conversationId, messageId: message.id })
        task.messageId = message.id
        this.repos.conversations.touch(conversationId, message.createdAt, 0)
        this.emitConversation(conversationId)
        service.sendImageCard(peer.ip, message.id, value)
        this.privateImagePushes.set(fileId, { ip: peer.ip, taskId })
        // 卡片已经交给可靠通道，状态先置为已发送；回执来了再更新
        this.repos.messages.setStatus(message.id, 'sent')
        this.emit({ type: 'message', message: { ...message, status: 'sent' } })
      } else {
        if (!service.sendFileOffer(peer.ip, offer)) {
          throw new Error('内网通私有会话未就绪')
        }
        service.sendOperateSendFile(peer.ip, taskId, 2)
      }
      this.repos.files.upsert(task)
      this.handleFileUpdate(task)
    }
  }

  private nextPrivateMessageId(): number {
    this.privateSeq = (this.privateSeq + 1) >>> 0
    return nextPrivateSeq(Date.now(), this.privateSeq)
  }

  private nextPrivateTaskId(ip: string): string {
    const next = (this.privateTaskIds.get(ip) ?? 0) + 1
    this.privateTaskIds.set(ip, next)
    return String(next)
  }

  async openFile(id: string): Promise<void> {
    const task = this.repos.files.get(id)
    if (task === null || task.state !== 'done' || task.path === '') {
      throw new Error('文件尚未接收完成')
    }
    if (!existsSync(task.path)) {
      throw new Error('文件已被移动或删除')
    }
    const error = await shell.openPath(task.path)
    if (error !== '') {
      throw new Error(error)
    }
  }

  revealFile(id: string): void {
    const task = this.repos.files.get(id)
    if (task === null || task.state !== 'done' || task.path === '') {
      throw new Error('文件尚未接收完成')
    }
    if (!existsSync(task.path)) {
      throw new Error('文件已被移动或删除')
    }
    shell.showItemInFolder(task.path)
  }

  async saveFileAs(id: string): Promise<void> {
    const task = this.repos.files.get(id)
    if (task === null || task.state !== 'done' || task.path === '') {
      throw new Error('文件尚未接收完成')
    }
    const options: SaveDialogOptions = {
      defaultPath: basename(task.path),
      title: '另存为'
    }
    const result =
      this.window === null
        ? await dialog.showSaveDialog(options)
        : await dialog.showSaveDialog(this.window, options)
    if (result.canceled || result.filePath === undefined) {
      return
    }
    copyFileSync(task.path, result.filePath)
  }

  applySettings(settings: Settings): void {
    this.engine.updateProfile({
      name: settings.identity.displayName,
      account: settings.identity.account,
      host: settings.identity.hostName,
      group: settings.identity.group,
      corporation: settings.identity.corporation,
      department: settings.identity.department,
      sign: settings.identity.sign,
      status: settings.identity.status,
      subnets: settings.network.subnets,
      seeds: settings.network.seeds,
      broadcastInterval: settings.network.broadcastInterval
    })
    this.engine.updateStatus(settings.identity.status)
    this.privateService?.updateProfile(privateProfile(settings))
  }

  private handleFileOffer(
    peer: ProtocolPeer,
    packetId: number,
    _text: string,
    attachments: Attachment[]
  ): void {
    if (!this.filesStarted) {
      logStartup('file offer ignored: file service not started')
      return
    }
    const created = this.fileManager.offerIncoming({
      peerKey: peer.key,
      peerIp: peer.ip,
      peerPort: peer.port,
      packetId,
      attachments
    })
    const settings = this.settings.get()
    for (const file of created) {
      const limit = settings.files.autoAcceptMaxMB
      if (settings.files.autoAccept && (limit === 0 || file.size <= limit * 1024 * 1024)) {
        void this.fileManager.accept(file.id).catch((error: unknown) => {
          logStartup(
            'auto accept failed: ' + (error instanceof Error ? error.message : String(error))
          )
        })
      }
    }
  }

  private handleFileUpdate(file: FileTaskInfo): void {
    const peerKey = file.peerKey
    if (peerKey === undefined || peerKey === '') {
      logStartup('file update without peer key: ' + file.id)
      return
    }
    let link = this.fileLinks.get(file.id)
    if (link === undefined) {
      const peer = this.repos.peers.get(peerKey)
      const conversation = this.repos.conversations.ensureDirect(
        peerKey,
        peer?.alias || peer?.name || peerKey
      )
      const text = file.name
      const meta = JSON.stringify({ fileId: file.id })
      const message =
        file.direction === 'in'
          ? this.repos.messages.insertIncoming(conversation.id, text, file.packetId, 'file', meta)
          : this.repos.messages.insertOutgoing(conversation.id, text, file.packetId, 'file', meta)
      if (file.direction === 'out') {
        this.repos.messages.setStatus(message.id, 'sent')
      }
      this.repos.conversations.touch(
        conversation.id,
        message.createdAt,
        file.direction === 'in' ? 1 : 0
      )
      link = { conversationId: conversation.id, messageId: message.id }
      this.fileLinks.set(file.id, link)
      this.emit({ type: 'message', message })
      this.emitConversation(conversation.id)
      if (file.direction === 'in') {
        this.notifications.notify({
          conversationId: conversation.id,
          title: peer?.alias || peer?.name || conversation.title,
          body: `收到文件：${file.name}`,
          kind: 'file',
          muted: conversation.muted,
          unread: this.unreadTotal()
        })
      }
    }
    const persisted: FileTaskInfo = {
      ...file,
      conversationId: link.conversationId,
      messageId: link.messageId
    }
    this.repos.files.upsert(persisted)
    this.emit({ type: 'file', file: persisted })
  }

  // 私有文件通道的帧头只有 32 位文件号，必须是小整数；
  // 历史数据里可能存着旧的超大文件号，不能拿来续号
  private nextFileId(): number {
    if (this.fileSeq === 0) {
      this.fileSeq = 100000 + (Date.now() % 800000)
    }
    this.fileSeq += 1
    return this.fileSeq
  }

  private handlePeers(peers: ReturnType<ProtocolEngine['getPeers']>): void {
    const aliases = new Map(this.repos.peers.list().map((peer) => [peer.key, peer.alias]))
    for (const peer of peers) {
      this.repos.peers.upsert(toPeerInfo(peer))
      const conversationId = directConversationId(peer.key)
      const title = aliases.get(peer.key)?.trim() || peer.name || peer.user || peer.ip
      const existing = this.repos.conversations.get(conversationId)
      if (existing === null) {
        const conversation = this.repos.conversations.ensureDirect(peer.key, title)
        this.emit({ type: 'conversation', conversation })
      } else if (existing.title !== title) {
        // 昵称、别名或账号在握手后变化时，会话标题跟着联系人一起更新。
        this.repos.conversations.setTitle(conversationId, title)
        this.emitConversation(conversationId)
      }
    }
    this.emit({ type: 'peers', peers: this.repos.peers.list() })
  }

  private handleIncoming(
    peerKey: string,
    peerName: string,
    text: string,
    remoteSeq: number,
    meta = '{}'
  ): MessageInfo {
    const conversation = this.repos.conversations.ensureDirect(peerKey, peerName || peerKey)
    const message = this.repos.messages.insertIncoming(
      conversation.id,
      text,
      remoteSeq,
      'text',
      meta
    )
    this.repos.conversations.touch(conversation.id, message.createdAt, 1)
    this.emit({ type: 'message', message })
    this.emitConversation(conversation.id)
    const current = this.repos.conversations.get(conversation.id)
    if (current !== null) {
      this.notifications.notify({
        conversationId: current.id,
        title: peerName || current.title,
        body: text,
        kind: 'message',
        muted: current.muted,
        unread: this.unreadTotal()
      })
    }
    return message
  }

  private handleStatus(peerKey: string, seq: number, status: 'delivered' | 'read'): void {
    this.updatePrivateMessageStatus(directConversationId(peerKey), seq, status)
  }

  // 传输层状态只前进不后退：迟到的 1005 不能把已经置为 read 的消息降回 delivered
  private updatePrivateMessageStatus(
    conversationId: string,
    seq: number,
    status: 'delivered' | 'read' | 'failed'
  ): void {
    const row = this.db
      .prepare(
        "SELECT id, status FROM messages WHERE conversation_id = ? AND direction = 'out' AND remote_seq = ? ORDER BY id DESC LIMIT 1"
      )
      .get(conversationId, seq) as { id: number; status: string } | undefined
    if (row === undefined || row.status === status || row.status === 'read') {
      return
    }
    this.repos.messages.setStatus(row.id, status)
    const message = this.repos.messages.getMessage(row.id)
    if (message !== null) {
      this.emit({ type: 'message', message })
    }
  }

  private handlePrivateText(
    ip: string,
    msgId: number,
    text: string,
    images: PrivateImageRef[]
  ): void {
    const peerKey = this.engine.peerKeyForIp(ip)
    if (peerKey === null) {
      logStartup(`忽略来自 ${ip} 的私有消息：没有对应的联系人`)
      return
    }
    const peer = this.repos.peers.get(peerKey)
    const meta = JSON.stringify({ source: 'private', msgId: String(msgId) })
    const message = this.handleIncoming(peerKey, peer?.alias || peer?.name || ip, text, msgId, meta)
    if (images.length > 0) {
      this.requestImages(ip, message.id, images)
    }
  }

  // 图片消息只带发送方缓存里的编号，先回 retrieve 消息请对方推原图，
  // 再按几种可能的操作指令依次探测，哪种能触发 1009 一看抓包就知道
  private requestImages(ip: string, messageId: number, images: PrivateImageRef[]): void {
    const service = this.privateService
    if (service === null) return
    const pending: PrivateImageRef[] = []
    for (const ref of images) {
      if (this.privateFileTasks.has(ref.id)) continue
      this.privateImageMessages.set(ref.id, messageId)
      pending.push(ref)
    }
    if (pending.length === 0) return
    logStartup(`私有图片消息 ${messageId} 请求 ${pending.map((ref) => ref.id).join(',')}`)
    for (const ref of pending) {
      this.registerImageTask(ip, messageId, ref)
    }
    // 对方收到卡片后等的是 1019，越早发越早开始推送；retrieve 只用来告诉它要哪张
    const msgId = nextPrivateSeq(Date.now(), (this.privateSeq = (this.privateSeq + 1) >>> 0))
    service.sendRetrieveImages(ip, msgId, pending)
    for (const ref of pending) {
      service.sendReverseFileReq(ip, String(ref.id))
    }
    // 没等到推送就再要两次
    for (const delay of [3000, 8000]) {
      setTimeout(() => {
        for (const ref of pending) {
          if (this.imagePending(ref.id)) {
            logStartup(`私有图片 ${ref.id} 再次请求 ${delay}ms`)
            service.sendReverseFileReq(ip, String(ref.id))
          }
        }
      }, delay)
    }
  }

  // 图片还没开始收、也没收完时继续探测
  private imagePending(fileId: number): boolean {
    const incoming = this.privateIncomingFiles.get(`pf${fileId}`)
    if (incoming !== undefined && incoming.started) return false
    const task = this.repos.files.get(`pf${fileId}`)
    if (task === null) return true
    return task.received === 0 && task.state !== 'done' && task.state !== 'failed'
  }

  // 图片没有 X_SEND_FILE 邀请，先登记一条待接收任务，对端连过来才接得住
  private registerImageTask(ip: string, messageId: number, ref: PrivateImageRef): void {
    const transfer = this.privateFiles
    if (transfer === null) return
    const fileTaskId = `pf${ref.id}`
    if (this.privateIncomingFiles.has(fileTaskId)) return
    const peer = this.peerForIp(ip)
    const saveDir = join(this.receiveDir, sanitizeFileName(peer.name) || '内网通')
    mkdirSync(saveDir, { recursive: true })
    const savePath = join(saveDir, `image-${ref.id}.png`)
    const conversation = this.repos.conversations.ensureDirect(peer.key, peer.name)
    const now = Date.now()
    this.privateFileTasks.set(ref.id, {
      fileTaskId,
      direction: 'in',
      taskId: String(ref.id),
      ip
    })
    this.privateIncomingFiles.set(fileTaskId, {
      taskId: String(ref.id),
      fileId: ref.id,
      ip,
      fileTaskId,
      name: `image-${ref.id}.png`,
      size: 0,
      saveDir,
      savePath,
      peerUserId: this.privateService?.peerUserId(ip) ?? '',
      accepted: true,
      startSignaled: true,
      started: false
    })
    this.fileLinks.set(fileTaskId, { conversationId: conversation.id, messageId })
    transfer.registerIncoming({
      fileId: ref.id,
      name: `image-${ref.id}.png`,
      size: 0,
      savePath,
      saveDir
    })
    const task: FileTaskInfo = {
      id: fileTaskId,
      messageId,
      conversationId: conversation.id,
      peerKey: peer.key,
      direction: 'in',
      name: `image-${ref.id}.png`,
      size: 0,
      mtime: 0,
      fileId: String(ref.id),
      packetId: 0,
      path: savePath,
      state: 'waiting',
      received: 0,
      error: '',
      createdAt: now,
      updatedAt: now
    }
    this.repos.files.upsert(task)
    this.handleFileUpdate(task)
  }

  private handlePrivateStatus(ip: string, msgId: number, status: 'delivered' | 'read'): void {
    const peerKey = this.engine.peerKeyForIp(ip)
    if (peerKey === null) {
      logStartup(`忽略来自 ${ip} 的私有状态：没有对应的联系人`)
      return
    }
    this.handleStatus(peerKey, msgId, status)
  }

  private handlePrivateState(ip: string, state: SessionState, profile: RemoteProfile | null): void {
    if (state === 'ready' && profile !== null) {
      this.upsertPrivatePeer(ip, profile)
      return
    }
    if (state === 'closed') {
      this.engine.markPrivatePeerOffline(ip)
      for (const entry of Array.from(this.privateOutstanding.values())) {
        if (entry.ip === ip) {
          this.failPrivateSend(entry)
        }
      }
    }
  }

  // 对端可能先发 X_READY 再发 X_HANDSHARK：资料一到就写进联系人表，
  // 否则入站文字会因为没有对应联系人的 IP 映射而被丢弃
  private upsertPrivatePeer(ip: string, profile: RemoteProfile): void {
    this.engine.upsertPrivatePeer({
      ip,
      userId: profile.userId,
      name: profile.name,
      group: profile.group,
      corporation: profile.corporation,
      department: profile.department,
      sign: profile.sign,
      status: profile.status,
      online: true
    })
  }

  private peerForIp(ip: string): { key: string; name: string } {
    const key = this.engine.peerKeyForIp(ip) ?? `${ip}|${ip}`
    const peer = this.repos.peers.get(key)
    return { key, name: peer?.alias || peer?.name || ip }
  }

  // 对端发来 X_SEND_FILE：登记一条待接收任务，按自动接收设置决定是否立即连过去
  private handlePrivateFileOffer(ip: string, offer: PrivateFileOffer): void {
    const name = sanitizeFileName(offer.name)
    if (name === '' || offer.size < 0) {
      logStartup(`私有文件邀请无效: ${offer.name}`)
      return
    }
    const existing = this.privateFileTasks.get(offer.fileId)
    if (existing !== undefined) {
      const incoming = this.privateIncomingFiles.get(existing.fileTaskId)
      if (incoming === undefined) {
        logStartup(`私有文件邀请重复，忽略 ${offer.fileId}`)
        return
      }
      // 图片先建了占位任务，这里用邀请里的真实大小和文件名补全
      incoming.size = offer.size
      this.acceptPrivateFile(incoming)
      return
    }
    const peer = this.peerForIp(ip)
    const saveDir = join(this.receiveDir, sanitizeFileName(peer.name) || '内网通')
    mkdirSync(saveDir, { recursive: true })
    const reserved = new Set(
      Array.from(this.privateIncomingFiles.values()).map((item) => basename(item.savePath))
    )
    const fileName = uniqueName(saveDir, name, (candidate) => reserved.has(candidate))
    const savePath = join(saveDir, fileName)
    const fileTaskId = `pf${offer.fileId}`
    this.privateFileTasks.set(offer.fileId, {
      fileTaskId,
      direction: 'in',
      taskId: offer.taskId,
      ip
    })
    this.privateIncomingFiles.set(fileTaskId, {
      taskId: offer.taskId,
      fileId: offer.fileId,
      ip,
      fileTaskId,
      name: fileName,
      size: offer.size,
      saveDir,
      savePath,
      peerUserId: this.privateService?.peerUserId(ip) ?? '',
      accepted: false,
      startSignaled: false,
      started: false
    })
    const conversation = this.repos.conversations.ensureDirect(peer.key, peer.name)
    const now = Date.now()
    const imageMessageId = this.privateImageMessages.get(offer.fileId)
    const task: FileTaskInfo = {
      id: fileTaskId,
      messageId: imageMessageId ?? null,
      conversationId: conversation.id,
      peerKey: peer.key,
      direction: 'in',
      name: fileName,
      size: offer.size,
      mtime: 0,
      fileId: String(offer.fileId),
      packetId: 0,
      path: savePath,
      state: 'offered',
      received: 0,
      error: '',
      createdAt: now,
      updatedAt: now
    }
    if (imageMessageId !== undefined) {
      // 图片文件不单独出一条文件卡片，挂到引用它的那条消息上
      this.fileLinks.set(fileTaskId, { conversationId: conversation.id, messageId: imageMessageId })
      this.privateImageMessages.delete(offer.fileId)
    }
    this.repos.files.upsert(task)
    this.handleFileUpdate(task)
    const settings = this.settings.get()
    const limit = settings.files.autoAcceptMaxMB
    if (settings.files.autoAccept && (limit === 0 || offer.size <= limit * 1024 * 1024)) {
      this.acceptFile(fileTaskId)
    }
  }

  // 对端的 1011 是“我开始接收了”，不是接收完成；完成以本端发送结束或 1012 进度为准
  private handlePrivateFileOperate(_ip: string, cmd: number, taskId: string, op: number): void {
    const entry = this.findPrivateFileByTaskId(taskId)
    if (entry === null) return
    if (cmd === 1011) {
      logStartup(`私有文件 ${taskId} 对端确认接收（OP=${op}）`)
      return
    }
    if (cmd === 1010 && op === 2) {
      const task = this.repos.files.get(entry.fileTaskId)
      if (task === null || task.direction !== 'in') return
      const incoming = this.privateIncomingFiles.get(entry.fileTaskId)
      if (incoming === undefined) return
      // 真实客户端在对端宣布开始之后才建立 TCP，提前连会被拒绝
      incoming.startSignaled = true
      if (incoming.accepted) {
        this.startPrivateReceive(incoming)
      }
    }
  }

  private findPrivateFileByTaskId(taskId: string): { fileTaskId: string } | null {
    for (const entry of this.privateFileTasks.values()) {
      if (entry.taskId === taskId) return { fileTaskId: entry.fileTaskId }
    }
    return null
  }

  private handlePrivateFileRemoteProgress(
    _ip: string,
    taskId: string,
    totalSize: number,
    recvdSize: number
  ): void {
    const entry = this.findPrivateFileByTaskId(taskId)
    if (entry === null) return
    const task = this.repos.files.get(entry.fileTaskId)
    if (task === null || task.direction !== 'out') return
    this.updatePrivateFileTask(
      entry.fileTaskId,
      recvdSize >= totalSize ? 'done' : 'transferring',
      recvdSize,
      ''
    )
  }

  // 接收方直连不通时会发 1019，让发送方反过来连它的反向端口
  private handlePrivateFileReverse(ip: string, taskId: string): void {
    const entry = this.findPrivateFileByTaskId(taskId)
    let fileTaskId: string
    let fileId: number
    if (entry !== null) {
      const fileTask = this.repos.files.get(entry.fileTaskId)
      if (fileTask === null || fileTask.direction !== 'out') return
      fileTaskId = entry.fileTaskId
      fileId = Number(fileTask.fileId)
    } else {
      // 图片的 1019 用对端自己的任务号，按“最近一张待推的图片”匹配
      const pending = Array.from(this.privateImagePushes.entries()).find(
        ([, push]) => push.ip === ip
      )
      if (pending === undefined) return
      fileId = pending[0]
      fileTaskId = `pf${fileId}`
      this.privateImagePushes.delete(fileId)
    }
    if (this.privateReverseStarted.has(fileId)) return
    const transfer = this.privateFiles
    const service = this.privateService
    if (transfer === null || service === null) return
    const reversePort = service.peerReversePort(ip)
    if (reversePort <= 0) {
      this.updatePrivateFileTask(fileTaskId, 'failed', 0, '对端没有公布反向文件端口')
      return
    }
    this.privateReverseStarted.add(fileId)
    logStartup(`私有文件通道改用反向连接 ${ip}:${reversePort}（文件 ${fileId}）`)
    void this.sendReverseImage(transfer, ip, reversePort, fileId).catch((error: unknown) => {
      logStartup(
        'private file reverse send failed: ' +
          (error instanceof Error ? error.message : String(error))
      )
    })
  }

  // 对端的反向监听端口偶尔还没就绪，连接被拒绝时重试几次；此时还没写数据，重发是安全的
  private async sendReverseImage(
    transfer: PrivateFileTransfer,
    ip: string,
    port: number,
    fileId: number
  ): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await transfer.sendReverse(ip, port, fileId)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ECONNREFUSED' || attempt >= 3) throw error
        await new Promise((resolve) => setTimeout(resolve, 400))
      }
    }
  }

  private handlePrivateFileProgress(fileId: number, received: number): void {
    const entry = this.privateFileTasks.get(fileId)
    if (entry === undefined) return
    const task = this.repos.files.get(entry.fileTaskId)
    if (task === null) return
    const next: FileTaskInfo = {
      ...task,
      state: 'transferring',
      received,
      size: Math.max(task.size, received),
      updatedAt: Date.now()
    }
    this.repos.files.upsert(next)
    this.emit({ type: 'file', file: next })
  }

  private handlePrivateFileDone(fileId: number, path: string): void {
    const entry = this.privateFileTasks.get(fileId)
    if (entry === undefined) return
    logStartup(`私有文件${entry.direction === 'in' ? '接收' : '发送'}完成 ${fileId}（${path}）`)
    const task = this.repos.files.get(entry.fileTaskId)
    if (task === null) return
    const total = Math.max(task.size, task.received)
    if (entry.direction === 'in') {
      this.privateService?.sendOperateRecvFile(entry.ip, entry.taskId, 2)
      this.privateService?.sendProgressRecvFile(entry.ip, entry.taskId, total, total)
    }
    this.updatePrivateFileTask(
      entry.fileTaskId,
      'done',
      Math.max(task.size, task.received),
      '',
      path
    )
    this.privateFileTasks.delete(fileId)
  }

  private handlePrivateFileError(fileId: number, error: Error): void {
    const entry = this.privateFileTasks.get(fileId)
    if (entry === undefined) return
    logStartup(`私有文件失败 ${fileId}: ${error.message}`)
    this.updatePrivateFileTask(entry.fileTaskId, 'failed', 0, error.message)
    this.privateFileTasks.delete(fileId)
  }

  private updatePrivateFileTask(
    id: string,
    state: FileTaskInfo['state'],
    received: number,
    error: string,
    path?: string
  ): void {
    const task = this.repos.files.get(id)
    if (task === null) return
    const next: FileTaskInfo = {
      ...task,
      state,
      received,
      error,
      path: path === undefined ? task.path : path,
      updatedAt: Date.now()
    }
    this.repos.files.upsert(next)
    this.emit({ type: 'file', file: next })
  }

  private emitConversation(id: string): void {
    const conversation = this.repos.conversations.get(id)
    if (conversation !== null) {
      this.emit({ type: 'conversation', conversation })
    }
  }

  private emit(event: AppEvent): void {
    this.window?.webContents.send(IPC.event, event)
  }

  private unreadTotal(): number {
    return this.repos.conversations
      .list()
      .reduce((total, conversation) => total + conversation.unread, 0)
  }
}
