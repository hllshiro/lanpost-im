/**
 * 网关与 AppService 之间的唯一接口。
 * 网关模块（包括本文件）不得 import electron；业务真相仍在 AppService/仓储。
 */

export interface GatewayPeer {
  protocolId: string
  username: string
  displayName: string
  hostname: string
  online: boolean
  lastSeenAt: number
}

export interface GatewaySender {
  protocolId: string
  username: string
  displayName: string
  hostname: string
}

export interface GatewayGroup {
  id: string
  name: string
  members: Array<{ protocolId: string; name: string }>
}

export interface GatewaySendResult {
  imMessageId: number
  nwtMsgId: number
  status: 'queued' | 'sending' | 'sent' | 'failed'
  /** 仅 status='failed' 时给出，展示给 Agent。 */
  reason?: string
}

export type GatewayBridgeEvent =
  | {
      kind: 'text-in'
      imMessageId: number
      conversationId: string
      conversationType: 'private' | 'group'
      sender: GatewaySender
      text: string
      timestamp: number
    }
  | {
      kind: 'image-in'
      imMessageId: number
      conversationId: string
      conversationType: 'private' | 'group'
      sender: GatewaySender
      path: string
      name: string
      mimeType: string
      size: number
      sha256: string
      timestamp: number
    }
  | { kind: 'delivered'; conversationId: string; nwtMsgId: number }
  | { kind: 'failed'; conversationId: string; nwtMsgId: number; reason: string }
  | { kind: 'peer-ready'; protocolId: string }

export interface GatewayBridge {
  listPeers(): GatewayPeer[]
  getPeer(protocolId: string): GatewayPeer | null
  listGroups(): GatewayGroup[]
  getGroup(groupId: string): GatewayGroup | null
  sendPrivateText(protocolId: string, text: string): Promise<GatewaySendResult>
  sendGroupText(groupId: string, text: string): Promise<GatewaySendResult>
  sendPrivateImage(
    protocolId: string,
    path: string,
    name: string,
    mimeType: string
  ): Promise<GatewaySendResult>
  sendGroupImage(
    groupId: string,
    path: string,
    name: string,
    mimeType: string
  ): Promise<GatewaySendResult>
  subscribe(listener: (event: GatewayBridgeEvent) => void): () => void
}
