import type { PeerInfo } from '../../shared/domain'

export interface PeerPresence {
  online: boolean
  ready: boolean
  privateUserId: string
}

// 界面看到的在线状态由会话是否就绪或发现报文是否新鲜决定，事件与快照共用这一份结果
export function applyPresence(peer: PeerInfo, presence: PeerPresence): PeerInfo {
  return {
    ...peer,
    online: presence.online,
    ready: presence.ready,
    privateUserId: presence.privateUserId
  }
}
