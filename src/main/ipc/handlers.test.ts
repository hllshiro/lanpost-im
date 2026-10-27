import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from '../settings/store'
import { createHandlers } from './handlers'
import type { AutostartResult } from '../autostart'

const tempDirs: string[] = []

function context(
  applyStartAtLogin?: (enabled: boolean) => AutostartResult
): ReturnType<typeof createHandlers> {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-ipc-'))
  tempDirs.push(dir)
  const file = join(dir, 'settings.json')
  return createHandlers({
    settings: new SettingsStore(file),
    appInfo: { name: '内网传书', version: '0.1.0', platform: 'win32', appId: 'com.lanpost.im' },
    applyStartAtLogin
  })
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('ipc handlers', () => {
  it('returns app info', () => {
    expect(context().appInfo().appId).toBe('com.lanpost.im')
  })

  it('rejects an invalid settings patch', () => {
    expect(() => context().settingsUpdate({ files: { autoAcceptMaxMB: -1 } })).toThrow()
  })

  it('applies a valid patch', () => {
    const handlers = context()
    const next = handlers.settingsUpdate({ files: { autoAccept: true } })
    expect(next.files.autoAccept).toBe(true)
  })

  it('applies and persists the start-at-login toggle', () => {
    const enabled: boolean[] = []
    const handlers = context((value) => {
      enabled.push(value)
      return { ok: true }
    })

    const next = handlers.settingsStartAtLogin(true)
    expect(enabled).toEqual([true])
    expect(next.general.startAtLogin).toBe(true)
  })

  it('rejects start-at-login when the system rejects it', () => {
    const handlers = context(() => ({ ok: false, error: '被系统策略阻止' }))

    expect(() => handlers.settingsStartAtLogin(true)).toThrow('被系统策略阻止')
    expect(handlers.settingsGet().general.startAtLogin).toBe(false)
  })

  it('returns defaults without exposing the internal settings object', () => {
    const handlers = context()
    const defaults = handlers.settingsDefaults()
    expect(defaults.version).toBe(1)
    defaults.identity.displayName = '改过的默认值'
    expect(handlers.settingsDefaults().identity.displayName).not.toBe('改过的默认值')
  })
})
