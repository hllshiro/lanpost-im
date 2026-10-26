import type { PeerInfo } from '../../../shared/domain'
import { comparePinyin } from './pinyin'

export interface PeerGroup {
  group: string
  peers: PeerInfo[]
}

export const UNGROUPED = '未分组'

export function displayName(peer: PeerInfo): string {
  return peer.alias.trim() || peer.name || peer.user || peer.ip
}

// 联系人页按 IPMSG 的 group 字段分区；未分组固定放在最后。
export function groupPeers(peers: PeerInfo[]): PeerGroup[] {
  const buckets = new Map<string, PeerInfo[]>()
  for (const peer of peers) {
    const group = peer.group.trim() || UNGROUPED
    const bucket = buckets.get(group)
    if (bucket === undefined) buckets.set(group, [peer])
    else bucket.push(peer)
  }
  const groups = [...buckets.entries()].map(([group, items]) => ({
    group,
    peers: items.sort((left, right) => comparePinyin(displayName(left), displayName(right)))
  }))
  return groups.sort((left, right) => {
    if (left.group === UNGROUPED) return 1
    if (right.group === UNGROUPED) return -1
    return comparePinyin(left.group, right.group)
  })
}
