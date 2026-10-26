import type { Settings } from './settings'

export interface PeerInfo {
  key: string
  ip: string
  port: number
  user: string
  host: string
  name: string
  group: string
  status: number
  online: boolean
  lastSeen: number
  unread: number
  alias: string
  capUtf8: boolean
  capFile: boolean
  capClipboard: boolean
  dialup: boolean
  versionInfo: string
  absenceInfo: string
}

export interface ConversationInfo {
  id: string
  kind: 'direct' | 'group'
  peerKey: string | null
  title: string
  pinned: boolean
  muted: boolean
  unread: number
  lastMessageAt: number
  draft: string
  lastReadMessageId: number
}

export interface MessageInfo {
  id: number
  conversationId: string
  direction: 'in' | 'out'
  kind: 'text' | 'file' | 'system'
  text: string
  remoteSeq: number
  status: string
  createdAt: number
  meta: string
}

export type FileKind = 'file' | 'dir' | 'image'

export type FileState =
  'waiting' | 'offered' | 'transferring' | 'done' | 'rejected' | 'failed' | 'canceled'

export interface FileTaskInfo {
  id: string
  messageId: number | null
  conversationId: string
  peerKey?: string
  direction: 'in' | 'out'
  kind: FileKind
  name: string
  size: number
  mtime: number
  fileId: string
  packetId: number
  path: string
  state: FileState
  received: number
  entryCount: number
  completedCount: number
  error: string
  createdAt: number
  updatedAt: number
}

export interface LocalInfo {
  name: string
  account: string
  host: string
  status: number
  online: boolean
  version: string
}

export interface AppSnapshot {
  local: LocalInfo
  peers: PeerInfo[]
  conversations: ConversationInfo[]
  files: FileTaskInfo[]
  unread: number
}

export type AppEvent =
  | { type: 'peers'; peers: PeerInfo[] }
  | { type: 'conversation'; conversation: ConversationInfo }
  | { type: 'message'; message: MessageInfo }
  | { type: 'file'; file: FileTaskInfo }
  | { type: 'settings'; settings: Settings }

export interface MessagesPage {
  messages: MessageInfo[]
  hasMore: boolean
}

export interface SendTextResult {
  message: MessageInfo
}
