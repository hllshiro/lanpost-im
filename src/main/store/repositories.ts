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
  corporation: string
  department: string
  sign: string
  status: number
  corp_id: string
  online: number
  ready: number
  alias: string
  last_seen: number
  conversation_unread: number | null
  avatar_md5: string | null
  avatar_id: number | null
}

interface FileRow {
  id: string
  message_id: number | null
  conversation_id: string
  direction: string
  name: string
  size: number
  mtime: number
  file_id: string
  packet_id: number
  path: string
  state: string
  received: number
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
    corporation: row.corporation,
    department: row.department,
    sign: row.sign,
    status: row.status,
    corpId: row.corp_id,
    online: toBoolean(row.online),
    ready: toBoolean(row.ready),
    lastSeen: row.last_seen,
    unread: row.conversation_unread ?? 0,
    alias: row.alias,
    avatarMd5: row.avatar_md5 ?? '',
    avatarId: row.avatar_id ?? 0
  }
}

function mapFile(row: FileRow): FileTaskInfo {
  return {
    id: row.id,
    messageId: row.message_id,
    conversationId: row.conversation_id,
    direction: row.direction as FileTaskInfo['direction'],
    name: row.name,
    size: row.size,
    mtime: row.mtime,
    fileId: row.file_id,
    packetId: row.packet_id,
    path: row.path,
    state: row.state as FileState,
    received: row.received,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function directConversationId(peerKey: string): string {
  return `direct:${peerKey}`
}

export function groupConversationId(groupId: string): string {
  return `group:${groupId}`
}

export interface QGroupInfo {
  id: string
  name: string
  topic: string
  announcement: string
  master: string
  infoVersion: number
  userVersion: number
  allowOtherAdd: number
  photoMd5: string
  updatedAt: number
}

export interface QGroupMember {
  userId: string
  name: string
}

export class QGroupRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(info: QGroupInfo): void {
    this.db
      .prepare(
        `INSERT INTO qgroups (id, name, topic, announcement, master, info_version, user_version, allow_other_add, photo_md5, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           topic = excluded.topic,
           announcement = excluded.announcement,
           master = excluded.master,
           info_version = excluded.info_version,
           user_version = excluded.user_version,
           allow_other_add = excluded.allow_other_add,
           photo_md5 = excluded.photo_md5,
           updated_at = excluded.updated_at`
      )
      .run(
        info.id,
        info.name,
        info.topic,
        info.announcement,
        info.master,
        info.infoVersion,
        info.userVersion,
        info.allowOtherAdd,
        info.photoMd5,
        info.updatedAt
      )
  }

  get(id: string): QGroupInfo | null {
    const row = this.db.prepare('SELECT * FROM qgroups WHERE id = ?').get(id) as
      QGroupRow | undefined
    return row === undefined ? null : mapQGroup(row)
  }

  members(groupId: string): QGroupMember[] {
    const rows = this.db
      .prepare('SELECT user_id, name FROM qgroup_members WHERE group_id = ? ORDER BY name')
      .all(groupId) as unknown as Array<{ user_id: string; name: string }>
    return rows.map((row) => ({ userId: row.user_id, name: row.name }))
  }

  // 成员表以整份推送为准，先清空再写入
  replaceMembers(groupId: string, members: QGroupMember[]): void {
    this.db.prepare('DELETE FROM qgroup_members WHERE group_id = ?').run(groupId)
    const insert = this.db.prepare(
      'INSERT OR REPLACE INTO qgroup_members (group_id, user_id, name) VALUES (?, ?, ?)'
    )
    for (const member of members) {
      insert.run(groupId, member.userId, member.name)
    }
  }

  list(): QGroupInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM qgroups ORDER BY updated_at DESC')
      .all() as unknown as QGroupRow[]
    return rows.map(mapQGroup)
  }

  remove(groupId: string): void {
    this.db.prepare('DELETE FROM qgroup_members WHERE group_id = ?').run(groupId)
    this.db.prepare('DELETE FROM qgroups WHERE id = ?').run(groupId)
  }
}

interface QGroupRow {
  id: string
  name: string
  topic: string
  announcement: string
  master: string
  info_version: number
  user_version: number
  allow_other_add: number
  photo_md5: string
  updated_at: number
}

function mapQGroup(row: QGroupRow): QGroupInfo {
  return {
    id: row.id,
    name: row.name,
    topic: row.topic,
    announcement: row.announcement,
    master: row.master,
    infoVersion: row.info_version,
    userVersion: row.user_version,
    allowOtherAdd: row.allow_other_add,
    photoMd5: row.photo_md5,
    updatedAt: row.updated_at
  }
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

  // 群会话的 id 是 group:<群号>，没有 peer_key
  ensureGroup(groupId: string, title: string): ConversationInfo {
    const id = groupConversationId(groupId)
    this.db
      .prepare(
        'INSERT OR IGNORE INTO conversations (id, kind, title, created_at) VALUES (?, ?, ?, ?)'
      )
      .run(id, 'group', title, Date.now())
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

  // 退群或解散后整段会话连同消息一起删除
  remove(id: string): void {
    // 文件任务引用消息，必须先删
    this.db.prepare('DELETE FROM file_tasks WHERE conversation_id = ?').run(id)
    this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(id)
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id)
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
  // 导入历史时每条消息都要写一次，语句只准备一次
  private readonly importedInsert: ReturnType<DatabaseSync['prepare']>

  constructor(private readonly db: DatabaseSync) {
    this.importedInsert = db.prepare(
      `INSERT INTO messages (conversation_id, direction, kind, text, remote_seq, status, created_at, meta, nwt_id)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
    )
  }

  list(conversationId: string, beforeId?: number, limit = 50): MessagesPage {
    const size = Math.max(1, Math.floor(limit))
    // 合并联系人或导入历史后，消息号不一定与时间同序，统一按时间排，时间相同再按消息号
    const rows = (beforeId === undefined
      ? this.db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ?
             ORDER BY created_at DESC, id DESC LIMIT ?`
          )
          .all(conversationId, size + 1)
      : this.db
          .prepare(
            `SELECT * FROM messages WHERE conversation_id = ? AND (
               created_at < (SELECT created_at FROM messages WHERE id = ?) OR
               (created_at = (SELECT created_at FROM messages WHERE id = ?) AND id < ?)
             ) ORDER BY created_at DESC, id DESC LIMIT ?`
          )
          .all(conversationId, beforeId, beforeId, beforeId, size + 1)) as unknown as MessageRow[]

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

  // 按载荷编号找消息：撤回消息里的 m 就是发送方原本的载荷编号
  findByPayloadId(conversationId: string, payloadId: string): MessageInfo | null {
    if (payloadId === '') return null
    const row = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ?
         AND meta LIKE ? ORDER BY id DESC LIMIT 1`
      )
      .get(conversationId, `%"nwtPayloadId":"${payloadId}"%`) as MessageRow | undefined
    return row === undefined ? null : mapMessage(row)
  }

  // 撤回：消息和它的文件任务一起删掉，气泡不再保留
  deleteMessage(id: number): void {
    this.db.prepare('DELETE FROM file_tasks WHERE message_id = ?').run(id)
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  }

  setStatus(id: number, status: string): void {
    this.db.prepare('UPDATE messages SET status = ? WHERE id = ?').run(status, id)
  }

  // 已读回执只发给私有通道收到的消息；meta 里的来源标记在写入时固定，旧兼容消息没有它。
  listPrivateIncoming(conversationId: string): MessageInfo[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ? AND direction = 'in' AND meta LIKE '%"source":"private"%'
         ORDER BY created_at, id`
      )
      .all(conversationId) as unknown as MessageRow[]
    return rows.map(mapMessage)
  }

  listAll(conversationId: string): MessageInfo[] {
    const rows = this.db
      .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id')
      .all(conversationId) as unknown as MessageRow[]
    return rows.map(mapMessage)
  }

  // 离线排队的消息：对方上线后按原顺序补发
  queued(conversationId: string): MessageInfo[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM messages WHERE conversation_id = ? AND status = 'queued' AND direction = 'out'
         ORDER BY id`
      )
      .all(conversationId) as unknown as MessageRow[]
    return rows.map(mapMessage)
  }

  setRemoteSeq(id: number, seq: number): void {
    this.db.prepare('UPDATE messages SET remote_seq = ? WHERE id = ?').run(seq, id)
  }

  setMeta(id: number, meta: string): void {
    this.db.prepare('UPDATE messages SET meta = ? WHERE id = ?').run(meta, id)
  }

  // 从内网通记录导入的消息：一次取出会话里已有的消息号，避免逐条查库
  nwtIds(conversationId: string): Set<string> {
    const rows = this.db
      .prepare("SELECT nwt_id FROM messages WHERE conversation_id = ? AND nwt_id <> ''")
      .all(conversationId) as unknown as Array<{ nwt_id: string }>
    return new Set(rows.map((row) => row.nwt_id))
  }

  insertImported(input: {
    conversationId: string
    direction: MessageInfo['direction']
    kind: MessageInfo['kind']
    text: string
    time: number
    meta: string
    nwtId: string
  }): number {
    const status = input.direction === 'in' ? 'delivered' : 'sent'
    const result = this.importedInsert.run(
      input.conversationId,
      input.direction,
      input.kind,
      input.text,
      status,
      input.time,
      input.meta,
      input.nwtId
    )
    return Number(result.lastInsertRowid)
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
    (SELECT unread FROM conversations WHERE conversations.peer_key = peers.key) AS conversation_unread,
    peer_avatars.avatar_md5 AS avatar_md5,
    peer_avatars.avatar_id AS avatar_id
  FROM peers
  LEFT JOIN peer_avatars ON peer_avatars.peer_key = peers.key
`

export class PeerRepository {
  constructor(private readonly db: DatabaseSync) {}

  upsert(peer: PeerInfo): void {
    this.db
      .prepare(
        `INSERT INTO peers (key, ip, port, user, host, name, group_name, corporation, department, sign, status, corp_id, online, ready, alias, last_seen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           ip = excluded.ip,
           port = excluded.port,
           user = excluded.user,
           host = excluded.host,
           name = excluded.name,
           group_name = excluded.group_name,
           corporation = excluded.corporation,
           department = excluded.department,
           sign = excluded.sign,
           status = excluded.status,
           corp_id = excluded.corp_id,
           online = excluded.online,
           ready = excluded.ready,
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
        peer.corporation,
        peer.department,
        peer.sign,
        peer.status,
        peer.corpId,
        toInteger(peer.online),
        toInteger(peer.ready),
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

  // 导入历史时补一条联系人：已有联系人只填空缺的名字，不覆盖握手得到的资料
  ensureImported(key: string, name: string, lastSeen: number): void {
    this.db
      .prepare(
        `INSERT INTO peers (key, ip, port, user, host, name, last_seen)
         VALUES (?, '', 0, ?, '', ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           name = CASE WHEN peers.name = '' OR peers.name = peers.user THEN excluded.name ELSE peers.name END,
           last_seen = MAX(peers.last_seen, excluded.last_seen)`
      )
      .run(key, key, name, lastSeen)
  }

  // 删除联系人：头像缓存记录一并清掉
  remove(key: string): void {
    this.db.prepare('DELETE FROM peer_avatars WHERE peer_key = ?').run(key)
    this.db.prepare('DELETE FROM peers WHERE key = ?').run(key)
  }

  setAlias(key: string, alias: string): void {
    this.db.prepare('UPDATE peers SET alias = ? WHERE key = ?').run(alias, key)
  }

  setOnline(key: string, online: boolean, lastSeen: number): void {
    this.db
      .prepare('UPDATE peers SET online = ?, last_seen = ? WHERE key = ?')
      .run(toInteger(online), lastSeen, key)
  }

  setAvatar(key: string, avatarId: number, avatarMd5: string): void {
    this.db
      .prepare(
        'INSERT INTO peer_avatars (peer_key, avatar_id, avatar_md5) VALUES (?, ?, ?) ' +
          'ON CONFLICT(peer_key) DO UPDATE SET avatar_id = excluded.avatar_id, avatar_md5 = excluded.avatar_md5'
      )
      .run(key, Math.floor(avatarId), avatarMd5)
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
        `INSERT INTO file_tasks (id, message_id, conversation_id, direction, name, size, mtime, file_id, packet_id, path, state, received, error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           message_id = excluded.message_id,
           conversation_id = excluded.conversation_id,
           direction = excluded.direction,
           name = excluded.name,
           size = excluded.size,
           mtime = excluded.mtime,
           file_id = excluded.file_id,
           packet_id = excluded.packet_id,
           path = excluded.path,
           state = excluded.state,
           received = excluded.received,
           error = excluded.error,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at`
      )
      .run(
        task.id,
        task.messageId,
        task.conversationId,
        task.direction,
        task.name,
        task.size,
        task.mtime,
        task.fileId,
        task.packetId,
        task.path,
        task.state,
        task.received,
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

export class ImageCacheRepository {
  constructor(private readonly db: DatabaseSync) {}

  get(md5: string): { path: string; size: number } | null {
    const row = this.db.prepare('SELECT path, size FROM image_cache WHERE md5 = ?').get(md5) as
      { path: string; size: number } | undefined
    return row === undefined ? null : row
  }

  put(md5: string, path: string, size: number): void {
    this.db
      .prepare(
        'INSERT INTO image_cache (md5, path, size, created_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(md5) DO UPDATE SET path = excluded.path, size = excluded.size'
      )
      .run(md5, path, size, Date.now())
  }
}

export interface Repositories {
  conversations: ConversationRepository
  messages: MessageRepository
  peers: PeerRepository
  files: FileRepository
  groups: QGroupRepository
  images: ImageCacheRepository
}

export function createRepositories(db: DatabaseSync): Repositories {
  return {
    conversations: new ConversationRepository(db),
    messages: new MessageRepository(db),
    peers: new PeerRepository(db),
    files: new FileRepository(db),
    groups: new QGroupRepository(db),
    images: new ImageCacheRepository(db)
  }
}
