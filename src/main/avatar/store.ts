import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// 头像文件按 md5 命名，和真实客户端的 Syl/cache/face 一致；扩展名无关
export class AvatarStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true })
  }

  static md5(data: Buffer): string {
    return createHash('md5').update(data).digest('hex')
  }

  path(md5: string): string {
    return join(this.dir, md5)
  }

  has(md5: string): boolean {
    return md5 !== '' && existsSync(this.path(md5))
  }

  read(md5: string): Buffer | null {
    if (!this.has(md5)) return null
    return readFileSync(this.path(md5))
  }

  put(md5: string, data: Buffer): string {
    const path = this.path(md5)
    writeFileSync(path, data)
    return path
  }
}
