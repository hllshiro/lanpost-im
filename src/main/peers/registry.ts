import type { PeerInfo } from '../../shared/domain'

export interface PrivatePeerInput {
  ip: string
  userId: string
  name: string
  group: string
  corporation: string
  department: string
  sign: string
  status: number
  online: boolean
}

export interface PeerRegistryCallbacks {
  onPeers(peers: PeerInfo[]): void
  // 联系人从按地址识别变成按用户标识识别时通知调用方改名历史数据
  onPeerKeyChanged?: (from: string, to: string) => void
}

function emptyPeer(key: string, ip: string, userId: string): PeerInfo {
  return {
    key,
    ip,
    port: 0,
    user: userId,
    host: '',
    name: userId !== '' ? userId : ip,
    group: '',
    corporation: '',
    department: '',
    sign: '',
    status: 0,
    corpId: '',
    online: false,
    ready: false,
    lastSeen: 0,
    unread: 0,
    alias: ''
  }
}

function clonePeer(peer: PeerInfo): PeerInfo {
  return { ...peer }
}

/**
 * 私有协议唯一的联系人状态源，只接收 PrivateService 的会话/资料回调。
 */
export class PeerRegistry {
  private readonly peers = new Map<string, PeerInfo>()
  private readonly ipIndex = new Map<string, string>()
  private readonly callbacks: PeerRegistryCallbacks

  constructor(seed: PeerInfo[], callbacks: PeerRegistryCallbacks) {
    this.callbacks = callbacks
    // 同一地址只保留最近一次出现的 key，跨重启沿用旧会话键，避免历史记录被拆成两条。
    const latest = new Map<string, { key: string; lastSeen: number }>()
    for (const peer of seed) {
      if (peer.ip === '' || peer.key === '') continue
      const previous = latest.get(peer.ip)
      if (previous === undefined || peer.lastSeen > previous.lastSeen) {
        latest.set(peer.ip, { key: peer.key, lastSeen: peer.lastSeen })
      }
    }
    for (const peer of seed) {
      if (peer.ip === '' || peer.key === '') continue
      this.peers.set(peer.key, { ...peer, online: false, ready: false, port: 0 })
    }
    for (const [ip, entry] of latest) {
      this.ipIndex.set(ip, entry.key)
    }
  }

  getPeers(): PeerInfo[] {
    return [...this.peers.values()].map(clonePeer)
  }

  peerKeyForIp(ip: string): string | null {
    return this.ipIndex.get(ip) ?? null
  }

  upsertPrivatePeer(input: PrivatePeerInput): PeerInfo {
    const now = Date.now()
    const previousKey = this.ipIndex.get(input.ip)
    // 联系人按私有用户标识识别，地址只用于当前会话；没有标识时才退回地址
    const targetKey = input.userId !== '' ? input.userId : input.ip
    let key = targetKey
    if (previousKey !== undefined && previousKey !== targetKey) {
      const previous = this.peers.get(previousKey)
      if (previous !== undefined && input.userId !== '' && previous.user === '') {
        this.peers.delete(previousKey)
        previous.key = targetKey
        this.peers.set(targetKey, previous)
        this.callbacks.onPeerKeyChanged?.(previousKey, targetKey)
      } else {
        key = previousKey
      }
    }
    let peer = this.peers.get(key)
    if (peer === undefined) {
      peer = emptyPeer(key, input.ip, input.userId)
      this.peers.set(key, peer)
    }
    if (peer.ip !== input.ip) {
      this.ipIndex.delete(peer.ip)
      peer.ip = input.ip
    }
    peer.port = 0
    peer.user = input.userId !== '' ? input.userId : peer.user
    peer.name = input.name !== '' ? input.name : peer.name
    peer.group = input.group
    peer.corporation = input.corporation
    peer.department = input.department
    peer.sign = input.sign
    peer.status = input.status
    peer.online = input.online
    peer.ready = input.online
    peer.lastSeen = now
    this.ipIndex.set(input.ip, key)
    this.emit()
    return clonePeer(peer)
  }

  // 握手完成后服务端会单独告知对端用户号，此时把按地址命名的联系人改成用户标识
  assignUserId(ip: string, userId: string): string | null {
    const currentKey = this.ipIndex.get(ip)
    if (currentKey === undefined) return null
    if (userId === '' || currentKey === userId) {
      const peer = this.peers.get(currentKey)
      if (peer !== undefined && userId !== '') peer.user = userId
      return currentKey
    }
    const peer = this.peers.get(currentKey)
    if (peer === undefined) return null
    this.peers.delete(currentKey)
    peer.key = userId
    peer.user = userId
    this.peers.set(userId, peer)
    this.ipIndex.set(ip, userId)
    this.callbacks.onPeerKeyChanged?.(currentKey, userId)
    this.emit()
    return userId
  }

  touchPrivatePeer(ip: string): void {
    const key = this.ipIndex.get(ip)
    if (key === undefined) return
    const peer = this.peers.get(key)
    if (peer === undefined) return
    const wasOnline = peer.online
    peer.lastSeen = Date.now()
    peer.online = true
    peer.ready = true
    if (!wasOnline) this.emit()
  }

  markPrivatePeerOffline(ip: string): void {
    const key = this.ipIndex.get(ip)
    if (key === undefined) return
    const peer = this.peers.get(key)
    if (peer === undefined) return
    if (!peer.online && !peer.ready) return
    peer.online = false
    peer.ready = false
    this.emit()
  }

  private emit(): void {
    this.callbacks.onPeers(this.getPeers())
  }
}
