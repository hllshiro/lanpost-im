import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  configureDebugLog,
  debugLog,
  debugLogFile,
  errorLog,
  isDebugLogEnabled,
  pruneDebugLogs
} from './debug-log'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-logs-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  configureDebugLog({ enabled: false, dir: '' })
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('debug log', () => {
  it('writes nothing to debug files while disabled', () => {
    const dir = tempDir()
    configureDebugLog({ enabled: false, dir })
    expect(isDebugLogEnabled()).toBe(false)
    debugLog('presence', '不应写入', { ip: '10.0.0.1' })
    expect(readdirSync(dir).filter((name) => name.startsWith('debug-'))).toEqual([])
  })

  it('writes a new per-launch debug file when enabled', () => {
    const dir = tempDir()
    configureDebugLog({ enabled: true, dir })
    expect(isDebugLogEnabled()).toBe(true)
    debugLog('presence', '联系人上线', { key: 'alice', ip: '10.0.0.1' })
    const file = debugLogFile()
    expect(file.startsWith(join(dir, 'debug-'))).toBe(true)
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('[debug] presence: 联系人上线')
    expect(text).toContain('"key":"alice"')

    configureDebugLog({ enabled: false, dir })
    debugLog('presence', '下线', { key: 'alice' })
    expect(readFileSync(file, 'utf8').includes('下线')).toBe(false)
  })

  it('always records errors even when debug is disabled', () => {
    const dir = tempDir()
    configureDebugLog({ enabled: false, dir })
    errorLog('protocol', '连接失败', { ip: '10.0.0.1' })
    const text = readFileSync(join(dir, 'error.log'), 'utf8')
    expect(text).toContain('[error] protocol: 连接失败')
    expect(text).toContain('"ip":"10.0.0.1"')
  })

  it('serializes errors and buffers without throwing', () => {
    const dir = tempDir()
    configureDebugLog({ enabled: true, dir })
    debugLog('error', '读取失败', {
      error: new Error('boom'),
      data: Buffer.from('abc')
    })
    const text = readFileSync(debugLogFile(), 'utf8')
    expect(text).toContain('"message":"boom"')
    expect(text).toContain('<Buffer 3>')
  })

  it('keeps only the newest debug files', () => {
    const dir = tempDir()
    for (let index = 0; index < 25; index += 1) {
      const file = join(dir, `debug-20260101-0000${String(index).padStart(2, '0')}.log`)
      writeFileSync(file, 'x')
      const time = new Date(2026, 0, 1, 0, 0, index)
      utimesSync(file, time, time)
    }
    pruneDebugLogs(dir, 20)
    const files = readdirSync(dir).filter((name) => name.startsWith('debug-'))
    expect(files).toHaveLength(20)
    expect(files).not.toContain('debug-20260101-000000.log')
  })
})
