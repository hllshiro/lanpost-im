import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema'

export interface OpenDatabaseOptions {
  busyTimeout?: number
}

class NewerSchemaError extends Error {}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function readExistingVersion(file: string): number | null {
  if (file === ':memory:' || !existsSync(file)) {
    return null
  }
  let probe: DatabaseSync | null = null
  try {
    probe = new DatabaseSync(file, { readOnly: true })
    const row = probe.prepare('PRAGMA user_version').get() as { user_version: number }
    return row.user_version
  } catch {
    return null
  } finally {
    probe?.close()
  }
}

export function migrate(db: DatabaseSync): void {
  db.exec('BEGIN')
  try {
    db.exec(SCHEMA_SQL)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 保留原始错误，回滚失败只说明事务没有建立。
    }
    throw error
  }
}

const RESET_TABLES = ['group_members', 'file_tasks', 'messages', 'peers', 'conversations']

// 第一版尚未发布，旧结构不提供迁移；版本落后时清空重建。
function resetSchema(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = OFF')
  try {
    for (const table of RESET_TABLES) {
      db.exec(`DROP TABLE IF EXISTS ${table}`)
    }
    db.exec('PRAGMA user_version = 0')
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

export function openDatabase(file: string, options: OpenDatabaseOptions = {}): DatabaseSync {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true })
  }

  const existing = readExistingVersion(file)
  if (existing !== null && existing > SCHEMA_VERSION) {
    throw new NewerSchemaError(`数据库由更新版本创建，无法打开 (${file})`)
  }

  let db: DatabaseSync
  try {
    db = new DatabaseSync(file)
  } catch (error) {
    throw new Error(`打开数据库失败 (${file}): ${messageOf(error)}`, { cause: error })
  }

  try {
    db.exec(`PRAGMA busy_timeout = ${options.busyTimeout ?? 5000}`)
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')

    const row = db.prepare('PRAGMA user_version').get() as { user_version: number }
    if (row.user_version > SCHEMA_VERSION) {
      throw new NewerSchemaError(`数据库由更新版本创建，无法打开 (${file})`)
    }
    if (row.user_version > 0 && row.user_version < SCHEMA_VERSION) {
      resetSchema(db)
    }
    if (row.user_version === 0 || row.user_version < SCHEMA_VERSION) {
      migrate(db)
    }
    return db
  } catch (error) {
    try {
      db.close()
    } catch {
      // 保留原始错误。
    }
    if (error instanceof NewerSchemaError) {
      throw error
    }
    throw new Error(`打开数据库失败 (${file}): ${messageOf(error)}`, { cause: error })
  }
}
