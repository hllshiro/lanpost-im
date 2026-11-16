import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { join } from 'node:path'

const MAX_DEBUG_FILES = 20
const MAX_DEBUG_PART_BYTES = 10 * 1024 * 1024
const MAX_ERROR_BYTES = 2 * 1024 * 1024
const MAX_LINE = 4000
// 本次进程启动时间：每次打开程序都生成新的调试日志文件
const LAUNCH_STAMP = stampOf(new Date())

let debugEnabled = false
let logsDirectory = ''
let debugFile = ''
let debugPart = 1
let configuredDir = ''
let errorPath = ''

function two(value: number): string {
  return String(value).padStart(2, '0')
}

function stampOf(date: Date): string {
  return (
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}` +
    `-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`
  )
}

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

function writeLine(
  file: string,
  level: string,
  category: string,
  message: string,
  data?: unknown
): void {
  try {
    mkdirSync(logsDirectory, { recursive: true })
    const suffix = data === undefined ? '' : ' | ' + stringify(data)
    appendFileSync(
      file,
      `${new Date().toISOString()} [${level}] ${category}: ${message}${suffix}\n`
    )
  } catch {
    // 写日志失败不能影响主流程
  }
}

// 调试日志按启动时间和分卷命名，超过 20 个删除最旧的
export function pruneDebugLogs(dir: string, keep = MAX_DEBUG_FILES): void {
  try {
    const files = readdirSync(dir)
      .filter((name) => /^debug-.*\.log$/.test(name))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)
    for (const file of files.slice(keep)) {
      rmSync(join(dir, file.name), { force: true })
    }
  } catch {
    // 目录读不到时跳过清理
  }
}

function nextDebugPart(): void {
  debugPart += 1
  debugFile = join(logsDirectory, `debug-${LAUNCH_STAMP}-${debugPart}.log`)
}

function ensureDebugFile(): void {
  if (logsDirectory === '') return
  mkdirSync(logsDirectory, { recursive: true })
  if (debugFile === '') {
    debugPart = 1
    debugFile = join(logsDirectory, `debug-${LAUNCH_STAMP}.log`)
    pruneDebugLogs(logsDirectory)
  }
  try {
    if (existsSync(debugFile) && statSync(debugFile).size > MAX_DEBUG_PART_BYTES) {
      nextDebugPart()
      pruneDebugLogs(logsDirectory)
    }
  } catch {
    // 统计失败时继续写当前文件
  }
}

function writeDebug(category: string, message: string, data?: unknown): void {
  if (!debugEnabled) return
  ensureDebugFile()
  if (debugFile === '') return
  writeLine(debugFile, 'debug', category, message, data)
}

function rotateError(): void {
  try {
    if (!existsSync(errorPath)) return
    if (statSync(errorPath).size <= MAX_ERROR_BYTES) return
    const backup = errorPath + '.1'
    rmSync(backup, { force: true })
    renameSync(errorPath, backup)
  } catch {
    // 轮转失败时继续写
  }
}

export function configureDebugLog(options: { enabled: boolean; dir: string }): void {
  if (configuredDir !== '' && configuredDir !== options.dir) {
    debugFile = ''
    debugPart = 1
  }
  configuredDir = options.dir
  logsDirectory = options.dir
  errorPath = logsDirectory === '' ? '' : join(logsDirectory, 'error.log')
  const wasEnabled = debugEnabled
  debugEnabled = options.enabled
  if (debugEnabled && !wasEnabled) {
    writeDebug('logger', '调试日志已开启')
  }
}

export function isDebugLogEnabled(): boolean {
  return debugEnabled
}

export function debugLog(category: string, message: string, data?: unknown): void {
  writeDebug(category, message, data)
}

// 错误日志不受调试开关影响，始终写入 logs/error.log
export function errorLog(category: string, message: string, data?: unknown): void {
  if (errorPath === '') return
  rotateError()
  writeLine(errorPath, 'error', category, message, data)
  writeDebug('error', `${category}: ${message}`, data)
}

export function debugLogFile(): string {
  return debugFile
}

export function errorLogFile(): string {
  return errorPath
}
