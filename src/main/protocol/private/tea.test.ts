import { describe, expect, it } from 'vitest'
import { decryptBody, encryptBody } from './tea'

describe('tea', () => {
  it('matches the captured heartbeat frame', () => {
    const plain = Buffer.from('<X_HEARTBEAT docver="1" />', 'utf8')
    expect(encryptBody(plain).toString('hex')).toBe(
      'd529c5439de045c9d3dc11866769e1fedfa896e8e704a5532f3e'
    )
  })

  it('matches captured 8-byte block vectors', () => {
    expect(encryptBody(Buffer.from('<X_READY')).toString('hex')).toBe('5f4d1ebae1485eae')
    expect(encryptBody(Buffer.from(' docver=')).toString('hex')).toBe('3a643fa23c20e0ae')
    expect(encryptBody(Buffer.from('<X_SEND_')).toString('hex')).toBe('69e9b754d98ba061')
    expect(encryptBody(Buffer.from('TE_SEND_')).toString('hex')).toBe('ed84465aa4ec9d10')
  })

  it('leaves the trailing partial block in plaintext and round-trips', () => {
    const plain = Buffer.from(
      '<X_READY docver="1"><USER_ID>68e24da0fa70794981775dd7dbfb7c6f</USER_ID><PARAM>0</PARAM></X_READY>',
      'utf8'
    )
    const cipher = encryptBody(plain)
    expect(cipher.length).toBe(plain.length)
    expect(cipher.subarray(96).toString('hex')).toBe('3e')
    expect(decryptBody(cipher).equals(plain)).toBe(true)
  })
})
