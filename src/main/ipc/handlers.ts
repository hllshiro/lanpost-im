import type { AppInfo } from '../../shared/ipc'
import type { Settings, SettingsPatch } from '../../shared/settings'
import type { SettingsStore } from '../settings/store'

export interface Handlers {
  appInfo(): AppInfo
  settingsGet(): Settings
  settingsUpdate(patch: unknown): Settings
  settingsDefaults(): Settings
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
    settingsDefaults: () => ctx.settings.defaultSettings()
  }
}
