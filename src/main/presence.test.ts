import { describe, expect, it } from 'vitest'
import {
  IDLE_AWAY_SECONDS,
  IDLE_BUSY_SECONDS,
  idleTarget,
  resolveIdlePresence,
  type AutoPresence
} from './presence'

describe('idleTarget', () => {
  it('maps idle time to busy and away thresholds', () => {
    expect(idleTarget(-1)).toBe(0)
    expect(idleTarget(0)).toBe(0)
    expect(idleTarget(IDLE_BUSY_SECONDS - 1)).toBe(0)
    expect(idleTarget(IDLE_BUSY_SECONDS)).toBe(1)
    expect(idleTarget(IDLE_AWAY_SECONDS - 1)).toBe(1)
    expect(idleTarget(IDLE_AWAY_SECONDS)).toBe(2)
  })
})

describe('resolveIdlePresence', () => {
  it('promotes an online user to busy, then away', () => {
    const busy = resolveIdlePresence(IDLE_BUSY_SECONDS, 0, null)
    expect(busy).toEqual({ status: 1, auto: { status: 1, restore: 0 } })

    const away = resolveIdlePresence(IDLE_AWAY_SECONDS, 1, busy.auto)
    expect(away).toEqual({ status: 2, auto: { status: 2, restore: 0 } })
  })

  it('restores the original status once the user is active', () => {
    const away: AutoPresence = { status: 2, restore: 0 }
    expect(resolveIdlePresence(5, 2, away)).toEqual({ status: 0, auto: null })
  })

  it('steps back from away to busy while still idle', () => {
    const away: AutoPresence = { status: 2, restore: 0 }
    expect(resolveIdlePresence(20 * 60, 2, away)).toEqual({
      status: 1,
      auto: { status: 1, restore: 0 }
    })
  })

  it('keeps automatic status while idle time does not change the level', () => {
    const busy: AutoPresence = { status: 1, restore: 0 }
    expect(resolveIdlePresence(15 * 60, 1, busy)).toEqual({ status: 1, auto: busy })
  })

  it('does not override a manually chosen busy or away status', () => {
    expect(resolveIdlePresence(IDLE_AWAY_SECONDS, 1, null)).toEqual({ status: 1, auto: null })
    expect(resolveIdlePresence(IDLE_AWAY_SECONDS, 2, null)).toEqual({ status: 2, auto: null })
  })
})
