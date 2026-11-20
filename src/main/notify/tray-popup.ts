import { BrowserWindow, screen, type Rectangle } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { computeTrayPopupBounds } from './popup-layout'
import { trayBounds } from '../tray'
import { logStartup } from '../startup-log'

// 悬停未读列表窗口（仅 Windows）：贴在托盘图标上方，不可获得焦点。
// 显隐由托盘 mouse-enter/leave 与光标位置复查驱动，内容由渲染进程自己订阅快照与事件
let popup: BrowserWindow | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let lastBounds: { x: number; y: number; width: number; height: number } | null = null
let getUnreadRows: () => number = () => 0

// 由 index.ts 注入：当前有未读的会话数（窗口初始尺寸的依据）
export function configureTrayPopup(rows: () => number): void {
  getUnreadRows = rows
}

function ensureTrayPopup(): BrowserWindow | null {
  if (process.platform !== 'win32') {
    return null
  }
  if (popup !== null && !popup.isDestroyed()) {
    return popup
  }
  const window = new BrowserWindow({
    width: 300,
    height: 120,
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
  window.on('closed', () => {
    popup = null
    lastBounds = null
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    void window.loadURL(`${devUrl}/?window=tray-popup`)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), {
      search: '?window=tray-popup'
    })
  }
  popup = window
  logStartup('tray popup window created')
  return window
}

// 托盘图标位置：个别环境 tray.getBounds() 恒为全零，退到工作区右下角当锚点
// （列表仍然出现在右下角，只是不再精确贴着图标）
let fallbackLogged = false
function popupAnchor(): Rectangle {
  const area = screen.getPrimaryDisplay().workArea
  const tray = trayBounds()
  if (tray !== null && tray.width > 0 && tray.height > 0) {
    return tray
  }
  if (!fallbackLogged) {
    fallbackLogged = true
    logStartup('tray bounds unavailable, popup anchored to work-area corner')
  }
  return { x: area.x + area.width - 16, y: area.y + area.height, width: 16, height: 0 }
}

export function showTrayPopup(): void {
  const rows = getUnreadRows()
  if (rows <= 0) {
    return
  }
  const window = ensureTrayPopup()
  if (window === null) {
    return
  }
  const tray = popupAnchor()
  const area = screen.getPrimaryDisplay().workArea
  const bounds = computeTrayPopupBounds(tray, area, rows)
  logStartup(
    `tray popup show tray=${JSON.stringify(tray)} rows=${rows} bounds=${JSON.stringify(bounds)}`
  )
  window.setBounds(bounds)
  lastBounds = bounds
  if (!window.isVisible()) {
    window.showInactive()
  }
}

export function hideTrayPopup(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
  if (popup !== null && !popup.isDestroyed() && popup.isVisible()) {
    popup.hide()
  }
}

// 渲染进程按实际行数请求调整高度（行数变化时重新贴齐托盘上方）
export function resizeTrayPopup(rows: number): void {
  if (popup === null || popup.isDestroyed() || !popup.isVisible()) {
    return
  }
  const tray = popupAnchor()
  const area = screen.getPrimaryDisplay().workArea
  const bounds = computeTrayPopupBounds(tray, area, Math.max(1, Math.floor(rows)))
  lastBounds = bounds
  popup.setBounds(bounds)
}

// 光标同时离开托盘图标与列表窗口 200 毫秒后才收起，允许光标移进列表
function scheduleHideCheck(): void {
  if (hideTimer !== null) {
    clearTimeout(hideTimer)
  }
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (!cursorOverPopupOrTray()) {
      hideTrayPopup()
    }
  }, 200)
  hideTimer.unref?.()
}

function cursorOverPopupOrTray(): boolean {
  const point = screen.getCursorScreenPoint()
  if (
    lastBounds !== null &&
    point.x >= lastBounds.x &&
    point.x <= lastBounds.x + lastBounds.width &&
    point.y >= lastBounds.y &&
    point.y <= lastBounds.y + lastBounds.height
  ) {
    return true
  }
  const tray = popupAnchor()
  if (
    tray !== null &&
    point.x >= tray.x &&
    point.x <= tray.x + tray.width &&
    point.y >= tray.y &&
    point.y <= tray.y + tray.height
  ) {
    return true
  }
  return false
}

export function onTrayLeave(): void {
  scheduleHideCheck()
}

export function onPopupLeave(): void {
  scheduleHideCheck()
}

// 未读清零立刻收起
export function setPopupUnreadCount(count: number): void {
  if (count <= 0) {
    hideTrayPopup()
  }
}

export function destroyTrayPopup(): void {
  hideTrayPopup()
  if (popup !== null && !popup.isDestroyed()) {
    popup.destroy()
  }
  popup = null
  lastBounds = null
  getUnreadRows = () => 0
}
