import type { PeerInfo } from '../../shared/domain'

// 同一台机器有多个历史联系人时，优先保留当前在线的记录，其次保留带真实用户号的记录
export function chooseMacKeepPeer(
  peers: PeerInfo[],
  online: (peer: PeerInfo) => boolean
): PeerInfo | null {
  if (peers.length === 0) return null
  return [...peers].sort((left, right) => {
    const leftOnline = online(left) ? 1 : 0
    const rightOnline = online(right) ? 1 : 0
    if (leftOnline !== rightOnline) return rightOnline - leftOnline
    const leftReal = left.user !== '' && left.key === left.user ? 1 : 0
    const rightReal = right.user !== '' && right.key === right.user ? 1 : 0
    if (leftReal !== rightReal) return rightReal - leftReal
    return right.lastSeen - left.lastSeen
  })[0]
}
