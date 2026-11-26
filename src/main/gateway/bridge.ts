/** 网关依赖的业务侧抽象：只使用普通数据，便于用假实现做单测。 */
export interface GatewayPeer {
  protocolId: string
  username: string
  displayName: string
  hostname: string
  online: boolean
  lastSeenAt: number
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
  /** 失败原因，只在 status === 'failed' 时使用。 */
  reason?: string
}

export interface GatewaySender {
  protocolId: string
  username: string
  displayName: string
  hostname: string
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
  /**
   * 发送图片。reuseMessageId 用于离线重试：沿用第一次记录的本地消息，
   * 避免每次重试都在界面上多出一个气泡。
   */
  sendPrivateImage(
    protocolId: string,
    path: string,
    name: string,
    mimeType: string,
    reuseMessageId?: number
  ): Promise<GatewaySendResult>
  sendGroupImage(
    groupId: string,
    path: string,
    name: string,
    mimeType: string
  ): Promise<GatewaySendResult>
  subscribe(listener: (event: GatewayBridgeEvent) => void): () => void
}
