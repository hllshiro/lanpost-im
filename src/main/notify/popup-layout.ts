import type { Rectangle } from 'electron'
import { TRAY_POPUP } from '../../shared/ipc'

// 悬停未读列表的位置：贴在托盘图标上方 8 像素，右缘与托盘右缘对齐，整体钳制在工作区内
export function computeTrayPopupBounds(
  trayBounds: Rectangle,
  workArea: Rectangle,
  rows: number
): { x: number; y: number; width: number; height: number } {
  const height = Math.min(
    rows * TRAY_POPUP.rowHeight + TRAY_POPUP.footerHeight + TRAY_POPUP.padding * 2,
    TRAY_POPUP.maxHeight
  )
  const width = TRAY_POPUP.width
  const x = Math.max(
    workArea.x,
    Math.min(trayBounds.x + trayBounds.width - width, workArea.x + workArea.width - width)
  )
  const y = Math.max(workArea.y, trayBounds.y - height - 8)
  return { x, y, width, height }
}
