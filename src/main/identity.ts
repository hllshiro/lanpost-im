import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
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

function validHardwareUuid(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.length >= 8 &&
    !/^0+$/.test(normalized.replaceAll('-', '')) &&
    !normalized.includes('ffffffff-ffff-ffff-ffff-ffffffffffff')
  )
}

export function readHardwareUuid(): string {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          '(Get-CimInstance Win32_ComputerSystemProduct).UUID'
        ],
        { encoding: 'utf8', timeout: 2500, stdio: ['ignore', 'pipe', 'ignore'] }
      )
      if (validHardwareUuid(output)) return output.trim().toLowerCase()
    } else if (process.platform === 'linux') {
      for (const file of ['/sys/class/dmi/id/product_uuid', '/etc/machine-id']) {
        try {
          const output = readFileSync(file, 'utf8')
          if (validHardwareUuid(output)) return output.trim().toLowerCase()
        } catch {
          // 尝试下一个来源。
        }
      }
    } else if (process.platform === 'darwin') {
      const output = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
        timeout: 1500,
        stdio: ['ignore', 'pipe', 'ignore']
      })
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/)
      if (match !== null && validHardwareUuid(match[1])) return match[1].toLowerCase()
    }
  } catch {
    // 硬件信息不可用时回退到持久化随机 ID。
  }
  return ''
}

export function deriveIdentityId(account: string, hardwareUuid = readHardwareUuid()): string {
  const normalizedAccount = account.trim().toLowerCase()
  if (hardwareUuid.trim() === '') {
    return createHash('sha256')
      .update(`lanpost-random-v1|${randomUUID()}`)
      .digest('hex')
      .slice(0, 32)
  }
  return createHash('sha256')
    .update(`lanpost-identity-v1|${hardwareUuid.trim().toLowerCase()}|${normalizedAccount}`)
    .digest('hex')
    .slice(0, 32)
}

export function currentIdentityId(account: string, existing = ''): string {
  if (existing.trim() !== '') return existing.trim()
  return deriveIdentityId(account)
}
