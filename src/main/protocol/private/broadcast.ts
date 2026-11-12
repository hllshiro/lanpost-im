import type { PeerInfo } from '../../../shared/domain'

// 广播/多选只发给在线且私有会话已就绪的联系人，顺序按输入保持稳定。
export function eligibleTargets(
  peers: PeerInfo[],
  ready: (ip: string) => boolean
): PeerInfo[] {
  const seen = new Set<string>()
  const targets: PeerInfo[] = []
  for (const peer of peers) {
    if (!peer.online || !ready(peer.ip) || seen.has(peer.key)) continue
    seen.add(peer.key)
    targets.push(peer)
  }
  return targets
}
