import { describe, expect, it } from 'vitest'
import { createPrivateId, identityFromComputerName, privateUserId } from './identity'
import { defaultSettings } from '../shared/settings'

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

describe('private identity', () => {
  it('generates a 32 character hex id', () => {
    const values = [0.1, 0.2, 0.3, 0.4]
    let index = 0
    const id = createPrivateId(() => values[index++ % values.length])
    expect(id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('ships defaults for the private channel', () => {
    expect(defaultSettings.identity.privateId).toBe('')
    expect(defaultSettings.network.privatePort).toBe(9011)
    expect(defaultSettings.network.privateSeeds).toEqual([])
  })

  it('prefers the stored private id', () => {
    const settings = structuredClone(defaultSettings)
    settings.identity.privateId = 'abcdefabcdefabcdefabcdefabcdefab'
    expect(privateUserId(settings)).toBe('abcdefabcdefabcdefabcdefabcdefab')
  })

  it('falls back to the hash of account and host when no id is stored', () => {
    const settings = structuredClone(defaultSettings)
    settings.identity.account = 'pc-a'
    settings.identity.hostName = 'pc-a'
    expect(privateUserId(settings)).toBe('7c6f856e4f0e48a3a67d90dbcd08ff1b')
  })
})
