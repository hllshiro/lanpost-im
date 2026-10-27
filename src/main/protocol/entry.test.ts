import { describe, expect, it } from 'vitest'
import { encodeEntry, parseEntry } from './entry'

describe('entry', () => {
  it('keeps GBK traditional fields and exact UTF-8 block', () => {
    const buf = encodeEntry({
      name: '张三',
      group: '研发',
      account: 'zhangsan',
      host: 'pc',
      version: 'lanpost-im/0.1.0'
    })
    const parsed = parseEntry(buf)
    expect(parsed.name).toBe('张三')
    expect(parsed.group).toBe('研发')
    expect(parsed.account).toBe('zhangsan')
    expect(parsed.version).toBe('lanpost-im/0.1.0')
  })

  it('round-trips the lanpost identity extension', () => {
    const parsed = parseEntry(
      encodeEntry({
        name: '张三',
        group: '研发',
        account: 'zhangsan',
        host: 'pc',
        version: 'v',
        identityId: 'abc123'
      })
    )
    expect(parsed.identityId).toBe('abc123')
  })

  it('uses two NULs when group is empty', () => {
    const buf = encodeEntry({ name: 'a', group: '', account: 'a', host: 'pc', version: 'v' })
    expect(buf.subarray(0, 3).toString('hex')).toBe('610000')
  })

  it('keeps emoji out of the GBK field but exact in the UTF-8 block', () => {
    const parsed = parseEntry(
      encodeEntry({ name: '甲😀', group: '', account: 'a', host: 'pc', version: 'v' })
    )
    expect(parsed.name).toBe('甲😀')
  })
})
