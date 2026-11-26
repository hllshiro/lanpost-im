import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../store/db'
import { GatewayStore } from './store'
import { EventLog } from './events'

const dirs: string[] = []
const dbs: DatabaseSync[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-gateway-events-'))
  dirs.push(dir)
  return join(dir, 'events.db')
}

function open(path = ':memory:'): { db: DatabaseSync; store: GatewayStore } {
  const db = openDatabase(path)
  dbs.push(db)
  return { db, store: new GatewayStore(db) }
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close()
    } catch {
      // 已关闭的数据库忽略
    }
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('EventLog.append', () => {
  it('sequence 从 1 单调递增，信封字段完整', () => {
    const { store } = open()
    const log = new EventLog(store, { retentionHours: 24 })
    const first = log.append('message.received', { text: 'a' })
    const second = log.append('message.deliveryStatus', { status: 'delivered' })

    expect(first.sequence).toBe(1)
    expect(second.sequence).toBe(2)
    expect(first.eventId.startsWith('evt_')).toBe(true)
    expect(first.method).toBe('message.received')
    expect(first.data).toEqual({ text: 'a' })
    expect(log.pending(0)).toEqual([first, second])
  })

  it('sequence 跨重启继续，不复位', () => {
    const path = tempDbPath()
    const first = open(path)
    const logA = new EventLog(first.store, { retentionHours: 24 })
    logA.append('message.received', { n: 1 })
    logA.append('message.received', { n: 2 })
    first.db.close()
    dbs.splice(dbs.indexOf(first.db), 1)

    const second = open(path)
    const logB = new EventLog(second.store, { retentionHours: 24 })
    expect(logB.append('message.received', { n: 3 }).sequence).toBe(3)
    expect(logB.resume(0).latestSequence).toBe(3)
  })
})

describe('EventLog.pending 与 ack', () => {
  it('pending 只返回未 ACK 且大于游标的事件', () => {
    const { store } = open()
    const log = new EventLog(store, { retentionHours: 24 })
    const e1 = log.append('message.received', { n: 1 })
    const e2 = log.append('message.received', { n: 2 })
    const e3 = log.append('message.received', { n: 3 })
    log.ack(e1.eventId, e1.sequence)

    expect(log.pending(0).map((e) => e.sequence)).toEqual([2, 3])
    expect(log.pending(e2.sequence).map((e) => e.sequence)).toEqual([3])
    expect(log.pending(99)).toEqual([])
    expect(e3.sequence).toBe(3)
  })

  it('ack 幂等，重复 ack 不改变结果', () => {
    const { store } = open()
    const log = new EventLog(store, { retentionHours: 24 })
    const event = log.append('message.received', { n: 1 })

    expect(log.ack(event.eventId, event.sequence)).toBe(1)
    expect(log.ack(event.eventId, event.sequence)).toBe(1)
    expect(log.pending(0)).toEqual([])
  })
})

describe('EventLog.resume 与 cleanup', () => {
  it('resume 返回游标之后的未 ACK 事件与最新序号', () => {
    const { store } = open()
    const log = new EventLog(store, { retentionHours: 24 })
    const e1 = log.append('message.received', { n: 1 })
    log.append('message.received', { n: 2 })
    log.ack(e1.eventId, e1.sequence)

    const result = log.resume(e1.sequence)
    expect(result.expired).toBe(false)
    expect(result.latestSequence).toBe(2)
    expect(result.events.map((e) => e.sequence)).toEqual([2])
  })

  it('游标早于最小保留序号时标记 expired', () => {
    const { store } = open()
    const log = new EventLog(store, { retentionHours: 24 })
    const e1 = log.append('message.received', { n: 1 })
    const e2 = log.append('message.received', { n: 2 })
    log.append('message.received', { n: 3 })
    log.ack(e1.eventId, e1.sequence)
    log.ack(e2.eventId, e2.sequence)
    log.cleanup(Date.now() + 25 * 60 * 60 * 1000)

    const result = log.resume(1)
    expect(result.expired).toBe(true)
    expect(result.events.map((e) => e.sequence)).toEqual([3])
  })

  it('初始游标 0 永不 expired', () => {
    const { store } = open()
    const log = new EventLog(store, { retentionHours: 24 })
    const e1 = log.append('message.received', { n: 1 })
    log.ack(e1.eventId, e1.sequence)
    log.cleanup(Date.now() + 25 * 60 * 60 * 1000)

    expect(log.resume(0).expired).toBe(false)
  })

  it('cleanup 只删除已 ACK 且超过保留时间的事件', () => {
    const { store } = open()
    let now = 1_000_000
    const log = new EventLog(store, { retentionHours: 24, now: () => now })
    const acked = log.append('message.received', { n: 1 })
    const unacked = log.append('message.received', { n: 2 })
    log.ack(acked.eventId, acked.sequence)

    expect(log.cleanup(now + 60_000)).toEqual({ removed: 0 })
    now += 25 * 60 * 60 * 1000
    expect(log.cleanup(now)).toEqual({ removed: 1 })
    expect(log.pending(0).map((e) => e.sequence)).toEqual([unacked.sequence])
  })
})
