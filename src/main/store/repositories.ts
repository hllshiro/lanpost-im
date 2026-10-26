import type { DatabaseSync } from 'node:sqlite'
import type {
  ConversationInfo,
  FileState,
  FileTaskInfo,
  MessageInfo,
  MessagesPage,
  PeerInfo
} from '../../shared/domain'

interface ConversationRow {
  id: string
  kind: string
  peer_key: string | null
  title: string
  pinned: number
  muted: number
  unread: number
  last_read_message_id: number
  draft: string
  last_message_at: number
}

interface MessageRow {
  id: number
  conversation_id: string
  direction: string
  kind: string
  text: string
  remote_seq: number
  status: string
  created_at: number
  meta: string
}

interface PeerRow {
  key: string
  ip: string
  port: number
  user: string
  host: string
  name: string
  group_name: string
  status: number
  online: number
  cap_utf8: number
  cap_file: number
  cap_clipboard: number
  dialup: number
  version_info: string
  absence_info: string
  alias: string
  last_seen: number
  conversation_unread: number | null
}

interface FileRow {
  id: string
  message_id: number | null
  conversation_id: string
  direction: string
  kind: string
  name: string
  size: number
  mtime: number
  file_id: string
  packet_id: number
  path: string
  state: string
  received: number
  entry_count: number
  completed_count: number
  error: string
  created_at: number
  updated_at: number
}

function toBoolean(value: number): boolean {
  return value !== 0
}

function toInteger(value: boolean): number {
  return value ? 1 : 0
}

function mapConversation(row: ConversationRow): ConversationInfo {
  return {
    id: row.id,
    kind: row.kind as ConversationInfo['kind'],
    peerKey: row.peer_key,
    title: row.title,
    pinned: toBoolean(row.pinned),
    muted: toBoolean(row.muted),
    unread: row.unread,
    lastMessageAt: row.last_message_at,
    draft: row.draft,
    lastReadMessageId: row.last_read_message_id
  }
}

function mapMessage(row: MessageRow): MessageInfo {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction as MessageInfo['direction'],
    kind: row.kind as MessageInfo['kind'],
    text: row.text,
    remoteSeq: row.remote_seq,
    status: row.status,
    createdAt: row.created_at,
    meta: row.meta
  }
}

function mapPeer(row: PeerRow): PeerInfo {
  return {
    key: row.key,
    ip: row.ip,
    port: row.port,
    user: row.user,
    host: row.host,
    name: row.name,
    group: row.group_name,
    status: row.status,
    online: toBoolean(row.online),
    lastSeen: row.last_seen,
    unread: row.conversation_unread ?? 0,
    alias: row.alias,
    capUtf8: toBoolean(row.cap_utf8),
    capFile: toBoolean(row.cap_file),
    capClipboard: toBoolean(row.cap_clipboard),
    dialup: toBoolean(row.dialup),
    versionInfo: row.version_info,
    absenceInfo: row.absence_info
  }
}

function mapFile(row: FileRow): FileTaskInfo {
  return {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    direction: row.direction as FileTaskInfo['direction'],
    kind: row.kind as FileTaskInfo['kind'],
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    fileId: row.file_id,
    packetId: row.packet_id,
    path: row.path,
    state: row.state as FileState,
    received: row.received,
    entryCount: row.entry_count,
    completedCount: row.completed_count,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function directConversationId(peerKey: string): string {
  return `direct:${peerKey}`
}

export class ConversationRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): ConversationInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM conversations ORDER BY pinned DESC, last_message_at DESC, id ASC')
      .all() as unknown as ConversationRow[]
    return rows.map(mapConversation)
  }

  ensureDirect(peerKey: string, title: string): ConversationInfo {
    const id = directConversationId(peerKey)
    this.db
      .prepare(
        'INSERT OR IGNORE INTO conversations (id, kind, peer_key, title, created_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, 'direct', peerKey, title, Date.now())
    return this.require(id)
  }

  get(id: string): ConversationInfo | null {
    const row = this.db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as
      ConversationRow | undefined
    return row === undefined ? null : mapConversation(row)
  }

  markRead(id: string, messageId: number): void {
    this.db
      .prepare(
        'UPDATE conversations SET last_read_message_id = MAX(last_read_message_id, ?), unread = 0 WHERE id = ?'
      )
      .run(messageId, id)
  }

  saveDraft(id: string, draft: string): void {
    this.db.prepare('UPDATE conversations SET draft = ? WHERE id = ?').run(draft, id)
  }

  setTitle(id: string, title: string): void {
    this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id)
  }

  setPinned(id: string, pinned: boolean): void {
    this.db.prepare('UPDATE conversations SET pinned = ? WHERE id = ?').run(toInteger(pinned), id)
  }

  setMuted(id: string, muted: boolean): void {
    this.db.prepare('UPDATE conversations SET muted = ? WHERE id = ?').run(toInteger(muted), id)
  }

  touch(id: string, lastMessageAt: number, unreadDelta: number): void {
    this.db
      .prepare(
        'UPDATE conversations SET last_message_at = MAX(last_message_at, ?), unread = MAX(0, unread + ?) WHERE id = ?'
      )
      .run(lastMessageAt, unreadDelta, id)
  }

  private require(id: string): ConversationInfo {
    const conversation = this.get(id)
    if (conversation === null) {
      throw new Error(`会话不存在: ${id}`)
    }
    return conversation
  }
}

export class MessageRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(conversationId: string, beforeId?: number, limit = 50): MessagesPage {
    const size = Math.max(1, Math.floor(limit))
    const rows = (beforeId === undefined
      ? this.db
          .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
          .all(conversationId, size + 1)
      : this.db
          .prepare(
            'SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?'
          )
          .all(conversationId, beforeId, size + 1)) as unknown as MessageRow[]

    const hasMore = rows.length > size
    const page = hasMore ? rows.slice(0, size) : rows
    return { messages: page.reverse().map(mapMessage), hasMore }
  }

  insertIncoming(
    conversationId: string,
    text: string,
    remoteSeq: number,
    kind: MessageInfo['kind'] = 'text',
    meta = '{}'
  ): MessageInfo {
    return this.insert(conversationId, 'in', 'delivered', text, remoteSeq, kind, meta)
  }

  insertOutgoing(
    conversationId: string,
    text: string,
    remoteSeq: number,
    kind: MessageInfo['kind'] = 'text',
    meta = '{}'
  ): MessageInfo {
    return this.insert(conversationId, 'out', 'sending', text, remoteSeq, kind, meta)
  }

  setStatus(id: number, status: string): void {
    this.db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id)
  }

  setRemoteSeq(id: number, seq: number): void {
    this.db.prepare('UPDATE messages SET remote_seq = ? WHERE id = ?').run(seq, id)
  }

  getMessage(id: number): MessageInfo | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as
      MessageRow | undefined
    return row === undefined ? null : mapMessage(row)
  }

  private insert(
    conversationId: string,
    direction: MessageInfo['direction'],
    status: string,
    text: string,
    remoteSeq: number,
    kind: MessageInfo['kind'],
    meta: string
  ): MessageInfo {
    const result = this.db
      .prepare(
        'INSERT INTO messages (conversation_id, direction, kind, text, remote_seq, status, created_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(conversationId, direction, kind, text, remoteSeq, status, Date.now(), meta)
    const message = this.getMessage(Number(result.lastInsertRowid))
    if (message === null) {
      throw new Error('消息写入后无法读取')
    }
    return message
  }
}

const PEER_SELECT = `
  SELECT peers.*,
    (SELECT unread FROM conversations WHERE conversations.peer_key = peers.key) AS conversation_unread
  FROM peers
`

export class PeerRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(peer: PeerInfo): void {
    this.db
      .prepare(
        `INSERT INTO peers (key, ip, port, user, host, name, group_name, status, online, cap_utf8, cap_file, cap_clipboard, dialup, version_info, absence_info, alias, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           ip = excluded.ip,
           port = excluded.port,
           user = excluded.user,
           host = excluded.host,
           name = excluded.name,
           group_name = excluded.group_name,
           status = excluded.status,
           online = excluded.online,
           cap_utf8 = excluded.cap_utf8,
           cap_file = excluded.cap_file,
           cap_clipboard = excluded.cap_clipboard,
           dialup = excluded.dialup,
           version_info = excluded.version_info,
           absence_info = excluded.absence_info,
           last_seen = excluded.last_seen`
      )
      .run(
        peer.key,
        peer.ip,
        peer.port,
        peer.user,
        peer.host,
        peer.name,
        peer.group,
        peer.status,
        toInteger(peer.online),
        toInteger(peer.capUtf8),
        toInteger(peer.capFile),
        toInteger(peer.capClipboard),
        toInteger(peer.dialup),
        peer.versionInfo,
        peer.absenceInfo,
        peer.alias,
        peer.lastSeen
      )
  }

  list(): PeerInfo[] {
    const rows = this.db
      .prepare(`${PEER_SELECT} ORDER BY name COLLATE NOCASE ASC, key ASC`)
      .all() as unknown as PeerRow[]
    return rows.map(mapPeer)
  }

  setAlias(key: string, alias: string): void {
    this.db.prepare('UPDATE peers SET alias = ? WHERE key = ?').run(alias, key)
  }

  setOnline(key: string, online: boolean, lastSeen: number): void {
    this.db
      .prepare('UPDATE peers SET online = ?, last_seen = ? WHERE key = ?')
      .run(toInteger(online), lastSeen, key)
  }

  get(key: string): PeerInfo | null {
    const row = this.db.prepare(`${PEER_SELECT} WHERE peers.key = ?`).get(key) as
      PeerRow | undefined
    return row === undefined ? null : mapPeer(row)
  }
}

export class FileRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(task: FileTaskInfo): void {
    this.db
      .prepare(
        `INSERT INTO file_tasks (id, message_id, conversation_id, direction, kind, name, size, mtime, file_id, packet_id, path, state, received, entry_count, completed_count, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           message_id = excluded.message_id,
           conversation_id = excluded.conversation_id,
           direction = excluded.direction,
           kind = excluded.kind,
           name = excluded.name,
           size = excluded.size,
           mtime = excluded.mtime,
           file_id = excluded.file_id,
           packet_id = excluded.packet_id,
           path = excluded.path,
           state = excluded.state,
           received = excluded.received,
           entry_count = excluded.entry_count,
           completed_count = excluded.completed_count,
           error = excluded.error,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
      .run(
        task.id,
        task.messageId,
        task.conversationId,
        task.direction,
        task.kind,
        task.name,
        task.size,
        task.mtime,
        task.fileId,
        task.packetId,
        task.path,
        task.state,
        task.received,
        task.entryCount,
        task.completedCount,
        task.error,
        task.createdAt,
        task.updatedAt
      )
  }

  get(id: string): FileTaskInfo | null {
    const row = this.db.prepare('SELECT * FROM file_tasks WHERE id = ?').get(id) as
      FileRow | undefined
    return row === undefined ? null : mapFile(row)
  }

  list(conversationId?: string): FileTaskInfo[] {
    const rows = (conversationId === undefined
      ? this.db.prepare('SELECT * FROM file_tasks ORDER BY created_at ASC, id ASC').all()
      : this.db
          .prepare(
            'SELECT * FROM file_tasks WHERE conversation_id = ? ORDER BY created_at ASC, id ASC'
          )
          .all(conversationId)) as unknown as FileRow[]
    return rows.map(mapFile)
  }

  updateState(id: string, state: FileState, received: number, error: string, path?: string): void {
    const updatedAt = Date.now()
    if (path === undefined) {
      this.db
        .prepare(
          'UPDATE file_tasks SET state = ?, received = ?, error = ?, updated_at = ? WHERE id = ?'
        )
        .run(state, received, error, updatedAt, id)
      return
    }
    this.db
      .prepare(
        'UPDATE file_tasks SET state = ?, received = ?, error = ?, path = ?, updated_at = ? WHERE id = ?'
      )
      .run(state, received, error, path, updatedAt, id)
  }
}

export interface Repositories {
  conversations: ConversationRepository
  messages: MessageRepository
  peers: PeerRepository
  files: FileRepository
}

export function createRepositories(db: DatabaseSync): Repositories {
  return {
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    peers: new PeerRepository(db),
    files: new FileRepository(db)
  }
}
