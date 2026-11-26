import { afterEach, describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../store/db'
import { GatewayStore } from './store'
import { EventLog } from './events'
import { MessageSender } from './messages'
import type { GatewayBridge, GatewayBridgeEvent, GatewaySendResult } from './bridge'

const PEER = 'aaaa1111aaaa1111aaaa1111aaaa1111'

const dbs: DatabaseSync[] = []

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // 已关闭
    }
  }
})

function setup(
  status: GatewaySendResult['status'] = 'sent',
  peerExists = true
): {
  sender: MessageSender
  store: GatewayStore
  log: EventLog
  calls: Array<{ protocolId: string; text: string }>
  emit: (event: GatewayBridgeEvent) => void
} {
  const db = openDatabase(':memory:')
  dbs.push(db)
  const store = new GatewayStore(db)
  const log = new EventLog(store, { retentionHours: 24 })
  const calls: Array<{ protocolId: string; text: string }> = []
  const listeners: Array<(event: GatewayBridgeEvent) => void> = []
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
    listGroups: () => [],
    getGroup: () => null,
    sendPrivateText: async (protocolId, text) => {
      calls.push({ protocolId, text })
      return { imMessageId: 42, nwtMsgId: 7, status }
    },
    sendGroupText: async () => ({ imMessageId: 0, nwtMsgId: 0, status: 'queued' }),
    sendPrivateImage: async () => ({ imMessageId: 0, nwtMsgId: 0, status: 'queued' }),
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
    sender: new MessageSender(bridge, store, log),
    store,
    log,
    calls,
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
