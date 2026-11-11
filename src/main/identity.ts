import { createHash } from 'node:crypto'
import { hostname } from 'node:os'
import type { Settings } from '../shared/settings'

const SAFE_NAME = /[^a-zA-Z0-9._-]+/g
const EDGE_DASHES = /^[-._]+|[-._]+$/g
const DUPLICATE_DASHES = /-{2,}/g
const FALLBACK_PREFIX = 'lanpost-'
const FALLBACK_RANGE = 10000
const DISPLAY_MAX = 32
const ACCOUNT_MAX = 32
const HOST_MAX = 64
const PRIVATE_ID_BYTES = 16
const PRIVATE_ID_HEX = 32

export interface IdentityDefaults {
  displayName: string
  account: string
  hostName: string
}

function sanitize(value: string): string {
  return value
    .trim()
    .replaceAll(SAFE_NAME, '-')
    .replaceAll(DUPLICATE_DASHES, '-')
    .replaceAll(EDGE_DASHES, '')
}

function fallbackName(random: () => number): string {
  const value = Math.floor(random() * FALLBACK_RANGE)
  return `${FALLBACK_PREFIX}${String(value).padStart(4, '0')}`
}

// 显示名称、协议账号与主机名默认都取当前计算机名，避免同网段内使用相同写死值；
// 计算机名不可用或清洗后为空时退回到 lanpost- 加四位随机数。
export function identityFromComputerName(
  computerName: string | null | undefined,
  random: () => number = Math.random
): IdentityDefaults {
  const displayBase = sanitize(computerName ?? '')
  const protocolBase = displayBase.toLowerCase()
  const base = protocolBase === '' ? fallbackName(random) : protocolBase
  return {
    displayName: (displayBase === '' ? base : displayBase).slice(0, DISPLAY_MAX),
    account: base.slice(0, ACCOUNT_MAX),
    hostName: base.slice(0, HOST_MAX)
  }
}

export function currentIdentityDefaults(random: () => number = Math.random): IdentityDefaults {
  try {
    return identityFromComputerName(hostname(), random)
  } catch {
    return identityFromComputerName('', random)
  }
}

// 私有通道的用户标识是 32 位十六进制，首次启动生成后写进设置固定下来。
export function createPrivateId(random: () => number = Math.random): string {
  let id = ''
  for (let index = 0; index < PRIVATE_ID_BYTES; index += 1) {
    id += Math.floor(random() * 256)
      .toString(16)
      .padStart(2, '0')
  }
  return id
}

export function privateUserId(settings: Settings): string {
  const stored = settings.identity.privateId
  if (stored !== '') {
    return stored
  }
  return createHash('sha256')
    .update(`${settings.identity.account}@${settings.identity.hostName}`)
    .digest('hex')
    .slice(0, PRIVATE_ID_HEX)
}
