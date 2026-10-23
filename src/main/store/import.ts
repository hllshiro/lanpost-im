import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { MessageInfo } from '../../shared/domain'
import { ConversationRepository } from './repositories'

export interface ImportResult {
  imported: number
  skipped: number
}

interface LegacyRecord {
  id: string
  peer: string
  peerName: string
  direction: MessageInfo['direction']
  text: string
  time: number
  remoteSeq: number
  status: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseLegacyId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return null
}

function parseRemoteSeq(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value))
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed))
    }
  }
  return 0
}

function normalizeTime(value: number): number {
  if (value > 0 && value < 100_000_000_000) {
    return Math.round(value * 1000)
  }
  return Math.round(value)
}

function parseLegacyLine(line: string): LegacyRecord | null {
  let value: unknown
  try {
    value = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(value)) {
    return null
  }

  const id = parseLegacyId(value.id)
  const peer = typeof value.peer === 'string' ? value.peer.trim() : ''
  const direction = value.dir === 'in' || value.dir === 'out' ? value.dir : null
  const text = typeof value.text === 'string' ? value.text : null
  const time = typeof value.time === 'number' && Number.isFinite(value.time) ? value.time : null

  if (id === null || peer === '' || direction === null || text === null || time === null) {
    return null
  }

  const peerName =
    typeof value.peer_name === 'string' && value.peer_name.trim() !== '' ? value.peer_name : peer
  const status =
    typeof value.status === 'string' && value.status !== ''
      ? value.status
      : direction === 'out'
        ? 'sent'
        : 'delivered'

  return {
    id,
    peer,
    peerName,
    direction,
    text,
    time: normalizeTime(time),
    remoteSeq: parseRemoteSeq(value.remote_id),
    status
  }
}

export function importLegacyHistory(db: DatabaseSync, dataDir: string): ImportResult {
  const file = join(dataDir, 'history.jsonl')
  if (!existsSync(file)) {
    return { imported: 0, skipped: 0 }
  }

  const content = readFileSync(file, 'utf8')
  const conversations = new ConversationRepository(db)
  const insert = db.prepare(
    'INSERT INTO messages (conversation_id, direction, kind, text, remote_seq, status, created_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )

  let imported = 0
  let skipped = 0

  db.exec('BEGIN')
  try {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.replace(/^\uFEFF/, '').trim()
      if (line === '') {
        continue
      }
      const record = parseLegacyLine(line)
      if (record === null) {
        skipped += 1
        continue
      }
      const conversation = conversations.ensureDirect(record.peer, record.peerName)
      insert.run(
        conversation.id,
        record.direction,
        'text',
        record.text,
        record.remoteSeq,
        record.status,
        record.time,
        JSON.stringify({ legacy_id: record.id })
      )
      conversations.touch(conversation.id, record.time, 0)
      imported += 1
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return { imported, skipped }
}
