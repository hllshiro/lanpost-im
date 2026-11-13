import type { PeerInfo } from '../../shared/domain'

export interface PeerPresence {
  ready: boolean
  privateUserId: string
}

// 界面看到的在线状态只认私有会话是否就绪，联系人事件与完整快照共用这一份结果
export function applyPresence(peer: PeerInfo, presence: PeerPresence): PeerInfo {
  return {
    ...peer,
    online: presence.ready,
    ready: presence.ready,
    privateUserId: presence.privateUserId
  }
}
