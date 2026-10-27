import { join } from 'node:path'
import { sanitizeFileName } from './names'

export type ReceiveLayout = 'flat' | 'nickname'

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

function folderName(peerKey: string, peerName: string): string {
  const name = sanitizeFileName(peerName.replace(/[\\/]+/g, '_'))
  if (name !== '' && !RESERVED.test(name)) return name
  const fallback = sanitizeFileName(peerKey.replaceAll('|', '-'))
  return fallback === '' ? '未知联系人' : `未知联系人-${fallback}`
}

// 接收根目录：flat 表示全部放 base；nickname 表示按对端昵称建立子目录。
export function receiveFolder(
  base: string,
  layout: ReceiveLayout,
  peerKey: string,
  peerName: string
): string {
  if (layout === 'flat') return base
  return join(base, folderName(peerKey, peerName))
}
