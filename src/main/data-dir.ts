import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface MigrationResult {
  migrated: boolean
  reason?: string
}

function describe(error: unknown): string {
  const code = (error as NodeJS.ErrnoException).code
  const message = error instanceof Error ? error.message : String(error)
  return code === undefined ? message : `${code}: ${message}`
}

// Windows 对大小写不敏感，大小写改名必须经过一个临时名字。
export function migrateCaseDirectory(legacyPath: string, targetPath: string): MigrationResult {
  const parent = dirname(targetPath)
  if (!existsSync(parent)) {
    return { migrated: false, reason: 'parent directory missing' }
  }
  const entries = readdirSync(parent)
  const legacyName = basename(legacyPath)
  const targetName = basename(targetPath)
  if (!entries.includes(legacyName)) {
    return { migrated: false, reason: 'legacy directory missing' }
  }
  if (entries.includes(targetName)) {
    return { migrated: false, reason: 'target directory already exists' }
  }

  const probe = join(parent, `.lanpost-migrate-test-${process.pid}-${Date.now()}`)
  try {
    writeFileSync(probe, '')
    unlinkSync(probe)
  } catch (error) {
    return { migrated: false, reason: `parent directory not writable: ${describe(error)}` }
  }

  const temporary = join(parent, `${targetName}.migrating-${process.pid}-${Date.now()}`)
  try {
    renameSync(legacyPath, temporary)
  } catch (error) {
    return { migrated: false, reason: describe(error) }
  }
  try {
    renameSync(temporary, targetPath)
  } catch (error) {
    try {
      renameSync(temporary, legacyPath)
    } catch {
      return {
        migrated: false,
        reason: `${describe(error)}; data is still at ${temporary}`
      }
    }
    return { migrated: false, reason: describe(error) }
  }
  return { migrated: true }
}

const databaseFiles = ['lanpost.db', 'lanpost.db-wal', 'lanpost.db-shm']

// 受限环境曾经使用 .dev-data；Roaming 恢复可写后把聊天历史带过去。
export function copyFallbackData(sourceDir: string, targetDir: string): string[] {
  if (!existsSync(join(sourceDir, 'lanpost.db'))) {
    return []
  }
  mkdirSync(targetDir, { recursive: true })
  const copied: string[] = []

  // WAL 和 SHM 必须和主数据库一起复制，不能单独带过去。
  if (!existsSync(join(targetDir, 'lanpost.db'))) {
    for (const name of databaseFiles) {
      const from = join(sourceDir, name)
      if (!existsSync(from)) {
        continue
      }
      copyFileSync(from, join(targetDir, name))
      copied.push(name)
    }
  }

  const settings = join(sourceDir, 'settings.json')
  if (existsSync(settings) && !existsSync(join(targetDir, 'settings.json'))) {
    copyFileSync(settings, join(targetDir, 'settings.json'))
    copied.push('settings.json')
  }
  return copied
}
