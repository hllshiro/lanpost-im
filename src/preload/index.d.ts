import type { AppInfo } from '../shared/ipc'
import type { Settings, SettingsPatch } from '../shared/settings'

declare global {
  interface Window {
    api: {
      app: {
        info(): Promise<AppInfo>
      }
      settings: {
        get(): Promise<Settings>
        update(patch: SettingsPatch): Promise<Settings>
      }
    }
  }
}

export {}
