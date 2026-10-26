import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import type { FirewallState, FirewallStatus } from '../shared/ipc'

const execFileAsync = promisify(execFile)

const POWERSHELL = 'powershell.exe'
const LINUX_STATE_DIR = '/var/lib/lanpost-im'
const LINUX_STATE_FILE = `${LINUX_STATE_DIR}/firewall-ports`

const CHECK_SCRIPT = `
$ErrorActionPreference = 'Stop'
$fw = New-Object -ComObject HNetCfg.FwPolicy2
$path = $env:LANPOST_EXE
$active = [int]$fw.CurrentProfileTypes
$inbound = @($fw.Rules | Where-Object { $_.ApplicationName -eq $path -and $_.Direction -eq 1 })
$blocked = @($inbound | Where-Object { $_.Action -eq 0 -and (($_.Profiles -band $active) -ne 0) })
$allowed = @($inbound | Where-Object { $_.Action -eq 1 -and (($_.Profiles -band $active) -ne 0) })
if ($blocked.Count -gt 0) {
  $state = 'blocked'
} elseif ($allowed.Count -gt 0) {
  $state = 'allowed'
} else {
  $state = 'missing'
}
[pscustomobject]@{ state = $state; activeProfiles = $active; rules = $inbound.Count } | ConvertTo-Json -Compress
`

const REPAIR_SCRIPT = (executable: string, ruleName: string): string => `
$ErrorActionPreference = 'Stop'
$path = '${executable.replace(/'/g, "''")}'
$netsh = Join-Path $env:SystemRoot 'System32\\netsh.exe'
& $netsh advfirewall firewall delete rule name=all program="$path" dir=in | Out-Null
& $netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow program="$path" enable=yes profile=any | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "netsh failed with exit code $LASTEXITCODE"
}
`

interface CheckOutput {
  state?: string
  activeProfiles?: number
  rules?: number
}

type LinuxBackend = 'ufw' | 'firewalld'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function ruleNameOf(executable: string): string {
  return basename(executable).toLowerCase() === 'electron.exe' ? 'lanpost-im-dev' : 'lanpost-im'
}

function detailOf(state: FirewallState): string {
  switch (state) {
    case 'allowed':
      return '已放行来自局域网的入站连接'
    case 'blocked':
      return '存在阻止规则，其他设备可能无法连接到本机'
    case 'missing':
      return '尚未添加入站放行规则，其他设备可能无法连接到本机'
    case 'manual':
      return '需要手动确认防火墙放行规则'
    case 'unsupported':
      return '仅 Windows 需要配置防火墙'
    default:
      return '无法读取防火墙状态'
  }
}

function normalizedPort(port: number): number | null {
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null
}

function linuxBackendLabel(backend: LinuxBackend): string {
  return backend === 'ufw' ? 'ufw' : 'firewalld'
}

function linuxRecordLine(backend: LinuxBackend, protocol: 'tcp' | 'udp', port: number): string {
  const entry = `${backend} ${protocol} ${port}`
  return `mkdir -p ${LINUX_STATE_DIR}; grep -qxF "${entry}" ${LINUX_STATE_FILE} 2>/dev/null || echo "${entry}" >> ${LINUX_STATE_FILE}`
}

function linuxRepairScript(backend: LinuxBackend, port: number): string {
  if (backend === 'ufw') {
    return [
      'set -e',
      `if ! ufw status 2>/dev/null | grep -q "^${port}/tcp"; then`,
      `  ufw allow ${port}/tcp`,
      `  ${linuxRecordLine('ufw', 'tcp', port)}`,
      'fi',
      `if ! ufw status 2>/dev/null | grep -q "^${port}/udp"; then`,
      `  ufw allow ${port}/udp`,
      `  ${linuxRecordLine('ufw', 'udp', port)}`,
      'fi'
    ].join('\n')
  }
  return [
    'set -e',
    `if ! firewall-cmd --permanent --query-port=${port}/tcp >/dev/null 2>&1; then`,
    `  firewall-cmd --permanent --add-port=${port}/tcp`,
    `  ${linuxRecordLine('firewalld', 'tcp', port)}`,
    'fi',
    `if ! firewall-cmd --permanent --query-port=${port}/udp >/dev/null 2>&1; then`,
    `  firewall-cmd --permanent --add-port=${port}/udp`,
    `  ${linuxRecordLine('firewalld', 'udp', port)}`,
    'fi',
    'firewall-cmd --reload'
  ].join('\n')
}

function linuxManualCommand(backend: LinuxBackend, port: number): string {
  if (backend === 'ufw') {
    return `sudo ufw allow ${port}/tcp && sudo ufw allow ${port}/udp`
  }
  return `sudo firewall-cmd --permanent --add-port=${port}/tcp && sudo firewall-cmd --permanent --add-port=${port}/udp && sudo firewall-cmd --reload`
}

async function runPowerShell(script: string, timeout: number): Promise<string> {
  const { stdout } = await execFileAsync(
    POWERSHELL,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      timeout,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, LANPOST_EXE: process.execPath }
    }
  )
  return stdout.trim()
}

function elevatedRunner(inner: string): string {
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')
  return [
    'try {',
    `  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}')`,
    '  exit $p.ExitCode',
    '} catch {',
    '  exit 1',
    '}'
  ].join('\n')
}

function parseState(value: string | undefined): FirewallState {
  if (value === 'allowed' || value === 'blocked' || value === 'missing') {
    return value
  }
  return 'unknown'
}

async function serviceActive(name: string): Promise<boolean> {
  try {
    await execFileAsync('systemctl', ['is-active', '--quiet', name], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

async function detectLinuxBackend(): Promise<LinuxBackend | null> {
  if (await serviceActive('ufw')) return 'ufw'
  if (await serviceActive('firewalld')) return 'firewalld'
  return null
}

async function linuxRuleRecorded(backend: LinuxBackend, port: number): Promise<boolean> {
  try {
    const entries = new Set(
      (await readFile(LINUX_STATE_FILE, 'utf8')).split('\n').map((line) => line.trim())
    )
    return entries.has(`${backend} tcp ${port}`) && entries.has(`${backend} udp ${port}`)
  } catch {
    return false
  }
}

async function checkWindows(executable: string): Promise<FirewallStatus> {
  try {
    const parsed = JSON.parse(await runPowerShell(CHECK_SCRIPT, 15000)) as CheckOutput
    const state = parseState(parsed.state)
    return { state, executable, detail: detailOf(state) }
  } catch (error) {
    return {
      state: 'unknown',
      executable,
      detail: `无法读取防火墙状态：${messageOf(error)}`
    }
  }
}

async function checkLinux(executable: string, port: number): Promise<FirewallStatus> {
  const backend = await detectLinuxBackend()
  if (!backend) {
    return {
      state: 'unsupported',
      executable,
      detail: '未检测到启用的 ufw 或 firewalld；如仍无法连接，请检查其他防火墙规则'
    }
  }
  const label = linuxBackendLabel(backend)
  if (await linuxRuleRecorded(backend, port)) {
    return {
      state: 'allowed',
      executable,
      detail: `记录显示已放行 TCP/UDP ${port}（${label}）；如仍无法连接请重新修复`
    }
  }
  return {
    state: 'manual',
    executable,
    detail: `检测到 ${label}，点击修复放行 TCP/UDP ${port}`
  }
}

async function repairWindows(executable: string): Promise<FirewallStatus> {
  try {
    await runPowerShell(elevatedRunner(REPAIR_SCRIPT(executable, ruleNameOf(executable))), 60000)
  } catch (error) {
    return {
      state: 'unknown',
      executable,
      detail: `修复失败或已取消：${messageOf(error)}`
    }
  }
  return checkWindows(executable)
}

async function repairLinux(executable: string, port: number): Promise<FirewallStatus> {
  const backend = await detectLinuxBackend()
  if (!backend) {
    return checkLinux(executable, port)
  }
  const label = linuxBackendLabel(backend)
  try {
    const script = linuxRepairScript(backend, port)
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      await execFileAsync('/bin/sh', ['-c', script], { timeout: 60000 })
    } else {
      await execFileAsync('pkexec', ['/bin/sh', '-c', script], { timeout: 60000 })
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return {
        state: 'manual',
        executable,
        detail: `未找到 pkexec，请手动运行：${linuxManualCommand(backend, port)}`
      }
    }
    return {
      state: 'manual',
      executable,
      detail: `修复失败或已取消：${messageOf(error)}`
    }
  }
  return {
    state: 'allowed',
    executable,
    detail: `已放行 TCP/UDP ${port}（${label}）`
  }
}

export async function checkFirewall(port = 2425): Promise<FirewallStatus> {
  const executable = process.execPath
  const validPort = normalizedPort(port)
  if (process.platform === 'win32') {
    return checkWindows(executable)
  }
  if (process.platform === 'linux') {
    if (validPort === null) {
      return { state: 'unknown', executable, detail: '监听端口配置无效' }
    }
    return checkLinux(executable, validPort)
  }
  return { state: 'unsupported', executable, detail: detailOf('unsupported') }
}

export async function repairFirewall(port = 2425): Promise<FirewallStatus> {
  const executable = process.execPath
  const validPort = normalizedPort(port)
  if (process.platform === 'win32') {
    return repairWindows(executable)
  }
  if (process.platform === 'linux') {
    if (validPort === null) {
      return { state: 'unknown', executable, detail: '监听端口配置无效' }
    }
    return repairLinux(executable, validPort)
  }
  return { state: 'unsupported', executable, detail: detailOf('unsupported') }
}
