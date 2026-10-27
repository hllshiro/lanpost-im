import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  EXT_ATIME,
  EXT_CTIME,
  EXT_MTIME,
  FILE_ATTR_CLIPBOARD,
  FILE_ATTR_DIR,
  FILE_ATTR_REGULAR,
  FILE_OPT_RONLY
} from '../../../src/main/protocol/commands'
import { applyFileAttrs, fileType, parseExtAttrs } from '../../../src/main/protocol/attrs'

const dirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-attrs-'))
  dirs.push(dir)
  const file = join(dir, 'file.txt')
  writeFileSync(file, 'x')
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

describe('fileType', () => {
  it('reads only the low 8 bits', () => {
    expect(fileType(FILE_ATTR_REGULAR)).toBe(FILE_ATTR_REGULAR)
    expect(fileType(FILE_ATTR_DIR | FILE_OPT_RONLY)).toBe(FILE_ATTR_DIR)
    expect(fileType(FILE_ATTR_DIR | FILE_ATTR_REGULAR)).toBe(0x03)
    expect(fileType(FILE_ATTR_CLIPBOARD | FILE_OPT_RONLY)).toBe(FILE_ATTR_CLIPBOARD)
    expect(fileType(0xff00 | FILE_ATTR_CLIPBOARD)).toBe(FILE_ATTR_CLIPBOARD)
  })
})

describe('parseExtAttrs', () => {
  it('parses hex keys and hex values', () => {
    const ext = parseExtAttrs(['14=65a1b2', '10=1ff'])
    expect(ext.get(EXT_MTIME)).toBe('65a1b2')
    expect(ext.get(0x10)).toBe('1ff')
    expect(ext.size).toBe(2)
  })

  it('normalizes uppercase hex to lowercase', () => {
    const ext = parseExtAttrs(['14=65A1B2'])
    expect(ext.get(EXT_MTIME)).toBe('65a1b2')
  })

  it('keeps several known timestamps apart', () => {
    const ext = parseExtAttrs(['13=1', '14=2', '15=3'])
    expect(ext.get(EXT_CTIME)).toBe('1')
    expect(ext.get(EXT_MTIME)).toBe('2')
    expect(ext.get(EXT_ATIME)).toBe('3')
  })

  it('ignores malformed items instead of throwing', () => {
    const ext = parseExtAttrs(['', 'no-equals', '=ff', '20=', 'zz=1', '20=zz', '1f='])
    expect(ext.size).toBe(0)
  })

  it('tolerates surrounding spaces', () => {
    const ext = parseExtAttrs([' 14 = 65a1b2 '])
    expect(ext.get(EXT_MTIME)).toBe('65a1b2')
  })
})

describe('applyFileAttrs', () => {
  it('applies EXT_MTIME and the read-only flag', () => {
    const file = tempFile()
    const stamp = 1_700_000_000
    applyFileAttrs(
      file,
      FILE_ATTR_REGULAR | FILE_OPT_RONLY,
      parseExtAttrs([`14=${stamp.toString(16)}`])
    )

    const stat = statSync(file)
    expect(Math.round(stat.mtimeMs / 1000)).toBe(stamp)
    expect(stat.mode & 0o200).toBe(0)

    chmodSync(file, 0o666)
  })

  it('leaves the file writable without FILE_OPT_RONLY', () => {
    const file = tempFile()
    applyFileAttrs(file, FILE_ATTR_REGULAR, new Map())
    expect(statSync(file).mode & 0o200).not.toBe(0)
  })

  it('ignores unknown extension keys', () => {
    const file = tempFile()
    expect(() =>
      applyFileAttrs(
        file,
        FILE_ATTR_REGULAR,
        new Map([
          [EXT_ATIME, 'ff'],
          [0x99, '1']
        ])
      )
    ).not.toThrow()
    expect(statSync(file).mode & 0o200).not.toBe(0)
  })

  it('never throws on unusable timestamps or missing paths', () => {
    const file = tempFile()
    expect(() =>
      applyFileAttrs(file, FILE_ATTR_REGULAR, new Map([[EXT_MTIME, 'zz']]))
    ).not.toThrow()
    expect(() =>
      applyFileAttrs(`${file}.missing`, FILE_ATTR_REGULAR, new Map([[EXT_MTIME, 'ffffffff']]))
    ).not.toThrow()
  })
})
