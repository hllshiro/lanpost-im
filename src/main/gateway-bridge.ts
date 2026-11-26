import type { PeerInfo } from '../shared/domain'
import { isPrivateUserId } from '../shared/private-id'
import type {
  GatewayBridge,
  GatewayBridgeEvent,
  GatewayGroup,
  GatewayPeer,
  GatewaySendResult
} from './gateway/bridge'

/** 群资料只用网关需要的两个字段，避免把仓储类型带进 gateway-bridge。 */
export interface GatewayGroupRecord {
  id: string
  name: string
}

export interface GatewayMemberRecord {
  userId: string
  name: string
}

/**
 * AppService 提供给 bridge 的最小能力集合。
 * 保持成普通回调，gateway-bridge 本身不 import electron，可以直接单测。
 */
export interface GatewayBridgeHost {
  peers(): PeerInfo[]
  peer(protocolId: string): PeerInfo | null
  groups(): GatewayGroupRecord[]
  group(groupId: string): GatewayGroupRecord | null
  members(groupId: string): GatewayMemberRecord[]
  sendPrivateText(protocolId: string, text: string): GatewaySendResult
  sendGroupText(groupId: string, text: string): GatewaySendResult
  sendPrivateImage(
    protocolId: string,
    path: string,
    name: string,
    mimeType: string,
    reuseMessageId?: number
  ): GatewaySendResult
  sendGroupImage(groupId: string, path: string, name: string, mimeType: string): GatewaySendResult
  subscribe(listener: (event: GatewayBridgeEvent) => void): () => void
}

function toGatewayPeer(peer: PeerInfo): GatewayPeer | null {
  const protocolId = isPrivateUserId(peer.key) ? peer.key : (peer.privateUserId ?? '')
  if (!isPrivateUserId(protocolId)) return null
  return {
    protocolId,
    username: peer.user || peer.name || peer.host,
    displayName: peer.alias || peer.name,
    hostname: peer.host,
    online: peer.online,
    lastSeenAt: peer.lastSeen
  }
}

function toGatewayGroup(group: GatewayGroupRecord, members: GatewayMemberRecord[]): GatewayGroup {
  return {
    id: group.id,
    name: group.name,
    members: members.map((member) => ({ protocolId: member.userId, name: member.name }))
  }
}

/** 把 AppService 的仓储与私有协议发送封装成网关需要的稳定形状。 */
export class AppServiceBridge implements GatewayBridge {
  constructor(private readonly host: GatewayBridgeHost) {}

  listPeers(): GatewayPeer[] {
    const peers: GatewayPeer[] = []
    for (const peer of this.host.peers()) {
      const mapped = toGatewayPeer(peer)
      if (mapped !== null) peers.push(mapped)
    }
    return peers
  }

  getPeer(protocolId: string): GatewayPeer | null {
    if (!isPrivateUserId(protocolId)) return null
    const peer = this.host.peer(protocolId)
    return peer === null ? null : toGatewayPeer(peer)
  }

  listGroups(): GatewayGroup[] {
    return this.host.groups().map((group) => toGatewayGroup(group, this.host.members(group.id)))
  }

  getGroup(groupId: string): GatewayGroup | null {
    const group = this.host.group(groupId)
    return group === null ? null : toGatewayGroup(group, this.host.members(group.id))
  }

  async sendPrivateText(protocolId: string, text: string): Promise<GatewaySendResult> {
    return this.host.sendPrivateText(protocolId, text)
  }

  async sendGroupText(groupId: string, text: string): Promise<GatewaySendResult> {
    return this.host.sendGroupText(groupId, text)
  }

  async sendPrivateImage(
    protocolId: string,
    path: string,
    name: string,
    mimeType: string,
    reuseMessageId?: number
  ): Promise<GatewaySendResult> {
    return this.host.sendPrivateImage(protocolId, path, name, mimeType, reuseMessageId)
  }

  async sendGroupImage(
    groupId: string,
    path: string,
    name: string,
    mimeType: string
  ): Promise<GatewaySendResult> {
    return this.host.sendGroupImage(groupId, path, name, mimeType)
  }

  subscribe(listener: (event: GatewayBridgeEvent) => void): () => void {
    return this.host.subscribe(listener)
  }
}
