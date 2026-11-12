import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import { logStartup } from '../startup-log'
import type { Handlers } from './handlers'

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle(IPC.appInfo, () => {
    logStartup('ipc app:info')
    return handlers.appInfo()
  })
  ipcMain.handle(IPC.settingsGet, () => handlers.settingsGet())
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown) => handlers.settingsUpdate(patch))
  ipcMain.handle(IPC.settingsDefaults, () => handlers.settingsDefaults())
  ipcMain.handle(IPC.shortcutsRecording, (_event, active: boolean) =>
    handlers.shortcutsSetRecording(active)
  )
  ipcMain.handle(IPC.shortcutsAvailable, (_event, accelerator: string) =>
    handlers.shortcutsAvailable(accelerator)
  )
}
