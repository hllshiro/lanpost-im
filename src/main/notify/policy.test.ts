import { describe, expect, it } from 'vitest'
import { defaultSettings, type Settings } from '../../shared/settings'
import { decideNotification, shouldBlink, soundCooldownReady } from './policy'

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
  conversationId: 'direct:peer'
}

describe('notification policy', () => {
  it('notifies when the window is not focused', () => {
    const decision = decideNotification({ ...base, settings: settings() })
    expect(decision).toEqual({
      badge: true,
      sound: true,
      toast: true
    })
  })

  it('弹窗通知关闭后不弹窗，声音不受影响', () => {
    const decision = decideNotification({
      ...base,
      settings: settings((value) => {
        value.notify.popup = false
      })
    })
    expect(decision.toast).toBe(false)
    expect(decision.sound).toBe(true)
  })

  it('窗口有焦点时任意会话都只保留未读角标', () => {
    const decision = decideNotification({
      ...base,
      settings: settings(),
      windowFocused: true
    })
    expect(decision).toEqual({
      badge: true,
      sound: false,
      toast: false
    })
  })

  it('only badges when muted or disabled', () => {
    expect(decideNotification({ ...base, settings: settings(), muted: true }).sound).toBe(false)
    expect(
      decideNotification({
        ...base,
        settings: settings((value) => {
          value.notify.enabled = false
        })
      })
    ).toEqual({ badge: true, sound: false, toast: false })
  })

  it('respects the individual effect switches', () => {
    const decision = decideNotification({
      ...base,
      settings: settings((value) => {
        value.notify.sound = false
        value.notify.popup = false
      })
    })
    expect(decision).toEqual({
      badge: true,
      sound: false,
      toast: false
    })
  })

  it('does not notify for self messages', () => {
    expect(decideNotification({ ...base, settings: settings(), isSelf: true })).toEqual({
      badge: false,
      sound: false,
      toast: false
    })
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

  it('未读大于 0 就闪烁，新消息提醒关闭时停止', () => {
    const value = settings()
    expect(shouldBlink({ unread: 3, settings: value })).toBe(true)
    expect(shouldBlink({ unread: 0, settings: value })).toBe(false)
    expect(
      shouldBlink({
        unread: 3,
        settings: settings((item) => {
          item.notify.enabled = false
        })
      })
    ).toBe(false)
  })

  it('提示音冷却：15 秒内最多响一次', () => {
    expect(soundCooldownReady(0, 1_000)).toBe(true)
    const last = 1_000_000
    expect(soundCooldownReady(last, last + 14_999)).toBe(false)
    expect(soundCooldownReady(last, last + 15_000)).toBe(true)
  })
})
