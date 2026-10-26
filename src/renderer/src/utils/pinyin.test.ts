import { describe, expect, it } from 'vitest'
import { compareLetters, comparePinyin, pinyinInfo } from './pinyin'

describe('pinyin helpers', () => {
  it('builds full pinyin, initials and the first letter', () => {
    expect(pinyinInfo('张三')).toEqual({ full: 'zhangsan', initials: 'zs', letter: 'Z' })
    expect(pinyinInfo('Alice')).toEqual({ full: 'alice', initials: 'alice', letter: 'A' })
    expect(pinyinInfo('123')).toEqual({ full: '123', initials: '123', letter: '#' })
  })

  it('sorts Chinese names by pinyin with symbols last', () => {
    const names = ['张三', '王五', '李四', 'Alice', '123']
    expect(names.sort(comparePinyin)).toEqual(['Alice', '李四', '王五', '张三', '123'])
  })

  it('sorts the letter index with # last', () => {
    expect(['#', 'Z', 'A', 'L'].sort(compareLetters)).toEqual(['A', 'L', 'Z', '#'])
  })
})
