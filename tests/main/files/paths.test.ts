import { describe, expect, it } from 'vitest'
import { safeRelativePath } from '../../../src/main/files/paths'

describe('safeRelativePath', () => {
  it('keeps nested relative paths', () => {
    expect(safeRelativePath('a/b.txt')).toBe('a/b.txt')
    expect(safeRelativePath('照片/2026/合影.jpg')).toBe('照片/2026/合影.jpg')
  })

  it('preserves Chinese names and normalizes backslashes', () => {
    expect(safeRelativePath('中文 目录/报告 2026.pdf')).toBe('中文 目录/报告 2026.pdf')
    expect(safeRelativePath('a\\b\\c.txt')).toBe('a/b/c.txt')
    expect(safeRelativePath('a\\b/c.txt')).toBe('a/b/c.txt')
  })

  it('trims segments and drops redundant separators', () => {
    expect(safeRelativePath('  a  /  b.txt  ')).toBe('a/b.txt')
    expect(safeRelativePath('a//b///c.txt')).toBe('a/b/c.txt')
    expect(safeRelativePath('a/b/')).toBe('a/b')
  })

  it('rejects empty names and traversal segments', () => {
    expect(safeRelativePath('')).toBeNull()
    expect(safeRelativePath('   ')).toBeNull()
    expect(safeRelativePath('..')).toBeNull()
    expect(safeRelativePath('.')).toBeNull()
    expect(safeRelativePath('../x')).toBeNull()
    expect(safeRelativePath('a/../b')).toBeNull()
    expect(safeRelativePath('a/./b')).toBeNull()
    expect(safeRelativePath('a/b/..')).toBeNull()
    expect(safeRelativePath('a/b/.')).toBeNull()
    expect(safeRelativePath('.. ')).toBeNull()
    expect(safeRelativePath('.../x')).toBeNull()
  })

  it('rejects absolute paths and drive letters', () => {
    expect(safeRelativePath('/etc/passwd')).toBeNull()
    expect(safeRelativePath('\\etc\\passwd')).toBeNull()
    expect(safeRelativePath('C:\\Windows\\win.ini')).toBeNull()
    expect(safeRelativePath('c:/x')).toBeNull()
    expect(safeRelativePath('D:file.txt')).toBeNull()
    expect(safeRelativePath('\\\\server\\share\\x')).toBeNull()
    expect(safeRelativePath('/')).toBeNull()
    expect(safeRelativePath('///')).toBeNull()
  })

  it('rejects NUL and control characters', () => {
    expect(safeRelativePath('a\u0000b.txt')).toBeNull()
    expect(safeRelativePath('a/b\u0007c.txt')).toBeNull()
    expect(safeRelativePath('a/b\u001fc.txt')).toBeNull()
    expect(safeRelativePath('a/b\u007fc.txt')).toBeNull()
  })

  it('limits each segment to 200 characters', () => {
    const long = 'x'.repeat(300)
    expect(safeRelativePath(long)).toBe('x'.repeat(200))
    expect(safeRelativePath(`${long}/b.txt`)).toBe(`${'x'.repeat(200)}/b.txt`)

    const longChinese = '中'.repeat(260)
    expect(safeRelativePath(longChinese)).toBe('中'.repeat(200))
  })
})
