import { describe, expect, it } from 'vitest'
import {
  memberChangeNotices,
  memberExitNotice,
  memberKickNotice,
  memberLabel
} from './member-notice'

const 私有联调 = { userId: '5a1c9e7d2b4f8061', name: '私有联调' }
const 上网机 = { userId: '68e24da0fa707949', name: '上网机PC3' }

describe('memberChangeNotices', () => {
  it('reports nothing when the member list is unchanged', () => {
    expect(memberChangeNotices([私有联调, 上网机], [私有联调, 上网机])).toEqual([])
  })

  it('reports a member who joined', () => {
    expect(memberChangeNotices([私有联调], [私有联调, 上网机])).toEqual([
      '【上网机PC3】加入了该群。'
    ])
  })

  it('reports a member who is no longer in the list', () => {
    expect(memberChangeNotices([私有联调, 上网机], [私有联调])).toEqual([
      '【上网机PC3】被移出了该群。'
    ])
  })

  it('reports joins before removals and keeps the pushed order', () => {
    const 新成员 = { userId: 'aaaabbbbccccdddd', name: '新成员' }
    expect(memberChangeNotices([私有联调, 上网机], [私有联调, 新成员])).toEqual([
      '【新成员】加入了该群。',
      '【上网机PC3】被移出了该群。'
    ])
  })

  it('uses the user id prefix when the name is empty', () => {
    const 无名 = { userId: 'aaaa1111bbbb2222', name: '' }
    expect(memberLabel(无名)).toBe('aaaa1111')
    expect(memberExitNotice(无名)).toBe('【aaaa1111】退出了该群。')
    expect(memberKickNotice(无名)).toBe('【aaaa1111】被移出了该群。')
  })
})
