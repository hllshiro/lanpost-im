import { gwError } from './errors'
import type { GatewayBridge, GatewayPeer } from './bridge'

export interface UserListItem {
  protocol_id: string
  username: string
  display_name: string
  hostname: string
  online: boolean
  last_seen_at: string
}

export interface ListUsersResult {
  total: number
  page: number
  page_size: number
  users: UserListItem[]
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

function integerParam(value: unknown, name: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw gwError('INVALID_ARGUMENT', `${name} 必须是整数`)
  }
  return value
}

function toUserItem(peer: GatewayPeer): UserListItem {
  return {
    protocol_id: peer.protocolId,
    username: peer.username,
    display_name: peer.displayName,
    hostname: peer.hostname,
    online: peer.online,
    last_seen_at: new Date(peer.lastSeenAt).toISOString()
  }
}

/** 名册查询：keyword 大小写不敏感地匹配显示名/账号/主机名，online 三态筛选。 */
export function listUsers(
  bridge: Pick<GatewayBridge, 'listPeers'>,
  params: Record<string, unknown>
): ListUsersResult {
  const keyword = params.keyword
  if (keyword !== undefined && typeof keyword !== 'string') {
    throw gwError('INVALID_ARGUMENT', 'keyword 必须是字符串')
  }
  const online = params.online
  if (online !== undefined && online !== null && typeof online !== 'boolean') {
    throw gwError('INVALID_ARGUMENT', 'online 必须是布尔值或 null')
  }
  const page = integerParam(params.page, 'page', 1)
  const pageSize = integerParam(params.page_size, 'page_size', DEFAULT_PAGE_SIZE)
  if (page < 1) throw gwError('INVALID_ARGUMENT', 'page 必须大于等于 1')
  if (pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw gwError('INVALID_ARGUMENT', `page_size 必须在 1..${MAX_PAGE_SIZE}`)
  }

  const needle = (keyword ?? '').toLowerCase()
  const peers = bridge.listPeers().filter((peer) => {
    if (online === true && !peer.online) return false
    if (online === false && peer.online) return false
    if (needle.length === 0) return true
    return [peer.displayName, peer.username, peer.hostname].some((value) =>
      value.toLowerCase().includes(needle)
    )
  })
  peers.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    return b.lastSeenAt - a.lastSeenAt
  })

  const start = (page - 1) * pageSize
  return {
    total: peers.length,
    page,
    page_size: pageSize,
    users: peers.slice(start, start + pageSize).map(toUserItem)
  }
}

export function requirePeer(
  bridge: Pick<GatewayBridge, 'getPeer'>,
  protocolId: string
): GatewayPeer {
  const peer = bridge.getPeer(protocolId)
  if (!peer) throw gwError('USER_NOT_FOUND')
  return peer
}
