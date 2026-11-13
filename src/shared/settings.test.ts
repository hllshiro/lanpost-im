import { describe, expect, it } from 'vitest'
import { DEFAULT_SHORTCUTS, defaultSettings, settingsSchema } from './settings'

describe('file settings', () => {
  it('accepts incoming files by default', () => {
    expect(defaultSettings.files.autoAccept).toBe(true)
    // 旧配置没有这个字段时按新默认补齐，显式关闭的仍然尊重
    expect(settingsSchema.parse({ files: {} }).files.autoAccept).toBe(true)
    expect(settingsSchema.parse({ files: { autoAccept: false } }).files.autoAccept).toBe(false)
  })
})

describe('shortcut settings', () => {
  it('enables global shortcuts by default', () => {
    expect(defaultSettings.shortcuts.enabled).toBe(true)
    expect(defaultSettings.shortcuts.toggleWindow).toBe(DEFAULT_SHORTCUTS.toggleWindow)
    expect(defaultSettings.shortcuts.openReceiveDir).toBe(DEFAULT_SHORTCUTS.openReceiveDir)
  })

  it('keeps other bindings when one is cleared', () => {
    const parsed = settingsSchema.parse({ shortcuts: { toggleWindow: '' } })
    expect(parsed.shortcuts.enabled).toBe(true)
    expect(parsed.shortcuts.toggleWindow).toBe('')
    expect(parsed.shortcuts.openReceiveDir).toBe(DEFAULT_SHORTCUTS.openReceiveDir)
  })

  it('keeps the bindings when shortcuts are disabled', () => {
    const parsed = settingsSchema.parse({ shortcuts: { enabled: false } })
    expect(parsed.shortcuts.enabled).toBe(false)
    expect(parsed.shortcuts.toggleWindow).toBe(DEFAULT_SHORTCUTS.toggleWindow)
  })
})
