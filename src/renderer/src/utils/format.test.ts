import { describe, expect, it } from 'vitest'
import { formatRemaining } from './format'

describe('formatRemaining', () => {
  it('按秒显示一分钟内的时间', () => {
    expect(formatRemaining(8.4)).toBe('剩余 9 秒')
    expect(formatRemaining(59.1)).toBe('剩余 60 秒')
  })

  it('按分秒显示一小时内的时间', () => {
    expect(formatRemaining(90)).toBe('剩余 1 分 30 秒')
    expect(formatRemaining(120)).toBe('剩余 2 分')
  })

  it('按小时分钟显示更久的时间', () => {
    expect(formatRemaining(3600)).toBe('剩余 1 小时 0 分')
    expect(formatRemaining(5460)).toBe('剩余 1 小时 31 分')
  })

  it('速度未知或没有剩余量时返回空串', () => {
    expect(formatRemaining(0)).toBe('')
    expect(formatRemaining(-5)).toBe('')
    expect(formatRemaining(Number.NaN)).toBe('')
  })
})
