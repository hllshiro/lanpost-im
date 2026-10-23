import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function startupLogFile(): string {
  return join(app.getPath('userData'), 'startup.log')
}

export function logStartup(message: string): void {
  console.log('[lanpost] ' + message)
  try {
    const file = startupLogFile()
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`)
  } catch {
    // 日志写入失败不能影响启动。
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message
  }
  return String(error)
}
