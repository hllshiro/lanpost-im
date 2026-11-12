import type { AppInfo, FirewallStatus } from '../../shared/ipc'
import type { Settings, SettingsPatch } from '../../shared/settings'
import type { SettingsStore } from '../settings/store'

export interface Handlers {
  appInfo(): AppInfo
  settingsGet(): Settings
  settingsUpdate(patch: unknown): Settings
  settingsDefaults(): Settings
  settingsStartAtLogin(enabled: boolean): Settings
  shortcutsSetRecording(active: boolean): void
  shortcutsAvailable(accelerator: string): boolean
  firewallCheck(): Promise<FirewallStatus>
  firewallRepair(): Promise<FirewallStatus>
}

function assertPatch(value: unknown): asserts value is SettingsPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('设置补丁格式错误')
  }
}

export function createHandlers(ctx: {
  settings: SettingsStore
  appInfo: AppInfo
  onSettingsChanged?: (settings: Settings) => void
  setStartAtLogin?: (enabled: boolean) => { ok: boolean; error?: string }
  shortcutsSetRecording?: (active: boolean) => void
  shortcutsAvailable?: (accelerator: string) => boolean
  firewallCheck?: () => Promise<FirewallStatus>
  firewallRepair?: () => Promise<FirewallStatus>
}): Handlers {
  return {
    appInfo: () => ({ ...ctx.appInfo }),
    settingsGet: () => ctx.settings.get(),
    settingsUpdate: (patch) => {
      assertPatch(patch)
      const previous = ctx.settings.get()
      const next = ctx.settings.update(patch)
      if (next.general.startAtLogin !== previous.general.startAtLogin) {
        const result = ctx.setStartAtLogin?.(next.general.startAtLogin)
        if (result !== undefined && !result.ok) {
          ctx.settings.update({ general: { startAtLogin: previous.general.startAtLogin } })
          throw new Error(result.error ?? '开机启动设置失败')
        }
      }
      const current = ctx.settings.get()
      ctx.onSettingsChanged?.(current)
      return current
    },
    settingsDefaults: () => ctx.settings.defaultSettings(),
    settingsStartAtLogin: (enabled) => {
      if (typeof enabled !== 'boolean') {
        throw new Error('开机启动参数格式错误')
      }
      const result = ctx.setStartAtLogin?.(enabled)
      if (result !== undefined && !result.ok) {
        throw new Error(result.error ?? '开机启动设置失败')
      }
      const next = ctx.settings.update({ general: { startAtLogin: enabled } })
      ctx.onSettingsChanged?.(next)
      return next
    },
    shortcutsSetRecording: (active) => ctx.shortcutsSetRecording?.(active),
    shortcutsAvailable: (accelerator) =>
      typeof accelerator === 'string' && ctx.shortcutsAvailable !== undefined
        ? ctx.shortcutsAvailable(accelerator)
        : false,
    firewallCheck: () =>
      ctx.firewallCheck?.() ??
      Promise.resolve({ state: 'unsupported', executable: '', detail: '防火墙检查不可用' }),
    firewallRepair: () =>
      ctx.firewallRepair?.() ??
      Promise.resolve({ state: 'unsupported', executable: '', detail: '防火墙修复不可用' })
  }
}
