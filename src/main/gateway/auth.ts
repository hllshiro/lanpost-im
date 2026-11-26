import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** 生成 32 字节随机令牌，base64url 编码后固定 43 个字符。 */
export function createRpcToken(): string {
  return randomBytes(32).toString('base64url')
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** 先哈希再比较，长度不同也不会提前返回。 */
export function constantTimeEqual(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b))
}

/** 校验 rpc.login 的参数：expected 为空时一律拒绝。 */
export function verifyRpcToken(expected: string, params: unknown): boolean {
  if (!expected) return false
  if (typeof params !== 'object' || params === null || Array.isArray(params)) return false
  const token = (params as { token?: unknown }).token
  if (typeof token !== 'string' || token.length === 0) return false
  return constantTimeEqual(expected, token)
}

/** 解析 Authorization: Bearer <token>，scheme 大小写不敏感。 */
export function checkBearer(expected: string, authorization: string | undefined): boolean {
  if (!expected || !authorization) return false
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization.trim())
  if (!match) return false
  return constantTimeEqual(expected, match[1])
}
