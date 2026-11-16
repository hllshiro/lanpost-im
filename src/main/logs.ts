import { app, shell } from 'electron'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as tar from 'tar'
import { errorLog } from './debug-log'

export function logsDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

export async function openLogsDirectory(): Promise<void> {
  const dir = logsDirectory()
  mkdirSync(dir, { recursive: true })
  const message = await shell.openPath(dir)
  if (message !== '') throw new Error(message)
}

export function logArchiveName(now = new Date()): string {
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`
  return `logs-${date}.tar.gz`
}

export async function exportLogs(): Promise<string> {
  const dir = logsDirectory()
  mkdirSync(dir, { recursive: true })
  if (readdirSync(dir).length === 0) {
    writeFileSync(
      join(dir, 'README.txt'),
      `内网传书日志目录\n导出时间：${new Date().toISOString()}\n`
    )
  }
  // 默认下载目录被安全软件或权限拦截时，按文档目录、数据目录依次回退
  const targets = [app.getPath('downloads'), app.getPath('documents'), app.getPath('userData')]
  let lastError: unknown = null
  for (const [index, target] of targets.entries()) {
    const file = join(target, logArchiveName())
    try {
      await tar.c({ gzip: true, cwd: dir, file, portable: true }, ['.'])
      return file
    } catch (error) {
      lastError = error
      rmSync(file, { force: true })
      if (index < targets.length - 1) {
        errorLog('logs', '导出日志到首选目录失败，尝试备用目录', error)
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('导出日志失败')
}
