import { describe, expect, it } from 'vitest'
import { checkBearer, constantTimeEqual, createRpcToken, verifyRpcToken } from './auth'

describe('createRpcToken', () => {
  it('creates 43-character base64url tokens that differ each call', () => {
    const first = createRpcToken()
    const second = createRpcToken()
    expect(first).toHaveLength(43)
    expect(first).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(first).not.toBe(second)
  })
})

describe('verifyRpcToken', () => {
  it('accepts the matching token', () => {
    const token = createRpcToken()
    expect(verifyRpcToken(token, { token })).toBe(true)
  })

  it('rejects a wrong token', () => {
    expect(verifyRpcToken(createRpcToken(), { token: createRpcToken() })).toBe(false)
  })

  it('rejects missing or malformed parameters', () => {
    const token = createRpcToken()
    expect(verifyRpcToken(token, {})).toBe(false)
    expect(verifyRpcToken(token, { token: '' })).toBe(false)
    expect(verifyRpcToken(token, { token: 42 })).toBe(false)
    expect(verifyRpcToken(token, null)).toBe(false)
    expect(verifyRpcToken(token, 'token')).toBe(false)
  })

  it('rejects everything when no token is configured', () => {
    expect(verifyRpcToken('', { token: '' })).toBe(false)
    expect(verifyRpcToken('', { token: 'anything' })).toBe(false)
  })
})

describe('checkBearer', () => {
  it('accepts Bearer headers case-insensitively', () => {
    expect(checkBearer('abc', 'Bearer abc')).toBe(true)
    expect(checkBearer('abc', 'bearer abc')).toBe(true)
  })

  it('rejects missing, empty, or other schemes', () => {
    expect(checkBearer('abc', undefined)).toBe(false)
    expect(checkBearer('abc', '')).toBe(false)
    expect(checkBearer('abc', 'Bearer ')).toBe(false)
    expect(checkBearer('abc', 'Basic abc')).toBe(false)
    expect(checkBearer('abc', 'Bearer wrong')).toBe(false)
  })
})

describe('constantTimeEqual', () => {
  it('compares equal and different strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('', '')).toBe(true)
  })
})
