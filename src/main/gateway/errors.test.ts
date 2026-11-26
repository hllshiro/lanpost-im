import { describe, expect, it } from 'vitest'
import { GwError, toRpcError } from './errors'

describe('toRpcError', () => {
  it('maps GwError to a plain JSON-RPC error object', () => {
    const error = toRpcError(new GwError(-32011, 'USER_NOT_FOUND'))
    expect(error).toEqual({ code: -32011, message: 'USER_NOT_FOUND' })
    expect(error).not.toBeInstanceOf(Error)
  })

  it('keeps GwError data', () => {
    const error = toRpcError(new GwError(-32010, 'INVALID_ARGUMENT', { field: 'page' }))
    expect(error).toEqual({
      code: -32010,
      message: 'INVALID_ARGUMENT',
      data: { field: 'page' }
    })
  })

  it('maps unknown Error instances to INTERNAL_ERROR', () => {
    expect(toRpcError(new Error('boom'))).toEqual({ code: -32003, message: 'INTERNAL_ERROR' })
  })

  it('maps non-Error throws to INTERNAL_ERROR', () => {
    expect(toRpcError('boom')).toEqual({ code: -32003, message: 'INTERNAL_ERROR' })
    expect(toRpcError({ code: -32011, message: 'USER_NOT_FOUND' })).toEqual({
      code: -32003,
      message: 'INTERNAL_ERROR'
    })
  })
})
