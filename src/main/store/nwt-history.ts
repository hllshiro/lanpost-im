import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Repositories } from './repositories'
import { renamePeerKey } from './peer-keys'
import { decryptNwtDatabase } from './nwt-db'
import { readNwtData, resolveNwtRoot } from './nwt-import'

export type NwtHistorySegment = { kind: 'text'; text: string } | { kind: 'image'; value: string }

export interface NwtHistoryFile {
  name: string
  path: string
  size: number
}

export interface NwtHistoryMessage {
  nwtId: string
  direction: 'in' | 'out'
  kind: 'text' | 'file'
  text: string
  time: number
  segments: NwtHistorySegment[]
  file: NwtHistoryFile | null
}

export interface NwtHistorySession {
  key: string
  kind: 'direct' | 'group'
  title: string
  firstAt: number
  lastAt: number
  count: number
  messages: NwtHistoryMessage[]
}

export interface NwtHistory {
  account: string
  sessions: NwtHistorySession[]
}

export interface NwtHistoryResult {
  conversations: number
  messages: number
  files: number
  skipped: number
}

interface RecordRow {
  PriKey: number
  FromUserId: string
  FromUserName: string
  ToUserId: string
  ToUserName: string
  PeerUserId: string
  MsgId: string
  MsgTime: number
  MsgData: string
  MsgText: string
}

interface ParsedMessage {
  segments: NwtHistorySegment[]
  file: NwtHistoryFile | null
  text: string
}

// 内网通的聊天记录在加密的 nr 里，按对端用户号或群号聚合后返回；
// 同一份库重复读取时按消息号去重
export function readNwtHistory(input: string): NwtHistory {
  const root = resolveNwtRoot(input)
  const account = readFileSync(join(root, 'data', 'acc'), 'utf8')
    .trim()
    .toLowerCase()
  const groups = new Map(readNwtData(root).groups.map((group) => [group.id, group.name]))
  const database = join(root, 'cache', 'db', 'nr')
  if (!existsSync(database)) {
    return { account, sessions: [] }
  }
  const plain = decryptNwtDatabase(readFileSync(database))
  const sessions = withDecryptedDatabase(plain, (db) => collectSessions(db, account, groups))
  return { account, sessions }
}

export function applyNwtHistory(options: {
  history: NwtHistory
  selected: string[]
  repos: Repositories
  db: DatabaseSync
}): NwtHistoryResult {
  const { history, selected, repos, db } = options
  // 整批导入放在一个事务里，几万条消息也只提交一次
  db.exec('SAVEPOINT nwt_history_import')
  try {
    const result = importSessions(history, new Set(selected), repos, db)
    db.exec('RELEASE nwt_history_import')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO nwt_history_import')
    db.exec('RELEASE nwt_history_import')
    throw error
  }
}

function importSessions(
  history: NwtHistory,
  wanted: Set<string>,
  repos: Repositories,
  db: DatabaseSync
): NwtHistoryResult {
  const result: NwtHistoryResult = { conversations: 0, messages: 0, files: 0, skipped: 0 }

  for (const session of history.sessions) {
    if (!wanted.has(session.key)) continue
    const title = session.title !== '' ? session.title : session.key.slice(0, 8)
    let conversationId: string
    // 已有会话沿用当前标题，避免用历史里的旧昵称覆盖对端现在用的名字
    if (session.kind === 'direct') {
      adoptLegacyPeer(db, session.key, title)
      const conversationIdValue = `direct:${session.key}`
      const existed = repos.conversations.get(conversationIdValue) !== null
      repos.peers.ensureImported(session.key, title, session.lastAt)
      const conversation = repos.conversations.ensureDirect(session.key, title)
      if (!existed) {
        repos.conversations.setTitle(conversation.id, title)
      }
      conversationId = conversation.id
    } else {
      const conversationIdValue = `group:${session.key}`
      const existed = repos.conversations.get(conversationIdValue) !== null
      const conversation = repos.conversations.ensureGroup(session.key, title)
      if (!existed) {
        repos.conversations.setTitle(conversation.id, title)
      }
      conversationId = conversation.id
    }
    result.conversations += 1

    const known = repos.messages.nwtIds(conversationId)
    for (const message of session.messages) {
      if (known.has(message.nwtId)) {
        result.skipped += 1
        continue
      }
      const segments = message.segments.length > 1 ? message.segments : []
      const meta = JSON.stringify(
        segments.length > 0 ? { imported: 'nwt', segments } : { imported: 'nwt' }
      )
      const messageId = repos.messages.insertImported({
        conversationId,
        direction: message.direction,
        kind: message.kind,
        text: message.text,
        time: message.time,
        meta,
        nwtId: message.nwtId
      })
      result.messages += 1
      if (message.file !== null) {
        const present = message.file.path !== '' && existsSync(message.file.path)
        repos.files.upsert({
          id: `nwt-${message.nwtId}`,
          messageId,
          conversationId,
          direction: message.direction,
          name: message.file.name,
          size: message.file.size,
          mtime: 0,
          fileId: '',
          packetId: 0,
          path: message.file.path,
          state: present ? 'done' : 'missing',
          received: present ? message.file.size : 0,
          error: present ? '' : '文件不在这台电脑',
          createdAt: message.time,
          updatedAt: message.time
        })
        result.files += 1
      }
    }
    repos.conversations.touch(conversationId, session.lastAt, 0)
  }
  return result
}

// 解密后的库直接反序列化到内存库，不落临时文件，避免安全软件拦截临时目录
// 历史导入的目标是按用户标识的会话；老数据只有地址和昵称，
// 名称唯一匹配时把那条联系人与会话并过来，避免同一个人出现两条会话
function adoptLegacyPeer(db: DatabaseSync, key: string, title: string): void {
  if (title === '') return
  const rows = db
    .prepare("SELECT key FROM peers WHERE user = '' AND name = ? AND key <> ?")
    .all(title, key) as unknown as Array<{ key: string }>
  if (rows.length === 1) {
    renamePeerKey(db, rows[0].key, key)
  }
}

function withDecryptedDatabase<T>(plain: Buffer, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(':memory:')
  try {
    db.deserialize(plain)
    return run(db)
  } finally {
    db.close()
  }
}

function collectSessions(
  db: DatabaseSync,
  account: string,
  groups: Map<string, string>
): NwtHistorySession[] {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as unknown as Array<{ name: string }>
  const privateTables = tables.map((row) => row.name).filter((name) => /^ChatRecord_/.test(name))
  const groupTables = tables
    .map((row) => row.name)
    .filter((name) => /^QGroupChatRecord_/.test(name))

  const sessions = new Map<
    string,
    { kind: 'direct' | 'group'; title: string; messages: Map<string, NwtHistoryMessage> }
  >()

  const load = (name: string, kind: 'direct' | 'group'): void => {
    const rows = db
      .prepare(
        `SELECT PriKey, FromUserId, FromUserName, ToUserId, ToUserName, PeerUserId, MsgId, MsgTime,
                MsgData, MsgText
         FROM "${name}" ORDER BY MsgTime ASC, PriKey ASC`
      )
      .all() as unknown as RecordRow[]
    for (const row of rows) {
      const fromSelf = row.FromUserId === account
      const key =
        kind === 'group'
          ? row.ToUserId
          : row.PeerUserId !== ''
            ? row.PeerUserId
            : fromSelf
              ? row.ToUserId
              : row.FromUserId
      if (key === '' || key === account) continue
      const nwtId = row.MsgId !== '' ? row.MsgId : `row-${row.MsgTime}-${row.PriKey}`
      const peerName = fromSelf ? row.ToUserName : row.FromUserName
      const title =
        kind === 'group'
          ? (groups.get(key) ?? '群聊')
          : peerName !== ''
            ? peerName
            : key.slice(0, 8)
      let session = sessions.get(key)
      if (session === undefined) {
        session = { kind, title, messages: new Map() }
        sessions.set(key, session)
      }
      if (session.messages.has(nwtId)) continue
      const parsed = parseMessage(row.MsgData, row.MsgText)
      // 内网通的时间是 Unix 秒，本机统一用毫秒
      const time = Math.round(Number(row.MsgTime) * 1000)
      session.messages.set(nwtId, {
        nwtId,
        direction: fromSelf ? 'out' : 'in',
        kind: parsed.file === null ? 'text' : 'file',
        text: parsed.text,
        time,
        segments: parsed.segments,
        file: parsed.file
      })
    }
  }

  for (const name of privateTables) load(name, 'direct')
  for (const name of groupTables) load(name, 'group')

  const result: NwtHistorySession[] = []
  for (const [key, session] of sessions) {
    const messages = [...session.messages.values()].sort((a, b) => a.time - b.time)
    if (messages.length === 0) continue
    result.push({
      key,
      kind: session.kind,
      title: session.title,
      firstAt: messages[0].time,
      lastAt: messages[messages.length - 1].time,
      count: messages.length,
      messages
    })
  }
  return result.sort((a, b) => b.lastAt - a.lastAt)
}

function parseMessage(data: string, fallback: string): ParsedMessage {
  const segments: NwtHistorySegment[] = []
  let file: NwtHistoryFile | null = null
  let parsed: unknown
  try {
    parsed = JSON.parse(data) as unknown
  } catch {
    parsed = null
  }
  const parts =
    typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { dt?: unknown }).dt)
      ? ((parsed as { dt: unknown[] }).dt as unknown[])
      : []
  for (const item of parts) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const text = record['txt']
    if (typeof text === 'object' && text !== null) {
      const value = (text as { v?: unknown }).v
      if (typeof value === 'string' && value !== '') {
        segments.push({ kind: 'text', text: value })
      }
      continue
    }
    const image = record['img']
    if (typeof image === 'object' && image !== null) {
      const kind = (image as { t?: unknown }).t
      const value = (image as { v?: unknown }).v
      if (kind === 'feihu' && typeof value === 'string' && /\.gif$/i.test(value)) {
        segments.push({ kind: 'image', value })
      } else {
        segments.push({ kind: 'text', text: '[图片]' })
      }
      continue
    }
    const single = record['file']
    if (typeof single === 'object' && single !== null) {
      const value = (single as { v?: unknown }).v
      if (typeof value === 'string' && value !== '') {
        file = fileInfo(value, 0)
      }
      continue
    }
    const sized = record['file2']
    if (typeof sized === 'object' && sized !== null) {
      const value = (sized as { v?: unknown }).v
      const size = Number((sized as { s?: unknown }).s)
      if (typeof value === 'string' && value !== '') {
        file = fileInfo(value, Number.isFinite(size) ? size : 0)
      }
    }
  }

  const text = segments
    .map((segment) => (segment.kind === 'text' ? segment.text : ''))
    .join('')
    .trim()
  if (segments.length === 0 && fallback !== '') {
    segments.push({ kind: 'text', text: fallback })
  }
  return { segments, file, text: text !== '' ? text : (file?.name ?? fallback) }
}

function fileInfo(path: string, size: number): NwtHistoryFile {
  const name = path.split(/[\\/]/).pop() ?? path
  let actual = size
  if (actual <= 0 && existsSync(path)) {
    try {
      actual = statSync(path).size
    } catch {
      actual = 0
    }
  }
  return { name, path, size: actual }
}
