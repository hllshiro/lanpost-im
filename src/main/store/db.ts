import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true })
  }

  let db: DatabaseSync
  try {
    db = new DatabaseSync(file)
  } catch (error) {
    throw new Error(`打开数据库失败 (${file}): ${messageOf(error)}`)
  }

  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')

    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (row.user_version > SCHEMA_VERSION) {
      throw new Error(`数据库由更新版本创建，无法打开 (${file})`)
    }
    if (row.user_version === 0) {
      db.exec('BEGIN')
      try {
        db.exec(SCHEMA_SQL)
        db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
