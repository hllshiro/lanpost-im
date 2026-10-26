import { afterEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { copyFallbackData, migrateCaseDirectory } from './data-dir'

const tempDirs: string[] = []

function tempParent(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-migrate-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('migrateCaseDirectory', () => {
  it('renames the legacy directory and keeps its files', () => {
    const parent = tempParent()
    const legacy = join(parent, 'Lanpost-IM-dev')
    const target = join(parent, 'lanpost-im-dev')
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'settings.json'), '{"version":1}')

    expect(migrateCaseDirectory(legacy, target)).toEqual({ migrated: true })
    expect(readdirSync(parent)).toEqual(['lanpost-im-dev'])
    expect(readFileSync(join(target, 'settings.json'), 'utf8')).toBe('{"version":1}')
  })

  it.skipIf(process.platform === 'win32')('keeps the target when both names already exist', () => {
    const parent = tempParent()
    const legacy = join(parent, 'Lanpost-IM-dev')
    const target = join(parent, 'lanpost-im-dev')
    mkdirSync(legacy)
    mkdirSync(target)

    const result = migrateCaseDirectory(legacy, target)
    expect(result.migrated).toBe(false)
    expect(result.reason).toContain('target directory already exists')
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(target)).toBe(true)
  })

  it('does nothing when the legacy directory is absent', () => {
    const parent = tempParent()
    const result = migrateCaseDirectory(join(parent, 'Lanpost-IM'), join(parent, 'lanpost-im'))
    expect(result.migrated).toBe(false)
    expect(result.reason).toContain('legacy directory missing')
  })
})

describe('copyFallbackData', () => {
  it('copies the database and settings into an empty target', () => {
    const parent = tempParent()
    const source = join(parent, '.dev-data')
    const target = join(parent, 'lanpost-im-dev')
    mkdirSync(source)
    writeFileSync(join(source, 'lanpost.db'), 'database')
    writeFileSync(join(source, 'lanpost.db-wal'), 'wal')
    writeFileSync(join(source, 'settings.json'), '{"version":1}')

    expect(copyFallbackData(source, target)).toEqual([
      'lanpost.db',
      'lanpost.db-wal',
      'settings.json'
    ])
    expect(readFileSync(join(target, 'lanpost.db'), 'utf8')).toBe('database')
    expect(readFileSync(join(target, 'lanpost.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(join(target, 'settings.json'), 'utf8')).toBe('{"version":1}')
  })

  it('does not overwrite data that already exists in the target', () => {
    const parent = tempParent()
    const source = join(parent, '.dev-data')
    const target = join(parent, 'lanpost-im-dev')
    mkdirSync(source)
    mkdirSync(target)
    writeFileSync(join(source, 'lanpost.db'), 'source')
    writeFileSync(join(source, 'lanpost.db-wal'), 'source-wal')
    writeFileSync(join(target, 'lanpost.db'), 'target')

    expect(copyFallbackData(source, target)).toEqual([])
    expect(readFileSync(join(target, 'lanpost.db'), 'utf8')).toBe('target')
    expect(existsSync(join(target, 'lanpost.db-wal'))).toBe(false)
  })

  it('does nothing without a source database', () => {
    const parent = tempParent()
    expect(copyFallbackData(join(parent, '.dev-data'), join(parent, 'lanpost-im-dev'))).toEqual([])
  })
})
