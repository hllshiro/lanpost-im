import { basename, join } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AppEvent,
  AppSnapshot,
  FileTaskInfo,
  MessageMeta,
  MessagesPage,
  PeerInfo,
  SendTextResult
} from '../shared/domain'
import type { AppInfo, MessagesListRequest, MessagesSendRequest } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { ProtocolEngine, toPeerInfo, type ProtocolPeer } from './protocol/engine'
import { FILE_ATTR_REGULAR, type Attachment } from './protocol/attach'
import { FileManager } from './files/manager'
import { NotificationManager } from './notify/manager'
import { createRepositories, directConversationId, type Repositories } from './store/repositories'
import { importLegacyHistory } from './store/import'
import type { SettingsStore } from './settings/store'
import { logStartup } from './startup-log'

function engineConfig(settings: Settings): ConstructorParameters<typeof ProtocolEngine>[0] {
  return {
    name: settings.identity.displayName,
    account: settings.identity.account,
    host: settings.identity.hostName,
    group: settings.identity.group,
    status: settings.identity.status,
    port: settings.network.port,
    bindAddr: settings.network.bindAddr,
    subnets: settings.network.subnets,
    seeds: settings.network.seeds,
    broadcastInterval: settings.network.broadcastInterval,
    dialup: settings.network.dialup
  }
}

export class AppService {
  private readonly repos: Repositories
  private readonly engine: ProtocolEngine
  private readonly fileManager: FileManager
  private readonly notifications: NotificationManager
  private window: BrowserWindow | null = null
  private started = false
  private filesStarted = false
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
    try {
      await this.fileManager.start()
      this.filesStarted = true
    } catch (error) {
      logStartup('file service start failed: ' + (error as Error).message)
    }
    await this.engine.start()
    this.started = true
    this.handlePeers(this.engine.getPeers())
    this.notifications.setUnread(this.unreadTotal())
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
    const seq = this.engine.sendText(peer.key, request.text)
    const message = this.repos.messages.insertOutgoing(conversation.id, request.text, seq)
    this.repos.messages.setStatus(message.id, 'sent')
    const updated = this.repos.messages.getMessage(message.id)
    if (updated === null) {
      throw new Error('消息写入后无法读取')
    }
    this.repos.conversations.touch(conversation.id, updated.createdAt, 0)
    this.emit({ type: 'message', message: updated })
    this.emitConversation(conversation.id)
    return { message: updated }
  }

  markRead(conversationId: string, messageId: number): void {
    this.repos.conversations.markRead(conversationId, messageId)
    this.emitConversation(conversationId)
    this.notifications.setUnread(this.unreadTotal())
  }

  unseal(messageId: number): SendTextResult {
    const message = this.repos.messages.getMessage(messageId)
    if (message === null) throw new Error('消息不存在')
    const conversation = this.repos.conversations.get(message.conversationId)
    if (conversation === null || conversation.peerKey === null) throw new Error('会话不存在')
    const meta: MessageMeta = { ...message.meta, opened: true }
    this.repos.messages.setMeta(messageId, meta)
    this.engine.sendReadMessage(conversation.peerKey, message.remoteSeq, meta.readCheck === true)
    const updated = this.repos.messages.getMessage(messageId)
    if (updated === null) throw new Error('消息更新后无法读取')
    this.emit({ type: 'message', message: updated })
    return { message: updated }
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

  broadcast(text: string): number {
    const targets = this.engine.sendBroadcast(text)
    for (const target of targets) {
      this.insertGroupMessage(target.peerKey, text, target.seq, { broadcast: true })
    }
    return targets.length
  }

  multicast(peerKeys: string[], text: string): number {
    const targets = this.engine.sendMulticast(peerKeys, text)
    for (const target of targets) {
      this.insertGroupMessage(target.peerKey, text, target.seq, { multicast: true })
    }
    return targets.length
  }

  private insertGroupMessage(
    peerKey: string,
    text: string,
    seq: number,
    flags: { broadcast?: boolean; multicast?: boolean }
  ): void {
    const peer = this.repos.peers.get(peerKey)
    const conversation = this.repos.conversations.ensureDirect(
      peerKey,
      peer?.alias || peer?.name || peerKey
    )
    const meta: MessageMeta = { flags }
    const message = this.repos.messages.insertOutgoing(conversation.id, text, seq, 'text', meta)
    this.repos.messages.setStatus(message.id, 'sent')
    const updated = this.repos.messages.getMessage(message.id)
    this.repos.conversations.touch(conversation.id, message.createdAt, 0)
    if (updated !== null) this.emit({ type: 'message', message: updated })
    this.emitConversation(conversation.id)
  }

  async requestPeerInfo(peerKey: string): Promise<PeerInfo> {
    this.engine.requestInfo(peerKey)
    await new Promise((resolve) => setTimeout(resolve, 450))
    const peer = this.repos.peers.get(peerKey)
    if (peer === null) throw new Error('联系人不存在')
    this.emit({ type: 'peer', peer })
    return peer
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
      status: settings.identity.status,
      subnets: settings.network.subnets,
      seeds: settings.network.seeds,
      broadcastInterval: settings.network.broadcastInterval,
      dialup: settings.network.dialup
    })
    this.engine.updateStatus(settings.identity.status)
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
      const meta: MessageMeta = { files: [file.id] }
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

  private handleIncoming(peerKey: string, peerName: string, text: string, remoteSeq: number): void {
    const conversation = this.repos.conversations.ensureDirect(peerKey, peerName || peerKey)
    const message = this.repos.messages.insertIncoming(conversation.id, text, remoteSeq)
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

  private handleStatus(
    peerKey: string,
    seq: number,
    status: 'delivered' | 'read' | 'failed'
  ): void {
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
