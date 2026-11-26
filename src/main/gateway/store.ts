import type { DatabaseSync } from 'node:sqlite'

/** gateway_* 表的行结构；字段名与 DDL 保持一致。 */

export interface GatewayEventRow {
  sequence: number
  event_id: string
  method: string
  payload: string
  created_at: number
  acked_at: number
}

export interface GatewayRequestRow {
  request_id: string
  method: string
  args_hash: string
  result: string
  created_at: number
}

export interface GatewayAttachmentRow {
  id: string
  kind: 'upload' | 'inbound'
  mime_type: string
  name: string
  size: number
  sha256: string
  path: string
  transfer_id: string
  state: 'pending' | 'ready' | 'consumed'
  message_id: string
  created_at: number
  expires_at: number
}

export interface GatewayMessageRow {
  id: string
  direction: 'out' | 'in'
  conversation_type: 'private' | 'group'
  conversation_id: string
  protocol_id: string
  group_id: string
  im_message_id: number
  nwt_msg_id: number
  status: 'queued' | 'delivered' | 'failed'
  content: string
  created_at: number
  updated_at: number
}

export class GatewayStore {
  constructor(private readonly db: DatabaseSync) {}

  appendEvent(input: {
    eventId: string
    method: string
    payload: string
    createdAt: number
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO gateway_events (event_id, method, payload, created_at) VALUES (?, ?, ?, ?)`
      )
      .run(input.eventId, input.method, input.payload, input.createdAt)
    return Number(result.lastInsertRowid)
  }

  pendingEvents(afterSequence: number): GatewayEventRow[] {
    return this.db
      .prepare(
        `SELECT * FROM gateway_events WHERE acked_at = 0 AND sequence > ? ORDER BY sequence ASC`
      )
      .all(afterSequence) as unknown as GatewayEventRow[]
  }

  ackedEvent(eventId: string): GatewayEventRow | null {
    const row = this.db
      .prepare(`SELECT * FROM gateway_events WHERE event_id = ? AND acked_at > 0`)
      .get(eventId)
    return (row as unknown as GatewayEventRow | undefined) ?? null
  }

  /** 标记已确认；重复 ack 幂等，返回当前最新 sequence。 */
  ackEvent(eventId: string, sequence: number, at: number): number {
    this.db
      .prepare(
        `UPDATE gateway_events SET acked_at = ? WHERE event_id = ? AND sequence = ? AND acked_at = 0`
      )
      .run(at, eventId, sequence)
    return this.latestSequence()
  }

  minSequence(): number | null {
    const row = this.db.prepare(`SELECT MIN(sequence) AS value FROM gateway_events`).get() as
      { value: number | null } | undefined
    return row?.value ?? null
  }

  latestSequence(): number {
    const row = this.db.prepare(`SELECT MAX(sequence) AS value FROM gateway_events`).get() as
      { value: number | null } | undefined
    return row?.value ?? 0
  }

  findRequest(requestId: string): GatewayRequestRow | null {
    const row = this.db
      .prepare(`SELECT * FROM gateway_requests WHERE request_id = ?`)
      .get(requestId)
    return (row as unknown as GatewayRequestRow | undefined) ?? null
  }

  saveRequest(row: GatewayRequestRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO gateway_requests (request_id, method, args_hash, result, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(row.request_id, row.method, row.args_hash, row.result, row.created_at)
  }

  insertAttachment(row: GatewayAttachmentRow): void {
    this.db
      .prepare(
        `INSERT INTO gateway_attachments
           (id, kind, mime_type, name, size, sha256, path, transfer_id, state, message_id, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.kind,
        row.mime_type,
        row.name,
        row.size,
        row.sha256,
        row.path,
        row.transfer_id,
        row.state,
        row.message_id,
        row.created_at,
        row.expires_at
      )
  }

  attachment(id: string): GatewayAttachmentRow | null {
    const row = this.db.prepare(`SELECT * FROM gateway_attachments WHERE id = ?`).get(id)
    return (row as unknown as GatewayAttachmentRow | undefined) ?? null
  }

  attachmentByTransfer(transferId: string): GatewayAttachmentRow | null {
    const row = this.db
      .prepare(`SELECT * FROM gateway_attachments WHERE transfer_id = ? ORDER BY created_at DESC`)
      .get(transferId)
    return (row as unknown as GatewayAttachmentRow | undefined) ?? null
  }

  markAttachmentConsumed(id: string, messageId: string): void {
    this.db
      .prepare(`UPDATE gateway_attachments SET state = 'consumed', message_id = ? WHERE id = ?`)
      .run(messageId, id)
  }

  markAttachmentReady(id: string, expiresAt: number): void {
    this.db
      .prepare(`UPDATE gateway_attachments SET state = 'ready', expires_at = ? WHERE id = ?`)
      .run(expiresAt, id)
  }

  attachmentsForCleanup(now: number): GatewayAttachmentRow[] {
    return this.db
      .prepare(
        `SELECT * FROM gateway_attachments WHERE expires_at > 0 AND expires_at <= ? ORDER BY expires_at ASC`
      )
      .all(now) as unknown as GatewayAttachmentRow[]
  }

  deleteAttachment(id: string): void {
    this.db.prepare(`DELETE FROM gateway_attachments WHERE id = ?`).run(id)
  }

  insertMessage(row: GatewayMessageRow): void {
    this.db
      .prepare(
        `INSERT INTO gateway_messages
           (id, direction, conversation_type, conversation_id, protocol_id, group_id,
            im_message_id, nwt_msg_id, status, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        row.id,
        row.direction,
        row.conversation_type,
        row.conversation_id,
        row.protocol_id,
        row.group_id,
        row.im_message_id,
        row.nwt_msg_id,
        row.status,
        row.content,
        row.created_at,
        row.updated_at
      )
  }

  messageById(id: string): GatewayMessageRow | null {
    const row = this.db.prepare(`SELECT * FROM gateway_messages WHERE id = ?`).get(id)
    return (row as unknown as GatewayMessageRow | undefined) ?? null
  }

  messageByNwt(conversationId: string, nwtMsgId: number): GatewayMessageRow | null {
    const row = this.db
      .prepare(`SELECT * FROM gateway_messages WHERE conversation_id = ? AND nwt_msg_id = ?`)
      .get(conversationId, nwtMsgId)
    return (row as unknown as GatewayMessageRow | undefined) ?? null
  }

  setMessageStatus(id: string, status: GatewayMessageRow['status'], at: number): void {
    this.db
      .prepare(`UPDATE gateway_messages SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, at, id)
  }

  pendingMessages(protocolId: string): GatewayMessageRow[] {
    return this.db
      .prepare(
        `SELECT * FROM gateway_messages
         WHERE direction = 'out' AND status = 'queued' AND protocol_id = ?
         ORDER BY created_at ASC`
      )
      .all(protocolId) as unknown as GatewayMessageRow[]
  }
}
