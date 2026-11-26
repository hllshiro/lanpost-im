import type { GwEvent } from './events'

export type EventEmitter = (method: string, params: Record<string, unknown>) => void

/**
 * 事件推送串行化：保证同一连接上的通知按 sequence 顺序发出。
 * 推送失败只上报日志；未收到事件的连接靠 events.resume 补发。
 */
export class EventPump {
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly emit: EventEmitter,
    private readonly onError?: (message: string, error: unknown) => void
  ) {}

  push(event: GwEvent): void {
    const params = {
      event_id: event.eventId,
      sequence: event.sequence,
      method: event.method,
      data: event.data
    }
    this.chain = this.chain.then(() => {
      try {
        this.emit(event.method, params)
      } catch (error) {
        this.onError?.(`事件推送失败：${event.method}`, error)
      }
    })
  }

  /** 等待队列清空，主要给测试与优雅退出用。 */
  async idle(): Promise<void> {
    await this.chain
  }
}
