import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AvatarStore } from './store'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-avatar-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

describe('AvatarStore', () => {
  it('stores an avatar by its md5 and reads it back', () => {
    const store = new AvatarStore(tempDir())
    const data = Buffer.from('fake-png-data')
    const md5 = AvatarStore.md5(data)
    expect(store.has(md5)).toBe(false)
    const path = store.put(md5, data)
    expect(path.endsWith(md5)).toBe(true)
    expect(store.has(md5)).toBe(true)
    expect(store.read(md5)?.equals(data)).toBe(true)
  })

  it('returns null for an unknown or empty md5', () => {
    const store = new AvatarStore(tempDir())
    expect(store.read('missing')).toBeNull()
    expect(store.read('')).toBeNull()
    expect(store.has('')).toBe(false)
  })
})
