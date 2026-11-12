import { randomBytes, createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import {
  app,
  clipboard,
  ClipboardItem,
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
  ConversationInfo,
  FavoriteSticker,
  FileTaskInfo,
  GroupInfo,
  GroupMemberInfo,
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
import type {
  PrivateGroupFileRef,
  PrivateGroupInfo,
  PrivateGroupMember,
  PrivateProfile,
  RemoteProfile
} from './protocol/private/messages'
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
import {
  createRepositories,
  directConversationId,
  groupConversationId,
  type QGroupInfo,
  type Repositories
} from './store/repositories'
import { importLegacyHistory } from './store/import'
import type { SettingsStore } from './settings/store'
import { createPrivateId, privateUserId } from './identity'
import { groupInfoNotices } from './groups/info-notice'
import { FavoriteStore } from './emotion/favorites'
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

// 复制到剪贴板时要按扩展名给出 MIME，Electron 44 的 clipboard 只认 Blob 的 MIME
function imageMimeOf(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.png')) return 'image/png'
  return ''
}

function isImagePath(path: string): boolean {
  return IMAGE_PATH.test(path)
}

// 收到图片先按编号存成 .png，这里按文件头还原真实格式，GIF 才能保持动画
function imageExtensionFromMagic(header: Buffer): string {
  if (header.length >= 6) {
    const signature = header.toString('ascii', 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') return 'gif'
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8) return 'jpg'
  if (
    header.length >= 12 &&
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp'
  }
  if (header.length >= 2 && header.toString('ascii', 0, 2) === 'BM') return 'bmp'
  return ''
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
  private readonly favorites: FavoriteStore
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
  // 图片卡片：文件号 → 还没来要这张图的对端（群发时会有多个）
  private readonly privateImagePushes = new Map<number, Array<{ ip: string; taskId: string }>>()
  // 文件夹通道的研究探针：只记录收到的帧结构
  private privateFolders: PrivateFolderTransfer | null = null
  private readonly folderOutgoing = new Map<string, OutgoingFolder>()
  // 文件夹任务 → 聊天消息，用于把收发状态写回气泡
  private readonly folderLinks = new Map<string, { conversationId: string; messageId: number }>()
  // 群文件：本机作为发送方时按 share id 记住要提供哪个文件或文件夹
  private readonly groupShares = new Map<
    string,
    { fileId: number; size: number; modified: number; folder?: OutgoingFolder }
  >()
  // 群文件夹：本机作为接收方时按 CHANNEL_ID 记住这一路下载
  private readonly groupFolderDownloads = new Map<
    string,
    {
      ip: string
      groupId: string
      conversationId: string
      messageId: number
      name: string
      saveDir: string
      sourcePath: string
      size: number
    }
  >()
  // 群文件夹：本机作为发送方时按 share id 统计各成员的推送结果
  private readonly groupFolderStates = new Map<
    string,
    { messageId: number; total: number; ok: number; failed: number }
  >()
  // 群文件：本机作为接收方时按 REQ_ID 记住正在要哪个文件
  private readonly groupDownloads = new Map<
    number,
    {
      ip: string
      groupId: string
      conversationId: string
      messageId: number
      fileTaskId: string
      name: string
      size: number
      savePath: string
      saveDir: string
      text: string
      // 发送方给的原始路径，回执里要原样带回
      sourcePath: string
    }
  >()
  private groupRequestSeq = 0
  // 已发出群资料请求的群，收到应答前不动本地数据
  private readonly groupInfoProbes = new Set<string>()
  private readonly privateTaskIds = new Map<string, number>()
  // 已经因 1019 反向请求开始推数据的文件，避免重复连接
  private readonly privateReverseStarted = new Set<string>()
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
    this.favorites = new FavoriteStore(join(app.getPath('userData'), 'emotion-favorites'))
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
          onGroupInfo: (ip, info) => this.handleGroupInfo(ip, info),
          onGroupUsers: (ip, info, members) => this.handleGroupUsers(ip, info, members),
          onGroupMessage: (ip, groupId, msgId, text, images, files) =>
            this.handleGroupMessage(ip, groupId, msgId, text, images, files),
          onShareDownload: (ip, reqId, shareId) =>
            this.handleGroupShareDownload(ip, reqId, shareId),
          onShareDownloadFolder: (ip, reqId, shareId, channelId) =>
            this.handleGroupFolderDownload(ip, reqId, shareId, channelId),
          onShareDownloadFolderRsp: (ip, reqId, err, channelId) =>
            this.handleGroupFolderResponse(ip, reqId, err, channelId),
          onShareDownloadRsp: (ip, reqId, err, fileId, fileSize, lastModify) =>
            this.handleGroupShareResponse(ip, reqId, err, fileId, fileSize, lastModify),
          onRemindFile: (ip, groupId, name, size, folder) =>
            this.handleGroupFileRemind(ip, groupId, name, size, folder),
          onGroupReqInfo: (ip, groupId) => this.handleGroupReqInfo(ip, groupId),
          onGroupInfoRsp: (ip, ret, groupId, info) =>
            this.handleGroupInfoRsp(ip, ret, groupId, info),
          onGroupDismiss: (ip, groupId) => this.handleGroupRemoved(ip, groupId, '解散'),
          onGroupKick: (ip, groupId) => this.handleGroupRemoved(ip, groupId, '被移出'),
          onGroupExit: (ip, groupId) => this.handleGroupMemberExit(ip, groupId),
          onReady: (ip, userId) => this.reconcileGroups(ip, userId),
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
        onProgress: (taskId, received, total) => {
          const group = this.groupFolderDownloads.get(taskId)
          if (group !== undefined) group.size = total
          logStartup(`私有文件夹进度 任务=${taskId} ${received}/${total}`)
        },
        onDone: (taskId, dir) => {
          logStartup(`私有文件夹接收完成 任务=${taskId} 目录=${dir}`)
          this.handleFolderDone(taskId, dir)
        },
        onError: (taskId, error) => {
          logStartup(`私有文件夹接收失败 任务=${taskId}：${error.message}`)
          this.handleFolderError(taskId)
        }
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
    const peerKey = this.engine.peerKeyForIp(ip)
    const peer = peerKey === null ? null : this.repos.peers.get(peerKey)
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
    if (peerKey !== null) {
      const conversation = this.repos.conversations.ensureDirect(
        peerKey,
        peer?.alias || peer?.name || ip
      )
      const message = this.repos.messages.insertIncoming(
        conversation.id,
        name,
        this.nextPrivateMessageId(),
        'folder',
        JSON.stringify({
          source: 'private-folder',
          taskId: offer.taskId,
          size: offer.size,
          dir: saveDir,
          incoming: true
        })
      )
      this.folderLinks.set(offer.taskId, { conversationId: conversation.id, messageId: message.id })
      this.repos.conversations.touch(conversation.id, message.createdAt, 1)
      this.emit({ type: 'message', message })
      this.emitConversation(conversation.id)
    }
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
    void transfer
      .send(ip, folder, port)
      .then(() => this.handleFolderDone(taskId, folder.root))
      .catch(async (error: unknown) => {
        // 对端公布的口径可能不是它实际监听的端口，9014 再试一次
        if (port === 9014) {
          logStartup(`私有文件夹发送失败：${(error as Error).message}`)
          this.handleFolderError(taskId)
          return
        }
        logStartup(`私有文件夹发送：${port} 失败，改用 9014 重试`)
        try {
          await transfer.send(ip, folder, 9014)
          this.handleFolderDone(taskId, folder.root)
        } catch (retry: unknown) {
          logStartup(`私有文件夹发送失败：${(retry as Error).message}`)
          this.handleFolderError(taskId)
        }
      })
  }

  // 文件夹任务结束：写回气泡（接收方记录目录，发送方把状态推到已送达）
  private handleFolderDone(taskId: string, dir: string): void {
    const group = this.groupFolderDownloads.get(taskId)
    if (group !== undefined) {
      this.groupFolderDownloads.delete(taskId)
      this.privateFolders?.forget(taskId)
      const message = this.repos.messages.getMessage(group.messageId)
      if (message !== null) {
        let meta: Record<string, unknown>
        try {
          meta = JSON.parse(message.meta) as Record<string, unknown>
        } catch {
          meta = {}
        }
        const nextMeta = JSON.stringify({ ...meta, dir, size: group.size, done: true })
        this.repos.messages.setMeta(message.id, nextMeta)
        this.emit({ type: 'message', message: { ...message, meta: nextMeta } })
      }
      this.privateService?.sendRemindFile(
        group.ip,
        group.groupId,
        group.size,
        group.sourcePath,
        true
      )
      logStartup(`群文件夹接收完成 ${group.name} 大小=${group.size}`)
      return
    }
    const link = this.folderLinks.get(taskId)
    this.folderLinks.delete(taskId)
    if (link === undefined) return
    const message = this.repos.messages.getMessage(link.messageId)
    if (message === null) return
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(message.meta) as Record<string, unknown>
    } catch {
      meta = {}
    }
    const nextMeta = JSON.stringify({ ...meta, dir, done: true })
    this.repos.messages.setMeta(message.id, nextMeta)
    const status = message.direction === 'out' ? 'delivered' : message.status
    if (message.direction === 'out') {
      this.repos.messages.setStatus(message.id, status)
    }
    this.emit({ type: 'message', message: { ...message, meta: nextMeta, status } })
  }

  private handleFolderError(taskId: string): void {
    const group = this.groupFolderDownloads.get(taskId)
    if (group !== undefined) {
      this.groupFolderDownloads.delete(taskId)
      this.privateFolders?.forget(taskId)
      this.markGroupFolderFailed(group.messageId, '文件夹接收失败')
      return
    }
    const link = this.folderLinks.get(taskId)
    this.folderLinks.delete(taskId)
    if (link === undefined) return
    const message = this.repos.messages.getMessage(link.messageId)
    if (message === null || message.direction !== 'out') return
    this.repos.messages.setStatus(message.id, 'failed')
    this.emit({ type: 'message', message: { ...message, status: 'failed' } })
  }

  // 对端发 1020：只有本端作为发送方时才需要响应，接收方向暂不处理
  // 群资料推送：更新群信息并刷新会话标题
  // 会话就绪后核对本地群：只向群主所在的节点问一次群资料，群主才是这个群的权威。
  // 群已解散、或我们已被踢掉时拿不到 INFO，据此清掉本地残留
  private reconcileGroups(ip: string, userId: string): void {
    logStartup(`私有会话 ${ip} 用户号 ${userId}`)
    for (const group of this.repos.groups.list()) {
      if (group.master === '' || group.master !== userId) continue
      if (this.privateService?.sendGroupReqInfo(ip, group.id) !== true) continue
      this.groupInfoProbes.add(`${ip}|${group.id}`)
      logStartup(`私有群资料核对 ${ip} 群=${group.name} 群号=${group.id}`)
    }
  }

  // 群资料应答：带 INFO 就是群还在；只有群号没有 INFO 说明群已经不在了
  private handleGroupInfoRsp(
    ip: string,
    ret: number,
    groupId: string,
    info: PrivateGroupInfo | null
  ): void {
    const probed = this.groupInfoProbes.delete(`${ip}|${groupId}`)
    logStartup(`私有群资料应答 ${ip} 群号=${groupId} RET=${ret} 有资料=${info !== null}`)
    if (info !== null) {
      this.handleGroupInfo(ip, info)
      return
    }
    if (probed) this.handleGroupRemoved(ip, groupId, '已不存在')
  }

  private handleGroupInfo(ip: string, info: PrivateGroupInfo): void {
    try {
      logStartup(`私有群资料 ${ip} 群=${info.name} 群号=${info.id} 版本=${info.infoVersion}`)
      const previous = this.repos.groups.get(info.id)
      this.repos.groups.upsert({
        id: info.id,
        name: info.name,
        topic: info.topic,
        announcement: info.announcement,
        master: info.master,
        infoVersion: info.infoVersion,
        userVersion: info.userVersion,
        allowOtherAdd: info.allowOtherAdd,
        photoMd5: info.photoMd5,
        updatedAt: Date.now()
      })
      const conversation = this.repos.conversations.ensureGroup(info.id, info.name || '群聊')
      this.repos.conversations.setTitle(conversation.id, info.name || '群聊')
      this.emitConversation(conversation.id)
      this.emitGroup(info.id)
      if (previous !== null) {
        this.recordGroupNotices(conversation.id, previous, info)
      }
    } catch (error) {
      logStartup(`私有群资料处理失败：${(error as Error).message}`)
    }
  }

  // 群资料被改过就在群会话里留一条系统提示；协议里没有操作者，只写改了哪个字段
  private recordGroupNotices(
    conversationId: string,
    previous: { name: string; topic: string; announcement: string },
    next: { name: string; topic: string; announcement: string }
  ): void {
    const notices = groupInfoNotices(previous, next)
    if (notices.length === 0) return
    for (const text of notices) {
      const message = this.repos.messages.insertIncoming(conversationId, text, 0, 'system')
      this.emit({ type: 'message', message })
    }
    this.repos.conversations.touch(conversationId, Date.now(), 0)
    this.emitConversation(conversationId)
  }

  // 成员列表推送：建群或成员变动时整份下发，收到就以这份为准
  private handleGroupUsers(
    ip: string,
    info: PrivateGroupInfo,
    members: PrivateGroupMember[]
  ): void {
    try {
      logStartup(`私有群成员 ${ip} 群=${info.name} 群号=${info.id} 成员=${members.length}`)
      this.repos.groups.replaceMembers(info.id, members)
      this.handleGroupInfo(ip, info)
      this.emitConversation(groupConversationId(info.id))
    } catch (error) {
      logStartup(`私有群成员处理失败：${(error as Error).message}`)
    }
  }

  // 群消息：没有 ACK，按 MSG_ID 去重后落库；图片和文件各自走自己的拉取流程
  private handleGroupMessage(
    ip: string,
    groupId: string,
    msgId: number,
    text: string,
    images: PrivateImageRef[],
    files: PrivateGroupFileRef[]
  ): void {
    try {
      const group = this.repos.groups.get(groupId)
      const title = group?.name || '群聊'
      const conversation = this.repos.conversations.ensureGroup(groupId, title)
      const senderId = this.privateService?.peerUserId(ip) ?? ''
      const senderName = this.repos.groups
        .members(groupId)
        .find((member) => member.userId === senderId)?.name
      if (files.length > 0) {
        for (const file of files) {
          if (file.folder) {
            this.receiveGroupFolder(ip, conversation, groupId, msgId, file)
          } else {
            this.receiveGroupFile(ip, conversation, groupId, msgId, text, file)
          }
        }
        return
      }
      const stickers = images.filter((ref) => ref.sticker === true)
      const photos = images.filter((ref) => ref.sticker !== true)
      const metaRecord: Record<string, unknown> = {
        source: 'private-group',
        groupId,
        senderId,
        senderName: senderName ?? ip
      }
      if (stickers.length > 0) metaRecord.sticker = stickers[0].value
      const meta = JSON.stringify(metaRecord)
      const body = text === '' && stickers.length > 0 ? '[表情]' : text
      const message = this.repos.messages.insertIncoming(conversation.id, body, msgId, 'text', meta)
      this.repos.conversations.touch(conversation.id, message.createdAt, 1)
      this.emit({ type: 'message', message })
      this.emitConversation(conversation.id)
      if (photos.length > 0) {
        this.requestImages(ip, message.id, photos, conversation.id)
      }
      logStartup(`私有群消息 ${title} MSG_ID=${msgId} 来自 ${senderName ?? ip}`)
    } catch (error) {
      logStartup(`私有群消息处理失败：${(error as Error).message}`)
    }
  }

  // 群文件夹：消息里只有 share id，发 5006 带上本机生成的通道号，发送方随后连我们的文件夹端口
  private receiveGroupFolder(
    ip: string,
    conversation: ConversationInfo,
    groupId: string,
    msgId: number,
    file: PrivateGroupFileRef
  ): void {
    const service = this.privateService
    const transfer = this.privateFolders
    if (service === null || transfer === null) return
    const peer = this.peerForIp(ip)
    const peerDir = sanitizeFileName(peer.name) || '内网通'
    const name = sanitizeFileName(file.name) || '收到的文件夹'
    const saveDir = join(this.receiveDir, peerDir, name)
    mkdirSync(saveDir, { recursive: true })
    const channelId = randomBytes(16).toString('hex')
    const meta = JSON.stringify({
      source: 'private-group-folder',
      groupId,
      shareId: file.shareId,
      dir: saveDir,
      incoming: true,
      size: 0,
      done: false
    })
    const message = this.repos.messages.insertIncoming(
      conversation.id,
      file.name,
      msgId,
      'folder',
      meta
    )
    this.repos.conversations.touch(conversation.id, message.createdAt, 1)
    this.emit({ type: 'message', message })
    this.emitConversation(conversation.id)
    transfer.registerIncoming({ taskId: channelId, name, saveDir, size: 0 })
    this.groupFolderDownloads.set(channelId, {
      ip,
      groupId,
      conversationId: conversation.id,
      messageId: message.id,
      name,
      saveDir,
      sourcePath: file.path,
      size: 0
    })
    const reqId = (this.groupRequestSeq = (this.groupRequestSeq + 1) >>> 0)
    service.sendShareDownloadFolder(ip, reqId, file.shareId, channelId)
    logStartup(`群文件夹请求 ${file.name} share=${file.shareId} 通道=${channelId}`)
  }

  private markGroupFolderFailed(messageId: number, error: string): void {
    const message = this.repos.messages.getMessage(messageId)
    if (message === null) return
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(message.meta) as Record<string, unknown>
    } catch {
      meta = {}
    }
    const nextMeta = JSON.stringify({ ...meta, done: false, error })
    this.repos.messages.setMeta(message.id, nextMeta)
    this.repos.messages.setStatus(message.id, 'failed')
    this.emit({ type: 'message', message: { ...message, meta: nextMeta, status: 'failed' } })
  }

  // 群文件：消息里只有 share id，先发 5004 问发送方要文件号，再用文件通道拉
  private receiveGroupFile(
    ip: string,
    conversation: ConversationInfo,
    groupId: string,
    msgId: number,
    text: string,
    file: PrivateGroupFileRef
  ): void {
    const service = this.privateService
    if (service === null) return
    const peer = this.peerForIp(ip)
    const saveDir = join(this.receiveDir, sanitizeFileName(peer.name) || '内网通')
    mkdirSync(saveDir, { recursive: true })
    const savePath = join(saveDir, sanitizeFileName(file.name) || '收到的文件')
    const fileTaskId = `gf${file.shareId.slice(0, 12)}`
    const now = Date.now()
    const meta = JSON.stringify({
      source: 'private-group-file',
      groupId,
      shareId: file.shareId,
      fileTaskId
    })
    const message = this.repos.messages.insertIncoming(
      conversation.id,
      file.name,
      msgId,
      'file',
      meta
    )
    this.repos.conversations.touch(conversation.id, message.createdAt, 1)
    this.emit({ type: 'message', message })
    this.emitConversation(conversation.id)
    const task: FileTaskInfo = {
      id: fileTaskId,
      messageId: message.id,
      conversationId: conversation.id,
      direction: 'in',
      name: file.name,
      size: file.size,
      mtime: 0,
      fileId: file.shareId,
      packetId: 0,
      path: savePath,
      state: 'offered',
      received: 0,
      error: '',
      createdAt: now,
      updatedAt: now
    }
    this.repos.files.upsert(task)
    this.emit({ type: 'file', file: task })
    const reqId = (this.groupRequestSeq = (this.groupRequestSeq + 1) >>> 0)
    this.groupDownloads.set(reqId, {
      ip,
      groupId,
      conversationId: conversation.id,
      messageId: message.id,
      fileTaskId,
      name: file.name,
      size: file.size,
      savePath,
      saveDir,
      text,
      sourcePath: file.path
    })
    service.sendShareDownload(ip, reqId, file.shareId)
    logStartup(`群文件请求 ${file.name} share=${file.shareId} 发送方=${ip}`)
  }

  // 成员来要文件：回文件号，之后它会连本机文件端口拉数据
  private handleGroupShareDownload(ip: string, reqId: number, shareId: string): void {
    const share = this.groupShares.get(shareId)
    if (share === undefined) {
      logStartup(`群文件请求 ${ip} 的 share ${shareId} 不在本机`)
      return
    }
    this.privateService?.sendShareDownloadRsp(
      ip,
      reqId,
      share.fileId,
      share.size,
      String(share.modified)
    )
    logStartup(`群文件应答 ${ip} 文件号=${share.fileId} 大小=${share.size}`)
  }

  // 群成员来要文件夹：回 5007、发 1020，然后连它的文件夹端口把清单和数据推过去
  private handleGroupFolderDownload(
    ip: string,
    reqId: number,
    shareId: string,
    channelId: string
  ): void {
    const service = this.privateService
    const transfer = this.privateFolders
    if (service === null || transfer === null) return
    const folder = this.groupShares.get(shareId)?.folder
    if (folder === undefined) {
      logStartup(`群文件夹请求 ${ip} 的 share ${shareId} 不在本机`)
      service.sendShareDownloadFolderRsp(ip, reqId, channelId, 1)
      return
    }
    service.sendShareDownloadFolderRsp(ip, reqId, channelId, 0)
    service.sendReverseFolderReq(ip, channelId)
    const advertised = service.peerFolderPort(ip)
    const port = advertised > 0 ? advertised : 9014
    const outgoing: OutgoingFolder = { ...folder, taskId: channelId }
    logStartup(`群文件夹推送 ${ip}:${port} 通道=${channelId} 大小=${outgoing.size}`)
    void transfer
      .send(ip, outgoing, port)
      .then(() => {
        logStartup(`群文件夹推送完成 通道=${channelId}`)
        this.settleGroupFolder(shareId, true)
      })
      .catch(async (error: unknown) => {
        if (port === 9014) {
          logStartup(`群文件夹推送失败：${(error as Error).message}`)
          this.settleGroupFolder(shareId, false)
          return
        }
        logStartup(`群文件夹推送：${port} 失败，改用 9014 重试`)
        try {
          await transfer.send(ip, outgoing, 9014)
          logStartup(`群文件夹推送完成 通道=${channelId}`)
          this.settleGroupFolder(shareId, true)
        } catch (retry: unknown) {
          logStartup(`群文件夹推送失败：${(retry as Error).message}`)
          this.settleGroupFolder(shareId, false)
        }
      })
  }

  // 成员推送全部结束后再决定气泡状态：有一个成功就算发出，全失败才标失败
  private settleGroupFolder(shareId: string, ok: boolean): void {
    const state = this.groupFolderStates.get(shareId)
    if (state === undefined) return
    if (ok) state.ok += 1
    else state.failed += 1
    if (state.ok + state.failed < state.total) return
    this.groupFolderStates.delete(shareId)
    if (state.ok > 0) return
    const message = this.repos.messages.getMessage(state.messageId)
    if (message === null) return
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(message.meta) as Record<string, unknown>
    } catch {
      meta = {}
    }
    const nextMeta = JSON.stringify({ ...meta, error: '成员都没能收到这个文件夹' })
    this.repos.messages.setMeta(message.id, nextMeta)
    this.repos.messages.setStatus(message.id, 'failed')
    this.emit({ type: 'message', message: { ...message, meta: nextMeta, status: 'failed' } })
  }

  // 发送方接受了文件夹请求：等它连过来推数据
  private handleGroupFolderResponse(
    ip: string,
    _reqId: number,
    err: number,
    channelId: string
  ): void {
    const ctx = this.groupFolderDownloads.get(channelId)
    if (ctx === undefined) return
    if (err !== 0) {
      this.groupFolderDownloads.delete(channelId)
      this.privateFolders?.forget(channelId)
      this.markGroupFolderFailed(ctx.messageId, `发送方拒绝（ERR=${err}）`)
      return
    }
    logStartup(`群文件夹已接受 ${ip} 通道=${channelId} 等待推送`)
  }

  // 发送方回了文件号：连它的文件端口，用文件通道把数据收下来
  private handleGroupShareResponse(
    ip: string,
    reqId: number,
    err: number,
    fileId: number,
    fileSize: number,
    lastModify: string
  ): void {
    const ctx = this.groupDownloads.get(reqId)
    this.groupDownloads.delete(reqId)
    const transfer = this.privateFiles
    const service = this.privateService
    if (ctx === undefined || transfer === null || service === null) return
    if (err !== 0 || fileId <= 0) {
      this.updateGroupFileTask(ctx.fileTaskId, 'failed', 0, `发送方拒绝（ERR=${err}）`)
      return
    }
    const port = service.peerFilePort(ip)
    if (port <= 0) {
      this.updateGroupFileTask(ctx.fileTaskId, 'failed', 0, '对端没有公布文件通道端口')
      return
    }
    this.privateFileTasks.set(fileId, {
      fileTaskId: ctx.fileTaskId,
      direction: 'in',
      taskId: String(fileId),
      ip
    })
    transfer.registerIncoming({
      fileId,
      name: ctx.name,
      size: fileSize,
      savePath: ctx.savePath,
      saveDir: ctx.saveDir
    })
    this.updateGroupFileTask(ctx.fileTaskId, 'transferring', 0, '')
    void this.receiveGroupFileFrom(transfer, ip, port, fileId, service.peerUserId(ip))
      .then(() => {
        this.handlePrivateFileDone(fileId, ctx.savePath)
        // 收完给发送方发回执，群里的其他成员据此看到“谁下载了”
        service.sendRemindFile(ip, ctx.groupId, ctx.size, ctx.sourcePath, false)
      })
      .catch((error: unknown) => {
        const message = (error as Error).message
        logStartup(`群文件接收失败 ${ctx.name} 文件号=${fileId}：${message}`)
        this.updateGroupFileTask(ctx.fileTaskId, 'failed', 0, message)
      })
    logStartup(
      `群文件开始接收 ${ctx.name} 文件号=${fileId} 大小=${fileSize} 修改时间=${lastModify}`
    )
  }

  // 真实客户端拉离线文件连的是对端的 9013，公布的文件端口反而可能是关的；先试 9013
  private async receiveGroupFileFrom(
    transfer: PrivateFileTransfer,
    ip: string,
    port: number,
    fileId: number,
    peerUserId: string
  ): Promise<void> {
    try {
      await transfer.receive(ip, 9013, fileId, peerUserId)
    } catch (error) {
      if (port === 9013 || port <= 0) throw error
      logStartup(`群文件接收 9013 失败，改用对端公布的 ${port} 重试`)
      await transfer.receive(ip, port, fileId, peerUserId)
    }
  }

  // 群成员下载完文件后的回执：把下载者名字写到发送方那条文件消息上
  private handleGroupFileRemind(
    ip: string,
    groupId: string,
    name: string,
    size: number,
    folder: boolean
  ): void {
    try {
      const base = name.split(/[\\/]/).pop() ?? name
      const conversationId = groupConversationId(groupId)
      let message: MessageInfo | null = null
      if (folder) {
        const candidates = this.repos.messages
          .listAll(conversationId)
          .filter(
            (item) => item.direction === 'out' && item.kind === 'folder' && item.text === base
          )
        message = candidates[candidates.length - 1] ?? null
      } else {
        const tasks = this.repos.files
          .list(conversationId)
          .filter(
            (task) => task.direction === 'out' && task.name === base && task.messageId !== null
          )
        const task = tasks[tasks.length - 1]
        if (task === undefined || task.messageId === null) return
        message = this.repos.messages.getMessage(task.messageId)
      }
      if (message === null) return
      let meta: Record<string, unknown>
      try {
        meta = JSON.parse(message.meta) as Record<string, unknown>
      } catch {
        meta = {}
      }
      const senderId = this.privateService?.peerUserId(ip) ?? ''
      const downloader =
        this.repos.groups.members(groupId).find((member) => member.userId === senderId)?.name ?? ip
      const previous = Array.isArray(meta.downloadedBy)
        ? (meta.downloadedBy as unknown[]).filter(
            (item): item is string => typeof item === 'string'
          )
        : []
      if (previous.includes(downloader)) return
      const nextMeta = JSON.stringify({
        ...meta,
        downloadedBy: [...previous, downloader]
      })
      this.repos.messages.setMeta(message.id, nextMeta)
      this.emit({ type: 'message', message: { ...message, meta: nextMeta } })
      logStartup(`群${folder ? '文件夹' : '文件'}回执 ${base} 下载者=${downloader} 大小=${size}`)
    } catch (error) {
      logStartup(`群文件回执处理失败：${(error as Error).message}`)
    }
  }

  // 群被解散或本端被踢：整段会话连消息一起移除，并像真实客户端那样弹窗告知原因
  private handleGroupRemoved(ip: string, groupId: string, reason: string): void {
    const group = this.repos.groups.get(groupId)
    const groupName = group?.name ?? '群聊'
    const masterName =
      this.repos.groups.members(groupId).find((member) => member.userId === group?.master)?.name ??
      '群主'
    logStartup(`私有群 ${ip} 收到${reason} 群=${groupName}`)
    this.removeGroupLocally(groupId, reason)
    if (reason === '被移出') {
      this.showInfoDialog(`您已被群主【${masterName}】从群【${groupName}】中移除。`)
    } else if (reason === '解散') {
      this.showInfoDialog(`群【${groupName}】已被群主【${masterName}】解散。`)
    }
  }

  private showInfoDialog(message: string): void {
    const window = this.window
    if (window === null) return
    void dialog.showMessageBox(window, {
      type: 'info',
      title: this.appInfo.name,
      message,
      buttons: ['确定'],
      noLink: true
    })
  }

  // 其它成员退群：从成员表里去掉他
  private handleGroupMemberExit(ip: string, groupId: string): void {
    const senderId = this.privateService?.peerUserId(ip) ?? ''
    const members = this.repos.groups
      .members(groupId)
      .filter((member) => member.userId !== senderId)
    logStartup(`私有群成员退群 ${ip} 群=${groupId} 剩余=${members.length}`)
    this.repos.groups.replaceMembers(groupId, members)
    this.emitGroup(groupId)
    this.emitConversation(groupConversationId(groupId))
  }

  // 成员来拉群资料：把本机保存的群资料回给他
  private handleGroupReqInfo(ip: string, groupId: string): void {
    const info = this.repos.groups.get(groupId)
    if (info === null) return
    this.privateService?.sendGroupInfoRsp(ip, {
      id: info.id,
      name: info.name,
      master: info.master,
      topic: info.topic,
      announcement: info.announcement,
      infoVersion: info.infoVersion,
      userVersion: info.userVersion,
      allowOtherAdd: info.allowOtherAdd,
      photoMd5: info.photoMd5
    })
  }

  private updateGroupFileTask(
    fileTaskId: string,
    state: FileTaskInfo['state'],
    received: number,
    error: string
  ): void {
    const task = this.repos.files.get(fileTaskId)
    if (task === null) return
    const next: FileTaskInfo = { ...task, state, received, error, updatedAt: Date.now() }
    this.repos.files.upsert(next)
    this.emit({ type: 'file', file: next })
  }

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
    // 邀请发出去就落到聊天记录，状态先置为已发送
    const message = this.repos.messages.insertOutgoing(
      conversationId,
      basename(path),
      this.nextPrivateMessageId(),
      'folder',
      JSON.stringify({
        source: 'private-folder',
        taskId,
        size: info.totalSize,
        count: info.items.length,
        dir: path
      })
    )
    this.folderLinks.set(taskId, { conversationId, messageId: message.id })
    this.repos.messages.setStatus(message.id, 'sent')
    this.repos.conversations.touch(conversationId, message.createdAt, 0)
    this.emit({ type: 'message', message: { ...message, status: 'sent' } })
    this.emitConversation(conversationId)
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
    const service = this.privateService
    return {
      local: {
        name: settings.identity.displayName,
        account: settings.identity.account,
        host: settings.identity.hostName,
        status: settings.identity.status,
        online: this.started,
        version: this.appInfo.version,
        privateUserId: privateUserId(settings)
      },
      peers: this.repos.peers.list().map((peer) => ({
        ...peer,
        ready: service?.isReady(peer.ip) ?? peer.ready,
        privateUserId: service?.peerUserId(peer.ip) ?? ''
      })),
      conversations,
      groups: this.repos.groups.list().map((group) => this.groupInfoOf(group.id)),
      files: this.repos.files.list(),
      staged: this.staged.all(),
      unread: conversations.reduce((total, item) => total + item.unread, 0)
    }
  }

  listMessages(request: MessagesListRequest): MessagesPage {
    return this.repos.messages.list(request.conversationId, request.beforeId, request.limit ?? 50)
  }

  listAllMessages(conversationId: string): MessageInfo[] {
    return this.repos.messages.listAll(conversationId)
  }

  sendText(request: MessagesSendRequest): SendTextResult {
    const conversation = this.repos.conversations.get(request.conversationId)
    if (conversation === null) {
      throw new Error('会话不存在')
    }
    if (conversation.kind === 'group') {
      return this.sendGroupText(conversation, request.text)
    }
    if (conversation.peerKey === null) {
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

  // 群消息逐个成员投递：按成员的用户号找到对端 IP，只发给会话就绪的人
  private sendGroupText(conversation: ConversationInfo, text: string): SendTextResult {
    const groupId = conversation.id.startsWith('group:') ? conversation.id.slice(6) : ''
    const service = this.privateService
    if (groupId === '' || service === null) {
      throw new Error('内网通私有会话未就绪')
    }
    const members = this.repos.groups.members(groupId)
    const selfId = privateUserId(this.settings.get())
    const msgId = this.allocatePrivateSeq()
    let delivered = 0
    for (const member of members) {
      if (member.userId === selfId) continue
      const ip = service.peerIpByUserId(member.userId)
      if (ip === null) continue
      if (service.isReady(ip) && service.sendGroupMessage(ip, groupId, msgId, text)) {
        delivered += 1
      }
    }
    if (delivered === 0) {
      throw new Error('群成员都不在线')
    }
    const meta = JSON.stringify({ source: 'private-group', groupId })
    return { message: this.recordOutgoing(conversation.id, text, msgId, 'sent', meta) }
  }

  private recordOutgoing(
    conversationId: string,
    text: string,
    remoteSeq: number,
    status?: string,
    meta = '{}'
  ): MessageInfo {
    const message = this.repos.messages.insertOutgoing(
      conversationId,
      text,
      remoteSeq,
      'text',
      meta
    )
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

  // 建群：群号由本机生成，群主是本机的私有用户号，成员表整份推给每个成员
  createGroup(name: string, memberUserIds: string[]): GroupInfo {
    const title = name.trim()
    if (title === '') throw new Error('群名称不能为空')
    const service = this.privateService
    if (service === null) throw new Error('内网通私有会话未就绪')
    const selfId = privateUserId(this.settings.get())
    const targets = this.resolveGroupTargets(service, memberUserIds, selfId)
    if (targets.length === 0) throw new Error('至少选择一个在线的成员')
    const members: PrivateGroupMember[] = [
      { userId: selfId, name: this.settings.get().identity.displayName },
      ...targets.map((target) => ({ userId: target.userId, name: target.name }))
    ]
    const groupId = randomBytes(16).toString('hex')
    const info: PrivateGroupInfo = {
      id: groupId,
      name: title,
      master: selfId,
      topic: '',
      announcement: '',
      infoVersion: 1,
      userVersion: 1,
      allowOtherAdd: 0,
      photoMd5: ''
    }
    for (const target of targets) {
      service.sendGroupPushUser(target.ip, info, members)
    }
    this.storeGroup(info, members)
    const conversation = this.repos.conversations.ensureGroup(groupId, title)
    this.repos.conversations.setTitle(conversation.id, title)
    this.emitConversation(conversation.id)
    this.emitGroup(groupId)
    logStartup(`私有群新建 ${title} 群号=${groupId} 成员=${members.length}`)
    return this.groupInfoOf(groupId)
  }

  // 拉人：成员表整份重推，版本号加一
  inviteToGroup(groupId: string, memberUserIds: string[]): void {
    const service = this.privateService
    if (service === null) throw new Error('内网通私有会话未就绪')
    const group = this.requireGroup(groupId)
    const selfId = privateUserId(this.settings.get())
    if (group.master !== selfId) {
      throw new Error('只有群主可以邀请成员')
    }
    const members = this.repos.groups.members(groupId)
    const known = new Set(members.map((member) => member.userId))
    const candidates = memberUserIds.filter((userId) => !known.has(userId))
    const targets = this.resolveGroupTargets(service, candidates, selfId)
    if (targets.length === 0) throw new Error('成员已经在群里或不在线')
    for (const target of targets) {
      members.push({ userId: target.userId, name: target.name })
    }
    const info = this.privateInfoOf(group)
    info.userVersion += 1
    for (const member of members) {
      if (member.userId === selfId) continue
      const ip = service.peerIpByUserId(member.userId)
      if (ip === null) continue
      service.sendGroupPushUser(ip, info, members)
    }
    this.storeGroup(info, members)
    this.emitGroup(groupId)
    this.emitConversation(groupConversationId(groupId))
    logStartup(`私有群拉人 群号=${groupId} 新增=${targets.length}`)
  }

  // 踢人：被踢的人收到 3010，剩下的成员收到新的成员表
  kickFromGroup(groupId: string, userId: string): void {
    const service = this.privateService
    if (service === null) throw new Error('内网通私有会话未就绪')
    const group = this.requireGroup(groupId)
    const selfId = privateUserId(this.settings.get())
    if (group.master !== selfId) throw new Error('只有群主可以移出成员')
    if (userId === selfId) throw new Error('不能把自己移出群')
    const targetIp = service.peerIpByUserId(userId)
    if (targetIp === null || !service.isReady(targetIp)) throw new Error('该成员不在线')
    const members = this.repos.groups.members(groupId).filter((member) => member.userId !== userId)
    const info = this.privateInfoOf(group)
    info.userVersion += 1
    service.sendGroupKick(targetIp, groupId)
    for (const member of members) {
      if (member.userId === selfId) continue
      const ip = service.peerIpByUserId(member.userId)
      if (ip === null) continue
      service.sendGroupPushUser(ip, info, members)
    }
    this.storeGroup(info, members)
    this.emitGroup(groupId)
    this.emitConversation(groupConversationId(groupId))
    logStartup(`私有群移出成员 群号=${groupId} 用户=${userId}`)
  }

  // 退群：本机不是群主时才允许，其余成员收到 3009
  leaveGroup(groupId: string): void {
    const service = this.privateService
    const group = this.requireGroup(groupId)
    const selfId = privateUserId(this.settings.get())
    if (group.master === selfId) throw new Error('群主不能退群，请改为解散群')
    const members = this.repos.groups.members(groupId)
    for (const member of members) {
      if (member.userId === selfId) continue
      const ip = service?.peerIpByUserId(member.userId) ?? null
      if (ip === null) continue
      service?.sendGroupExit(ip, groupId)
    }
    this.removeGroupLocally(groupId, '退群')
  }

  // 解散：群主把 3008 发给其余成员，然后本地删掉整个群
  dismissGroup(groupId: string): void {
    const service = this.privateService
    const group = this.requireGroup(groupId)
    const selfId = privateUserId(this.settings.get())
    if (group.master !== selfId) throw new Error('只有群主可以解散群')
    const members = this.repos.groups.members(groupId)
    for (const member of members) {
      if (member.userId === selfId) continue
      const ip = service?.peerIpByUserId(member.userId) ?? null
      if (ip === null) continue
      service?.sendGroupDismiss(ip, groupId)
    }
    this.removeGroupLocally(groupId, '解散')
  }

  // 群成员只能是在线的私有对端；离线的人收不到 3003
  private resolveGroupTargets(
    service: PrivateService,
    memberUserIds: string[],
    selfId: string
  ): Array<{ ip: string; userId: string; name: string }> {
    const targets: Array<{ ip: string; userId: string; name: string }> = []
    for (const userId of new Set(memberUserIds)) {
      if (userId === '' || userId === selfId) continue
      const ip = service.peerIpByUserId(userId)
      if (ip === null || !service.isReady(ip)) {
        throw new Error('成员不在线')
      }
      targets.push({ ip, userId, name: this.peerNameByUserId(userId) })
    }
    return targets
  }

  private peerNameByUserId(userId: string): string {
    const ip = this.privateService?.peerIpByUserId(userId) ?? null
    if (ip === null) return userId.slice(0, 8)
    const peer = this.peerForIp(ip)
    return peer.name || ip
  }

  private requireGroup(groupId: string): QGroupInfo {
    const group = this.repos.groups.get(groupId)
    if (group === null) throw new Error('群不存在')
    return group
  }

  private privateInfoOf(group: {
    id: string
    name: string
    master: string
    topic: string
    announcement: string
    infoVersion: number
    userVersion: number
    allowOtherAdd: number
    photoMd5: string
  }): PrivateGroupInfo {
    return {
      id: group.id,
      name: group.name,
      master: group.master,
      topic: group.topic,
      announcement: group.announcement,
      infoVersion: group.infoVersion,
      userVersion: group.userVersion,
      allowOtherAdd: group.allowOtherAdd,
      photoMd5: group.photoMd5
    }
  }

  private storeGroup(info: PrivateGroupInfo, members: PrivateGroupMember[]): void {
    this.repos.groups.upsert({ ...info, updatedAt: Date.now() })
    this.repos.groups.replaceMembers(info.id, members)
  }

  private groupInfoOf(groupId: string): GroupInfo {
    const group = this.repos.groups.get(groupId)
    const members = this.repos.groups.members(groupId)
    const list: GroupMemberInfo[] = members.map((member) => ({
      userId: member.userId,
      name: member.name
    }))
    if (group === null) {
      return {
        id: groupId,
        name: '群聊',
        master: '',
        topic: '',
        announcement: '',
        infoVersion: 0,
        userVersion: 0,
        members: list
      }
    }
    return {
      id: group.id,
      name: group.name,
      master: group.master,
      topic: group.topic,
      announcement: group.announcement,
      infoVersion: group.infoVersion,
      userVersion: group.userVersion,
      members: list
    }
  }

  private emitGroup(groupId: string): void {
    this.emit({ type: 'group', group: this.groupInfoOf(groupId) })
  }

  private removeGroupLocally(groupId: string, reason: string): void {
    const conversationId = groupConversationId(groupId)
    const group = this.repos.groups.get(groupId)
    logStartup(`私有群${reason} 群号=${groupId} 群=${group?.name ?? ''}`)
    this.repos.groups.remove(groupId)
    this.repos.conversations.remove(conversationId)
    this.emit({ type: 'conversation-removed', conversationId })
  }

  listFiles(conversationId?: string): AppSnapshot['files'] {
    return this.repos.files.list(conversationId)
  }

  listFavorites(): FavoriteSticker[] {
    return this.favorites.list()
  }

  addFavorite(fileId: string): FavoriteSticker {
    const task = this.repos.files.get(fileId)
    if (task === null || task.path === '') {
      throw new Error('图片尚未接收完成')
    }
    return this.favorites.add(task.path)
  }

  removeFavorite(id: string): void {
    this.favorites.remove(id)
  }

  // 收藏的表情加进待发区，和图片一起发送
  stageFavorite(conversationId: string, id: string): StagedAttachment[] {
    const path = this.favorites.filePath(id)
    if (path === null) throw new Error('收藏的表情已被删除')
    return this.addStaged(conversationId, [
      {
        path,
        name: basename(path),
        size: statSync(path).size,
        kind: 'image',
        temporary: false,
        sticker: true
      }
    ])
  }

  emotionPath(id: string): string | null {
    return this.favorites.filePath(id)
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
    if (conversation === null) {
      throw new Error('会话不存在')
    }
    if (conversation.kind === 'group') {
      throw new Error('群聊暂时只支持粘贴图片')
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
  // 剪贴板里的图片先落盘进待发区，按原图格式发送；群聊同样先存进待发区
  async pasteStaged(conversationId: string): Promise<StagedAttachment[]> {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null) {
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
    if (conversation === null) {
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
  stageBytes(
    conversationId: string,
    name: string,
    data: ArrayBuffer,
    sticker = false
  ): StagedAttachment[] {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null) {
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
        temporary: true,
        ...(sticker ? { sticker: true } : {})
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
    const conversation = this.repos.conversations.get(conversationId)
    // 图片与表情合并成一条消息，其余附件各自发送
    const entries = this.staged.list(conversationId)
    const images = entries.filter((entry) => entry.kind === 'image')
    if (images.length > 0) {
      const paths: string[] = []
      for (const entry of images) {
        const file = this.staged.file(entry.id)
        if (file === undefined) continue
        paths.push(file.path)
      }
      if (paths.length > 0) {
        const sticker = images.every((entry) => entry.sticker === true)
        if (conversation !== null && conversation.kind === 'group') {
          this.sendGroupImages(conversation, paths, sticker)
        } else {
          this.sendFiles(conversationId, paths, '', sticker)
        }
      }
      for (const entry of images) {
        this.staged.take(conversationId, entry.id)
      }
      logStartup(
        `待发区发出 ${paths.length} 张图片，剩余 ${this.staged.list(conversationId).length} 个`
      )
      this.emitStaged(conversationId)
    }
    for (;;) {
      const entry = this.staged.list(conversationId)[0]
      if (entry === undefined) break
      const file = this.staged.file(entry.id)
      if (file === undefined) {
        this.staged.take(conversationId, entry.id)
        this.emitStaged(conversationId)
        continue
      }
      if (conversation !== null && conversation.kind === 'group') {
        // 群里的文件走离线文件：发送前把文件登记成可被成员拉取的 share
        if (entry.kind === 'folder') {
          this.sendGroupFolder(conversation, file.path)
        } else {
          this.sendGroupFiles(conversation, [file.path])
        }
      } else if (entry.kind === 'folder') {
        await this.sendFolder(conversationId, file.path)
      } else {
        this.sendFiles(conversationId, [file.path])
      }
      this.staged.take(conversationId, entry.id)
      logStartup(`待发区发出 ${entry.name}，剩余 ${this.staged.list(conversationId).length} 个`)
      this.emitStaged(conversationId)
    }
  }

  // 群图片：一条群消息里的 img 卡片，按成员逐个投递，谁发 1019 就把原图推给谁
  // 群文件：登记成 share 后发一条带 file2 的群消息，成员按 share id 来拉
  private sendGroupFiles(conversation: ConversationInfo, paths: string[]): void {
    const groupId = conversation.id.startsWith('group:') ? conversation.id.slice(6) : ''
    const service = this.privateService
    const transfer = this.privateFiles
    if (groupId === '' || service === null || transfer === null) {
      throw new Error('内网通私有会话未就绪')
    }
    const selfId = privateUserId(this.settings.get())
    const targets: string[] = []
    for (const member of this.repos.groups.members(groupId)) {
      if (member.userId === selfId) continue
      const ip = service.peerIpByUserId(member.userId)
      if (ip !== null && service.isReady(ip)) targets.push(ip)
    }
    if (targets.length === 0) {
      throw new Error('群成员都不在线')
    }
    for (const path of paths) {
      const stats = statSync(path)
      if (!stats.isFile()) continue
      const fileId = this.nextFileId()
      const shareId = randomBytes(16).toString('hex')
      const name = basename(path)
      const fileTaskId = `pf${fileId}`
      transfer.registerOutgoing({ fileId, path, size: stats.size })
      this.privateFileTasks.set(fileId, {
        fileTaskId,
        direction: 'out',
        taskId: String(fileId),
        ip: targets[0] ?? ''
      })
      this.groupShares.set(shareId, {
        fileId,
        size: stats.size,
        modified: Math.floor(stats.mtimeMs / 1000)
      })
      const message = this.repos.messages.insertOutgoing(
        conversation.id,
        name,
        this.nextPrivateMessageId(),
        'file',
        JSON.stringify({ source: 'private-group-file', groupId, shareId, fileTaskId })
      )
      this.fileLinks.set(fileTaskId, { conversationId: conversation.id, messageId: message.id })
      this.repos.messages.setStatus(message.id, 'sent')
      this.repos.conversations.touch(conversation.id, message.createdAt, 0)
      this.emit({ type: 'message', message: { ...message, status: 'sent' } })
      this.emitConversation(conversation.id)
      const now = Date.now()
      const task: FileTaskInfo = {
        id: fileTaskId,
        messageId: message.id,
        conversationId: conversation.id,
        direction: 'out',
        name,
        size: stats.size,
        mtime: Math.floor(stats.mtimeMs / 1000),
        fileId: String(fileId),
        packetId: 0,
        path,
        state: 'offered',
        received: 0,
        error: '',
        createdAt: now,
        updatedAt: now
      }
      this.repos.files.upsert(task)
      this.emit({ type: 'file', file: task })
      for (const ip of targets) {
        service.sendGroupFile(ip, {
          groupId,
          msgId: message.id,
          shareId,
          size: stats.size,
          path,
          folder: false
        })
      }
      logStartup(`群文件已发 ${name} 文件号=${fileId} 成员=${targets.length}`)
    }
  }

  // 群文件夹：登记成 share 后发一条带 offline_folder 的群消息，成员按 share id 来要
  private sendGroupFolder(conversation: ConversationInfo, path: string): void {
    const groupId = conversation.id.startsWith('group:') ? conversation.id.slice(6) : ''
    const service = this.privateService
    if (groupId === '' || service === null) {
      throw new Error('内网通私有会话未就绪')
    }
    const selfId = privateUserId(this.settings.get())
    const targets: string[] = []
    for (const member of this.repos.groups.members(groupId)) {
      if (member.userId === selfId) continue
      const ip = service.peerIpByUserId(member.userId)
      if (ip !== null && service.isReady(ip)) targets.push(ip)
    }
    if (targets.length === 0) {
      throw new Error('群成员都不在线')
    }
    const info = scanFolder(path)
    const name = basename(path)
    const shareId = randomBytes(16).toString('hex')
    this.groupShares.set(shareId, {
      fileId: 0,
      size: info.totalSize,
      modified: Math.floor(statSync(path).mtimeMs / 1000),
      folder: {
        taskId: '',
        name: path,
        root: path,
        size: info.totalSize,
        items: info.items.map((item) => ({
          name: item.name,
          dir: item.dir,
          size: item.size,
          time: item.time
        }))
      }
    })
    const message = this.repos.messages.insertOutgoing(
      conversation.id,
      name,
      this.nextPrivateMessageId(),
      'folder',
      JSON.stringify({
        source: 'private-group-folder',
        groupId,
        shareId,
        size: info.totalSize,
        count: info.items.length,
        dir: path
      })
    )
    this.repos.messages.setStatus(message.id, 'sent')
    this.repos.conversations.touch(conversation.id, message.createdAt, 0)
    this.emit({ type: 'message', message: { ...message, status: 'sent' } })
    this.emitConversation(conversation.id)
    this.groupFolderStates.set(shareId, {
      messageId: message.id,
      total: targets.length,
      ok: 0,
      failed: 0
    })
    for (const ip of targets) {
      service.sendGroupFile(ip, {
        groupId,
        msgId: message.id,
        shareId,
        // 真实客户端的文件夹消息里大小固定写 0，总大小以文件夹通道的开场帧为准
        size: 0,
        path,
        folder: true
      })
    }
    logStartup(`群文件夹已发 ${name} share=${shareId} 成员=${targets.length}`)
  }

  private sendGroupImages(conversation: ConversationInfo, paths: string[], sticker = false): void {
    const groupId = conversation.id.startsWith('group:') ? conversation.id.slice(6) : ''
    const service = this.privateService
    const transfer = this.privateFiles
    if (groupId === '' || service === null || transfer === null) {
      throw new Error('内网通私有会话未就绪')
    }
    const selfId = privateUserId(this.settings.get())
    const targets: Array<{ ip: string }> = []
    for (const member of this.repos.groups.members(groupId)) {
      if (member.userId === selfId) continue
      const ip = service.peerIpByUserId(member.userId)
      if (ip !== null && service.isReady(ip)) targets.push({ ip })
    }
    if (targets.length === 0) {
      throw new Error('群成员都不在线')
    }
    const messageId = this.nextPrivateMessageId()
    const values: string[] = []
    const tasks: FileTaskInfo[] = []
    for (const path of paths) {
      const stats = statSync(path)
      if (!stats.isFile()) continue
      const fileId = this.nextFileId()
      const value = `${fileId}|${fileMd5(path)}`
      transfer.registerOutgoing({ fileId, path, size: stats.size, window: value })
      const fileTaskId = `pf${fileId}`
      const now = Date.now()
      tasks.push({
        id: fileTaskId,
        messageId: 0,
        conversationId: conversation.id,
        direction: 'out',
        name: basename(path),
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
      })
      values.push(value)
      const pushes = targets.map((target) => ({
        ip: target.ip,
        taskId: this.nextPrivateTaskId(target.ip)
      }))
      this.privateImagePushes.set(fileId, pushes)
      this.privateFileTasks.set(fileId, {
        fileTaskId,
        direction: 'out',
        taskId: pushes[0]?.taskId ?? '',
        ip: pushes[0]?.ip ?? ''
      })
    }
    if (values.length === 0) return
    const message = this.repos.messages.insertOutgoing(
      conversation.id,
      '[图片]',
      messageId,
      'text',
      JSON.stringify({
        source: 'private-image',
        files: tasks.map((task) => task.id),
        groupId,
        ...(sticker ? { sticker: true } : {})
      })
    )
    this.repos.messages.setStatus(message.id, 'sent')
    // 先把文件任务交给渲染进程，气泡第一次渲染时就能拿到图片地址
    for (const task of tasks) {
      task.messageId = message.id
      this.fileLinks.set(task.id, { conversationId: conversation.id, messageId: message.id })
      this.repos.files.upsert(task)
      this.emit({ type: 'file', file: task })
    }
    this.repos.conversations.touch(conversation.id, message.createdAt, 0)
    this.emit({ type: 'message', message: { ...message, status: 'sent' } })
    this.emitConversation(conversation.id)
    for (const target of targets) {
      service.sendGroupImage(target.ip, groupId, message.id, values)
    }
    logStartup(`群图片已发卡片 ${values.length} 张 成员=${targets.length}`)
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

  sendFiles(conversationId: string, paths: string[], text = '', sticker = false): void {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    if (!this.settings.get().network.ipmsg) {
      this.sendFilesPrivate(conversationId, paths, sticker)
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
  private sendFilesPrivate(conversationId: string, paths: string[], sticker = false): void {
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
    const images = paths.filter((path) => isImagePath(basename(path)))
    if (images.length > 0) {
      this.sendPrivateImages(conversation, peer.ip, peer.key, images, sticker)
    }
    const files = paths.filter((path) => !isImagePath(basename(path)))
    if (files.length === 0) return
    const peerPort = service.peerFilePort(peer.ip)
    if (peerPort <= 0) {
      throw new Error('对端没有公布文件通道端口')
    }
    for (const path of files) {
      const stats = statSync(path)
      if (!stats.isFile()) {
        continue
      }
      const fileId = this.nextFileId()
      const taskId = this.nextPrivateTaskId(peer.ip)
      const name = basename(path)
      const offer = {
        taskId,
        fileId,
        name: path,
        size: stats.size,
        lastModify: fileTimeFromMs(stats.mtimeMs)
      }
      transfer.registerOutgoing({ fileId, path, size: stats.size })
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
      if (!service.sendFileOffer(peer.ip, offer)) {
        throw new Error('内网通私有会话未就绪')
      }
      service.sendOperateSendFile(peer.ip, taskId, 2)
      this.repos.files.upsert(task)
      this.handleFileUpdate(task)
    }
  }

  // 多张图片（包括表情）合并成一条消息发出，对端会按 dt 里的多个 img 节点取图
  private sendPrivateImages(
    conversation: ConversationInfo,
    ip: string,
    peerKey: string,
    paths: string[],
    sticker: boolean
  ): void {
    const service = this.privateService
    const transfer = this.privateFiles
    if (service === null || transfer === null) return
    const messageId = this.nextPrivateMessageId()
    const values: string[] = []
    const tasks: FileTaskInfo[] = []
    for (const path of paths) {
      const stats = statSync(path)
      if (!stats.isFile()) continue
      const fileId = this.nextFileId()
      const taskId = this.nextPrivateTaskId(ip)
      const value = `${fileId}|${fileMd5(path)}`
      transfer.registerOutgoing({ fileId, path, size: stats.size, window: value })
      const fileTaskId = `pf${fileId}`
      this.privateFileTasks.set(fileId, { fileTaskId, direction: 'out', taskId, ip })
      const now = Date.now()
      tasks.push({
        id: fileTaskId,
        messageId: 0,
        conversationId: conversation.id,
        peerKey,
        direction: 'out',
        name: basename(path),
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
      })
      values.push(value)
      this.privateImagePushes.set(fileId, [{ ip, taskId }])
    }
    if (values.length === 0) return
    const meta = JSON.stringify({
      source: 'private-image',
      files: tasks.map((task) => task.id),
      ...(sticker ? { sticker: true } : {})
    })
    const message = this.repos.messages.insertOutgoing(
      conversation.id,
      '[图片]',
      messageId,
      'text',
      meta
    )
    // 先把文件任务交给渲染进程，气泡第一次渲染时就能拿到图片地址
    for (const task of tasks) {
      task.messageId = message.id
      this.fileLinks.set(task.id, { conversationId: conversation.id, messageId: message.id })
      this.repos.files.upsert(task)
      this.handleFileUpdate(task)
    }
    this.repos.conversations.touch(conversation.id, message.createdAt, 0)
    service.sendImageCard(ip, message.id, values)
    this.repos.messages.setStatus(message.id, 'sent')
    this.emit({ type: 'message', message: { ...message, status: 'sent' } })
    this.emitConversation(conversation.id)
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

  // 把图片本身放进剪贴板，方便直接粘到别的程序里
  async copyImage(id: string): Promise<void> {
    const task = this.repos.files.get(id)
    if (task === null || task.path === '' || !existsSync(task.path)) {
      throw new Error('图片文件已被移动或删除')
    }
    const type = imageMimeOf(task.name)
    if (type === '') {
      throw new Error('这张图片的格式不支持复制')
    }
    const data = readFileSync(task.path)
    await clipboard.write([new ClipboardItem({ [type]: new Blob([data], { type }) })])
  }

  // 文件夹消息里的“打开文件夹”：只接受真实存在的目录
  async openPath(path: string): Promise<void> {
    if (path === '' || !existsSync(path) || !statSync(path).isDirectory()) {
      throw new Error('文件夹已被移动或删除')
    }
    const error = await shell.openPath(path)
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

  revealPath(path: string): void {
    if (path === '' || !existsSync(path)) {
      throw new Error('文件已被移动或删除')
    }
    shell.showItemInFolder(path)
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
    const stickers = images.filter((ref) => ref.sticker === true)
    const photos = images.filter((ref) => ref.sticker !== true)
    const metaRecord: Record<string, unknown> = { source: 'private', msgId: String(msgId) }
    if (stickers.length > 0) metaRecord.sticker = stickers[0].value
    const meta = JSON.stringify(metaRecord)
    const body = text === '' && stickers.length > 0 ? '[表情]' : text
    const message = this.handleIncoming(peerKey, peer?.alias || peer?.name || ip, body, msgId, meta)
    if (photos.length > 0) {
      this.requestImages(ip, message.id, photos)
    }
  }

  // 图片消息只带发送方缓存里的编号，先回 retrieve 消息请对方推原图，
  // 再按几种可能的操作指令依次探测，哪种能触发 1009 一看抓包就知道
  private requestImages(
    ip: string,
    messageId: number,
    images: PrivateImageRef[],
    conversationId?: string
  ): void {
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
      this.registerImageTask(ip, messageId, ref, conversationId)
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
  private registerImageTask(
    ip: string,
    messageId: number,
    ref: PrivateImageRef,
    conversationId?: string
  ): void {
    const transfer = this.privateFiles
    if (transfer === null) return
    const fileTaskId = `pf${ref.id}`
    if (this.privateIncomingFiles.has(fileTaskId)) return
    const peer = this.peerForIp(ip)
    const saveDir = join(this.receiveDir, sanitizeFileName(peer.name) || '内网通')
    mkdirSync(saveDir, { recursive: true })
    const savePath = join(saveDir, `image-${ref.id}.png`)
    const conversation =
      conversationId === undefined
        ? this.repos.conversations.ensureDirect(peer.key, peer.name)
        : (this.repos.conversations.get(conversationId) ??
          this.repos.conversations.ensureDirect(peer.key, peer.name))
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
      // 图片的 1019 用对端自己的任务号，按“这个对端待推的图片”匹配
      let matched: number | null = null
      for (const [candidate, pushes] of this.privateImagePushes) {
        if (pushes.some((push) => push.ip === ip)) {
          matched = candidate
          break
        }
      }
      if (matched === null) return
      fileId = matched
      fileTaskId = `pf${fileId}`
      const pushes = this.privateImagePushes.get(fileId) ?? []
      const remaining = pushes.filter((push) => push.ip !== ip)
      if (remaining.length === 0) this.privateImagePushes.delete(fileId)
      else this.privateImagePushes.set(fileId, remaining)
    }
    const reverseKey = `${fileId}:${ip}`
    if (this.privateReverseStarted.has(reverseKey)) return
    const transfer = this.privateFiles
    const service = this.privateService
    if (transfer === null || service === null) return
    const reversePort = service.peerReversePort(ip)
    if (reversePort <= 0) {
      this.updatePrivateFileTask(fileTaskId, 'failed', 0, '对端没有公布反向文件端口')
      return
    }
    this.privateReverseStarted.add(reverseKey)
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
    const saved = entry.direction === 'in' ? this.normalizeReceivedImage(path) : path
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
      saved
    )
    this.privateFileTasks.delete(fileId)
  }

  // 收到的图片存成 image-<编号>.png；按文件头把扩展名改回真实格式，GIF 才能动
  private normalizeReceivedImage(path: string): string {
    if (!path.toLowerCase().endsWith('.png') || !existsSync(path)) return path
    let handle: number | null = null
    try {
      handle = openSync(path, 'r')
      const header = Buffer.alloc(12)
      const read = readSync(handle, header, 0, 12, 0)
      const extension = imageExtensionFromMagic(header.subarray(0, read))
      if (extension === '' || extension === 'png') return path
      const dir = dirname(path)
      const target = join(dir, uniqueName(dir, basename(path).replace(/\.png$/i, `.${extension}`)))
      renameSync(path, target)
      logStartup(`图片格式 ${extension}，改存为 ${basename(target)}`)
      return target
    } catch (error) {
      logStartup(`图片扩展名还原失败：${(error as Error).message}`)
      return path
    } finally {
      if (handle !== null) closeSync(handle)
    }
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
