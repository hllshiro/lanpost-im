import { Menu, Tray, nativeImage, type Tray as TrayType } from 'electron'
import icon from '../../resources/icon.png?asset'

let tray: TrayType | null = null

export interface TrayActions {
  onShow: () => void
  onSettings: () => void
  onQuit: () => void
}

export function createTray(actions: TrayActions): TrayType {
  const size = process.platform === 'win32' ? 16 : 22
  const image = nativeImage.createFromPath(icon).resize({ width: size, height: size })
  tray = new Tray(image)
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

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
