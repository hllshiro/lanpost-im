import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export interface FolderItemInfo {
  // 相对路径，统一用反斜杠，与真实客户端一致
  name: string
  dir: boolean
  size: number
  time: number
}

export interface FolderInfo {
  items: FolderItemInfo[]
  count: number
  totalSize: number
  maxPath: number
  maxSize: number
}

// 扫描目录，算出文件夹邀请里要填的项数、总大小、最长相对路径与最大单文件
export function scanFolder(root: string): FolderInfo {
  const items: FolderItemInfo[] = []
  walk(root, root, items)
  let totalSize = 0
  let maxPath = 0
  let maxSize = 0
  for (const item of items) {
    if (item.dir) continue
    totalSize += item.size
    maxSize = Math.max(maxSize, item.size)
    maxPath = Math.max(maxPath, item.name.length)
  }
  return { items, count: items.filter((item) => !item.dir).length, totalSize, maxPath, maxSize }
}

function walk(root: string, dir: string, items: FolderItemInfo[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    const name = relative(root, full).replaceAll('/', '\\')
    if (entry.isDirectory()) {
      // 真实客户端的清单里只有文件，目录靠文件路径隐式创建
      walk(root, full, items)
      continue
    }
    if (!entry.isFile()) continue
    items.push({
      name,
      dir: false,
      size: statSync(full).size,
      time: Math.floor(statSync(full).mtimeMs / 1000)
    })
  }
}
