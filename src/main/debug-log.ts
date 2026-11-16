import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024
const MAX_LINE = 4000

let enabled = false
let logFile = ''

function safeValue(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack }
  }
  if (Buffer.isBuffer(value)) {
    return `<Buffer ${value.length}>`
  }
  // Buffer 会先经过 toJSON 变成 { type: 'Buffer', data: [...] }
  if (typeof value === 'object' && value !== null) {
    const record = value as { type?: unknown; data?: unknown }
    if (record.type === 'Buffer' && Array.isArray(record.data)) {
      return `<Buffer ${record.data.length}>`
    }
  }
  if (typeof value === 'bigint') {
    return value.toString()
  }
  return value
}

function stringify(data: unknown): string {
  try {
    const text = JSON.stringify(data, safeValue)
    if (text === undefined) return String(data)
    return text.length > MAX_LINE ? text.slice(0, MAX_LINE) + '…' : text
  } catch {
    return String(data)
  }
}

function rotate(): void {
  if (!existsSync(logFile)) return
  try {
    if (statSync(logFile).size <= MAX_BYTES) return
    const backup = logFile + '.1'
    rmSync(backup, { force: true })
    renameSync(logFile, backup)
  } catch {
    // 统计或轮转失败时继续写当前文件
  }
}

function write(level: string, category: string, message: string, data?: unknown): void {
  if (!enabled || logFile === '') return
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    rotate()
    const suffix = data === undefined ? '' : ' | ' + stringify(data)
    appendFileSync(
      logFile,
      `${new Date().toISOString()} [${level}] ${category}: ${message}${suffix}\n`
    )
  } catch {
    // 写日志失败不能影响主流程
  }
}

export function configureDebugLog(options: { enabled: boolean; file: string }): void {
  const wasEnabled = enabled
  enabled = options.enabled
  logFile = options.file
  if (enabled && !wasEnabled) {
    write('info', 'logger', '调试日志已开启')
  }
}

export function isDebugLogEnabled(): boolean {
  return enabled
}

// 记录状态变化与关键参数；高频事件由调用方控制频率
export function debugLog(category: string, message: string, data?: unknown): void {
  write('debug', category, message, data)
}

export function debugLogFile(): string {
  return logFile
}
