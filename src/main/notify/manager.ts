import { app, BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SettingsStore } from '../settings/store'
import { setTrayBadge, setTrayBlinking } from '../tray'
import { decideNotification, shouldBlink, type NotificationKind } from './policy'
import { ToastList } from './toast-list'
import { pushToastWindow } from './toast-window'
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
// 每条弹窗显示 10 秒
const TOAST_TTL_MS = 10_000
// 解锁后系统会把焦点还给主窗口，这个聚焦不清除刚补显示的弹窗
const UNLOCK_FOCUS_GRACE_MS = 3_000

export class NotificationManager {
  private locked = false
  private unread = 0
  private blinkActive = false
  private blinkTimer: ReturnType<typeof setInterval> | null = null
  private readonly toastList = new ToastList()
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private ignoreFocusUntil = 0

  constructor(
    private readonly settings: SettingsStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {
    this.blinkTimer = setInterval(() => this.recomputeBlink(), BLINK_RECHECK_MS)
    this.blinkTimer.unref()
  }

  // 锁屏视为失去焦点：即使窗口有焦点也要通知；解锁后挂起的弹窗补显示
  setLocked(locked: boolean): void {
    const wasLocked = this.locked
    this.locked = locked
    if (wasLocked && !locked) {
      this.toastList.releaseAll(TOAST_TTL_MS)
      this.ignoreFocusUntil = Date.now() + UNLOCK_FOCUS_GRACE_MS
      this.scheduleToastTimer()
      this.pushToasts()
    }
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

  // 用户回到软件查看消息：清掉全部通知弹窗；未读、角标、闪烁不受影响
  onWindowFocus(): void {
    if (this.toastList.snapshot().length > 0 && Date.now() >= this.ignoreFocusUntil) {
      this.clearToasts()
    }
    this.recomputeBlink()
  }

  // 点击跳转与一键已读都会走到这里
  clearToasts(): void {
    this.toastList.clearAll()
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    this.pushToasts()
  }

  private scheduleToastTimer(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    const expiry = this.toastList.nextExpiry()
    if (expiry === null) {
      return
    }
    this.toastTimer = setTimeout(
      () => {
        this.toastTimer = null
        if (this.toastList.expireDue().length > 0) {
          this.pushToasts()
        }
        this.scheduleToastTimer()
      },
      Math.max(0, expiry - Date.now())
    )
    this.toastTimer.unref()
  }

  private pushToasts(): void {
    const items = this.toastList.snapshot()
    // Windows 走独立置顶窗口；其他平台发给主窗口，由应用内右下角弹窗渲染
    if (process.platform === 'win32') {
      pushToastWindow(items)
      return
    }
    this.getWindow()?.webContents.send(IPC.uiToastList, { toasts: items })
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
    // 声音单独走 uiNotify；弹窗显示走列表通道
    if (decision.sound && window !== null) {
      window.webContents.send(IPC.uiNotify, {
        conversationId: input.conversationId,
        title: input.title,
        body: input.body,
        sound: decision.sound
      })
    }
    if (decision.toast) {
      // 锁屏期间先挂起，解锁后统一补显示完整 10 秒
      this.toastList.upsert(
        input.conversationId,
        input.title,
        input.body,
        this.locked ? null : Date.now() + TOAST_TTL_MS
      )
      this.scheduleToastTimer()
      this.pushToasts()
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
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    this.toastList.clearAll()
    setTrayBlinking(false)
    setTrayBadge(0)
    app.setBadgeCount(0)
    logStartup('notification manager stopped')
  }
}
