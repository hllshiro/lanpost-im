const PRIVATE_USER_ID_PATTERN = /^[0-9a-f]{32}$/i

// 内网通私有用户号固定为 32 位十六进制；其它内容（加密块、二进制、空串）都不能当身份键
export function isPrivateUserId(value: string): boolean {
  return PRIVATE_USER_ID_PATTERN.test(value)
}
