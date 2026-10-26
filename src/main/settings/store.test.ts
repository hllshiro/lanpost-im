import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from './store'
import { defaultSettings } from '../../shared/settings'

const tempDirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-settings-'))
  tempDirs.push(dir)
  return join(dir, 'settings.json')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('SettingsStore', () => {
  it('returns defaults when the file does not exist', () => {
    const store = new SettingsStore(tempFile())
    expect(store.get()).toEqual(defaultSettings)
  })

  it('merges a nested patch and persists it', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ files: { autoAccept: true, autoAcceptMaxMB: 1024 } })
    expect(store.get().files.autoAccept).toBe(true)
    expect(new SettingsStore(file).get().files.autoAcceptMaxMB).toBe(1024)
  })

  it('keeps untouched groups when applying a patch', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ identity: { displayName: '值班机' }, notify: { soundVolume: 30 } })
    store.update({ files: { autoAccept: true } })
    const loaded = new SettingsStore(file).get()
    expect(loaded.identity.displayName).toBe('值班机')
    expect(loaded.notify.soundVolume).toBe(30)
  })

  it('backs up a settings file from a newer version', () => {
    const file = tempFile()
    writeFileSync(
      file,
      JSON.stringify({
        version: 99,
        identity: { displayName: '未来版本' },
        files: { autoAccept: true }
      })
    )
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings)
    expect(existsSync(file + '.bak')).toBe(true)
    expect(readFileSync(file + '.bak', 'utf8')).toContain('"version":99')
  })

  it('drops unknown keys instead of writing them', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ ...defaultSettings, unknown: 1 }))
    const loaded = new SettingsStore(file).get() as unknown as Record<string, unknown>
    expect(loaded.unknown).toBeUndefined()
  })

  it('backs up a corrupted file and falls back to defaults', () => {
    const file = tempFile()
    writeFileSync(file, '{ broken')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual(defaultSettings)
    expect(existsSync(file + '.bak')).toBe(true)
  })
})
