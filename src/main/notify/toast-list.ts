import type { NotifyToastItem } from '../../shared/ipc'

interface Entry {
  title: string
  body: string
  // null 表示锁屏挂起：解锁前不计时
  expiresAt: number | null
}

// 聚焦是否该清空通知弹窗：锁屏期间与解锁后宽限期内不清
// （锁屏时聚焦事件可能先于 powerMonitor 的解锁事件到达，会把挂起的弹窗误清）
export function shouldClearToastsOnFocus(input: {
  hasToasts: boolean
  locked: boolean
  now: number
  ignoreFocusUntil: number
}): boolean {
  return input.hasToasts && !input.locked && input.now >= input.ignoreFocusUntil
}

// 通知弹窗列表的纯逻辑：同会话覆盖、到期移除、锁屏挂起与释放。
// 时间由注入的 now 提供，便于测试
export class ToastList {
  private readonly entries = new Map<string, Entry>()

  constructor(private readonly now: () => number = Date.now) {}

  upsert(conversationId: string, title: string, body: string, expiresAt: number | null): void {
    // Map 对已有键 set 会保留原位置，同一会话刷新不改变堆叠顺序
    this.entries.set(conversationId, { title, body, expiresAt })
  }

  // 解锁后把挂起的弹窗按完整时限重新计时
  releaseAll(ttlMs: number): void {
    for (const entry of this.entries.values()) {
      if (entry.expiresAt === null) {
        entry.expiresAt = this.now() + ttlMs
      }
    }
  }

  clearAll(): void {
    this.entries.clear()
  }

  expireDue(): NotifyToastItem[] {
    const current = this.now()
    const expired: NotifyToastItem[] = []
    for (const [conversationId, entry] of this.entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= current) {
        expired.push({ conversationId, title: entry.title, body: entry.body })
        this.entries.delete(conversationId)
      }
    }
    return expired
  }

  nextExpiry(): number | null {
    let earliest: number | null = null
    for (const entry of this.entries.values()) {
      if (entry.expiresAt !== null && (earliest === null || entry.expiresAt < earliest)) {
        earliest = entry.expiresAt
      }
    }
    return earliest
  }

  snapshot(): NotifyToastItem[] {
    return [...this.entries].map(([conversationId, entry]) => ({
      conversationId,
      title: entry.title,
      body: entry.body
    }))
  }
}
