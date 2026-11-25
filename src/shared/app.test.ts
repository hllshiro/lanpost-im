import { describe, expect, it } from 'vitest'
import { APP_ID, APP_NAME } from './app'

describe('app identity', () => {
  it('uses the product name and application id', () => {
    expect(APP_NAME).toBe('内网传书')
    expect(APP_ID).toBe('com.lanpost.im')
  })
})
