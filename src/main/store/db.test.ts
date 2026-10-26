import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from './db'

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

describe('openDatabase', () => {
  it('creates the phase 0 tables and sets the schema version', () => {
    const db = openDatabase(tempDb())
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining(['conversations', 'messages', 'file_tasks', 'peers', 'group_members'])
    )
    const version = db.prepare('PRAGMA user_version').get() as { user_version: number }
    expect(version.user_version).toBe(1)
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
