import type {
  AppEvent,
  AppSnapshot,
  FavoriteSticker,
  GroupInfo,
  MessagesPage,
  MessagesSearchResult,
  SendTextResult,
  StagedAttachment
} from './domain'
import type { Settings, SettingsPatch } from './settings'

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsDefaults: 'settings:defaults',
  settingsStartAtLogin: 'settings:start-at-login',
  shortcutsRecording: 'shortcuts:recording',
  shortcutsAvailable: 'shortcuts:available',
  firewallCheck: 'firewall:check',
  firewallRepair: 'firewall:repair',
  gatewayStatus: 'gateway:status',
  gatewayRotateToken: 'gateway:rotate-token',
  identityPickAvatar: 'identity:pick-avatar',
  identityClearAvatar: 'identity:clear-avatar',
  identityStatus: 'identity:status',
  storageImportNwtPreview: 'storage:import-nwt-preview',
  storageImportNwtApply: 'storage:import-nwt-apply',
  uiOpenSettings: 'ui:open-settings',
  uiNotify: 'ui:notify',
  uiSelectConversation: 'ui:select-conversation',
  uiToastList: 'ui:toast-list',
  uiJumpToConversation: 'ui:jump-to-conversation',
  uiPopupLeave: 'ui:popup-leave',
  uiPopupRows: 'ui:popup-rows',
  snapshot: 'state:snapshot',
  event: 'state:event',
  messagesList: 'messages:list',
  messagesSearch: 'messages:search',
  messagesAround: 'messages:around',
  messageSend: 'messages:send',
  messageRecall: 'messages:recall',
  messageTyping: 'messages:typing',
  conversationRead: 'conversation:read',
  conversationReadAll: 'conversation:read-all',
  conversationDraft: 'conversation:draft',
  conversationPin: 'conversation:pin',
  peerAlias: 'peer:alias',
  peerMerge: 'peers:merge',
  peerDelete: 'peers:delete',
  groupDelete: 'groups:delete',
  peersRefresh: 'peers:refresh',
  groupCreate: 'groups:create',
  groupAvatar: 'groups:avatar',
  groupInvite: 'groups:invite',
  groupKick: 'groups:kick',
  groupLeave: 'groups:leave',
  groupDismiss: 'groups:dismiss',
  emotionList: 'emotions:list',
  emotionAdd: 'emotions:add',
  emotionRemove: 'emotions:remove',
  emotionStage: 'emotions:stage',
  filesList: 'files:list',
  fileAccept: 'files:accept',
  fileReject: 'files:reject',
  fileCancel: 'files:cancel',
  fileAcceptFolder: 'files:accept-folder',
  fileRejectFolder: 'files:reject-folder',
  fileCancelFolder: 'files:cancel-folder',
  fileOpen: 'files:open',
  fileOpenPath: 'files:open-path',
  fileCopyImage: 'files:copy-image',
  fileReveal: 'files:reveal',
  fileRevealPath: 'files:reveal-path',
  fileExists: 'files:exists',
  fileSaveAs: 'files:save-as',
  filePick: 'files:pick',
  filePickImages: 'files:pick-images',
  filePaste: 'files:paste',
  fileStagePaths: 'files:stage-paths',
  fileStageBytes: 'files:stage-bytes',
  fileStagedRemove: 'files:staged-remove',
  fileStagedSend: 'files:staged-send',
  fileSendRich: 'files:send-rich',
  fileSendFolder: 'files:send-folder',
  fileBatchSend: 'files:batch-send',
  filePickReceiveDir: 'files:pick-receive-dir',
  filePastePaths: 'files:paste-paths',
  appQuit: 'app:quit',
  appMinimize: 'app:minimize',
  appOpenLogs: 'app:open-logs',
  appExportLogs: 'app:export-logs'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
  appId: string
  defaultReceiveDir: string
}

export type FirewallState = 'allowed' | 'blocked' | 'missing' | 'manual' | 'unsupported' | 'unknown'

export interface FirewallStatus {
  state: FirewallState
  executable: string
  detail: string
}

// Agent RPC 网关的运行时状态；令牌永远不在这里出现
export interface GatewayStatus {
  enabled: boolean
  running: boolean
  url: string
  bindAddr: string
  port: number
  lastError: string
  clients: number
}

// 选完目录后的预览：账号、群数量与可选的会话清单
export interface NwtImportSession {
  key: string
  kind: 'direct' | 'group'
  title: string
  count: number
  firstAt: number
  lastAt: number
}

export interface NwtImportPreview {
  canceled: boolean
  source: string
  privateId: string
  displayName: string
  hasAvatar: boolean
  groupCount: number
  messageCount: number
  sessions: NwtImportSession[]
}

// 用户勾选的范围；会话按 key 传回
export interface NwtImportRequest {
  includeIdentity: boolean
  includeGroups: boolean
  sessions: string[]
}

export interface NwtImportSummary {
  displayName: string
  privateId: string
  groupCount: number
  avatarImported: boolean
  sessions: number
  messages: number
  files: number
  skipped: number
}

// 合并联系人的结果：来源的联系人、会话与文件会转到目标
export interface PeerMergeResult {
  peers: number
  messages: number
  skipped: number
  files: number
}

export interface NotifyPayload {
  conversationId: string
  title: string
  body: string
  sound: boolean
}

// 右下角通知弹窗的一条内容
export interface NotifyToastItem {
  conversationId: string
  title: string
  body: string
}

export interface NotifyListPayload {
  toasts: NotifyToastItem[]
}

// 弹窗窗口与渲染端共用的尺寸，禁止两侧各写一份数字
// 窗口贴合卡片：宽度与卡片一致，高度按卡片数累加；edgeOffset 只是离屏幕工作区边缘的距离
export const TOAST_LAYOUT = { width: 320, cardHeight: 64, edgeOffset: 16 } as const

// 悬停未读列表窗口与渲染端共用的尺寸
export const TRAY_POPUP = {
  width: 300,
  rowHeight: 56,
  footerHeight: 48,
  maxHeight: 380,
  padding: 12
} as const

export interface MessagesListRequest {
  conversationId: string
  beforeId?: number
  limit?: number
}

export interface MessagesSendRequest {
  conversationId: string
  text: string
}

// 历史窗口的三个分类：普通消息、图片、文件
export type MessageHistoryCategory = 'message' | 'image' | 'file'

export interface MessagesSearchRequest {
  conversationId: string
  category: MessageHistoryCategory
  query?: string
  offset?: number
  // 按日期筛选：只看这一天的消息（当天 00:00 到次日 00:00）
  dateFrom?: number
  dateTo?: number
  limit?: number
}

export interface MessagesAroundRequest {
  conversationId: string
  messageId: number
  limit?: number
}

// 群发结果：on 表示已经在线投递，queued 表示对方离线、文字已排队
export interface BatchSendResult {
  on: number
  queued: number
}

// 拖进窗口的文件里，能直接引用的按路径放行，文件夹等无法当文件处理的名字放在 skipped
export interface StagePathsResult {
  attachments: StagedAttachment[]
  skipped: string[]
}

// 富文本输入里的一项：文字，或者待发区里的一张图片
export type RichPart = { kind: 'text'; text: string } | { kind: 'image'; stagedId: string }

export type Api = {
  app: {
    info(): Promise<AppInfo>
    quit(): Promise<void>
    // 收到托盘：窗口隐藏，程序继续在后台运行
    minimize(): Promise<void>
    // 打开数据目录下的 logs 文件夹
    openLogs(): Promise<void>
    // 把 logs 打包到下载目录，返回生成的 tar.gz 路径
    exportLogs(): Promise<string>
  }
  state: {
    snapshot(): Promise<AppSnapshot>
    onEvent(listener: (event: AppEvent) => void): () => void
  }
  conversations: {
    pin(conversationId: string, pinned: boolean): Promise<void>
    // 一键已读：所有有未读的会话推进水位线并清通知弹窗
    markAllRead(): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    defaults(): Promise<Settings>
    setStartAtLogin(enabled: boolean): Promise<Settings>
  }
  shortcuts: {
    setRecording(active: boolean): Promise<void>
    available(accelerator: string): Promise<boolean>
  }
  firewall: {
    check(): Promise<FirewallStatus>
    repair(): Promise<FirewallStatus>
  }
  gateway: {
    status(): Promise<GatewayStatus>
    // 生成新令牌：旧连接会被断开，令牌只留在主进程设置里
    rotateToken(): Promise<void>
  }
  identity: {
    pickAvatar(): Promise<void>
    clearAvatar(): Promise<void>
    setStatus(status: number): Promise<void>
  }
  storage: {
    previewNwtImport(): Promise<NwtImportPreview>
    applyNwtImport(request: NwtImportRequest): Promise<NwtImportSummary>
  }
  ui: {
    onOpenSettings(listener: () => void): () => void
    onNotify(listener: (payload: NotifyPayload) => void): () => void
    onSelectConversation(listener: (conversationId: string) => void): () => void
    onToastList(listener: (payload: NotifyListPayload) => void): () => void
    // 点击通知或未读条目：恢复主窗口并跳到对应会话
    jumpToConversation(conversationId: string): void
    // 悬停列表：报告内容行数（主进程据此贴齐托盘上方）与鼠标离开
    popupRows(rows: number): void
    popupLeave(): void
  }
  messages: {
    list(request: MessagesListRequest): Promise<MessagesPage>
    // 历史窗口：按分类与关键字分页查消息，最新在前
    search(request: MessagesSearchRequest): Promise<MessagesSearchResult>
    // 跳到某条消息时，取回它前后的一段历史
    around(request: MessagesAroundRequest): Promise<MessagesPage>
    send(request: MessagesSendRequest): Promise<SendTextResult>
    // 撤回自己两分钟内发出的消息
    recall(conversationId: string, messageId: number): Promise<void>
    // 输入中通知对端，主进程按节流发送
    typing(conversationId: string): Promise<void>
    markRead(conversationId: string, messageId: number): Promise<void>
    saveDraft(conversationId: string, draft: string): Promise<void>
  }
  peers: {
    setAlias(peerKey: string, alias: string): Promise<void>
    refresh(): Promise<void>
    // 把来源联系人的数据并入目标；来源会被移除
    merge(targetKey: string, originKeys: string[]): Promise<PeerMergeResult>
    // 从本机删除联系人及其会话记录
    remove(peerKey: string): Promise<void>
  }
  groups: {
    create(name: string, memberUserIds: string[]): Promise<GroupInfo>
    setAvatar(groupId: string, path?: string): Promise<void>
    invite(groupId: string, memberUserIds: string[]): Promise<void>
    kick(groupId: string, userId: string): Promise<void>
    leave(groupId: string): Promise<void>
    dismiss(groupId: string): Promise<void>
    // 从本机删除群与群记录；能通知到的成员会收到退群/解散
    remove(groupId: string): Promise<void>
  }
  emotions: {
    list(): Promise<FavoriteSticker[]>
    add(fileId: string): Promise<FavoriteSticker>
    remove(id: string): Promise<void>
    stage(conversationId: string, id: string): Promise<StagedAttachment[]>
  }
  files: {
    accept(id: string): Promise<void>
    reject(id: string): Promise<void>
    // 停止正在发送或接收的文件
    cancel(id: string): Promise<void>
    // 自动接收关闭时，确认或拒绝收到的文件夹邀请
    acceptFolder(taskId: string): Promise<void>
    rejectFolder(taskId: string): Promise<void>
    // 停止正在发送或接收的文件夹
    cancelFolder(taskId: string): Promise<void>
    open(id: string): Promise<void>
    // 用系统文件管理器打开任意已存在的目录（文件夹消息用）
    openPath(path: string): Promise<void>
    // 历史窗口判断文件或目录是否还在磁盘上
    exists(path: string): Promise<boolean>
    // 把图片本身复制到剪贴板，方便直接粘贴到别处
    copyImage(id: string): Promise<void>
    reveal(id: string): Promise<void>
    // 在文件管理器里定位任意路径（文件夹消息用）
    revealPath(path: string): Promise<void>
    saveAs(id: string): Promise<void>
    // 选中与粘贴都只进待发区，返回当前会话最新的待发列表
    pick(conversationId: string): Promise<StagedAttachment[]>
    // 只挑图片，按图片消息发送
    pickImages(conversationId: string): Promise<StagedAttachment[]>
    paste(conversationId: string): Promise<StagedAttachment[]>
    // 拖进窗口的文件：有磁盘路径的直接引用，没有路径的按字节落盘
    stagePaths(
      conversationId: string,
      paths: string[],
      sticker?: boolean
    ): Promise<StagePathsResult>
    stageBytes(
      conversationId: string,
      name: string,
      data: ArrayBuffer,
      sticker?: boolean
    ): Promise<StagedAttachment[]>
    // 拖进来的 File 对象要经它换成磁盘路径
    pathFor(file: File): string
    removeStaged(conversationId: string, id: string): Promise<void>
    sendStaged(conversationId: string, text?: string): Promise<void>
    // 按输入框里的顺序发送文字与图片
    sendRich(conversationId: string, parts: RichPart[]): Promise<void>
    // 发送文件夹：先发 1013 邀请，对端接受后由文件夹通道推送
    sendFolder(conversationId: string, path: string): Promise<void>
    // 群发：把 batch: 待发区里的内容发给选中的联系人
    batchSend(batchId: string, peerKeys: string[], parts: RichPart[]): Promise<BatchSendResult>
    // 选择接收目录；取消返回 null
    pickReceiveDir(): Promise<string | null>
    // 读取系统剪贴板里的文件/文件夹路径（资源管理器复制的文件夹走这条路）
    pastePaths(): Promise<string[]>
  }
}
