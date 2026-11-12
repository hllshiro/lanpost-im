export interface GroupInfoFields {
  name: string
  topic: string
  announcement: string
}

function quoted(value: string): string {
  return value === '' ? '（空）' : `「${value}」`
}

// 群资料的变更只带新值，协议里没有操作者字段，所以提示一律写成中性措辞
export function groupInfoNotices(previous: GroupInfoFields, next: GroupInfoFields): string[] {
  const notices: string[] = []
  if (previous.name !== next.name) {
    notices.push(`群名称已改为${quoted(next.name)}`)
  }
  if (previous.topic !== next.topic) {
    notices.push(next.topic === '' ? '群主题已清空' : `群主题已改为${quoted(next.topic)}`)
  }
  if (previous.announcement !== next.announcement) {
    notices.push(
      next.announcement === '' ? '群公告已清空' : `群公告已改为${quoted(next.announcement)}`
    )
  }
  return notices
}
