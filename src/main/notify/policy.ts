import type { Settings } from '../../shared/settings'

export type NotificationKind = 'message' | 'file'

export interface NotificationInput {
  settings: Settings
  kind: NotificationKind
  isSelf: boolean
  muted: boolean
  // 窗口有焦点且未锁屏：由 NotificationManager 合并锁屏状态后传入
  windowFocused: boolean
  conversationId: string
}

export interface NotificationDecision {
  badge: boolean
  sound: boolean
  toast: boolean
}

export function decideNotification(input: NotificationInput): NotificationDecision {
  const silent: NotificationDecision = {
    badge: false,
    sound: false,
    toast: false
  }
  if (input.isSelf) {
    return silent
  }

  const decision: NotificationDecision = { ...silent, badge: true }
  // 前台有焦点就不打扰：声音与弹窗都不发，未读照常累计
  if (input.windowFocused) {
    return decision
  }
  if (input.muted || !input.settings.notify.enabled) {
    return decision
  }
  if (input.kind === 'file' && !input.settings.files.notifyOnComplete) {
    return decision
  }

  decision.sound = input.settings.notify.sound
  decision.toast = input.settings.notify.popup
  return decision
}

// 提示音冷却：15 秒内最多响一次
export const SOUND_COOLDOWN_MS = 15_000

export function soundCooldownReady(lastPlayedAt: number, now: number): boolean {
  // 0 表示本次运行还没响过
  return lastPlayedAt === 0 || now - lastPlayedAt >= SOUND_COOLDOWN_MS
}

// 托盘图标闪烁是未读状态而非单条消息的效果：
// 只要新消息提醒开着、未读 > 0 就闪（窗口在前台也闪），直到未读清零
export function shouldBlink(input: { unread: number; settings: Settings }): boolean {
  return input.unread > 0 && input.settings.notify.enabled
}
