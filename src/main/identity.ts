import { hostname } from 'node:os'

const SAFE_NAME = /[^a-zA-Z0-9._-]+/g
const EDGE_DASHES = /^[-._]+|[-._]+$/g
const DUPLICATE_DASHES = /-{2,}/g
const FALLBACK_PREFIX = 'lanpost-'
const FALLBACK_RANGE = 10000
const DISPLAY_MAX = 32
const ACCOUNT_MAX = 32
const HOST_MAX = 64

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
