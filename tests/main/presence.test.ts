import { describe, expect, it } from 'vitest'
import { IDLE_AWAY_SECONDS, idleTarget, resolveIdlePresence } from '../../src/main/presence'

describe('idleTarget', () => {
  it('only switches to away after the idle threshold', () => {
    expect(idleTarget(-1)).toBe(0)
    expect(idleTarget(0)).toBe(0)
    expect(idleTarget(10 * 60)).toBe(0)
    expect(idleTarget(IDLE_AWAY_SECONDS - 1)).toBe(0)
    expect(idleTarget(IDLE_AWAY_SECONDS)).toBe(2)
  })
})

describe('resolveIdlePresence', () => {
  it('promotes an online user to away and restores online when active', () => {
    const away = resolveIdlePresence(IDLE_AWAY_SECONDS, 0, null)
    expect(away).toEqual({ status: 2, auto: { restore: 0 } })
    expect(resolveIdlePresence(5, 2, away.auto)).toEqual({ status: 0, auto: null })
  })

  it('keeps automatic away while still idle', () => {
    const away = { restore: 0 as const }
    expect(resolveIdlePresence(45 * 60, 2, away)).toEqual({ status: 2, auto: away })
  })

  it('never auto switches a manually chosen busy status', () => {
    expect(resolveIdlePresence(10 * 60, 1, null)).toEqual({ status: 1, auto: null })
    expect(resolveIdlePresence(IDLE_AWAY_SECONDS, 1, null)).toEqual({ status: 1, auto: null })
  })

  it('never overrides a manually chosen away status', () => {
    expect(resolveIdlePresence(IDLE_AWAY_SECONDS, 2, null)).toEqual({ status: 2, auto: null })
  })
})
