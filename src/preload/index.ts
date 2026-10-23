import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type AppInfo } from '../shared/ipc'
import type { Settings, SettingsPatch } from '../shared/settings'

const api = {
  app: {
    info: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo)
  },
  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: SettingsPatch): Promise<Settings> => ipcRenderer.invoke(IPC.settingsUpdate, patch)
  }
}

contextBridge.exposeInMainWorld('api', api)
