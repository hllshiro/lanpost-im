import type { EmotionItem } from './emotion'

const USAGE_KEY = 'lanpost-emotion-usage'

// 每个表情的发送次数存在渲染进程的本地存储里，重启后仍按常用排序
export function loadEmotionUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const usage: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value)) usage[key] = value
    }
    return usage
  } catch {
    return {}
  }
}

export function saveEmotionUsage(usage: Record<string, number>): void {
  localStorage.setItem(USAGE_KEY, JSON.stringify(usage))
}

export function emotionUsageKey(item: EmotionItem): string {
  return item.kind === 'emotion' ? `e:${item.image}` : `${item.group}/${item.image}`
}

// 使用次数多的排在前面，次数相同保持原有顺序
export function sortByUsage(items: EmotionItem[], usage: Record<string, number>): EmotionItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const count =
        (usage[emotionUsageKey(right.item)] ?? 0) - (usage[emotionUsageKey(left.item)] ?? 0)
      return count !== 0 ? count : left.index - right.index
    })
    .map((entry) => entry.item)
}
