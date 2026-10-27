import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeFileName, uniqueName } from '../../../src/main/files/names'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-names-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('sanitizeFileName', () => {
  it('keeps only the last path segment', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFileName('C:\\Users\\公用的\\报告.pdf')).toBe('报告.pdf')
    expect(sanitizeFileName('a/../b/..')).toBe('b')
  })

  it('removes control characters and unsafe separators', () => {
    expect(sanitizeFileName('a\u0000b\u001fc.txt')).toBe('abc.txt')
    expect(sanitizeFileName('  间隙  .txt  ')).toBe('间隙  .txt')
    expect(sanitizeFileName('report:2026.pdf')).toBe('report_2026.pdf')
  })

  it('rejects names that only contain traversal', () => {
    expect(sanitizeFileName('..')).toBe('')
    expect(sanitizeFileName('.')).toBe('')
    expect(sanitizeFileName('   ')).toBe('')
    expect(sanitizeFileName('../../')).toBe('')
  })
})

describe('uniqueName', () => {
  it('uses the original name when the directory is empty', () => {
    const dir = tempDir()
    expect(uniqueName(dir, '报告.pdf')).toBe('报告.pdf')
  })

  it('appends a counter before the extension', () => {
    const dir = tempDir()
    writeFileSync(join(dir, '报告.pdf'), 'x')
    expect(uniqueName(dir, '报告.pdf')).toBe('报告 (1).pdf')
    writeFileSync(join(dir, '报告 (1).pdf'), 'x')
    expect(uniqueName(dir, '报告.pdf')).toBe('报告 (2).pdf')
  })

  it('keeps names without an extension readable', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'README'), 'x')
    expect(uniqueName(dir, 'README')).toBe('README (1)')
  })

  it('honours names reserved by pending tasks', () => {
    const dir = tempDir()
    const reserved = new Set(['数据.bin', '数据 (1).bin'])
    expect(uniqueName(dir, '数据.bin', (candidate) => reserved.has(candidate))).toBe('数据 (2).bin')
  })

  it('falls back to file when the sanitized name is empty', () => {
    const dir = tempDir()
    expect(uniqueName(dir, '..')).toBe('file')
  })
})
