import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { FavoriteSticker } from '../../shared/domain'

interface FavoriteRow {
  id: string
  name: string
  path: string
  addedAt: number
  md5: string
}

const MAX_BYTES = 20 * 1024 * 1024

// 收藏的表情复制到数据目录，源文件被删也不影响
export class FavoriteStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  list(): FavoriteSticker[] {
    return this.rows().map((row) => ({
      id: row.id,
      name: row.name,
      addedAt: row.addedAt
    }))
  }

  add(sourcePath: string): FavoriteSticker {
    if (!existsSync(sourcePath)) throw new Error('图片已被移动或删除')
    const stats = statSync(sourcePath)
    if (!stats.isFile()) throw new Error('只能收藏图片')
    if (stats.size > MAX_BYTES) throw new Error('图片太大，无法收藏')
    const md5 = createHash('md5').update(readFileSync(sourcePath)).digest('hex')
    const duplicate = this.rows().find((row) => row.md5 === md5)
    if (duplicate !== undefined) {
      return { id: duplicate.id, name: duplicate.name, addedAt: duplicate.addedAt }
    }
    const id = randomBytes(8).toString('hex')
    const extension = extname(sourcePath).toLowerCase() || '.png'
    const name = basename(sourcePath)
    const target = join(this.dir, `${id}${extension}`)
    copyFileSync(sourcePath, target)
    const row: FavoriteRow = { id, name, path: target, addedAt: Date.now(), md5 }
    this.write([row, ...this.rows()])
    return { id, name, addedAt: row.addedAt }
  }

  remove(id: string): void {
    const rows = this.rows()
    const row = rows.find((item) => item.id === id)
    if (row === undefined) return
    rmSync(row.path, { force: true })
    this.write(rows.filter((item) => item.id !== id))
  }

  filePath(id: string): string | null {
    const row = this.rows().find((item) => item.id === id)
    if (row === undefined || !existsSync(row.path)) return null
    return row.path
  }

  private rows(): FavoriteRow[] {
    if (!existsSync(this.metaPath)) return []
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.metaPath, 'utf8'))
      if (!Array.isArray(parsed)) return []
      const rows: FavoriteRow[] = []
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue
        const record = item as Record<string, unknown>
        if (
          typeof record.id !== 'string' ||
          typeof record.name !== 'string' ||
          typeof record.path !== 'string' ||
          typeof record.addedAt !== 'number' ||
          typeof record.md5 !== 'string'
        ) {
          continue
        }
        if (!existsSync(record.path)) continue
        rows.push({
          id: record.id,
          name: record.name,
          path: record.path,
          addedAt: record.addedAt,
          md5: record.md5
        })
      }
      return rows
    } catch {
      return []
    }
  }

  private write(rows: FavoriteRow[]): void {
    writeFileSync(this.metaPath, `${JSON.stringify(rows, null, 2)}\n`)
  }

  private get metaPath(): string {
    return join(this.dir, 'favorites.json')
  }
}
