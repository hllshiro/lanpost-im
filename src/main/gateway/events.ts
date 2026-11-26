import { randomUUID } from 'node:crypto'
import type { GatewayEventRow, GatewayStore } from './store'

/** 推送给插件的统一事件信封，字段与 docs/gateway-api.md 5.1 一致。 */
export interface GwEvent {
  eventId: string
  sequence: number
  method: string
  data: Record<string, unknown>
}

export interface EventLogOptions {
  retentionHours: number
  now?: () => number
}

interface EventEnvelope {
  event_id: string
  sequence: number
  method: string
  data: Record<string, unknown>
}

function toEnvelope(event: GwEvent): EventEnvelope {
  return {
    event_id: event.eventId,
    sequence: event.sequence,
    method: event.method,
    data: event.data
  }
}

function parseEnvelope(payload: string): Partial<EventEnvelope> {
  try {
    return JSON.parse(payload) as Partial<EventEnvelope>
  } catch {
    return {}
  }
}

function fromRow(row: GatewayEventRow): GwEvent {
  const parsed = parseEnvelope(row.payload)
  return {
    eventId: parsed.event_id ?? row.event_id,
    sequence: parsed.sequence ?? row.sequence,
    method: parsed.method ?? row.method,
    data: parsed.data ?? {}
  }
}

/**
 * 事件先落库再推送。sequence 来自 gateway_events 的 AUTOINCREMENT，
 * 跨重启单调递增；未 ACK 的事件一直保留，供 events.resume 补发。
 */
export class EventLog {
  private readonly now: () => number

  constructor(
    private readonly store: GatewayStore,
    private readonly options: EventLogOptions
  ) {
    this.now = options.now ?? Date.now
  }

  append(method: string, data: Record<string, unknown> = {}): GwEvent {
    const eventId = `evt_${randomUUID()}`
    const createdAt = this.now()
    const sequence = this.store.appendEvent({
      eventId,
      method,
      payload: JSON.stringify({ event_id: eventId, sequence: 0, method, data }),
      createdAt
    })
    const event: GwEvent = { eventId, sequence, method, data }
    this.store.updateEventPayload(sequence, JSON.stringify(toEnvelope(event)))
    return event
  }

  pending(afterSequence: number): GwEvent[] {
    return this.store.pendingEvents(afterSequence).map(fromRow)
  }

  ack(eventId: string, sequence: number): number {
    return this.store.ackEvent(eventId, sequence, this.now())
  }

  resume(lastSequence: number): { events: GwEvent[]; latestSequence: number; expired: boolean } {
    const latestSequence = this.store.latestSequence()
    const min = this.store.minSequence()
    const expired = lastSequence > 0 && min !== null && lastSequence < min - 1
    return { events: this.pending(lastSequence), latestSequence, expired }
  }

  cleanup(now: number = this.now()): { removed: number } {
    const before = now - this.options.retentionHours * 60 * 60 * 1000
    return { removed: this.store.cleanupEvents(before) }
  }
}
