import { describe, expect, it } from 'vitest'
import { groupInfoNotices } from './info-notice'

const base = { name: '研发群', topic: '', announcement: '' }

describe('groupInfoNotices', () => {
  it('reports nothing when the group info did not change', () => {
    expect(groupInfoNotices(base, { ...base })).toEqual([])
  })

  it('reports a rename on its own', () => {
    expect(groupInfoNotices(base, { ...base, name: '测试群' })).toEqual(['群名称已改为「测试群」'])
  })

  it('reports topic and announcement separately', () => {
    expect(
      groupInfoNotices(base, { ...base, topic: '本周进度', announcement: '周五发版' })
    ).toEqual(['群主题已改为「本周进度」', '群公告已改为「周五发版」'])
  })

  it('uses a clear wording when topic or announcement is emptied', () => {
    const full = { name: '研发群', topic: '旧主题', announcement: '旧公告' }
    expect(groupInfoNotices(full, { ...full, topic: '', announcement: '' })).toEqual([
      '群主题已清空',
      '群公告已清空'
    ])
  })
})
