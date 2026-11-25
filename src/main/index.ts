import { app, BrowserWindow, dialog, net, powerMonitor, protocol } from 'electron'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { APP_ID, APP_NAME } from '../shared/app'
import { IPC } from '../shared/ipc'
import { AppService } from './app-service'
import { applyStartAtLogin, type AutostartContext } from './autostart'
import { checkFirewall, repairFirewall } from './firewall'
import { openDatabase } from './store/db'
import { SettingsStore } from './settings/store'
import { currentIdentityDefaults } from './identity'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { registerAppIpc } from './ipc/app-ipc'
import {
  createMainWindow,
  getMainWindow,
  setQuitting,
  showMainWindow,
  toggleMainWindow
} from './window'
import { createTray, destroyTray } from './tray'
import { destroyToastWindow } from './notify/toast-window'
import {
  configureTrayPopup,
  showTrayPopup,
  onTrayLeave,
  destroyTrayPopup
} from './notify/tray-popup'
import {
  applyGlobalShortcuts,
  setShortcutRecording,
  shortcutAvailable,
  unregisterGlobalShortcuts,
  type ShortcutHandlers
} from './shortcuts'
import { errorMessage, friendlyMessage, logStartup, startupLogFile } from './startup-log'
import { configureDebugLog, debugLog, errorLog } from './debug-log'
import { logsDirectory } from './logs'

app.setName(APP_NAME)

// 渲染进程通过它读取已接收的图片和待发区里的图片；
// 地址形如 lanpost-file:///pf5723、lanpost-staged:///stg3
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lanpost-file',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'lanpost-staged',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'lanpost-emotion',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'lanpost-avatar',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// 渲染进程写的是 lanpost-file:///pf123，Chromium 会规范成 lanpost-file://pf123/，
// 主机名和路径都要取
function localId(url: string): string {
  const parsed = new URL(url)
  return decodeURIComponent(`${parsed.hostname}${parsed.pathname}`.replace(/^\/+|\/+$/g, ''))
}

// 远程桌面、虚拟机与部分安全策略下 GPU 进程会启动失败并导致 Chromium 退出。
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu-sandbox')

// 自动化联调时用 LANPOST_DEBUG_PORT 打开 DevTools 协议，平时不启用
const debugPort = process.env['LANPOST_DEBUG_PORT']
if (debugPort) {
  app.commandLine.appendSwitch('remote-debugging-port', debugPort)
}

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
// 先挂上日志目录，即使调试日志关闭，启动阶段的错误也会写入 logs/error.log
configureDebugLog({ enabled: false, dir: logsDirectory() })

process.on('uncaughtException', (error) => {
  logStartup('uncaughtException: ' + errorMessage(error))
  errorLog('process', 'uncaughtException', error)
})

process.on('unhandledRejection', (error) => {
  logStartup('unhandledRejection: ' + errorMessage(error))
  errorLog('process', 'unhandledRejection', error)
})

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  logStartup('another instance is running, quit')
  app.quit()
} else {
  let database: ReturnType<typeof openDatabase> | null = null
  let service: AppService | null = null
  let idleTimer: ReturnType<typeof setInterval> | null = null

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
      // 开发环境默认打开调试日志，发行版默认关闭；用户手动设置过的值优先
      const settings = new SettingsStore(settingsFile, currentIdentityDefaults(), {
        general: { debugLog: is.dev }
      })
      configureDebugLog({ enabled: settings.get().general.debugLog, dir: logsDirectory() })
      debugLog('app', '启动', {
        version: app.getVersion(),
        packaged: app.isPackaged,
        dev: is.dev,
        userData: app.getPath('userData'),
        logs: logsDirectory(),
        debugLog: settings.get().general.debugLog
      })

      const autostartContext: AutostartContext = {
        platform: process.platform,
        execPath:
          process.platform === 'linux' && process.env['APPIMAGE']
            ? process.env['APPIMAGE']
            : process.execPath,
        appPath: app.getAppPath(),
        isPackaged: app.isPackaged,
        configDir: app.getPath('appData'),
        appName: APP_NAME,
        loginItem: {
          set: (options) => app.setLoginItemSettings(options)
        }
      }
      let startAtLoginState = settings.get().general.startAtLogin
      const applyLoginItem = (enabled: boolean): { ok: boolean; error?: string } => {
        const result = applyStartAtLogin(enabled, autostartContext)
        if (!result.ok) {
          logStartup('start at login apply failed: ' + (result.error ?? 'unknown'))
        } else {
          startAtLoginState = enabled
        }
        return result
      }
      // 启动时总是与系统同步一次：开启时补齐登录项，关闭时清理遗留项。
      applyLoginItem(startAtLoginState)

      const databaseFile = join(app.getPath('userData'), 'lanpost.db')
      logStartup(`opening database: ${databaseFile}`)
      database = openDatabase(databaseFile)

      const appInfo = {
        name: APP_NAME,
        version: app.getVersion(),
        platform: process.platform,
        appId: APP_ID,
        defaultReceiveDir: join(app.getPath('downloads'), APP_NAME)
      }
      const appService = new AppService(database, settings, appInfo)
      service = appService

      const shortcutHandlers: ShortcutHandlers = {
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
          configureDebugLog({
            enabled: next.general.debugLog,
            dir: logsDirectory()
          })
          debugLog('settings', '设置变更', next.general)
          appService.applySettings(next)
          applyGlobalShortcuts(next, shortcutHandlers)
          if (next.general.startAtLogin !== startAtLoginState) {
            applyLoginItem(next.general.startAtLogin)
          }
        },
        setStartAtLogin: applyLoginItem,
        shortcutsSetRecording: setShortcutRecording,
        shortcutsAvailable: shortcutAvailable,
        firewallCheck: () => checkFirewall(appService.firewallPorts()),
        firewallRepair: () => repairFirewall(appService.firewallPorts())
      })
      registerIpc(handlers)
      registerAppIpc(appService)
      logStartup('ipc registered')

      protocol.handle('lanpost-file', (request) => {
        const id = localId(request.url)
        const path = id === '' ? null : (service?.filePath(id) ?? null)
        if (path === null) {
          logStartup(`lanpost-file: 找不到文件任务 ${id}`)
          return new Response('not found', { status: 404 })
        }
        return net.fetch(pathToFileURL(path).toString())
      })

      // 待发区里的图片还没发出去，直接从暂存文件读
      protocol.handle('lanpost-staged', (request) => {
        const id = localId(request.url)
        const path = id === '' ? null : (service?.stagedImagePath(id) ?? null)
        if (path === null) {
          logStartup(`lanpost-staged: 找不到待发图片 ${id}`)
          return new Response('not found', { status: 404 })
        }
        return net.fetch(pathToFileURL(path).toString())
      })

      // 收藏的表情
      protocol.handle('lanpost-emotion', (request) => {
        const id = localId(request.url)
        const path = id === '' ? null : (service?.emotionPath(id) ?? null)
        if (path === null) {
          logStartup(`lanpost-emotion: 找不到收藏表情 ${id}`)
          return new Response('not found', { status: 404 })
        }
        return net.fetch(pathToFileURL(path).toString())
      })

      // 本机与对端头像：按 md5 取缓存文件
      protocol.handle('lanpost-avatar', (request) => {
        const md5 = localId(request.url)
        const path = md5 === '' ? null : (service?.avatarPath(md5) ?? null)
        if (path === null) {
          return new Response('not found', { status: 404 })
        }
        return net.fetch(pathToFileURL(path).toString())
      })

      const startHidden = settings.get().general.startMinimized
      createMainWindow(startHidden)
      appService.attachWindow(getMainWindow())
      configureTrayPopup(() => appService.unreadConversationCount())
      applyGlobalShortcuts(settings.get(), shortcutHandlers)
      logStartup(`main window created${startHidden ? ' (hidden)' : ''}`)

      createTray({
        onShow: showMainWindow,
        onSettings: () => {
          showMainWindow()
          getMainWindow()?.webContents.send(IPC.uiOpenSettings)
        },
        onQuit: () => {
          setQuitting(true)
          app.quit()
        },
        onHoverEnter: () => showTrayPopup(),
        onHoverLeave: () => onTrayLeave()
      })
      logStartup('tray created')

      // 锁屏期间视为失去焦点，消息照常通知
      powerMonitor.on('lock-screen', () => appService.setScreenLocked(true))
      powerMonitor.on('unlock-screen', () => appService.setScreenLocked(false))
      // 焦点变化重算托盘闪烁：前台有焦点不闪，失焦恢复
      getMainWindow()?.on('focus', () => appService.onWindowFocus())
      getMainWindow()?.on('blur', () => appService.onWindowBlur())

      try {
        await appService.start()
        logStartup('protocol started')
      } catch (error) {
        logStartup('protocol start failed: ' + errorMessage(error))
        dialog.showErrorBox(
          APP_NAME,
          `协议服务启动失败：\n${friendlyMessage(error)}\n\n请检查端口是否被占用，或者修改监听端口后重启。`
        )
      }

      void checkFirewall(appService.firewallPorts()).then((status) => {
        logStartup(`firewall: ${status.state} (${status.executable})`)
      })

      const checkIdle = (): void => {
        try {
          appService.evaluateIdleStatus(powerMonitor.getSystemIdleTime())
        } catch (error) {
          logStartup('idle status check failed: ' + errorMessage(error))
        }
      }
      checkIdle()
      idleTimer = setInterval(checkIdle, 30_000)
      idleTimer.unref()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow()
          appService.attachWindow(getMainWindow())
        } else {
          showMainWindow()
        }
      })
    } catch (error) {
      logStartup('startup failed: ' + errorMessage(error))
      dialog.showErrorBox(
        APP_NAME,
        `无法打开数据文件：\n${friendlyMessage(error)}\n\n日志：${startupLogFile()}`
      )
      app.quit()
    }
  })

  app.on('before-quit', () => {
    setQuitting(true)
  })

  let stopping = false
  app.on('will-quit', (event) => {
    if (stopping) return
    // 退出前要等私有会话把 DISCONNECT 发出去，否则对端只能等重传超时
    event.preventDefault()
    stopping = true
    if (idleTimer !== null) {
      clearInterval(idleTimer)
      idleTimer = null
    }
    unregisterGlobalShortcuts()
    debugLog('app', '准备退出')
    void (async () => {
      try {
        await service?.stop()
      } finally {
        database?.close()
        database = null
        destroyTray()
        destroyToastWindow()
        destroyTrayPopup()
        app.exit(0)
      }
    })()
  })

  app.on('window-all-closed', () => {
    // 托盘常驻，窗口全部关闭时不退出进程。
  })
}
