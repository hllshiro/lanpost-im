import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { receiveFolder } from '../../../src/main/files/layout'

const base = 'C:\recv'

describe('receiveFolder', () => {
  it('keeps flat layout unchanged', () => {
    expect(receiveFolder(base, 'flat', '10.0.0.1|alice', '张三')).toBe(base)
  })

  it('uses the peer nickname as a folder', () => {
    expect(receiveFolder(base, 'nickname', '10.0.0.1|alice', '张三')).toBe(join(base, '张三'))
  })

  it('sanitizes separators and falls back for empty or reserved names', () => {
    expect(receiveFolder(base, 'nickname', '10.0.0.1|alice', 'a/b:c')).toBe(join(base, 'a_b_c'))
    expect(receiveFolder(base, 'nickname', '10.0.0.1|alice', '')).toContain('未知联系人')
    expect(receiveFolder(base, 'nickname', '10.0.0.1|alice', 'CON')).toContain('未知联系人')
  })
})
