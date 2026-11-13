import { describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { mergePeers } from './peer-merge'
import { createRepositories } from './repositories'

const TARGET = 'target-user'
const ORIGIN = 'origin-user'
const OTHER = 'other-user'

function seedPeer(
  db: ReturnType<typeof openDatabase>,
  key: string,
  name: string,
  overrides: { alias?: string; lastSeen?: number } = {}
): void {
  db.prepare(
    `INSERT INTO peers (key, ip, port, user, host, name, alias, last_seen) VALUES (?, '', 0, ?, '', ?, ?, ?)`
  ).run(key, key, name, overrides.alias ?? '', overrides.lastSeen ?? 0)
}

function insertMessage(
  db: ReturnType<typeof openDatabase>,
  conversationId: string,
  id: string | null,
  text: string,
  time: number,
  meta = '{}'
): number {
  const result = db
    .prepare(
      `INSERT INTO messages (conversation_id, direction, kind, text, status, created_at, meta, nwt_id)
       VALUES (?, 'in', 'text', ?, 'delivered', ?, ?, ?)`
    )
    .run(conversationId, text, time, meta, id ?? '')
  return Number(result.lastInsertRowid)
}

describe('mergePeers', () => {
  it('两边都有会话时合并消息、按消息号去重并挪走文件', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedPeer(db, TARGET, '目标')
    seedPeer(db, ORIGIN, '来源')
    repos.conversations.ensureDirect(TARGET, '目标')
    repos.conversations.ensureDirect(ORIGIN, '来源')

    insertMessage(db, `direct:${TARGET}`, 'm1', '目标的一条', 100)
    const kept = insertMessage(db, `direct:${ORIGIN}`, 'm2', '来源的一条', 200)
    const duplicate = insertMessage(db, `direct:${ORIGIN}`, 'm1', '重复的消息', 300)
    db.prepare(
      `INSERT INTO file_tasks (id, message_id, conversation_id, direction, name, state, created_at, updated_at)
       VALUES ('f1', ?, ?, 'in', 'a.txt', 'done', 200, 200)`
    ).run(kept, `direct:${ORIGIN}`)
    db.prepare(
      `INSERT INTO file_tasks (id, message_id, conversation_id, direction, name, state, created_at, updated_at)
       VALUES ('f2', ?, ?, 'in', 'b.txt', 'done', 300, 300)`
    ).run(duplicate, `direct:${ORIGIN}`)

    const result = mergePeers(db, TARGET, [ORIGIN])

    expect(result).toEqual({ peers: 1, messages: 1, skipped: 1, files: 1 })
    expect(repos.conversations.get(`direct:${ORIGIN}`)).toBeNull()
    const messages = db
      .prepare('SELECT text, nwt_id FROM messages WHERE conversation_id = ? ORDER BY created_at')
      .all(`direct:${TARGET}`)
    expect(messages.map((row) => (row as { text: string }).text)).toEqual([
      '目标的一条',
      '来源的一条'
    ])
    expect(db.prepare('SELECT id FROM file_tasks ORDER BY id').all()).toEqual([{ id: 'f1' }])
    expect(db.prepare('SELECT COUNT(*) AS n FROM peers').get()).toEqual({ n: 1 })
    db.close()
  })

  it('只有来源有会话时直接把会话改成目标的键', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedPeer(db, TARGET, '目标')
    seedPeer(db, ORIGIN, '来源')
    repos.conversations.ensureDirect(ORIGIN, '来源')
    insertMessage(db, `direct:${ORIGIN}`, 'm1', '一条', 100)

    const result = mergePeers(db, TARGET, [ORIGIN])

    expect(result).toEqual({ peers: 1, messages: 1, skipped: 0, files: 0 })
    const conversation = repos.conversations.get(`direct:${TARGET}`)
    expect(conversation?.title).toBe('来源')
    expect(db.prepare('SELECT conversation_id FROM messages').get()).toEqual({
      conversation_id: `direct:${TARGET}`
    })
    db.close()
  })

  it('别名与头像在没有冲突时转到目标', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedPeer(db, TARGET, '目标')
    seedPeer(db, ORIGIN, '来源', { alias: '老备注', lastSeen: 50 })
    repos.peers.setAvatar(ORIGIN, 7, 'avatar-md5')

    mergePeers(db, TARGET, [ORIGIN])

    const peer = repos.peers.get(TARGET)
    expect(peer?.alias).toBe('老备注')
    expect(peer?.avatarMd5).toBe('avatar-md5')
    expect(repos.peers.get(ORIGIN)).toBeNull()
    db.close()
  })

  it('群成员与群消息里的发送者改成目标', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    seedPeer(db, TARGET, '目标')
    seedPeer(db, ORIGIN, '来源')
    repos.groups.upsert({
      id: 'g1',
      name: '群',
      topic: '',
      announcement: '',
      master: TARGET,
      infoVersion: 1,
      userVersion: 1,
      allowOtherAdd: 0,
      photoMd5: '',
      updatedAt: 1
    })
    repos.groups.replaceMembers('g1', [
      { userId: TARGET, name: '目标' },
      { userId: ORIGIN, name: '来源' },
      { userId: OTHER, name: '别人' }
    ])
    const conversationId = 'group:g1'
    repos.conversations.ensureGroup('g1', '群')
    insertMessage(
      db,
      conversationId,
      'gm1',
      '来源说的话',
      100,
      JSON.stringify({ senderId: ORIGIN, senderName: '来源' })
    )
    insertMessage(
      db,
      conversationId,
      'gm2',
      '别人的话',
      200,
      JSON.stringify({ senderId: OTHER, senderName: '别人' })
    )

    mergePeers(db, TARGET, [ORIGIN])

    const members = repos.groups.members('g1')
    expect(members.map((member) => member.userId).sort()).toEqual([TARGET, OTHER].sort())
    const metas = db
      .prepare('SELECT meta FROM messages ORDER BY created_at')
      .all() as unknown as Array<{ meta: string }>
    expect(JSON.parse(metas[0].meta)).toMatchObject({ senderId: TARGET })
    expect(JSON.parse(metas[1].meta)).toMatchObject({ senderId: OTHER })
    db.close()
  })

  it('目标不存在或来源包含目标时明确报错', () => {
    const db = openDatabase(':memory:')
    seedPeer(db, ORIGIN, '来源')
    expect(() => mergePeers(db, 'missing', [ORIGIN])).toThrow('目标联系人不存在')
    seedPeer(db, TARGET, '目标')
    expect(() => mergePeers(db, TARGET, [TARGET, ORIGIN])).toThrow('来源不能包含目标联系人')
    expect(() => mergePeers(db, TARGET, [])).toThrow('请选择要并入的联系人')
    db.close()
  })
})
