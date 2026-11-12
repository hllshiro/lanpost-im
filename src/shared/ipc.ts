import type {
  AppEvent,
  AppSnapshot,
  MessagesPage,
  SendTextResult,
  StagedAttachment
} from './domain'
import type { Settings, SettingsPatch } from './settings'

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsDefaults: 'settings:defaults',
  uiOpenSettings: 'ui:open-settings',
  uiNotify: 'ui:notify',
  uiSelectConversation: 'ui:select-conversation',
  uiActiveConversation: 'ui:active-conversation',
  snapshot: 'state:snapshot',
  event: 'state:event',
  messagesList: 'messages:list',
  messageSend: 'messages:send',
  conversationRead: 'conversation:read',
  conversationDraft: 'conversation:draft',
  conversationPin: 'conversation:pin',
  peerAlias: 'peer:alias',
  peersRefresh: 'peers:refresh',
  filesList: 'files:list',
  fileAccept: 'files:accept',
  fileReject: 'files:reject',
  fileOpen: 'files:open',
  fileOpenPath: 'files:open-path',
  fileReveal: 'files:reveal',
  fileSaveAs: 'files:save-as',
  filePick: 'files:pick',
  filePaste: 'files:paste',
  fileStagePaths: 'files:stage-paths',
  fileStageBytes: 'files:stage-bytes',
  fileStagedRemove: 'files:staged-remove',
  fileStagedSend: 'files:staged-send',
  fileSendFolder: 'files:send-folder'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
  appId: string
}

export interface NotifyPayload {
  conversationId: string
  title: string
  body: string
  sound: boolean
}

export interface MessagesListRequest {
  conversationId: string
  beforeId?: number
  limit?: number
}

export interface MessagesSendRequest {
  conversationId: string
  text: string
}

// 拖进窗口的文件里，能直接引用的按路径放行，文件夹等无法当文件处理的名字放在 skipped
export interface StagePathsResult {
  attachments: StagedAttachment[]
  skipped: string[]
}

export type Api = {
  app: {
    info(): Promise<AppInfo>
  }
  state: {
    snapshot(): Promise<AppSnapshot>
    onEvent(listener: (event: AppEvent) => void): () => void
  }
  conversations: {
    pin(conversationId: string, pinned: boolean): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    update(patch: SettingsPatch): Promise<Settings>
    defaults(): Promise<Settings>
  }
  ui: {
    onOpenSettings(listener: () => void): () => void
    onNotify(listener: (payload: NotifyPayload) => void): () => void
    onSelectConversation(listener: (conversationId: string) => void): () => void
    setActiveConversation(conversationId: string | null): void
  }
  messages: {
    list(request: MessagesListRequest): Promise<MessagesPage>
    send(request: MessagesSendRequest): Promise<SendTextResult>
    markRead(conversationId: string, messageId: number): Promise<void>
    saveDraft(conversationId: string, draft: string): Promise<void>
  }
  peers: {
    setAlias(peerKey: string, alias: string): Promise<void>
    refresh(): Promise<void>
  }
  files: {
    accept(id: string): Promise<void>
    reject(id: string): Promise<void>
    open(id: string): Promise<void>
    // 用系统文件管理器打开任意已存在的目录（文件夹消息用）
    openPath(path: string): Promise<void>
    reveal(id: string): Promise<void>
    saveAs(id: string): Promise<void>
    // 选中与粘贴都只进待发区，返回当前会话最新的待发列表
    pick(conversationId: string): Promise<StagedAttachment[]>
    paste(conversationId: string): Promise<StagedAttachment[]>
    // 拖进窗口的文件：有磁盘路径的直接引用，没有路径的按字节落盘
    stagePaths(conversationId: string, paths: string[]): Promise<StagePathsResult>
    stageBytes(conversationId: string, name: string, data: ArrayBuffer): Promise<StagedAttachment[]>
    // 拖进来的 File 对象要经它换成磁盘路径
    pathFor(file: File): string
    removeStaged(conversationId: string, id: string): Promise<void>
    sendStaged(conversationId: string): Promise<void>
    // 发送文件夹：先发 1013 邀请，对端接受后由文件夹通道推送
    sendFolder(conversationId: string, path: string): Promise<void>
  }
}
