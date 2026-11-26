import { createHash } from 'node:crypto'
import { MAX_TEXT_BYTES } from './protocol'
import { gwError } from './errors'
import type { GatewayBridge, GatewayBridgeEvent, GatewaySendResult } from './bridge'
import type { EventLog } from './events'
import type { GatewayMessageRow, GatewayStore } from './store'

export type MessageContent =
  | { type: 'text'; text: string }
  | {
      type: 'image'
      attachment_id: string
      mime_type: string
      name?: string
      size: number
      sha256: string
    }

export interface SendResult {
  message_id: string
  accepted: true
  delivery_status: 'queued'
}

export interface MessageSenderOptions {
  now?: () => number
}

interface ParsedSend {
  requestId: string
  target: string
  content: MessageContent
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function parseContent(value: unknown): MessageContent {
  if (value === null || typeof value !== 'object') {
    throw gwError('INVALID_ARGUMENT', 'content 必须是对象')
  }
  const content = value as Record<string, unknown>
  if (content.type === 'text') {
    if (typeof content.text !== 'string') {
      throw gwError('INVALID_ARGUMENT', 'content.text 必须是字符串')
    }
    if (Buffer.byteLength(content.text, 'utf8') > MAX_TEXT_BYTES) {
      throw gwError('MESSAGE_TOO_LARGE', '文本超过 16 KiB')
    }
    return { type: 'text', text: content.text }
  }
  if (content.type === 'image') {
    throw gwError('UNSUPPORTED_CONTENT_TYPE', '图片消息尚未启用')
  }
  throw gwError('UNSUPPORTED_CONTENT_TYPE')
}

function parseSend(params: Record<string, unknown>): ParsedSend {
  const requestId = params.request_id
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
    throw gwError('INVALID_ARGUMENT', 'request_id 必须是 1..128 字符的字符串')
  }
  const target = params.protocol_id
  if (typeof target !== 'string' || target.length === 0) {
    throw gwError('INVALID_ARGUMENT', 'protocol_id 必须是非空字符串')
  }
  return { requestId, target, content: parseContent(params.content) }
}

function toSendResult(messageId: string): SendResult {
  return { message_id: messageId, accepted: true, delivery_status: 'queued' }
}

function normalizeStatus(status: GatewaySendResult['status']): GatewayMessageRow['status'] {
  return status === 'failed' ? 'failed' : 'queued'
}

/**
 * 出站消息：幂等（request_id + 参数哈希）、落 gateway_messages、
 * 把 bridge 事件转换成 message.deliveryStatus / message.received。
 */
export class MessageSender {
  private readonly now: () => number
  private readonly inFlight = new Map<string, Promise<SendResult>>()

  constructor(
    private readonly bridge: GatewayBridge,
    private readonly store: GatewayStore,
    private readonly events: EventLog,
    options: MessageSenderOptions = {}
  ) {
    this.now = options.now ?? Date.now
  }

  sendUser(params: Record<string, unknown>): Promise<SendResult> {
    const parsed = parseSend(params)
    const hash = this.argsHash('message.sendUser', parsed)
    const existing = this.store.findRequest(parsed.requestId)
    if (existing) return Promise.resolve(this.replay(existing, hash))

    const running = this.inFlight.get(parsed.requestId)
    if (running) return running

    const task = this.doSendUser(parsed, hash).finally(() => {
      this.inFlight.delete(parsed.requestId)
    })
    this.inFlight.set(parsed.requestId, task)
    return task
  }

  async sendGroup(params: Record<string, unknown>): Promise<SendResult> {
    const parsed = parseSend(params)
    void parsed
    throw gwError('INTERNAL_ERROR', '群消息尚未启用')
  }

  private async doSendUser(parsed: ParsedSend, hash: string): Promise<SendResult> {
    const peer = this.bridge.getPeer(parsed.target)
    if (!peer) throw gwError('USER_NOT_FOUND')
    if (parsed.content.type !== 'text') throw gwError('UNSUPPORTED_CONTENT_TYPE')

    const result = await this.bridge.sendPrivateText(parsed.target, parsed.content.text)
    const messageId = `im:${result.imMessageId}`
    const now = this.now()
    const content = JSON.stringify(parsed.content)
    if (!this.store.messageById(messageId)) {
      this.store.insertMessage({
        id: messageId,
        direction: 'out',
        conversation_type: 'private',
        conversation_id: `direct:${parsed.target}`,
        protocol_id: parsed.target,
        group_id: '',
        im_message_id: result.imMessageId,
        nwt_msg_id: result.nwtMsgId,
        status: normalizeStatus(result.status),
        content,
        created_at: now,
        updated_at: now
      })
    }
    const sendResult = toSendResult(messageId)
    this.store.saveRequest({
      request_id: parsed.requestId,
      method: 'message.sendUser',
      args_hash: hash,
      result: JSON.stringify(sendResult),
      created_at: now
    })
    return sendResult
  }

  private replay(
    existing: { method: string; args_hash: string; result: string },
    hash: string
  ): SendResult {
    if (existing.method !== 'message.sendUser' || existing.args_hash !== hash) {
      throw gwError('DUPLICATE_REQUEST', 'request_id 已被不同参数使用')
    }
    return JSON.parse(existing.result) as SendResult
  }

  private argsHash(method: string, parsed: ParsedSend): string {
    return createHash('sha256')
      .update(stableJson({ method, protocol_id: parsed.target, content: parsed.content }))
      .digest('hex')
  }

  onBridgeEvent(event: GatewayBridgeEvent): void {
    switch (event.kind) {
      case 'delivered':
        this.applyDeliveryStatus(event.conversationId, event.nwtMsgId, 'delivered', '')
        break
      case 'failed':
        this.applyDeliveryStatus(event.conversationId, event.nwtMsgId, 'failed', event.reason)
        break
      case 'text-in':
        this.appendReceivedText(event)
        break
      default:
        break
    }
  }

  private applyDeliveryStatus(
    conversationId: string,
    nwtMsgId: number,
    status: 'delivered' | 'failed',
    reason: string
  ): void {
    const row = this.store.messageByNwt(conversationId, nwtMsgId)
    if (!row || row.status === status) return
    this.store.setMessageStatus(row.id, status, this.now())
    this.events.append('message.deliveryStatus', {
      message_id: row.id,
      conversation_id: conversationId,
      status,
      reason,
      timestamp: new Date(this.now()).toISOString()
    })
  }

  private appendReceivedText(event: Extract<GatewayBridgeEvent, { kind: 'text-in' }>): void {
    const messageId = `im:${event.imMessageId}`
    if (this.store.messageById(messageId)) return
    const groupId =
      event.conversationType === 'group' ? event.conversationId.replace(/^group:/, '') : ''
    const content: MessageContent = { type: 'text', text: event.text }
    this.store.insertMessage({
      id: messageId,
      direction: 'in',
      conversation_type: event.conversationType,
      conversation_id: event.conversationId,
      protocol_id: event.sender.protocolId,
      group_id: groupId,
      im_message_id: event.imMessageId,
      nwt_msg_id: 0,
      status: 'delivered',
      content: JSON.stringify(content),
      created_at: event.timestamp,
      updated_at: event.timestamp
    })
    this.events.append('message.received', {
      message_id: messageId,
      conversation_id: event.conversationId,
      conversation_type: event.conversationType,
      group_id: groupId.length > 0 ? groupId : null,
      sender: {
        protocol_id: event.sender.protocolId,
        username: event.sender.username,
        display_name: event.sender.displayName,
        hostname: event.sender.hostname
      },
      content,
      timestamp: new Date(event.timestamp).toISOString()
    })
  }
}
