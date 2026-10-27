import { describe, expect, it } from 'vitest'
import { errorMessage } from '../../../src/renderer/src/utils/errors'

describe('errorMessage', () => {
  it('keeps only the business message of an error', () => {
    expect(errorMessage(new Error('联系人不在线'))).toBe('联系人不在线')
  })

  it('strips the Electron IPC wrapper and Error type name', () => {
    expect(
      errorMessage(new Error("Error invoking remote method 'messages:send': Error: 联系人不在线"))
    ).toBe('联系人不在线')
    expect(
      errorMessage(new Error("Error invoking remote method 'files:open': 文件尚未接收完成"))
    ).toBe('文件尚未接收完成')
  })

  it('accepts strings and message objects', () => {
    expect(errorMessage('会话不存在')).toBe('会话不存在')
    expect(errorMessage({ message: '操作失败' })).toBe('操作失败')
  })

  it('falls back to a friendly message when empty', () => {
    expect(errorMessage('')).toBe('操作失败')
    expect(errorMessage(undefined)).toBe('操作失败')
  })
})
