import type { Settings } from './settings'

export interface PeerInfo {
  key: string
  ip: string
  port: number
  user: string
  host: string
  name: string
  group: string
  corporation: string
  department: string
  sign: string
  status: number
  corpId: string
  online: boolean
  ready: boolean
  lastSeen: number
  unread: number
  alias: string
  // 私有通道的 32 位用户号，群成员按它识别；没握过手时为空
  privateUserId?: string
  // 对端头像：md5 指向本地缓存文件，id 是对端取图用的文件号
  avatarMd5?: string
  avatarId?: number
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
  kind: 'text' | 'file' | 'folder' | 'system'
  text: string
  remoteSeq: number
  status: string
  createdAt: number
  meta: string
}

export type FileState =
  'waiting' | 'offered' | 'transferring' | 'done' | 'rejected' | 'failed' | 'canceled'

export interface FileTaskInfo {
  id: string
  messageId: number | null
  conversationId: string
  peerKey?: string
  direction: 'in' | 'out'
  name: string
  size: number
  mtime: number
  fileId: string
  packetId: number
  path: string
  state: FileState
  received: number
  error: string
  createdAt: number
  updatedAt: number
}

// 待发区里的附件：粘贴的图片、选中的文件和拖进来的文件夹都先进这里，点发送才真正发出去
export interface StagedAttachment {
  id: string
  conversationId: string
  name: string
  path: string
  size: number
  kind: 'image' | 'file' | 'folder'
  createdAt: number
  // 表情按图片发送，气泡里按小尺寸显示
  sticker?: boolean
}

// 收藏的表情：文件复制在数据目录里，渲染进程只拿编号和名字
export interface FavoriteSticker {
  id: string
  name: string
  addedAt: number
}

export interface LocalInfo {
  name: string
  account: string
  host: string
  status: number
  online: boolean
  version: string
  // 本机的私有通道用户号，用来在群成员里认出自己
  privateUserId: string
  // 本机头像的 md5，空表示使用默认头像
  avatarMd5: string
}

export interface GroupMemberInfo {
  userId: string
  name: string
}

export interface GroupInfo {
  id: string
  name: string
  master: string
  topic: string
  announcement: string
  infoVersion: number
  userVersion: number
  members: GroupMemberInfo[]
  // 群头像的 md5；文件已经缓存时才有值
  photoMd5: string
}

export interface AppSnapshot {
  local: LocalInfo
  peers: PeerInfo[]
  conversations: ConversationInfo[]
  groups: GroupInfo[]
  files: FileTaskInfo[]
  staged: StagedAttachment[]
  unread: number
}

export type AppEvent =
  | { type: 'peers'; peers: PeerInfo[] }
  | { type: 'local-status'; status: number }
  | { type: 'conversation'; conversation: ConversationInfo }
  | { type: 'message'; message: MessageInfo }
  | { type: 'conversation-removed'; conversationId: string }
  | { type: 'group'; group: GroupInfo }
  | { type: 'file'; file: FileTaskInfo }
  | { type: 'staged'; conversationId: string; attachments: StagedAttachment[] }
  | { type: 'settings'; settings: Settings }

export interface MessagesPage {
  messages: MessageInfo[]
  hasMore: boolean
}

export interface SendTextResult {
  message: MessageInfo
}
