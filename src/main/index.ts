import { app, BrowserWindow, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, APP_NAME_EN } from '../shared/app'
import { IPC } from '../shared/ipc'
import { openDatabase } from './store/db'
import { SettingsStore } from './settings/store'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { createMainWindow, getMainWindow, setQuitting, showMainWindow } from './window'
import { createTray, destroyTray } from './tray'
import { errorMessage, logStartup, startupLogFile } from './startup-log'

app.setName(APP_NAME_EN)

const dataDirOverride = process.env['LANPOST_DATA_DIR']
if (dataDirOverride) {
  app.setPath('userData', resolve(dataDirOverride))
} else if (is.dev) {
  app.setPath('userData', join(app.getPath('appData'), 'Lanpost-IM-dev'))
}

logStartup(`starting, userData=${app.getPath('userData')}, packaged=${app.isPackaged}`)

process.on('uncaughtException', (error) => {
  logStartup('uncaughtException: ' + errorMessage(error))
})

process.on('unhandledRejection', (error) => {
  logStartup('unhandledRejection: ' + errorMessage(error))
})

const gotLock = app.isPackaged ? app.requestSingleInstanceLock() : true

if (!gotLock) {
  logStartup('another instance is running, quit')
  app.quit()
} else {
  let database: ReturnType<typeof openDatabase> | null = null

  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    logStartup('app ready')
    electronApp.setAppUserModelId(APP_ID)

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    try {
      const settingsFile = join(app.getPath('userData'), 'settings.json')
      logStartup(`loading settings: ${settingsFile}`)
      const settings = new SettingsStore(settingsFile)

      const databaseFile = join(app.getPath('userData'), 'lanpost.db')
      logStartup(`opening database: ${databaseFile}`)
      database = openDatabase(databaseFile)

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
      logStartup('ipc registered')

      createMainWindow(settings)
      logStartup('main window created')

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
      logStartup('tray created')

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow(settings)
        } else {
          showMainWindow()
        }
      })
    } catch (error) {
      logStartup('startup failed: ' + errorMessage(error))
      dialog.showErrorBox('内网传书', `无法打开数据文件：\n${errorMessage(error)}\n\n日志：${startupLogFile()}`)
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
