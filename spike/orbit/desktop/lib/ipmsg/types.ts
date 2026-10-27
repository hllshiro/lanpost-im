export type PeerClientType = 'lanpost' | 'nwt' | 'feiq' | 'unknown'

export interface PeerInfo {
  key: string
  ip: string
  port: number
  user: string
  host: string
  name: string
  group: string
  status: number
  identityId: string
  clientType: PeerClientType
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

export interface MessageMeta {
  sealed?: boolean
  opened?: boolean
  readCheck?: boolean
  flags?: { broadcast?: boolean; multicast?: boolean }
  files?: string[]
  images?: string[]
  channel?: 'standard'
  notice?: 'third-party-client'
}

export type FileKind = 'file' | 'dir' | 'image'

export type FileState =
  | 'waiting'
  | 'offered'
  | 'transferring'
  | 'done'
  | 'rejected'
  | 'failed'
  | 'canceled'

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
