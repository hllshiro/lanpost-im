export interface GroupMemberFields {
  userId: string
  name: string
}

// 成员没带名字时用用户号前 8 位，避免提示里出现空括号
export function memberLabel(member: GroupMemberFields): string {
  return member.name || member.userId.slice(0, 8)
}

export function memberJoinNotice(member: GroupMemberFields): string {
  return `【${memberLabel(member)}】加入了该群。`
}

export function memberExitNotice(member: GroupMemberFields): string {
  return `【${memberLabel(member)}】退出了该群。`
}

export function memberKickNotice(member: GroupMemberFields): string {
  return `【${memberLabel(member)}】被移出了该群。`
}

// 成员表是整份推送，按差集判断谁加入、谁被移出
export function memberChangeNotices(
  previous: GroupMemberFields[],
  next: GroupMemberFields[]
): string[] {
  const previousIds = new Set(previous.map((member) => member.userId))
  const nextIds = new Set(next.map((member) => member.userId))
  const notices: string[] = []
  for (const member of next) {
    if (!previousIds.has(member.userId)) notices.push(memberJoinNotice(member))
  }
  for (const member of previous) {
    if (!nextIds.has(member.userId)) notices.push(memberKickNotice(member))
  }
  return notices
}
