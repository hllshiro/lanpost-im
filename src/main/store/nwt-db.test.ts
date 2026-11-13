import { createCipheriv } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptNwtDatabase, isNwtDatabase, nwtPageIv, nwtPageKey } from './nwt-db'

// 用同一套密钥与链式分组加密造出一份假的内网通数据库，用来验证解密与分页
function encryptDatabase(plain: Buffer, pageSize: number): Buffer {
  const out = Buffer.alloc(plain.length)
  for (let index = 0; index < plain.length; index += pageSize) {
    const page = index / pageSize + 1
    const cipher = createCipheriv('aes-128-cbc', nwtPageKey(page), nwtPageIv(page))
    cipher.setAutoPadding(false)
    cipher.update(plain.subarray(index, index + pageSize)).copy(out, index)
    cipher.final()
  }
  return out
}

function makePlainDatabase(pageSize: number, pages: number): Buffer {
  const plain = Buffer.alloc(pageSize * pages)
  Buffer.from('SQLite format 3\0', 'latin1').copy(plain, 0)
  plain.writeUInt16BE(pageSize, 16)
  plain[18] = 1
  plain[19] = 1
  plain[20] = 0
  plain[21] = 64
  plain[22] = 32
  plain[23] = 32
  for (let page = 2; page <= pages; page += 1) {
    plain[pageSize * (page - 1)] = 0x0d
    plain.writeUInt32BE(page * 7, pageSize * page - 4)
  }
  return plain
}

describe('nwtPageKey / nwtPageIv', () => {
  it('第一页的密钥与初始向量与真实客户端一致', () => {
    expect(nwtPageKey(1).toString('hex')).toBe('61dc201dec7b5b9d3254f5288a87f92f')
    expect(nwtPageIv(1).toString('hex')).toBe('20d7420f9c37a35dca6fe92a1c6999a9')
  })

  it('每一页的密钥与初始向量都不同', () => {
    const keys = new Set([1, 2, 3, 4, 5].map((page) => nwtPageKey(page).toString('hex')))
    const ivs = new Set([1, 2, 3, 4, 5].map((page) => nwtPageIv(page).toString('hex')))
    expect(keys.size).toBe(5)
    expect(ivs.size).toBe(5)
  })
})

describe('isNwtDatabase', () => {
  it('识别内网通加密库', () => {
    const plain = makePlainDatabase(1024, 4)
    const encrypted = encryptDatabase(plain, 1024)
    expect(isNwtDatabase(encrypted)).toBe(true)
  })

  it('明文数据库不算内网通加密库', () => {
    expect(isNwtDatabase(makePlainDatabase(1024, 2))).toBe(false)
  })
})

describe('decryptNwtDatabase', () => {
  it('按 1024 字节页解密', () => {
    const plain = makePlainDatabase(1024, 6)
    const encrypted = encryptDatabase(plain, 1024)
    expect(decryptNwtDatabase(encrypted).equals(plain)).toBe(true)
  })

  it('按 4096 字节页解密', () => {
    const plain = makePlainDatabase(4096, 3)
    const encrypted = encryptDatabase(plain, 4096)
    expect(decryptNwtDatabase(encrypted).equals(plain)).toBe(true)
  })

  it('不是内网通加密库时明确报错', () => {
    expect(() => decryptNwtDatabase(Buffer.alloc(2048, 7))).toThrow('不是内网通加密数据库')
  })

  it('长度不是整页时报错', () => {
    const plain = makePlainDatabase(1024, 2)
    const encrypted = encryptDatabase(plain, 1024)
    expect(() => decryptNwtDatabase(encrypted.subarray(0, 1500))).toThrow('不是整页')
  })
})
