import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '../../../src/shared/settings'
import { decideNotification, inDndWindow } from '../../../src/main/notify/policy'

function settings(overrides: (value: Settings) => void = () => {}): Settings {
  const value = structuredClone(defaultSettings)
  overrides(value)
  return value
}

const base = {
  kind: 'message' as const,
  isSelf: false,
  muted: false,
  windowFocused: false,
  activeConversationId: null,
  conversationId: 'direct:peer'
}

describe('notification policy', () => {
  it('notifies when the window is not focused', () => {
    const decision = decideNotification({ ...base, settings: settings() })
    expect(decision).toEqual({
      badge: true,
      sound: true,
      flash: true,
      system: true,
      toast: true
    })
  })

  it('stays silent for the conversation being viewed', () => {
    const decision = decideNotification({
      ...base,
      settings: settings(),
      windowFocused: true,
      activeConversationId: 'direct:peer'
    })
    expect(decision.sound).toBe(false)
    expect(decision.system).toBe(false)
  })

  it('only badges when muted or disabled', () => {
    expect(decideNotification({ ...base, settings: settings(), muted: true }).sound).toBe(false)
    expect(
      decideNotification({
        ...base,
        settings: settings((value) => {
          value.notify.enabled = false
        })
      }).sound
    ).toBe(false)
  })

  it('respects the individual effect switches', () => {
    const decision = decideNotification({
      ...base,
      settings: settings((value) => {
        value.notify.sound = false
        value.notify.flashTaskbar = false
        value.notify.systemNotification = false
        value.notify.inAppToast = false
      })
    })
    expect(decision).toEqual({
      badge: true,
      sound: false,
      flash: false,
      system: false,
      toast: false
    })
  })

  it('does not notify for self messages', () => {
    expect(decideNotification({ ...base, settings: settings(), isSelf: true })).toEqual({
      badge: false,
      sound: false,
      flash: false,
      system: false,
      toast: false
    })
  })

  it('matches an overnight do-not-disturb window', () => {
    const value = settings((item) => {
      item.notify.dnd = true
      item.notify.dndStart = '22:00'
      item.notify.dndEnd = '08:00'
    })
    expect(inDndWindow(value, new Date('2026-10-23T23:30:00'))).toBe(true)
    expect(inDndWindow(value, new Date('2026-10-23T07:59:00'))).toBe(true)
    expect(inDndWindow(value, new Date('2026-10-23T08:00:00'))).toBe(false)
    expect(inDndWindow(value, new Date('2026-10-23T12:00:00'))).toBe(false)
  })

  it('skips file completion notifications when disabled', () => {
    const decision = decideNotification({
      ...base,
      kind: 'file',
      settings: settings((value) => {
        value.files.notifyOnComplete = false
      })
    })
    expect(decision.sound).toBe(false)
    expect(decision.toast).toBe(false)
  })
})
