import type { AppEvent, AppSnapshot, MessagesPage, PeerInfo, SendTextResult } from './domain'
import type { Settings, SettingsPatch } from './settings'

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsDefaults: 'settings:defaults',
  firewallCheck: 'firewall:check',
  firewallRepair: 'firewall:repair',
  uiOpenSettings: 'ui:open-settings',
  uiNotify: 'ui:notify',
  uiSelectConversation: 'ui:select-conversation',
  uiActiveConversation: 'ui:active-conversation',
  snapshot: 'state:snapshot',
  event: 'state:event',
  messagesList: 'messages:list',
  messageSend: 'messages:send',
  messageUnseal: 'messages:unseal',
  messageBroadcast: 'messages:broadcast',
  messageMulticast: 'messages:multicast',
  conversationRead: 'conversation:read',
  conversationDraft: 'conversation:draft',
  conversationPin: 'conversation:pin',
  peerAlias: 'peer:alias',
  peerInfo: 'peer:info',
  peersRefresh: 'peers:refresh',
  filesList: 'files:list',
  fileAccept: 'files:accept',
  fileReject: 'files:reject',
  fileCancel: 'files:cancel',
  fileOpen: 'files:open',
  fileReveal: 'files:reveal',
  fileSaveAs: 'files:save-as',
  filePick: 'files:pick',
  filePickFolder: 'files:pick-folder',
  filePickImages: 'files:pick-images',
  fileSend: 'files:send'
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

export type FirewallState = 'allowed' | 'blocked' | 'missing' | 'manual' | 'unsupported' | 'unknown'

export interface FirewallStatus {
  state: FirewallState
  executable: string
  detail: string
}

export interface MessagesListRequest {
  conversationId: string
  beforeId?: number
  limit?: number
}

export interface MessagesSendRequest {
  conversationId: string
  text: string
  sealed?: boolean
}

export interface MessageBroadcastRequest {
  text: string
}

export interface MessageMulticastRequest {
  peerKeys: string[]
  text: string
}

export interface SentCountResult {
  count: number
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
  firewall: {
    check(): Promise<FirewallStatus>
    repair(): Promise<FirewallStatus>
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
    unseal(messageId: number): Promise<SendTextResult>
    broadcast(request: MessageBroadcastRequest): Promise<SentCountResult>
    multicast(request: MessageMulticastRequest): Promise<SentCountResult>
    markRead(conversationId: string, messageId: number): Promise<void>
    saveDraft(conversationId: string, draft: string): Promise<void>
  }
  peers: {
    setAlias(peerKey: string, alias: string): Promise<void>
    refresh(): Promise<void>
    requestInfo(peerKey: string): Promise<PeerInfo>
  }
  files: {
    accept(id: string): Promise<void>
    reject(id: string): Promise<void>
    cancel(id: string): Promise<void>
    open(id: string): Promise<void>
    reveal(id: string): Promise<void>
    saveAs(id: string): Promise<void>
    pickAndSend(conversationId: string): Promise<void>
    pickFolderAndSend(conversationId: string): Promise<void>
    pickImagesAndSend(conversationId: string): Promise<void>
    sendPaths(conversationId: string, paths: string[]): Promise<void>
  }
}
