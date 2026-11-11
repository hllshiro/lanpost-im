// 内网通私有通道固定密钥，16 字节 ASCII。
export const TEA_KEY = Buffer.from('8asfhj@k7*20hbla', 'ascii')

const DELTA = 0x9e3779b9
const ROUNDS = 32
const BLOCK_SIZE = 8

// 明文字与密钥字都按大端解释。
const KEY_WORDS = [
  TEA_KEY.readUInt32BE(0),
  TEA_KEY.readUInt32BE(4),
  TEA_KEY.readUInt32BE(8),
  TEA_KEY.readUInt32BE(12)
]

function encryptWords(v0: number, v1: number): [number, number] {
  let sum = 0
  for (let round = 0; round < ROUNDS; round += 1) {
    v0 = (v0 + ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + KEY_WORDS[sum & 3]))) >>> 0
    sum = (sum + DELTA) >>> 0
    v1 = (v1 + ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + KEY_WORDS[(sum >>> 11) & 3]))) >>> 0
  }
  return [v0, v1]
}

function decryptWords(v0: number, v1: number): [number, number] {
  let sum = (DELTA * ROUNDS) >>> 0
  for (let round = 0; round < ROUNDS; round += 1) {
    v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + KEY_WORDS[(sum >>> 11) & 3]))) >>> 0
    sum = (sum - DELTA) >>> 0
    v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + KEY_WORDS[sum & 3]))) >>> 0
  }
  return [v0, v1]
}

export function encryptBlock(block: Buffer): Buffer {
  if (block.length !== BLOCK_SIZE) {
    throw new Error(`TEA 分组长度必须是 ${BLOCK_SIZE} 字节，收到 ${block.length}`)
  }
  const [v0, v1] = encryptWords(block.readUInt32BE(0), block.readUInt32BE(4))
  const out = Buffer.alloc(BLOCK_SIZE)
  out.writeUInt32BE(v0, 0)
  out.writeUInt32BE(v1, 4)
  return out
}

export function decryptBlock(block: Buffer): Buffer {
  if (block.length !== BLOCK_SIZE) {
    throw new Error(`TEA 分组长度必须是 ${BLOCK_SIZE} 字节，收到 ${block.length}`)
  }
  const [v0, v1] = decryptWords(block.readUInt32BE(0), block.readUInt32BE(4))
  const out = Buffer.alloc(BLOCK_SIZE)
  out.writeUInt32BE(v0, 0)
  out.writeUInt32BE(v1, 4)
  return out
}

function transformBody(body: Buffer, transform: (block: Buffer) => Buffer): Buffer {
  const full = body.length - (body.length % BLOCK_SIZE)
  const out = Buffer.alloc(body.length)
  for (let offset = 0; offset < full; offset += BLOCK_SIZE) {
    transform(body.subarray(offset, offset + BLOCK_SIZE)).copy(out, offset)
  }
  body.copy(out, full, full)
  return out
}

export function encryptBody(plain: Buffer): Buffer {
  return transformBody(plain, encryptBlock)
}

export function decryptBody(cipher: Buffer): Buffer {
  return transformBody(cipher, decryptBlock)
}
