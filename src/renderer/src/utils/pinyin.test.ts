import { describe, expect, it } from 'vitest'
import { compareLetters, comparePinyin, matchesPinyin, pinyinInfo } from './pinyin'

describe('pinyin helpers', () => {
  it('builds full pinyin, initials, syllables and the first letter', () => {
    expect(pinyinInfo('张三')).toMatchObject({
      full: 'zhangsan',
      initials: 'zs',
      letter: 'Z',
      syllables: ['zhang', 'san']
    })
    expect(pinyinInfo('Alice')).toMatchObject({
      full: 'alice',
      initials: 'alice',
      letter: 'A'
    })
    expect(pinyinInfo('123')).toMatchObject({ full: '123', initials: '123', letter: '#' })
  })

  it('matches Chinese, full pinyin, initials and spaced syllables', () => {
    expect(matchesPinyin('张三', '张')).toBe(true)
    expect(matchesPinyin('张三', 'zhang')).toBe(true)
    expect(matchesPinyin('张三', 'zhangsan')).toBe(true)
    expect(matchesPinyin('张三', 'zs')).toBe(true)
    expect(matchesPinyin('张三', 'zhang s')).toBe(true)
    expect(matchesPinyin('张三', 'z s')).toBe(true)
    expect(matchesPinyin('张三', 'lisi')).toBe(false)
    expect(matchesPinyin('Alice 王', 'alice w')).toBe(true)
    expect(matchesPinyin('Alice 王', 'aw')).toBe(true)
  })

  it('sorts Chinese names by pinyin with symbols last', () => {
    const names = ['张三', '王五', '李四', 'Alice', '123']
    expect(names.sort(comparePinyin)).toEqual(['Alice', '李四', '王五', '张三', '123'])
  })

  it('sorts the letter index with # last', () => {
    expect(['#', 'Z', 'A', 'L'].sort(compareLetters)).toEqual(['A', 'L', 'Z', '#'])
  })
})
