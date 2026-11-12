import { describe, expect, it } from 'vitest'
import { StagedStore } from './staged'

function image(path: string, temporary = true): Parameters<StagedStore['add']>[1][number] {
  return { path, size: 1024, kind: 'image', temporary }
}

describe('StagedStore', () => {
  it('keeps the order the attachments were added in', () => {
    const store = new StagedStore()
    store.add('c1', [image('/tmp/a.png'), image('/tmp/b.png')])
    store.add('c1', [image('/tmp/c.png')])

    expect(store.list('c1').map((item) => item.name)).toEqual(['a.png', 'b.png', 'c.png'])
    expect(store.list('c1')[0]?.path).toBe('/tmp/a.png')
  })

  it('separates conversations', () => {
    const store = new StagedStore()
    store.add('c1', [image('/tmp/a.png')])
    store.add('c2', [image('/tmp/b.png')])

    expect(store.list('c1').map((item) => item.name)).toEqual(['a.png'])
    expect(store.list('c2').map((item) => item.name)).toEqual(['b.png'])
    expect(store.all()).toHaveLength(2)
  })

  it('hands back the disk location of the next attachment', () => {
    const store = new StagedStore()
    const [first] = store.add('c1', [image('/tmp/a.png', false), image('/tmp/b.png')])

    expect(first.kind).toBe('image')
    expect(store.file(first.id)).toEqual({ path: '/tmp/a.png', temporary: false })
  })

  it('forgets an attachment once it is taken', () => {
    const store = new StagedStore()
    const [first] = store.add('c1', [image('/tmp/a.png'), image('/tmp/b.png')])

    expect(store.take('c1', first.id)).toEqual({ path: '/tmp/a.png', temporary: true })
    expect(store.file(first.id)).toBeUndefined()
    expect(store.list('c1').map((item) => item.name)).toEqual(['b.png'])
  })

  it('returns null for an attachment that is not staged', () => {
    const store = new StagedStore()

    expect(store.take('c1', 'stg404')).toBeNull()
    expect(store.file('stg404')).toBeUndefined()
  })

  it('marks picked files as belonging to the user', () => {
    const store = new StagedStore()
    const [picked] = store.add('c1', [
      { path: '/tmp/报告.pdf', size: 2048, kind: 'file', temporary: false }
    ])

    expect(picked.kind).toBe('file')
    expect(store.file(picked.id)?.temporary).toBe(false)
  })
})
