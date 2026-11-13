import { describe, expect, it } from 'vitest'
import { openDatabase } from './db'
import { ensureNwtMessageColumn, migratePeerKeys, renamePeerKey } from './peer-keys'

function openMemory(): ReturnType<typeof openDatabase> {
  const db = openDatabase(':memory:')
  db.prepare(
    `INSERT INTO conversations (id, kind, peer_key, title, created_at) VALUES (?, 'direct', ?, ?, ?)`
  ).run('direct:10.0.0.1|alice', '10.0.0.1|alice', '爱丽丝', 1)
  db.prepare(
    `INSERT INTO messages (conversation_id, direction, kind, text, status, created_at)
     VALUES (?, 'in', 'text', '你好', 'delivered', 2)`
  ).run('direct:10.0.0.1|alice')
  db.prepare(
    `INSERT INTO peers (key, ip, port, user, host, name, last_seen) VALUES (?, ?, 0, ?, '', ?, 10)`
  ).run('10.0.0.1|alice', '10.0.0.1', 'alice', '爱丽丝')
  db.prepare(
    `INSERT INTO file_tasks (id, conversation_id, direction, name, state, created_at, updated_at)
     VALUES ('pf1', ?, 'in', 'a.txt', 'done', 3, 3)`
  ).run('direct:10.0.0.1|alice')
  return db
}

describe('renamePeerKey', () => {
  it('把联系人与会话改成用户标识', () => {
    const db = openMemory()
    renamePeerKey(db, '10.0.0.1|alice', 'alice')

    expect(db.prepare('SELECT key, user FROM peers').all()).toEqual([
      { key: 'alice', user: 'alice' }
    ])
    const conversation = db.prepare('SELECT id, peer_key, title FROM conversations').get() as {
      id: string
      peer_key: string
      title: string
    }
    expect(conversation).toEqual({ id: 'direct:alice', peer_key: 'alice', title: '爱丽丝' })
    expect(db.prepare('SELECT conversation_id FROM messages').get()).toEqual({
      conversation_id: 'direct:alice'
    })
    expect(db.prepare('SELECT conversation_id FROM file_tasks').get()).toEqual({
      conversation_id: 'direct:alice'
    })
    db.close()
  })

  it('目标联系人已存在时合并会话与消息', () => {
    const db = openMemory()
    db.prepare(
      `INSERT INTO conversations (id, kind, peer_key, title, unread, last_message_at, created_at)
       VALUES ('direct:alice', 'direct', 'alice', '爱丽丝', 2, 20, 1)`
    ).run()
    db.prepare(
      `INSERT INTO peers (key, ip, port, user, host, name, alias, last_seen)
       VALUES ('alice', '10.0.0.2', 0, 'alice', '', 'Alice', '备注', 30)`
    ).run()

    renamePeerKey(db, '10.0.0.1|alice', 'alice')

    expect(db.prepare('SELECT key, alias, last_seen FROM peers').all()).toEqual([
      { key: 'alice', alias: '备注', last_seen: 30 }
    ])
    const conversation = db
      .prepare('SELECT id, unread, last_message_at FROM conversations')
      .get() as { id: string; unread: number; last_message_at: number }
    expect(conversation.id).toBe('direct:alice')
    expect(conversation.unread).toBe(2)
    expect(conversation.last_message_at).toBe(20)
    expect(db.prepare('SELECT COUNT(*) AS n FROM messages').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT conversation_id FROM messages').get()).toEqual({
      conversation_id: 'direct:alice'
    })
    db.close()
  })

  it('没有对应联系人时不动数据', () => {
    const db = openMemory()
    renamePeerKey(db, '10.0.0.9|nobody', 'nobody')
    expect(db.prepare('SELECT key FROM peers').all()).toEqual([{ key: '10.0.0.1|alice' }])
    db.close()
  })
})

describe('migratePeerKeys', () => {
  it('把按地址命名的联系人与会话批量改名', () => {
    const db = openMemory()
    migratePeerKeys(db)
    expect(db.prepare('SELECT key FROM peers').all()).toEqual([{ key: 'alice' }])
    expect(db.prepare('SELECT id FROM conversations').all()).toEqual([{ id: 'direct:alice' }])
    db.close()
  })

  it('重复执行不报错', () => {
    const db = openMemory()
    migratePeerKeys(db)
    migratePeerKeys(db)
    expect(db.prepare('SELECT key FROM peers').all()).toEqual([{ key: 'alice' }])
    db.close()
  })
})

describe('ensureNwtMessageColumn', () => {
  it('补上 nwt_id 列与索引', () => {
    const db = openMemory()
    ensureNwtMessageColumn(db)
    const columns = db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toContain('nwt_id')
    const indexes = db.prepare('PRAGMA index_list(messages)').all() as Array<{ name: string }>
    expect(indexes.map((index) => index.name)).toContain('idx_messages_nwt')
    db.close()
  })
})
