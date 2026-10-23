import type { MessageInfo } from '../../../shared/domain'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function initialOf(value: string): string {
  const characters = Array.from(value.trim())
  return characters.length > 0 ? characters[0].toUpperCase() : '?'
}

export function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function formatConversationTime(timestamp: number): string {
  if (!timestamp) return ''
  const today = startOfDay(Date.now())
  const day = startOfDay(timestamp)
  const days = Math.round((today - day) / 86400000)
  if (days <= 0) return formatClock(timestamp)
  if (days === 1) return '昨天'
  if (days < 7) return WEEKDAYS[new Date(timestamp).getDay()]
  const date = new Date(timestamp)
  if (date.getFullYear() === new Date().getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()}`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function formatDateDivider(timestamp: number): string {
  const today = startOfDay(Date.now())
  const day = startOfDay(timestamp)
  const days = Math.round((today - day) / 86400000)
  if (days === 0) return '今天'
  if (days === 1) return '昨天'
  const date = new Date(timestamp)
  if (date.getFullYear() === new Date().getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  if (unit === 0) return `${Math.round(value)} B`
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  return `${formatSize(bytesPerSecond)}/s`
}

export function previewText(message: MessageInfo): string {
  const text = message.text.replace(/\s+/g, ' ').trim()
  if (message.kind === 'file') return `[文件] ${text || '文件'}`
  if (message.kind === 'system') return text
  return text || '[消息]'
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'sending':
      return '发送中'
    case 'sent':
      return '已发送'
    case 'delivered':
      return '已送达'
    case 'read':
      return '已读'
    case 'failed':
      return '发送失败'
    default:
      return status
  }
}
