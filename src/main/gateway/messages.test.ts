import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../store/db'
import { GatewayStore } from './store'
import { EventLog } from './events'
import { AttachmentStore } from './attachments'
import { MessageSender } from './messages'
import type { MessageContent } from './messages'
import type { GatewayBridge, GatewayBridgeEvent, GatewaySendResult } from './bridge'

const PEER = 'aaaa1111aaaa1111aaaa1111aaaa1111'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

const dbs: DatabaseSync[] = []
const dirs: string[] = []

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // 已关闭
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  }
})

function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function makeImage(attachments: AttachmentStore): Extract<MessageContent, { type: 'image' }> {
  const sha256 = sha256Of(PNG)
  const prepared = attachments.prepare({
    mimeType: 'image/png',
    name: 'a.png',
    size: PNG.length,
    sha256
  })
  const { attachmentId } = attachments.acceptUpload(prepared.transferId, PNG, {
    mimeType: 'image/png',
    sha256
  })
  return {
    type: 'image',
    attachment_id: attachmentId,
    mime_type: 'image/png',
    name: 'a.png',
    size: PNG.length,
    sha256
  }
}

function setup(
  status: GatewaySendResult['status'] = 'sent',
  peerExists = true,
  group: { id: string; status: GatewaySendResult['status']; reason?: string } | null = {
    id: 'g-1',
    status: 'sent'
  },
  imageStatus: GatewaySendResult['status'] | GatewaySendResult['status'][] = 'sent'
): {
  sender: MessageSender
  store: GatewayStore
  log: EventLog
  attachments: AttachmentStore
  dir: string
  calls: Array<{ protocolId: string; text: string }>
  groupCalls: Array<{ groupId: string; text: string }>
  imageCalls: Array<{ protocolId: string; path: string; name: string; mimeType: string }>
  emit: (event: GatewayBridgeEvent) => void
} {
  const db = openDatabase(':memory:')
  dbs.push(db)
  const dir = mkdtempSync(join(tmpdir(), 'gateway-msg-'))
  dirs.push(dir)
  const store = new GatewayStore(db)
  const log = new EventLog(store, { retentionHours: 24 })
  const attachments = new AttachmentStore(store, dir)
  const calls: Array<{ protocolId: string; text: string }> = []
  const groupCalls: Array<{ groupId: string; text: string }> = []
  const imageCalls: Array<{ protocolId: string; path: string; name: string; mimeType: string }> = []
  const listeners: Array<(event: GatewayBridgeEvent) => void> = []
  const nextImageStatus: GatewaySendResult['status'][] = Array.isArray(imageStatus)
    ? [...imageStatus]
    : []
  const bridge: GatewayBridge = {
    listPeers: () => [],
    getPeer: (protocolId) =>
      peerExists
        ? {
            protocolId,
            username: 'alice',
            displayName: 'Alice',
            hostname: 'DESKTOP-A',
            online: true,
            lastSeenAt: 1
          }
        : null,
    listGroups: () => (group ? [{ id: group.id, name: '测试群', members: [] }] : []),
    getGroup: (groupId) =>
      group && group.id === groupId ? { id: group.id, name: '测试群', members: [] } : null,
    sendPrivateText: async (protocolId, text) => {
      calls.push({ protocolId, text })
      return { imMessageId: 42, nwtMsgId: 7, status }
    },
    sendGroupText: async (groupId, text) => {
      groupCalls.push({ groupId, text })
      return {
        imMessageId: 43,
        nwtMsgId: 8,
        status: group?.status ?? 'sent',
        reason: group?.reason
      }
    },
    sendPrivateImage: async (protocolId, path, name, mimeType) => {
      imageCalls.push({ protocolId, path, name, mimeType })
      const queuedStatus = nextImageStatus.length > 0 ? nextImageStatus.shift() : undefined
      return {
        imMessageId: 44,
        nwtMsgId: 9,
        status: queuedStatus ?? (Array.isArray(imageStatus) ? 'queued' : imageStatus)
      }
    },
    sendGroupImage: async () => ({ imMessageId: 0, nwtMsgId: 0, status: 'queued' }),
    subscribe: (listener) => {
      listeners.push(listener)
      return () => {
        const index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    }
  }
  return {
    sender: new MessageSender(bridge, store, log, attachments),
    store,
    log,
    attachments,
    dir,
    calls,
    groupCalls,
    imageCalls,
    emit: (event) => {
      for (const listener of listeners) listener(event)
    }
  }
}

function requestId(): string {
  return `req-${Math.random().toString(36).slice(2)}`
}

describe('MessageSender.sendUser', () => {
  it('在线发送返回 im:<id> 并落 queued 行', async () => {
    const { sender, store, calls } = setup('sent')
    const result = await sender.sendUser({
      request_id: requestId(),
      protocol_id: PEER,
      content: { type: 'text', text: '在吗' }
    })
    expect(result).toEqual({ message_id: 'im:42', accepted: true, delivery_status: 'queued' })
    expect(calls).toEqual([{ protocolId: PEER, text: '在吗' }])
    const row = store.messageById('im:42')
    expect(row).toMatchObject({
      direction: 'out',
      conversation_type: 'private',
      conversation_id: `direct:${PEER}`,
      protocol_id: PEER,
      nwt_msg_id: 7,
      status: 'queued'
    })
  })

  it('离线（bridge 返回 queued）同样返回 queued', async () => {
    const { sender, store } = setup('queued')
    const result = await sender.sendUser({
      request_id: requestId(),
      protocol_id: PEER,
      content: { type: 'text', text: '稍后看' }
    })
    expect(result.delivery_status).toBe('queued')
    expect(store.messageById('im:42')?.status).toBe('queued')
  })

  it('重复 request_id 同参数返回原结果且只发一次', async () => {
    const { sender, calls } = setup()
    const id = requestId()
    const first = await sender.sendUser({
      request_id: id,
      protocol_id: PEER,
      content: { type: 'text', text: 'hi' }
    })
    const second = await sender.sendUser({
      request_id: id,
      protocol_id: PEER,
      content: { type: 'text', text: 'hi' }
    })
    expect(second).toEqual(first)
    expect(calls).toHaveLength(1)
  })

  it('同一 request_id 不同参数返回 -32021', async () => {
    const { sender, calls } = setup()
    const id = requestId()
    await sender.sendUser({
      request_id: id,
      protocol_id: PEER,
      content: { type: 'text', text: 'hi' }
    })
    try {
      await sender.sendUser({
        request_id: id,
        protocol_id: PEER,
        content: { type: 'text', text: '变了' }
      })
      throw new Error('应当抛错')
    } catch (error) {
      expect((error as { rpcCode?: number }).rpcCode).toBe(-32021)
    }
    expect(calls).toHaveLength(1)
  })

  it('超长文本返回 -32013 且不发送', async () => {
    const { sender, calls } = setup()
    try {
      await sender.sendUser({
        request_id: requestId(),
        protocol_id: PEER,
        content: { type: 'text', text: 'x'.repeat(16 * 1024 + 1) }
      })
      throw new Error('应当抛错')
    } catch (error) {
      expect((error as { rpcCode?: number }).rpcCode).toBe(-32013)
    }
    expect(calls).toHaveLength(0)
  })

  it('未知用户返回 -32011', async () => {
    const { sender } = setup('sent', false)
    try {
      await sender.sendUser({
        request_id: requestId(),
        protocol_id: PEER,
        content: { type: 'text', text: 'hi' }
      })
      throw new Error('应当抛错')
    } catch (error) {
      expect((error as { rpcCode?: number }).rpcCode).toBe(-32011)
    }
  })

  it('非法参数与图片内容分别返回 -32010/-32014', async () => {
    const { sender } = setup()
    const cases = [
      { protocol_id: PEER, content: { type: 'text', text: 'hi' } },
      { request_id: requestId(), content: { type: 'text', text: 'hi' } },
      { request_id: requestId(), protocol_id: PEER, content: { type: 'video' } },
      {
        request_id: requestId(),
        protocol_id: PEER,
        content: {
          type: 'image',
          attachment_id: 'att_x',
          mime_type: 'image/png',
          size: 1,
          sha256: 'a'.repeat(64)
        }
      }
    ]
    for (const params of cases) {
      try {
        await sender.sendUser(params)
        throw new Error('应当抛错')
      } catch (error) {
        expect((error as { rpcCode?: number }).rpcCode).toBeLessThan(0)
      }
    }
  })
})

describe('MessageSender.onBridgeEvent', () => {
  it('delivered 事件把 queued 改为 delivered 并只推一次事件', async () => {
    const { sender, store, log } = setup()
    await sender.sendUser({
      request_id: requestId(),
      protocol_id: PEER,
      content: { type: 'text', text: 'hi' }
    })
    sender.onBridgeEvent({ kind: 'delivered', conversationId: `direct:${PEER}`, nwtMsgId: 7 })
    sender.onBridgeEvent({ kind: 'delivered', conversationId: `direct:${PEER}`, nwtMsgId: 7 })

    expect(store.messageById('im:42')?.status).toBe('delivered')
    const events = log.pending(0).filter((e) => e.method === 'message.deliveryStatus')
    expect(events).toHaveLength(1)
    expect(events[0].data).toMatchObject({
      message_id: 'im:42',
      conversation_id: `direct:${PEER}`,
      status: 'delivered'
    })
  })

  it('failed 事件带 reason 并置 failed', async () => {
    const { sender, store, log } = setup()
    await sender.sendUser({
      request_id: requestId(),
      protocol_id: PEER,
      content: { type: 'text', text: 'hi' }
    })
    sender.onBridgeEvent({
      kind: 'failed',
      conversationId: `direct:${PEER}`,
      nwtMsgId: 7,
      reason: '对端 24 小时未上线'
    })
    expect(store.messageById('im:42')?.status).toBe('failed')
    expect(log.pending(0)[0].data).toMatchObject({ status: 'failed', reason: '对端 24 小时未上线' })
  })

  it('text-in 生成 message.received，同 IM 消息只推一次', () => {
    const { sender, store, log } = setup()
    const event: GatewayBridgeEvent = {
      kind: 'text-in',
      imMessageId: 99,
      conversationId: `direct:${PEER}`,
      conversationType: 'private',
      sender: {
        protocolId: PEER,
        username: 'alice',
        displayName: 'Alice',
        hostname: 'DESKTOP-A'
      },
      text: '你好',
      timestamp: Date.UTC(2026, 10, 26, 2, 0, 0)
    }
    sender.onBridgeEvent(event)
    sender.onBridgeEvent(event)

    expect(store.messageById('im:99')?.direction).toBe('in')
    const events = log.pending(0).filter((e) => e.method === 'message.received')
    expect(events).toHaveLength(1)
    expect(events[0].data).toEqual({
      message_id: 'im:99',
      conversation_id: `direct:${PEER}`,
      conversation_type: 'private',
      group_id: null,
      sender: {
        protocol_id: PEER,
        username: 'alice',
        display_name: 'Alice',
        hostname: 'DESKTOP-A'
      },
      content: { type: 'text', text: '你好' },
      timestamp: '2026-11-26T02:00:00.000Z'
    })
  })

  it('群 text-in 的 group_id 从会话 id 推导', () => {
    const { sender, log } = setup()
    sender.onBridgeEvent({
      kind: 'text-in',
      imMessageId: 100,
      conversationId: 'group:g-1',
      conversationType: 'group',
      sender: {
        protocolId: PEER,
        username: 'alice',
        displayName: 'Alice',
        hostname: 'DESKTOP-A'
      },
      text: '大家好',
      timestamp: 1
    })
    expect(log.pending(0)[0].data.group_id).toBe('g-1')
  })
})

describe('MessageSender.sendGroup', () => {
  it('群不存在返回 -32012', async () => {
    const { sender } = setup('sent', true, null)
    try {
      await sender.sendGroup({
        request_id: requestId(),
        group_id: 'missing',
        content: { type: 'text', text: 'hi' }
      })
      throw new Error('应当抛错')
    } catch (error) {
      expect((error as { rpcCode?: number }).rpcCode).toBe(-32012)
    }
  })

  it('全部在线成员接受时写 delivered 并推 deliveryStatus', async () => {
    const { sender, store, log, groupCalls } = setup('sent')
    const result = await sender.sendGroup({
      request_id: requestId(),
      group_id: 'g-1',
      content: { type: 'text', text: '大家好' }
    })
    expect(result).toEqual({ message_id: 'im:43', accepted: true, delivery_status: 'queued' })
    expect(groupCalls).toEqual([{ groupId: 'g-1', text: '大家好' }])
    expect(store.messageById('im:43')).toMatchObject({
      direction: 'out',
      conversation_type: 'group',
      conversation_id: 'group:g-1',
      group_id: 'g-1',
      status: 'delivered'
    })
    const events = log.pending(0).filter((e) => e.method === 'message.deliveryStatus')
    expect(events).toHaveLength(1)
    expect(events[0].data).toMatchObject({
      message_id: 'im:43',
      conversation_id: 'group:g-1',
      status: 'delivered'
    })
  })

  it('没有成员可达时写 failed 并带原因，RPC 响应仍是 queued', async () => {
    const { sender, store, log } = setup('sent', true, {
      id: 'g-1',
      status: 'failed',
      reason: '群成员都不在线'
    })
    const result = await sender.sendGroup({
      request_id: requestId(),
      group_id: 'g-1',
      content: { type: 'text', text: '有人吗' }
    })
    expect(result.delivery_status).toBe('queued')
    expect(store.messageById('im:43')?.status).toBe('failed')
    const events = log.pending(0).filter((e) => e.method === 'message.deliveryStatus')
    expect(events[0].data).toMatchObject({ status: 'failed', reason: '群成员都不在线' })
  })

  it('群消息幂等：重复 request_id 只发一次', async () => {
    const { sender, groupCalls } = setup('queued')
    const id = requestId()
    const first = await sender.sendGroup({
      request_id: id,
      group_id: 'g-1',
      content: { type: 'text', text: 'hi' }
    })
    const second = await sender.sendGroup({
      request_id: id,
      group_id: 'g-1',
      content: { type: 'text', text: 'hi' }
    })
    expect(second).toEqual(first)
    expect(groupCalls).toHaveLength(1)
  })

  it('queued 不立即推投递事件', async () => {
    const { sender, store, log } = setup('sent', true, { id: 'g-1', status: 'queued' })
    await sender.sendGroup({
      request_id: requestId(),
      group_id: 'g-1',
      content: { type: 'text', text: 'hi' }
    })
    expect(store.messageById('im:43')?.status).toBe('queued')
    expect(log.pending(0)).toHaveLength(0)
  })
})

describe('MessageSender 图片', () => {
  it('在线图片写 delivered、消费附件并推 deliveryStatus', async () => {
    const { sender, store, log, attachments, imageCalls, dir } = setup('sent')
    const content = makeImage(attachments)
    const result = await sender.sendUser({
      request_id: requestId(),
      protocol_id: PEER,
      content
    })
    expect(result).toEqual({ message_id: 'im:44', accepted: true, delivery_status: 'queued' })
    expect(imageCalls).toHaveLength(1)
    expect(imageCalls[0].path.startsWith(join(dir, 'att'))).toBe(true)
    expect(store.messageById('im:44')?.status).toBe('delivered')
    expect(store.attachment(content.attachment_id)?.state).toBe('consumed')
    const events = log.pending(0).filter((e) => e.method === 'message.deliveryStatus')
    expect(events).toHaveLength(1)
    expect(events[0].data).toMatchObject({ message_id: 'im:44', status: 'delivered' })
  })

  it('离线图片在 peer-ready 后补发成功', async () => {
    const { sender, store, attachments, imageCalls } = setup(
      'sent',
      true,
      { id: 'g-1', status: 'sent' },
      ['queued', 'sent']
    )
    const content = makeImage(attachments)
    await sender.sendUser({ request_id: requestId(), protocol_id: PEER, content })
    expect(store.messageById('im:44')?.status).toBe('queued')

    sender.onBridgeEvent({ kind: 'peer-ready', protocolId: PEER })
    await vi.waitFor(() => expect(imageCalls).toHaveLength(2))
    await vi.waitFor(() => expect(store.messageById('im:44')?.status).toBe('delivered'))
  })

  it('重试 3 次仍 queued 时置 failed 并推原因', async () => {
    vi.useFakeTimers()
    try {
      const { sender, store, log, attachments, imageCalls } = setup(
        'sent',
        true,
        { id: 'g-1', status: 'sent' },
        'queued'
      )
      const content = makeImage(attachments)
      await sender.sendUser({ request_id: requestId(), protocol_id: PEER, content })

      sender.onBridgeEvent({ kind: 'peer-ready', protocolId: PEER })
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000)
      await vi.advanceTimersByTimeAsync(30_000)

      expect(imageCalls).toHaveLength(4)
      expect(store.messageById('im:44')?.status).toBe('failed')
      const events = log.pending(0).filter((e) => e.method === 'message.deliveryStatus')
      expect(events.at(-1)?.data).toMatchObject({ status: 'failed' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('附件与 content 不一致按 -32016 处理', async () => {
    const { sender, attachments } = setup('sent')
    const content = makeImage(attachments)
    try {
      await sender.sendUser({
        request_id: requestId(),
        protocol_id: PEER,
        content: { ...content, size: content.size + 1 }
      })
      throw new Error('应当抛错')
    } catch (error) {
      expect((error as { rpcCode?: number }).rpcCode).toBe(-32016)
    }
  })

  it('image-in 导入附件并推 message.received', () => {
    const { sender, log, dir, attachments } = setup()
    const src = join(dir, 'in.png')
    writeFileSync(src, PNG)
    sender.onBridgeEvent({
      kind: 'image-in',
      imMessageId: 101,
      conversationId: `direct:${PEER}`,
      conversationType: 'private',
      sender: {
        protocolId: PEER,
        username: 'alice',
        displayName: 'Alice',
        hostname: 'DESKTOP-A'
      },
      path: src,
      name: 'in.png',
      mimeType: 'image/png',
      size: PNG.length,
      sha256: sha256Of(PNG),
      timestamp: 1
    })
    const event = log.pending(0).find((e) => e.method === 'message.received')
    expect(event?.data.content).toMatchObject({
      type: 'image',
      mime_type: 'image/png',
      size: PNG.length
    })
    const attachmentId = (event?.data.content as { attachment_id: string }).attachment_id
    expect(attachmentId).toMatch(/^att_[0-9a-f]{16}$/)
    expect(attachments.openDownload(attachmentId)?.size).toBe(PNG.length)
  })
})
