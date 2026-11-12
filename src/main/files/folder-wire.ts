import type { FolderFrame } from './folder-types'

export type { FolderFrame } from './folder-types'

export const FOLDER_PROTO = 2
export const FOLDER_HEADER_SIZE = 12

export const FOLDER_CMD_START = 1
export const FOLDER_CMD_ACCEPT = 2
export const FOLDER_CMD_MANIFEST = 3
export const FOLDER_CMD_PROGRESS = 4
export const FOLDER_CMD_DATA = 5
export const FOLDER_CMD_ITEM_RECEIVED = 6
export const FOLDER_CMD_ITEM_SENT = 7
export const FOLDER_CMD_ITEM_CONFIRM = 8

export const FOLDER_START_SIZE = 684
export const FOLDER_ACCEPT_SIZE = 672
export const FOLDER_TASK_OFFSET = 0x20
export const FOLDER_TASK_BYTES = 300
export const FOLDER_MANIFEST_HEADER = 0x4c
export const FOLDER_MANIFEST_ITEM = 0x27b
export const FOLDER_PROGRESS_HEADER = 0x4c
export const FOLDER_PROGRESS_ITEM = 0x1a
export const FOLDER_DATA_HEADER = 0x36
export const FOLDER_CHUNK_SIZE = 32 * 1024

const START_COUNT_OFFSET = 0x278
const START_SIZE_OFFSET = 0x27c
const ITEM_NAME_BYTES = 600
const ITEM_TYPE_OFFSET = 0x258
const ITEM_INDEX_OFFSET = 0x259
const ITEM_SIZE_OFFSET = 0x25d
const ITEM_TIME_OFFSET = 0x265

const MAX_FRAME_BYTES = 8 * 1024 * 1024

export interface FolderItem {
  name: string
  dir: boolean
  index: number
  size: number
  // Unix 秒
  time: number
}

export interface FolderProgress {
  index: number
  offset: number
  action: number
}

export function encodeFolderFrame(cmd: number, body: Buffer): Buffer {
  const frame = Buffer.alloc(FOLDER_HEADER_SIZE + body.length)
  frame.writeUInt32BE(frame.length, 0)
  frame.writeUInt32BE(FOLDER_PROTO, 4)
  frame.writeUInt32BE(cmd, 8)
  body.copy(frame, FOLDER_HEADER_SIZE)
  return frame
}

export function decodeFolderFrame(frame: Buffer): FolderFrame {
  if (frame.length < FOLDER_HEADER_SIZE) {
    throw new Error(`文件夹通道帧太短: ${frame.length}`)
  }
  const length = frame.readUInt32BE(0)
  if (length !== frame.length) {
    throw new Error(`文件夹通道帧长度不一致: 头 ${length} 实际 ${frame.length}`)
  }
  const proto = frame.readUInt32BE(4)
  if (proto !== FOLDER_PROTO) {
    throw new Error(`文件夹通道协议号不对: ${proto}`)
  }
  return {
    cmd: frame.readUInt32BE(8),
    body: frame.subarray(FOLDER_HEADER_SIZE)
  }
}

function writeTaskId(body: Buffer, taskId: string): void {
  body.write(taskId, FOLDER_TASK_OFFSET - FOLDER_HEADER_SIZE, 'utf16le')
}

function readTaskId(body: Buffer): string {
  return readWide(body, FOLDER_TASK_OFFSET - FOLDER_HEADER_SIZE, FOLDER_TASK_BYTES / 2)
}

function readWide(body: Buffer, offset: number, chars: number): string {
  const limit = Math.min(chars, Math.floor((body.length - offset) / 2))
  const parts: string[] = []
  for (let index = 0; index < limit; index += 1) {
    const code = body.readUInt16LE(offset + index * 2)
    if (code === 0) break
    parts.push(String.fromCharCode(code))
  }
  return parts.join('')
}

// 1：发送方开场，带任务号、清单项数与总字节数
export function buildStart(taskId: string, count: number, totalSize: number): Buffer {
  const body = Buffer.alloc(FOLDER_START_SIZE - FOLDER_HEADER_SIZE)
  writeTaskId(body, taskId)
  body.writeUInt32BE(count, START_COUNT_OFFSET - FOLDER_HEADER_SIZE)
  body.writeBigUInt64BE(BigInt(totalSize), START_SIZE_OFFSET - FOLDER_HEADER_SIZE)
  return encodeFolderFrame(FOLDER_CMD_START, body)
}

export function parseStart(body: Buffer): { taskId: string; count: number; totalSize: number } {
  return {
    taskId: readTaskId(body),
    count: body.readUInt32BE(START_COUNT_OFFSET - FOLDER_HEADER_SIZE),
    totalSize: Number(body.readBigUInt64BE(START_SIZE_OFFSET - FOLDER_HEADER_SIZE))
  }
}

// 2：接收方接受，原样回任务号
export function buildAccept(taskId: string): Buffer {
  const body = Buffer.alloc(FOLDER_ACCEPT_SIZE - FOLDER_HEADER_SIZE)
  writeTaskId(body, taskId)
  return encodeFolderFrame(FOLDER_CMD_ACCEPT, body)
}

export function parseAccept(body: Buffer): string {
  return readTaskId(body)
}

// 3：清单，每项 635 字节，名称是相对路径
export function buildManifest(items: FolderItem[]): Buffer {
  const body = Buffer.alloc(
    FOLDER_MANIFEST_HEADER - FOLDER_HEADER_SIZE + items.length * FOLDER_MANIFEST_ITEM
  )
  body.writeUInt32BE(items.length, 0x20 - FOLDER_HEADER_SIZE)
  for (const item of items) {
    const base = FOLDER_MANIFEST_HEADER - FOLDER_HEADER_SIZE + item.index * FOLDER_MANIFEST_ITEM
    body.write(item.name, base, ITEM_NAME_BYTES, 'utf16le')
    body.writeUInt8(item.dir ? 2 : 1, base + ITEM_TYPE_OFFSET)
    body.writeUInt32BE(item.index, base + ITEM_INDEX_OFFSET)
    body.writeBigUInt64BE(BigInt(item.size), base + ITEM_SIZE_OFFSET)
    body.writeBigUInt64BE(BigInt(item.time), base + ITEM_TIME_OFFSET)
  }
  return encodeFolderFrame(FOLDER_CMD_MANIFEST, body)
}

export function parseManifest(body: Buffer): FolderItem[] {
  const count = body.readUInt32BE(0x20 - FOLDER_HEADER_SIZE)
  const items: FolderItem[] = []
  for (let index = 0; index < count; index += 1) {
    const base = FOLDER_MANIFEST_HEADER - FOLDER_HEADER_SIZE + index * FOLDER_MANIFEST_ITEM
    if (base + FOLDER_MANIFEST_ITEM > body.length) break
    items.push({
      name: readWide(body, base, ITEM_NAME_BYTES / 2),
      dir: body.readUInt8(base + ITEM_TYPE_OFFSET) === 2,
      index: body.readUInt32BE(base + ITEM_INDEX_OFFSET),
      size: Number(body.readBigUInt64BE(base + ITEM_SIZE_OFFSET)),
      time: Number(body.readBigUInt64BE(base + ITEM_TIME_OFFSET))
    })
  }
  return items
}

// 4：接收方的进度/续传，每项 26 字节
export function buildProgress(entries: FolderProgress[]): Buffer {
  const body = Buffer.alloc(
    FOLDER_PROGRESS_HEADER - FOLDER_HEADER_SIZE + entries.length * FOLDER_PROGRESS_ITEM
  )
  body.writeUInt32BE(entries.length, 0x20 - FOLDER_HEADER_SIZE)
  entries.forEach((entry, index) => {
    const base = FOLDER_PROGRESS_HEADER - FOLDER_HEADER_SIZE + index * FOLDER_PROGRESS_ITEM
    body.writeUInt32BE(entry.index, base)
    body.writeBigUInt64BE(BigInt(entry.offset), base + 4)
    body.writeUInt32BE(entry.action, base + 12)
  })
  return encodeFolderFrame(FOLDER_CMD_PROGRESS, body)
}

export function parseProgress(body: Buffer): FolderProgress[] {
  const count = body.readUInt32BE(0x20 - FOLDER_HEADER_SIZE)
  const entries: FolderProgress[] = []
  for (let index = 0; index < count; index += 1) {
    const base = FOLDER_PROGRESS_HEADER - FOLDER_HEADER_SIZE + index * FOLDER_PROGRESS_ITEM
    if (base + FOLDER_PROGRESS_ITEM > body.length) break
    entries.push({
      index: body.readUInt32BE(base),
      offset: Number(body.readBigUInt64BE(base + 4)),
      action: body.readUInt32BE(base + 12)
    })
  }
  return entries
}

// 5：数据块，action=2 是项开头，0 是普通数据
export function buildData(index: number, action: number, chunk: Buffer): Buffer {
  const body = Buffer.alloc(FOLDER_DATA_HEADER - FOLDER_HEADER_SIZE + chunk.length)
  body.writeUInt32BE(index, 0x20 - FOLDER_HEADER_SIZE)
  body.writeUInt32BE(chunk.length, 0x24 - FOLDER_HEADER_SIZE)
  body.writeUInt32BE(action, 0x28 - FOLDER_HEADER_SIZE)
  chunk.copy(body, FOLDER_DATA_HEADER - FOLDER_HEADER_SIZE)
  return encodeFolderFrame(FOLDER_CMD_DATA, body)
}

export function parseData(body: Buffer): { index: number; action: number; chunk: Buffer } {
  const length = body.readUInt32BE(0x24 - FOLDER_HEADER_SIZE)
  return {
    index: body.readUInt32BE(0x20 - FOLDER_HEADER_SIZE),
    action: body.readUInt32BE(0x28 - FOLDER_HEADER_SIZE),
    chunk: body.subarray(
      FOLDER_DATA_HEADER - FOLDER_HEADER_SIZE,
      FOLDER_DATA_HEADER - FOLDER_HEADER_SIZE + length
    )
  }
}

// 6/7/8：项级回执，带项序号与已收/已发字节数
export function buildItemAck(cmd: number, index: number, offset: number, action = 0): Buffer {
  const size = cmd === FOLDER_CMD_ITEM_RECEIVED ? 58 : 72
  const body = Buffer.alloc(size - FOLDER_HEADER_SIZE)
  body.writeUInt32BE(index, 0x20 - FOLDER_HEADER_SIZE)
  body.writeBigUInt64BE(BigInt(offset), 0x24 - FOLDER_HEADER_SIZE)
  body.writeUInt32BE(action, 0x2c - FOLDER_HEADER_SIZE)
  return encodeFolderFrame(cmd, body)
}

export function parseItemAck(body: Buffer): { index: number; offset: number; action: number } {
  return {
    index: body.readUInt32BE(0x20 - FOLDER_HEADER_SIZE),
    offset: Number(body.readBigUInt64BE(0x24 - FOLDER_HEADER_SIZE)),
    action: body.readUInt32BE(0x2c - FOLDER_HEADER_SIZE)
  }
}

// 从字节流里按 u32 长度切帧
export class FolderFrameReader {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): FolderFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: FolderFrame[] = []
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length < FOLDER_HEADER_SIZE || length > MAX_FRAME_BYTES) {
        throw new Error(`文件夹通道帧长异常: ${length}`)
      }
      if (this.buffer.length < length) break
      frames.push(decodeFolderFrame(this.buffer.subarray(0, length)))
      this.buffer = this.buffer.subarray(length)
    }
    return frames
  }
}
