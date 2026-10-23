import type { AppEvent, AppSnapshot, MessagesPage, SendTextResult } from './domain'

export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  uiOpenSettings: 'ui:open-settings',
  snapshot: 'state:snapshot',
  event: 'state:event',
  messagesList: 'messages:list',
  messageSend: 'messages:send',
  conversationRead: 'conversation:read',
  conversationDraft: 'conversation:draft',
  peerAlias: 'peer:alias',
  filesList: 'files:list',
  fileAccept: 'files:accept',
  fileReject: 'files:reject',
  fileOpen: 'files:open',
  fileReveal: 'files:reveal',
  fileSaveAs: 'files:save-as',
  filePick: 'files:pick',
  fileSend: 'files:send'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
  appId: string
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

export type Api = {
  app: {
    info(): Promise<AppInfo>
  }
  state: {
    snapshot(): Promise<AppSnapshot>
    onEvent(listener: (event: AppEvent) => void): () => void
  }
  ui: {
    onOpenSettings(listener: () => void): () => void
  }
  messages: {
    list(request: MessagesListRequest): Promise<MessagesPage>
    send(request: MessagesSendRequest): Promise<SendTextResult>
    markRead(conversationId: string, messageId: number): Promise<void>
    saveDraft(conversationId: string, draft: string): Promise<void>
  }
  peers: {
    setAlias(peerKey: string, alias: string): Promise<void>
  }
  files: {
    accept(id: string): Promise<void>
    reject(id: string): Promise<void>
    open(id: string): Promise<void>
    reveal(id: string): Promise<void>
    saveAs(id: string): Promise<void>
    pickAndSend(conversationId: string): Promise<void>
    sendPaths(conversationId: string, paths: string[]): Promise<void>
  }
}
