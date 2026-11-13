import type { DatabaseSync } from 'node:sqlite'

interface PeerRow {
  key: string
  alias: string
  last_seen: number
  online: number
  ready: number
}

interface ConversationRow {
  id: string
  unread: number
  last_message_at: number
}

// 5.0 起消息带来源标识：迁移过的内网通记录用它去重，重复导入不会产生重复消息
export function ensureNwtMessageColumn(db: DatabaseSync): void {
  const columns = db.prepare('PRAGMA table_info(messages)').all() as unknown as Array<{
    name: string
  }>
  if (!columns.some((column) => column.name === 'nwt_id')) {
    db.exec("ALTER TABLE messages ADD COLUMN nwt_id TEXT NOT NULL DEFAULT ''")
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_nwt ON messages(conversation_id, nwt_id)')
}

// 联系人按私有用户标识识别：把历史上按「地址|用户标识」保存的行改成用户标识
export function migratePeerKeys(db: DatabaseSync): void {
  const rows = db
    .prepare("SELECT key, user FROM peers WHERE instr(key, '|') > 0 AND user <> ''")
    .all() as unknown as Array<{ key: string; user: string }>
  for (const row of rows) {
    renamePeerKey(db, row.key, row.user)
  }
}

export function renamePeerKey(db: DatabaseSync, from: string, to: string): void {
  if (from === to || from === '' || to === '') return
  const source = db.prepare('SELECT * FROM peers WHERE key = ?').get(from) as PeerRow | undefined
  if (source === undefined) return
  const target = db.prepare('SELECT key FROM peers WHERE key = ?').get(to) as
    { key: string } | undefined

  db.exec('SAVEPOINT rename_peer_key')
  // 会话、消息、文件任务互相引用，改名期间把外键检查推迟到释放保存点
  db.exec('PRAGMA defer_foreign_keys = ON')
  try {
    if (target === undefined) {
      db.prepare('UPDATE peers SET key = ? WHERE key = ?').run(to, from)
    } else {
      db.prepare(
        `UPDATE peers SET
           alias = CASE WHEN alias = '' THEN ? ELSE alias END,
           online = MAX(online, ?),
           ready = MAX(ready, ?),
           last_seen = MAX(last_seen, ?)
         WHERE key = ?`
      ).run(source.alias, source.online, source.ready, source.last_seen, to)
      db.prepare('DELETE FROM peers WHERE key = ?').run(from)
    }

    const targetAvatar = db.prepare('SELECT peer_key FROM peer_avatars WHERE peer_key = ?').get(to)
    if (targetAvatar === undefined) {
      db.prepare('UPDATE peer_avatars SET peer_key = ? WHERE peer_key = ?').run(to, from)
    } else {
      db.prepare('DELETE FROM peer_avatars WHERE peer_key = ?').run(from)
    }

    const fromConversation = `direct:${from}`
    const toConversation = `direct:${to}`
    const conversation = db
      .prepare('SELECT id, unread, last_message_at FROM conversations WHERE id = ?')
      .get(fromConversation) as ConversationRow | undefined
    const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(toConversation)
    if (conversation !== undefined) {
      if (existing === undefined) {
        db.prepare('UPDATE conversations SET id = ?, peer_key = ? WHERE id = ?').run(
          toConversation,
          to,
          fromConversation
        )
        db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(
          toConversation,
          fromConversation
        )
        db.prepare('UPDATE file_tasks SET conversation_id = ? WHERE conversation_id = ?').run(
          toConversation,
          fromConversation
        )
      } else {
        db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(
          toConversation,
          fromConversation
        )
        db.prepare('UPDATE file_tasks SET conversation_id = ? WHERE conversation_id = ?').run(
          toConversation,
          fromConversation
        )
        db.prepare(
          `UPDATE conversations SET
             unread = unread + ?,
             last_message_at = MAX(last_message_at, ?)
           WHERE id = ?`
        ).run(conversation.unread, conversation.last_message_at, toConversation)
        db.prepare('DELETE FROM conversations WHERE id = ?').run(fromConversation)
      }
    }
    db.exec('RELEASE rename_peer_key')
  } catch (error) {
    db.exec('ROLLBACK TO rename_peer_key')
    db.exec('RELEASE rename_peer_key')
    throw error
  }
}
