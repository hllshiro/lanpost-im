import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sanitizeFileName, uniqueName } from '../files/names'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function dir(): string {
  const value = mkdtempSync(join(tmpdir(), 'orbit-ipmsg-names-'))
  dirs.push(value)
  return value
}

describe('IPMSG file names', () => {
  it('strips paths, control chars and traversal', () => {
    expect(sanitizeFileName('..\\evil.txt')).toBe('evil.txt')
    expect(sanitizeFileName('a\u0000b.txt')).toBe('ab.txt')
    expect(sanitizeFileName('../../')).toBe('')
  })

  it('replaces Windows-illegal characters and reserved names', () => {
    expect(sanitizeFileName('a<b>c|d?e*.txt')).toBe('a_b_c_d_e_.txt')
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('name. ')).toBe('name')
  })

  it('generates unique names without overwriting', () => {
    const receiveDir = dir()
    writeFileSync(join(receiveDir, 'same.txt'), 'one')
    expect(uniqueName(receiveDir, 'same.txt')).toBe('same (1).txt')
  })
})
