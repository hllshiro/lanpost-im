import { app, BrowserWindow, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SettingsStore } from '../settings/store'
import { setTrayBadge } from '../tray'
import { decideNotification, type NotificationKind } from './policy'
import { logStartup } from '../startup-log'

export interface NotifyInput {
  conversationId: string
  title: string
  body: string
  kind: NotificationKind
  muted: boolean
  unread: number
}

export class NotificationManager {
  private activeConversationId: string | null = null
  private flashTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly getWindow: () => BrowserWindow | null
  ) {}

  setActiveConversation(conversationId: string | null): void {
    this.activeConversationId = conversationId
    if (conversationId !== null) {
      this.getWindow()?.flashFrame(false)
    }
  }

  setUnread(unread: number): void {
    setTrayBadge(unread)
    if (process.platform === 'linux') {
      app.setBadgeCount(unread)
    }
  }

  notify(input: NotifyInput): void {
    const window = this.getWindow()
    const decision = decideNotification({
      settings: this.settings.get(),
      kind: input.kind,
      isSelf: false,
      muted: input.muted,
      windowFocused: window?.isFocused() ?? false,
      activeConversationId: this.activeConversationId,
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
    if (decision.flash) {
      window?.flashFrame(true)
      this.startIconFlash()
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

  private startIconFlash(): void {
    if (this.flashTimer !== null) {
      clearInterval(this.flashTimer)
    }
    let visible = true
    this.flashTimer = setInterval(() => {
      visible = !visible
      setTrayBadge(visible ? 0 : 1)
    }, 600)
    setTimeout(() => {
      if (this.flashTimer !== null) {
        clearInterval(this.flashTimer)
        this.flashTimer = null
      }
      setTrayBadge(1)
    }, 6000)
  }

  stop(): void {
    if (this.flashTimer !== null) {
      clearInterval(this.flashTimer)
      this.flashTimer = null
    }
    setTrayBadge(0)
    app.setBadgeCount(0)
    logStartup('notification manager stopped')
  }
}
