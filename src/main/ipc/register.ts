import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Handlers } from './handlers'

export function registerIpc(handlers: Handlers): void {
  ipcMain.handle(IPC.appInfo, () => handlers.appInfo())
  ipcMain.handle(IPC.settingsGet, () => handlers.settingsGet())
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown) => handlers.settingsUpdate(patch))
}
