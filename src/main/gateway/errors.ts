/**
 * 网关错误：rpc-websockets 会把抛出的 Error 统一包成 -32603，
 * 因此自定义错误码必须以普通对象的形式抛出（见 toRpcError）。
 */

export type GwErrorName =
  | 'UNAUTHORIZED'
  | 'INTERNAL_ERROR'
  | 'INVALID_ARGUMENT'
  | 'USER_NOT_FOUND'
  | 'GROUP_NOT_FOUND'
  | 'MESSAGE_TOO_LARGE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'RATE_LIMITED'
  | 'ATTACHMENT_NOT_FOUND'
  | 'IMAGE_HASH_MISMATCH'
  | 'IMAGE_FORMAT_INVALID'
  | 'TRANSFER_TIMEOUT'
  | 'EVENT_CURSOR_EXPIRED'
  | 'DUPLICATE_REQUEST'

export const GW_ERRORS: Record<GwErrorName, { code: number; message: string }> = {
  UNAUTHORIZED: { code: -32001, message: 'UNAUTHORIZED' },
  INTERNAL_ERROR: { code: -32003, message: 'INTERNAL_ERROR' },
  INVALID_ARGUMENT: { code: -32010, message: 'INVALID_ARGUMENT' },
  USER_NOT_FOUND: { code: -32011, message: 'USER_NOT_FOUND' },
  GROUP_NOT_FOUND: { code: -32012, message: 'GROUP_NOT_FOUND' },
  MESSAGE_TOO_LARGE: { code: -32013, message: 'MESSAGE_TOO_LARGE' },
  UNSUPPORTED_CONTENT_TYPE: { code: -32014, message: 'UNSUPPORTED_CONTENT_TYPE' },
  RATE_LIMITED: { code: -32015, message: 'RATE_LIMITED' },
  ATTACHMENT_NOT_FOUND: { code: -32016, message: 'ATTACHMENT_NOT_FOUND' },
  IMAGE_HASH_MISMATCH: { code: -32017, message: 'IMAGE_HASH_MISMATCH' },
  IMAGE_FORMAT_INVALID: { code: -32018, message: 'IMAGE_FORMAT_INVALID' },
  TRANSFER_TIMEOUT: { code: -32019, message: 'TRANSFER_TIMEOUT' },
  EVENT_CURSOR_EXPIRED: { code: -32020, message: 'EVENT_CURSOR_EXPIRED' },
  DUPLICATE_REQUEST: { code: -32021, message: 'DUPLICATE_REQUEST' }
}

export interface RpcErrorObject {
  code: number
  message: string
  data?: unknown
}

export class GwError extends Error {
  constructor(
    readonly rpcCode: number,
    message: string,
    readonly rpcData?: unknown
  ) {
    super(message)
    this.name = 'GwError'
  }
}

/** 把任意异常转换成库可以直接回给客户端的普通错误对象。 */
export function toRpcError(error: unknown): RpcErrorObject {
  if (error instanceof GwError) {
    const result: RpcErrorObject = { code: error.rpcCode, message: error.message }
    if (error.rpcData !== undefined) result.data = error.rpcData
    return result
  }
  return { code: -32003, message: 'INTERNAL_ERROR' }
}

export function gwError(name: GwErrorName, data?: unknown): GwError {
  const spec = GW_ERRORS[name]
  return new GwError(spec.code, spec.message, data)
}
