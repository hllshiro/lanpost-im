import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyStartAtLogin,
  buildLinuxDesktopEntry,
  linuxDesktopPath,
  type AutostartContext,
  type LoginItemOptions
} from '../../src/main/autostart'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function configDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-autostart-'))
  dirs.push(dir)
  return dir
}

function context(overrides: Partial<AutostartContext> = {}): AutostartContext {
  return {
    platform: 'win32',
    execPath: 'C:\\Program Files\\lanpost-im\\lanpost-im.exe',
    appPath: 'C:\\repo\\lanpost-im',
    isPackaged: true,
    configDir: configDir(),
    appName: '内网传书',
    ...overrides
  }
}

describe('start at login', () => {
  it('registers the packaged executable on Windows', () => {
    const calls: LoginItemOptions[] = []
    const ctx = context({
      loginItem: {
        set: (options) => calls.push(options)
      }
    })

    expect(applyStartAtLogin(true, ctx)).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        openAtLogin: true,
        path: 'C:\\Program Files\\lanpost-im\\lanpost-im.exe',
        args: [],
        name: 'lanpost-im'
      }
    ])
  })

  it('passes the app directory in development builds', () => {
    const calls: LoginItemOptions[] = []
    const ctx = context({
      isPackaged: false,
      loginItem: {
        set: (options) => calls.push(options)
      }
    })

    applyStartAtLogin(true, ctx)
    expect(calls[0]?.args).toEqual(['C:\\repo\\lanpost-im'])
  })

  it('uses the macOS login item without Windows-only options', () => {
    const calls: LoginItemOptions[] = []
    const ctx = context({
      platform: 'darwin',
      loginItem: { set: (options) => calls.push(options) }
    })

    applyStartAtLogin(true, ctx)
    expect(calls).toEqual([{ openAtLogin: true, openAsHidden: true }])
  })

  it('reports registration failures', () => {
    const ctx = context({
      loginItem: {
        set: () => {
          throw new Error('被系统策略阻止')
        }
      }
    })

    expect(applyStartAtLogin(true, ctx)).toEqual({ ok: false, error: '被系统策略阻止' })
  })

  it('writes and removes a Linux autostart entry', () => {
    const ctx = context({ platform: 'linux', execPath: '/opt/lanpost-im/lanpost-im' })
    const file = linuxDesktopPath(ctx.configDir)

    expect(existsSync(file)).toBe(false)
    expect(applyStartAtLogin(true, ctx)).toEqual({ ok: true })
    expect(existsSync(file)).toBe(true)

    const entry = readFileSync(file, 'utf8')
    expect(entry).toContain('Type=Application')
    expect(entry).toContain('Name=内网传书')
    expect(entry).toContain('Exec="/opt/lanpost-im/lanpost-im"')
    expect(entry).toContain('X-GNOME-Autostart-enabled=true')

    expect(applyStartAtLogin(false, ctx)).toEqual({ ok: true })
    expect(existsSync(file)).toBe(false)
  })

  it('quotes Linux executable paths', () => {
    const entry = buildLinuxDesktopEntry(
      context({
        platform: 'linux',
        isPackaged: false,
        execPath: '/opt/lan post/$app/`x`',
        appPath: '/opt/src'
      })
    )
    expect(entry).toContain('Exec="/opt/lan post/\\$app/\\`x\\`" "/opt/src"')
  })

  it('always removes the login item when disabling', () => {
    const calls: LoginItemOptions[] = []
    const ctx = context({
      loginItem: {
        set: (options) => calls.push(options)
      }
    })

    expect(applyStartAtLogin(false, ctx)).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        openAtLogin: false,
        path: 'C:\\Program Files\\lanpost-im\\lanpost-im.exe',
        args: [],
        name: 'lanpost-im'
      }
    ])
  })

  it('rejects unsupported platforms', () => {
    const result = applyStartAtLogin(true, context({ platform: 'freebsd' }))
    expect(result.ok).toBe(false)
  })
})
