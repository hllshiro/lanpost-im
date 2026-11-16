import type { DatabaseSync } from 'node:sqlite'

interface PeerIdentityRow {
  key: string
  user: string
  ip: string
}

interface ConversationRow {
  id: string
  peer_key: string | null
  unread: number
  pinned: number
  muted: number
  draft: string
  last_read_message_id: number
  last_message_at: number
}

export interface ConversationMerge {
  from: string
  to: string
}

// 把来源会话的消息、文件与未读合并到目标会话；目标不存在时直接改名
export function mergeDirectConversation(
  db: DatabaseSync,
  fromId: string,
  toId: string,
  peerKey: string
): void {
  if (fromId === toId) return
  const source = db.prepare('SELECT * FROM conversations WHERE id = ?').get(fromId) as
    ConversationRow | undefined
  if (source === undefined) return
  const target = db.prepare('SELECT * FROM conversations WHERE id = ?').get(toId) as
    ConversationRow | undefined
  if (target === undefined) {
    db.prepare('UPDATE conversations SET id = ?, peer_key = ? WHERE id = ?').run(
      toId,
      peerKey,
      fromId
    )
    db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(
      toId,
      fromId
    )
    db.prepare('UPDATE file_tasks SET conversation_id = ? WHERE conversation_id = ?').run(
      toId,
      fromId
    )
    return
  }
  db.prepare('UPDATE messages SET conversation_id = ? WHERE conversation_id = ?').run(toId, fromId)
  db.prepare('UPDATE file_tasks SET conversation_id = ? WHERE conversation_id = ?').run(
    toId,
    fromId
  )
  db.prepare(
    `UPDATE conversations SET
       unread = unread + ?,
       pinned = MAX(pinned, ?),
       muted = MAX(muted, ?),
       last_read_message_id = MAX(last_read_message_id, ?),
       last_message_at = MAX(last_message_at, ?),
       draft = CASE WHEN draft = '' THEN ? ELSE draft END
     WHERE id = ?`
  ).run(
    source.unread,
    source.pinned,
    source.muted,
    source.last_read_message_id,
    source.last_message_at,
    source.draft,
    toId
  )
  db.prepare('DELETE FROM conversations WHERE id = ?').run(fromId)
}

// 同一联系人在不同时期可能用地址或用户号作会话键：统一并到当前用户的 direct:<key>
export function reconcileDirectConversations(db: DatabaseSync): ConversationMerge[] {
  const peers = db
    .prepare('SELECT key, user, ip FROM peers ORDER BY last_seen DESC')
    .all() as unknown as PeerIdentityRow[]
  const identities = new Map<string, string>()
  for (const peer of peers) {
    for (const value of [peer.key, peer.user, peer.ip]) {
      if (value !== '' && !identities.has(value)) identities.set(value, peer.key)
    }
  }
  const conversations = db
    .prepare(
      "SELECT id, peer_key FROM conversations WHERE kind = 'direct' AND peer_key IS NOT NULL"
    )
    .all() as unknown as Array<{ id: string; peer_key: string }>
  const merges: ConversationMerge[] = []
  db.exec('SAVEPOINT reconcile_direct_conversations')
  try {
    for (const conversation of conversations) {
      const canonical = identities.get(conversation.peer_key)
      if (canonical === undefined || canonical === conversation.peer_key) continue
      const to = `direct:${canonical}`
      mergeDirectConversation(db, conversation.id, to, canonical)
      merges.push({ from: conversation.id, to })
    }
    db.exec('RELEASE reconcile_direct_conversations')
  } catch (error) {
    db.exec('ROLLBACK TO reconcile_direct_conversations')
    db.exec('RELEASE reconcile_direct_conversations')
    throw error
  }
  return merges
}
