import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from './db'
import { importLegacyHistory } from './import'
import { ConversationRepository, MessageRepository } from './repositories'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lanpost-import-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

describe('importLegacyHistory', () => {
  it('imports valid lines and skips malformed ones', () => {
    const dir = tempDir()
    const file = join(dir, 'history.jsonl')
    const content = [
      JSON.stringify({
        id: 1,
        remote_id: 11,
        peer: '10.0.0.1|alice',
        peer_name: '爱丽丝',
        dir: 'in',
        text: '你好，局域网',
        time: 1700000000000,
        status: 'delivered'
      }),
      JSON.stringify({
        id: 2,
        remote_id: '12',
        peer: '10.0.0.1|alice',
        peer_name: '爱丽丝',
        dir: 'out',
        text: '收到',
        time: 1700000001000,
        status: 'sent'
      }),
      '',
      '这一行不是 JSON',
      JSON.stringify({
        id: 3,
        remote_id: 20,
        peer: '',
        peer_name: '',
        dir: 'in',
        text: '缺少联系人',
        time: 1700000001500,
        status: 'sent'
      }),
      JSON.stringify({
        id: 4,
        remote_id: 21,
        peer: '10.0.0.2|bob',
        peer_name: '鲍勃',
        dir: 'in',
        text: '秒级时间',
        time: 1700000002,
        status: 'read'
      })
    ].join('\n')
    writeFileSync(file, content)

    const db = openDatabase(':memory:')
    const result = importLegacyHistory(db, dir)
    expect(result).toEqual({ imported: 3, skipped: 2 })

    const conversations = new ConversationRepository(db)
    const messages = new MessageRepository(db)

    const all = conversations.list()
    expect(all).toHaveLength(2)
    const alice = conversations.get('direct:10.0.0.1|alice')
    const bob = conversations.get('direct:10.0.0.2|bob')
    expect(alice?.title).toBe('爱丽丝')
    expect(alice?.kind).toBe('direct')
    expect(alice?.unread).toBe(0)
    expect(alice?.lastMessageAt).toBe(1700000001000)
    expect(bob?.title).toBe('鲍勃')
    expect(bob?.lastMessageAt).toBe(1700000002000)

    const aliceMessages = messages.list(alice!.id).messages
    expect(aliceMessages.map((message) => message.text)).toEqual(['你好，局域网', '收到'])
    expect(aliceMessages[0]).toMatchObject({
      direction: 'in',
      status: 'delivered',
      remoteSeq: 11,
      createdAt: 1700000000000,
      kind: 'text'
    })
    expect(aliceMessages[1]).toMatchObject({
      direction: 'out',
      status: 'sent',
      remoteSeq: 12,
      createdAt: 1700000001000
    })
    expect(aliceMessages[0].meta).toEqual({ legacy_id: '1' })
    expect(aliceMessages[1].meta).toEqual({ legacy_id: '2' })

    const bobMessages = messages.list(bob!.id).messages
    expect(bobMessages).toHaveLength(1)
    expect(bobMessages[0]).toMatchObject({ status: 'read', createdAt: 1700000002000 })
    expect(bobMessages[0].meta).toEqual({ legacy_id: '4' })

    expect(readFileSync(file, 'utf8')).toBe(content)

    db.close()
  })

  it('returns zero counts when the history file is missing', () => {
    const dir = tempDir()
    const db = openDatabase(':memory:')
    const result = importLegacyHistory(db, dir)
    expect(result).toEqual({ imported: 0, skipped: 0 })
    expect(new ConversationRepository(db).list()).toEqual([])
    db.close()
  })

  it('returns zero counts for an empty history file', () => {
    const dir = tempDir()
    const file = join(dir, 'history.jsonl')
    writeFileSync(file, '')
    const db = openDatabase(':memory:')
    expect(importLegacyHistory(db, dir)).toEqual({ imported: 0, skipped: 0 })
    expect(new ConversationRepository(db).list()).toEqual([])
    expect(readFileSync(file, 'utf8')).toBe('')
    db.close()
  })

  it('creates no conversation when every line is malformed', () => {
    const dir = tempDir()
    const file = join(dir, 'history.jsonl')
    const content = ['{', '[]', JSON.stringify({ id: 1, peer: '1|a' })].join('\n')
    writeFileSync(file, content)
    const db = openDatabase(':memory:')
    expect(importLegacyHistory(db, dir)).toEqual({ imported: 0, skipped: 3 })
    expect(new ConversationRepository(db).list()).toEqual([])
    db.close()
  })
})
