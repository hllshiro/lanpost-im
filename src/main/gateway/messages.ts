import { createHash } from 'node:crypto'
import { MAX_IMAGE_BYTES, MAX_TEXT_BYTES } from './protocol'
import { gwError } from './errors'
import { isAllowedImageMime } from './attachments'
import type { AttachmentStore } from './attachments'
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
  /** 图片离线重试间隔。 */
  retryDelayMs?: number
  /** 图片最多重试次数。 */
  maxImageRetries?: number
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
    const attachmentId = content.attachment_id
    const mimeType = content.mime_type
    const size = content.size
    const sha256 = content.sha256
    if (typeof attachmentId !== 'string' || attachmentId.length === 0) {
      throw gwError('INVALID_ARGUMENT', 'content.attachment_id 必须是非空字符串')
    }
    if (typeof mimeType !== 'string' || !isAllowedImageMime(mimeType)) {
      throw gwError(
        'UNSUPPORTED_CONTENT_TYPE',
        '只支持 image/png、image/jpeg、image/webp、image/gif'
      )
    }
    if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) {
      throw gwError('INVALID_ARGUMENT', 'content.size 必须是正整数')
    }
    if (size > MAX_IMAGE_BYTES) throw gwError('MESSAGE_TOO_LARGE', '图片超过大小上限')
    if (typeof sha256 !== 'string' || !/^[0-9a-fA-F]{64}$/.test(sha256)) {
      throw gwError('INVALID_ARGUMENT', 'content.sha256 必须是 64 位十六进制')
    }
    const name = typeof content.name === 'string' ? content.name : ''
    return {
      type: 'image',
      attachment_id: attachmentId,
      mime_type: mimeType,
      name,
      size,
      sha256: sha256.toLowerCase()
    }
  }
  throw gwError('UNSUPPORTED_CONTENT_TYPE')
}

function parseSend(
  params: Record<string, unknown>,
  targetKey: 'protocol_id' | 'group_id'
): ParsedSend {
  const requestId = params.request_id
  if (typeof requestId !== 'string' || requestId.length === 0 || requestId.length > 128) {
    throw gwError('INVALID_ARGUMENT', 'request_id 必须是 1..128 字符的字符串')
  }
  const target = params[targetKey]
  if (typeof target !== 'string' || target.length === 0) {
    throw gwError('INVALID_ARGUMENT', `${targetKey} 必须是非空字符串`)
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
  private readonly retryDelayMs: number
  private readonly maxImageRetries: number
  private readonly inFlight = new Map<string, Promise<SendResult>>()
  private readonly imageAttempts = new Map<string, number>()
  private readonly imageTimers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly bridge: GatewayBridge,
    private readonly store: GatewayStore,
    private readonly events: EventLog,
    private readonly attachments: AttachmentStore,
    options: MessageSenderOptions = {}
  ) {
    this.now = options.now ?? Date.now
    this.retryDelayMs = options.retryDelayMs ?? 30_000
    this.maxImageRetries = options.maxImageRetries ?? 3
  }

  sendUser(params: Record<string, unknown>): Promise<SendResult> {
    const parsed = parseSend(params, 'protocol_id')
    const hash = this.argsHash('message.sendUser', parsed)
    const existing = this.store.findRequest(parsed.requestId)
    if (existing) return Promise.resolve(this.replay(existing, hash, 'message.sendUser'))

    const running = this.inFlight.get(parsed.requestId)
    if (running) return running

    const task = this.doSendUser(parsed, hash).finally(() => {
      this.inFlight.delete(parsed.requestId)
    })
    this.inFlight.set(parsed.requestId, task)
    return task
  }

  sendGroup(params: Record<string, unknown>): Promise<SendResult> {
    const parsed = parseSend(params, 'group_id')
    const hash = this.argsHash('message.sendGroup', parsed)
    const existing = this.store.findRequest(parsed.requestId)
    if (existing) return Promise.resolve(this.replay(existing, hash, 'message.sendGroup'))

    const running = this.inFlight.get(parsed.requestId)
    if (running) return running

    const task = this.doSendGroup(parsed, hash).finally(() => {
      this.inFlight.delete(parsed.requestId)
    })
    this.inFlight.set(parsed.requestId, task)
    return task
  }

  private async doSendUser(parsed: ParsedSend, hash: string): Promise<SendResult> {
    const peer = this.bridge.getPeer(parsed.target)
    if (!peer) throw gwError('USER_NOT_FOUND')

    const result =
      parsed.content.type === 'text'
        ? await this.bridge.sendPrivateText(parsed.target, parsed.content.text)
        : await this.sendPrivateImage(parsed.target, parsed.content)
    const messageId = `im:${result.imMessageId}`
    const now = this.now()
    const content = JSON.stringify(parsed.content)
    const status: GatewayMessageRow['status'] =
      parsed.content.type === 'image' && result.status === 'sent'
        ? 'delivered'
        : normalizeStatus(result.status)
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
        status,
        content,
        created_at: now,
        updated_at: now
      })
    }
    if (parsed.content.type === 'image') {
      this.settleOutboundImage(parsed.content, messageId, `direct:${parsed.target}`, status, result)
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

  private async sendPrivateImage(
    protocolId: string,
    content: Extract<MessageContent, { type: 'image' }>
  ): Promise<GatewaySendResult> {
    const attachment = this.attachments.ready(content.attachment_id)
    if (
      attachment.mime_type !== content.mime_type ||
      attachment.size !== content.size ||
      attachment.sha256 !== content.sha256
    ) {
      throw gwError('ATTACHMENT_NOT_FOUND', '附件与消息内容不一致')
    }
    return this.bridge.sendPrivateImage(
      protocolId,
      attachment.path,
      attachment.name,
      attachment.mime_type
    )
  }

  /** 出站图片立即成功时推 delivered 并消费附件；失败时推 failed；queued 等 peer-ready 重试。 */
  private settleOutboundImage(
    content: Extract<MessageContent, { type: 'image' }>,
    messageId: string,
    conversationId: string,
    status: GatewayMessageRow['status'],
    result: GatewaySendResult
  ): void {
    if (status === 'delivered') {
      this.attachments.consume(content.attachment_id, messageId)
      this.events.append('message.deliveryStatus', {
        message_id: messageId,
        conversation_id: conversationId,
        status: 'delivered',
        reason: '',
        timestamp: new Date(this.now()).toISOString()
      })
    } else if (status === 'failed') {
      this.events.append('message.deliveryStatus', {
        message_id: messageId,
        conversation_id: conversationId,
        status: 'failed',
        reason: result.reason ?? '图片发送失败',
        timestamp: new Date(this.now()).toISOString()
      })
    }
  }

  private async doSendGroup(parsed: ParsedSend, hash: string): Promise<SendResult> {
    const group = this.bridge.getGroup(parsed.target)
    if (!group) throw gwError('GROUP_NOT_FOUND')

    const result =
      parsed.content.type === 'text'
        ? await this.bridge.sendGroupText(parsed.target, parsed.content.text)
        : await this.sendGroupImage(parsed.target, parsed.content)
    const messageId = `im:${result.imMessageId}`
    const now = this.now()
    const conversationId = `group:${parsed.target}`
    const status: GatewayMessageRow['status'] =
      result.status === 'sent' ? 'delivered' : result.status === 'failed' ? 'failed' : 'queued'
    if (!this.store.messageById(messageId)) {
      this.store.insertMessage({
        id: messageId,
        direction: 'out',
        conversation_type: 'group',
        conversation_id: conversationId,
        protocol_id: '',
        group_id: parsed.target,
        im_message_id: result.imMessageId,
        nwt_msg_id: result.nwtMsgId,
        status,
        content: JSON.stringify(parsed.content),
        created_at: now,
        updated_at: now
      })
    }
    if (status === 'delivered') {
      if (parsed.content.type === 'image') {
        this.attachments.consume(parsed.content.attachment_id, messageId)
      }
      this.events.append('message.deliveryStatus', {
        message_id: messageId,
        conversation_id: conversationId,
        status: 'delivered',
        reason: '',
        timestamp: new Date(now).toISOString()
      })
    } else if (status === 'failed') {
      this.events.append('message.deliveryStatus', {
        message_id: messageId,
        conversation_id: conversationId,
        status: 'failed',
        reason: result.reason ?? '群消息发送失败',
        timestamp: new Date(now).toISOString()
      })
    }
    this.store.saveRequest({
      request_id: parsed.requestId,
      method: 'message.sendGroup',
      args_hash: hash,
      result: JSON.stringify(toSendResult(messageId)),
      created_at: now
    })
    return toSendResult(messageId)
  }

  private async sendGroupImage(
    groupId: string,
    content: Extract<MessageContent, { type: 'image' }>
  ): Promise<GatewaySendResult> {
    const attachment = this.attachments.ready(content.attachment_id)
    if (
      attachment.mime_type !== content.mime_type ||
      attachment.size !== content.size ||
      attachment.sha256 !== content.sha256
    ) {
      throw gwError('ATTACHMENT_NOT_FOUND', '附件与消息内容不一致')
    }
    return this.bridge.sendGroupImage(
      groupId,
      attachment.path,
      attachment.name,
      attachment.mime_type
    )
  }

  private replay(
    existing: { method: string; args_hash: string; result: string },
    hash: string,
    method: string
  ): SendResult {
    if (existing.method !== method || existing.args_hash !== hash) {
      throw gwError('DUPLICATE_REQUEST', 'request_id 已被不同参数使用')
    }
    return JSON.parse(existing.result) as SendResult
  }

  private argsHash(method: string, parsed: ParsedSend): string {
    return createHash('sha256')
      .update(stableJson({ method, target: parsed.target, content: parsed.content }))
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
      case 'image-in':
        this.appendReceivedImage(event)
        break
      case 'peer-ready':
        this.retryPendingImages(event.protocolId)
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

  private appendReceivedImage(event: Extract<GatewayBridgeEvent, { kind: 'image-in' }>): void {
    const messageId = `im:${event.imMessageId}`
    if (this.store.messageById(messageId)) return
    let attachmentId: string
    try {
      attachmentId = this.attachments.importInbound({
        path: event.path,
        name: event.name,
        mimeType: event.mimeType,
        size: event.size,
        sha256: event.sha256
      }).attachmentId
    } catch {
      // 源文件可能已被移动或删除；丢弃本次图片，避免影响后续事件。
      return
    }
    const groupId =
      event.conversationType === 'group' ? event.conversationId.replace(/^group:/, '') : ''
    const content: MessageContent = {
      type: 'image',
      attachment_id: attachmentId,
      mime_type: event.mimeType,
      name: event.name,
      size: event.size,
      sha256: event.sha256
    }
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

  /** 对端上线：本机离线期间排队的一对一图片消息逐条尝试补发。 */
  private retryPendingImages(protocolId: string): void {
    for (const row of this.store.pendingMessages(protocolId)) {
      let content: MessageContent
      try {
        content = JSON.parse(row.content) as MessageContent
      } catch {
        continue
      }
      if (content.type === 'image') void this.attemptImage(row.id)
    }
  }

  private async attemptImage(rowId: string): Promise<void> {
    const row = this.store.messageById(rowId)
    if (!row || row.status !== 'queued') return
    let content: MessageContent
    try {
      content = JSON.parse(row.content) as MessageContent
    } catch {
      return
    }
    if (content.type !== 'image') return

    const attempts = (this.imageAttempts.get(rowId) ?? 0) + 1
    this.imageAttempts.set(rowId, attempts)
    let result: GatewaySendResult
    try {
      const attachment = this.attachments.ready(content.attachment_id)
      result = await this.bridge.sendPrivateImage(
        row.protocol_id,
        attachment.path,
        attachment.name,
        attachment.mime_type,
        row.im_message_id
      )
    } catch (error) {
      result = {
        imMessageId: row.im_message_id,
        nwtMsgId: row.nwt_msg_id,
        status: 'failed',
        reason: error instanceof Error ? error.message : '图片重试失败'
      }
    }

    if (result.status === 'sent') {
      this.imageAttempts.delete(rowId)
      this.clearImageTimer(rowId)
      this.attachments.consume(content.attachment_id, rowId)
      this.store.setMessageStatus(rowId, 'delivered', this.now())
      this.events.append('message.deliveryStatus', {
        message_id: rowId,
        conversation_id: row.conversation_id,
        status: 'delivered',
        reason: '',
        timestamp: new Date(this.now()).toISOString()
      })
      return
    }

    if (result.status === 'failed' || attempts >= this.maxImageRetries) {
      this.imageAttempts.delete(rowId)
      this.clearImageTimer(rowId)
      this.failImage(row, result.reason ?? `图片重试 ${attempts} 次仍未送达`)
      return
    }

    this.clearImageTimer(rowId)
    const timer = setTimeout(() => {
      this.imageTimers.delete(rowId)
      void this.attemptImage(rowId)
    }, this.retryDelayMs)
    this.imageTimers.set(rowId, timer)
  }

  private clearImageTimer(rowId: string): void {
    const timer = this.imageTimers.get(rowId)
    if (timer) {
      clearTimeout(timer)
      this.imageTimers.delete(rowId)
    }
  }

  private failImage(row: GatewayMessageRow, reason: string): void {
    this.store.setMessageStatus(row.id, 'failed', this.now())
    this.events.append('message.deliveryStatus', {
      message_id: row.id,
      conversation_id: row.conversation_id,
      status: 'failed',
      reason,
      timestamp: new Date(this.now()).toISOString()
    })
  }
}
