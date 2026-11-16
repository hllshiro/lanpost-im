import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { configureDebugLog, debugLog, isDebugLogEnabled } from './debug-log'

const dirs: string[] = []

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-debug-'))
  dirs.push(dir)
  return join(dir, 'debug.log')
}

afterEach(() => {
  configureDebugLog({ enabled: false, file: '' })
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('debug log', () => {
  it('writes nothing while disabled', () => {
    const file = tempFile()
    expect(isDebugLogEnabled()).toBe(false)
    debugLog('presence', '不应写入', { ip: '10.0.0.1' })
    expect(() => readFileSync(file, 'utf8')).toThrow()
  })

  it('writes structured lines when enabled and stops after disabling', () => {
    const file = tempFile()
    configureDebugLog({ enabled: true, file })
    expect(isDebugLogEnabled()).toBe(true)
    debugLog('presence', '联系人上线', { key: 'alice', ip: '10.0.0.1' })
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('调试日志已开启')
    expect(text).toContain('[debug] presence: 联系人上线')
    expect(text).toContain('"key":"alice"')

    configureDebugLog({ enabled: false, file })
    debugLog('presence', '下线', { key: 'alice' })
    expect(readFileSync(file, 'utf8').includes('下线')).toBe(false)
  })

  it('serializes errors and buffers without throwing', () => {
    const file = tempFile()
    configureDebugLog({ enabled: true, file })
    debugLog('error', '读取失败', {
      error: new Error('boom'),
      data: Buffer.from('abc')
    })
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('"message":"boom"')
    expect(text).toContain('<Buffer 3>')
  })
})
