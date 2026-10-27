import { describe, expect, it } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import type { FileTaskInfo, PeerInfo } from '../../../src/shared/domain'
import { openDatabase } from '../../../src/main/store/db'
import {
  ConversationRepository,
  FileRepository,
  MessageRepository,
  PeerRepository
} from '../../../src/main/store/repositories'

function openMemory(): DatabaseSync {
  return openDatabase(':memory:')
}

function makePeer(key: string, overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key,
    ip: '10.0.0.1',
    port: 2425,
    user: key.split('|')[1] ?? key,
    host: 'lanpost-pc',
    name: '爱丽丝',
    group: '',
    status: 0,
    identityId: '',
    clientType: 'unknown',
    online: false,
    lastSeen: 0,
    unread: 0,
    alias: '',
    capUtf8: false,
    capFile: false,
    capClipboard: false,
    dialup: false,
    versionInfo: '',
    absenceInfo: '',
    ...overrides
  }
}

function makeFile(
  id: string,
  conversationId: string,
  overrides: Partial<FileTaskInfo> = {}
): FileTaskInfo {
  return {
    id,
    messageId: null,
    conversationId,
    direction: 'in',
    kind: 'file',
    name: '报告.pdf',
    size: 1024,
    mtime: 1700000000000,
    fileId: 'file-1',
    packetId: 7,
    path: '',
    state: 'waiting',
    received: 0,
    entryCount: 0,
    completedCount: 0,
    error: '',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides
  }
}

describe('ConversationRepository', () => {
  it('creates a direct conversation once and keeps its title', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)

    const created = conversations.ensureDirect('10.0.0.1|alice', '爱丽丝')
    expect(created.id).toBe('direct:10.0.0.1|alice')
    expect(created.kind).toBe('direct')
    expect(created.peerKey).toBe('10.0.0.1|alice')
    expect(created.title).toBe('爱丽丝')
    expect(created.unread).toBe(0)
    expect(created.draft).toBe('')
    expect(created.lastReadMessageId).toBe(0)

    const again = conversations.ensureDirect('10.0.0.1|alice', '另一个名字')
    expect(again.id).toBe(created.id)
    expect(again.title).toBe('爱丽丝')
    expect(conversations.list()).toHaveLength(1)
    expect(conversations.get('missing')).toBeNull()

    db.close()
  })

  it('orders conversations by pinned then last message time', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const first = conversations.ensureDirect('1|a', '甲')
    const second = conversations.ensureDirect('1|b', '乙')
    const third = conversations.ensureDirect('1|c', '丙')

    conversations.touch(first.id, 100, 0)
    conversations.touch(second.id, 300, 0)
    conversations.touch(third.id, 200, 0)
    expect(conversations.list().map((item) => item.id)).toEqual([second.id, third.id, first.id])

    conversations.setPinned(first.id, true)
    expect(conversations.list().map((item) => item.id)).toEqual([first.id, second.id, third.id])

    conversations.setPinned(first.id, false)
    conversations.setMuted(second.id, true)
    const muted = conversations.get(second.id)
    expect(muted?.pinned).toBe(false)
    expect(muted?.muted).toBe(true)

    conversations.saveDraft(third.id, '还没发出去的字')
    expect(conversations.get(third.id)?.draft).toBe('还没发出去的字')

    conversations.setTitle(third.id, '丙的新名字')
    expect(conversations.get(third.id)?.title).toBe('丙的新名字')

    db.close()
  })

  it('clears unread and records the last read message', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const messages = new MessageRepository(db)
    const conversation = conversations.ensureDirect('1|a', '甲')

    const first = messages.insertIncoming(conversation.id, '第一条', 1)
    const second = messages.insertIncoming(conversation.id, '第二条', 2)
    conversations.touch(conversation.id, 100, 2)
    expect(conversations.get(conversation.id)?.unread).toBe(2)

    conversations.markRead(conversation.id, second.id)
    const read = conversations.get(conversation.id)
    expect(read?.unread).toBe(0)
    expect(read?.lastReadMessageId).toBe(second.id)
    expect(read?.lastReadMessageId).toBeGreaterThan(first.id)

    conversations.touch(conversation.id, 200, -5)
    expect(conversations.get(conversation.id)?.unread).toBe(0)

    db.close()
  })
})

describe('MessageRepository', () => {
  it('pages newest first from the database and returns oldest to newest', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const messages = new MessageRepository(db)
    const conversation = conversations.ensureDirect('1|a', '甲')

    const inserted = [
      messages.insertIncoming(conversation.id, '一', 1),
      messages.insertOutgoing(conversation.id, '二', 2),
      messages.insertIncoming(conversation.id, '三', 3),
      messages.insertOutgoing(conversation.id, '四', 4),
      messages.insertIncoming(conversation.id, '五', 5)
    ]

    const latest = messages.list(conversation.id, undefined, 2)
    expect(latest.messages.map((message) => message.id)).toEqual([inserted[3].id, inserted[4].id])
    expect(latest.hasMore).toBe(true)

    const middle = messages.list(conversation.id, inserted[3].id, 2)
    expect(middle.messages.map((message) => message.id)).toEqual([inserted[1].id, inserted[2].id])
    expect(middle.hasMore).toBe(true)

    const oldest = messages.list(conversation.id, inserted[1].id, 2)
    expect(oldest.messages.map((message) => message.id)).toEqual([inserted[0].id])
    expect(oldest.hasMore).toBe(false)

    expect(messages.list(conversation.id)).toMatchObject({ hasMore: false })
    expect(messages.list(conversation.id).messages).toHaveLength(5)
    expect(messages.list('missing').messages).toEqual([])

    db.close()
  })

  it('maps directions, statuses and metadata', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const messages = new MessageRepository(db)
    const conversation = conversations.ensureDirect('1|a', '甲')

    const incoming = messages.insertIncoming(conversation.id, '收到文件', 42, 'file', {
      files: ['f1']
    })
    expect(incoming).toMatchObject({
      conversationId: conversation.id,
      direction: 'in',
      kind: 'file',
      text: '收到文件',
      remoteSeq: 42,
      status: 'delivered',
      meta: { files: ['f1'] }
    })

    const outgoing = messages.insertOutgoing(conversation.id, '发出', 0)
    expect(outgoing).toMatchObject({
      direction: 'out',
      kind: 'text',
      status: 'sending',
      meta: {},
      remoteSeq: 0
    })
    expect(outgoing.createdAt).toBeGreaterThan(0)

    messages.setStatus(outgoing.id, 'sent')
    messages.setRemoteSeq(outgoing.id, 43)
    const updated = messages.getMessage(outgoing.id)
    expect(updated?.status).toBe('sent')
    expect(updated?.remoteSeq).toBe(43)
    expect(messages.getMessage(9999)).toBeNull()

    db.close()
  })
})

describe('PeerRepository', () => {
  it('preserves the local alias while refreshing peer details', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const peers = new PeerRepository(db)
    const conversation = conversations.ensureDirect('10.0.0.1|alice', '爱丽丝')
    conversations.touch(conversation.id, 100, 3)

    peers.upsert(makePeer('10.0.0.1|alice', { group: '研发部', alias: '初次别名' }))
    peers.setAlias('10.0.0.1|alice', '老爱')

    peers.upsert(
      makePeer('10.0.0.1|alice', {
        ip: '10.0.0.9',
        name: 'Alice',
        group: '测试部',
        online: true,
        capUtf8: true,
        capFile: true,
        lastSeen: 50,
        alias: '对方覆盖别名'
      })
    )

    const stored = peers.get('10.0.0.1|alice')
    expect(stored).toMatchObject({
      key: '10.0.0.1|alice',
      ip: '10.0.0.9',
      name: 'Alice',
      group: '测试部',
      online: true,
      capUtf8: true,
      capFile: true,
      lastSeen: 50,
      unread: 3,
      alias: '老爱'
    })

    peers.markAllOffline()
    expect(peers.get('10.0.0.1|alice')?.online).toBe(false)
    peers.setOnline('10.0.0.1|alice', false, 60)
    const offline = peers.get('10.0.0.1|alice')
    expect(offline?.online).toBe(false)
    expect(offline?.lastSeen).toBe(60)

    expect(peers.list()).toHaveLength(1)
    expect(peers.get('missing')).toBeNull()

    db.close()
  })

  it('lists peers sorted by display name', () => {
    const db = openMemory()
    const peers = new PeerRepository(db)
    peers.upsert(makePeer('2|bob', { name: '鲍勃' }))
    peers.upsert(makePeer('1|alice', { name: '爱丽丝' }))

    expect(peers.list().map((peer) => peer.key)).toEqual(['1|alice', '2|bob'])

    db.close()
  })
})

describe('FileRepository', () => {
  it('stores tasks and updates transfer state', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const messages = new MessageRepository(db)
    const files = new FileRepository(db)
    const conversation = conversations.ensureDirect('1|a', '甲')
    const message = messages.insertIncoming(conversation.id, '文件来了', 1, 'file')
    const other = conversations.ensureDirect('1|b', '乙')

    files.upsert(makeFile('in-1', conversation.id, { messageId: message.id }))
    files.upsert(
      makeFile('out-1', other.id, {
        direction: 'out',
        name: '照片.png',
        state: 'offered',
        createdAt: 1700000001000,
        updatedAt: 1700000001000
      })
    )

    expect(files.get('in-1')).toMatchObject({
      messageId: message.id,
      conversationId: conversation.id,
      direction: 'in',
      state: 'waiting',
      received: 0
    })
    expect(files.get('missing')).toBeNull()
    expect(files.list(conversation.id).map((task) => task.id)).toEqual(['in-1'])
    expect(files.list().map((task) => task.id)).toEqual(['in-1', 'out-1'])

    files.updateState('in-1', 'transferring', 512, '')
    expect(files.get('in-1')).toMatchObject({ state: 'transferring', received: 512, path: '' })

    files.updateState('in-1', 'done', 1024, '', 'C:/recv/报告.pdf')
    const done = files.get('in-1')
    expect(done).toMatchObject({
      state: 'done',
      received: 1024,
      error: '',
      path: 'C:/recv/报告.pdf'
    })

    files.updateState('in-1', 'failed', 1024, '连接中断')
    expect(files.get('in-1')).toMatchObject({
      state: 'failed',
      error: '连接中断',
      path: 'C:/recv/报告.pdf'
    })

    db.close()
  })
})

describe('ConversationRepository identity reuse', () => {
  it('reuses the conversation when the same identity changes peer key', () => {
    const db = openMemory()
    const conversations = new ConversationRepository(db)
    const first = conversations.ensureDirect('10.0.0.1|alice', 'Alice', 'identity-a')
    const second = conversations.ensureDirect('10.0.0.2|alice2', 'Alice', 'identity-a')
    expect(second.id).toBe(first.id)
    expect(second.peerKey).toBe('10.0.0.2|alice2')
    expect(conversations.list()).toHaveLength(1)
  })
})

describe('PeerRepository identity dedupe', () => {
  it('keeps one visible peer per identity and inherits aliases', () => {
    const db = openMemory()
    const peers = new PeerRepository(db)
    peers.upsert(
      makePeer('10.0.0.1|alice', {
        identityId: 'identity-a',
        alias: '老备注',
        online: false,
        lastSeen: 10
      })
    )
    peers.upsert(
      makePeer('10.0.0.2|alice', {
        identityId: 'identity-a',
        online: true,
        lastSeen: 20
      })
    )
    const list = peers.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ key: '10.0.0.2|alice', alias: '老备注', online: true })
  })
})
