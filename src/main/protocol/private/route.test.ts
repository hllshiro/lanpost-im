import { describe, expect, it } from 'vitest'
import type { MessageInfo } from '../../../shared/domain'
import { nextPrivateSeq, outstandingToFail, receiptsToSend } from './route'

function message(overrides: Partial<MessageInfo> = {}): MessageInfo {
  return {
    id: 1,
    conversationId: 'direct:10.0.0.2|0123456789abcdef',
    direction: 'in',
    kind: 'text',
    text: '你好',
    remoteSeq: 1700000000001,
    status: 'delivered',
    createdAt: 1700000000000,
    meta: '{"source":"private","msgId":"1700000000001"}',
    ...overrides
  }
}

describe('private route helpers', () => {
  it('puts the second and the counter into the message id', () => {
    expect(nextPrivateSeq(1_700_000_000, 7)).toBe(1_700_000_000_007)
    expect(nextPrivateSeq(1_700_000_000, 0)).toBe(1_700_000_000_000)
    expect(nextPrivateSeq(1_700_000_000, 1000)).toBe(1_700_000_000_000)
    expect(nextPrivateSeq(1_700_000_000, 2)).toBeGreaterThan(nextPrivateSeq(1_700_000_000, 1))
  })

  it('selects receipts below the watermark that were not sent yet', () => {
    const rows = [
      message({ id: 1, remoteSeq: 100 }),
      message({ id: 2, remoteSeq: 200 }),
      message({ id: 3, remoteSeq: 300 })
    ]
    expect(receiptsToSend(rows, 2, new Set()).map((row) => row.id)).toEqual([1, 2])
    expect(receiptsToSend(rows, 3, new Set([1])).map((row) => row.id)).toEqual([2, 3])
    expect(receiptsToSend(rows, 0, new Set())).toEqual([])
    expect(receiptsToSend(rows, 2, new Set([1, 2]))).toEqual([])
    expect(receiptsToSend([], 5, new Set())).toEqual([])
  })

  it('fails only the sends that passed the deadline', () => {
    const entries = [
      { msgId: 1, sentAt: 0 },
      { msgId: 2, sentAt: 20_000 }
    ]
    expect(outstandingToFail(entries, 30_000, 30_000).map((entry) => entry.msgId)).toEqual([1])
    expect(outstandingToFail(entries, 29_999, 30_000)).toEqual([])
    expect(outstandingToFail(entries, 31_000, 30_000).map((entry) => entry.msgId)).toEqual([1])
    expect(outstandingToFail(entries, 50_000, 30_000).map((entry) => entry.msgId)).toEqual([1, 2])
    expect(outstandingToFail(new Map([[1, entries[0]]]).values(), 1_000, 30_000)).toEqual([])
  })
})
