import { describe, expect, it } from 'vitest'
import { APP_ID, APP_NAME, APP_NAME_EN } from './app'

describe('app identity', () => {
  it('uses the product name and application id', () => {
    expect(APP_NAME).toBe('内网传书')
    expect(APP_NAME_EN).toBe('lanpost-im')
    expect(APP_ID).toBe('com.lanpost.im')
  })
})
