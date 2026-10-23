import { Menu, Tray, nativeImage, type Tray as TrayType } from 'electron'
import icon from '../../resources/icon.png?asset'
import unreadIcon from '../../resources/tray-unread.png?asset'

let tray: TrayType | null = null
let normalImage: Electron.NativeImage | null = null
let unreadImage: Electron.NativeImage | null = null
let unreadCount = 0

export interface TrayActions {
  onShow: () => void
  onSettings: () => void
  onQuit: () => void
}

export function createTray(actions: TrayActions): TrayType {
  const size = process.platform === 'win32' ? 16 : 22
  normalImage = nativeImage.createFromPath(icon).resize({ width: size, height: size })
  unreadImage = nativeImage.createFromPath(unreadIcon).resize({ width: size, height: size })
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
  return tray
}

export function setTrayBadge(count: number): void {
  unreadCount = count
  if (tray === null) {
    return
  }
  const showUnread = count > 0
  if (showUnread && unreadImage !== null) {
    tray.setImage(unreadImage)
  } else if (normalImage !== null) {
    tray.setImage(normalImage)
  }
  tray.setToolTip(count > 0 ? `内网传书 · ${count} 条未读` : '内网传书')
}

export function currentTrayUnread(): number {
  return unreadCount
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
  normalImage = null
  unreadImage = null
  unreadCount = 0
}
