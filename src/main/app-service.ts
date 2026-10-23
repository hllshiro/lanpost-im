import { basename, join } from 'node:path'
import { copyFileSync, existsSync } from 'node:fs'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import type { AppEvent, AppSnapshot, MessagesPage, SendTextResult } from '../shared/domain'
import type { AppInfo, MessagesListRequest, MessagesSendRequest } from '../shared/ipc'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/settings'
import { ProtocolEngine, toPeerInfo } from './protocol/discovery'
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

export class AppService {
  private readonly repos: Repositories
  private readonly engine: ProtocolEngine
  private window: BrowserWindow | null = null
  private started = false

  constructor(
    private readonly db: DatabaseSync,
    private readonly settings: SettingsStore,
    private readonly appInfo: AppInfo
  ) {
    this.repos = createRepositories(db)
    this.engine = new ProtocolEngine(engineConfig(settings.get()), {
      onPeers: (peers) => this.handlePeers(peers),
      onMessage: (peer, text, remoteSeq) => this.handleIncoming(peer.key, peer.name, text, remoteSeq),
      onMessageStatus: (peerKey, seq, status) => this.handleStatus(peerKey, seq, status),
      onLog: (message) => logStartup('protocol: ' + message),
      onError: (error) => logStartup('protocol error: ' + error.message)
    })
  }

  attachWindow(window: BrowserWindow | null): void {
    this.window = window
  }

  async start(): Promise<void> {
    this.importLegacyHistory()
    await this.engine.start()
    this.started = true
    this.handlePeers(this.engine.getPeers())
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
    return this.repos.messages.list(
      request.conversationId,
      request.beforeId,
      request.limit ?? 50
    )
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
  }

  saveDraft(conversationId: string, draft: string): void {
    this.repos.conversations.saveDraft(conversationId, draft)
  }

  setAlias(peerKey: string, alias: string): void {
    this.repos.peers.setAlias(peerKey, alias)
    const conversationId = directConversationId(peerKey)
    const peer = this.repos.peers.get(peerKey)
    if (peer !== null) {
      this.db
        .prepare('UPDATE conversations SET title = ? WHERE id = ?')
        .run(alias.trim() === '' ? peer.name : alias, conversationId)
      this.emitConversation(conversationId)
    }
    this.emit({ type: 'peers', peers: this.repos.peers.list() })
  }

  listFiles(conversationId?: string): AppSnapshot['files'] {
    return this.repos.files.list(conversationId)
  }

  rejectFile(id: string): void {
    const task = this.repos.files.get(id)
    if (task === null) {
      throw new Error('文件任务不存在')
    }
    if (task.state !== 'waiting') {
      throw new Error('文件任务当前不可拒绝')
    }
    this.repos.files.updateState(id, 'rejected', task.received, '', task.path)
    this.emitFile(id)
  }

  acceptFile(id: string): void {
    const task = this.repos.files.get(id)
    if (task === null) {
      throw new Error('文件任务不存在')
    }
    throw new Error(`文件接收尚未接入协议层: ${task.name}`)
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
  }

  private handlePeers(peers: ReturnType<ProtocolEngine['getPeers']>): void {
    for (const peer of peers) {
      this.repos.peers.upsert(toPeerInfo(peer))
      const conversationId = directConversationId(peer.key)
      const existed = this.repos.conversations.get(conversationId) !== null
      const conversation = this.repos.conversations.ensureDirect(
        peer.key,
        peer.name || peer.user || peer.ip
      )
      if (!existed) {
        this.emit({ type: 'conversation', conversation })
      }
    }
    this.emit({ type: 'peers', peers: this.repos.peers.list() })
  }

  private handleIncoming(
    peerKey: string,
    peerName: string,
    text: string,
    remoteSeq: number
  ): void {
    const conversation = this.repos.conversations.ensureDirect(
      peerKey,
      peerName || peerKey
    )
    const message = this.repos.messages.insertIncoming(conversation.id, text, remoteSeq)
    this.repos.conversations.touch(conversation.id, message.createdAt, 1)
    this.emit({ type: 'message', message })
    this.emitConversation(conversation.id)
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

  private emitConversation(id: string): void {
    const conversation = this.repos.conversations.get(id)
    if (conversation !== null) {
      this.emit({ type: 'conversation', conversation })
    }
  }

  private emitFile(id: string): void {
    const file = this.repos.files.get(id)
    if (file !== null) {
      this.emit({ type: 'file', file })
    }
  }

  private emit(event: AppEvent): void {
    this.window?.webContents.send(IPC.event, event)
  }
}
