import { existsSync, mkdirSync, statSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import type { FileState, FileTaskInfo } from '../../shared/domain'
import type { Attachment } from '../protocol/attach'
import { pullFile } from './client'
import { sanitizeFileName, uniqueName } from './names'
import { FileServer, type FileServeTarget, type GetFileRequest } from './server'

const MAX_ACTIVE_RECEIVES = 3
const PROGRESS_INTERVAL_MS = 200
const DEFAULT_USER = 'lanpost'
const DEFAULT_HOST = hostname()

export interface FileRecordBase {
  id: string
  peerKey: string
  peerIp: string
  peerPort: number
  name: string
  size: number
  mtime: number
  fileId: number
  packetId: number
  path: string
  state: FileState
  received: number
  error: string
  createdAt: number
  updatedAt: number
}

export interface IncomingFile extends FileRecordBase {
  direction: 'in'
}

export interface OutgoingFile extends FileRecordBase {
  direction: 'out'
}

export type FileRecord = IncomingFile | OutgoingFile

export interface FileManagerIdentity {
  user: string
  host: string
  seq: number
}

export interface FileManagerCallbacks {
  onUpdate(file: FileTaskInfo): void
  onLog(message: string): void
  onError(error: Error): void
}

export interface FileManagerOptions {
  bindAddr: string
  port: number
  receiveDir: string
  notifyAccepted: (peerKey: string, packetId: number) => void
  callbacks: FileManagerCallbacks
  // 取文件请求的报文头字段。控制器接入时传入协议账号、主机与递增序号。
  identity?: () => FileManagerIdentity
}

export interface OfferIncomingInput {
  peerKey: string
  peerIp: string
  peerPort: number
  packetId: number
  attachments: Attachment[]
}

export interface AddOutgoingInput {
  id?: string
  peerKey: string
  peerIp: string
  peerPort: number
  name: string
  size: number
  mtime: number
  fileId: number
  packetId: number
  path: string
}

interface QueueEntry {
  task: IncomingFile
  signal: AbortSignal
  resolve: () => void
}

function normalizeIp(ip: string): string {
  return ip.toLowerCase().replace(/^::ffff:/, '')
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}

export class FileManager {
  private readonly options: FileManagerOptions
  private readonly server: FileServer
  private readonly tasks = new Map<string, FileRecord>()
  private readonly order: string[] = []
  private readonly publishedAt = new Map<string, number>()
  private readonly aborts = new Map<string, AbortController>()
  private readonly running = new Set<Promise<void>>()
  private readonly queue: QueueEntry[] = []
  private active = 0
  private incomingSeq = 0
  private internalSeq = Math.floor(Date.now() / 1000)
  private stopping = false

  constructor(options: FileManagerOptions) {
    this.options = options
    this.server = new FileServer({
      bindAddr: options.bindAddr,
      port: options.port,
      resolve: (request) => this.resolveOutgoing(request),
      onLog: options.callbacks.onLog,
      onError: options.callbacks.onError
    })
  }

  async start(): Promise<void> {
    mkdirSync(this.options.receiveDir, { recursive: true })
    this.stopping = false
    await this.server.start()
    const address = this.server.address()
    this.options.callbacks.onLog(
      `文件服务启动: TCP ${address.address}:${address.port}，接收目录 ${this.options.receiveDir}`
    )
  }

  async stop(): Promise<void> {
    this.stopping = true
    for (const entry of this.queue.splice(0)) {
      const task = entry.task
      if (task.state === 'transferring') {
        task.state = 'failed'
        task.error = '应用正在退出'
        this.touch(task)
        this.publish(task, true)
      }
      entry.resolve()
    }
    for (const controller of this.aborts.values()) {
      controller.abort()
    }
    await Promise.allSettled([...this.running])
    await this.server.stop()
    this.options.callbacks.onLog('文件服务已停止')
  }

  address(): { address: string; port: number } {
    return this.server.address()
  }

  offerIncoming(input: OfferIncomingInput): IncomingFile[] {
    const created: IncomingFile[] = []
    for (const attachment of input.attachments) {
      const rawName = sanitizeFileName(attachment.name)
      const now = Date.now()
      this.incomingSeq += 1
      const id = `in-${now.toString(36)}-${this.incomingSeq.toString(36)}`
      const name = uniqueName(
        this.options.receiveDir,
        rawName === '' ? 'file' : rawName,
        (candidate) => this.isNameReserved(id, candidate)
      )
      const task: IncomingFile = {
        direction: 'in',
        id,
        peerKey: input.peerKey,
        peerIp: input.peerIp,
        peerPort: input.peerPort,
        name,
        size: attachment.size,
        mtime: attachment.mtime,
        fileId: attachment.id,
        packetId: input.packetId,
        path: '',
        state: 'waiting',
        received: 0,
        error: '',
        createdAt: now,
        updatedAt: now
      }
      this.tasks.set(id, task)
      this.order.push(id)
      this.publish(task, true)
      created.push({ ...task })
    }
    return created
  }

  accept(id: string): Promise<void> {
    const task = this.requireIncoming(id)
    if (this.stopping) {
      throw new Error('文件服务正在停止')
    }
    if (task.state !== 'waiting') {
      throw new Error(`文件任务当前不可接收: ${task.name}`)
    }
    task.state = 'transferring'
    task.path = ''
    task.error = ''
    this.touch(task)
    try {
      this.options.notifyAccepted(task.peerKey, task.packetId)
    } catch (error) {
      task.state = 'failed'
      task.error = toError(error).message
      this.touch(task)
      this.publish(task, true)
      throw error
    }
    this.publish(task, true)
    const controller = new AbortController()
    this.aborts.set(id, controller)
    return new Promise<void>((resolve) => {
      this.queue.push({ task, signal: controller.signal, resolve })
      this.pump()
    })
  }

  reject(id: string): void {
    const task = this.requireIncoming(id)
    if (task.state !== 'waiting') {
      throw new Error(`文件任务当前不可拒绝: ${task.name}`)
    }
    task.state = 'rejected'
    task.error = ''
    this.touch(task)
    this.publish(task, true)
  }

  addOutgoing(input: AddOutgoingInput): OutgoingFile {
    if (!existsSync(input.path) || !statSync(input.path).isFile()) {
      throw new Error(`发送文件不存在: ${input.path}`)
    }
    const now = Date.now()
    const id = input.id ?? `out-${now.toString(36)}-${input.fileId.toString(16)}`
    if (this.tasks.has(id)) {
      throw new Error(`文件任务已存在: ${id}`)
    }
    const name = sanitizeFileName(input.name)
    const fallbackName = sanitizeFileName(input.path)
    const task: OutgoingFile = {
      direction: 'out',
      id,
      peerKey: input.peerKey,
      peerIp: input.peerIp,
      peerPort: input.peerPort,
      name: name !== '' ? name : fallbackName !== '' ? fallbackName : 'file',
      size: input.size,
      mtime: input.mtime,
      fileId: input.fileId,
      packetId: input.packetId,
      path: input.path,
      state: 'offered',
      received: 0,
      error: '',
      createdAt: now,
      updatedAt: now
    }
    this.tasks.set(id, task)
    this.order.push(id)
    this.publish(task, true)
    return { ...task }
  }

  cancel(id: string): void {
    const task = this.tasks.get(id)
    if (task === undefined) {
      throw new Error(`文件任务不存在: ${id}`)
    }
    if (
      task.state === 'done' ||
      task.state === 'failed' ||
      task.state === 'rejected' ||
      task.state === 'canceled'
    ) {
      throw new Error(`文件任务已经结束: ${task.name}`)
    }
    task.state = 'canceled'
    task.error = ''
    this.touch(task)
    this.publish(task, true)
    this.aborts.get(id)?.abort()
  }

  list(): FileTaskInfo[] {
    return this.order
      .map((id) => this.tasks.get(id))
      .filter((task): task is FileRecord => task !== undefined)
      .map((task) => this.toInfo(task))
  }

  get(id: string): FileRecord | null {
    const task = this.tasks.get(id)
    return task === undefined ? null : { ...task }
  }

  private requireIncoming(id: string): IncomingFile {
    const task = this.tasks.get(id)
    if (task === undefined || task.direction !== 'in') {
      throw new Error(`文件任务不存在: ${id}`)
    }
    return task
  }

  private isNameReserved(selfId: string, candidate: string): boolean {
    for (const task of this.tasks.values()) {
      if (task.id === selfId || task.direction !== 'in') {
        continue
      }
      if (task.state === 'rejected' || task.state === 'canceled') {
        continue
      }
      if (task.name === candidate) {
        return true
      }
    }
    return false
  }

  private pump(): void {
    while (!this.stopping && this.active < MAX_ACTIVE_RECEIVES && this.queue.length > 0) {
      const entry = this.queue.shift()
      if (entry === undefined) {
        return
      }
      this.active += 1
      const running = this.runPull(entry).finally(() => {
        this.active -= 1
        this.running.delete(running)
        this.pump()
      })
      this.running.add(running)
    }
  }

  private async runPull(entry: QueueEntry): Promise<void> {
    const task = entry.task
    try {
      if (entry.signal.aborted) {
        throw new Error('文件接收已取消')
      }
      const name = uniqueName(this.options.receiveDir, task.name, (candidate) =>
        this.isNameReserved(task.id, candidate)
      )
      task.name = name
      task.path = join(this.options.receiveDir, name)
      const identity = this.identity()
      const written = await pullFile({
        peerIp: task.peerIp,
        peerPort: task.peerPort,
        packetId: task.packetId,
        fileId: task.fileId,
        seq: identity.seq,
        user: identity.user,
        host: identity.host,
        path: task.path,
        size: task.size,
        signal: entry.signal,
        onProgress: (received) => {
          task.received = received
          this.touch(task)
          this.publish(task, false)
        }
      })
      task.received = written
      task.state = 'done'
      task.error = ''
      this.touch(task)
      this.publish(task, true)
    } catch (error) {
      const failure = toError(error)
      if (entry.signal.aborted) {
        task.path = ''
        if (this.stopping) {
          task.state = 'failed'
          task.error = '应用正在退出'
        } else {
          task.state = 'canceled'
          task.error = ''
        }
      } else {
        task.state = 'failed'
        task.error = failure.message
        task.path = ''
        this.options.callbacks.onError(failure)
      }
      task.received = 0
      this.touch(task)
      this.publish(task, true)
    } finally {
      this.aborts.delete(task.id)
      entry.resolve()
    }
  }

  private resolveOutgoing(request: GetFileRequest): FileServeTarget | null {
    const task = this.findOutgoing(request.packetId, request.fileIds, request.remoteIp)
    if (task === null) {
      return null
    }
    return {
      path: task.path,
      onStart: () => {
        if (task.state === 'canceled') {
          return
        }
        task.state = 'transferring'
        task.received = 0
        task.error = ''
        this.touch(task)
        this.publish(task, true)
      },
      onProgress: (sent) => {
        if (task.state === 'canceled') {
          return
        }
        task.received = sent
        this.touch(task)
        this.publish(task, false)
      },
      onDone: (sent) => {
        if (task.state === 'canceled') {
          return
        }
        task.received = sent
        task.state = 'done'
        task.error = ''
        this.touch(task)
        this.publish(task, true)
      },
      onError: (error) => {
        if (task.state !== 'canceled') {
          task.state = 'failed'
          task.error = error.message
          this.touch(task)
          this.publish(task, true)
          this.options.callbacks.onError(error)
        }
      }
    }
  }

  private findOutgoing(packetId: number, fileIds: number[], remoteIp: string): OutgoingFile | null {
    const remote = normalizeIp(remoteIp)
    let fileFallback: OutgoingFile | null = null
    let newest: OutgoingFile | null = null
    for (const task of this.tasks.values()) {
      if (task.direction !== 'out') {
        continue
      }
      if (task.state === 'canceled' || task.state === 'rejected' || task.state === 'failed') {
        continue
      }
      const samePeer = remote === '' || normalizeIp(task.peerIp) === remote
      if (packetId !== 0 && task.packetId === packetId && samePeer) {
        return task
      }
      if (fileIds.includes(task.fileId)) {
        if (samePeer) {
          return task
        }
        if (fileFallback === null) {
          fileFallback = task
        }
      }
      if ((task.state === 'offered' || task.state === 'transferring') && samePeer) {
        if (newest === null || task.createdAt > newest.createdAt) {
          newest = task
        }
      }
    }
    // 内网通部分版本会回传自己的文件标识。按对端取最新的待发送任务作为兜底。
    return newest ?? fileFallback
  }

  private identity(): FileManagerIdentity {
    if (this.options.identity !== undefined) {
      return this.options.identity()
    }
    this.internalSeq += 1
    return { user: DEFAULT_USER, host: DEFAULT_HOST, seq: this.internalSeq }
  }

  private touch(task: FileRecord): void {
    task.updatedAt = Date.now()
  }

  private publish(task: FileRecord, force: boolean): void {
    const now = Date.now()
    const last = this.publishedAt.get(task.id)
    if (!force && last !== undefined && now - last < PROGRESS_INTERVAL_MS) {
      return
    }
    this.publishedAt.set(task.id, now)
    this.options.callbacks.onUpdate(this.toInfo(task))
  }

  private toInfo(task: FileRecord): FileTaskInfo {
    return {
      id: task.id,
      messageId: null,
      conversationId: '',
      peerKey: task.peerKey,
      direction: task.direction,
      name: task.name,
      size: task.size,
      mtime: task.mtime,
      fileId: String(task.fileId),
      packetId: task.packetId,
      path: task.path,
      state: task.state,
      received: task.received,
      error: task.error,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
  }
}
