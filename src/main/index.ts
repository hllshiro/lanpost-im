import { app, BrowserWindow, dialog, net, protocol } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME, APP_NAME_EN } from '../shared/app'
import { IPC } from '../shared/ipc'
import { AppService } from './app-service'
import { checkFirewall } from './firewall'
import { openDatabase } from './store/db'
import { SettingsStore } from './settings/store'
import { currentIdentityDefaults, currentIdentityId } from './identity'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { registerAppIpc } from './ipc/app-ipc'
import { parseMediaRequest } from './files/media'
import {
  createMainWindow,
  getMainWindow,
  setQuitting,
  showMainWindow,
  toggleMainWindow
} from './window'
import { createTray, destroyTray } from './tray'
import { applyGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { errorMessage, friendlyMessage, logStartup, startupLogFile } from './startup-log'

app.setName(APP_NAME_EN)

protocol.registerSchemesAsPrivileged([
  { scheme: 'lanpost-media', privileges: { standard: true, secure: true } }
])

// 远程桌面、虚拟机与部分安全策略下 GPU 进程会启动失败并导致 Chromium 退出。
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu-sandbox')

function writableDir(dir: string): { ok: boolean; error?: string } {
  try {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.write-test-${process.pid}`)
    writeFileSync(probe, '')
    unlinkSync(probe)
    return { ok: true }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: code === undefined ? message : `${code}: ${message}` }
  }
}

const dataDirOverride = process.env['LANPOST_DATA_DIR']
if (dataDirOverride) {
  app.setPath('userData', resolve(dataDirOverride))
} else {
  const target = join(app.getPath('appData'), is.dev ? 'lanpost-im-dev' : 'lanpost-im')
  if (is.dev) {
    const writable = writableDir(target)
    app.setPath('userData', writable.ok ? target : resolve('.dev-data'))
    if (!writable.ok) {
      logStartup(
        `dev data directory ${target} is not writable (${writable.error ?? 'unknown'}); falling back to .dev-data`
      )
    }
  } else {
    app.setPath('userData', target)
  }
}

logStartup(`starting, userData=${app.getPath('userData')}, packaged=${app.isPackaged}`)

process.on('uncaughtException', (error) => {
  logStartup('uncaughtException: ' + errorMessage(error))
})

process.on('unhandledRejection', (error) => {
  logStartup('unhandledRejection: ' + errorMessage(error))
})

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  logStartup('another instance is running, quit')
  app.quit()
} else {
  let database: ReturnType<typeof openDatabase> | null = null
  let service: AppService | null = null

  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(async () => {
    logStartup('app ready')
    electronApp.setAppUserModelId(APP_ID)

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    try {
      const settingsFile = join(app.getPath('userData'), 'settings.json')
      logStartup(`loading settings: ${settingsFile}`)
      const settings = new SettingsStore(settingsFile, currentIdentityDefaults())
      const current = settings.get().identity
      if (current.identityId === '') {
        settings.update({ identity: { identityId: currentIdentityId(current.account) } })
      }

      const databaseFile = join(app.getPath('userData'), 'lanpost.db')
      logStartup(`opening database: ${databaseFile}`)
      database = openDatabase(databaseFile)

      const appInfo = {
        name: APP_NAME,
        version: app.getVersion(),
        platform: process.platform,
        appId: APP_ID
      }
      const appService = new AppService(database, settings, appInfo)
      service = appService

      protocol.handle('lanpost-media', async (request) => {
        const taskId = parseMediaRequest(request.url)
        const path = taskId === null ? null : appService.resolveMedia(taskId)
        if (path === null) return new Response('Not found', { status: 404 })
        return net.fetch(pathToFileURL(path).toString())
      })

      const shortcutHandlers = {
        toggleWindow: toggleMainWindow,
        openReceiveDir: () => {
          void appService.openReceiveDir().catch((error: unknown) => {
            logStartup(
              'open receive directory failed: ' +
                (error instanceof Error ? error.message : String(error))
            )
          })
        }
      }

      const handlers = createHandlers({
        settings,
        appInfo,
        onSettingsChanged: (next) => {
          appService.applySettings(next)
          applyGlobalShortcuts(next, shortcutHandlers)
        }
      })
      registerIpc(handlers)
      registerAppIpc(appService)
      logStartup('ipc registered')

      createMainWindow(settings)
      appService.attachWindow(getMainWindow())
      applyGlobalShortcuts(settings.get(), shortcutHandlers)
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

      try {
        await appService.start()
        logStartup('protocol started')
      } catch (error) {
        logStartup('protocol start failed: ' + errorMessage(error))
        dialog.showErrorBox(
          '内网传书',
          `协议服务启动失败：\n${friendlyMessage(error)}\n\n请检查端口是否被占用，或者修改监听端口后重启。`
        )
      }

      void checkFirewall(settings.get().network.port).then((status) => {
        logStartup(`firewall: ${status.state} (${status.executable})`)
      })

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow(settings)
          appService.attachWindow(getMainWindow())
        } else {
          showMainWindow()
        }
      })
    } catch (error) {
      logStartup('startup failed: ' + errorMessage(error))
      dialog.showErrorBox(
        '内网传书',
        `无法打开数据文件：\n${friendlyMessage(error)}\n\n日志：${startupLogFile()}`
      )
      app.quit()
    }
  })

  app.on('before-quit', () => {
    setQuitting(true)
  })

  app.on('will-quit', () => {
    unregisterGlobalShortcuts()
    void service?.stop()
    database?.close()
    database = null
    destroyTray()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，窗口全部关闭时不退出进程。
  })
}
