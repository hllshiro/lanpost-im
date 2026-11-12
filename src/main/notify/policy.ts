import type { Settings } from '../../shared/settings'

export type NotificationKind = 'message' | 'file'

export interface NotificationInput {
  settings: Settings
  kind: NotificationKind
  isSelf: boolean
  muted: boolean
  windowFocused: boolean
  activeConversationId: string | null
  conversationId: string
  now?: Date
}

export interface NotificationDecision {
  badge: boolean
  sound: boolean
  flash: boolean
  system: boolean
  toast: boolean
}

function parseClock(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) {
    return null
  }
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) {
    return null
  }
  return hours * 60 + minutes
}

export function inDndWindow(settings: Settings, now: Date = new Date()): boolean {
  if (!settings.notify.dnd) {
    return false
  }
  const start = parseClock(settings.notify.dndStart)
  const end = parseClock(settings.notify.dndEnd)
  if (start === null || end === null || start === end) {
    return false
  }
  const current = now.getHours() * 60 + now.getMinutes()
  if (start < end) {
    return current >= start && current < end
  }
  return current >= start || current < end
}

export function decideNotification(input: NotificationInput): NotificationDecision {
  const silent: NotificationDecision = {
    badge: false,
    sound: false,
    flash: false,
    system: false,
    toast: false
  }
  if (input.isSelf) {
    return silent
  }

  const decision: NotificationDecision = { ...silent, badge: true }
  if (input.windowFocused && input.activeConversationId === input.conversationId) {
    return decision
  }
  if (input.muted || !input.settings.notify.enabled || inDndWindow(input.settings, input.now)) {
    return decision
  }
  if (input.kind === 'file' && !input.settings.files.notifyOnComplete) {
    return decision
  }

  decision.sound = input.settings.notify.sound
  decision.flash = input.settings.notify.flashTaskbar
  decision.system = input.settings.notify.systemNotification
  decision.toast = input.settings.notify.inAppToast
  return decision
}
