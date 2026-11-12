import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanFolder } from './folder-info'

describe('scanFolder', () => {
  let dir = ''

  afterEach(() => {
    if (dir !== '') {
      rmSync(dir, { recursive: true, force: true })
      dir = ''
    }
  })

  it('lists files only and keeps directories as path prefixes', () => {
    dir = mkdtempSync(join(tmpdir(), 'lanpost-folder-info-'))
    mkdirSync(join(dir, '子目录'))
    writeFileSync(join(dir, 'a.txt'), 'hello')
    writeFileSync(join(dir, '子目录', 'b.txt'), 'second')

    const info = scanFolder(dir)
    expect(info.items.map((item) => item.name).sort()).toEqual(['a.txt', '子目录\\b.txt'])
    expect(info.items.every((item) => !item.dir)).toBe(true)
    expect(info.count).toBe(2)
    expect(info.totalSize).toBe(11)
  })
})
