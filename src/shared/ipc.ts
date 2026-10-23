export const IPC = {
  appInfo: 'app:info',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  uiOpenSettings: 'ui:open-settings'
} as const

export interface AppInfo {
  name: string
  version: string
  platform: string
  appId: string
}
