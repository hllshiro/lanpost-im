import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, APP_NAME_EN } from '../shared/app'
import { IPC } from '../shared/ipc'
import { openDatabase } from './store/db'
import { SettingsStore } from './settings/store'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { createMainWindow, getMainWindow, setQuitting, showMainWindow } from './window'
import { createTray, destroyTray } from './tray'

app.setName(APP_NAME_EN)

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  let database: ReturnType<typeof openDatabase> | null = null

  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    try {
      const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
      database = openDatabase(join(app.getPath('userData'), 'lanpost.db'))

      const handlers = createHandlers({
        settings,
        appInfo: {
          name: APP_NAME,
          version: app.getVersion(),
          platform: process.platform,
          appId: APP_ID
        }
      })
      registerIpc(handlers)

      createMainWindow(settings)
      createTray({
        onShow: showMainWindow,
        onSettings: () => {
          showMainWindow()
          getMainWindow()?.webContents.send(IPC.uiOpenSettings)
        },
        onQuit: () => {
          setQuitting(true)
          app.quit()
        }
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow(settings)
        } else {
          showMainWindow()
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      dialog.showErrorBox('内网传书', `无法打开数据文件：\n${message}`)
      app.quit()
    }
  })

  app.on('before-quit', () => {
    setQuitting(true)
  })

  app.on('will-quit', () => {
    database?.close()
    database = null
    destroyTray()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，窗口全部关闭时不退出进程。
  })
}
