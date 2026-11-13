import type { DatabaseSync } from 'node:sqlite'
import type { PeerMergeResult } from '../../shared/ipc'

interface PeerRow {
  key: string
  alias: string
  name: string
  corporation: string
  department: string
  sign: string
  last_seen: number
  online: number
  ready: number
}

interface ConversationRow {
  id: string
  pinned: number
  unread: number
  last_message_at: number
}

interface MessageRow {
  id: number
  nwt_id: string
  meta: string
}

// 把一个或多个来源联系人并入目标联系人：会话、消息、文件、头像与群成员身份一起转过去
export function mergePeers(
  db: DatabaseSync,
  targetKey: string,
  originKeys: string[]
): PeerMergeResult {
  if (targetKey === '') throw new Error('目标联系人不存在')
  const origins = [...new Set(originKeys)].filter((key) => key !== '')
  if (origins.length === 0) throw new Error('请选择要并入的联系人')
  if (origins.includes(targetKey)) throw new Error('来源不能包含目标联系人')
  const target = peerOf(db, targetKey)
  if (target === null) throw new Error('目标联系人不存在')

  const result: PeerMergeResult = { peers: 0, messages: 0, skipped: 0, files: 0 }
  db.exec('SAVEPOINT merge_peers')
  db.exec('PRAGMA defer_foreign_keys = ON')
  try {
    for (const origin of origins) {
      const peer = peerOf(db, origin)
      if (peer === null) continue
      mergeConversation(db, targetKey, origin, result)
      mergePeerRow(db, target, peer)
      moveAvatar(db, targetKey, origin)
      remapUserReferences(db, origin, targetKey, target.name)
      db.prepare('DELETE FROM peers WHERE key = ?').run(origin)
      result.peers += 1
    }
    db.exec('RELEASE merge_peers')
    return result
  } catch (error) {
    db.exec('ROLLBACK TO merge_peers')
    db.exec('RELEASE merge_peers')
    throw error
  }
}

function peerOf(db: DatabaseSync, key: string): PeerRow | null {
  const row = db.prepare('SELECT * FROM peers WHERE key = ?').get(key) as PeerRow | undefined
  return row === undefined ? null : row
}

function mergeConversation(
  db: DatabaseSync,
  targetKey: string,
  originKey: string,
  result: PeerMergeResult
): void {
  const from = `direct:${originKey}`
  const to = `direct:${targetKey}`
  const source = db.prepare('SELECT * FROM conversations WHERE id = ?').get(from) as
    ConversationRow | undefined
  if (source === undefined) return
  const existing = db.prepare('SELECT * FROM conversations WHERE id = ?').get(to) as
    ConversationRow | undefined

  if (existing === undefined) {
    result.messages += countMessages(db, from)
    result.files += countFiles(db, from)
    db.prepare('UPDATE conversations SET id = ?, peer_key = ? WHERE id = ?').run(
      to,
      targetKey,
      from
    )
    db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(to, from)
    db.prepare('UPDATE file_tasks SET conversation_id = ? WHERE conversation_id = ?').run(to, from)
    return
  }

  const totalFiles = countFiles(db, from)
  const known = new Set(
    (
      db
        .prepare("SELECT nwt_id FROM messages WHERE conversation_id = ? AND nwt_id <> ''")
        .all(to) as unknown as Array<{ nwt_id: string }>
    ).map((row) => row.nwt_id)
  )
  const messages = db
    .prepare(
      'SELECT id, nwt_id, meta FROM messages WHERE conversation_id = ? ORDER BY created_at, id'
    )
    .all(from) as unknown as MessageRow[]
  const dropped: number[] = []
  for (const message of messages) {
    if (message.nwt_id !== '' && known.has(message.nwt_id)) {
      dropped.push(message.id)
      continue
    }
    db.prepare('UPDATE messages SET conversation_id = ? WHERE id = ?').run(to, message.id)
    if (message.nwt_id !== '') known.add(message.nwt_id)
    result.messages += 1
  }
  let droppedFiles = 0
  for (const id of dropped) {
    droppedFiles += (
      db.prepare('SELECT COUNT(*) AS n FROM file_tasks WHERE message_id = ?').get(id) as {
        n: number
      }
    ).n
    db.prepare('DELETE FROM file_tasks WHERE message_id = ?').run(id)
    db.prepare('DELETE FROM messages WHERE id = ?').run(id)
  }
  db.prepare('UPDATE file_tasks SET conversation_id = ? WHERE conversation_id = ?').run(to, from)
  db.prepare(
    `UPDATE conversations SET
       unread = unread + ?,
       pinned = MAX(pinned, ?),
       last_message_at = MAX(last_message_at, ?),
       last_read_message_id = MAX(last_read_message_id, ?)
     WHERE id = ?`
  ).run(source.unread, source.pinned, source.last_message_at, 0, to)
  db.prepare('DELETE FROM conversations WHERE id = ?').run(from)
  result.skipped += dropped.length
  result.files += totalFiles - droppedFiles
}

function countMessages(db: DatabaseSync, conversationId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?')
      .get(conversationId) as {
      n: number
    }
  ).n
}

function countFiles(db: DatabaseSync, conversationId: string): number {
  return (
    db
      .prepare('SELECT COUNT(*) AS n FROM file_tasks WHERE conversation_id = ?')
      .get(conversationId) as {
      n: number
    }
  ).n
}

function mergePeerRow(db: DatabaseSync, target: PeerRow, origin: PeerRow): void {
  db.prepare(
    `UPDATE peers SET
       alias = CASE WHEN alias = '' THEN ? ELSE alias END,
       corporation = CASE WHEN corporation = '' THEN ? ELSE corporation END,
       department = CASE WHEN department = '' THEN ? ELSE department END,
       sign = CASE WHEN sign = '' THEN ? ELSE sign END,
       online = MAX(online, ?),
       ready = MAX(ready, ?),
       last_seen = MAX(last_seen, ?)
     WHERE key = ?`
  ).run(
    origin.alias,
    origin.corporation,
    origin.department,
    origin.sign,
    origin.online,
    origin.ready,
    origin.last_seen,
    target.key
  )
}

function moveAvatar(db: DatabaseSync, targetKey: string, originKey: string): void {
  const target = db
    .prepare('SELECT avatar_md5 FROM peer_avatars WHERE peer_key = ?')
    .get(targetKey) as { avatar_md5: string } | undefined
  if (target === undefined || target.avatar_md5 === '') {
    db.prepare('UPDATE peer_avatars SET peer_key = ? WHERE peer_key = ?').run(targetKey, originKey)
    return
  }
  db.prepare('DELETE FROM peer_avatars WHERE peer_key = ?').run(originKey)
}

function remapUserReferences(
  db: DatabaseSync,
  originKey: string,
  targetKey: string,
  targetName: string
): void {
  const groups = db
    .prepare('SELECT group_id FROM qgroup_members WHERE user_id = ?')
    .all(originKey) as unknown as Array<{ group_id: string }>
  for (const { group_id: groupId } of groups) {
    const exists = db
      .prepare('SELECT 1 AS hit FROM qgroup_members WHERE group_id = ? AND user_id = ?')
      .get(groupId, targetKey)
    if (exists === undefined) {
      db.prepare(
        'UPDATE qgroup_members SET user_id = ?, name = ? WHERE group_id = ? AND user_id = ?'
      ).run(targetKey, targetName, groupId, originKey)
    } else {
      db.prepare('DELETE FROM qgroup_members WHERE group_id = ? AND user_id = ?').run(
        groupId,
        originKey
      )
    }
  }

  const legacy = db
    .prepare('SELECT conversation_id FROM group_members WHERE peer_key = ?')
    .all(originKey) as unknown as Array<{ conversation_id: string }>
  for (const { conversation_id: conversationId } of legacy) {
    const exists = db
      .prepare('SELECT 1 AS hit FROM group_members WHERE conversation_id = ? AND peer_key = ?')
      .get(conversationId, targetKey)
    if (exists === undefined) {
      db.prepare(
        'UPDATE group_members SET peer_key = ? WHERE conversation_id = ? AND peer_key = ?'
      ).run(targetKey, conversationId, originKey)
    } else {
      db.prepare('DELETE FROM group_members WHERE conversation_id = ? AND peer_key = ?').run(
        conversationId,
        originKey
      )
    }
  }

  const messages = db
    .prepare('SELECT id, meta FROM messages WHERE meta LIKE ?')
    .all(`%"senderId":"${originKey}"%`) as unknown as Array<{ id: number; meta: string }>
  for (const message of messages) {
    let meta: unknown
    try {
      meta = JSON.parse(message.meta) as unknown
    } catch {
      continue
    }
    if (typeof meta !== 'object' || meta === null) continue
    const record = meta as Record<string, unknown>
    if (record.senderId !== originKey) continue
    record.senderId = targetKey
    db.prepare('UPDATE messages SET meta = ? WHERE id = ?').run(JSON.stringify(record), message.id)
  }
}
