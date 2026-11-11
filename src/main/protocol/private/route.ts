import type { MessageInfo } from '../../../shared/domain'

// 私有消息号与文件号同一形式：秒级时间戳后接三位自增序号
export function nextPrivateSeq(now: number, seq: number): number {
  return now * 1000 + (seq % 1000)
}

// 私有通道是否应该承接这条消息：会话就绪时优先走私有；
// 只在私有通道出现过的联系人没有 IPMSG 端口，未就绪时也只能继续尝试私有。
export function shouldUsePrivate(ready: boolean, peerPort: number): boolean {
  return ready || peerPort <= 0
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
