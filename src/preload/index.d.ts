import type { Api } from '../shared/ipc'
import type { AppEvent } from '../shared/domain'
import type { Settings, SettingsPatch } from '../shared/settings'

declare global {
  interface Window {
    api: Api & {
      settings: {
        get(): Promise<Settings>
        update(patch: SettingsPatch): Promise<Settings>
      }
    }
  }
}

export type { AppEvent }
