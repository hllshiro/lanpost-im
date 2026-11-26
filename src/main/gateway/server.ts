import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { Server } from 'rpc-websockets'
import { verifyRpcToken } from './auth'
import { AttachmentStore } from './attachments'
import type { GatewayBridge } from './bridge'
import { gwError, toRpcError } from './errors'
import { EventLog } from './events'
import { handleMediaRequest, prepareUpload } from './media'
import { MessageSender } from './messages'
import { EventPump } from './pump'
import {
  GW_EVENTS,
  GW_METHODS,
  MAX_IMAGE_BYTES,
  MAX_RPC_BYTES,
  MEDIA_PATH,
  RPC_PATH
} from './protocol'
import { GatewayStore } from './store'
import { listUsers } from './users'

export interface GatewayServerOptions {
  db: DatabaseSync
  bridge: GatewayBridge
  dataDir: string
  host: string
  port: number
  token: string
  maxImageBytes?: number
  eventRetentionHours?: number
  maxClients?: number
  onLog?: (message: string, detail?: Record<string, unknown>) => void
}

export interface GatewayStatus {
  running: boolean
  port: number
  url: string
  lastError: string
  clients: number
}

interface NamespaceEmitter {
  emit(event: string, params: Record<string, unknown>): void
}

const DEFAULT_EVENT_RETENTION_HOURS = 168
const DEFAULT_MAX_CLIENTS = 8
const CLEANUP_INTERVAL_MS = 60 * 60_000

/**
 * 网关的装配点：http + rpc-websockets + /media。
 * 本文件是网关里唯一 import rpc-websockets / node:http 的模块。
 */
export class GatewayServer {
  private readonly store: GatewayStore
  private readonly attachments: AttachmentStore
  private readonly events: EventLog
  private readonly sender: MessageSender
  private readonly pump: EventPump
  private readonly maxImageBytes: number
  private readonly maxClients: number
  private bridgeUnsub: (() => void) | null = null
  private rpc: Server | null = null
  private http: ReturnType<typeof createServer> | null = null
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private token: string
  private running = false
  private port = 0
  private url = ''
  private lastError = ''
  private clients = 0

  constructor(private readonly options: GatewayServerOptions) {
    this.maxImageBytes = options.maxImageBytes ?? MAX_IMAGE_BYTES
    this.maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS
    this.token = options.token
    this.store = new GatewayStore(options.db)

    this.pump = new EventPump((method, params) => {
      if (!this.rpc) return
      const emitter = this.rpc.of(RPC_PATH) as unknown as NamespaceEmitter
      emitter.emit(method, params)
    })

    this.events = new EventLog(this.store, {
      retentionHours: options.eventRetentionHours ?? DEFAULT_EVENT_RETENTION_HOURS,
      onEvent: (event) => this.pump.push(event)
    })
    this.attachments = new AttachmentStore(this.store, join(options.dataDir, 'gateway'))
    this.sender = new MessageSender(this.options.bridge, this.store, this.events, this.attachments)
  }

  async start(): Promise<{ url: string; port: number }> {
    if (this.running) return { url: this.url, port: this.port }
    this.bridgeUnsub?.()
    this.bridgeUnsub = this.options.bridge.subscribe((event) => this.sender.onBridgeEvent(event))
    try {
      const http = createServer((req, res) => {
        void this.handleHttp(req, res)
      })
      this.http = http
      const rpc = new Server({ server: http, path: RPC_PATH, maxPayload: MAX_RPC_BYTES })
      this.rpc = rpc
      this.registerMethods(rpc)

      rpc.on('connection', (socket: { close: (code?: number, reason?: string) => void }) => {
        this.clients += 1
        if (this.clients > this.maxClients) {
          socket.close(4409, 'too many connections')
        }
      })
      rpc.on('disconnection', () => {
        this.clients = Math.max(0, this.clients - 1)
      })

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          http.off('listening', onListening)
          reject(error)
        }
        const onListening = (): void => {
          http.off('error', onError)
          resolve()
        }
        http.once('error', onError)
        http.once('listening', onListening)
        http.listen(this.options.port, this.options.host)
      })

      const address = http.address() as AddressInfo
      this.port = address.port
      this.url = `ws://${displayHost(this.options.host)}:${this.port}${RPC_PATH}`
      this.running = true
      this.lastError = ''
      this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
      this.cleanupTimer.unref?.()
      return { url: this.url, port: this.port }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error)
      await this.stopResources()
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.stopResources()
    this.running = false
  }

  /** 轮换令牌：现有连接全部以 4401 断开。 */
  setToken(token: string): void {
    this.token = token
    if (!this.rpc) return
    for (const socket of this.rpc.wss.clients) {
      socket.close(4401, 'token rotated')
    }
  }

  status(): GatewayStatus {
    return {
      running: this.running,
      port: this.port,
      url: this.url,
      lastError: this.lastError,
      clients: this.clients
    }
  }

  private registerMethods(rpc: Server): void {
    const wrap =
      <T>(handler: (params: Record<string, unknown>) => T | Promise<T>) =>
      async (raw: unknown): Promise<T> => {
        try {
          return await handler((raw ?? {}) as Record<string, unknown>)
        } catch (error) {
          throw toRpcError(error)
        }
      }

    rpc.setAuth(async (params: unknown) => verifyRpcToken(this.token, params), RPC_PATH)

    rpc
      .register(
        GW_METHODS.usersList,
        wrap((params) => listUsers(this.options.bridge, params)),
        RPC_PATH
      )
      .protected()
    rpc
      .register(
        GW_METHODS.sendUser,
        wrap((params) => this.sender.sendUser(params)),
        RPC_PATH
      )
      .protected()
    rpc
      .register(
        GW_METHODS.sendGroup,
        wrap((params) => this.sender.sendGroup(params)),
        RPC_PATH
      )
      .protected()
    rpc
      .register(
        GW_METHODS.prepareUpload,
        wrap((params) => prepareUpload(params, this.attachments, this.maxImageBytes)),
        RPC_PATH
      )
      .protected()
    rpc
      .register(
        GW_METHODS.eventsAck,
        wrap((params) => this.ackEvent(params)),
        RPC_PATH
      )
      .protected()
    rpc
      .register(
        GW_METHODS.eventsResume,
        wrap((params) => this.resumeEvents(params)),
        RPC_PATH
      )
      .protected()
    for (const event of GW_EVENTS) {
      rpc.event(event, RPC_PATH).protected()
    }
  }

  private ackEvent(params: Record<string, unknown>): { acked: true; latest_sequence: number } {
    const eventId = params.event_id
    const sequence = params.sequence
    if (typeof eventId !== 'string' || eventId.length === 0) {
      throw gwError('INVALID_ARGUMENT', 'event_id 必须是非空字符串')
    }
    if (typeof sequence !== 'number' || !Number.isInteger(sequence) || sequence < 1) {
      throw gwError('INVALID_ARGUMENT', 'sequence 必须是正整数')
    }
    const event = this.events.get(eventId)
    if (event && event.sequence === sequence) {
      const content = event.data.content as { attachment_id?: unknown } | undefined
      if (content && typeof content.attachment_id === 'string') {
        this.attachments.markAcked(content.attachment_id)
      }
    }
    const latest = this.events.ack(eventId, sequence)
    return { acked: true, latest_sequence: latest }
  }

  private resumeEvents(params: Record<string, unknown>): {
    latest_sequence: number
    events: Array<Record<string, unknown>>
  } {
    const lastSequence = params.last_sequence
    if (typeof lastSequence !== 'number' || !Number.isInteger(lastSequence) || lastSequence < 0) {
      throw gwError('INVALID_ARGUMENT', 'last_sequence 必须是非负整数')
    }
    const result = this.events.resume(lastSequence)
    if (result.expired) throw gwError('EVENT_CURSOR_EXPIRED')
    return {
      latest_sequence: result.latestSequence,
      events: result.events.map((event) => ({
        event_id: event.eventId,
        sequence: event.sequence,
        method: event.method,
        data: event.data
      }))
    }
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?')[0]
    if (path === MEDIA_PATH || path.startsWith(`${MEDIA_PATH}/`)) {
      await handleMediaRequest(req, res, {
        attachments: this.attachments,
        maxImageBytes: this.maxImageBytes,
        expectedToken: this.token,
        onLog: (message) => this.options.onLog?.(message)
      })
      return
    }
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ code: -32010, message: 'NOT_FOUND' }))
  }

  private cleanup(): void {
    try {
      this.events.cleanup()
      this.attachments.cleanup(Date.now())
    } catch (error) {
      this.options.onLog?.('网关清理失败', { error: String(error) })
    }
  }

  private async stopResources(): Promise<void> {
    this.bridgeUnsub?.()
    this.bridgeUnsub = null
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    const rpc = this.rpc
    this.rpc = null
    if (rpc) {
      try {
        await rpc.close()
      } catch (error) {
        this.options.onLog?.('关闭 RPC 服务失败', { error: String(error) })
      }
    }
    const http = this.http
    this.http = null
    if (http) {
      await new Promise<void>((resolve) => {
        http.close(() => resolve())
      })
    }
    this.clients = 0
    this.running = false
  }
}

/** 监听 0.0.0.0/:: 时对外展示的连接地址回落到回环地址。 */
function displayHost(host: string): string {
  if (host === '0.0.0.0' || host === '::' || host === '') return '127.0.0.1'
  return host
}
