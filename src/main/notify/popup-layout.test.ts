import { describe, expect, it } from 'vitest'
import { TRAY_POPUP } from '../../shared/ipc'
import { computeTrayPopupBounds } from './popup-layout'

describe('computeTrayPopupBounds', () => {
  it('列表贴托盘上方，右缘与托盘对齐且不超出工作区', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    const tray = { x: 1880, y: 1040, width: 24, height: 24 }
    const bounds = computeTrayPopupBounds(tray, workArea, 3)
    expect(bounds.width).toBe(TRAY_POPUP.width)
    expect(bounds.height).toBe(
      3 * TRAY_POPUP.rowHeight + TRAY_POPUP.footerHeight + TRAY_POPUP.padding * 2
    )
    // 右缘与托盘右缘对齐
    expect(bounds.x + bounds.width).toBe(tray.x + tray.width)
    // 底边在托盘上方 8 像素
    expect(bounds.y + bounds.height).toBe(tray.y - 8)
    expect(bounds.x).toBeGreaterThanOrEqual(workArea.x)
    expect(bounds.y).toBeGreaterThanOrEqual(workArea.y)
  })

  it('行数很多时高度封顶', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1040 }
    const tray = { x: 1880, y: 1040, width: 24, height: 24 }
    const bounds = computeTrayPopupBounds(tray, workArea, 50)
    expect(bounds.height).toBe(TRAY_POPUP.maxHeight)
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(tray.y - 8)
  })

  it('托盘不在最右时右缘不越出工作区', () => {
    const workArea = { x: 0, y: 0, width: 1366, height: 728 }
    const tray = { x: 1300, y: 728, width: 24, height: 24 }
    const bounds = computeTrayPopupBounds(tray, workArea, 2)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(workArea.x + workArea.width)
    expect(bounds.y + bounds.height).toBe(tray.y - 8)
  })
})
