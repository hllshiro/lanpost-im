import { app, BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SettingsStore } from '../settings/store'
import { setTrayUnread, setTrayBlinking } from '../tray'
import { decideNotification, shouldBlink, soundCooldownReady } from './policy'
import { ToastList, shouldClearToastsOnFocus } from './toast-list'
import { pushToastWindow } from './toast-window'
import { setPopupUnreadCount } from './tray-popup'
import { logStartup } from '../startup-log'

export interface NotifyInput {
  conversationId: string
  title: string
  body: string
  muted: boolean
  unread: number
}

// 每条弹窗显示 10 秒
const TOAST_TTL_MS = 10_000
// 解锁后系统会把焦点还给主窗口，这个聚焦不清除刚补显示的弹窗
const UNLOCK_FOCUS_GRACE_MS = 3_000

export class NotificationManager {
  private locked = false
  private unread = 0
  private blinkActive = false
  private readonly toastList = new ToastList()
  private toastTimer: ReturnType<typeof setTimeout> | null = null
  private ignoreFocusUntil = 0
  // 提示音全局冷却：15 秒内最多响一次，与具体会话无关
  private lastSoundAt = 0
  // 每个冷却窗口只记一条跳过日志，避免刷屏
  private soundSkipLogged = false

  constructor(
    private readonly settings: SettingsStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

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
    this.recomputeBlink()
    setTrayUnread(unread)
    setPopupUnreadCount(unread)
    if (process.platform === 'linux') {
      app.setBadgeCount(unread)
    }
  }

  // 焦点、锁屏、设置变化的统一入口：重算闪烁状态
  refresh(): void {
    this.recomputeBlink()
  }

  // 用户回到软件查看消息：清掉全部通知弹窗与系统通知；未读、闪烁不受影响
  onWindowFocus(): void {
    const clear = shouldClearToastsOnFocus({
      hasToasts: this.toastList.snapshot().length > 0,
      locked: this.locked,
      now: Date.now(),
      ignoreFocusUntil: this.ignoreFocusUntil
    })
    if (clear) {
      this.clearToasts()
    }
    this.recomputeBlink()
  }

  // 点击跳转、一键已读、回到前台都走这里：应用内弹窗与系统通知一并撤下
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
      settings: this.settings.get()
    })
    if (should === this.blinkActive) return
    this.blinkActive = should
    logStartup(`tray blink ${should ? 'start' : 'stop'} unread=${this.unread}`)
    setTrayBlinking(should)
  }

  notify(input: NotifyInput): void {
    const window = this.getWindow()
    const decision = decideNotification({
      settings: this.settings.get(),
      isSelf: false,
      muted: input.muted,
      windowFocused: this.isActive(),
      conversationId: input.conversationId
    })
    this.setUnread(input.unread)
    if (!decision.badge) {
      return
    }
    // 声音单独走 uiNotify；15 秒内最多响一次
    const now = Date.now()
    if (decision.sound && window !== null) {
      if (soundCooldownReady(this.lastSoundAt, now)) {
        this.lastSoundAt = now
        this.soundSkipLogged = false
        logStartup('notify sound played')
        window.webContents.send(IPC.uiNotify, {
          conversationId: input.conversationId,
          title: input.title,
          body: input.body,
          sound: decision.sound
        })
      } else if (!this.soundSkipLogged) {
        this.soundSkipLogged = true
        logStartup('notify sound skipped: cooldown')
      }
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
  }

  stop(): void {
    if (this.toastTimer !== null) {
      clearTimeout(this.toastTimer)
      this.toastTimer = null
    }
    this.toastList.clearAll()
    setTrayBlinking(false)
    setTrayUnread(0)
    app.setBadgeCount(0)
    logStartup('notification manager stopped')
  }
}
