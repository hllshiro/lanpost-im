import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IPC, TOAST_LAYOUT, type NotifyToastItem } from '../../shared/ipc'
import { logStartup } from '../startup-log'

// Windows 专用：右下角独立置顶弹窗窗口。
// 窗口不可获得焦点，点击仍会送达渲染进程；不抢走主窗口的焦点
let toastWindow: BrowserWindow | null = null
// 窗口懒创建，创建完成前的最后一次内容靠它补发
let lastItems: NotifyToastItem[] = []

function ensureToastWindow(): BrowserWindow | null {
  if (process.platform !== 'win32') {
    return null
  }
  if (toastWindow !== null && !toastWindow.isDestroyed()) {
    return toastWindow
  }
  const window = new BrowserWindow({
    width: TOAST_LAYOUT.width,
    height: TOAST_LAYOUT.cardHeight + TOAST_LAYOUT.padding * 2,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  window.webContents.on('did-finish-load', () => {
    window.webContents.send(IPC.uiToastList, { toasts: lastItems })
  })
  window.on('closed', () => {
    toastWindow = null
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    void window.loadURL(`${devUrl}/?window=toast`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { search: '?window=toast' })
  }
  toastWindow = window
  logStartup('toast window created')
  return window
}

export function pushToastWindow(items: NotifyToastItem[]): void {
  lastItems = items
  const window = ensureToastWindow()
  if (window === null) {
    return
  }
  if (items.length === 0) {
    // 隐藏前把空列表发给渲染进程，DOM 不残留旧内容
    window.webContents.send(IPC.uiToastList, { toasts: [] })
    window.hide()
    return
  }
  const area = screen.getPrimaryDisplay().workArea
  const height =
    items.length * TOAST_LAYOUT.cardHeight +
    (items.length - 1) * TOAST_LAYOUT.gap +
    TOAST_LAYOUT.padding * 2
  const width = TOAST_LAYOUT.width
  const bounds = {
    x: area.x + area.width - width - TOAST_LAYOUT.padding,
    y: area.y + area.height - height - TOAST_LAYOUT.padding,
    width,
    height
  }
  window.setBounds(bounds)
  window.webContents.send(IPC.uiToastList, { toasts: items })
  if (!window.isVisible()) {
    window.showInactive()
  }
  logStartup(
    `toast bounds workArea=${JSON.stringify(area)} set=${JSON.stringify(bounds)} after=${JSON.stringify(
      window.getBounds()
    )} visible=${window.isVisible()}`
  )
}

export function destroyToastWindow(): void {
  if (toastWindow !== null && !toastWindow.isDestroyed()) {
    toastWindow.destroy()
  }
  toastWindow = null
  lastItems = []
}
