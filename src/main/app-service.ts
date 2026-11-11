import { randomBytes } from 'node:crypto'
import { basename, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { isIPv4 } from 'node:net'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AppEvent,
  AppSnapshot,
  FileTaskInfo,
  MessageInfo,
  MessagesPage,
  SendTextResult
} from '../shared/domain'
import type { AppInfo, MessagesListRequest, MessagesSendRequest } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { ProtocolEngine, toPeerInfo, type ProtocolPeer } from './protocol/discovery'
import { FILE_ATTR_REGULAR, type Attachment } from './protocol/attach'
import type { PrivateProfile, RemoteProfile } from './protocol/private/messages'
import { PrivateService } from './protocol/private/service'
import type { SessionState } from './protocol/private/session'
import { FileManager } from './files/manager'
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

export class AppService {
  private readonly repos: Repositories
  private readonly engine: ProtocolEngine
  private readonly fileManager: FileManager
  private readonly notifications: NotificationManager
  private window: BrowserWindow | null = null
  private started = false
  private filesStarted = false
  private privateService: PrivateService | null = null
  private privateSeq = 0
  // 已经发过已读回执的消息 id，避免每次 markRead 重复发送
  private readonly privateReceipts = new Set<number>()
  private fileSeq = 0
  private fileRequestSeq = Math.floor(Date.now() / 1000) >>> 0
  private readonly fileLinks = new Map<string, { conversationId: string; messageId: number }>()

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
    this.engine = new ProtocolEngine(engineConfig(settings.get()), {
      onPeers: (peers) => this.handlePeers(peers),
      onMessage: (peer, text, remoteSeq) =>
        this.handleIncoming(peer.key, peer.name, text, remoteSeq),
      onFileOffer: (peer, packetId, text, attachments) =>
        this.handleFileOffer(peer, packetId, text, attachments),
      onMessageStatus: (peerKey, seq, status) => this.handleStatus(peerKey, seq, status),
      onLog: (message) => logStartup('protocol: ' + message),
      onError: (error) => logStartup('protocol error: ' + error.message)
    })
    this.notifications = new NotificationManager(settings, () => this.window)
  }

  attachWindow(window: BrowserWindow | null): void {
    this.window = window
  }

  async start(): Promise<void> {
    this.importLegacyHistory()
    this.ensurePrivateId()
    try {
      await this.fileManager.start()
      this.filesStarted = true
    } catch (error) {
      logStartup('file service start failed: ' + (error as Error).message)
    }
    await this.engine.start()
    this.started = true
    await this.startPrivateService()
    this.handlePeers(this.engine.getPeers())
    this.notifications.setUnread(this.unreadTotal())
  }

  // 私有通道的用户标识首次运行时生成并写进设置，之后一直沿用
  private ensurePrivateId(): void {
    if (this.settings.get().identity.privateId !== '') {
      return
    }
    this.settings.update({ identity: { privateId: createPrivateId() } })
  }

  // 私有通道失败只影响私有收发，IPMSG 依旧按原路径工作
  private async startPrivateService(): Promise<void> {
    const settings = this.settings.get()
    const service = new PrivateService({
      identity: { userId: privateUserId(settings), peerId: randomBytes(16) },
      profile: privateProfile(settings),
      bindAddr: settings.network.bindAddr,
      beaconPort: settings.network.privatePort,
      enetPort: 0,
      seeds: privateSeeds(settings),
      callbacks: {
        onText: (ip, msgId, text) => this.handlePrivateText(ip, msgId, text),
        onUnsupported: (ip, msgId) => logStartup(`私有通道收到暂不支持的消息 ${msgId}（${ip}）`),
        onAck: (ip, msgId) => this.handlePrivateStatus(ip, msgId, 'delivered'),
        onReceipt: (ip, msgId) => this.handlePrivateStatus(ip, msgId, 'read'),
        onState: (ip, state, profile) => this.handlePrivateState(ip, state, profile),
        onActivity: (ip) => this.engine.touchPrivatePeer(ip),
        onLog: (message) => logStartup('private: ' + message),
        onError: (error) => logStartup('private error: ' + error.message)
      }
    })
    try {
      await service.start()
    } catch (error) {
      logStartup('private service start failed: ' + (error as Error).message)
      return
    }
    this.privateService = service
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
    this.privateReceipts.clear()
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
    if (privateService !== null && privateService.isReady(peer.ip)) {
      const msgId = this.nextPrivateSeq()
      if (privateService.sendText(peer.ip, msgId, request.text)) {
        return { message: this.recordOutgoing(conversation.id, request.text, msgId) }
      }
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
  private nextPrivateSeq(): number {
    this.privateSeq = (this.privateSeq + 1) % 1000
    return Date.now() * 1000 + this.privateSeq
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
    for (const row of this.repos.messages.listPrivateIncoming(conversationId)) {
      if (row.id > messageId || this.privateReceipts.has(row.id)) {
        continue
      }
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
    this.engine.refresh()
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

  rejectFile(id: string): void {
    if (!this.filesStarted) {
      throw new Error('文件服务未启动')
    }
    this.fileManager.reject(id)
  }

  acceptFile(id: string): void {
    if (!this.filesStarted) {
      throw new Error('文件服务未启动')
    }
    void this.fileManager.accept(id).catch((error: unknown) => {
      logStartup('file accept failed: ' + (error instanceof Error ? error.message : String(error)))
    })
  }

  async pickAndSend(conversationId: string): Promise<void> {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    const result = await dialog.showOpenDialog({
      title: '发送文件',
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return
    }
    this.sendFiles(conversationId, result.filePaths)
  }

  sendFiles(conversationId: string, paths: string[], text = ''): void {
    const conversation = this.repos.conversations.get(conversationId)
    if (conversation === null || conversation.peerKey === null) {
      throw new Error('会话不存在')
    }
    if (!this.filesStarted) {
      throw new Error('文件服务未启动')
    }
    const peer = this.engine.getPeers().find((item) => item.key === conversation.peerKey)
    if (peer === undefined || !peer.online) {
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
    const result = await dialog.showSaveDialog({
      defaultPath: basename(task.path),
      title: '另存为'
    })
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

  private nextFileId(): number {
    this.fileSeq += 1
    return Date.now() * 1000 + (this.fileSeq % 1000)
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
  ): void {
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
  }

  private handleStatus(peerKey: string, seq: number, status: 'delivered' | 'read'): void {
    const conversationId = directConversationId(peerKey)
    const row = this.db
      .prepare(
        "SELECT id FROM messages WHERE conversation_id = ? AND direction = 'out' AND remote_seq = ? ORDER BY id DESC LIMIT 1"
      )
      .get(conversationId, seq) as { id: number } | undefined
    if (row === undefined) {
      return
    }
    this.repos.messages.setStatus(row.id, status)
    const message = this.repos.messages.getMessage(row.id)
    if (message !== null) {
      this.emit({ type: 'message', message })
    }
  }

  private handlePrivateText(ip: string, msgId: number, text: string): void {
    const peerKey = this.engine.peerKeyForIp(ip)
    if (peerKey === null) {
      logStartup(`忽略来自 ${ip} 的私有消息：没有对应的联系人`)
      return
    }
    const peer = this.repos.peers.get(peerKey)
    const meta = JSON.stringify({ source: 'private', msgId: String(msgId) })
    this.handleIncoming(peerKey, peer?.alias || peer?.name || ip, text, msgId, meta)
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
      return
    }
    if (state === 'closed') {
      this.engine.markPrivatePeerOffline(ip)
    }
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
