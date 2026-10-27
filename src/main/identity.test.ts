import { describe, expect, it } from 'vitest'
import { deriveIdentityId } from './identity'
import { identityFromComputerName } from './identity'

describe('identity defaults', () => {
  it('derives display name, account and host name from the computer name', () => {
    expect(identityFromComputerName('DESKTOP-SM')).toEqual({
      displayName: 'DESKTOP-SM',
      account: 'desktop-sm',
      hostName: 'desktop-sm'
    })
  })

  it('replaces characters that break the packet header', () => {
    expect(identityFromComputerName(' office pc :01 ')).toEqual({
      displayName: 'office-pc-01',
      account: 'office-pc-01',
      hostName: 'office-pc-01'
    })
  })

  it('falls back to lanpost- plus four random digits', () => {
    expect(identityFromComputerName('', () => 0.1234)).toEqual({
      displayName: 'lanpost-1234',
      account: 'lanpost-1234',
      hostName: 'lanpost-1234'
    })
    expect(identityFromComputerName('   ', () => 0.9999)).toEqual({
      displayName: 'lanpost-9999',
      account: 'lanpost-9999',
      hostName: 'lanpost-9999'
    })
  })

  it('limits fields to the protocol lengths', () => {
    const long = 'a'.repeat(80)
    expect(identityFromComputerName(long).displayName).toHaveLength(32)
    expect(identityFromComputerName(long).account).toHaveLength(32)
    expect(identityFromComputerName(long).hostName).toHaveLength(64)
  })
})

describe('identity id', () => {
  it('derives the same id for the same hardware and account', () => {
    const one = deriveIdentityId('alice', 'hardware-123')
    const two = deriveIdentityId('alice', 'hardware-123')
    expect(one).toBe(two)
    expect(one).toHaveLength(32)
    expect(deriveIdentityId('bob', 'hardware-123')).not.toBe(one)
    expect(deriveIdentityId('alice', 'hardware-456')).not.toBe(one)
  })
})
