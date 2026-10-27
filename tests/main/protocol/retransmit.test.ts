import { afterEach, describe, expect, it, vi } from 'vitest'
import { Retransmitter } from '../../../src/main/protocol/retransmit'

afterEach(() => {
  vi.useRealTimers()
})

describe('Retransmitter', () => {
  it('retries four times and then reports failure once', () => {
    vi.useFakeTimers()
    const attempts: number[] = []
    const failed: Array<[string, number]> = []
    const retransmitter = new Retransmitter({
      intervalMs: 1000,
      maxTries: 4,
      onFailed: (peerKey, seq) => failed.push([peerKey, seq])
    })
    retransmitter.add({ seq: 7, peerKey: 'p', send: () => attempts.push(Date.now()) })

    vi.advanceTimersByTime(4000)
    expect(attempts).toHaveLength(4)
    expect(failed).toEqual([])

    vi.advanceTimersByTime(1000)
    expect(attempts).toHaveLength(4)
    expect(failed).toEqual([['p', 7]])
    expect(retransmitter.size()).toBe(0)
  })

  it('stops retrying after an ack', () => {
    vi.useFakeTimers()
    let attempts = 0
    const retransmitter = new Retransmitter({ intervalMs: 1000, maxTries: 4 })
    retransmitter.add({ seq: 9, peerKey: 'p', send: () => (attempts += 1) })
    vi.advanceTimersByTime(1000)
    retransmitter.ack(9)
    vi.advanceTimersByTime(5000)
    expect(attempts).toBe(1)
    expect(retransmitter.size()).toBe(0)
  })

  it('clears everything on stop', () => {
    vi.useFakeTimers()
    let attempts = 0
    const retransmitter = new Retransmitter({ intervalMs: 1000 })
    retransmitter.add({ seq: 1, peerKey: 'p', send: () => (attempts += 1) })
    retransmitter.stop()
    vi.advanceTimersByTime(5000)
    expect(attempts).toBe(0)
  })
})
