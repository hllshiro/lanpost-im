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
  // 同一联系人可能在多网卡上被看到多个地址，在线判断要看全部地址
  private readonly peerIps = new Map<string, Set<string>>()
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
      this.rememberIp(peer.key, peer.ip)
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

  // 这个联系人被看到过的全部地址，用于跨网卡判断在线状态
  ipsForPeer(key: string): string[] {
    return [...(this.peerIps.get(key) ?? [])]
  }

  private rememberIp(key: string, ip: string): void {
    if (ip === '') return
    const set = this.peerIps.get(key) ?? new Set<string>()
    set.add(ip)
    this.peerIps.set(key, set)
    this.ipIndex.set(ip, key)
  }

  upsertPrivatePeer(input: PrivatePeerInput): PeerInfo {
    const now = Date.now()
    const previousKey = this.ipIndex.get(input.ip)
    // 联系人按私有用户标识识别，地址只用于当前会话；没有标识时才退回地址
    const targetKey = input.userId !== '' ? input.userId : input.ip
    let key = targetKey
    if (previousKey !== undefined && previousKey !== targetKey) {
      const previous = this.peers.get(previousKey)
      if (
        previous !== undefined &&
        input.userId !== '' &&
        (previous.user === '' || previous.user === input.userId)
      ) {
        // 之前按地址识别，或地址记录里已经存着同一个用户号：整条记录换键
        this.peers.delete(previousKey)
        previous.key = targetKey
        this.peers.set(targetKey, previous)
        const ips = this.peerIps.get(previousKey)
        this.peerIps.delete(previousKey)
        if (ips !== undefined) this.peerIps.set(targetKey, ips)
        for (const [address, mapped] of this.ipIndex) {
          if (mapped === previousKey) this.ipIndex.set(address, targetKey)
        }
        this.callbacks.onPeerKeyChanged?.(previousKey, targetKey)
      } else if (previous !== undefined && input.userId === '') {
        // 还没拿到标识时先沿用地址上的记录
        key = previousKey
      } else if (previous !== undefined) {
        // 同一地址换成了另一个用户：这个地址不再属于旧联系人
        this.peerIps.get(previousKey)?.delete(input.ip)
      }
      // 按新的用户标识单独建一条，避免沿用上一个人的资料与头像
    }
    let peer = this.peers.get(key)
    if (peer === undefined) {
      peer = emptyPeer(key, input.ip, input.userId)
      this.peers.set(key, peer)
    }
    if (peer.ip !== input.ip) {
      // 保留旧地址的映射：对端换了网卡时，旧地址上的会话与消息仍要能找到这个联系人
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
    this.rememberIp(key, input.ip)
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
    const ips = this.peerIps.get(currentKey)
    this.peerIps.delete(currentKey)
    if (ips !== undefined) this.peerIps.set(userId, ips)
    for (const [address, mapped] of this.ipIndex) {
      if (mapped === currentKey) this.ipIndex.set(address, userId)
    }
    this.ipIndex.set(ip, userId)
    this.callbacks.onPeerKeyChanged?.(currentKey, userId)
    this.emit()
    return userId
  }

  // 联系人被并入别的联系人后从内存里移除，避免列表继续显示
  forget(key: string): void {
    if (!this.peers.delete(key)) return
    this.peerIps.delete(key)
    for (const [ip, mapped] of this.ipIndex) {
      if (mapped === key) this.ipIndex.delete(ip)
    }
    this.emit()
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

  // 只是收到发现通告：只更新在线与活跃时间，不把会话标记成就绪
  markPrivatePeerSeen(ip: string, userId: string): PeerInfo | null {
    let key = this.ipIndex.get(ip)
    if (key === undefined && userId !== '') {
      const byUser = [...this.peers.values()].find(
        (peer) => peer.key === userId || peer.user === userId
      )
      if (byUser !== undefined) {
        key = byUser.key
        // 多网卡/地址变化时保留原来的主地址，等握手完成再由资料更新
        if (byUser.ip === '') byUser.ip = ip
      }
    }
    if (key === undefined) return null
    const peer = this.peers.get(key)
    if (peer === undefined) return null
    this.rememberIp(key, ip)
    const wasOnline = peer.online
    peer.online = true
    peer.lastSeen = Date.now()
    if (!wasOnline) this.emit()
    return clonePeer(peer)
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
