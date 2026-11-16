import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MAC_PATTERN = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/

export function normalizeMac(value: string): string {
  const hex = value.toLowerCase().replace(/[^0-9a-f]/g, '')
  if (hex.length !== 12) return ''
  if (hex === '000000000000' || hex === 'ffffffffffff') return ''
  // 组播地址的第 0 位是 1，不是网卡地址
  if ((Number.parseInt(hex.slice(0, 2), 16) & 1) === 1) return ''
  return hex.match(/../g)!.join(':')
}

// 从 arp / ip neigh 的输出里找指定地址那一行的 MAC
export function parseMac(output: string, ip: string): string {
  for (const line of output.split(/\r?\n/)) {
    if (!line.includes(ip)) continue
    const match = line.match(MAC_PATTERN)
    if (match === null) continue
    const mac = normalizeMac(match[0])
    if (mac !== '') return mac
  }
  return ''
}

function localMac(ip: string): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && entry.address === ip) {
        return normalizeMac(entry.mac)
      }
    }
  }
  return ''
}

// 一次解析整张邻居表，刷新大量联系人时不用为每个地址起一个进程
export function parseMacTable(output: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const ip = line.match(IPV4_PATTERN)?.[0]
    const macMatch = line.match(MAC_PATTERN)
    if (ip === undefined || macMatch === null) continue
    const mac = normalizeMac(macMatch[0])
    if (mac === '') continue
    result.set(ip, mac)
  }
  return result
}

export async function lookupMacTable(localIp: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue
      const mac = normalizeMac(entry.mac)
      if (mac !== '') result.set(entry.address, mac)
    }
  }
  if (localIp !== '' && !result.has(localIp)) {
    const mac = localMac(localIp)
    if (mac !== '') result.set(localIp, mac)
  }
  try {
    const output =
      process.platform === 'win32'
        ? await commandOutput('arp', ['-a'])
        : await commandOutput('ip', ['neigh', 'show'])
    for (const [ip, mac] of parseMacTable(output)) {
      result.set(ip, mac)
    }
  } catch {
    // 没有 arp/ip 命令时只保留本机网卡
  }
  return result
}

async function commandOutput(command: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    timeout: 2000,
    windowsHide: true,
    encoding: 'utf8'
  })
  return stdout
}

export async function lookupMac(ip: string, localIp: string): Promise<string> {
  if (ip === '') return ''
  if (ip === localIp) return localMac(ip)
  try {
    const output =
      process.platform === 'win32'
        ? await commandOutput('arp', ['-a', ip])
        : await commandOutput('ip', ['neigh', 'show', ip])
    const mac = parseMac(output, ip)
    if (mac !== '') return mac
  } catch {
    // 命令不可用时再试一次旧版 arp
  }
  try {
    const output =
      process.platform === 'win32'
        ? await commandOutput('arp', ['-a'])
        : await commandOutput('arp', ['-n', ip])
    return parseMac(output, ip)
  } catch {
    return ''
  }
}
