import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface LoginItemOptions {
  openAtLogin: boolean
  path?: string
  args?: string[]
  openAsHidden?: boolean
  name?: string
}

export interface LoginItemApi {
  set(options: LoginItemOptions): void
}

export interface AutostartContext {
  platform: NodeJS.Platform
  execPath: string
  appPath: string
  isPackaged: boolean
  configDir: string
  appName: string
  loginItem?: LoginItemApi
}

export interface AutostartResult {
  ok: boolean
  error?: string
}

/** 开发模式下 Electron 需要额外传入应用目录才能启动项目。 */
export function loginItemArgs(ctx: AutostartContext): string[] {
  return ctx.isPackaged ? [] : [ctx.appPath]
}

const LOGIN_ITEM_NAME = 'lanpost-im'

function loginItemOptions(ctx: AutostartContext, openAtLogin: boolean): LoginItemOptions {
  if (ctx.platform === 'win32') {
    return {
      openAtLogin,
      path: ctx.execPath,
      args: loginItemArgs(ctx),
      name: LOGIN_ITEM_NAME
    }
  }
  return { openAtLogin, openAsHidden: true }
}

export function linuxDesktopPath(configDir: string): string {
  return join(configDir, 'autostart', 'lanpost-im.desktop')
}

function quoteExec(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')}"`
}

export function buildLinuxDesktopEntry(ctx: AutostartContext): string {
  const command = [ctx.execPath, ...loginItemArgs(ctx)].map(quoteExec).join(' ')
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${ctx.appName}`,
    'Comment=局域网即时通信',
    `Exec=${command}`,
    'Terminal=false',
    'StartupNotify=false',
    'X-GNOME-Autostart-enabled=true',
    ''
  ].join('\n')
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function applyStartAtLogin(enabled: boolean, ctx: AutostartContext): AutostartResult {
  if (ctx.platform === 'linux') {
    const file = linuxDesktopPath(ctx.configDir)
    try {
      if (enabled) {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, buildLinuxDesktopEntry(ctx), { encoding: 'utf8', mode: 0o644 })
      } else {
        rmSync(file, { force: true })
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
  }

  if (ctx.platform !== 'win32' && ctx.platform !== 'darwin') {
    return { ok: false, error: '当前系统不支持开机启动' }
  }
  if (!ctx.loginItem) {
    return { ok: false, error: '系统登录项接口不可用' }
  }
  try {
    ctx.loginItem.set(loginItemOptions(ctx, enabled))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
}
