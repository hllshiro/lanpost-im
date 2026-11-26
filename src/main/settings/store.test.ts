import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SettingsStore } from './store'
import { defaultSettings, settingsSchema } from '../../shared/settings'

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

  it('uses the provided general defaults for a new file', () => {
    const store = new SettingsStore(tempFile(), {}, { general: { debugLog: true } })
    expect(store.get().general.debugLog).toBe(true)
  })

  it('applies the provided defaults to keys missing from an existing file', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ version: 1 }))
    const store = new SettingsStore(file, {}, { general: { debugLog: true } })
    expect(store.get().general.debugLog).toBe(true)
  })

  it('keeps an explicit debug log choice over the dynamic default', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ version: 1, general: { debugLog: false } }))
    const store = new SettingsStore(file, {}, { general: { debugLog: true } })
    expect(store.get().general.debugLog).toBe(false)
  })

  it('uses the provided identity defaults for a new file', () => {
    const store = new SettingsStore(tempFile(), { account: 'pc-a', hostName: 'pc-a' })
    expect(store.get().identity.account).toBe('pc-a')
    expect(store.get().identity.hostName).toBe('pc-a')
    expect(store.defaultSettings().identity.account).toBe('pc-a')
  })

  it('defaults the private discovery port and ignores removed IPMSG fields', () => {
    expect(defaultSettings.network.privatePort).toBe(9011)
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ network: { port: 12425, ipmsg: false } }))
    const settings = new SettingsStore(file).get()
    expect(settings.network.privatePort).toBe(9011)
    expect('ipmsg' in settings.network).toBe(false)
  })

  it('merges a nested patch and persists it', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ files: { autoAccept: true, receiveLayout: 'nickname' } })
    expect(store.get().files.autoAccept).toBe(true)
    expect(new SettingsStore(file).get().files.receiveLayout).toBe('nickname')
  })

  it('keeps untouched groups when applying a patch', () => {
    const file = tempFile()
    const store = new SettingsStore(file)
    store.update({ identity: { displayName: '值班机' }, notify: { soundPreset: 'receive' } })
    store.update({ files: { autoAccept: true } })
    const loaded = new SettingsStore(file).get()
    expect(loaded.identity.displayName).toBe('值班机')
    expect(loaded.notify.soundPreset).toBe('receive')
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

  it('提示音默认经典叮咚，旧配置里的 soundFile 被忽略', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ notify: { soundFile: 'builtin' } }))
    const loaded = new SettingsStore(file).get()
    expect(loaded.notify.soundPreset).toBe('online')
    expect('soundFile' in loaded.notify).toBe(false)
  })

  it('历史的 a/b/c 与已删除音效 id 映射到默认音效', () => {
    const file = tempFile()
    for (const legacy of ['a', 'b', 'c', 'blip-muted', 'guitar-strum']) {
      writeFileSync(file, JSON.stringify({ notify: { soundPreset: legacy } }))
      expect(new SettingsStore(file).get().notify.soundPreset).toBe('online')
    }
  })

  it('弹窗通知默认开启，旧的通知开关与免打扰字段被忽略', () => {
    const file = tempFile()
    writeFileSync(
      file,
      JSON.stringify({
        notify: {
          systemNotification: false,
          inAppToast: true,
          flashTaskbar: false,
          soundVolume: 30,
          dnd: true,
          dndStart: '01:00',
          dndEnd: '02:00'
        }
      })
    )
    const loaded = new SettingsStore(file).get()
    expect(loaded.notify.popup).toBe(true)
    expect('systemNotification' in loaded.notify).toBe(false)
    expect('inAppToast' in loaded.notify).toBe(false)
    expect('flashTaskbar' in loaded.notify).toBe(false)
    expect('soundVolume' in loaded.notify).toBe(false)
    expect('dnd' in loaded.notify).toBe(false)
  })

  it('旧的 system/app/none 取值映射为弹窗通知开关', () => {
    const file = tempFile()
    writeFileSync(file, JSON.stringify({ notify: { popup: 'none' } }))
    expect(new SettingsStore(file).get().notify.popup).toBe(false)
    writeFileSync(file, JSON.stringify({ notify: { popup: 'system' } }))
    expect(new SettingsStore(file).get().notify.popup).toBe(true)
    writeFileSync(file, JSON.stringify({ notify: { popup: 'app' } }))
    expect(new SettingsStore(file).get().notify.popup).toBe(true)
  })
})

describe('rpc settings', () => {
  it('默认关闭、只监听回环地址、无令牌', () => {
    expect(defaultSettings.network.rpc).toEqual({
      enabled: false,
      bindAddr: '127.0.0.1',
      port: 8443,
      token: ''
    })
  })

  it('拒绝越界端口', () => {
    expect(settingsSchema.safeParse({ network: { rpc: { port: 70000 } } }).success).toBe(false)
  })

  it('bindAddr 只要求非空，不做 IP 校验', () => {
    const result = settingsSchema.safeParse({ network: { rpc: { bindAddr: 'not-an-ip' } } })
    expect(result.success && result.data.network.rpc.bindAddr).toBe('not-an-ip')
  })

  it('更新 rpc 时保留 network 的其它字段', () => {
    const store = new SettingsStore(tempFile())
    const updated = store.update({
      network: {
        rpc: { enabled: true, bindAddr: '127.0.0.1', port: 9443, token: 'token-value' }
      }
    })
    expect(updated.network.rpc.port).toBe(9443)
    expect(updated.network.privatePort).toBe(defaultSettings.network.privatePort)
  })
})
