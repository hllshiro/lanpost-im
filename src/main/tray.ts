import { app, Menu, Tray, nativeImage, type Tray as TrayType } from 'electron'
import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import tray16 from '../../resources/tray-16.png?asset'
import tray22 from '../../resources/tray-22.png?asset'
import trayUnread16 from '../../resources/tray-unread-16.png?asset'
import trayUnread22 from '../../resources/tray-unread-22.png?asset'

let tray: TrayType | null = null
let normalImage: Electron.NativeImage | null = null
let unreadImage: Electron.NativeImage | null = null
let emptyImage: Electron.NativeImage | null = null
let unreadCount = 0
// 闪烁是独立于未读数的状态：亮 500 毫秒、灭 500 毫秒
let blinking = false
let phase = false
let blinkTimer: ReturnType<typeof setInterval> | null = null

export interface TrayActions {
  onShow: () => void
  onSettings: () => void
  onQuit: () => void
  // 悬停未读列表：进入与离开托盘图标（事件仅 Windows/macOS 触发，Linux 自然不弹）
  onHoverEnter: () => void
  onHoverLeave: () => void
}

export function createTray(actions: TrayActions): TrayType {
  // Windows 用 16；Linux 用 22（麒麟信安无效时改 24，资源已备好）
  const size = process.platform === 'win32' ? 16 : 22
  const sourceNormal = size === 16 ? tray16 : tray22
  const sourceUnread = size === 16 ? trayUnread16 : trayUnread22
  // 启动时把图标复制到数据目录的真实路径（asar 之外）：
  // 桌面宿主按路径加载托盘图标时读不了 asar 内部，会退回系统默认图标
  const iconDir = join(app.getPath('userData'), 'icons')
  mkdirSync(iconDir, { recursive: true })
  const normalPath = join(iconDir, `tray-${size}.png`)
  const unreadPath = join(iconDir, `tray-unread-${size}.png`)
  copyFileSync(sourceNormal, normalPath)
  copyFileSync(sourceUnread, unreadPath)
  normalImage = nativeImage.createFromPath(normalPath)
  unreadImage = nativeImage.createFromPath(unreadPath)
  emptyImage = nativeImage.createEmpty()
  tray = new Tray(normalImage)
  tray.setToolTip('内网传书')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开主界面', click: actions.onShow },
      { label: '设置', click: actions.onSettings },
      { type: 'separator' },
      { label: '退出', click: actions.onQuit }
    ])
  )
  tray.on('click', actions.onShow)
  tray.on('mouse-enter', () => actions.onHoverEnter())
  tray.on('mouse-leave', () => actions.onHoverLeave())
  return tray
}

// 供悬停列表定位：托盘图标在屏幕上的位置
export function trayBounds(): Electron.Rectangle | null {
  return tray?.getBounds() ?? null
}

function render(): void {
  if (tray === null) return
  const image = blinking
    ? phase
      ? unreadImage
      : emptyImage
    : unreadCount > 0 && unreadImage !== null
      ? unreadImage
      : normalImage
  if (image !== null) {
    tray.setImage(image)
  }
}

export function setTrayBadge(count: number): void {
  unreadCount = count
  if (tray !== null) {
    tray.setToolTip(count > 0 ? `内网传书 · ${count} 条未读` : '内网传书')
  }
  render()
}

// 同一状态重复设置无副作用；开启时立即显示一个亮起相位
export function setTrayBlinking(active: boolean): void {
  if (active === blinking) return
  blinking = active
  phase = true
  if (blinkTimer !== null) {
    clearInterval(blinkTimer)
    blinkTimer = null
  }
  if (active) {
    blinkTimer = setInterval(() => {
      phase = !phase
      render()
    }, 500)
  }
  render()
}

export function currentTrayUnread(): number {
  return unreadCount
}

export function destroyTray(): void {
  if (blinkTimer !== null) {
    clearInterval(blinkTimer)
    blinkTimer = null
  }
  tray?.destroy()
  tray = null
  normalImage = null
  unreadImage = null
  emptyImage = null
  unreadCount = 0
  blinking = false
  phase = false
}
