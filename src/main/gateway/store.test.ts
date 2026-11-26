import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../store/db'
import { GatewayStore, type GatewayMessageRow } from './store'

const tempDirs: string[] = []
const open: DatabaseSync[] = []

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-gateway-store-'))
  tempDirs.push(dir)
  return join(dir, 'lanpost.db')
}

function createStore(): GatewayStore {
  const db = openDatabase(tempDb())
  open.push(db)
  return new GatewayStore(db)
}

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('GatewayStore events', () => {
  it('按 sequence 追加并可补发未确认事件', () => {
    const store = createStore()
    const first = store.appendEvent({
      eventId: 'e1',
      method: 'message.received',
      payload: '{}',
      createdAt: 1
    })
    const second = store.appendEvent({
      eventId: 'e2',
      method: 'message.received',
      payload: '{}',
      createdAt: 2
    })
    expect(first).toBe(1)
    expect(second).toBe(2)
    expect(store.pendingEvents(0).map((row) => row.event_id)).toEqual(['e1', 'e2'])
    expect(store.pendingEvents(1).map((row) => row.event_id)).toEqual(['e2'])
  })

  it('ack 后不再补发，重复 ack 幂等', () => {
    const store = createStore()
    store.appendEvent({ eventId: 'e1', method: 'm', payload: '{}', createdAt: 1 })
    store.appendEvent({ eventId: 'e2', method: 'm', payload: '{}', createdAt: 2 })
    expect(store.ackEvent('e1', 1, 10)).toBe(2)
    expect(store.ackedEvent('e1')?.acked_at).toBe(10)
    expect(store.pendingEvents(0).map((row) => row.event_id)).toEqual(['e2'])
    expect(store.ackEvent('e1', 1, 11)).toBe(2)
    expect(store.latestSequence()).toBe(2)
    expect(store.minSequence()).toBe(1)
  })

  it('空表时 minSequence 为 null、latestSequence 为 0', () => {
    const store = createStore()
    expect(store.minSequence()).toBeNull()
    expect(store.latestSequence()).toBe(0)
  })
})

describe('GatewayStore requests', () => {
  it('保存并按 request_id 读回幂等结果', () => {
    const store = createStore()
    expect(store.findRequest('r1')).toBeNull()
    store.saveRequest({
      request_id: 'r1',
      method: 'message.sendUser',
      args_hash: 'abc',
      result: '{"ok":true}',
      created_at: 5
    })
    const row = store.findRequest('r1')
    expect(row?.args_hash).toBe('abc')
    expect(row?.result).toBe('{"ok":true}')
  })
})

describe('GatewayStore attachments', () => {
  const attachment = {
    id: 'a1',
    kind: 'upload' as const,
    mime_type: 'image/png',
    name: 'a.png',
    size: 3,
    sha256: 'x'.repeat(64),
    path: '/tmp/a.png',
    transfer_id: 't1',
    state: 'pending' as const,
    message_id: '',
    created_at: 1,
    expires_at: 100
  }

  it('插入、按 transfer 反查并消费', () => {
    const store = createStore()
    store.insertAttachment(attachment)
    expect(store.attachment('a1')?.kind).toBe('upload')
    expect(store.attachmentByTransfer('t1')?.id).toBe('a1')
    store.markAttachmentConsumed('a1', 'im:1')
    const row = store.attachment('a1')
    expect(row?.state).toBe('consumed')
    expect(row?.message_id).toBe('im:1')
  })

  it('返回已过期附件并可删除', () => {
    const store = createStore()
    store.insertAttachment(attachment)
    store.insertAttachment({ ...attachment, id: 'a2', transfer_id: 't2', expires_at: 5000 })
    expect(store.attachmentsForCleanup(200).map((row) => row.id)).toEqual(['a1'])
    store.deleteAttachment('a1')
    expect(store.attachment('a1')).toBeNull()
  })
})

describe('GatewayStore messages', () => {
  const message: GatewayMessageRow = {
    id: 'im:7',
    direction: 'out',
    conversation_type: 'private',
    conversation_id: 'direct:abc',
    protocol_id: 'peer-1',
    group_id: '',
    im_message_id: 7,
    nwt_msg_id: 99,
    status: 'queued',
    content: '{"type":"text"}',
    created_at: 1,
    updated_at: 1
  }

  it('插入、按 nwt 消息号反查并更新状态', () => {
    const store = createStore()
    store.insertMessage(message)
    expect(store.messageById('im:7')?.nwt_msg_id).toBe(99)
    expect(store.messageByNwt('direct:abc', 99)?.id).toBe('im:7')
    store.setMessageStatus('im:7', 'delivered', 20)
    expect(store.messageById('im:7')?.status).toBe('delivered')
  })

  it('按对端列出待投递消息', () => {
    const store = createStore()
    store.insertMessage(message)
    store.insertMessage({ ...message, id: 'im:8', im_message_id: 8, nwt_msg_id: 100 })
    store.insertMessage({
      ...message,
      id: 'im:9',
      im_message_id: 9,
      nwt_msg_id: 101,
      conversation_id: 'direct:other',
      protocol_id: 'peer-2'
    })
    store.setMessageStatus('im:8', 'delivered', 5)
    expect(store.pendingMessages('peer-1').map((row) => row.id)).toEqual(['im:7'])
  })
})
