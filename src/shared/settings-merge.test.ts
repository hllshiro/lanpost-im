import { describe, expect, it } from 'vitest'
import { defaultSettings } from './settings'
import { mergeSettings } from './settings-merge'

describe('mergeSettings', () => {
  it('applies several patches in sequence without dropping earlier fields', () => {
    const first = mergeSettings(defaultSettings, { notify: { enabled: false } })
    const second = mergeSettings(first, { notify: { sound: false } })
    expect(second.notify.enabled).toBe(false)
    expect(second.notify.sound).toBe(false)
    expect(second.notify.flashTaskbar).toBe(defaultSettings.notify.flashTaskbar)
  })

  it('merges nested sections and leaves other sections untouched', () => {
    const next = mergeSettings(defaultSettings, { files: { autoAccept: false } })
    expect(next.files.autoAccept).toBe(false)
    expect(next.files.autoAcceptMaxMB).toBe(defaultSettings.files.autoAcceptMaxMB)
    expect(next.network).toEqual(defaultSettings.network)
  })

  it('ignores undefined values and does not mutate the base object', () => {
    const patch = { notify: { enabled: false, sound: undefined } }
    const next = mergeSettings(defaultSettings, patch)
    expect(next.notify.sound).toBe(defaultSettings.notify.sound)
    expect(defaultSettings.notify.enabled).toBe(true)
  })
})
