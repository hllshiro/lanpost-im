import { app, BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SettingsStore } from '../settings/store'
import { setTrayBadge, setTrayBlinking } from '../tray'
import { decideNotification, shouldBlink, type NotificationKind } from './policy'
import { logStartup } from '../startup-log'

export interface NotifyInput {
  conversationId: string
  title: string
  body: string
  kind: NotificationKind
  muted: boolean
  unread: number
}

// 勿扰时段是纯时间窗口，事件驱动算不出来，靠周期重算兜底
const BLINK_RECHECK_MS = 60_000

export class NotificationManager {
  private locked = false
  private unread = 0
  private blinkActive = false
  private blinkTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    this.blinkTimer = setInterval(() => this.recomputeBlink(), BLINK_RECHECK_MS)
    this.blinkTimer.unref()
  }

  // 锁屏视为失去焦点：即使窗口有焦点也要通知
  setLocked(locked: boolean): void {
    this.locked = locked
    this.recomputeBlink()
  }

  // 通知与闪烁共用的活跃判定：窗口有焦点且未锁屏
  private isActive(): boolean {
    return (this.getWindow()?.isFocused() ?? false) && !this.locked
  }

  setUnread(unread: number): void {
    this.unread = unread
    // 先重算闪烁再换图：未读归零时要先停闪，避免停闪用旧数字又把图标切回未读态
    this.recomputeBlink()
    setTrayBadge(unread)
    if (process.platform === 'linux') {
      app.setBadgeCount(unread)
    }
  }

  // 焦点、锁屏、设置变化的统一入口：重算闪烁状态
  refresh(): void {
    this.recomputeBlink()
  }

  private recomputeBlink(): void {
    const should = shouldBlink({
      unread: this.unread,
      active: this.isActive(),
      settings: this.settings.get()
    })
    if (should === this.blinkActive) return
    this.blinkActive = should
    setTrayBlinking(should)
  }

  notify(input: NotifyInput): void {
    const window = this.getWindow()
    const decision = decideNotification({
      settings: this.settings.get(),
      kind: input.kind,
      isSelf: false,
      muted: input.muted,
      windowFocused: this.isActive(),
      conversationId: input.conversationId
    })
    this.setUnread(input.unread)
    if (!decision.badge) {
      return
    }
    if ((decision.sound || decision.toast) && window !== null) {
      window.webContents.send(IPC.uiNotify, {
        conversationId: input.conversationId,
        title: input.title,
        body: input.body,
        sound: decision.sound
      })
    }
    if (decision.system) {
      const notification = new Notification({ title: input.title, body: input.body })
      notification.on('click', () => {
        const target = this.getWindow()
        if (target !== null) {
          target.show()
          target.focus()
          target.webContents.send(IPC.uiSelectConversation, input.conversationId)
        }
      })
      notification.show()
    }
  }

  stop(): void {
    if (this.blinkTimer !== null) {
      clearInterval(this.blinkTimer)
      this.blinkTimer = null
    }
    setTrayBlinking(false)
    setTrayBadge(0)
    app.setBadgeCount(0)
    logStartup('notification manager stopped')
  }
}
