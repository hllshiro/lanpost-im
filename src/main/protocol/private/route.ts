import type { MessageInfo } from '../../../shared/domain'

// 私有消息号与文件号同一形式：秒级时间戳后接三位自增序号
export function nextPrivateSeq(now: number, seq: number): number {
  return now * 1000 + (seq % 1000)
}

// 已读回执只覆盖水位线以内、且还没回过执的私有入站消息
export function receiptsToSend(
  rows: MessageInfo[],
  watermark: number,
  sent: ReadonlySet<number>
): MessageInfo[] {
  return rows.filter((row) => row.id <= watermark && !sent.has(row.id))
}

// 超过等待送达确认期限、仍没有收到 1005/1006 的私有发送
export function outstandingToFail<T extends { sentAt: number }>(
  entries: Iterable<T>,
  now: number,
  deadlineMs: number
): T[] {
  return Array.from(entries).filter((entry) => now - entry.sentAt >= deadlineMs)
}
