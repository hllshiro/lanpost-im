// 内网通私有文件通道的 TCP 分帧。每条消息是 [u32 总长][u32 版本][u32 类型][消息体]，
// 总长包含这 12 字节头部。消息体都是定长结构，字符串按 UTF-16LE 写进固定位置。
// 字段偏移来自真实客户端 3.4.3055 的抓包，见 nwt-re/cap/session1.pcapng。

export const FILE_WIRE_VERSION = 1

export const FILE_FRAME_HELLO = 1
export const FILE_FRAME_ACK = 2
export const FILE_FRAME_PATH = 3
export const FILE_FRAME_DATA = 4
// 反向连接时发送方先发的一条窗口消息，接收方不解析内容，直接进入握手
export const FILE_FRAME_WINDOW = 100
export const FILE_WINDOW_BODY_SIZE = 548

export const FILE_CHUNK_SIZE = 32 * 1024
export const FILE_HEADER_SIZE = 12
export const FILE_HELLO_BODY_SIZE = 488
export const FILE_CONTROL_BODY_SIZE = 96
export const FILE_DATA_HEADER_SIZE = 88

const HELLO_SELF_ID_OFFSET = 17
const HELLO_FILE_ID_OFFSET = 44
const HELLO_PEER_ID_OFFSET = 51
const HELLO_XML_OFFSET = 81

const CONTROL_FILE_ID_OFFSET = 44
const ACK_SIZE_OFFSET = 52
const ACK_TIME_OFFSET = 60

const PATH_DIR_OFFSET = 0
const PATH_DIR_CHARS = 22
const PATH_NAME_OFFSET = 56
const PATH_NAME_CHARS = 20

const DATA_FILE_ID_OFFSET = 44
const DATA_SIZE_OFFSET = 52
const DATA_OFFSET_OFFSET = 60
const DATA_CHUNK_OFFSET = 64

const MAX_FRAME_BYTES = 64 * 1024 * 1024

export interface FileFrame {
  type: number
  body: Buffer
}

export interface HelloBody {
  selfId: string
  peerId: string
  fileId: number
  xml: string
}

export interface AckBody {
  fileId: number
  size: number
  time: number
}

export interface PathBody {
  dir: string
  fileId: number
  name: string
}

export interface DataHeader {
  fileId: number
  size: number
  offset: number
  chunkSize: number
}

export function encodeFileFrame(type: number, body: Buffer): Buffer {
  const frame = Buffer.alloc(FILE_HEADER_SIZE + body.length)
  frame.writeUInt32BE(frame.length, 0)
  frame.writeUInt32BE(FILE_WIRE_VERSION, 4)
  frame.writeUInt32BE(type, 8)
  body.copy(frame, FILE_HEADER_SIZE)
  return frame
}

export class FileFrameReader {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): FileFrame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: FileFrame[] = []
    while (this.buffer.length >= FILE_HEADER_SIZE) {
      const total = this.buffer.readUInt32BE(0)
      const type = this.buffer.readUInt32BE(8)
      if (total < FILE_HEADER_SIZE || total > MAX_FRAME_BYTES) {
        throw new Error(`私有文件通道帧长度异常: ${total}`)
      }
      if (this.buffer.length < total) break
      frames.push({ type, body: this.buffer.subarray(FILE_HEADER_SIZE, total) })
      this.buffer = this.buffer.subarray(total)
    }
    return frames
  }
}

function writeString(body: Buffer, offset: number, maxChars: number, value: string): void {
  const limit = Math.min(maxChars, Math.floor((body.length - offset) / 2))
  const text = value.slice(0, limit)
  body.write(text, offset, 'utf16le')
}

function readString(body: Buffer, offset: number, maxChars: number): string {
  const limit = Math.min(maxChars, Math.floor((body.length - offset) / 2))
  let text = ''
  for (let index = 0; index < limit; index += 1) {
    const code = body.readUInt16LE(offset + index * 2)
    if (code === 0) break
    text += String.fromCharCode(code)
  }
  return text
}

export function buildHello(input: {
  selfId: string
  peerId: string
  fileId: number
  xml: string
}): Buffer {
  const body = Buffer.alloc(FILE_HELLO_BODY_SIZE)
  writeString(body, HELLO_SELF_ID_OFFSET, 12, input.selfId)
  body.writeUInt32BE(input.fileId % 0x100000000, HELLO_FILE_ID_OFFSET)
  writeString(body, HELLO_PEER_ID_OFFSET, 15, input.peerId)
  writeString(body, HELLO_XML_OFFSET, 203, input.xml)
  return body
}

export function parseHello(body: Buffer): HelloBody {
  return {
    selfId: readString(body, HELLO_SELF_ID_OFFSET, 12),
    peerId: readString(body, HELLO_PEER_ID_OFFSET, 15),
    fileId: body.readUInt32BE(HELLO_FILE_ID_OFFSET),
    xml: readString(body, HELLO_XML_OFFSET, 203)
  }
}

export function buildAck(input: { fileId: number; size: number; time: number }): Buffer {
  const body = Buffer.alloc(FILE_CONTROL_BODY_SIZE)
  body.writeUInt32BE(input.fileId % 0x100000000, CONTROL_FILE_ID_OFFSET)
  body.writeUInt32BE(input.size % 0x100000000, ACK_SIZE_OFFSET)
  body.writeUInt32BE(input.time % 0x100000000, ACK_TIME_OFFSET)
  return body
}

export function parseAck(body: Buffer): AckBody {
  return {
    fileId: body.readUInt32BE(CONTROL_FILE_ID_OFFSET),
    size: body.readUInt32BE(ACK_SIZE_OFFSET),
    time: body.readUInt32BE(ACK_TIME_OFFSET)
  }
}

export function buildPath(input: { dir: string; fileId: number; name: string }): Buffer {
  const body = Buffer.alloc(FILE_CONTROL_BODY_SIZE)
  writeString(body, PATH_DIR_OFFSET, PATH_DIR_CHARS, input.dir)
  body.writeUInt32BE(input.fileId % 0x100000000, CONTROL_FILE_ID_OFFSET)
  writeString(body, PATH_NAME_OFFSET, PATH_NAME_CHARS, input.name)
  return body
}

export function parsePath(body: Buffer): PathBody {
  return {
    dir: readString(body, PATH_DIR_OFFSET, PATH_DIR_CHARS),
    fileId: body.readUInt32BE(CONTROL_FILE_ID_OFFSET),
    name: readString(body, PATH_NAME_OFFSET, PATH_NAME_CHARS)
  }
}

export function buildData(input: {
  fileId: number
  size: number
  offset: number
  chunk: Buffer
}): Buffer {
  const body = Buffer.alloc(FILE_DATA_HEADER_SIZE + input.chunk.length)
  body.writeUInt32BE(input.fileId % 0x100000000, DATA_FILE_ID_OFFSET)
  body.writeUInt32BE(input.size % 0x100000000, DATA_SIZE_OFFSET)
  body.writeUInt32BE(input.offset % 0x100000000, DATA_OFFSET_OFFSET)
  body.writeUInt32BE(input.chunk.length, DATA_CHUNK_OFFSET)
  input.chunk.copy(body, FILE_DATA_HEADER_SIZE)
  return body
}

export function parseDataHeader(body: Buffer): DataHeader {
  return {
    fileId: body.readUInt32BE(DATA_FILE_ID_OFFSET),
    size: body.readUInt32BE(DATA_SIZE_OFFSET),
    offset: body.readUInt32BE(DATA_OFFSET_OFFSET),
    chunkSize: body.readUInt32BE(DATA_CHUNK_OFFSET)
  }
}

// 反向推送图片时发送方先发的一条窗口消息：正文是 UTF-16 的 retrieve JSON，
// 文件号以大端写在偏移 44（会覆盖掉那段 JSON 里的几个字符，真实客户端也这样）
export function buildWindow(input: { fileId: number; value: string }): Buffer {
  const body = Buffer.alloc(FILE_WINDOW_BODY_SIZE)
  const head = 'app" : "shiyeline",\n '
  body.write(head, 0, 'utf16le')
  body.writeUInt32BE(input.fileId % 0x100000000, 44)
  const rest = [
    'dt" : [',
    '      {',
    '         "retrieve" : {',
    '            "m" : "",',
    `            "v" : ${JSON.stringify(input.value)}`,
    '         }',
    '      }',
    '   ],',
    '   "ft" : {',
    '      "b" : "0",',
    '      "c" : "0x000000",',
    '      "i" : "0",',
    '      "n" : "微软雅黑",',
    '      "s" : "9",',
    '      "u" : "0"',
    '   },',
    `   "id" : "${'0'.repeat(32)}",`,
    '   "type" : "0",',
    '   "ver" : "6.0"',
    '}'
  ].join('\n')
  body.write(rest.slice(0, Math.floor((FILE_WINDOW_BODY_SIZE - 48) / 2)), 48, 'utf16le')
  return body
}
