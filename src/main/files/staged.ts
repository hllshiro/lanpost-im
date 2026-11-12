import { basename } from 'node:path'
import type { StagedAttachment } from '../../shared/domain'

export interface StagedSource {
  path: string
  size: number
  kind: StagedAttachment['kind']
  temporary: boolean
  // 落盘时改过名的内容保留原来的显示名
  name?: string
}

export interface StagedFile {
  path: string
  temporary: boolean
}

// 待发区：按会话保存还没发出去的附件，发送时按加入顺序逐个取出
export class StagedStore {
  private readonly lists = new Map<string, StagedAttachment[]>()
  private readonly files = new Map<string, StagedFile>()
  private seq = 0

  add(conversationId: string, sources: StagedSource[]): StagedAttachment[] {
    const list = this.lists.get(conversationId) ?? []
    for (const source of sources) {
      const id = `stg${++this.seq}`
      list.push({
        id,
        conversationId,
        name: source.name ?? basename(source.path),
        size: source.size,
        kind: source.kind,
        createdAt: Date.now()
      })
      this.files.set(id, { path: source.path, temporary: source.temporary })
    }
    this.lists.set(conversationId, list)
    return [...list]
  }

  list(conversationId: string): StagedAttachment[] {
    return [...(this.lists.get(conversationId) ?? [])]
  }

  all(): StagedAttachment[] {
    return [...this.lists.values()].flat()
  }

  file(id: string): StagedFile | undefined {
    return this.files.get(id)
  }

  // 发出或移除一个附件，返回它的磁盘信息，由调用方决定是否删掉临时文件
  take(conversationId: string, id: string): StagedFile | null {
    const list = this.lists.get(conversationId) ?? []
    const index = list.findIndex((item) => item.id === id)
    if (index < 0) return null
    list.splice(index, 1)
    const file = this.files.get(id) ?? null
    this.files.delete(id)
    return file
  }
}
