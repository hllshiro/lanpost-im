import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FavoriteStore } from './favorites'

describe('FavoriteStore', () => {
  const dirs: string[] = []

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
    }
    dirs.length = 0
  })

  function workspace(): { store: FavoriteStore; source: string } {
    const root = mkdtempSync(join(tmpdir(), 'lanpost-favorite-'))
    dirs.push(root)
    const source = join(root, 'smile.gif')
    writeFileSync(source, Buffer.from('GIF89a-fake-image'))
    return { store: new FavoriteStore(join(root, 'favorites')), source }
  }

  it('copies a file into the collection and lists it', () => {
    const { store, source } = workspace()
    const favorite = store.add(source)
    expect(store.list()).toEqual([
      { id: favorite.id, name: 'smile.gif', addedAt: favorite.addedAt }
    ])
    expect(store.filePath(favorite.id)).not.toBeNull()
  })

  it('does not duplicate the same image', () => {
    const { store, source } = workspace()
    const first = store.add(source)
    const second = store.add(source)
    expect(second.id).toBe(first.id)
    expect(store.list()).toHaveLength(1)
  })

  it('removes the file when the favorite is deleted', () => {
    const { store, source } = workspace()
    const favorite = store.add(source)
    const path = store.filePath(favorite.id)
    store.remove(favorite.id)
    expect(store.list()).toEqual([])
    expect(store.filePath(favorite.id)).toBeNull()
    expect(path).not.toBeNull()
  })
})
