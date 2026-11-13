import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase, repairFileMessageStatuses } from './db'
import { SCHEMA_VERSION } from './schema'

const tempDirs: string[] = []

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-db-'))
  tempDirs.push(dir)
  return join(dir, 'lanpost.db')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('repairFileMessageStatuses', () => {
  it('把已完成文件任务的发送中消息改成已发送', () => {
    const db = openDatabase(':memory:')
    db.prepare(
      `INSERT INTO conversations (id, kind, title, created_at) VALUES ('direct:x', 'direct', 'x', 1)`
    ).run()
    db.prepare(
      `INSERT INTO messages (id, conversation_id, direction, kind, text, status, created_at)
       VALUES (1, 'direct:x', 'out', 'file', 'a.txt', 'sending', 1)`
    ).run()
    db.prepare(
      `INSERT INTO file_tasks (id, message_id, conversation_id, direction, name, state, created_at, updated_at)
       VALUES ('pf1', 1, 'direct:x', 'out', 'a.txt', 'done', 1, 1)`
    ).run()
    repairFileMessageStatuses(db)
    expect(db.prepare('SELECT status FROM messages WHERE id = 1').get()).toEqual({ status: 'sent' })
    db.close()
  })
})

describe('openDatabase', () => {
  it('creates the phase 0 tables and sets the schema version', () => {
    const db = openDatabase(tempDb())
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining([
        'conversations',
        'messages',
        'file_tasks',
        'peers',
        'group_members',
        'qgroups',
        'qgroup_members'
      ])
    )
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('adds the newer tables when opening an older database', () => {
    const file = tempDb()
    const older = new DatabaseSync(file)
    older.exec('CREATE TABLE conversations (id TEXT PRIMARY KEY)')
    older.exec('PRAGMA user_version = 1')
    older.close()

    const db = openDatabase(file)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['qgroups', 'qgroup_members']))
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(SCHEMA_VERSION)
    db.close()
  })

  it('finds chinese text with a like query', () => {
    const db = openDatabase(tempDb())
    db.prepare('INSERT INTO conversations (id, kind, title, created_at) VALUES (?, ?, ?, ?)').run(
      'c1',
      'direct',
      '测试会话',
      1
    )
    db.prepare(
      'INSERT INTO messages (conversation_id, direction, kind, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run('c1', 'in', 'text', '局域网文件传输', 'delivered', 1)
    const rows = db.prepare('SELECT id FROM messages WHERE text LIKE ?').all('%文件%')
    expect(rows).toHaveLength(1)
    db.close()
  })

  it('refuses a database from a newer schema version without changing it', () => {
    const file = tempDb()
    const db = openDatabase(file)
    db.exec('PRAGMA user_version = 99')
    db.close()
    const before = readFileSync(file).toString('hex')
    expect(() => openDatabase(file)).toThrow(/更新版本/)
    expect(readFileSync(file).toString('hex')).toBe(before)
  })

  it('reports a corrupt database with its path', () => {
    const file = tempDb()
    writeFileSync(file, 'this is not a database')
    expect(() => openDatabase(file)).toThrow(/打开数据库失败.*lanpost\.db/)
  })

  it('reports a locked database instead of hanging', () => {
    const file = tempDb()
    const holder = new DatabaseSync(file)
    holder.exec('CREATE TABLE locked_table (a INTEGER)')
    holder.exec('BEGIN EXCLUSIVE')
    try {
      expect(() => openDatabase(file, { busyTimeout: 50 })).toThrow(/database is locked/)
    } finally {
      holder.exec('ROLLBACK')
      holder.close()
    }
  })
})
