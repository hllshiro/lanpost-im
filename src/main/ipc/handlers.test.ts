import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from '../settings/store'
import { createHandlers } from './handlers'

function context(): ReturnType<typeof createHandlers> {
  const file = join(mkdtempSync(join(tmpdir(), 'lanpost-ipc-')), 'settings.json')
  return createHandlers({
    settings: new SettingsStore(file),
    appInfo: { name: '内网传书', version: '0.1.0', platform: 'win32', appId: 'com.lanpost.im' }
  })
}

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
})
