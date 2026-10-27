import type { AppInfo, FirewallStatus } from '../../shared/ipc'
import type { Settings, SettingsPatch } from '../../shared/settings'
import { checkFirewall, repairFirewall } from '../firewall'
import type { SettingsStore } from '../settings/store'
import type { AutostartResult } from '../autostart'

export interface Handlers {
  appInfo(): AppInfo
  settingsGet(): Settings
  settingsUpdate(patch: unknown): Settings
  settingsDefaults(): Settings
  settingsStartAtLogin(enabled: unknown): Settings
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
  applyStartAtLogin?: (enabled: boolean) => AutostartResult
}): Handlers {
  return {
    appInfo: () => ({ ...ctx.appInfo }),
    settingsGet: () => ctx.settings.get(),
    settingsUpdate: (patch) => {
      assertPatch(patch)
      const next = ctx.settings.update(patch)
      ctx.onSettingsChanged?.(next)
      return next
    },
    settingsDefaults: () => ctx.settings.defaultSettings(),
    settingsStartAtLogin: (enabled) => {
      if (typeof enabled !== 'boolean') throw new Error('开机启动参数错误')
      if (!ctx.applyStartAtLogin) throw new Error('当前环境不支持修改开机启动')
      const result = ctx.applyStartAtLogin(enabled)
      if (!result.ok) throw new Error(result.error ?? '无法修改开机启动')
      const next = ctx.settings.update({ general: { startAtLogin: enabled } })
      ctx.onSettingsChanged?.(next)
      return next
    },
    firewallCheck: () => checkFirewall(ctx.settings.get().network.port),
    firewallRepair: () => repairFirewall(ctx.settings.get().network.port)
  }
}
