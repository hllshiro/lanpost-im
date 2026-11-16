import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../../shared/domain'
import { openDatabase } from './db'
import { reconcileDirectConversations } from './peer-conversations'
import { createRepositories } from './repositories'

function peer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: 'user-1',
    ip: '10.0.0.1',
    port: 0,
    user: 'user-1',
    host: 'pc',
    name: '昵称',
    group: '',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    corpId: '',
    online: false,
    ready: false,
    lastSeen: 10,
    unread: 0,
    alias: '',
    ...overrides
  }
}

describe('reconcileDirectConversations', () => {
  it('merges a conversation keyed by address into the user id conversation', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    repos.peers.upsert(peer())
    const byIp = repos.conversations.ensureDirect('10.0.0.1', '10.0.0.1')
    const byUser = repos.conversations.ensureDirect('user-1', '昵称')
    repos.messages.insertIncoming(byIp.id, '旧消息', 1)
    repos.messages.insertIncoming(byUser.id, '新消息', 2)
    repos.conversations.touch(byIp.id, 100, 2)
    repos.conversations.touch(byUser.id, 200, 1)

    const merges = reconcileDirectConversations(db)
    expect(merges).toEqual([{ from: byIp.id, to: byUser.id }])

    const conversations = repos.conversations.list()
    expect(conversations).toHaveLength(1)
    expect(conversations[0]).toMatchObject({
      id: 'direct:user-1',
      peerKey: 'user-1',
      unread: 3,
      lastMessageAt: 200
    })
    expect(repos.messages.listAll(byUser.id).map((message) => message.text)).toEqual([
      '旧消息',
      '新消息'
    ])
    db.close()
  })

  it('does nothing when every conversation already uses the current key', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    repos.peers.upsert(peer())
    repos.conversations.ensureDirect('user-1', '昵称')

    expect(reconcileDirectConversations(db)).toEqual([])
    expect(repos.conversations.list()).toHaveLength(1)
    db.close()
  })

  it('matches conversations keyed by the stored user field', () => {
    const db = openDatabase(':memory:')
    const repos = createRepositories(db)
    repos.peers.upsert(peer({ key: 'key-1', user: 'user-1' }))
    const byUser = repos.conversations.ensureDirect('user-1', '昵称')

    const merges = reconcileDirectConversations(db)
    expect(merges).toEqual([{ from: byUser.id, to: 'direct:key-1' }])
    expect(repos.conversations.list().map((conversation) => conversation.id)).toEqual([
      'direct:key-1'
    ])
    db.close()
  })
})
