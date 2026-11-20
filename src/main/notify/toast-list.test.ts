import { describe, expect, it } from 'vitest'
import { ToastList } from './toast-list'

describe('ToastList', () => {
  it('同会话重复通知只刷新内容并重置到期时间', () => {
    let now = 0
    const list = new ToastList(() => now)
    list.upsert('c1', '张三', '第一条', 10_000)
    now = 5_000
    list.upsert('c1', '张三', '第二条', 15_000)
    expect(list.snapshot()).toEqual([{ conversationId: 'c1', title: '张三', body: '第二条' }])
    expect(list.nextExpiry()).toBe(15_000)
    now = 10_000
    expect(list.expireDue()).toEqual([])
    now = 15_000
    expect(list.expireDue()).toHaveLength(1)
    expect(list.snapshot()).toEqual([])
  })

  it('挂起项到期时间为 null，releaseAll 后按新时限计时', () => {
    let now = 0
    const list = new ToastList(() => now)
    list.upsert('c1', '张三', '锁屏时来的', null)
    expect(list.nextExpiry()).toBeNull()
    expect(list.expireDue()).toEqual([])
    now = 60_000
    list.releaseAll(10_000)
    expect(list.nextExpiry()).toBe(70_000)
    now = 70_000
    expect(list.expireDue()).toHaveLength(1)
  })

  it('clearAll 清空全部弹窗', () => {
    const list = new ToastList(() => 0)
    list.upsert('c1', 'a', 'b', 10_000)
    list.upsert('c2', 'c', 'd', null)
    list.clearAll()
    expect(list.snapshot()).toEqual([])
    expect(list.nextExpiry()).toBeNull()
  })

  it('不同会话各占一条，按插入序返回', () => {
    const list = new ToastList(() => 0)
    list.upsert('c1', '张三', '第一条', 10_000)
    list.upsert('c2', '李四', '第二条', 20_000)
    expect(list.snapshot().map((item) => item.conversationId)).toEqual(['c1', 'c2'])
    expect(list.nextExpiry()).toBe(10_000)
  })
})
