import { createDecipheriv, createHash } from 'node:crypto'

// 内网通 3.4.3055 的 Syl 数据库：
// - 明文只有 qrp、sd、shr；nr（聊天记录）、ol（离线消息）、sc（本机状态）整库加密
// - 加密在 SQLite 的分页层做：按页 AES-128-CBC，页号从 1 开始
// - 每页密钥 = MD5(主密钥 ‖ 页号小端 4 字节 ‖ "sAlT")
// - 每页初始向量 = MD5(4 轮线性同余状态，每轮取状态的小端 4 字节)
// 主密钥由客户端内置口令 "ZpkL9ejq" 经 MD5 迭代派生，同一版本固定不变
const MASTER_KEY = Buffer.from('e07eaa7a612524e130afb6bb62c562be', 'hex')
const SALT = Buffer.from('sAlT', 'latin1')
const LCG_MULTIPLIER = 0x9ef4
const LCG_MODULUS = 0x7fffff07
const LCG_ROUNDS = 4
const SQLITE_HEADER = Buffer.from('SQLite format 3\x00', 'latin1')
const MIN_PAGE_SIZE = 512
const MAX_PAGE_SIZE = 65536

// 页号从 1 开始，和 SQLite 的分页编号一致
export function nwtPageKey(page: number): Buffer {
  const number = Buffer.alloc(4)
  number.writeUInt32LE(page >>> 0, 0)
  return createHash('md5')
    .update(Buffer.concat([MASTER_KEY, number, SALT]))
    .digest()
}

export function nwtPageIv(page: number): Buffer {
  let state = (page + 1) >>> 0
  const seed = Buffer.alloc(LCG_ROUNDS * 4)
  for (let round = 0; round < LCG_ROUNDS; round += 1) {
    state = Number((BigInt(state) * BigInt(LCG_MULTIPLIER)) % BigInt(LCG_MODULUS))
    seed.writeUInt32LE(state, round * 4)
  }
  return createHash('md5').update(seed).digest()
}

export function isNwtDatabase(data: Buffer): boolean {
  if (data.length < 32) return false
  return decryptRange(data, 1, 0, 32).subarray(0, 16).equals(SQLITE_HEADER)
}

// 解密整库；页大小从解密后的 SQLite 头部读取（本机样本为 1024）
export function decryptNwtDatabase(data: Buffer): Buffer {
  if (data.length < MIN_PAGE_SIZE) {
    throw new Error('不是内网通加密数据库：文件不足一页')
  }
  const head = decryptRange(data, 1, 0, 32)
  if (!head.subarray(0, 16).equals(SQLITE_HEADER)) {
    throw new Error('不是内网通加密数据库：页头不匹配')
  }
  const declared = head.readUInt16BE(16)
  const pageSize = declared === 1 ? MAX_PAGE_SIZE : declared
  const valid =
    pageSize >= MIN_PAGE_SIZE && pageSize <= MAX_PAGE_SIZE && (pageSize & (pageSize - 1)) === 0
  if (!valid) {
    throw new Error(`不是内网通加密数据库：页大小 ${pageSize} 不合法`)
  }
  if (data.length % pageSize !== 0) {
    throw new Error(`不是整页：文件 ${data.length} 字节不是 ${pageSize} 的整数倍`)
  }
  const out = Buffer.alloc(data.length)
  for (let offset = 0; offset < data.length; offset += pageSize) {
    const page = offset / pageSize + 1
    decryptRange(data, page, offset, pageSize).copy(out, offset)
  }
  return out
}

function decryptRange(data: Buffer, page: number, offset: number, length: number): Buffer {
  const end = Math.min(offset + length, data.length)
  const decipher = createDecipheriv('aes-128-cbc', nwtPageKey(page), nwtPageIv(page))
  decipher.setAutoPadding(false)
  return Buffer.concat([decipher.update(data.subarray(offset, end)), decipher.final()])
}
