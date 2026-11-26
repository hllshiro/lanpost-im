import { describe, expect, it } from 'vitest'
import type { PeerInfo } from '../shared/domain'
import type { GatewayBridgeEvent, GatewaySendResult } from './gateway/bridge'
import { AppServiceBridge } from './gateway-bridge'
import type { GatewayBridgeHost, GatewayGroupRecord, GatewayMemberRecord } from './gateway-bridge'

const PEER_ID = 'aaaa1111aaaa1111aaaa1111aaaa1111'
const OTHER_ID = 'bbbb2222bbbb2222bbbb2222bbbb2222'

function peer(overrides: Partial<PeerInfo> = {}): PeerInfo {
  return {
    key: PEER_ID,
    ip: '192.168.1.10',
    port: 2425,
    user: 'alice',
    host: 'DESKTOP-A',
    name: 'Alice',
    group: '',
    corporation: '',
    department: '',
    sign: '',
    status: 1,
    corpId: '',
    online: true,
    ready: true,
    lastSeen: 1_700_000_000_000,
    unread: 0,
    alias: '',
    privateUserId: PEER_ID,
    ...overrides
  }
}

const GROUP: GatewayGroupRecord = { id: 'g1', name: '测试群' }
const MEMBERS: GatewayMemberRecord[] = [
  { userId: PEER_ID, name: 'Alice' },
  { userId: OTHER_ID, name: 'Bob' }
]

interface FakeHost extends GatewayBridgeHost {
  sent: Array<{ kind: string; target: string; text?: string; reuse?: number }>
  fire: (event: GatewayBridgeEvent) => void
}

function fakeHost(
  result: GatewaySendResult = { imMessageId: 7, nwtMsgId: 3, status: 'sent' }
): FakeHost {
  const listeners = new Set<(event: GatewayBridgeEvent) => void>()
  const host: FakeHost = {
    sent: [],
    peers: () => [
      peer(),
      peer({ key: OTHER_ID, user: 'bob', name: 'Bob', alias: '小博', online: false })
    ],
    peer: (protocolId) =>
      protocolId === PEER_ID
        ? peer()
        : protocolId === OTHER_ID
          ? peer({ key: OTHER_ID, user: 'bob', name: 'Bob', alias: '小博', online: false })
          : null,
    groups: () => [GROUP],
    group: (groupId) => (groupId === 'g1' ? GROUP : null),
    members: (groupId) => (groupId === 'g1' ? MEMBERS : []),
    sendPrivateText: (target, text) => {
      host.sent.push({ kind: 'private-text', target, text })
      return result
    },
    sendGroupText: (target, text) => {
      host.sent.push({ kind: 'group-text', target, text })
      return result
    },
    sendPrivateImage: (target, _path, _name, _mime, reuse) => {
      host.sent.push({ kind: 'private-image', target, reuse })
      return result
    },
    sendGroupImage: (target) => {
      host.sent.push({ kind: 'group-image', target })
      return result
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    fire: (event) => {
      for (const listener of listeners) listener(event)
    }
  }
  return host
}

describe('AppServiceBridge', () => {
  it('只映射有私有用户号的联系人，别名优先、lastSeen 透传', () => {
    const bridge = new AppServiceBridge(fakeHost())
    const peers = bridge.listPeers()
    expect(peers).toHaveLength(2)
    expect(peers[0]).toMatchObject({
      protocolId: PEER_ID,
      username: 'alice',
      displayName: 'Alice',
      hostname: 'DESKTOP-A',
      online: true,
      lastSeenAt: 1_700_000_000_000
    })
    expect(peers[1]).toMatchObject({ displayName: '小博', online: false })
    expect(bridge.getPeer('not-a-user-id')).toBeNull()
  })

  it('联系人没有私有用户号时不进入名册', () => {
    const host = fakeHost()
    host.peers = () => [peer({ key: 'legacy', privateUserId: undefined })]
    const bridge = new AppServiceBridge(host)
    expect(bridge.listPeers()).toEqual([])
  })

  it('群成员映射为 protocolId + name', () => {
    const bridge = new AppServiceBridge(fakeHost())
    expect(bridge.getGroup('g1')).toEqual({
      id: 'g1',
      name: '测试群',
      members: [
        { protocolId: PEER_ID, name: 'Alice' },
        { protocolId: OTHER_ID, name: 'Bob' }
      ]
    })
    expect(bridge.getGroup('nope')).toBeNull()
  })

  it('发送调用透传到 host，并支持图片重试复用消息号', async () => {
    const host = fakeHost({ imMessageId: 9, nwtMsgId: 4, status: 'queued' })
    const bridge = new AppServiceBridge(host)
    await expect(bridge.sendPrivateText(PEER_ID, '你好')).resolves.toMatchObject({
      status: 'queued'
    })
    await bridge.sendGroupText('g1', '大家好')
    await bridge.sendPrivateImage(PEER_ID, 'C:/tmp/a.png', 'a.png', 'image/png', 12)
    expect(host.sent).toEqual([
      { kind: 'private-text', target: PEER_ID, text: '你好' },
      { kind: 'group-text', target: 'g1', text: '大家好' },
      { kind: 'private-image', target: PEER_ID, reuse: 12 }
    ])
  })

  it('订阅后收到事件，退订后不再收到', () => {
    const host = fakeHost()
    const bridge = new AppServiceBridge(host)
    const seen: GatewayBridgeEvent[] = []
    const stop = bridge.subscribe((event) => seen.push(event))
    host.fire({ kind: 'delivered', conversationId: `direct:${PEER_ID}`, nwtMsgId: 3 })
    expect(seen).toHaveLength(1)
    stop()
    host.fire({ kind: 'peer-ready', protocolId: PEER_ID })
    expect(seen).toHaveLength(1)
  })
})
